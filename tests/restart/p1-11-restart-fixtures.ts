import { classifyRestartProbeError } from "./readiness-probe.js";
/** P1-11 restart-path fixtures + readiness probe. */
import { expect } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import type { PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { toP1_11Harness, runP111ChangeScenario, planChangeViewQueryFor, type P1_11HarnessLike, type P1_11TestHarness, type P111ChangeScenarioResult } from "../contract-suite/p1-11-harness.js";
import { P111_PROJECT, P111_GOAL } from "../contract-suite/p1-11-harness.js";

export async function isP111Ready(): Promise<boolean> {
  try {
    const h = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    try {
      await runP111RestartScenario(h);
      return true;
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  } catch (error) {
    return classifyRestartProbeError(error);
  }
}

export type P111RestartEvidence = {
  cursorBefore: string;
  viewBefore: string;
  goalRevisionBefore: string;
  proposalCountBefore: number;
  decisionCountBefore: number;
};

export async function runP111RestartScenario(h: PersistentSqliteHarness): Promise<P111RestartEvidence> {
  const th: P1_11TestHarness = toP1_11Harness(h as unknown as P1_11HarnessLike);
  const scen: P111ChangeScenarioResult = await runP111ChangeScenario(th);
  await th.advanceProjection();
  const cursorBefore = String(h.observedCursor());
  const view = await th.planChangeView(planChangeViewQueryFor(P111_PROJECT));
  expect(view.status).toBe("ready");
  const goal = await h.ledger.load({ aggregateType: "Goal", projectId: P111_PROJECT, goalId: P111_GOAL });
  expect(goal.status).toBe("found");
  return {
    cursorBefore,
    viewBefore: JSON.stringify(view),
    goalRevisionBefore: goal.status === "found" ? String((goal.snapshot as { revision: number }).revision) : "?",
    proposalCountBefore: view.status === "ready" ? view.proposals.length : 0,
    decisionCountBefore: view.status === "ready" ? view.decisions.length : 0,
  };
}

export async function verifyP111AfterRestart(restarted: PersistentSqliteHarness, evidence: P111RestartEvidence): Promise<void> {
  const th: P1_11TestHarness = toP1_11Harness(restarted as unknown as P1_11HarnessLike);
  await restarted.advanceProjection();
  expect(String(restarted.observedCursor())).toBe(evidence.cursorBefore);
  const view = await th.planChangeView(planChangeViewQueryFor(P111_PROJECT));
  expect(JSON.stringify(view)).toBe(evidence.viewBefore);
  const goal = await restarted.ledger.load({ aggregateType: "Goal", projectId: P111_PROJECT, goalId: P111_GOAL });
  expect(goal.status).toBe("found");
  if (goal.status === "found") expect(String((goal.snapshot as { revision: number }).revision)).toBe(evidence.goalRevisionBefore);
}
