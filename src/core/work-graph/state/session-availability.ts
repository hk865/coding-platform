/**
 * Session machine (docs/refactor/STATE-MACHINES-SPEC.md §8): lifecycle ×
 * health × occupancy, with the read-only `availability` derived from them.
 *
 * This file owns the occupancy generation rule, the holder check shared by
 * claim, entry, Query execution, lifecycle and reconcile (D-10), every
 * constructor allowed to write a Session's lifecycle fields (§14.1) and
 * `transitionSession` (SES-01..SES-19). The QueryRun settle sub-machine (QRR
 * rows) lives in `query-run-recovery.ts`.
 *
 * Rows whose 现状 is 新增 — SES-05, SES-06, SES-07, SES-09, SES-10 (releases
 * that only exist once D-7 stop, reconcile and human attestation land) and
 * SES-12, SES-13, SES-19 (health observation) — are not reachable yet: their
 * events stay in the unions, the §8.4 refusals in front of them already
 * apply, and the row itself answers `illegal`/`invalid` (the §1.2 default)
 * until §15.2 step 5 adds it.
 *
 * Pure: imports only `src/contracts` and this directory (§14.4).
 */
import type { ExecutionRef, RoleConfigurationRef, SessionAggregateRef } from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { SessionHealthConclusion, SessionRecord } from '../../../contracts/core/session.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import type { QueryExecutionStateV1, QueryRunRef } from '../../../contracts/query-job.js';
import { accept, notYet, reject, unreachable, type Transition } from './transition.js';

// --------------------------------------------------------------------------
// State, events, guard context and effects (§8.1, §8.2)
// --------------------------------------------------------------------------

export type SessionLifecycle = SessionRecord['lifecycle'];
export type SessionHealth = SessionRecord['health'];
/** Derived, never persisted (`SessionCard.availability`, `sessions/contracts.ts:46`). */
export type SessionAvailability = 'idle' | 'busy' | 'recoverable' | 'unavailable';
export type SessionHolderRef = RunRef | QueryRunRef | OperationRef;
export type SessionMachineOccupancy = { kind: 'execution' | 'maintenance'; holder: SessionHolderRef; generation: number };

export type SessionMachineState = 'absent' | {
  lifecycle: SessionLifecycle;
  health: SessionHealth;
  /** SD-2: why health is unavailable; null whenever health is available. */
  healthConclusion: SessionHealthConclusion | null;
  occupancy: SessionMachineOccupancy | null;
  revision: number;
};

/** Probe conclusions (§8.2): only `missing`/`damaged` are deterministic data states (SD-2). */
export type SessionProbeVerdict = 'ready' | 'missing' | 'damaged' | 'host_config' | 'transient' | 'cancelled';

/** The holder machine's node folded for the Session guards (§6: Ended/YieldedWait → run_ended). */
export type HolderPhase =
  | 'run_starting' | 'run_running' | 'run_ended' | 'run_ended_unknown'
  | 'query_claimed' | 'query_prepared' | 'query_entering' | 'query_entered' | 'query_unknown' | 'query_settled';

export type SessionHolderContext = {
  ref: RunRef | QueryRunRef;
  /** Run: `claim.generation`; QueryRun: `executionState.sessionGeneration`. */
  claimGeneration: number;
  before: HolderPhase;
  /** The holder machine's `to` in the same commit. */
  after: HolderPhase;
  /** The Kernel already holds a Turn of this execution. */
  kernelTurnSeen: boolean;
  /** §10.3: every `run.input_accepted` of the Turn is confirmed. */
  inputsConfirmed: boolean | 'kernel_unreadable';
  /** Cursor of the complete ended-Turn boundary, null without one. */
  historyBoundaryCursor: string | null;
  /** The Kernel Turn of this execution exists without a Kernel terminal (SD-2, LA-1). */
  kernelTurnOpen: boolean;
};

