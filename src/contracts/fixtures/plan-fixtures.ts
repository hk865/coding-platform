/**
 * P1-02 shared fixture: hand-authored PlanRevision.
 *
 * Frozen structure (see IMPLEMENTATION-HANDOFF.md "P1-02 契约与存储语义"):
 *  - stages / runtime tasks (requirementLevel/taskKind/disposition/phase are
 *    four ORTHOGONAL dimensions) / AcceptanceObligation / GateTask (a gate is
 *    a Runtime Task with taskKind="gate") / TaskHierarchy (parent_of only) /
 *    RuntimeExecutionDAG (depends_on only; every hard edge states what it
 *    needs) / PlanRevisionSnapshot (fixed exact pins);
 *  - the fixture satisfies every non-empty guard: >=1 required executable
 *    task, >=1 active required GoalGateTask, >=1 required obligation, each
 *    required executable task maps a required obligation, each required
 *    obligation maps work/gate tasks and compiles >=1 required
 *    VerificationRequirement (kind within the CompletionPolicy's
 *    requirementKinds);
 *  - stage does NOT synthesize dependencies; parent_of never enters the DAG
 *    and depends_on never enters the hierarchy.
 */
import type { CommandIdentity } from "../command-event.js";
import { commandIdentityKey } from "../command-event.js";
import type {
  ApplyPlanRevisionCommand,
  PlanRevisionDraft,
  PlanRevisionSnapshot,
  PlanRevisionAcceptedEvent,
  PlanRevisionRef,
} from "../plan.js";
import { applyPlanRevisionFingerprint } from "../plan.js";
import type { ArchitectureBaselinePin, CompletionPolicyPin } from "../governance.js";
import type { GoalRef, GoalSnapshot, PlanRevisionLedgerCommitV1 } from "../ledger.js";

export const HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1: PlanRevisionDraft = {
  schemaVersion: 1,
  planId: "plan-mvp-1",
  planRevision: 1,
  goalId: "goal-1",
  stages: [
    { stageId: "stage-contract", title: "确定契约并安装治理基线" },
    { stageId: "stage-execution", title: "实现并验证可观察切片" },
  ],
  tasks: [
    {
      taskId: "task-install-contract",
      stageId: "stage-contract",
      title: "安装 CompletionPolicy / ArchitectureBaseline 并激活 Project active refs",
      requirementLevel: "required",
      taskKind: "work",
      disposition: "active",
      phase: "pending",
      scope: { kind: "stage", stageId: "stage-contract" },
    },
    {
      taskId: "task-accept-plan",
      stageId: "stage-contract",
      title: "接受手写 PlanRevision 并固定 governance pins",
      requirementLevel: "required",
      taskKind: "work",
      disposition: "active",
      phase: "pending",
      scope: { kind: "stage", stageId: "stage-contract" },
    },
    {
      taskId: "task-verify",
      stageId: "stage-execution",
      title: "运行契约套件与重启证据验证",
      requirementLevel: "required",
      taskKind: "work",
      disposition: "active",
      phase: "pending",
      scope: { kind: "stage", stageId: "stage-execution" },
    },
    {
      taskId: "gate-goal",
      title: "GoalGate：P1-02 验收路径全部通过",
      requirementLevel: "required",
      taskKind: "gate",
      disposition: "active",
      phase: "pending",
      scope: { kind: "goal" },
    },
  ],
  obligations: [
    {
      obligationId: "obl-1",
      title: "治理基线以 install/activate 路径持久化且可解析",
      requirementLevel: "required",
      taskIds: ["task-install-contract", "task-accept-plan"],
      verificationRequirements: [
        {
          requirementId: "vr-1",
          requirementLevel: "required",
          kind: "static",
          description: "install/activate 契约套件与重启解析证据",
        },
      ],
    },
    {
      obligationId: "obl-2",
      title: "Plan 被原子接受并投影为 Plan Graph / Task Detail",
      requirementLevel: "required",
      taskIds: ["task-verify"],
      verificationRequirements: [
        {
          requirementId: "vr-2",
          requirementLevel: "required",
          kind: "dynamic",
          description: "运行契约套件与投影测试",
        },
      ],
    },
    {
      obligationId: "obl-3",
      title: "P1-02 验收在不产生 Run/dispatch 的前提下满足",
      requirementLevel: "required",
      taskIds: ["gate-goal"],
      verificationRequirements: [
        {
          requirementId: "vr-3",
          requirementLevel: "required",
          kind: "reviewer",
          description: "集成验收逐项对照与独立复核",
        },
      ],
    },
  ],
  taskHierarchy: {
    parentOf: [
      { parentTaskId: "gate-goal", childTaskId: "task-install-contract" },
      { parentTaskId: "gate-goal", childTaskId: "task-accept-plan" },
      { parentTaskId: "gate-goal", childTaskId: "task-verify" },
    ],
  },
  executionDag: {
    dependsOn: [
      {
        taskId: "task-accept-plan",
        dependsOnId: "task-install-contract",
        requires: { kind: "output-contract", label: "已安装并激活的 governance 精确 refs" },
      },
      {
        taskId: "task-verify",
        dependsOnId: "task-accept-plan",
        requires: { kind: "output-contract", label: "accepted plan revision + fixed pins" },
      },
      {
        taskId: "gate-goal",
        dependsOnId: "task-verify",
        requires: { kind: "gate-result", label: "契约套件与重启证据" },
      },
    ],
  },
};

