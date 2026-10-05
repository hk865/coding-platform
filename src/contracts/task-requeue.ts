/**
 * Task rework facts (spec §4 D-3, TD-6, TD-8, TD-9; decisions C1, C2, C4, C8).
 *
 * `TaskRequeue` is the immutable fact that lets a Task open a new Attempt after
 * its selected Run ended; `TaskReworkRefusal` is the versioned record of the
 * policy refusals shared by requeue and reverify. Both are written only through
 * the `core/work-graph/state/` constructors (§14). The derivations that need
 * more than a principal (`deriveReworkClass`, `stopRequesterOf`,
 * `reworkFenceOf`) live in `state/task-failure.ts`; this file holds the shapes,
 * the closed list of platform automation actors and the actor classification.
 */
import type { ActorRef } from './command-event.js';
import type { CorePrincipal } from './core/call-context.js';
import type { SessionRef } from './core/identity.js';
import type { ControlIntentRef } from './control-intent.js';
import type { DelegatedWriteProvenanceV1 } from './delegated-write.js';
import type { RunOutcome, RunRef, TaskAttemptRef, TaskBudgetV1, TaskTriple } from './dispatch.js';
import type { GoalRef } from './ledger.js';
import type { NewBasisInputRefV1, NoProgressKeyV1, SourceStampV1 } from './no-progress.js';
import type { PlanRevisionRef } from './plan.js';
import type { VerificationRoundRef } from './verification.js';

// ------------------------------------------------------------------------ //
// Vocabulary                                                                //
// ------------------------------------------------------------------------ //
/** Platform-derived failure class of a requeue or reverify (C2); callers never set it. */
export type ReworkFailureClass = 'interrupted' | 'cancelled' | 'check_failed' | 'run_failed' | 'check_incomplete';
export const REWORK_FAILURE_CLASSES: readonly ReworkFailureClass[] = Object.freeze([
  'interrupted', 'cancelled', 'check_failed', 'run_failed', 'check_incomplete',
]);
/** Who performs a rework operation (C1). Only `reworkActorClassOf` derives it. */
export type ReworkActorClass = 'human' | 'system' | 'agent';
/** Who stopped a Run through its pause/cancel pointer; `none` without a pointer. */
export type StopRequester = 'human' | 'goal_fan_out' | 'system' | 'none';
/** The two rework operations; also the `TaskReworkRefusalRef.operation` key part. */
export type TaskReworkOperation = 'requeue' | 'reverify';

// ------------------------------------------------------------------------ //
// Platform automation actors (closed list)                                  //
// ------------------------------------------------------------------------ //
type HostActorRef = Extract<ActorRef, { kind: 'human' | 'system' }>;
/** Workflow automatic rework (`requeue_task`, `reverify_round` only). */
export const WORKFLOW_AUTOMATION_ACTOR: Readonly<{ kind: 'system'; id: 'workflow:auto-rework' }> =
  Object.freeze({ kind: 'system', id: 'workflow:auto-rework' });
/** Host Goal-resume fan-out; only valid with a `goal_resume` trigger (GOAL-29). */
export const GOAL_FAN_OUT_ACTOR: Readonly<{ kind: 'system'; id: 'host:goal-fan-out' }> =
  Object.freeze({ kind: 'system', id: 'host:goal-fan-out' });
/** The ONLY actors classified `system`. Every other Host actor is an operator. */
export const PLATFORM_AUTOMATION_ACTORS: readonly Readonly<HostActorRef>[] =
  Object.freeze([WORKFLOW_AUTOMATION_ACTOR, GOAL_FAN_OUT_ACTOR]);

/** Canonical equality with one member of `PLATFORM_AUTOMATION_ACTORS`. */
export function isAutomationActor(actor: ActorRef): boolean {
  return actor.kind === 'system'
    && PLATFORM_AUTOMATION_ACTORS.some((member) => member.kind === actor.kind && member.id === actor.id);
}

/**
 * Rework actor class (spec §1, §4 TD-6). Never decided by `ActorRef.kind`
 * alone: a Host started with a `kind:'system'` actor is still an operator.
 *
 * - `work_run` principal → `agent` (the actor must be that Run's agent actor);
 * - `host` principal → `system` when the actor is a platform automation actor,
 *   otherwise `human` (the actor must be the principal's own actor);
 * - `null` principal classifies a recorded actor (`requestedBy`, a disposition
 *   record `actor`, `desiredStateRequestedBy`) by the same rule (§11 `actorClass`).
 *
 * Returns null for a principal that can never perform rework (`query_run`) or
 * an actor that does not belong to the principal.
 */
