/**
 * P1-03 lane A unit tests: DispatchEngineImpl.drive (outbox-before-side-effect).
 *
 * The drive loads a PENDING dispatch intent from the ledger, assembles a bounded
 * envelope, records it via Control.startRun, and ONLY THEN invokes RunPort.start
 * (Acceptance 3). runFact is lane B and not implemented here, so the stub runtimes
 * return NO events — drive never reaches runFact — keeping the ordering test
 * self-contained.
 *
 * Coverage:
 *   - happy path: scanned=1 started=1 completed=0 pendingRemaining=0, and the
 *     outbox is ALREADY "started" at the instant runtime.start is invoked
 *     (outbox-before-side-effect);
 *   - zero pending intents -> all zeros, runtime never invoked;
 *   - context reject / needs_material -> failure (context_rejected / rejected),
 *     runtime never invoked, outbox stays pending;
 *   - runtime error after a successful start -> failure (runtime_error) with the
 *     run already started.
 */
import { describe, expect, it } from "vitest";
import { createControlEngine } from "../../src/control/control-engine/control-engine.js";
import { InMemoryLedger } from "../../src/data/state-ledger/in-memory-ledger.js";
import type { StateLedger, LedgerCommit, LedgerCommitReceipt } from "../../src/contracts/ledger.js";
import { createDeterministicDeps, FIXED_ISO_2026_09_05 } from "../../src/testing/sequences.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1, buildBootstrapLedgerCommit } from "../contract-support/fixtures/bootstrap-fixture-v1.js";
import {
  MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1,
  buildCreateGoalCommand,
  buildGoalCreateLedgerCommit,
  goalSnapshotFor,
} from "../contract-support/fixtures/goal-fixtures.js";
import { ARCHITECTURE_BASELINE_FIXTURE_V1, COMPLETION_POLICY_FIXTURE_V1, buildActivateCommand, buildActivateLedgerCommit, buildInstallCommand, buildInstallLedgerCommit } from "../../src/fixtures/governance-fixtures.js";
import { completionPolicyPinFor, architectureBaselinePinFor } from "../../src/contracts/governance.js";
import {
  DISPATCH_PLAN_REVISION_FIXTURE_V1,
  buildEnvelopeFixture,
  buildManifestFixture,
  buildDispatchClaimCommand,
} from "../../src/fixtures/dispatch-fixtures.js";
import type { InstallArchitectureBaselineRevisionCommand, InstallCompletionPolicyRevisionCommand } from "../../src/contracts/governance.js";
import { buildApplyPlanCommand } from "../../src/fixtures/plan-fixtures.js";
import { buildPlanLedgerCommit } from "../../src/control/control-engine/records/plan.js";
import type { DispatchClaimCommand, DispatchOutboxEntrySnapshot } from "../../src/contracts/dispatch.js";
import { dispatchOutboxRefFor } from "../../src/contracts/dispatch.js";
import type { ArtifactRef } from "../../src/contracts/artifact.js";
import { artifactBodyDigest } from "../../src/contracts/artifact.js";
import type { TaskContextPort, TaskContextRequestV1, TaskContextResultV1 } from "../../src/contracts/task-envelope.js";
import type { RunPort, RunHandle, RunCapabilities } from "../../src/contracts/ports.js";
import type { TaskEnvelopeV1 } from "../../src/contracts/task-envelope.js";
import { createDispatchEngine, type DispatchEngineDeps } from "../../src/control/dispatch-engine/dispatch-engine.js";

const FIXED = FIXED_ISO_2026_09_05;
const PLAN_REF = { aggregateType: "PlanRevision" as const, projectId: "proj-alpha", planId: "plan-dispatch-mvp" };
const BUNDLE: ArtifactRef = { kind: "artifact", contentType: "text/plain", digest: artifactBodyDigest("ctx-body"), sizeBytes: 8, source: { kind: "plan-revision", refId: "plan-dispatch-mvp", revision: "1" } };

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
  const control = createControlEngine({ ledger, now: d.clock, eventId: d.eventId });
  return { ledger, control };
}

async function bootstrap(ledger: StateLedger): Promise<void> {
  const bootCmd = buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, { commandId: "cmd-bootstrap", correlationId: "corr-bootstrap", submittedAt: FIXED });
  const receipt = await ledger.commit(
    buildBootstrapLedgerCommit(bootCmd, { eventIds: ["evt-bootstrap-1", "evt-bootstrap-2", "evt-bootstrap-3", "evt-bootstrap-4"], occurredAt: FIXED }),
  );
  expect(receipt.status).toBe("committed");
}

async function createGoal(ledger: StateLedger): Promise<void> {
  const scope = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[0]!;
  const cmd = buildCreateGoalCommand(scope, { commandId: "cmd-goal", correlationId: "corr-goal", submittedAt: FIXED });
  const receipt = await ledger.commit(
    buildGoalCreateLedgerCommit(cmd, { eventId: "evt-goal", occurredAt: FIXED, projectRevision: 1, workspaceRevision: 1 }),
  );
  expect(receipt.status).toBe("committed");
}

