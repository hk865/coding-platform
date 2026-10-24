/**
 * R6.1a fixed HTTP JSON contract for the local Host and thin workbench.
 *
 * Every request/response alias is DERIVED from the existing public port types;
 * this file never restates a domain shape and never imports a service
 * implementation. The browser consumes these types with `import type` only, so
 * the composition root and core implementations never enter the UI bundle.
 *
 * Absolute rules encoded by the shapes below:
 *   - the request carries `scope` plus either `{input}` (plain read/action) or
 *     `{request:{input,meta}}` (GraphWrite); it never carries ctx/actor/root;
 *   - `AbortSignal` and every internal handle stay out of the JSON DTO.
 */
import type { ActorRef } from '../contracts/command-event.js';
import type { CoreCallContext } from '../contracts/core/call-context.js';
import type { RoleConfigurationRef } from '../contracts/core/identity.js';
import type { RuntimeExecutionPort } from '../core/agent-runtime/ports.js';
import type { ExecutionReadPort } from '../core/work-graph/model/execution-read-contracts.js';
import type { SessionMailboxPort } from '../core/work-graph/model/communication-contracts.js';
import type { SessionDirectoryPort } from '../core/work-graph/model/session-contracts.js';
// Slice 1 (spec §4.4, §0.2 L5): the owner ports of the eleven new suffixes.
import type { SessionLifecyclePort } from '../core/work-graph/sessions/lifecycle-contracts.js';
import type { SessionFactsPort } from '../core/work-graph/model/session-facts-contracts.js';
import type { SessionResponsibilityPort } from '../core/work-graph/sessions/session-responsibility-service.js';
import type { SessionAnomalyPort } from '../core/work-graph/tasks/session-anomaly-service.js';
// K3 (§2 L7): the read-only UnknownCallReview owner of `unknown-call-reviews/read`.
import type {
  UnknownCallReviewPort, UnknownCallReviewReadPort,
} from '../core/work-graph/model/unknown-call-review-contracts.js';
import type { TaskClaimPort } from '../core/work-graph/model/claim-contracts.js';
import type { AdoptInitialArchitectureInput } from '../core/work-graph/architecture/catalog-contracts.js';
import type { ArchitectureCatalogPort } from '../core/work-graph/architecture/catalog-contracts.js';
import type { ObservedArchitecturePort } from '../core/work-graph/architecture/contracts.js';
import type {
  CompletionPolicyConfigurationPort,
  ProjectRegistrationPort,
} from '../core/work-graph/configuration/project-bootstrap-contracts.js';
import type { GoalTaskPort } from '../core/work-graph/model/task-contracts.js';
import type { PlanTaskPort } from '../core/work-graph/model/plan-contracts.js';
import type {
  DecisionMessagePort,
  DecisionReadPort,
  GoalSettingsPort,
  RequestCandidatePort,
  WorkspaceDecisionSettingsPort,
} from '../core/work-graph/model/decision-contracts.js';
import type { WorkspaceCapturePort, WorkspaceToolsPort } from '../core/workspace/ports.js';
import type { MaterialSourceScope } from '../contracts/material-access.js';
import type { PlanRevisionDraft } from '../contracts/plan.js';
import type { RoleBindingRefV1 } from '../contracts/dispatch.js';
import type { ActivityReadPort } from '../core/work-graph/views/activity-read-model.js';
import type { TrackReadPort } from '../core/work-graph/views/track-read-model.js';
import type { TaskTimelineReadPort } from '../core/work-graph/views/task-state-timeline.js';
import type { QueryJobIntentV1 } from '../contracts/query-job.js';
import type { RuntimeBudget } from '../contracts/runtime-budget.js';
import type { QueryJobPort } from '../core/work-graph/queries/contracts.js';
import type { MaterialPort } from '../core/work-graph/model/material-contracts.js';
import type { WorkflowPort } from '../business/workflow/ports.js';
import type { CollaborationDriverPort } from './collaboration-driver.js';
import type { WorkbenchCommandState, WorkbenchToolsPort } from './workbench-tools.js';
// Slice 2C (spec §2): the line/node-detail owner ports and the Host-assembled
// conversation page. The page DTO is defined HERE (the fixed HTTP JSON contract)
// and the composition module imports it, so the browser and tests read one type.
import type { WorkLineConversationPort } from '../composition/work-line-conversation.js';
import type {
  NodeDetailReadPort, WorkLineReadPort, WorkLineSettingsPort,
} from '../core/work-graph/model/work-line-contracts.js';
// Slice 4C C1.4 (spec §2/L15/L19): the notes and version-list route contracts.
import type { ReadResult, WriteResult } from '../contracts/core/results.js';
import type {
  NoteListRequestV1, NoteListResultV1, NoteMemoryReadResult, WriteNoteEnvelopeV1, NoteWritePort, VersionListPageV1,
} from '../core/work-graph/model/note-contracts.js';
// The three person-only request command routes. Their bodies and results are
// derived from Workflow's `RequestSubmitPort`, never restated here.
import type { RequestSubmitPort } from '../business/workflow/request-intake.js';

/** The project/workspace navigation scope. It is a real domain scope, not a
 * second source of Project/Workspace registration truth. */
export type { AdoptInitialArchitectureInput, ArchitectureRevision, ModuleDefinition } from '../core/work-graph/architecture/catalog-contracts.js';
export type { ObservedArchitectureNeighborhood } from '../core/work-graph/architecture/contracts.js';
export type { CurrentCompletionPolicyRead } from '../core/work-graph/configuration/project-bootstrap-contracts.js';
export type { TaskGraph, TaskRow } from '../core/work-graph/model/plan-contracts.js';
/** A.2 Task read-model and rework shapes (spec §4.1, §9 VD-12, C3), type-only for the UI. */
export type {
  FailingCheckFactV1, NotReworkableCause, RunErrorSource, TaskAutomationStopReason, TaskAutomationVerdictV1,
  TaskFailureFactsV1, TaskPhaseCauseCode, TaskPhaseCauseV1, TaskReworkRefusalFactV1, TaskReworkSummaryEntryV1,
  TaskReworkSummaryV1,
} from '../contracts/task-failure.js';
export type {
  ReworkActorClass, ReworkFailureClass, StopRequester, TaskAutomationPolicyV1, TaskRequeueOutcomeV1, TaskRequeueRef,
  TaskRequeueSnapshotV1, TaskReworkRefusalCode, TaskReworkRefusalRef, TaskReworkRefusalSnapshotV1,
} from '../contracts/task-requeue.js';
export type { NewBasisInputRefV1 } from '../contracts/no-progress.js';
export type { TaskDispositionChangeV1 } from '../contracts/plan.js';
export type { ContinuationBriefV1, SourceChangeVerdictV1 } from '../contracts/continuation-brief.js';
export type { RoundChainV1, RoundCheckIncompleteCause, RoundReverifyFactV1 } from '../contracts/verification.js';
export type { RequeueTaskInput } from '../core/work-graph/model/claim-contracts.js';
/** A.2 step 5.5 Goal control and display shapes (spec §2.1, §2.3), type-only for the UI. */
export type { SetGoalControlInput } from '../core/work-graph/model/task-contracts.js';
export type { GoalDisplayRead, GoalResumePendingRunV1 } from '../core/work-graph/model/plan-contracts.js';
export type {
  GoalDisplayCauseV1, GoalDisplayPhase, GoalDisplayRow, GoalDisplayV1, GoalRunStopStateV1, GoalRunStopV1, GoalStopCauseCode,
} from '../core/work-graph/state/goal-machine.js';
export type {
  GoalControlOutcomeV1, GoalDisplayHostReadV1, GoalFanOutReportV1, GoalFanOutRunResultV1, GoalReentryFailureV1,
  GoalResumeContinuationResultV1,
} from './goal-fan-out-driver.js';
/** A.2 step 5.6: the instance lease and start-up reconcile report, and the attestation inputs (§12, RUN-22, QRR-06). */
export type {
  HostReconcileReportV1, ResolveUnknownQueryRunRequestV1, ResolveUnknownRunRequestV1,
} from './core-routes.js';
export type { ReconcileLine, StartupReconcileReportV1 } from './startup-reconcile.js';
export type { QueryUnknownCauseV1 } from '../contracts/query-job.js';
export type { ReverifyOutcomeV1, ReverifyRoundInput } from '../core/work-graph/model/evidence-contracts.js';
export type { CoreRejection, ReadResult } from '../contracts/core/results.js';
export type { CaptureSummary, SourcePage, WorkspaceFile, WorkspaceResult } from '../core/workspace/ports.js';