export type SessionGuardContext = {
  /** `reconcile` = Host start reconcile; `health_observed` and restart releases accept only it. */
  caller: 'service' | 'reconcile';
  /** D-18; required for reconcile and human attestation (L-1). An unreadable lock file is `held_by_other` (L-10). */
  hostLease: 'owned' | 'held_by_other' | null;
  /** The caller's Session version pin (occupancy, lifecycle and link events); null = no pin to compare. */
  pin: number | null;
  /** Only for `occupancy_released`: the releasing holder. */
  holder: SessionHolderContext | null;
  /** Only for `health_observed`. */
  probe: SessionProbeVerdict | null;
  /** Only for `health_observed`: the Kernel session head a `ready` probe read; null for other verdicts. */
  kernelHeader: null | { activeRunId: string | null };
  /**
   * Only for `session_archived`: the target kind of the first open
   * `responsible` task/work link, which the refusal names as today's service
   * reason does; false without one; null = not read.
   */
  openResponsibleLink: 'task' | 'work' | false | null;
  /** Only for `session_created`. */
  creation: null | { operationAcceptedAt1: boolean; plannedAbsent: boolean; mappingUnique: boolean; linkTargetsValid: boolean };
  /**
   * Only for `work_linked`. `pin` is the caller's link version pin; the owner
   * service keeps it as the link's guard in the same commit (the machine has
   * no current link revision to compare it with).
   */
  link: null | { exists: boolean; open: boolean; targetValid: boolean; pin: number | null };
};

/**
 * Which holder transition carries an `occupancy_released` (§8.2 trigger
 * table). The holder machine names it; the cause selects the SES row.
 */
export type SessionReleaseCause =
  | 'terminal_observed'                                          // RUN-07 → SES-04
  | 'stop_not_entered'                                           // RUN-09 → SES-05 (新增)
  | 'reconcile_terminal' | 'reconcile_interrupted_clean'         // RUN-17/18/19/24 → SES-06 (新增)
  | 'late_evidence' | 'stop_paused'                              // RUN-21/23 → SES-06 (新增)
  | 'unknown_attested'                                           // RUN-22 → SES-07 (新增)
  | 'query_terminal_observed' | 'query_reconcile_terminal'       // QRR-03 → SES-08
  | 'query_reconcile_not_entered' | 'query_reconcile_interrupted_clean' // QRR-01/02/04 → SES-09 (新增)
  | 'query_unknown_attested';                                    // QRR-06 → SES-10 (新增)

export const SESSION_RELEASE_CAUSES: readonly SessionReleaseCause[] = Object.freeze([
  'terminal_observed', 'stop_not_entered', 'reconcile_terminal', 'reconcile_interrupted_clean', 'late_evidence',
  'stop_paused', 'unknown_attested', 'query_terminal_observed', 'query_reconcile_terminal',
  'query_reconcile_not_entered', 'query_reconcile_interrupted_clean', 'query_unknown_attested',
]);

/**
 * Session events (§8.2). Times, ids and pins never come from the machine: the
 * service passes them in the guard context or keeps them for the record
 * constructors. `occupancy_released` takes the holder identity and its facts
 * from `ctx.holder`.
 */
export type SessionEvent =
  | { kind: 'session_created' }
  | { kind: 'occupancy_acquired'; holder: SessionHolderRef }
  | { kind: 'occupancy_released'; cause: SessionReleaseCause }
  | { kind: 'session_archived' }
  | { kind: 'session_reactivated' }
  | { kind: 'health_observed'; observed: SessionHealth }
  | { kind: 'work_linked'; active: boolean };

/** A release moves `historyCursor` only to a complete Turn boundary; otherwise it keeps the old value (never null). */
export type SessionHistoryCursorUpdate = { kind: 'advance'; cursor: string } | { kind: 'keep' };
export type SessionOccupation = { holder: ExecutionRef; generation: number };
/**
 * A release that leaves the Kernel Turn open has no Turn boundary: it writes
 * `kernel_turn_open` and keeps `historyCursor` (§14.5; SES-06 for RUN-19/23/24,
 * SES-07, SES-09 for QRR-04, SES-10), so it carries no `advance`.
 */
export type SessionRelease = SessionOccupation & (
  | { kernelTurnOpen: false; historyCursor: SessionHistoryCursorUpdate }
  | { kernelTurnOpen: true; historyCursor: { kind: 'keep' } }
);
export type SessionHealthObservation =
  | { health: 'available'; conclusion: null }
  | { health: 'unavailable'; conclusion: 'missing' | 'damaged' };
export type SessionDomainEventType =
  | 'SessionCreated' | 'SessionArchived' | 'SessionReactivated' | 'SessionHealthObserved' | 'SessionWorkLinkChanged';

/**
 * Same-commit intents the owner service translates into records and events.
 * Every Session lifecycle field goes through the constructor named here.
 */
