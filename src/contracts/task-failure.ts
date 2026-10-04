/**
 * Task read-model contracts produced by `core/work-graph/state/` (spec §4 D-1,
 * TD-1, TD-8, TD-9; decisions C1, C4, C5, C8).
 *
 * Nothing here is stored: the projection cause comes from `projectTaskPhase`
 * (`state/task-machine.ts`) and the failure facts from `buildTaskFailureFacts`
 * (`state/task-failure.ts`). They live in contracts because `state/` imports
 * only contracts, and Workflow, Goal display and the UI read the same shapes.
 */
import type { ActorRef } from './command-event.js';
import type { ArtifactRef } from './artifact.js';
import type { SessionRef } from './core/identity.js';
import type { ControlIntentRef, ControlIntentRequestV1 } from './control-intent.js';
import type { SourceChangeVerdictV1 } from './continuation-brief.js';
import type { RunOutcome, RunRef, TaskAttemptRef, TaskBudgetV1 } from './dispatch.js';
import type { EvidenceOutcome } from './evidence.js';
import type { NoProgressCheckFactV1, RunFailureOrigin, SourceStampV1 } from './no-progress.js';
import type {
  ReworkActorClass, ReworkFailureClass, StopRequester, TaskRequeueRef, TaskReworkOperation,
  TaskReworkRefusalCode, TaskReworkRefusalRef,
} from './task-requeue.js';
import type { RoundSnapshot, VerificationRoundRef } from './verification.js';

// ------------------------------------------------------------------------ //
// Projection cause (TD-1)                                                   //
// ------------------------------------------------------------------------ //
/** Display-only projection reason; never replaces `TaskReductionCauseCode`. */
export type TaskPhaseCauseCode =
  | 'requeued'
  | 'run_outcome_unknown'
  | 'run_failed'
  | 'check_failed'
  | 'round_inconclusive'
  | 'check_interrupted'
  | 'round_ambiguous'
  | 'awaiting_verification'
  | 'verification_running'
  | 'awaiting_completion'
  | 'origin_unresolvable'
  | 'continuation_cancelled'
  | 'continuation_paused'
  | 'paused_interrupted';
/** Row-specific detail; every member is optional and present only where its row says so. */
export type TaskPhaseCauseDetailV1 = {
  /** Chain position of the head the row read (C5); present when the head is a successor round. */
  ordinal?: number;
  predecessorRoundRef?: VerificationRoundRef;
  /** P20: the cause comes from the gate's own chain head. */
  gate?: true;
  /** P4 */
  requeueRef?: TaskRequeueRef;
  /** P6 */
  outcome?: RunOutcome;
  origin?: RunFailureOrigin;
  /** P7 failed checks; P12 interrupted checks. */
  checkIds?: string[];
  /** P8 */
  gapCodes?: string[];
  /** P19 */
  afterRunRef?: RunRef;
  pausedIntentRef?: ControlIntentRef;
  kernelPaused?: boolean;
};
export type TaskPhaseCauseV1 = { code: TaskPhaseCauseCode; detail?: TaskPhaseCauseDetailV1 };

// ------------------------------------------------------------------------ //
// Failure facts (TaskRow.failure) and rework summary (TaskRow.rework)       //
// ------------------------------------------------------------------------ //
/** One non-PASS check of a chain head, with its report (the read-model form of the key fact). */
export type FailingCheckFactV1 = NoProgressCheckFactV1 & { reportRef: ArtifactRef | null };
/** Why a Task cannot be reworked now; `round_chain_limit` only blocks another successor round. */
export type NotReworkableCause =
  | 'run_outcome_unknown'
  | 'continuation_paused'
  | 'round_ambiguous'
  | 'origin_unresolvable'
  | 'round_chain_limit';
/** Where `run.error` was read from, in this order (§6.1 contract (f)). */
export type RunErrorSource = 'terminal_payload' | 'reconciliation_event' | 'kernel_run_failed' | 'not_recorded';
/** The nine automation stop reasons; also the Goal NEEDS_DECISION cause codes (§2 GOAL-30). */
export type TaskAutomationStopReason =
  | 'unknown_outcome'
  | 'auto_rework_cap_reached'
  | 'no_new_basis'
  | 'gate_needs_fix'
  | 'verification_uncovered'
  | 'budget_exhausted'
  | 'task_cancelled'
  | 'task_paused'
  | 'not_reworkable';
