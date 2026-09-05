/**
 * P1-02 lane C — InMemory rebuild equivalence for the plan views.
 *
 * A fresh ReadModelIndexImpl replayed from the SAME EventPage stream must
 * produce plan graph / task detail / goal view rows field-for-field identical
 * to the incremental projection (the projection is a pure function of the
 * EventPage(s); no state is carried across instances).
 */
import { describe, expect, it } from "vitest";
import { createReadModelIndex } from "../../src/read-model/read-model-index.js";
import type { ReadModelIndex } from "../../src/contracts/goal-view.js";
import type { CommitCursor } from "../../src/contracts/command-event.js";
import type { EventPage, PositionedEvent } from "../../src/contracts/ledger.js";
import { makeCommitCursor } from "../../src/contracts/ledger.js";
import {
  MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1,
  buildCreateGoalCommand,
  goalCreatedEventFor,
} from "../../src/contracts/fixtures/goal-fixtures.js";
import {
  HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1,
  buildApplyPlanCommand,
  planRevisionSnapshotFor,
  planRevisionAcceptedEventFor,
} from "../../src/contracts/fixtures/plan-fixtures.js";
import {
  ARCHITECTURE_BASELINE_FIXTURE_V1,
  COMPLETION_POLICY_FIXTURE_V1,
  buildInstallCommand,
  completionPolicyPinFor,
  architectureBaselinePinFor,
} from "../../src/contracts/fixtures/governance-fixtures.js";
import { FIXED_ISO_2026_09_05 } from "../../src/contracts/testing/sequences.js";

const OCCURRED = FIXED_ISO_2026_09_05;
const ACCEPTED_AT = "2026-09-05T12:00:00.000Z";
const FIX = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1;

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
  const projectId = FIX.scopes[scope]!.projectId;
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
  return {
    cursor: makeCommitCursor(seq),
    event: planRevisionAcceptedEventFor(cmd, {
      eventId: "evt-plan-" + idx,
      occurredAt: OCCURRED,
      workspaceId: FIX.scopes[scope]!.workspaceId,
      goalAggregateRevision: 2,
      planSnapshot: snapshot,
    }),
  };
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

function alphaGraphQuery(atLeastCursor?: CommitCursor) {
  const base = { projectId: "proj-alpha", goalId: "goal-1" };
  return atLeastCursor === undefined ? base : { ...base, atLeastCursor };
}

function alphaGoalQuery(atLeastCursor?: CommitCursor) {
  const base = { projectId: "proj-alpha", workspaceId: "ws-shared", goalId: "goal-1" };
  return atLeastCursor === undefined ? base : { ...base, atLeastCursor };
}

const PAGES = (prefix: string): EventPage[] => [
  pageOf([goalEventAt(1, 0, prefix + "a"), planEventAt(2, 0, prefix + "a")]),
  pageOf([goalEventAt(3, 1, prefix + "b"), planEventAt(4, 1, prefix + "b")]),
];

describe("ReadModelIndexImpl plan view rebuild (lane C, InMemory)", () => {
  it("fresh instance replayed from the same pages equals the incremental projection", async () => {
    const pages = PAGES("R");
    const inc = createReadModelIndex();
    await inc.advance(pages[0]!);
    await inc.advance(pages[1]!);
    const incGraph = await inc.planGraph(alphaGraphQuery(makeCommitCursor(4)));
    const incGate = await inc.taskDetail({
      projectId: "proj-alpha",
      goalId: "goal-1",
      taskId: "gate-goal",
      atLeastCursor: makeCommitCursor(4),
    });
    const incGoal = await inc.goal(alphaGoalQuery(makeCommitCursor(4)));

    const fresh = createReadModelIndex();
    await advanceAll(fresh, pages);
    const freshGraph = await fresh.planGraph(alphaGraphQuery(makeCommitCursor(4)));
    const freshGate = await fresh.taskDetail({
      projectId: "proj-alpha",
      goalId: "goal-1",
      taskId: "gate-goal",
      atLeastCursor: makeCommitCursor(4),
    });
    const freshGoal = await fresh.goal(alphaGoalQuery(makeCommitCursor(4)));

    expect(freshGraph).toEqual(incGraph);
    expect(freshGate).toEqual(incGate);
    expect(freshGoal).toEqual(incGoal);
  });

  it("a partial prefix rebuild equals the incremental prefix", async () => {
    const pages = PAGES("S");
    const prefix = pages.slice(0, 1);
    const inc = createReadModelIndex();
    await advanceAll(inc, prefix);
    const incGraph = await inc.planGraph(alphaGraphQuery(makeCommitCursor(2)));

    const fresh = createReadModelIndex();
    await advanceAll(fresh, prefix);
    const freshGraph = await fresh.planGraph(alphaGraphQuery(makeCommitCursor(2)));

    expect(freshGraph).toEqual(incGraph);
  });
});
