/**
 * Shared P1-13 contract-suite harness: evolution-policy + remediation scenario
 * (FROZEN surface; lanes fill the engine implementations behind the same scenario).
 */
import { expect } from "vitest";
import type { P1_11HarnessLike, P1_11TestHarness } from "./p1-11-harness.js";
import { p111BootstrapGoalGovernance } from "./p1-11-harness.js";
import type { ArchitectureEvolutionPolicyInstallReceipt, ArchitectureEvolutionPolicyActivateReceipt } from "../../src/contracts/architecture-evolution-policy.js";
import type { SubmitRemediationPlanPatchReceipt, CreateRemediationTaskReceipt, AdvanceRemediationTaskReceipt, RemediationPlanPatchV1, RemediationTaskV1 } from "../../src/contracts/remediation.js";
import type { ArchitectureFindingV1 } from "../../src/contracts/architecture-inspection.js";
import type { RecordArchitectureFindingReceipt } from "../../src/contracts/architecture-inspection.js";
import {
  ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1,
  buildP113InstallCommand,
  buildP113ActivateCommand,
  p113PolicyPin,
  P113_PROJECT,
} from "../../src/fixtures/architecture-evolution-policy-fixtures.js";
import {
  P113_WORKSPACE,
  P113_FINDING,
  P113_TASK,
  buildP113PlanPatchV1,
  buildP113TaskV1,
  buildP113SubmitPatchCommand,
  buildP113CreateTaskCommand,
  buildP113AdvanceTaskCommand,
  p113PatchRef,
  p113FindingRef,
  p113DedupKey,
} from "../contract-support/fixtures/remediation-fixtures.js";
import { buildP112DeltaFinding, buildP112ReportFinding, buildRecordArchitectureFindingCommand } from "../../src/fixtures/architecture-fixtures.js";
import { P112_FINDING_DELTA } from "../../src/fixtures/architecture-fixtures.js";

import { buildApplyPlanCommand } from "../../src/contracts/commands/plan.js";
import { planRevisionRefFor } from "../../src/contracts/plan.js";
import type { PlanRevisionDraft, PlanRevisionSnapshot } from "../../src/contracts/plan.js";
import { buildEvidenceV1, buildSubmitEvidenceCommand, buildEffectivityAnchorV1, coverage } from "../contract-support/fixtures/evidence-fixtures.js";
import { evidenceRefFor } from "../../src/contracts/evidence.js";
import type { EvidenceRef } from "../../src/contracts/evidence.js";
import type { RunRef } from "../../src/contracts/dispatch.js";
import { sha256Hex } from "../../src/contracts/fingerprint.js";
import { P113_SCHEMA } from "../../src/fixtures/architecture-evolution-policy-fixtures.js";

/**
 * P1-13 场景的可受理计划。
 *
 * 放在 contract-suite 而不是某个测试文件里：P1-13 的 writer chain 与契约套件都要在同一
 * goal 上证明「返工任务在新版本上被真实证据证明」，两处必须用同一份计划形状，
 * 否则「同一场景」会变成两份近似夹具。
 */
export const P113_PLAN_FIXTURE: PlanRevisionDraft = {
  schemaVersion: 1,
  planId: "plan-p113-1",
  planRevision: 1,
  goalId: "goal-1",
  stages: [{ stageId: "stage-p113-write", title: "writer applies the allowlisted remediation patch" }],
  tasks: [
    { taskId: P113_TASK, stageId: "stage-p113-write", title: "Writer applies and verifies the remediation patch",
      requirementLevel: "required", taskKind: "work", disposition: "active", phase: "pending", scope: { kind: "stage", stageId: "stage-p113-write" } },
    { taskId: "gate-p113-writer", title: "GoalGate: remediation verified at the post-fix revision",
      requirementLevel: "required", taskKind: "gate", disposition: "active", phase: "pending", scope: { kind: "goal" } },
  ],
  obligations: [
    { obligationId: "obl-p113-write", title: "Allowlisted, reversible remediation is written and verified", requirementLevel: "required", taskIds: [P113_TASK],
      verificationRequirements: [{ requirementId: "vr-p113-write", requirementLevel: "required", kind: "dynamic", description: "remediation patch verified at the post-fix workspace revision" }] },
    { obligationId: "obl-p113-gate", title: "Goal gate for the remediation slice", requirementLevel: "required", taskIds: ["gate-p113-writer"],
      verificationRequirements: [{ requirementId: "vr-p113-gate", requirementLevel: "required", kind: "reviewer", description: "independent review of the remediation slice" }] },
  ],
  taskHierarchy: { parentOf: [{ parentTaskId: "gate-p113-writer", childTaskId: P113_TASK }] },
  executionDag: { dependsOn: [{ taskId: "gate-p113-writer", dependsOnId: P113_TASK, requires: { kind: "gate-result", label: "writer patch verified" } }] },
};

