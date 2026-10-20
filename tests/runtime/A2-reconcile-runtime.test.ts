/**
 * A.2 step 5.6: the Run ends without a booked Kernel terminal, through the real
 * Runtime, the real WorkGraph owners and a real Kernel on one SQLite fixture
 * (docs/refactor/STATE-MACHINES-SPEC.md §6 RUN-03, RUN-08..11, RUN-14,
 * RUN-16..21, RUN-24; §4 TASK-27; §7 CTL-07, CTL-08(c)(d)(e); §12.1 steps 2
 * and 5; §12.2 W-05, W-09, W-13, W-15, W-16, W-19, W-20 and
 * "进程内的同类收尾"; §12.5 CI-05; the §12.10 cases A8-3e
 * (W-13) and A8-3k, which the Host-level A8 files cannot reach).
 *
 * A Host "restart" is a fresh Runtime and fresh owners over the same stores,
 * under another Host instance holding the lease; the start-up classifier
 * (`agent-runtime/run-reconcile.ts`) books what it proves. The crash points
 * the Host-level tests cannot reach on demand are made deterministic at the
 * frozen public Kernel boundary only: a Kernel call that fails before
 * `turn.started`, a Kernel call that never returns, a controlled tool that
 * keeps its call in flight or ignores a cancel, and a lost result commit or
 * control ack (the WorkGraph owner answering `unavailable`). None grants
 * anything or rewrites a record.
 *
 * Scripted model replies only; no real model is called.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { ControlIntentRef } from '../../src/contracts/control-intent.js';
import type { HostTakeoverProofV1, WorkspaceCaptureV1 } from '../../src/contracts/unknown-call-review.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { RuntimeExecutionDependencies } from '../../src/core/agent-runtime/execution-contracts.js';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import {
  reconcileRunAtStartup, reconcileRunControlsAtStartup, type RunReconcileClassifierDependencies,
} from '../../src/core/agent-runtime/run-reconcile.js';
import { createSessionHistoryCursorOwner } from '../../src/core/agent-runtime/session-operations.js';
import type { KernelTurnBoundsRead, SessionHistoryEntry, SessionMappingProbe } from '../../src/core/agent-runtime/session-operations.js';
import type { ExecutionEntryPort, HostInstanceFacts } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { createUnknownCallReviewService } from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import { createTaskRequeueService } from '../../src/core/work-graph/tasks/requeue-service.js';
import { GOAL_FAN_OUT_ACTOR, WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import type { RunControlPort } from '../../src/core/work-graph/tasks/control-contracts.js';
import { createRunReconcileService } from '../../src/core/work-graph/tasks/run-reconcile-service.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { B2_AT, createB2RuntimeFixture, type B2RuntimeFixture } from '../helpers/B2-runtime-fixture.js';
import { toolSchema as z, type ToolCall, type ToolDefinition, type ToolResult } from '../../vendor/coding-agent/dist/public-api.js';

vi.mock('../helpers/task-claim-fixture.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../helpers/task-claim-fixture.js')>();
  const { CONTROL_RECORD_SCHEMAS } = await import('../../src/core/work-graph/persistence/control-record-codecs.js');
  // The GoalPhase schema lets A8-1d pause its Goal through the owner (setGoalControl guards the GoalPhase pin).
  const { COMPLETION_RECORD_SCHEMAS } = await import('../../src/core/work-graph/tasks/completion-record-codecs.js');
  // K3: RUN-25/RUN-22 create an UnknownCallReview in the same commit, so the
  // review snapshot and its `UnknownCallReviewChanged@1` event must be registered.
  const { UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS } = await import('../../src/core/work-graph/tasks/unknown-call-review-codecs.js');
  const withControls = (
    kind: Parameters<typeof actual.createTaskClaimFixture>[0],
    additionalSchemas: RecordBackendSchemas = { records: [], events: [] },
  ) => actual.createTaskClaimFixture(kind, {
    records: [...additionalSchemas.records, ...CONTROL_RECORD_SCHEMAS.records, ...COMPLETION_RECORD_SCHEMAS.records,
      ...UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.records],
    events: [...additionalSchemas.events, ...CONTROL_RECORD_SCHEMAS.events, ...COMPLETION_RECORD_SCHEMAS.events,
      ...UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.events],
    lookups: [...(additionalSchemas.lookups ?? []), ...(CONTROL_RECORD_SCHEMAS.lookups ?? []),
      ...(COMPLETION_RECORD_SCHEMAS.lookups ?? []), ...(UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.lookups ?? [])],
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
type ClassifierOverrides = Partial<Pick<RunReconcileClassifierDependencies,
  'turnClosureSupport' | 'captureWorkspace' | 'lookupToolCommit'>>;

function restartedHost(fx: B2RuntimeFixture, host: HostInstanceFacts, controls: RunControlPort,
  overrides: ClassifierOverrides = {}, takeover?: HostTakeoverProofV1 | null, probeOverride?: SessionMappingProbe) {
  const deps = fx.rebuildDeps({ hostInstance: host, runReconcile: true });
  let seq = 0;
  const classifier: RunReconcileClassifierDependencies = {
    owner: createSessionHistoryCursorOwner({ kernelStores: deps.kernelStores }), controls,
    entry: deps.entry, reconcile: deps.runReconcile!, now: () => B2_AT, newId: () => `a2-runtime-reconcile-${host.hostInstanceId}-${++seq}`,
    ...overrides,
  };
  const reconcile = async () => {
    const record = await read(fx, deps);
    const probe = probeOverride ?? await classifier.owner.probe({ session: record.session, signal: fx.ctx.signal });
    return reconcileRunAtStartup(classifier, fx.ctx, { record, hostInstanceId: host.hostInstanceId, probe, takeover: takeover ?? null });
  };
  return { deps, classifier, reconcile };
}

async function read(fx: B2RuntimeFixture, deps: RuntimeExecutionDependencies = fx.deps) {
  const record = await deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  if (record.status !== 'ready') throw new Error(`the Run must be readable: ${JSON.stringify(record)}`);
  return record.value;
}

/** `read` for one explicitly named Run (K3-05/K3-21 drive a review-purpose Run, not `fx.claim.runRef`). */
async function readRun(fx: B2RuntimeFixture, runRef: RunRef, deps: RuntimeExecutionDependencies = fx.deps) {
  const record = await deps.executions.readExecution(fx.ctx, runRef);
  if (record.status !== 'ready') throw new Error(`the Run must be readable: ${JSON.stringify(record)}`);
  return record.value;
}

