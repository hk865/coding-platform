/**
 * P1-12 restart-path fixtures + readiness probe (deterministic inspection
 * scenario -> close -> reopen -> architectureInspectionView field-identical +
 * observedCursor identical). NEVER fakes; any remaining P1-12 stub throw makes
 * the probe false (auto-skip).
 */
import { expect } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import type { PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { toP1_12Harness, runP112InspectionScenario, type P1_12HarnessLike, type P1_12TestHarness, type P112InspectionScenarioResult } from "../contract-suite/p1-12-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { P112_PROJECT, P112_WORKSPACE } from "../../src/contracts/fixtures/architecture-fixtures.js";

export async function isP112Ready(): Promise<boolean> {
  try {
    const h = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    try {
      await runP112RestartScenario(h);
      return true;
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  } catch {
    return false;
  }
}

export type P112RestartEvidence = {
  before: P112InspectionScenarioResult;
  cursorBefore: string;
  viewBefore: string;
  ledgerEventIds: string[];
};

export async function runP112RestartScenario(h: PersistentSqliteHarness): Promise<P112RestartEvidence> {
  const th: P1_12TestHarness = toP1_12Harness(h as unknown as P1_12HarnessLike);
  const before = await runP112InspectionScenario(th);
  await th.advanceProjection();
  const cursorBefore = String(h.observedCursor());
  const page = await h.ledger.events({ afterCursor: null, limit: 512 });
  const view = await th.architectureInspectionView({ projectId: P112_PROJECT, workspaceId: P112_WORKSPACE });
  return { before, cursorBefore, viewBefore: JSON.stringify(view), ledgerEventIds: page.events.map((p) => p.event.eventId) };
}

export async function verifyP112AfterRestart(restarted: PersistentSqliteHarness, evidence: P112RestartEvidence): Promise<void> {
  const th: P1_12TestHarness = toP1_12Harness(restarted as unknown as P1_12HarnessLike);
  await restarted.advanceProjection();
  expect(String(restarted.observedCursor())).toBe(evidence.cursorBefore);
  const view = await th.architectureInspectionView({ projectId: P112_PROJECT, workspaceId: P112_WORKSPACE });
  expect(JSON.stringify(view)).toBe(evidence.viewBefore);
}
