/**
 * QueryRun recovery sub-machine and the QueryRun/QueryJob lifecycle record
 * constructors (docs/refactor/STATE-MACHINES-SPEC.md §8 QRR rows, §8.4, §12.3,
 * §14.1).
 *
 * The in-process claim, prepare, begin and entered steps are not rows of the
 * QRR table (§8.3): they meet the Session only through SES-03 and write their
 * phase through `advanceQueryExecutionRecord`. The table covers how a begun or
 * stranded QueryRun is settled: the Kernel terminal (QRR-03), the start-up
 * reconcile closes (QRR-01/02/04), `unknown` (QRR-05) and the human attestation
 * (QRR-06).
 *
 * §15.2 step 2 scope: QRR-03 (已有) is implemented with today's result (the
 * owner's `recordObservation` terminal branch calls it, `query-execution.ts:1368`).
 * QRR-01/02/04/05/06 are 新增: their events
 * stay in the union, the phase-level entries of the §8.4 QRR table already
 * answer their code (with reason `illegal`), a phase no row starts from answers
 * the §1.2 default `invalid`, and every other combination returns `illegal` /
 * `invalid` (`notYet`, as in every other machine) until step 5 adds the row.
 */
import type { CoreError } from '../../../contracts/core/results.js';
import type { RunExecutionHistoryV1 } from '../../../contracts/core/execution-history.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type {
  QueryExecutionBindingV1,
  QueryExecutionStateV1,
  QueryJobAnswerRef,
  QueryJobAnswerV1,
  QueryJobIntentV1,
  QueryJobRef,
  QueryJobSnapshot,
  QueryJobV1,
  QueryRunRef,
  QueryRunSnapshot,
  QueryRunV1,
  QuerySubmissionBindingV1,
} from '../../../contracts/query-job.js';
import type { SessionProbeVerdict, SessionRelease } from './session-availability.js';
import { accept, notYet, reject, unreachable, type Transition } from './transition.js';

// --------------------------------------------------------------------------
// State, guard context, events and effects (§8.1, §8.2)
// --------------------------------------------------------------------------

export type QueryRecoveryPhase = QueryExecutionStateV1['phase'];

/**
 * §8.1 invariant: `runStatus ∈ {answered, closed}` ⇔ `phase === 'settled'` ⇔
 * `ended` and `outcome !== null`. Only `settleQueryRunRecord` writes that side.
 */
export type QueryRecoveryState = {
  phase: QueryRecoveryPhase;
  runStatus: QueryRunV1['status'];
  jobStatus: QueryJobV1['status'];
  outcome: QueryRunV1['outcome'];
  /** `QueryRunV1.endedAt !== null`. */
  ended: boolean;
};

/** `mapOutcome` of the Runtime observer (`agent-runtime/query-observation.ts:123-131`). */
export type QueryKernelOutcome = 'answered' | 'failed' | 'cancelled' | 'timeout';

/** The Runtime's classification of the fixed Kernel Turn (`agent-runtime/run-reconcile.ts`, step 5). */
export type QueryKernelClassification = {
  turn: 'absent' | 'present';
  mappedOutcome: QueryKernelOutcome | null;
  boundaryComplete: boolean;
  unresolvedToolCallIds: readonly string[];
};

export type QueryRecoveryGuardContext = {
  /** `host_entry` is the Host's `resolveUnknownRun` entry (QRR-06). */
  caller: 'service' | 'reconcile' | 'host_entry';
  /** D-18; an unreadable lock file counts as `held_by_other` (L-10). Required for R events and QRR-06. */
  hostLease: 'owned' | 'held_by_other' | null;
  probe: SessionProbeVerdict | null;
  /**
   * Required for R events. A K terminal leaves it null: the in-process observer
   * applies the same classification before it reports a terminal
   * (`query-observation.ts:395-411`). When present it is checked for both.
   */
  kernel: QueryKernelClassification | null;
  /** §10.3; `query-observation.ts:388-393` confirms it today before the owner call. */
  inputsConfirmed: boolean | 'kernel_unreadable';
  actor: 'human' | 'system';
  reason: string | null;
  /**
   * `ownsQuery` of the owner (`query-execution.ts:1373`). A settle releases the
   * Session only while this QueryRun still holds it at its claim generation
   * (RUN-07 does the same, §6.3 表外说明).
   */
  sessionOwned: boolean;
  /** `executionState.sessionGeneration`: the occupancy generation the claim fixed; the release names it. */
  sessionGeneration: number;
  /**
   * The QueryRun the event addresses. Not in the §8.1 sketch: the terminal
   * guard checks the Answer against it.
   */
  queryRunRef: QueryRunRef;
  /**
   * `sameRef(entryIdentity(executionState), observation.entry)`. Not in the
   * §8.1 sketch: the fixed entry identity is checked before the settled check;
   * the owner checks it for every observation kind before it calls the machine
   * (`query-execution.ts:1324`). False whenever no entry is fixed.
   */
  entryMatches: boolean;
};

