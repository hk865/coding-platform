/**
 * 协作通信协议 v1（协作通信）。
 *
 * 权威语义：
 *   - **Work 是持久责任地址**：DirectedRequest / Subscription / WaitCondition 的 owner 都是
 *     WorkContextBinding，而不是 Run 或 AgentInstance。AgentInstance 只承担归因；
 *     RoleBinding 固定授权版本。同一 Work 换参与者后等待仍归 Work。
 *   - **正文 body-first**：请求/报告正文先放 ArtifactVault；Control 只登记正文的精确
 *     `ArtifactRef` 与来源 pin。正文存在**不等于**已被受理。
 *   - **路由是持久 intent 分页**：广播事件或定向请求都生成同形状的 Delivery 引用，
 *     但源事件提交时不做无界 fan-out。每个路由页的 Deliveries + 页 checkpoint +
 *     wait transition + next intent + 当前 intent settle 在**同一个 generation-guarded
 *     Ledger CAS** 里提交；提交成功而回执丢失时同一命令与 generation 只能 replay。
 *   - **等待只接受有类型的 canonical fact**：不接受任意表达式，不引入工作流 DSL。
 *     `satisfied` 以 `(workRef, waitRef, satisfiedRevision)` 为唯一键，并在同一事务里
 *     创建至多一个后继 TaskAttempt/Run/唯一 outbox（`communication-successor-claim`）。
 *   - **通信状态与调度状态不合并**：`CommunicationIntent` 是机械执行记录，只表达
 *     pending/leased/…/quarantined；业务语义仍在 Request/Subscription/Delivery/Wait 上。
 *   - 取消采用 desired-state-first：Control 先以 expected generation 写 `cancel_requested`，
 *     handler 再以同一 generation 确认 cancelled / done / outcome_unknown。
 */
import type { ActorRef, CommandFingerprint, CommandIdentity, CommitCursor } from "./command-event.js";
import { canonicalJson, sha256Hex } from "./fingerprint.js";
import type { RoleBindingRefV1, RunRef, TaskAttemptRef, TaskBudgetV1 } from "./dispatch.js";
import type { PlanRevisionRef } from "./plan.js";
import type { ArtifactRef } from "./artifact.js";
import type { ContextManifestV1, TaskEnvelopeV1 } from "./task-envelope.js";
import type { WorkContextRef } from "./context-continuity.js";
import type { DispatchOutboxEntrySnapshot, RunSnapshot, TaskAttemptSnapshot, TaskLeaseSnapshot } from "./dispatch.js";

// ------------------------------------------------------------------------ //
// Limits                                                                    //
// ------------------------------------------------------------------------ //

/** 一次路由页最多产生的 Delivery 数（有界页大小的唯一正文）。 */
export const COMMUNICATION_PAGE_MAX_DELIVERIES = 64;
/** 一个 Wait 最多引用的条件数（all-wait 的成员上界）。 */
export const WAIT_MAX_CONDITIONS = 8;
/** 一个 Subscription 的 filter topic 上界。 */
export const SUBSCRIPTION_MAX_TOPICS = 16;
export const SUBSCRIPTION_MAX_REPLAY_SPAN = 512;
export const COMMUNICATION_INTENT_MAX_ATTEMPTS = 8;
/** 声明文本上界（不保存整段会话）。 */
export const REQUEST_STATEMENT_MAX_BYTES = 4096;

// ------------------------------------------------------------------------ //
// Refs                                                                      //
// ------------------------------------------------------------------------ //

export type AgentInstanceRef = {
  aggregateType: "AgentInstance";
  projectId: string;
  workspaceId: string;
  agentInstanceId: string;
};

export type WorkParticipationRef = {
  aggregateType: "WorkParticipation";
  projectId: string;
  workspaceId: string;
  workId: string;
  participationId: string;
};

export type DirectedRequestRef = {
  aggregateType: "DirectedRequest";
  projectId: string;
  workspaceId: string;
  requestId: string;
};

export type SubscriptionRef = {
  aggregateType: "Subscription";
  projectId: string;
  workspaceId: string;
  subscriptionId: string;
};

export type DeliveryRef = {
  aggregateType: "Delivery";
  projectId: string;
  workspaceId: string;
  deliveryId: string;
};

export type WaitConditionRef = {
  aggregateType: "WaitCondition";
  projectId: string;
  workspaceId: string;
  waitId: string;
};

export type CommunicationIntentRef = {
  aggregateType: "CommunicationIntent";
  projectId: string;
  workspaceId: string;
  intentId: string;
};

export type CommunicationAdmissionRef = {
  aggregateType: "CommunicationAdmission";
  projectId: string;
  workspaceId: string;
  waitId: string;
};

/** 每个 (project, workspace) 一份的协作登记索引（可重建投影，不是调度权威）。 */
export type CoordinationRegistryRef = {
  aggregateType: "CoordinationRegistry";
  projectId: string;
  workspaceId: string;
};

/** 每个 (project, workspace) 一份的 work 邮箱索引。 */
export type WorkMailboxRef = {
  aggregateType: "WorkMailbox";
  projectId: string;
  workspaceId: string;
};

export function coordinationRegistryRefFor(projectId: string, workspaceId: string): CoordinationRegistryRef {
  return { aggregateType: "CoordinationRegistry", projectId, workspaceId };
}

export function workMailboxRefFor(projectId: string, workspaceId: string): WorkMailboxRef {
  return { aggregateType: "WorkMailbox", projectId, workspaceId };
}

export function agentInstanceRefFor(projectId: string, workspaceId: string, agentInstanceId: string): AgentInstanceRef {
  return { aggregateType: "AgentInstance", projectId, workspaceId, agentInstanceId };
}

export function workParticipationRefFor(projectId: string, workspaceId: string, workId: string, participationId: string): WorkParticipationRef {
  return { aggregateType: "WorkParticipation", projectId, workspaceId, workId, participationId };
}

export function directedRequestRefFor(projectId: string, workspaceId: string, requestId: string): DirectedRequestRef {
  return { aggregateType: "DirectedRequest", projectId, workspaceId, requestId };
}

export function subscriptionRefFor(projectId: string, workspaceId: string, subscriptionId: string): SubscriptionRef {
  return { aggregateType: "Subscription", projectId, workspaceId, subscriptionId };
}

export function deliveryRefFor(projectId: string, workspaceId: string, deliveryId: string): DeliveryRef {
  return { aggregateType: "Delivery", projectId, workspaceId, deliveryId };
}

export function waitConditionRefFor(projectId: string, workspaceId: string, waitId: string): WaitConditionRef {
  return { aggregateType: "WaitCondition", projectId, workspaceId, waitId };
}

export function communicationIntentRefFor(projectId: string, workspaceId: string, intentId: string): CommunicationIntentRef {
  return { aggregateType: "CommunicationIntent", projectId, workspaceId, intentId };
}

export function communicationAdmissionRefFor(projectId: string, workspaceId: string, waitId: string): CommunicationAdmissionRef {
  return { aggregateType: "CommunicationAdmission", projectId, workspaceId, waitId };
}

// ------------------------------------------------------------------------ //
// Agent principal（参与关系与换手）                                                     //
// ------------------------------------------------------------------------ //

/**
 * Agent 发起命令时的精确归因。**禁止**用 human/system 身份冒充 Agent 行为。
 *
 * 为什么 actor 与 principal 分开：`ActorRef.kind` 的下游消费者（117 处）与
 * UI 类型都把 human/system 当作既成事实；当前实现只**增加** `'agent'` 这一种 kind 并在
 * agent 命令上强制携带 principal，不改动既有 human/system 断言的语义。
 */
export type AgentPrincipalRefV1 = {
  schemaVersion: 1;
  agentInstanceId: string;
  /** 精确的持久责任地址。 */
  workContextRef: WorkContextRef;
  participationRef: WorkParticipationRef;
  /** 该参与关系生效的 RoleBinding 版本。 */
  roleBinding: RoleBindingRefV1;
  /** 发起本次命令的 Run（causation 的可核对依据）。 */
  runRef: RunRef;
};

/** agent 命令的 actor：id 是 AgentInstance id，runRef 是 causation。 */
export type AgentActorRef = {
  kind: "agent";
  id: string;
  runRef: RunRef;
};

export function agentActorRefFor(agentInstanceId: string, runRef: RunRef): AgentActorRef {
  return { kind: "agent", id: agentInstanceId, runRef: { ...runRef } };
}

// ------------------------------------------------------------------------ //
// AgentInstance / WorkParticipation                                          //
// ------------------------------------------------------------------------ //

export type AgentInstanceStatus = "active" | "retired";

export type AgentInstanceV1 = {
  schemaVersion: 1;
  agentInstanceId: string;
  projectId: string;
  workspaceId: string;
  /** 该实例来自的模板与版本（RoleSpec 模板 id；不授予任何权限）。 */
  templateId: string;
  templateRevision: string;
  status: AgentInstanceStatus;
  createdAt: string;
  retiredAt: string | null;
};

export type AgentInstanceSnapshot = {
  ref: AgentInstanceRef;
  revision: number;
  schemaVersion: 1;
  agent: AgentInstanceV1;
  recordedAt: string;
};

/**
 * Work、AgentInstance 与 RoleBinding 在一段时间/版本上的关联。
 *
 * ── 纵向范围约束：实际保证与边界（协作通信参与身份裁决／调用证据与参与语义规则）─────────
 * 不变式：「一个 AgentInstance 在同一 (project, workspace) 至多有一个 active participation」。
 * 它由**两条独立机制**共同保证，缺一不可：
 *
 *   1. 命令面（先查后写，只给出可读的拒绝原因）：相同 AgentInstance 在本 (project, workspace)
 *      已有**其它** active 参与关系 → Control 拒绝（零写入）。跨进程时它挡不住，所以还需要 2。
 *   2. 账本提交语义（**唯一写入路径**在同一事务里判定并占用）：participation-start 在同一个
 *      提交里占用该 (project, workspace, agentInstanceId) 的**参与身份槽**，participation-end
 *      在同一次提交里**释放**它（只有占用者本人能释放）。同一手法见 work-context-bind 的任务
 *      身份槽：对比 ledger-validation 的 workContextIdentityClaim 与 participationIdentityClaim。
 *      因此「两个宿主进程各自先查后写」不可能各自建立一段 active 参与：第二个提交会被账本拒绝。
 *
 *   仍然保留的既有保证：
 *     1. 同一 participationId 只创建一次（participation-start 是 CAS@0 + 账本幂等）；
 *     2. 同一 Work 的并发参与由 WorkContextBinding 的 CAS 串行化（两者同一事务提交）；
 *     3. 同一段参与的结束是一次 CAS@N 的原地推进（participation-end）。
 *
 * 已知边界（如实，不假装覆盖）：
 *     - 身份槽按**快照内容**派生，守卫的是「通过正式提交写进来的参与关系」；本次裁决之前已经
 *       落账的历史重复（同一 AgentInstance 两条 active）保持可读、不改写、不合并，只是不再新增第三条。
 *     - Work 侧的「当前参与关系」是 WorkContextBindingV1.currentParticipationRef：participation-start
 *       与它同一提交写入；是否**有效**由 Control 按该参与关系的 status === "active" 判定
 *       （见该字段的注释）。
 *
 * 历史 participation 不删除、不改名：换手时旧的置 `ended`（保留 endedAt），
 * 请求/订阅/等待仍归 Work（它们的 owner 是 WorkContextBinding，不是参与关系）。
 */
