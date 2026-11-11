/** Slice-1 fixture seams only: clocks, commit observations and lost transport replies. */
import { expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import * as hostFactory from '../../src/app/host.js';
import * as platformFactory from '../../src/composition/create-platform.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../src/core/record-store/lookup-ports.js';
import { checkAllInvariants, invariantStoreOf, readInvariantWorld, type InvariantWorld } from '../state/invariants.js';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { RoleConfigurationRef, SessionRef, SessionWorkLinkRef, WorkLinkTarget } from '../../src/contracts/core/identity.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { createTaskClaimFixture } from './task-claim-fixture.js';
import { withBackendOrderedLookup } from './ordered-lookup-forward.js';
import { createScriptedModel, type ScriptedReply } from './B2-runtime-fixture.js';
import { B2_HOST } from './B2-execution-fixture.js';
import { EXECUTION_ENTRY_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/execution-entry-codecs.js';
import { MODEL_REQUEST_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/model-request-codecs.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { SESSION_MESSAGE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { SESSION_LIFECYCLE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/lifecycle-record-codecs.js';
import { SESSION_ANOMALY_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/session-anomaly-codecs.js';
import { QUERY_JOB_RECORD_SCHEMAS } from '../../src/core/work-graph/queries/query-record-codecs.js';
import { SESSION_ACTIVITY_SCHEMAS } from '../../src/core/work-graph/sessions/session-activity.js';
import { createSqliteRawArtifactStore } from '../../src/core/record-store/sqlite-body-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { SESSION_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createUnknownCallReviewService } from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import { createExecutionEntryService } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { createModelCallService } from '../../src/core/work-graph/tasks/model-call-service.js';
import { createExecutionHistoryService } from '../../src/core/work-graph/tasks/execution-history-service.js';
import { createRunReconcileService } from '../../src/core/work-graph/tasks/run-reconcile-service.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { createTaskRequeueService } from '../../src/core/work-graph/tasks/requeue-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { unknownSessionDuty } from './session-duty-double.js';
import { createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import { createSessionFactsService } from '../../src/core/work-graph/tasks/session-facts.js';
import { createSessionLifecycleService } from '../../src/core/work-graph/sessions/session-lifecycle.js';
import { createSessionResponsibilityService } from '../../src/core/work-graph/sessions/session-responsibility-service.js';
import { createSessionResponsibilityBasisReader, readTaskClosure } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createSessionHealthService } from '../../src/core/work-graph/sessions/session-health.js';
import { createSessionAnomalyService } from '../../src/core/work-graph/tasks/session-anomaly-service.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createSessionOperations } from '../../src/core/agent-runtime/session-operations.js';
import { createExecutionHistoryReader } from '../../src/core/agent-runtime/observation-recovery.js';
import { createGraphExecutionHistoryReader } from '../../src/core/agent-runtime/graph-execution-history.js';
import { createSourceAuthorityReader } from '../../src/core/work-graph/source-authority-reader.js';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import type { RuntimeExecutionDependencies, RuntimeHostBindings, ContinuationWorkspaceSource } from '../../src/core/agent-runtime/execution-contracts.js';
import type { AuthorizeConfiguration } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import type { ArchiveRequeueOriginV1 } from '../../src/contracts/session-anomaly.js';
import { storeDirOf } from './KLS1B-host-store.js';
import { knowledgeLinesOver } from './KLS2-knowledge-lines.js';

export const S1_T0 = '2026-10-08T00:00:00.000Z';

// Legacy Session creation/lifecycle factories have no now dependency. Freeze
// Date for those facts only; actual timers and model/safe-point waits stay real.
export function installS1DateClock(): () => void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(S1_T0));
  return () => { vi.useRealTimers(); };
}

/** The shared harness hardcodes older clocks. Forward to both REAL factories
 * with the specified injected clock; no owner, Runtime or Workflow is replaced. */
export function installS1ScenarioClock(): () => void {
  const restoreDate = installS1DateClock();
  const createHost = hostFactory.createLocalWorkbenchHost;
  const openPlatform = platformFactory.openTargetPlatform;
  const host = vi.spyOn(hostFactory, 'createLocalWorkbenchHost').mockImplementation(options =>
    createHost({ ...options, now: () => S1_T0 }));
  const platform = vi.spyOn(platformFactory, 'openTargetPlatform').mockImplementation(options =>
    openPlatform({ ...options, now: () => S1_T0 }));
  return () => { platform.mockRestore(); host.mockRestore(); restoreDate(); };
}

export function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`expected ready: ${JSON.stringify(result)}`);
  return result.value;
}

export function committed<T>(result: WriteResult<T>): T {
  if (result.status !== 'committed') throw new Error(`expected committed: ${JSON.stringify(result)}`);
  return result.value;
}

/** Every owner mutation is checked against the preceding committed world. */
export async function checkedRecords(records: GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort,
  directory: string, projectId: string) {
  let previous: InvariantWorld = await readInvariantWorld(invariantStoreOf(storeDirOf(directory)), projectId);
  const check = async () => {
    const world = await readInvariantWorld(invariantStoreOf(storeDirOf(directory)), projectId);
    expect(checkAllInvariants(world, previous)).toEqual([]);
    previous = world;
    return world;
  };
  const observed: GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort = withBackendOrderedLookup({
    readMany: keys => records.readMany(keys),
    lookup: request => records.lookup(request),
    lookupCommit: request => records.lookupCommit(request),
    eventAt: cursor => records.eventAt(cursor),
    async commit(batch) {
      const result = await records.commit(batch);
      if (result.status === 'committed') await check();
      return result;
    },
  }, records);
  return { records: observed, check };
}

/** Physical records, events and receipts on the store the owners write. */
export function ledgerCounts(directory: string) {
  const db = new DatabaseSync(join(storeDirOf(directory), 'ledger.sqlite'), { readOnly: true });
  try {
    const count = (table: 'snapshots' | 'events' | 'idempotency') =>
      Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
    return { records: count('snapshots'), events: count('events'), receipts: count('idempotency') };
  } finally { db.close(); }
}

/**
 * Waits (10 ms polls, 30 s cap) until the ledger holds a scribe reminder: a restarted Host's start-up pass sends it
 * as `host-start-up-reconcile`, so counts taken before it lands would see it as a later write.
 */
export async function scribeReminderSent(directory: string): Promise<void> {
  // Counted polls, not `Date.now()`: the S1 clock fakes Date.
  for (let polls = 0; polls < 3_000; polls += 1) {
    const db = new DatabaseSync(join(storeDirOf(directory), 'ledger.sqlite'), { readOnly: true });
    let count: number;
    try {
      count = Number((db.prepare("SELECT COUNT(*) AS n FROM events WHERE instr(event_json, '\"requestId\":\"scribe-reminder:') > 0")
        .get() as { n: number }).n);
    } finally { db.close(); }
    if (count > 0) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('the restarted Host sent no scribe reminder within 30 s');
}

/** A missing Kernel mapping is a health fact; only the real health owner retires
 * the Session. This seam does not manufacture a Session/Run/Attempt snapshot. */
export async function retireS1Session(directory: string, ctx: CoreCallContext, sessionRef: SessionRef) {
  const bundles = [SESSION_RECORD_SCHEMAS, SESSION_LIFECYCLE_RECORD_SCHEMAS];
  const backend = createSqliteRecordBackend({ path: join(storeDirOf(directory), 'ledger.sqlite'), schemas: {
    records: bundles.flatMap(b => b.records), events: bundles.flatMap(b => b.events),
    lookups: bundles.flatMap(b => b.lookups ?? []),
  } });
  try {
    const checked = await checkedRecords(backend.records, directory, ctx.projectId);
    const health = createSessionHealthService({ records: checked.records,
      hostInstance: { hostInstanceId: 's1-scenario-health', lease: 'owned' },
      now: () => S1_T0, eventId: () => 's1-scenario-health-observed' });
    return await health.recordSessionHealth(ctx, { sessionRef, probe: { verdict: 'missing', activeRunId: null } });
  } finally { await backend.close(); }
}

/** Drop a response AFTER the real HTTP handler has durably committed it.
 * The wire tap retains the lost bytes for the replay oracle, not for the caller. */
export async function loseResponse<T>(send: () => Promise<Response>, wireTap: (value: T) => void): Promise<never> {
  const response = await send();
  expect(response.status).toBe(200);
  wireTap(await response.json() as T);
  throw new Error('S1 injected transport loss after the durable response');
}

/** A real SQLite claim/Runtime/mailbox composition using the legacy Host role.
 * Unlike B2RuntimeFixture it does not rewrite Session.role or seed Run facts. */
export async function openS1RuntimeFixture(options: {
  replies?: readonly ScriptedReply[];
  beforeReply?: Parameters<typeof createScriptedModel>[1];
} = {}) {
  const bundles = [EXECUTION_ENTRY_RECORD_SCHEMAS, MODEL_REQUEST_RECORD_SCHEMAS, CONTROL_RECORD_SCHEMAS,
    SESSION_MESSAGE_RECORD_SCHEMAS, SESSION_LIFECYCLE_RECORD_SCHEMAS, SESSION_ANOMALY_RECORD_SCHEMAS, QUERY_JOB_RECORD_SCHEMAS,
    SESSION_ACTIVITY_SCHEMAS];
  const base = await createTaskClaimFixture('sqlite', { records: bundles.flatMap(b => b.records),
    events: bundles.flatMap(b => b.events), lookups: bundles.flatMap(b => b.lookups ?? []) });
  const bodies = createSqliteRawArtifactStore(join(base.directory, 'artifacts.sqlite'));
  const checked = await checkedRecords(base.records, base.directory, base.scope.projectId);
  const records = checked.records;
  let sequence = 0;
  const newId = () => `s1-fixture-${++sequence}`;
  const now = () => S1_T0;
  const reads = createRunStateReader({ records });
  const roles = createRoleConfigurationService({ records, now, eventId: newId });
  const materialReads = createMaterialRecordReaders(records);
  const materials = createMaterialService({ bodies, authority: materialReads.authority, now });
  const sessions = createSessionDirectory({ records,
    knowledge: knowledgeLinesOver(records), lookups: records, duty: unknownSessionDuty });
  const kernelStores = await createKernelStoreRegistry({ entries: [{ adapterId: 'r4c-claim-kernel',
    storeKey: 'r4c-claim-kernel-store', workspace: base.scope, databasePath: join(base.directory, 'kernel.sqlite') }] });
  const sessionOperations = createSessionOperations({ sessions, kernelStores });
  const activity = createExecutionHistoryReader({ history: sessionOperations });
  const scripted = createScriptedModel(options.replies ?? [{ kind: 'text', text: 'S1 fixture answer' }], options.beforeReply);
  const tools = ['read', 'write', 'send_session_message', 'respond_session_message'];
  const permissions = { policyRevision: base.roleBinding.policyRevision, tools, writeScope: ['.'], createMember: false };
  const host: RuntimeHostBindings = {
    // A-07: the one scope/Role check and configuration body both resolutions share.
    ...(() => {
      const resolveFor = (ctx: CoreCallContext, role: RoleConfigurationRef) => {
        if (ctx.projectId !== base.scope.projectId || ctx.workspaceId !== base.scope.workspaceId
          || role.kind !== 'legacy_template' || role.templateId !== 'builder')
          return { status: 'rejected' as const, code: 'forbidden' as const, reason: 'S1 Host scope/role mismatch' };
        return { status: 'ready' as const, value: { configurationRevision: B2_HOST.configurationRevision,
          model: { configuration: { revision: 's1-script', provider: 'deepseek', model: 's1-scripted', baseUrl: 'http://127.0.0.1' },
            client: scripted.client, inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const, tokenizer: 's1' }) } },
          budget: { contextWindowTokens: 200000, inputTokens: null, outputTokens: null, maxRequests: 12,
            maxToolCalls: 16, timeoutMs: 30000, perResponseTokens: 512 },
          hostTemplate: B2_HOST.hostTemplate, tools: [...tools], writeScope: ['.'],
          skills: { resourceRoot: base.directory, enabledIds: [] }, systemInstruction: null,
          deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null } };
      };
      return {
        async resolveConfiguration(ctx: CoreCallContext, input: Parameters<RuntimeHostBindings['resolveConfiguration']>[1]) {
          return resolveFor(ctx, input.role);
        },
        // A-07: the no-Run lookup the pre-claim check reads; without a Run it gets only the Role.
        async resolveRoleConfiguration(ctx: CoreCallContext, input: Parameters<NonNullable<RuntimeHostBindings['resolveRoleConfiguration']>>[1]) {
          return resolveFor(ctx, input.role);
        },
      };
    })(),
  };
  const authorizeConfiguration: AuthorizeConfiguration = async (ctx, input) => {
    const resolution = await roles.resolveRoleBinding(ctx, { roleBinding: input.run.roleBinding, declaredPermissions: input.permissions });
    if (resolution.status !== 'ready') return resolution;
    const config = await host.resolveConfiguration(ctx, { runRef: input.run.ref, role: input.sessionRole, roleResolution: resolution.value });
    if (config.status !== 'ready') return config;
    const json = (value: unknown) => canonicalJson(value as JsonValue);
    if (input.configurationRevision !== config.value.configurationRevision
      || json(input.permissions) !== json(permissions) || json(input.hostTemplate) !== json(B2_HOST.hostTemplate))
      return { status: 'rejected', code: 'forbidden', reason: 'S1 persisted Host grant mismatch' };
    return { status: 'ready', value: { configurationRevision: config.value.configurationRevision,
      permissions: structuredClone(permissions), hostTemplate: structuredClone(B2_HOST.hostTemplate) } };
  };
  const hostInstance = { hostInstanceId: 's1-host', lease: 'owned' as const };
  const common = { records, reads, roles, bodies, authorizeConfiguration, hostInstance, now, eventId: newId, newId };
  const entry = createExecutionEntryService(common);
  const modelRequests = createModelCallService(common);
  const controls = createRunControlService({ records, reads, authority: materialReads.authority, now, eventId: newId });
  const messages = createSessionMailbox({ records, sessions, executions: reads, roles, materials,
    defaultInquiryDeadlineMs: 86_400_000,
    runtimeAdmission: { bodies, authorizeConfiguration }, systemActor: { kind: 'system', id: 's1-mailbox' }, now, newId });
  const sessionFacts = createSessionFactsService({ records });
  const lifecycle = createSessionLifecycleService({ records,
    knowledge: knowledgeLinesOver(records), lookups: records, sessionFacts, duty: unknownSessionDuty });
  const responsibilities = createSessionResponsibilityService({ records, lookups: records,
    basis: createSessionResponsibilityBasisReader(records, knowledgeLinesOver(records)), now, duty: unknownSessionDuty });
  const anomalies = createSessionAnomalyService({ records, lookups: records, sessionFacts, now });
  const health = createSessionHealthService({ records, hostInstance, now, eventId: newId });
  const captures: string[] = [];
  let changedPaths: string[] = [];
  const source: ContinuationWorkspaceSource = {
    async captureDigest() { return { status: 'ready', sourceDigest: '1'.repeat(64) }; },
    async capture(root) {
      captures.push(root);
      return { status: 'ready', sourceDigest: '1'.repeat(64), sourceProof: { kind: 'git-head-worktree', baseCommit: 's1-head',
        changedFiles: [...changedPaths], comparison: 'current-head-to-worktree', runBaselineKnown: false },
        changeScope: { diffClass: 'code-change', changedFiles: [...changedPaths], writeSummary: 'S1 workspace capture' }, gaps: [] };
    },
  };
  const workspaceHost: RuntimeExecutionDependencies['workspaceHost'] = {
    async resolveRoot() { return { status: 'ready', value: { root: base.directory, workspaceRevision: 1 } }; },
    async authorize() { return { status: 'ready', value: { subjectKey: 's1', permissionRevision: 's1@1', allowsRead: () => true } }; },
  };
  const requeues = createTaskRequeueService({ records, reads, workspaceHost, source, materials, messages,
    delegatedWrites: { reads, roles, bodies, authorizeConfiguration }, now, eventId: newId });
  const claims = base.makeService(records, now);
  // Rework 10 package R: the REQUIRED Task-review reader is the real owner over
  // this fixture's one real records store and its Run reader.
  const unknownCallReviews = createUnknownCallReviewService({ records, reads, now, eventId: newId });
  const deps: RuntimeExecutionDependencies = { claims, executions: reads, entry, modelRequests, roles, plans: base.plans,
    sessions, messages, materials, bodies, controls, kernelStores, workspaceHost, host, kernel, now, newId,
    unknownCallReviews,
    readTaskClosure: async (_ctx: CoreCallContext, task: { projectId: string; goalId: string; taskId: string }) =>
      readTaskClosure(records, { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId }, task.taskId),
    runReconcile: createRunReconcileService({ records, reads, bodies, hostInstance, now, eventId: newId }),
    historyWriter: createExecutionHistoryService({ records, now, eventId: newId }), activity,
    graphHistory: createGraphExecutionHistoryReader({ executions: reads, history: activity }), sessionOperations,
    sourceAuthority: () => createSourceAuthorityReader({ authority: materialReads.authority }), workspaceSource: source };
  const runtime = createAgentRuntime(deps);
  const read = async (claim: TaskClaim) => ready(await reads.readExecution(base.ctx, claim.runRef));
  const pin = async (claim: TaskClaim) => ({ ref: claim.runRef, revision: (await read(claim)).run.revision });
  const claim = async (sessionRef = base.sessions.first, taskId = base.tasks.first.taskId,
    requeueRef?: import('../../src/contracts/task-requeue.js').TaskRequeueRef) => {
    const request = await base.buildRequest({ input: { sessionRef, taskId }, requestId: newId() });
    return committed(await claims.claimTask(base.ctx, { ...request, input: { ...request.input,
      ...(requeueRef === undefined ? {} : { requeueRef }) } }));
  };
  const prepare = async (run: TaskClaim) => ready(await runtime.port.prepareExecution(base.ctx, { runRef: run.runRef, requestId: newId() }));
  const run = async (claimed: TaskClaim) => {
    const prepared = await prepare(claimed);
    const result = await runtime.port.startRun(base.ctx, { prepared, consumerId: 's1-runtime', requestId: newId() });
    if (result.status !== 'ready') throw new Error(`S1 runtime start: ${JSON.stringify(result)}`);
    await checked.check();
    return result.value;
  };
  return { base, bodies, records, checked, deps, runtime, reads, controls, entry, messages, lifecycle, anomalies, health,
    sessionFacts, responsibilities, source, captures, scripted, newId, read, pin, claim, prepare, run,
    async linkResponsible(sessionRef: SessionRef, target: WorkLinkTarget) {
      const ref: SessionWorkLinkRef = { aggregateType: 'SessionWorkLink', ...sessionRef, target, relation: 'responsible' };
      return committed(await lifecycle.linkSessionWork(base.ctx, { input: { sessionRef, target, relation: 'responsible', active: true },
        meta: { requestId: newId(), expected: [await base.sessionPin(sessionRef), { ref, revision: 0 }] } }));
    },
    setFiles(paths: string[]) { changedPaths = [...paths]; },
    async createSession(): Promise<SessionRef> {
      const receipt = await sessionOperations.createSession(base.ctx, { workspace: base.scope,
        role: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' }, recommendedRefs: [], initialLinks: [],
        meta: { requestId: newId(), expected: [] } });
      if (receipt.status !== 'completed') throw new Error(`S1 session creation: ${JSON.stringify(receipt)}`);
      return { projectId: receipt.value.ref.projectId, sessionId: receipt.value.ref.sessionId };
    },
    async requeue(claimed: TaskClaim, archiveOrigin?: ArchiveRequeueOriginV1) {
      const outcome = await requeues.requeueTask(base.ctx, { input: { taskRef: claimed.task,
        afterRunRef: claimed.runRef, reason: 'continue stopped work', note: `New operator basis ${newId()}`,
        ...(archiveOrigin === undefined ? {} : { archiveOrigin }) },
        meta: { requestId: newId(), expected: [await base.goalPin(), await pin(claimed)] } });
      if (outcome.status === 'needs_decision') throw new Error(`requeue requested a decision: ${JSON.stringify(outcome)}`);
      const result = committed(outcome);
      if (result.kind !== 'requeued') throw new Error(`S1 TaskRequeue refused: ${JSON.stringify(result)}`);
      return result.requeue;
    },
    async close() { await bodies.close(); await base.close(); },
  };
}
