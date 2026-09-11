import { classifyRestartProbeError } from "./readiness-probe.js";
/** P1-15 restart fixtures + probe (compact). */
import { expect } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import type { PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { runP115Scenario, type P115HarnessLike, type P115ScenarioResult } from "../contract-suite/p1-15-harness.js";
import { P115_PROJECT, P115_WORKSPACE } from "../contract-suite/p1-15-harness.js";

export async function isP115Ready(): Promise<boolean> {
  try {
    const h = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    try { await runP115RestartScenario(h); return true; } finally { await h.cleanup().catch(() => undefined); }
  } catch (error) {
    return classifyRestartProbeError(error);
  }
}

export type P115RestartEvidence = { proposalDigest: string; policyActive: string };
export async function runP115RestartScenario(h: PersistentSqliteHarness): Promise<P115RestartEvidence> {
  const scen: P115ScenarioResult = await runP115Scenario(h as unknown as P115HarnessLike);
  const active = await h.ledger.load({ aggregateType: "ProjectCoordinationPolicyActive", projectId: P115_PROJECT });
  expect(active.status).toBe("found");
  return { proposalDigest: scen.decision.authorizedTarget.proposalDigest, policyActive: active.status === "found" ? JSON.stringify((active.snapshot as { activeRevision: unknown }).activeRevision) : "?" };
}
export async function verifyP115AfterRestart(restarted: PersistentSqliteHarness, evidence: P115RestartEvidence): Promise<void> {
  const active = await restarted.ledger.load({ aggregateType: "ProjectCoordinationPolicyActive", projectId: P115_PROJECT });
  expect(active.status).toBe("found");
  if (active.status === "found") expect(JSON.stringify((active.snapshot as { activeRevision: unknown }).activeRevision)).toBe(evidence.policyActive);
}