export type SessionEffect =
  | { kind: 'create_session' }                                   // createSessionRecord (rev 1)
  | { kind: 'complete_creation_operation' }                      // SessionOperation accepted@1 → completed@2
  | { kind: 'write_initial_links' }                              // each initial SessionWorkLink@1, since bound to the commit cursor
  | ({ kind: 'occupy_session' } & SessionOccupation)             // occupySessionRecord
  | ({ kind: 'release_session' } & SessionRelease)               // releaseSessionRecord
  | { kind: 'archive_session' }                                  // archiveSessionRecord(record, now)
  | { kind: 'reactivate_session' }                               // reactivateSessionRecord
  | ({ kind: 'observe_health' } & SessionHealthObservation)      // observeSessionHealthRecord
  | { kind: 'bump_session_revision' }                            // link rows: rev+1, dimensions unchanged
  | { kind: 'write_work_link'; bound: 'since' | 'until' }        // SessionWorkLink rev+1, the bound field takes the commit cursor
  | { kind: 'emit_event'; eventType: SessionDomainEventType };

export type SessionTransition = Transition<SessionMachineState, SessionEvent, SessionEffect>;

// --------------------------------------------------------------------------
// Shared rules: generation, holder check, availability (§8.1)
// --------------------------------------------------------------------------

export type OccupancyGeneration =
  | { ok: true; generation: number }
  | { ok: false; code: 'unavailable' | 'invalid'; detail: string };

/**
 * `generation = revision + 1`, and the occupying commit sets the revision to
 * it, so generations of one Session strictly increase and never repeat
 * (`claim-service.ts:544-546`, `query-execution.ts:718-720`).
 */
export function nextOccupancyGeneration(revision: number): OccupancyGeneration {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    return { ok: false, code: 'unavailable', detail: 'the target Session revision is not readable' };
  }
  const generation = revision + 1;
  if (!Number.isSafeInteger(generation)) {
    return { ok: false, code: 'invalid', detail: 'the Session generation would not be a safe integer' };
  }
  return { ok: true, generation };
}

/**
 * The holder check (today copied at `execution-entry-service.ts:1625-1628` and
 * `query-execution.ts:935-938`): an execution occupancy of exactly this ref at
 * the holder's claim generation. Lifecycle and health are not looked at;
 * those checks and their codes stay with each caller.
 */
export function ownsOccupancy(session: Pick<SessionRecord, 'occupancy'>, holder: ExecutionRef, generation: number): boolean {
  const occupancy = session.occupancy;
  return occupancy !== null && occupancy.kind === 'execution'
    && sameRef(occupancy.executionRef, holder) && occupancy.generation === generation;
}

/** `ownsOccupancy` for a QueryRun at the generation its claim fixed. */
export function ownsQuery(
  session: Pick<SessionRecord, 'occupancy'>, queryRunRef: QueryRunRef, state: Pick<QueryExecutionStateV1, 'sessionGeneration'>,
): boolean {
  return ownsOccupancy(session, queryRunRef, state.sessionGeneration);
}

/**
 * Reduction order moved from the former `availabilityOf` in
 * `session-directory.ts`, which now reads every card's availability here:
 * archived or unavailable → unavailable; else occupied → busy; else
 * recoverable; else idle.
 */
export function deriveAvailability(session: {
  lifecycle: SessionLifecycle; health: SessionHealth; occupancy: object | null;
}): SessionAvailability {
  if (session.lifecycle === 'archived' || session.health === 'unavailable') return 'unavailable';
  if (session.occupancy !== null) return 'busy';
  if (session.health === 'recoverable') return 'recoverable';
  return 'idle';
}

/** The machine state of a decoded record; a missing record is `absent`. */
export function sessionMachineStateOf(record: SessionRecord | null): SessionMachineState {
  if (record === null) return 'absent';
  const occupancy = record.occupancy;
  return {
    lifecycle: record.lifecycle,
    health: record.health,
    healthConclusion: record.healthConclusion ?? null,
    occupancy: occupancy === null ? null
      : occupancy.kind === 'execution'
        ? { kind: 'execution', holder: occupancy.executionRef, generation: occupancy.generation }
        : { kind: 'maintenance', holder: occupancy.operationRef, generation: occupancy.generation },
    revision: record.revision,
  };
}

// --------------------------------------------------------------------------
// Record constructors (§8.6, §14.1). They produce only legal combinations and
// throw on a call no machine row allows.
// --------------------------------------------------------------------------

export type NewSessionRecordInput = {
  ref: SessionAggregateRef;
  kernel: SessionRecord['kernel'];
  role: RoleConfigurationRef;
  workspaceId: string;
  createdAt: string;
};

