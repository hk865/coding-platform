/** Control-owned canonical record construction. */
import type { PlanProposalV1, PlanProposalSnapshot, UserDecisionV1, UserDecisionSnapshot, GoalRevisionV1, GoalRevisionSnapshot, RecordPlanChangeProposalCommand, RecordUserDecisionCommand, ApplyPlanChangeCommand } from "../../../contracts/goal-change.js";
import { recordPlanChangeProposalFingerprint, recordUserDecisionFingerprint, applyPlanChangeFingerprint } from "../../../contracts/goal-change.js";
import { revisionAssignments } from "../../../contracts/plan.js";
import type { PlanRevisionSnapshot, PlanRevisionRef } from "../../../contracts/plan.js";
import type { GoalRef, GoalSnapshot, PlanChangeProposalRecordLedgerCommitV1, UserDecisionRecordLedgerCommitV1, GoalChangeApplyLedgerCommitV1 } from "../../../contracts/ledger.js";
import type { ArchitectureBaselinePin, CompletionPolicyPin } from "../../../contracts/governance.js";


export function planProposalSnapshotFor(proposal: PlanProposalV1, recordedAt: string): PlanProposalSnapshot {
  return { ref: { aggregateType: "PlanProposal", projectId: proposal.projectId, workspaceId: proposal.workspaceId, proposalId: proposal.proposalId }, revision: 1, schemaVersion: 1, proposal, recordedAt };
}


export function userDecisionSnapshotFor(decision: UserDecisionV1, recordedAt: string): UserDecisionSnapshot {
  return { ref: { aggregateType: "UserDecision", projectId: decision.projectId, workspaceId: decision.workspaceId, decisionId: decision.decisionId }, revision: 1, schemaVersion: 1, decision, recordedAt };
}


export function buildGoalRevisionV1(opts: { goalRef: GoalRef; revision: number; activePlanRef: PlanRevisionRef; supersededPlanRefs: PlanRevisionRef[]; changedAt: string; reason: string }): GoalRevisionV1 {
  return {
    schemaVersion: 1,
    goalRef: opts.goalRef,
    revision: opts.revision,
    activePlanRef: opts.activePlanRef,
    supersededPlanRefs: opts.supersededPlanRefs,
    changedAt: opts.changedAt,
    reason: opts.reason,
  };
}


export function goalRevisionSnapshotFor(change: GoalRevisionV1, recordedAt: string, workspaceId: string): GoalRevisionSnapshot {
  return { ref: { aggregateType: "GoalRevision", projectId: change.goalRef.projectId, workspaceId, goalId: change.goalRef.goalId, revision: change.revision }, revision: 1, schemaVersion: 1, change, recordedAt };
}


/**
 * Deterministic new-revision snapshot (fold-equality target for Control).
 *
 * ADR 0003 D1: 新 revision 的任务集来自草稿自身（= 源 revision + 被接受的任务集增量，
 * 已由 applyPlanChange 的守卫 f 逐项证明）。`sourcePlan` 仅为兼容旧调用方保留：
 * 草稿未携带任务集时（例如只读投影测试直接折叠记录）沿用源任务集，与旧行为一致。
 *
 * RW-07：指派与任务同属一个 revision，因此用同一条规则处理——草稿带了 assignments 就逐条
 * 复制，没带就沿用源 revision 的指派（revisionAssignments，含 RW-07 之前只写在 origin 里的
 * 初始指派）。快照因此始终能被 revisionAssignments 读出该 revision 的完整指派集合。
 */
