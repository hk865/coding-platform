/**
 * A.2 step 5.6: the Run ends without a booked Kernel terminal, through the real
 * Runtime, the real WorkGraph owners and a real Kernel on one SQLite fixture
 * (docs/refactor/STATE-MACHINES-SPEC.md §6 RUN-03, RUN-14, RUN-16..21, RUN-24;
 * §4 TASK-27; §7 CTL-07, CTL-08(a)(c)(d)(e); §12.1 steps 2 and 5; §12.2 W-05,
 * W-09, W-13, W-15, W-16, W-20 and "进程内的同类收尾").
 *
 * A Host "restart" is a fresh Runtime and fresh owners over the same stores,
 * under another Host instance holding the lease; the start-up classifier
 * (`agent-runtime/run-reconcile.ts`) books what it proves. The crash points
 * the Host-level tests cannot reach on demand are made deterministic at the
 * frozen public Kernel boundary only: a Kernel call that fails before
 * `turn.started`, a Kernel call that never returns, a controlled tool that
 * keeps its call in flight, and a lost result commit (the WorkGraph owner
 * answering `unavailable` once). None grants anything or rewrites a record.
 *
 * Scripted model replies only; no real model is called.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { ControlIntentRef } from '../../src/contracts/control-intent.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { RuntimeExecutionDependencies } from '../../src/core/agent-runtime/execution-contracts.js';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import {
  reconcileRunAtStartup, reconcileRunControlsAtStartup, type RunReconcileClassifierDependencies,
} from '../../src/core/agent-runtime/run-reconcile.js';
import { createSessionHistoryCursorOwner } from '../../src/core/agent-runtime/session-operations.js';
import type { ExecutionEntryPort, HostInstanceFacts } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { createTaskRequeueService } from '../../src/core/work-graph/tasks/requeue-service.js';
import { GOAL_FAN_OUT_ACTOR, WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import type { RunControlPort } from '../../src/core/work-graph/tasks/control-contracts.js';
import { B2_AT, createB2RuntimeFixture, type B2RuntimeFixture } from '../helpers/B2-runtime-fixture.js';
import { toolSchema as z, type ToolCall, type ToolDefinition, type ToolResult } from '../../vendor/coding-agent/dist/public-api.js';

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

const HOST_1: HostInstanceFacts = { hostInstanceId: 'a2-runtime-host-1', lease: 'owned' };
const HOST_2: HostInstanceFacts = { hostInstanceId: 'a2-runtime-host-2', lease: 'owned' };
const HOST_3: HostInstanceFacts = { hostInstanceId: 'a2-runtime-host-3', lease: 'owned' };

async function makeFixture(options: Parameters<typeof createB2RuntimeFixture>[0] = {}): Promise<B2RuntimeFixture> {
  const fixture = await createB2RuntimeFixture({ ...options, kind: 'sqlite' });
  fixtures.push(fixture);
  return fixture;
}

type Controls = ReturnType<typeof createRunControlService>;

function controlsOn(fx: B2RuntimeFixture): Controls {
  let seq = 0;
  return createRunControlService({
    records: fx.claimFixture.records,
    authority: createMaterialRecordReaders(fx.claimFixture.records).authority,
    reads: createRunStateReader({ records: fx.claimFixture.records }),
    now: () => B2_AT,
    eventId: () => `a2-runtime-control-event-${++seq}`,
  });
}

/** A restarted Host: fresh owners over the same stores under `host`, and the start-up classifier's dependencies. */
function restartedHost(fx: B2RuntimeFixture, host: HostInstanceFacts, controls: RunControlPort) {
  const deps = fx.rebuildDeps({ hostInstance: host, runReconcile: true });
  let seq = 0;
  const classifier: RunReconcileClassifierDependencies = {
    owner: createSessionHistoryCursorOwner({ kernelStores: deps.kernelStores }), controls,
    entry: deps.entry, reconcile: deps.runReconcile!, now: () => B2_AT, newId: () => `a2-runtime-reconcile-${host.hostInstanceId}-${++seq}`,
  };
  const reconcile = async () => {
    const record = await read(fx, deps);
    const probe = await classifier.owner.probe({ session: record.session, signal: fx.ctx.signal });
    return reconcileRunAtStartup(classifier, fx.ctx, { record, hostInstanceId: host.hostInstanceId, probe });
  };
  return { deps, classifier, reconcile };
}

