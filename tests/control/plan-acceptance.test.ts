/**
 * P1-02 lane B unit tests: ApplyPlanRevision (ControlEngine + real
 * InMemoryLedger).
 *
 * Driven purely through applyPlanRevision on a real ControlEngineImpl with a
 * real InMemoryLedger (a thin RecordingLedger subclass only captures the
 * submitted commit for fold-equality). Governance state (project active refs)
 * is established through the shared fixture builders committed DIRECTLY to the
 * ledger — lane A's install/activate control handlers are separate worktrees
 * and not implemented here, so bypassing them is required to reach the
 * applyPlan path.
 *
 * Coverage (per ticket lane-B Acceptance):
 *   - happy path: fold-equality with buildPlanLedgerCommit + pins exact,
 *     goal snapshot revision 2, activePlanRevision set, single event, no extra
 *     event types, outboxIntents [];
 *   - every non-empty/structure guard -> plan_guard_failed + ZERO write;
 *   - no active refs -> unresolved_governance_ref (ZERO write, no fallback);
 *   - goal not found -> not_found (ZERO write); wrong expectedRevision ->
 *     revision_conflict (ZERO write);
 *   - idempotent replay -> committed/replayed (same eventIds/cursor);
 *   - same identity + different fingerprint -> idempotency_conflict;
 *   - cross-project isolation for the same local goalId/planId;
 *   - no dispatch outbox / TaskAttempt / AgentRun anywhere.
 */
import { describe, expect, it } from "vitest";
import { createControlEngine } from "../../src/control/control-engine.js";
import { InMemoryLedger } from "../../src/ledger/in-memory-ledger.js";
import type { StateLedger, LedgerCommit, LedgerCommitReceipt } from "../../src/contracts/ledger.js";
import {
  createDeterministicDeps,
  FIXED_ISO_2026_09_05,
} from "../../src/contracts/testing/sequences.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import {
  WORKSPACE_BOOTSTRAP_FIXTURE_V1,
  buildBootstrapLedgerCommit,
} from "../../src/contracts/fixtures/bootstrap-fixture-v1.js";
import {
  MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1,
  buildCreateGoalCommand,
  buildGoalCreateLedgerCommit,
  goalSnapshotFor,
} from "../../src/contracts/fixtures/goal-fixtures.js";
import {
  ARCHITECTURE_BASELINE_FIXTURE_V1,
  COMPLETION_POLICY_FIXTURE_V1,
  buildActivateCommand,
  buildActivateLedgerCommit,
  buildInstallCommand,
  buildInstallLedgerCommit,
  completionPolicyPinFor,
  architectureBaselinePinFor,
} from "../../src/contracts/fixtures/governance-fixtures.js";
import type {
  InstallArchitectureBaselineRevisionCommand,
  InstallCompletionPolicyRevisionCommand,
} from "../../src/contracts/governance.js";
import {
  HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1,
  buildApplyPlanCommand,
  buildPlanLedgerCommit,
  goalRefFor,
  planRevisionRefFor,
} from "../../src/contracts/fixtures/plan-fixtures.js";
import type { ApplyPlanRevisionCommand, PlanRevisionDraft, PlanRevisionSnapshot } from "../../src/contracts/plan.js";
import type { GoalSnapshot } from "../../src/contracts/ledger.js";

const FIXED = FIXED_ISO_2026_09_05;

/** Thin recorder over the real InMemoryLedger (captures the submitted batch). */
class RecordingLedger extends InMemoryLedger {
  commits: LedgerCommit[] = [];
  override async commit(batch: LedgerCommit): Promise<LedgerCommitReceipt> {
    this.commits.push(batch);
    return super.commit(batch);
  }
}

type Harness = { ledger: RecordingLedger; engine: ReturnType<typeof createControlEngine> };

function makeHarness(): Harness {
  const ledger = new RecordingLedger();
  const deps = createDeterministicDeps();
  const engine = createControlEngine({ ledger, now: deps.clock, eventId: deps.eventId });
  return { ledger, engine };
}

async function bootstrap(ledger: StateLedger): Promise<void> {
  const bootCmd = buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
    commandId: "cmd-bootstrap",
    correlationId: "corr-bootstrap",
    submittedAt: FIXED,
  });
  const receipt = await ledger.commit(
    buildBootstrapLedgerCommit(bootCmd, {
      eventIds: ["evt-bootstrap-1", "evt-bootstrap-2", "evt-bootstrap-3", "evt-bootstrap-4"],
      occurredAt: FIXED,
    }),
  );
  expect(receipt.status).toBe("committed");
}

