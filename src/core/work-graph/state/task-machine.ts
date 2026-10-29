/**
 * Task machine (docs/refactor/STATE-MACHINES-SPEC.md §4): the projected phase
 * of one Task (`projectTaskPhase`, rows P1..P20, D-1) and the legality of every
 * write that touches it (`transitionTask`, rows TASK-01..30, forbidden §4.4).
 *
 * A Task has no stored phase (D-1). Its phase is a pure projection of the
 * selected Run (with its control pointer), the applicable TaskReduction, the
 * selected Run's round-chain head (`roundTaskSignal`, §9) and the covering
 * TaskRequeue, all read by `readCanonicalTaskFacts` in one window. The writes
 * that touch a Task (claim, completion, disposition change, requeue and its
 * refusal) ask `transitionTask` first. The events other
 * machines judge (Run end, control, round and check events, plan adoption)
 * only re-project: `ok:true`, `effects:[]`, and `next` is the projection of
 * the facts after that event's own commit (SD-1); an event of an older Run
 * leaves the state as is (TASK-20, R5). The machine never reads storage, mints
 * ids or reads a clock: instants and ids come in the event payload.
 *
 * Owners: `claim-service.ts` (TASK-01..03), `completion.ts` (TASK-14/15/24;
 * the TD-2 evidence exclusion is its `evidenceSupersededByRequeue`),
 * `requeue-service.ts` (TASK-16/17/27/28; a reverify refusal is the round
 * side's, §9 VR-14) and `plan-service.ts` (TASK-18/19; a traced Task whose
 * execution definition changes is refused by §3 PLAN-05 and never reaches this
 * machine). Rows and their status: spec §15.2/§15.3.
 *
 * Line references (`file.ts:NNN`) cite the code of 2026-10-02 (before A.2 step 3),
 * as the spec does; the names next to them find today's code.
 *
 * Pure: imports only `src/contracts` and this directory (§14.4).
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type { ControlIntentKindV1, ControlIntentRef } from '../../../contracts/control-intent.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import type { TaskClaim } from '../../../contracts/core/task-claim.js';
import type { DelegatedWriteProvenanceV1 } from '../../../contracts/delegated-write.js';
import type { RunRef, RunSnapshot, TaskBudgetV1, TaskTriple } from '../../../contracts/dispatch.js';
import type { UnknownCallReviewRef } from '../../../contracts/unknown-call-review.js';
import type { EvidenceOutcome, EvidenceRef } from '../../../contracts/evidence.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { GoalDesiredState } from '../../../contracts/ledger.js';
import { MAX_NEW_BASIS_INPUT_REFS, type NewBasisInputRefV1, type NoProgressKeyV1 } from '../../../contracts/no-progress.js';
import type {
  Disposition, Phase, PlanRevisionRef, PlanRevisionSnapshot, RuntimeTask, TaskKind,
} from '../../../contracts/plan.js';
import type {
  TaskReductionCause, TaskReductionPhase, TaskReductionRef, TaskReductionSnapshot,
} from '../../../contracts/reduction.js';
import type { ArchiveRequeueOriginV1 } from '../../../contracts/session-anomaly.js';
import type { TaskPhaseCauseCode, TaskPhaseCauseDetailV1, TaskPhaseCauseV1 } from '../../../contracts/task-failure.js';
import {
  MAX_AUTO_REWORK_LIMIT, TASK_REWORK_REASON_MAX_CHARS, reworkActorClassOf,
  type ReworkActorClass, type ReworkFailureClass, type TaskAutomationPolicyV1, type TaskRequeueAutomationV1,
  type TaskRequeueBasisComparison, type TaskRequeueRef, type TaskRequeueSnapshotV1, type TaskRequeueTriggerV1,
  type TaskReworkRefusalSnapshotV1,
} from '../../../contracts/task-requeue.js';
import type { RoundSnapshot, VerificationRoundRef } from '../../../contracts/verification.js';
import type { AttemptClaimBasis } from './attempt-machine.js';
import { runFailureOrigin } from './no-progress.js';
import { tracedDispositionChangeProblem, type TracedTaskFactsV1 } from './plan-machine.js';
import {
  claimBasisProblem, claimPinProblem, isPausedInterrupted, reviewBlockerProblem, runUnresolvedBlocker,
  type ClaimRequeueFacts, type ReviewClaimFacts, type RunClaimContext,
} from './run-machine.js';
import {
  deriveReworkClass, isGoalFanOutActor, nextRequeueAutoCount, permissionInterruptionOf, requeueHistorySourceOf,
  reworkFenceOf, reworkPermission,
  type ReworkClassDerivationV1, type StopIntentV1, type VerifiedArchiveInterruptionV1,
} from './task-failure.js';
import { accept, reject, rejected, unreachable, type Rejected, type Transition } from './transition.js';
import {
  chainEvidenceIds, isFinalizedNonPass, type RoundChainHeadV1, type RoundTaskSignalV1,
} from './verification-machine.js';

// -------------------------------------------------------------------------- //
// Projection (§4.1 投影规则, D-1, TD-1)                                       //
// -------------------------------------------------------------------------- //

/** Stable row ids of the projection table; the id is not the matching order. */
export type TaskPhaseRowId =
  | 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7' | 'P8' | 'P9' | 'P10'
  | 'P11' | 'P12' | 'P13' | 'P14' | 'P15' | 'P16' | 'P17' | 'P18' | 'P19' | 'P20';

/**
 * The projection inputs `readCanonicalTaskFacts` reads in one window (§4.1
 * "投影输入"). A read failure never reaches here: the reader returns
 * `unavailable` instead of guessing a phase.
 */
export type TaskPhaseFacts = {
  taskKind: TaskKind;
  /** P1: a TaskReduction of the same basis, taskKind and planRevision (`plan-readers.ts:1126-1141`); null otherwise. */
  applicableReduction: Pick<TaskReductionSnapshot, 'phase'> | null;
  /** Lease holder, then active over ended, then latest `endedAt ?? startedAt`, then revision (`:1111-1125`). */
  selectedRun: RunSnapshot | null;
  /** P15: some Run or Reduction of the Task names an origin Plan that is not resolvable (`:1117`, `:1131`). */
  originUnresolvable: boolean;
  /**
   * `roundTaskSignal` (§9) over the selected Run's round chain (P7..P13); for a
   * gate over the gate's own chain (`VerificationRoundByTask`, P20). `none`
   * without rounds.
   */
  round: RoundTaskSignalV1;
  /** P4: the TaskRequeue whose `afterRunRef` is the selected Run (TD-2, C1); null otherwise. */
  coveringRequeue: TaskRequeueRef | null;
};

/** The row that matched, the projected phase and its TD-1 cause. */
export type TaskPhaseProjection = { row: TaskPhaseRowId; phase: Phase; cause: TaskPhaseCauseV1 | null };

function projection(row: TaskPhaseRowId, phase: Phase, cause: TaskPhaseCauseV1 | null): TaskPhaseProjection {
  return { row, phase, cause };
}

function causeOf(code: TaskPhaseCauseCode, detail: TaskPhaseCauseDetailV1 = {}): TaskPhaseCauseV1 {
  return Object.keys(detail).length === 0 ? { code } : { code, detail };
}

type RoundHeadSignal = Exclude<RoundTaskSignalV1, { kind: 'none' } | { kind: 'invalid' }>;

/** §4.1: a head opened by VR-14 adds `{ordinal, predecessorRoundRef}` to the detail. */
function successorDetail(signal: RoundHeadSignal): TaskPhaseCauseDetailV1 {
  if (signal.ordinal <= 1) return {};
  const predecessor = signal.head.chain.predecessorRoundRef;
  return predecessor === null ? { ordinal: signal.ordinal } : { ordinal: signal.ordinal, predecessorRoundRef: predecessor };
}

/**
 * The first matching row of §4.1 in table order (P1, P20, P2, P3, P4, P17,
 * P18, P19, P5, P6, P10, P7, P8, P9, P11, P12, P13, P14, P15, P16).
 */
export function classifyTaskPhase(facts: TaskPhaseFacts): TaskPhaseProjection {
  if (facts.applicableReduction !== null) return projection('P1', facts.applicableReduction.phase, null);
  // P20 (C5, right after P1, gates only): a gate projects from its own chain
  // head; without a chain it has no Run either and falls to P15/P16.
  if (facts.taskKind === 'gate') {
    const gate = gateChainProjection(facts.round);
    if (gate !== null) return gate;
  }
  const run = facts.selectedRun;
  if (run === null) {
    return facts.originUnresolvable
      ? projection('P15', 'blocked', causeOf('origin_unresolvable'))
      : projection('P16', 'pending', null);
  }
  if (run.status === 'starting' || run.status === 'running') return projection('P2', 'running', null);
  return endedRunProjection(run, facts.round, facts.coveringRequeue);
}

function endedRunProjection(run: RunSnapshot, round: RoundTaskSignalV1, coveringRequeue: TaskRequeueRef | null): TaskPhaseProjection {
  const outcome = run.outcome;
  // An ended Run without an outcome is damaged (`runCombinationProblem`);
  // like P14 it is defended as `blocked`.
  if (outcome === null) return projection('P14', 'blocked', causeOf('run_failed'));
  if (outcome === 'outcome_unknown') return projection('P3', 'blocked', causeOf('run_outcome_unknown'));
  // P4 (D-3, C1): the TaskRequeue covering the selected Run makes the Task
  // claimable again, only with that `requeueRef` (TASK-03).
  if (coveringRequeue !== null) return projection('P4', 'pending', causeOf('requeued', { requeueRef: { ...coveringRequeue } }));
  // P19 (C4, RUN-24): a Run the Host restart ended while paused shows "已暂停，可继续", not a failure.
  const pausedInterrupted = pausedInterruptedProjection(run);
  if (pausedInterrupted !== null) return pausedInterrupted;
  switch (outcome) {
    case 'yielded': {
      if (run.continuation === undefined) return projection('P14', 'blocked', causeOf('run_failed'));
      // TD-5: a stop pointer holds the continuation (the claim answers `busy`),
      // so it shows: cancelled → requeue, paused → resume (RUN-14) or cancel.
      const pointer = run.controlState?.desiredState;
      if (pointer === 'cancelled') return projection('P17', 'failed', causeOf('continuation_cancelled'));
      if (pointer === 'paused') return projection('P18', 'blocked', causeOf('continuation_paused'));
      return projection('P5', 'ready', null);
    }
    case 'crashed':
    case 'cancelled':
    case 'budget_exhausted':
    case 'failed':
      return projection('P6', 'failed', causeOf('run_failed', { outcome, origin: runFailureOrigin(run) }));
    case 'completed': return completedRunProjection(round);
    default: return unreachable(outcome, 'Run outcome');
  }
}

