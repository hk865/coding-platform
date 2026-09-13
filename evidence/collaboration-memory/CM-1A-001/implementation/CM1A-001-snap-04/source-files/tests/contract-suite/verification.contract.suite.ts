import { compileVerificationPlan } from '../../src/control/verification-engine/verification-plan-compiler.js';
/**
 * P1-04 verification contract suite — plan compilation, VerificationEngine
 * behavior, Reviewer/ReviewContext bounds and the Task/Gate reducer table.
 * Shared by the InMemory AND SQLite adapters (same fixtures, no per-adapter
 * tuning).
 */
import { describe, expect, it } from "vitest";
import { REVIEWER_MAX_PACKET_BYTES, REVIEWER_SEMANTIC_CHECK_ID, NO_CHANGE_FAST_PATH_CHECK_ID } from "../../src/contracts/verification.js";
import type { VerificationPlanCompileInput } from '../../src/control/verification-engine/verification-plan-compiler.js';
import type { VerificationRequestV1 } from '../../src/contracts/verification.js';
import type { PlanRevisionSnapshot } from "../../src/contracts/plan.js";
import type { EvidenceV1 } from "../../src/contracts/evidence.js";
import { selectEffectiveEvidenceSet } from "../../src/control/control-engine/policies/evidence.js";
import { P104_OBL_GATE, P104_OBL_IMPLEMENT, P104_OBL_REVIEW, P104_TASK_DEFERRED, P104_TASK_GATE, P104_TASK_IMPLEMENT, P104_TASK_REVIEW } from "../contract-support/fixtures/evidence-fixtures.js";
import {
  FAKE_RUNTIME_SCRIPT_CRASHED_V1,
  buildDispatchStartCommand,
  buildManifestFixture,
  buildRunFactCommand,
  rebaseScriptForRun,
} from "../../src/fixtures/dispatch-fixtures.js";
import {
  anchorFor,
  evidenceCommandFor,
  evidenceFor,
  prepareP104Scenario,
  runP104ClaimedRun,
  reduceCommand,
  P104_GOAL,
  P104_PLAN_REF,
  P104_VPLAN,
  SCHEMA,
  type P1_04HarnessFactory,
} from "./p1-04-harness.js";
import { FAKE_REVIEWER_PORT } from "../../src/testing/check-providers.double.js";
import { runRefFor, taskAttemptRefFor } from "../../src/contracts/dispatch.js";
import { artifactBodyDigest } from "../../src/contracts/artifact.js";

const IMPLEMENT = P104_TASK_IMPLEMENT;
const REVIEW = P104_TASK_REVIEW;
const GATE = P104_TASK_GATE;

function covImplementStatic() {
  return [{ obligationId: P104_OBL_IMPLEMENT, requirementId: "vr-impl-static" }];
}

function compileInput(
  plan: PlanRevisionSnapshot,
  deps: Partial<VerificationPlanCompileInput> = {},
): VerificationPlanCompileInput {
  return {
    schemaVersion: 1,
    taskRef: { projectId: "proj-alpha", goalId: P104_GOAL, taskId: IMPLEMENT },
    planRef: plan.ref,
    planSnapshot: plan,
    workspaceRevision: 1,
    changeScope: { diffClass: "code-change", changedFiles: ["src/a.ts"], writeSummary: "change" },
    semanticChange: "semantic",
    risks: [{ level: "low", description: "local change" }],
    checkCapabilities: [
      { checkId: "static-check-lint", kind: "static" as const, coversKinds: ["static"], replayable: true },
      { checkId: "dynamic-check-tests", kind: "dynamic" as const, coversKinds: ["dynamic"], replayable: true },
    ],
    policy: { requirementKinds: ["static", "dynamic", "reviewer"] },
    ...deps,
  };
}

