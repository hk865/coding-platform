/**
 * P1-03 lane D — SQLite ActiveAgent + TaskDetail.run projection.
 * Mirrors tests/read-model/p1-03-run-projection.test.ts field-for-field (same
 * EventPage stream, same assertions) against the SQLite adapter, and adds the
 * rebuild / file-reopen equivalence for the run projection.
 *
 * Focus: TaskClaimed/RunStarted/RunEventRecorded/RunOutcomeUnknown fold into the
 * (projectId, goalId, taskId) active_agent row + task_detail.run_json; crash !=
 * outcome_unknown; exit never writes Task.phase; opaque-cursor freshness; full
 * scope isolation; dedupe idempotency; fresh-file rebuild reproduces the same
 * view.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSqliteReadModelIndex } from "../../src/sqlite-read-model/sqlite-read-model-index.js";
import type { ReadModelIndex } from "../../src/contracts/goal-view.js";
import type { CommitCursor } from "../../src/contracts/command-event.js";
import type { DomainEvent } from "../../src/contracts/events.js";
import type { EventPage, PositionedEvent } from "../../src/contracts/ledger.js";
import { makeCommitCursor } from "../../src/contracts/ledger.js";
import {
  MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1,
  buildCreateGoalCommand,
  goalCreatedEventFor,
} from "../../src/contracts/fixtures/goal-fixtures.js";
import {
  buildApplyPlanCommand,
  planRevisionSnapshotFor,
  planRevisionAcceptedEventFor,
} from "../../src/contracts/fixtures/plan-fixtures.js";
import {
  ARCHITECTURE_BASELINE_FIXTURE_V1,
  COMPLETION_POLICY_FIXTURE_V1,
  buildInstallCommand,
  completionPolicyPinFor,
  architectureBaselinePinFor,
} from "../../src/contracts/fixtures/governance-fixtures.js";
import {
  BUDGET_FIXTURE_V1,
  DECLARED_PERMISSIONS_FIXTURE_V1,
  DISPATCH_ELIGIBLE_TASK_ID,
  DISPATCH_PLAN_REVISION_FIXTURE_V1,
  FAKE_RUNTIME_SCRIPT_COMPLETED_V1,
  FAKE_RUNTIME_SCRIPT_CRASHED_V1,
  ROLE_BINDING_FIXTURE_V1,
  buildEnvelopeFixture,
  buildManifestFixture,
  rebaseScriptForRun,
} from "../../src/contracts/fixtures/dispatch-fixtures.js";
import { artifactBodyDigest } from "../../src/contracts/artifact.js";
import {
  runRefFor,
  taskAttemptRefFor,
  type RoleBindingRefV1,
  type RunOutcomeUnknownEvent,
  type RunStartedEvent,
  type RunEventRecordedEvent,
  type RuntimeEventV1,
  type TaskBudgetV1,
  type TaskClaimedEvent,
} from "../../src/contracts/dispatch.js";
import type { PlanRevisionSnapshot } from "../../src/contracts/plan.js";
import type { PlanRevisionRef } from "../../src/contracts/plan.js";
import { FIXED_ISO_2026_09_05 } from "../../src/contracts/testing/sequences.js";

const OCCURRED = FIXED_ISO_2026_09_05;
const ACCEPTED_AT = "2026-09-05T12:00:00.000Z";
const FIX = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1;
type Scope = 0 | 1;

function scopeOf(scope: Scope) {
  return FIX.scopes[scope]!;
}
function projectOf(scope: Scope): string {
  return scopeOf(scope).projectId;
}

function planRefFor(projectId: string): PlanRevisionRef {
  return { aggregateType: "PlanRevision", projectId, planId: "plan-dispatch-mvp" };
}

function cpPin(projectId: string) {
  const cmd = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, {
    commandId: "cmd-cp",
    correlationId: "corr-cp",
    submittedAt: OCCURRED,
    projectId,
  });
  if (cmd.commandType !== "InstallCompletionPolicyRevision") throw new Error("cp kind");
  return completionPolicyPinFor(cmd);
}

function abPin(projectId: string) {
  const cmd = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, {
    commandId: "cmd-ab",
    correlationId: "corr-ab",
    submittedAt: OCCURRED,
    projectId,
  });
  if (cmd.commandType !== "InstallArchitectureBaselineRevision") throw new Error("ab kind");
  return architectureBaselinePinFor(cmd);
}

function goalEventAt(seq: number, scope: Scope, idx: string): PositionedEvent {
  return { cursor: makeCommitCursor(seq), event: goalEventFor(scope, idx) };
}

function goalEventFor(scope: Scope, idx: string): DomainEvent {
  const data = scopeOf(scope);
  const cmd = buildCreateGoalCommand(data, {
    commandId: "cmd-goal-" + idx,
    correlationId: "corr-goal-" + idx,
    submittedAt: OCCURRED,
  });
  return goalCreatedEventFor(cmd, { eventId: "evt-goal-" + idx, occurredAt: OCCURRED });
}

function planEventAt(seq: number, scope: Scope, idx: string): PositionedEvent {
  const projectId = projectOf(scope);
  const cmd = buildApplyPlanCommand(DISPATCH_PLAN_REVISION_FIXTURE_V1, {
    commandId: "cmd-plan-" + idx,
    correlationId: "corr-plan-" + idx,
    submittedAt: OCCURRED,
    projectId,
    expectedRevision: 1,
    idempotencyKey: "apply-plan-" + idx,
  });
  const snapshot: PlanRevisionSnapshot = planRevisionSnapshotFor(
    cmd,
    { completionPolicy: cpPin(projectId), architectureBaseline: abPin(projectId) },
    ACCEPTED_AT,
  );
  return { cursor: makeCommitCursor(seq), event: planEventFor(scope, idx) };
}

function planEventFor(scope: Scope, idx: string): DomainEvent {
  const projectId = projectOf(scope);
  const cmd = buildApplyPlanCommand(DISPATCH_PLAN_REVISION_FIXTURE_V1, {
    commandId: "cmd-plan-" + idx,
    correlationId: "corr-plan-" + idx,
    submittedAt: OCCURRED,
    projectId,
    expectedRevision: 1,
    idempotencyKey: "apply-plan-" + idx,
  });
  const snapshot = planRevisionSnapshotFor(
    cmd,
    { completionPolicy: cpPin(projectId), architectureBaseline: abPin(projectId) },
    ACCEPTED_AT,
  );
  return planRevisionAcceptedEventFor(cmd, {
    eventId: "evt-plan-" + idx,
    occurredAt: OCCURRED,
    workspaceId: scopeOf(scope).workspaceId,
    goalAggregateRevision: 2,
    planSnapshot: snapshot,
  });
}

type RunScenario = {
  scope: Scope;
  runId: string;
  attemptId: string;
  prefix: string;
  facts: RuntimeEventV1[];
  outcomeUnknown?: { reason: string; observedAt: string };
  roleBinding?: RoleBindingRefV1;
  budget?: TaskBudgetV1;
};

function scenarioEvents(sc: RunScenario): DomainEvent[] {
  const projectId = projectOf(sc.scope);
  const goalId = scopeOf(sc.scope).goalId;
  const workspaceId = scopeOf(sc.scope).workspaceId;
  const taskId = DISPATCH_ELIGIBLE_TASK_ID;
  const runRef = runRefFor(projectId, goalId, sc.runId);
  const attemptRef = taskAttemptRefFor(projectId, goalId, taskId, sc.attemptId);
  const roleBinding = sc.roleBinding ?? ROLE_BINDING_FIXTURE_V1;
  const budget = sc.budget ?? BUDGET_FIXTURE_V1;

  const goal = goalEventFor(sc.scope, sc.prefix + "g");
  const plan = planEventFor(sc.scope, sc.prefix + "p");

  const claim: TaskClaimedEvent = {
    eventId: "evt-" + sc.prefix + "-claim",
    eventType: "TaskClaimed",
    schemaVersion: 1,
    projectId,
    workspaceId,
    aggregateType: "TaskLease",
    aggregateId: taskId,
    aggregateRevision: 1,
    causationId: "cause-" + sc.prefix + "-claim",
    correlationId: "corr-" + sc.prefix + "-claim",
    idempotencyKey: "idem-" + sc.prefix + "-claim",
    actor: { kind: "human", id: "user-1" },
    occurredAt: OCCURRED,
    payload: {
      goalId,
      taskId,
      attemptRef,
      runRef,
      planRef: planRefFor(projectId),
      roleBinding,
      declaredPermissions: { tools: [...DECLARED_PERMISSIONS_FIXTURE_V1.tools], writeScope: [...DECLARED_PERMISSIONS_FIXTURE_V1.writeScope] },
      budget,
      intentId: sc.attemptId,
      claimedAt: OCCURRED,
    },
  };

  const envelope = buildEnvelopeFixture({
    envelopeId: "envelope-" + sc.runId,
    projectId,
    workspaceId,
    goalId,
    taskId,
    runId: sc.runId,
    attemptId: sc.attemptId,
    planRef: planRefFor(projectId),
    workspaceRevision: 1,
    bundleRef: {
      kind: "artifact",
      contentType: "text/plain",
      digest: artifactBodyDigest("p1-03-bundle-body"),
      sizeBytes: 16,
      source: { kind: "plan-revision", refId: "plan-dispatch-mvp", revision: "1" },
    },
  });
  const manifest = buildManifestFixture({ workspaceId, workspaceRevision: 1, planRef: planRefFor(projectId) });

  const start: RunStartedEvent = {
    eventId: "evt-" + sc.prefix + "-start",
    eventType: "RunStarted",
    schemaVersion: 1,
    projectId,
    workspaceId,
    aggregateType: "Run",
    aggregateId: sc.runId,
    aggregateRevision: 2,
    causationId: "cause-" + sc.prefix + "-start",
    correlationId: "corr-" + sc.prefix + "-start",
    idempotencyKey: "idem-" + sc.prefix + "-start",
    actor: { kind: "human", id: "user-1" },
    occurredAt: OCCURRED,
    payload: { taskId, attemptId: sc.attemptId, envelope, manifest, startedAt: OCCURRED },
  };

  const events: DomainEvent[] = [goal, plan, claim, start];
  for (const [i, rt] of sc.facts.entries()) {
    const fact: RunEventRecordedEvent = {
      eventId: "evt-" + sc.prefix + "-fact-" + rt.sequence,
      eventType: "RunEventRecorded",
      schemaVersion: 1,
      projectId,
      workspaceId,
      aggregateType: "Run",
      aggregateId: sc.runId,
      aggregateRevision: 3 + i,
      causationId: "cause-" + sc.prefix + "-fact-" + rt.sequence,
      correlationId: "corr-" + sc.prefix + "-fact-" + rt.sequence,
      idempotencyKey: "idem-" + sc.prefix + "-fact-" + rt.sequence,
      actor: { kind: "human", id: "user-1" },
      occurredAt: OCCURRED,
      payload: { taskId, runtimeEvent: rt },
    };
    events.push(fact);
  }
  if (sc.outcomeUnknown) {
    const u: RunOutcomeUnknownEvent = {
      eventId: "evt-" + sc.prefix + "-unknown",
      eventType: "RunOutcomeUnknown",
      schemaVersion: 1,
      projectId,
      workspaceId,
      aggregateType: "Run",
      aggregateId: sc.runId,
      aggregateRevision: 3 + sc.facts.length,
      causationId: "cause-" + sc.prefix + "-unknown",
      correlationId: "corr-" + sc.prefix + "-unknown",
      idempotencyKey: "idem-" + sc.prefix + "-unknown",
      actor: { kind: "human", id: "user-1" },
      occurredAt: OCCURRED,
      payload: { taskId, reason: sc.outcomeUnknown.reason, observedAt: sc.outcomeUnknown.observedAt },
    };
    events.push(u);
  }
  return events;
}

function positioned(events: DomainEvent[], startSeq: number): PositionedEvent[] {
  return events.map((event, i) => ({ cursor: makeCommitCursor(startSeq + i), event }));
}

function pageOf(positionedEvents: PositionedEvent[]): EventPage {
  return {
    afterCursor: null,
    throughCursor: positionedEvents.at(-1)?.cursor ?? null,
    events: [...positionedEvents],
    hasMore: false,
  };
}

function rebased(script: typeof FAKE_RUNTIME_SCRIPT_COMPLETED_V1, projectId: string, goalId: string, runId: string): RuntimeEventV1[] {
  return rebaseScriptForRun(script, runRefFor(projectId, goalId, runId));
}

async function advanceAll(index: ReadModelIndex, pages: EventPage[]): Promise<void> {
  for (const page of pages) await index.advance(page);
}

const ALPHA = scopeOf(0);
const BETA = scopeOf(1);

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

// ----------------------------------------------------------------------- //

describe("SqliteReadModelIndex active agent + task-run projection (P1-03)", () => {
  it("claim -> start -> facts: ActiveAgent + TaskDetail.run fold field-for-field", async () => {
    const dir = await tempDir("p1-03-rm-");
    const index = createSqliteReadModelIndex({ path: join(dir, "a.sqlite") });
    try {
      const sc: RunScenario = {
        scope: 0,
        runId: "run-full",
        attemptId: "att-full",
        prefix: "full",
        facts: rebased(FAKE_RUNTIME_SCRIPT_COMPLETED_V1, ALPHA.projectId, ALPHA.goalId, "run-full"),
      };
      await index.advance(pageOf(positioned(scenarioEvents(sc), 1)));

      const agent = await index.activeAgent({
        projectId: ALPHA.projectId,
        goalId: ALPHA.goalId,
        taskId: DISPATCH_ELIGIBLE_TASK_ID,
        atLeastCursor: makeCommitCursor(6),
      });
      expect(agent.status).toBe("ready");
      if (agent.status !== "ready") return;
      expect(agent.agent.lease.holderRunId).toBe("run-full");
      expect(agent.agent.lease.expiresAt).toBeNull();
      expect(agent.agent.lease.grantedAt).toBe(OCCURRED);
      expect(agent.agent.run.status).toBe("ended");
      expect(agent.agent.run.outcome).toBe("completed");
      expect(agent.agent.run.exitCode).toBe(0);
      expect(agent.agent.run.lastEventSeq).toBe(2);
      expect(agent.agent.run.startedAt).toBe(OCCURRED);
      expect(agent.agent.run.endedAt).toBe("2026-09-05T12:00:03.000Z");
      expect(agent.agent.run.budget).toEqual(BUDGET_FIXTURE_V1);
      expect(agent.agent.attempt.status).toBe("ended");
      expect(agent.agent.attempt.endOutcome).toBe("completed");
      expect(agent.agent.attempt.endedAt).toBe("2026-09-05T12:00:03.000Z");

      const detail = await index.taskDetail({
        projectId: ALPHA.projectId,
        goalId: ALPHA.goalId,
        taskId: DISPATCH_ELIGIBLE_TASK_ID,
        atLeastCursor: makeCommitCursor(6),
      });
      expect(detail.status).toBe("ready");
      if (detail.status !== "ready") return;
      expect(detail.task.phase).toBe("pending");
      expect(detail.task.run?.status).toBe("ended");
      expect(detail.task.run?.outcome).toBe("completed");
      expect(detail.task.run?.exitCode).toBe(0);
      expect(detail.task.run?.lastEventSeq).toBe(2);
      expect(detail.task.run?.budget).toEqual(BUDGET_FIXTURE_V1);
      expect(detail.task.run?.binding).toEqual(ROLE_BINDING_FIXTURE_V1);
      expect(detail.task.run?.runRef.runId).toBe("run-full");
      expect(detail.task.run?.attemptRef.attemptId).toBe("att-full");
    } finally {
      await index.close();
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("crash and outcome_unknown project to DIFFERENT outcomes (unknown never guessed from crash)", async () => {
    const dir = await tempDir("p1-03-rm-");
    const index = createSqliteReadModelIndex({ path: join(dir, "a.sqlite") });
    try {
      const crash: RunScenario = {
        scope: 0,
        runId: "run-crash",
        attemptId: "att-crash",
        prefix: "crash",
        facts: rebased(FAKE_RUNTIME_SCRIPT_CRASHED_V1, ALPHA.projectId, ALPHA.goalId, "run-crash"),
      };
      if (crash.facts[1]!.payload.kind !== "crashed") throw new Error("fixture kind");
      await index.advance(pageOf(positioned(scenarioEvents(crash), 1)));
      const agentCrash = await index.activeAgent({
        projectId: ALPHA.projectId,
        goalId: ALPHA.goalId,
        taskId: DISPATCH_ELIGIBLE_TASK_ID,
        atLeastCursor: makeCommitCursor(6),
      });
      expect(agentCrash.status).toBe("ready");
      if (agentCrash.status !== "ready") return;
      expect(agentCrash.agent.run.outcome).toBe("crashed");
      expect(agentCrash.agent.run.status).toBe("ended");
      expect(agentCrash.agent.attempt.endOutcome).toBe("crashed");

      const unknown: RunScenario = {
        scope: 0,
        runId: "run-unknown",
        attemptId: "att-unknown",
        prefix: "unknown",
        facts: [],
        outcomeUnknown: { reason: "disconnected after start", observedAt: "2026-09-05T12:00:04.000Z" },
      };
      const unknownCount = scenarioEvents(unknown).length;
      await index.advance(pageOf(positioned(scenarioEvents(unknown), 7)));
      const agentUnknown = await index.activeAgent({
        projectId: ALPHA.projectId,
        goalId: ALPHA.goalId,
        taskId: DISPATCH_ELIGIBLE_TASK_ID,
        atLeastCursor: makeCommitCursor(7 + unknownCount - 1),
      });
      expect(agentUnknown.status).toBe("ready");
      if (agentUnknown.status !== "ready") return;
      expect(agentUnknown.agent.run.outcome).toBe("outcome_unknown");
      expect(agentUnknown.agent.run.status).toBe("ended");
      expect(agentUnknown.agent.attempt.endOutcome).toBe("outcome_unknown");
      expect(agentUnknown.agent.sourceCursor).toBe(makeCommitCursor(7 + unknownCount - 1));
    } finally {
      await index.close();
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("fresh file rebuilt from the same pages reproduces the projection field-for-field", async () => {
    const dir = await tempDir("p1-03-rm-");
    const inc = createSqliteReadModelIndex({ path: join(dir, "inc.sqlite") });
    const fresh = createSqliteReadModelIndex({ path: join(dir, "fresh.sqlite") });
    try {
      const sc: RunScenario = {
        scope: 0,
        runId: "run-rebuild",
        attemptId: "att-rebuild",
        prefix: "rebuild",
        facts: rebased(FAKE_RUNTIME_SCRIPT_COMPLETED_V1, ALPHA.projectId, ALPHA.goalId, "run-rebuild"),
      };
      const page = pageOf(positioned(scenarioEvents(sc), 1));
      await inc.advance(page);
      await fresh.advance(pageOf([...page.events.map((e) => ({ ...e }))]));

      const incAgent = await inc.activeAgent({
        projectId: ALPHA.projectId, goalId: ALPHA.goalId, taskId: DISPATCH_ELIGIBLE_TASK_ID, atLeastCursor: makeCommitCursor(6),
      });
      const freshAgent = await fresh.activeAgent({
        projectId: ALPHA.projectId, goalId: ALPHA.goalId, taskId: DISPATCH_ELIGIBLE_TASK_ID, atLeastCursor: makeCommitCursor(6),
      });
      const incDetail = await inc.taskDetail({
        projectId: ALPHA.projectId, goalId: ALPHA.goalId, taskId: DISPATCH_ELIGIBLE_TASK_ID, atLeastCursor: makeCommitCursor(6),
      });
      const freshDetail = await fresh.taskDetail({
        projectId: ALPHA.projectId, goalId: ALPHA.goalId, taskId: DISPATCH_ELIGIBLE_TASK_ID, atLeastCursor: makeCommitCursor(6),
      });
      expect(freshAgent).toEqual(incAgent);
      expect(freshDetail).toEqual(incDetail);
    } finally {
      await inc.close();
      await fresh.close();
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("full-scope isolation: same goalId/taskId under different Projects never collide", async () => {
    const dir = await tempDir("p1-03-rm-");
    const index = createSqliteReadModelIndex({ path: join(dir, "a.sqlite") });
    try {
      const alpha: RunScenario = {
        scope: 0, runId: "run-iso-a", attemptId: "att-iso-a", prefix: "isoa",
        facts: rebased(FAKE_RUNTIME_SCRIPT_COMPLETED_V1, ALPHA.projectId, ALPHA.goalId, "run-iso-a"),
      };
      const beta: RunScenario = {
        scope: 1, runId: "run-iso-b", attemptId: "att-iso-b", prefix: "isob",
        facts: rebased(FAKE_RUNTIME_SCRIPT_COMPLETED_V1, BETA.projectId, BETA.goalId, "run-iso-b"),
      };
      const allEvents = [...scenarioEvents(alpha), ...scenarioEvents(beta)];
      await index.advance(pageOf(positioned(allEvents, 1)));
      const agentAlpha = await index.activeAgent({
        projectId: ALPHA.projectId, goalId: ALPHA.goalId, taskId: DISPATCH_ELIGIBLE_TASK_ID, atLeastCursor: makeCommitCursor(allEvents.length),
      });
      const agentBeta = await index.activeAgent({
        projectId: BETA.projectId, goalId: BETA.goalId, taskId: DISPATCH_ELIGIBLE_TASK_ID, atLeastCursor: makeCommitCursor(allEvents.length),
      });
      expect(agentAlpha.status).toBe("ready");
      expect(agentBeta.status).toBe("ready");
      if (agentAlpha.status === "ready") {
        expect(agentAlpha.agent.projectId).toBe(ALPHA.projectId);
        expect(agentAlpha.agent.runRef.runId).toBe("run-iso-a");
      }
      if (agentBeta.status === "ready") {
        expect(agentBeta.agent.projectId).toBe(BETA.projectId);
        expect(agentBeta.agent.runRef.runId).toBe("run-iso-b");
      }
    } finally {
      await index.close();
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("freshness: not_ready != not_found for the active agent view", async () => {
    const dir = await tempDir("p1-03-rm-");
    const index = createSqliteReadModelIndex({ path: join(dir, "a.sqlite") });
    try {
      const early = await index.activeAgent({
        projectId: ALPHA.projectId, goalId: ALPHA.goalId, taskId: DISPATCH_ELIGIBLE_TASK_ID,
      });
      expect(early.status).toBe("not_ready");

      const sc: RunScenario = {
        scope: 0, runId: "run-fresh", attemptId: "att-fresh", prefix: "fresh",
        facts: rebased(FAKE_RUNTIME_SCRIPT_COMPLETED_V1, ALPHA.projectId, ALPHA.goalId, "run-fresh"),
      };
      const n = scenarioEvents(sc).length;
      await index.advance(pageOf(positioned(scenarioEvents(sc), 1)));
      const missing = await index.activeAgent({
        projectId: ALPHA.projectId, goalId: ALPHA.goalId, taskId: "task-absent", atLeastCursor: makeCommitCursor(n),
      });
      expect(missing.status).toBe("not_found");
      const noCursor = await index.activeAgent({
        projectId: ALPHA.projectId, goalId: ALPHA.goalId, taskId: "task-absent",
      });
      expect(noCursor.status).toBe("not_ready");
      const behind = await index.activeAgent({
        projectId: ALPHA.projectId, goalId: ALPHA.goalId, taskId: DISPATCH_ELIGIBLE_TASK_ID, atLeastCursor: makeCommitCursor(n + 100),
      });
      expect(behind.status).toBe("not_ready");
      if (behind.status === "not_ready") expect(behind.requiredCursor).toBe(makeCommitCursor(n + 100));
    } finally {
      await index.close();
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("dedupe: re-advancing the same page is idempotent (no re-apply, no base advance)", async () => {
    const dir = await tempDir("p1-03-rm-");
    const index = createSqliteReadModelIndex({ path: join(dir, "a.sqlite") });
    try {
      const sc: RunScenario = {
        scope: 0, runId: "run-dedupe", attemptId: "att-dedupe", prefix: "dedupe",
        facts: rebased(FAKE_RUNTIME_SCRIPT_COMPLETED_V1, ALPHA.projectId, ALPHA.goalId, "run-dedupe"),
      };
      const page = pageOf(positioned(scenarioEvents(sc), 1));
      const first = await index.advance(page);
      expect(first.appliedEventIds.length).toBeGreaterThan(0);
      const second = await index.advance(page);
      expect(second.appliedEventIds).toEqual([]);
      const agent = await index.activeAgent({
        projectId: ALPHA.projectId, goalId: ALPHA.goalId, taskId: DISPATCH_ELIGIBLE_TASK_ID, atLeastCursor: makeCommitCursor(6),
      });
      expect(agent.status).toBe("ready");
      if (agent.status === "ready") {
        expect(agent.agent.run.outcome).toBe("completed");
        expect(agent.agent.run.lastEventSeq).toBe(2);
      }
    } finally {
      await index.close();
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("late/stale runtime event (sequence <= lastEventSeq) does not regress the fold", async () => {
    const dir = await tempDir("p1-03-rm-");
    const index = createSqliteReadModelIndex({ path: join(dir, "a.sqlite") });
    try {
      const sc: RunScenario = {
        scope: 0, runId: "run-late", attemptId: "att-late", prefix: "late",
        facts: rebased(FAKE_RUNTIME_SCRIPT_COMPLETED_V1, ALPHA.projectId, ALPHA.goalId, "run-late"),
      };
      await index.advance(pageOf(positioned(scenarioEvents(sc), 1)));

      const staleRt: RuntimeEventV1 = {
        eventType: "run_started",
        schemaVersion: 1,
        eventId: "rt-run-late-0001",
        runRef: runRefFor(ALPHA.projectId, ALPHA.goalId, "run-late"),
        sequence: 1,
        occurredAt: "2026-09-05T12:00:01.000Z",
        payload: { kind: "started", startedAt: "2026-09-05T12:00:01.000Z" },
      };
      const staleFact: RunEventRecordedEvent = {
        eventId: "evt-late-stale",
        eventType: "RunEventRecorded",
        schemaVersion: 1,
        projectId: ALPHA.projectId,
        workspaceId: ALPHA.workspaceId,
        aggregateType: "Run",
        aggregateId: "run-late",
        aggregateRevision: 5,
        causationId: "cause-late-stale",
        correlationId: "corr-late-stale",
        idempotencyKey: "idem-late-stale",
        actor: { kind: "human", id: "user-1" },
        occurredAt: OCCURRED,
        payload: { taskId: DISPATCH_ELIGIBLE_TASK_ID, runtimeEvent: staleRt },
      };
      await index.advance(pageOf(positioned([staleFact], 7)));
      const agent = await index.activeAgent({
        projectId: ALPHA.projectId, goalId: ALPHA.goalId, taskId: DISPATCH_ELIGIBLE_TASK_ID, atLeastCursor: makeCommitCursor(7),
      });
      expect(agent.status).toBe("ready");
      if (agent.status === "ready") {
        expect(agent.agent.run.status).toBe("ended");
        expect(agent.agent.run.outcome).toBe("completed");
        expect(agent.agent.run.exitCode).toBe(0);
        expect(agent.agent.run.lastEventSeq).toBe(2);
      }
    } finally {
      await index.close();
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
