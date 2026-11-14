import type { CoreCallContext } from '../../contracts/core/call-context.js';
import { rejected as rejection } from '../../contracts/core/rejections.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import type { RoleConfigurationRef, SessionRef, WorkLinkTarget } from '../../contracts/core/identity.js';
import type { RunSnapshot, TaskTriple } from '../../contracts/dispatch.js';
import type { GoalRef, GoalSnapshot } from '../../contracts/ledger.js';
import { sameJson as sameCanonical } from '../../contracts/fingerprint.js';
import type { PickBasisV1 } from '../../contracts/pick-basis.js';
import type { RoleLineDutyV1, RoleScopeV1 } from '../../contracts/role-lines.js';
import { isRoleLineOpenDuty } from '../../contracts/role-lines.js';
import type { SessionActivityReadPort } from '../../core/work-graph/model/session-activity-contracts.js';
import type { RoleLineAllocationReadPort, SessionCard, SessionDirectoryPort } from '../../core/work-graph/model/session-contracts.js';
import type { SessionFactsPort } from '../../core/work-graph/model/session-facts-contracts.js';
import type { PreClaimAuthorizationPortV1, SessionReuseVerdictV1 } from '../../core/work-graph/model/pick-ports.js';
import type { WorkLineReadPort } from '../../core/work-graph/model/work-line-contracts.js';
import type { SessionResponsibilityPort } from '../../core/work-graph/sessions/session-responsibility-service.js';
import type { RoleLineLineV1, RoleLineOperationsPort } from '../../core/work-graph/sessions/role-line-operations.js';
import type { ResponsibilityRecipientInputV1, ResponsibilityRecipientPort } from '../../core/work-graph/tasks/responsibility-recipient.js';
import { plainSessionRefKey } from '../../core/work-graph/sessions/session-record-codecs.js';
import { latestActivityAt } from '../../core/work-graph/tasks/line-clock.js';
import { comparePickCandidates, pickBasisRank, type PickCandidateV1 } from './pick-ranking.js';
import type { Binding, Owned } from './workflow.js';
import type { SessionDutyResolver } from './ports.js';

export type SessionChoice =
  | { kind: 'reuse'; card: SessionCard }
  | { kind: 'create' }
  | { kind: 'waiting'; reason: string }
  | { kind: 'rejection'; rejection: CoreRejection };

/** The reads L1 wires. Absent = today's order and no authorization filter (lesson 2). */
export type PickReadsV1 = {
  activity?: {
    lines: Pick<WorkLineReadPort, 'listWorkLines'>;                  // the canonical Work/Query/copy gather
    record: Pick<SessionActivityReadPort, 'readSessionActivity'>;   // 6B's activity facts
  };
  goalRuns?: (ctx: CoreCallContext, goalRef: GoalRef) =>
    Promise<{ status: 'ready'; runs: readonly RunSnapshot[] } | CoreRejection>;
  authorization?: PreClaimAuthorizationPortV1;
};

type RoleVerdict = 'ok' | 'workspace' | 'archived' | 'unavailable' | 'occupied' | 'role';
/**
 * `project` skips the workspace and line checks: a project-level line may be reused from another workspace of the
 * project. `lineFolder`, the Goal's line (kls-design §2.3.4): a Session takes only its own line's Tasks, and a Goal
 * with no line (`null`) only a Session with none.
 */
type ReuseOption = { scope: 'workspace'; lineFolder?: string | null } | { scope: 'project' };

function roleVerdict(card: SessionCard, workspaceId: string, sessionRole: RoleConfigurationRef,
  option: ReuseOption = { scope: 'workspace' }): RoleVerdict {
  const record = card.record;
  if (option.scope !== 'project' && record.workspaceId !== workspaceId) return 'workspace';
  if (option.scope !== 'project' && option.lineFolder !== undefined
    && (record.lineRef?.folder ?? null) !== option.lineFolder) return 'workspace';
  if (record.lifecycle !== 'active') return 'archived';
  if (record.health !== 'available') return 'unavailable';
  if (record.occupancy !== null) return 'occupied';
  return sameCanonical(record.role, sessionRole) ? 'ok' : 'role';
}

