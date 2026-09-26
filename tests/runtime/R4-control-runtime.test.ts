/**
 * R4.3a Runtime control-delivery behaviour tests (stage-1 skeleton).
 *
 * FINAL behaviour assertions. Every prerequisite (real claim -> prepare ->
 * authorize/begin -> entered -> model/tool work) is produced by the real B2
 * Runtime over a real SQLite fixture, and every control request comes from the
 * real R4.1 writer. In this stage `runtime.deliverControl` still returns an
 * explicit `unsupported`, so each flow stops at its first delivery assertion;
 * the pause/observation/release tail is therefore NOT reached and must not be
 * reported verified.
 *
 * The controlled Kernel tools are a test-only latency seam at the frozen public
 * boundary: they add no permission and grant nothing. The real manifest/Host/
 * Role intersection still decides what the model may call, and the tool only
 * makes "the group is still in flight" / "the tool ignores cancel" deterministic.
 *
 * Reuses `createB2RuntimeFixture` without changing it; the local `vi.mock` only
 * registers the already-reviewed `CONTROL_RECORD_SCHEMAS` in the fixture backend
 * so the real R4.1 writer can commit, exactly like the existing
 * `createB2ExecutionFixture(kind, CONTROL_RECORD_SCHEMAS)` consumers do.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { ControlIntentRef } from '../../src/contracts/control-intent.js';
import type { VersionPin } from '../../src/contracts/core/identity.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import type { AgentRuntimeService } from '../../src/core/agent-runtime/ports.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type { ExecutionEntryPort } from '../../src/core/work-graph/tasks/execution-entry-contracts.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { B2_AT, createB2RuntimeFixture, type B2RuntimeFixture } from '../helpers/B2-runtime-fixture.js';
import {
  StoreError, createInitialRunState, projectTerminalTranscript, reduceRunState,
  toolSchema as z, type SessionRecord, type ToolCall, type ToolDefinition, type ToolResult,
} from '../../vendor/coding-agent/dist/public-api.js';

vi.mock('../helpers/task-claim-fixture.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../helpers/task-claim-fixture.js')>();
  const { CONTROL_RECORD_SCHEMAS } = await import('../../src/core/work-graph/persistence/control-record-codecs.js');
  const withControls = (
    kind: Parameters<typeof actual.createTaskClaimFixture>[0],
    additionalSchemas: RecordBackendSchemas = { records: [], events: [] },
  ) => actual.createTaskClaimFixture(kind, {
    records: [...additionalSchemas.records, ...CONTROL_RECORD_SCHEMAS.records],
    events: [...additionalSchemas.events, ...CONTROL_RECORD_SCHEMAS.events],
    lookups: [...(additionalSchemas.lookups ?? []), ...(CONTROL_RECORD_SCHEMAS.lookups ?? [])],
  });
  return { ...actual, createTaskClaimFixture: withControls };
});

const fixtures: B2RuntimeFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

/** Real SQLite per this batch; never the in-memory default. */
async function makeFixture(options: Parameters<typeof createB2RuntimeFixture>[0] = {}): Promise<B2RuntimeFixture> {
  const fixture = await createB2RuntimeFixture({ ...options, kind: 'sqlite' });
  fixtures.push(fixture);
  return fixture;
}

/** The ONE raw control service the composition root owns, over the fixture store. */
function controlsOn(fx: B2RuntimeFixture) {
  let seq = 0;
  return createRunControlService({
    records: fx.claimFixture.records,
    authority: createMaterialRecordReaders(fx.claimFixture.records).authority,
    now: () => B2_AT,
    eventId: () => `r4-control-runtime-event-${++seq}`,
  });
}

/** The exact current Run pin from the real WG11 execution reader. */
async function currentPin(fx: B2RuntimeFixture): Promise<VersionPin> {
  const read = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  if (read.status !== 'ready') throw Error(`fixture Run pin unavailable: ${JSON.stringify(read)}`);
  return { ref: fx.claim.runRef, revision: read.value.run.revision };
}