function scopeFor(projectId: string) {
  const scope = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes.find((s) => s.projectId === projectId);
  if (!scope) throw new Error("unknown project: " + projectId);
  return scope;
}

async function createGoal(ledger: StateLedger, projectId: string): Promise<void> {
  const scope = scopeFor(projectId);
  await ledger.commit(
    buildGoalCreateLedgerCommit(
      buildCreateGoalCommand(scope, {
        commandId: "cmd-goal-" + projectId,
        correlationId: "corr-goal-" + projectId,
        submittedAt: FIXED,
      }),
      { eventId: "evt-goal-" + projectId, occurredAt: FIXED, projectRevision: 1, workspaceRevision: 1 },
    ),
  );
}

type GovernanceState = {
  cp: InstallCompletionPolicyRevisionCommand;
  ab: InstallArchitectureBaselineRevisionCommand;
};

async function installActivateGovernance(ledger: StateLedger, projectId: string): Promise<GovernanceState> {
  const cp = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, {
    commandId: "cmd-install-cp-" + projectId,
    correlationId: "corr-install-cp-" + projectId,
    submittedAt: FIXED,
    projectId,
    idempotencyKey: "inst-cp-" + projectId,
  }) as InstallCompletionPolicyRevisionCommand;
  await ledger.commit(
    buildInstallLedgerCommit(cp, { eventId: "evt-install-cp-" + projectId, occurredAt: FIXED }),
  );

  const ab = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, {
    commandId: "cmd-install-ab-" + projectId,
    correlationId: "corr-install-ab-" + projectId,
    submittedAt: FIXED,
    projectId,
    idempotencyKey: "inst-ab-" + projectId,
  }) as InstallArchitectureBaselineRevisionCommand;
  await ledger.commit(
    buildInstallLedgerCommit(ab, { eventId: "evt-install-ab-" + projectId, occurredAt: FIXED }),
  );

  await ledger.commit(
    buildActivateLedgerCommit(
      buildActivateCommand(completionPolicyPinFor(cp), {
        commandId: "cmd-act-cp-" + projectId,
        correlationId: "corr-act-cp-" + projectId,
        submittedAt: FIXED,
        projectId,
        expectedRevision: 1,
        idempotencyKey: "act-cp-" + projectId,
      }),
      { eventId: "evt-act-cp-" + projectId, occurredAt: FIXED, activeAggregateRevision: 1, projectRevision: 1 },
    ),
  );
  await ledger.commit(
    buildActivateLedgerCommit(
      buildActivateCommand(architectureBaselinePinFor(ab), {
        commandId: "cmd-act-ab-" + projectId,
        correlationId: "corr-act-ab-" + projectId,
        submittedAt: FIXED,
        projectId,
        expectedRevision: 1,
        idempotencyKey: "act-ab-" + projectId,
      }),
      { eventId: "evt-act-ab-" + projectId, occurredAt: FIXED, activeAggregateRevision: 1, projectRevision: 1 },
    ),
  );
  return { cp, ab };
}

/** Full happy-path state: bootstrap + goal + governance active refs. */
async function setupAccepted(projectId = "proj-alpha"): Promise<Harness & GovernanceState> {
  const { ledger, engine } = makeHarness();
  await bootstrap(ledger);
  await createGoal(ledger, projectId);
  const gov = await installActivateGovernance(ledger, projectId);
  return { ledger, engine, ...gov };
}

function planCommand(
  draft: PlanRevisionDraft,
  projectId: string,
  opts: {
    commandId?: string;
    correlationId?: string;
    expectedRevision?: number;
    idempotencyKey?: string;
    goalId?: string;
  } = {},
): ApplyPlanRevisionCommand {
  return buildApplyPlanCommand(draft, {
    commandId: opts.commandId ?? "cmd-apply",
    correlationId: opts.correlationId ?? "corr-apply",
    submittedAt: FIXED,
    projectId,
    expectedRevision: opts.expectedRevision ?? 1,
    idempotencyKey: opts.idempotencyKey ?? "p1-02-apply-plan",
    ...(opts.goalId !== undefined ? { goalId: opts.goalId } : {}),
  });
}

