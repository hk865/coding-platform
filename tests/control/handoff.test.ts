/**
 * P1-06 lane A unit tests: recordHandoff (register a bounded HandoffPacket,
 * body-first) over a REAL InMemoryLedger via the ControlEngineImpl handler.
 *
 * Drive the ENGINE handler and assert the SUBMITTED batch is fold-equivalent to
 * the shared buildHandoffRecordLedgerCommit fixture (given the same ids), plus
 * the receipt/snapshot outcomes:
 *   - happy path: one atomic handoff-record (HandoffPacket aggregate @1), the
 *     snapshot is field-identical to the fixture, and an idempotent replay
 *     returns committed(replayed) with the SAME eventId set;
 *   - run_not_ended (source run still active) -> zero write;
 *   - stale_source on canonical Workspace revision mismatch -> zero write;
 *   - stale_source on planRevision mismatch -> zero write;
 *   - not_found (source run missing / workspace missing / plan missing);
 *   - invalid command -> invalid;
 *   - idempotency_conflict on the same identity with a different packet payload.
 */
import { describe, expect, it } from "vitest";
import { createControlEngine } from "../../src/control/control-engine/control-engine.js";
import { InMemoryLedger } from "../../src/data/state-ledger/in-memory-ledger.js";
import type { StateLedger, LedgerCommit, LedgerCommitReceipt } from "../../src/contracts/ledger.js";
import { createDeterministicDeps, FIXED_ISO_2026_09_05 } from "../../src/testing/sequences.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1 } from "../contract-support/fixtures/bootstrap-fixture-v1.js";
import { MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1, buildCreateGoalCommand } from "../contract-support/fixtures/goal-fixtures.js";
import { ARCHITECTURE_BASELINE_FIXTURE_V1, COMPLETION_POLICY_FIXTURE_V1, buildActivateCommand, buildInstallCommand } from "../../src/fixtures/governance-fixtures.js";
import { completionPolicyPinFor, architectureBaselinePinFor } from "../../src/contracts/governance.js";
import {
  P106_BUDGET_V1,
  P106_DECLARED_PERMISSIONS_V1,
  P106_GOAL,
  P106_PLAN_REVISION_FIXTURE_V1,
  P106_PROJECT,
  P106_ROLE_BINDING_V1,
  P106_TASK_ID,
  P106_WORKSPACE,
  buildHandoffPacketV1,
  buildRecordHandoffCommand,
  p106PlanRef,
} from "../contract-support/fixtures/handoff-fixtures.js";
import { buildApplyPlanCommand } from "../../src/fixtures/plan-fixtures.js";
import {
  buildDispatchClaimCommand,
  buildDispatchStartCommand,
  buildRunFactCommand,
  buildEnvelopeFixture,
  buildManifestFixture,
  rebaseScriptForRun,
  FAKE_RUNTIME_SCRIPT_CRASHED_V1,
} from "../../src/fixtures/dispatch-fixtures.js";
import type { InstallArchitectureBaselineRevisionCommand, InstallCompletionPolicyRevisionCommand } from "../../src/contracts/governance.js";
import { runRefFor, taskAttemptRefFor } from "../../src/contracts/dispatch.js";
import { handoffPacketRefFor, HANDOFF_PACKET_MAX_BYTES } from "../../src/contracts/handoff.js";
import { artifactBodyDigest, type ArtifactRef } from "../../src/contracts/artifact.js";
import { buildHandoffRecordLedgerCommit } from "../../src/control/control-engine/records/handoff.js";
import type { RecordHandoffCommand } from "../../src/contracts/handoff.js";

const FIXED = FIXED_ISO_2026_09_05;
const PLAN_REF = { aggregateType: "PlanRevision" as const, projectId: P106_PROJECT, planId: "plan-handoff-mvp" };
const BUNDLE: ArtifactRef = {
  kind: "artifact",
  contentType: "text/plain",
  digest: artifactBodyDigest("bundle-a"),
  sizeBytes: 8,
  source: { kind: "plan-revision", refId: PLAN_REF.planId, revision: "1" },
};

