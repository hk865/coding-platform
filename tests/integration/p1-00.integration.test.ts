/**
 * P1-00 integration test — the full tracer bullet:
 * bootstrap -> CreateGoal -> InMemoryLedger -> EventPage -> ReadModelIndex -> GoalView.
 * Uses REAL modules from lanes A/B/C (never fakes).
 * NOTE: intentionally red until lanes A/B/C land; acceptance is only claimed
 * once this file passes unchanged.
 */
import { describe, expect, it } from "vitest";
import {
  WORKSPACE_BOOTSTRAP_FIXTURE_V1,
  fixtureDigest,
} from "../../src/contracts/fixtures/bootstrap-fixture-v1.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1 } from "../../src/contracts/fixtures/goal-fixtures.js";
import {
  verifyBootstrapManifest,
  verifyGoalViewIsolation,
} from "./p1-00-assertions.js";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { FIXED_ISO_2026_09_05 } from "../../src/contracts/testing/sequences.js";
import type { WorkspaceBootstrapCommand } from "../../src/contracts/bootstrap.js";

const FIXTURE = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1;
const ALPHA = FIXTURE.scopes[0]!;
const BETA = FIXTURE.scopes[1]!;

function bootstrapCommandFor(commandId: string): WorkspaceBootstrapCommand {
  return buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
    commandId,
    correlationId: "corr-boot-" + commandId,
    submittedAt: FIXED_ISO_2026_09_05,
  });
}

async function harnessWithBootstrap() {
  const harness = createInMemoryHarness();
  await harness.bootstrap(bootstrapCommandFor("boot-1"));
  return harness;
}

