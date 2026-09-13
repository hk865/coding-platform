/**
 * Control 持有的协作通信 canonical 记录构造（确定性 fold）。
 * 这里只做纯构造：业务准入守卫在 handlers 里，事务权威在 StateLedger。
 */
import type { CommitCursor } from "../../../contracts/command-event.js";
import type {
  DispatchIntentV1,
  DispatchOutboxEntrySnapshot,
  RunSnapshot,
  TaskAttemptSnapshot,
  TaskLeaseSnapshot,
} from "../../../contracts/dispatch.js";
import { dispatchOutboxRefFor, runRefFor, taskAttemptRefFor, taskLeaseRefFor } from "../../../contracts/dispatch.js";
import type { PlanRevisionRef } from "../../../contracts/plan.js";
import type { ContextManifestV1 } from "../../../contracts/task-envelope.js";
import type {
  AdmitWaitSuccessorCommand,
  AgentInstanceRegisterCommitV1,
  AgentInstanceSnapshot,
  AgentInstanceV1,
  CancelCommunicationCommand,
  CommunicationAdmissionSnapshot,
  CommunicationAdmissionV1,
  CommunicationClaimCommand,
  CommunicationClaimReceipt,
  CommunicationIntentCancelRequestCommitV1,
  CommunicationIntentClaimCommitV1,
  CommunicationIntentRef,
  CommunicationIntentSettleCommitV1,
  CommunicationIntentSnapshot,
  CommunicationIntentV1,
  CommunicationRoutePageCommitV1,
  CommunicationSettleCommand,
  CommunicationSuccessorClaimCommitV1,
  DeliverySnapshot,
  DeliveryV1,
  DirectedRequestCancelCommitV1,
  DirectedRequestRef,
  DirectedRequestRespondCommitV1,
  DirectedRequestSendCommitV1,
  DirectedRequestSnapshot,
  DirectedRequestV1,
  EndWorkParticipationCommand,
  ParticipationEndCommitV1,
  ParticipationStartCommitV1,
  RegisterAgentInstanceCommand,
  RegisterWaitCommand,
  RequestIntentCancellationCommand,
  RespondDirectedRequestCommand,
  RouteIntentPlanV1,
  RoutePageSubscriptionScopeEntry,
  SendDirectedRequestCommand,
  StartWorkParticipationCommand,
  SubscribeCommand,
  SubscriptionCancelCommitV1,
  SubscriptionCatchupCommitV1,
  SubscriptionCreateCommitV1,
  SubscriptionSnapshot,
  SubscriptionV1,
  WaitCancelCommitV1,
  WaitConditionRef,
  WaitConditionSnapshot,
  WaitConditionV1,
  WaitRegisterCommitV1,
  WorkParticipationSnapshot,
  WorkParticipationV1,
} from "../../../contracts/coordination.js";
import type { WorkContextBindingSnapshot } from "../../../contracts/context-continuity.js";
import {
  communicationIntentCancelRequestedEvent,
  communicationIntentClaimedEvent,
  communicationIntentRecordedEvent,
  communicationIntentSettledEvent,
  deliveryRecordedEvent,
  directedRequestCancelledEvent,
  directedRequestRespondedEvent,
  directedRequestSentEvent,
  directDeliveryIdFor,
  subscriptionCancelledEvent,
  subscriptionCreatedEvent,
} from "../../../contracts/coordination-events.js";
import { subscriptionCatchupPlannedEvent } from "../../../contracts/coordination-events.js";
import { canonicalJson } from "../../../contracts/fingerprint.js";
import {
  waitConditionCancelledEvent,
  waitConditionObservedEvent,
  waitConditionRegisteredEvent,
  waitConditionSatisfiedEvent,
  waitConditionTimedOutEvent,
  workParticipationRefFor,
  agentInstanceRegisteredEvent,
  participationStartEvent,
  participationEndEvent,
  communicationAdmissionRecordedEvent,
} from "../../../contracts/coordination-events.js";
import {
  successorAttemptIdFor,
  successorRunIdFor,
  waitAdmissionIntentIdFor,
  waitDeadlineIntentIdFor,
  routePageIntentIdFor,
} from "../../../contracts/coordination.js";
import type { TaskClaimedEvent } from "../../../contracts/dispatch.js";

export type CoordinationFoldDeps = {
  eventId: () => string;
  now: () => string;
  workspaceId: string;
};

/** 一次提交内的事件上下文（身份 + 命令 + 时间）。 */
export type FoldContext = {
  commandId: string;
  correlationId: string;
  occurredAt: string;
  identity: import("../../../contracts/command-event.js").CommandIdentity;
};

function ctxOf(command: { commandId: string; correlationId: string; identity: import("../../../contracts/command-event.js").CommandIdentity }, occurredAt: string): FoldContext {
  return { commandId: command.commandId, correlationId: command.correlationId, occurredAt, identity: command.identity };
}

// ------------------------------------------------------------------------ //
// AgentInstance / WorkParticipation（A01）                                   //
// ------------------------------------------------------------------------ //

export function buildAgentInstanceRegisterCommit(
  command: RegisterAgentInstanceCommand,
  deps: CoordinationFoldDeps,
  fingerprint: AgentInstanceRegisterCommitV1["fingerprint"],
): AgentInstanceRegisterCommitV1 {
  const now = deps.now();
  const agent: AgentInstanceV1 = {
    schemaVersion: 1,
    agentInstanceId: command.aggregateId,
    projectId: command.identity.projectId,
    workspaceId: deps.workspaceId,
    templateId: command.payload.templateId,
    templateRevision: command.payload.templateRevision,
    status: "active",
    createdAt: now,
    retiredAt: null,
  };
  const snapshot: AgentInstanceSnapshot = {
    ref: { aggregateType: "AgentInstance", projectId: command.identity.projectId, workspaceId: deps.workspaceId, agentInstanceId: command.aggregateId },
    revision: 1,
    schemaVersion: 1,
    agent,
    recordedAt: now,
  };
  return {
    commitKind: "agent-instance-register",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint,
    expectedVersions: [{ ref: snapshot.ref, revision: 0 }],
    events: [agentInstanceRegisteredEvent(ctxOf(command, now), deps.eventId(), agent)],
    snapshots: [snapshot],
    outboxIntents: [],
  };
}

