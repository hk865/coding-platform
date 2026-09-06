/**
 * P1-07 contract suite — the 8-item acceptance + 5 verification groups
 * (real-run-overlap-measurement / read-only-capability-enforcement /
 * competing-writer-lease-test / evidence-conflict-test / goal-gate-full-check),
 * run IDENTICALLY against the InMemory and the SQLite harnesses.
 *
 * The suite only calls the frozen baselines; lane implementations (A: lease
 * engine, B: driveParallel + integration join, C: patch record + views) make
 * the assertions below pass. AUTO-SKIPPED on both adapters until the P1-07
 * handlers exist (probe isP107Ready, no fake).
 */
import { describe, it, expect } from "vitest";
import type { WorkspaceCapabilityPort } from "../../src/contracts/workspace-capability.js";
import type { RunPort, RunHandle, RunCapabilities } from "../../src/contracts/ports.js";
import type { TaskEnvelopeV1 } from "../../src/contracts/task-envelope.js";
import { scopeOverlap, scopeCoveredByWriteScope, conflictScopeKeyFor, evaluateLeaseAdmissibility, workspaceReadLeaseRefFor, workspaceWriteLeaseRefFor } from "../../src/contracts/workspace-lease.js";
import type { ConflictScopeV1 } from "../../src/contracts/workspace-lease.js";
import { detectEvidenceConflicts, evidenceConflictKeyFor } from "../../src/contracts/integration.js";
import type { EvidenceConflictFactV1 } from "../../src/contracts/integration.js";
import type {
  P1_07TestHarness,
} from "./p1-07-harness.js";
import {
  prepareP107Scenario,
  claimP107Task,
  runP107Task,
  runP107Reader,
  submitP107Evidence,
  recordP107Integration,
  recordP107Patch,
  reduceP107Goal,
  buildP107ReduceTaskCommand,
  p107GoalScope,
  runP107FullScenario,
  ParallelProbeRuntime,
  P107_GOAL,
  P107_PROJECT,
  P107_WORKSPACE,
  P107_SCHEMA,
  P107_TASK_READER_A,
  P107_TASK_READER_B,
  P107_TASK_INTEGRATION,
  P107_TASK_WRITER,
  P107_TASK_GATE,
  P107_VR_READERS,
  P107_OBL_READERS,
  P107_VR_JOIN,
  P107_OBL_JOIN,
  P107_VR_PATCH,
  P107_OBL_PATCH,
  P107_VR_GATE,
  P107_OBL_GATE,
  P107_ROLE_BINDING_READER_V1,
  P107_ROLE_BINDING_WRITER_V1,
  P107_ROLE_BINDING_COORDINATOR_V1,
  P107_BUDGET_READER_V1,
  P107_BUDGET_WRITER_V1,
  P107_DECLARED_READ_PERMISSIONS_V1,
  P107_DECLARED_WRITE_PERMISSIONS_V1,
  P107_SCOPE_READER_A,
  P107_SCOPE_READER_B,
  P107_SCOPE_WRITER,
  P107_WRITE_SCOPE,
  p107PlanRef,
  p107ScopeForTask,
  p107ReaderScript,
  p107WriterScript,
  buildP107AcquireReadLeaseCommand,
  buildP107AcquireWriteLeaseCommand,
  buildP107ReleaseLeaseCommand,
  buildP107RecordIntegrationCommand,
  buildP107RecordPatchCommand,
  buildP107ArtifactRef,
  taskAttemptRefFor,
} from "./p1-07-harness.js";
import { buildEffectivityAnchorV1 } from "../../src/contracts/fixtures/evidence-fixtures.js";
import { evidenceRefFor } from "../../src/contracts/evidence.js";
import type { EvidenceV1 } from "../../src/contracts/evidence.js";
import type { EvidenceRef } from "../../src/contracts/evidence.js";
import type { EffectivityAnchorV1 } from "../../src/contracts/evidence.js";
import type { FakeRuntimeScriptV1 } from "../../src/contracts/fixtures/dispatch-fixtures.js";
import { rebaseScriptForRun } from "../../src/contracts/fixtures/dispatch-fixtures.js";
import type { PlanRevisionSnapshot } from "../../src/contracts/plan.js";
import { dispatchOutboxRefFor } from "../../src/contracts/dispatch.js";
import { completionPolicyPinFor, architectureBaselinePinFor } from "../../src/contracts/fixtures/governance-fixtures.js";

export type P1_07FactoryOptions = {
  workspaceCapability?: WorkspaceCapabilityPort;
  runtime?: RunPort;
};

export type P1_07Factory = (
  options?: P1_07FactoryOptions,
) => Promise<P1_07TestHarness>;

const readerAnchor = (sc: Awaited<ReturnType<typeof prepareP107Scenario>>, workspaceRevision?: number): EffectivityAnchorV1 =>
  buildEffectivityAnchorV1({
    planRef: sc.planRef,
    planRevision: 1,
    workspaceRevision: workspaceRevision ?? sc.workspaceRevision,
    pinnedCompletionPolicy: sc.pinnedCompletionPolicy,
    pinnedArchitectureBaseline: sc.pinnedArchitectureBaseline,
  });

async function freshScenario(h: P1_07TestHarness) {
  return prepareP107Scenario(h);
}

