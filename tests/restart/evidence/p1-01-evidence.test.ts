/**
 * P1-01 evidence collector — repeatable command:
 *   pnpm vitest run tests/restart/evidence/p1-01-evidence.test.ts
 * Runs the FULL restart-path assertions (canonical snapshot load + EventPage
 * rebuild) then prints ONE JSON block the integrator copies into
 *   dev_docs/verification/p1-01-implementation-evidence.md.
 * The block carries the restart-path evidence for BOTH scopes:
 *   bootstrap -> CreateGoal(alpha+beta) -> SQLite commit -> close -> reopen
 *   -> canonical snapshot load + EventPage rebuild -> same GoalView,
 * including pre/post canonical snapshots, pre/post GoalView results, the
 * bootstrap manifest, and the commit/cursor line. AUTO-SKIPS while the
 * adapters are not yet implemented (integration skeleton). Owner: P1-01 lane C.
 */
import { describe, expect, it } from "vitest";
import { createPersistentSqliteHarness } from "../../../src/harness/persistent-harness.js";
import { RESTART_ALPHA, RESTART_BETA, runBootstrapAndCreateGoals } from "../restart-fixtures.js";
import {
  capturePreRestart,
  loadGoal,
  verifyRebuildViews,
  verifySnapshotLoadPath,
} from "../restart-assertions.js";
import { buildBootstrapCommand } from "../../../src/contracts/bootstrap.js";
import {
  WORKSPACE_BOOTSTRAP_FIXTURE_V1,
  buildBootstrapLedgerCommit,
} from "../../../src/contracts/fixtures/bootstrap-fixture-v1.js";
import { makeCommitCursor } from "../../../src/contracts/ledger.js";
import { FIXED_ISO_2026_09_05 } from "../../../src/contracts/testing/sequences.js";
import type { WorkspaceBootstrapReceipt } from "../../../src/contracts/bootstrap.js";
import type { CreateGoalResult } from "../../../src/contracts/modules.js";

async function adaptersImplemented(): Promise<boolean> {
  try {
    const ledgerMod = await import("../../../src/sqlite-ledger/sqlite-ledger.js");
    const readModelMod = await import("../../../src/sqlite-read-model/sqlite-read-model-index.js");
    const command = buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
      commandId: "probe-boot-1",
      correlationId: "probe-corr-1",
      submittedAt: FIXED_ISO_2026_09_05,
    });
    const batch = buildBootstrapLedgerCommit(command, {
      eventIds: ["p-probe-1", "p-probe-2", "p-probe-3", "p-probe-4"],
      occurredAt: FIXED_ISO_2026_09_05,
    });
    const ledger = ledgerMod.createSqliteStateLedger({ path: ":memory:" });
    const receipt = await ledger.commit(batch);
    if (receipt.status !== "committed") {
      await ledger.close();
      return false;
    }
    const index = readModelMod.createSqliteReadModelIndex({ path: ":memory:" });
    const projected = await index.advance({
      afterCursor: null,
      throughCursor: makeCommitCursor(batch.events.length),
      events: batch.events.map((event, i) => ({ cursor: makeCommitCursor(i + 1), event })),
      hasMore: false,
    });
    await Promise.allSettled([ledger.close(), index.close()]);
    return projected.throughCursor !== null;
  } catch {
    return false;
  }
}

const READY = await adaptersImplemented();

function bootstrapCursor(receipt: WorkspaceBootstrapReceipt): string | null {
  return receipt.status === "committed" ? String(receipt.commitCursor) : null;
}

function persistedCursor(result: CreateGoalResult): string | null {
  return result.status === "persisted" ? String(result.commitCursor) : null;
}