function draftWith(mutate: (draft: PlanRevisionDraft) => PlanRevisionDraft): PlanRevisionDraft {
  const cloned = structuredClone(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1) as PlanRevisionDraft;
  return mutate(cloned);
}

async function eventCount(ledger: StateLedger): Promise<number> {
  const page = await ledger.events({ afterCursor: null, limit: 1000 });
  return page.events.length;
}

async function lastEvent(ledger: StateLedger) {
  const page = await ledger.events({ afterCursor: null, limit: 1000 });
  return page.events[page.events.length - 1]!;
}

describe("applyPlanRevision: happy path", () => {
  it("commits the exact fixture-builder batch (fold-equality) with FIXED pins", async () => {
    const { ledger, engine, cp, ab } = await setupAccepted("proj-alpha");
    const cmd = planCommand(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, "proj-alpha");

    const receipt = await engine.applyPlan(cmd);
    expect(receipt.status).toBe("committed");
    if (receipt.status !== "committed") return;

    // The submitted batch equals the shared fixture builder exactly.
    const submitted = ledger.commits[ledger.commits.length - 1]!;
    const expected = buildPlanLedgerCommit(cmd, {
      eventId: "evt-0001", // first engine eventId() call (setup went through direct commits)
      occurredAt: FIXED,
      acceptedAt: FIXED,
      pins: {
        completionPolicy: completionPolicyPinFor(cp),
        architectureBaseline: architectureBaselinePinFor(ab),
      },
      // baseGoal == the goal snapshot as persisted at revision 1.
      baseGoal: goalSnapshotFor(
        buildCreateGoalCommand(scopeFor("proj-alpha"), {
          commandId: "cmd-goal-proj-alpha",
          correlationId: "corr-goal-proj-alpha",
          submittedAt: FIXED,
        }),
      ),
    });
    expect(submitted).toEqual(expected);

    // Receipt fields.
    expect(receipt.commandId).toBe(cmd.commandId);
    expect(receipt.replayed).toBe(false);
    expect(receipt.planRef).toEqual(planRevisionRefFor(cmd));
    expect(receipt.goalRef).toEqual(goalRefFor(cmd));
    const last = await lastEvent(ledger);
    expect(receipt.eventIds).toEqual([last.event.eventId]);
    expect(receipt.commitCursor).toEqual(last.cursor);

    // Canonical: goal snapshot advanced to revision 2 with activePlanRevision.
    const goal = await ledger.load({ aggregateType: "Goal", projectId: "proj-alpha", goalId: "goal-1" });
    expect(goal.status).toBe("found");
    if (goal.status !== "found") return;
    const goalSnap = goal.snapshot as GoalSnapshot;
    expect(goalSnap.revision).toBe(2);
    expect(goalSnap.activePlanRevision).toEqual(planRevisionRefFor(cmd));

    // Plan snapshot persisted with exact pins (ref + digest triple).
    const plan = await ledger.load({ aggregateType: "PlanRevision", projectId: "proj-alpha", planId: "plan-mvp-1" });
    expect(plan.status).toBe("found");
    if (plan.status !== "found") return;
    const planSnap = plan.snapshot as PlanRevisionSnapshot;
    expect(planSnap.effectiveCompletionPolicy).toEqual(completionPolicyPinFor(cp));
    expect(planSnap.effectiveArchitectureBaseline).toEqual(architectureBaselinePinFor(ab));
    expect(planSnap.stages).toHaveLength(2);
    expect(planSnap.tasks).toHaveLength(4);
    expect(planSnap.taskHierarchy.parentOf).toHaveLength(3);
    expect(planSnap.executionDag.dependsOn).toHaveLength(3);

    // Only ONE new event of type PlanRevisionAccepted (no dispatch artifacts).
    const all = await ledger.events({ afterCursor: null, limit: 1000 });
    const types = all.events.map((p) => p.event.eventType);
    expect(types.filter((t) => t === "PlanRevisionAccepted")).toHaveLength(1);
    expect(types).not.toContain("TaskAttempt");
    expect(types).not.toContain("AgentRun");
  });
});