export function buildParticipationStartCommit(
  command: StartWorkParticipationCommand,
  deps: CoordinationFoldDeps,
  fingerprint: ParticipationStartCommitV1["fingerprint"],
  priorBinding: import("../../../contracts/context-continuity.js").WorkContextBindingSnapshot,
): ParticipationStartCommitV1 {
  const now = deps.now();
  const participation: WorkParticipationV1 = {
    schemaVersion: 1,
    participationId: command.aggregateId,
    workContextRef: command.payload.workContextRef,
    agentInstanceId: command.payload.agentInstanceId,
    roleBinding: { ...command.payload.roleBinding },
    status: "active",
    startedAt: now,
    endedAt: null,
  };
  const snapshot: WorkParticipationSnapshot = {
    ref: workParticipationRefFor(
      command.identity.projectId,
      deps.workspaceId,
      command.payload.workContextRef.workId,
      command.aggregateId,
    ),
    revision: 1,
    schemaVersion: 1,
    participation,
    recordedAt: now,
  };
  // 同一事务把发起 Run link 进该 Work（workId 不变，linkedRunRefs 有界追加）。
  const linked = [...priorBinding.binding.linkedRunRefs];
  if (!linked.some((r) => canonicalJson(r) === canonicalJson(command.payload.runRef))) {
    linked.push({ ...command.payload.runRef });
  }
  // CM-1A-001 第 2 步：同一个提交里**同时**占用该 Work 的当前参与关系。
  // 这是 Work 权威状态上唯一会改 currentParticipationRef 的地方（见 WorkContextBindingV1），
  // 且与参与关系快照、WorkRunLinked 事件、绑定自身的 CAS 不可分割：两个并发 start 只有一个
  // 能推进这个绑定 revision，因此「当前参与关系」永远是单值、可原子读改的。
  const participationRef = snapshot.ref;
  const bindingSnapshot: import("../../../contracts/context-continuity.js").WorkContextBindingSnapshot = {
    ...priorBinding,
    revision: priorBinding.revision + 1,
    binding: { ...priorBinding.binding, linkedRunRefs: linked, currentParticipationRef: { ...participationRef } },
  };
  const ctx = ctxOf(command, now);
  const linkEvent: import("../../../contracts/context-continuity.js").WorkRunLinkedEvent = {
    eventId: deps.eventId(),
    eventType: "WorkRunLinked",
    schemaVersion: 1,
    projectId: priorBinding.ref.projectId,
    workspaceId: priorBinding.ref.workspaceId,
    aggregateType: "WorkContextBinding",
    aggregateId: priorBinding.ref.workId,
    aggregateRevision: bindingSnapshot.revision,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: command.identity.actor,
    occurredAt: now,
    payload: { runRef: { ...command.payload.runRef }, linkedRunRefs: linked },
  };
  return {
    commitKind: "participation-start",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint,
    expectedVersions: [
      { ref: snapshot.ref, revision: 0 },
      { ref: priorBinding.ref, revision: priorBinding.revision },
    ],
    events: [participationStartEvent(ctx, deps.eventId(), participation), linkEvent],
    snapshots: [snapshot, bindingSnapshot],
    outboxIntents: [],
  };
}

/**
 * participation-end：参与关系结束（CAS@N）。
 *
 * 历史保留、不改名、不删除：只把 status 置 `ended` 并记 endedAt。endedAt 取 prior 的
 * 既有值（**首次**结束的时间就是权威事实），因此同一段参与关系的多个结束提交不会改写它。
 * 归属不会因此改变：Request/Subscription/Wait/Delivery 的 owner 是 WorkContextBinding，
 * 参与关系结束不影响它们的 workContextRef（A01「等待仍归 Work」）。
 */
export function buildParticipationEndCommit(input: {
  command: EndWorkParticipationCommand;
  deps: CoordinationFoldDeps;
  fingerprint: ParticipationEndCommitV1["fingerprint"];
  prior: WorkParticipationSnapshot;
}): ParticipationEndCommitV1 {
  const { command, deps, prior } = input;
  const now = deps.now();
  const participation: WorkParticipationV1 = {
    ...prior.participation,
    status: "ended",
    endedAt: prior.participation.endedAt ?? now,
  };
  // 快照 revision 必须与 expectedRevision 对齐（账本的形状规则是 revision === expected + 1）。
  // 正常路径 expectedRevision === prior.revision；「已经 ended 再结束」路径下调用方给的是
  // 落后版本，账本会先判幂等（同一命令身份 → committed/replayed）或先判 CAS 失败
  // （另一命令身份 → revision_conflict），因此这个批次永远不会被真正写入。
  const snapshot: WorkParticipationSnapshot = { ...prior, revision: command.expectedRevision + 1, participation, recordedAt: now };
  return {
    commitKind: "participation-end",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: input.fingerprint,
    expectedVersions: [{ ref: prior.ref, revision: command.expectedRevision }],
    events: [participationEndEvent(ctxOf(command, now), deps.eventId(), participation, snapshot.revision)],
    snapshots: [snapshot],
    outboxIntents: [],
  };
}

// ------------------------------------------------------------------------ //
// DirectedRequest（A02）                                                     //
// ------------------------------------------------------------------------ //

export function directedRequestRefForOf(projectId: string, workspaceId: string, requestId: string): DirectedRequestRef {
  return { aggregateType: "DirectedRequest", projectId, workspaceId, requestId };
}

export function deliveryRefForOf(projectId: string, workspaceId: string, deliveryId: string): DeliveryV1 extends never ? never : { aggregateType: "Delivery"; projectId: string; workspaceId: string; deliveryId: string } {
  return { aggregateType: "Delivery", projectId, workspaceId, deliveryId };
}

export function buildDirectedRequestSendCommit(input: {
  command: SendDirectedRequestCommand;
  deps: CoordinationFoldDeps;
  fingerprint: DirectedRequestSendCommitV1["fingerprint"];
  sourceRefs: { kind: string; refId: string; revision: string }[];
}): DirectedRequestSendCommitV1 {
  const { command, deps } = input;
  const workspaceId = deps.workspaceId;
  const now = deps.now();
  const projectId = command.identity.projectId;
  const ref = directedRequestRefForOf(projectId, workspaceId, command.aggregateId);
  const request: DirectedRequestV1 = {
    schemaVersion: 1,
    requestId: command.aggregateId,
    projectId,
    workspaceId,
    fromWorkContextRef: {
      aggregateType: "WorkContextBinding",
      projectId: command.payload.fromParticipationRef.projectId,
      workspaceId: command.payload.fromParticipationRef.workspaceId,
      workId: command.payload.fromParticipationRef.workId,
    },
    fromParticipationRef: command.payload.fromParticipationRef,
    fromRunRef: command.payload.fromRunRef,
    toWorkContextRef: command.payload.toWorkContextRef,
    expectedParticipationRef: command.payload.expectedParticipationRef,
    statement: command.payload.statement,
    statementBodyRef: command.payload.statementBodyRef,
    roleBinding: { ...command.payload.roleBinding },
    status: "routed",
    createdAt: now,
    respondedAt: null,
    response: null,
    cancelledAt: null,
    expiredAt: null,
  };
  const snapshot: DirectedRequestSnapshot = { ref, revision: 1, schemaVersion: 1, request, recordedAt: now };
  const delivery: DeliveryV1 = {
    schemaVersion: 1,
    deliveryId: directDeliveryIdFor(command.aggregateId, command.payload.toWorkContextRef.workId),
    projectId,
    workspaceId,
    origin: { kind: "directed_request", requestRef: ref },
    targetWorkContextRef: command.payload.toWorkContextRef,
    bodyRef: command.payload.statementBodyRef,
    sourceRefs: input.sourceRefs,
    createdAt: now,
  };
  const deliverySnapshot: DeliverySnapshot = {
    ref: deliveryRefForOf(projectId, workspaceId, delivery.deliveryId),
    revision: 1,
    schemaVersion: 1,
    delivery,
    recordedAt: now,
  };
  const ctx = ctxOf(command, now);
  return {
    commitKind: "directed-request-send",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: input.fingerprint,
    expectedVersions: [
      { ref, revision: 0 },
      { ref: deliverySnapshot.ref, revision: 0 },
    ],
    events: [directedRequestSentEvent(ctx, deps.eventId(), request), deliveryRecordedEvent(ctx, deps.eventId(), delivery)],
    snapshots: [snapshot, deliverySnapshot],
    outboxIntents: [],
  };
}