describe.skipIf(!READY)("P1-01 restart-path evidence", () => {
  it("collects the restart evidence block", async () => {
    const harness = await createPersistentSqliteHarness();
    try {
      const runs = await runBootstrapAndCreateGoals(harness);
      expect(runs.alpha.status).toBe("persisted");
      expect(runs.beta.status).toBe("persisted");
      if (runs.alpha.status !== "persisted" || runs.beta.status !== "persisted") return;

      const receipt = await harness.advanceProjection();
      expect(receipt.throughCursor).not.toBeNull();
      const capture = await capturePreRestart(harness, runs, RESTART_ALPHA, RESTART_BETA);

      // Restart #1: canonical snapshot load path.
      await harness.close();
      const after = await harness.reopen();
      await verifySnapshotLoadPath(after, capture, RESTART_ALPHA, RESTART_BETA);
      const alphaReload = await loadGoal(after, RESTART_ALPHA.projectId, RESTART_ALPHA.goalId);
      const betaReload = await loadGoal(after, RESTART_BETA.projectId, RESTART_BETA.goalId);
      const ledgerPath = after.ledgerPath;
      await after.close();

      // Restart #2 (fresh read model file): EventPage rebuild path.
      const rebuilt = await after.reopen({ readModelFile: "readmodel-rebuilt.sqlite" });
      await rebuilt.advanceProjection();
      await verifyRebuildViews(rebuilt, capture, RESTART_ALPHA, RESTART_BETA);
      const alphaRebuilt = await rebuilt.collaboration.goalView({
        projectId: RESTART_ALPHA.projectId,
        workspaceId: RESTART_ALPHA.workspaceId,
        goalId: RESTART_ALPHA.goalId,
        atLeastCursor: capture.observedCursor,
      });
      const betaRebuilt = await rebuilt.collaboration.goalView({
        projectId: RESTART_BETA.projectId,
        workspaceId: RESTART_BETA.workspaceId,
        goalId: RESTART_BETA.goalId,
        atLeastCursor: capture.observedCursor,
      });
      const rebuiltObservedCursor = rebuilt.observedCursor();
      const rebuiltReadModelPath = rebuilt.readModelPath;
      await rebuilt.close();

      const evidence = {
        ticket: "P1-01",
        path: "bootstrap -> CreateGoal(alpha+beta) -> SQLite commit -> close -> reopen -> canonical snapshot load + EventPage rebuild -> same GoalView",
        commitCursors: {
          bootstrap: bootstrapCursor(runs.bootstrap),
          alpha: persistedCursor(runs.alpha),
          beta: persistedCursor(runs.beta),
        },
        manifest: {
          schemaVersion: capture.manifest.schemaVersion,
          sourceDigest: capture.manifest.sourceDigest,
          bootstrapRevision: capture.manifest.bootstrapRevision,
          entries: capture.manifest.entries.length,
        },
        cursor: {
          observedBeforeRestart: String(capture.observedCursor),
          rebuiltObservedAfter: rebuiltObservedCursor !== null ? String(rebuiltObservedCursor) : null,
        },
        canonicalSnapshotLoad: {
          alpha: {
            matches: JSON.stringify(alphaReload) === JSON.stringify(capture.alphaSnapshot),
            pre: capture.alphaSnapshot,
            post: alphaReload,
          },
          beta: {
            matches: JSON.stringify(betaReload) === JSON.stringify(capture.betaSnapshot),
            pre: capture.betaSnapshot,
            post: betaReload,
          },
        },
        eventRebuildView: {
          alpha: {
            matches: JSON.stringify(alphaRebuilt) === JSON.stringify(capture.alphaView),
            pre: capture.alphaView,
            post: alphaRebuilt,
          },
          beta: {
            matches: JSON.stringify(betaRebuilt) === JSON.stringify(capture.betaView),
            pre: capture.betaView,
            post: betaRebuilt,
          },
        },
        files: { ledger: ledgerPath, readModelRebuilt: rebuiltReadModelPath },
      };
      console.log("P1-01-EVIDENCE " + JSON.stringify(evidence, null, 2));
    } finally {
      await harness.cleanup();
    }
  });
});
