/**
 * Slice 2B row 2B-41 (entry BE3, L6/decision 54): a paused-then-restarted Run A
 * (RUN-24) carried no tally while counting was off; after A's Kernel Turn is
 * closed by `run.interrupted` (K part A) and Run B runs later in the SAME
 * Session (counting on, 5 tools), the next automatic backfill must bound A's
 * window by `readTurnBounds`'s end for A — not the Session tail. The injected
 * page cap is 1 page (200 records): A's Turn is under 200 records while A + B
 * exceed 200, so a wrong tail bound would answer `capacity`. B's tally is
 * unchanged.
 *
 * Fixture (built only through public calls; the counting-off double is a
 * test-only `vi.mock` per §7/F34):
 * - one real Runtime over `createS2BRuntimeStoreFixture` (memory) drives Run A
 *   with a read-only *parallel* controlled tool (a test latency seam, same
 *   shape as `blockingTool`, `independentReadOnly: true` so the whole group
 *   starts before the pause lands); a real pause intent is delivered through the
 *   real `RunControlPort`;
 * - `restartedHost` reconciles RUN-24 while `countingOff.off` makes the end
 *   carry no `activity` and the tally reader answer `retry_later`;
 * - K part A's public `closeOpenTurn` closes A's Turn with `run.interrupted`;
 *   the real Session health owner clears `kernel_turn_open`; Run B is claimed
 *   into the same Session and runs 5 real `read` tools through the real Runtime;
 * - the automatic backfill is `createActivityBackfill` with `maxPages: 1` over
 *   the real Runtime `countRunActivity`.
 *
 * Assertions go through `readRunActivities` (L10). No real model, no network.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { RuntimeExecutionDependencies, RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type { HostInstanceFacts } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import { createSessionHistoryCursorOwner } from '../../src/core/agent-runtime/session-operations.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createRunActivityService } from '../../src/core/work-graph/tasks/run-activity-service.js';
import { createSessionHealthService } from '../../src/core/work-graph/sessions/session-health.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { SESSION_LIFECYCLE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/lifecycle-record-codecs.js';
import { createActivityBackfill } from '../../src/business/workflow/activity-backfill.js';
import { B2_AT, createRuntimeHostDouble } from '../helpers/B2-runtime-fixture.js';
import { createS2BRuntimeStoreFixture, type S2BRuntimeStoreFixture } from '../helpers/S2B-runtime-store-fixture.js';
import { restartedHost } from '../helpers/S2B-runtime-tools-support.js';
import { S2B_SLOW_TIMEOUT_MS } from '../helpers/S2B-be1-platform-fixture.js';
import {
  closeOpenTurn, toolSchema as z, type ToolCall, type ToolDefinition, type ToolResult,
} from '../../vendor/coding-agent/dist/public-api.js';

/**
 * §7 counting-off double: while `off`, the end commits carry no `activity` and
 * the window reader answers `retry_later`. Production code is never changed.
 */
const countingOff = vi.hoisted(() => ({ off: false }));
vi.mock('../../src/core/agent-runtime/run-activity-tally.js', async (importOriginal) => {
  const { countingOffTallyModule } = await import('../helpers/S2B-counting-off-support.js');
  return countingOffTallyModule(await importOriginal<Record<string, unknown>>(), countingOff);
});
vi.mock('../../src/core/agent-runtime/run-activity-reader.js', async (importOriginal) => {
  const { countingOffReaderModule } = await import('../helpers/S2B-counting-off-support.js');
  return countingOffReaderModule(await importOriginal<Record<string, unknown>>(), countingOff);
});

const fixtures: S2BRuntimeStoreFixture[] = [];
afterEach(async () => {
  countingOff.off = false;
  for (const fixture of fixtures.splice(0)) await fixture.close();
});

const HOST_1: HostInstanceFacts = { hostInstanceId: 's2b-41-host-1', lease: 'owned' };
const HOST_2: HostInstanceFacts = { hostInstanceId: 's2b-41-host-2', lease: 'owned' };
const EPOCH_AT = B2_AT;
const A_END_AT = '2026-09-26T01:00:00.000Z';
const A_CLOSE_AT = '2026-09-26T01:30:00.000Z';
const BACKFILL_AT = '2026-09-27T00:00:00.000Z';
/** A's tool calls: 2N + 5 records, under one 200-record page; A + B exceed it. */
const A_CALLS = 96;
const B_CALLS = 5;

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function success(callId: string): ToolResult {
  return { schemaVersion: 1, callId, status: 'success', output: [{ kind: 'text', text: 's2b-41 ok' }],
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] } };
}

