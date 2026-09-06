/**
 * Shared P1-08 contract-suite harness contract: two-project isolation scenario
 * + console query helpers, used by BOTH adapter suites (InMemory + SQLite,
 * same fixtures) and by the restart path.
 *
 * The helper surface below is FROZEN by the shared baseline: the lanes fill
 * the console projections (A: portfolio/summary; B: matrix/agents/evidence/
 * timeline); the helpers only call frozen signatures and stay unchanged.
 *
 * Isolation statement: BOTH projects reuse the SAME local workspaceId
 * ("ws-shared") and the SAME local goalId ("goal-p108-1") with DIFFERENT
 * objectives; local run/attempt/evidence ids are deliberately reused across
 * projects as well — every console scope key is the canonicalJson of the
 * COMPLETE ref, so a cross-project read is a hard assertion failure.
 */
import { expect } from "vitest";
import type { P1_07HarnessLike, P1_07TestHarness } from "./p1-07-harness.js";
import type {
  PortfolioViewQuery,
  PortfolioViewResult,
  WorkspaceSummaryViewQuery,
  WorkspaceSummaryViewResult,
  PlanMatrixViewQuery,
  PlanMatrixViewResult,
  ActiveAgentsViewQuery,
  ActiveAgentsViewResult,
  TaskEvidenceViewQuery,
  TaskEvidenceViewResult,
  TimelineViewQuery,
  TimelineViewResult,
} from "../../src/contracts/console-views.js";
import {
  P108_PROJECT_A,
  P108_PROJECT_B,
  P108_WORKSPACE,
  P108_GOAL,
  P108_TASK_WORK,
  P108_TASK_GATE,
  P108_TASK_EXTRA,
  P108_OBL_WORK,
  P108_VR_WORK,
  P108_OBL_GATE,
  P108_VR_GATE,
  P108_SCHEMA,
  buildP108CreateGoalCommand,
  buildP108ApplyPlanCommand,
  buildP108ClaimCommand,
  buildP108EvidenceCommand,
  buildP108ReduceTaskCommand,
  buildP108ReduceGoalCommand,
  buildP108RecordHandoffCommand,
  buildP108ClaimReplacementCommand,
  buildP108OutcomeUnknownCommand,
  P108_RUNTIME_SCRIPT_COMPLETED_V1,
  P108_RUNTIME_SCRIPT_START_ONLY_V1,
  p108PlanRef,
  p108WorkspaceKey,
  p108GoalKey,
  p108TaskKey,
  type P108AnchorPins,
} from "../../src/contracts/fixtures/console-fixtures.js";
import {
  P107_ROLE_BINDING_WRITER_V1,
  P107_BUDGET_WRITER_V1,
  P107_DECLARED_WRITE_PERMISSIONS_V1,
  P107_ROLE_BINDING_READER_V1,
  P107_BUDGET_READER_V1,
  P107_DECLARED_READ_PERMISSIONS_V1,
  P107_PROJECT,
} from "../../src/contracts/fixtures/workspace-fixtures.js";
import {
  completionPolicyPinFor,
  architectureBaselinePinFor,
  buildInstallCommand,
  buildActivateCommand,
  COMPLETION_POLICY_FIXTURE_V1,
  ARCHITECTURE_BASELINE_FIXTURE_V1,
} from "../../src/contracts/fixtures/governance-fixtures.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1 } from "../../src/contracts/fixtures/bootstrap-fixture-v1.js";
import { taskAttemptRefFor, runRefFor } from "../../src/contracts/dispatch.js";
import type { RunRef } from "../../src/contracts/dispatch.js";
import { handoffPacketRefFor } from "../../src/contracts/handoff.js";
import type { FakeRuntimeScriptV1 } from "../../src/contracts/fixtures/dispatch-fixtures.js";
import { buildEffectivityAnchorV1, buildEvidenceV1, buildSubmitEvidenceCommand } from "../../src/contracts/fixtures/evidence-fixtures.js";
import type { EvidenceOutcome } from "../../src/contracts/evidence.js";
import { FAKE_RUNTIME_SCRIPT_COMPLETED_V1 } from "../../src/contracts/fixtures/dispatch-fixtures.js";
import { FakeRuntimeAdapter } from "../../src/runtime/fake-runtime-adapter.js";
import type { RunCapabilities, RunHandle, RunPort } from "../../src/contracts/ports.js";
import type { TaskEnvelopeV1 } from "../../src/contracts/task-envelope.js";