/** `restartedHost` for one explicitly named Run (the same fresh owners over the same stores). */
function restartedHostFor(fx: B2RuntimeFixture, runRef: RunRef, host: HostInstanceFacts, controls: RunControlPort,
  overrides: ClassifierOverrides = {}, takeover?: HostTakeoverProofV1 | null) {
  const deps = fx.rebuildDeps({ hostInstance: host, runReconcile: true });
  let seq = 0;
  const classifier: RunReconcileClassifierDependencies = {
    owner: createSessionHistoryCursorOwner({ kernelStores: deps.kernelStores }), controls,
    entry: deps.entry, reconcile: deps.runReconcile!, now: () => B2_AT,
    newId: () => `a2-runtime-reconcile-review-${host.hostInstanceId}-${++seq}`,
    ...overrides,
  };
  const reconcile = async () => {
    const record = await readRun(fx, runRef, deps);
    const probe = await classifier.owner.probe({ session: record.session, signal: fx.ctx.signal });
    return reconcileRunAtStartup(classifier, fx.ctx, { record, hostInstanceId: host.hostInstanceId, probe, takeover: takeover ?? null });
  };
  return { deps, classifier, reconcile };
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
function blockingTool(name: string, entered: () => void, release: Promise<void>,
  options: { independentReadOnly?: boolean } = {}): ToolDefinition {
  return {
    name, description: 'A.2 step 5.6 controlled runtime tool', inputSchema: z.object({}).loose(), effectClass: 'read_only',
    requiredCapabilities: ['workspace_read'], defaultTimeoutMs: 60_000, outputLimitBytes: 1_024,
    independentReadOnly: options.independentReadOnly ?? false,
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

it('W-05 with a queued pause at a restart: the not-entered reconcile applies it as paused, keeps the claim and replays as no new evidence', async () => {
  const fx = await makeFixture({ scriptedReplies: [{ kind: 'text', text: 'A2: never reached for the paused entry' }] });
  const controls = controlsOn(fx);
  const deps = fx.rebuildDeps({ hostInstance: HOST_1, runReconcile: true });
  // The crash point A8-2: begin committed, the Kernel call never returned (no turn.started).
  const stuck = createAgentRuntime({ ...deps, controls, kernel: { ...deps.kernel, runCodingAgent: () => new Promise(() => undefined) } });
  const prepared = await prepare(fx, stuck, 'a2-w05-pause-prepare');
  void stuck.port.startRun(fx.ctx, { prepared, consumerId: 'a2-w05-pause-consumer', requestId: 'a2-w05-pause-start' });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const auth = (await read(fx)).run.executionAuthorization;
    if (auth !== undefined && 'phase' in auth && auth.phase === 'entering') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  expect((await read(fx)).run.executionAuthorization).toMatchObject({ phase: 'entering' });
  const pauseRef = await submit(fx, controls, 'pause', 'pause the entering Run', 'a2-w05-pause');

  const restarted = restartedHost(fx, HOST_2, controls);
  expect(await restarted.reconcile()).toMatchObject({ row: 'W-05', status: 'reconciled', reason: 'not_entered' });
  const after = await read(fx, restarted.deps);
  // RUN-16 + CTL-08(a): the revoked Run keeps the claim and the pointer's pause;
  // reconcile-intents.ts:163-167 writes the not-entered paused observation.
  expect(after.run).toMatchObject({ status: 'starting',
    executionAuthorization: { phase: 'revoked', generation: 1 },
    reconciliation: { basis: { kind: 'host_instance_takeover' } },
    controlState: { intentRef: pauseRef, desiredState: 'paused' } });
  expect(after.attempt).toMatchObject({ status: 'claimed' });
  expect(after.outbox).toMatchObject({ status: 'pending' });
  expect(after.session.occupancy).toMatchObject({ kind: 'execution' });
  expect(after.lease?.release).toBeUndefined();
  const applied = await controls.readControl(fx.ctx, pauseRef);
  expect(applied).toMatchObject({ status: 'ready', value: { status: 'applied',
    observation: { origin: 'platform_not_entered', kind: 'paused', detail: { entryPhase: 'revoked' } } } });
  expect(fx.scripted.calls()).toBe(0);

  // A second restart reads the same facts: no new evidence, the intent stays applied.
  expect(await restartedHost(fx, HOST_3, controls).reconcile()).toMatchObject({ status: 'left' });
  expect(await controls.readControl(fx.ctx, pauseRef)).toEqual(applied);
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
    expect(await second.reconcile()).toMatchObject({ row: 'W-13', status: 'reconciled', reason: 'unknown',
      autoCleanup: { applied: false, blockedBy: 'no_takeover_proof' } });
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

it('A8-3k (W-19, CI-05, RUN-08, CTL-08(d)): the in-process unknown end committed and the crash lost the cancel\'s ack; the restart records the cancel outcome_unknown and keeps the Run, its Session and its Lease', async () => {
  const toolName = 'a2-runtime-ignoring';
  const entered = deferred();
  const release = deferred();
  const fx = await makeFixture({ scriptedReplies: [
    { kind: 'calls', calls: [{ callId: 'a2-w19-ignoring', name: toolName, args: {} }] },
    { kind: 'text', text: 'A2: never reached, the cancel drain ends the Turn' }] });
  const controls = controlsOn(fx);
  // The ack after the unknown end is lost with the process (the observation write answers `unavailable`).
  const lostAcks: Controls = { ...controls,
    recordControlObservation: async () => ({ status: 'rejected', code: 'unavailable', reason: 'A2: the ack was lost with the process' }) };
  const deps = fx.rebuildDeps({ hostInstance: HOST_1, runReconcile: true });
  // The tool ignores the cancellation (it waits for `release` only): the Kernel's own drain ends its call outcome_unknown.
  const runtime = createAgentRuntime({ ...deps, controls: lostAcks,
    kernel: withTool(deps.kernel, blockingTool(toolName, entered.resolve, release.promise)) });
  const prepared = await prepare(fx, runtime, 'a2-w19-prepare');
  const running = runtime.port.startRun(fx.ctx, { prepared, consumerId: 'a2-w19-consumer', requestId: 'a2-w19-start' });
  let cancelRef: ControlIntentRef | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await entered.promise;
    cancelRef = await submit(fx, controls, 'cancel', 'stop now', 'a2-w19-cancel');
    expect(await runtime.port.deliverControl!(fx.ctx, { intentRef: cancelRef })).toMatchObject({ status: 'ready' });
    const finished = await Promise.race([running.then(() => true),
      new Promise<false>((resolve) => { deadline = setTimeout(() => resolve(false), 8_000); })]);
    expect(finished, 'the Kernel cancel drain must end the Turn').toBe(true);
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
    release.resolve();
    await running.catch(() => undefined);
  }
  if (cancelRef === undefined) throw new Error('the cancel must be submitted');
  // RUN-08 (RD-2): the unknown end on the live proof keeps the Session and the Lease; its ack never reached the ledger.
  const unknown = await read(fx);
  expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown', controlState: { intentRef: cancelRef },
    reconciliation: { status: 'quarantined', basis: { kind: 'live_clean' }, observation: { kind: 'unresolved',
      unresolvedToolCallIds: ['a2-w19-ignoring'] } } });
  expect(await controls.readControl(fx.ctx, cancelRef)).toMatchObject({ status: 'ready', value: { status: 'queued' } });

  // The restart, §12.1 step 5: CTL-08(d) records the queued cancel outcome_unknown; the Run is only the CAS guard.
  const restarted = restartedHost(fx, HOST_2, controls);
  expect(await reconcileRunControlsAtStartup({ owner: restarted.classifier.owner, reconcile: restarted.deps.runReconcile! },
    fx.ctx, { record: unknown, hostInstanceId: HOST_2.hostInstanceId, queuedSteers: false }))
    .toMatchObject({ row: 'W-19', status: 'reconciled', reason: 'queued intents settled' });
  expect(await controls.readControl(fx.ctx, cancelRef)).toMatchObject({ status: 'ready', value: { status: 'outcome_unknown',
    observation: { origin: 'platform_reconcile', kind: 'outcome_unknown' } } });
  const after = await read(fx, restarted.deps);
  expect(after.run.revision, 'the Run is only the guard').toBe(unknown.run.revision);
  expect(after.session.occupancy).toMatchObject({ kind: 'execution', executionRef: { runId: fx.claim.runRef.runId } });
  expect(after.lease?.release).toBeUndefined();
  expect(fx.scripted.calls(), 'one model reply before the cancel; none during the reconcile').toBe(1);
}, 60_000);

// -------------------------------------------------------------------------- //
// K3-21 (R3): the L25 guard order at the Runtime classifier                    //
// -------------------------------------------------------------------------- //

/** One Run whose controlled tool call is in flight; returns the release to end it. */
async function inFlightRun(fx: B2RuntimeFixture, controls: Controls, toolName: string, callId: string, label = callId) {
  const entered = deferred(); const release = deferred();
  const deps = fx.rebuildDeps({ hostInstance: HOST_1, runReconcile: true });
  const runtime = createAgentRuntime({ ...deps, controls,
    kernel: withTool(deps.kernel, blockingTool(toolName, entered.resolve, release.promise)) });
  const prepared = await prepare(fx, runtime, `k3-prepare-${label}`);
  const running = runtime.port.startRun(fx.ctx, { prepared, consumerId: 'k3-consumer', requestId: `k3-start-${label}` });
  await entered.promise;
  return { running, release };
}

const K3_CAPTURE_REF = { kind: 'artifact', contentType: 'application/json', digest: 'k3-dummy', sizeBytes: 1,
  source: {} } as unknown as Extract<WorkspaceCaptureV1, { status: 'captured' }>['captureRef'];

it('K3-21 reports no_takeover_proof first when this Host has no proof', async () => {
  const fx = await makeFixture({ scriptedReplies: [
    { kind: 'calls', calls: [{ callId: 'k3-no-proof', name: 'run_readonly_command', args: {} }] }] });
  const controls = controlsOn(fx);
  const { running, release } = await inFlightRun(fx, controls, 'run_readonly_command', 'k3-no-proof');
  try {
    expect(await restartedHost(fx, HOST_2, controls).reconcile()).toMatchObject({ row: 'W-13', status: 'reconciled',
      autoCleanup: { applied: false, blockedBy: 'no_takeover_proof' } });
  } finally { release.resolve(); await running.catch(() => undefined); }
}, 60_000);

it('K3-21 reports uncontained_tool for an out-of-table tool even with the takeover proof', async () => {
  const toolName = 'k3-out-of-table';
  const fx = await makeFixture({ scriptedReplies: [
    { kind: 'calls', calls: [{ callId: 'k3-uncontained', name: toolName, args: {} }] }] });
  const controls = controlsOn(fx);
  const { running, release } = await inFlightRun(fx, controls, toolName, 'k3-uncontained');
  try {
    expect(await restartedHost(fx, HOST_2, controls, {}, { kind: 'hl03_stale_lock', previousInstanceId: 'k3-old', previousPid: 7 })
      .reconcile()).toMatchObject({ autoCleanup: { applied: false, blockedBy: 'uncontained_tool' } });
  } finally { release.resolve(); await running.catch(() => undefined); }
}, 60_000);

it('K3-21 reports closure_unsupported when the Runtime does not publish the closure check', async () => {
  const fx = await makeFixture({ scriptedReplies: [
    { kind: 'calls', calls: [{ callId: 'k3-no-closure', name: 'run_readonly_command', args: {} }] }] });
  const controls = controlsOn(fx);
  const { running, release } = await inFlightRun(fx, controls, 'run_readonly_command', 'k3-no-closure');
  try {
    expect(await restartedHost(fx, HOST_2, controls, {}, { kind: 'hl01_no_lock' }).reconcile())
      .toMatchObject({ autoCleanup: { applied: false, blockedBy: 'closure_unsupported' } });
  } finally { release.resolve(); await running.catch(() => undefined); }
}, 60_000);

it('K3-21 reports no_baseline when the capture runs but the Run has no start baseline', async () => {
  const fx = await makeFixture({ scriptedReplies: [
    { kind: 'calls', calls: [{ callId: 'k3-no-baseline', name: 'run_readonly_command', args: {} }] }] });
  const controls = controlsOn(fx);
  const { running, release } = await inFlightRun(fx, controls, 'run_readonly_command', 'k3-no-baseline');
  try {
    const capture: NonNullable<RunReconcileClassifierDependencies['captureWorkspace']> = async () =>
      ({ status: 'captured', runBaselineKnown: false, baseCommit: 'b', headNow: 'h',
        captureRef: K3_CAPTURE_REF, changedCount: 0, sample: [], notVisible: [], notVisibleOmitted: 0 });
    expect(await restartedHost(fx, HOST_2, controls, { turnClosureSupport: async () => ({ status: 'supported' }),
      captureWorkspace: capture }, { kind: 'hl01_no_lock' }).reconcile())
      .toMatchObject({ autoCleanup: { applied: false, blockedBy: 'no_baseline' } });
  } finally { release.resolve(); await running.catch(() => undefined); }
}, 60_000);

it('K3-21 reports workspace_not_git when the capture refuses a non-git workspace', async () => {
  const fx = await makeFixture({ scriptedReplies: [
    { kind: 'calls', calls: [{ callId: 'k3-not-git', name: 'run_readonly_command', args: {} }] }] });
  const controls = controlsOn(fx);
  const { running, release } = await inFlightRun(fx, controls, 'run_readonly_command', 'k3-not-git');
  try {
    const capture: NonNullable<RunReconcileClassifierDependencies['captureWorkspace']> = async () =>
      ({ status: 'unavailable', runBaselineKnown: false, reason: 'not_git', detail: 'the root is not a git work tree' });
    expect(await restartedHost(fx, HOST_2, controls, { turnClosureSupport: async () => ({ status: 'supported' }),
      captureWorkspace: capture }, { kind: 'hl01_no_lock' }).reconcile())
      .toMatchObject({ autoCleanup: { applied: false, blockedBy: 'workspace_not_git' } });
  } finally { release.resolve(); await running.catch(() => undefined); }
}, 60_000);

type K3ReadRecord = Awaited<ReturnType<typeof read>>;

/** The v2 Kernel binding of a readable Run (K3-23 reads the Turn bounds through it). */
function k3KernelBinding(record: K3ReadRecord) {
  const auth = record.run.executionAuthorization;
  const kernel = auth !== undefined && 'schemaVersion' in auth && auth.schemaVersion === 2 ? auth.kernel : null;
  if (kernel === null) throw new Error('K3: the Run must carry a v2 Kernel binding');
  return kernel;
}

/** K3-23 public read: the Turn bounds by Kernel identity; a close would move the terminal status or end position. */
async function k3TurnBounds(fx: B2RuntimeFixture, record: K3ReadRecord): Promise<KernelTurnBoundsRead> {
  const kernel = k3KernelBinding(record);
  const owner = createSessionHistoryCursorOwner({ kernelStores: fx.deps.kernelStores, kernel: fx.deps.kernel });
  return owner.readTurnBounds({ session: record.session, kernelRunId: kernel.runId, signal: fx.ctx.signal });
}

type K3QuietBefore = { calls: number; revision: number; turnBounds: KernelTurnBoundsRead };

/** K3-23: the pre-reconcile snapshot every quiet R3 case compares against. */
async function k3QuietBefore(fx: B2RuntimeFixture): Promise<K3QuietBefore> {
  const record = await read(fx);
  return { calls: fx.scripted.calls(), revision: record.run.revision, turnBounds: await k3TurnBounds(fx, record) };
}

/**
 * K3-23 (rule 2): an R3 case calls no model, closes no Kernel Turn, opens no
 * review round and writes no UnknownCallReview record; the Session and the
 * Lease stay held. Everything is read through public reads
 * (`readExecution`, `readTurnBounds`, `readReview`), never the database.
 */
async function assertK3_23Quiet(fx: B2RuntimeFixture, before: K3QuietBefore, result: { status: string }) {
  expect(result.status, 'K3-23: an R3 case never fails').not.toBe('failed');
  expect(fx.scripted.calls(), 'K3-23: no model call').toBe(before.calls);
  const after = await read(fx);
  expect(await k3TurnBounds(fx, after), 'K3-23: no Kernel close').toEqual(before.turnBounds);
  expect(await createUnknownCallReviewService({ records: fx.claimFixture.records,
    now: () => B2_AT, eventId: () => 'k3-23-review-read' }).readReview(fx.ctx, { runRef: fx.claim.runRef }),
    'K3-23: no review round and no UnknownCallReview record').toEqual({ status: 'not_found' });
  expect(after.session.occupancy, 'K3-23: the Session stays occupied by the Run').toMatchObject({ kind: 'execution',
    executionRef: { runId: fx.claim.runRef.runId } });
  expect(after.lease?.release, 'K3-23: the Lease stays held').toBeUndefined();
}

/** One declaration of the scripted batch `overflowRun` starts (the reply is built by the test). */
type K3BatchCall = { callId: string; name: string; args: Record<string, unknown> };

/**
 * One Run whose single scripted reply declares independent calls of one tool.
 * The raised `maxToolCalls` (the batch is over the Host's default 16) and
 * `independentReadOnly` make the Kernel start all of them before executing
 * them, so every call stays in flight. Defaults to the 33 calls K3-21 G11
 * needs; K3-48 passes its 32 over-budget `edit` calls.
 */
async function overflowRun(fx: B2RuntimeFixture, controls: Controls, calls?: readonly K3BatchCall[]) {
  const batch = calls ?? Array.from({ length: 33 }, (_, index) => (
    { callId: `k3-inv-${index}`, name: 'run_readonly_command', args: {} }));
  const toolName = batch[0]?.name ?? 'run_readonly_command';
  const allEntered = deferred(); const release = deferred();
  let entered = 0;
  const tool = blockingTool(toolName, () => {
    entered += 1;
    if (entered === batch.length) allEntered.resolve();
  }, release.promise, { independentReadOnly: true });
  const withRaisedToolLimit: B2RuntimeFixture['host'] = {
    resolveConfiguration: async (ctx, request) => {
      const resolved = await fx.host.resolveConfiguration(ctx, request);
      return resolved.status === 'ready'
        ? { status: 'ready', value: { ...resolved.value, budget: { ...resolved.value.budget, maxToolCalls: 64 } } }
        : resolved;
    },
  };
  const deps = fx.rebuildDeps({ hostInstance: HOST_1, runReconcile: true, host: withRaisedToolLimit });
  const runtime = createAgentRuntime({ ...deps, controls, kernel: withTool(deps.kernel, tool) });
  const prepared = await prepare(fx, runtime, 'k3-overflow-prepare');
  const running = runtime.port.startRun(fx.ctx, { prepared, consumerId: 'k3-overflow-consumer', requestId: 'k3-overflow-start' });
  await allEntered.promise;
  return { running, release };
}

/** One decoded Kernel record as the hand-written history below stores it. */
type K3KernelRecord = {
  sessionId: string; position: number; recordId: string; recordedAt: string; recordType: string;
  payload: { run?: unknown; event?: { type: string; meta: Record<string, unknown>; payload: unknown } };
};

/**
 * K3-21 G5 needs an accepted SessionMessage input in the Turn the classifier
 * reads. A Kernel store append cannot make it: the projection only accepts
 * `run.input_accepted` at a drained `before_model` boundary (agent-events
 * `validateTransition`), never after `tool.started`. So this is one of the
 * hand-written classifier dependencies (§5.1 D11): it wraps the real owner and
 * feeds the classifier a synthesized Turn made of the real records with one
 * `run.input_accepted` inserted right after `run.started`. Nothing is written
 * to the Kernel store.
 */
async function k3OwnerWithAcceptedInput(fx: B2RuntimeFixture, record: K3ReadRecord,
  real: ReturnType<typeof createSessionHistoryCursorOwner>) {
  const startPosition = record.run.executionHistory?.startPosition;
  if (startPosition === undefined) throw new Error('K3: the Run must have entered');
  const window = await real.readPositionWindow({ session: record.session, afterPosition: startPosition - 1,
    throughPosition: null, limit: 200, signal: fx.ctx.signal });
  if (window.status !== 'ready') throw new Error(`K3: the real Turn must be readable: ${JSON.stringify(window)}`);
  const decoded = window.value.entries.map((entry) => {
    const body = entry.body as { encoding: 'kernel_session_record_json'; text: string };
    return JSON.parse(body.text) as K3KernelRecord;
  });
  const turnStarted = decoded.find(item => item.recordType === 'turn.started');
  const templateEvent = decoded.find(item => item.recordType === 'agent.event');
  if (turnStarted === undefined || templateEvent === undefined) {
    throw new Error('K3: the real Turn needs a start and an event to model the hand-written history on');
  }
  const realEvents = decoded.filter(item => item.recordType === 'agent.event')
    .map(item => item.payload.event).filter((event): event is NonNullable<typeof event> => event !== undefined);
  const accepted = { type: 'run.input_accepted',
    meta: { schemaVersion: 1, eventId: 'k3-handwritten-input', runId: k3KernelBinding(record).runId,
      turnId: k3KernelBinding(record).turnId, sequence: 0, occurredAt: B2_AT, elapsedMs: 0 },
    payload: { input: { inputId: 'k3-handwritten-input', messageId: 'k3-handwritten-message',
      text: 'K3: an input the restart cannot confirm',
      sourceRef: { kind: 'SessionMessage', part: 'message', messageRef: { aggregateType: 'SessionMessage',
        projectId: fx.scope.projectId, workspaceId: fx.scope.workspaceId, messageId: 'k3-handwritten-message' } } } } };
  const startedIndex = realEvents.findIndex(event => event.type === 'run.started');
  if (startedIndex < 0) throw new Error('K3: the real Turn never started a Run');
  const ordered = [...realEvents.slice(0, startedIndex + 1), accepted, ...realEvents.slice(startedIndex + 1)];
  const events = ordered.map((event, index) => ({ ...event, meta: { ...event.meta, sequence: index + 1, elapsedMs: index * 10 } }));
  const kernelSessionId = record.session.kernel.kernelSessionId;
  const synthetic: K3KernelRecord[] = [
    { ...turnStarted, position: startPosition, recordId: `k3-handwritten-turn-${startPosition}` },
    ...events.map((event, index) => {
      const position = startPosition + 1 + index;
      return { ...templateEvent, position, recordId: `k3-handwritten-event-${position}`, payload: { event } };
    }),
  ];
  const entries: SessionHistoryEntry[] = synthetic.map(item => ({
    recordId: item.recordId, cursor: `k3-handwritten-cursor-${item.position}`, recordedAt: item.recordedAt,
    kind: item.recordType === 'turn.started' ? 'turn_started' : 'agent_event',
    source: { adapterId: record.session.kernel.adapterId, kernelSessionId, position: item.position },
    body: { encoding: 'kernel_session_record_json', text: JSON.stringify(item) },
  }));
  const last = synthetic.at(-1)!.position;
  return { ...real, readPositionWindow: async () => ({ status: 'ready' as const,
    value: { entries, throughPosition: last, nextPosition: last, hasMore: false } }) };
}

it('K3-21 inputs_unconfirmed: an accepted input the restart cannot confirm blocks auto-cleanup (G5)', async () => {
  const fx = await makeFixture({ scriptedReplies: [
    { kind: 'calls', calls: [{ callId: 'k3-unconfirmed', name: 'run_readonly_command', args: {} }] }] });
  const controls = controlsOn(fx);
  const { running, release } = await inFlightRun(fx, controls, 'run_readonly_command', 'k3-unconfirmed');
  try {
    const record = await read(fx);
    const before = await k3QuietBefore(fx);
    const restarted = restartedHost(fx, HOST_2, controls, {}, { kind: 'hl01_no_lock' });
    // The hand-written dependencies feed a Turn with an accepted SessionMessage input; this classifier copy
    // carries no mailbox reader, so `confirmMailboxInputs` cannot confirm it (G5).
    restarted.classifier.owner = await k3OwnerWithAcceptedInput(fx, record, restarted.classifier.owner);
    const result = await restarted.reconcile();
    expect(result).toMatchObject({ row: 'W-13', status: 'reconciled', reason: 'unknown',
      autoCleanup: { applied: false, blockedBy: 'inputs_unconfirmed' } });
    await assertK3_23Quiet(fx, before, result);
  } finally { release.resolve(); await running.catch(() => undefined); }
}, 60_000);

it('K3-21 workspace_unstable: an unstable capture blocks auto-cleanup (G8)', async () => {
  const fx = await makeFixture({ scriptedReplies: [
    { kind: 'calls', calls: [{ callId: 'k3-unstable', name: 'run_readonly_command', args: {} }] }] });
  const controls = controlsOn(fx);
  const { running, release } = await inFlightRun(fx, controls, 'run_readonly_command', 'k3-unstable');
  try {
    const capture: NonNullable<RunReconcileClassifierDependencies['captureWorkspace']> = async () =>
      ({ status: 'unavailable', runBaselineKnown: false, reason: 'unstable',
        detail: 'K3: the work tree changed while it was read' });
    const before = await k3QuietBefore(fx);
    const result = await restartedHost(fx, HOST_2, controls, { turnClosureSupport: async () => ({ status: 'supported' }),
      captureWorkspace: capture }, { kind: 'hl01_no_lock' }).reconcile();
    expect(result).toMatchObject({ row: 'W-13', status: 'reconciled', reason: 'unknown',
      autoCleanup: { applied: false, blockedBy: 'workspace_unstable' } });
    await assertK3_23Quiet(fx, before, result);
  } finally { release.resolve(); await running.catch(() => undefined); }
}, 60_000);

it('K3-21 workspace_too_many_changes: a capture over 2,000 changes blocks auto-cleanup (G8)', async () => {
  const fx = await makeFixture({ scriptedReplies: [
    { kind: 'calls', calls: [{ callId: 'k3-too-many', name: 'run_readonly_command', args: {} }] }] });
  const controls = controlsOn(fx);
  const { running, release } = await inFlightRun(fx, controls, 'run_readonly_command', 'k3-too-many');
  try {
    const capture: NonNullable<RunReconcileClassifierDependencies['captureWorkspace']> = async () =>
      ({ status: 'unavailable', runBaselineKnown: false, reason: 'too_many_changes',
        detail: 'K3: more than 2,000 files differ from the baseline' });
    const before = await k3QuietBefore(fx);
    const result = await restartedHost(fx, HOST_2, controls, { turnClosureSupport: async () => ({ status: 'supported' }),
      captureWorkspace: capture }, { kind: 'hl01_no_lock' }).reconcile();
    expect(result).toMatchObject({ row: 'W-13', status: 'reconciled', reason: 'unknown',
      autoCleanup: { applied: false, blockedBy: 'workspace_too_many_changes' } });
    await assertK3_23Quiet(fx, before, result);
  } finally { release.resolve(); await running.catch(() => undefined); }
}, 60_000);

it('K3-21 inventory_incomplete with 33 unresolved calls (G11)', async () => {
  const fx = await makeFixture({ scriptedReplies: [
    { kind: 'calls', calls: Array.from({ length: 33 }, (_, index) => (
      { callId: `k3-inv-${index}`, name: 'run_readonly_command', args: {} })) }] });
  const controls = controlsOn(fx);
  const { running, release } = await overflowRun(fx, controls);
  try {
    const before = await k3QuietBefore(fx);
    // G11 is pure: a Turn that fails it does no capture (and so writes no
    // capture Artifact) and makes no owner lookup.
    let captures = 0;
    let lookups = 0;
    const capture: NonNullable<RunReconcileClassifierDependencies['captureWorkspace']> = async () => {
      captures += 1;
      return { status: 'captured', runBaselineKnown: true, baseCommit: 'base', headNow: 'head',
        captureRef: { kind: 'artifact', contentType: 'application/vnd.platform.workspace-change-capture+json',
          digest: 'd'.repeat(64), sizeBytes: 1, source: { kind: 'workspace', refId: 'k3-inv', revision: '1' } },
        changedCount: 0, sample: [], notVisible: [], notVisibleOmitted: 0 };
    };
    const lookup: NonNullable<RunReconcileClassifierDependencies['lookupToolCommit']> = async () => {
      lookups += 1;
      return { status: 'not_committed' };
    };
    const result = await restartedHost(fx, HOST_2, controls,
      { turnClosureSupport: async () => ({ status: 'supported' }), captureWorkspace: capture, lookupToolCommit: lookup },
      { kind: 'hl01_no_lock' }).reconcile();
    expect(result).toMatchObject({ row: 'W-13', status: 'reconciled', reason: 'unknown',
      autoCleanup: { applied: false, blockedBy: 'inventory_incomplete' } });
    expect(captures, 'G11 fails before the capture (G8)').toBe(0);
    expect(lookups, 'G11 fails before every owner lookup').toBe(0);
    expect((await read(fx)).run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown',
      reconciliation: { status: 'quarantined', observation: { kind: 'unresolved',
        unresolvedToolCallIds: Array.from({ length: 33 }, (_, index) => `k3-inv-${index}`) } } });
    await assertK3_23Quiet(fx, before, result);
  } finally { release.resolve(); await running.catch(() => undefined); }
}, 90_000);

it('K3-21 inventory_incomplete with one undecodable 513-byte callId (G11)', async () => {
  const longCallId = 'k'.repeat(513);
  const fx = await makeFixture({ scriptedReplies: [
    { kind: 'calls', calls: [{ callId: longCallId, name: 'run_readonly_command', args: {} }] }] });
  const controls = controlsOn(fx);
  const { running, release } = await inFlightRun(fx, controls, 'run_readonly_command', longCallId, 'k3-undecodable');
  try {
    const before = await k3QuietBefore(fx);
    const result = await restartedHost(fx, HOST_2, controls, { turnClosureSupport: async () => ({ status: 'supported' }) },
      { kind: 'hl01_no_lock' }).reconcile();
    expect(result).toMatchObject({ row: 'W-13', status: 'reconciled', reason: 'unknown',
      autoCleanup: { applied: false, blockedBy: 'inventory_incomplete' } });
    await assertK3_23Quiet(fx, before, result);
  } finally { release.resolve(); await running.catch(() => undefined); }
}, 60_000);

it('K3-21 review_round wins over every other guard', async () => {
  // The public path to a review-purpose Run (TASK-03r): the original Run ends
  // without a booked result (RUN-20(i)); the operator's attestation (RUN-22)
  // creates the `pending_review` record; the review claim creates the
  // review-purpose Run. G10 checks that trusted `purpose` FIRST (D1), so this
  // restart must not require a baseline, capture or owner lookup even with 33
  // calls in flight and no takeover proof.
  const fx = await makeFixture({ scriptedReplies: [
    { kind: 'calls', calls: [{ callId: 'k3-review-origin', name: 'k3-review-process', args: { command: 'echo origin' } }] },
    { kind: 'calls', calls: Array.from({ length: 33 }, (_, index) => (
      { callId: `k3-review-${String(index)}`, name: 'run_readonly_command', args: {} })) }] });
  const controls = controlsOn(fx);
  const { running, release } = await inFlightRun(fx, controls, 'k3-review-process', 'k3-review-origin');
  const originalRunRef = fx.claim.runRef;
  const allEntered = deferred();
  const held = deferred();
  let reviewRunning: Promise<unknown> | null = null;
  try {
    // RUN-20(i): the original process call has no booked result.
    expect(await restartedHost(fx, HOST_2, controls).reconcile()).toMatchObject({ row: 'W-13', status: 'reconciled',
      autoCleanup: { applied: false, blockedBy: 'no_takeover_proof' } });
    const unknown = await read(fx);
    expect(unknown.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown',
      reconciliation: { observation: { kind: 'unresolved', reason: 'tool_calls_unresolved',
        unresolvedToolCallIds: ['k3-review-origin'] } } });

    // RUN-22 through the owner: a complete draft listing the one recorded process call.
    const reviews = createUnknownCallReviewService({ records: fx.claimFixture.records,
      now: () => B2_AT, eventId: () => 'k3-review-attest-read' });
    let attestSeq = 0;
    const reconcile = createRunReconcileService({ records: fx.claimFixture.records,
      reads: createRunStateReader({ records: fx.claimFixture.records }),
      hostInstance: { hostInstanceId: 'k3-review-attest', lease: 'owned' }, now: () => B2_AT,
      eventId: () => `k3-review-attest-${String(++attestSeq)}` });
    const attested = await reconcile.resolveUnknownRun(fx.ctx, { input: {
      runRef: originalRunRef, reason: 'K3-21 review_round', kernelTurnOpen: false, inputsConfirmed: true,
      review: { inventory: 'complete', inventoryProblem: null, itemsOmitted: 0,
        items: [{ alias: 1, callId: 'k3-review-origin', toolName: 'k3-review-process', kind: 'process', contained: false,
          kernel: { adapterId: 'k3-review-kernel', kernelSessionId: 'k3-review-session', kernelRunId: 'k3-review-run',
            turnId: 'k3-review-turn', callId: 'k3-review-origin', declaredPosition: 1, startedPosition: 2 },
          argumentsDigest: 'd'.repeat(64),
          summary: { command: 'echo origin', cwd: null, mode: null, paths: [], pathsOmitted: 0, truncated: false },
          startedAt: null, observed: { verdict: 'pending', by: null } }],
        workspace: { status: 'unavailable', runBaselineKnown: false, reason: 'not_configured', detail: 'K3-21' } },
      }, meta: { requestId: 'k3-review-attest', expected: [{ ref: originalRunRef, revision: unknown.run.revision }] } });
    expect(attested, JSON.stringify(attested)).toMatchObject({ status: 'committed',
      value: { status: 'ended', outcome: 'crashed' } });
    const reviewRead = await reviews.readReview(fx.ctx, { runRef: originalRunRef });
    if (reviewRead.status !== 'ready') throw new Error(`the record must be readable: ${JSON.stringify(reviewRead)}`);
    expect(reviewRead.value).toMatchObject({ status: 'pending_review', revision: 1 });
    const reviewRef = reviewRead.value.ref;

    // TASK-03r through the public claim port: the Run record carries the real
    // review purpose. Preparation must see it: RUN-02 (D5) refuses entry when the
    // prepared manifest has no review instruction matching the round record.
    const request = await fx.claimFixture.buildRequest({ input: { sessionRef: fx.claim.sessionRef } });
    request.input.review = { reviewRef, expectedRevision: 1, phase: 'review' };
    const claimed = await fx.claimFixture.makeService().claimTask(fx.ctx, request);
    if (claimed.status !== 'committed') throw new Error(`K3-21 review claim: ${JSON.stringify(claimed)}`);
    const reviewRunRef = claimed.value.runRef;
    expect((await readRun(fx, reviewRunRef)).run.purpose).toEqual({ kind: 'unknown_call_review', reviewRef,
      phase: 'review', round: 1 });
    // RUN-20(i) leaves the original Kernel Turn open; the review Run is given a
    // fresh Kernel Session so it can enter (the Workflow closes the original one
    // before the review claim in the real flow; this test only needs the Run
    // running with a call in flight).
    await fx.claimFixture.overwriteSession(fx.claim.sessionRef, record => ({ ...record,
      kernel: { ...record.kernel, kernelSessionId: 'k3-review-kernel-session' } }));

    // Enter the review Run with one declared batch of 33 calls, all held by the
    // stand-in.
    fx.allowRun(reviewRunRef);
    let entered = 0;
    const blocking = blockingTool('run_readonly_command', () => {
      entered += 1;
      if (entered === 33) allEntered.resolve();
    }, held.promise, { independentReadOnly: true });
    const base = fx.rebuildDeps({ hostInstance: HOST_1, runReconcile: true,
      host: { async resolveConfiguration(ctx, configRequest) {
        const resolved = await fx.host.resolveConfiguration(ctx, configRequest);
        return resolved.status === 'ready'
          ? { status: 'ready', value: { ...resolved.value,
            tools: [...new Set([...resolved.value.tools, 'run_readonly_command'])],
            readonlyCommandAccess: 'all_except_denied' as const,
            budget: { ...resolved.value.budget, maxToolCalls: 64 } } }
          : resolved;
      } } });
    const runtime = createAgentRuntime({ ...base, controls,
      unknownCallReviews: { readReview: (ctx: never, input: never) => reviews.readReview(ctx, input) } as never,
      kernel: withTool(base.kernel, blocking) });
    const prepared = await runtime.port.prepareExecution(fx.ctx, { runRef: reviewRunRef, requestId: 'k3-review-prepare' });
    if (prepared.status !== 'ready') throw new Error(`K3-21 review prepare: ${JSON.stringify(prepared)}`);
    // `startRun` resolves only when the held Turn ends, so it is not awaited here.
    reviewRunning = runtime.port.startRun(fx.ctx, { prepared: prepared.value,
      consumerId: 'k3-review-consumer', requestId: 'k3-review-start' });
    await allEntered.promise;
    expect((await readRun(fx, reviewRunRef)).run).toMatchObject({ status: 'running',
      purpose: { kind: 'unknown_call_review' } });

    // The restart: no proof, a counting capture and a counting lookup; G10 stops first.
    let captures = 0;
    let lookups = 0;
    const capture: NonNullable<RunReconcileClassifierDependencies['captureWorkspace']> = async () => {
      captures += 1;
      return { status: 'captured', runBaselineKnown: true, baseCommit: 'base', headNow: 'head',
        captureRef: { kind: 'artifact', contentType: 'application/vnd.platform.workspace-change-capture+json',
          digest: 'd'.repeat(64), sizeBytes: 1, source: { kind: 'workspace', refId: 'k3-review', revision: '1' } },
        changedCount: 0, sample: [], notVisible: [], notVisibleOmitted: 0 };
    };
    const lookup: NonNullable<RunReconcileClassifierDependencies['lookupToolCommit']> = async () => {
      lookups += 1;
      return { status: 'not_committed' };
    };
    const result = await restartedHostFor(fx, reviewRunRef, HOST_2, controls,
      { turnClosureSupport: async () => ({ status: 'supported' }), captureWorkspace: capture, lookupToolCommit: lookup },
      { kind: 'hl03_stale_lock', previousInstanceId: 'k3-review-old', previousPid: 7 }).reconcile();
    expect(result).toMatchObject({ row: 'W-13', status: 'reconciled', reason: 'unknown',
      autoCleanup: { applied: false, blockedBy: 'review_round' } });
    expect(captures, 'G10 fails before the capture (G8)').toBe(0);
    expect(lookups, 'G10 fails before every owner lookup').toBe(0);
    const reviewRun = await readRun(fx, reviewRunRef);
    expect(reviewRun.run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown',
      purpose: { kind: 'unknown_call_review' },
      reconciliation: { observation: { kind: 'unresolved', unresolvedToolCallIds: expect.arrayContaining(['k3-review-0']),
        autoCleanupBlockedBy: 'review_round' } } });
  } finally { held.resolve(); release.resolve(); await running.catch(() => undefined); await reviewRunning?.catch(() => undefined); }
}, 120_000);

