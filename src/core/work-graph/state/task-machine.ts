/**
 * Task machine (docs/refactor/STATE-MACHINES-SPEC.md §4): the projected phase
 * of one Task (`projectTaskPhase`, rows P1..P20, D-1) and the legality of every
 * write that touches it (`transitionTask`, rows TASK-01..30, forbidden §4.4).
 *
 * A Task has no stored phase (D-1). Its phase is a pure projection of the
 * selected Run (with its control pointer), the applicable TaskReduction, the
 * selected Run's round-chain head (`roundTaskSignal`, §9) and the covering
 * TaskRequeue, all read by `readCanonicalTaskFacts` in one window. The writes
 * that touch a Task (claim, completion, disposition change and, from step 5,
 * requeue and its refusal) ask `transitionTask` first. The events other
 * machines judge (Run end, control, round and check events, plan adoption)
 * only re-project: `ok:true`, `effects:[]`, and `next` is the projection of
 * the facts after that event's own commit (SD-1); an event of an older Run
 * leaves the state as is (TASK-20, R5). The machine never reads storage, mints
 * ids or reads a clock: instants and ids come in the event payload.
 *
 * A.2 step 2 (§15.2) scope:
 * - Projection rows keep TODAY's phase (`plan-readers.ts:1145-1154`): every
 *   ended Run that is not a yielded wait projects `blocked`. Step 5.3 flips P6
 *   and P7 to `failed` and P11..P13 to `verifying`; P3 is `blocked` today and
 *   in the target. The TD-1 cause codes are new read-only output and already
 *   follow the target table. The 新增 rows P4 (5.4), P17/P18 (5.3), P19 (5.6)
 *   and P20 (5.9) are not evaluated yet: their facts fall through to the row
 *   today's fold reaches.
 * - 已有 rows keep today's codes in today's order (`claim-service.ts:510-666`,
 *   pre-step-3 `completion.ts:316-395`, `plan-service.ts:1737-1767`,
 *   `plan-readers.ts:1269-1297`).
 * - 改造 rows keep today's result; step 5 flips them: TASK-03 (the claim
 *   service does not read `requeueRef`, so a requeue claim follows the
 *   first-claim rule: `busy` once the Task has a Run), TASK-14/15 (no
 *   projection, chain-head or TD-2 evidence guard; a gate completes from
 *   `pending`), TASK-18 (no `dispositionRecord`), and TASK-05/06/09/10/11/13
 *   through their projection rows.
 * - 新增 rows (TASK-07, 08, 12, 16, 17, 21..23, 26..30) keep their events in
 *   the union and answer `illegal` (`notYet`). TASK-19 is answered by today's
 *   §4.4 refusal in front of it: a traced Task's definition, disposition
 *   included, is frozen (`revision_conflict`).
 *
 * Pure: imports only `src/contracts` and this directory (§14.4).
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type { ControlIntentKindV1, ControlIntentRef } from '../../../contracts/control-intent.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import type { TaskClaim } from '../../../contracts/core/task-claim.js';
import type { DelegatedWriteProvenanceV1 } from '../../../contracts/delegated-write.js';
import type { RunRef, RunSnapshot, TaskBudgetV1, TaskTriple } from '../../../contracts/dispatch.js';
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
import type { TaskPhaseCauseCode, TaskPhaseCauseDetailV1, TaskPhaseCauseV1 } from '../../../contracts/task-failure.js';
import {
  GOAL_FAN_OUT_ACTOR, MAX_AUTO_REWORK_LIMIT, TASK_REWORK_REASON_MAX_CHARS, reworkActorClassOf,
  type ReworkActorClass, type ReworkFailureClass, type TaskAutomationPolicyV1, type TaskRequeueBasisComparison,
  type TaskRequeueHistorySourceV1, type TaskRequeueRef, type TaskRequeueSnapshotV1, type TaskRequeueTriggerV1,
  type TaskReworkRefusalSnapshotV1,
} from '../../../contracts/task-requeue.js';
import type { RoundSnapshot, VerificationRoundRef } from '../../../contracts/verification.js';
import { claimBasisToday, type AttemptClaimBasis } from './attempt-machine.js';
import { runFailureOrigin } from './no-progress.js';
import { isPausedInterrupted, type RunClaimContext } from './run-machine.js';
import {
  deriveReworkClass, nextRequeueAutoCount, reworkFenceOf, reworkPermission,
  type ReworkClassDerivationV1, type StopIntentV1,
} from './task-failure.js';
import { accept, failed, notYet, reject, rejected, unreachable, type Rejected, type Transition } from './transition.js';
import { chainEvidenceIds, type RoundChainHeadV1, type RoundTaskSignalV1 } from './verification-machine.js';

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
  const predecessor = signal.head.chain?.predecessorRoundRef ?? null;
  return predecessor === null ? { ordinal: signal.ordinal } : { ordinal: signal.ordinal, predecessorRoundRef: predecessor };
}

/**
 * The first matching row of §4.1 in table order (P1, P20, P2, P3, P4, P17,
 * P18, P19, P5, P6, P10, P7, P8, P9, P11, P12, P13, P14, P15, P16).
 */
