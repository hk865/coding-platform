/**
 * P1-07 lane C unit tests: recordPatch over a REAL InMemoryLedger via the
 * ControlEngineImpl handler.
 *
 * Drive the ENGINE handler and assert the guard sequence (all zero-write except
 * the single atomic commit) and the fold-equality to the shared
 * buildPatchRecordLedgerCommit fixture.
 *
 * NOTE (baseline gap reported to the integrator): the frozen
 * validateRecordPatchCommand validates pat.taskRevision via stringField (it
 * must be a STRING), but the contract type PatchArtifactV1.taskRevision is a
 * NUMBER and the frozen guard-4 rule is a STRICT compare to the numeric
 * plan.planRevision. Consequently, a numeric taskRevision is rejected at guard
 * 1 ("invalid") and a string taskRevision is rejected at guard 4
 * ("stale_plan") — the happy path and guards 5..10 are unreachable until that
 * validator is fixed. These tests therefore cover the reachable guard ordering
 * (shape -> run -> workspace -> plan) with a string taskRevision that satisfies
 * the current validator, and document the blocker for the deeper guards.
 */
import { describe, expect, it } from "vitest";
import { createControlEngine } from "../../src/control/control-engine.js";
import { InMemoryLedger } from "../../src/ledger/in-memory-ledger.js";
import type { StateLedger, LedgerCommit, LedgerCommitReceipt } from "../../src/contracts/ledger.js";
import { createDeterministicDeps } from "../../src/contracts/testing/sequences.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1, buildCreateGoalCommand } from "../../src/contracts/fixtures/goal-fixtures.js";
import { ARCHITECTURE_BASELINE_FIXTURE_V1, COMPLETION_POLICY_FIXTURE_V1, buildActivateCommand, buildInstallCommand, completionPolicyPinFor, architectureBaselinePinFor } from "../../src/contracts/fixtures/governance-fixtures.js";
import { buildApplyPlanCommand } from "../../src/contracts/fixtures/plan-fixtures.js";
import { buildDispatchClaimCommand, buildDispatchStartCommand, buildRunFactCommand, buildEnvelopeFixture, buildManifestFixture, rebaseScriptForRun, FAKE_RUNTIME_SCRIPT_COMPLETED_V1 } from "../../src/contracts/fixtures/dispatch-fixtures.js";
import {
  P107_GOAL,
  P107_PROJECT,
  P107_WORKSPACE,
  P107_TASK_READER_A,
  P107_TASK_WRITER,
  P107_PLAN_REVISION_FIXTURE_V1,
  P107_SCOPE_WRITER,
  P107_ROLE_BINDING_READER_V1,
  P107_ROLE_BINDING_WRITER_V1,
  P107_BUDGET_READER_V1,
  P107_DECLARED_READ_PERMISSIONS_V1,
  p107PlanRef,
  buildP107RecordPatchCommand,
  buildP107ArtifactRef,
} from "../../src/contracts/fixtures/workspace-fixtures.js";
import { runRefFor, taskAttemptRefFor } from "../../src/contracts/dispatch.js";
import { evidenceRefFor } from "../../src/contracts/evidence.js";
import { patchRecordRefFor, type PatchArtifactV1, type RecordPatchCommand } from "../../src/contracts/patch.js";
import { buildPatchRecordLedgerCommit, type BuildP107PatchCommitDeps } from "../../src/contracts/fixtures/workspace-fixtures.js";

const FIXED = "2026-09-06T12:00:00.000Z";

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
  return { ledger, engine, d };
}