export function buildP111PlanRevisionSnapshot(
  draft: NonNullable<ApplyPlanChangeCommand["payload"]["newPlanDraft"]>,
  pins: { completionPolicy: CompletionPolicyPin; architectureBaseline: ArchitectureBaselinePin },
  acceptedAt: string,
  goalRef: GoalRef,
  newPlanRef: PlanRevisionRef,
  sourcePlan: PlanRevisionSnapshot,
): PlanRevisionSnapshot {
  const taskSet = Array.isArray(draft.tasks) ? (draft.tasks as PlanRevisionSnapshot["tasks"]) : sourcePlan.tasks;
  const assignmentSet = Array.isArray(draft.assignments)
    ? draft.assignments.map((entry) => ({ taskId: entry.taskId, role: entry.role, instruction: entry.instruction }))
    : revisionAssignments(sourcePlan);
  return {
    ref: newPlanRef,
    revision: 1,
    schemaVersion: 1,
    goalRef,
    planId: draft.planId,
    planRevision: draft.planRevision,
    acceptedAt,
    effectiveCompletionPolicy: pins.completionPolicy,
    effectiveArchitectureBaseline: pins.architectureBaseline,
    stages: draft.stages === null ? [] : draft.stages.map((s) => ({ ...s })),
    tasks: taskSet.map((t) => ({ ...t, scope: { ...t.scope } })),
    assignments: assignmentSet,
    obligations: draft.obligations.map((o) => ({
      ...o,
      taskIds: [...o.taskIds],
      verificationRequirements: o.verificationRequirements.map((v) => ({ ...v })),
    })),
    taskHierarchy: draft.taskHierarchy === null ? { parentOf: [] } : { parentOf: draft.taskHierarchy.parentOf.map((e) => ({ ...e })) },
    executionDag: draft.executionDag === null ? { dependsOn: [] } : { dependsOn: draft.executionDag.dependsOn.map((e) => ({ ...e, requires: { ...e.requires } })) },
  };
}


// ------------------------------------------------------------------------ //
// Ledger fold builders (fold-equality targets; shared by BOTH adapters)     //
// ------------------------------------------------------------------------ //

export function buildPlanChangeProposalRecordCommit(command: RecordPlanChangeProposalCommand, deps: { eventId: string; occurredAt: string; recordedAt?: string }): PlanChangeProposalRecordLedgerCommitV1 {
  const proposal = command.payload.proposal;
  const snap = planProposalSnapshotFor(proposal, deps.recordedAt ?? deps.occurredAt);
  return {
    commitKind: "plan-change-proposal-record",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: recordPlanChangeProposalFingerprint(command),
    expectedVersions: [{ ref: snap.ref, revision: 0 }],
    events: [{
      eventId: deps.eventId,
      eventType: "PlanProposalRecorded",
      schemaVersion: 1,
      projectId: proposal.projectId,
      workspaceId: proposal.workspaceId,
      aggregateType: "PlanProposal",
      aggregateId: proposal.proposalId,
      aggregateRevision: 1,
      causationId: command.commandId,
      correlationId: command.correlationId,
      idempotencyKey: command.identity.idempotencyKey,
      actor: { ...command.identity.actor },
      occurredAt: deps.occurredAt,
      payload: { proposal, recordedAt: deps.recordedAt ?? deps.occurredAt },
    }],
    snapshots: [snap],
    outboxIntents: [],
  };
}


export function buildUserDecisionRecordCommit(command: RecordUserDecisionCommand, deps: { eventId: string; occurredAt: string; recordedAt?: string }): UserDecisionRecordLedgerCommitV1 {
  const decision = command.payload.decision;
  const snap = userDecisionSnapshotFor(decision, deps.recordedAt ?? deps.occurredAt);
  return {
    commitKind: "user-decision-record",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: recordUserDecisionFingerprint(command),
    expectedVersions: [{ ref: snap.ref, revision: 0 }],
    events: [{
      eventId: deps.eventId,
      eventType: "UserDecisionRecorded",
      schemaVersion: 1,
      projectId: decision.projectId,
      workspaceId: decision.workspaceId,
      aggregateType: "UserDecision",
      aggregateId: decision.decisionId,
      aggregateRevision: 1,
      causationId: command.commandId,
      correlationId: command.correlationId,
      idempotencyKey: command.identity.idempotencyKey,
      actor: { ...command.identity.actor },
      occurredAt: deps.occurredAt,
      payload: { decision, recordedAt: deps.recordedAt ?? deps.occurredAt },
    }],
    snapshots: [snap],
    outboxIntents: [],
  };
}