export function buildDirectedRequestRespondCommit(input: {
  command: RespondDirectedRequestCommand;
  deps: CoordinationFoldDeps;
  fingerprint: DirectedRequestRespondCommitV1["fingerprint"];
  prior: DirectedRequestSnapshot;
}): DirectedRequestRespondCommitV1 {
  const { command, deps, prior } = input;
  const now = deps.now();
  const request: DirectedRequestV1 = {
    ...prior.request,
    status: "responded",
    respondedAt: now,
    response: {
      bodyRef: command.payload.response.bodyRef,
      sourceRefs: command.payload.response.sourceRefs.map((s) => ({ ...s })),
      authorRunRef: command.payload.response.authorRunRef,
    },
  };
  const snapshot: DirectedRequestSnapshot = { ...prior, revision: prior.revision + 1, request, recordedAt: now };
  return {
    commitKind: "directed-request-respond",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: input.fingerprint,
    expectedVersions: [{ ref: prior.ref, revision: command.expectedRevision }],
    events: [directedRequestRespondedEvent(ctxOf(command, now), deps.eventId(), request, snapshot.revision)],
    snapshots: [snapshot],
    outboxIntents: [],
  };
}

export function buildDirectedRequestCancelCommit(input: {
  command: CancelCommunicationCommand;
  deps: CoordinationFoldDeps;
  fingerprint: DirectedRequestCancelCommitV1["fingerprint"];
  prior: DirectedRequestSnapshot;
}): DirectedRequestCancelCommitV1 {
  const { command, deps, prior } = input;
  const now = deps.now();
  const request: DirectedRequestV1 = { ...prior.request, status: "cancelled", cancelledAt: now };
  const snapshot: DirectedRequestSnapshot = { ...prior, revision: prior.revision + 1, request, recordedAt: now };
  return {
    commitKind: "directed-request-cancel",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: input.fingerprint,
    expectedVersions: [{ ref: prior.ref, revision: command.expectedRevision }],
    events: [directedRequestCancelledEvent(ctxOf(command, now), deps.eventId(), request, snapshot.revision)],
    snapshots: [snapshot],
    outboxIntents: [],
  };
}

// ------------------------------------------------------------------------ //
// Subscription（A03）                                                        //
// ------------------------------------------------------------------------ //

export function buildSubscriptionCreateCommit(input: {
  command: SubscribeCommand;
  deps: CoordinationFoldDeps;
  fingerprint: SubscriptionCreateCommitV1["fingerprint"];
}): SubscriptionCreateCommitV1 {
  const { command, deps } = input;
  const workspaceId = deps.workspaceId;
  const now = deps.now();
  const subscription: SubscriptionV1 = {
    schemaVersion: 1,
    subscriptionId: command.aggregateId,
    projectId: command.identity.projectId,
    workspaceId,
    ownerWorkContextRef: command.payload.ownerWorkContextRef,
    ownerParticipationRef: command.payload.ownerParticipationRef,
    topics: [...command.payload.topics],
    startCursor: command.payload.startCursor,
    routedThroughCursor: null,
    status: "active",
    createdAt: now,
    cancelledAt: null,
  };
  const snapshot: SubscriptionSnapshot = {
    ref: { aggregateType: "Subscription", projectId: command.identity.projectId, workspaceId, subscriptionId: command.aggregateId },
    revision: 1,
    schemaVersion: 1,
    subscription,
    recordedAt: now,
  };
  return {
    commitKind: "subscription-create",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: input.fingerprint,
    expectedVersions: [{ ref: snapshot.ref, revision: 0 }],
    events: [subscriptionCreatedEvent(ctxOf(command, now), deps.eventId(), subscription)],
    snapshots: [snapshot],
    outboxIntents: [],
  };
}

export function buildSubscriptionCancelCommit(input: {
  command: CancelCommunicationCommand;
  deps: CoordinationFoldDeps;
  fingerprint: SubscriptionCancelCommitV1["fingerprint"];
  prior: SubscriptionSnapshot;
}): SubscriptionCancelCommitV1 {
  const { command, deps, prior } = input;
  const now = deps.now();
  const subscription: SubscriptionV1 = { ...prior.subscription, status: "cancelled", cancelledAt: now };
  const snapshot: SubscriptionSnapshot = { ...prior, revision: prior.revision + 1, subscription, recordedAt: now };
  return {
    commitKind: "subscription-cancel",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: input.fingerprint,
    expectedVersions: [{ ref: prior.ref, revision: command.expectedRevision }],
    events: [subscriptionCancelledEvent(ctxOf(command, now), deps.eventId(), subscription, snapshot.revision)],
    snapshots: [snapshot],
    outboxIntents: [],
  };
}

/**
 * subscription-catchup：把"从现在起"的订阅锚定到观察到的 frontier，并为每个 topic
 * 建立首个 route intent（形状见 contracts/coordination.ts 的 SubscriptionCatchupCommitV1）。
 *
 * 本函数是纯构造：frontier 由调用方（Control handler）读账本得到，这里不读任何 I/O。
 */
