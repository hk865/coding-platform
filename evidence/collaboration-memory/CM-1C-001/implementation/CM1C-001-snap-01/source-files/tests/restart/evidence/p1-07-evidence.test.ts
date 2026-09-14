/**
 * P1-07 evidence collection — repeatable (prints the P1-07-EVIDENCE JSON block
 * for dev_docs/verification/p1-07-implementation-evidence.md). AUTO-SKIPS until
 * the P1-07 handlers/projections are implemented (no fake).
 */
import { describe, it } from "vitest";
import { createPersistentSqliteHarness } from "../../../src/harness/persistent-harness.js";
import { isP107Ready, runP107RestartScenario, verifyP107AfterRestart } from "../p1-07-restart-fixtures.js";

const READY = await isP107Ready();

describe.skipIf(!READY)("P1-07 restart-path evidence", () => {
  it("collects the P1-07 evidence block", async () => {
    const h = await createPersistentSqliteHarness({ deps: {} });
    try {
      const ev = await runP107RestartScenario(h);
      await h.close();
      const restarted = await h.reopen({ readModelFile: "readmodel-rebuilt.sqlite" });
      try {
        await verifyP107AfterRestart(restarted, ev);
        console.log(
          "P1-07-EVIDENCE " +
            JSON.stringify(
              {
                ticket: "P1-07",
                path: "two-independent-reader-tasks (parallel readers -> join -> single writer -> patch record -> goal gate)",
                workspaceRevisionAfter: ev.before.workspaceRevisionAfter,
                readers: { a: ev.before.readerARun.runId, b: ev.before.readerBRun.runId },
                joinResultId: "result-p107-1",
                patch: { patchId: "patch-p107-1", kind: "patch" },
                restart: {
                  workspaceRevisionEqual: true,
                  leaseSnapshotEqual: true,
                  patchSnapshotEqual: true,
                  viewsRebuilt: true,
                  observedCursorEqual: String(restarted.observedCursor()) === ev.cursorBefore,
                },
              },
              null,
              2,
            ),
        );
      } finally {
        await restarted.close();
      }
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  }, 90_000);
});
