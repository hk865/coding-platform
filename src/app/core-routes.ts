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
import type { CoreRejection } from '../contracts/core/results.js';
import type { RuntimeExecutionPort } from '../core/agent-runtime/ports.js';
import type { ArchitectureCatalogPort } from '../core/work-graph/architecture/catalog-contracts.js';
import type { ObservedArchitecturePort } from '../core/work-graph/architecture/contracts.js';
import type { SessionMailboxPort } from '../core/work-graph/communication/contracts.js';
import type {
  CompletionPolicyConfigurationPort,
  ProjectRegistrationPort,
} from '../core/work-graph/configuration/project-bootstrap-contracts.js';
import type { SessionDirectoryPort } from '../core/work-graph/sessions/contracts.js';
import type { ExecutionReadPort } from '../core/work-graph/tasks/execution-read-contracts.js';
import type { GoalTaskPort } from '../core/work-graph/tasks/contracts.js';
import type { PlanTaskPort } from '../core/work-graph/tasks/plan-contracts.js';
import type { WorkspaceCapturePort, WorkspaceToolsPort } from '../core/workspace/ports.js';
import type { MaterialPort } from '../core/work-graph/materials/contracts.js';
import type { QueryJobPort } from '../core/work-graph/queries/contracts.js';
import type { WorkflowPort } from '../business/workflow/ports.js';
import {
  type CoreRouteKind,
  type CoreRouteSuffix,
  type CoreScope,
} from './core-http-types.js';

/** One named binding per route. The types are the exact public port methods;
 * the names disambiguate the two `captureSourceChanges` owners. */
export type CoreRouteBindings = {
  createProject: ProjectRegistrationPort['createProject'];
  registerWorkspace: ProjectRegistrationPort['registerWorkspace'];
  installCompletionPolicy: CompletionPolicyConfigurationPort['installCompletionPolicy'];
  activateCompletionPolicy: CompletionPolicyConfigurationPort['activateCompletionPolicy'];
  createGoal: GoalTaskPort['createGoal'];
  queryGoal: PlanTaskPort['queryGoal'];
  adoptInitialArchitecture: ArchitectureCatalogPort['adoptInitialArchitecture'];
  readArchitectureRevision: ArchitectureCatalogPort['readArchitectureRevision'];
  captureArchitectureSource: ObservedArchitecturePort['captureSourceChanges'];
  queryArchitecture: ObservedArchitecturePort['queryArchitecture'];
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
  sendMessage: SessionMailboxPort['sendMessage'];
  readInbox: SessionMailboxPort['readInbox'];
  readMessage: SessionMailboxPort['readMessage'];
  readMessageBody: SessionMailboxPort['readMessageBody'];
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
  // R6 Task-execution -> original Session/history reads: one binding per owner.
  readExecution: ExecutionReadPort['readExecution'];
  readTaskExecutionHistory: RuntimeExecutionPort['readTaskExecutionHistory'];
};

/**
 * The exact platform seams the R6.1a route table consumes. It is the real
 * `createTargetPlatform` return value narrowed to the five published groups, so
 * `host.ts` can bind the ONE platform instance without either side importing a
 * service implementation or taking a dynamic method name.
 */
export type CoreRoutePlatform = {
  projects: ProjectRegistrationPort;
  completionPolicies: CompletionPolicyConfigurationPort;
  goals: GoalTaskPort;
  plans: PlanTaskPort;
  architecture: ArchitectureCatalogPort & ObservedArchitecturePort;
  workspace: WorkspaceToolsPort;
  sessions: Pick<SessionDirectoryPort, 'findSessions' | 'readSession' | 'getSessionOperation'>;
  executions: Pick<ExecutionReadPort, 'readExecution'>;
  runtime: Pick<RuntimeExecutionPort,
    'capabilities' | 'createSession' | 'readSessionHistory' | 'readTaskExecutionHistory'>
    & Required<Pick<RuntimeExecutionPort, 'prepareQuery' | 'startQuery' | 'observeQuery'>>;
  messages: Pick<SessionMailboxPort, 'sendMessage' | 'readInbox' | 'readMessage' | 'readMessageBody'>;
  queries: QueryJobPort;
  materials: Pick<MaterialPort, 'openArtifact'>;
  workflow: WorkflowPort;
};

export type CoreRouteSpec = {
  kind: CoreRouteKind;
  /** The one named binding this suffix forwards to. */
  binding: keyof CoreRouteBindings;
  /** Documented public owner, checked against the port method name. */
  owner: string;
};