export function buildSubscriptionCatchupCommit(input: {
  command: SubscribeCommand;
  deps: CoordinationFoldDeps;
  fingerprint: SubscriptionCatchupCommitV1["fingerprint"];
  prior: SubscriptionSnapshot;
  frontierCursor: CommitCursor | null;
  intents: CommunicationIntentV1[];
}): SubscriptionCatchupCommitV1 {
  const { command, deps, prior } = input;
  const now = deps.now();
  const subscription: SubscriptionV1 = {
    ...prior.subscription,
    // 锚定在观察到的 frontier：订阅之前（含 frontier 位置）的事件不会被补投。
    startCursor: input.frontierCursor,
  };
  const snapshot: SubscriptionSnapshot = { ...prior, revision: prior.revision + 1, subscription, recordedAt: now };
  const ctx = ctxOf(command, now);
  return {
    commitKind: "subscription-catchup",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: input.fingerprint,
    expectedVersions: [
      { ref: prior.ref, revision: prior.revision },
      ...input.intents.map((intent) => ({
        ref: communicationIntentRefForOf(intent.projectId, intent.workspaceId, intent.intentId),
        revision: 0,
      })),
    ],
    events: [
      subscriptionCatchupPlannedEvent(ctx, deps.eventId(), subscription, snapshot.revision, input.frontierCursor, input.intents),
      ...input.intents.map((intent) => communicationIntentRecordedEvent(ctx, deps.eventId(), intent)),
    ],
    snapshots: [snapshot, ...input.intents.map((intent) => intentSnapshotFor(intent, now))],
    outboxIntents: [],
  };
}

// ------------------------------------------------------------------------ //
// WaitCondition（A05）                                                       //
// ------------------------------------------------------------------------ //

export function waitConditionRefForOf(projectId: string, workspaceId: string, waitId: string): WaitConditionRef {
  return { aggregateType: "WaitCondition", projectId, workspaceId, waitId };
}

export function communicationIntentRefForOf(projectId: string, workspaceId: string, intentId: string): CommunicationIntentRef {
  return { aggregateType: "CommunicationIntent", projectId, workspaceId, intentId };
}

export function intentSnapshotFor(intent: CommunicationIntentV1, recordedAt: string): CommunicationIntentSnapshot {
  return { ref: communicationIntentRefForOf(intent.projectId, intent.workspaceId, intent.intentId), revision: 1, schemaVersion: 1, intent, recordedAt };
}

/**
 * 单独登记一个机械 intent（CAS@0）。形状见 contracts/coordination.ts 的
 * CommunicationIntentRecordCommitV1：只有一条 CommunicationIntentRecorded 事件与一个 @1 快照。
 */
export function buildIntentRecordCommit(input: {
  command: { commandId: string; correlationId: string; identity: import("../../../contracts/command-event.js").CommandIdentity };
  deps: CoordinationFoldDeps;
  fingerprint: import("../../../contracts/coordination.js").CommunicationIntentRecordCommitV1["fingerprint"];
  intent: CommunicationIntentV1;
}): import("../../../contracts/coordination.js").CommunicationIntentRecordCommitV1 {
  const now = input.deps.now();
  return {
    commitKind: "communication-intent-record",
    schemaVersion: 1,
    identity: { ...input.command.identity },
    fingerprint: input.fingerprint,
    expectedVersions: [{ ref: communicationIntentRefForOf(input.intent.projectId, input.intent.workspaceId, input.intent.intentId), revision: 0 }],
    events: [communicationIntentRecordedEvent(ctxOf(input.command, now), input.deps.eventId(), input.intent)],
    snapshots: [intentSnapshotFor(input.intent, now)],
    outboxIntents: [],
  };
}

/**
 * 把**源事件触发的待路由 intent 计划**挂到这次提交上（CM-1A-001 第 4 步，协议约束 1.4）。
 *
 * 纯构造：位置（sourceCursor）与 intentId 由账本在同一个事务里按 anchor 事件的落点算出，
 * 因此这里只声明"这次提交里哪一个事件是源事件"与整轮订阅范围。`null` = 没有候选订阅，
 * 不登记任何计划（提交形状与语义与第 3 工作段逐字节相同）。
 */
export function withRouteIntentPlan<T extends { routeIntentPlans?: RouteIntentPlanV1[] }>(
  batch: T,
  plan: RouteIntentPlanV1 | null,
): T {
  if (plan === null) return batch;
  return { ...batch, routeIntentPlans: [plan] };
}

/**
 * wait_admission intent（条件已满足但前驱仍在执行时，由 Control 的 ensureWaitAdmission 建立）。
 *
 * 它是"前驱终态受理时复查接续资格"的持久触发器：intentId 由 (waitId, satisfiedRevision)
 * 确定性派生，因此同一 (wait, satisfiedRevision) 只会有一个；Dispatch 领取它之后调用
 * admitWaitSuccessor，前驱仍未结束时得到零写入 not_ready（intent 保持 leased，不伪造终态）。
 */
export function waitAdmissionIntentFor(input: {
  projectId: string;
  workspaceId: string;
  waitRef: WaitConditionRef;
  satisfiedRevision: number;
  now: string;
}): CommunicationIntentV1 {
  return {
    schemaVersion: 1,
    intentId: waitAdmissionIntentIdFor(input.waitRef.waitId, input.satisfiedRevision),
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    domain: { kind: "wait_admission", waitRef: input.waitRef },
    status: "pending",
    leaseGeneration: 0,
    leaseOwner: null,
    leaseExpiresAt: null,
    attemptCount: 0,
    availableAt: null,
    lastFailureClass: null,
    sideEffectStarted: false,
    createdAt: input.now,
    settledAt: null,
  };
}

/** wait deadline intent（deadline 非空时建立；due time 由 availableAt 承担，重启后仍会到点）。 */
export function waitDeadlineIntentFor(command: RegisterWaitCommand, deps: CoordinationFoldDeps): CommunicationIntentV1 | null {
  if (command.payload.deadlineAt === null) return null;
  return {
    schemaVersion: 1,
    intentId: waitDeadlineIntentIdFor(command.aggregateId),
    projectId: command.identity.projectId,
    workspaceId: deps.workspaceId,
    domain: { kind: "wait_deadline", waitRef: waitConditionRefForOf(command.identity.projectId, deps.workspaceId, command.aggregateId) },
    status: "pending",
    leaseGeneration: 0,
    leaseOwner: null,
    leaseExpiresAt: null,
    attemptCount: 0,
    availableAt: command.payload.deadlineAt,
    lastFailureClass: null,
    sideEffectStarted: false,
    createdAt: deps.now(),
    settledAt: null,
  };
}

/** 订阅的 route intent：由订阅自己的 start position 驱动（有限重放也走同一条路径）。 */
export function subscriptionRouteIntentFor(command: SubscribeCommand, deps: CoordinationFoldDeps): CommunicationIntentV1 | null {
  if (command.payload.startCursor === null) return null;
  return routePageIntentFor({
    projectId: command.identity.projectId,
    workspaceId: deps.workspaceId,
    topic: command.payload.topics[0] ?? "",
    cursor: command.payload.startCursor,
    now: deps.now(),
  });
}