async function kernelRecords(fx: B2RuntimeFixture): Promise<readonly SessionRecord[]> {
  const card = await fx.deps.sessions.readSession(fx.ctx, fx.claim.sessionRef);
  if (card.status !== 'ready') throw Error(`fixture Session card unavailable: ${JSON.stringify(card)}`);
  const page = await fx.deps.kernelStores.withStore(
    card.value.record.kernel.adapterId,
    (store) => store.read(card.value.record.kernel.kernelSessionId, 0, 400, { signal: fx.ctx.signal }),
  );
  return page.records;
}

/** Test-only controlled Kernel tool; it only controls WHEN a call settles. */
function controlledTool(
  name: string,
  run: (call: Readonly<ToolCall>, signal: AbortSignal) => Promise<ToolResult>,
): ToolDefinition {
  return {
    name,
    description: 'R4.3a controlled runtime tool',
    inputSchema: z.object({}).loose(),
    effectClass: 'read_only',
    requiredCapabilities: ['workspace_read'],
    defaultTimeoutMs: 60_000,
    outputLimitBytes: 1_024,
    independentReadOnly: false,
    summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
    handler: { execute: (call, options) => run(call, options.signal) },
  };
}

function successResult(callId: string, text = 'controlled tool completed'): ToolResult {
  return {
    schemaVersion: 1, callId, status: 'success',
    output: [{ kind: 'text', text }],
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] },
  };
}

function withControlledTool(
  fx: B2RuntimeFixture,
  tool: ToolDefinition,
): B2RuntimeFixture['deps']['kernel'] {
  return {
    ...fx.deps.kernel,
    runCodingAgent: (options) => {
      const config = options.config;
      return fx.deps.kernel.runCodingAgent({
        ...options,
        config: { ...config, tools: { ...config.tools, enabledNames: [...config.tools.enabledNames, tool.name] } },
        additionalTools: (workspace) => [...(options.additionalTools?.(workspace) ?? []), tool],
      });
    },
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => { resolve = settle; });
  return { promise, resolve };
}