/**
 * P19 (C4, TD-7): `blocked/paused_interrupted` with `{afterRunRef,
 * pausedIntentRef, kernelPaused}` for a selected Run RUN-24 ended; `null` for
 * any other Run.
 */
function pausedInterruptedProjection(run: RunSnapshot): TaskPhaseProjection | null {
  const observation = run.reconciliation?.observation;
  if (!isPausedInterrupted(run) || observation === undefined || observation.kind !== 'interrupted_clean'
    || observation.pausedIntentRef === null) return null;
  return projection('P19', 'blocked', causeOf('paused_interrupted', { afterRunRef: { ...run.ref },
    pausedIntentRef: { ...observation.pausedIntentRef }, kernelPaused: observation.kernelPaused }));
}

/** P10, P7, P8, P9, P11, P12, P13 over the selected Run's chain head. */
function completedRunProjection(round: RoundTaskSignalV1): TaskPhaseProjection {
  switch (round.kind) {
    case 'invalid': return projection('P10', 'blocked', causeOf('round_ambiguous'));
    // D-2: a FAIL round fails the Task.
    case 'fail':
      return projection('P7', 'failed', causeOf('check_failed', { ...successorDetail(round), checkIds: round.failedCheckIds }));
    case 'inconclusive':
      return projection('P8', 'blocked', causeOf('round_inconclusive', { ...successorDetail(round), gapCodes: round.gapCodes }));
    case 'open':
      // Monotonic within a round (brief §2a): interrupted checks block only
      // once no check is pending or executing.
      if (!round.unsettled && round.interruptedCheckIds.length > 0) {
        return projection('P9', 'blocked', causeOf('check_interrupted', successorDetail(round)));
      }
      return projection('P12', 'verifying', causeOf('verification_running', {
        ...successorDetail(round),
        ...(round.interruptedCheckIds.length === 0 ? {} : { checkIds: round.interruptedCheckIds }),
      }));
    case 'none': return projection('P11', 'verifying', causeOf('awaiting_verification'));
    // P1 already took an applicable reduction.
    case 'pass': return projection('P13', 'verifying', causeOf('awaiting_completion', successorDetail(round)));
    default: return unreachable(round, 'round signal');
  }
}

/**
 * P20 (C5, §9 VD-15): a gate's own chain head mapped as the work rows map the
 * selected Run's head (open → P9/P12, FAIL → P7, INCONCLUSIVE → P8, clean
 * PASS → P13, invalid → P10), under the row P20 with
 * `detail.gate` and the head's `ordinal`; `null` without a chain (P16).
 */
function gateChainProjection(round: RoundTaskSignalV1): TaskPhaseProjection | null {
  switch (round.kind) {
    case 'none': return null;
    case 'invalid': return projection('P20', 'blocked', causeOf('round_ambiguous', { gate: true }));
    case 'open':
    case 'fail':
    case 'inconclusive':
    case 'pass': {
      const head = completedRunProjection(round);
      const cause = head.cause;
      if (cause === null) throw new Error('a chain head always projects with a cause');
      return projection('P20', head.phase, causeOf(cause.code, { ...cause.detail, gate: true, ordinal: round.ordinal }));
    }
    default: return unreachable(round, 'round signal');
  }
}

/** §4.6 `projectTaskPhase`: the phase and cause of `CanonicalTaskState`/`TaskRow` (§14.1). */
export function projectTaskPhase(facts: TaskPhaseFacts): { phase: Phase; cause: TaskPhaseCauseV1 | null } {
  const { phase, cause } = classifyTaskPhase(facts);
  return { phase, cause };
}

// -------------------------------------------------------------------------- //
// Machine state, guard context, events and effects (§4.2)                    //
// -------------------------------------------------------------------------- //

/** A Task of the active Plan: its definition dimensions plus its projection. */
export type TaskState = { taskKind: TaskKind; disposition: Disposition } & TaskPhaseProjection;
/** `null` is ∅: the taskId is not in the active Plan (TASK-25 is the only way in). */
export type TaskMachineState = TaskState | null;

export function taskMachineStateOf(
  definition: Pick<RuntimeTask, 'taskKind' | 'disposition'> | null,
  facts: TaskPhaseFacts,
): TaskMachineState {
  if (definition === null) return null;
  return { taskKind: definition.taskKind, disposition: definition.disposition, ...classifyTaskPhase(facts) };
}

/** The canonical lease projection (`plan-readers.ts` `CanonicalTaskState.lease`). */
export type TaskLeaseProjection = { status: 'free' } | { status: 'leased'; holderRunId: string };

/**
 * `task_claimed` facts beyond the Task state, in the order of the pre-step-3
 * `claim-service.ts:510-666` (line refs below are to that version). The
 * CoreRejections carry today's exact code and text; only the Goal and
 * Workspace pins stay the service's CAS.
 */
export type TaskClaimFacts = {
  goalDesiredState: GoalDesiredState;
  /** The requested Plan is the Goal's current pin (`:514-516`). */
  activePlanMatchesClaim: boolean;
  /**
   * SES-02 admission of the target Session (`session-availability.ts`
   * `occupancyAdmissionProblem`: lifecycle, health, occupancy, revision,
   * generation, then the caller's Session pin; `:536-545`); null when usable.
   */
  sessionProblem: CoreRejection | null;
  /** `task_planning_only`/`task_assignment_missing` of `evaluateEligibility` → `incomplete` (`:575-578`); null when none. */
  structuralProblem: CoreRejection | null;
  lease: TaskLeaseProjection;
  /** Directed read: some Run of this Task exists, even one excluded by its origin Plan (`:639-641`). */
  taskHasRun: boolean;
  /**
   * K3-38 (L11): the selected Run's UnknownCallReview as the owner read it;
   * absent = no record. `pending`/`held` refuse an ordinary claim `busy` with
   * `unknown_call_review_pending`/`unknown_call_review_held`; `unreadable`
   * refuses `unavailable` (L7 fail-closed).
   */
  reviewBlocker?: 'pending' | 'held' | 'unreadable';
  /** The continuation prior Run, as RUN-01 reads it (`:590-638`); null when it is not a Run of this Task. */
  prior: RunClaimContext['prior'];
  /** TASK-03: the TaskRequeue the claim's `requeueRef` names; null when it names none of this Task. */
  requeue: ClaimRequeueFacts | null;
  /** TASK-03r (K3): the review-claim facts; null/absent for every other basis. */
  review?: ReviewClaimFacts | null;
  /** Assignment, role and deadline admission (`:643-666`); null when admitted. */
  admission: CoreRejection | null;
};

/** `evaluateTaskCompletion` over the folded Evidence (`completion-policy.ts` returns this type). */
export type TaskCompletionVerdictV1 = {
  satisfied: boolean;
  phase: TaskReductionPhase;
  causes: TaskReductionCause[];
  satisfiedObligationIds: string[];
};

/** `task_completed` read facts (pre-step-3 `completion.ts:327-394`). */
export type TaskCompletionFacts = {
  /** The round's `subjectRunRef` Run. */
  producerRun: RunSnapshot;
  /** The producer Run's task kind in the selected Plan; null when the Plan does not define it. */
  producerTaskKind: TaskKind | null;
  evaluation: TaskCompletionVerdictV1;
  /**
   * The head of the selected Run's round chain as the projection read it
   * (`roundTaskSignal`, VD-14); null without a valid chain. A work Task
   * completes only from this round (TASK-14, C5).
   */
  chainHead: VerificationRoundRef | null;
};

/**
 * `disposition_changed` facts (TASK-18/19, C7): the Task's facts as
 * `readDispositionChangeTaskFacts` reads them (every Run, the selected Run,
 * the Lease, the Reduction and the pointer ControlIntent; all empty for an
 * untraced Task), the Goal's desired state, the adopted candidate's
 * `reason.affectedTaskIds` and the source definition's `replacedByTaskId`
 * (null when absent).
 */
export type TaskDispositionFacts = {
  facts: TracedTaskFactsV1;
  goalDesiredState: GoalDesiredState;
  affectedTaskIds: readonly string[] | undefined;
  replacedByTaskId: string | null;
};

export type TaskGuardContext = {
  /** The Task id, for refusal texts. */
  taskId: string;
  /** `task_claimed` only. */
  claim: TaskClaimFacts | null;
  /** `task_completed` only. */
  completion: TaskCompletionFacts | null;
  /** `disposition_changed` only. */
  disposition: TaskDispositionFacts | null;
  /** `task_requeued` and `task_rework_refused` only (absent for every other event). */
  rework?: TaskReworkFacts;
};

/**
 * The facts TASK-16/17/28 read beside the Task state, in the window of
 * §4.3 "处理步骤" step 3 (the requeue owner's directed read).
 */