export function routePageIntentFor(input: {
  projectId: string;
  workspaceId: string;
  topic: string;
  cursor: CommitCursor;
  now: string;
}): CommunicationIntentV1 {
  return {
    schemaVersion: 1,
    intentId: routePageIntentIdFor(input.projectId, input.workspaceId, input.topic, input.cursor),
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    // 新建的 route intent 只钉住**源事件位置**：订阅分页位置尚未开始（null），
    // 本轮订阅范围由路由页事务在第一批处理时固定（协议约束 1.4）。
    domain: {
      kind: "route_page",
      sourceTopic: input.topic,
      sourceCursor: input.cursor,
      subscriptionPosition: null,
      subscriptionScope: [],
    },
    status: "pending",
    leaseGeneration: 0,
    leaseOwner: null,
    leaseExpiresAt: null,
    attemptCount: 0,
    availableAt: null,
    lastFailureClass: null,
    sideEffectStarted: false,
    createdAt: input.now,
    settledAt: null,
  };
}

export function buildWaitRegisterCommit(input: {
  command: RegisterWaitCommand;
  deps: CoordinationFoldDeps;
  fingerprint: WaitRegisterCommitV1["fingerprint"];
  intent: CommunicationIntentV1 | null;
}): WaitRegisterCommitV1 {
  const { command, deps } = input;
  const now = deps.now();
  const workspaceId = deps.workspaceId;
  const wait: WaitConditionV1 = {
    schemaVersion: 1,
    waitId: command.aggregateId,
    projectId: command.identity.projectId,
    workspaceId,
    ownerWorkContextRef: command.payload.ownerWorkContextRef,
    ownerParticipationRef: command.payload.ownerParticipationRef,
    predecessorRunRef: command.payload.predecessorRunRef,
    mode: "all",
    conditions: command.payload.conditions.map((c) => ({ ...c })),
    satisfiedIndexes: [],
    observations: [],
    status: "active",
    deadlineAt: command.payload.deadlineAt,
    createdAt: now,
    settledAt: null,
    satisfiedRevision: null,
  };
  const ref = waitConditionRefForOf(command.identity.projectId, workspaceId, command.aggregateId);
  const snapshot: WaitConditionSnapshot = { ref, revision: 1, schemaVersion: 1, wait, recordedAt: now };
  const snapshots: (WaitConditionSnapshot | CommunicationIntentSnapshot)[] = [snapshot];
  const expected: WaitRegisterCommitV1["expectedVersions"] = [{ ref, revision: 0 }];
  const events: WaitRegisterCommitV1["events"] = [waitConditionRegisteredEvent(ctxOf(command, now), deps.eventId(), wait)];
  if (input.intent !== null) {
    snapshots.push(intentSnapshotFor(input.intent, now));
    expected.push({ ref: communicationIntentRefForOf(input.intent.projectId, input.intent.workspaceId, input.intent.intentId), revision: 0 });
    // intent 的**存在**必须有 canonical 事件：只写快照会让"从账本读出待领取的 intent"不可能
    // （本票第 3 工作段的 Dispatch 消费者按 CommunicationIntentRecorded 扫描，重启后也必须能重建）。
    events.push(communicationIntentRecordedEvent(ctxOf(command, now), deps.eventId(), input.intent));
  }
  return {
    commitKind: "wait-register",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: input.fingerprint,
    expectedVersions: expected,
    events,
    snapshots,
    outboxIntents: [],
  };
}

export function buildWaitCancelCommit(input: {
  command: CancelCommunicationCommand;
  deps: CoordinationFoldDeps;
  fingerprint: WaitCancelCommitV1["fingerprint"];
  prior: WaitConditionSnapshot;
  intent: CommunicationIntentSnapshot | null;
}): WaitCancelCommitV1 {
  const { command, deps, prior } = input;
  const now = deps.now();
  const wait: WaitConditionV1 = { ...prior.wait, status: "cancelled", settledAt: now };
  const snapshot: WaitConditionSnapshot = { ...prior, revision: prior.revision + 1, wait, recordedAt: now };
  const snapshots: (WaitConditionSnapshot | CommunicationIntentSnapshot)[] = [snapshot];
  const expected: WaitCancelCommitV1["expectedVersions"] = [{ ref: prior.ref, revision: command.expectedRevision }];
  const events: WaitCancelCommitV1["events"] = [
    waitConditionCancelledEvent(ctxOf(command, now), deps.eventId(), wait, snapshot.revision),
  ];
  if (input.intent !== null) {
    const settled: CommunicationIntentV1 = { ...input.intent.intent, status: "cancelled", settledAt: now };
    snapshots.push({ ...input.intent, revision: input.intent.revision + 1, intent: settled, recordedAt: now });
    expected.push({ ref: input.intent.ref, revision: input.intent.revision });
    events.push(communicationIntentSettledEvent(ctxOf(command, now), deps.eventId(), settled, input.intent.revision + 1));
  }
  return {
    commitKind: "wait-cancel",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: input.fingerprint,
    expectedVersions: expected,
    events,
    snapshots,
    outboxIntents: [],
  };
}

// ------------------------------------------------------------------------ //
// 机械 intent                                                                //
// ------------------------------------------------------------------------ //

export function buildCommunicationIntentClaimCommit(input: {
  command: CommunicationClaimCommand;
  deps: CoordinationFoldDeps;
  fingerprint: CommunicationIntentClaimCommitV1["fingerprint"];
  prior: CommunicationIntentSnapshot;
  nextGeneration: number;
}): CommunicationIntentClaimCommitV1 {
  const { command, deps, prior } = input;
  const now = deps.now();
  const intent: CommunicationIntentV1 = {
    ...prior.intent,
    status: "leased",
    leaseGeneration: input.nextGeneration,
    leaseOwner: command.payload.consumerId,
    leaseExpiresAt: new Date(Date.parse(now) + command.payload.leaseDurationMs).toISOString(),
    attemptCount: prior.intent.attemptCount + 1,
  };
  const snapshot: CommunicationIntentSnapshot = { ...prior, revision: prior.revision + 1, intent, recordedAt: now };
  return {
    commitKind: "communication-intent-claim",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: input.fingerprint,
    expectedVersions: [{ ref: prior.ref, revision: command.expectedRevision }],
    events: [communicationIntentClaimedEvent(ctxOf(command, now), deps.eventId(), intent, prior.intent.leaseGeneration, snapshot.revision)],
    snapshots: [snapshot],
    outboxIntents: [],
  };
}

/**
 * 一页路由的原子提交：Deliveries + 页 checkpoint + wait transition + next intent
 * + 当前 intent settle 全部在**同一个 generation-guarded CAS** 里（PLAN §5.2 第 4 步）。
 */