export type CoreScope = MaterialSourceScope;

/** Trusted local startup actor. The browser never chooses it. */
export type WorkbenchActor = Extract<ActorRef, { kind: 'human' | 'system' }>;

export const PLATFORM_TOKEN_HEADER = 'x-platform-token';
/** Literal placeholder the static build ships; `server.ts` substitutes it per
 * response and never writes the real token back to disk. */
export const PLATFORM_TOKEN_PLACEHOLDER = '__PLATFORM_TOKEN__';
export const WORKBENCH_PATH = '/workbench/';
export const CORE_API_PREFIX = '/api/real/core/';
export const BOOTSTRAP_SUFFIX = 'bootstrap';
/** `GET ${CORE_API_PREFIX}${CHANGES_SUFFIX}` is the change-notification stream
 * (task E). Like bootstrap it is a GET transport endpoint served by
 * `server.ts`, not a row of the POST route table. */
export const CHANGES_SUFFIX = 'changes';
/** The SSE resume header; its value is the last commit cursor the page saw. */
export const LAST_EVENT_ID_HEADER = 'last-event-id';

/** Body kinds. GraphWrite routes keep the domain `{input,meta}` envelope;
 * `source/capture` is an explicit action but is NOT a GraphWrite, matching the
 * real `WorkspaceCapturePort.captureSourceChanges` parameter. */
export type CoreRouteKind = 'graph_write' | 'plain';

export type CoreRouteSuffix =
  | 'controls/submit' | 'controls/read' | 'controls/deliver' | 'executions/start'
  | 'projects/create'
  | 'workspaces/register'
  | 'completion-policies/install'
  | 'completion-policies/activate'
  | 'completion-policies/read'
  | 'goals/create'
  | 'goals/read'
  | 'architecture/adopt-initial'
  | 'architecture/read'
  | 'architecture/capture'
  | 'architecture/query'
  | 'architecture/compare'
  | 'architecture/compare-formal'
  | 'architecture/impact'
  | 'plans/propose'
  | 'plans/apply'
  | 'plans/proposal'
  | 'tasks/query'
  | 'files/read'
  | 'files/list'
  | 'source/capture'
  | 'source/query'
  | 'sessions/find'
  | 'sessions/read'
  | 'sessions/operation'
  | 'runtime/capabilities'
  | 'sessions/create'
  | 'sessions/history'
  | 'sessions/archive'
  | 'sessions/reactivate'
  | 'sessions/link'
  | 'messages/send'
  | 'messages/inbox'
  | 'messages/read'
  | 'messages/body'
  | 'messages/outbox'
  | 'workspaces/registration'
  | 'queries/submit'
  | 'queries/read'
  | 'queries/claim'
  | 'queries/prepare'
  | 'queries/start'
  | 'queries/observe'
  | 'queries/answer'
  | 'materials/open'
  | 'workflow/goal-input'
  | 'workflow/advance'
  | 'workflow/consultation'
  | 'workflow/driver-start'
  | 'workflow/driver-read'
  | 'workflow/driver-stop'
  | 'executions/read'
  | 'executions/history'
  // MVP UI connection: bounded execution list, narrow project read, Kernel
  // workspace CAS save/compare and the explicit command handles.
  | 'executions/list'
  | 'projects/read'
  | 'files/save'
  | 'files/compare'
  | 'commands/start'
  | 'commands/read'
  | 'commands/stop'
  // A.2 step 5.4 (D-3, C1, C3): the operator requeue/continue and the
  // continuation brief pinned to a requeue Run.
  | 'tasks/requeue'
  | 'executions/brief'
  // A.2 step 5.5 (G7): the Goal pause/resume/cancel with its per-Run fan-out,
  // and the Goal display reduction (GOAL-17..30 with runStops).
  | 'goals/control'
  | 'goals/display'
  // A.2 step 5.6 (RUN-22, QRR-06, L-1): the operator's attestation of an
  // unknown end, only through the Host holding the instance lease; and the
  // Host's own instance lease and start-up reconcile report (§12.1 step 7).
  | 'executions/resolve-unknown'
  | 'queries/resolve-unknown'
  | 'host/reconcile-report'
  // A.2 step 5.9 (C5, VR-14): the operator's "重新检查" (work) / "重新验收"
  // (gate): a successor round of a finalized non-PASS chain head, or its
  // committed policy refusal.
  | 'verification/reverify'
  // Slice 1 (spec §4.4, §0.2 L5): the Session facts, corrections and archive
  // suffixes. `CoreRouteSuffix` is declared ONLY here; `core-routes.ts` adds the
  // table rows, binding types and dispatch cases.
  | 'sessions/archive-line'
  | 'sessions/archive-continue'
  | 'sessions/archive-release'
  | 'sessions/facts'
  | 'sessions/successors'
  | 'sessions/executions'
  | 'sessions/queries'
  | 'sessions/transfer-responsibility'
  | 'tasks/archive-state'
  | 'anomalies/list'
  // K3 (§2 L7, §4): the read-only review lookup, by record ref or original Run.
  | 'unknown-call-reviews/read'
  | 'unknown-call-reviews/list'
  | 'unknown-call-reviews/hold'
  | 'unknown-call-reviews/release-hold'
  | 'messages/undelivered-replies'
  // Slice 3: the two public read-only graph routes.
  | 'graph/look'
  | 'graph/find'
  // Slice 5 §4.5: Goal settings/order/conflicts, per-request candidates, the
  // decision queue/card/answer/application, the notice cursor and the user send.
  | 'goals/settings'
  | 'goals/settings/set'
  | 'goals/reorder'
  | 'goals/conflicts'
  | 'plans/request-candidate'
  | 'plans/abandon'
  | 'decisions/queue'
  | 'decisions/card'
  | 'decisions/answer'
  | 'decisions/application'
  | 'decisions/notices/seen'
  | 'messages/user-send'
  // Slice 2B L15: the five activity/timeline routes. All are `plain`; only the
  // human-only range backfill performs a write (the Workflow operation).
  | 'activity/calendar'
  | 'activity/runs'
  | 'activity/track'
  | 'tasks/timeline'
  | 'activity/backfill'
  // Slice 2C (spec §2, L13): the line reads, the Host conversation page and the
  // two node-detail reads, plus the one graph_write pin route.
  | 'lines/list'
  | 'lines/archived'
  | 'lines/read'
  | 'lines/page'
  | 'lines/pin'
  | 'graph/hover'
  | 'graph/detail'
  // Slice 4C C1.4 (spec §2/L15/L19): the person's notes and the two version lists.
  | 'notes/list'
  | 'notes/write'
  | 'notes/withdraw'
  | 'notes/review'
  | 'plans/versions'
  | 'architecture/versions'
  // L8 (book ruling 8): the one public observation state with computed pending.
  | 'architecture/observation-state'
  // The three person-only request commands.
  | 'requests/submit'
  | 'requests/route'
  | 'requests/select-idea';

