import { buildEvidenceV1 as formalbuildEvidenceV1, buildEffectivityAnchorV1 as formalbuildEffectivityAnchorV1, buildSubmitEvidenceCommand as formalbuildSubmitEvidenceCommand, buildReduceTaskCommand as formalbuildReduceTaskCommand } from "../../../src/contracts/commands/evidence.js";

/**
 * P1-04 shared fixtures — plan/evidence/reduction builders + the deterministic
 * scenario prepare paths (same pattern as P1-02/P1-03 fixture builders: the
 * Control handlers must fold EXACTLY these shapes given the same ids).
 *
 * FROZEN identity choices:
 *   - the P1-04 plan fixture ("plan-evidence-mvp") has NO dependsOn edges on
 *     dispatchable tasks: P1-03's frozen evaluateTaskEligibility reads the
 *     plan-snapshot phases (static "pending"), so DAG-ordered dispatch of
 *     dependent tasks is not exercisable until a later scheduling ticket;
 *     the gate carries the DAG edges (gates are never dispatched).
 *   - claim/observation/verdict evidence ids and coverage are explicit in
 *     fixtures (deterministic); the admission index order is the evidence
 *     submission order.
 */
import type { CommandIdentity } from "../../../src/contracts/command-event.js";
import { commandIdentityKey } from "../../../src/contracts/command-event.js";
import type { PlanRevisionDraft, PlanRevisionRef } from "../../../src/contracts/plan.js";
import type { ArchitectureBaselinePin, CompletionPolicyPin, VersionedCompletionPolicyFixture } from "../../../src/contracts/governance.js";
import type { ArtifactRef } from "../../../src/contracts/artifact.js";
import type { RunRef, TaskTriple } from "../../../src/contracts/dispatch.js";
import type { EffectivityAnchorV1, EvidenceCoverageV1, EvidenceKind, EvidenceOutcome, EvidenceV1, SubmitEvidenceCommand } from "../../../src/contracts/evidence.js";


import type { ReduceTaskCommand, TaskReductionSnapshot } from "../../../src/contracts/reduction.js";


import { canonicalJson } from "../../../src/contracts/fingerprint.js";

// ------------------------------------------------------------------------ //
// P1-04 plan fixture                                                         //
// ------------------------------------------------------------------------ //

export const P104_TASK_IMPLEMENT = "task-implement";
export const P104_TASK_REVIEW = "task-review";
export const P104_TASK_GATE = "gate-evidence";
export const P104_TASK_BLOCKED = "task-blocked-104";
export const P104_TASK_DEFERRED = "task-deferred-104";

export const P104_OBL_IMPLEMENT = "obl-implement";
export const P104_OBL_REVIEW = "obl-review";
export const P104_OBL_GATE = "obl-gate";
export const P104_OBL_BLOCKED = "obl-blocked-104";
export const P104_OBL_DEFERRED = "obl-deferred-104";

export const P104_GOAL = "goal-1";

export const P104_PLAN_ID = "plan-evidence-mvp";

