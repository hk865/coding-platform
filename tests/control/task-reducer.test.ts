/**
 * P1-04 lane A unit tests: reduceTask (Task/Gate reduction via ControlEngineImpl
 * over a real InMemoryLedger).
 *
 * Drive the ENGINE handler and assert the reduction phase table (the PURE
 * reduceTaskVerification is already covered by the contract suite; here we
 * assert the Control path loads canonical state and folds/commits correctly):
 *   - only run exit=0 -> blocked (a neutral signal never satisfies);
 *   - a CompletionClaim is neutral -> still blocked;
 *   - FAIL -> failed (rework); FAIL superseded by a later PASS -> satisfied and
 *     the old FAIL Evidence aggregate stays auditable;
 *   - missing required input -> blocked;
 *   - stale evidence (extra) -> satisfied but the reduction snapshot records the
 *     stale evidenceId + the canonical currentAnchor (assert via
 *     ledger.load(TaskReduction), NOT the lane-D view);
 *   - outcome_unknown side effect -> never satisfied;
 *   - crashed run -> failed;
 *   - deferred disposition -> verifying (never satisfied).
 */
import { describe, expect, it } from "vitest";
import { createControlEngine } from "../../src/control/control-engine.js";
import { InMemoryLedger } from "../../src/ledger/in-memory-ledger.js";
import type { StateLedger, LedgerCommit, LedgerCommitReceipt, GoalSnapshot } from "../../src/contracts/ledger.js";
import { createDeterministicDeps, FIXED_ISO_2026_09_05 } from "../../src/contracts/testing/sequences.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1, buildBootstrapLedgerCommit } from "../../src/contracts/fixtures/bootstrap-fixture-v1.js";
import { MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1, buildCreateGoalCommand, buildGoalCreateLedgerCommit } from "../../src/contracts/fixtures/goal-fixtures.js";
import { ARCHITECTURE_BASELINE_FIXTURE_V1, COMPLETION_POLICY_FIXTURE_V1, buildActivateCommand, buildActivateLedgerCommit, buildInstallCommand, buildInstallLedgerCommit, completionPolicyPinFor, architectureBaselinePinFor } from "../../src/contracts/fixtures/governance-fixtures.js";
import { buildApplyPlanCommand, buildPlanLedgerCommit } from "../../src/contracts/fixtures/plan-fixtures.js";
import { P104_GOAL, P104_OBL_GATE, P104_OBL_IMPLEMENT, P104_OBL_REVIEW, P104_PLAN_REVISION_FIXTURE_V1, P104_TASK_DEFERRED, P104_TASK_GATE, P104_TASK_IMPLEMENT, P104_TASK_REVIEW, buildEffectivityAnchorV1, buildEvidenceV1, buildSubmitEvidenceCommand, buildReduceTaskCommand, buildTaskReductionSnapshot, buildTaskReductionLedgerCommit, coverage } from "../../src/contracts/fixtures/evidence-fixtures.js";
import { FAKE_RUNTIME_SCRIPT_COMPLETED_V1, FAKE_RUNTIME_SCRIPT_CRASHED_V1, buildDispatchClaimCommand, buildDispatchStartCommand, buildManifestFixture, buildRunFactCommand, rebaseScriptForRun } from "../../src/contracts/fixtures/dispatch-fixtures.js";
import { artifactBodyDigest } from "../../src/contracts/artifact.js";
import { runRefFor, taskAttemptRefFor } from "../../src/contracts/dispatch.js";
import type { PlanRevisionSnapshot } from "../../src/contracts/plan.js";
import type { EvidenceV1 } from "../../src/contracts/evidence.js";
import { evidenceRefFor, taskEvidenceIndexRefFor } from "../../src/contracts/evidence.js";
import { taskReductionRefFor } from "../../src/contracts/reduction.js";
import { reduceTaskVerification, type TaskReductionInput, type TaskReductionSnapshot } from "../../src/contracts/reduction.js";
import { buildCurrentEffectivityAnchor } from "../../src/control/task-reducer.js";