export type BuildApplyPlanDeps = {
  commandId: string;
  correlationId: string;
  submittedAt: string;
  projectId: string;
  actor?: CommandIdentity["actor"];
  idempotencyKey?: string;
  /** expected Goal revision (CAS; 1 after CreateGoal). */
  expectedRevision: number;
  goalId?: string;
};

export function buildApplyPlanCommand(
  draft: PlanRevisionDraft,
  deps: BuildApplyPlanDeps,
): ApplyPlanRevisionCommand {
  const goalId = deps.goalId ?? draft.goalId;
  return {
    commandId: deps.commandId,
    commandType: "ApplyPlanRevision",
    schemaVersion: 1,
    identity: {
      projectId: deps.projectId,
      actor: deps.actor ?? { kind: "human", id: "user-1" },
      idempotencyKey: deps.idempotencyKey ?? "p1-02-apply-plan",
    },
    aggregateId: goalId,
    expectedRevision: deps.expectedRevision,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: { plan: draft },
  };
}

export function planRevisionRefFor(command: ApplyPlanRevisionCommand): PlanRevisionRef {
  return {
    aggregateType: "PlanRevision",
    projectId: command.identity.projectId,
    planId: command.payload.plan.planId,
  };
}

export function goalRefFor(command: ApplyPlanRevisionCommand): GoalRef {
  return {
    aggregateType: "Goal",
    projectId: command.identity.projectId,
    goalId: command.aggregateId,
  };
}

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
    effectiveCompletionPolicy: pins.completionPolicy,
    effectiveArchitectureBaseline: pins.architectureBaseline,
    stages: plan.stages.map((s) => ({ ...s })),
    tasks: plan.tasks.map((t) => ({ ...t, scope: { ...t.scope } })),
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
  deps: { eventId: string; occurredAt: string; workspaceId: string; planSnapshot: PlanRevisionSnapshot },
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
    payload: { goalId: command.aggregateId, planRevision: deps.planSnapshot },
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
  const event = planRevisionAcceptedEventFor(command, {
    eventId: deps.eventId,
    occurredAt: deps.occurredAt,
    workspaceId: deps.baseGoal.workspaceRef.workspaceId,
    planSnapshot,
  });
  const goalSnapshot = updatedGoalSnapshotFor(deps.baseGoal, planSnapshot.ref);
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

export function planIdentityKey(command: ApplyPlanRevisionCommand): string {
  return commandIdentityKey(command.identity);
}
