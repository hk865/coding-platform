/**
 * P1-03 lane A unit tests: claimTask (unique claim via ControlEngineImpl over a
 * real InMemoryLedger).
 *
 * Drive the ENGINE handler (not the fixture builder) and assert the SUBMITTED
 * batch is fold-equivalent to the shared buildDispatchClaimLedgerCommit fixture
 * (same ids -> identical commit), plus the receipt/snapshot outcomes:
 *   - happy path: atomic dispatch-claim (lease/attempt/run/outbox @1),
 *     durable intent loadable, all refs exact;
 *   - competing claims (parallel): exactly one wins, loser revision_conflict;
 *   - idempotent replay -> committed(replayed) with same eventIds; a different
 *     payload on the same idempotency key contends for the already-held lease
 *     -> revision_conflict (lease held by another run);
 *   - ineligible -> ineligible with issues, ZERO write;
 *   - missing goal -> not_found, ZERO write; invalid command -> invalid;
 *   - claim never emits AgentRun/TaskAttempt events (only TaskClaimed).
 */
import { describe, expect, it } from "vitest";
import { createControlEngine } from "../../src/control/control-engine.js";
import { InMemoryLedger } from "../../src/ledger/in-memory-ledger.js";
import type { StateLedger, LedgerCommit, LedgerCommitReceipt } from "../../src/contracts/ledger.js";
import { createDeterministicDeps, FIXED_ISO_2026_09_05 } from "../../src/contracts/testing/sequences.js";
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
import {
  DISPATCH_PLAN_REVISION_FIXTURE_V1,
  DISPATCH_DEPENDENT_TASK_ID,
  buildDispatchClaimCommand,
  buildDispatchClaimLedgerCommit,
} from "../../src/contracts/fixtures/dispatch-fixtures.js";
import type { InstallArchitectureBaselineRevisionCommand, InstallCompletionPolicyRevisionCommand } from "../../src/contracts/governance.js";
import type { ApplyPlanRevisionCommand } from "../../src/contracts/plan.js";
import { buildApplyPlanCommand, buildPlanLedgerCommit } from "../../src/contracts/fixtures/plan-fixtures.js";
import type { DispatchClaimCommand, TaskLeaseSnapshot, TaskAttemptSnapshot, RunSnapshot, DispatchOutboxEntrySnapshot } from "../../src/contracts/dispatch.js";
import { taskLeaseRefFor, taskAttemptRefFor, runRefFor, dispatchOutboxRefFor } from "../../src/contracts/dispatch.js";

const FIXED = FIXED_ISO_2026_09_05;
const PLAN_REF = { aggregateType: "PlanRevision" as const, projectId: "proj-alpha", planId: "plan-dispatch-mvp" };

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

async function createGoal(ledger: StateLedger): Promise<void> {
  const scope = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[0]!;
  const cmd = buildCreateGoalCommand(scope, {
    commandId: "cmd-goal",
    correlationId: "corr-goal",
    submittedAt: FIXED,
  });
  const receipt = await ledger.commit(
    buildGoalCreateLedgerCommit(cmd, { eventId: "evt-goal", occurredAt: FIXED, projectRevision: 1, workspaceRevision: 1 }),
  );
  expect(receipt.status).toBe("committed");
}

type Gov = {
  cp: InstallCompletionPolicyRevisionCommand;
  ab: InstallArchitectureBaselineRevisionCommand;
  apply: ApplyPlanRevisionCommand;
};

async function installActivateAndPlan(ledger: StateLedger): Promise<Gov> {
  const cp = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, {
    commandId: "cmd-install-cp", correlationId: "corr-install-cp", submittedAt: FIXED,
    projectId: "proj-alpha", idempotencyKey: "inst-cp",
  }) as InstallCompletionPolicyRevisionCommand;
  await ledger.commit(buildInstallLedgerCommit(cp, { eventId: "evt-install-cp", occurredAt: FIXED }));
  const ab = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, {
    commandId: "cmd-install-ab", correlationId: "corr-install-ab", submittedAt: FIXED,
    projectId: "proj-alpha", idempotencyKey: "inst-ab",
  }) as InstallArchitectureBaselineRevisionCommand;
  await ledger.commit(buildInstallLedgerCommit(ab, { eventId: "evt-install-ab", occurredAt: FIXED }));

  await ledger.commit(
    buildActivateLedgerCommit(
      buildActivateCommand(completionPolicyPinFor(cp), {
        commandId: "cmd-act-cp", correlationId: "corr-act-cp", submittedAt: FIXED,
        projectId: "proj-alpha", expectedRevision: 1, idempotencyKey: "act-cp",
      }),
      { eventId: "evt-act-cp", occurredAt: FIXED, activeAggregateRevision: 1, projectRevision: 1 },
    ),
  );
  await ledger.commit(
    buildActivateLedgerCommit(
      buildActivateCommand(architectureBaselinePinFor(ab), {
        commandId: "cmd-act-ab", correlationId: "corr-act-ab", submittedAt: FIXED,
        projectId: "proj-alpha", expectedRevision: 1, idempotencyKey: "act-ab",
      }),
      { eventId: "evt-act-ab", occurredAt: FIXED, activeAggregateRevision: 1, projectRevision: 1 },
    ),
  );

  const apply = buildApplyPlanCommand(DISPATCH_PLAN_REVISION_FIXTURE_V1, {
    commandId: "cmd-apply", correlationId: "corr-apply", submittedAt: FIXED,
    projectId: "proj-alpha", expectedRevision: 1, idempotencyKey: "apply",
  });
  const goal = await ledger.load({ aggregateType: "Goal", projectId: "proj-alpha", goalId: "goal-1" });
  if (goal.status !== "found") throw new Error("goal not found");
  await ledger.commit(
    buildPlanLedgerCommit(apply, {
      eventId: "evt-apply", occurredAt: FIXED, acceptedAt: FIXED,
      pins: { completionPolicy: completionPolicyPinFor(cp), architectureBaseline: architectureBaselinePinFor(ab) },
      baseGoal: goalSnapshotFor(
        buildCreateGoalCommand(MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[0]!, {
          commandId: "cmd-goal", correlationId: "corr-goal", submittedAt: FIXED,
        }),
      ),
    }),
  );
  return { cp, ab, apply };
}

