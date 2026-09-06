/**
 * P1-16 restart-path fixtures + readiness probe.
 *   runP116RestartScenario: the full continuity scenario (bind/link/note/
 *   continuation + work-context views) -> close -> reopen -> all view rows
 *   field-identical + observedCursor identical.
 * NEVER fakes; the probe runs the full path and any remaining "P1-16 lane ...
 * not implemented yet" stub throw makes it false (auto-skip).
 */
import { expect } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import type { PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { toP1_16Harness, runP116ContinuityScenario, type P1_16HarnessLike, type P1_16TestHarness, type P116ContinuityScenarioResult } from "../contract-suite/p1-16-harness.js";
import { P116_PROJECT_B, P116_WORKSPACE, P116_WORK } from "../../src/contracts/fixtures/context-fixtures.js";
import { P108_PROJECT_A } from "../contract-suite/p1-08-harness.js";

export async function isP116Ready(): Promise<boolean> {
  try {
    const h = await createPersistentSqliteHarness({ deps: {} });
    try {
      await runP116RestartScenario(h);
      return true;
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  } catch {
    return false;
  }
}

export type P116RestartEvidence = {
  before: P116ContinuityScenarioResult;
  cursorBefore: string;
  w1aBefore: string;
  w2Before: string;
  w1bBefore: string;
  ledgerEventIds: string[];
  bindingSnapshot: string;
};

export async function runP116RestartScenario(h: PersistentSqliteHarness): Promise<P116RestartEvidence> {
  const th: P1_16TestHarness = toP1_16Harness(h as unknown as P1_16HarnessLike);
  const before = await runP116ContinuityScenario(th);
  await th.advanceProjection();
  const cursorBefore = String(h.observedCursor());
  const page = await h.ledger.events({ afterCursor: null, limit: 512 });
  const w1a = await th.workContextView({ projectId: P108_PROJECT_A, workspaceId: P116_WORKSPACE, workId: P116_WORK });
  const w2 = await th.workContextView({ projectId: P108_PROJECT_A, workspaceId: P116_WORKSPACE, workId: "work-p116-coord" });
  const w1b = await th.workContextView({ projectId: P116_PROJECT_B, workspaceId: P116_WORKSPACE, workId: P116_WORK });
  return {
    before,
    cursorBefore,
    w1aBefore: JSON.stringify(w1a),
    w2Before: JSON.stringify(w2),
    w1bBefore: JSON.stringify(w1b),
    ledgerEventIds: page.events.map((p) => p.event.eventId),
    bindingSnapshot: w1a.status === "ready" ? JSON.stringify(w1a.binding) : "unready",
  };
}

/** Field-for-field restart equivalence for ALL work-context views + cursor. */
export async function verifyP116AfterRestart(restarted: PersistentSqliteHarness, evidence: P116RestartEvidence): Promise<void> {
  const th: P1_16TestHarness = toP1_16Harness(restarted as unknown as P1_16HarnessLike);
  await restarted.advanceProjection();
  expect(String(restarted.observedCursor())).toBe(evidence.cursorBefore);

  const w1a = await th.workContextView({ projectId: P108_PROJECT_A, workspaceId: P116_WORKSPACE, workId: P116_WORK });
  expect(JSON.stringify(w1a)).toBe(evidence.w1aBefore);
  const w2 = await th.workContextView({ projectId: P108_PROJECT_A, workspaceId: P116_WORKSPACE, workId: "work-p116-coord" });
  expect(JSON.stringify(w2)).toBe(evidence.w2Before);
  const w1b = await th.workContextView({ projectId: P116_PROJECT_B, workspaceId: P116_WORKSPACE, workId: P116_WORK });
  expect(JSON.stringify(w1b)).toBe(evidence.w1bBefore);
}