async function read(fx: B2RuntimeFixture, deps: RuntimeExecutionDependencies = fx.deps) {
  const record = await deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  if (record.status !== 'ready') throw new Error(`the Run must be readable: ${JSON.stringify(record)}`);
  return record.value;
}

async function submit(fx: B2RuntimeFixture, controls: RunControlPort, kind: 'pause' | 'cancel' | 'resume' | 'steer', reason: string | null,
  requestId: string): Promise<ControlIntentRef> {
  const run = (await read(fx)).run;
  const submitted = await controls.submitControl(fx.ctx, { input: { runRef: fx.claim.runRef, kind, reason },
    meta: { requestId, expected: [{ ref: fx.claim.runRef, revision: run.revision }] } });
  if (submitted.status !== 'committed') throw new Error(`${kind}: ${JSON.stringify(submitted)}`);
  return submitted.value.intent.ref;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => { resolve = settle; });
  return { promise, resolve };
}

/** A controlled Kernel tool (as `R4-control-runtime.test.ts`): it only decides WHEN a call settles. */
function blockingTool(name: string, entered: () => void, release: Promise<void>): ToolDefinition {
  return {
    name, description: 'A.2 step 5.6 controlled runtime tool', inputSchema: z.object({}).loose(), effectClass: 'read_only',
    requiredCapabilities: ['workspace_read'], defaultTimeoutMs: 60_000, outputLimitBytes: 1_024, independentReadOnly: false,
    summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
    handler: { execute: async (call: Readonly<ToolCall>): Promise<ToolResult> => {
      entered();
      await release;
      return { schemaVersion: 1, callId: call.callId, status: 'success', output: [{ kind: 'text', text: 'the late tool result' }],
        effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] } };
    } },
  };
}

function withTool(kernel: RuntimeExecutionDependencies['kernel'], tool: ToolDefinition): RuntimeExecutionDependencies['kernel'] {
  return {
    ...kernel,
    runCodingAgent: (options) => kernel.runCodingAgent({
      ...options,
      config: { ...options.config, tools: { ...options.config.tools, enabledNames: [...options.config.tools.enabledNames, tool.name] } },
      additionalTools: (workspace) => [...(options.additionalTools?.(workspace) ?? []), tool],
    }),
  };
}

async function prepare(fx: B2RuntimeFixture, runtime: ReturnType<typeof createAgentRuntime>, requestId: string) {
  const prepared = await runtime.port.prepareExecution(fx.ctx, { runRef: fx.claim.runRef, requestId });
  if (prepared.status !== 'ready') throw new Error(`prepare: ${JSON.stringify(prepared)}`);
  return prepared.value;
}

it('RUN-16 in process, then RUN-03: a Kernel call that fails before turn.started revokes the entry; the same claim re-authorizes at the next generation and runs', async () => {
  const fx = await makeFixture({ scriptedReplies: [{ kind: 'text', text: 'A2: the re-authorized Run' }] });
  const controls = controlsOn(fx);
  const deps = fx.rebuildDeps({ hostInstance: HOST_1, runReconcile: true });
  const failing = createAgentRuntime({ ...deps, controls, kernel: { ...deps.kernel,
    runCodingAgent: async () => { throw new Error('A2: the Kernel call failed before turn.started'); } } });
  const prepared = await prepare(fx, failing, 'a2-run16-prepare');
  await failing.port.startRun(fx.ctx, { prepared, consumerId: 'a2-run16-consumer', requestId: 'a2-run16-start' });
  const revoked = await read(fx);
  // RUN-16 (live_clean): the readable Kernel holds no Turn of the fixed identity; the claim keeps everything (ATT-04).
  expect(revoked.run).toMatchObject({ status: 'starting', startedAt: null,
    executionAuthorization: { schemaVersion: 2, phase: 'revoked', generation: 1 },
    reconciliation: { status: 'done', basis: { kind: 'live_clean' }, observation: { kind: 'not_entered', revokedGeneration: 1 } } });
  expect(revoked.attempt).toMatchObject({ status: 'claimed' });
  expect(revoked.outbox).toMatchObject({ status: 'pending' });
  expect(revoked.session.occupancy).toMatchObject({ kind: 'execution', executionRef: { runId: fx.claim.runRef.runId } });
  expect(revoked.lease?.release).toBeUndefined();
  expect(fx.scripted.calls()).toBe(0);

  // RUN-03 (W-03): the same prepared input re-authorizes the revoked binding at generation 2 and enters the Kernel.
  const healthy = createAgentRuntime({ ...deps, controls });
  const started = await healthy.port.startRun(fx.ctx, { prepared, consumerId: 'a2-run16-consumer', requestId: 'a2-run16-restart' });
  expect(started).toMatchObject({ status: 'ready', value: { run: { status: 'ended', outcome: 'completed',
    executionAuthorization: { phase: 'settled', generation: 2 } } } });
  expect(fx.scripted.calls()).toBe(1);
}, 60_000);