export function reworkActorClassOf(principal: CorePrincipal | null, actor: ActorRef): ReworkActorClass | null {
  if (principal === null) {
    if (actor.kind === 'agent') return 'agent';
    return isAutomationActor(actor) ? 'system' : 'human';
  }
  switch (principal.kind) {
    case 'work_run':
      return actor.kind === 'agent' && sameRunRef(actor.runRef, principal.runRef) ? 'agent' : null;
    case 'host':
      if (actor.kind === 'agent' || actor.kind !== principal.actor.kind || actor.id !== principal.actor.id) return null;
      return isAutomationActor(actor) ? 'system' : 'human';
    case 'query_run':
      return null;
    default: {
      const unknownPrincipal: never = principal;
      void unknownPrincipal;
      return null;
    }
  }
}
function sameRunRef(left: RunRef, right: RunRef): boolean {
  return left.aggregateType === right.aggregateType && left.projectId === right.projectId
    && left.goalId === right.goalId && left.runId === right.runId;
}

// ------------------------------------------------------------------------ //
// Automation policy (C8; Host setting `automation`)                         //
// ------------------------------------------------------------------------ //
export type TaskAutomationPolicyV1 = {
  schemaVersion: 1;
  /** Integer 0..MAX_AUTO_REWORK_LIMIT; 0 forbids counted automatic rework. */
  autoReworkLimit: number;
  /** Re-drive active Goals after start-up reconciliation (LA-6). */
  resumeOnStartup: boolean;
};
export const DEFAULT_AUTO_REWORK_LIMIT = 3;
export const MAX_AUTO_REWORK_LIMIT = 10;
export const DEFAULT_TASK_AUTOMATION_POLICY: Readonly<TaskAutomationPolicyV1> = Object.freeze({
  schemaVersion: 1, autoReworkLimit: DEFAULT_AUTO_REWORK_LIMIT, resumeOnStartup: true,
});

// ------------------------------------------------------------------------ //
// TaskRequeue@1 (immutable)                                                 //
// ------------------------------------------------------------------------ //
/** One per ended Run: the key is the covered (afterRun) Run. Written with CAS null. */
export type TaskRequeueRef = {
  aggregateType: 'TaskRequeue';
  projectId: string;
  goalId: string;
  taskId: string;
  afterRunId: string;
};
/** `reason` is bounded; it is never part of a rework key. */
export const TASK_REWORK_REASON_MAX_CHARS = 2000;
/** Goal-resume continuation of a fan-out pause (GOAL-29); only `GOAL_FAN_OUT_ACTOR` writes it. */
export type TaskRequeueTriggerV1 = {
  kind: 'goal_resume';
  goalRef: GoalRef;
  resumedEpoch: number;
  pausedEpoch: number;
};
export type TaskRequeueBasisComparison = 'compared' | 'skipped_interrupted' | 'skipped_human_cancel';
/** Model history the continuing Run is seeded from (LA-1); read from the afterRun claim Session. */
export type TaskRequeueHistorySourceV1 = {
  sessionRef: SessionRef;
  adapterId: string;
  kernelSessionId: string;
  /**
   * Completed-turn boundary position (for a Turn ended without a Kernel
   * terminal: the position before it, an upper bound `prepare` resolves to the
   * last completed boundary at or before it); null is the explicit empty baseline.
   */
  throughPosition: number | null;
};
export type TaskRequeueAutomationV1 = {
  /** Actor class is `system` or `agent`. */
  automatic: boolean;
  /** `automatic` and the class is not `interrupted`. */
  counted: boolean;
  /** Automatic requeues along the Run chain since the last human requeue/continue; 0 when human. */
  autoCount: number;
  /** `autoReworkLimit` at write time; null when human. */
  cap: number | null;
};
export type TaskRequeueSnapshotV1 = {
  ref: TaskRequeueRef;
  revision: 1;
  schemaVersion: 1;
  task: TaskTriple;
  /** The Goal's active Plan at requeue time. */
  planRef: PlanRevisionRef;
  /** The selected Run (lease holder) this record covers, and its Attempt. */
  afterRunRef: RunRef;
  afterAttemptRef: TaskAttemptRef;
  /** Known outcome; `yielded` only with a cancelled pointer (P17). */
  afterOutcome: Exclude<RunOutcome, 'outcome_unknown'>;
  /** The afterRun round-chain head; null without a round. */
  afterRoundRef: VerificationRoundRef | null;
  /** Audit copy only (TD-8); readers always re-derive. */
  failureClass: ReworkFailureClass;
  /** Non-null only for class `interrupted`; `paused` is the "continue" of P19. */
  interruption: 'executing' | 'paused' | null;
  stopIntentRef: ControlIntentRef | null;
  stopRequester: StopRequester;
  /** Present only on the Goal-resume continuation. */
  trigger?: TaskRequeueTriggerV1;
  /** Always computed and stored, compared or not. */
  basis: NoProgressKeyV1;
  basisComparison: TaskRequeueBasisComparison;
  /** `chainEvidenceIds(head)` of the afterRun round chain; `[]` without a round (L-3). Never rewritten. */
  supersededEvidenceIds: string[];
  /** At most MAX_NEW_BASIS_INPUT_REFS; includes a stored human note. */
  newInputRefs: NewBasisInputRefV1[];
  /** When non-null the TASK-03 claim budget must equal it. */
  budget: TaskBudgetV1 | null;
  reason: string;
  /** human, system or agent (agent carries its runRef). */
  requestedBy: ActorRef;
  requestedAt: string;
  /** Non-null only when the actor class is `agent`. */
  agentProvenance: DelegatedWriteProvenanceV1 | null;
  automation: TaskRequeueAutomationV1;
  historySource: TaskRequeueHistorySourceV1 | null;
};

