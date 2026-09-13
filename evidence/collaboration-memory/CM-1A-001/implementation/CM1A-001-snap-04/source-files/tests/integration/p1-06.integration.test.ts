/**
 * P1-06 real-SQLite full-path integration (no fakes): A crash -> packet ->
 * B replacement -> driveHandoff -> restart equivalence + provenance rebuilt.
 * AUTO-SKIPS until the P1-06 handlers/projections are implemented (probe).
 */
import { describe, it, expect } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { isP106Ready, runP106Path, verifyP106AfterRestart } from "../restart/p1-06-restart-fixtures.js";

const READY = await isP106Ready();

describe.skipIf(!READY)("P1-06 real SQLite integration", () => {
  it("full handoff path + restart equivalence", async () => {
    const h = await createPersistentSqliteHarness({ deps: {} });
    try {
      const before = await runP106Path(h);
      expect(before.bRun).not.toBeNull();
      await h.close();
      const restarted = await h.reopen({ readModelFile: "readmodel-rebuilt.sqlite" });
      try {
        await verifyP106AfterRestart(restarted, before);
      } finally {
        await restarted.close();
      }
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  }, 90_000);
});