export type WorkParticipationV1 = {
  schemaVersion: 1;
  participationId: string;
  workContextRef: WorkContextRef;
  agentInstanceId: string;
  roleBinding: RoleBindingRefV1;
  status: "active" | "ended";
  startedAt: string;
  endedAt: string | null;
};

export type WorkParticipationSnapshot = {
  ref: WorkParticipationRef;
  revision: number;
  schemaVersion: 1;
  participation: WorkParticipationV1;
  recordedAt: string;
};

// ------------------------------------------------------------------------ //
// DirectedRequest                                                            //
// ------------------------------------------------------------------------ //

export type DirectedRequestStatus = "submitted" | "routed" | "responded" | "cancelled" | "expired" | "closed";

export type ReportMaterialV1 = {
  /** 正文的不可变引用（body-first；正文本身不复制进本记录）。 */
  bodyRef: ArtifactRef;
  /** 报告正文的来源 pin（用于 currentness 复核，不是业务真实性判断）。 */
  sourceRefs: { kind: string; refId: string; revision: string }[];
  /** 报告作者（诚实归因；不授予读取权）。 */
  authorRunRef: RunRef;
};

export type DirectedRequestV1 = {
  schemaVersion: 1;
  requestId: string;
  projectId: string;
  workspaceId: string;
  /** 发出方：请求由哪个 Work 的哪次参与发出。 */
  fromWorkContextRef: WorkContextRef;
  fromParticipationRef: WorkParticipationRef;
  fromRunRef: RunRef;
  /** 目标：唯一且有界的 Work。 */
  toWorkContextRef: WorkContextRef;
  /** 并发校验依据；不匹配返回 stale（不偷偷转投）。 */
  expectedParticipationRef: WorkParticipationRef | null;
  /** 请求陈述（有界；不保存整段会话）。 */
  statement: string;
  /** 请求正文引用（body-first）。 */
  statementBodyRef: ArtifactRef;
  roleBinding: RoleBindingRefV1;
  status: DirectedRequestStatus;
  createdAt: string;
  respondedAt: string | null;
  /** 目标 Work 的回应。（提交报告正文后登记） */
  response: ReportMaterialV1 | null;
  cancelledAt: string | null;
  expiredAt: string | null;
};

export type DirectedRequestSnapshot = {
  ref: DirectedRequestRef;
  revision: number;
  schemaVersion: 1;
  request: DirectedRequestV1;
  recordedAt: string;
};

// ------------------------------------------------------------------------ //
// Subscription                                                              //
// ------------------------------------------------------------------------ //

/**
 * 一个 Work 对有界事件范围的持续兴趣。
 *
 * filter 是**有类型的 topic 名**集合，不是任意表达式：订阅只按 `topic` 精确匹配，
 * 不允许脚本或 DSL。start position 是 opaque cursor（对上层不透明）。
 */
export type SubscriptionV1 = {
  schemaVersion: 1;
  subscriptionId: string;
  projectId: string;
  workspaceId: string;
  ownerWorkContextRef: WorkContextRef;
  ownerParticipationRef: WorkParticipationRef;
  /** 命中的 topic 名（精确匹配；空集合表示不命中任何 topic）。 */
  topics: string[];
  /** opaque 起始位置（含）：只投递该位置之后的事件。 */
  startCursor: CommitCursor | null;
  /** 已投递到的位置（页 checkpoint）；每次路由页提交原子推进。 */
  routedThroughCursor: CommitCursor | null;
  /** Historical catchup fixed at SubscriptionCreated; absent for live-only and legacy records. */
  catchup?: { intentRef: CommunicationIntentRef; horizonCursor: CommitCursor };
  status: "active" | "cancelled";
  createdAt: string;
  cancelledAt: string | null;
};

export type SubscriptionSnapshot = {
  ref: SubscriptionRef;
  revision: number;
  schemaVersion: 1;
  subscription: SubscriptionV1;
  recordedAt: string;
};

// ------------------------------------------------------------------------ //
// Delivery                                                                  //
// ------------------------------------------------------------------------ //

/**
 * request 或 subscription 命中的一次**持久投递**。
 *
 * 只证明"目标 Work 获得了一个可见引用"，**不**授予 ArtifactVault 正文读取：
 * 后继 Run 准备时才按其 exact Run/participation、当前 source version 和 access policy
 * 生成或核对精确 grant。撤权因此能阻止旧 Delivery 进入新输入。
 */
export type DeliveryV1 = {
  continuation?: {status:'not_required'|'registered'|'unavailable';reason:string;waitRef:WaitConditionRef|null};
  schemaVersion: 1;
  deliveryId: string;
  projectId: string;
  workspaceId: string;
  /** 唯一键的一半：来自定向请求还是订阅。 */
  origin:
    | { kind: "architecture_decision"; reviewRef: import("./architecture-review.js").ArchitectureReviewRef; reviewRevision: number; targetIndex: number }
    | { kind: "directed_request"; requestRef: DirectedRequestRef }
    | { kind: "subscription"; subscriptionRef: SubscriptionRef; sourceTopic: string; sourceCursor: CommitCursor };
  targetWorkContextRef: WorkContextRef;
  /** 命中的正文（request 的陈述/回应，或事件携带的正文）。 */
  bodyRef: ArtifactRef | null;
  /** 事件类投递的来源与版本。 */
  sourceRefs: { kind: string; refId: string; revision: string }[];
  createdAt: string;
};

export type DeliverySnapshot = {
  ref: DeliveryRef;
  revision: 1;
  schemaVersion: 1;
  delivery: DeliveryV1;
  recordedAt: string;
};

// ------------------------------------------------------------------------ //
// WaitCondition                                                             //
// ------------------------------------------------------------------------ //

/** Wait 的条件只允许引用有类型的 canonical fact，不接受任意表达式。 */
export type WaitConditionTermV1 =
  | { kind: "delivery_present"; deliveryRef: DeliveryRef }
  | { kind: "request_responded"; requestRef: DirectedRequestRef }
  | { kind: "request_closed"; requestRef: DirectedRequestRef };

export type WaitConditionV1 = {
  architectureReview?: {ref:import('./architecture-review.js').ArchitectureReviewRef;revision:number};
  schemaVersion: 1;
  waitId: string;
  projectId: string;
  workspaceId: string;
  ownerWorkContextRef: WorkContextRef;
  ownerParticipationRef: WorkParticipationRef;
  /** 注册该等待的 Run（前驱；后继资格要求它已公开结束）。 */
  predecessorRunRef: RunRef;
  mode: "all" | "any";
  /** Present only when an alternative report was atomically selected at admission. */
  selectedReport?: import('./alternative-report.js').AlternativeReportSelection;
  conditions: WaitConditionTermV1[];
  /** 已满足的条件下标（页面按 index 记录，顺序确定）。 */
  satisfiedIndexes: number[];
  /**
   * 观察到的条件事实（条件先到、前驱未结束时保留在这里），
   * 使重启后仍能重建"为什么还不能接续"。
   */
  observations: { index: number; observedAt: string; note: string }[];
  status: "active" | "satisfied" | "timed_out" | "cancelled" | "cancel_requested";
  deadlineAt: string | null;
  createdAt: string;
  settledAt: string | null;
  /** satisfiedRevision：同一 wait 只允许一次 satisfied 转移（= 该次提交后的聚合 revision）。 */
  satisfiedRevision: number | null;
};

export type WaitConditionSnapshot = {
  ref: WaitConditionRef;
  revision: number;
  schemaVersion: 1;
  wait: WaitConditionV1;
  recordedAt: string;
};

/** intent settle 提交里引用的订阅/等待快照的投影（只用于构造 expectedVersions）。 */
export type SettledIntentWaitRefs = { ref: WaitConditionRef; revision: number };

/**
 * 等待满足时创建的**唯一**后继执行锚点。唯一键 = (workContextRef, waitRef, satisfiedRevision)。
 *
 * ── 这张记录**原子固定**了什么（协作通信参与身份裁决，参与身份规则）────────────────────
 * 后继受理那一次提交同时定死三件事，且它们**只**由这次提交决定，之后不再重新解析：
 *   1. 这一段的参与关系（participationRef / agentInstanceId）= Control 当时从 Work 权威状态
 *      读到的**当前有效参与关系**（不是等待注册时那一段；那一段是历史事实，见 WaitCondition）；
 *   2. 本次采用的**授权版本**（roleBinding）= 该参与关系上固定的 RoleBinding；后继 Run 的
 *      roleBinding 必须与它逐字段相同；
 *   3. 本次必须消费的**目标 Delivery 集合**（deliveryRefs）= 后继 Context 选材的边界
 *      （按 admission 固定的材料集合消费；不是「把整个邮箱当输入」）；
 *   4. 本次**实际采用的权限集**（declaredPermissions）= 前驱 Run 信封声明的权限 ∩ 当前参与关系
 *      RoleBinding 规格的授权上界（协议约束 2.2：只许收窄、不许放宽；交集为空即拒绝受理）。
 *
 * ── 版本留痕（协议约束 1.2「要能回答当时用的是哪一版」）────────────────────────
 * bindingRevision / participationRevision 是受理那一刻**读到的** Work 绑定与参与关系 revision。
 * 它们同时是那次提交 expectedVersions 里的 CAS 期望值（换手竞态因此零写失败），并且原样留在
 * admission 里：事后审计能复原「当时读的是哪一版」，而不是只能看到一次被拒的竞态。
 * 派发（DispatchEngine）与 Context 都消费这份结果：见 DispatchIntentV1.admittedWorkRef 与
 * ensureWorkIdentity —— 已受理的协作后继**不得**再按 (goal, task) 解析成另一个 Work。
 */
