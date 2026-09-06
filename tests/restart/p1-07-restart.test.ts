/**
 * P1-07 restart equivalence (real SQLite, no fakes): full path -> close ->
 * reopen -> lease/index/patch/Workspace snapshots + the three P1-07 views
 * field-for-field identical + observedCursor identical.
 * AUTO-SKIPS until the P1-07 handlers/projections are implemented (probe).
 */
import { describe, it, expect } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { isP107Ready, runP107RestartScenario, verifyP107AfterRestart } from "./p1-07-restart-fixtures.js";

const READY = await isP107Ready();

describe.skipIf(!READY)("P1-07 restart", () => {
  it("snapshots + rebuilt views + cursor identical after close/reopen", async () => {
    const h = await createPersistentSqliteHarness({ deps: {} });
    try {
      const evidence = await runP107RestartScenario(h);
      expect(evidence.before.workspaceRevisionAfter).toBeGreaterThan(1);
      await h.close();
      const restarted = await h.reopen({ readModelFile: "readmodel-rebuilt.sqlite" });
      try {
        await verifyP107AfterRestart(restarted, evidence);
      } finally {
        await restarted.close();
      }
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  }, 90_000);
});