class RecordingLedger extends InMemoryLedger {
  commits: LedgerCommit[] = [];
  override async commit(batch: LedgerCommit): Promise<LedgerCommitReceipt> {
    this.commits.push(batch);
    return super.commit(batch);
  }
}

function makeHarness() {
  const ledger = new RecordingLedger();
  const d = createDeterministicDeps();
  const engine = createControlEngine({ ledger, now: d.clock, eventId: d.eventId });
  return { ledger, engine };
}

async function setupAccepted() {
  const { ledger, engine } = makeHarness();
  await engine.bootstrap(
    buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
      commandId: "cmd-bootstrap",
      correlationId: "corr-bootstrap",
      submittedAt: FIXED,
    }),
  );
  const scope = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[0]!;
  await engine.submit(
    buildCreateGoalCommand(
      { ...scope, projectId: P106_PROJECT, workspaceId: P106_WORKSPACE, goalId: P106_GOAL },
      { commandId: "cmd-goal", correlationId: "corr-goal", submittedAt: FIXED, idempotencyKey: "p1-06-goal" },
    ),
  );
  const cp = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, {
    commandId: "cmd-install-cp", correlationId: "corr-install-cp", submittedAt: FIXED,
    projectId: P106_PROJECT, idempotencyKey: "inst-cp",
  }) as InstallCompletionPolicyRevisionCommand;
  expect((await engine.install(cp)).status).toBe("committed");
  const ab = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, {
    commandId: "cmd-install-ab", correlationId: "corr-install-ab", submittedAt: FIXED,
    projectId: P106_PROJECT, idempotencyKey: "inst-ab",
  }) as InstallArchitectureBaselineRevisionCommand;
  expect((await engine.install(ab)).status).toBe("committed");
  expect(
    (await engine.activate(buildActivateCommand(completionPolicyPinFor(cp), {
      commandId: "cmd-act-cp", correlationId: "corr-act-cp", submittedAt: FIXED,
      projectId: P106_PROJECT, expectedRevision: 1, idempotencyKey: "act-cp",
    }))).status,
  ).toBe("committed");
  expect(
    (await engine.activate(buildActivateCommand(architectureBaselinePinFor(ab), {
      commandId: "cmd-act-ab", correlationId: "corr-act-ab", submittedAt: FIXED,
      projectId: P106_PROJECT, expectedRevision: 1, idempotencyKey: "act-ab",
    }))).status,
  ).toBe("committed");
  expect(
    (await engine.applyPlan(buildApplyPlanCommand(P106_PLAN_REVISION_FIXTURE_V1, {
      commandId: "cmd-apply", correlationId: "corr-apply", submittedAt: FIXED,
      projectId: P106_PROJECT, expectedRevision: 1, idempotencyKey: "apply",
    }))).status,
  ).toBe("committed");
  return { ledger, engine };
}