export type CommunicationAdmissionV1 = {
  /** Fresh trusted inspection prefix; never a reusable authorization. */
  reportQualification?: import('./alternative-report.js').AlternativeReportQualification;
  schemaVersion: 1;
  waitRef: WaitConditionRef;
  workContextRef: WorkContextRef;
  satisfiedRevision: number;
  /** 后继参与关系（通常是与等待注册时不同的**当前**一段参与；同一段继续也合法）。 */
  participationRef: WorkParticipationRef;
  agentInstanceId: string;
  /** 本次固定的授权版本（后继 Run 的 roleBinding 必须与它一致）。 */
  roleBinding: RoleBindingRefV1;
  /** 本次固定的目标 Delivery 集合（后继 Context 只按它选必需材料）。 */
  deliveryRefs: DeliveryRef[];
  /** 本次实际采用的权限集（= 前驱信封 ∩ 当前 RoleBinding 规格上界；只收窄）。 */
  declaredPermissions: { tools: string[]; writeScope: string[] };
  /**
   * 这次权限集是怎么来的（审计与验收要能只凭账本回答「到底有没有按上界收窄过」）：
   *   - `no_matrix`：项目没有生效的角色矩阵，既有策略返回 spec=null（**未校验、不等于已授权**），
   *     因此保持前驱权限集原值 —— 没有上界可比；
   *   - `within_spec`：有矩阵且规格可受理，交集与前驱权限集**逐字段相同**（已在界内）；
   *   - `narrowed`：有矩阵且规格可受理，交集确实收掉了东西（工具被裁掉或写范围被收成空）。
   * 前两者在权限集上可能长得一模一样，但事后复核的结论完全不同，所以必须落账。
   */
  permissionBasis: "narrowed" | "within_spec" | "no_matrix";
  /** 受理时读到的 Work 绑定 revision（同时是那次提交的 CAS 期望值之一）。 */
  bindingRevision: number;
  /** 受理时读到的参与关系 revision（同上；换手竞态据此零写失败）。 */
  participationRevision: number;
  predecessorRunRef: RunRef;
  runRef: RunRef;
  attemptRef: TaskAttemptRef;
  admissionCommandId: string;
  admittedAt: string;
};

export type CommunicationAdmissionSnapshot = {
  ref: CommunicationAdmissionRef;
  revision: number;
  schemaVersion: 1;
  admission: CommunicationAdmissionV1;
  recordedAt: string;
};

// ------------------------------------------------------------------------ //
// 登记索引（可重建；路由页需要"当前位置有哪些活跃订阅"的确定答案）              //
// ------------------------------------------------------------------------ //

export type CoordinationRegistryV1 = {
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  /** 活跃订阅（按 subscriptionId 排序）。 */
  subscriptionRefs: SubscriptionRef[];
  /** 活跃等待（按 waitId 排序）。 */
  waitRefs: WaitConditionRef[];
  updatedAt: string;
};

export type CoordinationRegistrySnapshot = {
  ref: CoordinationRegistryRef;
  revision: number;
  schemaVersion: 1;
  registry: CoordinationRegistryV1;
  recordedAt: string;
};

export type WorkMailboxV1 = {
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  /** workId → 该 Work 的邮箱内容（按稳定顺序）。 */
  mailboxes: {
    workId: string;
    participationRefs: WorkParticipationRef[];
    requestRefs: DirectedRequestRef[];
    subscriptionRefs: SubscriptionRef[];
    waitRefs: WaitConditionRef[];
    deliveryRefs: DeliveryRef[];
  }[];
  updatedAt: string;
};

export type WorkMailboxSnapshot = {
  ref: WorkMailboxRef;
  revision: number;
  schemaVersion: 1;
  mailbox: WorkMailboxV1;
  recordedAt: string;
};

// ------------------------------------------------------------------------ //
// CommunicationIntent（机械调度记录，不是业务状态）                          //
// ------------------------------------------------------------------------ //

export type CommunicationIntentStatus =
  | "pending"
  | "leased"
  | "done"
  | "retry_scheduled"
  | "cancel_requested"
  | "cancelled"
  | "outcome_unknown"
  | "quarantined";

/**
 * 路由页 intent 的 domain。
 *
 * **两个位置必须分开**（协作通信协议约束 1.4）：
 *   - `sourceTopic` + `sourceCursor` 是**源事件位置**：本轮要投递的那个账本事件位置。
 *     一个 intent 只负责**一个事件位置**，因此它在同一 intent 的多次翻页之间**允许不变**。
 *   - `subscriptionPosition` 是**该事件内的订阅分页位置**：上一页处理到的最后一个订阅的
 *     canonical ref key（`null` = 本事件还没有处理过任何订阅）。**同一事件翻页时它必须前进**
 *     （回退或原地不动一律拒绝），因为"订阅位置每页严格增加"才是分页真正的推进判据。
 *   - `subscriptionScope` 是**本轮固定的订阅范围**：开始时确定，翻页期间**不得改变**
 *     （本页不得引入范围外的订阅）。
 *
 * 正因如此，**不能用「事件位置每页严格增加」去校验所有分页**；跨事件推进是**上一个 intent
 * 完成后**由新的 intent 承担（协议约束 1.4：末页完成后才推进事件处理位置）。
 */
export type RoutePageSubscriptionScopeEntry = {
  subscriptionRef: SubscriptionRef;
  /** 该订阅在本轮开始时的 expected revision（范围固定的版本依据）。 */
  expectedRevision: number;
};

export type CommunicationIntentDomain =
  | { kind: "architecture_decision_delivery"; reviewRef: import("./architecture-review.js").ArchitectureReviewRef; reviewRevision: number; targetIndex: number }
  | { kind: "subscription_catchup"; subscriptionRef: SubscriptionRef; startCursor: CommitCursor; scanCursor: CommitCursor; horizonCursor: CommitCursor }
  | {
      kind: "route_page";
      /** 源事件位置：本 intent 负责的 topic 与账本位置（同一 intent 翻页间不变）。 */
      sourceTopic: string;
      sourceCursor: CommitCursor;
      /** 该事件内的订阅分页位置（上一页处理到的最后一个订阅的 canonical ref key）。 */
      subscriptionPosition: string | null;
      /** 本轮固定的订阅范围（按 canonical ref key 升序；翻页期间不得改变）。 */
      subscriptionScope: RoutePageSubscriptionScopeEntry[];
    }
  /** 定时唤醒：wait deadline 到点后收敛为 timed_out 或接续。 */
  | { kind: "wait_deadline"; waitRef: WaitConditionRef }
  /** 条件已满足但前驱尚未结束：前驱终态受理时复查接续资格。 */
  | { kind: "wait_admission"; waitRef: WaitConditionRef };

export type CommunicationIntentV1 = {
  schemaVersion: 1;
  intentId: string;
  projectId: string;
  workspaceId: string;
  domain: CommunicationIntentDomain;
  status: CommunicationIntentStatus;
  /** 单调递增的领取代际；过期 generation 不能 settle。 */
  leaseGeneration: number;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  attemptCount: number;
  availableAt: string | null;
  lastFailureClass: string | null;
  /** 该 intent 是否已经产生外部副作用（决定 lease 过期后能否重新领取）。 */
  sideEffectStarted: boolean;
  createdAt: string;
  settledAt: string | null;
};

export type CommunicationIntentSnapshot = {
  ref: CommunicationIntentRef;
  revision: number;
  schemaVersion: 1;
  intent: CommunicationIntentV1;
  recordedAt: string;
};

// ------------------------------------------------------------------------ //
// Commands: registration（Control owner）                                    //
// ------------------------------------------------------------------------ //

type AgentCommandIdentityBase = {
  identity: CommandIdentity;
  correlationId: string;
  submittedAt: string;
};

export type RegisterAgentInstanceCommand = AgentCommandIdentityBase & {
  commandId: string;
  commandType: "RegisterAgentInstance";
  schemaVersion: 1;
  aggregateId: string;
  expectedRevision: 0;
  payload: {
    workspaceId: string;
    templateId: string;
    templateRevision: string;
  };
};

export type StartWorkParticipationCommand = AgentCommandIdentityBase & {
  commandId: string;
  commandType: "StartWorkParticipation";
  schemaVersion: 1;
  aggregateId: string;
  expectedRevision: 0;
  payload: {
    initialDispatchRef?: import('./dispatch.js').DispatchOutboxRef;
    workspaceId: string;
    workContextRef: WorkContextRef;
    agentInstanceId: string;
    roleBinding: RoleBindingRefV1;
    /** 该参与关系的发起 Run（必须已 link 到 work）。 */
    runRef: RunRef;
  };
};

/**
 * 结束一段参与关系（参与关系与换手：「同一 Work 换参与者后等待仍归 Work」）。
 *
 * 为什么必须有这条命令：WorkParticipation 是**一段时间**上的参与，不是 Work 本身。
 * 换手（前一段参与结束、同一 Work 上开始新一段参与）必须能被表达，否则
 * 「等待归 Work 而不是归某个参与者」在账本里没有可证的迁移路径。结束是
 * **CAS@N** 的原地推进：历史参与不改名、不删除，只把 status 置 `ended` 并记 endedAt。
 *
 * runRef 是这次收尾所归因的 Run（通常是该 Work 的当前/继任 Run），Control 会要求它
 * 确实 link 在该 Work 上；reason 是本条命令的说明。注意：`WorkParticipationV1` 的
 * 值形状里没有对应的持久字段，因此两者是**授权与归因输入**，canonical 事实是
 * `WorkParticipationEnded` 事件 + 快照的 status/endedAt（要持久化 reason 需要先裁决
 * 给该值形状加可选字段）。
 */
export type EndWorkParticipationCommand = AgentCommandIdentityBase & {
  commandId: string;
  commandType: "EndWorkParticipation";
  schemaVersion: 1;
  aggregateId: string;
  /** 当前 WorkParticipation 的 expected revision（CAS）。 */
  expectedRevision: number;
  payload: {
    workspaceId: string;
    /**
     * 该参与关系所属的 Work。**必须显式给出**：WorkParticipationRef 的地址是
     * (projectId, workspaceId, workId, participationId)，只有 participationId 无法构成
     * canonical ref，也就无法在账本里定位这条聚合（Control 不做全量事件扫描）。
     * handler 会复核它必须与聚合快照里的 workContextRef 逐字段一致。
     */
    workContextRef: WorkContextRef;
    /** 收尾 Run；必须已 link 在该参与关系所属的 Work 上。 */
    runRef: RunRef;
    reason: string;
  };
};

export type SendDirectedRequestCommand = AgentCommandIdentityBase & {
  commandId: string;
  commandType: "SendDirectedRequest";
  schemaVersion: 1;
  aggregateId: string;
  expectedRevision: 0;
  payload: {
    workspaceId: string;
    fromParticipationRef: WorkParticipationRef;
    fromRunRef: RunRef;
    toWorkContextRef: WorkContextRef;
    expectedParticipationRef: WorkParticipationRef | null;
    statement: string;
    statementBodyRef: ArtifactRef;
    roleBinding: RoleBindingRefV1;
  };
};

