/** Internal successor commit construction. Control admission remains in the command handler. */
import type { DispatchIntentV1, DispatchOutboxEntrySnapshot, RunSnapshot, TaskAttemptSnapshot, TaskLeaseSnapshot } from "../../../../contracts/dispatch.js";
import { dispatchOutboxRefFor, runRefFor, taskAttemptRefFor, taskLeaseRefFor } from "../../../../contracts/dispatch.js";
import type { PlanRevisionRef } from "../../../../contracts/plan.js";
import type { ContextManifestV1 } from "../../../../contracts/task-envelope.js";
import type { AdmitWaitSuccessorCommand, CommunicationAdmissionSnapshot, CommunicationAdmissionV1, CommunicationClaimReceipt, CommunicationIntentSnapshot, CommunicationIntentV1, CommunicationSuccessorClaimCommitV1, WaitConditionSnapshot, WaitConditionV1, WorkParticipationSnapshot } from "../../../../contracts/coordination.js";
import type { WorkContextBindingSnapshot } from "../../../../contracts/context-continuity.js";
import { communicationIntentSettledEvent } from "../../../../contracts/coordination-events.js";
import { waitConditionSatisfiedEvent, communicationAdmissionRecordedEvent } from "../../../../contracts/coordination-events.js";
import { successorAttemptIdFor, successorRunIdFor, waitAdmissionIntentIdFor } from "../../../../contracts/coordination.js";
import type { TaskClaimedEvent } from "../../../../contracts/dispatch.js";
import type { CoordinationFoldDeps } from './shared.js';
import { ctxOf } from './shared.js';
import { communicationIntentRefForOf } from './waiting.js';


// ------------------------------------------------------------------------ //
// 后继受理（等待后继：唯一调度记录）                                                //
// ------------------------------------------------------------------------ //

export function successorIdsFor(workId: string, waitId: string, satisfiedRevision: number): { attemptId: string; runId: string } {
  const attemptId = successorAttemptIdFor(workId, waitId, satisfiedRevision);
  return { attemptId, runId: successorRunIdFor(attemptId) };
}


export function buildSuccessorCommit(input: {
  command: AdmitWaitSuccessorCommand;
  selectedReport?: import('../../../../contracts/alternative-report.js').AlternativeReportSelection;
  reportQualification?: import('../../../../contracts/alternative-report.js').AlternativeReportQualification;
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
    // 工作身份规则（参与身份规则）：已经受理的协作后继把 admission 固定下来的 Work 带进唯一调度记录。
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
    satisfiedIndexes: input.selectedReport ? [input.selectedReport.conditionIndex] : input.priorWait.wait.conditions.map((_, index) => index),
    ...(input.selectedReport ? { selectedReport: input.selectedReport } : {}),
    satisfiedRevision,
    settledAt: now,
  };
  const waitSnapshot: WaitConditionSnapshot = { ...input.priorWait, revision: satisfiedRevision, wait, recordedAt: now };
  const admission: CommunicationAdmissionV1 = {
    ...(input.reportQualification ? { reportQualification: input.reportQualification } : {}),
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
    deliveryRefs: (input.selectedReport ? [input.selectedReport.deliveryRef] : payload.deliveryRefs).map((ref) => ({ ...ref })),
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
