/**
 * P1-01 persistent (file-backed SQLite) harness — restart semantics twin of the
 * P1-00 InMemory harness. Wires the REAL modules (ControlEngineImpl,
 * HumanCollaborationImpl) to the REAL SQLite adapters (SqliteStateLedger,
 * SqliteReadModelIndex) so the full path is executable against a file:
 *
 * P1-03 (frozen by the shared baseline): the harness additionally wires the
 * REAL dispatch/run modules — ArtifactVault / ContextCompilerImpl /
 * FakeRuntimeAdapter / DispatchEngineImpl — around the SAME SqliteStateLedger,
 * so claim -> assemble -> start -> run facts -> restart evidence is
 * executable against a file.
 *
 * Restart semantics (fixed in IMPLEMENTATION-HANDOFF.md — "P1-01 契约与存储语义"):
 *   - durable state lives ONLY in the SQLite file(s); "restart" = close() +
 *     a NEW instance on the SAME file path. No in-process state carries over.
 *   - single-file strategy: one database file for the ledger
 *     (ledger.sqlite), one separate database file for the read model
 *     (readmodel.sqlite), both under one temporary directory.
 *   - the read model is ALWAYS an event projection: rebuild from a fresh file
 *     must reproduce the same views. The canonical state never comes from the
 *     read model.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceBootstrapCommand, WorkspaceBootstrapReceipt } from "../contracts/bootstrap.js";
import type { CommitCursor } from "../contracts/command-event.js";
import type { ProjectionReceipt } from "../contracts/goal-view.js";
import type { ControlEngine, HumanCollaboration } from "../contracts/modules.js";
import type {
  GovernanceActivateCommand,
  GovernanceActivateReceipt,
  GovernanceInstallCommand,
  GovernanceInstallReceipt,
} from "../contracts/governance.js";
import type { ApplyPlanRevisionCommand, PlanRevisionReceipt } from "../contracts/plan.js";
import type {
  PlanGraphViewQuery,
  PlanGraphViewResult,
  TaskDetailViewQuery,
  TaskDetailViewResult,
} from "../contracts/plan-view.js";
import type {
  DispatchClaimCommand,
  DispatchClaimReceipt,
  DispatchReadinessQuery,
  DispatchReadinessResult,
  DispatchStartCommand,
  DispatchStartReceipt,
  RunFactCommand,
  RunFactReceipt,
} from "../contracts/dispatch.js";
import type { ActiveAgentQuery, ActiveAgentViewResult } from "../contracts/active-agent.js";
import type { ArtifactPort } from "../contracts/artifact.js";
import type { TaskContextPort } from "../contracts/task-envelope.js";
import type { DispatchDriveResult, DispatchDriveTrigger, DispatchPort, RunPort } from "../contracts/ports.js";
import type {
  TaskVerificationViewQuery,
  TaskVerificationViewResult,
} from "../contracts/verification-view.js";
import type { ReviewerPort, CheckPort, VerificationPort } from "../contracts/verification.js";
import type { SubmitEvidenceCommand, SubmitEvidenceReceipt } from "../contracts/evidence.js";
import type { ReduceTaskCommand, ReduceTaskReceipt } from "../contracts/reduction.js";
import type { ReduceGoalCommand, ReduceGoalReceipt } from "../contracts/goal-phase.js";
import type { GoalStatusQuery, GoalStatusViewResult, GoalTimelineQuery, GoalTimelineViewResult } from "../contracts/goal-phase-view.js";
import type { ReviewContextPort, ReviewContextRequestV1, ReviewContextResultV1 } from "../contracts/review-context.js";
import type {
  ClaimReplacementCommand,
  ClaimReplacementReceipt,
  HandoffPort,
  RecordHandoffCommand,
  RecordHandoffReceipt,
} from "../contracts/handoff.js";
import type { HandoffContextPort, HandoffContextRequestV1, HandoffContextResultV1 } from "../contracts/handoff-context.js";
import type { HandoffControlPort } from "../contracts/handoff-control.js";
import type { HandoffProvenanceViewQuery, HandoffProvenanceViewResult } from "../contracts/handoff-view.js";
import { HandoffContextCompilerImpl } from "../context/handoff-context-compiler.js";
import { FakeHandoffControlRuntimeAdapter } from "../runtime/handoff-control-adapter.js";
import { HandoffDriveEngineImpl } from "../control/handoff-drive.js";
import { WorkspaceDriveEngineImpl } from "../control/workspace-drive.js";
import { FakeWorkspaceCapabilityAdapter } from "../runtime/workspace-capability-adapter.js";
import type { WorkspaceCapabilityPort } from "../contracts/workspace-capability.js";
import type { WorkspaceLeasePort } from "../contracts/workspace-lease.js";
import type { WorkspaceDrivePort } from "../contracts/workspace-drive.js";
import type { WorkspaceLeaseViewQuery, WorkspaceLeaseViewResult, IntegrationConflictViewQuery, IntegrationConflictViewResult, WorkspacePatchViewQuery, WorkspacePatchViewResult } from "../contracts/workspace-views.js";
import type { AcquireWorkspaceReadLeaseCommand, AcquireReadLeaseReceipt, AcquireWorkspaceWriteLeaseCommand, AcquireWriteLeaseReceipt, ReleaseWorkspaceLeaseCommand, ReleaseLeaseReceipt } from "../contracts/workspace-lease.js";
import type { RecordIntegrationResultCommand, RecordIntegrationResultReceipt } from "../contracts/integration.js";
import type { RecordPatchCommand, RecordPatchReceipt } from "../contracts/patch.js";
import type { FakeRuntimeScriptV1 } from "../contracts/fixtures/dispatch-fixtures.js";
import { FAKE_RUNTIME_SCRIPT_COMPLETED_V1 } from "../contracts/fixtures/dispatch-fixtures.js";
import { SqliteStateLedger, createSqliteStateLedger } from "../sqlite-ledger/sqlite-ledger.js";
import {
  SqliteReadModelIndex,
  createSqliteReadModelIndex,
} from "../sqlite-read-model/sqlite-read-model-index.js";
import { ControlEngineImpl } from "../control/control-engine.js";
import { HumanCollaborationImpl } from "../interaction/human-collaboration.js";
import { ArtifactVault } from "../vault/artifact-vault.js";
import { ContextCompilerImpl } from "../context/context-compiler.js";
import { FakeRuntimeAdapter } from "../runtime/fake-runtime-adapter.js";
import { DispatchEngineImpl } from "../control/dispatch-engine.js";
import { createDeterministicDeps, type InjectableDeps } from "../contracts/testing/sequences.js";
import { DETERMINISTIC_CHECK_PROVIDERS, FAKE_REVIEWER_PORT } from "../contracts/testing/check-providers.double.js";
import { VerificationEngineImpl } from "../verification/verification-engine.js";
import { ReviewContextCompilerImpl } from "../context/review-context-compiler.js";

export interface PersistentSqliteHarnessOptions {
  /** Directory for the SQLite files. Default: fresh mkdtemp in os.tmpdir(). */
  dir?: string;
  /** Ledger database file name (default "ledger.sqlite"). */
  ledgerFile?: string;
  /** Read model database file name (default "readmodel.sqlite"). */
  readModelFile?: string;
  /** Deterministic-sequence overrides (default createDeterministicDeps()). */
  deps?: Partial<InjectableDeps>;
  /** P1-03: default FakeRuntimeAdapter script (FAKE_RUNTIME_SCRIPT_COMPLETED_V1). */
  runtimeScript?: FakeRuntimeScriptV1;
  /** P1-04: explicit CheckPort registry for the default VerificationEngine. */
  checkPorts?: CheckPort[];
  /** P1-04: explicit reviewer capability port (default FakeReviewerPort). */
  reviewer?: ReviewerPort;
  /** P1-04: explicit VerificationEngine (default: deterministic providers). */
  verification?: VerificationPort;
  /** P1-04: explicit ReviewContextPort (default ReviewContextCompilerImpl). */
  reviewContext?: ReviewContextPort;
  /** P1-06: explicit HandoffContextPort (default HandoffContextCompilerImpl). */
  handoffContext?: HandoffContextPort;
  /** P1-06: explicit HandoffControlPort (default FakeHandoffControlRuntimeAdapter). */
  handoffControl?: HandoffControlPort;
  /** P1-07: explicit WorkspaceCapabilityPort (default FakeWorkspaceCapabilityAdapter). */
  workspaceCapability?: WorkspaceCapabilityPort;
  /** P1-07: explicit WorkspaceDrivePort (default WorkspaceDriveEngineImpl). */
  workspaceDrive?: WorkspaceDrivePort;
  /** P1-07: explicit RunPort override (default FakeRuntimeAdapter(script)). */
  runtime?: RunPort;
}