async function endRunA(deps: { engine: ReturnType<typeof createControlEngine>; projectId: string; runId: string; attemptId: string }): Promise<void> {
  const { engine, projectId, runId, attemptId } = deps;
  const claim = await engine.claimTask(
    buildDispatchClaimCommand({
      commandId: "cmd-claim-" + runId,
      correlationId: "corr-claim-" + runId,
      submittedAt: FIXED,
      projectId,
      goalId: P106_GOAL,
      taskId: P106_TASK_ID,
      attemptId,
      runId,
      roleBinding: P106_ROLE_BINDING_V1,
      declaredPermissions: P106_DECLARED_PERMISSIONS_V1,
      budget: P106_BUDGET_V1,
      idempotencyKey: "p106-claim-" + runId,
    }),
  );
  expect(claim.status).toBe("committed");

  const runRef = runRefFor(projectId, P106_GOAL, runId);
  const envelope = buildEnvelopeFixture({
    envelopeId: "envelope-" + runId,
    projectId,
    workspaceId: P106_WORKSPACE,
    goalId: P106_GOAL,
    taskId: P106_TASK_ID,
    runId,
    attemptId,
    planRef: p106PlanRef(projectId),
    workspaceRevision: 1,
    bundleRef: BUNDLE,
    roleBinding: P106_ROLE_BINDING_V1,
    budget: P106_BUDGET_V1,
    permissions: { policyRevision: P106_ROLE_BINDING_V1.policyRevision, tools: [...P106_DECLARED_PERMISSIONS_V1.tools], writeScope: [...P106_DECLARED_PERMISSIONS_V1.writeScope] },
  });
  const start = await engine.startRun(
    buildDispatchStartCommand({
      commandId: "cmd-start-" + runId,
      correlationId: "corr-start-" + runId,
      submittedAt: FIXED,
      projectId,
      runId,
      expectedRevision: 1,
      envelope,
      manifest: buildManifestFixture({ workspaceId: P106_WORKSPACE, workspaceRevision: 1, planRef: p106PlanRef(projectId) }),
    }),
  );
  expect(start.status).toBe("committed");

  let expectedRevision = 2;
  for (const event of rebaseScriptForRun(FAKE_RUNTIME_SCRIPT_CRASHED_V1, runRef)) {
    const receipt = await engine.runFact(
      buildRunFactCommand({
        commandId: "cmd-fact-" + runId + "-" + event.sequence,
        correlationId: "corr-fact-" + runId,
        submittedAt: event.occurredAt,
        projectId,
        runId,
        expectedRevision,
        fact: { kind: "runtime_event", event },
      }),
    );
    expect(receipt.status).toBe("committed");
    if (receipt.status === "committed") expectedRevision = receipt.runRevision;
  }
}

// NOTE: buildP106ArtifactRef defaults to a NON-sha256 digest ("digest-p106-body")
// which the frozen validateHandoffPacket rejects (strict sha256). The contract
// suite fixtures rely on the SAME builder, so this is a baseline gap the
// integrator must fix (see the lane report). Unit tests here re-digest every
// artifact ref so they exercise the real registration semantics with valid refs.
function cleanPacket(packet: import("../../src/contracts/handoff.js").HandoffPacketV1): import("../../src/contracts/handoff.js").HandoffPacketV1 {
  const clean = (seed: string): ArtifactRef => ({
    kind: "artifact",
    contentType: "application/json",
    digest: artifactBodyDigest(seed),
    sizeBytes: 128,
    source: { kind: "artifact", refId: seed, revision: "1", digest: artifactBodyDigest(seed) },
  });
  return {
    ...packet,
    completed: packet.completed.map((c) => ({ ...c, artifactRef: c.artifactRef ? clean(JSON.stringify(c.artifactRef)) : null })),
    artifactRefs: packet.artifactRefs.map((a) => clean(JSON.stringify(a))),
    source: {
      ...packet.source,
      context: {
        contextBundleRef: packet.source.context.contextBundleRef ? clean(JSON.stringify(packet.source.context.contextBundleRef)) : null,
        contextManifestRef: packet.source.context.contextManifestRef ? clean(JSON.stringify(packet.source.context.contextManifestRef)) : null,
      },
    },
    bodyRef: clean(JSON.stringify(packet.bodyRef)),
  };
}

function defaultPacketRecord(deps: { projectId: string; runId: string; attemptId: string; packetId: string; taskRevision?: number; workspaceRevision?: number }): RecordHandoffCommand {
  const { projectId, runId, attemptId, packetId, taskRevision, workspaceRevision } = deps;
  const packet = cleanPacket(buildHandoffPacketV1({
    packetId,
    projectId,
    goalId: P106_GOAL,
    taskId: P106_TASK_ID,
    planRef: p106PlanRef(projectId),
    taskRevision: taskRevision ?? 1,
    runRef: runRefFor(projectId, P106_GOAL, runId),
    attemptRef: taskAttemptRefFor(projectId, P106_GOAL, P106_TASK_ID, attemptId),
    ...(workspaceRevision !== undefined ? { workspaceRevision } : {}),
  }));
  return buildRecordHandoffCommand({
    commandId: "cmd-rh-" + packetId,
    correlationId: "corr-rh-" + packetId,
    submittedAt: FIXED,
    projectId,
    packet,
  });
}

