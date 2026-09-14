import { ControlPolicyExplanation } from '../../src/control/control-engine/policy-explanation.js';
/**
 * P1-02 lane C — SQLite Plan Graph / Task Detail projection + rebuild/reopen
 * equivalence. Mirrors the InMemory semantics field-for-field and proves the
 * "db is rebuildable from the persistent EventPage(s)" rule for the plan views:
 *  (a) a FRESH file rebuilt by replaying the same EventPage stream reproduces
 *      the incremental projection field-for-field (graph / task detail / goal
 *      view);
 *  (b) reopening the SAME file and continuing to advance reproduces the
 *      one-shot full replay;
 *  (c) persisted dedupe: re-advancing an already-applied page after reopen is
 *      idempotent (no re-report, no base advance).
 *
 * EventPage stream is assembled purely from the shared P1-00/P1-02 contract
 * fixtures (deterministic ids/cursors) — it does NOT depend on a real ledger.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSqliteReadModelIndex } from "../../src/data/read-model-index/sqlite-read-model-index.js";
import type { ReadModelIndex } from "../../src/contracts/goal-view.js";
import type { CommitCursor } from "../../src/contracts/command-event.js";
import type { EventPage, PositionedEvent } from "../../src/contracts/ledger.js";
import { makeCommitCursor } from "../../src/contracts/ledger.js";
import {
  MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1,
  buildCreateGoalCommand,
  goalCreatedEventFor,
} from "../contract-support/fixtures/goal-fixtures.js";
import { HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, buildApplyPlanCommand } from "../../src/fixtures/plan-fixtures.js";
import { planRevisionSnapshotFor, planRevisionAcceptedEventFor } from "../../src/control/control-engine/records/plan.js";
import { ARCHITECTURE_BASELINE_FIXTURE_V1, COMPLETION_POLICY_FIXTURE_V1, buildInstallCommand } from "../../src/fixtures/governance-fixtures.js";
import { completionPolicyPinFor, architectureBaselinePinFor } from "../../src/contracts/governance.js";
import { FIXED_ISO_2026_09_05 } from "../../src/testing/sequences.js";

const OCCURRED = FIXED_ISO_2026_09_05;
const ACCEPTED_AT = "2026-09-05T12:00:00.000Z";
const FIX = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1;

function projectOf(scope: 0 | 1): string {
  return FIX.scopes[scope]!.projectId;
}

function cpPin(projectId: string) {
  const cmd = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, {
    commandId: "cmd-cp",
    correlationId: "corr-cp",
    submittedAt: OCCURRED,
    projectId,
  });
  if (cmd.commandType !== "InstallCompletionPolicyRevision") throw new Error("cp kind");
  return completionPolicyPinFor(cmd);
}

function abPin(projectId: string) {
  const cmd = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, {
    commandId: "cmd-ab",
    correlationId: "corr-ab",
    submittedAt: OCCURRED,
    projectId,
  });
  if (cmd.commandType !== "InstallArchitectureBaselineRevision") throw new Error("ab kind");
  return architectureBaselinePinFor(cmd);
}

function goalEventAt(seq: number, scope: 0 | 1, idx: string): PositionedEvent {
  const data = FIX.scopes[scope]!;
  const cmd = buildCreateGoalCommand(data, {
    commandId: "cmd-goal-" + idx,
    correlationId: "corr-goal-" + idx,
    submittedAt: OCCURRED,
  });
  return {
    cursor: makeCommitCursor(seq),
    event: goalCreatedEventFor(cmd, { eventId: "evt-goal-" + idx, occurredAt: OCCURRED }),
  };
}

function planEventAt(seq: number, scope: 0 | 1, idx: string): PositionedEvent {
  const projectId = projectOf(scope);
  const cmd = buildApplyPlanCommand(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, {
    commandId: "cmd-plan-" + idx,
    correlationId: "corr-plan-" + idx,
    submittedAt: OCCURRED,
    projectId,
    expectedRevision: 1,
    idempotencyKey: "apply-plan-" + idx,
  });
  const snapshot = planRevisionSnapshotFor(
    cmd,
    { completionPolicy: cpPin(projectId), architectureBaseline: abPin(projectId) },
    ACCEPTED_AT,
  );
  const event = planRevisionAcceptedEventFor(cmd, {
    eventId: "evt-plan-" + idx,
    occurredAt: OCCURRED,
    workspaceId: FIX.scopes[scope]!.workspaceId,
    goalAggregateRevision: 2,
    planSnapshot: snapshot,
  });
  return { cursor: makeCommitCursor(seq), event };
}

function pageOf(positioned: PositionedEvent[]): EventPage {
  return {
    afterCursor: null,
    throughCursor: positioned.at(-1)?.cursor ?? null,
    events: [...positioned],
    hasMore: false,
  };
}

async function advanceAll(index: ReadModelIndex, pages: EventPage[]): Promise<void> {
  for (const page of pages) await index.advance(page);
}

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "p1-02-rm-"));
}

/** Deterministic two-page stream: alpha (goal c1, plan c2) + beta (goal c3, plan c4). */
function buildPages(prefix: string): EventPage[] {
  return [
    pageOf([goalEventAt(1, 0, prefix + "-a"), planEventAt(2, 0, prefix + "-a")]),
    pageOf([goalEventAt(3, 1, prefix + "-b"), planEventAt(4, 1, prefix + "-b")]),
  ];
}