const FIXED = FIXED_ISO_2026_09_05;
const PROJECT = "proj-alpha";
const GOAL = P104_GOAL;
const WS = "ws-shared";
const IMPLEMENT = P104_TASK_IMPLEMENT;
const REVIEW = P104_TASK_REVIEW;
const GATE = P104_TASK_GATE;
const DEFERRED = P104_TASK_DEFERRED;
const PLAN_ID = "plan-evidence-mvp";

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

async function bootstrap(ledger: StateLedger): Promise<void> {
  const cmd = buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
    commandId: "cmd-bootstrap", correlationId: "corr-bootstrap", submittedAt: FIXED,
  });
  const receipt = await ledger.commit(
    buildBootstrapLedgerCommit(cmd, { eventIds: ["evt-bs-1", "evt-bs-2", "evt-bs-3", "evt-bs-4"], occurredAt: FIXED }),
  );
  expect(receipt.status).toBe("committed");
}

async function createGoal(ledger: StateLedger): Promise<void> {
  const scope = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes.find((s) => s.projectId === PROJECT)!;
  const cmd = buildCreateGoalCommand(scope, { commandId: "cmd-goal", correlationId: "corr-goal", submittedAt: FIXED });
  const receipt = await ledger.commit(
    buildGoalCreateLedgerCommit(cmd, { eventId: "evt-goal", occurredAt: FIXED, projectRevision: 1, workspaceRevision: 1 }),
  );
  expect(receipt.status).toBe("committed");
}

async function installActivateAndPlan(ledger: StateLedger): Promise<void> {
  const cp = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, {
    commandId: "cmd-install-cp", correlationId: "corr-install-cp", submittedAt: FIXED,
    projectId: PROJECT, idempotencyKey: "inst-cp",
  });
  expect((await ledger.commit(buildInstallLedgerCommit(cp as never, { eventId: "evt-install-cp", occurredAt: FIXED }))).status).toBe("committed");
  const ab = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, {
    commandId: "cmd-install-ab", correlationId: "corr-install-ab", submittedAt: FIXED,
    projectId: PROJECT, idempotencyKey: "inst-ab",
  });
  expect((await ledger.commit(buildInstallLedgerCommit(ab as never, { eventId: "evt-install-ab", occurredAt: FIXED }))).status).toBe("committed");
  expect((await ledger.commit(buildActivateLedgerCommit(
    buildActivateCommand(completionPolicyPinFor(cp as never), {
      commandId: "cmd-act-cp", correlationId: "corr-act-cp", submittedAt: FIXED,
      projectId: PROJECT, expectedRevision: 1, idempotencyKey: "act-cp",
    }),
    { eventId: "evt-act-cp", occurredAt: FIXED, activeAggregateRevision: 1, projectRevision: 1 },
  ))).status).toBe("committed");
  expect((await ledger.commit(buildActivateLedgerCommit(
    buildActivateCommand(architectureBaselinePinFor(ab as never), {
      commandId: "cmd-act-ab", correlationId: "corr-act-ab", submittedAt: FIXED,
      projectId: PROJECT, expectedRevision: 1, idempotencyKey: "act-ab",
    }),
    { eventId: "evt-act-ab", occurredAt: FIXED, activeAggregateRevision: 1, projectRevision: 1 },
  ))).status).toBe("committed");
  const apply = buildApplyPlanCommand(P104_PLAN_REVISION_FIXTURE_V1, {
    commandId: "cmd-apply", correlationId: "corr-apply", submittedAt: FIXED,
    projectId: PROJECT, expectedRevision: 1, idempotencyKey: "apply",
  });
  const goal = await ledger.load({ aggregateType: "Goal", projectId: PROJECT, goalId: GOAL });
  expect(goal.status).toBe("found");
  const goalSnap = goal.status === "found" ? (goal.snapshot as GoalSnapshot) : null;
  expect((await ledger.commit(buildPlanLedgerCommit(apply, {
    eventId: "evt-apply", occurredAt: FIXED, acceptedAt: FIXED,
    pins: { completionPolicy: completionPolicyPinFor(cp as never), architectureBaseline: architectureBaselinePinFor(ab as never) },
    baseGoal: goalSnap!,
  }))).status).toBe("committed");
}