it('K3-21 several guards fail at once reports the first in L25 order (G1 before G11 and G8)', async () => {
  const fx = await makeFixture({ scriptedReplies: [
    { kind: 'calls', calls: Array.from({ length: 33 }, (_, index) => (
      { callId: `k3-inv-${index}`, name: 'run_readonly_command', args: {} })) }] });
  const controls = controlsOn(fx);
  const { running, release } = await overflowRun(fx, controls);
  try {
    let captured = false;
    const capture: NonNullable<RunReconcileClassifierDependencies['captureWorkspace']> = async () => {
      captured = true;
      return { status: 'unavailable', runBaselineKnown: false, reason: 'not_git', detail: 'K3: not a git workspace' };
    };
    const before = await k3QuietBefore(fx);
    // No takeover proof (G1) AND a 33-call inventory (G11) AND a non-git workspace (G8).
    const result = await restartedHost(fx, HOST_2, controls, { captureWorkspace: capture }).reconcile();
    expect(result).toMatchObject({ row: 'W-13', status: 'reconciled', reason: 'unknown',
      autoCleanup: { applied: false, blockedBy: 'no_takeover_proof' } });
    expect(captured, 'G8 is never read once G1 fails').toBe(false);
    await assertK3_23Quiet(fx, before, result);
  } finally { release.resolve(); await running.catch(() => undefined); }
}, 90_000);

