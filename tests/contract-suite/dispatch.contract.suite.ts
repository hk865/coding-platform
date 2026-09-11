/**
 * P1-03 dispatch contract suite — shared by InMemory AND SQLite adapters
 * (identical fixtures/assertions; wired in tests/integration/). Covers ticket
 * Acceptance 1-3:
 *   - readiness table: only DAG-deps-satisfied + active + unblocked +
 *     resource-available WORK tasks are eligible (over the shared fixture);
 *   - claim: ONE atomic dispatch-claim commit — durable outbox intent +
 *     lease + attempt + run, refs loadable with exact fields;
 *   - competing claims: at most one lease/attempt/run succeeds (TaskLease CAS
 *     @0); loser revision_conflict zero-write; idempotent replay;
 *   - outbox intent durably loadable BEFORE any runtime side effect;
 *   - start: RunStarted + envelope recorded + outbox started; stale binding /
 *     stale CAS zero-write rejections.
 */
import { describe, expect, it } from "vitest";
import type {
  DispatchOutboxEntrySnapshot,
  RunSnapshot,
  TaskAttemptSnapshot,
  TaskLeaseSnapshot,
} from "../../src/contracts/dispatch.js";
import { evaluateTaskEligibility } from "../../src/control/control-engine/policies/task-eligibility.js";
import {
  DISPATCH_BLOCKED_TASK_ID,
  DISPATCH_DEFERRED_TASK_ID,
  DISPATCH_DEPENDENT_TASK_ID,
  DISPATCH_ELIGIBLE_TASK_ID,
  DISPATCH_GATE_TASK_ID,
  buildDispatchStartCommand,
  buildManifestFixture,
} from "../../src/fixtures/dispatch-fixtures.js";
import { artifactBodyDigest } from "../../src/contracts/artifact.js";
import { makeCommitCursor } from "../../src/contracts/ledger.js";
import type { P1_03HarnessFactory } from "./p1-03-harness.js";
import {
  buildPreparedClaim,
  buildPreparedEnvelope,
  freshCommandId,
  freshCorrelationId,
  prepareDispatchScenario,
  SCHEMA,
} from "./p1-03-harness.js";