async function setupAccepted() {
  const { ledger, engine } = makeHarness();
  await bootstrap(ledger);
  await createGoal(ledger);
  const gov = await installActivateAndPlan(ledger);
  return { ledger, engine, gov };
}

function claimCmd(deps: {
  commandId: string; attemptId?: string; runId?: string; idempotencyKey?: string;
  goalId?: string; taskId?: string;
}): DispatchClaimCommand {
  return buildDispatchClaimCommand({
    commandId: deps.commandId,
    correlationId: "corr-" + deps.commandId,
    submittedAt: FIXED,
    projectId: "proj-alpha",
    ...(deps.goalId !== undefined ? { goalId: deps.goalId } : {}),
    ...(deps.taskId !== undefined ? { taskId: deps.taskId } : {}),
    ...(deps.attemptId !== undefined ? { attemptId: deps.attemptId } : {}),
    ...(deps.runId !== undefined ? { runId: deps.runId } : {}),
    idempotencyKey: deps.idempotencyKey ?? deps.commandId,
  });
}

async function eventCount(ledger: StateLedger): Promise<number> {
  const page = await ledger.events({ afterCursor: null, limit: 1000 });
  return page.events.length;
}

describe("claimTask: happy path (atomic unique claim + fold-equality)", () => {
  it("submits the exact fixture-builder batch and persists lease/attempt/run/outbox @1", async () => {
    const { ledger, engine } = await setupAccepted();
    const cmd = claimCmd({ commandId: "cmd-claim-a", attemptId: "att-a", runId: "run-a", idempotencyKey: "inst-a" });

    const receipt = await engine.claimTask(cmd);
    expect(receipt.status).toBe("committed");
    if (receipt.status !== "committed") return;

    const submitted = ledger.commits[ledger.commits.length - 1]!;
    const expected = buildDispatchClaimLedgerCommit(cmd, {
      eventId: "evt-0001",
      occurredAt: FIXED,
      workspaceId: "ws-shared",
      planRef: PLAN_REF,
      workspaceRevision: 1,
    });
    expect(submitted).toEqual(expected);

    // Receipt exact.
    expect(receipt.commandId).toBe(cmd.commandId);
    expect(receipt.replayed).toBe(false);
    expect(receipt.leaseRef).toEqual(taskLeaseRefFor("proj-alpha", "goal-1", "task-run-adaptor"));
    expect(receipt.attemptRef).toEqual(taskAttemptRefFor("proj-alpha", "goal-1", "task-run-adaptor", "att-a"));
    expect(receipt.runRef).toEqual(runRefFor("proj-alpha", "goal-1", "run-a"));
    expect(receipt.outboxRef).toEqual(dispatchOutboxRefFor("proj-alpha", "goal-1", "task-run-adaptor", "att-a"));

    // All four snapshots @1, fields exact (durably loadable BEFORE any runtime).
    const lease = await ledger.load(receipt.leaseRef);
    expect(lease.status).toBe("found");
    if (lease.status === "found") {
      const ls = lease.snapshot as TaskLeaseSnapshot;
      expect(ls.revision).toBe(1); expect(ls.holderRunId).toBe("run-a"); expect(ls.attemptId).toBe("att-a");
    }
    const attempt = await ledger.load(receipt.attemptRef);
    expect(attempt.status).toBe("found");
    if (attempt.status === "found") {
      const as = attempt.snapshot as TaskAttemptSnapshot;
      expect(as.revision).toBe(1); expect(as.status).toBe("claimed"); expect(as.runId).toBe("run-a");
    }
    const run = await ledger.load(receipt.runRef);
    expect(run.status).toBe("found");
    if (run.status === "found") {
      const rs = run.snapshot as RunSnapshot;
      expect(rs.revision).toBe(1); expect(rs.status).toBe("starting"); expect(rs.lastEventSeq).toBe(0); expect(rs.envelope).toBeNull();
    }
    const outbox = await ledger.load(receipt.outboxRef);
    expect(outbox.status).toBe("found");
    if (outbox.status === "found") {
      const os = outbox.snapshot as DispatchOutboxEntrySnapshot;
      expect(os.revision).toBe(1); expect(os.status).toBe("pending");
      expect(os.intent.intentId).toBe("att-a");
      expect(os.intent.taskId).toBe("task-run-adaptor");
      expect(os.intent.roleBinding.bindingId).toBe("binding-run-short-lived-v1");
      expect(os.intent.planRef.planId).toBe("plan-dispatch-mvp");
      expect(os.intent.requestedAt).toBe(FIXED);
    }

    // Exactly one TaskClaimed event; no AgentRun / TaskAttempt events.
    const page = await ledger.events({ afterCursor: null, limit: 1000 });
    const types = page.events.map((p) => p.event.eventType);
    expect(types.filter((t) => t === "TaskClaimed")).toHaveLength(1);
    expect(types).not.toContain("AgentRun");
    expect(types).not.toContain("TaskAttempt");
  });
});