export type TaskReworkFacts = {
  /** The Task's selected Run; null without one (P15, P16). */
  selectedRun: RunSnapshot | null;
  /** The request's `afterRunRef` is that selected Run. */
  afterRunIsSelected: boolean;
  /** `roundChainHead` of the selected Run's work chain, whatever its outcome (I-12 clause 2). */
  chain: RoundChainHeadV1;
  /** §13.1 `plan`: the Task's effective basis resolves in the active Plan. */
  basisResolved: boolean;
  goalDesiredState: GoalDesiredState;
  /** ND-3: `basis.digest` of every TaskRequeue of the Task read in the window. */
  priorBasisDigests: readonly string[];
  /**
   * Slice 1 §3.2 S1-TASK-01: the owner-verified archive interruption of this
   * requeue (from the durable request/anchor or the exact wait disposition);
   * absent is null, and `deriveReworkClass` then keeps its old three-argument
   * classification.
   */
  archive?: VerifiedArchiveInterruptionV1 | null;
};

/** §9 events that reach a Task only through its round-chain head. */
export type TaskRoundEventKind = 'round_opened' | 'check_begun' | 'check_result_recorded' | 'check_interrupted'
  | 'check_abandoned';

/**
 * §4.2. Every event another machine judges carries `facts`: the projection
 * inputs after that event's own commit.
 */
export type TaskEvent =
  /** TASK-25 (W15 initial, W16 future-only). An existing Task only re-projects. */
  | { kind: 'plan_adopted'; adoption: 'initial' | 'future';
      definition: Pick<RuntimeTask, 'taskKind' | 'disposition' | 'phase'>; facts: TaskPhaseFacts }
  /** TASK-01..03; same commit as §6 `claim_committed`, §5 `attempt_claimed`, §8 `occupancy_acquired`. */
  | { kind: 'task_claimed'; claim: TaskClaim; basis: AttemptClaimBasis; budget: TaskBudgetV1 }
  /** TASK-04..08, 20, 21, 26: the §6 Run event that ended `runRef`. */
  | { kind: 'run_ended'; runRef: RunRef; facts: TaskPhaseFacts }
  /** TASK-22, 23. */
  | { kind: 'control_submitted'; runRef: RunRef; control: ControlIntentKindV1; facts: TaskPhaseFacts }
  /** TASK-09, 12, 30. */
  | { kind: TaskRoundEventKind; roundRef: VerificationRoundRef; subjectRunRef: RunRef; facts: TaskPhaseFacts }
  /** TASK-10, 11, 13, 20, 30. */
  | { kind: 'round_finalized'; roundRef: VerificationRoundRef; subjectRunRef: RunRef; outcome: EvidenceOutcome;
      gapCodes: string[]; facts: TaskPhaseFacts }
  /** TASK-29, 30 (§9 VR-14). */
  | { kind: 'round_reverified'; roundRef: VerificationRoundRef; predecessorRoundRef: VerificationRoundRef;
      subjectRunRef: RunRef; facts: TaskPhaseFacts }
  /** TASK-14, 15, 24: the finalized round the request names and the reduction the owner built around it. */
  | { kind: 'task_completed'; task: TaskTriple; round: RoundSnapshot; reduction: TaskReductionBuildV1 }
  /** TASK-16, 17, 27 (step 5.4/5.6). */
  | { kind: 'task_requeued'; requeue: NewTaskRequeueInput }
  /**
   * TASK-28 (step 5.4/5.9): the refusal record `newTaskReworkRefusalRecord`
   * built, and the selected Run's pointer intent the matrix fence is judged
   * with (read after the window, like `task_requeued`'s).
   */
  | { kind: 'task_rework_refused'; refusal: TaskReworkRefusalSnapshotV1; pointerIntent: StopIntentV1 | null }
  /** TASK-18, 19 (W16). */
  | { kind: 'disposition_changed'; to: Disposition; replacedByTaskId: string | null; actorClass: ReworkActorClass };

/**
 * Same-commit intents (§4.3 effects column). The claim effects name the
 * records §5/§6/§8 build for the same claim (`newTaskAttemptRecord`,
 * `newRunRecord`, `newDispatchOutboxRecord`, the lease rows ATT-14/15 and
 * `occupySessionRecord`); the plan effects are §3's and §2's.
 */
export type TaskEffect =
  | { kind: 'create_attempt' }
  | { kind: 'create_run' }
  | { kind: 'create_outbox' }
  /** `first`: @1 (ATT-14); `reheld`: @k→@k+1 without `release` (ATT-15). */
  | { kind: 'hold_lease'; lease: 'first' | 'reheld' }
  /** Generation = Session revision + 1. */
  | { kind: 'occupy_session'; sessionRef: TaskClaim['sessionRef']; generation: number }
  | { kind: 'write_task_reduction'; reduction: TaskReductionSnapshot }
  | { kind: 'write_task_requeue'; requeue: TaskRequeueSnapshotV1 }
  | { kind: 'write_task_rework_refusal'; refusal: TaskReworkRefusalSnapshotV1 }
  | { kind: 'write_plan_revision' }
  /** TASK-18/19 (C7): the change's entry in the new Plan's `PlanRevisionSnapshot.dispositionRecord`. */
  | { kind: 'record_disposition_change' }
  | { kind: 'move_goal_pointer' }
  /** K3 TASK-03r: the same commit writes the review record's `activeRound` (UCR-03). */
  | { kind: 'record_review_round_claim'; reviewRef: UnknownCallReviewRef; runRef: RunRef;
      phase: 'review' | 'proposal'; round: number; stateEntry: number };

export type TaskTransition = Transition<TaskMachineState, TaskEvent, TaskEffect>;

// -------------------------------------------------------------------------- //
// Record constructors (§14.1: TaskReductionSnapshot, TaskRequeueSnapshotV1)  //
// -------------------------------------------------------------------------- //

/** What the completion owner built besides the round and the evaluation (pre-step-3 `completion.ts:396-436`). */
export type TaskReductionBuildV1 = {
  ref: TaskReductionRef;
  /** The persisted revision; null before the first reduction (written @1). */
  previousRevision: number | null;
  plan: Pick<PlanRevisionSnapshot, 'ref' | 'planRevision' | 'effectiveCompletionPolicy' | 'effectiveArchitectureBaseline'>;
  definition: Pick<RuntimeTask, 'taskKind' | 'requirementLevel' | 'disposition'>;
  effectiveEvidenceIds: string[];
  blockingEvidenceIds: string[];
  staleEvidenceIds: string[];
  outOfScopeEvidenceIds: string[];
  /** The admitted Evidence the index read (pre-step-3 `completion.ts:360`). */
  evidenceRefs: EvidenceRef[];
  reducedAt: string;
};

export type NewTaskReductionInput = TaskReductionBuildV1 & { round: RoundSnapshot; evaluation: TaskCompletionVerdictV1 };

/**
 * TASK-14/15/24: the reduction `completeTask` writes, in the pre-step-3 `completion.ts:408-436`
 * key order. Its only writer reduces to `satisfied` (§4.1); any other
 * evaluation is refused before a record exists.
 */
export function newTaskReductionRecord(input: NewTaskReductionInput): TaskReductionSnapshot {
  if (!input.evaluation.satisfied || input.evaluation.phase !== 'satisfied') {
    throw new Error(`task reduction ${input.ref.taskId} is written only for a satisfied evaluation`);
  }
  const { round, plan } = input;
  return {
    ref: input.ref,
    revision: (input.previousRevision ?? 0) + 1,
    schemaVersion: 1,
    planRef: plan.ref,
    planRevision: plan.planRevision,
    taskKind: input.definition.taskKind,
    requirementLevel: input.definition.requirementLevel,
    disposition: input.definition.disposition,
    phase: 'satisfied',
    currentAnchor: { schemaVersion: 1, planRef: plan.ref, planRevision: plan.planRevision,
      workspaceRevision: round.identity.workspaceRevision,
      pinnedCompletionPolicy: plan.effectiveCompletionPolicy,
      pinnedArchitectureBaseline: plan.effectiveArchitectureBaseline },
    effectiveEvidenceIds: input.effectiveEvidenceIds,
    blockingEvidenceIds: input.blockingEvidenceIds,
    staleEvidenceIds: input.staleEvidenceIds,
    outOfScopeEvidenceIds: input.outOfScopeEvidenceIds,
    satisfiedObligationIds: input.evaluation.satisfiedObligationIds,
    causes: input.evaluation.causes,
    reducedAt: input.reducedAt,
    completion: {
      schemaVersion: 1,
      roundRef: round.ref,
      roundRevision: round.revision,
      taskBasisRef: round.taskBasisRef,
      verificationPlanRef: { planId: round.verificationPlan.planId, planDigest: round.verificationPlan.planDigest },
      configurationDigest: round.configurationDigest,
      evidenceRefs: input.evidenceRefs,
    },
  };
}

/** The Run-chain facts of the C8 count (`nextRequeueAutoCount`): the Task's Runs and TaskRequeues of the same window. */
type RequeueChainRun = Pick<RunSnapshot, 'ref' | 'requeueRef' | 'consumedWait'>;

/**
 * The inputs of one TaskRequeue@1 (§4.1 field table). The record derives the
 * platform facts itself through `state/` functions, never from the request
 * (§14.1): the actor class from `requestedBy` (`reworkActorClassOf`, §11
 * `actorClass`), the class, interruption and stop fact from
 * `deriveReworkClass` (TD-8, `task-failure.ts`), `automation` from
 * `nextRequeueAutoCount` (C8), `afterRoundRef` and `supersededEvidenceIds`
 * from the chain head (`chainEvidenceIds`, TD-2), `basisComparison` from the
 * class and the actor class (ND-5, ND-6), `historySource` from the afterRun's
 * Kernel history or its `requeueRef` record (`requeueHistorySourceOf`, I-12
 * clause 10). `basis` is `noProgressKey` (`no-progress.ts`) over the source
 * the owner captured.
 */
