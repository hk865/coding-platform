/**
 * The adviser/scribe maintenance page and the retained-cap reclaim (7D2 O2; v4 §3.1.3-§3.1.5, TS-9 item 3).
 *
 * `maintain` reads one bounded page of a workspace's active lines. A line is looked at only when it is too long (the
 * one input basis over its QueryRuns and its tasks' Work Runs) or too slow (its consumable unaccepted requests stayed
 * over the limit for the window, replayed from the persisted message events in commit order). Such a line is split
 * through the one split owner when the pure planner finds a strict subrange; otherwise a too-long line goes to the
 * shared handoff entry and a too-slow one only shows its burden. A line with neither problem is never planned (book
 * :401-:411). `readSplitFacts` is the one line/positions/catalog read the page and `propose_role_split` share.
 *
 * `reclaimForAdmission` is the one retained-cap reclaim: it reads the duty's active lines, their six idle facts and
 * the exclusions, picks one line with the pure rule and archives it through the formal archive, naming the line's
 * operation for the one capacity close; it never creates a card and has no clock (decision 91).
 *
 * The reads of the tasks/notes owners arrive as structural members of the dependency bag (N-7): each keeps its
 * owner's signature and the composition passes the original function, so `sessions` imports neither layer.
 */
import type { AdoptedArchitecture } from '../../../contracts/architecture-catalog.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type {
  ModuleRef, ProjectScope, RoleConfigurationRef, SessionRef, WorkspaceScope,
} from '../../../contracts/core/identity.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { SessionRecord, SessionWorkLink } from '../../../contracts/core/session.js';
import type { TaskTriple } from '../../../contracts/dispatch.js';
import { messageOf } from '../../../contracts/error-message.js';
import { canonicalKey } from '../../../contracts/fingerprint.js';
import type { GoalPhaseRef, GoalPhaseSnapshot } from '../../../contracts/goal-phase.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type { NoteScopeV1 } from '../../../contracts/note.js';
import type { PlatformDutyV1 } from '../../../contracts/platform-duty.js';
import {
  roleLineDutyOf, roleScopeOfTarget, type RoleLineDutyV1, type RoleScopeV1,
} from '../../../contracts/role-lines.js';
import type { RecordEventPagePort } from '../../record-store/event-page-ports.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type { EncodedRecord, GoalRecordTransactionPort, RecordGuard } from '../../record-store/ports.js';
import { readCurrentCatalogWindow } from '../architecture/catalog-service.js';
import type { ObservedArchitecturePort } from '../architecture/contracts.js';
import type { SessionMessage } from '../model/communication-contracts.js';
import type { InitializationBindingReadPort } from '../model/goal-card-contracts.js';
import type { NoteScopeReadPort, NoteScribeTodoPort } from '../model/note-contracts.js';
import type { PlanTaskPort, TaskRow } from '../model/plan-contracts.js';
import type { SecretaryHandoffBasisV1 } from '../model/secretary-lifecycle-contracts.js';
import type { SessionCard, SessionDirectoryPort } from '../model/session-contracts.js';
import type { SessionFactsPort } from '../model/session-facts-contracts.js';
import type { HandoffProgressV1 } from '../model/session-handoff-contracts.js';
import type { SessionDutyReadPort } from '../model/work-line-contracts.js';
import { lookupAll } from '../persistence/lookup-all.js';
import { messageConsumptionProblem, messageFactsOfRecord } from '../state/message-machine.js';
import { goalPositionOf, regionPositionOf, type RoleLinePositionV1 } from '../state/role-line-position.js';
import { reclaimIdleLineOf, type ReclaimSeatV1, type RoleLineReclaimPort } from '../state/role-line-reclaim.js';
import { planRoleLineSplit } from '../state/role-line-split.js';
import type { RoleLineIdleFactsV1 } from '../state/session-availability.js';
import { createAllocationRead } from './allocation-read.js';
import type { SessionLifecyclePort } from './lifecycle-contracts.js';
import {
  SESSION_MESSAGE_BY_RECIPIENT_LOOKUP, decodeSessionMessageRecord, sessionMessageFromEvent,
} from './message-record-codecs.js';
import { readMainWorkspace, type RoleLineSplitPort } from './role-line-operations.js';
import { createSessionActivityReader } from './session-activity.js';
import { readHandoffFence } from './session-handoff-fence.js';
import {
  CORE_OPERATION_BY_WORKSPACE_PHASE_LOOKUP, decodeSessionOperationRecord, operationRefKey, plainSessionRef,
  plainSessionRefKey, plainSessionRefToAggregate,
} from './session-record-codecs.js';

// --------------------------------------------------------------------------
// Too slow (v4 :2600-:2633, b06)
// --------------------------------------------------------------------------

export const ROLE_LINE_SLOW_MESSAGE_LIMIT = 10;
export const ROLE_LINE_SLOW_WINDOW_MS = 1_800_000;

export type RoleLineSlowV1 = { tooSlow: boolean; count: number; stretchStartedAt: string | null };