it('W-05 at a restart with CTL-08(a): an Entering Run without a Turn is revoked, a queued cancel ends it in the same commit; without one the claim re-drives', async () => {
  for (const withCancel of [false, true]) {
    const fx = await makeFixture({ scriptedReplies: [{ kind: 'text', text: 'A2: the re-driven Run' }] });
    const controls = controlsOn(fx);
    const deps = fx.rebuildDeps({ hostInstance: HOST_1, runReconcile: true });
    // The crash point A8-2: begin committed, the Kernel call never returned (no turn.started).
    const stuck = createAgentRuntime({ ...deps, controls, kernel: { ...deps.kernel, runCodingAgent: () => new Promise(() => undefined) } });
    const prepared = await prepare(fx, stuck, 'a2-w05-prepare');
    void stuck.port.startRun(fx.ctx, { prepared, consumerId: 'a2-w05-consumer', requestId: 'a2-w05-start' });
    for (let attempt = 0; attempt < 100 && (await read(fx)).run.executionAuthorization === undefined; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const auth = (await read(fx)).run.executionAuthorization;
      if (auth !== undefined && 'phase' in auth && auth.phase === 'entering') break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect((await read(fx)).run.executionAuthorization).toMatchObject({ phase: 'entering' });
    const cancelRef = withCancel ? await submit(fx, controls, 'cancel', 'stop before it entered', 'a2-w05-cancel') : null;

    const restarted = restartedHost(fx, HOST_2, controls);
    expect(await restarted.reconcile(), String(withCancel)).toMatchObject({ row: 'W-05', status: 'reconciled', reason: 'not_entered' });
    const after = await read(fx, restarted.deps);
    if (cancelRef === null) {
      expect(after.run).toMatchObject({ status: 'starting', executionAuthorization: { phase: 'revoked', generation: 1 },
        reconciliation: { basis: { kind: 'host_instance_takeover', hostInstanceId: HOST_2.hostInstanceId } } });
      // RUN-03: the same claim re-authorizes (generation 2) and runs; the stuck call of the old process is gone.
      const runtime = createAgentRuntime({ ...restarted.deps, controls });
      const started = await runtime.port.startRun(fx.ctx, { prepared, consumerId: 'a2-w05-consumer', requestId: 'a2-w05-redrive' });
      expect(started).toMatchObject({ status: 'ready', value: { run: { status: 'ended', outcome: 'completed',
        executionAuthorization: { generation: 2 } } } });
    } else {
      // RUN-16 + RUN-09 (R): the queued cancel ends the Run that never entered; the claim is released (SES-05).
      expect(after.run).toMatchObject({ status: 'ended', outcome: 'cancelled' });
      expect(after.session.occupancy).toBeNull();
      expect(after.lease?.release).toBeDefined();
      expect(await controls.readControl(fx.ctx, cancelRef)).toMatchObject({ status: 'ready', value: { status: 'applied',
        observation: { origin: 'platform_not_entered', kind: 'cancelled' } } });
      expect(fx.scripted.calls()).toBe(0);
    }
  }
}, 90_000);

it('W-13 then W-15 (RUN-20(i), CTL-08(d), RUN-21 at a restart): a tool still in flight ends the Run unknown; its late result is booked by the next start', async () => {
  const toolName = 'a2-runtime-in-flight';
  const entered = deferred();
  const release = deferred();
  const fx = await makeFixture({ scriptedReplies: [
    { kind: 'calls', calls: [{ callId: 'a2-in-flight', name: toolName, args: {} }] },
    { kind: 'text', text: 'A2: done after the late tool result' }] });
  const controls = controlsOn(fx);
  const deps = fx.rebuildDeps({ hostInstance: HOST_1, runReconcile: true });
  const crashed = createAgentRuntime({ ...deps, controls, kernel: withTool(deps.kernel, blockingTool(toolName, entered.resolve, release.promise)) });
  const prepared = await prepare(fx, crashed, 'a2-w13-prepare');
  const running = crashed.port.startRun(fx.ctx, { prepared, consumerId: 'a2-w13-consumer', requestId: 'a2-w13-start' });
  try {
    await entered.promise;
    // A steer queued while the tool runs (never supplied: this fixture has no mailbox input channel).
    const steerRef = await submit(fx, controls, 'steer', 'A2: keep going', 'a2-w13-steer');

    // The restart: the tool call has no result (RUN-20(i)); the Session and the Lease stay held (D-4).
    const second = restartedHost(fx, HOST_2, controls);
    expect(await second.reconcile()).toMatchObject({ row: 'W-13', status: 'reconciled', reason: 'unknown' });
    const unknown = await read(fx, second.deps);
    expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown',
      reconciliation: { status: 'quarantined', observation: { kind: 'unresolved', reason: 'tool_calls_unresolved',
        unresolvedToolCallIds: ['a2-in-flight'] } } });
    expect(unknown.session.occupancy).toMatchObject({ kind: 'execution', executionRef: { runId: fx.claim.runRef.runId } });
    expect(unknown.lease?.release).toBeUndefined();
    // CTL-08(d): the queued steer becomes outcome_unknown in the same commit.
    expect(await controls.readControl(fx.ctx, steerRef)).toMatchObject({ status: 'ready', value: { status: 'outcome_unknown',
      observation: { origin: 'platform_reconcile', kind: 'outcome_unknown' } } });
    // A second read of the same facts is no new evidence (RD-4): left, nothing written.
    expect(await restartedHost(fx, HOST_3, controls).reconcile()).toMatchObject({ row: 'W-15', status: 'left' });
    expect((await read(fx)).run.revision).toBe(unknown.run.revision);

    // The old process's tool returns late and its Turn reaches a Kernel terminal (no booking: the Run ended).
    release.resolve();
    await running;
    expect((await read(fx)).run.revision, 'the old process books nothing').toBe(unknown.run.revision);

    // W-15 at the next start: RUN-21 books the new Kernel terminal (RD-4) and releases what the unknown end kept.
    // (The old process's next model admission is refused once its Run ended, so its Turn ends with that failure.)
    const third = restartedHost(fx, HOST_3, controls);
    const booked = await third.reconcile();
    expect(booked).toMatchObject({ row: 'W-15', status: 'reconciled' });
    expect(booked.reason).toMatch(/^terminal [a-z_]+$/);
    const resolved = await read(fx, third.deps);
    expect(resolved.run).toMatchObject({ status: 'ended',
      reconciliation: { status: 'done', basis: { kind: 'host_instance_takeover', hostInstanceId: HOST_3.hostInstanceId },
        observation: { kind: 'runtime_terminal' } } });
    expect(resolved.run.outcome, 'a known outcome from the Kernel terminal').not.toBe('outcome_unknown');
    expect(resolved.run.terminalPayload).toBeDefined();
    expect(resolved.session.occupancy).toBeNull();
    expect(resolved.session.historyCursor).not.toBeNull();
    expect(resolved.lease?.release).toBeDefined();
    // CTL-07: the outcome_unknown steer settles with the late terminal (the end came first).
    expect(await controls.readControl(fx.ctx, steerRef)).toMatchObject({ status: 'ready', value: { status: 'superseded',
      observation: { kind: 'terminal_without_cancel' } } });
  } finally {
    release.resolve();
    await running.catch(() => undefined);
  }
}, 90_000);

