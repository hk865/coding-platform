/**
 * R4c.2b behavior acceptance: the thin graph execution-history reader.
 *
 * The suite drives ONLY the frozen `GraphExecutionHistoryReadPort` produced by
 * `createGraphExecutionHistoryReader` over the REAL SQLite TaskClaim fixture
 * (`tests/helpers/task-claim-fixture.ts`, whose Sessions are real Kernel
 * Sessions), REAL persisted Kernel turns produced by `runObservedModel`, the
 * REAL WG11 `readExecution` and the REAL RT7 `readExecutionHistory`. It never
 * copies the fixture, fabricates a successful port result, or replaces the
 * Kernel store with a fake.
 *
 * Both the locator writer and graph reader are real accepted implementations.
 * These frozen acceptance tests observe the SessionHistoryRequest, Kernel
 * read arguments and returned page sizes. They prove bounded Runtime delegation,
 * not SQL rows visited; physical read cost has its separate Kernel range suite.
 */
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunExecutionHistoryV1 } from '../../src/contracts/core/execution-history.js';
import type { VersionPin } from '../../src/contracts/core/identity.js';
import type { RunRef, RunSnapshot } from '../../src/contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { TaskClaim } from '../../src/core/work-graph/model/claim-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import type { RecordExecutionHistoryInput } from '../../src/core/work-graph/model/execution-history-contracts.js';
import { createExecutionHistoryService } from '../../src/core/work-graph/tasks/execution-history-service.js';
import type { ExecutionReadPort } from '../../src/core/work-graph/model/execution-read-contracts.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { EXECUTION_ENTRY_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/execution-entry-codecs.js';
import { MODEL_REQUEST_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/model-request-codecs.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import { createS2BRuntimeSteps, type S2BRunHandle, type S2BRuntimeSteps } from '../helpers/S2B-runtime-steps-fixture.js';
import {
  plainSessionRefToAggregate,
  sessionAggregateRefKey,
} from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { createExecutionHistoryReader } from '../../src/core/agent-runtime/observation-recovery.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { createSessionOperations } from '../../src/core/agent-runtime/session-operations.js';
import type { SessionHistoryRequest, SessionOperationsPort } from '../../src/core/agent-runtime/session-operations.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import type { KernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createGraphExecutionHistoryReader } from '../../src/core/agent-runtime/graph-execution-history.js';
import type {
  ExecutionHistoryPort,
  ExecutionHistoryRequest,
  GraphExecutionHistoryReadPort,
  KernelExecutionIdentity,
} from '../../src/core/agent-runtime/execution-history-contracts.js';
import { DEFAULT_RUNTIME_BUDGET, ModelBudget } from '../../src/core/agent-runtime/model-budget.js';
import { runObservedModel, type ObservedModelRunOptions } from '../../src/core/agent-runtime/observed-model-run.js';
import { frozenPromptInputs } from './PC-frozen-prompt.js';
import {
  CLAIM_FIXTURE_AT,
  createTaskClaimFixture,
  type ClaimFixtureKind,
  type TaskClaimFixture,
} from '../helpers/task-claim-fixture.js';

// --------------------------------------------------------------------------
// Fixture lifecycle
// --------------------------------------------------------------------------

const KERNEL_ADAPTER_ID = 'r4c-claim-kernel';
const KERNEL_STORE_KEY = 'r4c-claim-kernel-store';
const KERNEL_DATABASE = 'kernel.sqlite';

const fixtures: TaskClaimFixture[] = [];
const runtimeSteps: S2BRuntimeSteps[] = [];
async function open(kind: ClaimFixtureKind = 'sqlite'): Promise<TaskClaimFixture> {
  const fixture = await createTaskClaimFixture(kind, {
    records: [...CONTROL_RECORD_SCHEMAS.records, ...EXECUTION_ENTRY_RECORD_SCHEMAS.records,
      ...MODEL_REQUEST_RECORD_SCHEMAS.records],
    events: [...CONTROL_RECORD_SCHEMAS.events, ...EXECUTION_ENTRY_RECORD_SCHEMAS.events,
      ...MODEL_REQUEST_RECORD_SCHEMAS.events],
    lookups: [...CONTROL_RECORD_SCHEMAS.lookups ?? [], ...EXECUTION_ENTRY_RECORD_SCHEMAS.lookups ?? [],
      ...MODEL_REQUEST_RECORD_SCHEMAS.lookups ?? []],
  });
  fixtures.push(fixture);
  return fixture;
}
afterEach(async () => {
  for (const steps of runtimeSteps.splice(0)) await steps.close();
  for (const fixture of fixtures.splice(0)) await fixture.close();
});

// --------------------------------------------------------------------------
// Real claimed Runs + real persisted Kernel turns
// --------------------------------------------------------------------------

type KernelIdentity = RunExecutionHistoryV1['kernel'];
type HistoryWriter = ReturnType<typeof createExecutionHistoryService>;
type KernelRead = { sessionId: string; afterPosition: number; limit: number; rows: number };

const key = (ref: object): string => canonicalJson(ref as unknown as JsonValue);
const kernelPath = (fixture: TaskClaimFixture): string => join(fixture.directory, KERNEL_DATABASE);

async function claimed(fixture: TaskClaimFixture, requestId: string): Promise<TaskClaim> {
  const result = await fixture.service.claimTask(fixture.ctx, await fixture.buildRequest({ requestId }));
  expect(result).toMatchObject({ status: 'committed' });
  if (result.status !== 'committed') throw new Error('fixture claim failed');
  return result.value;
}

async function claimedSecondSession(fixture: TaskClaimFixture, requestId: string): Promise<TaskClaim> {
  const request = await fixture.buildRequest({
    requestId,
    input: { taskId: fixture.tasks.second.taskId, sessionRef: fixture.sessions.second },
  });
  const result = await fixture.service.claimTask(fixture.ctx, request);
  expect(result).toMatchObject({ status: 'committed' });
  if (result.status !== 'committed') throw new Error('fixture second-session claim failed');
  return result.value;
}

/** R-8: the public WG11 read, as returned; never re-derive the Run's identity. */
async function readExecution(fixture: TaskClaimFixture, ref: RunRef): Promise<RunSnapshot> {
  const read = await createRunStateReader({ records: fixture.records })
    .readExecution(fixture.ctx, ref);
  expect(read.status).toBe('ready');
  if (read.status !== 'ready') throw new Error('fixture execution read failed');
  return read.value.run;
}

async function runPin(fixture: TaskClaimFixture, ref: RunRef): Promise<VersionPin> {
  const read = await fixture.records.readMany([key(ref)]);
  if (read.status !== 'ready') throw new Error('fixture Run read failed');
  const record = read.value.records.find(candidate => candidate.refKey === key(ref));
  if (record === undefined) throw new Error('fixture Run is absent');
  return { ref, revision: record.revision };
}

async function sessionKernel(
  fixture: TaskClaimFixture,
  ref: { projectId: string; sessionId: string },
): Promise<{ adapterId: string; kernelSessionId: string }> {
  const refKey = sessionAggregateRefKey(plainSessionRefToAggregate(ref));
  const read = await fixture.records.readMany([refKey]);
  if (read.status !== 'ready') throw new Error('fixture Session read failed');
  const record = read.value.records.find(candidate => candidate.refKey === refKey);
  if (record === undefined) throw new Error('fixture Session is absent');
  const body = JSON.parse(record.json) as { kernel: { adapterId: string; kernelSessionId: string } };
  return body.kernel;
}

type RealSecondRun = { claim: TaskClaim; steps: S2BRuntimeSteps; handle: S2BRunHandle };

/** B-08(a): a second Run in the SAME Session through the public path. The
 * first Run ends (a real control cancel of the unentered claim), then the
 * second Task is claimed in that Session and prepared + started for real by
 * the shared S2B Runtime steps; its model is held at the A3 gate. */
async function startSecondRun(fixture: TaskClaimFixture, source: TaskClaim): Promise<RealSecondRun> {
  let sequence = 0;
  const controls = createRunControlService({ records: fixture.records,
    authority: createMaterialRecordReaders(fixture.records).authority,
    reads: createRunStateReader({ records: fixture.records }),
    now: () => CLAIM_FIXTURE_AT, eventId: () => `graph-control-${++sequence}` });
  const cancelled = await controls.submitControl(fixture.ctx, { input: { runRef: source.runRef, kind: 'cancel',
    reason: 'end the first Run before the second claim' },
    meta: { requestId: 'graph-cancel-first', expected: [await runPin(fixture, source.runRef)] } });
  expect(cancelled).toMatchObject({ status: 'committed' });
  if (cancelled.status !== 'committed') throw Error(`the first Run did not end: ${JSON.stringify(cancelled)}`);
  const second = await fixture.service.claimTask(fixture.ctx, await fixture.buildRequest({
    requestId: 'graph-second-claim',
    input: { taskId: fixture.tasks.second.taskId, sessionRef: source.sessionRef } }));
  expect(second).toMatchObject({ status: 'committed' });
  if (second.status !== 'committed') throw Error(`the second claim failed: ${JSON.stringify(second)}`);
  const bodies = new RawArtifactBodyStore();
  const steps = await createS2BRuntimeSteps({ base: fixture, bodies, ctx: fixture.ctx,
    directory: fixture.directory, scope: fixture.scope, now: () => CLAIM_FIXTURE_AT,
    setClock: () => undefined,
    eventId: () => `graph-runtime-event-${++sequence}`,
    newId: () => `graph-runtime-id-${++sequence}`,
    consumerId: 'graph-history-runtime' });
  runtimeSteps.push(steps);
  const handle = await steps.start(second.value, { at: CLAIM_FIXTURE_AT,
    replies: [{ kind: 'text', text: 'graph history real run' }] });
  await handle.entered;
  return { claim: second.value, steps, handle };
}

/** The real R4c.2b locator writer; it is the production owner under test, never a mock. */
function historyWriter(fixture: TaskClaimFixture): HistoryWriter {
  return createExecutionHistoryService({
    records: fixture.records,
    now: () => CLAIM_FIXTURE_AT,
    eventId: () => `graph-history-event-${randomUUID()}`,
  });
}

async function bindHistory(
  fixture: TaskClaimFixture,
  requestId: string,
  runRef: RunRef,
  kernelIdentity: KernelIdentity,
  startPosition: number,
  observedThroughPosition: number,
  endPosition: number | null,
) {
  const pin = await runPin(fixture, runRef);
  const request: GraphWrite<RecordExecutionHistoryInput> = {
    input: { runRef, kernel: kernelIdentity, startPosition, observedThroughPosition, endPosition },
    meta: { requestId, expected: [pin] },
  };
  return historyWriter(fixture).recordExecutionHistory(fixture.ctx, request);
}

function scriptedClient(): kernel.ModelClientPort {
  const requests: kernel.ModelRequest[] = [];
  return {
    async *stream(request, options) {
      options.signal.throwIfAborted();
      requests.push(structuredClone(request));
      const base = { schemaVersion: 1 as const, requestId: request.requestId };
      yield { ...base, sequence: 1, type: 'text_delta', delta: `answer ${requests.length}` };
      yield { ...base, sequence: 2, type: 'completed', reason: 'final_answer' };
    },
  };
}

type TurnInput = {
  fixture: TaskClaimFixture; sessionId: string; input: string;
  identity: KernelExecutionIdentity; client: kernel.ModelClientPort;
  publish?: ObservedModelRunOptions['publish']; signal?: AbortSignal;
};

let promptInputs: Promise<ObservedModelRunOptions['prompt']> | undefined;
const promptOnce = () => (promptInputs ??= frozenPromptInputs());

async function runTurn(turn: TurnInput) {
  const budget = { ...DEFAULT_RUNTIME_BUDGET, perResponseTokens: 128 };
  return runObservedModel({
    kernel,
    bound: { configuration: { revision: 'local-r4c-graph-history', provider: 'deepseek',
      model: 'local-graph-history-fixture', baseUrl: 'http://127.0.0.1' }, client: turn.client },
    root: turn.fixture.directory, databasePath: kernelPath(turn.fixture), sessionId: turn.sessionId,
    input: turn.input, budget, executionIdentity: turn.identity,
    taskBudget: { tokenBudget: null, deadline: null },
    signal: turn.signal ?? new AbortController().signal,
    meter: new ModelBudget(budget, async () => {}, {
      count: () => ({ tokens: 100, method: 'model_tokenizer', tokenizer: 'r4c-graph-history-fixture' }),
    }),
    readOnly: true, allowedTools: [], deniedPrefixes: [], processSandboxOptions: {},
    publish: turn.publish ?? (async () => {}),
    prompt: await promptOnce(),
    bodies: new RawArtifactBodyStore(),
    origin: { kind: 'run', owner: { aggregateType: 'Run', projectId: 'r4c-graph-project',
      goalId: 'r4c-graph-goal', runId: 'r4c-graph-run' } },
    promptFacts: new Map(),
  });
}

async function rawRecords(databasePath: string, sessionId: string): Promise<kernel.SessionRecord[]> {
  const store = await kernel.SqliteStores.open(databasePath);
  try {
    const all: kernel.SessionRecord[] = [];
    let after = 0;
    while (true) {
      const page = await store.read(sessionId, after, 256, { signal: new AbortController().signal });
      all.push(...page.records);
      if (page.nextPosition === null) return all;
      after = page.records.at(-1)?.position ?? after;
    }
  } finally { await store.close(); }
}

function positionsOf(records: readonly kernel.SessionRecord[], identity: KernelExecutionIdentity): number[] {
  return records.filter(record => record.recordType === 'turn.started'
    ? record.payload.run.runId === identity.runId && record.payload.run.turn.turnId === identity.turnId
    : record.recordType === 'agent.event'
      ? record.payload.event.meta.runId === identity.runId && record.payload.event.meta.turnId === identity.turnId
      : false).map(record => record.position);
}

// --------------------------------------------------------------------------
// Graph reader harness: real WG11 + real RT7 + real RT1, with counting shims
// --------------------------------------------------------------------------

/** Observe Kernel read arguments and returned rows, not physical SQL work. */
function countingKernelStore(store: kernel.SqliteStores, reads: KernelRead[]): kernel.SqliteStores {
  const read = async (...args: Parameters<kernel.SqliteStores['read']>) => {
    const page = await store.read(...args);
    reads.push({ sessionId: args[0], afterPosition: args[1], limit: args[2], rows: page.records.length });
    return page;
  };
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property === 'read') return read;
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function countingRegistry(real: KernelStoreRegistry, reads: KernelRead[]): KernelStoreRegistry {
  return {
    forWorkspace: workspace => real.forWorkspace(workspace),
    byAdapterId: adapterId => real.byAdapterId(adapterId),
    withStore: (adapterId, use) => real.withStore(adapterId, store => use(countingKernelStore(store, reads))),
  };
}

type Harness = {
  reader: GraphExecutionHistoryReadPort;
  /** The real RT1 Session owner, with the RT1 `readSessionHistory` request spied. */
  owner: SessionOperationsPort;
  executionRequests: RunRef[];
  historyRequests: SessionHistoryRequest[];
  rt7Requests: ExecutionHistoryRequest[];
  kernelReads: KernelRead[];
};

async function harness(fixture: TaskClaimFixture): Promise<Harness> {
  const kernelReads: KernelRead[] = [];
  const realRegistry = await createKernelStoreRegistry({ entries: [{
    adapterId: KERNEL_ADAPTER_ID, storeKey: KERNEL_STORE_KEY, workspace: fixture.scope,
    databasePath: kernelPath(fixture),
  }] });
  const sessionOwner = createSessionOperations({ sessions: fixture.sessionsPort,
    kernelStores: countingRegistry(realRegistry, kernelReads) });

  const historyRequests: SessionHistoryRequest[] = [];
  const owner: SessionOperationsPort = {
    createSession: (context, request) => sessionOwner.createSession(context, request),
    readSessionHistory: async (context, request) => {
      historyRequests.push(structuredClone(request));
      return sessionOwner.readSessionHistory(context, request);
    },
  };
  const executionHistory = createExecutionHistoryReader({ history: owner });

  const rt7Requests: ExecutionHistoryRequest[] = [];
  const spiedExecutionHistory: ExecutionHistoryPort = {
    async readExecutionHistory(context, request) {
      rt7Requests.push(structuredClone(request));
      return executionHistory.readExecutionHistory(context, request);
    },
  };

  const realExecutions = createRunStateReader({ records: fixture.records });
  const executionRequests: RunRef[] = [];
  const executions: ExecutionReadPort = {
    async readExecution(context, ref, options) {
      executionRequests.push(structuredClone(ref));
      return realExecutions.readExecution(context, ref, options);
    },
  };
  const reader = createGraphExecutionHistoryReader({ executions, history: spiedExecutionHistory });
  return { reader, owner, executionRequests, historyRequests, rt7Requests, kernelReads };
}

function otherHostCtx(fixture: TaskClaimFixture, actorId: string): CoreCallContext {
  const actor = { kind: 'human' as const, id: actorId };
  return { ...fixture.ctx, principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: fixture.scope.projectId,
      workspaceId: fixture.scope.workspaceId, actor } };
}