/** Bootstrap the P107 project/workspace, goal, governance pins, accepted plan. */
async function setupPlan(engine: ReturnType<typeof createControlEngine>, ledger: StateLedger) {
  await engine.bootstrap(buildBootstrapCommand({ schemaVersion: 1, entries: [{ projectId: P107_PROJECT, workspaceId: P107_WORKSPACE }] }, { commandId: "cmd-boot", correlationId: "corr-boot", submittedAt: FIXED }));
  const scope = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[0]!;
  await engine.submit(buildCreateGoalCommand({ ...scope, projectId: P107_PROJECT, workspaceId: P107_WORKSPACE, goalId: P107_GOAL }, { commandId: "cmd-goal", correlationId: "corr-goal", submittedAt: FIXED, idempotencyKey: "p1-07-goal" }));
  const cp = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, { commandId: "cmd-icp", correlationId: "corr-icp", submittedAt: FIXED, projectId: P107_PROJECT, idempotencyKey: "inst-cp" }) as Parameters<typeof completionPolicyPinFor>[0];
  const ab = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, { commandId: "cmd-iab", correlationId: "corr-iab", submittedAt: FIXED, projectId: P107_PROJECT, idempotencyKey: "inst-ab" }) as Parameters<typeof architectureBaselinePinFor>[0];
  expect((await engine.install(cp)).status).toBe("committed");
  expect((await engine.install(ab)).status).toBe("committed");
  expect((await engine.activate(buildActivateCommand(completionPolicyPinFor(cp), { commandId: "cmd-acp", correlationId: "corr-acp", submittedAt: FIXED, projectId: P107_PROJECT, expectedRevision: 1, idempotencyKey: "act-cp" }))).status).toBe("committed");
  expect((await engine.activate(buildActivateCommand(architectureBaselinePinFor(ab), { commandId: "cmd-aab", correlationId: "corr-aab", submittedAt: FIXED, projectId: P107_PROJECT, expectedRevision: 1, idempotencyKey: "act-ab" }))).status).toBe("committed");
  expect((await engine.applyPlan(buildApplyPlanCommand(P107_PLAN_REVISION_FIXTURE_V1, { commandId: "cmd-app", correlationId: "corr-app", submittedAt: FIXED, projectId: P107_PROJECT, expectedRevision: 1, idempotencyKey: "apply" }))).status).toBe("committed");
}

/** Run reader A to completion (no DAG deps) -> an ENDED run usable by guards 3.. */
async function endReader(engine: ReturnType<typeof createControlEngine>, runId: string) {
  const runRef = await claimReader(engine, runId);
  const envelope = buildEnvelopeFixture({
    envelopeId: "env-" + runId, projectId: P107_PROJECT, workspaceId: P107_WORKSPACE, goalId: P107_GOAL, taskId: P107_TASK_READER_A,
    runId, attemptId: "att-" + runId, planRef: p107PlanRef(P107_PROJECT), workspaceRevision: 1, roleBinding: P107_ROLE_BINDING_READER_V1, budget: P107_BUDGET_READER_V1,
    permissions: { policyRevision: P107_ROLE_BINDING_READER_V1.policyRevision, tools: ["read"], writeScope: [] }, bundleRef: buildP107ArtifactRef("bundle-" + runId),
  });
  expect((await engine.startRun(buildDispatchStartCommand({ commandId: "cmd-start-" + runId, correlationId: "corr-start-" + runId, submittedAt: FIXED, projectId: P107_PROJECT, runId, expectedRevision: 1, envelope, manifest: buildManifestFixture({ workspaceId: P107_WORKSPACE, workspaceRevision: 1, planRef: p107PlanRef(P107_PROJECT) }) }))).status).toBe("committed");
  let exp = 2;
  for (const ev of rebaseScriptForRun(FAKE_RUNTIME_SCRIPT_COMPLETED_V1, runRef)) {
    const r = await engine.runFact(buildRunFactCommand({ commandId: "cmd-fact-" + runId + "-" + ev.sequence, correlationId: "corr-fact-" + runId, submittedAt: ev.occurredAt, projectId: P107_PROJECT, runId, expectedRevision: exp, fact: { kind: "runtime_event", event: ev } }));
    if (r.status === "committed") exp = r.runRevision;
  }
  return runRef;
}