// ------------------------------------------------------------------------ //
// TaskReworkRefusal@k (versioned; one key per Task/operation/subject)       //
// ------------------------------------------------------------------------ //
/** `subjectId` is the afterRunId (requeue) or the predecessor round id (reverify). */
export type TaskReworkRefusalRef = {
  aggregateType: 'TaskReworkRefusal';
  projectId: string;
  goalId: string;
  taskId: string;
  operation: TaskReworkOperation;
  subjectId: string;
};
/** The five policy refusal codes (§1.2); every other failure is a 0-commit CoreError. */
export type TaskReworkRefusalCode =
  | 'no_new_basis'
  | 'auto_rework_cap_reached'
  /** requeue only */
  | 'budget_not_increased'
  /** reverify with `onlyIfSourceChanged` only */
  | 'source_unchanged'
  /** reverify only */
  | 'verification_uncovered';
export const TASK_REWORK_REFUSAL_CODES: readonly TaskReworkRefusalCode[] = Object.freeze([
  'no_new_basis', 'auto_rework_cap_reached', 'budget_not_increased', 'source_unchanged', 'verification_uncovered',
]);
export type TaskReworkRefusalSnapshotV1 = {
  ref: TaskReworkRefusalRef;
  /** Number of refusals under this key: ∅→@1, then @k→@k+1. */
  revision: number;
  schemaVersion: 1;
  task: TaskTriple;
  /** requeue: the selected Run; reverify: the subject (or anchored producer) Run. */
  afterRunRef: RunRef;
  /** requeue: its chain head (may be null); reverify: the predecessor round. */
  subjectRoundRef: VerificationRoundRef | null;
  failureClass: ReworkFailureClass;
  code: TaskReworkRefusalCode;
  /** Platform-generated bounded text. */
  reason: string;
  /** Null for cap and budget refusals (no source capture). */
  basisDigest: string | null;
  source: SourceStampV1 | null;
  /** requeue `no_new_basis`: the TaskRequeue with the same key; otherwise null. */
  matchedRequeueRef: TaskRequeueRef | null;
  requestedBy: ActorRef;
  refusedAt: string;
  /** `countEndedGoalRuns` read before source capture; staleness watermark. */
  goalEndedRunsAtRefusal: number;
  /** Check configuration revision for configuration-dependent reverify refusals (LA-4); otherwise null. */
  configurationRevision: string | null;
};

/** `requeueTask` result: a committed refusal is a value, not a CoreError (§1.2). */
export type TaskRequeueOutcomeV1 =
  | { kind: 'requeued'; requeue: TaskRequeueSnapshotV1 }
  | { kind: 'refused'; refusal: TaskReworkRefusalSnapshotV1 };
