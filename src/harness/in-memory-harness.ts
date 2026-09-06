/**
 * In-memory P1-00 harness: wires the REAL modules (lanes A/B/C) and the
 * shared contracts into one executable tracer-bullet integration path:
 *   bootstrap -> createGoal -> InMemoryLedger -> EventPage -> ReadModelIndex -> GoalView
 *
 * P1-03 (frozen by the shared baseline): the harness additionally wires the
 * REAL dispatch/run modules — ArtifactVault / ContextCompilerImpl /
 * FakeRuntimeAdapter / DispatchEngineImpl — around the SAME InMemoryLedger, so
 * the full path claim -> assemble -> start -> run facts is executable.
 * Lane entry points (fixed by the shared baseline):
 *   - A: src/ledger/in-memory-ledger.ts        (InMemoryLedger implements StateLedger)
 *   - B: src/control/control-engine.ts         (ControlEngineImpl)
 *   - C: src/read-model/read-model-index.ts    (ReadModelIndexImpl)
 *       src/interaction/human-collaboration.ts (HumanCollaborationImpl)
 *   - P1-03: src/vault/artifact-vault.ts, src/context/context-compiler.ts,
 *            src/runtime/fake-runtime-adapter.ts, src/control/dispatch-engine.ts
 */
import type { WorkspaceBootstrapCommand, WorkspaceBootstrapReceipt } from "../contracts/bootstrap.js";
import type { CommitCursor } from "../contracts/command-event.js";
import type { ProjectionReceipt } from "../contracts/goal-view.js";
import type { StateLedger } from "../contracts/ledger.js";
import type { ControlEngine, HumanCollaboration } from "../contracts/modules.js";
import type { ReadModelIndex } from "../contracts/goal-view.js";
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
import type { PortfolioViewQuery, PortfolioViewResult, WorkspaceSummaryViewQuery, WorkspaceSummaryViewResult, PlanMatrixViewQuery, PlanMatrixViewResult, ActiveAgentsViewQuery, ActiveAgentsViewResult, TaskEvidenceViewQuery, TaskEvidenceViewResult, TimelineViewQuery, TimelineViewResult } from "../contracts/console-views.js";
import type { AcquireWorkspaceReadLeaseCommand, AcquireReadLeaseReceipt, AcquireWorkspaceWriteLeaseCommand, AcquireWriteLeaseReceipt, ReleaseWorkspaceLeaseCommand, ReleaseLeaseReceipt } from "../contracts/workspace-lease.js";
import type { RecordIntegrationResultCommand, RecordIntegrationResultReceipt } from "../contracts/integration.js";
import type { RecordPatchCommand, RecordPatchReceipt } from "../contracts/patch.js";
import type { FakeRuntimeScriptV1 } from "../contracts/fixtures/dispatch-fixtures.js";
import { FAKE_RUNTIME_SCRIPT_COMPLETED_V1 } from "../contracts/fixtures/dispatch-fixtures.js";
import { InMemoryLedger } from "../ledger/in-memory-ledger.js";
import { ControlEngineImpl } from "../control/control-engine.js";
import { ReadModelIndexImpl } from "../read-model/read-model-index.js";
import { HumanCollaborationImpl } from "../interaction/human-collaboration.js";
import { ArtifactVault } from "../vault/artifact-vault.js";
import { ContextCompilerImpl } from "../context/context-compiler.js";
import { FakeRuntimeAdapter } from "../runtime/fake-runtime-adapter.js";
import { DispatchEngineImpl } from "../control/dispatch-engine.js";
import { createDeterministicDeps, type InjectableDeps } from "../contracts/testing/sequences.js";
import { DETERMINISTIC_CHECK_PROVIDERS, FAKE_REVIEWER_PORT } from "../contracts/testing/check-providers.double.js";
import { VerificationEngineImpl } from "../verification/verification-engine.js";
import { ReviewContextCompilerImpl } from "../context/review-context-compiler.js";

export interface InMemoryHarnessOptions {
  /** P1-03: default FakeRuntimeAdapter script (FAKE_RUNTIME_SCRIPT_COMPLETED_V1). */
  runtimeScript?: FakeRuntimeScriptV1;
  /** P1-03: explicit RunPort override (instrumented/probe ports for tests). */
  runtime?: RunPort;
  /** P1-03: explicit TaskContextPort override (default ContextCompilerImpl). */
  contextCompiler?: TaskContextPort;
  /** P1-03: explicit ArtifactPort override (default ArtifactVault). */
  vault?: ArtifactPort;
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
  deps?: Partial<InjectableDeps>;
}

export interface InMemoryHarness {
  ledger: StateLedger;
  control: ControlEngine;
  readModel: ReadModelIndex;
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
  /** P1-08: console portfolio (read-only; readModel only). */
  consolePortfolio(query: PortfolioViewQuery): Promise<PortfolioViewResult>;
  /** P1-08: workspace summary (read-only; readModel only). */
  consoleSummary(query: WorkspaceSummaryViewQuery): Promise<WorkspaceSummaryViewResult>;
  /** P1-08: plan matrix (read-only; readModel only). */
  consolePlanMatrix(query: PlanMatrixViewQuery): Promise<PlanMatrixViewResult>;
  /** P1-08: workspace active agents (read-only; readModel only). */
  consoleActiveAgents(query: ActiveAgentsViewQuery): Promise<ActiveAgentsViewResult>;
  /** P1-08: task evidence detail (read-only; readModel only). */
  consoleTaskEvidence(query: TaskEvidenceViewQuery): Promise<TaskEvidenceViewResult>;
  /** P1-08: workspace timeline (read-only; readModel only). */
  consoleTimeline(query: TimelineViewQuery): Promise<TimelineViewResult>;
  /** P1-04: review-context assembly (bounded ReviewPacket). */
  assembleReview(request: ReviewContextRequestV1): Promise<ReviewContextResultV1>;
  /** P1-03: outbox drive (claim -> assemble -> start -> events). */
  drive(trigger: DispatchDriveTrigger): Promise<DispatchDriveResult>;
  /** pull new events from the ledger and push them into the ReadModelIndex */
  advanceProjection(): Promise<ProjectionReceipt>;
  /** last cursor pushed into the ReadModelIndex (null until first advance) */
  observedCursor(): CommitCursor | null;
}

