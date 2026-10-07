/** R4c.1: atomic ownership admission, NOT permission to enter the Kernel.
 * Expected pins are exactly Goal, Workspace and the selected Session; immutable
 * accepted Plan is separately read and guarded. No scope reservation is required.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { TaskClaim } from '../../../contracts/core/task-claim.js';
import type { WriteResult } from '../../../contracts/core/results.js';
import type {
  ConsumedWaitV1, DispatchOutboxRef, RoleBindingRefV1, RunRef, TaskAttemptRef, TaskBudgetV1, TaskDispatchStateV2, TaskTriple,
} from '../../../contracts/dispatch.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { NewBasisInputRefV1 } from '../../../contracts/no-progress.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type { TaskRequeueOutcomeV1, TaskRequeueRef, TaskRequeueTriggerV1 } from '../../../contracts/task-requeue.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { RoleBindingFactsPort } from './configuration-contracts.js';
import type { GraphWrite } from './task-contracts.js';

/** Compatibility re-export: the single declaration lives in contracts/core. */
export type { TaskClaim } from '../../../contracts/core/task-claim.js';

export type ClaimTaskInput = {
  goalRef: GoalRef;
  planRef: PlanRevisionRef;
  taskId: string;
  sessionRef: SessionRef;
  roleBinding: RoleBindingRefV1;
  budget: TaskBudgetV1;
  /**
   * Present only for a continuation claim: the earlier yielded Run whose saved
   * wait reply this new Attempt consumes. It is part of the claim fingerprint, so
   * a repeated wake request with the same pair replays instead of creating a
   * second Attempt/Run.
   */
  consumedWait?: ConsumedWaitV1;
  /**
   * Present only for a claim after a TaskRequeue (spec §4 TD-3, TASK-03);
   * exclusive with `consumedWait` and part of the claim fingerprint. The new
   * Attempt and Run record the same ref.
   */
  requeueRef?: TaskRequeueRef;
};
/**
 * Owner request of `requeueTask` (spec §4.1). `reason` is non-empty and
 * bounded and never part of a rework key. `budget` is never supplied by an
 * Agent; when set, the TASK-03 claim budget must equal it. `trigger` is only
 * the Goal-resume continuation (`GOAL_FAN_OUT_ACTOR`); `note` is accepted only
 * from a human operator and is stored by the owner as an Artifact that joins
 * `newInputRefs`. The actor class is derived, never an input.
 */
export type RequeueTaskInput = {
  taskRef: TaskTriple;
  afterRunRef: RunRef;
  reason: string;
  newInputRefs?: NewBasisInputRefV1[];
  budget?: TaskBudgetV1;
  trigger?: TaskRequeueTriggerV1;
  note?: string;
};
/**
 * Versioned dispatch phase nested in the @1 outbox body. `entered`/`settled`
 * must agree with the outer `status`; the codec that admits them is an
 * implementation-phase change, so the existing decoder still accepts only the
 * legacy `pending` shape.
 */
export type TaskDispatchStateV1 = {
  schemaVersion: 1;
  phase: 'entered' | 'settled';
  consumerId: string;
  entryGeneration: number;
  sessionGeneration: number;
  eventId: string;
};
/** The not-entered settlement (AD-2) lives in contracts; re-exported beside V1. */
export type { TaskDispatchStateV2 } from '../../../contracts/dispatch.js';
export type TaskClaimOutbox = {
  ref: DispatchOutboxRef;
  revision: number;
  schemaVersion: 1;
  status: 'pending' | 'entered' | 'settled';
  /**
   * Present only for the versioned entered/settled phases. V2 is the
   * `pending → settled` not-entered settlement (spec §5 AD-2); the outer outbox
   * `schemaVersion` stays 1.
   */
  dispatchState?: TaskDispatchStateV1 | TaskDispatchStateV2;
  claim: TaskClaim;
};
export interface TaskClaimPort {
  claimTask(ctx: CoreCallContext, request: GraphWrite<ClaimTaskInput>): Promise<WriteResult<TaskClaim>>;
  /**
   * Spec §4 TASK-16/17/27/28: let a Task whose selected Run ended open a new
   * Attempt. A committed policy refusal is the `refused` value, not a
   * CoreError. Optional because `createTaskClaimService` publishes
   * `TaskClaimPort` while requeue lives in its own service; the composition
   * always publishes it once implemented (A.2 step 5.4).
   */
  requeueTask?(ctx: CoreCallContext, request: GraphWrite<RequeueTaskInput>): Promise<WriteResult<TaskRequeueOutcomeV1>>;
}
export type TaskClaimDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  roles: RoleBindingFactsPort;
  now(): string;
  newId(): string;
};
