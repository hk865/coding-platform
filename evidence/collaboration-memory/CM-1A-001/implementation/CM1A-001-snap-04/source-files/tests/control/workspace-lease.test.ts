/**
 * P1-07 lane A unit tests: WorkspaceLeaseEngineImpl (acquireReadLease /
 * acquireWriteLease / releaseLease) + read-only-capability enforcement.
 *
 * BASELINE GAPS (reported to integrator — see IMPLEMENTATION handoff):
 *   (1) WORKSPACE_BOOTSTRAP_FIXTURE_V1 bootstraps proj-alpha/proj-beta, but the
 *       P1-07 fixtures use proj-p107, so the shared prepareP107Scenario fails at
 *       governance-activate (Project proj-p107 not found). This test builds the
 *       scenario against a local bootstrap fixture creating proj-p107/ws-p107.
 *   (2) dispatch-engine.drive calls buildDispatchStartCommand WITHOUT a run-scoped
 *       idempotencyKey, so every startRun shares "p1-03-start"; the SECOND run in
 *       a project fails with "startRun rejected: idempotency_conflict". All lanes
 *       of the P1-07 contract suite (A3/A5/A8) run multiple tasks, so this blocks
 *       the acceptance. These tests therefore use SINGLE-run scenarios + synthetic
 *       non-holder RunRefs to exercise the lease guards; the multi-run acceptance is
 *       delegated to the (auto-skipped) shared contract suite.
 *   (3) The shared release fixture sets expectedRevision=1 but
 *       validateReleaseWorkspaceLeaseCommand (via validateLeaseBase) requires
 *       expectedRevision===0; these tests build release commands with
 *       expectedRevision 0 (spread-override).
 */
import { describe, expect, it } from "vitest";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { toP1_07Harness, p107GoalScope, runP107Reader, runP107Task, type P1_07HarnessLike } from "../contract-suite/p1-07-harness.js";
import {
  buildP107AcquireReadLeaseCommand,
  buildP107AcquireWriteLeaseCommand,
  buildP107ReleaseLeaseCommand,
  P107_PROJECT,
  P107_WORKSPACE,
  P107_GOAL,
  P107_SCHEMA,
  P107_TASK_WRITER_B,
  P107_ROLE_BINDING_READER_V1,
  P107_ROLE_BINDING_WRITER_V1,
  P107_BUDGET_READER_V1,
  P107_BUDGET_WRITER_V1,
  P107_DECLARED_READ_PERMISSIONS_V1,
  P107_DECLARED_WRITE_PERMISSIONS_V1,
  P107_SCOPE_READER_A,
  P107_SCOPE_WRITER,
  P107_WRITE_SCOPE,
  taskAttemptRefFor,
} from "../contract-suite/p1-07-harness.js";
import type { P1_07TestHarness } from "../contract-suite/p1-07-harness.js";
import { evaluateLeaseAdmissibility } from "../../src/control/control-engine/policies/workspace-lease.js";
import { workspaceReadLeaseRefFor, workspaceWriteLeaseRefFor, workspaceReadLeaseIndexRefFor, workspaceWriteLeaseIndexRefFor, type ConflictScopeV1, type WorkspaceReadLeaseV1 } from "../../src/contracts/workspace-lease.js";
import type { RunRef } from "../../src/contracts/dispatch.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { COMPLETION_POLICY_FIXTURE_V1, ARCHITECTURE_BASELINE_FIXTURE_V1, buildInstallCommand, buildActivateCommand } from "../../src/fixtures/governance-fixtures.js";
import { completionPolicyPinFor, architectureBaselinePinFor } from "../../src/contracts/governance.js";
import { buildCreateGoalCommand } from "../contract-support/fixtures/goal-fixtures.js";
import { buildApplyPlanCommand } from "../../src/fixtures/plan-fixtures.js";
import { P107_PLAN_REVISION_FIXTURE_V1 } from "../contract-support/fixtures/workspace-fixtures.js";

/** Clock used by the harness ControlEngine (a lease expiring earlier than NOW is expired). */
const NOW = P107_SCHEMA; // "2026-09-06T12:00:00.000Z"

type Harness = P1_07TestHarness;

async function makeHarness(): Promise<Harness> {
  const h = createInMemoryHarness({ deps: { clock: () => NOW } });
  return toP1_07Harness(h as unknown as P1_07HarnessLike);
}

