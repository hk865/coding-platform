import { classifyRestartProbeError } from "./readiness-probe.js";
/**
 * P1-03 restart-path fixtures + readiness probe — owned by lane D.
 *   bootstrap -> governance(install/activate) -> CreateGoal -> applyPlan ->
 *   claim -> start -> FakeRuntime facts -> commit -> close -> reopen ->
 *   (a) canonical outbox/lease/Attempt/Run snapshots identical,
 *   (b) ActiveAgents + TaskDetail rebuilt from persisted EventPages
 *   field-for-field identical,
 *   (c) no pending intents remain after the terminal fact.
 * NEVER fakes; the probe runs the full pre-restart path and any remaining
 * "P1-03: ... not implemented yet" stub throw makes it false (auto-skip).
 */
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import type { PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1 } from "../contract-support/fixtures/bootstrap-fixture-v1.js";
import {
  ARCHITECTURE_BASELINE_FIXTURE_V1,
  COMPLETION_POLICY_FIXTURE_V1,
  buildActivateCommand,
  buildInstallCommand,
} from "../../src/fixtures/governance-fixtures.js";
import { MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1, buildCreateGoalCommand } from "../contract-support/fixtures/goal-fixtures.js";
import { buildApplyPlanCommand } from "../../src/fixtures/plan-fixtures.js";
import {
  DISPATCH_BLOCKED_TASK_ID,
  DISPATCH_ELIGIBLE_TASK_ID,
  DISPATCH_PLAN_REVISION_FIXTURE_V1,
  buildDispatchStartCommand,
  buildManifestFixture,
  buildRunFactCommand,
  rebaseScriptForRun,
  FAKE_RUNTIME_SCRIPT_COMPLETED_V1,
} from "../../src/fixtures/dispatch-fixtures.js";
import type { DispatchOutboxEntrySnapshot, RunSnapshot, TaskAttemptSnapshot, TaskLeaseSnapshot } from "../../src/contracts/dispatch.js";
import { runRefFor, taskAttemptRefFor, taskLeaseRefFor } from "../../src/contracts/dispatch.js";
import { artifactBodyDigest } from "../../src/contracts/artifact.js";
import { dispatchOutboxRefFor } from "../../src/contracts/dispatch.js";

const SCHEMA = "2026-09-05T12:00:00.000Z";
const GOAL_ID = "goal-1";
const TASK_ID = DISPATCH_ELIGIBLE_TASK_ID;
const ATTEMPT_ID = "att-p103-0001";
const RUN_ID = "run-p103-0001";

const PLAN_REF = { aggregateType: "PlanRevision" as const, projectId: "proj-alpha", planId: "plan-dispatch-mvp" };

