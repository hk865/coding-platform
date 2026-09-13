import { makeCommitCursor, seqOfCommitCursor } from "../../contracts/ledger.js";
import { qualifiedAlternativeReport } from '../../contracts/alternative-report.js';
import { communicationSource, subscriptionDeliveryIdFor, selectCatchupPrefix, SUBSCRIPTION_MAX_REPLAY_SPAN } from "../../contracts/coordination.js";
import { deliveryRecordedEvent, communicationIntentSettledEvent, waitConditionObservedEvent } from "../../contracts/coordination-events.js";
/**
 * CM-1A-001 Control 受理面：协作通信（AgentInstance / WorkParticipation /
 * DirectedRequest / Subscription / Delivery / WaitCondition / CommunicationIntent）。
 *
 * 权威：
 *   - src/contracts/coordination.ts（协议 v1：ref、命令、receipt、事件、commit 形状）
 *   - src/contracts/coordination-events.ts（事件构造纯函数）
 *   - ./records/coordination.ts（确定性 fold / commit 构造，本文件只调用不复制）
 *   - ./policies/coordination-rules.ts（分页订阅、wait 求值、接续资格、领取决策）
 *   - CM-1A-001 decision-log D01–D06（D06 = owner 对参与语义的裁决：专用校验、receipt issues、
 *     participation-end 生产者、以及"同一 Agent 至多一个 active participation"的如实收口）
 *
 * 本文件的 handler：registerAgentInstance / startWorkParticipation / endWorkParticipation /
 * sendDirectedRequest / respondDirectedRequest / createSubscription / registerWait /
 * cancelCommunication / claimCommunicationIntent / settleCommunicationIntent /
 * admitWaitSuccessor + 只读面 mailboxView。
 *
 * ── 落点纪律（本文件是本票唯一的 Control 写入面）──────────────────────────────
 *   1. 每个 handler 的守卫顺序固定为：**结构校验 → 引用存在 → 权限/参与活性 →
 *      CAS 期望版本 → 唯一一次 deps.ledger.commit(...)**。任何拒绝都是零写入：
 *      拒绝发生在 commit 之前，且被拒绝的分支里没有别的写路径。
 *   2. 正文（请求陈述 / 报告 / 事件正文）不写进账本，也不在本文件里保存：调用方先用
 *      ArtifactPort.put 落正文，Control 只登记精确 ArtifactRef 与来源 pin。这里因此
 *      只做 ArtifactRef 的**形状**校验（body-first 的引用形状），不读正文。
 *      为什么不在这里注入 ArtifactPort：ControlEngineDeps 没有该端口，ModuleDAG 只允许
 *      ControlEngine → StateLedger（ArtifactVault 不是 Control 的依赖边），且协议原文写明
 *      「Control 只登记正文的精确 ArtifactRef」。与 P1-18 material-access 同一条既有边界：
 *      Control 登记决定，Vault 在读取时判定存在性、当前性与授权。
 *   3. 不新增聚合、不新增事件种类、不新增索引表：所有持久事实都落在
 *      contracts/coordination.ts 已声明的 10 个聚合上，调度事实只落在
 *      CommunicationIntent / DispatchOutboxEntry 两类既有持久 intent 上。
 *   4. 分页路由的 canonical 复核在本文件（Dispatch 的 RoutePageProposalV1 只是**提议**）：
 *      订阅的期望版本、投递目标必须等于订阅 owner、页内 delivery 去重、wait 条件推进
 *      都必须在本文件复核通过才会进入同一个 CAS。
 *
 * ── 已实现守卫之外**明确没有做到**的边界（如实记录，不假造索引）───────────────
 *   (a)「同一 AgentInstance 在同一 (project, workspace) 至多一个 active participation」
 *      —— 第 2 步（CM-1A-001 owner 裁决）已由**两条独立机制**保证（同一说明也在
 *      src/contracts/coordination.ts 的 WorkParticipationV1 上），本文件不再把它记成边界：
 *        · 命令面（先查后写，只负责可读原因）：startWorkParticipation 读到该 Work 的当前参与
 *          关系（WorkContextBindingV1.currentParticipationRef）仍 active 时拒绝（forbidden）；
 *        · 账本提交语义（**唯一判定点**）：participation-start 在同一事务里占用
 *          (project, workspace, agentInstanceId) 的参与身份槽，participation-end 在同一次提交里
 *          释放（ledger-validation 的 participationIdentityClaim）。跨进程的第二段 active 参与
 *          因此不可能各自成立。
 *        仍然成立的既有保证：① 同一 participationId 只创建一次（CAS@0 + 账本幂等，且由
 *        validateParticipationStartCommit 把形状钉死）；② 同一 Work 的并发参与由
 *        WorkContextBinding 的 CAS 串行化；③ 一段参与的结束是一次 CAS@N 的原地推进。
 *        已知边界（如实）：身份槽按快照内容派生，守卫的是经正式提交写进来的参与关系；本次
 *        裁决之前已经落账的历史重复保持可读、不改写、不合并。
 *   (b)「目标 Work 当前的 participation」同样没有索引：expectedParticipationRef 的并发校验
 *      读的是**调用方给出的那个 ref**（必须存在、active、且属于目标 Work），不匹配一律
 *      stale_participation——绝不改投给「现在那边是谁」。**这条守卫防的是静默转投，不做
 *      「目标换了人」的自动跟随**：换手后要把请求发给新参与，调用方必须显式给出新的
 *      expectedParticipationRef（旧的那条此时已 ended，会得到 stale_participation）。
 *   (c) route_page 的「下一页 intent」：协议只给了 routePageIntentIdFor(topic, cursor)，而同一
 *      (topic, cursor) 的后续页必须与首页取不同的 intentId，否则会在同一个提交里出现同一 ref 的
 *      两份快照（账本形状校验直接拒绝）。协议约束 1.4 把「源事件位置（sourceCursor）」与「该事件
 *      内的订阅分页位置（subscriptionPosition）」拆开之后，本文件的派生键是
 *      **subscriptionPosition**（本页最后一个被处理的订阅的 canonical ref key，确定性、可重算，见
 *      见 nextRouteIntentFor）：
 *      `routePageIntentFor(topic, cursor).intentId + "-p" + sha256(subscriptionPosition)[0..8]`。
 *      同一事件翻页时事件位置允许不变，但订阅位置必须**前进**（本文件在 settleCommunicationIntent
 *      里逐页复核：页声明的订阅位置必须等于页内实际处理结果，且相对上一页严格推进）；
 *      **首页仍然逐字节使用协议 helper**，派生只发生在 hasMore 的下一页。
 *   (d) 换手（A01）：endWorkParticipation 只结束"参与关系"这一段时间，不触碰任何
 *      Request/Subscription/Wait/Delivery——它们的 owner 是 WorkContextBinding，所以换手后
 *      等待仍归 Work。command.payload 里的 runRef 是"收尾 Run"（必须已 link 在该 Work 上），
 *      reason 是说明；WorkParticipationV1 的值形状没有对应字段，因此两者是**授权与归因输入**，
 *      canonical 事实是 WorkParticipationEnded 事件 + 快照的 status/endedAt。
 */
import type { CommandFingerprint, CommandIdentity } from "../../contracts/command-event.js";
import type { CommitCursor } from "../../contracts/command-event.js";
import type { DomainEvent } from "../../contracts/events.js";
import type { ValidationIssue } from "../../contracts/validation/common.js";
import { validateActor } from "../../contracts/validation/identity.js";
import { canonicalJson, sha256Hex } from "../../contracts/fingerprint.js";
import type { AggregateRef, LedgerCommitReceipt, VersionedRef, WorkspaceRef } from "../../contracts/ledger.js";
import type { RunSnapshot } from "../../contracts/dispatch.js";
import type { PlanRevisionRef } from "../../contracts/plan.js";
import type { WorkContextBindingSnapshot, WorkContextRef } from "../../contracts/context-continuity.js";
import type { ContextManifestV1, MaterialGapV1 } from "../../contracts/task-envelope.js";
import type { SourceRefV1 } from "../../contracts/dispatch.js";
import type {
  AdmitWaitSuccessorCommand,
  AdmitWaitSuccessorReceipt,
  AgentInstanceSnapshot,
  AgentPrincipalRefV1,
  CancelCommunicationCommand,
  RequestIntentCancellationCommand,
  CommunicationClaimCommand,
  CommunicationClaimReceipt,
  CommunicationIntentRef,
  CommunicationIntentSnapshot,
  CommunicationIntentV1,
  CommunicationSettleCommand,
  CommunicationSettleReceipt,
  CommunicationWriteReceipt,
  CoordinationRegistrySnapshot,
  EnsureWaitAdmissionCommand,
  EnsureWaitAdmissionReceipt,
  DeliveryRef,
  DeliverySnapshot,
  DeliveryV1,
  DirectedRequestRef,
  DirectedRequestRespondedEvent,
  DirectedRequestSentEvent,
  DirectedRequestSnapshot,
  DirectedRequestCancelledEvent,
  DirectedRequestV1,
  MailboxViewV1,
  RegisterAgentInstanceCommand,
  RegisterWaitCommand,
  RespondDirectedRequestCommand,
  SendDirectedRequestCommand,
  StartWorkParticipationCommand,
  EndWorkParticipationCommand,
  SubscribeCommand,
  RouteIntentPlanV1,
  RoutePageSubscriptionScopeEntry,
  SubscriptionRef,
  SubscriptionSnapshot,
  SubscriptionV1,
  SubscriptionCancelledEvent,
  SubscriptionCreatedEvent,
  WaitConditionRef,
  WaitConditionSnapshot,
  WaitConditionTermV1,
  WaitConditionV1,
  WaitConditionCancelledEvent,
  WaitConditionObservedEvent,
  WaitConditionRegisteredEvent,
  WaitConditionSatisfiedEvent,
  WaitConditionTimedOutEvent,
  WorkParticipationRef,
  WorkParticipationSnapshot,
  WorkParticipationStartedEvent,
  WorkParticipationEndedEvent,
  WorkMailboxSnapshot,
} from "../../contracts/coordination.js";
import {
  COMMUNICATION_PAGE_MAX_DELIVERIES,
  REQUEST_STATEMENT_MAX_BYTES,
  SUBSCRIPTION_MAX_TOPICS,
  WAIT_MAX_CONDITIONS,
  agentInstanceRefFor,
  communicationIntentRefFor,
  communicationSettleFingerprint,
  communicationClaimFingerprint,
  deliveryRefFor,
  directedRequestRefFor,
  registerAgentInstanceFingerprint,
  registerWaitFingerprint,
  respondDirectedRequestFingerprint,
  sendDirectedRequestFingerprint,
  startWorkParticipationFingerprint,
  endWorkParticipationFingerprint,
  subscribeFingerprint,
  cancelCommunicationFingerprint,
  requestIntentCancellationFingerprint,
  admitWaitSuccessorFingerprint,
  subscriptionRefFor,
  waitConditionRefFor,
  workParticipationRefFor,
  waitAdmissionIntentIdFor,
  waitDeadlineIntentIdFor,
  ensureWaitAdmissionFingerprint,
} from "../../contracts/coordination.js";
import { communicationIntentRecordedEvent } from "../../contracts/coordination-events.js";
import {
  buildAgentInstanceRegisterCommit,
  buildCommunicationIntentClaimCommit,
  buildDirectedRequestCancelCommit,
  buildDirectedRequestRespondCommit,
  buildDirectedRequestSendCommit,
  buildIntentCancelRequestCommit,
  buildIntentSettleCommit,
  buildParticipationEndCommit,
  buildParticipationStartCommit,
  buildRoutePageCommit,
  buildIntentRecordCommit,
  buildSubscriptionCancelCommit,
  buildSubscriptionCatchupCommit,
  buildSubscriptionCreateCommit,
  buildSuccessorCommit,
  buildWaitCancelCommit,
  buildWaitRegisterCommit,
  withRouteIntentPlan,
  communicationIntentRefForOf,
  deliveryRefForOf,
  intentSnapshotFor,
  routePageIntentFor,
  subscriptionRouteIntentFor,
  successorIdsFor,
  waitAdmissionIntentFor,
  waitConditionRefForOf,
  waitDeadlineIntentFor,
  type CoordinationFoldDeps,
} from "./records/coordination.js";
import {
  dedupePageDeliveries,
  decideIntentClaim,
  evaluateSuccessorEligibility,
  evaluateWaitConditions,
  pageDelivery,
  type WaitConditionFacts,
} from "./policies/coordination-rules.js";
import type { ControlEngineDeps } from "./control-engine.js";
// 协议约束 2.2：后继按**当前**参与关系的 RoleBinding 重新核验资格，并把权限集收窄到规格上界内。
// 这里复用的是既有 RW-11 准入策略（不另写一套判据）：矩阵 → pin → 已安装规格 → 生效引用 → 权限子集。
import { evaluateRoleBindingAdmission } from "./policies/role-binding-admission.js";
import { resolveActiveCoordinationPolicy } from "./policies/coordination-policy.js";
import { projectRoleSpecActiveRefFor, type ProjectRoleSpecActiveSnapshot, type RoleSpecRevisionRef, type RoleSpecRevisionSnapshot } from "../../contracts/role-spec.js";
import type { RoleBindingRefV1 } from "../../contracts/dispatch.js";
import { validateDeclaredPermissions } from "../../contracts/validation/dispatch.js";
import type { MailboxViewQuery, MailboxViewResult } from "../../contracts/modules.js";

// ------------------------------------------------------------------------ //
// 公开类型                                                                   //
// ------------------------------------------------------------------------ //

/**
 * 只读邮箱面的对外形状声明在 Interface 文件（src/contracts/modules.ts）里，
 * 这里只重导出，方便实现侧与消费者用同一份类型。
 */
export type { MailboxViewQuery, MailboxViewResult };

/** 事件扫描分页大小（与 RW-13／RW-04 同量级）。 */
export const MAILBOX_SCAN_PAGE_SIZE = 1000;
/** 事件扫描页数上限：200 × 1000 = 200000 条；超过即读不完整。 */
export const MAILBOX_MAX_SCAN_PAGES = 200;

type WriteRejectionCode =
  | "invalid"
  | "not_found"
  | "forbidden"
  | "stale_participation"
  | "stale_binding"
  | "revision_conflict"
  | "idempotency_conflict"
  | "over_limit"
  | "unavailable";

// ------------------------------------------------------------------------ //
// 结构校验小工具（只判形状，不做业务准入）                                     //
// ------------------------------------------------------------------------ //

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requireString(value: unknown, path: string, issues: string[]): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  issues.push(path + " 必须是非空字符串");
  return null;
}

function requireIsoTimestamp(value: unknown, path: string, issues: string[]): string | null {
  const text = requireString(value, path, issues);
  if (text === null) return null;
  if (Number.isNaN(Date.parse(text))) {
    issues.push(path + " 必须是可解析的时间戳");
    return null;
  }
  return text;
}

type CommandShape = {
  commandId?: unknown;
  commandType?: unknown;
  schemaVersion?: unknown;
  correlationId?: unknown;
  aggregateId?: unknown;
  expectedRevision?: unknown;
  identity?: unknown;
};

function checkCommandShape(command: CommandShape, expectedType: string, issues: string[]): void {
  if (command.schemaVersion !== 1) issues.push("schemaVersion 必须是 1");
  if (command.commandType !== expectedType) issues.push("commandType 必须是 " + expectedType);
  requireString(command.commandId, "commandId", issues);
  requireString(command.correlationId, "correlationId", issues);
  requireString(command.aggregateId, "aggregateId", issues);
  const identity = asRecord(command.identity);
  if (identity === null) {
    issues.push("identity 必须是对象");
    return;
  }
  requireString(identity["projectId"], "identity.projectId", issues);
  requireString(identity["idempotencyKey"], "identity.idempotencyKey", issues);
  const actorIssues: ValidationIssue[] = [];
  validateActor(identity["actor"], "identity.actor", actorIssues);
  for (const issue of actorIssues) issues.push(issue.message);
}

function checkRefScope(
  ref: unknown,
  path: string,
  projectId: string,
  workspaceId: string | null,
  issues: string[],
): void {
  const record = asRecord(ref);
  if (record === null) {
    issues.push(path + " 必须是引用对象");
    return;
  }
  if (record["projectId"] !== projectId) issues.push(path + ".projectId 必须与 identity.projectId 一致");
  if (workspaceId !== null && record["workspaceId"] !== workspaceId) {
    issues.push(path + ".workspaceId 必须与 payload.workspaceId 一致");
  }
}

function checkWorkContextRef(value: unknown, path: string, projectId: string, workspaceId: string, issues: string[]): void {
  const record = asRecord(value);
  if (record === null) {
    issues.push(path + " 必须是 WorkContextRef");
    return;
  }
  if (record["aggregateType"] !== "WorkContextBinding") issues.push(path + ".aggregateType 必须是 WorkContextBinding");
  checkRefScope(record, path, projectId, workspaceId, issues);
  requireString(record["workId"], path + ".workId", issues);
}

function checkParticipationRef(value: unknown, path: string, projectId: string, workspaceId: string, issues: string[]): void {
  const record = asRecord(value);
  if (record === null) {
    issues.push(path + " 必须是 WorkParticipationRef");
    return;
  }
  if (record["aggregateType"] !== "WorkParticipation") issues.push(path + ".aggregateType 必须是 WorkParticipation");
  checkRefScope(record, path, projectId, workspaceId, issues);
  requireString(record["workId"], path + ".workId", issues);
  requireString(record["participationId"], path + ".participationId", issues);
}

function checkRunRef(value: unknown, path: string, projectId: string, issues: string[]): void {
  const record = asRecord(value);
  if (record === null) {
    issues.push(path + " 必须是 RunRef");
    return;
  }
  if (record["aggregateType"] !== "Run") issues.push(path + ".aggregateType 必须是 Run");
  checkRefScope(record, path, projectId, null, issues);
  requireString(record["goalId"], path + ".goalId", issues);
  requireString(record["runId"], path + ".runId", issues);
}

/** body-first 的引用**形状**校验：正文本身由 ArtifactVault 负责存在性与授权。 */
function checkArtifactRef(value: unknown, path: string, issues: string[]): void {
  const record = asRecord(value);
  if (record === null) {
    issues.push(path + " 必须是 ArtifactRef");
    return;
  }
  if (record["kind"] !== "artifact") issues.push(path + ".kind 必须是 artifact");
  requireString(record["contentType"], path + ".contentType", issues);
  requireString(record["digest"], path + ".digest", issues);
  const size = record["sizeBytes"];
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) {
    issues.push(path + ".sizeBytes 必须是非负数字");
  }
  const source = asRecord(record["source"]);
  if (source === null) {
    issues.push(path + ".source 必须是 SourceRefV1");
    return;
  }
  requireString(source["kind"], path + ".source.kind", issues);
  requireString(source["refId"], path + ".source.refId", issues);
  requireString(source["revision"], path + ".source.revision", issues);
}

function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

// ------------------------------------------------------------------------ //
// 归因校验（A01：Agent 不用假 human 身份）                                     //
// ------------------------------------------------------------------------ //

/**
 * 协作通信命令的归因规则：actor **必须**是 agent，且（需要 Work/参与关系时）
 * identity.agentPrincipal 必须与 payload 逐字段一致。
 * 不一致一律 forbidden + 明确 issues——不静默按 payload 纠正，也不按 principal 改投。
 */
function checkAgentAttribution(
  identity: CommandIdentity,
  expected: {
    agentInstanceId: string;
    workContextRef: WorkContextRef;
    participationRef: WorkParticipationRef;
    runRef: RunSnapshot["ref"] | { aggregateType: "Run"; projectId: string; goalId: string; runId: string };
    /** 省略时只核对 agent/Work/参与/Run；给出时还要逐字段核对授权版本。 */
    roleBinding?: unknown;
    /** true 时 principal 必须存在（需要 Work/参与关系的命令）。 */
    required: boolean;
  },
  issues: string[],
): void {
  const actor = identity.actor;
  if (actor.kind !== "agent") {
    issues.push("协作通信命令必须用 agent 身份归因（禁止用 human/system 冒充 Agent）");
    return;
  }
  const principal: AgentPrincipalRefV1 | undefined = identity.agentPrincipal;
  if (principal === undefined) {
    if (expected.required) issues.push("agent 命令必须携带 identity.agentPrincipal（精确 AgentInstance/Work/参与/RoleBinding/Run）");
    return;
  }
  if (principal.agentInstanceId !== expected.agentInstanceId) issues.push("agentPrincipal.agentInstanceId 与 payload 不一致");
  if (canonicalJson(principal.workContextRef) !== canonicalJson(expected.workContextRef)) {
    issues.push("agentPrincipal.workContextRef 与 payload 的工作地址不一致");
  }
  if (canonicalJson(principal.participationRef) !== canonicalJson(expected.participationRef)) {
    issues.push("agentPrincipal.participationRef 与 payload 的参与关系不一致");
  }
  if (canonicalJson(principal.runRef) !== canonicalJson(expected.runRef)) {
    issues.push("agentPrincipal.runRef 与 payload 的发起 Run 不一致");
  }
  if (expected.roleBinding !== undefined && canonicalJson(principal.roleBinding as never) !== canonicalJson(expected.roleBinding as never)) {
    issues.push("agentPrincipal.roleBinding 与 payload 的授权版本不一致");
  }
  if (actor.id !== expected.agentInstanceId) issues.push("actor.id 必须是 AgentInstance id（与 payload 一致）");
  if (canonicalJson(actor.runRef) !== canonicalJson(expected.runRef)) {
    issues.push("actor.runRef 必须与 payload 的发起 Run 一致（causation 可核对）");
  }
}

