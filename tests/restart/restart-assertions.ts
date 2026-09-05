/**
 * P1-01 dual-path restart assertions:
 *   (a) snapshot-load path  — after close/reopen, ledger.load() returns the
 *       PERSISTED canonical GoalSnapshot. The StateLedger never folds Events
 *       to build canonical state, so equality with the pre-restart snapshot is
 *       exact (field-by-field, both scopes), and uninitialized scopes stay absent.
 *   (b) rebuild path        — after close/reopen, a FRESH read model consumes
 *       the persisted EventPage(s) and reproduces the SAME GoalView as the
 *       pre-restart incremental projection (field-by-field, both scopes).
 * Owner: P1-01 lane C (skeleton by integrator, 2026-09-05).
 */
import { expect } from "vitest";
import {
  manifestFromSnapshot,
  type BootstrapManifestSnapshot,
} from "../../src/contracts/bootstrap.js";
import type { WorkspaceBootstrapManifest } from "../../src/contracts/bootstrap.js";
import type { GoalSnapshot } from "../../src/contracts/ledger.js";
import type { GoalViewResult } from "../../src/contracts/goal-view.js";
import type { CommitCursor } from "../../src/contracts/command-event.js";
import type { GoalFixtureScope } from "../../src/contracts/fixtures/goal-fixtures.js";
import type { PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import type { RestartRuns } from "./restart-fixtures.js";

/** A project that was never bootstrapped — must stay absent after restart. */
const ABSENT_PROJECT_ID = "proj-absent-000";

export async function loadGoal(
  harness: PersistentSqliteHarness,
  projectId: string,
  goalId: string,
): Promise<GoalSnapshot | null> {
  const result = await harness.ledger.load({ aggregateType: "Goal", projectId, goalId });
  if (result.status === "not_found") return null;
  if (result.snapshot.ref.aggregateType !== "Goal") {
    throw new Error("expected a Goal snapshot");
  }
  // Narrowed by the runtime guard above; TS cannot narrow the nested union path.
  return result.snapshot as GoalSnapshot;
}

export interface RestartCapture {
  /** Canonical snapshots BEFORE the restart (loaded from the ledger). */
  alphaSnapshot: GoalSnapshot;
  betaSnapshot: GoalSnapshot;
  /** Goal views BEFORE the restart (incremental projection into the read model). */
  alphaView: GoalViewResult;
  betaView: GoalViewResult;
  /** Deterministic bootstrap manifest, as observed BEFORE the restart. */
  manifest: WorkspaceBootstrapManifest;
  /** Read model cursor that covered every persisted event BEFORE the restart. */
  observedCursor: CommitCursor;
}

export async function capturePreRestart(
  harness: PersistentSqliteHarness,
  runs: RestartRuns,
  alpha: GoalFixtureScope,
  beta: GoalFixtureScope,
): Promise<RestartCapture> {
  const observedCursor = harness.observedCursor();
  expect(observedCursor).not.toBeNull();
  if (observedCursor === null) throw new Error("projection did not advance");

  const alphaSnapshot = await loadGoal(harness, alpha.projectId, alpha.goalId);
  const betaSnapshot = await loadGoal(harness, beta.projectId, beta.goalId);
  if (alphaSnapshot === null || betaSnapshot === null) {
    throw new Error("goals were not persisted before the restart");
  }

  const alphaView = await harness.collaboration.goalView({
    projectId: alpha.projectId,
    workspaceId: alpha.workspaceId,
    goalId: alpha.goalId,
    atLeastCursor: observedCursor,
  });
  const betaView = await harness.collaboration.goalView({
    projectId: beta.projectId,
    workspaceId: beta.workspaceId,
    goalId: beta.goalId,
    atLeastCursor: observedCursor,
  });
  expect(alphaView.status).toBe("ready");
  expect(betaView.status).toBe("ready");

  if (runs.bootstrap.status !== "committed") {
    throw new Error("bootstrap did not commit");
  }
  return {
    alphaSnapshot,
    betaSnapshot,
    alphaView,
    betaView,
    manifest: runs.bootstrap.manifest,
    observedCursor,
  };
}

/**
 * Path (a): after close/reopen the canonical Goal is loaded from the persisted
 * snapshot — NOT folded from the event log. Both scopes match exactly, the
 * manifest is the persisted BootstrapManifest snapshot, and uninitialized
 * scopes stay absent.
 */
export async function verifySnapshotLoadPath(
  after: PersistentSqliteHarness,
  capture: RestartCapture,
  alpha: GoalFixtureScope,
  beta: GoalFixtureScope,
): Promise<void> {
  expect(await loadGoal(after, alpha.projectId, alpha.goalId)).toEqual(
    capture.alphaSnapshot,
  );
  expect(await loadGoal(after, beta.projectId, beta.goalId)).toEqual(
    capture.betaSnapshot,
  );

  const manifest = await after.ledger.load({
    aggregateType: "BootstrapManifest",
    manifestId: capture.manifest.sourceDigest,
  });
  expect(manifest.status).toBe("found");
  if (manifest.status === "found") {
    if (manifest.snapshot.ref.aggregateType !== "BootstrapManifest") {
      throw new Error("expected a BootstrapManifest snapshot");
    }
    expect(
      manifestFromSnapshot(manifest.snapshot as BootstrapManifestSnapshot),
    ).toEqual(capture.manifest);
  }

  // Scope isolation holds across the restart: the uninitialized scope stays
  // absent, and both scopes' rows are keyed by their full scope (already
  // proven by the exact equality above — alpha's row carries alpha's data).
  expect(
    await after.ledger.load({ aggregateType: "Project", projectId: ABSENT_PROJECT_ID }),
  ).toMatchObject({ status: "not_found" });
  expect(await loadGoal(after, ABSENT_PROJECT_ID, alpha.goalId)).toBeNull();
}

/**
 * Path (b): after close/reopen a FRESH read model consumes the persisted
 * EventPage(s); the rebuilt GoalView equals the pre-restart incremental view.
 */
export async function verifyRebuildViews(
  rebuilt: PersistentSqliteHarness,
  capture: RestartCapture,
  alpha: GoalFixtureScope,
  beta: GoalFixtureScope,
): Promise<void> {
  const alphaView = await rebuilt.collaboration.goalView({
    projectId: alpha.projectId,
    workspaceId: alpha.workspaceId,
    goalId: alpha.goalId,
    atLeastCursor: capture.observedCursor,
  });
  const betaView = await rebuilt.collaboration.goalView({
    projectId: beta.projectId,
    workspaceId: beta.workspaceId,
    goalId: beta.goalId,
    atLeastCursor: capture.observedCursor,
  });
  expect(alphaView).toEqual(capture.alphaView);
  expect(betaView).toEqual(capture.betaView);
}
