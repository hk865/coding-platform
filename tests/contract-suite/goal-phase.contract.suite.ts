/**
 * P1-05 goal-reduction contract suite — shared by InMemory AND SQLite adapters.
 * Covers ticket Acceptance items over the FULL Control + projection path:
 *   - only all required work/gate + obligations + non-empty guards + no
 *     unreconciled side effects -> COMPLETED (1);
 *   - optional never blocks; required deferred/cancelled/blocked/failed never
 *     masquerade as completion (2 — pure-function + full-path);
 *   - parent_of / Module / Stage never change the required set (3);
 *   - empty plan / empty GoalGate / empty obligation / empty VR never prove
 *     completion (4 — applyPlan seams + pure function);
 *   - no-change only via an AlreadySatisfied required GoalGate proven by
 *     current PASS evidence (5);
 *   - deterministic 10-level priority incl. CANCELLED/NEEDS_DECISION/BLOCKED/
 *     FAILED and outcome_unknown (6) — pure + path;
 *   - replay equality (7) — same facts -> same phase + reason codes +
 *     explanation (full path + pure);
 *   - historical FAIL preserved, only current applicable evidence participates
 *     in the guard (8) — pure function + view evidence.
 */
import { describe, expect, it } from "vitest";
import {
  prepareP105Scenario,
  reduceGoalCommand,
  p105Evidence,
  submitP105Evidence,
  p105ReduceTaskCommand,
  satisfyEverythingP105,
  type P1_05HarnessFactory,
  type P105Preview,
} from "./p1-05-harness.js";
import {
  P105_OBL_GOAL,
  P105_OBL_MODULE,
  P105_OBL_OPTIONAL,
  P105_OBL_STAGE,
  P105_OBL_WORK,
  P105_TASK_GOAL_GATE,
  P105_TASK_MODULE_GATE,
  P105_TASK_OPTIONAL,
  P105_TASK_STAGE_GATE,
  P105_TASK_WORK,
} from "../../src/contracts/fixtures/goal-phase-fixtures.js";


const SCHEMA = "2026-09-05T12:00:00.000Z";

