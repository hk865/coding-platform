/**
 * P1-13 Lane A — ArchitectureEvolutionPolicy install / activate (third governance
 * kind).
 *
 * Driven purely through the REAL InMemoryLedger + ControlEngineImpl (no fake
 * ledger). A RecordingLedger subclass only observes the committed batch so the
 * deterministic fold can be asserted (fold-equality) against the shared
 * fixture-fold builders.
 *
 * Coverage (ticket 13-allowlisted-remediation + the P1-02 governance reference):
 *   - install happy path (fold-equality + snapshot precise digest; load(ref)
 *     found; NO active aggregate — install NEVER auto-activates);
 *   - digest tampering -> digest_mismatch, zero-write;
 *   - fixture missing field / unknown field -> invalid, zero-write;
 *   - idempotent replay -> committed(replayed), same eventIds/cursor;
 *   - same identity + different fingerprint -> idempotency_conflict, zero-write;
 *   - two projects install their own revisions without cross-talk;
 *   - activate happy path (active snapshot correct; activeRevision = target.ref;
 *     CAS Project@expectedRevision);
 *   - activate fold-equality vs buildP113ActivateLedgerCommit;
 *   - stale expected Project revision -> revision_conflict, active ref unmoved;
 *   - dangling ref (not installed) -> not_found, zero-write;
 *   - digest mismatch on installed identity -> not_found, zero-write.
 */
import { describe, expect, it } from "vitest";
import {
  ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1,
  buildP113InstallCommand,
  buildP113ActivateCommand,
  buildP113InstallLedgerCommit,
  buildP113ActivateLedgerCommit,
  p113PolicyRef,
  p113ActiveRef,
  p113PolicyPin,
  P113_PROJECT,
  P113_PROJECT_B,
} from "../../src/contracts/fixtures/architecture-evolution-policy-fixtures.js";
import type {
  InstallArchitectureEvolutionPolicyRevisionCommand,
  ActivateProjectArchitectureEvolutionPolicyCommand,
  ProjectArchitectureEvolutionPolicyActiveSnapshot,
} from "../../src/contracts/architecture-evolution-policy.js";
import { architectureEvolutionPolicyContentDigest } from "../../src/contracts/architecture-evolution-policy.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1 } from "../../src/contracts/fixtures/bootstrap-fixture-v1.js";
import { makeCommitCursor } from "../../src/contracts/ledger.js";
import type { LedgerCommit, LedgerCommitReceipt } from "../../src/contracts/ledger.js";
import { createControlEngine } from "../../src/control/control-engine.js";
import { createDeterministicDeps, FIXED_ISO_2026_09_05 } from "../../src/contracts/testing/sequences.js";
import { InMemoryLedger } from "../../src/ledger/in-memory-ledger.js";

const BOOT_DEPS = {
  commandId: "cmd-boot",
  correlationId: "corr-boot",
  submittedAt: FIXED_ISO_2026_09_05,
};

class RecordingLedger extends InMemoryLedger {
  commits: LedgerCommit[] = [];
  override async commit(batch: LedgerCommit): Promise<LedgerCommitReceipt> {
    this.commits.push(batch);
    return super.commit(batch);
  }
}

function makeEngine(ledger: InMemoryLedger = new RecordingLedger()) {
  const deps = createDeterministicDeps();
  const engine = createControlEngine({ ledger, now: deps.clock, eventId: deps.eventId });
  return { ledger, engine, deps };
}

function installDeps(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    commandId: "p113-install",
    projectId: P113_PROJECT,
    idempotencyKey: "inst-p113-alpha",
    ...overrides,
  };
}

function activateDeps(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    commandId: "p113-act",
    projectId: P113_PROJECT,
    expectedRevision: 1,
    ...overrides,
  };
}

async function eventsCount(ledger: InMemoryLedger): Promise<number> {
  const page = await ledger.events({ afterCursor: null, limit: 100 });
  return page.events.length;
}

/** Bootstrap a project (Project@1) + install the versioned policy; return the pin. */
async function bootstrappedPolicy(engine: ReturnType<typeof createControlEngine>): Promise<{ projectId: string; pin: ReturnType<typeof p113PolicyPin> }> {
  const boot = await engine.bootstrap(buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, BOOT_DEPS));
  expect(boot.status).toBe("committed");
  const installed = buildP113InstallCommand(ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1, installDeps());
  const rr = await engine.installArchitectureEvolutionPolicy(installed);
  expect(rr.status).toBe("committed");
  return { projectId: P113_PROJECT, pin: p113PolicyPin() };
}