/** A read-only, parallel, controlled latency tool: the whole group starts, then
 * waits for the pause to be delivered before it settles. */
function parallelBlockingTool(name: string, entered: () => void, release: Promise<void>): ToolDefinition {
  return {
    name, description: 'S2B 2B-41 parallel controlled tool', inputSchema: z.object({}).loose(),
    effectClass: 'read_only', requiredCapabilities: ['workspace_read'], defaultTimeoutMs: 600_000,
    outputLimitBytes: 1_024, independentReadOnly: true,
    summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
    handler: { execute: async (call: Readonly<ToolCall>): Promise<ToolResult> => {
      entered();
      await release;
      return success(call.callId);
    } },
  };
}

function withTool(kernel: RuntimeExecutionDependencies['kernel'], tool: ToolDefinition): RuntimeExecutionDependencies['kernel'] {
  return {
    ...kernel,
    runCodingAgent: (options) => kernel.runCodingAgent({ ...options,
      config: { ...options.config, tools: { ...options.config.tools, enabledNames: [...options.config.tools.enabledNames, tool.name] } },
      additionalTools: (workspace) => [...(options.additionalTools?.(workspace) ?? []), tool] }),
  };
}

function controlsOn(fx: S2BRuntimeStoreFixture) {
  let seq = 0;
  return createRunControlService({
    records: fx.claimFixture.records,
    authority: createMaterialRecordReaders(fx.claimFixture.records).authority,
    reads: createRunStateReader({ records: fx.claimFixture.records }),
    now: () => B2_AT,
    eventId: () => `s2b-41-control-event-${++seq}`,
  });
}