type SecondArgument<M> = M extends (ctx: CoreCallContext, argument: infer A) => unknown ? A : never;
type MethodResult<M> = M extends (ctx: CoreCallContext, argument: never) => infer R ? Awaited<R> : never;

/** GraphWrite body: `{scope, request:{input,meta}}`. */
export type GraphWriteBody<M> = { scope: CoreScope; request: SecondArgument<M> };
/** Plain body: `{scope, input}`; `input` is the port's exact second argument. */
export type PlainBody<M> = { scope: CoreScope; input: SecondArgument<M> };
export type RouteResponse<M> = MethodResult<M>;

export type ProjectsCreateBody = GraphWriteBody<ProjectRegistrationPort['createProject']>;
export type ProjectsCreateResponse = RouteResponse<ProjectRegistrationPort['createProject']>;
export type WorkspacesRegisterBody = GraphWriteBody<ProjectRegistrationPort['registerWorkspace']>;
export type WorkspacesRegisterResponse = RouteResponse<ProjectRegistrationPort['registerWorkspace']>;
export type CompletionPoliciesInstallBody = GraphWriteBody<CompletionPolicyConfigurationPort['installCompletionPolicy']>;
export type CompletionPoliciesInstallResponse = RouteResponse<CompletionPolicyConfigurationPort['installCompletionPolicy']>;
export type CompletionPoliciesActivateBody = GraphWriteBody<CompletionPolicyConfigurationPort['activateCompletionPolicy']>;
export type CompletionPoliciesActivateResponse = RouteResponse<CompletionPolicyConfigurationPort['activateCompletionPolicy']>;
export type CompletionPoliciesReadBody = PlainBody<NonNullable<CompletionPolicyConfigurationPort['readCurrentCompletionPolicy']>>;
export type CompletionPoliciesReadResponse = RouteResponse<NonNullable<CompletionPolicyConfigurationPort['readCurrentCompletionPolicy']>>;
export type GoalsCreateBody = GraphWriteBody<GoalTaskPort['createGoal']>;
export type GoalsCreateResponse = RouteResponse<GoalTaskPort['createGoal']>;
export type GoalsReadBody = PlainBody<PlanTaskPort['queryGoal']>;
export type GoalsReadResponse = RouteResponse<PlanTaskPort['queryGoal']>;
export type ArchitectureAdoptInitialBody = GraphWriteBody<ArchitectureCatalogPort['adoptInitialArchitecture']>;
export type ArchitectureAdoptInitialResponse = RouteResponse<ArchitectureCatalogPort['adoptInitialArchitecture']>;
export type ArchitectureReadBody = PlainBody<ArchitectureCatalogPort['readArchitectureRevision']>;
export type ArchitectureReadResponse = RouteResponse<ArchitectureCatalogPort['readArchitectureRevision']>;
/** L8 (P16): the public manual capture body. The driver's trusted start
 * watermark (`requestSeq`) is not a public input, so the DTO omits it; the port
 * keeps accepting it for the driver's direct, non-public owner call. */
export type ArchitectureCaptureBody = {
  scope: CoreScope;
  request: {
    input: Omit<SecondArgument<ObservedArchitecturePort['captureSourceChanges']>['input'], 'requestSeq'>;
    meta: SecondArgument<ObservedArchitecturePort['captureSourceChanges']>['meta'];
  };
};
export type ArchitectureCaptureResponse = RouteResponse<ObservedArchitecturePort['captureSourceChanges']>;
export type ArchitectureQueryBody = PlainBody<ObservedArchitecturePort['queryArchitecture']>;
export type ArchitectureQueryResponse = RouteResponse<ObservedArchitecturePort['queryArchitecture']>;
export type PlansProposeBody = GraphWriteBody<PlanTaskPort['proposePlan']>;
export type PlansProposeResponse = RouteResponse<PlanTaskPort['proposePlan']>;
export type PlansApplyBody = GraphWriteBody<PlanTaskPort['applyPlanChange']>;
export type PlansApplyResponse = RouteResponse<PlanTaskPort['applyPlanChange']>;
export type PlansProposalBody = PlainBody<PlanTaskPort['readPlanProposal']>;
export type PlansProposalResponse = RouteResponse<PlanTaskPort['readPlanProposal']>;
export type TasksQueryBody = PlainBody<PlanTaskPort['queryTaskGraph']>;
export type TasksQueryResponse = RouteResponse<PlanTaskPort['queryTaskGraph']>;
export type FilesReadBody = PlainBody<WorkspaceToolsPort['readWorkspace']>;
export type FilesReadResponse = RouteResponse<WorkspaceToolsPort['readWorkspace']>;
/** `files/list` is the Host workbench-tools bounded directory inventory: it
 * enumerates authorized paths without reading any body, so binary/oversized
 * files do not fail the tree. `files/read` keeps the original text ceiling. */
export type FilesListBody = PlainBody<WorkbenchToolsPort['listFiles']>;
export type FilesListResponse = RouteResponse<WorkbenchToolsPort['listFiles']>;
/** `source/capture` maps to the real `CaptureSourceRequest` and returns a
 * `WorkspaceResult<CaptureSummary>`; it is not wrapped in a GraphWrite. */
export type SourceCaptureBody = PlainBody<WorkspaceCapturePort['captureSourceChanges']>;
export type SourceCaptureResponse = RouteResponse<WorkspaceCapturePort['captureSourceChanges']>;
export type SourceQueryBody = PlainBody<WorkspaceCapturePort['querySource']>;
export type SourceQueryResponse = RouteResponse<WorkspaceCapturePort['querySource']>;