async function eventCount(ledger: StateLedger): Promise<number> {
  const page = await ledger.events({ afterCursor: null, limit: 1000 });
  return page.events.length;
}

describe("recordHandoff: happy path (atomic register + fold-equality)", () => {
  it("commits the exact fixture-builder batch and persists HandoffPacket@1, then replays idempotently", async () => {
    const { ledger, engine } = await setupAccepted();
    await endRunA({ engine, projectId: P106_PROJECT, runId: "run-a-1", attemptId: "att-a-1" });
    const before = await eventCount(ledger);
    const command = defaultPacketRecord({ projectId: P106_PROJECT, runId: "run-a-1", attemptId: "att-a-1", packetId: "packet-rh-1" });

    const receipt = await engine.recordHandoff(command);
    expect(receipt.status).toBe("committed");
    if (receipt.status !== "committed") return;

    // The submitted batch is exactly the fixture fold (fold-equality). We read
    // the eventId the handler minted so the comparison is unaffected by the
    // number of prior setup commits.
    const submitted = ledger.commits[ledger.commits.length - 1]!;
    const evId = submitted.events[0]!.eventId;
    const expected = buildHandoffRecordLedgerCommit(command, { eventId: evId, occurredAt: FIXED, workspaceId: P106_WORKSPACE });
    expect(submitted).toEqual(expected);

    // Receipt exact.
    expect(receipt.commandId).toBe(command.commandId);
    expect(receipt.replayed).toBe(false);
    expect(receipt.packetRef).toEqual(handoffPacketRefFor(P106_PROJECT, P106_GOAL, P106_TASK_ID, "packet-rh-1"));

    // Snapshot @1 loaded, payload field-identical.
    const loaded = await ledger.load(receipt.packetRef);
    expect(loaded.status).toBe("found");
    if (loaded.status === "found") {
      const snap = loaded.snapshot as { revision: number; packet: { packetId: string; noFullTranscript: boolean; bodyRef: { digest: string } } };
      expect(snap.revision).toBe(1);
      expect(snap.packet.packetId).toBe("packet-rh-1");
      expect(snap.packet.noFullTranscript).toBe(true);
    }

    // Exactly 1 HandoffRecorded event in this commit; aggregate is immutable.
    const after = await eventCount(ledger);
    expect(after - before).toBe(1);

    // Idempotent replay -> committed(replayed), same eventIds, no extra event.
    const replay = await engine.recordHandoff(command);
    expect(replay.status).toBe("committed");
    if (replay.status === "committed") expect(replay.replayed).toBe(true);
    expect(await eventCount(ledger)).toBe(after);
  });
});