export type SubscribeCommand = AgentCommandIdentityBase & {
  commandId: string;
  commandType: "CreateSubscription";
  schemaVersion: 1;
  aggregateId: string;
  expectedRevision: 0;
  payload: {
    workspaceId: string;
    ownerWorkContextRef: WorkContextRef;
    ownerParticipationRef: WorkParticipationRef;
    topics: string[];
    startCursor: CommitCursor | null;
  };
};

export type RegisterWaitCommand = AgentCommandIdentityBase & {
  commandId: string;
  commandType: "RegisterWait";
  schemaVersion: 1;
  aggregateId: string;
  expectedRevision: 0;
  payload: {
    workspaceId: string;
    ownerWorkContextRef: WorkContextRef;
    ownerParticipationRef: WorkParticipationRef;
    predecessorRunRef: RunRef;
    /** Omitted by legacy commands: all. any waits only for optional reports. */
    mode?: 'all' | 'any';
    conditions: WaitConditionTermV1[];
    deadlineAt: string | null;
  };
};

/** 登记一次定向请求的回应（报告正文已 body-first）。 */
export type RespondDirectedRequestCommand = AgentCommandIdentityBase & {
  commandId: string;
  commandType: "RespondDirectedRequest";
  schemaVersion: 1;
  aggregateId: string;
  /** 当前 DirectedRequest 的 expected revision（CAS）。 */
  expectedRevision: number;
  payload: {
    workspaceId: string;
    respondingParticipationRef: WorkParticipationRef;
    respondingRunRef: RunRef;
    response: ReportMaterialV1;
  };
};

/** desired-state-first 取消：request / subscription / wait 三类共用一条命令形状。 */
export type CancelCommunicationCommand = AgentCommandIdentityBase & {
  commandId: string;
  commandType: "CancelCommunication";
  schemaVersion: 1;
  aggregateId: string;
  expectedRevision: number;
  payload: {
    workspaceId: string;
    target: "directed_request" | "subscription" | "wait";
    reason: string;
  };
};

// ------------------------------------------------------------------------ //
// Commands: 机械推进（Dispatch → Control）                                    //
// ------------------------------------------------------------------------ //

export type CommunicationClaimCommand = AgentCommandIdentityBase & {
  commandId: string;
  commandType: "CommunicationClaimIntent";
  schemaVersion: 1;
  aggregateId: string;
  expectedRevision: number;
  payload: {
    workspaceId: string;
    consumerId: string;
    /** 领取租约时长（毫秒的十进制字符串；由调用方给定时钟）。 */
    leaseDurationMs: number;
    now: string;
  };
};

/**
 * 一次路由页的候选：Dispatch 只是**提议**，canonical 复核与写入在 Control。
 * 页内每一项都按 (source event, subscription) 唯一，重复提交同一页只 replay。
 */
export type RoutePageProposalV1 = {
  schemaVersion: 1;
  sourceTopic: string;
  sourceCursor: CommitCursor;
  /** 本页固定 horizon 内的订阅快照（按 subscriptionId 排序）。 */
  subscriptions: {
    subscriptionRef: SubscriptionRef;
    expectedRevision: number;
    /** 该订阅在本页应当获得的 deliveries（空表示该页对它是 no-op）。 */
    deliveries: {
      deliveryId: string;
      targetWorkContextRef: WorkContextRef;
      bodyRef: ArtifactRef | null;
      sourceRefs: { kind: string; refId: string; revision: string }[];
    }[];
    /** 页内对 wait 的条件推进（index 集合）。 */
    satisfiedWaitIndexes: { waitRef: WaitConditionRef; indexes: number[] }[];
  }[];
  /**
   * 本页处理到的**订阅分页位置**（最后一个被处理订阅的 canonical ref key；无订阅为 `null`）。
   * 同一事件的下一页必须**严格大于**本页值（按 canonical ref key 序）；回退或原地一律拒绝。
   * **注意**：这里的推进发生在**订阅维度**，不是事件位置维度 —— 同一事件翻页时
   * `sourceCursor` 保持不变（协议约束 1.4）。
   */
  subscriptionPosition: string | null;
  /**
   * **本轮固定的订阅范围**（整轮候选集合，按 canonical ref key 升序）。
   *
   * 为什么必须由生产者在提案里给出：协议约束 1.4 要求「本轮范围开始时确定、翻页期间不得改变」，
   * 而账本侧的范围规则（本页不得引入范围外订阅 / 续页范围逐字节相同 / hasMore 与下一页 intent
   * 一致）只有在范围**真的被固定**之后才有可依据的事实。只给本页切片是不够的：把切片当范围
   * 会把下一页的合法订阅判成范围外，所以准入规则刻意没有替生产者猜。
   *
   * 语义：
   *   - 首页（intent 的 subscriptionScope 还是空）→ 本字段就是**要固定的整轮范围**；
   *   - 续页（intent 已固定范围）→ 本字段必须与已固定的范围**逐字节相同**（回声）。
   *
   * 每一页都必填（不能省略），Control 逐条复核「订阅存在 + 处于活跃 + expectedRevision 与当前
   * 一致」，不一致即整页拒绝（零写入）。
   */
  subscriptionScope: RoutePageSubscriptionScopeEntry[];
  /** 本页是否还有剩余订阅（true = 还有下一页；末页必须为 false）。 */
  hasMore: boolean;
};

/**
 * **先持久化取消意图**的正式入口（desired-state-first，先记取消意图/协议约束 2.4）。
 *
 * 语义：把一条尚未终态的 intent 标记为「被要求取消」。它不发放新 generation，也不执行任何
 * 外部能力——执行能力的调用发生在**这之后**，且必须读到这条已落账的意图。
 */
export type RequestIntentCancellationCommand = AgentCommandIdentityBase & {
  commandId: string;
  commandType: "RequestCommunicationIntentCancellation";
  schemaVersion: 1;
  /** intentId。 */
  aggregateId: string;
  /** 当前 CommunicationIntent 的 expected revision（CAS）。 */
  expectedRevision: number;
  payload: {
    workspaceId: string;
    reason: string;
  };
};

export type CommunicationSettleCommand = AgentCommandIdentityBase & {
  commandId: string;
  commandType: "CommunicationSettleIntent";
  schemaVersion: 1;
  aggregateId: string;
  expectedRevision: number;
  payload:
    | { outcome: "architecture_delivery"; workspaceId:string; consumerId:string; leaseGeneration:number; settledAt:string }
    | {
        outcome: "catchup_page";
        workspaceId: string; consumerId: string; leaseGeneration: number; settledAt: string;
      }
    | {
        outcome: "route_page";
        workspaceId: string;
        consumerId: string;
        /** 领取时的 generation；过期 generation 不能 settle。 */
        leaseGeneration: number;
        page: RoutePageProposalV1;
        settledAt: string;
      }
    | {
        outcome: "wait_deadline";
        workspaceId: string;
        consumerId: string;
        leaseGeneration: number;
        waitRef: WaitConditionRef;
        observedStatus: "active";
        settledAt: string;
      }
    | {
        outcome: "cancel_confirmed";
        workspaceId: string;
        consumerId: string;
        leaseGeneration: number;
        settledAt: string;
      }
    | {
        outcome: "unknown";
        workspaceId: string;
        consumerId: string;
        leaseGeneration: number;
        reason: string;
        settledAt: string;
      }
    | {
        outcome: "quarantine";
        workspaceId: string;
        consumerId: string;
        leaseGeneration: number;
        reason: string;
        settledAt: string;
      }
    /**
     * **非终态**结果：这次尝试**已证实没有产生任何副作用**（例如执行能力不可用、提交被账本
     * 整批拒绝），因此允许进入退避重试——intent 回到 retry_scheduled，availableAt 推到
     * settledAt + backoffMs。
     *
     * 为什么必须补它：retry_scheduled 与退避在此之前**没有生产者**（协议只有终态 settle 结果），
     * 退避参数因此永远不可达。补上之后，「失败 → 退避 → 再领取」才是可达路径。
     *
     * 硬约束（Control 侧判定，违反即整批拒绝、零写入）：**只有 sideEffectStarted === false
     * 的 intent 才能进入它**。一旦这次尝试已经可能产生了外部副作用，结果不明就必须对账或隔离，
     * **不能**自动再调用一次（协议约束 2.4 / 外部副作用恢复）。
     */
    | {
        outcome: "no_effect_failure";
        workspaceId: string;
        consumerId: string;
        leaseGeneration: number;
        reason: string;
        /** 退避时长（毫秒，由调用方按确定性的退避算式给出）。 */
        backoffMs: number;
        settledAt: string;
      }
    /**
     * **非终态**结果：调用方**即将**调用执行能力（外部副作用已经「开始」）。
     *
     * 持久化它之后 intent 保持 leased 且 sideEffectStarted = true。用途只有一个：租约到期
     * **不再**等于可以重跑。此后领取被拒（requires_reconcile）必须对账；取消请求只能收敛为
     * outcome_unknown（不能声称「已确认取消」）；退避重试一律不允许。
     */
    | {
        outcome: "side_effect_started";
        workspaceId: string;
        consumerId: string;
        leaseGeneration: number;
        reason: string;
        settledAt: string;
      };
};

/**
 * 后继受理：等待满足 ∧ 前驱公开结束 ∧ 该 Work 有**当前有效参与关系**，在同一事务里创建
 * **恰好一个** TaskAttempt / Run / TaskOutbox 组合并登记 CommunicationAdmission。
 *
 * ── 归因：这是**调度触发**命令（协作通信参与身份裁决，参与身份规则）─────────────────────
 * 触发它的是协作驱动（Dispatch 侧机械推进），不是某一段参与里的模型调用。因此它必须用
 * `{kind: "system"}` 身份 + **来源关联**（correlationId/命令 id 派生自被触发的 wait 或
 * intent，payload 里同时给出 waitRef 与 predecessorRunRef）提交；用 agent principal 提交
 * 会被拒绝（`forbidden`）。理由是把**新参与者**与**旧 Run** 拼成同一个身份：后继 Run 此刻
 * 还不存在，能拿到的 agent principal 只可能属于前驱那一段，用它归因等于伪造 causation。
 * Agent 侧的命令（请求/回应/订阅/等待/参与）仍然按 AgentPrincipalRefV1 的精确 principal 归因。
 *
 * ── 参与关系与授权版本：由 Control 按**当前**事实复核（不是调用方说了算）──────────
 * `participationRef`/`agentInstanceId`/`roleBinding` 是调用方的**提议**，Control 逐字段与
 * Work 权威状态里的当前参与关系核对：不一致 → 拒绝（零写入）。等待注册时登记的那一段
 * 参与关系只是历史事实，**不**参与这里的资格判定。
 */
