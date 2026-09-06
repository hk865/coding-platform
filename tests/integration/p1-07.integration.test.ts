/**
 * P1-07 real-SQLite full-path integration (no fakes): parallel readers ->
 * join -> single writer -> patch record -> goal gate -> restart equivalence.
 * AUTO-SKIPS until the P1-07 handlers/projections are implemented (probe).
 */
import { describe, it, expect } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { isP107Ready, runP107RestartScenario, verifyP107AfterRestart } from "../restart/p1-07-restart-fixtures.js";

const READY = await isP107Ready();

describe.skipIf(!READY)("P1-07 real SQLite integration", () => {
  it("full parallel-readers + single-writer path + restart equivalence", async () => {
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
