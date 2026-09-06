/**
 * P1-06 lane A unit tests: claimReplacement (B's new Attempt for the SAME Task
 * after A ended / lease expired) over a REAL InMemoryLedger via the
 * ControlEngineImpl handler.
 *
 * Drive the ENGINE handler and assert the SUBMITTED batch is fold-equivalent to
 * the shared buildReplacementClaimLedgerCommit fixture (given the same ids),
 * plus the receipt/snapshot outcomes:
 *   - happy path: A crashed -> B's new attempt/run/outbox/replacement @1, lease
 *     CAS @N -> @N+1 (holder now B); all refs exact;
 *   - idempotent replay -> committed(replayed);
 *   - lease_active while A is still running -> zero write;
 *   - no_prior_attempt (no lease) -> ineligible with the reason;
 *   - packet_not_found (lease ended but no registered packet) -> not_found;
 *   - competing CAS window (wrong expectedRevision) -> revision_conflict;
 *   - invalid command -> invalid; missing goal -> not_found.
 */
import { describe, expect, it } from "vitest";
import { createControlEngine } from "../../src/control/control-engine.js";
import { InMemoryLedger } from "../../src/ledger/in-memory-ledger.js";
import type { StateLedger, LedgerCommit, LedgerCommitReceipt } from "../../src/contracts/ledger.js";
import { createDeterministicDeps, FIXED_ISO_2026_09_05 } from "../../src/contracts/testing/sequences.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1 } from "../../src/contracts/fixtures/bootstrap-fixture-v1.js";
import { MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1, buildCreateGoalCommand } from "../../src/contracts/fixtures/goal-fixtures.js";
import {
  ARCHITECTURE_BASELINE_FIXTURE_V1,
  COMPLETION_POLICY_FIXTURE_V1,
  buildActivateCommand,
  buildInstallCommand,
  completionPolicyPinFor,
  architectureBaselinePinFor,
} from "../../src/contracts/fixtures/governance-fixtures.js";
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
  buildClaimReplacementCommand,
  p106PlanRef,
} from "../../src/contracts/fixtures/handoff-fixtures.js";
import { buildApplyPlanCommand } from "../../src/contracts/fixtures/plan-fixtures.js";
import {
  buildDispatchClaimCommand,
  buildDispatchStartCommand,
  buildRunFactCommand,
  buildEnvelopeFixture,
  buildManifestFixture,
  rebaseScriptForRun,
  FAKE_RUNTIME_SCRIPT_CRASHED_V1,
} from "../../src/contracts/fixtures/dispatch-fixtures.js";
import type { InstallArchitectureBaselineRevisionCommand, InstallCompletionPolicyRevisionCommand } from "../../src/contracts/governance.js";
import { runRefFor, taskAttemptRefFor, taskLeaseRefFor, dispatchOutboxRefFor } from "../../src/contracts/dispatch.js";
import { handoffPacketRefFor, replacementAttemptRefFor } from "../../src/contracts/handoff.js";
import { artifactBodyDigest, type ArtifactRef } from "../../src/contracts/artifact.js";
import { buildReplacementClaimLedgerCommit } from "../../src/contracts/fixtures/handoff-fixtures.js";
import type { ClaimReplacementCommand } from "../../src/contracts/handoff.js";
import type { TaskLeaseSnapshot } from "../../src/contracts/dispatch.js";