export function roleReusable(card: SessionCard, workspaceId: string, binding: Binding,
  option?: ReuseOption): boolean {
  return roleVerdict(card, workspaceId, binding.sessionRole, option) === 'ok';
}

/** The Goal's line as the reuse check reads it. */
const lineReuse = (goal: GoalSnapshot): ReuseOption => ({ scope: 'workspace', lineFolder: goal.lineRef?.folder ?? null });

type TaskLinkRead =
  | { status: 'found'; card: SessionCard }
  | { status: 'none' }
  | { status: 'unavailable'; rejection: CoreRejection };
type ExclusionRead = { excluded: boolean; incomplete: 'waits' | null };

export function createSessionChooser(deps: {
  sessions: SessionDirectoryPort;
  sessionFacts?: SessionFactsPort;
  responsibilities?: SessionResponsibilityPort;
  recipients?: ResponsibilityRecipientPort;     // O4b: the one L35 read
  /** L39 (book :716): O1b's one reuse writer; the chooser only picks (ruling :2206, :2216–:2218). */
  roleLineReuse?: Pick<RoleLineOperationsPort, 'reuse'>;
  standby?: {
    allocation: RoleLineAllocationReadPort;            // each duty's seat holders (C/role-lines.ts:222–:225)
    tooLong(ctx: CoreCallContext, session: SessionRef): Promise<ReadResult<{ tooLong: boolean }>>;
  };
  pick?: PickReadsV1;
  /** Reuses the platform's duty resolver; a project-level line is admitted by duty, never by role name. */
  sessionDuty?: SessionDutyResolver;
}) {
  /**
   * Rule 7: a readonly copy, an archive-requested or a waiting Session is never
   * chosen for NEW work or Query claims. The original yielded-wait continuation
   * claim does not pass through here and keeps its legitimate reuse.
   */
  async function exclusionOf(ctx: CoreCallContext, card: SessionCard): Promise<ExclusionRead> {
    const record = card.record;
    if (record.provenance?.kind === 'readonly_copy') return { excluded: true, incomplete: null };
    if (record.archiveRequest !== null && record.archiveRequest !== undefined) {
      return { excluded: true, incomplete: null };
    }
    if (deps.sessionFacts !== undefined) {
      try {
        const factsCtx = record.workspaceId === ctx.workspaceId
          ? ctx : { ...ctx, workspaceId: record.workspaceId };
        const facts = await deps.sessionFacts.readSessionFacts(factsCtx, {
          projectId: record.ref.projectId, sessionId: record.ref.sessionId,
        });
        if (facts.status === 'not_found') return { excluded: true, incomplete: null };
        if (facts.status !== 'ready') return { excluded: true, incomplete: 'waits' };
        const incomplete = facts.value.waits.some(wait => wait.complete === false) ? 'waits' : null;
        if (facts.value.wait !== null || incomplete !== null) return { excluded: true, incomplete };
        return { excluded: false, incomplete: null };
      } catch {
        return { excluded: true, incomplete: 'waits' };
      }
    }
    return { excluded: false, incomplete: null };
  }

  async function chooseExcluded(owned: Owned, card: SessionCard): Promise<boolean> {
    return (await exclusionOf(owned.ctx, card)).excluded;
  }

  /**
   * Rule W: a line in another workspace, or on another of the workspace's lines (kls-design §2.3.4), is usable
   * only when it holds a project-level duty (the four lines of book :278-:280); members and executors never cross.
   * A line on the Goal's own workspace line keeps the plain rule.
   */
  async function projectReusable(owned: Owned, card: SessionCard, binding: Binding,
    goal: GoalSnapshot): Promise<boolean> {
    const workspaceId = goal.workspaceRef.workspaceId;
    if (roleReusable(card, workspaceId, binding, lineReuse(goal))) return true;
    if (!roleReusable(card, workspaceId, binding, { scope: 'project' })) return false;
    if (deps.sessionDuty === undefined) return false;
    const duty = await deps.sessionDuty(card.record.role, owned.ctx);
    return duty.status === 'ready' && isRoleLineOpenDuty(duty.value);
  }

  /**
   * E16 (§4.1 S:799): a Task transferred to a chosen Session carries an OPEN
   * responsible link on that Session. The task-targeted read keeps the old
   * workspace-scoped link page (A-10); when it finds nothing, the project-wide
   * directory read finds a project-level line in any workspace of the project,
   * with the same role/link/exclusion checks applied locally. The Goal target
   * covers the one adviser O4a assigns. A failed or truncated read is a definite
   * failure (A-10), never "no link".
   */
  async function readResponsibleSession(
    owned: Owned, goal: GoalSnapshot, binding: Binding, task: TaskTriple,
  ): Promise<TaskLinkRead> {
    if (deps.responsibilities === undefined) return { status: 'none' };
    const workspaceId = goal.workspaceRef.workspaceId;
    const targets = [{ kind: 'task' as const, ref: task }, { kind: 'goal' as const, ref: goal.ref }];
    const reads: { workspace: { projectId: string; workspaceId?: string }; target?: WorkLinkTarget }[] = [
      { workspace: { projectId: owned.projectId, workspaceId }, target: targets[0]! },
      { workspace: { projectId: owned.projectId } },
    ];
    for (const read of reads) {
      let cursor: string | null = null;
      let truncated = false;
      for (let page = 0; page < 8; page += 1) {
        let found: Awaited<ReturnType<SessionDirectoryPort['findSessions']>>;
        try {
          found = await deps.sessions.findSessions(owned.ctx, {
            ...read,
            includeArchived: false,
            page: cursor === null ? { limit: 50 } : { limit: 50, cursor },
          });
        } catch {
          return { status: 'unavailable', rejection: rejection('unavailable', 'the responsible Session link read failed') };
        }
        if (found.status === 'not_found') break;
        if (found.status !== 'ready') {
          if (found.status === 'rejected' && (found.code === 'cancelled' || found.code === 'forbidden')) {
            return { status: 'unavailable', rejection: found };
          }
          return { status: 'unavailable',
            rejection: rejection('unavailable', 'the responsible Session link read is not ready') };
        }
        for (const card of found.value.items) {
          const openResponsible = card.links.some(link => link.ref.relation === 'responsible'
            && link.until === null && targets.some(target => sameCanonical(link.ref.target, target)));
          if (!openResponsible) continue;
          if (!(await projectReusable(owned, card, binding, goal))) continue;
          if ((await exclusionOf(owned.ctx, card)).excluded) continue;
          return { status: 'found', card };
        }
        if (found.value.nextCursor === null) break;
        cursor = found.value.nextCursor;
        if (page === 7) truncated = true;
      }
      if (truncated) {
        return { status: 'unavailable',
          rejection: rejection('incomplete', 'the responsible Session link read exceeded its page bound') };
      }
    }
    return { status: 'none' };
  }

  async function responsibleSessionFor(
    owned: Owned, goal: GoalSnapshot, binding: Binding, task: TaskTriple,
  ): Promise<SessionCard | null> {
    const read = await readResponsibleSession(owned, goal, binding, task);
    return read.status === 'found' ? read.card : null;
  }

  /** The one B implementation of F1's port; M consumes it through the injected port, never a second body. */
  async function reusable(ctx: CoreCallContext, input: { workspaceId: string; sessionRole: RoleConfigurationRef;
    card: SessionCard }): Promise<SessionReuseVerdictV1> {
    const verdict = roleVerdict(input.card, input.workspaceId, input.sessionRole);
    if (verdict !== 'ok') return { reusable: false, because: verdict };
    const exclusion = await exclusionOf(ctx, input.card);
    if (exclusion.incomplete === 'waits') return { reusable: false, because: 'waits_incomplete' };
    if (!exclusion.excluded) return { reusable: true };
    const record = input.card.record;
    if (record.provenance?.kind === 'readonly_copy') return { reusable: false, because: 'readonly_copy' };
    if (record.archiveRequest !== null && record.archiveRequest !== undefined) {
      return { reusable: false, because: 'archive_requested' };
    }
    return { reusable: false, because: 'waiting' };
  }

  async function resolveRecipient(owned: Owned, input: Omit<ResponsibilityRecipientInputV1, 'projectId'>):
  Promise<{ kind: 'line'; session: SessionRef; copy: SessionRef | null } | { kind: 'none' } | CoreRejection> {
    if (deps.recipients === undefined) return { kind: 'none' };
    const read = await deps.recipients.resolveResponsibilityRecipient(owned.ctx,
      { ...input, projectId: owned.projectId });
    if (read.status !== 'ready') {
      return read.status === 'rejected' ? read
        : rejection('unavailable', 'the responsibility recipient read is not ready');
    }
    return read.value.kind === 'human' ? { kind: 'none' }
      : { kind: 'line', session: read.value.session, copy: read.value.copy };
  }

  /**
   * L39: one standby line of `duty` for `scope`. Eligible: holds a seat, no open responsible link, idle (the
   * pick's own verdict and `exclusionOf`), not too long, and a prior responsible module link inside `modules`;
   * the latest activity wins. The claim check and the commit are O1b's `reuse`; a card is O1b/O3's.
   */
  async function reuseStandby(owned: Pick<Owned, 'ctx'>, input: {
    commandId: string; duty: RoleLineDutyV1; scope: RoleScopeV1[]; modules: ReadonlySet<string> | 'all';
  }): Promise<{ kind: 'reused'; line: RoleLineLineV1 } | { kind: 'none' } | CoreRejection> {
    if (deps.roleLineReuse === undefined || deps.standby === undefined) return { kind: 'none' };
    const allocation = await deps.standby.allocation.readRoleLineAllocation(owned.ctx, {});
    if (allocation.status !== 'ready') {
      return allocation.status === 'rejected' ? allocation
        : rejection('unavailable', 'the line allocation read is not ready');
    }
    let best: { session: SessionRef; activityAt: string } | null = null;
    for (const holder of allocation.value.duties[input.duty].holders) {
      const card = await deps.sessions.readSession(owned.ctx, holder.session, 'project');
      if (card.status === 'not_found') continue;            // not this project's line
      if (card.status !== 'ready') {
        return card.status === 'rejected' ? card : rejection('unavailable', 'a standby line read is not ready');
      }
      const record = card.value.record;
      if (record.lifecycle !== 'active' || record.health !== 'available' || record.occupancy !== null) continue;
      const responsible = card.value.links.filter(link => link.ref.relation === 'responsible');
      if (responsible.some(link => link.until === null)) continue;                    // not standby
      if (!responsible.some(link => link.ref.target.kind === 'module'
        && (input.modules === 'all' || input.modules.has(link.ref.target.ref.moduleId)))) continue;
      if ((await exclusionOf(owned.ctx, card.value)).excluded) continue;
      const long = await deps.standby.tooLong(owned.ctx, holder.session);
      if (long.status !== 'ready') {
        return long.status === 'rejected' ? long : rejection('unavailable', 'the line length read is not ready');
      }
      if (long.value.tooLong) continue;
      let activityAt = record.createdAt;
      if (deps.pick?.activity !== undefined) {
        const activity = await deps.pick.activity.record.readSessionActivity(owned.ctx, { session: holder.session });
        if (activity.status === 'ready') {
          activityAt = latestActivityAt(record.createdAt, [activity.value.lastActivityAt]);
        } else if (activity.status !== 'not_found') {
          return rejection('unavailable', 'the standby line activity read is not ready');
        }
      }
      if (best === null || activityAt > best.activityAt) best = { session: holder.session, activityAt };
    }
    if (best === null) return { kind: 'none' };
    const reused = await deps.roleLineReuse.reuse(owned.ctx,
      { commandId: input.commandId, session: best.session, scope: input.scope });
    return reused.status === 'committed' ? { kind: 'reused', line: reused.value } : reused;
  }

  async function chooseSession(
    owned: Owned, goal: GoalSnapshot, binding: Binding, sessionHint: SessionRef | null,
    task: TaskTriple | null, moduleRef: string | null = null,
  ): Promise<SessionChoice & { basis: PickBasisV1 }> {
    void sessionHint;
    const workspaceId = goal.workspaceRef.workspaceId;
    let targeted: SessionCard | null = null;
    if (task !== null) {
      const transferred = await readResponsibleSession(owned, goal, binding, task);
      if (transferred.status === 'unavailable') {
        if (transferred.rejection.code === 'cancelled' || transferred.rejection.code === 'forbidden') {
          return { kind: 'rejection', rejection: transferred.rejection,
            basis: { rank: 'none', incomplete: [], candidates: 0 } };
        }
        return { kind: 'waiting', reason: transferred.rejection.reason,
          basis: { rank: 'none', incomplete: ['task_links'], candidates: 0 } };
      }
      if (transferred.status === 'found') targeted = transferred.card;
    }
    const cards: SessionCard[] = [];
    const cardKeys = new Set<string>();
    const addCard = (card: SessionCard): void => {
      const key = plainSessionRefKey(card.record.ref);
      if (cardKeys.has(key)) return;
      cardKeys.add(key);
      cards.push(card);
    };
    if (targeted !== null) addCard(targeted);
    let cursor: string | null = null;
    let readPage = false;
    let directoryIncomplete = false;
    for (let page = 0; page < 8; page += 1) {
      let found: Awaited<ReturnType<SessionDirectoryPort['findSessions']>>;
      try {
        found = await deps.sessions.findSessions(owned.ctx, {
          workspace: { projectId: owned.projectId, workspaceId },
          role: binding.sessionRole,
          ...(goal.lineRef === null ? {} : { lineFolder: goal.lineRef.folder }),
          includeArchived: false,
          page: cursor === null ? { limit: 50 } : { limit: 50, cursor },
        });
      } catch {
        if (!readPage && targeted === null) {
          return { kind: 'waiting', reason: 'the Session directory is not readable',
            basis: { rank: 'none', incomplete: [], candidates: 0 } };
        }
        directoryIncomplete = true;
        break;
      }
      if (found.status === 'not_found') break;
      if (found.status !== 'ready') {
        // A page-1 refusal still leaves the already-read targeted card a candidate (only that case skips the
        // refusal); with nothing read yet it stays a rejection.
        if (found.status === 'rejected' && (found.code === 'cancelled' || found.code === 'forbidden')
          && (readPage || targeted === null)) {
          return { kind: 'rejection', rejection: found, basis: { rank: 'none', incomplete: [], candidates: 0 } };
        }
        if (!readPage && targeted === null) {
          return { kind: 'waiting', reason: 'the Session directory is not readable',
            basis: { rank: 'none', incomplete: [], candidates: 0 } };
        }
        directoryIncomplete = true;
        break;
      }
      readPage = true;
      for (const card of found.value.items) addCard(card);
      if (found.value.nextCursor === null) break;
      cursor = found.value.nextCursor;
      if (page === 7) directoryIncomplete = true;
    }

    const marks = new Set<PickBasisV1['incomplete'][number]>();
    if (directoryIncomplete) marks.add('directory');

    const runSessions = new Set<string>();
    if (deps.pick?.goalRuns !== undefined) {
      try {
        const runs = await deps.pick.goalRuns(owned.ctx, goal.ref);
        if (runs.status === 'ready') {
          for (const run of runs.runs) {
            if (run.status !== 'ended') continue;
            const sessionRef = run.executionHistory?.sessionRef;
            if (sessionRef === undefined) continue;
            runSessions.add(plainSessionRefKey(sessionRef));
          }
        } else {
          marks.add('goal_history');
        }
      } catch {
        marks.add('goal_history');
      }
    }

    const lineActivity = new Map<string, string>();
    if (deps.pick?.activity !== undefined) {
      try {
        const lines = await deps.pick.activity.lines.listWorkLines(owned.ctx, {
          workspace: { projectId: owned.projectId, workspaceId },
        });
        if (lines.status === 'ready') {
          for (const row of lines.value.rows) {
            lineActivity.set(row.key.sessionId, row.lastActivityAt);
            for (const chained of row.chainSessions) lineActivity.set(chained.sessionId, row.lastActivityAt);
          }
        } else if (lines.status !== 'not_found') {
          marks.add('activity');
        }
      } catch {
        marks.add('activity');
      }
    }

    const candidates: PickCandidateV1[] = [];
    for (const card of cards) {
      // Only a card that already answers for this Goal or Task uses the project
      // variant; every ordinary candidate keeps the workspace rule.
      const responsibleTask = task !== null && card.links.some(link => link.ref.relation === 'responsible'
        && link.until === null && sameCanonical(link.ref.target, { kind: 'task', ref: task }));
      const responsibleGoal = card.links.some(link => link.ref.relation === 'responsible'
        && link.until === null && sameCanonical(link.ref.target, { kind: 'goal', ref: goal.ref }));
      const usable = responsibleTask || responsibleGoal
        ? await projectReusable(owned, card, binding, goal)
        : roleReusable(card, workspaceId, binding, lineReuse(goal));
      if (!usable) continue;
      const exclusion = await exclusionOf(owned.ctx, card);
      if (exclusion.incomplete === 'waits') marks.add('waits');
      if (exclusion.excluded) continue;
      if (task !== null && deps.pick?.authorization !== undefined) {
        const verdict = await deps.pick.authorization.check(owned.ctx, {
          task, session: card.record.ref, binding: binding.roleBinding,
        });
        if (verdict.verdict === 'refused') continue;
        if (verdict.verdict === 'unavailable') {
          marks.add('authorization');
          continue;
        }
      }
      const record = card.record;
      const responsibleModule = moduleRef !== null
        && card.links.some(link => link.ref.relation === 'responsible' && link.until === null
          && sameCanonical(link.ref.target,
            { kind: 'module', ref: { projectId: owned.projectId, moduleId: moduleRef } }));
      const sameGoalRun = runSessions.has(plainSessionRefKey(record.ref));
      let activityAt = latestActivityAt(record.createdAt, [lineActivity.get(record.ref.sessionId) ?? null]);
      if (deps.pick?.activity !== undefined) {
        try {
          const activity = await deps.pick.activity.record.readSessionActivity(owned.ctx, { session: record.ref });
          if (activity.status === 'ready') {
            activityAt = latestActivityAt(record.createdAt,
              [lineActivity.get(record.ref.sessionId) ?? null, activity.value.lastActivityAt]);
          } else if (activity.status !== 'not_found') {
            marks.add('activity');
          }
        } catch {
          marks.add('activity');
        }
      }
      candidates.push({ card, responsibleTask, responsibleModule, sameGoalRun, activityAt });
    }

    const ranked = [...candidates].sort(comparePickCandidates);
    const declared: PickBasisV1['incomplete'] = [
      'task_links', 'module_links', 'goal_history', 'directory', 'activity', 'waits', 'authorization',
    ];
    const incomplete = declared.filter(mark => marks.has(mark));
    if (ranked.length === 0) {
      return { kind: 'create', basis: { rank: 'none', incomplete, candidates: 0 } };
    }
    return { kind: 'reuse', card: ranked[0]!.card,
      basis: { rank: pickBasisRank(ranked), incomplete, candidates: ranked.length } };
  }

  return { chooseSession, responsibleSessionFor, chooseExcluded, reusable, resolveRecipient, reuseStandby };
}