// -------------------------------------------------------------------------- //
// K3-22 (R3): the probe and Kernel-close rows of the L25 order table            //
// -------------------------------------------------------------------------- //

it('K3-22 probe missing: the mapped Kernel database is gone, so the restart reports RUN-20(ii) and opens no review', async () => {
  const fx = await makeFixture({ scriptedReplies: [
    { kind: 'calls', calls: [{ callId: 'k3-probe-missing', name: 'run_readonly_command', args: {} }] }] });
  const controls = controlsOn(fx);
  const { running, release } = await inFlightRun(fx, controls, 'run_readonly_command', 'k3-probe-missing');
  try {
    const before = await k3QuietBefore(fx);
    const result = await restartedHost(fx, HOST_2, controls, {}, undefined,
      { verdict: 'missing', activeRunId: null, reason: 'the mapped Kernel database file is missing' }).reconcile();
    // The classifier's RUN-20(ii) row for a Running Run is W-14 (W-06 only for Entering); W-13 is RUN-20(i),
    // and `submit` reports `reason` as the unknown-result kind (`kernel_unreadable` rides in the observation).
    expect(result).toMatchObject({ row: 'W-14', status: 'reconciled', reason: 'unknown' });
    await assertK3_23Quiet(fx, before, result);
  } finally { release.resolve(); await running.catch(() => undefined); }
}, 60_000);