export type ReconcileCommunicationIntentCommand = AgentCommandIdentityBase & {
  commandId: string; commandType: 'ReconcileCommunicationIntent'; schemaVersion: 1;
  aggregateId: string; expectedRevision: number; payload: { workspaceId: string };
};

export type AdmitWaitSuccessorCommand = AgentCommandIdentityBase & {
  commandId: string;
  commandType: "AdmitWaitSuccessor";
  schemaVersion: 1;
  aggregateId: string;
  expectedRevision: number;
  payload: {
    /** One-attempt Host inspection capability, not a caller-supplied verdict. */
    reportObservationToken?: string;
    workspaceId: string;
    waitRef: WaitConditionRef;
    /** Mandatory when a durable admission intent exists; stale consumers cannot adopt another claim. */
    intentClaim?: { intentRef: CommunicationIntentRef; consumerId: string; leaseGeneration: number; revision: number };
    workContextRef: WorkContextRef;
    /** 本次采用的参与关系：必须 == 该 Work 的当前参与关系（且它 active）。 */
    participationRef: WorkParticipationRef;
    agentInstanceId: string;
    predecessorRunRef: RunRef;
    goalId: string;
    taskId: string;
    attemptId: string;
    runId: string;
    planRef: PlanRevisionRef;
    roleBinding: RoleBindingRefV1;
    declaredPermissions: { tools: string[]; writeScope: string[] };
    budget: TaskBudgetV1;
    workspaceRevision: number;
    /** 目标 Delivery 的精确版本（后继 Run 必须消费它们）。 */
    deliveryRefs: DeliveryRef[];
  };
};

/**
 * 「条件已满足但前驱仍在执行」时**幂等地**建立 wait_admission intent
 * （协作通信规则的 Control 命令）。
 *
 * 为什么这条判定必须在 Control 而不能在 Dispatch：判定需要两件 Dispatch 拿不到的 canonical
 * 事实——① wait 的每个条件是否已被 canonical Delivery/DirectedRequest 满足；
 * ② 前驱 RunSnapshot.status 是否仍不是 `ended`。Dispatch 只提议"请复核这个等待"，
 * 由 Control 读事实后决定**建不建** intent。
 *
 * 幂等：intentId 由 `waitAdmissionIntentIdFor(waitId, satisfiedRevision)` 确定性派生
 * （satisfiedRevision = 该 wait 当前 revision + 1，即"若现在接续，等待会落在哪个 revision"），
 * 已经存在即返回 `already_present`（零写入），不产生第二个 intent。
 * `payload.expectedRevision` 是调用方观察到的 wait revision：与当前不一致即
 * `revision_conflict`（零写入），避免按过期观察规划接续。
 */
export type EnsureWaitAdmissionCommand = AgentCommandIdentityBase & {
  commandId: string;
  commandType: "EnsureWaitAdmission";
  schemaVersion: 1;
  /** waitId。 */
  aggregateId: string;
  payload: {
    workspaceId: string;
    /** 调用方观察到的 WaitCondition 当前 revision（CAS 前的显式期望）。 */
    expectedRevision: number;
  };
};

export type EnsureWaitAdmissionReceipt =
  | {
      status: "committed";
      commandId: string;
      replayed: boolean;
      waitRef: WaitConditionRef;
      intentRef: CommunicationIntentRef;
      satisfiedRevision: number;
      eventIds: string[];
      commitCursor: CommitCursor;
    }
  /** 该 satisfiedRevision 的 wait_admission intent 已经存在：幂等命中，**零写入**。 */
  | { status: "already_present"; commandId: string; waitRef: WaitConditionRef; intentRef: CommunicationIntentRef; satisfiedRevision: number }
  /**
   * 现在还不需要接续 intent：**零写入**，调用方稍后重试。原因分开给出——
   * `conditions_unsatisfied`（条件尚未全部满足）、`predecessor_active` 的反面
   * `predecessor_ended`（前驱已经结束：这时该走 admitWaitSuccessor 的直接路径，
   * 不需要"前驱结束时复查"的 intent）、`wait_not_active`、`intent_terminal`。
   */
  | {
      status: "not_ready";
      commandId: string;
      waitRef: WaitConditionRef;
      code: "wait_not_active" | "conditions_unsatisfied" | "predecessor_ended" | "deadline_passed" | "intent_terminal";
    }
  | {
      status: "rejected";
      commandId: string;
      code: "invalid" | "not_found" | "forbidden" | "revision_conflict" | "idempotency_conflict" | "unavailable";
      issues?: string[];
      currentRevision?: number;
    };

// ------------------------------------------------------------------------ //
// Receipts                                                                  //
// ------------------------------------------------------------------------ //

export type CommunicationWriteReceipt =
  | {
      status: "committed";
      commandId: string;
      replayed: boolean;
      eventIds: string[];
      commitCursor: CommitCursor;
      revisions: { refKey: string; revision: number }[];
    }
  | {
      status: "rejected";
      commandId: string;
      code:
        | "invalid"
        | "not_found"
        | "forbidden"
        | "stale_participation"
        | "stale_binding"
        | "revision_conflict"
        | "idempotency_conflict"
        | "over_limit"
        | "unavailable";
      issues?: string[];
      currentRevision?: number;
    };

export type AdmitWaitSuccessorReceipt =
  | {
      status: "committed";
      commandId: string;
      replayed: boolean;
      waitRef: WaitConditionRef;
      admissionRef: CommunicationAdmissionRef;
      attemptRef: TaskAttemptRef;
      runRef: RunRef;
      eventIds: string[];
      commitCursor: CommitCursor;
    }
  /** 条件尚未全部满足、前驱仍在执行、或 deadline 已过：**零写入**，调用方稍后重试。 */
  | { status: "not_ready"; commandId: string; code: "conditions_unsatisfied" | "predecessor_active" | "deadline_passed" | "report_material_unavailable"; issues?: string[] }
  /**
   * 拒绝变体带可选 issues（与同族 CommunicationWriteReceipt / CommunicationSettleReceipt 一致）：
   * 后继受理有十来个拒绝分支，只给一个 code 会让调用方无法诊断「为什么没接续」。
   * 这是加法：既有 code 语义与既有分支形状不变（调用证据与参与语义规则）。
   *
   * 参与身份规则再追加三个 code（同样是加法，零写入语义不变）：
   *   - `no_active_participation`：该 Work 当前**没有有效参与关系**（从未受理过参与，或最近那一段
   *     已 ended）。等待保持 active、不被改写，但**不**产生后继：接续资格按**当前**参与关系判定，
   *     而不是按等待注册时那一段。换手（旧段结束 + 新段建立）之后同一等待仍可接续。
   *   - `forbidden`：归因不合法。后继受理是**调度触发**命令，必须用 system 身份 + 来源关联提交；
   *     用某一段参与的 agent principal（尤其把**新参与者**与**旧 Run**拼成一个身份）会被拒绝。
   *   - `no_admissible_permissions`（协议约束 2.2）：当前参与关系的 RoleBinding 规格与继承来的
   *     权限集**交集为空**，或该角色绑定本身不合格（角色未登记／规格过期／未安装／未激活）。
   *     一律零写入、等待保持 active、给出可读原因；**不**回退旧授权，也**不**临时放宽权限。
   */
  | { status: "rejected"; commandId: string; code: "invalid" | "forbidden" | "no_active_participation" | "no_admissible_permissions" | "not_found" | "revision_conflict" | "idempotency_conflict" | "unavailable"; issues?: string[]; currentRevision?: number };

export type CommunicationClaimReceipt =
  | {
      status: "claimed";
      commandId: string;
      intentRef: CommunicationIntentRef;
      leaseGeneration: number;
      leaseOwner: string;
      leaseExpiresAt: string;
      revision: number;
      replayed: boolean;
      commitCursor: CommitCursor;
    }
  | { status: "owned_elsewhere"; commandId: string; intentRef: CommunicationIntentRef; leaseOwner: string | null; leaseExpiresAt: string | null }
  | { status: "not_found"; commandId: string; intentRef: CommunicationIntentRef }
  /** 同 AdmitWaitSuccessorReceipt：拒绝原因随 issues 一起返回（加法，调用证据与参与语义规则）。 */
  | { status: "rejected"; commandId: string; code: "invalid" | "revision_conflict" | "idempotency_conflict" | "unavailable"; issues?: string[]; currentRevision?: number };

export type CommunicationSettleReceipt =
  | {
      status: "committed";
      commandId: string;
      replayed: boolean;
      intentRef: CommunicationIntentRef;
      intentStatus: CommunicationIntentStatus;
      deliveries: DeliveryRef[];
      nextIntentRef: CommunicationIntentRef | null;
      eventIds: string[];
      commitCursor: CommitCursor;
    }
  | { status: "stale_generation"; commandId: string; intentRef: CommunicationIntentRef; currentGeneration: number }
  | { status: "rejected"; commandId: string; code: "invalid" | "not_found" | "forbidden" | "revision_conflict" | "idempotency_conflict" | "unavailable"; issues?: string[]; currentRevision?: number };

// ------------------------------------------------------------------------ //
// Domain events                                                             //
// ------------------------------------------------------------------------ //

type CommunicationEventBase = {
  eventId: string;
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateRevision: number;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
};

export type AgentInstanceRegisteredEvent = CommunicationEventBase & {
  eventType: "AgentInstanceRegistered";
  aggregateType: "AgentInstance";
  aggregateRevision: 1;
  payload: { agent: AgentInstanceV1 };
};

export type WorkParticipationStartedEvent = CommunicationEventBase & {
  eventType: "WorkParticipationStarted";
  aggregateType: "WorkParticipation";
  aggregateRevision: 1;
  payload: { participation: WorkParticipationV1 };
};

export type WorkParticipationEndedEvent = CommunicationEventBase & {
  eventType: "WorkParticipationEnded";
  aggregateType: "WorkParticipation";
  aggregateRevision: number;
  payload: { participation: WorkParticipationV1 };
};

export type DirectedRequestSentEvent = CommunicationEventBase & {
  eventType: "DirectedRequestSent";
  aggregateType: "DirectedRequest";
  aggregateRevision: 1;
  payload: { request: DirectedRequestV1 };
};

export type DirectedRequestRespondedEvent = CommunicationEventBase & {
  eventType: "DirectedRequestResponded";
  aggregateType: "DirectedRequest";
  aggregateRevision: number;
  payload: { request: DirectedRequestV1 };
};

export type DirectedRequestCancelledEvent = CommunicationEventBase & {
  eventType: "DirectedRequestCancelled";
  aggregateType: "DirectedRequest";
  aggregateRevision: number;
  payload: { request: DirectedRequestV1 };
};