export function classifyTaskPhase(facts: TaskPhaseFacts): TaskPhaseProjection {
  if (facts.applicableReduction !== null) return projection('P1', facts.applicableReduction.phase, null);
  // P20 (gate chain head, C5) is step 5.9: today a gate's rounds never enter
  // its projection, and a gate has no Run, so it falls to P15/P16.
  const run = facts.selectedRun;
  if (run === null) {
    return facts.originUnresolvable
      ? projection('P15', 'blocked', causeOf('origin_unresolvable'))
      : projection('P16', 'pending', null);
  }
  if (run.status === 'starting' || run.status === 'running') return projection('P2', 'running', null);
  return endedRunProjection(run, facts.round);
}

function endedRunProjection(run: RunSnapshot, round: RoundTaskSignalV1): TaskPhaseProjection {
  const outcome = run.outcome;
  // An ended Run without an outcome is damaged (`runCombinationProblem`);
  // like P14 it is defended as `blocked`, today's fold.
  if (outcome === null) return projection('P14', 'blocked', causeOf('run_failed'));
  switch (outcome) {
    case 'outcome_unknown': return projection('P3', 'blocked', causeOf('run_outcome_unknown'));
    // P4 (requeued, C1) is step 5.4, P17/P18 (a stop pointer on a yielded wait,
    // TD-5) step 5.3 and P19 (paused-interrupted, C4) step 5.6: until then their
    // facts reach P5 or P6 below, as in today's fold.
    case 'yielded':
      return run.continuation !== undefined
        ? projection('P5', 'ready', null)
        : projection('P14', 'blocked', causeOf('run_failed'));
    case 'crashed':
    case 'cancelled':
    case 'budget_exhausted':
    case 'failed':
      // Step 5.3: `failed`.
      return projection('P6', 'blocked', causeOf('run_failed', { outcome, origin: runFailureOrigin(run) }));
    case 'completed': return completedRunProjection(round);
    default: return unreachable(outcome, 'Run outcome');
  }
}