export interface PersistentSqliteHarness {
  readonly dir: string;
  readonly ledgerPath: string;
  readonly readModelPath: string;

  ledger: SqliteStateLedger;
  readModel: SqliteReadModelIndex;
  control: ControlEngine;
  collaboration: HumanCollaboration;
  /** P1-03: real modules (default wiring; overridable per options). */
  vault: ArtifactPort;
  contextCompiler: TaskContextPort;
  runtime: RunPort;
  dispatchEngine: DispatchPort;
  /** P1-04: default VerificationEngine (deterministic check providers). */
  verification: VerificationPort;
  /** P1-04: default ReviewContextPort (bounded ReviewPacket assembly). */
  reviewContext: ReviewContextPort;
  /** P1-06: bounded handoff-context assembly (never a transcript). */
  handoffContext: HandoffContextPort;
  /** P1-06: WorkerRuntime control face (pause/stop + public snapshot). */
  handoffControl: HandoffControlPort;
  /** P1-06: DispatchEngine.HandoffPort (replacement outbox drive). */
  handoffDrive: HandoffPort;
  /** P1-07: workspace capability port (default FakeWorkspaceCapabilityAdapter). */
  workspaceCapability: WorkspaceCapabilityPort;
  /** P1-07: DispatchEngine.WorkspaceLeasePort (read/write leases + release). */
  workspaceLease: WorkspaceLeasePort;
  /** P1-07: parallel drive port (real overlap, replacement intents skipped). */
  workspaceDrive: WorkspaceDrivePort;

