/**
 * P1-05 SQLite goal-phase projection tests (persistent adapter) — the same
 * semantics as the InMemory suite against the SQLite read model, including
 * rebuild-from-fresh-file equivalence.
 */
import { describe, expect, it } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import {
  prepareP105Scenario,
  satisfyEverythingP105,
  reduceGoalCommand,
  toP1_05Harness,
  type P1_05TestHarness,
} from "../contract-suite/p1-05-harness.js";

function json(v: unknown): string {
  return JSON.stringify(v);
}

async function freshSqlite() {
  const hp = await createPersistentSqliteHarness({ deps: {} });
  return { hp, h: toP1_05Harness(hp) };
}

describe("P1-05 SQLite goal-phase projection", () => {
  it("GoalPhaseUpdated projects goalStatus + timeline (RUNNING -> COMPLETED, ordered)", async () => {
    const { hp, h } = await freshSqlite();
    try {
      const sc = await prepareP105Scenario(h);
      await h.advanceProjection();
      const first = await h.reduceGoal(reduceGoalCommand(sc, { commandId: "cmd-prj-run", expectedRevision: 0, idempotencyKey: "prj-run" }));
      expect(first.status).toBe("committed");
      if (first.status !== "committed") return;
      await h.advanceProjection();
      const status1 = await h.goalStatus({ projectId: sc.projectId, goalId: sc.goalId });
      expect(status1.status).toBe("ready");
      if (status1.status === "ready") expect(status1.goal.phase).toBe("RUNNING");

      await satisfyEverythingP105(h, sc);
      const second = await h.reduceGoal(reduceGoalCommand(sc, { commandId: "cmd-prj-done", expectedRevision: 1, idempotencyKey: "prj-done" }));
      expect(second.status).toBe("committed");
      if (second.status !== "committed") return;
      await h.advanceProjection();
      const status2 = await h.goalStatus({ projectId: sc.projectId, goalId: sc.goalId });
      expect(status2.status).toBe("ready");
      if (status2.status === "ready") {
        expect(status2.goal.phase).toBe("COMPLETED");
        expect(status2.goal.previousPhase).toBe("RUNNING");
        expect(status2.goal.aggregateRevision).toBe(2);
      }
      const timeline = await h.goalTimeline({ projectId: sc.projectId, goalId: sc.goalId });
      expect(timeline.status).toBe("ready");
      if (timeline.status === "ready") {
        expect(timeline.timeline).toHaveLength(2);
        expect(timeline.timeline[0]!.phase).toBe("RUNNING");
        expect(timeline.timeline[1]!.phase).toBe("COMPLETED");
      }
    } finally {
      await hp.cleanup().catch(() => undefined);
    }
  }, 90_000);

  it("rebuild equivalence: same ledger + FRESH read-model file -> field-for-field views", async () => {
    const { hp, h } = await freshSqlite();
    try {
      const sc = await prepareP105Scenario(h);
      await satisfyEverythingP105(h, sc);
      const receipt = await h.reduceGoal(reduceGoalCommand(sc, { commandId: "cmd-prj-rebuild", expectedRevision: 0, idempotencyKey: "prj-rebuild" }));
      expect(receipt.status).toBe("committed");
      if (receipt.status !== "committed") return;
      await h.advanceProjection();
      const before = await h.goalStatus({ projectId: sc.projectId, goalId: sc.goalId });
      expect(before.status).toBe("ready");
      if (before.status !== "ready") return;
      const beforeTimeline = await h.goalTimeline({ projectId: sc.projectId, goalId: sc.goalId });
      expect(beforeTimeline.status).toBe("ready");

      // NEW read model file on the SAME ledger — EventPages replay from scratch.
      const rebuilt = await createPersistentSqliteHarness({
        dir: hp.dir, ledgerFile: "ledger.sqlite", readModelFile: "readmodel-rebuilt-p105.sqlite", deps: {},
      });
      try {
        await rebuilt.advanceProjection();
        const status = await rebuilt.readModel.goalStatus({ projectId: sc.projectId, goalId: sc.goalId });
        expect(status.status).toBe("ready");
        if (status.status === "ready") expect(json(status.goal)).toBe(json(before.goal));
        const timeline = await rebuilt.readModel.goalTimeline({ projectId: sc.projectId, goalId: sc.goalId });
        expect(timeline.status).toBe("ready");
        if (timeline.status === "ready" && beforeTimeline.status === "ready") {
          expect(json(timeline.timeline)).toBe(json(beforeTimeline.timeline));
        }
      } finally {
        await rebuilt.cleanup().catch(() => undefined);
      }
    } finally {
      await hp.cleanup().catch(() => undefined);
    }
  }, 90_000);

  it("full-key isolation + not_found only after coverage + read-only", async () => {
    const { hp, h } = await freshSqlite();
    try {
      const sc = await prepareP105Scenario(h);
      await satisfyEverythingP105(h, sc);
      const receipt = await h.reduceGoal(reduceGoalCommand(sc, { commandId: "cmd-prj-iso", expectedRevision: 0, idempotencyKey: "prj-iso" }));
      expect(receipt.status).toBe("committed");
      if (receipt.status !== "committed") return;
      const notReady = await h.goalStatus({ projectId: sc.projectId, goalId: sc.goalId, atLeastCursor: receipt.commitCursor });
      expect(notReady.status).toBe("not_ready");
      await h.advanceProjection();
      const missing = await h.goalStatus({ projectId: sc.projectId, goalId: "goal-missing-105" });
      expect(missing.status).toBe("not_found");
      const before = (await h.ledger.events({ afterCursor: null, limit: 500 })).events.length;
      await h.goalStatus({ projectId: sc.projectId, goalId: sc.goalId });
      await h.goalTimeline({ projectId: sc.projectId, goalId: sc.goalId });
      const after = (await h.ledger.events({ afterCursor: null, limit: 500 })).events.length;
      expect(after).toBe(before);
    } finally {
      await hp.cleanup().catch(() => undefined);
    }
  }, 90_000);
});