/** SES-01: `active / available / null` at revision 1; no `healthConclusion` field (absent reads as null). */
export function createSessionRecord(input: NewSessionRecordInput): SessionRecord {
  return {
    ref: input.ref,
    revision: 1,
    kernel: { adapterId: input.kernel.adapterId, kernelSessionId: input.kernel.kernelSessionId },
    lifecycle: 'active',
    health: 'available',
    role: input.role,
    workspaceId: input.workspaceId,
    lastExecutionRef: null,
    occupancy: null,
    historyCursor: null,
    createdAt: input.createdAt,
    archivedAt: null,
  };
}

/**
 * SES-02/03: the occupying commit sets `revision` to the generation and
 * `lastExecutionRef` to the holder. Only an active, available, unoccupied
 * Session (so never `kernel_turn_open`, which implies unavailable).
 */
export function occupySessionRecord(record: SessionRecord, occupation: SessionOccupation): SessionRecord {
  if (record.lifecycle !== 'active') throw new Error('occupySessionRecord: an archived Session cannot be occupied');
  if (record.health !== 'available') throw new Error('occupySessionRecord: only an available Session can be occupied');
  if (record.occupancy !== null) throw new Error('occupySessionRecord: the Session is already occupied');
  const next = nextOccupancyGeneration(record.revision);
  if (!next.ok || next.generation !== occupation.generation) {
    throw new Error('occupySessionRecord: the generation must be the Session revision + 1');
  }
  return {
    ...record,
    revision: occupation.generation,
    lastExecutionRef: occupation.holder,
    occupancy: { kind: 'execution', executionRef: occupation.holder, generation: occupation.generation },
  };
}

/**
 * SES-04..SES-10: the holder's own release. `historyCursor` moves only to a
 * complete Turn boundary and is otherwise left untouched (writing null would
 * send the next Run back to `current_turn`). `kernelTurnOpen` also writes
 * `unavailable/kernel_turn_open` in the same record (SD-2, LA-1) and always
 * keeps the cursor (§14.5); it overwrites a `missing`/`damaged` conclusion
 * (SES-07 with an unreadable Kernel).
 */
export function releaseSessionRecord(record: SessionRecord, release: SessionRelease): SessionRecord {
  if (!ownsOccupancy(record, release.holder, release.generation)) {
    throw new Error('releaseSessionRecord: only the current holder at its claim generation releases the Session');
  }
  const cursorUpdate: SessionHistoryCursorUpdate = release.historyCursor;
  if (release.kernelTurnOpen && cursorUpdate.kind !== 'keep') {
    throw new Error('releaseSessionRecord: a release that leaves the Kernel Turn open keeps historyCursor');
  }
  const historyCursor = cursorUpdate.kind === 'advance' ? cursorUpdate.cursor : record.historyCursor;
  const released: SessionRecord = {
    ...record,
    revision: record.revision + 1,
    occupancy: null,
    lastExecutionRef: release.holder,
    historyCursor,
  };
  if (!release.kernelTurnOpen) return released;
  return { ...released, health: 'unavailable', healthConclusion: 'kernel_turn_open' };
}

/** SES-11: lifecycle only; health, history and links are untouched. */
export function archiveSessionRecord(record: SessionRecord, archivedAt: string): SessionRecord {
  if (record.lifecycle === 'archived') throw new Error('archiveSessionRecord: the Session is already archived');
  if (record.occupancy !== null) throw new Error('archiveSessionRecord: an occupied Session cannot be archived');
  return { ...record, revision: record.revision + 1, lifecycle: 'archived', archivedAt };
}

/** SES-14: lifecycle only; availability then follows the unchanged health. */
export function reactivateSessionRecord(record: SessionRecord): SessionRecord {
  if (record.lifecycle === 'active') throw new Error('reactivateSessionRecord: the Session is already active');
  return { ...record, revision: record.revision + 1, lifecycle: 'active', archivedAt: null };
}

/**
 * SES-12/13: writes or clears the conclusion with the health; occupancy and
 * lifecycle are untouched. `kernel_turn_open` is never written here (only
 * by `releaseSessionRecord`); clearing it here is SES-13's job. SES-12 starts
 * from `available` and SES-13 from `unavailable`: a same-value observation is
 * SES-19 and writes nothing (so a `missing`/`damaged` probe never replaces
 * `kernel_turn_open`), and `recoverable` has no writer (D-17).
 */
