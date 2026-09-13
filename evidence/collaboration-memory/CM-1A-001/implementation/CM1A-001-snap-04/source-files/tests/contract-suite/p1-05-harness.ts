/**
 * Shared P1-05 contract-suite harness contract: scenario preparation + helper
 * builders used by BOTH adapter suites (InMemory + SQLite, same fixtures).
 * Everything here is integrator-maintained shared baseline.
 */
import { expect } from "vitest";
import type { P1_04TestHarness } from "./p1-04-harness.js";
import type {
  ReduceGoalCommand,
  ReduceGoalReceipt,
  GoalReductionInput,
} from "../../src/contracts/goal-phase.js";
import type {
  GoalStatusQuery,
  GoalStatusViewResult,
  GoalTimelineQuery,
  GoalTimelineViewResult,
} from "../../src/contracts/goal-phase-view.js";
import type { ArtifactRef } from "../../src/contracts/artifact.js";
import { artifactBodyDigest } from "../../src/contracts/artifact.js";
import type { RunRef, TaskTriple } from "../../src/contracts/dispatch.js";
import { runRefFor, taskAttemptRefFor } from "../../src/contracts/dispatch.js";
import type { EffectivityAnchorV1, EvidenceCoverageV1, EvidenceV1 } from "../../src/contracts/evidence.js";
import type { PlanRevisionRef } from "../../src/contracts/plan.js";
import type { ArchitectureBaselinePin, CompletionPolicyPin } from "../../src/contracts/governance.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import {
  buildDispatchClaimCommand,
  buildDispatchStartCommand,
  buildManifestFixture,
  buildRunFactCommand,
  FAKE_RUNTIME_SCRIPT_COMPLETED_V1,
  rebaseScriptForRun,
} from "../../src/fixtures/dispatch-fixtures.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1 } from "../contract-support/fixtures/bootstrap-fixture-v1.js";
import {
  ARCHITECTURE_BASELINE_FIXTURE_V1,
  COMPLETION_POLICY_FIXTURE_V1,
  buildActivateCommand,
  buildInstallCommand,
} from "../../src/fixtures/governance-fixtures.js";
import { buildCreateGoalCommand } from "../contract-support/fixtures/goal-fixtures.js";
import { buildApplyPlanCommand } from "../../src/fixtures/plan-fixtures.js";

import {
  buildEffectivityAnchorV1,
  buildEvidenceV1,
  buildSubmitEvidenceCommand,
} from "../contract-support/fixtures/evidence-fixtures.js";
import {
  P105_GOAL,
  P105_PLAN_ID,
  P105_PLAN_REVISION_FIXTURE_V1,
  buildReduceGoalCommand,
} from "../contract-support/fixtures/goal-phase-fixtures.js";
import type { TaskVerificationViewQuery, TaskVerificationViewResult } from "../../src/contracts/verification-view.js";

export interface P1_05TestHarness extends P1_04TestHarness {
  reduceGoal(command: ReduceGoalCommand): Promise<ReduceGoalReceipt>;
  goalStatus(query: GoalStatusQuery): Promise<GoalStatusViewResult>;
  goalTimeline(query: GoalTimelineQuery): Promise<GoalTimelineViewResult>;
}

export type P1_05HarnessFactory = () => Promise<P1_05TestHarness>;

export type P1_05HarnessLike = import("./p1-04-harness.js").P1_04HarnessLike & {
  reduceGoal(command: ReduceGoalCommand): Promise<ReduceGoalReceipt>;
  goalStatus(query: GoalStatusQuery): Promise<GoalStatusViewResult>;
  goalTimeline(query: GoalTimelineQuery): Promise<GoalTimelineViewResult>;
};

export function toP1_05Harness(h: P1_05HarnessLike): P1_05TestHarness {
  return {
    ...h,
    submit: ((c: import("../../src/contracts/command-event.js").CreateGoalCommand) => h.control.submit(c)) as never,
  } as unknown as P1_05TestHarness;
}