export function defineVerificationContractSuite(createHarness: P1_04HarnessFactory): void {
  describe("P1-04 verification contract suite", () => {
    async function setup(withFastPathBeta = false) {
      const h = await createHarness();
      const sc = await prepareP104Scenario(h, { withFastPathBeta });
      const planLoad = await h.ledger.load(P104_PLAN_REF);
      expect(planLoad.status).toBe("found");
      if (planLoad.status !== "found") throw new Error("plan missing");
      return { h, sc, plan: planLoad.snapshot as PlanRevisionSnapshot };
    }

    it("plan compilation is a deterministic pure function (content-addressed, no model/timestamp)", async () => {
      const { plan } = await setup();
      const input = compileInput(plan);
      const first = compileVerificationPlan(input);
      const second = compileVerificationPlan(input);
      expect(first.status).toBe("ready");
      if (first.status !== "ready" || second.status !== "ready") return;
      expect(second.plan.planId).toBe(first.plan.planId);
      expect(second.plan.planDigest).toBe(first.plan.planDigest);
      expect(first.plan.planId).toBe(first.plan.planDigest);
      const changed = compileVerificationPlan(compileInput(plan, {
        changeScope: { diffClass: "docs-only", changedFiles: ["docs/x.md"], writeSummary: "docs" },
      }));
      expect(changed.status).toBe("ready");
      if (changed.status === "ready") expect(changed.plan.planId).not.toBe(first.plan.planId);
    });

    it("deterministic failures: missing pin / unknown check / no check coverage — never a built-in default", async () => {
      const { plan } = await setup();
      const noPins: PlanRevisionSnapshot = {
        ...plan,
        effectiveCompletionPolicy: { ref: { aggregateType: "CompletionPolicyRevision", projectId: "", policyId: "", revision: 0 }, digest: "" },
        effectiveArchitectureBaseline: { ref: { aggregateType: "ArchitectureBaselineRevision", projectId: "", baselineId: "", revision: 0 }, digest: "" },
      };
      const r1 = compileVerificationPlan(compileInput(noPins));
      expect(r1.status).toBe("rejected");
      if (r1.status === "rejected") expect(r1.code).toBe("missing_pin");

      const r2 = compileVerificationPlan(compileInput(plan, {
        checkCapabilities: [{ checkId: "", kind: "static", coversKinds: ["static"], replayable: true }],
      }));
      expect(r2.status).toBe("rejected");
      if (r2.status === "rejected") expect(r2.code).toBe("unknown_check");

      const r3 = compileVerificationPlan(compileInput(plan, {
        checkCapabilities: [{ checkId: "static-check-lint", kind: "static", coversKinds: ["lint"], replayable: true }],
      }));
      expect(r3.status).toBe("rejected");
      if (r3.status === "rejected") expect(r3.code).toBe("no_check_coverage");

      const noTaskCompile = compileVerificationPlan(compileInput(plan, {
        taskRef: { projectId: "proj-alpha", goalId: P104_GOAL, taskId: "task-missing" },
      }));
      expect(noTaskCompile.status).toBe("rejected");
      if (noTaskCompile.status === "rejected") expect(noTaskCompile.code).toBe("invalid");
    });

    it("VerificationEngine.verify: ready plan + deterministic observation drafts; NEVER writes the ledger", async () => {
      const { h, sc } = await setup();
      const request: VerificationRequestV1 = {
        schemaVersion: 1,
        requestId: "req-verify-1",
        projectId: sc.alpha.projectId,
        goalId: sc.alpha.goalId,
        taskId: IMPLEMENT,
        planRef: sc.alpha.planRef,
        changeScope: { diffClass: "code-change", changedFiles: ["src/a.ts"], writeSummary: "change" },
        semanticChange: "semantic",
        risks: [{ level: "low" as const, description: "local" }],
      };
      const before = await h.ledger.events({ afterCursor: null, limit: 500 });
      const result = await h.verification.verify(request);
      expect(result.status).toBe("ready");
      if (result.status !== "ready") return;
      expect(result.plan.planId).toBe(result.plan.planDigest);
      expect(result.plan.checks.map((c) => c.kind).sort()).toEqual(["dynamic", "static"]);
      expect(result.observations.length).toBe(2);
      expect(result.observations.every((o) => o.result === "PASS")).toBe(true);
      expect(result.verificationPlanRef.planId).toBe(result.plan.planId);
      const after = await h.ledger.events({ afterCursor: null, limit: 500 });
      expect(after.events.length).toBe(before.events.length);
    });

    it("semantic change -> reviewer plan goes through a ReviewPacket (never a silent fast path)", async () => {
      const { h, sc } = await setup(true);
      const request: VerificationRequestV1 = {
        schemaVersion: 1,
        requestId: "req-verify-review",
        projectId: sc.alpha.projectId,
        goalId: sc.alpha.goalId,
        taskId: REVIEW,
        planRef: sc.alpha.planRef,
        changeScope: { diffClass: "docs-only", changedFiles: ["docs/x.md"], writeSummary: "docs" },
        semanticChange: "semantic",
        risks: [],
      };
      const result = await h.verification.verify(request);
      expect(result.status).toBe("ready");
      if (result.status !== "ready") return;
      const reviewer = result.plan.checks.find((c) => c.kind === "reviewer");
      expect(reviewer).toBeDefined();
      expect(reviewer!.checkId).toBe(REVIEWER_SEMANTIC_CHECK_ID);
      expect(reviewer!.satisfactionPath).toBe("review-packet");

      // Pure compile table: no-change + policy WITH exemption -> fast-path;
      // no-change + policy WITHOUT exemption -> still review-packet.
      const planLoad = await h.ledger.load(sc.alpha.planRef);
      if (planLoad.status !== "found") throw new Error("plan missing");
      const plan = planLoad.snapshot as PlanRevisionSnapshot;
      const base: VerificationPlanCompileInput = {
        schemaVersion: 1 as const,
        taskRef: { projectId: sc.alpha.projectId, goalId: sc.alpha.goalId, taskId: REVIEW },
        planRef: sc.alpha.planRef,
        planSnapshot: plan,
        workspaceRevision: 1,
        changeScope: { diffClass: "docs-only", changedFiles: ["docs/x.md"], writeSummary: "docs" },
        semanticChange: "none" as const,
        risks: [],
        checkCapabilities: [
          { checkId: "static-check-lint", kind: "static" as const, coversKinds: ["static"], replayable: true },
          { checkId: "dynamic-check-tests", kind: "dynamic" as const, coversKinds: ["dynamic"], replayable: true },
        ],
        policy: { requirementKinds: ["static", "dynamic", "reviewer"] },
      };
      const noPolicy = compileVerificationPlan(base);
      expect(noPolicy.status).toBe("ready");
      if (noPolicy.status === "ready") {
        const rw = noPolicy.plan.checks.find((c) => c.kind === "reviewer")!;
        expect(rw.satisfactionPath).toBe("review-packet");
      }
      const withPolicy = compileVerificationPlan({ ...base, policy: { requirementKinds: ["static", "dynamic", "reviewer"], fastPathDiffClasses: ["docs-only"] } });
      expect(withPolicy.status).toBe("ready");
      if (withPolicy.status === "ready") {
        const rw = withPolicy.plan.checks.find((c) => c.kind === "reviewer")!;
        expect(rw.checkId).toBe(NO_CHANGE_FAST_PATH_CHECK_ID);
        expect(rw.satisfactionPath).toBe("no-change-fast-path");
        expect(rw.noChangeFastPath!.diffClass).toBe("docs-only");
      }
      // semantic + docs-only + exemption: STILL review-packet (diff class is not a semantic exemption).
      const semanticWithPolicy = compileVerificationPlan({ ...base, semanticChange: "semantic", policy: { requirementKinds: ["static", "dynamic", "reviewer"], fastPathDiffClasses: ["docs-only"] } });
      expect(semanticWithPolicy.status).toBe("ready");
      if (semanticWithPolicy.status === "ready") {
        const rw = semanticWithPolicy.plan.checks.find((c) => c.kind === "reviewer")!;
        expect(rw.satisfactionPath).toBe("review-packet");
      }
    });

    it("ReviewerPort double declares the bounded dispatch-run shape (no transcript)", async () => {
      const caps = await FAKE_REVIEWER_PORT.capabilities();
      expect(caps.mode).toBe("dispatch-run");
      expect(caps.noFullTranscript).toBe(true);
      expect(caps.maxPacketBytes).toBe(REVIEWER_MAX_PACKET_BYTES);
    });

    it("gate reduces to SATISFIED only with its static gate evidence; deferred never satisfies", async () => {
      const { h, sc } = await setup();
      // Deferred task: never satisfied (disposition never active); never claimable (frozen eligibility).
      const r0 = await h.reduceTask(reduceCommand(sc.alpha, { commandId: "cmd-red-def", taskId: P104_TASK_DEFERRED, expectedRevision: 0 }));
      expect(r0.status).toBe("committed");
      if (r0.status !== "committed") return;
      expect(r0.phase).toBe("verifying");

      // Gate: no run; system static observation with runRef null.
      const gateObs = evidenceFor(sc.alpha, {
        evidenceId: "ev-gate-1", kind: "observation", outcome: "PASS",
        taskId: GATE, coverage: [{ obligationId: P104_OBL_GATE, requirementId: "vr-gate" }],
        checkId: "static-check-lint", runRef: null, actor: { kind: "system", id: "verification-engine" },
      });
      const admit = await h.submitEvidence(evidenceCommandFor(sc.alpha, { commandId: "cmd-gate-1", evidence: gateObs }));
      expect(admit.status).toBe("committed");
      const r1 = await h.reduceTask(reduceCommand(sc.alpha, { commandId: "cmd-red-gate", taskId: GATE, expectedRevision: 0 }));
      expect(r1.status).toBe("committed");
      if (r1.status !== "committed") return;
      expect(r1.phase).toBe("satisfied");
    });

    it("reducer table: crashed run -> failed; outcome_unknown side effect -> never satisfied; FAIL/INCONCLUSIVE table", async () => {
      const { h, sc } = await setup();
      // Crashed run for implement.
      const claim = await h.claimTask({
        commandId: "cmd-crash-claim", commandType: "DispatchClaimTask", schemaVersion: 1,
        identity: { projectId: sc.alpha.projectId, actor: { kind: "human", id: "user-1" }, idempotencyKey: "p104-crash-claim" },
        aggregateId: IMPLEMENT, expectedRevision: 0, correlationId: "corr-crash-claim", submittedAt: SCHEMA,
        payload: {
          goalId: sc.alpha.goalId, attemptId: "att-crash", runId: "run-crash-1",
          roleBinding: { schemaVersion: 1, bindingId: "b", templateId: "t", templateRevision: "r", bindingVersion: 1, policyRevision: "p" },
          declaredPermissions: { tools: ["read", "write"], writeScope: ["src"] },
          budget: { tokenBudget: 100_000, deadline: "2026-09-06T00:00:00.000Z" },
        },
      });
      expect(claim.status).toBe("committed");
      if (claim.status !== "committed") return;
      const bundleRef = {
        kind: "artifact" as const, contentType: "text/plain",
        digest: artifactBodyDigest("crash-bundle"), sizeBytes: artifactBodyDigest("crash-bundle").length,
        source: { kind: "plan-revision" as const, refId: sc.alpha.planRef.planId, revision: "1" },
      };
      const envelope = {
        schemaVersion: 1 as const, envelopeId: "env-crash", projectId: sc.alpha.projectId, workspaceId: "ws-shared",
        goalId: sc.alpha.goalId, taskId: IMPLEMENT,
        runRef: runRefFor(sc.alpha.projectId, sc.alpha.goalId, "run-crash-1"),
        attemptRef: taskAttemptRefFor(sc.alpha.projectId, sc.alpha.goalId, IMPLEMENT, "att-crash"),
        planRef: sc.alpha.planRef,
        roleBinding: { schemaVersion: 1 as const, bindingId: "b", templateId: "t", templateRevision: "r", bindingVersion: 1, policyRevision: "p" },
        workspaceSnapshot: { workspaceId: "ws-shared", revision: 1 },
        permissions: { policyRevision: "p", tools: ["read", "write"], writeScope: ["src"] },
        budget: { tokenBudget: 100_000, deadline: "2026-09-06T00:00:00.000Z" },
        sourceRefs: [{ kind: "plan-revision" as const, refId: sc.alpha.planRef.planId, revision: "1" }],
        bundleRef,
      };
      const start = await h.startRun(
        buildDispatchStartCommand({
          commandId: "cmd-crash-start", correlationId: "corr-crash-start", submittedAt: SCHEMA,
          projectId: sc.alpha.projectId, runId: "run-crash-1", expectedRevision: 1,
          envelope,
          manifest: buildManifestFixture({ workspaceId: "ws-shared", workspaceRevision: 1, planRef: sc.alpha.planRef }),
        }),
      );
      expect(start.status).toBe("committed");
      if (start.status !== "committed") return;
      const crashEvents = rebaseScriptForRun(FAKE_RUNTIME_SCRIPT_CRASHED_V1, runRefFor(sc.alpha.projectId, sc.alpha.goalId, "run-crash-1"));
      for (const [i, event] of crashEvents.entries()) {
        const fact = await h.runFact(buildRunFactCommand({
          commandId: "cmd-crash-fact-" + i, correlationId: "corr-crash-" + i, submittedAt: SCHEMA,
          projectId: sc.alpha.projectId, runId: "run-crash-1", expectedRevision: 2 + i,
          fact: { kind: "runtime_event", event },
        }));
        expect(fact.status).toBe("committed");
      }
      const crashed = await h.reduceTask(reduceCommand(sc.alpha, { commandId: "cmd-red-crash", taskId: IMPLEMENT, expectedRevision: 0 }));
      expect(crashed.status).toBe("committed");
      if (crashed.status !== "committed") return;
      expect(crashed.phase).toBe("failed");

      // outcome_unknown side effect never satisfies even with complete evidence.
      // The review run is claimed + started WITHOUT the completed script (no terminal fact).
      const rvClaim = await h.claimTask({
        commandId: "cmd-unknown-claim", commandType: "DispatchClaimTask", schemaVersion: 1,
        identity: { projectId: sc.alpha.projectId, actor: { kind: "human", id: "user-1" }, idempotencyKey: "p104-unknown-claim" },
        aggregateId: REVIEW, expectedRevision: 0, correlationId: "corr-unknown-claim", submittedAt: SCHEMA,
        payload: {
          goalId: sc.alpha.goalId, attemptId: "att-unknown-1", runId: "run-unknown-1",
          roleBinding: { schemaVersion: 1, bindingId: "b", templateId: "t", templateRevision: "r", bindingVersion: 1, policyRevision: "p" },
          declaredPermissions: { tools: ["read", "write"], writeScope: ["src"] },
          budget: { tokenBudget: 100_000, deadline: "2026-09-06T00:00:00.000Z" },
        },
      });
      expect(rvClaim.status).toBe("committed");
      if (rvClaim.status !== "committed") return;
      const rvBundle = {
        kind: "artifact" as const, contentType: "text/plain",
        digest: artifactBodyDigest("unknown-bundle"), sizeBytes: artifactBodyDigest("unknown-bundle").length,
        source: { kind: "plan-revision" as const, refId: sc.alpha.planRef.planId, revision: "1" },
      };
      const rvEnvelope = {
        schemaVersion: 1 as const, envelopeId: "env-unknown", projectId: sc.alpha.projectId, workspaceId: "ws-shared",
        goalId: sc.alpha.goalId, taskId: REVIEW,
        runRef: runRefFor(sc.alpha.projectId, sc.alpha.goalId, "run-unknown-1"),
        attemptRef: taskAttemptRefFor(sc.alpha.projectId, sc.alpha.goalId, REVIEW, "att-unknown-1"),
        planRef: sc.alpha.planRef,
        roleBinding: { schemaVersion: 1 as const, bindingId: "b", templateId: "t", templateRevision: "r", bindingVersion: 1, policyRevision: "p" },
        workspaceSnapshot: { workspaceId: "ws-shared", revision: 1 },
        permissions: { policyRevision: "p", tools: ["read", "write"], writeScope: ["src"] },
        budget: { tokenBudget: 100_000, deadline: "2026-09-06T00:00:00.000Z" },
        sourceRefs: [{ kind: "plan-revision" as const, refId: sc.alpha.planRef.planId, revision: "1" }],
        bundleRef: rvBundle,
      };
      const rvStart = await h.startRun(buildDispatchStartCommand({
        commandId: "cmd-unknown-start", correlationId: "corr-unknown-start", submittedAt: SCHEMA,
        projectId: sc.alpha.projectId, runId: "run-unknown-1", expectedRevision: 1,
        idempotencyKey: "p104-unknown-start",
        envelope: rvEnvelope,
        manifest: buildManifestFixture({ workspaceId: "ws-shared", workspaceRevision: 1, planRef: sc.alpha.planRef }),
      }));
      expect(rvStart.status).toBe("committed");
      if (rvStart.status !== "committed") return;
      const unknownFact = await h.runFact(buildRunFactCommand({
        commandId: "cmd-unknown", correlationId: "corr-unknown", submittedAt: SCHEMA,
        projectId: sc.alpha.projectId, runId: "run-unknown-1", expectedRevision: 2,
        fact: { kind: "outcome_unknown", runRef: runRefFor(sc.alpha.projectId, sc.alpha.goalId, "run-unknown-1"), reason: "disconnected" },
      }));
      expect(unknownFact.status).toBe("committed");
      const verdict = evidenceFor(sc.alpha, {
        evidenceId: "ev-unknown-verdict", kind: "verdict", outcome: "PASS",
        taskId: REVIEW, coverage: [{ obligationId: P104_OBL_REVIEW, requirementId: "vr-review" }], checkId: "reviewer-semantic-check",
        runRef: runRefFor(sc.alpha.projectId, sc.alpha.goalId, "run-unknown-1"),
      });
      expect((await h.submitEvidence(evidenceCommandFor(sc.alpha, { commandId: "cmd-unknown-verdict", evidence: verdict }))).status).toBe("committed");
      const pkt = evidenceFor(sc.alpha, {
        evidenceId: "ev-unknown-static", kind: "observation", outcome: "PASS",
        taskId: REVIEW, coverage: [{ obligationId: P104_OBL_REVIEW, requirementId: "vr-review-static" }], checkId: "static-check-lint",
      });
      expect((await h.submitEvidence(evidenceCommandFor(sc.alpha, { commandId: "cmd-unknown-static", evidence: pkt }))).status).toBe("committed");
      const rUnknown = await h.reduceTask(reduceCommand(sc.alpha, { commandId: "cmd-red-unknown", taskId: REVIEW, expectedRevision: 0 }));
      expect(rUnknown.status).toBe("committed");
      if (rUnknown.status !== "committed") return;
      expect(rUnknown.phase).not.toBe("satisfied");
    });

    it("pure effective-set table: INCONCLUSIVE verdict blocks; superseded by later PASS", async () => {
      const { plan } = await setup();
      const current = anchorFor({ projectId: "proj-alpha", goalId: P104_GOAL, planRef: P104_PLAN_REF, completionPolicyPin: plan.effectiveCompletionPolicy, architectureBaselinePin: plan.effectiveArchitectureBaseline, fastPath: false }, 1);
      const inconclusive: EvidenceV1 = {
        schemaVersion: 1, evidenceId: "ev-table-inconc", kind: "verdict", outcome: "INCONCLUSIVE",
        source: { actor: { kind: "system", id: "reviewer" }, runRef: runRefFor("proj-alpha", P104_GOAL, "run-t"), checkId: "reviewer-semantic-check" },
        subject: { projectId: "proj-alpha", goalId: P104_GOAL, taskId: IMPLEMENT },
        coverage: covImplementStatic(),
        anchor: current,
        verificationPlanRef: { ...P104_VPLAN },
        summary: { text: "inconclusive", artifactRef: null },
      };
      const pass: EvidenceV1 = {
        ...inconclusive, evidenceId: "ev-table-pass2", kind: "observation", outcome: "PASS",
        source: { actor: { kind: "human", id: "user-1" }, runRef: null, checkId: "static-check-lint" },
      };
      const blocked = selectEffectiveEvidenceSet([inconclusive], plan, current);
      expect(blocked.blockingByRequirement[P104_OBL_IMPLEMENT + "\u0000vr-impl-static"]).toEqual(["ev-table-inconc"]);
      const superseded = selectEffectiveEvidenceSet([inconclusive, pass], plan, current);
      expect(superseded.coverageByRequirement[P104_OBL_IMPLEMENT + "\u0000vr-impl-static"]).toBe("ev-table-pass2");
      expect(superseded.blockingByRequirement[P104_OBL_IMPLEMENT + "\u0000vr-impl-static"]).toBeUndefined();
    });
  });
}

