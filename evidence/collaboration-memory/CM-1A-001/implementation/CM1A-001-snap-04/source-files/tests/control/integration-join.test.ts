/**
 * P1-07 lane B unit tests: recordIntegrationResult (evidence join).
 *
 * Frozen guard sequence (IMPLEMENTATION-HANDOFF.md item 6): shape -> run ended
 * -> canonical workspace/plan -> input presence/run-match/applicability ->
 * detectEvidenceConflicts -> unresolved -> duplicate (no overwrite) ->
 * accumulator CAS. The recorded conflicts are the AUTHORITATIVE frozen
 * detection (not a caller-supplied array).
 *
 * NOTE on the scenario:
 *   - the frozen prepareP107Scenario bootstraps proj-alpha/proj-beta while the
 *     P1-07 project is proj-p107, so the scenario is built locally;
 *   - the plan's DAG readiness reads the IMMUTABLE PlanRevisionSnapshot task
 *     phases (always "pending"), so a depends_on task (the integration task)
 *     can NEVER be claimed in the current baseline — the guard only requires the
 *     join's RunRef to be an ENDED run, so these unit tests use an ended READER
 *     run as the join's runRef (this is a baseline gap reported to the integrator
 *     and does not weaken the recordIntegrationResult guard coverage).
 *
 * Coverage:
 *   - happy path: two accepted reader outputs with a conflict + explanation ->
 *     committed, 1 conflict recorded, never overwritten (late duplicate -> conflict_duplicate);
 *   - unresolved (no explanation, no escalate); invalid escalate;
 *   - run_not_found / run_not_ended / stale_source (workspace & plan);
 *   - input_not_found / input_run_mismatch / input_not_accepted;
 *   - no-conflict join commits cleanly; a second join appends (accumulator CAS);
 *   - invalid shape command -> invalid.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { buildInstallCommand, buildActivateCommand, ARCHITECTURE_BASELINE_FIXTURE_V1, COMPLETION_POLICY_FIXTURE_V1 } from "../../src/fixtures/governance-fixtures.js";
import { completionPolicyPinFor, architectureBaselinePinFor } from "../../src/contracts/governance.js";
import { buildCreateGoalCommand } from "../contract-support/fixtures/goal-fixtures.js";
import { buildApplyPlanCommand } from "../../src/fixtures/plan-fixtures.js";
import {
  P107_PROJECT,
  P107_WORKSPACE,
  P107_SCHEMA,
  P107_PLAN_REVISION_FIXTURE_V1,
} from "../contract-support/fixtures/workspace-fixtures.js";
import { buildEffectivityAnchorV1 } from "../contract-support/fixtures/evidence-fixtures.js";
import { integrationResultRefFor } from "../../src/contracts/integration.js";
import { taskAttemptRefFor } from "../../src/contracts/dispatch.js";
import type { EffectivityAnchorV1 } from "../../src/contracts/evidence.js";
import type { PlanRevisionRef } from "../../src/contracts/plan.js";
import type { RunRef } from "../../src/contracts/dispatch.js";
import type { EvidenceRef } from "../../src/contracts/evidence.js";
import {
  p107GoalScope,
  p107PlanRef,
  toP1_07Harness,
  claimP107Task,
  submitP107Evidence,
  buildP107RecordIntegrationCommand,
  P107_GOAL,
  P107_TASK_INTEGRATION,
  P107_TASK_READER_A,
  P107_TASK_READER_B,
  P107_OBL_READERS,
  P107_VR_READERS,
  P107_ROLE_BINDING_READER_V1,
  P107_DECLARED_READ_PERMISSIONS_V1,
  P107_BUDGET_READER_V1,
} from "../contract-suite/p1-07-harness.js";
import type { P1_07HarnessLike, P1_07TestHarness } from "../contract-suite/p1-07-harness.js";

type P107Scenario = {
  planRef: PlanRevisionRef;
  workspaceRevision: number;
  pinnedCompletionPolicy: ReturnType<typeof completionPolicyPinFor>;
  pinnedArchitectureBaseline: ReturnType<typeof architectureBaselinePinFor>;
};

async function setupP107Scenario(h: ReturnType<typeof createInMemoryHarness>): Promise<P107Scenario> {
  const boot = await h.bootstrap(
    buildBootstrapCommand(
      { schemaVersion: 1, entries: [{ projectId: P107_PROJECT, workspaceId: P107_WORKSPACE }] },
      { commandId: "cmd-p107-boot", correlationId: "corr-p107-boot", submittedAt: P107_SCHEMA },
    ),
  );
  expect(boot.status).toBe("committed");

  const installPolicy = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, {
    commandId: "cmd-p107-install-policy", correlationId: "corr-p107-install-policy", submittedAt: P107_SCHEMA,
    projectId: P107_PROJECT, idempotencyKey: "p107-install-policy",
  });
  const installBaseline = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, {
    commandId: "cmd-p107-install-baseline", correlationId: "corr-p107-install-baseline", submittedAt: P107_SCHEMA,
    projectId: P107_PROJECT, idempotencyKey: "p107-install-baseline",
  });
  expect((await h.install(installPolicy)).status).toBe("committed");
  expect((await h.install(installBaseline)).status).toBe("committed");

  const actPolicy = buildActivateCommand(completionPolicyPinFor(installPolicy as never), {
    commandId: "cmd-p107-activate-policy", correlationId: "corr-p107-activate-policy", submittedAt: P107_SCHEMA,
    projectId: P107_PROJECT, expectedRevision: 1, idempotencyKey: "p107-activate-policy",
  });
  const actBaseline = buildActivateCommand(architectureBaselinePinFor(installBaseline as never), {
    commandId: "cmd-p107-activate-baseline", correlationId: "corr-p107-activate-baseline", submittedAt: P107_SCHEMA,
    projectId: P107_PROJECT, expectedRevision: 1, idempotencyKey: "p107-activate-baseline",
  });
  expect((await h.activate(actPolicy)).status).toBe("committed");
  expect((await h.activate(actBaseline)).status).toBe("committed");

  const goal = await h.control.submit(
    buildCreateGoalCommand(p107GoalScope(), {
      commandId: "cmd-p107-create-goal", correlationId: "corr-p107-create-goal", submittedAt: P107_SCHEMA,
      idempotencyKey: "p1-07-create-goal",
    }),
  );
  expect(goal.status).toBe("committed");

  const plan = await h.applyPlan(
    buildApplyPlanCommand(P107_PLAN_REVISION_FIXTURE_V1, {
      commandId: "cmd-p107-apply-plan", correlationId: "corr-p107-apply-plan", submittedAt: P107_SCHEMA,
      projectId: P107_PROJECT, expectedRevision: 1, idempotencyKey: "p1-07-apply-plan",
    }),
  );
  expect(plan.status).toBe("committed");

  const wsLoad = await h.ledger.load({ aggregateType: "Workspace" as const, projectId: P107_PROJECT, workspaceId: P107_WORKSPACE });
  expect(wsLoad.status).toBe("found");
  return {
    planRef: p107PlanRef(P107_PROJECT),
    workspaceRevision: wsLoad.status === "found" ? (wsLoad.snapshot as { revision: number }).revision : 1,
    pinnedCompletionPolicy: completionPolicyPinFor(installPolicy as never),
    pinnedArchitectureBaseline: architectureBaselinePinFor(installBaseline as never),
  };
}

const readerAnchor = (sc: P107Scenario, workspaceRevision?: number): EffectivityAnchorV1 =>
  buildEffectivityAnchorV1({
    planRef: sc.planRef,
    planRevision: 1,
    workspaceRevision: workspaceRevision ?? sc.workspaceRevision,
    pinnedCompletionPolicy: sc.pinnedCompletionPolicy,
    pinnedArchitectureBaseline: sc.pinnedArchitectureBaseline,
  });

async function freshHarness() {
  const harness = createInMemoryHarness();
  const sc = await setupP107Scenario(harness);
  const h = toP1_07Harness(harness as unknown as P1_07HarnessLike);
  return { harness, h, sc };
}

/** Run the two readers (parallel drive) and submit one evidence each over the same VR. */
async function makeReaderEvidence(
  h: P1_07TestHarness,
  sc: P107Scenario,
  prefix: string,
  aOutcome: "PASS" | "FAIL",
  bOutcome: "PASS" | "FAIL",
): Promise<{ runA: RunRef; runB: RunRef; evA: EvidenceRef; evB: EvidenceRef }> {
  await claimP107Task(h, {
    taskId: P107_TASK_READER_A, runId: "run-p107-read-a", attemptId: "att-p107-read-a",
    roleBinding: P107_ROLE_BINDING_READER_V1, declaredPermissions: P107_DECLARED_READ_PERMISSIONS_V1, budget: P107_BUDGET_READER_V1,
  });
  await claimP107Task(h, {
    taskId: P107_TASK_READER_B, runId: "run-p107-read-b", attemptId: "att-p107-read-b",
    roleBinding: P107_ROLE_BINDING_READER_V1, declaredPermissions: P107_DECLARED_READ_PERMISSIONS_V1, budget: P107_BUDGET_READER_V1,
  });
  const drive = await h.workspaceDrive.driveParallel({
    schemaVersion: 1, reason: "P1-07 readers", projectId: P107_PROJECT, goalId: P107_GOAL, maxIntents: 4,
  });
  expect(drive.failures).toHaveLength(0);
  expect(drive.started).toBe(2);

  const runA: RunRef = { aggregateType: "Run" as const, projectId: P107_PROJECT, goalId: P107_GOAL, runId: "run-p107-read-a" };
  const runB: RunRef = { aggregateType: "Run" as const, projectId: P107_PROJECT, goalId: P107_GOAL, runId: "run-p107-read-b" };
  const anchor = readerAnchor(sc);
  const evA = await submitP107Evidence(h, {
    evidenceId: prefix + "-a", taskId: P107_TASK_READER_A, outcome: aOutcome, runRef: runA,
    coverage: [{ obligationId: P107_OBL_READERS, requirementId: P107_VR_READERS }], anchor,
  });
  const evB = await submitP107Evidence(h, {
    evidenceId: prefix + "-b", taskId: P107_TASK_READER_B, outcome: bOutcome, runRef: runB,
    coverage: [{ obligationId: P107_OBL_READERS, requirementId: P107_VR_READERS }], anchor,
  });
  return { runA, runB, evA, evB };
}