export function createInMemoryHarness(options: InMemoryHarnessOptions = {}): InMemoryHarness {
  const d: InjectableDeps = { ...createDeterministicDeps(), ...(options.deps ?? {}) };
  const ledger: StateLedger = new InMemoryLedger();
  const workspaceCapability: WorkspaceCapabilityPort =
    options.workspaceCapability ?? new FakeWorkspaceCapabilityAdapter();
  const control = new ControlEngineImpl({
    ledger,
    now: d.clock,
    eventId: d.eventId,
    workspaceCapability,
  });
  const readModel = new ReadModelIndexImpl();
  const collaboration = new HumanCollaborationImpl({
    control,
    readModel,
    commandId: d.commandId,
    correlationId: d.correlationId,
    now: d.clock,
  });
  const vault: ArtifactPort = options.vault ?? new ArtifactVault();
  const contextCompiler: TaskContextPort =
    options.contextCompiler ?? new ContextCompilerImpl({ ledger, vault, now: d.clock });
  const runtime: RunPort =
    options.runtime ?? new FakeRuntimeAdapter(options.runtimeScript ?? FAKE_RUNTIME_SCRIPT_COMPLETED_V1);
  const dispatchEngine: DispatchPort = new DispatchEngineImpl({
    ledger,
    control,
    contextCompiler,
    runtime,
  });
  const verification: VerificationPort =
    options.verification ??
    new VerificationEngineImpl(
      { ledger, now: d.clock },
      options.checkPorts ?? DETERMINISTIC_CHECK_PROVIDERS,
      options.reviewer ?? FAKE_REVIEWER_PORT,
    );
  const reviewContext: ReviewContextPort =
    options.reviewContext ?? new ReviewContextCompilerImpl({ ledger, vault, now: d.clock });
  const handoffContext: HandoffContextPort =
    options.handoffContext ?? new HandoffContextCompilerImpl({ ledger, vault, now: d.clock });
  const handoffControl: HandoffControlPort =
    options.handoffControl ?? new FakeHandoffControlRuntimeAdapter(runtime);
  const handoffDrive: HandoffPort = new HandoffDriveEngineImpl({
    ledger,
    control,
    handoffContext,
    runtime,
  });
  const workspaceDrive: WorkspaceDrivePort =
    options.workspaceDrive ??
    new WorkspaceDriveEngineImpl({
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
    control,
    readModel,
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
    bootstrap: (command) => control.bootstrap(command),
    install: (command) => control.install(command),
    activate: (command) => control.activate(command),
    applyPlan: (command) => control.applyPlan(command),
    planGraph: (query) => readModel.planGraph(query),
    taskDetail: (query) => readModel.taskDetail(query),
    dispatchReadiness: (query) => control.dispatchReadiness(query),
    claimTask: (command) => control.claimTask(command),
    startRun: (command) => control.startRun(command),
    runFact: (command) => control.runFact(command),
    submitEvidence: (command) => control.submitEvidence(command),
    reduceTask: (command) => control.reduceTask(command),
    reduceGoal: (command) => control.reduceGoal(command),
    activeAgent: (query) => readModel.activeAgent(query),
    goalStatus: (query) => readModel.goalStatus(query),
    goalTimeline: (query) => readModel.goalTimeline(query),
    taskVerification: (query) => readModel.taskVerification(query),
    recordHandoff: (command) => control.recordHandoff(command),
    claimReplacement: (command) => control.claimReplacement(command),
    handoffProvenance: (query) => readModel.handoffProvenance(query),
    acquireWorkspaceReadLease: (command) => control.acquireWorkspaceReadLease(command),
    acquireWorkspaceWriteLease: (command) => control.acquireWorkspaceWriteLease(command),
    releaseWorkspaceLease: (command) => control.releaseWorkspaceLease(command),
    recordIntegrationResult: (command) => control.recordIntegrationResult(command),
    recordPatch: (command) => control.recordPatch(command),
    workspaceLeaseView: (query) => readModel.workspaceLeaseView(query),
    integrationConflicts: (query) => readModel.integrationConflicts(query),
    workspacePatches: (query) => readModel.workspacePatches(query),
    consolePortfolio: (query) => collaboration.consolePortfolio(query),
    consoleSummary: (query) => collaboration.consoleSummary(query),
    consolePlanMatrix: (query) => collaboration.consolePlanMatrix(query),
    consoleActiveAgents: (query) => collaboration.consoleActiveAgents(query),
    consoleTaskEvidence: (query) => collaboration.consoleTaskEvidence(query),
    consoleTimeline: (query) => collaboration.consoleTimeline(query),
    assembleHandoff: (request) => handoffContext.assemble(request),
    assembleReview: (request) => reviewContext.assemble(request),
    drive: (trigger) => dispatchEngine.drive(trigger),
    advanceProjection,
    observedCursor: () => lastCursor,
  };
}