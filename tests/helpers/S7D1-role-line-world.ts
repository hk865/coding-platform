/**
 * FX-7D1-01a (fixture spec v3 `:91-104`): the two-workspace role-line world of G2-1's service rows.
 *
 * Everything here is a public step: the frozen request world (`openS6ATwoWorkspaceWorld`), its cards handles for both
 * workspaces (`s6aCardsWorkspace`), the project governance and Plan helpers (`governS6B`/`adoptS6BPlan`), real
 * `sessions/create`/`sessions/link`/`goals/create` calls, and `sessions/read`/`sessions/find` for every observation.
 * It starts no Run. It never reads a claim from a store, never writes a plan-shaped link, opens no third workspace and
 * never calls `recordSessionCreated`.
 *
 * The world: two adviser lines and one secretary line in workspace A; a Goal created in workspace B of the same
 * project (the cross-workspace Goal target); one open `responsible` project link on the first adviser; one open
 * cross-workspace Goal link on the second adviser; one open module link (`s6a-core`) on the secretary; and one Task
 * link on each adviser from the adopted Plan (real `sessions/create` initial links). The secretary's module link is
 * the same scope another duty may also link: it takes no claim.
 *
 * `claimHolder` is the public answer for "which claim-taking line (an adviser/scribe link) holds this scope": it is
 * derived from `sessions/find`'s open `responsible` links among the world's adviser lines, never from the store's
 * claim slot. The secretary's link is deliberately not a holder.
 */
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { SessionRef, SessionWorkLinkRef, VersionPin, WorkLinkTarget } from '../../src/contracts/core/identity.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { SessionWorkLink } from '../../src/contracts/core/session.js';
import type { SessionCard, SessionPage } from '../../src/core/work-graph/model/session-contracts.js';
import { canonicalKey } from '../../src/contracts/fingerprint.js';
import { responsibleLinkRef } from '../../src/core/work-graph/sessions/session-responsibility-service.js';
import { graphWrite } from './AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from './S6A-cards-fixture.js';
import { refOf } from './S6A-host-fixture.js';
import {
  openS6ATwoWorkspaceWorld, S6A_AT, S6A_SCOPE, S6A_WORK_ROLE,
  type S6ABackend, type S6ARequestWorld, type S6ASession,
} from './S6A-request-fixture.js';
import { ready } from './S2C-K-scenario-support.js';
import { sessionOf } from './S7A-fixture.js';
import { adoptS6BPlan, governS6B, openS6BRoleLine } from './S6B1-fixture.js';
import { committed } from './S7A-fixture.js';
import {
  linkTask, openS7CHandoffWorld, openS7CHandoffWorldLight, type S7CHandoffCore,
} from './S7C-handoff-fixture.js';

const MODULE_ID = 's6a-core';

/** One owner write and the exact request that produced it; `replay` sends the same body again (receipt recovery). */
export type S7D1Write<T> = {
  readonly result: WriteResult<T>;
  replay(): Promise<WriteResult<T>>;
};

export type S7D1LinkInput = {
  line: S6ASession | SessionRef;
  target: WorkLinkTarget;
  /** Default `true` (open); `false` closes the existing `responsible` link. */
  active?: boolean;
  requestId: string;
};

export type S7D1TransferInput = {
  from: S6ASession | SessionRef;
  to: S6ASession | SessionRef;
  target: WorkLinkTarget;
  requestId: string;
};

/**
 * The one `sessions/link` step: the card's revision and the link's revision (0 when absent) are the two pins, and
 * the body is the real route's. Every open-chain caller passes its own world, so one rule serves the world's three
 * fixture links, the handoff scope's goal/module links and a row's project link.
 */
export async function openLink(world: S6ARequestWorld, input: S7D1LinkInput): Promise<S7D1Write<SessionWorkLink>> {
  const session = refOf(input.line);
  const active = input.active ?? true;
  const card = await world.readSession(session);
  const link = card.links.find(entry => canonicalKey(entry.ref) === canonicalKey(responsibleLinkRef(session, input.target)));
  const expected: VersionPin[] = [
    { ref: card.record.ref, revision: card.record.revision },
    { ref: responsibleLinkRef(session, input.target), revision: link?.revision ?? 0 },
  ];
  const body = graphWrite(S6A_SCOPE, {
    sessionRef: session, target: input.target, relation: 'responsible', active,
  }, input.requestId, expected);
  const send = async (): Promise<WriteResult<SessionWorkLink>> =>
    (await world.post('sessions/link', body)).body as WriteResult<SessionWorkLink>;
  return { result: await send(), replay: send };
}