async function loadPlan(ledger: StateLedger): Promise<PlanRevisionSnapshot> {
  const planRef = { aggregateType: "PlanRevision" as const, projectId: PROJECT, planId: PLAN_ID };
  const result = await ledger.load(planRef);
  expect(result.status).toBe("found");
  if (result.status !== "found") throw new Error("plan missing");
  return result.snapshot as PlanRevisionSnapshot;
}

async function setupAccepted() {
  const { ledger, engine } = makeHarness();
  await bootstrap(ledger);
  await createGoal(ledger);
  await installActivateAndPlan(ledger);
  const plan = await loadPlan(ledger);
  return { ledger, engine, plan };
}

function anchorForPlan(plan: PlanRevisionSnapshot, workspaceRevision = 1) {
  return buildEffectivityAnchorV1({
    planRef: plan.ref,
    planRevision: plan.planRevision,
    workspaceRevision,
    pinnedCompletionPolicy: plan.effectiveCompletionPolicy,
    pinnedArchitectureBaseline: plan.effectiveArchitectureBaseline,
  });
}

function makeEvidence(plan: PlanRevisionSnapshot, deps: {
  evidenceId: string; kind: "claim" | "observation" | "verdict"; outcome: "PASS" | "FAIL" | "INCONCLUSIVE";
  taskId: string; coverage?: { obligationId: string; requirementId: string }[]; runRef?: { aggregateType: "Run"; projectId: string; goalId: string; runId: string } | null;
  checkId?: string | null; actor?: { kind: "human" | "system"; id: string }; workspaceRevision?: number;
}): EvidenceV1 {
  return buildEvidenceV1({
    evidenceId: deps.evidenceId,
    kind: deps.kind,
    outcome: deps.outcome,
    projectId: PROJECT,
    goalId: GOAL,
    taskId: deps.taskId,
    coverage: deps.coverage ?? [coverage(P104_OBL_IMPLEMENT, "vr-impl-static")],
    anchor: anchorForPlan(plan, deps.workspaceRevision ?? 1),
    verificationPlanRef: { planId: "vp-evidence-mvp-1", planDigest: "e".repeat(64) },
    ...(deps.runRef !== undefined ? { runRef: deps.runRef } : {}),
    ...(deps.checkId !== undefined ? { checkId: deps.checkId } : {}),
    ...(deps.actor !== undefined ? { actor: deps.actor } : {}),
  });
}

async function submit(item: { evidence: EvidenceV1; commandId?: string; idempotencyKey?: string }, engine: ReturnType<typeof createControlEngine>): Promise<void> {
  const cmd = buildSubmitEvidenceCommand({
    commandId: item.commandId ?? "cmd-ev",
    correlationId: "corr-" + (item.commandId ?? "cmd-ev"),
    submittedAt: FIXED,
    evidence: item.evidence,
    ...(item.idempotencyKey !== undefined ? { idempotencyKey: item.idempotencyKey } : {}),
  });
  const r = await engine.submitEvidence(cmd);
  expect(r.status).toBe("committed");
}

function reduceCmd(deps: { commandId: string; taskId: string; expectedRevision: number; idempotencyKey?: string }) {
  return buildReduceTaskCommand({
    commandId: deps.commandId,
    correlationId: "corr-" + deps.commandId,
    submittedAt: FIXED,
    expectedRevision: deps.expectedRevision,
    projectId: PROJECT,
    goalId: GOAL,
    taskId: deps.taskId,
    ...(deps.idempotencyKey !== undefined ? { idempotencyKey: deps.idempotencyKey } : {}),
  });
}

function planRef() {
  return { aggregateType: "PlanRevision" as const, projectId: PROJECT, planId: PLAN_ID };
}