export interface P1_08TestHarness extends P1_07TestHarness {
  consolePortfolio(query: PortfolioViewQuery): Promise<PortfolioViewResult>;
  consoleSummary(query: WorkspaceSummaryViewQuery): Promise<WorkspaceSummaryViewResult>;
  consolePlanMatrix(query: PlanMatrixViewQuery): Promise<PlanMatrixViewResult>;
  consoleActiveAgents(query: ActiveAgentsViewQuery): Promise<ActiveAgentsViewResult>;
  consoleTaskEvidence(query: TaskEvidenceViewQuery): Promise<TaskEvidenceViewResult>;
  consoleTimeline(query: TimelineViewQuery): Promise<TimelineViewResult>;
}

export type P1_08HarnessLike = P1_07HarnessLike & {
  consolePortfolio: (query: PortfolioViewQuery) => Promise<PortfolioViewResult>;
  consoleSummary: (query: WorkspaceSummaryViewQuery) => Promise<WorkspaceSummaryViewResult>;
  consolePlanMatrix: (query: PlanMatrixViewQuery) => Promise<PlanMatrixViewResult>;
  consoleActiveAgents: (query: ActiveAgentsViewQuery) => Promise<ActiveAgentsViewResult>;
  consoleTaskEvidence: (query: TaskEvidenceViewQuery) => Promise<TaskEvidenceViewResult>;
  consoleTimeline: (query: TimelineViewQuery) => Promise<TimelineViewResult>;
};

export function toP1_08Harness(h: P1_08HarnessLike): P1_08TestHarness {
  return h as unknown as P1_08TestHarness;
}
// ------------------------------------------------------------------------ //
// Script-selecting runtime (per-run scripts; deterministic scenario wiring) //
// ------------------------------------------------------------------------ //

/** RunPort that selects the FakeRuntime script per runId (default COMPLETED). */
export class P108ScenarioRuntime implements RunPort {
  private readonly scripts = new Map<string, FakeRuntimeScriptV1>();

  setScript(runId: string, script: FakeRuntimeScriptV1): void {
    this.scripts.set(runId, script);
  }

  capabilities(): Promise<RunCapabilities> {
    return Promise.resolve({ replayable: true, supportsSnapshot: false, maxEnvelopeBytes: 64 * 1024 });
  }

  async start(envelope: TaskEnvelopeV1): Promise<RunHandle> {
    const script = this.scripts.get(envelope.runRef.runId) ?? FAKE_RUNTIME_SCRIPT_COMPLETED_V1;
    return new FakeRuntimeAdapter(script).start(envelope);
  }
}

export function createP108ScenarioRuntime(): P108ScenarioRuntime {
  return new P108ScenarioRuntime();
}

/** Set the per-run script through a (possibly wrapped) scenario runtime. */
export function p108SetScript(h: P1_08HarnessLike, runId: string, script: FakeRuntimeScriptV1): void {
  const maybe = h.runtime as RunPort & { setScript?: (runId: string, script: FakeRuntimeScriptV1) => void };
  if (maybe.setScript === undefined) {
    throw new Error("P1-08 harness runtime has no setScript — use createP108ScenarioRuntime()");
  }
  maybe.setScript(runId, script);
}


/** Shared local ids reused ACROSS projects (isolation must still hold). */
export const P108_EVIDENCE_WORK = "ev-p108-work";
export const P108_EVIDENCE_GATE = "ev-p108-gate";
export const P108_EVIDENCE_CLAIM = "ev-p108-claim";