/** The first open responsible link of one kind on a card (the public `sessions/read` shape). */
export function openLinkOf(card: SessionCard, kind: 'goal' | 'project' | 'module') {
  return card.links.find(link => link.ref.relation === 'responsible' && link.until === null
    && link.ref.target.kind === kind);
}

export type S7D1RoleLineWorld = {
  readonly world: Awaited<ReturnType<typeof openS6ATwoWorkspaceWorld>>['world'];
  readonly lines: { readonly first: S6ASession; readonly second: S6ASession; readonly secretary: S6ASession };
  readonly goalB: GoalRef;
  readonly targets: { readonly project: WorkLinkTarget; readonly goal: WorkLinkTarget; readonly module: WorkLinkTarget };
  /** `sessions/link` through the Host's real route; the two pins come from `sessions/read`. */
  openLink(input: S7D1LinkInput): Promise<S7D1Write<SessionWorkLink>>;
  /** `sessions/transfer-responsibility` through the Host's real route; the four pins from `sessions/read`. */
  transfer(input: S7D1TransferInput): Promise<S7D1Write<{ from: SessionWorkLink; to: SessionWorkLink }>>;
  readCard(line: S6ASession | SessionRef): Promise<SessionCard>;
  findByTarget(target: WorkLinkTarget): Promise<SessionCard[]>;
  /** The claim-taking line whose open `responsible` link names `target` (public link state, never the store). */
  claimHolder(target: WorkLinkTarget): Promise<SessionRef | null>;
  close(): Promise<void>;
};

