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
import type { CoreRejection } from '../contracts/core/results.js';
import type { RuntimeExecutionPort } from '../core/agent-runtime/ports.js';
import type { ExecutionHistoryPage } from '../core/agent-runtime/execution-history-contracts.js';
import type { ExecutionReadPort, TaskExecutionRecord } from '../core/work-graph/tasks/execution-read-contracts.js';
import type { RunRef } from '../contracts/dispatch.js';
import type { SessionMailboxPort } from '../core/work-graph/communication/contracts.js';
import type { SessionDirectoryPort } from '../core/work-graph/sessions/contracts.js';
import type { AdoptInitialArchitectureInput } from '../core/work-graph/architecture/catalog-contracts.js';
import type { ArchitectureCatalogPort } from '../core/work-graph/architecture/catalog-contracts.js';
import type { ObservedArchitecturePort } from '../core/work-graph/architecture/contracts.js';
import type {
  CompletionPolicyConfigurationPort,
  ProjectRegistrationPort,
} from '../core/work-graph/configuration/project-bootstrap-contracts.js';
import type { GoalTaskPort } from '../core/work-graph/tasks/contracts.js';
import type { PlanTaskPort } from '../core/work-graph/tasks/plan-contracts.js';
import type { WorkspaceCapturePort, WorkspaceToolsPort } from '../core/workspace/ports.js';
import type { MaterialSourceScope } from '../contracts/material-access.js';
import type { PlanRevisionDraft } from '../contracts/plan.js';
import type { RoleBindingRefV1 } from '../contracts/dispatch.js';
import type { QueryJobAnswerSnapshot, QueryJobIntentV1, QueryJobRef, QueryRunRef } from '../contracts/query-job.js';
import type { RuntimeBudget } from '../contracts/runtime-budget.js';
import type { QueryJobPort, QueryExecutionRecord } from '../core/work-graph/queries/contracts.js';
import type { MaterialPort } from '../core/work-graph/materials/contracts.js';
import type { WorkflowPort } from '../business/workflow/ports.js';
import type { InitialPlanningGoalInputResult, WorkflowAdvanceResult, WorkflowStepReceipt } from '../business/workflow/contracts.js';

/** The project/workspace navigation scope. It is a real domain scope, not a
 * second source of Project/Workspace registration truth. */
export type { AdoptInitialArchitectureInput, ArchitectureRevision, ModuleDefinition } from '../core/work-graph/architecture/catalog-contracts.js';
export type { ObservedArchitectureNeighborhood } from '../core/work-graph/architecture/contracts.js';
export type { TaskGraph, TaskRow } from '../core/work-graph/tasks/plan-contracts.js';
export type { CoreRejection, ReadResult } from '../contracts/core/results.js';
export type { CaptureSummary, SourcePage, WorkspaceFile, WorkspaceResult } from '../core/workspace/ports.js';

export type CoreScope = MaterialSourceScope;

/** Trusted local startup actor. The browser never chooses it. */
export type WorkbenchActor = Extract<ActorRef, { kind: 'human' | 'system' }>;

export const PLATFORM_TOKEN_HEADER = 'x-platform-token';
export const PLATFORM_TOKEN_META_NAME = 'platform-token';
/** Literal placeholder the static build ships; `server.ts` substitutes it per
 * response and never writes the real token back to disk. */
export const PLATFORM_TOKEN_PLACEHOLDER = '__PLATFORM_TOKEN__';
export const WORKBENCH_PATH = '/workbench/';
export const CORE_API_PREFIX = '/api/real/core/';
export const BOOTSTRAP_SUFFIX = 'bootstrap';

/** Body kinds. GraphWrite routes keep the domain `{input,meta}` envelope;
 * `source/capture` is an explicit action but is NOT a GraphWrite, matching the
 * real `WorkspaceCapturePort.captureSourceChanges` parameter. */
export type CoreRouteKind = 'graph_write' | 'plain';

