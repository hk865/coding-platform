/**
 * P1-05 shared fixtures — goal-phase plan fixture + deterministic fold targets
 * for the GoalPhase reducer (same pattern as P1-04 fixture builders).
 *
 * FROZEN identity choices:
 *   - the P1-05 plan fixture ("plan-goal-mvp") carries NO dependsOn edges:
 *     P1-05 does not touch dispatch/scheduling (P1-03 eligibility unchanged);
 *     parent_of edges ONLY express grouping (they never change the required
 *     set — acceptance 3).
 *   - the required active GoalGate task is the ONLY no-change expression
 *     seam: a plan with an EMPTY required goal-gate set can never complete
 *     (§3.2) — an AlreadySatisfied gate must be proven by current PASS
 *     evidence (TaskReduction phase satisfied, P1-04 formula).
 */
import type { CommandIdentity } from "../command-event.js";
import type { PlanRevisionDraft, PlanRevisionRef } from "../plan.js";
import type {
  GoalPhase,
  GoalPhaseReasonCode,
  GoalPhaseRef,
  GoalPhaseSnapshot,
  GoalPhaseUpdatedEvent,
  GoalCompletionExplanation,
  GoalSideEffectReconciliation,
} from "../goal-phase.js";
import { goalPhaseRefFor, reduceGoalFingerprint } from "../goal-phase.js";
import type { GoalReductionLedgerCommitV1 } from "../ledger.js";

export const P105_GOAL = "goal-105";

export const P105_TASK_WORK = "task-work-105";
export const P105_TASK_MODULE_GATE = "gate-module-105";
export const P105_TASK_STAGE_GATE = "gate-stage-105";
export const P105_TASK_GOAL_GATE = "gate-goal-105";
export const P105_TASK_OPTIONAL = "task-optional-105";

export const P105_OBL_WORK = "obl-work-105";
export const P105_OBL_MODULE = "obl-module-105";
export const P105_OBL_STAGE = "obl-stage-105";
export const P105_OBL_GOAL = "obl-goal-105";
export const P105_OBL_OPTIONAL = "obl-optional-105";

export const P105_PLAN_ID = "plan-goal-mvp";
export const P105_STAGE = "stage-goal-105";

export const P105_PLAN_REVISION_FIXTURE_V1: PlanRevisionDraft = {
  schemaVersion: 1,
  planId: P105_PLAN_ID,
  planRevision: 1,
  goalId: P105_GOAL,
  stages: [{ stageId: P105_STAGE, title: "Goal 归约：work + 三层 Gate" }],
  tasks: [
    {
      taskId: P105_TASK_WORK,
      stageId: P105_STAGE,
      title: "required work：静态证据齐备后归约",
      requirementLevel: "required",
      taskKind: "work",
      disposition: "active",
      phase: "pending",
      scope: { kind: "stage", stageId: P105_STAGE },
    },
    {
      taskId: P105_TASK_MODULE_GATE,
      stageId: P105_STAGE,
      title: "ModuleGate：module scope 全部 required 满足",
      requirementLevel: "required",
      taskKind: "gate",
      disposition: "active",
      phase: "pending",
      scope: { kind: "module", stageId: P105_STAGE, moduleRef: "m-goal-105" },
    },
    {
      taskId: P105_TASK_STAGE_GATE,
      stageId: P105_STAGE,
      title: "StageGate：stage scope 全部 required 满足",
      requirementLevel: "required",
      taskKind: "gate",
      disposition: "active",
      phase: "pending",
      scope: { kind: "stage", stageId: P105_STAGE },
    },
    {
      taskId: P105_TASK_GOAL_GATE,
      title: "GoalGate：no-change/完成由当前 PASS Evidence 证明",
      requirementLevel: "required",
      taskKind: "gate",
      disposition: "active",
      phase: "pending",
      scope: { kind: "goal" },
    },
    {
      taskId: P105_TASK_OPTIONAL,
      stageId: P105_STAGE,
      title: "optional work：永不阻止完成（attention flag）",
      requirementLevel: "optional",
      taskKind: "work",
      disposition: "active",
      phase: "running",
      scope: { kind: "stage", stageId: P105_STAGE },
    },
  ],
  obligations: [
    {
      obligationId: P105_OBL_WORK,
      title: "required work 完成的义务",
      requirementLevel: "required",
      taskIds: [P105_TASK_WORK],
      verificationRequirements: [
        { requirementId: "vr-work-105", requirementLevel: "required", kind: "static", description: "work 静态证据 PASS" },
        { requirementId: "vr-work-105-dyn", requirementLevel: "required", kind: "dynamic", description: "work 动态证据 PASS" },
      ],
    },
    {
      obligationId: P105_OBL_MODULE,
      title: "ModuleGate 义务",
      requirementLevel: "required",
      taskIds: [P105_TASK_MODULE_GATE],
      verificationRequirements: [
        { requirementId: "vr-module-105", requirementLevel: "required", kind: "static", description: "module gate 证据 PASS" },
      ],
    },
    {
      obligationId: P105_OBL_STAGE,
      title: "StageGate 义务",
      requirementLevel: "required",
      taskIds: [P105_TASK_STAGE_GATE],
      verificationRequirements: [
        { requirementId: "vr-stage-105", requirementLevel: "required", kind: "static", description: "stage gate 证据 PASS" },
      ],
    },
    {
      obligationId: P105_OBL_GOAL,
      title: "GoalGate 义务",
      requirementLevel: "required",
      taskIds: [P105_TASK_GOAL_GATE],
      verificationRequirements: [
        { requirementId: "vr-goal-105", requirementLevel: "required", kind: "static", description: "goal gate 证据 PASS" },
      ],
    },
    {
      obligationId: P105_OBL_OPTIONAL,
      title: "optional 义务（不阻止完成）",
      requirementLevel: "optional",
      taskIds: [P105_TASK_OPTIONAL],
      verificationRequirements: [
        { requirementId: "vr-optional-105", requirementLevel: "required", kind: "static", description: "optional 证据" },
      ],
    },
  ],
  taskHierarchy: {
    parentOf: [
      { parentTaskId: P105_TASK_GOAL_GATE, childTaskId: P105_TASK_WORK },
      { parentTaskId: P105_TASK_GOAL_GATE, childTaskId: P105_TASK_MODULE_GATE },
      { parentTaskId: P105_TASK_GOAL_GATE, childTaskId: P105_TASK_STAGE_GATE },
      { parentTaskId: P105_TASK_GOAL_GATE, childTaskId: P105_TASK_OPTIONAL },
    ],
  },
  executionDag: { dependsOn: [] },
};