/** Short per-project run-id prefix matching the frozen scenario literals. */
function p108RunPrefix(project: string): string {
  return project === P108_PROJECT_A ? "a" : "b";
}

export function p108RunOfWork(project: string): string {
  return "run-p108-" + p108RunPrefix(project) + "-work";
}

export function p108RunOfExtra(project: string, generation: 1 | 2 = 1): string {
  return "run-p108-" + p108RunPrefix(project) + "-extra" + (generation === 2 ? "-b" : "");
}

export async function p108Advance(h: P1_08HarnessLike): Promise<void> {
  await h.advanceProjection();
}

// ------------------------------------------------------------------------ //
// Per-project preparation (governance + goal + plan)                        //
// ------------------------------------------------------------------------ //

export type P108ProjectPreview = {
  projectId: string;
  workspaceId: string;
  goalId: string;
  pins: P108AnchorPins;
  planRef: ReturnType<typeof p108PlanRef>;
};

/** Bootstrap the two-project fixture once, then per project: install+activate
 * governance, create the SAME goalId with a DIFFERENT objective, accept the
 * SAME plan. Returns per-project previews (pins from the REAL receipts). */
export async function prepareP108Scenario(h: P1_08HarnessLike): Promise<P108ProjectPreview[]> {
  const boot = await h.bootstrap(
    buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
      commandId: "cmd-p108-boot",
      correlationId: "corr-p108-boot",
      submittedAt: P108_SCHEMA,
    }),
  );
  expect(boot.status).toBe("committed");

  const previews: P108ProjectPreview[] = [];
  for (const project of [P108_PROJECT_A, P108_PROJECT_B]) {
    const installPolicy = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, {
      commandId: "cmd-p108-install-policy-" + project,
      correlationId: "corr-p108-install-policy-" + project,
      submittedAt: P108_SCHEMA,
      projectId: project,
      idempotencyKey: "p1-08-install-policy-" + project,
    });
    const installBaseline = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, {
      commandId: "cmd-p108-install-baseline-" + project,
      correlationId: "corr-p108-install-baseline-" + project,
      submittedAt: P108_SCHEMA,
      projectId: project,
      idempotencyKey: "p1-08-install-baseline-" + project,
    });
    expect((await h.install(installPolicy)).status).toBe("committed");
    expect((await h.install(installBaseline)).status).toBe("committed");

    const actPolicy = buildActivateCommand(completionPolicyPinFor(installPolicy as never), {
      commandId: "cmd-p108-activate-policy-" + project,
      correlationId: "corr-p108-activate-policy-" + project,
      submittedAt: P108_SCHEMA,
      projectId: project,
      expectedRevision: 1,
      idempotencyKey: "p1-08-activate-policy-" + project,
    });
    const actBaseline = buildActivateCommand(architectureBaselinePinFor(installBaseline as never), {
      commandId: "cmd-p108-activate-baseline-" + project,
      correlationId: "corr-p108-activate-baseline-" + project,
      submittedAt: P108_SCHEMA,
      projectId: project,
      expectedRevision: 1,
      idempotencyKey: "p1-08-activate-baseline-" + project,
    });
    expect((await h.activate(actPolicy)).status).toBe("committed");
    expect((await h.activate(actBaseline)).status).toBe("committed");

    const goal = await h.control.submit(buildP108CreateGoalCommand(project));
    expect(goal.status).toBe("committed");

    const plan = await h.applyPlan(buildP108ApplyPlanCommand(project));
    expect(plan.status).toBe("committed");

    previews.push({
      projectId: project,
      workspaceId: P108_WORKSPACE,
      goalId: P108_GOAL,
      pins: {
        completionPolicy: completionPolicyPinFor(installPolicy as never),
        architectureBaseline: architectureBaselinePinFor(installBaseline as never),
      },
      planRef: p108PlanRef(project),
    });
  }
  return previews;
}