export type NewTaskRequeueInput = {
  task: TaskTriple;
  /** The Goal's active Plan at requeue time. */
  planRef: PlanRevisionRef;
  /** The selected Run the requeue covers (the lease holder). */
  afterRun: RunSnapshot;
  /** The afterRun's pointer intent (immutable request fields, read after the window); null without a pointer. */
  pointerIntent: StopIntentV1 | null;
  /** `roundChainHead` of the afterRun's work chain. */
  chain: RoundChainHeadV1;
  /** The real actor: human, system (a platform automation actor) or agent (with its `runRef`). */
  requestedBy: ActorRef;
  requestedAt: string;
  reason: string;
  basis: NoProgressKeyV1;
  /** Verified by `newBasisInputProblem`; a stored human note is already one of them (§13.1). */
  newInputRefs: readonly NewBasisInputRefV1[];
  budget: TaskBudgetV1 | null;
  /** The owner has checked the epochs and the pointer intent against the Goal (TASK-27, GOAL-29). */
  trigger: TaskRequeueTriggerV1 | null;
  agentProvenance: DelegatedWriteProvenanceV1 | null;
  runs: readonly RequeueChainRun[];
  /** The Task's TaskRequeues of the same window (the C8 count and the one-hop history source). */
  requeues: readonly Pick<TaskRequeueSnapshotV1, 'ref' | 'automation' | 'historySource'>[];
  policy: Pick<TaskAutomationPolicyV1, 'autoReworkLimit'>;
  /** Slice 1 §2.6: set only on a requeue caused by an archive; absent is null. */
  archiveOrigin?: ArchiveRequeueOriginV1 | null;
  /** Slice 1 §3.5: the owner-verified archive interruption `deriveReworkClass` may use; absent is null. */
  archive?: VerifiedArchiveInterruptionV1 | null;
};

/** ND-5 / ND-6: `interrupted` and a human requeue of a cancel skip the key comparison. */
function basisComparisonOf(failureClass: ReworkFailureClass, actorClass: ReworkActorClass): TaskRequeueBasisComparison {
  if (failureClass === 'interrupted') return 'skipped_interrupted';
  if (failureClass === 'cancelled' && actorClass === 'human') return 'skipped_human_cancel';
  return 'compared';
}

function sameTask(left: TaskTriple, right: TaskTriple): boolean {
  return left.projectId === right.projectId && left.goalId === right.goalId && left.taskId === right.taskId;
}

function sameIntentRef(left: ControlIntentRef, right: ControlIntentRef): boolean {
  return left.aggregateType === right.aggregateType && left.projectId === right.projectId
    && left.workspaceId === right.workspaceId && left.intentId === right.intentId;
}

/** The pointer intent a requeue or a refusal judges with is the Run's own (none without a pointer). */
function isRunPointerIntent(run: Pick<RunSnapshot, 'controlState'>, pointerIntent: StopIntentV1 | null): boolean {
  const pointerRef = run.controlState?.intentRef ?? null;
  return pointerIntent === null ? pointerRef === null : pointerRef !== null && sameIntentRef(pointerIntent.ref, pointerRef);
}

/** The facts the record reads belong to the requeued Task and its afterRun. */
function taskRequeueSubjectProblem(input: NewTaskRequeueInput): string | null {
  const { afterRun, chain } = input;
  if (!sameTask(afterRun.task, input.task)) return 'the afterRun belongs to another task';
  if (chain.kind === 'head'
    && (chain.head.subjectRunRef.runId !== afterRun.ref.runId || !sameTask(chain.head.subject, input.task))) {
    return 'the round chain is not the afterRun chain';
  }
  if (!isRunPointerIntent(afterRun, input.pointerIntent)) return 'the pointer intent is not the afterRun pointer';
  if (!sameTask(input.basis.taskRef, input.task)) return 'the no-progress key belongs to another task';
  if (input.reason.trim().length === 0 || input.reason.length > TASK_REWORK_REASON_MAX_CHARS) {
    return `the reason is empty or longer than ${TASK_REWORK_REASON_MAX_CHARS} characters`;
  }
  if (input.newInputRefs.length > MAX_NEW_BASIS_INPUT_REFS) return `more than ${MAX_NEW_BASIS_INPUT_REFS} new input refs`;
  const limit = input.policy.autoReworkLimit;
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_AUTO_REWORK_LIMIT) {
    return `the auto-rework limit ${limit} is not an integer 0..${MAX_AUTO_REWORK_LIMIT}`;
  }
  return null;
}

/**
 * §11 I-12 clause 2 (C5) for every afterRun outcome: no round gives
 * `afterRoundRef = null`; otherwise the chain is valid and its head is
 * finalized and not a clean PASS. `deriveReworkClass` reads the chain only for
 * a `completed` Run (FC-11..17), and today a round opens on any ended Run
 * (`evidence-service.ts:440`), so a crashed, cancelled, failed or
 * budget_exhausted afterRun is checked here too (§4.3 step 3: an invalid
 * chain is `incomplete`, an open head `finalize_first:`).
 */
function taskRequeueChainProblem(chain: RoundChainHeadV1, row: string): string | null {
  switch (chain.kind) {
    case 'none': return null;
    case 'invalid': return `the round chain is invalid (${chain.reason}); a requeue needs a valid chain (incomplete)`;
    case 'head': {
      const head = chain.head;
      if (head.status !== 'finalized') {
        return `the round chain head ${head.ref.roundId} is open; it is finalized before a requeue (${row})`;
      }
      if (!isFinalizedNonPass(head)) {
        return `the round chain head ${head.ref.roundId} is a clean PASS; there is no round to rework`;
      }
      return null;
    }
    default: return unreachable(chain, 'round chain');
  }
}

/**
 * §11 I-12 clauses 2, 3, 6 and 8 (and I-17) as far as the input shows them:
 * the legal (class, actor, request) combinations. The owner refuses every
 * other one first with a 0-commit CoreError (TASK-16/17/27, §4.4), so a
 * problem here is a caller bug.
 * - the chain is valid, its head finalized and not a clean PASS (clause 2;
 *   FC-13: finalize first);
 * - the no-progress key describes the afterRun outcome;
 * - `agentProvenance` exactly for an agent;
 * - the §4.3 matrix with the human-stop fence (`reworkPermission`; the Goal is
 *   active, the step-local clause the owner guards): `check_incomplete` only
 *   for a human, `cancelled` never for an agent, a paused interruption only
 *   for a human or the Goal-resume continuation, `GOAL_FAN_OUT_ACTOR` only with
 *   a trigger on a paused interruption, no agent budget, no trigger from
 *   anyone else;
 * - the trigger names this Goal and a pause before the resume;
 * - `budget_exhausted` needs a larger budget or a new input (G-BUDGET).
 */
function taskRequeueCombinationProblem(
  input: NewTaskRequeueInput,
  actorClass: ReworkActorClass,
  derivation: Extract<ReworkClassDerivationV1, { kind: 'class' }>,
): string | null {
  const afterRun = input.afterRun;
  const chainProblem = taskRequeueChainProblem(input.chain, derivation.row);
  if (chainProblem !== null) return chainProblem;
  if (input.basis.failure.outcome !== afterRun.outcome) return 'the no-progress key was computed for another outcome';
  if ((input.agentProvenance !== null) !== (actorClass === 'agent')) {
    return 'agent provenance is recorded exactly for an agent requeue';
  }
  const refusal = requeuePermission(afterRun, input.pointerIntent, derivation, input.requestedBy, actorClass, 'active',
    { trigger: input.trigger !== null, budget: input.budget !== null });
  if (refusal !== null && !refusal.ok) return refusal.detail;
  const trigger = input.trigger;
  if (trigger !== null) {
    if (trigger.goalRef.projectId !== input.task.projectId || trigger.goalRef.goalId !== input.task.goalId) {
      return 'the goal_resume trigger names another Goal';
    }
    if (!(trigger.pausedEpoch < trigger.resumedEpoch)) return 'the goal_resume trigger pause is not before its resume';
  }
  if (!requeueBudgetIncreased(afterRun, input.budget, input.newInputRefs.length)) {
    return 'a budget_exhausted requeue needs a larger token budget or a new input (budget_not_increased)';
  }
  return null;
}

/**
 * Steps 4–5 of a requeue (§4.3 "处理步骤"): `reworkPermission`, the one actor ×
 * class matrix, over the afterRun's class and fence and the requester; TASK-16/17/27/28.
 */
function requeuePermission(
  afterRun: RunSnapshot, pointerIntent: StopIntentV1 | null, derivation: Extract<ReworkClassDerivationV1, { kind: 'class' }>,
  requestedBy: ActorRef, actorClass: ReworkActorClass, goalDesiredState: GoalDesiredState,
  request: { trigger: boolean; budget: boolean },
): Rejected | null {
  return reworkPermission({ operation: 'requeue', goalDesiredState, failureClass: derivation.failureClass,
    interruption: permissionInterruptionOf(derivation), fence: reworkFenceOf(afterRun, pointerIntent), actorClass,
    goalFanOut: isGoalFanOutActor(requestedBy), trigger: request.trigger, budget: request.budget, note: false });
}

/** G-CAP (C8): a counted automatic requeue past the cap (`nextRequeueAutoCount`). */
function requeueCapExceeded(automation: TaskRequeueAutomationV1): boolean {
  return automation.counted && automation.cap !== null && automation.autoCount > automation.cap;
}

function requeueCannotBeBuilt(problem: string): never {
  throw new Error(`a TaskRequeue cannot be built: ${problem}`);
}