/**
 * **调度触发**的协作命令的归因规则（CM-1A-001 owner 裁决，第 2 步）：只允许 system 身份，
 * 并要求命令自带**来源关联**（correlationId 由被触发的等待确定性派生，payload 给出 waitRef 与
 * 前驱 Run）。
 *
 * ── 为什么后继受理**不能**用 agent principal（这正是要修的缺陷）──────────────────
 * 触发接续的是调度侧的机械推进，不是某一段参与里的模型调用。此刻唯一存在的 agent 身份属于
 * **前驱那一段参与**（后继 Run 还不存在），用它归因等于把**新参与者**与**旧 Run** 拼成同一个
 * 身份：账本上会留下一条「后继由旧参与者发起」的假事实。Agent 侧的命令（请求/回应/订阅/等待/
 * 参与建立与结束）仍然按 AgentPrincipalRefV1 的精确 principal 归因，两者的 actor 不得混用。
 */
function checkSchedulerAttribution(
  identity: CommandIdentity,
  correlationId: string,
  expected: { sourceId: string },
  issues: string[],
): void {
  const actor = identity.actor;
  if (actor.kind === "human") {
    issues.push("后继受理必须由调度侧以 system 身份提交（禁止 human 冒充）");
    return;
  }
  if (actor.kind === "agent") {
    issues.push(
      "后继受理是调度触发命令，必须用 {kind:'system'} 身份 + 来源关联提交；" +
      "用 agent principal 归因会把新参与者与旧 Run 拼成一个身份（后继 Run 此刻还不存在）",
    );
    return;
  }
  if (actor.id.length === 0) issues.push("system 身份必须给出非空 actor.id（调度消费者）");
  if (correlationId.length === 0) issues.push("调度触发的命令必须带来源关联（correlationId）");
  if (expected.sourceId.length > 0 && !correlationId.includes(expected.sourceId)) {
    issues.push("correlationId 必须由本次触发来源确定性派生（须包含 " + expected.sourceId + "）");
  }
}

// ------------------------------------------------------------------------ //
// receipt 映射                                                              //
// ------------------------------------------------------------------------ //

function rejectWrite(
  commandId: string,
  code: WriteRejectionCode,
  issues?: string[],
  currentRevision?: number,
): CommunicationWriteReceipt {
  return {
    status: "rejected",
    commandId,
    code,
    ...(issues === undefined ? {} : { issues }),
    ...(currentRevision === undefined ? {} : { currentRevision }),
  };
}

function mapCommitReceipt(
  receipt: LedgerCommitReceipt,
  commandId: string,
  preferredRefKey?: string,
): CommunicationWriteReceipt {
  if (receipt.status === "committed") {
    return {
      status: "committed",
      commandId,
      replayed: receipt.replayed,
      eventIds: [...receipt.eventIds],
      commitCursor: receipt.commitCursor,
      revisions: receipt.aggregateRevisions.map((v: VersionedRef) => ({
        refKey: canonicalJson(v.ref),
        revision: v.revision,
      })),
    };
  }
  return mapRejectedCommit(receipt, commandId, preferredRefKey);
}

function mapRejectedCommit(
  receipt: Extract<LedgerCommitReceipt, { status: "rejected" }>,
  commandId: string,
  preferredRefKey?: string,
): CommunicationWriteReceipt {
  switch (receipt.code) {
    case "invalid_commit":
      return rejectWrite(commandId, "invalid", ["StateLedger 拒绝了提交形状（事件/快照/期望版本不一致）"]);
    case "revision_conflict": {
      const versions = receipt.currentVersions ?? [];
      const preferred = preferredRefKey === undefined
        ? undefined
        : versions.find((v) => canonicalJson(v.ref) === preferredRefKey);
      const chosen = preferred ?? versions[0];
      return rejectWrite(commandId, "revision_conflict", undefined, chosen?.revision);
    }
    case "idempotency_conflict":
      return rejectWrite(commandId, "idempotency_conflict");
    case "unavailable":
      return rejectWrite(commandId, "unavailable");
    case "not_empty":
      return rejectWrite(commandId, "invalid", ["协作通信提交必须携带期望版本（CAS）"]);
  }
}

// ------------------------------------------------------------------------ //
// Control 受理面                                                             //
// ------------------------------------------------------------------------ //

export class CoordinationEngineImpl {
  constructor(private readonly deps: ControlEngineDeps) {}

  private foldDeps(workspaceId: string): CoordinationFoldDeps {
    return { eventId: this.deps.eventId, now: this.deps.now, workspaceId };
  }

  private async loadTyped<T>(ref: AggregateRef, aggregateType: string): Promise<T | null> {
    const loaded = await this.deps.ledger.load(ref);
    if (loaded.status !== "found") return null;
    if (String(loaded.snapshot.ref.aggregateType) !== aggregateType) return null;
    return loaded.snapshot as unknown as T;
  }

  // --------------------------------------------------------------------- //
  // 1. registerAgentInstance（CAS@0）                                      //
  // --------------------------------------------------------------------- //

  async registerAgentInstance(command: RegisterAgentInstanceCommand): Promise<CommunicationWriteReceipt> {
    const issues: string[] = [];
    checkCommandShape(command, "RegisterAgentInstance", issues);
    const payload = (command.payload ?? {}) as Record<string, unknown>;
    const workspaceId = requireString(payload["workspaceId"], "payload.workspaceId", issues);
    requireString(payload["templateId"], "payload.templateId", issues);
    requireString(payload["templateRevision"], "payload.templateRevision", issues);
    if (command.expectedRevision !== 0) issues.push("expectedRevision 必须是 0（AgentInstance 只创建一次）");
    if (issues.length > 0) return rejectWrite(command.commandId, "invalid", issues);

    // 归因：注册 AgentInstance 的命令只能是 agent 自己发的（不新增 human/system 旁路）。
    if (command.identity.actor.kind !== "agent") {
      return rejectWrite(command.commandId, "forbidden", ["RegisterAgentInstance 必须由 agent 身份提交"]);
    }
    if (command.identity.actor.id !== command.aggregateId) {
      return rejectWrite(command.commandId, "invalid", ["actor.id 必须是本次注册的 AgentInstance id"]);
    }

    const workspaceRef: WorkspaceRef = {
      aggregateType: "Workspace",
      projectId: command.identity.projectId,
      workspaceId: workspaceId as string,
    };
    if ((await this.deps.ledger.load(workspaceRef)).status !== "found") {
      return rejectWrite(command.commandId, "not_found", ["工作区不存在：" + String(workspaceId)]);
    }

    const batch = buildAgentInstanceRegisterCommit(
      command,
      this.foldDeps(workspaceId as string),
      registerAgentInstanceFingerprint(command),
    );
    const receipt = await this.deps.ledger.commit(batch);
    return mapCommitReceipt(receipt, command.commandId, canonicalJson(batch.snapshots[0]!.ref));
  }

  // --------------------------------------------------------------------- //
  // 2. startWorkParticipation（CAS@0 + 同事务 link 发起 Run）                //
  // --------------------------------------------------------------------- //

  async startWorkParticipation(command: StartWorkParticipationCommand): Promise<CommunicationWriteReceipt> {
    const issues: string[] = [];
    checkCommandShape(command, "StartWorkParticipation", issues);
    const payload = (command.payload ?? {}) as Record<string, unknown>;
    const workspaceId = requireString(payload["workspaceId"], "payload.workspaceId", issues);
    const agentInstanceId = requireString(payload["agentInstanceId"], "payload.agentInstanceId", issues);
    const scopeWorkspace = workspaceId ?? "";
    checkWorkContextRef(payload["workContextRef"], "payload.workContextRef", command.identity.projectId, scopeWorkspace, issues);
    checkRunRef(payload["runRef"], "payload.runRef", command.identity.projectId, issues);
    if (command.expectedRevision !== 0) issues.push("expectedRevision 必须是 0（参与关系只创建一次）");
    if (issues.length > 0) return rejectWrite(command.commandId, "invalid", issues);

    const workContextRef = payload["workContextRef"] as WorkContextRef;
    const runRef = payload["runRef"] as RunSnapshot["ref"];
    const roleBinding = payload["roleBinding"];

    // 归因（principal 与 payload 逐字段一致；刚创建时 principal.participationRef 就是本次 id）。
    const attribution: string[] = [];
    checkAgentAttribution(
      command.identity,
      {
        agentInstanceId: agentInstanceId as string,
        workContextRef,
        participationRef: workParticipationRefFor(
          command.identity.projectId,
          workspaceId as string,
          workContextRef.workId,
          command.aggregateId,
        ),
        runRef,
        roleBinding,
        required: false,
      },
      attribution,
    );
    if (attribution.length > 0) return rejectWrite(command.commandId, "forbidden", attribution);

    // 引用存在：AgentInstance + WorkContextBinding + 发起 Run。
    const agent = await this.loadTyped<AgentInstanceSnapshot>(
      agentInstanceRefFor(command.identity.projectId, workspaceId as string, agentInstanceId as string),
      "AgentInstance",
    );
    if (agent === null) return rejectWrite(command.commandId, "not_found", ["AgentInstance 不存在：" + String(agentInstanceId)]);
    if (agent.agent.status !== "active") {
      return rejectWrite(command.commandId, "forbidden", ["AgentInstance 不是 active：" + agent.agent.status]);
    }
    const binding = await this.loadTyped<WorkContextBindingSnapshot>(workContextRef, "WorkContextBinding");
    if (binding === null) return rejectWrite(command.commandId, "not_found", ["WorkContextBinding 不存在：" + workContextRef.workId]);
    if (binding.binding.status !== "active") {
      return rejectWrite(command.commandId, "forbidden", ["WorkContextBinding 不是 active：" + String(binding.binding.status)]);
    }
    if ((await this.deps.ledger.load(runRef as AggregateRef)).status !== "found") {
      return rejectWrite(command.commandId, "not_found", ["发起 Run 不存在：" + runRef.runId]);
    }

    // ── 唯一性：先查后写（可读原因）＋ 账本提交语义（跨进程的唯一判定点）──────────────
    // CM-1A-001 第 2 步：不变式是「同一 AgentInstance 在同一 (project, workspace) 至多一段
    // active 参与」，并且该 Work 的「当前参与关系」是单值。这里能读到的只有 Work 权威状态
    // （currentParticipationRef），它覆盖「同一 Work 上已有一段 active 参与」——换手必须先结束
    // 旧段。跨 Work／跨进程的那一半**只能**由账本在同一事务里判定并占用该 AgentInstance 的
    // 参与身份槽（participationIdentityClaim），所以这条守卫只负责给出可读原因，不作为保证。
    const currentRef = binding.binding.currentParticipationRef ?? null;
    if (currentRef !== null && currentRef.participationId !== command.aggregateId) {
      const currentParticipation = await this.loadTyped<WorkParticipationSnapshot>(currentRef, "WorkParticipation");
      if (currentParticipation !== null && currentParticipation.participation.status === "active") {
        return rejectWrite(command.commandId, "forbidden", [
          "该 Work 上已经有一段 active 参与关系（当前参与者：" +
          currentParticipation.participation.agentInstanceId + "，participation=" + currentRef.participationId +
          "）：换手必须先 endWorkParticipation 结束旧的一段，再建立新的参与关系",
        ]);
      }
    }

    const batch = buildParticipationStartCommit(
      command,
      this.foldDeps(workspaceId as string),
      startWorkParticipationFingerprint(command),
      binding,
    );
    const receipt = await this.deps.ledger.commit(batch);
    // 账本用**同一个事务**判定并占用该 (project, workspace, agentInstanceId) 的参与身份槽：
    // 已被别的参与关系占用时它只回 revision_conflict（看不到具体原因），因此这里补一句可读的
    // 归因，但不改变零写入与拒绝语义。
    const mapped = mapCommitReceipt(receipt, command.commandId, canonicalJson(batch.snapshots[0]!.ref));
    if (mapped.status === "rejected" && mapped.code === "revision_conflict") {
      return {
        ...mapped,
        issues: [
          "参与身份槽可能已被该 AgentInstance 在本 (project, workspace) 的另一段 active 参与占用" +
          "（唯一性由账本在提交事务里判定，跨进程同样成立）；换手必须先在原参与关系上 endWorkParticipation",
        ],
      };
    }
    return mapped;
  }

  // --------------------------------------------------------------------- //
  // 2b. endWorkParticipation（A01：同一 Work 换参与者；CAS@N）                 //
  // --------------------------------------------------------------------- //

  /**
   * 结束一段参与关系。为什么必须有这条路径：WorkParticipation 是**一段时间**上的参与，
   * 换手（旧的一段结束、同一 Work 上开始新的一段）必须能被表达，否则「等待/请求归 Work
   * 而不是归某个参与者」在账本里没有可证的迁移路径。结束**不**触碰任何
   * Request/Subscription/Wait/Delivery：它们的 owner 是 WorkContextBinding。
   *
   * 「已经 ended 再结束一次」的语义（owner 裁决 D06 要求明确选一个，并在测试里断言）：
   *   - `expectedRevision >= 当前 revision` → `revision_conflict`（零写入）；
   *   - `expectedRevision < 当前 revision` → **交给账本判定**：StateLedger 在 CAS 之前先判
   *     幂等，因此同一命令身份+指纹的重复提交返回 committed(replayed=true)（不再写事件），
   *     另一个命令身份则必然 CAS 失败 → revision_conflict（零写入）。
   * 这样重复结束既不会产生第二条 ended 事实，也不会把幂等重放误报成冲突。
   */
  async endWorkParticipation(command: EndWorkParticipationCommand): Promise<CommunicationWriteReceipt> {
    const issues: string[] = [];
    checkCommandShape(command, "EndWorkParticipation", issues);
    const payload = (command.payload ?? {}) as Record<string, unknown>;
    const workspaceId = requireString(payload["workspaceId"], "payload.workspaceId", issues);
    const scopeWorkspace = workspaceId ?? "";
    checkWorkContextRef(payload["workContextRef"], "payload.workContextRef", command.identity.projectId, scopeWorkspace, issues);
    checkRunRef(payload["runRef"], "payload.runRef", command.identity.projectId, issues);
    requireString(payload["reason"], "payload.reason", issues);
    if (typeof command.expectedRevision !== "number" || !Number.isInteger(command.expectedRevision) || command.expectedRevision < 1) {
      issues.push("expectedRevision 必须是当前 WorkParticipation 的正整数 revision");
    }
    if (issues.length > 0) return rejectWrite(command.commandId, "invalid", issues);

    const projectId = command.identity.projectId;
    const workContextRef = payload["workContextRef"] as WorkContextRef;
    const runRef = payload["runRef"] as RunSnapshot["ref"];
    const participationRef = workParticipationRefFor(projectId, scopeWorkspace, workContextRef.workId, command.aggregateId);

    const attribution: string[] = [];
    checkAgentAttribution(
      command.identity,
      {
        agentInstanceId: command.identity.actor.kind === "agent" ? command.identity.actor.id : "",
        workContextRef,
        participationRef,
        runRef,
        required: true,
      },
      attribution,
    );
    if (attribution.length > 0) return rejectWrite(command.commandId, "forbidden", attribution);

    const prior = await this.loadTyped<WorkParticipationSnapshot>(participationRef, "WorkParticipation");
    if (prior === null) {
      return rejectWrite(command.commandId, "not_found", ["参与关系不存在：" + participationRef.participationId]);
    }
    if (canonicalJson(prior.participation.workContextRef) !== canonicalJson(workContextRef)) {
      return rejectWrite(command.commandId, "invalid", ["payload.workContextRef 与该参与关系的 Work 不一致"]);
    }
    // 收尾 Run 必须是该 Work 上的 Run（授权 + 归因都可核对）。
    const binding = await this.loadTyped<WorkContextBindingSnapshot>(workContextRef, "WorkContextBinding");
    if (binding === null) return rejectWrite(command.commandId, "not_found", ["WorkContextBinding 不存在：" + workContextRef.workId]);
    if (!runLinkedInBinding(binding, runRef)) {
      return rejectWrite(command.commandId, "forbidden", ["收尾 Run 没有 link 在该 Work 上：" + runRef.runId]);
    }

    if (prior.participation.status === "ended") {
      if (command.expectedRevision >= prior.revision) {
        return rejectWrite(command.commandId, "revision_conflict", ["参与关系已经 ended，不能再次结束"], prior.revision);
      }
      // expectedRevision 落后于当前 revision：可能是同一命令身份的幂等重放，交给账本判定。
    } else if (prior.revision !== command.expectedRevision) {
      return rejectWrite(command.commandId, "revision_conflict", undefined, prior.revision);
    }

    // CM-1A-001 第 4 步：WorkParticipationEnded 是**可路由源事件**。这次提交在同一个事务里
    // 登记它触发的待路由 intent（位置由账本按该事件落点算出），因此不存在"事件已落账但没人
    // 能发现它"的窗口——重启后 Dispatch 照样读得到这条 intent。
    const endPlan = await this.routeIntentPlanFor("WorkParticipationEnded", scopeWorkspace, this.deps.now(), command.identity.projectId);
    const batch = withRouteIntentPlan(buildParticipationEndCommit({
      command,
      deps: this.foldDeps(scopeWorkspace),
      fingerprint: endWorkParticipationFingerprint(command),
      prior,
    }), endPlan);
    const receipt = await this.deps.ledger.commit(batch);
    return mapCommitReceipt(receipt, command.commandId, canonicalJson(participationRef));
  }

  // --------------------------------------------------------------------- //
  // 3. sendDirectedRequest                                                 //
  // --------------------------------------------------------------------- //

  async sendDirectedRequest(command: SendDirectedRequestCommand): Promise<CommunicationWriteReceipt> {
    const issues: string[] = [];
    checkCommandShape(command, "SendDirectedRequest", issues);
    const payload = (command.payload ?? {}) as Record<string, unknown>;
    const workspaceId = requireString(payload["workspaceId"], "payload.workspaceId", issues);
    const scopeWorkspace = workspaceId ?? "";
    checkParticipationRef(payload["fromParticipationRef"], "payload.fromParticipationRef", command.identity.projectId, scopeWorkspace, issues);
    checkRunRef(payload["fromRunRef"], "payload.fromRunRef", command.identity.projectId, issues);
    checkWorkContextRef(payload["toWorkContextRef"], "payload.toWorkContextRef", command.identity.projectId, scopeWorkspace, issues);
    if (payload["expectedParticipationRef"] !== null && payload["expectedParticipationRef"] !== undefined) {
      checkParticipationRef(payload["expectedParticipationRef"], "payload.expectedParticipationRef", command.identity.projectId, scopeWorkspace, issues);
    }
    const statement = requireString(payload["statement"], "payload.statement", issues);
    if (statement !== null && utf8Bytes(statement) > REQUEST_STATEMENT_MAX_BYTES) {
      issues.push("payload.statement 超过 " + String(REQUEST_STATEMENT_MAX_BYTES) + " 字节上界");
    }
    checkArtifactRef(payload["statementBodyRef"], "payload.statementBodyRef", issues);
    if (command.expectedRevision !== 0) issues.push("expectedRevision 必须是 0（请求只创建一次）");
    if (issues.length > 0) return rejectWrite(command.commandId, "invalid", issues);

    const fromParticipationRef = payload["fromParticipationRef"] as WorkParticipationRef;
    const fromRunRef = payload["fromRunRef"] as RunSnapshot["ref"];
    const toWorkContextRef = payload["toWorkContextRef"] as WorkContextRef;

    const attribution: string[] = [];
    checkAgentAttribution(
      command.identity,
      {
        agentInstanceId: command.identity.actor.kind === "agent" ? command.identity.actor.id : "",
        workContextRef: workContextRefOfParticipation(fromParticipationRef),
        participationRef: fromParticipationRef,
        runRef: fromRunRef,
        roleBinding: payload["roleBinding"],
        required: true,
      },
      attribution,
    );
    if (attribution.length > 0) return rejectWrite(command.commandId, "forbidden", attribution);

    // 引用存在 + 参与活性：发起参与必须 active，且发起 Run 确实 link 在该 Work。
    const from = await this.loadTyped<WorkParticipationSnapshot>(fromParticipationRef, "WorkParticipation");
    if (from === null) return rejectWrite(command.commandId, "not_found", ["发起参与关系不存在：" + fromParticipationRef.participationId]);
    if (from.participation.status !== "active") {
      return rejectWrite(command.commandId, "forbidden", ["发起参与关系不是 active：" + from.participation.status]);
    }
    const fromBinding = await this.loadTyped<WorkContextBindingSnapshot>(from.participation.workContextRef, "WorkContextBinding");
    if (fromBinding === null) return rejectWrite(command.commandId, "not_found", ["发起 Work 不存在：" + from.participation.workContextRef.workId]);
    if (!runLinkedInBinding(fromBinding, fromRunRef)) {
      return rejectWrite(command.commandId, "forbidden", [
        "发起 Run 没有 link 在发起 Work 上：" + fromRunRef.runId + " @ " + from.participation.workContextRef.workId,
      ]);
    }
    const fromRun = await this.loadTyped<RunSnapshot>(fromRunRef as AggregateRef, "Run");
    if (fromRun === null) return rejectWrite(command.commandId, "not_found", ["发起 Run 不存在：" + fromRunRef.runId]);

    // 目标 Work 必须存在且 active。
    const target = await this.loadTyped<WorkContextBindingSnapshot>(toWorkContextRef, "WorkContextBinding");
    if (target === null) return rejectWrite(command.commandId, "not_found", ["目标 Work 不存在：" + toWorkContextRef.workId]);
    if (target.binding.status !== "active") {
      return rejectWrite(command.commandId, "forbidden", ["目标 Work 不是 active：" + String(target.binding.status)]);
    }

    // 并发校验：expectedParticipationRef 必须仍然存在、active 且属于目标 Work；
    // 不匹配一律 stale_participation（**不**偷偷转投给「现在那边是谁」）。
    const expected = payload["expectedParticipationRef"];
    if (expected !== null && expected !== undefined) {
      const expectedRef = expected as WorkParticipationRef;
      const expectedSnapshot = await this.loadTyped<WorkParticipationSnapshot>(expectedRef, "WorkParticipation");
      if (expectedSnapshot === null) {
        return rejectWrite(command.commandId, "stale_participation", ["expectedParticipationRef 已不存在：" + expectedRef.participationId]);
      }
      if (expectedSnapshot.participation.status !== "active") {
        return rejectWrite(command.commandId, "stale_participation", ["expectedParticipationRef 不是 active：" + expectedSnapshot.participation.status]);
      }
      if (canonicalJson(expectedSnapshot.participation.workContextRef) !== canonicalJson(toWorkContextRef)) {
        return rejectWrite(command.commandId, "stale_participation", ["expectedParticipationRef 不属于目标 Work"]);
      }
    }

    const sourceRefs: { kind: string; refId: string; revision: string }[] = [
      { kind: "participation", refId: fromParticipationRef.participationId, revision: String(from.revision) },
      { kind: "run", refId: fromRunRef.runId, revision: String(fromRun.revision) },
      { kind: "work", refId: toWorkContextRef.workId, revision: String(target.revision) },
    ];

    // CM-1A-001 第 4 步：DirectedRequestSent 是可路由源事件 → 同事务登记待路由 intent。
    const sendPlan = await this.routeIntentPlanFor("DirectedRequestSent", workspaceId as string, this.deps.now(), command.identity.projectId);
    const batch = withRouteIntentPlan(buildDirectedRequestSendCommit({
      command,
      deps: this.foldDeps(workspaceId as string),
      fingerprint: sendDirectedRequestFingerprint(command),
      sourceRefs,
    }), sendPlan);
    const receipt = await this.deps.ledger.commit(batch);
    return mapCommitReceipt(receipt, command.commandId, canonicalJson(batch.snapshots[0]!.ref));
  }