export function buildRoutePageCommit(input: {
  command: CommunicationSettleCommand;
  deps: CoordinationFoldDeps;
  fingerprint: CommunicationRoutePageCommitV1["fingerprint"];
  prior: CommunicationIntentSnapshot;
  deliveries: DeliverySnapshot[];
  subscriptions: SubscriptionSnapshot[];
  waits: WaitConditionSnapshot[];
  nextIntent: CommunicationIntentV1 | null;
}): CommunicationRoutePageCommitV1 {
  const { command, deps, prior } = input;
  const now = deps.now();
  const ctx = ctxOf(command, now);
  /**
   * CM-1A-001 第 4 步：**本条 intent 的订阅范围由这一页固定/收敛后落账**。
   *
   * 为什么必须写进 settled intent 的 domain：范围是"本轮"这个事实的一部分，而 intent 的
   * 快照就是这一轮的 canonical 记录。只把它放在下一页 intent 上，会让"单页就结束"的轮次在
   * 账本里看不出范围（协议约束 1.4 的 hasMore/范围规则也就没有可依据的事实）。
   * 取值来自**命令里那一页的 page.subscriptionScope**（Control 已经逐条复核并归一化：范围内
   * 只剩下仍然活跃的订阅），因此与本页处理结果严格同源，不是第二个判定点。
   */
  const pageScope: RoutePageSubscriptionScopeEntry[] =
    command.payload.outcome === "route_page" ? command.payload.page.subscriptionScope : [];
  const domain = prior.intent.domain.kind === "route_page"
    ? { ...prior.intent.domain, subscriptionScope: pageScope.map((entry) => ({
      subscriptionRef: { ...entry.subscriptionRef },
      expectedRevision: entry.expectedRevision,
    })) }
    : prior.intent.domain;
  const intent: CommunicationIntentV1 = { ...prior.intent, domain, status: "done", settledAt: now };
  const intentSnapshot: CommunicationIntentSnapshot = { ...prior, revision: prior.revision + 1, intent, recordedAt: now };
  const events: CommunicationRoutePageCommitV1["events"] = [
    ...input.deliveries.map((snapshot) => deliveryRecordedEvent(ctx, deps.eventId(), snapshot.delivery)),
    ...input.waits.map((w) => waitConditionObservedEvent(ctx, deps.eventId(), w.wait, w.revision)),
    communicationIntentSettledEvent(ctx, deps.eventId(), intent, intentSnapshot.revision),
  ];
  const snapshots: (CommunicationIntentSnapshot | DeliverySnapshot | SubscriptionSnapshot | WaitConditionSnapshot)[] = [
    intentSnapshot,
    ...input.deliveries,
    ...input.subscriptions,
    ...input.waits,
  ];
  const expected: CommunicationRoutePageCommitV1["expectedVersions"] = [
    { ref: prior.ref, revision: command.expectedRevision },
    ...input.subscriptions.map((s) => ({ ref: s.ref, revision: s.revision - 1 })),
    ...input.waits.map((w) => ({ ref: w.ref, revision: w.revision - 1 })),
  ];
  if (input.nextIntent !== null) {
    snapshots.push(intentSnapshotFor(input.nextIntent, now));
    expected.push({ ref: communicationIntentRefForOf(input.nextIntent.projectId, input.nextIntent.workspaceId, input.nextIntent.intentId), revision: 0 });
    // 同上：下一页 intent 的存在也必须是 canonical 事件，否则"回执丢失 + 重启"之后
    // 没有任何消费者能发现它（分页会在重启处永久停住）。
    events.push(communicationIntentRecordedEvent(ctx, deps.eventId(), input.nextIntent));
  }
  return {
    commitKind: "communication-route-page",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: input.fingerprint,
    expectedVersions: expected,
    events,
    snapshots,
    outboxIntents: [],
  };
}

/**
 * **先持久化取消意图**（CM-1A-001 第 4 步 / A07：desired-state-first）。
 *
 * 纯构造：只把 intent 标记为 cancel_requested，**不改** generation、不写 settledAt、不碰任何
 * 外部能力。执行能力的调用发生在这之后，且必须读到这条已落账的意图。
 * 终态与已 quarantined 的 intent 不允许再被标记（Control 在调用前判定，这里不重复业务规则）。
 */
export function buildIntentCancelRequestCommit(input: {
  command: RequestIntentCancellationCommand;
  deps: CoordinationFoldDeps;
  fingerprint: CommunicationIntentCancelRequestCommitV1["fingerprint"];
  prior: CommunicationIntentSnapshot;
}): CommunicationIntentCancelRequestCommitV1 {
  const { command, deps, prior } = input;
  const now = deps.now();
  const intent: CommunicationIntentV1 = { ...prior.intent, status: "cancel_requested" };
  const snapshot: CommunicationIntentSnapshot = { ...prior, revision: prior.revision + 1, intent, recordedAt: now };
  return {
    commitKind: "communication-intent-cancel-request",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: input.fingerprint,
    expectedVersions: [{ ref: prior.ref, revision: command.expectedRevision }],
    events: [communicationIntentCancelRequestedEvent(ctxOf(command, now), deps.eventId(), intent, command.payload.reason, snapshot.revision)],
    snapshots: [snapshot],
    outboxIntents: [],
  };
}

/** 非页面的 settle（cancel 确认 / unknown / quarantine / deadline 到点）。 */
export function buildIntentSettleCommit(input: {
  command: CommunicationSettleCommand;
  deps: CoordinationFoldDeps;
  fingerprint: CommunicationIntentSettleCommitV1["fingerprint"];
  prior: CommunicationIntentSnapshot;
  status: CommunicationIntentV1["status"];
  waits: WaitConditionSnapshot[];
}): CommunicationIntentSettleCommitV1 {
  const { command, deps, prior } = input;
  const now = deps.now();
  const payload = command.payload;
  /**
   * CM-1A-001 第 4 步：两个**非终态**结果。
   *
   *   · no_effect_failure：已证实没有产生副作用 → retry_scheduled + availableAt = now + backoffMs。
   *     这是退避在本票里唯一合法的入口（Control 已拒绝 sideEffectStarted 的 intent 走这条路）。
   *   · side_effect_started：外部副作用**已经开始** → 保持 leased 且把 sideEffectStarted 置 true。
   *     它不是终态，也不改 generation：租约到期以后领取会被判 requires_reconcile，**不构成重跑依据**。
   */
  const nonTerminal =
    payload.outcome === "no_effect_failure" ? "retry_scheduled" as const :
    payload.outcome === "side_effect_started" ? prior.intent.status : null;
  const intent: CommunicationIntentV1 = nonTerminal !== null
    ? {
        ...prior.intent,
        status: nonTerminal,
        availableAt: payload.outcome === "no_effect_failure"
          ? new Date(Date.parse(now) + Math.max(0, payload.backoffMs)).toISOString()
          : prior.intent.availableAt,
        lastFailureClass: payload.outcome === "no_effect_failure" ? payload.reason : prior.intent.lastFailureClass,
        sideEffectStarted: payload.outcome === "side_effect_started" ? true : prior.intent.sideEffectStarted,
        settledAt: prior.intent.settledAt,
      }
    : {
        ...prior.intent,
        status: input.status,
        settledAt: now,
        lastFailureClass:
          payload.outcome === "unknown" || payload.outcome === "quarantine" ? payload.reason : prior.intent.lastFailureClass,
      };
  const snapshot: CommunicationIntentSnapshot = { ...prior, revision: prior.revision + 1, intent, recordedAt: now };
  const ctx = ctxOf(command, now);
  const events: CommunicationIntentSettleCommitV1["events"] = [
    communicationIntentSettledEvent(ctx, deps.eventId(), intent, snapshot.revision),
    ...input.waits.map((w) => waitConditionTimedOutEvent(ctx, deps.eventId(), w.wait, w.revision)),
  ];
  return {
    commitKind: "communication-intent-settle",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: input.fingerprint,
    expectedVersions: [
      { ref: prior.ref, revision: command.expectedRevision },
      ...input.waits.map((w) => ({ ref: w.ref, revision: w.revision - 1 })),
    ],
    events,
    snapshots: [snapshot, ...input.waits],
    outboxIntents: [],
  };
}

