/** R4c.1: atomic ownership admission, NOT permission to enter the Kernel.
 * Expected pins are exactly Goal, Workspace and the selected Session; immutable
 * accepted Plan is separately read and guarded. No scope reservation is required.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { EffectWriteResultV1, SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { TaskClaim } from '../../../contracts/core/task-claim.js';
import type { WriteResult, ReadResult } from '../../../contracts/core/results.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import type {
  ConsumedWaitV1, RoleBindingRefV1, RunRef, TaskBudgetV1, TaskTriple,
} from '../../../contracts/dispatch.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { NewBasisInputRefV1 } from '../../../contracts/no-progress.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type { TaskRequeueOutcomeV1, TaskRequeueRef, TaskRequeueSnapshotV1, TaskRequeueTriggerV1 } from '../../../contracts/task-requeue.js';
import type { ArchiveRequeueOriginV1 } from '../../../contracts/session-anomaly.js';
import type { UnknownCallReviewRef } from '../../../contracts/unknown-call-review.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type { RawArtifactStorePort } from '../../record-store/body-ports.js';
import type { RoleBindingFactsPort } from './configuration-contracts.js';
import type { GraphWrite } from './task-contracts.js';
import type { DispatchOutboxRecord } from '../state/attempt-machine.js';

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
  /**
   * K3 (spec §2 L10, TASK-03r/RUN-01r): present only for a review claim. The
   * owner reads the review record, derives the failing guards and the basis
   * (`afterRunRef = lastHolderOf(record)`, `round = rounds.length + 1`) and
   * writes the record's `activeRound` in the SAME commit (UCR-03). Exclusive
   * with `consumedWait` and `requeueRef`, and part of the fingerprint.
   */
  review?: {
    reviewRef: UnknownCallReviewRef;
    /** The record revision the caller read; a moved revision is `revision_conflict`. */
    expectedRevision: number;
    /** The round kind this claim opens. */
    phase: 'review' | 'proposal';
  };
  /**
   * 2C item 10 (lead ruling): set by the Workflow when it claims in a REUSED
   * Session (the create path already writes the Session's initial responsible
   * link). The claim commit then also opens the Task's `responsible` link when
   * the Session has no open one to it. Part of the graph write's input, so its
   * requestId differs from a created-Session claim's; a replay restores the
   * original commit and writes no second link.
   */
  openResponsibleLink?: boolean;
  /**
   * 7A §3.5 (7a:242–:245): the message this call acts on, shape-checked only —
   * the owner neither reads it nor compares its scope. It is part of the
   * fingerprint only when present, so an old call keeps its fingerprint and its
   * result; a committed call carries the formal `proofReceipt`, one without the
   * key returns its result unchanged.
   */
  acknowledgement?: SessionMessageRef;
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
  /** Slice 1 §2.6: present only when this requeue is caused by an archive. */
  archiveOrigin?: ArchiveRequeueOriginV1 | null;
  /**
   * 7A §3.5: the message this requeue acts on, shape-checked only — the owner
   * neither reads it nor compares its scope. Part of the fingerprint only when
   * present, so an old call keeps its fingerprint and its result; a committed
   * call carries the formal `proofReceipt`, one without the key returns its
   * result unchanged.
   */
  acknowledgement?: SessionMessageRef;
};
export type TaskClaimOutbox = DispatchOutboxRecord;
/**
 * E5 (§2.3 S:622, L-d): the already committed `TaskRequeue` of a `(Task,
 * afterRun)` pair with the cursor of its original `TaskRequeued` event, so the
 * Workflow can report the original receipt without a second write.
 */
export type TaskRequeueReadV1 = {
  requeue: TaskRequeueSnapshotV1;
  cursor: CommitCursor;
};

/**
 * K3 L21 D9 (ruling 4): the record-keyed no-write replay read of the derived
 * release-hold requeue. `(Task, afterRun)` names the immutable `TaskRequeue`;
 * its `since` cursor names the original `TaskRequeued` event, whose
 * `identityKey` is compared with the request identity the route re-sends.
 */
export type ReadTaskRequeueByIdentityInputV1 = {
  taskRef: TaskTriple;
  afterRunRef: RunRef;
  /** The release-hold request's derived requeue requestId (the same on a re-click). */
  requestId: string;
};
export interface TaskClaimPort {
  claimTask(ctx: CoreCallContext, request: GraphWrite<ClaimTaskInput>): Promise<EffectWriteResultV1<TaskClaim>>;
  /**
   * Spec §4 TASK-16/17/27/28: let a Task whose selected Run ended open a new
   * Attempt. A committed policy refusal is the `refused` value, not a
   * CoreError. Optional because `createTaskClaimService` publishes
   * `TaskClaimPort` while requeue lives in its own service; the composition
   * always publishes it once implemented (A.2 step 5.4).
   */
  requeueTask?(ctx: CoreCallContext, request: GraphWrite<RequeueTaskInput>): Promise<EffectWriteResultV1<TaskRequeueOutcomeV1>>;
  /**
   * E5: the smallest no-write read of an already committed requeue. It restores
   * the original `TaskRequeued` event (via `lookupCommit`/`eventAt`) when the
   * exact request identity has committed and the event covers `(Task,
   * afterRun)`; `not_found` otherwise. Never writes or changes state.
   */
  readTaskRequeue?(ctx: CoreCallContext, request: GraphWrite<RequeueTaskInput>): Promise<ReadResult<TaskRequeueReadV1>>;
  /**
   * K3 L21 D9 (ruling 4): the same no-write replay read, keyed by the derived
   * requeue's record and its identity instead of the caller's fresh pins. A
   * `TaskRequeue(task, afterRun)` is immutable and its `since` cursor names the
   * `TaskRequeued` event; a matching `identityKey` answers `{requeue, cursor}`,
   * every miss (`not_found`) or store failure otherwise. Never writes.
   */
  readTaskRequeueByIdentity?(
    ctx: CoreCallContext, input: ReadTaskRequeueByIdentityInputV1,
  ): Promise<ReadResult<TaskRequeueReadV1>>;
}
export type TaskClaimDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort;
  roles: RoleBindingFactsPort;
  /**
   * B2: the raw artifact body store, needed by the direct-claim legacy
   * provenance reader to verify a `manifest_seed` basis (the directory path
   * already takes it). Optional so an old narrower double stays compatible.
   */
  bodies?: RawArtifactStorePort;
  now(): string;
  newId(): string;
};