/**
 * TASK-16/17/27: TaskRequeue@1, written once with CAS null (L-3), in contract
 * key order. It refuses every §11 I-12 combination the input can show: the
 * afterRun derives a rework class (FC-3, 6..10, 15, 16; FC-13 only after its
 * head is finalized), its chain is none or valid with a finalized head that is
 * not a clean PASS, the actor may rework it, and a counted automatic requeue
 * stays within the cap (G-CAP). An afterRun with nothing to rework or that is
 * not reworkable has no record. The covered evidence is the afterRun's whole
 * chain, `[]` without a round; the history source is derived from the
 * afterRun and the window's TaskRequeues (`requeueHistorySourceOf`, I-12
 * clause 10). One I-12 clause stays with the owner's read window because the
 * input does not carry its facts: clause 5 (a `compared` key differs from
 * every earlier requeue's digest, G-BASIS → TASK-28).
 */
export function newTaskRequeueRecord(input: NewTaskRequeueInput): TaskRequeueSnapshotV1 {
  const subjectProblem = taskRequeueSubjectProblem(input);
  if (subjectProblem !== null) return requeueCannotBeBuilt(subjectProblem);
  const actorClass = reworkActorClassOf(null, input.requestedBy);
  if (actorClass === null) return requeueCannotBeBuilt('the requester has no rework actor class');
  const { afterRun, chain } = input;
  const derivation = deriveReworkClass(afterRun, input.pointerIntent, chain, input.archive ?? null);
  const afterOutcome = afterRun.outcome;
  if (derivation.kind !== 'class' || afterOutcome === null || afterOutcome === 'outcome_unknown') {
    return requeueCannotBeBuilt(`run ${afterRun.ref.runId} has no rework class (${derivation.row})`);
  }
  const combinationProblem = taskRequeueCombinationProblem(input, actorClass, derivation);
  if (combinationProblem !== null) return requeueCannotBeBuilt(combinationProblem);
  const head = chain.kind === 'head' ? chain.head : null;
  const automation = nextRequeueAutoCount({ actorClass, failureClass: derivation.failureClass,
    afterRun, runs: input.runs, requeues: input.requeues, policy: input.policy });
  if (requeueCapExceeded(automation)) {
    return requeueCannotBeBuilt(
      `automatic requeue ${automation.autoCount} exceeds the cap ${automation.cap} (auto_rework_cap_reached)`);
  }
  return {
    ref: { aggregateType: 'TaskRequeue', projectId: input.task.projectId, goalId: input.task.goalId,
      taskId: input.task.taskId, afterRunId: afterRun.ref.runId },
    revision: 1,
    schemaVersion: 1,
    task: { projectId: input.task.projectId, goalId: input.task.goalId, taskId: input.task.taskId },
    planRef: input.planRef,
    afterRunRef: afterRun.ref,
    afterAttemptRef: { aggregateType: 'TaskAttempt', projectId: afterRun.ref.projectId, goalId: afterRun.ref.goalId,
      taskId: afterRun.task.taskId, attemptId: afterRun.attemptId },
    afterOutcome,
    afterRoundRef: head === null ? null : head.ref,
    failureClass: derivation.failureClass,
    interruption: derivation.interruption,
    stopIntentRef: derivation.stop.intentRef,
    stopRequester: derivation.stop.requester,
    ...(input.trigger === null ? {} : { trigger: input.trigger }),
    basis: input.basis,
    basisComparison: basisComparisonOf(derivation.failureClass, actorClass),
    supersededEvidenceIds: head === null ? [] : chainEvidenceIds(head),
    newInputRefs: [...input.newInputRefs],
    budget: input.budget,
    reason: input.reason,
    requestedBy: input.requestedBy,
    requestedAt: input.requestedAt,
    agentProvenance: input.agentProvenance,
    automation,
    historySource: requeueHistorySourceOf(afterRun, input.requeues),
    ...(input.archiveOrigin == null ? {} : { archiveOrigin: input.archiveOrigin }),
  };
}

// -------------------------------------------------------------------------- //
// Shared guard rows                                                           //
// -------------------------------------------------------------------------- //

function absentTask(kind: TaskEvent['kind']): Rejected {
  return reject('illegal', 'not_found', `${kind} needs a Task of the active Plan`);
}

function sameRunRef(left: RunRef, right: RunRef): boolean {
  return left.projectId === right.projectId && left.goalId === right.goalId && left.runId === right.runId;
}

/** Facts for another kind of Task would project the wrong rows (P20 reads only gates). */
function factsKindProblem(state: TaskState, facts: TaskPhaseFacts): Rejected | null {
  return facts.taskKind === state.taskKind ? null
    : reject('illegal', 'invalid', `the projection facts are for a ${facts.taskKind} task, not a ${state.taskKind} task`);
}

function sameProjection(state: TaskState, next: TaskPhaseProjection): boolean {
  return state.row === next.row && state.phase === next.phase
    && canonicalJson(state.cause as unknown as JsonValue) === canonicalJson(next.cause as unknown as JsonValue);
}

/** SD-1: a re-projection; an unchanged projection returns the same state. */
function reprojected(state: TaskState, facts: TaskPhaseFacts): TaskTransition {
  const next = classifyTaskPhase(facts);
  if (sameProjection(state, next)) return accept(state);
  return accept({ taskKind: state.taskKind, disposition: state.disposition, ...next });
}

// -------------------------------------------------------------------------- //
// transitionTask (§4.3, forbidden §4.4)                                       //
// -------------------------------------------------------------------------- //

export function transitionTask(state: TaskMachineState, event: TaskEvent, ctx: TaskGuardContext): TaskTransition {
  switch (event.kind) {
    case 'plan_adopted': return onPlanAdopted(state, event, ctx);
    case 'task_claimed': return onTaskClaimed(state, event, ctx);
    case 'run_ended': return onRunEnded(state, event);
    case 'control_submitted': return onControlSubmitted(state, event);
    case 'round_opened':
    case 'check_begun':
    case 'check_result_recorded':
    case 'check_interrupted':
    case 'check_abandoned':
    case 'round_finalized':
    case 'round_reverified':
      return onRoundEvent(state, event);
    case 'task_completed': return onTaskCompleted(state, event, ctx);
    case 'task_requeued': return onTaskRequeued(state, event, ctx);
    case 'task_rework_refused': return onTaskReworkRefused(state, event, ctx);
    case 'disposition_changed': return onDispositionChanged(state, event, ctx);
    default: return unreachable(event, 'Task event');
  }
}

/** A draft phase that claims progress (`plan-validation.ts:234-244`). */
function claimsProgress(phase: Phase): boolean {
  return phase === 'satisfied' || phase === 'running' || phase === 'verifying' || phase === 'failed';
}

/**
 * TASK-25: ∅ → `pending` (P16) whatever the draft phase. A future-only new
 * Task must be drafted `pending` (`plan-validation.ts:472-477`, checked before
 * the progress guard, `plan-service.ts:1737-1767`); an initial draft may not
 * claim progress (`plan-service.ts:1184-1185`). A Task already in the Plan
 * only re-projects.
 */
function onPlanAdopted(
  state: TaskMachineState,
  event: Extract<TaskEvent, { kind: 'plan_adopted' }>,
  ctx: TaskGuardContext,
): TaskTransition {
  if (state !== null) return factsKindProblem(state, event.facts) ?? reprojected(state, event.facts);
  const draftPhase = event.definition.phase;
  if (event.adoption === 'future' && draftPhase !== 'pending') {
    return reject('guard_failed', 'invalid', `new task ${ctx.taskId} must start in phase pending, not ${draftPhase}`);
  }
  if (claimsProgress(draftPhase)) {
    return reject('illegal', 'incomplete', draftPhase === 'satisfied'
      ? `task ${ctx.taskId} declares phase 'satisfied' before any completion evidence`
      : `task ${ctx.taskId} declares phase '${draftPhase}' before any run/evidence fact`);
  }
  return accept({ taskKind: event.definition.taskKind, disposition: event.definition.disposition,
    row: 'P16', phase: 'pending', cause: null });
}

/** The phase reason of `evaluateEligibility` (`eligibility.ts:62-72`) as `claim-service.ts:575-582` maps it. */
function claimPhaseProblem(phase: Phase): Rejected | null {
  switch (phase) {
    case 'pending':
    case 'ready':
      return null;
    case 'blocked': return reject('guard_failed', 'busy', 'task is blocked');
    // §4.4: reopening a satisfied Task needs a plan evolution, not a claim.
    case 'satisfied': return reject('illegal', 'busy', 'task phase is not dispatchable (pending|ready)');
    case 'running':
    case 'verifying':
    case 'failed':
      return reject('guard_failed', 'busy', 'task phase is not dispatchable (pending|ready)');
    default: return unreachable(phase, 'Task phase');
  }
}

/** The Task dimensions TASK-01..03 read: kind, disposition and the projected phase. */
export type TaskClaimSubject = Pick<TaskState, 'taskKind' | 'disposition' | 'phase'>;

/**
 * TASK-01 (first), TASK-02 (continuation), TASK-03 (requeue) guards in
 * `claim-service.ts:510-666` order; `null` when the claim may commit. The pins
 * and the claim basis are the one copy RUN-01 asks too (`claimPinProblem`,
 * `claimBasisProblem`); the Session, Task, phase and lease guards between
 * them are this machine's. It needs
 * no claim ids: `transitionTask` applies it to `task_claimed`, and the claim
 * service also asks it after each read (a fact not read yet holds), so a
 * refused guard stops the claim's reads where they always stopped.
 */