/**
 * 条件已满足但前驱仍在执行：只保存**观察**并重排 intent，**不**创建后继。
 * 这是 PLAN §5.1「事件已到但前驱尚未结束时，保留可重建的条件观察」的实现。
 */
export function buildWaitObservationCommit(input: {
  command: CommunicationSettleCommand;
  deps: CoordinationFoldDeps;
  fingerprint: CommunicationIntentSettleCommitV1["fingerprint"];
  priorIntent: CommunicationIntentSnapshot;
  priorWait: WaitConditionSnapshot;
  satisfiedIndexes: number[];
  note: string;
}): CommunicationIntentSettleCommitV1 {
  const { command, deps, priorIntent, priorWait } = input;
  const now = deps.now();
  const wait: WaitConditionV1 = {
    ...priorWait.wait,
    satisfiedIndexes: [...input.satisfiedIndexes],
    observations: [
      ...priorWait.wait.observations,
      ...input.satisfiedIndexes
        .filter((index) => !priorWait.wait.satisfiedIndexes.includes(index))
        .map((index) => ({ index, observedAt: now, note: input.note })),
    ],
  };
  const waitSnapshot: WaitConditionSnapshot = { ...priorWait, revision: priorWait.revision + 1, wait, recordedAt: now };
  const intent: CommunicationIntentV1 = { ...priorIntent.intent, status: "retry_scheduled", availableAt: now };
  const intentSnapshot: CommunicationIntentSnapshot = { ...priorIntent, revision: priorIntent.revision + 1, intent, recordedAt: now };
  const ctx = ctxOf(command, now);
  return {
    commitKind: "communication-intent-settle",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: input.fingerprint,
    expectedVersions: [
      { ref: priorIntent.ref, revision: command.expectedRevision },
      { ref: priorWait.ref, revision: priorWait.revision },
    ],
    events: [
      waitConditionObservedEvent(ctx, deps.eventId(), wait, waitSnapshot.revision),
      communicationIntentSettledEvent(ctx, deps.eventId(), intent, intentSnapshot.revision),
    ],
    snapshots: [waitSnapshot, intentSnapshot],
    outboxIntents: [],
  };
}

// ------------------------------------------------------------------------ //
// 后继受理（A05：唯一调度记录）                                                //
// ------------------------------------------------------------------------ //

export function successorIdsFor(workId: string, waitId: string, satisfiedRevision: number): { attemptId: string; runId: string } {
  const attemptId = successorAttemptIdFor(workId, waitId, satisfiedRevision);
  return { attemptId, runId: successorRunIdFor(attemptId) };
}