/** P10, P7, P8, P9, P11, P12, P13 over the selected Run's chain head. */
function completedRunProjection(round: RoundTaskSignalV1): TaskPhaseProjection {
  switch (round.kind) {
    case 'invalid': return projection('P10', 'blocked', causeOf('round_ambiguous'));
    case 'fail':
      // Step 5.3: `failed` (D-2).
      return projection('P7', 'blocked', causeOf('check_failed', { ...successorDetail(round), checkIds: round.failedCheckIds }));
    case 'inconclusive':
      return projection('P8', 'blocked', causeOf('round_inconclusive', { ...successorDetail(round), gapCodes: round.gapCodes }));
    case 'open':
      // Monotonic within a round (brief §2a): interrupted checks block only
      // once no check is pending or executing.
      if (!round.unsettled && round.interruptedCheckIds.length > 0) {
        return projection('P9', 'blocked', causeOf('check_interrupted', successorDetail(round)));
      }
      // Step 5.3: `verifying`.
      return projection('P12', 'blocked', causeOf('verification_running', {
        ...successorDetail(round),
        ...(round.interruptedCheckIds.length === 0 ? {} : { checkIds: round.interruptedCheckIds }),
      }));
    // Step 5.3: `verifying`.
    case 'none': return projection('P11', 'blocked', causeOf('awaiting_verification'));
    // Step 5.3: `verifying` (P1 already took an applicable reduction).
    case 'pass': return projection('P13', 'blocked', causeOf('awaiting_completion', successorDetail(round)));
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
  /** The continuation prior Run, as RUN-01 reads it (`:590-638`); null when it is not a Run of this Task. */
  prior: RunClaimContext['prior'];
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
};

/** The first trace today's future-change reader finds: Run, then Lease, then Reduction (`plan-readers.ts:1269-1297`). */
export type TaskTrace = 'none' | 'run' | 'lease' | 'reduction';

export type TaskGuardContext = {
  /** The Task id, for refusal texts. */
  taskId: string;
  /** `task_claimed` only. */
  claim: TaskClaimFacts | null;
  /** `task_completed` only. */
  completion: TaskCompletionFacts | null;
  /** `disposition_changed` only. */
  trace: TaskTrace | null;
};

/** §9 events that reach a Task only through its round-chain head. */
export type TaskRoundEventKind = 'round_opened' | 'check_begun' | 'check_result_recorded' | 'check_interrupted'
  | 'check_abandoned' | 'check_report_booked' | 'evidence_submitted';

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
  /** TASK-28 (step 5.4/5.9): the refusal record `newTaskReworkRefusalRecord` built. */
  | { kind: 'task_rework_refused'; refusal: TaskReworkRefusalSnapshotV1 }
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
  /** TASK-19 (C7): `PlanRevisionSnapshot.dispositionRecord` (step 5.10). */
  | { kind: 'record_disposition_change' }
  | { kind: 'move_goal_pointer' };

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
 * class and the actor class (ND-5, ND-6). `basis` is `noProgressKey`
 * (`no-progress.ts`) over the source the owner captured.
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
  requeues: readonly Pick<TaskRequeueSnapshotV1, 'ref' | 'automation'>[];
  policy: Pick<TaskAutomationPolicyV1, 'autoReworkLimit'>;
  historySource: TaskRequeueHistorySourceV1 | null;
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

/** The facts the record reads belong to the requeued Task and its afterRun. */
function taskRequeueSubjectProblem(input: NewTaskRequeueInput): string | null {
  const { afterRun, chain } = input;
  if (!sameTask(afterRun.task, input.task)) return 'the afterRun belongs to another task';
  if (chain.kind === 'head'
    && (chain.head.subjectRunRef.runId !== afterRun.ref.runId || !sameTask(chain.head.subject, input.task))) {
    return 'the round chain is not the afterRun chain';
  }
  const pointerRef = afterRun.controlState?.intentRef ?? null;
  if (input.pointerIntent === null ? pointerRef !== null
    : pointerRef === null || !sameIntentRef(input.pointerIntent.ref, pointerRef)) {
    return 'the pointer intent is not the afterRun pointer';
  }
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
      if (head.outcome === 'PASS' && head.gaps.length === 0) {
        return `the round chain head ${head.ref.roundId} is a clean PASS; there is no round to rework`;
      }
      return null;
    }
    default: return unreachable(chain, 'round chain');
  }
}

/**
 * §11 I-12 clause 10 (LA-1), the part the input shows: an afterRun that never
 * entered the Kernel (no `executionHistory`) and has no `requeueRef` has no
 * history to seed. Whether a non-null source names the claim Session, or
 * copies the `requeueRef` record's source, is the owner's same-window read.
 */
