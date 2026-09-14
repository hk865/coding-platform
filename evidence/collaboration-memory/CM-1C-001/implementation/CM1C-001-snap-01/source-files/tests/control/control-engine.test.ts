/**
 * ControlEngine (Lane B, P1-00) unit tests.
 * Driven purely through the ControlEngine interface + ScriptedStateLedger
 * (a StateLedger double) — the engine's internal reducer is never read.
 *
 * Coverage (control-engine.md Test seam):
 *   - each guard rejection maps to the documented code with zero effective write;
 *   - deterministic fold equals the shared contract-fixture builders exactly;
 *   - idempotent replay -> replayed=true, same eventIds/cursor;
 *   - same identity, different payload -> idempotency_conflict;
 *   - CAS race -> revision_conflict with currentRevision;
 *   - MULTI_SCOPE isolation (same local workspaceId/goalId, different projects);
 *   - bootstrap: success / replay / not_empty / digest_mismatch / invalid /
 *     unknown schemaVersion, and atomic not_empty / idempotency via commit.
 */
import { describe, expect, it } from "vitest";
import { ControlEngineImpl, createControlEngine } from "../../src/control/control-engine/control-engine.js";
import {
  ScriptedStateLedger,
  notFoundResult,
} from "../contract-support/testing/state-ledger.double.js";
import type { LoadBehavior } from "../contract-support/testing/state-ledger.double.js";
import { createDeterministicDeps, FIXED_ISO_2026_09_05 } from "../../src/testing/sequences.js";
import {
  MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1,
  buildCreateGoalCommand,
  buildGoalCreateLedgerCommit,
  goalCreatedEventFor,
  goalSnapshotFor,
} from "../contract-support/fixtures/goal-fixtures.js";
import {
  WORKSPACE_BOOTSTRAP_FIXTURE_V1,
  buildBootstrapLedgerCommit,
  bootstrapSnapshotsFor,
  fixtureDigest,
} from "../contract-support/fixtures/bootstrap-fixture-v1.js";
import { buildBootstrapCommand, manifestFromSnapshot } from "../../src/contracts/bootstrap.js";
import { commandFingerprint, commandIdentityKey } from "../../src/contracts/command-event.js";
import type { CommitCursor, CreateGoalCommand } from "../../src/contracts/command-event.js";
import type { BootstrapManifestSnapshot, WorkspaceBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { makeCommitCursor } from "../../src/contracts/ledger.js";
import type {
  AggregateRef,
  GoalCreateLedgerCommitV1,
  GoalSnapshot,
  LedgerCommit,
  LedgerCommitReceipt,
  ProjectSnapshot,
  SnapshotResult,
  VersionedRef,
  WorkspaceSnapshot,
} from "../../src/contracts/ledger.js";

const FIXTURE = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1;
const ALPHA = FIXTURE.scopes[0]!;
const BETA = FIXTURE.scopes[1]!;

/** Valid, well-typed ledger snapshot builders for the double. */
function foundProject(ref: AggregateRef, revision: number): SnapshotResult {
  if (ref.aggregateType !== "Project") throw new Error("expected Project ref");
  const snapshot: ProjectSnapshot = { ref, revision };
  return { status: "found", snapshot };
}
function foundWorkspace(ref: AggregateRef, revision: number): SnapshotResult {
  if (ref.aggregateType !== "Workspace") throw new Error("expected Workspace ref");
  const snapshot: WorkspaceSnapshot = { ref, revision };
  return { status: "found", snapshot };
}
function foundGoal(ref: AggregateRef, revision: number): SnapshotResult {
  if (ref.aggregateType !== "Goal") throw new Error("expected Goal ref");
  const snapshot = {
    ref,
    workspaceRef: { aggregateType: "Workspace", projectId: ref.projectId, workspaceId: "" },
    objective: "",
    desiredState: "active",
    activePlanRevision: null,
    revision,
  } as unknown as GoalSnapshot;
  return { status: "found", snapshot };
}

type GoalLoad = "not_found" | { revision: number };

/**
 * Models a bootstrapped ledger: both projects and their workspaces exist at
 * revision 1; the goal is absent unless specified; an optional manifest is
 * returned for the BootstrapManifest aggregate.
 */
function scopeLoad(goal: GoalLoad, manifest?: BootstrapManifestSnapshot): LoadBehavior {
  return (ref) => {
    if (ref.aggregateType === "Project") return foundProject(ref, 1);
    if (ref.aggregateType === "Workspace") return foundWorkspace(ref, 1);
    if (ref.aggregateType === "Goal") {
      return goal === "not_found" ? notFoundResult(ref) : foundGoal(ref, goal.revision);
    }
    if (ref.aggregateType === "BootstrapManifest" && manifest) {
      return { status: "found", snapshot: manifest };
    }
    return notFoundResult(ref);
  };
}

type RejectionCode = "invalid_commit" | "revision_conflict" | "idempotency_conflict" | "not_empty" | "unavailable";

function rejected(code: RejectionCode, currentVersions?: VersionedRef[]): LedgerCommitReceipt {
  return currentVersions
    ? { status: "rejected", code, currentVersions }
    : { status: "rejected", code };
}

function committedReplay(batch: LedgerCommit, cursor: CommitCursor): LedgerCommitReceipt {
  return {
    status: "committed",
    replayed: true,
    identity: batch.identity,
    aggregateRevisions: batch.snapshots.map((s) => ({ ref: s.ref, revision: s.revision })),
    eventIds: batch.events.map((e) => e.eventId),
    commitCursor: cursor,
  };
}

function makeEngine(ledger: ScriptedStateLedger) {
  const deps = createDeterministicDeps();
  const engine = createControlEngine({ ledger, now: deps.clock, eventId: deps.eventId });
  return { engine, deps };
}

function alphaCommand(commandId: string, extra: Record<string, unknown> = {}): CreateGoalCommand {
  return {
    ...buildCreateGoalCommand(ALPHA, {
      commandId,
      correlationId: "corr-" + commandId,
      submittedAt: FIXED_ISO_2026_09_05,
      idempotencyKey: FIXTURE.sharedIdempotencyKey,
    }),
    ...extra,
  } as unknown as CreateGoalCommand;
}

describe("ControlEngine.submit: guards", () => {
  it("validation failure (unknown schemaVersion) -> invalid, zero write", async () => {
    const ledger = new ScriptedStateLedger();
    const { engine } = makeEngine(ledger);
    const receipt = await engine.submit(alphaCommand("cmd-invalid", { schemaVersion: 2 }));
    expect(receipt).toEqual({ status: "rejected", commandId: "cmd-invalid", code: "invalid" });
    expect(ledger.loads).toHaveLength(0);
    expect(ledger.commits).toHaveLength(0);
  });

  it("validation failure (empty-after-normalization objective) -> invalid, zero write", async () => {
    const ledger = new ScriptedStateLedger();
    const { engine } = makeEngine(ledger);
    const cmd = buildCreateGoalCommand(
      { ...ALPHA, objective: " \u00a0 " },
      { commandId: "cmd-empty", correlationId: "c", submittedAt: FIXED_ISO_2026_09_05, idempotencyKey: FIXTURE.sharedIdempotencyKey },
    );
    const receipt = await engine.submit(cmd);
    expect(receipt).toEqual({ status: "rejected", commandId: "cmd-empty", code: "invalid" });
    expect(ledger.commits).toHaveLength(0);
  });

  it("Project not found -> not_found, zero write (no commit)", async () => {
    const ledger = new ScriptedStateLedger({ load: (ref) => notFoundResult(ref) });
    const { engine } = makeEngine(ledger);
    const receipt = await engine.submit(alphaCommand("cmd-nf"));
    expect(receipt).toEqual({ status: "rejected", commandId: "cmd-nf", code: "not_found" });
    expect(ledger.commits).toHaveLength(0);
    expect(ledger.loads).toHaveLength(1);
    expect(ledger.loads[0]).toEqual({ aggregateType: "Project", projectId: "proj-alpha" });
  });

  it("Workspace not found under project -> not_found, no commit", async () => {
    const ledger = new ScriptedStateLedger({
      load: (ref) => {
        if (ref.aggregateType === "Project") return foundProject(ref, 1);
        return notFoundResult(ref);
      },
    });
    const { engine } = makeEngine(ledger);
    const receipt = await engine.submit(alphaCommand("cmd-ws-nf"));
    expect(receipt).toEqual({ status: "rejected", commandId: "cmd-ws-nf", code: "not_found" });
    expect(ledger.commits).toHaveLength(0);
    expect(ledger.loads.map((r) => r.aggregateType)).toEqual(["Project", "Workspace"]);
  });

  it("Goal already exists (new create; ledger CAS rejects) -> revision_conflict w/ currentRevision", async () => {
    const ledger = new ScriptedStateLedger({
      load: scopeLoad({ revision: 1 }),
      commit: () =>
        rejected("revision_conflict", [
          { ref: { aggregateType: "Goal", projectId: "proj-alpha", goalId: "goal-1" }, revision: 1 },
        ]),
    });
    const { engine } = makeEngine(ledger);
    const receipt = await engine.submit(alphaCommand("cmd-dup"));
    expect(receipt).toEqual({
      status: "rejected",
      commandId: "cmd-dup",
      code: "revision_conflict",
      currentRevision: 1,
    });
    // the ledger rejected the goal@0 CAS, so nothing was persisted
    expect(ledger.commits).toHaveLength(1);
  });

  it("Goal exists + ledger lacks currentVersions -> uses loaded goal revision", async () => {
    const ledger = new ScriptedStateLedger({
      load: scopeLoad({ revision: 3 }),
      commit: () => rejected("revision_conflict"),
    });
    const { engine } = makeEngine(ledger);
    const receipt = await engine.submit(alphaCommand("cmd-dup2"));
    expect(receipt).toEqual({
      status: "rejected",
      commandId: "cmd-dup2",
      code: "revision_conflict",
      currentRevision: 3,
    });
  });
});

describe("ControlEngine.submit: deterministic fold", () => {
  it("produces exactly the shared fixture-builder ledger commit", async () => {
    const ledger = new ScriptedStateLedger({ load: scopeLoad("not_found") });
    const { engine } = makeEngine(ledger);
    const cmd = alphaCommand("cmd-fold");
    const receipt = await engine.submit(cmd);

    const expected = buildGoalCreateLedgerCommit(cmd, {
      eventId: "evt-0001",
      occurredAt: FIXED_ISO_2026_09_05,
      projectRevision: 1,
      workspaceRevision: 1,
    });

    expect(ledger.commits).toHaveLength(1);
    expect(ledger.commits[0]).toEqual(expected);
    expect(expected.events[0]).toEqual(
      goalCreatedEventFor(cmd, { eventId: "evt-0001", occurredAt: FIXED_ISO_2026_09_05 }),
    );
    expect(expected.snapshots[0]).toEqual(goalSnapshotFor(cmd));

    expect(receipt).toEqual({
      status: "committed",
      commandId: "cmd-fold",
      replayed: false,
      aggregateRevision: 1,
      eventIds: ["evt-0001"],
      commitCursor: makeCommitCursor(1),
    });
  });

  it("Event/snapshot carry normalized objective, activePlanRevision null, no outbox", async () => {
    const ledger = new ScriptedStateLedger({ load: scopeLoad("not_found") });
    const { engine } = makeEngine(ledger);
    const cmd = alphaCommand("cmd-norm");
    await engine.submit(cmd);
    const batch = ledger.commits[0] as GoalCreateLedgerCommitV1;
    const norm = ALPHA.objective.trim().normalize("NFC");
    expect(batch.events[0]!.payload.objective).toBe(norm);
    expect(batch.snapshots[0]!.objective).toBe(norm);
    expect(batch.events[0]!.payload.activePlanRevision).toBeNull();
    expect(batch.snapshots[0]!.activePlanRevision).toBeNull();
    expect(batch.outboxIntents).toEqual([]);
    expect(batch.events).toHaveLength(1);
    expect(batch.snapshots).toHaveLength(1);
    expect(batch.snapshots[0]!.revision).toBe(1);
  });
});

describe("ControlEngine.submit: idempotency and conflicts", () => {
  it("same request replay -> committed, replayed=true, same eventIds/cursor", async () => {
    const ledger = new ScriptedStateLedger({
      load: scopeLoad({ revision: 1 }),
      commit: (batch) => committedReplay(batch, makeCommitCursor(5)),
    });
    const { engine } = makeEngine(ledger);
    const cmd = alphaCommand("cmd-replay");
    const receipt = await engine.submit(cmd);
    expect(receipt).toEqual({
      status: "committed",
      commandId: "cmd-replay",
      replayed: true,
      aggregateRevision: 1,
      eventIds: ["evt-0001"],
      commitCursor: makeCommitCursor(5),
    });
    // engine loaded the goal via its full ref and reached the ledger (no short-circuit)
    expect(ledger.loads.some((r) => r.aggregateType === "Goal")).toBe(true);
    expect(ledger.commits).toHaveLength(1);
  });

  it("same identity, different payload -> idempotency_conflict", async () => {
    const ledger = new ScriptedStateLedger({
      load: scopeLoad("not_found"),
      commit: () => rejected("idempotency_conflict"),
    });
    const { engine } = makeEngine(ledger);
    const first = alphaCommand("cmd-idem-1");
    const second = alphaCommand("cmd-idem-2", { payload: { workspaceId: ALPHA.workspaceId, objective: "a different objective" } });
    expect(commandIdentityKey(first.identity)).toBe(commandIdentityKey(second.identity));
    expect(commandFingerprint(first)).not.toBe(commandFingerprint(second));

    const receipt = await engine.submit(second);
    expect(receipt).toEqual({ status: "rejected", commandId: "cmd-idem-2", code: "idempotency_conflict" });
  });

  it("CAS race (reference changed between load and commit) -> revision_conflict w/ currentVersion", async () => {
    const ledger = new ScriptedStateLedger({
      load: scopeLoad("not_found"),
      commit: () =>
        rejected("revision_conflict", [
          { ref: { aggregateType: "Project", projectId: "proj-alpha" }, revision: 2 },
        ]),
    });
    const { engine } = makeEngine(ledger);
    const receipt = await engine.submit(alphaCommand("cmd-cas"));
    expect(receipt).toEqual({
      status: "rejected",
      commandId: "cmd-cas",
      code: "revision_conflict",
      currentRevision: 2,
    });
    const submitted = ledger.commits[0] as GoalCreateLedgerCommitV1;
    expect(submitted.expectedVersions.map((v) => v.revision)).toEqual([1, 1, 0]);
  });

  it("ledger unavailable -> unavailable", async () => {
    const ledger = new ScriptedStateLedger({ load: scopeLoad("not_found"), commit: () => rejected("unavailable") });
    const { engine } = makeEngine(ledger);
    const receipt = await engine.submit(alphaCommand("cmd-unavail"));
    expect(receipt).toEqual({ status: "rejected", commandId: "cmd-unavail", code: "unavailable" });
  });
});

describe("ControlEngine.submit: MULTI_SCOPE isolation", () => {
  it("reused local workspaceId/goalId under different projects never cross-talk", async () => {
    const ledger = new ScriptedStateLedger({ load: scopeLoad("not_found") });
    const { engine } = makeEngine(ledger);

    const alphaCmd = buildCreateGoalCommand(ALPHA, {
      commandId: "cmd-a",
      correlationId: "corr-a",
      submittedAt: FIXED_ISO_2026_09_05,
      idempotencyKey: FIXTURE.sharedIdempotencyKey,
    });
    const betaCmd = buildCreateGoalCommand(BETA, {
      commandId: "cmd-b",
      correlationId: "corr-b",
      submittedAt: FIXED_ISO_2026_09_05,
      idempotencyKey: FIXTURE.sharedIdempotencyKey,
    });

    const alphaReceipt = await engine.submit(alphaCmd);
    const betaReceipt = await engine.submit(betaCmd);
    expect(alphaReceipt).toMatchObject({ status: "committed", commandId: "cmd-a" });
    expect(betaReceipt).toMatchObject({ status: "committed", commandId: "cmd-b" });

    const loads = ledger.loads;
    expect(loads).toContainEqual({ aggregateType: "Project", projectId: "proj-alpha" });
    expect(loads).toContainEqual({ aggregateType: "Project", projectId: "proj-beta" });
    expect(loads).toContainEqual({ aggregateType: "Workspace", projectId: "proj-alpha", workspaceId: "ws-shared" });
    expect(loads).toContainEqual({ aggregateType: "Workspace", projectId: "proj-beta", workspaceId: "ws-shared" });

    expect(ledger.commits).toHaveLength(2);
    const [a, b] = ledger.commits as [GoalCreateLedgerCommitV1, GoalCreateLedgerCommitV1];
    expect(a.identity.projectId).toBe("proj-alpha");
    expect(b.identity.projectId).toBe("proj-beta");
    expect(a.fingerprint).not.toBe(b.fingerprint);
    for (const v of a.expectedVersions) expect(JSON.stringify(v.ref)).not.toContain("proj-beta");
    for (const v of b.expectedVersions) expect(JSON.stringify(v.ref)).not.toContain("proj-alpha");

    expect(a).toEqual(
      buildGoalCreateLedgerCommit(alphaCmd, { eventId: "evt-0001", occurredAt: FIXED_ISO_2026_09_05, projectRevision: 1, workspaceRevision: 1 }),
    );
    expect(b).toEqual(
      buildGoalCreateLedgerCommit(betaCmd, { eventId: "evt-0002", occurredAt: FIXED_ISO_2026_09_05, projectRevision: 1, workspaceRevision: 1 }),
    );
  });
});

describe("ControlEngine.bootstrap", () => {
  function bootCommand(commandId: string, idempotencyKey?: string): WorkspaceBootstrapCommand {
    const deps: { commandId: string; correlationId: string; submittedAt: string; idempotencyKey?: string } = {
      commandId,
      correlationId: "corr-" + commandId,
      submittedAt: FIXED_ISO_2026_09_05,
    };
    if (idempotencyKey !== undefined) deps.idempotencyKey = idempotencyKey;
    return buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, deps);
  }
  const EVENT_IDS = ["evt-0001", "evt-0002", "evt-0003", "evt-0004"];

  it("commits the exact fixture-builder batch and a deterministic manifest", async () => {
    const ledger = new ScriptedStateLedger();
    const { engine } = makeEngine(ledger);
    const cmd = bootCommand("boot-1");
    const receipt = await engine.bootstrap(cmd);

    const expected = buildBootstrapLedgerCommit(cmd, { eventIds: EVENT_IDS, occurredAt: FIXED_ISO_2026_09_05 });
    expect(ledger.commits).toHaveLength(1);
    expect(ledger.commits[0]).toEqual(expected);

    const manifestSnap = expected.snapshots.at(-1) as BootstrapManifestSnapshot;
    expect(receipt).toEqual({
      status: "committed",
      commandId: "boot-1",
      replayed: false,
      manifest: manifestFromSnapshot(manifestSnap),
      aggregateRevisions: expected.snapshots.map((s) => ({ ref: s.ref, revision: s.revision })),
      eventIds: EVENT_IDS,
      commitCursor: makeCommitCursor(1),
    });
  });

  it("reused local workspaceId across projects -> isolated snapshots + manifest", async () => {
    const ledger = new ScriptedStateLedger();
    const { engine } = makeEngine(ledger);
    await engine.bootstrap(bootCommand("boot-iso"));
    const batch = ledger.commits[0]!;
    const projects = batch.snapshots.filter((s) => s.ref.aggregateType === "Project");
    const workspaces = batch.snapshots.filter((s) => s.ref.aggregateType === "Workspace");
    expect(projects).toHaveLength(2);
    expect(workspaces).toHaveLength(2);
    expect(projects.map((p) => (p.ref as { projectId: string }).projectId).sort()).toEqual(["proj-alpha", "proj-beta"]);
    const manifest = batch.snapshots.at(-1) as BootstrapManifestSnapshot;
    expect(manifest.sourceDigest).toBe(fixtureDigest());
    expect(manifest.entries.map((e) => e.projectId).sort()).toEqual(["proj-alpha", "proj-beta"]);
  });

  it("replay: commits nothing new, rebuilds manifest from the ledger aggregate", async () => {
    const cmd = bootCommand("boot-replay");
    const manifestSnap = bootstrapSnapshotsFor(cmd).snapshots.at(-1) as BootstrapManifestSnapshot;
    const ledger = new ScriptedStateLedger({
      load: scopeLoad("not_found", manifestSnap),
      commit: (batch) => committedReplay(batch, makeCommitCursor(4)),
    });
    const { engine } = makeEngine(ledger);
    const receipt = await engine.bootstrap(cmd);

    const expected = buildBootstrapLedgerCommit(cmd, { eventIds: EVENT_IDS, occurredAt: FIXED_ISO_2026_09_05 });
    expect(receipt).toEqual({
      status: "committed",
      commandId: "boot-replay",
      replayed: true,
      manifest: manifestFromSnapshot(manifestSnap),
      aggregateRevisions: expected.snapshots.map((s) => ({ ref: s.ref, revision: s.revision })),
      eventIds: EVENT_IDS,
      commitCursor: makeCommitCursor(4),
    });
    expect(ledger.loads.some((r) => r.aggregateType === "BootstrapManifest")).toBe(true);
  });

  it("non-empty ledger -> not_empty (deterministic, no partial write)", async () => {
    const ledger = new ScriptedStateLedger({ commit: () => rejected("not_empty") });
    const { engine } = makeEngine(ledger);
    const receipt = await engine.bootstrap(bootCommand("boot-ne", "another-key"));
    expect(receipt).toEqual({ status: "rejected", commandId: "boot-ne", code: "not_empty" });
    expect(ledger.loads).toHaveLength(0);
  });

  it("digest mismatch -> digest_mismatch, zero write", async () => {
    const ledger = new ScriptedStateLedger();
    const { engine } = makeEngine(ledger);
    const cmd = bootCommand("boot-digest");
    const tampered = { ...cmd, payload: { ...cmd.payload, sourceDigest: "deadbeef" } };
    const receipt = await engine.bootstrap(tampered);
    expect(receipt).toEqual({ status: "rejected", commandId: "boot-digest", code: "digest_mismatch" });
    expect(ledger.commits).toHaveLength(0);
    expect(ledger.loads).toHaveLength(0);
  });

  it("structural issue (empty entries) -> invalid, zero write", async () => {
    const ledger = new ScriptedStateLedger();
    const { engine } = makeEngine(ledger);
    const cmd = bootCommand("boot-empty");
    const tampered = { ...cmd, payload: { ...cmd.payload, entries: [] } };
    const receipt = await engine.bootstrap(tampered);
    expect(receipt).toEqual({ status: "rejected", commandId: "boot-empty", code: "invalid" });
    expect(ledger.commits).toHaveLength(0);
  });

  it("unknown schemaVersion -> invalid, zero write", async () => {
    const ledger = new ScriptedStateLedger();
    const { engine } = makeEngine(ledger);
    const cmd = { ...bootCommand("boot-ver"), schemaVersion: 99 } as unknown as WorkspaceBootstrapCommand;
    const receipt = await engine.bootstrap(cmd);
    expect(receipt).toEqual({ status: "rejected", commandId: "boot-ver", code: "invalid" });
    expect(ledger.commits).toHaveLength(0);
  });

  it("ledger refuses bootstrap via idempotency_conflict", async () => {
    const ledger = new ScriptedStateLedger({ commit: () => rejected("idempotency_conflict") });
    const { engine } = makeEngine(ledger);
    const receipt = await engine.bootstrap(bootCommand("boot-iidem"));
    expect(receipt).toEqual({ status: "rejected", commandId: "boot-iidem", code: "idempotency_conflict" });
  });
});

describe("ControlEngine construction", () => {
  it("createControlEngine and new ControlEngineImpl are interchangeable", async () => {
    const ledger = new ScriptedStateLedger({ load: scopeLoad("not_found") });
    const depsCtor = createDeterministicDeps();
    const depsFactory = createDeterministicDeps();
    const viaCtor = new ControlEngineImpl({ ledger, now: depsCtor.clock, eventId: depsCtor.eventId });
    const viaFactory = createControlEngine({ ledger, now: depsFactory.clock, eventId: depsFactory.eventId });
    const cmd = alphaCommand("cmd-ctor");
    const r1 = await viaCtor.submit(cmd);
    const r2 = await viaFactory.submit(cmd);
    expect(r1).toEqual(r2);
  });
});