describe("P1-13 ArchitectureEvolutionPolicy install", () => {
  it("persists the exact immutable revision (fold-equality; precise digest; no auto-activation)", async () => {
    const ledger = new RecordingLedger();
    const { engine } = makeEngine(ledger);
    const cmd = buildP113InstallCommand(ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1, installDeps());
    const receipt = await engine.installArchitectureEvolutionPolicy(cmd);

    const expected = buildP113InstallLedgerCommit(cmd, {
      eventId: "evt-0001",
      occurredAt: FIXED_ISO_2026_09_05,
    });

    expect(ledger.commits).toHaveLength(1);
    expect(ledger.commits[0]).toEqual(expected);
    expect(receipt).toEqual({
      status: "committed",
      commandId: "p113-install",
      replayed: false,
      revisionRef: p113PolicyRef(P113_PROJECT),
      contentDigest: architectureEvolutionPolicyContentDigest(ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1),
      eventIds: ["evt-0001"],
      commitCursor: makeCommitCursor(1),
    });

    // install persisted the precise digest/ref; load(ref) found.
    const loaded = await ledger.load(p113PolicyRef(P113_PROJECT));
    expect(loaded.status).toBe("found");
    if (loaded.status !== "found") return;
    const snap = loaded.snapshot as { ref: unknown; contentDigest: string; content: unknown };
    expect(snap.contentDigest).toBe(architectureEvolutionPolicyContentDigest(ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1));
    expect(snap.content).toEqual(ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1.content);

    // install NEVER auto-activates: no active aggregate, no Activated events.
    const active = await ledger.load(p113ActiveRef(P113_PROJECT));
    expect(active.status).toBe("not_found");
    const page = await ledger.events({ afterCursor: null, limit: 100 });
    const types = page.events.map((p) => p.event.eventType);
    expect(types).not.toContain("ArchitectureEvolutionPolicyActivated");
  });

  it("digest tampering -> digest_mismatch, zero-write", async () => {
    const ledger = new RecordingLedger();
    const { engine } = makeEngine(ledger);
    const before = await eventsCount(ledger);
    const cmd = buildP113InstallCommand(ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1, installDeps());
    const tampered = { ...cmd, payload: { ...cmd.payload, contentDigest: "0".repeat(64) } };
    const receipt = await engine.installArchitectureEvolutionPolicy(tampered);
    expect(receipt).toEqual({ status: "rejected", commandId: "p113-install", code: "digest_mismatch" });
    expect(await eventsCount(ledger)).toBe(before);
    expect(ledger.commits).toHaveLength(0);
  });

  it("fixture missing a required field -> invalid, zero-write", async () => {
    const ledger = new RecordingLedger();
    const { engine } = makeEngine(ledger);
    const before = await eventsCount(ledger);
    const cmd = buildP113InstallCommand(ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1, installDeps());
    const bad = {
      ...cmd,
      payload: { ...cmd.payload, fixture: { ...cmd.payload.fixture, contentType: undefined } },
    } as unknown as InstallArchitectureEvolutionPolicyRevisionCommand;
    const receipt = await engine.installArchitectureEvolutionPolicy(bad);
    expect(receipt).toEqual({ status: "rejected", commandId: "p113-install", code: "invalid" });
    expect(await eventsCount(ledger)).toBe(before);
    expect(ledger.commits).toHaveLength(0);
  });

  it("fixture with an unknown field -> invalid, zero-write", async () => {
    const ledger = new RecordingLedger();
    const { engine } = makeEngine(ledger);
    const before = await eventsCount(ledger);
    const cmd = buildP113InstallCommand(ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1, installDeps());
    const bad = {
      ...cmd,
      payload: { ...cmd.payload, fixture: { ...cmd.payload.fixture, bogus: true } },
    } as unknown as InstallArchitectureEvolutionPolicyRevisionCommand;
    const receipt = await engine.installArchitectureEvolutionPolicy(bad);
    expect(receipt).toEqual({ status: "rejected", commandId: "p113-install", code: "invalid" });
    expect(await eventsCount(ledger)).toBe(before);
    expect(ledger.commits).toHaveLength(0);
  });

  it("idempotent replay -> committed(replayed) with the ORIGINAL eventIds/cursor", async () => {
    const ledger = new RecordingLedger();
    const { engine } = makeEngine(ledger);
    const cmd = buildP113InstallCommand(ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1, installDeps());
    const first = await engine.installArchitectureEvolutionPolicy(cmd);
    expect(first.status).toBe("committed");
    if (first.status !== "committed") return;
    const after = await eventsCount(ledger);

    const replay = await engine.installArchitectureEvolutionPolicy(cmd);
    expect(replay.status).toBe("committed");
    if (replay.status !== "committed") return;
    expect(replay.replayed).toBe(true);
    expect(replay.eventIds).toEqual(first.eventIds);
    expect(replay.commitCursor).toEqual(first.commitCursor);
    expect(await eventsCount(ledger)).toBe(after);
  });

  it("same identity + different fingerprint -> idempotency_conflict, zero-write", async () => {
    const ledger = new RecordingLedger();
    const { engine } = makeEngine(ledger);
    await engine.installArchitectureEvolutionPolicy(buildP113InstallCommand(ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1, installDeps({ idempotencyKey: "inst-shared" })));
    const before = await eventsCount(ledger);
    const other = {
      ...ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1,
      content: { ...ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1.content, driftBudget: { maxRemediationsPerCycle: 5 } },
    };
    const receipt = await engine.installArchitectureEvolutionPolicy(
      buildP113InstallCommand(other, installDeps({ idempotencyKey: "inst-shared", commandId: "p113-install-2" })),
    );
    expect(receipt).toEqual({ status: "rejected", commandId: "p113-install-2", code: "idempotency_conflict" });
    expect(await eventsCount(ledger)).toBe(before);
  });

  it("two projects install their own revisions without cross-talk", async () => {
    const ledger = new RecordingLedger();
    const { engine } = makeEngine(ledger);
    const ra = await engine.installArchitectureEvolutionPolicy(buildP113InstallCommand(ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1, installDeps({ projectId: P113_PROJECT })));
    const rb = await engine.installArchitectureEvolutionPolicy(buildP113InstallCommand(ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1, installDeps({ projectId: P113_PROJECT_B, commandId: "p113-install-b", idempotencyKey: "inst-p113-beta" })));
    expect(ra.status).toBe("committed");
    expect(rb.status).toBe("committed");
    if (ra.status !== "committed" || rb.status !== "committed") return;
    const alpha = await ledger.load(p113PolicyRef(P113_PROJECT));
    const beta = await ledger.load(p113PolicyRef(P113_PROJECT_B));
    expect(alpha.status).toBe("found");
    expect(beta.status).toBe("found");
    if (alpha.status !== "found" || beta.status !== "found") return;
    expect((alpha.snapshot as { ref: { projectId: string } }).ref.projectId).toBe(P113_PROJECT);
    expect((beta.snapshot as { ref: { projectId: string } }).ref.projectId).toBe(P113_PROJECT_B);
    const alphaActive = await ledger.load(p113ActiveRef(P113_PROJECT));
    expect(alphaActive.status).toBe("not_found");
  });
});

