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
  createWorkbenchLayout,
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
  renderWorkbenchLayout,
} from './views.js';
import type { WorkbenchDraftReference, WorkbenchExecutionHistoryPage, WorkbenchGraphDisplay, WorkbenchLayout, WorkbenchNodeSelection, WorkbenchTab } from './views.js';
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
  PlansApplyResponse,
  PlansProposeResponse,
  ProjectsCreateResponse,
  QueriesAnswerBody,
  QueriesAnswerResponse,
  QueriesPrepareResponse,
  QueriesStartResponse,
  QueriesSubmitBody,
  QueriesSubmitResponse,
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
  WorkflowAdvanceBody,
  WorkflowAdvanceResult,
  WorkflowGoalInputBody,
  WorkspacesRegisterResponse,
  WorkspacesRegistrationResponse,
} from '../app/core-http-types.js';

type CommittedOf<T> = Extract<T, { status: 'committed' }>;
type ReadyOf<T> = Extract<T, { status: 'ready' }>;
type MessageRefValue = ReadyOf<MessagesReadResponse>['value']['ref'];

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
};
const noTags: RequestTags = { session: null, messageRef: null, part: null, workTarget: null, run: null,
  pageKey: null, filterIncludeArchived: null, relatedRole: null };
const tagsFor = (
  session: SessionRef | null,
  messageRef: MessageRefValue | null = null,
  part: 'message' | 'response' | null = null,
  workTarget: WorkLinkTarget | null = null,
  run: RunRef | null = null,
  pageKey: string | null = null,
): RequestTags => ({ session, messageRef, part, workTarget, run, pageKey,
  filterIncludeArchived: null, relatedRole: null });
/** Related-target read tags: the exact target, filter and (optional) role. */
const tagsForRelated = (target: WorkLinkTarget, includeArchived: boolean, role: unknown | null): RequestTags =>
  ({ session: null, messageRef: null, part: null, workTarget: target, run: null, pageKey: null,
    filterIncludeArchived: includeArchived, relatedRole: role ?? null });

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
};

function createExecutionRun(): ExecutionRun {
  return {
    running: false, kind: null, flowId: null, scope: null, goalRef: null, question: '',
    profile: null, selectedSession: null, sessionRef: null, sessionRevision: null,
    queryJobRef: null, queryRunRef: null, jobRevision: null, runRevision: null,
    goalRead: null, registration: null, answer: null, body: null,
    planning: null, planningRequest: null, advance: null, advanceRequest: null, candidate: null,
    calls: [], callIndex: 0, pendingIndex: null, driverStart: 0, requestIds: {}, pending: null, resumeIntent: null,
    resumeCount: 0, driver: null, phase: null, notice: null, error: null,
  };
}

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
  proposalRead: unknown;
  architectureRead: unknown;
  taskGraph: unknown;
  observed: unknown;
  capture: CaptureValue | null;
  sourcePage: SourcePageValue | null;
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
  /** Opened Session-history pages keyed by scope + captured conversation/layout
   * + page (center or tab) + exact SessionRef. The center and each auxiliary
   * history/session tab keep their own result and original cursor. */
  sessionHistories: Map<string, { session: SessionRef; result: SessionsHistoryResponse }>;
  /** Opened Run-window pages keyed by scope + captured conversation/layout + the
   * typed execution tab. Refresh/pagination overwrite only this page's latest
   * real read result (ready or not). */
  executionHistories: Map<string, WorkbenchExecutionHistoryPage>;
  /** The exact `executions/read` facts per opened execution page. The claim
   * Session is used only from a ready record; display state only. */
  executionReads: Map<string, { run: RunRef; result: ExecutionsReadResponse }>;
  activeSession: SessionRef | null;
  activeMessage: MessageRefValue | null;
  // R6 UI-layout display state. Each conversation (scope + exact SessionRef, or
  // the project main conversation) keeps its own tabs/drafts; no second business
  // owner and no write back into Session/Task.
  layouts: Map<string, WorkbenchLayout>;
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
  forms: Forms;
  sending: boolean;
  pending: { route: CoreRouteSuffix; body: unknown; tags: RequestTags } | null;
  lastRequest: { route: CoreRouteSuffix; body: unknown; tags: RequestTags } | null;
  lastResponse: { route: CoreRouteSuffix; payload: unknown } | null;
  conflict: { route: CoreRouteSuffix; current: unknown[] } | null;
  notice: string | null;
  error: string | null;
};

const GRAPH_WRITE_ROUTES = new Set<CoreRouteSuffix>([
  'projects/create', 'workspaces/register', 'completion-policies/install',
  'completion-policies/activate', 'goals/create', 'architecture/adopt-initial',
  'architecture/capture', 'plans/propose', 'plans/apply', 'messages/send',
  'queries/submit', 'queries/claim',
]);

const ROUTE_LABELS: Record<CoreRouteSuffix, string> = {
  'projects/create': '创建项目',
  'workspaces/register': '登记工作区',
  'completion-policies/install': '安装完成策略',
  'completion-policies/activate': '启用完成策略',
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
  'messages/send': '发送消息',
  'messages/inbox': '查看收件箱',
  'messages/read': '查看消息',
  'messages/body': '查看消息正文',
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
  'executions/read': '查看执行事实',
  'executions/history': '查看本次执行原历史',
};

const app = document.getElementById('app');
const token = readToken();
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

/** Same Run identity (aggregate/project/goal/run), never a title or tabId. */
const sameRun = (left: RunRef, right: RunRef): boolean =>
  left.aggregateType === right.aggregateType && left.projectId === right.projectId
  && left.goalId === right.goalId && left.runId === right.runId;

/** Exact page key for one opened Session-history page. Scope is the owning
 * ScopeState; the captured conversation/layout + page discriminator (center or
 * tab) + exact SessionRef keep the center and every auxiliary tab separate. */
const sessionHistoryPageKey = (conversation: string, page: string, session: SessionRef): string =>
  `session-history|${conversation}|${page}|${session.projectId}/${session.sessionId}`;

/** Exact page key for one opened execution page: the captured conversation/layout
 * plus the typed execution tab (whose tabId already carries the complete RunRef). */
const executionPageKey = (conversation: string, tabId: string): string =>
  `execution|${conversation}|${tabId}`;

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
  scope.pending = { route, body, tags };
  scope.sending = true;
  scope.error = null;
  scope.notice = null;
  renderScopeIfSelected(scope);

  const outcome = await callCore(route, body);
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
      if (typeof goalRef.goalId === 'string' && scope.forms.goalId.trim().length === 0) scope.forms.goalId = goalRef.goalId;
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
      if (session !== null) scope.sessionRead = { session, result: payload as SessionsReadResponse };
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
    case 'sessions/history':
      // Exact Session + page attribution; the newest read is stored even when it
      // is not ready, so a stale ready page never survives a failed refresh.
      if (tags.session !== null && tags.pageKey !== null)
        scope.sessionHistories.set(tags.pageKey, { session: tags.session, result: payload as SessionsHistoryResponse });
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