it('RUN-21 in process: reading an unknown end whose late Kernel terminal arrived books it on the live proof', async () => {
  const toolName = 'a2-runtime-late';
  const entered = deferred();
  const release = deferred();
  const fx = await makeFixture({ scriptedReplies: [
    { kind: 'calls', calls: [{ callId: 'a2-late', name: toolName, args: {} }] },
    { kind: 'text', text: 'A2: done after the late tool result' }] });
  const controls = controlsOn(fx);
  const deps = fx.rebuildDeps({ hostInstance: HOST_1, runReconcile: true });
  const crashed = createAgentRuntime({ ...deps, controls, kernel: withTool(deps.kernel, blockingTool(toolName, entered.resolve, release.promise)) });
  const prepared = await prepare(fx, crashed, 'a2-run21-prepare');
  const running = crashed.port.startRun(fx.ctx, { prepared, consumerId: 'a2-run21-consumer', requestId: 'a2-run21-start' });
  try {
    await entered.promise;
    const second = restartedHost(fx, HOST_2, controls);
    expect(await second.reconcile()).toMatchObject({ row: 'W-13', status: 'reconciled' });
    const runtime = createAgentRuntime({ ...second.deps, controls });
    // Before the late result the observation leaves the unknown end as recorded.
    expect(await runtime.port.observeRun(fx.ctx, { runRef: fx.claim.runRef })).toMatchObject({ status: 'ready',
      value: { run: { outcome: 'outcome_unknown' } } });
    release.resolve();
    await running;
    const observed = await runtime.port.observeRun(fx.ctx, { runRef: fx.claim.runRef });
    expect(observed).toMatchObject({ status: 'ready', value: { run: { status: 'ended',
      reconciliation: { status: 'done', basis: { kind: 'live_clean' }, observation: { kind: 'runtime_terminal' } } } } });
    if (observed.status === 'ready') {
      expect(observed.value.run.outcome, 'a known outcome from the Kernel terminal').not.toBe('outcome_unknown');
      expect(observed.value.session.occupancy).toBeNull();
      expect(observed.value.lease?.release).toBeDefined();
    }
  } finally {
    release.resolve();
    await running.catch(() => undefined);
  }
}, 90_000);

