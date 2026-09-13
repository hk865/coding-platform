/**
 * 协作通信事件构造（纯函数；只接收已由 Control 决定的值）。
 *
 * 每个构造函数都要求调用方显式给出命令身份、事件 id 与发生时间——事件里**不**
 * 携带任何时钟或随机源，因此同一命令与同一 id 重放得到逐字节相同的 fold。
 */
import type { ActorRef, CommandIdentity } from "./command-event.js";
import { sha256Hex, canonicalJson } from "./fingerprint.js";
import type {
  AgentInstanceV1,
  CommunicationAdmissionV1,
  CommunicationIntentV1,
  DeliveryV1,
  DirectedRequestV1,
  SubscriptionV1,
  WaitConditionV1,
  WorkParticipationV1,
} from "./coordination.js";
import type { ContextManifestV1 } from "./task-envelope.js";

export type EventContext = {
  commandId: string;
  correlationId: string;
  occurredAt: string;
  identity: CommandIdentity;
};

function base(
  ctx: EventContext,
  eventId: string,
  projectId: string,
  workspaceId: string,
): {
  eventId: string;
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
} {
  return {
    eventId,
    schemaVersion: 1,
    projectId,
    workspaceId,
    causationId: ctx.commandId,
    correlationId: ctx.correlationId,
    idempotencyKey: ctx.identity.idempotencyKey,
    actor: ctx.identity.actor,
    occurredAt: ctx.occurredAt,
  };
}

export function agentInstanceRegisteredEvent(
  ctx: EventContext,
  eventId: string,
  agent: AgentInstanceV1,
): import("./coordination.js").AgentInstanceRegisteredEvent {
  return {
    ...base(ctx, eventId, agent.projectId, agent.workspaceId),
    eventType: "AgentInstanceRegistered",
    aggregateType: "AgentInstance",
    aggregateId: agent.agentInstanceId,
    aggregateRevision: 1,
    payload: { agent },
  };
}

export function participationStartEvent(
  ctx: EventContext,
  eventId: string,
  participation: WorkParticipationV1,
): import("./coordination.js").WorkParticipationStartedEvent {
  return {
    ...base(ctx, eventId, participation.workContextRef.projectId, participation.workContextRef.workspaceId),
    eventType: "WorkParticipationStarted",
    aggregateType: "WorkParticipation",
    aggregateId: participation.participationId,
    aggregateRevision: 1,
    payload: { participation },
  };
}

export function participationEndEvent(
  ctx: EventContext,
  eventId: string,
  participation: WorkParticipationV1,
  revision: number,
): import("./coordination.js").WorkParticipationEndedEvent {
  return {
    ...base(ctx, eventId, participation.workContextRef.projectId, participation.workContextRef.workspaceId),
    eventType: "WorkParticipationEnded",
    aggregateType: "WorkParticipation",
    aggregateId: participation.participationId,
    aggregateRevision: revision,
    payload: { participation },
  };
}

export function directedRequestSentEvent(
  ctx: EventContext,
  eventId: string,
  request: DirectedRequestV1,
): import("./coordination.js").DirectedRequestSentEvent {
  return {
    ...base(ctx, eventId, request.projectId, request.workspaceId),
    eventType: "DirectedRequestSent",
    aggregateType: "DirectedRequest",
    aggregateId: request.requestId,
    aggregateRevision: 1,
    payload: { request },
  };
}

export function directedRequestRespondedEvent(
  ctx: EventContext,
  eventId: string,
  request: DirectedRequestV1,
  revision: number,
): import("./coordination.js").DirectedRequestRespondedEvent {
  return {
    ...base(ctx, eventId, request.projectId, request.workspaceId),
    eventType: "DirectedRequestResponded",
    aggregateType: "DirectedRequest",
    aggregateId: request.requestId,
    aggregateRevision: revision,
    payload: { request },
  };
}

export function directedRequestCancelledEvent(
  ctx: EventContext,
  eventId: string,
  request: DirectedRequestV1,
  revision: number,
): import("./coordination.js").DirectedRequestCancelledEvent {
  return {
    ...base(ctx, eventId, request.projectId, request.workspaceId),
    eventType: "DirectedRequestCancelled",
    aggregateType: "DirectedRequest",
    aggregateId: request.requestId,
    aggregateRevision: revision,
    payload: { request },
  };
}