describe("applyPlanRevision: ref resolution guards (zero write)", () => {
  it("goal not found -> not_found, zero write", async () => {
    const { ledger, engine } = await setupAccepted("proj-alpha");
    const before = await eventCount(ledger);
    // Both aggregateId (command) and payload.plan.goalId must point at the same
    // non-existent goal so the scoping check passes and ref resolution fails.
    const draft = draftWith((d) => ({ ...d, goalId: "goal-nope" }));
    const cmd = planCommand(draft, "proj-alpha", { goalId: "goal-nope" });
    const receipt = await engine.applyPlan(cmd);
    expect(receipt).toEqual({ status: "rejected", commandId: cmd.commandId, code: "not_found" });
    expect(await eventCount(ledger)).toBe(before);
  });

  it("no active CompletionPolicy/Baseline -> unresolved_governance_ref, zero write", async () => {
    const { ledger, engine } = makeHarness();
    await bootstrap(ledger);
    await createGoal(ledger, "proj-alpha");
    const before = await eventCount(ledger);
    // install WITHOUT activating -> no active refs.
    const receipt = await engine.applyPlan(
      planCommand(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, "proj-alpha"),
    );
    expect(receipt.status).toBe("rejected");
    if (receipt.status !== "rejected") return;
    expect(receipt.code).toBe("unresolved_governance_ref");
    expect(await eventCount(ledger)).toBe(before);
  });

  it("wrong expectedRevision -> revision_conflict, zero write", async () => {
    const { ledger, engine } = await setupAccepted("proj-alpha");
    const before = await eventCount(ledger);
    const receipt = await engine.applyPlan(
      planCommand(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, "proj-alpha", {
        expectedRevision: 99,
        idempotencyKey: "apply-stale",
      }),
    );
    expect(receipt.status).toBe("rejected");
    if (receipt.status !== "rejected") return;
    expect(receipt.code).toBe("revision_conflict");
    expect(await eventCount(ledger)).toBe(before);
  });
});

describe("applyPlanRevision: schema / scoping guards (zero write)", () => {
  it("invalid schemaVersion -> invalid, zero write", async () => {
    const { ledger, engine } = await setupAccepted("proj-alpha");
    const before = await eventCount(ledger);
    const cmd = {
      ...planCommand(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, "proj-alpha"),
      schemaVersion: 2,
    } as unknown as ApplyPlanRevisionCommand;
    const receipt = await engine.applyPlan(cmd);
    expect(receipt).toEqual({ status: "rejected", commandId: cmd.commandId, code: "invalid" });
    expect(await eventCount(ledger)).toBe(before);
  });

  it("aggregateId !== payload.plan.goalId on an existing goal -> invalid, zero write", async () => {
    const { ledger, engine } = await setupAccepted("proj-alpha");
    const before = await eventCount(ledger);
    // Command targets the EXISTING goal-1, but the plan declares goal-2.
    const draft = draftWith((d) => ({ ...d, goalId: "goal-2" }));
    const cmd = planCommand(draft, "proj-alpha", { goalId: "goal-1" });
    const receipt = await engine.applyPlan(cmd);
    expect(receipt).toEqual({ status: "rejected", commandId: cmd.commandId, code: "invalid" });
    expect(await eventCount(ledger)).toBe(before);
  });
});