export function observeSessionHealthRecord(record: SessionRecord, observation: SessionHealthObservation): SessionRecord {
  if (record.lifecycle !== 'active') throw new Error('observeSessionHealthRecord: an archived Session is not probed');
  if (record.health === observation.health) {
    throw new Error(`observeSessionHealthRecord: a same-value ${observation.health} observation is SES-19 and writes nothing`);
  }
  if (record.health === 'recoverable') throw new Error('observeSessionHealthRecord: recoverable has no writer (D-17)');
  if (observation.health === 'available') {
    return { ...record, revision: record.revision + 1, health: 'available', healthConclusion: null };
  }
  if (observation.conclusion !== 'missing' && observation.conclusion !== 'damaged') {
    throw new Error('observeSessionHealthRecord: an unavailable observation needs a missing or damaged probe');
  }
  return { ...record, revision: record.revision + 1, health: 'unavailable', healthConclusion: observation.conclusion };
}

// --------------------------------------------------------------------------
// transitionSession (§8.3, §8.4)
// --------------------------------------------------------------------------

type ActiveState = Exclude<SessionMachineState, 'absent'>;
type SesRow = 'SES-04' | 'SES-05' | 'SES-06' | 'SES-07' | 'SES-08' | 'SES-09' | 'SES-10';

/**
 * Release cause table (§8.2 trigger table). `source`: K = in-process Kernel
 * observation, R = Host start reconcile only, KR = either, U = an intent.
 * `turn: 'always'` means a Kernel Turn exists by definition of the cause, so
 * the §10.3 input confirmation is required; otherwise it follows
 * `kernelTurnSeen`. `attested` = human attestation (L-1 lease; an unreadable
 * Kernel is allowed).
 */
const RELEASE_CAUSES: Readonly<Record<SessionReleaseCause, {
  row: SesRow; holder: 'Run' | 'QueryRun'; source: 'K' | 'R' | 'KR' | 'U'; turn: 'always' | 'per_holder'; attested: boolean;
}>> = {
  terminal_observed: { row: 'SES-04', holder: 'Run', source: 'K', turn: 'always', attested: false },
  stop_not_entered: { row: 'SES-05', holder: 'Run', source: 'U', turn: 'per_holder', attested: false },
  reconcile_terminal: { row: 'SES-06', holder: 'Run', source: 'R', turn: 'always', attested: false },
  reconcile_interrupted_clean: { row: 'SES-06', holder: 'Run', source: 'R', turn: 'always', attested: false },
  late_evidence: { row: 'SES-06', holder: 'Run', source: 'KR', turn: 'always', attested: false },
  stop_paused: { row: 'SES-06', holder: 'Run', source: 'KR', turn: 'always', attested: false },
  unknown_attested: { row: 'SES-07', holder: 'Run', source: 'U', turn: 'per_holder', attested: true },
  query_terminal_observed: { row: 'SES-08', holder: 'QueryRun', source: 'K', turn: 'always', attested: false },
  query_reconcile_terminal: { row: 'SES-08', holder: 'QueryRun', source: 'R', turn: 'always', attested: false },
  query_reconcile_not_entered: { row: 'SES-09', holder: 'QueryRun', source: 'R', turn: 'per_holder', attested: false },
  query_reconcile_interrupted_clean: { row: 'SES-09', holder: 'QueryRun', source: 'R', turn: 'always', attested: false },
  query_unknown_attested: { row: 'SES-10', holder: 'QueryRun', source: 'U', turn: 'per_holder', attested: true },
};

/** Holder nodes before the holder's own end: no release can be carried from them (§8.4). */
const PENDING_PHASES: ReadonlySet<HolderPhase> = new Set<HolderPhase>([
  'run_starting', 'run_running', 'query_claimed', 'query_prepared', 'query_entering', 'query_entered',
]);
/** Probe verdicts that prove nothing: no reconcile release or health write this start-up (SD-2, §8.4); the Run machine shares them. */
export const INCONCLUSIVE_PROBES: ReadonlySet<SessionProbeVerdict> = new Set<SessionProbeVerdict>(['host_config', 'transient', 'cancelled']);

export function transitionSession(state: SessionMachineState, event: SessionEvent, ctx: SessionGuardContext): SessionTransition {
  if (state === 'absent') {
    if (event.kind === 'session_created') return created(ctx);
    return reject('illegal', 'not_found', 'the target Session does not exist');
  }
  switch (event.kind) {
    case 'session_created':
      return reject('stale', 'revision_conflict', 'the planned Session reference is already registered');
    case 'occupancy_acquired':
      return acquired(state, event.holder, ctx);
    case 'occupancy_released':
      return released(state, event.cause, ctx);
    case 'session_archived':
      return archived(state, ctx);
    case 'session_reactivated':
      return reactivated(state, ctx);
    case 'health_observed':
      return healthObserved(state, event.observed, ctx);
    case 'work_linked':
      return workLinked(state, event.active, ctx);
    default:
      return unreachable(event, 'Session event');
  }
}