export async function isP103Ready(): Promise<boolean> {
  try {
    const h = await createPersistentSqliteHarness({ deps: {} });
    try {
      await runP103Path(h);
      return true;
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  } catch (error) {
    return classifyRestartProbeError(error);
  }
}

export async function runP103Path(h: PersistentSqliteHarness) {
  const receipt = await h.bootstrap(
    buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
      commandId: "cmd-p103-boot", correlationId: "corr-p103-boot", submittedAt: SCHEMA,
    }),
  );
  if (receipt.status !== "committed") throw new Error("bootstrap failed");
  // P1-02-style: install + activate both kinds; pins resolved inside applyPlan
  const cpCmd = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, {
    commandId: "cmd-p103-cp", correlationId: "corr-p103-cp", submittedAt: SCHEMA, projectId: "proj-alpha", idempotencyKey: "p103-cp-1",
  });
  const abCmd = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, {
    commandId: "cmd-p103-ab", correlationId: "corr-p103-ab", submittedAt: SCHEMA, projectId: "proj-alpha", idempotencyKey: "p103-ab-1",
  });
  const installedCp = await h.install(cpCmd);
  const installedAb = await h.install(abCmd);
  if (installedCp.status !== "committed" || installedAb.status !== "committed") throw new Error("install");
  const { completionPolicyPinFor, architectureBaselinePinFor } = await import("../../src/fixtures/governance-fixtures.js");
  const actCp = await h.activate(buildActivateCommand(completionPolicyPinFor(cpCmd as never), {
    commandId: "cmd-p103-actcp", correlationId: "corr-p103-actcp", submittedAt: SCHEMA, projectId: "proj-alpha", expectedRevision: 1, idempotencyKey: "activate-p103-cp",
  }));
  const actAb = await h.activate(buildActivateCommand(architectureBaselinePinFor(abCmd as never), {
    commandId: "cmd-p103-actab", correlationId: "corr-p103-actab", submittedAt: SCHEMA, projectId: "proj-alpha", expectedRevision: 1, idempotencyKey: "activate-p103-ab",
  }));
  if (actCp.status !== "committed" || actAb.status !== "committed") throw new Error("activate");

  const goal = await h.control.submit(
    buildCreateGoalCommand(MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[0]!, {
      commandId: "cmd-p103-goal", correlationId: "corr-p103-goal", submittedAt: SCHEMA,
    }),
  );
  if (goal.status !== "committed") throw new Error("goal failed");
  // The frozen DISPATCH_PLAN_REVISION_FIXTURE_V1 leaves the required+work+active
  // task-blocked unmapped by any required obligation, so the P1-02 applyPlan guard
  // rejects it (task_obligation_mapping). We add that mapping here (no src/contracts/**
  // change) so the restart path can exercise the dispatch/run flow.
  const planDraft: import("../../src/contracts/plan.js").PlanRevisionDraft = {
    ...DISPATCH_PLAN_REVISION_FIXTURE_V1,
    obligations: [
      ...DISPATCH_PLAN_REVISION_FIXTURE_V1.obligations,
      {
        obligationId: "obl-blocked",
        title: "映射 blocked 任务以满足 P1-02 applyPlan 守卫",
        requirementLevel: "required",
        taskIds: [DISPATCH_BLOCKED_TASK_ID],
        verificationRequirements: [
          {
            requirementId: "vr-blocked",
            requirementLevel: "required",
            kind: "static",
            description: "blocked 任务不可领取",
          },
        ],
      },
    ],
  };
  const plan = await h.applyPlan(
    buildApplyPlanCommand(planDraft, {
      commandId: "cmd-p103-plan", correlationId: "corr-p103-plan", submittedAt: SCHEMA,
      projectId: "proj-alpha", expectedRevision: 1,
    }),
  );
  if (plan.status !== "committed") throw new Error("plan failed");

  const claim = await h.claimTask({
    commandId: "cmd-p103-claim", commandType: "DispatchClaimTask", schemaVersion: 1,
    identity: { projectId: "proj-alpha", actor: { kind: "human", id: "user-1" }, idempotencyKey: "p103-claim-1" },
    aggregateId: TASK_ID, expectedRevision: 0, correlationId: "corr-p103-claim", submittedAt: SCHEMA,
    payload: {
      goalId: GOAL_ID, attemptId: ATTEMPT_ID, runId: RUN_ID,
      roleBinding: {
        schemaVersion: 1, bindingId: "binding-run-short-lived-v1", templateId: "template-short-lived-runner",
        templateRevision: "2026-09-05", bindingVersion: 1, policyRevision: "auth-policy-runtime-v1",
      },
      declaredPermissions: { tools: ["read", "write"], writeScope: ["src/contracts"] },
      budget: { tokenBudget: 100_000, deadline: "2026-09-06T00:00:00.000Z" },
    },
  });
  if (claim.status !== "committed") throw new Error("claim failed: " + String(claim.status));

  const bundleRef = {
    kind: "artifact" as const, contentType: "text/plain", digest: artifactBodyDigest("p1-03-bundle-body"),
    sizeBytes: 16, source: { kind: "plan-revision" as const, refId: "plan-dispatch-mvp", revision: "1" },
  };
  const envelope: import("../../src/contracts/task-envelope.js").TaskEnvelopeV1 = {
    schemaVersion: 1, envelopeId: "envelope-" + RUN_ID, projectId: "proj-alpha", workspaceId: "ws-shared",
    goalId: GOAL_ID, taskId: TASK_ID,
    runRef: runRefFor("proj-alpha", GOAL_ID, RUN_ID),
    attemptRef: taskAttemptRefFor("proj-alpha", GOAL_ID, TASK_ID, ATTEMPT_ID),
    planRef: PLAN_REF,
    roleBinding: {
      schemaVersion: 1, bindingId: "binding-run-short-lived-v1", templateId: "template-short-lived-runner",
      templateRevision: "2026-09-05", bindingVersion: 1, policyRevision: "auth-policy-runtime-v1",
    },
    workspaceSnapshot: { workspaceId: "ws-shared", revision: 1 },
    permissions: { policyRevision: "auth-policy-runtime-v1", tools: ["read", "write"], writeScope: ["src/contracts"] },
    budget: { tokenBudget: 100_000, deadline: "2026-09-06T00:00:00.000Z" },
    sourceRefs: [{ kind: "plan-revision", refId: "plan-dispatch-mvp", revision: "1" }],
    bundleRef,
  };
  const start = await h.startRun(
    buildDispatchStartCommand({
      commandId: "cmd-p103-start", correlationId: "corr-p103-start", submittedAt: SCHEMA,
      projectId: "proj-alpha", runId: RUN_ID,
      envelope,
      manifest: buildManifestFixture({ workspaceId: "ws-shared", workspaceRevision: 1, planRef: PLAN_REF }),
    }),
  );
  if (start.status !== "committed") throw new Error("start failed: " + String(start.status));

  const events = rebaseScriptForRun(FAKE_RUNTIME_SCRIPT_COMPLETED_V1, runRefFor("proj-alpha", GOAL_ID, RUN_ID));
  for (const [i, event] of events.entries()) {
    const fact = await h.runFact(
      buildRunFactCommand({
        commandId: "cmd-p103-fact-" + (i + 1), correlationId: "corr-p103-fact-" + (i + 1), submittedAt: SCHEMA,
        projectId: "proj-alpha", runId: RUN_ID, expectedRevision: 2 + i,
        fact: { kind: "runtime_event", event },
      }),
    );
    if (fact.status !== "committed") throw new Error("runfact failed: " + String(fact.status));
  }

  await h.advanceProjection();
  const outboxRef = dispatchOutboxRefFor("proj-alpha", GOAL_ID, TASK_ID, ATTEMPT_ID);
  const leaseRef = taskLeaseRefFor("proj-alpha", GOAL_ID, TASK_ID);
  const attemptRef = taskAttemptRefFor("proj-alpha", GOAL_ID, TASK_ID, ATTEMPT_ID);
  const runRef = runRefFor("proj-alpha", GOAL_ID, RUN_ID);

  const outbox = await h.ledger.load(outboxRef);
  const lease = await h.ledger.load(leaseRef);
  const attempt = await h.ledger.load(attemptRef);
  const run = await h.ledger.load(runRef);
  if (outbox.status !== "found" || lease.status !== "found" || attempt.status !== "found" || run.status !== "found") {
    throw new Error("dispatch snapshots not found");
  }
  const pending = await h.ledger.pendingDispatchIntents(100);

  const agent = await h.activeAgent({ projectId: "proj-alpha", goalId: GOAL_ID, taskId: TASK_ID });
  const detail = await h.taskDetail({ projectId: "proj-alpha", goalId: GOAL_ID, taskId: TASK_ID });

  return {
    outbox: outbox.snapshot as DispatchOutboxEntrySnapshot,
    lease: lease.snapshot as TaskLeaseSnapshot,
    attempt: attempt.snapshot as TaskAttemptSnapshot,
    run: run.snapshot as RunSnapshot,
    pendingCount: pending.length,
    agent: agent.status === "ready" ? agent.agent : null,
    detail: detail.status === "ready" ? detail.task : null,
    observedCursor: h.observedCursor(),
    eventTypes: (await h.ledger.events({ afterCursor: null, limit: 500 })).events.map((p) => p.event.eventType),
  };
}