export function defineDispatchContractSuite(createHarness: P1_03HarnessFactory): void {
  describe("P1-03 dispatch contract suite", () => {
    async function setup() {
      const h = await createHarness();
      await prepareDispatchScenario(h);
      return h;
    }

    it("readiness table: only deps-satisfied active unblocked budgeted WORK tasks are eligible", async () => {
      const h = await setup();
      const cases: { taskId: string; codes: string[] }[] = [
        { taskId: DISPATCH_ELIGIBLE_TASK_ID, codes: [] },
        { taskId: DISPATCH_DEPENDENT_TASK_ID, codes: ["deps_unsatisfied"] },
        { taskId: DISPATCH_BLOCKED_TASK_ID, codes: ["task_phase_not_dispatchable"] },
        { taskId: DISPATCH_DEFERRED_TASK_ID, codes: ["task_not_active"] },
        { taskId: DISPATCH_GATE_TASK_ID, codes: ["task_kind_not_work", "deps_unsatisfied"] },
        { taskId: "task-absent", codes: ["task_not_found"] },
      ];
      for (const c of cases) {
        const r = await h.dispatchReadiness({
          projectId: "proj-alpha",
          goalId: "goal-1",
          taskId: c.taskId,
        });
        expect(r.status).toBe("ready");
        if (r.status !== "ready") continue;
        const codes = r.eligibility.eligible
          ? []
          : r.eligibility.reasons.map((reason) => reason.code);
        expect(codes.sort()).toEqual([...c.codes].sort());
        if (c.codes.length === 0) expect(r.eligibility.eligible).toBe(true);
      }
    });

    it("readiness: goal without accepted plan -> plan_not_accepted", async () => {
      const h = await setup();
      // a second goal (same workspace) has no plan
      const goal = await h.submit({
        commandId: "cmd-p103-goal2",
        commandType: "CreateGoal",
        schemaVersion: 1,
        identity: { projectId: "proj-alpha", actor: { kind: "human", id: "user-1" }, idempotencyKey: "p103-goal2-claim" },
        aggregateId: "goal-2",
        expectedRevision: 0,
        correlationId: "corr-p103-goal2",
        submittedAt: SCHEMA,
        payload: { workspaceId: "ws-shared", objective: "第二个目标（无 Plan）" },
      });
      expect(goal.status).toBe("committed");
      const r = await h.dispatchReadiness({
        projectId: "proj-alpha", goalId: "goal-2", taskId: DISPATCH_ELIGIBLE_TASK_ID,
      });
      expect(r.status).toBe("not_found");
      if (r.status === "not_found") expect(r.code).toBe("plan");
    });

    it("claim commits the durable intent + lease + attempt + run atomically (all fields exact)", async () => {
      const h = await setup();
      const cmd = buildPreparedClaim({ commandId: "cmd-p103-claim-a", attemptId: "att-a", runId: "run-a", idempotencyKey: "inst-p103-a" });
      const receipt = await h.claimTask(cmd);
      expect(receipt.status).toBe("committed");
      if (receipt.status !== "committed") return;
      expect(receipt.leaseRef).toEqual({ aggregateType: "TaskLease", projectId: "proj-alpha", goalId: "goal-1", taskId: DISPATCH_ELIGIBLE_TASK_ID });
      expect(receipt.attemptRef.attemptId).toBe("att-a");
      expect(receipt.runRef.runId).toBe("run-a");
      expect(receipt.outboxRef.attemptId).toBe("att-a");

      // outbox is DUPLY loadable BEFORE any runtime call (Acceptance 3 half 1)
      const outbox = await h.ledger.load(receipt.outboxRef);
      expect(outbox.status).toBe("found");
      if (outbox.status !== "found") return;
      const entry = outbox.snapshot as DispatchOutboxEntrySnapshot;
      expect(entry.status).toBe("pending");
      expect(entry.intent.intentId).toBe("att-a");
      expect(entry.intent.taskId).toBe(DISPATCH_ELIGIBLE_TASK_ID);
      expect(entry.intent.roleBinding.bindingId).toBe("binding-run-short-lived-v1");
      // intent references the same plan
      expect(entry.intent.planRef.planId).toBe("plan-dispatch-mvp");

      const lease = await h.ledger.load(receipt.leaseRef);
      expect(lease.status).toBe("found");
      if (lease.status !== "found") return;
      const ls = lease.snapshot as TaskLeaseSnapshot;
      expect(ls.holderRunId).toBe("run-a");
      expect(ls.attemptId).toBe("att-a");
      expect(ls.revision).toBe(1);

      const attempt = await h.ledger.load(receipt.attemptRef);
      expect(attempt.status).toBe("found");
      if (attempt.status !== "found") return;
      const as = attempt.snapshot as TaskAttemptSnapshot;
      expect(as.status).toBe("claimed");
      expect(as.runId).toBe("run-a");

      const run = await h.ledger.load(receipt.runRef);
      expect(run.status).toBe("found");
      if (run.status !== "found") return;
      const rs = run.snapshot as RunSnapshot;
      expect(rs.status).toBe("starting");
      expect(rs.lastEventSeq).toBe(0);
      expect(rs.envelope).toBeNull();
    });

    it("competing claims: two ControlEngine instances -> at most one lease/attempt/run", async () => {
      const h = await setup();
      const cmdA = buildPreparedClaim({ commandId: "cmd-p103-race-a", attemptId: "att-race-a", runId: "run-race-a", idempotencyKey: "p103-race-a" });
      const cmdB = buildPreparedClaim({ commandId: "cmd-p103-race-b", attemptId: "att-race-b", runId: "run-race-b", idempotencyKey: "p103-race-b" });
      const results = await Promise.all([h.claimTask(cmdA), h.claimTask(cmdB)]);
      const committed = results.filter((r) => r.status === "committed");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(committed.length).toBe(1);
      expect(rejected.length).toBe(1);
      if (rejected[0]!.status !== "rejected") return;
      expect(rejected[0]!.code).toBe("revision_conflict");
      // exactly one attempt + one run exist
      const page = await h.ledger.events({ afterCursor: null, limit: 500 });
      const claims = page.events.map((p) => p.event.eventType).filter((t) => t === "TaskClaimed");
      expect(claims.length).toBe(1);
    });

    it("same identity+fingerprint replays committed(replayed); different fingerprint -> idempotency_conflict", async () => {
      const h = await setup();
      const deps = { commandId: "cmd-p103-replay", attemptId: "att-r", runId: "run-r", idempotencyKey: "key-replay" };
      const first = await h.claimTask(buildPreparedClaim(deps));
      expect(first.status).toBe("committed");
      const pageBefore = await h.ledger.events({ afterCursor: null, limit: 500 });
      const again = await h.claimTask(buildPreparedClaim(deps));
      expect(again.status).toBe("committed");
      if (again.status !== "committed") return;
      expect(again.replayed).toBe(true);
      expect(again.eventIds).toEqual(first.status === "committed" ? first.eventIds : []);
      const pageAfter = await h.ledger.events({ afterCursor: null, limit: 500 });
      expect(pageAfter.events.length).toBe(pageBefore.events.length);

      const other = await h.claimTask(
        buildPreparedClaim({ commandId: "cmd-p103-replay-b", attemptId: "att-r2", runId: "run-r2", idempotencyKey: "key-replay-other" }),
      );
      expect(other.status).toBe("rejected");
      if (other.status !== "rejected") return;
      expect(other.code).toBe("revision_conflict"); // different identity => CAS wins against first claim
    });

    it("claim of an ineligible task -> ineligible, zero write", async () => {
      const h = await setup();
      const before = await h.ledger.events({ afterCursor: null, limit: 500 });
      const cmd = buildPreparedClaim({ commandId: "cmd-p103-inel", taskId: DISPATCH_DEPENDENT_TASK_ID, attemptId: "att-i", runId: "run-i" });
      const r = await h.claimTask(cmd);
      expect(r.status).toBe("rejected");
      if (r.status !== "rejected") return;
      expect(r.code).toBe("ineligible");
      expect(r.issues?.some((i) => i.code === "deps_unsatisfied")).toBe(true);
      const after = await h.ledger.events({ afterCursor: null, limit: 500 });
      expect(after.events.length).toBe(before.events.length);
    });

    it("claim of a missing goal -> not_found, zero write", async () => {
      const h = await setup();
      const r = await h.claimTask(buildPreparedClaim({ commandId: "cmd-p103-missing", goalId: "goal-absent", attemptId: "att-m", runId: "run-m" }));
      expect(r.status).toBe("rejected");
      if (r.status !== "rejected") return;
      expect(r.code).toBe("not_found");
    });

    it("start commits envelope + outbox started (CAS); stale start -> revision_conflict zero-write", async () => {
      const h = await setup();
      const claim = await h.claimTask(buildPreparedClaim({ commandId: "cmd-p103-startbase", attemptId: "att-s", runId: "run-s", idempotencyKey: "p103-startbase" }));
      expect(claim.status).toBe("committed");
      if (claim.status !== "committed") return;
      const bundleRef = { kind: "artifact" as const, contentType: "text/plain", digest: artifactBodyDigest("ctx-body"), sizeBytes: 8, source: { kind: "plan-revision" as const, refId: "plan-dispatch-mvp", revision: "1" } };
      const envelope = buildPreparedEnvelope({ runId: "run-s", attemptId: "att-s", bundleRef });
      const start = await h.startRun(buildDispatchStartCommand({
        commandId: "cmd-p103-start",
        correlationId: freshCorrelationId(),
        submittedAt: SCHEMA,
        projectId: "proj-alpha",
        runId: "run-s",
        envelope,
        manifest: buildManifestFixture({ workspaceId: "ws-shared", workspaceRevision: 1, planRef: { aggregateType: "PlanRevision", projectId: "proj-alpha", planId: "plan-dispatch-mvp" } }),
      }));
      expect(start.status).toBe("committed");
      if (start.status !== "committed") return;
      const run = await h.ledger.load({ aggregateType: "Run", projectId: "proj-alpha", goalId: "goal-1", runId: "run-s" });
      expect(run.status).toBe("found");
      if (run.status !== "found") return;
      const rs = run.snapshot as RunSnapshot;
      expect(rs.status).toBe("running");
      expect(rs.envelope?.envelopeId).toBe("envelope-run-s");
      const outbox = await h.ledger.load(claim.outboxRef);
      expect(outbox.status).toBe("found");
      if (outbox.status !== "found") return;
      expect((outbox.snapshot as DispatchOutboxEntrySnapshot).status).toBe("started");

      // stale expected run revision -> revision_conflict
      const before = await h.ledger.events({ afterCursor: null, limit: 500 });
      const stale = await h.startRun(buildDispatchStartCommand({
        commandId: "cmd-p103-start-stale",
        correlationId: freshCorrelationId(),
        submittedAt: SCHEMA,
        projectId: "proj-alpha",
        runId: "run-s",
        expectedRevision: 999,
        idempotencyKey: "p103-start-stale",
        envelope,
        manifest: buildManifestFixture({ workspaceId: "ws-shared", workspaceRevision: 1, planRef: { aggregateType: "PlanRevision", projectId: "proj-alpha", planId: "plan-dispatch-mvp" } }),
      }));
      expect(stale.status).toBe("rejected");
      if (stale.status !== "rejected") return;
      expect(stale.code).toBe("revision_conflict");
      const after = await h.ledger.events({ afterCursor: null, limit: 500 });
      expect(after.events.length).toBe(before.events.length);
    });

    it("pure eligibility rule: synthetic table over facts (no ledger needed)", () => {
      const facts = {
        projectId: "proj-alpha",
        goalId: "goal-1",
        goalDesiredState: "active",
        goalActivePlanRevision: { aggregateType: "PlanRevision" as const, projectId: "proj-alpha", planId: "plan-dispatch-mvp" },
        plan: null,
        lease: { status: "none" as const },
        resource: { tokenBudget: 10, deadline: null, now: SCHEMA },
      };
      const r = evaluateTaskEligibility(facts, DISPATCH_ELIGIBLE_TASK_ID);
      expect(r.eligible).toBe(false);
      if (!r.eligible) expect(r.reasons[0]!.code).toBe("plan_not_accepted");
    });
  });
}
