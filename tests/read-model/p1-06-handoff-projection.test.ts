import { ControlPolicyExplanation } from '../../src/control/control-engine/policy-explanation.js';
/**
 * P1-06 InMemory handoff-provenance projection tests — HandoffRecorded /
 * ReplacementClaimed / EvidenceAdmitted -> handoffProvenance timeline.
 *
 * Covers (ticket P1-06 lane C):
 *   - incremental projection (per-event pages, ordered timeline);
 *   - rebuild equivalence (empty index -> full replay == incremental);
 *   - full-key isolation (two Projects, same goalId/taskId, never collide);
 *   - freshness: not_ready != not_found; atLeastCursor covered but no row ->
 *     not_found; no atLeastCursor + no row -> not_ready (never not_found);
 *   - event-order preservation + outcomeUnknownPreserved constant true;
 *   - HandoffRecorded / ReplacementClaimed advance WITHOUT stalling (they are
 *     handled — a "known but unhandled" stall is intentionally NOT asserted).
 *
 * The projection is display-only: it never judges completion and never writes
 * a phase (only the read queries are asserted here).
 */
import { describe, expect, it } from "vitest";
import { ReadModelIndexImpl } from "../../src/data/read-model-index/read-model-index.js";
import { makeCommitCursor, type EventPage, type PositionedEvent } from "../../src/contracts/ledger.js";
import { P106_GOAL, P106_OBL_HANDOFF, P106_SCHEMA, P106_TASK_ID, P106_VR_STATIC, P106_WORKSPACE, buildClaimReplacementCommand, buildHandoffPacketV1, buildRecordHandoffCommand, p106PlanRef } from "../contract-support/fixtures/handoff-fixtures.js";
import { buildReplacementClaimLedgerCommit, handoffRecordedEventFor } from "../../src/control/control-engine/records/handoff.js";
import { buildEffectivityAnchorV1, buildEvidenceV1, buildSubmitEvidenceCommand } from "../contract-support/fixtures/evidence-fixtures.js";
import { buildEvidenceIntakeLedgerCommit } from "../../src/control/control-engine/records/evidence.js";
import { taskAttemptRefFor, taskLeaseRefFor, runRefFor, type TaskLeaseSnapshot } from "../../src/contracts/dispatch.js";
import { handoffPacketRefFor } from "../../src/contracts/handoff.js";
import type { ArchitectureBaselinePin, CompletionPolicyPin } from "../../src/contracts/governance.js";
import type { HandoffRecordedEvent, ReplacementClaimedEvent } from "../../src/contracts/handoff.js";
import type { EvidenceAdmittedEvent } from "../../src/contracts/evidence.js";

function json(v: unknown): string {
  return JSON.stringify(v);
}

function pins(projectId: string): { pinnedCompletionPolicy: CompletionPolicyPin; pinnedArchitectureBaseline: ArchitectureBaselinePin } {
  return {
    pinnedCompletionPolicy: {
      ref: { aggregateType: "CompletionPolicyRevision", projectId, policyId: "pol-handoff", revision: 1 },
      digest: "digest-pol-handoff",
    },
    pinnedArchitectureBaseline: {
      ref: { aggregateType: "ArchitectureBaselineRevision", projectId, baselineId: "arch-handoff", revision: 1 },
      digest: "digest-arch-handoff",
    },
  };
}

/** Build a deterministic HandoffRecorded event for projectId + packetId. */
function recordedEvent(projectId: string, packetId: string, eventId: string): HandoffRecordedEvent {
  const packet = buildHandoffPacketV1({
    packetId,
    projectId,
    goalId: P106_GOAL,
    taskId: P106_TASK_ID,
    planRef: p106PlanRef(projectId),
    taskRevision: 1,
    runRef: runRefFor(projectId, P106_GOAL, "run-a-" + packetId),
    attemptRef: taskAttemptRefFor(projectId, P106_GOAL, P106_TASK_ID, "att-a-" + packetId),
  });
  const command = buildRecordHandoffCommand({
    commandId: "cmd-rec-" + eventId,
    correlationId: "corr-rec-" + eventId,
    submittedAt: P106_SCHEMA,
    projectId,
    packet,
  });
  return handoffRecordedEventFor(command, { eventId, occurredAt: P106_SCHEMA, workspaceId: P106_WORKSPACE });
}

