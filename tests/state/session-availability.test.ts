/**
 * A.2 step 2 (STATE-MACHINES-SPEC §15.2 第 2 步): the pure Session machine
 * `src/core/work-graph/state/session-availability.ts` (§8).
 *
 * - every (state, event) combination: 40 dimension states (lifecycle ×
 *   health/conclusion × occupancy) plus `absent`, against every event kind and
 *   every release cause; legal → `next` and `effects`, empty transitions →
 *   `ok:true, effects:[]` (SD-1), illegal → `reason` and `code` of §8.4;
 * - each §8.4 refusal and guard order with its own fixture;
 * - the rows A.2 step 5 added (SES-05 in 5.1; SES-06/07/09/10/12/13/19 in 5.6)
 *   are written out in the oracle like the rows before them;
 * - the shared rules (generation, holder check, availability) and the record
 *   constructors of §14.1.
 *
 * No RecordStore, no Kernel.
 */
import { describe, expect, it } from 'vitest';
import type { ActorRef } from '../../src/contracts/command-event.js';
import type {
  RoleConfigurationRef, SessionAggregateRef, WorkLinkRelation, WorkLinkTarget,
} from '../../src/contracts/core/identity.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { SessionArchiveRequestV1 } from '../../src/contracts/core/session-archive.js';
import type { SessionHealthConclusion, SessionRecord, SessionWorkLink } from '../../src/contracts/core/session.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import type { QueryRunRef } from '../../src/contracts/query-job.js';
import {
  archiveSessionRecord, createSessionRecord, deriveAvailability, nextOccupancyGeneration,
  observeSessionHealthRecord, occupancyAdmissionProblem, occupySessionRecord, openResponsibleLinkOf, ownsOccupancy, ownsQuery,
  reactivateSessionRecord, releaseSessionRecord, sessionMachineStateOf, transitionSession,
  type HolderPhase, type SessionArchiveGuardV1, type SessionDispatchGuardV1, type SessionEffect, type SessionEvent,
  type SessionGuardContext, type SessionHealth,
  type SessionHolderContext, type SessionLifecycle, type SessionMachineState, type SessionReleaseCause,
  type SessionTransition,
} from '../../src/core/work-graph/state/session-availability.js';
import type { CoreError } from '../../src/contracts/core/results.js';
import type { TransitionRejectReason } from '../../src/core/work-graph/state/transition.js';

/** Every release cause (moved from `session-availability.ts` in A.2 step 4: no production code enumerates them). */
const SESSION_RELEASE_CAUSES: readonly SessionReleaseCause[] = Object.freeze([
  'terminal_observed', 'stop_not_entered', 'reconcile_terminal', 'reconcile_interrupted_clean',
  'reconcile_takeover_unresolved', 'late_evidence',
  'stop_paused', 'unknown_attested', 'query_terminal_observed', 'query_reconcile_terminal',
  'query_reconcile_not_entered', 'query_reconcile_interrupted_clean', 'query_unknown_attested',
]);

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