const FIXED = FIXED_ISO_2026_09_05;
const BUNDLE: ArtifactRef = {
  kind: "artifact",
  contentType: "text/plain",
  digest: artifactBodyDigest("bundle-a"),
  sizeBytes: 8,
  source: { kind: "plan-revision", refId: "plan-handoff-mvp", revision: "1" },
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
  await engine.bootstrap(buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, { commandId: "cmd-bootstrap", correlationId: "corr-bootstrap", submittedAt: FIXED }));
  const scope = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[0]!;
  await engine.submit(buildCreateGoalCommand({ ...scope, projectId: P106_PROJECT, workspaceId: P106_WORKSPACE, goalId: P106_GOAL }, { commandId: "cmd-goal", correlationId: "corr-goal", submittedAt: FIXED, idempotencyKey: "p1-06-goal" }));
  const cp = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, { commandId: "cmd-install-cp", correlationId: "corr-install-cp", submittedAt: FIXED, projectId: P106_PROJECT, idempotencyKey: "inst-cp" }) as InstallCompletionPolicyRevisionCommand;
  expect((await engine.install(cp)).status).toBe("committed");
  const ab = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, { commandId: "cmd-install-ab", correlationId: "corr-install-ab", submittedAt: FIXED, projectId: P106_PROJECT, idempotencyKey: "inst-ab" }) as InstallArchitectureBaselineRevisionCommand;
  expect((await engine.install(ab)).status).toBe("committed");
  expect((await engine.activate(buildActivateCommand(completionPolicyPinFor(cp), { commandId: "cmd-act-cp", correlationId: "corr-act-cp", submittedAt: FIXED, projectId: P106_PROJECT, expectedRevision: 1, idempotencyKey: "act-cp" }))).status).toBe("committed");
  expect((await engine.activate(buildActivateCommand(architectureBaselinePinFor(ab), { commandId: "cmd-act-ab", correlationId: "corr-act-ab", submittedAt: FIXED, projectId: P106_PROJECT, expectedRevision: 1, idempotencyKey: "act-ab" }))).status).toBe("committed");
  expect((await engine.applyPlan(buildApplyPlanCommand(P106_PLAN_REVISION_FIXTURE_V1, { commandId: "cmd-apply", correlationId: "corr-apply", submittedAt: FIXED, projectId: P106_PROJECT, expectedRevision: 1, idempotencyKey: "apply" }))).status).toBe("committed");
  return { ledger, engine };
}

// buildP106ArtifactRef defaults to a NON-sha256 digest which the frozen
// validateHandoffPacket rejects — re-digest every artifact ref (baseline gap;
// see the lane report).
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

async function endRunA(deps: { engine: ReturnType<typeof createControlEngine>; runId: string; attemptId: string; script?: "crashed" | "completed" }): Promise<void> {
  const { engine, runId, attemptId } = deps;
  const claim = await engine.claimTask(buildDispatchClaimCommand({
    commandId: "cmd-claim-" + runId, correlationId: "corr-claim-" + runId, submittedAt: FIXED,
    projectId: P106_PROJECT, goalId: P106_GOAL, taskId: P106_TASK_ID, attemptId, runId,
    roleBinding: P106_ROLE_BINDING_V1, declaredPermissions: P106_DECLARED_PERMISSIONS_V1, budget: P106_BUDGET_V1,
    idempotencyKey: "p106-claim-" + runId,
  }));
  expect(claim.status).toBe("committed");
  const runRef = runRefFor(P106_PROJECT, P106_GOAL, runId);
  const envelope = buildEnvelopeFixture({
    envelopeId: "envelope-" + runId, projectId: P106_PROJECT, workspaceId: P106_WORKSPACE, goalId: P106_GOAL, taskId: P106_TASK_ID,
    runId, attemptId, planRef: p106PlanRef(P106_PROJECT), workspaceRevision: 1, bundleRef: BUNDLE,
    roleBinding: P106_ROLE_BINDING_V1, budget: P106_BUDGET_V1,
    permissions: { policyRevision: P106_ROLE_BINDING_V1.policyRevision, tools: [...P106_DECLARED_PERMISSIONS_V1.tools], writeScope: [...P106_DECLARED_PERMISSIONS_V1.writeScope] },
  });
  expect((await engine.startRun(buildDispatchStartCommand({
    commandId: "cmd-start-" + runId, correlationId: "corr-start-" + runId, submittedAt: FIXED,
    projectId: P106_PROJECT, runId, expectedRevision: 1, envelope,
    manifest: buildManifestFixture({ workspaceId: P106_WORKSPACE, workspaceRevision: 1, planRef: p106PlanRef(P106_PROJECT) }),
  }))).status).toBe("committed");
  let expectedRevision = 2;
  for (const event of rebaseScriptForRun(deps.script === "completed" ? FAKE_RUNTIME_SCRIPT_CRASHED_V1 : FAKE_RUNTIME_SCRIPT_CRASHED_V1, runRef)) {
    const receipt = await engine.runFact(buildRunFactCommand({
      commandId: "cmd-fact-" + runId + "-" + event.sequence, correlationId: "corr-fact-" + runId, submittedAt: event.occurredAt,
      projectId: P106_PROJECT, runId, expectedRevision, fact: { kind: "runtime_event", event },
    }));
    expect(receipt.status).toBe("committed");
    if (receipt.status === "committed") expectedRevision = receipt.runRevision;
  }
}

