/** R4c.1: atomic ownership admission, NOT permission to enter the Kernel.
 * Expected pins are exactly Goal, Workspace and the selected Session; immutable
 * accepted Plan is separately read and guarded. No scope reservation is required.
 */
import type { ActionRequestRef } from '../../../contracts/action-request.js';
import type { ActorRef, CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { EffectWriteResultV1, SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { TaskClaim } from '../../../contracts/core/task-claim.js';
import type { WriteResult, ReadResult } from '../../../contracts/core/results.js';
import type { DelegatedWriteProvenanceV1 } from '../../../contracts/delegated-write.js';
import type {
  ConsumedWaitV1, RoleBindingRefV1, RunRef, RunSnapshot, TaskBudgetV1, TaskTriple,
} from '../../../contracts/dispatch.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { DecisionChangeProofV1 } from '../../../contracts/goal-decisions.js';
import type { NewBasisInputRefV1 } from '../../../contracts/no-progress.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type { ReworkRequestRef } from '../../../contracts/rework-request.js';
import type {
  QueryRoundActorV1, TaskRequeueOutcomeV1, TaskRequeueRef, TaskRequeueSnapshotV1, TaskRequeueTriggerV1,
} from '../../../contracts/task-requeue.js';
import type { ArchiveRequeueOriginV1 } from '../../../contracts/session-anomaly.js';
import type { UnknownCallReviewRef } from '../../../contracts/unknown-call-review.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type { RawArtifactStorePort } from '../../record-store/body-ports.js';
import type { RoleBindingFactsPort } from './configuration-contracts.js';
import type { DispatchBasisFactsPort } from './dispatch-basis-contracts.js';
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
   * Present for a continuation claim: the earlier yielded Run whose saved
   * wait reply this new Attempt consumes. It is part of the claim fingerprint, so
   * a repeated wake request with the same pair replays instead of creating a
   * second Attempt/Run. Beside `requeueRef` it is the wait of the Task's last
   * yield before the requeue (`lastYieldedRunOf`; `wait_reply` or `expiry`) the
   * requeue carries onto the waiting line's continuation chain; that claim keeps
   * the requeue's request identity.
   */
  consumedWait?: ConsumedWaitV1;
  /**
   * Present only for a claim after a TaskRequeue (spec §4 TD-3, TASK-03); never
   * with an `intervention` `consumedWait`, and part of the claim fingerprint. The
   * new Attempt and Run record the same ref.
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
  /**
   * 按请求领取（设计 3.2 第 5 步）：目标循环领被派活请求点名的任务时带上读到的那条请求和它的版本。它必须是暂缓记录
   * `openDispatch` 指着的那条、版本相等，否则 `revision_conflict`；领取在同一次提交里了结它（AR-03，`byRequest: true`）
   * 并让派工序号 +1。可以和 `requeueRef` 同带（Q13 甲）。只在出现时进指纹。
   */
  servedRequest?: { ref: ActionRequestRef; revision: number };
  /**
   * 你的直接干预领取（Q6a 甲，设计 3.9、3.10）：领取在同一次提交里撤掉这个任务全部暂缓原因（含书记原因），撤的人记成这条
   * 干预消息；在等你批的叫停卡照挡。只在出现时进指纹。
   */
  intervention?: { messageRef: SessionMessageRef };
};
/**
 * The Task's last yield before a requeue: from `afterRun` (itself included) back over `previousRun` (A-07: the Run
 * whose released lease the next claim took) to the first Run that ended `yielded` with a formal continuation. A
 * requeue claim carries only that Run's wait, never an older one; the Workflow picks it and the claim owner checks it
 * with this one rule. `previousRun` names an earlier Run of the same Task, so the walk ends. `null` when none of them
 * yielded; a Run that cannot be read is `unreadable`, never skipped.
 */
export async function lastYieldedRunOf(
  afterRun: RunRef, readRun: (ref: RunRef) => Promise<RunSnapshot | 'unreadable'>,
): Promise<RunSnapshot | null | 'unreadable'> {
  let next: RunRef | null = afterRun;
  while (next !== null) {
    const run = await readRun(next);
    if (run === 'unreadable') return run;
    if (run.outcome === 'yielded' && run.continuation !== undefined) return run;
    next = run.previousRun;
  }
  return null;
}
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
 * A rework request the person has to decide (`book-7c.md:710–:715`): the owner wrote `ReworkRequest@1` and its one
 * `ReworkRequestRecorded` event, so this is a result of the call, not a committed rework. `cardKey` names the
 * `rework_request` decision card (`decisionSourceKey` over the same ref).
 */
export type ReworkRequestedV1 = { status: 'needs_decision'; cardKey: string; request: ReworkRequestRef };
/** Both owners' result: a committed/refused write, or the request card a `needs_decision` autonomy leaves to the person. */
export type ReworkOwnerResultV1<T> = EffectWriteResultV1<T> | ReworkRequestedV1;
/**
 * The trusted application input (`book-7c.md:716–:726`): the stored pending request, the requester agent recorded on it,
 * and the provenance rebuilt from the requester Run (never a fresh admission). `commandId` is the application command
 * the applied merge and its replay use.
 */
export type ApprovedReworkApplyV1 = {
  request: ReworkRequestRef;
  revision: number;
  commandId: string;
  /** The person's card answer; the approved commit's formal proof is bound to it. */
  answerRef: SessionMessageRef;
} & (
  | { actor: Extract<ActorRef, { kind: 'agent' }>; provenance: DelegatedWriteProvenanceV1 }
  /** 参谋规划轮的请求（Q10a 甲）：没有 Run，不重建 provenance。 */
  | { actor: QueryRoundActorV1; provenance: null }
);
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
  requeueTask?(ctx: CoreCallContext, request: GraphWrite<RequeueTaskInput>): Promise<ReworkOwnerResultV1<TaskRequeueOutcomeV1>>;
  /**
   * The person approved a stored pending request (`book-7c.md:716–:726`, LD-25): the owner's own path runs with the
   * stored requester agent and the provenance rebuilt from its Run, no fresh admission, autonomy skipped. A repeat of
   * `approval.commandId` replays; a fence that moved closes the request through its standalone close record.
   */
  requeueApprovedByCard?(ctx: CoreCallContext, request: GraphWrite<RequeueTaskInput>, approval: ApprovedReworkApplyV1):
  Promise<EffectWriteResultV1<TaskRequeueOutcomeV1>>;
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
/**
 * 设计 3.3：一条来源消息的来源链根（`planfix:`/`planresume:` 一直走到最早的那封信）。组合根用现有的
 * `planSourceLineageOf` 实现，按平台 Host 读（根只用来比同来源）；暂缓失效在这个根上认纯计划修复/恢复的来源，
 * 也认转交后再修复的后继（首封信的请求根），读不到不证明失效；原请求反馈用同一个实例归属后继候选。
 * `goalWorkspaceId` 是这条链所属 Goal 的工作区：系统轮的发送回执在那里查（设计 :554），调用方给它手里已有的值。
 */
export type PlanSourceRootPort = {
  messageRoot(ctx: CoreCallContext, source: SessionMessageRef, goalWorkspaceId: string):
    Promise<ReadResult<SessionMessageRef>>;
};
export type TaskClaimDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort;
  roles: RoleBindingFactsPort;
  /**
   * B2: the raw artifact body store, needed by the direct-claim legacy
   * provenance reader to verify a `manifest_seed` basis (the directory path
   * already takes it). Optional so an old narrower double stays compatible.
   */
  bodies?: RawArtifactStorePort;
  /**
   * 按请求领取读派工三值的那一个实例（组合根的 `dispatchBasis`）。只有带 `servedRequest` 的领取用它；没配时那种领取
   * `unsupported`，别的领取照旧。
   */
  dispatchBasis?: DispatchBasisFactsPort;
  /**
   * 设计 3.3：暂缓失效认纯 `planfix`/`planresume` 的来源链根。组合根提供这唯一一份读口；来源链读不到时不证明失效。
   */
  planSourceRoot: PlanSourceRootPort;
  now(): string;
  newId(): string;
};
