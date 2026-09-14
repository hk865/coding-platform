import { describe, expect, it } from "vitest";
import {
  WORKSPACE_BOOTSTRAP_FIXTURE_V1,
  bootstrapEventsFor,
  bootstrapSnapshotsFor,
  fixtureDigest,
} from "../contract-support/fixtures/bootstrap-fixture-v1.js";
import { bootstrapSourceDigest, buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import {
  MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1,
  buildCreateGoalCommand,
  buildGoalCreateLedgerCommit,
  goalCreatedEventFor,
  goalSnapshotFor,
} from "../contract-support/fixtures/goal-fixtures.js";
import { normalizeObjective } from "../../src/contracts/command-event.js";
import { FIXED_ISO_2026_09_05 } from "../../src/testing/sequences.js";

describe("workspace bootstrap fixture", () => {
  it("has schemaVersion, 2 isolated scopes, and reuses the local workspaceId", () => {
    expect(WORKSPACE_BOOTSTRAP_FIXTURE_V1.schemaVersion).toBe(1);
    expect(WORKSPACE_BOOTSTRAP_FIXTURE_V1.entries).toHaveLength(2);
    const [a, b] = WORKSPACE_BOOTSTRAP_FIXTURE_V1.entries;
    expect(a!.projectId).not.toBe(b!.projectId);
    expect(a!.workspaceId).toBe(b!.workspaceId);
    expect(a!.projectId).toBeTruthy();
    expect(a!.workspaceId).toBeTruthy();
  });

  it("carries no governance revision or active ref", () => {
    const json = JSON.stringify(WORKSPACE_BOOTSTRAP_FIXTURE_V1);
    expect(json).not.toMatch(/governance|activeRef|completionPolicy|architectureBaseline/i);
  });

  it("digest is deterministic and sensitive to entry order", () => {
    expect(fixtureDigest()).toBe(fixtureDigest());
    const reordered = {
      schemaVersion: 1 as const,
      entries: [WORKSPACE_BOOTSTRAP_FIXTURE_V1.entries[1]!, WORKSPACE_BOOTSTRAP_FIXTURE_V1.entries[0]!],
    };
    expect(bootstrapSourceDigest(reordered)).not.toBe(fixtureDigest());
  });
});

describe("bootstrap builders", () => {
  it("emits per-project then per-workspace audit events, deterministic ids", () => {
    const command = buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
      commandId: "boot-1",
      correlationId: "corr-1",
      submittedAt: FIXED_ISO_2026_09_05,
    });
    const { events } = bootstrapEventsFor(command, {
      eventIds: ["e1", "e2", "e3", "e4"],
      occurredAt: FIXED_ISO_2026_09_05,
    });
    expect(events.map((e) => e.eventType)).toEqual([
      "ProjectBootstrapped",
      "ProjectBootstrapped",
      "WorkspaceBootstrapped",
      "WorkspaceBootstrapped",
    ]);
    expect(events.map((e) => e.eventId)).toEqual(["e1", "e2", "e3", "e4"]);
    const first = events[0]!;
    expect(first).toMatchObject({
      schemaVersion: 1,
      aggregateType: "Project",
      projectId: "proj-alpha",
      aggregateRevision: 1,
      causationId: "boot-1",
      correlationId: "corr-1",
      payload: { sourceDigest: fixtureDigest() },
    });
  });

  it("manifest snapshots carry entries with complete scope and revision 1", () => {
    const command = buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
      commandId: "boot-1",
      correlationId: "corr-1",
      submittedAt: FIXED_ISO_2026_09_05,
    });
    const { snapshots, manifestId } = bootstrapSnapshotsFor(command);
    expect(manifestId).toBe(fixtureDigest());
    const manifest = snapshots.at(-1)! as Extract<(typeof snapshots)[number], { ref: { aggregateType: "BootstrapManifest" } }>;
    expect(manifest).toMatchObject({
      ref: { aggregateType: "BootstrapManifest", manifestId: fixtureDigest() },
      revision: 1,
      sourceDigest: fixtureDigest(),
      bootstrapRevision: 1,
    });
    expect(snapshots.filter((s) => s.ref.aggregateType === "Project")).toHaveLength(2);
    expect(snapshots.filter((s) => s.ref.aggregateType === "Workspace")).toHaveLength(2);
    if (manifest.ref.aggregateType === "BootstrapManifest") {
      expect(manifest.entries).toHaveLength(2);
      for (const e of manifest.entries) {
        expect(e.projectRevision).toBe(1);
        expect(e.workspaceRevision).toBe(1);
        expect(e.projectId).toBeTruthy();
        expect(e.workspaceId).toBeTruthy();
      }
    }
  });
});

describe("goal create builders", () => {
  const scope = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[0]!;

  it("event and snapshot store the normalized objective, activePlanRevision null", () => {
    const command = buildCreateGoalCommand(scope, { commandId: "c1", correlationId: "c", submittedAt: "t" });
    const event = goalCreatedEventFor(command, { eventId: "e1", occurredAt: "t" });
    const snapshot = goalSnapshotFor(command);
    const normalized = normalizeObjective(scope.objective);
    expect(event.payload.objective).toBe(normalized);
    expect(snapshot.objective).toBe(normalized);
    expect(event.payload.activePlanRevision).toBeNull();
    expect(snapshot.activePlanRevision).toBeNull();
    expect(event.projectId).toBe(scope.projectId);
    expect(event.aggregateId).toBe(scope.goalId);
    expect(event.causationId).toBe("c1");
  });

  it("no Plan/Task/Run/outbox artifacts are produced", () => {
    const command = buildCreateGoalCommand(scope, { commandId: "c1", correlationId: "c", submittedAt: "t" });
    const batch = buildGoalCreateLedgerCommit(command, {
      eventId: "e1",
      occurredAt: "t",
      projectRevision: 1,
      workspaceRevision: 1,
    });
    expect(batch.outboxIntents).toEqual([]);
    expect(batch.events).toHaveLength(1);
    expect(batch.snapshots).toHaveLength(1);
    expect(batch.events[0]!.eventType).toBe("GoalCreated");
    expect(batch.expectedVersions.map((v) => v.revision)).toEqual([1, 1, 0]);
  });
});