// ------------------------------------------------------------------------ //
// Scenario steps (called from the frozen runP108TwoProjectScenario)        //
// ------------------------------------------------------------------------ //

export async function claimP108Task(
  h: P1_08HarnessLike,
  project: string,
  taskId: string,
  runId: string,
): Promise<RunRef> {
  const claim = await h.claimTask(
    buildP108ClaimCommand(
      project,
      runId,
      taskId,
      P107_ROLE_BINDING_WRITER_V1,
      P107_DECLARED_WRITE_PERMISSIONS_V1,
      P107_BUDGET_WRITER_V1,
    ),
  );
  expect(claim.status).toBe("committed");
  return runRefFor(project, P108_GOAL, runId);
}

/** Claim + drive (runtime script); the run facts are ingested by the drive. */
export async function runP108Task(
  h: P1_08HarnessLike,
  project: string,
  taskId: string,
  runId: string,
  script: FakeRuntimeScriptV1 = P108_RUNTIME_SCRIPT_COMPLETED_V1,
): Promise<RunRef> {
  p108SetScript(h, runId, script);
  const runRef = await claimP108Task(h, project, taskId, runId);
  const drive = await h.drive({ reason: "p1-08 run " + project + "/" + taskId, maxIntents: 8 });
  expect(drive.failures).toHaveLength(0);
  return runRef;
}

export type P108EvidenceInput = {
  project: string;
  taskId: string;
  evidenceId: string;
  obligationId: string;
  requirementId: string;
  runRef: RunRef | null;
  outcome?: EvidenceOutcome;
  kind?: "claim" | "observation" | "verdict";
  pins: P108AnchorPins;
};

export async function submitP108Evidence(h: P1_08HarnessLike, deps: P108EvidenceInput): Promise<void> {
  const submitted = await h.submitEvidence(
    buildP108EvidenceCommand({
      project: deps.project,
      evidenceId: deps.evidenceId,
      taskId: deps.taskId,
      obligationId: deps.obligationId,
      requirementId: deps.requirementId,
      runRef: deps.runRef,
      outcome: deps.outcome ?? "PASS",
      kind: deps.kind ?? "observation",
      pins: deps.pins,
    }),
  );
  expect(submitted.status).toBe("committed");
}

export async function reduceP108Task(h: P1_08HarnessLike, project: string, taskId: string, expectedRevision = 0): Promise<void> {
  const reduced = await h.reduceTask(buildP108ReduceTaskCommand(project, taskId, expectedRevision));
  expect(reduced.status).toBe("committed");
}

export async function reduceP108Goal(h: P1_08HarnessLike, project: string, expectedRevision = 0): Promise<import("../../src/contracts/goal-phase.js").ReduceGoalReceipt> {
  return h.reduceGoal(buildP108ReduceGoalCommand(project, expectedRevision));
}

// ------------------------------------------------------------------------ //
// FULL two-project scenario (used by the suite + the restart probe)        //
// ------------------------------------------------------------------------ //

export type P108TwoProjectScenarioResult = {
  previews: P108ProjectPreview[];
  projectA: {
    workRun: RunRef;
    extraRun: RunRef;
    extraReplacementRun: RunRef;
    packetRef: import("../../src/contracts/handoff.js").HandoffPacketRef;
    goalPhase: string;
  };
  projectB: {
    workRun: RunRef;
    extraRun: RunRef;
    extraOutcomeUnknown: boolean;
    goalPhase: string | null;
  };
};

/**
 * Full two-project console scenario:
 *  A = work completed + evidence satisfied + handoff + replacement (B run
 *      ongoing) + optional extra completed + gate satisfied + goal COMPLETED;
 *  B = work completed + evidence satisfied + extra outcome_unknown (never
 *      disguised) + gate satisfied + goal NOT COMPLETED (unreconciled side effect).
 * Local workspaceId/goalId/run/evidence ids are REUSED across projects.
 */