it('keeps a pause queued through the real in-flight tool group, then pauses before the second serial group with an ack bound to the original run.paused event', async () => {
  const toolName = 'r4-runtime-serial-tool';
  const entered = deferred();
  const release = deferred();
  const started: string[] = [];
  const tool = controlledTool(toolName, async (call) => {
    started.push(call.callId);
    // Only the first serial group blocks; the pause must land before the second.
    if (call.callId === 'r4-runtime-group-1') {
      entered.resolve();
      await release.promise;
    }
    return successResult(call.callId, `released ${call.callId}`);
  });
  const fx = await makeFixture({ scriptedReplies: [
    { kind: 'calls', calls: [
      { callId: 'r4-runtime-group-1', name: toolName, args: {} },
      { callId: 'r4-runtime-group-2', name: toolName, args: {} },
    ] },
    { kind: 'text', text: 'must not run after the pause' },
  ] });
  const controls = controlsOn(fx);
  const runtime = createAgentRuntime({ ...fx.deps, controls, kernel: withControlledTool(fx, tool) });

  const prepared = await runtime.port.prepareExecution(fx.ctx, { runRef: fx.claim.runRef, requestId: 'r4-runtime-two-groups-prepare' });
  expect(prepared.status).toBe('ready');
  if (prepared.status !== 'ready') return;
  const running = runtime.port.startRun(fx.ctx, {
    prepared: prepared.value, consumerId: 'r4-runtime-two-groups-consumer', requestId: 'r4-runtime-two-groups-start',
  });
  let intentRef: ControlIntentRef | undefined;
  try {
    const first = await Promise.race([
      entered.promise.then(() => 'tool' as const),
      running.then(() => 'finished' as const),
    ]);
    expect(first, 'the first serial tool group must actually start').toBe('tool');
    if (first !== 'tool') return;

    const pin = await currentPin(fx);
    const submitted = await controls.submitControl(fx.ctx, {
      input: { runRef: fx.claim.runRef, kind: 'pause', reason: 'operator pause before the second group' },
      meta: { requestId: 'r4-runtime-two-groups-submit', expected: [pin] },
    });
    expect(submitted).toMatchObject({ status: 'committed' });
    if (submitted.status !== 'committed') return;
    intentRef = submitted.value.intent.ref;

    const delivered = await runtime.port.deliverControl!(fx.ctx, { intentRef });
    expect(delivered, 'pause delivery must reach the live fixed Run').toMatchObject({ status: 'ready' });
    if (delivered.status !== 'ready') return;

    // The real executor (and therefore the required result sink and the owned
    // resource close that follow it) has not settled: the requested pause is not
    // yet a proven stop, and a public observe must not release either.
    expect(await controls.readControl(fx.ctx, intentRef)).toMatchObject({
      status: 'ready', value: { status: 'queued' },
    });
    const observed = await runtime.port.observeRun(fx.ctx, { runRef: fx.claim.runRef });
    expect(observed.status).toBe('ready');
    if (observed.status === 'ready') expect(observed.value.session.occupancy).not.toBeNull();
  } finally {
    release.resolve();
    await running;
  }

  // The second serial group never started; the pause landed at the group boundary.
  expect(started).toEqual(['r4-runtime-group-1']);
  expect(fx.scripted.calls(), 'only the first provider response is issued before the pause').toBe(1);
  expect(intentRef, 'a committed control ref must be known after the run').toBeDefined();
  if (intentRef === undefined) return;

  const record = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  expect(record.status).toBe('ready');
  if (record.status !== 'ready') return;
  expect(record.value.run.controlState).toMatchObject({ desiredState: 'paused' });
  expect(record.value.session.occupancy, 'a pause is not a release').not.toBeNull();
  expect(record.value.lease?.release).toBeUndefined();

  const records = await kernelRecords(fx);
  const paused = records.find((item) => item.recordType === 'agent.event'
    && item.payload.event?.type === 'run.paused');
  expect(paused, 'the genuine Kernel run.paused must be persisted').toBeDefined();

  const ack = await controls.readControl(fx.ctx, intentRef);
  expect(ack).toMatchObject({ status: 'ready', value: { status: 'applied', observation: { kind: 'paused' } } });
  if (ack.status === 'ready' && 'observation' in ack.value && paused !== undefined && paused.recordType === 'agent.event') {
    // Exact binding to the original agent.event meta and the SessionRecord position.
    expect(ack.value.observation.kernelEventId).toBe(paused.payload.event?.meta?.eventId);
    expect(ack.value.observation.kernelEventSequence).toBe(paused.payload.event?.meta?.sequence);
    expect(ack.value.observation.source.position).toBe(paused.position);
  }
});

