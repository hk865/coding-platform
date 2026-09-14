/**
 * P1-03 integration test — REAL SQLite adapters + REAL dispatch/run modules
 * (SqliteStateLedger + SqliteReadModelIndex + ControlEngineImpl + ArtifactVault
 * + ContextCompilerImpl + FakeRuntimeAdapter + DispatchEngineImpl), no fakes.
 * The contract suites (p1-03.contract-suite.*.test.ts) already run the SAME
 * suites against InMemory + SQLite; THIS file adds what they do not drive:
 *   T1: outbox -> drive (claim -> assemble via ContextCompiler/vault -> start ->
 *       FakeRuntime facts) -> views -> close/reopen field-identical;
 *   T2: two Dispatchers competing on the SAME task over real SQLite
 *       (concurrent, at most one lease/Attempt succeeds).
 */
import { describe, expect, it } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { ControlEngineImpl } from "../../src/control/control-engine/control-engine.js";
import type {
  DispatchOutboxEntrySnapshot,
  RunSnapshot,
  TaskAttemptSnapshot,
  TaskLeaseSnapshot,
} from "../../src/contracts/dispatch.js";
import { sequenceIdGen } from "../../src/testing/sequences.js";
import type { P1_03TestHarness } from "../contract-suite/p1-03-harness.js";
import {
  buildPreparedClaim,
  prepareDispatchScenario,
} from "../contract-suite/p1-03-harness.js";
import { FAKE_RUNTIME_SCRIPT_COMPLETED_V1 } from "../../src/fixtures/dispatch-fixtures.js";

const SCHEMA = "2026-09-05T12:00:00.000Z";
const PROJECT = "proj-alpha";
const GOAL = "goal-1";
const TASK = "task-run-adaptor";