async function registerPacket(deps: { engine: ReturnType<typeof createControlEngine>; runId: string; attemptId: string; packetId: string }): Promise<import("../../src/contracts/handoff.js").HandoffPacketRef> {
  const { engine, runId, attemptId, packetId } = deps;
  const packet = cleanPacket(buildHandoffPacketV1({
    packetId, projectId: P106_PROJECT, goalId: P106_GOAL, taskId: P106_TASK_ID,
    planRef: p106PlanRef(P106_PROJECT), taskRevision: 1,
    runRef: runRefFor(P106_PROJECT, P106_GOAL, runId), attemptRef: taskAttemptRefFor(P106_PROJECT, P106_GOAL, P106_TASK_ID, attemptId),
  }));
  const receipt = await engine.recordHandoff(buildRecordHandoffCommand({
    commandId: "cmd-rh-" + packetId, correlationId: "corr-rh-" + packetId, submittedAt: FIXED,
    projectId: P106_PROJECT, packet,
  }));
  expect(receipt.status).toBe("committed");
  return handoffPacketRefFor(P106_PROJECT, P106_GOAL, P106_TASK_ID, packetId);
}

function claimCmd(deps: { commandId: string; attemptId: string; runId: string; packetRef: import("../../src/contracts/handoff.js").HandoffPacketRef; expectedRevision: number; idempotencyKey?: string; reason?: import("../../src/contracts/handoff.js").ReplacementReason }): ClaimReplacementCommand {
  return buildClaimReplacementCommand({
    commandId: deps.commandId, correlationId: "corr-" + deps.commandId, submittedAt: FIXED,
    projectId: P106_PROJECT, goalId: P106_GOAL, taskId: P106_TASK_ID,
    expectedRevision: deps.expectedRevision, attemptId: deps.attemptId, runId: deps.runId,
    handoffPacketRef: deps.packetRef, reason: deps.reason ?? "run_crashed",
    idempotencyKey: deps.idempotencyKey ?? deps.commandId,
  });
}