  // --------------------------------------------------------------------- //
  // 4. respondDirectedRequest                                              //
  // --------------------------------------------------------------------- //

  async respondDirectedRequest(command: RespondDirectedRequestCommand): Promise<CommunicationWriteReceipt> {
    const issues: string[] = [];
    checkCommandShape(command, "RespondDirectedRequest", issues);
    const payload = (command.payload ?? {}) as Record<string, unknown>;
    const workspaceId = requireString(payload["workspaceId"], "payload.workspaceId", issues);
    const scopeWorkspace = workspaceId ?? "";
    checkParticipationRef(payload["respondingParticipationRef"], "payload.respondingParticipationRef", command.identity.projectId, scopeWorkspace, issues);
    checkRunRef(payload["respondingRunRef"], "payload.respondingRunRef", command.identity.projectId, issues);
    if (typeof command.expectedRevision !== "number" || !Number.isInteger(command.expectedRevision) || command.expectedRevision < 1) {
      issues.push("expectedRevision 必须是当前 DirectedRequest 的正整数 revision");
    }
    const response = asRecord(payload["response"]);
    if (response === null) {
      issues.push("payload.response 必须是 ReportMaterialV1");
    } else {
      checkArtifactRef(response["bodyRef"], "payload.response.bodyRef", issues);
      checkRunRef(response["authorRunRef"], "payload.response.authorRunRef", command.identity.projectId, issues);
      if (!Array.isArray(response["sourceRefs"])) issues.push("payload.response.sourceRefs 必须是数组");
    }
    if (issues.length > 0) return rejectWrite(command.commandId, "invalid", issues);

    const respondingParticipationRef = payload["respondingParticipationRef"] as WorkParticipationRef;
    const respondingRunRef = payload["respondingRunRef"] as RunSnapshot["ref"];
    const responseRecord = payload["response"] as {
      bodyRef: DeliveryV1["bodyRef"];
      sourceRefs: { kind: string; refId: string; revision: string }[];
      authorRunRef: RunSnapshot["ref"];
    };
    // 诚实归因：报告作者必须就是本次回应的 Run，不允许替别人署名。
    if (canonicalJson(responseRecord.authorRunRef) !== canonicalJson(respondingRunRef)) {
      return rejectWrite(command.commandId, "invalid", ["payload.response.authorRunRef 必须等于 payload.respondingRunRef"]);
    }

    const attribution: string[] = [];
    checkAgentAttribution(
      command.identity,
      {
        agentInstanceId: command.identity.actor.kind === "agent" ? command.identity.actor.id : "",
        workContextRef: workContextRefOfParticipation(respondingParticipationRef),
        participationRef: respondingParticipationRef,
        runRef: respondingRunRef,
        roleBinding: payload["roleBinding"],
        required: true,
      },
      attribution,
    );
    if (attribution.length > 0) return rejectWrite(command.commandId, "forbidden", attribution);

    // 请求必须存在且处于「可以被回应」的状态（未 cancelled/expired/closed）。
    const requestRef: DirectedRequestRef = directedRequestRefFor(
      command.identity.projectId,
      workspaceId as string,
      command.aggregateId,
    );
    const prior = await this.loadTyped<DirectedRequestSnapshot>(requestRef, "DirectedRequest");
    if (prior === null) return rejectWrite(command.commandId, "not_found", ["DirectedRequest 不存在：" + command.aggregateId]);
    if (prior.request.status !== "submitted" && prior.request.status !== "routed") {
      return rejectWrite(command.commandId, "forbidden", ["DirectedRequest 当前状态不可回应：" + prior.request.status]);
    }

    // 回应者必须是目标 Work 的 active 参与，且回应 Run 确实 link 在该 Work。
    const participation = await this.loadTyped<WorkParticipationSnapshot>(respondingParticipationRef, "WorkParticipation");
    if (participation === null) return rejectWrite(command.commandId, "not_found", ["回应参与关系不存在：" + respondingParticipationRef.participationId]);
    if (participation.participation.status !== "active") {
      return rejectWrite(command.commandId, "forbidden", ["回应参与关系不是 active：" + participation.participation.status]);
    }
    if (canonicalJson(participation.participation.workContextRef) !== canonicalJson(prior.request.toWorkContextRef)) {
      return rejectWrite(command.commandId, "forbidden", ["只有请求的目标 Work 才能回应"]);
    }
    const targetBinding = await this.loadTyped<WorkContextBindingSnapshot>(prior.request.toWorkContextRef, "WorkContextBinding");
    if (targetBinding === null) return rejectWrite(command.commandId, "not_found", ["目标 Work 不存在：" + prior.request.toWorkContextRef.workId]);
    if (!runLinkedInBinding(targetBinding, respondingRunRef)) {
      return rejectWrite(command.commandId, "forbidden", ["回应 Run 没有 link 在目标 Work 上：" + respondingRunRef.runId]);
    }

    // CAS 期望版本：先于 ledger 判定，给出明确的 revision_conflict 与当前版本。
    if (prior.revision !== command.expectedRevision) {
      return rejectWrite(command.commandId, "revision_conflict", undefined, prior.revision);
    }

    // CM-1A-001 第 4 步：DirectedRequestResponded 是可路由源事件 → 同事务登记待路由 intent。
    const respondPlan = await this.routeIntentPlanFor("DirectedRequestResponded", workspaceId as string, this.deps.now(), command.identity.projectId);
    const batch = withRouteIntentPlan(buildDirectedRequestRespondCommit({
      command,
      deps: this.foldDeps(workspaceId as string),
      fingerprint: respondDirectedRequestFingerprint(command),
      prior,
    }), respondPlan);
    const receipt = await this.deps.ledger.commit(batch);
    return mapCommitReceipt(receipt, command.commandId, canonicalJson(requestRef));
  }

  // --------------------------------------------------------------------- //
  // 5. createSubscription                                                  //
  // --------------------------------------------------------------------- //

  async createSubscription(command: SubscribeCommand): Promise<CommunicationWriteReceipt> {
    const issues: string[] = [];
    checkCommandShape(command, "CreateSubscription", issues);
    const payload = (command.payload ?? {}) as Record<string, unknown>;
    const workspaceId = requireString(payload["workspaceId"], "payload.workspaceId", issues);
    const scopeWorkspace = workspaceId ?? "";
    checkWorkContextRef(payload["ownerWorkContextRef"], "payload.ownerWorkContextRef", command.identity.projectId, scopeWorkspace, issues);
    checkParticipationRef(payload["ownerParticipationRef"], "payload.ownerParticipationRef", command.identity.projectId, scopeWorkspace, issues);
    if (command.expectedRevision !== 0) issues.push("expectedRevision 必须是 0（订阅只创建一次）");
    const topics = payload["topics"];
    if (!Array.isArray(topics)) {
      issues.push("payload.topics 必须是数组");
    } else {
      if (topics.length > SUBSCRIPTION_MAX_TOPICS) {
        issues.push("payload.topics 超过上界 " + String(SUBSCRIPTION_MAX_TOPICS));
      }
      const seen = new Set<string>();
      for (const topic of topics) {
        if (typeof topic !== "string" || topic.length === 0) {
          issues.push("payload.topics 每一项都必须是非空字符串");
          break;
        }
        if (seen.has(topic)) {
          issues.push("payload.topics 不允许重复：" + topic);
          break;
        }
        seen.add(topic);
      }
    }
    const startCursor = payload["startCursor"];
    if (startCursor !== null && startCursor !== undefined && !isLedgerCursor(startCursor)) {
      issues.push("payload.startCursor 必须是账本游标或 null");
    }
    if (issues.length > 0) {
      const overLimit = topics !== undefined && Array.isArray(topics) && topics.length > SUBSCRIPTION_MAX_TOPICS;
      return rejectWrite(command.commandId, overLimit ? "over_limit" : "invalid", issues);
    }

    const ownerWorkContextRef = payload["ownerWorkContextRef"] as WorkContextRef;
    const ownerParticipationRef = payload["ownerParticipationRef"] as WorkParticipationRef;

    const attribution: string[] = [];
    checkAgentAttribution(
      command.identity,
      {
        agentInstanceId: command.identity.actor.kind === "agent" ? command.identity.actor.id : "",
        workContextRef: ownerWorkContextRef,
        participationRef: ownerParticipationRef,
        runRef: command.identity.actor.kind === "agent" ? command.identity.actor.runRef : ({ aggregateType: "Run", projectId: "", goalId: "", runId: "" } as RunSnapshot["ref"]),
        required: true,
      },
      attribution,
    );
    if (attribution.length > 0) return rejectWrite(command.commandId, "forbidden", attribution);

    const participation = await this.loadTyped<WorkParticipationSnapshot>(ownerParticipationRef, "WorkParticipation");
    if (participation === null) return rejectWrite(command.commandId, "not_found", ["owner participation 不存在：" + ownerParticipationRef.participationId]);
    if (participation.participation.status !== "active") {
      return rejectWrite(command.commandId, "forbidden", ["owner participation 不是 active：" + participation.participation.status]);
    }
    if (canonicalJson(participation.participation.workContextRef) !== canonicalJson(ownerWorkContextRef)) {
      return rejectWrite(command.commandId, "forbidden", ["owner participation 不属于 owner Work"]);
    }
    const ownerBinding = await this.loadTyped<WorkContextBindingSnapshot>(ownerWorkContextRef, "WorkContextBinding");
    if (ownerBinding === null) return rejectWrite(command.commandId, "not_found", ["owner Work 不存在：" + ownerWorkContextRef.workId]);

    const foldDeps = this.foldDeps(workspaceId as string);
    const batch = buildSubscriptionCreateCommit({
      command,
      deps: foldDeps,
      fingerprint: subscribeFingerprint(command),
    });
    const receipt = await this.deps.ledger.commit(batch);
    return mapCommitReceipt(receipt, command.commandId, canonicalJson(batch.snapshots[0]!.ref));
  }

  // --------------------------------------------------------------------- //
  // 6. registerWait（deadline 非空时同事务建立 wait_deadline intent）        //
  // --------------------------------------------------------------------- //

  async registerWait(command: RegisterWaitCommand): Promise<CommunicationWriteReceipt> {
    const issues: string[] = [];
    checkCommandShape(command, "RegisterWait", issues);
    const payload = (command.payload ?? {}) as Record<string, unknown>;
    const workspaceId = requireString(payload["workspaceId"], "payload.workspaceId", issues);
    const scopeWorkspace = workspaceId ?? "";
    checkWorkContextRef(payload["ownerWorkContextRef"], "payload.ownerWorkContextRef", command.identity.projectId, scopeWorkspace, issues);
    checkParticipationRef(payload["ownerParticipationRef"], "payload.ownerParticipationRef", command.identity.projectId, scopeWorkspace, issues);
    checkRunRef(payload["predecessorRunRef"], "payload.predecessorRunRef", command.identity.projectId, issues);
    if (command.expectedRevision !== 0) issues.push("expectedRevision 必须是 0（等待只注册一次）");
    const conditions = payload["conditions"];
    const mode = payload['mode'] === undefined ? 'all' : payload['mode'];
    if (mode !== 'all' && mode !== 'any') issues.push('payload.mode must be all or any');
    if (mode === 'any' && Array.isArray(conditions) && conditions.some(term => (term as { kind?: string })?.kind === 'request_closed')) {
      issues.push('any waits require optional reports; request closure is not a report');
    }
    if (!Array.isArray(conditions) || conditions.length === 0) {
      issues.push("payload.conditions 至少要有 1 条条件");
    } else if (conditions.length > WAIT_MAX_CONDITIONS) {
      issues.push("payload.conditions 超过上界 " + String(WAIT_MAX_CONDITIONS));
    } else {
      conditions.forEach((term, index) => checkWaitTerm(term, "payload.conditions[" + String(index) + "]", command.identity.projectId, scopeWorkspace, issues));
    }
    const deadlineAt = payload["deadlineAt"];
    if (deadlineAt !== null && deadlineAt !== undefined) {
      if (typeof deadlineAt !== "string" || Number.isNaN(Date.parse(deadlineAt))) {
        issues.push("payload.deadlineAt 必须是可解析的时间戳或 null");
      }
    }
    if (issues.length > 0) {
      const count = Array.isArray(conditions) ? conditions.length : 0;
      return rejectWrite(command.commandId, count > WAIT_MAX_CONDITIONS ? "over_limit" : "invalid", issues);
    }

    const ownerWorkContextRef = payload["ownerWorkContextRef"] as WorkContextRef;
    const ownerParticipationRef = payload["ownerParticipationRef"] as WorkParticipationRef;
    const predecessorRunRef = payload["predecessorRunRef"] as RunSnapshot["ref"];

    const attribution: string[] = [];
    checkAgentAttribution(
      command.identity,
      {
        agentInstanceId: command.identity.actor.kind === "agent" ? command.identity.actor.id : "",
        workContextRef: ownerWorkContextRef,
        participationRef: ownerParticipationRef,
        runRef: predecessorRunRef,
        required: true,
      },
      attribution,
    );
    if (attribution.length > 0) return rejectWrite(command.commandId, "forbidden", attribution);

    const participation = await this.loadTyped<WorkParticipationSnapshot>(ownerParticipationRef, "WorkParticipation");
    if (participation === null) return rejectWrite(command.commandId, "not_found", ["owner participation 不存在：" + ownerParticipationRef.participationId]);
    if (participation.participation.status !== "active") {
      return rejectWrite(command.commandId, "forbidden", ["owner participation 不是 active：" + participation.participation.status]);
    }
    if (canonicalJson(participation.participation.workContextRef) !== canonicalJson(ownerWorkContextRef)) {
      return rejectWrite(command.commandId, "forbidden", ["owner participation 不属于 owner Work"]);
    }
    const ownerBinding = await this.loadTyped<WorkContextBindingSnapshot>(ownerWorkContextRef, "WorkContextBinding");
    if (ownerBinding === null) return rejectWrite(command.commandId, "not_found", ["owner Work 不存在：" + ownerWorkContextRef.workId]);
    const predecessor = await this.loadTyped<RunSnapshot>(predecessorRunRef as AggregateRef, "Run");
    if (predecessor === null) return rejectWrite(command.commandId, "not_found", ["前驱 Run 不存在：" + predecessorRunRef.runId]);
    if (!runLinkedInBinding(ownerBinding, predecessorRunRef)) {
      return rejectWrite(command.commandId, "forbidden", ["前驱 Run 没有 link 在 owner Work 上：" + predecessorRunRef.runId]);
    }

    const foldDeps = this.foldDeps(workspaceId as string);
    const batch = buildWaitRegisterCommit({
      command,
      deps: foldDeps,
      fingerprint: registerWaitFingerprint(command),
      intent: waitDeadlineIntentFor(command, foldDeps),
    });
    const receipt = await this.deps.ledger.commit(batch);
    return mapCommitReceipt(receipt, command.commandId, canonicalJson(batch.snapshots[0]!.ref));
  }

  // --------------------------------------------------------------------- //
  // 7. cancelCommunication（desired-state-first）                           //
  // --------------------------------------------------------------------- //

  async cancelCommunication(command: CancelCommunicationCommand): Promise<CommunicationWriteReceipt> {
    const issues: string[] = [];
    checkCommandShape(command, "CancelCommunication", issues);
    const payload = (command.payload ?? {}) as Record<string, unknown>;
    const workspaceId = requireString(payload["workspaceId"], "payload.workspaceId", issues);
    requireString(payload["reason"], "payload.reason", issues);
    const target = payload["target"];
    if (target !== "directed_request" && target !== "subscription" && target !== "wait") {
      issues.push("payload.target 必须是 directed_request|subscription|wait");
    }
    if (typeof command.expectedRevision !== "number" || !Number.isInteger(command.expectedRevision) || command.expectedRevision < 1) {
      issues.push("expectedRevision 必须是当前聚合的正整数 revision");
    }
    if (issues.length > 0) return rejectWrite(command.commandId, "invalid", issues);

    const projectId = command.identity.projectId;
    const scopeWorkspace = workspaceId as string;
    const foldDeps = this.foldDeps(scopeWorkspace);

    if (target === "directed_request") {
      const ref = directedRequestRefFor(projectId, scopeWorkspace, command.aggregateId);
      const prior = await this.loadTyped<DirectedRequestSnapshot>(ref, "DirectedRequest");
      if (prior === null) return rejectWrite(command.commandId, "not_found", ["DirectedRequest 不存在：" + command.aggregateId]);
      if (prior.request.status === "cancelled" || prior.request.status === "expired") {
        return rejectWrite(command.commandId, "forbidden", ["DirectedRequest 已经是终态：" + prior.request.status]);
      }
      if (prior.revision !== command.expectedRevision) {
        return rejectWrite(command.commandId, "revision_conflict", undefined, prior.revision);
      }
      const batch = buildDirectedRequestCancelCommit({
        command,
        deps: foldDeps,
        fingerprint: cancelCommunicationFingerprint(command),
        prior,
      });
      const receipt = await this.deps.ledger.commit(batch);
      return mapCommitReceipt(receipt, command.commandId, canonicalJson(ref));
    }

    if (target === "subscription") {
      const ref = subscriptionRefFor(projectId, scopeWorkspace, command.aggregateId);
      const prior = await this.loadTyped<SubscriptionSnapshot>(ref, "Subscription");
      if (prior === null) return rejectWrite(command.commandId, "not_found", ["Subscription 不存在：" + command.aggregateId]);
      if (prior.subscription.status === "cancelled") {
        return rejectWrite(command.commandId, "forbidden", ["Subscription 已经取消"]);
      }
      if (prior.revision !== command.expectedRevision) {
        return rejectWrite(command.commandId, "revision_conflict", undefined, prior.revision);
      }
      const batch = buildSubscriptionCancelCommit({
        command,
        deps: foldDeps,
        fingerprint: cancelCommunicationFingerprint(command),
        prior,
      });
      const receipt = await this.deps.ledger.commit(batch);
      return mapCommitReceipt(receipt, command.commandId, canonicalJson(ref));
    }

    const ref = waitConditionRefFor(projectId, scopeWorkspace, command.aggregateId);
    const prior = await this.loadTyped<WaitConditionSnapshot>(ref, "WaitCondition");
    if (prior === null) return rejectWrite(command.commandId, "not_found", ["WaitCondition 不存在：" + command.aggregateId]);
    if (prior.wait.status !== "active") {
      return rejectWrite(command.commandId, "forbidden", ["WaitCondition 已经不是 active：" + prior.wait.status]);
    }
    if (prior.revision !== command.expectedRevision) {
      return rejectWrite(command.commandId, "revision_conflict", undefined, prior.revision);
    }
    // desired-state-first：等待先写 cancelled；它自己的 deadline intent（本票唯一的
    // 定时 intent）在同一事务里被置为终态，因此任何在途消费者之后的 settle 都会被拒
    // （见 settleCommunicationIntent 的「已终态不得再 settle」守卫）。
    const deadlineIntent = await this.loadTyped<CommunicationIntentSnapshot>(
      communicationIntentRefForOf(projectId, scopeWorkspace, waitDeadlineIntentIdFor(command.aggregateId)),
      "CommunicationIntent",
    );
    const batch = buildWaitCancelCommit({
      command,
      deps: foldDeps,
      fingerprint: cancelCommunicationFingerprint(command),
      prior,
      intent: deadlineIntent !== null && isTerminalIntentStatus(deadlineIntent.intent.status) ? null : deadlineIntent,
    });
    const receipt = await this.deps.ledger.commit(batch);
    if (receipt.status === "committed") {
      /**
       * **先持久化取消意图，再调用执行能力**（CM-1A-001 第 4 步 / A07）。
       *
       * desired state 已经在上面落账（wait = cancelled）。这之后仍可能被触发的是**由这个等待
       * 派生出来的机械 intent**：deadline intent 已在同一事务里终态化，而 wait_admission intent
       * 不在（它由 ensureWaitAdmission 在别的事务里建立，可能正 pending/leased）。若不标记它们，
       * 一个已取消的等待仍会不断被重新领取并调用 admitWaitSuccessor——那正是「取消意图没有先落账」
       * 的典型后果。这里只**标记**（零副作用）：真正的收敛由消费者在拿到当前 generation 后按
       * 租约与 sideEffectStarted 判定（见 CoordinationDrive.convergeCancelled）。
       */
      for (const intentRef of await this.derivedIntentsOfWait(ref, prior.revision)) {
        const loaded = await this.loadTyped<CommunicationIntentSnapshot>(intentRef, "CommunicationIntent");
        if (loaded === null) continue;
        if (isTerminalIntentStatus(loaded.intent.status) || loaded.intent.status === "quarantined") continue;
        const cancelId = "cancel-wait-" + command.aggregateId + "-" + loaded.intent.intentId + "-r" + String(loaded.revision);
        await this.requestCommunicationIntentCancellation({
          commandId: cancelId,
          commandType: "RequestCommunicationIntentCancellation",
          schemaVersion: 1,
          aggregateId: loaded.intent.intentId,
          expectedRevision: loaded.revision,
          correlationId: cancelId,
          submittedAt: this.deps.now(),
          identity: { projectId, actor: { kind: "system", id: "coordination-cancel" }, idempotencyKey: cancelId },
          payload: { workspaceId: scopeWorkspace, reason: "所属等待已被取消：" + command.aggregateId },
        });
      }
    }
    return mapCommitReceipt(receipt, command.commandId, canonicalJson(ref));
  }