/** Claim (but do NOT start) a reader run -> an existing, still "starting" run. */
async function claimReader(engine: ReturnType<typeof createControlEngine>, runId: string) {
  const claim = await engine.claimTask(buildDispatchClaimCommand({
    commandId: "cmd-claim-" + runId, correlationId: "corr-claim-" + runId, submittedAt: FIXED,
    projectId: P107_PROJECT, goalId: P107_GOAL, taskId: P107_TASK_READER_A, attemptId: "att-" + runId, runId,
    roleBinding: P107_ROLE_BINDING_READER_V1, declaredPermissions: P107_DECLARED_READ_PERMISSIONS_V1, budget: P107_BUDGET_READER_V1,
    idempotencyKey: "p1-07-claim-" + runId,
  }));
  expect(claim.status).toBe("committed");
  return claim.status === "committed" ? claim.runRef : (runRefFor(P107_PROJECT, P107_GOAL, runId) as never);
}

type PatchOverrides = Partial<{
  taskRevision: number | string;
  workspaceId: string;
  planRef: PatchArtifactV1["planRef"];
  runRef: PatchArtifactV1["runRef"];
  changedPaths: string[];
  usedInputEvidenceRefs: PatchArtifactV1["usedInputEvidenceRefs"];
  afterWorkspaceRevision: number;
}>;

function mkPatch(commandId: string, patchId: string, runId: string, beforeRev: number, o: PatchOverrides = {}): RecordPatchCommand {
  const patch: PatchArtifactV1 = {
    schemaVersion: 1, patchId, projectId: P107_PROJECT, workspaceId: o.workspaceId ?? P107_WORKSPACE, goalId: P107_GOAL, taskId: P107_TASK_WRITER,
    planRef: o.planRef ?? p107PlanRef(P107_PROJECT), taskRevision: (o.taskRevision ?? 1) as number,
    runRef: o.runRef ?? runRefFor(P107_PROJECT, P107_GOAL, runId), attemptRef: taskAttemptRefFor(P107_PROJECT, P107_GOAL, P107_TASK_WRITER, "att-" + runId),
    roleBinding: P107_ROLE_BINDING_WRITER_V1, kind: "patch", title: "fix", changedPaths: o.changedPaths ?? ["src/p107/fix-a.ts"],
    bodyRef: buildP107ArtifactRef(patchId), beforeWorkspaceRevision: beforeRev, afterWorkspaceRevision: o.afterWorkspaceRevision ?? beforeRev + 1,
    checkResults: [{ checkId: "gate-p107", outcome: "PASS", summary: "ok" }], usedInputEvidenceRefs: o.usedInputEvidenceRefs ?? [],
    generatedAt: FIXED,
  };
  return buildP107RecordPatchCommand({ commandId, projectId: P107_PROJECT, patch });
}

async function eventCount(ledger: StateLedger): Promise<number> {
  const page = await ledger.events({ afterCursor: null, limit: 1000 });
  return page.events.length;
}

