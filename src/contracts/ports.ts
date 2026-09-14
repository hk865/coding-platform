/**
 * WorkerRuntime execution and Dispatch outbox driver ports.
 * Artifact and Task Context ports are defined and imported directly from
 * artifact.ts and task-envelope.ts. This file does not forward those exports.
 */

import type { DispatchOutboxRef, RunRef, RuntimeEventV1 } from "./dispatch.js";
import type { TaskEnvelopeV1 } from "./task-envelope.js";

export type RunCapabilities = {
  /** Adapter-declared replay capability; fake capability does not imply real replay safety. */
  replayable: boolean;
  supportsSnapshot: boolean;
  maxEnvelopeBytes: number;
};

/**
 * 一次模型调用尝试的**证据草稿**（协作通信可靠投递规则、调用证据与参与语义规则）。
 *
 * 它由 Runtime 在**实际 ModelClient.stream(request) 边界**产生（请求摘要在那里算），由消费者经
 * 正式事实通道（control.runFact + model_request_evidence）落账。它**不是** RuntimeEvent：
 * 调用证据不是生命周期事件，不能塞进 RuntimeEventType；参与语义规则由 Control 在事实提交时裁决。
 */
export type ModelRequestEvidenceDraftV1 = {
  /** 该次请求的 id（与计量、provider 侧请求对得上）。 */
  requestId: string;
  /** 实际请求的 sha256（在 stream(request) 边界对最终 outgoing 请求计算）。 */
  requestDigest: string;
  /**
   * 这次运行实际消费的 Context 摘要（RuntimeContextManifest.inputDigest）。
   *
   * 草稿保留历史观测兼容；普通 Task 的实际调用在 ModelCallAccess.beforeCall
   * 中先与 canonical Run.inputBinding 核对并登记 attempted。这里的轮询
   * 不能替代调用前准入，也不为旧记录补造授权或 provider 回执。
   */
  contextInputDigest: string;
};

/** Pull-based execution handle. Control and cancellation use their separate ports. */
export type RunHandle = {
  runRef: RunRef;
  /** Returns events not yet polled (empty after the script is drained). */
  pollFreshEvents(): Promise<RuntimeEventV1[]>;
  /**
   * 尚未被消费者取走的**调用证据草稿**（协作通信可靠投递规则、调用证据与参与语义规则；**必选**方法）。
   *
   * 必选而不是可选：消费链上每一层包装都要**显式**表态，漏转发的包装因此在**编译期**就暴露，
   * 而不是让证据在内层被静默吞掉。不产生调用证据的 Runtime/替身返回空数组——空数组表示
   * 「这个适配器不产生调用证据」，与「这次调用没有证据」是两件事，不能互相冒充。
   */
  pollModelRequestEvidence(): Promise<ModelRequestEvidenceDraftV1[]>;
};

export interface RunPort {
  capabilities(): Promise<RunCapabilities>;
  start(envelope: TaskEnvelopeV1, access?: { modelCalls?: import('./dispatch.js').ModelCallAccess }): Promise<RunHandle>;
}

// ------------------------------------------------------------------------ //
// DispatchEngine driver                                                     //
// ------------------------------------------------------------------------ //

export type DispatchDriveTrigger = {
  reason: string;
  /** Bound the number of intents processed per drive (default 8). */
  maxIntents?: number;
};

export type DispatchDriveFailure = {
  effect?: 'none' | 'unknown';
  intentId: string;
  outboxRef: DispatchOutboxRef;
  code: "not_found" | "context_rejected" | "runtime_error" | "rejected";
  message: string;
};

/**
 * **旁路事实**（模型调用许可 / 调用证据）的失败（协作通信可靠投递规则 / 调用证据与参与语义规则）。
 *
 * 它们**不是**这个 intent 的派发失败：一个已经跑完、甚至已经在账本里落成终态的 Run，
 * 完全可能只是因为证据没能落账而有这一项。因此这条记录：
 *   · **不携带 `outboxRef`** —— 消费方（`RuntimeDispatch`）只用 `DispatchDriveFailure.outboxRef`
 *     判断"这次派发失败了吗"，所以旁路失败不会把 Run 改写成 unknown；
 *   · **单独成字段**（而不是塞进 `failures`）—— 让运维仍然看得到"证据没落账"，
 *     而不是被静默吞掉。
 * `runId` 是这条旁路事实属于哪一个 Run（不是 outbox 引用）。
 */