export type QueryTerminalOutcome = 'answered' | 'timeout' | 'gap' | 'failed' | 'cancelled';

/** The Kernel terminal fact both QRR-03 sources carry (`QueryHistoryObservation`, terminal kind). */
export type QueryTerminalFact = {
  outcome: QueryTerminalOutcome;
  answer: QueryJobAnswerV1 | null;
  reason: string | null;
  history: RunExecutionHistoryV1;
  /** This round's original record position and cursor, from the Session owner. */
  source: { position: number; cursor: string };
};

/** Kernel states `mapOutcome` cannot book (SD-4(e)); paused/yielded name the close message (QRR-04). */
export type QueryInterruptedKernelStatus = 'created' | 'running' | 'paused' | 'yielded';

export type QueryUnknownCause =
  | { kind: 'unresolved_tools'; toolCallIds: readonly string[] }
  | { kind: 'kernel_unreadable'; verdict: 'missing' | 'damaged' };

export type QueryRecoveryEvent =
  /** K: the in-process Query observer (QRR-03). */
  | { kind: 'query_terminal_observed'; terminal: QueryTerminalFact }
  /** R: the start-up reconcile (QRR-03). */
  | { kind: 'query_reconcile_terminal'; hostInstanceId: string; terminal: QueryTerminalFact }
  /** R: QRR-01 (claimed/prepared) and QRR-02 (entering without a fixed Turn). 新增. */
  | { kind: 'query_reconcile_not_entered'; hostInstanceId: string }
  /** R: QRR-04. 新增. */
  | { kind: 'query_reconcile_interrupted_clean'; hostInstanceId: string; kernelStatus: QueryInterruptedKernelStatus; history: RunExecutionHistoryV1 }
  /** R: QRR-05; `history` is null when the Kernel is not readable (SD-3). 新增. */
  | { kind: 'query_reconcile_unknown'; hostInstanceId: string; cause: QueryUnknownCause; history: RunExecutionHistoryV1 | null }
  /** U: QRR-06; actor and reason travel in the guard context, the QueryRun pin is the service CAS. 新增. */
  | { kind: 'query_unknown_attested' };

export type QueryRecoveryEventKind = QueryRecoveryEvent['kind'];

export type QuerySettledOutcome = NonNullable<QueryRunV1['outcome']>;

/** How a settle ends: an Answer, or a close whose code is the outcome itself. */
export type QuerySettlement =
  | { outcome: 'answered'; answerRef: QueryJobAnswerRef }
  | { outcome: Exclude<QuerySettledOutcome, 'answered'>; closeMessage: string };

/** `unchanged` keeps the stored history (it may be null); it never writes null over it. */
export type QueryHistoryUpdate = { kind: 'set'; history: RunExecutionHistoryV1 } | { kind: 'unchanged' };

/**
 * Same-commit intents the owner service translates (§1.1):
 * - `settle_query`: `settleQueryRunRecord` over the QueryRun and its QueryJob;
 * - `mark_query_unknown`: `markQueryRunUnknownRecord`;
 * - `record_answer`: Answer@1 plus the `QueryJobAnswered` event;
 * - `release_session`: the shared `SessionRelease` (`releaseSessionRecord`) of
 *   the Session this QueryRun fixed at claim (`executionState.sessionRef`),
 *   translated into the Session `occupancy_released` event (SES-08..10). It is
 *   emitted only while `ctx.sessionOwned`, as RUN-07 does.
 */
export type QueryRecoveryEffect =
  | { kind: 'settle_query'; settlement: QuerySettlement; history: QueryHistoryUpdate }
  | { kind: 'mark_query_unknown'; history: QueryHistoryUpdate }
  | { kind: 'record_answer'; ref: QueryJobAnswerRef; answer: QueryJobAnswerV1 }
  | ({ kind: 'release_session' } & SessionRelease);