async function makeHarnessWithCapability(cap: { capabilitiesFor: (env: unknown) => Promise<{ status: "ready" | "unsupported" | "rejected"; capabilities?: unknown; reason?: string }> }): Promise<Harness> {
  const h = createInMemoryHarness({ deps: { clock: () => NOW }, workspaceCapability: cap as never });
  return toP1_07Harness(h as unknown as P1_07HarnessLike);
}

/** Build the governance+goal+plan scenario against a proj-p107 bootstrap fixture. */
async function prepareLocalScenario(h: Harness): Promise<void> {
  const bootFixture = { schemaVersion: 1 as const, entries: [{ projectId: P107_PROJECT, workspaceId: P107_WORKSPACE }] };
  expect((await h.bootstrap(buildBootstrapCommand(bootFixture, { commandId: "cmd-p107-boot", correlationId: "corr-p107-boot", submittedAt: P107_SCHEMA }))).status).toBe("committed");
  const installPolicy = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, { commandId: "cmd-p107-install-policy", correlationId: "corr-p107-install-policy", submittedAt: P107_SCHEMA, projectId: P107_PROJECT, idempotencyKey: "p107-install-policy" });
  const installBaseline = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, { commandId: "cmd-p107-install-baseline", correlationId: "corr-p107-install-baseline", submittedAt: P107_SCHEMA, projectId: P107_PROJECT, idempotencyKey: "p107-install-baseline" });
  expect((await h.install(installPolicy)).status).toBe("committed");
  expect((await h.install(installBaseline)).status).toBe("committed");
  const actPolicy = buildActivateCommand(completionPolicyPinFor(installPolicy as never), { commandId: "cmd-p107-activate-policy", correlationId: "corr-p107-activate-policy", submittedAt: P107_SCHEMA, projectId: P107_PROJECT, expectedRevision: 1, idempotencyKey: "p107-activate-policy" });
  const actBaseline = buildActivateCommand(architectureBaselinePinFor(installBaseline as never), { commandId: "cmd-p107-activate-baseline", correlationId: "corr-p107-activate-baseline", submittedAt: P107_SCHEMA, projectId: P107_PROJECT, expectedRevision: 1, idempotencyKey: "p107-activate-baseline" });
  expect((await h.activate(actPolicy)).status).toBe("committed");
  expect((await h.activate(actBaseline)).status).toBe("committed");
  const goal = await h.control.submit(buildCreateGoalCommand(p107GoalScope(), { commandId: "cmd-p107-create-goal", correlationId: "corr-p107-create-goal", submittedAt: P107_SCHEMA, idempotencyKey: "p1-07-create-goal" }));
  expect(goal.status).toBe("committed");
  const plan = await h.applyPlan(buildApplyPlanCommand(P107_PLAN_REVISION_FIXTURE_V1, { commandId: "cmd-p107-apply-plan", correlationId: "corr-p107-apply-plan", submittedAt: P107_SCHEMA, projectId: P107_PROJECT, expectedRevision: 1, idempotencyKey: "p1-07-apply-plan" }));
  expect(plan.status).toBe("committed");
}

async function readerRun(h: Harness): Promise<RunRef> {
  return runP107Reader(h, "a", "2026-09-06T12:00:10.000Z", "2026-09-06T12:00:30.000Z");
}

/** A write-capable run from the independent WRITER_B leaf task (no depends_on). */
async function writerRun(h: Harness, label: string): Promise<RunRef> {
  return runP107Task(h, {
    taskId: P107_TASK_WRITER_B,
    runId: "run-w-" + label,
    attemptId: "att-w-" + label,
    roleBinding: P107_ROLE_BINDING_WRITER_V1,
    declaredPermissions: P107_DECLARED_WRITE_PERMISSIONS_V1,
    budget: P107_BUDGET_WRITER_V1,
  });
}

const scopePath = (id: string): ConflictScopeV1 => ({ schemaVersion: 1, projectId: P107_PROJECT, workspaceId: P107_WORKSPACE, kind: "path", id, revision: null });
const readerAttempt = () => taskAttemptRefFor(P107_PROJECT, P107_GOAL, "task-p107-read-a", "att-p107-read-a");
const writerAttempt = (label: string) => taskAttemptRefFor(P107_PROJECT, P107_GOAL, P107_TASK_WRITER_B, "att-w-" + label);
const foreignRun = (id: string): RunRef => ({ aggregateType: "Run", projectId: P107_PROJECT, goalId: P107_GOAL, runId: id });