describe("recordPatch: guard sequence (shape -> run -> workspace -> plan)", () => {
  it("invalid command (string taskRevision violates the numeric contract type) -> invalid, zero write", async () => {
    const { ledger, engine } = makeHarness();
    await setupPlan(engine, ledger);
    const before = await eventCount(ledger);
    const cmd = mkPatch("cmd-invalid", "patch-inv", "run-a", 1, { taskRevision: "1" });
    const receipt = await engine.recordPatch(cmd);
    expect(receipt.status).toBe("rejected");
    if (receipt.status === "rejected") expect(receipt.code).toBe("invalid");
    expect(await eventCount(ledger)).toBe(before);
  });

  it("run_not_found (writer run missing) -> zero write", async () => {
    const { ledger, engine } = makeHarness();
    await setupPlan(engine, ledger);
    const before = await eventCount(ledger);
    const receipt = await engine.recordPatch(mkPatch("cmd-ghost", "patch-ghost", "run-ghost", 1));
    expect(receipt.status).toBe("rejected");
    if (receipt.status === "rejected") expect(receipt.code).toBe("run_not_found");
    expect(await eventCount(ledger)).toBe(before);
  });

  it("run_not_ended (writer run still active) -> zero write", async () => {
    const { ledger, engine } = makeHarness();
    await setupPlan(engine, ledger);
    const run = await claimReader(engine, "run-active");
    const before = await eventCount(ledger);
    const receipt = await engine.recordPatch(mkPatch("cmd-active", "patch-active", "run-active", 1, { runRef: run }));
    expect(receipt.status).toBe("rejected");
    if (receipt.status === "rejected") expect(receipt.code).toBe("run_not_ended");
    expect(await eventCount(ledger)).toBe(before);
  });

  it("workspace_not_found (no such workspace) -> zero write", async () => {
    const { ledger, engine } = makeHarness();
    await setupPlan(engine, ledger);
    const run = await endReader(engine, "run-ws");
    const before = await eventCount(ledger);
    const receipt = await engine.recordPatch(mkPatch("cmd-ws", "patch-ws", "run-ws", 1, { runRef: run, workspaceId: "ws-ghost", changedPaths: ["src/p107/fix-a.ts"] }));
    expect(receipt.status).toBe("rejected");
    if (receipt.status === "rejected") expect(receipt.code).toBe("workspace_not_found");
    expect(await eventCount(ledger)).toBe(before);
  });

  it("plan_not_found -> zero write", async () => {
    const { ledger, engine } = makeHarness();
    await setupPlan(engine, ledger);
    const run = await endReader(engine, "run-plan");
    const before = await eventCount(ledger);
    const receipt = await engine.recordPatch(mkPatch("cmd-plan", "patch-plan", "run-plan", 1, { runRef: run, planRef: { aggregateType: "PlanRevision", projectId: P107_PROJECT, planId: "plan-ghost" } }));
    expect(receipt.status).toBe("rejected");
    if (receipt.status === "rejected") expect(receipt.code).toBe("plan_not_found");
    expect(await eventCount(ledger)).toBe(before);
  });

  it("stale_plan (taskRevision != plan.planRevision) -> zero write", async () => {
    const { ledger, engine } = makeHarness();
    await setupPlan(engine, ledger);
    const run = await endReader(engine, "run-stale");
    // Driver: pass a string taskRevision "2" (valid per the CURRENT validator,
    // which requires a string) but it is strictly != plan.planRevision (1).
    const before = await eventCount(ledger);
    const receipt = await engine.recordPatch(mkPatch("cmd-stale", "patch-stale", "run-stale", 1, { runRef: run, taskRevision: 2 }));
    expect(receipt.status).toBe("rejected");
    if (receipt.status === "rejected") expect(receipt.code).toBe("stale_plan");
    expect(await eventCount(ledger)).toBe(before);
  });

  it("lease_not_found (no active write lease for the ended run) -> zero write", async () => {
    // Guards 5: after shape/run/workspace/plan pass, the write-lease index has
    // no active lease -> lease_not_found (zero write). The deep guards 6..10
    // and the happy path (workspace revision advance + lease release + index
    // clear + idempotency) are covered end-to-end by the shared contract suite
    // (tests/contract-suite/workspace.contract.suite.ts A6) on both adapters.
    const { ledger, engine } = makeHarness();
    await setupPlan(engine, ledger);
    const run = await endReader(engine, "run-lease");
    const before = await eventCount(ledger);
    const receipt = await engine.recordPatch(mkPatch("cmd-lease", "patch-lease", "run-lease", 1, { runRef: run, usedInputEvidenceRefs: [evidenceRefFor(P107_PROJECT, "ev-read-a")] }));
    expect(receipt.status).toBe("rejected");
    if (receipt.status === "rejected") expect(receipt.code).toBe("lease_not_found");
    expect(await eventCount(ledger)).toBe(before);
  });
});