/** The frozen R6.1a route table. Adding a suffix is a deliberate contract edit. */
export const CORE_ROUTE_SPECS: Record<CoreRouteSuffix, CoreRouteSpec> = {
  'projects/create': { kind: 'graph_write', binding: 'createProject', owner: 'projects.createProject' },
  'workspaces/register': { kind: 'graph_write', binding: 'registerWorkspace', owner: 'projects.registerWorkspace' },
  'completion-policies/install': { kind: 'graph_write', binding: 'installCompletionPolicy', owner: 'completionPolicies.installCompletionPolicy' },
  'completion-policies/activate': { kind: 'graph_write', binding: 'activateCompletionPolicy', owner: 'completionPolicies.activateCompletionPolicy' },
  'goals/create': { kind: 'graph_write', binding: 'createGoal', owner: 'goals.createGoal' },
  'goals/read': { kind: 'plain', binding: 'queryGoal', owner: 'plans.queryGoal' },
  'architecture/adopt-initial': { kind: 'graph_write', binding: 'adoptInitialArchitecture', owner: 'architecture.adoptInitialArchitecture' },
  'architecture/read': { kind: 'plain', binding: 'readArchitectureRevision', owner: 'architecture.readArchitectureRevision' },
  'architecture/capture': { kind: 'graph_write', binding: 'captureArchitectureSource', owner: 'architecture.captureSourceChanges' },
  'architecture/query': { kind: 'plain', binding: 'queryArchitecture', owner: 'architecture.queryArchitecture' },
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
  'messages/send': { kind: 'graph_write', binding: 'sendMessage', owner: 'messages.sendMessage' },
  'messages/inbox': { kind: 'plain', binding: 'readInbox', owner: 'messages.readInbox' },
  'messages/read': { kind: 'plain', binding: 'readMessage', owner: 'messages.readMessage' },
  'messages/body': { kind: 'plain', binding: 'readMessageBody', owner: 'messages.readMessageBody' },
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
  'executions/read': { kind: 'plain', binding: 'readExecution', owner: 'executions.readExecution' },
  'executions/history': { kind: 'plain', binding: 'readTaskExecutionHistory', owner: 'runtime.readTaskExecutionHistory' },
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

/** A named capability that has not been wired yet. This is an explicit gap,
 * never a silently empty success. */
export class CoreUnsupportedError extends CoreRouteRejectionError {
  constructor(reason: string) {
    super({ status: 'rejected', code: 'unsupported', reason });
    this.name = 'CoreUnsupportedError';
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
 * Bind the real platform seams to the frozen route table. Every entry is one
 * named public port method on the SAME platform instance; nothing here
 * re-implements governance, Session, mailbox, history or CAS and nothing
 * reaches the RecordStore. `.bind` keeps the owning group as the receiver so a
 * port method can never be captured with a foreign `this`. The ten R6.1b-1
 * Session/message/history routes call the real `sessions`/`runtime`/`messages`
 * services; the Host `ctx` (fixed actor/scope/signal) is supplied by the
 * server, never by the request body.
 */
export function createPlatformCoreRouteBindings(platform: CoreRoutePlatform): CoreRouteBindings {
  return {
    createProject: platform.projects.createProject.bind(platform.projects),
    registerWorkspace: platform.projects.registerWorkspace.bind(platform.projects),
    installCompletionPolicy: platform.completionPolicies.installCompletionPolicy.bind(platform.completionPolicies),
    activateCompletionPolicy: platform.completionPolicies.activateCompletionPolicy.bind(platform.completionPolicies),
    createGoal: platform.goals.createGoal.bind(platform.goals),
    queryGoal: platform.plans.queryGoal.bind(platform.plans),
    adoptInitialArchitecture: platform.architecture.adoptInitialArchitecture.bind(platform.architecture),
    readArchitectureRevision: platform.architecture.readArchitectureRevision.bind(platform.architecture),
    captureArchitectureSource: platform.architecture.captureSourceChanges.bind(platform.architecture),
    queryArchitecture: platform.architecture.queryArchitecture.bind(platform.architecture),
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
    sendMessage: platform.messages.sendMessage.bind(platform.messages),
    readInbox: platform.messages.readInbox.bind(platform.messages),
    readMessage: platform.messages.readMessage.bind(platform.messages),
    readMessageBody: platform.messages.readMessageBody.bind(platform.messages),
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
    readExecution: platform.executions.readExecution.bind(platform.executions),
    readTaskExecutionHistory: platform.runtime.readTaskExecutionHistory.bind(platform.runtime),
  };
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
      case 'projects/create': return bindings.createProject(ctx, graphWrite.request as never);
      case 'workspaces/register': return bindings.registerWorkspace(ctx, graphWrite.request as never);
      case 'completion-policies/install': return bindings.installCompletionPolicy(ctx, graphWrite.request as never);
      case 'completion-policies/activate': return bindings.activateCompletionPolicy(ctx, graphWrite.request as never);
      case 'goals/create': return bindings.createGoal(ctx, graphWrite.request as never);
      case 'goals/read': return bindings.queryGoal(ctx, plain.input as never);
      case 'architecture/adopt-initial': return bindings.adoptInitialArchitecture(ctx, graphWrite.request as never);
      case 'architecture/read': return bindings.readArchitectureRevision(ctx, plain.input as never);
      case 'architecture/capture': return bindings.captureArchitectureSource(ctx, graphWrite.request as never);
      case 'architecture/query': return bindings.queryArchitecture(ctx, plain.input as never);
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
      case 'messages/send': return bindings.sendMessage(ctx, graphWrite.request as never);
      case 'messages/inbox': return bindings.readInbox(ctx, plain.input as never);
      case 'messages/read': return bindings.readMessage(ctx, plain.input as never);
      case 'messages/body': return bindings.readMessageBody(ctx, plain.input as never);
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
      case 'executions/read': return bindings.readExecution(ctx, plain.input as never);
      case 'executions/history': return bindings.readTaskExecutionHistory(ctx, plain.input as never);
    }
  })();
  // A GraphWrite rejection is a failed command: preserve its exact body but let
  // the transport boundary answer with the real status. A plain read/action
  // (including `source/capture`) keeps its original 200 result body.
  if (spec.kind === 'graph_write' && isRejection(result)) throw new CoreRouteRejectionError(result);
  return result;
}