const RUN_A: RunRef = { aggregateType: 'Run', projectId: 'p1', goalId: 'g1', runId: 'run-a' };
const RUN_B: RunRef = { aggregateType: 'Run', projectId: 'p1', goalId: 'g1', runId: 'run-b' };
const QUERY_A: QueryRunRef = { aggregateType: 'QueryRun', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-a', runId: 'qr-a' };
const QUERY_B: QueryRunRef = { aggregateType: 'QueryRun', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-b', runId: 'qr-b' };
const OPERATION: OperationRef = { aggregateType: 'CoreOperation', projectId: 'p1', operationId: 'op-1' };
/** Every dimension state sits at this revision; its occupancy (if any) was taken at GENERATION. */
const REVISION = 9;
const GENERATION = 7;
const BOUNDARY = 'cursor-boundary-2';
/** Slice 1 §2.3: the minimal immutable archive request the new matrix events carry. */
const ARCHIVE_REQUEST: SessionArchiveRequestV1 = {
  schemaVersion: 1, requestId: 'a',
  requestedBy: { kind: 'human', id: 'operator-1' } as Extract<ActorRef, { kind: 'human' | 'system' }>,
  requestedAt: '2026-10-08T00:00:00.000Z', reason: 'the operator asked to archive this line',
  mode: 'operator', tasks: [], wait: null, execution: { kind: 'none' }, executionPins: [],
  confirmUnknownStopped: false, receipt: { identityKey: 's1-archive-step:k', fingerprint: 'f' },
};

type Occ = 'none' | 'run' | 'query' | 'maintenance';
type StateDesc = { lifecycle: SessionLifecycle; health: SessionHealth; conclusion: SessionHealthConclusion | null; occ: Occ };

function machineState(desc: StateDesc): Exclude<SessionMachineState, 'absent'> {
  const occupancy = desc.occ === 'none' ? null
    : desc.occ === 'run' ? { kind: 'execution' as const, holder: RUN_A, generation: GENERATION }
      : desc.occ === 'query' ? { kind: 'execution' as const, holder: QUERY_A, generation: GENERATION }
        : { kind: 'maintenance' as const, holder: OPERATION, generation: GENERATION };
  return {
    lifecycle: desc.lifecycle, health: desc.health, healthConclusion: desc.conclusion, occupancy, revision: REVISION,
    provenance: null, archiveRequest: null,
  };
}

const HEALTH_VARIANTS: readonly { health: SessionHealth; conclusion: SessionHealthConclusion | null }[] = [
  { health: 'available', conclusion: null },
  { health: 'recoverable', conclusion: null },
  { health: 'unavailable', conclusion: 'missing' },
  { health: 'unavailable', conclusion: 'damaged' },
  { health: 'unavailable', conclusion: 'kernel_turn_open' },
];
const OCCUPANCIES: readonly Occ[] = ['none', 'run', 'query', 'maintenance'];
const DIMENSION_STATES: readonly StateDesc[] = (['active', 'archived'] as const).flatMap((lifecycle) =>
  HEALTH_VARIANTS.flatMap(({ health, conclusion }) => OCCUPANCIES.map((occ) => ({ lifecycle, health, conclusion, occ }))));

function labelOf(desc: StateDesc | 'absent'): string {
  return desc === 'absent' ? 'absent' : `${desc.lifecycle}/${desc.health}${desc.conclusion === null ? '' : `(${desc.conclusion})`}/${desc.occ}`;
}

function ctxOf(overrides: Partial<SessionGuardContext> = {}): SessionGuardContext {
  return {
    caller: 'service', hostLease: null, pin: null, holder: null, probe: null, kernelHeader: null,
    openResponsibleLink: null, creation: null, link: null, ...overrides,
  };
}

const CREATION = { operationAcceptedAt1: true, plannedAbsent: true, mappingUnique: true, linkTargetsValid: true };

type CauseInfo = { holder: 'run' | 'query'; reconcile: boolean; attested: boolean; terminal: boolean; turnSeen: boolean };
const CAUSES: Record<SessionReleaseCause, CauseInfo> = {
  terminal_observed: { holder: 'run', reconcile: false, attested: false, terminal: true, turnSeen: true },
  stop_not_entered: { holder: 'run', reconcile: false, attested: false, terminal: false, turnSeen: false },
  reconcile_terminal: { holder: 'run', reconcile: true, attested: false, terminal: true, turnSeen: true },
  reconcile_interrupted_clean: { holder: 'run', reconcile: true, attested: false, terminal: false, turnSeen: true },
  // K3 RUN-25 (SES-06): a takeover closure leaves the Kernel Turn open.
  reconcile_takeover_unresolved: { holder: 'run', reconcile: true, attested: false, terminal: false, turnSeen: true },
  late_evidence: { holder: 'run', reconcile: false, attested: false, terminal: true, turnSeen: true },
  stop_paused: { holder: 'run', reconcile: false, attested: false, terminal: false, turnSeen: true },
  unknown_attested: { holder: 'run', reconcile: false, attested: true, terminal: false, turnSeen: true },
  query_terminal_observed: { holder: 'query', reconcile: false, attested: false, terminal: true, turnSeen: true },
  query_reconcile_terminal: { holder: 'query', reconcile: true, attested: false, terminal: true, turnSeen: true },
  query_reconcile_not_entered: { holder: 'query', reconcile: true, attested: false, terminal: false, turnSeen: false },
  query_reconcile_interrupted_clean: { holder: 'query', reconcile: true, attested: false, terminal: false, turnSeen: true },
  query_unknown_attested: { holder: 'query', reconcile: false, attested: true, terminal: false, turnSeen: true },
};
/** The rows implemented before A.2 step 5.6 (SES-04, SES-08; SES-05 since step 5.1). */
const IMPLEMENTED_CAUSES: ReadonlySet<SessionReleaseCause> = new Set<SessionReleaseCause>([
  'terminal_observed', 'stop_not_entered', 'query_terminal_observed', 'query_reconcile_terminal',
]);

/** The happy-path holder context of a cause: the holder RUN_A / QUERY_A at GENERATION. */
function holderFor(cause: SessionReleaseCause, overrides: Partial<SessionHolderContext> = {}): SessionHolderContext {
  const info = CAUSES[cause];
  const run = info.holder === 'run';
  const before: HolderPhase = cause === 'unknown_attested' ? 'run_ended_unknown'
    : cause === 'query_unknown_attested' ? 'query_unknown'
      : cause === 'stop_not_entered' ? 'run_starting'
        : cause === 'query_reconcile_not_entered' ? 'query_prepared'
          : run ? 'run_running' : 'query_entered';
  return {
    ref: run ? RUN_A : QUERY_A,
    claimGeneration: GENERATION,
    before,
    after: run ? 'run_ended' : 'query_settled',
    kernelTurnSeen: info.turnSeen,
    inputsConfirmed: true,
    historyBoundaryCursor: info.terminal ? BOUNDARY : null,
    kernelTurnOpen: cause === 'reconcile_interrupted_clean' || cause === 'stop_paused',
    ...overrides,
  };
}

function releaseCtx(cause: SessionReleaseCause, overrides: Partial<SessionGuardContext> = {}): SessionGuardContext {
  const info = CAUSES[cause];
  return ctxOf({
    caller: info.reconcile ? 'reconcile' : 'service',
    hostLease: info.reconcile || info.attested ? 'owned' : null,
    probe: info.reconcile ? 'ready' : null,
    holder: holderFor(cause),
    ...overrides,
  });
}

type Case = { name: string; event: SessionEvent; ctx: SessionGuardContext };
const RELEASE_CASES: readonly Case[] = SESSION_RELEASE_CAUSES.map((cause) => ({
  name: `occupancy_released(${cause})`, event: { kind: 'occupancy_released', cause }, ctx: releaseCtx(cause),
}));
const HEALTH_CTX = ctxOf({ caller: 'reconcile', hostLease: 'owned' });
/**
 * §5.2 last paragraph: the narrow fixture provides the ordinary facts the new
 * guards read, so the old rows keep their old expectations. `not_waiting` is
 * the archive wait fact (`session_archived`); the dispatch facts are the
 * ordinary non-copy, non-waiting Work/Query admission.
 */
const ARCHIVE_GUARD: SessionArchiveGuardV1 = {
  requestMatches: true, choicesValid: true, authorityValid: true, wait: 'not_waiting', retired: false,
  sourceExecutionStopped: true, stopQueued: false, failedDisposal: false, provenanceBasisValid: true,
};
function ordinaryDispatch(purpose: 'work' | 'query'): SessionDispatchGuardV1 {
  return {
    purpose, waiting: null, consumedWait: null, readonlyQueryMatches: false,
    legacyProvenance: { schemaVersion: 1, kind: 'new' },
  };
}
const CASES: readonly Case[] = [
  { name: 'session_created', event: { kind: 'session_created' }, ctx: ctxOf({ creation: CREATION }) },
  { name: 'occupancy_acquired(Run)', event: { kind: 'occupancy_acquired', holder: RUN_B }, ctx: ctxOf({ pin: REVISION, dispatch: ordinaryDispatch('work') }) },
  { name: 'occupancy_acquired(QueryRun)', event: { kind: 'occupancy_acquired', holder: QUERY_B }, ctx: ctxOf({ pin: REVISION, dispatch: ordinaryDispatch('query') }) },
  { name: 'occupancy_acquired(maintenance)', event: { kind: 'occupancy_acquired', holder: OPERATION }, ctx: ctxOf({ pin: REVISION, dispatch: ordinaryDispatch('work') }) },
  ...RELEASE_CASES,
  { name: 'session_archived', event: { kind: 'session_archived' }, ctx: ctxOf({ pin: REVISION, openResponsibleLink: false, archive: ARCHIVE_GUARD }) },
  { name: 'session_reactivated', event: { kind: 'session_reactivated' }, ctx: ctxOf({ pin: REVISION }) },
  { name: 'archive_requested', event: { kind: 'archive_requested', archive: ARCHIVE_REQUEST }, ctx: ctxOf({ pin: REVISION }) },
  { name: 'archive_request_released', event: { kind: 'archive_request_released', archiveRequestId: 'a' }, ctx: ctxOf({ pin: REVISION }) },
  { name: 'legacy_provenance_backfilled', event: { kind: 'legacy_provenance_backfilled', provenance: { schemaVersion: 1, kind: 'new' } }, ctx: ctxOf({ pin: REVISION }) },
  {
    name: 'health_observed(available, closed head)', event: { kind: 'health_observed', observed: 'available' },
    ctx: { ...HEALTH_CTX, probe: 'ready', kernelHeader: { activeRunId: null } },
  },
  {
    name: 'health_observed(available, open head)', event: { kind: 'health_observed', observed: 'available' },
    ctx: { ...HEALTH_CTX, probe: 'ready', kernelHeader: { activeRunId: 'kernel-run-1' } },
  },
  {
    name: 'health_observed(unavailable, missing)', event: { kind: 'health_observed', observed: 'unavailable' },
    ctx: { ...HEALTH_CTX, probe: 'missing' },
  },
  {
    name: 'health_observed(unavailable, damaged)', event: { kind: 'health_observed', observed: 'unavailable' },
    ctx: { ...HEALTH_CTX, probe: 'damaged' },
  },
  {
    name: 'health_observed(recoverable)', event: { kind: 'health_observed', observed: 'recoverable' },
    ctx: { ...HEALTH_CTX, probe: 'ready', kernelHeader: { activeRunId: null } },
  },
  {
    name: 'work_linked(open)', event: { kind: 'work_linked', active: true },
    ctx: ctxOf({ pin: REVISION, link: { exists: false, open: false, targetValid: true, pin: null } }),
  },
  {
    name: 'work_linked(close)', event: { kind: 'work_linked', active: false },
    ctx: ctxOf({ pin: REVISION, link: { exists: true, open: true, targetValid: true, pin: 3 } }),
  },
];

// --------------------------------------------------------------------------
// The oracle: §8.3 rows and §8.4 refusals written out per state description
// --------------------------------------------------------------------------

type Expected =
  | { ok: true; next: SessionMachineState; effects: readonly SessionEffect[] }
  | { ok: false; reason: TransitionRejectReason; code: CoreError };

const legal = (next: SessionMachineState, effects: readonly SessionEffect[] = []): Expected => ({ ok: true, next, effects });
const refused = (reason: TransitionRejectReason, code: CoreError): Expected => ({ ok: false, reason, code });

function expectedFor(desc: StateDesc | 'absent', c: Case): Expected {
  const event = c.event;
  if (desc === 'absent') {
    return event.kind === 'session_created'
      ? legal({
        lifecycle: 'active', health: 'available', healthConclusion: null, occupancy: null, revision: 1,
        provenance: null, archiveRequest: null,
      }, [
        { kind: 'create_session' }, { kind: 'complete_creation_operation' }, { kind: 'write_initial_links' },
        { kind: 'emit_event', eventType: 'SessionCreated' },
      ])
      : refused('illegal', 'not_found');
  }
  const state = machineState(desc);
  switch (event.kind) {
    case 'session_created':
      return refused('stale', 'revision_conflict');
    case 'occupancy_acquired': {
      if (event.holder.aggregateType === 'CoreOperation') return refused('illegal', 'unsupported');
      if (desc.lifecycle === 'archived' || desc.health !== 'available' || desc.occ !== 'none') return refused('guard_failed', 'busy');
      const generation = REVISION + 1;
      return legal({ ...state, occupancy: { kind: 'execution', holder: event.holder, generation }, revision: generation },
        [{ kind: 'occupy_session', holder: event.holder, generation }]);
    }
    case 'occupancy_released': {
      const info = CAUSES[event.cause];
      const owned = (desc.occ === 'run' && info.holder === 'run') || (desc.occ === 'query' && info.holder === 'query');
      if (!owned) return legal(state); // SES-17 / SES-18
      // A Kernel terminal moves the cursor to its boundary; a release without one keeps it (SES-05/07/09/10),
      // and a Turn left without a Kernel terminal makes the Session kernel_turn_open (SES-06/07/09/10, LA-1).
      const open = c.ctx.holder?.kernelTurnOpen === true;
      const holder = info.holder === 'run' ? RUN_A : QUERY_A;
      return legal({ ...state, ...(open ? { health: 'unavailable' as const, healthConclusion: 'kernel_turn_open' as const } : {}),
        occupancy: null, revision: REVISION + 1 }, [open
        ? { kind: 'release_session', holder, generation: GENERATION, historyCursor: { kind: 'keep' }, kernelTurnOpen: true }
        : { kind: 'release_session', holder, generation: GENERATION,
          historyCursor: info.terminal ? { kind: 'advance', cursor: BOUNDARY } : { kind: 'keep' }, kernelTurnOpen: false }]);
    }
    case 'session_archived':
      if (desc.lifecycle === 'archived') return refused('illegal', 'invalid');
      if (desc.occ !== 'none') return refused('guard_failed', 'busy');
      return legal({ ...state, lifecycle: 'archived', revision: REVISION + 1 },
        [{ kind: 'archive_session' }, { kind: 'emit_event', eventType: 'SessionArchived' }]);
    case 'session_reactivated':
      if (desc.lifecycle === 'active') return refused('illegal', 'invalid');
      // S1-SES-05 (decision 38): a retired (unavailable) Session cannot be reactivated.
      if (desc.health === 'unavailable') return refused('guard_failed', 'unavailable');
      return legal({ ...state, lifecycle: 'active', revision: REVISION + 1 },
        [{ kind: 'reactivate_session' }, { kind: 'emit_event', eventType: 'SessionReactivated' }]);
    case 'archive_requested': {
      // §3.5: the new events refuse incomplete when the owner did not read the archive facts.
      const archive = c.ctx.archive;
      if (archive === undefined) return refused('guard_failed', 'incomplete');
      // S1-SES-03: archived → invalid; a different pending request → busy; else record R at rev+1.
      if (desc.lifecycle === 'archived') return refused('illegal', 'invalid');
      if (!archive.choicesValid) return refused('illegal', 'invalid');
      if (!archive.authorityValid) return refused('illegal', 'forbidden');
      if (state.archiveRequest !== undefined && state.archiveRequest !== null) {
        return state.archiveRequest.requestId === event.archive.requestId
          ? legal(state) : refused('guard_failed', 'busy');
      }
      if (c.ctx.pin !== null && c.ctx.pin !== state.revision) return refused('stale', 'revision_conflict');
      return legal({ ...state, archiveRequest: event.archive, revision: REVISION + 1 }, [
        { kind: 'write_archive_request', archive: event.archive },
        { kind: 'emit_event', eventType: 'SessionArchiveRequested' },
      ]);
    }
    case 'archive_request_released': {
      // §3.5: the new events refuse incomplete when the owner did not read the archive facts.
      const archive = c.ctx.archive;
      if (archive === undefined) return refused('guard_failed', 'incomplete');
      // S1-SES-06: only the matching request after a failed disposal clears it; a queued stop stays busy.
      if (state.archiveRequest === undefined || state.archiveRequest === null
        || state.archiveRequest.requestId !== event.archiveRequestId) {
        return refused('stale', 'revision_conflict');
      }
      if (!archive.failedDisposal) return refused('guard_failed', 'busy');
      if (archive.stopQueued) return refused('guard_failed', 'busy');
      if (!archive.sourceExecutionStopped) return refused('guard_failed', 'busy');
      if (c.ctx.pin !== null && c.ctx.pin !== state.revision) return refused('stale', 'revision_conflict');
      return legal({ ...state, archiveRequest: null, revision: REVISION + 1 }, [
        { kind: 'clear_archive_request' },
        { kind: 'emit_event', eventType: 'SessionArchiveRequestReleased' },
      ]);
    }
    case 'legacy_provenance_backfilled': {
      // §3.5: the new events refuse incomplete when the owner did not read the archive facts.
      const archive = c.ctx.archive;
      if (archive === undefined) return refused('guard_failed', 'incomplete');
      // S1-SES-02: only a null provenance is backfilled once; an existing value is a revision conflict.
      if (state.provenance !== undefined && state.provenance !== null) return refused('stale', 'revision_conflict');
      if (!archive.provenanceBasisValid) return refused('guard_failed', 'incomplete');
      if (c.ctx.pin !== null && c.ctx.pin !== state.revision) return refused('stale', 'revision_conflict');
      return legal({ ...state, provenance: event.provenance, revision: REVISION + 1 }, [
        { kind: 'write_session_provenance', provenance: event.provenance },
        { kind: 'emit_event', eventType: 'SessionProvenanceBackfilled' },
      ]);
    }
    case 'health_observed': {
      if (event.observed === 'recoverable') return refused('illegal', 'unsupported');
      if (desc.lifecycle === 'archived') return refused('illegal', 'invalid');
      if (desc.health === 'recoverable') return refused('illegal', 'invalid');
      if (event.observed === 'available' && desc.conclusion === 'kernel_turn_open'
        && c.ctx.kernelHeader?.activeRunId !== null) {
        return refused('guard_failed', 'unavailable');
      }
      if (desc.health === event.observed) return legal(state); // SES-19
      if (event.observed === 'available') {
        return legal({ ...state, health: 'available', healthConclusion: null, revision: REVISION + 1 }, [  // SES-13
          { kind: 'observe_health', health: 'available', conclusion: null }, { kind: 'emit_event', eventType: 'SessionHealthObserved' }]);
      }
      const conclusion = c.ctx.probe === 'missing' ? 'missing' : 'damaged';
      return legal({ ...state, health: 'unavailable', healthConclusion: conclusion, revision: REVISION + 1 }, [  // SES-12
        { kind: 'observe_health', health: 'unavailable', conclusion }, { kind: 'emit_event', eventType: 'SessionHealthObserved' }]);
    }
    case 'work_linked':
      if (event.active && desc.lifecycle === 'archived') return refused('guard_failed', 'busy');
      return legal({ ...state, revision: REVISION + 1 }, [
        { kind: 'bump_session_revision' }, { kind: 'write_work_link', bound: event.active ? 'since' : 'until' },
        { kind: 'emit_event', eventType: 'SessionWorkLinkChanged' },
      ]);
    default:
      throw new Error('unhandled event in the oracle');
  }
}

/** The comparable part of a result: an illegal result's detail is only required to be non-empty. */
function comparable(result: SessionTransition): Expected {
  if (result.ok) return { ok: true, next: result.next, effects: result.effects };
  expect(result.detail.length).toBeGreaterThan(0);
  return { ok: false, reason: result.reason, code: result.code };
}

function run(state: SessionMachineState, event: SessionEvent, ctx: SessionGuardContext): Expected {
  return comparable(transitionSession(state, event, ctx));
}

// --------------------------------------------------------------------------
// Exhaustive (state, event) matrix
// --------------------------------------------------------------------------

describe('transitionSession: every (state, event) combination', () => {
  it('covers every event kind and every release cause', () => {
    const kinds = new Set(CASES.map((c) => c.event.kind));
    const allKinds: Record<SessionEvent['kind'], true> = {
      session_created: true, occupancy_acquired: true, occupancy_released: true, session_archived: true,
      session_reactivated: true, health_observed: true, work_linked: true,
      archive_requested: true, archive_request_released: true, legacy_provenance_backfilled: true,
    };
    expect([...kinds].sort()).toEqual(Object.keys(allKinds).sort());
    expect(Object.keys(CAUSES).sort()).toEqual([...SESSION_RELEASE_CAUSES].sort());
    expect(DIMENSION_STATES).toHaveLength(40);
  });

  it.each(CASES)('$name', (c) => {
    for (const desc of ['absent' as const, ...DIMENSION_STATES]) {
      const state: SessionMachineState = desc === 'absent' ? 'absent' : machineState(desc);
      expect(run(state, c.event, c.ctx), `${labelOf(desc)} × ${c.name}`).toEqual(expectedFor(desc, c));
    }
  });
});

// --------------------------------------------------------------------------
// Rows and refusals one by one
// --------------------------------------------------------------------------

const IDLE = machineState({ lifecycle: 'active', health: 'available', conclusion: null, occ: 'none' });
const HELD_BY_RUN = machineState({ lifecycle: 'active', health: 'available', conclusion: null, occ: 'run' });
const HELD_BY_QUERY = machineState({ lifecycle: 'active', health: 'available', conclusion: null, occ: 'query' });
const TURN_OPEN = machineState({ lifecycle: 'active', health: 'unavailable', conclusion: 'kernel_turn_open', occ: 'none' });

describe('SES-01 session_created', () => {
  it('requires the creation facts', () => {
    expect(run('absent', { kind: 'session_created' }, ctxOf())).toEqual(refused('illegal', 'invalid'));
  });

  it.each([
    ['operation not accepted@1', { operationAcceptedAt1: false }, refused('stale', 'revision_conflict')],
    ['planned Session present', { plannedAbsent: false }, refused('stale', 'revision_conflict')],
    ['initial link target invalid', { linkTargetsValid: false }, refused('guard_failed', 'not_found')],
    ['Kernel mapping held elsewhere', { mappingUnique: false }, refused('stale', 'revision_conflict')],
  ] as const)('%s', (_name, override, expected) => {
    expect(run('absent', { kind: 'session_created' }, ctxOf({ creation: { ...CREATION, ...override } }))).toEqual(expected);
  });

  it('checks the operation before the link targets (today: revision_conflict before the target check)', () => {
    const creation = { operationAcceptedAt1: false, plannedAbsent: true, mappingUnique: false, linkTargetsValid: false };
    expect(run('absent', { kind: 'session_created' }, ctxOf({ creation }))).toEqual(refused('stale', 'revision_conflict'));
  });

  it('ends at active/available/null, revision 1, availability idle', () => {
    const result = transitionSession('absent', { kind: 'session_created' }, ctxOf({ creation: CREATION }));
    expect(result.ok && result.next !== 'absent' && deriveAvailability(result.next)).toBe('idle');
  });
});

describe('SES-02/SES-03 occupancy_acquired', () => {
  const acquire = (holder: RunRef | QueryRunRef | OperationRef): SessionEvent => ({ kind: 'occupancy_acquired', holder });

  it('takes generation = revision + 1 and sets the revision to it', () => {
    const result = transitionSession({ ...IDLE, revision: 41 }, acquire(RUN_B), ctxOf({ pin: 41 }));
    expect(result).toEqual({
      ok: true,
      next: { ...IDLE, revision: 42, occupancy: { kind: 'execution', holder: RUN_B, generation: 42 } },
      effects: [{ kind: 'occupy_session', holder: RUN_B, generation: 42 }],
    });
  });

  it('keeps today\'s guard order: lifecycle → health → occupancy → revision → generation → pin', () => {
    const archivedBusy = machineState({ lifecycle: 'archived', health: 'unavailable', conclusion: 'missing', occ: 'run' });
    const archived = transitionSession(archivedBusy, acquire(RUN_B), ctxOf({ pin: 1 }));
    expect(archived).toMatchObject({ ok: false, code: 'busy', detail: 'the target Session is archived' });
    const unhealthy = transitionSession({ ...HELD_BY_RUN, health: 'unavailable', healthConclusion: 'damaged' }, acquire(RUN_B), ctxOf({ pin: 1 }));
    expect(unhealthy).toMatchObject({ ok: false, code: 'busy', detail: 'the target Session health is unavailable' });
    const occupied = transitionSession(HELD_BY_RUN, acquire(RUN_B), ctxOf({ pin: 1 }));
    expect(occupied).toMatchObject({ ok: false, code: 'busy', detail: 'the target Session is already occupied' });
    // A stale pin on a busy Session stays busy (Work claim); the Query service checks its pins before calling.
    for (const holder of [RUN_B, QUERY_B]) {
      expect(run(HELD_BY_RUN, acquire(holder), ctxOf({ pin: REVISION - 1 }))).toEqual(refused('guard_failed', 'busy'));
    }
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('an unreadable revision %s is unavailable', (revision) => {
    expect(run({ ...IDLE, revision }, acquire(RUN_B), ctxOf())).toEqual(refused('guard_failed', 'unavailable'));
  });

  it('a generation past the safe integers is invalid', () => {
    expect(run({ ...IDLE, revision: Number.MAX_SAFE_INTEGER }, acquire(QUERY_B), ctxOf()))
      .toEqual(refused('guard_failed', 'invalid'));
  });

  it('a stale pin is revision_conflict; no pin is not compared', () => {
    expect(run(IDLE, acquire(RUN_B), ctxOf({ pin: REVISION - 1 }))).toEqual(refused('stale', 'revision_conflict'));
    expect(run(IDLE, acquire(QUERY_B), ctxOf({ pin: null })).ok).toBe(true);
  });

  it('Work and Query get the same verdict in every dimension state', () => {
    for (const desc of DIMENSION_STATES) {
      const state = machineState(desc);
      const work = run(state, acquire(RUN_B), ctxOf({ pin: REVISION }));
      const query = run(state, acquire(QUERY_B), ctxOf({ pin: REVISION }));
      expect(query.ok, labelOf(desc)).toBe(work.ok);
      if (!work.ok && !query.ok) expect(query, labelOf(desc)).toEqual(work);
    }
  });

  it('a maintenance occupancy has no writer, in any state', () => {
    for (const desc of DIMENSION_STATES) {
      expect(run(machineState(desc), acquire(OPERATION), ctxOf()), labelOf(desc)).toEqual(refused('illegal', 'unsupported'));
    }
  });

  it('a kernel_turn_open Session is not claimable (busy): the requeue goes to a new Session', () => {
    expect(run(TURN_OPEN, acquire(RUN_B), ctxOf({ pin: REVISION }))).toEqual(refused('guard_failed', 'busy'));
  });

  it('occupancyAdmissionProblem is the same guard without a holder (the Work claim asks it before its Run has an id)', () => {
    for (const desc of DIMENSION_STATES) {
      for (const pin of [null, REVISION, REVISION - 1]) {
        const state = machineState(desc);
        const transition = transitionSession(state, acquire(RUN_B), ctxOf({ pin }));
        const problem = occupancyAdmissionProblem(state, pin);
        expect(problem, `${labelOf(desc)} pin=${String(pin)}`).toEqual(transition.ok ? null : transition);
      }
    }
    for (const revision of [0, Number.MAX_SAFE_INTEGER]) {
      expect(occupancyAdmissionProblem({ ...IDLE, revision }, null)).toEqual(transitionSession({ ...IDLE, revision },
        acquire(RUN_B), ctxOf()));
    }
    expect(occupancyAdmissionProblem('absent', null)).toEqual(transitionSession('absent', acquire(RUN_B), ctxOf()));
  });
});

describe('SES-04/SES-08 occupancy_released on the holder\'s Kernel terminal', () => {
  const release = (cause: SessionReleaseCause): SessionEvent => ({ kind: 'occupancy_released', cause });

  it('SES-04 moves the cursor to the complete Turn boundary and keeps health', () => {
    const state = { ...HELD_BY_RUN, health: 'unavailable' as const, healthConclusion: 'missing' as const };
    expect(transitionSession(state, release('terminal_observed'), releaseCtx('terminal_observed'))).toEqual({
      ok: true,
      next: { ...state, occupancy: null, revision: REVISION + 1 },
      effects: [{
        kind: 'release_session', holder: RUN_A, generation: GENERATION,
        historyCursor: { kind: 'advance', cursor: BOUNDARY }, kernelTurnOpen: false,
      }],
    });
  });

  it('SES-08 releases from the in-process observer and from the reconcile', () => {
    for (const cause of ['query_terminal_observed', 'query_reconcile_terminal'] as const) {
      expect(run(HELD_BY_QUERY, release(cause), releaseCtx(cause))).toEqual(legal({ ...HELD_BY_QUERY, occupancy: null, revision: REVISION + 1 }, [{
        kind: 'release_session', holder: QUERY_A, generation: GENERATION,
        historyCursor: { kind: 'advance', cursor: BOUNDARY }, kernelTurnOpen: false,
      }]));
    }
  });

  it('a release without a boundary keeps the cursor (never writes null)', () => {
    const ctx = releaseCtx('terminal_observed', { holder: holderFor('terminal_observed', { historyBoundaryCursor: null }) });
    const result = transitionSession(HELD_BY_RUN, release('terminal_observed'), ctx);
    expect(result.ok && result.effects).toEqual([{
      kind: 'release_session', holder: RUN_A, generation: GENERATION, historyCursor: { kind: 'keep' }, kernelTurnOpen: false,
    }]);
  });

  it('matches the holder by value, not by key order', () => {
    const reordered = { runId: 'run-a', goalId: 'g1', projectId: 'p1', aggregateType: 'Run' } as RunRef;
    const ctx = releaseCtx('terminal_observed', { holder: holderFor('terminal_observed', { ref: reordered }) });
    const result = transitionSession(HELD_BY_RUN, release('terminal_observed'), ctx);
    expect(result.ok && result.next).toMatchObject({ occupancy: null });
  });

  it('SES-17: an old generation or another holder is an empty transition (SD-1)', () => {
    const variants: readonly Partial<SessionHolderContext>[] = [
      { claimGeneration: GENERATION - 1 }, { claimGeneration: GENERATION + 1 }, { ref: RUN_B },
    ];
    for (const override of variants) {
      const ctx = releaseCtx('terminal_observed', { holder: holderFor('terminal_observed', override) });
      expect(transitionSession(HELD_BY_RUN, release('terminal_observed'), ctx)).toEqual({ ok: true, next: HELD_BY_RUN, effects: [] });
    }
    const maintenance = machineState({ lifecycle: 'active', health: 'available', conclusion: null, occ: 'maintenance' });
    expect(transitionSession(maintenance, release('terminal_observed'), releaseCtx('terminal_observed')))
      .toEqual({ ok: true, next: maintenance, effects: [] });
  });

  it('SES-18: an empty occupancy is an empty transition (SD-1), even before the phase checks', () => {
    const ctx = releaseCtx('terminal_observed', { holder: holderFor('terminal_observed', { after: 'run_running' }) });
    expect(transitionSession(IDLE, release('terminal_observed'), ctx)).toEqual({ ok: true, next: IDLE, effects: [] });
  });

  it('a release needs the holder context and a holder of the cause\'s kind', () => {
    expect(run(HELD_BY_RUN, release('terminal_observed'), ctxOf())).toEqual(refused('illegal', 'invalid'));
    const queryForRunCause = releaseCtx('terminal_observed', { holder: { ...holderFor('terminal_observed'), ref: QUERY_A } });
    expect(run(HELD_BY_QUERY, release('terminal_observed'), queryForRunCause)).toEqual(refused('illegal', 'invalid'));
    const queryPhase = releaseCtx('terminal_observed', { holder: holderFor('terminal_observed', { after: 'query_settled' }) });
    expect(run(HELD_BY_RUN, release('terminal_observed'), queryPhase)).toEqual(refused('illegal', 'invalid'));
    const runBefore = releaseCtx('query_terminal_observed', { holder: holderFor('query_terminal_observed', { before: 'run_running' }) });
    expect(run(HELD_BY_QUERY, release('query_terminal_observed'), runBefore)).toEqual(refused('illegal', 'invalid'));
  });

  it.each(['run_starting', 'run_running'] as const)('a holder still %s cannot release (illegal)', (after) => {
    for (const cause of SESSION_RELEASE_CAUSES.filter((candidate) => CAUSES[candidate].holder === 'run')) {
      const ctx = releaseCtx(cause, { holder: holderFor(cause, { after }) });
      expect(run(HELD_BY_RUN, release(cause), ctx), cause).toEqual(refused('illegal', 'invalid'));
    }
  });

  it.each(['query_claimed', 'query_prepared', 'query_entering', 'query_entered'] as const)(
    'a QueryRun still %s cannot release (illegal)', (after) => {
      for (const cause of SESSION_RELEASE_CAUSES.filter((candidate) => CAUSES[candidate].holder === 'query')) {
        const ctx = releaseCtx(cause, { holder: holderFor(cause, { after }) });
        expect(run(HELD_BY_QUERY, release(cause), ctx), cause).toEqual(refused('illegal', 'invalid'));
      }
    });

  it('an outcome_unknown holder keeps the occupancy: a misdirected release is busy (RUN-08, D-4)', () => {
    for (const cause of SESSION_RELEASE_CAUSES) {
      const isRun = CAUSES[cause].holder === 'run';
      const ctx = releaseCtx(cause, { holder: holderFor(cause, { after: isRun ? 'run_ended_unknown' : 'query_unknown' }) });
      expect(run(isRun ? HELD_BY_RUN : HELD_BY_QUERY, release(cause), ctx), cause).toEqual(refused('guard_failed', 'busy'));
    }
  });

  it('unconfirmed Turn inputs refuse the release with unavailable (§10.3)', () => {
    for (const inputsConfirmed of [false, 'kernel_unreadable'] as const) {
      for (const cause of ['terminal_observed', 'query_terminal_observed', 'query_reconcile_terminal'] as const) {
        const held = CAUSES[cause].holder === 'run' ? HELD_BY_RUN : HELD_BY_QUERY;
        const ctx = releaseCtx(cause, { holder: holderFor(cause, { inputsConfirmed }) });
        expect(run(held, release(cause), ctx), `${cause}/${String(inputsConfirmed)}`).toEqual(refused('guard_failed', 'unavailable'));
      }
    }
  });

  it('a Kernel terminal cannot carry an open Kernel Turn', () => {
    const ctx = releaseCtx('terminal_observed', { holder: holderFor('terminal_observed', { kernelTurnOpen: true }) });
    expect(run(HELD_BY_RUN, release('terminal_observed'), ctx)).toEqual(refused('illegal', 'invalid'));
  });

  it('the reconcile path of SES-08 needs the instance lease and a conclusive probe', () => {
    const cause = 'query_reconcile_terminal';
    for (const hostLease of ['held_by_other', null] as const) {
      expect(run(HELD_BY_QUERY, release(cause), releaseCtx(cause, { hostLease }))).toEqual(refused('guard_failed', 'busy'));
    }
    for (const probe of ['host_config', 'transient', 'cancelled'] as const) {
      expect(run(HELD_BY_QUERY, release(cause), releaseCtx(cause, { probe }))).toEqual(refused('guard_failed', 'unavailable'));
    }
    expect(run(HELD_BY_QUERY, release(cause), releaseCtx(cause, { caller: 'service' }))).toEqual(refused('illegal', 'forbidden'));
    // The in-process observer is not the reconcile: no lease involved.
    expect(run(HELD_BY_QUERY, release('query_terminal_observed'), releaseCtx('query_terminal_observed', { hostLease: 'held_by_other' })).ok)
      .toBe(true);
  });
});

describe('SES-05: the D-7 stop of a Run that never entered (step 5.1)', () => {
  const release: SessionEvent = { kind: 'occupancy_released', cause: 'stop_not_entered' };
  const holder = (overrides: Partial<SessionHolderContext>): SessionGuardContext =>
    releaseCtx('stop_not_entered', { holder: holderFor('stop_not_entered', overrides) });

  it('releases the occupancy and keeps historyCursor: there is no Turn and nothing to confirm', () => {
    expect(transitionSession(HELD_BY_RUN, release, holder({ inputsConfirmed: false }))).toEqual({ ok: true,
      next: { ...(HELD_BY_RUN as Exclude<SessionMachineState, 'absent'>), occupancy: null, revision: REVISION + 1 },
      effects: [{ kind: 'release_session', holder: RUN_A, generation: GENERATION, historyCursor: { kind: 'keep' },
        kernelTurnOpen: false }] });
  });

  it('refuses a holder that reached Entering or the Kernel (illegal/invalid)', () => {
    for (const overrides of [{ before: 'run_running' as const }, { kernelTurnSeen: true }, { kernelTurnOpen: true }]) {
      expect(transitionSession(HELD_BY_RUN, release, holder(overrides)), JSON.stringify(overrides)).toEqual({ ok: false,
        reason: 'illegal', code: 'invalid', detail: 'stop_not_entered releases only a Run that never entered (SES-05, D-7)' });
    }
  });

  it('is an empty transition when the Run no longer holds the Session (SES-17/18, SD-1)', () => {
    expect(run(HELD_BY_RUN, release, holder({ claimGeneration: GENERATION + 1 }))).toEqual(legal(HELD_BY_RUN));
    expect(run(IDLE, release, holder({}))).toEqual(legal(IDLE));
  });
});

describe('SES-06/07/09/10: the release rows A.2 step 5.6 adds', () => {
  const release = (cause: SessionReleaseCause): SessionEvent => ({ kind: 'occupancy_released', cause });
  // K3's `reconcile_takeover_unresolved` (U2) rides SES-06 but is not a step 5.6 row; K3-30 asserts it.
  const newCauses = SESSION_RELEASE_CAUSES.filter((cause) =>
    !IMPLEMENTED_CAUSES.has(cause) && cause !== 'reconcile_takeover_unresolved');
  const heldBy = (cause: SessionReleaseCause): SessionMachineState => CAUSES[cause].holder === 'run' ? HELD_BY_RUN : HELD_BY_QUERY;

  it('lists exactly the causes step 5.6 adds', () => {
    expect(newCauses).toEqual([
      'reconcile_terminal', 'reconcile_interrupted_clean', 'late_evidence', 'stop_paused',
      'unknown_attested', 'query_reconcile_not_entered', 'query_reconcile_interrupted_clean', 'query_unknown_attested',
    ]);
  });

  it('SES-06: a Kernel terminal advances the cursor; a Turn left open keeps it and retires the Session (LA-1)', () => {
    for (const cause of ['reconcile_terminal', 'late_evidence'] as const) {
      expect(transitionSession(HELD_BY_RUN, release(cause), releaseCtx(cause))).toEqual({ ok: true,
        next: { ...(HELD_BY_RUN as Exclude<SessionMachineState, 'absent'>), occupancy: null, revision: REVISION + 1 },
        effects: [{ kind: 'release_session', holder: RUN_A, generation: GENERATION, historyCursor: { kind: 'advance', cursor: BOUNDARY },
          kernelTurnOpen: false }] });
    }
    for (const cause of ['reconcile_interrupted_clean', 'stop_paused'] as const) {
      const result = transitionSession(HELD_BY_RUN, release(cause), releaseCtx(cause));
      expect(result).toEqual({ ok: true,
        next: { ...(HELD_BY_RUN as Exclude<SessionMachineState, 'absent'>), health: 'unavailable', healthConclusion: 'kernel_turn_open',
          occupancy: null, revision: REVISION + 1 },
        effects: [{ kind: 'release_session', holder: RUN_A, generation: GENERATION, historyCursor: { kind: 'keep' }, kernelTurnOpen: true }] });
      // The retired Session takes no new execution (I-2, SES-02).
      if (result.ok && result.next !== 'absent') {
        expect(run(result.next, { kind: 'occupancy_acquired', holder: RUN_B }, ctxOf())).toEqual(refused('guard_failed', 'busy'));
      }
    }
  });

  it('SES-07 / SES-10: an attestation keeps the cursor; only an open or unreadable Turn retires the Session', () => {
    for (const cause of ['unknown_attested', 'query_unknown_attested'] as const) {
      const holder = CAUSES[cause].holder === 'run' ? RUN_A : QUERY_A;
      expect(run(heldBy(cause), release(cause), releaseCtx(cause))).toEqual(legal(
        { ...(heldBy(cause) as Exclude<SessionMachineState, 'absent'>), occupancy: null, revision: REVISION + 1 },
        [{ kind: 'release_session', holder, generation: GENERATION, historyCursor: { kind: 'keep' }, kernelTurnOpen: false }]));
      const unreadable = releaseCtx(cause, { holder: holderFor(cause, { inputsConfirmed: 'kernel_unreadable', kernelTurnOpen: true }) });
      expect(run(heldBy(cause), release(cause), unreadable)).toEqual(legal(
        { ...(heldBy(cause) as Exclude<SessionMachineState, 'absent'>), health: 'unavailable', healthConclusion: 'kernel_turn_open',
          occupancy: null, revision: REVISION + 1 },
        [{ kind: 'release_session', holder, generation: GENERATION, historyCursor: { kind: 'keep' }, kernelTurnOpen: true }]));
    }
    expect(run(HELD_BY_RUN, release('unknown_attested'), releaseCtx('unknown_attested',
      { holder: holderFor('unknown_attested', { before: 'run_running' }) }))).toEqual(refused('illegal', 'invalid'));
  });

  it('SES-09: a QueryRun close keeps the cursor; an open Kernel Turn retires the Session', () => {
    for (const cause of ['query_reconcile_not_entered', 'query_reconcile_interrupted_clean'] as const) {
      expect(run(HELD_BY_QUERY, release(cause), releaseCtx(cause))).toEqual(legal(
        { ...(HELD_BY_QUERY as Exclude<SessionMachineState, 'absent'>), occupancy: null, revision: REVISION + 1 },
        [{ kind: 'release_session', holder: QUERY_A, generation: GENERATION, historyCursor: { kind: 'keep' }, kernelTurnOpen: false }]));
    }
    const open = releaseCtx('query_reconcile_interrupted_clean',
      { holder: holderFor('query_reconcile_interrupted_clean', { kernelTurnOpen: true }) });
    expect(run(HELD_BY_QUERY, release('query_reconcile_interrupted_clean'), open)).toMatchObject({ ok: true,
      next: { health: 'unavailable', healthConclusion: 'kernel_turn_open', occupancy: null } });
  });

  it('the §8.4 refusals in front of them', () => {
    // Restart releases are reconcile-only (SES-06 R causes, SES-09).
    for (const cause of ['reconcile_terminal', 'reconcile_interrupted_clean', 'query_reconcile_not_entered',
      'query_reconcile_interrupted_clean'] as const) {
      expect(run(heldBy(cause), release(cause), releaseCtx(cause, { caller: 'service' })), cause).toEqual(refused('illegal', 'forbidden'));
      expect(run(heldBy(cause), release(cause), releaseCtx(cause, { hostLease: 'held_by_other' })), cause).toEqual(refused('guard_failed', 'busy'));
      expect(run(heldBy(cause), release(cause), releaseCtx(cause, { probe: 'transient' })), cause).toEqual(refused('guard_failed', 'unavailable'));
    }
    // Human attestation needs the instance lease (L-1), and accepts an unreadable Kernel (above).
    for (const cause of ['unknown_attested', 'query_unknown_attested'] as const) {
      for (const hostLease of ['held_by_other', null] as const) {
        expect(run(heldBy(cause), release(cause), releaseCtx(cause, { hostLease })), cause).toEqual(refused('guard_failed', 'busy'));
      }
      const unconfirmed = releaseCtx(cause, { holder: holderFor(cause, { inputsConfirmed: false }) });
      expect(run(heldBy(cause), release(cause), unconfirmed), cause).toEqual(refused('guard_failed', 'unavailable'));
    }
    // An outcome_unknown holder keeps the Session (I-2, D-4).
    expect(run(HELD_BY_RUN, release('reconcile_terminal'), releaseCtx('reconcile_terminal',
      { holder: holderFor('reconcile_terminal', { after: 'run_ended_unknown' }) }))).toEqual(refused('guard_failed', 'busy'));
    // A Turn that exists needs confirmed inputs; a D-7 stop without a Turn does not.
    const stopWithTurn = releaseCtx('stop_paused', { holder: holderFor('stop_paused', { inputsConfirmed: 'kernel_unreadable' }) });
    expect(run(HELD_BY_RUN, release('stop_paused'), stopWithTurn)).toEqual(refused('guard_failed', 'unavailable'));
    const notEntered = releaseCtx('stop_not_entered', { holder: holderFor('stop_not_entered', { inputsConfirmed: false }) });
    expect(run(HELD_BY_RUN, release('stop_not_entered'), notEntered)).toMatchObject({ ok: true });
  });
});

describe('SES-11 session_archived / SES-14 session_reactivated', () => {
  const archive: SessionEvent = { kind: 'session_archived' };
  const reactivate: SessionEvent = { kind: 'session_reactivated' };

  it('archiving does not look at health: unavailable archives to unavailable', () => {
    const result = run(TURN_OPEN, archive, ctxOf({ pin: REVISION, openResponsibleLink: false }));
    expect(result).toEqual(legal({ ...TURN_OPEN, lifecycle: 'archived', revision: REVISION + 1 },
      [{ kind: 'archive_session' }, { kind: 'emit_event', eventType: 'SessionArchived' }]));
  });

  it('an open responsible link blocks; the link read is required', () => {
    expect(run(IDLE, archive, ctxOf({ openResponsibleLink: 'task' }))).toEqual(refused('guard_failed', 'dependency_blocked'));
    expect(run(IDLE, archive, ctxOf({ openResponsibleLink: null }))).toEqual(refused('illegal', 'invalid'));
  });

  it('the refusal names the blocking target kind, as today\'s service reason does', () => {
    for (const kind of ['task', 'work'] as const) {
      expect(transitionSession(IDLE, archive, ctxOf({ openResponsibleLink: kind }))).toEqual({
        ok: false, reason: 'guard_failed', code: 'dependency_blocked',
        detail: `the Session still has an unresolved responsible ${kind} obligation`,
      });
    }
  });

  it('the link fact: the first open responsible task/work link; closed, other relations and modules never block', () => {
    const task: WorkLinkTarget = { kind: 'task', ref: { projectId: 'p1', goalId: 'g1', taskId: 't1' } };
    const work: WorkLinkTarget = { kind: 'work', ref: { aggregateType: 'WorkContextBinding', projectId: 'p1', workspaceId: 'w1', workId: 'k1' } };
    const mod: WorkLinkTarget = { kind: 'module', ref: { projectId: 'p1', moduleId: 'm1' } };
    const link = (target: WorkLinkTarget, relation: WorkLinkRelation, open: boolean): Pick<SessionWorkLink, 'ref' | 'until'> => ({
      ref: { aggregateType: 'SessionWorkLink', projectId: 'p1', sessionId: 's1', target, relation },
      until: open ? null : makeCommitCursor(3),
    });
    expect(openResponsibleLinkOf([])).toBe(false);
    expect(openResponsibleLinkOf([
      link(task, 'responsible', false), link(mod, 'responsible', true), link(work, 'participates', true),
      link(task, 'investigated', true),
    ])).toBe(false);
    expect(openResponsibleLinkOf([link(mod, 'responsible', true), link(work, 'responsible', true), link(task, 'responsible', true)]))
      .toBe('work');
    expect(openResponsibleLinkOf([link(task, 'responsible', true), link(work, 'responsible', true)])).toBe('task');
  });

  it('guard order: archived → occupied → links → pin', () => {
    const archivedIdle = { ...IDLE, lifecycle: 'archived' as const };
    expect(run(archivedIdle, archive, ctxOf({ pin: 1, openResponsibleLink: 'task' }))).toEqual(refused('illegal', 'invalid'));
    expect(run(HELD_BY_RUN, archive, ctxOf({ pin: 1, openResponsibleLink: 'task' }))).toEqual(refused('guard_failed', 'busy'));
    expect(run(IDLE, archive, ctxOf({ pin: 1, openResponsibleLink: 'work' }))).toEqual(refused('guard_failed', 'dependency_blocked'));
    expect(run(IDLE, archive, ctxOf({ pin: 1, openResponsibleLink: false }))).toEqual(refused('stale', 'revision_conflict'));
  });

  it('reactivation of an unavailable Session is refused with unavailable (decision 38, S1-SES-05)', () => {
    // Slice 1: retire/reactivation keeps the old archived-unavailable refusal; the
    // health is no longer silently carried into a new active life.
    const archivedUnavailable = { ...TURN_OPEN, lifecycle: 'archived' as const };
    expect(run(archivedUnavailable, reactivate, ctxOf({ pin: REVISION }))).toEqual(refused('guard_failed', 'unavailable'));
  });

  it('reactivation: active is invalid, a stale pin is revision_conflict', () => {
    expect(run(IDLE, reactivate, ctxOf())).toEqual(refused('illegal', 'invalid'));
    expect(run({ ...IDLE, lifecycle: 'archived' }, reactivate, ctxOf({ pin: 3 }))).toEqual(refused('stale', 'revision_conflict'));
  });
});

describe('SES-12/SES-13/SES-19 health_observed (A.2 step 5.6)', () => {
  const observe = (observed: SessionHealth): SessionEvent => ({ kind: 'health_observed', observed });
  const reconcile = (overrides: Partial<SessionGuardContext>): SessionGuardContext =>
    ctxOf({ caller: 'reconcile', hostLease: 'owned', ...overrides });

  it('refusal order: recoverable → caller → archived → lease → probe', () => {
    expect(run(IDLE, observe('recoverable'), ctxOf())).toEqual(refused('illegal', 'unsupported'));
    expect(run(IDLE, observe('unavailable'), ctxOf({ probe: 'missing' }))).toEqual(refused('illegal', 'forbidden'));
    expect(run({ ...IDLE, lifecycle: 'archived' }, observe('unavailable'), reconcile({ hostLease: null, probe: 'missing' })))
      .toEqual(refused('illegal', 'invalid'));
    for (const hostLease of ['held_by_other', null] as const) {
      expect(run(IDLE, observe('unavailable'), reconcile({ hostLease, probe: 'missing' }))).toEqual(refused('guard_failed', 'busy'));
    }
    expect(run(IDLE, observe('unavailable'), reconcile({ probe: null }))).toEqual(refused('illegal', 'invalid'));
  });

  it.each(['host_config', 'transient', 'cancelled'] as const)('a %s probe observes nothing', (probe) => {
    for (const observed of ['available', 'unavailable'] as const) {
      expect(run(HELD_BY_RUN, observe(observed), reconcile({ probe }))).toEqual(refused('guard_failed', 'unavailable'));
    }
  });

  it('the observation must agree with the probe; kernel_turn_open is never a probe verdict', () => {
    expect(run(IDLE, observe('unavailable'), reconcile({ probe: 'ready', kernelHeader: { activeRunId: null } })))
      .toEqual(refused('illegal', 'invalid'));
    for (const probe of ['missing', 'damaged'] as const) {
      expect(run(TURN_OPEN, observe('available'), reconcile({ probe }))).toEqual(refused('illegal', 'invalid'));
    }
  });

  it('kernel_turn_open stays while the Kernel head still has an active run (or no head was read); a closed head clears it', () => {
    for (const kernelHeader of [{ activeRunId: 'kernel-run-1' }, null]) {
      expect(run(TURN_OPEN, observe('available'), reconcile({ probe: 'ready', kernelHeader }))).toEqual(refused('guard_failed', 'unavailable'));
    }
    expect(run(TURN_OPEN, observe('available'), reconcile({ probe: 'ready', kernelHeader: { activeRunId: null } })))
      .toEqual(legal({ ...TURN_OPEN, health: 'available', healthConclusion: null, revision: REVISION + 1 }, [
        { kind: 'observe_health', health: 'available', conclusion: null }, { kind: 'emit_event', eventType: 'SessionHealthObserved' }]));
  });

  it('SES-12 writes the probe conclusion; SES-13 clears it; SES-19 writes nothing; health never touches the occupancy', () => {
    const missing = reconcile({ probe: 'missing' });
    const ready = reconcile({ probe: 'ready', kernelHeader: { activeRunId: null } });
    expect(run(HELD_BY_RUN, observe('unavailable'), missing)).toEqual(legal(
      { ...(HELD_BY_RUN as Exclude<SessionMachineState, 'absent'>), health: 'unavailable', healthConclusion: 'missing', revision: REVISION + 1 },
      [{ kind: 'observe_health', health: 'unavailable', conclusion: 'missing' }, { kind: 'emit_event', eventType: 'SessionHealthObserved' }]));
    const damaged = { ...(IDLE as Exclude<SessionMachineState, 'absent'>), health: 'unavailable' as const, healthConclusion: 'damaged' as const };
    expect(run(damaged, observe('available'), ready)).toEqual(legal({ ...damaged, health: 'available', healthConclusion: null,
      revision: REVISION + 1 }, [{ kind: 'observe_health', health: 'available', conclusion: null },
      { kind: 'emit_event', eventType: 'SessionHealthObserved' }]));
    expect(run(IDLE, observe('available'), ready)).toEqual(legal(IDLE));
    // A missing/damaged probe never replaces kernel_turn_open: the same health is SES-19.
    expect(run(TURN_OPEN, observe('unavailable'), missing)).toEqual(legal(TURN_OPEN));
  });

  it('SES-19a: the Turn closure replaces kernel_turn_open with its fresh missing/damaged probe under the SES-12 lease guard', () => {
    for (const probe of ['missing', 'damaged'] as const) {
      const closure = reconcile({ caller: 'turn_closure', probe });
      expect(run(TURN_OPEN, observe('unavailable'), closure)).toEqual(legal(
        { ...(TURN_OPEN as Exclude<SessionMachineState, 'absent'>), health: 'unavailable', healthConclusion: probe,
          revision: REVISION + 1 },
        [{ kind: 'observe_health', health: 'unavailable', conclusion: probe },
          { kind: 'emit_event', eventType: 'SessionHealthObserved' }]));
    }
    // The reconcile caller keeps SES-19 exactly: its missing/damaged probe never replaces kernel_turn_open.
    expect(run(TURN_OPEN, observe('unavailable'), reconcile({ probe: 'missing' }))).toEqual(legal(TURN_OPEN));
    expect(run(TURN_OPEN, observe('unavailable'), reconcile({ probe: 'damaged' }))).toEqual(legal(TURN_OPEN));
    // A caller that is neither the reconcile nor the Turn closure stays forbidden.
    expect(run(TURN_OPEN, observe('unavailable'), ctxOf({ probe: 'missing' }))).toEqual(refused('illegal', 'forbidden'));
    // The same Host-lease guard as SES-12.
    for (const hostLease of ['held_by_other', null] as const) {
      expect(run(TURN_OPEN, observe('unavailable'), reconcile({ caller: 'turn_closure', probe: 'missing', hostLease })))
        .toEqual(refused('guard_failed', 'busy'));
    }
    // The Kernel head rule is SES-13's and does not apply to a missing/damaged probe.
    expect(run(TURN_OPEN, observe('unavailable'), reconcile({ caller: 'turn_closure', probe: 'missing',
      kernelHeader: { activeRunId: 'kernel-run-1' } }))).toEqual(legal(
      { ...(TURN_OPEN as Exclude<SessionMachineState, 'absent'>), health: 'unavailable', healthConclusion: 'missing',
        revision: REVISION + 1 },
      [{ kind: 'observe_health', health: 'unavailable', conclusion: 'missing' },
        { kind: 'emit_event', eventType: 'SessionHealthObserved' }]));
  });
});

describe('SES-15/SES-16 work_linked', () => {
  const open: SessionEvent = { kind: 'work_linked', active: true };
  const close: SessionEvent = { kind: 'work_linked', active: false };
  const link = (overrides: Partial<NonNullable<SessionGuardContext['link']>>) =>
    ({ exists: true, open: true, targetValid: true, pin: null, ...overrides });

  it('requires the link facts', () => {
    expect(run(IDLE, open, ctxOf())).toEqual(refused('illegal', 'invalid'));
    expect(run(IDLE, close, ctxOf())).toEqual(refused('illegal', 'invalid'));
  });

  it('opening: archived is busy, an invalid target is not_found, a stale Session pin is revision_conflict', () => {
    const archived = { ...IDLE, lifecycle: 'archived' as const };
    expect(run(archived, open, ctxOf({ pin: 1, link: link({ targetValid: false }) }))).toEqual(refused('guard_failed', 'busy'));
    expect(run(IDLE, open, ctxOf({ pin: 1, link: link({ targetValid: false }) }))).toEqual(refused('guard_failed', 'not_found'));
    expect(run(IDLE, open, ctxOf({ pin: 1, link: link({}) }))).toEqual(refused('stale', 'revision_conflict'));
  });

  it('closing: a missing link is not_found, a closed link is invalid, a stale pin is revision_conflict; archived may close', () => {
    expect(run(IDLE, close, ctxOf({ pin: 1, link: link({ exists: false, open: false }) }))).toEqual(refused('guard_failed', 'not_found'));
    expect(run(IDLE, close, ctxOf({ pin: 1, link: link({ open: false }) }))).toEqual(refused('illegal', 'invalid'));
    expect(run(IDLE, close, ctxOf({ pin: 1, link: link({}) }))).toEqual(refused('stale', 'revision_conflict'));
    const archived = { ...IDLE, lifecycle: 'archived' as const };
    expect(run(archived, close, ctxOf({ link: link({}) })).ok).toBe(true);
  });
});

// --------------------------------------------------------------------------
// Shared rules
// --------------------------------------------------------------------------

describe('deriveAvailability: the 18 dimension combinations (§8.1)', () => {
  const OCC = { null: null, execution: { kind: 'execution' }, maintenance: { kind: 'maintenance' } } as const;
  const TABLE: readonly [number, SessionLifecycle, SessionHealth, keyof typeof OCC, string][] = [
    [1, 'active', 'available', 'null', 'idle'],
    [2, 'active', 'available', 'execution', 'busy'],
    [3, 'active', 'available', 'maintenance', 'busy'],
    [4, 'active', 'recoverable', 'null', 'recoverable'],
    [5, 'active', 'recoverable', 'execution', 'busy'],
    [6, 'active', 'recoverable', 'maintenance', 'busy'],
    [7, 'active', 'unavailable', 'null', 'unavailable'],
    [8, 'active', 'unavailable', 'execution', 'unavailable'],
    [9, 'active', 'unavailable', 'maintenance', 'unavailable'],
    [10, 'archived', 'available', 'null', 'unavailable'],
    [11, 'archived', 'available', 'execution', 'unavailable'],
    [12, 'archived', 'available', 'maintenance', 'unavailable'],
    [13, 'archived', 'recoverable', 'null', 'unavailable'],
    [14, 'archived', 'recoverable', 'execution', 'unavailable'],
    [15, 'archived', 'recoverable', 'maintenance', 'unavailable'],
    [16, 'archived', 'unavailable', 'null', 'unavailable'],
    [17, 'archived', 'unavailable', 'execution', 'unavailable'],
    [18, 'archived', 'unavailable', 'maintenance', 'unavailable'],
  ];

  it.each(TABLE)('#%i %s / %s / %s → %s', (_row, lifecycle, health, occupancy, availability) => {
    expect(deriveAvailability({ lifecycle, health, occupancy: OCC[occupancy] })).toBe(availability);
  });

  it('agrees on records and machine states', () => {
    for (const desc of DIMENSION_STATES) {
      const state = machineState(desc);
      const record = recordOf({
        lifecycle: desc.lifecycle, health: desc.health, healthConclusion: desc.conclusion,
        occupancy: desc.occ === 'none' ? null
          : desc.occ === 'maintenance' ? { kind: 'maintenance', operationRef: OPERATION, generation: GENERATION }
            : { kind: 'execution', executionRef: desc.occ === 'run' ? RUN_A : QUERY_A, generation: GENERATION },
      });
      expect(deriveAvailability(record), labelOf(desc)).toBe(deriveAvailability(state));
      expect(sessionMachineStateOf(record), labelOf(desc)).toEqual(state);
    }
  });
});

describe('nextOccupancyGeneration / ownsOccupancy / ownsQuery', () => {
  it('generation is revision + 1; unreadable and unsafe revisions carry today\'s codes', () => {
    expect(nextOccupancyGeneration(1)).toEqual({ ok: true, generation: 2 });
    for (const revision of [0, -3, 2.5, Number.NaN]) {
      expect(nextOccupancyGeneration(revision)).toMatchObject({ ok: false, code: 'unavailable' });
    }
    expect(nextOccupancyGeneration(Number.MAX_SAFE_INTEGER)).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('holds only for the same execution ref at the claim generation', () => {
    const record = recordOf({ occupancy: { kind: 'execution', executionRef: RUN_A, generation: GENERATION } });
    expect(ownsOccupancy(record, { goalId: 'g1', runId: 'run-a', aggregateType: 'Run', projectId: 'p1' }, GENERATION)).toBe(true);
    expect(ownsOccupancy(record, RUN_A, GENERATION + 1)).toBe(false);
    expect(ownsOccupancy(record, RUN_B, GENERATION)).toBe(false);
    expect(ownsOccupancy(recordOf(), RUN_A, GENERATION)).toBe(false);
    expect(ownsOccupancy(recordOf({ occupancy: { kind: 'maintenance', operationRef: OPERATION, generation: GENERATION } }),
      RUN_A, GENERATION)).toBe(false);
  });

  it('ignores lifecycle and health (the callers keep their own checks and codes)', () => {
    const record = recordOf({ lifecycle: 'archived', health: 'unavailable', healthConclusion: 'damaged',
      occupancy: { kind: 'execution', executionRef: QUERY_A, generation: GENERATION } });
    expect(ownsQuery(record, QUERY_A, { sessionGeneration: GENERATION })).toBe(true);
    expect(ownsQuery(record, QUERY_A, { sessionGeneration: GENERATION - 1 })).toBe(false);
    expect(ownsQuery(record, QUERY_B, { sessionGeneration: GENERATION })).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Record constructors (§14.1)
// --------------------------------------------------------------------------

const SESSION_REF: SessionAggregateRef = { aggregateType: 'Session', projectId: 'p1', sessionId: 's1' };
const ROLE: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'tpl-1', templateRevision: 'r1' };

function recordOf(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    ref: SESSION_REF, revision: REVISION, kernel: { adapterId: 'coding-agent', kernelSessionId: 'k-1' },
    lifecycle: 'active', health: 'available', role: ROLE, workspaceId: 'w1', lastExecutionRef: null,
    occupancy: null, historyCursor: 'cursor-old', createdAt: '2026-10-01T00:00:00.000Z', archivedAt: null,
    ...overrides,
  };
}

/** The machine's `next` equals the projection of the record the named constructor writes. */
function expectConsistent(record: SessionRecord, event: SessionEvent, ctx: SessionGuardContext, write: (effect: SessionEffect) => SessionRecord | null): SessionRecord {
  const result = transitionSession(sessionMachineStateOf(record), event, ctx);
  if (!result.ok) throw new Error(`expected a legal transition: ${result.detail}`);
  const written = result.effects.map(write).filter((value): value is SessionRecord => value !== null);
  expect(written).toHaveLength(1);
  const [next] = written as [SessionRecord];
  expect(sessionMachineStateOf(next)).toEqual(result.next);
  return next;
}

describe('createSessionRecord', () => {
  it('writes today\'s SES-01 literal (same fields, same order, no healthConclusion field)', () => {
    const record = createSessionRecord({
      ref: SESSION_REF, kernel: { adapterId: 'coding-agent', kernelSessionId: 'k-1' }, role: ROLE, workspaceId: 'w1',
      createdAt: '2026-10-04T00:00:00.000Z',
    });
    expect(record).toEqual({
      ref: SESSION_REF, revision: 1, kernel: { adapterId: 'coding-agent', kernelSessionId: 'k-1' },
      lifecycle: 'active', health: 'available', role: ROLE, workspaceId: 'w1', lastExecutionRef: null,
      occupancy: null, historyCursor: null, createdAt: '2026-10-04T00:00:00.000Z', archivedAt: null,
    });
    expect(Object.keys(record)).toEqual(['ref', 'revision', 'kernel', 'lifecycle', 'health', 'role', 'workspaceId',
      'lastExecutionRef', 'occupancy', 'historyCursor', 'createdAt', 'archivedAt']);
    const created = transitionSession('absent', { kind: 'session_created' }, ctxOf({ creation: CREATION }));
    expect(created.ok && created.next).toEqual(sessionMachineStateOf(record));
  });
});

describe('occupySessionRecord', () => {
  it('is the record of SES-02/03', () => {
    const record = recordOf();
    for (const holder of [RUN_B, QUERY_B]) {
      const next = expectConsistent(record, { kind: 'occupancy_acquired', holder }, ctxOf({ pin: REVISION }),
        (effect) => effect.kind === 'occupy_session' ? occupySessionRecord(record, effect) : null);
      expect(next).toEqual({ ...record, revision: REVISION + 1, lastExecutionRef: holder,
        occupancy: { kind: 'execution', executionRef: holder, generation: REVISION + 1 } });
      expect(Object.keys(next)).toEqual(Object.keys(record));
    }
  });

  it('refuses archived, occupied and not-available records and a generation other than revision + 1', () => {
    const occupation = { holder: RUN_B, generation: REVISION + 1 };
    expect(() => occupySessionRecord(recordOf({ lifecycle: 'archived' }), occupation)).toThrow(/archived/);
    expect(() => occupySessionRecord(recordOf({ occupancy: { kind: 'execution', executionRef: RUN_A, generation: GENERATION } }),
      occupation)).toThrow(/occupied/);
    // SES-02/03 and §8.4: any health other than available (kernel_turn_open, missing, damaged, or no conclusion; recoverable).
    const notAvailable: readonly Partial<SessionRecord>[] = [
      { health: 'unavailable', healthConclusion: 'kernel_turn_open' },
      { health: 'unavailable', healthConclusion: 'missing' },
      { health: 'unavailable', healthConclusion: 'damaged' },
      { health: 'unavailable' },
      { health: 'recoverable' },
    ];
    for (const overrides of notAvailable) {
      expect(() => occupySessionRecord(recordOf(overrides), occupation), JSON.stringify(overrides)).toThrow(/only an available Session/);
    }
    expect(() => occupySessionRecord(recordOf(), { holder: RUN_B, generation: REVISION })).toThrow(/revision \+ 1/);
  });
});

describe('releaseSessionRecord', () => {
  const held = recordOf({ lastExecutionRef: RUN_A, occupancy: { kind: 'execution', executionRef: RUN_A, generation: GENERATION } });

  it('is the record of SES-04: cursor advances, health untouched, no healthConclusion field added', () => {
    const next = expectConsistent(held, { kind: 'occupancy_released', cause: 'terminal_observed' }, releaseCtx('terminal_observed'),
      (effect) => effect.kind === 'release_session' ? releaseSessionRecord(held, effect) : null);
    expect(next).toEqual({ ...held, revision: REVISION + 1, occupancy: null, lastExecutionRef: RUN_A, historyCursor: BOUNDARY });
    expect(Object.keys(next)).toEqual(Object.keys(held));
  });

  it('keeps the cursor byte-for-byte without a boundary (never null)', () => {
    const next = releaseSessionRecord(held, { holder: RUN_A, generation: GENERATION, historyCursor: { kind: 'keep' }, kernelTurnOpen: false });
    expect(next.historyCursor).toBe('cursor-old');
    const fromNull = releaseSessionRecord({ ...held, historyCursor: null },
      { holder: RUN_A, generation: GENERATION, historyCursor: { kind: 'keep' }, kernelTurnOpen: false });
    expect(fromNull.historyCursor).toBeNull();
  });

  it('kernelTurnOpen writes unavailable/kernel_turn_open in the same record and keeps the cursor (SD-2, LA-1)', () => {
    const next = releaseSessionRecord(held, { holder: RUN_A, generation: GENERATION, historyCursor: { kind: 'keep' }, kernelTurnOpen: true });
    expect(next).toEqual({ ...held, revision: REVISION + 1, occupancy: null, lastExecutionRef: RUN_A, historyCursor: 'cursor-old',
      health: 'unavailable', healthConclusion: 'kernel_turn_open', unavailableSince: null });
    expect(deriveAvailability(next)).toBe('unavailable');
    // An unreadable Kernel (missing/damaged) is overwritten by kernel_turn_open (SES-07).
    const missing = { ...held, health: 'unavailable' as const, healthConclusion: 'missing' as const };
    expect(releaseSessionRecord(missing, { holder: RUN_A, generation: GENERATION, historyCursor: { kind: 'keep' }, kernelTurnOpen: true })
      .healthConclusion).toBe('kernel_turn_open');
    // Without kernelTurnOpen an existing conclusion is left as it is.
    expect(releaseSessionRecord(missing, { holder: RUN_A, generation: GENERATION, historyCursor: { kind: 'keep' }, kernelTurnOpen: false }))
      .toMatchObject({ health: 'unavailable', healthConclusion: 'missing', occupancy: null });
  });

  it('refuses kernelTurnOpen together with an advancing cursor (§14.5: kernel_turn_open keeps historyCursor)', () => {
    const advance = { kind: 'advance', cursor: BOUNDARY } as const;
    // @ts-expect-error a release that leaves the Kernel Turn open has no `advance`
    const typed: Parameters<typeof releaseSessionRecord>[1] = { holder: RUN_A, generation: GENERATION, historyCursor: advance, kernelTurnOpen: true };
    expect(() => releaseSessionRecord(held, typed)).toThrow(/keeps historyCursor/);
    const missing = { ...held, health: 'unavailable' as const, healthConclusion: 'missing' as const };
    expect(() => releaseSessionRecord(missing, typed)).toThrow(/keeps historyCursor/);
  });

  it('only the current holder at its generation releases', () => {
    const release = { historyCursor: { kind: 'keep' } as const, kernelTurnOpen: false };
    expect(() => releaseSessionRecord(held, { ...release, holder: RUN_B, generation: GENERATION })).toThrow(/current holder/);
    expect(() => releaseSessionRecord(held, { ...release, holder: RUN_A, generation: GENERATION + 1 })).toThrow(/current holder/);
    expect(() => releaseSessionRecord(recordOf(), { ...release, holder: RUN_A, generation: GENERATION })).toThrow(/current holder/);
  });
});

describe('archiveSessionRecord / reactivateSessionRecord', () => {
  it('are the records of SES-11 and SES-14 and leave health and history alone', () => {
    // S1-SES-05 (decision 38): an unavailable (retired) Session cannot be reactivated, so this record row uses a
    // non-default health that reactivation is allowed to keep (lead fix of the frozen test, 2026-10-09).
    const record = recordOf({ health: 'recoverable', healthConclusion: null });
    const archived = expectConsistent(record, { kind: 'session_archived' }, ctxOf({ pin: REVISION, openResponsibleLink: false }),
      (effect) => effect.kind === 'archive_session' ? archiveSessionRecord(record, '2026-10-04T01:00:00.000Z') : null);
    expect(archived).toEqual({ ...record, revision: REVISION + 1, lifecycle: 'archived', archivedAt: '2026-10-04T01:00:00.000Z' });
    const reactivated = expectConsistent(archived, { kind: 'session_reactivated' }, ctxOf({ pin: REVISION + 1 }),
      (effect) => effect.kind === 'reactivate_session' ? reactivateSessionRecord(archived) : null);
    expect(reactivated).toEqual({ ...record, revision: REVISION + 2 });
  });

  it('refuse calls no row allows', () => {
    expect(() => archiveSessionRecord(recordOf({ lifecycle: 'archived' }), 'now')).toThrow(/already archived/);
    expect(() => archiveSessionRecord(recordOf({ occupancy: { kind: 'execution', executionRef: RUN_A, generation: GENERATION } }), 'now'))
      .toThrow(/occupied/);
    expect(() => reactivateSessionRecord(recordOf())).toThrow(/already active/);
  });
});

describe('observeSessionHealthRecord', () => {
  it('writes missing/damaged with unavailable and leaves occupancy alone (SES-12)', () => {
    const held = recordOf({ occupancy: { kind: 'execution', executionRef: RUN_A, generation: GENERATION } });
    for (const conclusion of ['missing', 'damaged'] as const) {
      expect(observeSessionHealthRecord(held, { health: 'unavailable', conclusion })).toEqual({
        ...held, revision: REVISION + 1, health: 'unavailable', healthConclusion: conclusion, unavailableSince: null,
      });
    }
  });

  it('clears the conclusion with available (SES-13, including kernel_turn_open after a closed Kernel head)', () => {
    for (const conclusion of ['missing', 'damaged', 'kernel_turn_open'] as const) {
      const record = recordOf({ health: 'unavailable', healthConclusion: conclusion });
      const next = observeSessionHealthRecord(record, { health: 'available', conclusion: null });
      expect(next).toEqual({ ...record, revision: REVISION + 1, health: 'available', healthConclusion: null });
      expect(deriveAvailability(next)).toBe('idle');
    }
  });

  it('never writes kernel_turn_open and never probes an archived Session', () => {
    const forged = { health: 'unavailable', conclusion: 'kernel_turn_open' } as unknown as Parameters<typeof observeSessionHealthRecord>[1];
    expect(() => observeSessionHealthRecord(recordOf(), forged)).toThrow(/missing or damaged/);
    expect(() => observeSessionHealthRecord(recordOf({ lifecycle: 'archived' }), { health: 'available', conclusion: null }))
      .toThrow(/archived/);
  });

  it('refuses a same-value observation: SES-19 writes nothing and kernel_turn_open stays under a missing/damaged probe', () => {
    expect(() => observeSessionHealthRecord(recordOf(), { health: 'available', conclusion: null })).toThrow(/SES-19/);
    for (const current of ['missing', 'damaged', 'kernel_turn_open'] as const) {
      const record = recordOf({ health: 'unavailable', healthConclusion: current });
      for (const conclusion of ['missing', 'damaged'] as const) {
        expect(() => observeSessionHealthRecord(record, { health: 'unavailable', conclusion })).toThrow(/SES-19/);
      }
    }
  });

  it('SES-19a: the constructor replaces kernel_turn_open only when the owner allows it and keeps the entry cursor', () => {
    const record = recordOf({ health: 'unavailable', healthConclusion: 'kernel_turn_open', unavailableSince: makeCommitCursor(3) });
    for (const conclusion of ['missing', 'damaged'] as const) {
      expect(observeSessionHealthRecord(record, { health: 'unavailable', conclusion }, { replacesKernelTurnOpen: true }))
        .toEqual({ ...record, revision: REVISION + 1, health: 'unavailable', healthConclusion: conclusion });
    }
    // Without the option the same observation stays SES-19 (the reconcile callers).
    expect(() => observeSessionHealthRecord(record, { health: 'unavailable', conclusion: 'missing' })).toThrow(/SES-19/);
    // The option only covers kernel_turn_open: an ordinary unavailable record still refuses.
    expect(() => observeSessionHealthRecord(recordOf({ health: 'unavailable', healthConclusion: 'missing' }),
      { health: 'unavailable', conclusion: 'missing' }, { replacesKernelTurnOpen: true })).toThrow(/SES-19/);
  });

  it('refuses a recoverable record (D-17: no writer)', () => {
    const record = recordOf({ health: 'recoverable' });
    expect(() => observeSessionHealthRecord(record, { health: 'available', conclusion: null })).toThrow(/recoverable/);
    expect(() => observeSessionHealthRecord(record, { health: 'unavailable', conclusion: 'missing' })).toThrow(/recoverable/);
  });
});