/** The ONE explicit Session-history request builder. It receives the exact
 * scope, Session and the original page whose `nextCursor` is being followed, so
 * the center path and every auxiliary history/session tab page their own object
 * and never borrow another object's cursor. A null `next` rebuilds the head
 * (afterCursor null); empty `items` with a non-null `nextCursor` still continues. */
function buildSessionHistoryRequest(
  targetScope: CoreScope, ref: SessionRef, previous: SessionsHistoryResponse | null, next: boolean,
): unknown | null {
  let afterCursor: string | null = null;
  if (next) {
    if (previous === null || previous.status !== 'ready' || previous.value.nextCursor === null) return null;
    afterCursor = previous.value.nextCursor;
  }
  return { scope: targetScope, input: { sessionRef: ref, afterCursor, throughCursor: null, limit: 10 } };
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
    selectSession(scope, card.record.ref);
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
  selectSession(scope, payload.value.ref);
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

/** One user action per public request: send, display, and continue ONLY when the
 * owner returned ready with a real `next`. A null `next` or a non-ready result
 * is a real stop that keeps the original request. The owner's next input is
 * forwarded untouched. */
async function drainContinuation(
  scope: ScopeState, run: ExecutionRun, target: CoreScope, seed: ExecutionIntent,
): Promise<void> {
  let intent = seed;
  for (let guard = 0; guard < 64; guard += 1) {
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
      run.advance = payload as WorkflowAdvanceResult;
      run.advanceRequest = { scope: target, input: intent.input };
      if (run.advance.status === 'ready') run.phase = run.advance.value.state;
    }
    const continuation = planExecutionContinuation(
      payload as WorkflowAdvanceResult | InitialPlanningGoalInputResult);
    if (continuation.status !== 'next') {
      // A waiting initial-plan adoption keeps its original public input so a
      // later explicit continue resends THAT request (a new requestId), never a
      // fabricated select_work.
      const readyState = record(payload).status === 'ready' ? record(record(payload).value).state : null;
      run.resumeIntent = intent.route === 'workflow/goal-input' && readyState === 'waiting' ? intent : null;
      return;
    }
    if (continuation.route === 'workflow/goal-input')
      intent = { route: 'workflow/goal-input', input: continuation.input };
    else
      intent = { route: 'workflow/advance', input: continuation.input };
    run.resumeIntent = intent;
  }
  // Per-page stop: the not-yet-sent next stays resumable.
  run.notice = '继续执行达到本页步数上限；原 next 已保留，点击“继续执行”发送同一公开请求。';
}

/** The investigation/planning flow. Every identity and the selected Session are
 * read from the captured `run` only, so a later navigation cannot change the
 * in-flight action. */
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
  const goalRevision = typeof goalValue.revision === 'number' ? goalValue.revision : 1;

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
  const intent: QueryJobIntentV1 = {
    schemaVersion: 1, intentId: queryJobId, projectId: target.projectId, workspaceId: target.workspaceId,
    goalId: goalRef.goalId, question: run.question, focusTaskRefs: [], budget: profile.budget, multiTurn: { maxRounds: 1 },
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
    run.notice = '调查已受理但尚未产生正式回答；可点击“刷新执行状态”查看原调查。';
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
}

/** Start a fresh investigation/planning action. Scope, Goal, question and the
 * selected Session are frozen into the run before the first await. */
async function runExecution(scope: ScopeState, kind: 'investigate' | 'planning'): Promise<void> {
  if (scope.execution.running || scope.execution.pending !== null) return;
  const profile = selectedExecutionProfile(scope);
  const selectedSession = scope.activeSession;
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
}

/** The explicit "continue" action. It never creates a new flow or a Query
 * Session: it resends a saved continuation, or falls back to the original
 * select_work when there is no saved continuation. */