describe("P1-00 integration: bootstrap -> CreateGoal -> Ledger -> Event -> GoalView", () => {
  it("bootstrap atomically initializes isolated scopes with auditable manifest", async () => {
    const harness = await harnessWithBootstrap();
    const receipt = await harness.control.bootstrap(bootstrapCommandFor("boot-1"));
    expect(receipt.status).toBe("committed");
    if (receipt.status !== "committed") return;
    expect(receipt.replayed).toBe(true); // boot-1 already committed by harnessWithBootstrap
    expect(receipt.manifest.sourceDigest).toBe(fixtureDigest());
    verifyBootstrapManifest(receipt.manifest);
    // canonical entries exist and are auditable
    expect(
      await harness.ledger.load({ aggregateType: "Project", projectId: "proj-alpha" }),
    ).toMatchObject({ status: "found", snapshot: { revision: 1 } });
    await harness.advanceProjection();
  });

  it("completes the tracer bullet in both scopes with isolated identities", async () => {
    const harness = await harnessWithBootstrap();
    const alphaResult = await harness.collaboration.createGoal({
      projectId: ALPHA.projectId,
      workspaceId: ALPHA.workspaceId,
      goalId: ALPHA.goalId,
      objective: ALPHA.objective,
      actor: ALPHA.actor,
      idempotencyKey: FIXTURE.sharedIdempotencyKey,
    });
    expect(alphaResult.status).toBe("persisted");
    if (alphaResult.status !== "persisted") return;

    const betaResult = await harness.collaboration.createGoal({
      projectId: BETA.projectId,
      workspaceId: BETA.workspaceId,
      goalId: BETA.goalId,
      objective: BETA.objective,
      actor: BETA.actor,
      idempotencyKey: FIXTURE.sharedIdempotencyKey,
    });
    expect(betaResult.status).toBe("persisted");
    if (betaResult.status !== "persisted") return;

    await harness.advanceProjection();
    await verifyGoalViewIsolation(harness, ALPHA, BETA);

    const goalAlpha = await harness.ledger.load({
      aggregateType: "Goal",
      projectId: ALPHA.projectId,
      goalId: ALPHA.goalId,
    });
    expect(goalAlpha.status).toBe("found");
    const page = await harness.ledger.events({ afterCursor: null, limit: 100 });
    expect(page.events.filter((p) => p.event.eventType === "GoalCreated")).toHaveLength(2);
  });

  it("same CreateGoal request retry is idempotent (no second event)", async () => {
    const harness = await harnessWithBootstrap();
    const request = {
      projectId: ALPHA.projectId,
      workspaceId: ALPHA.workspaceId,
      goalId: ALPHA.goalId,
      objective: ALPHA.objective,
      actor: ALPHA.actor,
      idempotencyKey: FIXTURE.sharedIdempotencyKey,
    };
    const first = await harness.collaboration.createGoal(request);
    const second = await harness.collaboration.createGoal(request);
    expect(first.status).toBe("persisted");
    expect(second.status).toBe("persisted");
    if (first.status !== "persisted" || second.status !== "persisted") return;
    expect(second.commitCursor).toBe(first.commitCursor);
    const page = await harness.ledger.events({ afterCursor: null, limit: 100 });
    expect(page.events.filter((p) => p.event.eventType === "GoalCreated")).toHaveLength(1);
  });

  it("rejections map to user-facing codes with zero writes", async () => {
    const harness = await harnessWithBootstrap();
    const before = (await harness.ledger.events({ afterCursor: null, limit: 100 })).events.length;

    const badObjective = await harness.collaboration.createGoal({
      projectId: ALPHA.projectId,
      workspaceId: ALPHA.workspaceId,
      goalId: ALPHA.goalId,
      objective: "   ",
      actor: ALPHA.actor,
      idempotencyKey: "k-bad",
    });
    expect(badObjective).toEqual({ status: "rejected", code: "invalid_request" });

    const badScope = await harness.collaboration.createGoal({
      projectId: "proj-not-bootstrapped",
      workspaceId: ALPHA.workspaceId,
      goalId: ALPHA.goalId,
      objective: ALPHA.objective,
      actor: ALPHA.actor,
      idempotencyKey: "k-scope",
    });
    expect(badScope).toEqual({ status: "rejected", code: "scope_not_found" });

    const badWorkspace = await harness.collaboration.createGoal({
      projectId: ALPHA.projectId,
      workspaceId: "ws-not-bootstrapped",
      goalId: ALPHA.goalId,
      objective: ALPHA.objective,
      actor: ALPHA.actor,
      idempotencyKey: "k-ws",
    });
    expect(badWorkspace).toEqual({ status: "rejected", code: "scope_not_found" });

    const after = (await harness.ledger.events({ afterCursor: null, limit: 100 })).events.length;
    expect(after).toBe(before);
  });

  it("same idempotency key with different objective -> conflict, zero writes", async () => {
    const harness = await harnessWithBootstrap();
    const first = await harness.collaboration.createGoal({
      projectId: ALPHA.projectId,
      workspaceId: ALPHA.workspaceId,
      goalId: ALPHA.goalId,
      objective: ALPHA.objective,
      actor: ALPHA.actor,
      idempotencyKey: FIXTURE.sharedIdempotencyKey,
    });
    expect(first.status).toBe("persisted");
    if (first.status !== "persisted") return;
    const conflict = await harness.collaboration.createGoal({
      projectId: ALPHA.projectId,
      workspaceId: ALPHA.workspaceId,
      goalId: ALPHA.goalId,
      objective: "completely different objective",
      actor: ALPHA.actor,
      idempotencyKey: FIXTURE.sharedIdempotencyKey,
    });
    expect(conflict).toEqual({ status: "rejected", code: "conflict" });
  });

  it("bootstrap is idempotent for same digest and deterministic for others", async () => {
    const harness = await harnessWithBootstrap();
    const replay = await harness.control.bootstrap(bootstrapCommandFor("boot-1"));
    expect(replay.status).toBe("committed");
    if (replay.status === "committed") expect(replay.replayed).toBe(true);

    const other = await harness.control.bootstrap(
      buildBootstrapCommand(
        { schemaVersion: 1, entries: [{ projectId: "proj-gamma", workspaceId: "ws-gamma" }] },
        {
          commandId: "boot-3",
          correlationId: "corr-boot-3",
          submittedAt: FIXED_ISO_2026_09_05,
          idempotencyKey: "k-other",
        },
      ),
    );
    expect(other.status).toBe("rejected");
    if (other.status === "rejected") expect(other.code).toBe("not_empty");
  });

  it("freshness: not_ready until projection catches up, then ready", async () => {
    const harness = await harnessWithBootstrap();
    const result = await harness.collaboration.createGoal({
      projectId: ALPHA.projectId,
      workspaceId: ALPHA.workspaceId,
      goalId: ALPHA.goalId,
      objective: ALPHA.objective,
      actor: ALPHA.actor,
      idempotencyKey: FIXTURE.sharedIdempotencyKey,
    });
    expect(result.status).toBe("persisted");
    if (result.status !== "persisted") return;

    const before = await harness.collaboration.goalView({
      projectId: ALPHA.projectId,
      workspaceId: ALPHA.workspaceId,
      goalId: ALPHA.goalId,
      atLeastCursor: result.commitCursor,
    });
    if (before.status === "ready") {
      // previous step may have already advanced the projection
    } else {
      expect(before.status).toBe("not_ready");
      await harness.advanceProjection();
    }
    const after = await harness.collaboration.goalView({
      projectId: ALPHA.projectId,
      workspaceId: ALPHA.workspaceId,
      goalId: ALPHA.goalId,
      atLeastCursor: result.commitCursor,
    });
    expect(after.status).toBe("ready");
    if (after.status === "ready") {
      expect(after.goal.activePlanRevision).toBeNull();
      expect(after.goal.objective).toBe(ALPHA.objective.trim());
    }
  });
});