describe("claimTask: competing claims", () => {
  it("parallel claims -> exactly one commit; loser revision_conflict, zero extra event", async () => {
    const { ledger, engine } = await setupAccepted();
    const a = claimCmd({ commandId: "cmd-race-a", attemptId: "att-a", runId: "run-a", idempotencyKey: "race-a" });
    const b = claimCmd({ commandId: "cmd-race-b", attemptId: "att-b", runId: "run-b", idempotencyKey: "race-b" });
    const results = await Promise.all([engine.claimTask(a), engine.claimTask(b)]);
    const committed = results.filter((r) => r.status === "committed");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(committed.length).toBe(1);
    expect(rejected.length).toBe(1);
    if (rejected[0]!.status !== "rejected") return;
    expect(rejected[0]!.code).toBe("revision_conflict");

    const page = await ledger.events({ afterCursor: null, limit: 1000 });
    expect(page.events.filter((p) => p.event.eventType === "TaskClaimed")).toHaveLength(1);
  });

  it("same run as the held lease (own prior claim) replays committed(replayed)", async () => {
    const { ledger, engine } = await setupAccepted();
    const deps = { commandId: "cmd-replay", attemptId: "att-r", runId: "run-r", idempotencyKey: "key-replay" };
    const first = await engine.claimTask(claimCmd(deps));
    expect(first.status).toBe("committed");
    if (first.status !== "committed") return;

    const again = await engine.claimTask(claimCmd(deps));
    expect(again.status).toBe("committed");
    if (again.status !== "committed") return;
    expect(again.replayed).toBe(true);
    expect(again.eventIds).toEqual(first.eventIds);
    expect(again.commitCursor).toEqual(first.commitCursor);

    // Different payload on the same key contends for the held lease -> revision_conflict.
    const other = await engine.claimTask(
      claimCmd({ commandId: "cmd-replay-b", attemptId: "att-r2", runId: "run-r2", idempotencyKey: "key-replay" }),
    );
    expect(other.status).toBe("rejected");
    if (other.status === "rejected") expect(other.code).toBe("revision_conflict");
  });
});

describe("claimTask: zero-write rejections", () => {
  it("ineligible task -> ineligible with issues, zero write", async () => {
    const { ledger, engine } = await setupAccepted();
    const before = await eventCount(ledger);
    const cmd = claimCmd({ commandId: "cmd-inel", taskId: DISPATCH_DEPENDENT_TASK_ID, attemptId: "att-i", runId: "run-i" });
    const receipt = await engine.claimTask(cmd);
    expect(receipt.status).toBe("rejected");
    if (receipt.status !== "rejected") return;
    expect(receipt.code).toBe("ineligible");
    expect(receipt.issues?.some((i) => i.code === "deps_unsatisfied")).toBe(true);
    expect(await eventCount(ledger)).toBe(before);
  });

  it("missing goal -> not_found, zero write", async () => {
    const { ledger, engine } = await setupAccepted();
    const before = await eventCount(ledger);
    const cmd = claimCmd({ commandId: "cmd-missing", goalId: "goal-absent", attemptId: "att-m", runId: "run-m" });
    const receipt = await engine.claimTask(cmd);
    expect(receipt).toEqual({ status: "rejected", commandId: cmd.commandId, code: "not_found" });
    expect(await eventCount(ledger)).toBe(before);
  });

  it("invalid command -> invalid, zero write", async () => {
    const { ledger, engine } = await setupAccepted();
    const before = await eventCount(ledger);
    const bad = { ...claimCmd({ commandId: "cmd-bad" }), schemaVersion: 99 } as unknown as DispatchClaimCommand;
    const receipt = await engine.claimTask(bad);
    expect(receipt).toEqual({ status: "rejected", commandId: bad.commandId, code: "invalid" });
    expect(await eventCount(ledger)).toBe(before);
  });
});