const acquireWrite = (h: Harness, leaseId: string, runRef: RunRef, attemptRef: ReturnType<typeof taskAttemptRefFor>, commandId: string, scope: ConflictScopeV1 = P107_SCOPE_WRITER, expiresAt?: string | null) =>
  h.acquireWorkspaceWriteLease(buildP107AcquireWriteLeaseCommand({ commandId, projectId: P107_PROJECT, leaseId, scope, declaredWriteScope: [P107_WRITE_SCOPE], ...(expiresAt === undefined ? {} : { expiresAt }), holder: { runRef, attemptRef, roleBinding: P107_ROLE_BINDING_WRITER_V1 } }));

const acquireRead = (h: Harness, leaseId: string, runRef: RunRef, attemptRef: ReturnType<typeof taskAttemptRefFor>, commandId: string, scope: ConflictScopeV1 = P107_SCOPE_READER_A, expiresAt?: string | null) =>
  h.acquireWorkspaceReadLease(buildP107AcquireReadLeaseCommand({ commandId, projectId: P107_PROJECT, leaseId, scope, ...(expiresAt === undefined ? {} : { expiresAt }), holder: { runRef, attemptRef, roleBinding: P107_ROLE_BINDING_READER_V1 } }));

describe("WorkspaceLeaseEngineImpl — acquireReadLease", () => {
  it("read-read never conflicts: re-entrant overlapping read leases are both granted", async () => {
    const h = await makeHarness();
    await prepareLocalScenario(h);
    const runA = await readerRun(h);
    const l1 = await acquireRead(h, "lease-read-1", runA, readerAttempt(), "cmd-read-1", P107_SCOPE_READER_A);
    expect(l1.status).toBe("committed");
    const l2 = await acquireRead(h, "lease-read-2", runA, readerAttempt(), "cmd-read-2", P107_SCOPE_READER_A);
    expect(l2.status).toBe("committed");
    const index = await h.ledger.load(workspaceReadLeaseIndexRefFor(P107_PROJECT, P107_WORKSPACE));
    expect(index.status).toBe("found");
    if (index.status === "found") {
      const snap = index.snapshot as { activeReadLeases: { leaseId: string }[]; revision: number };
      expect(snap.activeReadLeases.map((e) => e.leaseId).sort()).toEqual(["lease-read-1", "lease-read-2"]);
      expect(snap.revision).toBe(2);
    }
  });

  it("unknown holder run -> run_not_found", async () => {
    const h = await makeHarness();
    await prepareLocalScenario(h);
    const res = await h.acquireWorkspaceReadLease(buildP107AcquireReadLeaseCommand({ commandId: "cmd-rnf", projectId: P107_PROJECT, leaseId: "lease-rnf", scope: P107_SCOPE_READER_A, holder: { runRef: foreignRun("run-x"), attemptRef: readerAttempt(), roleBinding: P107_ROLE_BINDING_READER_V1 } }));
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") expect(res.code).toBe("run_not_found");
  });

  it("reader can never obtain a write lease (capability_readonly, zero write)", async () => {
    const h = await makeHarness();
    await prepareLocalScenario(h);
    const runA = await readerRun(h);
    const write = await h.acquireWorkspaceWriteLease(buildP107AcquireWriteLeaseCommand({ commandId: "cmd-w-as-reader", projectId: P107_PROJECT, leaseId: "lease-w-reader", scope: P107_SCOPE_WRITER, declaredWriteScope: [P107_WRITE_SCOPE], holder: { runRef: runA, attemptRef: readerAttempt(), roleBinding: P107_ROLE_BINDING_READER_V1 } }));
    expect(write.status).toBe("rejected");
    if (write.status === "rejected") expect(write.code).toBe("capability_readonly");
    const idx = await h.ledger.load(workspaceWriteLeaseIndexRefFor(P107_PROJECT, P107_WORKSPACE));
    expect(idx.status).toBe("not_found");
  });

  it("unsupported capability -> capability_unsupported (never a silent degrade)", async () => {
    const h = await makeHarnessWithCapability({ capabilitiesFor: () => Promise.resolve({ status: "unsupported" }) });
    await prepareLocalScenario(h);
    const runA = await readerRun(h);
    const res = await h.acquireWorkspaceReadLease(buildP107AcquireReadLeaseCommand({ commandId: "cmd-read-un", projectId: P107_PROJECT, leaseId: "lease-read-un", scope: P107_SCOPE_READER_A, holder: { runRef: runA, attemptRef: readerAttempt(), roleBinding: P107_ROLE_BINDING_READER_V1 } }));
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") expect(res.code).toBe("capability_unsupported");
  });

  it("idempotent replay: same command replayed; index not re-grown", async () => {
    const h = await makeHarness();
    await prepareLocalScenario(h);
    const runA = await readerRun(h);
    const cmd = buildP107AcquireReadLeaseCommand({ commandId: "cmd-read-ip", projectId: P107_PROJECT, leaseId: "lease-read-ip", scope: P107_SCOPE_READER_A, holder: { runRef: runA, attemptRef: readerAttempt(), roleBinding: P107_ROLE_BINDING_READER_V1 } });
    const first = await h.acquireWorkspaceReadLease(cmd);
    expect(first.status).toBe("committed");
    if (first.status === "committed") expect(first.replayed).toBe(false);
    const second = await h.acquireWorkspaceReadLease(cmd);
    expect(second.status).toBe("committed");
    if (second.status === "committed") expect(second.replayed).toBe(true);
    const index = await h.ledger.load(workspaceReadLeaseIndexRefFor(P107_PROJECT, P107_WORKSPACE));
    if (index.status === "found") {
      const snap = index.snapshot as { activeReadLeases: { leaseId: string }[]; revision: number };
      expect(snap.activeReadLeases).toHaveLength(1);
      expect(snap.revision).toBe(1);
    }
  });

  it("read-write conflict: an admissible write lease blocks an overlapping read (single run)", async () => {
    const h = await makeHarness();
    await prepareLocalScenario(h);
    const runW = await writerRun(h, "rw");
    const ws = await acquireWrite(h, "lease-wrw", runW, writerAttempt("rw"), "cmd-wrw", scopePath("src/p107"));
    expect(ws.status).toBe("committed");
    const read = await acquireRead(h, "lease-rw", runW, writerAttempt("rw"), "cmd-rw", scopePath("src/p107"));
    expect(read.status).toBe("rejected");
    if (read.status === "rejected") expect(read.code).toBe("read_lease_conflict");
  });
});