// ------------------------------------------------------------------------ //
// ReviewContext assemble — bounded ReviewPacket (dual-adapter parity)        //
// ------------------------------------------------------------------------ //

export function defineReviewContextSuite(createHarness: P1_04HarnessFactory): void {
  describe("P1-04 ReviewContext assemble suite", () => {
    async function setup() {
      const h = await createHarness();
      const sc = await prepareP104Scenario(h);
      const run = await runP104ClaimedRun(h, {
        projectId: sc.alpha.projectId, taskId: REVIEW, runId: "run-pkt", attemptId: "att-pkt",
      });
      return { h, sc, run };
    }

    function reviewRequest(sc: Awaited<ReturnType<typeof prepareP104Scenario>>["alpha"], run: Awaited<ReturnType<typeof runP104ClaimedRun>>, partial: Partial<import("../../src/contracts/review-context.js").ReviewContextRequestV1> = {}) {
      return {
        schemaVersion: 1 as const,
        requestId: "req-pkt-1",
        projectId: sc.projectId,
        workspaceId: "ws-shared",
        goalId: sc.goalId,
        taskId: REVIEW,
        planRef: sc.planRef,
        runRef: run.runRef,
        attemptRef: { aggregateType: "TaskAttempt" as const, projectId: sc.projectId, goalId: sc.goalId, taskId: REVIEW, attemptId: "att-pkt" },
        roleBinding: {
          schemaVersion: 1 as const, bindingId: "binding-review-v1", templateId: "template-reviewer",
          templateRevision: "2026-09-05", bindingVersion: 1, policyRevision: "auth-policy-runtime-v1",
        },
        declaredPermissions: { tools: ["read", "write"], writeScope: ["src/contracts"] },
        scope: { tools: ["read"], writeScope: ["src/contracts"] },
        workspaceSnapshot: { workspaceId: "ws-shared", revision: 1 },
        changeScope: { diffClass: "code-change", changedFiles: ["src/a.ts"], writeSummary: "change" },
        semanticChange: "semantic" as const,
        risks: [{ level: "low" as const, description: "local" }],
        contractPoints: [{ refId: "contract-1", point: "语义变化与义务覆盖一致性" }],
        budget: { tokenBudget: 10_000, deadline: "2026-09-06T00:00:00.000Z" },
        submittedAt: SCHEMA,
        ...partial,
      };
    }

    it("assemble: bounded ReviewPacket, body-first in the vault, no transcript", async () => {
      const { h, sc, run } = await setup();
      const before = await h.ledger.events({ afterCursor: null, limit: 500 });
      const result = await h.assembleReview(reviewRequest(sc.alpha, run));
      expect(result.status).toBe("ready");
      if (result.status !== "ready") return;
      expect(result.packet.total.noFullTranscript).toBe(true);
      expect(result.packet.total.materialCount).toBeGreaterThanOrEqual(1);
      expect(result.packet.total.materialCount).toBeLessThanOrEqual(8);
      expect(result.packet.rubric.obligations.length).toBeGreaterThanOrEqual(1);
      expect(result.bundleRef.digest.length).toBe(64);
      expect(result.manifest.selectedRefs.length).toBeGreaterThanOrEqual(1);
      // Body-first: the bundle is readable by the owning review run.
      const opened = await (h as unknown as { vault: { open: (ref: import("../../src/contracts/artifact.js").ArtifactRef, q: import("../../src/contracts/artifact.js").ArtifactOpenQuery) => Promise<import("../../src/contracts/artifact.js").ArtifactOpenResult> } }).vault.open(result.bundleRef, { requesterRunRef: run.runRef });
      expect(opened.status).toBe("ready");
      if (opened.status === "ready") {
        const body = JSON.parse(opened.record.body) as { packetId: string };
        expect(body.packetId).toBe(result.packet.packetId);
      }
    });

    it("rejections are zero-write: forbidden scope / stale workspace / not-semantic / exhausted budget", async () => {
      const { h, sc, run } = await setup();
      const before = await h.ledger.events({ afterCursor: null, limit: 500 });
      const cases = [
        [{ scope: { tools: ["pwn"], writeScope: [] } }, "forbidden_tool_or_scope" as const],
        [{ workspaceSnapshot: { workspaceId: "ws-shared", revision: 2 } }, "stale_workspace_snapshot" as const],
        [{ semanticChange: "none" as const }, "not_semantic_change" as const],
        [{ budget: { tokenBudget: 10_000, deadline: "2020-01-01T00:00:00.000Z" } }, "budget_exhausted" as const],
      ];
      for (const [partial, code] of cases) {
        const result = await h.assembleReview(reviewRequest(sc.alpha, run, partial as never));
        expect(result.status, "expected rejection " + code).toBe("rejected");
        if (result.status === "rejected") {
          expect(result.code).toBe(code);
        }
      }
      const after = await h.ledger.events({ afterCursor: null, limit: 500 });
      expect(after.events.length).toBe(before.events.length);
    });
  });
}