  bootstrap(command: WorkspaceBootstrapCommand): Promise<WorkspaceBootstrapReceipt>;
  /** P1-02: governance install (immutable revision; never auto-activates). */
  install(command: GovernanceInstallCommand): Promise<GovernanceInstallReceipt>;
  /** P1-02: governance activation (CAS; per-kind active refs). */
  activate(command: GovernanceActivateCommand): Promise<GovernanceActivateReceipt>;
  /** P1-02: accept a hand-authored PlanRevision (fixed pins). */
  applyPlan(command: ApplyPlanRevisionCommand): Promise<PlanRevisionReceipt>;
  /** P1-02: Plan Graph / Task Detail views (freshness by opaque cursor). */
  planGraph(query: PlanGraphViewQuery): Promise<PlanGraphViewResult>;
  taskDetail(query: TaskDetailViewQuery): Promise<TaskDetailViewResult>;
  /** P1-03: readiness / claim / start / run-fact control entries. */
  dispatchReadiness(query: DispatchReadinessQuery): Promise<DispatchReadinessResult>;
  claimTask(command: DispatchClaimCommand): Promise<DispatchClaimReceipt>;
  startRun(command: DispatchStartCommand): Promise<DispatchStartReceipt>;
  runFact(command: RunFactCommand): Promise<RunFactReceipt>;
  /** P1-04: admit evidence + binding anchor (atomic; full idempotency). */
  submitEvidence(command: SubmitEvidenceCommand): Promise<SubmitEvidenceReceipt>;
  /** P1-04: deterministic Task/Gate reduction (never Goal phase). */
  reduceTask(command: ReduceTaskCommand): Promise<ReduceTaskReceipt>;
  /** P1-05: deterministic Goal phase reduction (never Task phase). */
  reduceGoal(command: ReduceGoalCommand): Promise<ReduceGoalReceipt>;
  /** P1-03: ActiveAgent view (freshness by opaque cursor). */
  activeAgent(query: ActiveAgentQuery): Promise<ActiveAgentViewResult>;
  /** P1-04: task-detail verification view (freshness by opaque cursor). */
  taskVerification(query: TaskVerificationViewQuery): Promise<TaskVerificationViewResult>;
  /** P1-05: goal phase status view (freshness by opaque cursor). */
  goalStatus(query: GoalStatusQuery): Promise<GoalStatusViewResult>;
  /** P1-05: goal phase timeline view (freshness by opaque cursor). */
  goalTimeline(query: GoalTimelineQuery): Promise<GoalTimelineViewResult>;
  /** P1-06: register a bounded HandoffPacket (body-first pass-through). */
  recordHandoff(command: RecordHandoffCommand): Promise<RecordHandoffReceipt>;
  /** P1-06: replacement claim (B's new lifecycle; lease CAS). */
  claimReplacement(command: ClaimReplacementCommand): Promise<ClaimReplacementReceipt>;
  /** P1-06: handoff provenance timeline (display only). */
  handoffProvenance(query: HandoffProvenanceViewQuery): Promise<HandoffProvenanceViewResult>;
  /** P1-06: bounded handoff-context assembly. */
  assembleHandoff(request: HandoffContextRequestV1): Promise<HandoffContextResultV1>;
  /** P1-07: acquire a shared read lease (read-read never conflicts). */
  acquireWorkspaceReadLease(command: AcquireWorkspaceReadLeaseCommand): Promise<AcquireReadLeaseReceipt>;
  /** P1-07: acquire the exclusive write lease (index CAS, invariant #7). */
  acquireWorkspaceWriteLease(command: AcquireWorkspaceWriteLeaseCommand): Promise<AcquireWriteLeaseReceipt>;
  /** P1-07: holder-only lease release. */
  releaseWorkspaceLease(command: ReleaseWorkspaceLeaseCommand): Promise<ReleaseLeaseReceipt>;
  /** P1-07: evidence join record (conflict preservation; never overwrite). */
  recordIntegrationResult(command: RecordIntegrationResultCommand): Promise<RecordIntegrationResultReceipt>;
  /** P1-07: record ONE patch artifact (atomic workspace revision advance + lease release). */
  recordPatch(command: RecordPatchCommand): Promise<RecordPatchReceipt>;
  /** P1-07: workspace lease status view (display only). */
  workspaceLeaseView(query: WorkspaceLeaseViewQuery): Promise<WorkspaceLeaseViewResult>;
  /** P1-07: integration join/conflict view (display only, no judgement). */
  integrationConflicts(query: IntegrationConflictViewQuery): Promise<IntegrationConflictViewResult>;
  /** P1-07: workspace patch view (display only). */
  workspacePatches(query: WorkspacePatchViewQuery): Promise<WorkspacePatchViewResult>;
  /** P1-04: review-context assembly (bounded ReviewPacket). */
  assembleReview(request: ReviewContextRequestV1): Promise<ReviewContextResultV1>;
  /** P1-03: outbox drive (claim -> assemble -> start -> events). */
  drive(trigger: DispatchDriveTrigger): Promise<DispatchDriveResult>;
  /** Pull new events from the ledger and push them into the read model. */
  advanceProjection(): Promise<ProjectionReceipt>;
  /** Last cursor pushed into the read model (null until first advance). */
  observedCursor(): CommitCursor | null;

