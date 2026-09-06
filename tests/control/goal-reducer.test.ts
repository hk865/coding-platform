/**
 * P1-05 Control entry tests — goal-reducer.goalReduce full behavior
 * (real modules, InMemory harness; the adapter contract suite re-runs the same
 * semantics against SQLite via defineGoalReductionContractSuite).
 */
import { describe, expect, it } from "vitest";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import {
  prepareP105Scenario,
  satisfyEverythingP105,
  reduceGoalCommand,
  toP1_05Harness,
  type P1_05TestHarness,
} from "../contract-suite/p1-05-harness.js";
import { goalPhaseRefFor } from "../../src/contracts/goal-phase.js";

const SCHEMA = "2026-09-05T12:00:00.000Z";

async function makeHarness(): Promise<P1_05TestHarness> {
  const h = createInMemoryHarness({ deps: {} });
  return toP1_05Harness(h);
}

describe("P1-05 goal reducer (Control)", () => {
  it("no active plan -> PLANNING (never COMPLETED on an empty plan)", async () => {
    const h = await makeHarness();
    const sc = await prepareP105Scenario(h);
    const goal = await h.submit({
      commandId: "cmd-p105r-noplan",
      commandType: "CreateGoal",
      schemaVersion: 1,
      identity: { projectId: sc.projectId, actor: { kind: "human", id: "user-1" }, idempotencyKey: "p105r-noplan" },
      aggregateId: "goal-noplan-105",
      expectedRevision: 0,
      correlationId: "corr-p105r-noplan",
      submittedAt: SCHEMA,
      payload: { workspaceId: "ws-shared", objective: "no plan" },
    });
    expect(goal.status).toBe("committed");
    await h.advanceProjection();
    const receipt = await h.reduceGoal(reduceGoalCommand(sc, {
      commandId: "cmd-p105r-noplan-r", expectedRevision: 0, idempotencyKey: "p105r-noplan-r", goalId: "goal-noplan-105",
    }));
    expect(receipt.status).toBe("committed");
    if (receipt.status !== "committed") return;
    expect(receipt.phase).toBe("PLANNING");
    expect(receipt.reasonCodes).toContain("no_active_plan_planning_available");
  });

  it("plan applied, everything pending -> RUNNING (required frontier available)", async () => {
    const h = await makeHarness();
    const sc = await prepareP105Scenario(h);
    await h.advanceProjection();
    const receipt = await h.reduceGoal(reduceGoalCommand(sc, { commandId: "cmd-p105r-run", expectedRevision: 0, idempotencyKey: "p105r-run" }));
    expect(receipt.status).toBe("committed");
    if (receipt.status !== "committed") return;
    expect(receipt.phase).toBe("RUNNING");
    expect(receipt.reasonCodes).toContain("required_frontier_available");
    expect(receipt.reasonCodes.some((c) => c.startsWith("guard_"))).toBe(true);
  });

  it("full required satisfaction -> COMPLETED + snapshot/explanation + optional ignored", async () => {
    const h = await makeHarness();
    const sc = await prepareP105Scenario(h);
    await satisfyEverythingP105(h, sc);
    await h.advanceProjection();
    const receipt = await h.reduceGoal(reduceGoalCommand(sc, { commandId: "cmd-p105r-done", expectedRevision: 0, idempotencyKey: "p105r-done" }));
    expect(receipt.status).toBe("committed");
    if (receipt.status !== "committed") return;
    expect(receipt.phase).toBe("COMPLETED");
    expect(receipt.reasonCodes).toContain("completion_guard_ok");
    expect(receipt.reasonCodes).toContain("optional_task_not_satisfied");
    const load = await h.ledger.load(goalPhaseRefFor(sc.projectId, sc.goalId));
    expect(load.status).toBe("found");
    if (load.status === "found") {
      const snap = load.snapshot as { phase: string; reasonCodes: string[]; explanation: { phase: string; headline: string } };
      expect(snap.phase).toBe("COMPLETED");
      expect(snap.explanation.phase).toBe("COMPLETED");
      expect(snap.explanation.headline).toContain("COMPLETED");
      expect(snap.reasonCodes).toEqual(receipt.reasonCodes);
    }
  });

  it("same facts + unreconciled outcome_unknown -> NEEDS_DECISION (contrast with COMPLETED)", async () => {
    const h = await makeHarness();
    const sc = await prepareP105Scenario(h);
    await satisfyEverythingP105(h, sc, { withUnknownSideEffect: true });
    await h.advanceProjection();
    const receipt = await h.reduceGoal(reduceGoalCommand(sc, { commandId: "cmd-p105r-se", expectedRevision: 0, idempotencyKey: "p105r-se" }));
    expect(receipt.status).toBe("committed");
    if (receipt.status !== "committed") return;
    expect(receipt.phase).toBe("NEEDS_DECISION");
    expect(receipt.reasonCodes).toContain("unknown_side_effect_needs_decision");
    expect(receipt.reasonCodes).not.toContain("completion_guard_ok");
  });

  it("full idempotency + CAS + zero-write rejections", async () => {
    const h = await makeHarness();
    const sc = await prepareP105Scenario(h);
    await satisfyEverythingP105(h, sc);
    await h.advanceProjection();
    const first = await h.reduceGoal(reduceGoalCommand(sc, { commandId: "cmd-p105r-idem", expectedRevision: 0, idempotencyKey: "p105r-idem" }));
    expect(first.status).toBe("committed");
    if (first.status !== "committed") return;
    const before = (await h.ledger.events({ afterCursor: null, limit: 500 })).events.length;
    const replay = await h.reduceGoal(reduceGoalCommand(sc, { commandId: "cmd-p105r-idem", expectedRevision: 0, idempotencyKey: "p105r-idem" }));
    expect(replay.status).toBe("committed");
    if (replay.status === "committed") expect(replay.replayed).toBe(true);
    const conflict = await h.reduceGoal(reduceGoalCommand(sc, { commandId: "cmd-p105r-idem", expectedRevision: 1, idempotencyKey: "p105r-idem" }));
    expect(conflict.status).toBe("rejected");
    if (conflict.status === "rejected") expect(conflict.code).toBe("idempotency_conflict");
    const stale = await h.reduceGoal(reduceGoalCommand(sc, { commandId: "cmd-p105r-stale", expectedRevision: 0, idempotencyKey: "p105r-stale" }));
    expect(stale.status).toBe("rejected");
    if (stale.status === "rejected") expect(stale.code).toBe("revision_conflict");
    const invalid = await h.reduceGoal({ ...reduceGoalCommand(sc, { commandId: "cmd-p105r-inv", expectedRevision: 0, idempotencyKey: "p105r-inv" }), commandType: "ReduceGoalX" as never });
    expect(invalid.status).toBe("rejected");
    if (invalid.status === "rejected") expect(invalid.code).toBe("invalid");
    const nf = await h.reduceGoal({ ...reduceGoalCommand(sc, { commandId: "cmd-p105r-nf", expectedRevision: 0, idempotencyKey: "p105r-nf" }), aggregateId: "goal-missing-105", payload: { goalId: "goal-missing-105" } });
    expect(nf.status).toBe("rejected");
    if (nf.status === "rejected") expect(nf.code).toBe("not_found");
    const after = (await h.ledger.events({ afterCursor: null, limit: 500 })).events.length;
    expect(after).toBe(before);
  });

  it("determinism: re-reduction over the same facts -> identical phase + reason codes + explanation", async () => {
    const h = await makeHarness();
    const sc = await prepareP105Scenario(h);
    await satisfyEverythingP105(h, sc);
    await h.advanceProjection();
    const first = await h.reduceGoal(reduceGoalCommand(sc, { commandId: "cmd-p105r-det1", expectedRevision: 0, idempotencyKey: "p105r-det1" }));
    expect(first.status).toBe("committed");
    if (first.status !== "committed") return;
    const second = await h.reduceGoal(reduceGoalCommand(sc, { commandId: "cmd-p105r-det2", expectedRevision: 1, idempotencyKey: "p105r-det2" }));
    expect(second.status).toBe("committed");
    if (second.status !== "committed") return;
    expect(second.phase).toBe(first.phase);
    expect(JSON.stringify(second.reasonCodes)).toBe(JSON.stringify(first.reasonCodes));
    const load = await h.ledger.load(goalPhaseRefFor(sc.projectId, sc.goalId));
    expect(load.status).toBe("found");
    if (load.status === "found") {
      const snap = load.snapshot as { revision: number; explanation: unknown; phase: string };
      expect(snap.revision).toBe(2);
      expect(snap.explanation).toBeTruthy();
    }
  });
});
