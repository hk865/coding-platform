import type { RunControlPort } from '../core/work-graph/tasks/control-contracts.js';
import type { TaskClaimPort } from '../core/work-graph/model/claim-contracts.js';
/**
 * R6.1a per-route parsing and explicit dispatch.
 *
 * The route table, the exact request parsing and the per-suffix dispatch are the
 * contract. `createPlatformCoreRouteBindings` binds each route name to the one
 * public port method the design assigns it, all sharing the single
 * `createTargetPlatform` instance assembled by `host.ts`. There is NO
 * `platform[group][method]` access and no generic method-name execution: each
 * suffix is one explicit `switch` arm calling one named public port method, and
 * the bindings carry no business logic of their own.
 */
import type { CoreCallContext } from '../contracts/core/call-context.js';
import type { CoreRejection, ReadResult, WriteResult } from '../contracts/core/results.js';
import type { SessionRef } from '../contracts/core/identity.js';
import type { RunRef, RunSnapshot, TaskTriple } from '../contracts/dispatch.js';
import type { ControlIntentSnapshotV1 } from '../contracts/control-intent.js';
import { canonicalJson, sha256Hex } from '../contracts/fingerprint.js';
import type { UnknownCallReviewV1 } from '../contracts/unknown-call-review.js';
import { reworkFenceOf } from '../core/work-graph/state/task-failure.js';
import type { QueryRunRef } from '../contracts/query-job.js';
import type { CommitCursor } from '../contracts/command-event.js';
import { seqOfCommitCursor } from '../contracts/ledger.js';
import type { RuntimeExecutionPort } from '../core/agent-runtime/ports.js';
import type { ArchitectureCatalogPort } from '../core/work-graph/architecture/catalog-contracts.js';
import type { ObservedArchitecturePort } from '../core/work-graph/architecture/contracts.js';
import type {
  SessionMailboxPort, SessionMessageCommandPort,
} from '../core/work-graph/model/communication-contracts.js';
import type {
  CompletionPolicyConfigurationPort,
  ProjectRegistrationPort,
} from '../core/work-graph/configuration/project-bootstrap-contracts.js';
import type { SessionDirectoryPort } from '../core/work-graph/model/session-contracts.js';
import type { SessionLifecyclePort } from '../core/work-graph/sessions/lifecycle-contracts.js';
// The two secretary lifecycle commands' accept owners; the body and progress types are the DTOs derived from them.
import type { SessionHandoffPort, SessionSecretaryArchivePort } from '../core/work-graph/sessions/session-handoff-service.js';
// Slice 1 (spec §4.4): the owner ports of the eleven new suffixes.
import type { SessionFactsPort } from '../core/work-graph/model/session-facts-contracts.js';
import type { SessionResponsibilityPort } from '../core/work-graph/sessions/session-responsibility-service.js';
import type { SessionAnomalyPort } from '../core/work-graph/tasks/session-anomaly-service.js';
// K3 (§2 L7): the read-only UnknownCallReview owner of `unknown-call-reviews/read`.
import type { UnknownCallReviewReadPort, UnknownCallReviewPort } from '../core/work-graph/model/unknown-call-review-contracts.js';
import type { ExecutionReadPort } from '../core/work-graph/model/execution-read-contracts.js';
import type { GraphContextReadPort } from '../core/work-graph/model/graph-context-contracts.js';
import type { GoalTaskPort } from '../core/work-graph/model/task-contracts.js';
import type { DispatchBasisReadPort } from '../core/work-graph/model/dispatch-basis-contracts.js';
// The Goal draft confirmation, the Goal copy and the Host's initialization adoption owner.
import type {
  GoalConfirmPort, GoalCopyPort,
} from '../core/work-graph/model/goal-card-contracts.js';
import type { InitializationAdoptionHostPort } from './initialization-adoption.js';
import type { PlanTaskPort } from '../core/work-graph/model/plan-contracts.js';
import type { WorkspaceCapturePort, WorkspaceToolsPort } from '../core/workspace/ports.js';
import type { MaterialPort } from '../core/work-graph/model/material-contracts.js';
import type { EvidencePort } from '../core/work-graph/model/evidence-contracts.js';
import type { QueryExecutionRecord, QueryJobPort } from '../core/work-graph/queries/contracts.js';
import type { GraphWrite } from '../core/work-graph/model/task-contracts.js';
import type {
  DecisionMessagePort,
  DecisionReadPort,
  GoalSettingsPort,
  RequestCandidatePort,
  WorkspaceDecisionSettingsPort,
} from '../core/work-graph/model/decision-contracts.js';
import type { StartupReconcileReportV1 } from './startup-reconcile.js';
import type { WorkflowPort } from '../business/workflow/ports.js';
import type {
  RequestAskResultV1, RequestIntakePort, RequestRouteResultV1, RequestSelectIdeaResultV1, RequestSubmitResultV1,
} from '../business/workflow/request-intake.js';
import type { MainSurfaceReadPort } from '../core/work-graph/views/main-surface-read-model.js';
import type { CollaborationDriverPort } from './collaboration-driver.js';
import type { GoalControlPort } from './goal-fan-out-driver.js';
import type { WorkbenchToolsPort } from './workbench-tools.js';
import type { ActivityReadPort } from '../core/work-graph/views/activity-read-model.js';
import type { TrackReadPort } from '../core/work-graph/views/track-read-model.js';
import type { TaskTimelineReadPort } from '../core/work-graph/views/task-state-timeline.js';
// Slice 2C (spec §2, L13): the line/node-detail owner ports and the Host
// conversation composition the seven new routes bind.
import type {
  NodeDetailReadPort, WorkLineReadPort, WorkLineSettingsPort,
} from '../core/work-graph/model/work-line-contracts.js';
import type { WorkLineConversationPort } from '../composition/work-line-conversation.js';
// Slice 4C C1.4 (spec §2/L15/L19): the notes owner port and its wire shapes.
import type {
  NoteCheckPort, NoteCheckV1, NoteDispositionResult, NoteListRequestV1, NoteListResultV1, NoteMemoryReadResult,
  WriteNoteEnvelopeV1, NoteWritePort, VersionListPageV1,
} from '../core/work-graph/model/note-contracts.js';
import {
  type CoreRouteKind,
  type CoreRouteSuffix,
  type CoreScope,
  type K3CoreRouteDto,
  type MessagesCoreRouteDto,
  type RequestCommandCoreRouteDto,
  type SecretariesArchiveBody,
  type SecretariesArchiveResponse,
  type SecretariesHandoffBody,
  type SecretariesHandoffResponse,
  type SecretaryLifecycleCoreRouteDto,
  type Slice1CoreRouteDto,
  type Slice2CCoreRouteDto,
  type UnknownCallReviewReleaseHoldValue,
} from './core-http-types.js';

/** One named binding per route. The types are the exact public port methods;
 * the names disambiguate the two `captureSourceChanges` owners. */