export const SCHEMA = "2026-09-05T12:00:00.000Z";
export const P105_PROJECT = "proj-alpha";
export { P105_GOAL };

export type P105Preview = {
  projectId: string;
  goalId: string;
  planRef: PlanRevisionRef;
  completionPolicyPin: CompletionPolicyPin;
  architectureBaselinePin: ArchitectureBaselinePin;
};

export async function prepareP105Scenario(h: P1_05TestHarness): Promise<P105Preview> {
  const boot = await h.bootstrap(
    buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
      commandId: "cmd-p105-boot",
      correlationId: "corr-p105-boot",
      submittedAt: SCHEMA,
    }),
  );
  expect(boot.status).toBe("committed");
  const projectId = P105_PROJECT;
  const goalId = P105_GOAL;
  const cpCmd = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, {
    commandId: "cmd-p105-install-cp",
    correlationId: "corr-p105-install-cp",
    submittedAt: SCHEMA,
    projectId,
    idempotencyKey: "p105-install-cp",
  });
  expect((await h.install(cpCmd)).status).toBe("committed");
  const abCmd = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, {
    commandId: "cmd-p105-install-ab",
    correlationId: "corr-p105-install-ab",
    submittedAt: SCHEMA,
    projectId,
    idempotencyKey: "p105-install-ab",
  });
  expect((await h.install(abCmd)).status).toBe("committed");
  expect(
    (
      await h.activate(
        buildActivateCommand((await import("../../src/fixtures/governance-fixtures.js")).completionPolicyPinFor(cpCmd as never), {
          commandId: "cmd-p105-activate-cp",
          correlationId: "corr-p105-activate-cp",
          submittedAt: SCHEMA,
          projectId,
          expectedRevision: 1,
          idempotencyKey: "p105-activate-cp",
        }),
      )
    ).status,
  ).toBe("committed");
  expect(
    (
      await h.activate(
        buildActivateCommand((await import("../../src/fixtures/governance-fixtures.js")).architectureBaselinePinFor(abCmd as never), {
          commandId: "cmd-p105-activate-ab",
          correlationId: "corr-p105-activate-ab",
          submittedAt: SCHEMA,
          projectId,
          expectedRevision: 1,
          idempotencyKey: "p105-activate-ab",
        }),
      )
    ).status,
  ).toBe("committed");
  const goal = await h.submit(
    buildCreateGoalCommand(
      {
        projectId,
        workspaceId: "ws-shared",
        goalId,
        objective: "P1-05：required 集合确定性归约为 Goal phase",
        actor: { kind: "human", id: "user-1" },
      },
      {
        commandId: "cmd-p105-goal",
        correlationId: "corr-p105-goal",
        submittedAt: SCHEMA,
      },
    ),
  );
  expect(goal.status).toBe("committed");
  const plan = await h.applyPlan(
    buildApplyPlanCommand(P105_PLAN_REVISION_FIXTURE_V1, {
      commandId: "cmd-p105-plan",
      correlationId: "corr-p105-plan",
      submittedAt: SCHEMA,
      projectId,
      expectedRevision: 1,
    }),
  );
  expect(plan.status).toBe("committed");
  await h.advanceProjection();
  const graph = await h.planGraph({ projectId, goalId });
  expect(graph.status).toBe("ready");
  if (graph.status !== "ready") throw new Error("p105 plan graph not ready");
  return {
    projectId,
    goalId,
    planRef: { aggregateType: "PlanRevision", projectId, planId: P105_PLAN_ID },
    completionPolicyPin: graph.graph.pinnedCompletionPolicy,
    architectureBaselinePin: graph.graph.pinnedArchitectureBaseline,
  };
}

export function p105AnchorFor(sc: P105Preview, workspaceRevision = 1): EffectivityAnchorV1 {
  return buildEffectivityAnchorV1({
    planRef: { ...sc.planRef },
    planRevision: 1,
    workspaceRevision,
    pinnedCompletionPolicy: sc.completionPolicyPin,
    pinnedArchitectureBaseline: sc.architectureBaselinePin,
  });
}