// --------------------------------------------------------------------------
// The graph reader over the real graph/Session/Kernel traversal
// --------------------------------------------------------------------------

describe('R4c.2b graph execution history reader', () => {
  it('reads a real second Run interval directly from its persisted start instead of the Session head', async () => {
    const fx = await open();
    const claim = await claimed(fx, 'graph-direct-claim');
    const mapping = await sessionKernel(fx, claim.sessionRef);
    const firstIdentity: KernelExecutionIdentity = { runId: 'graph-kernel-run-1', turnId: 'graph-kernel-turn-1' };
    const client = scriptedClient();
    await runTurn({ fixture: fx, sessionId: mapping.kernelSessionId, input: 'first', identity: firstIdentity, client });

    // B-08(a)/R-7: the second Run in the same Session is the shared S2B real
    // prepare + start; its end is the real Runtime end.
    const second = await startSecondRun(fx, claim);
    await second.steps.finish(second.handle, CLAIM_FIXTURE_AT, 'completed');
    const run = await readExecution(fx, second.claim.runRef);
    const history = run.executionHistory;
    expect(history).toBeDefined();
    if (history === undefined) throw new Error('the real second Run has no execution history');
    expect(run).toMatchObject({ status: 'ended', outcome: 'completed' });

    const records = await rawRecords(kernelPath(fx), mapping.kernelSessionId);
    const firstPositions = positionsOf(records, firstIdentity);
    const secondPositions = positionsOf(records, history.kernel);
    expect(secondPositions.length).toBeGreaterThanOrEqual(2);
    const secondStart = history.startPosition;
    const secondEnd = history.endPosition;
    expect(secondStart).toBe(secondPositions[0]);
    expect(secondEnd).toBe(secondPositions.at(-1));

    const h = await harness(fx);
    const page = await h.reader.readTaskExecutionHistory(fx.ctx,
      { runRef: run.ref, afterCursor: null, limit: 200 });
    expect(page.status).toBe('ready');
    if (page.status !== 'ready') return;
    expect(page.value.executionIdentity).toEqual({ runId: history.kernel.runId, turnId: history.kernel.turnId });
    expect(page.value.items.map(item => item.source.position)).toEqual(secondPositions);
    expect(page.value.items.some(item => firstPositions.includes(item.source.position))).toBe(false);
    // The graph reader hands RT7 the persisted interval, and RT7 forwards it to RT1.
    expect(h.rt7Requests[0]?.range).toEqual({ adapterId: mapping.adapterId,
      kernelSessionId: mapping.kernelSessionId, startPosition: secondStart, throughPosition: secondEnd });
    expect(h.historyRequests[0]?.range).toEqual({ adapterId: mapping.adapterId,
      kernelSessionId: mapping.kernelSessionId, startPosition: secondStart, throughPosition: secondEnd });
    // Runtime requests the stored start directly and no unbounded first page.
    // The separate Kernel range suite measures the underlying SQL read cost.
    expect(h.kernelReads.some(read => read.afterPosition === secondStart - 1)).toBe(true);
    expect(h.kernelReads.every(read => read.limit !== Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(h.kernelReads.reduce((rows, read) => rows + read.rows, 0)).toBeLessThan(records.length);
  });

  it('keeps the frozen upper bound while the Session grows and never widens a continuation page', async () => {
    const fx = await open();
    const claim = await claimed(fx, 'graph-upper-claim');
    const mapping = await sessionKernel(fx, claim.sessionRef);
    const identity: KernelExecutionIdentity = { runId: 'graph-upper-run', turnId: 'graph-upper-turn' };
    const client = scriptedClient();
    await runTurn({ fixture: fx, sessionId: mapping.kernelSessionId, input: 'first', identity, client });

    // R-7: the second Run is a real prepare + start, held at the A3 gate; its
    // identity and frozen interval come from the public execution read.
    const second = await startSecondRun(fx, claim);
    const run = await readExecution(fx, second.claim.runRef);
    const history = run.executionHistory;
    expect(history).toBeDefined();
    if (history === undefined) throw new Error('the real second Run has no execution history');
    expect(history.endPosition).toBeNull();
    const positions = positionsOf(await rawRecords(kernelPath(fx), mapping.kernelSessionId), history.kernel)
      .filter(position => position >= history.startPosition && position <= history.observedThroughPosition);
    const start = history.startPosition;
    const upper = history.observedThroughPosition;
    expect(start).toBe(positions[0]);
    expect(upper).toBe(positions.at(-1));
    expect(positions.length).toBeGreaterThan(1);

    const h = await harness(fx);
    const first = await h.reader.readTaskExecutionHistory(fx.ctx,
      { runRef: run.ref, afterCursor: null, limit: 1 });
    expect(first.status).toBe('ready');
    if (first.status !== 'ready') return;
    expect(first.value.items.map(item => item.source.position)).toEqual(positions.slice(0, 1));
    expect(first.value.nextCursor).not.toBeNull();
    const cursor = first.value.nextCursor;
    if (cursor === null) return;

    // Grow the Session after the cursor was issued: releasing the held A3 gate
    // runs the real terminal, appending its real records past the frozen upper.
    await second.steps.finish(second.handle, CLAIM_FIXTURE_AT, 'completed');
    const grownTail = (await rawRecords(kernelPath(fx), mapping.kernelSessionId)).at(-1)?.position;
    if (grownTail === undefined) throw new Error('real Kernel Session has no tail');
    expect(grownTail).toBeGreaterThan(upper);

    const continued = await h.reader.readTaskExecutionHistory(fx.ctx,
      { runRef: run.ref, afterCursor: cursor, limit: 200 });
    expect(continued.status).toBe('ready');
    if (continued.status !== 'ready') return;
    expect(continued.value.items.map(item => item.source.position)).toEqual(positions.slice(1));
    expect(continued.value.items.every(item => item.source.position <= upper)).toBe(true);
    expect(h.rt7Requests[1]?.range?.startPosition).toBe(start);
    expect(h.rt7Requests[1]?.range?.throughPosition).toBe(upper);
  });

  it('returns unsupported without any history or Kernel read when the Run has no locator', async () => {
    const fx = await open();
    const claim = await claimed(fx, 'graph-missing-claim');
    const h = await harness(fx);
    const result = await h.reader.readTaskExecutionHistory(fx.ctx,
      { runRef: claim.runRef, afterCursor: null, limit: 200 });
    expect(result).toMatchObject({ status: 'rejected', code: 'unsupported' });
    // WG11 is consulted to discover the missing locator, and there is no fallback.
    expect(h.executionRequests).toHaveLength(1);
    expect(h.rt7Requests).toHaveLength(0);
    expect(h.historyRequests).toHaveLength(0);
    expect(h.kernelReads).toHaveLength(0);
  });

  it('rejects a continuation cursor that is moved to another Run, Session, principal or source', async () => {
    const fx = await open();
    const claim = await claimed(fx, 'graph-retarget-a');
    const other = await claimedSecondSession(fx, 'graph-retarget-b');
    const mapping = await sessionKernel(fx, claim.sessionRef);
    const identity: KernelExecutionIdentity = { runId: 'graph-retarget-run', turnId: 'graph-retarget-turn' };
    await runTurn({ fixture: fx, sessionId: mapping.kernelSessionId, input: 'retarget', identity, client: scriptedClient() });
    const records = await rawRecords(kernelPath(fx), mapping.kernelSessionId);
    const start = positionsOf(records, identity)[0];
    const tail = records.at(-1)?.position;
    if (start === undefined || tail === undefined) throw new Error('real Kernel Turn has no interval');
    const bound = await bindHistory(fx, 'graph-retarget-bind', claim.runRef, { ...mapping, ...identity }, start, tail, null);
    expect(bound.status).toBe('committed');
    if (bound.status !== 'committed') return;

    const otherMapping = await sessionKernel(fx, other.sessionRef);
    const otherIdentity = { runId: 'graph-retarget-other-run', turnId: 'graph-retarget-other-turn' };
    await runTurn({ fixture: fx, sessionId: otherMapping.kernelSessionId, input: 'other',
      identity: otherIdentity, client: scriptedClient() });
    const otherPositions = positionsOf(await rawRecords(kernelPath(fx), otherMapping.kernelSessionId), otherIdentity);
    const otherStart = otherPositions[0];
    const otherTail = otherPositions.at(-1);
    if (otherStart === undefined || otherTail === undefined) throw new Error('other real Kernel Turn has no interval');
    expect(await bindHistory(fx, 'graph-retarget-other-bind', other.runRef,
      { ...otherMapping, ...otherIdentity }, otherStart, otherTail, otherTail))
      .toMatchObject({ status: 'committed' });

    const h = await harness(fx);
    const opened = await h.reader.readTaskExecutionHistory(fx.ctx,
      { runRef: claim.runRef, afterCursor: null, limit: 1 });
    expect(opened.status).toBe('ready');
    if (opened.status !== 'ready') return;
    const cursor = opened.value.nextCursor;
    expect(cursor).not.toBeNull();
    if (cursor === null) return;

    // The other target is independently readable; rejection below cannot be
    // explained merely by a missing locator or unavailable Session.
    expect(await h.reader.readTaskExecutionHistory(fx.ctx,
      { runRef: other.runRef, afterCursor: null, limit: 200 })).toMatchObject({ status: 'ready' });
    // Another Run, another principal and a foreign/RT1-owned cursor are all rejected.
    expect(await h.reader.readTaskExecutionHistory(fx.ctx,
      { runRef: other.runRef, afterCursor: cursor, limit: 200 })).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await h.reader.readTaskExecutionHistory(otherHostCtx(fx, 'another-host-operator'),
      { runRef: claim.runRef, afterCursor: cursor, limit: 200 })).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await h.reader.readTaskExecutionHistory(fx.ctx,
      { runRef: claim.runRef, afterCursor: 'not-a-graph-cursor', limit: 200 }))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    const rawFirst = await h.owner.readSessionHistory(fx.ctx,
      { sessionRef: claim.sessionRef, afterCursor: null, throughCursor: null, limit: 1 });
    expect(rawFirst.status).toBe('ready');
    if (rawFirst.status !== 'ready' || rawFirst.value.nextCursor === null) return;
    expect(await h.reader.readTaskExecutionHistory(fx.ctx,
      { runRef: claim.runRef, afterCursor: rawFirst.value.nextCursor, limit: 200 }))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
  });

  it('preserves the original evidence of the real second Run byte-for-byte', async () => {
    const fx = await open();
    const claim = await claimed(fx, 'graph-evidence-claim');
    const mapping = await sessionKernel(fx, claim.sessionRef);

    // R-7: a real second Run, held at the A3 gate; its identity and interval
    // come from the public execution read, not from a test-built locator.
    const second = await startSecondRun(fx, claim);
    const held = await readExecution(fx, second.claim.runRef);
    const heldHistory = held.executionHistory;
    expect(heldHistory).toBeDefined();
    if (heldHistory === undefined) throw new Error('the real second Run has no execution history');
    expect(heldHistory.endPosition).toBeNull();
    const positions = positionsOf(await rawRecords(kernelPath(fx), mapping.kernelSessionId), heldHistory.kernel)
      .filter(position => position >= heldHistory.startPosition && position <= heldHistory.observedThroughPosition);
    const start = heldHistory.startPosition;
    const end = heldHistory.observedThroughPosition;
    expect(start).toBe(positions[0]);
    expect(end).toBe(positions.at(-1));

    const h = await harness(fx);
    const page = await h.reader.readTaskExecutionHistory(fx.ctx,
      { runRef: held.ref, afterCursor: null, limit: 200 });
    expect(page.status).toBe('ready');
    if (page.status !== 'ready') return;
    expect(page.value.items.map(item => item.source.position)).toEqual(positions);
    expect(page.value.items.length).toBeLessThanOrEqual(page.value.scannedCount);
    // Re-read the owner directly and compare every original field byte-for-byte.
    const raw = await h.owner.readSessionHistory(fx.ctx,
      { sessionRef: claim.sessionRef, afterCursor: null, throughCursor: null, limit: 200,
        range: { ...mapping, startPosition: start, throughPosition: end } });
    expect(raw.status).toBe('ready');
    if (raw.status !== 'ready') return;
    const byPosition = new Map(raw.value.items.map(item => [item.source.position, item] as const));
    for (const item of page.value.items) {
      const original = byPosition.get(item.source.position);
      expect(original).toBeDefined();
      expect(item).toEqual(original);
    }
    expect(page.value.basis).toEqual(raw.value.basis);
    // R-4: the wave-1 later-Turn zero-match sub-case is unreachable with a real
    // Run. While the Run is live the Kernel refuses a second Turn in the
    // Session (`vendor/coding-agent/patches/app/composition/composition-root.ts:287`);
    // once ended, the fixed endPosition cannot cover a later Turn
    // (`src/core/work-graph/state/run-machine.ts:1258`).
  });

  describe('rejects: a graph-history cursor whose outer upper is above the real end', () => {
    it('returns source_stale and leaves the execution unchanged', async () => {
      const fx = await open();
      const claim = await claimed(fx, 'graph-stale-claim');
      const bodies = new RawArtifactBodyStore();
      let sequence = 0;
      const steps = await createS2BRuntimeSteps({ base: fx, bodies, ctx: fx.ctx,
        directory: fx.directory, scope: fx.scope, now: () => CLAIM_FIXTURE_AT,
        setClock: () => undefined,
        eventId: () => `graph-stale-event-${++sequence}`,
        newId: () => `graph-stale-id-${++sequence}`,
        consumerId: 'graph-stale-runtime' });
      runtimeSteps.push(steps);
      const handle = await steps.start(claim, { at: CLAIM_FIXTURE_AT,
        replies: [{ kind: 'text', text: 'graph stale real run' }] });
      await handle.entered;
      await steps.finish(handle, CLAIM_FIXTURE_AT, 'completed');
      const run = await readExecution(fx, claim.runRef);
      const history = run.executionHistory;
      expect(history).toBeDefined();
      if (history === undefined) throw new Error('the real Run has no execution history');
      const end = history.endPosition ?? history.observedThroughPosition;
      expect(end).not.toBeNull();

      const h = await harness(fx);
      const first = await h.reader.readTaskExecutionHistory(fx.ctx,
        { runRef: run.ref, afterCursor: null, limit: 1 });
      expect(first.status).toBe('ready');
      if (first.status !== 'ready') return;
      expect(first.value.items).toHaveLength(1);
      const cursor = first.value.nextCursor;
      expect(cursor).not.toBeNull();
      if (cursor === null) return;

      // Build the one refused input from the real cursor: change only the
      // outer `u` to the real end + 1; every inner field stays as issued.
      const separator = cursor.indexOf('.') + 1;
      expect(separator).toBeGreaterThan(0);
      const body = JSON.parse(Buffer.from(cursor.slice(separator), 'base64url').toString('utf8')) as Record<string, unknown>;
      body['u'] = end + 1;
      const tampered = cursor.slice(0, separator) + Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');

      const before = await readExecution(fx, run.ref);
      const stale = await h.reader.readTaskExecutionHistory(fx.ctx,
        { runRef: run.ref, afterCursor: tampered, limit: 200 });
      expect(stale).toMatchObject({ status: 'rejected', code: 'source_stale' });
      expect(await readExecution(fx, run.ref)).toEqual(before);
    });
  });

  it('rejects malformed limits before any graph or history read', async () => {
    const fx = await open();
    const claim = await claimed(fx, 'graph-limit-claim');
    const h = await harness(fx);
    for (const limit of [0, 201, 1.5, -1]) {
      expect(await h.reader.readTaskExecutionHistory(fx.ctx,
        { runRef: claim.runRef, afterCursor: null, limit }))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
    }
    expect(h.executionRequests).toHaveLength(0);
    expect(h.rt7Requests).toHaveLength(0);
    expect(h.kernelReads).toHaveLength(0);
  });

  it('rejects a call cancelled before delegation while preserving the original signal', async () => {
    const fx = await open();
    const claim = await claimed(fx, 'graph-cancel-claim');
    const h = await harness(fx);
    const aborted = new AbortController();
    aborted.abort();
    expect(await h.reader.readTaskExecutionHistory({ ...fx.ctx, signal: aborted.signal },
      { runRef: claim.runRef, afterCursor: null, limit: 200 }))
      .toMatchObject({ status: 'rejected', code: 'cancelled' });
    expect(h.executionRequests).toHaveLength(0);
    expect(h.rt7Requests).toHaveLength(0);
  });

  it.each(['graph', 'history'] as const)('rejects cancellation after awaiting the real %s dependency', async phase => {
    const fx = await open();
    const claim = await claimed(fx, `graph-await-cancel-${phase}`);
    const mapping = await sessionKernel(fx, claim.sessionRef);
    const identity = { runId: `graph-await-cancel-${phase}-run`, turnId: `graph-await-cancel-${phase}-turn` };
    await runTurn({ fixture: fx, sessionId: mapping.kernelSessionId, input: 'cancel after read',
      identity, client: scriptedClient() });
    const positions = positionsOf(await rawRecords(kernelPath(fx), mapping.kernelSessionId), identity);
    const start = positions[0];
    const end = positions.at(-1);
    if (start === undefined || end === undefined) throw new Error('real Kernel Turn has no interval');
    expect(await bindHistory(fx, `graph-await-cancel-bind-${phase}`, claim.runRef,
      { ...mapping, ...identity }, start, end, end)).toMatchObject({ status: 'committed' });

    const h = await harness(fx);
    const realExecutions = createRunStateReader({ records: fx.records });
    const realHistory = createExecutionHistoryReader({ history: h.owner });
    const controller = new AbortController();
    let graphCalls = 0;
    let historyCalls = 0;
    const reader = createGraphExecutionHistoryReader({
      executions: {
        async readExecution(context, ref, options) {
          graphCalls += 1;
          expect(context.signal).toBe(controller.signal);
          const result = await realExecutions.readExecution(context, ref, options);
          expect(result.status).toBe('ready');
          // Abort only after the dependency produced real data. The adapter
          // must check the signal after await rather than publish that data.
          if (phase === 'graph') controller.abort();
          return result;
        },
      },
      history: {
        async readExecutionHistory(context, request) {
          historyCalls += 1;
          expect(context.signal).toBe(controller.signal);
          const result = await realHistory.readExecutionHistory(context, request);
          expect(result.status).toBe('ready');
          if (phase === 'history') controller.abort();
          return result;
        },
      },
    });
    const result = await reader.readTaskExecutionHistory({ ...fx.ctx, signal: controller.signal },
      { runRef: claim.runRef, afterCursor: null, limit: 200 });
    expect(result).toMatchObject({ status: 'rejected', code: 'cancelled' });
    expect(graphCalls).toBe(1);
    expect(historyCalls).toBe(phase === 'graph' ? 0 : 1);
  });

  it('owns the call context and request before the first await so caller mutation cannot retarget it', async () => {
    const fx = await open();
    const claim = await claimed(fx, 'graph-mutate-claim');
    const mapping = await sessionKernel(fx, claim.sessionRef);

    // R-7/R-8: the second Run is real and its identity/interval are the ones
    // the public execution read returns.
    const second = await startSecondRun(fx, claim);
    await second.steps.finish(second.handle, CLAIM_FIXTURE_AT, 'completed');
    const run = await readExecution(fx, second.claim.runRef);
    const history = run.executionHistory;
    expect(history).toBeDefined();
    if (history === undefined) throw new Error('the real second Run has no execution history');
    const positions = positionsOf(await rawRecords(kernelPath(fx), mapping.kernelSessionId), history.kernel);
    expect(positions).not.toHaveLength(0);

    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const seen: RunRef[] = [];
    const realExecutions = createRunStateReader({ records: fx.records });
    const executions: ExecutionReadPort = {
      async readExecution(context, ref, options) {
        seen.push(structuredClone(ref));
        await gate;
        return realExecutions.readExecution(context, ref, options);
      },
    };
    const realHistory = createExecutionHistoryReader({ history: createSessionOperations({
      sessions: fx.sessionsPort, kernelStores: await createKernelStoreRegistry({ entries: [{
        adapterId: KERNEL_ADAPTER_ID, storeKey: KERNEL_STORE_KEY, workspace: fx.scope,
        databasePath: kernelPath(fx) }] }) }) });
    const rt7Requests: ExecutionHistoryRequest[] = [];
    const spied: ExecutionHistoryPort = {
      async readExecutionHistory(context, request) {
        rt7Requests.push(structuredClone(request));
        return realHistory.readExecutionHistory(context, request);
      },
    };
    const reader = createGraphExecutionHistoryReader({ executions, history: spied });
    const ownedCtx: CoreCallContext = { ...fx.ctx, principal: structuredClone(fx.ctx.principal),
      materialReader: structuredClone(fx.ctx.materialReader) };
    const request = { runRef: structuredClone(run.ref), afterCursor: null as string | null, limit: 200 };
    const pending = reader.readTaskExecutionHistory(ownedCtx, request);
    ownedCtx.workspaceId = 'mutated-workspace';
    request.runRef.runId = 'mutated-run';
    request.limit = 1;
    request.afterCursor = 'mutated-cursor';
    release();
    const result = await pending;
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(seen[0]?.runId).toBe(run.ref.runId);
    expect(rt7Requests[0]?.limit).toBe(200);
    expect(rt7Requests[0]?.afterCursor).toBeNull();
    expect(result.value.items.map(item => item.source.position)).toEqual(positions);
  });
});