export type CoreRouteBindings = {
  submitControl: RunControlPort['submitControl'];
  readControl: RunControlPort['readControl'];
  deliverControl: NonNullable<RuntimeExecutionPort['deliverControl']>;
  startRun: RuntimeExecutionPort['startRun'];
  createProject: ProjectRegistrationPort['createProject'];
  registerWorkspace: ProjectRegistrationPort['registerWorkspace'];
  installCompletionPolicy: CompletionPolicyConfigurationPort['installCompletionPolicy'];
  activateCompletionPolicy: CompletionPolicyConfigurationPort['activateCompletionPolicy'];
  readCurrentCompletionPolicy: NonNullable<CompletionPolicyConfigurationPort['readCurrentCompletionPolicy']>;
  createGoal: GoalTaskPort['createGoal'];
  queryGoal: PlanTaskPort['queryGoal'];
  adoptInitialArchitecture: ArchitectureCatalogPort['adoptInitialArchitecture'];
  readArchitectureRevision: ArchitectureCatalogPort['readArchitectureRevision'];
  captureArchitectureSource: ObservedArchitecturePort['captureSourceChanges'];
  queryArchitecture: ObservedArchitecturePort['queryArchitecture'];
  // Slice 8A §2: the two observed-domain comparisons and the impact read.
  compareArchitecture: ObservedArchitecturePort['compareArchitecture'];
  compareFormalObserved: ObservedArchitecturePort['compareFormalObserved'];
  queryImpact: ObservedArchitecturePort['queryImpact'];
  // L8 (book ruling 8): the one public observation state with computed pending.
  observationState: ObservedArchitecturePort['observationState'];
  proposePlan: PlanTaskPort['proposePlan'];
  applyPlanChange: PlanTaskPort['applyPlanChange'];
  readPlanProposal: PlanTaskPort['readPlanProposal'];
  queryTaskGraph: PlanTaskPort['queryTaskGraph'];
  readWorkspace: WorkspaceToolsPort['readWorkspace'];
  captureWorkspaceSource: WorkspaceCapturePort['captureSourceChanges'];
  querySource: WorkspaceCapturePort['querySource'];
  findSessions: SessionDirectoryPort['findSessions'];
  readSession: SessionDirectoryPort['readSession'];
  getSessionOperation: SessionDirectoryPort['getSessionOperation'];
  runtimeCapabilities: RuntimeExecutionPort['capabilities'];
  createSession: RuntimeExecutionPort['createSession'];
  readSessionHistory: RuntimeExecutionPort['readSessionHistory'];
  // A1 session lifecycle: the real public archive/reactivate/link writers.
  archiveSession: SessionLifecyclePort['archiveSession'];
  reactivateSession: SessionLifecyclePort['reactivateSession'];
  linkSessionWork: SessionLifecyclePort['linkSessionWork'];
  sendMessage: SessionMailboxPort['sendMessage'];
  readInbox: SessionMailboxPort['readInbox'];
  readMessage: SessionMailboxPort['readMessage'];
  readMessageBody: SessionMailboxPort['readMessageBody'];
  readOutbox: NonNullable<SessionMailboxPort['readOutbox']>;
  // The message commands and the two derived view reads: each binding is the command port's exact method.
  releaseMessage: SessionMessageCommandPort['releaseMessage'];
  withdrawMessage: SessionMessageCommandPort['withdrawMessage'];
  readMessageView: SessionMessageCommandPort['readMessageView'];
  readInboxView: SessionMessageCommandPort['readInboxView'];
  // R6 execution-entry routes: one named binding per new suffix.
  readWorkspaceRegistration: ProjectRegistrationPort['readWorkspaceRegistration'];
  submitQueryJob: QueryJobPort['submitQueryJob'];
  readQueryJob: QueryJobPort['readQueryJob'];
  claimQuery: QueryJobPort['claimQuery'];
  prepareQuery: NonNullable<RuntimeExecutionPort['prepareQuery']>;
  startQuery: NonNullable<RuntimeExecutionPort['startQuery']>;
  observeQuery: NonNullable<RuntimeExecutionPort['observeQuery']>;
  readQueryAnswer: QueryJobPort['readQueryAnswer'];
  openArtifact: MaterialPort['openArtifact'];
  handleGoalInput: WorkflowPort['handleGoalInput'];
  advanceWork: WorkflowPort['advanceWork'];
  consumeConsultation: NonNullable<WorkflowPort['consumeConsultation']>;
  // AG2b collaboration driver: the Host-layer handle lifetime, one binding per
  // exact driver method. A Host without a driver keeps the routes published but
  // explicitly unsupported.
  driverStart: CollaborationDriverPort['start'];
  driverRead: CollaborationDriverPort['read'];
  driverStop: CollaborationDriverPort['stop'];
  // R6 Task-execution -> original Session/history reads: one binding per owner.
  readExecution: ExecutionReadPort['readExecution'];
  readTaskExecutionHistory: RuntimeExecutionPort['readTaskExecutionHistory'];
  // MVP UI connection: one explicit binding per new suffix. `readProject` and
  // `listExecutions` are the optional owner methods; the three command bindings
  // and `saveWorkspaceFile` come from the Host workbench-tools adapter, and
  // `compareWorkspaceFiles` forwards the EXISTING WorkspaceToolsPort method.
  readProject: NonNullable<ProjectRegistrationPort['readProject']>;
  listExecutions: NonNullable<ExecutionReadPort['listExecutions']>;
  saveWorkspaceFile: WorkbenchToolsPort['saveFile'];
  listWorkspaceFiles: WorkbenchToolsPort['listFiles'];
  compareWorkspaceFiles: WorkspaceToolsPort['compareWorkspace'];
  startCommand: WorkbenchToolsPort['startCommand'];
  readCommand: WorkbenchToolsPort['readCommand'];
  stopCommand: WorkbenchToolsPort['stopCommand'];
  // A.2 step 5.4: the requeue owner (TD-6) and the continuation brief read (C3).
  requeueTask: NonNullable<TaskClaimPort['requeueTask']>;
  /** K3 L21 (UCR-15): the human direct "I'll handle it" (UCR-15). */
  holdUnknownCallReview: UnknownCallReviewPort['holdReview'];
  /** K3 L21 ruling 4: releaseHold, then the human requeue when the original Run's fence is human. */
  releaseUnknownCallReviewHold: (
    ctx: CoreCallContext, request: Parameters<UnknownCallReviewPort['releaseHold']>[1],
  ) => Promise<WriteResult<UnknownCallReviewReleaseHoldValue>>;
  readContinuationBrief: NonNullable<RuntimeExecutionPort['readContinuationBrief']>;
  // A.2 step 5.5 (G7): the Goal control with its fan-out, and the Goal display, through the Host driver.
  setGoalControl: GoalControlPort['setGoalControl'];
  readGoalDisplay: GoalControlPort['readGoalDisplay'];
  // A.2 step 5.6 (RUN-22, QRR-06): the attestations, and the Host instance/reconcile report.
  resolveUnknownRun: NonNullable<CoreRoutePlatform['resolveUnknownRun']>;
  resolveUnknownQueryRun: NonNullable<CoreRoutePlatform['resolveUnknownQueryRun']>;
  readReconcileReport: HostReconcileReportPort['readReconcileReport'];
  // A.2 step 5.9 (VR-14): the successor round owner.
  reverifyRound: NonNullable<EvidencePort['reverifyRound']>;
  // Slice 1 (spec §4.4): the Session facts, corrections and archive entries.
  // `archiveLine`/`continueArchiveLine` stay optional on `WorkflowPort` for the
  // old narrow doubles; the real composition always publishes them.
  archiveLine: NonNullable<WorkflowPort['archiveLine']>;
  continueArchiveLine: NonNullable<WorkflowPort['continueArchiveLine']>;
  releaseSessionArchiveRequest: SessionLifecyclePort['releaseSessionArchiveRequest'];
  readSessionFacts: SessionFactsPort['readSessionFacts'];
  findSessionSuccessors: SessionFactsPort['findSessionSuccessors'];
  listSessionExecutions: SessionFactsPort['listSessionExecutions'];
  listSessionQueries: SessionFactsPort['listSessionQueries'];
  transferSessionResponsibility: SessionResponsibilityPort['transferSessionResponsibility'];
  readTaskArchiveState: SessionAnomalyPort['readTaskArchiveState'];
  listSessionAnomalies: SessionAnomalyPort['listSessionAnomalies'];
  /** K3 (§2 L7): the read-only review lookup, by record ref or original Run. */
  readUnknownCallReview: UnknownCallReviewReadPort['readReview'];
  /** K3 (§2 L7): the review list by Goal+status or workspace+open. */
  listUnknownCallReviews: UnknownCallReviewReadPort['listReviews'];
  readUndeliveredReplies: NonNullable<SessionMailboxPort['readUndeliveredReplies']>;
  // Slice 3: the two read-only graph routes, forwarded verbatim.
  lookGraph: GraphContextReadPort['lookGraph'];
  findGraph: GraphContextReadPort['findGraph'];
  // Slice 5 §4.5 decision routes: one named binding per exact owner method. The
  // binding names are the frozen names from the route table; no dynamic access.
  readGoalSettings: GoalSettingsPort['readGoalSettings'];
  setGoalSettings: GoalSettingsPort['setGoalSettings'];
  reorderGoals: GoalSettingsPort['reorderGoals'];
  queryGoalConflicts: DecisionReadPort['queryGoalConflicts'];
  /** §3.6 item 5: the Goal card's three-version read, published on the Goal service. */
  readDispatchBasis: DispatchBasisReadPort['readDispatchBasis'];
  readRequestCandidate: RequestCandidatePort['readRequestCandidate'];
  abandonPlanProposal: RequestCandidatePort['abandonPlanProposal'];
  queryDecisionQueue: DecisionReadPort['queryDecisionQueue'];
  readDecisionCard: DecisionReadPort['readDecisionCard'];
  resolveDecision: NonNullable<WorkflowPort['resolveDecision']>;
  recordDecisionApplication: DecisionMessagePort['recordDecisionApplication'];
  markNoticesSeen: WorkspaceDecisionSettingsPort['markNoticesSeen'];
  sendUserMessage: DecisionMessagePort['sendUserMessage'];
  // Slice 2B L9–L12/L15: the ONE activity owner (calendar + per-Run and
  // per-Query views + track bars) and the task-state timeline owner, plus the
  // human range backfill.
  readActivityCalendar: ActivityReadPort['readActivityCalendar'];
  readRunActivities: ActivityReadPort['readRunActivities'];
  readQueryActivities: ActivityReadPort['readQueryActivities'];
  readTrackBars: TrackReadPort['readTrackBars'];
  readTaskStateTimeline: TaskTimelineReadPort['readTaskStateTimeline'];
  backfillActivityRange: NonNullable<WorkflowPort['backfillActivityRange']>;
  // Slice 2C (spec §2): the line reads, the Host conversation page, the pin
  // write and the two node-detail reads. `readWorkLinePage` is the Host port
  // because the `conversation` section is assembled outside WorkGraph.
  listWorkLines: WorkLineReadPort['listWorkLines'];
  listArchivedLines: WorkLineReadPort['listArchivedLines'];
  readWorkLine: WorkLineReadPort['readWorkLine'];
  readWorkLinePage: WorkLineConversationPort['readWorkLinePage'];
  readGraphHover: NodeDetailReadPort['readGraphHover'];
  readNodeDetail: NodeDetailReadPort['readNodeDetail'];
  setLinePins: WorkLineSettingsPort['setLinePins'];
  // Slice 4C C1.4 (spec §2): the six notes/version-list routes. `notes/write`
  // returns the write envelope (write + the after-write check); the three writes
  // are person-only, so their binding can answer a `forbidden` rejection.
  listNotes: (ctx: CoreCallContext, request: NoteListRequestV1) => Promise<NoteMemoryReadResult<NoteListResultV1>>;
  writeNote: (ctx: CoreCallContext, request: Parameters<NoteWritePort['writeNote']>[1]) =>
    Promise<WriteNoteEnvelopeV1 | CoreRejection>;
  withdrawNote: (ctx: CoreCallContext, request: Parameters<NoteWritePort['withdrawNote']>[1]) =>
    Promise<NoteDispositionResult | CoreRejection>;
  reviewNote: (ctx: CoreCallContext, request: Parameters<NoteWritePort['reviewNote']>[1]) =>
    Promise<NoteDispositionResult | CoreRejection>;
  listPlanVersions: (ctx: CoreCallContext, input: { goalId: string; limit: number; cursor: string | null }) =>
    Promise<ReadResult<VersionListPageV1>>;
  listCatalogVersions: (ctx: CoreCallContext, input: { limit: number; cursor: string | null }) =>
    Promise<ReadResult<VersionListPageV1>>;
  // The four person-only request commands. The Host layer
  // owns the public-surface checks (person, `manual`/`dropped`) and returns the
  // port's receipt/rejection body unchanged.
  submitRequest: (ctx: CoreCallContext, input: Parameters<RequestIntakePort['submitRequest']>[1]) =>
    Promise<RequestSubmitResultV1 | CoreRejection>;
  routeRequest: (ctx: CoreCallContext, input: Parameters<RequestIntakePort['route']>[1]) =>
    Promise<RequestRouteResultV1 | CoreRejection>;
  selectRequestIdea: (ctx: CoreCallContext, input: Parameters<RequestIntakePort['selectIdea']>[1]) =>
    Promise<RequestSelectIdeaResultV1 | CoreRejection>;
  askRequest: (ctx: CoreCallContext, input: Parameters<RequestIntakePort['ask']>[1]) =>
    Promise<RequestAskResultV1 | CoreRejection>;
  // The main conversation's read and one request's read with its cards: reads,
  // open to any trusted caller of the workspace like the other reads.
  readMainPage: MainSurfaceReadPort['readMainPage'];
  readRequestView: MainSurfaceReadPort['readRequestView'];
  // The two secretary lifecycle commands. Each binding validates the person, accepts through the owner and then
  // drives the Workflow's advance over the operation it just accepted; the progress it answers with is the
  // Workflow's own read of that operation.
  acceptHandoff: (ctx: CoreCallContext, input: SecretariesHandoffBody['input']) => Promise<SecretariesHandoffResponse>;
  acceptArchive: (ctx: CoreCallContext, input: SecretariesArchiveBody['input']) => Promise<SecretariesArchiveResponse>;
  // The two Goal-card commands and the initialization adoption are person-only, so their binding can answer a
  // `forbidden` rejection; the copy preview is a read like the other reads.
  confirmGoalDraft: GoalConfirmPort['confirmDraft'];
  readGoalCopyDraft: GoalCopyPort['readDraft'];
  confirmGoalCopy: GoalCopyPort['confirm'];
  adoptInitialization: InitializationAdoptionHostPort['adopt'];
};

/** A.2 step 5.6 (§12.1 step 7, §12.8): this Host's instance lease and its start-up reconcile report. */
export interface HostReconcileReportPort {
  readReconcileReport(ctx: CoreCallContext, input: unknown): Promise<ReadResult<HostReconcileReportV1>>;
}

/**
 * The exact platform seams the R6.1a route table consumes. It is the real
 * `createTargetPlatform` return value narrowed to the five published groups, so
 * `host.ts` can bind the ONE platform instance without either side importing a
 * service implementation or taking a dynamic method name.
 */
export type CoreRoutePlatform = {
  controls: RunControlPort;
  projects: ProjectRegistrationPort;
  completionPolicies: CompletionPolicyConfigurationPort;
  /** The Goal service also publishes the draft confirmation `confirmDraft` and the copy under the names
   *  `readGoalCopyDraft`/`confirmGoalCopy` (`GoalCopyPort`'s `readDraft`/`confirm`). */
  goals: GoalTaskPort & DispatchBasisReadPort & GoalConfirmPort
    & { readGoalCopyDraft: GoalCopyPort['readDraft']; confirmGoalCopy: GoalCopyPort['confirm'] };
  plans: PlanTaskPort;
  architecture: ArchitectureCatalogPort & ObservedArchitecturePort;
  workspace: WorkspaceToolsPort;
  sessions: Pick<SessionDirectoryPort, 'findSessions' | 'readSession' | 'getSessionOperation'>
    & Pick<SessionLifecyclePort, 'archiveSession' | 'reactivateSession' | 'linkSessionWork' | 'releaseSessionArchiveRequest'>;
  executions: Pick<ExecutionReadPort, 'readExecution'> & Required<Pick<ExecutionReadPort, 'listExecutions'>>;
  runtime: Pick<RuntimeExecutionPort,
    'capabilities' | 'createSession' | 'readSessionHistory' | 'readTaskExecutionHistory' | 'startRun' | 'deliverControl'>
    & Required<Pick<RuntimeExecutionPort, 'prepareQuery' | 'startQuery' | 'observeQuery'>>
    & Pick<RuntimeExecutionPort, 'readContinuationBrief'>;
  /**
   * A.2 step 5.4: the requeue owner; a narrow platform without it answers
   * `unsupported`. K3 L21 D9: `readTaskRequeueByIdentity` is the optional
   * no-write replay read the release-hold route asks first.
   */
  claims: Pick<TaskClaimPort, 'requeueTask' | 'readTaskRequeueByIdentity'>;
  /** A.2 step 5.9 (VR-14): the successor-round owner; a narrow platform without it answers `unsupported`. */
  evidence: Pick<EvidencePort, 'reverifyRound'>;
  messages: Pick<SessionMailboxPort, 'sendMessage' | 'readInbox' | 'readMessage' | 'readMessageBody'>
    & Required<Pick<SessionMailboxPort, 'readOutbox'>>
    & Pick<SessionMailboxPort, 'readUndeliveredReplies'>
    & Pick<SessionMessageCommandPort, 'releaseMessage' | 'withdrawMessage' | 'readMessageView' | 'readInboxView'>;
  queries: QueryJobPort;
  materials: Pick<MaterialPort, 'openArtifact'>;
  /** Slice 5 §4.5 decision owners: Goal settings/order, the workspace notice
   * cursor, the user-facing decision messages, the read-only decision queue and
   * the per-request candidate head. The composition root always publishes them. */
  goalSettings: Omit<GoalSettingsPort, 'resolveGoalConflict'>;
  workspaceDecisionSettings: WorkspaceDecisionSettingsPort;
  decisionMessages: DecisionMessagePort;
  decisions: DecisionReadPort;
  requestCandidates: RequestCandidatePort;
  workflow: WorkflowPort & Required<Pick<WorkflowPort, 'consumeConsultation'>>;
  /** Slice 1 (spec §4.4): the Session-facts read owner (the same instance injected into sessions/queries). */
  sessionFacts: SessionFactsPort;
  /** Slice 1 (spec §4.4): the responsibility write owner. */
  responsibilities: Pick<SessionResponsibilityPort, 'transferSessionResponsibility'>;
  /** Slice 1 (spec §4.4): the anchor read owner; `recordSessionAnomaly` stays off HTTP. */
  sessionAnomalies: Pick<SessionAnomalyPort, 'readTaskArchiveState' | 'listSessionAnomalies'>;
  /** K3 (§2 L7, L21): optional so a narrow platform answers `unsupported`; the
   * real composition publishes the read owner and the two human write owners. */
  unknownCallReviews?: Pick<UnknownCallReviewReadPort, 'readReview' | 'listReviews'>
    & Pick<UnknownCallReviewPort, 'holdReview' | 'releaseHold'>;
  /** A.2 step 5.6 (RUN-22): optional so a narrow platform answers `unsupported`. */
  resolveUnknownRun?(ctx: CoreCallContext, request: GraphWrite<ResolveUnknownRunRequestV1>): Promise<WriteResult<RunSnapshot>>;
  /** A.2 step 5.6 (QRR-06). */
  resolveUnknownQueryRun?(ctx: CoreCallContext, request: GraphWrite<ResolveUnknownQueryRunRequestV1>):
    Promise<WriteResult<QueryExecutionRecord>>;
  /** Slice 3 read model; a narrow platform without it answers `unsupported`. */
  graphContext: GraphContextReadPort;
  /** Slice 2B L9–L12: the non-enumerable activity and timeline owners (L15). */
  activity?: ActivityReadPort & Pick<TrackReadPort, 'readTrackBars'>;
  timeline?: TaskTimelineReadPort;
  /** Slice 2C (spec §2, L13): the internal line/detail owners. They are
   * non-enumerable on the composed platform (not public keys), so a full
   * `{ ...platform }` copy lacks them; such a binding answers `unsupported`. */
  workLines?: WorkLineReadPort;
  workLineConversation?: WorkLineConversationPort;
  nodeDetail?: NodeDetailReadPort;
  lineSettings?: WorkLineSettingsPort;
  /** The request command owner, non-enumerable on the
   * composed platform. A narrow platform without it answers `unsupported`. */
  requestIntake?: RequestIntakePort;
  /** The main read and `requests/read` owner, non-enumerable on the composed
   * platform. A narrow platform without it answers `unsupported`. */
  mainSurface?: MainSurfaceReadPort;
  /** Slice 4C (spec §2/L15/L19): the non-enumerable `notes` owner group the six
   * notes/version-list routes bind. A narrow platform without it answers
   * `unsupported`. */
  notes?: NoteWritePort & NoteCheckPort & {
    listNotes: (ctx: CoreCallContext, request: NoteListRequestV1) => Promise<NoteMemoryReadResult<NoteListResultV1>>;
    listPlanVersions: (ctx: CoreCallContext, input: { goalId: string; limit: number; cursor: string | null }) =>
      Promise<ReadResult<VersionListPageV1>>;
    listCatalogVersions: (ctx: CoreCallContext, input: { limit: number; cursor: string | null }) =>
      Promise<ReadResult<VersionListPageV1>>;
  };
  /** The two secretary lifecycle accept owners, non-enumerable on the composed platform (they are internal owners,
   * not public keys), so a narrow platform without them answers `unsupported`. The advance half is the Workflow's
   * `sessionHandoff`, published beside them. */
  sessionHandoff?: Pick<SessionHandoffPort, 'acceptHandoff'>;
  sessionArchive?: Pick<SessionSecretaryArchivePort, 'acceptArchive'>;
};

