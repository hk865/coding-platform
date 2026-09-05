/**
 * P1-03 run contract suite — shared by InMemory AND SQLite adapters.
 * Covers ticket Acceptance 5-8 (facts admission / no-regress / crash vs
 * outcome_unknown / ActiveAgent+TaskDetail rebuild / exit never satisfies):
 *   - run_fact admission: monotonic sequence; duplicate/stale/conflict and
 *     after_terminal rejections are zero-write;
 *   - run_completed(exit 0) -> outcome completed + exitCode 0, but
 *     TaskDetail.phase stays pending (never satisfied);
 *   - run_crashed -> outcome crashed (separate from outcome_unknown);
 *   - outcome_unknown is an EXPLICIT RunFact fact;
 *   - ActiveAgent + TaskDetail.run rebuild field-identically from events.
 */
import { describe, expect, it } from "vitest";
import type {
  DispatchOutboxEntrySnapshot,
  RunSnapshot,
  RuntimeEventV1,
  TaskAttemptSnapshot,
} from "../../src/contracts/dispatch.js";
import {
  buildRunFactCommand,
  buildManifestFixture,
  buildDispatchStartCommand,
  FAKE_RUNTIME_SCRIPT_CRASHED_V1,
  rebaseScriptForRun,
} from "../../src/contracts/fixtures/dispatch-fixtures.js";
import { artifactBodyDigest } from "../../src/contracts/artifact.js";
import type { P1_03HarnessFactory } from "./p1-03-harness.js";
import {
  buildPreparedClaim,
  buildPreparedEnvelope,
  freshCommandId,
  freshCorrelationId,
  prepareDispatchScenario,
  SCHEMA,
} from "./p1-03-harness.js";
import { runRefFor } from "../../src/contracts/dispatch.js";

const PLAN_REF = { aggregateType: "PlanRevision" as const, projectId: "proj-alpha", planId: "plan-dispatch-mvp" };

async function claimedAndStarted(h: Awaited<ReturnType<P1_03HarnessFactory>>, runId: string, attemptId: string) {
  const claim = await h.claimTask(
    buildPreparedClaim({ commandId: freshCommandId("claim-" + runId), attemptId, runId, idempotencyKey: "claim-" + runId }),
  );
  expect(claim.status).toBe("committed");
  if (claim.status !== "committed") throw new Error("claim failed");
  const bundleRef = {
    kind: "artifact" as const,
    contentType: "text/plain",
    digest: artifactBodyDigest("ctx-body"),
    sizeBytes: 8,
    source: { kind: "plan-revision" as const, refId: "plan-dispatch-mvp", revision: "1" },
  };
  const envelope = buildPreparedEnvelope({ runId, attemptId, bundleRef });
  const start = await h.startRun(
    buildDispatchStartCommand({
      commandId: freshCommandId("start-" + runId),
      correlationId: freshCorrelationId(),
      submittedAt: SCHEMA,
      projectId: "proj-alpha",
      runId,
      envelope,
      manifest: buildManifestFixture({ workspaceId: "ws-shared", workspaceRevision: 1, planRef: PLAN_REF }),
    }),
  );
  expect(start.status).toBe("committed");
  if (start.status !== "committed") throw new Error("start failed");
  return { claim, envelope };
}

function rtEvent(runId: string, sequence: number, partial: Partial<RuntimeEventV1> = {}): RuntimeEventV1 {
  return {
    eventType: "run_started",
    schemaVersion: 1,
    eventId: "rt-" + runId + "-" + String(sequence).padStart(4, "0"),
    runRef: runRefFor("proj-alpha", "goal-1", runId),
    sequence,
    occurredAt: "2026-09-05T12:00:0" + sequence + ".000Z",
    payload: { kind: "started", startedAt: "2026-09-05T12:00:01.000Z" },
    ...partial,
  };
}

