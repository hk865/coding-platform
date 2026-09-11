import { ControlPolicyExplanation } from '../../src/control/control-engine/policy-explanation.js';
/**
 * P1-05 SQLite goal-phase projection tests (persistent adapter) — the same
 * semantics as the InMemory suite against the SQLite read model, including
 * rebuild-from-fresh-file equivalence.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { createSqliteReadModelIndex } from "../../src/data/read-model-index/sqlite-read-model-index.js";
import { makeCommitCursor } from "../../src/contracts/ledger.js";
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
      // not_found ONLY with atLeastCursor provided and covered (frozen contract):
      const observed = h.observedCursor()!;
      const missingCovered = await h.goalStatus({ projectId: sc.projectId, goalId: "goal-missing-105", atLeastCursor: observed });
      expect(missingCovered.status).toBe("not_found");
      // without atLeastCursor the contract forbids not_found — freshness-safe not_ready:
      const missing = await h.goalStatus({ projectId: sc.projectId, goalId: "goal-missing-105" });
      expect(missing.status).toBe("not_ready");
      const before = (await h.ledger.events({ afterCursor: null, limit: 500 })).events.length;
      await h.goalStatus({ projectId: sc.projectId, goalId: sc.goalId });
      await h.goalTimeline({ projectId: sc.projectId, goalId: sc.goalId });
      const after = (await h.ledger.events({ afterCursor: null, limit: 500 })).events.length;
      expect(after).toBe(before);
    } finally {
      await hp.cleanup().catch(() => undefined);
    }
  }, 90_000);

  it("full-scope isolation: two Projects share the same goalId without colliding", async () => {
    const dir = await mkdtemp(join(tmpdir(), "p105-iso-"));
    const path = join(dir, "iso.sqlite");
    const idx = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path });
    try {
      await idx.advance({
        afterCursor: null, throughCursor: makeCommitCursor(2),
        events: [
          { cursor: makeCommitCursor(1), event: phaseEvent("proj-alpha", "goal-105", "ev-isol-a", "RUNNING") },
          { cursor: makeCommitCursor(2), event: phaseEvent("proj-beta", "goal-105", "ev-isol-b", "COMPLETED") },
        ],
        hasMore: false,
      });
      const a = await idx.goalStatus({ projectId: "proj-alpha", goalId: "goal-105" });
      const b = await idx.goalStatus({ projectId: "proj-beta", goalId: "goal-105" });
      expect(a.status).toBe("ready");
      expect(b.status).toBe("ready");
      if (a.status === "ready") { expect(a.goal.phase).toBe("RUNNING"); expect(a.goal.projectId).toBe("proj-alpha"); }
      if (b.status === "ready") { expect(b.goal.phase).toBe("COMPLETED"); expect(b.goal.projectId).toBe("proj-beta"); }
      const ta = await idx.goalTimeline({ projectId: "proj-alpha", goalId: "goal-105" });
      const tb = await idx.goalTimeline({ projectId: "proj-beta", goalId: "goal-105" });
      if (ta.status === "ready") expect(ta.timeline).toHaveLength(1);
      if (tb.status === "ready") expect(tb.timeline).toHaveLength(1);
      const cross = await idx.goalStatus({ projectId: "proj-alpha", goalId: "goal-105", atLeastCursor: makeCommitCursor(2) });
      expect(cross.status).toBe("ready");
      if (cross.status === "ready") expect(cross.goal.phase).toBe("RUNNING");
    } finally {
      await idx.close();
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }, 90_000);
});

/** Deterministic GoalPhaseUpdated event for direct-stream projection tests. */
function phaseEvent(projectId: string, goalId: string, eventId: string, phase: "RUNNING" | "COMPLETED"): import("../../src/contracts/goal-phase.js").GoalPhaseUpdatedEvent {
  return {
    eventId,
    eventType: "GoalPhaseUpdated" as const,
    schemaVersion: 1,
    projectId,
    workspaceId: "ws-shared",
    aggregateType: "GoalPhase",
    aggregateId: goalId,
    aggregateRevision: 1,
    causationId: "cmd-" + eventId,
    correlationId: "corr-" + eventId,
    idempotencyKey: "idem-" + eventId,
    actor: { kind: "system", id: "control-engine" },
    occurredAt: "2026-09-05T12:00:00.000Z",
    payload: {
      goalId,
      previousPhase: null,
      phase,
      reasonCodes: (phase === "COMPLETED" ? ["completion_guard_ok"] : ["required_frontier_available"]) as import("../../src/contracts/goal-phase.js").GoalPhaseReasonCode[],
      explanation: {
        schemaVersion: 1,
        phase,
        headline: "goal " + goalId + " phase = " + phase,
        items: [{ code: (phase === "COMPLETED" ? "completion_guard_ok" : "required_frontier_available") as import("../../src/contracts/goal-phase.js").GoalPhaseReasonCode, message: phase === "COMPLETED" ? "guard holds" : "frontier", refs: {} }],
      },
      sideEffectReconciliation: { identified: [], unreconciled: [] },
      planRef: null,
      reducedAt: "2026-09-05T12:00:00.000Z",
    },
  };
}