  /**
   * 某个等待派生出来的机械 intent 的**确定性引用集合**。
   *
   * 两条派生规则（与生产者一一对应）：
   *   · wait_deadline：intentId = waitDeadlineIntentIdFor(waitId)，恰好一个；
   *   · wait_admission：intentId = waitAdmissionIntentIdFor(waitId, satisfiedRevision)，而
   *     satisfiedRevision 在建立时等于「当时的 wait.revision + 1」。wait 只会前进，因此历史上
   *     建立过的那些 satisfiedRevision 一定落在 1..(当前 revision + 1) 内——按 id 逐个探测就能
   *     **完整**枚举，不需要全量事件扫描，也不会猜到不存在的 id。
   */
  private async derivedIntentsOfWait(waitRef: WaitConditionRef, currentRevision: number): Promise<CommunicationIntentRef[]> {
    const refs: CommunicationIntentRef[] = [
      communicationIntentRefFor(waitRef.projectId, waitRef.workspaceId, waitDeadlineIntentIdFor(waitRef.waitId)),
    ];
    for (let satisfiedRevision = 1; satisfiedRevision <= currentRevision + 1; satisfiedRevision += 1) {
      refs.push(communicationIntentRefFor(waitRef.projectId, waitRef.workspaceId, waitAdmissionIntentIdFor(waitRef.waitId, satisfiedRevision)));
    }
    return refs;
  }


  // --------------------------------------------------------------------- //
  // 7b. requestCommunicationIntentCancellation（先持久化取消意图）              //
  // --------------------------------------------------------------------- //

  /**
   * **先持久化取消意图**（CM-1A-001 第 4 步 / A07）。
   *
   * 允许的输入状态：pending / leased / retry_scheduled（未终态、未被人工隔离）。
   * 已终态（done/cancelled/outcome_unknown）与 quarantined 一律零写入拒绝：前者已经结束，
   * 后者是人工处置态，不能被自动流程改写成另一种状态。
   * **不发放新 generation**：已经产生的副作用不会因为这次标记而消失——收敛阶段必须继续看到
   * 同一个 generation 与 sideEffectStarted。
   */
  async requestCommunicationIntentCancellation(command: RequestIntentCancellationCommand): Promise<CommunicationWriteReceipt> {
    const issues: string[] = [];
    checkCommandShape(command, "RequestCommunicationIntentCancellation", issues);
    const payload = (command.payload ?? {}) as Record<string, unknown>;
    const workspaceId = requireString(payload["workspaceId"], "payload.workspaceId", issues);
    requireString(payload["reason"], "payload.reason", issues);
    if (typeof command.expectedRevision !== "number" || !Number.isInteger(command.expectedRevision) || command.expectedRevision < 1) {
      issues.push("expectedRevision 必须是当前 CommunicationIntent 的正整数 revision");
    }
    if (issues.length > 0) return rejectWrite(command.commandId, "invalid", issues);
    const scopeWorkspace = workspaceId as string;
    const intentRef = communicationIntentRefFor(command.identity.projectId, scopeWorkspace, command.aggregateId);
    const prior = await this.loadTyped<CommunicationIntentSnapshot>(intentRef, "CommunicationIntent");
    if (prior === null) return rejectWrite(command.commandId, "not_found", ["CommunicationIntent 不存在：" + command.aggregateId]);
    if (isTerminalIntentStatus(prior.intent.status) || prior.intent.status === "quarantined") {
      return rejectWrite(command.commandId, "forbidden", ["intent 已经终态或已隔离，不能再标记取消：" + prior.intent.status]);
    }
    if (prior.revision !== command.expectedRevision) {
      return rejectWrite(command.commandId, "revision_conflict", undefined, prior.revision);
    }
    if (prior.intent.status === "cancel_requested") {
      // 已经标记过：同一条命令身份的重放交给账本判定；不同身份再来一次是幂等命中，不新写事实。
      return { status: "committed", commandId: command.commandId, replayed: true, eventIds: [], commitCursor: "c0000000001" as CommitCursor, revisions: [{ refKey: canonicalJson(intentRef as never), revision: prior.revision }] };
    }
    const batch = buildIntentCancelRequestCommit({
      command,
      deps: this.foldDeps(scopeWorkspace),
      fingerprint: requestIntentCancellationFingerprint(command),
      prior,
    });
    const receipt = await this.deps.ledger.commit(batch);
    return mapCommitReceipt(receipt, command.commandId, canonicalJson(intentRef));
  }

  // --------------------------------------------------------------------- //
  // 8. claimCommunicationIntent                                            //
  // --------------------------------------------------------------------- //

  async claimCommunicationIntent(command: CommunicationClaimCommand): Promise<CommunicationClaimReceipt> {
    const issues: string[] = [];
    checkCommandShape(command, "CommunicationClaimIntent", issues);
    const payload = (command.payload ?? {}) as Record<string, unknown>;
    const workspaceId = requireString(payload["workspaceId"], "payload.workspaceId", issues);
    requireString(payload["consumerId"], "payload.consumerId", issues);
    const leaseDurationMs = payload["leaseDurationMs"];
    if (typeof leaseDurationMs !== "number" || !Number.isFinite(leaseDurationMs) || leaseDurationMs < 0) {
      issues.push("payload.leaseDurationMs 必须是非负数字");
    }
    const now = requireIsoTimestamp(payload["now"], "payload.now", issues);
    if (issues.length > 0) {
      return { status: "rejected", commandId: command.commandId, code: "invalid", issues };
    }

    const projectId = command.identity.projectId;
    const intentRef = communicationIntentRefFor(projectId, workspaceId as string, command.aggregateId);
    const prior = await this.loadTyped<CommunicationIntentSnapshot>(intentRef, "CommunicationIntent");
    if (prior === null) {
      return { status: "not_found", commandId: command.commandId, intentRef };
    }

    const decision = decideIntentClaim({
      intent: prior.intent,
      consumerId: payload["consumerId"] as string,
      now: now as string,
    });
    if (!decision.allow) {
      if (decision.code === "owned_elsewhere") {
        return {
          status: "owned_elsewhere",
          commandId: command.commandId,
          intentRef,
          leaseOwner: prior.intent.leaseOwner,
          leaseExpiresAt: prior.intent.leaseExpiresAt,
        };
      }
      // not_claimable / requires_reconcile / cancel_requested：claim receipt 的联合类型
      // 里没有对应码，按既有语义映射为 rejected + 机器可读的 issues 前缀，绝不改写成 claimed。
      // 三种不可领取的原因分别写进 issues，调用方据此决定对账/等待/放弃：
      //   - requires_reconcile（已产生外部副作用且租约过期）→ 绝不能重新领取，必须先对账；
      //   - cancel_requested → desired-state 已写，不再发放新 generation；
      //   - not_claimable（未到 availableAt 或已是终态）→ 稍后重试。
      // 三者都映射为 code=invalid，且**零写入**（见文件头守卫顺序）。
      return {
        status: "rejected",
        commandId: command.commandId,
        code: "invalid",
        issues: [
          decision.code + "：intent 当前不可领取（status=" + prior.intent.status +
          "，leaseGeneration=" + String(prior.intent.leaseGeneration) +
          "，sideEffectStarted=" + String(prior.intent.sideEffectStarted) + "）",
        ],
      };
    }

    // CAS 期望版本：先于 ledger 判定，给出明确的 revision_conflict 与当前版本。
    if (prior.revision !== command.expectedRevision) {
      return { status: "rejected", commandId: command.commandId, code: "revision_conflict", currentRevision: prior.revision };
    }

    const batch = buildCommunicationIntentClaimCommit({
      command,
      deps: this.foldDeps(workspaceId as string),
      fingerprint: communicationClaimFingerprint(command),
      prior,
      nextGeneration: decision.nextGeneration,
    });
    const receipt = await this.deps.ledger.commit(batch);
    if (receipt.status === "committed") {
      const claimed = batch.snapshots[0]!;
      return {
        status: "claimed",
        commandId: command.commandId,
        intentRef,
        leaseGeneration: claimed.intent.leaseGeneration,
        leaseOwner: claimed.intent.leaseOwner as string,
        leaseExpiresAt: claimed.intent.leaseExpiresAt as string,
        revision: claimed.revision,
        replayed: receipt.replayed,
        commitCursor: receipt.commitCursor,
      };
    }
    if (receipt.code === "revision_conflict") {
      const current = (receipt.currentVersions ?? []).find((v) => canonicalJson(v.ref) === canonicalJson(intentRef));
      return current === undefined
        ? { status: "rejected", commandId: command.commandId, code: "revision_conflict" }
        : { status: "rejected", commandId: command.commandId, code: "revision_conflict", currentRevision: current.revision };
    }
    return {
      status: "rejected",
      commandId: command.commandId,
      code: receipt.code === "idempotency_conflict" ? "idempotency_conflict"
        : receipt.code === "unavailable" ? "unavailable" : "invalid",
    };
  }

  // --------------------------------------------------------------------- //
  // 9. settleCommunicationIntent                                           //
  // --------------------------------------------------------------------- //

  async settleCommunicationIntent(command: CommunicationSettleCommand): Promise<CommunicationSettleReceipt> {
    const issues: string[] = [];
    checkCommandShape(command, "CommunicationSettleIntent", issues);
    const payload = (command.payload ?? {}) as Record<string, unknown>;
    const workspaceId = requireString(payload["workspaceId"], "payload.workspaceId", issues);
    requireString(payload["consumerId"], "payload.consumerId", issues);
    const leaseGeneration = payload["leaseGeneration"];
    if (typeof leaseGeneration !== "number" || !Number.isInteger(leaseGeneration) || leaseGeneration < 0) {
      issues.push("payload.leaseGeneration 必须是非负整数");
    }
    const outcome = payload["outcome"];
    if (outcome === "route_page") {
      checkRoutePageProposal(payload["page"], command.identity.projectId, workspaceId as string, issues);
    } else if (outcome === "wait_deadline") {
      checkWaitConditionRefShape(payload["waitRef"], "payload.waitRef", command.identity.projectId, workspaceId as string, issues);
      if (payload["observedStatus"] !== "active") issues.push('payload.observedStatus 必须是 "active"');
    } else if (outcome === "cancel_confirmed" || outcome === "catchup_page") {
      // 无附加字段。
    } else if (outcome === "unknown" || outcome === "quarantine" || outcome === "side_effect_started") {
      requireString(payload["reason"], "payload.reason", issues);
    } else if (outcome === "no_effect_failure") {
      requireString(payload["reason"], "payload.reason", issues);
      const backoffMs = payload["backoffMs"];
      if (typeof backoffMs !== "number" || !Number.isFinite(backoffMs) || backoffMs < 0) {
        issues.push("payload.backoffMs 必须是非负数字");
      }
    } else {
      issues.push("payload.outcome 必须是 route_page|wait_deadline|cancel_confirmed|unknown|quarantine|no_effect_failure|side_effect_started");
    }
    const settledAt = outcome === null || outcome === undefined
      ? null
      : requireIsoTimestamp(payload["settledAt"], "payload.settledAt", issues);
    if (issues.length > 0) {
      return { status: "rejected", commandId: command.commandId, code: "invalid", issues };
    }

    const projectId = command.identity.projectId;
    const scopeWorkspace = workspaceId as string;
    const intentRef = communicationIntentRefFor(projectId, scopeWorkspace, command.aggregateId);
    const prior = await this.loadTyped<CommunicationIntentSnapshot>(intentRef, "CommunicationIntent");
    if (prior === null) {
      return { status: "rejected", commandId: command.commandId, code: "not_found", issues: ["CommunicationIntent 不存在：" + command.aggregateId] };
    }

    // 过期 generation 不能 settle（desired-state-first 与租约竞争的核心守卫）。
    if (prior.intent.leaseGeneration !== leaseGeneration) {
      return { status: "stale_generation", commandId: command.commandId, intentRef, currentGeneration: prior.intent.leaseGeneration };
    }
    if (isTerminalIntentStatus(prior.intent.status)) {
      return {
        status: "rejected",
        commandId: command.commandId,
        code: "forbidden",
        issues: ["intent 已经是终态，不能重复 settle：" + prior.intent.status],
      };
    }
    const outcomeKind = outcome as string;
    if (prior.intent.leaseOwner !== null && prior.intent.leaseOwner !== command.payload.consumerId) {
      return { status: 'rejected', commandId: command.commandId, code: 'forbidden', issues: ['Only the current lease owner may settle this generation'] };
    }
    if (outcomeKind === 'cancel_confirmed' && prior.intent.sideEffectStarted) {
      return { status: 'rejected', commandId: command.commandId, code: 'forbidden', issues: ['Started side effect requires reconciliation, not an unsupported cancellation confirmation'] };
    }
    /**
     * CM-1A-001 第 4 步：**只有已证实无副作用的失败**才能进入退避重试（协议约束 2.4 / A08）。
     * 这里是权威判定点：intent 一旦标记过 sideEffectStarted，退避请求一律零写入拒绝——
     * 结果不明时必须对账或隔离，不能自动再调用一次。
     */
    if (outcomeKind === "no_effect_failure" && prior.intent.sideEffectStarted) {
      return {
        status: "rejected",
        commandId: command.commandId,
        code: "forbidden",
        issues: ["该 intent 已经产生过外部副作用（sideEffectStarted=true），结果未知时不允许自动重试"],
      };
    }
    /**
     * 哪些 outcome 要求"此刻确实持有租约"：
     *   · route_page / wait_deadline / no_effect_failure / side_effect_started 会推进业务状态或重排
     *     重试，必须来自一次真实领取（status 必须是 leased）；
     *   · cancel_confirmed / unknown / quarantine 是**收口**结果，可以由 cancel_requested 状态收敛
     *     ——取消标记刻意不动租约字段（generation/owner/expiresAt 原样保留），因此"同一 generation
     *     收口"这条不变式仍然成立（上面已逐条核对 generation）。
     */
    const requiresLease = outcomeKind !== "cancel_confirmed" && outcomeKind !== "unknown" && outcomeKind !== "quarantine";
    if (requiresLease && prior.intent.status !== "leased") {
      return {
        status: "rejected",
        commandId: command.commandId,
        code: "forbidden",
        issues: ["intent 当前不是 leased，不能以该 outcome settle：status=" + prior.intent.status],
      };
    }
    if (prior.revision !== command.expectedRevision) {
      return { status: "rejected", commandId: command.commandId, code: "revision_conflict", currentRevision: prior.revision };
    }

    const foldDeps = this.foldDeps(scopeWorkspace);
    const fingerprint = communicationSettleFingerprint(command);

    if (outcomeKind === "catchup_page") return this.settleCatchupPage(command, prior);

    if (outcomeKind === "route_page") {
      const built = await this.buildRoutePage(command, foldDeps, prior, payload, projectId, scopeWorkspace);
      if (built.status === "rejected") return built.receipt;
      /**
       * 落账用的是**归一化之后**的范围（Control 已经逐条复核过；见 buildRoutePage 的收敛说明）。
       * 指纹仍然按调用方提交的命令计算（归一化是 Control 的确定性收敛，不是新的输入面），
       * 因此同一条命令的重放语义不变。
       */
      const committedCommand: CommunicationSettleCommand = command.payload.outcome === "route_page"
        ? { ...command, payload: { ...command.payload, page: { ...command.payload.page, subscriptionScope: built.subscriptionScope } } }
        : command;
      const batch = buildRoutePageCommit({
        command: committedCommand,
        deps: foldDeps,
        fingerprint,
        prior,
        deliveries: built.deliveries,
        subscriptions: built.subscriptions,
        waits: built.waits,
        nextIntent: built.nextIntent,
      });
      const receipt = await this.deps.ledger.commit(batch);
      if (receipt.status !== "committed") {
        const mapped = mapSettleCommitRejection(receipt, command.commandId, canonicalJson(intentRef));
        return mapped;
      }
      return {
        status: "committed",
        commandId: command.commandId,
        replayed: receipt.replayed,
        intentRef,
        intentStatus: "done",
        deliveries: built.deliveries.map((d) => d.ref),
        nextIntentRef: built.nextIntent === null
          ? null
          : communicationIntentRefFor(projectId, scopeWorkspace, built.nextIntent.intentId),
        eventIds: [...receipt.eventIds],
        commitCursor: receipt.commitCursor,
      };
    }

    if (outcomeKind === "wait_deadline") {
      if (prior.intent.domain.kind !== "wait_deadline") {
        return { status: "rejected", commandId: command.commandId, code: "invalid", issues: ["intent 的 domain 不是 wait_deadline"] };
      }
      const waitRef = payload["waitRef"] as WaitConditionRef;
      if (canonicalJson(waitRef) !== canonicalJson(prior.intent.domain.waitRef)) {
        return { status: "rejected", commandId: command.commandId, code: "invalid", issues: ["payload.waitRef 与 intent domain 不一致"] };
      }
      const wait = await this.loadTyped<WaitConditionSnapshot>(waitRef, "WaitCondition");
      if (wait === null) {
        return { status: "rejected", commandId: command.commandId, code: "not_found", issues: ["WaitCondition 不存在：" + waitRef.waitId] };
      }
      // 等待已经不是 active（例如同事务里已被 satisfied/cancelled）：deadline 到点无
      // 事可做，只把 intent 收敛为 done，**不**改写等待。
      if (wait.wait.status !== "active") {
        const batch = buildIntentSettleCommit({ command, deps: foldDeps, fingerprint, prior, status: "done", waits: [] });
        const receipt = await this.deps.ledger.commit(batch);
        if (receipt.status !== "committed") return mapSettleCommitRejection(receipt, command.commandId, canonicalJson(intentRef));
        return {
          status: "committed", commandId: command.commandId, replayed: receipt.replayed, intentRef,
          intentStatus: "done", deliveries: [], nextIntentRef: null,
          eventIds: [...receipt.eventIds], commitCursor: receipt.commitCursor,
        };
      }
      if (wait.wait.deadlineAt === null || wait.wait.deadlineAt > (settledAt as string)) {
        return {
          status: "rejected", commandId: command.commandId, code: "invalid",
          issues: ["deadline 未到，不能按 wait_deadline 收敛：" + String(wait.wait.deadlineAt)],
        };
      }
      const nextWait: WaitConditionSnapshot = {
        ...wait,
        revision: wait.revision + 1,
        wait: { ...wait.wait, status: "timed_out", settledAt: settledAt as string },
        recordedAt: foldDeps.now(),
      };
      // 注意：等待收敛为 timed_out，而 intent 自身收敛为 done——CommunicationIntentStatus
      // 里没有 timed_out（它是等待的业务状态，不是机械调度状态，D01「两类状态不合并」）。
      const batch = buildIntentSettleCommit({ command, deps: foldDeps, fingerprint, prior, status: "done", waits: [nextWait] });
      const receipt = await this.deps.ledger.commit(batch);
      if (receipt.status !== "committed") return mapSettleCommitRejection(receipt, command.commandId, canonicalJson(intentRef));
      return {
        status: "committed", commandId: command.commandId, replayed: receipt.replayed, intentRef,
        intentStatus: "done", deliveries: [], nextIntentRef: null,
        eventIds: [...receipt.eventIds], commitCursor: receipt.commitCursor,
      };
    }

    // no_effect_failure / side_effect_started 是**非终态**：状态由 buildIntentSettleCommit 按
    // outcome 折叠（retry_scheduled + availableAt / 保持 leased + sideEffectStarted），这里给出的
    // status 只对真正的终态分支有意义。
    const status: CommunicationIntentV1["status"] =
      outcomeKind === "cancel_confirmed" ? "cancelled"
      : outcomeKind === "unknown" ? "outcome_unknown"
      : outcomeKind === "no_effect_failure" ? "retry_scheduled"
      : outcomeKind === "side_effect_started" ? "leased"
      : "quarantined";
    const batch = buildIntentSettleCommit({ command, deps: foldDeps, fingerprint, prior, status, waits: [] });
    const receipt = await this.deps.ledger.commit(batch);
    if (receipt.status !== "committed") return mapSettleCommitRejection(receipt, command.commandId, canonicalJson(intentRef));
    return {
      status: "committed", commandId: command.commandId, replayed: receipt.replayed, intentRef,
      intentStatus: status, deliveries: [], nextIntentRef: null,
      eventIds: [...receipt.eventIds], commitCursor: receipt.commitCursor,
    };
  }