/** One input still waiting on its recipient: an `action_request`/`inquiry` the one consumption rule offers and no
 *  execution has accepted. `notify` never counts. */
function waitingInput(message: SessionMessage): boolean {
  return (message.intent === 'action_request' || message.intent === 'inquiry')
    && messageConsumptionProblem(messageFactsOfRecord(message)) === null
    && !(message.acceptedInputs ?? []).some((input) => input.part === 'message');
}

/**
 * The replay: after every step the backlog `n` is recomputed with the same predicate; the stretch starts at the
 * `≤10 → >10` step's `occurredAt` and resets on `>10 → ≤10`. Too slow only when that stretch is at least the window
 * old, so a message that waited long but only now takes the count over the limit does not trigger.
 */
export function roleLineSlowOf(input: {
  /** The recipient's commit-order steps: the store cursor, the event's `occurredAt`, the decoded message. */
  steps: readonly { cursor: CommitCursor; occurredAt: string; message: SessionMessage }[]; now: string;
}): RoleLineSlowV1 {
  const waiting = new Set<string>();
  let stretchStartedAt: string | null = null;
  for (const step of input.steps) {
    const key = canonicalKey(step.message.ref);
    if (waitingInput(step.message)) waiting.add(key);
    else waiting.delete(key);
    if (waiting.size > ROLE_LINE_SLOW_MESSAGE_LIMIT) stretchStartedAt ??= step.occurredAt;
    else stretchStartedAt = null;
  }
  const tooSlow = stretchStartedAt !== null
    && Date.parse(input.now) - Date.parse(stretchStartedAt) >= ROLE_LINE_SLOW_WINDOW_MS;
  return { tooSlow, count: waiting.size, stretchStartedAt };
}

// --------------------------------------------------------------------------
// The port
// --------------------------------------------------------------------------

export type RoleLineMaintenanceResultV1 = {
  scanned: number;
  failures: { sessionRef: SessionRef; rejection: CoreRejection }[];
};
/** The one line/positions/catalog read; the page and `propose_role_split`'s owner both validate on it. */
export type RoleLineSplitFactsV1 = {
  line: { session: SessionRef; duty: 'adviser' | 'scribe'; scopes: readonly RoleScopeV1[] };
  positions: readonly RoleLinePositionV1[];
  catalog: AdoptedArchitecture | null;
};
export interface RoleLineMaintenancePort extends RoleLineReclaimPort {
  maintain(ctx: CoreCallContext, input: { workspace: WorkspaceScope }):
    Promise<ReadResult<RoleLineMaintenanceResultV1>>;
  readSplitFacts(ctx: CoreCallContext, session: SessionRef): Promise<ReadResult<RoleLineSplitFactsV1>>;
}

type MaintenanceRecords = GoalRecordTransactionPort & RecordLookupPort & Pick<RecordOrderedLookupPort, 'lookupOrdered'>;

export type RoleLineMaintenanceDeps = {
  directory: Pick<SessionDirectoryPort, 'findSessions' | 'readSession'>;
  lifecycle: Pick<SessionLifecyclePort, 'archiveSession'>;
  duty: SessionDutyReadPort;
  /** O1b's one split starter/continuer; this module starts no operation itself. */
  splits: RoleLineSplitPort;
  /** 6B's shared handoff entry (`SessionHandoffWorkflowPort.startHandoff`). */
  handoff: {
    startHandoff(ctx: CoreCallContext, input: { source: SessionRef; basis: SecretaryHandoffBasisV1 }):
      Promise<ReadResult<HandoffProgressV1>>;
  };
  /** The one store: messages, operations, role-line records and the catalog. */
  records: MaintenanceRecords;
  /** The store's one commit-order event page (O1a). */
  eventPage: Pick<RecordEventPagePort, 'eventPage'>;
  /** 8A's observation state and file pages. */
  observed: Pick<ObservedArchitecturePort, 'observationState' | 'listFiles'>;
  /** `W/tasks/plan-readers.ts` `readGoal`. */
  readGoal(records: Pick<GoalRecordTransactionPort, 'readMany'>, goalRef: GoalRef):
    Promise<{ status: 'ready'; goal: GoalSnapshot; readThrough: CommitCursor | null } | CoreRejection>;
  /** `W/tasks/plan-readers.ts` `readGoalPhase` (`snapshot: null` is a confirmed absence). */
  readGoalPhase(records: GoalRecordTransactionPort, ref: GoalPhaseRef): Promise<{ status: 'ready';
    snapshot: GoalPhaseSnapshot | null; readThrough: CommitCursor | null; guard: RecordGuard } | CoreRejection>;
  /** `W/tasks/plan-readers.ts` `readGoalsByProject`: a project scope's goals. */
  readGoalsByProject(records: Pick<RecordLookupPort, 'lookup'>, projectId: string):
    Promise<{ status: 'ready'; goals: GoalSnapshot[]; readThrough: CommitCursor | null } | CoreRejection>;
  /** `W/tasks/secretary-handoff-basis.ts` `roleLineInputBasis`. */
  roleLineInputBasis(records: MaintenanceRecords, scope: WorkspaceScope, session: SessionRef,
    contextWindowTokens: number, tasks?: readonly TaskTriple[]): Promise<ReadResult<SecretaryHandoffBasisV1>>;
  /** The line's own role window (L-9); `null` when it cannot be read, and the basis then judges by 500000 alone. */
  contextWindowOf(ctx: CoreCallContext, role: RoleConfigurationRef): Promise<number | null>;
  bindings: Pick<InitializationBindingReadPort, 'readBindingByGoal'>;
  notes: NoteScopeReadPort;
  scribeTodos: Pick<NoteScribeTodoPort, 'readScribeTodos'>;
  plans: Pick<PlanTaskPort, 'queryTaskGraph'>;
  sessionFacts: Pick<SessionFactsPort, 'readSessionFacts'>;
  now(): string;
};