export function buildSuccessorCommit(input: {
  command: AdmitWaitSuccessorCommand;
  deps: CoordinationFoldDeps;
  fingerprint: CommunicationSuccessorClaimCommitV1["fingerprint"];
  priorWait: WaitConditionSnapshot;
  priorLease: TaskLeaseSnapshot | null;
  /**
   * Work 权威状态（当前参与关系指针所在）与本次采用的参与关系。协议约束 2.1：换手涉及的
   * 「当前参与关系版本」必须进入**同一事务的版本检查**，因此两者的 revision 都进 expectedVersions
   * （本提交不写这两个快照，它们只作 CAS 守卫）。
   */
  priorBinding: WorkContextBindingSnapshot;
  priorParticipation: WorkParticipationSnapshot;
  /**
   * 本次**实际采用**的权限集（协议约束 2.2）：Control 已按「前驱信封 ∩ 当前 RoleBinding 规格上界」
   * 收窄算好并核验过。它同时进 admission、唯一 outbox 的 intent 与 TaskClaimed 事件（账本校验要求
   * outbox.intent 与 outbox 快照逐字节相同；派发面再把它带进 Context 请求）。
   */
  declaredPermissions: { tools: string[]; writeScope: string[] };
  /** 这份权限集的来源（narrowed / within_spec / no_matrix）：与权限集同事务落账，供审计复核。 */
  permissionBasis: "narrowed" | "within_spec" | "no_matrix";
  intent: CommunicationIntentSnapshot | null;
  manifest: ContextManifestV1;
}): CommunicationSuccessorClaimCommitV1 {
  const { command, deps } = input;
  const payload = command.payload;
  const workspaceId = deps.workspaceId;
  const now = deps.now();
  const projectId = command.identity.projectId;
  const leaseRef = taskLeaseRefFor(projectId, payload.goalId, payload.taskId);
  const attemptRef = taskAttemptRefFor(projectId, payload.goalId, payload.taskId, payload.attemptId);
  const runRef = runRefFor(projectId, payload.goalId, payload.runId);
  const outboxRef = dispatchOutboxRefFor(projectId, payload.goalId, payload.taskId, payload.attemptId);
  const planRef: PlanRevisionRef = { ...payload.planRef };
  const priorLeaseRevision = input.priorLease?.revision ?? 0;

  const lease: TaskLeaseSnapshot = {
    ref: leaseRef,
    revision: priorLeaseRevision + 1,
    schemaVersion: 1,
    holderRunId: payload.runId,
    attemptId: payload.attemptId,
    grantedAt: now,
    expiresAt: null,
  };
  const attempt: TaskAttemptSnapshot = {
    ref: attemptRef,
    revision: 1,
    schemaVersion: 1,
    runId: payload.runId,
    planRef,
    status: "claimed",
    startedAt: null,
    endedAt: null,
    endOutcome: null,
  };
  const run: RunSnapshot = {
    ref: runRef,
    revision: 1,
    schemaVersion: 1,
    task: { projectId, goalId: payload.goalId, taskId: payload.taskId },
    attemptId: payload.attemptId,
    planRef,
    roleBinding: { ...payload.roleBinding },
    budget: { ...payload.budget },
    workspaceSnapshot: { workspaceId, revision: payload.workspaceRevision },
    status: "starting",
    outcome: null,
    exitCode: null,
    lastEventSeq: 0,
    lastRuntimeEventId: "",
    lastFactEventId: "",
    envelope: null,
    startedAt: null,
    endedAt: null,
  };
  const intent: DispatchIntentV1 = {
    // R7（第 2 步裁决）：已经受理的协作后继把 admission 固定下来的 Work 带进唯一调度记录。
    // 派发收口据此直接使用该 Work，**不得**再按 (goal, task) 解析成另一个 Work。
    admittedWorkRef: { ...payload.workContextRef },
    schemaVersion: 1,
    intentId: payload.attemptId,
    projectId,
    workspaceId,
    goalId: payload.goalId,
    taskId: payload.taskId,
    planRef,
    attemptRef,
    runRef,
    roleBinding: { ...payload.roleBinding },
    workspaceSnapshot: { workspaceId, revision: payload.workspaceRevision },
    // 协议约束 2.2：写进唯一调度记录的是**收窄后**的权限集（不是 payload 的原样提议）。
    declaredPermissions: {
      tools: [...input.declaredPermissions.tools],
      writeScope: [...input.declaredPermissions.writeScope],
    },
    budget: { ...payload.budget },
    requestedAt: now,
    correlationId: command.correlationId,
  };
  const outbox: DispatchOutboxEntrySnapshot = {
    ref: outboxRef,
    revision: 1,
    schemaVersion: 1,
    status: "pending",
    intent,
    pendingAt: now,
    startedAt: null,
    doneAt: null,
  };
  const satisfiedRevision = input.priorWait.revision + 1;
  const wait: WaitConditionV1 = {
    ...input.priorWait.wait,
    status: "satisfied",
    satisfiedIndexes: input.priorWait.wait.conditions.map((_, index) => index),
    satisfiedRevision,
    settledAt: now,
  };
  const waitSnapshot: WaitConditionSnapshot = { ...input.priorWait, revision: satisfiedRevision, wait, recordedAt: now };
  const admission: CommunicationAdmissionV1 = {
    schemaVersion: 1,
    waitRef: input.priorWait.ref,
    workContextRef: payload.workContextRef,
    satisfiedRevision,
    participationRef: { ...payload.participationRef },
    agentInstanceId: payload.agentInstanceId,
    // 本次固定的授权版本、权限集与目标 Delivery 集合：后继 Run 与 Context 都消费这份结果
    // （Control 在受理时已把它们与**当前**参与关系逐字段核对过）。
    roleBinding: { ...payload.roleBinding },
    declaredPermissions: {
      tools: [...input.declaredPermissions.tools],
      writeScope: [...input.declaredPermissions.writeScope],
    },
    permissionBasis: input.permissionBasis,
    // 协议约束 1.2/2.1：受理那一刻读到的两个 revision 原样留痕（它们同时也是 CAS 期望值）。
    bindingRevision: input.priorBinding.revision,
    participationRevision: input.priorParticipation.revision,
    deliveryRefs: payload.deliveryRefs.map((ref) => ({ ...ref })),
    predecessorRunRef: payload.predecessorRunRef,
    runRef,
    attemptRef,
    admissionCommandId: command.commandId,
    admittedAt: now,
  };
  const admissionSnapshot: CommunicationAdmissionSnapshot = {
    ref: { aggregateType: "CommunicationAdmission", projectId, workspaceId, waitId: input.priorWait.ref.waitId },
    revision: 1,
    schemaVersion: 1,
    admission,
    recordedAt: now,
  };
  const taskClaimed: TaskClaimedEvent = {
    eventId: deps.eventId(),
    eventType: "TaskClaimed",
    schemaVersion: 1,
    projectId,
    workspaceId,
    aggregateType: "TaskLease",
    aggregateId: payload.taskId,
    aggregateRevision: 1,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: command.identity.actor,
    occurredAt: now,
    payload: {
      goalId: payload.goalId,
      taskId: payload.taskId,
      attemptRef,
      runRef,
      planRef,
      roleBinding: { ...payload.roleBinding },
      // 与 intent/admission 同一份**收窄后**的权限集（协议约束 2.2 的单一真值）。
      declaredPermissions: {
        tools: [...input.declaredPermissions.tools],
        writeScope: [...input.declaredPermissions.writeScope],
      },
      budget: { ...payload.budget },
      intentId: payload.attemptId,
      claimedAt: now,
    },
  };
  const ctx = ctxOf(command, now);
  const events: CommunicationSuccessorClaimCommitV1["events"] = [
    taskClaimed,
    waitConditionSatisfiedEvent(ctx, deps.eventId(), wait, admission),
    communicationAdmissionRecordedEvent(ctx, deps.eventId(), admission, input.manifest),
  ];
  const snapshots: CommunicationSuccessorClaimCommitV1["snapshots"] = [
    lease,
    attempt,
    run,
    outbox,
    waitSnapshot,
    admissionSnapshot,
  ];
  const expected: CommunicationSuccessorClaimCommitV1["expectedVersions"] = [
    { ref: leaseRef, revision: priorLeaseRevision },
    { ref: attemptRef, revision: 0 },
    { ref: runRef, revision: 0 },
    { ref: outboxRef, revision: 0 },
    { ref: input.priorWait.ref, revision: input.priorWait.revision },
    // 协议约束 2.1：换手涉及的当前参与关系版本进入同一事务的版本检查。
    //   · WorkContextBinding@N：participation-start 每建立一段参与都推进该绑定（link + 指针），
    //     因此「有人在本次读与写之间换了手」会在这里被 CAS 拒掉；
    //   · WorkParticipation@M：这一段参与在本次读与写之间被 end 掉也会被拒。
    // 二者都是**纯 CAS 守卫**（本提交不写这两个快照）：Control 的先查后写因此不构成保证。
    { ref: input.priorBinding.ref, revision: input.priorBinding.revision },
    { ref: input.priorParticipation.ref, revision: input.priorParticipation.revision },
  ];
  if (input.intent === null) expected.push({ ref: communicationIntentRefForOf(projectId, workspaceId,
    waitAdmissionIntentIdFor(input.priorWait.ref.waitId, satisfiedRevision)), revision: 0 });
  if (input.intent !== null) {
    const settled: CommunicationIntentV1 = { ...input.intent.intent, status: "done", settledAt: now };
    snapshots.push({ ...input.intent, revision: input.intent.revision + 1, intent: settled, recordedAt: now });
    expected.push({ ref: input.intent.ref, revision: input.intent.revision });
    events.push(communicationIntentSettledEvent(ctx, deps.eventId(), settled, input.intent.revision + 1));
  }
  return {
    commitKind: "communication-successor-claim",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: input.fingerprint,
    expectedVersions: expected,
    events,
    snapshots,
    outboxIntents: [intent],
  };
}

export type { CommunicationClaimReceipt };