/** SES-01 (the checks formerly inline in `session-directory.ts` `recordSessionCreated`, which now calls this). */
function created(ctx: SessionGuardContext): SessionTransition {
  const creation = ctx.creation;
  if (creation === null) return reject('illegal', 'invalid', 'session_created requires the creation guard facts');
  if (!creation.operationAcceptedAt1) {
    return reject('stale', 'revision_conflict', 'the admitted Session operation is no longer awaiting registration');
  }
  if (!creation.plannedAbsent) return reject('stale', 'revision_conflict', 'the planned Session reference is already registered');
  // The owner service has already returned the target check's own code; this
  // is the backstop for a caller that reaches the machine anyway.
  if (!creation.linkTargetsValid) return reject('guard_failed', 'not_found', 'an initial work link target is not valid');
  // A held Kernel mapping claim surfaces today as the store's unique conflict → revision_conflict.
  if (!creation.mappingUnique) return reject('stale', 'revision_conflict', 'the Kernel session mapping is held by another Session');
  return done({ lifecycle: 'active', health: 'available', healthConclusion: null, occupancy: null, revision: 1 }, [
    { kind: 'create_session' }, { kind: 'complete_creation_operation' }, { kind: 'write_initial_links' },
    { kind: 'emit_event', eventType: 'SessionCreated' },
  ]);
}

/**
 * SES-02/SES-03. Guard order keeps today's codes (`claim-service.ts:541-550`,
 * `query-execution.ts:715-720`): lifecycle → health → occupancy → revision →
 * generation → pin. The Query service checks its three pins before calling,
 * so a stale pin on a busy Session stays `busy` for Work and
 * `revision_conflict` for Query, as today.
 */
function acquired(state: ActiveState, holder: SessionHolderRef, ctx: SessionGuardContext): SessionTransition {
  if (holder.aggregateType === 'CoreOperation') {
    return reject('illegal', 'unsupported', 'a maintenance occupancy has no writer');
  }
  if (state.lifecycle !== 'active') return reject('guard_failed', 'busy', 'the target Session is archived');
  if (state.health !== 'available') return reject('guard_failed', 'busy', `the target Session health is ${state.health}`);
  if (state.occupancy !== null) return reject('guard_failed', 'busy', 'the target Session is already occupied');
  const next = nextOccupancyGeneration(state.revision);
  if (!next.ok) return reject('guard_failed', next.code, next.detail);
  if (stalePin(state, ctx)) return reject('stale', 'revision_conflict', 'the Session changed since the caller read it');
  const generation = next.generation;
  return done({ ...state, occupancy: { kind: 'execution', holder, generation }, revision: generation },
    [{ kind: 'occupy_session', holder, generation }]);
}

/**
 * SES-04..SES-10 and the empty releases SES-17/SES-18 (SD-1). A release is
 * only ever carried by the holder's own end in the same commit; there is no
 * release for timeouts, missing heartbeats or lost processes (no such cause).
 */