// --------------------------------------------------------------------------
// RT1 bounded Session history range (the real owner, no graph reader involved)
// --------------------------------------------------------------------------

describe('R4c.2b RT1 bounded Session history range', () => {
  it('rejects a continuation position below the frozen range instead of reading from the Session head', async () => {
    const fx = await open();
    const claim = await claimed(fx, 'rt1-lower-bound-claim');
    const mapping = await sessionKernel(fx, claim.sessionRef);
    const client = scriptedClient();
    const firstIdentity = { runId: 'rt1-lower-run-1', turnId: 'rt1-lower-turn-1' };
    const secondIdentity = { runId: 'rt1-lower-run-2', turnId: 'rt1-lower-turn-2' };
    await runTurn({ fixture: fx, sessionId: mapping.kernelSessionId, input: 'before range',
      identity: firstIdentity, client });
    await runTurn({ fixture: fx, sessionId: mapping.kernelSessionId, input: 'in range',
      identity: secondIdentity, client });
    const positions = positionsOf(await rawRecords(kernelPath(fx), mapping.kernelSessionId), secondIdentity);
    const start = positions[0];
    const through = positions.at(-1);
    if (start === undefined || through === undefined) throw new Error('real Kernel Turn has no interval');
    expect(start).toBeGreaterThan(1);
    const range = { ...mapping, startPosition: start, throughPosition: through };
    const h = await harness(fx);
    const opened = await h.owner.readSessionHistory(fx.ctx,
      { sessionRef: claim.sessionRef, afterCursor: null, throughCursor: null, limit: 1, range });
    expect(opened.status).toBe('ready');
    if (opened.status !== 'ready') return;
    expect(opened.value.items.map(item => item.source.position)).toEqual([start]);
    const cursor = opened.value.nextCursor;
    expect(cursor).not.toBeNull();
    if (cursor === null) return;

    // Keep the real cursor's mapping, principal and frozen bounds. Only change
    // its position to below lower - 1: unsigned cursors must still obey range.
    const separator = cursor.indexOf('.') + 1;
    expect(separator).toBeGreaterThan(0);
    const body = JSON.parse(Buffer.from(cursor.slice(separator), 'base64url').toString('utf8')) as Record<string, unknown>;
    body['i'] = 0;
    const rewound = cursor.slice(0, separator) + Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
    const result = await h.owner.readSessionHistory(fx.ctx,
      { sessionRef: claim.sessionRef, afterCursor: rewound, throughCursor: null, limit: 200, range });
    expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(result).not.toHaveProperty('value.items');
  });

  it('reads one bounded Kernel page from startPosition - 1 up to the frozen throughPosition', async () => {
    const fx = await open();
    const claim = await claimed(fx, 'rt1-range-claim');
    const mapping = await sessionKernel(fx, claim.sessionRef);
    const firstIdentity: KernelExecutionIdentity = { runId: 'rt1-range-run-1', turnId: 'rt1-range-turn-1' };
    const secondIdentity: KernelExecutionIdentity = { runId: 'rt1-range-run-2', turnId: 'rt1-range-turn-2' };
    const client = scriptedClient();
    await runTurn({ fixture: fx, sessionId: mapping.kernelSessionId, input: 'one', identity: firstIdentity, client });
    await runTurn({ fixture: fx, sessionId: mapping.kernelSessionId, input: 'two', identity: secondIdentity, client });
    const records = await rawRecords(kernelPath(fx), mapping.kernelSessionId);
    const positions = positionsOf(records, secondIdentity);
    const start = positions[0];
    const through = positions.at(-1);
    if (start === undefined || through === undefined) throw new Error('real Kernel Turn has no interval');

    const h = await harness(fx);
    const result = await h.owner.readSessionHistory(fx.ctx, {
      sessionRef: claim.sessionRef, afterCursor: null, throughCursor: null, limit: 200,
      range: { adapterId: mapping.adapterId, kernelSessionId: mapping.kernelSessionId,
        startPosition: start, throughPosition: through },
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.value.items.map(item => item.source.position)).toEqual(positions);
    expect(h.kernelReads.some(read => read.afterPosition === start - 1)).toBe(true);
    expect(h.kernelReads.every(read => read.limit !== Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(h.kernelReads.reduce((rows, read) => rows + read.rows, 0)).toBeLessThan(records.length);
  });

  it('rejects an upper bound beyond the current tail and a range combined with throughCursor', async () => {
    const fx = await open();
    const claim = await claimed(fx, 'rt1-bound-claim');
    const mapping = await sessionKernel(fx, claim.sessionRef);
    const identity: KernelExecutionIdentity = { runId: 'rt1-bound-run', turnId: 'rt1-bound-turn' };
    await runTurn({ fixture: fx, sessionId: mapping.kernelSessionId, input: 'bound', identity, client: scriptedClient() });
    const records = await rawRecords(kernelPath(fx), mapping.kernelSessionId);
    const tail = records.at(-1)?.position;
    if (tail === undefined) throw new Error('real Kernel Session has no tail');

    const h = await harness(fx);
    // An explicit upper bound past the real tail must never be silently clipped.
    expect(await h.owner.readSessionHistory(fx.ctx, {
      sessionRef: claim.sessionRef, afterCursor: null, throughCursor: null, limit: 200,
      range: { adapterId: mapping.adapterId, kernelSessionId: mapping.kernelSessionId,
        startPosition: 1, throughPosition: tail + 5 },
    })).toMatchObject({ status: 'rejected', code: 'unavailable' });

    const opened = await h.owner.readSessionHistory(fx.ctx,
      { sessionRef: claim.sessionRef, afterCursor: null, throughCursor: null, limit: 1 });
    expect(opened.status).toBe('ready');
    if (opened.status !== 'ready' || opened.value.basis.kind !== 'session') return;
    // `range` and `throughCursor` describe the same boundary and may not both be pinned.
    expect(await h.owner.readSessionHistory(fx.ctx, {
      sessionRef: claim.sessionRef, afterCursor: null, throughCursor: opened.value.basis.cursor, limit: 200,
      range: { adapterId: mapping.adapterId, kernelSessionId: mapping.kernelSessionId,
        startPosition: 1, throughPosition: tail },
    })).toMatchObject({ status: 'rejected', code: 'invalid' });
  });

  it('preserves an empty terminal page at the real upper cursor', async () => {
    const fx = await open();
    const claim = await claimed(fx, 'rt1-terminal-page-claim');
    const mapping = await sessionKernel(fx, claim.sessionRef);
    const identity = { runId: 'rt1-terminal-page-run', turnId: 'rt1-terminal-page-turn' };
    await runTurn({ fixture: fx, sessionId: mapping.kernelSessionId, input: 'terminal page',
      identity, client: scriptedClient() });
    const positions = positionsOf(await rawRecords(kernelPath(fx), mapping.kernelSessionId), identity);
    const start = positions[0];
    const through = positions.at(-1);
    if (start === undefined || through === undefined) throw new Error('real Kernel Turn has no interval');
    const range = { ...mapping, startPosition: start, throughPosition: through };
    const h = await harness(fx);
    const opened = await h.owner.readSessionHistory(fx.ctx,
      { sessionRef: claim.sessionRef, afterCursor: null, throughCursor: null, limit: 200, range });
    expect(opened.status).toBe('ready');
    if (opened.status !== 'ready') return;
    expect(opened.value.items.map(item => item.source.position)).toEqual(positions);
    expect(opened.value.nextCursor).toBeNull();
    const last = opened.value.items.at(-1);
    if (last === undefined) throw new Error('the real range returned no terminal entry');
    expect(last.source.position).toBe(through);

    // This is the unmodified last-entry cursor emitted by the public owner,
    // not a made-up continuation or an authorization to skip source checks.
    const request = { sessionRef: claim.sessionRef, afterCursor: last.cursor,
      throughCursor: null, limit: 200, range };
    const empty = await h.owner.readSessionHistory(fx.ctx, request);
    expect(empty).toMatchObject({ status: 'ready', value: { items: [], nextCursor: null } });
  });

});
