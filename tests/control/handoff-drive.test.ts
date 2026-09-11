/**
 * P1-06 lane A unit tests: HandoffDriveEngineImpl.driveHandoff (the
 * DispatchEngine.HandoffPort).
 *
 * The drive loads a PENDING outbox intent, loads the co-committed
 * ReplacementAttempt, assembles B's bounded HandoffContext, records B's envelope
 * via Control.startRun (outbox-before-side-effect), and ONLY THEN invokes
 * RunPort.start + Control.runFact. runFact IS implemented (P1-03), so the full
 * path drive -> B run -> terminal facts is exercised with a REAL fake runtime.
 *
 * The RUNTIME and CONTEXT are lane-B concerns; we inject a deterministic
 * HandoffContextPort (a tiny in-test fake) so the tests are self-contained and
 * do NOT depend on the lane-B HandoffContextCompilerImpl (a stub here).
 *
 * Coverage:
 *   - happy path: ONE replacement intent -> scanned=1 started=1 completed=1,
 *     failures=[], and B's run is ended/outcome completed (run facts consumed);
 *   - not_a_replacement: a NORMAL dispatch claim intent (no co-committed
 *     ReplacementAttempt) -> failure not_a_replacement, NOT scanned;
 *   - context_rejected: assemble returns rejected -> failure context_rejected,
 *     runtime never invoked;
 *   - runtime_error: startRun succeeded, RunPort.start throws -> runtime_error.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { prepareP106Scenario, toP1_06Harness, type P1_06TestHarness } from "../contract-suite/p1-06-harness.js";
import {
  P106_BUDGET_V1,
  P106_DECLARED_PERMISSIONS_V1,
  P106_GOAL,
  P106_ROLE_BINDING_V1,
  P106_TASK_ID,
  P106_WORKSPACE,
  buildHandoffPacketV1,
  buildRecordHandoffCommand,
  buildClaimReplacementCommand,
  p106PlanRef,
} from "../contract-support/fixtures/handoff-fixtures.js";
import { buildDispatchClaimCommand, buildDispatchStartCommand, buildRunFactCommand, buildEnvelopeFixture, buildManifestFixture, rebaseScriptForRun, FAKE_RUNTIME_SCRIPT_CRASHED_V1 } from "../../src/fixtures/dispatch-fixtures.js";
import { runRefFor, taskAttemptRefFor, dispatchOutboxRefFor } from "../../src/contracts/dispatch.js";
import { handoffPacketRefFor } from "../../src/contracts/handoff.js";
import { artifactBodyDigest, type ArtifactRef } from "../../src/contracts/artifact.js";
import type { HandoffContextPort, HandoffContextRequestV1, HandoffContextResultV1 } from "../../src/contracts/handoff-context.js";
import type { RunPort, RunCapabilities, RunHandle } from "../../src/contracts/ports.js";
import type { TaskEnvelopeV1 } from "../../src/contracts/task-envelope.js";
import type { HandoffDriveDeps } from "../../src/control/dispatch-engine/handoff-drive.js";
import { createHandoffDriveEngine } from "../../src/control/dispatch-engine/handoff-drive.js";

const FIXED = "2026-09-05T12:00:00.000Z";
const BUNDLE: ArtifactRef = {
  kind: "artifact",
  contentType: "text/plain",
  digest: artifactBodyDigest("handoff-bundle"),
  sizeBytes: 16,
  source: { kind: "plan-revision", refId: "plan-handoff-mvp", revision: "1" },
};

// buildP106ArtifactRef defaults to a NON-sha256 digest which the frozen
// validateHandoffPacket rejects — re-digest every artifact ref (baseline gap;
// see the lane report).
function cleanPacket(packet: ReturnType<typeof buildHandoffPacketV1>): ReturnType<typeof buildHandoffPacketV1> {
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

function readyHandoffContext(): HandoffContextPort {
  return {
    async assemble(request: HandoffContextRequestV1): Promise<HandoffContextResultV1> {
      const envelope = buildEnvelopeFixture({
        envelopeId: "env-handoff-" + request.runRef.runId,
        projectId: request.projectId,
        workspaceId: request.workspaceId,
        goalId: request.goalId,
        taskId: request.taskId,
        runId: request.runRef.runId,
        attemptId: request.attemptRef.attemptId,
        planRef: request.planRef,
        workspaceRevision: request.workspaceSnapshot.revision,
        bundleRef: BUNDLE,
        roleBinding: request.roleBinding,
        budget: request.budget,
        permissions: { policyRevision: request.roleBinding.policyRevision, tools: [...request.declaredPermissions.tools], writeScope: [...request.declaredPermissions.writeScope] },
      });
      const manifest: import("../../src/contracts/handoff-context.js").HandoffContextManifestV1 = {
        schemaVersion: 1,
        selectedRefs: [{ kind: "plan-revision", refId: request.planRef.planId, revision: "1" }],
        gaps: [],
        packetRef: request.handoffPacketRef,
        packetTaskRevision: 1,
        noFullTranscript: true,
        freshness: { workspaceSnapshot: { workspaceId: request.workspaceId, revision: request.workspaceSnapshot.revision }, planRef: request.planRef },
      };
      return { status: "ready", envelope, manifest, bundleRef: BUNDLE };
    },
  };
}

function rejectedHandoffContext(): HandoffContextPort {
  return {
    async assemble(): Promise<HandoffContextResultV1> {
      return { status: "rejected", code: "forbidden_tool_or_scope", issues: ["scope overflow"] };
    },
  };
}

function noStartRuntime(): RunPort {
  return {
    async capabilities(): Promise<RunCapabilities> { return { replayable: true, supportsSnapshot: false, maxEnvelopeBytes: 64 * 1024 }; },
    async start(_envelope: TaskEnvelopeV1): Promise<RunHandle> { throw new Error("runtime must not be invoked"); },
  };
}

/** A's run: claim + start + crash (roleBinding consistent end-to-end). */
async function crashRunA(h: P1_06TestHarness, sc: { projectId: string }, runId: string, attemptId: string): Promise<void> {
  const projectId = sc.projectId;
  const planRef = p106PlanRef(projectId);
  const claim = await h.claimTask(buildDispatchClaimCommand({
    commandId: "cmd-claim-" + runId, correlationId: "corr-claim-" + runId, submittedAt: FIXED,
    projectId, goalId: P106_GOAL, taskId: P106_TASK_ID, attemptId, runId,
    roleBinding: P106_ROLE_BINDING_V1, declaredPermissions: P106_DECLARED_PERMISSIONS_V1, budget: P106_BUDGET_V1,
    idempotencyKey: "p106-claim-" + runId,
  }));
  expect(claim.status).toBe("committed");
  const runRef = runRefFor(projectId, P106_GOAL, runId);
  const envelope = buildEnvelopeFixture({
    envelopeId: "envelope-" + runId, projectId, workspaceId: P106_WORKSPACE, goalId: P106_GOAL, taskId: P106_TASK_ID,
    runId, attemptId, planRef, workspaceRevision: 1, bundleRef: BUNDLE,
    roleBinding: P106_ROLE_BINDING_V1, budget: P106_BUDGET_V1,
    permissions: { policyRevision: P106_ROLE_BINDING_V1.policyRevision, tools: [...P106_DECLARED_PERMISSIONS_V1.tools], writeScope: [...P106_DECLARED_PERMISSIONS_V1.writeScope] },
  });
  expect((await h.startRun(buildDispatchStartCommand({
    commandId: "cmd-start-" + runId, correlationId: "corr-start-" + runId, submittedAt: FIXED,
    projectId, runId, expectedRevision: 1, envelope,
    manifest: buildManifestFixture({ workspaceId: P106_WORKSPACE, workspaceRevision: 1, planRef }),
  }))).status).toBe("committed");
  let expectedRevision = 2;
  for (const event of rebaseScriptForRun(FAKE_RUNTIME_SCRIPT_CRASHED_V1, runRef)) {
    const receipt = await h.runFact(buildRunFactCommand({
      commandId: "cmd-fact-" + runId + "-" + event.sequence, correlationId: "corr-fact-" + runId, submittedAt: event.occurredAt,
      projectId, runId, expectedRevision, fact: { kind: "runtime_event", event },
    }));
    expect(receipt.status).toBe("committed");
    if (receipt.status === "committed") expectedRevision = receipt.runRevision;
  }
}

