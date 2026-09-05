/**
 * P1-03 restart path — owned by lane D.
 *   bootstrap -> governance -> CreateGoal -> applyPlan -> claim -> start ->
 *   FakeRuntime facts -> commit -> close -> reopen -> canonical outbox/lease/
 *   Attempt/Run identical + ActiveAgents/TaskDetail rebuilt from persisted
 *   EventPages field-for-field identical (no fakes).
 * Readiness probe: only runs when the P1-03 handlers + projections land
 * (any remaining "P1-03: ... not implemented yet" stub throw -> SKIP).
 */
import { describe, expect, it } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { isP103Ready, runP103Path, verifyP103AfterRestart } from "./p1-03-restart-fixtures.js";

const READY = await isP103Ready();

describe.skipIf(!READY)("P1-03 persistent restart path", () => {
  it("restart: outbox/lease/Attempt/Run snapshots + ActiveAgents/TaskDetail identical", async () => {
    const h = await createPersistentSqliteHarness({ deps: {} });
    try {
      const before = await runP103Path(h);
      expect(before.agent?.run.outcome).toBe("completed");
      expect(before.detail?.run?.outcome).toBe("completed");
      expect(before.run.task).toEqual({ projectId: "proj-alpha", goalId: "goal-1", taskId: "task-run-adaptor" });

      await h.close();
      const restarted = await h.reopen({ readModelFile: "readmodel-rebuilt.sqlite" });
      try {
        await verifyP103AfterRestart(restarted, before);
        expect(restarted.observedCursor()).toEqual(before.observedCursor);
      } finally {
        await restarted.close();
      }
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  }, 30_000);
});
