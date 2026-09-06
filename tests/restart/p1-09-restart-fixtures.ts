/** P1-09 restart-path fixtures + readiness probe. */
import { expect } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import type { PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { toP1_09Harness, runP109QueryScenario, type P1_09HarnessLike, type P1_09TestHarness, type P109QueryScenarioResult } from "../contract-suite/p1-09-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { P109_PROJECT, P109_WORKSPACE, P109_QUERY } from "../../src/contracts/fixtures/query-job-fixtures.js";

export async function isP109Ready(): Promise<boolean> {
  try {
    const h = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    try {
      await runP109RestartScenario(h);
      return true;
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  } catch {
    return false;
  }
}

export type P109RestartEvidence = { before: P109QueryScenarioResult; cursorBefore: string; viewBefore: string };

export async function runP109RestartScenario(h: PersistentSqliteHarness): Promise<P109RestartEvidence> {
  const th: P1_09TestHarness = toP1_09Harness(h as unknown as P1_09HarnessLike);
  const before = await runP109QueryScenario(th);
  await th.advanceProjection();
  const cursorBefore = String(h.observedCursor());
  const viewBefore = JSON.stringify(await th.queryJobView({ projectId: P109_PROJECT, workspaceId: P109_WORKSPACE, queryJobId: P109_QUERY }));
  return { before, cursorBefore, viewBefore };
}

export async function verifyP109AfterRestart(restarted: PersistentSqliteHarness, evidence: P109RestartEvidence): Promise<void> {
  const th: P1_09TestHarness = toP1_09Harness(restarted as unknown as P1_09HarnessLike);
  await restarted.advanceProjection();
  expect(String(restarted.observedCursor())).toBe(evidence.cursorBefore);
  const view = await th.queryJobView({ projectId: P109_PROJECT, workspaceId: P109_WORKSPACE, queryJobId: P109_QUERY });
  expect(JSON.stringify(view)).toBe(evidence.viewBefore);
}