it('2B-41 (BE3): the automatic backfill bounds A by its own closed Turn, excludes B, and is not capacity', async () => {
  const toolName = 's2b-41-parallel-tool';
  const entered = deferred();
  const release = deferred();
  // A real Host double, wrapped so the Run's tool budget fits A_CALLS calls.
  const allowedRuns = new Set<string>();
  let boundHost: RuntimeHostBindings | undefined;
  const hostProxy: RuntimeHostBindings = {
    async resolveConfiguration(ctx, request) {
      if (boundHost === undefined) throw new Error('the S2B 2B-41 Host double is not bound yet');
      const result = await boundHost.resolveConfiguration(ctx, request);
      if (result.status !== 'ready') return result;
      return { status: 'ready', value: { ...result.value,
        budget: { ...result.value.budget, maxToolCalls: 200, maxRequests: 120 } } };
    },
  };
  const aReplies = Array.from({ length: A_CALLS }, (_, index) =>
    ({ callId: `s2b-41-a-${String(index)}`, name: toolName, args: {} }));
  const bReplies = Array.from({ length: B_CALLS }, (_, index) =>
    ({ callId: `s2b-41-b-${String(index)}`, name: 'read', args: { path: 'b2-read.txt' } }));
  const fx = await createS2BRuntimeStoreFixture({
    host: hostProxy,
    additionalSchemas: {
      records: [...CONTROL_RECORD_SCHEMAS.records, ...SESSION_LIFECYCLE_RECORD_SCHEMAS.records],
      events: [...CONTROL_RECORD_SCHEMAS.events, ...SESSION_LIFECYCLE_RECORD_SCHEMAS.events],
      lookups: [...(CONTROL_RECORD_SCHEMAS.lookups ?? []), ...(SESSION_LIFECYCLE_RECORD_SCHEMAS.lookups ?? [])],
    },
    scriptedReplies: [
      { kind: 'calls', calls: aReplies },
      { kind: 'calls', calls: bReplies },
      { kind: 'text', text: 'S2B 2B-41 Run B done' },
    ],
  });
  fixtures.push(fx);
  allowedRuns.add(canonicalJson(fx.claim.runRef as unknown as JsonValue));
  const firstCard = await fx.claimFixture.sessionsPort.readSession(fx.ctx, fx.claim.sessionRef);
  if (firstCard.status !== 'ready') throw new Error('the S2B 2B-41 Session is not readable');
  boundHost = createRuntimeHostDouble({ runRefs: allowedRuns, scripted: fx.scripted, root: fx.directory,
    skillRoot: join(fx.directory, 'skills'), scope: fx.scope, role: firstCard.value.record.role });

  // The recording epoch exists before A ends (so the backfill is a late record).
  let epochSeq = 0;
  const epochService = createRunActivityService({ records: fx.records, now: () => EPOCH_AT,
    eventId: () => `s2b-41-epoch-event-${++epochSeq}` });
  const epoch = await epochService.ensureActivityRecording(fx.ctx, {
    input: { workspace: fx.scope }, meta: { requestId: 's2b-41-epoch', expected: [] },
  });
  expect(epoch.status).toBe('committed');

  // Run A: a real Turn whose whole parallel tool group starts, then pauses.
  const controls = controlsOn(fx);
  const deps = fx.rebuildDeps({ hostInstance: HOST_1, runReconcile: true });
  const crashed = createAgentRuntime({ ...deps, controls,
    kernel: withTool(deps.kernel, parallelBlockingTool(toolName, entered.resolve, release.promise)) });
  const prepared = await crashed.port.prepareExecution(fx.ctx, { runRef: fx.claim.runRef, requestId: 's2b-41-a-prepare' });
  expect(prepared.status).toBe('ready');
  if (prepared.status !== 'ready') return;
  const running = crashed.port.startRun(fx.ctx, { prepared: prepared.value, consumerId: 's2b-41-a-driver', requestId: 's2b-41-a-start' });
  try {
    await entered.promise;
    const aRead = await deps.executions.readExecution(fx.ctx, fx.claim.runRef);
    if (aRead.status !== 'ready') throw new Error('Run A is not readable');
    const submitted = await controls.submitControl(fx.ctx, {
      input: { runRef: fx.claim.runRef, kind: 'pause', reason: 'S2B 2B-41 pause before the restart' },
      meta: { requestId: 's2b-41-a-pause', expected: [{ ref: fx.claim.runRef, revision: aRead.value.run.revision }] },
    });
    expect(submitted.status).toBe('committed');
    if (submitted.status !== 'committed') return;
    const delivered = await crashed.port.deliverControl!(fx.ctx, { intentRef: submitted.value.intent.ref });
    expect(delivered).toMatchObject({ status: 'ready' });
    release.resolve();
    await running;

    // Restart while A is paused: RUN-24, with counting off so no tally is booked.
    fx.setNow(A_END_AT);
    countingOff.off = true;
    const second = restartedHost(fx, HOST_2, controls);
    const reconciled = await second.reconcile();
    expect(reconciled).toMatchObject({ row: 'W-20', status: 'reconciled' });
    countingOff.off = false;
    const missed = await fx.activity.readRunActivities(fx.ctx, { runRefs: [fx.claim.runRef] });
    expect(missed.status).toBe('ready');
    if (missed.status !== 'ready') return;
    expect(missed.value[0]).toMatchObject({ status: 'unknown', reason: 'not_recorded', error: true, recordedBy: null });

    // K part A closes A's dangling Kernel Turn; the health owner clears it.
    const closedRun = await second.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
    if (closedRun.status !== 'ready') throw new Error('Run A is not readable after RUN-24');
    const locator = closedRun.value.run.executionHistory;
    if (locator === undefined) throw new Error('Run A must keep its position record');
    const closed = await fx.deps.kernelStores.withStore(locator.kernel.adapterId, async (store) => {
      const header = await store.get(locator.kernel.kernelSessionId, { signal: fx.ctx.signal });
      return closeOpenTurn(store, { sessionId: locator.kernel.kernelSessionId, kernelRunId: locator.kernel.runId,
        expectedRevision: header.revision, at: A_CLOSE_AT });
    });
    expect(closed).toMatchObject({ status: 'closed' });
    const owner = createSessionHistoryCursorOwner({ kernelStores: fx.deps.kernelStores });
    const sessionRead = await fx.claimFixture.sessionsPort.readSession(fx.ctx, fx.claim.sessionRef);
    if (sessionRead.status !== 'ready') throw new Error('the S2B 2B-41 Session is not readable');
    const probe = await owner.probe({ session: sessionRead.value.record, signal: fx.ctx.signal });
    const healthService = createSessionHealthService({ records: fx.records, hostInstance: HOST_2,
      now: () => A_CLOSE_AT, eventId: () => 's2b-41-health-event' });
    const health = await healthService.recordSessionHealth(fx.ctx, { sessionRef: fx.claim.sessionRef,
      probe: { verdict: 'ready', activeRunId: probe.activeRunId } });
    expect(health).toMatchObject({ status: 'observed' });

    // Run B runs afterwards in the SAME Session (counting on) and calls 5 reads.
    const bRequest = await fx.claimFixture.buildRequest({ input: {
      taskId: fx.claimFixture.tasks.second.taskId, sessionRef: fx.claim.sessionRef } });
    const bClaimed = await fx.claimFixture.service.claimTask(fx.ctx, bRequest);
    expect(bClaimed.status).toBe('committed');
    if (bClaimed.status !== 'committed') return;
    const bRunRef = bClaimed.value.runRef;
    allowedRuns.add(canonicalJson(bRunRef as unknown as JsonValue));
    const bPrepared = await fx.runtime.port.prepareExecution(fx.ctx, { runRef: bRunRef, requestId: 's2b-41-b-prepare' });
    expect(bPrepared.status).toBe('ready');
    if (bPrepared.status !== 'ready') return;
    const bStarted = await fx.runtime.port.startRun(fx.ctx, { prepared: bPrepared.value,
      consumerId: 's2b-41-b-driver', requestId: 's2b-41-b-start' });
    expect(bStarted).toMatchObject({ status: 'ready', value: { run: { status: 'ended', outcome: 'completed' } } });
    const bBefore = await fx.activity.readRunActivities(fx.ctx, { runRefs: [bRunRef] });
    expect(bBefore.status).toBe('ready');
    if (bBefore.status !== 'ready') return;
    expect(bBefore.value[0]).toMatchObject({ status: 'counted', recordedBy: 'run_end',
      totals: { steps: B_CALLS, edits: 0, editsUnknown: 0 }, countedThroughTurnEnd: true, unresolvedCalls: 0 });
    const bRecordedAt = bBefore.value[0]!.recordedAt;

    // The next automatic backfill, with the Kernel window page cap injected to 1.
    let backfillSeq = 0;
    const backfillActivity = createRunActivityService({ records: fx.records, now: () => BACKFILL_AT,
      eventId: () => `s2b-41-backfill-event-${++backfillSeq}` });
    const backfill = createActivityBackfill({
      runtime: { countRunActivity: (ctx, input) => fx.runtime.port.countRunActivity!(ctx, input) },
      activity: backfillActivity, now: () => BACKFILL_AT, maxPages: 1,
    });
    const batch = await backfill.backfillRecentActivity(fx.ctx, { workspace: fx.scope, cursor: null });
    expect(batch.status).toBe('ready');
    if (batch.status !== 'ready') return;
    expect(batch.value.processed).toEqual([
      { runRef: fx.claim.runRef, outcome: 'counted', reason: null },
    ]);

    const aFinal = await fx.activity.readRunActivities(fx.ctx, { runRefs: [fx.claim.runRef] });
    expect(aFinal.status).toBe('ready');
    if (aFinal.status !== 'ready') return;
    expect(aFinal.value[0]).toMatchObject({
      runRef: fx.claim.runRef, status: 'counted', reason: 'recorded_late', error: true, recordedBy: 'backfill',
      totals: { steps: A_CALLS, edits: 0, editsUnknown: 0 },
      countedThroughTurnEnd: true, unresolvedCalls: 0,
    });
    const bAfter = await fx.activity.readRunActivities(fx.ctx, { runRefs: [bRunRef] });
    expect(bAfter.status).toBe('ready');
    if (bAfter.status !== 'ready') return;
    expect(bAfter.value[0]).toMatchObject({ status: 'counted', recordedBy: 'run_end',
      totals: { steps: B_CALLS, edits: 0, editsUnknown: 0 }, recordedAt: bRecordedAt });
  } finally {
    release.resolve();
    await running.catch(() => undefined);
  }
}, S2B_SLOW_TIMEOUT_MS);