function taskRequeueHistoryProblem(input: NewTaskRequeueInput): string | null {
  const afterRun = input.afterRun;
  if (input.historySource !== null && afterRun.executionHistory === undefined && afterRun.requeueRef === undefined) {
    return `run ${afterRun.ref.runId} never entered the Kernel and has no requeueRef, so it has no history source`;
  }
  return null;
}

/**
 * §11 I-12 clauses 2, 3, 6, 8 and 10 (and I-17) as far as the input shows
 * them: the legal (class, actor, request) combinations. The owner refuses
 * every other one first with a 0-commit CoreError (TASK-16/17/27, §4.4), so a
 * problem here is a caller bug.
 * - the chain is valid, its head finalized and not a clean PASS (clause 2;
 *   FC-13: finalize first);
 * - no history source without Kernel entry or `requeueRef` (clause 10);
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
  const historyProblem = taskRequeueHistoryProblem(input);
  if (historyProblem !== null) return historyProblem;
  if (input.basis.failure.outcome !== afterRun.outcome) return 'the no-progress key was computed for another outcome';
  if ((input.agentProvenance !== null) !== (actorClass === 'agent')) {
    return 'agent provenance is recorded exactly for an agent requeue';
  }
  const goalFanOut = input.requestedBy.kind === GOAL_FAN_OUT_ACTOR.kind && input.requestedBy.id === GOAL_FAN_OUT_ACTOR.id;
  const refusal = reworkPermission({ operation: 'requeue', goalDesiredState: 'active',
    failureClass: derivation.failureClass, interruption: derivation.interruption,
    fence: reworkFenceOf(afterRun, input.pointerIntent), actorClass, goalFanOut,
    trigger: input.trigger !== null, budget: input.budget !== null, note: false });
  if (refusal !== null && !refusal.ok) return refusal.detail;
  const trigger = input.trigger;
  if (trigger !== null) {
    if (trigger.goalRef.projectId !== input.task.projectId || trigger.goalRef.goalId !== input.task.goalId) {
      return 'the goal_resume trigger names another Goal';
    }
    if (!(trigger.pausedEpoch < trigger.resumedEpoch)) return 'the goal_resume trigger pause is not before its resume';
  }
  if (afterRun.outcome === 'budget_exhausted' && input.newInputRefs.length === 0
    && !(input.budget !== null && input.budget.tokenBudget > afterRun.budget.tokenBudget)) {
    return 'a budget_exhausted requeue needs a larger token budget or a new input (budget_not_increased)';
  }
  return null;
}

function requeueCannotBeBuilt(problem: string): never {
  throw new Error(`a TaskRequeue cannot be built: ${problem}`);
}

/**
 * TASK-16/17/27: TaskRequeue@1, written once with CAS null (L-3), in contract
 * key order. It refuses every §11 I-12 combination the input can show: the
 * afterRun derives a rework class (FC-3, 6..10, 15, 16; FC-13 only after its
 * head is finalized), its chain is none or valid with a finalized head that is
 * not a clean PASS, the actor may rework it, a counted automatic requeue stays
 * within the cap (G-CAP), and a Run without Kernel entry or `requeueRef` has
 * no history source. An afterRun with nothing to rework or that is not
 * reworkable has no record. The covered evidence is the afterRun's whole
 * chain, `[]` without a round. Two I-12 clauses stay with the owner's read
 * window because the input does not carry their facts: clause 5 (a `compared`
 * key differs from every earlier requeue's digest, G-BASIS → TASK-28) and
 * clause 10's claim Session and one-hop copy of the `requeueRef` record's
 * `historySource`.
 */