export function buildGoalChangeApplyCommit(
  command: ApplyPlanChangeCommand,
  deps: {
    eventId: string;
    occurredAt: string;
    changedAt: string;
    pins: { completionPolicy: CompletionPolicyPin; architectureBaseline: ArchitectureBaselinePin };
    sourcePlan: PlanRevisionSnapshot;
    newPlanDraft: NonNullable<ApplyPlanChangeCommand["payload"]["newPlanDraft"]>;
    baseGoal: GoalSnapshot;
  },
): GoalChangeApplyLedgerCommitV1 {
  const proposalRef = command.payload.proposalRef;
  const decisionRef = command.payload.decisionRef;
  const newPlan = buildP111PlanRevisionSnapshot(
    deps.newPlanDraft,
    deps.pins,
    deps.changedAt,
    deps.baseGoal.ref,
    { aggregateType: "PlanRevision", projectId: proposalRef.projectId, planId: deps.newPlanDraft.planId },
    deps.sourcePlan,
  );
  const goalSnapshot: GoalSnapshot = {
    ...deps.baseGoal,
    activePlanRevision: newPlan.ref,
    revision: deps.baseGoal.revision + 1,
  };
  const revChange = buildGoalRevisionV1({
    goalRef: deps.baseGoal.ref,
    revision: goalSnapshot.revision,
    activePlanRef: newPlan.ref,
    supersededPlanRefs: [deps.sourcePlan.ref],
    changedAt: deps.changedAt,
    // 时间线要如实说明这次 revision 是**为什么**发生的（RW-05）：
    // 受理命令本来就带 changeReason（人的决定受理用 "user-decision-accepted"，
    // ControlEngine 的自动受理用 "autonomous-rework:<proposalId>"），此前硬编码成
    // "user-decision-accepted" 会把系统自动受理冒充成人的决定。逐字落账命令里的取值，
    // 本函数不推断、不改写；applyPlanChange 的形状守卫已保证该字段非空。
    reason: command.payload.changeReason,
  });
  const goalRevisionSnap = goalRevisionSnapshotFor(revChange, deps.changedAt, proposalRef.workspaceId);
  const eventBase = {
    schemaVersion: 1 as const,
    projectId: proposalRef.projectId,
    workspaceId: proposalRef.workspaceId,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: { ...command.identity.actor },
    occurredAt: deps.occurredAt,
  };
  return {
    commitKind: "goal-change-apply",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: applyPlanChangeFingerprint(command),
    expectedVersions: [
      { ref: deps.baseGoal.ref, revision: deps.baseGoal.revision },
      { ref: newPlan.ref, revision: 0 },
    ],
    events: [
      {
        ...eventBase,
        eventId: deps.eventId,
        eventType: "PlanRevisionAccepted",
        aggregateType: "PlanRevision",
        aggregateId: newPlan.planId,
        aggregateRevision: 1,
        payload: { goalId: deps.baseGoal.ref.goalId, goalAggregateRevision: goalSnapshot.revision, planRevision: newPlan },
      },
      {
        ...eventBase,
        eventId: deps.eventId + "-supersede",
        eventType: "PlanRevisionSuperseded",
        aggregateType: "PlanRevision",
        aggregateId: deps.sourcePlan.ref.planId,
        aggregateRevision: 2,
        payload: { supersededRef: deps.sourcePlan.ref, activeRef: newPlan.ref, decisionRef, changedAt: deps.changedAt },
      },
      {
        ...eventBase,
        eventId: deps.eventId + "-revision",
        eventType: "GoalRevisionRecorded",
        aggregateType: "GoalRevision",
        aggregateId: `${deps.baseGoal.ref.goalId}@${goalSnapshot.revision}`,
        aggregateRevision: 1,
        payload: { change: revChange, recordedAt: deps.changedAt },
      },
    ],
    snapshots: [newPlan, goalRevisionSnap, goalSnapshot],
    outboxIntents: [],
  };
}