export type QueryRecoveryTransition = Transition<QueryRecoveryState, QueryRecoveryEvent, QueryRecoveryEffect>;

// --------------------------------------------------------------------------
// Transition
// --------------------------------------------------------------------------

export function transitionQueryRunRecovery(
  state: QueryRecoveryState,
  event: QueryRecoveryEvent,
  ctx: QueryRecoveryGuardContext,
): QueryRecoveryTransition {
  switch (event.kind) {
    case 'query_terminal_observed': return terminalObserved(state, event.terminal, ctx);
    case 'query_reconcile_terminal': return reconcileTerminal(state, event.terminal, ctx);
    case 'query_reconcile_not_entered':
    case 'query_reconcile_interrupted_clean':
    case 'query_reconcile_unknown':
    case 'query_unknown_attested':
      return pendingRow(state.phase, event.kind);
    default: return unreachable(event, 'QueryRecoveryEvent');
  }
}

/** QRR-03, K source. Guard order is the owner's from before step 3: entry, settled, Answer, end boundary. */
function terminalObserved(state: QueryRecoveryState, terminal: QueryTerminalFact, ctx: QueryRecoveryGuardContext): QueryRecoveryTransition {
  switch (state.phase) {
    case 'claimed':
    case 'prepared':
      // No entry identity is fixed before begin, so today's entry check rejects it.
      return reject('illegal', 'forbidden', `the QueryRun has no fixed entry in phase ${state.phase}`);
    case 'entering':
    case 'entered':
    case 'unknown':
    case 'settled':
      break;
    default: return unreachable(state.phase, 'QueryRecoveryPhase');
  }
  if (!ctx.entryMatches) return reject('guard_failed', 'forbidden', 'the observation entry disagrees with the fixed Query entry');
  if (state.phase === 'settled') return reject('illegal', 'busy', 'the QueryRun is already settled');
  return settleFromTerminal(terminal, ctx);
}

/** QRR-03, R source: the K guards plus reconcile, the instance lease and the Runtime classification. */
function reconcileTerminal(state: QueryRecoveryState, terminal: QueryTerminalFact, ctx: QueryRecoveryGuardContext): QueryRecoveryTransition {
  if (ctx.caller !== 'reconcile') return reject('illegal', 'forbidden', 'query_reconcile_terminal is accepted only from the Host start-up reconcile');
  if (ctx.hostLease !== 'owned') return reject('guard_failed', 'busy', 'the Host instance lease is held elsewhere or unreadable (D-18, L-10)');
  switch (state.phase) {
    case 'claimed':
    case 'prepared':
      return reject('illegal', 'invalid', `a QueryRun in phase ${state.phase} cannot have a Kernel Turn`);
    case 'settled':
      return reject('illegal', 'busy', 'the QueryRun is already settled');
    case 'entering':
    case 'entered':
    case 'unknown':
      break;
    default: return unreachable(state.phase, 'QueryRecoveryPhase');
  }
  if (!ctx.entryMatches) return reject('guard_failed', 'forbidden', 'the reconciled Turn is not the fixed Query entry');
  if (ctx.probe !== 'ready' || ctx.kernel === null || ctx.kernel.turn !== 'present') {
    return reject('guard_failed', 'unavailable', 'no readable Kernel Turn backs the terminal (SD-2, SD-3)');
  }
  return settleFromTerminal(terminal, ctx);
}