export async function runP108TwoProjectScenario(h: P1_08HarnessLike): Promise<P108TwoProjectScenarioResult> {
  const previews = await prepareP108Scenario(h);
  const a = previews.find((p) => p.projectId === P108_PROJECT_A)!;
  const b = previews.find((p) => p.projectId === P108_PROJECT_B)!;

  // ---- Project A: work completed + satisfied + handoff + replacement (ongoing) ----
  const aWorkRun = await runP108Task(h, P108_PROJECT_A, P108_TASK_WORK, "run-p108-a-work");
  await submitP108Evidence(h, {
    project: P108_PROJECT_A, taskId: P108_TASK_WORK, evidenceId: P108_EVIDENCE_CLAIM,
    obligationId: P108_OBL_WORK, requirementId: P108_VR_WORK, runRef: aWorkRun,
    outcome: "INCONCLUSIVE", kind: "claim", pins: a.pins,
  });
  await submitP108Evidence(h, {
    project: P108_PROJECT_A, taskId: P108_TASK_WORK, evidenceId: P108_EVIDENCE_WORK,
    obligationId: P108_OBL_WORK, requirementId: P108_VR_WORK, runRef: aWorkRun,
    pins: a.pins,
  });
  await reduceP108Task(h, P108_PROJECT_A, P108_TASK_WORK);

  // extra task: completed run -> handoff -> replacement (ongoing run).
  const aExtraRun = await runP108Task(h, P108_PROJECT_A, P108_TASK_EXTRA, "run-p108-a-extra");
  const aPacketId = "packet-p108-a-extra";
  const aPacketRef = handoffPacketRefFor(P108_PROJECT_A, P108_GOAL, P108_TASK_EXTRA, aPacketId);
  const packet = await h.recordHandoff(
    buildP108RecordHandoffCommand({
      project: P108_PROJECT_A,
      packetId: aPacketId,
      taskId: P108_TASK_EXTRA,
      runRef: aExtraRun,
      attemptRef: taskAttemptRefFor(P108_PROJECT_A, P108_GOAL, P108_TASK_EXTRA, "att-run-p108-a-extra"),
      planRef: a.planRef,
      taskRevision: 1,
      terminalOutcome: "completed",
      roleBinding: P107_ROLE_BINDING_WRITER_V1,
    }),
  );
  expect(packet.status).toBe("committed");
  p108SetScript(h, "run-p108-a-extra-b", P108_RUNTIME_SCRIPT_START_ONLY_V1);
  const replacement = await h.claimReplacement(
    buildP108ClaimReplacementCommand({
      project: P108_PROJECT_A,
      runId: "run-p108-a-extra-b",
      taskId: P108_TASK_EXTRA,
      priorRunRef: aExtraRun,
      packetRef: aPacketRef,
      reason: "run_ended",
      expectedRevision: 1,
      roleBinding: P107_ROLE_BINDING_WRITER_V1,
      declaredPermissions: P107_DECLARED_WRITE_PERMISSIONS_V1,
      budget: P107_BUDGET_WRITER_V1,
    }),
  );
  expect(replacement.status).toBe("committed");
  // Replacement intents belong to the HandoffPort (P1-06): the normal drive
  // skips them, so the replacement run is really started via driveHandoff
  // (RunStarted + run facts — the console shows a genuinely RUNNING run).
  const handoffDrive = await h.handoffDrive.driveHandoff({
    reason: "p1-08 replacement ongoing " + P108_PROJECT_A,
    maxIntents: 4,
  });
  expect(handoffDrive.failures).toHaveLength(0);
  expect(handoffDrive.started).toBeGreaterThan(0);
  await reduceP108Task(h, P108_PROJECT_A, P108_TASK_EXTRA);

  // gate: system evidence (no run) + reduction + goal phase.
  await submitP108Evidence(h, {
    project: P108_PROJECT_A, taskId: P108_TASK_GATE, evidenceId: P108_EVIDENCE_GATE,
    obligationId: P108_OBL_GATE, requirementId: P108_VR_GATE, runRef: null,
    kind: "observation", pins: a.pins,
  });
  await reduceP108Task(h, P108_PROJECT_A, P108_TASK_GATE);
  const aGoalReduce = await reduceP108Goal(h, P108_PROJECT_A);
  expect(aGoalReduce.status).toBe("committed");
  const aPhase = aGoalReduce.status === "committed" ? aGoalReduce.phase : "UNKNOWN";

  // ---- Project B: work satisfied + extra outcome_unknown ----
  const bWorkRun = await runP108Task(h, P108_PROJECT_B, P108_TASK_WORK, "run-p108-b-work");
  await submitP108Evidence(h, {
    project: P108_PROJECT_B, taskId: P108_TASK_WORK, evidenceId: P108_EVIDENCE_WORK,
    obligationId: P108_OBL_WORK, requirementId: P108_VR_WORK, runRef: bWorkRun,
    pins: b.pins,
  });
  await reduceP108Task(h, P108_PROJECT_B, P108_TASK_WORK);

  const bExtraRun = await runP108Task(h, P108_PROJECT_B, P108_TASK_EXTRA, "run-p108-b-extra", P108_RUNTIME_SCRIPT_START_ONLY_V1);
  // Explicit no-terminal-signal fact (never inferred; never auto-retried).
  // The CAS window is the CURRENT Run revision (read as a fact, never guessed).
  const runLoad = await h.ledger.load({ aggregateType: "Run", projectId: P108_PROJECT_B, goalId: P108_GOAL, runId: "run-p108-b-extra" });
  expect(runLoad.status).toBe("found");
  const runRevision = runLoad.status === "found" ? (runLoad.snapshot as { revision: number }).revision : 0;
  const unknown = await h.runFact(
    buildP108OutcomeUnknownCommand(P108_PROJECT_B, "run-p108-b-extra", bExtraRun, runRevision),
  );
  expect(unknown.status).toBe("committed");
  await reduceP108Task(h, P108_PROJECT_B, P108_TASK_EXTRA);

  await submitP108Evidence(h, {
    project: P108_PROJECT_B, taskId: P108_TASK_GATE, evidenceId: P108_EVIDENCE_GATE,
    obligationId: P108_OBL_GATE, requirementId: P108_VR_GATE, runRef: null,
    kind: "observation", pins: b.pins,
  });
  await reduceP108Task(h, P108_PROJECT_B, P108_TASK_GATE);
  const bGoalReduce = await reduceP108Goal(h, P108_PROJECT_B);
  expect(bGoalReduce.status).toBe("committed");

  await p108Advance(h);

  return {
    previews,
    projectA: {
      workRun: aWorkRun,
      extraRun: aExtraRun,
      extraReplacementRun: runRefFor(P108_PROJECT_A, P108_GOAL, "run-p108-a-extra-b"),
      packetRef: aPacketRef,
      goalPhase: aPhase,
    },
    projectB: {
      workRun: bWorkRun,
      extraRun: bExtraRun,
      extraOutcomeUnknown: true,
      goalPhase: bGoalReduce.status === "committed" ? bGoalReduce.phase : null,
    },
  };
}

export { P107_ROLE_BINDING_WRITER_V1, P107_ROLE_BINDING_READER_V1, P107_BUDGET_WRITER_V1, P107_BUDGET_READER_V1, P107_DECLARED_WRITE_PERMISSIONS_V1, P107_DECLARED_READ_PERMISSIONS_V1, p108WorkspaceKey, p108GoalKey, p108TaskKey, P108_PROJECT_A, P108_PROJECT_B, P108_WORKSPACE, P108_GOAL, P108_TASK_WORK, P108_TASK_GATE, P108_TASK_EXTRA, P108_SCHEMA };