function released(state: ActiveState, cause: SessionReleaseCause, ctx: SessionGuardContext): SessionTransition {
  const row = RELEASE_CAUSES[cause];
  const holder = ctx.holder;
  if (holder === null) return reject('illegal', 'invalid', 'occupancy_released requires the holder guard context');
  if (holder.ref.aggregateType !== row.holder) {
    return reject('illegal', 'invalid', `${cause} (${row.row}) releases a ${row.holder} holder, not a ${holder.ref.aggregateType}`);
  }
  if (phaseHolder(holder.before) !== row.holder || phaseHolder(holder.after) !== row.holder) {
    return reject('illegal', 'invalid', `the holder phases do not belong to a ${row.holder}`);
  }
  // SES-18 / SES-17: the releaser is not the current holder → no Session write.
  // Like `ownsOccupancy`, only the occupancy is looked at, not lifecycle or
  // health (archived with an occupancy is unreachable, I-4).
  if (state.occupancy === null) return done(state);
  if (!holdsExecution(state, holder.ref, holder.claimGeneration)) return done(state);

  if (PENDING_PHASES.has(holder.after)) {
    return reject('illegal', 'invalid', `a ${holder.after} holder has not ended; only its own end releases the Session`);
  }
  if (holder.after === 'run_ended_unknown' || holder.after === 'query_unknown') {
    // I-2, D-4: an outcome_unknown holder keeps the occupancy until reconcile evidence or a human attestation.
    return reject('guard_failed', 'busy', 'an execution whose outcome is unknown keeps the Session occupied');
  }
  if (row.source === 'R' && ctx.caller !== 'reconcile') {
    return reject('illegal', 'forbidden', `${cause} is only released by the Host start reconcile`);
  }
  if ((ctx.caller === 'reconcile' || row.attested) && ctx.hostLease !== 'owned') {
    return reject('guard_failed', 'busy', 'the Host instance lease is held by another Host or unreadable');
  }
  if (ctx.caller === 'reconcile' && ctx.probe !== null && INCONCLUSIVE_PROBES.has(ctx.probe)) {
    return reject('guard_failed', 'unavailable', `a ${ctx.probe} probe settles nothing; the Host reports it`);
  }
  if ((row.turn === 'always' || holder.kernelTurnSeen) && holder.inputsConfirmed !== true
    && !(row.attested && holder.inputsConfirmed === 'kernel_unreadable')) {
    return reject('guard_failed', 'unavailable', 'the Turn input acceptance is not confirmed yet (§10.3)');
  }

  switch (cause) {
    case 'terminal_observed':                 // SES-04
    case 'query_terminal_observed':           // SES-08
    case 'query_reconcile_terminal':          // SES-08
      return releasedOnKernelTerminal(state, holder);
    case 'stop_not_entered':
      return notYet('SES-05');
    case 'reconcile_terminal':
    case 'reconcile_interrupted_clean':
    case 'late_evidence':
    case 'stop_paused':
      return notYet('SES-06');
    case 'unknown_attested':
      return notYet('SES-07');
    case 'query_reconcile_not_entered':
    case 'query_reconcile_interrupted_clean':
      return notYet('SES-09');
    case 'query_unknown_attested':
      return notYet('SES-10');
    default:
      return unreachable(cause, 'Session release cause');
  }
}

/**
 * SES-04 (`execution-entry-service.ts:1417`, `:1452-1455`) and SES-08
 * (`query-execution.ts:1408-1411`): the holder's Kernel terminal carries the
 * complete Turn boundary the cursor moves to (input confirmation was checked
 * above: these causes always have a Turn).
 */
function releasedOnKernelTerminal(state: ActiveState, holder: SessionHolderContext): SessionTransition {
  if (holder.kernelTurnOpen) return reject('illegal', 'invalid', 'a Kernel terminal cannot leave its Kernel Turn open');
  const historyCursor: SessionHistoryCursorUpdate = holder.historyBoundaryCursor === null
    ? { kind: 'keep' } : { kind: 'advance', cursor: holder.historyBoundaryCursor };
  return done({ ...state, occupancy: null, revision: state.revision + 1 }, [{
    kind: 'release_session', holder: holder.ref, generation: holder.claimGeneration, historyCursor, kernelTurnOpen: false,
  }]);
}

/**
 * SES-11 (the checks formerly inline in `session-lifecycle.ts`
 * `runTransitionAttempt`, which now calls this): health is not checked;
 * archiving an unavailable Session is legal.
 */
function archived(state: ActiveState, ctx: SessionGuardContext): SessionTransition {
  if (state.lifecycle === 'archived') return reject('illegal', 'invalid', 'the Session is already archived');
  if (state.occupancy !== null) return reject('guard_failed', 'busy', 'the Session is occupied');
  if (ctx.openResponsibleLink === null) {
    return reject('illegal', 'invalid', 'session_archived requires the responsible-link read');
  }
  if (ctx.openResponsibleLink !== false) {
    return reject('guard_failed', 'dependency_blocked',
      `the Session still has an unresolved responsible ${ctx.openResponsibleLink} obligation`);
  }
  if (stalePin(state, ctx)) return reject('stale', 'revision_conflict', 'the Session changed since the caller read it');
  return done({ ...state, lifecycle: 'archived', revision: state.revision + 1 },
    [{ kind: 'archive_session' }, { kind: 'emit_event', eventType: 'SessionArchived' }]);
}

/**
 * SES-14 (formerly inline in `session-lifecycle.ts` `runTransitionAttempt`,
 * which now calls this): no Kernel capability check (SG-2)
 * and, as today, no occupancy check (archived with an occupancy is
 * unreachable, I-4).
 */
function reactivated(state: ActiveState, ctx: SessionGuardContext): SessionTransition {
  if (state.lifecycle === 'active') return reject('illegal', 'invalid', 'the Session is already active');
  if (stalePin(state, ctx)) return reject('stale', 'revision_conflict', 'the Session changed since the caller read it');
  return done({ ...state, lifecycle: 'active', revision: state.revision + 1 },
    [{ kind: 'reactivate_session' }, { kind: 'emit_event', eventType: 'SessionReactivated' }]);
}