export function subscriptionCreatedEvent(
  ctx: EventContext,
  eventId: string,
  subscription: SubscriptionV1,
): import("./coordination.js").SubscriptionCreatedEvent {
  return {
    ...base(ctx, eventId, subscription.projectId, subscription.workspaceId),
    eventType: "SubscriptionCreated",
    aggregateType: "Subscription",
    aggregateId: subscription.subscriptionId,
    aggregateRevision: 1,
    payload: { subscription },
  };
}

export function subscriptionCancelledEvent(
  ctx: EventContext,
  eventId: string,
  subscription: SubscriptionV1,
  revision: number,
): import("./coordination.js").SubscriptionCancelledEvent {
  return {
    ...base(ctx, eventId, subscription.projectId, subscription.workspaceId),
    eventType: "SubscriptionCancelled",
    aggregateType: "Subscription",
    aggregateId: subscription.subscriptionId,
    aggregateRevision: revision,
    payload: { subscription },
  };
}

/** 订阅的 frontier 补齐（见 contracts/coordination.ts 的 SubscriptionCatchupPlannedEvent）。 */
export function subscriptionCatchupPlannedEvent(
  ctx: EventContext,
  eventId: string,
  subscription: SubscriptionV1,
  revision: number,
  frontierCursor: import("./command-event.js").CommitCursor | null,
  intents: CommunicationIntentV1[],
): import("./coordination.js").SubscriptionCatchupPlannedEvent {
  return {
    ...base(ctx, eventId, subscription.projectId, subscription.workspaceId),
    eventType: "SubscriptionCatchupPlanned",
    aggregateType: "Subscription",
    aggregateId: subscription.subscriptionId,
    aggregateRevision: revision,
    payload: { subscription, frontierCursor, intents: intents.map((intent) => structuredClone(intent)) },
  };
}

export function deliveryRecordedEvent(
  ctx: EventContext,
  eventId: string,
  delivery: DeliveryV1,
): import("./coordination.js").DeliveryRecordedEvent {
  return {
    ...base(ctx, eventId, delivery.projectId, delivery.workspaceId),
    eventType: "DeliveryRecorded",
    aggregateType: "Delivery",
    aggregateId: delivery.deliveryId,
    aggregateRevision: 1,
    payload: { delivery },
  };
}

export function waitConditionRegisteredEvent(
  ctx: EventContext,
  eventId: string,
  wait: WaitConditionV1,
): import("./coordination.js").WaitConditionRegisteredEvent {
  return {
    ...base(ctx, eventId, wait.projectId, wait.workspaceId),
    eventType: "WaitConditionRegistered",
    aggregateType: "WaitCondition",
    aggregateId: wait.waitId,
    aggregateRevision: 1,
    payload: { wait },
  };
}

export function waitConditionObservedEvent(
  ctx: EventContext,
  eventId: string,
  wait: WaitConditionV1,
  revision: number,
): import("./coordination.js").WaitConditionObservedEvent {
  return {
    ...base(ctx, eventId, wait.projectId, wait.workspaceId),
    eventType: "WaitConditionObserved",
    aggregateType: "WaitCondition",
    aggregateId: wait.waitId,
    aggregateRevision: revision,
    payload: { wait },
  };
}

export function waitConditionSatisfiedEvent(
  ctx: EventContext,
  eventId: string,
  wait: WaitConditionV1,
  admission: CommunicationAdmissionV1,
): import("./coordination.js").WaitConditionSatisfiedEvent {
  return {
    ...base(ctx, eventId, wait.projectId, wait.workspaceId),
    eventType: "WaitConditionSatisfied",
    aggregateType: "WaitCondition",
    aggregateId: wait.waitId,
    aggregateRevision: wait.satisfiedRevision ?? 0,
    payload: { wait, admission },
  };
}

export function waitConditionTimedOutEvent(
  ctx: EventContext,
  eventId: string,
  wait: WaitConditionV1,
  revision: number,
): import("./coordination.js").WaitConditionTimedOutEvent {
  return {
    ...base(ctx, eventId, wait.projectId, wait.workspaceId),
    eventType: "WaitConditionTimedOut",
    aggregateType: "WaitCondition",
    aggregateId: wait.waitId,
    aggregateRevision: revision,
    payload: { wait },
  };
}