/** The page width over a workspace's active lines (o2b-start-rulings 21). */
const ROLE_LINE_PAGE_LIMIT = 100;
/** One replay read of the event store. */
const EVENT_PAGE_LIMIT = 500;
const RECLAIM_ARCHIVE_REASON = 'retained-cap reclaim: the seat goes to a new line of the same duty';

const ready = <T>(value: T): { status: 'ready'; value: T } => ({ status: 'ready', value });

/** Every non-ready answer of a read this module does not own becomes the caller's rejection. */
function maintenanceReadFailure(read: Exclude<ReadResult<unknown>, { status: 'ready' }>, what: string): CoreRejection {
  if (read.status === 'rejected') return read;
  return rejected('unavailable', `${what} is ${read.status === 'not_found' ? 'missing' : 'not ready'}`);
}

/** The line's current responsibility scopes: its open `responsible` links that name a role scope. */
function lineScopesOf(links: readonly SessionWorkLink[]): RoleScopeV1[] {
  return links.flatMap((link) => {
    if (link.until !== null || link.ref.relation !== 'responsible') return [];
    const scope = roleScopeOfTarget(link.ref.target);
    return scope === null ? [] : [scope];
  });
}

/** The line's own open `responsible` task links; the too-long basis reads their Work Runs. */
function responsibleTasksOf(links: readonly SessionWorkLink[]): TaskTriple[] {
  return links.flatMap((link) => link.until === null && link.ref.relation === 'responsible'
    && link.ref.target.kind === 'task' ? [link.ref.target.ref] : []);
}

function noteScopeOf(scope: RoleScopeV1): NoteScopeV1 {
  if (scope.kind === 'region') return { kind: 'region', moduleId: scope.moduleRef.moduleId };
  if (scope.kind === 'goal') return { kind: 'goal', goalId: scope.goalRef.goalId };
  return { kind: 'project' };
}

/** The region's direct child modules in the catalog's declared containment (none when it declares none). */
function childModulesOf(catalog: AdoptedArchitecture | null, moduleRef: ModuleRef): ModuleRef[] {
  return (catalog?.containment?.parentOf ?? []).filter((edge) => edge.parent.projectId === moduleRef.projectId
    && edge.parent.moduleId === moduleRef.moduleId).map((edge) => edge.child);
}

/** A task still being done: not satisfied, not cancelled, not superseded (the `B/session-archive.ts` reading). */
function taskOpen(row: TaskRow): boolean {
  return row.effectivePhase !== 'satisfied'
    && row.definition.disposition !== 'cancelled' && row.definition.disposition !== 'superseded';
}

type RegionObservation = Parameters<typeof regionPositionOf>[0]['observation'];
type ReclaimExclusions = { pendingCards: Set<string>; splitLines: Set<string> };