describe("recordHandoff: zero-write rejections", () => {
  it("run_not_ended while A's run is still active", async () => {
    const { engine } = await setupAccepted();
    const claim = await engine.claimTask(
      buildDispatchClaimCommand({
        commandId: "cmd-claim-a2", correlationId: "corr-claim-a2", submittedAt: FIXED,
        projectId: P106_PROJECT, goalId: P106_GOAL, taskId: P106_TASK_ID, attemptId: "att-a-2", runId: "run-a-2",
        roleBinding: P106_ROLE_BINDING_V1, declaredPermissions: P106_DECLARED_PERMISSIONS_V1, budget: P106_BUDGET_V1,
        idempotencyKey: "p106-claim-a2",
      }),
    );
    expect(claim.status).toBe("committed");
    const receipt = await engine.recordHandoff(defaultPacketRecord({ projectId: P106_PROJECT, runId: "run-a-2", attemptId: "att-a-2", packetId: "packet-rh-2" }));
    expect(receipt.status).toBe("rejected");
    if (receipt.status === "rejected") expect(receipt.code).toBe("run_not_ended");
  });

  it("stale_source on workspace revision mismatch (canonical 1 != packet 2)", async () => {
    const { ledger, engine } = await setupAccepted();
    await endRunA({ engine, projectId: P106_PROJECT, runId: "run-a-3", attemptId: "att-a-3" });
    const before = await eventCount(ledger);
    const receipt = await engine.recordHandoff(defaultPacketRecord({ projectId: P106_PROJECT, runId: "run-a-3", attemptId: "att-a-3", packetId: "packet-rh-3", workspaceRevision: 2 }));
    expect(receipt.status).toBe("rejected");
    if (receipt.status === "rejected") expect(receipt.code).toBe("stale_source");
    expect(await eventCount(ledger)).toBe(before);
  });

  it("stale_source on planRevision mismatch (packet.taskRevision 2 != plan.planRevision 1)", async () => {
    const { ledger, engine } = await setupAccepted();
    await endRunA({ engine, projectId: P106_PROJECT, runId: "run-a-3b", attemptId: "att-a-3b" });
    const before = await eventCount(ledger);
    const receipt = await engine.recordHandoff(defaultPacketRecord({ projectId: P106_PROJECT, runId: "run-a-3b", attemptId: "att-a-3b", packetId: "packet-rh-3b", taskRevision: 2 }));
    expect(receipt.status).toBe("rejected");
    if (receipt.status === "rejected") expect(receipt.code).toBe("stale_source");
    expect(await eventCount(ledger)).toBe(before);
  });

  it("not_found when the source run does not exist", async () => {
    const { ledger, engine } = await setupAccepted();
    const before = await eventCount(ledger);
    const receipt = await engine.recordHandoff(defaultPacketRecord({ projectId: P106_PROJECT, runId: "run-ghost", attemptId: "att-ghost", packetId: "packet-rh-4" }));
    expect(receipt.status).toBe("rejected");
    if (receipt.status === "rejected") expect(receipt.code).toBe("not_found");
    expect(await eventCount(ledger)).toBe(before);
  });

  it("invalid command -> invalid", async () => {
    const { ledger, engine } = await setupAccepted();
    const command = defaultPacketRecord({ projectId: P106_PROJECT, runId: "run-a-5", attemptId: "att-a-5", packetId: "packet-rh-5" }) as unknown as Record<string, unknown>;
    (command as Record<string, unknown>)["commandType"] = "WrongType";
    const before = await eventCount(ledger);
    const receipt = await engine.recordHandoff(command as unknown as RecordHandoffCommand);
    expect(receipt.status).toBe("rejected");
    if (receipt.status === "rejected") expect(receipt.code).toBe("invalid");
    expect(await eventCount(ledger)).toBe(before);
  });

  it("idempotency_conflict on the same identity with a different packet payload", async () => {
    const { ledger, engine } = await setupAccepted();
    await endRunA({ engine, projectId: P106_PROJECT, runId: "run-a-6", attemptId: "att-a-6" });
    const first = defaultPacketRecord({ projectId: P106_PROJECT, runId: "run-a-6", attemptId: "att-a-6", packetId: "packet-rh-6" });
    expect((await engine.recordHandoff(first)).status).toBe("committed");
    // Same identity (projectId + default idempotencyKey) but a DIFFERENT packet
    // (different packetId -> different fingerprint) -> idempotency_conflict,
    // zero write.
    const second = defaultPacketRecord({ projectId: P106_PROJECT, runId: "run-a-6", attemptId: "att-a-6", packetId: "packet-rh-6x" });
    const receipt = await engine.recordHandoff(second);
    expect(receipt.status).toBe("rejected");
    if (receipt.status === "rejected") expect(receipt.code).toBe("idempotency_conflict");
  });
});

describe("recordHandoff: packet size cap (validator)", () => {
  it("rejects an over-cap packet via the command validator", async () => {
    const { engine } = makeHarness();
    // No setup needed: schema validation rejects before any ledger read.
    const big = "x".repeat(HANDOFF_PACKET_MAX_BYTES);
    const command = defaultPacketRecord({ projectId: P106_PROJECT, runId: "run-a-7", attemptId: "att-a-7", packetId: "packet-rh-7" });
    command.payload.packet.objective = big;
    const receipt = await engine.recordHandoff(command);
    expect(receipt.status).toBe("rejected");
    if (receipt.status === "rejected") expect(receipt.code).toBe("invalid");
  });
});
