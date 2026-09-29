import type { RunControlPort } from '../core/work-graph/tasks/control-contracts.js';
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
import type { SessionLifecyclePort } from '../core/work-graph/sessions/lifecycle-contracts.js';
import type { ExecutionReadPort } from '../core/work-graph/tasks/execution-read-contracts.js';
import type { GoalTaskPort } from '../core/work-graph/tasks/contracts.js';
import type { PlanTaskPort } from '../core/work-graph/tasks/plan-contracts.js';
import type { WorkspaceCapturePort, WorkspaceToolsPort } from '../core/workspace/ports.js';
import type { MaterialPort } from '../core/work-graph/materials/contracts.js';
import type { QueryJobPort } from '../core/work-graph/queries/contracts.js';
import type { WorkflowPort } from '../business/workflow/ports.js';
import type { CollaborationDriverPort } from './collaboration-driver.js';
import type { WorkbenchToolsPort } from './workbench-tools.js';
import {
  type CoreRouteKind,
  type CoreRouteSuffix,
  type CoreScope,
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
};

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
  goals: GoalTaskPort;
  plans: PlanTaskPort;
  architecture: ArchitectureCatalogPort & ObservedArchitecturePort;
  workspace: WorkspaceToolsPort;
  sessions: Pick<SessionDirectoryPort, 'findSessions' | 'readSession' | 'getSessionOperation'>
    & Pick<SessionLifecyclePort, 'archiveSession' | 'reactivateSession' | 'linkSessionWork'>;
  executions: Pick<ExecutionReadPort, 'readExecution'> & Required<Pick<ExecutionReadPort, 'listExecutions'>>;
  runtime: Pick<RuntimeExecutionPort,
    'capabilities' | 'createSession' | 'readSessionHistory' | 'readTaskExecutionHistory' | 'startRun' | 'deliverControl'>
    & Required<Pick<RuntimeExecutionPort, 'prepareQuery' | 'startQuery' | 'observeQuery'>>;
  messages: Pick<SessionMailboxPort, 'sendMessage' | 'readInbox' | 'readMessage' | 'readMessageBody'>
    & Required<Pick<SessionMailboxPort, 'readOutbox'>>;
  queries: QueryJobPort;
  materials: Pick<MaterialPort, 'openArtifact'>;
  workflow: WorkflowPort & Required<Pick<WorkflowPort, 'consumeConsultation'>>;
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
export function createPlatformCoreRouteBindings(
  platform: CoreRoutePlatform,
  driver?: CollaborationDriverPort,
  workbenchTools?: WorkbenchToolsPort,
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
    }
  })();
  // A GraphWrite rejection is a failed command: preserve its exact body but let
  // the transport boundary answer with the real status. A plain read/action
  // (including `source/capture`) keeps its original 200 result body.
  if (spec.kind === 'graph_write' && isRejection(result)) throw new CoreRouteRejectionError(result);
  return result;
}