it('lets the real Kernel drain timeout produce the outcome_unknown, then keeps the unknown side effect and occupancy instead of faking a cancel', async () => {
  const toolName = 'r4-runtime-ignoring-tool';
  const entered = deferred();
  const release = deferred();
  const tool = controlledTool(toolName, async (call) => {
    entered.resolve();
    // Deliberately ignore the cancellation signal: only the Kernel's own drain
    // timeout may end this call, producing the formal outcome_unknown result.
    await release.promise;
    return successResult(call.callId, 'late result after the drain');
  });
  const fx = await makeFixture({ scriptedReplies: [
    { kind: 'calls', calls: [{ callId: 'r4-runtime-ignoring', name: toolName, args: {} }] },
    { kind: 'text', text: 'natural terminal after the unknown tool result' },
  ] });
  const controls = controlsOn(fx);
  const runtime = createAgentRuntime({ ...fx.deps, controls, kernel: withControlledTool(fx, tool) });

  const prepared = await runtime.port.prepareExecution(fx.ctx, { runRef: fx.claim.runRef, requestId: 'r4-runtime-unknown-prepare' });
  expect(prepared.status).toBe('ready');
  if (prepared.status !== 'ready') return;
  const running = runtime.port.startRun(fx.ctx, {
    prepared: prepared.value, consumerId: 'r4-runtime-unknown-consumer', requestId: 'r4-runtime-unknown-start',
  });
  let intentRef: ControlIntentRef | undefined;
  let finishDeadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const first = await Promise.race([
      entered.promise.then(() => 'tool' as const),
      running.then(() => 'finished' as const),
    ]);
    expect(first, 'the ignoring tool must actually start').toBe('tool');
    if (first !== 'tool') return;

    const pin = await currentPin(fx);
    const submitted = await controls.submitControl(fx.ctx, {
      input: { runRef: fx.claim.runRef, kind: 'cancel', reason: 'stop now' },
      meta: { requestId: 'r4-runtime-unknown-submit', expected: [pin] },
    });
    expect(submitted).toMatchObject({ status: 'committed' });
    if (submitted.status !== 'committed') return;
    intentRef = submitted.value.intent.ref;

    const delivered = await runtime.port.deliverControl!(fx.ctx, { intentRef });
    expect(delivered, 'cancel delivery must reach the live fixed Run').toMatchObject({ status: 'ready' });
    if (delivered.status !== 'ready') return;
    // A sent signal is not a proven stop: the intent stays queued while the tool
    // ignores it. Do not release the latch: the Kernel drain must produce the
    // outcome_unknown itself and end the pending execution.
    expect(await controls.readControl(fx.ctx, intentRef)).toMatchObject({
      status: 'ready', value: { status: 'queued' },
    });
    // Own this deadline inside the test: a Vitest timeout cannot unwind the
    // pending async function and therefore cannot release the tool for us.
    const finished = await Promise.race([
      running.then(() => true),
      new Promise<false>((resolve) => { finishDeadline = setTimeout(() => resolve(false), 8_000); }),
    ]);
    expect(finished, 'the actual Kernel cancel drain must finish before the owned deadline').toBe(true);
  } finally {
    if (finishDeadline !== undefined) clearTimeout(finishDeadline);
    release.resolve();
    await running.catch(() => undefined);
  }

  expect(intentRef, 'a committed control ref must be known after the run').toBeDefined();
  if (intentRef === undefined) return;
  const records = await kernelRecords(fx);
  const unknown = records.find((item) => item.recordType === 'agent.event'
    && item.payload.event?.type === 'tool.outcome_unknown');
  expect(unknown, 'the real Kernel drain must have recorded tool.outcome_unknown').toBeDefined();

  const record = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  expect(record.status).toBe('ready');
  if (record.status !== 'ready') return;
  // An unknown side effect keeps the occupancy even when the tool batch no
  // longer lists it; an empty batch is not a stop proof.
  expect(record.value.session.occupancy, 'a formal outcome_unknown must keep the occupancy').not.toBeNull();
  expect(record.value.lease?.release).toBeUndefined();
  const ack = await controls.readControl(fx.ctx, intentRef);
  expect(ack.status).toBe('ready');
  if (ack.status === 'ready') {
    // Never a fabricated applied cancellation.
    expect(ack.value.status === 'queued' || ack.value.status === 'outcome_unknown').toBe(true);
  }

  // R4.3b: the new consumption branch must still reject a genuine
  // outcome_unknown terminal even when the reducer already cleared the batch.
  // Rebuild the SAME Run/Turn state from the real records already read above
  // through the original public reducer; no ToolResult is fabricated and the
  // unknown scenario is not re-run. A legal unknown state must surface the
  // original StoreError/conflict, not a consumable projection.
  const turnStart = records.find((item) => item.recordType === 'turn.started');
  expect(turnStart, 'the fixed turn.started record must be present').toBeDefined();
  if (turnStart === undefined || turnStart.recordType !== 'turn.started') return;
  let unknownState = createInitialRunState(turnStart.payload.run);
  for (const item of records) {
    if (item.position <= turnStart.position) continue;
    if (item.recordType !== 'agent.event') continue;
    const event = item.payload.event;
    if (event.meta.runId !== turnStart.payload.run.runId
      || event.meta.turnId !== turnStart.payload.run.turn.turnId) continue;
    unknownState = reduceRunState(unknownState, event);
  }
  expect(unknownState.status, 'the rebuilt state is the real cancelled/unknown terminal').toBe('cancelled');
  let unknownRejection: unknown;
  try {
    projectTerminalTranscript(unknownState);
  } catch (error) {
    unknownRejection = error;
  }
  expect(unknownRejection, 'projectTerminalTranscript must reject a genuine outcome_unknown').toBeInstanceOf(StoreError);
  expect((unknownRejection as StoreError).code).toBe('conflict');
}, 20000);