describe("applyPlanRevision: non-empty + structure guards -> plan_guard_failed (zero write)", () => {
  const cases: { name: string; mutate: (d: PlanRevisionDraft) => PlanRevisionDraft; code: string }[] = [
    {
      name: "no required executable task",
      mutate: (d) => ({ ...d, tasks: d.tasks.map((t) => ({ ...t, requirementLevel: "optional" as const })) }),
      code: "missing_required_executable_task",
    },
    {
      name: "no active required GoalGateTask",
      mutate: (d) => ({
        ...d,
        tasks: d.tasks.map((t) =>
          t.taskId === "gate-goal" ? { ...t, disposition: "deferred" as const } : t,
        ),
      }),
      code: "missing_active_required_goal_gate",
    },
    {
      name: "no required obligation",
      mutate: (d) => ({ ...d, obligations: d.obligations.map((o) => ({ ...o, requirementLevel: "optional" as const })) }),
      code: "missing_required_obligation",
    },
    {
      name: "required executable task without required obligation mapping",
      mutate: (d) => ({
        ...d,
        obligations: d.obligations.map((o) =>
          o.taskIds.includes("task-verify") ? { ...o, taskIds: o.taskIds.filter((id) => id !== "task-verify") } : o,
        ),
      }),
      code: "task_obligation_mapping",
    },
    {
      name: "required obligation with empty taskIds",
      mutate: (d) => ({
        ...d,
        obligations: d.obligations.map((o) => (o.obligationId === "obl-2" ? { ...o, taskIds: [] } : o)),
      }),
      code: "obligation_task_mapping",
    },
    {
      name: "required obligation compiles zero required VR",
      mutate: (d) => ({
        ...d,
        obligations: d.obligations.map((o) => ({
          ...o,
          verificationRequirements: o.verificationRequirements.map((v) => ({ ...v, requirementLevel: "optional" as const })),
        })),
      }),
      code: "empty_verification_requirements",
    },
    {
      name: "VR kind outside policy requirementKinds",
      mutate: (d) => ({
        ...d,
        obligations: d.obligations.map((o) => ({
          ...o,
          verificationRequirements: o.verificationRequirements.map((v) => ({ ...v, kind: "mutant-oracle" })),
        })),
      }),
      code: "unknown_requirement_kind",
    },
    {
      name: "dangling hierarchy edge",
      mutate: (d) => ({
        ...d,
        taskHierarchy: { parentOf: [...d.taskHierarchy.parentOf, { parentTaskId: "task-nope", childTaskId: "task-verify" }] },
      }),
      code: "dangling_task_ref",
    },
    {
      name: "hierarchy cycle",
      mutate: (d) => ({
        ...d,
        taskHierarchy: {
          parentOf: [
            { parentTaskId: "task-verify", childTaskId: "task-accept-plan" },
            { parentTaskId: "task-accept-plan", childTaskId: "task-install-contract" },
            { parentTaskId: "task-install-contract", childTaskId: "task-verify" },
          ],
        },
      }),
      code: "hierarchy_cycle",
    },
    {
      name: "dangling DAG edge",
      mutate: (d) => ({
        ...d,
        executionDag: { dependsOn: [...d.executionDag.dependsOn, { taskId: "task-verify", dependsOnId: "task-ghost", requires: { kind: "artifact", label: "x" } }] },
      }),
      code: "dangling_task_ref",
    },
    {
      name: "DAG self dependency",
      mutate: (d) => ({
        ...d,
        executionDag: { dependsOn: [...d.executionDag.dependsOn, { taskId: "task-verify", dependsOnId: "task-verify", requires: { kind: "artifact", label: "x" } }] },
      }),
      code: "self_dependency",
    },
    {
      name: "DAG cycle",
      mutate: (d) => ({
        ...d,
        executionDag: { dependsOn: [
          { taskId: "task-accept-plan", dependsOnId: "task-install-contract", requires: { kind: "artifact", label: "a" } },
          { taskId: "task-install-contract", dependsOnId: "task-accept-plan", requires: { kind: "artifact", label: "b" } },
        ] },
      }),
      code: "dag_cycle",
    },
  ];

  for (const c of cases) {
    it(`guard: ${c.name} -> plan_guard_failed, zero write`, async () => {
      const { ledger, engine } = await setupAccepted("proj-alpha");
      const before = await eventCount(ledger);
      const draft = draftWith(c.mutate);
      const receipt = await engine.applyPlan(planCommand(draft, "proj-alpha"));
      expect(receipt.status).toBe("rejected");
      if (receipt.status !== "rejected") return;
      expect(receipt.code).toBe("plan_guard_failed");
      expect(receipt.issues?.some((i) => i.code === c.code)).toBe(true);
      expect(await eventCount(ledger)).toBe(before);
    });
  }
});

