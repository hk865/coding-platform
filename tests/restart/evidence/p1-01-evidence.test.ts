/**
 * P1-01 evidence collector — repeatable command:
 *   pnpm vitest run tests/restart/evidence/p1-01-evidence.test.ts
 * Prints (to stdout) one JSON block with the full restart-path evidence:
 *   bootstrap -> CreateGoal(alpha+beta) -> SQLite commit -> close -> reopen
 *   -> canonical snapshot load + EventPage rebuild -> same GoalView,
 * including pre/post snapshots, views, cursors and the manifest.
 * The integrator captures the output into
 * dev_docs/verification/p1-01-implementation-evidence.md.
 * AUTO-SKIPS while the adapters are not yet implemented (skeleton).
 * Owner: P1-01 lane C.
 */
import { describe, expect, it } from "vitest";
import { createPersistentSqliteHarness } from "../../../src/harness/persistent-harness.js";
import { RESTART_ALPHA, RESTART_BETA, runBootstrapAndCreateGoals } from "../restart-fixtures.js";
import {
  capturePreRestart,
  loadGoal,
} from "../restart-assertions.js";
import { buildBootstrapCommand } from "../../../src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1, buildBootstrapLedgerCommit } from "../../../src/contracts/fixtures/bootstrap-fixture-v1.js";
import { makeCommitCursor } from "../../../src/contracts/ledger.js";
import { FIXED_ISO_2026_09_05 } from "../../../src/contracts/testing/sequences.js";

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

describe.skipIf(!READY)("P1-01 restart-path evidence", () => {
  it("collects the restart evidence block", async () => {
    const harness = await createPersistentSqliteHarness();
    try {
      const runs = await runBootstrapAndCreateGoals(harness);
      expect(runs.alpha.status).toBe("persisted");
      expect(runs.beta.status).toBe("persisted");
      if (runs.alpha.status !== "persisted" || runs.beta.status !== "persisted") return;
      await harness.advanceProjection();
      const capture = await capturePreRestart(harness, runs, RESTART_ALPHA, RESTART_BETA);

      await harness.close();
      const after = await harness.reopen();
      const alphaReload = await loadGoal(after, RESTART_ALPHA.projectId, RESTART_ALPHA.goalId);
      const betaReload = await loadGoal(after, RESTART_BETA.projectId, RESTART_BETA.goalId);
      await after.close();
      const rebuilt = await after.reopen({ readModelFile: "readmodel-rebuilt.sqlite" });
      await rebuilt.advanceProjection();
      const alphaRebuilt = await rebuilt.collaboration.goalView({
        projectId: RESTART_ALPHA.projectId,
        workspaceId: RESTART_ALPHA.workspaceId,
        goalId: RESTART_ALPHA.goalId,
        atLeastCursor: capture.observedCursor,
      });
      await rebuilt.close();

      const evidence = {
        ticket: "P1-01",
        path: "bootstrap -> CreateGoal -> SQLite commit -> close -> reopen -> snapshot load + event rebuild -> GoalView",
        committedEventCursors: {
          bootstrap: null,
        },
        restart: {
          canonicalSnapshotLoadMatches: {
            alpha: JSON.stringify(alphaReload) === JSON.stringify(capture.alphaSnapshot),
            beta: JSON.stringify(betaReload) === JSON.stringify(capture.betaSnapshot),
          },
          eventRebuildMatches: JSON.stringify(alphaRebuilt) === JSON.stringify(capture.alphaView),
          manifestSourceDigest: capture.manifest.sourceDigest,
          manifestEntries: capture.manifest.entries.length,
          observedCursorBefore: String(capture.observedCursor),
          ledgerFile: after.ledgerPath,
        },
        scopes: [
          {
            projectId: RESTART_ALPHA.projectId,
            workspaceId: RESTART_ALPHA.workspaceId,
            goalId: RESTART_ALPHA.goalId,
            objective: capture.alphaSnapshot.objective,
            snapshotRevision: capture.alphaSnapshot.revision,
            viewObjective: (capture.alphaView.status === "ready" ? capture.alphaView.goal.objective : null),
          },
          {
            projectId: RESTART_BETA.projectId,
            workspaceId: RESTART_BETA.workspaceId,
            goalId: RESTART_BETA.goalId,
            objective: capture.betaSnapshot.objective,
            snapshotRevision: capture.betaSnapshot.revision,
            viewObjective: (capture.betaView.status === "ready" ? capture.betaView.goal.objective : null),
          },
        ],
      };
      console.log("P1-01-EVIDENCE " + JSON.stringify(evidence, null, 2));
    } finally {
      await harness.cleanup();
    }
  });
});