export function createRoleLineMaintenance(deps: RoleLineMaintenanceDeps): RoleLineMaintenancePort {
  const allocationRead = createAllocationRead({ records: deps.records });
  const activity = createSessionActivityReader({ records: deps.records });
  /** One in-memory cursor per workspace, reset on the last page; never stored (v4 :2687-:2688). */
  const cursors = new Map<string, string>();

  /** A line's duty through the one resolver, with the line's own workspace. */
  function lineDutyOf(ctx: CoreCallContext, record: SessionRecord): Promise<ReadResult<PlatformDutyV1 | 'unknown'>> {
    return deps.duty(record.role, { ...ctx, workspaceId: record.workspaceId });
  }

  // ------------------------------------------------------------------------
  // The backlog and the replay
  // ------------------------------------------------------------------------

  /** The recipient's current `n`: its messages read through the recipient index, judged by `waitingInput`. */
  async function backlogOf(session: SessionRecord): Promise<ReadResult<number>> {
    let items: readonly EncodedRecord[];
    try {
      items = (await lookupAll(deps.records, SESSION_MESSAGE_BY_RECIPIENT_LOOKUP,
        [session.ref.projectId, session.workspaceId, session.ref.sessionId])).items;
    } catch (error) {
      return rejected('unavailable', `the line's messages cannot be read: ${messageOf(error)}`);
    }
    let count = 0;
    for (const record of items) {
      const decoded = decodeSessionMessageRecord(record);
      if (decoded.status !== 'decoded') return rejected('unavailable', `a line message is damaged: ${decoded.reason}`);
      if (waitingInput(decoded.value)) count += 1;
    }
    return ready(count);
  }

  /** Too slow: the current backlog first; only a backlog already over the limit replays the event store from its
   *  first cursor (no stored start, no timer, no new index). */
  async function slowOf(session: SessionRecord): Promise<ReadResult<RoleLineSlowV1>> {
    const backlog = await backlogOf(session);
    if (backlog.status !== 'ready') return backlog;
    if (backlog.value <= ROLE_LINE_SLOW_MESSAGE_LIMIT) {
      return ready({ tooSlow: false, count: backlog.value, stretchStartedAt: null });
    }
    const steps: { cursor: CommitCursor; occurredAt: string; message: SessionMessage }[] = [];
    let after: CommitCursor | null = null;
    for (;;) {
      const page = await deps.eventPage.eventPage({ after, limit: EVENT_PAGE_LIMIT });
      // A damaged event or a unique-slot answer is the read's failure, never "not too slow".
      if (page.status !== 'ready') return rejected('unavailable', `the message events cannot be read: ${page.reason}`);
      for (const { cursor, event } of page.value.events) {
        // Only message events decode; the store already checked every event against its registered schema.
        const decoded = sessionMessageFromEvent(event);
        if (decoded.status !== 'decoded') continue;
        const recipient = decoded.value.recipient;
        if (!('sessionId' in recipient) || recipient.projectId !== session.ref.projectId
          || recipient.sessionId !== session.ref.sessionId) continue;
        steps.push({ cursor, occurredAt: event.occurredAt, message: decoded.value });
      }
      if (page.value.next === null) break;
      after = page.value.next;
    }
    return ready(roleLineSlowOf({ steps, now: deps.now() }));
  }

  // ------------------------------------------------------------------------
  // readSplitFacts
  // ------------------------------------------------------------------------

  /**
   * 8A's observation as the region rule reads it (o2b-start-rulings 1, lead RW1-2): no capture is `missing`; a failed
   * latest capture is `failed` (the older capture is not today's files); every file page read to the end of the cursor
   * is `ready` and complete (v4 :8852), since 8A's per-language `complete` is reference and parse coverage, not the
   * line counts the burden adds; a failed read is `incomplete`. Each answer but `ready` makes the region `unknown`.
   */
  async function regionObservationOf(ctx: CoreCallContext, workspace: WorkspaceScope): Promise<RegionObservation> {
    const state = await deps.observed.observationState(ctx, { workspace });
    if (state.status !== 'ready') return { status: 'incomplete' };
    const current = state.value.current;
    if (current === null) return { status: 'missing' };
    const auto = state.value.autoCapture;
    if (auto !== null && auto.status === 'failed' && auto.pending) return { status: 'failed' };
    const files: { path: string; nonBlankLines: number }[] = [];
    let cursor: string | null = null;
    for (;;) {
      const page = await deps.observed.listFiles(ctx, { captureRef: current.captureRef, cursor });
      if (page.status !== 'ready') return { status: 'incomplete' };
      for (const node of page.value.nodes) files.push({ path: node.path, nonBlankLines: node.nonBlankLines });
      if (page.value.nextCursor === null) break;
      cursor = page.value.nextCursor;
    }
    return { status: 'ready', complete: true, files };
  }

  /** The current catalog; `not_found` is a lawful "none adopted". */
  async function catalogOf(projectId: string): Promise<ReadResult<AdoptedArchitecture | null>> {
    const window = await readCurrentCatalogWindow(deps.records, projectId);
    if (window.status === 'ready') return ready(window.catalog.catalog);
    if (window.status === 'not_found') return ready(null);
    return rejected(window.code, window.reason);
  }

  /** An adviser's goal position: the Goal, its phase and its screening (o2b-start-rulings 8: the planner reads only
   *  `inProgress`, so no adviser links are read here). */
  async function goalPositionFor(ctx: CoreCallContext, goalRef: GoalRef): Promise<ReadResult<RoleLinePositionV1>> {
    const goal = await deps.readGoal(deps.records, goalRef);
    if (goal.status !== 'ready') return goal;
    const phase = await deps.readGoalPhase(deps.records,
      { aggregateType: 'GoalPhase', projectId: goalRef.projectId, goalId: goalRef.goalId });
    if (phase.status !== 'ready') return phase;
    const bindings = await deps.bindings.readBindingByGoal(ctx, { goalRef });
    if (bindings.status !== 'ready') return maintenanceReadFailure(bindings, 'the goal screening');
    const screening = bindings.value[0]?.screening ?? null;
    return ready({ kind: 'goal', goalRef, position: goalPositionOf({ goal: goal.goal, phase: phase.snapshot,
      screening, adviserLinks: [] }) });
  }

  async function readSplitFacts(ctx: CoreCallContext, session: SessionRef): Promise<ReadResult<RoleLineSplitFactsV1>> {
    const card = await deps.directory.readSession(ctx, session);
    if (card.status !== 'ready') return card;
    const duty = await deps.duty(card.value.record.role, ctx);
    if (duty.status !== 'ready') return duty;
    const counted = roleLineDutyOf(duty.value);
    if (counted !== 'adviser' && counted !== 'scribe') {
      return rejected('invalid', 'only an adviser or scribe line can be split');
    }
    const record = card.value.record;
    const line = { session: plainSessionRef(record.ref), duty: counted, scopes: lineScopesOf(card.value.links) };
    const catalog = await catalogOf(record.ref.projectId);
    if (catalog.status !== 'ready') return catalog;
    const regions = line.scopes.flatMap((scope) => scope.kind === 'region' ? [scope.moduleRef] : []);
    const children = regions.flatMap((moduleRef) => childModulesOf(catalog.value, moduleRef));
    const positions: RoleLinePositionV1[] = [];
    const seen = new Set<string>();
    if (counted === 'adviser') {
      for (const scope of line.scopes) {
        if (scope.kind !== 'goal') continue;
        const position = await goalPositionFor(ctx, scope.goalRef);
        if (position.status !== 'ready') return position;
        positions.push(position.value);
      }
      // Each region scope and each of its direct child modules: the planner reads a moved child's own position.
      if (regions.length > 0) {
        const observation = await regionObservationOf(ctx,
          { projectId: record.ref.projectId, workspaceId: record.workspaceId });
        for (const moduleRef of [...regions, ...children]) {
          const key = canonicalKey(moduleRef);
          if (seen.has(key)) continue;
          seen.add(key);
          positions.push({ kind: 'region', moduleRef,
            position: regionPositionOf({ moduleRef, catalog: catalog.value, observation }) });
        }
      }
    } else {
      // A scribe: each scope and each direct child module of its region scopes; an unreadable count is `null`.
      const scopes: RoleScopeV1[] = [...line.scopes,
        ...children.map((moduleRef): RoleScopeV1 => ({ kind: 'region', moduleRef }))];
      for (const scope of scopes) {
        const noteScope = noteScopeOf(scope);
        const key = canonicalKey(noteScope);
        if (seen.has(key)) continue;
        seen.add(key);
        const count = await deps.notes.countCurrentNotes(ctx, { scope: noteScope });
        positions.push({ kind: 'scribe', scope: noteScope, current: count.status === 'ready' ? count.value.current : null });
      }
    }
    return ready({ line, positions, catalog: catalog.value });
  }

  // ------------------------------------------------------------------------
  // maintain
  // ------------------------------------------------------------------------

  /** One line of the page: `null` when nothing needed doing or what it started answered ready, else the failure. */
  async function maintainLine(ctx: CoreCallContext, card: SessionCard): Promise<CoreRejection | null> {
    const record = card.record;
    const source = plainSessionRef(record.ref);
    const window = await deps.contextWindowOf(ctx, record.role);
    // L-9: with no readable window the same pure table answers its 500000 ceiling.
    const basis = await deps.roleLineInputBasis(deps.records,
      { projectId: record.ref.projectId, workspaceId: record.workspaceId }, source,
      window ?? Number.POSITIVE_INFINITY, responsibleTasksOf(card.links));
    if (basis.status !== 'ready') return maintenanceReadFailure(basis, 'the line input basis');
    const slow = await slowOf(record);
    if (slow.status !== 'ready') return maintenanceReadFailure(slow, 'the line backlog');
    const tooLong = basis.value.tooLong;
    const tooSlow = slow.value.tooSlow;
    // Book :401-:411: a line with no burden problem is not split by the platform, so its positions are not read.
    if (!tooLong && !tooSlow) return null;
    const facts = await readSplitFacts(ctx, source);
    if (facts.status !== 'ready') return maintenanceReadFailure(facts, 'the split facts');
    const plan = planRoleLineSplit({ ...facts.value, move: null, tooLong, tooSlow });
    if (plan !== null) {
      // O1b's ReadResult: `ready` means the operation exists (started or continued).
      const started = await deps.splits.startRoleLineSplit(ctx, { source, plan });
      return started.status === 'ready' ? null : maintenanceReadFailure(started, 'the role-line split');
    }
    if (tooLong) {
      const handed = await deps.handoff.startHandoff(ctx, { source, basis: basis.value });
      return handed.status === 'ready' ? null : maintenanceReadFailure(handed, 'the handoff');
    }
    // Too slow with no valid move: the line only shows its burden (decision 60-7).
    return null;
  }

  async function maintain(ctx: CoreCallContext, input: { workspace: WorkspaceScope }):
    Promise<ReadResult<RoleLineMaintenanceResultV1>> {
    const workspace = input.workspace;
    const cursorKey = canonicalKey({ projectId: workspace.projectId, workspaceId: workspace.workspaceId });
    const after = cursors.get(cursorKey);
    // The A1a paging: the last card's Session key, never the directory cursor (it binds the ledger head).
    const found = await deps.directory.findSessions(ctx, { workspace, includeArchived: false,
      page: { limit: ROLE_LINE_PAGE_LIMIT, ...(after === undefined ? {} : { afterSessionKey: after }) } });
    if (found.status !== 'ready') return found;
    const failures: RoleLineMaintenanceResultV1['failures'] = [];
    let scanned = 0;
    for (const card of found.value.items) {
      // O2B-R1-01: a read-only consultation copy inherits its source's duty but is no line.
      if (card.record.provenance.kind === 'readonly_copy') continue;
      const sessionRef = plainSessionRef(card.record.ref);
      const duty = await lineDutyOf(ctx, card.record);
      if (duty.status !== 'ready') {
        failures.push({ sessionRef, rejection: maintenanceReadFailure(duty, 'the line duty') });
        continue;
      }
      const counted = roleLineDutyOf(duty.value);
      if (counted !== 'adviser' && counted !== 'scribe') continue;
      scanned += 1;
      let failure: CoreRejection | null;
      try {
        failure = await maintainLine(ctx, card);
      } catch (error) {
        failure = rejected('unavailable', `the role-line maintenance failed for this line: ${messageOf(error)}`);
      }
      if (failure !== null) failures.push({ sessionRef, rejection: failure });
    }
    const items = found.value.items;
    const last = items[items.length - 1];
    if (found.value.nextCursor === null || last === undefined) cursors.delete(cursorKey);
    else cursors.set(cursorKey, plainSessionRefKey(last.record.ref));
    return ready({ scanned, failures });
  }

  // ------------------------------------------------------------------------
  // reclaimForAdmission
  // ------------------------------------------------------------------------

  /** The duty's active lines of the project, paged by the last card's Session key (the A1a precedent). Role lines
   *  live in the project's main workspace (v4 §2.2 item 4; O2B-R2-01), so a line of another workspace is neither
   *  counted toward the last line nor picked; with no main workspace the caller's workspace stands in (as L38). */
  async function linesOfDuty(ctx: CoreCallContext, projectId: string, duty: 'adviser' | 'scribe'):
    Promise<ReadResult<SessionCard[]>> {
    const main = await readMainWorkspace(deps.records, projectId);
    if (main.status !== 'ready') return main;
    const workspaceId = main.value ?? ctx.workspaceId;
    const lines: SessionCard[] = [];
    let afterSessionKey: string | undefined;
    for (;;) {
      const found = await deps.directory.findSessions(ctx, { workspace: { projectId }, includeArchived: false,
        page: { limit: ROLE_LINE_PAGE_LIMIT, ...(afterSessionKey === undefined ? {} : { afterSessionKey }) } });
      if (found.status !== 'ready') return found;
      for (const card of found.value.items) {
        afterSessionKey = plainSessionRefKey(card.record.ref);
        // O2B-R1-01: a read-only copy is never counted toward the last line nor picked.
        if (card.record.provenance.kind === 'readonly_copy') continue;
        if (card.record.workspaceId !== workspaceId) continue;
        const read = await lineDutyOf(ctx, card.record);
        if (read.status !== 'ready') return read;
        if (read.value === duty) lines.push(card);
      }
      if (found.value.nextCursor === null || found.value.items.length === 0) break;
    }
    return ready(lines);
  }

  /**
   * The unfinished operations of the lines' workspaces, read once: a handoff source whose approval card is still
   * pending (exclusion (c)) and both lines of an unfinished split (exclusion (d), o2b-start-rulings 11: reclaiming the
   * source mid-split fails its link step and releases its scope; the new line is the split's own).
   */
  async function unfinishedExclusionsOf(projectId: string, workspaceIds: readonly string[]):
    Promise<ReadResult<ReclaimExclusions>> {
    const pendingCards = new Set<string>();
    const splitLines = new Set<string>();
    for (const workspaceId of workspaceIds) {
      for (const phase of ['accepted', 'running'] as const) {
        let items: readonly EncodedRecord[];
        try {
          items = (await lookupAll(deps.records, CORE_OPERATION_BY_WORKSPACE_PHASE_LOOKUP,
            [projectId, workspaceId, phase])).items;
        } catch (error) {
          return rejected('unavailable', `the unfinished operations cannot be read: ${messageOf(error)}`);
        }
        for (const encoded of items) {
          const decoded = decodeSessionOperationRecord(encoded);
          if (decoded.status !== 'decoded') {
            return rejected('unavailable', `an unfinished operation is damaged: ${decoded.reason}`);
          }
          const action = decoded.value.action;
          if (action.kind === 'handoff' && action.progress.approval?.state === 'pending') {
            pendingCards.add(plainSessionRefKey(action.input.source));
          }
          if (action.kind !== 'role_line' || action.action !== 'role_line_split') continue;
          if (action.split !== undefined && action.split !== null) splitLines.add(plainSessionRefKey(action.split.source));
          const child = action.steps[0]?.childOperation ?? null;
          if (child === null) continue;
          const key = operationRefKey(child);
          const read = await deps.records.readMany([key]);
          if (read.status !== 'ready') {
            return rejected('unavailable', `the split's line create cannot be read: ${read.reason}`);
          }
          const stored = read.value.records.find((entry) => entry.refKey === key);
          if (stored === undefined) continue;
          const create = decodeSessionOperationRecord(stored);
          if (create.status !== 'decoded') {
            return rejected('unavailable', `the split's line create is damaged: ${create.reason}`);
          }
          if (create.value.action.kind === 'create') splitLines.add(plainSessionRefKey(create.value.action.plannedSessionRef));
        }
      }
    }
    return ready({ pendingCards, splitLines });
  }

  /** The goals a line's scope covers: its goal scopes, and every goal not cancelled for a project scope. */
  async function goalsInScope(projectId: string, scopes: readonly RoleScopeV1[]): Promise<ReadResult<GoalRef[]>> {
    const goals = scopes.flatMap((scope) => scope.kind === 'goal' ? [scope.goalRef] : []);
    if (!scopes.some((scope) => scope.kind === 'project')) return ready(goals);
    const project = await deps.readGoalsByProject(deps.records, projectId);
    if (project.status !== 'ready') return project;
    const held = new Set(goals.map((goal) => goal.goalId));
    for (const goal of project.goals) {
      if (goal.desiredState !== 'cancelled' && !held.has(goal.ref.goalId)) goals.push(goal.ref);
    }
    return ready(goals);
  }

  /**
   * An in-progress task in scope (o2b-start-rulings 10): a goal of the scope with an open task, or one of the line's
   * own open task links whose task is open (a region scope's tasks). A linked task its graph does not name is unsure,
   * and an unsure read counts as busy.
   */
  async function inProgressTaskOf(ctx: CoreCallContext, goals: readonly GoalRef[], links: readonly SessionWorkLink[]):
    Promise<ReadResult<boolean>> {
    const taskLinks = links.flatMap((link) => link.until === null && link.ref.target.kind === 'task'
      ? [link.ref.target.ref] : []);
    const scopeGoals = new Set(goals.map((goal) => goal.goalId));
    const graphGoals = new Map<string, GoalRef>(goals.map((goal) => [goal.goalId, goal]));
    for (const task of taskLinks) {
      if (!graphGoals.has(task.goalId)) {
        graphGoals.set(task.goalId, { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId });
      }
    }
    for (const goalRef of graphGoals.values()) {
      const linked = taskLinks.filter((task) => task.goalId === goalRef.goalId);
      const graph = await deps.plans.queryTaskGraph(ctx, { goalRef });
      if (graph.status === 'not_found' && linked.length === 0) continue;   // a goal with no plan has no task
      if (graph.status !== 'ready') return maintenanceReadFailure(graph, 'the task graph');
      if (scopeGoals.has(goalRef.goalId) && graph.value.tasks.some(taskOpen)) return ready(true);
      for (const task of linked) {
        const row = graph.value.tasks.find((candidate) => candidate.ref.taskId === task.taskId);
        if (row === undefined) return rejected('unavailable', 'a linked task is not in its goal graph');
        if (taskOpen(row)) return ready(true);
      }
    }
    return ready(false);
  }

  /**
   * A line that holds an active goal through an open responsible goal link works for that goal even before the goal
   * has a plan or a task (o4a ruling 51): reclaiming it would leave the goal with no adviser and outside the adviser
   * queue. A paused, cancelled or formally completed goal does not keep the line; a failed read keeps it (not idle).
   */
  async function holdsActiveGoalOf(links: readonly SessionWorkLink[]): Promise<ReadResult<boolean>> {
    for (const link of links) {
      if (link.until !== null || link.ref.relation !== 'responsible' || link.ref.target.kind !== 'goal') continue;
      const goalRef = link.ref.target.ref;
      const goal = await deps.readGoal(deps.records, goalRef);
      if (goal.status !== 'ready') return goal;
      if (goal.goal.desiredState !== 'active') continue;
      const phase = await deps.readGoalPhase(deps.records,
        { aggregateType: 'GoalPhase', projectId: goalRef.projectId, goalId: goalRef.goalId });
      if (phase.status !== 'ready') return phase;
      if (phase.snapshot === null) return ready(true);
    }
    return ready(false);
  }

  /** A pending-review note in scope: its goals' buckets, and every bucket for a project scope. */
  async function pendingNoteOf(ctx: CoreCallContext, goals: readonly GoalRef[], project: boolean):
    Promise<ReadResult<boolean>> {
    if (goals.length === 0 && !project) return ready(false);
    const todos = await deps.scribeTodos.readScribeTodos(ctx, { goalIds: goals.map((goal) => goal.goalId) });
    if (todos.status !== 'ready') return maintenanceReadFailure(todos, 'the scribe to-dos');
    const goalIds = new Set(goals.map((goal) => goal.goalId));
    return ready(todos.value.some((bucket) => bucket.pending.length > 0
      && (project || (bucket.goalId !== null && goalIds.has(bucket.goalId)))));
  }

  /** The six facts read whole plus the exclusions; any read that fails leaves the line `readable: false`. */
  async function idleFactsOf(ctx: CoreCallContext, card: SessionCard, duty: 'adviser' | 'scribe', lineCount: number,
    exclusions: ReclaimExclusions): Promise<RoleLineIdleFactsV1> {
    const session = plainSessionRef(card.record.ref);
    const key = plainSessionRefKey(session);
    const lineCtx: CoreCallContext = { ...ctx, workspaceId: card.record.workspaceId };
    // An unread fact keeps its not-idle value; `readable: false` is the verdict either way.
    const unread: RoleLineIdleFactsV1 = {
      session, duty, lastActivityAt: card.record.createdAt,
      occupancy: card.record.occupancy === null ? 'none' : 'held',
      unacceptedInput: true, handoffFenceOpen: true, inProgressTaskInScope: true, pendingNoteInScope: true,
      openQuestionSent: true, pendingDecisionCard: exclusions.pendingCards.has(key),
      lastUnarchivedOfDuty: lineCount === 1, unfinishedSplitLine: exclusions.splitLines.has(key), readable: false,
    };
    const activityRead = await activity.readSessionActivity(lineCtx, { session });
    if (activityRead.status !== 'ready') return unread;
    const backlog = await backlogOf(card.record);
    if (backlog.status !== 'ready') return unread;
    const fence = await readHandoffFence(deps.records, lineCtx, session);
    if (fence.status !== 'ready') return unread;
    const scopes = lineScopesOf(card.links);
    const goals = await goalsInScope(session.projectId, scopes);
    if (goals.status !== 'ready') return unread;
    const inProgress = await inProgressTaskOf(lineCtx, goals.value, card.links);
    if (inProgress.status !== 'ready') return unread;
    const heldGoal = inProgress.value ? ready(true) : await holdsActiveGoalOf(card.links);
    if (heldGoal.status !== 'ready') return unread;
    const pendingNote = await pendingNoteOf(lineCtx, goals.value, scopes.some((scope) => scope.kind === 'project'));
    if (pendingNote.status !== 'ready') return unread;
    const facts = await deps.sessionFacts.readSessionFacts(lineCtx, session);
    if (facts.status !== 'ready') return unread;
    return {
      ...unread,
      lastActivityAt: activityRead.value.lastActivityAt,
      unacceptedInput: backlog.value > 0,
      handoffFenceOpen: fence.value.held,
      // an active goal held through an open goal link counts as work in scope, a plan or not
      inProgressTaskInScope: inProgress.value || heldGoal.value,
      pendingNoteInScope: pendingNote.value,
      openQuestionSent: facts.value.waits.some((wait) => wait.state.state === 'open'),
      readable: true,
    };
  }

  async function reclaimForAdmission(ctx: CoreCallContext, input: { projectRef: ProjectScope; duty: RoleLineDutyV1 }):
    Promise<ReadResult<ReclaimSeatV1 | null>> {
    // Decision 91: the reclaim is adviser/scribe only.
    if (input.duty !== 'adviser' && input.duty !== 'scribe') return ready(null);
    const duty = input.duty;
    const lines = await linesOfDuty(ctx, input.projectRef.projectId, duty);
    if (lines.status !== 'ready') return lines;
    // Exclusion (a): the last unarchived line of the duty is never the one, so a lone line reads nothing more.
    if (lines.value.length < 2) return ready(null);
    const workspaceIds = [...new Set(lines.value.map((card) => card.record.workspaceId))];
    const exclusions = await unfinishedExclusionsOf(input.projectRef.projectId, workspaceIds);
    if (exclusions.status !== 'ready') return exclusions;
    const facts: RoleLineIdleFactsV1[] = [];
    for (const card of lines.value) {
      facts.push(await idleFactsOf(ctx, card, duty, lines.value.length, exclusions.value));
    }
    const chosen = reclaimIdleLineOf({ duty, lines: facts });
    if (chosen === null) return ready(null);
    const workspaceId = lines.value.find((card) => card.record.ref.sessionId === chosen.sessionId)!.record.workspaceId;
    const lineCtx: CoreCallContext = { ...ctx, workspaceId };
    const card = await deps.directory.readSession(lineCtx, chosen);
    if (card.status !== 'ready') return card;
    // TS-9 item 3: the line's own operation rides to the archive owner's one capacity close.
    const origin = card.value.roleFacts?.originOperation ?? undefined;
    const revision = card.value.record.revision;
    const archived = await deps.lifecycle.archiveSession(lineCtx, {
      input: { sessionRef: chosen, reason: RECLAIM_ARCHIVE_REASON },
      meta: { requestId: `role-line-reclaim:${chosen.sessionId}:${String(revision)}`,
        expected: [{ ref: plainSessionRefToAggregate(chosen), revision }] },
    }, origin === undefined ? undefined : { operation: origin });
    // An archive that did not commit leaves the seat as it was, so the at-cap refusal stands.
    if (archived.status !== 'committed') return ready(null);
    const seat = await allocationRead.readAllocationForCommit(ctx, { projectRef: input.projectRef, duty });
    if (seat.status !== 'ready') return seat;
    return ready({ reclaimed: chosen, allocation: seat.value.allocation, limits: seat.value.limits,
      allocationGuard: seat.value.allocationGuard, limitsGuard: seat.value.limitsGuard });
  }

  return { maintain, readSplitFacts, reclaimForAdmission };
}