async function continueExecution(scope: ScopeState): Promise<void> {
  const run = scope.execution;
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
  if (resume !== null && resume.route === 'workflow/advance') {
    await driveRun(scope, run, (current, active) => drainContinuation(current, active, target, resume));
    return;
  }
  if (run.goalRef === null) {
    scope.error = '请先选择目标。';
    renderScopeIfSelected(scope);
    return;
  }
  // No saved continuation: the original select_work is the only resume. It is
  // independent of any Query profile; the explicit work-Session selection (if
  // any) is passed through so the original owner reports its compatibility.
  const input: WorkflowAdvanceInput = {
    schemaVersion: 1, goalRef: run.goalRef, flowId: run.flowId ?? `flow-${Date.now().toString(36)}`,
    sessionHint: run.selectedSession, kind: 'select_work',
  };
  await driveRun(scope, run, (current, active) =>
    drainContinuation(current, active, target, { route: 'workflow/advance', input }));
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

/** Re-read the original Query state; it never starts a new model call. */
async function refreshExecution(scope: ScopeState): Promise<void> {
  const run = scope.execution;
  const ref = run.queryRunRef;
  if (run.running || ref === null) return;
  if (run.pending !== null) {
    scope.notice = '存在尚未确认的原请求，请先“重新发送原请求”。';
    renderScopeIfSelected(scope);
    return;
  }
  const target: CoreScope = run.scope ?? { projectId: ref.projectId, workspaceId: ref.workspaceId };
  await driveRun(scope, run, async (current, active) => {
    const observed = await executionCall(current, active, 'queries/observe', { scope: target, input: { queryRunRef: ref } });
    const problem = outcomeProblem(observed);
    if (problem !== null) { active.error = problem; return; }
    const observedPayload = payloadOf(observed) as QueriesStartResponse;
    if (observedPayload.status !== 'ready') { active.notice = '调查状态尚未就绪。'; return; }
    if (observedPayload.value.answer === null) { active.notice = '调查仍在进行，没有新的正式回答。'; return; }
    await readExecutionAnswer(current, active, target, observedPayload.value.answer.ref);
  });
}

async function handleAction(action: string, element: HTMLElement): Promise<void> {
  const scope = state();
  switch (action) {
    case 'create-project': { const body = buildProjectRequest(); if (requireBody(scope, body)) await submit(scope, 'projects/create', body); return; }
    case 'register-workspace': { const body = buildWorkspaceRequest(); if (requireBody(scope, body)) await submit(scope, 'workspaces/register', body); return; }
    case 'install-policy': { const body = buildPolicyInstallRequest(); if (requireBody(scope, body)) await submit(scope, 'completion-policies/install', body); return; }
    case 'activate-policy': { const body = buildPolicyActivateRequest(); if (requireBody(scope, body)) await submit(scope, 'completion-policies/activate', body); return; }
    case 'create-goal': { const body = buildGoalRequest(); if (requireBody(scope, body)) await submit(scope, 'goals/create', body); return; }
    case 'adopt-architecture': { const body = buildAdoptRequest(); if (requireBody(scope, body)) await submit(scope, 'architecture/adopt-initial', body); return; }
    case 'propose-plan': { const body = buildProposeRequest(); if (requireBody(scope, body)) await submit(scope, 'plans/propose', body); return; }
    case 'apply-plan': { const body = buildApplyRequest(); if (requireBody(scope, body)) await submit(scope, 'plans/apply', body); return; }
    case 'read-goal': { const body = buildGoalReadRequest(); if (requireBody(scope, body)) await submit(scope, 'goals/read', body); return; }
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
    case 'run-investigation': { await runExecution(scope, 'investigate'); return; }
    case 'run-planning': { await runExecution(scope, 'planning'); return; }
    case 'run-continue': { await continueExecution(scope); return; }
    case 'refresh-execution': { await refreshExecution(scope); return; }
    case 'read-path': {
      const path = element.dataset.path ?? '';
      const body = buildFileRequest(path);
      if (requireBody(scope, body)) { scope.forms.filePath = path; await submit(scope, 'files/read', body); }
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
      const draft = scope.layouts.get(conversation) ?? createWorkbenchLayout(targetScope, recipient, sessionLifecycle(scope, recipient));
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
        const latest = scope.layouts.get(conversation);
        if (latest !== undefined && latest.composerDraft.text === submittedText) {
          storeLayout(scope, reduceWorkbenchLayout(latest, { kind: 'edit_composer', text: '' }));
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
    case 'read-session-history': {
      const active = scope.activeSession;
      const key = active === null ? null : centerSessionHistoryKey(active);
      const body = active === null || key === null ? null
        : buildSessionHistoryRequest(scope.config.scope, active, storedSessionHistoryPage(scope, key), false);
      if (body === null) { scope.error = '请先选择会话。'; renderScopeIfSelected(scope); return; }
      await submit(scope, 'sessions/history', body, tagsFor(active, null, null, null, null, key));
      return;
    }
    case 'next-session-history': {
      const active = scope.activeSession;
      const key = active === null ? null : centerSessionHistoryKey(active);
      const body = active === null || key === null ? null
        : buildSessionHistoryRequest(scope.config.scope, active, storedSessionHistoryPage(scope, key), true);
      if (body === null) { scope.error = '原历史没有更多页。'; renderScopeIfSelected(scope); return; }
      await submit(scope, 'sessions/history', body, tagsFor(active, null, null, null, null, key));
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
      await submit(scope, 'sessions/read', buildSessionReadRequest(targetScope, ref), tagsFor(ref));
      await submit(scope, 'sessions/history', buildSessionHistoryRequest(targetScope, ref, null, false),
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
      const key = tabSessionHistoryKey(conversationKey(layout.session), tab.tabId, tab.session);
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
      const key = tabSessionHistoryKey(conversationKey(layout.session), tab.tabId, tab.session);
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
      const key = tabSessionHistoryKey(conversationKey(layout.session), tab.tabId, tab.session);
      await submit(scope, 'sessions/history',
        buildSessionHistoryRequest(targetScope, tab.session, storedSessionHistoryPage(scope, key), false),
        tagsFor(tab.session, null, null, null, null, key));
      return;
    }
    case 'next-history-tab': {
      const layout = syncActiveLayout(scope);
      const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
      if (tab === undefined || tab.kind !== 'history') return;
      const key = tabSessionHistoryKey(conversationKey(layout.session), tab.tabId, tab.session);
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
      const key = executionPageKey(conversationKey(scope.activeSession), tab.tabId);
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
      const key = executionPageKey(conversationKey(scope.activeSession), tab.tabId);
      await submit(scope, 'executions/read', { scope: scope.config.scope, input: tab.run },
        tagsFor(null, null, null, null, tab.run, key));
      return;
    }
    case 'read-execution-history': {
      const tab = activeExecutionTab(scope);
      if (tab === null) { scope.error = '请先打开本次执行页。'; renderScopeIfSelected(scope); return; }
      const key = executionPageKey(conversationKey(scope.activeSession), tab.tabId);
      const previous = scope.executionHistories.get(key) ?? null;
      const body = buildExecutionHistoryRequest(scope.config.scope, tab.run, previous, false);
      if (!requireBody(scope, body)) return;
      await submit(scope, 'executions/history', body, tagsFor(null, null, null, null, tab.run, key));
      return;
    }
    case 'next-execution-history': {
      const tab = activeExecutionTab(scope);
      if (tab === null) { scope.error = '请先打开本次执行页。'; renderScopeIfSelected(scope); return; }
      const key = executionPageKey(conversationKey(scope.activeSession), tab.tabId);
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
      const key = tab === null ? null : executionPageKey(conversationKey(scope.activeSession), tab.tabId);
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
        buildSessionHistoryRequest(targetScope, claim, null, false),
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
      openTab(scope, { tabId: `tasks:${goalId}`, kind: 'task_graph', title: `任务 ${goalId}`, goal });
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
      renderScopeIfSelected(scope);
      return;
    }
    case 'open-file': {
      const path = element.dataset.path ?? '';
      const session = scope.activeSession;
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
        openTabInto(scope, session, { tabId: `file:${file.path}@${versionKey}`, kind: 'file', title: file.path, file, editorDraft: null });
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
      storeLayout(scope, reduceWorkbenchLayout(syncActiveLayout(scope), { kind: 'edit_composer', text: '' }));
      renderScopeIfSelected(scope);
      return;
    }
    case 'open-setup-tab': { openTab(scope, setupTab()); renderScopeIfSelected(scope); return; }
    case 'activate-tab': {
      const tabId = element.dataset.tab ?? '';
      storeLayout(scope, reduceWorkbenchLayout(syncActiveLayout(scope), { kind: 'activate_tab', tabId }));
      renderScopeIfSelected(scope);
      return;
    }
    case 'close-tab': {
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
  const canContinue = run.resumeIntent !== null || run.queryRunRef !== null
    || run.goalRef !== null || current.goal !== null;
  const buttons = `<div class="buttons">`
    + actionButton('run-continue', '继续执行', canContinue && !run.running && run.pending === null,
      run.pending === null ? '需要先有采用的计划或待续传步骤' : '存在尚未确认的原请求，请先重试')
    + actionButton('refresh-execution', '刷新执行状态', run.queryRunRef !== null && !run.running, '没有进行中的调查')
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
  const planning = run.planning === null ? '' : renderInitialPlanning(run.planning, run.planningRequest);
  const advance = run.advance === null ? '' : renderWorkflowAdvance(run.advance, run.advanceRequest);
  const sent = run.calls.length === 0 ? ''
    : detailsBlock('已发送的完整原请求', `<pre>${escapeHtml(JSON.stringify(
      run.calls.map(call => ({ route: call.route, request: call.request })), null, 2))}</pre>`);
  return profiles + question + buttons + notice + phase + answer + candidate + planning + advance + sent;
}

function renderScope(): string {
  if (bootstrapState === null) return renderGap('启动配置', '尚未读取本地配置');
  const options = bootstrapState.workspaces.map(workspace => {
    const key = scopeKey(workspace.scope);
    return `<option value="${escapeHtml(key)}"${key === selectedKey ? ' selected' : ''}>`
      + `${escapeHtml(workspace.name)} — ${escapeHtml(workspace.scope.projectId)}/${escapeHtml(workspace.scope.workspaceId)}</option>`;
  }).join('');
  const material = bootstrapState.review;
  const summary = material === null
    ? '<p class="muted">本机没有提供初始化资料；你仍可填写具体内容创建目标，其余步骤会显示当前缺项。</p>'
    : `<p>可用资料：完成策略 ${list(material.policies).length} · 目标 ${list(material.goals).length} · 初始架构 ${list(material.architectures).length} · 计划草案 ${list(material.plans).length}</p>`
      + (material.notes === undefined ? '' : `<p class="muted">${escapeHtml(material.notes)}</p>`);
  return `<h2>本地工作台</h2>`
    + `<label class="inline">工作区 <select data-action="select-scope">${options}</select></label>`
    + summary
    + `<p class="muted">连接失效时刷新页面重新连接即可。</p>`
    + renderExecution();
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
  return `<section class="panel" data-view="plan"><h2>初始架构与计划</h2>`
    + (architectures.length === 0 ? refusalLine('本机没有提供初始架构资料。')
      : `<label class="inline">初始架构 <select data-field="architectureIndex">${architectureOptions}</select></label>`)
    + `<div class="buttons">${actionButton('adopt-architecture', '采用初始架构', current.project !== null && current.workspace !== null && architectures.length > 0, architectures.length === 0 ? '没有可用初始架构' : '本页尚未取得项目与工作区的正式版本')}</div>`
    + (current.adopted === null ? '<p class="muted">采用架构：尚未采用</p>'
      : `<p>采用架构：已采用，版本 ${escapeHtml(current.adopted.baseline.revision)}`
        + (current.adopted.catalog === null ? '（该基线早于目录，未记录模块）' : `，模块 ${current.adopted.catalog.catalog.modules.length}`) + `</p>`
        + detailsBlock('查看版本与摘要', `<pre>${escapeHtml(JSON.stringify({ baselineId: current.adopted.baseline.baselineId, revision: current.adopted.baseline.revision, contentDigest: current.adopted.baseline.contentDigest }, null, 2))}</pre>`))
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

const view = { leftWidth: 300, rightWidth: 420, savedRightWidth: 420, auxVisible: true, auxExpanded: false };

type TabDisplayState = { scrollTop: number; scrollLeft: number; selectionStart: number; selectionEnd: number; openDetails: boolean[] };
const tabDisplay = new Map<string, TabDisplayState>();
let renderedTabKey: string | null = null;

const tabKey = (scope: ScopeState, session: SessionRef | null, tabId: string | null): string =>
  `${scope.key}|${conversationKey(session)}|${tabId ?? ''}`;

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
    openDetails: Array.from(body.querySelectorAll('details')).map(detail => detail.open),
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
  saved.openDetails.forEach((open, index) => { const detail = details[index]; if (detail !== undefined) detail.open = open; });
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
  sessionHistoryPageKey(conversationKey(session), 'center', session);

/** One auxiliary history/session tab's own Session-history page. */
const tabSessionHistoryKey = (conversation: string, tabId: string, session: SessionRef): string =>
  sessionHistoryPageKey(conversation, `tab:${tabId}`, session);

function sessionLifecycle(scope: ScopeState, ref: SessionRef | null): SessionRecord['lifecycle'] | null {
  if (ref === null) return null;
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

function activeLayout(scope: ScopeState): WorkbenchLayout {
  const key = conversationKey(scope.activeSession);
  const existing = scope.layouts.get(key);
  if (existing !== undefined) return existing;
  const created = createWorkbenchLayout(scope.config.scope, scope.activeSession, sessionLifecycle(scope, scope.activeSession));
  const opened = reduceWorkbenchLayout(created, { kind: 'open_tab', tab: setupTab() });
  scope.layouts.set(key, opened);
  return opened;
}

function storeLayout(scope: ScopeState, layout: WorkbenchLayout): void {
  scope.layouts.set(conversationKey(layout.session), layout);
}

/** Re-bind the active layout to the current scope/session/read-only fact without
 * discarding its tabs or drafts. */
function syncActiveLayout(scope: ScopeState): WorkbenchLayout {
  const layout = activeLayout(scope);
  const readOnly = sessionLifecycle(scope, scope.activeSession) === 'archived';
  if (layout.scope === scope.config.scope && layout.session === scope.activeSession && layout.readOnly === readOnly) return layout;
  const bound: WorkbenchLayout = { ...layout, scope: scope.config.scope, session: scope.activeSession, readOnly };
  storeLayout(scope, bound);
  return bound;
}

function openTab(scope: ScopeState, tab: WorkbenchTab): void {
  storeLayout(scope, reduceWorkbenchLayout(syncActiveLayout(scope), { kind: 'open_tab', tab }));
}

/** Open a tab into the exact conversation captured before an await; a late
 * response can never mount into whichever Session is selected later. */
function openTabInto(scope: ScopeState, session: SessionRef | null, tab: WorkbenchTab): void {
  const key = conversationKey(session);
  const existing = scope.layouts.get(key);
  const base = existing ?? createWorkbenchLayout(scope.config.scope, session, sessionLifecycle(scope, session));
  storeLayout(scope, reduceWorkbenchLayout(base, { kind: 'open_tab', tab }));
}

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

function auxToolbar(): string {
  // The hide/expand controls live in the auxiliary tab strip while it is shown;
  // only the restore control stays in the center when the auxiliary area is gone.
  if (view.auxVisible) return '';
  return `<div class="buttons wb-toolbar"><button data-action="toggle-aux">显示辅助区</button></div>`;
}

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

function renderNav(): string {
  const current = state();
  const roles = sessionRolesForScope(current.config.scope);
  const found = current.sessionFind;
  const roleList = roles.length === 0
    ? '<p class="muted">本机没有为当前工作区提供可信角色引用。</p>'
    : `<ul class="roles">${roles.map(entry =>
        `<li>${escapeHtml(entry.label)} · ${escapeHtml(roleLabel(entry.role))}</li>`).join('')}</ul>`;
  const items = found === null || found.status !== 'ready'
    ? '<li class="muted">尚未读取会话目录（点击“查看会话”）。</li>'
    : (found.value.items.length === 0
      ? '<li class="muted">当前筛选没有会话</li>'
      : found.value.items.map(card => {
          const record = card.record;
          const ref = { projectId: record.ref.projectId, sessionId: record.ref.sessionId };
          const selected = sameSession(current.activeSession, ref);
          return `<li data-session="${escapeHtml(record.ref.sessionId)}"${selected ? ' class="active"' : ''}>`
            + `<button class="link session-pick" data-action="select-session" data-session="${escapeHtml(record.ref.sessionId)}">`
            + `<span class="phase" data-availability="${escapeHtml(card.availability)}">${escapeHtml(AVAILABILITY_LABEL[card.availability])}</span> `
            + `<code>${escapeHtml(record.ref.sessionId)}</code></button>`
            + `<span class="muted"> · ${escapeHtml(record.lifecycle === 'archived' ? '归档' : record.lifecycle)} · ${escapeHtml(roleLabel(record.role))}</span>`
            + `<button class="link" data-action="open-session-tab" data-session="${escapeHtml(record.ref.sessionId)}">辅助页</button>`
            + `</li>`;
        }).join(''));
  return `<section class="panel nav" data-view="nav"><h3>项目 / Agent</h3>`
    + `<details class="roles-details"><summary>角色说明（默认收起）</summary>${roleList}</details>`
    + `<div class="buttons">`
      + actionButton('find-sessions', '查看会话', true, '')
      + actionButton('next-sessions', '下一页', found !== null && found.status === 'ready' && found.value.nextCursor !== null, '没有更多会话')
      + actionButton('create-session', '创建会话', roles.length > 0, '本机没有为当前工作区提供可信角色引用')
      + actionButton('read-runtime-capabilities', 'Runtime 能力', true, '')
    + `</div>`
    + `<label class="inline"><input type="checkbox" data-action="toggle-archived"${current.sessionIncludeArchived ? ' checked' : ''}> 包含归档会话</label>`
    + `<p class="muted">可用性来自会话自身状态；尚未读取时保持未知。</p>`
    + `<ul class="session-list">${items}</ul></section>`;
}

// --- Center: original Session conversation ------------------------------------

function renderConversation(): string {
  const current = state();
  syncActiveLayout(current);
  const active = current.activeSession;
  if (active === null) {
    return `<section class="conversation" data-view="project-chat"><header class="conversation-head">`
      + `<h3>项目主对话</h3>`
      + `<p class="muted">${escapeHtml(current.config.name)} · ${escapeHtml(current.config.scope.projectId)}/${escapeHtml(current.config.scope.workspaceId)}</p>`
      + `<p class="muted">这是项目级对话。请从左侧选择会话，查看原历史与平台消息。</p>`
      + auxToolbar() + `</header>`
      + `<p class="muted">初始化项目、目标与计划请在右侧“项目 / 计划”辅助页完成。</p></section>`;
  }
  const read = current.sessionRead !== null && sameSession(current.sessionRead.session, active) ? current.sessionRead : null;
  const centerKey = centerSessionHistoryKey(active);
  const storedCenter = current.sessionHistories.get(centerKey) ?? null;
  const history = storedCenter !== null && sameSession(storedCenter.session, active) ? storedCenter : null;
  const inbox = current.inbox !== null && sameSession(current.inbox.session, active) ? current.inbox : null;
  const message = current.activeMessage !== null && current.message !== null
    && sameSession(current.message.session, active) && sameMessage(current.message.messageRef, current.activeMessage)
    ? current.message : null;
  const body = current.activeMessage !== null && current.messageBody !== null
    && sameSession(current.messageBody.session, active) && sameMessage(current.messageBody.messageRef, current.activeMessage)
    ? current.messageBody : null;
  const lifecycle = sessionLifecycle(current, active);
  const availability = read !== null && read.result.status === 'ready' ? AVAILABILITY_LABEL[read.result.value.availability] : '可用性未知';
  const timeline = history === null
    ? renderGap('sessions/history', '尚未读取完整会话原历史；点击“查看历史”按原序读取。')
    : `<h4>完整会话原历史</h4>` + renderSessionHistoryTimeline(history.result);
  const inboxHtml = inbox === null
    ? renderGap('messages/inbox', '尚未读取收件箱')
    : renderInbox(inbox.result)
      + `<div class="buttons">${actionButton('next-inbox', '下一页消息', inbox.result.status === 'ready' && inbox.result.value.nextCursor !== null, '没有更多消息')}</div>`;
  return `<section class="conversation" data-view="session-conversation" data-session="${escapeHtml(active.sessionId)}">`
    + `<header class="conversation-head"><h3>会话 <code>${escapeHtml(active.sessionId)}</code></h3>`
    + `<p class="muted">${escapeHtml(lifecycle ?? '登记状态未知')} · ${escapeHtml(availability)}`
    + (read !== null && read.result.status === 'ready'
      ? ` · 健康 ${escapeHtml(read.result.value.record.health)} · 角色 ${escapeHtml(roleLabel(read.result.value.record.role))}` : '')
    + `</p><div class="buttons">`
    + actionButton('read-session-history', '查看历史', true, '')
    + actionButton('next-session-history', '下一页历史', history !== null && history.result.status === 'ready' && history.result.value.nextCursor !== null, '没有更多历史')
    + actionButton('read-inbox', '查看收件箱', true, '')
    + actionButton('refresh-session', '刷新详情', true, '')
    + `</div>${auxToolbar()}</header>`
    + (read === null ? renderGap('sessions/read', '尚未读取会话详情') : renderSessionDetail(read.result))
    + `<div class="conversation-body">${timeline}`
    + (message === null ? '' : renderMessage(message.result))
    + (body === null ? '' : renderMessageBody(body.result))
    + inboxHtml + `</div></section>`;
}

function renderComposer(): string {
  const current = state();
  const layout = syncActiveLayout(current);
  const active = current.activeSession;
  if (layout.readOnly) {
    return `<section class="composer" data-view="composer" data-readonly="true">`
      + `<p class="muted">归档会话只读：可浏览历史与文件，但不能编辑草稿、加入可发送引用或发送消息。</p></section>`;
  }
  const references = layout.composerDraft.references;
  const referenceList = references.length === 0
    ? '<p class="muted">尚未加入引用；加入引用只改本对话草稿，不会发送。</p>'
    : `<ul class="references">${references.map(reference => reference.kind === 'selection'
      ? `<li data-reference="selection" data-path="${escapeHtml(reference.path)}"><code>${escapeHtml(reference.path)}:L${escapeHtml(reference.startLine)}-L${escapeHtml(reference.endLine)}</code> · ${escapeHtml(reference.source === 'draft_snapshot' ? '草稿快照' : '已读版本')}</li>`
      : `<li data-reference="path" data-path="${escapeHtml(reference.path)}"><code>${escapeHtml(reference.path)}</code></li>`).join('')}</ul>`;
  return `<section class="composer" data-view="composer">`
    + `<label class="composer-label">对话草稿`
    + `<textarea data-field="composerText" rows="2" placeholder="输入平台消息；加入引用不会自动发送或保存">${escapeHtml(layout.composerDraft.text)}</textarea></label>`
    + `<div class="buttons">`
    + (active === null
      ? `<button data-action="noop" disabled title="项目级模型发送尚不可用">模型发送不可用</button>`
      : actionButton('send-message', '发送平台消息', true, ''))
    + `<button data-action="clear-composer">清空草稿</button>`
    + `</div>${referenceList}`
    + `<p class="muted">平台消息发送可用；文件保存与模型发送尚不可用。</p></section>`;
}

// --- Right: multi-tab auxiliary workspace -------------------------------------

function renderTabs(): string {
  const layout = syncActiveLayout(state());
  return `<section class="workbench-tabs" data-view="workbench-tabs">`
    + `<div class="buttons wb-toolbar">`
    + `<button data-action="toggle-aux">隐藏辅助区</button>`
    + `<button data-action="expand-aux" aria-pressed="${String(view.auxExpanded)}">${view.auxExpanded ? '恢复宽度' : '放大辅助区'}</button>`
    + `</div>${renderWorkbenchLayout(layout)}</section>`;
}

function renderTabBody(): string {
  const layout = syncActiveLayout(state());
  const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
  if (tab === undefined) return '<p class="muted">没有打开的辅助页。点击“＋ 辅助页”打开项目 / 计划页。</p>';
  switch (tab.kind) {
    case 'setup': return renderSetupTab();
    case 'project_chat': return '<p class="muted">项目主对话显示在中间栏。</p>';
    case 'session_chat': return renderSessionTab(tab);
    case 'history': return renderHistoryTab(tab);
    case 'execution_history': return renderExecutionHistoryTab(tab);
    case 'file': return renderFileTab(layout, tab);
    case 'directory': return renderDirectoryTab(layout, tab);
    case 'task_graph': return renderTaskTab(tab);
    case 'architecture_graph': return renderArchitectureTab(tab);
    case 'task_detail': return renderTaskDetailTab(tab);
    case 'module_detail': return renderModuleDetailTab(tab);
  }
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
    + `</div>`;
}

function renderSessionTab(tab: Extract<WorkbenchTab, { kind: 'session_chat' }>): string {
  const current = state();
  const read = current.sessionRead !== null && sameSession(current.sessionRead.session, tab.session) ? current.sessionRead : null;
  const key = tabSessionHistoryKey(conversationKey(current.activeSession), tab.tabId, tab.session);
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
  const key = tabSessionHistoryKey(conversationKey(current.activeSession), tab.tabId, tab.session);
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
  const key = executionPageKey(conversationKey(current.activeSession), tab.tabId);
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
  const file = tab.file;
  const draft = tab.editorDraft;
  const text = draft === null ? file.content : draft.text;
  const changed = draft !== null && draft.text !== file.content;
  // A capture/git read version is immutable: it is shown read-only and is never
  // presented as an edited buffer. References may still cite that exact version.
  const workingTree = file.version.kind === 'working_tree';
  const editable = !layout.readOnly && workingTree;
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
    + `</div></section>`;
}

function renderDirectoryTab(layout: WorkbenchLayout, tab: Extract<WorkbenchTab, { kind: 'directory' }>): string {
  const current = state();
  const page = current.sourcePage;
  const prefix = tab.path;
  const items = page === null ? [] : page.items.filter(item => {
    const rawPath = record(record(item).file).path;
    const path = typeof rawPath === 'string' ? rawPath : '';
    if (prefix.length === 0) return true;
    return path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
  });
  const rows = items.map(item => {
    const rawPath = record(record(item).file).path;
    const path = typeof rawPath === 'string' ? rawPath : '';
    return `<li data-path="${escapeHtml(path)}"><code>${escapeHtml(path)}</code>`
      + `<button class="link" data-action="open-file" data-path="${escapeHtml(path)}">打开文件</button>`
      + `<button class="link" data-action="add-path-reference" data-path="${escapeHtml(path)}"${layout.readOnly ? ' disabled' : ''}>加入引用</button></li>`;
  }).join('');
  return `<section class="panel directory-page" data-view="directory-page" data-path="${escapeHtml(prefix)}">`
    + `<header><h3>目录 ${escapeHtml(prefix.length === 0 ? '/' : prefix)}</h3>`
    + `<p class="muted">来自已捕获来源的路径投影；打开页面不会自动捕获，浏览文件不写入磁盘。</p></header>`
    + `<div class="buttons">`
      + actionButton('capture-source', '捕获来源', true, '')
      + actionButton('query-paths', '列出文件', current.capture !== null, '需要先捕获来源')
      + actionButton('query-next', '下一页', current.sourcePage !== null && current.sourcePage.nextCursor !== null, '没有更多了')
    + `</div>`
    + (current.capture === null ? '<p class="muted">来源尚未捕获；浏览不会自动捕获。</p>' : '')
    + (page === null ? '<p class="muted">尚未列出路径</p>' : `<ul class="paths">${rows}</ul>`)
    + `</section>`;
}

function renderTaskTab(tab: Extract<WorkbenchTab, { kind: 'task_graph' }>): string {
  const current = state();
  const matches = current.taskGraphGoalId === tab.goal.goalId && current.taskGraph !== null;
  return `<section class="panel" data-view="task-graph" data-goal="${escapeHtml(tab.goal.goalId)}">`
    + `<header><h3>任务结构</h3><p>目标 <code>${escapeHtml(tab.goal.goalId)}</code> · 项目 <code>${escapeHtml(tab.goal.projectId)}</code></p></header>`
    + `<div class="buttons"><button data-action="query-task-tab">查询此目标的任务图</button></div>`
    + (matches
      ? renderTaskStructure(current.taskGraph as never, tab.display)
        + `<div class="graph-selection-slot" data-graph-selection>${renderGraphSelectionPanel(tab.display)}</div>`
      : renderGap('tasks/query', '该目标的任务图尚未读取'))
    + `</section>`;
}

function renderArchitectureTab(tab: Extract<WorkbenchTab, { kind: 'architecture_graph' }>): string {
  const current = state();
  const key = architectureSelectionKey(tab.selection);
  const selectionLabel = tab.selection.kind === 'current' ? '当前采用' : `${tab.selection.ref.baselineId}@${tab.selection.ref.revision}`;
  let adopted: unknown = null;
  if (current.architectureReadSelection === key && current.architectureRead !== null) adopted = current.architectureRead;
  else if (tab.selection.kind === 'current' && current.adopted !== null) adopted = { status: 'ready', value: current.adopted };
  return `<section class="panel" data-view="architecture-graph" data-selection="${escapeHtml(key)}">`
    + `<header><h3>架构图</h3><p>选择 <code>${escapeHtml(selectionLabel)}</code>；采用图与观察图分开显示。</p></header>`
    + `<div class="buttons">`
      + `<button data-action="read-architecture-tab">读取此选择</button>`
      + actionButton('capture-observed', '捕获观察结构', current.project !== null && current.workspace !== null && current.adopted !== null, '需要先采用初始架构')
      + actionButton('query-observed', '查看观察结构', current.observedCapture !== null, '需要先捕获观察结构')
    + `</div>`
    + (adopted === null ? renderGap('architecture/read', '该选择尚未读取') : renderAdoptedGraph(adopted as never, tab.display))
    + (current.observed === null ? renderGap('architecture/query', '尚未查询观察结构') : renderObservedGraph(current.observed as never, tab.display))
    + ((adopted === null && current.observed === null) ? ''
      : `<div class="graph-selection-slot" data-graph-selection>${renderGraphSelectionPanel(tab.display)}</div>`)
    + `</section>`;
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
    + `<p class="muted">paths: ${escapeHtml(list(module.paths).map(String).join(', '))}</p>`
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

/** In-place graph node detail: shown under the same graph tab, never replacing
 * or closing it. Selection carries the exact real ref; "在新页打开" is the only
 * action that creates a task_detail/module_detail tab. */
function renderGraphSelectionPanel(display: WorkbenchGraphDisplay | undefined): string {
  const selected = display?.selected ?? null;
  if (selected === null) {
    return '<p class="muted">单击节点或键盘聚焦后按 Enter 选择，详情显示在本图页；双击/右键或“固定完整标签”按钮切换完整标签显示。</p>';
  }
  const isPinned = (display?.pinned ?? []).includes(selected.nodeId);
  const pinButton = `<button data-action="toggle-pin-selected">${isPinned ? '取消固定完整标签' : '固定完整标签'}</button>`;
  if (selected.kind === 'observed') {
    return `<section class="panel" data-view="graph-selection" data-selected-node="${escapeHtml(selected.nodeId)}">`
      + `<h4>选中节点 <code>${escapeHtml(selected.nodeId)}</code></h4>`
      + `<p>${escapeHtml(selected.label)}</p><p class="muted">${escapeHtml(selected.detail)}</p>`
      + `<p class="muted">观察节点没有正式 Task/Module 引用，不提供新页详情。</p>`
      + `<div class="buttons">${pinButton}</div></section>`;
  }
  if (selected.kind === 'task') {
    const ref = selected.target.ref;
    return `<section class="panel" data-view="graph-selection" data-selected-node="${escapeHtml(selected.nodeId)}">`
      + `<h4>选中节点 <code>${escapeHtml(selected.nodeId)}</code></h4>`
      + taskFactsHtml(ref)
      + `<div class="buttons">${pinButton}`
      + `<button data-action="open-task-detail" data-project-id="${escapeHtml(ref.projectId)}"`
      + ` data-goal-id="${escapeHtml(ref.goalId)}" data-task-id="${escapeHtml(ref.taskId)}">在新页打开</button></div>`
      + renderWorkLinkTarget(selected.target) + renderRelatedSessionsBlock(selected.target)
      + `</section>`;
  }
  const ref = selected.target.ref;
  return `<section class="panel" data-view="graph-selection" data-selected-node="${escapeHtml(selected.nodeId)}">`
    + `<h4>选中节点 <code>${escapeHtml(selected.nodeId)}</code></h4>`
    + moduleFactsHtml(ref)
    + `<div class="buttons">${pinButton}`
    + `<button data-action="open-module-detail" data-project-id="${escapeHtml(ref.projectId)}"`
    + ` data-module-id="${escapeHtml(ref.moduleId)}">在新页打开</button></div>`
    + renderWorkLinkTarget(selected.target) + renderRelatedSessionsBlock(selected.target)
    + `</section>`;
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
  if (current.notice !== null) parts.push(`<p class="notice">${escapeHtml(current.notice)}</p>`);
  if (current.error !== null) parts.push(`<p class="error">${escapeHtml(current.error)}</p>`);
  if (current.conflict !== null) {
    parts.push(`<section class="panel rejected" data-view="conflict">`
      + `<p>版本冲突：操作未完成，提交的版本与当前版本不一致。请核对后重新操作，或采用返回的当前版本。</p>`
      + detailsBlock('查看当前版本', `<pre>${escapeHtml(JSON.stringify(current.conflict.current, null, 2))}</pre>`)
      + `<div class="buttons"><button data-action="rebuild-conflict">采用返回的当前版本</button></div></section>`);
  }
  if (current.sending) {
    parts.push('<p class="notice">正在发送…</p>');
  } else if (current.pending !== null) {
    // The attempt is unconfirmed; the exact original request is kept for an
    // explicit retry and is never replayed automatically.
    parts.push(`<section class="panel pending-line" data-view="pending">`
      + `<p>${escapeHtml(routeLabel(current.pending.route))}：结果尚未确认，原请求已保留。</p>`
      + `<div class="buttons"><button data-action="retry">重新发送原请求</button></div>`
      + detailsBlock('查看原请求', `<pre>${escapeHtml(JSON.stringify(current.pending.body, null, 2))}</pre>`)
      + `</section>`);
  }
  if (current.lastResponse !== null) parts.push(renderLastResult(current.lastResponse));
  if (current.lastRequest !== null) {
    parts.push(`<details class="details last-replay" data-view="replay"><summary>重放上一次请求（同一请求标识）</summary>`
      + `<p>用同一请求标识重放上一次提交；若已成功会返回原回执。</p>`
      + detailsBlock('查看原请求', `<pre>${escapeHtml(JSON.stringify(current.lastRequest.body, null, 2))}</pre>`)
      + `<div class="buttons"><button data-action="replay">重放原请求</button></div></details>`);
  }
  if (parts.length === 0) parts.push('<p class="muted">操作结果会显示在这里。</p>');
  return `<div class="last">${parts.join('')}</div>`;
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
    positions.set(element.dataset.scroll ?? '', element.scrollTop);
  }
  return positions;
}

function restoreScroll(positions: Map<string, number>): void {
  for (const [key, value] of positions) {
    const element = document.querySelector<HTMLElement>(`[data-scroll="${key}"]`);
    if (element !== null) element.scrollTop = value;
  }
}

/** Apply the display-only splitter widths and the auxiliary hidden/expanded
 * state without rebuilding any panel or issuing a request. */
function applyWorkbenchLayout(): void {
  const workbench = document.getElementById('workbench');
  if (workbench === null) return;
  workbench.style.setProperty('--wb-left', `${view.leftWidth}px`);
  workbench.style.setProperty('--wb-right', `${view.rightWidth}px`);
  workbench.classList.toggle('aux-hidden', !view.auxVisible);
  workbench.classList.toggle('aux-expanded', view.auxExpanded);
  for (const splitter of document.querySelectorAll<HTMLElement>('[data-splitter]')) {
    const side = splitter.dataset.splitter === 'left' ? 'left' : 'right';
    splitter.setAttribute('aria-valuenow', String(side === 'left' ? view.leftWidth : view.rightWidth));
    splitter.setAttribute('aria-valuemin', String(side === 'left' ? AUX_MIN_LEFT : AUX_MIN_RIGHT));
  }
}

/** Full render that keeps the focused input and each scroll container's
 * position, so a response never drops the draft the user is typing. */
function renderAll(): void {
  if (bootstrapState === null) return;
  const current = states.get(selectedKey);
  captureRenderedTab();
  const focus = captureFocus();
  const scroll = captureScroll();
  setHtml('region-scope', renderScope());
  setHtml('region-nav', renderNav());
  setHtml('region-conversation', renderConversation());
  setHtml('region-composer', renderComposer());
  setHtml('region-tabs', renderTabs());
  setHtml('region-tab-body', renderTabBody());
  setHtml('region-last', renderLastPanel());
  applyWorkbenchLayout();
  restoreScroll(scroll);
  if (current !== undefined) {
    const layout = activeLayout(current);
    const key = tabKey(current, layout.session, layout.activeTabId);
    restoreTabDisplay(key);
    renderedTabKey = key;
  }
  restoreFocus(focus);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function buildShell(): void {
  if (app === null) return;
  app.innerHTML = `<div class="workbench-root">`
    + `<div class="workbench" id="workbench">`
    + `<div class="wb-col wb-left"><div class="wb-scroll" id="region-scope" data-scroll="scope"></div>`
    + `<div class="wb-scroll" id="region-nav" data-scroll="nav"></div></div>`
    + `<div class="splitter" id="splitter-left" role="separator" aria-orientation="vertical" tabindex="0" aria-label="调整左栏宽度" data-splitter="left"></div>`
    + `<div class="wb-col wb-center"><div class="wb-scroll" id="region-conversation" data-scroll="conversation"></div>`
    + `<div class="wb-composer" id="region-composer"></div></div>`
    + `<div class="splitter" id="splitter-right" role="separator" aria-orientation="vertical" tabindex="0" aria-label="调整右栏宽度" data-splitter="right"></div>`
    + `<div class="wb-col wb-right"><div id="region-tabs"></div>`
    + `<div class="wb-scroll" id="region-tab-body"></div></div>`
    + `</div>`
    + `<div class="wb-status" id="region-last"></div>`
    + `</div>`;
  applyWorkbenchLayout();
}

function createState(config: BootstrapWorkspace): ScopeState {
  return {
    key: scopeKey(config.scope),
    config,
    project: null, workspace: null, policyInstall: null, policyActive: null,
    goal: null, adopted: null, proposal: null, plan: null,
    observedCapture: null, goalRead: null, proposalRead: null, architectureRead: null,
    taskGraph: null, observed: null, capture: null, sourcePage: null, file: null,
    sessionFind: null, sessionRead: null, sessionCreateReceipt: null, sessionOperationRead: null,
    runtimeCapabilities: null, inbox: null, message: null, messageBody: null,
    sessionHistories: new Map(), executionHistories: new Map(), executionReads: new Map(),
    activeSession: null, activeMessage: null,
    layouts: new Map(), sessionIncludeArchived: false, architectureReadSelection: '',
    taskGraphGoalId: '', relatedSessions: null,
    executionProfileId: null, executionNotice: null,
    execution: createExecutionRun(),
    forms: {
      projectId: config.scope.projectId, goalId: '', objective: '', filePath: '',
      proposalId: '', baselineId: '', baselineRevision: '1', provider: 'text', prefix: '',
      policyIndex: '0', architectureIndex: '0', planIndex: '0', readVersion: 'working_tree',
      archSelection: 'current', sessionRoleIndex: '0', messageText: '', question: '',
    },
    sending: false, pending: null, lastRequest: null, lastResponse: null, conflict: null, notice: null, error: null,
  };
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

function onField(field: string, value: string): void {
  const current = states.get(selectedKey);
  if (current === undefined) return;
  if (field in current.forms) current.forms[field as keyof Forms] = value;
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
  const selected = next.tabs.find(candidate => candidate.tabId === tab.tabId);
  applyGraphSelectionInPlace(selected !== undefined
    && (selected.kind === 'task_graph' || selected.kind === 'architecture_graph') ? selected.display : undefined);
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
function applyGraphSelectionInPlace(display: WorkbenchGraphDisplay | undefined): void {
  const body = document.getElementById('region-tab-body');
  if (body === null) return;
  const selectedId = display?.selected?.nodeId ?? '';
  const pinned = new Set(display?.pinned ?? []);
  for (const node of body.querySelectorAll('.graph-node')) {
    const nodeId = node.getAttribute('data-node') ?? '';
    node.classList.toggle('selected', selectedId.length > 0 && nodeId === selectedId);
    node.setAttribute('aria-pressed', String(pinned.has(nodeId)));
  }
  const slot = body.querySelector<HTMLElement>('[data-graph-selection]');
  if (slot !== null) slot.innerHTML = renderGraphSelectionPanel(display);
}

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
    if (action === 'select-node' && element.classList.contains('graph-node')) {
      selectGraphNode(state(), element);
      return;
    }
    void handleAction(action, element);
  });

  // Keyboard equivalent for non-button controls (e.g. the tab close affordance).
  document.addEventListener('keydown', event => {
    const target = event.target as HTMLElement | null;
    const element = target?.closest<HTMLElement>('[data-action]') ?? null;
    if (element === null || element instanceof HTMLButtonElement || element instanceof HTMLInputElement
      || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) return;
    if ((event.key === 'p' || event.key === 'P') && element.classList.contains('graph-node')) {
      event.preventDefault();
      void handleAction('toggle-pin', element);
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const action = element.dataset.action ?? '';
    if (action === '' || action === 'noop') return;
    event.preventDefault();
    void handleAction(action, element);
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
      const status = document.querySelector<HTMLElement>('[data-draft-state]');
      if (status !== null) status.textContent = '草稿快照（未保存，仅本页内存）';
      return;
    }
    onField(field, element.value);
  });

  document.addEventListener('change', event => {
    const element = event.target;
    if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) return;
    const current = states.get(selectedKey);
    if (current === undefined) return;
    if (element.dataset.action === 'select-scope') {
      if (states.has(element.value)) { selectedKey = element.value; renderAll(); }
      return;
    }
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
    // Only the architecture-range selector reveals dependent inputs; refresh the
    // auxiliary body without touching the conversation or the composer draft.
    if (field === 'archSelection') setHtml('region-tab-body', renderTabBody());
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !view.auxExpanded) return;
    event.preventDefault();
    view.auxExpanded = false;
    applyWorkbenchLayout();
    const current = states.get(selectedKey);
    if (current !== undefined) renderScopeIfSelected(current);
  });

  const graphNodeTarget = (event: Event): HTMLElement | null => {
    const target = event.target as Element | null;
    const element = target?.closest('[data-action]') as HTMLElement | null;
    return element !== null && element.classList.contains('graph-node') ? element : null;
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
    void handleAction('toggle-pin', element);
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

async function main(): Promise<void> {
  if (app === null) return;
  if (token.length === 0) { fatal('无法连接到本地服务：页面缺少连接信息，请刷新页面。'); return; }
  const bootstrap = await fetchBootstrap();
  if (bootstrap === null) return;
  bootstrapState = bootstrap;
  for (const workspace of bootstrap.workspaces) states.set(scopeKey(workspace.scope), createState(workspace));
  const first = bootstrap.workspaces[0];
  if (first === undefined) { fatal('没有可展示的工作区。'); return; }
  selectedKey = scopeKey(first.scope);
  buildShell();
  attachHandlers();
  renderAll();
}

void main();