export function newTaskRequeueRecord(input: NewTaskRequeueInput): TaskRequeueSnapshotV1 {
  const subjectProblem = taskRequeueSubjectProblem(input);
  if (subjectProblem !== null) return requeueCannotBeBuilt(subjectProblem);
  const actorClass = reworkActorClassOf(null, input.requestedBy);
  if (actorClass === null) return requeueCannotBeBuilt('the requester has no rework actor class');
  const { afterRun, chain } = input;
  const derivation = deriveReworkClass(afterRun, input.pointerIntent, chain);
  const afterOutcome = afterRun.outcome;
  if (derivation.kind !== 'class' || afterOutcome === null || afterOutcome === 'outcome_unknown') {
    return requeueCannotBeBuilt(`run ${afterRun.ref.runId} has no rework class (${derivation.row})`);
  }
  const combinationProblem = taskRequeueCombinationProblem(input, actorClass, derivation);
  if (combinationProblem !== null) return requeueCannotBeBuilt(combinationProblem);
  const head = chain.kind === 'head' ? chain.head : null;
  const automation = nextRequeueAutoCount({ actorClass, failureClass: derivation.failureClass,
    afterRun, runs: input.runs, requeues: input.requeues, policy: input.policy });
  if (automation.counted && automation.cap !== null && automation.autoCount > automation.cap) {
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
    historySource: input.historySource,
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

/** §6 `YieldedWait`: ended, yielded, with its continuation. */
function isYieldedWait(run: RunSnapshot): boolean {
  return run.status === 'ended' && run.outcome === 'yielded' && run.continuation !== undefined;
}

/** The pointer that holds a yielded wait (`claim-service.ts:606-611`, TD-5). */
function hasStopPointer(run: RunSnapshot): boolean {
  const pointer = run.controlState?.desiredState;
  return pointer === 'paused' || pointer === 'cancelled';
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
    case 'check_report_booked':
    case 'evidence_submitted':
    case 'round_finalized':
    case 'round_reverified':
      return onRoundEvent(state, event);
    case 'task_completed': return onTaskCompleted(state, event, ctx);
    // D-3/C1 requeue and continue (TASK-16, 17, 27) are step 5.4/5.6; the policy
    // refusal (TASK-28) lands with them (5.4) and with reverify (5.9).
    case 'task_requeued': return notYet('TASK-16/17/27');
    case 'task_rework_refused': return notYet('TASK-28');
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
 * `claim-service.ts:510-666` order; `null` when the claim may commit. It needs
 * no claim ids: `transitionTask` applies it to `task_claimed`, and the claim
 * service also asks it after each read (a fact not read yet holds), so a
 * refused guard stops the claim's reads where they always stopped.
 */
export function taskClaimProblem(
  task: TaskClaimSubject | null,
  claimBasis: AttemptClaimBasis,
  facts: TaskClaimFacts,
): Rejected | null {
  if (facts.goalDesiredState !== 'active') return reject('guard_failed', 'busy', 'the Goal is not active');
  if (!facts.activePlanMatchesClaim) return reject('stale', 'revision_conflict', 'the requested Plan is not the Goal current pin');
  if (facts.sessionProblem !== null) return rejected(facts.sessionProblem);
  if (task === null) return reject('illegal', 'not_found', 'the Task is not part of the accepted Plan');
  if (task.taskKind !== 'work') return reject('illegal', 'invalid', 'only a work task can be claimed');
  if (task.disposition !== 'active') return reject('guard_failed', 'invalid', 'the Task disposition is not active');
  if (facts.structuralProblem !== null) return rejected(facts.structuralProblem);
  const phaseProblem = claimPhaseProblem(task.phase);
  if (phaseProblem !== null) return phaseProblem;
  if (facts.lease.status === 'leased') {
    return reject('guard_failed', 'busy', `task already has an active lease (holder run ${facts.lease.holderRunId})`);
  }
  // TASK-03 (D-3, TD-3) is step 5.4: today the claim service accepts a
  // `requeueRef` but never reads it (`claim-service.ts:639-641`), so a requeue
  // claim is a first claim: `busy` once the Task has a Run, otherwise a @1 lease.
  const basis = claimBasisToday(claimBasis);
  switch (basis.kind) {
    case 'first':
      if (facts.taskHasRun) return reject('guard_failed', 'busy', 'this Task already has a Run and cannot be claimed for the first time');
      break;
    case 'continuation': {
      const prior = facts.prior;
      if (prior === null) return reject('guard_failed', 'busy', 'the continuation prior Run is not a Run of this Task');
      if (prior.node !== 'YieldedWait') {
        return reject('guard_failed', 'busy', 'the continuation prior Run did not yield with a formal continuation');
      }
      if (prior.bindingProblem !== null) return rejected(prior.bindingProblem);
      // A queued wait-window pause/cancel survives the yield and holds the continuation.
      if (prior.pointer === 'paused' || prior.pointer === 'cancelled') {
        return reject('guard_failed', 'busy', `the prior yielded Run has a queued ${prior.pointer} control; the continuation is held`);
      }
      if (!prior.leaseReleasedByPrior) return reject('guard_failed', 'busy', 'the continuation prior Run lease is not released by that Run');
      if (prior.replyProblem !== null) return rejected(prior.replyProblem);
      break;
    }
    default: return unreachable(basis, 'claim basis');
  }
  if (facts.admission !== null) return rejected(facts.admission);
  return null;
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
  const basis = claimBasisToday(event.basis);
  const claim = event.claim;
  return accept({ taskKind, disposition, row: 'P2', phase: 'running', cause: null }, [
    { kind: 'create_attempt' },
    { kind: 'create_run' },
    { kind: 'create_outbox' },
    { kind: 'hold_lease', lease: basis.kind === 'continuation' ? 'reheld' : 'first' },
    { kind: 'occupy_session', sessionRef: claim.sessionRef, generation: claim.generation },
  ]);
}

/** TASK-04..08, 20, 21, 26. */
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
  switch (outcome) {
    // D-4: today an unknown end is never written (§6 RUN-08 is step 5).
    case 'outcome_unknown': return notYet('TASK-07');
    case 'yielded':
      if (run.continuation !== undefined && hasStopPointer(run)) return notYet('TASK-21');
      break;
    case 'crashed':
      if (isPausedInterrupted(run)) return notYet('TASK-26');
      break;
    case 'completed':
    case 'cancelled':
    case 'budget_exhausted':
    case 'failed':
      break;
    default: return unreachable(outcome, 'Run outcome');
  }
  // TASK-08 (D-4): late evidence or an attestation resolves the unknown outcome.
  if (state.row === 'P3') return notYet('TASK-08');
  return reprojected(state, event.facts);
}

/** TASK-22/23: a stop or resume on the selected `YieldedWait` (TD-5); any other control only re-projects. */
function onControlSubmitted(state: TaskMachineState, event: Extract<TaskEvent, { kind: 'control_submitted' }>): TaskTransition {
  if (state === null) return absentTask(event.kind);
  const kindProblem = factsKindProblem(state, event.facts);
  if (kindProblem !== null) return kindProblem;
  const run = event.facts.selectedRun;
  if (run === null || !sameRunRef(run.ref, event.runRef)) return accept(state);
  if (isYieldedWait(run)) {
    const control = event.control;
    switch (control) {
      case 'pause': return notYet('TASK-22');
      case 'cancel': return notYet(state.row === 'P18' ? 'TASK-23' : 'TASK-22');
      case 'resume': return notYet('TASK-23');
      case 'steer': break;
      default: return unreachable(control, 'control kind');
    }
  }
  return reprojected(state, event.facts);
}

type RoundTaskEvent = Extract<TaskEvent, { kind: TaskRoundEventKind | 'round_finalized' | 'round_reverified' }>;

/** TASK-09..13, 20, 29, 30 and the §4.4 interrupted-PASS row. */
function onRoundEvent(state: TaskMachineState, event: RoundTaskEvent): TaskTransition {
  if (state === null) return absentTask(event.kind);
  const kindProblem = factsKindProblem(state, event.facts);
  if (kindProblem !== null) return kindProblem;
  if (state.taskKind === 'gate') {
    // TASK-30 (C5) is step 5.9: today a gate's rounds never enter its projection.
    if (event.kind !== 'evidence_submitted') return notYet('TASK-30');
    return reprojected(state, event.facts);
  }
  // TASK-29 (C5, §9 VR-14) is step 5.9.
  if (event.kind === 'round_reverified') return notYet('TASK-29');
  const run = event.facts.selectedRun;
  // TASK-20 (R5): a round of an older Run is history only.
  if (run === null || !sameRunRef(run.ref, event.subjectRunRef)) return accept(state);
  if (event.kind === 'round_finalized' && state.row === 'P9' && event.outcome === 'PASS' && event.gapCodes.length === 0) {
    return reject('illegal', 'invalid', 'an interrupted check is a gap, so the round cannot finalize as a clean PASS (§9 VD-4)');
  }
  // TASK-12 (D-12): the last pending/executing check settles with an interrupted one left.
  if (state.row !== 'P9' && classifyTaskPhase(event.facts).row === 'P9') return notYet('TASK-12');
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
  if (round.gaps.length > 0) return incomplete('the specified round carries unresolved gaps');
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
 * TASK-14 (work), TASK-15 (gate), TASK-24 (already satisfied, new identity).
 * Today the round and the fold decide; the projection, chain-head and TD-2
 * evidence-exclusion guards are step 5.3/5.4/5.9, and so are the §4.4
 * `failed`/`blocked`/`running` refusals.
 */
function onTaskCompleted(
  state: TaskMachineState,
  event: Extract<TaskEvent, { kind: 'task_completed' }>,
  ctx: TaskGuardContext,
): TaskTransition {
  if (state === null) return reject('illegal', 'incomplete', 'the selected Plan does not define the requested task');
  const facts = ctx.completion;
  if (facts === null) return reject('illegal', 'invalid', 'task_completed requires the completion guard facts');
  const problem = taskCompletionRoundProblem({ task: event.task, taskKind: state.taskKind, round: event.round,
    producerRun: facts.producerRun, producerTaskKind: facts.producerTaskKind })
    ?? taskCompletionFoldProblem(event.task.taskId, facts.evaluation);
  if (problem !== null) return rejected(problem);
  const evaluation = facts.evaluation;
  const reduction = newTaskReductionRecord({ ...event.reduction, round: event.round, evaluation });
  return accept({ taskKind: state.taskKind, disposition: state.disposition, row: 'P1', phase: reduction.phase, cause: null },
    [{ kind: 'write_task_reduction', reduction }]);
}

/**
 * TASK-18 (an untraced Task) in W16 order: the gate definition check of the
 * future coverage (`plan-validation.ts:423-433`) before the trace read
 * (`plan-readers.ts:1269-1297`). TASK-19 (C7, step 5.10) is not open yet:
 * today a traced Task's disposition belongs to its frozen definition.
 */
function onDispositionChanged(
  state: TaskMachineState,
  event: Extract<TaskEvent, { kind: 'disposition_changed' }>,
  ctx: TaskGuardContext,
): TaskTransition {
  if (state === null) return reject('illegal', 'invalid', 'a Task new to the Plan is plan_adopted, not disposition_changed');
  const trace = ctx.trace;
  if (trace === null) return reject('illegal', 'invalid', 'disposition_changed requires the trace facts');
  if (event.to === state.disposition) return reject('illegal', 'invalid', `the disposition is already ${event.to}`);
  if (state.taskKind === 'gate') {
    return reject('guard_failed', 'invalid', `source gate task ${ctx.taskId} changed its definition or acceptance relationships`);
  }
  switch (trace) {
    case 'none': break;
    case 'run':
      return reject('guard_failed', 'revision_conflict', `task ${ctx.taskId} already has a Run and is no longer a future task`);
    case 'lease':
      return reject('guard_failed', 'revision_conflict', `task ${ctx.taskId} already holds a TaskLease and is no longer a future task`);
    case 'reduction':
      return reject('guard_failed', 'revision_conflict', `task ${ctx.taskId} already has a formal reduction and is no longer a future task`);
    default: return unreachable(trace, 'Task trace');
  }
  return accept({ ...state, disposition: event.to }, [{ kind: 'write_plan_revision' }, { kind: 'move_goal_pointer' }]);
}