function settleFromTerminal(terminal: QueryTerminalFact, ctx: QueryRecoveryGuardContext): QueryRecoveryTransition {
  const kernel = ctx.kernel;
  if (kernel !== null) {
    if (kernel.unresolvedToolCallIds.length > 0) {
      return reject('guard_failed', 'busy', 'a tool call has no result; the occupancy stays (D-4, QRR-05)');
    }
    // QRR-03 asks only for a mappable Kernel status (Q-03). The terminal outcome
    // may differ from it: the Runtime books a mapped `answered` without bounded
    // answer text as `gap` (query-observation.ts:425-430).
    if (kernel.mappedOutcome === null) {
      return reject('guard_failed', 'invalid', 'the Kernel status maps to no terminal (SD-4(e))');
    }
    if (!kernel.boundaryComplete) return reject('guard_failed', 'invalid', 'the Kernel Turn has no complete end boundary');
  }
  // An Answer belongs to this QueryRun and only to an answered terminal.
  if (terminal.answer !== null) {
    if (terminal.outcome !== 'answered') return reject('guard_failed', 'invalid', 'only an answered terminal may carry an answer');
    if (!sameJson(terminal.answer.queryJobRef, queryJobRefOf(ctx.queryRunRef)) || !sameJson(terminal.answer.runRef, ctx.queryRunRef)) {
      return reject('guard_failed', 'invalid', 'the terminal answer does not belong to this QueryRun');
    }
  } else if (terminal.outcome === 'answered') {
    return reject('guard_failed', 'invalid', 'an answered terminal requires an answer');
  }
  // The observed history ends exactly at this observation's source position.
  if (terminal.history.endPosition === null || terminal.history.endPosition !== terminal.source.position) {
    return reject('guard_failed', 'invalid', 'the terminal observation has no complete end boundary');
  }
  // §10.3; today the Runtime returns the same code first (query-observation.ts:388-393).
  if (ctx.inputsConfirmed !== true) {
    return reject('guard_failed', 'unavailable', 'the Query input acceptance is not confirmed against its source');
  }
  const history: QueryHistoryUpdate = { kind: 'set', history: terminal.history };
  // SES-08: the Session moves to the complete Turn boundary only while this QueryRun holds it.
  const release: QueryRecoveryEffect[] = ctx.sessionOwned
    ? [{ kind: 'release_session', holder: ctx.queryRunRef, generation: ctx.sessionGeneration,
      historyCursor: { kind: 'advance', cursor: terminal.source.cursor }, kernelTurnOpen: false }]
    : [];
  if (terminal.outcome === 'answered') {
    const answer = terminal.answer!;
    const ref = answerRefOf(ctx.queryRunRef, answer.answerId);
    return accept(settledState('answered'), [
      { kind: 'settle_query', settlement: { outcome: 'answered', answerRef: ref }, history },
      { kind: 'record_answer', ref, answer },
      ...release,
    ]);
  }
  return accept(settledState(terminal.outcome), [
    { kind: 'settle_query', settlement: { outcome: terminal.outcome, closeMessage: terminal.reason ?? terminal.outcome }, history },
    ...release,
  ]);
}

function settledState(outcome: QuerySettledOutcome): QueryRecoveryState {
  const status = outcome === 'answered' ? 'answered' : 'closed';
  return { phase: 'settled', runStatus: status, jobStatus: status, outcome, ended: true };
}

type PendingRowEvent = Exclude<QueryRecoveryEventKind, 'query_terminal_observed' | 'query_reconcile_terminal'>;

/** The 新增 rows each pending event is waiting for (§15.2 step 5). */
const PENDING_ROWS: { readonly [E in PendingRowEvent]: string } = {
  query_reconcile_not_entered: 'QRR-01/QRR-02',
  query_reconcile_interrupted_clean: 'QRR-04',
  query_reconcile_unknown: 'QRR-05',
  query_unknown_attested: 'QRR-06',
};

type Forbidden = { readonly code: CoreError; readonly detail: string };
const SETTLED: Forbidden = { code: 'busy', detail: 'the QueryRun is already settled' };
const NO_TURN: Forbidden = { code: 'invalid', detail: 'claimed/prepared cannot have a Kernel Turn' };
const ENTERED: Forbidden = { code: 'invalid', detail: 'entry was already observed' };
const UNKNOWN_EXITS: Forbidden = { code: 'busy', detail: 'an unknown QueryRun leaves only through QRR-03 or QRR-06 (RD-4)' };
/** §8.4 lists it as guard_failed; it stays `illegal` until step 5 adds QRR-06. */
const NOT_UNKNOWN: Forbidden = { code: 'busy', detail: 'only an unknown QueryRun is attested' };
/**
 * Not in §8.4: QRR-05 starts only from entering/entered, so the §1.2 default
 * applies. A QueryRun that is already unknown stays unknown (§12.3 Q-06); the
 * Run machine answers the same illegal/invalid to every reconcile event of an
 * `outcome_unknown` Run.
 */