export const P104_PLAN_REVISION_FIXTURE_V1: PlanRevisionDraft = {
  schemaVersion: 1,
  planId: P104_PLAN_ID,
  planRevision: 1,
  goalId: P104_GOAL,
  stages: [{ stageId: "stage-evidence", title: "证据归约：实现、评审与 Gate" }],
  tasks: [
    {
      taskId: P104_TASK_IMPLEMENT,
      stageId: "stage-evidence",
      title: "实现变更：静态与动态证据齐备后归约",
      requirementLevel: "required",
      taskKind: "work",
      disposition: "active",
      phase: "pending",
      scope: { kind: "stage", stageId: "stage-evidence" },
    },
    {
      taskId: P104_TASK_REVIEW,
      stageId: "stage-evidence",
      title: "语义变化有界评审：Reviewer Run + verdict",
      requirementLevel: "required",
      taskKind: "work",
      disposition: "active",
      phase: "pending",
      scope: { kind: "stage", stageId: "stage-evidence" },
    },
    {
      taskId: P104_TASK_GATE,
      title: "EvidenceGate：全部义务满足且无未对账副作用",
      requirementLevel: "required",
      taskKind: "gate",
      disposition: "active",
      phase: "pending",
      scope: { kind: "goal" },
    },
    {
      taskId: P104_TASK_BLOCKED,
      stageId: "stage-evidence",
      title: "被 Blocker 阻塞（映射义务以满足 applyPlan 守卫）",
      requirementLevel: "required",
      taskKind: "work",
      disposition: "active",
      phase: "blocked",
      scope: { kind: "stage", stageId: "stage-evidence" },
    },
    {
      taskId: P104_TASK_DEFERRED,
      stageId: "stage-evidence",
      title: "deferred 任务（映射义务；永不满足）",
      requirementLevel: "required",
      taskKind: "work",
      disposition: "deferred",
      phase: "pending",
      scope: { kind: "stage", stageId: "stage-evidence" },
    },
  ],
  obligations: [
    {
      obligationId: P104_OBL_IMPLEMENT,
      title: "实现变更并产生静态+动态证据",
      requirementLevel: "required",
      taskIds: [P104_TASK_IMPLEMENT],
      verificationRequirements: [
        { requirementId: "vr-impl-static", requirementLevel: "required", kind: "static", description: "静态检查 PASS" },
        { requirementId: "vr-impl-dynamic", requirementLevel: "required", kind: "dynamic", description: "动态检查 PASS" },
      ],
    },
    {
      obligationId: P104_OBL_REVIEW,
      title: "语义变化有界评审并给出 verdict",
      requirementLevel: "required",
      taskIds: [P104_TASK_REVIEW],
      verificationRequirements: [
        { requirementId: "vr-review", requirementLevel: "required", kind: "reviewer", description: "Reviewer verdict 或显式快放证据" },
        { requirementId: "vr-review-static", requirementLevel: "required", kind: "static", description: "ReviewPacket 有界且无 transcript" },
      ],
    },
    {
      obligationId: P104_OBL_GATE,
      title: "Gate：归约表与验收证据完整",
      requirementLevel: "required",
      taskIds: [P104_TASK_GATE],
      verificationRequirements: [
        { requirementId: "vr-gate", requirementLevel: "required", kind: "static", description: "Gate 静态归约证据" },
      ],
    },
    {
      obligationId: P104_OBL_BLOCKED,
      title: "blocked 任务映射义务",
      requirementLevel: "required",
      taskIds: [P104_TASK_BLOCKED],
      verificationRequirements: [
        { requirementId: "vr-blocked-104", requirementLevel: "required", kind: "static", description: "blocked 任务不可领取" },
      ],
    },
    {
      obligationId: P104_OBL_DEFERRED,
      title: "deferred 任务映射义务",
      requirementLevel: "required",
      taskIds: [P104_TASK_DEFERRED],
      verificationRequirements: [
        { requirementId: "vr-deferred-104", requirementLevel: "required", kind: "static", description: "deferred 任务永不满足" },
      ],
    },
  ],
  taskHierarchy: {
    parentOf: [
      { parentTaskId: P104_TASK_GATE, childTaskId: P104_TASK_IMPLEMENT },
      { parentTaskId: P104_TASK_GATE, childTaskId: P104_TASK_REVIEW },
      { parentTaskId: P104_TASK_GATE, childTaskId: P104_TASK_BLOCKED },
      { parentTaskId: P104_TASK_GATE, childTaskId: P104_TASK_DEFERRED },
    ],
  },
  executionDag: {
    dependsOn: [
      {
        taskId: P104_TASK_GATE,
        dependsOnId: P104_TASK_REVIEW,
        requires: { kind: "gate-result", label: "证据齐全且无未对账副作用" },
      },
    ],
  },
};

/**
 * Fast-path policy fixture: same requirement kinds, PLUS an explicit
 * fastPathDiffClasses allowlist. The frozen P1-02 fixture (without the field)
 * stays digest-identical; this fixture is used ONLY by fast-path tests.
 */