  /** Emulates a process restart: closes both connections. Idempotent. */
  close(): Promise<void>;

  /** Restart: NEW instances on the SAME ledger file. readModelFile may differ. */
  reopen(options?: { readModelFile?: string }): Promise<PersistentSqliteHarness>;

  /** Close both connections and remove the harness directory (best effort). */
  cleanup(): Promise<void>;
}

interface BuiltHarness {
  ledger: SqliteStateLedger;
  readModel: SqliteReadModelIndex;
  control: ControlEngine;
  collaboration: HumanCollaboration;
  vault: ArtifactPort;
  contextCompiler: TaskContextPort;
  runtime: RunPort;
  dispatchEngine: DispatchPort;
  verification: VerificationPort;
  reviewContext: ReviewContextPort;
  handoffContext: HandoffContextPort;
  handoffControl: HandoffControlPort;
  handoffDrive: HandoffPort;
  workspaceCapability: WorkspaceCapabilityPort;
  workspaceLease: WorkspaceLeasePort;
  workspaceDrive: WorkspaceDrivePort;
  advanceProjection: () => Promise<ProjectionReceipt>;
  observedCursor: () => CommitCursor | null;
  planGraph: (query: PlanGraphViewQuery) => Promise<PlanGraphViewResult>;
  taskDetail: (query: TaskDetailViewQuery) => Promise<TaskDetailViewResult>;
}