async function runScript(engine: ReturnType<typeof createControlEngine>, deps: {
  taskId: string; runId: string; attemptId: string; script: typeof FAKE_RUNTIME_SCRIPT_COMPLETED_V1;
}): Promise<void> {
  const claim = await engine.claimTask(buildDispatchClaimCommand({
    commandId: "cmd-claim-" + deps.runId, correlationId: "corr-claim-" + deps.runId, submittedAt: FIXED,
    projectId: PROJECT, goalId: GOAL, taskId: deps.taskId, attemptId: deps.attemptId, runId: deps.runId,
    idempotencyKey: "p104-claim-" + deps.runId,
  }));
  expect(claim.status).toBe("committed");
  if (claim.status !== "committed") throw new Error("claim failed");

  const pr = planRef();
  const digest = artifactBodyDigest("p104-bundle-" + deps.runId);
  const bundleRef = { kind: "artifact" as const, contentType: "text/plain", digest, sizeBytes: digest.length, source: { kind: "plan-revision" as const, refId: pr.planId, revision: "1" } };
  const envelope = {
    schemaVersion: 1 as const, envelopeId: "envelope-" + deps.runId, projectId: PROJECT, workspaceId: WS,
    goalId: GOAL, taskId: deps.taskId,
    runRef: runRefFor(PROJECT, GOAL, deps.runId),
    attemptRef: taskAttemptRefFor(PROJECT, GOAL, deps.taskId, deps.attemptId),
    planRef: pr,
    roleBinding: { schemaVersion: 1 as const, bindingId: "binding-run-short-lived-v1", templateId: "template-short-lived-runner", templateRevision: "2026-09-05", bindingVersion: 1, policyRevision: "auth-policy-runtime-v1" },
    workspaceSnapshot: { workspaceId: WS, revision: 1 },
    permissions: { policyRevision: "auth-policy-runtime-v1", tools: ["read", "write"], writeScope: ["src/contracts"] },
    budget: { tokenBudget: 100_000, deadline: "2026-09-06T00:00:00.000Z" },
    sourceRefs: [{ kind: "plan-revision" as const, refId: pr.planId, revision: "1" }],
    bundleRef,
  };
  const start = await engine.startRun(buildDispatchStartCommand({
    commandId: "cmd-start-" + deps.runId, correlationId: "corr-start-" + deps.runId, submittedAt: FIXED,
    projectId: PROJECT, runId: deps.runId, expectedRevision: 1, envelope,
    manifest: buildManifestFixture({ workspaceId: WS, workspaceRevision: 1, planRef: pr }),
  }));
  expect(start.status).toBe("committed");
  if (start.status !== "committed") throw new Error("start failed");

  const events = rebaseScriptForRun(deps.script, runRefFor(PROJECT, GOAL, deps.runId));
  for (const [i, event] of events.entries()) {
    const fact = await engine.runFact(buildRunFactCommand({
      commandId: "cmd-fact-" + deps.runId + "-" + i, correlationId: "corr-fact-" + deps.runId + "-" + i, submittedAt: FIXED,
      projectId: PROJECT, runId: deps.runId, expectedRevision: 2 + i,
      fact: { kind: "runtime_event", event },
    }));
    expect(fact.status).toBe("committed");
    if (fact.status !== "committed") throw new Error("run fact failed");
  }
}


async function eventCount(ledger: StateLedger): Promise<number> {
  const page = await ledger.events({ afterCursor: null, limit: 1000 });
  return page.events.length;
}

describe("reduceTask: neutral-only signals", () => {
  it("a single completed exit=0 run never satisfies -> blocked", async () => {
    const { ledger, engine, plan } = await setupAccepted();
    await runScript(engine, { taskId: IMPLEMENT, runId: "run-exit0", attemptId: "att-exit0", script: FAKE_RUNTIME_SCRIPT_COMPLETED_V1 });
    const r = await engine.reduceTask(reduceCmd({ commandId: "cmd-reduce-exit0", taskId: IMPLEMENT, expectedRevision: 0 }));
    expect(r.status).toBe("committed");
    if (r.status !== "committed") return;
    expect(r.phase).toBe("blocked");
  });

  it("a CompletionClaim is NEUTRAL: with a claim but no PASS -> still blocked", async () => {
    const { ledger, engine, plan } = await setupAccepted();
    await runScript(engine, { taskId: IMPLEMENT, runId: "run-claim", attemptId: "att-claim", script: FAKE_RUNTIME_SCRIPT_COMPLETED_V1 });
    await submit({
      evidence: makeEvidence(plan, { evidenceId: "ev-claim-only", kind: "claim", outcome: "INCONCLUSIVE", taskId: IMPLEMENT, runRef: runRefFor(PROJECT, GOAL, "run-claim"), coverage: [coverage(P104_OBL_IMPLEMENT, "vr-impl-static"), coverage(P104_OBL_IMPLEMENT, "vr-impl-dynamic")] }),
      commandId: "cmd-claim-only", idempotencyKey: "k-claim-only",
    }, engine);
    const before = await eventCount(ledger);
    const r = await engine.reduceTask(reduceCmd({ commandId: "cmd-reduce-claim", taskId: IMPLEMENT, expectedRevision: 0 }));
    expect(r.status).toBe("committed");
    if (r.status !== "committed") return;
    expect(r.phase).toBe("blocked");
    const after = await eventCount(ledger);
    expect(after).toBe(before + 1);
  });
});

