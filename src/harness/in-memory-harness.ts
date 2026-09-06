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
import { WorkContextCompilerImpl } from "../context/work-context-compiler.js";
import { CompletedWorkContextCompilerImpl } from "../context/completed-work-context-compiler.js";
import { QueryJobContextStub } from "../contracts/testing/query-context.stub.js";
import { FakeLifecycleControlAdapter } from "../runtime/lifecycle-control-adapter.js";
import { FakeReadOnlyQueryAdapter } from "../runtime/read-only-query-adapter.js";
import type { ReadOnlyQueryPort, QueryJobViewQuery, QueryJobViewResult, SubmitQueryJobCommand, SubmitQueryJobReceipt, RecordQueryAnswerCommand, RecordQueryAnswerReceipt, CloseQueryJobCommand, CloseQueryJobReceipt, QueryContextPort, QueryContextRequestV1, QueryContextResultV1, SnapshotPort, PublicSnapshotQueryV1, PublicSnapshotResultV1 } from "../contracts/query-job.js";
import type { LifecycleControlPort, ControlIntentRef, ControlTimelineViewQuery, ControlTimelineViewResult, SubmitControlCommand, SubmitControlReceipt, RecordSafePointAckCommand, RecordSafePointAckReceipt, ControlIntentPort } from "../contracts/control-intent.js";
import type { CompletedWorkContextPort, CompletedWorkContextRequestV1, CompletedWorkContextResultV1 } from "../contracts/completed-work-context.js";
import { FakeContextContinuationRuntimeAdapter } from "../runtime/context-continuation-adapter.js";
import { ArchitectureReconcilerImpl } from "../control/architecture-reconciler.js";
import { FakeWorkspaceReaderAdapter } from "../data/workspace-reader-adapter.js";
import { CodeGraphPortImpl } from "../verification/code-graph-port.js";
import type { InspectionPort, InspectResultV1, CodeGraphPort } from "../contracts/architecture-reconciler.js";
import type { WorkspaceReadPort, CodeGraphReadQueryV1, CodeGraphReadResultV1 } from "../contracts/workspace-read.js";
import type { ArchitectureInspectionViewQuery, ArchitectureInspectionViewResult, RecordArchitectureInspectionCommand, RecordArchitectureInspectionReceipt, RecordArchitectureFindingCommand, RecordArchitectureFindingReceipt, RecordArchitectureDecisionBriefCommand, RecordArchitectureDecisionBriefReceipt, RecordCandidateBaselineProposalCommand, RecordCandidateBaselineProposalReceipt, ArchitectureInspectionIntentV1 } from "../contracts/architecture-inspection.js";
import type { WorkContextPort, WorkContextRequestV1, WorkContextAssemblyResultV1 } from "../contracts/work-context-port.js";
import type { ContextContinuationPort } from "../contracts/context-continuation-port.js";
import type { WorkContextViewQuery, WorkContextViewResult, BindWorkContextCommand, BindWorkContextReceipt, LinkWorkRunCommand, LinkWorkRunReceipt, RecordExecutionNoteCommand, RecordExecutionNoteReceipt, RecordContinuationCommand, RecordContinuationReceipt } from "../contracts/context-continuity.js";
import { PlanCompilerImpl } from "../control/plan-compiler.js";
import { PlanningContextCompilerImpl } from "../context/planning-context-compiler.js";
import type { PlanProposalPort, PlanningContextPort } from "../contracts/goal-change.js";

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
  /** P1-16: explicit WorkContextPort (default WorkContextCompilerImpl). */
  workContext?: WorkContextPort;
  /** P1-16: explicit ContextContinuationPort (default FakeContextContinuationRuntimeAdapter). */
  contextContinuation?: ContextContinuationPort;
  /** P1-17: explicit CompletedWorkContextPort (default CompletedWorkContextCompilerImpl). */
  completedWork?: CompletedWorkContextPort;
  /** P1-10: explicit LifecycleControlPort (default FakeLifecycleControlAdapter). */
  lifecycleControl?: LifecycleControlPort;
  /** P1-09: explicit ReadOnlyQueryPort (default FakeReadOnlyQueryAdapter). */
  readOnlyQuery?: ReadOnlyQueryPort;
  /** P1-09: explicit QueryContextPort (default stub compiler). */
  queryContext?: QueryContextPort;
  /** P1-09: explicit SnapshotPort (default stub). */
  snapshot?: SnapshotPort;
  /** P1-12: explicit WorkspaceReader (default FakeWorkspaceReaderAdapter). */
  workspaceReader?: WorkspaceReadPort;
  /** P1-12: explicit CodeGraphPort (default CodeGraphPortImpl). */
  codeGraph?: CodeGraphPort;
  /** P1-12: explicit InspectionPort (default ArchitectureReconcilerImpl). */
  inspection?: InspectionPort;
  /** P1-11: explicit PlanProposalPort (default PlanCompilerImpl stub). */
  planProposal?: PlanProposalPort;
  /** P1-11: explicit PlanningContextPort (default PlanningContextCompilerImpl stub). */
  planningContext?: PlanningContextPort;
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
  /** P1-16: bounded work-context assembly (ContextCompiler.WorkContextPort). */
  workContext: WorkContextPort;
  /** P1-16: WorkerRuntime continuation capability face. */
  contextContinuation: ContextContinuationPort;
  /** P1-17: completed-work selection (read-only composition; no writes). */
  completedWork: CompletedWorkContextPort;
  /** P1-10: WorkerRuntime lifecycle control face (safe points). */
  lifecycleControl: LifecycleControlPort;
  /** P1-09: read-only query run face (never touches source run/lease). */
  readOnlyQuery: ReadOnlyQueryPort;
  /** P1-09: bounded query-context assembly. */
  queryContext: QueryContextPort;
  /** P1-09: public snapshot face (noHiddenContextRead). */
  snapshot: SnapshotPort;
  /** P1-12: deterministic workspace reader (versioned source graphs). */
  workspaceReader: WorkspaceReadPort;
  /** P1-12: VerificationEngine.CodeGraphPort seam. */
  codeGraph: CodeGraphPort;
  /** P1-12: ArchitectureReconciler.InspectionPort seam. */
  inspection: InspectionPort;
  /** P1-11: bounded PlanCompiler proposal port (default stub until the lane lands). */
  planProposal: PlanProposalPort;
  /** P1-11: bounded planning-context port (default stub until the lane lands). */
  planningContext: PlanningContextPort;
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
  /** P1-16: work context view (read-only; readModel only). */
  workContextView(query: WorkContextViewQuery): Promise<WorkContextViewResult>;
  /** P1-16: bind the durable work identity. */
  bindWorkContext(command: BindWorkContextCommand): Promise<BindWorkContextReceipt>;
  /** P1-16: link a run to the work. */
  linkWorkRun(command: LinkWorkRunCommand): Promise<LinkWorkRunReceipt>;
  /** P1-16: register one immutable execution note (body-first). */
  recordExecutionNote(command: RecordExecutionNoteCommand): Promise<RecordExecutionNoteReceipt>;
  /** P1-16: record the observed continuation path. */
  recordContinuation(command: RecordContinuationCommand): Promise<RecordContinuationReceipt>;
  /** P1-12: record one immutable architecture inspection. */
  recordArchitectureInspection(command: RecordArchitectureInspectionCommand): Promise<RecordArchitectureInspectionReceipt>;
  /** P1-12: record one immutable architecture finding. */
  recordArchitectureFinding(command: RecordArchitectureFindingCommand): Promise<RecordArchitectureFindingReceipt>;
  /** P1-12: record one immutable architecture decision brief. */
  recordArchitectureDecisionBrief(command: RecordArchitectureDecisionBriefCommand): Promise<RecordArchitectureDecisionBriefReceipt>;
  /** P1-12: record one immutable candidate baseline proposal. */
  recordCandidateBaselineProposal(command: RecordCandidateBaselineProposalCommand): Promise<RecordCandidateBaselineProposalReceipt>;
  /** P1-12: architecture inspection view (read-only; readModel only). */
  architectureInspectionView(query: ArchitectureInspectionViewQuery): Promise<ArchitectureInspectionViewResult>;
  /** P1-17: completed-work selection source view (read-only; readModel only). */
  completedWorkView(query: import("../contracts/completed-work-context.js").CompletedWorkViewQuery): Promise<import("../contracts/completed-work-context.js").CompletedWorkViewResult>;
  /** P1-12: deterministic workspace graph read. */
  workspaceRead(query: CodeGraphReadQueryV1): Promise<CodeGraphReadResultV1>;
  /** P1-12: code-graph capability seam. */
  codeGraphQuery(query: import("../contracts/architecture-reconciler.js").CodeGraphQueryV1): Promise<import("../contracts/architecture-reconciler.js").CodeGraphResultV1>;
  /** P1-12: run one architecture inspection (pin-only baseline; fail closed). */
  inspect(intent: ArchitectureInspectionIntentV1): Promise<InspectResultV1>;
  /** P1-16: bounded work-context assembly. */
  assembleWorkContext(request: WorkContextRequestV1): Promise<WorkContextAssemblyResultV1>;
  /** P1-17: bounded completed-work selection for a related new task. */
  assembleCompletedWorkContext(request: CompletedWorkContextRequestV1): Promise<CompletedWorkContextResultV1>;
  /** P1-10: submit one durable control intent (desired state first). */
  submitControl(command: SubmitControlCommand): Promise<SubmitControlReceipt>;
  /** P1-10: record one safe-point acknowledgement. */
  recordSafePointAck(command: RecordSafePointAckCommand): Promise<RecordSafePointAckReceipt>;
  /** P1-10: control timeline view (read-only; readModel only). */
  controlTimelineView(query: ControlTimelineViewQuery): Promise<ControlTimelineViewResult>;
  /** P1-10: runtime lifecycle capabilities (honest declaration). */
  lifecycleCapabilities(request: { runRef: import("../contracts/dispatch.js").RunRef | null }): { safePointDelivery: boolean; pause: boolean; cancel: boolean; steer: boolean; maxSteerPayloadBytes: number };
  /** P1-09: submit/answer/close a QueryJob + its view. */
  submitQueryJob(command: SubmitQueryJobCommand): Promise<SubmitQueryJobReceipt>;
  recordQueryAnswer(command: RecordQueryAnswerCommand): Promise<RecordQueryAnswerReceipt>;
  closeQueryJob(command: CloseQueryJobCommand): Promise<CloseQueryJobReceipt>;
  queryJobView(query: QueryJobViewQuery): Promise<QueryJobViewResult>;
  /** P1-09: assemble the bounded query context (never a transcript). */
  assembleQueryContext(request: QueryContextRequestV1): Promise<QueryContextResultV1>;
  /** P1-09: read the runtime public snapshot (explicit unsupported/stale). */
  publicSnapshot(query: PublicSnapshotQueryV1): Promise<PublicSnapshotResultV1>;
  /** P1-11: record one immutable plan-change proposal (Planner proposes only). */
  recordPlanChangeProposal(command: import("../contracts/goal-change.js").RecordPlanChangeProposalCommand): Promise<import("../contracts/goal-change.js").RecordPlanChangeProposalReceipt>;
  /** P1-11: record one immutable user decision. */
  recordUserDecision(command: import("../contracts/goal-change.js").RecordUserDecisionCommand): Promise<import("../contracts/goal-change.js").RecordUserDecisionReceipt>;
  /** P1-11: apply an ACCEPTED decision (CAS new revision + goal). */
  applyPlanChange(command: import("../contracts/goal-change.js").ApplyPlanChangeCommand): Promise<import("../contracts/goal-change.js").ApplyPlanChangeReceipt>;
  /** P1-11: plan-change view (display only). */
  planChangeView(query: import("../contracts/goal-change.js").PlanChangeViewQuery): Promise<import("../contracts/goal-change.js").PlanChangeViewResult>;
  /** P1-11: bounded proposal request (compiler port). */
  planProposalRequest(request: import("../contracts/goal-change.js").AmendGoalRequestV1): Promise<{ status: "proposal"; proposal: import("../contracts/goal-change.js").PlanProposalV1 } | { status: "needs_material"; gaps: string[] } | { status: "rejected"; code: string; message: string }>;
  /** P1-11: bounded planning-context assembly. */
  assemblePlanningContext(request: { schemaVersion: 1; requestId: string; projectId: string; workspaceId: string; goalRef: import("../contracts/ledger.js").GoalRef; planRef: import("../contracts/plan.js").PlanRevisionRef | null; budget: { maxBundleBytes: number } }): Promise<{ status: "ready"; bundleRef: import("../contracts/artifact.js").ArtifactRef; manifest: { selectedSources: string[]; freshnessCursor: import("../contracts/command-event.js").CommitCursor | null; totalBytes: number } } | { status: "needs_material"; gaps: string[] } | { status: "rejected"; code: "invalid_request" | "forbidden_tool_or_scope" | "unavailable"; message: string }>;
  /** P1-11: HumanCollaboration goal-change face (amend compiles then records). */
  amend(request: import("../contracts/goal-change.js").AmendGoalRequestV1): Promise<{ status: "accepted"; proposalRef: import("../contracts/goal-change.js").PlanProposalSnapshot["ref"] } | { status: "needs_material"; gaps: string[] } | { status: "rejected"; code: string; message: string }>;
  /** P1-16: runtime continuation capabilities (honest declaration). */
  continuationCapabilities(request: { workContextRef: import("../contracts/context-continuity.js").WorkContextRef; runRef: import("../contracts/dispatch.js").RunRef | null }): Promise<import("../contracts/context-continuation-port.js").ContextContinuationCapabilityResult>;
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
  const planProposal: PlanProposalPort = options.planProposal ?? new PlanCompilerImpl();
  const planningContext: PlanningContextPort = options.planningContext ?? new PlanningContextCompilerImpl();
  const collaboration = new HumanCollaborationImpl({
    control,
    readModel,
    planProposal,
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
  const workContext: WorkContextPort =
    options.workContext ?? new WorkContextCompilerImpl({ ledger, vault, now: d.clock, readModel });
  const contextContinuation: ContextContinuationPort =
    options.contextContinuation ?? new FakeContextContinuationRuntimeAdapter(runtime);
  const completedWork: CompletedWorkContextPort =
    options.completedWork ?? new CompletedWorkContextCompilerImpl({ ledger, vault, readModel, now: d.clock });
  const lifecycleControl: LifecycleControlPort =
    options.lifecycleControl ?? new FakeLifecycleControlAdapter();
  const readOnlyQuery: ReadOnlyQueryPort =
    options.readOnlyQuery ?? new FakeReadOnlyQueryAdapter();
  const queryContext: QueryContextPort =
    options.queryContext ?? new QueryJobContextStub();
  const snapshot: SnapshotPort = {
    snapshot: (q) => Promise.resolve({ status: "unsupported", message: "P1-09 lane: public snapshot not wired yet" }),
  };
  const workspaceReader: WorkspaceReadPort =
    options.workspaceReader ?? new FakeWorkspaceReaderAdapter({ now: d.clock });
  const codeGraph: CodeGraphPort = options.codeGraph ?? new CodeGraphPortImpl();
  const inspection: InspectionPort =
    options.inspection ?? new ArchitectureReconcilerImpl({ ledger, vault, control, workspaceReader, codeGraph, now: d.clock, eventId: d.eventId });
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
    workContext,
    contextContinuation,
    completedWork,
    lifecycleControl,
    readOnlyQuery,
    queryContext,
    snapshot,
    workspaceReader,
    codeGraph,
    inspection,
    planProposal,
    planningContext,
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
    workContextView: (query) => readModel.workContext(query),
    architectureInspectionView: (query) => readModel.architectureInspectionView(query),
    completedWorkView: (query) => readModel.completedWorkView(query),
    recordArchitectureInspection: (command) => control.recordArchitectureInspection(command),
    recordArchitectureFinding: (command) => control.recordArchitectureFinding(command),
    recordArchitectureDecisionBrief: (command) => control.recordArchitectureDecisionBrief(command),
    recordCandidateBaselineProposal: (command) => control.recordCandidateBaselineProposal(command),
    workspaceRead: (query) => workspaceReader.read(query),
    codeGraphQuery: (query) => codeGraph.codeGraph(query),
    inspect: (intent) => inspection.inspect(intent),
    bindWorkContext: (command) => control.bindWorkContext(command),
    linkWorkRun: (command) => control.linkWorkRun(command),
    recordExecutionNote: (command) => control.recordExecutionNote(command),
    recordContinuation: (command) => control.recordContinuation(command),
    assembleWorkContext: (request) => workContext.assembleWorkContext(request),
    assembleCompletedWorkContext: (request) => completedWork.assembleCompletedWorkContext(request),
    submitControl: (command) => control.submitControl(command),
    recordSafePointAck: (command) => control.recordSafePointAck(command),
    controlTimelineView: (query) => readModel.controlTimelineView(query),
    lifecycleCapabilities: (request) => lifecycleControl.capabilities(request),
    submitQueryJob: (command) => control.submitQueryJob(command),
    recordQueryAnswer: (command) => control.recordQueryAnswer(command),
    closeQueryJob: (command) => control.closeQueryJob(command),
    queryJobView: (query) => readModel.queryJobView(query),
    assembleQueryContext: (request) => queryContext.assembleQueryContext(request),
    publicSnapshot: (query) => snapshot.snapshot(query),
    recordPlanChangeProposal: (command) => control.recordPlanChangeProposal(command),
    recordUserDecision: (command) => control.recordUserDecision(command),
    applyPlanChange: (command) => control.applyPlanChange(command),
    planChangeView: (query) => readModel.planChangeView(query),
    planProposalRequest: (request) => planProposal.request(request),
    assemblePlanningContext: (request) => planningContext.assemblePlanningContext(request),
    amend: (request) => collaboration.amend(request),
    continuationCapabilities: (request) => contextContinuation.capabilities(request),
    assembleHandoff: (request) => handoffContext.assemble(request),
    assembleReview: (request) => reviewContext.assemble(request),
    drive: (trigger) => dispatchEngine.drive(trigger),
    advanceProjection,
    observedCursor: () => lastCursor,
  };
}