const ALREADY_UNKNOWN: Forbidden = { code: 'invalid', detail: 'QRR-05 starts only from entering/entered; an unknown QueryRun stays unknown (Q-06)' };

/**
 * Phase-level entries of the §8.4 QRR table for the events of 新增 rows, with
 * their §8.4 code, plus the phases no row of the event starts from. In step 2
 * every one answers `illegal`.
 */
const PENDING_FORBIDDEN: { readonly [E in PendingRowEvent]: Partial<Readonly<Record<QueryRecoveryPhase, Forbidden>>> } = {
  query_reconcile_not_entered: { entered: ENTERED, unknown: UNKNOWN_EXITS, settled: SETTLED },
  query_reconcile_interrupted_clean: { claimed: NO_TURN, prepared: NO_TURN, unknown: UNKNOWN_EXITS, settled: SETTLED },
  query_reconcile_unknown: { claimed: NO_TURN, prepared: NO_TURN, unknown: ALREADY_UNKNOWN, settled: SETTLED },
  query_unknown_attested: { claimed: NOT_UNKNOWN, prepared: NOT_UNKNOWN, entering: NOT_UNKNOWN, entered: NOT_UNKNOWN, settled: SETTLED },
};

function pendingRow(phase: QueryRecoveryPhase, kind: PendingRowEvent): QueryRecoveryTransition {
  const forbidden = PENDING_FORBIDDEN[kind][phase];
  if (forbidden !== undefined) return reject('illegal', forbidden.code, `${kind} from ${phase}: ${forbidden.detail}`);
  return notYet(`${kind} (${PENDING_ROWS[kind]})`);
}

/** The machine state of a QueryRun and its QueryJob; null for a historical claim without execution state. */
export function queryRecoveryStateOf(job: QueryJobV1, run: QueryRunV1): QueryRecoveryState | null {
  const execution = run.executionState;
  if (execution === undefined) return null;
  return { phase: execution.phase, runStatus: run.status, jobStatus: job.status, outcome: run.outcome, ended: run.endedAt !== null };
}

// --------------------------------------------------------------------------
// Record constructors (§14.1): the only writers of QueryRunV1 status/endedAt/
// outcome, QueryExecutionStateV1.phase and QueryJobV1 status/closeReason.
// The owner service checks every precondition first; a call that would build
// an illegal combination is a programming error and throws.
// --------------------------------------------------------------------------

export type QueryLifecycleRecords = { job: QueryJobSnapshot; run: QueryRunSnapshot };

/**
 * The pending@1 QueryJob and QueryRun of one submission (`query-job-service.ts:742`);
 * the receipt replay rebuilds the same pair (`:510`).
 */
export function newPendingQueryRecords(input: {
  queryRunRef: QueryRunRef;
  goalId: string | null;
  intent: QueryJobIntentV1;
  submittedAt: string;
  submission: QuerySubmissionBindingV1;
}): QueryLifecycleRecords {
  const queryRunRef = input.queryRunRef;
  const queryJobRef = queryJobRefOf(queryRunRef);
  const job: QueryJobV1 = {
    schemaVersion: 1,
    queryJobId: queryRunRef.queryJobId,
    projectId: queryRunRef.projectId,
    workspaceId: queryRunRef.workspaceId,
    goalId: input.goalId,
    intent: input.intent,
    status: 'pending',
    runRef: { ...queryRunRef },
    answerRefs: [],
    closeReason: null,
    submittedAt: input.submittedAt,
    updatedAt: input.submittedAt,
  };
  const run: QueryRunV1 = {
    schemaVersion: 1,
    queryJobRef: { ...queryJobRef },
    runId: queryRunRef.runId,
    status: 'pending',
    startedAt: null,
    endedAt: null,
    outcome: null,
  };
  return {
    job: { ref: { ...queryJobRef }, revision: 1, schemaVersion: 1, job, submission: { ...input.submission } },
    run: { ref: { ...queryRunRef }, revision: 1, schemaVersion: 1, run },
  };
}