const attInt = taskAttemptRefFor(P107_PROJECT, P107_GOAL, P107_TASK_INTEGRATION, "att-p107-read-a");

describe("recordIntegrationResult", () => {
  it("happy path: conflict with explanation commits, recorded, and never overwritten", async () => {
    const { h, sc } = await freshHarness();
    const { runA, runB, evA, evB } = await makeReaderEvidence(h, sc, "ev-conf", "PASS", "FAIL");
    const runRef = runA;

    // conflicts exist but no explanation and no escalate -> conflict_unresolved.
    const unresolved = await h.recordIntegrationResult(
      buildP107RecordIntegrationCommand({
        commandId: "cmd-p107-integration-res-unresolved", projectId: P107_PROJECT, expectedRevision: 0,
        result: {
          schemaVersion: 1, resultId: "res-unresolved", projectId: P107_PROJECT, workspaceId: P107_WORKSPACE,
          goalId: P107_GOAL, taskId: P107_TASK_INTEGRATION, planRef: sc.planRef, taskRevision: 1,
          runRef, attemptRef: attInt, workspaceRevision: sc.workspaceRevision,
          inputs: [
            { sourceTaskId: P107_TASK_READER_A, sourceRunRef: runA, kind: "evidence", evidenceRef: evA, artifactRef: null, handoffPacketRef: null },
            { sourceTaskId: P107_TASK_READER_B, sourceRunRef: runB, kind: "evidence", evidenceRef: evB, artifactRef: null, handoffPacketRef: null },
          ],
          conflicts: [], gaps: [], explanation: null, escalate: false, generatedAt: P107_SCHEMA,
        },
      }),
    );
    expect(unresolved.status).toBe("rejected");
    if (unresolved.status === "rejected") expect(unresolved.code).toBe("conflict_unresolved");

    // with an explanation -> committed; the detected conflict is recorded.
    const explained = await h.recordIntegrationResult(
      buildP107RecordIntegrationCommand({
        commandId: "cmd-p107-integration-res-explained", projectId: P107_PROJECT, expectedRevision: 0,
        result: {
          schemaVersion: 1, resultId: "res-explained", projectId: P107_PROJECT, workspaceId: P107_WORKSPACE,
          goalId: P107_GOAL, taskId: P107_TASK_INTEGRATION, planRef: sc.planRef, taskRevision: 1,
          runRef, attemptRef: attInt, workspaceRevision: sc.workspaceRevision,
          inputs: [
            { sourceTaskId: P107_TASK_READER_A, sourceRunRef: runA, kind: "evidence", evidenceRef: evA, artifactRef: null, handoffPacketRef: null },
            { sourceTaskId: P107_TASK_READER_B, sourceRunRef: runB, kind: "evidence", evidenceRef: evB, artifactRef: null, handoffPacketRef: null },
          ],
          conflicts: [], gaps: [], explanation: "Reader A verified the fix; Reader B's failure is on an optional path.", escalate: false, generatedAt: P107_SCHEMA,
        },
      }),
    );
    expect(explained.status).toBe("committed");

    const agg = await h.ledger.load(integrationResultRefFor(P107_PROJECT, P107_GOAL, P107_TASK_INTEGRATION));
    expect(agg.status).toBe("found");
    if (agg.status === "found") {
      const records = (agg.snapshot as { records: { conflicts: { conflictKey: string; obligationId: string }[] }[] }).records;
      expect(records).toHaveLength(1);
      expect(records[0]!.conflicts).toHaveLength(1);
      expect(records[0]!.conflicts[0]!.obligationId).toBe(P107_OBL_READERS);
    }

    // a LATER result re-using the SAME conflictKey -> conflict_duplicate (no overwrite).
    const late = await h.recordIntegrationResult(
      buildP107RecordIntegrationCommand({
        commandId: "cmd-p107-integration-res-late", projectId: P107_PROJECT, expectedRevision: 0,
        result: {
          schemaVersion: 1, resultId: "res-late", projectId: P107_PROJECT, workspaceId: P107_WORKSPACE,
          goalId: P107_GOAL, taskId: P107_TASK_INTEGRATION, planRef: sc.planRef, taskRevision: 1,
          runRef, attemptRef: attInt, workspaceRevision: sc.workspaceRevision,
          inputs: [
            { sourceTaskId: P107_TASK_READER_A, sourceRunRef: runA, kind: "evidence", evidenceRef: evA, artifactRef: null, handoffPacketRef: null },
            { sourceTaskId: P107_TASK_READER_B, sourceRunRef: runB, kind: "evidence", evidenceRef: evB, artifactRef: null, handoffPacketRef: null },
          ],
          conflicts: [], gaps: [], explanation: "A later, DIFFERENT explanation", escalate: false, generatedAt: P107_SCHEMA,
        },
      }),
    );
    expect(late.status).toBe("rejected");
    if (late.status === "rejected") expect(late.code).toBe("conflict_duplicate");

    // escalate without any conflict -> invalid (validation).
    const badEsc = await h.recordIntegrationResult(
      buildP107RecordIntegrationCommand({
        commandId: "cmd-p107-integration-res-bad-esc", projectId: P107_PROJECT, expectedRevision: 0,
        result: {
          schemaVersion: 1, resultId: "res-bad-esc", projectId: P107_PROJECT, workspaceId: P107_WORKSPACE,
          goalId: P107_GOAL, taskId: P107_TASK_INTEGRATION, planRef: sc.planRef, taskRevision: 1,
          runRef, attemptRef: attInt, workspaceRevision: sc.workspaceRevision,
          inputs: [{ sourceTaskId: P107_TASK_READER_A, sourceRunRef: runA, kind: "evidence", evidenceRef: evA, artifactRef: null, handoffPacketRef: null }],
          conflicts: [], gaps: [], explanation: null, escalate: true, generatedAt: P107_SCHEMA,
        },
      }),
    );
    expect(badEsc.status).toBe("rejected");
    if (badEsc.status === "rejected") expect(badEsc.code).toBe("invalid");
  });

  it("no-conflict join commits cleanly and a second join appends (accumulator CAS)", async () => {
    const { h, sc } = await freshHarness();
    const { runA } = await makeReaderEvidence(h, sc, "ev-acc", "PASS", "PASS");
    const runRef = runA;

    const first = await h.recordIntegrationResult(
      buildP107RecordIntegrationCommand({
        commandId: "cmd-p107-integration-res-first", projectId: P107_PROJECT, expectedRevision: 0,
        result: {
          schemaVersion: 1, resultId: "res-first", projectId: P107_PROJECT, workspaceId: P107_WORKSPACE,
          goalId: P107_GOAL, taskId: P107_TASK_INTEGRATION, planRef: sc.planRef, taskRevision: 1,
          runRef, attemptRef: attInt, workspaceRevision: sc.workspaceRevision,
          inputs: [{ sourceTaskId: P107_TASK_READER_A, sourceRunRef: runA, kind: "evidence", evidenceRef: { aggregateType: "Evidence" as const, projectId: P107_PROJECT, evidenceId: "ev-acc-a" }, artifactRef: null, handoffPacketRef: null }],
          conflicts: [], gaps: [], explanation: null, escalate: false, generatedAt: P107_SCHEMA,
        },
      }),
    );
    expect(first.status).toBe("committed");

    const second = await h.recordIntegrationResult(
      buildP107RecordIntegrationCommand({
        commandId: "cmd-p107-integration-res-second", projectId: P107_PROJECT, expectedRevision: 0,
        result: {
          schemaVersion: 1, resultId: "res-second", projectId: P107_PROJECT, workspaceId: P107_WORKSPACE,
          goalId: P107_GOAL, taskId: P107_TASK_INTEGRATION, planRef: sc.planRef, taskRevision: 1,
          runRef, attemptRef: attInt, workspaceRevision: sc.workspaceRevision,
          inputs: [{ sourceTaskId: P107_TASK_READER_A, sourceRunRef: runA, kind: "evidence", evidenceRef: { aggregateType: "Evidence" as const, projectId: P107_PROJECT, evidenceId: "ev-acc-a" }, artifactRef: null, handoffPacketRef: null }],
          conflicts: [], gaps: [], explanation: null, escalate: false, generatedAt: P107_SCHEMA,
        },
      }),
    );
    expect(second.status).toBe("committed");

    const agg = await h.ledger.load(integrationResultRefFor(P107_PROJECT, P107_GOAL, P107_TASK_INTEGRATION));
    expect(agg.status).toBe("found");
    if (agg.status === "found") {
      const snap = agg.snapshot as { revision: number; records: unknown[] };
      expect(snap.records).toHaveLength(2);
      expect(snap.revision).toBe(2);
    }
  });

  it("guards: run_not_found / run_not_ended / stale_source (workspace + plan)", async () => {
    const { h, sc } = await freshHarness();
    const { runA } = await makeReaderEvidence(h, sc, "ev-g", "PASS", "PASS");
    const runRef = runA;

    // run_not_found: a run that was never claimed.
    const notFound = await h.recordIntegrationResult(
      buildP107RecordIntegrationCommand({
        commandId: "cmd-p107-integration-res-nf", projectId: P107_PROJECT, expectedRevision: 0,
        result: {
          schemaVersion: 1, resultId: "res-nf", projectId: P107_PROJECT, workspaceId: P107_WORKSPACE,
          goalId: P107_GOAL, taskId: P107_TASK_INTEGRATION, planRef: sc.planRef, taskRevision: 1,
          runRef: { aggregateType: "Run" as const, projectId: P107_PROJECT, goalId: P107_GOAL, runId: "run-nope" },
          attemptRef: attInt, workspaceRevision: sc.workspaceRevision,
          inputs: [], conflicts: [], gaps: [], explanation: null, escalate: false, generatedAt: P107_SCHEMA,
        },
      }),
    );
    expect(notFound.status).toBe("rejected");
    if (notFound.status === "rejected") expect(notFound.code).toBe("run_not_found");

    // stale_source (workspace revision mismatch).
    const staleWs = await h.recordIntegrationResult(
      buildP107RecordIntegrationCommand({
        commandId: "cmd-p107-integration-res-sw", projectId: P107_PROJECT, expectedRevision: 0,
        result: {
          schemaVersion: 1, resultId: "res-sw", projectId: P107_PROJECT, workspaceId: P107_WORKSPACE,
          goalId: P107_GOAL, taskId: P107_TASK_INTEGRATION, planRef: sc.planRef, taskRevision: 1,
          runRef, attemptRef: attInt, workspaceRevision: sc.workspaceRevision + 1,
          inputs: [], conflicts: [], gaps: [], explanation: null, escalate: false, generatedAt: P107_SCHEMA,
        },
      }),
    );
    expect(staleWs.status).toBe("rejected");
    if (staleWs.status === "rejected") expect(staleWs.code).toBe("stale_source");

    // stale_source (taskRevision mismatch).
    const stalePlan = await h.recordIntegrationResult(
      buildP107RecordIntegrationCommand({
        commandId: "cmd-p107-integration-res-sp", projectId: P107_PROJECT, expectedRevision: 0,
        result: {
          schemaVersion: 1, resultId: "res-sp", projectId: P107_PROJECT, workspaceId: P107_WORKSPACE,
          goalId: P107_GOAL, taskId: P107_TASK_INTEGRATION, planRef: sc.planRef, taskRevision: 2,
          runRef, attemptRef: attInt, workspaceRevision: sc.workspaceRevision,
          inputs: [], conflicts: [], gaps: [], explanation: null, escalate: false, generatedAt: P107_SCHEMA,
        },
      }),
    );
    expect(stalePlan.status).toBe("rejected");
    if (stalePlan.status === "rejected") expect(stalePlan.code).toBe("stale_source");
  });

  it("run_not_ended: a claimed-but-ungated run is rejected", async () => {
    const { h, sc } = await freshHarness();
    // Claim a reader but DO NOT drive it: the run stays at status "starting".
    await claimP107Task(h, {
      taskId: P107_TASK_READER_A, runId: "run-ne", attemptId: "att-ne",
      roleBinding: P107_ROLE_BINDING_READER_V1, declaredPermissions: P107_DECLARED_READ_PERMISSIONS_V1, budget: P107_BUDGET_READER_V1,
    });
    const notEnded = await h.recordIntegrationResult(
      buildP107RecordIntegrationCommand({
        commandId: "cmd-p107-integration-res-ne", projectId: P107_PROJECT, expectedRevision: 0,
        result: {
          schemaVersion: 1, resultId: "res-ne", projectId: P107_PROJECT, workspaceId: P107_WORKSPACE,
          goalId: P107_GOAL, taskId: P107_TASK_INTEGRATION, planRef: sc.planRef, taskRevision: 1,
          runRef: { aggregateType: "Run" as const, projectId: P107_PROJECT, goalId: P107_GOAL, runId: "run-ne" },
          attemptRef: attInt, workspaceRevision: sc.workspaceRevision,
          inputs: [], conflicts: [], gaps: [], explanation: null, escalate: false, generatedAt: P107_SCHEMA,
        },
      }),
    );
    expect(notEnded.status).toBe("rejected");
    if (notEnded.status === "rejected") expect(notEnded.code).toBe("run_not_ended");
  });

  it("guards: input_not_found / input_run_mismatch / input_not_accepted", async () => {
    const { h, sc } = await freshHarness();
    const { runA, runB, evA, evB } = await makeReaderEvidence(h, sc, "ev-in", "PASS", "FAIL");
    const runRef = runA;
    void evA;
    void evB;

    // input_not_found: evidence ref that was never admitted.
    const nf = await h.recordIntegrationResult(
      buildP107RecordIntegrationCommand({
        commandId: "cmd-p107-integration-res-inf", projectId: P107_PROJECT, expectedRevision: 0,
        result: {
          schemaVersion: 1, resultId: "res-inf", projectId: P107_PROJECT, workspaceId: P107_WORKSPACE,
          goalId: P107_GOAL, taskId: P107_TASK_INTEGRATION, planRef: sc.planRef, taskRevision: 1,
          runRef, attemptRef: attInt, workspaceRevision: sc.workspaceRevision,
          inputs: [{ sourceTaskId: P107_TASK_READER_A, sourceRunRef: runA, kind: "evidence", evidenceRef: { aggregateType: "Evidence" as const, projectId: P107_PROJECT, evidenceId: "ev-missing" }, artifactRef: null, handoffPacketRef: null }],
          conflicts: [], gaps: [], explanation: null, escalate: false, generatedAt: P107_SCHEMA,
        },
      }),
    );
    expect(nf.status).toBe("rejected");
    if (nf.status === "rejected") expect(nf.code).toBe("input_not_found");

    // input_run_mismatch: evidence's source runRef differs from the declared one.
    const mismatch = await h.recordIntegrationResult(
      buildP107RecordIntegrationCommand({
        commandId: "cmd-p107-integration-res-irm", projectId: P107_PROJECT, expectedRevision: 0,
        result: {
          schemaVersion: 1, resultId: "res-irm", projectId: P107_PROJECT, workspaceId: P107_WORKSPACE,
          goalId: P107_GOAL, taskId: P107_TASK_INTEGRATION, planRef: sc.planRef, taskRevision: 1,
          runRef, attemptRef: attInt, workspaceRevision: sc.workspaceRevision,
          inputs: [{ sourceTaskId: P107_TASK_READER_A, sourceRunRef: runB, kind: "evidence", evidenceRef: { aggregateType: "Evidence" as const, projectId: P107_PROJECT, evidenceId: "ev-in-a" }, artifactRef: null, handoffPacketRef: null }],
          conflicts: [], gaps: [], explanation: null, escalate: false, generatedAt: P107_SCHEMA,
        },
      }),
    );
    expect(mismatch.status).toBe("rejected");
    if (mismatch.status === "rejected") expect(mismatch.code).toBe("input_run_mismatch");

    // input_not_accepted: evidence was produced under a STALE anchor.
    const staleAnchor = readerAnchor(sc, sc.workspaceRevision + 1);
    await submitP107Evidence(h, {
      evidenceId: "ev-stale", taskId: P107_TASK_READER_B, outcome: "PASS", runRef: runB,
      coverage: [{ obligationId: P107_OBL_READERS, requirementId: P107_VR_READERS }], anchor: staleAnchor,
    });
    const notAccepted = await h.recordIntegrationResult(
      buildP107RecordIntegrationCommand({
        commandId: "cmd-p107-integration-res-na", projectId: P107_PROJECT, expectedRevision: 0,
        result: {
          schemaVersion: 1, resultId: "res-na", projectId: P107_PROJECT, workspaceId: P107_WORKSPACE,
          goalId: P107_GOAL, taskId: P107_TASK_INTEGRATION, planRef: sc.planRef, taskRevision: 1,
          runRef, attemptRef: attInt, workspaceRevision: sc.workspaceRevision,
          inputs: [{ sourceTaskId: P107_TASK_READER_B, sourceRunRef: runB, kind: "evidence", evidenceRef: { aggregateType: "Evidence" as const, projectId: P107_PROJECT, evidenceId: "ev-stale" }, artifactRef: null, handoffPacketRef: null }],
          conflicts: [], gaps: [], explanation: null, escalate: false, generatedAt: P107_SCHEMA,
        },
      }),
    );
    expect(notAccepted.status).toBe("rejected");
    if (notAccepted.status === "rejected") expect(notAccepted.code).toBe("input_not_accepted");
  });

  it("invalid shape command -> invalid", async () => {
    const { h, sc } = await freshHarness();
    const { runA } = await makeReaderEvidence(h, sc, "ev-inv", "PASS", "PASS");
    const runRef = runA;
    const cmd = buildP107RecordIntegrationCommand({
      commandId: "cmd-p107-integration-res-inv", projectId: P107_PROJECT, expectedRevision: 0,
      result: {
        schemaVersion: 1, resultId: "res-inv", projectId: P107_PROJECT, workspaceId: P107_WORKSPACE,
        goalId: P107_GOAL, taskId: P107_TASK_INTEGRATION, planRef: sc.planRef, taskRevision: 1,
        runRef, attemptRef: attInt, workspaceRevision: sc.workspaceRevision,
        inputs: [], conflicts: [], gaps: [], explanation: null, escalate: false, generatedAt: P107_SCHEMA,
      },
    });
    (cmd.payload.result as Record<string, unknown>)["schemaVersion"] = 99;
    const res = await h.recordIntegrationResult(cmd);
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") expect(res.code).toBe("invalid");
  });
});