async function installActivateAndPlan(ledger: StateLedger): Promise<void> {
  const cp = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, { commandId: "cmd-install-cp", correlationId: "corr-install-cp", submittedAt: FIXED, projectId: "proj-alpha", idempotencyKey: "inst-cp" }) as InstallCompletionPolicyRevisionCommand;
  await ledger.commit(buildInstallLedgerCommit(cp, { eventId: "evt-install-cp", occurredAt: FIXED }));
  const ab = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, { commandId: "cmd-install-ab", correlationId: "corr-install-ab", submittedAt: FIXED, projectId: "proj-alpha", idempotencyKey: "inst-ab" }) as InstallArchitectureBaselineRevisionCommand;
  await ledger.commit(buildInstallLedgerCommit(ab, { eventId: "evt-install-ab", occurredAt: FIXED }));
  await ledger.commit(
    buildActivateLedgerCommit(
      buildActivateCommand(completionPolicyPinFor(cp), { commandId: "cmd-act-cp", correlationId: "corr-act-cp", submittedAt: FIXED, projectId: "proj-alpha", expectedRevision: 1, idempotencyKey: "act-cp" }),
      { eventId: "evt-act-cp", occurredAt: FIXED, activeAggregateRevision: 1, projectRevision: 1 },
    ),
  );
  await ledger.commit(
    buildActivateLedgerCommit(
      buildActivateCommand(architectureBaselinePinFor(ab), { commandId: "cmd-act-ab", correlationId: "corr-act-ab", submittedAt: FIXED, projectId: "proj-alpha", expectedRevision: 1, idempotencyKey: "act-ab" }),
      { eventId: "evt-act-ab", occurredAt: FIXED, activeAggregateRevision: 1, projectRevision: 1 },
    ),
  );
  const apply = buildApplyPlanCommand(DISPATCH_PLAN_REVISION_FIXTURE_V1, { commandId: "cmd-apply", correlationId: "corr-apply", submittedAt: FIXED, projectId: "proj-alpha", expectedRevision: 1, idempotencyKey: "apply" });
  await ledger.commit(
    buildPlanLedgerCommit(apply, {
      eventId: "evt-apply", occurredAt: FIXED, acceptedAt: FIXED,
      pins: { completionPolicy: completionPolicyPinFor(cp), architectureBaseline: architectureBaselinePinFor(ab) },
      baseGoal: goalSnapshotFor(buildCreateGoalCommand(MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[0]!, { commandId: "cmd-goal", correlationId: "corr-goal", submittedAt: FIXED })),
    }),
  );
}

async function setupAccepted() {
  const { ledger, control } = makeHarness();
  await bootstrap(ledger);
  await createGoal(ledger);
  await installActivateAndPlan(ledger);
  return { ledger, control };
}

function claimCmd(deps: { commandId: string; attemptId: string; runId: string; idempotencyKey: string }): DispatchClaimCommand {
  return buildDispatchClaimCommand({
    commandId: deps.commandId, correlationId: "corr-" + deps.commandId, submittedAt: FIXED,
    projectId: "proj-alpha", attemptId: deps.attemptId, runId: deps.runId, idempotencyKey: deps.idempotencyKey,
  });
}

function readyContext(): TaskContextPort {
  return {
    async assemble(request: TaskContextRequestV1): Promise<TaskContextResultV1> {
      const envelope = buildEnvelopeFixture({
        envelopeId: "env-" + request.runRef.runId,
        projectId: request.projectId,
        workspaceId: request.workspaceId,
        goalId: request.goalId,
        taskId: request.taskId,
        runId: request.runRef.runId,
        attemptId: request.attemptRef.attemptId,
        planRef: request.planRef,
        workspaceRevision: request.workspaceSnapshot.revision,
        bundleRef: BUNDLE,
        roleBinding: request.roleBinding,
        budget: request.budget,
        permissions: { policyRevision: request.roleBinding.policyRevision, tools: [...request.declaredPermissions.tools], writeScope: [...request.declaredPermissions.writeScope] },
      });
      const manifest = buildManifestFixture({ workspaceId: request.workspaceId, workspaceRevision: request.workspaceSnapshot.revision, planRef: request.planRef });
      return { status: "ready", envelope, manifest, bundleRef: BUNDLE };
    },
  };
}

function noEventRuntime(opts: { onStart?: (envelope: TaskEnvelopeV1) => void; throwOnStart?: boolean } = {}): RunPort {
  return {
    async capabilities(): Promise<RunCapabilities> { return { replayable: true, supportsSnapshot: false, maxEnvelopeBytes: 64 * 1024 }; },
    async start(envelope: TaskEnvelopeV1): Promise<RunHandle> {
      if (opts.throwOnStart) throw new Error("runtime start failed");
      opts.onStart?.(envelope);
      return { runRef: envelope.runRef, pollFreshEvents: async () => [] };
    },
  };
}