/** Full replacement setup: A crashed + packet registered + B claimed (role binding consistent). */
async function prepareReplacement(th: P1_06TestHarness, runA: string, attA: string, runB: string, attB: string, packetId: string, h: { ledger: import("../../src/contracts/ledger.js").StateLedger }) {
  const sc = await prepareP106Scenario(th);
  await crashRunA(th, sc, runA, attA);
  const packet = cleanPacket(buildHandoffPacketV1({
    packetId, projectId: sc.projectId, goalId: P106_GOAL, taskId: P106_TASK_ID,
    planRef: sc.planRef, taskRevision: 1,
    runRef: runRefFor(sc.projectId, P106_GOAL, runA), attemptRef: taskAttemptRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, attA),
  }));
  const rec = await th.recordHandoff(buildRecordHandoffCommand({
    commandId: "cmd-rh-" + packetId, correlationId: "corr-rh-" + packetId, submittedAt: packet.generatedAt,
    projectId: sc.projectId, packet,
  }));
  expect(rec.status).toBe("committed");
  const packetRef = handoffPacketRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, packetId);
  const claim = await th.claimReplacement(buildClaimReplacementCommand({
    commandId: "cmd-claim-" + runB, correlationId: "corr-claim-" + runB, submittedAt: packet.generatedAt,
    projectId: sc.projectId, goalId: P106_GOAL, taskId: P106_TASK_ID,
    expectedRevision: 1, attemptId: attB, runId: runB, handoffPacketRef: packetRef, reason: "run_crashed",
  }));
  expect(claim.status).toBe("committed");
  return sc;
}