it('K3-22 probe host_config: an unregistered Kernel proves nothing, so the restart is left at W-07', async () => {
  const fx = await makeFixture({ scriptedReplies: [
    { kind: 'calls', calls: [{ callId: 'k3-probe-host-config', name: 'run_readonly_command', args: {} }] }] });
  const controls = controlsOn(fx);
  const { running, release } = await inFlightRun(fx, controls, 'run_readonly_command', 'k3-probe-host-config');
  try {
    const before = await k3QuietBefore(fx);
    const result = await restartedHost(fx, HOST_2, controls, {}, undefined,
      { verdict: 'host_config', activeRunId: null, reason: 'the mapped Kernel adapter is not registered by this Host' }).reconcile();
    expect(result).toMatchObject({ row: 'W-07', status: 'left' });
    expect((await read(fx)).run.revision, 'a `left` case writes nothing').toBe(before.revision);
    await assertK3_23Quiet(fx, before, result);
  } finally { release.resolve(); await running.catch(() => undefined); }
}, 60_000);

it('K3-22 a Kernel terminal with a call without a result is RUN-20(i), never RUN-25', async () => {
  const fx = await makeFixture({ scriptedReplies: [
    { kind: 'calls', calls: [{ callId: 'k3-terminal-call', name: 'run_readonly_command', args: {} }] }] });
  const controls = controlsOn(fx);
  const deps = fx.rebuildDeps({ hostInstance: HOST_1, runReconcile: true });
  // The live Runtime's unknown-end commit is lost with the process (its cancel drain still ends the Kernel Turn).
  const lost: ExecutionEntryPort = { ...deps.entry,
    recordRunResult: async () => ({ status: 'rejected', code: 'unavailable', reason: 'K3-22: the live unknown-end commit was lost' }) };
  const entered = deferred(); const release = deferred();
  const runtime = createAgentRuntime({ ...deps, controls, entry: lost,
    kernel: withTool(deps.kernel, blockingTool('run_readonly_command', entered.resolve, release.promise)) });
  const prepared = await prepare(fx, runtime, 'k3-terminal-prepare');
  const running = runtime.port.startRun(fx.ctx, { prepared, consumerId: 'k3-terminal-consumer', requestId: 'k3-terminal-start' });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await entered.promise;
    const cancelRef = await submit(fx, controls, 'cancel', 'end the Turn at the Kernel', 'k3-terminal-cancel');
    expect(await runtime.port.deliverControl!(fx.ctx, { intentRef: cancelRef })).toMatchObject({ status: 'ready' });
    const finished = await Promise.race([running.then(() => true),
      new Promise<false>((resolve) => { deadline = setTimeout(() => resolve(false), 8_000); })]);
    expect(finished, 'the Kernel cancel drain ends the Turn').toBe(true);
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
    release.resolve();
    await running.catch(() => undefined);
  }
  expect((await read(fx)).run, 'the lost commit leaves the platform Run unfinished')
    .toMatchObject({ status: 'running' });
  const before = await k3QuietBefore(fx);
  const result = await restartedHost(fx, HOST_2, controls).reconcile();
  expect(result).toMatchObject({ row: 'W-13', status: 'reconciled', reason: 'unknown' });
  expect(result.autoCleanup, 'a terminal with unresolved calls is never RUN-25').toBeUndefined();
  expect((await read(fx)).run).toMatchObject({ status: 'ended', outcome: 'outcome_unknown',
    reconciliation: { status: 'quarantined', observation: { kind: 'unresolved',
      reason: 'tool_calls_unresolved', unresolvedToolCallIds: ['k3-terminal-call'] } } });
  await assertK3_23Quiet(fx, before, result);
}, 60_000);