describe("reduceTask: FAIL vs supersession", () => {
  it("FAIL -> failed; FAIL superseded by later PASS -> satisfied; old FAIL stays auditable", async () => {
    const { ledger, engine, plan } = await setupAccepted();
    // FAIL for vr-impl-static only.
    await submit({ evidence: makeEvidence(plan, { evidenceId: "ev-fail-1", kind: "observation", outcome: "FAIL", taskId: IMPLEMENT, checkId: "static-check-lint" }), commandId: "cmd-fail-1", idempotencyKey: "k-fail-1" }, engine);
    const r1 = await engine.reduceTask(reduceCmd({ commandId: "cmd-reduce-fail", taskId: IMPLEMENT, expectedRevision: 0 }));
    expect(r1.status).toBe("committed");
    if (r1.status !== "committed") return;
    expect(r1.phase).toBe("failed");

    // PASS static + PASS dynamic (supersedes the FAIL on vr-impl-static).
    await submit({ evidence: makeEvidence(plan, { evidenceId: "ev-pass-1", kind: "observation", outcome: "PASS", taskId: IMPLEMENT, checkId: "static-check-lint" }), commandId: "cmd-pass-1", idempotencyKey: "k-pass-1" }, engine);
    await submit({ evidence: makeEvidence(plan, { evidenceId: "ev-pass-2", kind: "observation", outcome: "PASS", taskId: IMPLEMENT, checkId: "dynamic-check-tests", coverage: [coverage(P104_OBL_IMPLEMENT, "vr-impl-dynamic")] }), commandId: "cmd-pass-2", idempotencyKey: "k-pass-2" }, engine);
    const r2 = await engine.reduceTask(reduceCmd({ commandId: "cmd-reduce-sat", taskId: IMPLEMENT, expectedRevision: 1, idempotencyKey: "k-reduce-sat" }));
    expect(r2.status).toBe("committed");
    if (r2.status !== "committed") return;
    expect(r2.phase).toBe("satisfied");

    // The old FAIL remains a real Evidence aggregate (auditable).
    const evLoad = await ledger.load(evidenceRefFor(PROJECT, "ev-fail-1"));
    expect(evLoad.status).toBe("found");
    if (evLoad.status === "found") expect((evLoad.snapshot as { evidence: EvidenceV1 }).evidence.outcome).toBe("FAIL");

    // The reduction snapshot records the satisfied set (no blocking).
    const redLoad = await ledger.load(taskReductionRefFor(PROJECT, GOAL, IMPLEMENT));
    expect(redLoad.status).toBe("found");
    if (redLoad.status === "found") {
      const red = redLoad.snapshot as TaskReductionSnapshot;
      expect(red.phase).toBe("satisfied");
      expect(red.effectiveEvidenceIds).toEqual(expect.arrayContaining(["ev-pass-1", "ev-pass-2"]));
      expect(red.blockingEvidenceIds).toEqual([]);
    }
  });
});