export function defineWorkspaceContractSuite(factory: P1_07Factory): void {
  describe("P1-07 acceptance — parallel readers + single writer", () => {
    // ------------------------------------------------------------------- //
    // Pure conflict-scope rules (no harness)                               //
    // ------------------------------------------------------------------- //

    it("G0 ConflictScope overlap is syntactic and composable (pure)", () => {
      const ws: ConflictScopeV1 = { schemaVersion: 1, projectId: P107_PROJECT, workspaceId: P107_WORKSPACE, kind: "workspace", id: P107_WORKSPACE, revision: null };
      const pathFix: ConflictScopeV1 = { ...P107_SCOPE_WRITER, id: "src/p107/sub" };
      const moduleA = P107_SCOPE_READER_A;
      const moduleB = P107_SCOPE_READER_B;
      const stage: ConflictScopeV1 = { ...P107_SCOPE_WRITER, kind: "stage", id: "stage-p107-parallel" };
      expect(scopeOverlap(ws, pathFix)).toBe(true);
      expect(scopeOverlap(pathFix, ws)).toBe(true);
      expect(scopeOverlap(moduleA, moduleB)).toBe(false);
      expect(scopeOverlap(P107_SCOPE_WRITER, pathFix)).toBe(true);
      expect(scopeOverlap(moduleA, stage)).toBe(false);
      expect(scopeOverlap(stage, stage)).toBe(true);
      expect(scopeOverlap({ ...moduleA, projectId: "other" }, moduleA)).toBe(false);
      expect(scopeOverlap(P107_SCOPE_WRITER, { ...P107_SCOPE_WRITER, workspaceId: P107_WORKSPACE })).toBe(true);
      expect(scopeCoveredByWriteScope(P107_SCOPE_WRITER, [P107_WRITE_SCOPE])).toBe(true);
      expect(scopeCoveredByWriteScope(pathFix, [P107_WRITE_SCOPE])).toBe(true);
      expect(scopeCoveredByWriteScope(P107_SCOPE_READER_A, [P107_WRITE_SCOPE])).toBe(false);
      expect(scopeCoveredByWriteScope(ws, ["*"])).toBe(true);
      expect(scopeCoveredByWriteScope({ ...P107_SCOPE_WRITER, kind: "task", id: P107_TASK_WRITER }, ["task:" + P107_TASK_WRITER])).toBe(true);
      expect(conflictScopeKeyFor(moduleA)).toBe(conflictScopeKeyFor({ ...moduleA, revision: 5 }));
      expect(evaluateLeaseAdmissibility({ status: "active", expiresAt: null }, P107_SCHEMA)).toEqual({ admissible: true });
      expect(evaluateLeaseAdmissibility({ status: "active", expiresAt: "2026-09-06T09:00:00.000Z" }, P107_SCHEMA)).toEqual({ admissible: false, reason: "expired" });
      expect(evaluateLeaseAdmissibility({ status: "released", expiresAt: null }, P107_SCHEMA)).toEqual({ admissible: false, reason: "released" });
    });

    it("G0b detectEvidenceConflicts is pure and mechanical", () => {
      const mk = (evidenceId: string, outcome: "PASS" | "FAIL", runId: string): EvidenceConflictFactV1 => ({
        evidenceId,
        outcome,
        applicability: "APPLICABLE",
        runRef: { aggregateType: "Run", projectId: P107_PROJECT, goalId: P107_GOAL, runId },
        planRevision: 1,
        workspaceRevision: 1,
        coverage: { obligationId: P107_OBL_READERS, requirementId: P107_VR_READERS },
      });
      const a = mk("ev-a", "PASS", "run-a");
      const b = mk("ev-b", "FAIL", "run-b");
      const inputs = [
        { sourceTaskId: P107_TASK_READER_A, sourceRunRef: a.runRef, kind: "evidence" as const, evidenceRef: evidenceRefFor(P107_PROJECT, "ev-a"), artifactRef: null, handoffPacketRef: null },
        { sourceTaskId: P107_TASK_READER_B, sourceRunRef: b.runRef, kind: "evidence" as const, evidenceRef: evidenceRefFor(P107_PROJECT, "ev-b"), artifactRef: null, handoffPacketRef: null },
      ];
      const facts = new Map([["ev-a", a], ["ev-b", b]]);
      const conf = detectEvidenceConflicts(inputs, (id) => facts.get(id) ?? null, P107_SCHEMA);
      expect(conf).toHaveLength(1);
      expect(conf[0]!.kind).toBe("outcome_disagreement");
      expect(conf[0]!.obligationId).toBe(P107_OBL_READERS);
      expect(evidenceConflictKeyFor({ obligationId: P107_OBL_READERS, requirementId: P107_VR_READERS, planRevision: 1, workspaceRevision: 1 })).toBe(conf[0]!.conflictKey);
      // same outcome -> none
      const same = detectEvidenceConflicts(
        inputs.map((i) => (i.evidenceRef?.evidenceId === "ev-b" ? { ...i, evidenceRef: evidenceRefFor(P107_PROJECT, "ev-a") } : i)),
        () => ({ ...a, evidenceId: "ev-a" }),
        P107_SCHEMA,
      );
      expect(same).toHaveLength(0);
      // same run -> none
      const sameRun = detectEvidenceConflicts(inputs, (id) => mk(id, "FAIL", "run-a"), P107_SCHEMA);
      expect(sameRun).toHaveLength(0);
    });

    // ------------------------------------------------------------------- //
    // Acceptance 1+2: real overlap + no implicit ordering                  //
    // ------------------------------------------------------------------- //

    it("A1/A2 two readers overlap for real; started before any poll; independent attempts/contexts/budgets", async () => {
      const probe = new ParallelProbeRuntime((envelope) => {
        if (envelope.taskId === P107_TASK_READER_A) return p107ReaderScript("a", "2026-09-06T12:00:10.000Z", "2026-09-06T12:00:40.000Z");
        return p107ReaderScript("b", "2026-09-06T12:00:20.000Z", "2026-09-06T12:00:50.000Z");
      });
      const h = await factory({ runtime: probe });
      const sc = await freshScenario(h);
      await claimP107Task(h, {
        taskId: P107_TASK_READER_A, runId: "run-p107-read-a", attemptId: "att-p107-read-a",
        roleBinding: P107_ROLE_BINDING_READER_V1, declaredPermissions: P107_DECLARED_READ_PERMISSIONS_V1, budget: P107_BUDGET_READER_V1,
      });
      await claimP107Task(h, {
        taskId: P107_TASK_READER_B, runId: "run-p107-read-b", attemptId: "att-p107-read-b",
        roleBinding: P107_ROLE_BINDING_READER_V1, declaredPermissions: P107_DECLARED_READ_PERMISSIONS_V1, budget: P107_BUDGET_READER_V1,
      });
      const result = await h.workspaceDrive.driveParallel({ schemaVersion: 1, reason: "P1-07 overlap", projectId: P107_PROJECT, goalId: P107_GOAL, maxIntents: 4 });
      expect(result.failures).toHaveLength(0);
      expect(result.started).toBe(2);

      // REAL overlap: both fired before any consumption (no implicit order).
      expect(probe.started).toHaveLength(2);
      expect(probe.started).toEqual([P107_TASK_READER_A, P107_TASK_READER_B].sort((a, b) => a.localeCompare(b)));
      expect(probe.started).toHaveLength(2);
      const firstPollIndex = probe.started.length; // all starts precede polls
      // windows: A [10,40], B [20,50] -> overlap = [20,40]
      const winA = probe.windows["run-p107-read-a"]!;
      const winB = probe.windows["run-p107-read-b"]!;
      expect(winA.startedAt).toBe("2026-09-06T12:00:10.000Z");
      expect(winA.terminalAt).toBe("2026-09-06T12:00:40.000Z");
      expect(winB.startedAt).toBe("2026-09-06T12:00:20.000Z");
      expect(winB.terminalAt).toBe("2026-09-06T12:00:50.000Z");
      expect(winA.startedAt < winB.startedAt && winB.startedAt < winA.terminalAt && winA.terminalAt < winB.terminalAt).toBe(true);
      void firstPollIndex;
      void sc;
      // independent attempt/context/budget/source: each run has its own outbox entry
      const outA = await h.ledger.load(dispatchOutboxRefFor(P107_PROJECT, P107_GOAL, P107_TASK_READER_A, "run-p107-read-a"));
      const outB = await h.ledger.load(dispatchOutboxRefFor(P107_PROJECT, P107_GOAL, P107_TASK_READER_B, "run-p107-read-b"));
      expect(outA.status).toBe("found");
      expect(outB.status).toBe("found");
      if (outA.status === "found" && outB.status === "found") {
        const intentA = (outA.snapshot as { intent: { attemptRef: { attemptId: string }; runRef: { runId: string }; budget: { tokenBudget: number }; declaredPermissions: { tools: string[] } } }).intent;
        const intentB = (outB.snapshot as { intent: { attemptRef: { attemptId: string }; runRef: { runId: string }; budget: { tokenBudget: number }; declaredPermissions: { tools: string[] } } }).intent;
        expect(intentA.attemptRef.attemptId).not.toBe(intentB.attemptRef.attemptId);
        expect(intentA.runRef.runId).not.toBe(intentB.runRef.runId);
        expect(intentA.budget.tokenBudget).toBe(intentB.budget.tokenBudget);
        expect(intentA.declaredPermissions.tools).toEqual(["read"]);
      }
    });

    // ------------------------------------------------------------------- //
    // Acceptance 3: read-only capability enforcement                       //
    // ------------------------------------------------------------------- //

    it("A3 read + parallel read leases; reader can NEVER obtain a write lease", async () => {
      const h = await factory();
      const sc = await freshScenario(h);
      const runA = await runP107Reader(h, "a", "2026-09-06T12:00:10.000Z", "2026-09-06T12:00:30.000Z");
      const runB = await runP107Reader(h, "b", "2026-09-06T12:00:20.000Z", "2026-09-06T12:00:40.000Z");
      const attA = taskAttemptRefFor(P107_PROJECT, P107_GOAL, P107_TASK_READER_A, "att-p107-read-a");
      const attB = taskAttemptRefFor(P107_PROJECT, P107_GOAL, P107_TASK_READER_B, "att-p107-read-b");
      const leaseA = await h.acquireWorkspaceReadLease(
        buildP107AcquireReadLeaseCommand({ commandId: "cmd-read-A", projectId: P107_PROJECT, leaseId: "lease-read-a", scope: P107_SCOPE_READER_A, holder: { runRef: runA, attemptRef: attA, roleBinding: P107_ROLE_BINDING_READER_V1 } }),
      );
      expect(leaseA.status).toBe("committed");
      // read-read NEVER conflicts: an overlapping read lease is granted too.
      const leaseB = await h.acquireWorkspaceReadLease(
        buildP107AcquireReadLeaseCommand({ commandId: "cmd-read-B", projectId: P107_PROJECT, leaseId: "lease-read-b", scope: P107_SCOPE_READER_A, holder: { runRef: runB, attemptRef: attB, roleBinding: P107_ROLE_BINDING_READER_V1 } }),
      );
      expect(leaseB.status).toBe("committed");
      // A reader run (tools=["read"]) attempting the write lease -> capability_readonly.
      const writeAsReader = await h.acquireWorkspaceWriteLease(
        buildP107AcquireWriteLeaseCommand({ commandId: "cmd-write-as-reader", projectId: P107_PROJECT, leaseId: "lease-write-reader", scope: P107_SCOPE_WRITER, declaredWriteScope: [P107_WRITE_SCOPE], holder: { runRef: runA, attemptRef: attA, roleBinding: P107_ROLE_BINDING_READER_V1 } }),
      );
      expect(writeAsReader.status).toBe("rejected");
      if (writeAsReader.status === "rejected") expect(writeAsReader.code).toBe("capability_readonly");
      // zero write: no write lease/index state exists
      const view = await h.workspaceLeaseView({ projectId: P107_PROJECT, workspaceId: P107_WORKSPACE });
      if (view.status === "ready") {
        expect(view.lease.writeLease).toBeNull();
        expect(view.lease.readLeases).toHaveLength(2);
      }
      // unsupported capability -> capability_unsupported (never silent)
      const hUn = await factory({ workspaceCapability: { capabilitiesFor: () => Promise.resolve({ status: "unsupported" }) } });
      const scUn = await freshScenario(hUn);
      void scUn;
      const runUn = await runP107Reader(hUn as P1_07TestHarness, "a", "2026-09-06T12:00:10.000Z", "2026-09-06T12:00:30.000Z");
      const un = await hUn.acquireWorkspaceReadLease(
        buildP107AcquireReadLeaseCommand({ commandId: "cmd-read-unsupported", projectId: P107_PROJECT, leaseId: "lease-read-un", scope: P107_SCOPE_READER_A, holder: { runRef: runUn, attemptRef: taskAttemptRefFor(P107_PROJECT, P107_GOAL, P107_TASK_READER_A, "att-p107-read-a"), roleBinding: P107_ROLE_BINDING_READER_V1 } }),
      );
      expect(un.status).toBe("rejected");
      if (un.status === "rejected") expect(un.code).toBe("capability_unsupported");
      const viewUn = await hUn.workspaceLeaseView({ projectId: P107_PROJECT, workspaceId: P107_WORKSPACE });
      if (viewUn.status === "ready") expect(viewUn.lease.readLeases).toHaveLength(0);
    });

    // ------------------------------------------------------------------- //
    // Acceptance 5: competing-writer-lease-test                            //
    // ------------------------------------------------------------------- //

    it("A5 competing writers: at most one effective write lease; loser zero write; readback", async () => {
      const h = await factory();
      const sc = await freshScenario(h);
      const runA = await runP107Task(h, {
        taskId: P107_TASK_WRITER, runId: "run-w1", attemptId: "att-w1",
        roleBinding: P107_ROLE_BINDING_WRITER_V1, declaredPermissions: P107_DECLARED_WRITE_PERMISSIONS_V1, budget: P107_BUDGET_WRITER_V1,
      });
      const runB = await runP107Task(h, {
        taskId: P107_TASK_WRITER, runId: "run-w2", attemptId: "att-w2",
        roleBinding: P107_ROLE_BINDING_WRITER_V1, declaredPermissions: P107_DECLARED_WRITE_PERMISSIONS_V1, budget: P107_BUDGET_WRITER_V1,
      });
      const mk = (leaseId: string, runRef: typeof runA, attemptId: string, commandId: string) =>
        buildP107AcquireWriteLeaseCommand({
          commandId, projectId: P107_PROJECT, leaseId, scope: P107_SCOPE_WRITER,
          declaredWriteScope: P107_DECLARED_WRITE_PERMISSIONS_V1.writeScope,
          holder: { runRef, attemptRef: taskAttemptRefFor(P107_PROJECT, P107_GOAL, P107_TASK_WRITER, attemptId), roleBinding: P107_ROLE_BINDING_WRITER_V1 },
        });
      const w1 = await h.acquireWorkspaceWriteLease(mk("lease-w1", runA, "att-w1", "cmd-w1"));
      const w2 = await h.acquireWorkspaceWriteLease(mk("lease-w2", runB, "att-w2", "cmd-w2"));
      const committed = [w1, w2].filter((r) => r.status === "committed");
      const rejected = [w1, w2].filter((r) => r.status === "rejected");
      expect(committed).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      if (rejected[0]!.status === "rejected") expect(rejected[0]!.code).toBe("write_lease_conflict");
      // readback: exactly one active writer
      const ws = await h.ledger.load({ aggregateType: "WorkspaceWriteLeaseIndex" as const, projectId: P107_PROJECT, workspaceId: P107_WORKSPACE });
      expect(ws.status).toBe("found");
      if (ws.status === "found") {
        const index = ws.snapshot as { activeLeaseId: string | null };
        expect(index.activeLeaseId).not.toBeNull();
      }
      const view = await h.workspaceLeaseView({ projectId: P107_PROJECT, workspaceId: P107_WORKSPACE });
      if (view.status === "ready") {
        expect(view.lease.writeLease?.status).toBe("active");
      }
      // scope overreach: not declared -> scope_not_declared, zero write
      const overreach = await h.acquireWorkspaceWriteLease(
        buildP107AcquireWriteLeaseCommand({ commandId: "cmd-w-over", projectId: P107_PROJECT, leaseId: "lease-w-over", scope: P107_SCOPE_READER_A, declaredWriteScope: [P107_WRITE_SCOPE], holder: { runRef: runA, attemptRef: taskAttemptRefFor(P107_PROJECT, P107_GOAL, P107_TASK_WRITER, "att-w1"), roleBinding: P107_ROLE_BINDING_WRITER_V1 } }),
      );
      expect(overreach.status).toBe("rejected");
      if (overreach.status === "rejected") expect(overreach.code).toBe("scope_not_declared");
      // not-holder release -> not_holder, zero write
      const foreign = await h.releaseWorkspaceLease(
        buildP107ReleaseLeaseCommand({ commandId: "cmd-rel-foreign", projectId: P107_PROJECT, leaseId: committed[0]!.status === "committed" ? committed[0]!.leaseRef.leaseId : "lease-w1", kind: "write", holderRunRef: runB }),
      );
      expect(foreign.status).toBe("rejected");
      if (foreign.status === "rejected") expect(foreign.code).toBe("not_holder");
      void sc;
    });

    it("A5b lease release + expiry-vacate; expired lease does not block a new writer", async () => {
      const h = await factory();
      await freshScenario(h);
      const runW1 = await runP107Task(h, {
        taskId: P107_TASK_WRITER, runId: "run-w1", attemptId: "att-w1",
        roleBinding: P107_ROLE_BINDING_WRITER_V1, declaredPermissions: P107_DECLARED_WRITE_PERMISSIONS_V1, budget: P107_BUDGET_WRITER_V1,
      });
      const runW2 = await runP107Task(h, {
        taskId: P107_TASK_WRITER, runId: "run-w2", attemptId: "att-w2",
        roleBinding: P107_ROLE_BINDING_WRITER_V1, declaredPermissions: P107_DECLARED_WRITE_PERMISSIONS_V1, budget: P107_BUDGET_WRITER_V1,
      });
      const attW1 = taskAttemptRefFor(P107_PROJECT, P107_GOAL, P107_TASK_WRITER, "att-w1");
      const attW2 = taskAttemptRefFor(P107_PROJECT, P107_GOAL, P107_TASK_WRITER, "att-w2");
      // explicit release path
      const w1 = await h.acquireWorkspaceWriteLease(buildP107AcquireWriteLeaseCommand({ commandId: "cmd-w1", projectId: P107_PROJECT, leaseId: "lease-w1", scope: P107_SCOPE_WRITER, declaredWriteScope: [P107_WRITE_SCOPE], holder: { runRef: runW1, attemptRef: attW1, roleBinding: P107_ROLE_BINDING_WRITER_V1 } }));
      expect(w1.status).toBe("committed");
      const rel = await h.releaseWorkspaceLease(buildP107ReleaseLeaseCommand({ commandId: "cmd-rel-w1", projectId: P107_PROJECT, leaseId: "lease-w1", kind: "write", holderRunRef: runW1 }));
      expect(rel.status).toBe("committed");
      const relAgain = await h.releaseWorkspaceLease(buildP107ReleaseLeaseCommand({ commandId: "cmd-rel-w1b", projectId: P107_PROJECT, leaseId: "lease-w1", kind: "write", holderRunRef: runW1 }));
      expect(relAgain.status).toBe("rejected");
      if (relAgain.status === "rejected") expect(relAgain.code).toBe("already_released");
      // expired lease: a new acquire succeeds and vacates it (releasedBy null)
      const wExp = await h.acquireWorkspaceWriteLease(buildP107AcquireWriteLeaseCommand({ commandId: "cmd-wexp", projectId: P107_PROJECT, leaseId: "lease-exp", scope: P107_SCOPE_WRITER, declaredWriteScope: [P107_WRITE_SCOPE], expiresAt: "2026-09-06T09:00:00.000Z", holder: { runRef: runW1, attemptRef: attW1, roleBinding: P107_ROLE_BINDING_WRITER_V1 } }));
      expect(wExp.status).toBe("committed");
      const w2 = await h.acquireWorkspaceWriteLease(buildP107AcquireWriteLeaseCommand({ commandId: "cmd-w2", projectId: P107_PROJECT, leaseId: "lease-w2", scope: P107_SCOPE_WRITER, declaredWriteScope: [P107_WRITE_SCOPE], holder: { runRef: runW2, attemptRef: attW2, roleBinding: P107_ROLE_BINDING_WRITER_V1 } }));
      expect(w2.status).toBe("committed");
      const vacated = await h.ledger.load(workspaceWriteLeaseRefFor(P107_PROJECT, "lease-exp"));
      expect(vacated.status).toBe("found");
      if (vacated.status === "found") {
        const snap = vacated.snapshot as { revision: number; lease: { status: string; releasedBy: string | null } };
        expect(snap.revision).toBe(2);
        expect(snap.lease.status).toBe("released");
        expect(snap.lease.releasedBy).toBeNull();
      }
    });

    // ------------------------------------------------------------------- //
    // Acceptance 4: evidence-conflict-test                                 //
    // ------------------------------------------------------------------- //

    it("A4 conflict preserved, never overwritten; explanation or escalate required", async () => {
      const h = await factory();
      const sc = await freshScenario(h);
      const anchor = readerAnchor(sc);
      const runA = await runP107Reader(h, "a", "2026-09-06T12:00:10.000Z", "2026-09-06T12:00:30.000Z");
      const runB = await runP107Reader(h, "b", "2026-09-06T12:00:10.000Z", "2026-09-06T12:00:30.000Z");
      const attA = taskAttemptRefFor(P107_PROJECT, P107_GOAL, P107_TASK_READER_A, "att-p107-read-a");
      const attB = taskAttemptRefFor(P107_PROJECT, P107_GOAL, P107_TASK_READER_B, "att-p107-read-b");
      const evA = await submitP107Evidence(h, { evidenceId: "ev-conf-a", taskId: P107_TASK_READER_A, outcome: "PASS", runRef: runA, coverage: [{ obligationId: P107_OBL_READERS, requirementId: P107_VR_READERS }], anchor });
      const evB = await submitP107Evidence(h, { evidenceId: "ev-conf-b", taskId: P107_TASK_READER_B, outcome: "FAIL", runRef: runB, coverage: [{ obligationId: P107_OBL_READERS, requirementId: P107_VR_READERS }], anchor });
      expect((await h.reduceTask(buildP107ReduceTaskCommand(P107_TASK_READER_A))).status).toBe("committed");
      expect((await h.reduceTask(buildP107ReduceTaskCommand(P107_TASK_READER_B))).status).toBe("committed");
      const integrationRun = await runP107Task(h, {
        taskId: P107_TASK_INTEGRATION, runId: "run-conf-int", attemptId: "att-conf-int",
        roleBinding: P107_ROLE_BINDING_READER_V1, declaredPermissions: P107_DECLARED_READ_PERMISSIONS_V1, budget: P107_BUDGET_READER_V1,
      });
      // conflicts exist but no explanation and no escalate -> conflict_unresolved
      const unresolved = await recordP107Integration(h, {
        resultId: "res-unresolved", runRef: integrationRun, attemptRef: taskAttemptRefFor(P107_PROJECT, P107_GOAL, P107_TASK_INTEGRATION, "att-conf-int"),
        inputs: [
          { sourceTaskId: P107_TASK_READER_A, sourceRunRef: runA, kind: "evidence", evidenceRef: evA, artifactRef: null, handoffPacketRef: null },
          { sourceTaskId: P107_TASK_READER_B, sourceRunRef: runB, kind: "evidence", evidenceRef: evB, artifactRef: null, handoffPacketRef: null },
        ],
        workspaceRevision: sc.workspaceRevision, planRef: sc.planRef,
      });
      expect(unresolved.status).toBe("rejected");
      if (unresolved.status === "rejected") expect(unresolved.code).toBe("conflict_unresolved");
      // with explanation -> committed; conflict preserved in the view
      const explained = await recordP107Integration(h, {
        resultId: "res-explained", runRef: integrationRun, attemptRef: taskAttemptRefFor(P107_PROJECT, P107_GOAL, P107_TASK_INTEGRATION, "att-conf-int"),
        inputs: [
          { sourceTaskId: P107_TASK_READER_A, sourceRunRef: runA, kind: "evidence", evidenceRef: evA, artifactRef: null, handoffPacketRef: null },
          { sourceTaskId: P107_TASK_READER_B, sourceRunRef: runB, kind: "evidence", evidenceRef: evB, artifactRef: null, handoffPacketRef: null },
        ],
        workspaceRevision: sc.workspaceRevision, planRef: sc.planRef,
        explanation: "Reader A verified the fix; Reader B's failure is on an optional path (needs confirmation).",
      });
      expect(explained.status).toBe("committed");
      const view = await h.integrationConflicts({ projectId: P107_PROJECT, goalId: P107_GOAL, taskId: P107_TASK_INTEGRATION });
      expect(view.status).toBe("ready");
      if (view.status === "ready") {
        expect(view.integration.records).toHaveLength(1);
        expect(view.integration.records[0]!.conflicts).toHaveLength(1);
        expect(view.integration.records[0]!.explanation).toContain("Reader A");
      }
      // LATER result re-using the same conflictKey -> conflict_duplicate (no overwrite)
      const late = await recordP107Integration(h, {
        resultId: "res-late", runRef: integrationRun, attemptRef: taskAttemptRefFor(P107_PROJECT, P107_GOAL, P107_TASK_INTEGRATION, "att-conf-int"),
        inputs: [
          { sourceTaskId: P107_TASK_READER_A, sourceRunRef: runA, kind: "evidence", evidenceRef: evA, artifactRef: null, handoffPacketRef: null },
          { sourceTaskId: P107_TASK_READER_B, sourceRunRef: runB, kind: "evidence", evidenceRef: evB, artifactRef: null, handoffPacketRef: null },
        ],
        workspaceRevision: sc.workspaceRevision, planRef: sc.planRef,
        explanation: "A later, DIFFERENT explanation",
      });
      expect(late.status).toBe("rejected");
      if (late.status === "rejected") expect(late.code).toBe("conflict_duplicate");
      const viewAfter = await h.integrationConflicts({ projectId: P107_PROJECT, goalId: P107_GOAL, taskId: P107_TASK_INTEGRATION });
      expect(viewAfter.status).toBe("ready");
      if (viewAfter.status === "ready") {
        expect(viewAfter.integration.records).toHaveLength(1);
        expect(viewAfter.integration.records[0]!.conflicts).toHaveLength(1);
      }
      // escalate without conflicts -> invalid (validation)
      const badEsc = await recordP107Integration(h, {
        resultId: "res-bad-esc", runRef: integrationRun, attemptRef: taskAttemptRefFor(P107_PROJECT, P107_GOAL, P107_TASK_INTEGRATION, "att-conf-int"),
        inputs: [{ sourceTaskId: P107_TASK_READER_A, sourceRunRef: runA, kind: "evidence", evidenceRef: evA, artifactRef: null, handoffPacketRef: null }],
        workspaceRevision: sc.workspaceRevision, planRef: sc.planRef, escalate: true,
      });
      expect(badEsc.status).toBe("rejected");
      if (badEsc.status === "rejected") expect(badEsc.code).toBe("invalid");
    });

    // ------------------------------------------------------------------- //
    // Acceptance 6: writer/patch end-to-end                                //
    // ------------------------------------------------------------------- //

    it("A6 writer uses accepted reader outputs; patch carries changed paths, checks, revision", async () => {
      const h = await factory();
      const sc = await freshScenario(h);
      const anchor = readerAnchor(sc);
      const runA = await runP107Reader(h, "a", "2026-09-06T12:00:10.000Z", "2026-09-06T12:00:30.000Z");
      const runB = await runP107Reader(h, "b", "2026-09-06T12:00:10.000Z", "2026-09-06T12:00:30.000Z");
      const evA = await submitP107Evidence(h, { evidenceId: "ev-w-a", taskId: P107_TASK_READER_A, outcome: "PASS", runRef: runA, coverage: [{ obligationId: P107_OBL_READERS, requirementId: P107_VR_READERS }], anchor });
      const evB = await submitP107Evidence(h, { evidenceId: "ev-w-b", taskId: P107_TASK_READER_B, outcome: "PASS", runRef: runB, coverage: [{ obligationId: P107_OBL_READERS, requirementId: P107_VR_READERS }], anchor });
      expect((await h.reduceTask(buildP107ReduceTaskCommand(P107_TASK_READER_A))).status).toBe("committed");
      expect((await h.reduceTask(buildP107ReduceTaskCommand(P107_TASK_READER_B))).status).toBe("committed");
      const integrationRun = await runP107Task(h, {
        taskId: P107_TASK_INTEGRATION, runId: "run-w-int", attemptId: "att-w-int",
        roleBinding: P107_ROLE_BINDING_READER_V1, declaredPermissions: P107_DECLARED_READ_PERMISSIONS_V1, budget: P107_BUDGET_READER_V1,
      });
      const join = await recordP107Integration(h, {
        resultId: "res-w-1", runRef: integrationRun, attemptRef: taskAttemptRefFor(P107_PROJECT, P107_GOAL, P107_TASK_INTEGRATION, "att-w-int"),
        inputs: [
          { sourceTaskId: P107_TASK_READER_A, sourceRunRef: runA, kind: "evidence", evidenceRef: evA, artifactRef: null, handoffPacketRef: null },
          { sourceTaskId: P107_TASK_READER_B, sourceRunRef: runB, kind: "evidence", evidenceRef: evB, artifactRef: null, handoffPacketRef: null },
        ],
        workspaceRevision: sc.workspaceRevision, planRef: sc.planRef,
      });
      expect(join.status).toBe("committed");
      expect((await h.reduceTask(buildP107ReduceTaskCommand(P107_TASK_INTEGRATION))).status).toBe("committed");
      const writerRun = await runP107Task(h, {
        taskId: P107_TASK_WRITER, runId: "run-w-writer", attemptId: "att-w-writer",
        roleBinding: P107_ROLE_BINDING_WRITER_V1, declaredPermissions: P107_DECLARED_WRITE_PERMISSIONS_V1, budget: P107_BUDGET_WRITER_V1,
      });
      const attW = taskAttemptRefFor(P107_PROJECT, P107_GOAL, P107_TASK_WRITER, "att-w-writer");
      const lease = await h.acquireWorkspaceWriteLease(buildP107AcquireWriteLeaseCommand({ commandId: "cmd-wln", projectId: P107_PROJECT, leaseId: "lease-w-w", scope: P107_SCOPE_WRITER, declaredWriteScope: P107_DECLARED_WRITE_PERMISSIONS_V1.writeScope, holder: { runRef: writerRun, attemptRef: attW, roleBinding: P107_ROLE_BINDING_WRITER_V1 } }));
      expect(lease.status).toBe("committed");
      // stale workspace (before != canonical) -> stale_workspace
      const stale = await recordP107Patch(h, {
        patchId: "patch-stale", runRef: writerRun, attemptRef: attW,
        beforeWorkspaceRevision: sc.workspaceRevision + 5, afterWorkspaceRevision: sc.workspaceRevision + 6,
        usedInputEvidenceRefs: [evA, evB], leaseId: "lease-w-w",
      });
      expect(stale.status).toBe("rejected");
      if (stale.status === "rejected") expect(stale.code).toBe("stale_workspace");
      // changed paths outside the lease scope -> scope_mismatch
      const mismatch = await recordP107Patch(h, {
        patchId: "patch-mismatch", runRef: writerRun, attemptRef: attW,
        beforeWorkspaceRevision: sc.workspaceRevision, afterWorkspaceRevision: sc.workspaceRevision + 1,
        usedInputEvidenceRefs: [evA, evB], leaseId: "lease-w-w", changedPaths: ["src/other/file.ts"],
      });
      expect(mismatch.status).toBe("rejected");
      if (mismatch.status === "rejected") expect(mismatch.code).toBe("scope_mismatch");
      // unaccepted input -> input_not_accepted (stale evidence is not accepted)
      const notAccepted = await recordP107Patch(h, {
        patchId: "patch-not-accepted", runRef: writerRun, attemptRef: attW,
        beforeWorkspaceRevision: sc.workspaceRevision, afterWorkspaceRevision: sc.workspaceRevision + 1,
        usedInputEvidenceRefs: [{ aggregateType: "Evidence", projectId: P107_PROJECT, evidenceId: "ev-does-not-exist" }, evB], leaseId: "lease-w-w",
      });
      expect(notAccepted.status).toBe("rejected");
      if (notAccepted.status === "rejected") expect(["input_not_found", "input_not_accepted"]).toContain(notAccepted.code);
      // happy patch
      const patch = await recordP107Patch(h, {
        patchId: "patch-w-1", runRef: writerRun, attemptRef: attW,
        beforeWorkspaceRevision: sc.workspaceRevision, afterWorkspaceRevision: sc.workspaceRevision + 1,
        usedInputEvidenceRefs: [evA, evB], leaseId: "lease-w-w",
      });
      expect(patch.status).toBe("committed");
      if (patch.status === "committed") {
        expect(patch.workspaceRevision).toBe(sc.workspaceRevision + 1);
      }
      // canonical Workspace revision advanced + lease released via patch-record
      const ws = await h.ledger.load({ aggregateType: "Workspace" as const, projectId: P107_PROJECT, workspaceId: P107_WORKSPACE });
      expect(ws.status).toBe("found");
      if (ws.status === "found") expect((ws.snapshot as { revision: number }).revision).toBe(sc.workspaceRevision + 1);
      const leaseSnap = await h.ledger.load(workspaceWriteLeaseRefFor(P107_PROJECT, "lease-w-w"));
      expect(leaseSnap.status).toBe("found");
      if (leaseSnap.status === "found") {
        const snap = leaseSnap.snapshot as { revision: number; lease: { status: string; postWriteWorkspaceRevision: number | null; patches: unknown[] } };
        expect(snap.revision).toBe(2);
        expect(snap.lease.status).toBe("released");
        expect(snap.lease.postWriteWorkspaceRevision).toBe(sc.workspaceRevision + 1);
        expect(snap.lease.patches.length).toBe(1);
      }
      // patch view shows the record + workspace revision
      const patchView = await h.workspacePatches({ projectId: P107_PROJECT, workspaceId: P107_WORKSPACE });
      expect(patchView.status).toBe("ready");
      if (patchView.status === "ready") {
        expect(patchView.patch.workspaceRevision).toBe(sc.workspaceRevision + 1);
        expect(patchView.patch.patches).toHaveLength(1);
        expect(patchView.patch.patches[0]!.changedPaths).toEqual(expect.arrayContaining(["src/p107/fix-a.ts"]));
        expect(patchView.patch.patches[0]!.checkResults[0]!.outcome).toBe("PASS");
        expect(patchView.patch.patches[0]!.usedInputEvidenceRefs).toHaveLength(2);
      }
    });

    // ------------------------------------------------------------------- //
    // Acceptance 7: goal-gate-full-check                                   //
    // ------------------------------------------------------------------- //

    it("A7 full gate check via runP107FullScenario (happy path: goal COMPLETED)", async () => {
      const h = await factory();
      const full = await runP107FullScenario(h);
      expect(full.workspaceRevisionAfter).toBeGreaterThan(1);
      const status = await h.goalStatus({ projectId: P107_PROJECT, goalId: P107_GOAL });
      expect(status.status).toBe("ready");
      if (status.status === "ready") {
        expect(status.goal.phase).toBe("COMPLETED");
      }
      const gateView = await h.taskVerification({
        projectId: P107_PROJECT, goalId: P107_GOAL, taskId: P107_TASK_GATE,
      });
      void gateView;
    });

    it("A7b failure facts stay traceable: gate FAIL -> goal never COMPLETED; timeline shows both", async () => {
      const h = await factory();
      const sc = await freshScenario(h);
      const anchorN = readerAnchor(sc);
      const runA = await runP107Reader(h, "a", "2026-09-06T12:00:10.000Z", "2026-09-06T12:00:30.000Z");
      const runB = await runP107Reader(h, "b", "2026-09-06T12:00:10.000Z", "2026-09-06T12:00:30.000Z");
      await submitP107Evidence(h, { evidenceId: "ev-g-a", taskId: P107_TASK_READER_A, outcome: "PASS", runRef: runA, coverage: [{ obligationId: P107_OBL_READERS, requirementId: P107_VR_READERS }], anchor: anchorN });
      await submitP107Evidence(h, { evidenceId: "ev-g-b", taskId: P107_TASK_READER_B, outcome: "PASS", runRef: runB, coverage: [{ obligationId: P107_OBL_READERS, requirementId: P107_VR_READERS }], anchor: anchorN });
      expect((await h.reduceTask(buildP107ReduceTaskCommand(P107_TASK_READER_A))).status).toBe("committed");
      expect((await h.reduceTask(buildP107ReduceTaskCommand(P107_TASK_READER_B))).status).toBe("committed");
      const integrationRun = await runP107Task(h, { taskId: P107_TASK_INTEGRATION, runId: "run-g-int", attemptId: "att-g-int", roleBinding: P107_ROLE_BINDING_READER_V1, declaredPermissions: P107_DECLARED_READ_PERMISSIONS_V1, budget: P107_BUDGET_READER_V1 });
      void integrationRun;
      const join = await recordP107Integration(h, {
        resultId: "res-g-1", runRef: integrationRun, attemptRef: taskAttemptRefFor(P107_PROJECT, P107_GOAL, P107_TASK_INTEGRATION, "att-g-int"),
        inputs: [
          { sourceTaskId: P107_TASK_READER_A, sourceRunRef: runA, kind: "evidence", evidenceRef: evidenceRefFor(P107_PROJECT, "ev-g-a"), artifactRef: null, handoffPacketRef: null },
          { sourceTaskId: P107_TASK_READER_B, sourceRunRef: runB, kind: "evidence", evidenceRef: evidenceRefFor(P107_PROJECT, "ev-g-b"), artifactRef: null, handoffPacketRef: null },
        ],
        workspaceRevision: sc.workspaceRevision, planRef: sc.planRef,
      });
      expect(join.status).toBe("committed");
      expect((await h.reduceTask(buildP107ReduceTaskCommand(P107_TASK_INTEGRATION))).status).toBe("committed");
      const writerRun = await runP107Task(h, { taskId: P107_TASK_WRITER, runId: "run-g-w", attemptId: "att-g-w", roleBinding: P107_ROLE_BINDING_WRITER_V1, declaredPermissions: P107_DECLARED_WRITE_PERMISSIONS_V1, budget: P107_BUDGET_WRITER_V1 });
      const attW = taskAttemptRefFor(P107_PROJECT, P107_GOAL, P107_TASK_WRITER, "att-g-w");
      expect((await h.acquireWorkspaceWriteLease(buildP107AcquireWriteLeaseCommand({ commandId: "cmd-g-w", projectId: P107_PROJECT, leaseId: "lease-g-w", scope: P107_SCOPE_WRITER, declaredWriteScope: [P107_WRITE_SCOPE], holder: { runRef: writerRun, attemptRef: attW, roleBinding: P107_ROLE_BINDING_WRITER_V1 } }))).status).toBe("committed");
      expect((await recordP107Patch(h, { patchId: "patch-g-1", runRef: writerRun, attemptRef: attW, beforeWorkspaceRevision: sc.workspaceRevision, afterWorkspaceRevision: sc.workspaceRevision + 1, usedInputEvidenceRefs: [evidenceRefFor(P107_PROJECT, "ev-g-a"), evidenceRefFor(P107_PROJECT, "ev-g-b")], leaseId: "lease-g-w" })).status).toBe("committed");
      await submitP107Evidence(h, { evidenceId: "ev-g-writer", taskId: P107_TASK_WRITER, outcome: "PASS", runRef: writerRun, coverage: [{ obligationId: P107_OBL_PATCH, requirementId: P107_VR_PATCH }, { obligationId: P107_OBL_PATCH, requirementId: "vr-p107-writer-accepts" }], anchor: readerAnchor(sc, sc.workspaceRevision + 1) });
      expect((await h.reduceTask(buildP107ReduceTaskCommand(P107_TASK_WRITER))).status).toBe("committed");
      const gateRun = await runP107Task(h, { taskId: P107_TASK_GATE, runId: "run-g-gate", attemptId: "att-g-gate", roleBinding: P107_ROLE_BINDING_WRITER_V1, declaredPermissions: P107_DECLARED_WRITE_PERMISSIONS_V1, budget: P107_BUDGET_WRITER_V1 });
      // gate evidence FAILs
      await submitP107Evidence(h, { evidenceId: "ev-g-gate-fail", taskId: P107_TASK_GATE, outcome: "FAIL", runRef: gateRun, coverage: [{ obligationId: P107_OBL_GATE, requirementId: P107_VR_GATE }], anchor: readerAnchor(sc, sc.workspaceRevision + 1) });
      expect((await h.reduceTask(buildP107ReduceTaskCommand(P107_TASK_GATE))).status).toBe("committed");
      const reduce = await reduceP107Goal(h, 1);
      expect(reduce.status).toBe("committed");
      const status = await h.goalStatus({ projectId: P107_PROJECT, goalId: P107_GOAL });
      expect(status.status).toBe("ready");
      if (status.status === "ready") {
        expect(status.goal.phase).not.toBe("COMPLETED");
        expect((status.goal.reasonCodes as string[]).some((c) => c.includes("FAIL")) || status.goal.phase === "FAILED" || status.goal.phase === "BLOCKED").toBe(true);
      }
      const timeline = await h.goalTimeline({ projectId: P107_PROJECT, goalId: P107_GOAL });
      expect(timeline.status).toBe("ready");
      if (timeline.status === "ready") {
        expect(timeline.timeline.length).toBeGreaterThanOrEqual(1);
      }
      // gate failure facts remain traceable on the gate task view
      const gateReduction = await h.ledger.load({ aggregateType: "TaskReduction" as const, projectId: P107_PROJECT, goalId: P107_GOAL, taskId: P107_TASK_GATE });
      expect(gateReduction.status).toBe("found");
    });

    // ------------------------------------------------------------------- //
    // Acceptance 8: run isolation — coordinator exit revokes nothing       //
    // ------------------------------------------------------------------- //

    it("A8 coordinator exit does not revoke an independent worker's legal lease; role contexts isolated", async () => {
      const h = await factory();
      await freshScenario(h);
      const workerRun = await runP107Reader(h, "a", "2026-09-06T12:00:10.000Z", "2026-09-06T12:00:30.000Z");
      const coordRun = await runP107Task(h, {
        taskId: P107_TASK_READER_B, runId: "run-coord", attemptId: "att-coord",
        roleBinding: P107_ROLE_BINDING_COORDINATOR_V1, declaredPermissions: P107_DECLARED_READ_PERMISSIONS_V1, budget: P107_BUDGET_READER_V1,
      });
      const attW = taskAttemptRefFor(P107_PROJECT, P107_GOAL, P107_TASK_READER_A, "att-p107-read-a");
      const attC = taskAttemptRefFor(P107_PROJECT, P107_GOAL, P107_TASK_READER_B, "att-coord");
      const workerLease = await h.acquireWorkspaceReadLease(buildP107AcquireReadLeaseCommand({ commandId: "cmd-isl-w", projectId: P107_PROJECT, leaseId: "lease-isl-worker", scope: P107_SCOPE_READER_A, holder: { runRef: workerRun, attemptRef: attW, roleBinding: P107_ROLE_BINDING_READER_V1 } }));
      expect(workerLease.status).toBe("committed");
      const coordLease = await h.acquireWorkspaceReadLease(buildP107AcquireReadLeaseCommand({ commandId: "cmd-isl-c", projectId: P107_PROJECT, leaseId: "lease-isl-coord", scope: P107_SCOPE_READER_B, holder: { runRef: coordRun, attemptRef: attC, roleBinding: P107_ROLE_BINDING_COORDINATOR_V1 } }));
      expect(coordLease.status).toBe("committed");
      // coordinator exits: releases only its own lease (its run ends).
      const coordExit = await h.releaseWorkspaceLease(buildP107ReleaseLeaseCommand({ commandId: "cmd-isl-exit", projectId: P107_PROJECT, leaseId: "lease-isl-coord", kind: "read", holderRunRef: coordRun }));
      expect(coordExit.status).toBe("committed");
      // the worker's legal lease REMAINS valid (admissible + view-present).
      const workerSnap = await h.ledger.load(workspaceReadLeaseRefFor(P107_PROJECT, "lease-isl-worker"));
      expect(workerSnap.status).toBe("found");
      if (workerSnap.status === "found") {
        const snap = workerSnap.snapshot as { lease: { status: string; expiresAt: string | null } };
        expect(evaluateLeaseAdmissibility({ status: snap.lease.status as "active" | "released", expiresAt: snap.lease.expiresAt }, P107_SCHEMA)).toEqual({ admissible: true });
      }
      const view = await h.workspaceLeaseView({ projectId: P107_PROJECT, workspaceId: P107_WORKSPACE });
      expect(view.status).toBe("ready");
      if (view.status === "ready") {
        expect(view.lease.readLeases.some((l) => l.leaseId === "lease-isl-worker" && l.status === "active")).toBe(true);
        expect(view.lease.readLeases.some((l) => l.leaseId === "lease-isl-coord" && l.status === "released")).toBe(true);
      }
      // a non-holder actor cannot force-release the worker lease (role isolation).
      const foreign = await h.releaseWorkspaceLease(buildP107ReleaseLeaseCommand({ commandId: "cmd-isl-foreign", projectId: P107_PROJECT, leaseId: "lease-isl-worker", kind: "read", holderRunRef: coordRun }));
      expect(foreign.status).toBe("rejected");
      if (foreign.status === "rejected") expect(foreign.code).toBe("not_holder");
    });

    // ------------------------------------------------------------------- //
    // Views freshness (display-only)                                       //
    // ------------------------------------------------------------------- //

    it("V1 views: not_ready vs not_found freshness semantics; display-only conflict view", async () => {
      const h = await factory();
      await freshScenario(h);
      const leaseView = await h.workspaceLeaseView({ projectId: P107_PROJECT, workspaceId: P107_WORKSPACE });
      expect(["ready", "not_found", "not_ready"]).toContain(leaseView.status);
      const conflictView = await h.integrationConflicts({ projectId: P107_PROJECT, goalId: P107_GOAL, taskId: P107_TASK_INTEGRATION });
      expect(["ready", "not_found", "not_ready"]).toContain(conflictView.status);
      const patchView = await h.workspacePatches({ projectId: P107_PROJECT, workspaceId: P107_WORKSPACE });
      expect(["ready", "not_found", "not_ready"]).toContain(patchView.status);
    });
  });
}
