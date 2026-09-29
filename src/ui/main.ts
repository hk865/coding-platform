/// <reference lib="dom" />
/**
 * R6.1a browser entry for the thin workbench.
 *
 * The page is delivered by the local Host, reads the temporary token from this
 * document's `<meta name="platform-token">`, keeps it in page memory only, and
 * sends it on every bootstrap/core request. It never uses a query string,
 * fragment, `localStorage` or a log to carry the token.
 *
 * The workbench is a persistent layout: the workspace selector, every form and
 * every result area stay mounted. An operation updates only the panel that owns
 * its result (and only while its own workspace is selected), so controls never
 * disappear. State is exactly the page selection, the last original request and
 * the DTOs the Host actually returned; it is never a second business owner.
 *
 * Each async response is written back to the `ScopeState` that issued it, not
 * to whichever workspace is selected when the response arrives. A retry resends
 * the exact frozen body and a replay keeps the original request identity.
 *
 * Default copy is product language; the exact refs/versions/digests, the raw
 * request/receipt and the error code/current live in labeled `<details>`.
 */
import {
  UI_BOOTSTRAP_SUFFIX,
  UI_CORE_API_PREFIX,
  UI_PLATFORM_TOKEN_HEADER,
  UI_PLATFORM_TOKEN_META_NAME,
  escapeHtml,
  executionHistoryMatches,
  reduceWorkbenchLayout,
  renderAdoptedGraph,
  renderFileRead,
  renderGap,
  renderExecutionHistory,
  renderExecutionRecord,
  renderGoalDetail,
  renderInbox,
  renderMessage,
  renderMessageBody,
  planExecutionContinuation,
  renderExecutionProfiles,
  renderInitialPlanning,
  renderObservedGraph,
  renderQueryAnswer,
  renderWorkflowAdvance,
  renderPlanProposal,
  renderRouteResponse,
  renderRuntimeCapabilities,
  renderSessionDetail,
  renderSessionHistoryTimeline,
  renderSessionOperation,
  renderSessionOperationRead,
  renderSessionRoleOptions,
  renderSessionSummary,
  renderSourceCapture,
  renderTaskGraph,
  renderTaskStructure,
  renderTaskExecutionEntry,
  renderWorkLinkTarget,
  renderInitialPlanSetupReview,
  renderArchitectureContainment,
  renderArchitectureDependencies,
  renderFileSave,
  renderProjectConversation,
  renderProjectRead,
  renderTaskExecutionFold,
  renderTaskExecutionTimeline,
  renderWorkspaceComparison,
  renderWorkbenchCommand,
  renderTextDiff,
  taskTimelineRunKey,
} from './views.js';
import type { WorkbenchDraft, WorkbenchDraftReference, WorkbenchExecutionHistoryPage, WorkbenchGraphDisplay, WorkbenchLayout, WorkbenchNodeSelection, WorkbenchTab, ArchitectureContainmentDisplay, ProjectReadState, TaskTimelineDisplay } from './views.js';
import type {
  ArchitectureAdoptInitialResponse,
  ArchitectureReadBody,
  BootstrapExecutionQueryProfile,
  BootstrapResponse,
  BootstrapWorkspace,
  CompletionPoliciesActivateResponse,
  CompletionPoliciesInstallResponse,
  CoreRouteSuffix,
  CoreScope,
  ExecutionsHistoryResponse,
  ExecutionsReadResponse,
  FilesReadResponse,
  GoalsCreateResponse,
  InitialPlanningGoalInputResult,
  MaterialsOpenResponse,
  MessagesBodyResponse,
  MessagesInboxResponse,
  MessagesReadResponse,
  MessagesSendResponse,
  PlansApplyResponse,
  PlansProposeResponse,
  PreparedQueryExecution,
  ProjectsCreateResponse,
  QueriesAnswerBody,
  QueriesAnswerResponse,
  QueriesPrepareResponse,
  QueriesReadResponse,
  QueriesStartResponse,
  QueriesSubmitBody,
  QueriesSubmitResponse,
  QueryExecutionRecord,
  QueryJobAnswerSnapshot,
  QueryJobRef,
  QueryRunRef,
  RoleConfigurationRef,
  RunRef,
  RuntimeCapabilitiesResponse,
  SessionCard,
  SessionRecord,
  SessionRef,
  SessionsCreateResponse,
  SessionsFindResponse,
  SessionsHistoryResponse,
  SessionsOperationResponse,
  SessionsReadResponse,
  SourceCaptureResponse,
  SourceQueryResponse,
  TaskGraph,
  TaskRow,
  WorkflowAdvanceBody,
  WorkflowAdvanceResult,
  WorkflowConsultationBody,
  WorkflowConsultationResponse,
  WorkflowDriverReadResponse,
  WorkflowDriverStartBody,
  WorkflowDriverStartResponse,
  WorkflowDriverStopResponse,
  WorkflowGoalInputBody,
  WorkspacesRegisterResponse,
  WorkspacesRegistrationResponse,
  FilesSaveResponse,
  FilesCompareResponse,
  CommandsStartResponse,
  CommandsReadResponse,
  CommandsStopResponse,
  ExecutionsListResponse,
  ProjectsReadResponse,
  TaskExecutionRecord,
  WorkbenchCommandState,
  WorkspaceVersion,
} from '../app/core-http-types.js';
import type { HostSettingsPort, SettingsProvider, SettingsResponse, SettingsRoute, SettingsRoutes } from '../app/host-settings-types.js';
const SETTINGS_API_PREFIX = '/api/real/settings/';
import {
  createSettingsController,
  groupWorkspacesByProject,
  renderSettingsDialog,
  renderSettingsEntry,
  type SettingsController,
  type SettingsState,
  type SettingsWorkspaceOpened,
} from './settings.js';

type CommittedOf<T> = Extract<T, { status: 'committed' }>;
type ReadyOf<T> = Extract<T, { status: 'ready' }>;
type MessageRefValue = ReadyOf<MessagesReadResponse>['value']['ref'];
type ConsultationInputValue = WorkflowConsultationBody['input'];

/** Attribution captured when a request is built. It lets an async response be
 * written back to the scope AND the Session/message it was actually issued for,
 * even if the user has since selected another scope or Session. */
type WorkLinkTarget = SessionCard['links'][number]['ref']['target'];

type RequestTags = {
  session: SessionRef | null;
  messageRef: MessageRefValue | null;
  part: 'message' | 'response' | null;
  /** Present only for a `sessions/find` driven by a real WorkLinkTarget, so the
   * related-session page never overwrites the project directory page. */
  workTarget: WorkLinkTarget | null;
  /** Present only for an `executions/*` read, so a late run-window response is
   * written back under its exact RunRef and never shown under another Run. */
  run: RunRef | null;
  /** The exact page (scope + captured conversation/layout/tab + object) that
   * issued the request. A response is stored under this key, so returning to an
   * old page keeps its own result/cursor and a late response never lands on
   * another page or re-opens a closed one. */
  pageKey: string | null;
  /** For a related `sessions/find`: the exact includeArchived filter the request
   * was read under. A response read under a no-longer-current filter is dropped. */
  filterIncludeArchived: boolean | null;
  /** For a related `sessions/find`: the original optional role, preserved only
   * when the issued request actually carried one. */
  relatedRole: unknown | null;
  /** True only for a `next-*` center history read whose page must be APPENDED to
   * the page already stored under the same exact scope+Session key. */
  historyNext: boolean;
  historyAfterCursor?: string | null;
  historyGeneration?: number;
};
const noTags: RequestTags = { session: null, messageRef: null, part: null, workTarget: null, run: null,
  pageKey: null, filterIncludeArchived: null, relatedRole: null, historyNext: false };
const tagsFor = (
  session: SessionRef | null,
  messageRef: MessageRefValue | null = null,
  part: 'message' | 'response' | null = null,
  workTarget: WorkLinkTarget | null = null,
  run: RunRef | null = null,
  pageKey: string | null = null,
  historyNext = false,
): RequestTags => ({ session, messageRef, part, workTarget, run, pageKey,
  filterIncludeArchived: null, relatedRole: null, historyNext });
/** Related-target read tags: the exact target, filter and (optional) role. */
const tagsForRelated = (target: WorkLinkTarget, includeArchived: boolean, role: unknown | null): RequestTags =>
  ({ session: null, messageRef: null, part: null, workTarget: target, run: null, pageKey: null,
    filterIncludeArchived: includeArchived, relatedRole: role ?? null, historyNext: false });

type ProjectValue = CommittedOf<ProjectsCreateResponse>['value'];
type WorkspaceValue = CommittedOf<WorkspacesRegisterResponse>['value'];
type PolicyInstallValue = CommittedOf<CompletionPoliciesInstallResponse>['value'];
type PolicyActiveValue = CommittedOf<CompletionPoliciesActivateResponse>['value'];
type GoalValue = CommittedOf<GoalsCreateResponse>['value'];
type AdoptValue = CommittedOf<ArchitectureAdoptInitialResponse>['value'];
type ProposalValue = CommittedOf<PlansProposeResponse>['value'];
type PlanValue = CommittedOf<PlansApplyResponse>['value'];
type CaptureValue = ReadyOf<SourceCaptureResponse>['value'];
type SourcePageValue = ReadyOf<SourceQueryResponse>['value'];
type FileValue = ReadyOf<FilesReadResponse>['value'];
// The browser may only consume the type-only Host HTTP DTO, so these aliases
// derive the exact owner input shapes from the exported route bodies instead of
// importing the business/contract modules directly.
type QueryJobIntentV1 = QueriesSubmitBody['request']['input']['intent'];
type QueryJobAnswerRef = QueriesAnswerBody['input'];
type WorkflowAdvanceInput = WorkflowAdvanceBody['input'];
type InitialPlanningGoalInput = Extract<WorkflowGoalInputBody['input'], { kind: 'planning_answer' | 'adopt_initial_plan' }>;
type PlanningAnswerInput = Extract<InitialPlanningGoalInput, { kind: 'planning_answer' }>;
type AdoptInitialPlanInput = Extract<InitialPlanningGoalInput, { kind: 'adopt_initial_plan' }>;

type Forms = {
  projectId: string;
  goalId: string;
  objective: string;
  filePath: string;
  proposalId: string;
  baselineId: string;
  baselineRevision: string;
  provider: string;
  prefix: string;
  policyIndex: string;
  architectureIndex: string;
  planIndex: string;
  readVersion: string;
  archSelection: string;
  sessionRoleIndex: string;
  messageText: string;
  question: string;
  taskId: string;
  commandLine: string;
  commandCwd: string;
  /** Explicit ADVANCED paste/import of a user-reviewed
   * `AdoptInitialArchitectureInput` JSON. Empty by default; this page never
   * fabricates or infers a default architecture. */
  architectureDraft: string;
};

/** The complete Session aggregate ref the owner returned; the claim expected set
 * must carry it exactly, never a truncated { projectId, sessionId }. */
type SessionAggregateRef = SessionRecord['ref'];

/** One exact public request this page sent, with its memoized outcome. The list
 * is the in-page retry/replay buffer: a retry resumes at the failed call instead
 * of rebuilding the flow or refreshing any identity. It is not persisted. */
type ExecutionRequestCall = {
  route: CoreRouteSuffix;
  request: unknown;
  outcome: CallOutcome | null;
};

/** A continuation the page may still send: either an unsent owner `next` or a
 * waiting initial-plan adoption kept for an explicit later resend. */
type ExecutionIntent =
  | { route: 'workflow/goal-input'; input: InitialPlanningGoalInput }
  | { route: 'workflow/advance'; input: WorkflowAdvanceInput };

type ExecutionDriver = (scope: ScopeState, run: ExecutionRun) => Promise<void>;

/** R6 execution-entry display/consumer state. It holds only the exact requests
 * this page actually sent and the owner results it received. It is not a second
 * Workflow/Query owner: the next public request comes from the frozen
 * continuation seam and a null `next` is a real stop. Every identity is fixed
 * before the first await; later navigation never rewrites an in-flight run. */
type ExecutionRun = {
  running: boolean;
  kind: 'investigate' | 'planning' | 'continue' | null;
  flowId: string | null;
  /** Captured from the initiating scope BEFORE the first await. */
  scope: CoreScope | null;
  goalRef: { aggregateType: 'Goal'; projectId: string; goalId: string } | null;
  question: string;
  profile: BootstrapExecutionQueryProfile | null;
  selectedSession: SessionRef | null;
  /** Explicit Task selection for the Workflow driver; null keeps the default. */
  taskId: string | null;
  /** Real records/versions the owners returned. */
  sessionRef: SessionAggregateRef | null;
  sessionRevision: number | null;
  queryJobRef: QueryJobRef | null;
  queryRunRef: QueryRunRef | null;
  jobRevision: number | null;
  runRevision: number | null;
  goalRead: unknown;
  registration: WorkspacesRegistrationResponse | null;
  answer: QueriesAnswerResponse | null;
  body: MaterialsOpenResponse | null;
  planning: InitialPlanningGoalInputResult | null;
  planningRequest: unknown;
  advance: WorkflowAdvanceResult | null;
  advanceRequest: unknown;
  /** The proposed candidate receipt, preserved even when adoption later waits. */
  candidate: unknown | null;
  /** In-page transport retry/resume; never a persistent queue. */
  calls: ExecutionRequestCall[];
  callIndex: number;
  /** Index of the unconfirmed call, and the first index of the active driver. */
  pendingIndex: number | null;
  driverStart: number;
  requestIds: Record<string, string>;
  pending: { route: CoreRouteSuffix; request: unknown } | null;
  resumeIntent: ExecutionIntent | null;
  resumeCount: number;
  driver: ExecutionDriver | null;
  phase: string | null;
  notice: string | null;
  error: string | null;
  /** Positively-read original QueryRun of the displayed Session. It is only a
   * display/action candidate: it never starts or claims anything by itself. */
  resumable: ResumableOriginalRun | null;
};

function createExecutionRun(): ExecutionRun {
  return {
    running: false, kind: null, flowId: null, scope: null, goalRef: null, question: '',
    profile: null, selectedSession: null, taskId: null, sessionRef: null, sessionRevision: null,
    queryJobRef: null, queryRunRef: null, jobRevision: null, runRevision: null,
    goalRead: null, registration: null, answer: null, body: null,
    planning: null, planningRequest: null, advance: null, advanceRequest: null, candidate: null,
    calls: [], callIndex: 0, pendingIndex: null, driverStart: 0, requestIds: {}, pending: null, resumeIntent: null,
    resumeCount: 0, driver: null, phase: null, notice: null, error: null, resumable: null,
  };
}

/** MVP new-Goal cold-start driver. It freezes every generated identity and
 * generated request body before the first await, so a retry resends the exact
 * original body instead of rebuilding an id or guessing a revision. */
type GoalSetupRun = {
  running: boolean;
  objective: string;
  goalId: string;
  requestIds: Record<string, string>;
  calls: ExecutionRequestCall[];
  callIndex: number;
  pendingIndex: number | null;
  pending: { route: CoreRouteSuffix; request: unknown } | null;
  driver: ((scope: ScopeState, run: GoalSetupRun) => Promise<void>) | null;
  project: { ref: unknown; revision: number } | null;
  workspace: { ref: unknown; revision: number } | null;
  goal: unknown | null;
  step: string | null;
  error: string | null;
  notice: string | null;
};

/**
 * Goal-conversation start seam (Stage 1 skeleton, expected red).
 *
 * A first explicit Send in a newly opened workspace must freeze its originating
 * scope and the exact question + references, create the formal Goal exactly once,
 * and only then continue the EXISTING `runExecution(scope, 'investigate')` path
 * when a query profile exists. With no profile it keeps the created Goal and the
 * original draft, offers `选择模型并开始调查`, and never claims a conversation
 * started. Opening/saving settings alone never calls the model. A later draft or
 * scope change must not rewrite the frozen request or leak it across scopes.
 *
 * The SAME controller owns the explicit recovery of an already-occupied original
 * Session: its persisted `occupancy`/`lastExecutionRef` already names a QueryRun,
 * and the formal `queries/read(QueryJobRef)` returns the job/run whose
 * `run.run.executionState.phase` is `claimed` or `prepared`. Recovery re-reads the
 * CURRENT profile for the ORIGINAL scope, verifies the returned run/session and
 * the persisted phase, and then continues `prepare -> start -> answer/history` on
 * that SAME run/session. It never creates a Goal/Session, never submits or claims
 * a fresh Query and never clears occupancy. `entering`/`entered`/`unknown`/
 * `settled` (or an absent phase) must NOT restart: the seam only reads and
 * reports the real state. An already-occupied Session is the valid input; there
 * is no idle precondition.
 *
 * Every field below is derived from the real DTOs (`SessionRecord`,
 * `QueriesReadResponse`/`QueryJobRecord`/`QueryRunSnapshot`/
 * `QueryExecutionStateV1`, `PreparedQueryExecution`, `QueryExecutionRecord`) via
 * `core-http-types`; no shape is invented. The controller is DOM-free and takes
 * the EXISTING operations by injection, so tests pin the contract without
 * booting the browser entry. Stage 1 fixes only the seam and its red tests: every
 * behavior entry fails explicitly until the Stage 2 implementation is approved.
 * No new owner/manager is introduced.
 */

/** The fresh profile gate. Only the identity + consumer id are read; the full
 * `BootstrapExecutionQueryProfile` stays owned by the existing run path. */
export type GoalConversationStartProfile = Pick<BootstrapExecutionQueryProfile, 'id' | 'consumerId'>;

export type GoalConversationStartRequest = {
  origin: CoreScope;
  objective: string;
  question: string;
  references: WorkbenchDraftReference[];
  /** First-Send snapshot only. Explicit start/resume re-reads the CURRENT
   * bootstrap profile for the original scope. */
  profileId: string | null;
  /** Frozen recipient intent captured BEFORE the first await. Absent keeps the
   * live selection for an explicit existing action. */
  fromMain?: boolean;
  /** Exact member Session selected at Send, or null for the main conversation. */
  selectedSession?: SessionRef | null;
};

/** The exact `queries/read(QueryJobRef)` projection the seam verifies: the real
 * `QueryRunSnapshot.ref` plus the persisted `executionState.phase`/`sessionRef`.
 * A `null` executionState is a historical claim and never authorizes a restart. */
type QueryReadJobValue = Extract<QueriesReadResponse, { status: 'ready' }>['value'];
type PersistedQueryExecutionState = NonNullable<QueryReadJobValue['run']['run']['executionState']>;
export type GoalConversationStartOriginalRun = {
  runRef: QueryReadJobValue['run']['ref'];
  executionState: Pick<PersistedQueryExecutionState, 'phase' | 'sessionRef'> | null;
};

/** The exact `queries/start` projection: the SAME run/session plus the optional
 * answer ref, picked from the real `QueryExecutionRecord`. */
export type GoalConversationStartStartResult = {
  runRef: QueryExecutionRecord['run']['ref'];
  sessionRef: QueryExecutionRecord['session']['ref'];
  answerRef: QueryJobAnswerSnapshot['ref'] | null;
  /** Narrow run facts for a truthful no-answer report, derived directly from the
   * returned `QueryExecutionRecord` (`QueryRunV1.outcome`/`status` and
   * `executionState.phase`). Optional so a caller that has a real answer keeps
   * the minimal projection. */
  outcome?: QueryExecutionRecord['run']['run']['outcome'];
  phase?: NonNullable<QueryExecutionRecord['run']['run']['executionState']>['phase'] | null;
  status?: QueryExecutionRecord['run']['run']['status'];
};

/** The truthful reading of a Query run that persisted NO answer. The values are
 * the real returned `QueryRunV1` fields: a formally ended run (non-null
 * `outcome`, or a `settled` phase/`closed` status) is never shown as waiting,
 * and nothing is inferred beyond the returned facts. */
function queryNoAnswerNotice(run: {
  outcome: QueryExecutionRecord['run']['run']['outcome'];
  phase: NonNullable<QueryExecutionRecord['run']['run']['executionState']>['phase'] | null;
  status?: QueryExecutionRecord['run']['run']['status'] | undefined;
}): string {
  if (run.outcome !== null) {
    return `调查已结束（${run.outcome}），没有产生正式回答；可查看原调查事实，不会重新开始。`;
  }
  if (run.phase === 'settled' || run.status === 'closed') {
    return '调查已结束，没有产生正式回答；可查看原调查事实，不会重新开始。';
  }
  return '调查已受理但尚未产生正式回答；可点击“刷新执行状态”查看原调查。';
}

/** The original Session fields used to discover the already-occupied QueryRun:
 * the real `SessionRecord.occupancy` / `lastExecutionRef`. */
export type GoalConversationStartSessionRefs = Pick<SessionRecord, 'occupancy' | 'lastExecutionRef'>;

export type GoalConversationStartDeps = {
  /** Existing `goals/create` cold-start driver; called at most once per Send. */
  createGoal: (input: { origin: CoreScope; objective: string }) => Promise<string>;
  /** Existing `runExecution(scope, 'investigate')` path for a NEW run. It gets
   * the frozen origin scope, question and references and returns the bound main
   * Session. It is never used by the recovery path. */
  continueInvestigation: (input: { origin: CoreScope; goalId: string; profileId: string;
    question: string; references: WorkbenchDraftReference[];
    fromMain?: boolean; selectedSession?: SessionRef | null }) => Promise<{ sessionRef: SessionRef | null }>;
  /** Existing `sessions/history` read for the exact Session (the first-Send main
   * Session or the already-occupied original Session). */
  readHistory: (sessionRef: SessionRef) => Promise<void>;
  /** Existing model/workspace settings surface. Opening/saving it never calls
   * the model, so it never triggers `continueInvestigation`. */
  openSettings: () => void;
  /** CURRENT bootstrap profile for the ORIGINAL scope; re-read on every explicit
   * start/resume so a profile chosen after the first Send is honored. */
  lookupProfile: (origin: CoreScope) => GoalConversationStartProfile | null;
  /** Existing `queries/read` exact read keyed by the ORIGINAL QueryJobRef. */
  readQueryJob: (queryJobRef: QueryJobRef) => Promise<GoalConversationStartOriginalRun>;
  /** Existing `queries/prepare` on the SAME original run. */
  prepareQuery: (queryRunRef: QueryRunRef, requestId: string) => Promise<PreparedQueryExecution>;
  /** Existing `queries/start` on the SAME prepared original run. */
  startQuery: (input: { prepared: PreparedQueryExecution; consumerId: string;
    requestId: string }) => Promise<GoalConversationStartStartResult>;
  /** Existing `queries/answer` read for the SAME run. */
  readAnswer: (answerRef: QueryJobAnswerSnapshot['ref']) => Promise<void>;
};

export type GoalConversationStartStatus =
  | 'idle' | 'creating' | 'needs_profile' | 'investigating' | 'started'
  | 'recovering' | 'recovered' | 'observe_only' | 'unavailable' | 'failed';

export type GoalConversationStartSnapshot = {
  status: GoalConversationStartStatus;
  origin: CoreScope | null;
  objective: string;
  question: string;
  references: WorkbenchDraftReference[];
  goalId: string | null;
  /** Frozen recipient intent, preserved for an explicit missing-profile start. */
  fromMain: boolean;
  selectedSession: SessionRef | null;
  /** Actionable composer copy; null unless the Goal awaits a profile choice. */
  action: '选择模型并开始调查' | null;
  notice: string | null;
};

export type GoalConversationStartController = {
  snapshot(): GoalConversationStartSnapshot;
  /** The first explicit Send (the single Goal + optional follow-up). */
  begin(request: GoalConversationStartRequest): Promise<void>;
  /** Explicit `开始调查` on an existing Goal, even with no Session yet. It uses
   * the FRESH profile lookup, never the first-Send snapshot. */
  startInvestigation(): Promise<void>;
  /** Explicit resume of an already claimed/prepared ORIGINAL QueryRun on its
   * already-occupied Session. */
  resumeOriginal(queryRunRef: QueryRunRef, sessionRef: SessionRef): Promise<void>;
  /** Opens the existing settings (model/workspace selection). */
  openModelSettings(): void;
};

/** The original QueryRun an already-occupied Session owns, read from the exact
 * `SessionRecord` fields. Occupancy wins over `lastExecutionRef`; a non-QueryRun
 * execution ref (a Work Run) is not this seam's target. */
export function goalConversationQueryRunRef(session: GoalConversationStartSessionRefs): QueryRunRef | null {
  const occupied = session.occupancy;
  const candidate = occupied !== null && occupied.kind === 'execution' ? occupied.executionRef : session.lastExecutionRef;
  return candidate !== null && candidate.aggregateType === 'QueryRun' ? candidate : null;
}

/** The positively-read original QueryRun of one displayed Session. Only a ready
 * `queries/read` whose returned run and `executionState.sessionRef` match the
 * original scope/Session produces this value; it is a display/action candidate,
 * never a permission to start. */
export type ResumableOriginalRun = {
  session: SessionRef;
  queryRunRef: QueryRunRef;
  phase: NonNullable<GoalConversationStartOriginalRun['executionState']>['phase'];
};

/** Same QueryRun identity (aggregate + scope + job + run), never a title. */
function sameQueryRunRef(left: QueryRunRef, right: QueryRunRef): boolean {
  return left.aggregateType === right.aggregateType && left.projectId === right.projectId
    && left.workspaceId === right.workspaceId && left.queryJobId === right.queryJobId && left.runId === right.runId;
}

function queryJobRefOf(queryRunRef: QueryRunRef): QueryJobRef {
  return { aggregateType: 'QueryJob', projectId: queryRunRef.projectId,
    workspaceId: queryRunRef.workspaceId, queryJobId: queryRunRef.queryJobId };
}

/** The CURRENT bootstrap profile for an explicit target scope. Unlike
 * `selectedExecutionProfile`, it is not tied to the currently selected scope. */
function executionProfileForScope(scope: ScopeState, target: CoreScope): BootstrapExecutionQueryProfile | null {
  const profiles = (bootstrapState?.execution.queryProfiles ?? []).filter(profile =>
    profile.scope.projectId === target.projectId && profile.scope.workspaceId === target.workspaceId);
  if (profiles.length === 0) return null;
  return profiles.find(profile => profile.id === scope.executionProfileId) ?? profiles[0] ?? null;
}

/** Stage 2 seam factory. It drives the EXISTING GoalSetupRun/ExecutionRun
 * pipelines and keeps only the frozen first-Send intent plus the positively-read
 * recovery candidate. It is not a second owner and introduces no new store. */
export function createGoalConversationStart(deps: GoalConversationStartDeps): GoalConversationStartController {
  const state: GoalConversationStartSnapshot = {
    status: 'idle', origin: null, objective: '', question: '', references: [], goalId: null,
    fromMain: true, selectedSession: null, action: null, notice: null,
  };
  const cloneReferences = (references: WorkbenchDraftReference[]): WorkbenchDraftReference[] =>
    references.map(reference => ({ ...reference }));
  const uniqueRequestId = (key: string): string => `${key}-${freshRequestId(key)}`;

  const begin = async (request: GoalConversationStartRequest): Promise<void> => {
    // Singleflight is set synchronously before the first await, so a double
    // click can never create a second Goal or a second Query.
    if (state.status === 'creating' || state.status === 'investigating') return;
    if (state.goalId !== null && state.status !== 'failed') return;
    const origin = { ...request.origin };
    const question = request.question;
    const references = cloneReferences(request.references);
    // Freeze the recipient intent from THIS Send: a later member selection in
    // the same scope must not reroute the original main conversation.
    const fromMain = request.fromMain ?? (request.selectedSession === undefined || request.selectedSession === null);
    const selectedSession = request.selectedSession === undefined || request.selectedSession === null
      ? null : { ...request.selectedSession };
    state.origin = { ...origin };
    state.objective = request.objective;
    state.question = question;
    state.references = cloneReferences(references);
    state.fromMain = fromMain;
    state.selectedSession = selectedSession === null ? null : { ...selectedSession };
    state.goalId = null;
    state.action = null;
    state.notice = null;
    state.status = 'creating';
    let goalId: string;
    try {
      goalId = await deps.createGoal({ origin: { ...origin }, objective: request.objective });
    } catch (error) {
      state.status = 'failed';
      state.notice = `创建目标失败：${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    state.goalId = goalId;
    // The first-Send snapshot decides only the IMMEDIATE continuation; explicit
    // later start/resume always re-reads the CURRENT bootstrap for the scope.
    if (request.profileId === null) {
      state.status = 'needs_profile';
      state.action = '选择模型并开始调查';
      state.notice = '目标已创建；当前工作区没有可用的模型/调查配置。';
      return;
    }
    state.status = 'investigating';
    try {
      await deps.continueInvestigation({ origin, goalId, profileId: request.profileId,
        question, references: cloneReferences(references), fromMain,
        selectedSession: selectedSession === null ? null : { ...selectedSession } });
    } catch (error) {
      state.status = 'failed';
      state.notice = `开始调查失败：${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    state.status = 'started';
  };

  const startInvestigation = async (): Promise<void> => {
    if (state.status === 'creating' || state.status === 'investigating') return;
    if (state.goalId === null || state.origin === null) {
      state.status = 'unavailable';
      state.notice = '没有可开始调查的已创建目标。';
      return;
    }
    const origin = { ...state.origin };
    // Explicit start re-reads the CURRENT bootstrap profile for the ORIGINAL
    // scope; the first-Send null snapshot is never reused.
    const profile = deps.lookupProfile(origin);
    if (profile === null) {
      state.status = 'needs_profile';
      state.action = '选择模型并开始调查';
      state.notice = '当前工作区仍没有可用的模型/调查配置。';
      return;
    }
    state.status = 'investigating';
    state.action = null;
    try {
      await deps.continueInvestigation({ origin, goalId: state.goalId, profileId: profile.id,
        question: state.question, references: cloneReferences(state.references),
        fromMain: state.fromMain,
        selectedSession: state.selectedSession === null ? null : { ...state.selectedSession } });
    } catch (error) {
      state.status = 'failed';
      state.notice = `开始调查失败：${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    state.status = 'started';
    state.notice = null;
  };

  const resumeOriginal = async (queryRunRef: QueryRunRef, sessionRef: SessionRef): Promise<void> => {
    if (state.status === 'recovering') return;
    const origin: CoreScope = { projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId };
    state.origin = { ...origin };
    state.status = 'recovering';
    state.notice = null;
    state.action = null;
    // Profile gate FIRST. An already-occupied Session never needs to be idle,
    // but continuation does need a CURRENT profile for the original scope.
    const profile = deps.lookupProfile(origin);
    if (profile === null) {
      state.status = 'needs_profile';
      state.action = '选择模型并开始调查';
      state.notice = '当前工作区没有可用的模型/调查配置，无法继续准备原调查。';
      return;
    }
    let read: GoalConversationStartOriginalRun;
    try {
      read = await deps.readQueryJob(queryJobRefOf(queryRunRef));
    } catch (error) {
      state.status = 'unavailable';
      state.notice = `读取原调查失败：${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    const persisted = read.executionState;
    if (!sameQueryRunRef(read.runRef, queryRunRef)
      || persisted === null || !sameSession(persisted.sessionRef, sessionRef)) {
      state.status = 'unavailable';
      state.notice = '原调查的运行或会话身份与当前会话不一致，不能继续。';
      return;
    }
    if (persisted.phase !== 'claimed' && persisted.phase !== 'prepared') {
      state.status = 'observe_only';
      state.notice = `原调查已进入 ${persisted.phase}，只能读取事实，不能重新开始。`;
      return;
    }
    let started: GoalConversationStartStartResult;
    try {
      const prepared = await deps.prepareQuery(read.runRef, uniqueRequestId('queries-prepare'));
      started = await deps.startQuery({ prepared, consumerId: profile.consumerId,
        requestId: uniqueRequestId('queries-start') });
    } catch (error) {
      state.status = 'failed';
      state.notice = `继续准备原调查失败：${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    if (!sameQueryRunRef(started.runRef, queryRunRef) || !sameSession(started.sessionRef, sessionRef)) {
      state.status = 'unavailable';
      state.notice = '继续准备返回了不同的运行或会话，已停止且未重试。';
      return;
    }
    try {
      if (started.answerRef !== null) await deps.readAnswer(started.answerRef);
      await deps.readHistory(sessionRef);
    } catch (error) {
      state.status = 'failed';
      state.notice = `读取原调查结果失败：${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    state.status = 'recovered';
    state.notice = started.answerRef !== null
      ? '已在原会话继续准备原调查。'
      : queryNoAnswerNotice({ outcome: started.outcome ?? null, phase: started.phase ?? null, status: started.status });
  };

  return {
    snapshot: () => ({ ...state, origin: state.origin === null ? null : { ...state.origin },
      references: state.references.map(reference => ({ ...reference })),
      selectedSession: state.selectedSession === null ? null : { ...state.selectedSession } }),
    begin,
    startInvestigation,
    resumeOriginal,
    openModelSettings: () => deps.openSettings(),
  };
}

/** The EXISTING operations the narrow controller drives for THIS scope. Every
 * member maps onto GoalSetupRun/ExecutionRun and the same HTTP routes. */
function goalConversationStartDeps(scope: ScopeState): GoalConversationStartDeps {
  const targetScopeOf = (ref: { projectId: string; workspaceId: string }): CoreScope =>
    ({ projectId: ref.projectId, workspaceId: ref.workspaceId });
  const readyValue = <T>(outcome: CallOutcome, label: string): T => {
    if (outcome.kind === 'network') throw new Error(outcome.reason);
    const payload = outcome.payload as { status?: unknown; code?: unknown; reason?: unknown; value?: T };
    if (payload.status !== 'ready') throw new Error(`${label}未就绪：${outcomeRejectionReason(payload)}`);
    return payload.value as T;
  };
  return {
    createGoal: async ({ objective }) => {
      const before = scope.goal?.ref.goalId ?? null;
      scope.goalObjective = objective;
      await runGoalSetup(scope);
      const after = scope.goal?.ref.goalId ?? null;
      if (after === null || after === before) {
        throw new Error(scope.goalSetup?.error ?? scope.error ?? '创建目标未完成，请查看已发送的原请求。');
      }
      return after;
    },
    continueInvestigation: async ({ goalId, question, fromMain, selectedSession }) => {
      // The frozen question/references AND recipient intent are handed to the
      // EXISTING run, never re-read from the live composer/selection; the draft
      // and the selected member may have changed meanwhile.
      scope.forms.goalId = goalId;
      scope.forms.question = question;
      saveScopeDisplay(scope);
      await runExecution(scope, 'investigate', { fromMain: fromMain ?? true,
        selectedSession: selectedSession == null ? null : { ...selectedSession } });
      if (scope.execution.error !== null) throw new Error(scope.execution.error);
      if (scope.mainSession === null) {
        throw new Error(scope.execution.notice ?? '调查未绑定会话，原请求已保留。');
      }
      return { sessionRef: scope.mainSession };
    },
    readHistory: async sessionRef => {
      const key = centerSessionHistoryKey(sessionRef);
      await submit(scope, 'sessions/history',
        buildSessionHistoryRequest(scope.config.scope, sessionRef, null, false, CENTER_HISTORY_LIMIT),
        tagsFor(sessionRef, null, null, null, null, key));
    },
    openSettings: () => { void settingsController.open('models'); },
    lookupProfile: origin => {
      const profile = executionProfileForScope(scope, origin);
      return profile === null ? null : { id: profile.id, consumerId: profile.consumerId };
    },
    readQueryJob: async queryJobRef => {
      const outcome = await callCore('queries/read', { scope: targetScopeOf(queryJobRef), input: queryJobRef });
      const value = readyValue<{ run: QueryReadJobValue['run'] }>(outcome, '调查读取');
      const persisted = value.run.run.executionState;
      return { runRef: value.run.ref, executionState: persisted === undefined ? null
        : { phase: persisted.phase, sessionRef: persisted.sessionRef } };
    },
    prepareQuery: async (queryRunRef, requestId) => {
      const outcome = await callCore('queries/prepare', {
        scope: targetScopeOf(queryRunRef), input: { queryRunRef, requestId } });
      return readyValue<PreparedQueryExecution>(outcome, '调查准备');
    },
    startQuery: async ({ prepared, consumerId, requestId }) => {
      const outcome = await callCore('queries/start', {
        scope: targetScopeOf(prepared.queryRunRef),
        input: { prepared, consumerId, requestId } });
      const value = readyValue<QueryExecutionRecord>(outcome, '调查启动');
      return { runRef: value.run.ref, sessionRef: value.session.ref,
        answerRef: value.answer === null ? null : value.answer.ref,
        outcome: value.run.run.outcome,
        phase: value.run.run.executionState?.phase ?? null,
        status: value.run.run.status };
    },
    readAnswer: async answerRef => {
      const target = targetScopeOf(answerRef);
      const outcome = await callCore('queries/answer', { scope: target, input: answerRef });
      if (outcome.kind === 'network') throw new Error(outcome.reason);
      const payload = payloadOf(outcome) as QueriesAnswerResponse;
      scope.execution.answer = payload;
      if (payload.status !== 'ready') throw new Error(`调查回答未就绪：${outcomeRejectionReason(payload)}`);
      const bodyRead = await callCore('materials/open', { scope: target, input: {
        ref: payload.value.answer.bodyRef, usage: 'historical_explanation' } });
      if (bodyRead.kind === 'response') scope.execution.body = payloadOf(bodyRead) as MaterialsOpenResponse;
    },
  };
}

/** Read-only probe: only a positively-read claimed/prepared original QueryRun of
 * the displayed Session becomes a resumable candidate. It never prepares,
 * starts, claims or clears occupancy; a read error or another phase clears it. */
async function probeResumableOriginal(scope: ScopeState, sessionRef: SessionRef, card: SessionCard): Promise<void> {
  const clear = (): void => {
    if (scope.execution.resumable !== null && sameSession(scope.execution.resumable.session, sessionRef)) {
      scope.execution.resumable = null;
      renderScopeIfSelected(scope);
    }
  };
  const original = goalConversationQueryRunRef(card.record);
  if (original === null) { clear(); return; }
  const outcome = await callCore('queries/read', { scope: { projectId: original.projectId,
    workspaceId: original.workspaceId }, input: queryJobRefOf(original) });
  // A late response may only update the scope+Session still displayed.
  if (!sameSession(scope.mainSession, sessionRef) && !sameSession(scope.activeSession, sessionRef)) return;
  if (outcome.kind !== 'response') { clear(); return; }
  const payload = payloadOf(outcome) as QueriesReadResponse;
  const persisted = payload.status === 'ready' ? payload.value.run.run.executionState : undefined;
  if (payload.status !== 'ready' || !sameQueryRunRef(payload.value.run.ref, original)
    || !sameSession(persisted?.sessionRef ?? null, sessionRef)) { clear(); return; }
  scope.execution.resumable = persisted === undefined ? null
    : { session: sessionRef, queryRunRef: original, phase: persisted.phase };
  renderScopeIfSelected(scope);
}

/** One real Kernel command handle kept alive per tab. Hiding/switching tabs does
 * not cancel it; only an explicit stop does, and the stop waits for the real
 * settled snapshot. */
type CommandTabState = {
  commandId: string;
  command: string;
  cwd: string;
  requestId: string;
  result: CommandsReadResponse | null;
  state: WorkbenchCommandState | 'starting';
  poll: ReturnType<typeof setInterval> | null;
  stopping: boolean;
};

/** The bounded real Run page shared by the timeline, the Task fold and the
 * execution-backed active-module computation. It is a read cache only. */
type ExecutionListCache = {
  goalRef: TaskGraph['plan']['goalRef'];
  items: TaskExecutionRecord[];
  nextCursor: string | null;
  readThrough: unknown;
  loading: boolean;
  error: string | null;
};

/** The exact one-shot member mail this page saved and then consulted, keyed by
 * the original Session + message ref. Display state only. */
type MemberMailState = {
  session: SessionRef;
  messageRef: MessageRefValue;
  /** The exact frozen send body, kept for an explicit retry that replays it. */
  request: unknown | null;
  /** The composer conversation the draft was sent from (main or member). */
  draftKey: string;
  submittedDraft: string;
  profile: BootstrapExecutionQueryProfile | null;
  goalId: string | null;
  /** 'failed' = transport unknown, replay the SAME request; 'rejected' = a
   * confirmed owner rejection, the draft is kept and a corrected NEW send is
   * allowed instead of resending an invalid body. */
  sendState: 'saving' | 'saved' | 'failed' | 'rejected';
  consultState: 'idle' | 'running' | 'waiting' | 'responded' | 'processed' | 'ended' | 'rejected';
  consultation: WorkflowConsultationResponse | null;
  note: string | null;
};

type ScopeState = {
  key: string;
  config: BootstrapWorkspace;
  project: ProjectValue | null;
  workspace: WorkspaceValue | null;
  policyInstall: PolicyInstallValue | null;
  policyActive: PolicyActiveValue | null;
  goal: GoalValue | null;
  adopted: AdoptValue | null;
  proposal: ProposalValue | null;
  plan: PlanValue | null;
  observedCapture: unknown | null;
  goalRead: unknown;
  /** R6 cold-start: the setup candidate recovered from the CURRENT Goal pending
   * candidate's origin.answerRef (or the current planning Answer). It is the
   * ONLY adoption source; history is never one. */
  planCandidate: InitialPlanSetupCandidate | null;
  proposalRead: unknown;
  architectureRead: unknown;
  taskGraph: unknown;
  observed: unknown;
  capture: CaptureValue | null;
  sourcePage: SourcePageValue | null;
  /** Decoupled directory inventory, one local projection per exact prefix. */
  directories: Map<string, DirectoryInventoryState>;
  file: FileValue | null;
  // R6.1b-1 typed Session/inbox/history consumers. Every read result is stored
  // with the exact Session/message it was requested for, so an async response
  // can never be shown under a later selection. No private DTO copy and no
  // second business owner.
  sessionFind: SessionsFindResponse | null;
  sessionRead: { session: SessionRef; result: SessionsReadResponse } | null;
  sessionCreateReceipt: SessionsCreateResponse | null;
  sessionOperationRead: SessionsOperationResponse | null;
  runtimeCapabilities: RuntimeCapabilitiesResponse | null;
  inbox: { session: SessionRef; result: MessagesInboxResponse } | null;
  message: { session: SessionRef; messageRef: MessageRefValue; result: MessagesReadResponse } | null;
  messageBody: { session: SessionRef; messageRef: MessageRefValue; part: 'message' | 'response'; result: MessagesBodyResponse } | null;
  /** The last explicit `workflow/consultation` result for the exact message it
   * was issued for. Display state only; it is not a second Query/Workflow owner. */
  consultation: { session: SessionRef; messageRef: MessageRefValue; result: WorkflowConsultationResponse } | null;
  /** Opened Session-history pages keyed by scope + captured conversation/layout
   * + page (center or tab) + exact SessionRef. The center and each auxiliary
   * history/session tab keep their own result and original cursor. */
  historyGenerations: Map<string, number>;
  sessionHistories: Map<string, { session: SessionRef; result: SessionsHistoryResponse }>;
  /** Opened Run-window pages keyed by scope + captured conversation/layout + the
   * typed execution tab. Refresh/pagination overwrite only this page's latest
   * real read result (ready or not). */
  executionHistories: Map<string, WorkbenchExecutionHistoryPage>;
  /** The exact `executions/read` facts per opened execution page. The claim
   * Session is used only from a ready record; display state only. */
  executionReads: Map<string, { run: RunRef; result: ExecutionsReadResponse }>;
  activeSession: SessionRef | null;
  mainSession: SessionRef | null;
  mainSessionRead: { session: SessionRef; result: SessionsReadResponse } | null;
  /** Display-only restore progress for this scope: idle/running/done. */
  displayRestore: 'idle' | 'running' | 'done';
  activeMessage: MessageRefValue | null;
  // R6 UI-layout display state. The auxiliary TABS are project-shared (one pane
  // for the whole project, so switching members never loses them); the composer
  // DRAFT is per recipient. Neither writes back into Session/Task.
  auxTabs: WorkbenchTab[];
  auxActiveTabId: string | null;
  drafts: Map<string, WorkbenchDraft>;
  sessionIncludeArchived: boolean;
  architectureReadSelection: string;
  taskGraphGoalId: string;
  /** The current related-target list, stored with the exact target, filter and
   * optional role it was read under. A new failure replaces the old ready page;
   * a result read under a no-longer-current filter is dropped, not relabelled. */
  relatedSessions: { target: WorkLinkTarget; includeArchived: boolean; role: unknown | null;
    result: SessionsFindResponse } | null;
  /** R6 execution-entry display state: the selected safe Query profile plus the
   * real owner results and requests. It is display state only and never a second
   * continuation owner. */
  executionProfileId: string | null;
  executionNotice: string | null;
  execution: ExecutionRun;
  /** The last read-only Host collaboration snapshot for this scope's Goal. It is
   * display state only: the page never drives the Workflow itself and never
   * stops the background driver by hiding the panel. */
  collaboration: { goalRef: NonNullable<ExecutionRun['goalRef']>; result: WorkflowDriverReadResponse } | null;
  /** The page's read-only polling timer; it never cancels the Host driver. */
  collaborationPoll: ReturnType<typeof setInterval> | null;
  /** Monotone epoch of the current Goal/poll: a late response for an older Goal
   * can never overwrite the panel or clear a newer timer. */
  collaborationEpoch: number;
  /** The Goal whose official TaskGraph/Goal was already synced once. */
  collaborationSyncedGoal: string | null;
  forms: Forms;
  sending: boolean;
  pending: { route: CoreRouteSuffix; body: unknown; tags: RequestTags } | null;
  lastRequest: { route: CoreRouteSuffix; body: unknown; tags: RequestTags } | null;
  lastResponse: { route: CoreRouteSuffix; payload: unknown } | null;
  conflict: { route: CoreRouteSuffix; current: unknown[] } | null;
  notice: string | null;
  error: string | null;
  /** The narrow goal-conversation start controller for THIS scope. It reuses
   * GoalSetupRun/ExecutionRun and their HTTP pipelines; it is not a second owner. */
  goalConversation: GoalConversationStartController;
  /** MVP UI connection display/consumer state. */
  projectReadState: ProjectReadState;
  goalObjective: string;
  goalSetup: GoalSetupRun | null;
  executionList: ExecutionListCache | null;
  commands: Map<string, CommandTabState>;
  compareResults: Map<string, FilesCompareResponse>;
  saveResults: Map<string, FilesSaveResponse>;
  timeline: TaskTimelineDisplay;
  containment: ArchitectureContainmentDisplay;
  memberMail: MemberMailState | null;
  historyFold: boolean;
  compareForm: { beforeKind: 'working_tree' | 'git' | 'capture'; beforeCommit: string; beforeCapture: string;
    afterKind: 'working_tree' | 'git' | 'capture'; afterCommit: string; afterCapture: string; prefix: string };
};

const GRAPH_WRITE_ROUTES = new Set<CoreRouteSuffix>([
  'controls/submit',
  'projects/create', 'workspaces/register', 'completion-policies/install',
  'completion-policies/activate', 'goals/create', 'architecture/adopt-initial',
  'architecture/capture', 'plans/propose', 'plans/apply', 'messages/send',
  'queries/submit', 'queries/claim',
]);

const ROUTE_LABELS: Record<CoreRouteSuffix, string> = {
  'controls/submit': '提交控制', 'controls/read': '查看控制事实', 'controls/deliver': '投递控制', 'executions/start': '继续原执行',
  'projects/create': '创建项目',
  'workspaces/register': '登记工作区',
  'completion-policies/install': '安装完成策略',
  'completion-policies/activate': '启用完成策略',
  'completion-policies/read': '查看当前完成策略',
  'goals/create': '创建目标',
  'goals/read': '查看目标',
  'architecture/adopt-initial': '采用初始架构',
  'architecture/read': '查看采用架构',
  'architecture/capture': '捕获观察结构',
  'architecture/query': '查看观察结构',
  'plans/propose': '提交计划草案',
  'plans/apply': '采用计划',
  'plans/proposal': '查看计划草案',
  'tasks/query': '查看任务图',
  'files/read': '读取文件',
  'source/capture': '捕获来源',
  'source/query': '列出文件',
  'sessions/find': '查看会话',
  'sessions/read': '查看会话详情',
  'sessions/operation': '刷新创建状态',
  'runtime/capabilities': '查看 Runtime 能力',
  'sessions/create': '创建会话',
  'sessions/history': '查看原历史',
  'sessions/archive': '归档会话',
  'sessions/reactivate': '重新启用会话',
  'sessions/link': '关联工作',
  'messages/send': '发送消息',
  'messages/inbox': '查看收件箱',
  'messages/read': '查看消息',
  'messages/body': '查看消息正文',
  'messages/outbox': '查看发送记录',
  'workspaces/registration': '查看项目/工作区登记',
  'queries/submit': '提交调查',
  'queries/read': '查看调查',
  'queries/claim': '领取调查',
  'queries/prepare': '准备调查',
  'queries/start': '开始调查',
  'queries/observe': '刷新调查状态',
  'queries/answer': '查看调查回答',
  'materials/open': '读取材料',
  'workflow/goal-input': '提交规划输入',
  'workflow/advance': '推进执行',
  'workflow/consultation': '处理咨询',
  'workflow/driver-start': '启动协同推进',
  'workflow/driver-read': '查看协同推进',
  'workflow/driver-stop': '停止协同推进',
  'executions/read': '查看执行事实',
  'executions/history': '查看本次执行原历史',
  // MVP UI connection suffixes. These are display labels only; the Stage-2 UI
  // wiring owns the real actions and is intentionally NOT implemented here.
  'executions/list': '查看执行列表',
  'projects/read': '查看项目',
  'files/list': '列出目录',
  'files/save': '保存文件',
  'files/compare': '比较文件',
  'commands/start': '运行命令',
  'commands/read': '查看命令输出',
  'commands/stop': '停止命令',
};

// Node/UI tests import this module for its exported seam; only a real browser
// document boots the entry. The guard changes nothing in the browser.
const app = typeof document === 'undefined' ? null : document.getElementById('app');
const token = typeof document === 'undefined' ? '' : readToken();
const states = new Map<string, ScopeState>();
let bootstrapState: BootstrapResponse | null = null;
let selectedKey = '';
let requestCounter = 0;

function readToken(): string {
  const meta = document.querySelector(`meta[name="${UI_PLATFORM_TOKEN_META_NAME}"]`);
  return meta?.getAttribute('content')?.trim() ?? '';
}

const scopeKey = (scope: CoreScope): string => JSON.stringify([scope.projectId, scope.workspaceId]);
const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const shown = (value: unknown): string => value === undefined || value === null ? '' : escapeHtml(value);
const routeLabel = (route: CoreRouteSuffix): string => ROUTE_LABELS[route];

/** Same Session identity (project + session), never a second registry. */
const sameSession = (left: SessionRef | null, right: SessionRef | null): boolean =>
  left !== null && right !== null && left.projectId === right.projectId && left.sessionId === right.sessionId;

/** The mailbox and Session owner accept the PLAIN `{projectId, sessionId}` ref;
 * an aggregate ref from a create/read is normalized here, never loosened. */
const plainSessionRef = (ref: SessionRef): SessionRef => ({ projectId: ref.projectId, sessionId: ref.sessionId });

/** Same Run identity (aggregate/project/goal/run), never a title or tabId. */
const sameRun = (left: RunRef, right: RunRef): boolean =>
  left.aggregateType === right.aggregateType && left.projectId === right.projectId
  && left.goalId === right.goalId && left.runId === right.runId;

/** Exact page key for one opened Session-history page. Scope is the owning
 * ScopeState; the captured conversation/layout + page discriminator (center or
 * tab) + exact SessionRef keep the center and every auxiliary tab separate. */
const sessionHistoryPageKey = (page: string, session: SessionRef): string =>
  `session-history|${page}|${session.projectId}/${session.sessionId}`;

/** Exact page key for one opened execution page: the captured conversation/layout
 * plus the typed execution tab (whose tabId already carries the complete RunRef). */
const executionPageKey = (tabId: string): string => `execution|${tabId}`;

/** Same persisted message address, so a body/read result only renders for the
 * message the user actually selected. */
const sameMessage = (left: MessageRefValue, right: MessageRefValue): boolean =>
  left.projectId === right.projectId && left.workspaceId === right.workspaceId && left.messageId === right.messageId;

function state(): ScopeState {
  const current = states.get(selectedKey);
  if (current === undefined) throw new Error('the workbench has no selected scope');
  return current;
}

function review(): BootstrapResponse['review'] {
  return bootstrapState?.review ?? null;
}

type ReviewMaterial = NonNullable<BootstrapResponse['review']>;
type ReviewPolicies = NonNullable<ReviewMaterial['policies']>;
type ReviewGoals = NonNullable<ReviewMaterial['goals']>;
type ReviewArchitectures = NonNullable<ReviewMaterial['architectures']>;
type ReviewPlans = NonNullable<ReviewMaterial['plans']>;

function reviewPolicies(): ReviewPolicies { return review()?.policies ?? []; }
function reviewGoals(): ReviewGoals { return review()?.goals ?? []; }
function reviewArchitectures(): ReviewArchitectures { return review()?.architectures ?? []; }
function reviewPlans(): ReviewPlans { return review()?.plans ?? []; }
function reviewSessionRoles(): NonNullable<ReviewMaterial['sessionRoles']> { return review()?.sessionRoles ?? []; }

function selectedIndex(raw: string, length: number): number {
  const value = Number.parseInt(raw, 10);
  return Number.isSafeInteger(value) && value >= 0 && value < length ? value : 0;
}

function freshRequestId(route: string): string {
  requestCounter += 1;
  return `r6-${route.replaceAll('/', '-')}-${Date.now().toString(36)}-${requestCounter.toString(36)}`;
}

// ---------------------------------------------------------------------------
// Host transport
// ---------------------------------------------------------------------------

type CallOutcome =
  | { kind: 'response'; status: number; payload: unknown }
  | { kind: 'network'; reason: string };

async function callCore(route: CoreRouteSuffix, body: unknown): Promise<CallOutcome> {
  try {
    const response = await fetch(UI_CORE_API_PREFIX + route, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [UI_PLATFORM_TOKEN_HEADER]: token },
      body: JSON.stringify(body),
    });
    const payload: unknown = await response.json().catch(() => null);
    return { kind: 'response', status: response.status, payload };
  } catch (error) {
    return { kind: 'network', reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Only the issuing workspace is re-rendered; a response for a workspace the
 * user has navigated away from still updates that workspace's state and is
 * shown when the user returns to it. */
function renderScopeIfSelected(scope: ScopeState): void {
  if (scope.key === selectedKey) renderAll();
}

async function submit(scope: ScopeState, route: CoreRouteSuffix, body: unknown, tags: RequestTags = noTags): Promise<void> {
  if (route === 'sessions/history' && tags.session !== null && tags.pageKey === centerSessionHistoryKey(tags.session)) {
    const after = record(record(body).input).afterCursor;
    const afterCursor = typeof after === 'string' ? after : null;
    const generation = (scope.historyGenerations.get(tags.pageKey) ?? 0) + (afterCursor === null ? 1 : 0);
    scope.historyGenerations.set(tags.pageKey, generation);
    tags = { ...tags, historyNext: afterCursor !== null, historyAfterCursor: afterCursor, historyGeneration: generation };
  }
  scope.pending = { route, body, tags };
  scope.sending = true;
  scope.error = null;
  scope.notice = null;
  renderScopeIfSelected(scope);

  const outcome = await callCore(route, body);
  if (tags.historyGeneration !== undefined && tags.pageKey !== null
    && scope.historyGenerations.get(tags.pageKey) !== tags.historyGeneration) return;
  if (tags.historyGeneration !== undefined && tags.historyNext && tags.pageKey !== null) {
    const previous = scope.sessionHistories.get(tags.pageKey);
    if (previous?.result.status !== 'ready' || !matchesHistoryAppendCursor(previous.result, tags.historyAfterCursor)) return;
  }
  scope.sending = false;
  if (outcome.kind === 'network') {
    scope.error = '连接中断，未收到回执。可重新发送原请求（内容保持不变）。';
    renderScopeIfSelected(scope);
    return;
  }
  if (outcome.status === 403) {
    scope.error = '连接已失效，请刷新页面重新连接。未完成的写操作不会自动重发。';
    renderScopeIfSelected(scope);
    return;
  }
  scope.pending = null;
  scope.lastRequest = { route, body, tags };
  scope.lastResponse = { route, payload: outcome.payload };
  applyResult(scope, route, outcome.payload, tags);
  renderScopeIfSelected(scope);
}

function applyResult(scope: ScopeState, route: CoreRouteSuffix, payload: unknown, tags: RequestTags): void {
  const envelope = record(payload);
  if (envelope.status === 'committed') scope.conflict = null;
  if (envelope.status === 'rejected' && GRAPH_WRITE_ROUTES.has(route)) {
    if (envelope.code === 'revision_conflict' || envelope.code === 'idempotency_conflict') {
      scope.conflict = { route, current: list(envelope.current) };
    }
  }
  switch (route) {
    case 'projects/create': if (envelope.status === 'committed') scope.project = envelope.value as ProjectValue; break;
    case 'workspaces/register': if (envelope.status === 'committed') scope.workspace = envelope.value as WorkspaceValue; break;
    case 'completion-policies/install': if (envelope.status === 'committed') scope.policyInstall = envelope.value as PolicyInstallValue; break;
    case 'completion-policies/activate': if (envelope.status === 'committed') scope.policyActive = envelope.value as PolicyActiveValue; break;
    case 'goals/create': if (envelope.status === 'committed') scope.goal = envelope.value as GoalValue; break;
    case 'architecture/adopt-initial': if (envelope.status === 'committed') scope.adopted = envelope.value as AdoptValue; break;
    case 'plans/propose': if (envelope.status === 'committed') scope.proposal = envelope.value as ProposalValue; break;
    case 'plans/apply': if (envelope.status === 'committed') scope.plan = envelope.value as PlanValue; break;
    case 'architecture/capture': if (envelope.status === 'committed') scope.observedCapture = envelope.value; break;
    case 'goals/read': {
      scope.goalRead = payload;
      const detail = record(envelope.value);
      const goalRef = record(record(detail.goal).ref);
      if (typeof goalRef.goalId === 'string' && scope.forms.goalId.trim().length === 0) {
        scope.forms.goalId = goalRef.goalId;
        saveScopeDisplay(scope);
      }
      const pending = detail.pendingPlan === null || detail.pendingPlan === undefined ? null : record(detail.pendingPlan);
      const pendingRef = pending === null ? {} : record(pending.ref);
      if (typeof pendingRef.proposalId === 'string' && scope.forms.proposalId.trim().length === 0) scope.forms.proposalId = pendingRef.proposalId;
      break;
    }
    case 'plans/proposal': scope.proposalRead = payload; break;
    case 'architecture/read': {
      scope.architectureRead = payload;
      scope.architectureReadSelection = architectureSelectionKeyOf(scope.lastRequest?.body);
      const baseline = record(record(envelope.value).baseline);
      if (typeof baseline.baselineId === 'string') scope.forms.baselineId = baseline.baselineId;
      if (typeof baseline.revision === 'number') scope.forms.baselineRevision = String(baseline.revision);
      break;
    }
    case 'tasks/query': {
      scope.taskGraph = payload;
      scope.taskGraphGoalId = taskGoalIdOf(scope.lastRequest?.body);
      break;
    }
    case 'architecture/query': scope.observed = payload; break;
    case 'source/capture':
      if (envelope.status === 'ready') { scope.capture = envelope.value as CaptureValue; scope.sourcePage = null; }
      break;
    case 'source/query': if (envelope.status === 'ready') scope.sourcePage = envelope.value as SourcePageValue; break;
    case 'files/read': if (envelope.status === 'ready') scope.file = envelope.value as FileValue; break;
    case 'sessions/find':
      if (tags.workTarget !== null) {
        // Related target list: keep the exact filter it was read under. A
        // response whose filter is no longer current is dropped (never shown or
        // continued under the new condition); a newer result, including a real
        // failure, replaces the old ready page for the same target + filter.
        if (tags.filterIncludeArchived === scope.sessionIncludeArchived) {
          scope.relatedSessions = { target: tags.workTarget,
            includeArchived: tags.filterIncludeArchived ?? scope.sessionIncludeArchived,
            role: tags.relatedRole, result: payload as SessionsFindResponse };
        }
      } else if (envelope.status === 'ready') {
        scope.sessionFind = payload as SessionsFindResponse;
      }
      break;
    case 'sessions/read': {
      // Store THIS read's result even when it is rejected/not_ready/not_found, so
      // a failed refresh can never leave the previous ready detail in place.
      const session = tags.session ?? (envelope.status === 'ready' ? sessionRefFromCard(envelope.value) : null);
      if (session !== null) {
        const read = { session, result: payload as SessionsReadResponse };
        if (sameSession(scope.mainSession, session)) scope.mainSessionRead = read;
        if (!sameSession(scope.mainSession, session) || sameSession(scope.activeSession, session)) scope.sessionRead = read;
        // A read-only probe: it may only offer 继续准备调查, never prepare/start.
        if (read.result.status === 'ready') void probeResumableOriginal(scope, session, read.result.value);
      }
      break;
    }
    case 'sessions/operation':
      scope.sessionOperationRead = payload as SessionsOperationResponse;
      break;
    case 'runtime/capabilities':
      scope.runtimeCapabilities = payload as RuntimeCapabilitiesResponse;
      break;
    case 'sessions/create': {
      scope.sessionCreateReceipt = payload as SessionsCreateResponse;
      if (envelope.status === 'completed') {
        const selected = sessionRefFromRecord(envelope.value);
        if (selected !== null) selectSession(scope, selected);
      }
      break;
    }
    case 'messages/inbox':
      if (envelope.status === 'ready' && tags.session !== null) scope.inbox = { session: tags.session, result: payload as MessagesInboxResponse };
      break;
    case 'messages/read':
      if (envelope.status === 'ready' && tags.session !== null && tags.messageRef !== null)
        scope.message = { session: tags.session, messageRef: tags.messageRef, result: payload as MessagesReadResponse };
      break;
    case 'messages/body':
      if (envelope.status === 'ready' && tags.session !== null && tags.messageRef !== null && tags.part !== null)
        scope.messageBody = { session: tags.session, messageRef: tags.messageRef, part: tags.part, result: payload as MessagesBodyResponse };
      break;
    case 'sessions/history': {
      if (tags.session !== null && tags.pageKey !== null) {
        if (tags.historyGeneration !== undefined
          && scope.historyGenerations.get(tags.pageKey) !== tags.historyGeneration) break;
        const previous = scope.sessionHistories.get(tags.pageKey);
        const page = envelope.status === 'ready'
          ? payload as Extract<SessionsHistoryResponse, { status: 'ready' }> : null;
        if (tags.historyNext) {
          // A next page may extend only the exact cursor captured when sent.
          if (previous === undefined || !sameSession(previous.session, tags.session)
            || previous.result.status !== 'ready'
            || !matchesHistoryAppendCursor(previous.result, tags.historyAfterCursor)) break;
          if (page === null) {
            scope.error = `历史继续加载失败：${typeof envelope.reason === 'string' ? envelope.reason : String(envelope.status ?? '未知结果')}`;
            break;
          }
          const entryKey = (item: typeof page.value.items[number]): string =>
            JSON.stringify([item.source.adapterId, item.source.kernelSessionId, item.source.position, item.recordId]);
          const seen = new Set(previous.result.value.items.map(entryKey));
          const items = [...previous.result.value.items];
          for (const item of page.value.items) {
            const key = entryKey(item);
            if (!seen.has(key)) { seen.add(key); items.push(item); }
          }
          scope.sessionHistories.set(tags.pageKey, { session: tags.session,
            result: { status: 'ready', value: { ...page.value, items } } });
        } else {
          scope.sessionHistories.set(tags.pageKey, { session: tags.session, result: payload as SessionsHistoryResponse });
        }
      }
      break;
    }
    case 'workflow/consultation':
      if (tags.session !== null && tags.messageRef !== null)
        scope.consultation = { session: tags.session, messageRef: tags.messageRef, result: payload as WorkflowConsultationResponse };
      break;
    case 'executions/read':
      if (tags.run !== null && tags.pageKey !== null)
        scope.executionReads.set(tags.pageKey, { run: tags.run, result: payload as ExecutionsReadResponse });
      break;
    case 'executions/history':
      if (tags.run !== null && tags.pageKey !== null)
        scope.executionHistories.set(tags.pageKey,
          { scope: scope.config.scope, run: tags.run, result: payload as ExecutionsHistoryResponse });
      break;
  }
}

// ---------------------------------------------------------------------------
// Request builders (one concrete body, built fresh per explicit operation)
// ---------------------------------------------------------------------------

function pinOf(value: { ref: unknown; revision: number }): { ref: unknown; revision: number } {
  return { ref: value.ref, revision: value.revision };
}

function buildProjectRequest(): unknown | null {
  const current = state();
  const scope = current.config.scope;
  const projectId = current.forms.projectId.trim() || scope.projectId;
  const projectRef = { aggregateType: 'Project', projectId: scope.projectId };
  return { scope, request: { input: { projectId }, meta: {
    requestId: freshRequestId('projects/create'), expected: [{ ref: projectRef, revision: 0 }] } } };
}

function buildWorkspaceRequest(): unknown | null {
  const current = state();
  if (current.project === null) return null;
  const scope = current.config.scope;
  const workspaceRef = { aggregateType: 'Workspace', projectId: scope.projectId, workspaceId: scope.workspaceId };
  return { scope, request: { input: { workspace: scope }, meta: {
    requestId: freshRequestId('workspaces/register'), expected: [pinOf(current.project), { ref: workspaceRef, revision: 0 }] } } };
}

function buildPolicyInstallRequest(): unknown | null {
  const current = state();
  if (current.project === null) return null;
  const policies = reviewPolicies();
  const policy = policies[selectedIndex(current.forms.policyIndex, policies.length)];
  if (policy === undefined) return null;
  const scope = current.config.scope;
  const revisionRef = { aggregateType: 'CompletionPolicyRevision', projectId: scope.projectId, policyId: policy.policyId, revision: policy.contentRevision };
  return { scope, request: { input: { policyId: policy.policyId, contentRevision: policy.contentRevision, content: policy.content },
    meta: { requestId: freshRequestId('completion-policies/install'), expected: [pinOf(current.project), { ref: revisionRef, revision: 0 }] } } };
}

function buildPolicyActivateRequest(): unknown | null {
  const current = state();
  if (current.project === null || current.policyInstall === null) return null;
  const scope = current.config.scope;
  const activeRef = { aggregateType: 'ProjectCompletionPolicyActive', projectId: scope.projectId };
  return { scope, request: { input: { target: { ref: current.policyInstall.ref, digest: current.policyInstall.contentDigest } },
    meta: { requestId: freshRequestId('completion-policies/activate'), expected: [pinOf(current.project), { ref: activeRef, revision: 0 }] } } };
}

function buildGoalRequest(): unknown | null {
  const current = state();
  if (current.project === null || current.workspace === null) return null;
  const scope = current.config.scope;
  const fallback = reviewGoals()[0];
  const goalId = current.forms.goalId.trim() || current.goal?.ref.goalId || fallback?.goalId || '';
  const objective = current.forms.objective.trim() || current.goal?.objective || fallback?.objective || '';
  if (goalId.length === 0 || objective.length === 0) { current.error = '请填写目标 ID 与目标内容。'; return null; }
  return { scope, request: { input: { goalId, workspace: scope, objective },
    meta: { requestId: freshRequestId('goals/create'), expected: [pinOf(current.project), pinOf(current.workspace)] } } };
}

function buildAdoptRequest(): unknown | null {
  const current = state();
  if (current.project === null || current.workspace === null) return null;
  const architectures = reviewArchitectures();
  const architecture = architectures[selectedIndex(current.forms.architectureIndex, architectures.length)];
  if (architecture === undefined) return null;
  const scope = current.config.scope;
  return { scope, request: { input: architecture,
    meta: { requestId: freshRequestId('architecture/adopt-initial'), expected: [pinOf(current.project), pinOf(current.workspace)] } } };
}

/** Minimal JSON parse for the explicit ADVANCED architecture draft. The Plan /
 * Architecture owner still owns every domain check; this page only reports that
 * the pasted text is not JSON. */
function parseArchitectureDraft(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try { return { ok: true, value: JSON.parse(raw) }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}

/** The actual parsed candidate the user would submit, behind a disclosure. It
 * never executes or adopts the input by itself and shows no fabricated sample. */
function architectureDraftPreview(raw: string): string {
  if (raw.trim().length === 0)
    return '<p class="muted">尚未粘贴初始架构输入；仅点击“采用粘贴的初始架构”才会提交。</p>';
  const parsed = parseArchitectureDraft(raw);
  if (!parsed.ok) return `<p class="error">JSON 解析失败：${escapeHtml(parsed.error)}</p>`;
  return detailsBlock('查看将提交的实际输入', `<pre>${escapeHtml(JSON.stringify(parsed.value, null, 2))}</pre>`);
}

/** Adopt the user's explicitly pasted, already-reviewed initial architecture
 * through the SAME `architecture/adopt-initial` route and submit/retry handling
 * as the trusted candidate. The draft text and parsed input are captured before
 * the first await; when this scope has no Project/Workspace pin yet (fresh or
 * reopened page), the action reads the real registration projection instead of
 * guessing a revision. It never infers modules from source or a plan. */
async function adoptArchitectureDraft(scope: ScopeState): Promise<void> {
  const parsed = parseArchitectureDraft(scope.forms.architectureDraft);
  if (!parsed.ok) {
    scope.error = `初始架构 JSON 解析失败：${parsed.error}`;
    renderScopeIfSelected(scope);
    return;
  }
  const input = parsed.value;
  const target = scope.config.scope;
  if (scope.project === null || scope.workspace === null) {
    const read = await callCore('workspaces/registration', { scope: target, input: target });
    if (read.kind === 'network') {
      scope.error = `项目/工作区登记读取失败：${read.reason}`;
      renderScopeIfSelected(scope);
      return;
    }
    if (read.status === 403) {
      scope.error = '连接已失效，请刷新页面重新连接。';
      renderScopeIfSelected(scope);
      return;
    }
    const registration = record(read.payload);
    if (registration.status !== 'ready') {
      scope.error = `项目/工作区登记未就绪（${shown(registration.status)}）：不会猜测版本，也不采用。`;
      renderScopeIfSelected(scope);
      return;
    }
    const value = record(registration.value);
    scope.project = value.project as ProjectValue;
    scope.workspace = value.workspace as WorkspaceValue;
  }
  const project = scope.project;
  const workspace = scope.workspace;
  if (project === null || workspace === null) {
    scope.error = '项目/工作区登记缺少正式版本，无法采用初始架构。';
    renderScopeIfSelected(scope);
    return;
  }
  const body = { scope: target, request: { input, meta: {
    requestId: freshRequestId('architecture/adopt-initial'), expected: [pinOf(project), pinOf(workspace)] } } };
  await submit(scope, 'architecture/adopt-initial', body);
}

function buildProposeRequest(): unknown | null {
  const current = state();
  if (current.goal === null) return null;
  const plans = reviewPlans();
  const plan = plans[selectedIndex(current.forms.planIndex, plans.length)];
  if (plan === undefined) return null;
  const scope = current.config.scope;
  const goalRef = { aggregateType: 'Goal', projectId: scope.projectId, goalId: current.goal.ref.goalId };
  return { scope, request: { input: { goalRef, basedOn: null, draft: plan.draft, reason: { text: plan.reasonText, sources: [] } },
    meta: { requestId: freshRequestId('plans/propose'), expected: [] } } };
}

function buildApplyRequest(): unknown | null {
  const current = state();
  if (current.proposal === null) return null;
  const scope = current.config.scope;
  return { scope, request: { input: { proposalRef: current.proposal.ref, expectedProposalRevision: current.proposal.revision, decisionRefs: [] },
    meta: { requestId: freshRequestId('plans/apply'), expected: [] } } };
}

function buildGoalReadRequest(): unknown | null {
  const current = state();
  const goalId = current.forms.goalId.trim() || current.goal?.ref.goalId || reviewGoals()[0]?.goalId || '';
  if (goalId.length === 0) return null;
  return { scope: current.config.scope, input: { aggregateType: 'Goal', projectId: current.config.scope.projectId, goalId } };
}

function buildProposalReadRequest(): unknown | null {
  const current = state();
  const proposalId = current.forms.proposalId.trim();
  if (proposalId.length === 0) return null;
  const scope = current.config.scope;
  return { scope, input: { aggregateType: 'PlanProposal', projectId: scope.projectId, workspaceId: scope.workspaceId, proposalId } };
}

function buildArchitectureReadRequest(): unknown | null {
  const current = state();
  const scope = current.config.scope;
  if (current.forms.archSelection === 'revision') {
    const baselineId = current.forms.baselineId.trim();
    const revision = Number.parseInt(current.forms.baselineRevision, 10);
    if (baselineId.length === 0 || !Number.isSafeInteger(revision) || revision < 1) return null;
    return { scope, input: { selection: { kind: 'revision', ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: scope.projectId, baselineId, revision } } } };
  }
  return { scope, input: { selection: { kind: 'current' } } };
}

function buildObservedCaptureRequest(): unknown | null {
  const current = state();
  if (current.project === null || current.workspace === null || current.adopted === null) return null;
  const modules = current.adopted.catalog === null ? [] : current.adopted.catalog.catalog.modules;
  if (modules.length === 0) return null;
  const mappings = modules.map(module => ({ id: module.ref.moduleId, kind: 'module' as const, paths: module.paths }));
  const scope = current.config.scope;
  return { scope, request: { input: { workspace: scope, mappings, previous: current.observedCapture },
    meta: { requestId: freshRequestId('architecture/capture'), expected: [pinOf(current.project), pinOf(current.workspace)] } } };
}

function buildObservedQueryRequest(): unknown | null {
  const current = state();
  if (current.observedCapture === null) return null;
  return { scope: current.config.scope, input: {
    selection: { kind: 'observed', capture: current.observedCapture },
    depth: 1, relations: ['dependency'], page: { limit: 50 } } };
}

function buildTasksQueryRequest(): unknown | null {
  const current = state();
  const goalId = current.forms.goalId.trim() || current.goal?.ref.goalId || reviewGoals()[0]?.goalId || '';
  if (goalId.length === 0) return null;
  return { scope: current.config.scope, input: { goalRef: { aggregateType: 'Goal', projectId: current.config.scope.projectId, goalId } } };
}

function buildSourceCaptureRequest(): unknown | null {
  const current = state();
  const scope = current.config.scope;
  const workspaceRef = { aggregateType: 'Workspace', projectId: scope.projectId, workspaceId: scope.workspaceId };
  const prefix = current.forms.prefix.trim();
  return { scope, input: { workspace: workspaceRef, workspaceRevision: current.config.workspaceRevision, provider: current.forms.provider,
    ...(prefix.length === 0 ? {} : { prefix }) } };
}

function buildSourceQueryRequest(next: boolean): unknown | null {
  const current = state();
  if (current.capture === null) return null;
  const prefix = current.forms.prefix.trim();
  const cursor = next ? current.sourcePage?.nextCursor ?? null : null;
  if (next && cursor === null) return null;
  return { scope: current.config.scope, input: { capture: current.capture.ref,
    query: { kind: 'paths', ...(prefix.length === 0 ? {} : { prefix }) }, cursor, limit: 10 } };
}

// ---------------------------------------------------------------------------
// UI-directory-inventory: bounded path enumeration decoupled from text capture.
//
// The ordinary file tree must not depend on a `source/capture`: `files/list`
// enumerates bounded paths (a binary or oversized member is listed by path) and
// the page keeps its OWN local projection per exact scope+prefix. It never mixes
// with the formal `source/query` page and never calls `source/capture`. A reply
// is attributed by the scope+generation frozen before the request, so a stale
// reply can never overwrite a newer refresh or another prefix.
// ---------------------------------------------------------------------------
export type DirectoryInventoryState = {
  /** The exact scope the listing was requested under (frozen before the await). */
  scope: CoreScope;
  /** The exact directory prefix this list belongs to; '' is the workspace root. */
  prefix: string;
  /** The request generation last issued for this scope+prefix. */
  generation: number;
  paths: string[];
  partial: boolean;
  /** Local display window over `paths`; "show more" grows it by one page. */
  visibleCount: number;
  loading: boolean;
  error: string | null;
  /** A failed refresh keeps this PREFIX's previous paths and marks them stale. */
  stale: boolean;
  loaded: boolean;
};

export type DirectoryInventoryReply =
  | { status: 'ready'; value: { paths: string[]; partial: boolean } }
  | { status: 'rejected'; code: string; reason?: string };

export type DirectoryInventorySend = (
  request: { scope: CoreScope; prefix: string; generation: number },
) => Promise<DirectoryInventoryReply>;

/** The fixed local page size of "show more"; it is a display window over one
 * already-enumerated list, never a server cursor or a second cache. */
export const DIRECTORY_INVENTORY_PAGE_SIZE = 100;

/**
 * The real directory-inventory entry. It freezes the exact scope+prefix+request
 * generation before the first await and stores the pending state under its own
 * prefix, so:
 *   - opening a NEW prefix creates its own list instead of being rejected
 *     against an older prefix;
 *   - a same-prefix refresh bumps the generation, so every older in-flight reply
 *     is discarded when it finally lands;
 *   - only a failure keeps the previous list, flagged stale under its own
 *     scope+prefix, and never blends a different prefix into it.
 * It issues no request when a loaded list is opened again without `refresh`.
 */
export async function ensureDirectory(
  directories: Map<string, DirectoryInventoryState>,
  scope: CoreScope,
  prefix: string,
  refresh: boolean,
  send: DirectoryInventorySend,
): Promise<DirectoryInventoryState | null> {
  const previous = directories.get(prefix) ?? null;
  if (!refresh && previous !== null && previous.loaded && previous.error === null) return previous;
  const frozenScope: CoreScope = { projectId: scope.projectId, workspaceId: scope.workspaceId };
  const generation = (previous?.generation ?? 0) + 1;
  directories.set(prefix, {
    scope: frozenScope, prefix, generation,
    paths: previous?.paths ?? [], partial: previous?.partial ?? false,
    visibleCount: previous?.visibleCount ?? 0,
    loading: true, error: null, stale: false, loaded: previous?.loaded ?? false,
  });
  const reply = await send({ scope: frozenScope, prefix, generation });
  const current = directories.get(prefix) ?? null;
  // A newer request for this prefix already replaced the entry; the old reply
  // must not land.
  if (current === null || current.generation !== generation) return current;
  if (reply.status === 'ready') {
    directories.set(prefix, {
      ...current,
      paths: [...reply.value.paths],
      partial: reply.value.partial,
      // A successful (re)enumeration resets the local window to its first page.
      visibleCount: Math.min(reply.value.paths.length, DIRECTORY_INVENTORY_PAGE_SIZE),
      loading: false, error: null, stale: false, loaded: true,
    });
  } else {
    directories.set(prefix, {
      ...current, loading: false, error: reply.reason ?? reply.code,
      stale: current.paths.length > 0,
    });
  }
  return directories.get(prefix) ?? null;
}

/** Reveal the next local page of the SAME already-enumerated list. It appends
 * to the visible window, never replaces the rows, and never issues a request. */
export function showMoreDirectoryInventory(state: DirectoryInventoryState): DirectoryInventoryState {
  return { ...state, visibleCount: Math.min(state.paths.length, state.visibleCount + DIRECTORY_INVENTORY_PAGE_SIZE) };
}

/** The real browser transport for one frozen inventory request: it goes to the
 * Host `files/list` route and never to `source/capture`. */
async function sendDirectoryRequest(request: { scope: CoreScope; prefix: string; generation: number }): Promise<DirectoryInventoryReply> {
  const outcome = await callCore('files/list', {
    scope: request.scope,
    input: request.prefix.length === 0 ? {} : { prefix: request.prefix },
  });
  if (outcome.kind === 'network') {
    return { status: 'rejected', code: 'unavailable', reason: '连接中断，未收到回执。' };
  }
  if (outcome.status === 403) {
    return { status: 'rejected', code: 'forbidden', reason: '连接已失效，请刷新页面重新连接。' };
  }
  const envelope = record(outcome.payload);
  if (envelope.status === 'ready') {
    const value = record(envelope.value);
    return { status: 'ready', value: {
      paths: list(value.paths).filter((path): path is string => typeof path === 'string'),
      partial: value.partial === true,
    } };
  }
  return { status: 'rejected', code: typeof envelope.code === 'string' ? envelope.code : 'unavailable',
    reason: typeof envelope.reason === 'string' ? envelope.reason : '目录列出失败。' };
}

/** Open or refresh one directory page through the real entry: it renders the
 * in-place loading state before the await and the settled state after it. It
 * never touches a text capture. */
async function loadDirectory(scope: ScopeState, prefix: string, refresh: boolean): Promise<void> {
  const pending = ensureDirectory(scope.directories, scope.config.scope, prefix, refresh, sendDirectoryRequest);
  renderScopeIfSelected(scope);
  await pending;
  renderScopeIfSelected(scope);
}

/** Normalize the user's directory input for the `files/list` prefix. Empty,
 * `'.'`, `'/'` and `'./'` all mean the workspace ROOT (omit the prefix); any
 * other value is passed through with only a leading `./` and trailing `/`
 * removed. The Host still applies its strict relative-path/read-scope rule, so
 * the page never widens or rewrites a path itself. */
function normalizeDirectoryInput(raw: string): string {
  let value = raw.trim();
  if (value === '' || value === '.' || value === '/' || value === './') return '';
  if (value.startsWith('./')) value = value.slice(2);
  value = value.replace(/\/+$/, '');
  return value === '.' ? '' : value;
}

function buildFileRequest(path?: string): unknown | null {
  const current = state();
  const scope = current.config.scope;
  const workspaceRef = { aggregateType: 'Workspace', projectId: scope.projectId, workspaceId: scope.workspaceId };
  const filePath = path ?? current.forms.filePath.trim();
  if (filePath.length === 0) return null;
  const version = current.forms.readVersion === 'capture' && current.capture !== null
    ? { kind: 'capture', capture: current.capture.ref }
    : { kind: 'working_tree' };
  return { scope, input: { workspace: workspaceRef, path: filePath, maxBytes: 65536, version } };
}

function architectureSelectionKeyOf(body: unknown): string {
  const selection = record(record(record(body).input).selection);
  if (selection.kind === 'revision') {
    const ref = record(selection.ref);
    return `revision:${String(ref.baselineId)}@${String(ref.revision)}`;
  }
  return selection.kind === 'current' ? 'current' : '';
}

function taskGoalIdOf(body: unknown): string {
  const goalRef = record(record(record(body).input).goalRef);
  return typeof goalRef.goalId === 'string' ? goalRef.goalId : '';
}

// ---------------------------------------------------------------------------
// Explicit action handlers
// ---------------------------------------------------------------------------

/** Selecting a Session is the ONLY place that changes `activeSession`. It also
 * drops the previously selected message so a body action can never target a
 * message that belongs to another Session. A late response still keeps its own
 * Session tag in state but no longer matches the active selection. */
function selectSession(scope: ScopeState, ref: SessionRef): void {
  if (!sameSession(scope.activeSession, ref)) scope.activeMessage = null;
  scope.activeSession = ref;
  saveScopeDisplay(scope);
}

function requireBody(scope: ScopeState, body: unknown | null): body is unknown {
  if (body === null) {
    if (scope.error === null) scope.error = '缺少必要输入或上一步结果，请补全后重试。';
    renderScopeIfSelected(scope);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// R6.1b-1 Session / message / history request builders. Each one is derived
// from the exact public port second argument; `sessions/create` is plain (its
// own `meta` is the real request) and `messages/send` keeps the original
// GraphWrite envelope. The trusted sender/actor is never built here.
// ---------------------------------------------------------------------------

function sessionRolesForScope(scope: CoreScope) {
  return reviewSessionRoles().filter(entry =>
    entry.scope.projectId === scope.projectId && entry.scope.workspaceId === scope.workspaceId);
}

function sessionRefFromRecord(value: unknown): SessionRef | null {
  const ref = record(record(value).ref);
  const projectId = ref.projectId;
  const sessionId = ref.sessionId;
  return typeof projectId === 'string' && typeof sessionId === 'string' ? { projectId, sessionId } : null;
}

function sessionRefFromCard(value: unknown): SessionRef | null {
  return sessionRefFromRecord(record(value).record);
}

function sessionRefFromFind(current: ScopeState, sessionId: string): SessionRef | null {
  const found = current.sessionFind;
  if (found === null || found.status !== 'ready') return null;
  const card = found.value.items.find(item => item.record.ref.sessionId === sessionId);
  if (card === undefined) return null;
  return { projectId: card.record.ref.projectId, sessionId: card.record.ref.sessionId };
}

function messageRefFromInbox(current: ScopeState, messageId: string): MessageRefValue | null {
  const inbox = current.inbox;
  if (inbox === null || inbox.result.status !== 'ready') return null;
  const found = inbox.result.value.items.find(item => item.ref.messageId === messageId);
  return found === undefined ? null : found.ref;
}

function buildSessionFindRequest(next: boolean): unknown | null {
  const current = state();
  const scope = current.config.scope;
  if (!next) return { scope, input: { workspace: scope, includeArchived: current.sessionIncludeArchived, page: { limit: 10 } } };
  const previous = current.sessionFind;
  if (previous === null || previous.status !== 'ready' || previous.value.nextCursor === null) return null;
  return { scope, input: { workspace: scope, includeArchived: current.sessionIncludeArchived, page: {
    limit: 10, cursor: previous.value.nextCursor, atLeastCursor: previous.value.sourceCursor } } };
}

function buildSessionCreateRequest(): unknown | null {
  const current = state();
  const scope = current.config.scope;
  const roles = sessionRolesForScope(scope);
  const role = roles[selectedIndex(current.forms.sessionRoleIndex, roles.length)];
  if (role === undefined) return null;
  return { scope, input: {
    workspace: scope,
    role: role.role,
    recommendedRefs: [],
    initialLinks: [],
    meta: { requestId: freshRequestId('sessions/create'), expected: [] },
  } };
}

function buildSessionReadRequest(scope: CoreScope, ref: SessionRef): unknown {
  return { scope, input: ref };
}

function buildSessionOperationRequest(): unknown | null {
  const current = state();
  const receipt = current.sessionCreateReceipt;
  if (receipt === null || receipt.status === 'rejected') return null;
  return { scope: current.config.scope, input: receipt.operationRef };
}

/** The result stored for one exact page key, or null when that page was never
 * read. The center and each auxiliary page pass their own stored result into the
 * one builder below, so they never borrow another page's cursor. */
function storedSessionHistoryPage(scope: ScopeState, key: string | null): SessionsHistoryResponse | null {
  return key === null ? null : scope.sessionHistories.get(key)?.result ?? null;
}

/** An append may follow a published next cursor, or refresh a previously read
 * tail using its exact last saved record cursor. A newer prefix invalidates it. */
function matchesHistoryAppendCursor(previous: Extract<SessionsHistoryResponse, { status: 'ready' }>, after: string | null | undefined): boolean {
  if (after === null || after === undefined) return false;
  const page = previous.value;
  return (page.nextCursor ?? page.items.at(-1)?.cursor) === after;
}

/** The center conversation reads a 50-record first page; an auxiliary
 * history/session tab keeps its own smaller independent page. */
const CENTER_HISTORY_LIMIT = 50;
const AUX_HISTORY_LIMIT = 10;

/** The ONE explicit Session-history request builder. It receives the exact
 * scope, Session and the original page whose `nextCursor` is being followed, so
 * the center path and every auxiliary history/session tab page their own object
 * and never borrow another object's cursor. A null `next` rebuilds the head
 * (afterCursor null); empty `items` with a non-null `nextCursor` still continues. */
function buildSessionHistoryRequest(
  targetScope: CoreScope, ref: SessionRef, previous: SessionsHistoryResponse | null, next: boolean,
  limit: number = AUX_HISTORY_LIMIT,
): unknown | null {
  let afterCursor: string | null = null;
  if (next) {
    if (previous === null || previous.status !== 'ready' || previous.value.nextCursor === null) return null;
    afterCursor = previous.value.nextCursor;
  }
  return { scope: targetScope, input: { sessionRef: ref, afterCursor, throughCursor: null, limit } };
}

function buildInboxRequest(next: boolean): unknown | null {
  const current = state();
  const recipient = current.activeSession;
  if (recipient === null) return null;
  if (!next) return { scope: current.config.scope, input: { recipient, page: { limit: 10 } } };
  const previous = current.inbox;
  if (previous === null || !sameSession(previous.session, recipient)
    || previous.result.status !== 'ready' || previous.result.value.nextCursor === null) return null;
  return { scope: current.config.scope, input: { recipient, page: {
    limit: 10, cursor: previous.result.value.nextCursor, atLeastCursor: previous.result.value.sourceCursor } } };
}

function buildRuntimeCapabilitiesRequest(): unknown {
  const current = state();
  return { scope: current.config.scope, input: current.config.scope };
}

// ---------------------------------------------------------------------------
// R6 execution entry: the finite Query / initial-Plan / Workflow consumer.
//
// One explicit user action sends ONE public request at a time. Every request is
// saved before it is sent; a ready result with a real `next` continues along the
// continuation seam, while waiting/needs_decision/unknown/network/rejected stop
// and keep the original request. The in-page call buffer lets the existing retry
// entry resend the exact body and resume at the failed call without rebuilding
// the flow. There is no timer, no background loop and no second Workflow state
// machine; completion is only displayed from the owner's formal result.
// ---------------------------------------------------------------------------

function selectedExecutionProfile(scope: ScopeState): BootstrapExecutionQueryProfile | null {
  const selected = scope.config.scope;
  const profiles = (bootstrapState?.execution.queryProfiles ?? []).filter(profile =>
    profile.scope.projectId === selected.projectId && profile.scope.workspaceId === selected.workspaceId);
  if (profiles.length === 0) return null;
  const id = scope.executionProfileId;
  return profiles.find(profile => profile.id === id) ?? profiles[0] ?? null;
}

/** Complete structural Role equality for Session reuse only; a trust decision
 * still belongs to the owner. */
function sameExecutionRole(left: RoleConfigurationRef, right: RoleConfigurationRef): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'role_spec' && right.kind === 'role_spec') {
    return left.pin.ref.projectId === right.pin.ref.projectId && left.pin.ref.roleId === right.pin.ref.roleId
      && left.pin.ref.revision === right.pin.ref.revision && left.pin.digest === right.pin.digest;
  }
  if (left.kind === 'legacy_template' && right.kind === 'legacy_template')
    return left.templateId === right.templateId && left.templateRevision === right.templateRevision;
  return false;
}

/** Read the payload of a real HTTP response; a network outcome has none. */
function payloadOf(outcome: CallOutcome): unknown {
  return outcome.kind === 'response' ? outcome.payload : null;
}

function outcomeProblem(outcome: CallOutcome): string | null {
  if (outcome.kind === 'network') return `网络结果不确定：${outcome.reason}。原请求已保留，可重试同一请求。`;
  if (outcome.status === 403) return '连接已失效，请刷新页面重新连接。';
  return null;
}

function outcomeRejectionReason(payload: unknown): string {
  const envelope = record(payload);
  return envelope.status === 'rejected' && typeof envelope.reason === 'string' ? envelope.reason : '命令未提交';
}

/** One stable request id per logical execution request, so re-entering the flow
 * after a retry replays the exact same bodies instead of refreshing identities. */
function executionRequestId(run: ExecutionRun, key: string): string {
  const existing = run.requestIds[key];
  if (existing !== undefined) return existing;
  const value = freshRequestId(key);
  run.requestIds[key] = value;
  return value;
}

/** Send one execution request through the existing transport. The exact body is
 * kept BEFORE the send; a network outcome leaves `scope.pending`/`run.pending`
 * so the existing retry entry can resend the identical request. A confirmed
 * outcome is memoized in the in-page call buffer so the retry resumes at the
 * failed call instead of rebuilding flow/job/run/session/requestId/budget. */
async function executionCall(
  scope: ScopeState, run: ExecutionRun, route: CoreRouteSuffix, request: unknown,
): Promise<CallOutcome> {
  const index = run.callIndex;
  run.callIndex += 1;
  let call = run.calls[index];
  if (call === undefined) {
    call = { route, request, outcome: null };
    run.calls.push(call);
  } else {
    // Re-entry: the stored body is authoritative; the freshly built one is
    // discarded so no identity is refreshed.
    call.route = route;
    request = call.request;
  }
  if (call.outcome !== null) return call.outcome;
  run.pending = { route, request };
  scope.sending = true;
  scope.pending = null;
  renderScopeIfSelected(scope);
  const outcome = await callCore(route, request);
  scope.sending = false;
  if (outcome.kind === 'network') {
    run.pendingIndex = index;
    scope.pending = { route, body: request, tags: noTags };
    renderScopeIfSelected(scope);
    return outcome;
  }
  scope.pending = null;
  run.pending = null;
  run.pendingIndex = null;
  call.outcome = outcome;
  return outcome;
}

/** Run one full driver, remembering the exact driver so a network retry can
 * replay the same flow instead of re-running the user action. */
async function driveRun(scope: ScopeState, run: ExecutionRun, driver: ExecutionDriver): Promise<void> {
  run.running = true;
  run.driver = driver;
  run.driverStart = run.callIndex;
  run.error = null;
  renderScopeIfSelected(scope);
  try {
    await driver(scope, run);
  } catch (error) {
    run.error = `执行中断：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    run.running = false;
    renderScopeIfSelected(scope);
  }
}

/**
 * Resolve the Session for this exact action. A user-selected Session is handled
 * through the original public read and its current facts: busy waits, an
 * incompatible or unreadable selection is reported, and NO second Session is
 * created behind the user's back. Only a clearly unselected action creates one.
 */
async function resolveExecutionSession(
  scope: ScopeState, run: ExecutionRun, target: CoreScope,
): Promise<SessionAggregateRef | null> {
  const selected = run.selectedSession;
  if (selected !== null) {
    const read = await executionCall(scope, run, 'sessions/read', { scope: target, input: selected });
    const problem = outcomeProblem(read);
    if (problem !== null) { run.error = problem; return null; }
    const readPayload = payloadOf(read) as SessionsReadResponse;
    if (readPayload.status !== 'ready') {
      run.error = '已选会话当前详情不可读，无法确认占用与角色；未创建替代会话。';
      return null;
    }
    const card = readPayload.value;
    if (card.record.lifecycle !== 'active') {
      run.error = '已选会话不是 active，无法用于本次执行；未创建替代会话。';
      return null;
    }
    if (card.availability === 'busy') {
      run.notice = '已选会话当前忙碌；请等待或选择空闲会话，页面不会另建会话绕过占用。';
      return null;
    }
    if (run.profile === null || !sameExecutionRole(card.record.role, run.profile.sessionRole)) {
      run.error = '已选会话的角色与所选执行配置不一致；请选择匹配的会话，页面不会猜另一个角色。';
      return null;
    }
    run.sessionRef = card.record.ref;
    run.sessionRevision = card.record.revision;
    return card.record.ref;
  }
  const profile = run.profile;
  if (profile === null) { run.error = '当前工作区没有可用的只读调查配置。'; return null; }
  const createRequest = { scope: target, input: {
    workspace: target, role: profile.sessionRole, recommendedRefs: [], initialLinks: [],
    meta: { requestId: executionRequestId(run, 'sessions/create'), expected: [] },
  } };
  const created = await executionCall(scope, run, 'sessions/create', createRequest);
  const problem = outcomeProblem(created);
  if (problem !== null) { run.error = problem; return null; }
  const payload = payloadOf(created) as SessionsCreateResponse;
  if (payload.status === 'accepted') {
    run.notice = '会话创建处理中：请先“刷新创建状态”，完成后再执行。';
    return null;
  }
  if (payload.status !== 'completed') {
    run.error = `会话创建未完成：${outcomeRejectionReason(payload)}`;
    return null;
  }
  run.sessionRef = payload.value.ref;
  run.sessionRevision = payload.value.revision;
  return payload.value.ref;
}

async function readExecutionAnswer(
  scope: ScopeState, run: ExecutionRun, target: CoreScope, answerRef: QueryJobAnswerRef,
): Promise<boolean> {
  const answerRead = await executionCall(scope, run, 'queries/answer', { scope: target, input: answerRef });
  const answerProblem = outcomeProblem(answerRead);
  if (answerProblem !== null) { run.error = answerProblem; return false; }
  run.answer = payloadOf(answerRead) as QueriesAnswerResponse;
  if (run.answer.status !== 'ready') { run.notice = '正式回答尚未就绪。'; return false; }
  const bodyRead = await executionCall(scope, run, 'materials/open', { scope: target, input: {
    ref: run.answer.value.answer.bodyRef, usage: 'historical_explanation' } });
  const bodyProblem = outcomeProblem(bodyRead);
  if (bodyProblem !== null) { run.error = bodyProblem; return false; }
  run.body = payloadOf(bodyRead) as MaterialsOpenResponse;
  return true;
}

/** The Goal this execution/scope works under; on a reload it falls back to the
 * selected/typed Goal so a read-only driver read still works by goal. */
function collaborationGoalRef(scope: ScopeState, run: ExecutionRun): NonNullable<ExecutionRun['goalRef']> | null {
  // The CURRENT explicit Goal choice (typed form or selected Goal) owns the
  // panel; the previous execution run is only a fallback. This is what lets a
  // user switch Goals without the old handle's response writing back.
  const target = run.scope ?? scope.config.scope;
  const goalId = scope.forms.goalId.trim() || scope.goal?.ref.goalId || '';
  if (goalId.length > 0) return { aggregateType: 'Goal', projectId: target.projectId, goalId };
  return run.goalRef;
}

function collaborationIsActive(snapshot: WorkflowDriverReadResponse): boolean {
  if (snapshot.status !== 'ready') return false;
  const value = snapshot.value.state;
  // `waiting` means the owner already returned and the loop drained; only an
  // explicit later continue may start the next bounded advance.
  return value === 'running' || value === 'waiting_for_reply' || value === 'stopping';
}

/** Read the official Goal/TaskGraph once when a collaboration handle first
 * reaches `completed`; the UI never treats its own flag as formal completion. */
async function syncCollaborationFacts(
  scope: ScopeState, target: CoreScope, goalRef: NonNullable<ExecutionRun['goalRef']>, epoch: number,
): Promise<void> {
  const key = `${target.projectId}\u0000${target.workspaceId}\u0000${goalRef.goalId}`;
  if (scope.collaborationSyncedGoal === key) return;
  const goalRead = await callCore('goals/read', { scope: target, input: goalRef });
  const tasksRead = await callCore('tasks/query', { scope: target, input: { goalRef } });
  // A late response for an OLD Goal must not sync its official graph into a
  // newer panel, and only two successful reads mark the Goal synced.
  if (scope.collaborationEpoch !== epoch) return;
  const currentSelected = collaborationGoalRef(scope, scope.execution);
  if (currentSelected === null || currentSelected.goalId !== goalRef.goalId) return;
  const goalPayload = goalRead.kind === 'response' ? payloadOf(goalRead) : null;
  const tasksPayload = tasksRead.kind === 'response' ? payloadOf(tasksRead) : null;
  const goalOk = goalPayload !== null && record(goalPayload).status === 'ready';
  const tasksOk = tasksPayload !== null && record(tasksPayload).status === 'ready';
  if (goalOk) scope.goalRead = goalPayload;
  if (tasksOk) { scope.taskGraph = tasksPayload; scope.taskGraphGoalId = goalRef.goalId; }
  if (goalOk && tasksOk) scope.collaborationSyncedGoal = key;
  renderScopeIfSelected(scope);
}

/** Same-scope trusted Query profile ids, one per role. An ambiguous role keeps
 * only the user's explicitly selected profile; the Host re-matches the exact
 * recipient role and reports an honest wait when no unique profile exists. */
function collaborationProfileIds(scope: ScopeState, target: CoreScope): string[] {
  const profiles = bootstrapState?.execution.queryProfiles ?? [];
  const matching = profiles.filter(profile => profile.scope.projectId === target.projectId
    && profile.scope.workspaceId === target.workspaceId);
  const groups = new Map<string, BootstrapExecutionQueryProfile[]>();
  for (const profile of matching) {
    const key = JSON.stringify(profile.sessionRole);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [profile]); else group.push(profile);
  }
  const ids: string[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) { ids.push(group[0]!.id); continue; }
    const selected = group.find(profile => profile.id === scope.executionProfileId);
    if (selected !== undefined) ids.push(selected.id);
  }
  return ids;
}

function beginCollaborationPoll(
  scope: ScopeState, target: CoreScope, goalRef: NonNullable<ExecutionRun['goalRef']>,
): void {
  const epoch = scope.collaborationEpoch + 1;
  scope.collaborationEpoch = epoch;
  if (scope.collaborationPoll !== null) clearInterval(scope.collaborationPoll);
  void readCollaboration(scope, target, goalRef, epoch);
  scope.collaborationPoll = setInterval(() => { void readCollaboration(scope, target, goalRef, epoch); }, 1000);
}

/** Read-only driver projection bound to one poll/goal EPOCH. A network failure
 * keeps the last snapshot; a response for an older Goal can never overwrite the
 * current panel or clear a newer timer, and the Host driver is never cancelled. */
async function readCollaboration(
  scope: ScopeState, target: CoreScope, goalRef: NonNullable<ExecutionRun['goalRef']>, epoch: number,
): Promise<void> {
  const activeTaskId = scope.execution.taskId;
  const outcome = await callCore('workflow/driver-read', { scope: target, input: { goalRef, ...(activeTaskId === null ? {} : { taskId: activeTaskId }) } });
  if (scope.collaborationEpoch !== epoch) return;
  if (outcome.kind !== 'response') return;
  const payload = payloadOf(outcome) as WorkflowDriverReadResponse;
  if (payload.status !== 'ready' && payload.status !== 'not_found') return;
  scope.collaboration = { goalRef, result: payload };
  const run = scope.execution;
  if (run.goalRef !== null && run.goalRef.goalId === goalRef.goalId && payload.status === 'ready') {
    run.phase = payload.value.state;
    if (payload.value.last !== null) run.advance = payload.value.last;
  }
  if (payload.status === 'ready' && payload.value.state === 'completed') {
    void syncCollaborationFacts(scope, target, goalRef, epoch);
  }
  if (!collaborationIsActive(payload) && scope.collaborationPoll !== null) {
    clearInterval(scope.collaborationPoll);
    scope.collaborationPoll = null;
  }
  renderScopeIfSelected(scope);
}

/** Start (or replay) the Host driver for one exact Workflow advance through the
 * page's normal request cache, so a network retry replays the SAME driver-start
 * payload instead of rebuilding a flow or reusing the old Query driver. */
async function startCollaboration(
  scope: ScopeState, run: ExecutionRun, target: CoreScope, advance: WorkflowAdvanceBody['input'],
): Promise<void> {
  const goalRef = collaborationGoalRef(scope, run);
  if (goalRef === null) { run.error = '请先选择或创建目标。'; renderScopeIfSelected(scope); return; }
  run.goalRef = goalRef;
  const request: WorkflowDriverStartBody = { scope: target, input: {
    advance: advance as WorkflowAdvanceBody['input'],
    queryProfileIds: collaborationProfileIds(scope, target),
  } };
  const epoch = scope.collaborationEpoch + 1;
  scope.collaborationEpoch = epoch;
  await driveRun(scope, run, async (current, active) => {
    const outcome = await executionCall(current, active, 'workflow/driver-start', request);
    const problem = outcomeProblem(outcome);
    if (problem !== null) { active.error = problem; return; }
    const payload = payloadOf(outcome) as WorkflowDriverStartResponse;
    if (payload.status !== 'ready') {
      active.error = outcomeRejectionReason(payload);
      active.phase = 'rejected';
      return;
    }
    active.phase = payload.value.state;
    active.resumeIntent = null;
    if (payload.value.last !== null) active.advance = payload.value.last;
    // The user may have switched Goals while this start was in flight: the old
    // Goal must never write the new panel or own its timer.
    if (scope.collaborationEpoch !== epoch) return;
    scope.collaboration = { goalRef, result: { status: 'ready', value: payload.value } };
    beginCollaborationPoll(scope, target, goalRef);
  });
}

/** Ask the Host driver to stop; the page only reads afterwards and never writes
 * a fabricated 'cancelled'. */
async function stopCollaboration(scope: ScopeState): Promise<void> {
  const run = scope.execution;
  const goalRef = collaborationGoalRef(scope, run) ?? scope.collaboration?.goalRef ?? null;
  if (goalRef === null) { scope.error = '没有可停止的协同推进句柄。'; renderScopeIfSelected(scope); return; }
  const target = run.scope ?? scope.config.scope;
  const epoch = scope.collaborationEpoch;
  run.running = true;
  renderScopeIfSelected(scope);
  try {
    const outcome = await callCore('workflow/driver-stop', { scope: target, input: { goalRef, ...(run.taskId === null ? {} : { taskId: run.taskId }) } });
    const problem = outcomeProblem(outcome);
    if (problem !== null) { run.error = problem; return; }
    const payload = payloadOf(outcome) as WorkflowDriverStopResponse;
    if (payload.status === 'ready' || payload.status === 'not_found') {
      if (scope.collaborationEpoch !== epoch) return;
      scope.collaboration = { goalRef, result: payload };
      beginCollaborationPoll(scope, target, goalRef);
    } else {
      run.error = outcomeRejectionReason(payload);
    }
  } finally {
    run.running = false;
    renderScopeIfSelected(scope);
  }
}

/** One user action per public request: send, display, and continue ONLY when the
 * owner returned ready with a real `next`. A null `next` or a non-ready result
 * is a real stop that keeps the original request. The owner's next input is
 * forwarded untouched. */
async function drainContinuation(
  scope: ScopeState, run: ExecutionRun, target: CoreScope, seed: ExecutionIntent,
): Promise<void> {
  let intent = seed;
  for (let guard = 0; guard < 64; guard += 1) {
    // The Host owns every formal Workflow advance: the page never sends a
    // browser `workflow/advance` chain, it starts the driver and then reads.
    if (intent.route === 'workflow/advance') {
      await startCollaboration(scope, run, target, intent.input);
      return;
    }
    run.resumeIntent = intent;
    const outcome = await executionCall(scope, run, intent.route, { scope: target, input: intent.input });
    const problem = outcomeProblem(outcome);
    if (problem !== null) { run.error = problem; return; }
    const payload = payloadOf(outcome);
    if (record(payload).status === 'rejected') {
      run.error = outcomeRejectionReason(payload);
      run.phase = 'rejected';
      return;
    }
    if (intent.route === 'workflow/goal-input') {
      run.planning = payload as InitialPlanningGoalInputResult;
      run.planningRequest = { scope: target, input: intent.input };
      if (run.planning.status === 'ready') {
        run.phase = run.planning.value.state;
        const next = run.planning.value.next;
        if (run.planning.value.state === 'proposed' && next !== null && next.kind === 'goal_input')
          run.candidate = run.planning.value.receipt;
      }
    } else {
      // Unreachable for a fresh seed (a workflow/advance intent is handed to the
      // Host at the top of the loop); kept so the type-narrowed branch is total.
      const advanceIntent = intent as { route: 'workflow/advance'; input: WorkflowAdvanceInput };
      run.advance = payload as WorkflowAdvanceResult;
      run.advanceRequest = { scope: target, input: advanceIntent.input };
      if (run.advance.status === 'ready') run.phase = run.advance.value.state;
    }
    const continuation = planExecutionContinuation(
      payload as WorkflowAdvanceResult | InitialPlanningGoalInputResult);
    if (continuation.status !== 'next') {
      // A waiting initial-plan adoption keeps its original public input so a
      // later explicit continue resends THAT request (a new requestId), never a
      // fabricated select_work.
      const readyState = record(payload).status === 'ready' ? record(record(payload).value).state : null;
      const receipt = record(record(record(payload).value).receipt);
      if (receipt.status === 'rejected') run.error = outcomeRejectionReason(receipt);
      run.resumeIntent = intent.route === 'workflow/goal-input' && readyState === 'waiting' ? intent : null;
      return;
    }
    if (continuation.route === 'workflow/goal-input')
      intent = { route: 'workflow/goal-input', input: continuation.input };
    else
      intent = { route: 'workflow/advance', input: continuation.input };
    run.resumeIntent = intent;
    // Planning produces a reviewable candidate, not permission to adopt it.
    // Keep the exact owner-provided next and receipt for explicit adoption.
    if (record(payload).status === 'ready'
      && record(record(payload).value).state === 'proposed'
      && continuation.route === 'workflow/goal-input') {
      run.notice = '规划候选已生成；请审阅后点击“采用并执行”。';
      return;
    }
  }
  // Per-page stop: the not-yet-sent next stays resumable.
  run.notice = '继续执行达到本页步数上限；原 next 已保留，点击“继续执行”发送同一公开请求。';
}

/** The investigation/planning flow. Every identity and the selected Session are
 * read from the captured `run` only, so a later navigation cannot change the
 * in-flight action. */
/**
 * R6 cold-start: assemble the REAL read-only context the model needs to form a
 * plan. It reads the current CompletionPolicy and the adopted architecture
 * through their original core routes and names the real available
 * role/templateId. It never puts records into the Runtime, never guesses a
 * policy/baseline and never treats the context as authorization.
 */
async function buildPlanningQuestion(scope: ScopeState, run: ExecutionRun, target: CoreScope): Promise<string> {
  const lines: string[] = [
    '## 本请求真实只读上下文（仅供形成方案；不构成任何授权，也不代表测试已经存在）',
    `projectId: ${target.projectId}`,
    `workspaceId: ${target.workspaceId}`,
  ];
  const policyRead = await executionCall(scope, run, 'completion-policies/read', { scope: target, input: { projectId: target.projectId } });
  const policyPayload = record(payloadOf(policyRead));
  if (outcomeProblem(policyRead) === null && policyPayload.status === 'ready') {
    const policyValue = record(record(policyPayload.value).policy);
    const content = record(policyValue.content);
    lines.push(`现有完成策略: ${JSON.stringify({
      policyId: policyValue.policyId, contentRevision: policyValue.contentRevision,
      requirementKinds: content.requirementKinds,
      minimumRequiredRequirementsPerObligation: content.minimumRequiredRequirementsPerObligation,
    })}`);
  } else if (policyPayload.status === 'not_found'
    || (policyPayload.status === 'rejected' && policyPayload.code === 'not_found')) {
    lines.push('现有完成策略: 未采用（可提出最小真实策略；绝不能编造空策略来自动 PASS）');
  } else {
    lines.push('现有完成策略: 暂不可读（不得当作缺省；需先人工处理后再形成方案）');
  }
  const architectureRead = await executionCall(scope, run, 'architecture/read', { scope: target, input: { selection: { kind: 'current' } } });
  const architecturePayload = record(payloadOf(architectureRead));
  if (outcomeProblem(architectureRead) === null && architecturePayload.status === 'ready') {
    const baseline = record(record(architecturePayload.value).baseline);
    lines.push(`现有采用架构: ${JSON.stringify({
      baselineId: baseline.baselineId, revision: baseline.revision,
      hasCatalog: record(architecturePayload.value).catalog !== null && record(architecturePayload.value).catalog !== undefined,
    })}`);
  } else if (architecturePayload.status === 'not_found') {
    lines.push('现有采用架构: 未采用（模块 ref 必须使用上面的真实 projectId）');
  } else {
    lines.push('现有采用架构: 暂不可读（不得当作缺省；需先人工处理后再形成方案）');
  }
  const roles = new Set<string>();
  for (const profile of bootstrapState?.execution.queryProfiles ?? []) {
    if (profile.scope.projectId !== target.projectId || profile.scope.workspaceId !== target.workspaceId) continue;
    const role = record(profile.sessionRole);
    if (typeof role.templateId === 'string') roles.add(role.templateId);
  }
  lines.push(`合法 assignments[].role（仅 templateId，不加 @revision）: ${roles.size === 0 ? '(none)' : [...roles].join(', ')}`);
  lines.push('', '## 用户请求', run.question);
  return lines.join('\n');
}

type InitialPlanProposalRef = {
  aggregateType: 'PlanProposal';
  projectId: string;
  workspaceId: string;
  proposalId: string;
};

type InitialPlanSetupCandidate = {
  setup: unknown;
  plan: unknown;
  answerRef: QueryJobAnswerRef;
  answerDigest: string;
  checks: unknown[];
  /** The EXACT formal pending proposal (and the goal revision) the existing
   * `adopt_initial_plan` continuation needs. */
  proposalRef: InitialPlanProposalRef;
  proposalRevision: number;
  goalRef: { aggregateType: 'Goal'; projectId: string; goalId: string };
  goalRevision: number;
  writable: boolean;
  readonlyReason: string;
};

/** Browser SHA-256 used ONLY to verify the saved Answer against the candidate's
 * recorded origin digest. When SubtleCrypto is unavailable the digest is
 * unverifiable and the candidate never becomes adopt-eligible. */
async function sha256HexText(text: string): Promise<string | null> {
  try {
    if (typeof crypto === 'undefined' || crypto.subtle === undefined) return null;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/**
 * R6 cold-start durable recovery. The ONLY adopt-eligible source is the CURRENT
 * displayed Goal's formal pending candidate: its `draft.origin.answerRef` must
 * match project/workspace/Goal and proposal identity, and the freshly read saved
 * Answer must match the candidate's recorded origin digest. A stale Goal, a
 * different scope, an old history answer or a run-local Answer never enables the
 * adoption control. Any failure leaves `planCandidate` null (read-only display).
 */
async function loadPlanCandidate(scope: ScopeState): Promise<void> {
  const target = scope.config.scope;
  const selectedGoalId = scope.forms.goalId.trim() || scope.goal?.ref.goalId || '';
  scope.planCandidate = null;
  if (selectedGoalId.length === 0 || scope.pending !== null) return;
  const current = await callCore('goals/read', { scope: target,
    input: { aggregateType: 'Goal', projectId: target.projectId, goalId: selectedGoalId } });
  if ((scope.forms.goalId.trim() || scope.goal?.ref.goalId || '') !== selectedGoalId) return;
  if (current.kind !== 'response' || record(current.payload).status !== 'ready') return;
  scope.goalRead = current.payload as ScopeState['goalRead'];
  const goalDetail = record(scope.goalRead);
  const goalValue = record(record(goalDetail.value).goal);
  const goalRefValue = record(goalValue.ref);
  const goalId = typeof goalRefValue.goalId === 'string' ? goalRefValue.goalId : '';
  const goalRevision = typeof goalValue.revision === 'number' && Number.isSafeInteger(goalValue.revision)
    && goalValue.revision >= 0 ? goalValue.revision : null;
  const pending = record(record(goalDetail.value).pendingPlan);
  const pendingRef = record(pending.ref);
  const pendingGoalRef = record(pending.goalRef);
  const origin = record(record(pending.draft).origin);
  const answerRefValue = record(origin.answerRef);
  const answerDigest = typeof origin.answerDigest === 'string' ? origin.answerDigest : '';
  const proposalRevision = typeof pending.revision === 'number' && Number.isSafeInteger(pending.revision)
    && pending.revision > 0 ? pending.revision : null;
  const eligible = goalId.length > 0 && goalRevision !== null && proposalRevision !== null
    && typeof pendingRef.proposalId === 'string' && pendingRef.proposalId.length > 0
    && pendingRef.projectId === target.projectId && pendingRef.workspaceId === target.workspaceId
    && pendingGoalRef.projectId === target.projectId && pendingGoalRef.goalId === goalId
    && answerRefValue.projectId === target.projectId && answerRefValue.workspaceId === target.workspaceId
    && typeof answerRefValue.queryJobId === 'string' && typeof answerRefValue.answerId === 'string'
    && answerDigest.length === 64;
  if (!eligible) { scope.planCandidate = null; return; }
  const answerRef: QueryJobAnswerRef = {
    aggregateType: 'QueryJobAnswer', projectId: target.projectId, workspaceId: target.workspaceId,
    queryJobId: answerRefValue.queryJobId as string, answerId: answerRefValue.answerId as string,
  };
  const outcome = await callCore('queries/answer', { scope: target, input: answerRef });
  if (outcome.kind !== 'response') { scope.planCandidate = null; return; }
  const payload = record(outcome.payload);
  if (payload.status !== 'ready') { scope.planCandidate = null; return; }
  const savedAnswer = record(payload.value);
  const savedRef = record(savedAnswer.ref);
  if (savedRef.answerId !== answerRef.answerId || savedRef.queryJobId !== answerRef.queryJobId) {
    scope.planCandidate = null;
    return;
  }
  const answerText = record(savedAnswer.answer).answer;
  if (typeof answerText !== 'string') { scope.planCandidate = null; return; }
  const digest = await sha256HexText(answerText);
  if ((scope.forms.goalId.trim() || scope.goal?.ref.goalId || '') !== selectedGoalId) return;
  if (digest === null || digest !== answerDigest) { scope.planCandidate = null; return; }
  let parsed: unknown;
  try { parsed = JSON.parse(answerText); } catch { scope.planCandidate = null; return; }
  const response = record(parsed);
  if (response.schemaVersion !== 2 || response.kind !== 'plan' || response.setup === undefined) {
    scope.planCandidate = null;
    return;
  }
  const setup = record(response.setup);
  const workspace = bootstrapState?.workspaces.find(candidate =>
    candidate.scope.projectId === target.projectId && candidate.scope.workspaceId === target.workspaceId);
  const writable = workspace?.writeAllowed === true && workspace?.commandsAllowed === true;
  scope.planCandidate = {
    setup: response.setup,
    plan: pending.draft,
    answerRef,
    answerDigest,
    checks: Array.isArray(setup.checks) ? setup.checks : [],
    proposalRef: { aggregateType: 'PlanProposal', projectId: target.projectId,
      workspaceId: target.workspaceId, proposalId: pendingRef.proposalId as string },
    proposalRevision,
    goalRef: { aggregateType: 'Goal', projectId: target.projectId, goalId },
    goalRevision,
    writable,
    readonlyReason: '当前目录以只读登记，不能执行写文件或运行命令；本页仍可形成并保存方案，但不能采用执行。',
  };
}

/** Stable per-candidate/step owner request identity. A transport retry reuses
 * the SAME pending body (handled by `submit`); this id keeps a genuine rebuild
 * (for example after a reload) on the owner's exact idempotency semantics. */
function candidateStepRequestId(candidate: InitialPlanSetupCandidate, step: string): string {
  return `cold-start:${step}:${candidate.answerDigest.slice(0, 16)}:${candidate.proposalRef.proposalId}`;
}

/** Stable policy id for the one candidate, derived from the saved Answer. */
function candidatePolicyId(candidate: InitialPlanSetupCandidate): string {
  return `cold-start-policy-${candidate.answerDigest.slice(0, 32)}`;
}

/** Submit one GraphWrite and report ONLY its ACTUAL response. A non-null
 * `scope.pending` means the transport outcome was unknown: the original request
 * is preserved and the caller must stop before overwriting pending. */
async function submitStep(scope: ScopeState, route: CoreRouteSuffix, body: unknown):
Promise<{ ok: boolean; unknown: boolean; payload: unknown }> {
  await submit(scope, route, body);
  if (scope.pending !== null) return { ok: false, unknown: true, payload: null };
  const last = scope.lastResponse;
  if (last === null || last.route !== route) return { ok: false, unknown: false, payload: null };
  const envelope = record(last.payload);
  return { ok: envelope.status === 'committed' || envelope.status === 'completed', unknown: false, payload: last.payload };
}

/** Report a failed step without claiming a prior owner write never happened. */
function reportStepFailure(scope: ScopeState, result: { unknown: boolean; payload: unknown }, label: string): void {
  scope.error = result.unknown
    ? `${label}：连接中断，原请求已保留；请先重试同一请求，再继续后续步骤。`
    : `${label}：${outcomeRejectionReason(result.payload)}；已成功步骤的正式回执保留，不会重复。`;
  renderScopeIfSelected(scope);
}

/**
 * Reconstruct the EXISTING workflow `adopt_initial_plan` input from the current
 * formal pending proposal and the real Goal revision. Used when a reload lost
 * `run.resumeIntent`; it never starts `select_work` while a Plan is pending and
 * never creates a new planning/model call.
 */
function reconstructAdoptInitialPlan(scope: ScopeState): AdoptInitialPlanInput | null {
  const target = scope.config.scope;
  const goalDetail = record(scope.goalRead);
  const goalValue = record(record(goalDetail.value).goal);
  const goalRefValue = record(goalValue.ref);
  const goalId = typeof goalRefValue.goalId === 'string' ? goalRefValue.goalId : '';
  const goalRevision = typeof goalValue.revision === 'number' && Number.isSafeInteger(goalValue.revision)
    && goalValue.revision >= 0 ? goalValue.revision : null;
  const pending = record(record(goalDetail.value).pendingPlan);
  const pendingRef = record(pending.ref);
  const proposalRevision = typeof pending.revision === 'number' && Number.isSafeInteger(pending.revision)
    && pending.revision > 0 ? pending.revision : null;
  if (goalId.length === 0 || goalRevision === null || proposalRevision === null
    || typeof pendingRef.proposalId !== 'string' || pendingRef.proposalId.length === 0
    || pendingRef.projectId !== target.projectId || pendingRef.workspaceId !== target.workspaceId) {
    return null;
  }
  const ref: InitialPlanProposalRef = { aggregateType: 'PlanProposal', projectId: target.projectId,
    workspaceId: target.workspaceId, proposalId: pendingRef.proposalId };
  const goalRef = { aggregateType: 'Goal' as const, projectId: target.projectId, goalId };
  return {
    schemaVersion: 1, goalRef, flowId: `cold-start-adopt-${pendingRef.proposalId}`,
    sessionHint: null, executeWithinRequest: true, kind: 'adopt_initial_plan',
    request: { input: { proposalRef: ref, expectedProposalRevision: proposalRevision, decisionRefs: [] },
      meta: { requestId: `cold-start:plan-adopt:${pendingRef.proposalId}`,
        expected: [{ ref: goalRef, revision: goalRevision }] } },
  };
}

/** Refresh members and the two graphs through their existing reads, stopping if
 * any transport outcome is unknown so pending is never overwritten. */
async function refreshAdoptedFacts(scope: ScopeState, target: CoreScope): Promise<boolean> {
  await submit(scope, 'sessions/find', { scope: target, input: {
    workspace: target, includeArchived: scope.sessionIncludeArchived, page: { limit: 10 } } });
  if (scope.pending !== null) return false;
  await submit(scope, 'architecture/read', { scope: target, input: { selection: { kind: 'current' } } });
  if (scope.pending !== null) return false;
  const goalRef = scope.execution.goalRef;
  if (goalRef !== null) {
    await submit(scope, 'tasks/query', { scope: target, input: { goalRef } });
    if (scope.pending !== null) return false;
  }
  return true;
}

/**
 * R6 cold-start explicit adoption. Every presence/absence decision comes from a
 * FRESH owner read of the real facts, never from a cached `scope.adopted`/
 * `scope.policyInstall` or a non-null field:
 *   - architecture: only an explicit `architecture/read` owner `not_found` is
 *     absence; `ready` retains the existing baseline; anything else stops;
 *   - completion policy: only an explicit `completion-policies/read` owner
 *     `not_found` is absence; `ready` retains the existing policy; else stops;
 *   - checks approval only after the saved-Answer authority reader accepts.
 * Each write validates its ACTUAL response, keeps its formal receipt on a later
 * failure and never re-fires a transport-unknown request (pending is preserved).
 */
async function adoptInitialPlanSetup(scope: ScopeState, candidate: InitialPlanSetupCandidate): Promise<void> {
  const target = scope.config.scope;
  if (!candidate.writable) {
    scope.error = candidate.readonlyReason;
    renderScopeIfSelected(scope);
    return;
  }
  const setup = record(candidate.setup);
  // 1. Real registration pins.
  if (scope.project === null || scope.workspace === null) {
    const read = await callCore('workspaces/registration', { scope: target, input: target });
    if (read.kind !== 'response' || read.status === 403) {
      scope.error = '项目/工作区登记不可读，未采用。';
      renderScopeIfSelected(scope);
      return;
    }
    const registration = record(read.payload);
    if (registration.status !== 'ready') {
      scope.error = '项目/工作区登记未就绪，未采用。';
      renderScopeIfSelected(scope);
      return;
    }
    const value = record(registration.value);
    scope.project = value.project as ProjectValue;
    scope.workspace = value.workspace as WorkspaceValue;
  }
  if (scope.project === null || scope.workspace === null) {
    scope.error = '缺少正式项目/工作区版本，未采用。';
    renderScopeIfSelected(scope);
    return;
  }

  // 2. Fresh current architecture read.
  const architectureRead = await callCore('architecture/read', { scope: target, input: { selection: { kind: 'current' } } });
  if (architectureRead.kind !== 'response') {
    scope.error = '采用架构读取结果未确认；未采用，也不盲目重复。';
    renderScopeIfSelected(scope);
    return;
  }
  const architecturePayload = record(architectureRead.payload);
  const architectureAbsent = architecturePayload.status === 'not_found';
  if (architecturePayload.status === 'ready') {
    scope.architectureRead = architectureRead.payload;
  } else if (architectureAbsent) {
    const result = await submitStep(scope, 'architecture/adopt-initial', { scope: target, request: {
      input: setup.architecture,
      meta: { requestId: candidateStepRequestId(candidate, 'architecture'),
        expected: [pinOf(scope.project), pinOf(scope.workspace)] } } });
    if (!result.ok) { reportStepFailure(scope, result, '初始架构未采用'); return; }
    if (!await refreshAdoptedFacts(scope, target)) {
      scope.error = '初始架构已采用，但后续读取结果未确认；原请求已保留，且不会重复采用。';
      renderScopeIfSelected(scope);
      return;
    }
  } else {
    scope.error = `采用架构不可读（${String(architecturePayload.code ?? architecturePayload.status)}）：`
      + `${String(architecturePayload.reason ?? '')}；未采用。`;
    renderScopeIfSelected(scope);
    return;
  }

  // 3. Fresh current completion policy read.
  const policyRead = await callCore('completion-policies/read', { scope: target, input: { projectId: target.projectId } });
  if (policyRead.kind !== 'response') {
    scope.error = '完成策略读取结果未确认；未继续，也不盲目重复。';
    renderScopeIfSelected(scope);
    return;
  }
  const policyPayload = record(policyRead.payload);
  const policyAbsent = policyPayload.status === 'not_found'
    || (policyPayload.status === 'rejected' && policyPayload.code === 'not_found');
  if (policyAbsent) {
    const policyId = candidatePolicyId(candidate);
    const revisionRef = { aggregateType: 'CompletionPolicyRevision', projectId: target.projectId, policyId, revision: 1 };
    const installResult = await submitStep(scope, 'completion-policies/install', { scope: target, request: {
      input: { policyId, contentRevision: 1, content: setup.completionPolicy },
      meta: { requestId: candidateStepRequestId(candidate, 'policy-install'),
        expected: [pinOf(scope.project), { ref: revisionRef, revision: 0 }] } } });
    if (!installResult.ok) { reportStepFailure(scope, installResult, '完成策略安装未成功'); return; }
    const installValue = record(record(installResult.payload).value);
    const installRef = record(installValue.ref);
    const installDigest = typeof installValue.contentDigest === 'string' ? installValue.contentDigest : '';
    if (typeof installRef.policyId !== 'string' || installDigest.length === 0) {
      scope.error = '完成策略安装回执缺少正式 ref/digest；后续步骤停止，已完成回执保留。';
      renderScopeIfSelected(scope);
      return;
    }
    const activeRef = { aggregateType: 'ProjectCompletionPolicyActive', projectId: target.projectId };
    const activateResult = await submitStep(scope, 'completion-policies/activate', { scope: target, request: {
      input: { target: { ref: installRef, digest: installDigest } },
      meta: { requestId: candidateStepRequestId(candidate, 'policy-activate'),
        expected: [pinOf(scope.project), { ref: activeRef, revision: 0 }] } } });
    if (!activateResult.ok) { reportStepFailure(scope, activateResult, '完成策略启用未成功'); return; }
  } else if (policyPayload.status !== 'ready') {
    scope.error = `完成策略不可读（${String(policyPayload.code ?? policyPayload.status)}）：`
      + `${String(policyPayload.reason ?? '')}；未继续。`;
    renderScopeIfSelected(scope);
    return;
  }

  // 4. Explicit approval of the saved Answer's checks (the authority reader
  // re-reads the same saved Answer and rejects any mismatch).
  if (candidate.checks.length > 0) {
    const approved = await createHostSettingsPort().call('checks/approve', {
      scope: target, answerRef: candidate.answerRef, checks: candidate.checks as never,
    });
    if (approved.status !== 'ready') {
      scope.error = `检查审批未成功：${approved.reason}。已完成的架构/策略步骤保留其正式回执。`;
      renderScopeIfSelected(scope);
      return;
    }
  }

  // 5. Continue the ORIGINAL Plan adopt. Prefer the saved continuation; after a
  // reload reconstruct it from the current formal pending proposal. Never fall
  // back to select_work while a Plan is pending.
  if (scope.pending !== null) {
    scope.error = '存在尚未确认的原请求，请先重试后再继续采用。';
    renderScopeIfSelected(scope);
    return;
  }
  const resume = scope.execution.resumeIntent;
  if (resume !== null && resume.route === 'workflow/goal-input') {
    scope.execution.resumeCount += 1;
    const pendingAdopt = resume.input as AdoptInitialPlanInput;
    const input: AdoptInitialPlanInput = {
      ...pendingAdopt,
      request: { ...pendingAdopt.request, meta: { ...pendingAdopt.request.meta,
        requestId: executionRequestId(scope.execution, `workflow/goal-input:resume:${scope.execution.resumeCount}`) } },
    };
    await driveRun(scope, scope.execution, (current, active) =>
      drainContinuation(current, active, target, { route: 'workflow/goal-input', input }));
  } else {
    const reconstructed = reconstructAdoptInitialPlan(scope);
    if (reconstructed === null) {
      scope.error = '没有可续办的正式待采用计划草案；设置步骤已保留正式回执，未发起计划采用。';
      renderScopeIfSelected(scope);
      return;
    }
    await driveRun(scope, scope.execution, (current, active) =>
      drainContinuation(current, active, target, { route: 'workflow/goal-input', input: reconstructed }));
  }
  // 6. Refresh members and both graphs after the actual adopted steps.
  if (!await refreshAdoptedFacts(scope, target)) {
    scope.error = '采用后的读取结果未确认；原读取请求已保留。';
  }
  await loadPlanCandidate(scope);
  renderScopeIfSelected(scope);
}

async function executeQueryFlow(scope: ScopeState, run: ExecutionRun): Promise<void> {
  const target = run.scope;
  if (target === null) { run.error = '执行范围已丢失，请重新发起。'; return; }
  const goalRef = run.goalRef;
  if (goalRef === null) { run.error = '请先填写或创建目标。'; return; }

  const goalRead = await executionCall(scope, run, 'goals/read', { scope: target, input: goalRef });
  const goalProblem = outcomeProblem(goalRead);
  if (goalProblem !== null) { run.error = goalProblem; return; }
  if (record(payloadOf(goalRead)).status !== 'ready') { run.error = '目标尚未就绪，无法发起调查。'; return; }
  run.goalRead = payloadOf(goalRead);
  scope.goalRead = payloadOf(goalRead);
  const goalValue = record(record(record(payloadOf(goalRead)).value).goal);
  const goalRevision = typeof goalValue.revision === 'number' && Number.isSafeInteger(goalValue.revision)
    && goalValue.revision >= 0 ? goalValue.revision : null;
  if (goalRevision === null) {
    // The owner did not publish a usable Goal revision. Never guess revision 1:
    // keep the original read result and stop before building any expected pin.
    run.error = '目标读取没有可用的正式版本；不会猜测 revision，也不会提交调查。';
    return;
  }

  const registration = await executionCall(scope, run, 'workspaces/registration', { scope: target, input: target });
  const registrationProblem = outcomeProblem(registration);
  if (registrationProblem !== null) { run.error = registrationProblem; return; }
  run.registration = payloadOf(registration) as WorkspacesRegistrationResponse;
  if (run.registration.status !== 'ready') {
    run.error = `项目/工作区登记读取失败：${outcomeRejectionReason(run.registration)}`;
    return;
  }
  const projectRevision = run.registration.value.project.revision;
  const workspaceRevision = run.registration.value.workspace.revision;

  const session = await resolveExecutionSession(scope, run, target);
  if (session === null) return;
  const profile = run.profile;
  if (profile === null) { run.error = '当前工作区没有可用的只读调查配置。'; return; }

  const queryJobId = `qjob-${run.flowId ?? ''}`;
  const queryRunId = `qrun-${run.flowId ?? ''}`;
  const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', projectId: target.projectId, workspaceId: target.workspaceId, queryJobId };
  const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', projectId: target.projectId, workspaceId: target.workspaceId, queryJobId, runId: queryRunId };
  run.queryJobRef = queryJobRef; run.queryRunRef = queryRunRef;
  // R6 cold-start: an initial_coordination question carries the real policy,
  // architecture and role facts in the ORIGINAL Query intent; ordinary
  // investigation keeps the user's own question unchanged.
  const planningQuestion = run.kind === 'planning' ? await buildPlanningQuestion(scope, run, target) : run.question;
  const intent: QueryJobIntentV1 = {
    schemaVersion: 1, intentId: queryJobId, projectId: target.projectId, workspaceId: target.workspaceId,
    goalId: goalRef.goalId, question: planningQuestion, focusTaskRefs: [], budget: profile.budget, multiTurn: { maxRounds: 1 },
    correlationId: `corr-${run.flowId ?? ''}`,
    execution: { kind: run.kind === 'planning' ? 'initial_coordination' : 'semantic_query',
      roleBinding: profile.roleBinding, runtimeBudget: profile.runtimeBudget },
  };
  const projectRef = { aggregateType: 'Project' as const, projectId: target.projectId };
  const workspaceRef = { aggregateType: 'Workspace' as const, projectId: target.projectId, workspaceId: target.workspaceId };
  const submitRequest = { scope: target, request: { input: { queryJobId, runId: queryRunId, intent }, meta: {
    requestId: executionRequestId(run, 'queries/submit'),
    expected: [
      { ref: projectRef, revision: projectRevision },
      { ref: workspaceRef, revision: workspaceRevision },
      { ref: goalRef, revision: goalRevision },
      { ref: queryJobRef, revision: 0 },
      { ref: queryRunRef, revision: 0 },
    ] } } };
  const submitted = await executionCall(scope, run, 'queries/submit', submitRequest);
  const submitProblem = outcomeProblem(submitted);
  if (submitProblem !== null) { run.error = submitProblem; return; }
  const submittedPayload = payloadOf(submitted) as QueriesSubmitResponse;
  if (submittedPayload.status !== 'committed') {
    run.error = `提交调查未成功：${outcomeRejectionReason(submittedPayload)}`;
    return;
  }
  // Use the REAL submitted Job/Run refs and revisions for the claim guards.
  run.queryJobRef = submittedPayload.value.job.ref;
  run.queryRunRef = submittedPayload.value.run.ref;
  run.jobRevision = submittedPayload.value.job.revision;
  run.runRevision = submittedPayload.value.run.revision;

  const claimRequest = { scope: target, request: { input: {
    queryRunRef: submittedPayload.value.run.ref, sessionRef: session }, meta: {
    requestId: executionRequestId(run, 'queries/claim'),
    expected: [
      { ref: submittedPayload.value.job.ref, revision: submittedPayload.value.job.revision },
      { ref: submittedPayload.value.run.ref, revision: submittedPayload.value.run.revision },
      { ref: run.sessionRef, revision: run.sessionRevision ?? 0 },
    ] } } };
  const claimed = await executionCall(scope, run, 'queries/claim', claimRequest);
  const claimProblem = outcomeProblem(claimed);
  if (claimProblem !== null) { run.error = claimProblem; return; }
  if (record(payloadOf(claimed)).status !== 'committed') {
    run.error = `领取调查未成功：${outcomeRejectionReason(payloadOf(claimed))}`;
    return;
  }

  const prepared = await executionCall(scope, run, 'queries/prepare', { scope: target, input: {
    queryRunRef: run.queryRunRef, requestId: executionRequestId(run, 'queries/prepare') } });
  const prepareProblem = outcomeProblem(prepared);
  if (prepareProblem !== null) { run.error = prepareProblem; return; }
  const preparedPayload = payloadOf(prepared) as QueriesPrepareResponse;
  if (preparedPayload.status !== 'ready') {
    run.error = `调查准备未就绪：${outcomeRejectionReason(preparedPayload)}`;
    return;
  }

  const startRequest = { scope: target, input: {
    prepared: preparedPayload.value, consumerId: profile.consumerId, requestId: executionRequestId(run, 'queries/start') } };
  const started = await executionCall(scope, run, 'queries/start', startRequest);
  const startProblem = outcomeProblem(started);
  if (startProblem !== null) { run.error = startProblem; return; }
  const startedPayload = payloadOf(started) as QueriesStartResponse;
  if (startedPayload.status !== 'ready') {
    run.error = `调查启动未就绪：${outcomeRejectionReason(startedPayload)}`;
    return;
  }
  let execution = startedPayload.value;
  if (execution.answer === null) {
    // Explicit observation only: it never re-sends the model.
    const observed = await executionCall(scope, run, 'queries/observe', { scope: target, input: { queryRunRef: run.queryRunRef } });
    const observedPayload = payloadOf(observed) as QueriesStartResponse;
    if (outcomeProblem(observed) === null && observedPayload.status === 'ready') execution = observedPayload.value;
  }
  if (execution.answer === null) {
    run.notice = queryNoAnswerNotice({
      outcome: execution.run.run.outcome,
      phase: execution.run.run.executionState?.phase ?? null,
      status: execution.run.run.status,
    });
    return;
  }
  const readOk = await readExecutionAnswer(scope, run, target, execution.answer.ref);
  if (!readOk || run.kind !== 'planning') return;
  const answer = run.answer;
  if (answer === null || answer.status !== 'ready') return;
  if (answer.value.answer.stale) {
    run.notice = `回答已标记为过期（${answer.value.answer.staleReason ?? '来源变化'}），未继续规划。`;
    return;
  }
  // The planning hint stays null: the original Workflow owner chooses the work
  // Session from its own configuration, so the advisor Session is never rebound.
  const planningInput: PlanningAnswerInput = {
    schemaVersion: 1, goalRef, flowId: run.flowId ?? '', sessionHint: null, executeWithinRequest: true,
    kind: 'planning_answer',
    request: { meta: { requestId: executionRequestId(run, 'workflow/goal-input:planning'), expected: [] },
      input: { answerRef: answer.value.ref, reason: { text: answer.value.answer.answer, sources: [] } } },
  };
  await drainContinuation(scope, run, target, { route: 'workflow/goal-input', input: planningInput });
  // Recover the readable setup candidate from the saved Answer (never memory).
  await loadPlanCandidate(scope);
  renderScopeIfSelected(scope);
}

/** Narrow OPTIONAL frozen recipient intent for `runExecution`. When present it
 * overrides the live selection (first-Send continuation must not follow a later
 * member click); when absent every explicit existing action keeps the current
 * selection. It is not a second execution pipeline. */
type FrozenExecutionTarget = { fromMain: boolean; selectedSession: SessionRef | null };

/** Start a fresh investigation/planning action. Scope, Goal, question and the
 * selected Session are frozen into the run before the first await. */
async function runExecution(scope: ScopeState, kind: 'investigate' | 'planning',
  frozenTarget?: FrozenExecutionTarget): Promise<void> {
  if (scope.execution.running || scope.execution.pending !== null) return;
  // A new QueryFlow/Goal owns the panel: stop only the page's old read timer.
  // The Host driver itself keeps running.
  if (scope.collaborationPoll !== null) { clearInterval(scope.collaborationPoll); scope.collaborationPoll = null; }
  scope.collaborationEpoch += 1;
  const profile = selectedExecutionProfile(scope);
  const fromMain = frozenTarget?.fromMain ?? (scope.activeSession === null);
  const selectedSession = frozenTarget !== undefined
    ? frozenTarget.selectedSession : (scope.activeSession ?? scope.mainSession);
  const target: CoreScope = profile === null
    ? { projectId: scope.config.scope.projectId, workspaceId: scope.config.scope.workspaceId }
    : { projectId: profile.scope.projectId, workspaceId: profile.scope.workspaceId };
  const goalId = scope.forms.goalId.trim() || scope.goal?.ref.goalId || reviewGoals()[0]?.goalId || '';
  const question = scope.forms.question.trim() || '请阅读当前来源并给出正式回答';
  requestCounter += 1;
  const flowId = `flow-${Date.now().toString(36)}-${requestCounter.toString(36)}`;
  const run = createExecutionRun();
  run.kind = kind;
  run.flowId = flowId;
  run.scope = target;
  run.question = question;
  run.profile = profile;
  run.selectedSession = selectedSession;
  run.goalRef = goalId.length === 0 ? null : { aggregateType: 'Goal', projectId: target.projectId, goalId };
  scope.execution = run;
  scope.executionNotice = null;
  scope.error = null;
  scope.notice = null;
  await driveRun(scope, run, (current, active) => executeQueryFlow(current, active));
  if (fromMain && run.sessionRef !== null) {
    scope.mainSession = plainSessionRef(run.sessionRef);
    saveScopeDisplay(scope);
    // Read the persisted original Session history back into the center, so the
    // main conversation shows the real conversation rather than only this run.
    const ref = run.sessionRef;
    await submit(scope, 'sessions/history', buildSessionHistoryRequest(scope.config.scope, ref, null, false, CENTER_HISTORY_LIMIT),
      tagsFor(ref, null, null, null, null, centerSessionHistoryKey(ref)));
  }
  if (run.sessionRef !== null) {
    await submit(scope, 'sessions/read', buildSessionReadRequest(scope.config.scope, run.sessionRef), tagsFor(run.sessionRef));
    await submit(scope, 'sessions/find', { scope: scope.config.scope,
      input: { workspace: scope.config.scope, includeArchived: scope.sessionIncludeArchived, page: { limit: 10 } } });
  }
}

/** Choose the displayed Task before any driver lookup. Other Task handles stay
 * on the Host; an unconfirmed browser request is never discarded. */
function selectExecutionTask(scope: ScopeState): ExecutionRun {
  const previous = scope.execution;
  const taskId = scope.forms.taskId.trim() || null;
  if (previous.running || previous.pending !== null || previous.taskId === taskId) return previous;
  const run = createExecutionRun();
  run.scope = previous.scope;
  run.goalRef = collaborationGoalRef(scope, previous);
  run.selectedSession = scope.activeSession;
  run.taskId = taskId;
  scope.execution = run;
  scope.collaborationEpoch += 1;
  if (scope.collaborationPoll !== null) clearInterval(scope.collaborationPoll);
  scope.collaborationPoll = null;
  scope.collaboration = null;
  return run;
}

/** The explicit "continue" action. It never creates a new flow or a Query
 * Session: it resends a saved continuation, or falls back to the original
 * select_work when there is no saved continuation. */
async function continueExecution(scope: ScopeState): Promise<void> {
  const run = selectExecutionTask(scope);
  if (run.running || run.pending !== null) return;
  const target: CoreScope = run.scope
    ?? { projectId: scope.config.scope.projectId, workspaceId: scope.config.scope.workspaceId };
  run.scope = target;
  if (run.selectedSession === null) run.selectedSession = scope.activeSession;
  if (run.goalRef === null) {
    const goalId = scope.forms.goalId.trim() || scope.goal?.ref.goalId || reviewGoals()[0]?.goalId || '';
    if (goalId.length > 0) run.goalRef = { aggregateType: 'Goal', projectId: target.projectId, goalId };
  }
  const resume = run.resumeIntent;
  if (resume === null && run.goalRef === null) {
    scope.error = '没有可继续的目标或待续传步骤；请先创建目标并采用计划。';
    renderScopeIfSelected(scope);
    return;
  }
  scope.error = null;
  scope.notice = null;
  run.notice = null;
  // A saved continuation belongs to the Goal that produced it. If the user has
  // since chosen a DIFFERENT Goal, never send the old Goal's request under the
  // new selection: keep the original unconfirmed payload and idempotency, and
  // ask the user to switch back. No multi-Goal state store is introduced.
  const currentGoal = collaborationGoalRef(scope, run);
  if (resume !== null && currentGoal !== null) {
    const resumeGoal = resume.input.goalRef;
    if (resumeGoal.projectId !== currentGoal.projectId || resumeGoal.goalId !== currentGoal.goalId) {
      run.notice = `待续请求属于目标 ${resumeGoal.goalId}，与当前目标 ${currentGoal.goalId} 不同；`
        + '请切回原目标后再继续，原请求与幂等身份均已保留。';
      renderScopeIfSelected(scope);
      return;
    }
  }
  if (resume !== null && resume.route === 'workflow/goal-input') {
    // Explicit NEW action: same Goal/flow and same public input semantics, a NEW
    // requestId. The old idempotency key is never reused with different expected.
    run.resumeCount += 1;
    const pendingAdopt = resume.input as AdoptInitialPlanInput;
    const input: AdoptInitialPlanInput = {
      ...pendingAdopt,
      request: { ...pendingAdopt.request, meta: { ...pendingAdopt.request.meta,
        requestId: executionRequestId(run, `workflow/goal-input:resume:${run.resumeCount}`) } },
    };
    await driveRun(scope, run, (current, active) =>
      drainContinuation(current, active, target, { route: 'workflow/goal-input', input }));
    return;
  }
  // The Host may already own this Goal's handle: read it BEFORE restarting so a
  // navigation/reload never starts a second advancement.
  const existingGoal = collaborationGoalRef(scope, run);
  if (existingGoal !== null) {
    run.goalRef = existingGoal;
    const epoch = scope.collaborationEpoch + 1;
    scope.collaborationEpoch = epoch;
    await readCollaboration(scope, target, existingGoal, epoch);
    if (scope.collaboration !== null && collaborationIsActive(scope.collaboration.result)) {
      if (scope.collaboration.result.status === 'ready') run.phase = scope.collaboration.result.value.state;
      beginCollaborationPoll(scope, target, scope.collaboration.goalRef);
      return;
    }
  }
  if (resume !== null && resume.route === 'workflow/advance') {
    await startCollaboration(scope, run, target, resume.input);
    return;
  }
  if (run.goalRef === null) {
    scope.error = '请先选择目标。';
    renderScopeIfSelected(scope);
    return;
  }
  // A formal pending Plan must never be bypassed by select_work: when the reload
  // lost the continuation, reconstruct the EXISTING adopt_initial_plan request
  // from the current pending proposal and the real Goal revision.
  if (resume === null) {
    const reconstructed = reconstructAdoptInitialPlan(scope);
    if (reconstructed !== null) {
      await driveRun(scope, run, (current, active) =>
        drainContinuation(current, active, target, { route: 'workflow/goal-input', input: reconstructed }));
      return;
    }
  }
  // No saved continuation and no pending Plan: the original select_work is the
  // only resume. It is independent of any Query profile; the explicit work-Session
  // selection (if any) is passed through so the owner reports its compatibility.
  run.taskId = scope.forms.taskId.trim().length === 0 ? null : scope.forms.taskId.trim();
  const input: WorkflowAdvanceInput = {
    schemaVersion: 1, goalRef: run.goalRef, flowId: run.flowId ?? `flow-${Date.now().toString(36)}`,
    sessionHint: run.selectedSession, kind: 'select_work',
    ...(run.taskId === null ? {} : { taskId: run.taskId }),
  };
  await startCollaboration(scope, run, target, input);
}

/** Resend the exact unconfirmed request and, once its real receipt arrives,
 * continue along the SAME driver (replaying the confirmed buffer). Never
 * rebuilds flow/job/run/session/requestId/budget/expected. */
async function retryExecution(scope: ScopeState): Promise<void> {
  const run = scope.execution;
  const pending = run.pending;
  if (pending === null || run.running) return;
  const failedIndex = run.pendingIndex ?? run.callIndex - 1;
  scope.sending = true;
  run.error = null;
  renderScopeIfSelected(scope);
  const outcome = await callCore(pending.route, pending.request);
  scope.sending = false;
  if (outcome.kind === 'network') {
    scope.error = '连接中断，未收到回执。可重新发送原请求（内容保持不变）。';
    renderScopeIfSelected(scope);
    return;
  }
  scope.pending = null;
  run.pending = null;
  run.pendingIndex = null;
  if (failedIndex >= 0 && run.calls[failedIndex] !== undefined) run.calls[failedIndex]!.outcome = outcome;
  run.callIndex = run.driverStart;
  const driver = run.driver;
  if (driver === null) {
    run.error = '原执行入口已丢失，请重新发起。';
    renderScopeIfSelected(scope);
    return;
  }
  await driveRun(scope, run, driver);
}

/** Re-read the original Query OR the Host collaboration handle; it never starts
 * a new model call and never depends on a browser QueryRunRef. */
async function refreshExecution(scope: ScopeState): Promise<void> {
  const run = selectExecutionTask(scope);
  if (run.running) return;
  if (run.pending !== null) {
    scope.notice = '存在尚未确认的原请求，请先“重新发送原请求”。';
    renderScopeIfSelected(scope);
    return;
  }
  const target: CoreScope = run.scope ?? { projectId: scope.config.scope.projectId, workspaceId: scope.config.scope.workspaceId };
  // Prefer the CURRENT Host collaboration handle for this Goal; the legacy
  // browser Query is only a fallback when no Goal-driven handle exists.
  const goalRef = collaborationGoalRef(scope, run) ?? scope.collaboration?.goalRef ?? null;
  if (goalRef !== null) {
    run.goalRef = goalRef;
    const epoch = scope.collaborationEpoch + 1;
    scope.collaborationEpoch = epoch;
    await readCollaboration(scope, target, goalRef, epoch);
    if (scope.collaboration !== null && scope.collaboration.result.status === 'ready') {
      beginCollaborationPoll(scope, target, goalRef);
      return;
    }
  }
  if (run.queryRunRef !== null) {
    const ref = run.queryRunRef;
    await driveRun(scope, run, async (current, active) => {
      const observed = await executionCall(current, active, 'queries/observe', { scope: target, input: { queryRunRef: ref } });
      const problem = outcomeProblem(observed);
      if (problem !== null) { active.error = problem; return; }
      const observedPayload = payloadOf(observed) as QueriesStartResponse;
      if (observedPayload.status !== 'ready') { active.notice = '调查状态尚未就绪。'; return; }
      if (observedPayload.value.answer === null) { const observedRun = observedPayload.value.run.run; active.notice = queryNoAnswerNotice({ outcome: observedRun.outcome, phase: observedRun.executionState?.phase ?? null, status: observedRun.status }); return; }
      await readExecutionAnswer(current, active, target, observedPayload.value.answer.ref);
    });
    return;
  }
  scope.notice = '没有进行中的调查或协同推进。';
  renderScopeIfSelected(scope);
}


// ---------------------------------------------------------------------------
// MVP UI connection consumers.
//
// New Goal cold start, member mail with consumeConsultation, Kernel file CAS,
// explicit command handles and the bounded execution list that feeds the
// timeline, the Task fold and the active-module computation. Every identity and
// original body is frozen before the first await; no error text is parsed and no
// revision is guessed.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Scope display-identity seam: each scope owns its own display-id record, so a
// write for scope B in another tab can never erase scope A. Only lastscope/theme
// are global. These are display ids only: never a body, token or owner fact.
// ---------------------------------------------------------------------------

/** Legacy single-record key; its explicit `scopeKey` is the only scope its ids
 * may migrate to, and it never overwrites an existing v2 record. */
export const DISPLAY_PREFERENCE_V1_KEY = 'workbench.display-preference.v1';

const DISPLAY_PREFERENCE_V2_SCOPE_PREFIX = 'workbench.display-preference.v2.scope:';
const DISPLAY_PREFERENCE_V2_GLOBAL_KEY = 'workbench.display-preference.v2.global';

/** Display ids for ONE scope. Never a body, token or business fact. */
export type ScopeDisplayIds = {
  goalId: string | null;
  sessionId: string | null;
  mainSessionId: string | null;
};

/** The only shared (global) display fields. */
export type GlobalDisplayPreference = {
  lastScopeKey: string | null;
  theme: 'light' | 'dark' | 'system' | null;
};

/** Injectable storage boundary; the browser passes localStorage. */
export type DisplayPreferenceStorage = {
  get(key: string): string | null;
  set(key: string, value: string): void;
};

/** Formal read port: exactly `goals/read` + `sessions/read`. A missing or
 * mismatched id resolves null. It can only display, never submit/claim/create. */
export type ScopeDisplayReadPort = {
  readGoal(goalId: string): Promise<{ status: 'ready'; value: unknown } | null>;
  readSession(sessionId: string): Promise<{ status: 'ready'; value: unknown } | null>;
};

/** The real owner payloads applied for ONE scope, not just the restored forms. */
export type ScopeDisplayRestore = {
  goalId: string | null;
  sessionId: string | null;
  mainSessionId: string | null;
  goalRead: unknown | null;
  sessionRead: unknown | null;
  mainSessionRead: unknown | null;
};

export type ScopeDisplayStore = {
  /** Persist ids for the ORIGINAL scope and start a new selection generation. */
  save(origin: CoreScope, ids: ScopeDisplayIds): void;
  /** Read one scope's ids, migrating an explicit old-v1 scopeKey exactly once. */
  load(scope: CoreScope): ScopeDisplayIds;
  readGlobal(): GlobalDisplayPreference;
  writeGlobal(global: GlobalDisplayPreference): void;
  /** Restore through formal reads for THIS scope. A late response for a
   * superseded selection resolves null; a missing/mismatched read is no success. */
  restore(scope: CoreScope, read: ScopeDisplayReadPort): Promise<ScopeDisplayRestore | null>;
};

const emptyDisplayIds = (): ScopeDisplayIds => ({ goalId: null, sessionId: null, mainSessionId: null });

function displayIdsOfRecord(value: unknown): ScopeDisplayIds {
  const source = record(value);
  return {
    goalId: typeof source.goalId === 'string' ? source.goalId : null,
    sessionId: typeof source.sessionId === 'string' ? source.sessionId : null,
    mainSessionId: typeof source.mainSessionId === 'string' ? source.mainSessionId : null,
  };
}

const displayThemeOf = (value: unknown): GlobalDisplayPreference['theme'] =>
  value === 'light' || value === 'dark' || value === 'system' ? value : null;

function displayGlobalOfRecord(value: unknown): GlobalDisplayPreference {
  const source = record(value);
  return {
    lastScopeKey: typeof source.lastScopeKey === 'string' ? source.lastScopeKey : null,
    theme: displayThemeOf(source.theme),
  };
}

/** The formal read payloads carry the ref inside `value.goal` (GoalDetail) and
 * `value.record` (SessionCard); `value` itself is never an id. */
function readPayloadGoalId(payload: { value: unknown }): string | null {
  const ref = record(record(record(payload.value).goal).ref);
  return typeof ref.goalId === 'string' ? ref.goalId : null;
}

function readPayloadSessionId(payload: { value: unknown }): string | null {
  const ref = record(record(record(payload.value).record).ref);
  return typeof ref.sessionId === 'string' ? ref.sessionId : null;
}

export function createScopeDisplayStore(storage: DisplayPreferenceStorage): ScopeDisplayStore {
  const generations = new Map<string, number>();
  const scopeStorageKey = (scope: CoreScope): string => DISPLAY_PREFERENCE_V2_SCOPE_PREFIX + scopeKey(scope);
  const readLegacy = (): Record<string, unknown> | null => {
    try {
      const raw = storage.get(DISPLAY_PREFERENCE_V1_KEY);
      return raw === null ? null : record(JSON.parse(raw));
    } catch { return null; }
  };
  const loadIds = (scope: CoreScope): ScopeDisplayIds => {
    const key = scopeKey(scope);
    const storageKey = scopeStorageKey(scope);
    try {
      const raw = storage.get(storageKey);
      if (raw !== null) return displayIdsOfRecord(JSON.parse(raw));
    } catch { /* malformed entry falls back to migration/empty */ }
    // A scope's old v1 ids migrate ONLY to the scope named by its scopeKey.
    const legacy = readLegacy();
    if (legacy === null || legacy.scopeKey !== key) return emptyDisplayIds();
    const ids = displayIdsOfRecord(legacy);
    try { storage.set(storageKey, JSON.stringify(ids)); } catch { /* storage disabled */ }
    return ids;
  };
  const readGlobal = (): GlobalDisplayPreference => {
    try {
      const raw = storage.get(DISPLAY_PREFERENCE_V2_GLOBAL_KEY);
      if (raw !== null) return displayGlobalOfRecord(JSON.parse(raw));
    } catch { /* malformed entry falls back to migration/empty */ }
    // Startup migrates the old v1 lastscope/theme into the global key only.
    const legacy = readLegacy();
    const migrated = displayGlobalOfRecord(legacy === null ? {} : { lastScopeKey: legacy.scopeKey, theme: legacy.theme });
    if (legacy !== null) {
      try { storage.set(DISPLAY_PREFERENCE_V2_GLOBAL_KEY, JSON.stringify(migrated)); } catch { /* storage disabled */ }
    }
    return migrated;
  };
  return {
    save(origin, ids) {
      const key = scopeKey(origin);
      generations.set(key, (generations.get(key) ?? 0) + 1);
      try { storage.set(scopeStorageKey(origin), JSON.stringify(displayIdsOfRecord(ids))); } catch { /* storage disabled */ }
    },
    load: loadIds,
    readGlobal,
    writeGlobal(global) {
      // Global has its OWN key, so this can never touch a scope record.
      try { storage.set(DISPLAY_PREFERENCE_V2_GLOBAL_KEY, JSON.stringify(displayGlobalOfRecord(global))); } catch { /* storage disabled */ }
    },
    async restore(scope, read) {
      const key = scopeKey(scope);
      const start = generations.get(key) ?? 0;
      const superseded = (): boolean => (generations.get(key) ?? 0) !== start;
      const stored = loadIds(scope);
      if (superseded()) return null;
      let goalId: string | null = null; let goalRead: unknown | null = null;
      let sessionId: string | null = null; let sessionRead: unknown | null = null;
      let mainSessionId: string | null = null; let mainSessionRead: unknown | null = null;
      if (stored.goalId !== null) {
        const payload = await read.readGoal(stored.goalId);
        if (superseded()) return null;
        if (payload !== null && payload.status === 'ready' && readPayloadGoalId(payload) === stored.goalId) {
          goalId = stored.goalId; goalRead = payload;
        }
      }
      const readSession = async (wanted: string): Promise<{ id: string; payload: unknown } | null> => {
        const payload = await read.readSession(wanted);
        if (superseded()) return null;
        return payload !== null && payload.status === 'ready' && readPayloadSessionId(payload) === wanted
          ? { id: wanted, payload } : null;
      };
      if (stored.sessionId !== null) {
        const hit = await readSession(stored.sessionId);
        if (hit === null && superseded()) return null;
        if (hit !== null) { sessionId = hit.id; sessionRead = hit.payload; }
      }
      if (stored.mainSessionId !== null) {
        const hit = await readSession(stored.mainSessionId);
        if (hit === null && superseded()) return null;
        if (hit !== null) { mainSessionId = hit.id; mainSessionRead = hit.payload; }
      }
      if (goalId === null && sessionId === null && mainSessionId === null) return null;
      return { goalId, sessionId, mainSessionId, goalRead, sessionRead, mainSessionRead };
    },
  };
}
/** The page's single store; localStorage is touched lazily so importing this
 * module in Node never reads `window`. */
const displayPreferenceStore = createScopeDisplayStore({
  get: key => { try { return window.localStorage.getItem(key); } catch { return null; } },
  set: (key, value) => { try { window.localStorage.setItem(key, value); } catch { /* storage disabled */ } },
});

function displayIdsOf(scope: ScopeState): ScopeDisplayIds {
  const goalId = scope.forms.goalId.trim();
  return {
    goalId: goalId.length > 0 ? goalId : null,
    sessionId: scope.activeSession?.sessionId ?? null,
    mainSessionId: scope.mainSession?.sessionId ?? null,
  };
}

/** Persist the display ids for the EXACT scope the caller acted on. */
function saveScopeDisplay(scope: ScopeState): void {
  displayPreferenceStore.save(scope.config.scope, displayIdsOf(scope));
}

/** Persist only the global lastscope/theme; a theme toggle is not a selection. */
function saveGlobalDisplay(): void {
  displayPreferenceStore.writeGlobal({
    lastScopeKey: selectedKey.length > 0 ? selectedKey : null,
    theme: view.theme,
  });
}

const projectRefFor = (projectId: string) => ({ aggregateType: 'Project' as const, projectId });
const workspaceRefFor = (scope: CoreScope) =>
  ({ aggregateType: 'Workspace' as const, projectId: scope.projectId, workspaceId: scope.workspaceId });

/** Serialize the composer draft plus every real reference into the ONE request
 * text actually sent. A draft snapshot carries the exact selected text, path,
 * span, version and digest, so the receiver can tell a draft snapshot from the
 * saved file. Adding a reference alone never sends anything. */
function composeRequestText(layout: WorkbenchLayout): string {
  const base = layout.composerDraft.text;
  const references = layout.composerDraft.references;
  if (references.length === 0) return base;
  const blocks = references.map(reference => reference.kind === 'path'
    ? `[引用文件] ${reference.path}`
    : `[引用选区] ${reference.path}:L${reference.startLine}-L${reference.endLine}`
      + ` version=${JSON.stringify(reference.version)} digest=${reference.digest} source=${reference.source}`
      + `\n\u0060\u0060\u0060\n${reference.text}\n\u0060\u0060\u0060`);
  return `${base}\n\n${blocks.join('\n\n')}`;
}

function setupRequestId(run: GoalSetupRun, key: string): string {
  const existing = run.requestIds[key];
  if (existing !== undefined) return existing;
  const value = freshRequestId(key);
  run.requestIds[key] = value;
  return value;
}

function createGoalSetup(objective: string): GoalSetupRun {
  requestCounter += 1;
  return { running: false, objective, goalId: `goal-${Date.now().toString(36)}-${requestCounter.toString(36)}`,
    requestIds: {}, calls: [], callIndex: 0, pendingIndex: null, pending: null, driver: null,
    project: null, workspace: null, goal: null, step: null, error: null, notice: null };
}

async function setupCall(scope: ScopeState, run: GoalSetupRun, route: CoreRouteSuffix, request: unknown): Promise<CallOutcome> {
  const index = run.callIndex;
  run.callIndex += 1;
  let call = run.calls[index];
  if (call === undefined) { call = { route, request, outcome: null }; run.calls.push(call); }
  else { call.route = route; request = call.request; }
  if (call.outcome !== null) return call.outcome;
  run.pending = { route, request };
  scope.sending = true;
  scope.pending = null;
  renderScopeIfSelected(scope);
  const outcome = await callCore(route, request);
  scope.sending = false;
  if (outcome.kind === 'network') {
    run.pendingIndex = index;
    scope.pending = { route, body: request, tags: noTags };
    renderScopeIfSelected(scope);
    return outcome;
  }
  scope.pending = null;
  run.pending = null;
  run.pendingIndex = null;
  call.outcome = outcome;
  return outcome;
}

async function runGoalSetup(scope: ScopeState, retry = false): Promise<void> {
  const text = scope.goalObjective.trim();
  if (text.length === 0) { scope.error = '请先写下目标正文（不是内部标识）。'; renderScopeIfSelected(scope); return; }
  if (scope.goalSetup !== null && scope.goalSetup.running) return;
  const previous = scope.goalSetup;
  if (!retry && previous?.pending !== null && previous?.pending !== undefined) {
    scope.error = '原目标请求结果未确认，请重试原请求，不能替换目标正文。'; renderScopeIfSelected(scope); return;
  }
  if (!retry && previous !== null && previous.goal === null && previous.objective !== text) {
    scope.error = '当前目标尚未建立完成，请保留原目标正文并完成原流程。'; renderScopeIfSelected(scope); return;
  }
  const run = previous === null || (!retry && previous.goal !== null) ? createGoalSetup(text) : previous;
  scope.goalSetup = run;
  // Replay the original ordered call buffer, including confirmed reads.
  run.callIndex = 0;
  run.project = null;
  run.workspace = null;
  run.running = true;
  run.error = null;
  run.notice = null;
  run.step = '读取项目登记';
  scope.error = null;
  scope.notice = null;
  renderScopeIfSelected(scope);
  try {
    await (run.driver ?? goalSetupDriver)(scope, run);
  } catch (error) {
    run.error = `新建目标中断：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    run.running = false;
    renderScopeIfSelected(scope);
  }
}

async function retryGoalSetup(scope: ScopeState): Promise<void> {
  const run = scope.goalSetup;
  if (run === null || run.pending === null || run.running) return;
  const pending = run.pending;
  const failedIndex = run.pendingIndex ?? run.callIndex - 1;
  scope.sending = true;
  renderScopeIfSelected(scope);
  const outcome = await callCore(pending.route, pending.request);
  scope.sending = false;
  if (outcome.kind === 'network') { scope.error = '连接中断，未收到回执。可重新发送原请求（内容保持不变）。'; renderScopeIfSelected(scope); return; }
  scope.pending = null;
  run.pending = null;
  run.pendingIndex = null;
  if (failedIndex >= 0 && run.calls[failedIndex] !== undefined) run.calls[failedIndex]!.outcome = outcome;
  run.callIndex = 0;
  await runGoalSetup(scope, true);
}

/** The frozen cold-start chain: narrow Project read -> (create) -> Workspace
 * registration read -> (register) -> goals/create. It never guesses revision 1
 * and never derives the Project's absence from an error message. */
async function goalSetupDriver(scope: ScopeState, run: GoalSetupRun): Promise<void> {
  run.driver = goalSetupDriver;
  const target = scope.config.scope;
  if (run.project === null) {
    const read = await setupCall(scope, run, 'projects/read', { scope: target, input: target.projectId });
    const problem = outcomeProblem(read);
    if (problem !== null) { run.error = problem; return; }
    const payload = payloadOf(read) as ProjectsReadResponse;
    if (payload.status === 'ready') {
      scope.project = payload.value as ProjectValue;
      run.project = { ref: payload.value.ref, revision: payload.value.revision };
      scope.projectReadState = { status: 'ready', projectId: payload.value.ref.projectId, revision: payload.value.revision };
    } else if (payload.status === 'not_found' || (payload.status === 'rejected' && payload.code === 'not_found')) {
      scope.projectReadState = { status: 'not_found' };
      run.step = '创建项目';
      const request = { scope: target, request: { input: { projectId: target.projectId },
        meta: { requestId: setupRequestId(run, 'projects/create'), expected: [{ ref: projectRefFor(target.projectId), revision: 0 }] } } };
      const created = await setupCall(scope, run, 'projects/create', request);
      const createProblem = outcomeProblem(created);
      if (createProblem !== null) { run.error = createProblem; return; }
      const createdBody = payloadOf(created);
      if (record(createdBody).status !== 'committed') { run.error = `创建项目未成功：${outcomeRejectionReason(createdBody)}`; return; }
      scope.project = record(createdBody).value as ProjectValue;
      const value = record(record(createdBody).value);
      run.project = { ref: value.ref ?? projectRefFor(target.projectId), revision: typeof value.revision === 'number' ? value.revision : 0 };
      scope.projectReadState = { status: 'ready', projectId: target.projectId, revision: run.project.revision };
    } else if (payload.status === 'rejected') {
      scope.projectReadState = { status: 'rejected', code: payload.code, reason: payload.reason };
      run.error = `项目读取未就绪（${payload.code}）：${payload.reason}`;
      return;
    } else {
      scope.projectReadState = { status: 'rejected', code: payload.status, reason: '项目投影尚未就绪' };
      run.error = '项目投影尚未就绪；不会猜测 revision，也不会继续。';
      return;
    }
  }
  if (run.workspace === null) {
    run.step = '读取工作区登记';
    const registration = await setupCall(scope, run, 'workspaces/registration', { scope: target, input: target });
    const problem = outcomeProblem(registration);
    if (problem !== null) { run.error = problem; return; }
    const payload = payloadOf(registration) as WorkspacesRegistrationResponse;
    if (payload.status === 'ready') {
      scope.project = payload.value.project;
      scope.workspace = payload.value.workspace;
      run.workspace = { ref: payload.value.workspace.ref, revision: payload.value.workspace.revision };
      if (run.project === null) run.project = { ref: payload.value.project.ref, revision: payload.value.project.revision };
    } else if (payload.status === 'not_found' || (payload.status === 'rejected' && payload.code === 'not_found')) {
      if (run.project === null) { run.error = '项目尚未就绪，无法登记工作区。'; return; }
      run.step = '登记工作区';
      const request = { scope: target, request: { input: { workspace: target },
        meta: { requestId: setupRequestId(run, 'workspaces/register'),
          expected: [{ ref: run.project.ref, revision: run.project.revision }, { ref: workspaceRefFor(target), revision: 0 }] } } };
      const created = await setupCall(scope, run, 'workspaces/register', request);
      const createProblem = outcomeProblem(created);
      if (createProblem !== null) { run.error = createProblem; return; }
      const createdBody = payloadOf(created);
      if (record(createdBody).status !== 'committed') { run.error = `工作区登记未成功：${outcomeRejectionReason(createdBody)}`; return; }
      scope.workspace = record(createdBody).value as WorkspaceValue;
      const value = record(record(createdBody).value);
      run.workspace = { ref: value.ref ?? workspaceRefFor(target), revision: typeof value.revision === 'number' ? value.revision : 0 };
    } else if (payload.status === 'rejected') {
      run.error = `工作区登记读取未就绪（${payload.code}）：${payload.reason}`;
      return;
    } else {
      run.error = '工作区登记投影尚未就绪；不会猜测 revision，也不会继续。';
      return;
    }
  }
  run.step = '创建目标';
  const goalRequest = { scope: target, request: { input: { goalId: run.goalId, workspace: target, objective: run.objective },
    meta: { requestId: setupRequestId(run, 'goals/create'),
      expected: [{ ref: run.project.ref, revision: run.project.revision }, { ref: run.workspace.ref, revision: run.workspace.revision }] } } };
  const goalOutcome = await setupCall(scope, run, 'goals/create', goalRequest);
  const goalProblem = outcomeProblem(goalOutcome);
  if (goalProblem !== null) { run.error = goalProblem; return; }
  const goalBody = payloadOf(goalOutcome);
  if (record(goalBody).status !== 'committed') { run.error = `创建目标未成功：${outcomeRejectionReason(goalBody)}`; return; }
  run.goal = record(goalBody).value;
  scope.goal = run.goal as GoalValue;
  scope.goalObjective = run.objective;
  scope.forms.goalId = run.goalId;
  run.step = '已创建';
  run.notice = '目标已创建，可以开始调查和规划。';
  saveScopeDisplay(scope);
}

// --- Bounded real execution list shared by the timeline/fold/active modules ---

function currentGoalRefForList(scope: ScopeState): TaskGraph['plan']['goalRef'] | null {
  const goalId = scope.forms.goalId.trim() || scope.goal?.ref.goalId || '';
  if (goalId.length === 0) return null;
  return { aggregateType: 'Goal', projectId: scope.config.scope.projectId, goalId };
}

async function loadExecutions(scope: ScopeState, next: boolean, requestedGoal?: TaskGraph['plan']['goalRef']): Promise<void> {
  const selectedTab = scope.auxTabs.find(tab => tab.tabId === scope.auxActiveTabId);
  const goalRef = requestedGoal ?? (selectedTab?.kind === 'task_graph' ? selectedTab.goal : currentGoalRefForList(scope));
  if (goalRef === null) { scope.error = '请先创建或选择目标。'; renderScopeIfSelected(scope); return; }
  const previous = scope.executionList;
  const sameGoal = previous?.goalRef.projectId === goalRef.projectId && previous.goalRef.goalId === goalRef.goalId;
  const afterCursor = next && sameGoal ? previous!.nextCursor : null;
  if (next && (previous === null || afterCursor === null)) { scope.notice = '执行列表没有更多页。'; renderScopeIfSelected(scope); return; }
  const reuse = next && previous !== null && sameGoal;
  const list: ExecutionListCache = reuse ? previous
    : { goalRef, items: [], nextCursor: null, readThrough: null, loading: true, error: null };
  list.loading = true;
  list.error = null;
  scope.executionList = list;
  renderScopeIfSelected(scope);
  const outcome = await callCore('executions/list', { scope: scope.config.scope, input: { goalRef, page: { afterCursor, limit: 50 } } });
  list.loading = false;
  if (outcome.kind === 'network') { list.error = `执行列表读取失败：${outcome.reason}`; renderScopeIfSelected(scope); return; }
  if (outcome.status === 403) { list.error = '连接已失效，请刷新页面。'; renderScopeIfSelected(scope); return; }
  const payload = payloadOf(outcome) as ExecutionsListResponse;
  if (payload.status !== 'ready') {
    list.error = `执行列表未就绪（${payload.status}）：${payload.status === 'rejected' ? payload.reason : ''}`;
    renderScopeIfSelected(scope);
    return;
  }
  const seen = new Set(list.items.map(item => taskTimelineRunKey(item.run.ref)));
  for (const item of payload.value.items) {
    const key = taskTimelineRunKey(item.run.ref);
    if (seen.has(key)) continue;
    seen.add(key);
    list.items.push(item);
  }
  list.nextCursor = payload.value.nextCursor;
  list.readThrough = payload.value.readThrough;
  renderScopeIfSelected(scope);
}

/** Active modules from real Session links/occupancy plus running Task
 * executions. Containment never comes from paths; this only names the modules. */
function computeActiveModuleIds(scope: ScopeState): string[] {
  const active = new Set<string>();
  const cards = scope.sessionFind !== null && scope.sessionFind.status === 'ready' ? scope.sessionFind.value.items : [];
  const runningTasks = new Set((scope.executionList?.items ?? [])
    .filter(item => item.run.status !== 'ended').map(item => item.run.task.taskId));
  for (const card of cards) {
    if (card.record.lifecycle !== 'active') continue;
    const busy = card.availability === 'busy' || card.record.occupancy !== null;
    const linkedRunningTask = card.links.some(link =>
      link.ref.target.kind === 'task' && runningTasks.has(link.ref.target.ref.taskId));
    if (!busy && !linkedRunningTask) continue;
    for (const link of card.links) if (link.ref.target.kind === 'module') active.add(link.ref.target.ref.moduleId);
  }
  return [...active];
}

function toggleContainment(scope: ScopeState, moduleId: string): void {
  if (moduleId.length === 0) return;
  const expanded = scope.containment.expanded;
  scope.containment.expanded = expanded.includes(moduleId)
    ? expanded.filter(id => id !== moduleId) : [...expanded, moduleId];
  renderScopeIfSelected(scope);
}

// --- Member mail: action_request + needsReply, then consumeConsultation -------

async function deliverMemberRequest(scope: ScopeState, recipient: SessionRef, request: unknown, submittedText: string): Promise<void> {
  const conversation = conversationKey(recipient);
  const mail = scope.memberMail;
  if (mail === null) return;
  scope.error = null;
  scope.notice = null;
  renderScopeIfSelected(scope);
  const outcome = await callCore('messages/send', request);
  if (outcome.kind === 'network') {
    if (mail !== null) { mail.sendState = 'failed'; mail.note = '保存结果未确认；原请求已保留，可重试原 body。'; }
    scope.error = '连接中断，未收到回执。';
    renderScopeIfSelected(scope);
    return;
  }
  if (outcome.status === 403) {
    if (mail !== null) { mail.sendState = 'failed'; mail.note = '连接已失效，请刷新页面。'; }
    renderScopeIfSelected(scope);
    return;
  }
  const payload = payloadOf(outcome) as MessagesSendResponse;
  const envelope = record(payload);
  if (envelope.status !== 'committed') {
    // A CONFIRMED owner rejection is not a transport unknown: keep the draft but
    // clear the frozen invalid body and allow a corrected NEW send/body/key.
    mail.sendState = 'rejected';
    mail.request = null;
    mail.note = `保存被拒绝：${outcomeRejectionReason(payload)}；正文已保留，可修改后重新发送（不会重放被拒 body）。`;
    scope.error = mail.note;
    renderScopeIfSelected(scope);
    return;
  }
  const ref = record(record(envelope.value).ref) as unknown as MessageRefValue;
  // Clear ONLY the captured recipient draft, and only while it still holds
  // exactly what was submitted. Another conversation with identical text is
  // never touched, and a late response can never erase newer typing.
  const candidate = scope.drafts.get(mail.draftKey);
  if (candidate !== undefined && JSON.stringify(candidate) === mail.submittedDraft) {
    scope.drafts.set(mail.draftKey, { ...candidate, text: '', references: [] });
  }
  mail.messageRef = ref; mail.sendState = 'saved'; mail.note = '已保存。持久化成功不等于已处理或已回答。';
  scope.activeMessage = ref;
  renderScopeIfSelected(scope);
  await consultMemberMessage(scope, recipient, ref);
  // Read the ORIGINAL Session history back, so the center shows the persisted
  // conversation rather than only this run's latest object.
  await submit(scope, 'sessions/history',
    buildSessionHistoryRequest(scope.config.scope, recipient, null, false, CENTER_HISTORY_LIMIT),
    tagsFor(recipient, null, null, null, null, centerSessionHistoryKey(recipient)));
}

async function sendMemberMessage(scope: ScopeState, recipientArg?: SessionRef): Promise<void> {
  if (scope.memberMail?.sendState === 'saving' || scope.memberMail?.sendState === 'failed' || scope.memberMail?.consultState === 'running') { scope.error = '请先完成或重试原来信请求。'; renderScopeIfSelected(scope); return; }
  const selectedRecipient = recipientArg ?? scope.activeSession;
  if (selectedRecipient === null) { scope.error = '请先选择成员。'; renderScopeIfSelected(scope); return; }
  const recipient = plainSessionRef(selectedRecipient);
  const layout = syncActiveLayout(scope);
  if (layout.readOnly) { scope.error = '归档会话只读，不能发送消息。'; renderScopeIfSelected(scope); return; }
  const submittedText = layout.composerDraft.text;
  const text = composeRequestText(layout).trim();
  if (text.length === 0) { scope.error = '请输入消息内容。'; renderScopeIfSelected(scope); return; }
  // The exact body is frozen BEFORE the first await; a retry replays this body.
  const request = { scope: scope.config.scope, request: { input: { recipient, text,
    intent: 'action_request' as const, needsReply: true }, meta: { requestId: freshRequestId('messages/send'), expected: [] } } };
  const placeholderRef: MessageRefValue = { aggregateType: 'SessionMessage', projectId: recipient.projectId,
    workspaceId: scope.config.scope.workspaceId, messageId: 'pending' };
  scope.memberMail = { session: recipient, messageRef: placeholderRef, request,
    draftKey: conversationKey(scope.activeSession), submittedDraft: JSON.stringify(layout.composerDraft),
    profile: profileForMember(scope, recipient), goalId: currentConsultationGoalId(scope), sendState: 'saving', consultState: 'idle',
    consultation: null, note: '正在保存来信…' };
  await deliverMemberRequest(scope, recipient, request, submittedText);
}

async function retryMemberSend(scope: ScopeState): Promise<void> {
  const mail = scope.memberMail;
  if (mail === null || mail.request === null || mail.sendState !== 'failed') return;
  const layout = syncActiveLayout(scope);
  const submittedText = layout.composerDraft.text;
  mail.sendState = 'saving';
  mail.note = '正在重新发送原请求…';
  renderScopeIfSelected(scope);
  await deliverMemberRequest(scope, mail.session, mail.request, submittedText);
}

/** The exact SessionCard known for a member, from a matching detail read or the
 * directory page. A wrong/missing card is a real unknown, never a blind pick. */
function sessionCardFor(scope: ScopeState, ref: SessionRef): SessionCard | null {
  const mainRead = scope.mainSessionRead;
  if (mainRead !== null && sameSession(mainRead.session, ref))
    return mainRead.result.status === 'ready' ? mainRead.result.value : null;
  const read = scope.sessionRead;
  if (read !== null && sameSession(read.session, ref) && read.result.status === 'ready') return read.result.value;
  const found = scope.sessionFind;
  if (found !== null && found.status === 'ready') {
    return found.value.items.find(card => card.record.ref.sessionId === ref.sessionId) ?? null;
  }
  return null;
}

/** Match the selected member's real role against the same-scope profiles. It
 * never blindly picks the first profile; an ambiguous or absent match is a real
 * gap that the caller reports instead of guessing. */
function profileForMember(scope: ScopeState, ref: SessionRef): BootstrapExecutionQueryProfile | null {
  const profiles = (bootstrapState?.execution.queryProfiles ?? []).filter(profile =>
    profile.scope.projectId === scope.config.scope.projectId && profile.scope.workspaceId === scope.config.scope.workspaceId);
  const card = sessionCardFor(scope, ref);
  if (card === null) return null;
  const matched = profiles.filter(profile => sameExecutionRole(profile.sessionRole, card.record.role));
  if (matched.length === 1) return matched[0] ?? null;
  if (matched.length > 1) return matched.find(profile => profile.id === scope.executionProfileId) ?? null;
  return null;
}

/** Process the original message with the trusted read-only profile along
 * consumeConsultation. Busy/absent profile stays a real wait or gap; no new
 * Session is created and no isolated inquiry is substituted for this chat. */
async function consultMemberMessage(scope: ScopeState, session: SessionRef, messageRef: MessageRefValue): Promise<void> {
  const mail = scope.memberMail;
  if (mail === null || !sameSession(mail.session, session) || mail.messageRef.messageId !== messageRef.messageId) return;
  const profile = mail.profile;
  if (profile === null) {
    if (mail !== null) { mail.consultState = 'rejected'; mail.note = '没有可信只读调查配置，来信已保存但未处理。'; }
    renderScopeIfSelected(scope);
    return;
  }
  const goalId = mail.goalId;
  if (goalId === null) {
    if (mail !== null) { mail.consultState = 'rejected'; mail.note = '没有可用的当前 Goal，来信已保存但未处理。'; }
    renderScopeIfSelected(scope);
    return;
  }
  const target: CoreScope = { projectId: profile.scope.projectId, workspaceId: profile.scope.workspaceId };
  const input: ConsultationInputValue = { schemaVersion: 1, messageRef,
    goalRef: { aggregateType: 'Goal', projectId: target.projectId, goalId },
    roleBinding: profile.roleBinding, runtimeBudget: profile.runtimeBudget, budget: profile.budget,
    consumerId: profile.consumerId };
  if (mail !== null) { mail.consultState = 'running'; mail.note = '正在处理来信…'; }
  renderScopeIfSelected(scope);
  const outcome = await callCore('workflow/consultation', { scope: target, input });
  if (mail === null) { renderScopeIfSelected(scope); return; }
  if (outcome.kind === 'network') { mail.consultState = 'rejected'; mail.note = '处理结果未确认；原请求保留。'; renderScopeIfSelected(scope); return; }
  const payload = payloadOf(outcome) as WorkflowConsultationResponse;
  mail.consultation = payload;
  if (payload.status === 'ready') {
    mail.note = payload.value.reason;
    mail.consultState = payload.value.state === 'processed' ? 'processed'
      : payload.value.state === 'responded' ? 'responded'
      : payload.value.state === 'ended' ? 'ended' : 'waiting';
  } else {
    mail.consultState = 'rejected';
    mail.note = outcomeRejectionReason(payload);
  }
  renderScopeIfSelected(scope);
}

// --- Kernel file save / compare ------------------------------------------------

async function saveFile(scope: ScopeState, tabId: string): Promise<void> {
  const layout = syncActiveLayout(scope);
  const tab = layout.tabs.find(candidate => candidate.tabId === tabId);
  if (tab === undefined || tab.kind !== 'file') { scope.error = '文件页已关闭。'; renderScopeIfSelected(scope); return; }
  if (layout.readOnly) { scope.error = '当前会话只读，不能保存。'; renderScopeIfSelected(scope); return; }
  if (scope.config.writeAllowed !== true) {
    scope.error = '本工作区未授权文件写入（Host 未配置 writePrefixes），未发送保存请求。';
    renderScopeIfSelected(scope);
    return;
  }
  if (tab.file.version.kind !== 'working_tree') {
    scope.error = '该文件版本只读（历史/已捕获内容），只能查看或引用。';
    renderScopeIfSelected(scope);
    return;
  }
  const content = tab.editorDraft?.text ?? tab.file.content;
  if (content === tab.file.content) { scope.notice = '没有需要保存的改动。'; renderScopeIfSelected(scope); return; }
  // The original digest is the CAS expectation; the new body is the draft.
  const request = { scope: scope.config.scope, input: { path: tab.file.path, expectedRevision: tab.file.digest, content } };
  scope.sending = true;
  scope.error = null;
  scope.notice = null;
  renderScopeIfSelected(scope);
  const outcome = await callCore('files/save', request);
  scope.sending = false;
  if (outcome.kind === 'network') { scope.error = '保存结果未确认；草稿保留，请先重新读取核对。'; renderScopeIfSelected(scope); return; }
  const payload = payloadOf(outcome) as FilesSaveResponse;
  scope.saveResults.set(tabId, payload);
  if (payload.status !== 'ready') {
    scope.error = `保存未完成（${payload.code}）：${payload.reason}。草稿保留，可重新读取并比较。`;
    renderScopeIfSelected(scope);
    return;
  }
  scope.notice = `已保存 ${payload.value.path}（新版本 ${payload.value.revision}）。`;
  const read = await callCore('files/read', { scope: scope.config.scope, input: {
    workspace: workspaceRefFor(scope.config.scope), path: payload.value.path, maxBytes: 262144, version: { kind: 'working_tree' } } });
  const readPayload = read.kind === 'response' ? payloadOf(read) as FilesReadResponse : null;
  if (readPayload?.status === 'ready') {
    const savedFile = readPayload.value;
    // Updating the original page is not a new navigation. A late response must
    // not reopen a closed tab, switch Sessions, or overwrite newer typing.
    const latestTab = scope.auxTabs.find(candidate => candidate.tabId === tabId);
    if (latestTab?.kind === 'file') {
      const latestText = latestTab.editorDraft?.text ?? latestTab.file.content;
      const unchangedSinceSubmit = latestText === content;
      scope.auxTabs = scope.auxTabs.map(candidate =>
        candidate.tabId !== tabId ? candidate : {
          ...latestTab, file: savedFile,
          editorDraft: unchangedSinceSubmit ? null : { state: 'draft_snapshot' as const, text: latestText },
        });
      scope.notice += unchangedSinceSubmit ? '' : ' 后续编辑仍保留为未保存草稿。';
    }
    scope.saveResults.delete(tabId);
  } else {
    // The write receipt is already authoritative. A failed refresh cannot
    // turn a committed save into a failed write or invite blind resubmission.
    scope.notice += ' 保存已提交，最新内容读取未确认；草稿保留，请重新读取核对。';
  }
  renderScopeIfSelected(scope);
}

function compareVersion(scope: ScopeState, kind: string, commit: string): WorkspaceVersion | null {
  if (kind === 'working_tree') return { kind: 'working_tree' };
  if (kind === 'git') return commit.trim().length === 0 ? null : { kind: 'git', commit: commit.trim() };
  if (kind === 'capture') return scope.capture === null ? null : { kind: 'capture', capture: scope.capture.ref };
  return null;
}

async function compareFiles(scope: ScopeState): Promise<void> {
  const form = { ...scope.compareForm };
  const target = { ...scope.config.scope };
  let before = compareVersion(scope, form.beforeKind, form.beforeCommit);
  let after = compareVersion(scope, form.afterKind, form.afterCommit);
  if (before === null || after === null) {
    scope.error = '请选择有效的前后版本：git 需要完整 commit，capture 需要已捕获来源。';
    renderScopeIfSelected(scope);
    return;
  }
  if ((before.kind === 'git' && after.kind === 'capture')
    || (before.kind === 'capture' && after.kind === 'git')) {
    scope.error = '暂不支持 Git 版本与已捕获来源直接比较；请选择 Git 与当前工作区，或两个已捕获来源。';
    renderScopeIfSelected(scope);
    return;
  }
  const prefix = form.prefix.trim();
  scope.sending = true;
  scope.error = null;
  renderScopeIfSelected(scope);
  // Freeze both selected versions before any await. Capturing the working
  // tree must not silently replace an explicitly selected older capture.
  if (before.kind !== 'git' && after.kind !== 'git'
    && (before.kind === 'working_tree' || after.kind === 'working_tree')) {
    const captured = await callCore('source/capture', { scope: target, input: {
      workspace: workspaceRefFor(target), workspaceRevision: scope.config.workspaceRevision,
      provider: 'text', ...(prefix.length === 0 ? {} : { prefix }),
    } });
    const capture = captured.kind === 'response' ? payloadOf(captured) as SourceCaptureResponse : null;
    if (capture?.status !== 'ready') {
      scope.sending = false;
      scope.error = capture === null ? '当前工作区快照结果未确认，未开始比较。'
        : `当前工作区快照未就绪：${outcomeRejectionReason(capture)}。未开始比较。`;
      renderScopeIfSelected(scope);
      return;
    }
    const snapshot: WorkspaceVersion = { kind: 'capture', capture: capture.value.ref };
    if (before.kind === 'working_tree') before = snapshot;
    if (after.kind === 'working_tree') after = snapshot;
    scope.capture = capture.value;
    scope.sourcePage = null;
  }
  const input: Record<string, unknown> = { workspace: workspaceRefFor(target), before, after };
  if (prefix.length > 0) input.prefix = prefix;
  const tabId = `diff:${JSON.stringify(before)}:${JSON.stringify(after)}:${prefix}`;
  const outcome = await callCore('files/compare', { scope: target, input });
  scope.sending = false;
  if (outcome.kind === 'network') { scope.error = '比较结果未确认。'; renderScopeIfSelected(scope); return; }
  const payload = payloadOf(outcome) as FilesCompareResponse;
  scope.compareResults.set(tabId, payload);
  openTab(scope, { tabId, kind: 'diff', title: `Diff ${before.kind}→${after.kind}`,
    before, after, prefix: prefix.length === 0 ? null : prefix });
  renderScopeIfSelected(scope);
}

/** Real text diff for one changed path: both versions are actually read through
 * files/read. A read failure is shown, never a fabricated diff. */
async function loadTextDiff(scope: ScopeState, tabId: string, path: string): Promise<void> {
  const layout = syncActiveLayout(scope);
  const tab = layout.tabs.find(candidate => candidate.tabId === tabId);
  if (tab === undefined || tab.kind !== 'diff' || path.length === 0) return;
  const workspace = workspaceRefFor(scope.config.scope);
  const [beforeRead, afterRead] = await Promise.all([
    callCore('files/read', { scope: scope.config.scope, input: { workspace, path, maxBytes: 262144, version: tab.before } }),
    callCore('files/read', { scope: scope.config.scope, input: { workspace, path, maxBytes: 262144, version: tab.after } }),
  ]);
  const beforePayload = beforeRead.kind === 'response' ? payloadOf(beforeRead) as FilesReadResponse : null;
  const afterPayload = afterRead.kind === 'response' ? payloadOf(afterRead) as FilesReadResponse : null;
  if (beforePayload === null || afterPayload === null
    || beforePayload.status !== 'ready' || afterPayload.status !== 'ready') {
    scope.error = `无法读取 ${path} 的两个真实版本，未生成 diff。`;
    renderScopeIfSelected(scope);
    return;
  }
  diffTextCache.set(`${scope.key}|${tabId}|${path}`,
    { path, before: beforePayload.value.content, after: afterPayload.value.content });
  renderScopeIfSelected(scope);
}

const diffTextCache = new Map<string, { path: string; before: string; after: string }>();

// --- Command handles -----------------------------------------------------------

function workspaceAllowsCommands(scope: ScopeState): boolean {
  return scope.config.commandsAllowed === true;
}

async function startCommand(scope: ScopeState, command: string, cwd: string): Promise<void> {
  if (!workspaceAllowsCommands(scope)) {
    scope.error = '本工作区未授权命令执行（Host 未配置 allowCommands）。';
    renderScopeIfSelected(scope);
    return;
  }
  if (command.trim().length === 0) { scope.error = '请输入要执行的命令。'; renderScopeIfSelected(scope); return; }
  const requestId = freshRequestId('commands/start');
  scope.sending = true;
  scope.error = null;
  renderScopeIfSelected(scope);
  const outcome = await callCore('commands/start', { scope: scope.config.scope, input: { requestId, command, cwd } });
  scope.sending = false;
  if (outcome.kind === 'network') { scope.error = `命令启动结果未确认：${outcome.reason}`; renderScopeIfSelected(scope); return; }
  const payload = payloadOf(outcome) as CommandsStartResponse;
  if (payload.status !== 'ready') {
    scope.error = `命令未启动（${payload.code}）：${payload.reason}`;
    renderScopeIfSelected(scope);
    return;
  }
  const snapshot = payload.value;
  scope.commands.set(snapshot.commandId, { commandId: snapshot.commandId, command, cwd, requestId, result: payload,
    state: snapshot.state, poll: null, stopping: false });
  openTab(scope, { tabId: `terminal:${snapshot.commandId}`, kind: 'terminal',
    title: `${command.slice(0, 24)} · ${snapshot.commandId.replace("workbench-command-", "")}`, commandId: snapshot.commandId, command, cwd });
  if (snapshot.state !== 'settled') beginCommandPoll(scope, snapshot.commandId);
  renderScopeIfSelected(scope);
}

function beginCommandPoll(scope: ScopeState, commandId: string): void {
  const command = scope.commands.get(commandId);
  if (command === undefined) return;
  if (command.poll !== null) clearInterval(command.poll);
  command.poll = setInterval(() => { void readCommand(scope, commandId); }, 700);
}

async function readCommand(scope: ScopeState, commandId: string): Promise<void> {
  const command = scope.commands.get(commandId);
  if (command === undefined) return;
  const outcome = await callCore('commands/read', { scope: scope.config.scope, input: { commandId } });
  if (outcome.kind !== 'response') return;
  const payload = payloadOf(outcome) as CommandsReadResponse;
  if (payload.status !== 'ready') return;
  command.result = payload;
  command.state = payload.value.state;
  if (payload.value.state === 'settled' && command.poll !== null) { clearInterval(command.poll); command.poll = null; }
  // A hidden/switched tab does not cancel the handle; only the visible page redraws.
  const layout = syncActiveLayout(scope);
  if (layout.activeTabId === `terminal:${commandId}`) renderScopeIfSelected(scope);
}

async function stopCommand(scope: ScopeState, commandId: string): Promise<void> {
  const command = scope.commands.get(commandId);
  if (command === undefined) return;
  command.stopping = true;
  const outcome = await callCore('commands/stop', { scope: scope.config.scope, input: { commandId } });
  if (outcome.kind === 'network') { scope.error = '停止请求结果未确认。'; renderScopeIfSelected(scope); return; }
  const payload = payloadOf(outcome) as CommandsStopResponse;
  if (payload.status === 'ready') { command.result = payload; command.state = payload.value.state; }
  command.stopping = false;
  if (command.poll === null) beginCommandPoll(scope, commandId);
  renderScopeIfSelected(scope);
}


async function handleAction(action: string, element: HTMLElement): Promise<void> {
  const scope = state();
  switch (action) {
    // --- prototype shell: display-only navigation / modes -------------------
    case 'open-page': { await openPageKind(scope, element.dataset.page ?? 'blank'); return; }
    case 'select-scope': { switchScope(element.dataset.scopeKey ?? ''); return; }
    case 'toggle-project': {
      const key = element.dataset.scopeKey ?? '';
      if (key.length === 0) return;
      if (view.expandedProjects.has(key)) view.expandedProjects.delete(key); else view.expandedProjects.add(key);
      renderAll();
      return;
    }
    case 'toggle-nav': { view.navVisible = !view.navVisible; applyWorkbenchLayout(); return; }
    case 'set-center-mode': { view.centerMode = element.dataset.mode === 'observe' ? 'observe' : 'chat'; renderScopeIfSelected(scope); return; }
    case 'set-grouping': { scope.historyFold = element.dataset.grouping === 'task'; renderScopeIfSelected(scope); return; }
    case 'toggle-center-menu': { view.centerMenuOpen = !view.centerMenuOpen; renderScopeIfSelected(scope); return; }
    case 'toggle-center-identity': { view.centerIdentityOpen = !view.centerIdentityOpen; renderScopeIfSelected(scope); return; }
    case 'set-graph-edges': {
      const layout = syncActiveLayout(scope);
      const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
      if (tab !== undefined) view.graphEdges.set(`${scope.key}|${tab.tabId}`, element.dataset.edges === 'dependency' ? 'dependency' : 'hierarchy');
      renderScopeIfSelected(scope);
      return;
    }
    case 'set-graph-mode': {
      const layout = syncActiveLayout(scope);
      const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
      if (tab !== undefined) view.graphModes.set(`${scope.key}|${tab.tabId}`, element.dataset.mode ?? '');
      view.contextNode = null;
      renderScopeIfSelected(scope);
      return;
    }
    case 'toggle-archived': {
      scope.sessionIncludeArchived = !scope.sessionIncludeArchived;
      scope.sessionFind = null;
      scope.relatedSessions = null;
      await submit(scope, 'sessions/find', buildSessionFindRequest(false));
      return;
    }
    case 'refresh-source-tree': { await ensureSourceTree(scope, true); return; }
    case 'read-center-history':
    case 'next-center-history': {
      const ref = scope.activeSession ?? scope.mainSession;
      if (ref === null) { scope.error = '尚未绑定会话。'; renderScopeIfSelected(scope); return; }
      const key = centerSessionHistoryKey(ref);
      const previous = storedSessionHistoryPage(scope, key);
      const isNext = action === 'next-center-history';
      const body = buildSessionHistoryRequest(scope.config.scope, ref, previous, isNext, CENTER_HISTORY_LIMIT);
      if (body === null) { scope.error = '原历史没有更多页。'; renderScopeIfSelected(scope); return; }
      await submit(scope, 'sessions/history', body, tagsFor(ref, null, null, null, null, key, isNext));
      return;
    }
    case 'compare-path': {
      scope.compareForm.prefix = element.dataset.path ?? '';
      openTab(scope, { tabId: 'compare:new', kind: 'compare', title: 'Diff' });
      renderScopeIfSelected(scope);
      return;
    }
    case 'send-main-message': { await sendMemberMessage(scope, scope.mainSession ?? undefined); return; }
    case 'context-pin': { view.contextNode = null; await handleAction('toggle-pin', element); return; }
    case 'context-detail': {
      const nodeId = element.dataset.node ?? '';
      view.contextNode = null;
      const node = [...document.querySelectorAll<HTMLElement>('.q-graphnode')].find(candidate => candidate.dataset.node === nodeId) ?? null;
      if (node === null) { renderScopeIfSelected(scope); return; }
      selectGraphNode(scope, node);
      return;
    }
    case 'close-context': { view.contextNode = null; renderScopeIfSelected(scope); return; }
    // --- MVP UI connection -------------------------------------------------
    case 'run-new-goal': {
      const layout = syncActiveLayout(scope);
      const objective = layout.composerDraft.text.trim();
      if (objective.length === 0) { scope.error = '请先写下目标正文（不是内部标识）。'; renderScopeIfSelected(scope); return; }
      const profile = executionProfileForScope(scope, scope.config.scope);
      // Freeze the recipient intent BEFORE the first await: a member selected
      // while the Goal is being created must not reroute the main conversation.
      const activeAtSend = scope.activeSession;
      const draftKey = conversationKey(activeAtSend);
      const submittedDraft = JSON.stringify(layout.composerDraft);
      await scope.goalConversation.begin({
        origin: { ...scope.config.scope }, objective,
        question: composeRequestText(layout).trim() || objective,
        references: layout.composerDraft.references.map(reference => ({ ...reference })),
        profileId: profile?.id ?? null,
        fromMain: activeAtSend === null,
        selectedSession: activeAtSend === null ? null
          : { projectId: activeAtSend.projectId, sessionId: activeAtSend.sessionId },
      });
      const originalDraft = scope.drafts.get(draftKey);
      if (scope.goalConversation.snapshot().status === 'started' && scope.execution.answer?.status === 'ready'
        && originalDraft !== undefined && JSON.stringify(originalDraft) === submittedDraft) {
        scope.drafts.set(draftKey, { ...originalDraft, text: '', references: [] });
      }
      renderScopeIfSelected(scope);
      return;
    }
    case 'send-member-message': { await sendMemberMessage(scope); return; }
    case 'retry-member-send': { await retryMemberSend(scope); return; }
    case 'process-consultation': {
      const mail = scope.memberMail;
      if (mail === null) { scope.error = '没有已保存的成员来信。'; renderScopeIfSelected(scope); return; }
      await consultMemberMessage(scope, mail.session, mail.messageRef);
      return;
    }
    case 'load-executions': { await loadExecutions(scope, false); return; }
    case 'load-next-executions': { await loadExecutions(scope, true); return; }
    case 'start-command': {
      await startCommand(scope, scope.forms.commandLine, scope.forms.commandCwd.trim().length === 0 ? '.' : scope.forms.commandCwd);
      return;
    }
    case 'stop-command': { await stopCommand(scope, element.dataset.command ?? ''); return; }
    case 'save-file': { await saveFile(scope, element.dataset.tab ?? ''); return; }
    case 'compare-files': { await compareFiles(scope); return; }
    case 'load-text-diff': { await loadTextDiff(scope, element.dataset.tab ?? '', element.dataset.path ?? ''); return; }
    case 'toggle-history-fold': { scope.historyFold = !scope.historyFold; renderScopeIfSelected(scope); return; }
    case 'copy-code': {
      const block = element.closest<HTMLElement>('[data-code-block]');
      const code = block?.querySelector('code') ?? null;
      const text = code === null ? '' : code.textContent ?? '';
      if (navigator.clipboard === undefined) { scope.error = '当前环境不支持自动复制，请手动选择代码文本。'; renderScopeIfSelected(scope); return; }
      try {
        await navigator.clipboard.writeText(text);
        element.textContent = '已复制';
        window.setTimeout(() => { element.textContent = '复制'; }, 1200);
      } catch { scope.error = '复制失败，请手动选择代码文本。'; renderScopeIfSelected(scope); }
      return;
    }
    case 'toggle-code-wrap': {
      const block = element.closest<HTMLElement>('[data-code-block]');
      if (block === null) return;
      const wrapped = block.classList.toggle('is-wrapped');
      element.setAttribute('aria-pressed', String(wrapped));
      return;
    }
    case 'view-latest': {
      const ref = scope.activeSession ?? scope.mainSession;
      if (ref === null) { scope.error = '尚未绑定会话。'; renderScopeIfSelected(scope); return; }
      // Freeze the exact scope + Session before any await. The bounded loop
      // only follows this ref's own prefix and never scans without limit.
      const frozenScope = scope.config.scope;
      const key = centerSessionHistoryKey(ref);
      for (let page = 0; page < 10; page += 1) {
        const previous = storedSessionHistoryPage(scope, key);
        const ready = previous?.status === 'ready' ? previous.value : null;
        // At a previously read tail, ask after its exact final record. With no
        // cache (or an empty history), read the head once. Neither path polls.
        const after = ready?.nextCursor ?? ready?.items.at(-1)?.cursor ?? null;
        const body = { scope: frozenScope, input: { sessionRef: ref, afterCursor: after,
          throughCursor: null, limit: CENTER_HISTORY_LIMIT } };
        await submit(scope, 'sessions/history', body, tagsFor(ref, null, null, null, null, key, after !== null));
        const next = storedSessionHistoryPage(scope, key);
        if (next === null || next.status !== 'ready' || next === previous
          || next.value.nextCursor === null || next.value.nextCursor === after) break;
      }
      const stillHere = scope.key === selectedKey
        && sameSession(scope.activeSession ?? scope.mainSession, ref);
      if (stillHere) {
        const last = storedSessionHistoryPage(scope, key);
        if (last?.status === 'ready' && last.value.nextCursor !== null)
          scope.notice = '仍有后续记录，可继续加载；当前定位到已加载内容末尾。';
        stickConversationToBottom = true;
        renderScopeIfSelected(scope);
      }
      return;
    }
    case 'select-main-conversation': {
      scope.activeSession = null;
      scope.activeMessage = null;
      scope.memberMail = null;
      saveScopeDisplay(scope);
      renderScopeIfSelected(scope);
      // Re-read the bound main record so a positive claimed/prepared original
      // run can be offered. Read-only: it never prepares or starts anything.
      if (scope.mainSession !== null) {
        await submit(scope, 'sessions/read',
          buildSessionReadRequest(scope.config.scope, scope.mainSession), tagsFor(scope.mainSession));
      }
      return;
    }
    case 'refresh-members': {
      const body = buildSessionFindRequest(false);
      if (requireBody(scope, body)) await submit(scope, 'sessions/find', body);
      return;
    }
    case 'toggle-theme': { view.theme = view.theme === 'dark' ? 'light' : view.theme === 'light' ? 'system' : 'dark';
      applyWorkbenchLayout(); saveGlobalDisplay(); return; }
    case 'toggle-branch': { toggleContainment(scope, element.dataset.moduleId ?? ''); return; }
    case 'expand-active-paths': {
      scope.containment.expanded = [...new Set([...scope.containment.expanded, ...scope.containment.activeModuleIds])];
      renderScopeIfSelected(scope);
      return;
    }
    case 'collapse-branches': { scope.containment.expanded = []; renderScopeIfSelected(scope); return; }
    case 'create-project': { const body = buildProjectRequest(); if (requireBody(scope, body)) await submit(scope, 'projects/create', body); return; }
    case 'register-workspace': { const body = buildWorkspaceRequest(); if (requireBody(scope, body)) await submit(scope, 'workspaces/register', body); return; }
    case 'install-policy': { const body = buildPolicyInstallRequest(); if (requireBody(scope, body)) await submit(scope, 'completion-policies/install', body); return; }
    case 'activate-policy': { const body = buildPolicyActivateRequest(); if (requireBody(scope, body)) await submit(scope, 'completion-policies/activate', body); return; }
    case 'create-goal': { const body = buildGoalRequest(); if (requireBody(scope, body)) await submit(scope, 'goals/create', body); return; }
    case 'adopt-architecture': { const body = buildAdoptRequest(); if (requireBody(scope, body)) await submit(scope, 'architecture/adopt-initial', body); return; }
    case 'adopt-architecture-draft': { await adoptArchitectureDraft(scope); return; }
    case 'propose-plan': { const body = buildProposeRequest(); if (requireBody(scope, body)) await submit(scope, 'plans/propose', body); return; }
    case 'apply-plan': { const body = buildApplyRequest(); if (requireBody(scope, body)) await submit(scope, 'plans/apply', body); return; }
    case 'read-goal': { const body = buildGoalReadRequest(); if (requireBody(scope, body)) { await submit(scope, 'goals/read', body); await loadPlanCandidate(scope); renderScopeIfSelected(scope); } return; }
    case 'read-proposal': { const body = buildProposalReadRequest(); if (requireBody(scope, body)) await submit(scope, 'plans/proposal', body); return; }
    case 'read-architecture': { const body = buildArchitectureReadRequest(); if (requireBody(scope, body)) await submit(scope, 'architecture/read', body); return; }
    case 'capture-observed': { const body = buildObservedCaptureRequest(); if (requireBody(scope, body)) await submit(scope, 'architecture/capture', body); return; }
    case 'query-observed': { const body = buildObservedQueryRequest(); if (requireBody(scope, body)) await submit(scope, 'architecture/query', body); return; }
    case 'query-tasks': { const body = buildTasksQueryRequest(); if (requireBody(scope, body)) await submit(scope, 'tasks/query', body); return; }
    case 'capture-source': { const body = buildSourceCaptureRequest(); if (requireBody(scope, body)) await submit(scope, 'source/capture', body); return; }
    case 'query-paths': { const body = buildSourceQueryRequest(false); if (requireBody(scope, body)) await submit(scope, 'source/query', body); return; }
    case 'query-next': { const body = buildSourceQueryRequest(true); if (requireBody(scope, body)) await submit(scope, 'source/query', body); return; }
    case 'read-file': { const body = buildFileRequest(); if (requireBody(scope, body)) await submit(scope, 'files/read', body); return; }
    case 'select-query-profile': {
      scope.executionProfileId = element instanceof HTMLSelectElement && element.value.length > 0 ? element.value : null;
      scope.executionNotice = null;
      renderScopeIfSelected(scope);
      return;
    }
    case 'run-investigation': {
      scope.forms.question = composeRequestText(syncActiveLayout(scope)).trim() || scope.forms.question;
      await runExecution(scope, 'investigate');
      return;
    }
    case 'review-plan-candidate': { await loadPlanCandidate(scope); renderScopeIfSelected(scope); return; }
    case 'adopt-initial-plan': {
      await loadPlanCandidate(scope);
      const candidate = scope.planCandidate;
      if (candidate === null) {
        scope.error = '当前没有可采用的初始方案候选（需要同一 Goal 最新可达且同 scope 的 Answer）。';
        renderScopeIfSelected(scope);
        return;
      }
      await adoptInitialPlanSetup(scope, candidate);
      return;
    }
    case 'run-planning': {
      scope.forms.question = composeRequestText(syncActiveLayout(scope)).trim() || scope.forms.question;
      await runExecution(scope, 'planning');
      return;
    }
    case 'start-goal-investigation': {
      const snapshot = scope.goalConversation.snapshot();
      if (snapshot.status === 'creating') return;
      if (snapshot.goalId !== null) {
        await scope.goalConversation.startInvestigation();
      } else {
        // Existing Goal restored without a frozen first-Send: the explicit
        // start is the original fresh investigation, with the current draft.
        scope.forms.question = composeRequestText(syncActiveLayout(scope)).trim() || scope.forms.question;
        await runExecution(scope, 'investigate');
      }
      renderScopeIfSelected(scope);
      return;
    }
    case 'resume-original-investigation': {
      const candidate = scope.execution.resumable;
      const displayed = scope.activeSession ?? scope.mainSession;
      if (candidate === null || !sameSession(candidate.session, displayed)) {
        scope.error = '没有可继续准备的原始调查。';
        renderScopeIfSelected(scope);
        return;
      }
      await scope.goalConversation.resumeOriginal(candidate.queryRunRef, candidate.session);
      await submit(scope, 'sessions/read', buildSessionReadRequest(scope.config.scope, candidate.session), tagsFor(candidate.session));
      await submit(scope, 'sessions/find', { scope: scope.config.scope,
        input: { workspace: scope.config.scope, includeArchived: scope.sessionIncludeArchived, page: { limit: 10 } } });
      renderScopeIfSelected(scope);
      return;
    }
    case 'open-goal-model-settings': { scope.goalConversation.openModelSettings(); return; }
    case 'run-continue': { await continueExecution(scope); return; }
    case 'refresh-execution': { await refreshExecution(scope); return; }
    case 'control-pause':
    case 'control-cancel':
    case 'control-resume':
    case 'control-steer': {
      const layout = syncActiveLayout(scope);
      const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
      if (tab === undefined || tab.kind !== 'execution_history') return;
      const key = executionPageKey(tab.tabId);
      const read = scope.executionReads.get(key);
      if (read?.result.status !== 'ready') { scope.error = '先刷新执行事实再控制。'; renderScopeIfSelected(scope); return; }
      const execution = read.result.value;
      const kind = action.slice('control-'.length) as 'pause' | 'cancel' | 'resume' | 'steer';
      const reason = kind === 'steer' ? window.prompt('向原执行提交的新方向（暂停不会因此解除）') : `operator ${kind}`;
      if (reason === null || reason.trim().length === 0) return;
      await submit(scope, 'controls/submit', { scope: scope.config.scope, request: {
        input: { runRef: tab.run, kind, reason }, meta: { requestId: freshRequestId('controls/submit'), expected: [{ ref: tab.run, revision: execution.run.revision }] },
      } });
      const receipt = scope.lastResponse?.payload as { status?: string; value?: { intent?: { ref: unknown } } } | undefined;
      if (receipt?.status !== 'committed' || receipt.value?.intent === undefined) return;
      await submit(scope, 'controls/deliver', { scope: scope.config.scope, input: { intentRef: receipt.value.intent.ref } });
      const authorization = execution.run.executionAuthorization;
      if (kind === 'resume' && execution.run.outcome !== 'yielded' && execution.run.envelope !== null && execution.run.inputBinding !== undefined && authorization !== undefined && 'consumerId' in authorization) {
        await submit(scope, 'executions/start', { scope: scope.config.scope, input: {
          prepared: { kind: 'task', claim: execution.outbox.claim, envelope: execution.run.envelope, inputBinding: execution.run.inputBinding },
          consumerId: authorization.consumerId, requestId: freshRequestId('executions/start'),
        } });
      }
      return;
    }
    case 'stop-execution': { await stopCollaboration(scope); return; }
    case 'read-path': {
      const path = element.dataset.path ?? '';
      const body = buildFileRequest(path);
      if (requireBody(scope, body)) { scope.forms.filePath = path; await submit(scope, 'files/read', body); }
      return;
    }
    case 'archive-session':
    case 'reactivate-session': {
      // The A1 lifecycle owner is reached through its real public HTTP route; a
      // Session responsibility link is never treated as control authority.
      const scopeId = scope.config.scope;
      const sessionId = element.dataset.session ?? '';
      const revision = Number(element.dataset.revision);
      if (sessionId.length === 0 || !Number.isSafeInteger(revision) || revision < 1) {
        scope.error = '会话生命周期操作缺少可信的会话引用。';
        renderScopeIfSelected(scope);
        return;
      }
      const sessionRef = { projectId: scopeId.projectId, sessionId };
      const route = action === 'archive-session' ? 'sessions/archive' : 'sessions/reactivate';
      const reason = action === 'archive-session' ? 'operator archived from the workbench' : 'operator reactivated from the workbench';
      await submit(scope, route, { scope: scopeId, request: { input: { sessionRef, reason },
        meta: { requestId: freshRequestId(route), expected: [{ ref: { aggregateType: 'Session', ...sessionRef }, revision }] } } });
      if (record(scope.lastResponse?.payload).status === 'committed') {
        await submit(scope, 'sessions/read', { scope: scopeId, input: sessionRef }, tagsFor(sessionRef));
      }
      return;
    }
    case 'find-sessions': {
      const target = workTargetFromElement(element);
      if (target !== null) {
        const includeArchived = scope.sessionIncludeArchived;
        await submit(scope, 'sessions/find',
          { scope: scope.config.scope, input: { workspace: scope.config.scope, target, includeArchived, page: { limit: 10 } } },
          tagsForRelated(target, includeArchived, null));
        return;
      }
      const body = buildSessionFindRequest(false);
      if (requireBody(scope, body)) await submit(scope, 'sessions/find', body);
      return;
    }
    case 'next-related-sessions': {
      const related = scope.relatedSessions;
      const body = buildRelatedSessionsRequest(true);
      if (body === null || related === null) { scope.error = '关联会话没有更多页。'; renderScopeIfSelected(scope); return; }
      await submit(scope, 'sessions/find', body, tagsForRelated(related.target, related.includeArchived, related.role));
      return;
    }
    case 'next-sessions': {
      const body = buildSessionFindRequest(true);
      if (body === null) { scope.error = '会话目录没有更多页。'; renderScopeIfSelected(scope); return; }
      await submit(scope, 'sessions/find', body);
      return;
    }
    case 'create-session': {
      const body = buildSessionCreateRequest();
      if (!requireBody(scope, body)) return;
      await submit(scope, 'sessions/create', body);
      const receipt = scope.lastRequest?.body === body ? scope.sessionCreateReceipt : null;
      if (receipt !== null && receipt.status === 'completed') {
        const ref = sessionRefFromRecord(receipt.value);
        if (ref !== null) {
          selectSession(scope, ref);
          await submit(scope, 'sessions/read', buildSessionReadRequest(scope.config.scope, ref), tagsFor(ref));
        }
      }
      return;
    }
    case 'read-session-operation': {
      const body = buildSessionOperationRequest();
      if (!requireBody(scope, body)) return;
      await submit(scope, 'sessions/operation', body);
      const read = scope.lastRequest?.body === body ? scope.sessionOperationRead : null;
      if (read !== null && read.status === 'ready' && read.value.phase === 'completed') {
        const ref = read.value.action.plannedSessionRef;
        selectSession(scope, ref);
        await submit(scope, 'sessions/read', buildSessionReadRequest(scope.config.scope, ref), tagsFor(ref));
      }
      return;
    }
    case 'read-session': {
      const ref = sessionRefFromAny(scope, element.dataset.session ?? '');
      if (ref === null) { scope.error = '请先从会话目录选择会话。'; renderScopeIfSelected(scope); return; }
      selectSession(scope, ref);
      await submit(scope, 'sessions/read', buildSessionReadRequest(scope.config.scope, ref), tagsFor(ref));
      return;
    }
    case 'read-inbox': {
      const body = buildInboxRequest(false);
      if (body === null) { scope.error = '请先选择会话。'; renderScopeIfSelected(scope); return; }
      await submit(scope, 'messages/inbox', body, tagsFor(scope.activeSession));
      return;
    }
    case 'next-inbox': {
      const body = buildInboxRequest(true);
      if (body === null) { scope.error = '收件箱没有更多页。'; renderScopeIfSelected(scope); return; }
      await submit(scope, 'messages/inbox', body, tagsFor(scope.activeSession));
      return;
    }
    case 'send-message': {
      // Capture the originating scope, recipient, exact conversation layout and
      // submitted text BEFORE the first await. A late response must never be
      // attributed to whichever scope/Session the user selects in the meantime.
      const recipient = scope.activeSession;
      if (recipient === null) { scope.error = '请先选择收件会话。'; renderScopeIfSelected(scope); return; }
      const targetScope = scope.config.scope;
      const conversation = conversationKey(recipient);
      const draft = syncActiveLayout(scope);
      if (draft.readOnly) { scope.error = '归档会话只读，不能发送消息。'; renderScopeIfSelected(scope); return; }
      const submittedText = draft.composerDraft.text;
      if (submittedText.trim().length === 0) { scope.error = '请输入消息内容。'; renderScopeIfSelected(scope); return; }
      const body = { scope: targetScope, request: { input: { recipient, text: submittedText.trim() },
        meta: { requestId: freshRequestId('messages/send'), expected: [] } } };
      await submit(scope, 'messages/send', body, tagsFor(recipient));
      if (scope.lastRequest?.body === body && record(scope.lastResponse?.payload).status === 'committed') {
        // Clear ONLY the captured conversation's draft, and only while it still
        // holds exactly what was submitted. A→B switch (even with identical text
        // in B) can never clear B.
        const latest = scope.drafts.get(conversation);
        if (latest !== undefined && latest.text === submittedText) {
          scope.drafts.set(conversation, { ...latest, text: '' });
        }
        // The follow-up read explicitly targets the SAME captured scope and
        // recipient, never the current state()/activeSession.
        await submit(scope, 'messages/inbox',
          { scope: targetScope, input: { recipient, page: { limit: 10 } } },
          tagsFor(recipient));
      }
      return;
    }
    case 'read-message': {
      const ref = messageRefFromInbox(scope, element.dataset.message ?? '');
      if (ref === null) { scope.error = '请先从收件箱选择消息。'; renderScopeIfSelected(scope); return; }
      scope.activeMessage = ref;
      await submit(scope, 'messages/read', { scope: scope.config.scope, input: ref }, tagsFor(scope.activeSession, ref));
      return;
    }
    case 'read-message-body': {
      const ref = scope.activeMessage;
      if (ref === null) { scope.error = '请先查看一条消息。'; renderScopeIfSelected(scope); return; }
      const part = element.dataset.part === 'response' ? 'response' as const : 'message' as const;
      await submit(scope, 'messages/body', { scope: scope.config.scope, input: { messageRef: ref, part } }, tagsFor(scope.activeSession, ref, part));
      return;
    }
    case 'select-collaboration-task': {
      scope.forms.taskId = element.dataset.taskId ?? '';
      await refreshExecution(scope);
      return;
    }
    case 'read-collaboration-message': {
      // Reuse the EXISTING messages/read + messages/body routes and the existing
      // renderMessage/renderMessageBody entries; no new projection or page.
      const messageId = element.dataset.messageId ?? '';
      const collab = scope.collaboration;
      if (collab === null || collab.result.status !== 'ready') {
        scope.error = '当前没有可查看的协同消息。'; renderScopeIfSelected(scope); return;
      }
      const message = collab.result.value.messages.find(candidate => candidate.ref.messageId === messageId);
      if (message === undefined) { scope.error = '该消息不在当前协同快照中。'; renderScopeIfSelected(scope); return; }
      const recipient: SessionRef = { projectId: message.recipient.projectId, sessionId: message.recipient.sessionId };
      const ref = message.ref;
      scope.activeSession = recipient;
      scope.activeMessage = ref;
      saveScopeDisplay(scope);
      await submit(scope, 'messages/read', { scope: scope.config.scope, input: ref }, tagsFor(recipient, ref));
      const read = scope.message;
      if (read === null || read.result.status !== 'ready') return;
      await submit(scope, 'messages/body', { scope: scope.config.scope, input: { messageRef: ref, part: 'message' } },
        tagsFor(recipient, ref, 'message'));
      if (message.status === 'responded') {
        await submit(scope, 'messages/body', { scope: scope.config.scope, input: { messageRef: ref, part: 'response' } },
          tagsFor(recipient, ref, 'response'));
      }
      return;
    }
    case 'consult-message': {
      // Capture the originating session/message/profile BEFORE the first await;
      // a later member switch can never redirect this consultation or its refresh.
      const session = scope.activeSession;
      const messageRef = scope.activeMessage;
      if (session === null || messageRef === null) { scope.error = '请先从收件箱选择一条消息。'; renderScopeIfSelected(scope); return; }
      const profile = selectedExecutionProfile(scope);
      if (profile === null) { scope.error = '当前工作区没有可用的只读调查配置，无法处理咨询。'; renderScopeIfSelected(scope); return; }
      const goalId = currentConsultationGoalId(scope);
      if (goalId === null) { scope.error = '没有可用的当前 Goal，无法处理咨询。'; renderScopeIfSelected(scope); return; }
      const target: CoreScope = { projectId: profile.scope.projectId, workspaceId: profile.scope.workspaceId };
      const input: ConsultationInputValue = {
        schemaVersion: 1,
        messageRef,
        goalRef: { aggregateType: 'Goal', projectId: target.projectId, goalId },
        roleBinding: profile.roleBinding,
        runtimeBudget: profile.runtimeBudget,
        budget: profile.budget,
        consumerId: profile.consumerId,
      };
      await submit(scope, 'workflow/consultation', { scope: target, input }, tagsFor(session, messageRef));
      // Capture THIS consultation's outcome for the exact captured
      // session/message BEFORE any other read. A network/403 failure keeps its
      // original pending/error and is never overwritten by a refresh, and a
      // later read can never decide which response body was requested.
      const stored = scope.consultation;
      const outcome = stored !== null && sameSession(stored.session, session) && sameMessage(stored.messageRef, messageRef)
        ? stored.result : null;
      // `pending` stays set on a network/403 failure: keep the original request
      // and error, and never let a later refresh overwrite them.
      if (scope.pending !== null || outcome === null || outcome.status !== 'ready') return;
      // Refresh ONLY the captured scope/session/message under their own tags.
      await submit(scope, 'messages/read', { scope: scope.config.scope, input: messageRef }, tagsFor(session, messageRef));
      await submit(scope, 'messages/inbox', { scope: scope.config.scope, input: { recipient: session, page: { limit: 10 } } }, tagsFor(session));
      await submit(scope, 'messages/body', { scope: scope.config.scope, input: { messageRef, part: 'message' } }, tagsFor(session, messageRef, 'message'));
      if (outcome.value.state === 'responded') {
        await submit(scope, 'messages/body', { scope: scope.config.scope, input: { messageRef, part: 'response' } }, tagsFor(session, messageRef, 'response'));
      }
      return;
    }
    case 'read-session-history': {
      const active = scope.activeSession;
      const key = active === null ? null : centerSessionHistoryKey(active);
      const body = active === null || key === null ? null
        : buildSessionHistoryRequest(scope.config.scope, active, storedSessionHistoryPage(scope, key), false, CENTER_HISTORY_LIMIT);
      if (body === null) { scope.error = '请先选择会话。'; renderScopeIfSelected(scope); return; }
      await submit(scope, 'sessions/history', body, tagsFor(active, null, null, null, null, key));
      return;
    }
    case 'next-session-history': {
      const active = scope.activeSession;
      const key = active === null ? null : centerSessionHistoryKey(active);
      const body = active === null || key === null ? null
        : buildSessionHistoryRequest(scope.config.scope, active, storedSessionHistoryPage(scope, key), true, CENTER_HISTORY_LIMIT);
      if (body === null) { scope.error = '原历史没有更多页。'; renderScopeIfSelected(scope); return; }
      await submit(scope, 'sessions/history', body, tagsFor(active, null, null, null, null, key, true));
      return;
    }
    case 'read-runtime-capabilities': {
      await submit(scope, 'runtime/capabilities', buildRuntimeCapabilitiesRequest());
      return;
    }
    case 'select-session': {
      const ref = sessionRefFromAny(scope, element.dataset.session ?? '');
      if (ref === null) { scope.error = '请先从会话目录选择会话。'; renderScopeIfSelected(scope); return; }
      const targetScope = scope.config.scope;
      const key = centerSessionHistoryKey(ref);
      selectSession(scope, ref);
      saveScopeDisplay(scope);
      await submit(scope, 'sessions/read', buildSessionReadRequest(targetScope, ref), tagsFor(ref));
      await submit(scope, 'sessions/history', buildSessionHistoryRequest(targetScope, ref, null, false, CENTER_HISTORY_LIMIT),
        tagsFor(ref, null, null, null, null, key));
      return;
    }
    case 'refresh-session': {
      const ref = scope.activeSession;
      if (ref === null) return;
      await submit(scope, 'sessions/read', buildSessionReadRequest(scope.config.scope, ref), tagsFor(ref));
      return;
    }
    case 'open-session-tab': {
      const ref = sessionRefFromAny(scope, element.dataset.session ?? '');
      if (ref === null) { scope.error = '请先从会话目录选择会话。'; renderScopeIfSelected(scope); return; }
      openTab(scope, { tabId: `history:${ref.sessionId}`, kind: 'history', title: `历史 ${ref.sessionId}`, session: ref });
      renderScopeIfSelected(scope);
      return;
    }
    case 'read-session-tab': {
      const layout = syncActiveLayout(scope);
      const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
      if (tab === undefined || tab.kind !== 'session_chat') return;
      const targetScope = scope.config.scope;
      const key = tabSessionHistoryKey(tab.tabId, tab.session);
      await submit(scope, 'sessions/read', buildSessionReadRequest(targetScope, tab.session), tagsFor(tab.session));
      await submit(scope, 'sessions/history',
        buildSessionHistoryRequest(targetScope, tab.session, storedSessionHistoryPage(scope, key), false),
        tagsFor(tab.session, null, null, null, null, key));
      return;
    }
    case 'next-session-tab': {
      const layout = syncActiveLayout(scope);
      const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
      if (tab === undefined || tab.kind !== 'session_chat') return;
      const key = tabSessionHistoryKey(tab.tabId, tab.session);
      const body = buildSessionHistoryRequest(scope.config.scope, tab.session, storedSessionHistoryPage(scope, key), true);
      if (body === null) { scope.error = '该会话原历史没有更多页。'; renderScopeIfSelected(scope); return; }
      await submit(scope, 'sessions/history', body, tagsFor(tab.session, null, null, null, null, key));
      return;
    }
    case 'read-history-tab': {
      const layout = syncActiveLayout(scope);
      const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
      if (tab === undefined || tab.kind !== 'history') return;
      const targetScope = scope.config.scope;
      const key = tabSessionHistoryKey(tab.tabId, tab.session);
      await submit(scope, 'sessions/history',
        buildSessionHistoryRequest(targetScope, tab.session, storedSessionHistoryPage(scope, key), false),
        tagsFor(tab.session, null, null, null, null, key));
      return;
    }
    case 'next-history-tab': {
      const layout = syncActiveLayout(scope);
      const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
      if (tab === undefined || tab.kind !== 'history') return;
      const key = tabSessionHistoryKey(tab.tabId, tab.session);
      const body = buildSessionHistoryRequest(scope.config.scope, tab.session, storedSessionHistoryPage(scope, key), true);
      if (body === null) { scope.error = '该会话原历史没有更多页。'; renderScopeIfSelected(scope); return; }
      await submit(scope, 'sessions/history', body, tagsFor(tab.session, null, null, null, null, key));
      return;
    }
    case 'open-execution-history': {
      const run = runRefFromElement(element);
      if (run === null) { scope.error = '缺少完整的执行引用。'; renderScopeIfSelected(scope); return; }
      const task = taskTripleFromElement(element);
      const targetScope = scope.config.scope;
      const tab: WorkbenchTab = { tabId: executionTabId(run), kind: 'execution_history',
        title: `本次执行 ${run.runId}`, run, task };
      // Capture the originating conversation/layout and its exact page BEFORE the
      // first await, and open the typed Run page there. Later responses only
      // update this page: they never select a Session or migrate/reopen a tab.
      const key = executionPageKey(tab.tabId);
      openTab(scope, tab);
      await submit(scope, 'executions/read', { scope: targetScope, input: run },
        tagsFor(null, null, null, null, run, key));
      await submit(scope, 'executions/history',
        buildExecutionHistoryRequest(targetScope, run, null, false),
        tagsFor(null, null, null, null, run, key));
      renderScopeIfSelected(scope);
      return;
    }
    case 'read-execution-record': {
      const tab = activeExecutionTab(scope);
      if (tab === null) { scope.error = '请先打开本次执行页。'; renderScopeIfSelected(scope); return; }
      const key = executionPageKey(tab.tabId);
      await submit(scope, 'executions/read', { scope: scope.config.scope, input: tab.run },
        tagsFor(null, null, null, null, tab.run, key));
      return;
    }
    case 'read-execution-history': {
      const tab = activeExecutionTab(scope);
      if (tab === null) { scope.error = '请先打开本次执行页。'; renderScopeIfSelected(scope); return; }
      const key = executionPageKey(tab.tabId);
      const previous = scope.executionHistories.get(key) ?? null;
      const body = buildExecutionHistoryRequest(scope.config.scope, tab.run, previous, false);
      if (!requireBody(scope, body)) return;
      await submit(scope, 'executions/history', body, tagsFor(null, null, null, null, tab.run, key));
      return;
    }
    case 'next-execution-history': {
      const tab = activeExecutionTab(scope);
      if (tab === null) { scope.error = '请先打开本次执行页。'; renderScopeIfSelected(scope); return; }
      const key = executionPageKey(tab.tabId);
      const previous = scope.executionHistories.get(key) ?? null;
      const body = buildExecutionHistoryRequest(scope.config.scope, tab.run, previous, true);
      if (body === null) { scope.error = '本次执行原历史没有更多页。'; renderScopeIfSelected(scope); return; }
      await submit(scope, 'executions/history', body, tagsFor(null, null, null, null, tab.run, key));
      return;
    }
    case 'open-claim-session': {
      // Explicit user navigation only. The clicked page already holds the ready
      // record; capture the target page before the first await, then select the
      // exact claim Session and read its full saved history.
      const tab = activeExecutionTab(scope);
      const key = tab === null ? null : executionPageKey(tab.tabId);
      const readEntry = key === null ? null : (scope.executionReads.get(key) ?? null);
      const claim = readEntry !== null && readEntry.result.status === 'ready'
        ? readEntry.result.value.outbox.claim.sessionRef : null;
      if (claim === null) {
        scope.error = '本次执行事实尚不可用，不能打开原 claim 会话。'; renderScopeIfSelected(scope); return;
      }
      const targetScope = scope.config.scope;
      const centerKey = centerSessionHistoryKey(claim);
      selectSession(scope, claim);
      await submit(scope, 'sessions/read', buildSessionReadRequest(targetScope, claim), tagsFor(claim));
      await submit(scope, 'sessions/history',
        buildSessionHistoryRequest(targetScope, claim, null, false, CENTER_HISTORY_LIMIT),
        tagsFor(claim, null, null, null, null, centerKey));
      return;
    }
    case 'open-task-detail': {
      const projectId = element.dataset.projectId ?? scope.config.scope.projectId;
      const goalId = element.dataset.goalId ?? '';
      const taskId = element.dataset.taskId ?? '';
      openTab(scope, { tabId: `task:${projectId}:${goalId}:${taskId}`, kind: 'task_detail', title: `任务 ${taskId}`,
        target: { kind: 'task', ref: { projectId, goalId, taskId } } });
      renderScopeIfSelected(scope);
      return;
    }
    case 'open-module-detail': {
      const projectId = element.dataset.projectId ?? scope.config.scope.projectId;
      const moduleId = element.dataset.moduleId ?? '';
      openTab(scope, { tabId: `module:${projectId}:${moduleId}`, kind: 'module_detail', title: `模块 ${moduleId}`,
        target: { kind: 'module', ref: { projectId, moduleId } } });
      renderScopeIfSelected(scope);
      return;
    }
    case 'open-architecture-graph': {
      const selection: ArchitectureReadBody['input']['selection'] = scope.forms.archSelection === 'revision'
        ? { kind: 'revision', ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: scope.config.scope.projectId,
            baselineId: scope.forms.baselineId.trim(), revision: Number.parseInt(scope.forms.baselineRevision, 10) } }
        : { kind: 'current' };
      if (selection.kind === 'revision'
        && (selection.ref.baselineId.length === 0 || !Number.isSafeInteger(selection.ref.revision) || selection.ref.revision < 1)) {
        scope.error = '请填写有效的架构 ID 与版本。'; renderScopeIfSelected(scope); return;
      }
      const key = architectureSelectionKey(selection);
      openTab(scope, { tabId: `architecture:${key}`, kind: 'architecture_graph',
        title: selection.kind === 'current' ? '架构图（当前）' : `架构图 ${key}`, selection });
      renderScopeIfSelected(scope);
      return;
    }
    case 'read-architecture-tab': {
      const layout = syncActiveLayout(scope);
      const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
      if (tab === undefined || tab.kind !== 'architecture_graph') { scope.error = '请先打开架构图辅助页。'; renderScopeIfSelected(scope); return; }
      await submit(scope, 'architecture/read', { scope: scope.config.scope, input: { selection: tab.selection } });
      return;
    }
    case 'open-task-graph': {
      const goalId = scope.forms.goalId.trim() || scope.goal?.ref.goalId || reviewGoals()[0]?.goalId || '';
      if (goalId.length === 0) { scope.error = '请先填写或创建目标。'; renderScopeIfSelected(scope); return; }
      const goal: TaskGraph['plan']['goalRef'] = { aggregateType: 'Goal', projectId: scope.config.scope.projectId, goalId };
      scope.forms.goalId = goalId;
      openTab(scope, { tabId: `tasks:${goalId}`, kind: 'task_graph', title: '任务图', goal });
      saveScopeDisplay(scope);
      renderScopeIfSelected(scope);
      return;
    }
    case 'query-task-tab': {
      const layout = syncActiveLayout(scope);
      const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
      if (tab === undefined || tab.kind !== 'task_graph') { scope.error = '请先打开任务辅助页。'; renderScopeIfSelected(scope); return; }
      await submit(scope, 'tasks/query', { scope: scope.config.scope, input: { goalRef: tab.goal } });
      return;
    }
    case 'select-node':
      // In-place selection in the scope/tab captured now; the rendered SVG node
      // element survives so a native double click / context menu can still pin.
      selectGraphNode(scope, element);
      return;
    case 'toggle-pin': {
      const layout = syncActiveLayout(scope);
      const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
      if (tab === undefined || (tab.kind !== 'task_graph' && tab.kind !== 'architecture_graph')) return;
      const nodeId = element.dataset.node ?? '';
      if (nodeId.length === 0) return;
      storeLayout(scope, reduceWorkbenchLayout(layout, { kind: 'toggle_pin', tabId: tab.tabId, nodeId }));
      renderScopeIfSelected(scope);
      return;
    }
    case 'toggle-pin-selected': {
      const layout = syncActiveLayout(scope);
      const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
      if (tab === undefined || (tab.kind !== 'task_graph' && tab.kind !== 'architecture_graph')) return;
      const selected = tab.display?.selected ?? null;
      if (selected === null) return;
      storeLayout(scope, reduceWorkbenchLayout(layout, { kind: 'toggle_pin', tabId: tab.tabId, nodeId: selected.nodeId }));
      renderScopeIfSelected(scope);
      return;
    }
    case 'open-directory': {
      const path = element.dataset.path ?? '';
      openTab(scope, { tabId: `dir:${path}`, kind: 'directory', title: `目录 ${path.length === 0 ? '/' : path}`, path });
      await loadDirectory(scope, path, false);
      return;
    }
    case 'open-directory-input': {
      // The input belongs to THIS tab/scope (fixed origin); it never reuses the
      // global source prefix, so typing here cannot carry another scope's path.
      const tabId = element.dataset.tab ?? '';
      const input = Array.from(document.querySelectorAll<HTMLInputElement>('[data-field="directoryPrefix"]'))
        .find(candidate => candidate.dataset.tab === tabId) ?? null;
      const path = normalizeDirectoryInput(input?.value ?? '');
      openTab(scope, { tabId: `dir:${path}`, kind: 'directory', title: `目录 ${path.length === 0 ? '/' : path}`, path });
      await loadDirectory(scope, path, false);
      return;
    }
    case 'refresh-directory': {
      const layout = syncActiveLayout(scope);
      const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
      if (tab === undefined || tab.kind !== 'directory') { scope.error = '请先打开目录页。'; renderScopeIfSelected(scope); return; }
      await loadDirectory(scope, tab.path, true);
      return;
    }
    case 'directory-more': {
      const layout = syncActiveLayout(scope);
      const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
      if (tab === undefined || tab.kind !== 'directory') return;
      const inventory = scope.directories.get(tab.path);
      if (inventory === undefined) return;
      // Local only: reveal the next 100 of the SAME list, never a request.
      scope.directories.set(tab.path, showMoreDirectoryInventory(inventory));
      renderScopeIfSelected(scope);
      return;
    }
    case 'open-file': {
      const path = element.dataset.path ?? '';
      const body = buildFileRequest(path);
      if (!requireBody(scope, body)) return;
      scope.forms.filePath = path;
      await submit(scope, 'files/read', body);
      const envelope = record(scope.lastResponse?.payload);
      // Only THIS request's ready result opens a file page; a rejected/not_found
      // answer never falls back to a stale `scope.file`.
      const file = scope.lastRequest?.body === body && envelope.status === 'ready'
        && scope.file !== null && scope.file.path === path ? scope.file : null;
      if (file !== null) {
        const versionKey = JSON.stringify(file.version);
        openTab(scope, { tabId: `file:${file.path}@${versionKey}`, kind: 'file', title: file.path, file, editorDraft: null });
      }
      renderScopeIfSelected(scope);
      return;
    }
    case 'add-path-reference': {
      const path = element.dataset.path ?? '';
      if (path.length === 0) return;
      storeLayout(scope, reduceWorkbenchLayout(syncActiveLayout(scope), { kind: 'add_reference', reference: { kind: 'path', path } }));
      scope.notice = `已把 ${path} 加入当前对话草稿；未发送。`;
      renderScopeIfSelected(scope);
      return;
    }
    case 'add-selection-reference': {
      const path = element.dataset.path ?? '';
      const tabId = element.dataset.tab ?? '';
      const textarea = Array.from(document.querySelectorAll<HTMLTextAreaElement>('[data-field="fileEditor"]'))
        .find(candidate => candidate.dataset.tab === tabId) ?? null;
      if (textarea === null) { scope.error = '找不到文件编辑区。'; renderScopeIfSelected(scope); return; }
      const value = textarea.value;
      const start = textarea.selectionStart ?? 0;
      const end = textarea.selectionEnd ?? start;
      const selected = value.slice(start, end);
      if (selected.trim().length === 0) { scope.error = '请先在文件页选择要引用的文本。'; renderScopeIfSelected(scope); return; }
      const layout = syncActiveLayout(scope);
      const tab = layout.tabs.find(candidate => candidate.tabId === tabId);
      if (tab === undefined || tab.kind !== 'file') { scope.error = '文件页已关闭。'; renderScopeIfSelected(scope); return; }
      const startLine = value.slice(0, start).split('\n').length;
      const endLine = startLine + selected.split('\n').length - 1;
      const changed = tab.editorDraft !== null && tab.editorDraft.text !== tab.file.content;
      const reference: WorkbenchDraftReference = { kind: 'selection', path: tab.file.path, text: selected, startLine, endLine,
        version: tab.file.version, digest: tab.file.digest, source: changed ? 'draft_snapshot' : 'file' };
      storeLayout(scope, reduceWorkbenchLayout(layout, { kind: 'add_reference', reference }));
      scope.notice = `已加入选区引用 ${tab.file.path}:L${startLine}-L${endLine}${changed ? '（草稿快照）' : ''}；未发送。`;
      renderScopeIfSelected(scope);
      return;
    }
    case 'clear-composer': {
      storeLayout(scope, { ...syncActiveLayout(scope), composerDraft: { state: 'draft_snapshot', text: '', references: [] } });
      renderScopeIfSelected(scope);
      return;
    }
    case 'open-setup-tab': { openTab(scope, setupTab()); renderScopeIfSelected(scope); return; }
    case 'activate-tab': {
      view.contextNode = null;
      const tabId = element.dataset.tab ?? '';
      storeLayout(scope, reduceWorkbenchLayout(syncActiveLayout(scope), { kind: 'activate_tab', tabId }));
      renderScopeIfSelected(scope);
      return;
    }
    case 'close-tab': {
      view.contextNode = null;
      const tabId = element.dataset.tab ?? '';
      storeLayout(scope, reduceWorkbenchLayout(syncActiveLayout(scope), { kind: 'close_tab', tabId }));
      renderScopeIfSelected(scope);
      return;
    }
    case 'toggle-aux': {
      view.auxVisible = !view.auxVisible;
      if (!view.auxVisible) view.auxExpanded = false;
      applyWorkbenchLayout();
      renderScopeIfSelected(scope);
      return;
    }
    case 'expand-aux': {
      if (!view.auxVisible) { scope.error = '辅助区已隐藏，请先显示。'; renderScopeIfSelected(scope); return; }
      view.auxExpanded = !view.auxExpanded;
      applyWorkbenchLayout();
      renderScopeIfSelected(scope);
      return;
    }
    case 'retry': {
      if (scope.goalSetup !== null && scope.goalSetup.pending !== null) { await retryGoalSetup(scope); return; }
      if (scope.memberMail !== null && scope.memberMail.sendState === 'failed' && scope.memberMail.request !== null) {
        await retryMemberSend(scope);
        return;
      }
      if (scope.execution.pending !== null) { await retryExecution(scope); return; }
      if (scope.pending !== null) await submit(scope, scope.pending.route, scope.pending.body, scope.pending.tags);
      return;
    }
    case 'replay': if (scope.lastRequest !== null) await submit(scope, scope.lastRequest.route, scope.lastRequest.body, scope.lastRequest.tags); return;
    case 'rebuild-conflict': rebuildFromConflict(scope); return;
    default: return;
  }
}

/** An explicit user action, never automatic: adopt the real `current` pins the
 * domain returned (so the next explicitly built request can use them) and stop.
 * It never fakes a success and never loops on a stale version. */
function rebuildFromConflict(scope: ScopeState): void {
  const conflict = scope.conflict;
  if (conflict === null) return;
  let adopted = false;
  for (const entry of conflict.current) {
    const pin = record(entry);
    const ref = record(pin.ref);
    const revision = Number(pin.revision);
    if (!Number.isSafeInteger(revision)) continue;
    if (ref.aggregateType === 'Project' && scope.project === null) {
      scope.project = { ref, revision } as unknown as ProjectValue;
      adopted = true;
    }
    if (ref.aggregateType === 'Workspace' && scope.workspace === null) {
      scope.workspace = { ref, revision } as unknown as WorkspaceValue;
      adopted = true;
    }
  }
  scope.conflict = null;
  scope.notice = adopted
    ? '已采用返回的当前版本。请继续下一步；写操作不会自动重发。'
    : '该冲突没有可直接采用的版本，请核对输入后重新操作；不会伪造成功。';
  scope.error = null;
  renderScopeIfSelected(scope);
}

// ---------------------------------------------------------------------------
// Rendering (each region owns exactly one part of the workbench)
// views.ts owns the pure presentation; here we only mount it. The selected
// scope and every original request identity are retained, and no construction
// probe or internal exception is ever shown to the user.
// ---------------------------------------------------------------------------

function setHtml(id: string, html: string): void {
  const element = document.getElementById(id);
  if (element !== null) element.innerHTML = html;
}

function detailsBlock(summary: string, html: string): string {
  return `<details class="details"><summary>${escapeHtml(summary)}</summary>${html}</details>`;
}

function actionButton(action: string, label: string, enabled: boolean, reason: string): string {
  return enabled
    ? `<button data-action="${action}">${escapeHtml(label)}</button>`
    : `<button data-action="${action}" disabled title="${escapeHtml(reason)}">${escapeHtml(label)}</button>`;
}

function refusalLine(reason: string): string {
  return `<p class="muted">暂不可用：${escapeHtml(reason)}</p>`;
}

function versionLine(label: string, value: { ref: unknown; revision: number } | null, emptyText: string): string {
  if (value === null) return `<p class="muted">${escapeHtml(label)}：${escapeHtml(emptyText)}</p>`;
  return `<p>${escapeHtml(label)}：已就绪，版本 ${escapeHtml(value.revision)}</p>`
    + detailsBlock('查看版本引用', `<pre>${escapeHtml(JSON.stringify(value.ref, null, 2))}</pre>`);
}

/** The read-only Host collaboration projection: the page shows the driver's own
 * state/messages and never re-derives or fakes a terminal. */
function renderCollaboration(
  scope: ScopeState, collab: { goalRef: NonNullable<ExecutionRun['goalRef']>; result: WorkflowDriverReadResponse },
): string {
  if (collab.result.status === 'not_found') {
    return `<section data-collaboration><h3>协同推进</h3>`
      + `<p class="muted">本机没有目标 <code>${escapeHtml(collab.goalRef.goalId)}</code> 的活动句柄；原消息/回答仍在原历史中可查。</p></section>`;
  }
  if (collab.result.status !== 'ready') return '';
  const value = collab.result.value;
  const active = scope.activeMessage;
  const readMessage = active !== null && scope.message !== null && sameMessage(scope.message.messageRef, active)
    ? scope.message : null;
  const body = active !== null && scope.messageBody !== null && sameMessage(scope.messageBody.messageRef, active)
    ? scope.messageBody : null;
  const messages = value.messages.length === 0 ? ''
    : `<ul class="messages">${value.messages.map(message => {
      const isActive = active !== null && sameMessage(message.ref, active);
      return `<li${isActive ? ' data-active-message="true"' : ''}>`
        + `<code>${escapeHtml(message.ref.messageId)}</code> · ${escapeHtml(message.status)}`
        + ` · ${escapeHtml(message.sender.kind)}`
        + (message.replyMode === 'wait' ? ' · 等待回复' : '')
        + `<button class="link" data-action="read-collaboration-message" data-message-id="${escapeHtml(message.ref.messageId)}">查看消息</button>`
        + `</li>`;
    }).join('')}</ul>`;
  const siblings = value.siblings.length === 0 ? '' : `<ul>${value.siblings.map(sibling =>
    `<li><button class="link" data-action="select-collaboration-task" data-task-id="${escapeHtml(sibling.taskId ?? '')}">${escapeHtml(sibling.taskId ?? '目标整体')}</button> · ${escapeHtml(sibling.state)}</li>`
  ).join('')}</ul>`;
  return `<section data-collaboration><h3>协同推进</h3>`
    + `<p>${escapeHtml(value.taskId ?? '目标整体')} · 状态：${escapeHtml(value.state)}</p>`
    + siblings
    + (value.reason === null ? '' : `<p class="muted">${escapeHtml(value.reason)}</p>`)
    + messages
    + (readMessage === null ? '' : renderMessage(readMessage.result))
    + (body === null ? '' : renderMessageBody(body.result))
    + detailsBlock('查看完整快照', `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`)
    + `</section>`;
}

/** The execution entry availability derived from the CURRENT explicit Goal (a
 * typed/selected Goal counts even before any in-memory handle exists) plus the
 * real run/handle state. `run.running`/`run.pending` protection stays outside. */
function executionAvailability(scope: ScopeState): {
  canContinue: boolean; canRefresh: boolean; driverActive: boolean;
} {
  const run = scope.execution;
  const currentGoal = collaborationGoalRef(scope, run);
  const driverActive = scope.collaboration !== null && collaborationIsActive(scope.collaboration.result);
  return {
    canContinue: run.resumeIntent !== null || run.queryRunRef !== null
      || currentGoal !== null || scope.collaboration !== null,
    canRefresh: run.queryRunRef !== null || currentGoal !== null || scope.collaboration !== null,
    driverActive,
  };
}

/** Update the execution action buttons in place after a Goal edit so the formal
 * read/start entry becomes usable WITHOUT rebuilding the focused input. */
function refreshExecutionButtons(scope: ScopeState): void {
  const run = scope.execution;
  const { canContinue, canRefresh, driverActive } = executionAvailability(scope);
  const set = (action: string, enabled: boolean, reason: string): void => {
    const button = document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
    if (button === null) return;
    button.disabled = !enabled;
    if (enabled) button.removeAttribute('title');
    else button.setAttribute('title', reason);
  };
  set('run-continue', canContinue && !run.running && run.pending === null,
    run.pending === null ? '需要先有采用的计划或待续传步骤' : '存在尚未确认的原请求，请先重试');
  set('refresh-execution', canRefresh && !run.running, '没有进行中的调查或推进句柄');
  set('stop-execution', driverActive && !run.running, '没有进行中的协同推进');
}

/** R6 execution entry: the trusted startup execution projection, the one
 * question input and the two finite product actions plus the real owner results.
 * It never sends an HTTP step by itself, opens a background loop or marks a
 * result complete. */
function renderExecution(): string {
  if (bootstrapState === null) return '';
  const current = state();
  const run = current.execution;
  const profiles = renderExecutionProfiles(bootstrapState.execution, current.executionProfileId ?? undefined,
    run.running || run.pending !== null);
  const question = `<label class="inline">调查 / 规划问题 <input data-field="question" `
    + `value="${escapeHtml(current.forms.question)}" placeholder="例如：阅读来源并给出初始规划"></label>`;
  const { canContinue, canRefresh, driverActive } = executionAvailability(current);
  const taskSelection = `<label class="inline">指定 Task（可空） <input data-field="taskId" `
    + `value="${escapeHtml(current.forms.taskId)}" placeholder="例如：work-1"></label>`;
  const buttons = taskSelection + `<div class="buttons">`
    + actionButton('run-continue', '继续执行', canContinue && !run.running && run.pending === null,
      run.pending === null ? '需要先有采用的计划或待续传步骤' : '存在尚未确认的原请求，请先重试')
    + actionButton('review-plan-candidate', '审阅当前候选方案', run.planning !== null, '尚无可审阅的候选')
    + actionButton('refresh-execution', '刷新执行状态', canRefresh && !run.running, '没有进行中的调查或推进句柄')
    + actionButton('stop-execution', '停止推进', driverActive && !run.running,
      driverActive ? '' : '没有进行中的协同推进')
    + `</div>`;
  const messages = [run.notice, current.executionNotice, run.error].filter((entry): entry is string =>
    typeof entry === 'string' && entry.length > 0);
  const notice = messages.length === 0 ? ''
    : `<p class="muted" data-execution-notice>${messages.map(escapeHtml).join(' · ')}</p>`;
  const phase = run.phase === null ? ''
    : `<p class="muted" data-execution-phase>当前阶段：${escapeHtml(run.phase)}</p>`;
  const answer = run.answer === null ? '' : renderQueryAnswer(run.answer, run.body ?? undefined);
  const candidate = run.candidate === null ? ''
    : detailsBlock('已保留的初始计划候选', `<pre>${escapeHtml(JSON.stringify(run.candidate, null, 2))}</pre>`);
  const setupCandidate = current.planCandidate;
  const initialPlanSetup = setupCandidate === null ? ''
    : renderInitialPlanSetupReview(setupCandidate.setup, { adopt: setupCandidate.writable, plan: setupCandidate.plan })
      + (setupCandidate.writable ? ''
        : `<p class="muted" data-initial-plan-readonly>${escapeHtml(setupCandidate.readonlyReason)}</p>`);
  const planning = run.planning === null ? '' : renderInitialPlanning(run.planning, run.planningRequest);
  const advance = run.advance === null ? '' : renderWorkflowAdvance(run.advance, run.advanceRequest);
  const collaboration = current.collaboration === null ? '' : renderCollaboration(current, current.collaboration);
  const sent = run.calls.length === 0 ? ''
    : detailsBlock('已发送的完整原请求', `<pre>${escapeHtml(JSON.stringify(
      run.calls.map(call => ({ route: call.route, request: call.request })), null, 2))}</pre>`);
  return profiles + question + buttons + notice + phase + answer + candidate + initialPlanSetup + planning + advance + collaboration + sent;
}

function renderScope(): string {
  // The whole project tree (projects + current project children) is rendered by
  // renderNav, so the left column is one real tree rather than a selector plus a
  // separate member area.
  return '';
}
function renderInit(): string {
  const current = state();
  const policies = reviewPolicies();
  const policyOptions = policies.map((policy, index) =>
    `<option value="${index}"${current.forms.policyIndex === String(index) ? ' selected' : ''}>${escapeHtml(policy.policyId)} · 内容版本 ${escapeHtml(policy.contentRevision)}</option>`).join('');
  return `<section class="panel" data-view="init"><h2>项目 / 工作区</h2>`
    + `<label class="inline">项目 ID <input data-field="projectId" value="${escapeHtml(current.forms.projectId)}" placeholder="${escapeHtml(current.config.scope.projectId)}"></label>`
    + `<div class="buttons">${actionButton('create-project', '创建项目', true, '')}</div>`
    + versionLine('项目', current.project, '尚未读取登记状态（本页无创建回执）')
    + `<div class="buttons">${actionButton('register-workspace', '登记工作区', current.project !== null, '本页尚未取得项目的正式版本')}</div>`
    + versionLine('工作区', current.workspace, '尚未读取登记状态（本页无登记回执）')
    + `<h3>完成策略</h3>`
    + (policies.length === 0 ? refusalLine('本机没有提供完成策略资料。') : `<label class="inline">选择策略 <select data-field="policyIndex">${policyOptions}</select></label>`)
    + `<div class="buttons">`
      + actionButton('install-policy', '安装完成策略', current.project !== null && policies.length > 0, policies.length === 0 ? '没有可用策略资料' : '本页尚未取得项目的正式版本')
      + actionButton('activate-policy', '启用完成策略', current.policyInstall !== null, '需要先安装完成策略')
    + `</div>`
    + (current.policyInstall === null ? '<p class="muted">完成策略：尚未安装</p>'
      : `<p>完成策略：已安装，内容版本 ${escapeHtml(current.policyInstall.contentRevision)}</p>`
        + detailsBlock('查看详情', `<pre>${escapeHtml(JSON.stringify({ ref: current.policyInstall.ref, contentDigest: current.policyInstall.contentDigest }, null, 2))}</pre>`))
    + (current.policyActive === null ? '' : `<p>完成策略：已启用（版本 ${escapeHtml(current.policyActive.revision)}）</p>`)
    + `</section>`;
}

function renderGoal(): string {
  const current = state();
  const fallback = reviewGoals()[0];
  const placeholderGoal = current.goal?.ref.goalId ?? fallback?.goalId ?? '';
  const placeholderObjective = current.goal?.objective ?? fallback?.objective ?? '';
  const enabled = current.project !== null && current.workspace !== null;
  return `<section class="panel" data-view="goal"><h2>目标</h2>`
    + `<label class="inline">目标 ID <input data-field="goalId" value="${escapeHtml(current.forms.goalId)}" placeholder="${escapeHtml(placeholderGoal)}"></label>`
    + `<label class="inline">目标内容 <input data-field="objective" value="${escapeHtml(current.forms.objective)}" placeholder="${escapeHtml(placeholderObjective)}"></label>`
    + `<div class="buttons">${actionButton('create-goal', '创建目标', enabled, '本页尚未取得项目与工作区的正式版本')}</div>`
    + (current.goal === null ? '<p class="muted">目标：尚未创建</p>'
      : `<p>目标 <code>${escapeHtml(current.goal.ref.goalId)}</code>：已创建，版本 ${escapeHtml(current.goal.revision)}</p>`
        + `<p class="muted">${escapeHtml(current.goal.objective)}</p>`
        + detailsBlock('查看版本引用', `<pre>${escapeHtml(JSON.stringify(current.goal.ref, null, 2))}</pre>`))
    + `</section>`;
}

function renderPlan(): string {
  const current = state();
  const architectures = reviewArchitectures();
  const plans = reviewPlans();
  const architectureOptions = architectures.map((architecture, index) =>
    `<option value="${index}"${current.forms.architectureIndex === String(index) ? ' selected' : ''}>${escapeHtml(architecture.baselineId)} · ${escapeHtml(architecture.description)}</option>`).join('');
  const planOptions = plans.map((plan, index) =>
    `<option value="${index}"${current.forms.planIndex === String(index) ? ' selected' : ''}>${escapeHtml(plan.planId)} · ${escapeHtml(plan.reasonText)}</option>`).join('');
  const draftButton = actionButton('adopt-architecture-draft', '采用粘贴的初始架构',
    current.forms.architectureDraft.trim().length > 0 && !current.sending,
    current.sending ? '正在发送，请稍候' : '请先粘贴已审阅的初始架构 JSON');
  const advanced = `<details class="details" data-view="architecture-draft"><summary>高级：粘贴/导入已审阅的初始架构 JSON</summary>`
    + `<p class="muted">字段形状：<code>baselineId</code>（字符串）、<code>catalog</code>（包含 <code>modules</code>、<code>dependencies</code>、<code>requireDag</code>，可选 <code>containment</code>）、<code>description</code>（字符串）、<code>constraints</code>（<code>{ name, scope }</code> 数组）。模块与依赖只能由你显式提供；本页不会从来源或计划推断，也不会填入默认架构，最终仍由架构 owner 校验。</p>`
    + `<label class="inline">初始架构输入 JSON <textarea data-field="architectureDraft" rows="6" spellcheck="false">${escapeHtml(current.forms.architectureDraft)}</textarea></label>`
    + `<div data-architecture-draft-preview>${architectureDraftPreview(current.forms.architectureDraft)}</div>`
    + `<div class="buttons">${draftButton}</div>`
    + `</details>`;
  return `<section class="panel" data-view="plan"><h2>初始架构与计划</h2>`
    + (architectures.length === 0 ? refusalLine('本机没有提供初始架构资料。')
      : `<label class="inline">初始架构 <select data-field="architectureIndex">${architectureOptions}</select></label>`)
    + `<div class="buttons">${actionButton('adopt-architecture', '采用初始架构', current.project !== null && current.workspace !== null && architectures.length > 0, architectures.length === 0 ? '没有可用初始架构' : '本页尚未取得项目与工作区的正式版本')}</div>`
    + (current.adopted === null ? '<p class="muted">采用架构：尚未采用</p>'
      : `<p>采用架构：已采用，版本 ${escapeHtml(current.adopted.baseline.revision)}`
        + (current.adopted.catalog === null ? '（该基线早于目录，未记录模块）' : `，模块 ${current.adopted.catalog.catalog.modules.length}`) + `</p>`
        + detailsBlock('查看版本与摘要', `<pre>${escapeHtml(JSON.stringify({ baselineId: current.adopted.baseline.baselineId, revision: current.adopted.baseline.revision, contentDigest: current.adopted.baseline.contentDigest }, null, 2))}</pre>`))
    + advanced
    + `<h3>计划</h3>`
    + (plans.length === 0 ? refusalLine('本机没有提供计划草案资料。')
      : `<label class="inline">计划草案 <select data-field="planIndex">${planOptions}</select></label>`)
    + `<div class="buttons">`
      + actionButton('propose-plan', '提交计划草案', current.goal !== null && plans.length > 0, plans.length === 0 ? '没有可用计划草案' : '需要先创建目标')
      + actionButton('apply-plan', '采用计划', current.proposal !== null, '需要先提交计划草案')
    + `</div>`
    + (current.proposal === null ? '<p class="muted">计划草案：尚未提交</p>'
      : `<p>计划草案：已提交，版本 ${escapeHtml(current.proposal.revision)}，校验问题 ${current.proposal.issues.length}</p>`
        + detailsBlock('查看草案引用', `<pre>${escapeHtml(JSON.stringify(current.proposal.ref, null, 2))}</pre>`))
    + (current.plan === null ? '' : `<p>计划：已采用 <code>${escapeHtml(current.plan.ref.planId)}</code>，业务版本 ${escapeHtml(current.plan.planRevision)}</p>`
        + detailsBlock('查看计划引用', `<pre>${escapeHtml(JSON.stringify(current.plan.ref, null, 2))}</pre>`))
    + `</section>`;
}

function renderGraphs(): string {
  const current = state();
  const adoptedSource = current.architectureRead ?? (current.adopted === null ? null : { status: 'ready', value: current.adopted });
  const adoptedPanel = adoptedSource === null ? renderGap('采用架构', '尚未读取采用架构') : renderAdoptedGraph(adoptedSource as never);
  const observedPanel = current.observed === null ? renderGap('观察结构', '尚未查询观察结构（需先捕获）') : renderObservedGraph(current.observed as never);
  const taskPanel = current.taskGraph === null ? renderGap('任务图', '尚未读取任务图') : renderTaskGraph(current.taskGraph as never);
  return `<section class="panel" data-view="graphs"><h2>采用架构 / 观察结构 / 任务图</h2>`
    + `<div class="buttons">`
      + actionButton('capture-observed', '捕获观察结构', current.project !== null && current.workspace !== null && current.adopted !== null, current.adopted === null ? '需要先采用初始架构' : '本页尚未取得项目与工作区的正式版本')
      + actionButton('query-observed', '查看观察结构', current.observedCapture !== null, '需要先捕获观察结构')
      + actionButton('query-tasks', '查看任务图', true, '')
      + `<button data-action="open-task-graph">在辅助页打开任务结构</button>`
      + `<button data-action="open-architecture-graph">在辅助页打开架构图</button>`
    + `</div>`
    + (current.observedCapture === null ? '' : detailsBlock('查看观察捕获引用', `<pre>${escapeHtml(JSON.stringify(current.observedCapture, null, 2))}</pre>`))
    + `<div class="graph-panels">${adoptedPanel}${observedPanel}${taskPanel}</div>`
    + `</section>`;
}

function renderFiles(): string {
  const current = state();
  const providers = ['text', 'typescript', 'python', 'cpp'].map(provider =>
    `<option value="${provider}"${current.forms.provider === provider ? ' selected' : ''}>${provider}</option>`).join('');
  const page = current.sourcePage;
  const items = page === null ? '' : page.items.map(item => {
    const hit = record(item);
    const rawPath = record(hit.file).path;
    const path = typeof rawPath === 'string' ? rawPath : '';
    const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    return `<li><button class="link" data-action="read-path" data-path="${escapeHtml(path)}">${path.length === 0 ? shown(hit.kind) : escapeHtml(path)}</button>`
      + `<button class="link" data-action="open-file" data-path="${escapeHtml(path)}">打开文件页</button>`
      + (directory.length === 0 ? '' : `<button class="link" data-action="open-directory" data-path="${escapeHtml(directory)}">目录</button>`)
      + `</li>`;
  }).join('');
  return `<section class="panel" data-view="files"><h2>文件</h2>`
    + `<label class="inline">来源类型 <select data-field="provider">${providers}</select></label>`
    + `<label class="inline">路径前缀 <input data-field="prefix" value="${escapeHtml(current.forms.prefix)}" placeholder="src"></label>`
    + `<div class="buttons">`
      + actionButton('capture-source', '捕获来源', true, '')
      + actionButton('query-paths', '列出文件', current.capture !== null, '需要先捕获来源')
      + actionButton('query-next', '下一页', current.sourcePage !== null && current.sourcePage.nextCursor !== null, '没有更多了')
      + `<button data-action="open-directory" data-path="${escapeHtml(current.forms.prefix.trim())}">打开目录页</button>`
    + `</div>`
    + (current.capture === null ? '<p class="muted">来源：尚未捕获；打开页面不会自动捕获。</p>'
      : `<div>${renderSourceCapture({ status: 'ready', value: current.capture } as never)}</div>`)
    + (page === null ? '' : `<p>已列出 ${page.items.length} 个文件${page.nextCursor === null ? '' : '，还有更多'}</p>`
      + `<ul class="paths">${items}</ul>`
      + detailsBlock('查看游标', `<pre>${escapeHtml(String(page.nextCursor ?? 'none'))}</pre>`))
    + `<label class="inline">文件路径 <input data-field="filePath" value="${escapeHtml(current.forms.filePath)}" placeholder="README.md"></label>`
    + `<label class="inline">版本 <select data-field="readVersion"><option value="working_tree"${current.forms.readVersion === 'working_tree' ? ' selected' : ''}>工作区当前内容</option><option value="capture"${current.forms.readVersion === 'capture' ? ' selected' : ''}>已捕获内容</option></select></label>`
    + `<div class="buttons">${actionButton('read-file', '读取文件', true, '')}</div>`
    + (current.file === null ? '<p class="muted">文件内容：尚未读取</p>' : `<div>${renderFileRead({ status: 'ready', value: current.file } as never)}</div>`)
    + `</section>`;
}

// ---------------------------------------------------------------------------
// R6 UI-layout: fixed three-column workbench over the existing read results.
// Left = project/Agent navigation, center = original Session conversation,
// right = multi-tab auxiliary workspace. Layout/selection/tab/scroll/draft are
// display state only; every write still flows through the builders above.
// ---------------------------------------------------------------------------

const AUX_MIN_LEFT = 180;
const AUX_MIN_RIGHT = 240;
const AUX_MIN_CENTER = 320;

const view = { leftWidth: 180, rightWidth: 300, savedRightWidth: 300, auxVisible: false, auxExpanded: false,
  navVisible: true, centerMode: 'chat' as 'chat' | 'observe', centerMenuOpen: false, centerIdentityOpen: false,
  graphModes: new Map<string, string>(), graphEdges: new Map<string, string>(), detailOpen: new Map<string, boolean>(), contextNode: null as string | null,
  expandedProjects: new Set<string>(),
  theme: 'system' as 'light' | 'dark' | 'system' };

type TabDisplayState = { scrollTop: number; scrollLeft: number; selectionStart: number; selectionEnd: number; openDetails: Map<string, boolean> };
const tabDisplay = new Map<string, TabDisplayState>();
let renderedTabKey: string | null = null;

/** Center-conversation display state. Expanded <details> is captured from the
 * OLD DOM under the key that was rendered for it (never under the new state's
 * Session), then restored only when the freshly rendered DOM matches that key. */
type CenterDisplayState = { openDetails: Map<string, boolean> };
const centerDisplay = new Map<string, CenterDisplayState>();
let renderedCenterKey: string | null = null;
type ConversationScrollState = { key: string; top: number; atBottom: boolean };
let conversationScroll: ConversationScrollState | null = null;
let stickConversationToBottom = false;

const centerSessionOf = (scope: ScopeState): SessionRef | null => scope.activeSession ?? scope.mainSession;
function currentCenterKey(): string | null {
  const current = states.get(selectedKey);
  if (current === undefined) return null;
  const session = centerSessionOf(current);
  return `${current.key}|${session?.sessionId ?? ''}`;
}
function captureRenderedCenter(): void {
  if (renderedCenterKey === null) return;
  const body = document.getElementById('region-conversation');
  if (body === null) return;
  centerDisplay.set(renderedCenterKey, {
    openDetails: new Map(Array.from(body.querySelectorAll('details')).map(detail => [disclosureKey(detail, body), detail.open])),
  });
}
function restoreCenterDisplay(): void {
  const key = currentCenterKey();
  const body = document.getElementById('region-conversation');
  if (body !== null && key !== null) {
    const saved = centerDisplay.get(key);
    if (saved !== undefined) {
      body.querySelectorAll('details').forEach(detail => {
        const open = saved.openDetails.get(disclosureKey(detail, body));
        if (open !== undefined) detail.open = open;
      });
    }
  }
  renderedCenterKey = key;
}
function captureConversationScroll(): void {
  const body = document.getElementById('region-conversation');
  if (body === null || renderedCenterKey === null) return;
  conversationScroll = { key: renderedCenterKey, top: body.scrollTop,
    atBottom: body.scrollHeight - body.scrollTop - body.clientHeight <= 24 };
}
function restoreConversationScroll(): void {
  const body = document.getElementById('region-conversation');
  if (body === null) return;
  const key = currentCenterKey();
  if (stickConversationToBottom) {
    stickConversationToBottom = false;
    body.scrollTop = body.scrollHeight;
    conversationScroll = key === null ? null : { key, top: body.scrollTop, atBottom: true };
    return;
  }
  // Same Session keeps its place (and sticks to the bottom only if it was
  // already there); a different Session is never pulled to the old offset.
  if (conversationScroll !== null && key !== null && conversationScroll.key === key) {
    body.scrollTop = conversationScroll.atBottom ? body.scrollHeight : conversationScroll.top;
  } else {
    body.scrollTop = 0;
  }
}

const tabKey = (scope: ScopeState, tabId: string | null): string =>
  `${scope.key}|${tabId ?? ''}`;

/** Stable display identity: adding a nested result must not shift sibling state. */
function disclosureKey(detail: HTMLDetailsElement, boundary: HTMLElement): string {
  const path: string[] = [];
  let current: HTMLDetailsElement | null = detail;
  while (current !== null && boundary.contains(current)) {
    const summary = current.querySelector(':scope > summary')?.textContent?.trim() ?? '';
    // A record/terminal identity disambiguates sibling disclosures that share
    // the same summary text inside one activity group.
    const identity = current.dataset.disclosureKey ?? current.dataset.historyRaw ?? current.dataset.toolTerminal ?? '';
    const recordId = current.closest<HTMLElement>('[data-history]')?.dataset.history ?? '';
    path.unshift(identity.length > 0 ? identity : `${recordId}|${summary}`);
    current = current.parentElement?.closest('details') ?? null;
  }
  return JSON.stringify(path);
}

/** Snapshot the currently rendered auxiliary page before a re-render so each tab
 * keeps its own scroll, text selection and expanded details. */
function captureRenderedTab(): void {
  if (renderedTabKey === null) return;
  const body = document.getElementById('region-tab-body');
  if (body === null) return;
  const editor = body.querySelector<HTMLTextAreaElement>('[data-field="fileEditor"]');
  tabDisplay.set(renderedTabKey, {
    scrollTop: body.scrollTop,
    scrollLeft: body.scrollLeft,
    selectionStart: editor?.selectionStart ?? 0,
    selectionEnd: editor?.selectionEnd ?? 0,
    openDetails: new Map(Array.from(body.querySelectorAll('details')).map(detail => [disclosureKey(detail, body), detail.open])),
  });
}

function restoreTabDisplay(key: string): void {
  const body = document.getElementById('region-tab-body');
  if (body === null) return;
  const saved = tabDisplay.get(key);
  if (saved === undefined) { body.scrollTop = 0; body.scrollLeft = 0; return; }
  body.scrollTop = saved.scrollTop;
  body.scrollLeft = saved.scrollLeft;
  const editor = body.querySelector<HTMLTextAreaElement>('[data-field="fileEditor"]');
  if (editor !== null) {
    try { editor.setSelectionRange(saved.selectionStart, saved.selectionEnd); } catch { /* not selectable */ }
  }
  const details = body.querySelectorAll('details');
  details.forEach(detail => { const open = saved.openDetails.get(disclosureKey(detail, body)); if (open !== undefined) detail.open = open; });
}

/** Inline SVG artwork shipped with the static bundle (no CDN / host icon global). */
const TOP_ICON_PATHS: Record<string, string> = {
  'panel-left': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  'panel-right': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>',
  'panel-right-close': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/><path d="M18 8l-4 4 4 4"/>',
  'git-branch': '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  network: '<rect x="9" y="2" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="16" y="16" width="6" height="6" rx="1"/><path d="M12 8v4M5 16v-2h14v2"/>',
  'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  'git-compare': '<circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M6 9v3a3 3 0 0 0 3 3h6"/><path d="M18 15v-3a3 3 0 0 0-3-3H9"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  maximize: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>',
  'sun-moon': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  ellipsis: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  'arrow-up': '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 3.6h.1A2 2 0 1 1 13 3.6h.1a1.7 1.7 0 0 0 1.9.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1A2 2 0 1 1 21 11h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  'chevron-right': '<polyline points="9 6 15 12 9 18"/>',
  'chevron-down': '<polyline points="6 9 12 15 18 9"/>',
};
function topIcon(name: string): string {
  return `<svg class="q-icon-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${TOP_ICON_PATHS[name] ?? ''}</svg>`;
}

/** One stable lookup key for a configured Role (label lookup + disambiguation). */
function roleConfigKey(role: SessionRecord['role']): string {
  return role.kind === 'legacy_template'
    ? `legacy:${role.templateId}@${role.templateRevision}`
    : `spec:${role.pin.ref.projectId}/${role.pin.ref.roleId}@${role.pin.ref.revision}#${role.pin.digest}`;
}
function roleLabelsForScope(scope: CoreScope): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of sessionRolesForScope(scope)) map.set(roleConfigKey(entry.role), entry.label);
  return map;
}
/** Readable member name: trusted role-config label when supplied, else the short
 * Session id. A full identity stays in the row title / detail, never invented. */
function memberLabel(scope: ScopeState, ref: SessionRef): string {
  const card = sessionCardFor(scope, ref);
  if (card === null) return shortIdentity(ref.sessionId);
  return roleLabelsForScope(scope.config.scope).get(roleConfigKey(card.record.role)) ?? roleLabel(card.record.role);
}
/** The center's own Session-history page for an exact Session (main or member). */
function centerHistory(scope: ScopeState, ref: SessionRef | null): { session: SessionRef; result: SessionsHistoryResponse } | null {
  if (ref === null) return null;
  const stored = scope.sessionHistories.get(centerSessionHistoryKey(ref)) ?? null;
  return stored !== null && sameSession(stored.session, ref) ? stored : null;
}

function renderTopBar(): string {
  if (bootstrapState === null) return '';
  const current = states.get(selectedKey);
  const tool = (page: string, label: string, icon: string): string =>
    `<button class="q-icon" data-action="open-page" data-page="${page}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${topIcon(icon)}</button>`;
  return `<button class="q-icon" data-action="toggle-nav" aria-label="展开或收起项目导航" aria-pressed="${String(view.navVisible)}" title="项目导航">${topIcon('panel-left')}</button>`
    + `<strong>${escapeHtml(current?.config.name ?? '工作台')}</strong><span class="q-fill"></span>`
    + `<nav class="q-right-tools" aria-label="右侧资料与工具">`
    + tool('tasks', '任务图', 'git-branch') + tool('architecture', '架构图', 'network')
    + tool('files', '文件树', 'file-text') + tool('terminal', '命令', 'terminal') + tool('diff', 'Diff', 'git-compare')
    + `</nav>`
    + `<button class="q-icon" data-action="toggle-aux" aria-label="显示或隐藏右侧工作区" aria-expanded="${String(view.auxVisible)}" title="辅助工作区">${topIcon(view.auxVisible ? 'panel-right-close' : 'panel-right')}</button>`
    + `<button class="q-icon" data-action="toggle-theme" aria-label="切换明暗主题" title="主题">${topIcon('sun-moon')}</button>`;
}

function renderPageChooser(): string {
  const item = (page: string, label: string, icon: string): string =>
    `<button data-action="open-page" data-page="${page}">${topIcon(icon)}<span>${escapeHtml(label)}</span></button>`;
  return `<div class="q-chooser" data-view="page-chooser"><span>打开一个工作页面</span>`
    + item('tasks', '任务图', 'git-branch') + item('architecture', '架构图', 'network')
    + item('files', '文件资源管理器', 'file-text') + item('terminal', '命令', 'terminal')
    + item('diff', 'Diff', 'git-compare')
    + `<button data-action="open-setup-tab">${topIcon('settings')}<span>项目设置（次级）</span></button></div>`;
}

function renderCenterHead(): string {
  const current = state();
  const active = current.activeSession;
  const session = active ?? current.mainSession;
  const label = active !== null ? memberLabel(current, active) : '主对话';
  const life = sessionLifecycle(current, session);
  const card = session === null ? null : sessionCardFor(current, session);
  const stateText = life === 'archived' ? '已归档 · 只读'
    : card === null ? (session === null ? '' : '状态未读取') : AVAILABILITY_LABEL[card.availability];
  const drawer = view.centerIdentityOpen
    ? `<div class="q-drawer" data-view="center-identity">`
      + (session === null
        ? '<p>尚未绑定主会话；发送目标后会由正式 Session 承载。</p>'
        : `<p><strong>${escapeHtml(label)}</strong></p><p>Session <code>${escapeHtml(session.sessionId)}</code></p>`
          + (card === null ? '' : `<p class="muted">角色 ${escapeHtml(roleLabel(card.record.role))} · 健康 ${escapeHtml(card.record.health)} · ${escapeHtml(card.record.lifecycle)}</p>`))
      + `</div>`
    : '';
  let menu = '';
  if (view.centerMenuOpen) {
    const modeButton = (mode: string, text: string): string =>
      `<button data-action="set-center-mode" data-mode="${mode}" aria-pressed="${String(view.centerMode === mode)}">${text}</button>`;
    const groupButton = (group: string, text: string): string =>
      `<button data-action="set-grouping" data-grouping="${group}" aria-pressed="${String(current.historyFold === (group === 'task'))}">${text}</button>`;
    const controls: string[] = [];
    if (session !== null && life !== 'archived') {
      controls.push(`<button data-action="read-center-history">刷新历史</button>`);
      const stored = centerHistory(current, session);
      if (stored !== null && stored.result.status === 'ready' && stored.result.value.nextCursor !== null) {
        controls.push(`<button data-action="next-center-history"${current.sending ? ' disabled' : ''}>继续加载</button>`);
      }
      if (selectedExecutionProfile(current) !== null) controls.push(`<button data-action="run-planning">形成方案</button>`);
      if (current.execution.advance !== null || current.execution.planning !== null) controls.push(`<button data-action="run-continue">采用并执行</button>`);
      if (current.collaboration !== null || current.execution.phase === 'running') controls.push(`<button data-action="stop-execution">停止推进</button>`);
    }
    const newGoal = current.goal === null && current.forms.goalId.trim().length === 0;
    if (newGoal) controls.push(`<button data-action="run-new-goal">新建目标</button>`);
    // No-Session 更多 keeps an explicit 开始调查 and plan entry for an existing Goal.
    if (session === null && !newGoal) {
      if (selectedExecutionProfile(current) !== null) controls.push(`<button data-action="run-planning">形成方案</button>`);
      controls.push(`<button data-action="start-goal-investigation">开始调查</button>`);
    }
    menu = `<div class="q-menu" data-view="center-menu">`
      + modeButton('chat', '对话') + modeButton('observe', '行为观察')
      + groupButton('original', '原序') + groupButton('task', 'Task 收纳')
      + controls.join('') + `</div>`;
  }
  return `<div class="q-titlebar" data-view="center-head" data-mode="${view.centerMode}">`
    + `<button data-action="toggle-center-identity" aria-expanded="${String(view.centerIdentityOpen)}">${escapeHtml(label)}</button>`
    + `<span class="q-fill"></span>`
    + (session === null ? '' : `<button data-action="view-latest"${current.sending ? ' disabled' : ''}>查看最新</button>`)
    + (stateText.length === 0 ? '' : `<span class="muted">${escapeHtml(stateText)}</span>`)
    + `<button class="q-icon" data-action="toggle-center-menu" aria-label="更多会话操作" aria-expanded="${String(view.centerMenuOpen)}" title="更多会话操作">${topIcon('ellipsis')}</button>`
    + `</div>` + drawer + menu;
}

function renderCenterNotices(current: ScopeState): string {
  const run = current.execution;
  const messages = [run.notice, current.executionNotice, run.error, current.error, current.notice]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const noticeBody = `<p class="muted" data-execution-notice>${messages.map(escapeHtml).join(' · ')}</p>`;
  const settled = !run.running && run.error === null && current.error === null && run.answer?.status === 'ready';
  const notice = messages.length === 0 ? '' : settled
    ? `<details class="q-fold" data-disclosure-key="execution-notice"><summary>执行提示</summary>${noticeBody}</details>` : noticeBody;
  const answer = run.answer === null ? '' : renderQueryAnswer(run.answer, run.body ?? undefined);
  const planning = run.planning === null ? '' : renderInitialPlanning(run.planning, run.planningRequest);
  const advance = run.advance === null ? '' : renderWorkflowAdvance(run.advance, run.advanceRequest);
  const facts = answer + planning + advance;
  const folded = facts.length === 0 ? '' : `<details class="q-fold" data-view="execution-facts"><summary class="cursor-interaction"><span class="q-chevron">›</span>本次执行事实（问答 / 规划 / 推进）</summary><div class="q-foldbody">${facts}</div></details>`;
  const candidate = current.planCandidate;
  const review = candidate === null ? ''
    : renderInitialPlanSetupReview(candidate.setup, { adopt: candidate.writable, plan: candidate.plan })
      + (candidate.writable ? '' : `<p class="muted">${escapeHtml(candidate.readonlyReason)}</p>`);
  const collaboration = current.collaboration === null ? '' : renderCollaboration(current, current.collaboration);
  return notice + review + collaboration + folded;
}

/** The narrow goal-conversation start surface. It offers only real, positively
 * read actions: 选择模型并开始调查 (existing settings), 开始调查 (explicit start)
 * and 继续准备调查 (a proven claimed/prepared original QueryRun). It never
 * adopts, executes or claims completion. */
function renderGoalConversationStart(scope: ScopeState): string {
  const start = scope.goalConversation.snapshot();
  const displayed = scope.activeSession ?? scope.mainSession;
  const resumable = scope.execution.resumable;
  const pieces: string[] = [];
  if (start.notice !== null) pieces.push(`<p class="muted" data-start-notice>${escapeHtml(start.notice)}</p>`);
  const resumableMatches = resumable !== null && sameSession(resumable.session, displayed);
  const resumableReady = resumableMatches && (resumable.phase === 'claimed' || resumable.phase === 'prepared');
  if (resumableMatches && !resumableReady) {
    const observation = `<p class="muted" data-start="observe">原调查已进入 ${escapeHtml(resumable.phase)}，这里只读取事实，不会重新开始。</p>`;
    pieces.push(resumable.phase === 'settled'
      ? `<details class="q-fold"><summary><span class="q-chevron">›</span>先前调查状态</summary>${observation}</details>`
      : observation);
  }
  const hasGoal = scope.goal !== null || scope.forms.goalId.trim().length > 0;
  const startBusy = start.status === 'creating' || start.status === 'investigating';
  // The controller requested settings (missing profile) or the no-Session Goal
  // has no current profile. The SAME settings action is shown once, for a
  // displayed Session as well; a profile that appeared meanwhile clears it.
  const needsSettings = selectedExecutionProfile(scope) === null
    && (start.action === '选择模型并开始调查' || (!startBusy && displayed === null && hasGoal));
  if (resumableReady && !needsSettings) {
    pieces.push(`<section class="policy-choice" data-view="goal-start" data-start="resume">`
      + `<p>原会话 ${escapeHtml(resumable.session.sessionId)} 已有正式调查（${escapeHtml(resumable.phase)}），可以继续准备。</p>`
      + `<div class="buttons"><button data-action="resume-original-investigation">继续准备调查</button></div></section>`);
  }
  if (needsSettings) {
    pieces.push(`<section class="policy-choice" data-view="goal-start" data-start="needs-profile">`
      + `<p>当前工作区没有可用的模型/调查配置，请选择模型后继续。</p>`
      + `<div class="buttons"><button data-action="open-goal-model-settings">选择模型并开始调查</button></div></section>`);
  } else if (displayed === null && hasGoal && !startBusy) {
    pieces.push(`<section class="policy-choice" data-view="goal-start" data-start="ready">`
      + `<div class="buttons"><button data-action="start-goal-investigation">开始调查</button></div></section>`);
  }
  const goalRead = record(scope.goalRead);
  const detail = goalRead.status === 'ready' ? record(goalRead.value) : null;
  if (scope.activeSession === null && scope.mainSession !== null && hasGoal
    && selectedExecutionProfile(scope) !== null && sessionLifecycle(scope, scope.mainSession) !== 'archived'
    && !startBusy && !scope.execution.running && scope.execution.pending === null
    && scope.pending === null && !scope.sending && scope.memberMail?.consultState !== 'running'
    && detail !== null && detail.pendingPlan === null && record(detail.goal).activePlanRevision === null) {
    pieces.push(`<div class="initial-plan-next" data-view="planning-next">`
      + `<button data-action="run-planning">形成方案</button>`
      + `<span class="muted">先审阅方案，采用后才写文件和运行命令。</span></div>`);
  }
  if (scope.activeSession === null && detail !== null && record(detail.goal).activePlanRevision != null
    && !scope.execution.running && scope.execution.pending === null && scope.pending === null
    && !scope.sending && !collaborationIsActive(scope.collaboration?.result ?? { status: 'not_found' })
    && !(scope.collaboration?.result.status === 'ready' && scope.collaboration.result.value.state === 'completed')) {
    pieces.push('<div class="buttons"><button data-action="run-continue">继续推进</button></div>');
  }
  return pieces.join('');
}

function renderProjectIntro(current: ScopeState): string {
  const profile = selectedExecutionProfile(current);
  const goalId = current.goal?.ref.goalId ?? (current.forms.goalId.trim().length > 0 ? current.forms.goalId.trim() : null);
  return `<section class="conversation" data-view="project-conversation">`
    + renderProjectConversation({ scope: current.config.scope, workspaceName: current.config.name,
      goalText: currentGoalObjective(current), goalId, projectState: current.projectReadState, hasProfile: profile !== null })
    + (current.goalSetup === null ? '' : renderGoalSetup(current.goalSetup))
    + renderGoalConversationStart(current)
    + renderCenterNotices(current) + `</section>`;
}

function renderObserve(current: ScopeState, session: SessionRef | null): string {
  const list = current.executionList;
  if (list === null) {
    return `<section class="conversation" data-view="observe"><p class="muted">行为观察读取当前目标已有的真实执行事实；不新增语义推断。</p>`
      + `<div class="buttons"><button data-action="load-executions">读取执行事实</button></div>`
      + renderCenterNotices(current) + `</section>`;
  }
  return `<section class="conversation" data-view="observe" data-session="${session === null ? '' : escapeHtml(session.sessionId)}">`
    + renderTaskExecutionTimeline({ items: list.items, nextCursor: list.nextCursor, readThrough: list.readThrough },
      current.timeline, readyTaskGraphValue(current)?.tasks)
    + renderTaskExecutionFold({ items: list.items, nextCursor: list.nextCursor, readThrough: list.readThrough })
    + renderCenterNotices(current) + `</section>`;
}

function renderCenterBody(): string {
  const current = state();
  const active = current.activeSession;
  const session = active ?? current.mainSession;
  if (view.centerMode === 'observe') return renderObserve(current, session);
  if (session === null) return renderProjectIntro(current);
  const stored = centerHistory(current, session);
  const list = current.executionList;
  const executions = current.historyFold && list !== null ? list.items : undefined;
  const history = stored === null
    ? renderGap('sessions/history', active !== null
      ? '尚未读取该成员的完整原历史；点击标题旁的“更多”后读取历史。'
      : '尚未读取主会话的原历史；点击标题旁的“更多”后读取历史。')
    : renderSessionHistoryTimeline(stored.result, executions);
  const readyHistory = stored !== null && stored.result.status === 'ready' ? stored.result.value : null;
  const historyActions = readyHistory === null ? ''
    : `<div class="buttons history-continue">`
      + (readyHistory.nextCursor === null ? '' : `<button data-action="next-center-history"${current.sending ? ' disabled' : ''}>继续加载</button>`)
      + `</div>`;
  const mail = current.memberMail !== null && sameSession(current.memberMail.session, session) ? current.memberMail : null;
  // Task grouping is a mode over the SAME saved events; it never parks a second
  // execution list or a button wall in the conversation.
  return `<section class="conversation" data-view="center-body" data-session="${escapeHtml(session.sessionId)}">`
    + `<div class="chat-stream">${history}${historyActions}${mail === null ? '' : renderMemberMail(mail)}${renderGoalConversationStart(current)}${renderCenterNotices(current)}</div></section>`;
}

function renderDetail(): string {
  const current = state();
  const layout = syncActiveLayout(current);
  const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
  if (tab === undefined) return '';
  if (tab.kind !== 'task_graph' && tab.kind !== 'architecture_graph') return '';
  if (tab.display?.selected === undefined || tab.display.selected === null) return '';
  const open = view.detailOpen.get(`${current.key}|${tab.tabId}`) !== false;
  if (!open) return '';
  return `<div data-view="graph-detail">${renderGraphSelectionPanel(tab.display)}</div>`;
}

const AVAILABILITY_LABEL: Record<SessionCard['availability'], string> = {
  idle: '待命', busy: '工作中', recoverable: '可恢复', unavailable: '不可用',
};

function roleLabel(role: SessionRecord['role']): string {
  return role.kind === 'role_spec'
    ? `${role.pin.ref.roleId}@${String(role.pin.ref.revision)}`
    : `模板 ${role.templateId}`;
}

const conversationKey = (session: SessionRef | null): string => session === null ? '__project__' : `session:${session.sessionId}`;

/** The center conversation's own Session-history page. */
const centerSessionHistoryKey = (session: SessionRef): string =>
  sessionHistoryPageKey('center', session);

/** One auxiliary history/session tab's own Session-history page. */
const tabSessionHistoryKey = (tabId: string, session: SessionRef): string =>
  sessionHistoryPageKey(`tab:${tabId}`, session);

function sessionLifecycle(scope: ScopeState, ref: SessionRef | null): SessionRecord['lifecycle'] | null {
  if (ref === null) return null;
  const mainRead = scope.mainSessionRead;
  if (mainRead !== null && sameSession(mainRead.session, ref)) {
    return mainRead.result.status === 'ready' ? mainRead.result.value.record.lifecycle : null;
  }
  const read = scope.sessionRead;
  if (read !== null && sameSession(read.session, ref) && read.result.status === 'ready') return read.result.value.record.lifecycle;
  const found = scope.sessionFind;
  if (found !== null && found.status === 'ready') {
    const card = found.value.items.find(item => item.record.ref.sessionId === ref.sessionId);
    if (card !== undefined) return card.record.lifecycle;
  }
  const related = scope.relatedSessions;
  if (related !== null && related.result.status === 'ready') {
    const card = related.result.value.items.find(item => item.record.ref.sessionId === ref.sessionId);
    if (card !== undefined) return card.record.lifecycle;
  }
  // Unread registration stays unknown; it is never inferred from a listing order.
  return null;
}

const setupTab = (): WorkbenchTab => ({ tabId: 'setup', kind: 'setup', title: '项目 / 计划' });

/** One composite view for the current selection: the project-shared tabs plus
 * the current recipient's draft and read-only fact. Nothing is cached per
 * conversation, so switching members can never split the auxiliary pane. */
function activeLayout(scope: ScopeState): WorkbenchLayout {
  const key = conversationKey(scope.activeSession);
  return {
    scope: scope.config.scope,
    session: scope.activeSession,
    tabs: scope.auxTabs,
    activeTabId: scope.auxActiveTabId,
    composerDraft: scope.drafts.get(key) ?? { state: 'draft_snapshot', text: '', references: [] },
    readOnly: sessionLifecycle(scope, scope.activeSession ?? scope.mainSession) === 'archived',
  };
}
function storeLayout(scope: ScopeState, layout: WorkbenchLayout): void {
  scope.auxTabs = layout.tabs;
  scope.auxActiveTabId = layout.activeTabId;
  scope.drafts.set(conversationKey(layout.session), layout.composerDraft);
}
function syncActiveLayout(scope: ScopeState): WorkbenchLayout {
  return activeLayout(scope);
}

function openTab(scope: ScopeState, tab: WorkbenchTab): void {
  view.contextNode = null;
  // An explicit open reveals the auxiliary area; it can still be hidden again.
  view.auxVisible = true;
  storeLayout(scope, reduceWorkbenchLayout(syncActiveLayout(scope), { kind: 'open_tab', tab }));
}

/** A file/diff page belongs to the project pane, not to the Session it was opened
 * from: the captured origin Session is only the draft/history source. */
// (removed) file/diff pages open into the project-shared tab pane via openTab.
function sameWorkLinkTarget(left: WorkLinkTarget, right: WorkLinkTarget): boolean {
  if (left.kind === 'task' && right.kind === 'task') {
    return left.ref.projectId === right.ref.projectId && left.ref.goalId === right.ref.goalId
      && left.ref.taskId === right.ref.taskId;
  }
  if (left.kind === 'module' && right.kind === 'module') {
    return left.ref.projectId === right.ref.projectId && left.ref.moduleId === right.ref.moduleId;
  }
  if (left.kind === 'work' && right.kind === 'work') {
    return left.ref.projectId === right.ref.projectId && left.ref.workspaceId === right.ref.workspaceId
      && left.ref.workId === right.ref.workId;
  }
  return false;
}

function readyTaskGraphValue(scope: ScopeState): TaskGraph | null {
  const payload = record(scope.taskGraph);
  return payload.status === 'ready' ? payload.value as TaskGraph : null;
}

function moduleDefinition(scope: ScopeState, moduleId: string): Record<string, unknown> | null {
  const read = record(scope.architectureRead);
  const revisions: unknown[] = [];
  if (read.status === 'ready') revisions.push(read.value);
  if (scope.adopted !== null) revisions.push(scope.adopted);
  for (const revision of revisions) {
    const modules = list(record(record(record(revision).catalog).catalog).modules);
    for (const entry of modules) {
      const module = record(entry);
      if (record(module.ref).moduleId === moduleId) return module;
    }
  }
  return null;
}

const architectureSelectionKey = (selection: ArchitectureReadBody['input']['selection']): string =>
  selection.kind === 'current' ? 'current' : `revision:${selection.ref.baselineId}@${selection.ref.revision}`;

// Auxiliary visibility lives in the top bar and tab strip.
function workTargetFromElement(element: HTMLElement): WorkLinkTarget | null {
  const kind = element.dataset.targetKind;
  const projectId = element.dataset.projectId ?? '';
  if (kind === 'task') return { kind: 'task', ref: { projectId, goalId: element.dataset.goalId ?? '', taskId: element.dataset.taskId ?? '' } };
  if (kind === 'module') return { kind: 'module', ref: { projectId, moduleId: element.dataset.moduleId ?? '' } };
  if (kind === 'work') return { kind: 'work', ref: { aggregateType: 'WorkContextBinding', projectId, workspaceId: element.dataset.workspaceId ?? '', workId: element.dataset.workId ?? '' } };
  return null;
}

function sessionRefFromAny(scope: ScopeState, sessionId: string): SessionRef | null {
  const fromFind = sessionRefFromFind(scope, sessionId);
  if (fromFind !== null) return fromFind;
  const related = scope.relatedSessions;
  if (related !== null && related.result.status === 'ready') {
    const card = related.result.value.items.find(item => item.record.ref.sessionId === sessionId);
    if (card !== undefined) return { projectId: card.record.ref.projectId, sessionId: card.record.ref.sessionId };
  }
  return scope.activeSession !== null && scope.activeSession.sessionId === sessionId ? scope.activeSession : null;
}

/** Related-Session page builder. It keeps the exact `target` and the related
 * page's OWN cursor; it never borrows the project directory's cursor/request, so
 * the two `sessions/find` pages stay separate. A filter change marks the old
 * target result unread (the caller clears it) instead of relabelling it. */
function buildRelatedSessionsRequest(next: boolean): unknown | null {
  const current = state();
  const related = current.relatedSessions;
  if (related === null) return null;
  // Continue the ORIGINAL target + filter (+ optional role) with that page's own
  // cursor; never the current directory filter or another page's cursor.
  const input: Record<string, unknown> = { workspace: current.config.scope, target: related.target,
    includeArchived: related.includeArchived };
  if (related.role !== null) input.role = related.role;
  if (!next) {
    input.page = { limit: 10 };
    return { scope: current.config.scope, input };
  }
  if (related.result.status !== 'ready' || related.result.value.nextCursor === null) return null;
  input.page = { limit: 10, cursor: related.result.value.nextCursor, atLeastCursor: related.result.value.sourceCursor };
  return { scope: current.config.scope, input };
}

/** The run-window page builder. It receives the exact scope, RunRef and the page
 * being continued; `next` follows that page's own `nextCursor` and never invents
 * or rewrites a cursor. `limit` is the scan count, not the match count. */
function buildExecutionHistoryRequest(
  targetScope: CoreScope, run: RunRef, previous: WorkbenchExecutionHistoryPage | null, next: boolean,
): unknown | null {
  let afterCursor: string | null = null;
  if (next) {
    if (previous === null || !executionHistoryMatches(previous, targetScope, run)
      || previous.result.status !== 'ready' || previous.result.value.nextCursor === null) return null;
    afterCursor = previous.result.value.nextCursor;
  }
  return { scope: targetScope, input: { runRef: run, afterCursor, limit: 10 } };
}

/** One execution page is one typed tab per scope + full RunRef; a title never
 * carries identity. */
const executionTabId = (run: RunRef): string =>
  `execution:${run.aggregateType}:${run.projectId}:${run.goalId}:${run.runId}`;

/** Read the complete typed RunRef from the rendered entry's data attributes. */
function runRefFromElement(element: HTMLElement): RunRef | null {
  const aggregateType = element.dataset.aggregateType;
  const projectId = element.dataset.projectId ?? '';
  const goalId = element.dataset.goalId ?? '';
  const runId = element.dataset.runId ?? '';
  if (aggregateType !== 'Run' || projectId.length === 0 || goalId.length === 0 || runId.length === 0) return null;
  return { aggregateType, projectId, goalId, runId };
}

function taskTripleFromElement(element: HTMLElement): Extract<WorkbenchTab, { kind: 'execution_history' }>['task'] {
  const projectId = element.dataset.projectId ?? '';
  const goalId = element.dataset.goalId ?? '';
  const taskId = element.dataset.taskId ?? '';
  if (projectId.length === 0 || goalId.length === 0 || taskId.length === 0) return null;
  return { projectId, goalId, taskId };
}

/** The active auxiliary tab when it is an execution page, else null. */
function activeExecutionTab(scope: ScopeState): Extract<WorkbenchTab, { kind: 'execution_history' }> | null {
  const layout = syncActiveLayout(scope);
  const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
  return tab !== undefined && tab.kind === 'execution_history' ? tab : null;
}

// --- Left: project / Agent navigation -----------------------------------------

const shortIdentity = (value: string): string => value.length > 28 ? `${value.slice(0, 15)}…${value.slice(-10)}` : value;

/** Open a real auxiliary page kind from the top bar / `＋` chooser. It reuses
 * the existing owners and reads; it never defaults to project settings. */
async function openPageKind(scope: ScopeState, page: string): Promise<void> {
  switch (page) {
    case 'tasks': {
      const goalId = scope.forms.goalId.trim() || scope.goal?.ref.goalId || currentGoalRefForList(scope)?.goalId || '';
      if (goalId.length === 0) { scope.error = '请先填写或创建目标，再打开任务图。'; renderScopeIfSelected(scope); return; }
      const goal: TaskGraph['plan']['goalRef'] = { aggregateType: 'Goal', projectId: scope.config.scope.projectId, goalId };
      scope.forms.goalId = goalId;
      openTab(scope, { tabId: `tasks:${goalId}`, kind: 'task_graph', title: '任务图', goal });
      saveScopeDisplay(scope);
      // Direct open reads the real graph; there is no forced setup step.
      await submit(scope, 'tasks/query', { scope: scope.config.scope, input: { goalRef: goal } });
      await loadExecutions(scope, false, goal);
      return;
    }
    case 'architecture': {
      const selection: ArchitectureReadBody['input']['selection'] = { kind: 'current' };
      openTab(scope, { tabId: 'architecture:current', kind: 'architecture_graph', title: '架构图', selection });
      await submit(scope, 'architecture/read', { scope: scope.config.scope, input: { selection } });
      return;
    }
    case 'files': {
      openTab(scope, { tabId: 'dir:', kind: 'directory', title: '文件', path: '' });
      await loadDirectory(scope, '', false); return;
    }
    case 'terminal': {
      openTab(scope, { tabId: 'terminal:new', kind: 'terminal', title: '命令', commandId: 'new', command: '', cwd: '.' });
      renderScopeIfSelected(scope); return;
    }
    case 'diff': {
      openTab(scope, { tabId: 'compare:new', kind: 'compare', title: 'Diff' });
      renderScopeIfSelected(scope); return;
    }
    default: {
      openTab(scope, { tabId: `blank:${String(Date.now())}`, kind: 'blank', title: '新页面' });
      renderScopeIfSelected(scope); return;
    }
  }
}

/** Real workspace snapshot -> path projection, in one step. Reuses an already
 * captured snapshot unless `refresh` is set; it writes nothing to disk. */
async function ensureSourceTree(scope: ScopeState, refresh: boolean): Promise<void> {
  if (refresh || scope.capture === null) {
    if (refresh) scope.capture = null;
    await submit(scope, 'source/capture', buildSourceCaptureRequest());
    if (scope.capture === null) return;
    scope.sourcePage = null;
  }
  if (scope.sourcePage === null) await submit(scope, 'source/query', buildSourceQueryRequest(false));
}

/** Reuse the one scope-switch path for the tree click and the legacy <select>. */
function switchScope(key: string): void {
  if (!states.has(key)) return;
  selectedKey = key;
  view.expandedProjects.add(key);
  saveGlobalDisplay();
  renderAll();
  const next = states.get(key);
  if (next === undefined) return;
  if (next.sessionFind === null) void submit(next, 'sessions/find', buildSessionFindRequest(false));
  void restoreScopeDisplay(next);
  const goalRef = next.collaboration?.goalRef ?? collaborationGoalRef(next, next.execution);
  if (goalRef !== null) beginCollaborationPoll(next, next.execution.scope ?? next.config.scope, goalRef);
}

function renderProjectChildren(current: ScopeState): string {
  const labels = roleLabelsForScope(current.config.scope);
  const labelCounts = new Map<string, number>();
  const found = current.sessionFind;
  const cards = found !== null && found.status === 'ready' ? found.value.items : [];
  for (const card of cards) {
    const name = labels.get(roleConfigKey(card.record.role)) ?? roleLabel(card.record.role);
    labelCounts.set(name, (labelCounts.get(name) ?? 0) + 1);
  }
  const memberRow = (card: SessionCard, archived: boolean): string => {
    const ref: SessionRef = { projectId: card.record.ref.projectId, sessionId: card.record.ref.sessionId };
    const name = labels.get(roleConfigKey(card.record.role)) ?? roleLabel(card.record.role);
    const ambiguous = (labelCounts.get(name) ?? 0) > 1;
    const dot = archived ? 'idle'
      : card.availability === 'busy' ? 'busy' : card.availability === 'idle' ? '' : card.availability === 'recoverable' ? 'pending' : 'idle';
    const stateText = archived ? '只读' : AVAILABILITY_LABEL[card.availability];
    const selected = sameSession(current.activeSession, ref);
    const title = `${name} · ${ref.sessionId} · ${roleLabel(card.record.role)} · ${AVAILABILITY_LABEL[card.availability]}${archived ? ' · 归档只读' : ''}`;
    return `<li data-session="${escapeHtml(ref.sessionId)}">`
      + `<button class="q-person" data-action="select-session" data-session="${escapeHtml(ref.sessionId)}" aria-pressed="${String(selected)}" title="${escapeHtml(title)}">`
      + `<span class="q-dot ${dot}" aria-hidden="true"></span>`
      + `<span class="q-member-label">${escapeHtml(name)}${ambiguous ? ` <small class="q-member-suffix">${escapeHtml(ref.sessionId.slice(-4))}</small>` : ''}</span>`
      + `<span class="q-member-state">${escapeHtml(stateText)}</span></button></li>`;
  };
  const main = `<li><button class="q-person" data-action="select-main-conversation" aria-pressed="${String(current.activeSession === null)}" title="项目主对话${current.mainSession === null ? '' : ` · ${escapeHtml(current.mainSession.sessionId)}`}">`
    + `<span class="q-dot"></span><span class="q-member-label">主对话</span>`
    + (current.mainSession === null ? '' : `<span class="q-member-state">${escapeHtml(shortIdentity(current.mainSession.sessionId))}</span>`) + `</button></li>`;
  const activeCards = cards.filter(card => card.record.lifecycle === 'active');
  const list = found === null ? '<li class="q-nav-empty">尚未读取成员</li>'
    : found.status !== 'ready' ? `<li class="q-nav-empty">成员目录暂不可用（${escapeHtml(found.status)}）</li>`
      : activeCards.length === 0 ? '<li class="q-nav-empty">没有活跃成员</li>'
        : activeCards.map(card => memberRow(card, false)).join('');
  const archived = cards.filter(card => card.record.lifecycle === 'archived');
  const archiveBlock = archived.length === 0 ? ''
    : `<li><details class="q-archive"${current.sessionIncludeArchived ? ' open' : ''}><summary>已归档（只读）</summary>`
      + `<ul class="q-people">${archived.map(card => memberRow(card, true)).join('')}</ul></details></li>`;
  const canNext = found !== null && found.status === 'ready' && found.value.nextCursor !== null;
  return main + list + archiveBlock
    + `<li class="q-project-actions"><button data-action="refresh-members">刷新成员</button>`
    + `<button data-action="toggle-archived">${current.sessionIncludeArchived ? '隐藏归档' : '加载归档'}</button>`
    + (canNext ? '<button data-action="next-sessions">下一页</button>' : '') + `</li>`;
}

function renderWorkspaceNode(workspace: BootstrapWorkspace, current: ScopeState | undefined): string {
  const key = scopeKey(workspace.scope);
  const isCurrent = key === selectedKey;
  const expanded = view.expandedProjects.has(key);
  const caret = `<button class="q-caret" data-action="toggle-project" data-scope-key="${escapeHtml(key)}"`
    + ` aria-expanded="${String(expanded)}" aria-label="${expanded ? '折叠' : '展开'} ${escapeHtml(workspace.name)}">`
    + topIcon(expanded ? 'chevron-down' : 'chevron-right') + `</button>`;
  const name = `<button class="q-project-name" data-action="select-scope" data-scope-key="${escapeHtml(key)}"`
    + ` aria-pressed="${String(isCurrent)}" title="${escapeHtml(workspace.name)}">${escapeHtml(workspace.name)}</button>`;
  const detail = `<details class="q-project-detail"><summary>项目详情</summary>`
    + `<p class="muted"><code>${escapeHtml(key)}</code> · revision ${escapeHtml(workspace.workspaceRevision)}</p></details>`;
  const children = expanded
    ? (isCurrent && current !== undefined ? renderProjectChildren(current)
      : '<li class="q-nav-empty">切换到此项目后读取成员</li>')
    : '';
  return `<li class="q-project"${isCurrent ? ' data-current="true"' : ''}>`
    + `<div class="q-project-head">${caret}${name}</div>${detail}`
    + (children === '' ? '' : `<ul class="q-project-children">${children}</ul>`) + `</li>`;
}

/** Project heading -> workspace rows -> members. A second workspace under one
 * project is never swallowed and the first scope is never substituted; a
 * single-workspace project keeps the exact original single-node rendering. */
function renderNav(): string {
  if (bootstrapState === null) return '';
  const current = states.get(selectedKey);
  const groups = groupWorkspacesByProject(bootstrapState.workspaces);
  const projects = groups.map(group => {
    const only = group.workspaces[0];
    if (group.workspaces.length === 1 && only !== undefined) return renderWorkspaceNode(only, current);
    const workspaces = group.workspaces.map(workspace => renderWorkspaceNode(workspace, current)).join('');
    return `<li class="q-project q-project-group" data-project="${escapeHtml(group.projectId)}">`
      + `<div class="q-project-head"><span class="q-project-name q-project-group-label">${escapeHtml(only?.name ?? group.projectId)}</span></div>`
      + `<ul class="q-project-children q-workspace-list">${workspaces}</ul></li>`;
  }).join('');
  return `<div class="q-section">项目</div><ul class="q-projects">${projects}</ul>`;
}
function currentGoalObjective(scope: ScopeState): string {
  if (scope.goalObjective.length > 0) return scope.goalObjective;
  if (scope.goal !== null && typeof scope.goal.objective === 'string') return scope.goal.objective;
  const read = record(scope.goalRead);
  if (read.status === 'ready') {
    const goal = record(record(read.value).goal);
    if (typeof goal.objective === 'string') return goal.objective;
  }
  return scope.forms.objective;
}

function currentConsultationGoalId(scope: ScopeState): string | null {
  const explicit = scope.forms.goalId.trim();
  if (explicit.length > 0) return explicit;
  const goal = scope.goal;
  if (goal !== null && goal.ref.projectId === scope.config.scope.projectId) return goal.ref.goalId;
  return null;
}

/**
 * The message-detail consultation entry. It reuses the current Goal and the
 * selected read-only Query profile; a missing Goal/profile is explained instead
 * of inventing one. It shows only the real waiting/responded/ended result and
 * never writes "已停止" or "Task 完成".
 */
function renderConsultation(current: ScopeState, active: SessionRef, result: MessagesReadResponse): string {
  if (result.status !== 'ready') return '';
  const message = result.value;
  const profile = selectedExecutionProfile(current);
  const goalId = currentConsultationGoalId(current);
  const missing: string[] = [];
  if (profile === null) missing.push('当前工作区没有可用的只读调查配置');
  if (goalId === null) missing.push('没有可用的当前 Goal');
  const stored = current.consultation !== null && sameSession(current.consultation.session, active)
    && sameMessage(current.consultation.messageRef, message.ref) ? current.consultation.result : null;
  const status = stored === null ? ''
    : stored.status === 'ready'
      ? `<p data-consultation="${escapeHtml(stored.value.state)}">${stored.value.state === 'responded' ? '已回复'
        : stored.value.state === 'ended' ? '已结束（无正式答复）' : '等待处理'}`
        + (stored.value.reason === null ? '' : `：${escapeHtml(stored.value.reason)}`) + `</p>`
      : `<p data-consultation="rejected">${escapeHtml(outcomeRejectionReason(stored))}</p>`;
  const disabledReason = message.status === 'responded' ? '该消息已有回复' : missing.join('、');
  return `<section class="panel" data-view="consultation"><header><h4>处理咨询</h4>`
    + `<p class="muted">请该成员答复这条消息；成员忙碌时等待处理。</p></header>`
    + (missing.length > 0 ? `<p class="muted">缺少：${escapeHtml(missing.join('、'))}</p>` : '')
    + `<div class="buttons">${actionButton('consult-message', '处理咨询',
      missing.length === 0 && message.status !== 'responded', disabledReason)}</div>`
    + status + `</section>`;
}

/** New-Goal cold-start progress: the generated goal id and step, the frozen
 * original requests and a real retry when a request is unconfirmed. */
function renderGoalSetup(run: GoalSetupRun): string {
  const status = run.error !== null ? `<p class="error">${escapeHtml(run.error)}</p>`
    : run.notice !== null ? `<p class="notice">${escapeHtml(run.notice)}</p>` : '';
  const pending = run.pending === null ? ''
    : `<div class="buttons"><button data-action="retry">重新发送原请求</button></div>`;
  return `<section class="panel" data-view="goal-setup" data-step="${escapeHtml(run.step ?? '')}">`
    + `<header><h4>新建目标</h4><p class="muted">${escapeHtml(run.step ?? '准备中')}</p></header>`
    + status + pending
    + detailsBlock('查看已发送的完整原请求', `<pre>${escapeHtml(JSON.stringify(
      run.calls.map(call => ({ route: call.route, request: call.request })), null, 2))}</pre>`)
    + `</section>`;
}

/** The saved/handled/answered states stay separate. An action_request reply is
 * a read-only Query; it is never rendered as an accomplished write action. */
function renderMemberMail(mail: MemberMailState): string {
  const send = mail.sendState === 'saving' ? '正在保存…'
    : mail.sendState === 'failed' ? '保存结果未确认'
    : mail.sendState === 'rejected' ? '已被拒绝（可修改后重新发送）' : '已保存';
  const consult = mail.consultState === 'running' ? '处理中' : mail.consultState === 'waiting' ? '等待处理'
    : mail.consultState === 'responded' ? '已回答' : mail.consultState === 'processed' ? '已处理'
    : mail.consultState === 'ended' ? '已结束（无正式答复）'
    : mail.consultState === 'rejected' ? '未处理' : '尚未处理';
  // One visible status line + the actionable buttons; the full message / Answer /
  // references stay reachable inside one receipt fold instead of being reprinted.
  let receipt = '';
  if (mail.consultation !== null && mail.consultation.status === 'ready') {
    const value = mail.consultation.value;
    receipt = `<details class="mail-receipt" data-mail-receipt="${escapeHtml(value.state)}"><summary>查看回执</summary>`
      + `<p class="muted" data-consultation-state="${escapeHtml(value.state)}">结果：${escapeHtml(value.state)}`
      + (value.reason === null ? '' : ` · ${escapeHtml(value.reason)}`) + `</p>`
      + renderMessage({ status: 'ready', value: value.message })
      + (value.answer === null ? '<p class="muted">尚无正式回答。</p>' : renderQueryAnswer({ status: 'ready', value: value.answer }))
      + `<p class="muted">此回答不代表文件修改或工作执行已经完成。</p></details>`;
  } else if (mail.consultation !== null) {
    receipt = `<details class="mail-receipt" data-mail-receipt="rejected"><summary>查看回执</summary>`
      + `<p data-consultation-state="rejected">处理未完成：${escapeHtml(outcomeRejectionReason(mail.consultation))}</p></details>`;
  }
  return `<section class="panel" data-view="member-mail"><header><h4>成员来信</h4>`
    + `<p><span data-mail-send="${mail.sendState}">${escapeHtml(send)}</span> · <span data-mail-consult="${mail.consultState}">${escapeHtml(consult)}</span></p>`
    + (mail.note === null ? '' : `<p class="muted">${escapeHtml(mail.note)}</p>`) + `</header>`
    + `<div class="buttons">`
    + (mail.consultState === 'responded' || mail.consultState === 'processed' || mail.consultState === 'ended' ? '' : '<button data-action="process-consultation">处理消息</button>')
    + (mail.sendState === 'failed' && mail.request !== null
      ? `<button data-action="retry-member-send">重新发送原请求（同一 body）</button>` : '')
    + `</div>`
    + receipt + `</section>`;
}

/** The one narrow "missing governance" prompt for the main planning wait: the
 * owner rejected the proposal because no effective CompletionPolicy/
 * ArchitectureBaseline is active. It only links to the existing setup tab and
 * never adopts, sends or infers an architecture itself. */
function planningGovernanceHint(result: InitialPlanningGoalInputResult | null): string {
  if (result === null || result.status !== 'ready' || result.value.state !== 'waiting') return '';
  const receipt = record(result.value.receipt);
  if (receipt.status !== 'rejected') return '';
  const missing = receipt.code === 'incomplete' || receipt.code === 'unavailable';
  if (!missing) return '';
  return `<section class="policy-choice" data-view="planning-governance-hint">`
    + `<p>计划等待处理。请核对上述原因，以及项目的初始架构和完成标准；补齐后继续。</p>`
    + `<div class="buttons"><button data-action="open-setup-tab">打开设置页采用初始架构</button></div>`
    + `</section>`;
}

// Center rendering is renderCenterHead + renderCenterBody (one production renderer).
function renderComposer(): string {
  const current = state();
  const layout = syncActiveLayout(current);
  const active = current.activeSession;
  const main = current.mainSession;
  const session = active ?? main;
  const references = layout.composerDraft.references;
  const referencesHtml = references.length === 0 ? ''
    : `<ul class="q-refs">${references.map(reference => reference.kind === 'selection'
      ? `<li data-reference="selection" data-path="${escapeHtml(reference.path)}">${escapeHtml(reference.path)}:L${escapeHtml(reference.startLine)}-L${escapeHtml(reference.endLine)}${reference.source === 'draft_snapshot' ? ' · 草稿快照' : ''}</li>`
      : `<li data-reference="path" data-path="${escapeHtml(reference.path)}">${escapeHtml(reference.path)}</li>`).join('')}</ul>`;
  if (layout.readOnly) {
    return `<section class="q-compose" data-view="composer" data-readonly="true">`
      + `<p class="muted">归档会话只读：可以浏览历史与文件，但不能发送或加入可发送引用。</p></section>`;
  }
  const newGoal = active === null && main === null && current.goal === null && current.forms.goalId.trim().length === 0;
  const existingGoal = active === null && main === null && !newGoal
    && (current.goal !== null || current.forms.goalId.trim().length > 0);
  const sendAction = active !== null ? 'send-member-message' : main !== null ? 'send-main-message'
    : newGoal ? 'run-new-goal' : existingGoal ? 'start-goal-investigation' : 'run-investigation';
  const recipientLabel = active !== null ? memberLabel(current, active) : main !== null ? '主对话' : '项目';
  const hint = newGoal
    ? '写下希望完成的目标正文；发送即“新建目标”，目标创建后回执显示“已创建”。'
    : active !== null ? '普通消息只读/咨询，不会自动采用计划或执行。'
      : main !== null ? '向主会话发送消息；不会自动采用计划或执行。'
        : existingGoal
          ? (selectedExecutionProfile(current) === null
            ? '目标已创建；当前工作区没有可用的模型/调查配置，请先选择模型。'
            : '发送即按已创建目标开始调查；规划在“更多”菜单中。')
          : '向主对话发送只读调查；规划与采用在“更多”菜单中按真实状态出现。';
  return `<section class="q-compose" data-view="composer" data-mode="${active !== null ? 'member' : main !== null ? 'main' : 'project'}">`
    + `<textarea data-field="composerText" rows="1" placeholder="${newGoal ? '写下目标正文（不是内部 ID）' : '发送消息…'}" aria-label="消息">${escapeHtml(layout.composerDraft.text)}</textarea>`
    + referencesHtml
    + `<div class="q-compose-bottom"><span class="q-recipient" title="发送对象">${escapeHtml(recipientLabel)}</span>`
    + (session === null ? '' : `<span class="q-compose-mode" title="${escapeHtml(hint)}" tabindex="0" aria-label="${escapeHtml(hint)}">只读咨询</span>`)
    + `<span class="q-fill"></span>`
    + `<button class="q-send q-icon" data-action="${sendAction}" aria-label="发送" title="发送">${topIcon('arrow-up')}</button></div>`
    + (session === null ? `<div class="q-compose-hint">${escapeHtml(hint)}</div>` : '') + `</section>`;
}
function renderTabs(): string {
  const layout = syncActiveLayout(state());
  const tabs = layout.tabs.map(tab => {
    const active = tab.tabId === layout.activeTabId;
    const draft = tab.kind === 'file' && tab.editorDraft !== null;
    return `<span class="q-page${active ? ' active' : ''}">`
      + `<button data-action="activate-tab" data-tab="${escapeHtml(tab.tabId)}" aria-pressed="${String(active)}">${escapeHtml(tab.title)}${draft ? ' · 草稿' : ''}</button>`
      + `<button class="q-page-close" data-action="close-tab" data-tab="${escapeHtml(tab.tabId)}" aria-label="关闭 ${escapeHtml(tab.title)}">×</button></span>`;
  }).join('');
  return `<div class="q-pages" role="tablist">${tabs}</div>`
    + `<button class="q-icon" data-action="open-page" data-page="blank" aria-label="新建页面" title="新建页面">${topIcon('plus')}</button>`
    + `<button class="q-icon" data-action="expand-aux" aria-label="放大辅助区" aria-pressed="${String(view.auxExpanded)}" title="放大辅助区">${topIcon('maximize')}</button>`
    + `<button class="q-icon" data-action="toggle-aux" aria-label="隐藏辅助区" title="隐藏辅助区">${topIcon('panel-right-close')}</button>`;
}
/** The right-click menu for a graph node. Pinning/new-page are explicit menu
 * choices (a right click never silently pins); Esc or 关闭菜单 dismisses it. */
function renderGraphContext(tab: Extract<WorkbenchTab, { kind: 'task_graph' | 'architecture_graph' }>): string {
  const nodeId = view.contextNode;
  if (nodeId === null) return '';
  const pinned = (tab.display?.pinned ?? []).includes(nodeId);
  const selected = tab.display?.selected ?? null;
  let openNew = '';
  if (selected !== null && selected.nodeId === nodeId) {
    if (selected.kind === 'task') {
      const ref = selected.target.ref;
      openNew = `<button data-action="open-task-detail" data-project-id="${escapeHtml(ref.projectId)}" data-goal-id="${escapeHtml(ref.goalId)}" data-task-id="${escapeHtml(ref.taskId)}">在新页打开</button>`;
    } else if (selected.kind === 'module') {
      const ref = selected.target.ref;
      openNew = `<button data-action="open-module-detail" data-project-id="${escapeHtml(ref.projectId)}" data-module-id="${escapeHtml(ref.moduleId)}">在新页打开</button>`;
    }
  }
  return `<div class="q-context" data-view="graph-context">`
    + `<button data-action="context-detail" data-node="${escapeHtml(nodeId)}">查看详情</button>`
    + `<button data-action="context-pin" data-node="${escapeHtml(nodeId)}">${pinned ? '取消固定显示' : '固定完整显示'}</button>`
    + openNew + `<button data-action="close-context">关闭菜单</button></div>`;
}

function renderTabBody(): string {
  const layout = syncActiveLayout(state());
  const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
  if (tab === undefined) return renderPageChooser();
  const context = (tab.kind === 'task_graph' || tab.kind === 'architecture_graph') ? renderGraphContext(tab) : '';
  switch (tab.kind) {
    case 'setup': return renderSetupTab();
    case 'project_chat': return '<p class="muted">项目主对话显示在中间栏。</p>';
    case 'session_chat': return renderSessionTab(tab);
    case 'history': return renderHistoryTab(tab);
    case 'execution_history': return renderExecutionHistoryTab(tab);
    case 'file': return renderFileTab(layout, tab);
    case 'directory': return renderDirectoryTab(layout, tab);
    case 'task_graph': return context + renderTaskTab(tab);
    case 'architecture_graph': return context + renderArchitectureTab(tab);
    case 'task_detail': return renderTaskDetailTab(tab);
    case 'module_detail': return renderModuleDetailTab(tab);
    case 'terminal': return renderTerminalTab(tab);
    case 'diff': return renderDiffTab(tab);
    case 'compare': return renderCompareForm();
    case 'blank': return renderPageChooser();
    default: return renderPageChooser();
  }
}
function renderTerminalTab(tab: Extract<WorkbenchTab, { kind: 'terminal' }>): string {
  const current = state();
  const command = current.commands.get(tab.commandId) ?? null;
  if (tab.commandId === 'new') {
    return `<section class="panel" data-view="terminal-tab" data-command-id="new"><header><h3>命令</h3>`
      + `<p class="muted">每个命令是独立句柄与独立页签；隐藏/切换页签不会取消。无交互 stdin / 非 PTY。</p></header>`
      + renderCommandForm() + `</section>`;
  }
  const settled = command !== null && command.state === 'settled';
  return `<section class="panel" data-view="terminal-tab" data-command-id="${escapeHtml(tab.commandId)}">`
    + renderWorkbenchCommand(command?.result ?? null, { command: tab.command, cwd: tab.cwd, state: command?.state ?? 'starting' })
    + `<div class="buttons"><button data-action="stop-command" data-command="${escapeHtml(tab.commandId)}"${settled ? ' disabled' : ''}>停止并等待实际结果</button></div>`
    + (command?.stopping ? '<p class="muted">已请求停止，等待 Kernel 实际结果…</p>' : '')
    + `<p class="muted">命令执行页没有交互 stdin；隐藏或切换页签不会取消命令。</p></section>`;
}

function renderDiffTab(tab: Extract<WorkbenchTab, { kind: 'diff' }>): string {
  const current = state();
  const stored = current.compareResults.get(tab.tabId) ?? null;
  const ready = stored !== null && stored.status === 'ready' ? stored.value : null;
  const modified = ready === null ? [] : ready.changes.filter(change => change.kind === 'modified').map(change => change.path);
  const prefix = `${current.key}|${tab.tabId}|`;
  const diffs = [...diffTextCache.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => value);
  return `<section class="panel" data-view="diff-tab" data-tab="${escapeHtml(tab.tabId)}">`
    + `<header><h3>工作区 Diff</h3><p class="muted">before <code>${escapeHtml(JSON.stringify(tab.before))}</code>`
    + ` → after <code>${escapeHtml(JSON.stringify(tab.after))}</code>${tab.prefix === null ? '' : ` · prefix ${escapeHtml(tab.prefix)}`}</p></header>`
    + (modified.length === 0 ? '' : `<div class="buttons">${modified.map(path =>
        `<button data-action="load-text-diff" data-tab="${escapeHtml(tab.tabId)}" data-path="${escapeHtml(path)}">显示 ${escapeHtml(path)} 行级差异</button>`).join('')}</div>`)
    + renderWorkspaceComparison(stored)
    + diffs.map(diff => `<div data-view="diff-text">${renderTextDiff(diff.before, diff.after, diff.path)}</div>`).join('')
    + `</section>`;
}

/** One flat group per capability area. Every existing control is preserved and
 * stays default-collapsed, so the auxiliary page is a compact list of groups
 * instead of a wall of open cards. */
const setupGroup = (title: string, body: string): string =>
  `<details class="setup-group"><summary>${escapeHtml(title)}</summary><div class="setup-group-body">${body}</div></details>`;

function renderSetupTab(): string {
  return `<div class="setup-pages">`
    + setupGroup('项目 / 工作区', renderInit())
    + setupGroup('目标', renderGoal())
    + setupGroup('初始架构与计划', renderPlan())
    + setupGroup('重新查看', renderReads())
    + setupGroup('采用架构 / 观察结构 / 任务图', renderGraphs())
    + setupGroup('文件', renderFiles())
    + setupGroup('执行配置 / 只读调查', renderExecution())
    + setupGroup('工作区比较', renderCompareForm())
    + setupGroup('终端命令', renderCommandForm())
    + `</div>`;
}

function renderSessionTab(tab: Extract<WorkbenchTab, { kind: 'session_chat' }>): string {
  const current = state();
  const read = current.sessionRead !== null && sameSession(current.sessionRead.session, tab.session) ? current.sessionRead : null;
  const key = tabSessionHistoryKey(tab.tabId, tab.session);
  const stored = current.sessionHistories.get(key) ?? null;
  const history = stored !== null && sameSession(stored.session, tab.session) ? stored : null;
  const canNext = history !== null && history.result.status === 'ready' && history.result.value.nextCursor !== null;
  return `<section class="panel" data-view="session-tab" data-session="${escapeHtml(tab.session.sessionId)}">`
    + `<header><h3>会话 <code>${escapeHtml(tab.session.sessionId)}</code></h3></header>`
    + `<div class="buttons"><button data-action="select-session" data-session="${escapeHtml(tab.session.sessionId)}">在中间查看</button>`
    + `<button data-action="read-session-tab">读取详情与历史</button>`
    + actionButton('next-session-tab', '下一页原历史', canNext, '没有更多原历史') + `</div>`
    + (read === null ? renderGap('sessions/read', '尚未读取该会话详情') : renderSessionDetail(read.result))
    + (history === null ? renderGap('sessions/history', '尚未读取完整会话原历史')
      : `<h4>完整会话原历史</h4>` + renderSessionHistoryTimeline(history.result))
    + `</section>`;
}

function renderHistoryTab(tab: Extract<WorkbenchTab, { kind: 'history' }>): string {
  const current = state();
  const key = tabSessionHistoryKey(tab.tabId, tab.session);
  const stored = current.sessionHistories.get(key) ?? null;
  const history = stored !== null && sameSession(stored.session, tab.session) ? stored : null;
  const canNext = history !== null && history.result.status === 'ready' && history.result.value.nextCursor !== null;
  return `<section class="panel" data-view="history-tab" data-session="${escapeHtml(tab.session.sessionId)}">`
    + `<header><h3>完整会话原历史 <code>${escapeHtml(tab.session.sessionId)}</code></h3></header>`
    + `<div class="buttons"><button data-action="read-history-tab">读取原历史</button>`
    + actionButton('next-history-tab', '下一页原历史', canNext, '没有更多原历史')
    + `<button data-action="select-session" data-session="${escapeHtml(tab.session.sessionId)}">在中间查看</button></div>`
    + (history === null ? renderGap('sessions/history', '尚未读取完整会话原历史')
      : renderSessionHistoryTimeline(history.result))
    + `</section>`;
}

/** R6 Task-execution -> original history tab. The typed `run` is the tab
 * identity; the execution record and the run-window page are read back only when
 * they match the exact scope + RunRef. A non-ready read is shown as its own real
 * result; the claim Session is opened only from a ready execution record. */
function renderExecutionHistoryTab(tab: Extract<WorkbenchTab, { kind: 'execution_history' }>): string {
  const current = state();
  const key = executionPageKey(tab.tabId);
  const readEntry = current.executionReads.get(key) ?? null;
  const record = readEntry !== null && sameRun(readEntry.run, tab.run) ? readEntry.result : null;
  const stored = current.executionHistories.get(key) ?? null;
  const history = stored !== null && executionHistoryMatches(stored, current.config.scope, tab.run)
    ? stored.result : null;
  const claim = record !== null && record.status === 'ready' ? record.value.outbox.claim.sessionRef : null;
  const canNext = history !== null && history.status === 'ready' && history.value.nextCursor !== null;
  const taskLine = tab.task === null ? '' : ` · Task <code>${escapeHtml(tab.task.taskId)}</code>`;
  return `<section class="panel" data-view="execution-history-tab"`
    + ` data-aggregate-type="${escapeHtml(tab.run.aggregateType)}"`
    + ` data-project-id="${escapeHtml(tab.run.projectId)}" data-goal-id="${escapeHtml(tab.run.goalId)}"`
    + ` data-run-id="${escapeHtml(tab.run.runId)}">`
    + `<header><h3>本次执行原历史</h3>`
    + `<p class="muted">Run <code>${escapeHtml(tab.run.runId)}</code>`
    + ` · 项目 <code>${escapeHtml(tab.run.projectId)}</code>`
    + ` · 目标 <code>${escapeHtml(tab.run.goalId)}</code>${taskLine}</p></header>`
    + `<div class="buttons">`
    + `<button data-action="read-execution-record">刷新执行事实</button>`
    + `<button data-action="control-pause">暂停</button><button data-action="control-resume">继续</button><button data-action="control-cancel">取消</button><button data-action="control-steer">调整方向</button>`
    + `<button data-action="read-execution-history">读取本次执行原历史</button>`
    + actionButton('next-execution-history', '下一页执行历史', canNext, '没有更多执行历史')
    + (claim === null ? ''
      : `<button data-action="open-claim-session" data-session="${escapeHtml(claim.sessionId)}">查看原会话 / 完整会话原历史</button>`)
    + `</div>`
    + renderExecutionRecord(record)
    + renderExecutionHistory(history)
    + `</section>`;
}

function renderFileTab(layout: WorkbenchLayout, tab: Extract<WorkbenchTab, { kind: 'file' }>): string {
  const current = state();
  const file = tab.file;
  const draft = tab.editorDraft;
  const text = draft === null ? file.content : draft.text;
  const changed = draft !== null && draft.text !== file.content;
  // A capture/git read version is immutable: it is shown read-only and is never
  // presented as an edited buffer. References may still cite that exact version.
  const workingTree = file.version.kind === 'working_tree';
  // Editing requires BOTH a working-tree read and the Host's explicit write
  // authorization; read prefixes never imply write permission.
  const writeAllowed = current.config.writeAllowed === true;
  const editable = !layout.readOnly && workingTree && writeAllowed;
  const canReference = !layout.readOnly;
  const draftState = !workingTree ? 'readonly_version' : changed ? 'draft_snapshot' : 'saved';
  const draftLabel = !workingTree
    ? '历史/已捕获版本：只读，不作为已编辑内容；加入引用使用该版本事实。'
    : changed ? '草稿快照（未保存，仅本页内存）' : '与已读取版本一致';
  const directory = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
  return `<section class="panel file-page" data-view="file-page" data-path="${escapeHtml(file.path)}">`
    + `<header><h3>${escapeHtml(file.path)}</h3>`
    + `<p class="muted">${escapeHtml(file.sizeBytes)} 字节 · 版本 <code>${escapeHtml(JSON.stringify(file.version))}</code> · digest ${escapeHtml(file.digest.slice(0, 12))}</p>`
    + `<p data-draft-state="${draftState}">${escapeHtml(draftLabel)}</p></header>`
    + `<textarea class="file-editor" data-field="fileEditor" data-tab="${escapeHtml(tab.tabId)}" data-path="${escapeHtml(file.path)}" rows="14"${editable ? '' : ' readonly'}>${escapeHtml(text)}</textarea>`
    + `<div class="buttons">`
      + `<button data-action="add-path-reference" data-path="${escapeHtml(file.path)}" data-tab="${escapeHtml(tab.tabId)}"${canReference ? '' : ' disabled'}>加入整文件引用</button>`
      + `<button data-action="add-selection-reference" data-path="${escapeHtml(file.path)}" data-tab="${escapeHtml(tab.tabId)}"${canReference ? '' : ' disabled'}>加入选区引用</button>`
      + (directory.length === 0 ? '' : `<button data-action="open-directory" data-path="${escapeHtml(directory)}">打开所在目录</button>`)
    + `</div>`
    + `<div class="buttons">`
      + `<button data-action="save-file" data-tab="${escapeHtml(tab.tabId)}"${editable && changed ? '' : ' disabled'}>保存</button>`
      + `<button data-action="read-path" data-path="${escapeHtml(file.path)}">重新读取工作区版本</button>`
    + `</div>`
    + (writeAllowed || !workingTree ? '' : '<p class="muted">本工作区未授权文件写入（Host 未配置 writePrefixes）；该页只读。</p>')
    + renderFileSave(current.saveResults.get(tab.tabId) ?? null, changed)
    + `</section>`;
}

function renderDirectoryTab(layout: WorkbenchLayout, tab: Extract<WorkbenchTab, { kind: 'directory' }>): string {
  const current = state();
  const prefix = tab.path;
  const inventory = current.directories.get(prefix) ?? null;
  const visible = inventory === null ? [] : inventory.paths.slice(0, inventory.visibleCount);
  type PathBranch = { directories: Map<string, PathBranch>; files: Map<string, string> };
  const tree: PathBranch = { directories: new Map(), files: new Map() };
  const relativePrefix = prefix.length === 0 ? '' : `${prefix.replace(/\/$/, '')}/`;
  for (const rawPath of visible) {
    if (rawPath.length === 0) continue;
    const relative = relativePrefix !== '' && rawPath.startsWith(relativePrefix)
      ? rawPath.slice(relativePrefix.length) : rawPath;
    const segments = relative.split('/');
    const name = segments.pop();
    if (!name) continue;
    let branch = tree;
    for (const segment of segments) {
      let child = branch.directories.get(segment);
      if (child === undefined) {
        child = { directories: new Map(), files: new Map() };
        branch.directories.set(segment, child);
      }
      branch = child;
    }
    branch.files.set(name, rawPath);
  }
  const renderBranch = (branch: PathBranch, directory: string): string => {
    const directories = [...branch.directories.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([name, child]) => {
        const path = directory.length === 0 ? name : `${directory}/${name}`;
        return `<li><details open data-directory-path="${escapeHtml(path)}"><summary>${escapeHtml(name)}/</summary>`
          + `<ul class="paths">${renderBranch(child, path)}</ul></details>`
          + `<button class="link" data-action="open-directory" data-path="${escapeHtml(path)}" title="仅列出该目录，缩小范围">打开此目录</button></li>`;
      }).join('');
    const files = [...branch.files.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([name, path]) => `<li data-path="${escapeHtml(path)}">`
        + `<button class="link" data-action="open-file" data-path="${escapeHtml(path)}" title="${escapeHtml(path)}">${escapeHtml(name)}</button>`
        + `<button class="link" data-action="add-path-reference" data-path="${escapeHtml(path)}"${layout.readOnly ? ' disabled' : ''}>加入引用</button></li>`).join('');
    return directories + files;
  };
  const rows = renderBranch(tree, prefix.replace(/\/$/, ''));
  const loadedCount = inventory === null ? 0 : inventory.paths.length;
  const shownCount = inventory === null ? 0 : Math.min(inventory.visibleCount, loadedCount);
  // A `partial` reply is NEVER a complete listing: say so whenever it is true,
  // including when it carried ZERO paths, so an incomplete empty page is never
  // shown as an empty directory.
  const partialNote = inventory !== null && inventory.partial
    ? '<p class="muted">未完整列出，可缩小目录范围。</p>' : '';
  let body: string;
  if (inventory === null) {
    body = '<p class="muted">尚未列出路径。</p>';
  } else if (inventory.loading && loadedCount === 0) {
    body = '<p class="muted">正在列出…</p>';
  } else if (loadedCount === 0 && inventory.error !== null) {
    body = `<p class="muted">列出失败：${escapeHtml(inventory.error)}</p>`;
  } else if (loadedCount === 0) {
    // A partial 0-path reply is an INCOMPLETE listing; only a complete reply may
    // be shown as an empty directory.
    body = inventory.partial
      ? partialNote + '<p class="muted">当前未列出路径。</p>'
      : '<p class="muted">该目录没有可列出的文件。</p>';
  } else {
    const stale = inventory.error !== null && inventory.stale;
    body = (inventory.loading ? '<p class="muted">正在刷新…</p>' : '')
      + (stale
        ? `<p class="muted">刷新失败，以下为<strong>旧列表</strong>（归属 ${escapeHtml(inventory.prefix.length === 0 ? '/' : inventory.prefix)}）：${escapeHtml(inventory.error ?? '')}</p>`
        : '')
      + partialNote
      + `<p class="muted">已显示 ${shownCount}/${loadedCount} 个路径。</p>`
      + `<ul class="paths">${rows}</ul>`;
  }
  return `<section class="panel directory-page" data-view="directory-page" data-path="${escapeHtml(prefix)}"`
    + (inventory !== null && inventory.error !== null && inventory.stale ? ` data-stale-prefix="${escapeHtml(inventory.prefix)}"` : '')
    + `><header><h3>目录 ${escapeHtml(prefix.length === 0 ? '/' : prefix)}</h3>`
    + `<p class="muted">浏览工作区文件；可输入目录路径缩小范围。</p></header>`
    + `<div class="buttons">`
      + `<label class="inline">目录 <input data-field="directoryPrefix" data-tab="${escapeHtml(tab.tabId)}" value="${escapeHtml(prefix)}" placeholder="src（留空为根）"></label>`
      + `<button data-action="open-directory-input" data-tab="${escapeHtml(tab.tabId)}">打开</button>`
      + actionButton('refresh-directory', '刷新', inventory === null || !inventory.loading, inventory?.loading ? '正在列出' : '')
      + actionButton('directory-more', '显示更多', inventory !== null && inventory.visibleCount < inventory.paths.length, '已全部显示')
    + `</div>`
    + body
    + `</section>`;
}
function renderTaskTab(tab: Extract<WorkbenchTab, { kind: 'task_graph' }>): string {
  const current = state();
  const matches = current.taskGraphGoalId === tab.goal.goalId && current.taskGraph !== null;
  const mode = view.graphModes.get(`${current.key}|${tab.tabId}`) ?? 'structure';
  const edgeMode = view.graphEdges.get(`${current.key}|${tab.tabId}`) === 'dependency' ? 'dependency' : 'hierarchy';
  const list = current.executionList?.goalRef.projectId === tab.goal.projectId
    && current.executionList.goalRef.goalId === tab.goal.goalId ? current.executionList : null;
  const page: { items: TaskExecutionRecord[]; nextCursor: string | null; readThrough?: unknown } =
    list === null ? { items: [], nextCursor: null } : { items: list.items, nextCursor: list.nextCursor, readThrough: list.readThrough };
  const body = !matches
    ? renderGap('tasks/query', '该目标的任务图尚未读取。')
    : mode === 'timeline'
      ? renderTaskExecutionTimeline(page, current.timeline, readyTaskGraphValue(current)?.tasks)
        + (list === null ? '' : renderTaskExecutionFold(page))
      : renderTaskStructure(current.taskGraph as never, page, current.timeline, tab.display, edgeMode);
  const hasNext = list !== null && list.nextCursor !== null;
  return `<section class="panel" data-view="task-graph" data-goal="${escapeHtml(tab.goal.goalId)}">`
    + `<div class="q-graphbar" data-view="graph-mode">`
    + `<button data-action="set-graph-mode" data-mode="structure" aria-pressed="${String(mode === 'structure')}">结构</button>`
    + `<button data-action="set-graph-mode" data-mode="timeline" aria-pressed="${String(mode === 'timeline')}">轨迹</button>`
    + `<span class="q-fill"></span><button data-action="load-executions" title="刷新执行记录">↻</button>`
    + (hasNext ? '<button data-action="load-next-executions">更多执行</button>' : '') + `</div>`
    + (list === null ? '<p class="muted">尚未读取执行记录；点击“读取执行”。</p>' : '')
    + body + `</section>`;
}
function renderArchitectureTab(tab: Extract<WorkbenchTab, { kind: 'architecture_graph' }>): string {
  const current = state();
  const key = architectureSelectionKey(tab.selection);
  const mode = view.graphModes.get(`${current.key}|${tab.tabId}`) ?? 'containment';
  let adopted: unknown = null;
  if (current.architectureReadSelection === key && current.architectureRead !== null) adopted = current.architectureRead;
  else if (tab.selection.kind === 'current' && current.adopted !== null) adopted = { status: 'ready', value: current.adopted };
  current.containment.activeModuleIds = computeActiveModuleIds(current);
  current.containment.pinned = tab.display?.pinned ?? [];
  current.containment.selected = tab.display?.selected?.kind === 'module'
    ? tab.display.selected.target.ref.moduleId : null;
  return `<section class="panel" data-view="architecture-graph" data-selection="${escapeHtml(key)}">`
    + `<div class="q-graphbar" data-view="graph-mode">`
    + `<button data-action="set-graph-mode" data-mode="containment" aria-pressed="${String(mode === 'containment')}">包含</button>`
    + `<button data-action="set-graph-mode" data-mode="dependency" aria-pressed="${String(mode === 'dependency')}">依赖</button>`
    + `<span class="q-fill"></span>`
    + `<button data-action="read-architecture-tab" title="刷新架构">↻</button></div>`
    + (adopted === null
      ? renderGap('architecture/read', '该选择尚未读取；点击“读取”。')
      : (mode === 'containment'
        ? renderArchitectureContainment(adopted as never, current.containment)
        : renderArchitectureDependencies(adopted as never, tab.display)))
    + detailsBlock('源码观察', actionButton('capture-observed', '捕获观察', current.project !== null && current.workspace !== null && current.adopted !== null, '需要先采用初始架构') + actionButton('query-observed', '读取观察', current.observedCapture !== null, '先捕获观察'))
    + (current.observed === null ? '' : detailsBlock('源码观察结构', renderObservedGraph(current.observed as never, tab.display)))
    + `</section>`;
}
function renderCommandForm(): string {
  const current = state();
  const allowed = current.config.commandsAllowed === true;
  return `<section class="panel" data-view="command-form"><h3>终端命令</h3>`
    + (allowed ? '' : '<p class="muted">本工作区未授权命令执行（Host 未配置 allowCommands）。</p>')
    + `<label class="inline">命令 <input data-field="commandLine" value="${escapeHtml(current.forms.commandLine)}" placeholder="例如：node --version"></label>`
    + `<label class="inline">cwd <input data-field="commandCwd" value="${escapeHtml(current.forms.commandCwd)}" placeholder="."></label>`
    + `<div class="buttons"><button data-action="start-command"${allowed ? '' : ' disabled'}>运行命令（无交互 stdin / 非 PTY）</button></div>`
    + `<p class="muted">每个命令是独立句柄与独立页签；隐藏/切页不取消，停止会等待实际结果。</p></section>`;
}

function renderCompareForm(): string {
  const current = state();
  const form = current.compareForm;
  const options = (value: string): string => ['working_tree', 'git', 'capture'].map(kind =>
    `<option value="${kind}"${value === kind ? ' selected' : ''}>${kind === 'working_tree' ? '当前工作区' : kind === 'git' ? 'Git commit' : '已捕获来源'}</option>`).join('');
  const commitField = (side: 'Before' | 'After', kind: string, commit: string): string =>
    kind === 'git' ? `<input data-field="compare${side}Commit" value="${escapeHtml(commit)}" placeholder="完整 commit OID">` : '';
  return `<section class="panel" data-view="compare-form"><h3>工作区比较</h3>`
    + `<p class="muted">Git 可与另一 Git 版本或当前工作区比较；当前工作区与已捕获来源比较时先取得快照。Git 与已捕获来源不能混合比较。</p>`
    + `<label class="inline">前版本 <select data-field="compareBeforeKind">${options(form.beforeKind)}</select>${commitField('Before', form.beforeKind, form.beforeCommit)}</label>`
    + `<label class="inline">后版本 <select data-field="compareAfterKind">${options(form.afterKind)}</select>${commitField('After', form.afterKind, form.afterCommit)}</label>`
    + `<label class="inline">前缀 <input data-field="comparePrefix" value="${escapeHtml(form.prefix)}" placeholder="src"></label>`
    + `<div class="buttons"><button data-action="compare-files">比较并打开 Diff 页</button></div></section>`;
}

function renderRelatedSessionsBlock(target: WorkLinkTarget): string {
  const current = state();
  const related = current.relatedSessions;
  if (related === null || !sameWorkLinkTarget(related.target, target)
    || related.includeArchived !== current.sessionIncludeArchived) {
    return '<p class="muted">点击“查看关联会话”沿当前真实目标查询（是否含归档由左侧“包含归档会话”决定）；目标或筛选已变时不显示上一对象的关联列表。</p>';
  }
  const canNext = related.result.status === 'ready' && related.result.value.nextCursor !== null;
  return `<section class="panel" data-view="related-sessions"><h4>关联会话</h4>${renderSessionSummary(related.result)}`
    + `<div class="buttons">${actionButton('next-related-sessions', '下一页关联会话', canNext, '没有更多关联会话')}</div></section>`;
}

/** Shared Task facts renderer: used both by the explicit task_detail page and
 * by the in-place graph selection panel, so both show the same real fields. */
function taskFactsHtml(ref: Extract<WorkLinkTarget, { kind: 'task' }>['ref']): string {
  const current = state();
  const graph = readyTaskGraphValue(current);
  const row = graph !== null && current.taskGraphGoalId === ref.goalId
    ? graph.tasks.find(candidate => candidate.ref.taskId === ref.taskId) ?? null
    : null;
  if (row === null) return renderGap('tasks/query', '该任务的任务图事实尚未读取；可先在任务辅助页查询此目标的任务图。');
  return `<section class="panel" data-view="task-facts"><h4>任务事实</h4>`
    + `<p><strong>${escapeHtml(String(record(row.definition).title ?? ref.taskId))}</strong></p>`
    + `<p class="muted">阶段 ${escapeHtml(row.effectivePhase)} · 处置 ${escapeHtml(row.disposition)}`
    + ` · 要求 ${escapeHtml(row.definition.requirementLevel)} · 类型 ${escapeHtml(row.definition.taskKind)}`
    + ` · 执行意图 ${escapeHtml(row.definition.executionIntent ?? '未标注')}</p>`
    + (row.relations.length === 0 ? '<p class="muted">没有协作关系</p>'
      : `<ul>${row.relations.map(relation => `<li>${escapeHtml(relation.kind)}: `
        + `${escapeHtml(relation.fromTaskId)} → ${escapeHtml(relation.toTaskId)} `
        + `<span class="muted">${escapeHtml(relation.note)}</span></li>`).join('')}</ul>`)
    + detailsBlock('查看任务原始字段', `<pre>${escapeHtml(JSON.stringify(row, null, 2))}</pre>`)
    + renderTaskExecutionEntry(row)
    + `</section>`;
}

/** Shared Module facts renderer for the module_detail page and the in-place panel. */
function moduleFactsHtml(ref: Extract<WorkLinkTarget, { kind: 'module' }>['ref']): string {
  const module = moduleDefinition(state(), ref.moduleId);
  if (module === null) return renderGap('architecture/read', '该模块尚未从采用架构读取；可先在架构图辅助页读取当前或精确版本。');
  return `<section class="panel" data-view="module-facts"><h4>模块事实</h4>`
    + `<p><strong>${escapeHtml(String(module.name ?? ref.moduleId))}</strong></p>`
    + `<p class="muted">${escapeHtml(String(module.responsibility ?? ''))}</p>`
    + `<p class="muted">paths: ${list(module.paths).map(String).map(path =>
        `<button class="link" data-action="open-file" data-path="${escapeHtml(path)}">${escapeHtml(path)}</button>`
        + `<button class="link" data-action="compare-path" data-path="${escapeHtml(path)}">比较</button>`).join(' · ')}</p>`
    + detailsBlock('查看模块原始字段', `<pre>${escapeHtml(JSON.stringify(module, null, 2))}</pre>`)
    + `</section>`;
}

function renderTaskDetailTab(tab: Extract<WorkbenchTab, { kind: 'task_detail' }>): string {
  const ref = tab.target.ref;
  return `<section class="panel" data-view="task-detail" data-goal="${escapeHtml(ref.goalId)}" data-task="${escapeHtml(ref.taskId)}">`
    + `<header><h3>任务 <code>${escapeHtml(ref.taskId)}</code></h3>`
    + `<p class="muted">目标 <code>${escapeHtml(ref.goalId)}</code> · 项目 <code>${escapeHtml(ref.projectId)}</code></p></header>`
    + taskFactsHtml(ref) + renderWorkLinkTarget(tab.target) + renderRelatedSessionsBlock(tab.target) + `</section>`;
}

function renderModuleDetailTab(tab: Extract<WorkbenchTab, { kind: 'module_detail' }>): string {
  const ref = tab.target.ref;
  return `<section class="panel" data-view="module-detail" data-module="${escapeHtml(ref.moduleId)}">`
    + `<header><h3>模块 <code>${escapeHtml(ref.moduleId)}</code></h3>`
    + `<p class="muted">项目 <code>${escapeHtml(ref.projectId)}</code></p></header>`
    + moduleFactsHtml(ref) + renderWorkLinkTarget(tab.target) + renderRelatedSessionsBlock(tab.target) + `</section>`;
}

/** Compact, default-closed node relations. The related-Session port is called
 * only from the group; archived Sessions follow the current directory filter. */
function targetDataAttrs(target: WorkLinkTarget): string {
  if (target.kind === 'task') return `data-target-kind="task" data-project-id="${escapeHtml(target.ref.projectId)}" data-goal-id="${escapeHtml(target.ref.goalId)}" data-task-id="${escapeHtml(target.ref.taskId)}"`;
  if (target.kind === 'module') return `data-target-kind="module" data-project-id="${escapeHtml(target.ref.projectId)}" data-module-id="${escapeHtml(target.ref.moduleId)}"`;
  return `data-target-kind="work" data-project-id="${escapeHtml(target.ref.projectId)}" data-workspace-id="${escapeHtml(target.ref.workspaceId)}" data-work-id="${escapeHtml(target.ref.workId)}"`;
}
function nodeRelationsGroup(target: WorkLinkTarget): string {
  const current = state();
  const related = current.relatedSessions;
  const matches = related !== null && sameWorkLinkTarget(related.target, target);
  const canNext = matches && related.result.status === 'ready' && related.result.value.nextCursor !== null;
  return `<details class="q-rel" data-view="node-relations"><summary>关联 Agent（当前 / 历史，含归档）</summary>`
    + `<button class="q-link" data-action="find-sessions" ${targetDataAttrs(target)}>查询关联会话</button>`
    + (matches ? renderSessionSummary(related.result) : '<p class="muted">按需查询；是否含归档由左栏过滤决定。</p>')
    + (canNext ? `<button class="q-link" data-action="next-related-sessions">下一页</button>` : '')
    + `</details>`;
}
function nodeFilesGroup(paths: string[]): string {
  if (paths.length === 0) return '';
  return `<details class="q-rel" data-view="node-files"><summary>文件（${paths.length}）</summary>`
    + paths.map(path => `<button class="q-link" data-action="open-file" data-path="${escapeHtml(path)}">${escapeHtml(path)}</button>`).join('')
    + `</details>`;
}
function nodeDiffGroup(prefix: string | null): string {
  return `<details class="q-rel" data-view="node-diff"><summary>Diff 索引</summary>`
    + `<p class="muted">没有完整版本对时不发请求；在此选择真实前后版本。</p>`
    + `<button class="q-link" data-action="compare-path" data-path="${escapeHtml(prefix ?? '')}">在 Diff 页选择版本</button></details>`;
}
function taskRowFor(ref: Extract<WorkLinkTarget, { kind: 'task' }>['ref']): TaskRow | null {
  const current = state();
  const graph = readyTaskGraphValue(current);
  return graph !== null && current.taskGraphGoalId === ref.goalId
    ? graph.tasks.find(candidate => candidate.ref.taskId === ref.taskId) ?? null
    : null;
}

/** In-place graph node detail. Default is only the readable name + one-line
 * role/responsibility + open-in-new-page; agent/file/diff relations are folded
 * and queried on demand; the complete original fields stay behind one more fold. */
function renderGraphSelectionPanel(display: WorkbenchGraphDisplay | undefined): string {
  const selected = display?.selected ?? null;
  if (selected === null) return '';
  const isPinned = (display?.pinned ?? []).includes(selected.nodeId);
  const pinButton = `<button data-action="toggle-pin-selected">${isPinned ? '取消固定显示' : '固定完整显示'}</button>`;
  if (selected.kind === 'observed') {
    return `<div class="q-detail-head"><strong>${escapeHtml(selected.label)}</strong><span class="q-fill"></span>${pinButton}</div>`
      + `<p class="muted">${escapeHtml(selected.detail)}</p>`
      + `<p class="muted">观察节点没有正式 Task/Module 引用。</p>`;
  }
  if (selected.kind === 'task') {
    const ref = selected.target.ref;
    const row = taskRowFor(ref);
    const name = row === null ? ref.taskId : String(record(row.definition).title ?? ref.taskId);
    const detail = row === null ? '任务图事实尚未读取。'
      : `阶段 ${row.effectivePhase} · 处置 ${row.disposition} · 意图 ${row.definition.executionIntent ?? '未标注'}`;
    const raw = row === null ? '' : `<details class="q-rel"><summary>原始字段</summary><pre>${escapeHtml(JSON.stringify(row, null, 2))}</pre></details>`;
    return `<div class="q-detail-head"><strong>${escapeHtml(name)}</strong><span class="q-fill"></span>${pinButton}</div>`
      + `<p class="muted">${escapeHtml(detail)}</p>`
      + `<div class="buttons"><button data-action="open-task-detail" data-project-id="${escapeHtml(ref.projectId)}"`
      + ` data-goal-id="${escapeHtml(ref.goalId)}" data-task-id="${escapeHtml(ref.taskId)}">在新页打开</button></div>`
      + (row === null ? '' : `<details class="q-rel"><summary>执行与原历史</summary>${renderTaskExecutionEntry(row)}</details>`)
      + nodeRelationsGroup(selected.target) + nodeDiffGroup(null) + raw;
  }
  const ref = selected.target.ref;
  const module = moduleDefinition(state(), ref.moduleId);
  const name = module === null ? ref.moduleId : String(module.name ?? ref.moduleId);
  const responsibility = module === null ? '模块事实尚未读取。' : String(module.responsibility ?? '');
  const paths = module === null ? [] : list(module.paths).map(String);
  const raw = module === null ? '' : `<details class="q-rel"><summary>原始字段</summary><pre>${escapeHtml(JSON.stringify(module, null, 2))}</pre></details>`;
  return `<div class="q-detail-head"><strong>${escapeHtml(name)}</strong><span class="q-fill"></span>${pinButton}</div>`
    + `<p class="muted">${escapeHtml(responsibility)}</p>`
    + `<div class="buttons"><button data-action="open-module-detail" data-project-id="${escapeHtml(ref.projectId)}"`
    + ` data-module-id="${escapeHtml(ref.moduleId)}">在新页打开</button></div>`
    + nodeRelationsGroup(selected.target) + nodeFilesGroup(paths) + nodeDiffGroup(paths[0] ?? null) + raw;
}

function renderReads(): string {
  const current = state();
  const architectureSelection = current.forms.archSelection === 'revision'
    ? `<label class="inline">架构 ID <input data-field="baselineId" value="${escapeHtml(current.forms.baselineId)}"></label>`
      + `<label class="inline">版本 <input data-field="baselineRevision" value="${escapeHtml(current.forms.baselineRevision)}"></label>`
    : '';
  return `<section class="panel" data-view="reads"><h2>重新查看</h2>`
    + `<label class="inline">目标 ID <input data-field="goalId" value="${escapeHtml(current.forms.goalId)}" placeholder="${escapeHtml(current.goal?.ref.goalId ?? reviewGoals()[0]?.goalId ?? '')}"></label>`
    + `<div class="buttons">`
      + actionButton('read-goal', '查看目标', true, '')
      + actionButton('query-tasks', '查看任务图', true, '')
    + `</div>`
    + `<label class="inline">计划草案 ID <input data-field="proposalId" value="${escapeHtml(current.forms.proposalId)}" placeholder="${escapeHtml(current.proposal?.ref.proposalId ?? '')}"></label>`
    + `<div class="buttons">${actionButton('read-proposal', '查看计划草案', true, '')}</div>`
    + `<label class="inline">架构范围 <select data-field="archSelection"><option value="current"${current.forms.archSelection === 'current' ? ' selected' : ''}>当前采用</option><option value="revision"${current.forms.archSelection === 'revision' ? ' selected' : ''}>指定版本</option></select></label>`
    + architectureSelection
    + `<div class="buttons">${actionButton('read-architecture', '查看采用架构', true, '')}`
      + `<button data-action="open-architecture-graph">在辅助页打开架构图</button></div>`
    + (current.goalRead === null ? '' : `<div>${renderGoalDetail(current.goalRead)}</div>`)
    + (current.proposalRead === null ? '' : `<div>${renderPlanProposal(current.proposalRead)}</div>`)
    + `</section>`;
}

function lastSummary(last: { route: CoreRouteSuffix; payload: unknown }): string {
  const envelope = record(last.payload);
  const label = routeLabel(last.route);
  if (envelope.status === 'committed') {
    return envelope.replayed === true ? `${label}：已完成（此前已成功，返回原回执）` : `${label}：已完成`;
  }
  if (envelope.status === 'rejected') return `${label}：未完成 — ${shown(envelope.reason)}`;
  if (envelope.status === 'not_found') return `${label}：没有找到对应记录`;
  if (envelope.status === 'not_ready') return `${label}：暂时没有可读结果`;
  return `${label}：已返回`;
}

/** One compact default line; the full receipt stays inside the collapsed
 * disclosure so a read never parks a large result card in the status area. */
function renderLastResult(last: { route: CoreRouteSuffix; payload: unknown }): string {
  return `<details class="details last-result" data-view="last"><summary>${escapeHtml(lastSummary(last))}</summary>`
    + renderRouteResponse(last.route, last.payload)
    + `</details>`;
}

function renderLastPanel(): string {
  const current = state();
  const parts: string[] = [];
  if (current.notice !== null) parts.push(`<span class="notice">${escapeHtml(current.notice)}</span>`);
  if (current.error !== null) parts.push(`<span class="error">${escapeHtml(current.error)}</span>`);
  if (current.sending) parts.push('<span>正在发送…</span>');
  if (current.pending !== null && !current.sending) {
    parts.push(`<span>${escapeHtml(routeLabel(current.pending.route))}：结果尚未确认。</span>`
      + `<button data-action="retry">重试原请求</button>`);
  }
  return parts.join(' ');
}
type FocusSnapshot = { field: string; start: number | null; end: number | null };

function captureFocus(): FocusSnapshot | null {
  const element = document.activeElement;
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return null;
  const field = element.dataset.field;
  if (field === undefined) return null;
  return { field, start: element.selectionStart, end: element.selectionEnd };
}

function restoreFocus(snapshot: FocusSnapshot | null): void {
  if (snapshot === null) return;
  const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-field="${snapshot.field}"]`);
  if (element === null) return;
  element.focus();
  if (snapshot.start !== null && snapshot.end !== null) {
    try { element.setSelectionRange(snapshot.start, snapshot.end); } catch { /* not selectable */ }
  }
}

function captureScroll(): Map<string, number> {
  const positions = new Map<string, number>();
  for (const element of document.querySelectorAll<HTMLElement>('[data-scroll]')) {
    const key = element.dataset.scroll ?? '';
    if (key === 'conversation') continue;
    positions.set(key, element.scrollTop);
  }
  return positions;
}

function restoreScroll(positions: Map<string, number>): void {
  for (const [key, value] of positions) {
    if (key === 'conversation') continue;
    const element = document.querySelector<HTMLElement>(`[data-scroll="${key}"]`);
    if (element !== null) element.scrollTop = value;
  }
}

/** Apply the display-only splitter widths and the auxiliary hidden/expanded
 * state without rebuilding any panel or issuing a request. */
function applyWorkbenchLayout(): void {
  const root = document.getElementById('workbench-root');
  if (root === null) return;
  root.style.setProperty('--wb-left', `${view.leftWidth}px`);
  root.style.setProperty('--wb-right', `${view.rightWidth}px`);
  root.dataset.aux = String(view.auxVisible);
  root.dataset.expanded = String(view.auxExpanded);
  root.dataset.nav = String(view.navVisible);
  document.documentElement.dataset.theme = view.theme;
  const panel = document.getElementById('region-panel');
  if (panel !== null) panel.hidden = !view.auxVisible;
  for (const splitter of document.querySelectorAll<HTMLElement>('[data-splitter]')) {
    const side = splitter.dataset.splitter === 'left' ? 'left' : 'right';
    splitter.setAttribute('aria-valuenow', String(side === 'left' ? view.leftWidth : view.rightWidth));
    splitter.setAttribute('aria-valuemin', String(side === 'left' ? AUX_MIN_LEFT : AUX_MIN_RIGHT));
  }
}
function renderAll(): void {
  if (bootstrapState === null) return;
  const current = states.get(selectedKey);
  captureRenderedTab();
  captureRenderedCenter();
  captureConversationScroll();
  const focus = captureFocus();
  const scroll = captureScroll();
  setHtml('region-topbar', renderTopBar());
  setHtml('region-scope', renderScope());
  setHtml('region-nav', renderNav());
  setHtml('region-center-head', renderCenterHead());
  setHtml('region-conversation', renderCenterBody());
  setHtml('region-composer', renderComposer());
  setHtml('region-tabs', renderTabs());
  setHtml('region-tab-body', renderTabBody());
  setHtml('region-detail', renderDetail());
  setHtml('region-last', renderLastPanel());
  applyWorkbenchLayout();
  restoreScroll(scroll);
  restoreCenterDisplay();
  restoreConversationScroll();
  if (current !== undefined) {
    const layout = activeLayout(current);
    const key = tabKey(current, layout.activeTabId);
    restoreTabDisplay(key);
    renderedTabKey = key;
  }
  restoreFocus(focus);
}
function buildShell(): void {
  if (app === null) return;
  app.innerHTML = `<div class="workbench-root" id="workbench-root" data-aux="false" data-expanded="false" data-nav="true">`
    + `<header class="q-top" id="region-topbar" data-view="topbar"></header>`
    + `<div class="q-body">`
    + `<aside class="q-side" id="region-side" aria-label="项目与成员"><div id="region-scope"></div>`
    + `<div id="region-nav" class="q-side-scroll" data-scroll="nav"></div>`
    + `<div class="q-split q-split-left" id="splitter-left" role="separator" aria-orientation="vertical" tabindex="0" aria-label="调整左栏宽度" data-splitter="left"></div></aside>`
    + `<main class="q-center"><div id="region-center-head"></div>`
    + `<div class="q-chat" id="region-conversation" data-scroll="conversation"></div>`
    + `<div class="q-compose-wrap" id="region-composer"></div></main>`
    + `<aside class="q-panel" id="region-panel" aria-label="辅助工作区" hidden><div class="q-panelhead" id="region-tabs"></div>`
    + `<div class="q-panel-scroll" id="region-tab-body" data-scroll="tab-body"></div>`
    + `<div class="q-detail" id="region-detail" hidden></div>`
    + `<div class="q-split q-split-right" id="splitter-right" role="separator" aria-orientation="vertical" tabindex="0" aria-label="调整右栏宽度" data-splitter="right"></div></aside>`
    + `</div><div id="settings-mount"></div><div class="q-status" id="region-last"></div></div>`;
  applyWorkbenchLayout();
}
function createState(config: BootstrapWorkspace): ScopeState {
  const base: Omit<ScopeState, 'goalConversation'> = {
    key: scopeKey(config.scope),
    config,
    project: null, workspace: null, policyInstall: null, policyActive: null,
    goal: null, adopted: null, proposal: null, plan: null,
    observedCapture: null, goalRead: null, planCandidate: null, proposalRead: null, architectureRead: null,
    taskGraph: null, observed: null, capture: null, sourcePage: null, directories: new Map(), file: null,
    sessionFind: null, sessionRead: null, sessionCreateReceipt: null, sessionOperationRead: null,
    runtimeCapabilities: null, inbox: null, message: null, messageBody: null, consultation: null,
    historyGenerations: new Map(), sessionHistories: new Map(), executionHistories: new Map(), executionReads: new Map(),
    activeSession: null, mainSession: null, mainSessionRead: null, activeMessage: null,
    displayRestore: 'idle',
    auxTabs: [], auxActiveTabId: null, drafts: new Map(), sessionIncludeArchived: false, architectureReadSelection: '',
    taskGraphGoalId: '', relatedSessions: null,
    executionProfileId: null, executionNotice: null,
    execution: createExecutionRun(),
    collaboration: null, collaborationPoll: null, collaborationEpoch: 0, collaborationSyncedGoal: null,
    forms: {
      projectId: config.scope.projectId, goalId: '', objective: '', filePath: '',
      proposalId: '', baselineId: '', baselineRevision: '1', provider: 'text', prefix: '',
      policyIndex: '0', architectureIndex: '0', planIndex: '0', readVersion: 'working_tree',
      archSelection: 'current', sessionRoleIndex: '0', messageText: '', question: '', taskId: '',
      commandLine: '', commandCwd: '.', architectureDraft: '',
    },
    sending: false, pending: null, lastRequest: null, lastResponse: null, conflict: null, notice: null, error: null,
    projectReadState: { status: 'unread' }, goalObjective: '', goalSetup: null,
    executionList: null, commands: new Map(), compareResults: new Map(), saveResults: new Map(),
    timeline: { focus: 0.5, zoom: 0.5, pinned: [], selected: null },
    containment: { activeModuleIds: [], expanded: [], pinned: [], selected: null },
    memberMail: null, historyFold: false,
    compareForm: { beforeKind: 'working_tree', beforeCommit: '', beforeCapture: '',
      afterKind: 'working_tree', afterCommit: '', afterCapture: '', prefix: '' },
  };
  const scope = base as ScopeState;
  scope.goalConversation = createGoalConversationStart(goalConversationStartDeps(scope));
  return scope;
}

function fatal(message: string): void {
  if (app !== null) app.innerHTML = renderGap('本地服务', message);
}

async function fetchBootstrap(): Promise<BootstrapResponse | null> {
  try {
    const response = await fetch(UI_CORE_API_PREFIX + UI_BOOTSTRAP_SUFFIX, { headers: { [UI_PLATFORM_TOKEN_HEADER]: token } });
    if (!response.ok) {
      fatal(response.status === 403 ? '连接已失效，请刷新页面重新连接。' : `读取本地配置失败（HTTP ${response.status}），请刷新页面。`);
      return null;
    }
    return await response.json() as BootstrapResponse;
  } catch (error) {
    fatal(`读取本地配置失败：${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** A valid `SettingsResponse` rejected carried by a non-2xx body. The exact
 * code/reason is preserved rather than flattened to a generic HTTP failure. */
function asRejectedResponse(payload: unknown): Extract<SettingsResponse<unknown>, { status: 'rejected' }> | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const value = payload as Record<string, unknown>;
  if (value.status !== 'rejected' || typeof value.reason !== 'string') return null;
  const allowed = ['invalid', 'forbidden', 'not_found', 'unavailable', 'unsupported'];
  const code = typeof value.code === 'string' && allowed.includes(value.code)
    ? value.code as 'invalid' | 'forbidden' | 'not_found' | 'unavailable' | 'unsupported'
    : 'unavailable';
  return { status: 'rejected', code, reason: value.reason };
}

/** The frozen DTO is the whole body: every route POSTs its `input` verbatim to
 * `/api/real/settings/{route}` with the same per-page token header as every
 * other workbench request. A non-2xx answer is parsed first: when the Host
 * returned a valid `SettingsResponse` rejected, its exact code/reason is
 * preserved instead of being flattened to a generic HTTP failure. A Host that
 * lacks the capability therefore shows the actual reason it reported. */
function createHostSettingsPort(): HostSettingsPort {
  return {
    async call<K extends SettingsRoute>(
      route: K,
      input: SettingsRoutes[K]['input'],
    ): Promise<SettingsResponse<SettingsRoutes[K]['value']>> {
      try {
        const response = await fetch(SETTINGS_API_PREFIX + route, {
          method: 'POST',
          headers: { 'content-type': 'application/json', [UI_PLATFORM_TOKEN_HEADER]: token },
          body: JSON.stringify(input),
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const rejected = asRejectedResponse(payload);
          if (rejected !== null) return rejected as SettingsResponse<SettingsRoutes[K]['value']>;
          return {
            status: 'rejected',
            code: response.status === 404 ? 'unsupported' : 'unavailable',
            reason: `设置接口 ${route} 失败（HTTP ${response.status}）。`,
          };
        }
        if (payload === null) {
          return { status: 'rejected', code: 'unavailable', reason: `设置接口 ${route} 返回了无法解析的响应。` };
        }
        return payload as SettingsResponse<SettingsRoutes[K]['value']>;
      } catch (error) {
        return {
          status: 'rejected',
          code: 'unavailable',
          reason: `设置接口 ${route} 连接失败：${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}

const settingsController: SettingsController = createSettingsController({
  port: createHostSettingsPort(),
  render: current => renderSettings(current),
  onWorkspaceOpened: opened => mergeOpenedWorkspace(opened),
  reloadBootstrap: () => reloadCoreBootstrap(),
});

function applyCompareField(scope: ScopeState, field: string, value: string): boolean {
  switch (field) {
    case 'compareBeforeKind': scope.compareForm.beforeKind = value as 'working_tree' | 'git' | 'capture'; return true;
    case 'compareBeforeCommit': scope.compareForm.beforeCommit = value; return true;
    case 'compareAfterKind': scope.compareForm.afterKind = value as 'working_tree' | 'git' | 'capture'; return true;
    case 'compareAfterCommit': scope.compareForm.afterCommit = value; return true;
    case 'comparePrefix': scope.compareForm.prefix = value; return true;
    default: return false;
  }
}

function onField(field: string, value: string): void {
  const current = states.get(selectedKey);
  if (current === undefined) return;
  if (applyCompareField(current, field, value)) return;
  if (field === 'timelineFocus') { current.timeline.focus = Number(value); return; }
  if (field === 'timelineZoom') { current.timeline.zoom = Number(value); return; }
  if (field in current.forms) current.forms[field as keyof Forms] = value;
  if (field === 'goalId') {
    // A different explicit Goal owns a different host handle. Unbind only the
    // PAGE's timer/panel/epoch; the Host driver for the old Goal keeps running,
    // and any pending unconfirmed request stays intact.
    if (current.collaborationPoll !== null) { clearInterval(current.collaborationPoll); current.collaborationPoll = null; }
    current.collaborationEpoch += 1;
    current.collaboration = null;
    current.collaborationSyncedGoal = null;
  }
}

let splitDrag: { side: 'left' | 'right'; startX: number; startWidth: number } | null = null;

/** Capture one graph-node selection synchronously in the scope and tab that
 * owned the click, then refresh only the rendered SVG selection mark and the
 * stable selection container. The SVG node element is kept alive so a native
 * double click / context menu can still toggle its pin; no timer and no
 * cross-scope callback exists. */
function selectGraphNode(scope: ScopeState, element: HTMLElement): void {
  const layout = syncActiveLayout(scope);
  const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
  if (tab === undefined || (tab.kind !== 'task_graph' && tab.kind !== 'architecture_graph')) return;
  const selection = selectionFromNodeElement(scope, element);
  if (selection === null) return;
  const next = reduceWorkbenchLayout(layout, { kind: 'select_node', tabId: tab.tabId, selection });
  storeLayout(scope, next);
  const body = document.getElementById('region-tab-body');
  const selectedId = selection.nodeId;
  const display = next.tabs.find(candidate => candidate.tabId === tab.tabId);
  const pinned = new Set(display !== undefined && (display.kind === 'task_graph' || display.kind === 'architecture_graph') ? display.display?.pinned ?? [] : []);
  for (const node of body?.querySelectorAll<HTMLElement>('.graph-node, .q-graphnode') ?? []) {
    const selected = node.dataset.node === selectedId;
    node.classList.toggle('selected', selected);
    node.setAttribute('aria-pressed', String(selected || pinned.has(node.dataset.node ?? '')));
  }
  const detail = document.getElementById('region-detail');
  if (detail !== null) { detail.innerHTML = renderDetail(); detail.hidden = false; }
}

function selectionFromNodeElement(scope: ScopeState, element: HTMLElement): WorkbenchNodeSelection | null {
  const nodeId = element.dataset.node ?? '';
  if (nodeId.length === 0) return null;
  const targetKind = element.dataset.targetKind;
  const projectId = element.dataset.projectId ?? scope.config.scope.projectId;
  if (targetKind === 'task') return { kind: 'task', nodeId, target: { kind: 'task', ref: {
    projectId, goalId: element.dataset.goalId ?? '', taskId: element.dataset.taskId ?? '' } } };
  if (targetKind === 'module') return { kind: 'module', nodeId, target: { kind: 'module', ref: {
    projectId, moduleId: element.dataset.moduleId ?? '' } } };
  if (targetKind === 'observed') return { kind: 'observed', nodeId,
    label: element.dataset.nodeLabel ?? nodeId, detail: element.dataset.nodeDetail ?? '' };
  return null;
}

/** Update only the rendered graphs' selected mark and the selection panel; the
 * node elements themselves are never replaced. */
// (removed) node selection re-renders the graph and the lower detail pane.
function splitLimit(side: 'left' | 'right'): number {
  const available = window.innerWidth - AUX_MIN_CENTER - 12;
  return side === 'left'
    ? Math.max(AUX_MIN_LEFT, available - view.rightWidth)
    : Math.max(AUX_MIN_RIGHT, available - view.leftWidth);
}

function setSplit(side: 'left' | 'right', width: number): void {
  const bounded = Math.min(splitLimit(side), Math.max(side === 'left' ? AUX_MIN_LEFT : AUX_MIN_RIGHT, width));
  if (side === 'left') view.leftWidth = bounded;
  else { view.rightWidth = bounded; view.savedRightWidth = bounded; }
  applyWorkbenchLayout();
}

/** Keep the range input alive throughout a drag; only its rendered canvas changes. */
function updateLensCanvas(regionId: string, html: string): void {
  const region = document.getElementById(regionId);
  if (region === null) return;
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const selector of ['.q-graph', '.timeline-track']) {
    const current = region.querySelector(selector);
    const next = template.content.querySelector(selector);
    if (current !== null && next !== null) current.replaceWith(next);
  }
}

function attachHandlers(): void {
  document.addEventListener('click', event => {
    const target = event.target as HTMLElement | null;
    const element = target?.closest<HTMLElement>('[data-action]') ?? null;
    if (element === null) return;
    // Checkbox/select/textarea actions are handled by their own input/change
    // events so a click never cancels the native control.
    if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) return;
    const action = element.dataset.action ?? '';
    if (action === '' || action === 'noop') return;
    event.preventDefault();
    if (action === 'select-node' && (element.classList.contains('graph-node') || element.classList.contains('q-graphnode'))) {
      selectGraphNode(state(), element);
      return;
    }
    void handleAction(action, element);
  });

  // Keyboard equivalent for non-button controls (e.g. the tab close affordance).
  document.addEventListener('keydown', event => {
    const target = event.target as HTMLElement | null;
    const element = target?.closest<HTMLElement>('[data-action]') ?? null;
    if (element === null || element instanceof HTMLInputElement
      || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) return;
    if ((event.key === 'p' || event.key === 'P') && (element.classList.contains('graph-node') || element.classList.contains('q-graphnode'))) {
      event.preventDefault();
      void handleAction('toggle-pin', element);
      return;
    }
    if (element instanceof HTMLButtonElement || (event.key !== 'Enter' && event.key !== ' ')) return;
    const action = element.dataset.action ?? '';
    if (action === '' || action === 'noop') return;
    event.preventDefault();
    void handleAction(action, element);
  });

  // Enter sends the composer; Shift+Enter inserts a newline; IME composition is
  // never intercepted. The send still goes through the existing real action.
  document.addEventListener('keydown', event => {
    const element = event.target;
    if (!(element instanceof HTMLTextAreaElement) || element.dataset.field !== 'composerText') return;
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    const composer = element.closest<HTMLElement>('[data-view="composer"]');
    const send = composer?.querySelector<HTMLButtonElement>('.q-send') ?? null;
    if (send === null || send.disabled) return;
    event.preventDefault();
    send.click();
  });

  // Typing only syncs this scope's display state; it never rebuilds the focused
  // control, so a late response cannot drop the current draft or editor text.
  document.addEventListener('input', event => {
    const element = event.target;
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return;
    const field = element.dataset.field;
    if (field === undefined) return;
    const current = states.get(selectedKey);
    if (current === undefined) return;
    if (field === 'composerText') {
      // Store the draft without rebuilding the DOM, so typing keeps focus.
      storeLayout(current, reduceWorkbenchLayout(syncActiveLayout(current), { kind: 'edit_composer', text: element.value }));
      return;
    }
    if (field === 'fileEditor') {
      storeLayout(current, reduceWorkbenchLayout(syncActiveLayout(current),
        { kind: 'edit_file_draft', tabId: element.dataset.tab ?? '', text: element.value }));
      const layout = syncActiveLayout(current);
      const tab = layout.tabs.find(candidate => candidate.tabId === element.dataset.tab);
      const page = element.closest<HTMLElement>('[data-view="file-page"]');
      if (tab?.kind === 'file' && page !== null) {
        const changed = element.value !== tab.file.content;
        const editable = !layout.readOnly && tab.file.version.kind === 'working_tree'
          && current.config.writeAllowed === true;
        const save = page.querySelector<HTMLButtonElement>('[data-action="save-file"]');
        if (save !== null) save.disabled = !editable || !changed;
        const status = page.querySelector<HTMLElement>('[data-draft-state]');
        if (status !== null) {
          status.dataset.draftState = changed ? 'draft_snapshot' : 'saved';
          status.textContent = changed ? '草稿快照（未保存，仅本页内存）' : '与已读取版本一致';
        }
      }
      return;
    }
    onField(field, element.value);
    // Keep the explicit paste control usable while typing: refresh only the
    // preview and the button's disabled state, never rebuilding the focused
    // textarea. This is the same in-place pattern as the file-save draft.
    if (field === 'architectureDraft') {
      const preview = document.querySelector<HTMLElement>('[data-architecture-draft-preview]');
      if (preview !== null) preview.innerHTML = architectureDraftPreview(element.value);
      const draftButton = document.querySelector<HTMLButtonElement>('[data-action="adopt-architecture-draft"]');
      if (draftButton !== null) draftButton.disabled = element.value.trim().length === 0 || current.sending;
      return;
    }
    // The timeline lens may live in the center observation body or in an
    // auxiliary Task page; re-render both from the scope's display state (the
    // focused range keeps its value in `current.timeline`).
    if (field === 'timelineFocus' || field === 'timelineZoom') {
      updateLensCanvas('region-conversation', renderCenterBody());
      updateLensCanvas('region-tab-body', renderTabBody());
      return;
    }
    // A typed Goal immediately enables the formal continue/refresh entry, while
    // the focused input is left untouched.
    if (field === 'goalId') refreshExecutionButtons(current);
  });

  document.addEventListener('change', event => {
    const element = event.target;
    if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) return;
    const current = states.get(selectedKey);
    if (current === undefined) return;
    if (element.dataset.action === 'select-scope') { switchScope(element.value); return; }
    if (element.dataset.action === 'toggle-archived') {
      current.sessionIncludeArchived = element instanceof HTMLInputElement && element.checked;
      current.sessionFind = null;
      // The old target result was read under the previous includeArchived filter;
      // mark it unread instead of keeping the stale list under a new label.
      current.relatedSessions = null;
      void submit(current, 'sessions/find', buildSessionFindRequest(false));
      return;
    }
    const field = element.dataset.field;
    if (field === undefined) return;
    onField(field, element.value);
    if (field.startsWith('compare')) { renderAll(); return; }
    if (field === 'goalId') refreshExecutionButtons(current);
    // Only the architecture-range selector reveals dependent inputs; refresh the
    // auxiliary body without touching the conversation or the composer draft.
    if (field === 'archSelection') renderAll();
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const current = states.get(selectedKey);
    let changed = false;
    if (view.contextNode !== null) { view.contextNode = null; changed = true; }
    if (view.centerMenuOpen) { view.centerMenuOpen = false; changed = true; }
    if (view.auxExpanded) { view.auxExpanded = false; applyWorkbenchLayout(); changed = true; }
    if (changed && current !== undefined) { event.preventDefault(); renderScopeIfSelected(current); }
  });

  const graphNodeTarget = (event: Event): HTMLElement | null => {
    const target = event.target as Element | null;
    const element = target?.closest('[data-action]') as HTMLElement | null;
    return element !== null && (element.classList.contains('graph-node') || element.classList.contains('q-graphnode')) ? element : null;
  };
  document.addEventListener('dblclick', event => {
    const element = graphNodeTarget(event);
    if (element === null) return;
    event.preventDefault();
    void handleAction('toggle-pin', element);
  });
  document.addEventListener('contextmenu', event => {
    const element = graphNodeTarget(event);
    if (element === null) return;
    event.preventDefault();
    const current = states.get(selectedKey);
    if (current === undefined) return;
    selectGraphNode(current, element);
    view.contextNode = element.dataset.node ?? null;
    renderScopeIfSelected(current);
  });

  document.addEventListener('pointerdown', event => {
    const target = event.target as HTMLElement | null;
    const splitter = target?.closest<HTMLElement>('[data-splitter]') ?? null;
    if (splitter === null) return;
    event.preventDefault();
    const side = splitter.dataset.splitter === 'right' ? 'right' : 'left';
    splitDrag = { side, startX: event.clientX, startWidth: side === 'left' ? view.leftWidth : view.rightWidth };
    splitter.setPointerCapture(event.pointerId);
  });
  document.addEventListener('pointermove', event => {
    if (splitDrag === null) return;
    const delta = event.clientX - splitDrag.startX;
    setSplit(splitDrag.side, splitDrag.side === 'left' ? splitDrag.startWidth + delta : splitDrag.startWidth - delta);
  });
  document.addEventListener('pointerup', () => { splitDrag = null; });
  document.addEventListener('pointercancel', () => { splitDrag = null; });

  document.addEventListener('keydown', event => {
    const target = event.target as HTMLElement | null;
    const splitter = target?.closest<HTMLElement>('[data-splitter]') ?? null;
    if (splitter === null) return;
    const side = splitter.dataset.splitter === 'right' ? 'right' : 'left';
    const step = event.shiftKey ? 48 : 16;
    const current = side === 'left' ? view.leftWidth : view.rightWidth;
    let next = current;
    if (event.key === 'ArrowLeft') next = side === 'left' ? current - step : current + step;
    else if (event.key === 'ArrowRight') next = side === 'left' ? current + step : current - step;
    else if (event.key === 'Home') next = side === 'left' ? AUX_MIN_LEFT : AUX_MIN_RIGHT;
    else if (event.key === 'End') next = splitLimit(side);
    else return;
    event.preventDefault();
    setSplit(side, next);
  });
}

/** Re-open the stored display identity for THIS scope through the formal owner
 * reads. A restore is NOT a selection: it applies the ready Goal/active/main
 * facts in ONE guarded step and never rewrites the persisted preference. */
async function restoreScopeDisplay(scope: ScopeState): Promise<void> {
  if (scope.displayRestore !== 'idle') return;
  scope.displayRestore = 'running';
  const target = scope.config.scope;
  let networkFailed = false;
  const read: ScopeDisplayReadPort = {
    readGoal: async goalId => {
      const outcome = await callCore('goals/read',
        { scope: target, input: { aggregateType: 'Goal', projectId: target.projectId, goalId } });
      if (outcome.kind === 'network') networkFailed = true;
      const payload = outcome.kind === 'response' ? payloadOf(outcome) : null;
      return payload !== null && record(payload).status === 'ready'
        ? { status: 'ready' as const, value: record(payload).value } : null;
    },
    readSession: async sessionId => {
      const outcome = await callCore('sessions/read',
        { scope: target, input: { projectId: target.projectId, sessionId } });
      if (outcome.kind === 'network') networkFailed = true;
      const payload = outcome.kind === 'response' ? payloadOf(outcome) : null;
      return payload !== null && record(payload).status === 'ready'
        ? { status: 'ready' as const, value: record(payload).value } : null;
    },
  };
  const restored = await displayPreferenceStore.restore(target, read);
  // ONE guarded application with no await in between. Only facts that still
  // match the stored selection are applied, and nothing is persisted.
  if (restored !== null) {
    const live = displayPreferenceStore.load(target);
    if (restored.goalId !== null && live.goalId === restored.goalId) {
      const goal = record(record(restored.goalRead).value).goal;
      scope.goalRead = restored.goalRead;
      scope.goal = goal as GoalValue;
      const objective = record(goal).objective;
      if (typeof objective === 'string') scope.goalObjective = objective;
      scope.forms.goalId = restored.goalId;
    }
    if (restored.sessionId !== null && live.sessionId === restored.sessionId) {
      const ref: SessionRef = { projectId: target.projectId, sessionId: restored.sessionId };
      if (!sameSession(scope.activeSession, ref)) scope.activeMessage = null;
      scope.activeSession = ref;
      scope.sessionRead = { session: ref, result: restored.sessionRead as SessionsReadResponse };
    }
    if (restored.mainSessionId !== null && live.mainSessionId === restored.mainSessionId) {
      const ref: SessionRef = { projectId: target.projectId, sessionId: restored.mainSessionId };
      scope.mainSession = ref;
      scope.mainSessionRead = { session: ref, result: restored.mainSessionRead as SessionsReadResponse };
    }
  }
  // Only reads follow, each guarded by the CURRENT identity and tagged to the
  // scope/Session it was issued for.
  if (restored !== null && restored.goalId !== null && scope.forms.goalId.trim() === restored.goalId) {
    await loadPlanCandidate(scope);
  }
  if (restored !== null && restored.sessionId !== null
    && sameSession(scope.activeSession, { projectId: target.projectId, sessionId: restored.sessionId })
    && scope.activeSession !== null) {
    const ref = scope.activeSession;
    void probeResumableOriginal(scope, ref, record(restored.sessionRead).value as SessionCard);
    const key = centerSessionHistoryKey(ref);
    await submit(scope, 'sessions/history', buildSessionHistoryRequest(target, ref, null, false, CENTER_HISTORY_LIMIT),
      tagsFor(ref, null, null, null, null, key));
  }
  if (restored !== null && restored.mainSessionId !== null
    && sameSession(scope.mainSession, { projectId: target.projectId, sessionId: restored.mainSessionId })
    && scope.mainSession !== null) {
    const ref = scope.mainSession;
    void probeResumableOriginal(scope, ref, record(restored.mainSessionRead).value as SessionCard);
    const key = centerSessionHistoryKey(ref);
    await submit(scope, 'sessions/history', buildSessionHistoryRequest(target, ref, null, false, CENTER_HISTORY_LIMIT),
      tagsFor(ref, null, null, null, null, key));
  }
  renderAll();
  // Success or a formal missing/not-ready answer completes the restore without
  // faking success; a network failure is retryable on the next switch back.
  scope.displayRestore = networkFailed ? 'idle' : 'done';
}

// ---------------------------------------------------------------------------
// Host settings surface (frozen DTO; no backend/views/history change)
// ---------------------------------------------------------------------------

/** Merge a new bootstrap without ever replacing an existing ScopeState object:
 * every existing per-scope draft, Session and captured run identity survives a
 * workspace open or a profile refresh; createState runs only for new keys. */
function mergeBootstrap(next: BootstrapResponse): void {
  bootstrapState = next;
  for (const workspace of next.workspaces) {
    const key = scopeKey(workspace.scope);
    const existing = states.get(key);
    if (existing === undefined) states.set(key, createState(workspace));
    else existing.config = workspace;
  }
}

/** A profile refresh after models/save or models/select must never wipe the
 * page or the settings dialog. `models/save|select` return settings only, so
 * the existing core bootstrap is re-read here for the profile lists. */
async function reloadCoreBootstrap(): Promise<void> {
  const response = await fetch(UI_CORE_API_PREFIX + UI_BOOTSTRAP_SUFFIX, {
    headers: { [UI_PLATFORM_TOKEN_HEADER]: token },
  });
  if (!response.ok) {
    // Prefer the Host's structured reason; fall back to the transport status.
    const payload: unknown = await response.json().catch(() => null);
    const reason = payload !== null && typeof payload === 'object'
      && typeof (payload as Record<string, unknown>).reason === 'string'
      ? (payload as Record<string, unknown>).reason as string
      : `HTTP ${response.status}`;
    throw new Error(reason);
  }
  const next = await response.json() as BootstrapResponse;
  mergeBootstrap(next);
  if (!states.has(selectedKey) && next.workspaces[0] !== undefined) {
    selectedKey = scopeKey(next.workspaces[0].scope);
    view.expandedProjects.add(selectedKey);
  }
  if (states.has(selectedKey)) renderAll();
}

/** `workspaces/open` already returns the full bootstrap + exact scope; the
 * merge owner preserves every other scope, explicitly selects the opened one
 * and leaves each scope's own draft/Session object untouched. */
async function mergeOpenedWorkspace(opened: SettingsWorkspaceOpened): Promise<void> {
  // The returned bootstrap is authoritative and is ALWAYS merged, even when the
  // user closed the dialog while the request was in flight: the opened
  // workspace is never discarded.
  mergeBootstrap(opened.bootstrap);
  const key = scopeKey(opened.scope);
  if (!states.has(key)) {
    // Only the authoritative bootstrap creates scopes. Never fabricate one with
    // an invented revision; surface the precise inconsistency instead.
    settingsController.reportError(
      `Host 返回的 bootstrap 未包含刚打开的工作区（${key}），未选中任何工作区；请刷新后重试。`);
    return;
  }
  // Selection is a display action: keep it only while the explicit dialog
  // interaction that issued the request is still the current one.
  if (!settingsController.shouldSelectOpened()) {
    if (states.has(selectedKey)) renderAll();
    return;
  }
  selectedKey = key;
  view.expandedProjects.add(key);
  renderAll();
}

/** The first-folder shell: no invented scope, no state() call, settings only. */
function renderEmptyWorkbench(): void {
  setHtml('region-topbar', '<strong>工作台</strong>');
  setHtml('region-scope', '');
  setHtml('region-nav', '<div class="q-section">项目</div><p class="q-nav-empty">还没有工作区</p>');
  setHtml('region-center-head', '');
  setHtml('region-conversation',
    '<section class="conversation" data-view="empty-workspace"><h2>尚未打开工作区</h2>'
    + '<p class="muted">使用左下角“设置”打开本机的一个真实文件夹作为第一个工作区。</p></section>');
  setHtml('region-composer', '');
  setHtml('region-tabs', '');
  setHtml('region-tab-body', '');
  setHtml('region-detail', '');
  setHtml('region-last', '');
}

/** Repaint only the settings mount. Structural changes call it; per-keystroke
 * field edits do not, so the focused control and its caret survive. */
function renderSettings(current: SettingsState): void {
  const mount = document.getElementById('settings-mount');
  if (mount === null) return;
  mount.innerHTML = renderSettingsEntry(current) + (current.open ? renderSettingsDialog(current) : '');
}

async function handleSettingsAction(action: string, element: HTMLElement): Promise<void> {
  switch (action) {
    case 'open-settings': { await settingsController.open(); return; }
    case 'close-settings': { settingsController.close(); return; }
    case 'settings-section': {
      settingsController.setSection(element.dataset.section === 'models' ? 'models' : 'workspace');
      return;
    }
    case 'settings-directory-go':
    case 'settings-directory-refresh': { await settingsController.browse(settingsController.state.workspace.path); return; }
    case 'settings-directory-parent': {
      const parent = settingsController.state.directory?.parent ?? null;
      if (parent !== null) await settingsController.browse(parent);
      return;
    }
    case 'settings-directory-child': { await settingsController.browse(element.dataset.path ?? ''); return; }
    case 'settings-open-workspace': { await settingsController.openWorkspace(); return; }
    case 'settings-new-model': { settingsController.newModel(); return; }
    case 'settings-edit-model': { settingsController.editModel(element.dataset.model ?? ''); return; }
    case 'settings-save-model': { await settingsController.saveModel(); return; }
    default: return;
  }
}

function settingsInputField(target: HTMLInputElement | HTMLTextAreaElement): void {
  const field = target.dataset.field;
  if (field === undefined) return;
  switch (field) {
    case 'settings-directory-path': settingsController.setWorkspaceField('path', target.value); return;
    case 'settings-workspace-name': settingsController.setWorkspaceField('name', target.value); return;
    case 'settings-model-label': settingsController.setModelField('label', target.value); return;
    case 'settings-model-model': settingsController.setModelField('model', target.value); return;
    case 'settings-model-baseurl': settingsController.setModelField('baseUrl', target.value); return;
    case 'settings-model-apikey': settingsController.setModelField('apiKey', target.value); return;
    default: return;
  }
}

function settingsChangeField(target: HTMLInputElement | HTMLSelectElement): void {
  if (target.dataset.action === 'settings-select-model' && target instanceof HTMLSelectElement) {
    void settingsController.selectModel(
      { projectId: target.dataset.scopeProject ?? '', workspaceId: target.dataset.scopeWorkspace ?? '' },
      target.value,
    );
    return;
  }
  const field = target.dataset.field;
  if (field === undefined) return;
  switch (field) {
    case 'settings-workspace-project':
      settingsController.setWorkspaceField('projectId', target.value);
      renderSettings(settingsController.state);
      return;
    case 'settings-workspace-model': settingsController.setWorkspaceField('modelId', target.value); return;
    case 'settings-workspace-write':
      settingsController.setWorkspaceField('writeAllowed', target instanceof HTMLInputElement && target.checked);
      renderSettings(settingsController.state);
      return;
    case 'settings-workspace-commands':
      settingsController.setWorkspaceField('commandsAllowed', target instanceof HTMLInputElement && target.checked);
      renderSettings(settingsController.state);
      return;
    case 'settings-model-provider':
      if (target instanceof HTMLSelectElement) settingsController.setModelField('provider', target.value as SettingsProvider);
      renderSettings(settingsController.state);
      return;
    case 'settings-model-thinking':
      if (target instanceof HTMLSelectElement) {
        settingsController.setModelField('thinking', target.value === '' ? null : target.value as 'enabled' | 'disabled');
      }
      return;
    case 'settings-model-effort':
      if (target instanceof HTMLSelectElement) {
        settingsController.setModelField('reasoningEffort', target.value === '' ? null : target.value as 'low' | 'high' | 'max');
      }
      return;
    default: return;
  }
}

/** Isolated settings events: every handler stops propagation, so the existing
 * conversation/draft document handlers never receive a settings interaction. */
function attachSettingsHandlers(): void {
  const mount = document.getElementById('settings-mount');
  if (mount === null) return;
  mount.addEventListener('click', event => {
    const target = event.target as HTMLElement | null;
    const element = target?.closest<HTMLElement>('[data-action]') ?? null;
    if (element === null || !mount.contains(element)) return;
    if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) return;
    const action = element.dataset.action ?? '';
    if (action.length === 0 || action === 'noop') return;
    event.preventDefault();
    event.stopPropagation();
    void handleSettingsAction(action, element);
  });
  mount.addEventListener('input', event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    event.stopPropagation();
    settingsInputField(target);
  });
  mount.addEventListener('change', event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    event.stopPropagation();
    settingsChangeField(target);
  });
  // Swallow keys inside the dialog so the main Enter/Space action handler never
  // sees a settings button; Escape still closes the dialog.
  mount.addEventListener('keydown', event => {
    if (event.key === 'Escape') settingsController.close();
    event.stopPropagation();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !settingsController.state.open) return;
    event.preventDefault();
    settingsController.close();
  });
}

async function main(): Promise<void> {
  if (app === null) return;
  if (token.length === 0) { fatal('无法连接到本地服务：页面缺少连接信息，请刷新页面。'); return; }
  const bootstrap = await fetchBootstrap();
  if (bootstrap === null) return;
  mergeBootstrap(bootstrap);
  const first = bootstrap.workspaces[0];
  const globalPreference = displayPreferenceStore.readGlobal();
  if (globalPreference.theme !== null) view.theme = globalPreference.theme;
  if (first !== undefined) {
    selectedKey = globalPreference.lastScopeKey !== null && states.has(globalPreference.lastScopeKey)
      ? globalPreference.lastScopeKey : scopeKey(first.scope);
    view.expandedProjects.add(selectedKey);
  } else {
    selectedKey = '';
  }
  buildShell();
  attachHandlers();
  attachSettingsHandlers();
  renderSettings(settingsController.state);
  if (first === undefined) {
    // Empty bootstrap: still expose the gear so the user can open the first
    // real folder. No default scope and no state() call is invented.
    renderEmptyWorkbench();
    return;
  }
  renderAll();
  const initial = states.get(selectedKey);
  if (initial !== undefined) await restoreScopeDisplay(initial);
  // First real member directory for the restored scope (no debug "list" step).
  if (initial !== undefined) await submit(initial, 'sessions/find', buildSessionFindRequest(false));
}

if (typeof document !== 'undefined') void main();
