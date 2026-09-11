import { planRevisionRefFor, goalRefFor } from "../../../contracts/plan.js";
export { planRevisionRefFor, goalRefFor } from "../../../contracts/plan.js";
/** Control-owned canonical record construction. */
import type { ApplyPlanRevisionCommand, PlanRevisionSnapshot, PlanRevisionAcceptedEvent, PlanRevisionRef } from "../../../contracts/plan.js";
import { applyPlanRevisionFingerprint } from "../../../contracts/plan.js";
import type { ArchitectureBaselinePin, CompletionPolicyPin } from "../../../contracts/governance.js";
import type { GoalSnapshot, PlanRevisionLedgerCommitV1 } from "../../../contracts/ledger.js";


export function planRevisionSnapshotFor(
  command: ApplyPlanRevisionCommand,
  pins: {
    completionPolicy: CompletionPolicyPin;
    architectureBaseline: ArchitectureBaselinePin;
  },
  acceptedAt: string,
): PlanRevisionSnapshot {
  const plan = command.payload.plan;
  return {
    ref: planRevisionRefFor(command),
    revision: 1,
    schemaVersion: 1,
    goalRef: goalRefFor(command),
    planId: plan.planId,
    planRevision: plan.planRevision,
    acceptedAt,
    ...(plan.reviewAdmissionProtocol ? { reviewAdmissionProtocol: plan.reviewAdmissionProtocol } : {}),
    ...(plan.origin ? { origin: structuredClone(plan.origin) } : {}),
    effectiveCompletionPolicy: pins.completionPolicy,
    effectiveArchitectureBaseline: pins.architectureBaseline,
    stages: plan.stages.map((s) => ({ ...s })),
    tasks: plan.tasks.map((t) => ({ ...t, scope: { ...t.scope } })),
    // RW-07：指派随 revision 一起被接受。接受后的快照是派发与返工编译的唯一来源，因此
    // 草稿带了 assignments 就逐条复制（草稿没带时不写入该字段，读取侧回落到同一快照的
    // origin.assignments，见 contracts/plan.ts 的 revisionAssignments）。
    ...(Array.isArray(plan.assignments)
      ? { assignments: plan.assignments.map((entry) => ({ taskId: entry.taskId, role: entry.role, instruction: entry.instruction })) }
      : {}),
    obligations: plan.obligations.map((o) => ({
      ...o,
      taskIds: [...o.taskIds],
      verificationRequirements: o.verificationRequirements.map((v) => ({ ...v })),
    })),
    taskHierarchy: {
      parentOf: plan.taskHierarchy.parentOf.map((e) => ({ ...e })),
    },
    executionDag: {
      dependsOn: plan.executionDag.dependsOn.map((e) => ({ ...e, requires: { ...e.requires } })),
    },
  };
}


export function planRevisionAcceptedEventFor(
  command: ApplyPlanRevisionCommand,
  deps: {
    eventId: string;
    occurredAt: string;
    workspaceId: string;
    goalAggregateRevision: number;
    planSnapshot: PlanRevisionSnapshot;
  },
): PlanRevisionAcceptedEvent {
  return {
    eventId: deps.eventId,
    eventType: "PlanRevisionAccepted",
    schemaVersion: 1,
    projectId: command.identity.projectId,
    workspaceId: deps.workspaceId,
    aggregateType: "PlanRevision",
    aggregateId: command.payload.plan.planId,
    aggregateRevision: 1,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: { ...command.identity.actor },
    occurredAt: deps.occurredAt,
    payload: {
      goalId: command.aggregateId,
      goalAggregateRevision: deps.goalAggregateRevision,
      planRevision: deps.planSnapshot,
    },
  };
}


/** Goal snapshot after the accepted plan (revision + 1, activePlanRevision set). */
export function updatedGoalSnapshotFor(baseGoal: GoalSnapshot, planRef: PlanRevisionRef): GoalSnapshot {
  return {
    ref: { ...baseGoal.ref },
    workspaceRef: { ...baseGoal.workspaceRef },
    objective: baseGoal.objective,
    desiredState: "active",
    activePlanRevision: planRef,
    revision: baseGoal.revision + 1,
  };
}


/** Deterministic plan-revision ledger commit (fold-equality target for Control). */
export function buildPlanLedgerCommit(
  command: ApplyPlanRevisionCommand,
  deps: {
    eventId: string;
    occurredAt: string;
    acceptedAt: string;
    pins: { completionPolicy: CompletionPolicyPin; architectureBaseline: ArchitectureBaselinePin };
    baseGoal: GoalSnapshot;
  },
): PlanRevisionLedgerCommitV1 {
  const planSnapshot = planRevisionSnapshotFor(command, deps.pins, deps.acceptedAt);
  const goalSnapshot = updatedGoalSnapshotFor(deps.baseGoal, planSnapshot.ref);
  const event = planRevisionAcceptedEventFor(command, {
    eventId: deps.eventId,
    occurredAt: deps.occurredAt,
    workspaceId: deps.baseGoal.workspaceRef.workspaceId,
    goalAggregateRevision: goalSnapshot.revision,
    planSnapshot,
  });
  return {
    commitKind: "plan-revision",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: applyPlanRevisionFingerprint(command),
    expectedVersions: [
      { ref: goalRefFor(command), revision: command.expectedRevision },
      { ref: planSnapshot.ref, revision: 0 },
    ],
    events: [event],
    snapshots: [planSnapshot, goalSnapshot],
    outboxIntents: [],
  };
}