it('records the real entered fact and pauses when a pause is submitted after begin but before the entered write, even though the Host now rejects fresh configuration', async () => {
  const fx = await makeFixture({ scriptedReplies: [{ kind: 'text', text: 'must not run' }] });
  const controls = controlsOn(fx);
  let freshRejected = false;
  // The entry/model admission closures already hold this exact Host object.
  // Change its public provider so the actual fresh-admission dependency sees
  // the rejection too, not just the Runtime preparation wrapper.
  const host: RuntimeHostBindings = fx.host;
  const originalResolveConfiguration = host.resolveConfiguration.bind(host);
  vi.spyOn(host, 'resolveConfiguration').mockImplementation(async (ctx, input) => {
    if (freshRejected) {
      return { status: 'rejected', code: 'forbidden', reason: 'Host revoked fresh execution after begin' };
    }
    return originalResolveConfiguration(ctx, input);
  });
  const baseEntry = fx.deps.entry;
  let runtime!: AgentRuntimeService;
  let intentRef: ControlIntentRef | undefined;
  let deliverResult: Awaited<ReturnType<NonNullable<typeof runtime.port.deliverControl>>> | undefined;
  const entry: ExecutionEntryPort = {
    authorizeRuntimeEntry: (...args) => baseEntry.authorizeRuntimeEntry(...args),
    beginRuntimeEntry: (...args) => baseEntry.beginRuntimeEntry(...args),
    async recordExecutionEntered(ctx, request) {
      if (intentRef === undefined) {
        // The real begin has already committed; the Host now refuses new actions.
        freshRejected = true;
        const read = await fx.deps.executions.readExecution(ctx, fx.claim.runRef);
        if (read.status !== 'ready') throw Error('entered-window Run pin unavailable');
        const submitted = await controls.submitControl(ctx, {
          input: { runRef: fx.claim.runRef, kind: 'pause', reason: 'entered-window pause' },
          meta: { requestId: 'r4-runtime-entered-window-submit',
            expected: [{ ref: fx.claim.runRef, revision: read.value.run.revision }] },
        });
        if (submitted.status !== 'committed') throw Error('entered-window pause submit failed');
        intentRef = submitted.value.intent.ref;
        deliverResult = await runtime.port.deliverControl!(ctx, { intentRef });
      }
      return baseEntry.recordExecutionEntered(ctx, request);
    },
    recordRunResult: (...args) => baseEntry.recordRunResult(...args),
  };
  runtime = createAgentRuntime({ ...fx.deps, controls, host, entry });

  const prepared = await runtime.port.prepareExecution(fx.ctx, { runRef: fx.claim.runRef, requestId: 'r4-runtime-entered-window-prepare' });
  expect(prepared.status).toBe('ready');
  if (prepared.status !== 'ready') return;
  const running = runtime.port.startRun(fx.ctx, {
    prepared: prepared.value, consumerId: 'r4-runtime-entered-window-consumer', requestId: 'r4-runtime-entered-window-start',
  });
  // The real entered write may fail or be retried; the control assertion below is
  // the target boundary, so surface its rejection instead of requiring success.
  await running.catch(() => undefined);

  expect(deliverResult, 'entered-window pause delivery must reach the live driver').toMatchObject({ status: 'ready' });
  if (deliverResult?.status !== 'ready') return;
  expect(intentRef, 'a committed control ref must be known').toBeDefined();
  if (intentRef === undefined) return;

  const record = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  expect(record.status).toBe('ready');
  if (record.status !== 'ready') return;
  // The already-occurred entry is still recorded, and the consumed pause is real.
  expect(record.value.run.executionAuthorization).toMatchObject({ schemaVersion: 2, phase: 'entered' });
  expect(record.value.run.controlState).toMatchObject({ desiredState: 'paused' });
  expect(record.value.session.occupancy, 'a pause is not a release').not.toBeNull();
  expect(record.value.lease?.release).toBeUndefined();
  expect(fx.scripted.calls(), 'the pause must be honored before the provider').toBe(0);

  const records = await kernelRecords(fx);
  expect(records.some((item) => item.recordType === 'agent.event' && item.payload.event?.type === 'run.paused')).toBe(true);
  const ack = await controls.readControl(fx.ctx, intentRef);
  expect(ack).toMatchObject({ status: 'ready', value: { status: 'applied', observation: { kind: 'paused' } } });
});