/** `executions/resolve-unknown` input (RUN-22): the unknown Run and the operator's reason. */
export type ResolveUnknownRunRequestV1 = { runRef: RunRef; reason: string };
/** `queries/resolve-unknown` input (QRR-06): the unknown QueryRun and the operator's reason. */
export type ResolveUnknownQueryRunRequestV1 = { queryRunRef: QueryRunRef; reason: string };

/** §12.1 step 7 (A.2 step 5.6): the instance lease (§12.8) and what the start-up reconcile did and left. */
export type HostReconcileReportV1 = {
  hostInstanceId: string;
  lease: 'owned' | 'held_by_other';
  /** HL row of the lease acquisition. */
  leaseRow: string;
  leaseReason: string;
  /** null when this Host did not reconcile (it does not hold the lease, L-10). */
  report: StartupReconcileReportV1 | null;
};

export type CoreRouteSpec = {
  kind: CoreRouteKind;
  /** The one named binding this suffix forwards to. */
  binding: keyof CoreRouteBindings;
  /** Documented public owner, checked against the port method name. */
  owner: string;
};

/**
 * The frozen R6.1a route table. Adding a suffix is a deliberate contract edit.
 * Every suffix of the typed DTO assemblies (slice 1, slice 2C, K3) must name a
 * real row here; naming them in the annotation is also the production-reach
 * anchor for those type-only assemblies and every body/result alias in them.
 */
export const CORE_ROUTE_SPECS: Record<
  CoreRouteSuffix | keyof Slice1CoreRouteDto | keyof Slice2CCoreRouteDto | keyof K3CoreRouteDto
  | keyof MessagesCoreRouteDto
  | keyof RequestCommandCoreRouteDto | keyof SecretaryLifecycleCoreRouteDto,
  CoreRouteSpec