export type SubscriptionCreatedEvent = CommunicationEventBase & {
  eventType: "SubscriptionCreated";
  aggregateType: "Subscription";
  aggregateRevision: 1;
  payload: { subscription: SubscriptionV1 };
};

export type SubscriptionCancelledEvent = CommunicationEventBase & {
  eventType: "SubscriptionCancelled";
  aggregateType: "Subscription";
  aggregateRevision: number;
  payload: { subscription: SubscriptionV1 };
};

/**
 * 订阅的"从当前 frontier 开始"补齐（协作通信规则的契约加法）。
 *
 * 为什么需要它：`subscription-create` 只带**一个** route intent，而且只在 startCursor 非空时
 * 才有——startCursor 为 null（=「从现在起」）的订阅因此拿不到任何持久路由起点，Dispatch 也就
 * 没有可领取的 intent。本事件在订阅建立**之后**由 Control 按当前账本 frontier 与订阅 topic
 * 规划 1..N 个 route intent（N = topics 数量），并把订阅的 startCursor 锚定在该 frontier 上，
 * 使"订阅之前的事件不会被补投"成为可核对的事实。
 */
export type SubscriptionCatchupPlannedEvent = CommunicationEventBase & {
  eventType: "SubscriptionCatchupPlanned";
  aggregateType: "Subscription";
  aggregateRevision: number;
  payload: {
    subscription: SubscriptionV1;
    /** 规划时观察到的账本 frontier（null = 账本当时还没有任何事件）。 */
    frontierCursor: CommitCursor | null;
    /** 本事务为各 topic 建立的 route intent（按 topic 排序，1..N 条）。 */
    intents: CommunicationIntentV1[];
  };
};

export type SubscriptionCatchupAdvancedEvent = CommunicationEventBase & {
  eventType: "SubscriptionCatchupAdvanced"; aggregateType: "Subscription"; aggregateRevision: number;
  payload: { subscription: SubscriptionV1; intent: CommunicationIntentV1 };
};

export type DeliveryRecordedEvent = CommunicationEventBase & {
  eventType: "DeliveryRecorded";
  aggregateType: "Delivery";
  aggregateRevision: 1;
  payload: { delivery: DeliveryV1 };
};

export type WaitConditionRegisteredEvent = CommunicationEventBase & {
  eventType: "WaitConditionRegistered";
  aggregateType: "WaitCondition";
  aggregateRevision: 1;
  payload: { wait: WaitConditionV1 };
};

export type WaitConditionObservedEvent = CommunicationEventBase & {
  eventType: "WaitConditionObserved";
  aggregateType: "WaitCondition";
  aggregateRevision: number;
  payload: { wait: WaitConditionV1 };
};

export type WaitConditionSatisfiedEvent = CommunicationEventBase & {
  eventType: "WaitConditionSatisfied";
  aggregateType: "WaitCondition";
  aggregateRevision: number;
  payload: { wait: WaitConditionV1; admission: CommunicationAdmissionV1 };
};

export type WaitConditionTimedOutEvent = CommunicationEventBase & {
  eventType: "WaitConditionTimedOut";
  aggregateType: "WaitCondition";
  aggregateRevision: number;
  payload: { wait: WaitConditionV1 };
};

/** wait 观察与 intent settle 在同一事务时，快照集合是两者的并集。 */
export type CommunicationSettleSnapshot = CommunicationIntentSnapshot | WaitConditionSnapshot;

export type WaitConditionCancelledEvent = CommunicationEventBase & {
  eventType: "WaitConditionCancelled";
  aggregateType: "WaitCondition";
  aggregateRevision: number;
  payload: { wait: WaitConditionV1 };
};

export type CommunicationIntentRecordedEvent = CommunicationEventBase & {
  eventType: "CommunicationIntentRecorded";
  aggregateType: "CommunicationIntent";
  aggregateRevision: 1;
  payload: { intent: CommunicationIntentV1 };
};

/**
 * **先持久化取消意图**（协议约束 2.4 / 先记取消意图的 desired-state-first）。
 *
 * 它**不是**终态：intent 只是被标记为「被要求取消」，真正的取消确认（或「无法确认」）由消费者
 * 在拿到当前 generation 之后按规定收敛。这样「取消意图」与「执行能力」之间有明确的先后：
 * 取消意图先落账，任何后续的执行或收敛都必须先读到它。
 */
export type CommunicationIntentCancelRequestedEvent = CommunicationEventBase & {
  eventType: "CommunicationIntentCancelRequested";
  aggregateType: "CommunicationIntent";
  aggregateRevision: number;
  payload: { intent: CommunicationIntentV1; reason: string };
};

export type CommunicationIntentClaimedEvent = CommunicationEventBase & {
  eventType: "CommunicationIntentClaimed";
  aggregateType: "CommunicationIntent";
  aggregateRevision: number;
  payload: { intent: CommunicationIntentV1; priorGeneration: number };
};

export type CommunicationIntentSettledEvent = CommunicationEventBase & {
  eventType: "CommunicationIntentSettled";
  aggregateType: "CommunicationIntent";
  aggregateRevision: number;
  payload: { intent: CommunicationIntentV1 };
};

export type CommunicationAdmissionRecordedEvent = CommunicationEventBase & {
  eventType: "CommunicationAdmissionRecorded";
  aggregateType: "CommunicationAdmission";
  aggregateRevision: 1;
  payload: { admission: CommunicationAdmissionV1; manifest: ContextManifestV1 };
};

export type CoordinationRegistryUpdatedEvent = CommunicationEventBase & {
  eventType: "CoordinationRegistryUpdated";
  aggregateType: "CoordinationRegistry";
  aggregateRevision: number;
  payload: { registry: CoordinationRegistryV1 };
};

export type WorkMailboxUpdatedEvent = CommunicationEventBase & {
  eventType: "WorkMailboxUpdated";
  aggregateType: "WorkMailbox";
  aggregateRevision: number;
  payload: { mailbox: WorkMailboxV1 };
};

export type CommunicationDomainEvent =
  | AgentInstanceRegisteredEvent
  | WorkParticipationStartedEvent
  | WorkParticipationEndedEvent
  | DirectedRequestSentEvent
  | DirectedRequestRespondedEvent
  | DirectedRequestCancelledEvent
  | SubscriptionCreatedEvent
  | SubscriptionCancelledEvent
  | SubscriptionCatchupPlannedEvent
  | SubscriptionCatchupAdvancedEvent
  | DeliveryRecordedEvent
  | WaitConditionRegisteredEvent
  | WaitConditionObservedEvent
  | WaitConditionSatisfiedEvent
  | WaitConditionTimedOutEvent
  | WaitConditionCancelledEvent
  | CommunicationIntentRecordedEvent
  | CommunicationIntentClaimedEvent
  | CommunicationIntentSettledEvent
  | CommunicationIntentCancelRequestedEvent
  | CommunicationAdmissionRecordedEvent
  | CoordinationRegistryUpdatedEvent
  | WorkMailboxUpdatedEvent;

// ------------------------------------------------------------------------ //
// Ledger commit 形状                                                         //
// ------------------------------------------------------------------------ //

/**
 * **源事件提交时同事务登记的待路由 intent 计划**（协议约束 1.4 的持续生产者）。
 *
 * ── 为什么需要它 ─────────────────────────────────────────────────────────────
 * 「可路由事件与待路由 intent 同事务登记」要求源事件提交的那一刻就有一个持久的路由触发器，
 * 否则事件与 intent 之间会留下「事件已落账但没有任何消费者能发现它」的窗口（重启即漏投）。
 *
 * ── 为什么带计划而不是直接带 intent ──────────────────────────────────────────
 * CommitCursor 是**账本在追加事件时赋予**的位置，Control 在构造提交时拿不到它（先读后写会让
 * 两条并发的同 topic 事件争同一个确定性 intentId，把合法提交判成冲突）。因此：
 *   - Control 只声明**源事件在本批事件里的类型**（anchor）与整轮候选集合（scope）；
 *   - **账本**在同一个事务里按 anchor 在本次追加序列中的位置算出 sourceCursor，用与协议同一个
 *     算式（routePageIntentIdFor）派生 intentId，并补写 CommunicationIntentRecorded 事件 +
 *     CommunicationIntentSnapshot@1 + 对应 CAS@0。
 * 计划与源事件因此**原子**：提交被拒时两者都不落账，提交成功时两者一起可见。
 *
 * 该字段是**可选**的：没有可路由订阅的提交（scope 为空）不登记任何计划，既有提交形状与语义不变。
 */
export type RouteIntentPlanV1 = {
  schemaVersion: 1;
  /** 源事件在本批事件里的类型（账本取**第一个**该类型事件的位置作为源事件位置）。 */
  anchorEventType: string;
  /** 路由 topic（路由词表 communicationTopicOf 的封闭取值，等于 anchorEventType）。 */
  topic: string;
  /** 本轮固定的订阅范围（整轮候选集合，按 canonical ref key 升序）。 */
  subscriptionScope: RoutePageSubscriptionScopeEntry[];
  /** 计划建立时刻（账本没有时钟，由 Control 的时钟给出）。 */
  plannedAt: string;
  /** New source producers ask the ledger transaction to fix the current canonical member set. */
  scopeMode?: "canonical_active";
};

type CommunicationCommitBase = {
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  expectedVersions: { ref: import("./ledger.js").AggregateRef; revision: number }[];
  outboxIntents: [];
  /** 见 RouteIntentPlanV1：源事件提交时同事务登记的待路由 intent。 */
  routeIntentPlans?: RouteIntentPlanV1[];
};

/** agent-instance-register：一条不可变 AgentInstance（CAS@0）。 */
export type AgentInstanceRegisterCommitV1 = CommunicationCommitBase & {
  commitKind: "agent-instance-register";
  events: [AgentInstanceRegisteredEvent];
  snapshots: [AgentInstanceSnapshot];
};

/**
 * participation-start：参与关系 @1（CAS@0）+ **同一事务**把发起 Run link 到该 Work。
 *
 * 为什么必须同事务：参与关系一旦成立，参与关系与换手要求"该 Agent 的这次 Run 确实属于这个
 * Work"可重建；分成两次提交会留下"参与已生效但 Run 未 link"的中间态，重启后无法判定。
 */
export type InitialParticipationStartCommitV1 = Omit<ParticipationStartCommitV1,'commitKind'> & {commitKind:'initial-participation-start';command:StartWorkParticipationCommand};

export type ParticipationStartCommitV1 = CommunicationCommitBase & {
  commitKind: "participation-start";
  events: (WorkParticipationStartedEvent | import("./context-continuity.js").WorkRunLinkedEvent)[];
  snapshots: (WorkParticipationSnapshot | import("./context-continuity.js").WorkContextBindingSnapshot)[];
};

