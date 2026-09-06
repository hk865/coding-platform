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
} from "../../src/contracts/fixtures/architecture-evolution-policy-fixtures.js";
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
} from "../../src/contracts/fixtures/remediation-fixtures.js";
import { buildP112DeltaFinding, buildP112ReportFinding, buildRecordArchitectureFindingCommand } from "../../src/contracts/fixtures/architecture-fixtures.js";
import { P112_FINDING_DELTA } from "../../src/contracts/fixtures/architecture-fixtures.js";

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
  const adv3 = await h.advanceRemediationTask(buildP113AdvanceTaskCommand(P113_TASK, 3, { status: "resolved", evidenceRefs: [{ aggregateType: "Evidence" as const, projectId: P113_PROJECT, evidenceId: "p113-evidence-1" }], result: { workspaceRevisionAfter: 2, verified: true, outcome: "PASS" } }, { commandId: "p113-cmd-adv-3" }));
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
