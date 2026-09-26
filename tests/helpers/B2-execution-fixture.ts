/**
 * B2 execution-state behaviour-test fixture.
 *
 * Composes the real R4c.1 claim fixture (real RecordStore, Goal/Plan/Session
 * services, real Kernel store mapping and the formal TaskClaimPort) and layers
 * the B2 execution-entry/model-request ports over the same real Store. The
 * claim/Run are always produced by the formal claim service; the Prepared
 * contract wraps that real claim and its bounded manifest body is stored through
 * the real RawArtifactStorePort. The material port is an explicit unsupported
 * seam and the Host configuration callback is a test double: the production
 * entry service is unsupported, so target assertions are expected RED.
 */
import { expect } from 'vitest';
import { CLAIM_FIXTURE_AT, createTaskClaimFixture, type TaskClaimFixture, type ClaimFixtureKind } from './task-claim-fixture.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { VersionPin } from '../../src/contracts/core/identity.js';
import type { PreparedTaskExecution, PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import { artifactBodyDigest, type ArtifactRef } from '../../src/contracts/artifact.js';
import type { RunRef, RunSnapshot, RuntimeEventV1 } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { MaterialAccessGrantRef, MaterialBasisV1 } from '../../src/contracts/material-access.js';
import type { PlanRevisionDraft, PlanRevisionRef } from '../../src/contracts/plan.js';
import type { RoleSpecResolutionV1 } from '../../src/contracts/role-spec-materials.js';
import type { TaskEnvelopeV1 } from '../../src/contracts/task-envelope.js';
import type { RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import type { MaterialPort, MaterialReadFactsPort } from '../../src/core/work-graph/materials/contracts.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import type { ClaimTaskInput } from '../../src/core/work-graph/tasks/claim-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/tasks/contracts.js';
import type {
  AuthorizeConfiguration, CompletedHistoryBoundary, ExecutionEntryDependencies, ExecutionEntryPort,
  KernelExecutionBinding, ObservedExecutionHistory, TaskEntryPermit, TaskResultObservation,
} from '../../src/core/work-graph/tasks/execution-entry-contracts.js';
import { createExecutionEntryService } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { EXECUTION_ENTRY_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/execution-entry-codecs.js';
import { MODEL_REQUEST_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/model-request-codecs.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/tasks/execution-read-contracts.js';
import type { ModelRequestPort, ActualModelRequest } from '../../src/core/work-graph/tasks/model-call-contracts.js';
import { createModelCallService } from '../../src/core/work-graph/tasks/model-call-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';

export const B2_AT = CLAIM_FIXTURE_AT;
export const B2_INPUT = 'Implement A using the accepted task and plan contract.';
export const B2_HOST = {
  configurationRevision: 'b2-host-config-1',
  permissions: { policyRevision: 'legacy-template', tools: ['read'], writeScope: [] as string[] },
  hostTemplate: { templateId: 'builder', revision: '1', digest: artifactBodyDigest('trusted builder template revision 1') },
};
export type B2Records = TaskClaimFixture['records'];
export type B2Ports = { entry: ExecutionEntryPort; model: ModelRequestPort };
export type B2Admitted = { prepared: PreparedTaskExecution; permit: TaskEntryPermit };
export type B2TerminalObservation = TaskResultObservation & {
  kernelSource: NonNullable<TaskResultObservation['kernelSource']>;
  completedHistoryBoundary: CompletedHistoryBoundary;
  history: ObservedExecutionHistory;
};


/**
 * Optional real material dependencies. The default `ports()` still wires the
 * explicit unsupported fixture seam; a caller injects the SAME real
 * authority/index/bodies/source chain (plans/materials/materialFacts) here.
 */
export type B2PortOverrides = {
  plans?: ExecutionEntryDependencies['plans'];
  materials?: MaterialPort;
  materialFacts?: MaterialReadFactsPort;
};

export type B2PreparedOptions = {
  claim?: TaskClaim;
  input?: string;
  role?: RoleSpecResolutionV1;
  hostTemplate?: PreparedTaskManifestV1['hostTemplate'];
  permissions?: TaskEnvelopeV1['permissions'];
  selectedTaskInputs?: Array<{ requirementId: string; ref: ArtifactRef }>;
  materialBasis?: MaterialBasisV1 | null;
  additionalMaterialRefs?: ArtifactRef[];
  materialAccessRefs?: MaterialAccessGrantRef[];
};

export type B2ExecutionFixture = {
  base: TaskClaimFixture;
  ctx: CoreCallContext;
  claim: TaskClaim;
  secondClaim: TaskClaim;
  run: RunSnapshot;
  kernel: KernelExecutionBinding;
  kernelFor(claim: TaskClaim): Promise<KernelExecutionBinding>;
  entry: ExecutionEntryPort;
  model: ModelRequestPort;
  bodies: RawArtifactStorePort;
  buildPrepared(options?: B2PreparedOptions): Promise<PreparedTaskExecution>;
  permit(overrides?: Partial<TaskEntryPermit>): TaskEntryPermit;
  secondPermit(overrides?: Partial<TaskEntryPermit>): TaskEntryPermit;
  runPin(): Promise<VersionPin>;
  secondRunPin(): Promise<VersionPin>;
  terminalEvent(overrides?: Partial<RuntimeEventV1>): RuntimeEventV1;
  completedBoundary(position?: number): CompletedHistoryBoundary;
  observedHistory(position?: number): ObservedExecutionHistory;
  sessionAvailability(): Promise<string | null>;
  ports(records?: B2Records, overrides?: B2PortOverrides): B2Ports;
  host: { enabled: boolean; calls: number };
  read(claim?: TaskClaim, records?: B2Records): Promise<TaskExecutionRecord>;
  authorize(options?: { prepared?: PreparedTaskExecution; ports?: B2Ports; consumerId?: string }): Promise<B2Admitted>;
  start(options?: { prepared?: PreparedTaskExecution; ports?: B2Ports }): Promise<B2Admitted>;
  enter(options?: { prepared?: PreparedTaskExecution; ports?: B2Ports }): Promise<B2Admitted>;
  pin(claim?: TaskClaim, records?: B2Records): Promise<VersionPin>;
  currentPermit(claim?: TaskClaim, records?: B2Records): Promise<TaskEntryPermit>;
  actualRequest(admitted: B2Admitted, requestId?: string): ActualModelRequest;
  terminalObservation(admitted: B2Admitted): B2TerminalObservation;

  close(): Promise<void>;
};

export async function createB2ExecutionFixture(
  kind: ClaimFixtureKind = 'memory',
  additionalSchemas: RecordBackendSchemas = { records: [], events: [] },
): Promise<B2ExecutionFixture> {
  const base = await createTaskClaimFixture(kind, {
    records: [...EXECUTION_ENTRY_RECORD_SCHEMAS.records, ...MODEL_REQUEST_RECORD_SCHEMAS.records,
      ...additionalSchemas.records],
    events: [...EXECUTION_ENTRY_RECORD_SCHEMAS.events, ...MODEL_REQUEST_RECORD_SCHEMAS.events,
      ...additionalSchemas.events],
    lookups: [...EXECUTION_ENTRY_RECORD_SCHEMAS.lookups ?? [], ...MODEL_REQUEST_RECORD_SCHEMAS.lookups ?? [],
      ...(additionalSchemas.lookups ?? [])],
  });
  const claimed = await base.service.claimTask(base.ctx, await base.buildRequest());
  if (claimed.status !== 'committed') throw new Error(`B2 fixture claim failed: ${JSON.stringify(claimed)}`);
  const claim = claimed.value;
  const reads = createRunStateReader({ records: base.records });
  const runRead = await reads.readExecution(base.ctx, claim.runRef);
  if (runRead.status !== 'ready') throw new Error(`B2 fixture run read failed: ${JSON.stringify(runRead)}`);
  const run = runRead.value.run;
  const kernel: KernelExecutionBinding = {
    adapterId: runRead.value.session.kernel.adapterId,
    kernelSessionId: runRead.value.session.kernel.kernelSessionId,
    runId: 'b2-kernel-run',
    turnId: 'b2-kernel-turn',
  };

  // A second real, independent claim: new Goal + accepted Plan + mapped Session.
  const goal2Ref: GoalRef = { aggregateType: 'Goal', projectId: base.scope.projectId, goalId: 'b2-second-goal' };
  const createdGoal2 = await base.goals.createGoal(base.ctx, { meta: {
    requestId: 'b2-create-goal-2',
    expected: [{ ref: base.projectRef, revision: 1 }, { ref: base.workspaceRef, revision: 1 }] },
    input: { goalId: goal2Ref.goalId, workspace: base.scope, objective: 'B2 second independent run' } });
  if (createdGoal2.status !== 'committed') throw new Error(`B2 fixture goal2 failed: ${JSON.stringify(createdGoal2)}`);
  const plan2Ref: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: base.scope.projectId, planId: 'b2-second-plan' };
  const draft2: PlanRevisionDraft = { schemaVersion: 1, planId: plan2Ref.planId, planRevision: 1, goalId: goal2Ref.goalId, stages: [],
    tasks: [
      { taskId: 'b2-second-task', title: 'B2 second task', requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 'b2-second-gate', title: 'B2 second gate', requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: 'b2-second-task', role: 'builder', instruction: 'B2 second task' }],
    obligations: [{ obligationId: 'b2-second-obligation', title: 'B2 second delivery', requirementLevel: 'required', taskIds: ['b2-second-task', 'b2-second-gate'],
      verificationRequirements: [{ requirementId: 'b2-second-check', requirementLevel: 'required', kind: 'test', description: 'B2 second test' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } };
  const proposed2 = await base.plans.proposePlan(base.ctx, { meta: { requestId: 'b2-propose-plan-2', expected: [{ ref: goal2Ref, revision: 1 }] },
    input: { goalRef: goal2Ref, basedOn: null, draft: draft2, reason: { text: 'B2 second plan', sources: [] } } });
  if (proposed2.status !== 'committed' || proposed2.value.issues.length > 0) throw new Error(`B2 fixture plan2 proposal failed: ${JSON.stringify(proposed2)}`);
  const applied2 = await base.plans.applyPlanChange(base.ctx, { meta: { requestId: 'b2-apply-plan-2', expected: [{ ref: goal2Ref, revision: 1 }] },
    input: { proposalRef: proposed2.value.ref, expectedProposalRevision: proposed2.value.revision, decisionRefs: [] } });
  if (applied2.status !== 'committed') throw new Error(`B2 fixture plan2 adoption failed: ${JSON.stringify(applied2)}`);
  const session2 = await base.createSession('b2-session-second');
  const goal2Read = await base.plans.queryGoal(base.ctx, goal2Ref);
  if (goal2Read.status !== 'ready') throw new Error(`B2 fixture goal2 read failed: ${JSON.stringify(goal2Read)}`);
  const session2Card = await base.sessionsPort.readSession(base.ctx, session2);
  if (session2Card.status !== 'ready') throw new Error(`B2 fixture session2 read failed: ${JSON.stringify(session2Card)}`);
  const request2: GraphWrite<ClaimTaskInput> = {
    input: { goalRef: goal2Ref, planRef: plan2Ref, taskId: 'b2-second-task', sessionRef: session2, roleBinding: base.roleBinding, budget: base.budget },
    meta: { requestId: 'b2-claim-second', expected: [
      { ref: goal2Ref, revision: goal2Read.value.goal.revision },
      { ref: base.workspaceRef, revision: 1 },
      { ref: plainSessionRefToAggregate(session2), revision: session2Card.value.record.revision },
    ] },
  };
  const claimed2 = await base.service.claimTask(base.ctx, request2);
  if (claimed2.status !== 'committed') throw new Error(`B2 fixture second claim failed: ${JSON.stringify(claimed2)}`);
  const secondClaim = claimed2.value;

  let seq = 0;
  const now = () => B2_AT;
  const eventId = () => `b2-event-${++seq}`;
  const roles = createRoleConfigurationService({ records: base.records, now, eventId });
  const bodies = new RawArtifactBodyStore();
  const materials: MaterialPort = {
    async storeArtifact() { return { status: 'rejected', code: 'unsupported', reason: 'B2 fixture does not write material' }; },
    async openArtifact() { return { status: 'rejected', code: 'unsupported', reason: 'B2 fixture does not open material' }; },
  };
  const host = { enabled: true, calls: 0 };
  const authorizeConfiguration: AuthorizeConfiguration = async (ctx, input) => {
    host.calls++;
    const expectedRole = { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' };
    if (!host.enabled || ctx.projectId !== base.scope.projectId || ctx.workspaceId !== base.scope.workspaceId
      || input.run.ref.projectId !== base.scope.projectId
      || canonicalJson(input.sessionRole) !== canonicalJson(expectedRole)
      || input.configurationRevision !== B2_HOST.configurationRevision
      || canonicalJson(input.permissions) !== canonicalJson(B2_HOST.permissions)
      || canonicalJson(input.hostTemplate) !== canonicalJson(B2_HOST.hostTemplate)) {
      return { status: 'rejected', code: 'forbidden', reason: 'fixed test Host configuration does not authorize this request' };
    }
    return { status: 'ready', value: structuredClone(B2_HOST) };
  };
  function ports(records: B2Records = base.records, overrides: B2PortOverrides = {}): B2Ports {
    const deps: ExecutionEntryDependencies = {
      records, reads: createRunStateReader({ records }),
      roles: createRoleConfigurationService({ records, now, eventId }),
      plans: overrides.plans ?? base.plans, materials: overrides.materials ?? materials,
      ...(overrides.materialFacts !== undefined ? { materialFacts: overrides.materialFacts } : {}),
      bodies, authorizeConfiguration,
      now, eventId, newId: () => `b2-id-${++seq}`,
    };
    return { entry: createExecutionEntryService(deps), model: createModelCallService(deps) };
  }
  const { entry, model } = ports();

  async function buildPrepared(options: B2PreparedOptions = {}): Promise<PreparedTaskExecution> {
    const targetClaim = options.claim ?? claim;
    const target = await read(targetClaim);
    const input = options.input ?? B2_INPUT;
    const inputDigest = artifactBodyDigest(input);
    const permissions = options.permissions ?? structuredClone(B2_HOST.permissions);
    const roleFacts = await roles.resolveRoleBindingFacts(base.ctx, { roleBinding: target.run.roleBinding, declaredPermissions: permissions });
    if (roleFacts.result.status !== 'ready') throw Error('real role fixture could not resolve');
    const role = options.role ?? roleFacts.result.value;
    const hostTemplate = options.hostTemplate === undefined ? structuredClone(B2_HOST.hostTemplate) : options.hostTemplate;
    const workspaceSnapshot = { workspaceId: targetClaim.workspaceId, revision: 1 };
    const selectedTaskInputs = options.selectedTaskInputs ?? [];
    const materialBasis = options.materialBasis === undefined ? null : options.materialBasis;
    const additionalMaterialRefs = options.additionalMaterialRefs ?? [];
    const materialAccessRefs = options.materialAccessRefs ?? [];
    const manifest: PreparedTaskManifestV1 = {
      schemaVersion: 1, kind: 'task_execution', claim: targetClaim, role, hostTemplate,
      roleBinding: base.roleBinding, hostConfigurationRevision: 'b2-host-config-1',
      sessionRole: target.session.role,
      workspaceSnapshot, permissions, budget: base.budget, selectedTaskInputs,
      materialBasis, materialAccessRefs, additionalMaterialRefs, deliveryRefs: [],
      sourceRefs: [], input, inputDigest,
    };
    const manifestJson = JSON.stringify(manifest);
    const stored = await bodies.put({ body: manifestJson,
      contentType: 'application/vnd.coding-platform.task-execution-manifest+json;version=1',
      sourceRefs: [{ kind: 'workspace', refId: targetClaim.workspaceId, revision: String(workspaceSnapshot.revision) }],
      origin: { kind: 'run', owner: targetClaim.runRef }, requestedAt: now() });
    if (stored.status !== 'ready') throw new Error(`B2 fixture manifest store failed: ${JSON.stringify(stored)}`);
    const envelope: TaskEnvelopeV1 = {
      schemaVersion: 1, envelopeId: 'b2-envelope-1', projectId: targetClaim.task.projectId,
      workspaceId: targetClaim.workspaceId, goalId: targetClaim.task.goalId, taskId: targetClaim.task.taskId,
      runRef: targetClaim.runRef, attemptRef: targetClaim.attemptRef, planRef: targetClaim.planRef,
      roleBinding: base.roleBinding, workspaceSnapshot, permissions, budget: base.budget,
      sourceRefs: [], bundleRef: stored.value.ref,
    };
    const inputBinding: PreparedTaskExecution['inputBinding'] = {
      schemaVersion: 1, inputDigest, manifestDigest: artifactBodyDigest(manifestJson), materialAccessRefs,
      ...(additionalMaterialRefs.length > 0 ? { additionalMaterialRefs } : {}), deliveryRefs: [] };
    return { kind: 'task', claim: targetClaim, envelope, inputBinding };
  }
  function permit(overrides: Partial<TaskEntryPermit> = {}): TaskEntryPermit {
    return { claim, consumerId: 'runtime-a', entryGeneration: 1, authorizationRevision: 1, inputDigest: artifactBodyDigest(B2_INPUT), ...overrides };
  }
  function secondPermit(overrides: Partial<TaskEntryPermit> = {}): TaskEntryPermit {
    return { claim: secondClaim, consumerId: 'runtime-b', entryGeneration: 1, authorizationRevision: 1, inputDigest: artifactBodyDigest(B2_INPUT), ...overrides };
  }
  async function pinFor(target: RunRef): Promise<VersionPin> {
    const read = await reads.readExecution(base.ctx, target);
    if (read.status !== 'ready') throw new Error(`B2 fixture pin read failed: ${JSON.stringify(read)}`);
    return { ref: target, revision: read.value.run.revision };
  }
  function terminalEvent(overrides: Partial<RuntimeEventV1> = {}): RuntimeEventV1 {
    return { eventType: 'run_completed', schemaVersion: 1, eventId: 'b2-runtime-complete',
      runRef: claim.runRef, sequence: 2, occurredAt: B2_AT, payload: { kind: 'completed', exitCode: 0 }, ...overrides };
  }
  function completedBoundary(position = 4): CompletedHistoryBoundary {
    return { source: { ...kernel, position }, cursor: 'b2-trusted-runtime-completed-boundary-4' };
  }
  function observedHistory(position = 3): ObservedExecutionHistory {
    return { kernel, startPosition: 2, observedThroughPosition: position, endPosition: null };
  }
  async function read(target: TaskClaim = claim, records: B2Records = base.records): Promise<TaskExecutionRecord> {
    const result = await createRunStateReader({ records }).readExecution(base.ctx, target.runRef);
    if (result.status !== 'ready') throw Error(`real execution fixture read: ${JSON.stringify(result)}`);
    return result.value;
  }
  async function pin(target: TaskClaim = claim, records: B2Records = base.records): Promise<VersionPin> {
    const current = await read(target, records);
    return { ref: target.runRef, revision: current.run.revision };
  }
  async function currentPermit(target: TaskClaim = claim, records: B2Records = base.records): Promise<TaskEntryPermit> {
    const current = await read(target, records);
    const auth = current.run.executionAuthorization;
    if (!auth || !('schemaVersion' in auth) || auth.schemaVersion !== 2) throw Error('no formal V2 entry binding');
    return { claim: target, consumerId: auth.consumerId, entryGeneration: auth.generation,
      authorizationRevision: auth.revision, inputDigest: auth.inputDigest };
  }
  async function authorize(options: { prepared?: PreparedTaskExecution; ports?: B2Ports; consumerId?: string } = {}): Promise<B2Admitted> {
    const prepared = options.prepared ?? await buildPrepared();
    const p = options.ports ?? { entry, model };
    const result = await p.entry.authorizeRuntimeEntry(base.ctx, { input: { prepared, consumerId: options.consumerId ?? 'runtime-a' },
      meta: { requestId: `b2-formal-authorize-${++seq}`, expected: [await pin(prepared.claim)] } });
    expect(result, 'formal authorize prerequisite').toMatchObject({ status: 'committed', replayed: false });
    if (result.status !== 'committed') throw Error('authorize prerequisite not implemented');
    return { prepared, permit: result.value };
  }
  async function kernelFor(target: TaskClaim): Promise<KernelExecutionBinding> {
    const current = await read(target);
    return { ...kernel, adapterId: current.session.kernel.adapterId,
      kernelSessionId: current.session.kernel.kernelSessionId };
  }
  async function start(options: { prepared?: PreparedTaskExecution; ports?: B2Ports } = {}): Promise<B2Admitted> {
    const admitted = await authorize(options);
    const p = options.ports ?? { entry, model };
    const result = await p.entry.beginRuntimeEntry(base.ctx, { input: { permit: admitted.permit, kernel: await kernelFor(admitted.prepared.claim) },
      meta: { requestId: `b2-formal-begin-${++seq}`, expected: [await pin(admitted.prepared.claim)] } });
    expect(result, 'formal fresh begin prerequisite').toMatchObject({ status: 'committed', replayed: false });
    if (result.status !== 'committed') throw Error('begin prerequisite not implemented');
    return { ...admitted, permit: { ...admitted.permit, authorizationRevision: result.value.authorization.revision } };
  }
  async function enter(options: { prepared?: PreparedTaskExecution; ports?: B2Ports } = {}): Promise<B2Admitted> {
    const started = await start(options);
    const boundKernel = await kernelFor(started.prepared.claim);
    const p = options.ports ?? { entry, model };
    const result = await p.entry.recordExecutionEntered(base.ctx, { input: { permit: started.permit, enteredAt: B2_AT,
      kernelSource: { ...boundKernel, position: 3 }, history: { ...observedHistory(3), kernel: boundKernel } },
      meta: { requestId: `b2-formal-entered-${++seq}`, expected: [await pin(started.prepared.claim)] } });
    expect(result, 'formal entered prerequisite').toMatchObject({ status: 'committed', value: { status: 'running' } });
    return { ...started, permit: await currentPermit(started.prepared.claim) };
  }
  function actualRequest(admitted: B2Admitted, requestId = 'b2-actual-request'): ActualModelRequest {
    return { permit: admitted.permit, requestId, requestDigest: artifactBodyDigest(JSON.stringify({ requestId, input: B2_INPUT })),
      contextInputDigest: admitted.prepared.inputBinding.inputDigest,
      manifestDigest: admitted.prepared.inputBinding.manifestDigest };
  }
  function terminalObservation(admitted: B2Admitted) {
    return { claim: admitted.prepared.claim,
      entry: { consumerId: admitted.permit.consumerId, entryGeneration: admitted.permit.entryGeneration },
      event: terminalEvent(), kernelSource: { ...kernel, position: 4 }, completedHistoryBoundary: completedBoundary(4),
      history: { ...observedHistory(4), endPosition: 4 } };
  }

  return {
    base, ctx: base.ctx, claim, secondClaim, run, kernel, kernelFor, entry, model, bodies,
    buildPrepared, permit, secondPermit, ports, host, read, pin, currentPermit, authorize, start, enter, actualRequest, terminalObservation,
    runPin: () => pinFor(claim.runRef),
    secondRunPin: () => pinFor(secondClaim.runRef),
    terminalEvent, completedBoundary, observedHistory,
    async sessionAvailability() {
      const card = await base.sessionsPort.readSession(base.ctx, claim.sessionRef);
      return card.status === 'ready' ? card.value.availability : null;
    },
    close: () => base.close(),
  };
}

/** Real commit race, not merely two sequential requests carrying a stale pin. */
export function synchronizeB2Commits(records: B2Records) {
  let arrivals = 0;
  let release!: () => void;
  let reject!: (error: Error) => void;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ready = new Promise<void>((resolve, fail) => { release = resolve; reject = fail; });
  const wrapped: B2Records = { ...records, async commit(batch) {
    arrivals++;
    if (arrivals === 1) timer = setTimeout(() => reject(Error('second writer never reached the commit race')), 2000);
    if (arrivals === 2) { clearTimeout(timer); release(); }
    await ready;
    return records.commit(batch);
  } };
  return { records: wrapped, arrivals: () => arrivals };
}

export function b2Key(ref: object): string { return canonicalJson(ref as JsonValue); }
