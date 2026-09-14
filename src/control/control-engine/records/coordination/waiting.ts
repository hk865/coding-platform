/** Internal waiting commit construction. Control admission remains in the command handler. */
/**
 * Control 持有的协作通信 canonical 记录构造（确定性 fold）。
 * 这里只做纯构造：业务准入守卫在 handlers 里，事务权威在 StateLedger。
 */
import type { CommitCursor } from "../../../../contracts/command-event.js";
import type { CancelCommunicationCommand, CommunicationIntentRef, CommunicationIntentSnapshot, CommunicationIntentV1, RegisterWaitCommand, RouteIntentPlanV1, SubscribeCommand, WaitCancelCommitV1, WaitConditionRef, WaitConditionSnapshot, WaitConditionV1, WaitRegisterCommitV1 } from "../../../../contracts/coordination.js";
import { communicationIntentRecordedEvent, communicationIntentSettledEvent } from "../../../../contracts/coordination-events.js";
import { waitConditionCancelledEvent, waitConditionRegisteredEvent } from "../../../../contracts/coordination-events.js";
import { waitAdmissionIntentIdFor, waitDeadlineIntentIdFor, routePageIntentIdFor } from "../../../../contracts/coordination.js";
import type { CoordinationFoldDeps } from './shared.js';
import { ctxOf } from './shared.js';


// ------------------------------------------------------------------------ //
// WaitCondition（等待后继）                                                       //
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
  command: { commandId: string; correlationId: string; identity: import("../../../../contracts/command-event.js").CommandIdentity };
  deps: CoordinationFoldDeps;
  fingerprint: import("../../../../contracts/coordination.js").CommunicationIntentRecordCommitV1["fingerprint"];
  intent: CommunicationIntentV1;
}): import("../../../../contracts/coordination.js").CommunicationIntentRecordCommitV1 {
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
 * 把**源事件触发的待路由 intent 计划**挂到这次提交上（协作通信可靠投递规则，协议约束 1.4）。
 *
 * 纯构造：位置（sourceCursor）与 intentId 由账本在同一个事务里按 anchor 事件的落点算出，
 * 因此这里只声明"这次提交里哪一个事件是源事件"与整轮订阅范围。`null` = 没有候选订阅，
 * 不登记任何计划（提交形状与语义与固定材料集合规则逐字节相同）。
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
    mode: command.payload.mode ?? "all",
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
    // （当前实现固定材料集合规则的 Dispatch 消费者按 CommunicationIntentRecorded 扫描，重启后也必须能重建）。
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