// ---------------------------------------------------------------------------
// R6.1b-1 Session / message / original-history routes.
//
// Every alias below is derived from the exact public port method named in the
// R6.1b table. `sessions/create` is a PLAIN route even though the request
// carries its own `meta`: the real `RuntimeExecutionPort.createSession` second
// argument already includes `meta`, so wrapping it in a GraphWrite envelope
// would change the server protocol. `messages/send` keeps the original
// GraphWrite envelope because that is the real `SessionMailboxPort.sendMessage`
// parameter.
// ---------------------------------------------------------------------------
export type SessionsFindBody = PlainBody<SessionDirectoryPort['findSessions']>;
export type SessionsFindResponse = RouteResponse<SessionDirectoryPort['findSessions']>;
export type SessionsReadBody = PlainBody<SessionDirectoryPort['readSession']>;
export type SessionsReadResponse = RouteResponse<SessionDirectoryPort['readSession']>;
export type SessionsOperationBody = PlainBody<SessionDirectoryPort['getSessionOperation']>;
export type SessionsOperationResponse = RouteResponse<SessionDirectoryPort['getSessionOperation']>;
export type RuntimeCapabilitiesBody = PlainBody<RuntimeExecutionPort['capabilities']>;
export type RuntimeCapabilitiesResponse = RouteResponse<RuntimeExecutionPort['capabilities']>;
export type SessionsCreateBody = PlainBody<RuntimeExecutionPort['createSession']>;
export type SessionsCreateResponse = RouteResponse<RuntimeExecutionPort['createSession']>;
export type SessionsHistoryBody = PlainBody<RuntimeExecutionPort['readSessionHistory']>;
export type SessionsHistoryResponse = RouteResponse<RuntimeExecutionPort['readSessionHistory']>;
export type MessagesSendBody = GraphWriteBody<SessionMailboxPort['sendMessage']>;
export type MessagesSendResponse = RouteResponse<SessionMailboxPort['sendMessage']>;
export type MessagesInboxBody = PlainBody<SessionMailboxPort['readInbox']>;
export type MessagesInboxResponse = RouteResponse<SessionMailboxPort['readInbox']>;
export type MessagesReadBody = PlainBody<SessionMailboxPort['readMessage']>;
export type MessagesReadResponse = RouteResponse<SessionMailboxPort['readMessage']>;
export type MessagesBodyBody = PlainBody<SessionMailboxPort['readMessageBody']>;
export type MessagesBodyResponse = RouteResponse<SessionMailboxPort['readMessageBody']>;
export type MessagesOutboxBody = PlainBody<NonNullable<SessionMailboxPort['readOutbox']>>;
export type MessagesOutboxResponse = RouteResponse<NonNullable<SessionMailboxPort['readOutbox']>>;

// ---------------------------------------------------------------------------
// Slice 5 §4.5 decision routes. Each alias derives from the exact owner method
// named by the frozen route table (`platform.goalSettings`, `platform.decisions`,
// `platform.requestCandidates`, `platform.decisionMessages`,
// `platform.workspaceDecisionSettings`, and the Workflow `resolveDecision`).
// `resolveDecision` stays optional on the port so an old composition keeps
// compiling; the composition root always publishes it.
// ---------------------------------------------------------------------------
export type GoalsSettingsBody = PlainBody<GoalSettingsPort['readGoalSettings']>;
export type GoalsSettingsResponse = RouteResponse<GoalSettingsPort['readGoalSettings']>;
export type GoalsSettingsSetBody = GraphWriteBody<GoalSettingsPort['setGoalSettings']>;
export type GoalsSettingsSetResponse = RouteResponse<GoalSettingsPort['setGoalSettings']>;
export type GoalsReorderBody = GraphWriteBody<GoalSettingsPort['reorderGoals']>;
export type GoalsReorderResponse = RouteResponse<GoalSettingsPort['reorderGoals']>;
export type GoalsConflictsBody = PlainBody<DecisionReadPort['queryGoalConflicts']>;
export type GoalsConflictsResponse = RouteResponse<DecisionReadPort['queryGoalConflicts']>;
export type PlansRequestCandidateBody = PlainBody<RequestCandidatePort['readRequestCandidate']>;
export type PlansRequestCandidateResponse = RouteResponse<RequestCandidatePort['readRequestCandidate']>;
export type PlansAbandonBody = GraphWriteBody<RequestCandidatePort['abandonPlanProposal']>;
export type PlansAbandonResponse = RouteResponse<RequestCandidatePort['abandonPlanProposal']>;
export type DecisionsQueueBody = PlainBody<DecisionReadPort['queryDecisionQueue']>;
export type DecisionsQueueResponse = RouteResponse<DecisionReadPort['queryDecisionQueue']>;
export type DecisionsCardBody = PlainBody<DecisionReadPort['readDecisionCard']>;
export type DecisionsCardResponse = RouteResponse<DecisionReadPort['readDecisionCard']>;
/** `decisions/answer` is the finite Workflow coordination (§4.5), not a bare owner. */
export type DecisionsAnswerBody = GraphWriteBody<NonNullable<WorkflowPort['resolveDecision']>>;
export type DecisionsAnswerResponse = RouteResponse<NonNullable<WorkflowPort['resolveDecision']>>;
export type DecisionsApplicationBody = GraphWriteBody<DecisionMessagePort['recordDecisionApplication']>;
export type DecisionsApplicationResponse = RouteResponse<DecisionMessagePort['recordDecisionApplication']>;
export type DecisionsNoticesSeenBody = GraphWriteBody<WorkspaceDecisionSettingsPort['markNoticesSeen']>;
export type DecisionsNoticesSeenResponse = RouteResponse<WorkspaceDecisionSettingsPort['markNoticesSeen']>;
export type MessagesUserSendBody = GraphWriteBody<DecisionMessagePort['sendUserMessage']>;
export type MessagesUserSendResponse = RouteResponse<DecisionMessagePort['sendUserMessage']>;

// ---------------------------------------------------------------------------
// Slice 2B L15: the five activity/timeline route DTOs. Each alias derives from
// the exact public owner method the frozen route table names; the human-only
// range backfill derives from the optional Workflow operation the real
// composition always installs. Nothing in `src/` names these aliases at
// runtime, so they are allowlisted as `wire-format` (F34/P9).
// ---------------------------------------------------------------------------
export type ActivityCalendarBody = PlainBody<ActivityReadPort['readActivityCalendar']>;
export type ActivityCalendarResponse = RouteResponse<ActivityReadPort['readActivityCalendar']>;
export type ActivityRunsBody = PlainBody<ActivityReadPort['readRunActivities']>;
export type ActivityRunsResponse = RouteResponse<ActivityReadPort['readRunActivities']>;
export type ActivityTrackBody = PlainBody<TrackReadPort['readTrackBars']>;
export type ActivityTrackResponse = RouteResponse<TrackReadPort['readTrackBars']>;
export type TasksTimelineBody = PlainBody<TaskTimelineReadPort['readTaskStateTimeline']>;
export type TasksTimelineResponse = RouteResponse<TaskTimelineReadPort['readTaskStateTimeline']>;
export type ActivityBackfillBody = PlainBody<NonNullable<WorkflowPort['backfillActivityRange']>>;
export type ActivityBackfillResponse = RouteResponse<NonNullable<WorkflowPort['backfillActivityRange']>>;