describe("P1-13 ArchitectureEvolutionPolicy activate", () => {
  it("happy path: install then CAS-activate sets the typed Project active ref", async () => {
    const ledger = new RecordingLedger();
    const { engine } = makeEngine(ledger);
    const { projectId, pin } = await bootstrappedPolicy(engine);
    const receipt = await engine.activateArchitectureEvolutionPolicy(buildP113ActivateCommand(pin, activateDeps({ projectId })));
    expect(receipt.status).toBe("committed");
    if (receipt.status !== "committed") return;
    expect(receipt.activeRef).toEqual(p113ActiveRef(projectId));
    expect(receipt.activeRevision).toEqual(pin.ref);
    expect(receipt.replayed).toBe(false);

    const active = await ledger.load(p113ActiveRef(projectId));
    expect(active.status).toBe("found");
    if (active.status !== "found") return;
    const snap = active.snapshot as ProjectArchitectureEvolutionPolicyActiveSnapshot;
    expect(snap.activeRevision).toEqual(pin.ref);
    expect(snap.revision).toBe(1);
  });

  it("fold-equality: activation commit equals buildP113ActivateLedgerCommit", async () => {
    const ledger = new RecordingLedger();
    const { engine } = makeEngine(ledger);
    // Fresh ledger (no bootstrap) -> Project CAS at 0. Install then activate.
    await engine.installArchitectureEvolutionPolicy(buildP113InstallCommand(ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1, installDeps()));
    const activateCmd = buildP113ActivateCommand(p113PolicyPin(), activateDeps({ expectedRevision: 0 }));
    const receipt = await engine.activateArchitectureEvolutionPolicy(activateCmd);

    const expected = buildP113ActivateLedgerCommit(activateCmd, {
      eventId: "evt-0002",
      occurredAt: FIXED_ISO_2026_09_05,
      activeAggregateRevision: 1,
      projectRevision: 0,
    });
    expect(ledger.commits).toHaveLength(2);
    expect(ledger.commits[1]).toEqual(expected);
    expect(expected.events[0]!.aggregateRevision).toBe(1);
    expect(expected.expectedVersions[0]!.revision).toBe(0);
    expect(expected.expectedVersions[1]!.revision).toBe(0);

    expect(receipt.status).toBe("committed");
    if (receipt.status !== "committed") return;
    expect(receipt.activeRevision).toEqual(p113PolicyRef());
    expect(receipt.eventIds).toEqual(["evt-0002"]);
    expect(receipt.commitCursor).toEqual(makeCommitCursor(2));
  });

  it("CAS competition (stale expected Project revision) -> revision_conflict, active ref unmoved", async () => {
    const ledger = new RecordingLedger();
    const { engine } = makeEngine(ledger);
    const { projectId, pin } = await bootstrappedPolicy(engine);
    const first = await engine.activateArchitectureEvolutionPolicy(buildP113ActivateCommand(pin, activateDeps({ projectId })));
    expect(first.status).toBe("committed");
    const before = await eventsCount(ledger);

    const stale = await engine.activateArchitectureEvolutionPolicy(buildP113ActivateCommand(pin, activateDeps({ projectId, commandId: "p113-act-stale", expectedRevision: 99, idempotencyKey: "act-stale" })));
    expect(stale.status).toBe("rejected");
    if (stale.status !== "rejected") return;
    expect(stale.code).toBe("revision_conflict");
    expect(await eventsCount(ledger)).toBe(before);

    const active = await ledger.load(p113ActiveRef(projectId));
    expect(active.status).toBe("found");
    if (active.status !== "found") return;
    expect((active.snapshot as ProjectArchitectureEvolutionPolicyActiveSnapshot).activeRevision).toEqual(pin.ref);
  });

  it("dangling target (never installed) -> not_found, zero-write", async () => {
    const ledger = new RecordingLedger();
    const { engine } = makeEngine(ledger);
    const { projectId } = await bootstrappedPolicy(engine);
    const before = await eventsCount(ledger);
    const dangling = buildP113ActivateCommand(
      { ref: { aggregateType: "ArchitectureEvolutionPolicyRevision", projectId, policyId: "policy-absent", revision: 1 }, contentDigest: "1".repeat(64) },
      activateDeps({ projectId }),
    );
    const receipt = await engine.activateArchitectureEvolutionPolicy(dangling);
    expect(receipt).toEqual({ status: "rejected", commandId: "p113-act", code: "not_found" });
    expect(await eventsCount(ledger)).toBe(before);
    expect(ledger.commits).toHaveLength(2); // bootstrap + install only
  });

  it("digest mismatch on installed identity -> not_found, zero-write", async () => {
    const ledger = new RecordingLedger();
    const { engine } = makeEngine(ledger);
    const { projectId, pin } = await bootstrappedPolicy(engine);
    const before = await eventsCount(ledger);
    const wrongDigest = buildP113ActivateCommand(
      { ...pin, contentDigest: "2".repeat(64) },
      activateDeps({ projectId, commandId: "p113-act-digest" }),
    );
    const receipt = await engine.activateArchitectureEvolutionPolicy(wrongDigest);
    expect(receipt).toEqual({ status: "rejected", commandId: "p113-act-digest", code: "not_found" });
    expect(await eventsCount(ledger)).toBe(before);
    expect(ledger.commits).toHaveLength(2);
  });

  it("install does NOT auto-activate: the active ref stays not_found until an activate", async () => {
    const ledger = new RecordingLedger();
    const { engine } = makeEngine(ledger);
    await engine.bootstrap(buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, BOOT_DEPS));
    await engine.installArchitectureEvolutionPolicy(buildP113InstallCommand(ARCHITECTURE_EVOLUTION_POLICY_FIXTURE_V1, installDeps()));
    const active = await ledger.load(p113ActiveRef(P113_PROJECT));
    expect(active.status).toBe("not_found");
  });
});
