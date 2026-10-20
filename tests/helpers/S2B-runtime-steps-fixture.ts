/**
 * Shared S2B Runtime steps (TP-096).
 *
 * The timeline fixture builds its Runs through this helper instead of calling
 * the entry owner itself. Every Run is a real claim (the caller's `TaskClaim`),
 * prepared by the production `createExecutionPreparation` over the fixture's own
 * records/bodies/Kernel stores, and entered by the production
 * `runtime.port.startRun` (authorize / begin / recordExecutionEntered with the
 * real Kernel Turn identity and positions).
 *
 * The scripted model is held at an A3 gate after entry: the caller decides when
 * the real terminal happens (a normal final text reply, a `beforeReply` fault
 * the Runtime records as `run_crashed`, a delivered cancel, or a Host tool-call
 * limit). The helper never builds a manifest, envelope, prepared value, event
 * or terminal fact, and it modifies neither the manifest nor the prepared value.
 *
 * It also owns the public completion-policy installation both S2B fixtures need
 * (`createProjectBootstrapServices` install + activate).
 */
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { RuntimeBudget } from '../../src/contracts/runtime-budget.js';
import type { ControlIntentRef } from '../../src/contracts/control-intent.js';
import type { TaskEnvelopeV1 } from '../../src/contracts/task-envelope.js';
import type { RunRef, RunSnapshot } from '../../src/contracts/dispatch.js';
import type { RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
import type { RecordOrderedLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type { RuntimeExecutionDependencies, RuntimeHostBindings, ResolvedRuntimeConfiguration } from '../../src/core/agent-runtime/execution-contracts.js';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import { createSessionHistoryCursorOwner, createSessionOperations } from '../../src/core/agent-runtime/session-operations.js';
import {
  reconcileRunAtStartup, type RunReconcileClassifierDependencies, type RunReconcileReport,
} from '../../src/core/agent-runtime/run-reconcile.js';
import { createExecutionHistoryReader } from '../../src/core/agent-runtime/observation-recovery.js';
import { createGraphExecutionHistoryReader } from '../../src/core/agent-runtime/graph-execution-history.js';
import { createKernelStoreRegistry, type KernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createUnknownCallReviewService } from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import { createExecutionHistoryService } from '../../src/core/work-graph/tasks/execution-history-service.js';
import { createExecutionEntryService } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { createModelCallService } from '../../src/core/work-graph/tasks/model-call-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createSourceAuthorityReader } from '../../src/core/work-graph/source-authority-reader.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { createRunReconcileService } from '../../src/core/work-graph/tasks/run-reconcile-service.js';
import { createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { completionPolicyContentDigest } from '../../src/contracts/governance.js';
import { readTaskClosure } from '../../src/core/work-graph/tasks/plan-readers.js';
import type {
  AuthorizeConfiguration, ExecutionEntryPort, HostInstanceFacts, KernelExecutionBinding, TaskEntryPermit,
  TaskResultObservation,
} from '../../src/core/work-graph/model/execution-entry-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import { preparationHost, prepareTaskForReal, type TaskClaimFixture } from './task-claim-fixture.js';
import { B2_HOST } from './B2-execution-fixture.js';
import { createScriptedModel, type ScriptedReply } from './B2-runtime-fixture.js';

/** The Host tools every work Run of these fixtures may consume. */
export const S2B_RUNTIME_HOST_TOOLS = ['read'] as const;
const HOST_BUDGET: RuntimeBudget = { contextWindowTokens: 128000, inputTokens: null, outputTokens: null,
  maxRequests: 8, maxToolCalls: 16, timeoutMs: 30_000, perResponseTokens: 512 };

export type S2BRuntimeHostGrant = {
  configurationRevision: string;
  permissions: TaskEnvelopeV1['permissions'];
  hostTemplate: NonNullable<ResolvedRuntimeConfiguration['hostTemplate']>;
};

export type S2BRuntimeStepsOptions = {
  base: TaskClaimFixture;
  bodies: RawArtifactStorePort;
  ctx: CoreCallContext;
  directory: string;
  scope: WorkspaceScope;
  now: () => string;
  setClock: (at: string) => void;
  eventId: () => string;
  newId: () => string;
  /** The consumer recorded on every Run this helper starts. */
  consumerId: string;
  /** Wire the real Session mailbox (the yielded/reply flows need it). */
  withMailbox?: boolean;
  /** The trusted Host grant; the default is the reviewed B2 Host. */
  host?: S2BRuntimeHostGrant;
  /**
   * A3 gate: awaited inside the real start, immediately before the production
   * `beginRuntimeEntry` of the Run being started. The gate receives the real
   * authorization permit and the Kernel binding the Runtime is about to begin
   * with; it returns nothing and cannot replace either value. Absent (the
   * default) begins at once.
   */
  beforeBegin?: (request: { permit: TaskEntryPermit; kernel: KernelExecutionBinding }) => Promise<void> | void;
  /**
   * The Workspace revision the Host reports to the Runtime for this fixture's
   * scope. The default is 1 (every existing caller's world); a caller whose
   * Run was claimed against a moved Workspace passes that revision.
   */
  workspaceRevision?: number;
  /**
   * The real Kernel store registry the Runtime reads; the default is this
   * fixture's single `r4c-claim-kernel` store on `directory/kernel.sqlite`.
   * A caller whose row names an A2 Kernel-read failure may pass a delegating
   * wrapper that fails the named read and otherwise returns the real result.
   */
  kernelStores?: KernelStoreRegistry;
  /**
   * Optional observer of every `recordRunResult` submission the real Runtime
   * makes: it receives the exact request the Runtime built and the owner's
   * result, and returns nothing. Absent (the default) changes no behaviour; a
   * caller uses it to replay the request the Runtime really committed.
   */
  observeResult?: (request: GraphWrite<TaskResultObservation>, result: WriteResult<RunSnapshot>) => void;
  /**
   * W2b-21: the real user-decision owner the Runtime binds for a Run whose Host
   * grant selects the user-decision tools (`execution-driver.ts:259` refuses such
   * a Run without it). Absent (the default) binds none, as before.
   */
  decisionMessages?: RuntimeExecutionDependencies['decisionMessages'];
};

export type S2BRunStartOptions = {
  /** The real Run start instant (the production entered fact reads this clock). */
  at: string;
  /** The scripted model replies; the first one is held at the gate. */
  replies: readonly ScriptedReply[];
  tools?: readonly string[];
  writeScope?: readonly string[];
  budget?: Partial<RuntimeBudget>;
};

export type S2BRunHandle = {
  runRef: RunRef;
  /** Resolves after the production `recordExecutionEntered` (the model gate opened). */
  entered: Promise<void>;
  /** Resolves when `startRun` settles; the Run is ended when it resolves. */
  settled: Promise<void>;
  /** Release the held model reply unchanged (a normal final reply). */
  release(): void;
  /** Release with a `beforeReply` fault the Runtime records as `run_crashed`. */
  crash(error: string): void;
};

export type S2BRuntimeSteps = {
  readonly records: S2BRuntimeStepsOptions['base']['records'] & RecordOrderedLookupPort;
  readonly runtime: ReturnType<typeof createAgentRuntime>;
  readonly mailbox: ReturnType<typeof createSessionMailbox> | undefined;
  readonly controls: ReturnType<typeof createRunControlService>;
  installStaticCompletionPolicy(policyId: string): Promise<void>;
  start(claim: TaskClaim, options: S2BRunStartOptions): Promise<S2BRunHandle>;
  /** End a held Run: a final reply, a Runtime crash, a delivered cancel or a Host tool limit. */
  finish(handle: S2BRunHandle, at: string, kind: 'completed' | 'crashed' | 'cancelled' | 'budget_exhausted'): Promise<void>;
  /**
   * A person's pause of a held Run (W2b-08): the real `submitControl(pause)`,
   * delivered to the live Run, then the held reply is released unchanged. The
   * Kernel stops the Turn at its next safe point, the Runtime records the
   * paused observation and the live start settles with the Run still running
   * (paused). Additive: no other step calls it.
   */
  pauseAtSafePoint(handle: S2BRunHandle, at: string): Promise<ControlIntentRef>;
  /**
   * A Host restart for one Run (W2b-08; rule sheet A1 "Host start-up and
   * restart"): fresh WorkGraph owners over the same records and Kernel stores
   * under another Host instance that holds the lease, and the production
   * start-up classifier (`reconcileRunAtStartup`), which reads the Kernel
   * history and books what it proves. Additive: no other step calls it.
   */
  restartAndReconcile(runRef: RunRef, hostInstanceId: string): Promise<RunReconcileReport>;
  /** Release every still-held Run (fixture close) and await their settlement. */
  close(): Promise<void>;
};

/** Canonical ref key, as the reviewed B2 fixtures use. */
function refKey(ref: object): string {
  return canonicalJson(ref as unknown as JsonValue);
}

export type StaticCompletionPolicyInput = {
  base: TaskClaimFixture;
  ctx: CoreCallContext;
  records: TaskClaimFixture['records'];
  now: () => string;
  eventId: () => string;
  policyId: string;
};

/** The public project-bootstrap install + activate a static completion policy. */
export async function installStaticCompletionPolicyFor(input: StaticCompletionPolicyInput): Promise<void> {
  const { base, ctx, records, now, eventId, policyId } = input;
  const bootstrap = createProjectBootstrapServices({ records, now, eventId });
  const projectKey = refKey(base.projectRef);
  const projectRead = await records.readMany([projectKey]);
  if (projectRead.status !== 'ready') throw new Error(`S2B policy project read failed: ${JSON.stringify(projectRead)}`);
  const project = projectRead.value.records.find(record => record.refKey === projectKey);
  if (project === undefined) throw new Error('S2B policy project record is missing');
  const projectRevision = (JSON.parse(project.json) as { revision: number }).revision;
  const content = { schemaVersion: 1 as const, requirementKinds: ['static'],
    minimumRequiredRequirementsPerObligation: 1 };
  const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId: base.scope.projectId,
    policyId, revision: 1 };
  const installed = await bootstrap.completionPolicies.installCompletionPolicy(ctx, {
    input: { policyId, contentRevision: 1, content },
    meta: { requestId: `${policyId}-install`, expected: [
      { ref: base.projectRef, revision: projectRevision }, { ref: policyRef, revision: 0 },
    ] },
  });
  if (installed.status !== 'committed') throw new Error(`S2B policy install failed: ${JSON.stringify(installed)}`);
  const activeRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId: base.scope.projectId };
  const activeRead = await records.readMany([refKey(activeRef)]);
  if (activeRead.status !== 'ready') throw new Error(`S2B active policy read failed: ${JSON.stringify(activeRead)}`);
  const active = activeRead.value.records.find(record => record.refKey === refKey(activeRef));
  if (active === undefined) throw new Error('S2B active policy pointer is missing');
  const activeRevision = (JSON.parse(active.json) as { revision: number }).revision;
  const activated = await bootstrap.completionPolicies.activateCompletionPolicy(ctx, {
    input: { target: { ref: policyRef, digest: completionPolicyContentDigest({ schemaVersion: 1, policyId,
      contentRevision: 1, content }) } },
    meta: { requestId: `${policyId}-activate`, expected: [
      { ref: base.projectRef, revision: projectRevision }, { ref: activeRef, revision: activeRevision },
    ] },
  });
  if (activated.status !== 'committed') throw new Error(`S2B policy activate failed: ${JSON.stringify(activated)}`);
}

export async function createS2BRuntimeSteps(options: S2BRuntimeStepsOptions): Promise<S2BRuntimeSteps> {
  const { base, bodies, ctx, directory, scope } = options;
  const hostGrant: S2BRuntimeHostGrant = options.host ?? {
    configurationRevision: B2_HOST.configurationRevision,
    permissions: B2_HOST.permissions,
    hostTemplate: B2_HOST.hostTemplate,
  };
  const records = base.records as S2BRuntimeStepsOptions['base']['records'] & RecordOrderedLookupPort;
  const now = options.now;
  const eventId = options.eventId;
  const newId = options.newId;

  const executions = createRunStateReader({ records });
  const roles = createRoleConfigurationService({ records, now, eventId });
  const materialReads = createMaterialRecordReaders(records);
  const materials = createMaterialService({ bodies, authority: materialReads.authority, now });
  const sessions = base.sessionsPort;
  const kernelStores = options.kernelStores ?? await createKernelStoreRegistry({ entries: [{ adapterId: 'r4c-claim-kernel',
    storeKey: 'r4c-claim-kernel-store', workspace: scope, databasePath: `${directory}/kernel.sqlite` }] });
  const sessionOperations = createSessionOperations({ sessions, kernelStores });
  const activity = createExecutionHistoryReader({ history: sessionOperations });
  const graphHistory = createGraphExecutionHistoryReader({ executions, history: activity });
  const sourceAuthority = (): ReturnType<typeof createSourceAuthorityReader> =>
    createSourceAuthorityReader({ authority: materialReads.authority });
  const controls = createRunControlService({ records, authority: materialReads.authority, reads: executions, now, eventId });

  /** The Host grant of each Run this helper started, keyed by its real Run id. */
  const configurations = new Map<string, ResolvedRuntimeConfiguration>();
  let runtime!: ReturnType<typeof createAgentRuntime>;

  const authorizeConfiguration: AuthorizeConfiguration = async (callCtx, input) => {
    const configuration = configurations.get(input.run.ref.runId);
    if (configuration === undefined) {
      return { status: 'rejected', code: 'forbidden', reason: 'the S2B runtime steps Host has no grant for this Run' };
    }
    const role = await roles.resolveRoleBinding(callCtx, {
      roleBinding: input.run.roleBinding,
      declaredPermissions: input.permissions,
    });
    if (role.status !== 'ready') return role;
    const permissions = input.run.envelope?.permissions ?? input.permissions;
    const ceiling = role.value.status === 'resolved' ? role.value.spec.permissions : null;
    const template = input.sessionRole.kind === 'legacy_template'
      ? { ...hostGrant.hostTemplate } : null;
    if (configuration.configurationRevision !== input.configurationRevision
      || refKey(permissions) !== refKey(input.permissions)
      || permissions.policyRevision !== input.run.roleBinding.policyRevision
      || !permissions.tools.every(tool => configuration.tools.includes(tool) && (!ceiling || ceiling.tools.includes(tool)))
      || !permissions.writeScope.every(path => configuration.writeScope.includes(path))
      || (ceiling?.writeScope === 'none' && permissions.writeScope.length !== 0)
      || refKey({ template }) !== refKey({ template: input.hostTemplate })) {
      return { status: 'rejected', code: 'forbidden', reason: 'Persisted configuration differs from the real Host grant' };
    }
    return { status: 'ready', value: { configurationRevision: configuration.configurationRevision,
      permissions: structuredClone(permissions), hostTemplate: template } };
  };

  const host: RuntimeHostBindings = {
    async resolveConfiguration(callCtx, input) {
      if (callCtx.projectId !== scope.projectId || callCtx.workspaceId !== scope.workspaceId) {
        return { status: 'rejected', code: 'forbidden', reason: 'the S2B runtime steps Host is not bound to this workspace' };
      }
      const configuration = configurations.get(input.runRef.runId);
      if (configuration === undefined) {
        return { status: 'rejected', code: 'forbidden', reason: 'the S2B runtime steps Host has no grant for this Run' };
      }
      return { status: 'ready', value: configuration };
    },
  };

  const entryOwner = createExecutionEntryService({ records, reads: executions, roles, bodies,
    authorizeConfiguration, now, eventId, newId });
  const beforeBegin = options.beforeBegin;
  const observeResult = options.observeResult;
  const entry: ExecutionEntryPort = beforeBegin === undefined && observeResult === undefined ? entryOwner : {
    ...entryOwner,
    ...(beforeBegin === undefined ? {} : {
      async beginRuntimeEntry(callCtx, request) {
        await beforeBegin(request.input);
        return entryOwner.beginRuntimeEntry(callCtx, request);
      },
    }),
    ...(observeResult === undefined ? {} : {
      async recordRunResult(callCtx, request) {
        const result = await entryOwner.recordRunResult(callCtx, request);
        observeResult(request, result);
        return result;
      },
    }),
  };
  const modelRequests = createModelCallService({ records, reads: executions, roles, bodies,
    authorizeConfiguration, now, eventId });
  const unknownCallReviews = createUnknownCallReviewService({ records, reads: executions, now, eventId });
  const mailbox = options.withMailbox === true
    ? createSessionMailbox({ records, sessions, executions, roles, materials,
      runtimeAdmission: { bodies, authorizeConfiguration },
      systemActor: { kind: 'system', id: 's2b-runtime-steps' }, now, newId: eventId })
    : undefined;
  const workspaceHost: RuntimeExecutionDependencies['workspaceHost'] = {
    async resolveRoot(requested) {
      return requested.projectId === scope.projectId && requested.workspaceId === scope.workspaceId
        ? { status: 'ready', value: { root: directory, workspaceRevision: options.workspaceRevision ?? 1 } }
        : { status: 'rejected', code: 'forbidden', reason: 'Unknown scope' };
    },
    async authorize(callCtx, requested) {
      if (callCtx.projectId !== scope.projectId || callCtx.workspaceId !== scope.workspaceId
        || requested.projectId !== callCtx.projectId || requested.workspaceId !== callCtx.workspaceId) {
        return { status: 'rejected', code: 'forbidden', reason: 'Host workspace scope mismatch' };
      }
      return { status: 'ready', value: { subjectKey: refKey(callCtx.principal),
        permissionRevision: 's2b-runtime-steps@1', allowsRead: () => true } };
    },
  };
  const deps: RuntimeExecutionDependencies = {
    claims: base.service, executions, entry,
    historyWriter: createExecutionHistoryService({ records, now, eventId }),
    modelRequests, roles, plans: base.plans, sessions, materials, bodies, activity, graphHistory,
    sessionOperations, kernelStores, unknownCallReviews, sourceAuthority, workspaceHost, host, kernel, now, newId,
    ...(mailbox === undefined ? {} : { messages: mailbox }), controls,
    ...(options.decisionMessages === undefined ? {} : { decisionMessages: options.decisionMessages }),
    readTaskClosure: async (_ctx, task) => readTaskClosure(records,
      { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId }, task.taskId),
  };
  runtime = createAgentRuntime(deps);

  async function readRun(runRef: RunRef): Promise<RunSnapshot> {
    const read = await executions.readExecution(ctx, runRef);
    if (read.status !== 'ready') throw new Error(`S2B runtime steps Run read failed: ${JSON.stringify(read)}`);
    return read.value.run;
  }

  async function installStaticCompletionPolicy(policyId: string): Promise<void> {
    await installStaticCompletionPolicyFor({ base, ctx, records, now, eventId, policyId });
  }

  const held: S2BRunHandle[] = [];

  async function start(claim: TaskClaim, startOptions: S2BRunStartOptions): Promise<S2BRunHandle> {
    options.setClock(startOptions.at);
    let releaseGate!: () => void;
    const gate = new Promise<void>(resolve => { releaseGate = resolve; });
    let enteredResolve!: () => void;
    const entered = new Promise<void>(resolve => { enteredResolve = resolve; });
    const fault: { message: string | undefined } = { message: undefined };
    const scripted = createScriptedModel(startOptions.replies, async (_request, index, signal) => {
      if (index === 0) enteredResolve();
      await gate;
      signal.throwIfAborted();
      if (index === 0 && fault.message !== undefined) throw new Error(fault.message);
    });
    const budget: RuntimeBudget = { ...HOST_BUDGET, ...startOptions.budget };
    const tools = [...(startOptions.tools ?? S2B_RUNTIME_HOST_TOOLS)];
    const writeScope = [...(startOptions.writeScope ?? [])];
    const configuration: ResolvedRuntimeConfiguration = {
      configurationRevision: hostGrant.configurationRevision,
      model: { configuration: { revision: 's2b-runtime-steps-model@1', provider: 'deepseek',
        model: 's2b-runtime-steps-model', baseUrl: 'http://127.0.0.1' }, client: scripted.client },
      budget,
      hostTemplate: { ...hostGrant.hostTemplate },
      tools,
      writeScope,
      skills: { resourceRoot: 'resources/skills', enabledIds: [] },
      systemInstruction: 'S2B runtime steps static instruction',
      deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
    };
    configurations.set(claim.runRef.runId, configuration);
    const prepared = (await prepareTaskForReal(base, {
      bodies, ctx, runRef: claim.runRef,
      // A caller with its own Host grant needs that grant during preparation;
      // the default keeps the reviewed Runtime Host binding as before.
      host: options.host === undefined ? host : preparationHost({
        configurationRevision: hostGrant.configurationRevision,
        permissions: hostGrant.permissions, hostTemplate: hostGrant.hostTemplate }), now,
      directory, scope, requestId: `s2b-runtime-steps-prepare-${claim.runRef.runId}`,
    })).prepared;
    const started = runtime.port.startRun(ctx, { prepared, consumerId: options.consumerId,
      requestId: `s2b-runtime-steps-start-${claim.runRef.runId}` });
    const settled = started.then(result => {
      if (result.status !== 'ready') {
        throw new Error(`S2B runtime steps start failed: ${JSON.stringify(result)}`);
      }
    });
    settled.catch(() => undefined);
    const handle: S2BRunHandle = {
      runRef: claim.runRef,
      entered,
      settled,
      release: () => { releaseGate(); },
      crash: (error: string) => { fault.message = error; releaseGate(); },
    };
    held.push(handle);
    return handle;
  }

  async function finish(handle: S2BRunHandle, at: string, kind: 'completed' | 'crashed' | 'cancelled' | 'budget_exhausted'): Promise<void> {
    options.setClock(at);
    await handle.entered;
    if (kind === 'crashed') {
      handle.crash('S2B runtime steps: the Run failed');
    } else if (kind === 'cancelled') {
      const before = await readRun(handle.runRef);
      const submitted = await controls.submitControl(ctx, {
        input: { runRef: handle.runRef, kind: 'cancel', reason: 'S2B runtime steps cancel' },
        meta: { requestId: `s2b-runtime-steps-cancel-${handle.runRef.runId}`,
          expected: [{ ref: handle.runRef, revision: before.revision }] },
      });
      if (submitted.status !== 'committed') {
        throw new Error(`S2B runtime steps submitControl(cancel) failed: ${JSON.stringify(submitted)}`);
      }
      const delivered = await runtime.port.deliverControl?.(ctx, { intentRef: submitted.value.intent.ref });
      if (delivered === undefined || delivered.status !== 'ready') {
        throw new Error(`S2B runtime steps deliverControl(cancel) failed: ${JSON.stringify(delivered)}`);
      }
      handle.release();
    } else {
      handle.release();
    }
    await handle.settled;
    const run = await readRun(handle.runRef);
    if (run.status !== 'ended') throw new Error(`S2B runtime steps Run did not end: ${JSON.stringify(run)}`);
    if (kind === 'completed' && run.outcome !== 'completed') {
      throw new Error(`S2B runtime steps Run did not complete: ${JSON.stringify(run)}`);
    }
    if (kind === 'crashed' && run.outcome !== 'crashed') {
      throw new Error(`S2B runtime steps Run did not crash: ${JSON.stringify(run)}`);
    }
    const index = held.indexOf(handle);
    if (index >= 0) held.splice(index, 1);
  }

  async function pauseAtSafePoint(handle: S2BRunHandle, at: string): Promise<ControlIntentRef> {
    options.setClock(at);
    await handle.entered;
    const before = await readRun(handle.runRef);
    const submitted = await controls.submitControl(ctx, {
      input: { runRef: handle.runRef, kind: 'pause', reason: 'S2B runtime steps pause' },
      meta: { requestId: `s2b-runtime-steps-pause-${handle.runRef.runId}`,
        expected: [{ ref: handle.runRef, revision: before.revision }] },
    });
    if (submitted.status !== 'committed') {
      throw new Error(`S2B runtime steps submitControl(pause) failed: ${JSON.stringify(submitted)}`);
    }
    const delivered = await runtime.port.deliverControl?.(ctx, { intentRef: submitted.value.intent.ref });
    if (delivered === undefined || delivered.status !== 'ready') {
      throw new Error(`S2B runtime steps deliverControl(pause) failed: ${JSON.stringify(delivered)}`);
    }
    handle.release();
    await handle.settled;
    const run = await readRun(handle.runRef);
    if (run.status !== 'running' || run.controlState?.desiredState !== 'paused') {
      throw new Error(`S2B runtime steps Run did not pause at its safe point: ${JSON.stringify(run)}`);
    }
    const index = held.indexOf(handle);
    if (index >= 0) held.splice(index, 1);
    return submitted.value.intent.ref;
  }

  async function restartAndReconcile(runRef: RunRef, hostInstanceId: string): Promise<RunReconcileReport> {
    const hostInstance: HostInstanceFacts = { hostInstanceId, lease: 'owned' };
    const restartedReads = createRunStateReader({ records });
    const restartedRoles = createRoleConfigurationService({ records, now, eventId });
    const classifier: RunReconcileClassifierDependencies = {
      owner: createSessionHistoryCursorOwner({ kernelStores }),
      controls: createRunControlService({ records, authority: materialReads.authority, reads: restartedReads, now, eventId }),
      entry: createExecutionEntryService({ records, reads: restartedReads, roles: restartedRoles, bodies,
        authorizeConfiguration, hostInstance, now, eventId, newId }),
      reconcile: createRunReconcileService({ records, reads: restartedReads, hostInstance, now, eventId }),
      now, newId,
    };
    const record = await restartedReads.readExecution(ctx, runRef);
    if (record.status !== 'ready') throw new Error(`S2B runtime steps restart read failed: ${JSON.stringify(record)}`);
    const probe = await classifier.owner.probe({ session: record.value.session, signal: ctx.signal });
    return reconcileRunAtStartup(classifier, ctx, { record: record.value, hostInstanceId, probe });
  }

  async function close(): Promise<void> {
    const open = held.splice(0);
    for (const handle of open) {
      handle.crash('S2B runtime steps: the fixture closed with the Run still held');
    }
    await Promise.allSettled(open.map(handle => handle.settled));
  }

  return { records, runtime, mailbox, controls, installStaticCompletionPolicy, start, finish,
    pauseAtSafePoint, restartAndReconcile, close };
}