function buildHarness(
  dir: string,
  ledgerFile: string,
  readModelFile: string,
  deps: Partial<InjectableDeps>,
  runtimeScript: FakeRuntimeScriptV1,
  checkPorts: CheckPort[] | undefined,
  reviewer: ReviewerPort | undefined,
  verificationOverride: VerificationPort | undefined,
  reviewContextOverride: ReviewContextPort | undefined,
  handoffContextOverride: HandoffContextPort | undefined,
  handoffControlOverride: HandoffControlPort | undefined,
  workspaceCapabilityOverride: WorkspaceCapabilityPort | undefined,
  workspaceDriveOverride: WorkspaceDrivePort | undefined,
  runtimeOverride: RunPort | undefined,
): BuiltHarness {
  const d: InjectableDeps = { ...createDeterministicDeps(), ...deps };
  const ledger = createSqliteStateLedger({ path: join(dir, ledgerFile) });
  const readModel = createSqliteReadModelIndex({ path: join(dir, readModelFile) });
  const workspaceCapability: WorkspaceCapabilityPort =
    workspaceCapabilityOverride ?? new FakeWorkspaceCapabilityAdapter();
  const control = new ControlEngineImpl({ ledger, now: d.clock, eventId: d.eventId, workspaceCapability });
  const collaboration = new HumanCollaborationImpl({
    control,
    readModel,
    commandId: d.commandId,
    correlationId: d.correlationId,
    now: d.clock,
  });
  const vault: ArtifactPort = new ArtifactVault();
  const contextCompiler: TaskContextPort = new ContextCompilerImpl({ ledger, vault, now: d.clock });
  const runtime: RunPort = runtimeOverride ?? new FakeRuntimeAdapter(runtimeScript);
  const dispatchEngine: DispatchPort = new DispatchEngineImpl({
    ledger,
    control,
    contextCompiler,
    runtime,
  });
  const verification: VerificationPort =
    verificationOverride ?? new VerificationEngineImpl(
      { ledger, now: d.clock },
      checkPorts ?? DETERMINISTIC_CHECK_PROVIDERS,
      reviewer ?? FAKE_REVIEWER_PORT,
    );
  const reviewContext: ReviewContextPort =
    reviewContextOverride ?? new ReviewContextCompilerImpl({ ledger, vault, now: d.clock });
  const handoffContext: HandoffContextPort =
    handoffContextOverride ?? new HandoffContextCompilerImpl({ ledger, vault, now: d.clock });
  const handoffControl: HandoffControlPort =
    handoffControlOverride ?? new FakeHandoffControlRuntimeAdapter(runtime);
  const handoffDrive: HandoffPort = new HandoffDriveEngineImpl({
    ledger,
    control,
    handoffContext,
    runtime,
  });
  const workspaceDrive: WorkspaceDrivePort =
    workspaceDriveOverride ?? new WorkspaceDriveEngineImpl({
      ledger,
      control,
      contextCompiler,
      runtime,
      now: d.clock,
    });
  const workspaceLease: WorkspaceLeasePort = {
    acquireReadLease: (command) => control.acquireWorkspaceReadLease(command),
    acquireWriteLease: (command) => control.acquireWorkspaceWriteLease(command),
    releaseLease: (command) => control.releaseWorkspaceLease(command),
  };
  let lastCursor: CommitCursor | null = null;
  async function advanceProjection(): Promise<ProjectionReceipt> {
    let receipt: ProjectionReceipt | null = null;
    for (;;) {
      const page = await ledger.events({ afterCursor: lastCursor, limit: 64 });
      receipt = await readModel.advance(page);
      lastCursor = page.throughCursor;
      if (!page.hasMore) break;
    }
    return receipt!;
  }
  return {
    ledger,
    readModel,
    control,
    collaboration,
    vault,
    contextCompiler,
    runtime,
    dispatchEngine,
    verification,
    reviewContext,
    handoffContext,
    handoffControl,
    handoffDrive,
    workspaceCapability,
    workspaceLease,
    workspaceDrive,
    advanceProjection,
    observedCursor: () => lastCursor,
    planGraph: (query) => readModel.planGraph(query),
    taskDetail: (query) => readModel.taskDetail(query),
  };
}

