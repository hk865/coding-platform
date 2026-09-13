/**
 * 协调 Host 工具的**窄端口**（CM-1A-001 第 3 工作段，D03）。
 *
 * 权威边界（这是本文件存在的理由）：
 *   1. **身份由宿主绑定**。工具 Adapter 从**当前 Run 的 exact principal**（canonical 派生：
 *      agentInstanceId / workContextRef / participationRef / roleBinding / runRef）取得身份；
 *      模型提供的参数里**没有**这些字段，schema 是 strict 的，因此模型既不能填写、也不能覆盖。
 *   2. **正文 body-first，受理才算成功**。每一次调用都是"先把正文存进 ArtifactVault，
 *      再经 Control 的正式写入口提交"，只有拿到 Control 的提交回执才允许向模型报告
 *      accepted。**绝不**先回 "ok" 再补交。
 *   3. 本端口只描述"工具做什么"，不描述"谁实现"。实现由组合根注入（产品实现见
 *      src/control/dispatch-engine/coordination-tool-access.ts），工具定义见
 *      src/execution/worker-runtime/coordination-tools.ts。它不是第二个 Control 写入口，
 *      也不产生第二份 canonical 状态。
 */
import type { WorkContextRef } from './context-continuity.js';
import type { RoleBindingRefV1, RunRef } from './dispatch.js';
import type {
  AgentPrincipalRefV1,
  DeliverySnapshot,
  DirectedRequestSnapshot,
  SubscriptionSnapshot,
  WaitConditionRef,
  WaitConditionSnapshot,
  WorkParticipationRef,
} from './coordination.js';

/**
 * **独立的协调能力标识**（协议约束 2.3）。
 *
 * 它是宿主对"这个 Run 可以发起协调通信"的显式声明，**不是** workspace_read、
 * 也**不是** 文件写入/shell 权限：协调能力只允许登记请求/报告/订阅/等待，不带动任何
 * 工作区读写或进程能力。工具名、内核策略里的宿主授权名单、以及运行记录里的授予依据
 * 都由它派生，因此不存在"用只读或文件写权限冒充协调能力"的路径。
 */
export const COORDINATION_CAPABILITY_ID = 'coordination' as const;
export type CoordinationCapabilityId = typeof COORDINATION_CAPABILITY_ID;

/**
 * 一个 Run 被授予协调能力时的**依据**：指向账本里**已经存在**的 canonical 事实。
 *
 * 它不是新的授权来源，也不自证：
 *   · `work_current_participation` = **该 Run 所属 Work 的 `currentParticipationRef`** 指向的参与关系
 *     （Work 权威状态上的当前参与指针，由 `participation-start` 与参与关系快照同事务写入），
 *     且该参与关系仍 active、该 Run link 在这个 Work 上；
 *   · `communication_admission` = 该 Run 是某个接续受理记录创建的后继 Run（依据是受理里**固定的**
 *     `participationRef` 与那次受理本身）。
 *
 * 刻意不用"唯一一段 active 参与关系"这类过程式判据：换手、跨 Work、多段参与下它会含糊；
 * 换手之后旧参与关系不再是"当前"，旧 Run 因此不再被授予（协议 2.2 不自动继承旧授权）。
 */
export type CoordinationCapabilityBasisV1 =
  /**
   * 普通 Run：依据是**该 Run 所属 Work 的 `currentParticipationRef`**（Work 权威状态上"当前被受理的
   * 参与关系"，由 `participation-start` 与参与关系快照同事务写入），且该参与关系仍 active、
   * 该 Run link 在这个 Work 上。
   *
   * 为什么不用"唯一一段 active 参与关系"这种过程式判据：换手、跨 Work、多段参与下它含糊，
   * 而 currentParticipationRef 是 Work 上唯一、显式、可复核的权威指针。
   */
  | { kind: 'work_current_participation'; workContextRef: WorkContextRef; participationRef: WorkParticipationRef }
  /** 后继 Run：依据是接续受理记录里**固定的**那份参与关系（admission.participationRef）。 */
  | { kind: 'communication_admission'; waitRef: WaitConditionRef; participationRef: WorkParticipationRef };

/** 宿主在执行前解析出来的**协调能力授予**。 */
export type CoordinationCapabilityGrantV1 = {
  schemaVersion: 1;
  capability: CoordinationCapabilityId;
  runRef: RunRef;
  workContextRef: WorkContextRef;
  participationRef: WorkParticipationRef;
  agentInstanceId: string;
  roleBinding: RoleBindingRefV1;
  basis: CoordinationCapabilityBasisV1;
};

