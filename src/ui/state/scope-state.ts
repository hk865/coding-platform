/** Per-scope workbench state types: DTO value aliases, forms, execution and setup runs, and ScopeState. */

import type {
  ArchitectureAdoptInitialResponse,
  BootstrapExecutionQueryProfile,
  BootstrapWorkspace,
  CommandsReadResponse,
  CompletionPoliciesActivateResponse,
  CompletionPoliciesInstallResponse,
  CoreRouteSuffix,
  CoreScope,
  ExecutionsReadResponse,
  FilesCompareResponse,
  FilesReadResponse,
  FilesSaveResponse,
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
  QueriesSubmitBody,
  QueryJobRef,
  QueryRunRef,
  RunRef,
  RuntimeCapabilitiesResponse,
  SessionRecord,
  SessionRef,
  SessionsCreateResponse,
  SessionsFindResponse,
  SessionsHistoryResponse,
  SessionsOperationResponse,
  SessionsReadResponse,
  SourceCaptureResponse,
  SourceQueryResponse,
  TaskExecutionRecord,
  TaskGraph,
  WorkbenchCommandState,
  WorkflowAdvanceBody,
  WorkflowAdvanceResult,
  WorkflowConsultationBody,
  WorkflowConsultationResponse,
  WorkflowDriverReadResponse,
  WorkflowGoalInputBody,
  WorkspacesRegisterResponse,
  WorkspacesRegistrationResponse,
} from '../../app/core-http-types.js';
import type { CallOutcome } from '../api/http.js';
import type { PollHandle } from '../api/refresh.js';
import type { RequestTags } from '../api/request-tags.js';
import type { WorkLinkTarget, WorkbenchDraft, WorkbenchTab } from './layout.js';
import { scopeKey } from './values.js';
import type { GoalConversationStartController, ResumableOriginalRun } from '../views/conversation/goal-start.js';
import type { ProjectReadState } from '../views/conversation/project-render.js';
import type { DirectoryInventoryState } from '../views/files/directory.js';
import type { ArchitectureContainmentDisplay } from '../views/graphs/architecture.js';
import type { WorkbenchExecutionHistoryPage } from '../views/history/timeline.js';
import type { TaskTimelineDisplay } from '../views/observe/render.js';

type CommittedOf<T> = Extract<T, { status: 'committed' }>;
type ReadyOf<T> = Extract<T, { status: 'ready' }>;
export type MessageRefValue = ReadyOf<MessagesReadResponse>['value']['ref'];
export type ConsultationInputValue = WorkflowConsultationBody['input'];

export type ProjectValue = CommittedOf<ProjectsCreateResponse>['value'];
export type WorkspaceValue = CommittedOf<WorkspacesRegisterResponse>['value'];
export type PolicyInstallValue = CommittedOf<CompletionPoliciesInstallResponse>['value'];
export type PolicyActiveValue = CommittedOf<CompletionPoliciesActivateResponse>['value'];
export type GoalValue = CommittedOf<GoalsCreateResponse>['value'];
export type AdoptValue = CommittedOf<ArchitectureAdoptInitialResponse>['value'];
export type ProposalValue = CommittedOf<PlansProposeResponse>['value'];
export type PlanValue = CommittedOf<PlansApplyResponse>['value'];
export type CaptureValue = ReadyOf<SourceCaptureResponse>['value'];
export type SourcePageValue = ReadyOf<SourceQueryResponse>['value'];
export type FileValue = ReadyOf<FilesReadResponse>['value'];
// The browser may only consume the type-only Host HTTP DTO, so these aliases
// derive the exact owner input shapes from the exported route bodies instead of
// importing the business/contract modules directly.
export type QueryJobIntentV1 = QueriesSubmitBody['request']['input']['intent'];
export type QueryJobAnswerRef = QueriesAnswerBody['input'];
export type WorkflowAdvanceInput = WorkflowAdvanceBody['input'];
type InitialPlanningGoalInput = Extract<WorkflowGoalInputBody['input'], { kind: 'planning_answer' | 'adopt_initial_plan' }>;
export type PlanningAnswerInput = Extract<InitialPlanningGoalInput, { kind: 'planning_answer' }>;
export type AdoptInitialPlanInput = Extract<InitialPlanningGoalInput, { kind: 'adopt_initial_plan' }>;

export type Forms = {
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
export type SessionAggregateRef = SessionRecord['ref'];

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
export type ExecutionIntent =
  | { route: 'workflow/goal-input'; input: InitialPlanningGoalInput }
  | { route: 'workflow/advance'; input: WorkflowAdvanceInput };

export type ExecutionDriver = (scope: ScopeState, run: ExecutionRun) => Promise<void>;

/** R6 execution-entry display/consumer state. It holds only the exact requests
 * this page actually sent and the owner results it received. It is not a second
 * Workflow/Query owner: the next public request comes from the frozen
 * continuation seam and a null `next` is a real stop. Every identity is fixed
 * before the first await; later navigation never rewrites an in-flight run. */
export type ExecutionRun = {
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

export function createExecutionRun(): ExecutionRun {
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
export type GoalSetupRun = {
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
  poll: PollHandle | null;
  stopping: boolean;
};

/** The bounded real Run page shared by the timeline, the Task fold and the
 * execution-backed active-module computation. It is a read cache only. */
export type ExecutionListCache = {
  goalRef: TaskGraph['plan']['goalRef'];
  items: TaskExecutionRecord[];
  nextCursor: string | null;
  readThrough: unknown;
  loading: boolean;
  error: string | null;
};

/** The exact one-shot member mail this page saved and then consulted, keyed by
 * the original Session + message ref. Display state only. */
export type MemberMailState = {
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

export type ScopeState = {
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
  collaborationPoll: PollHandle | null;
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

export type InitialPlanProposalRef = {
  aggregateType: 'PlanProposal';
  projectId: string;
  workspaceId: string;
  proposalId: string;
};

export type InitialPlanSetupCandidate = {
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

/** A new ScopeState for one bootstrap workspace. `attach` builds the scope's own
 * goal-conversation controller once the scope object exists. */
export function createScopeState(config: BootstrapWorkspace, attach: (scope: ScopeState) => GoalConversationStartController): ScopeState {
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
  scope.goalConversation = attach(scope);
  return scope;
}