/** Build a deterministic ReplacementClaimed event (B's new attempt/run). */
function claimedEvent(
  projectId: string,
  packetId: string,
  eventId: string,
  attemptB: string,
  runB: string,
): ReplacementClaimedEvent {
  const packetRef = handoffPacketRefFor(projectId, P106_GOAL, P106_TASK_ID, packetId);
  const priorLease: TaskLeaseSnapshot = {
    ref: taskLeaseRefFor(projectId, P106_GOAL, P106_TASK_ID),
    revision: 1,
    schemaVersion: 1,
    holderRunId: "run-a",
    attemptId: "att-a",
    grantedAt: P106_SCHEMA,
    expiresAt: null,
  };
  const command = buildClaimReplacementCommand({
    commandId: "cmd-claim-" + eventId,
    correlationId: "corr-claim-" + eventId,
    submittedAt: P106_SCHEMA,
    projectId,
    goalId: P106_GOAL,
    taskId: P106_TASK_ID,
    expectedRevision: 1,
    attemptId: attemptB,
    runId: runB,
    handoffPacketRef: packetRef,
    reason: "run_crashed",
  });
  const commit = buildReplacementClaimLedgerCommit(command, {
    eventId,
    occurredAt: P106_SCHEMA,
    workspaceId: P106_WORKSPACE,
    workspaceRevision: 1,
    planRef: p106PlanRef(projectId),
    priorLease,
    priorRunRef: runRefFor(projectId, P106_GOAL, "run-a"),
    priorAttemptRef: taskAttemptRefFor(projectId, P106_GOAL, P106_TASK_ID, "att-a"),
  });
  return commit.events[0];
}

/** Build a deterministic EvidenceAdmitted event for projectId + evidenceId. */
function evidenceEvent(projectId: string, evidenceId: string, eventId: string, runId: string): EvidenceAdmittedEvent {
  const pr = pins(projectId);
  const anchor = buildEffectivityAnchorV1({
    planRef: p106PlanRef(projectId),
    planRevision: 1,
    workspaceRevision: 1,
    pinnedCompletionPolicy: pr.pinnedCompletionPolicy,
    pinnedArchitectureBaseline: pr.pinnedArchitectureBaseline,
  });
  const evidence = buildEvidenceV1({
    evidenceId,
    kind: "observation",
    outcome: "PASS",
    projectId,
    goalId: P106_GOAL,
    taskId: P106_TASK_ID,
    coverage: [{ obligationId: P106_OBL_HANDOFF, requirementId: P106_VR_STATIC }],
    runRef: runRefFor(projectId, P106_GOAL, runId),
    checkId: "static-lint",
    anchor,
    verificationPlanRef: { planId: "vp-handoff", planDigest: "digest-handoff" },
  });
  const command = buildSubmitEvidenceCommand({
    commandId: "cmd-ev-" + eventId,
    evidence,
    correlationId: "corr-ev-" + eventId,
    submittedAt: P106_SCHEMA,
  });
  const commit = buildEvidenceIntakeLedgerCommit(command, {
    eventId,
    occurredAt: P106_SCHEMA,
    workspaceId: P106_WORKSPACE,
    priorIndex: null,
  });
  return commit.events[0];
}

function pos(event: { eventType: string }, seq: number): PositionedEvent {
  return { cursor: makeCommitCursor(seq), event: event as never };
}

function page(events: PositionedEvent[], throughSeq: number): EventPage {
  return {
    afterCursor: null,
    throughCursor: makeCommitCursor(throughSeq),
    events,
    hasMore: false,
  };
}

