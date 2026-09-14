/**
 * P1-06 handoff contract suite — parameterized: the SAME definition runs
 * against InMemory and SQLite harnesses (dual-adapter requirement).
 *
 * Frozen scope (IMPLEMENTATION-HANDOFF "P1-06 契约与存储语义"):
 *   - HandoffPacket bounded shape + explicit noFullTranscript;
 *   - recordHandoff: body-first registration, run_not_ended / stale_source /
 *     not_found rejections, full idempotency, immutable aggregate;
 *   - ReplacementAttempt: B's new lifecycle (lease CAS), eligible ONLY after A
 *     ended / lease expired; A's late facts rejected (P1-03 per-run sequence,
 *     never rolling B back);
 *   - HandoffContextPort: canonical source revision (explicit stale + re-project,
 *     never silent old-use), no transcript reading, body-first bundle;
 *   - HandoffControlPort: pause/stop + public snapshot (no hidden context);
 *   - verification-path traceability: A/B evidence under the SAME task revision;
 *   - outcome_unknown preserved (packet + view), no auto-retry of irreversible
 *     actions;
 *   - provenance timeline is display-only (never writes a phase).
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { validateHandoffPacket, validateRecordHandoffCommand, validateClaimReplacementCommand, validateHandoffContextRequest, validateHandoffControlCommand, validateHandoffSnapshotQuery } from '../../src/contracts/validation/handoff.js';
import { evaluateReplacementEligibility } from "../../src/control/control-engine/policies/replacement-eligibility.js";
import { handoffPacketRefFor, replacementAttemptRefFor, HANDOFF_PACKET_MAX_BYTES, HANDOFF_SUMMARY_MAX_BYTES } from "../../src/contracts/handoff.js";
import {
  P106_BUDGET_V1,
  P106_DECLARED_PERMISSIONS_V1,
  P106_GOAL,
  P106_PLAN_ID,
  P106_PROJECT,
  P106_SCHEMA,
  P106_TASK_ID,
  P106_WORKSPACE,
  buildClaimReplacementCommand,
  buildHandoffPacketV1,
  buildRecordHandoffCommand,
} from "../contract-support/fixtures/handoff-fixtures.js";
import {
  prepareP106Scenario,
  endP106RunA,
  runP106ClaimedRun,
  p106RequestB,
  type P1_06TestHarness,
} from "./p1-06-harness.js";
import type { P1_06HarnessFactory } from "./p1-06-harness.js";
import { runRefFor, taskAttemptRefFor, taskLeaseRefFor } from "../../src/contracts/dispatch.js";
import { artifactBodyDigest, type ArtifactRef } from "../../src/contracts/artifact.js";
import { buildRunFactCommand, rebaseScriptForRun, FAKE_RUNTIME_SCRIPT_CRASHED_V1 } from "../../src/fixtures/dispatch-fixtures.js";
import { p106PlanRefFor } from "./p1-06-harness.js";
import { handoffPacketRefFor as hpr } from "../../src/contracts/handoff.js";
import { FakeHandoffControlPort } from "../contract-support/testing/handoff-control.double.js";
import { sha256Hex } from "../../src/contracts/fingerprint.js";
import { buildEffectivityAnchorV1, buildEvidenceV1, buildSubmitEvidenceCommand } from "../contract-support/fixtures/evidence-fixtures.js";
import { P106_OBL_HANDOFF, P106_TASK_ID as P106_TASK, P106_VR_DYNAMIC, P106_VR_STATIC } from "../contract-support/fixtures/handoff-fixtures.js";

let harness: P1_06TestHarness | null = null;

export function defineHandoffContractSuite(factory: P1_06HarnessFactory): void {
  async function h(): Promise<P1_06TestHarness> {
    if (harness === null) {
      harness = await factory();
    }
    return harness;
  }

  describe("P1-06 handoff contract suite", () => {
    beforeEach(async () => {
      harness = await factory();
    });
    afterEach(async () => {
      harness = null;
    });

    // ------------------------------------------------------------------ //
    // 1. HandoffPacket bounded shape + strict schema                       //
    // ------------------------------------------------------------------ //

    describe("HandoffPacket bounded shape", () => {
      it("valid packet passes validation with no issues", () => {
        const packet = buildHandoffPacketV1({
          packetId: "packet-1",
          projectId: P106_PROJECT,
          goalId: P106_GOAL,
          taskId: P106_TASK_ID,
          planRef: p106PlanRefFor(P106_PROJECT),
          taskRevision: 1,
          runRef: runRefFor(P106_PROJECT, P106_GOAL, "run-a-1"),
          attemptRef: taskAttemptRefFor(P106_PROJECT, P106_GOAL, P106_TASK_ID, "att-a-1"),
        });
        expect(validateHandoffPacket(packet)).toEqual([]);
        expect(packet.noFullTranscript).toBe(true);
      });

      it("rejects a hidden transcript field (strict unknown-field rejection)", () => {
        const packet = buildHandoffPacketV1({
          packetId: "packet-2",
          projectId: P106_PROJECT,
          goalId: P106_GOAL,
          taskId: P106_TASK_ID,
          planRef: p106PlanRefFor(P106_PROJECT),
          taskRevision: 1,
          runRef: runRefFor(P106_PROJECT, P106_GOAL, "run-a-1"),
          attemptRef: taskAttemptRefFor(P106_PROJECT, P106_GOAL, P106_TASK_ID, "att-a-1"),
        }) as Record<string, unknown>;
        (packet as Record<string, unknown>)["transcript"] = "hidden chain of thought";
        const issues = validateHandoffPacket(packet);
        expect(issues.some((i) => i.code === "unknown_field" && i.path.includes("transcript"))).toBe(true);
      });

      it("rejects noFullTranscript=false (explicit guarantee)", () => {
        const packet = buildHandoffPacketV1({
          packetId: "packet-3",
          projectId: P106_PROJECT,
          goalId: P106_GOAL,
          taskId: P106_TASK_ID,
          planRef: p106PlanRefFor(P106_PROJECT),
          taskRevision: 1,
          runRef: runRefFor(P106_PROJECT, P106_GOAL, "run-a-1"),
          attemptRef: taskAttemptRefFor(P106_PROJECT, P106_GOAL, P106_TASK_ID, "att-a-1"),
        }) as unknown as Record<string, unknown>;
        packet["noFullTranscript"] = false;
        const issues = validateHandoffPacket(packet);
        expect(issues.some((i) => i.path === "noFullTranscript")).toBe(true);
      });

      it("rejects an over-cap packet with size_exceeded", () => {
        const big = "x".repeat(HANDOFF_PACKET_MAX_BYTES);
        const packet = buildHandoffPacketV1({
          packetId: "packet-4",
          projectId: P106_PROJECT,
          goalId: P106_GOAL,
          taskId: P106_TASK_ID,
          planRef: p106PlanRefFor(P106_PROJECT),
          taskRevision: 1,
          runRef: runRefFor(P106_PROJECT, P106_GOAL, "run-a-1"),
          attemptRef: taskAttemptRefFor(P106_PROJECT, P106_GOAL, P106_TASK_ID, "att-a-1"),
          objective: big,
        });
        const issues = validateHandoffPacket(packet);
        expect(issues.some((i) => i.code === "size_exceeded")).toBe(true);
      });

      it("rejects an over-cap summary with size_exceeded", () => {
        const packet = buildHandoffPacketV1({
          packetId: "packet-5",
          projectId: P106_PROJECT,
          goalId: P106_GOAL,
          taskId: P106_TASK_ID,
          planRef: p106PlanRefFor(P106_PROJECT),
          taskRevision: 1,
          runRef: runRefFor(P106_PROJECT, P106_GOAL, "run-a-1"),
          attemptRef: taskAttemptRefFor(P106_PROJECT, P106_GOAL, P106_TASK_ID, "att-a-1"),
          completed: [{ summary: "y".repeat(HANDOFF_SUMMARY_MAX_BYTES + 1), artifactRef: null, evidenceRefs: [] }],
        });
        const issues = validateHandoffPacket(packet);
        expect(issues.some((i) => i.code === "size_exceeded")).toBe(true);
      });
    });

    // ------------------------------------------------------------------ //
    // 2. recordHandoff (Control) — body-first registration                  //
    // ------------------------------------------------------------------ //

    describe("recordHandoff registration", () => {
      it("commits a bounded packet after A ended (crash) and replays idempotently", async () => {
        const hh = await h();
        const sc = await prepareP106Scenario(hh);
        await endP106RunA(hh, { projectId: sc.projectId, taskId: P106_TASK_ID, runId: "run-a-1", attemptId: "att-a-1", script: "crashed" });
        const runRef = runRefFor(sc.projectId, P106_GOAL, "run-a-1");
        const packet = buildHandoffPacketV1({
          packetId: "packet-rh-1",
          projectId: sc.projectId,
          goalId: P106_GOAL,
          taskId: P106_TASK_ID,
          planRef: sc.planRef,
          taskRevision: 1,
          runRef,
          attemptRef: taskAttemptRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, "att-a-1"),
        });
        // body-first: the packet body is put into the vault BEFORE registration.
        const put = await hh.vault.put({
          contentType: "application/json",
          body: JSON.stringify(packet),
          sourceRefs: [{ kind: "artifact", refId: "packet-body-" + packet.packetId, revision: "1", digest: artifactBodyDigest(JSON.stringify(packet)) }],
          ownerRef: runRef,
          requestedAt: P106_SCHEMA,
        });
        expect(put.status).toBe("stored");
        const command = buildRecordHandoffCommand({
          commandId: "cmd-rh-1",
          correlationId: "corr-rh-1",
          submittedAt: P106_SCHEMA,
          projectId: sc.projectId,
          packet: { ...packet, bodyRef: put.status === "stored" ? put.ref : packet.bodyRef },
        });
        const receipt = await hh.recordHandoff(command);
        expect(receipt.status).toBe("committed");
        if (receipt.status !== "committed") return;
        const loaded = await hh.ledger.load(hpr(sc.projectId, P106_GOAL, P106_TASK_ID, "packet-rh-1"));
        expect(loaded.status).toBe("found");
        if (loaded.status === "found") {
          expect(JSON.stringify(loaded.snapshot)).toContain('"packetId":"packet-rh-1"');
          expect((loaded.snapshot as { packet: { noFullTranscript: boolean } }).packet.noFullTranscript).toBe(true);
        }
        // Idempotent replay.
        const replay = await hh.recordHandoff(command);
        expect(replay.status).toBe("committed");
        if (replay.status === "committed") expect(replay.replayed).toBe(true);
      });

      it("rejects a handoff while A's run is still active (run_not_ended)", async () => {
        const hh = await h();
        const sc = await prepareP106Scenario(hh);
        await runP106ClaimedRun(hh, { projectId: sc.projectId, taskId: P106_TASK_ID, runId: "run-a-2", attemptId: "att-a-2" });
        const packet = buildHandoffPacketV1({
          packetId: "packet-rh-2",
          projectId: sc.projectId,
          goalId: P106_GOAL,
          taskId: P106_TASK_ID,
          planRef: sc.planRef,
          taskRevision: 1,
          runRef: runRefFor(sc.projectId, P106_GOAL, "run-a-2"),
          attemptRef: taskAttemptRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, "att-a-2"),
        });
        const receipt = await hh.recordHandoff(
          buildRecordHandoffCommand({
            commandId: "cmd-rh-2",
            correlationId: "corr-rh-2",
            submittedAt: P106_SCHEMA,
            projectId: sc.projectId,
            packet,
          }),
        );
        expect(receipt.status).toBe("rejected");
        if (receipt.status === "rejected") expect(receipt.code).toBe("run_not_ended");
      });

      it("rejects a stale-source packet explicitly (stale_source) — re-project a fresh one", async () => {
        const hh = await h();
        const sc = await prepareP106Scenario(hh);
        await endP106RunA(hh, { projectId: sc.projectId, taskId: P106_TASK_ID, runId: "run-a-3", attemptId: "att-a-3", script: "crashed" });
        const packet = buildHandoffPacketV1({
          packetId: "packet-rh-3",
          projectId: sc.projectId,
          goalId: P106_GOAL,
          taskId: P106_TASK_ID,
          planRef: sc.planRef,
          taskRevision: 1,
          runRef: runRefFor(sc.projectId, P106_GOAL, "run-a-3"),
          attemptRef: taskAttemptRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, "att-a-3"),
          workspaceRevision: 2, // !== canonical 1
        });
        const receipt = await hh.recordHandoff(
          buildRecordHandoffCommand({
            commandId: "cmd-rh-3",
            correlationId: "corr-rh-3",
            submittedAt: P106_SCHEMA,
            projectId: sc.projectId,
            packet,
          }),
        );
        expect(receipt.status).toBe("rejected");
        if (receipt.status === "rejected") expect(receipt.code).toBe("stale_source");
        // Re-projection: a fresh packet at the current revision commits.
        const fresh = buildHandoffPacketV1({
          packetId: "packet-rh-3f",
          projectId: sc.projectId,
          goalId: P106_GOAL,
          taskId: P106_TASK_ID,
          planRef: sc.planRef,
          taskRevision: 1,
          runRef: runRefFor(sc.projectId, P106_GOAL, "run-a-3"),
          attemptRef: taskAttemptRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, "att-a-3"),
          workspaceRevision: 1,
        });
        const receipt2 = await hh.recordHandoff(
          buildRecordHandoffCommand({
            commandId: "cmd-rh-3f",
            correlationId: "corr-rh-3f",
            submittedAt: P106_SCHEMA,
            projectId: sc.projectId,
            packet: fresh,
          }),
        );
        expect(receipt2.status).toBe("committed");
      });
    });

    // ------------------------------------------------------------------ //
    // 3. Replacement eligibility (pure)                                    //
    // ------------------------------------------------------------------ //

    describe("evaluateReplacementEligibility (pure)", () => {
      // Minimal accepted-plan snapshot: the handoff task is dispatchable
      // (work/active/pending) with no DAG edges — enough for the pure function.
      const p106MinimalPlan = (): import("../../src/contracts/plan.js").PlanRevisionSnapshot => ({
        ref: p106PlanRefFor(P106_PROJECT),
        revision: 1,
        schemaVersion: 1,
        goalRef: { aggregateType: "Goal", projectId: P106_PROJECT, goalId: P106_GOAL },
        planId: P106_PLAN_ID,
        planRevision: 1,
        acceptedAt: P106_SCHEMA,
        effectiveCompletionPolicy: { ref: { aggregateType: "CompletionPolicyRevision", projectId: P106_PROJECT, policyId: "policy-completion-mvp", revision: 1 }, digest: "5".repeat(64) },
        effectiveArchitectureBaseline: { ref: { aggregateType: "ArchitectureBaselineRevision", projectId: P106_PROJECT, baselineId: "baseline-architecture-mvp", revision: 1 }, digest: "6".repeat(64) },
        stages: [{ stageId: "stage-handoff", title: "handoff" }],
        tasks: [{ taskId: P106_TASK_ID, stageId: "stage-handoff", title: "handoff target", requirementLevel: "required", taskKind: "work", disposition: "active", phase: "pending", scope: { kind: "stage", stageId: "stage-handoff" } }],
        obligations: [],
        taskHierarchy: { parentOf: [] },
        executionDag: { dependsOn: [] },
      });
      const base = () => ({
        projectId: P106_PROJECT,
        goalId: P106_GOAL,
        goalDesiredState: "active",
        goalActivePlanRevision: p106PlanRefFor(P106_PROJECT),
        plan: p106MinimalPlan(),
        taskId: P106_TASK_ID,
        priorLease: { status: "leased" as const, holderRunId: "run-a", attemptId: "att-a", grantedAt: P106_SCHEMA, expiresAt: null },
        priorAttempt: { status: "ended" as const, endedAt: P106_SCHEMA, endOutcome: "crashed" as const },
        packet: {
          present: true as const,
          projectId: P106_PROJECT,
          goalId: P106_GOAL,
          taskId: P106_TASK_ID,
          planRef: p106PlanRefFor(P106_PROJECT),
          taskRevision: 1,
          workspaceSnapshot: { workspaceId: P106_WORKSPACE, revision: 1 },
        },
        canonicalWorkspaceRevision: 1,
        resource: { tokenBudget: 100_000, deadline: null, now: P106_SCHEMA },
      });

      it("eligible when A ended", () => {
        const eligibility = evaluateReplacementEligibility(base() as never);
        expect(eligibility.eligible).toBe(true);
      });

      it("eligible when A's lease is EXPIRED (even though attempt not ended)", () => {
        const facts = { ...base(), priorLease: { status: "leased" as const, holderRunId: "run-a", attemptId: "att-a", grantedAt: P106_SCHEMA, expiresAt: "2020-01-01T00:00:00.000Z" }, priorAttempt: { status: "started" as const, endedAt: null, endOutcome: null } };
        const eligibility = evaluateReplacementEligibility(facts as never);
        expect(eligibility.eligible).toBe(true);
      });

      it("lease_active when A neither ended nor expired", () => {
        const facts = { ...base(), priorAttempt: { status: "started" as const, endedAt: null, endOutcome: null } };
        const eligibility = evaluateReplacementEligibility(facts as never);
        expect(eligibility.eligible).toBe(false);
        if (!eligibility.eligible) expect(eligibility.reasons.some((r) => r.code === "lease_active")).toBe(true);
      });

      it("stale_packet explicit (workspace revision mismatch) — never silently reused", () => {
        const facts = { ...base(), packet: { present: true as const, projectId: P106_PROJECT, goalId: P106_GOAL, taskId: P106_TASK_ID, planRef: p106PlanRefFor(P106_PROJECT), taskRevision: 1, workspaceSnapshot: { workspaceId: P106_WORKSPACE, revision: 2 } } };
        const eligibility = evaluateReplacementEligibility(facts as never);
        expect(eligibility.eligible).toBe(false);
        if (!eligibility.eligible) expect(eligibility.reasons.some((r) => r.code === "stale_packet")).toBe(true);
      });

      it("packet_mismatch when packet targets a different task", () => {
        const facts = { ...base(), packet: { present: true as const, projectId: P106_PROJECT, goalId: P106_GOAL, taskId: "other-task", planRef: p106PlanRefFor(P106_PROJECT), taskRevision: 1, workspaceSnapshot: { workspaceId: P106_WORKSPACE, revision: 1 } } };
        const eligibility = evaluateReplacementEligibility(facts as never);
        expect(eligibility.eligible).toBe(false);
        if (!eligibility.eligible) expect(eligibility.reasons.some((r) => r.code === "packet_mismatch")).toBe(true);
      });

      it("no_prior_attempt when there is no lease", () => {
        const facts = { ...base(), priorLease: { status: "none" as const }, priorAttempt: null };
        const eligibility = evaluateReplacementEligibility(facts as never);
        expect(eligibility.eligible).toBe(false);
        if (!eligibility.eligible) expect(eligibility.reasons.some((r) => r.code === "no_prior_attempt")).toBe(true);
      });
    });

    // ------------------------------------------------------------------ //
    // 4. claimReplacement (Control) — A ended -> B new lifecycle            //
    // ------------------------------------------------------------------ //

    describe("claimReplacement lifecycle", () => {
      it("commits B's new attempt/run/outbox/replacement after A crashed", async () => {
        const hh = await h();
        const sc = await prepareP106Scenario(hh);
        await endP106RunA(hh, { projectId: sc.projectId, taskId: P106_TASK_ID, runId: "run-a-4", attemptId: "att-a-4", script: "crashed" });
        const pre = await hh.ledger.load(taskLeaseRefFor(sc.projectId, P106_GOAL, P106_TASK_ID));
        expect(pre.status).toBe("found");
        const priorLease = pre.status === "found" ? (pre.snapshot as { revision: number; holderRunId: string; attemptId: string }) : null;
        expect(priorLease).not.toBeNull();
        const packet = buildHandoffPacketV1({
          packetId: "packet-claim-4",
          projectId: sc.projectId,
          goalId: P106_GOAL,
          taskId: P106_TASK_ID,
          planRef: sc.planRef,
          taskRevision: 1,
          runRef: runRefFor(sc.projectId, P106_GOAL, "run-a-4"),
          attemptRef: taskAttemptRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, "att-a-4"),
        });
        expect((await hh.recordHandoff(buildRecordHandoffCommand({ commandId: "cmd-rh-4", correlationId: "corr-rh-4", submittedAt: P106_SCHEMA, projectId: sc.projectId, packet }))).status).toBe("committed");
        const packetRef = handoffPacketRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, "packet-claim-4");
        const receipt = await hh.claimReplacement(
          buildClaimReplacementCommand({
            commandId: "cmd-claim-4",
            correlationId: "corr-claim-4",
            submittedAt: P106_SCHEMA,
            projectId: sc.projectId,
            goalId: P106_GOAL,
            taskId: P106_TASK_ID,
            expectedRevision: priorLease!.revision,
            attemptId: "att-b-4",
            runId: "run-b-4",
            handoffPacketRef: packetRef,
            reason: "run_crashed",
          }),
        );
        expect(receipt.status).toBe("committed");
        if (receipt.status !== "committed") return;
        const lease = await hh.ledger.load(taskLeaseRefFor(sc.projectId, P106_GOAL, P106_TASK_ID));
        expect(lease.status).toBe("found");
        if (lease.status === "found") {
          const snap = lease.snapshot as { holderRunId: string; attemptId: string; revision: number };
          expect(snap.holderRunId).toBe("run-b-4");
          expect(snap.attemptId).toBe("att-b-4");
          expect(snap.revision).toBe(priorLease!.revision + 1);
        }
        const bRun = await hh.ledger.load(runRefFor(sc.projectId, P106_GOAL, "run-b-4"));
        expect(bRun.status).toBe("found");
        const bAttempt = await hh.ledger.load(taskAttemptRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, "att-b-4"));
        expect(bAttempt.status).toBe("found");
        const replacement = await hh.ledger.load(replacementAttemptRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, "att-b-4"));
        expect(replacement.status).toBe("found");
        if (replacement.status === "found") {
          const snap = replacement.snapshot as { packetRef: { packetId: string }; priorRunRef: { runId: string | undefined; ref: { runId: string } } | { runId: string }; reason: string };
          expect(String(JSON.stringify(snap))).toContain("packet-claim-4");
          expect(String(JSON.stringify(snap))).toContain("run-a-4");
          expect(snap.reason).toBe("run_crashed");
        }
      });

      it("rejects lease_active: replacement while A is still running", async () => {
        const hh = await h();
        const sc = await prepareP106Scenario(hh);
        await runP106ClaimedRun(hh, { projectId: sc.projectId, taskId: P106_TASK_ID, runId: "run-a-5", attemptId: "att-a-5" });
        const packet = buildHandoffPacketV1({
          packetId: "packet-claim-5",
          projectId: sc.projectId,
          goalId: P106_GOAL,
          taskId: P106_TASK_ID,
          planRef: sc.planRef,
          taskRevision: 1,
          runRef: runRefFor(sc.projectId, P106_GOAL, "run-a-5"),
          attemptRef: taskAttemptRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, "att-a-5"),
        });
        const receipt = await hh.claimReplacement(
          buildClaimReplacementCommand({
            commandId: "cmd-claim-5",
            correlationId: "corr-claim-5",
            submittedAt: P106_SCHEMA,
            projectId: sc.projectId,
            goalId: P106_GOAL,
            taskId: P106_TASK_ID,
            expectedRevision: 1,
            attemptId: "att-b-5",
            runId: "run-b-5",
            handoffPacketRef: handoffPacketRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, "packet-claim-5"),
            reason: "run_crashed",
          }),
        );
        expect(receipt.status).toBe("rejected");
        if (receipt.status === "rejected") expect(receipt.code).toBe("lease_active");
      });

      it("rejects a competing CAS window (revision_conflict, zero-write)", async () => {
        const hh = await h();
        const sc = await prepareP106Scenario(hh);
        await endP106RunA(hh, { projectId: sc.projectId, taskId: P106_TASK_ID, runId: "run-a-6", attemptId: "att-a-6", script: "crashed" });
        const packet = buildHandoffPacketV1({
          packetId: "packet-claim-6",
          projectId: sc.projectId,
          goalId: P106_GOAL,
          taskId: P106_TASK_ID,
          planRef: sc.planRef,
          taskRevision: 1,
          runRef: runRefFor(sc.projectId, P106_GOAL, "run-a-6"),
          attemptRef: taskAttemptRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, "att-a-6"),
        });
        expect((await hh.recordHandoff(buildRecordHandoffCommand({ commandId: "cmd-rh-6", correlationId: "corr-rh-6", submittedAt: P106_SCHEMA, projectId: sc.projectId, packet }))).status).toBe("committed");
        const good = buildClaimReplacementCommand({
          commandId: "cmd-claim-6a",
          correlationId: "corr-claim-6a",
          submittedAt: P106_SCHEMA,
          projectId: sc.projectId,
          goalId: P106_GOAL,
          taskId: P106_TASK_ID,
          expectedRevision: 1,
          attemptId: "att-b-6a",
          runId: "run-b-6a",
          handoffPacketRef: handoffPacketRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, "packet-claim-6"),
          reason: "run_crashed",
        });
        // stale expectedRevision (wrong CAS window) -> revision_conflict, zero-write.
        const bad = await hh.claimReplacement({ ...good, expectedRevision: 99, commandId: "cmd-claim-6b", identity: { ...good.identity, idempotencyKey: "p1-06-claim-6b" }, payload: { ...good.payload, attemptId: "att-b-6b", runId: "run-b-6b" } });
        expect(bad.status).toBe("rejected");
        if (bad.status === "rejected") expect(bad.code).toBe("revision_conflict");
      });
    });

    // ------------------------------------------------------------------ //
    // 5. Late-result rejection (A's late facts never override B)            //
    // ------------------------------------------------------------------ //

    describe("late-result rejection", () => {
      it("A's late runtime fact after B's claim is rejected (after_terminal) and B is untouched", async () => {
        const hh = await h();
        const sc = await prepareP106Scenario(hh);
        await endP106RunA(hh, { projectId: sc.projectId, taskId: P106_TASK_ID, runId: "run-a-7", attemptId: "att-a-7", script: "crashed" });
        const packet = buildHandoffPacketV1({
          packetId: "packet-late-7",
          projectId: sc.projectId,
          goalId: P106_GOAL,
          taskId: P106_TASK_ID,
          planRef: sc.planRef,
          taskRevision: 1,
          runRef: runRefFor(sc.projectId, P106_GOAL, "run-a-7"),
          attemptRef: taskAttemptRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, "att-a-7"),
        });
        expect((await hh.recordHandoff(buildRecordHandoffCommand({ commandId: "cmd-rh-7", correlationId: "corr-rh-7", submittedAt: P106_SCHEMA, projectId: sc.projectId, packet }))).status).toBe("committed");
        expect(
          (await hh.claimReplacement(
            buildClaimReplacementCommand({
              commandId: "cmd-claim-7",
              correlationId: "corr-claim-7",
              submittedAt: P106_SCHEMA,
              projectId: sc.projectId,
              goalId: P106_GOAL,
              taskId: P106_TASK_ID,
              expectedRevision: 1,
              attemptId: "att-b-7",
              runId: "run-b-7",
              handoffPacketRef: handoffPacketRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, "packet-late-7"),
              reason: "run_crashed",
            }),
          )).status,
        ).toBe("committed");
        // A's late "completed" event targeting A's ENDED run (with A's CURRENT
        // run revision so the after_terminal guard — NOT the CAS window — decides).
        const aRunNow = await hh.ledger.load(runRefFor(sc.projectId, P106_GOAL, "run-a-7"));
        expect(aRunNow.status).toBe("found");
        const aRunRevision = aRunNow.status === "found" ? (aRunNow.snapshot as { revision: number }).revision : 99;
        const late = await hh.runFact(
          buildRunFactCommand({
            commandId: "cmd-late-7",
            correlationId: "corr-late-7",
            submittedAt: P106_SCHEMA,
            projectId: sc.projectId,
            runId: "run-a-7",
            expectedRevision: aRunRevision,
            fact: { kind: "runtime_event", event: { eventType: "run_completed", schemaVersion: 1 as const, eventId: "rt-late-7", runRef: runRefFor(sc.projectId, P106_GOAL, "run-a-7"), sequence: 3, occurredAt: P106_SCHEMA, payload: { kind: "completed", exitCode: 0 } } },
          }),
        );
        expect(late.status).toBe("rejected");
        if (late.status === "rejected") expect(late.code).toBe("after_terminal");
        // B's run is untouched: still at starting (claim only; no facts, NOT
        // advanced/regressed by A's late fact), lease held by B.
        const bRun = await hh.ledger.load(runRefFor(sc.projectId, P106_GOAL, "run-b-7"));
        expect(bRun.status).toBe("found");
        if (bRun.status === "found") {
          const snap = bRun.snapshot as { status: string; lastEventSeq: number };
          expect(snap.status).toBe("starting");
          expect(snap.lastEventSeq).toBe(0);
        }
        const lease = await hh.ledger.load(taskLeaseRefFor(sc.projectId, P106_GOAL, P106_TASK_ID));
        if (lease.status === "found") {
          expect((lease.snapshot as { holderRunId: string }).holderRunId).toBe("run-b-7");
        }
      });

      it("A's stale-sequence fact (duplicate) inside A's own run is still rejected", async () => {
        const hh = await h();
        const sc = await prepareP106Scenario(hh);
        await endP106RunA(hh, { projectId: sc.projectId, taskId: P106_TASK_ID, runId: "run-a-8", attemptId: "att-a-8", script: "completed" });
        const late = await hh.runFact(
          buildRunFactCommand({
            commandId: "cmd-late-8",
            correlationId: "corr-late-8",
            submittedAt: P106_SCHEMA,
            projectId: sc.projectId,
            runId: "run-a-8",
            expectedRevision: 99,
            fact: { kind: "runtime_event", event: { eventType: "run_started", schemaVersion: 1 as const, eventId: "rt-late-8", runRef: runRefFor(sc.projectId, P106_GOAL, "run-a-8"), sequence: 1, occurredAt: P106_SCHEMA, payload: { kind: "started", startedAt: P106_SCHEMA } } },
          }),
        );
        expect(late.status).toBe("rejected");
        // after_terminal OR stale_event both prove no regress; assert not committed.
        expect(late.status === "rejected").toBe(true);
      });
    });

    // ------------------------------------------------------------------ //
    // 6. HandoffContextPort — stale explicit + no transcript + body-first   //
    // ------------------------------------------------------------------ //

    describe("HandoffContextPort assembly", () => {
      it("explicit stale on source revision mismatch, then re-project -> ready (no silent old-use)", async () => {
        const hh = await h();
        const sc = await prepareP106Scenario(hh);
        await endP106RunA(hh, { projectId: sc.projectId, taskId: P106_TASK_ID, runId: "run-a-9", attemptId: "att-a-9", script: "crashed" });
        const packet = buildHandoffPacketV1({
          packetId: "packet-ctx-9",
          projectId: sc.projectId,
          goalId: P106_GOAL,
          taskId: P106_TASK_ID,
          planRef: sc.planRef,
          taskRevision: 1,
          runRef: runRefFor(sc.projectId, P106_GOAL, "run-a-9"),
          attemptRef: taskAttemptRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, "att-a-9"),
        });
        expect((await hh.recordHandoff(buildRecordHandoffCommand({ commandId: "cmd-rh-9", correlationId: "corr-rh-9", submittedAt: P106_SCHEMA, projectId: sc.projectId, packet }))).status).toBe("committed");
        expect(
          (await hh.claimReplacement(
            buildClaimReplacementCommand({
              commandId: "cmd-claim-9",
              correlationId: "corr-claim-9",
              submittedAt: P106_SCHEMA,
              projectId: sc.projectId,
              goalId: P106_GOAL,
              taskId: P106_TASK_ID,
              expectedRevision: 1,
              attemptId: "att-b-9",
              runId: "run-b-9",
              handoffPacketRef: handoffPacketRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, "packet-ctx-9"),
              reason: "run_crashed",
            }),
          )).status,
        ).toBe("committed");
        const packetRef = handoffPacketRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, "packet-ctx-9");
        // Stale: request declares an old source revision -> explicit stale, never a ready.
        const stale = await hh.assembleHandoff(
          p106RequestB({ projectId: sc.projectId, runId: "run-b-9", attemptId: "att-b-9", packetRef, workspaceRevision: 2 }),
        );
        expect(stale.status).toBe("rejected");
        if (stale.status === "rejected") expect(stale.code).toBe("stale_workspace_snapshot");
        // Re-project: fresh revision -> ready; bundle body-first; NO transcript.
        const ready = await hh.assembleHandoff(
          p106RequestB({ projectId: sc.projectId, runId: "run-b-9", attemptId: "att-b-9", packetRef, workspaceRevision: 1 }),
        );
        expect(ready.status).toBe("ready");
        if (ready.status !== "ready") return;
        expect(JSON.stringify(ready.manifest)).toContain('"noFullTranscript":true');
        expect(JSON.stringify(ready.envelope)).not.toContain("transcript");
        expect(JSON.stringify(ready.envelope)).not.toContain("chain-of-thought");
        const opened = await hh.vault.open(ready.bundleRef, { requesterRunRef: runRefFor(sc.projectId, P106_GOAL, "run-b-9") });
        expect(opened.status).toBe("ready");
        if (opened.status === "ready") {
          expect(opened.record.body).not.toContain("hidden chain");
          expect(opened.record.body).toContain(P106_TASK_ID);
        }
      });

      it("forbidden scope rejected; packet_not_found rejected", async () => {
        const hh = await h();
        const sc = await prepareP106Scenario(hh);
        await endP106RunA(hh, { projectId: sc.projectId, taskId: P106_TASK_ID, runId: "run-a-10", attemptId: "att-a-10", script: "crashed" });
        const packet = buildHandoffPacketV1({
          packetId: "packet-ctx-10",
          projectId: sc.projectId,
          goalId: P106_GOAL,
          taskId: P106_TASK_ID,
          planRef: sc.planRef,
          taskRevision: 1,
          runRef: runRefFor(sc.projectId, P106_GOAL, "run-a-10"),
          attemptRef: taskAttemptRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, "att-a-10"),
        });
        expect((await hh.recordHandoff(buildRecordHandoffCommand({ commandId: "cmd-rh-10", correlationId: "corr-rh-10", submittedAt: P106_SCHEMA, projectId: sc.projectId, packet }))).status).toBe("committed");
        const packetRef = handoffPacketRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, "packet-ctx-10");
        const forbidden = await hh.assembleHandoff(
          p106RequestB({ projectId: sc.projectId, runId: "run-b-10", attemptId: "att-b-10", packetRef, scope: { tools: ["read", "write", "root"], writeScope: ["/"] } }),
        );
        expect(forbidden.status).toBe("rejected");
        if (forbidden.status === "rejected") expect(forbidden.code).toBe("forbidden_tool_or_scope");
        const missing = await hh.assembleHandoff(
          p106RequestB({ projectId: sc.projectId, runId: "run-b-10", attemptId: "att-b-10", packetRef: handoffPacketRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, "packet-never") }),
        );
        expect(missing.status).toBe("rejected");
        if (missing.status === "rejected") expect(missing.code).toBe("packet_not_found");
      });
    });

    // ------------------------------------------------------------------ //
    // 7. Full recovery path (crash -> packet -> replacement -> B runs)      //
    // ------------------------------------------------------------------ //

    describe("run-crash recovery path", () => {
      it("A crash -> record -> B claim -> driveHandoff -> B facts -> provenance timeline", async () => {
        const hh = await h();
        const sc = await prepareP106Scenario(hh);
        await endP106RunA(hh, { projectId: sc.projectId, taskId: P106_TASK_ID, runId: "run-a-11", attemptId: "att-a-11", script: "crashed" });
        const packet = buildHandoffPacketV1({
          packetId: "packet-recover-11",
          projectId: sc.projectId,
          goalId: P106_GOAL,
          taskId: P106_TASK_ID,
          planRef: sc.planRef,
          taskRevision: 1,
          runRef: runRefFor(sc.projectId, P106_GOAL, "run-a-11"),
          attemptRef: taskAttemptRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, "att-a-11"),
        });
        expect((await hh.recordHandoff(buildRecordHandoffCommand({ commandId: "cmd-rh-11", correlationId: "corr-rh-11", submittedAt: P106_SCHEMA, projectId: sc.projectId, packet }))).status).toBe("committed");
        const packetRef = handoffPacketRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, "packet-recover-11");
        expect(
          (await hh.claimReplacement(
            buildClaimReplacementCommand({
              commandId: "cmd-claim-11",
              correlationId: "corr-claim-11",
              submittedAt: P106_SCHEMA,
              projectId: sc.projectId,
              goalId: P106_GOAL,
              taskId: P106_TASK_ID,
              expectedRevision: 1,
              attemptId: "att-b-11",
              runId: "run-b-11",
              handoffPacketRef: packetRef,
              reason: "run_crashed",
            }),
          )).status,
        ).toBe("committed");
        // The normal drive must SKIP the replacement intent; driveHandoff processes it.
        const normal = await hh.drive({ reason: "p1-06 normal drive" });
        expect(normal.scanned).toBe(0);
        const driven = await hh.handoffDrive.driveHandoff({ reason: "p1-06 handoff drive" });
        expect(driven.started).toBe(1);
        expect(driven.failures).toEqual([]);
        const bRun = await hh.ledger.load(runRefFor(sc.projectId, P106_GOAL, "run-b-11"));
        expect(bRun.status).toBe("found");
        if (bRun.status === "found") {
          const snap = bRun.snapshot as { status: string; outcome: string | null };
          expect(snap.status).toBe("ended");
          expect(snap.outcome).toBe("completed");
        }
        // Provenance timeline is display-only: packet + replacement (+ events).
        await hh.advanceProjection();
        const prov = await hh.handoffProvenance({ projectId: sc.projectId, goalId: P106_GOAL, taskId: P106_TASK_ID });
        expect(prov.status).toBe("ready");
        if (prov.status === "ready") {
          const kinds = prov.provenance.timeline.map((e) => e.kind);
          expect(kinds).toContain("packet_recorded");
          expect(kinds).toContain("replacement_claimed");
          expect(prov.provenance.outcomeUnknownPreserved).toBe(true);
        }
      });
    });

    // ------------------------------------------------------------------ //
    // 8. outcome_unknown preserved; no auto-retry                          //
    // ------------------------------------------------------------------ //

    describe("outcome_unknown preserved", () => {
      it("A outcome_unknown -> packet unresolved keeps it; view preserves; no extra replacement", async () => {
        const hh = await h();
        const sc = await prepareP106Scenario(hh);
        await runP106ClaimedRun(hh, { projectId: sc.projectId, taskId: P106_TASK_ID, runId: "run-a-12", attemptId: "att-a-12" });
        const unknown = await hh.runFact(
          buildRunFactCommand({
            commandId: "cmd-ou-12",
            correlationId: "corr-ou-12",
            submittedAt: P106_SCHEMA,
            projectId: sc.projectId,
            runId: "run-a-12",
            expectedRevision: 2,
            fact: { kind: "outcome_unknown", runRef: runRefFor(sc.projectId, P106_GOAL, "run-a-12"), reason: "signal lost" },
          }),
        );
        expect(unknown.status).toBe("committed");
        const packet = buildHandoffPacketV1({
          packetId: "packet-ou-12",
          projectId: sc.projectId,
          goalId: P106_GOAL,
          taskId: P106_TASK_ID,
          planRef: sc.planRef,
          taskRevision: 1,
          runRef: runRefFor(sc.projectId, P106_GOAL, "run-a-12"),
          attemptRef: taskAttemptRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, "att-a-12"),
          terminalOutcome: "outcome_unknown",
          unresolved: [{ kind: "outcome_unknown", summary: "A 的某些副作用未确认（保留；不自动重试不可逆动作）", artifactRef: null }],
        });
        expect((await hh.recordHandoff(buildRecordHandoffCommand({ commandId: "cmd-rh-12", correlationId: "corr-rh-12", submittedAt: P106_SCHEMA, projectId: sc.projectId, packet }))).status).toBe("committed");
        expect(
          (await hh.claimReplacement(
            buildClaimReplacementCommand({
              commandId: "cmd-claim-12",
              correlationId: "corr-claim-12",
              submittedAt: P106_SCHEMA,
              projectId: sc.projectId,
              goalId: P106_GOAL,
              taskId: P106_TASK_ID,
              expectedRevision: 1,
              attemptId: "att-b-12",
              runId: "run-b-12",
              handoffPacketRef: handoffPacketRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, "packet-ou-12"),
              reason: "outcome_unknown",
            }),
          )).status,
        ).toBe("committed");
        await hh.advanceProjection();
        const prov = await hh.handoffProvenance({ projectId: sc.projectId, goalId: P106_GOAL, taskId: P106_TASK_ID });
        expect(prov.status).toBe("ready");
        if (prov.status === "ready") {
          expect(prov.provenance.outcomeUnknownPreserved).toBe(true);
          // No auto-retry: the timeline records exactly ONE replacement.
          const replacements = prov.provenance.timeline.filter((e) => e.kind === "replacement_claimed");
          expect(replacements.length).toBe(1);
        }
      });
    });

    // ------------------------------------------------------------------ //
    // 9. verification-path traceability: A/B runs, same task revision       //
    // ------------------------------------------------------------------ //

    describe("verification-path traceability", () => {
      it("B's later evidence traces to A and B runs under the same plan revision", async () => {
        const hh = await h();
        const sc = await prepareP106Scenario(hh);
        await endP106RunA(hh, { projectId: sc.projectId, taskId: P106_TASK_ID, runId: "run-a-13", attemptId: "att-a-13", script: "crashed" });
        const aRun = runRefFor(sc.projectId, P106_GOAL, "run-a-13");
        const packet = buildHandoffPacketV1({
          packetId: "packet-trace-13",
          projectId: sc.projectId,
          goalId: P106_GOAL,
          taskId: P106_TASK_ID,
          planRef: sc.planRef,
          taskRevision: 1,
          runRef: aRun,
          attemptRef: taskAttemptRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, "att-a-13"),
        });
        expect((await hh.recordHandoff(buildRecordHandoffCommand({ commandId: "cmd-rh-13", correlationId: "corr-rh-13", submittedAt: P106_SCHEMA, projectId: sc.projectId, packet }))).status).toBe("committed");
        expect(
          (await hh.claimReplacement(
            buildClaimReplacementCommand({
              commandId: "cmd-claim-13",
              correlationId: "corr-claim-13",
              submittedAt: P106_SCHEMA,
              projectId: sc.projectId,
              goalId: P106_GOAL,
              taskId: P106_TASK_ID,
              expectedRevision: 1,
              attemptId: "att-b-13",
              runId: "run-b-13",
              handoffPacketRef: handoffPacketRefFor(sc.projectId, P106_GOAL, P106_TASK_ID, "packet-trace-13"),
              reason: "run_crashed",
            }),
          )).status,
        ).toBe("committed");
        const bRun = runRefFor(sc.projectId, P106_GOAL, "run-b-13");
        const anchor = buildEffectivityAnchorV1({
          planRef: sc.planRef,
          planRevision: 1,
          workspaceRevision: 1,
          pinnedCompletionPolicy: sc.pinnedCompletionPolicy!,
          pinnedArchitectureBaseline: sc.pinnedArchitectureBaseline!,
        });
        const VPLAN = { planId: "vp-handoff", planDigest: sha256Hex("vp-handoff-13") };
        const evidenceA = buildEvidenceV1({
          evidenceId: "ev-trace-a-13",
          kind: "observation",
          outcome: "PASS",
          projectId: sc.projectId,
          goalId: P106_GOAL,
          taskId: P106_TASK_ID,
          coverage: [{ obligationId: P106_OBL_HANDOFF, requirementId: P106_VR_STATIC }],
          runRef: aRun,
          checkId: "static-check-lint",
          anchor,
          verificationPlanRef: VPLAN,
        });
        const evidenceB = buildEvidenceV1({
          evidenceId: "ev-trace-b-13",
          kind: "observation",
          outcome: "PASS",
          projectId: sc.projectId,
          goalId: P106_GOAL,
          taskId: P106_TASK_ID,
          coverage: [{ obligationId: P106_OBL_HANDOFF, requirementId: P106_VR_DYNAMIC }],
          runRef: bRun,
          checkId: "dynamic-check-tests",
          anchor,
          verificationPlanRef: VPLAN,
        });
        // A and B evidence share the SAME anchor tuple (same task revision).
        expect((await hh.submitEvidence(buildSubmitEvidenceCommand({ commandId: "cmd-ev-a-13", evidence: evidenceA, correlationId: "corr-ev-a-13", submittedAt: P106_SCHEMA }))).status).toBe("committed");
        expect((await hh.submitEvidence(buildSubmitEvidenceCommand({ commandId: "cmd-ev-b-13", evidence: evidenceB, correlationId: "corr-ev-b-13", submittedAt: P106_SCHEMA }))).status).toBe("committed");
        await hh.advanceProjection();
        const verification = await hh.taskVerification({ projectId: sc.projectId, goalId: P106_GOAL, taskId: P106_TASK_ID });
        expect(verification.status).toBe("ready");
        if (verification.status === "ready") {
          const runs = verification.verification.evidence.map((e) => e.sourceRunRef?.runId);
          expect(runs).toContain("run-a-13");
          expect(runs).toContain("run-b-13");
          const anchors = verification.verification.evidence.map((e) => ({ planRevision: e.anchor.planRevision, planRef: JSON.stringify(e.anchor.planRef) }));
          expect(new Set(anchors.map((a) => JSON.stringify(a))).size).toBe(1);
        }
        const prov = await hh.handoffProvenance({ projectId: sc.projectId, goalId: P106_GOAL, taskId: P106_TASK_ID });
        if (prov.status === "ready") {
          const evEntries = prov.provenance.timeline.filter((e) => e.kind === "evidence_admitted");
          expect(evEntries.length).toBeGreaterThanOrEqual(2);
        }
      });
    });

    // ------------------------------------------------------------------ //
    // 10. HandoffControlPort (harness default adapter)                      //
    // ------------------------------------------------------------------ //

    describe("HandoffControlPort", () => {
      it("pause/stop states + public snapshot never expose hidden context", async () => {
        const hh = await h();
        const sc = await prepareP106Scenario(hh);
        await endP106RunA(hh, { projectId: sc.projectId, taskId: P106_TASK_ID, runId: "run-a-14", attemptId: "att-a-14", script: "crashed" });
        const bRun = runRefFor(sc.projectId, P106_GOAL, "run-b-14");
        // Contract-shape test uses the shared double (frozen semantics); the REAL
        // adapter's per-run behavior is covered by lane B's unit tests.
        const control = new FakeHandoffControlPort([{ runRef: bRun, lastEventSeq: 3 }]);
        const paused = await control.control({ schemaVersion: 1, kind: "pause", reason: "safe point", correlationId: "corr-ctrl-14", submittedAt: P106_SCHEMA });
        expect(paused.status).toBe("accepted");
        if (paused.status === "accepted") expect(paused.state.status).toBe("paused");
        const snapshot = await control.snapshot({ schemaVersion: 1, runRef: bRun });
        expect(snapshot.status).toBe("ready");
        if (snapshot.status === "ready") {
          expect(snapshot.report.noHiddenContextRead).toBe(true);
          expect(snapshot.state.noHiddenContextRead).toBe(true);
          expect(JSON.stringify(snapshot.report)).not.toContain("transcript");
        }
        const stopped = await control.control({ schemaVersion: 1, kind: "stop", reason: "handoff complete", correlationId: "corr-ctrl-14b", submittedAt: P106_SCHEMA });
        expect(stopped.status).toBe("accepted");
      });
    });
  });
}