/**
 * participation-end：参与关系结束（CAS@N）；历史保留，不改名不删除。
 *
 * 协作通信可靠投递规则：WorkParticipationEnded 是**可路由源事件**（communicationTopicOf），
 * 因此这次提交可以同事务带上源事件触发的待路由 intent（routeIntentPlans → 账本补写
 * CommunicationIntentRecorded + CommunicationIntentSnapshot@1）。
 */
export type ParticipationEndCommitV1 = CommunicationCommitBase & {
  commitKind: "participation-end";
  events: (WorkParticipationEndedEvent | CommunicationIntentRecordedEvent)[];
  snapshots: (WorkParticipationSnapshot | WorkMailboxSnapshot | CommunicationIntentSnapshot)[];
};

/** directed-request-send：请求 @1 + 首个 route intent + 有界时同事务的首个 Delivery。 */
export type DirectedRequestSendCommitV1 = CommunicationCommitBase & {
  commitKind: "directed-request-send";
  events: [DirectedRequestSentEvent, ...DeliveryRecordedEvent[]];
  snapshots: (DirectedRequestSnapshot | DeliverySnapshot | CommunicationIntentSnapshot)[];
};

/**
 * directed-request-respond：回应正文登记（CAS@N）。
 *
 * 协作通信可靠投递规则：DirectedRequestResponded 同样是**可路由源事件**，因此回应登记可以与
 * 它触发的待路由 intent 同事务（见 RouteIntentPlanV1）。
 */
export type DirectedRequestRespondCommitV1 = CommunicationCommitBase & {
  commitKind: "directed-request-respond";
  events: [DirectedRequestRespondedEvent, ...CommunicationIntentRecordedEvent[]];
  snapshots: (DirectedRequestSnapshot | CommunicationIntentSnapshot)[];
};

/** directed-request-cancel：desired-state 取消（CAS@N）。 */
export type DirectedRequestCancelCommitV1 = CommunicationCommitBase & {
  commitKind: "directed-request-cancel";
  events: [DirectedRequestCancelledEvent];
  snapshots: [DirectedRequestSnapshot];
};

/** subscription-create：订阅 @1 + 首个 route intent（CAS@0）。 */
export type SubscriptionCreateCommitV1 = CommunicationCommitBase & {
  commitKind: "subscription-create";
  events: (SubscriptionCreatedEvent | CommunicationIntentRecordedEvent)[];
  snapshots: (SubscriptionSnapshot | CommunicationIntentSnapshot)[];
};

/** subscription-cancel：desired-state 取消（CAS@N）。 */
export type SubscriptionCatchupPageCommitV1 = CommunicationCommitBase & {
  commitKind: "subscription-catchup-page";
  events: (SubscriptionCatchupAdvancedEvent | DeliveryRecordedEvent | CommunicationIntentSettledEvent | WaitConditionObservedEvent)[];
  snapshots: (SubscriptionSnapshot | DeliverySnapshot | CommunicationIntentSnapshot | WaitConditionSnapshot)[];
};

export type SubscriptionCancelCommitV1 = CommunicationCommitBase & {
  commitKind: "subscription-cancel";
  events: [SubscriptionCancelledEvent];
  snapshots: [SubscriptionSnapshot];
};

/**
 * subscription-catchup：订阅快照 @(expected+1) + 1..N 个 `CommunicationIntentSnapshot@1`。
 *
 * 与 subscription-create 分开提交的原因（不合并、也不重复用 subscription-create）：
 *   - 订阅本身（@1）是"某 Work 声明了对某些 topic 的兴趣"，与"从哪个位置开始路由"是两件事；
 *   - frontier 只有在订阅已经落账之后才可读（本事务是第二个提交），把它塞进 create 会让
 *     create 的 CAS 依赖一个尚未存在的事实；
 *   - 形状固定为「订阅快照 + 1..N 个 intent」，因此"补齐没补齐"可以从账本形状直接判定。
 */
export type SubscriptionCatchupCommitV1 = CommunicationCommitBase & {
  commitKind: "subscription-catchup";
  events: [SubscriptionCatchupPlannedEvent, ...CommunicationIntentRecordedEvent[]];
  snapshots: [SubscriptionSnapshot, ...CommunicationIntentSnapshot[]];
};

/** wait-register：等待 @1，或（条件已满足且前驱已结束）@1 直接 satisfied。 */
export type WaitRegisterCommitV1 = CommunicationCommitBase & {
  commitKind: "wait-register";
  /** 同一事务建立的 intent（deadline）也必须带 CommunicationIntentRecorded：intent 的存在是 canonical 事实。 */
  events: (WaitConditionRegisteredEvent | WaitConditionObservedEvent | CommunicationIntentRecordedEvent)[];
  snapshots: (WaitConditionSnapshot | CommunicationIntentSnapshot)[];
};

/** wait-cancel：desired-state 取消（CAS@N）。 */
export type WaitCancelCommitV1 = CommunicationCommitBase & {
  commitKind: "wait-cancel";
  events: (WaitConditionCancelledEvent | CommunicationIntentSettledEvent)[];
  snapshots: (WaitConditionSnapshot | CommunicationIntentSnapshot)[];
};

/**
 * communication-intent-record：**单独**登记一个机械 intent（CAS@0），不带业务聚合推进。
 *
 * 为什么需要它：`ensureWaitAdmission` 建立的 wait_admission intent 与任何业务聚合的转移都不同事务
 * （"条件已满足但前驱仍在执行"本身不改变 wait 的值，只登记一个复查触发器）。协议里既有的
 * communication-intent-claim / -settle / route-page 都需要一条已存在的 intent 或页数据，
 * subscription-catchup 又绑定订阅形状，因此这里只补一个最小的、形状可被通用校验覆盖的记录提交。
 */
export type CommunicationIntentRecordCommitV1 = CommunicationCommitBase & {
  commitKind: "communication-intent-record";
  events: [CommunicationIntentRecordedEvent];
  snapshots: [CommunicationIntentSnapshot];
};

/**
 * communication-intent-cancel-request：**先持久化取消意图**（CAS@N，generation 不变）。
 *
 * 为什么不能与「取消确认」合并：取消请求可以在 intent 未领取、已领取、甚至已产生副作用时到达，
 * 三种情形的处置不同（确认取消 / 先执行能力再确认 / 无法确认）。压成一条命令会让
 * 「已确认取消」与「还没确认」不可区分。
 */
export type CommunicationIntentCancelRequestCommitV1 = CommunicationCommitBase & {
  commitKind: "communication-intent-cancel-request";
  events: [CommunicationIntentCancelRequestedEvent];
  snapshots: [CommunicationIntentSnapshot];
};

/** communication-intent-claim：机械领取（CAS@N + generation）。 */
export type CommunicationIntentClaimCommitV1 = CommunicationCommitBase & {
  commitKind: "communication-intent-claim";
  events: [CommunicationIntentClaimedEvent];
  snapshots: [CommunicationIntentSnapshot];
};

/** communication-route-page：一页的 Deliveries + checkpoint + wait transition + next intent + settle，**同一 CAS**。 */
export type CommunicationRoutePageCommitV1 = CommunicationCommitBase & {
  commitKind: "communication-route-page";
  events: (DeliveryRecordedEvent | CommunicationDomainEvent)[];
  snapshots: (
    | CommunicationIntentSnapshot
    | DeliverySnapshot
    | SubscriptionSnapshot
    | WaitConditionSnapshot
  )[];
};

/** communication-intent-settle：非页面的 settle（cancel 确认 / unknown / quarantine / deadline）。 */
export type CommunicationIntentSettleCommitV1 = CommunicationCommitBase & {
  commitKind: "communication-intent-settle";
  events: (CommunicationIntentSettledEvent | CommunicationDomainEvent)[];
  snapshots: (CommunicationIntentSnapshot | WaitConditionSnapshot)[];
};

export type CommunicationIntentReconcileCommitV1 = Omit<CommunicationIntentSettleCommitV1, 'commitKind'> & {
  commitKind: 'communication-intent-reconcile';
};

/** communication-successor-claim：唯一后继 TaskAttempt/Run/outbox + admission（**唯一**调度记录）。 */
export type CommunicationSuccessorClaimCommitV1 = {
  commitKind: "communication-successor-claim";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  expectedVersions: { ref: import("./ledger.js").AggregateRef; revision: number }[];
  events: [
    import("./dispatch.js").TaskClaimedEvent,
    WaitConditionSatisfiedEvent,
    CommunicationAdmissionRecordedEvent,
    ...(CommunicationIntentSettledEvent | CommunicationIntentRecordedEvent)[],
  ];
  snapshots: [
    TaskLeaseSnapshot,
    TaskAttemptSnapshot,
    RunSnapshot,
    DispatchOutboxEntrySnapshot,
    WaitConditionSnapshot,
    CommunicationAdmissionSnapshot,
    ...CommunicationIntentSnapshot[],
  ];
  outboxIntents: [import("./dispatch.js").DispatchIntentV1];
  /**
   * 协作通信可靠投递规则：WaitConditionSatisfied 是可路由源事件，这次提交可以同事务带上它触发的
   * 待路由 intent（见 RouteIntentPlanV1）。带上计划时账本会补写 CommunicationIntentRecorded +
   * CommunicationIntentSnapshot@1，并相应放宽本提交的形状校验（只放行这一条事件与这一个快照）。
   */
  routeIntentPlans?: RouteIntentPlanV1[];
};

export type CommunicationLedgerCommit =
  | AgentInstanceRegisterCommitV1
  | InitialParticipationStartCommitV1
  | ParticipationStartCommitV1
  | ParticipationEndCommitV1
  | DirectedRequestSendCommitV1
  | DirectedRequestRespondCommitV1
  | DirectedRequestCancelCommitV1
  | SubscriptionCreateCommitV1
  | SubscriptionCatchupPageCommitV1
  | SubscriptionCancelCommitV1
  | SubscriptionCatchupCommitV1
  | WaitRegisterCommitV1
  | WaitCancelCommitV1
  | CommunicationIntentRecordCommitV1
  | CommunicationIntentCancelRequestCommitV1
  | CommunicationIntentClaimCommitV1
  | CommunicationRoutePageCommitV1
  | CommunicationIntentSettleCommitV1
  | CommunicationIntentReconcileCommitV1
  | CommunicationSuccessorClaimCommitV1;

export const COMMUNICATION_COMMIT_KINDS = [
  "agent-instance-register",
  "initial-participation-start",
  "participation-start",
  "participation-end",
  "directed-request-send",
  "directed-request-respond",
  "directed-request-cancel",
  "subscription-create",
  "subscription-cancel",
  "subscription-catchup",
  "subscription-catchup-page",
  "wait-register",
  "wait-cancel",
  "communication-intent-record",
  "communication-intent-cancel-request",
  "communication-intent-claim",
  "communication-route-page",
  "communication-intent-settle",
  "communication-intent-reconcile",
  "communication-successor-claim",
] as const;