function alphaGraphQuery(atLeastCursor?: CommitCursor) {
  const base = { projectId: "proj-alpha", goalId: "goal-1" };
  return atLeastCursor === undefined ? base : { ...base, atLeastCursor };
}

function alphaGoalQuery(atLeastCursor?: CommitCursor) {
  const base = { projectId: "proj-alpha", workspaceId: "ws-shared", goalId: "goal-1" };
  return atLeastCursor === undefined ? base : { ...base, atLeastCursor };
}

describe("SqliteReadModelIndex plan view (lane C)", () => {
  it("ready: Plan Graph / Task Detail mirror the accepted snapshot with exact pins", async () => {
    const index = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path: ":memory:" });
    await index.advance(pageOf([goalEventAt(1, 0, "x"), planEventAt(2, 0, "x")]));
    const graph = await index.planGraph(alphaGraphQuery(makeCommitCursor(2)));
    expect(graph.status).toBe("ready");
    if (graph.status !== "ready") return;
    expect(graph.graph.projectId).toBe("proj-alpha");
    expect(graph.graph.goalId).toBe("goal-1");
    expect(graph.graph.planRef).toEqual({
      aggregateType: "PlanRevision",
      projectId: "proj-alpha",
      planId: "plan-mvp-1",
    });
    expect(graph.graph.planRevision).toBe(1);
    expect(graph.graph.pinnedCompletionPolicy).toEqual(cpPin("proj-alpha"));
    expect(graph.graph.pinnedArchitectureBaseline).toEqual(abPin("proj-alpha"));
    expect(graph.graph.tasks.length).toBe(4);
    expect(graph.graph.sourceCursor).toBe(makeCommitCursor(2));

    const gate = await index.taskDetail({
      projectId: "proj-alpha",
      goalId: "goal-1",
      taskId: "gate-goal",
      atLeastCursor: makeCommitCursor(2),
    });
    expect(gate.status).toBe("ready");
    if (gate.status !== "ready") return;
    expect(gate.task.taskKind).toBe("gate");
    expect(gate.task.stageId).toBeNull();
    expect(gate.task.obligations.map((o) => o.obligationId)).toEqual(["obl-3"]);

    // goal view refreshed
    const goalView = await index.goal(alphaGoalQuery(makeCommitCursor(2)));
    expect(goalView.status).toBe("ready");
    if (goalView.status !== "ready") return;
    expect(goalView.goal.activePlanRevision).toEqual({
      aggregateType: "PlanRevision",
      projectId: "proj-alpha",
      planId: "plan-mvp-1",
    });
    expect(goalView.goal.aggregateRevision).toBe(2);
  });

  it("not_ready != not_found for plan graph / task detail", async () => {
    const index = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path: ":memory:" });
    const early = await index.planGraph({ projectId: "proj-alpha", goalId: "goal-1" });
    expect(early.status).toBe("not_ready");
    await index.advance(pageOf([goalEventAt(1, 0, "y"), planEventAt(2, 0, "y")]));
    const missing = await index.planGraph({
      projectId: "proj-alpha",
      goalId: "goal-2",
      atLeastCursor: makeCommitCursor(2),
    });
    expect(missing.status).toBe("not_found");
    const noCursor = await index.planGraph({ projectId: "proj-alpha", goalId: "goal-2" });
    expect(noCursor.status).toBe("not_ready");
    const taskMissing = await index.taskDetail({
      projectId: "proj-alpha",
      goalId: "goal-1",
      taskId: "task-nope",
      atLeastCursor: makeCommitCursor(2),
    });
    expect(taskMissing.status).toBe("not_found");
  });

  it("cross-project isolation: same goalId/taskId reused under two projects", async () => {
    const index = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path: ":memory:" });
    await index.advance(pageOf([goalEventAt(1, 0, "p"), planEventAt(2, 0, "p")]));
    await index.advance(pageOf([goalEventAt(3, 1, "q"), planEventAt(4, 1, "q")]));
    const alpha = await index.planGraph({
      projectId: "proj-alpha",
      goalId: "goal-1",
      atLeastCursor: makeCommitCursor(4),
    });
    const beta = await index.planGraph({
      projectId: "proj-beta",
      goalId: "goal-1",
      atLeastCursor: makeCommitCursor(4),
    });
    expect(alpha.status).toBe("ready");
    expect(beta.status).toBe("ready");
    if (alpha.status === "ready") expect(alpha.graph.projectId).toBe("proj-alpha");
    if (beta.status === "ready") expect(beta.graph.projectId).toBe("proj-beta");
    const betaGate = await index.taskDetail({
      projectId: "proj-beta",
      goalId: "goal-1",
      taskId: "gate-goal",
      atLeastCursor: makeCommitCursor(4),
    });
    expect(betaGate.status).toBe("ready");
    if (betaGate.status === "ready") expect(betaGate.task.projectId).toBe("proj-beta");
  });

  it("fresh rebuild from the same EventPages equals the incremental projection", async () => {
    const dir = await makeTempDir();
    try {
      const incPath = join(dir, "inc.sqlite");
      const rebPath = join(dir, "reb.sqlite");
      const pages = buildPages("A");

      let inc = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path: incPath });
      await inc.advance(pages[0]!);
      await inc.close();
      inc = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path: incPath }); // reopen same file
      await inc.advance(pages[1]!);
      const incAlpha = await inc.planGraph(alphaGraphQuery(makeCommitCursor(4)));
      const incGate = await inc.taskDetail({
        projectId: "proj-alpha",
        goalId: "goal-1",
        taskId: "gate-goal",
        atLeastCursor: makeCommitCursor(4),
      });
      const incGoal = await inc.goal(alphaGoalQuery(makeCommitCursor(4)));
      await inc.close();

      const reb = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path: rebPath });
      await advanceAll(reb, pages);
      const rebAlpha = await reb.planGraph(alphaGraphQuery(makeCommitCursor(4)));
      const rebGate = await reb.taskDetail({
        projectId: "proj-alpha",
        goalId: "goal-1",
        taskId: "gate-goal",
        atLeastCursor: makeCommitCursor(4),
      });
      const rebGoal = await reb.goal(alphaGoalQuery(makeCommitCursor(4)));
      await reb.close();

      expect(incAlpha).toEqual(rebAlpha);
      expect(incGate).toEqual(rebGate);
      expect(incGoal).toEqual(rebGoal);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reopening the same file and continuing equals a one-shot full replay", async () => {
    const dir = await makeTempDir();
    try {
      const incPath = join(dir, "inc.sqlite");
      const onePath = join(dir, "one.sqlite");
      const pages = buildPages("B");

      let inc = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path: incPath });
      await inc.advance(pages[0]!);
      await inc.close();
      inc = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path: incPath });
      await inc.advance(pages[1]!);
      const incAlpha = await inc.planGraph(alphaGraphQuery(makeCommitCursor(4)));
      await inc.close();

      const one = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path: onePath });
      await advanceAll(one, pages);
      const oneAlpha = await one.planGraph(alphaGraphQuery(makeCommitCursor(4)));
      await one.close();

      expect(incAlpha).toEqual(oneAlpha);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("persisted dedupe: re-advancing an applied page after reopen is idempotent", async () => {
    const dir = await makeTempDir();
    try {
      const dupPath = join(dir, "dup.sqlite");
      const page = pageOf([goalEventAt(1, 0, "z"), planEventAt(2, 0, "z")]);
      let idx = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path: dupPath });
      const first = await idx.advance(page);
      expect(first.appliedEventIds).toEqual(["evt-goal-z", "evt-plan-z"]);
      await idx.close();
      idx = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path: dupPath });
      const second = await idx.advance(page);
      expect(second.appliedEventIds).toEqual([]);
      const graph = await idx.planGraph(alphaGraphQuery(makeCommitCursor(2)));
      expect(graph.status).toBe("ready");
      await idx.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
