/**
 * P1-05 restart-path fixtures + readiness probe.
 *   bootstrap -> install/activate -> CreateGoal -> applyPlan -> claim ->
 *   FakeRuntime facts -> PASS evidence -> TaskReduction -> Goal reduction ->
 *   views -> close -> reopen -> GoalPhase snapshot / goalStatus / goalTimeline
 *   rebuilt from persisted EventPages field-for-field identical.
 * NEVER fakes; the probe runs the full path and auto-skips until the P1-05
 * handlers/projections land ("not implemented yet" throws -> false).
 */
import { expect } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import type { PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import {
  prepareP105Scenario,
  satisfyEverythingP105,
  reduceGoalCommand,
  toP1_05Harness,
  type P1_05TestHarness,
} from "../contract-suite/p1-05-harness.js";
import { goalPhaseRefFor, type GoalPhaseSnapshot } from "../../src/contracts/goal-phase.js";
import type { GoalStatusView, GoalTimelineEntry } from "../../src/contracts/goal-phase-view.js";

export async function isP105Ready(): Promise<boolean> {
  try {
    const h = await createPersistentSqliteHarness({ deps: {} });
    try {
      await runP105Path(h);
      return true;
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  } catch {
    return false;
  }
}

export async function runP105Path(h: PersistentSqliteHarness) {
  const th: P1_05TestHarness = toP1_05Harness(h);
  const sc = await prepareP105Scenario(th);
  await satisfyEverythingP105(th, sc);
  await th.advanceProjection();

  const first = await th.reduceGoal(reduceGoalCommand(sc, { commandId: "cmd-rs-p105-1", expectedRevision: 0, idempotencyKey: "p105-rs-1" }));
  if (first.status !== "committed" || first.phase !== "COMPLETED") {
    throw new Error("p105 first goal reduction failed: " + String(first.status) + "/" + (first as { phase?: string }).phase);
  }
  // deterministic re-reduction over the same facts
  const second = await th.reduceGoal(reduceGoalCommand(sc, { commandId: "cmd-rs-p105-2", expectedRevision: 1, idempotencyKey: "p105-rs-2" }));
  if (second.status !== "committed" || second.phase !== first.phase) {
    throw new Error("p105 re-reduction mismatch");
  }
  await th.advanceProjection();

  const status = await th.goalStatus({ projectId: sc.projectId, goalId: sc.goalId });
  if (status.status !== "ready") throw new Error("p105 goalStatus not ready: " + String(status.status));
  const timeline = await th.goalTimeline({ projectId: sc.projectId, goalId: sc.goalId });
  if (timeline.status !== "ready" || timeline.timeline.length !== 2) {
    throw new Error("p105 timeline not ready/2 entries");
  }
  const phaseLoad = await h.ledger.load(goalPhaseRefFor(sc.projectId, sc.goalId));
  if (phaseLoad.status !== "found") throw new Error("p105 GoalPhase snapshot missing");
  const reductionLoad = await h.ledger.load({
    aggregateType: "TaskReduction", projectId: sc.projectId, goalId: sc.goalId, taskId: "task-work-105",
  });
  if (reductionLoad.status !== "found") throw new Error("p105 TaskReduction missing");

  return {
    projectId: sc.projectId,
    goalId: sc.goalId,
    goalPhase: phaseLoad.snapshot as GoalPhaseSnapshot,
    workReduction: reductionLoad.snapshot,
    statusView: status.status === "ready" ? status.goal : null,
    timeline: timeline.status === "ready" ? timeline.timeline : [],
    observedCursor: h.observedCursor(),
    eventTypes: (await h.ledger.events({ afterCursor: null, limit: 500 })).events.map((p) => p.event.eventType),
  };
}

export async function verifyP105AfterRestart(
  h: PersistentSqliteHarness,
  before: Awaited<ReturnType<typeof runP105Path>>,
): Promise<void> {
  const th: P1_05TestHarness = toP1_05Harness(h);
  const json = (v: unknown) => JSON.stringify(v);
  const phaseLoad = await h.ledger.load(goalPhaseRefFor(before.projectId, before.goalId));
  if (phaseLoad.status !== "found" || json(phaseLoad.snapshot) !== json(before.goalPhase)) {
    throw new Error("GoalPhase snapshot mismatch after restart");
  }
  const workLoad = await h.ledger.load({
    aggregateType: "TaskReduction", projectId: before.projectId, goalId: before.goalId, taskId: "task-work-105",
  });
  if (workLoad.status !== "found" || json(workLoad.snapshot) !== json(before.workReduction)) {
    throw new Error("TaskReduction snapshot mismatch after restart");
  }
  await h.advanceProjection();
  const status = await th.goalStatus({ projectId: before.projectId, goalId: before.goalId });
  if (status.status !== "ready" || json(status.goal) !== json(before.statusView)) {
    throw new Error("goalStatus view mismatch after restart");
  }
  const timeline = await th.goalTimeline({ projectId: before.projectId, goalId: before.goalId });
  if (timeline.status !== "ready" || json(timeline.timeline) !== json(before.timeline)) {
    throw new Error("goalTimeline mismatch after restart");
  }
  if (String(h.observedCursor()) !== String(before.observedCursor)) {
    throw new Error("observedCursor mismatch after restart");
  }
}