it('K3-22 a Kernel close without a platform end is left and writes nothing', async () => {
  const fx = await makeFixture({ scriptedReplies: [
    { kind: 'calls', calls: [{ callId: 'k3-closed-call', name: 'run_readonly_command', args: {} }] }] });
  const controls = controlsOn(fx);
  const { running, release } = await inFlightRun(fx, controls, 'run_readonly_command', 'k3-closed-call');
  try {
    // The Kernel's public closeOpenTurn, through the store the harness exposes, while the platform Run is unfinished.
    const record = await read(fx);
    const kernel = k3KernelBinding(record);
    const closed = await fx.deps.kernelStores.withStore(record.session.kernel.adapterId, async (store) => {
      const header = await store.get(record.session.kernel.kernelSessionId, { signal: fx.ctx.signal });
      return fx.deps.kernel.closeOpenTurn(store, { sessionId: record.session.kernel.kernelSessionId,
        kernelRunId: kernel.runId, expectedRevision: header.revision, at: B2_AT });
    });
    expect(closed).toMatchObject({ status: 'closed' });
    const before = await k3QuietBefore(fx);
    const result = await restartedHost(fx, HOST_2, controls).reconcile();
    expect(result).toMatchObject({ row: 'K', status: 'left',
      reason: expect.stringMatching(/^kernel_closed_without_platform_end/) });
    expect((await read(fx)).run.revision, 'the platform Run is left as it is').toBe(before.revision);
    await assertK3_23Quiet(fx, before, result);
  } finally { release.resolve(); await running.catch(() => undefined); }
}, 60_000);