/** Open the world (fixture spec 01a). Memory or SQLite; no Run starts. */
export async function openS7D1RoleLineWorld(options: { backend: S6ABackend }): Promise<S7D1RoleLineWorld> {
  const opened = await openS6ATwoWorkspaceWorld({ backend: options.backend, at: S6A_AT });
  const world = opened.world;
  const a = s6aCardsWorkspace(world, S6A_SCOPE);
  const b = s6aCardsWorkspace(world, opened.second.scope);
  try {
    const goalB = (await b.createGoal('s7d1-goal-b', 'G2-1 cross-workspace goal')).ref;
    await governS6B(world, a, { first: world.goals.first, second: world.goals.second });
    const { tasks } = await adoptS6BPlan(a, world.goals.first, {
      label: 's7d1', taskIds: ['s7d1-a', 's7d1-b'], role: S6A_WORK_ROLE.templateId,
    });
    const targets = {
      project: { kind: 'project', ref: { projectId: S6A_SCOPE.projectId } } as WorkLinkTarget,
      goal: { kind: 'goal', ref: goalB } as WorkLinkTarget,
      module: { kind: 'module', ref: { projectId: S6A_SCOPE.projectId, moduleId: MODULE_ID } } as WorkLinkTarget,
    };
    // T4b: the two adviser lines and the secretary line open through `role-lines/open` with the scopes they hold;
    // the two adviser Task links stay, through the real `sessions/link`.
    const first = await sessionOf(world, await openS6BRoleLine(a, { label: 's7d1-adviser-first',
      duty: 'adviser', scope: [{ kind: 'project' }], requestId: 's7d1-open-adviser-first' }));
    const second = await sessionOf(world, await openS6BRoleLine(a, { label: 's7d1-adviser-second',
      duty: 'adviser', scope: [{ kind: 'goal', goalRef: goalB }], requestId: 's7d1-open-adviser-second' }));
    const secretary = await sessionOf(world, await openS6BRoleLine(a, { label: 's7d1-secretary',
      duty: 'secretary', scope: [{ kind: 'region', moduleRef: { projectId: S6A_SCOPE.projectId, moduleId: MODULE_ID } }],
      requestId: 's7d1-open-secretary' }));
    for (const [index, line] of [first, second].entries()) {
      const linked = await openLink(world, { line, target: { kind: 'task', ref: tasks[index]! },
        requestId: `s7d1-world-task-${index + 1}` });
      if (linked.result.status !== 'committed') {
        throw new Error(`S7D1 role-line world: the Task link did not commit: ${JSON.stringify(linked.result)}`);
      }
    }

    async function readCard(line: S6ASession | SessionRef): Promise<SessionCard> {
      return ready(await a.route('sessions/read', refOf(line)) as ReadResult<SessionCard>, 'the Session card');
    }

    async function transfer(input: S7D1TransferInput): Promise<S7D1Write<{ from: SessionWorkLink; to: SessionWorkLink }>> {
      const from = refOf(input.from);
      const to = refOf(input.to);
      const fromCard = await readCard(from);
      const toCard = await readCard(to);
      const fromLink = fromCard.links.find(entry => canonicalKey(entry.ref) === canonicalKey(responsibleLinkRef(from, input.target)));
      const toLink = toCard.links.find(entry => canonicalKey(entry.ref) === canonicalKey(responsibleLinkRef(to, input.target)));
      const expected: VersionPin[] = [
        { ref: fromCard.record.ref, revision: fromCard.record.revision },
        { ref: toCard.record.ref, revision: toCard.record.revision },
        { ref: responsibleLinkRef(from, input.target), revision: fromLink?.revision ?? 0 },
        { ref: responsibleLinkRef(to, input.target), revision: toLink?.revision ?? 0 },
      ];
      const body = graphWrite(a.scope, { from, to, target: input.target }, input.requestId, expected);
      const send = async (): Promise<WriteResult<{ from: SessionWorkLink; to: SessionWorkLink }>> =>
        await a.post('sessions/transfer-responsibility', body) as WriteResult<{ from: SessionWorkLink; to: SessionWorkLink }>;
      return { result: await send(), replay: send };
    }

    async function findByTarget(target: WorkLinkTarget): Promise<SessionCard[]> {
      const page = ready(await a.route('sessions/find', {
        workspace: { ...a.scope }, target, includeArchived: false, page: { limit: 100 },
      }) as ReadResult<SessionPage<SessionCard>>, `the ${target.kind} target page`);
      return page.items;
    }

    async function claimHolder(target: WorkLinkTarget): Promise<SessionRef | null> {
      const claimLines = new Set([first.ref.sessionId, second.ref.sessionId]);
      const holders = (await findByTarget(target))
        .filter(card => claimLines.has(card.record.ref.sessionId))
        .filter(card => card.links.some(entry => entry.ref.relation === 'responsible' && entry.until === null
          && canonicalKey(entry.ref.target) === canonicalKey(target)))
        .map(card => ({ projectId: card.record.ref.projectId, sessionId: card.record.ref.sessionId }));
      return holders[0] ?? null;
    }

    return {
      world,
      lines: { first, second, secretary }, goalB, targets,
      openLink: input => openLink(world, input), transfer, readCard, findByTarget, claimHolder,
      close: () => world.close(),
    };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

/**
 * FX-7D1-01c: the source handoff of the existing FH-1 world (one `openS7CHandoffWorld`, never a second world).
 * The two note-free Goals' Tasks are closed through the real `linkTask`, the source line gains its open `responsible`
 * goal link and the adviser line its module region link through `sessions/link`, and the real handoff acceptance runs
 * through the platform's published `sessionHandoff.acceptHandoff`; nothing is driven past the acceptance, so a row
 * observes the first acceptance before any successor exists. The successor create, the transfers and the archive are
 * the rows' own `driveS6BHandoff` call on the returned `operation`.
 *
 * `partial` keeps one of the source's held Tasks unassigned, so the rows can observe the partial handoff that leaves
 * the scope (and holder) with the source. No module link is written as a Task link, no record or context is built.
 */
export type S7D1HandoffScopeSeed = {
  readonly world: S7CHandoffCore;
  readonly source: S6ASession;
  readonly adviser: S6ASession;
  /** Every open `responsible` Task the source held at acceptance (FH-1 keeps t1..t3 of the twelve-Task Plan). */
  readonly tasks: readonly TaskTriple[];
  /** The Tasks the accepted assignment names: all of `tasks`, or all but one for a partial handoff. */
  readonly assigned: readonly TaskTriple[];
  readonly targets: { readonly goal: WorkLinkTarget; readonly module: WorkLinkTarget };
  readonly links: { readonly goal: SessionWorkLink; readonly module: SessionWorkLink };
  /** The source/adviser Session pins read back after the acceptance, beside the two committed link revisions. */
  readonly pins: { readonly source: VersionPin; readonly goal: VersionPin;
    readonly adviser: VersionPin; readonly module: VersionPin };
  readonly operation: OperationRef;
  close(): Promise<void>;
};

export async function seedS7D1HandoffScope(
  options: { backend?: S6ABackend; partial?: boolean } = {},
): Promise<S7D1HandoffScopeSeed> {
  return await handoffScopeOn(await openS7CHandoffWorld(
    options.backend === undefined ? {} : { backend: options.backend }), options.partial === true);
}

/**
 * The same accepted handoff scope on the lighter FH-1 world (no consume world): the rows that only read the
 * acceptance, drive the published handoff or read the holders need none of the consume seed's lines or Runs.
 */
export async function seedS7D1HandoffScopeLight(
  options: { backend?: S6ABackend; partial?: boolean } = {},
): Promise<S7D1HandoffScopeSeed> {
  return await handoffScopeOn(await openS7CHandoffWorldLight(
    options.backend === undefined ? {} : { backend: options.backend }), options.partial === true);
}

async function handoffScopeOn(opened: S7CHandoffCore, partial: boolean): Promise<S7D1HandoffScopeSeed> {
  const world = opened.world;
  try {
    const source = opened.lines.source;
    const adviser = opened.lines.adviser;
    // The two extra Goals' Tasks are source work outside the named assignment; a full handoff has no residual Task.
    await linkTask(world, await world.readSession(source.ref), opened.clean.task, false, 's7d1-handoff-clean-close');
    await linkTask(world, await world.readSession(source.ref), opened.other.task, false, 's7d1-handoff-other-close');

    const targets = {
      goal: { kind: 'goal', ref: opened.goal } as WorkLinkTarget,
      module: { kind: 'module', ref: { projectId: S6A_SCOPE.projectId, moduleId: MODULE_ID } } as WorkLinkTarget,
    };
    const goalLink = committed<SessionWorkLink>((await openLink(world, {
      line: source, target: targets.goal, requestId: 's7d1-handoff-goal' })).result, 'the goal link s7d1-handoff-goal');
    const moduleLink = committed<SessionWorkLink>((await openLink(world, {
      line: adviser, target: targets.module, requestId: 's7d1-handoff-module' })).result, 'the module link s7d1-handoff-module');

    const heldCard = await world.readSession(source.ref);
    const tasks = heldCard.links.flatMap(link =>
      link.ref.relation === 'responsible' && link.until === null && link.ref.target.kind === 'task'
        ? [link.ref.target.ref] : []);
    const assigned = partial ? tasks.slice(0, -1) : tasks;
    const accepted = await world.platform.sessionHandoff.acceptHandoff(world.humanContext(), {
      commandId: 's7d1-handoff-scope', workspace: { ...S6A_SCOPE }, source: source.ref, trigger: 'manual',
      assignments: [{ target: { kind: 'create', duty: 'executor' }, tasks: [...assigned] }],
    });
    if (accepted.status !== 'committed') {
      throw new Error(`S7D1: the handoff acceptance was refused: ${JSON.stringify(accepted)}`);
    }

    const sourceCard = await world.readSession(source.ref);
    const adviserCard = await world.readSession(adviser.ref);
    return {
      world: opened, source, adviser,
      tasks: [...tasks], assigned: [...assigned], targets,
      links: { goal: goalLink, module: moduleLink },
      pins: {
        source: { ref: sourceCard.record.ref, revision: sourceCard.record.revision },
        goal: { ref: goalLink.ref, revision: goalLink.revision },
        adviser: { ref: adviserCard.record.ref, revision: adviserCard.record.revision },
        module: { ref: moduleLink.ref, revision: moduleLink.revision },
      },
      operation: accepted.value.operation,
      close: () => opened.close(),
    };
  } catch (error) {
    await opened.close().catch(() => undefined);
    throw error;
  }
}