/** 受理 P113 计划并返回其 canonical snapshot；命令身份由调用方给定以保持既有 ID 稳定。 */
export async function p113ApplyPlan(h: P1_13HarnessLike, deps: { commandId: string; idempotencyKey?: string }): Promise<PlanRevisionSnapshot> {
  const plan = P113_PLAN_FIXTURE;
  const command = buildApplyPlanCommand(plan, {
    commandId: deps.commandId,
    correlationId: deps.commandId + "-corr",
    submittedAt: P113_SCHEMA,
    projectId: P113_PROJECT,
    goalId: plan.goalId,
    actor: { kind: "human", id: "user-1" },
    expectedRevision: 1,
    idempotencyKey: deps.idempotencyKey ?? deps.commandId + "-idem",
  });
  const receipt = await h.applyPlan(command);
  expect(receipt.status).toBe("committed");
  const loaded = await h.ledger.load(planRevisionRefFor(command));
  expect(loaded.status).toBe("found");
  return (loaded as { snapshot: PlanRevisionSnapshot }).snapshot;
}

/** 固定 anchor：与计划 snapshot 的生效版本一致，否则 Control 会按适用范围拒绝。 */
export function p113PlanPinnedAnchor(plan: PlanRevisionSnapshot, workspaceRevision: number) {
  return buildEffectivityAnchorV1({
    planRef: plan.ref,
    planRevision: plan.planRevision,
    workspaceRevision,
    pinnedCompletionPolicy: plan.effectiveCompletionPolicy,
    pinnedArchitectureBaseline: plan.effectiveArchitectureBaseline,
  });
}

/**
 * 提交真实的 canonical PASS 证据。返工任务的 resolved 必须由这条证据证明，
 * 不能再靠调用方自报的 evidenceRef。
 */
export async function p113SubmitVerificationEvidence(
  h: P1_13HarnessLike,
  plan: PlanRevisionSnapshot,
  deps: { evidenceId: string; commandId: string; workspaceRevision: number; runRef?: RunRef | null; idempotencyKey?: string },
): Promise<EvidenceRef> {
  const evidence = buildEvidenceV1({
    evidenceId: deps.evidenceId,
    kind: "observation",
    outcome: "PASS",
    projectId: P113_PROJECT,
    goalId: "goal-1",
    taskId: P113_TASK,
    coverage: [coverage("obl-p113-write", "vr-p113-write")],
    anchor: p113PlanPinnedAnchor(plan, deps.workspaceRevision),
    verificationPlanRef: { planId: "vp-p113-writer", planDigest: sha256Hex("vp-p113-writer") },
    runRef: deps.runRef ?? null,
    checkId: "vr-p113-write",
  });
  const submitted = await h.submitEvidence(buildSubmitEvidenceCommand({
    commandId: deps.commandId,
    correlationId: deps.commandId + "-corr",
    submittedAt: P113_SCHEMA,
    idempotencyKey: deps.idempotencyKey ?? deps.commandId + "-idem",
    evidence,
  }));
  expect(submitted.status).toBe("committed");
  return evidenceRefFor(P113_PROJECT, deps.evidenceId);
}

export interface P1_13TestHarness extends P1_11TestHarness {
  recordArchitectureFinding(command: import("../../src/contracts/architecture-inspection.js").RecordArchitectureFindingCommand): Promise<RecordArchitectureFindingReceipt>;
  installArchitectureEvolutionPolicy(command: import("../../src/contracts/architecture-evolution-policy.js").InstallArchitectureEvolutionPolicyRevisionCommand): Promise<ArchitectureEvolutionPolicyInstallReceipt>;
  activateArchitectureEvolutionPolicy(command: import("../../src/contracts/architecture-evolution-policy.js").ActivateProjectArchitectureEvolutionPolicyCommand): Promise<ArchitectureEvolutionPolicyActivateReceipt>;
  submitRemediationPlanPatch(command: import("../../src/contracts/remediation.js").SubmitRemediationPlanPatchCommand): Promise<SubmitRemediationPlanPatchReceipt>;
  createRemediationTask(command: import("../../src/contracts/remediation.js").CreateRemediationTaskCommand): Promise<CreateRemediationTaskReceipt>;
  advanceRemediationTask(command: import("../../src/contracts/remediation.js").AdvanceRemediationTaskCommand): Promise<AdvanceRemediationTaskReceipt>;
  cleanup?(): Promise<void>;
}

export type P1_13HarnessLike = P1_11HarnessLike & {
  recordArchitectureFinding: (command: import("../../src/contracts/architecture-inspection.js").RecordArchitectureFindingCommand) => Promise<RecordArchitectureFindingReceipt>;
  installArchitectureEvolutionPolicy: (command: import("../../src/contracts/architecture-evolution-policy.js").InstallArchitectureEvolutionPolicyRevisionCommand) => Promise<ArchitectureEvolutionPolicyInstallReceipt>;
  activateArchitectureEvolutionPolicy: (command: import("../../src/contracts/architecture-evolution-policy.js").ActivateProjectArchitectureEvolutionPolicyCommand) => Promise<ArchitectureEvolutionPolicyActivateReceipt>;
  submitRemediationPlanPatch: (command: import("../../src/contracts/remediation.js").SubmitRemediationPlanPatchCommand) => Promise<SubmitRemediationPlanPatchReceipt>;
  createRemediationTask: (command: import("../../src/contracts/remediation.js").CreateRemediationTaskCommand) => Promise<CreateRemediationTaskReceipt>;
  advanceRemediationTask: (command: import("../../src/contracts/remediation.js").AdvanceRemediationTaskCommand) => Promise<AdvanceRemediationTaskReceipt>;
};