describe("reduceTask: blocked / stale / verifying cases", () => {
  it("missing required input (no run, no evidence) -> blocked; batch folds the fixture snapshot", async () => {
    const { ledger, engine, plan } = await setupAccepted();
    const cmd = reduceCmd({ commandId: "cmd-reduce-missing", taskId: IMPLEMENT, expectedRevision: 0 });
    const r = await engine.reduceTask(cmd);
    expect(r.status).toBe("committed");
    if (r.status !== "committed") return;
    expect(r.phase).toBe("blocked");

    // Fold-equality: recompute the pure reduction + snapshot with the same ids.
    const currentAnchor = buildCurrentEffectivityAnchor({ plan, workspaceRevision: 1 });
    const input: TaskReductionInput = {
      projectId: PROJECT, goalId: GOAL, taskId: IMPLEMENT,
      plan, goalActivePlanRevision: plan.ref, currentAnchor,
      evidence: [], runSignals: [], unresolvedFindings: [], unreconciledSideEffects: [],
    };
    const computation = reduceTaskVerification(input);
    const expectedReduction = buildTaskReductionSnapshot({
      projectId: PROJECT, goalId: GOAL, taskId: IMPLEMENT, revision: 1,
      planRef: plan.ref, planRevision: plan.planRevision, taskKind: "work", requirementLevel: "required",
      disposition: "active", phase: computation.phase, currentAnchor,
      effectiveEvidenceIds: computation.effectiveEvidenceIds,
      blockingEvidenceIds: computation.blockingEvidenceIds,
      staleEvidenceIds: computation.staleEvidenceIds,
      outOfScopeEvidenceIds: computation.outOfScopeEvidenceIds,
      satisfiedObligationIds: computation.satisfiedObligationIds,
      causes: computation.causes, reducedAt: FIXED,
    });
    const expectedBatch = buildTaskReductionLedgerCommit(cmd, { eventId: "evt-0001", occurredAt: FIXED, workspaceId: WS, reduction: expectedReduction });
    const submitted = ledger.commits[ledger.commits.length - 1]!;
    expect(submitted).toEqual(expectedBatch);
  });

  it("stale extra evidence -> satisfied but the reduction records the stale id + current anchor", async () => {
    const { ledger, engine, plan } = await setupAccepted();
    await submit({ evidence: makeEvidence(plan, { evidenceId: "ev-app-pass", kind: "observation", outcome: "PASS", taskId: IMPLEMENT, checkId: "static-check-lint" }), commandId: "cmd-app-pass", idempotencyKey: "k-app-pass" }, engine);
    await submit({ evidence: makeEvidence(plan, { evidenceId: "ev-app-stale", kind: "observation", outcome: "PASS", taskId: IMPLEMENT, checkId: "static-check-lint", workspaceRevision: 2 }), commandId: "cmd-app-stale", idempotencyKey: "k-app-stale" }, engine);
    await submit({ evidence: makeEvidence(plan, { evidenceId: "ev-app-dyn", kind: "observation", outcome: "PASS", taskId: IMPLEMENT, checkId: "dynamic-check-tests", coverage: [coverage(P104_OBL_IMPLEMENT, "vr-impl-dynamic")] }), commandId: "cmd-app-dyn", idempotencyKey: "k-app-dyn" }, engine);
    const r = await engine.reduceTask(reduceCmd({ commandId: "cmd-reduce-app", taskId: IMPLEMENT, expectedRevision: 0 }));
    expect(r.status).toBe("committed");
    if (r.status !== "committed") return;
    expect(r.phase).toBe("satisfied");

    const redLoad = await ledger.load(taskReductionRefFor(PROJECT, GOAL, IMPLEMENT));
    expect(redLoad.status).toBe("found");
    if (redLoad.status === "found") {
      const red = redLoad.snapshot as TaskReductionSnapshot;
      expect(red.phase).toBe("satisfied");
      expect(red.staleEvidenceIds).toContain("ev-app-stale");
      expect(red.currentAnchor.workspaceRevision).toBe(1);
      expect(red.currentAnchor.planRef.planId).toBe(PLAN_ID);
    }
    // History untouched: the stale evidence still anchors workspaceRevision 2.
    const staleLoad = await ledger.load(evidenceRefFor(PROJECT, "ev-app-stale"));
    expect(staleLoad.status).toBe("found");
    if (staleLoad.status === "found") expect((staleLoad.snapshot as { evidence: EvidenceV1 }).evidence.anchor.workspaceRevision).toBe(2);
  });

  it("deferred disposition -> verifying (never satisfied)", async () => {
    const { ledger, engine } = await setupAccepted();
    const r = await engine.reduceTask(reduceCmd({ commandId: "cmd-reduce-deferred", taskId: DEFERRED, expectedRevision: 0 }));
    expect(r.status).toBe("committed");
    if (r.status !== "committed") return;
    expect(r.phase).toBe("verifying");
    const redLoad = await ledger.load(taskReductionRefFor(PROJECT, GOAL, DEFERRED));
    expect(redLoad.status).toBe("found");
    if (redLoad.status === "found") {
      const red = redLoad.snapshot as TaskReductionSnapshot;
      expect(red.phase).toBe("verifying");
      expect(red.causes.some((c) => c.code === "not_active")).toBe(true);
    }
  });
});