  /** One durable historical subscription prefix; all source data is reread canonically. */
  private async settleCatchupPage(command: CommunicationSettleCommand, prior: CommunicationIntentSnapshot): Promise<CommunicationSettleReceipt> {
    const reject = (message: string): CommunicationSettleReceipt => ({ status: 'rejected', commandId: command.commandId, code: 'invalid', issues: [message] });
    const domain = prior.intent.domain;
    if (domain.kind !== 'subscription_catchup' || prior.intent.sideEffectStarted) return reject('Invalid catchup intent');
    const sub = await this.loadTyped<SubscriptionSnapshot>(domain.subscriptionRef, 'Subscription');
    if (!sub || canonicalJson(sub.subscription.catchup?.intentRef ?? null) !== canonicalJson(prior.ref)) return reject('Catchup subscription binding differs');
    const page = await this.deps.ledger.events({ afterCursor: domain.scanCursor, limit: SUBSCRIPTION_MAX_REPLAY_SPAN });
    let selected;
    try { selected = selectCatchupPrefix(domain, sub.subscription, page.events); } catch (error) { return reject(String(error)); }
    const now = this.deps.now();
    const deliveries: DeliverySnapshot[] = [];
    if (selected.source) {
      const source = selected.source;
      const deliveryId = subscriptionDeliveryIdFor({ subscriptionRef: sub.ref, topic: source.topic, cursor: source.cursor, targetWorkContextRef: sub.subscription.ownerWorkContextRef });
      const delivery = pageDelivery({ projectId: sub.ref.projectId, workspaceId: sub.ref.workspaceId, subscription: sub,
        targetWorkContextRef: sub.subscription.ownerWorkContextRef, event: source, deliveryId, createdAt: now });
      const ref = deliveryRefFor(sub.ref.projectId, sub.ref.workspaceId, deliveryId);
      const existing = await this.loadTyped<DeliverySnapshot>(ref, 'Delivery');
      if (existing && canonicalJson({ ...existing.delivery, createdAt: now }) !== canonicalJson(delivery)) return reject('Catchup delivery conflicts with durable content');
      if (!existing) deliveries.push({ ref, revision: 1, schemaVersion: 1, delivery, recordedAt: now });
    }
    const waits: WaitConditionSnapshot[] = [];
    if (selected.source && sub.subscription.status === 'active') {
      const mailbox = await this.mailboxView(sub.subscription.ownerWorkContextRef);
      if (mailbox.status === 'unavailable') return reject(mailbox.reason);
      for (const wait of mailbox.view.waits) {
        if (wait.wait.status !== 'active') continue;
        const indexes = [...wait.wait.satisfiedIndexes];
        for (let i = 0; i < wait.wait.conditions.length; i++) if (!indexes.includes(i) && await this.termSatisfied(wait.wait.conditions[i]!, deliveries)) indexes.push(i);
        indexes.sort((a,b) => a-b);
        const added = indexes.filter(i => !wait.wait.satisfiedIndexes.includes(i));
        if (added.length) waits.push({ ...wait, revision: wait.revision + 1, recordedAt: now, wait: { ...wait.wait, satisfiedIndexes: indexes,
          observations: [...wait.wait.observations, ...added.map(index => ({ index, observedAt: now, note: 'Historical delivery observed' }))] } });
      }
    }
    const status = sub.subscription.status === 'cancelled' ? 'cancelled' : selected.cursor === domain.horizonCursor ? 'done' : 'pending';
    const intent: CommunicationIntentV1 = { ...prior.intent, domain: { ...domain, scanCursor: selected.cursor }, status,
      leaseOwner: null, leaseExpiresAt: null, settledAt: status === 'pending' ? null : now };
    const next: CommunicationIntentSnapshot = { ...prior, revision: prior.revision + 1, intent, recordedAt: now };
    const nextSub: SubscriptionSnapshot = { ...sub, revision: sub.revision + 1, recordedAt: now,
      subscription: { ...sub.subscription, routedThroughCursor: selected.cursor } };
    const ctx = { commandId: command.commandId, correlationId: command.correlationId, occurredAt: now, identity: command.identity };
    const batch: import('../../contracts/coordination.js').SubscriptionCatchupPageCommitV1 = {
      commitKind: 'subscription-catchup-page', schemaVersion: 1, identity: command.identity, fingerprint: communicationSettleFingerprint(command), outboxIntents: [],
      expectedVersions: [{ ref: prior.ref, revision: prior.revision }, { ref: sub.ref, revision: sub.revision },
        ...deliveries.map(d => ({ ref: d.ref, revision: 0 })), ...waits.map(w => ({ ref: w.ref, revision: w.revision - 1 }))],
      snapshots: [next, nextSub, ...deliveries, ...waits],
      events: [communicationIntentSettledEvent(ctx, this.deps.eventId(), intent, next.revision),
        { ...communicationIntentSettledEvent(ctx, this.deps.eventId(), intent, next.revision), eventType: 'SubscriptionCatchupAdvanced',
          aggregateType: 'Subscription', aggregateId: sub.ref.subscriptionId, aggregateRevision: nextSub.revision, payload: { subscription: nextSub.subscription, intent } },
        ...deliveries.map(d => deliveryRecordedEvent(ctx, this.deps.eventId(), d.delivery)), ...waits.map(w => waitConditionObservedEvent(ctx, this.deps.eventId(), w.wait, w.revision))],
    };
    const receipt = await this.deps.ledger.commit(batch);
    if (receipt.status !== 'committed') return mapSettleCommitRejection(receipt, command.commandId, canonicalJson(prior.ref));
    return { status: 'committed', commandId: command.commandId, replayed: receipt.replayed, intentRef: prior.ref, intentStatus: status,
      deliveries: deliveries.map(d => d.ref), nextIntentRef: status === 'pending' ? prior.ref : null, eventIds: receipt.eventIds, commitCursor: receipt.commitCursor };
  }

  /**
   * 路由页的 canonical 复核（Dispatch 的 proposal 只是提议）：
   *   - 每个订阅必须存在；已取消的订阅本页对它 no-op（与纯策略 selectPageSubscriptions 一致）；
   *   - 期望版本必须等于当前 revision，否则 revision_conflict（零写入）；
   *   - 每条投递的目标 Work 必须等于订阅的 owner Work（不允许把正文投给别的 Work）；
   *   - 页内投递按 (source event, subscription, target) 去重；
   *   - wait 条件推进按 index 复核，绝不写入未满足的 index。
   */
  private async buildRoutePage(
    command: CommunicationSettleCommand,
    foldDeps: CoordinationFoldDeps,
    prior: CommunicationIntentSnapshot,
    payload: Record<string, unknown>,
    projectId: string,
    workspaceId: string,
  ): Promise<
    | { status: "ok"; deliveries: DeliverySnapshot[]; subscriptions: SubscriptionSnapshot[]; waits: WaitConditionSnapshot[]; nextIntent: CommunicationIntentV1 | null; subscriptionScope: RoutePageSubscriptionScopeEntry[] }
    | { status: "rejected"; receipt: CommunicationSettleReceipt }
  > {
    const page = payload["page"] as {
      sourceTopic: string;
      sourceCursor: CommitCursor;
      subscriptionPosition: string | null;
      subscriptionScope: RoutePageSubscriptionScopeEntry[];
      subscriptions: {
        subscriptionRef: SubscriptionRef;
        expectedRevision: number;
        deliveries: { deliveryId: string; targetWorkContextRef: WorkContextRef; bodyRef: DeliveryV1["bodyRef"]; sourceRefs: { kind: string; refId: string; revision: string }[] }[];
        satisfiedWaitIndexes: { waitRef: WaitConditionRef; indexes: number[] }[];
      }[];
      hasMore: boolean;
    };
    if (prior.intent.domain.kind !== "route_page") {
      return { status: "rejected", receipt: { status: "rejected", commandId: command.commandId, code: "invalid", issues: ["intent 的 domain 不是 route_page"] } };
    }
    const priorPosition = prior.intent.domain.subscriptionPosition;
    const sourceSeq = seqOfCommitCursor(page.sourceCursor);
    const sourcePage = await this.deps.ledger.events({ afterCursor: sourceSeq > 1 ? makeCommitCursor(sourceSeq - 1) : null, limit: 1 });
    const row = sourcePage.events[0];
    const source = row?.cursor === page.sourceCursor ? communicationSource(row.event, row.cursor) : null;
    if (page.subscriptions.length && (!source || source.projectId !== projectId || source.workspaceId !== workspaceId || source.topic !== page.sourceTopic)) {
      return { status: 'rejected', receipt: { status: 'rejected', commandId: command.commandId, code: 'invalid', issues: ['Route page source does not exist in this scope'] } };
    }
    if (prior.intent.domain.subscriptionScope.length && (page.sourceCursor !== prior.intent.domain.sourceCursor || page.sourceTopic !== prior.intent.domain.sourceTopic)) {
      return { status: 'rejected', receipt: { status: 'rejected', commandId: command.commandId, code: 'invalid', issues: ['A fixed route round cannot move its source position'] } };
    }
    // 本轮的订阅范围在**第一批处理时固定**：intent 上还没有范围（空）时以本页声明的整轮候选集合
    // 为准（协议约束 1.4），已经固定过则本页必须**逐字节回声**那个范围且不得引入范围外的订阅。
    const priorScope = prior.intent.domain.subscriptionScope;
    /**
     * CM-1A-001 第 4 步：生产者在提案里给出**整轮候选集合**（RoutePageProposalV1.subscriptionScope）。
     *
     * 为什么必须有它：只给本页切片的话，intent 的范围永远是空的，账本侧的范围规则（本页不得引入
     * 范围外订阅 / 续页范围逐字节相同 / hasMore 与下一页 intent 一致）在生产路径上永远不会触发。
     * 这里只做**结构**复核（引用形状 + 非负整数版本），成员资格与版本在下面逐条与 canonical 订阅核对。
     */
    const declaredScope = page.subscriptionScope;
    if (!Array.isArray(declaredScope)) {
      return { status: "rejected", receipt: { status: "rejected", commandId: command.commandId, code: "invalid", issues: ["payload.page.subscriptionScope 必须是数组"] } };
    }
    for (const entry of declaredScope) {
      if (entry === null || typeof entry !== "object") {
        return { status: "rejected", receipt: { status: "rejected", commandId: command.commandId, code: "invalid", issues: ["payload.page.subscriptionScope 的每一项必须是对象"] } };
      }
      const ref = entry.subscriptionRef;
      if (ref === null || typeof ref !== "object" || ref.aggregateType !== "Subscription" ||
          ref.projectId !== projectId || ref.workspaceId !== workspaceId || typeof ref.subscriptionId !== "string" || ref.subscriptionId.length === 0) {
        return { status: "rejected", receipt: { status: "rejected", commandId: command.commandId, code: "invalid", issues: ["payload.page.subscriptionScope 的订阅引用不合法（必须属于本页作用域）"] } };
      }
      if (!Number.isInteger(entry.expectedRevision) || entry.expectedRevision < 0) {
        return { status: "rejected", receipt: { status: "rejected", commandId: command.commandId, code: "invalid", issues: ["payload.page.subscriptionScope 的 expectedRevision 必须是非负整数"] } };
      }
    }
    if (priorScope.length > 0 && canonicalJson(declaredScope as never) !== canonicalJson(priorScope as never)) {
      return {
        status: "rejected",
        receipt: {
          status: "rejected", commandId: command.commandId, code: "invalid",
          issues: ["本轮订阅范围已经固定，本页必须逐字节回声该范围（不得改变、不得引入范围外订阅）"],
        },
      };
    }
    // 首次处理订阅的页面**必须**声明范围：没有范围就没有"本轮"这个可核对的事实（协议约束 1.4）。
    if (priorScope.length === 0 && page.subscriptions.length > 0 && declaredScope.length === 0) {
      return {
        status: "rejected",
        receipt: {
          status: "rejected", commandId: command.commandId, code: "invalid",
          issues: ["本页要处理订阅，但没有声明本轮订阅范围（payload.page.subscriptionScope 为空）"],
        },
      };
    }
    const declaredByKey = new Map(declaredScope.map((entry) => [canonicalJson(entry.subscriptionRef as never), entry.expectedRevision] as const));
    const now = foldDeps.now();
    const deliverySnapshots: DeliverySnapshot[] = [];
    const subscriptionSnapshots: SubscriptionSnapshot[] = [];
    const waitNextByRef = new Map<string, { prior: WaitConditionSnapshot; indexes: Set<number>; notes: string[] }>();
    let lastSubscriptionRef: SubscriptionRef | null = null;
    let totalDeliveries = 0;

    for (const entry of page.subscriptions) {
      const loaded = await this.loadTyped<SubscriptionSnapshot>(entry.subscriptionRef, "Subscription");
      if (loaded === null) {
        return { status: "rejected", receipt: { status: "rejected", commandId: command.commandId, code: "not_found", issues: ["订阅不存在：" + entry.subscriptionRef.subscriptionId] } };
      }
      // 范围固定（协议约束 1.4）：本页处理的每个订阅都必须在本轮范围里——首次处理时范围就是
      // 本页声明的整轮候选集合，之后是 intent 上已固定的那一份。范围外订阅一律整页拒绝。
      const scopedRevision = declaredByKey.get(canonicalJson(entry.subscriptionRef as never));
      if (scopedRevision === undefined) {
        return {
          status: "rejected",
          receipt: { status: "rejected", commandId: command.commandId, code: "invalid", issues: ["本页引入了本轮订阅范围外的订阅：" + entry.subscriptionRef.subscriptionId] },
        };
      }
      // 范围记的是**本轮开始时**那一版：本页处理的订阅当前必须正好是那一版（推进后账本侧还要
      // 再核对一次 revision === expected + 1，两处口径一致）。
      if (scopedRevision > loaded.revision) {
        return {
          status: "rejected",
          receipt: {
            status: "rejected", commandId: command.commandId, code: "revision_conflict", currentRevision: loaded.revision,
            issues: ["订阅版本与本轮范围登记的版本不一致：" + entry.subscriptionRef.subscriptionId],
          },
        };
      }
      if (loaded.revision !== entry.expectedRevision) {
        return {
          status: "rejected",
          receipt: { status: "rejected", commandId: command.commandId, code: "revision_conflict", currentRevision: loaded.revision, issues: ["订阅版本与页内期望不一致：" + entry.subscriptionRef.subscriptionId] },
        };
      }
      if (loaded.subscription.status === 'active') {
        if (entry.deliveries.length !== 1) return { status: 'rejected', receipt: { status: 'rejected', commandId: command.commandId, code: 'invalid', issues: ['Each active subscription must receive its canonical delivery'] } };
        if (!loaded.subscription.topics.includes(page.sourceTopic) || (loaded.subscription.startCursor !== null && String(loaded.subscription.startCursor) >= String(page.sourceCursor))) return { status: 'rejected', receipt: { status: 'rejected', commandId: command.commandId, code: 'invalid', issues: ['Source is outside subscription start/topics'] } };
        if (loaded.subscription.catchup) {
          const caught = await this.loadTyped<CommunicationIntentSnapshot>(loaded.subscription.catchup.intentRef, 'CommunicationIntent');
          if (caught?.intent.status !== 'done') return { status: 'rejected', receipt: { status: 'rejected', commandId: command.commandId, code: 'revision_conflict', issues: ['Subscription history has not reached its fixed horizon'] } };
        }
        if (loaded.subscription.routedThroughCursor !== null && String(loaded.subscription.routedThroughCursor) > String(page.sourceCursor)) return { status: 'rejected', receipt: { status: 'rejected', commandId: command.commandId, code: 'invalid', issues: ['Subscription checkpoint cannot move backwards'] } };
      }
      lastSubscriptionRef = entry.subscriptionRef;
      const candidates: DeliveryV1[] = [];
      for (const proposed of (loaded.subscription.status === 'active' ? entry.deliveries : [])) {
        const expectedId = subscriptionDeliveryIdFor({ subscriptionRef: loaded.ref, topic: page.sourceTopic, cursor: page.sourceCursor, targetWorkContextRef: loaded.subscription.ownerWorkContextRef });
        if (!source || proposed.deliveryId !== expectedId || canonicalJson(proposed.bodyRef) !== canonicalJson(source.bodyRef) || canonicalJson(proposed.sourceRefs) !== canonicalJson(source.sourceRefs)) return { status: 'rejected', receipt: { status: 'rejected', commandId: command.commandId, code: 'invalid', issues: ['Delivery payload or identity differs from its canonical source'] } };
        if (canonicalJson(proposed.targetWorkContextRef) !== canonicalJson(loaded.subscription.ownerWorkContextRef)) {
          return {
            status: "rejected",
            receipt: { status: "rejected", commandId: command.commandId, code: "invalid", issues: ["页内投递目标不是订阅的 owner Work：" + proposed.deliveryId] },
          };
        }
        candidates.push(
          pageDelivery({
            projectId,
            workspaceId,
            subscription: loaded,
            targetWorkContextRef: proposed.targetWorkContextRef,
            event: {
              topic: page.sourceTopic,
              cursor: page.sourceCursor,
              bodyRef: proposed.bodyRef ?? null,
              sourceRefs: Array.isArray(proposed.sourceRefs) ? proposed.sourceRefs.map((s) => ({ ...s })) : [],
            },
            deliveryId: proposed.deliveryId,
            createdAt: now,
          }),
        );
      }
      for (const delivery of dedupePageDeliveries(candidates)) {
        totalDeliveries += 1;
        if (totalDeliveries > COMMUNICATION_PAGE_MAX_DELIVERIES) {
          return {
            status: "rejected",
            receipt: { status: "rejected", commandId: command.commandId, code: "invalid", issues: ["页内投递数超过上界 " + String(COMMUNICATION_PAGE_MAX_DELIVERIES)] },
          };
        }
        const priorDelivery = await this.loadTyped<DeliverySnapshot>(deliveryRefForOf(projectId, workspaceId, delivery.deliveryId), 'Delivery');
        if (priorDelivery) {
          if (canonicalJson({ ...priorDelivery.delivery, createdAt: now }) !== canonicalJson(delivery)) return { status: 'rejected', receipt: { status: 'rejected', commandId: command.commandId, code: 'invalid', issues: ['Existing delivery differs from route event'] } };
          continue;
        }
        deliverySnapshots.push({
          ref: deliveryRefForOf(projectId, workspaceId, delivery.deliveryId),
          revision: 1,
          schemaVersion: 1,
          delivery,
          recordedAt: now,
        });
      }
      subscriptionSnapshots.push({
        ...loaded,
        revision: loaded.revision + 1,
        subscription: { ...loaded.subscription, routedThroughCursor: page.sourceCursor },
        recordedAt: now,
      });
      lastSubscriptionRef = entry.subscriptionRef;

      // wait 条件推进：逐 index 复核，只有真满足的 index 才写入。
      for (const transition of (loaded.subscription.status === 'active' ? entry.satisfiedWaitIndexes : [])) {
        const waitKey = canonicalJson(transition.waitRef);
        let bucket = waitNextByRef.get(waitKey);
        if (bucket === undefined) {
          const waitSnapshot = await this.loadTyped<WaitConditionSnapshot>(transition.waitRef, "WaitCondition");
          if (waitSnapshot === null) {
            return { status: "rejected", receipt: { status: "rejected", commandId: command.commandId, code: "not_found", issues: ["WaitCondition 不存在：" + transition.waitRef.waitId] } };
          }
          bucket = { prior: waitSnapshot, indexes: new Set<number>(), notes: [] };
          waitNextByRef.set(waitKey, bucket);
        }
        if (bucket.prior.wait.status !== "active") continue; // 终态等待不再推进。
        for (const index of transition.indexes) {
          if (!Number.isInteger(index) || index < 0 || index >= bucket.prior.wait.conditions.length) {
            return { status: "rejected", receipt: { status: "rejected", commandId: command.commandId, code: "invalid", issues: ["等待条件下标越界：" + String(index)] } };
          }
          const satisfied = await this.termSatisfied(bucket.prior.wait.conditions[index]!, deliverySnapshots);
          if (!satisfied) {
            return {
              status: "rejected",
              receipt: { status: "rejected", commandId: command.commandId, code: "invalid", issues: ["页内推进的等待条件并不满足：wait=" + bucket.prior.ref.waitId + " index=" + String(index)] },
            };
          }
          bucket.indexes.add(index);
        }
      }
    }

    const waits: WaitConditionSnapshot[] = [];
    for (const bucket of waitNextByRef.values()) {
      const merged = new Set<number>([...bucket.prior.wait.satisfiedIndexes, ...bucket.indexes]);
      const added = [...bucket.indexes].filter((index) => !bucket.prior.wait.satisfiedIndexes.includes(index));
      const ordered = [...merged].sort((a, b) => a - b);
      if (added.length === 0 && ordered.length === bucket.prior.wait.satisfiedIndexes.length) continue; // 事实上没有推进：不写。
      waits.push({
        ...bucket.prior,
        revision: bucket.prior.revision + 1,
        wait: {
          ...bucket.prior.wait,
          satisfiedIndexes: ordered,
          observations: [
            ...bucket.prior.wait.observations,
            ...added.map((index) => ({ index, observedAt: now, note: "route page 页内条件推进" })),
          ],
        },
        recordedAt: now,
      });
    }

    // 本页**处理到的订阅分页位置**：处理过订阅就是最后一个被处理订阅的 canonical ref key；
    // 一页什么都没处理（没有可路由事件/没有候选订阅）时保持 intent 原有的位置不变。
    const pagePosition = lastSubscriptionRef === null ? priorPosition : canonicalJson(lastSubscriptionRef as never);
    if (page.subscriptionPosition !== pagePosition) {
      return {
        status: "rejected",
        receipt: {
          status: "rejected", commandId: command.commandId, code: "invalid",
          issues: ["页声明的订阅分页位置与页内实际处理结果不一致：page=" + String(page.subscriptionPosition) + " 实际=" + String(pagePosition)],
        },
      };
    }
    // 订阅位置必须**严格前进**（协议约束 1.4）：回退或原地不动一律整页拒绝（零写入）。
    if (pagePosition !== null && priorPosition !== null && !refKeyAfter(pagePosition, priorPosition)) {
      return {
        status: "rejected",
        receipt: {
          status: "rejected", commandId: command.commandId, code: "invalid",
          issues: ["订阅分页位置必须严格前进（不得回退或原地）：page=" + pagePosition + " 已处理=" + priorPosition],
        },
      };
    }
    /**
     * 本轮订阅范围：首次由本页声明固定，之后逐字节沿用；落账前做一次**收敛**——
     * 只保留此刻仍然「存在且 active」的订阅。
     *
     * 为什么归一化而不是原样沿用：范围内的订阅可能在翻页期间被取消或（理论上）消失，那时它
     * 已经不可能再接收任何投递。把它留在范围里会让"范围内还有剩余订阅"永远为真，分页会在
     * 这里永久停住（账本侧的 hasMore 规则会直接拒绝末页）。收敛只做**删减**：不新增、不改写
     * 版本、不改变顺序，因此"不得引入范围外订阅"与"续页范围与上一页相同"两条不变式都仍成立。
     */
    const nextScope = (priorScope.length > 0 ? priorScope : declaredScope).map(entry => ({ ...entry, subscriptionRef: { ...entry.subscriptionRef } }));
    // 协议约束 1.4 / 2.4：hasMore 是**分页边界自洽性**的声明，不得与页内容矛盾。
    // 本页没有处理任何订阅（page.subscriptions 为空，或列出的订阅都已取消而被跳过）时，
    // 订阅分页位置没有前进、也没有任何可继续的边界——这时声称 hasMore=true 只能是
    // "本页什么都没做，却要求继续分页"。旧实现对此**静默收敛**：nextIntent 直接为 null，
    // 页被结算成 done，调度器声明的意图既没有被满足也没有留下任何可诊断的原因。
    // 现在一律**整页拒绝（零写入）**，要求调用方给出自洽的提案。
    if (page.hasMore && pagePosition === null) {
      return {
        status: "rejected",
        receipt: {
          status: "rejected", commandId: command.commandId, code: "invalid",
          issues: ["页声称 hasMore=true，但本页没有处理任何订阅：订阅分页位置没有前进，没有可继续的边界"],
        },
      };
    }
    const nextIntent = page.hasMore
      ? nextRouteIntentFor({
        projectId,
        workspaceId,
        topic: page.sourceTopic,
        cursor: page.sourceCursor,
        // 上面的守卫已保证：hasMore=true ⇒ 本页一定处理过订阅 ⇒ 分页位置非空。
        subscriptionPosition: pagePosition!,
        subscriptionScope: nextScope,
        now,
      })
      : null;

    return { status: "ok", deliveries: deliverySnapshots, subscriptions: subscriptionSnapshots, waits, nextIntent, subscriptionScope: nextScope };
  }

