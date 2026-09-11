import { classifyRestartProbeError } from "./readiness-probe.js";
/** P1-13 restart-path fixtures + readiness probe. */
import { expect } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import type { PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { toP1_13Harness, runP113Scenario, type P1_13HarnessLike, type P1_13TestHarness, type P113ScenarioResult } from "../contract-suite/p1-13-harness.js";
import { P113_PROJECT, P113_TASK, P113_FINDING } from "../contract-suite/p1-13-harness.js";

export async function isP113Ready(): Promise<boolean> {
  try {
    const h = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    try {
      await runP113RestartScenario(h);
      return true;
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  } catch (error) {
    return classifyRestartProbeError(error);
  }
}

export type P113RestartEvidence = {
  cursorBefore: string;
  policyRefBefore: string;
  taskStatusBefore: string;
  activationBefore: string;
};

export async function runP113RestartScenario(h: PersistentSqliteHarness): Promise<P113RestartEvidence> {
  const th: P1_13TestHarness = toP1_13Harness(h as unknown as P1_13HarnessLike);
  const scen: P113ScenarioResult = await runP113Scenario(th);
  const policy = await h.ledger.load({ aggregateType: "ArchitectureEvolutionPolicyRevision", projectId: P113_PROJECT, policyId: "evolution-policy-1", revision: 1 });
  expect(policy.status).toBe("found");
  const active = await h.ledger.load({ aggregateType: "ProjectArchitectureEvolutionPolicyActive", projectId: P113_PROJECT });
  expect(active.status).toBe("found");
  const task = await h.ledger.load({ aggregateType: "RemediationTask", projectId: P113_PROJECT, workspaceId: scen.task.workspaceId, taskId: P113_TASK });
  expect(task.status).toBe("found");
  return {
    cursorBefore: String(h.observedCursor() ?? "?"),
    policyRefBefore: JSON.stringify(policy.status === "found" ? (policy.snapshot as { contentDigest: string }).contentDigest : "?"),
    taskStatusBefore: task.status === "found" ? String((task.snapshot as { task: { status: string } }).task.status) : "?",
    activationBefore: JSON.stringify(active.status === "found" ? (active.snapshot as { activeRevision: unknown }).activeRevision : "?"),
  };
}

export async function verifyP113AfterRestart(restarted: PersistentSqliteHarness, evidence: P113RestartEvidence): Promise<void> {
  const policy = await restarted.ledger.load({ aggregateType: "ArchitectureEvolutionPolicyRevision", projectId: P113_PROJECT, policyId: "evolution-policy-1", revision: 1 });
  expect(policy.status).toBe("found");
  if (policy.status === "found") expect(JSON.stringify((policy.snapshot as { contentDigest: string }).contentDigest)).toBe(evidence.policyRefBefore);
  const task = await restarted.ledger.load({ aggregateType: "RemediationTask", projectId: P113_PROJECT, workspaceId: "ws-shared", taskId: P113_TASK });
  expect(task.status).toBe("found");
  if (task.status === "found") expect(String((task.snapshot as { task: { status: string } }).task.status)).toBe(evidence.taskStatusBefore);
}