// ---------------------------------------------------------------------------
// Slice 2C (spec §2, L13): the seven work-line / node-detail routes. Each alias
// derives from the exact public owner method named by the frozen route table.
// `lines/page` is the Host-assembled `conversation` page for the conversation
// section and forwards every other section to `WorkLineReadPort`, so its
// response is the union of the two section pages.
// ---------------------------------------------------------------------------
/** The page `lines/page` returns for the Host-assembled `conversation` section (L12).
 *  Defined in the Host composition that builds it; re-exported here as the Host
 *  HTTP DTO (the architecture check forbids composition→Host, spec §2 item 15). */
export type { WorkLineConversationPageV1 } from '../composition/work-line-conversation.js';
export type LinesListBody = PlainBody<WorkLineReadPort['listWorkLines']>;
export type LinesListResponse = RouteResponse<WorkLineReadPort['listWorkLines']>;
export type LinesArchivedBody = PlainBody<WorkLineReadPort['listArchivedLines']>;
export type LinesArchivedResponse = RouteResponse<WorkLineReadPort['listArchivedLines']>;
export type LinesReadBody = PlainBody<WorkLineReadPort['readWorkLine']>;
export type LinesReadResponse = RouteResponse<WorkLineReadPort['readWorkLine']>;
export type LinesPageBody = PlainBody<WorkLineConversationPort['readWorkLinePage']>;
export type LinesPageResponse = RouteResponse<WorkLineConversationPort['readWorkLinePage']>;
export type LinesPinBody = GraphWriteBody<WorkLineSettingsPort['setLinePins']>;
export type LinesPinResponse = RouteResponse<WorkLineSettingsPort['setLinePins']>;
export type GraphHoverBody = PlainBody<NodeDetailReadPort['readGraphHover']>;
export type GraphHoverResponse = RouteResponse<NodeDetailReadPort['readGraphHover']>;
export type GraphDetailBody = PlainBody<NodeDetailReadPort['readNodeDetail']>;
export type GraphDetailResponse = RouteResponse<NodeDetailReadPort['readNodeDetail']>;

/**
 * The compile-time typed assembly of the seven slice-2C suffixes (spec §2):
 * each suffix paired with the exact body and exact public result its owner
 * method produces. Like `Slice1CoreRouteDto` it is a type only, and
 * `dispatchCoreRoute` names it so every alias stays reachable from production.
 */
export type Slice2CCoreRouteDto = {
  'lines/list': { body: LinesListBody; response: LinesListResponse };
  'lines/archived': { body: LinesArchivedBody; response: LinesArchivedResponse };
  'lines/read': { body: LinesReadBody; response: LinesReadResponse };
  'lines/page': { body: LinesPageBody; response: LinesPageResponse };
  'lines/pin': { body: LinesPinBody; response: LinesPinResponse };
  'graph/hover': { body: GraphHoverBody; response: GraphHoverResponse };
  'graph/detail': { body: GraphDetailBody; response: GraphDetailResponse };
};

// ---------------------------------------------------------------------------
// Slice 4C C1.4 (spec §2, L15, L19): the six notes and version-list routes. All
// are `plain`; `notes/write`, `notes/withdraw` and `notes/review` are person-only
// (the Host layer guards identity). The notes aliases derive from the note
// contracts; the two version lists read `VersionListPageV1`.
// ---------------------------------------------------------------------------
export type NotesListBody = { scope: CoreScope; input: NoteListRequestV1 };
export type NotesListResponse = NoteMemoryReadResult<NoteListResultV1>;
export type NotesWriteBody = PlainBody<NoteWritePort['writeNote']>;
export type NotesWriteResponse = WriteNoteEnvelopeV1;
export type NotesWithdrawBody = PlainBody<NoteWritePort['withdrawNote']>;
export type NotesWithdrawResponse = RouteResponse<NoteWritePort['withdrawNote']>;
export type NotesReviewBody = PlainBody<NoteWritePort['reviewNote']>;
export type NotesReviewResponse = RouteResponse<NoteWritePort['reviewNote']>;
export type PlansVersionsBody = { scope: CoreScope; input: { goalId: string; limit: number; cursor: string | null } };
export type PlansVersionsResponse = ReadResult<VersionListPageV1>;
export type ArchitectureVersionsBody = { scope: CoreScope; input: { limit: number; cursor: string | null } };
export type ArchitectureVersionsResponse = ReadResult<VersionListPageV1>;

// ---------------------------------------------------------------------------
// The three request command routes. All are `plain` (the service owns
// identity/receipts/tail; the request carries no version pins) and person-only
// at the Host layer. `route`'s public surface is `manual`/`dropped`;
// `handoff`/`archived` stay internal.
// ---------------------------------------------------------------------------
export type RequestsSubmitBody = PlainBody<RequestSubmitPort['submitRequest']>;
export type RequestsSubmitResponse = RouteResponse<RequestSubmitPort['submitRequest']>;
export type RequestsRouteBody = PlainBody<RequestSubmitPort['route']>;
export type RequestsRouteResponse = RouteResponse<RequestSubmitPort['route']>;
export type RequestsSelectIdeaBody = PlainBody<RequestSubmitPort['selectIdea']>;
export type RequestsSelectIdeaResponse = RouteResponse<RequestSubmitPort['selectIdea']>;

/** The compile-time typed assembly of the three request command suffixes. */
export type RequestCommandCoreRouteDto = {
  'requests/submit': { body: RequestsSubmitBody; response: RequestsSubmitResponse };
  'requests/route': { body: RequestsRouteBody; response: RequestsRouteResponse };
  'requests/select-idea': { body: RequestsSelectIdeaBody; response: RequestsSelectIdeaResponse };
};