// -------------------------------------------------------------------------- //
// K3-21 (R3): the WorkGraph-side guards (G4/G7/G9) on a full candidate          //
// -------------------------------------------------------------------------- //

/** A full classifier candidate: supported closure and a captured baseline-known workspace. */
function k3AutoCleanupOverrides(): ClassifierOverrides {
  return {
    turnClosureSupport: async () => ({ status: 'supported' }),
    captureWorkspace: async () => ({ status: 'captured', runBaselineKnown: true, baseCommit: 'b', headNow: 'h',
      captureRef: K3_CAPTURE_REF, changedCount: 0, sample: [], notVisible: [], notVisibleOmitted: 0 }),
  };
}

/** One Run with a `run_readonly_command` call in flight, one queued control, and a full RUN-25 candidate. */
async function k3StopPending(kind: 'pause' | 'cancel' | 'steer', label: string) {
  const callId = `k3-stop-${label}`;
  const fx = await makeFixture({ scriptedReplies: [
    { kind: 'calls', calls: [{ callId, name: 'run_readonly_command', args: {} }] }] });
  const controls = controlsOn(fx);
  const { running, release } = await inFlightRun(fx, controls, 'run_readonly_command', callId);
  const intentRef = await submit(fx, controls, kind, `K3-21: a queued ${kind} before the restart`, `${callId}-intent`);
  const proof: HostTakeoverProofV1 = { kind: 'hl01_no_lock' };
  const result = await restartedHost(fx, { ...HOST_2, takeover: proof }, controls,
    k3AutoCleanupOverrides(), proof).reconcile();
  return { fx, controls, intentRef, running, release, result };
}

