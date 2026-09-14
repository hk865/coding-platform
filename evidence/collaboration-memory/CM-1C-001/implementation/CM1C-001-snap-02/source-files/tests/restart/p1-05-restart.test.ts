/**
 * P1-05 restart path — GoalPhase snapshot + goalStatus/goalTimeline rebuilt
 * from the persisted ledger after close/reopen (no fakes).
 */
import { describe, expect, it } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { isP105Ready, runP105Path, verifyP105AfterRestart } from "./p1-05-restart-fixtures.js";

const READY = await isP105Ready();

describe.skipIf(!READY)("P1-05 persistent restart path", () => {
  it("restart: GoalPhase snapshot + goalStatus/goalTimeline field-identical", async () => {
    const h = await createPersistentSqliteHarness({ deps: {} });
    try {
      const before = await runP105Path(h);
      expect(before.goalPhase.phase).toBe("COMPLETED");
      expect(before.eventTypes).toContain("GoalPhaseUpdated");

      await h.close();
      const restarted = await h.reopen({ readModelFile: "readmodel-rebuilt.sqlite" });
      try {
        await verifyP105AfterRestart(restarted, before);
      } finally {
        await restarted.close();
      }
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  }, 90_000);
});
