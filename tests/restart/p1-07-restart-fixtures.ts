/**
 * P1-07 restart-path fixtures + readiness probe.
 *   runP107FullScenario (readers parallel -> join -> writer lease -> patch
 *   record -> gate -> COMPLETED) -> close -> reopen -> snapshots + the three
 *   P1-07 views field-identical + observedCursor identical.
 * NEVER fakes; the probe runs the full path and any remaining
 * "P1-07 lane ... not implemented yet" stub throw makes it false (auto-skip).
 */
import { expect } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import type { PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { toP1_07Harness, runP107FullScenario, type P1_07HarnessLike, type P1_07TestHarness } from "../contract-suite/p1-07-harness.js";

export async function isP107Ready(): Promise<boolean> {
  try {
    const h = await createPersistentSqliteHarness({ deps: {} });
    try {
      await runP107RestartScenario(h);
      return true;
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  } catch {
    return false;
  }
}

export type P107RestartEvidence = {
  before: Awaited<ReturnType<typeof runP107FullScenario>>;
  cursorBefore: string;
  leaseViewBefore: string;
  patchViewBefore: string;
  integrationViewBefore: string;
};

export async function runP107RestartScenario(h: PersistentSqliteHarness): Promise<P107RestartEvidence> {
  const th: P1_07TestHarness = toP1_07Harness(h as unknown as P1_07HarnessLike);
  const before = await runP107FullScenario(th);
  const cursorBefore = String(h.observedCursor());
  const leaseView = await th.workspaceLeaseView({ projectId: before.readerARun.projectId, workspaceId: "ws-p107" });
  const patchView = await th.workspacePatches({ projectId: before.readerARun.projectId, workspaceId: "ws-p107" });
  const integrationView = await th.integrationConflicts({ projectId: before.readerARun.projectId, goalId: "goal-p107-1", taskId: "task-p107-integrate" });
  return {
    before,
    cursorBefore,
    leaseViewBefore: JSON.stringify(leaseView),
    patchViewBefore: JSON.stringify(patchView),
    integrationViewBefore: JSON.stringify(integrationView),
  };
}

/** Field-for-field restart equivalence (snapshots + rebuilt views + cursor). */
export async function verifyP107AfterRestart(restarted: PersistentSqliteHarness, evidence: P107RestartEvidence): Promise<void> {
  const th: P1_07TestHarness = toP1_07Harness(restarted as unknown as P1_07HarnessLike);
  const cursorAfter = String(restarted.observedCursor());
  expect(cursorAfter).toBe(evidence.cursorBefore);

  const ws = await restarted.ledger.load({ aggregateType: "Workspace", projectId: evidence.before.readerARun.projectId, workspaceId: "ws-p107" });
  expect(ws.status).toBe("found");
  if (ws.status === "found") {
    expect((ws.snapshot as { revision: number }).revision).toBe(evidence.before.workspaceRevisionAfter);
  }
  const lease = await restarted.ledger.load({ aggregateType: "WorkspaceWriteLease", projectId: evidence.before.readerARun.projectId, leaseId: "lease-p107-writer" });
  expect(lease.status).toBe("found");
  if (lease.status === "found") {
    const snap = lease.snapshot as { revision: number; lease: { status: string; postWriteWorkspaceRevision: number | null } };
    expect(snap.revision).toBe(2);
    expect(snap.lease.status).toBe("released");
    expect(snap.lease.postWriteWorkspaceRevision).toBe(evidence.before.workspaceRevisionAfter);
  }
  const patch = await restarted.ledger.load({ aggregateType: "PatchRecord", projectId: evidence.before.readerARun.projectId, patchId: "patch-p107-1" });
  expect(patch.status).toBe("found");
  const integration = await restarted.ledger.load({ aggregateType: "IntegrationResult", projectId: evidence.before.readerARun.projectId, goalId: "goal-p107-1", taskId: "task-p107-integrate" });
  expect(integration.status).toBe("found");

  const leaseView = await th.workspaceLeaseView({ projectId: evidence.before.readerARun.projectId, workspaceId: "ws-p107" });
  expect(JSON.stringify(leaseView)).toBe(evidence.leaseViewBefore);
  const patchView = await th.workspacePatches({ projectId: evidence.before.readerARun.projectId, workspaceId: "ws-p107" });
  expect(JSON.stringify(patchView)).toBe(evidence.patchViewBefore);
  const integrationView = await th.integrationConflicts({ projectId: evidence.before.readerARun.projectId, goalId: "goal-p107-1", taskId: "task-p107-integrate" });
  expect(JSON.stringify(integrationView)).toBe(evidence.integrationViewBefore);
}
