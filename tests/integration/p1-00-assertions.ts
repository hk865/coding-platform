/**
 * Shared P1-00 integration assertions (integrator-owned).
 */
import { expect } from "vitest";
import type { WorkspaceBootstrapManifest } from "../../src/contracts/bootstrap.js";
import type { GoalViewResult } from "../../src/contracts/goal-view.js";
import type { InMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { fixtureDigest } from "../../src/contracts/fixtures/bootstrap-fixture-v1.js";
import type { GoalFixtureScope } from "../../src/contracts/fixtures/goal-fixtures.js";

export function verifyBootstrapManifest(manifest: WorkspaceBootstrapManifest): void {
  expect(manifest.schemaVersion).toBe(1);
  expect(manifest.sourceDigest).toBe(fixtureDigest());
  expect(manifest.bootstrapRevision).toBe(1);
  expect(manifest.entries).toHaveLength(2);
  const ids = manifest.entries.map((e) => `${e.projectId}/${e.workspaceId}`).sort();
  expect(ids).toEqual(["proj-alpha/ws-shared", "proj-beta/ws-shared"]);
  for (const e of manifest.entries) {
    expect(e.projectRevision).toBe(1);
    expect(e.workspaceRevision).toBe(1);
  }
  const json = JSON.stringify(manifest);
  expect(json).not.toMatch(/governance|activeRef|completionPolicy|architectureBaseline/i);
}

export async function verifyGoalViewIsolation(
  harness: InMemoryHarness,
  alpha: GoalFixtureScope,
  beta: GoalFixtureScope,
): Promise<void> {
  const atLeast = harness.observedCursor();
  expect(atLeast).not.toBeNull();
  const alphaView = await harness.collaboration.goalView({
    projectId: alpha.projectId,
    workspaceId: alpha.workspaceId,
    goalId: alpha.goalId,
    ...(atLeast === null ? {} : { atLeastCursor: atLeast }),
  });
  const betaView = await harness.collaboration.goalView({
    projectId: beta.projectId,
    workspaceId: beta.workspaceId,
    goalId: beta.goalId,
    ...(atLeast === null ? {} : { atLeastCursor: atLeast }),
  });
  expect(alphaView.status).toBe("ready");
  expect(betaView.status).toBe("ready");
  if (alphaView.status !== "ready" || betaView.status !== "ready") return;
  expect(alphaView.goal.projectId).toBe(alpha.projectId);
  expect(betaView.goal.projectId).toBe(beta.projectId);
  expect(alphaView.goal.objective).not.toBe(betaView.goal.objective);
  expect(alphaView.goal.activePlanRevision).toBeNull();
  expect(alphaView.goal.aggregateRevision).toBe(1);

  // same local workspaceId/goalId keyed under the other project must not be hit
  const crossB = await harness.collaboration.goalView({
    projectId: alpha.projectId,
    workspaceId: beta.workspaceId,
    goalId: beta.goalId,
    ...(atLeast === null ? {} : { atLeastCursor: atLeast }),
  });
  expect((crossB as GoalViewResult).status).toBe("not_found");
}