describe("claimReplacement: happy path (atomic replacement + fold-equality)", () => {
  it("commits the exact fixture-builder batch: lease CAS @N->@N+1 + B attempt/run/outbox/replacement @1", async () => {
    const { ledger, engine } = await setupAccepted();
    await endRunA({ engine, runId: "run-a-4", attemptId: "att-a-4" });
    const pre = await ledger.load(taskLeaseRefFor(P106_PROJECT, P106_GOAL, P106_TASK_ID));
    expect(pre.status).toBe("found");
    const priorLease = pre.status === "found" ? (pre.snapshot as TaskLeaseSnapshot) : null;
    expect(priorLease).not.toBeNull();
    const packetRef = await registerPacket({ engine, runId: "run-a-4", attemptId: "att-a-4", packetId: "packet-claim-4" });

    const cmd = claimCmd({ commandId: "cmd-claim-4", attemptId: "att-b-4", runId: "run-b-4", packetRef, expectedRevision: priorLease!.revision });
    const receipt = await engine.claimReplacement(cmd);
    expect(receipt.status).toBe("committed");
    if (receipt.status !== "committed") return;

    // Fold-equality: the submitted batch equals the fixture build given the ids
    // the handler minted (eventId) and the loaded prior lease.
    const submitted = ledger.commits[ledger.commits.length - 1]!;
    const evId = submitted.events[0]!.eventId;
    const expected = buildReplacementClaimLedgerCommit(cmd, {
      eventId: evId,
      occurredAt: FIXED,
      workspaceId: P106_WORKSPACE,
      workspaceRevision: 1,
      planRef: p106PlanRef(P106_PROJECT),
      priorLease: priorLease!,
      priorRunRef: runRefFor(P106_PROJECT, P106_GOAL, "run-a-4"),
      priorAttemptRef: taskAttemptRefFor(P106_PROJECT, P106_GOAL, P106_TASK_ID, "att-a-4"),
    });
    expect(submitted).toEqual(expected);

    // Receipt refs exact.
    expect(receipt.replacementRef).toEqual(replacementAttemptRefFor(P106_PROJECT, P106_GOAL, P106_TASK_ID, "att-b-4"));
    expect(receipt.leaseRef).toEqual(taskLeaseRefFor(P106_PROJECT, P106_GOAL, P106_TASK_ID));
    expect(receipt.attemptRef).toEqual(taskAttemptRefFor(P106_PROJECT, P106_GOAL, P106_TASK_ID, "att-b-4"));
    expect(receipt.runRef).toEqual(runRefFor(P106_PROJECT, P106_GOAL, "run-b-4"));
    expect(receipt.outboxRef).toEqual(dispatchOutboxRefFor(P106_PROJECT, P106_GOAL, P106_TASK_ID, "att-b-4"));

    // Lease moved to B (@N+1).
    const lease = await ledger.load(taskLeaseRefFor(P106_PROJECT, P106_GOAL, P106_TASK_ID));
    expect(lease.status).toBe("found");
    if (lease.status === "found") {
      const ls = lease.snapshot as TaskLeaseSnapshot;
      expect(ls.revision).toBe(priorLease!.revision + 1);
      expect(ls.holderRunId).toBe("run-b-4");
      expect(ls.attemptId).toBe("att-b-4");
    }
    const bRun = await ledger.load(receipt.runRef);
    expect(bRun.status).toBe("found");
    if (bRun.status === "found") {
      const rs = bRun.snapshot as { status: string; lastEventSeq: number };
      expect(rs.status).toBe("starting");
      expect(rs.lastEventSeq).toBe(0);
    }
    const bAttempt = await ledger.load(receipt.attemptRef);
    expect(bAttempt.status).toBe("found");
    if (bAttempt.status === "found") {
      const as = bAttempt.snapshot as { status: string };
      expect(as.status).toBe("claimed");
    }
    const replacement = await ledger.load(receipt.replacementRef);
    expect(replacement.status).toBe("found");
    if (replacement.status === "found") {
      const snap = replacement.snapshot as { reason: string; packetRef: { packetId: string }; priorRunRef: { runId: string } };
      expect(snap.reason).toBe("run_crashed");
      expect(snap.packetRef.packetId).toBe("packet-claim-4");
      expect(snap.priorRunRef.runId).toBe("run-a-4");
    }
  });

  it("idempotent replay -> committed(replayed) with no extra event", async () => {
    const { ledger, engine } = await setupAccepted();
    await endRunA({ engine, runId: "run-a-4b", attemptId: "att-a-4b" });
    const pre = await ledger.load(taskLeaseRefFor(P106_PROJECT, P106_GOAL, P106_TASK_ID));
    const priorLease = pre.status === "found" ? (pre.snapshot as TaskLeaseSnapshot) : null;
    expect(priorLease).not.toBeNull();
    const packetRef = await registerPacket({ engine, runId: "run-a-4b", attemptId: "att-a-4b", packetId: "packet-claim-4b" });
    const cmd = claimCmd({ commandId: "cmd-claim-4b", attemptId: "att-b-4b", runId: "run-b-4b", packetRef, expectedRevision: priorLease!.revision, idempotencyKey: "claim-4b-replay" });
    const before = (await ledger.events({ afterCursor: null, limit: 1000 })).events.length;
    expect((await engine.claimReplacement(cmd)).status).toBe("committed");
    const afterFirst = (await ledger.events({ afterCursor: null, limit: 1000 })).events.length;
    expect(afterFirst).toBe(before + 1);
    // Exact replay: committed(replayed), no extra event appended.
    const replay = await engine.claimReplacement(cmd);
    expect(replay.status).toBe("committed");
    if (replay.status === "committed") expect(replay.replayed).toBe(true);
    const afterReplay = (await ledger.events({ afterCursor: null, limit: 1000 })).events.length;
    expect(afterReplay).toBe(afterFirst);
  });
});