export type CoreRouteSuffix =
  | 'projects/create'
  | 'workspaces/register'
  | 'completion-policies/install'
  | 'completion-policies/activate'
  | 'goals/create'
  | 'goals/read'
  | 'architecture/adopt-initial'
  | 'architecture/read'
  | 'architecture/capture'
  | 'architecture/query'
  | 'plans/propose'
  | 'plans/apply'
  | 'plans/proposal'
  | 'tasks/query'
  | 'files/read'
  | 'source/capture'
  | 'source/query'
  | 'sessions/find'
  | 'sessions/read'
  | 'sessions/operation'
  | 'runtime/capabilities'
  | 'sessions/create'
  | 'sessions/history'
  | 'messages/send'
  | 'messages/inbox'
  | 'messages/read'
  | 'messages/body'
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
  | 'executions/read'
  | 'executions/history';

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
export type GoalsCreateBody = GraphWriteBody<GoalTaskPort['createGoal']>;
export type GoalsCreateResponse = RouteResponse<GoalTaskPort['createGoal']>;
export type GoalsReadBody = PlainBody<PlanTaskPort['queryGoal']>;
export type GoalsReadResponse = RouteResponse<PlanTaskPort['queryGoal']>;
export type ArchitectureAdoptInitialBody = GraphWriteBody<ArchitectureCatalogPort['adoptInitialArchitecture']>;
export type ArchitectureAdoptInitialResponse = RouteResponse<ArchitectureCatalogPort['adoptInitialArchitecture']>;
export type ArchitectureReadBody = PlainBody<ArchitectureCatalogPort['readArchitectureRevision']>;
export type ArchitectureReadResponse = RouteResponse<ArchitectureCatalogPort['readArchitectureRevision']>;
export type ArchitectureCaptureBody = GraphWriteBody<ObservedArchitecturePort['captureSourceChanges']>;
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

/** Exact public result/domain shapes the UI and its tests consume. They are
 * re-exported, never restated, so the browser cannot depend on a private copy. */
export type { SessionCard, SessionOperationRecord, SessionPage } from '../core/work-graph/sessions/contracts.js';
export type { MessageBody, SessionMessage, SessionMessageStatus } from '../core/work-graph/communication/contracts.js';
export type { CreateSessionRequest, SessionHistoryEntry, SessionHistoryRequest } from '../core/agent-runtime/session-operations.js';
export type { RuntimeCapabilities } from '../core/agent-runtime/contracts.js';
export type { OperationReceipt, Page } from '../contracts/core/results.js';
export type { SessionRecord } from '../contracts/core/session.js';
export type { RoleConfigurationRef, SessionRef } from '../contracts/core/identity.js';
export type { ArtifactRecord } from '../contracts/artifact.js';
export type { QueryJobAnswerSnapshot, QueryJobRef, QueryRunRef } from '../contracts/query-job.js';
export type { QueryExecutionRecord } from '../core/work-graph/queries/contracts.js';
export type { RunRef } from '../contracts/dispatch.js';
export type { TaskExecutionRecord } from '../core/work-graph/tasks/execution-read-contracts.js';
export type { ExecutionHistoryPage } from '../core/agent-runtime/execution-history-contracts.js';
export type { PreparedQueryExecution } from '../contracts/core/prepared-execution.js';
export type { InitialPlanningGoalInputResult, WorkflowAdvanceResult, WorkflowStepReceipt } from '../business/workflow/contracts.js';

/** Explicitly unsupported capability gap surfaced verbatim to the browser. */
export type UnsupportedResponse = CoreRejection & { status: 'rejected'; code: 'unsupported' };

/** `GET /api/real/core/bootstrap` omits root, authorization predicate and every
 * technical handle. `review` is whatever trusted startup configuration
 * supplied; the Host never scans the ledger to synthesize it. */
export type BootstrapWorkspace = {
  scope: CoreScope;
  name: string;
  workspaceRevision: number;
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
};