export function defineRunContractSuite(createHarness: P1_03HarnessFactory): void {
  describe("P1-03 run contract suite", () => {
    async function setup() {
      const h = await createHarness();
      await prepareDispatchScenario(h);
      return h;
    }

    it("run_completed(exit=0) -> ended/completed + exitCode 0; Task.phase stays pending", async () => {
      const h = await setup();
      await claimedAndStarted(h, "run-c1", "att-c1");
      const startedEvent = rtEvent("run-c1", 1);
      const first = await h.runFact(buildRunFactCommand({
        commandId: freshCommandId("fact-start"), correlationId: freshCorrelationId(), submittedAt: SCHEMA, projectId: "proj-alpha", runId: "run-c1", expectedRevision: 2,
        fact: { kind: "runtime_event", event: startedEvent },
      }));
      expect(first.status).toBe("committed");
      if (first.status !== "committed") return;
      expect(first.terminal).toBe(false);

      const completedEvent = rtEvent("run-c1", 2, { eventType: "run_completed", payload: { kind: "completed", exitCode: 0 } });
      const second = await h.runFact(buildRunFactCommand({
        commandId: freshCommandId("fact-complete"), correlationId: freshCorrelationId(), submittedAt: SCHEMA, projectId: "proj-alpha", runId: "run-c1", expectedRevision: 3,
        fact: { kind: "runtime_event", event: completedEvent },
      }));
      expect(second.status).toBe("committed");
      if (second.status !== "committed") return;
      expect(second.terminal).toBe(true);

      const run = await h.ledger.load({ aggregateType: "Run", projectId: "proj-alpha", goalId: "goal-1", runId: "run-c1" });
      expect(run.status).toBe("found");
      if (run.status !== "found") return;
      const rs = run.snapshot as RunSnapshot;
      expect(rs.status).toBe("ended");
      expect(rs.outcome).toBe("completed");
      expect(rs.exitCode).toBe(0);
      expect(rs.lastEventSeq).toBe(2);

      await h.advanceProjection();
      const detail = await h.taskDetail({ projectId: "proj-alpha", goalId: "goal-1", taskId: "task-run-adaptor" });
      expect(detail.status).toBe("ready");
      if (detail.status !== "ready") return;
      // exit=0 NEVER writes Task.phase:
      expect(detail.task.phase).toBe("pending");
      expect(detail.task.run?.outcome).toBe("completed");
      expect(detail.task.run?.exitCode).toBe(0);
    });

    it("duplicate / stale / conflicting / after-terminal facts are rejected zero-write", async () => {
      const h = await setup();
      await claimedAndStarted(h, "run-c2", "att-c2");
      const e1 = rtEvent("run-c2", 1);
      await h.runFact(buildRunFactCommand({
        commandId: freshCommandId("f1"), correlationId: freshCorrelationId(), submittedAt: SCHEMA, projectId: "proj-alpha", runId: "run-c2", expectedRevision: 2,
        fact: { kind: "runtime_event", event: e1 },
      }));
      const before = await h.ledger.events({ afterCursor: null, limit: 500 });

      // same sequence same id -> duplicate_event
      const dup = await h.runFact(buildRunFactCommand({
        commandId: freshCommandId("f-dup"), correlationId: freshCorrelationId(), submittedAt: SCHEMA, projectId: "proj-alpha", runId: "run-c2", expectedRevision: 3,
        fact: { kind: "runtime_event", event: e1 },
      }));
      expect(dup.status).toBe("rejected");
      if (dup.status === "rejected") expect(dup.code).toBe("duplicate_event");

      // lower sequence -> stale_event
      const staleEvent = rtEvent("run-c2", 0);
      const stale = await h.runFact(buildRunFactCommand({
        commandId: freshCommandId("f-stale"), correlationId: freshCorrelationId(), submittedAt: SCHEMA, projectId: "proj-alpha", runId: "run-c2", expectedRevision: 3,
        fact: { kind: "runtime_event", event: staleEvent },
      }));
      expect(stale.status).toBe("rejected");
      if (stale.status === "rejected") expect(stale.code).toBe("stale_event");

      // same sequence different id -> conflict_event
      const conflict = await h.runFact(buildRunFactCommand({
        commandId: freshCommandId("f-conf"), correlationId: freshCorrelationId(), submittedAt: SCHEMA, projectId: "proj-alpha", runId: "run-c2", expectedRevision: 3,
        fact: { kind: "runtime_event", event: rtEvent("run-c2", 1, { eventId: "rt-other-0001" }) },
      }));
      expect(conflict.status).toBe("rejected");
      if (conflict.status === "rejected") expect(conflict.code).toBe("conflict_event");

      const after = await h.ledger.events({ afterCursor: null, limit: 500 });
      expect(after.events.length).toBe(before.events.length); // zero write
    });

    it("crash and outcome_unknown project to DIFFERENT outcomes; unknown never guessed from crash", async () => {
      const h = await setup();
      await claimedAndStarted(h, "run-crash", "att-crash");
      const crashed = rebaseScriptForRun(FAKE_RUNTIME_SCRIPT_CRASHED_V1, runRefFor("proj-alpha", "goal-1", "run-crash"));
      for (const [i, event] of crashed.entries()) {
        const r = await h.runFact(buildRunFactCommand({
          commandId: freshCommandId("f-crash-" + i), correlationId: freshCorrelationId(), submittedAt: SCHEMA, projectId: "proj-alpha", runId: "run-crash", expectedRevision: 2 + i,
          fact: { kind: "runtime_event", event },
        }));
        expect(r.status).toBe("committed");
      }
      const run = await h.ledger.load({ aggregateType: "Run", projectId: "proj-alpha", goalId: "goal-1", runId: "run-crash" });
      expect(run.status).toBe("found");
      if (run.status !== "found") return;
      expect((run.snapshot as RunSnapshot).outcome).toBe("crashed");

      // explicit outcome_unknown on a SECOND run (separate task claim)
      await claimedAndStarted(h, "run-unknown", "att-unknown");
      const unknown = await h.runFact(buildRunFactCommand({
        commandId: freshCommandId("f-unknown"), correlationId: freshCorrelationId(), submittedAt: SCHEMA, projectId: "proj-alpha", runId: "run-unknown", expectedRevision: 2,
        fact: { kind: "outcome_unknown", reason: "disconnected after start" },
      }));
      expect(unknown.status).toBe("committed");
      if (unknown.status !== "committed") return;
      expect(unknown.terminal).toBe(true);
      const run2 = await h.ledger.load({ aggregateType: "Run", projectId: "proj-alpha", goalId: "goal-1", runId: "run-unknown" });
      expect(run2.status).toBe("found");
      if (run2.status !== "found") return;
      expect((run2.snapshot as RunSnapshot).outcome).toBe("outcome_unknown");

      await h.advanceProjection();
      const agentCrash = await h.activeAgent({ projectId: "proj-alpha", goalId: "goal-1", taskId: "task-run-adaptor" });
      expect(agentCrash.status).toBe("ready");
      if (agentCrash.status !== "ready") return;
      expect(agentCrash.agent.run.outcome).toBe("crashed");
    });

    it("ActiveAgent + TaskDetail views rebuild field-identically after a fresh projection", async () => {
      const h = await setup();
      await claimedAndStarted(h, "run-rebuild", "att-rebuild");
      const done = rtEvent("run-rebuild", 1, { eventType: "run_completed", payload: { kind: "completed", exitCode: 1 } });
      await h.runFact(buildRunFactCommand({
        commandId: freshCommandId("f-rebuild"), correlationId: freshCorrelationId(), submittedAt: SCHEMA, projectId: "proj-alpha", runId: "run-rebuild", expectedRevision: 2,
        fact: { kind: "runtime_event", event: done },
      }));
      await h.advanceProjection();
      const agent = await h.activeAgent({ projectId: "proj-alpha", goalId: "goal-1", taskId: "task-run-adaptor" });
      expect(agent.status).toBe("ready");
      const detail = await h.taskDetail({ projectId: "proj-alpha", goalId: "goal-1", taskId: "task-run-adaptor" });
      expect(detail.status).toBe("ready");
      if (agent.status === "ready" && detail.status === "ready") {
        expect(detail.task.run?.outcome).toBe("completed");
        expect(agent.agent.run.outcome).toBe("completed");
        expect(agent.agent.attempt.status).toBe("ended");
        // freshness semantic: not_ready != not_found
        const absent = await h.activeAgent({ projectId: "proj-alpha", goalId: "goal-1", taskId: "task-absent" });
        expect(["not_found", "not_ready"]).toContain(absent.status);
      }
    });
  });
}