describe("claimReplacement: finalization / eligibility rejections (zero write)", () => {
  it("lease_active while A is still running", async () => {
    const { ledger, engine } = await setupAccepted();
    const claim = await engine.claimTask(buildDispatchClaimCommand({
      commandId: "cmd-claim-a5", correlationId: "corr-claim-a5", submittedAt: FIXED,
      projectId: P106_PROJECT, goalId: P106_GOAL, taskId: P106_TASK_ID, attemptId: "att-a-5", runId: "run-a-5",
      roleBinding: P106_ROLE_BINDING_V1, declaredPermissions: P106_DECLARED_PERMISSIONS_V1, budget: P106_BUDGET_V1,
      idempotencyKey: "p106-claim-a5",
    }));
    expect(claim.status).toBe("committed");
    // NOTE: A's run is STILL RUNNING here, so A cannot register a handoff packet
    // (recordHandoff requires an ended source run). The claim therefore runs with
    // a packet that is not registered yet: the eligibility sees [lease_active,
    // packet_not_found] and the live lease is the SPECIFIC replacement blocker
    // (lease_active takes priority over the soft packet condition).
    const before = (await ledger.events({ afterCursor: null, limit: 1000 })).events.length;
    const receipt = await engine.claimReplacement(claimCmd({
      commandId: "cmd-claim-5b", attemptId: "att-b-5", runId: "run-b-5",
      packetRef: handoffPacketRefFor(P106_PROJECT, P106_GOAL, P106_TASK_ID, "packet-claim-5"), expectedRevision: 1,
    }));
    expect(receipt.status).toBe("rejected");
    if (receipt.status === "rejected") expect(receipt.code).toBe("lease_active");
    expect((await ledger.events({ afterCursor: null, limit: 1000 })).events.length).toBe(before);
  });

  it("no_prior_attempt (no lease) -> ineligible with the reason", async () => {
    const { ledger, engine } = await setupAccepted();
    // No task was ever claimed -> no lease. But the goal/workspace/plan exist.
    const before = (await ledger.events({ afterCursor: null, limit: 1000 })).events.length;
    const receipt = await engine.claimReplacement(claimCmd({
      commandId: "cmd-claim-npa", attemptId: "att-b-npa", runId: "run-b-npa",
      packetRef: handoffPacketRefFor(P106_PROJECT, P106_GOAL, P106_TASK_ID, "packet-claim-npa"),
      expectedRevision: 1,
    }));
    expect(receipt.status).toBe("rejected");
    if (receipt.status === "rejected") {
      expect(receipt.code).toBe("ineligible");
      expect(receipt.issues?.some((i) => i.code === "no_prior_attempt")).toBe(true);
    }
    expect((await ledger.events({ afterCursor: null, limit: 1000 })).events.length).toBe(before);
  });

  it("packet_not_found (lease ended but no registered packet) -> not_found", async () => {
    const { ledger, engine } = await setupAccepted();
    await endRunA({ engine, runId: "run-a-6", attemptId: "att-a-6" });
    const pre = await ledger.load(taskLeaseRefFor(P106_PROJECT, P106_GOAL, P106_TASK_ID));
    const priorLease = pre.status === "found" ? (pre.snapshot as TaskLeaseSnapshot) : null;
    const receipt = await engine.claimReplacement(claimCmd({
      commandId: "cmd-claim-6", attemptId: "att-b-6", runId: "run-b-6",
      packetRef: handoffPacketRefFor(P106_PROJECT, P106_GOAL, P106_TASK_ID, "packet-never"),
      expectedRevision: priorLease!.revision,
    }));
    expect(receipt.status).toBe("rejected");
    if (receipt.status === "rejected") expect(receipt.code).toBe("not_found");
  });

  it("competing CAS window (two replacements race on the same lease revision) -> exactly one wins, loser revision_conflict", async () => {
    const { ledger, engine } = await setupAccepted();
    await endRunA({ engine, runId: "run-a-7", attemptId: "att-a-7" });
    const pre = await ledger.load(taskLeaseRefFor(P106_PROJECT, P106_GOAL, P106_TASK_ID));
    const priorLease = pre.status === "found" ? (pre.snapshot as TaskLeaseSnapshot) : null;
    expect(priorLease).not.toBeNull();
    const packetRef = await registerPacket({ engine, runId: "run-a-7", attemptId: "att-a-7", packetId: "packet-claim-7" });
    const before = (await ledger.events({ afterCursor: null, limit: 1000 })).events.length;
    // Two DIFFERENT B replacements (distinct attempt/run/idempotencyKey) both
    // target the SAME TaskLease@N. Exactly one commits; the other's CAS window
    // is stale -> revision_conflict, zero extra event.
    const a = claimCmd({ commandId: "cmd-claim-7a", attemptId: "att-b-7a", runId: "run-b-7a", packetRef, expectedRevision: priorLease!.revision, idempotencyKey: "claim-7a" });
    const b = claimCmd({ commandId: "cmd-claim-7b", attemptId: "att-b-7b", runId: "run-b-7b", packetRef, expectedRevision: priorLease!.revision, idempotencyKey: "claim-7b" });
    const [ra, rb] = await Promise.all([engine.claimReplacement(a), engine.claimReplacement(b)]);
    const statuses = [ra.status, rb.status].sort();
    expect(statuses).toEqual(["committed", "rejected"]);
    const loser = ra.status === "rejected" ? ra : rb;
    if (loser.status === "rejected") {
      expect(loser.code).toBe("revision_conflict");
      expect(loser.currentRevision).toBe(priorLease!.revision + 1);
    }
    expect((await ledger.events({ afterCursor: null, limit: 1000 })).events.length).toBe(before + 1);
  });

  it("missing goal -> not_found", async () => {
    const { ledger, engine } = await setupAccepted();
    const before = (await ledger.events({ afterCursor: null, limit: 1000 })).events.length;
    // Claim a goal that does not exist -> not_found, zero write.
    const cmd = buildClaimReplacementCommand({
      commandId: "cmd-claim-nf", correlationId: "corr-claim-nf", submittedAt: FIXED,
      projectId: P106_PROJECT, goalId: "goal-ghost", taskId: P106_TASK_ID,
      expectedRevision: 1, attemptId: "att-b-nf", runId: "run-b-nf",
      handoffPacketRef: handoffPacketRefFor(P106_PROJECT, "goal-ghost", P106_TASK_ID, "packet-nf"),
    });
    const receipt = await engine.claimReplacement(cmd);
    expect(receipt.status).toBe("rejected");
    if (receipt.status === "rejected") expect(receipt.code).toBe("not_found");
    expect((await ledger.events({ afterCursor: null, limit: 1000 })).events.length).toBe(before);
  });

  it("invalid command -> invalid", async () => {
    const { ledger, engine } = await setupAccepted();
    const cmd = buildClaimReplacementCommand({
      commandId: "cmd-claim-inv", correlationId: "corr-claim-inv", submittedAt: FIXED,
      projectId: P106_PROJECT, goalId: P106_GOAL, taskId: P106_TASK_ID,
      expectedRevision: 1, attemptId: "att-b-inv", runId: "run-b-inv",
      handoffPacketRef: handoffPacketRefFor(P106_PROJECT, P106_GOAL, P106_TASK_ID, "packet-inv"),
    });
    const before = (await ledger.events({ afterCursor: null, limit: 1000 })).events.length;
    const invalid = { ...cmd, commandType: "WrongType" } as unknown as ClaimReplacementCommand;
    const receipt = await engine.claimReplacement(invalid);
    expect(receipt.status).toBe("rejected");
    if (receipt.status === "rejected") expect(receipt.code).toBe("invalid");
    expect((await ledger.events({ afterCursor: null, limit: 1000 })).events.length).toBe(before);
  });
});