it('W-09 at a restart (RUN-18): a Kernel terminal whose result commit was lost is booked as recorded; the owner refuses it without the input confirmation', async () => {
  const fx = await makeFixture({ scriptedReplies: [{ kind: 'text', text: 'A2: the terminal the crash did not book' }] });
  const controls = controlsOn(fx);
  const deps = fx.rebuildDeps({ hostInstance: HOST_1, runReconcile: true });
  const lost: ExecutionEntryPort = { ...deps.entry,
    recordRunResult: async () => ({ status: 'rejected', code: 'unavailable', reason: 'A2: the result commit was lost with the process' }) };
  const crashed = createAgentRuntime({ ...deps, controls, entry: lost });
  const prepared = await prepare(fx, crashed, 'a2-w09-prepare');
  await crashed.port.startRun(fx.ctx, { prepared, consumerId: 'a2-w09-consumer', requestId: 'a2-w09-start' });
  const before = await read(fx);
  expect(before.run).toMatchObject({ status: 'running' });
  expect(fx.scripted.calls()).toBe(1);

  const restarted = restartedHost(fx, HOST_2, controls);
  let refused: unknown;
  // §10.3, RUN-18: the owner judges the input confirmation the Runtime carries; unconfirmed is `unavailable`, no write.
  restarted.classifier.entry = { recordRunResult: async (ctx, request) => {
    refused = await restarted.deps.entry.recordRunResult(ctx, { input: { ...request.input, inputsConfirmed: false },
      meta: { ...request.meta, requestId: `${request.meta.requestId}:unconfirmed` } });
    return restarted.deps.entry.recordRunResult(ctx, request);
  } };
  expect(await restarted.reconcile()).toMatchObject({ row: 'W-09', status: 'reconciled', reason: 'terminal completed' });
  expect(refused).toMatchObject({ status: 'rejected', code: 'unavailable' });
  const booked = await read(fx, restarted.deps);
  expect(booked.run).toMatchObject({ status: 'ended', outcome: 'completed',
    reconciliation: { status: 'done', basis: { kind: 'host_instance_takeover', hostInstanceId: HOST_2.hostInstanceId },
      observation: { kind: 'runtime_terminal' } } });
  expect(booked.attempt).toMatchObject({ status: 'ended' });
  expect(booked.outbox).toMatchObject({ status: 'settled' });
  expect(booked.session.occupancy).toBeNull();
  expect(booked.session.historyCursor).not.toBeNull();
  expect(booked.lease?.release).toBeDefined();
  expect(fx.scripted.calls(), 'the restart books the recorded terminal; no model call').toBe(1);
}, 60_000);