export function toP1_13Harness(h: P1_13HarnessLike): P1_13TestHarness {
  return h as unknown as P1_13TestHarness;
}

export type P113ScenarioResult = {
  install: ArchitectureEvolutionPolicyInstallReceipt;
  activate: ArchitectureEvolutionPolicyActivateReceipt;
  finding: ArchitectureFindingV1;
  patch: RemediationPlanPatchV1;
  patchReceipt: SubmitRemediationPlanPatchReceipt;
  task: RemediationTaskV1;
  taskReceipt: CreateRemediationTaskReceipt;
  advance1: AdvanceRemediationTaskReceipt;
  advance2: AdvanceRemediationTaskReceipt;
  advance3: AdvanceRemediationTaskReceipt;
};

export async function runP113Scenario(h: P1_13HarnessLike): Promise<P113ScenarioResult> {
  await p111BootstrapGoalGovernance(h.ledger, P113_PROJECT);
  const install = await h.installArchitectureEvolutionPolicy(buildP113InstallCommand(ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1, { commandId: "p113-cmd-install", projectId: P113_PROJECT }));
  expect(install.status).toBe("committed");
  const activate = await h.activateArchitectureEvolutionPolicy(buildP113ActivateCommand(p113PolicyPin(), { commandId: "p113-cmd-activate", projectId: P113_PROJECT, expectedRevision: 1 }));
  expect(activate.status).toBe("committed");

  // 与 remediation fixtures 的 P113_FINDING 对齐（integrator 裁决 2026-09-07：findingId 统一，保留 delta 分类/风险/免 material）。
  const finding = { ...buildP112DeltaFinding(), findingId: P113_FINDING };
  const findingReceipt = await h.recordArchitectureFinding(buildRecordArchitectureFindingCommand({ ...finding } as import("../../src/contracts/architecture-inspection.js").ArchitectureFindingV1, { commandId: "p113-cmd-finding" }));
  expect(findingReceipt.status).toBe("committed");

  // 受理真实计划：返工任务与它的 canonical Evidence 必须挂在同一份生效计划上，
  // 否则 resolved 只能靠自报，这正是本流程要排除的证明方式。
  const plan = await p113ApplyPlan(h, { commandId: "p113-cmd-apply-plan" });

  const patch = buildP113PlanPatchV1();
  const patchReceipt = await h.submitRemediationPlanPatch(buildP113SubmitPatchCommand(patch, { commandId: "p113-cmd-patch" }));
  expect(patchReceipt.status).toBe("committed");

  const task = buildP113TaskV1("pending");
  const taskReceipt = await h.createRemediationTask(buildP113CreateTaskCommand(p113PatchRef(), { commandId: "p113-cmd-task" }));
  expect(taskReceipt.status).toBe("committed");

  const adv1 = await h.advanceRemediationTask(buildP113AdvanceTaskCommand(P113_TASK, 1, { status: "writing" }, { commandId: "p113-cmd-adv-1" }));
  expect(adv1.status).toBe("committed");
  const adv2 = await h.advanceRemediationTask(buildP113AdvanceTaskCommand(P113_TASK, 2, { status: "verifying" }, { commandId: "p113-cmd-adv-2" }));
  expect(adv2.status).toBe("committed");
  // 先在 canonical 账本受理返工后的 PASS 证据（workspaceRevision 2 = 补丁所在版本），
  // 再据此把任务推进到 resolved。
  const evidenceRef = await p113SubmitVerificationEvidence(h, plan, { evidenceId: "p113-evidence-1", commandId: "p113-cmd-evidence", workspaceRevision: 2 });
  const adv3 = await h.advanceRemediationTask(buildP113AdvanceTaskCommand(P113_TASK, 3, { status: "resolved", evidenceRefs: [evidenceRef], result: { workspaceRevisionAfter: 2, verified: true, outcome: "PASS" } }, { commandId: "p113-cmd-adv-3" }));
  expect(adv3.status).toBe("committed");

  return { install, activate, finding, patch, patchReceipt, task, taskReceipt, advance1: adv1, advance2: adv2, advance3: adv3 };
}

export function p113PatchRefFor(): ReturnType<typeof p113PatchRef> {
  return p113PatchRef();
}
export function p113FindingRefFor(): ReturnType<typeof p113FindingRef> {
  return p113FindingRef();
}
export function p113DedupKeyFor() {
  return p113DedupKey();
}
export { P113_PROJECT, P113_WORKSPACE, P113_FINDING, P113_TASK, buildP112ReportFinding };
