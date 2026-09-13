import { buildReduceGoalCommand as formalbuildReduceGoalCommand } from "../../../src/contracts/commands/goal-phase.js";


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
import type { CommandIdentity } from "../../../src/contracts/command-event.js";
import type { PlanRevisionDraft } from "../../../src/contracts/plan.js";




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
  return formalbuildReduceGoalCommand({ ...deps, actor: deps.actor ?? ({ kind: "system" as const, id: "control-engine" }), idempotencyKey: deps.idempotencyKey ?? "p1-05-reduce-goal" });
}