it('releases a real cancel whose never-started second serial group is reducer-abandoned, then lets the next Kernel Turn consume the original projected prefix', async () => {
  const toolName = 'r4-runtime-cancel-tool';
  const entered = deferred();
  const release = deferred();
  const started: string[] = [];
  const tool = controlledTool(toolName, async (call) => {
    started.push(call.callId);
    // Only the first serial group blocks; the cancel must land before the second.
    if (call.callId === 'r4-runtime-cancel-group-1') {
      entered.resolve();
      await release.promise;
    }
    return successResult(call.callId, `settled ${call.callId}`);
  });
  const fx = await makeFixture({ scriptedReplies: [
    { kind: 'calls', calls: [
      { callId: 'r4-runtime-cancel-group-1', name: toolName, args: {} },
      { callId: 'r4-runtime-cancel-group-2', name: toolName, args: {} },
    ] },
    { kind: 'text', text: 'successor turn after the cancelled prefix' },
  ] });
  const controls = controlsOn(fx);
  const runtime = createAgentRuntime({ ...fx.deps, controls, kernel: withControlledTool(fx, tool) });

  const prepared = await runtime.port.prepareExecution(fx.ctx, { runRef: fx.claim.runRef, requestId: 'r4-runtime-cancel-prepare' });
  expect(prepared.status).toBe('ready');
  if (prepared.status !== 'ready') return;
  const running = runtime.port.startRun(fx.ctx, {
    prepared: prepared.value, consumerId: 'r4-runtime-cancel-consumer', requestId: 'r4-runtime-cancel-start',
  });
  let intentRef: ControlIntentRef | undefined;
  try {
    const first = await Promise.race([
      entered.promise.then(() => 'tool' as const),
      running.then(() => 'finished' as const),
    ]);
    expect(first, 'the first serial tool group must actually start').toBe('tool');
    if (first !== 'tool') return;

    const pin = await currentPin(fx);
    const submitted = await controls.submitControl(fx.ctx, {
      input: { runRef: fx.claim.runRef, kind: 'cancel', reason: 'operator cancel at the serial boundary' },
      meta: { requestId: 'r4-runtime-cancel-submit', expected: [pin] },
    });
    expect(submitted).toMatchObject({ status: 'committed' });
    if (submitted.status !== 'committed') return;
    intentRef = submitted.value.intent.ref;

    const delivered = await runtime.port.deliverControl!(fx.ctx, { intentRef });
    expect(delivered, 'cancel delivery must reach the live fixed Run').toMatchObject({ status: 'ready' });
    if (delivered.status !== 'ready') return;
    // A sent signal is not a proven stop while the first group is still settling.
    expect(await controls.readControl(fx.ctx, intentRef)).toMatchObject({
      status: 'ready', value: { status: 'queued' },
    });
  } finally {
    release.resolve();
  }

  // Stage-2 target: after the real first group settles, the Kernel records
  // run.cancelled and abandons the never-started second group. The original
  // observer must consume that through the shared projection and release.
  // Stage 1 stops at the published `version_unsupported` seam here; the release
  // and successor-consumption assertions below are the not-yet-reached tail.
  const outcome = await running.then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (reason) => ({ status: 'rejected' as const, reason }),
  );
  if (outcome.status === 'rejected') throw outcome.reason;
  expect(outcome.status).toBe('fulfilled');

  // The never-started second serial group is never started; only g1 settled.
  expect(started).toEqual(['r4-runtime-cancel-group-1']);
  expect(fx.scripted.calls(), 'no new provider call is needed to release the cancel').toBe(1);
  expect(intentRef).toBeDefined();
  if (intentRef === undefined) return;

  const record = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  expect(record.status).toBe('ready');
  if (record.status !== 'ready') return;
  expect(record.value.session.occupancy, 'a consumed cancel releases the Session').toBeNull();
  expect(record.value.lease?.release).toBeDefined();
  const ack = await controls.readControl(fx.ctx, intentRef);
  expect(ack).toMatchObject({ status: 'ready', value: { status: 'applied', observation: { kind: 'cancelled' } } });

  // The original cancelled prefix is append-only. The next formal Task in the
  // SAME Session is claimed through the existing TaskClaimPort, bound to the
  // same trusted Host fixture, and started through the original runtime. Its
  // Kernel Turn consumes the projected prefix: the provider sees the settled
  // first declaration/result and no fabricated second-group evidence.
  const cancelledRecords = await kernelRecords(fx);
  expect(cancelledRecords.some((item) => item.recordType === 'agent.event'
    && item.payload.event?.type === 'run.cancelled')).toBe(true);

  const secondRequest = await fx.claimFixture.buildRequest({
    requestId: 'r4-runtime-cancel-second-claim',
    input: { sessionRef: fx.claim.sessionRef, taskId: fx.claimFixture.tasks.second.taskId },
  });
  const secondClaim = await fx.deps.claims.claimTask(fx.ctx, secondRequest);
  expect(secondClaim.status, JSON.stringify(secondClaim)).toBe('committed');
  if (secondClaim.status !== 'committed') return;
  fx.allowRun(secondClaim.value.runRef);
  const nextPrepared = await runtime.port.prepareExecution(fx.ctx, {
    runRef: secondClaim.value.runRef, requestId: 'r4-runtime-cancel-second-prepare',
  });
  expect(nextPrepared.status).toBe('ready');
  if (nextPrepared.status !== 'ready') return;
  const nextRunning = runtime.port.startRun(fx.ctx, {
    prepared: nextPrepared.value, consumerId: 'r4-runtime-cancel-second-consumer',
    requestId: 'r4-runtime-cancel-second-start',
  });
  const next = await nextRunning;
  expect(next.status, JSON.stringify(next)).toBe('ready');
  if (next.status !== 'ready') return;
  expect(fx.scripted.calls(), 'the successor Turn issues exactly one provider call').toBe(2);

  const successorRequest = fx.scripted.lastRequest();
  expect(successorRequest).toBeDefined();
  if (successorRequest === undefined) return;
  const assistantCalls = successorRequest.messages.flatMap((message) =>
    message.role === 'assistant' ? message.toolCalls.map((call) => call.callId) : [],
  );
  expect(assistantCalls).toContain('r4-runtime-cancel-group-1');
  expect(assistantCalls).not.toContain('r4-runtime-cancel-group-2');
  const toolCallIds = successorRequest.messages.flatMap((message) =>
    message.role === 'tool' ? [message.callId] : [],
  );
  expect(toolCallIds).toContain('r4-runtime-cancel-group-1');
  expect(toolCallIds).not.toContain('r4-runtime-cancel-group-2');

  // The saved cancelled prefix stays identical and the same Session now has the
  // two real Turns.
  const afterRecords = await kernelRecords(fx);
  expect(afterRecords.slice(0, cancelledRecords.length)).toEqual(cancelledRecords);
  expect(afterRecords.filter((item) => item.recordType === 'turn.started')).toHaveLength(2);
}, 20000);