describe("WorkspaceLeaseEngineImpl — acquireWriteLease / release (A5/A5b unit-level)", () => {
  it("scope overreach -> scope_not_declared (zero write)", async () => {
    const h = await makeHarness();
    await prepareLocalScenario(h);
    const runW = await writerRun(h, "over");
    const overreach = await h.acquireWorkspaceWriteLease(buildP107AcquireWriteLeaseCommand({ commandId: "cmd-w-over", projectId: P107_PROJECT, leaseId: "lease-w-over", scope: P107_SCOPE_READER_A, declaredWriteScope: [P107_WRITE_SCOPE], holder: { runRef: runW, attemptRef: writerAttempt("over"), roleBinding: P107_ROLE_BINDING_WRITER_V1 } }));
    expect(overreach.status).toBe("rejected");
    if (overreach.status === "rejected") expect(overreach.code).toBe("scope_not_declared");
  });

  it("write-write conflict: the index CAS grants at most one effective lease", async () => {
    const h = await makeHarness();
    await prepareLocalScenario(h);
    const runW = await writerRun(h, "w1");
    const w1 = await acquireWrite(h, "lease-w1", runW, writerAttempt("w1"), "cmd-w1");
    expect(w1.status).toBe("committed");
    const w2 = await acquireWrite(h, "lease-w2", runW, writerAttempt("w1"), "cmd-w2");
    expect(w2.status).toBe("rejected");
    if (w2.status === "rejected") expect(w2.code).toBe("write_lease_conflict");
    const index = await h.ledger.load(workspaceWriteLeaseIndexRefFor(P107_PROJECT, P107_WORKSPACE));
    expect(index.status).toBe("found");
    if (index.status === "found") expect((index.snapshot as { activeLeaseId: string | null }).activeLeaseId).toBe("lease-w1");
  });

  it("expiry-vacate: an expired active lease does not block a new writer and is vacated atomically", async () => {
    const h = await makeHarness();
    await prepareLocalScenario(h);
    const runW = await writerRun(h, "exp");
    const wExp = await acquireWrite(h, "lease-exp", runW, writerAttempt("exp"), "cmd-wexp", P107_SCOPE_WRITER, "2026-09-06T09:00:00.000Z");
    expect(wExp.status).toBe("committed");
    const w2 = await acquireWrite(h, "lease-w2", runW, writerAttempt("exp"), "cmd-w2");
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

  it("holder-only release: not_holder, already_released, then clean release (write lease)", async () => {
    const h = await makeHarness();
    await prepareLocalScenario(h);
    const runW = await writerRun(h, "ww");
    const lease = await acquireWrite(h, "lease-ww", runW, writerAttempt("ww"), "cmd-wln");
    expect(lease.status).toBe("committed");
    const foreign = await h.releaseWorkspaceLease(rel({ commandId: "cmd-rel-f", projectId: P107_PROJECT, leaseId: "lease-ww", kind: "write", holderRunRef: foreignRun("run-foreign") }));
    expect(foreign.status).toBe("rejected");
    if (foreign.status === "rejected") expect(foreign.code).toBe("not_holder");
    const rel1 = await h.releaseWorkspaceLease(rel({ commandId: "cmd-rel-1", projectId: P107_PROJECT, leaseId: "lease-ww", kind: "write", holderRunRef: runW }));
    expect(rel1.status).toBe("committed");
    const rel2 = await h.releaseWorkspaceLease(rel({ commandId: "cmd-rel-2", projectId: P107_PROJECT, leaseId: "lease-ww", kind: "write", holderRunRef: runW }));
    expect(rel2.status).toBe("rejected");
    if (rel2.status === "rejected") expect(rel2.code).toBe("already_released");
  });

  it("holder-only release (read lease): not_holder then clean release", async () => {
    const h = await makeHarness();
    await prepareLocalScenario(h);
    const runA = await readerRun(h);
    const lease = await acquireRead(h, "lease-rl", runA, readerAttempt(), "cmd-rl");
    expect(lease.status).toBe("committed");
    const foreign = await h.releaseWorkspaceLease(rel({ commandId: "cmd-rel-rf", projectId: P107_PROJECT, leaseId: "lease-rl", kind: "read", holderRunRef: foreignRun("run-foreign") }));
    expect(foreign.status).toBe("rejected");
    if (foreign.status === "rejected") expect(foreign.code).toBe("not_holder");
    const ok = await h.releaseWorkspaceLease(rel({ commandId: "cmd-rel-r1", projectId: P107_PROJECT, leaseId: "lease-rl", kind: "read", holderRunRef: runA }));
    expect(ok.status).toBe("committed");
  });

  it("already_expired: releasing an expired-but-active lease is a zero-write prompt", async () => {
    const h = await makeHarness();
    await prepareLocalScenario(h);
    const runA = await readerRun(h);
    const lease = await acquireRead(h, "lease-ae", runA, readerAttempt(), "cmd-ae", P107_SCOPE_READER_A, "2026-09-06T09:00:00.000Z");
    expect(lease.status).toBe("committed");
    const rel1 = await h.releaseWorkspaceLease(rel({ commandId: "cmd-ae-rel", projectId: P107_PROJECT, leaseId: "lease-ae", kind: "read", holderRunRef: runA }));
    expect(rel1.status).toBe("rejected");
    if (rel1.status === "rejected") expect(rel1.code).toBe("already_expired");
    const load = await h.ledger.load(workspaceReadLeaseRefFor(P107_PROJECT, "lease-ae"));
    if (load.status === "found") expect((load.snapshot as { lease: WorkspaceReadLeaseV1 }).lease.status).toBe("active");
  });

  it("invalid command shape -> invalid", async () => {
    const h = await makeHarness();
    await prepareLocalScenario(h);
    const runA = await readerRun(h);
    const cmd = buildP107AcquireReadLeaseCommand({ commandId: "cmd-inv", projectId: P107_PROJECT, leaseId: "lease-inv", scope: P107_SCOPE_READER_A, holder: { runRef: runA, attemptRef: readerAttempt(), roleBinding: P107_ROLE_BINDING_READER_V1 } });
    const res = await h.acquireWorkspaceReadLease({ ...cmd, schemaVersion: 2 } as never);
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") expect(res.code).toBe("invalid");
  });
});

/** The shared release fixture uses expectedRevision 1 (frozen: the active lease revision). */
function rel(deps: Parameters<typeof buildP107ReleaseLeaseCommand>[0]) {
  return buildP107ReleaseLeaseCommand(deps);
}