/** The in-process steps; each writes the QueryRun at revision+1 (entering also the QueryJob). */
export type QueryExecutionStep =
  /** `query-execution.ts:847`: requires the pending pair. */
  | {
      phase: 'claimed';
      claim: Pick<QueryExecutionStateV1, 'sessionRef' | 'sessionGeneration' | 'role' | 'roleBinding' | 'roleResolution' | 'priorHistoryCursor'>;
    }
  /** `:959`: requires `claimed`. */
  | { phase: 'prepared'; prepared: NonNullable<QueryExecutionStateV1['prepared']> }
  /** `:1074`: requires `prepared`; QueryRun and QueryJob become `running`. */
  | {
      phase: 'entering';
      entry: NonNullable<QueryExecutionStateV1['entry']>;
      request: QueryExecutionBindingV1['request'];
      occurredAt: string;
    }
  /** `:1334`: requires `entering`. */
  | { phase: 'entered'; history: RunExecutionHistoryV1 };

export function advanceQueryExecutionRecord(records: QueryLifecycleRecords, step: QueryExecutionStep): QueryLifecycleRecords {
  const { job, run } = records;
  const current = run.run.executionState;
  switch (step.phase) {
    case 'claimed': {
      if (run.run.status !== 'pending' || job.job.status !== 'pending') {
        throw new Error('advanceQueryExecutionRecord: claim requires the pending QueryJob and QueryRun');
      }
      const executionState: QueryExecutionStateV1 = {
        schemaVersion: 1,
        phase: 'claimed',
        sessionRef: structuredClone(step.claim.sessionRef),
        sessionGeneration: step.claim.sessionGeneration,
        role: structuredClone(step.claim.role),
        roleBinding: structuredClone(step.claim.roleBinding),
        roleResolution: structuredClone(step.claim.roleResolution),
        priorHistoryCursor: step.claim.priorHistoryCursor,
        prepared: null,
        entry: null,
        history: null,
        requests: [],
      };
      return { job, run: { ...run, revision: run.revision + 1, run: { ...run.run, executionState } } };
    }
    case 'prepared': {
      const state = requirePhase(current, 'claimed', step.phase);
      const executionState: QueryExecutionStateV1 = { ...structuredClone(state), phase: 'prepared', prepared: structuredClone(step.prepared) };
      return { job, run: { ...run, revision: run.revision + 1, run: { ...run.run, executionState } } };
    }
    case 'entering': {
      const state = requirePhase(current, 'prepared', step.phase);
      if (job.job.status !== 'pending' && job.job.status !== 'running') {
        throw new Error('advanceQueryExecutionRecord: entering requires an unsettled QueryJob');
      }
      const executionState: QueryExecutionStateV1 = { ...structuredClone(state), phase: 'entering', entry: structuredClone(step.entry) };
      const nextRun: QueryRunSnapshot = {
        ...run,
        revision: run.revision + 1,
        run: {
          ...run.run,
          status: 'running',
          startedAt: run.run.startedAt ?? step.occurredAt,
          execution: { schemaVersion: 1, roundIndex: 0, request: structuredClone(step.request), selectedSources: [] },
          executionState,
        },
      };
      const nextJob: QueryJobSnapshot = { ...job, revision: job.revision + 1, job: { ...job.job, status: 'running', updatedAt: step.occurredAt } };
      return { job: nextJob, run: nextRun };
    }
    case 'entered': {
      const state = requirePhase(current, 'entering', step.phase);
      const executionState: QueryExecutionStateV1 = { ...structuredClone(state), phase: 'entered', history: structuredClone(step.history) };
      return { job, run: { ...run, revision: run.revision + 1, run: { ...run.run, executionState } } };
    }
    default: return unreachable(step, 'QueryExecutionStep');
  }
}

/**
 * Phases with a fixed entry identity (begin committed `entering`). Today's
 * owner branch reaches `unknown` only from them, since it checks the entry
 * first (`query-execution.ts:1324`); QRR-05 starts from entering/entered.
 * QRR-03/04/06 settle a known outcome only from them as well.
 */
const ENTRY_FIXED_PHASES: ReadonlySet<QueryRecoveryPhase> = new Set<QueryRecoveryPhase>(['entering', 'entered', 'unknown']);
/** QRR-01 (claimed/prepared) and QRR-02 (entering without a Kernel Turn): the only settles to `not_entered`. */
const NOT_ENTERED_PHASES: ReadonlySet<QueryRecoveryPhase> = new Set<QueryRecoveryPhase>(['claimed', 'prepared', 'entering']);