it('RUN-14 driver guard: a queued resume of a Run paused at a safe point re-enters only on the Runtime holding its live handle; a fresh one answers busy with no Kernel call', async () => {
  const fx = await makeFixture({ scriptedReplies: [
    { kind: 'calls', calls: [{ callId: 'a2-run14-read', name: 'read', args: { path: 'b2-read.txt' } }] },
    { kind: 'text', text: 'A2: resumed on the live handle' }],
  beforeReply: async (_request, index) => { if (index === 0) await pause(); } });
  const controls = controlsOn(fx);
  const deps = fx.rebuildDeps({ hostInstance: HOST_1, runReconcile: true });
  let pause: () => Promise<void> = async () => undefined;
  pause = async () => { await submit(fx, controls, 'pause', 'pause at the safe point', 'a2-run14-pause'); };
  const live = createAgentRuntime({ ...deps, controls });
  const prepared = await prepare(fx, live, 'a2-run14-prepare');
  await live.port.startRun(fx.ctx, { prepared, consumerId: 'a2-run14-consumer', requestId: 'a2-run14-start' });
  expect((await read(fx)).run).toMatchObject({ status: 'running', controlState: { desiredState: 'paused' } });
  await submit(fx, controls, 'resume', null, 'a2-run14-resume');
  const pinned = (await read(fx)).run.revision;

  // Another process has no live handle: busy, no Kernel call, no write.
  const fresh = createAgentRuntime({ ...fx.rebuildDeps({ hostInstance: HOST_2, runReconcile: true }), controls });
  expect(await fresh.port.startRun(fx.ctx, { prepared, consumerId: 'a2-run14-consumer', requestId: 'a2-run14-fresh' }))
    .toMatchObject({ status: 'rejected', code: 'busy' });
  expect(fx.scripted.calls()).toBe(1);
  expect((await read(fx)).run.revision).toBe(pinned);

  // The Runtime that holds the handle is not refused: it re-enters the original Turn (R4.3a resume).
  expect(await live.port.startRun(fx.ctx, { prepared, consumerId: 'a2-run14-consumer', requestId: 'a2-run14-resume-start' }))
    .toMatchObject({ status: 'ready' });
}, 60_000);

it('W-20 then TASK-27 refusals: a Run a person paused before its process ended is continued only by a person', async () => {
  const fx = await makeFixture({ scriptedReplies: [
    { kind: 'calls', calls: [{ callId: 'a2-task27-read', name: 'read', args: { path: 'b2-read.txt' } }] },
    { kind: 'text', text: 'never reached' }],
  beforeReply: async (_request, index) => { if (index === 0) await pause(); } });
  const controls = controlsOn(fx);
  let pause: () => Promise<void> = async () => undefined;
  pause = async () => { await submit(fx, controls, 'pause', 'a person pauses', 'a2-task27-pause'); };
  const deps = fx.rebuildDeps({ hostInstance: HOST_1, runReconcile: true });
  const live = createAgentRuntime({ ...deps, controls });
  const prepared = await prepare(fx, live, 'a2-task27-prepare');
  await live.port.startRun(fx.ctx, { prepared, consumerId: 'a2-task27-consumer', requestId: 'a2-task27-start' });

  // The restart: the paused, clean Turn ends paused-interrupted (RUN-24, C4).
  const restarted = restartedHost(fx, HOST_2, controls);
  expect(await restarted.reconcile()).toMatchObject({ row: 'W-20', status: 'reconciled' });
  const ended = await read(fx, restarted.deps);
  expect(ended.run).toMatchObject({ status: 'ended', outcome: 'crashed',
    reconciliation: { observation: { kind: 'interrupted_clean', kernelPaused: true } } });

  const requeues = createTaskRequeueService({ records: fx.claimFixture.records, reads: restarted.deps.executions,
    workspaceHost: restarted.deps.workspaceHost, materials: restarted.deps.materials,
    source: { captureDigest: async () => { throw new Error('A2: the refusals come before any source capture'); } },
    messages: { readMessage: async () => ({ status: 'rejected', code: 'unsupported', reason: 'no message is referenced' }) },
    now: () => B2_AT, eventId: () => 'a2-task27-event' });
  const goalRef = fx.claimFixture.goalRef;
  const goalRevision = async () => {
    const goal = await fx.claimFixture.plans.queryGoal(fx.ctx, goalRef);
    if (goal.status !== 'ready') throw new Error('the Goal must be readable');
    return goal.value.goal.revision;
  };
  const request = async (requestId: string) => ({ input: { taskRef: fx.claim.task, afterRunRef: fx.claim.runRef, reason: 'continue' },
    meta: { requestId, expected: [{ ref: goalRef, revision: await goalRevision() }, { ref: fx.claim.runRef, revision: ended.run.revision }] } });
  // TASK-27: the platform's automation is no operator: forbidden (a person's pause, hard limit 3); the Goal fan-out
  // actor without its goal_resume trigger is no exception. (A person's 继续 while the Goal is paused is `busy`:
  // `tests/scenarios/A7-control.test.ts`, the G-04 test.)
  const system = { ...fx.ctx, principal: { kind: 'host' as const, actor: { ...WORKFLOW_AUTOMATION_ACTOR } } };
  expect(await requeues.requeueTask(system, await request('a2-task27-system'))).toMatchObject({ status: 'rejected', code: 'forbidden' });
  const fanOut = { ...fx.ctx, principal: { kind: 'host' as const, actor: { ...GOAL_FAN_OUT_ACTOR } } };
  expect(await requeues.requeueTask(fanOut, await request('a2-task27-fan-out'))).toMatchObject({ status: 'rejected' });
  expect((await read(fx, restarted.deps)).run.revision, 'a refusal writes nothing').toBe(ended.run.revision);
}, 60_000);