  /** 单条等待条件是否已被 canonical 事实满足（含本页新产生的投递）。 */
  private async termSatisfied(term: WaitConditionTermV1, pageDeliveries: DeliverySnapshot[]): Promise<boolean> {
    if (term.kind === "delivery_present") {
      if (pageDeliveries.some((d) => canonicalJson(d.ref) === canonicalJson(term.deliveryRef))) return true;
      return (await this.loadTyped<DeliverySnapshot>(term.deliveryRef, "Delivery")) !== null;
    }
    const request = await this.loadTyped<DirectedRequestSnapshot>(term.requestRef, "DirectedRequest");
    if (request === null) return false;
    const responded = request.request.status === "responded" || request.request.response !== null;
    if (term.kind === "request_responded") return responded;
    return responded || request.request.status === "cancelled" || request.request.status === "expired" || request.request.status === "closed";
  }

  // --------------------------------------------------------------------- //
  // 9b. 协议约束 2.2：本次实际采用的权限集（只许收窄）                          //
  // --------------------------------------------------------------------- //

  /**
   * 后继受理**实际采用**的权限集：前驱 Run 信封声明的权限 ∩ 当前参与关系 RoleBinding 的规格上界。
   *
   * 三条分支（确定性，不看运气；口径来自协议约束 2.2 的裁决原文）：
   *   1. 项目**没有**生效的角色矩阵（matrix === null）→ 既有策略在这一分支返回 spec=null，
   *      表示**未校验、不等于已授权**。此时**保持前驱 declaredPermissions 原值**。
   *      这条分支如实回 basis="no_matrix"：绝不把「没有上界」当成「交集为空」而把权限收成空集，
   *      也不假装它已经被授权过。
   *   2. 有矩阵且**规格可受理** → tools = 前驱 tools ∩ spec.permissions.tools；writeScope：
   *      规格为 none 即**空数组**（只读角色不得再写），否则**保留前驱 writeScope 原值**。
   *      交集与前驱相同时回 basis="within_spec"，确实收掉了东西时回 basis="narrowed"。
   *   3. 交集为空集 → 拒绝（basis 不适用）。
   *
   * 一律拒绝（零写入、等待保留、给出可读原因）的情形：
   *   - 绑定本身不合格（角色未登记／revision 过期／规格未安装／未激活）：新参与者没有合格授权，
   *     不能退回旧关系（2.2），也不是「收窄」能解决的问题；
   *   - 收窄结果为空集（既没有工具也没有写范围）：没有可执行的授权；
   *   - 收窄结果仍不通过策略（口径分叉，宁可停）。
   */
  private async effectiveSuccessorPermissions(input: {
    projectId: string;
    roleBinding: RoleBindingRefV1;
    inherited: { tools: string[]; writeScope: string[] };
    guards?: VersionedRef[];
  }): Promise<
    | { status: "ok"; permissions: { tools: string[]; writeScope: string[] }; basis: "no_matrix" | "within_spec" | "narrowed" }
    | { status: "rejected"; issues: string[] }
  > {
    const copy = (value: { tools: string[]; writeScope: string[] }) => ({
      tools: [...value.tools],
      writeScope: [...value.writeScope],
    });
    const reads: Pick<import('../../contracts/ledger.js').StateLedger, 'load'> = { load: async ref => {
      const loaded = await this.deps.ledger.load(ref);
      if (input.guards) {
        if (loaded.status !== 'found' && loaded.status !== 'not_found') throw Error('Report permission basis unavailable');
        input.guards.push({ ref, revision: loaded.status === 'found' ? loaded.snapshot.revision : 0 });
      }
      return loaded;
    } };
    const policy = await resolveActiveCoordinationPolicy(reads, input.projectId);
    const matrix = policy?.content.roles ?? null;
    if (matrix === null) return { status: "ok", permissions: copy(input.inherited), basis: "no_matrix" };

    const roleId = input.roleBinding.templateId;
    const pin = Object.prototype.hasOwnProperty.call(matrix.catalog, roleId) ? matrix.catalog[roleId] : undefined;
    let pinnedSpec: RoleSpecRevisionSnapshot | null = null;
    let activeRevision: RoleSpecRevisionRef | null = null;
    if (pin !== undefined) {
      const installed = await reads.load(pin.ref);
      if (installed.status === "found" && installed.snapshot.ref.aggregateType === "RoleSpecRevision") {
        pinnedSpec = installed.snapshot as RoleSpecRevisionSnapshot;
      }
      const active = await reads.load(projectRoleSpecActiveRefFor(input.projectId, roleId));
      if (active.status === "found" && active.snapshot.ref.aggregateType === "ProjectRoleSpecActive") {
        activeRevision = (active.snapshot as ProjectRoleSpecActiveSnapshot).activeRevision;
      }
    }
    const facts = {
      roleBinding: input.roleBinding,
      declaredPermissions: copy(input.inherited),
      matrix,
      pinnedSpec,
      activeRevision,
    };
    // 「有矩阵且**规格可受理**」：按既有策略判定绑定本身（角色在册 / revision 与 pin 一致 /
    // 规格已安装且摘要一致 / 生效引用等于 pin）。探针带的声明权限取**规格自己的上界**
    // —— 与同文件 evaluateRoleSpecPinReadiness 的手法完全相同 —— 这样这次判定只回答
    // 「这份规格可不受理」，不被前驱权限集干扰；策略在可受理时会把规格正文（授权上界）返回，
    // 我们因此不需要另读一份规格，也不猜上界。
    const probe = pinnedSpec === null
      ? { tools: [] as string[], writeScope: [] as string[] }
      : {
          tools: [...pinnedSpec.content.permissions.tools],
          writeScope: pinnedSpec.content.permissions.writeScope === "none" ? [] : ["workspace"],
        };
    const admitted = evaluateRoleBindingAdmission({ ...facts, declaredPermissions: probe });
    if (!admitted.admissible) {
      return {
        status: "rejected",
        issues: [
          "当前参与关系的角色绑定不满足既有准入策略：" + admitted.reasons.map((reason) => reason.message).join("; ") +
          "；新参与者没有合格授权，不退回旧关系、也不放宽权限，本次不产生后继（等待保持 active）",
        ],
      };
    }
    const upper = admitted.spec?.permissions ?? null;
    if (upper === null) {
      return { status: "rejected", issues: ["角色绑定的规格上界不可读（策略判定可受理却拿不到规格）：本次不产生后继"] };
    }
    // 裁决口径：tools 取前驱 ∩ 规格上界；writeScope 按类别 —— 只读规格收成空，否则保留前驱原值
    // （前驱写范围是既有事实，必然落在已授权的工作区范围内；这里不发明新的路径映射）。
    //
    // 判据只有一份：**策略只回答「是否越界」（布尔）**，交集的算术在 Control 侧完成；
    // 因此算术的结果**必须重新通过同一个策略**才算数（见下面的 verify）——口径分叉就零写拒绝。
    const narrowed = {
      tools: input.inherited.tools.filter((tool) => upper.tools.includes(tool)),
      writeScope: upper.writeScope === "none" ? [] : [...input.inherited.writeScope],
    };
    // 用**同一个策略**复核收窄结果：口径若分叉就停（零写拒绝），不让两套判据并存。
    const verify = evaluateRoleBindingAdmission({ ...facts, declaredPermissions: { ...narrowed } });
    if (!verify.admissible) {
      return { status: "rejected", issues: ["收窄后的权限集仍未通过既有准入策略：" + verify.reasons.map((reason) => reason.message).join("; ")] };
    }
    // 无可用授权（裁决）：交集后的**工具为 0 项**即视为没有可执行的授权 —— 无论写范围是否还留着。
    // 写范围脱离工具没有意义，而「留着一个没有任何工具的写范围」在事后复核里会被读成「仍有写权限」，
    // 因此不保留这种模糊状态：零写拒绝 + 等待保留 + 明确原因。
    if (narrowed.tools.length === 0) {
      return {
        status: "rejected",
        issues: [
          "前驱权限集与当前 RoleBinding 规格上界的交集中**工具为 0 项**（写范围=" +
          (narrowed.writeScope.length === 0 ? "空" : narrowed.writeScope.join(",")) +
          "）：没有可执行的授权，等待保持 active，本次不产生后继（不退回旧关系、不临时放宽）",
        ],
      };
    }
    const unchanged = canonicalJson(narrowed as never) === canonicalJson(input.inherited as never);
    return { status: "ok", permissions: narrowed, basis: unchanged ? "within_spec" : "narrowed" };
  }

  // --------------------------------------------------------------------- //
  // 10. admitWaitSuccessor（唯一后继；零写入 not_ready）                      //
  // --------------------------------------------------------------------- //