export function taskClaimProblem(
  task: TaskClaimSubject | null,
  claimBasis: AttemptClaimBasis,
  facts: TaskClaimFacts,
): Rejected | null {
  const pin = claimPinProblem(facts.goalDesiredState, facts.activePlanMatchesClaim);
  if (pin !== null) return pin;
  if (facts.sessionProblem !== null) return rejected(facts.sessionProblem);
  if (task === null) return reject('illegal', 'not_found', 'the Task is not part of the accepted Plan');
  if (task.taskKind !== 'work') return reject('illegal', 'invalid', 'only a work task can be claimed');
  if (task.disposition !== 'active') return reject('guard_failed', 'invalid', 'the Task disposition is not active');
  if (facts.structuralProblem !== null) return rejected(facts.structuralProblem);
  // K3 L11 (D3): the selected Run's review record blocks an ordinary claim
  // BEFORE the phase and lease guards (the record is checked first, §3.4); the
  // review claim (TASK-03r) is the only basis that passes.
  if (claimBasis.kind !== 'review') {
    const reviewProblem = reviewBlockerProblem(facts.reviewBlocker);
    if (reviewProblem !== null) return reviewProblem;
  }
  // TASK-03r (K3, L10): a review claim reads P6 (`failed`) or P4 (`ready`);
  // its own `projectionAdmitsReview` guard replaces the ordinary phase guard.
  const phaseProblem = claimBasis.kind === 'review' ? null : claimPhaseProblem(task.phase);
  if (phaseProblem !== null) return phaseProblem;
  if (facts.lease.status === 'leased') {
    return reject('guard_failed', 'busy', `task already has an active lease (holder run ${facts.lease.holderRunId})`);
  }
  return claimBasisProblem(claimBasis, facts);
}

/** TASK-01..03: `taskClaimProblem`, then the claim's records in one commit. */
function onTaskClaimed(
  state: TaskMachineState,
  event: Extract<TaskEvent, { kind: 'task_claimed' }>,
  ctx: TaskGuardContext,
): TaskTransition {
  const facts = ctx.claim;
  if (facts === null) return reject('illegal', 'invalid', 'task_claimed requires the claim guard facts');
  const problem = taskClaimProblem(state, event.basis, facts);
  if (problem !== null) return problem;
  // `taskClaimProblem` refuses ∅ (`not_found`), so the Task is in the Plan here.
  const { taskKind, disposition } = state as TaskState;
  const basis = event.basis;
  const claim = event.claim;
  // TASK-03r (L10): the review claim leaves the Task projection unchanged (the
  // selected Run is still the original one); every other claim writes P2.
  const next = basis.kind === 'review'
    ? (state as TaskState)
    : { taskKind, disposition, row: 'P2' as const, phase: 'running' as const, cause: null };
  return accept(next, [
    { kind: 'create_attempt' },
    { kind: 'create_run' },
    { kind: 'create_outbox' },
    // ATT-15 (continuation), ATT-16 (requeue) and ATT-16r (review) re-hold the released lease @k+1.
    { kind: 'hold_lease', lease: basis.kind === 'first' ? 'first' : 'reheld' },
    { kind: 'occupy_session', sessionRef: claim.sessionRef, generation: claim.generation },
    // UCR-03 (L10): the same commit writes the record's activeRound.
    ...(basis.kind === 'review' && facts.review != null ? [{ kind: 'record_review_round_claim' as const,
      reviewRef: structuredClone(facts.review.reviewRef), runRef: claim.runRef,
      phase: facts.review.phase, round: facts.review.round, stateEntry: facts.review.stateEntry }] : []),
  ]);
}

/**
 * TASK-04..08, 20, 21, 26: the ended selected Run re-projects (TASK-04 `ready`,
 * TASK-05 `verifying`, TASK-06 `failed`, TASK-07 `blocked/run_outcome_unknown`,
 * TASK-21 P17/P18), and TASK-08 resolves an unknown end the same way.
 */
function onRunEnded(state: TaskMachineState, event: Extract<TaskEvent, { kind: 'run_ended' }>): TaskTransition {
  if (state === null) return absentTask(event.kind);
  const kindProblem = factsKindProblem(state, event.facts);
  if (kindProblem !== null) return kindProblem;
  const run = event.facts.selectedRun;
  // TASK-20 (R5): the end of an older Run never changes its successor's projection.
  if (run === null || !sameRunRef(run.ref, event.runRef)) return accept(state);
  const outcome = run.outcome;
  if (run.status !== 'ended' || outcome === null) {
    return reject('illegal', 'invalid', 'the projection facts do not show the ended Run with its outcome');
  }
  // TASK-06 (crashed/cancelled/budget_exhausted/failed → P6) and TASK-26 (paused-interrupted, C4 → P19) re-project.
  return reprojected(state, event.facts);
}

/**
 * TASK-22/23: a pause, cancel or resume on the selected `YieldedWait` moves its
 * pointer and so its projection (TD-5: P5 ⇄ P18, P5/P18 → P17); any other
 * control only re-projects.
 */
function onControlSubmitted(state: TaskMachineState, event: Extract<TaskEvent, { kind: 'control_submitted' }>): TaskTransition {
  if (state === null) return absentTask(event.kind);
  const kindProblem = factsKindProblem(state, event.facts);
  if (kindProblem !== null) return kindProblem;
  const run = event.facts.selectedRun;
  if (run === null || !sameRunRef(run.ref, event.runRef)) return accept(state);
  return reprojected(state, event.facts);
}

type RoundTaskEvent = Extract<TaskEvent, { kind: TaskRoundEventKind | 'round_finalized' | 'round_reverified' }>;

/** The head round a chain signal names; null without a valid chain. */
function signalHeadRef(signal: RoundTaskSignalV1): VerificationRoundRef | null {
  return signal.kind === 'none' || signal.kind === 'invalid' ? null : signal.head.ref;
}

function sameRoundRef(left: VerificationRoundRef, right: VerificationRoundRef): boolean {
  return canonicalJson(left as unknown as JsonValue) === canonicalJson(right as unknown as JsonValue);
}

/** §4.4: the round finalizes as a clean PASS (PASS without gaps). */
function isCleanPassFinalize(event: RoundTaskEvent): boolean {
  return event.kind === 'round_finalized' && event.outcome === 'PASS' && event.gapCodes.length === 0;
}

/** §4.4, gate (P20 `check_interrupted`) and work (P9) alike: an interrupted round never finalizes clean. */
function interruptedCleanPass(): Rejected {
  return reject('illegal', 'invalid', 'an interrupted check is a gap, so the round cannot finalize as a clean PASS (§9 VD-4)');
}

/** TASK-09..13, 20, 29, 30 and the §4.4 interrupted-PASS row. */
function onRoundEvent(state: TaskMachineState, event: RoundTaskEvent): TaskTransition {
  if (state === null) return absentTask(event.kind);
  const kindProblem = factsKindProblem(state, event.facts);
  if (kindProblem !== null) return kindProblem;
  if (state.taskKind === 'gate') {
    // TASK-30 (C5): the gate's own chain head re-projects through P20 (a root
    // opening, its check events and finalize, a successor round); an event of
    // a round that is not the head after it is history only.
    const head = signalHeadRef(event.facts.round);
    if (head !== null && !sameRoundRef(head, event.roundRef)) return accept(state);
    if (state.cause?.code === 'check_interrupted' && isCleanPassFinalize(event)) return interruptedCleanPass();
    return reprojected(state, event.facts);
  }
  const run = event.facts.selectedRun;
  // TASK-20 (R5): a round of an older Run is history only.
  if (run === null || !sameRunRef(run.ref, event.subjectRunRef)) return accept(state);
  if (state.row === 'P9' && isCleanPassFinalize(event)) return interruptedCleanPass();
  // TASK-09 `verifying`, TASK-12 (D-12) `blocked/check_interrupted` once the
  // last pending/executing check settles with an interrupted one left, TASK-10
  // `failed`, TASK-11 `blocked/round_inconclusive`, TASK-13 `verifying`;
  // TASK-29 (C5, step 5.9): a successor round on the selected Run's chain makes
  // the open successor the head, `verifying/verification_running` with
  // `{ordinal, predecessorRoundRef}` (its legality is §9 VR-14's).
  return reprojected(state, event.facts);
}

/**
 * The round and producer checks of `completeTask` in the pre-step-3
 * `completion.ts:316-354` order, exported so the owner can stop at the same
 * points: after the round read (`producerRun` null: a producer not read yet
 * holds) and after the producer read, before it reads Evidence;
 * `transitionTask` re-runs them.
 */
export function taskCompletionRoundProblem(input: {
  task: TaskTriple;
  taskKind: TaskKind;
  round: RoundSnapshot;
  producerRun: RunSnapshot | null;
  producerTaskKind: TaskKind | null;
}): CoreRejection | null {
  const { task, round, producerRun } = input;
  const invalid = (reason: string): CoreRejection => ({ status: 'rejected', code: 'invalid', reason });
  const incomplete = (reason: string): CoreRejection => ({ status: 'rejected', code: 'incomplete', reason });
  if (!sameTask(round.subject, task)) return invalid('the round subject disagrees with the requested task');
  if (round.status !== 'finalized') return incomplete('the specified round is not finalized');
  if (round.outcome !== 'PASS') return incomplete('the specified round did not finalize as PASS');
  if (round.evidenceRefs.length === 0) return incomplete('the specified round admitted no Evidence');
  if (producerRun === null) return null;
  if (producerRun.ref.projectId !== task.projectId || producerRun.ref.goalId !== task.goalId) {
    return invalid('the round producer Run is outside the requested Goal');
  }
  if (producerRun.status !== 'ended') return incomplete('the round producer Run has not ended');
  if (producerRun.outcome === 'outcome_unknown') return incomplete('the round producer Run outcome is unknown');
  // A yielded producer Run exited active execution on a real wait: it produced no
  // verified output yet, so an old/other PASS can never complete the Task on it.
  // The continuation produces a new Run and the normal checks path resumes there.
  if (producerRun.outcome === 'yielded') {
    return incomplete('the round producer Run yielded on a wait and has not produced verified output yet');
  }
  if (input.taskKind === 'gate') {
    if (producerRun.task.taskId === task.taskId) {
      return invalid('a gate round must reference a same-Goal ordinary producer Run, not a gate Run');
    }
    if (input.producerTaskKind !== 'work') return invalid('the gate round producer Run must be a same-Plan work task');
  } else if (producerRun.task.taskId !== task.taskId) {
    return invalid('the round producer Run does not belong to the requested task');
  }
  return null;
}

