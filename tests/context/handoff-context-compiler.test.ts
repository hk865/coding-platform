/**
 * Lane B tests — HandoffContextCompilerImpl (bounded handoff Bundle, body-first,
 * explicit stale_workspace_snapshot / stale_packet, deterministic rejections
 * with zero writes). Uses the shared harness + scenario helpers (read-only
 * use of contract-suite) and an in-test fake StateLedger for the stale_packet
 * branch (a stale packet cannot be registered through the real recordHandoff,
 * and directly committing one to the real ledger is out of scope).
 */
import { describe, expect, it } from "vitest";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { createArtifactVault } from "../../src/vault/artifact-vault.js";
import {
  toP1_06Harness,
  prepareP106Scenario,
  p106RequestB,
  P106_GOAL,
  P106_TASK_ID,
  P106_WORKSPACE,
  type P1_06TestHarness,
} from "../contract-suite/p1-06-harness.js";
import { HandoffContextCompilerImpl } from "../../src/context/handoff-context-compiler.js";
import { handoffPacketRefFor, HANDOFF_CONTEXT_BUNDLE_MAX_BYTES } from "../../src/contracts/handoff.js";
import type { HandoffPacketV1 } from "../../src/contracts/handoff.js";
import { runRefFor, taskAttemptRefFor } from "../../src/contracts/dispatch.js";
import {
  P106_ROLE_BINDING_V1,
  P106_SCHEMA,
  buildP106ArtifactRef,
  buildHandoffPacketV1,
  buildRecordHandoffCommand,
  buildHandoffRecordLedgerCommit,
  handoffPacketSnapshotFor,
  buildHandoffContextRequest,
} from "../../src/contracts/fixtures/handoff-fixtures.js";
import type { AggregateRef, AggregateSnapshot, SnapshotResult, StateLedger } from "../../src/contracts/ledger.js";
import type { HandoffContextRequestV1 } from "../../src/contracts/handoff-context.js";
import type { PlanRevisionRef, PlanRevisionSnapshot } from "../../src/contracts/plan.js";
import type { WorkspaceSnapshot } from "../../src/contracts/ledger.js";

function runRef(projectId: string, runId: string) {
  return runRefFor(projectId, P106_GOAL, runId);
}

function attemptRef(projectId: string, taskId: string, attemptId: string) {
  return taskAttemptRefFor(projectId, P106_GOAL, taskId, attemptId);
}

function packetRefFor(packet: HandoffPacketV1) {
  return handoffPacketRefFor(packet.projectId, packet.goalId, packet.taskId, packet.packetId);
}

interface Scenario {
  h: P1_06TestHarness;
  projectId: string;
  planRef: PlanRevisionRef;
}

async function prepare(h: P1_06TestHarness): Promise<Scenario> {
  const sc = await prepareP106Scenario(h);
  return { h, projectId: sc.projectId, planRef: sc.planRef };
}

function buildPacket(
  deps: { projectId: string; planRef: PlanRevisionRef; taskId?: string; packetId: string; planOverride?: PlanRevisionRef; workspaceRevision?: number },
): HandoffPacketV1 {
  const taskId = deps.taskId ?? P106_TASK_ID;
  return buildHandoffPacketV1({
    packetId: deps.packetId,
    projectId: deps.projectId,
    goalId: P106_GOAL,
    taskId,
    planRef: deps.planOverride ?? deps.planRef,
    taskRevision: 1,
    runRef: runRef(deps.projectId, "run-a-1"),
    attemptRef: attemptRef(deps.projectId, taskId, "att-a-1"),
    workspaceRevision: deps.workspaceRevision ?? 1,
  });
}