  async admitWaitSuccessor(command: AdmitWaitSuccessorCommand): Promise<AdmitWaitSuccessorReceipt> {
    const issues: string[] = [];
    checkCommandShape(command, "AdmitWaitSuccessor", issues);
    const payload = (command.payload ?? {}) as Record<string, unknown>;
    const workspaceId = requireString(payload["workspaceId"], "payload.workspaceId", issues);
    const scopeWorkspace = workspaceId ?? "";
    const workContextRef = payload["workContextRef"] as WorkContextRef;
    checkWorkContextRef(payload["workContextRef"], "payload.workContextRef", command.identity.projectId, scopeWorkspace, issues);
    checkWaitConditionRefShape(payload["waitRef"], "payload.waitRef", command.identity.projectId, scopeWorkspace, issues);
    checkParticipationRef(payload["participationRef"], "payload.participationRef", command.identity.projectId, scopeWorkspace, issues);
    requireString(payload["agentInstanceId"], "payload.agentInstanceId", issues);
    checkRunRef(payload["predecessorRunRef"], "payload.predecessorRunRef", command.identity.projectId, issues);
    requireString(payload["goalId"], "payload.goalId", issues);
    requireString(payload["taskId"], "payload.taskId", issues);
    requireString(payload["attemptId"], "payload.attemptId", issues);
    requireString(payload["runId"], "payload.runId", issues);
    if (typeof payload["workspaceRevision"] !== "number" || !Number.isInteger(payload["workspaceRevision"])) {
      issues.push("payload.workspaceRevision 必须是整数");
    }
    if (!Array.isArray(payload["deliveryRefs"])) issues.push("payload.deliveryRefs 必须是数组");
    else {
      (payload["deliveryRefs"] as unknown[]).forEach((ref, index) =>
        checkDeliveryRefShape(ref, "payload.deliveryRefs[" + String(index) + "]", command.identity.projectId, scopeWorkspace, issues));
    }
    // 协议约束 2.2 的输入：继承来的权限集必须有合法形状，否则一律 invalid（零写入）。
    // 复用既有的形状校验（dispatch 契约里那一份，与 validateActor 同一调用手法），不另立一套。
    const permissionIssues: ValidationIssue[] = [];
    validateDeclaredPermissions(payload["declaredPermissions"], "payload.declaredPermissions", permissionIssues);
    for (const issue of permissionIssues) issues.push(issue.message);
    if (typeof command.expectedRevision !== "number" || !Number.isInteger(command.expectedRevision) || command.expectedRevision < 1) {
      issues.push("expectedRevision 必须是当前 WaitCondition 的正整数 revision");
    }
    if (issues.length > 0) {
      return admitReject(command.commandId, "invalid", issues);
    }

    const projectId = command.identity.projectId;
    const waitRef = payload["waitRef"] as WaitConditionRef;
    const participationRef = payload["participationRef"] as WorkParticipationRef;
    const predecessorRunRef = payload["predecessorRunRef"] as RunSnapshot["ref"];
    const goalId = payload["goalId"] as string;
    const taskId = payload["taskId"] as string;

    // WaitConditionRef 只带 (projectId, workspaceId, waitId)：归属 Work 由 canonical 快照判定
    // （下面的 ownerWorkContextRef 复核），这里只核对引用自身的范围。
    if (canonicalJson(waitRef) !== canonicalJson(waitConditionRefFor(projectId, scopeWorkspace, waitRef.waitId))) {
      return admitReject(command.commandId, "invalid", ["payload.waitRef 的 projectId/workspaceId 必须与 workspaceId 一致"]);
    }

    // 归因（第 2 步裁决）：这是**调度触发**命令 —— system 身份 + 来源关联，不接受 agent
    // principal（那会把新参与者与旧 Run 拼成一个身份，见 checkSchedulerAttribution）。
    const attribution: string[] = [];
    checkSchedulerAttribution(command.identity, command.correlationId, { sourceId: waitRef.waitId }, attribution);
    if (attribution.length > 0) return admitReject(command.commandId, "forbidden", attribution);

    const wait = await this.loadTyped<WaitConditionSnapshot>(waitRef, "WaitCondition");
    if (wait === null) return admitReject(command.commandId, "not_found", ["WaitCondition 不存在：" + waitRef.waitId]);
    if (wait.revision !== command.expectedRevision) {
      return admitReject(command.commandId, "revision_conflict", ["WaitCondition 当前 revision 与 expectedRevision 不一致"], wait.revision);
    }
    if (canonicalJson(wait.wait.ownerWorkContextRef) !== canonicalJson(workContextRef)) {
      return admitReject(command.commandId, "invalid", ["wait 的 owner Work 与 payload.workContextRef 不一致"]);
    }
    if (canonicalJson(wait.wait.predecessorRunRef) !== canonicalJson(predecessorRunRef)) {
      return admitReject(command.commandId, "invalid", ["payload.predecessorRunRef 与 wait 登记的前驱不一致"]);
    }
    const binding = await this.loadTyped<WorkContextBindingSnapshot>(workContextRef, "WorkContextBinding");
    if (binding === null) return admitReject(command.commandId, "not_found", ["WorkContextBinding 不存在：" + workContextRef.workId]);
    if (binding.binding.goalId !== null && binding.binding.goalId !== goalId) {
      return admitReject(command.commandId, "invalid", ["payload.goalId 与该 Work 的 goal 不一致"]);
    }
    if (binding.binding.taskId !== null && binding.binding.taskId !== taskId) {
      return admitReject(command.commandId, "invalid", ["payload.taskId 与该 Work 的 task 不一致"]);
    }

    // ── 先处理等待**自己的**生命周期（不是接续资格）───────────────────────────────
    // deadline 到点是等待自身的收敛条件（Dispatch 会以同一 generation 把它 settle 成
    // timed_out），与「谁在参与、前驱是否结束」无关；因此它先于参与关系判定，
    // 否则一个已经过期的等待会被「没有参与者」这类失败反复计入熔断计数。
    if (wait.wait.status !== "active") {
      return { status: "not_ready", commandId: command.commandId, code: "conditions_unsatisfied" };
    }
    if (wait.wait.deadlineAt !== null && wait.wait.deadlineAt <= this.deps.now()) {
      return { status: "not_ready", commandId: command.commandId, code: "deadline_passed" };
    }

    // ── 接续资格的第一条：该 Work 现在**有没有有效的参与者**（第 2 步裁决）─────────
    // wait.ownerParticipationRef 是**注册时**的参与关系，只作历史事实/追溯；资格一律按 Work
    // 权威状态里的**当前**参与关系判定。因此：
    //   · 换手（旧段 ended + 新段 active）之后，同一等待仍然能产生同一个 Work 上的唯一后继；
    //   · 现在没有有效参与者时**保留等待**（零写入、不产生后继），并给出可读原因。
    // 顺序刻意在「条件/前驱」之前：没有参与者是**确定性**的不可接续，不能与「前驱还在跑」这种
    // 会自己消失的等待混为一谈（后者只是 not_ready，不向上报失败）。
    const currentRef = binding.binding.currentParticipationRef ?? null;
    if (currentRef === null) {
      return admitReject(command.commandId, "no_active_participation", [
        "该 Work 还没有被受理过任何参与关系（没有有效的当前参与者）；等待保持 active，本次不产生后继",
      ]);
    }
    const participation = await this.loadTyped<WorkParticipationSnapshot>(currentRef, "WorkParticipation");
    if (participation === null) {
      return admitReject(command.commandId, "no_active_participation", [
        "该 Work 的当前参与关系在账本里不存在：" + currentRef.participationId + "；等待保持 active，本次不产生后继",
      ]);
    }
    if (participation.participation.status !== "active") {
      return admitReject(command.commandId, "no_active_participation", [
        "该 Work 的当前参与关系已经 ended（" + currentRef.participationId + "）：等待保持 active、不产生后继；" +
        "换手完成（新的参与关系建立）之后同一等待仍可接续",
      ]);
    }
    if (canonicalJson(participation.participation.workContextRef) !== canonicalJson(workContextRef)) {
      return admitReject(command.commandId, "invalid", ["当前参与关系不属于该 Work（后继必须留在同一个 Work）"]);
    }
    // 调用方的提议必须与**当前**事实逐字段一致：不得改用等待登记时的那一段参与关系，
    // 也不得换一个 AgentInstance/授权版本。
    if (canonicalJson(participationRef as never) !== canonicalJson(currentRef as never)) {
      return admitReject(command.commandId, "invalid", [
        "payload.participationRef 必须与该 Work 的当前参与关系一致（" + currentRef.participationId +
        "）；等待登记时的那一段参与关系只是历史事实，不能用于接续资格",
      ]);
    }
    if (participation.participation.agentInstanceId !== (payload["agentInstanceId"] as string)) {
      return admitReject(command.commandId, "invalid", ["payload.agentInstanceId 与当前参与关系的 AgentInstance 不一致"]);
    }
    if (canonicalJson(payload["roleBinding"] as never) !== canonicalJson(participation.participation.roleBinding as never)) {
      return admitReject(command.commandId, "invalid", [
        "payload.roleBinding 与当前参与关系固定的授权版本不一致（后继必须沿用这一段参与的授权）",
      ]);
    }
    // ── 协议约束 2.2：按**当前** RoleBinding 重新核验资格，并把权限集收窄到规格上界内 ──────
    // 只许收窄、不许放宽；交集为空或绑定本身不合格一律零写拒绝（等待保持 active）。
    const reportGuards: VersionedRef[] = [];
    const effective = await this.effectiveSuccessorPermissions({
      projectId,
      roleBinding: participation.participation.roleBinding,
      inherited: payload["declaredPermissions"] as { tools: string[]; writeScope: string[] },
      ...(wait.wait.mode === 'any' ? { guards: reportGuards } : {}),
    });
    if (effective.status === "rejected") {
      return admitReject(command.commandId, "no_admissible_permissions", effective.issues);
    }

    // 唯一后继 id：attemptId/runId 必须由 (workId, waitId, satisfiedRevision) 机械派生。
    const satisfiedRevision = wait.revision + 1;
    const derived = successorIdsFor(workContextRef.workId, waitRef.waitId, satisfiedRevision);
    if (payload["attemptId"] !== derived.attemptId || payload["runId"] !== derived.runId) {
      return admitReject(command.commandId, "invalid", [
        "attemptId/runId 必须由 successorIdsFor(workId, waitId, satisfiedRevision) 派生：" + derived.attemptId + " / " + derived.runId,
      ]);
    }

    // 目标 Delivery 必须存在、属于该 Work，并且是后继 Run 必须消费的精确版本。
    const deliveryRefs = wait.wait.mode === 'any' ? [] : payload["deliveryRefs"] as DeliveryRef[];
    const deliveries: DeliverySnapshot[] = [];
    const seenDelivery = new Set<string>();
    for (const ref of deliveryRefs) {
      const key = canonicalJson(ref);
      if (seenDelivery.has(key)) continue;
      seenDelivery.add(key);
      const delivery = await this.loadTyped<DeliverySnapshot>(ref, "Delivery");
      if (delivery === null) return admitReject(command.commandId, "not_found", ["Delivery 不存在：" + ref.deliveryId]);
      if (canonicalJson(delivery.delivery.targetWorkContextRef) !== canonicalJson(workContextRef)) {
        return admitReject(command.commandId, "invalid", ["Delivery 不属于该 Work：" + ref.deliveryId]);
      }
      deliveries.push(delivery);
    }

    // 条件事实：直接按条件里写的精确 ref 读取（≤ WAIT_MAX_CONDITIONS 次），不扫全量事件。
    const facts: WaitConditionFacts = { deliveries: [], respondedRequests: [], closedRequests: [] };
    for (const term of wait.wait.conditions) {
      if (term.kind === "delivery_present") {
        const delivery = await this.loadTyped<DeliverySnapshot>(term.deliveryRef, "Delivery");
        if (delivery !== null) facts.deliveries.push({ refKey: canonicalJson(delivery.ref) });
        continue;
      }
      const request = await this.loadTyped<DirectedRequestSnapshot>(term.requestRef, "DirectedRequest");
      if (request === null) continue;
      const requestKey = canonicalJson(request.ref);
      if (request.request.status === "responded" || request.request.response !== null) facts.respondedRequests.push(requestKey);
      if (request.request.status === "responded" || request.request.status === "cancelled" ||
          request.request.status === "expired" || request.request.status === "closed") {
        facts.closedRequests.push(requestKey);
      }
    }
    const evaluation = evaluateWaitConditions(wait.wait.conditions, facts);
    let selectedReport: import('../../contracts/alternative-report.js').AlternativeReportSelection | undefined;
    let reportQualification: import('../../contracts/alternative-report.js').AlternativeReportQualification | undefined;
    const predecessor = await this.loadTyped<RunSnapshot>(predecessorRunRef as AggregateRef, 'Run');
    if (!predecessor) return admitReject(command.commandId, 'not_found', ['Predecessor Run is missing']);
    if (wait.wait.mode === 'any') {
      const chosen = await this.deps.ledger.alternativeReport(wait.ref);
      if (chosen.status === 'unavailable') return admitReject(command.commandId, 'unavailable', [chosen.reason]);
      if (chosen.status === 'pending') return { status: 'not_ready', commandId: command.commandId, code: 'conditions_unsatisfied' };
      if (!this.deps.alternativeReportObservation) return admitReject(command.commandId, 'unavailable', ['Trusted report inspection is not connected']);
      const grants = new Map<string, import('../../contracts/ledger.js').AggregateSnapshot>();
      grants.set(canonicalJson(predecessor.ref), predecessor);
      reportGuards.push({ ref: predecessor.ref, revision: predecessor.revision });
      for (const ref of [{ aggregateType: 'Workspace' as const, projectId, workspaceId: scopeWorkspace }, { aggregateType: 'Goal' as const, projectId, goalId }]) {
        const loaded = await this.deps.ledger.load(ref);
        if (loaded.status !== 'found') return admitReject(command.commandId, 'unavailable', ['Report scope is unavailable']);
        grants.set(canonicalJson(ref), loaded.snapshot);
        reportGuards.push({ ref, revision: loaded.snapshot.revision });
      }
      const observed = await this.deps.alternativeReportObservation.observe(wait, predecessor, chosen.candidates, command.payload.reportObservationToken);
      if (observed.status === 'unavailable') return admitReject(command.commandId, 'unavailable', [observed.reason]);
      reportQualification = observed.qualification;
      for (const observation of reportQualification.observations) {
        const loaded = await this.deps.ledger.load(observation.grantRef);
        if (loaded.status !== 'found') return admitReject(command.commandId, 'unavailable', ['Report grant disappeared during inspection']);
        grants.set(canonicalJson(observation.grantRef), loaded.snapshot);
        reportGuards.push({ ref: observation.grantRef, revision: observation.grantRevision });
      }
      const winner = qualifiedAlternativeReport(wait, chosen.candidates, reportQualification, ref => grants.get(canonicalJson(ref)));
      if (!winner) return { status: 'not_ready', commandId: command.commandId, code: 'report_material_unavailable',
        issues: reportQualification.observations.map(row => row.selection.deliveryRef.deliveryId + ': ' + row.reason) };
      selectedReport = winner;
      for (const candidate of chosen.candidates.slice(0, reportQualification.observations.length)) {
        reportGuards.push({ ref: candidate.delivery.ref, revision: candidate.delivery.revision }, { ref: candidate.request.ref, revision: candidate.request.revision });
      }
      const selected = chosen.candidates.find(candidate => canonicalJson(candidate.deliveryRef) === canonicalJson(winner.deliveryRef))!;
      deliveries.push(selected.delivery);
      evaluation.satisfiedIndexes = [selectedReport.conditionIndex];
    }

    // 前驱公开结束以 canonical RunSnapshot.status === "ended" 为准（不看私有日志）。
    if (predecessor === null) {
      return admitReject(command.commandId, "not_found", ["前驱 Run 不存在：" + predecessorRunRef.runId]);
    }
    const eligibility = evaluateSuccessorEligibility({
      wait: wait.wait,
      evaluation,
      predecessorEnded: predecessor.status === "ended",
      now: this.deps.now(),
    });
    if (!eligibility.eligible) {
      // 零写入：条件未满足 / 前驱仍 active / deadline 已过都只返回 not_ready。
      return { status: "not_ready", commandId: command.commandId, code: eligibility.code };
    }

    const manifest = this.buildSuccessorManifest({
      workspaceId: scopeWorkspace,
      workspaceRevision: payload["workspaceRevision"] as number,
      planRef: payload["planRef"] as PlanRevisionRef,
      deliveries,
    });

    const priorLease = await this.loadTyped<import("../../contracts/dispatch.js").TaskLeaseSnapshot>(
      { aggregateType: "TaskLease", projectId, goalId, taskId },
      "TaskLease",
    );
    const admissionIntentRef = communicationIntentRefForOf(projectId, scopeWorkspace, waitAdmissionIntentIdFor(waitRef.waitId, satisfiedRevision));
    const admissionIntent = await this.loadTyped<CommunicationIntentSnapshot>(admissionIntentRef, "CommunicationIntent");
    const claim = command.payload.intentClaim;
    if (admissionIntent) {
      if (!claim || canonicalJson(claim.intentRef) !== canonicalJson(admissionIntent.ref) ||
          claim.revision !== admissionIntent.revision || claim.leaseGeneration !== admissionIntent.intent.leaseGeneration ||
          claim.consumerId !== admissionIntent.intent.leaseOwner || command.identity.actor.id !== claim.consumerId ||
          admissionIntent.intent.status !== 'leased' || admissionIntent.intent.sideEffectStarted ||
          !admissionIntent.intent.leaseExpiresAt || admissionIntent.intent.leaseExpiresAt <= this.deps.now()) {
        return admitReject(command.commandId, 'forbidden', ['Admission requires the current unexpired consumer and generation']);
      }
    } else if (claim) return admitReject(command.commandId, 'invalid', ['Claimed admission intent does not exist']);

    // 协议约束 2.1：换手涉及的**当前参与关系版本**（Work 绑定 + 参与关系本身）进入同一事务的
    // 版本检查。上面读到的 binding/participation 的 revision 就是这里的期望值——它们只作 CAS
    // 守卫，本提交不写这两个快照。因此在「读」与「写」之间发生的 endWorkParticipation /
    // startWorkParticipation（换手）会让这次受理以 revision_conflict 零写失败，调用方必须重新
    // 读取当前参与关系再试，而不是把一个过期的参与者写进 admission。
    // CM-1A-001 第 4 步：WaitConditionSatisfied 是可路由源事件 → 同事务登记待路由 intent。
    // 这次提交已经带了 settlesIntent 与若干快照，账本侧的 successor-claim 校验只放行**由计划带来**的
    // CommunicationIntentRecorded（数量必须与计划数一致），因此这里给出的计划是唯一来源。
    const successorPlan = await this.routeIntentPlanFor("WaitConditionSatisfied", scopeWorkspace, this.deps.now(), command.identity.projectId);
    const batch = withRouteIntentPlan(buildSuccessorCommit({
      command,
      ...(selectedReport ? { selectedReport } : {}),
      ...(reportQualification ? { reportQualification } : {}),
      deps: this.foldDeps(scopeWorkspace),
      fingerprint: admitWaitSuccessorFingerprint(command),
      priorWait: wait,
      priorLease,
      priorBinding: binding,
      priorParticipation: participation,
      declaredPermissions: effective.permissions,
      permissionBasis: effective.basis,
      intent: admissionIntent !== null && isTerminalIntentStatus(admissionIntent.intent.status) ? null : admissionIntent,
      manifest,
    }), successorPlan);
    for (const guard of reportGuards) {
      const existing = batch.expectedVersions.find(version => canonicalJson(version.ref) === canonicalJson(guard.ref));
      if (existing && existing.revision !== guard.revision) return admitReject(command.commandId, 'revision_conflict', ['Report inspection basis changed']);
      if (!existing) batch.expectedVersions.push(guard);
    }
    const receipt = await this.deps.ledger.commit(batch);
    if (receipt.status === "committed") {
      const admission = batch.snapshots.find((s) => s.ref.aggregateType === "CommunicationAdmission") as
        | import("../../contracts/coordination.js").CommunicationAdmissionSnapshot
        | undefined;
      const attempt = batch.snapshots.find((s) => s.ref.aggregateType === "TaskAttempt")!;
      const run = batch.snapshots.find((s) => s.ref.aggregateType === "Run")!;
      return {
        status: "committed",
        commandId: command.commandId,
        replayed: receipt.replayed,
        waitRef,
        admissionRef: admission!.ref,
        attemptRef: attempt.ref as import("../../contracts/dispatch.js").TaskAttemptRef,
        runRef: run.ref as RunSnapshot["ref"],
        eventIds: [...receipt.eventIds],
        commitCursor: receipt.commitCursor,
      };
    }
    if (receipt.code === "revision_conflict") {
      const conflicted = receipt.currentVersions ?? [];
      const current = conflicted.find((v) => canonicalJson(v.ref) === canonicalJson(waitRef));
      // 冲突可能来自 wait 本身，也可能来自**本次读与写之间的换手**（协议约束 2.1 的版本检查）。
      // 后者必须给出可读原因，否则调用方会把它当成 wait 的问题而反复重试同一个过期参与者。
      const handoff = conflicted.filter((v) =>
        canonicalJson(v.ref) === canonicalJson(binding.ref) || canonicalJson(v.ref) === canonicalJson(participation.ref));
      const issues = handoff.length === 0
        ? ["wait 的 CAS 与账本当前版本冲突"]
        : [
          "本次受理读取的当前参与关系/Work 绑定在提交前被推进（换手或并发参与变更）：" +
          handoff.map((v) => v.ref.aggregateType + "@" + String(v.revision)).join(", ") +
          "；零写入，调用方必须重新读取当前参与关系再试",
        ];
      return admitReject(command.commandId, "revision_conflict", issues, current?.revision);
    }
    return {
      status: "rejected",
      commandId: command.commandId,
      code: receipt.code === "idempotency_conflict" ? "idempotency_conflict"
        : receipt.code === "unavailable" ? "unavailable" : "invalid",
    };
  }

  // --------------------------------------------------------------------- //
  // 10b. ensureWaitAdmission（条件已满足但前驱仍在执行 → 幂等建立复查 intent）  //
  // --------------------------------------------------------------------- //

  /**
   * 「条件已满足但前驱仍在执行」时**幂等地**建立 wait_admission intent。
   *
   * 为什么这条判定在 Control：它需要两件 Dispatch 拿不到的 canonical 事实——
   *   ① wait 的每个条件是否已被 canonical Delivery/DirectedRequest 满足；
   *   ② 前驱 RunSnapshot.status 是否仍**不是** ended。
   * Dispatch 只提议"请复核这个等待"，由 Control 读事实后决定建不建 intent。
   *
   * 守卫顺序（与同族 handler 一致：结构 → 引用存在 → 事实判定 → CAS → 唯一一次 commit）：
   *   1. 结构校验：commandType/commandId/correlationId/aggregateId/payload.workspaceId/
   *      payload.expectedRevision（正整数）；
   *   2. wait 必须存在（not_found）；
   *   3. wait 必须 active（否则 not_ready/wait_not_active，零写入）；
   *   4. payload.expectedRevision 必须等于当前 revision（否则 revision_conflict，零写入）；
   *   5. 条件必须全部满足（否则 not_ready/conditions_unsatisfied，零写入）；
   *   6. 前驱必须仍然 active（已经结束 → not_ready/predecessor_ended：那条路径是
   *      admitWaitSuccessor 的直接路径，不需要"前驱结束时复查"的 intent，零写入）；
   *   7. deadline 未到（已到 → not_ready/deadline_passed，等 deadline intent 收敛为 timed_out）；
   *   8. 派生 intentId = waitAdmissionIntentIdFor(waitId, wait.revision + 1)：已存在且非终态 →
   *      already_present（零写入，幂等命中）；已存在且终态 → not_ready/intent_terminal（零写入）；
   *   9. 否则一次 CAS@0 提交（communication-intent-record）。
   */
  async ensureWaitAdmission(command: EnsureWaitAdmissionCommand): Promise<EnsureWaitAdmissionReceipt> {
    const issues: string[] = [];
    checkCommandShape(command, "EnsureWaitAdmission", issues);
    const payload = (command.payload ?? {}) as Record<string, unknown>;
    const workspaceId = requireString(payload["workspaceId"], "payload.workspaceId", issues);
    const expectedRevision = payload["expectedRevision"];
    if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) || expectedRevision < 1) {
      issues.push("payload.expectedRevision 必须是当前 WaitCondition 的正整数 revision");
    }
    if (issues.length > 0) return ensureAdmissionReject(command.commandId, "invalid", issues);

    const projectId = command.identity.projectId;
    const scopeWorkspace = workspaceId as string;
    const waitRef: WaitConditionRef = waitConditionRefFor(projectId, scopeWorkspace, command.aggregateId);
    const wait = await this.loadTyped<WaitConditionSnapshot>(waitRef, "WaitCondition");
    if (wait === null) return ensureAdmissionReject(command.commandId, "not_found", ["WaitCondition 不存在：" + command.aggregateId]);
    if (wait.wait.status !== "active") {
      return { status: "not_ready", commandId: command.commandId, waitRef, code: "wait_not_active" };
    }
    if (wait.revision !== expectedRevision) {
      return ensureAdmissionReject(command.commandId, "revision_conflict", ["wait 的当前 revision 与 payload.expectedRevision 不一致"], wait.revision);
    }

    // 条件事实：直接按条件里写的精确 ref 读取（与 admitWaitSuccessor 同一口径，不扫全量事件）。
    const facts: WaitConditionFacts = { deliveries: [], respondedRequests: [], closedRequests: [] };
    for (const term of wait.wait.conditions) {
      if (term.kind === "delivery_present") {
        const delivery = await this.loadTyped<DeliverySnapshot>(term.deliveryRef, "Delivery");
        if (delivery !== null) facts.deliveries.push({ refKey: canonicalJson(delivery.ref) });
        continue;
      }
      const request = await this.loadTyped<DirectedRequestSnapshot>(term.requestRef, "DirectedRequest");
      if (request === null) continue;
      const requestKey = canonicalJson(request.ref);
      if (request.request.status === "responded" || request.request.response !== null) facts.respondedRequests.push(requestKey);
      if (request.request.status === "responded" || request.request.status === "cancelled" ||
          request.request.status === "expired" || request.request.status === "closed") {
        facts.closedRequests.push(requestKey);
      }
    }
    const evaluation = evaluateWaitConditions(wait.wait.conditions, facts);
    if (wait.wait.mode === 'any') {
      const chosen = await this.deps.ledger.alternativeReport(wait.ref);
      if (chosen.status === 'unavailable') return ensureAdmissionReject(command.commandId, 'unavailable', [chosen.reason]);
      evaluation.satisfiedIndexes = chosen.status === 'selected' ? [chosen.selection.conditionIndex] : [];
    }
    if (wait.wait.mode === 'any' ? evaluation.satisfiedIndexes.length === 0 : !evaluation.allSatisfied) {
      return { status: "not_ready", commandId: command.commandId, waitRef, code: "conditions_unsatisfied" };
    }

    const predecessor = await this.loadTyped<RunSnapshot>(wait.wait.predecessorRunRef as AggregateRef, "Run");
    if (predecessor === null) return ensureAdmissionReject(command.commandId, "not_found", ["前驱 Run 不存在：" + wait.wait.predecessorRunRef.runId]);
    if (predecessor.status === "ended" && wait.wait.mode !== 'any') {
      // 前驱已经结束：这时该直接走 admitWaitSuccessor（唯一后继在同一事务里创建），
      // 不需要"前驱结束时复查"的 intent。零写入，让调用方换路径。
      return { status: "not_ready", commandId: command.commandId, waitRef, code: "predecessor_ended" };
    }
    const now = this.deps.now();
    if (wait.wait.deadlineAt !== null && wait.wait.deadlineAt <= now) {
      return { status: "not_ready", commandId: command.commandId, waitRef, code: "deadline_passed" };
    }

    const satisfiedRevision = wait.revision + 1;
    const intentId = waitAdmissionIntentIdFor(waitRef.waitId, satisfiedRevision);
    const intentRef = communicationIntentRefForOf(projectId, scopeWorkspace, intentId);
    const existing = await this.loadTyped<CommunicationIntentSnapshot>(intentRef, "CommunicationIntent");
    if (existing !== null) {
      return isTerminalIntentStatus(existing.intent.status)
        ? { status: "not_ready", commandId: command.commandId, waitRef, code: "intent_terminal" }
        : { status: "already_present", commandId: command.commandId, waitRef, intentRef, satisfiedRevision };
    }

    const intent = waitAdmissionIntentFor({ projectId, workspaceId: scopeWorkspace, waitRef, satisfiedRevision, now });
    const batch = buildIntentRecordCommit({
      command,
      deps: this.foldDeps(scopeWorkspace),
      fingerprint: ensureWaitAdmissionFingerprint(command),
      intent,
    });
    const receipt = await this.deps.ledger.commit(batch);
    if (receipt.status === "committed") {
      return {
        status: "committed",
        commandId: command.commandId,
        replayed: receipt.replayed,
        waitRef,
        intentRef,
        satisfiedRevision,
        eventIds: [...receipt.eventIds],
        commitCursor: receipt.commitCursor,
      };
    }
    if (receipt.code === "revision_conflict") {
      // 并发下另一个调用已经建立了同一个 intent：幂等命中，不是失败。
      return { status: "already_present", commandId: command.commandId, waitRef, intentRef, satisfiedRevision };
    }
    return ensureAdmissionReject(
      command.commandId,
      receipt.code === "idempotency_conflict" ? "idempotency_conflict" : receipt.code === "unavailable" ? "unavailable" : "invalid",
    );
  }

  /**
   * 后继 Run 的 ContextManifest：只登记**精确的**目标 Delivery 版本 + 工作区/计划新鲜度，
   * 没有选材自由度（选材是 ContextCompiler 的事，这里只固定后继必须消费的引用）。
   */
  private buildSuccessorManifest(input: {
    workspaceId: string;
    workspaceRevision: number;
    planRef: PlanRevisionRef;
    deliveries: DeliverySnapshot[];
  }): ContextManifestV1 {
    const selectedRefs: SourceRefV1[] = input.deliveries.map((snapshot) => {
      const delivery = snapshot.delivery;
      const version = delivery.origin.kind === "subscription"
        ? delivery.origin.sourceTopic + "@" + String(delivery.origin.sourceCursor)
        : "directed_request@" + delivery.origin.requestRef.requestId;
      return {
        kind: "artifact" as const,
        refId: delivery.deliveryId,
        revision: version,
        ...(delivery.bodyRef === null ? {} : { digest: delivery.bodyRef.digest }),
      };
    });
    const gaps: MaterialGapV1[] = [];
    return {
      schemaVersion: 1,
      selectedRefs,
      gaps,
      freshness: {
        workspaceSnapshot: { workspaceId: input.workspaceId, revision: input.workspaceRevision },
        planRef: input.planRef,
      },
    };
  }


  // --------------------------------------------------------------------- //
  // 9c. 源事件提交时同事务登记待路由 intent（CM-1A-001 第 4 步 / 协议约束 1.4）  //
  // --------------------------------------------------------------------- //

  private async routeIntentPlanFor(topic: string, _workspaceId: string, now: string, _projectId: string): Promise<RouteIntentPlanV1> {
    return { schemaVersion: 1, anchorEventType: topic, topic, subscriptionScope: [], scopeMode: "canonical_active", plannedAt: now };
  }

  // --------------------------------------------------------------------- //
  // 11. mailboxView（只读；可重建 A01 关系）                                  //
  // --------------------------------------------------------------------- //

  async mailboxView(query: MailboxViewQuery): Promise<MailboxViewResult> {
    const projectId = query?.projectId ?? "";
    const workspaceId = query?.workspaceId ?? "";
    const workId = query?.workId ?? "";
    if (projectId.length === 0 || workspaceId.length === 0 || workId.length === 0) {
      return { status: "unavailable", reason: "邮箱查询不完整：projectId/workspaceId/workId 都必须明确" };
    }
    const scope = { projectId, workspaceId, workId };
    const participations = new Map<string, WorkParticipationRef>();
    const requests = new Map<string, DirectedRequestRef>();
    const subscriptions = new Map<string, SubscriptionRef>();
    const waits = new Map<string, WaitConditionRef>();
    const deliveries = new Map<string, DeliveryRef>();

    let cursor: CommitCursor | null = null;
    let pages = 0;
    try {
      for (;;) {
        const page = await this.deps.ledger.events({ afterCursor: cursor, limit: MAILBOX_SCAN_PAGE_SIZE });
        for (const positioned of page.events) {
          collectMailboxRefs(positioned.event, scope, { participations, requests, subscriptions, waits, deliveries });
        }
        if (!page.hasMore) break;
        if (page.throughCursor === null || page.throughCursor === cursor) {
          return { status: "unavailable", reason: "账本事件页游标没有推进，读不完整" };
        }
        cursor = page.throughCursor;
        pages += 1;
        if (pages >= MAILBOX_MAX_SCAN_PAGES) {
          return { status: "unavailable", reason: "邮箱扫描超过上限 " + String(MAILBOX_MAX_SCAN_PAGES) + " 页，读不完整不当作完整答案" };
        }
      }
    } catch (err) {
      return { status: "unavailable", reason: "账本事件不可读：" + (err instanceof Error ? err.message : String(err)) };
    }

    const participationSnapshots = await this.loadAll<WorkParticipationSnapshot>(participations, "WorkParticipation");
    const requestSnapshots = await this.loadAll<DirectedRequestSnapshot>(requests, "DirectedRequest");
    const subscriptionSnapshots = await this.loadAll<SubscriptionSnapshot>(subscriptions, "Subscription");
    const waitSnapshots = await this.loadAll<WaitConditionSnapshot>(waits, "WaitCondition");
    const deliverySnapshots = await this.loadAll<DeliverySnapshot>(deliveries, "Delivery");

    return {
      status: "ready",
      view: {
        workContextRef: workContextRefForOfMailbox(projectId, workspaceId, workId),
        participations: sortByRefKey(participationSnapshots),
        requests: sortByRefKey(requestSnapshots),
        subscriptions: sortByRefKey(subscriptionSnapshots),
        waits: sortByRefKey(waitSnapshots),
        deliveries: sortByRefKey(deliverySnapshots),
      },
    };
  }

  private async loadAll<T>(refs: Map<string, AggregateRef>, aggregateType: string): Promise<T[]> {
    const out: T[] = [];
    for (const key of [...refs.keys()].sort()) {
      const snapshot = await this.loadTyped<T>(refs.get(key)!, aggregateType);
      if (snapshot !== null) out.push(snapshot);
    }
    return out;
  }
}