// ---------------------------------------------------------------------------
// R6 execution-entry routes: each alias is derived from the exact public owner
// named by the frozen route table. `prepareQuery`/`startQuery`/`observeQuery`
// use the NonNullable derivation because their source members are optional only
// to keep an existing Work port literal type-compatible; the real composition
// root always publishes all three.
// ---------------------------------------------------------------------------
export type WorkspacesRegistrationBody = PlainBody<ProjectRegistrationPort['readWorkspaceRegistration']>;
export type WorkspacesRegistrationResponse = RouteResponse<ProjectRegistrationPort['readWorkspaceRegistration']>;
export type QueriesSubmitBody = GraphWriteBody<QueryJobPort['submitQueryJob']>;
export type QueriesSubmitResponse = RouteResponse<QueryJobPort['submitQueryJob']>;
export type QueriesReadBody = PlainBody<QueryJobPort['readQueryJob']>;
export type QueriesReadResponse = RouteResponse<QueryJobPort['readQueryJob']>;
export type QueriesClaimBody = GraphWriteBody<QueryJobPort['claimQuery']>;
export type QueriesClaimResponse = RouteResponse<QueryJobPort['claimQuery']>;
export type QueriesPrepareBody = PlainBody<NonNullable<RuntimeExecutionPort['prepareQuery']>>;
export type QueriesPrepareResponse = RouteResponse<NonNullable<RuntimeExecutionPort['prepareQuery']>>;
export type QueriesStartBody = PlainBody<NonNullable<RuntimeExecutionPort['startQuery']>>;
export type QueriesStartResponse = RouteResponse<NonNullable<RuntimeExecutionPort['startQuery']>>;
export type QueriesObserveBody = PlainBody<NonNullable<RuntimeExecutionPort['observeQuery']>>;
export type QueriesObserveResponse = RouteResponse<NonNullable<RuntimeExecutionPort['observeQuery']>>;
export type QueriesAnswerBody = PlainBody<QueryJobPort['readQueryAnswer']>;
export type QueriesAnswerResponse = RouteResponse<QueryJobPort['readQueryAnswer']>;
export type MaterialsOpenBody = PlainBody<MaterialPort['openArtifact']>;
export type MaterialsOpenResponse = RouteResponse<MaterialPort['openArtifact']>;
export type WorkflowGoalInputBody = PlainBody<WorkflowPort['handleGoalInput']>;
export type WorkflowGoalInputResponse = RouteResponse<WorkflowPort['handleGoalInput']>;
export type WorkflowAdvanceBody = PlainBody<WorkflowPort['advanceWork']>;
export type WorkflowAdvanceResponse = RouteResponse<WorkflowPort['advanceWork']>;
/** The explicit-consultation route derives its body/response from the exact
 * optional `WorkflowPort.consumeConsultation` method; the composition root
 * always publishes it, so the NonNullable derivation is the real DTO. */
export type WorkflowConsultationBody = PlainBody<NonNullable<WorkflowPort['consumeConsultation']>>;
export type WorkflowConsultationResponse = RouteResponse<NonNullable<WorkflowPort['consumeConsultation']>>;
// AG2b collaboration driver: the three plain routes derive their bodies and
// responses from the exact frozen driver methods, so the DTO never restates a
// domain shape.
export type WorkflowDriverStartBody = PlainBody<CollaborationDriverPort['start']>;
export type WorkflowDriverStartResponse = RouteResponse<CollaborationDriverPort['start']>;
export type WorkflowDriverReadBody = PlainBody<CollaborationDriverPort['read']>;
export type WorkflowDriverReadResponse = RouteResponse<CollaborationDriverPort['read']>;
export type WorkflowDriverStopBody = PlainBody<CollaborationDriverPort['stop']>;
export type WorkflowDriverStopResponse = RouteResponse<CollaborationDriverPort['stop']>;

// ---------------------------------------------------------------------------
// R6 Task-execution -> original Session/history consumer routes. Both suffixes
// are PLAIN reads and derive their body/response from the exact public owner
// method, so the HTTP layer never restates a domain shape. `executions/read`
// exposes ONLY the existing second argument of `readExecution`; this batch adds
// no third `options` parameter. `executions/history` is the WorkGraph-locator
// graph-history reader, NOT the Kernel-identity `readExecutionHistory` request.
// ---------------------------------------------------------------------------
export type ExecutionsReadBody = PlainBody<ExecutionReadPort['readExecution']>;
export type ExecutionsReadResponse = RouteResponse<ExecutionReadPort['readExecution']>;
export type ExecutionsHistoryBody = PlainBody<RuntimeExecutionPort['readTaskExecutionHistory']>;
export type ExecutionsHistoryResponse = RouteResponse<RuntimeExecutionPort['readTaskExecutionHistory']>;

// ---------------------------------------------------------------------------
// MVP UI connection routes. Each alias derives from the exact owner method:
//   - `executions/list` is the bounded ExecutionReadPort.listExecutions page;
//   - `projects/read` is the narrow ProjectRegistrationPort.readProject read;
//   - `files/save` is the Host workbench-tools Kernel CAS write;
//   - `files/compare` forwards the EXISTING WorkspaceToolsPort.compareWorkspace
//     (no new compare implementation);
//   - the three command routes are the Host command-handle start/read/stop.
// Both methods added to an existing owner are optional on the port only so an
// existing narrow test double keeps compiling; the real composition always
// assembles them, and a Host without workbench tools answers `unsupported`.
// ---------------------------------------------------------------------------
export type ExecutionsListBody = PlainBody<NonNullable<ExecutionReadPort['listExecutions']>>;
export type ExecutionsListResponse = RouteResponse<NonNullable<ExecutionReadPort['listExecutions']>>;
export type ProjectsReadBody = PlainBody<NonNullable<ProjectRegistrationPort['readProject']>>;
export type ProjectsReadResponse = RouteResponse<NonNullable<ProjectRegistrationPort['readProject']>>;
export type FilesSaveBody = PlainBody<WorkbenchToolsPort['saveFile']>;
export type FilesSaveResponse = RouteResponse<WorkbenchToolsPort['saveFile']>;
export type FilesCompareBody = PlainBody<WorkspaceToolsPort['compareWorkspace']>;
export type FilesCompareResponse = RouteResponse<WorkspaceToolsPort['compareWorkspace']>;
export type CommandsStartBody = PlainBody<WorkbenchToolsPort['startCommand']>;
export type CommandsStartResponse = RouteResponse<WorkbenchToolsPort['startCommand']>;
export type CommandsReadBody = PlainBody<WorkbenchToolsPort['readCommand']>;
export type CommandsReadResponse = RouteResponse<WorkbenchToolsPort['readCommand']>;
export type CommandsStopBody = PlainBody<WorkbenchToolsPort['stopCommand']>;
export type CommandsStopResponse = RouteResponse<WorkbenchToolsPort['stopCommand']>;

