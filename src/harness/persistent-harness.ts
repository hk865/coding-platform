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
import { WorkContextCompilerImpl } from "../context/work-context-compiler.js";
import { CompletedWorkContextCompilerImpl } from "../context/completed-work-context-compiler.js";
import { FakeLifecycleControlAdapter } from "../runtime/lifecycle-control-adapter.js";
import { FakeReadOnlyQueryAdapter } from "../runtime/read-only-query-adapter.js";
import { QueryJobContextStub } from "../contracts/testing/query-context.stub.js";
import type { ReadOnlyQueryPort, QueryJobViewQuery, QueryJobViewResult, SubmitQueryJobCommand, SubmitQueryJobReceipt, RecordQueryAnswerCommand, RecordQueryAnswerReceipt, CloseQueryJobCommand, CloseQueryJobReceipt, QueryContextPort, QueryContextRequestV1, QueryContextResultV1, SnapshotPort, PublicSnapshotQueryV1, PublicSnapshotResultV1 } from "../contracts/query-job.js";
import type { LifecycleControlPort, ControlTimelineViewQuery, ControlTimelineViewResult, SubmitControlCommand, SubmitControlReceipt, RecordSafePointAckCommand, RecordSafePointAckReceipt } from "../contracts/control-intent.js";
import type { CompletedWorkContextPort, CompletedWorkContextRequestV1, CompletedWorkContextResultV1 } from "../contracts/completed-work-context.js";
import { FakeContextContinuationRuntimeAdapter } from "../runtime/context-continuation-adapter.js";
import { ArchitectureReconcilerImpl } from "../control/architecture-reconciler.js";
import { PlanCompilerImpl } from "../control/plan-compiler.js";
import { PlanningContextCompilerImpl } from "../context/planning-context-compiler.js";
import type { PlanProposalPort, PlanningContextPort } from "../contracts/goal-change.js";
import { FakeWorkspaceReaderAdapter } from "../data/workspace-reader-adapter.js";
import { CodeGraphPortImpl } from "../verification/code-graph-port.js";
import type { InspectionPort, InspectResultV1, CodeGraphPort } from "../contracts/architecture-reconciler.js";
import type { WorkspaceReadPort, CodeGraphReadQueryV1, CodeGraphReadResultV1 } from "../contracts/workspace-read.js";
import type { ArchitectureInspectionViewQuery, ArchitectureInspectionViewResult, RecordArchitectureInspectionCommand, RecordArchitectureInspectionReceipt, RecordArchitectureFindingCommand, RecordArchitectureFindingReceipt, RecordArchitectureDecisionBriefCommand, RecordArchitectureDecisionBriefReceipt, RecordCandidateBaselineProposalCommand, RecordCandidateBaselineProposalReceipt, ArchitectureInspectionIntentV1 } from "../contracts/architecture-inspection.js";
import type { WorkContextPort, WorkContextRequestV1, WorkContextAssemblyResultV1 } from "../contracts/work-context-port.js";
import type { ContextContinuationPort } from "../contracts/context-continuation-port.js";
import type { WorkContextViewQuery, WorkContextViewResult, BindWorkContextCommand, BindWorkContextReceipt, LinkWorkRunCommand, LinkWorkRunReceipt, RecordExecutionNoteCommand, RecordExecutionNoteReceipt, RecordContinuationCommand, RecordContinuationReceipt } from "../contracts/context-continuity.js";
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
  /** P1-09: explicit QueryContextPort (default stub). */
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
  workContext: WorkContextPort;
  contextContinuation: ContextContinuationPort;
  completedWork: CompletedWorkContextPort;
  lifecycleControl: LifecycleControlPort;
  workspaceReader: WorkspaceReadPort;
  codeGraph: CodeGraphPort;
  inspection: InspectionPort;
  planProposal: PlanProposalPort;
  planningContext: PlanningContextPort;
  readOnlyQuery: ReadOnlyQueryPort;
  queryContext: QueryContextPort;
  snapshot: SnapshotPort;
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
  workContextOverride: WorkContextPort | undefined,
  contextContinuationOverride: ContextContinuationPort | undefined,
  completedWorkOverride: CompletedWorkContextPort | undefined,
  lifecycleControlOverride: LifecycleControlPort | undefined,
  readOnlyQueryOverride: ReadOnlyQueryPort | undefined,
  queryContextOverride: QueryContextPort | undefined,
  snapshotOverride: SnapshotPort | undefined,
  workspaceReaderOverride: WorkspaceReadPort | undefined,
  codeGraphOverride: CodeGraphPort | undefined,
  inspectionOverride: InspectionPort | undefined,
  planProposalOverride: PlanProposalPort | undefined,
  planningContextOverride: PlanningContextPort | undefined,
): BuiltHarness {
  const d: InjectableDeps = { ...createDeterministicDeps(), ...deps };
  const ledger = createSqliteStateLedger({ path: join(dir, ledgerFile) });
  const readModel = createSqliteReadModelIndex({ path: join(dir, readModelFile) });
  const workspaceCapability: WorkspaceCapabilityPort =
    workspaceCapabilityOverride ?? new FakeWorkspaceCapabilityAdapter();
  const control = new ControlEngineImpl({ ledger, now: d.clock, eventId: d.eventId, workspaceCapability });
  const planProposal: PlanProposalPort = planProposalOverride ?? new PlanCompilerImpl();
  const planningContext: PlanningContextPort = planningContextOverride ?? new PlanningContextCompilerImpl();
  const collaboration = new HumanCollaborationImpl({
    control,
    readModel,
    planProposal,
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
  const workContext: WorkContextPort =
    workContextOverride ?? new WorkContextCompilerImpl({ ledger, vault, now: d.clock, readModel });
  const contextContinuation: ContextContinuationPort =
    contextContinuationOverride ?? new FakeContextContinuationRuntimeAdapter(runtime);
  const completedWork: CompletedWorkContextPort =
    completedWorkOverride ?? new CompletedWorkContextCompilerImpl({ ledger, vault, readModel, now: d.clock });
  const lifecycleControl: LifecycleControlPort =
    lifecycleControlOverride ?? new FakeLifecycleControlAdapter();
  const readOnlyQuery: ReadOnlyQueryPort =
    readOnlyQueryOverride ?? new FakeReadOnlyQueryAdapter();
  const queryContext: QueryContextPort =
    queryContextOverride ?? new QueryJobContextStub();
  const snapshot: SnapshotPort = snapshotOverride ?? { snapshot: (q) => Promise.resolve({ status: "unsupported", message: "P1-09 lane: public snapshot not wired yet" }) };
  const workspaceReader: WorkspaceReadPort =
    workspaceReaderOverride ?? new FakeWorkspaceReaderAdapter({ now: d.clock });
  const codeGraph: CodeGraphPort = codeGraphOverride ?? new CodeGraphPortImpl();
  const inspection: InspectionPort =
    inspectionOverride ?? new ArchitectureReconcilerImpl({ ledger, vault, control, workspaceReader, codeGraph, now: d.clock, eventId: d.eventId });
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
    const built = buildHarness(dir, ledgerFilename, readModelFilename, deps, runtimeScript, checkPorts, reviewer, verificationOverride, reviewContextOverride, options.handoffContext, options.handoffControl, options.workspaceCapability, options.workspaceDrive, options.runtime, options.workContext, options.contextContinuation, options.completedWork, options.lifecycleControl, options.readOnlyQuery, options.queryContext, options.snapshot, options.workspaceReader, options.codeGraph, options.inspection, options.planProposal, options.planningContext);
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
      workContext: built.workContext,
      contextContinuation: built.contextContinuation,
      completedWork: built.completedWork,
      lifecycleControl: built.lifecycleControl,
      readOnlyQuery: built.readOnlyQuery,
      queryContext: built.queryContext,
      snapshot: built.snapshot,
      workspaceReader: built.workspaceReader,
      codeGraph: built.codeGraph,
      inspection: built.inspection,
      planProposal: built.planProposal,
      planningContext: built.planningContext,
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
      consolePortfolio: (query) => built.collaboration.consolePortfolio(query),
      consoleSummary: (query) => built.collaboration.consoleSummary(query),
      consolePlanMatrix: (query) => built.collaboration.consolePlanMatrix(query),
      consoleActiveAgents: (query) => built.collaboration.consoleActiveAgents(query),
      consoleTaskEvidence: (query) => built.collaboration.consoleTaskEvidence(query),
      consoleTimeline: (query) => built.collaboration.consoleTimeline(query),
      workContextView: (query) => built.readModel.workContext(query),
      architectureInspectionView: (query) => built.readModel.architectureInspectionView(query),
      completedWorkView: (query) => built.readModel.completedWorkView(query),
      recordArchitectureInspection: (command) => built.control.recordArchitectureInspection(command),
      recordArchitectureFinding: (command) => built.control.recordArchitectureFinding(command),
      recordArchitectureDecisionBrief: (command) => built.control.recordArchitectureDecisionBrief(command),
      recordCandidateBaselineProposal: (command) => built.control.recordCandidateBaselineProposal(command),
      workspaceRead: (query) => built.workspaceReader.read(query),
      codeGraphQuery: (query) => built.codeGraph.codeGraph(query),
      inspect: (intent) => built.inspection.inspect(intent),
      bindWorkContext: (command) => built.control.bindWorkContext(command),
      linkWorkRun: (command) => built.control.linkWorkRun(command),
      recordExecutionNote: (command) => built.control.recordExecutionNote(command),
      recordContinuation: (command) => built.control.recordContinuation(command),
      assembleWorkContext: (request) => built.workContext.assembleWorkContext(request),
      assembleCompletedWorkContext: (request) => built.completedWork.assembleCompletedWorkContext(request),
      submitControl: (command) => built.control.submitControl(command),
      recordSafePointAck: (command) => built.control.recordSafePointAck(command),
      controlTimelineView: (query) => built.readModel.controlTimelineView(query),
      lifecycleCapabilities: (request) => built.lifecycleControl.capabilities(request),
      submitQueryJob: (command) => built.control.submitQueryJob(command),
      recordQueryAnswer: (command) => built.control.recordQueryAnswer(command),
      closeQueryJob: (command) => built.control.closeQueryJob(command),
      queryJobView: (query) => built.readModel.queryJobView(query),
    recordPlanChangeProposal: (command) => built.control.recordPlanChangeProposal(command),
    recordUserDecision: (command) => built.control.recordUserDecision(command),
    applyPlanChange: (command) => built.control.applyPlanChange(command),
    planChangeView: (query) => built.readModel.planChangeView(query),
    planProposalRequest: (request) => built.planProposal.request(request),
    assemblePlanningContext: (request) => built.planningContext.assemblePlanningContext(request),
    amend: (request) => built.collaboration.amend(request),
      assembleQueryContext: (request) => built.queryContext.assembleQueryContext(request),
      publicSnapshot: (query) => built.snapshot.snapshot(query),
      continuationCapabilities: (request) => built.contextContinuation.capabilities(request),
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