export function reduceGoalCommand(sc: P105Preview, deps: {
  commandId: string;
  expectedRevision: number;
  idempotencyKey?: string;
  goalId?: string;
}): ReduceGoalCommand {
  return buildReduceGoalCommand({
    commandId: deps.commandId,
    correlationId: "corr-p105-reduce-goal",
    submittedAt: SCHEMA,
    expectedRevision: deps.expectedRevision,
    projectId: sc.projectId,
    goalId: deps.goalId ?? sc.goalId,
    idempotencyKey: deps.idempotencyKey ?? "p105-reduce-goal-" + deps.commandId,
  });
}

/** Claim -> start -> FakeRuntime(completed, exit=0) — the standard run path (goalId explicit). */
export async function runP105ClaimedRun(
  h: P1_05TestHarness,
  deps: { projectId: string; goalId: string; taskId: string; runId: string; attemptId: string; finished?: boolean },
): Promise<RunRef> {
  const { projectId, goalId, taskId, runId, attemptId } = deps;
  const runRef = runRefFor(projectId, goalId, runId);
  const claim = await h.claimTask(
    buildDispatchClaimCommand({
      commandId: "cmd-p105-claim-" + runId,
      correlationId: "corr-p105-claim-" + runId,
      submittedAt: SCHEMA,
      projectId,
      goalId,
      taskId,
      attemptId,
      runId,
      idempotencyKey: "p105-claim-" + runId,
    }),
  );
  expect(claim.status).toBe("committed");
  if (claim.status !== "committed") throw new Error("p105 claim failed");
  const planRef = { aggregateType: "PlanRevision" as const, projectId, planId: P105_PLAN_ID };
  const bundleRef: ArtifactRef = {
    kind: "artifact",
    contentType: "text/plain",
    digest: artifactBodyDigest("p105-bundle-" + runId),
    sizeBytes: artifactBodyDigest("p105-bundle-" + runId).length,
    source: { kind: "plan-revision", refId: planRef.planId, revision: "1" },
  };
  const envelope = {
    schemaVersion: 1 as const,
    envelopeId: "envelope-" + runId,
    projectId,
    workspaceId: "ws-shared",
    goalId,
    taskId,
    runRef,
    attemptRef: taskAttemptRefFor(projectId, goalId, taskId, attemptId),
    planRef,
    roleBinding: {
      schemaVersion: 1 as const,
      bindingId: "binding-run-short-lived-v1",
      templateId: "template-short-lived-runner",
      templateRevision: "2026-09-05",
      bindingVersion: 1,
      policyRevision: "auth-policy-runtime-v1",
    },
    workspaceSnapshot: { workspaceId: "ws-shared", revision: 1 },
    permissions: { policyRevision: "auth-policy-runtime-v1", tools: ["read", "write"], writeScope: ["src/contracts"] },
    budget: { tokenBudget: 100_000, deadline: "2026-09-06T00:00:00.000Z" },
    sourceRefs: [{ kind: "plan-revision" as const, refId: planRef.planId, revision: "1" }],
    bundleRef,
  };
  const start = await h.startRun(
    buildDispatchStartCommand({
      commandId: "cmd-p105-start-" + runId,
      correlationId: "corr-p105-start-" + runId,
      submittedAt: SCHEMA,
      projectId,
      runId,
      expectedRevision: 1,
      idempotencyKey: "p105-start-" + runId,
      envelope,
      manifest: buildManifestFixture({ workspaceId: "ws-shared", workspaceRevision: 1, planRef }),
    }),
  );
  expect(start.status).toBe("committed");
  if (start.status !== "committed") throw new Error("p105 start failed");
  if (deps.finished !== false) {
    const events = rebaseScriptForRun(FAKE_RUNTIME_SCRIPT_COMPLETED_V1, runRef);
    for (const [i, event] of events.entries()) {
      const fact = await h.runFact(
        buildRunFactCommand({
          commandId: "cmd-p105-fact-" + runId + "-" + i,
          correlationId: "corr-p105-fact-" + runId + "-" + i,
          submittedAt: SCHEMA,
          projectId,
          runId,
          expectedRevision: 2 + i,
          fact: { kind: "runtime_event", event },
        }),
      );
      expect(fact.status).toBe("committed");
    }
  }
  return runRef;
}