export type DispatchSideFactFailure = {
  intentId: string;
  runId: string;
  /**
   * permit_not_issued          — Control 未签发调用许可（复核不通过）；
   * evidence_not_recorded      — 一次调用尝试的证据事实没能落账；
   * prestart_closure_rejected  — 许可未签发后，用既有 outcome_unknown 事实给该 Run 收口时被拒
   *                              （此时 Run 可能仍无终态，必须可见，不能静默）。
   */
  code: "permit_not_issued" | "evidence_not_recorded" | "prestart_closure_rejected";
  message: string;
};

/**
 * 协作通信（CommunicationIntent）的 drive 结果（协作通信）。
 *
 * 契约归属：形状声明在 Contracts，实现（src/control/dispatch-engine/coordination-drive.ts）
 * 只是消费者——Contracts 不反向依赖实现 Module（Module 边界检查会拒绝那样做）。
 * 所有计数与年龄都来自**持久事实**（账本事件 + 聚合快照），不是内存队列长度。
 */
export type CoordinationDriveFailure = {
  intentId: string;
  code:
    | "not_found"
    | "rejected"
    | "stale_generation"
    | "owned_elsewhere"
    | "requires_reconcile"
    | "unavailable";
  message: string;
};

/** 协作 intent 的 backlog 快照（持久状态，可重启后重建；越界一律如实给出，不静默裁剪）。 */
export type CoordinationBacklog = {
  /** Present when the counts could not be refreshed from a complete scan. */
  incomplete?: true;
  /** 可领取但本次 drive 预算之外（或 availableAt 未到）的数量。 */
  pending: number;
  leased: number;
  retryScheduled: number;
  cancelRequested: number;
  quarantined: number;
  outcomeUnknown: number;
  done: number;
  /** lease 已过期且 sideEffectStarted 的 intent：**不得**重领，必须对账后才可能收敛。 */
  requiresReconcile: number;
  /** 最老的未收敛 intent 已经存在多久（毫秒）；没有未收敛项时为 null。 */
  oldestPendingAgeMs: number | null;
  oldestPendingIntent: import('./coordination.js').CommunicationIntentRef | null;
  blocked: Array<{ intentRef: import('./coordination.js').CommunicationIntentRef; status: import('./coordination.js').CommunicationIntentStatus; reason: string; availableAt: string | null }>;
  /** 扫描窗口内看到的 intent 总数（读不完整时如实给出已完成页数的下界）。 */
  observed: number;
};

export type CoordinationDriveResult = {
  /** 本次 drive 实际领取并处理的 intent 数。 */
  claimed: number;
  /** 提交成功的路由页数（含同一 intent 的后续子页）。 */
  pagesRouted: number;
  /** 本页提交产生的 Delivery 总数。 */
  deliveries: number;
  /** 收敛为 timed_out 的 wait deadline intent 数。 */
  deadlinesSettled: number;
  /** 成功创建的唯一后继（TaskAttempt/Run/outbox）数。 */
  admissions: number;
  /** 幂等建立/命中的 wait_admission intent 数。 */
  waitAdmissionsEnsured: number;
  /** 已领取但 Control 判定 not_ready（零写入）的 intent 数：保持 leased，稍后重试。 */
  deferred: number;
  /** cancel_requested 由本 drive 以同一 generation 收敛的数量。 */
  cancelConverged: number;
  failures: CoordinationDriveFailure[];
  backlog: CoordinationBacklog;
};

export type DispatchDriveResult = {
  backlog?: import('./dispatch.js').DispatchBacklog;
  scanned: number;
  started: number;
  completed: number;
  pendingRemaining: number;
  failures: DispatchDriveFailure[];
  /**
   * 旁路事实（模型调用许可 / 调用证据）的失败。**不是**派发失败，也不参与 Run 终态判定。
   * 缺省表示本次 drive 没有旁路失败——ordinary-only 的调用方看到的形状逐字节不变。
   */
  sideFactFailures?: DispatchSideFactFailure[];
  /**
   * 协作通信（route page / wait deadline / wait admission）在同一 drive 收口内推进的结果。
   * 缺省表示本次 drive 没有协作事实可推进；它不改变 ordinary outbox 的语义。
   */
  coordination?: CoordinationDriveResult;
};

/**
 * DispatchPort: processes the durable outbox — every intent is FIRST loaded
 * from the ledger (pending), THEN assembled via TaskContextPort, THEN the run
 * is started via Control (RunStarted commit) and ONLY THEN the RunPort is
 * invoked (outbox-before-side-effect ordering).
 */
export interface DispatchPort {
  drive(trigger: DispatchDriveTrigger): Promise<DispatchDriveResult>;
}
