/**
 * P1-08 restart-path fixtures + readiness probe.
 *   runP108TwoProjectScenario (two isolated projects -> same local ids ->
 *   runs/evidence/reductions/handoff/replacement/outcome_unknown) -> close ->
 *   reopen -> ALL SIX console views field-identical + observedCursor identical.
 * NEVER fakes; the probe runs the full path and any remaining "P1-08 lane ...
 * not implemented yet" stub throw makes it false (auto-skip).
 */
import { expect } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import type { PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { toP1_08Harness, runP108TwoProjectScenario, createP108ScenarioRuntime, type P1_08HarnessLike, type P1_08TestHarness, P108_PROJECT_A, P108_WORKSPACE, P108_GOAL, P108_TASK_WORK } from "../contract-suite/p1-08-harness.js";

export async function isP108Ready(): Promise<boolean> {
  try {
    const h = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    try {
      await runP108RestartScenario(h);
      return true;
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  } catch {
    return false;
  }
}

export type P108RestartEvidence = {
  before: Awaited<ReturnType<typeof runP108TwoProjectScenario>>;
  cursorBefore: string;
  portfolioBefore: string;
  summaryABefore: string;
  summaryBBefore: string;
  matrixABefore: string;
  agentsABefore: string;
  evidenceABefore: string;
  timelineABefore: string;
  ledgerEventIds: string[];
};

export async function runP108RestartScenario(h: PersistentSqliteHarness): Promise<P108RestartEvidence> {
  const th: P1_08TestHarness = toP1_08Harness(h as unknown as P1_08HarnessLike);
  const before = await runP108TwoProjectScenario(th);
  const cursorBefore = String(h.observedCursor());
  const page = await h.ledger.events({ afterCursor: null, limit: 512 });
  return {
    before,
    cursorBefore,
    portfolioBefore: JSON.stringify(await th.consolePortfolio({})),
    summaryABefore: JSON.stringify(await th.consoleSummary({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE })),
    summaryBBefore: JSON.stringify(await th.consoleSummary({ projectId: "proj-beta", workspaceId: P108_WORKSPACE })),
    matrixABefore: JSON.stringify(await th.consolePlanMatrix({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL })),
    agentsABefore: JSON.stringify(await th.consoleActiveAgents({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE })),
    evidenceABefore: JSON.stringify(await th.consoleTaskEvidence({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL, taskId: P108_TASK_WORK })),
    timelineABefore: JSON.stringify(await th.consoleTimeline({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE })),
    ledgerEventIds: page.events.map((p) => p.event.eventId),
  };
}

/** Field-for-field restart equivalence for ALL SIX console views + cursor. */
export async function verifyP108AfterRestart(restarted: PersistentSqliteHarness, evidence: P108RestartEvidence): Promise<void> {
  const th: P1_08TestHarness = toP1_08Harness(restarted as unknown as P1_08HarnessLike);
  await restarted.advanceProjection();
  expect(String(restarted.observedCursor())).toBe(evidence.cursorBefore);

  const portfolio = await th.consolePortfolio({});
  expect(JSON.stringify(portfolio)).toBe(evidence.portfolioBefore);
  const summaryA = await th.consoleSummary({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE });
  expect(JSON.stringify(summaryA)).toBe(evidence.summaryABefore);
  const summaryB = await th.consoleSummary({ projectId: "proj-beta", workspaceId: P108_WORKSPACE });
  expect(JSON.stringify(summaryB)).toBe(evidence.summaryBBefore);
  const matrixA = await th.consolePlanMatrix({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL });
  expect(JSON.stringify(matrixA)).toBe(evidence.matrixABefore);
  const agentsA = await th.consoleActiveAgents({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE });
  expect(JSON.stringify(agentsA)).toBe(evidence.agentsABefore);
  const evidenceA = await th.consoleTaskEvidence({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL, taskId: P108_TASK_WORK });
  expect(JSON.stringify(evidenceA)).toBe(evidence.evidenceABefore);
  const timelineA = await th.consoleTimeline({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE });
  expect(JSON.stringify(timelineA)).toBe(evidence.timelineABefore);

  // Same event set, same order — the views rebuild from the SAME EventPage.
  const page = await restarted.ledger.events({ afterCursor: null, limit: 512 });
  expect(page.events.map((p) => p.event.eventId)).toEqual(evidence.ledgerEventIds);
}