describe("P1-03 integration (real SQLite + real dispatch/run modules)", () => {
  it("T1: claim -> drive (ContextCompiler+Vault+start+facts, outbox first) -> views -> close/reopen identical", async () => {
    const h = await createPersistentSqliteHarness({ deps: {}, runtimeScript: FAKE_RUNTIME_SCRIPT_COMPLETED_V1 });
    try {
      const th: P1_03TestHarness = {
        ...h,
        bootstrap: h.bootstrap,
        submit: (c) => h.control.submit(c),
        install: h.install,
        activate: h.activate,
        applyPlan: h.applyPlan,
        advanceProjection: h.advanceProjection,
        observedCursor: h.observedCursor,
        planGraph: h.planGraph,
        taskDetail: h.taskDetail,
        activeAgent: h.activeAgent,
        dispatchReadiness: h.dispatchReadiness,
        claimTask: h.claimTask,
        startRun: h.startRun,
        runFact: h.runFact,
        drive: h.drive,
      };
      await prepareDispatchScenario(th);

      const claim = await h.claimTask(
        buildPreparedClaim({ commandId: "cmd-int-claim", attemptId: "att-int-1", runId: "run-int-1", idempotencyKey: "int-claim-1" }),
      );
      expect(claim.status).toBe("committed");
      if (claim.status !== "committed") return;

      // drive: assemble (real ContextCompiler + ArtifactVault) -> start ->
      // FakeRuntime events; the outbox intent was durably PENDING after claim
      // and becomes STARTED before the runtime is ever invoked (drive order).
      const drive = await h.drive({ reason: "p1-03 integration", maxIntents: 8 });
      expect(drive.started).toBe(1);
      expect(drive.completed).toBe(1);
      expect(drive.pendingRemaining).toBe(0);
      expect(drive.failures).toEqual([]);

      const runRef = { aggregateType: "Run" as const, projectId: PROJECT, goalId: GOAL, runId: "run-int-1" };
      const run = await h.ledger.load(runRef);
      expect(run.status).toBe("found");
      if (run.status !== "found") return;
      const rs = run.snapshot as RunSnapshot;
      expect(rs.status).toBe("ended");
      expect(rs.outcome).toBe("completed");
      expect(rs.exitCode).toBe(0);
      expect(rs.lastEventSeq).toBe(2);
      expect(rs.envelope).not.toBeNull();

      const outbox = await h.ledger.load(claim.outboxRef);
      expect(outbox.status).toBe("found");
      if (outbox.status !== "found") return;
      expect((outbox.snapshot as DispatchOutboxEntrySnapshot).status).toBe("done");
      const attempt = await h.ledger.load(claim.attemptRef);
      expect(attempt.status).toBe("found");
      if (attempt.status !== "found") return;
      expect((attempt.snapshot as TaskAttemptSnapshot).status).toBe("ended");
      const lease = await h.ledger.load(claim.leaseRef);
      expect(lease.status).toBe("found");
      if (lease.status !== "found") return;
      expect((lease.snapshot as TaskLeaseSnapshot).holderRunId).toBe("run-int-1");

      await h.advanceProjection();
      const agent = await h.activeAgent({ projectId: PROJECT, goalId: GOAL, taskId: TASK });
      expect(agent.status).toBe("ready");
      if (agent.status !== "ready") return;
      expect(agent.agent.run.outcome).toBe("completed");
      const detail = await h.taskDetail({ projectId: PROJECT, goalId: GOAL, taskId: TASK });
      expect(detail.status).toBe("ready");
      if (detail.status !== "ready") return;
      expect(detail.task.run?.outcome).toBe("completed");
      expect(detail.task.phase).toBe("pending"); // exit=0 NEVER satisfies

      const before = {
        outbox: JSON.stringify(outbox.snapshot),
        lease: JSON.stringify(lease.snapshot),
        attempt: JSON.stringify(attempt.snapshot),
        run: JSON.stringify(rs),
        agent: JSON.stringify(agent.agent),
        detail: JSON.stringify(detail.task),
        cursor: h.observedCursor(),
      };

      await h.close();
      const restarted = await h.reopen({ readModelFile: "readmodel-rebuilt.sqlite" });
      try {
        const runAfter = await restarted.ledger.load(runRef);
        const outboxAfter = await restarted.ledger.load(claim.outboxRef);
        const attemptAfter = await restarted.ledger.load(claim.attemptRef);
        const leaseAfter = await restarted.ledger.load(claim.leaseRef);
        expect(runAfter.status).toBe("found");
        expect(outboxAfter.status).toBe("found");
        expect(attemptAfter.status).toBe("found");
        expect(leaseAfter.status).toBe("found");
        if (runAfter.status !== "found" || outboxAfter.status !== "found" || attemptAfter.status !== "found" || leaseAfter.status !== "found") return;
        expect(JSON.stringify(runAfter.snapshot)).toBe(before.run);
        expect(JSON.stringify(outboxAfter.snapshot)).toBe(before.outbox);
        expect(JSON.stringify(attemptAfter.snapshot)).toBe(before.attempt);
        expect(JSON.stringify(leaseAfter.snapshot)).toBe(before.lease);

        await restarted.advanceProjection();
        const agentAfter = await restarted.activeAgent({ projectId: PROJECT, goalId: GOAL, taskId: TASK });
        const detailAfter = await restarted.taskDetail({ projectId: PROJECT, goalId: GOAL, taskId: TASK });
        expect(agentAfter.status).toBe("ready");
        expect(detailAfter.status).toBe("ready");
        if (agentAfter.status !== "ready" || detailAfter.status !== "ready") return;
        expect(JSON.stringify(agentAfter.agent)).toBe(before.agent);
        expect(JSON.stringify(detailAfter.task)).toBe(before.detail);
        expect(restarted.observedCursor()).toEqual(before.cursor);
      } finally {
        await restarted.close();
      }
    } finally {
      await h.cleanup().catch(() => undefined);
    }
  }, 40_000);

  it("T2: two Dispatchers race the SAME task on real SQLite -> at most one lease/Attempt succeeds", async () => {
    const h = await createPersistentSqliteHarness({ deps: {} });
    try {
      const th: P1_03TestHarness = {
        ...h,
        bootstrap: h.bootstrap,
        submit: (c) => h.control.submit(c),
        install: h.install,
        activate: h.activate,
        applyPlan: h.applyPlan,
        advanceProjection: h.advanceProjection,
        observedCursor: h.observedCursor,
        planGraph: h.planGraph,
        taskDetail: h.taskDetail,
        activeAgent: h.activeAgent,
        dispatchReadiness: h.dispatchReadiness,
        claimTask: h.claimTask,
        startRun: h.startRun,
        runFact: h.runFact,
        drive: h.drive,
      };
      await prepareDispatchScenario(th);

      const c1 = buildPreparedClaim({ commandId: "cmd-int-race-a", attemptId: "att-race-a", runId: "run-race-a", idempotencyKey: "int-race-a" });
      const c2 = buildPreparedClaim({ commandId: "cmd-int-race-b", attemptId: "att-race-b", runId: "run-race-b", idempotencyKey: "int-race-b" });
      const results = await Promise.all([h.claimTask(c1), h.claimTask(c2)]);
      const committed = results.filter((r) => r.status === "committed");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(committed.length).toBe(1);
      expect(rejected.length).toBe(1);
      if (rejected[0]!.status !== "rejected") return;
      expect(rejected[0]!.code).toBe("revision_conflict");
      const page = await h.ledger.events({ afterCursor: null, limit: 500 });
      expect(page.events.map((p) => p.event.eventType).filter((t) => t === "TaskClaimed").length).toBe(1);
      // a fresh engine (distinct identity) cannot claim again: CAS/lease gate
      const other = new ControlEngineImpl({ ledger: h.ledger, now: () => SCHEMA, eventId: sequenceIdGen("evt-x", 9000) });
      const again = await other.claimTask(
        buildPreparedClaim({ commandId: "cmd-int-race-c", attemptId: "att-race-c", runId: "run-race-c", idempotencyKey: "int-race-c" }),
      );
      expect(again.status).toBe("rejected");
      if (again.status !== "rejected") return;
      expect(again.code).toBe("revision_conflict");
    } finally {
      await h.close();
      await h.cleanup().catch(() => undefined);
    }
  }, 40_000);
});