/**
 * SES-12/SES-13/SES-19 are 新增 (§15.2 step 5.6). The §8.4 refusals in front
 * of them apply now; a probe that passes them still answers `illegal`/`invalid`.
 * `kernel_turn_open` cannot be observed: it is not a probe verdict (SD-2).
 */
function healthObserved(state: ActiveState, observed: SessionHealth, ctx: SessionGuardContext): SessionTransition {
  if (observed === 'recoverable') return reject('illegal', 'unsupported', 'recoverable has no writer (D-17)');
  if (ctx.caller !== 'reconcile') return reject('illegal', 'forbidden', 'only the Host start reconcile observes Session health');
  if (state.lifecycle === 'archived') return reject('illegal', 'invalid', 'reconcile does not probe an archived Session');
  if (ctx.hostLease !== 'owned') {
    return reject('guard_failed', 'busy', 'the Host instance lease is held by another Host or unreadable');
  }
  if (ctx.probe === null) return reject('illegal', 'invalid', 'health_observed requires the probe verdict');
  if (INCONCLUSIVE_PROBES.has(ctx.probe)) {
    return reject('guard_failed', 'unavailable', `a ${ctx.probe} probe is not observed; the Host reports it`);
  }
  if (observed !== (ctx.probe === 'ready' ? 'available' : 'unavailable')) {
    return reject('illegal', 'invalid', `a ${ctx.probe} probe cannot observe ${observed}`);
  }
  if (state.health === 'recoverable') return reject('illegal', 'invalid', 'recoverable has no writer (D-17)');
  if (observed === 'available' && state.health === 'unavailable' && state.healthConclusion === 'kernel_turn_open'
    && (ctx.kernelHeader === null || ctx.kernelHeader.activeRunId !== null)) {
    // A readable Kernel does not prove the last Turn ended (LA-1).
    return reject('guard_failed', 'unavailable', 'the Kernel session still has an open Turn; kernel_turn_open stays');
  }
  if (state.health === observed) return notYet('SES-19');
  return notYet(observed === 'unavailable' ? 'SES-12' : 'SES-13');
}

/**
 * SES-15 and SES-16 (the open/close checks formerly inline in
 * `session-lifecycle.ts` `runLinkAttempt`, which now calls this).
 */
function workLinked(state: ActiveState, active: boolean, ctx: SessionGuardContext): SessionTransition {
  const link = ctx.link;
  if (link === null) return reject('illegal', 'invalid', 'work_linked requires the link guard facts');
  if (active) {
    if (state.lifecycle !== 'active') return reject('guard_failed', 'busy', 'an archived Session cannot gain a new active work link');
    // As for creation, the owner service has already returned the target check's own code.
    if (!link.targetValid) return reject('guard_failed', 'not_found', 'the work link target is not valid');
  } else {
    if (!link.exists) return reject('guard_failed', 'not_found', 'there is no existing work link to close');
    if (!link.open) return reject('illegal', 'invalid', 'the work link is already closed');
  }
  if (stalePin(state, ctx)) return reject('stale', 'revision_conflict', 'the Session changed since the caller read it');
  return done({ ...state, revision: state.revision + 1 }, [
    { kind: 'bump_session_revision' }, { kind: 'write_work_link', bound: active ? 'since' : 'until' },
    { kind: 'emit_event', eventType: 'SessionWorkLinkChanged' },
  ]);
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function done(next: SessionMachineState, effects: readonly SessionEffect[] = []): SessionTransition {
  return accept(next, effects);
}

function stalePin(state: ActiveState, ctx: SessionGuardContext): boolean {
  return ctx.pin !== null && ctx.pin !== state.revision;
}

function holdsExecution(state: ActiveState, holder: ExecutionRef, generation: number): boolean {
  const occupancy = state.occupancy;
  return occupancy !== null && occupancy.kind === 'execution'
    && sameRef(occupancy.holder, holder) && occupancy.generation === generation;
}

function phaseHolder(phase: HolderPhase): 'Run' | 'QueryRun' {
  return phase.startsWith('run_') ? 'Run' : 'QueryRun';
}

/** Key-order-free structural equality; refs are plain JSON records (same result as comparing canonical JSON). */
function sameRef(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => sameRef(item, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  if (keys.length !== Object.keys(rightRecord).length) return false;
  return keys.every((key) => Object.hasOwn(rightRecord, key) && sameRef(leftRecord[key], rightRecord[key]));
}