async function registerPacket(h: P1_06TestHarness, packet: HandoffPacketV1) {
  const cmd = buildRecordHandoffCommand({
    commandId: "cmd-rec-" + packet.packetId,
    correlationId: "corr-rec-" + packet.packetId,
    submittedAt: packet.generatedAt,
    projectId: packet.projectId,
    idempotencyKey: "p1-06-rec-" + packet.packetId,
    packet,
  });
  const commit = buildHandoffRecordLedgerCommit(cmd, {
    eventId: "evt-" + packet.packetId,
    occurredAt: packet.generatedAt,
    workspaceId: packet.workspaceId,
  });
  const receipt = await h.ledger.commit(commit);
  expect(receipt.status, "packet registration must commit").toBe("committed");
}

describe("HandoffContextCompiler (Lane B)", () => {
  it("ready: bounded envelope + manifest + body-first bundle readable by B's run (no transcript)", async () => {
    const h = toP1_06Harness(createInMemoryHarness({ deps: {} }));
    const sc = await prepare(h);
    // Build the packet with prose that never mentions 'transcript' so the
    // assembled bundle can be asserted to contain no transcript substring at all.
    const packet = buildHandoffPacketV1({
      packetId: "packet-b-1",
      projectId: sc.projectId,
      goalId: P106_GOAL,
      taskId: P106_TASK_ID,
      planRef: sc.planRef,
      taskRevision: 1,
      runRef: runRef(sc.projectId, "run-a-1"),
      attemptRef: attemptRef(sc.projectId, P106_TASK_ID, "att-a-1"),
      constraints: ["保持同一 Task revision", "仅携带段落级摘要与引用"],
      completed: [
        {
          summary: "A 已完成步骤的有界摘要与引用",
          artifactRef: buildP106ArtifactRef({ digest: "digest-a-artifact" }),
          evidenceRefs: [{ aggregateType: "Evidence", projectId: sc.projectId, evidenceId: "ev-a-1" }],
        },
      ],
      unresolved: [{ kind: "outcome_unknown", summary: "副作用未确认，保留且不自动重试", artifactRef: null }],
    });
    await registerPacket(h, packet);
    const request = p106RequestB({
      projectId: sc.projectId,
      runId: "run-b-1",
      attemptId: "att-b-1",
      packetRef: packetRefFor(packet),
    });
    const before = await h.ledger.events({ afterCursor: null, limit: 500 });
    const result = await h.assembleHandoff(request);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.envelope.envelopeId).toBe("env-handoff-" + request.requestId);
    expect(result.envelope.runRef.runId).toBe("run-b-1");
    expect(result.envelope.attemptRef.attemptId).toBe("att-b-1");
    expect(result.envelope.roleBinding.bindingId).toBe(P106_ROLE_BINDING_V1.bindingId);
    expect(result.manifest.noFullTranscript).toBe(true);
    expect(result.manifest.packetRef).toEqual(packetRefFor(packet));
    expect(result.manifest.packetTaskRevision).toBe(packet.taskRevision);
    expect(result.manifest.gaps).toEqual([]);
    expect(result.manifest.selectedRefs.length).toBeGreaterThanOrEqual(3);
    expect(result.bundleRef.digest.length).toBe(64);

    // Body-first: the bundle was put BEFORE ready; B's run can open it.
    const opened = await h.vault.open(result.bundleRef, { requesterRunRef: request.runRef });
    expect(opened.status).toBe("ready");
    if (opened.status === "ready") {
      const bodyStr = opened.record.body;
      expect(bodyStr).not.toContain("transcript");
      const body = JSON.parse(bodyStr) as {
        schemaVersion: number;
        handoff: { packetId: string; objective: string; taskRevision: number };
        task: { title: string; obligations: unknown[] };
        noFullTranscript: boolean;
      };
      expect(body.schemaVersion).toBe(1);
      expect(body.handoff.packetId).toBe(packet.packetId);
      expect(body.handoff.taskRevision).toBe(packet.taskRevision);
      expect(body.handoff.objective).toBe(packet.objective);
      expect(body.task.title.length).toBeGreaterThan(0);
      expect(body.noFullTranscript).toBe(true);
      expect(JSON.stringify(body)).not.toContain("transcript");
    }
    const after = await h.ledger.events({ afterCursor: null, limit: 500 });
    expect(after.events.length).toBe(before.events.length); // vault-only write; no domain events
  });

  it("rejections zero-write: stale_workspace_snapshot / packet_mismatch / forbidden / budget / packet_not_found / needs_material", async () => {
    const h = toP1_06Harness(createInMemoryHarness({ deps: {} }));
    const sc = await prepare(h);
    // Register ALL packets first so the zero-write window covers only the
    // assemble calls below.
    const packet = buildPacket({ projectId: sc.projectId, planRef: sc.planRef, packetId: "packet-b-1" });
    const other = buildPacket({ projectId: sc.projectId, planRef: sc.planRef, taskId: P106_TASK_ID + "-other", packetId: "packet-other" });
    const noPlan = buildPacket({ projectId: sc.projectId, planRef: sc.planRef, packetId: "packet-noplan", planOverride: { aggregateType: "PlanRevision", projectId: sc.projectId, planId: "plan-missing" } });
    await registerPacket(h, packet);
    await registerPacket(h, other);
    await registerPacket(h, noPlan);
    const before = await h.ledger.events({ afterCursor: null, limit: 500 });

    const goodRef = packetRefFor(packet);
    const cases: [HandoffContextRequestV1, string][] = [
      [
        p106RequestB({ projectId: sc.projectId, runId: "run-b-2", attemptId: "att-b-2", packetRef: goodRef, workspaceRevision: 2 }),
        "stale_workspace_snapshot",
      ],
      [
        p106RequestB({ projectId: sc.projectId, runId: "run-b-3", attemptId: "att-b-3", packetRef: goodRef, scope: { tools: ["pwn"], writeScope: [] } }),
        "forbidden_tool_or_scope",
      ],
      [
        p106RequestB({ projectId: sc.projectId, runId: "run-b-4", attemptId: "att-b-4", packetRef: goodRef, budget: { tokenBudget: 100_000, deadline: "2020-01-01T00:00:00.000Z" } }),
        "budget_exhausted",
      ],
      [
        p106RequestB({
          projectId: sc.projectId, runId: "run-b-5", attemptId: "att-b-5",
          packetRef: handoffPacketRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, "packet-absent"),
        }),
        "packet_not_found",
      ],
    ];
    for (const [req, code] of cases) {
      const result = await h.assembleHandoff(req);
      expect(result.status, "expected " + code).toBe("rejected");
      if (result.status === "rejected") expect(result.code).toBe(code);
    }

    // packet_mismatch: uses the packet for a DIFFERENT task (registered above).
    const mismatchReq = p106RequestB({
      projectId: sc.projectId,
      runId: "run-b-6",
      attemptId: "att-b-6",
      packetRef: packetRefFor(other),
    });
    const mm = await h.assembleHandoff(mismatchReq);
    expect(mm.status).toBe("rejected");
    if (mm.status === "rejected") expect(mm.code).toBe("packet_mismatch");

    // needs_material: packet references a plan that is NOT registered (registered above).
    const noPlanReq = buildHandoffContextRequest({
      requestId: "req-noplan",
      projectId: sc.projectId,
      planRef: { aggregateType: "PlanRevision", projectId: sc.projectId, planId: "plan-missing" },
      runRef: runRef(sc.projectId, "run-b-np"),
      attemptRef: attemptRef(sc.projectId, P106_TASK_ID, "att-b-np"),
      handoffPacketRef: packetRefFor(noPlan),
    });
    const nm = await h.assembleHandoff(noPlanReq);
    expect(nm.status).toBe("needs_material");
    if (nm.status === "needs_material") expect(nm.gaps.some((g) => g.kind === "plan-revision")).toBe(true);

    const after = await h.ledger.events({ afterCursor: null, limit: 500 });
    expect(after.events.length).toBe(before.events.length);
  });

  it("invalid_request on malformed shape (no deref)", async () => {
    const h = toP1_06Harness(createInMemoryHarness({ deps: {} }));
    const sc = await prepare(h);
    const bad = {
      schemaVersion: 1,
      requestId: "req-bad",
      projectId: sc.projectId,
      workspaceId: P106_WORKSPACE,
      goalId: P106_GOAL,
      taskId: P106_TASK_ID,
      planRef: { aggregateType: "PlanRevision", projectId: sc.projectId, planId: "plan-handoff-mvp" },
      runRef: runRef(sc.projectId, "run-b-x"),
      attemptRef: attemptRef(sc.projectId, P106_TASK_ID, "att-b-x"),
      roleBinding: P106_ROLE_BINDING_V1,
      declaredPermissions: { tools: ["read"], writeScope: ["a"] },
      scope: { tools: ["read"], writeScope: ["a"] },
      workspaceSnapshot: { workspaceId: P106_WORKSPACE, revision: 1 },
      handoffPacketRef: undefined as never,
      budget: { tokenBudget: 1, deadline: null },
      submittedAt: P106_SCHEMA,
    };
    const result = await h.assembleHandoff(bad as unknown as HandoffContextRequestV1);
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.code).toBe("invalid_request");
  });

  it("stale_packet: packet workspace revision != canonical -> explicit stale_packet", async () => {
    // Build the real plan/workspace snapshots from a harness scenario, then
    // exercise the compiler against an in-test fake ledger that returns a STALE
    // packet snapshot (workspaceRevision 2 vs canonical 1). This isolates the
    // stale_packet branch without registering a stale packet on the real ledger
    // (recordHandoff rejects stale_source; direct registry writes are out of scope).
    const harness = toP1_06Harness(createInMemoryHarness({ deps: {} }));
    const sc = await prepareP106Scenario(harness);
    expect(sc.planSnapshot).toBeDefined();
    expect(sc.workspace).toBeDefined();
    const projectId = sc.projectId;

    const stalePacket = buildPacket({ projectId, planRef: sc.planRef, packetId: "packet-stale", workspaceRevision: 2 });
    const staleSnapshot = handoffPacketSnapshotFor(
      buildRecordHandoffCommand({
        commandId: "cmd-rec-stale",
        correlationId: "corr-rec-stale",
        submittedAt: stalePacket.generatedAt,
        projectId,
        packet: stalePacket,
      }),
      stalePacket.generatedAt,
    );

    const planSnapshot = sc.planSnapshot as PlanRevisionSnapshot;
    const workspaceSnapshot = sc.workspace as WorkspaceSnapshot;
    const fakeLedger: StateLedger = {
      async load(ref: AggregateRef): Promise<SnapshotResult> {
        if (ref.aggregateType === "Workspace") return { status: "found", snapshot: workspaceSnapshot };
        if (ref.aggregateType === "PlanRevision") return { status: "found", snapshot: planSnapshot };
        if (ref.aggregateType === "HandoffPacket") return { status: "found", snapshot: staleSnapshot };
        return { status: "not_found", ref };
      },
      async commit() { throw new Error("unused"); },
      async events() { throw new Error("unused"); },
      async pendingDispatchIntents() { throw new Error("unused"); },
    };

    const compiler = new HandoffContextCompilerImpl({
      ledger: fakeLedger,
      vault: createArtifactVault(),
      now: () => P106_SCHEMA,
    });
    const request = p106RequestB({
      projectId,
      runId: "run-b-s",
      attemptId: "att-b-s",
      packetRef: packetRefFor(stalePacket),
    });
    const result = await compiler.assemble(request);
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.code).toBe("stale_packet");
  });

  it("constant sanity: HANDOFF_CONTEXT_BUNDLE_MAX_BYTES equals the artifact cap", () => {
    expect(HANDOFF_CONTEXT_BUNDLE_MAX_BYTES).toBe(256 * 1024);
  });
});