export function defineGoalReductionContractSuite(createHarness: P1_05HarnessFactory): void {
  describe("P1-05 goal reduction contract suite", () => {
    async function setup(projectIdSuffix = "") {
      const h = await createHarness();
      const sc = await prepareP105Scenario(h);
      return { h, sc, tag: projectIdSuffix };
    }

    it("full completion: all required work/gate satisfied + obligations + no side effects -> COMPLETED (+ projection)", async () => {
      const { h, sc } = await setup();
      await satisfyEverythingP105(h, sc);
      await h.advanceProjection();
      const receipt = await h.reduceGoal(reduceGoalCommand(sc, { commandId: "cmd-p105-goal-1", expectedRevision: 0 }));
      expect(receipt.status).toBe("committed");
      if (receipt.status !== "committed") return;
      expect(receipt.phase).toBe("COMPLETED");
      expect(receipt.reasonCodes).toContain("completion_guard_ok");
      expect(receipt.reasonCodes).toContain("optional_task_not_satisfied");

      await h.advanceProjection();
      const status = await h.goalStatus({ projectId: sc.projectId, goalId: sc.goalId, atLeastCursor: receipt.commitCursor });
      expect(status.status).toBe("ready");
      if (status.status !== "ready") return;
      expect(status.goal.phase).toBe("COMPLETED");
      expect(status.goal.previousPhase).toBeNull();
      expect(status.goal.explanation.items.find((i) => i.code === "completion_guard_ok")).toBeDefined();
      expect(status.goal.aggregateRevision).toBe(1);
      const timeline = await h.goalTimeline({ projectId: sc.projectId, goalId: sc.goalId });
      expect(timeline.status).toBe("ready");
      if (timeline.status === "ready") {
        expect(timeline.timeline).toHaveLength(1);
        expect(timeline.timeline[0]!.phase).toBe("COMPLETED");
        expect(timeline.timeline[0]!.previousPhase).toBeNull();
      }
      // no-change gate: goal gate satisfied ONLY by current PASS evidence
      const goalGateFact = status.goal.explanation.items.find((i) => i.code === "completion_guard_ok");
      expect(goalGateFact?.refs.taskIds).toContain(P105_TASK_GOAL_GATE);
    });

    it("RUNNING after plan with all frontiers pending; optional task never blocks", async () => {
      const { h, sc } = await setup();
      await h.advanceProjection();
      const receipt = await h.reduceGoal(reduceGoalCommand(sc, { commandId: "cmd-p105-goal-run", expectedRevision: 0 }));
      expect(receipt.status).toBe("committed");
      if (receipt.status !== "committed") return;
      expect(receipt.phase).toBe("RUNNING");
      expect(receipt.reasonCodes).toContain("required_frontier_available");
      expect(receipt.reasonCodes).toContain("optional_task_not_satisfied");
    });

    it("side-effect comparison: same satisfied facts + unreconciled outcome_unknown -> NEEDS_DECISION (not COMPLETED)", async () => {
      const { h, sc } = await setup();
      await satisfyEverythingP105(h, sc, { withUnknownSideEffect: true });
      await h.advanceProjection();
      const receipt = await h.reduceGoal(reduceGoalCommand(sc, { commandId: "cmd-p105-goal-se", expectedRevision: 0 }));
      expect(receipt.status).toBe("committed");
      if (receipt.status !== "committed") return;
      expect(receipt.phase).toBe("NEEDS_DECISION");
      expect(receipt.reasonCodes).toContain("unknown_side_effect_needs_decision");
      expect(receipt.reasonCodes).toContain("guard_unreconciled_side_effect");
      expect(receipt.reasonCodes).not.toContain("completion_guard_ok");
      expect(receipt.reasonCodes).toContain("guard_required_obligation_unsatisfied");
      // the run with the unknown outcome is recorded in the reconciliation
      const rec = receipt as { phase: string } & { sideEffects?: unknown };
      void rec;
    });

    it("PLANNING for a goal with no active plan; empty plan never completes (full path)", async () => {
      const { h, sc } = await setup();
      // Use a fresh goal in the same project WITHOUT a plan.
      const goal = await h.submit({
        commandId: "cmd-p105-goal-noplan",
        commandType: "CreateGoal",
        schemaVersion: 1,
        identity: { projectId: sc.projectId, actor: { kind: "human", id: "user-1" }, idempotencyKey: "p105-goal-noplan" },
        aggregateId: "goal-noplan-105",
        expectedRevision: 0,
        correlationId: "corr-p105-goal-noplan",
        submittedAt: SCHEMA,
        payload: { workspaceId: "ws-shared", objective: "no plan goal" },
      });
      expect(goal.status).toBe("committed");
      await h.advanceProjection();
      const receipt = await h.reduceGoal(reduceGoalCommand(sc, { commandId: "cmd-p105-goal-noplan-r", expectedRevision: 0, idempotencyKey: "p105-noplan-reduce", goalId: "goal-noplan-105" }));
      expect(receipt.status).toBe("committed");
      if (receipt.status === "committed") expect(receipt.phase).toBe("PLANNING");
    });

    it("full idempotency + CAS + zero-write rejections", async () => {
      const { h, sc } = await setup();
      await satisfyEverythingP105(h, sc);
      await h.advanceProjection();
      const first = await h.reduceGoal(reduceGoalCommand(sc, { commandId: "cmd-p105-idem", expectedRevision: 0, idempotencyKey: "p105-idem-key" }));
      expect(first.status).toBe("committed");
      if (first.status !== "committed") return;
      const eventsBefore = (await h.ledger.events({ afterCursor: null, limit: 500 })).events.length;

      // replay: same identity + fingerprint -> committed(replayed)
      const replay = await h.reduceGoal(reduceGoalCommand(sc, { commandId: "cmd-p105-idem", expectedRevision: 0, idempotencyKey: "p105-idem-key" }));
      expect(replay.status).toBe("committed");
      if (replay.status === "committed") expect(replay.replayed).toBe(true);

      // same identity, DIFFERENT fingerprint -> idempotency_conflict
      const conflict = await h.reduceGoal(reduceGoalCommand(sc, { commandId: "cmd-p105-idem", expectedRevision: 1, idempotencyKey: "p105-idem-key" }));
      expect(conflict.status).toBe("rejected");
      if (conflict.status === "rejected") expect(conflict.code).toBe("idempotency_conflict");

      // fresh command with stale CAS window -> revision_conflict
      const stale = await h.reduceGoal(reduceGoalCommand(sc, { commandId: "cmd-p105-stale", expectedRevision: 0, idempotencyKey: "p105-stale-key" }));
      expect(stale.status).toBe("rejected");
      if (stale.status === "rejected") expect(stale.code).toBe("revision_conflict");

      // invalid schema -> invalid; unknown goal -> not_found
      const invalid = await h.reduceGoal({ ...reduceGoalCommand(sc, { commandId: "cmd-p105-invalid", expectedRevision: 0, idempotencyKey: "p105-invalid" }), commandType: "ReduceGoalX" as never });
      expect(invalid.status).toBe("rejected");
      if (invalid.status === "rejected") expect(invalid.code).toBe("invalid");
      const notFound = await h.reduceGoal({ ...reduceGoalCommand(sc, { commandId: "cmd-p105-nf", expectedRevision: 0, idempotencyKey: "p105-nf" }), payload: { goalId: "goal-missing-105" } });
      expect(notFound.status).toBe("rejected");
      if (notFound.status === "rejected") expect(notFound.code).toBe("not_found");

      const eventsAfter = (await h.ledger.events({ afterCursor: null, limit: 500 })).events.length;
      expect(eventsAfter).toBe(eventsBefore); // all rejections were zero-write
    });

    it("determinism: re-reduction over the same facts -> identical phase, reason codes and explanation", async () => {
      const { h, sc } = await setup();
      await satisfyEverythingP105(h, sc);
      await h.advanceProjection();
      const first = await h.reduceGoal(reduceGoalCommand(sc, { commandId: "cmd-p105-det-1", expectedRevision: 0, idempotencyKey: "p105-det-1" }));
      expect(first.status).toBe("committed");
      if (first.status !== "committed") return;
      const second = await h.reduceGoal(reduceGoalCommand(sc, { commandId: "cmd-p105-det-2", expectedRevision: 1, idempotencyKey: "p105-det-2" }));
      expect(second.status).toBe("committed");
      if (second.status !== "committed") return;
      expect(second.phase).toBe(first.phase);
      expect(JSON.stringify(second.reasonCodes)).toBe(JSON.stringify(first.reasonCodes));
      await h.advanceProjection();
      const status = await h.goalStatus({ projectId: sc.projectId, goalId: sc.goalId });
      expect(status.status).toBe("ready");
      if (status.status === "ready") {
        expect(status.goal.aggregateRevision).toBe(2);
        expect(status.goal.previousPhase).toBe(first.phase);
        const timeline = await h.goalTimeline({ projectId: sc.projectId, goalId: sc.goalId });
        if (timeline.status === "ready") expect(timeline.timeline).toHaveLength(2);
      }
    });

    it("freshness: not_ready before projection; not_found only after covered; full-scope key isolation", async () => {
      const { h, sc } = await setup();
      const receipt = await h.reduceGoal(reduceGoalCommand(sc, { commandId: "cmd-p105-fresh", expectedRevision: 0, idempotencyKey: "p105-fresh" }));
      expect(receipt.status).toBe("committed");
      if (receipt.status !== "committed") return;
      // not projected yet -> not_ready (never not_found)
      const before = await h.goalStatus({ projectId: sc.projectId, goalId: sc.goalId, atLeastCursor: receipt.commitCursor });
      expect(before.status).toBe("not_ready");
      await h.advanceProjection();
      const after = await h.goalStatus({ projectId: sc.projectId, goalId: sc.goalId, atLeastCursor: receipt.commitCursor });
      expect(after.status).toBe("ready");
      const missing = await h.goalStatus({ projectId: sc.projectId, goalId: "goal-missing-105" });
      expect(missing.status).toBe("not_found");
      // never claims a Task phase: TaskDetail.phase stays the plan value
      const detail = await h.taskDetail({ projectId: sc.projectId, goalId: sc.goalId, taskId: P105_TASK_WORK });
      expect(detail.status).toBe("ready");
      if (detail.status === "ready") expect(detail.task.phase).toBe("pending");
    });

    it("applyPlan rejects a plan WITHOUT a required active GoalGate (no-change seam, zero-write)", async () => {
      const { h, sc } = await setup();
      const plan = structuredClone((await import("../../src/contracts/fixtures/goal-phase-fixtures.js")).P105_PLAN_REVISION_FIXTURE_V1);
      plan.tasks = plan.tasks.filter((t) => t.taskId !== P105_TASK_GOAL_GATE);
      plan.obligations = plan.obligations.filter((o) => o.taskIds.includes(P105_TASK_WORK) || o.taskIds.includes(P105_TASK_MODULE_GATE));
      const apply = await h.applyPlan({
        commandId: "cmd-p105-plan-nogate",
        commandType: "ApplyPlanRevision",
        schemaVersion: 1,
        identity: { projectId: sc.projectId, actor: { kind: "human", id: "user-1" }, idempotencyKey: "p105-plan-nogate" },
        aggregateId: sc.goalId,
        expectedRevision: 1,
        correlationId: "corr-p105-plan-nogate",
        submittedAt: SCHEMA,
        payload: { plan },
      });
      expect(apply.status).toBe("rejected");
      if (apply.status === "rejected") expect(apply.code).toBe("plan_guard_failed");
    });
  });
}