export async function createPersistentSqliteHarness(
  options: PersistentSqliteHarnessOptions = {},
): Promise<PersistentSqliteHarness> {
  const dir = options.dir ?? (await mkdtemp(join(tmpdir(), "agent-platform-p1-01-")));
  const ledgerFile = options.ledgerFile ?? "ledger.sqlite";
  const readModelFile = options.readModelFile ?? "readmodel.sqlite";
  const deps = options.deps ?? {};
  const runtimeScript = options.runtimeScript ?? FAKE_RUNTIME_SCRIPT_COMPLETED_V1;
  const checkPorts = options.checkPorts;
  const reviewer = options.reviewer;
  const verificationOverride = options.verification;
  const reviewContextOverride = options.reviewContext;

  const make = (
    ledgerFilename: string,
    readModelFilename: string,
  ): PersistentSqliteHarness => {
    const built = buildHarness(dir, ledgerFilename, readModelFilename, deps, runtimeScript, checkPorts, reviewer, verificationOverride, reviewContextOverride, options.handoffContext, options.handoffControl, options.workspaceCapability, options.workspaceDrive, options.runtime);
    let closed = false;
    return {
      dir,
      ledgerPath: join(dir, ledgerFilename),
      readModelPath: join(dir, readModelFilename),
      ledger: built.ledger,
      readModel: built.readModel,
      control: built.control,
      collaboration: built.collaboration,
      vault: built.vault,
      contextCompiler: built.contextCompiler,
      runtime: built.runtime,
      dispatchEngine: built.dispatchEngine,
      verification: built.verification,
      reviewContext: built.reviewContext,
      handoffContext: built.handoffContext,
      handoffControl: built.handoffControl,
      handoffDrive: built.handoffDrive,
      workspaceCapability: built.workspaceCapability,
      workspaceLease: built.workspaceLease,
      workspaceDrive: built.workspaceDrive,
      bootstrap: (command) => built.control.bootstrap(command),
      install: (command) => built.control.install(command),
      activate: (command) => built.control.activate(command),
      applyPlan: (command) => built.control.applyPlan(command),
      planGraph: (query) => built.planGraph(query),
      taskDetail: (query) => built.taskDetail(query),
      dispatchReadiness: (query) => built.control.dispatchReadiness(query),
      claimTask: (command) => built.control.claimTask(command),
      startRun: (command) => built.control.startRun(command),
      runFact: (command) => built.control.runFact(command),
      submitEvidence: (command) => built.control.submitEvidence(command),
      reduceTask: (command) => built.control.reduceTask(command),
      reduceGoal: (command) => built.control.reduceGoal(command),
      activeAgent: (query) => built.readModel.activeAgent(query),
      goalStatus: (query) => built.readModel.goalStatus(query),
      goalTimeline: (query) => built.readModel.goalTimeline(query),
      taskVerification: (query) => built.readModel.taskVerification(query),
      recordHandoff: (command) => built.control.recordHandoff(command),
      claimReplacement: (command) => built.control.claimReplacement(command),
      handoffProvenance: (query) => built.readModel.handoffProvenance(query),
      acquireWorkspaceReadLease: (command) => built.control.acquireWorkspaceReadLease(command),
      acquireWorkspaceWriteLease: (command) => built.control.acquireWorkspaceWriteLease(command),
      releaseWorkspaceLease: (command) => built.control.releaseWorkspaceLease(command),
      recordIntegrationResult: (command) => built.control.recordIntegrationResult(command),
      recordPatch: (command) => built.control.recordPatch(command),
      workspaceLeaseView: (query) => built.readModel.workspaceLeaseView(query),
      integrationConflicts: (query) => built.readModel.integrationConflicts(query),
      workspacePatches: (query) => built.readModel.workspacePatches(query),
      assembleHandoff: (request) => built.handoffContext.assemble(request),
      assembleReview: (request) => built.reviewContext.assemble(request),
      drive: (trigger) => built.dispatchEngine.drive(trigger),
      advanceProjection: built.advanceProjection,
      observedCursor: built.observedCursor,
      close: async () => {
        if (closed) return;
        closed = true;
        await Promise.allSettled([built.ledger.close(), built.readModel.close()]);
      },
      reopen: async (reopenOptions) => {
        if (!closed) {
          throw new Error(
            "PersistentSqliteHarness: close() before reopen(); reopen() means process restart",
          );
        }
        const nextReadModelFile = reopenOptions?.readModelFile ?? readModelFilename;
        return make(ledgerFilename, nextReadModelFile);
      },
      cleanup: async () => {
        await Promise.allSettled([built.ledger.close(), built.readModel.close()]);
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      },
    };
  };

  return make(ledgerFile, readModelFile);
}