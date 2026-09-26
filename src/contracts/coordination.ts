// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
import type { RoleBindingRefV1, RunRef } from "./dispatch.js";
import type { WorkContextRef } from "./context-continuity.js";
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