describe("reduceTask: reviewer verdict alone never satisfies", () => {
  it("verdict alone (vr-review only) -> blocked; verdict + bounded-packet static -> satisfied", async () => {
    const { ledger, engine, plan } = await setupAccepted();
    // Verdict evidence must come from a formal dispatch run (runRef set).
    const verdict = makeEvidence(plan, {
      evidenceId: "ev-verdict-1", kind: "verdict", outcome: "PASS", taskId: REVIEW,
      coverage: [coverage(P104_OBL_REVIEW, "vr-review")], checkId: "reviewer-semantic-check",
      runRef: runRefFor(PROJECT, GOAL, "run-verdict"),
    });
    await submit({ evidence: verdict, commandId: "cmd-verdict-1", idempotencyKey: "k-verdict-1" }, engine);
    const r1 = await engine.reduceTask(reduceCmd({ commandId: "cmd-red-verdict", taskId: REVIEW, expectedRevision: 0 }));
    expect(r1.status).toBe("committed");
    if (r1.status !== "committed") return;
    expect(r1.phase).toBe("blocked"); // vr-review-static still missing

    const pktStatic = makeEvidence(plan, {
      evidenceId: "ev-verdict-static", kind: "observation", outcome: "PASS", taskId: REVIEW,
      coverage: [coverage(P104_OBL_REVIEW, "vr-review-static")], checkId: "static-check-lint",
    });
    await submit({ evidence: pktStatic, commandId: "cmd-verdict-static", idempotencyKey: "k-verdict-static" }, engine);
    const r2 = await engine.reduceTask(reduceCmd({ commandId: "cmd-red-verdict2", taskId: REVIEW, expectedRevision: 1, idempotencyKey: "k-red-verdict2" }));
    expect(r2.status).toBe("committed");
    if (r2.status !== "committed") return;
    expect(r2.phase).toBe("satisfied");
  });
});