describe("applyPlanRevision: idempotency", () => {
  it("replay of an identical command -> committed/replayed, same eventIds & cursor", async () => {
    const { ledger, engine } = await setupAccepted("proj-alpha");
    const keep = {
      commandId: "cmd-apply-idem",
      correlationId: "corr-apply-idem",
      submittedAt: FIXED,
      projectId: "proj-alpha",
      expectedRevision: 1,
      idempotencyKey: "apply-idem-1",
    };
    const first = await engine.applyPlan(buildApplyPlanCommand(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, keep));
    expect(first.status).toBe("committed");
    if (first.status !== "committed") return;

    const replay = await engine.applyPlan(buildApplyPlanCommand(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, keep));
    expect(replay.status).toBe("committed");
    if (replay.status !== "committed") return;
    expect(replay.replayed).toBe(true);
    expect(replay.eventIds).toEqual(first.eventIds);
    expect(replay.commitCursor).toEqual(first.commitCursor);
    expect(replay.planRef).toEqual(first.planRef);
    expect(replay.goalRef).toEqual(first.goalRef);
    // No new event written (setup 9 + 1 accepted).
    expect(await eventCount(ledger)).toBe(9 + 1);
  });

  it("same identity, different payload -> idempotency_conflict", async () => {
    const { ledger, engine } = await setupAccepted("proj-alpha");
    const keep = {
      commandId: "cmd-x",
      correlationId: "corr-x",
      submittedAt: FIXED,
      projectId: "proj-alpha",
      expectedRevision: 1,
      idempotencyKey: "apply-conflict",
    };
    const first = await engine.applyPlan(buildApplyPlanCommand(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, keep));
    expect(first.status).toBe("committed");

    const other = draftWith((d) => ({
      ...d,
      planRevision: 2,
      tasks: d.tasks.map((t) => ({ ...t, title: t.title + " (v2)" })),
    }));
    const second = await engine.applyPlan(buildApplyPlanCommand(other, keep));
    expect(second).toEqual({ status: "rejected", commandId: "cmd-x", code: "idempotency_conflict" });
  });
});

describe("applyPlanRevision: cross-project isolation", () => {
  it("same local goalId/planId under two projects never cross-talk", async () => {
    const { ledger, engine } = makeHarness();
    await bootstrap(ledger);
    await createGoal(ledger, "proj-alpha");
    await createGoal(ledger, "proj-beta");
    await installActivateGovernance(ledger, "proj-alpha");
    await installActivateGovernance(ledger, "proj-beta");

    const alpha = await engine.applyPlan(
      planCommand(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, "proj-alpha"),
    );
    const beta = await engine.applyPlan(
      planCommand(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, "proj-beta", { idempotencyKey: "p1-02-apply-plan" }),
    );
    expect(alpha.status).toBe("committed");
    expect(beta.status).toBe("committed");
    if (alpha.status !== "committed" || beta.status !== "committed") return;
    expect(alpha.planRef).toEqual({ aggregateType: "PlanRevision", projectId: "proj-alpha", planId: "plan-mvp-1" });
    expect(beta.planRef).toEqual({ aggregateType: "PlanRevision", projectId: "proj-beta", planId: "plan-mvp-1" });
    expect(alpha.goalRef).toEqual({ aggregateType: "Goal", projectId: "proj-alpha", goalId: "goal-1" });
    expect(beta.goalRef).toEqual({ aggregateType: "Goal", projectId: "proj-beta", goalId: "goal-1" });

    const alphaGoal = await ledger.load({ aggregateType: "Goal", projectId: "proj-alpha", goalId: "goal-1" });
    const betaGoal = await ledger.load({ aggregateType: "Goal", projectId: "proj-beta", goalId: "goal-1" });
    expect(alphaGoal.status).toBe("found");
    expect(betaGoal.status).toBe("found");
    if (alphaGoal.status !== "found" || betaGoal.status !== "found") return;
    expect((alphaGoal.snapshot as GoalSnapshot).activePlanRevision).toEqual(alpha.planRef);
    expect((betaGoal.snapshot as GoalSnapshot).activePlanRevision).toEqual(beta.planRef);
  });
});

describe("applyPlanRevision: no dispatch side-effects", () => {
  it("accepted plan emits only the PlanRevisionAccepted event; no outbox/TaskAttempt/AgentRun", async () => {
    const { ledger, engine } = await setupAccepted("proj-alpha");
    await engine.applyPlan(planCommand(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, "proj-alpha"));
    const page = await ledger.events({ afterCursor: null, limit: 1000 });
    const json = JSON.stringify(page);
    expect(json).not.toMatch(/TaskAttempt/);
    expect(json).not.toMatch(/AgentRun/);
    expect(json).not.toMatch(/outbox/);
    const types = page.events.map((p) => p.event.eventType);
    expect(types).toEqual([
      "ProjectBootstrapped",
      "ProjectBootstrapped",
      "WorkspaceBootstrapped",
      "WorkspaceBootstrapped",
      "GoalCreated",
      "CompletionPolicyInstalled",
      "ArchitectureBaselineInstalled",
      "CompletionPolicyActivated",
      "ArchitectureBaselineActivated",
      "PlanRevisionAccepted",
    ]);
    const batch = ledger.commits[ledger.commits.length - 1]!;
    expect(batch.outboxIntents).toEqual([]);
  });
});