describe("HandoffDriveEngineImpl.driveHandoff", () => {
  it("processes one replacement intent: B run starts + completes (run facts consumed)", async () => {
    const h = createInMemoryHarness({ handoffContext: readyHandoffContext() });
    const th = toP1_06Harness(h as never);
    const sc = await prepareReplacement(th, "run-a-d1", "att-a-d1", "run-b-d1", "att-b-d1", "packet-drive-1", h);

    const result = await th.handoffDrive.driveHandoff({ reason: "p1-06 handoff drive" });
    expect(result.started).toBe(1);
    expect(result.completed).toBe(1);
    expect(result.failures).toEqual([]);
    expect(result.scanned).toBe(1);

    const bRun = await h.ledger.load(runRefFor(sc.projectId, P106_GOAL, "run-b-d1"));
    expect(bRun.status).toBe("found");
    if (bRun.status === "found") {
      const snap = bRun.snapshot as { status: string; outcome: string | null; lastEventSeq: number };
      expect(snap.status).toBe("ended");
      expect(snap.outcome).toBe("completed");
      expect(snap.lastEventSeq).toBeGreaterThan(0);
    }
    const outbox = await h.ledger.load(dispatchOutboxRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, "att-b-d1"));
    expect(outbox.status).toBe("found");
    if (outbox.status === "found") expect((outbox.snapshot as { status: string }).status).toBe("done");
  });

  it("reports not_a_replacement for a normal dispatch intent (no co-committed ReplacementAttempt)", async () => {
    const h = createInMemoryHarness({ handoffContext: readyHandoffContext() });
    const th = toP1_06Harness(h as never);
    const sc = await prepareP106Scenario(th);
    // A NORMAL dispatch claim (NOT a replacement) leaves a pending outbox intent
    // with no ReplacementAttempt.
    const claim = await h.claimTask(buildDispatchClaimCommand({
      commandId: "cmd-claim-nr", correlationId: "corr-claim-nr", submittedAt: FIXED,
      projectId: sc.projectId, goalId: P106_GOAL, taskId: P106_TASK_ID, attemptId: "att-nr", runId: "run-nr",
      roleBinding: P106_ROLE_BINDING_V1, declaredPermissions: P106_DECLARED_PERMISSIONS_V1, budget: P106_BUDGET_V1,
      idempotencyKey: "p106-claim-nr",
    }));
    expect(claim.status).toBe("committed");
    const result = await th.handoffDrive.driveHandoff({ reason: "p1-06 handoff drive" });
    expect(result.scanned).toBe(0);
    expect(result.started).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.code).toBe("not_a_replacement");
    expect(result.failures[0]!.intentId).toBe("att-nr");
  });

  it("reports context_rejected when assemble rejects; runtime never invoked", async () => {
    const h = createInMemoryHarness({ handoffContext: rejectedHandoffContext() });
    const th = toP1_06Harness(h as never);
    await prepareReplacement(th, "run-a-d3", "att-a-d3", "run-b-d3", "att-b-d3", "packet-drive-3", h);
    const result = await th.handoffDrive.driveHandoff({ reason: "p1-06 handoff drive" });
    expect(result.started).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.code).toBe("context_rejected");
  });

  it("runtime error surfaces as runtime_error after a successful start", async () => {
    const h = createInMemoryHarness({ handoffContext: readyHandoffContext() });
    const th = toP1_06Harness(h as never);
    const sc = await prepareReplacement(th, "run-a-d4", "att-a-d4", "run-b-d4", "att-b-d4", "packet-drive-4", h);
    // Drive over the SAME ledger/control but a runtime that throws on start.
    const drive = createHandoffDriveEngine({
      ledger: h.ledger,
      control: h.control,
      handoffContext: readyHandoffContext(),
      runtime: noStartRuntime(),
    } as HandoffDriveDeps);
    const result = await drive.driveHandoff({ reason: "p1-06 handoff drive", maxIntents: 8 });
    expect(result.started).toBe(1);
    expect(result.completed).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.code).toBe("runtime_error");
  });
});
