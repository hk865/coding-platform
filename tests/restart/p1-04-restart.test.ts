/**
 * P1-04 restart path — evidence + bindings + reduction + verification view
 * rebuilt from the persisted ledger after close/reopen (no fakes).
 * Readiness probe: only runs when the P1-04 handlers/projections land.
 */
import { describe, expect, it } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { isP104Ready, runP104Path, verifyP104AfterRestart } from "./p1-04-restart-fixtures.js";

const READY = await isP104Ready();

describe.skipIf(!READY)("P1-04 persistent restart path", () => {
  it("restart: Evidence/Index/TaskReduction snapshots + taskVerification view identical", async () => {
    const h = await createPersistentSqliteHarness({ deps: {} });
    try {
      const before = await runP104Path(h);
      expect(before.verification?.reduction?.phase).toBe("satisfied");
      expect(before.eventTypes).toContain("EvidenceAdmitted");
      expect(before.eventTypes).toContain("TaskReductionUpdated");

      await h.close();
      const restarted = await h.reopen({ readModelFile: "readmodel-rebuilt.sqlite" });
      try {
        await verifyP104AfterRestart(restarted, before);
      } finally {
        await restarted.close();
      }
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  }, 60_000);
});