/**
 * The fold check of `completeTask` (pre-step-3 `completion.ts:392-395`),
 * exported so the owner stops on an unsatisfied fold before it reads the
 * pinned policy; `transitionTask` re-runs it after the round checks.
 */
export function taskCompletionFoldProblem(taskId: string, evaluation: TaskCompletionVerdictV1): CoreRejection | null {
  if (evaluation.satisfied) return null;
  const detail = evaluation.causes.map(cause => cause.message).join('; ');
  return { status: 'rejected', code: 'incomplete',
    reason: `task ${taskId} is not satisfied (${evaluation.phase})${detail.length === 0 ? '' : `: ${detail}`}` };
}

/**
 * TASK-14/24 guards a work Task meets before its round is read (§4.4, C5): the
 * projection is `verifying` (TASK-14) or `satisfied` (TASK-24, a new
 * identity): `failed` and `blocked` are `illegal`/`incomplete` (an older PASS
 * never overtakes the latest failure), `pending`, `ready` and `running` are
 * `guard_failed`/`incomplete`. Then the requested round must be the head of
 * the selected Run's chain. A gate meets the same guards over its own chain
 * (TASK-15, C5): it completes from P20 `verifying(awaiting_completion)` with
 * its chain head.
 */
export function taskCompletionProjectionProblem(
  state: Pick<TaskState, 'taskKind' | 'phase'>,
  roundRef: VerificationRoundRef,
  chainHead: VerificationRoundRef | null,
): Rejected | null {
  switch (state.phase) {
    case 'verifying':
    case 'satisfied':
      break;
    case 'failed':
    case 'blocked':
      return reject('illegal', 'incomplete', `the task is ${state.phase}; a PASS round cannot complete it`);
    case 'pending':
    case 'ready':
    case 'running':
      return reject('guard_failed', 'incomplete', `the task is ${state.phase}; only a verifying task completes`);
    default: return unreachable(state.phase, 'Task phase');
  }
  if (chainHead === null || !sameRoundRef(roundRef, chainHead)) {
    return reject('guard_failed', 'incomplete', state.taskKind === 'gate'
      ? 'the specified round is not the head of the gate round chain'
      : 'the specified round is not the head of the selected Run round chain');
  }
  return null;
}

/**
 * TASK-14 (work), TASK-15 (gate), TASK-24 (already satisfied, new identity):
 * the projection and chain-head guards (`taskCompletionProjectionProblem`),
 * then the round, its producer and the fold. The TD-2 evidence exclusion is
 * the completion owner's (`evidenceSupersededByRequeue`).
 */
function onTaskCompleted(
  state: TaskMachineState,
  event: Extract<TaskEvent, { kind: 'task_completed' }>,
  ctx: TaskGuardContext,
): TaskTransition {
  if (state === null) return reject('illegal', 'incomplete', 'the selected Plan does not define the requested task');
  const facts = ctx.completion;
  if (facts === null) return reject('illegal', 'invalid', 'task_completed requires the completion guard facts');
  const projected = taskCompletionProjectionProblem(state, event.round.ref, facts.chainHead);
  if (projected !== null) return projected;
  const problem = taskCompletionRoundProblem({ task: event.task, taskKind: state.taskKind, round: event.round,
    producerRun: facts.producerRun, producerTaskKind: facts.producerTaskKind })
    ?? taskCompletionFoldProblem(event.task.taskId, facts.evaluation);
  if (problem !== null) return rejected(problem);
  const evaluation = facts.evaluation;
  const reduction = newTaskReductionRecord({ ...event.reduction, round: event.round, evaluation });
  return accept({ taskKind: state.taskKind, disposition: state.disposition, row: 'P1', phase: reduction.phase, cause: null },
    [{ kind: 'write_task_reduction', reduction }]);
}

// -------------------------------------------------------------------------- //
// Requeue and its policy refusal (TASK-16, 17, 28; §4.3 "处理步骤", §4.4)       //
// -------------------------------------------------------------------------- //

/**
 * Step 3 of the unified order (§4.3 "处理步骤", §13.2 point 3, §4.4) on the
 * Task's projection and the selected Run: the 0-commit refusals of a requeue
 * or a requeue policy refusal, first match wins.
 *
 * A gate is refused first (`invalid`): it has no Run, so the literal order
 * would always answer `revision_conflict` and never name the gate rule (§4.4).
 * Then: the request names another Run than the selected one (none for P15/P16)
 * → `revision_conflict`; the Run has not ended (P2) or has an unresolved
 * outcome (P3, `runUnresolvedBlocker`, hard limit 1) → `busy`; the chain is
 * invalid → `incomplete`, its head open → `busy` (`finalize_first:`), a clean
 * PASS head on a Run that did not complete → `invalid` (I-12 clause 2); a paused
 * continuation (P18) → `busy`; `ready`/`satisfied` or nothing to rework (P14)
 * → `invalid`; no round yet or a clean PASS head (P11, P13) → `busy`; a
 * non-active disposition → `invalid` (`task_not_active`, C7); an unresolvable
 * basis → `incomplete` (§13.1); a TaskRequeue already covering the Run (P4) →
 * `revision_conflict` (the owner adds `current=[TaskRequeue@1]`).
 */
export function taskRequeueStateProblem(state: TaskState, facts: TaskReworkFacts): Rejected | null {
  if (state.taskKind === 'gate') {
    return reject('illegal', 'invalid', 'a gate is never requeued; its exit is a successor round on its own chain');
  }
  const run = facts.selectedRun;
  if (run === null || !facts.afterRunIsSelected) {
    return reject('stale', 'revision_conflict', 'the requeue names a Run that is not the Task selected Run');
  }
  if (run.status !== 'ended') return reject('guard_failed', 'busy', 'the selected Run has not ended; stop or reconcile it first');
  const blocker = runUnresolvedBlocker(run);
  if (blocker !== null) return reject('guard_failed', 'busy', `reconcile the selected Run first: ${blocker}`);
  if (run.outcome === null || run.outcome === 'outcome_unknown') {
    return reject('guard_failed', 'busy', 'reconcile the selected Run first: its outcome is not known');
  }
  switch (facts.chain.kind) {
    case 'invalid':
      return reject('guard_failed', 'incomplete', `the round chain of the selected Run is invalid (${facts.chain.reason})`);
    case 'head':
      if (facts.chain.head.status === 'open') {
        return reject('guard_failed', 'busy', `finalize_first: round ${facts.chain.head.ref.roundId} of the selected Run is open`);
      }
      // I-12 clause 2: a clean-PASS head on a Run that did not complete (P6
      // today; a completed one is P13, `busy` below) leaves no round to rework.
      if (run.outcome !== 'completed' && !isFinalizedNonPass(facts.chain.head)) {
        return reject('illegal', 'invalid', `round ${facts.chain.head.ref.roundId} of the selected Run is a clean PASS; there is no round to rework`);
      }
      break;
    case 'none':
      break;
    default: return unreachable(facts.chain, 'round chain');
  }
  switch (state.row) {
    case 'P18':
      return reject('guard_failed', 'busy', 'the yielded wait is paused; resume or cancel it first');
    case 'P1':
    case 'P5':
    case 'P14': {
      // S1-TASK-01 / §4.1 step 7: a verified wait-cancel archive of this exact
      // yielded Run is the durable authority to requeue; the ordinary
      // "nothing to requeue" refusal is for requeues without that authority.
      const archivedWait = facts.archive?.kind === 'wait'
        && facts.archive.cause === 'archive_wait_cancel'
        && facts.archive.runRef.projectId === run.ref.projectId
        && facts.archive.runRef.goalId === run.ref.goalId
        && facts.archive.runRef.runId === run.ref.runId;
      if (archivedWait) break;
      return reject('illegal', 'invalid', `the task is ${state.phase}; there is nothing to requeue`);
    }
    case 'P11':
    case 'P13':
    case 'P12':
    case 'P9':
      return reject('guard_failed', 'busy', 'the selected Run is verifying; finalize its round first');
    default:
      break;
  }
  if (state.disposition !== 'active') return reject('guard_failed', 'invalid', `task_not_active: the task disposition is ${state.disposition}`);
  if (!facts.basisResolved) return reject('guard_failed', 'incomplete', 'the effective basis of the task is not resolvable');
  if (state.row === 'P4') return reject('stale', 'revision_conflict', 'a TaskRequeue already covers the selected Run');
  return null;
}

/**
 * G-BUDGET (§4.3 "按类别的依据、预算与上限"): an afterRun that ended
 * `budget_exhausted` is requeued only with a larger token budget or a new input
 * (a human `note` counts as one before it is stored, §13.2 step 6).
 */
export function requeueBudgetIncreased(afterRun: Pick<RunSnapshot, 'outcome' | 'budget'>,
  budget: TaskBudgetV1 | null, newInputCount: number): boolean {
  if (afterRun.outcome !== 'budget_exhausted') return true;
  return newInputCount > 0 || (budget !== null && budget.tokenBudget > afterRun.budget.tokenBudget);
}

/** ND-5/ND-6: whether the requeue key is compared with the earlier keys. */
export function requeueBasisCompared(failureClass: ReworkFailureClass, actorClass: ReworkActorClass): boolean {
  return basisComparisonOf(failureClass, actorClass) === 'compared';
}