// ------------------------------------------------------------------------ //
// Pure helpers                                                              //
// ------------------------------------------------------------------------ //

/** 邮箱快照：参与关系与换手的可重建关系（纯读，不写状态）。 */
export type MailboxViewV1 = {
  workContextRef: WorkContextRef;
  participations: WorkParticipationSnapshot[];
  requests: DirectedRequestSnapshot[];
  subscriptions: SubscriptionSnapshot[];
  waits: WaitConditionSnapshot[];
  deliveries: DeliverySnapshot[];
};

/** Delivery 的唯一键（页内幂等的权威依据）。 */
export function deliveryDedupeKey(delivery: DeliveryV1): string {
  if(delivery.origin.kind === "architecture_decision") return canonicalJson(["architecture-decision-delivery-v1",delivery.origin.reviewRef,delivery.origin.reviewRevision,delivery.targetWorkContextRef]);
  if (delivery.origin.kind === "directed_request") {
    return canonicalJson(["delivery-v1", canonicalJson(delivery.origin.requestRef), canonicalJson(delivery.targetWorkContextRef)]);
  }
  return canonicalJson([
    "delivery-v1",
    canonicalJson(delivery.origin.subscriptionRef),
    String(delivery.origin.sourceCursor),
    canonicalJson(delivery.targetWorkContextRef),
  ]);
}

export function communicationIntentRefKey(ref: CommunicationIntentRef): string {
  return canonicalJson(ref);
}

// ------------------------------------------------------------------------ //
// Fingerprints                                                              //
// ------------------------------------------------------------------------ //

function sha(shape: unknown): CommandFingerprint {
  return sha256Hex(canonicalJson(shape as never)) as CommandFingerprint;
}

function identityShape(identity: CommandIdentity): unknown {
  return {
    projectId: identity.projectId,
    actor: identity.actor,
    idempotencyKey: identity.idempotencyKey,
    ...(identity.agentPrincipal === undefined ? {} : { agentPrincipal: identity.agentPrincipal }),
  };
}

export function registerAgentInstanceFingerprint(command: RegisterAgentInstanceCommand): CommandFingerprint {
  return sha({ schemaVersion: 1, commandType: command.commandType, identity: identityShape(command.identity), aggregateId: command.aggregateId, expectedRevision: command.expectedRevision, payload: command.payload });
}

export function startWorkParticipationFingerprint(command: StartWorkParticipationCommand): CommandFingerprint {
  return sha({ schemaVersion: 1, commandType: command.commandType, identity: identityShape(command.identity), aggregateId: command.aggregateId, expectedRevision: command.expectedRevision, payload: command.payload });
}

export function endWorkParticipationFingerprint(command: EndWorkParticipationCommand): CommandFingerprint {
  return sha({ schemaVersion: 1, commandType: command.commandType, identity: identityShape(command.identity), aggregateId: command.aggregateId, expectedRevision: command.expectedRevision, payload: command.payload });
}

export function sendDirectedRequestFingerprint(command: SendDirectedRequestCommand): CommandFingerprint {
  return sha({ schemaVersion: 1, commandType: command.commandType, identity: identityShape(command.identity), aggregateId: command.aggregateId, expectedRevision: command.expectedRevision, payload: command.payload });
}

export function subscribeFingerprint(command: SubscribeCommand): CommandFingerprint {
  return sha({ schemaVersion: 1, commandType: command.commandType, identity: identityShape(command.identity), aggregateId: command.aggregateId, expectedRevision: command.expectedRevision, payload: command.payload });
}

export function registerWaitFingerprint(command: RegisterWaitCommand): CommandFingerprint {
  return sha({ schemaVersion: 1, commandType: command.commandType, identity: identityShape(command.identity), aggregateId: command.aggregateId, expectedRevision: command.expectedRevision, payload: command.payload });
}

export function respondDirectedRequestFingerprint(command: RespondDirectedRequestCommand): CommandFingerprint {
  return sha({ schemaVersion: 1, commandType: command.commandType, identity: identityShape(command.identity), aggregateId: command.aggregateId, expectedRevision: command.expectedRevision, payload: command.payload });
}

export function cancelCommunicationFingerprint(command: CancelCommunicationCommand): CommandFingerprint {
  return sha({ schemaVersion: 1, commandType: command.commandType, identity: identityShape(command.identity), aggregateId: command.aggregateId, expectedRevision: command.expectedRevision, payload: command.payload });
}

export function communicationClaimFingerprint(command: CommunicationClaimCommand): CommandFingerprint {
  return sha({ schemaVersion: 1, commandType: command.commandType, identity: identityShape(command.identity), aggregateId: command.aggregateId, expectedRevision: command.expectedRevision, payload: { workspaceId: command.payload.workspaceId, consumerId: command.payload.consumerId, leaseDurationMs: command.payload.leaseDurationMs, now: command.payload.now } });
}

export function requestIntentCancellationFingerprint(command: RequestIntentCancellationCommand): CommandFingerprint {
  return sha({ schemaVersion: 1, commandType: command.commandType, identity: identityShape(command.identity), aggregateId: command.aggregateId, expectedRevision: command.expectedRevision, payload: command.payload });
}

export function communicationSettleFingerprint(command: CommunicationSettleCommand): CommandFingerprint {
  return sha({ schemaVersion: 1, commandType: command.commandType, identity: identityShape(command.identity), aggregateId: command.aggregateId, expectedRevision: command.expectedRevision, payload: command.payload });
}

export function admitWaitSuccessorFingerprint(command: AdmitWaitSuccessorCommand): CommandFingerprint {
  const payload = { ...command.payload };
  delete payload.reportObservationToken;
  return sha({ schemaVersion: 1, commandType: command.commandType, identity: identityShape(command.identity), aggregateId: command.aggregateId, expectedRevision: command.expectedRevision, payload });
}

export function ensureWaitAdmissionFingerprint(command: EnsureWaitAdmissionCommand): CommandFingerprint {
  return sha({ schemaVersion: 1, commandType: command.commandType, identity: identityShape(command.identity), aggregateId: command.aggregateId, payload: command.payload });
}

/** 后继 TaskAttempt 的稳定 attemptId（同 wait + satisfiedRevision 永远同一 id）。 */
export function successorAttemptIdFor(workId: string, waitId: string, satisfiedRevision: number): string {
  return "succ-" + sha256Hex(canonicalJson(["successor-attempt-v1", workId, waitId, satisfiedRevision])).slice(0, 24);
}

/** 后继 Run 的稳定 runId。 */
export function successorRunIdFor(attemptId: string): string {
  return "run-" + sha256Hex(canonicalJson(["successor-run-v1", attemptId])).slice(0, 24);
}

/** 路由页 intent 的稳定 intentId（同 sourceCursor 永远同一 id）。 */
export function routePageIntentIdFor(projectId: string, workspaceId: string, sourceTopic: string, sourceCursor: CommitCursor): string {
  return "route-" + sha256Hex(canonicalJson(["route-page-intent-v1", projectId, workspaceId, sourceTopic, String(sourceCursor)])).slice(0, 24);
}

/** wait deadline intent 的稳定 intentId。 */
export function waitDeadlineIntentIdFor(waitId: string): string {
  return "wdeadline-" + sha256Hex(canonicalJson(["wait-deadline-intent-v1", waitId])).slice(0, 24);
}

/** wait admission intent 的稳定 intentId（条件满足但前驱未结束时建立）。 */
export function waitAdmissionIntentIdFor(waitId: string, satisfiedRevision: number): string {
  return "wadmit-" + sha256Hex(canonicalJson(["wait-admission-intent-v1", waitId, satisfiedRevision])).slice(0, 24);
}

export type { TaskEnvelopeV1 };

/** A single canonical interpretation of routable facts, shared by readers and validators. */
export function communicationSource(event: import('./events.js').DomainEvent, cursor: CommitCursor) {
  if (event.eventType !== 'DirectedRequestSent' && event.eventType !== 'DirectedRequestResponded' && event.eventType !== 'WorkParticipationEnded' && event.eventType !== 'WaitConditionSatisfied') return null;
  let bodyRef: ArtifactRef | null = null;
  let sourceRefs: DeliveryV1['sourceRefs'] = [];
  let requestRef: DirectedRequestRef | null = null;
  if (event.eventType === 'DirectedRequestSent' || event.eventType === 'DirectedRequestResponded') {
    const request = event.payload.request;
    requestRef = directedRequestRefFor(request.projectId, request.workspaceId, request.requestId);
    bodyRef = event.eventType === 'DirectedRequestSent' ? request.statementBodyRef : request.response?.bodyRef ?? null;
    sourceRefs = event.eventType === 'DirectedRequestSent'
      ? [{ kind: 'directed-request', refId: request.requestId, revision: '1' }] : request.response?.sourceRefs ?? [];
  }
  return { topic: event.eventType, cursor, projectId: event.projectId, workspaceId: event.workspaceId, bodyRef, sourceRefs, requestRef };
}
export function subscriptionDeliveryIdFor(input: {
  subscriptionRef: SubscriptionRef; topic: string; cursor: CommitCursor; targetWorkContextRef: WorkContextRef;
}): string {
  return 'deliv-' + sha256Hex(canonicalJson(['subscription-delivery-v1', canonicalJson(input.subscriptionRef),
    input.topic, String(input.cursor), canonicalJson(input.targetWorkContextRef)])).slice(0, 24);
}
export function subscriptionCatchupIdFor(ref: SubscriptionRef): string { return 'catchup-' + sha256Hex(canonicalJson(ref)).slice(0, 32); }
/** Prefix is read from the ledger, never supplied by a model or an execution consumer. */
export function selectCatchupPrefix(domain: Extract<CommunicationIntentDomain, {kind: 'subscription_catchup'}>,
  subscription: SubscriptionV1, events: import('./ledger.js').PositionedEvent[]) {
  let cursor = domain.scanCursor;
  for (const row of events) {
    if (String(row.cursor) <= String(cursor)) throw Error('Catchup prefix is not strictly ordered');
    if (String(row.cursor) > String(domain.horizonCursor)) break;
    cursor = row.cursor;
    const source = communicationSource(row.event, row.cursor);
    if (subscription.status === 'active' && source && source.projectId === subscription.projectId &&
        source.workspaceId === subscription.workspaceId && subscription.topics.includes(source.topic)) return { cursor, source };
    if (cursor === domain.horizonCursor) break;
  }
  if (cursor === domain.scanCursor) throw Error('Catchup could not read its committed prefix');
  return { cursor, source: null };
}