describe("DispatchEngineImpl.drive: outbox-before-side-effect", () => {
  it("starts the run only AFTER the outbox intent is recorded started", async () => {
    const { ledger, control } = await setupAccepted();
    const claim = await control.claimTask(claimCmd({ commandId: "cmd-claim-a", attemptId: "att-a", runId: "run-a", idempotencyKey: "claim-a" }));
    expect(claim.status).toBe("committed");
    if (claim.status !== "committed") return;

    let outboxAtStart: string | null = null;
    let runtimeCalls = 0;
    const runtime: RunPort = {
      async capabilities(): Promise<RunCapabilities> { return { replayable: true, supportsSnapshot: false, maxEnvelopeBytes: 64 * 1024 }; },
      async start(envelope: TaskEnvelopeV1): Promise<RunHandle> {
        runtimeCalls += 1;
        const ref = dispatchOutboxRefFor(envelope.projectId, envelope.goalId, envelope.taskId, envelope.attemptRef.attemptId);
        const r = await ledger.load(ref);
        outboxAtStart = r.status === "found" ? (r.snapshot as DispatchOutboxEntrySnapshot).status : "missing";
        return { runRef: envelope.runRef, pollFreshEvents: async () => [] };
      },
    };
    const drive = createDispatchEngine({ ledger, control, contextCompiler: readyContext(), runtime });

    const result = await drive.drive({ reason: "test", maxIntents: 8 });
    expect(result).toEqual({ scanned: 1, started: 1, completed: 0, pendingRemaining: 0, failures: [] });
    expect(runtimeCalls).toBe(1);
    // The outbox was ALREADY "started" the instant runtime.start was invoked.
    expect(outboxAtStart).toBe("started");
    const remaining = await ledger.pendingDispatchIntents(8);
    expect(remaining).toHaveLength(0);
  });

  it("no pending intents -> all zero and no runtime call", async () => {
    const { ledger, control } = await setupAccepted();
    let called = 0;
    const runtime = noEventRuntime({ onStart: () => { called += 1; } });
    const drive = createDispatchEngine({ ledger, control, contextCompiler: readyContext(), runtime });
    const result = await drive.drive({ reason: "test" });
    expect(result).toEqual({ scanned: 0, started: 0, completed: 0, pendingRemaining: 0, failures: [] });
    expect(called).toBe(0);
  });

  it("context rejected -> context_rejected failure, outbox stays pending, runtime not called", async () => {
    const { ledger, control } = await setupAccepted();
    await control.claimTask(claimCmd({ commandId: "cmd-claim-a", attemptId: "att-a", runId: "run-a", idempotencyKey: "claim-a" }));
    let called = 0;
    const rejectedContext: TaskContextPort = {
      async assemble(): Promise<TaskContextResultV1> {
        return { status: "rejected", code: "forbidden_tool_or_scope", issues: ["scope overflow"] };
      },
    };
    const runtime = noEventRuntime({ onStart: () => { called += 1; } });
    const drive = createDispatchEngine({ ledger, control, contextCompiler: rejectedContext, runtime });
    const result = await drive.drive({ reason: "test" });
    expect(result.scanned).toBe(1);
    expect(result.started).toBe(0);
    expect(result.pendingRemaining).toBe(1);
    expect(called).toBe(0);
    expect(result.failures[0]!.code).toBe("context_rejected");
    expect(result.failures[0]!.intentId).toBe("att-a");
    const remaining = await ledger.pendingDispatchIntents(8);
    expect(remaining).toHaveLength(1);
  });

  it("needs_material -> rejected failure, runtime not called", async () => {
    const { ledger, control } = await setupAccepted();
    await control.claimTask(claimCmd({ commandId: "cmd-claim-a", attemptId: "att-a", runId: "run-a", idempotencyKey: "claim-a" }));
    let called = 0;
    const needsContext: TaskContextPort = {
      async assemble(): Promise<TaskContextResultV1> {
        return { status: "needs_material", gaps: [{ kind: "required-material", refId: "x", message: "missing material" }], selectedRefs: [] };
      },
    };
    const runtime = noEventRuntime({ onStart: () => { called += 1; } });
    const drive = createDispatchEngine({ ledger, control, contextCompiler: needsContext, runtime });
    const result = await drive.drive({ reason: "test" });
    expect(result.started).toBe(0);
    expect(called).toBe(0);
    expect(result.failures[0]!.code).toBe("rejected");
  });

  it("runtime error after a successful start -> runtime_error failure (run started)", async () => {
    const { ledger, control } = await setupAccepted();
    await control.claimTask(claimCmd({ commandId: "cmd-claim-a", attemptId: "att-a", runId: "run-a", idempotencyKey: "claim-a" }));
    const runtime = noEventRuntime({ throwOnStart: true });
    const drive = createDispatchEngine({ ledger, control, contextCompiler: readyContext(), runtime });
    const result = await drive.drive({ reason: "test" });
    expect(result.scanned).toBe(1);
    expect(result.started).toBe(1);
    expect(result.completed).toBe(0);
    expect(result.failures[0]!.code).toBe("runtime_error");
    const remaining = await ledger.pendingDispatchIntents(8);
    expect(remaining).toHaveLength(0);
  });
});