export function p105Evidence(sc: P105Preview, deps: {
  evidenceId: string;
  kind: "claim" | "observation" | "verdict";
  outcome: "PASS" | "FAIL" | "INCONCLUSIVE";
  taskId: string;
  coverage: EvidenceCoverageV1[];
  runRef?: RunRef | null;
  checkId?: string | null;
  actor?: { kind: "human" | "system"; id: string };
  workspaceRevision?: number;
}): EvidenceV1 {
  return buildEvidenceV1({
    evidenceId: deps.evidenceId,
    kind: deps.kind,
    outcome: deps.outcome,
    projectId: sc.projectId,
    goalId: sc.goalId,
    taskId: deps.taskId,
    coverage: deps.coverage,
    anchor: p105AnchorFor(sc, deps.workspaceRevision ?? 1),
    verificationPlanRef: { planId: "vp-p105-1", planDigest: "f".repeat(64) },
    ...(deps.runRef !== undefined ? { runRef: deps.runRef } : {}),
    ...(deps.checkId !== undefined ? { checkId: deps.checkId } : {}),
    ...(deps.actor !== undefined ? { actor: deps.actor } : {}),
  });
}

export async function submitP105Evidence(
  h: P1_05TestHarness,
  sc: P105Preview,
  deps: { commandId: string; evidence: EvidenceV1; idempotencyKey?: string },
): Promise<void> {
  const cmd = buildSubmitEvidenceCommand({
    commandId: deps.commandId,
    correlationId: "corr-p105-evidence-" + deps.commandId,
    submittedAt: SCHEMA,
    evidence: deps.evidence,
    actor: deps.evidence.source.actor,
    idempotencyKey: deps.idempotencyKey ?? "p105-ev-" + deps.evidence.evidenceId,
  });
  const receipt = await h.submitEvidence(cmd);
  expect(receipt.status).toBe("committed");
  if (receipt.status !== "committed") throw new Error("p105 evidence failed: " + JSON.stringify(receipt));
}

export function p105ReduceTaskCommand(sc: P105Preview, deps: {
  commandId: string;
  taskId: string;
  expectedRevision: number;
  idempotencyKey?: string;
}) {
  return {
    commandId: deps.commandId,
    commandType: "ReduceTask" as const,
    schemaVersion: 1 as const,
    identity: {
      projectId: sc.projectId,
      actor: { kind: "system" as const, id: "control-engine" },
      idempotencyKey: deps.idempotencyKey ?? "p105-reduce-" + deps.commandId,
    },
    aggregateId: deps.taskId,
    expectedRevision: deps.expectedRevision,
    correlationId: "corr-p105-reduce-" + deps.taskId,
    submittedAt: SCHEMA,
    payload: { goalId: sc.goalId },
  };
}

export function p105Coverage(obligationId: string, requirementId: string): EvidenceCoverageV1 {
  return { obligationId, requirementId };
}

// ------------------------------------------------------------------------ //
// Full-satisfaction path helper (shared by contract suite + restart path)    //
// ------------------------------------------------------------------------ //

/** Satisfy ALL required tasks/obligations (work run + module/stage/goal gate
 * PASS evidence). withUnknownSideEffect => the work run ends outcome_unknown
 * (unreconciled side effect — the reducer must NOT complete). */