it('K3-21 a queued pause blocks the auto-cleanup with stop_pending (G4)', async () => {
  const { running, release, result } = await k3StopPending('pause', 'pause');
  try {
    expect(result).toMatchObject({ row: 'W-13', status: 'reconciled',
      autoCleanup: { applied: false, blockedBy: 'stop_pending' } });
  } finally { release.resolve(); await running.catch(() => undefined); }
}, 60_000);

it('K3-21 a queued cancel blocks the auto-cleanup with stop_pending (G4)', async () => {
  const { running, release, result } = await k3StopPending('cancel', 'cancel');
  try {
    expect(result).toMatchObject({ row: 'W-13', status: 'reconciled',
      autoCleanup: { applied: false, blockedBy: 'stop_pending' } });
  } finally { release.resolve(); await running.catch(() => undefined); }
}, 60_000);

// K3-21 (R3) row listed a queued steer under `stop_pending`, but a steer never
// moves the Run's control pointer (run-machine.ts: a standalone `steered`
// pointer has no writer), so G4's `steered` cannot occur. L25's "what it writes"
// settles a queued steer in the RUN-25 commit (CTL-08(b)/(c)); the accepted
// group-1 K3-30 test asserts RUN-25 for `ctxAuto({ queuedSteers: [steer] })`.
it('K3-21 a queued steer does not block the auto-cleanup: RUN-25 settles it (G4, CTL-08(b)/(c))', async () => {
  const { fx, controls, intentRef, running, release, result } = await k3StopPending('steer', 'steer');
  try {
    expect(result).toMatchObject({ row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
      autoCleanup: { applied: true } });
    expect((await read(fx)).run).toMatchObject({ status: 'ended', outcome: 'crashed',
      reconciliation: { status: 'done', observation: { kind: 'takeover_unresolved' } } });
    // This fixture has no mailbox input channel, so the Kernel never accepted the
    // steer: CTL-08(c) settles it `superseded` on the platform's end conclusion.
    expect(await controls.readControl(fx.ctx, intentRef)).toMatchObject({ status: 'ready', value: {
      status: 'superseded',
      observation: { origin: 'platform_reconcile', kind: 'terminal_without_cancel',
        detail: { hostInstanceId: HOST_2.hostInstanceId, runOutcome: 'crashed' } } } });
  } finally { release.resolve(); await running.catch(() => undefined); }
}, 60_000);

it('K3-21 a full candidate with no WorkGraph block closes the Run with RUN-25 (W-26)', async () => {
  const callId = 'k3-run25-happy';
  const fx = await makeFixture({ scriptedReplies: [
    { kind: 'calls', calls: [{ callId, name: 'run_readonly_command', args: {} }] }] });
  const controls = controlsOn(fx);
  const { running, release } = await inFlightRun(fx, controls, 'run_readonly_command', callId);
  try {
    const proof: HostTakeoverProofV1 = { kind: 'hl01_no_lock' };
    const result = await restartedHost(fx, { ...HOST_2, takeover: proof }, controls,
      k3AutoCleanupOverrides(), proof).reconcile();
    expect(result).toMatchObject({ row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
      autoCleanup: { applied: true } });
    expect((await read(fx)).run).toMatchObject({ status: 'ended', outcome: 'crashed',
      reconciliation: { status: 'done', observation: { kind: 'takeover_unresolved' } } });
  } finally { release.resolve(); await running.catch(() => undefined); }
}, 60_000);

/**
 * K3-48 (一) through the classifier path: one unresolved `run_readonly_command`
 * call padded to a 512-byte command and a long `cwd` path. The draft reader
 * bounds `command` at 512 bytes but copies `cwd` verbatim (unknown-call-draft.ts
 * `summaryOf`), so 32 such calls serialise well over the creation budget
 * B = 158,720 bytes. The `edit` builtin cannot carry 8×512-byte paths here: it
 * is a frozen Kernel builtin and registering a second `edit` tool throws
 * (`tool-registry.js` "工具 edit 重复注册").
 */
const K3_OVER_BUDGET_CWD = '/workspace/' + 'p'.repeat(8_000);
function k3OverBudgetReadOnlyCall(index: number): K3BatchCall {
  return { callId: `k3-48-large-${String(index).padStart(2, '0')}`, name: 'run_readonly_command',
    args: { command: 'echo ' + String(index) + ' ' + 'x'.repeat(512 - 8), cwd: K3_OVER_BUDGET_CWD } };
}

it('K3-48 (一) through the classifier: an over-budget creation still goes RUN-25 (W-26), not RUN-20(i) (G11)', async () => {
  const calls = Array.from({ length: 32 }, (_, index) => k3OverBudgetReadOnlyCall(index));
  const fx = await makeFixture({ scriptedReplies: [{ kind: 'calls', calls }] });
  const controls = controlsOn(fx);
  const { running, release } = await overflowRun(fx, controls, calls);
  try {
    const proof: HostTakeoverProofV1 = { kind: 'hl01_no_lock' };
    const result = await restartedHost(fx, { ...HOST_2, takeover: proof }, controls,
      k3AutoCleanupOverrides(), proof).reconcile();
    // The classifier reads a complete draft (the creation budget is the WorkGraph
    // constructor's, L7/M3), so G11 admits it and RUN-25 runs; `too_large` is not a
    // `blockedBy` and never becomes RUN-20(i).
    expect(result).toMatchObject({ row: 'W-26', status: 'reconciled', reason: 'takeover_unresolved',
      autoCleanup: { applied: true } });
    expect(result.autoCleanup).not.toMatchObject({ blockedBy: 'inventory_incomplete' });
    // The RUN-25 commit built the record through the budget: the over-budget complete
    // draft is truncated to `incomplete`/`too_large` (K3-48 (一)'s owner half). The
    // creation truncation itself is the owner test's assertion; here it only proves
    // the classifier admitted an over-budget creation.
    const review = await createUnknownCallReviewService({ records: fx.claimFixture.records,
      now: () => B2_AT, eventId: () => 'k3-review-budget-read' })
      .readReview(fx.ctx, { runRef: fx.claim.runRef });
    expect(review).toMatchObject({ status: 'ready', value: { inventory: 'incomplete', inventoryProblem: 'too_large' } });
  } finally { release.resolve(); await running.catch(() => undefined); }
}, 90_000);