// ---------------------------------------------------------------------------
// Slice 1 (spec §4.4): the eleven Session facts / corrections / archive routes.
//
// Each alias derives from the exact public owner method the frozen route table
// names. A `graph_write` route keeps the domain `{input,meta}` envelope; a
// `plain` route carries the port's exact second argument. No internal write
// payload is exposed: `recordSessionAnomaly`, the raw `requestSessionArchive`
// and `finishSessionArchive` steps stay off the HTTP surface, and
// `sessions/archive-line` is the ONLY new archive button (spec §4.4).
// ---------------------------------------------------------------------------
export type SessionsArchiveLineBody = GraphWriteBody<NonNullable<WorkflowPort['archiveLine']>>;
export type SessionsArchiveLineResponse = RouteResponse<NonNullable<WorkflowPort['archiveLine']>>;
export type SessionsArchiveContinueBody = PlainBody<NonNullable<WorkflowPort['continueArchiveLine']>>;
export type SessionsArchiveContinueResponse = RouteResponse<NonNullable<WorkflowPort['continueArchiveLine']>>;
export type SessionsArchiveReleaseBody = GraphWriteBody<SessionLifecyclePort['releaseSessionArchiveRequest']>;
export type SessionsArchiveReleaseResponse = RouteResponse<SessionLifecyclePort['releaseSessionArchiveRequest']>;
export type SessionsFactsBody = PlainBody<SessionFactsPort['readSessionFacts']>;
export type SessionsFactsResponse = RouteResponse<SessionFactsPort['readSessionFacts']>;
export type SessionsSuccessorsBody = PlainBody<SessionFactsPort['findSessionSuccessors']>;
export type SessionsSuccessorsResponse = RouteResponse<SessionFactsPort['findSessionSuccessors']>;
export type SessionsExecutionsBody = PlainBody<SessionFactsPort['listSessionExecutions']>;
export type SessionsExecutionsResponse = RouteResponse<SessionFactsPort['listSessionExecutions']>;
export type SessionsQueriesBody = PlainBody<SessionFactsPort['listSessionQueries']>;
export type SessionsQueriesResponse = RouteResponse<SessionFactsPort['listSessionQueries']>;
export type SessionsTransferResponsibilityBody = GraphWriteBody<SessionResponsibilityPort['transferSessionResponsibility']>;
export type SessionsTransferResponsibilityResponse = RouteResponse<SessionResponsibilityPort['transferSessionResponsibility']>;
export type TasksArchiveStateBody = PlainBody<SessionAnomalyPort['readTaskArchiveState']>;
export type TasksArchiveStateResponse = RouteResponse<SessionAnomalyPort['readTaskArchiveState']>;
export type AnomaliesListBody = PlainBody<SessionAnomalyPort['listSessionAnomalies']>;
export type AnomaliesListResponse = RouteResponse<SessionAnomalyPort['listSessionAnomalies']>;
export type MessagesUndeliveredRepliesBody = PlainBody<NonNullable<SessionMailboxPort['readUndeliveredReplies']>>;
export type MessagesUndeliveredRepliesResponse = RouteResponse<NonNullable<SessionMailboxPort['readUndeliveredReplies']>>;
// K3 (§2 L7): `unknown-call-reviews/read` derives its body/response from the
// exact read-only owner method; the request is `{ ref }` or `{ runRef }`.
export type UnknownCallReviewsReadBody = PlainBody<UnknownCallReviewReadPort['readReview']>;
export type UnknownCallReviewsReadResponse = RouteResponse<UnknownCallReviewReadPort['readReview']>;
export type UnknownCallReviewsListBody = PlainBody<UnknownCallReviewReadPort['listReviews']>;
export type UnknownCallReviewsListResponse = RouteResponse<UnknownCallReviewReadPort['listReviews']>;
export type UnknownCallReviewsHoldBody = GraphWriteBody<UnknownCallReviewPort['holdReview']>;
export type UnknownCallReviewsHoldResponse = RouteResponse<UnknownCallReviewPort['holdReview']>;
/**
 * K3 L21 ruling 4: `release-hold` is one response. `hold` is the `releaseHold`
 * receipt; `requeue` is the same operator's human `requeueTask` result (or its
 * rejection) when the original Run's rework fence is human, `null` otherwise.
 * The route itself succeeds iff `hold` succeeded.
 */
export type UnknownCallReviewReleaseHoldValue = {
  hold: Awaited<ReturnType<UnknownCallReviewPort['releaseHold']>>;
  requeue: Awaited<ReturnType<NonNullable<TaskClaimPort['requeueTask']>>> | null;
};
export type UnknownCallReviewsReleaseHoldBody = GraphWriteBody<UnknownCallReviewPort['releaseHold']>;
export type UnknownCallReviewsReleaseHoldResponse = WriteResult<UnknownCallReviewReleaseHoldValue>;

/**
 * The compile-time typed assembly of the K3 suffixes. Like `Slice1CoreRouteDto`
 * it is a type only; `dispatchCoreRoute` names it so the aliases stay reachable
 * from production.
 */
export type K3CoreRouteDto = {
  'unknown-call-reviews/read': { body: UnknownCallReviewsReadBody; response: UnknownCallReviewsReadResponse };
  'unknown-call-reviews/list': { body: UnknownCallReviewsListBody; response: UnknownCallReviewsListResponse };
  'unknown-call-reviews/hold': { body: UnknownCallReviewsHoldBody; response: UnknownCallReviewsHoldResponse };
  'unknown-call-reviews/release-hold':
    { body: UnknownCallReviewsReleaseHoldBody; response: UnknownCallReviewsReleaseHoldResponse };
};

/**
 * The compile-time typed assembly of the eleven slice-1 suffixes (spec §4.4):
 * each suffix paired with the exact body and exact public result its owner
 * method produces. The parser and dispatcher use the aliases above directly;
 * this table is the one place that names them all together, so the DTO contract
 * and the route suffixes stay in sync and every alias is part of the production
 * graph (K6). It is a type only: no runtime value exists.
 */
export type Slice1CoreRouteDto = {
  'sessions/archive-line': { body: SessionsArchiveLineBody; response: SessionsArchiveLineResponse };
  'sessions/archive-continue': { body: SessionsArchiveContinueBody; response: SessionsArchiveContinueResponse };
  'sessions/archive-release': { body: SessionsArchiveReleaseBody; response: SessionsArchiveReleaseResponse };
  'sessions/facts': { body: SessionsFactsBody; response: SessionsFactsResponse };
  'sessions/successors': { body: SessionsSuccessorsBody; response: SessionsSuccessorsResponse };
  'sessions/executions': { body: SessionsExecutionsBody; response: SessionsExecutionsResponse };
  'sessions/queries': { body: SessionsQueriesBody; response: SessionsQueriesResponse };
  'sessions/transfer-responsibility': {
    body: SessionsTransferResponsibilityBody; response: SessionsTransferResponsibilityResponse;
  };
  'tasks/archive-state': { body: TasksArchiveStateBody; response: TasksArchiveStateResponse };
  'anomalies/list': { body: AnomaliesListBody; response: AnomaliesListResponse };
  'messages/undelivered-replies': {
    body: MessagesUndeliveredRepliesBody; response: MessagesUndeliveredRepliesResponse;
  };
};

/** Exact public result/domain shapes the UI and its tests consume. They are
 * re-exported, never restated, so the browser cannot depend on a private copy. */