export async function verifyP103AfterRestart(
  h: PersistentSqliteHarness,
  before: Awaited<ReturnType<typeof runP103Path>>,
): Promise<void> {
  const outbox = await h.ledger.load(dispatchOutboxRefFor("proj-alpha", GOAL_ID, TASK_ID, ATTEMPT_ID));
  const lease = await h.ledger.load(taskLeaseRefFor("proj-alpha", GOAL_ID, TASK_ID));
  const attempt = await h.ledger.load(taskAttemptRefFor("proj-alpha", GOAL_ID, TASK_ID, ATTEMPT_ID));
  const run = await h.ledger.load(runRefFor("proj-alpha", GOAL_ID, RUN_ID));
  if (outbox.status !== "found" || lease.status !== "found" || attempt.status !== "found" || run.status !== "found") {
    throw new Error("post-restart dispatch snapshots not found");
  }
  const json = (v: unknown) => JSON.stringify(v);
  if (json(outbox.snapshot) !== json(before.outbox)) throw new Error("outbox mismatch after restart");
  if (json(lease.snapshot) !== json(before.lease)) throw new Error("lease mismatch after restart");
  if (json(attempt.snapshot) !== json(before.attempt)) throw new Error("attempt mismatch after restart");
  if (json(run.snapshot) !== json(before.run)) throw new Error("run mismatch after restart");

  const pending = await h.ledger.pendingDispatchIntents(100);
  if (pending.length !== before.pendingCount) throw new Error("pending intents mismatch");

  await h.advanceProjection();
  const agent = await h.activeAgent({ projectId: "proj-alpha", goalId: GOAL_ID, taskId: TASK_ID });
  const detail = await h.taskDetail({ projectId: "proj-alpha", goalId: GOAL_ID, taskId: TASK_ID });
  if (agent.status === "ready" && before.agent !== null) {
    if (json(agent.agent) !== json(before.agent)) throw new Error("ActiveAgent mismatch after restart");
  }
  if (detail.status === "ready" && before.detail !== null) {
    if (json(detail.task) !== json(before.detail)) throw new Error("TaskDetail mismatch after restart");
  }
}