// ------------------------------------------------------------------------ //
// 纯 helper                                                                  //
// ------------------------------------------------------------------------ //

function isTerminalIntentStatus(status: CommunicationIntentV1["status"]): boolean {
  return status === "done" || status === "cancelled" || status === "quarantined" || status === "outcome_unknown";
}

function isLedgerCursor(value: unknown): boolean {
  return typeof value === "string" && /^c\d{10}$/.test(value);
}

function workContextRefOfParticipation(ref: WorkParticipationRef): WorkContextRef {
  return {
    aggregateType: "WorkContextBinding",
    projectId: ref.projectId,
    workspaceId: ref.workspaceId,
    workId: ref.workId,
  };
}

function workContextRefForOfMailbox(projectId: string, workspaceId: string, workId: string): WorkContextRef {
  return { aggregateType: "WorkContextBinding", projectId, workspaceId, workId };
}

function runLinkedInBinding(binding: WorkContextBindingSnapshot, runRef: RunSnapshot["ref"]): boolean {
  const key = canonicalJson(runRef);
  if (canonicalJson(binding.binding.initialRunRef) === key) return true;
  return binding.binding.linkedRunRefs.some((linked) => canonicalJson(linked) === key);
}

function checkWaitTerm(term: unknown, path: string, projectId: string, workspaceId: string, issues: string[]): void {
  const record = asRecord(term);
  if (record === null) {
    issues.push(path + " 必须是等待条件项");
    return;
  }
  if (record["kind"] === "delivery_present") {
    checkDeliveryRefShape(record["deliveryRef"], path + ".deliveryRef", projectId, workspaceId, issues);
    return;
  }
  if (record["kind"] === "request_responded" || record["kind"] === "request_closed") {
    const ref = asRecord(record["requestRef"]);
    if (ref === null) {
      issues.push(path + ".requestRef 必须是 DirectedRequestRef");
      return;
    }
    if (ref["aggregateType"] !== "DirectedRequest") issues.push(path + ".requestRef.aggregateType 必须是 DirectedRequest");
    checkRefScope(ref, path + ".requestRef", projectId, workspaceId, issues);
    requireString(ref["requestId"], path + ".requestRef.requestId", issues);
    return;
  }
  issues.push(path + ".kind 必须是 delivery_present|request_responded|request_closed");
}

function checkDeliveryRefShape(value: unknown, path: string, projectId: string, workspaceId: string, issues: string[]): void {
  const record = asRecord(value);
  if (record === null) {
    issues.push(path + " 必须是 DeliveryRef");
    return;
  }
  if (record["aggregateType"] !== "Delivery") issues.push(path + ".aggregateType 必须是 Delivery");
  checkRefScope(record, path, projectId, workspaceId, issues);
  requireString(record["deliveryId"], path + ".deliveryId", issues);
}

function checkWaitConditionRefShape(value: unknown, path: string, projectId: string, workspaceId: string, issues: string[]): void {
  const record = asRecord(value);
  if (record === null) {
    issues.push(path + " 必须是 WaitConditionRef");
    return;
  }
  if (record["aggregateType"] !== "WaitCondition") issues.push(path + ".aggregateType 必须是 WaitCondition");
  checkRefScope(record, path, projectId, workspaceId, issues);
  requireString(record["waitId"], path + ".waitId", issues);
  // 注意：WaitConditionRef 的 canonical 形状**只有** (aggregateType, projectId, workspaceId, waitId)
  // ——见 contracts/coordination.ts 的 WaitConditionRef 与 waitConditionRefFor。这里曾多要求一个
  // workId 字段，而契约与所有生产者都不产生它，于是任何合法的 waitRef 都会被判非法（本票第 3 工作段
  // 的 Dispatch 消费者第一次真正用到它时暴露）。归属 Work 一律由**canonical 快照**判定
  // （见 admitWaitSuccessor 的同名说明），ref 本身不携带、也不校验 workId。
}

function checkRoutePageProposal(value: unknown, projectId: string, workspaceId: string, issues: string[]): void {
  const page = asRecord(value);
  if (page === null) {
    issues.push("payload.page 必须是 RoutePageProposalV1");
    return;
  }
  requireString(page["sourceTopic"], "payload.page.sourceTopic", issues);
  if (!isLedgerCursor(page["sourceCursor"])) issues.push("payload.page.sourceCursor 必须是账本游标");
  // 本页处理到的**订阅分页位置**（协议约束 1.4）：一个 canonical ref key 或 null（本页没处理订阅）。
  if (page["subscriptionPosition"] !== null && typeof page["subscriptionPosition"] !== "string") {
    issues.push("payload.page.subscriptionPosition 必须是 canonical ref key 或 null");
  }
  if (typeof page["hasMore"] !== "boolean") issues.push("payload.page.hasMore 必须是布尔值");
  /**
   * CM-1A-001 第 4 步（协议约束 1.4）：本轮固定的订阅范围。
   * 必填数组；每一项是 { subscriptionRef, expectedRevision }，引用必须属于本页作用域。
   * 成员资格、版本与"范围是否与已固定的一致"在 buildRoutePage 里与 canonical 订阅逐条核对。
   */
  const scope = page["subscriptionScope"];
  if (!Array.isArray(scope)) {
    issues.push("payload.page.subscriptionScope 必须是数组（本轮固定的订阅范围）");
  } else {
    scope.forEach((entry, index) => {
      const path = "payload.page.subscriptionScope[" + String(index) + "]";
      const record = asRecord(entry);
      if (record === null) { issues.push(path + " 必须是 { subscriptionRef, expectedRevision }"); return; }
      const ref = asRecord(record["subscriptionRef"]);
      if (ref === null || ref["aggregateType"] !== "Subscription") {
        issues.push(path + ".subscriptionRef 必须是 SubscriptionRef");
      } else {
        checkRefScope(ref, path + ".subscriptionRef", projectId, workspaceId, issues);
        requireString(ref["subscriptionId"], path + ".subscriptionRef.subscriptionId", issues);
      }
      const expectedRevision = record["expectedRevision"];
      if (!Number.isInteger(expectedRevision) || (expectedRevision as number) < 0) {
        issues.push(path + ".expectedRevision 必须是非负整数");
      }
    });
  }
  const subscriptions = page["subscriptions"];
  if (!Array.isArray(subscriptions)) {
    issues.push("payload.page.subscriptions 必须是数组");
    return;
  }
  subscriptions.forEach((entry, index) => {
    const path = "payload.page.subscriptions[" + String(index) + "]";
    const record = asRecord(entry);
    if (record === null) {
      issues.push(path + " 必须是页内订阅项");
      return;
    }
    const ref = asRecord(record["subscriptionRef"]);
    if (ref === null) {
      issues.push(path + ".subscriptionRef 必须是 SubscriptionRef");
    } else {
      if (ref["aggregateType"] !== "Subscription") issues.push(path + ".subscriptionRef.aggregateType 必须是 Subscription");
      checkRefScope(ref, path + ".subscriptionRef", projectId, workspaceId, issues);
      requireString(ref["subscriptionId"], path + ".subscriptionRef.subscriptionId", issues);
    }
    if (typeof record["expectedRevision"] !== "number" || !Number.isInteger(record["expectedRevision"])) {
      issues.push(path + ".expectedRevision 必须是整数");
    }
    const deliveries = record["deliveries"];
    if (!Array.isArray(deliveries)) issues.push(path + ".deliveries 必须是数组");
    else {
      deliveries.forEach((delivery, deliveryIndex) => {
        const deliveryPath = path + ".deliveries[" + String(deliveryIndex) + "]";
        const record2 = asRecord(delivery);
        if (record2 === null) {
          issues.push(deliveryPath + " 必须是投递项");
          return;
        }
        requireString(record2["deliveryId"], deliveryPath + ".deliveryId", issues);
        checkWorkContextRef(record2["targetWorkContextRef"], deliveryPath + ".targetWorkContextRef", projectId, workspaceId, issues);
        if (record2["bodyRef"] !== null && record2["bodyRef"] !== undefined) {
          checkArtifactRef(record2["bodyRef"], deliveryPath + ".bodyRef", issues);
        }
      });
    }
    const waits = record["satisfiedWaitIndexes"];
    if (!Array.isArray(waits)) issues.push(path + ".satisfiedWaitIndexes 必须是数组");
    else {
      waits.forEach((transition, waitIndex) => {
        const waitPath = path + ".satisfiedWaitIndexes[" + String(waitIndex) + "]";
        const record2 = asRecord(transition);
        if (record2 === null) {
          issues.push(waitPath + " 必须是等待推进项");
          return;
        }
        checkWaitConditionRefShape(record2["waitRef"], waitPath + ".waitRef", projectId, workspaceId, issues);
        if (!Array.isArray(record2["indexes"]) || !(record2["indexes"] as unknown[]).every((i) => Number.isInteger(i))) {
          issues.push(waitPath + ".indexes 必须是整数数组");
        }
      });
    }
  });
}

/**
 * 下一页 route intent（见文件头 (c)）：首页逐字节使用协议的 routePageIntentFor，
 * 只有需要在同一 (topic, cursor) 上继续分页时才派生稳定后缀。
 */
function nextRouteIntentFor(input: {
  projectId: string;
  workspaceId: string;
  topic: string;
  cursor: CommitCursor;
  /** 本页处理到的订阅分页位置（canonical ref key）。 */
  subscriptionPosition: string;
  /** 本轮固定的订阅范围（翻页期间逐字节不变）。 */
  subscriptionScope: import("../../contracts/coordination.js").RoutePageSubscriptionScopeEntry[];
  now: string;
}): CommunicationIntentV1 {
  const base = routePageIntentFor({
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    topic: input.topic,
    cursor: input.cursor,
    now: input.now,
  });
  return {
    ...base,
    // 续页必须是与首页**不同的聚合**（同一 (topic, cursor) 上同一 ref 只能有一份 @1 快照），
    // 因此 intentId 由「首页 id + 订阅分页位置的稳定摘要」派生；首页仍逐字节使用协议 helper。
    intentId: base.intentId + "-p" + sha256Hex(input.subscriptionPosition).slice(0, 8),
    domain: {
      kind: "route_page",
      sourceTopic: input.topic,
      sourceCursor: input.cursor,
      subscriptionPosition: input.subscriptionPosition,
      subscriptionScope: input.subscriptionScope.map((entry) => ({ subscriptionRef: { ...entry.subscriptionRef }, expectedRevision: entry.expectedRevision })),
    },
  };
}

/** 订阅分页位置的严格先后（canonical ref key 的 localeCompare 序，与 selectPageSubscriptions 同一口径）。 */
function refKeyAfter(a: string, b: string): boolean {
  return a.localeCompare(b) > 0;
}

/**
 * admitWaitSuccessor 的拒绝构造。
 *
 * owner 裁决 D06 之后，AdmitWaitSuccessorReceipt（与 CommunicationClaimReceipt）的 rejected
 * 变体带 **可选 issues**，与同族 CommunicationWriteReceipt / CommunicationSettleReceipt 一致：
 * 后继受理与机械领取都有十来个拒绝分支，只给一个 code 会让调用方无法诊断。类型与运行时
 * 因此完全一致（不再有声明类型之外的附加字段）。
 */
type AdmitRejection = Extract<AdmitWaitSuccessorReceipt, { status: "rejected" }>;
function admitReject(
  commandId: string,
  code: AdmitRejection["code"],
  issues?: string[],
  currentRevision?: number,
): AdmitWaitSuccessorReceipt {
  return {
    status: "rejected",
    commandId,
    code,
    ...(issues === undefined ? {} : { issues }),
    ...(currentRevision === undefined ? {} : { currentRevision }),
  };
}

type EnsureAdmissionRejection = Extract<EnsureWaitAdmissionReceipt, { status: "rejected" }>;
function ensureAdmissionReject(
  commandId: string,
  code: EnsureAdmissionRejection["code"],
  issues?: string[],
  currentRevision?: number,
): EnsureWaitAdmissionReceipt {
  return {
    status: "rejected",
    commandId,
    code,
    ...(issues === undefined ? {} : { issues }),
    ...(currentRevision === undefined ? {} : { currentRevision }),
  };
}

function mapSettleCommitRejection(
  receipt: Extract<LedgerCommitReceipt, { status: "rejected" }>,
  commandId: string,
  intentRefKey: string,
): CommunicationSettleReceipt {
  if (receipt.code === "revision_conflict") {
    const current = (receipt.currentVersions ?? []).find((v) => canonicalJson(v.ref) === intentRefKey);
    return current === undefined
      ? { status: "rejected", commandId, code: "revision_conflict" }
      : { status: "rejected", commandId, code: "revision_conflict", currentRevision: current.revision };
  }
  if (receipt.code === "idempotency_conflict") return { status: "rejected", commandId, code: "idempotency_conflict" };
  if (receipt.code === "unavailable") return { status: "rejected", commandId, code: "unavailable" };
  return { status: "rejected", commandId, code: "invalid", issues: ["StateLedger 拒绝了提交形状（事件/快照/期望版本不一致）"] };
}

type MailboxRefCollector = {
  participations: Map<string, WorkParticipationRef>;
  requests: Map<string, DirectedRequestRef>;
  subscriptions: Map<string, SubscriptionRef>;
  waits: Map<string, WaitConditionRef>;
  deliveries: Map<string, DeliveryRef>;
};

/** 只按事件 payload 里声明的 canonical 归属关系收引用；不猜、不按 id 前缀匹配。 */
function collectMailboxRefs(event: DomainEvent, scope: { projectId: string; workspaceId: string; workId: string }, out: MailboxRefCollector): void {
  const inScope = (projectId: string | undefined, workspaceId: string | undefined): boolean =>
    projectId === scope.projectId && workspaceId === scope.workspaceId;
  switch (event.eventType) {
    case "WorkParticipationStarted":
    case "WorkParticipationEnded": {
      const participation = (event as WorkParticipationStartedEvent | WorkParticipationEndedEvent).payload.participation;
      const work = participation.workContextRef;
      if (!inScope(work.projectId, work.workspaceId) || work.workId !== scope.workId) return;
      const ref = workParticipationRefFor(work.projectId, work.workspaceId, work.workId, participation.participationId);
      out.participations.set(canonicalJson(ref), ref);
      return;
    }
    case "DirectedRequestSent":
    case "DirectedRequestResponded":
    case "DirectedRequestCancelled": {
      const request = (event as DirectedRequestSentEvent | DirectedRequestRespondedEvent | DirectedRequestCancelledEvent).payload.request;
      if (!inScope(request.projectId, request.workspaceId)) return;
      if (request.fromWorkContextRef.workId !== scope.workId && request.toWorkContextRef.workId !== scope.workId) return;
      const ref = directedRequestRefFor(request.projectId, request.workspaceId, request.requestId);
      out.requests.set(canonicalJson(ref), ref);
      return;
    }
    case "SubscriptionCreated":
    case "SubscriptionCancelled": {
      const subscription = (event as SubscriptionCreatedEvent | SubscriptionCancelledEvent).payload.subscription;
      if (!inScope(subscription.projectId, subscription.workspaceId)) return;
      if (subscription.ownerWorkContextRef.workId !== scope.workId) return;
      const ref = subscriptionRefFor(subscription.projectId, subscription.workspaceId, subscription.subscriptionId);
      out.subscriptions.set(canonicalJson(ref), ref);
      return;
    }
    case "DeliveryRecorded": {
      const delivery = (event as import("../../contracts/coordination.js").DeliveryRecordedEvent).payload.delivery;
      if (!inScope(delivery.projectId, delivery.workspaceId)) return;
      if (delivery.targetWorkContextRef.workId !== scope.workId) return;
      const ref = deliveryRefFor(delivery.projectId, delivery.workspaceId, delivery.deliveryId);
      out.deliveries.set(canonicalJson(ref), ref);
      return;
    }
    case "WaitConditionRegistered":
    case "WaitConditionObserved":
    case "WaitConditionSatisfied":
    case "WaitConditionTimedOut":
    case "WaitConditionCancelled": {
      const wait = (event as WaitConditionRegisteredEvent | WaitConditionObservedEvent | WaitConditionSatisfiedEvent | WaitConditionTimedOutEvent | WaitConditionCancelledEvent).payload.wait;
      if (!inScope(wait.projectId, wait.workspaceId)) return;
      if (wait.ownerWorkContextRef.workId !== scope.workId) return;
      const ref = waitConditionRefForOf(wait.projectId, wait.workspaceId, wait.waitId);
      out.waits.set(canonicalJson(ref), ref);
      return;
    }
    default:
      return;
  }
}

function sortByRefKey<T extends { ref: { aggregateType: string } }>(snapshots: T[]): T[] {
  return [...snapshots].sort((a, b) => canonicalJson(a.ref).localeCompare(canonicalJson(b.ref)));
}

export type { CoordinationRegistrySnapshot, WorkMailboxSnapshot, CommunicationIntentRef };