export function waitConditionCancelledEvent(
  ctx: EventContext,
  eventId: string,
  wait: WaitConditionV1,
  revision: number,
): import("./coordination.js").WaitConditionCancelledEvent {
  return {
    ...base(ctx, eventId, wait.projectId, wait.workspaceId),
    eventType: "WaitConditionCancelled",
    aggregateType: "WaitCondition",
    aggregateId: wait.waitId,
    aggregateRevision: revision,
    payload: { wait },
  };
}

export function communicationIntentRecordedEvent(
  ctx: EventContext,
  eventId: string,
  intent: CommunicationIntentV1,
): import("./coordination.js").CommunicationIntentRecordedEvent {
  return {
    ...base(ctx, eventId, intent.projectId, intent.workspaceId),
    eventType: "CommunicationIntentRecorded",
    aggregateType: "CommunicationIntent",
    aggregateId: intent.intentId,
    aggregateRevision: 1,
    payload: { intent },
  };
}

export function communicationIntentClaimedEvent(
  ctx: EventContext,
  eventId: string,
  intent: CommunicationIntentV1,
  priorGeneration: number,
  revision: number,
): import("./coordination.js").CommunicationIntentClaimedEvent {
  return {
    ...base(ctx, eventId, intent.projectId, intent.workspaceId),
    eventType: "CommunicationIntentClaimed",
    aggregateType: "CommunicationIntent",
    aggregateId: intent.intentId,
    aggregateRevision: revision,
    payload: { intent, priorGeneration },
  };
}

export function communicationIntentSettledEvent(
  ctx: EventContext,
  eventId: string,
  intent: CommunicationIntentV1,
  revision: number,
): import("./coordination.js").CommunicationIntentSettledEvent {
  return {
    ...base(ctx, eventId, intent.projectId, intent.workspaceId),
    eventType: "CommunicationIntentSettled",
    aggregateType: "CommunicationIntent",
    aggregateId: intent.intentId,
    aggregateRevision: revision,
    payload: { intent },
  };
}

/** 先持久化取消意图（非终态，见 contracts/coordination.ts 的说明）。 */
export function communicationIntentCancelRequestedEvent(
  ctx: EventContext,
  eventId: string,
  intent: CommunicationIntentV1,
  reason: string,
  revision: number,
): import("./coordination.js").CommunicationIntentCancelRequestedEvent {
  return {
    ...base(ctx, eventId, intent.projectId, intent.workspaceId),
    eventType: "CommunicationIntentCancelRequested",
    aggregateType: "CommunicationIntent",
    aggregateId: intent.intentId,
    aggregateRevision: revision,
    payload: { intent, reason },
  };
}

export function communicationAdmissionRecordedEvent(
  ctx: EventContext,
  eventId: string,
  admission: CommunicationAdmissionV1,
  manifest: ContextManifestV1,
): import("./coordination.js").CommunicationAdmissionRecordedEvent {
  return {
    ...base(ctx, eventId, admission.workContextRef.projectId, admission.workContextRef.workspaceId),
    eventType: "CommunicationAdmissionRecorded",
    aggregateType: "CommunicationAdmission",
    aggregateId: admission.waitRef.waitId,
    aggregateRevision: 1,
    payload: { admission, manifest },
  };
}

export function workParticipationRefFor(
  projectId: string,
  workspaceId: string,
  workId: string,
  participationId: string,
): import("./coordination.js").WorkParticipationRef {
  return { aggregateType: "WorkParticipation", projectId, workspaceId, workId, participationId };
}

/**
 * 定向请求首个 Delivery 的确定性 id：同一 (请求, 目标 Work) 永远同一 id，
 * 因此重复提交同一命令只会命中账本幂等（replay），不会产生第二条有效投递。
 */
export function directDeliveryIdFor(requestId: string, targetWorkId: string): string {
  return "deliv-" + sha256Hex(canonicalJson(["direct-delivery-v1", requestId, targetWorkId])).slice(0, 24);
}