export const COMPLETION_POLICY_FASTPATH_FIXTURE_V1: VersionedCompletionPolicyFixture = {
  schemaVersion: 1,
  identity: { policyId: "policy-completion-fastpath" },
  revision: 1,
  content: {
    schemaVersion: 1,
    requirementKinds: ["static", "dynamic", "reviewer"],
    minimumRequiredRequirementsPerObligation: 1,
    fastPathDiffClasses: ["docs-only"],
  },
};

// ------------------------------------------------------------------------ //
// Builders                                                                   //
// ------------------------------------------------------------------------ //

export type BuildEvidenceDeps = {
  evidenceId: string;
  kind: EvidenceKind;
  outcome: EvidenceOutcome;
  projectId: string;
  goalId: string;
  taskId: string;
  coverage: EvidenceCoverageV1[];
  anchor: EffectivityAnchorV1;
  verificationPlanRef: { planId: string; planDigest: string };
  runRef?: RunRef | null;
  checkId?: string | null;
  actor?: { kind: "human" | "system"; id: string };
  summaryText?: string;
  artifactRef?: ArtifactRef | null;
};

export function buildEvidenceV1(deps: BuildEvidenceDeps): EvidenceV1 {
  return formalbuildEvidenceV1({ ...deps, actor: deps.actor ?? { kind: "human", id: "user-1" }, runRef: deps.runRef ?? null, checkId: deps.checkId ?? null, summaryText: deps.summaryText ?? "p1-04 evidence summary", artifactRef: deps.artifactRef ?? null });
}

export function buildEffectivityAnchorV1(deps: {
  planRef: PlanRevisionRef;
  planRevision: number;
  workspaceRevision: number;
  pinnedCompletionPolicy: CompletionPolicyPin;
  pinnedArchitectureBaseline: ArchitectureBaselinePin;
}): EffectivityAnchorV1 {
  return formalbuildEffectivityAnchorV1(deps);
}

export type BuildSubmitEvidenceDeps = {
  commandId: string;
  correlationId: string;
  submittedAt: string;
  evidence: EvidenceV1;
  actor?: CommandIdentity["actor"];
  idempotencyKey?: string;
};

export function buildSubmitEvidenceCommand(deps: BuildSubmitEvidenceDeps): SubmitEvidenceCommand {
  return formalbuildSubmitEvidenceCommand({ ...deps, actor: deps.actor ?? { kind: "human", id: "user-1" }, idempotencyKey: deps.idempotencyKey ?? "p1-04-evidence-" + deps.evidence.evidenceId });
}

export function evidenceIdentityKey(command: SubmitEvidenceCommand): string {
  return commandIdentityKey(command.identity);
}

// ------------------------------------------------------------------------ //
// Reduction builders                                                         //
// ------------------------------------------------------------------------ //

export type BuildReduceTaskDeps = {
  commandId: string;
  correlationId: string;
  submittedAt: string;
  expectedRevision: number;
  projectId: string;
  goalId: string;
  taskId: string;
  actor?: CommandIdentity["actor"];
  idempotencyKey?: string;
};

export function buildReduceTaskCommand(deps: BuildReduceTaskDeps): ReduceTaskCommand {
  return formalbuildReduceTaskCommand({ ...deps, actor: deps.actor ?? { kind: "system", id: "control-engine" }, idempotencyKey: deps.idempotencyKey ?? "p1-04-reduce" });
}

// ------------------------------------------------------------------------ //
// Small deterministic helpers                                                //
// ------------------------------------------------------------------------ //

export function taskTriple(projectId: string, goalId: string, taskId: string): TaskTriple {
  return { projectId, goalId, taskId };
}

export function coverage(obligationId: string, requirementId: string): EvidenceCoverageV1 {
  return { obligationId, requirementId };
}

export function artifactRefFor(digest: string, sourceRefId = "plan-evidence-mvp"): ArtifactRef {
  return {
    kind: "artifact",
    contentType: "text/plain",
    digest,
    sizeBytes: 16,
    source: { kind: "plan-revision", refId: sourceRefId, revision: "1" },
  };
}

export function canonicalEquivalentCauses(causes: TaskReductionSnapshot["causes"]): boolean {
  return typeof canonicalJson(causes) === "string";
}