describe("P1-06 InMemory handoff-provenance projection", () => {
  it("incremental projection: packet_recorded -> replacement_claimed -> evidence_admitted in event order", async () => {
    const rm = new ReadModelIndexImpl(new ControlPolicyExplanation());
    const projectId = "proj-alpha";
    const rec = recordedEvent(projectId, "packet-1", "ev-rec-1");
    const claim = claimedEvent(projectId, "packet-1", "ev-claim-2", "att-b-2", "run-b-2");
    const evA = evidenceEvent(projectId, "ev-a-3", "ev-ev-3", "run-a-1");
    const evB = evidenceEvent(projectId, "ev-b-4", "ev-ev-4", "run-b-2");

    await rm.advance(page([pos(rec, 1)], 1));
    await rm.advance(page([pos(claim, 2)], 2));
    await rm.advance(page([pos(evA, 3)], 3));
    await rm.advance(page([pos(evB, 4)], 4));

    const result = await rm.handoffProvenance({ projectId, goalId: P106_GOAL, taskId: P106_TASK_ID });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const prov = result.provenance;

    expect(prov.projectId).toBe(projectId);
    expect(prov.goalId).toBe(P106_GOAL);
    expect(prov.taskId).toBe(P106_TASK_ID);
    expect(prov.outcomeUnknownPreserved).toBe(true);
    expect(prov.taskRevision).toBe(1);
    expect(json(prov.planRef)).toBe(json(p106PlanRef(projectId)));
    expect(prov.packetRefs).toHaveLength(1);
    expect(prov.packetRefs[0]!.packetId).toBe("packet-1");
    expect(prov.replacementRefs).toHaveLength(1);
    expect(prov.replacementRefs[0]!.attemptId).toBe("att-b-2");

    expect(prov.timeline.map((e) => e.kind)).toEqual([
      "packet_recorded",
      "replacement_claimed",
      "evidence_admitted",
      "evidence_admitted",
    ]);

    const pk = prov.timeline[0];
    expect(pk!.kind).toBe("packet_recorded");
    if (pk!.kind === "packet_recorded") {
      expect(pk!.packetId).toBe("packet-1");
      expect(pk!.sourceRunRef.runId).toBe("run-a-packet-1");
      expect(pk!.sourceAttemptRef.attemptId).toBe("att-a-packet-1");
      expect(pk!.taskRevision).toBe(1);
      expect(pk!.workspaceSnapshot).toEqual({ workspaceId: P106_WORKSPACE, revision: 1 });
      expect(pk!.sourceCursor).toBe(makeCommitCursor(1));
    }

    const cp = prov.timeline[1];
    expect(cp!.kind).toBe("replacement_claimed");
    if (cp!.kind === "replacement_claimed") {
      expect(cp!.reason).toBe("run_crashed");
      expect(cp!.priorRunRef.runId).toBe("run-a");
      expect(cp!.runRef.runId).toBe("run-b-2");
      expect(cp!.attemptRef.attemptId).toBe("att-b-2");
      expect(cp!.sourceCursor).toBe(makeCommitCursor(2));
    }

    const ea = prov.timeline[2];
    expect(ea!.kind).toBe("evidence_admitted");
    if (ea!.kind === "evidence_admitted") {
      expect(ea!.evidenceId).toBe("ev-a-3");
      expect(ea!.outcome).toBe("PASS");
      expect(ea!.evidenceKind).toBe("observation");
      expect(ea!.sourceRunRef!.runId).toBe("run-a-1");
      expect(ea!.planRevision).toBe(1);
      expect(json(ea!.planRef)).toBe(json(p106PlanRef(projectId)));
      expect(ea!.sourceCursor).toBe(makeCommitCursor(3));
    }
    const eb = prov.timeline[3];
    if (eb!.kind === "evidence_admitted") expect(eb!.sourceRunRef!.runId).toBe("run-b-2");

    expect(prov.sourceCursor).toBe(makeCommitCursor(4));
  });

  it("rebuild equivalence: empty fresh index -> full replay == incremental (field-for-field)", async () => {
    const projectId = "proj-alpha";
    const rec = recordedEvent(projectId, "packet-rb", "ev-rec-rb");
    const claim = claimedEvent(projectId, "packet-rb", "ev-claim-rb", "att-b-rb", "run-b-rb");
    const evA = evidenceEvent(projectId, "ev-rb-a", "ev-ev-rb-a", "run-a-1");
    const evB = evidenceEvent(projectId, "ev-rb-b", "ev-ev-rb-b", "run-b-rb");

    const incremental = new ReadModelIndexImpl(new ControlPolicyExplanation());
    await incremental.advance(page([pos(rec, 1)], 1));
    await incremental.advance(page([pos(claim, 2)], 2));
    await incremental.advance(page([pos(evA, 3)], 3));
    await incremental.advance(page([pos(evB, 4)], 4));
    const before = await incremental.handoffProvenance({ projectId, goalId: P106_GOAL, taskId: P106_TASK_ID });
    expect(before.status).toBe("ready");

    const fresh = new ReadModelIndexImpl(new ControlPolicyExplanation());
    await fresh.advance(page([pos(rec, 1), pos(claim, 2), pos(evA, 3), pos(evB, 4)], 4));
    const rebuilt = await fresh.handoffProvenance({ projectId, goalId: P106_GOAL, taskId: P106_TASK_ID });
    expect(rebuilt.status).toBe("ready");
    if (before.status === "ready" && rebuilt.status === "ready") {
      expect(json(rebuilt.provenance)).toBe(json(before.provenance));
    }
  });

  it("full-key isolation: two Projects share goalId/taskId without colliding", async () => {
    const rm = new ReadModelIndexImpl(new ControlPolicyExplanation());
    const alpha = recordedEvent("proj-alpha", "packet-isol-a", "ev-isol-a");
    const beta = recordedEvent("proj-beta", "packet-isol-b", "ev-isol-b");
    await rm.advance(page([pos(alpha, 1), pos(beta, 2)], 2));

    const a = await rm.handoffProvenance({ projectId: "proj-alpha", goalId: P106_GOAL, taskId: P106_TASK_ID });
    const b = await rm.handoffProvenance({ projectId: "proj-beta", goalId: P106_GOAL, taskId: P106_TASK_ID });
    expect(a.status).toBe("ready");
    expect(b.status).toBe("ready");
    if (a.status === "ready") {
      expect(a.provenance.projectId).toBe("proj-alpha");
      expect(a.provenance.packetRefs[0]!.packetId).toBe("packet-isol-a");
      expect(a.provenance.planRef!.projectId).toBe("proj-alpha");
    }
    if (b.status === "ready") {
      expect(b.provenance.projectId).toBe("proj-beta");
      expect(b.provenance.packetRefs[0]!.packetId).toBe("packet-isol-b");
      expect(b.provenance.planRef!.projectId).toBe("proj-beta");
    }
    if (a.status === "ready") expect(JSON.stringify(a.provenance)).not.toContain("packet-isol-b");
  });

  it("freshness: not_ready != not_found; covered-atLeastCursor with no row -> not_found", async () => {
    const rm = new ReadModelIndexImpl(new ControlPolicyExplanation());
    const cold = await rm.handoffProvenance({ projectId: "proj-alpha", goalId: P106_GOAL, taskId: P106_TASK_ID });
    expect(cold.status).toBe("not_ready");

    const rec = recordedEvent("proj-alpha", "packet-fresh", "ev-rec-fresh");
    await rm.advance(page([pos(rec, 1)], 1));
    const covered = makeCommitCursor(1);

    const missing = await rm.handoffProvenance({
      projectId: "proj-alpha",
      goalId: P106_GOAL,
      taskId: "task-never",
      atLeastCursor: covered,
    });
    expect(missing.status).toBe("not_found");
    const notCovered = await rm.handoffProvenance({
      projectId: "proj-alpha",
      goalId: P106_GOAL,
      taskId: "task-never",
      atLeastCursor: makeCommitCursor(2),
    });
    expect(notCovered.status).toBe("not_ready");
    const noCursor = await rm.handoffProvenance({ projectId: "proj-alpha", goalId: P106_GOAL, taskId: "task-never" });
    expect(noCursor.status).toBe("not_ready");
    const ready = await rm.handoffProvenance({
      projectId: "proj-alpha",
      goalId: P106_GOAL,
      taskId: P106_TASK_ID,
      atLeastCursor: covered,
    });
    expect(ready.status).toBe("ready");
  });

  it("outcomeUnknownPreserved always true; timeline order survives mixed writes", async () => {
    const rm = new ReadModelIndexImpl(new ControlPolicyExplanation());
    const projectId = "proj-alpha";
    const rec = recordedEvent(projectId, "packet-ou", "ev-ou-1");
    const claim = claimedEvent(projectId, "packet-ou", "ev-ou-2", "att-b-ou", "run-b-ou");
    const ev = evidenceEvent(projectId, "ev-ou-3", "ev-ou-3", "run-b-ou");
    await rm.advance(page([pos(rec, 1), pos(claim, 2), pos(ev, 3)], 3));
    const r = await rm.handoffProvenance({ projectId, goalId: P106_GOAL, taskId: P106_TASK_ID });
    expect(r.status).toBe("ready");
    if (r.status === "ready") {
      expect(r.provenance.outcomeUnknownPreserved).toBe(true);
      expect(r.provenance.timeline.map((e) => e.kind)).toEqual([
        "packet_recorded",
        "replacement_claimed",
        "evidence_admitted",
      ]);
      expect(r.provenance.timeline.filter((e) => e.kind === "replacement_claimed")).toHaveLength(1);
    }

    const rm2 = new ReadModelIndexImpl(new ControlPolicyExplanation());
    await rm2.advance(page([pos(ev, 1)], 1));
    const r2 = await rm2.handoffProvenance({ projectId, goalId: P106_GOAL, taskId: P106_TASK_ID });
    expect(r2.status).toBe("ready");
    if (r2.status === "ready") {
      expect(r2.provenance.outcomeUnknownPreserved).toBe(true);
      expect(r2.provenance.timeline).toHaveLength(1);
    }
  });

  it("HandoffRecorded / ReplacementClaimed advance without stalling (handled event types)", async () => {
    const rm = new ReadModelIndexImpl(new ControlPolicyExplanation());
    const projectId = "proj-alpha";
    const rec = recordedEvent(projectId, "packet-nostall", "ev-nostall-1");
    const claim = claimedEvent(projectId, "packet-nostall", "ev-nostall-2", "att-b-ns", "run-b-ns");
    const boot = {
      eventId: "ev-boot-ns",
      eventType: "WorkspaceBootstrapped",
      schemaVersion: 1,
      projectId,
      workspaceId: P106_WORKSPACE,
      aggregateType: "Workspace",
      aggregateId: P106_WORKSPACE,
      aggregateRevision: 1,
      causationId: "cmd-boot",
      correlationId: "corr-boot",
      idempotencyKey: "boot-ns",
      actor: { kind: "system", id: "bootstrap" },
      occurredAt: P106_SCHEMA,
      payload: { workspaceId: P106_WORKSPACE, projectId, desiredState: "active" },
    };
    const receipt = await rm.advance(page([pos(boot as never, 1), pos(rec, 2), pos(claim, 3)], 3));
    expect(receipt.appliedEventIds).toHaveLength(3);
    const r = await rm.handoffProvenance({ projectId, goalId: P106_GOAL, taskId: P106_TASK_ID });
    expect(r.status).toBe("ready");
    if (r.status === "ready") {
      expect(r.provenance.timeline.map((e) => e.kind)).toEqual(["packet_recorded", "replacement_claimed"]);
    }
  });

  it("projection never judges completion: repeated reads are stable", async () => {
    const rm = new ReadModelIndexImpl(new ControlPolicyExplanation());
    const projectId = "proj-alpha";
    const rec = recordedEvent(projectId, "packet-ro", "ev-ro-1");
    const ev = evidenceEvent(projectId, "ev-ro-2", "ev-ro-2", "run-a-1");
    await rm.advance(page([pos(rec, 1), pos(ev, 2)], 2));
    const r1 = await rm.handoffProvenance({ projectId, goalId: P106_GOAL, taskId: P106_TASK_ID });
    expect(r1.status).toBe("ready");
    const r2 = await rm.handoffProvenance({ projectId, goalId: P106_GOAL, taskId: P106_TASK_ID });
    expect(r2.status).toBe("ready");
    if (r1.status === "ready" && r2.status === "ready") {
      expect(json(r2.provenance)).toBe(json(r1.provenance));
    }
  });
});