> = {
  'controls/submit': { kind: 'graph_write', binding: 'submitControl', owner: 'controls.submitControl' },
  'controls/read': { kind: 'plain', binding: 'readControl', owner: 'controls.readControl' },
  'controls/deliver': { kind: 'plain', binding: 'deliverControl', owner: 'runtime.deliverControl' },
  'executions/start': { kind: 'plain', binding: 'startRun', owner: 'runtime.startRun' },
  'projects/create': { kind: 'graph_write', binding: 'createProject', owner: 'projects.createProject' },
  'workspaces/register': { kind: 'graph_write', binding: 'registerWorkspace', owner: 'projects.registerWorkspace' },
  'completion-policies/install': { kind: 'graph_write', binding: 'installCompletionPolicy', owner: 'completionPolicies.installCompletionPolicy' },
  'completion-policies/activate': { kind: 'graph_write', binding: 'activateCompletionPolicy', owner: 'completionPolicies.activateCompletionPolicy' },
  'completion-policies/read': { kind: 'plain', binding: 'readCurrentCompletionPolicy', owner: 'completionPolicies.readCurrentCompletionPolicy' },
  'goals/create': { kind: 'graph_write', binding: 'createGoal', owner: 'goals.createGoal' },
  'goals/read': { kind: 'plain', binding: 'queryGoal', owner: 'plans.queryGoal' },
  'architecture/adopt-initial': { kind: 'graph_write', binding: 'adoptInitialArchitecture', owner: 'architecture.adoptInitialArchitecture' },
  'architecture/read': { kind: 'plain', binding: 'readArchitectureRevision', owner: 'architecture.readArchitectureRevision' },
  'architecture/capture': { kind: 'graph_write', binding: 'captureArchitectureSource', owner: 'architecture.captureSourceChanges' },
  'architecture/query': { kind: 'plain', binding: 'queryArchitecture', owner: 'architecture.queryArchitecture' },
  'architecture/compare': { kind: 'plain', binding: 'compareArchitecture', owner: 'architecture.compareArchitecture' },
  'architecture/compare-formal': { kind: 'plain', binding: 'compareFormalObserved', owner: 'architecture.compareFormalObserved' },
  'architecture/impact': { kind: 'plain', binding: 'queryImpact', owner: 'architecture.queryImpact' },
  // L8 (book ruling 8): the one public observation state; the tests' bounded wait.
  'architecture/observation-state': { kind: 'plain', binding: 'observationState', owner: 'architecture.observationState' },
  'plans/propose': { kind: 'graph_write', binding: 'proposePlan', owner: 'plans.proposePlan' },
  'plans/apply': { kind: 'graph_write', binding: 'applyPlanChange', owner: 'plans.applyPlanChange' },
  'plans/proposal': { kind: 'plain', binding: 'readPlanProposal', owner: 'plans.readPlanProposal' },
  'tasks/query': { kind: 'plain', binding: 'queryTaskGraph', owner: 'plans.queryTaskGraph' },
  'files/read': { kind: 'plain', binding: 'readWorkspace', owner: 'workspace.readWorkspace' },
  'source/capture': { kind: 'plain', binding: 'captureWorkspaceSource', owner: 'workspace.captureSourceChanges' },
  'source/query': { kind: 'plain', binding: 'querySource', owner: 'workspace.querySource' },
  'sessions/find': { kind: 'plain', binding: 'findSessions', owner: 'sessions.findSessions' },
  'sessions/read': { kind: 'plain', binding: 'readSession', owner: 'sessions.readSession' },
  'sessions/operation': { kind: 'plain', binding: 'getSessionOperation', owner: 'sessions.getSessionOperation' },
  'runtime/capabilities': { kind: 'plain', binding: 'runtimeCapabilities', owner: 'runtime.capabilities' },
  'sessions/create': { kind: 'plain', binding: 'createSession', owner: 'runtime.createSession' },
  'sessions/history': { kind: 'plain', binding: 'readSessionHistory', owner: 'runtime.readSessionHistory' },
  'sessions/archive': { kind: 'graph_write', binding: 'archiveSession', owner: 'sessions.archiveSession' },
  'sessions/reactivate': { kind: 'graph_write', binding: 'reactivateSession', owner: 'sessions.reactivateSession' },
  'sessions/link': { kind: 'graph_write', binding: 'linkSessionWork', owner: 'sessions.linkSessionWork' },
  'messages/send': { kind: 'graph_write', binding: 'sendMessage', owner: 'messages.sendMessage' },
  'messages/inbox': { kind: 'plain', binding: 'readInbox', owner: 'messages.readInbox' },
  'messages/outbox': { kind: 'plain', binding: 'readOutbox', owner: 'messages.readOutbox' },
  'messages/read': { kind: 'plain', binding: 'readMessage', owner: 'messages.readMessage' },
  'messages/body': { kind: 'plain', binding: 'readMessageBody', owner: 'messages.readMessageBody' },
  // The release/withdraw commands stay in the messages family; the two view reads are the derived reads the page
  // consumes, so it never derives delivery itself. The Workflow's own release has no route here.
  'messages/release': { kind: 'graph_write', binding: 'releaseMessage', owner: 'messages.releaseMessage' },
  'messages/withdraw': { kind: 'graph_write', binding: 'withdrawMessage', owner: 'messages.withdrawMessage' },
  'messages/view': { kind: 'plain', binding: 'readMessageView', owner: 'messages.readMessageView' },
  'messages/inbox-view': { kind: 'plain', binding: 'readInboxView', owner: 'messages.readInboxView' },
  'workspaces/registration': { kind: 'plain', binding: 'readWorkspaceRegistration', owner: 'projects.readWorkspaceRegistration' },
  'queries/submit': { kind: 'graph_write', binding: 'submitQueryJob', owner: 'queries.submitQueryJob' },
  'queries/read': { kind: 'plain', binding: 'readQueryJob', owner: 'queries.readQueryJob' },
  'queries/claim': { kind: 'graph_write', binding: 'claimQuery', owner: 'queries.claimQuery' },
  'queries/prepare': { kind: 'plain', binding: 'prepareQuery', owner: 'runtime.prepareQuery' },
  'queries/start': { kind: 'plain', binding: 'startQuery', owner: 'runtime.startQuery' },
  'queries/observe': { kind: 'plain', binding: 'observeQuery', owner: 'runtime.observeQuery' },
  'queries/answer': { kind: 'plain', binding: 'readQueryAnswer', owner: 'queries.readQueryAnswer' },
  'materials/open': { kind: 'plain', binding: 'openArtifact', owner: 'materials.openArtifact' },
  'workflow/goal-input': { kind: 'plain', binding: 'handleGoalInput', owner: 'workflow.handleGoalInput' },
  'workflow/advance': { kind: 'plain', binding: 'advanceWork', owner: 'workflow.advanceWork' },
  'workflow/consultation': { kind: 'plain', binding: 'consumeConsultation', owner: 'workflow.consumeConsultation' },
  'workflow/driver-start': { kind: 'plain', binding: 'driverStart', owner: 'collaboration.start' },
  'workflow/driver-read': { kind: 'plain', binding: 'driverRead', owner: 'collaboration.read' },
  'workflow/driver-stop': { kind: 'plain', binding: 'driverStop', owner: 'collaboration.stop' },
  'executions/read': { kind: 'plain', binding: 'readExecution', owner: 'executions.readExecution' },
  'executions/history': { kind: 'plain', binding: 'readTaskExecutionHistory', owner: 'runtime.readTaskExecutionHistory' },
  // MVP UI connection: bounded execution list, narrow project read, Host CAS
  // save / existing-port compare, and the explicit command handle routes.
  'executions/list': { kind: 'plain', binding: 'listExecutions', owner: 'executions.listExecutions' },
  'projects/read': { kind: 'plain', binding: 'readProject', owner: 'projects.readProject' },
  'files/save': { kind: 'plain', binding: 'saveWorkspaceFile', owner: 'workbench.saveFile' },
  'files/list': { kind: 'plain', binding: 'listWorkspaceFiles', owner: 'workbench.listFiles' },
  'files/compare': { kind: 'plain', binding: 'compareWorkspaceFiles', owner: 'workspace.compareWorkspace' },
  'commands/start': { kind: 'plain', binding: 'startCommand', owner: 'workbench.startCommand' },
  'commands/read': { kind: 'plain', binding: 'readCommand', owner: 'workbench.readCommand' },
  'commands/stop': { kind: 'plain', binding: 'stopCommand', owner: 'workbench.stopCommand' },
  // A.2 step 5.4 (spec §4.3 "公开入口与操作者", §6.1 (e)).
  'tasks/requeue': { kind: 'graph_write', binding: 'requeueTask', owner: 'claims.requeueTask' },
  'executions/brief': { kind: 'plain', binding: 'readContinuationBrief', owner: 'runtime.readContinuationBrief' },
  // A.2 step 5.5 (spec §2.6 Host route `goals/control`, §2.3 fan-out, §2.1 display).
  'goals/control': { kind: 'graph_write', binding: 'setGoalControl', owner: 'goalControl.setGoalControl' },
  'goals/display': { kind: 'plain', binding: 'readGoalDisplay', owner: 'goalControl.readGoalDisplay' },
  // A.2 step 5.6 (spec §6 RUN-22, §8 QRR-06, §12.1 step 7, §12.8).
  'executions/resolve-unknown': { kind: 'graph_write', binding: 'resolveUnknownRun', owner: 'platform.resolveUnknownRun' },
  'queries/resolve-unknown': { kind: 'graph_write', binding: 'resolveUnknownQueryRun', owner: 'platform.resolveUnknownQueryRun' },
  'host/reconcile-report': { kind: 'plain', binding: 'readReconcileReport', owner: 'host.readReconcileReport' },
  // A.2 step 5.9 (spec §9 VR-14 "调用者"; §15.2 5.9 `verification/reverify`).
  'verification/reverify': { kind: 'graph_write', binding: 'reverifyRound', owner: 'evidence.reverifyRound' },
  // Slice 1 (spec §4.4): the eleven Session facts / corrections / archive routes.
  'sessions/archive-line': { kind: 'graph_write', binding: 'archiveLine', owner: 'workflow.archiveLine' },
  'sessions/archive-continue': { kind: 'plain', binding: 'continueArchiveLine', owner: 'workflow.continueArchiveLine' },
  'sessions/archive-release': { kind: 'graph_write', binding: 'releaseSessionArchiveRequest', owner: 'sessions.releaseSessionArchiveRequest' },
  'sessions/facts': { kind: 'plain', binding: 'readSessionFacts', owner: 'sessionFacts.readSessionFacts' },
  'sessions/successors': { kind: 'plain', binding: 'findSessionSuccessors', owner: 'sessionFacts.findSessionSuccessors' },
  'sessions/executions': { kind: 'plain', binding: 'listSessionExecutions', owner: 'sessionFacts.listSessionExecutions' },
  'sessions/queries': { kind: 'plain', binding: 'listSessionQueries', owner: 'sessionFacts.listSessionQueries' },
  'sessions/transfer-responsibility': { kind: 'graph_write', binding: 'transferSessionResponsibility', owner: 'responsibilities.transferSessionResponsibility' },
  'tasks/archive-state': { kind: 'plain', binding: 'readTaskArchiveState', owner: 'sessionAnomalies.readTaskArchiveState' },
  'anomalies/list': { kind: 'plain', binding: 'listSessionAnomalies', owner: 'sessionAnomalies.listSessionAnomalies' },
  'unknown-call-reviews/read': { kind: 'plain', binding: 'readUnknownCallReview', owner: 'unknownCallReviews.readReview' },
  'unknown-call-reviews/list': { kind: 'plain', binding: 'listUnknownCallReviews', owner: 'unknownCallReviews.listReviews' },
  // K3 L21: the two human write entries (UCR-15/UCR-14). `release-hold` is one
  // response { hold, requeue | null } (ruling 4); it succeeds iff releaseHold did.
  'unknown-call-reviews/hold': { kind: 'graph_write', binding: 'holdUnknownCallReview', owner: 'unknownCallReviews.holdReview' },
  'unknown-call-reviews/release-hold': { kind: 'graph_write', binding: 'releaseUnknownCallReviewHold', owner: 'unknownCallReviews.releaseHold' },
  'messages/undelivered-replies': { kind: 'plain', binding: 'readUndeliveredReplies', owner: 'messages.readUndeliveredReplies' },
  // Slice 3: the two public read-only graph routes.
  'graph/look': { kind: 'plain', binding: 'lookGraph', owner: 'graphContext.lookGraph' },
  'graph/find': { kind: 'plain', binding: 'findGraph', owner: 'graphContext.findGraph' },
  // Slice 5 §4.5: Goal settings/order/conflicts, per-request candidate head and
  // abandonment, the decision queue/card/answer/application, the notice cursor
  // and the explicit user send.
  'goals/settings': { kind: 'plain', binding: 'readGoalSettings', owner: 'goalSettings.readGoalSettings' },
  'goals/settings/set': { kind: 'graph_write', binding: 'setGoalSettings', owner: 'goalSettings.setGoalSettings' },
  'goals/reorder': { kind: 'graph_write', binding: 'reorderGoals', owner: 'goalSettings.reorderGoals' },
  'goals/conflicts': { kind: 'plain', binding: 'queryGoalConflicts', owner: 'decisions.queryGoalConflicts' },
  // §3.6 item 5: the three-version read a Goal card carries, as its own Goal read row (not a messages entry).
  'goals/dispatch-basis': { kind: 'plain', binding: 'readDispatchBasis', owner: 'goals.readDispatchBasis' },
  // The two Goal-card commands, the copy preview and the initialization adoption.
  'goals/confirm-draft': { kind: 'plain', binding: 'confirmGoalDraft', owner: 'goals.confirmDraft' },
  'goals/copy-draft': { kind: 'plain', binding: 'readGoalCopyDraft', owner: 'goals.readGoalCopyDraft' },
  'goals/copy-confirm': { kind: 'plain', binding: 'confirmGoalCopy', owner: 'goals.confirmGoalCopy' },
  'initialization/adopt': { kind: 'plain', binding: 'adoptInitialization', owner: 'initialization.adopt' },
  'plans/request-candidate': { kind: 'plain', binding: 'readRequestCandidate', owner: 'requestCandidates.readRequestCandidate' },
  'plans/abandon': { kind: 'graph_write', binding: 'abandonPlanProposal', owner: 'requestCandidates.abandonPlanProposal' },
  'decisions/queue': { kind: 'plain', binding: 'queryDecisionQueue', owner: 'decisions.queryDecisionQueue' },
  'decisions/card': { kind: 'plain', binding: 'readDecisionCard', owner: 'decisions.readDecisionCard' },
  'decisions/answer': { kind: 'graph_write', binding: 'resolveDecision', owner: 'workflow.resolveDecision' },
  'decisions/application': { kind: 'graph_write', binding: 'recordDecisionApplication', owner: 'decisionMessages.recordDecisionApplication' },
  'decisions/notices/seen': { kind: 'graph_write', binding: 'markNoticesSeen', owner: 'workspaceDecisionSettings.markNoticesSeen' },
  'messages/user-send': { kind: 'graph_write', binding: 'sendUserMessage', owner: 'decisionMessages.sendUserMessage' },
  // Slice 2B L9–L12/L15: the six activity/timeline reads and the human backfill.
  'activity/calendar': { kind: 'plain', binding: 'readActivityCalendar', owner: 'activity.readActivityCalendar' },
  'activity/runs': { kind: 'plain', binding: 'readRunActivities', owner: 'activity.readRunActivities' },
  'activity/queries': { kind: 'plain', binding: 'readQueryActivities', owner: 'activity.readQueryActivities' },
  'activity/track': { kind: 'plain', binding: 'readTrackBars', owner: 'activity.readTrackBars' },
  'tasks/timeline': { kind: 'plain', binding: 'readTaskStateTimeline', owner: 'timeline.readTaskStateTimeline' },
  'activity/backfill': { kind: 'plain', binding: 'backfillActivityRange', owner: 'workflow.backfillActivityRange' },
  // Slice 2C (spec §2, L13): the seven line/detail routes. Only `lines/pin` writes.
  'lines/list': { kind: 'plain', binding: 'listWorkLines', owner: 'workLines.listWorkLines' },
  'lines/archived': { kind: 'plain', binding: 'listArchivedLines', owner: 'workLines.listArchivedLines' },
  'lines/read': { kind: 'plain', binding: 'readWorkLine', owner: 'workLines.readWorkLine' },
  'lines/page': { kind: 'plain', binding: 'readWorkLinePage', owner: 'workLineConversation.readWorkLinePage' },
  'lines/pin': { kind: 'graph_write', binding: 'setLinePins', owner: 'lineSettings.setLinePins' },
  'graph/hover': { kind: 'plain', binding: 'readGraphHover', owner: 'nodeDetail.readGraphHover' },
  'graph/detail': { kind: 'plain', binding: 'readNodeDetail', owner: 'nodeDetail.readNodeDetail' },
  // Slice 4C C1.4 (spec §2/L15/L19): the person's notes and the two version
  // lists, owner `notes` non-enumerable in the composition root. The three
  // writes are person-only.
  'notes/list': { kind: 'plain', binding: 'listNotes', owner: 'notes.listNotes' },
  'notes/write': { kind: 'plain', binding: 'writeNote', owner: 'notes.writeNote' },
  'notes/withdraw': { kind: 'plain', binding: 'withdrawNote', owner: 'notes.withdrawNote' },
  'notes/review': { kind: 'plain', binding: 'reviewNote', owner: 'notes.reviewNote' },
  'plans/versions': { kind: 'plain', binding: 'listPlanVersions', owner: 'notes.listPlanVersions' },
  'architecture/versions': { kind: 'plain', binding: 'listCatalogVersions', owner: 'notes.listCatalogVersions' },
  // The four person-only request commands. `route` accepts
  // `manual`/`dropped` publicly; `handoff`/`archived` stay internal.
  'requests/submit': { kind: 'plain', binding: 'submitRequest', owner: 'requestIntake.submitRequest' },
  'requests/route': { kind: 'plain', binding: 'routeRequest', owner: 'requestIntake.route' },
  'requests/select-idea': { kind: 'plain', binding: 'selectRequestIdea', owner: 'requestIntake.selectIdea' },
  'requests/ask': { kind: 'plain', binding: 'askRequest', owner: 'requestIntake.ask' },
  // The main conversation's read and one request's read with its cards.
  'main/read': { kind: 'plain', binding: 'readMainPage', owner: 'mainSurface.readMainPage' },
  'requests/read': { kind: 'plain', binding: 'readRequestView', owner: 'mainSurface.readRequestView' },
  // The two secretary lifecycle commands: the person's handoff of one line and
  // the person's manual archive of one secretary. Both stay internal in the
  // public key list; the owner named here is the accept half, and the route
  // drives the Workflow's advance right after it.
  'secretaries/handoff': { kind: 'plain', binding: 'acceptHandoff', owner: 'sessionHandoff.acceptHandoff' },
  'secretaries/archive': { kind: 'plain', binding: 'acceptArchive', owner: 'sessionArchive.acceptArchive' },
};

export type ParsedCoreRequest =
  | { ok: true; scope: CoreScope; kind: 'graph_write'; request: unknown }
  | { ok: true; scope: CoreScope; kind: 'plain'; input: unknown }
  | { ok: false; rejection: CoreRejection };

/** A structured domain/parsing rejection carried out of the route layer. The
 * server maps its `code` onto the HTTP error boundary; the browser sees the
 * exact `committed`/`replayed`/`cursor`/rejection discriminator. */