export const TASK_AUTOMATION_STOP_REASONS: readonly TaskAutomationStopReason[] = Object.freeze([
  'unknown_outcome', 'auto_rework_cap_reached', 'no_new_basis', 'gate_needs_fix', 'verification_uncovered',
  'budget_exhausted', 'task_cancelled', 'task_paused', 'not_reworkable',
]);
export type TaskAutomationStopDetailV1 = {
  operation?: TaskReworkOperation;
  /** `not_reworkable` only. */
  cause?: NotReworkableCause;
  fence?: 'human_pause' | 'human_cancel';
  pausedBy?: StopRequester;
  failingChecks?: FailingCheckFactV1[];
  /** `budget_exhausted` only: a requeue budget must exceed this token budget. */
  minTokenBudgetExclusive?: number;
};
/**
 * Whether the owner would accept one automatic rework now (AV/GV tables). It is
 * an admissibility fact, not a command: Workflow still decides order, Session,
 * budget and whether to act.
 */
export type TaskAutomationVerdictV1 =
  | { kind: 'none' }
  | { kind: 'requeue'; failureClass: ReworkFailureClass; retryAfterRefusal: boolean }
  | { kind: 'reverify'; roundRef: VerificationRoundRef; needsFinalize: boolean; onlyIfSourceChanged: boolean;
      failureClass: ReworkFailureClass; retryAfterRefusal: boolean }
  | { kind: 'claim_requeued'; requeueRef: TaskRequeueRef; budget: TaskBudgetV1 | null }
  | { kind: 'stopped'; reason: TaskAutomationStopReason; detail: TaskAutomationStopDetailV1 };
/** The latest refusal under one refusal key, with its staleness judged at read time. */
export type TaskReworkRefusalFactV1 = {
  ref: TaskReworkRefusalRef;
  revision: number;
  code: TaskReworkRefusalCode;
  reason: string;
  requestedBy: ActorRef;
  refusedAt: string;
  stale: boolean;
};
/**
 * C1 structured "why did it fail". `run*` fields are null without a selected Run
 * (P15); a gate's `run*` fields are its chain's anchored producer Run.
 */
export type TaskFailureFactsV1 = {
  subjectKind: 'work' | 'gate';
  runRef: RunRef | null;
  runRevision: number | null;
  attemptRef: TaskAttemptRef | null;
  /** `run.executionHistory?.sessionRef`; null when the Run never entered the Kernel. */
  sessionRef: SessionRef | null;
  /** At most one of these two is non-null, except `round_chain_limit` (see NotReworkableCause). */
  failureClass: ReworkFailureClass | null;
  notReworkableCause: NotReworkableCause | null;
  run: {
    outcome: RunOutcome;
    endedAt: string | null;
    budget: TaskBudgetV1;
    origin: RunFailureOrigin;
    error: string | null;
    errorSource: RunErrorSource;
  } | null;
  interruption: {
    kind: 'executing' | 'paused';
    kernelPaused: boolean;
    pausedIntentRef: ControlIntentRef | null;
    pausedBy: StopRequester | null;
  } | null;
  /** The selected Run's pause/cancel pointer intent (immutable request fields). */
  stop: {
    intentRef: ControlIntentRef;
    kind: 'pause' | 'cancel';
    requestedBy: ControlIntentRequestV1['requestedBy'];
    requester: StopRequester;
  } | null;
  /** The chain head. */
  round: {
    roundRef: VerificationRoundRef;
    status: RoundSnapshot['status'];
    outcome: EvidenceOutcome | null;
    failingChecks: FailingCheckFactV1[];
    gapCodes: string[];
    sourceDigest: string;
    workspaceRevision: number;
    ordinal: number;
    autoCount: number;
  } | null;
  source: {
    /** The head's identity stamp; null for a Run-level failure without a round. */
    atFailure: SourceStampV1 | null;
    /** The latest source captured by a refusal. */
    lastChecked: SourceStampV1 | null;
    sinceFailure: SourceChangeVerdictV1;
  };
  /** Classes that may requeue / reverify now (state, Goal `active`, matrix and fence). */
  requeueActors: ReworkActorClass[];
  reverifyActors: ReworkActorClass[];
  automation: {
    cap: number;
    requeueAutoCount: number;
    coveringRequeue: TaskRequeueRef | null;
    lastRefusal: TaskReworkRefusalFactV1 | null;
    lastReverifyRefusal: TaskReworkRefusalFactV1 | null;
    verdict: TaskAutomationVerdictV1;
  };
};
export type TaskReworkSummaryEntryV1 = {
  ref: TaskRequeueRef;
  afterRunRef: RunRef;
  failureClass: ReworkFailureClass;
  requestedBy: ActorRef;
  automatic: boolean;
  autoCount: number;
  reason: string;
  requestedAt: string;
};
/** Requeue history in Run-chain order; successor rounds are read from `chain.reverify`. */
export type TaskReworkSummaryV1 = {
  entries: TaskReworkSummaryEntryV1[];
  requeueAutoCount: number;
  cap: number;
};
