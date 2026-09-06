/**
 * P1-05 InMemory goal-phase projection tests — GoalPhaseUpdated -> goalStatus /
 * goalTimeline (rebuild equivalence, full-key isolation, freshness, dedupe).
 * Never treats the projection as a reducer input (asserts only read queries).
 */
import { describe, expect, it } from "vitest";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { ReadModelIndexImpl } from "../../src/read-model/read-model-index.js";
import {
  prepareP105Scenario,
  satisfyEverythingP105,
  reduceGoalCommand,
  toP1_05Harness,
  type P1_05TestHarness,
} from "../contract-suite/p1-05-harness.js";
import type { GoalStatusView, GoalTimelineEntry } from "../../src/contracts/goal-phase-view.js";
import { makeCommitCursor } from "../../src/contracts/ledger.js";

function json(v: unknown): string {
  return JSON.stringify(v);
}

describe("P1-05 InMemory goal-phase projection", () => {
  it("GoalPhaseUpdated projects goalStatus + timeline (RUNNING -> COMPLETED, ordered, previousPhase)", async () => {
    const h = toP1_05Harness(createInMemoryHarness({ deps: {} }));
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
      expect(status2.goal.explanation.items.length).toBe(status2.goal.reasonCodes.length);
    }
    const timeline = await h.goalTimeline({ projectId: sc.projectId, goalId: sc.goalId });
    expect(timeline.status).toBe("ready");
    if (timeline.status === "ready") {
      expect(timeline.timeline).toHaveLength(2);
      expect(timeline.timeline[0]!.phase).toBe("RUNNING");
      expect(timeline.timeline[0]!.previousPhase).toBeNull();
      expect(timeline.timeline[1]!.phase).toBe("COMPLETED");
      expect(timeline.timeline[1]!.previousPhase).toBe("RUNNING");
    }
  });

  it("rebuild equivalence: incremental vs fresh-index replay field-for-field", async () => {
    const h = toP1_05Harness(createInMemoryHarness({ deps: {} }));
    const sc = await prepareP105Scenario(h);
    await satisfyEverythingP105(h, sc);
    const receipt = await h.reduceGoal(reduceGoalCommand(sc, { commandId: "cmd-prj-rebuild", expectedRevision: 0, idempotencyKey: "prj-rebuild" }));
    expect(receipt.status).toBe("committed");
    if (receipt.status !== "committed") return;
    await h.advanceProjection();
    const before = await h.goalStatus({ projectId: sc.projectId, goalId: sc.goalId });
    expect(before.status).toBe("ready");

    const fresh = new ReadModelIndexImpl();
    let cursor = null;
    for (;;) {
      const page = await h.ledger.events({ afterCursor: cursor, limit: 64 });
      if (page.events.length === 0) break;
      await fresh.advance(page);
      cursor = page.throughCursor;
      if (!page.hasMore) break;
    }
    const rebuilt = await fresh.goalStatus({ projectId: sc.projectId, goalId: sc.goalId });
    expect(rebuilt.status).toBe("ready");
    if (rebuilt.status === "ready") expect(json(rebuilt.goal)).toBe(json((before as { goal: GoalStatusView }).goal));
    const rebuiltTimeline = await fresh.goalTimeline({ projectId: sc.projectId, goalId: sc.goalId });
    expect(rebuiltTimeline.status).toBe("ready");
    if (rebuiltTimeline.status === "ready") expect(rebuiltTimeline.timeline).toHaveLength(1);
  });

  it("full-key isolation + not_found only after coverage; duplicate events never duplicate the timeline", async () => {
    const h = toP1_05Harness(createInMemoryHarness({ deps: {} }));
    const sc = await prepareP105Scenario(h);
    await satisfyEverythingP105(h, sc);
    const receipt = await h.reduceGoal(reduceGoalCommand(sc, { commandId: "cmd-prj-iso", expectedRevision: 0, idempotencyKey: "prj-iso" }));
    expect(receipt.status).toBe("committed");
    if (receipt.status !== "committed") return;

    // not projected yet -> not_ready (never not_found before coverage)
    const notReady = await h.goalStatus({ projectId: sc.projectId, goalId: sc.goalId, atLeastCursor: receipt.commitCursor });
    expect(notReady.status).toBe("not_ready");
    await h.advanceProjection();
    // not_found ONLY with atLeastCursor provided and covered (frozen contract):
    const observed = h.observedCursor()!;
    const missingCovered = await h.goalStatus({ projectId: sc.projectId, goalId: "goal-missing-105", atLeastCursor: observed });
    expect(missingCovered.status).toBe("not_found");
    const missingTlCovered = await h.goalTimeline({ projectId: sc.projectId, goalId: "goal-missing-105", atLeastCursor: observed });
    expect(missingTlCovered.status).toBe("not_found");
    // without atLeastCursor the contract forbids not_found — freshness-safe not_ready:
    const missing = await h.goalStatus({ projectId: sc.projectId, goalId: "goal-missing-105" });
    expect(missing.status).toBe("not_ready");
    const missingTl = await h.goalTimeline({ projectId: sc.projectId, goalId: "goal-missing-105" });
    expect(missingTl.status).toBe("not_ready");

    // replay the SAME event page into a fresh index: dedupe -> timeline unchanged
    const fresh = new ReadModelIndexImpl();
    const page = await h.ledger.events({ afterCursor: null, limit: 500 });
    await fresh.advance(page);
    const first = await fresh.goalTimeline({ projectId: sc.projectId, goalId: sc.goalId });
    expect(first.status).toBe("ready");
    await fresh.advance(page); // full replay of the same page
    const second = await fresh.goalTimeline({ projectId: sc.projectId, goalId: sc.goalId });
    if (second.status === "ready" && first.status === "ready") expect(json(second.timeline)).toBe(json(first.timeline));
  });

  it("projection never writes canonical state (read-only queries)", async () => {
    const h = toP1_05Harness(createInMemoryHarness({ deps: {} }));
    const sc = await prepareP105Scenario(h);
    await satisfyEverythingP105(h, sc);
    await h.reduceGoal(reduceGoalCommand(sc, { commandId: "cmd-prj-ro", expectedRevision: 0, idempotencyKey: "prj-ro" }));
    await h.advanceProjection();
    const before = (await h.ledger.events({ afterCursor: null, limit: 500 })).events.length;
    await h.goalStatus({ projectId: sc.projectId, goalId: sc.goalId });
    await h.goalTimeline({ projectId: sc.projectId, goalId: sc.goalId });
    const after = (await h.ledger.events({ afterCursor: null, limit: 500 })).events.length;
    expect(after).toBe(before);
  });

  it("full-scope isolation: two Projects share the same goalId without colliding", async () => {
    const fresh = new ReadModelIndexImpl();
    await fresh.advance({
      afterCursor: null, throughCursor: makeCommitCursor(2),
      events: [
        { cursor: makeCommitCursor(1), event: phaseEvent("proj-alpha", "goal-105", "ev-isol-a", "RUNNING") },
        { cursor: makeCommitCursor(2), event: phaseEvent("proj-beta", "goal-105", "ev-isol-b", "COMPLETED") },
      ],
      hasMore: false,
    });
    const a = await fresh.goalStatus({ projectId: "proj-alpha", goalId: "goal-105" });
    const b = await fresh.goalStatus({ projectId: "proj-beta", goalId: "goal-105" });
    expect(a.status).toBe("ready");
    expect(b.status).toBe("ready");
    if (a.status === "ready") { expect(a.goal.phase).toBe("RUNNING"); expect(a.goal.projectId).toBe("proj-alpha"); }
    if (b.status === "ready") { expect(b.goal.phase).toBe("COMPLETED"); expect(b.goal.projectId).toBe("proj-beta"); }
    const ta = await fresh.goalTimeline({ projectId: "proj-alpha", goalId: "goal-105" });
    const tb = await fresh.goalTimeline({ projectId: "proj-beta", goalId: "goal-105" });
    if (ta.status === "ready") expect(ta.timeline).toHaveLength(1);
    if (tb.status === "ready") expect(tb.timeline).toHaveLength(1);
    // cross query: beta's key never leaks into alpha's row
    const cross = await fresh.goalStatus({ projectId: "proj-alpha", goalId: "goal-105", atLeastCursor: makeCommitCursor(2) });
    expect(cross.status).toBe("ready");
    if (cross.status === "ready") expect(cross.goal.phase).toBe("RUNNING");
  });
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