export async function satisfyEverythingP105(
  h: P1_05TestHarness,
  sc: P105Preview,
  opts: { withUnknownSideEffect?: boolean } = {},
): Promise<{ workRun: RunRef }> {
  const SC = "2026-09-05T12:00:00.000Z";
  const workRun = await runP105ClaimedRun(h, {
    projectId: sc.projectId, goalId: sc.goalId, taskId: "task-work-105", runId: "run-p105-work", attemptId: "att-p105-work",
    finished: opts.withUnknownSideEffect !== true,
  });
  if (opts.withUnknownSideEffect === true) {
    const fact = await h.runFact(
      buildRunFactCommand({
        commandId: "cmd-p105-unknown",
        correlationId: "corr-p105-unknown",
        submittedAt: SC,
        projectId: sc.projectId,
        runId: "run-p105-work",
        expectedRevision: 2,
        fact: { kind: "outcome_unknown", runRef: workRun, reason: "no terminal signal observed" },
      }),
    );
    expect(fact.status).toBe("committed");
  }
  await submitP105Evidence(h, sc, {
    commandId: "cmd-p105-ev-work-s",
    evidence: p105Evidence(sc, {
      evidenceId: "ev-p105-work-s", kind: "observation", outcome: "PASS", taskId: "task-work-105",
      coverage: [{ obligationId: "obl-work-105", requirementId: "vr-work-105" }], runRef: workRun, checkId: "static-check-lint",
    }),
  });
  await submitP105Evidence(h, sc, {
    commandId: "cmd-p105-ev-work-d",
    evidence: p105Evidence(sc, {
      evidenceId: "ev-p105-work-d", kind: "observation", outcome: "PASS", taskId: "task-work-105",
      coverage: [{ obligationId: "obl-work-105", requirementId: "vr-work-105-dyn" }], runRef: workRun, checkId: "dynamic-check-tests",
    }),
  });
  await submitP105Evidence(h, sc, {
    commandId: "cmd-p105-ev-module",
    evidence: p105Evidence(sc, {
      evidenceId: "ev-p105-module", kind: "observation", outcome: "PASS", taskId: "gate-module-105",
      coverage: [{ obligationId: "obl-module-105", requirementId: "vr-module-105" }], runRef: null, checkId: "static-check-module",
      actor: { kind: "system", id: "verification-engine" },
    }),
  });
  await submitP105Evidence(h, sc, {
    commandId: "cmd-p105-ev-stage",
    evidence: p105Evidence(sc, {
      evidenceId: "ev-p105-stage", kind: "observation", outcome: "PASS", taskId: "gate-stage-105",
      coverage: [{ obligationId: "obl-stage-105", requirementId: "vr-stage-105" }], runRef: null, checkId: "static-check-stage",
      actor: { kind: "system", id: "verification-engine" },
    }),
  });
  await submitP105Evidence(h, sc, {
    commandId: "cmd-p105-ev-goal",
    evidence: p105Evidence(sc, {
      evidenceId: "ev-p105-goal", kind: "observation", outcome: "PASS", taskId: "gate-goal-105",
      coverage: [{ obligationId: "obl-goal-105", requirementId: "vr-goal-105" }], runRef: null, checkId: "static-check-goal",
      actor: { kind: "system", id: "verification-engine" },
    }),
  });
  for (const taskId of ["task-work-105", "gate-module-105", "gate-stage-105", "gate-goal-105"]) {
    const receipt = await h.reduceTask(p105ReduceTaskCommand(sc, {
      commandId: "cmd-p105-reduce-" + taskId, taskId, expectedRevision: 0,
    }));
    expect(receipt.status).toBe("committed");
    if (receipt.status !== "committed") throw new Error("reduceTask failed: " + taskId);
    const phase = (receipt as { phase: string }).phase;
    if (taskId === "task-work-105" && opts.withUnknownSideEffect === true) {
      // unreconciled outcome_unknown side effect -> exactly "verifying"
      // (never satisfied; the GOAL reducer turns this into NEEDS_DECISION).
      expect(phase).toBe("verifying");
    } else {
      expect(phase).toBe("satisfied");
    }
  }
  return { workRun };
}

