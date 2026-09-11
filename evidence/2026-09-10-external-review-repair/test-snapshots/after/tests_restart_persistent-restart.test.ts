import { ControlPolicyExplanation } from '../../src/control/policy-explanation.js';
import { classifyRestartProbeError } from './readiness-probe.js';
/**
 * P1-01 integration skeleton (may be temporarily red while lanes A/B land):
 *   bootstrap -> CreateGoal -> Sqlite ledger.commit -> close -> reopen ->
 *   (a) canonical GoalSnapshot load, (b) EventPage rebuild -> same GoalView.
 * AUTO-SKIPS while the adapters still throw "not implemented" (the real
 * acceptance run happens after lanes A/B are merged; the final integration
 * also runs tests/integration/p1-01.integration.test.ts with real adapters).
 * Owner: P1-01 lane C (skeleton by integrator, 2026-09-05).
 */
import { describe, expect, it } from "vitest";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import {
  WORKSPACE_BOOTSTRAP_FIXTURE_V1,
  buildBootstrapLedgerCommit,
} from "../../src/contracts/fixtures/bootstrap-fixture-v1.js";
import { makeCommitCursor } from "../../src/contracts/ledger.js";
import { FIXED_ISO_2026_09_05 } from "../../src/contracts/testing/sequences.js";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import {
  RESTART_ALPHA,
  RESTART_BETA,
  runBootstrapAndCreateGoals,
} from "./restart-fixtures.js";
import {
  capturePreRestart,
  verifyRebuildViews,
  verifySnapshotLoadPath,
} from "./restart-assertions.js";

async function adaptersImplemented(): Promise<boolean> {
  try {
    const ledgerMod = await import("../../src/sqlite-ledger/sqlite-ledger.js");
    const readModelMod = await import("../../src/sqlite-read-model/sqlite-read-model-index.js");
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
    // A non-committed bootstrap through the real adapter is a regression, not a
    // missing capability; let it fail instead of skipping the suite.
    if (receipt.status !== "committed") throw new Error("P1-01 probe: bootstrap commit was not committed: " + JSON.stringify(receipt));
    const index = readModelMod.createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path: ":memory:" });
    const page = {
      afterCursor: null,
      throughCursor: makeCommitCursor(batch.events.length),
      events: batch.events.map((event, i) => ({ cursor: makeCommitCursor(i + 1), event })),
      hasMore: false,
    };
    const projected = await index.advance(page);
    await Promise.allSettled([ledger.close(), index.close()]);
    return projected.throughCursor !== null;
  } catch (error) {
    return classifyRestartProbeError(error);
  }
}

const READY = await adaptersImplemented();

describe.skipIf(!READY)("P1-01 restart paths — real SQLite adapters", () => {
  it(
    "bootstrap -> CreateGoal -> commit -> close -> reopen -> snapshot load + event rebuild -> same GoalView",
    async () => {
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
        await after.close();

        // Restart #2 (fresh read model file): EventPage rebuild path.
        const rebuilt = await after.reopen({ readModelFile: "readmodel-rebuilt.sqlite" });
        await rebuilt.advanceProjection();
        await verifyRebuildViews(rebuilt, capture, RESTART_ALPHA, RESTART_BETA);
        await rebuilt.close();
      } finally {
        await harness.cleanup();
      }
    },
  );
});