export type { SessionCard, SessionOperationRecord, SessionPage } from '../core/work-graph/model/session-contracts.js';
export type { MessageBody, SessionMessage, SessionMessageStatus } from '../core/work-graph/model/communication-contracts.js';
export type { CreateSessionRequest, SessionHistoryEntry, SessionHistoryRequest } from '../core/agent-runtime/session-operations.js';
export type { RuntimeCapabilities } from '../core/agent-runtime/contracts.js';
export type { OperationReceipt, Page } from '../contracts/core/results.js';
export type { SessionRecord } from '../contracts/core/session.js';
export type { RoleConfigurationRef, SessionRef } from '../contracts/core/identity.js';
export type { ArtifactRecord } from '../contracts/artifact.js';
export type { QueryJobAnswerSnapshot, QueryJobRef, QueryRunRef } from '../contracts/query-job.js';
export type { QueryExecutionRecord } from '../core/work-graph/queries/contracts.js';
export type { RunRef } from '../contracts/dispatch.js';
export type { TaskExecutionRecord } from '../core/work-graph/model/execution-read-contracts.js';
export type { ExecutionHistoryPage } from '../core/agent-runtime/execution-history-contracts.js';
export type { PreparedQueryExecution } from '../contracts/core/prepared-execution.js';
export type { ExecutionListPageRequest, TaskExecutionPage } from '../core/work-graph/model/execution-read-contracts.js';
export type { WorkspaceComparison, WorkspaceComparisonRequest, WorkspaceVersion } from '../core/workspace/ports.js';
export type {
  SaveWorkbenchFileRequest, SaveWorkbenchFileResult,
  ListWorkbenchFilesRequest, ListWorkbenchFilesResult,
  StartWorkbenchCommandRequest, WorkbenchCommandRef, WorkbenchCommandSnapshot,
  WorkbenchCommandState, WorkbenchToolsPort, WorkbenchToolsWorkspace,
} from './workbench-tools.js';
export type { InitialPlanningGoalInputResult, WorkflowAdvanceResult, WorkflowStepReceipt,
  ConsultationInput, ConsultationResult } from '../business/workflow/contracts.js';
export type { CollaborationDriverPort, CollaborationSnapshot, CollaborationState } from './collaboration-driver.js';
// Slice 1 (spec §4.4): the result shapes of the new read routes and the archive
// composite, re-exported rather than restated for the UI.
export type { ArchiveLineInput, ArchiveLineResultV1, ArchiveStepReceiptV1 } from '../business/workflow/session-archive.js';
export type { SessionFactsV1, SessionWorkWaitV1 } from '../core/work-graph/model/session-facts-contracts.js';
export type { SessionAnomalyViewV1 } from '../contracts/session-anomaly.js';
export type { UndeliveredReplyV1 } from '../core/work-graph/model/communication-contracts.js';

/** `GET /api/real/core/bootstrap` omits root, authorization predicate and every
 * technical handle. `review` is whatever trusted startup configuration
 * supplied; the Host never scans the ledger to synthesize it. */
export type BootstrapWorkspace = {
  scope: CoreScope;
  name: string;
  workspaceRevision: number;
  /** Display-only capability flags for the cold-start UI. Absence means the
   * capability is NOT granted; no root, prefix list or permission predicate is
   * ever published. */
  writeAllowed?: boolean;
  commandsAllowed?: boolean;
};

export type ReviewCompletionPolicy = {
  policyId: string;
  contentRevision: number;
  /** `CompletionPolicyContentV1` kept structural so the DTO stays pure JSON. */
  content: Record<string, unknown>;
};
export type ReviewGoal = { goalId: string; objective: string };
export type ReviewArchitecture = AdoptInitialArchitectureInput;
export type ReviewPlan = {
  planId: string;
  goalId: string;
  draft: PlanRevisionDraft;
  reasonText: string;
};

/** Trusted startup choice material for the R6.1b "create Session" form. It is
 * only a label plus an EXISTING `RoleConfigurationRef` for one configured
 * scope: it is not a new Role registry, does not authorize anything, and does
 * not replace the domain Role validation. A deployment without entries can
 * still list/read existing Sessions, messages and history. */
export type ReviewSessionRole = {
  scope: CoreScope;
  label: string;
  role: RoleConfigurationRef;
};

export type BootstrapReviewMaterial = {
  notes?: string;
  policies?: ReviewCompletionPolicy[];
  goals?: ReviewGoal[];
  architectures?: ReviewArchitecture[];
  plans?: ReviewPlan[];
  sessionRoles?: ReviewSessionRole[];
};

/** Safe display projection of the frozen startup execution configuration. It
 * excludes every runtime binding, grant, model/baseUrl/options, environment
 * variable name, secret, root and client. It only helps a user choose a legal
 * profile and confers no domain permission; an unconfigured Host publishes empty
 * arrays and never scans the ledger for one. */
export type BootstrapExecutionQueryProfile = {
  id: string;
  label: string;
  scope: CoreScope;
  sessionRole: RoleConfigurationRef;
  roleBinding: RoleBindingRefV1;
  runtimeBudget: RuntimeBudget;
  budget: QueryJobIntentV1['budget'];
  consumerId: string;
};
export type BootstrapExecution = {
  queryProfiles: BootstrapExecutionQueryProfile[];
  workflowScopes: CoreScope[];
};

export type BootstrapResponse = {
  workspaces: BootstrapWorkspace[];
  review: BootstrapReviewMaterial | null;
  execution: BootstrapExecution;
  /** Task E: the change-feed head (commit cursor; null for an empty or unknown
   * ledger) when the Host answered `GET bootstrap`. Absent when the Host
   * publishes no change stream, and in the settings `workspaces/open` reply. */
  changesHead?: string | null;
};

// ---------------------------------------------------------------------------
// Task E change stream (`GET /api/real/core/changes`, text/event-stream).
//
// The stream carries CHANGE NOTIFICATIONS only, never domain data: the page
// re-reads the affected resources through the ordinary POST routes above. A
// notice derived from a RecordStore commit carries that commit's cursor as its
// SSE `id`, so `Last-Event-ID` resumes from the ledger order. Notices of the two
// Host in-memory handle owners (collaboration driver, command handles) have no
// commit cursor and therefore no `id`; a page re-reads its live handles after
// any reconnect instead.
// ---------------------------------------------------------------------------

/** Coarse resource families. `driver`/`command` are the in-memory Host handles;
 * every other kind is derived from the aggregate types a commit touched. */
export type ChangeKind =
  | 'project' | 'goals' | 'tasks' | 'executions' | 'sessions' | 'messages' | 'queries' | 'architecture'
  | 'other' | 'driver' | 'command';

/** The SSE event names. `ready` opens every connection; `reset` means the
 * missed notices cannot be replayed and everything shown must be re-read. */
export type ChangeEventName = 'ready' | 'change' | 'reset';

/** `change` data. `cursor` is the commit cursor for a commit notice and, for a
 * driver/command notice, only the current head for information. `projects` are
 * the touched project ids; workspace ids are not part of most aggregate refs,
 * so a page matches commit notices by project. */
export type ChangeNotice = {
  cursor: string | null;
  kinds: ChangeKind[];
  projects: string[];
  /** Driver/command notices name the exact handle scope. */
  scope?: CoreScope;
  /** Driver notice: the Goal whose handle (or a sibling handle) moved. */
  goalId?: string;
  taskId?: string | null;
  /** Command notice: the handle and its new state. */
  commandId?: string;
  state?: WorkbenchCommandState;
};

/** `ready` data: the head cursor at connect time (null for an empty ledger). */
export type ChangeReady = { cursor: string | null };

export type ChangeResetReason = 'cursor_invalid' | 'cursor_unknown' | 'cursor_too_old' | 'head_unknown';
/** `reset` data. */
export type ChangeReset = { cursor: string | null; reason: ChangeResetReason };