describe("reduceTask: run signals that block satisfaction", () => {
  it("crashed run -> failed", async () => {
    const { ledger, engine } = await setupAccepted();
    await runScript(engine, { taskId: IMPLEMENT, runId: "run-crash", attemptId: "att-crash", script: FAKE_RUNTIME_SCRIPT_CRASHED_V1 });
    const r = await engine.reduceTask(reduceCmd({ commandId: "cmd-reduce-crash", taskId: IMPLEMENT, expectedRevision: 0 }));
    expect(r.status).toBe("committed");
    if (r.status !== "committed") return;
    expect(r.phase).toBe("failed");
    const redLoad = await ledger.load(taskReductionRefFor(PROJECT, GOAL, IMPLEMENT));
    expect(redLoad.status).toBe("found");
    if (redLoad.status === "found") {
      const red = redLoad.snapshot as TaskReductionSnapshot;
      expect(red.causes.some((c) => c.code === "run_failed_signal")).toBe(true);
    }
  });

  it("outcome_unknown side effect -> NOT satisfied (verifying)", async () => {
    const { ledger, engine } = await setupAccepted();
    // Fresh run on the review task; drive claim -> start -> explicit outcome_unknown
    // fact BEFORE any terminal runtime event, so the run ends outcome_unknown.
    const pr = planRef();
    const runId = "run-unknown";
    const attemptId = "att-unknown";
    const claim = await engine.claimTask(buildDispatchClaimCommand({
      commandId: "cmd-claim-uk", correlationId: "corr-claim-uk", submittedAt: FIXED,
      projectId: PROJECT, goalId: GOAL, taskId: REVIEW, attemptId, runId,
      idempotencyKey: "p104-claim-uk",
    }));
    expect(claim.status).toBe("committed");
    if (claim.status !== "committed") return;
    const digest = artifactBodyDigest("p104-bundle-uk");
    const bundleRef = { kind: "artifact" as const, contentType: "text/plain", digest, sizeBytes: digest.length, source: { kind: "plan-revision" as const, refId: pr.planId, revision: "1" } };
    const envelope = {
      schemaVersion: 1 as const, envelopeId: "envelope-uk", projectId: PROJECT, workspaceId: WS,
      goalId: GOAL, taskId: REVIEW,
      runRef: runRefFor(PROJECT, GOAL, runId), attemptRef: taskAttemptRefFor(PROJECT, GOAL, REVIEW, attemptId), planRef: pr,
      roleBinding: { schemaVersion: 1 as const, bindingId: "binding-run-short-lived-v1", templateId: "template-short-lived-runner", templateRevision: "2026-09-05", bindingVersion: 1, policyRevision: "auth-policy-runtime-v1" },
      workspaceSnapshot: { workspaceId: WS, revision: 1 },
      permissions: { policyRevision: "auth-policy-runtime-v1", tools: ["read", "write"], writeScope: ["src/contracts"] },
      budget: { tokenBudget: 100_000, deadline: "2026-09-06T00:00:00.000Z" },
      sourceRefs: [{ kind: "plan-revision" as const, refId: pr.planId, revision: "1" }],
      bundleRef,
    };
    const start = await engine.startRun(buildDispatchStartCommand({
      commandId: "cmd-start-uk", correlationId: "corr-start-uk", submittedAt: FIXED,
      projectId: PROJECT, runId, expectedRevision: 1, envelope,
      manifest: buildManifestFixture({ workspaceId: WS, workspaceRevision: 1, planRef: pr }),
    }));
    expect(start.status).toBe("committed");
    if (start.status !== "committed") return;
    const unknownFact = await engine.runFact(buildRunFactCommand({
      commandId: "cmd-unknown", correlationId: "corr-unknown", submittedAt: FIXED,
      projectId: PROJECT, runId, expectedRevision: 2,
      fact: { kind: "outcome_unknown", runRef: runRefFor(PROJECT, GOAL, runId), reason: "disconnected" },
    }));
    expect(unknownFact.status).toBe("committed");
    if (unknownFact.status !== "committed") return;

    const r = await engine.reduceTask(reduceCmd({ commandId: "cmd-reduce-unknown", taskId: REVIEW, expectedRevision: 0 }));
    expect(r.status).toBe("committed");
    if (r.status !== "committed") return;
    expect(r.phase).not.toBe("satisfied");
    expect(r.phase).toBe("verifying");
    const redLoad = await ledger.load(taskReductionRefFor(PROJECT, GOAL, REVIEW));
    expect(redLoad.status).toBe("found");
    if (redLoad.status === "found") {
      const red = redLoad.snapshot as TaskReductionSnapshot;
      expect(red.causes.some((c) => c.code === "unreconciled_side_effect")).toBe(true);
    }
  });
});

describe("reduceTask: rejections (zero write)", () => {
  it("task not in the plan -> task_not_in_plan; missing goal -> not_found; invalid -> invalid", async () => {
    const { ledger, engine } = await setupAccepted();
    const before = await eventCount(ledger);

    const notInPlan = await engine.reduceTask(reduceCmd({ commandId: "cmd-red-notinplan", taskId: "task-absent", expectedRevision: 0 }));
    expect(notInPlan.status).toBe("rejected");
    if (notInPlan.status === "rejected") expect(notInPlan.code).toBe("task_not_in_plan");

    const missingGoal = await engine.reduceTask({
      ...reduceCmd({ commandId: "cmd-red-nogoal", taskId: IMPLEMENT, expectedRevision: 0 }),
      payload: { goalId: "goal-absent" },
    });
    expect(missingGoal.status).toBe("rejected");
    if (missingGoal.status === "rejected") expect(missingGoal.code).toBe("not_found");

    const invalid = await engine.reduceTask({ ...reduceCmd({ commandId: "cmd-red-invalid", taskId: IMPLEMENT, expectedRevision: 0 }), schemaVersion: 99 } as never);
    expect(invalid.status).toBe("rejected");
    if (invalid.status === "rejected") expect(invalid.code).toBe("invalid");

    expect(await eventCount(ledger)).toBe(before);
  });
});