/**
 * 执行前的**准入判定**（协议约束 2.3）：宿主必须明确授予才能装配工具。
 * `not_granted` 一律带可读原因；未授予时既不装配工具、也不向内核声明能力（fail-closed）。
 */
export type CoordinationCapabilityDecisionV1 =
  | { status: 'granted'; capability: CoordinationCapabilityId; grant: CoordinationCapabilityGrantV1 }
  | { status: 'not_granted'; capability: CoordinationCapabilityId; reason: string };

/**
 * 宿主交给运行入口的**协调能力声明**（协议约束 2.3）：授予 + 该授予下的访问面。
 *
 * 关键性质：访问面**只能**作为 `granted` 的一部分出现——运行入口无法"只注入工具、不带授予"，
 * 因此"未授予却能用工具"在类型上就不可表达。`not_granted` 带可读原因，供宿主如实报告。
 */
export type CoordinationRuntimeGrantV1 =
  | {
      status: 'granted';
      capability: CoordinationCapabilityId;
      grant: CoordinationCapabilityGrantV1;
      /** 该授予下的正式受理面（正文 body-first，回执才算成功）。 */
      access: CoordinationToolAccessPort;
    }
  | { status: 'not_granted'; capability: CoordinationCapabilityId; reason: string };

/** 五类模型可见的协调操作。 */
export type CoordinationToolOperationV1 = 'request' | 'respond' | 'subscribe' | 'wait' | 'cancel';

/** 一次工具调用产生的**精确引用**（模型据此在后续调用里引用同一对象）。 */
export type CoordinationToolReferenceV1 = {
  kind: 'DirectedRequest' | 'Delivery' | 'Subscription' | 'WaitCondition';
  id: string;
  /** 该引用的版本（没有版本维度时为 null；不编造）。 */
  revision: number | null;
};

/**
 * 工具回执。`accepted` **只**在 Control 的提交回执到达之后才可能产生；
 * body 已存进 Vault 但 admission 失败时必须是 `rejected`（body 存在不等于已受理）。
 */
export type CoordinationToolOutcomeV1 =
  | {
      status: 'accepted';
      operation: CoordinationToolOperationV1;
      /** 账本幂等 replay：同一身份 + 同一 idempotencyKey 的重复提交，没有产生新事实。 */
      replayed: boolean;
      references: CoordinationToolReferenceV1[];
      summary: string;
    }
  | {
      status: 'rejected';
      operation: CoordinationToolOperationV1;
      code: string;
      issues: string[];
    };

/** 本 Work 邮箱的有界只读投影（模型据此拿到**精确**的 requestId / deliveryId）。 */
export type CoordinationMailboxV1 = {
  workContextRef: WorkContextRef;
  requests: { requestId: string; revision: number; status: string; fromWorkId: string; toWorkId: string }[];
  deliveries: { deliveryId: string; originKind: string; bodyDigest: string | null }[];
  subscriptions: { subscriptionId: string; topics: string[]; status: string }[];
  waits: { waitId: string; status: string; conditions: number }[];
};

export type CoordinationMailboxResultV1 =
  | { status: 'ready'; mailbox: CoordinationMailboxV1 }
  /** 读不完整/不可读：**不允许**当成"这个 Work 什么都没有"。 */
  | { status: 'unavailable'; reason: string };

/**
 * 工具 Adapter 需要的全部能力。宿主绑定 `principal`，模型只能提供内容参数。
 *
 * 每个写操作都有一个由**模型提供的内容键**（key）：聚合 id 由
 * `(principal.runRef, key)` 机械派生，因此重复的同一次调用是账本幂等 replay，
 * 而不是第二条事实。
 */
export interface CoordinationToolAccessPort {
  /** 宿主绑定的精确身份（canonical 事实派生；模型不可见其输入面）。 */
  readonly principal: AgentPrincipalRefV1;
  mailbox(): Promise<CoordinationMailboxResultV1>;
  request(input: { toWorkId: string; statement: string; body: string; key: string }): Promise<CoordinationToolOutcomeV1>;
  respond(input: { requestId: string; body: string; key: string }): Promise<CoordinationToolOutcomeV1>;
  subscribe(input: { topics: string[]; startCursor?: string | null; key: string }): Promise<CoordinationToolOutcomeV1>;
  wait(input: {
    mode?: 'all' | 'any';
    deliveryIds: string[];
    requestIds: string[];
    deadlineAt: string | null;
    key: string;
  }): Promise<CoordinationToolOutcomeV1>;
  cancel(input: { target: 'directed_request' | 'subscription' | 'wait'; targetId: string; reason: string }): Promise<CoordinationToolOutcomeV1>;
}

export type { DeliverySnapshot, DirectedRequestSnapshot, SubscriptionSnapshot, WaitConditionSnapshot };