/** Phase `unknown`: the owner's `unknown` branch (`query-execution.ts:1353`) and QRR-05. Status stays running. */
export function markQueryRunUnknownRecord(run: QueryRunSnapshot, input: { history: QueryHistoryUpdate }): QueryRunSnapshot {
  const state = requirePhaseIn(run.run.executionState, ENTRY_FIXED_PHASES, 'markQueryRunUnknownRecord');
  const executionState: QueryExecutionStateV1 = { ...structuredClone(state), phase: 'unknown', history: nextHistory(state, input.history) };
  return { ...run, revision: run.revision + 1, run: { ...run.run, executionState } };
}

/**
 * Settles the QueryRun and its QueryJob together (QRR-03 in `query-execution.ts:573`,
 * QRR-01..04, QRR-06): phase, status, outcome and endedAt on the QueryRun;
 * status, answerRefs, closeReason and updatedAt on the QueryJob (§8.3 收束一致性).
 * `not_entered` settles only from claimed/prepared/entering (QRR-01/02), every
 * other outcome only from entering/entered/unknown (QRR-03/04/06).
 */
export function settleQueryRunRecord(
  records: QueryLifecycleRecords,
  input: { settlement: QuerySettlement; history: QueryHistoryUpdate; occurredAt: string },
): QueryLifecycleRecords {
  const { job, run } = records;
  const settlement = input.settlement;
  const state = requirePhaseIn(run.run.executionState,
    settlement.outcome === 'not_entered' ? NOT_ENTERED_PHASES : ENTRY_FIXED_PHASES, `settleQueryRunRecord(${settlement.outcome})`);
  if (job.job.status !== 'pending' && job.job.status !== 'running') {
    throw new Error(`settleQueryRunRecord: the QueryJob is already ${job.job.status}; QueryRun and QueryJob settle together`);
  }
  const status = settlement.outcome === 'answered' ? 'answered' : 'closed';
  const closeReason: QueryJobV1['closeReason'] = settlement.outcome === 'answered'
    ? null
    : { code: settlement.outcome, message: settlement.closeMessage };
  const nextJob: QueryJobSnapshot = {
    ...job,
    revision: job.revision + 1,
    job: {
      ...job.job,
      status,
      answerRefs: settlement.outcome === 'answered' ? [...job.job.answerRefs, { ...settlement.answerRef }] : [...job.job.answerRefs],
      closeReason,
      updatedAt: input.occurredAt,
    },
  };
  const executionState: QueryExecutionStateV1 = { ...structuredClone(state), phase: 'settled', history: nextHistory(state, input.history) };
  const nextRun: QueryRunSnapshot = {
    ...run,
    revision: run.revision + 1,
    run: { ...run.run, status, outcome: settlement.outcome, endedAt: input.occurredAt, executionState },
  };
  return { job: nextJob, run: nextRun };
}

function requirePhase(
  state: QueryExecutionStateV1 | undefined,
  phase: QueryRecoveryPhase,
  target: QueryExecutionStep['phase'],
): QueryExecutionStateV1 {
  if (state === undefined || state.phase !== phase) {
    throw new Error(`advanceQueryExecutionRecord: ${target} requires phase ${phase}, not ${state?.phase ?? 'absent'}`);
  }
  return state;
}

function requirePhaseIn(state: QueryExecutionStateV1 | undefined, phases: ReadonlySet<QueryRecoveryPhase>, constructor: string): QueryExecutionStateV1 {
  if (state === undefined || !phases.has(state.phase)) {
    throw new Error(`${constructor}: requires phase ${[...phases].join('/')}, not ${state?.phase ?? 'absent'}`);
  }
  return state;
}

function nextHistory(state: QueryExecutionStateV1, update: QueryHistoryUpdate): RunExecutionHistoryV1 | null {
  return update.kind === 'set' ? structuredClone(update.history) : structuredClone(state.history);
}

function queryJobRefOf(queryRunRef: QueryRunRef): QueryJobRef {
  return { aggregateType: 'QueryJob', projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId, queryJobId: queryRunRef.queryJobId };
}

function answerRefOf(queryRunRef: QueryRunRef, answerId: string): QueryJobAnswerRef {
  return { aggregateType: 'QueryJobAnswer', projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId, queryJobId: queryRunRef.queryJobId, answerId };
}

/** `sameRef` of the owner service: canonical JSON equality, false when not serializable. */
function sameJson(left: unknown, right: unknown): boolean {
  try { return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue); } catch { return false; }
}