// ------------------------------------------------------------------------ //
// Builders                                                                   //
// ------------------------------------------------------------------------ //

export type BuildReduceGoalDeps = {
  commandId: string;
  correlationId: string;
  submittedAt: string;
  expectedRevision: number;
  projectId: string;
  goalId: string;
  actor?: CommandIdentity["actor"];
  idempotencyKey?: string;
};

export function buildReduceGoalCommand(deps: BuildReduceGoalDeps) {
  return {
    commandId: deps.commandId,
    commandType: "ReduceGoal" as const,
    schemaVersion: 1 as const,
    identity: {
      projectId: deps.projectId,
      actor: deps.actor ?? ({ kind: "system" as const, id: "control-engine" }),
      idempotencyKey: deps.idempotencyKey ?? "p1-05-reduce-goal",
    },
    aggregateId: deps.goalId,
    expectedRevision: deps.expectedRevision,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: { goalId: deps.goalId },
  };
}

export type BuildGoalPhaseSnapshotDeps = {
  projectId: string;
  goalId: string;
  revision: number;
  planRef: PlanRevisionRef | null;
  previousPhase: GoalPhase | null;
  phase: GoalPhase;
  reasonCodes: GoalPhaseReasonCode[];
  explanation: GoalCompletionExplanation;
  sideEffectReconciliation: GoalSideEffectReconciliation;
  reducedAt: string;
};

export function buildGoalPhaseSnapshot(deps: BuildGoalPhaseSnapshotDeps): GoalPhaseSnapshot {
  return {
    ref: goalPhaseRefFor(deps.projectId, deps.goalId),
    revision: deps.revision,
    schemaVersion: 1,
    planRef: deps.planRef === null ? null : { ...deps.planRef },
    previousPhase: deps.previousPhase,
    phase: deps.phase,
    reasonCodes: [...deps.reasonCodes],
    explanation: {
      schemaVersion: 1,
      phase: deps.explanation.phase,
      headline: deps.explanation.headline,
      items: deps.explanation.items.map((i) => ({ ...i, refs: { ...i.refs } })),
    },
    sideEffectReconciliation: {
      identified: deps.sideEffectReconciliation.identified.map((s) => ({ ...s, runRef: { ...s.runRef } })),
      unreconciled: deps.sideEffectReconciliation.unreconciled.map((s) => ({ ...s, runRef: { ...s.runRef } })),
    },
    reducedAt: deps.reducedAt,
  };
}

/** Deterministic goal-reduction fold target (fold-equality for Control). */
export function buildGoalReductionLedgerCommit(
  command: import("../goal-phase.js").ReduceGoalCommand,
  deps: {
    eventId: string;
    occurredAt: string;
    workspaceId: string;
    phase: GoalPhaseSnapshot;
  },
): GoalReductionLedgerCommitV1 {
  const ref: GoalPhaseRef = deps.phase.ref;
  const event: GoalPhaseUpdatedEvent = {
    eventId: deps.eventId,
    eventType: "GoalPhaseUpdated",
    schemaVersion: 1,
    projectId: ref.projectId,
    workspaceId: deps.workspaceId,
    aggregateType: "GoalPhase",
    aggregateId: ref.goalId,
    aggregateRevision: deps.phase.revision,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: { ...command.identity.actor },
    occurredAt: deps.occurredAt,
    payload: {
      goalId: ref.goalId,
      previousPhase: deps.phase.previousPhase,
      phase: deps.phase.phase,
      reasonCodes: [...deps.phase.reasonCodes],
      explanation: deps.phase.explanation,
      sideEffectReconciliation: deps.phase.sideEffectReconciliation,
      planRef: deps.phase.planRef === null ? null : { ...deps.phase.planRef },
      reducedAt: deps.phase.reducedAt,
    },
  };
  return {
    commitKind: "goal-reduction",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: reduceGoalFingerprint(command),
    expectedVersions: [{ ref, revision: deps.phase.revision - 1 }],
    events: [event],
    snapshots: [deps.phase],
    outboxIntents: [],
  };
}