it('§12.1 step 5, CTL-08(e)/(c): an ended Run that still carries a queued pause and steer settles them at the restart (the end came first)', async () => {
  const fx = await makeFixture({ scriptedReplies: [{ kind: 'text', text: 'A2: ended with intents still queued' }],
    beforeReply: async () => { await queue(); } });
  const controls = controlsOn(fx);
  let queue: () => Promise<void> = async () => undefined;
  let pauseRef: ControlIntentRef | undefined;
  let steerRef: ControlIntentRef | undefined;
  queue = async () => {
    pauseRef = await submit(fx, controls, 'pause', 'too late to pause', 'a2-ctl08e-pause');
    steerRef = await submit(fx, controls, 'steer', 'A2: too late to steer', 'a2-ctl08e-steer');
  };
  // The acks after the terminal are lost with the process (the observation writes answer `unavailable`).
  const lostAcks: Controls = { ...controls,
    recordControlObservation: async () => ({ status: 'rejected', code: 'unavailable', reason: 'A2: the ack was lost with the process' }) };
  const deps = fx.rebuildDeps({ hostInstance: HOST_1, runReconcile: true });
  const crashed = createAgentRuntime({ ...deps, controls: lostAcks });
  const prepared = await prepare(fx, crashed, 'a2-ctl08e-prepare');
  await crashed.port.startRun(fx.ctx, { prepared, consumerId: 'a2-ctl08e-consumer', requestId: 'a2-ctl08e-start' });
  const ended = await read(fx);
  expect(ended.run).toMatchObject({ status: 'ended', outcome: 'completed' });
  if (pauseRef === undefined || steerRef === undefined) throw new Error('the intents must be submitted');
  expect(await controls.readControl(fx.ctx, pauseRef)).toMatchObject({ status: 'ready', value: { status: 'queued' } });

  const restarted = restartedHost(fx, HOST_2, controls);
  const report = await reconcileRunControlsAtStartup({ owner: restarted.classifier.owner, reconcile: restarted.deps.runReconcile! },
    fx.ctx, { record: ended, hostInstanceId: HOST_2.hostInstanceId, queuedSteers: true });
  expect(report).toMatchObject({ row: 'W-16', status: 'reconciled' });
  // The Kernel accepted neither (no input channel here): both are superseded by the end, with the Run as the CAS guard.
  for (const ref of [pauseRef, steerRef]) {
    expect(await controls.readControl(fx.ctx, ref)).toMatchObject({ status: 'ready', value: { status: 'superseded',
      observation: { origin: 'platform_reconcile', kind: 'terminal_without_cancel',
        detail: { hostInstanceId: HOST_2.hostInstanceId, runOutcome: 'completed' } } } });
  }
  expect((await read(fx)).run.revision, 'the Run is only the guard').toBe(ended.run.revision);
  // The same instance again replays its receipt (the identity names the Run revision, which did not move): no write.
  const settled = await controls.readControl(fx.ctx, pauseRef);
  expect(await reconcileRunControlsAtStartup({ owner: restarted.classifier.owner, reconcile: restarted.deps.runReconcile! },
    fx.ctx, { record: await read(fx), hostInstanceId: HOST_2.hostInstanceId, queuedSteers: false })).toMatchObject({ status: 'reconciled' });
  expect(await controls.readControl(fx.ctx, pauseRef)).toEqual(settled);
}, 60_000);