/**
 * TASK-16/17 (C1, C2, C8): the requeue machine. State preconditions
 * (`taskRequeueStateProblem`), the Goal `active` (`busy` "resume the Goal
 * first"), then the actor × class matrix with the human-stop fence
 * (`reworkPermission`). The policy steps belong to TASK-28: a request that
 * fails G-BUDGET, G-CAP or G-BASIS is refused here (`illegal`/`invalid`) and
 * must have been submitted as `task_rework_refused`. Accepted: TaskRequeue@1
 * (`newTaskRequeueRecord`) and the projection P4 (`pending/requeued`).
 * TASK-27 (C4) is the same event for a paused-interrupted Run ("继续"): the
 * matrix admits only an operator, or `GOAL_FAN_OUT_ACTOR` with the
 * `goal_resume` trigger the owner checked against the Goal (GOAL-29); the
 * class `interrupted` skips the key, the cap and the budget.
 */
function onTaskRequeued(
  state: TaskMachineState,
  event: Extract<TaskEvent, { kind: 'task_requeued' }>,
  ctx: TaskGuardContext,
): TaskTransition {
  if (state === null) return absentTask(event.kind);
  const facts = ctx.rework;
  if (facts === undefined) return reject('illegal', 'invalid', 'task_requeued requires the rework guard facts');
  const stateProblem = taskRequeueStateProblem(state, facts);
  if (stateProblem !== null) return stateProblem;
  const input = event.requeue;
  if (facts.selectedRun === null || !sameRunRef(facts.selectedRun.ref, input.afterRun.ref)) {
    return reject('illegal', 'invalid', 'the requeue input does not carry the selected Run');
  }
  if (facts.goalDesiredState !== 'active') {
    return reject('guard_failed', 'busy', `the Goal is ${facts.goalDesiredState}; resume the Goal first`);
  }
  const actorClass = reworkActorClassOf(null, input.requestedBy);
  if (actorClass === null) return reject('guard_failed', 'forbidden', 'the requester has no rework actor class');
  const derivation = deriveReworkClass(input.afterRun, input.pointerIntent, input.chain, input.archive ?? null);
  if (derivation.kind !== 'class') return reject('illegal', 'invalid', `the selected Run has nothing to rework (${derivation.row})`);
  const permission = requeuePermission(input.afterRun, input.pointerIntent, derivation, input.requestedBy, actorClass,
    facts.goalDesiredState, { trigger: input.trigger !== null, budget: input.budget !== null });
  if (permission !== null) return permission;
  if (!requeueBudgetIncreased(input.afterRun, input.budget, input.newInputRefs.length)) {
    return reject('illegal', 'invalid', 'budget_not_increased is a TASK-28 policy refusal, not a requeue');
  }
  const automation = nextRequeueAutoCount({ actorClass, failureClass: derivation.failureClass, afterRun: input.afterRun,
    runs: input.runs, requeues: input.requeues, policy: input.policy });
  if (requeueCapExceeded(automation)) {
    return reject('illegal', 'invalid', 'auto_rework_cap_reached is a TASK-28 policy refusal, not a requeue');
  }
  if (requeueBasisCompared(derivation.failureClass, actorClass) && facts.priorBasisDigests.includes(input.basis.digest)) {
    return reject('illegal', 'invalid', 'no_new_basis is a TASK-28 policy refusal, not a requeue');
  }
  const requeue = newTaskRequeueRecord(input);
  return accept({ taskKind: state.taskKind, disposition: state.disposition, row: 'P4', phase: 'pending',
    cause: causeOf('requeued', { requeueRef: { ...requeue.ref } }) }, [{ kind: 'write_task_requeue', requeue }]);
}

/**
 * TASK-28 (C1, C8, ND-8) for a requeue: the same state preconditions, Goal
 * check and actor × class matrix with the human-stop fence as TASK-16/17
 * (the class re-derived from the selected Run and its pointer intent), then
 * the committed policy refusal whose code fits the facts: `budget_not_increased`
 * only after a `budget_exhausted` Run (G-BUDGET), `no_new_basis` only for a
 * compared key equal to an earlier TaskRequeue's (G-BASIS);
 * `auto_rework_cap_reached` (G-CAP) is counted by construction (its record
 * names an automatic actor, the class is not `interrupted`). The phase and
 * cause do not change. A reverify refusal is not this machine's: the round
 * side decides it with its successor (§9 VR-14, `refuse_reverify`, A.2 step
 * 5.9), over the chain head this Task's projection reads.
 */
function onTaskReworkRefused(
  state: TaskMachineState,
  event: Extract<TaskEvent, { kind: 'task_rework_refused' }>,
  ctx: TaskGuardContext,
): TaskTransition {
  if (state === null) return absentTask(event.kind);
  const refusal = event.refusal;
  if (refusal.ref.operation === 'reverify') {
    return reject('illegal', 'invalid', 'a reverify refusal is decided with its successor round (§9 VR-14), not by the Task machine');
  }
  const facts = ctx.rework;
  if (facts === undefined) return reject('illegal', 'invalid', 'task_rework_refused requires the rework guard facts');
  const stateProblem = taskRequeueStateProblem(state, facts);
  if (stateProblem !== null) return stateProblem;
  const run = facts.selectedRun;
  if (run === null || run.ref.runId !== refusal.ref.subjectId || !sameRunRef(run.ref, refusal.afterRunRef)) {
    return reject('illegal', 'invalid', 'the refusal is not keyed by the selected Run');
  }
  if (facts.goalDesiredState !== 'active') {
    return reject('guard_failed', 'busy', `the Goal is ${facts.goalDesiredState}; resume the Goal first`);
  }
  if (!isRunPointerIntent(run, event.pointerIntent)) {
    return reject('illegal', 'invalid', 'the pointer intent is not the selected Run pointer');
  }
  const derivation = deriveReworkClass(run, event.pointerIntent, facts.chain, facts.archive ?? null);
  if (derivation.kind !== 'class') return reject('illegal', 'invalid', `the selected Run has nothing to rework (${derivation.row})`);
  if (derivation.failureClass !== refusal.failureClass) {
    return reject('illegal', 'invalid', `the refusal class ${refusal.failureClass} is not the selected Run's class ${derivation.failureClass}`);
  }
  if (refusal.failureClass === 'interrupted') {
    return reject('illegal', 'invalid', 'class interrupted skips budget, cap and key and is never refused');
  }
  const actorClass = reworkActorClassOf(null, refusal.requestedBy);
  if (actorClass === null) return reject('guard_failed', 'forbidden', 'the requester has no rework actor class');
  const permission = requeuePermission(run, event.pointerIntent, derivation, refusal.requestedBy, actorClass,
    facts.goalDesiredState, { trigger: false, budget: false });
  if (permission !== null) return permission;
  switch (refusal.code) {
    case 'budget_not_increased':
      if (run.outcome !== 'budget_exhausted') {
        return reject('illegal', 'invalid', 'budget_not_increased refuses only the requeue of a budget_exhausted Run');
      }
      break;
    case 'auto_rework_cap_reached':
      // Counted (`nextRequeueAutoCount`): the class is not `interrupted` (above) and the record
      // constructor admits a cap refusal only for an automatic actor class.
      break;
    case 'no_new_basis':
      if (!requeueBasisCompared(derivation.failureClass, actorClass) || refusal.basisDigest === null
        || !facts.priorBasisDigests.includes(refusal.basisDigest)) {
        return reject('illegal', 'invalid', 'no_new_basis refuses only a compared key equal to an earlier TaskRequeue key');
      }
      break;
    case 'source_unchanged':
    case 'verification_uncovered':
      return reject('illegal', 'invalid', `${refusal.code} is a reverify-only refusal`);
    default:
      return unreachable(refusal.code, 'rework refusal code');
  }
  return accept(state, [{ kind: 'write_task_rework_refusal', refusal }]);
}

/**
 * TASK-18 (an untraced Task) and TASK-19 (C7: a traced Task whose disposition
 * alone changes) in W16 order: the gate definition check of the future
 * coverage first (`plan-validation.ts`; a gate's disposition is frozen), then
 * the §3 TASK-19 guards over this Task's facts (`tracedDispositionChangeProblem`:
 * the Goal is not cancelled, then, for a traced Task, every Run ended and none
 * unknown or unreconciled, no unconsumed yielded wait, the Lease released, not
 * satisfied, listed in `reason.affectedTaskIds`, and a human-stopped Task only
 * by a human). So the projections TASK-19 excludes are refused by their facts:
 * `running` (P2) and `blocked/run_outcome_unknown` (P3) and an unconsumed wait
 * (P5, P18) `busy`, `satisfied` (P1) `invalid`. The phase and its cause never
 * change, only the disposition (or a superseded Task's replacement); the
 * change is recorded in the new Plan's `dispositionRecord`.
 */
function onDispositionChanged(
  state: TaskMachineState,
  event: Extract<TaskEvent, { kind: 'disposition_changed' }>,
  ctx: TaskGuardContext,
): TaskTransition {
  if (state === null) return reject('illegal', 'invalid', 'a Task new to the Plan is plan_adopted, not disposition_changed');
  const disposition = ctx.disposition;
  if (disposition === null) return reject('illegal', 'invalid', 'disposition_changed requires the trace facts');
  if (event.to === state.disposition && event.replacedByTaskId === disposition.replacedByTaskId) {
    return reject('illegal', 'invalid', `the disposition is already ${event.to}`);
  }
  if (state.taskKind === 'gate') {
    return reject('guard_failed', 'invalid', `source gate task ${ctx.taskId} changed its definition or acceptance relationships`);
  }
  const problem = tracedDispositionChangeProblem({ goalDesiredState: disposition.goalDesiredState, tasks: [disposition.facts],
    affectedTaskIds: disposition.affectedTaskIds, adopterClass: event.actorClass });
  if (problem !== null) return reject(problem.reason ?? 'guard_failed', problem.code, problem.detail);
  return accept({ ...state, disposition: event.to },
    [{ kind: 'write_plan_revision' }, { kind: 'record_disposition_change' }, { kind: 'move_goal_pointer' }]);
}