export class CoreRouteRejectionError extends Error {
  readonly rejection: CoreRejection;
  constructor(rejection: CoreRejection) {
    super(rejection.reason);
    this.name = 'CoreRouteRejectionError';
    this.rejection = rejection;
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const invalid = (reason: string): ParsedCoreRequest =>
  ({ ok: false, rejection: { status: 'rejected', code: 'invalid', reason } });

function parseScope(raw: Record<string, unknown>): CoreScope | CoreRejection {
  const scope = raw.scope;
  if (!isPlainObject(scope)) return { status: 'rejected', code: 'invalid', reason: 'scope must be an object' };
  if (typeof scope.projectId !== 'string' || scope.projectId.length === 0)
    return { status: 'rejected', code: 'invalid', reason: 'scope.projectId must be a non-empty string' };
  if (typeof scope.workspaceId !== 'string' || scope.workspaceId.length === 0)
    return { status: 'rejected', code: 'invalid', reason: 'scope.workspaceId must be a non-empty string' };
  for (const key of Object.keys(scope)) {
    if (key !== 'projectId' && key !== 'workspaceId')
      return { status: 'rejected', code: 'invalid', reason: `scope may not carry "${key}"` };
  }
  return { projectId: scope.projectId, workspaceId: scope.workspaceId };
}

export function parseCoreRouteRequest(suffix: CoreRouteSuffix, raw: unknown): ParsedCoreRequest {
  if (!isPlainObject(raw)) return invalid('the request body must be a JSON object');
  const scope = parseScope(raw);
  if ('status' in scope) return { ok: false, rejection: scope };
  const spec = CORE_ROUTE_SPECS[suffix];
  const containerKey = spec.kind === 'graph_write' ? 'request' : 'input';
  for (const key of Object.keys(raw)) {
    if (key !== 'scope' && key !== containerKey)
      return invalid(`the request body may not carry "${key}"`);
  }
  if (!(containerKey in raw)) return invalid(`the request body requires "${containerKey}"`);
  if (spec.kind === 'graph_write') {
    const request = raw.request;
    if (!isPlainObject(request)) return invalid('request must be an object');
    for (const key of Object.keys(request)) {
      if (key !== 'input' && key !== 'meta') return invalid(`request may not carry "${key}"`);
    }
    if (!('input' in request)) return invalid('request.input is required');
    // L8 (P16): `requestSeq` is the driver's trusted start watermark, not a
    // public manual input; the manual capture reads the current request record.
    if (suffix === 'architecture/capture' && isPlainObject(request.input)
      && Object.prototype.hasOwnProperty.call(request.input, 'requestSeq')) {
      return invalid('architecture/capture request.input may not carry "requestSeq"');
    }
    const meta = request.meta;
    if (!isPlainObject(meta)) return invalid('request.meta must be an object');
    for (const key of Object.keys(meta)) {
      if (key !== 'requestId' && key !== 'expected') return invalid(`request.meta may not carry "${key}"`);
    }
    if (typeof meta.requestId !== 'string' || meta.requestId.length === 0)
      return invalid('request.meta.requestId must be a non-empty string');
    if (!Array.isArray(meta.expected)) return invalid('request.meta.expected must be an array of version pins');
    return { ok: true, scope, kind: 'graph_write', request };
  }
  return { ok: true, scope, kind: 'plain', input: raw.input };
}

/**
 * Task E change stream request. The stream (`GET changes`) is a transport
 * endpoint served by `server.ts` beside bootstrap, NOT a row of the frozen POST
 * route table above; its only request input is the optional SSE
 * `Last-Event-ID` header, parsed here. A value that is not a ledger commit
 * cursor is `invalid`, which the feed answers with an explicit `reset` instead
 * of guessing a position.
 */
export type ChangeStreamResume =
  | { kind: 'fresh' }
  | { kind: 'resume'; cursor: CommitCursor; seq: number }
  | { kind: 'invalid' };

export function parseChangeStreamResume(header: string | string[] | undefined): ChangeStreamResume {
  if (header === undefined || header === '') return { kind: 'fresh' };
  if (typeof header !== 'string') return { kind: 'invalid' };
  try {
    const seq = seqOfCommitCursor(header as CommitCursor);
    return { kind: 'resume', cursor: header as CommitCursor, seq };
  } catch {
    return { kind: 'invalid' };
  }
}

/**
 * Bind the real platform seams to the frozen route table. Every entry is one
 * named public port method on the SAME platform instance; nothing here
 * re-implements governance, Session, mailbox, history or CAS and nothing
 * reaches the RecordStore. `.bind` keeps the owning group as the receiver so a
 * port method can never be captured with a foreign `this`. The ten R6.1b-1
 * Session/message/history routes call the real `sessions`/`runtime`/`messages`
 * services; the Host `ctx` (fixed actor/scope/signal) is supplied by the
 * server, never by the request body.
 */
export function createPlatformCoreRouteBindings(
  platform: CoreRoutePlatform,
  driver?: CollaborationDriverPort,
  workbenchTools?: WorkbenchToolsPort,
  goalControl?: GoalControlPort,
  hostReport?: HostReconcileReportPort,
  initialization?: InitializationAdoptionHostPort,
): CoreRouteBindings {
  // A Host that assembles no collaboration driver still publishes the exact
  // routes, but every one answers an explicit `unsupported` instead of a fake
  // success. The old composition never has to import the Host layer.
  const unsupportedDriver = <T>(method: string): T => (async () => ({
    status: 'rejected', code: 'unsupported',
    reason: `the Host does not publish a collaboration driver (${method})`,
  })) as unknown as T;
  // A missing optional dependency (no workbench-tools adapter, or a narrow
  // owner port without the new method) is an explicit `unsupported` gap, never
  // a silently empty success.
  const unsupported = <T>(reason: string): T => (async () => ({
    status: 'rejected', code: 'unsupported', reason,
  })) as unknown as T;
  // Slice 4C C1.4 (L15): the three notes writes are person-only. The note
  // service itself also admits an agent writer (the `record_note` tool); the
  // person's HTTP routes accept only the Host's human actor, so a member
  // identity is `forbidden` before the write is attempted. The two Goal-card
  // commands and the initialization adoption sit behind the same guard.
  const personOnly = (ctx: CoreCallContext): boolean =>
    ctx.principal.kind === 'host' && ctx.principal.actor.kind === 'human';
  const forbiddenPerson = (): CoreRejection =>
    ({ status: 'rejected', code: 'forbidden', reason: 'only the person may call this route' });
  // A request command is the person's; a member or system
  // actor is `forbidden` BEFORE any read, pick or line. The route also refuses a
  // non-object input body; every other input rule is the request service's
  // precheck (one rule, one place).
  const requestEntryProblem = (ctx: CoreCallContext, input: unknown): CoreRejection | null => {
    if (!personOnly(ctx)) {
      return { status: 'rejected', code: 'forbidden', reason: 'only the person may issue a request command' };
    }
    if (!isPlainObject(input)) {
      return { status: 'rejected', code: 'invalid', reason: 'the request input must be a JSON object' };
    }
    return null;
  };
  // A secretary lifecycle command is the person's too: a member or system actor is `forbidden` BEFORE the accept
  // owner runs, and a non-object body is `invalid`. The accepted operation's own rules stay the owner's.
  const lifecycleEntryProblem = (ctx: CoreCallContext, input: unknown, what: string): CoreRejection | null => {
    if (!personOnly(ctx)) {
      return { status: 'rejected', code: 'forbidden', reason: `only the person may issue ${what}` };
    }
    if (!isPlainObject(input)) {
      return { status: 'rejected', code: 'invalid', reason: `the ${what} input must be a JSON object` };
    }
    return null;
  };
  /** The accept committed but the Workflow publishes no advance: the operation stays for the Host's queue. */
  const lifecycleAdvanceMissing: CoreRejection = {
    status: 'rejected', code: 'unsupported', reason: 'the Workflow does not publish the secretary lifecycle advance',
  };
  /** R-03: write, then on success `checkNotes({ withSimilar: true })`; a failed
   *  check is `{ status: 'unavailable', reason }` and never undoes the write. */
  const writeNoteEnvelope = async (ctx: CoreCallContext,
    input: Parameters<NoteWritePort['writeNote']>[1]): Promise<WriteNoteEnvelopeV1 | CoreRejection> => {
    if (platform.notes === undefined || !personOnly(ctx)) return forbiddenPerson();
    const owner = platform.notes;
    const write = await owner.writeNote(ctx, input);
    if (write.status === 'rejected') {
      return { write, check: { status: 'unavailable', reason: write.reason } };
    }
    let check: NoteCheckV1 | { status: 'unavailable'; reason: string };
    try {
      const checked = await owner.checkNotes(ctx,
        { items: [{ noteId: write.noteId, version: write.version }], withSimilar: true });
      if (checked.status === 'ready') check = checked.value[0] ?? { status: 'unavailable', reason: 'the note check returned no item' };
      else if (checked.status === 'rejected') check = { status: 'unavailable', reason: checked.reason };
      else check = { status: 'unavailable', reason: `the note check is not ready (${checked.status})` };
    } catch (error) {
      check = { status: 'unavailable', reason: error instanceof Error ? error.message : 'the note check failed' };
    }
    return { write, check };
  };
  const personEntry = <A, R>(method: (ctx: CoreCallContext, input: A) => Promise<R>) =>
    async (ctx: CoreCallContext, input: A): Promise<R | CoreRejection> =>
      personOnly(ctx) ? method(ctx, input) : forbiddenPerson();
  return {
    submitControl: platform.controls.submitControl.bind(platform.controls),
    readControl: platform.controls.readControl.bind(platform.controls),
    deliverControl: (ctx, request) => platform.runtime.deliverControl?.(ctx, request) ?? Promise.resolve({ status: 'rejected', code: 'unsupported', reason: 'Runtime control delivery unavailable' }),
    startRun: platform.runtime.startRun.bind(platform.runtime),
    createProject: platform.projects.createProject.bind(platform.projects),
    registerWorkspace: platform.projects.registerWorkspace.bind(platform.projects),
    installCompletionPolicy: platform.completionPolicies.installCompletionPolicy.bind(platform.completionPolicies),
    activateCompletionPolicy: platform.completionPolicies.activateCompletionPolicy.bind(platform.completionPolicies),
    readCurrentCompletionPolicy: platform.completionPolicies.readCurrentCompletionPolicy === undefined
      ? unsupported('the Host does not publish the current completion policy read')
      : platform.completionPolicies.readCurrentCompletionPolicy.bind(platform.completionPolicies),
    createGoal: platform.goals.createGoal.bind(platform.goals),
    queryGoal: platform.plans.queryGoal.bind(platform.plans),
    adoptInitialArchitecture: platform.architecture.adoptInitialArchitecture.bind(platform.architecture),
    readArchitectureRevision: platform.architecture.readArchitectureRevision.bind(platform.architecture),
    captureArchitectureSource: platform.architecture.captureSourceChanges.bind(platform.architecture),
    queryArchitecture: platform.architecture.queryArchitecture.bind(platform.architecture),
    compareArchitecture: platform.architecture.compareArchitecture.bind(platform.architecture),
    compareFormalObserved: platform.architecture.compareFormalObserved.bind(platform.architecture),
    queryImpact: platform.architecture.queryImpact.bind(platform.architecture),
    // L8: a narrow platform without the owner answers explicit `unsupported`.
    observationState: platform.architecture.observationState === undefined
      ? unsupported('the platform does not publish architecture.observationState')
      : platform.architecture.observationState.bind(platform.architecture),
    proposePlan: platform.plans.proposePlan.bind(platform.plans),
    applyPlanChange: platform.plans.applyPlanChange.bind(platform.plans),
    readPlanProposal: platform.plans.readPlanProposal.bind(platform.plans),
    queryTaskGraph: platform.plans.queryTaskGraph.bind(platform.plans),
    readWorkspace: platform.workspace.readWorkspace.bind(platform.workspace),
    captureWorkspaceSource: platform.workspace.captureSourceChanges.bind(platform.workspace),
    querySource: platform.workspace.querySource.bind(platform.workspace),
    findSessions: platform.sessions.findSessions.bind(platform.sessions),
    readSession: platform.sessions.readSession.bind(platform.sessions),
    getSessionOperation: platform.sessions.getSessionOperation.bind(platform.sessions),
    runtimeCapabilities: platform.runtime.capabilities.bind(platform.runtime),
    createSession: platform.runtime.createSession.bind(platform.runtime),
    readSessionHistory: platform.runtime.readSessionHistory.bind(platform.runtime),
    archiveSession: platform.sessions.archiveSession.bind(platform.sessions),
    reactivateSession: platform.sessions.reactivateSession.bind(platform.sessions),
    linkSessionWork: platform.sessions.linkSessionWork.bind(platform.sessions),
    sendMessage: platform.messages.sendMessage.bind(platform.messages),
    readInbox: platform.messages.readInbox.bind(platform.messages),
    readOutbox: platform.messages.readOutbox.bind(platform.messages),
    readMessage: platform.messages.readMessage.bind(platform.messages),
    readMessageBody: platform.messages.readMessageBody.bind(platform.messages),
    // The release decision is the person's: the route refuses a member or a system actor BEFORE the owner runs, and
    // the owner re-checks the same rule together with the awaiting-only admission. The withdraw route adds no check
    // of its own; the owner admits the person or the original sender and refuses everyone else.
    releaseMessage: async (ctx, request) => personOnly(ctx)
      ? platform.messages.releaseMessage(ctx, request)
      : { status: 'rejected', code: 'forbidden', reason: 'only the person may approve or deny a message release' },
    withdrawMessage: platform.messages.withdrawMessage.bind(platform.messages),
    readMessageView: platform.messages.readMessageView.bind(platform.messages),
    readInboxView: platform.messages.readInboxView.bind(platform.messages),
    readWorkspaceRegistration: platform.projects.readWorkspaceRegistration.bind(platform.projects),
    submitQueryJob: platform.queries.submitQueryJob.bind(platform.queries),
    readQueryJob: platform.queries.readQueryJob.bind(platform.queries),
    claimQuery: platform.queries.claimQuery.bind(platform.queries),
    prepareQuery: platform.runtime.prepareQuery.bind(platform.runtime),
    startQuery: platform.runtime.startQuery.bind(platform.runtime),
    observeQuery: platform.runtime.observeQuery.bind(platform.runtime),
    readQueryAnswer: platform.queries.readQueryAnswer.bind(platform.queries),
    openArtifact: platform.materials.openArtifact.bind(platform.materials),
    handleGoalInput: platform.workflow.handleGoalInput.bind(platform.workflow),
    advanceWork: platform.workflow.advanceWork.bind(platform.workflow),
    consumeConsultation: platform.workflow.consumeConsultation.bind(platform.workflow),
    driverStart: driver === undefined ? unsupportedDriver('start') : driver.start.bind(driver),
    driverRead: driver === undefined ? unsupportedDriver('read') : driver.read.bind(driver),
    driverStop: driver === undefined ? unsupportedDriver('stop') : driver.stop.bind(driver),
    readExecution: platform.executions.readExecution.bind(platform.executions),
    readTaskExecutionHistory: platform.runtime.readTaskExecutionHistory.bind(platform.runtime),
    readProject: platform.projects.readProject === undefined
      ? unsupported('the Host does not publish the narrow project read')
      : platform.projects.readProject.bind(platform.projects),
    listExecutions: platform.executions.listExecutions.bind(platform.executions),
    saveWorkspaceFile: workbenchTools === undefined
      ? unsupported('the Host does not publish workbench tools (saveFile)')
      : workbenchTools.saveFile.bind(workbenchTools),
    listWorkspaceFiles: workbenchTools === undefined
      ? unsupported('the Host does not publish workbench tools (listFiles)')
      : workbenchTools.listFiles.bind(workbenchTools),
    compareWorkspaceFiles: platform.workspace.compareWorkspace.bind(platform.workspace),
    startCommand: workbenchTools === undefined
      ? unsupported('the Host does not publish workbench tools (startCommand)')
      : workbenchTools.startCommand.bind(workbenchTools),
    readCommand: workbenchTools === undefined
      ? unsupported('the Host does not publish workbench tools (readCommand)')
      : workbenchTools.readCommand.bind(workbenchTools),
    stopCommand: workbenchTools === undefined
      ? unsupported('the Host does not publish workbench tools (stopCommand)')
      : workbenchTools.stopCommand.bind(workbenchTools),
    requeueTask: platform.claims.requeueTask === undefined
      ? unsupported('the Host does not publish the requeue owner')
      : platform.claims.requeueTask.bind(platform.claims),
    readContinuationBrief: platform.runtime.readContinuationBrief === undefined
      ? unsupported('the Host Runtime does not publish the continuation brief read')
      : platform.runtime.readContinuationBrief.bind(platform.runtime),
    setGoalControl: goalControl === undefined
      ? unsupported('the Host does not publish the Goal fan-out driver (setGoalControl)')
      : goalControl.setGoalControl.bind(goalControl),
    readGoalDisplay: goalControl === undefined
      ? unsupported('the Host does not publish the Goal fan-out driver (readGoalDisplay)')
      : goalControl.readGoalDisplay.bind(goalControl),
    resolveUnknownRun: platform.resolveUnknownRun === undefined
      ? unsupported('the Host does not publish the unknown-outcome attestation (resolveUnknownRun)')
      : platform.resolveUnknownRun.bind(platform),
    resolveUnknownQueryRun: platform.resolveUnknownQueryRun === undefined
      ? unsupported('the Host does not publish the unknown-outcome attestation (resolveUnknownQueryRun)')
      : platform.resolveUnknownQueryRun.bind(platform),
    readReconcileReport: hostReport === undefined
      ? unsupported('the Host does not publish its reconcile report')
      : hostReport.readReconcileReport.bind(hostReport),
    reverifyRound: platform.evidence.reverifyRound === undefined
      ? unsupported('the Host does not publish the successor-round owner (reverifyRound)')
      : platform.evidence.reverifyRound.bind(platform.evidence),
    // Slice 1 (spec §4.4): the new owners. `archiveLine`/`continueArchiveLine`
    // are optional only for an old narrow Workflow double; the real composition
    // publishes them, and `readUndeliveredReplies` likewise.
    archiveLine: platform.workflow.archiveLine === undefined
      ? unsupported('the Host Workflow does not publish the archive composite (archiveLine)')
      : platform.workflow.archiveLine.bind(platform.workflow),
    continueArchiveLine: platform.workflow.continueArchiveLine === undefined
      ? unsupported('the Host Workflow does not publish the archive continuation (continueArchiveLine)')
      : platform.workflow.continueArchiveLine.bind(platform.workflow),
    releaseSessionArchiveRequest: platform.sessions.releaseSessionArchiveRequest.bind(platform.sessions),
    // Rebase of slice 5 onto slices 1/3 (lead): the internal owners of slices 1,
    // 3 and 5 are non-enumerable on the composed platform (not public keys), so
    // a `{ ...platform }` copy lacks them; such a binding answers `unsupported`.
    readSessionFacts: platform.sessionFacts === undefined ? unsupported('the platform does not publish sessionFacts.readSessionFacts')
      : platform.sessionFacts.readSessionFacts.bind(platform.sessionFacts),
    findSessionSuccessors: platform.sessionFacts === undefined ? unsupported('the platform does not publish sessionFacts.findSessionSuccessors')
      : platform.sessionFacts.findSessionSuccessors.bind(platform.sessionFacts),
    listSessionExecutions: platform.sessionFacts === undefined ? unsupported('the platform does not publish sessionFacts.listSessionExecutions')
      : platform.sessionFacts.listSessionExecutions.bind(platform.sessionFacts),
    listSessionQueries: platform.sessionFacts === undefined ? unsupported('the platform does not publish sessionFacts.listSessionQueries')
      : platform.sessionFacts.listSessionQueries.bind(platform.sessionFacts),
    transferSessionResponsibility: platform.responsibilities === undefined ? unsupported('the platform does not publish responsibilities.transferSessionResponsibility')
      : platform.responsibilities.transferSessionResponsibility.bind(platform.responsibilities),
    readTaskArchiveState: platform.sessionAnomalies === undefined ? unsupported('the platform does not publish sessionAnomalies.readTaskArchiveState')
      : platform.sessionAnomalies.readTaskArchiveState.bind(platform.sessionAnomalies),
    listSessionAnomalies: platform.sessionAnomalies === undefined ? unsupported('the platform does not publish sessionAnomalies.listSessionAnomalies')
      : platform.sessionAnomalies.listSessionAnomalies.bind(platform.sessionAnomalies),
    readUnknownCallReview: platform.unknownCallReviews === undefined
      ? unsupported('the platform does not publish unknownCallReviews.readReview')
      : platform.unknownCallReviews.readReview.bind(platform.unknownCallReviews),
    listUnknownCallReviews: platform.unknownCallReviews === undefined
      ? unsupported('the platform does not publish unknownCallReviews.listReviews')
      : platform.unknownCallReviews.listReviews.bind(platform.unknownCallReviews),
    holdUnknownCallReview: platform.unknownCallReviews === undefined || platform.unknownCallReviews.holdReview === undefined
      ? unsupported('the platform does not publish unknownCallReviews.holdReview')
      : platform.unknownCallReviews.holdReview.bind(platform.unknownCallReviews),
    releaseUnknownCallReviewHold: platform.unknownCallReviews === undefined || platform.unknownCallReviews.releaseHold === undefined
      ? unsupported('the platform does not publish unknownCallReviews.releaseHold')
      : async (ctx, request) => {
        const hold = await platform.unknownCallReviews!.releaseHold(ctx, request);
        if (hold.status !== 'committed') return hold;
        const requeue = await releaseHoldRequeue(platform, ctx, request, hold.value);
        return { status: 'committed', value: { hold, requeue }, replayed: hold.replayed, cursor: hold.cursor };
      },
    readUndeliveredReplies: platform.messages.readUndeliveredReplies === undefined
      ? unsupported('the Host mailbox does not publish the undelivered-reply read (readUndeliveredReplies)')
      : platform.messages.readUndeliveredReplies.bind(platform.messages),
    lookGraph: platform.graphContext === undefined ? unsupported('the platform does not publish graphContext.lookGraph')
      : platform.graphContext.lookGraph.bind(platform.graphContext),
    findGraph: platform.graphContext === undefined ? unsupported('the platform does not publish graphContext.findGraph')
      : platform.graphContext.findGraph.bind(platform.graphContext),
    // Slice 5 §4.5: each suffix calls its exact named owner method; there is no
    // `platform[group][method]` access. `resolveDecision` stays optional on the
    // Workflow port, so a Host without it keeps an explicit unsupported gap.
    readGoalSettings: platform.goalSettings === undefined ? unsupported('the platform does not publish goalSettings.readGoalSettings')
      : platform.goalSettings.readGoalSettings.bind(platform.goalSettings),
    setGoalSettings: platform.goalSettings === undefined ? unsupported('the platform does not publish goalSettings.setGoalSettings')
      : platform.goalSettings.setGoalSettings.bind(platform.goalSettings),
    reorderGoals: platform.goalSettings === undefined ? unsupported('the platform does not publish goalSettings.reorderGoals')
      : platform.goalSettings.reorderGoals.bind(platform.goalSettings),
    queryGoalConflicts: platform.decisions === undefined ? unsupported('the platform does not publish decisions.queryGoalConflicts')
      : platform.decisions.queryGoalConflicts.bind(platform.decisions),
    readDispatchBasis: platform.goals.readDispatchBasis.bind(platform.goals),
    readRequestCandidate: platform.requestCandidates === undefined ? unsupported('the platform does not publish requestCandidates.readRequestCandidate')
      : platform.requestCandidates.readRequestCandidate.bind(platform.requestCandidates),
    abandonPlanProposal: platform.requestCandidates === undefined ? unsupported('the platform does not publish requestCandidates.abandonPlanProposal')
      : platform.requestCandidates.abandonPlanProposal.bind(platform.requestCandidates),
    queryDecisionQueue: platform.decisions === undefined ? unsupported('the platform does not publish decisions.queryDecisionQueue')
      : platform.decisions.queryDecisionQueue.bind(platform.decisions),
    readDecisionCard: platform.decisions === undefined ? unsupported('the platform does not publish decisions.readDecisionCard')
      : platform.decisions.readDecisionCard.bind(platform.decisions),
    resolveDecision: platform.workflow.resolveDecision === undefined
      ? unsupported('the Workflow does not publish the finite decision coordinator (resolveDecision)')
      : platform.workflow.resolveDecision.bind(platform.workflow),
    recordDecisionApplication: platform.decisionMessages === undefined ? unsupported('the platform does not publish decisionMessages.recordDecisionApplication')
      : platform.decisionMessages.recordDecisionApplication.bind(platform.decisionMessages),
    markNoticesSeen: platform.workspaceDecisionSettings === undefined ? unsupported('the platform does not publish workspaceDecisionSettings.markNoticesSeen')
      : platform.workspaceDecisionSettings.markNoticesSeen.bind(platform.workspaceDecisionSettings),
    sendUserMessage: platform.decisionMessages === undefined ? unsupported('the platform does not publish decisionMessages.sendUserMessage')
      : platform.decisionMessages.sendUserMessage.bind(platform.decisionMessages),
    // Slice 2B L9–L12/L15: the non-enumerable activity/timeline owners; a narrow
    // platform without them keeps an explicit unsupported gap. The human range
    // backfill is the optional Workflow operation the real composition installs.
    readActivityCalendar: platform.activity === undefined ? unsupported('the platform does not publish activity.readActivityCalendar')
      : platform.activity.readActivityCalendar.bind(platform.activity),
    readRunActivities: platform.activity === undefined ? unsupported('the platform does not publish activity.readRunActivities')
      : platform.activity.readRunActivities.bind(platform.activity),
    readQueryActivities: platform.activity === undefined ? unsupported('the platform does not publish activity.readQueryActivities')
      : platform.activity.readQueryActivities.bind(platform.activity),
    readTrackBars: platform.activity === undefined ? unsupported('the platform does not publish activity.readTrackBars')
      : platform.activity.readTrackBars.bind(platform.activity),
    readTaskStateTimeline: platform.timeline === undefined ? unsupported('the platform does not publish timeline.readTaskStateTimeline')
      : platform.timeline.readTaskStateTimeline.bind(platform.timeline),
    backfillActivityRange: platform.workflow.backfillActivityRange === undefined
      ? unsupported('the Workflow does not publish the human activity backfill (backfillActivityRange)')
      : platform.workflow.backfillActivityRange.bind(platform.workflow),
    // Slice 2C (spec §2, L13): the seven named owner methods. The line groups
    // are non-enumerable internal owners, so a spread copy lacks them and the
    // binding answers an explicit `unsupported` instead of a fake empty read.
    listWorkLines: platform.workLines === undefined ? unsupported('the platform does not publish workLines.listWorkLines')
      : platform.workLines.listWorkLines.bind(platform.workLines),
    listArchivedLines: platform.workLines === undefined ? unsupported('the platform does not publish workLines.listArchivedLines')
      : platform.workLines.listArchivedLines.bind(platform.workLines),
    readWorkLine: platform.workLines === undefined ? unsupported('the platform does not publish workLines.readWorkLine')
      : platform.workLines.readWorkLine.bind(platform.workLines),
    readWorkLinePage: platform.workLineConversation === undefined
      ? unsupported('the platform does not publish workLineConversation.readWorkLinePage')
      : platform.workLineConversation.readWorkLinePage.bind(platform.workLineConversation),
    readGraphHover: platform.nodeDetail === undefined ? unsupported('the platform does not publish nodeDetail.readGraphHover')
      : platform.nodeDetail.readGraphHover.bind(platform.nodeDetail),
    readNodeDetail: platform.nodeDetail === undefined ? unsupported('the platform does not publish nodeDetail.readNodeDetail')
      : platform.nodeDetail.readNodeDetail.bind(platform.nodeDetail),
    setLinePins: platform.lineSettings === undefined ? unsupported('the platform does not publish lineSettings.setLinePins')
      : platform.lineSettings.setLinePins.bind(platform.lineSettings),
    // Slice 4C C1.4: the six named notes owner methods. The group is
    // non-enumerable, so a spread copy lacks it and the binding answers an
    // explicit `unsupported`.
    listNotes: platform.notes === undefined ? unsupported('the platform does not publish notes.listNotes')
      : platform.notes.listNotes.bind(platform.notes),
    writeNote: platform.notes === undefined ? unsupported('the platform does not publish notes.writeNote')
      : writeNoteEnvelope,
    withdrawNote: platform.notes === undefined ? unsupported('the platform does not publish notes.withdrawNote')
      : personEntry(platform.notes.withdrawNote.bind(platform.notes)),
    reviewNote: platform.notes === undefined ? unsupported('the platform does not publish notes.reviewNote')
      : personEntry(platform.notes.reviewNote.bind(platform.notes)),
    listPlanVersions: platform.notes === undefined ? unsupported('the platform does not publish notes.listPlanVersions')
      : platform.notes.listPlanVersions.bind(platform.notes),
    listCatalogVersions: platform.notes === undefined ? unsupported('the platform does not publish notes.listCatalogVersions')
      : platform.notes.listCatalogVersions.bind(platform.notes),
    // One explicit wrapper per request command. The route
    // layer owns the person check and the `manual`/`dropped` public surface; the
    // port owns the command rules and returns the receipt/rejection body.
    submitRequest: platform.requestIntake === undefined
      ? unsupported('the platform does not publish the request command owner (submitRequest)')
      : async (ctx, input) => {
        const refusal = requestEntryProblem(ctx, input);
        if (refusal !== null) return refusal;
        return platform.requestIntake!.submitRequest(ctx, input);
      },
    routeRequest: platform.requestIntake === undefined
      ? unsupported('the platform does not publish the request command owner (route)')
      : async (ctx, input) => {
        const refusal = requestEntryProblem(ctx, input);
        if (refusal !== null) return refusal;
        return platform.requestIntake!.route(ctx, input);
      },
    selectRequestIdea: platform.requestIntake === undefined
      ? unsupported('the platform does not publish the request command owner (selectIdea)')
      : async (ctx, input) => {
        const refusal = requestEntryProblem(ctx, input);
        if (refusal !== null) return refusal;
        return platform.requestIntake!.selectIdea(ctx, input);
      },
    askRequest: platform.requestIntake === undefined
      ? unsupported('the platform does not publish the request command owner (ask)')
      : async (ctx, input) => {
        const refusal = requestEntryProblem(ctx, input);
        if (refusal !== null) return refusal;
        return platform.requestIntake!.ask(ctx, input);
      },
    // The two reads of the non-enumerable `mainSurface` owner; a spread copy
    // lacks it and the binding answers an explicit `unsupported`.
    readMainPage: platform.mainSurface === undefined ? unsupported('the platform does not publish mainSurface.readMainPage')
      : platform.mainSurface.readMainPage.bind(platform.mainSurface),
    readRequestView: platform.mainSurface === undefined
      ? unsupported('the platform does not publish mainSurface.readRequestView')
      : platform.mainSurface.readRequestView.bind(platform.mainSurface),
    // The two secretary lifecycle commands. The person's decision is the route's: a member or a system actor is
    // `forbidden` BEFORE the accept owner runs, so no operation is recorded and no line is created. After a real
    // accept the route drives the Workflow's own advance/manualArchive once and answers with its progress read.
    acceptHandoff: platform.sessionHandoff === undefined
      ? unsupported('the platform does not publish the handoff owner (acceptHandoff)')
      : async (ctx, input) => {
        const refusal = lifecycleEntryProblem(ctx, input, 'a handoff');
        if (refusal !== null) return refusal;
        const owner = platform.workflow.sessionHandoff;
        if (owner === undefined) return lifecycleAdvanceMissing;
        const accepted = await platform.sessionHandoff!.acceptHandoff(ctx, {
          commandId: input.commandId, workspace: { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '' },
          source: input.session, trigger: 'manual',
          // The person hands this line to a fresh secretary; the tasks to carry stay empty on this route.
          assignments: [{ target: { kind: 'create', duty: 'secretary' }, tasks: [] }],
        });
        if (accepted.status !== 'committed') return accepted;
        return owner.advance(ctx, { operation: accepted.value.operation });
      },
    acceptArchive: platform.sessionArchive === undefined
      ? unsupported('the platform does not publish the secretary archive owner (acceptArchive)')
      : async (ctx, input) => {
        const refusal = lifecycleEntryProblem(ctx, input, 'a manual archive');
        if (refusal !== null) return refusal;
        const owner = platform.workflow.sessionHandoff;
        if (owner === undefined) return lifecycleAdvanceMissing;
        const accepted = await platform.sessionArchive!.acceptArchive(ctx, {
          commandId: input.commandId, source: input.session, choices: input.choices,
        });
        if (accepted.status !== 'committed') return accepted;
        return owner.manualArchive(ctx, { operation: accepted.value.operation });
      },
    // The Goal service's three card owners; the Host's adoption owner arrives as the sixth argument.
    confirmGoalDraft: personEntry(platform.goals.confirmDraft.bind(platform.goals)),
    readGoalCopyDraft: platform.goals.readGoalCopyDraft.bind(platform.goals),
    confirmGoalCopy: personEntry(platform.goals.confirmGoalCopy.bind(platform.goals)),
    adoptInitialization: initialization === undefined
      ? unsupported('the Host does not publish initialization adoption')
      : personEntry(initialization.adopt.bind(initialization)),
  };
}

/**
 * K3 L21 ruling 4 (D9): after `releaseHold`, the same operator's human
 * `requeueTask` is the "continue" ONLY when the original Run's rework fence is
 * human (`reworkFenceOf(R, pointer)`); every other Task just releases. The
 * request identity derives from the release-hold request, so a re-click after a
 * crash between the two owner calls replays both receipts (L29 row 13).
 */
async function releaseHoldRequeue(
  platform: CoreRoutePlatform, ctx: CoreCallContext,
  request: Parameters<UnknownCallReviewPort['releaseHold']>[1],
  record: UnknownCallReviewV1,
): Promise<UnknownCallReviewReleaseHoldValue['requeue']> {
  // K3 L21 D9 (ruling 4): both owner calls are idempotent on their own identity,
  // and the derived requeue is keyed by `(Task, R)`. Its record-keyed replay read
  // answers BEFORE the fresh pins (which a later Goal control moves) are read, so
  // a re-click restores the original TaskRequeue instead of a fingerprint conflict.
  const task: TaskTriple = record.task;
  const requeueRequestId = 'k3-release-hold-requeue:' + sha256Hex(canonicalJson({
    releaseRequestId: request.meta.requestId, taskRef: task, afterRunRef: record.runRef,
  } as never));
  const replayRead = platform.claims.readTaskRequeueByIdentity;
  if (replayRead !== undefined) {
    const replay = await replayRead.call(platform.claims, ctx, {
      taskRef: task, afterRunRef: record.runRef, requestId: requeueRequestId,
    });
    if (replay.status === 'ready') {
      return { status: 'committed', value: { kind: 'requeued', requeue: replay.value.requeue },
        replayed: true, cursor: replay.value.cursor };
    }
    if (replay.status === 'rejected') return replay;
  }
  const runRead = await platform.executions.readExecution(ctx, record.runRef).catch(() => null);
  // Ruling 4 (K3-41): `null` means "the fence is not human"; a failed or thrown
  // read is the read's own rejection, never absence and never a fence answer.
  if (runRead === null) {
    return { status: 'rejected', code: 'unavailable', reason: 'the original Run could not be read' };
  }
  if (runRead.status !== 'ready') {
    return runRead.status === 'rejected'
      ? { status: 'rejected', code: runRead.code, reason: runRead.reason }
      : { status: 'rejected', code: 'unavailable', reason: `the original Run could not be read (${runRead.status})` };
  }
  const run = runRead.value.run;
  let pointer: ControlIntentSnapshotV1 | null = null;
  const intentRef = run.controlState?.intentRef;
  if (intentRef !== undefined) {
    const intentRead = await platform.controls.readControl(ctx, intentRef);
    if (intentRead.status !== 'ready') {
      return intentRead.status === 'rejected'
        ? { status: 'rejected', code: intentRead.code, reason: intentRead.reason }
        : { status: 'rejected', code: 'unavailable',
          reason: `the original Run control intent could not be read (${intentRead.status})` };
    }
    pointer = intentRead.value;
  }
  if (reworkFenceOf(run, pointer) !== 'human_only') return null;
  const requeue = platform.claims.requeueTask;
  if (requeue === undefined) {
    return { status: 'rejected', code: 'unsupported', reason: 'the Host does not publish the requeue owner' };
  }
  const goalRef = { aggregateType: 'Goal' as const, projectId: task.projectId, goalId: task.goalId };
  const goalRead = await platform.plans.queryGoal(ctx, goalRef);
  if (goalRead.status !== 'ready') {
    return goalRead.status === 'rejected'
      ? { status: 'rejected', code: goalRead.code, reason: goalRead.reason }
      : { status: 'rejected', code: 'unavailable', reason: `the Goal could not be read (${goalRead.status})` };
  }
  const requeueRequest = {
    input: { taskRef: task, afterRunRef: record.runRef, reason: 'continue after the review hold was released' },
    meta: {
      requestId: requeueRequestId,
      expected: [
        { ref: goalRef, revision: goalRead.value.goal.revision },
        { ref: record.runRef, revision: run.revision },
      ],
    },
  };
  return await requeue.call(platform.claims, ctx, requeueRequest as never);
}

/** A returned domain result is a rejection when it carries the closed
 * `status:'rejected'` discriminator. Reads keep that body at HTTP 200; a
 * GraphWrite rejection is re-raised so the server maps its real code onto the
 * HTTP error boundary without changing the body. */
function isRejection(value: unknown): value is CoreRejection {
  return isPlainObject(value) && value['status'] === 'rejected'
    && typeof value['code'] === 'string' && typeof value['reason'] === 'string';
}

/**
 * Explicit per-suffix dispatch. Parsing has already produced the domain
 * argument; `never` inserts the statically-validated value without restating
 * the port parameter type. No dynamic access is performed.
 */
export async function dispatchCoreRoute(
  bindings: CoreRouteBindings,
  suffix: CoreRouteSuffix,
  ctx: CoreCallContext,
  parsed: ParsedCoreRequest,
): Promise<unknown> {
  if (!parsed.ok) throw new CoreRouteRejectionError(parsed.rejection);
  const spec = CORE_ROUTE_SPECS[suffix];
  if (parsed.kind !== spec.kind) {
    throw new CoreRouteRejectionError({
      status: 'rejected', code: 'invalid',
      reason: `${suffix} requires the ${spec.kind} request shape`,
    });
  }
  if (ctx.projectId !== parsed.scope.projectId || ctx.workspaceId !== parsed.scope.workspaceId) {
    throw new CoreRouteRejectionError({
      status: 'rejected', code: 'forbidden',
      reason: 'the resolved call context does not match the request scope',
    });
  }
  // `parsed.kind` was checked against the suffix's spec above; the two views
  // let each explicit arm read its own validated field without a dynamic lookup.
  const graphWrite = parsed as Extract<ParsedCoreRequest, { kind: 'graph_write' }>;
  const plain = parsed as Extract<ParsedCoreRequest, { kind: 'plain' }>;
  const result: unknown = await (async (): Promise<unknown> => {
    switch (suffix) {
      case 'controls/submit': return bindings.submitControl(ctx, graphWrite.request as never);
      case 'controls/read': return bindings.readControl(ctx, plain.input as never);
      case 'controls/deliver': return bindings.deliverControl(ctx, plain.input as never);
      case 'executions/start': return bindings.startRun(ctx, plain.input as never);
      case 'projects/create': return bindings.createProject(ctx, graphWrite.request as never);
      case 'workspaces/register': return bindings.registerWorkspace(ctx, graphWrite.request as never);
      case 'completion-policies/install': return bindings.installCompletionPolicy(ctx, graphWrite.request as never);
      case 'completion-policies/activate': return bindings.activateCompletionPolicy(ctx, graphWrite.request as never);
      case 'completion-policies/read': return bindings.readCurrentCompletionPolicy(ctx, plain.input as never);
      case 'goals/create': return bindings.createGoal(ctx, graphWrite.request as never);
      case 'goals/read': return bindings.queryGoal(ctx, plain.input as never);
      case 'architecture/adopt-initial': return bindings.adoptInitialArchitecture(ctx, graphWrite.request as never);
      case 'architecture/read': return bindings.readArchitectureRevision(ctx, plain.input as never);
      case 'architecture/capture': return bindings.captureArchitectureSource(ctx, graphWrite.request as never);
      case 'architecture/query': return bindings.queryArchitecture(ctx, plain.input as never);
      case 'architecture/compare': return bindings.compareArchitecture(ctx, plain.input as never);
      case 'architecture/compare-formal': return bindings.compareFormalObserved(ctx, plain.input as never);
      case 'architecture/impact': return bindings.queryImpact(ctx, plain.input as never);
      case 'architecture/observation-state': return bindings.observationState(ctx, plain.input as never);
      case 'plans/propose': return bindings.proposePlan(ctx, graphWrite.request as never);
      case 'plans/apply': return bindings.applyPlanChange(ctx, graphWrite.request as never);
      case 'plans/proposal': return bindings.readPlanProposal(ctx, plain.input as never);
      case 'tasks/query': return bindings.queryTaskGraph(ctx, plain.input as never);
      case 'files/read': return bindings.readWorkspace(ctx, plain.input as never);
      case 'source/capture': return bindings.captureWorkspaceSource(ctx, plain.input as never);
      case 'source/query': return bindings.querySource(ctx, plain.input as never);
      case 'sessions/find': return bindings.findSessions(ctx, plain.input as never);
      case 'sessions/read': return bindings.readSession(ctx, plain.input as never);
      case 'sessions/operation': return bindings.getSessionOperation(ctx, plain.input as never);
      case 'runtime/capabilities': return bindings.runtimeCapabilities(ctx, plain.input as never);
      case 'sessions/create': return bindings.createSession(ctx, plain.input as never);
      case 'sessions/history': return bindings.readSessionHistory(ctx, plain.input as never);
      case 'sessions/archive': return bindings.archiveSession(ctx, graphWrite.request as never);
      case 'sessions/reactivate': return bindings.reactivateSession(ctx, graphWrite.request as never);
      case 'sessions/link': return bindings.linkSessionWork(ctx, graphWrite.request as never);
      case 'messages/send': return bindings.sendMessage(ctx, graphWrite.request as never);
      case 'messages/inbox': return bindings.readInbox(ctx, plain.input as never);
      case 'messages/outbox': return bindings.readOutbox(ctx, plain.input as never);
      case 'messages/read': return bindings.readMessage(ctx, plain.input as never);
      case 'messages/body': return bindings.readMessageBody(ctx, plain.input as never);
      case 'messages/release': return bindings.releaseMessage(ctx, graphWrite.request as never);
      case 'messages/withdraw': return bindings.withdrawMessage(ctx, graphWrite.request as never);
      case 'messages/view': return bindings.readMessageView(ctx, plain.input as never);
      case 'messages/inbox-view': return bindings.readInboxView(ctx, plain.input as never);
      case 'workspaces/registration': return bindings.readWorkspaceRegistration(ctx, plain.input as never);
      case 'queries/submit': return bindings.submitQueryJob(ctx, graphWrite.request as never);
      case 'queries/read': return bindings.readQueryJob(ctx, plain.input as never);
      case 'queries/claim': return bindings.claimQuery(ctx, graphWrite.request as never);
      case 'queries/prepare': return bindings.prepareQuery(ctx, plain.input as never);
      case 'queries/start': return bindings.startQuery(ctx, plain.input as never);
      case 'queries/observe': return bindings.observeQuery(ctx, plain.input as never);
      case 'queries/answer': return bindings.readQueryAnswer(ctx, plain.input as never);
      case 'materials/open': return bindings.openArtifact(ctx, plain.input as never);
      case 'workflow/goal-input': return bindings.handleGoalInput(ctx, plain.input as never);
      case 'workflow/advance': return bindings.advanceWork(ctx, plain.input as never);
      case 'workflow/consultation': return bindings.consumeConsultation(ctx, plain.input as never);
      case 'workflow/driver-start': return bindings.driverStart(ctx, plain.input as never);
      case 'workflow/driver-read': return bindings.driverRead(ctx, plain.input as never);
      case 'workflow/driver-stop': return bindings.driverStop(ctx, plain.input as never);
      case 'executions/read': return bindings.readExecution(ctx, plain.input as never);
      case 'executions/history': return bindings.readTaskExecutionHistory(ctx, plain.input as never);
      case 'executions/list': return bindings.listExecutions(ctx, plain.input as never);
      case 'projects/read': return bindings.readProject(ctx, plain.input as never);
      case 'files/save': return bindings.saveWorkspaceFile(ctx, plain.input as never);
      case 'files/list': return bindings.listWorkspaceFiles(ctx, plain.input as never);
      case 'files/compare': return bindings.compareWorkspaceFiles(ctx, plain.input as never);
      case 'commands/start': return bindings.startCommand(ctx, plain.input as never);
      case 'commands/read': return bindings.readCommand(ctx, plain.input as never);
      case 'commands/stop': return bindings.stopCommand(ctx, plain.input as never);
      case 'tasks/requeue': return bindings.requeueTask(ctx, graphWrite.request as never);
      case 'executions/brief': return bindings.readContinuationBrief(ctx, plain.input as never);
      case 'goals/control': return bindings.setGoalControl(ctx, graphWrite.request as never);
      case 'goals/display': return bindings.readGoalDisplay(ctx, plain.input as never);
      case 'executions/resolve-unknown': return bindings.resolveUnknownRun(ctx, graphWrite.request as never);
      case 'queries/resolve-unknown': return bindings.resolveUnknownQueryRun(ctx, graphWrite.request as never);
      case 'host/reconcile-report': return bindings.readReconcileReport(ctx, plain.input as never);
      case 'verification/reverify': return bindings.reverifyRound(ctx, graphWrite.request as never);
      // Slice 1 (spec §4.4): explicit arms, one per new suffix.
      case 'sessions/archive-line': return bindings.archiveLine(ctx, graphWrite.request as never);
      case 'sessions/archive-continue': return bindings.continueArchiveLine(ctx, plain.input as never);
      case 'sessions/archive-release': return bindings.releaseSessionArchiveRequest(ctx, graphWrite.request as never);
      case 'sessions/facts': return bindings.readSessionFacts(ctx, plain.input as never);
      case 'sessions/successors': return bindings.findSessionSuccessors(ctx, plain.input as never);
      case 'sessions/executions': return bindings.listSessionExecutions(ctx, plain.input as never);
      case 'sessions/queries': return bindings.listSessionQueries(ctx, plain.input as never);
      case 'sessions/transfer-responsibility': return bindings.transferSessionResponsibility(ctx, graphWrite.request as never);
      case 'tasks/archive-state': return bindings.readTaskArchiveState(ctx, plain.input as never);
      case 'anomalies/list': return bindings.listSessionAnomalies(ctx, plain.input as never);
      case 'unknown-call-reviews/read': return bindings.readUnknownCallReview(ctx, plain.input as never);
      case 'unknown-call-reviews/list': return bindings.listUnknownCallReviews(ctx, plain.input as never);
      case 'unknown-call-reviews/hold': return bindings.holdUnknownCallReview(ctx, graphWrite.request as never);
      case 'unknown-call-reviews/release-hold': return bindings.releaseUnknownCallReviewHold(ctx, graphWrite.request as never);
      case 'messages/undelivered-replies': return bindings.readUndeliveredReplies(ctx, plain.input as never);
      case 'graph/look': return bindings.lookGraph(ctx, plain.input as never);
      case 'graph/find': return bindings.findGraph(ctx, plain.input as never);
      // Slice 5 §4.5 decision routes.
      case 'goals/settings': return bindings.readGoalSettings(ctx, plain.input as never);
      case 'goals/settings/set': return bindings.setGoalSettings(ctx, graphWrite.request as never);
      case 'goals/reorder': return bindings.reorderGoals(ctx, graphWrite.request as never);
      case 'goals/conflicts': return bindings.queryGoalConflicts(ctx, plain.input as never);
      case 'goals/dispatch-basis': return bindings.readDispatchBasis(ctx, plain.input as never);
      case 'plans/request-candidate': return bindings.readRequestCandidate(ctx, plain.input as never);
      case 'plans/abandon': return bindings.abandonPlanProposal(ctx, graphWrite.request as never);
      case 'decisions/queue': return bindings.queryDecisionQueue(ctx, plain.input as never);
      case 'decisions/card': return bindings.readDecisionCard(ctx, plain.input as never);
      case 'decisions/answer': return bindings.resolveDecision(ctx, graphWrite.request as never);
      case 'decisions/application': return bindings.recordDecisionApplication(ctx, graphWrite.request as never);
      case 'decisions/notices/seen': return bindings.markNoticesSeen(ctx, graphWrite.request as never);
      case 'messages/user-send': return bindings.sendUserMessage(ctx, graphWrite.request as never);
      // Slice 2B L9–L12/L15: the six activity/timeline routes are all plain.
      case 'activity/calendar': return bindings.readActivityCalendar(ctx, plain.input as never);
      case 'activity/runs': return bindings.readRunActivities(ctx, plain.input as never);
      case 'activity/queries': return bindings.readQueryActivities(ctx, plain.input as never);
      case 'activity/track': return bindings.readTrackBars(ctx, plain.input as never);
      case 'tasks/timeline': return bindings.readTaskStateTimeline(ctx, plain.input as never);
      case 'activity/backfill': return bindings.backfillActivityRange(ctx, plain.input as never);
      // Slice 2C (spec §2, L13): the seven line/detail routes.
      case 'lines/list': return bindings.listWorkLines(ctx, plain.input as never);
      case 'lines/archived': return bindings.listArchivedLines(ctx, plain.input as never);
      case 'lines/read': return bindings.readWorkLine(ctx, plain.input as never);
      case 'lines/page': return bindings.readWorkLinePage(ctx, plain.input as never);
      case 'lines/pin': return bindings.setLinePins(ctx, graphWrite.request as never);
      case 'graph/hover': return bindings.readGraphHover(ctx, plain.input as never);
      case 'graph/detail': return bindings.readNodeDetail(ctx, plain.input as never);
      // Slice 4C C1.4: the six notes/version-list routes.
      case 'notes/list': return bindings.listNotes(ctx, plain.input as never);
      case 'notes/write': return bindings.writeNote(ctx, plain.input as never);
      case 'notes/withdraw': return bindings.withdrawNote(ctx, plain.input as never);
      case 'notes/review': return bindings.reviewNote(ctx, plain.input as never);
      case 'plans/versions': return bindings.listPlanVersions(ctx, plain.input as never);
      case 'architecture/versions': return bindings.listCatalogVersions(ctx, plain.input as never);
      // The four person-only request commands.
      case 'requests/submit': return bindings.submitRequest(ctx, plain.input as never);
      case 'requests/route': return bindings.routeRequest(ctx, plain.input as never);
      case 'requests/select-idea': return bindings.selectRequestIdea(ctx, plain.input as never);
      case 'requests/ask': return bindings.askRequest(ctx, plain.input as never);
      case 'main/read': return bindings.readMainPage(ctx, plain.input as never);
      case 'requests/read': return bindings.readRequestView(ctx, plain.input as never);
      // The two secretary lifecycle commands.
      case 'secretaries/handoff': return bindings.acceptHandoff(ctx, plain.input as never);
      case 'secretaries/archive': return bindings.acceptArchive(ctx, plain.input as never);
      // The two Goal-card commands, the copy preview and the initialization adoption.
      case 'goals/confirm-draft': return bindings.confirmGoalDraft(ctx, plain.input as never);
      case 'goals/copy-draft': return bindings.readGoalCopyDraft(ctx, plain.input as never);
      case 'goals/copy-confirm': return bindings.confirmGoalCopy(ctx, plain.input as never);
      case 'initialization/adopt': return bindings.adoptInitialization(ctx, plain.input as never);
    }
  })();
  // A GraphWrite rejection is a failed command: preserve its exact body but let
  // the transport boundary answer with the real status. A plain read/action
  // (including `source/capture`) keeps its original 200 result body.
  if (spec.kind === 'graph_write' && isRejection(result)) throw new CoreRouteRejectionError(result);
  return result;
}
