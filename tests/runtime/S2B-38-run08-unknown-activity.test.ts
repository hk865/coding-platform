/**
 * Slice 2B row 2B-38 (entry BE1r, L5/L6; RUN-08) — a tool that ignores
 * cancellation is ended `outcome_unknown` by the real Kernel drain timeout, and
 * the end-of-Run tally is counted.
 *
 * Fixture (built only through public calls; follows BE1r and
 * `tests/runtime/R4-control-runtime.test.ts:239`):
 * - `createS2BRuntimeStoreFixture` composes the REAL Runtime + frozen Kernel +
 *   real WorkGraph stores and a scripted model; `CONTROL_RECORD_SCHEMAS` are
 *   registered so the real `RunControlService` can submit/deliver the cancel.
 * - `controlledTool` (copied unchanged in `S2B-runtime-tools-support.ts`) is the
 *   tool that deliberately ignores the cancellation signal; only the Kernel's
 *   own drain timeout may end the call.
 * - (b) isolates the row's ending observation on an observer Runtime whose
 *   Kernel-read seam cancels the caller's signal during the whole-Turn re-read;
 *   the driver Runtime refuses the end so the Run stays open (fixture plumbing).
 * - (c) uses the same Kernel-read seam to fail the re-read once and refuses the
 *   unknown-end `recordRunResult` once.
 *
 * The read is asserted through `readRunActivities` (L10), never the database.
 * The one tool call counts as one step and is not an `edit`/`shell` edit.
 */
import { afterEach, expect, it } from 'vitest';
import type { VersionPin } from '../../src/contracts/core/identity.js';
import type { ControlIntentRef } from '../../src/contracts/control-intent.js';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import type { RuntimeExecutionDependencies } from '../../src/core/agent-runtime/execution-contracts.js';
import type { ExecutionEntryPort } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import type { ToolCall, ToolDefinition, ToolResult } from '../../vendor/coding-agent/dist/public-api.js';
import { B2_AT } from '../helpers/B2-runtime-fixture.js';
import { createS2BRuntimeStoreFixture, type S2BRuntimeStoreFixture } from '../helpers/S2B-runtime-store-fixture.js';
import { controlledTool } from '../helpers/S2B-runtime-tools-support.js';
import { withBe1rKernelReadFaults } from '../helpers/S2B-be1r-kernel-faults-support.js';

const fixtures: S2BRuntimeStoreFixture[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function successResult(callId: string, text = 'controlled tool completed'): ToolResult {
  return { schemaVersion: 1, callId, status: 'success', output: [{ kind: 'text', text }],
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] } };
}

/** Install one controlled Kernel tool through the real public seam (as R4). */
function withControlledTool(fx: S2BRuntimeStoreFixture, tool: ToolDefinition): RuntimeExecutionDependencies['kernel'] {
  return {
    ...fx.deps.kernel,
    runCodingAgent: (options) => {
      const config = options.config;
      return fx.deps.kernel.runCodingAgent({ ...options,
        config: { ...config, tools: { ...config.tools, enabledNames: [...config.tools.enabledNames, tool.name] } },
        additionalTools: (workspace) => [...(options.additionalTools?.(workspace) ?? []), tool] });
    },
  };
}

function controlsOn(fx: S2BRuntimeStoreFixture) {
  let seq = 0;
  return createRunControlService({
    records: fx.claimFixture.records,
    authority: createMaterialRecordReaders(fx.claimFixture.records).authority,
    reads: createRunStateReader({ records: fx.claimFixture.records }),
    now: () => B2_AT,
    eventId: () => `s2b-38-control-event-${++seq}`,
  });
}

async function currentPin(fx: S2BRuntimeStoreFixture): Promise<VersionPin> {
  const read = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  if (read.status !== 'ready') throw Error(`fixture Run pin unavailable: ${JSON.stringify(read)}`);
  return { ref: fx.claim.runRef, revision: read.value.run.revision };
}

/** Submit a cancel for the live Run and deliver it to the given Runtime. */
async function cancelAndDeliver(fx: S2BRuntimeStoreFixture, controls: ReturnType<typeof controlsOn>,
  runtime: ReturnType<typeof createAgentRuntime>, requestId: string): Promise<ControlIntentRef> {
  const pin = await currentPin(fx);
  const submitted = await controls.submitControl(fx.ctx, {
    input: { runRef: fx.claim.runRef, kind: 'cancel', reason: 'stop now' },
    meta: { requestId: `${requestId}-submit`, expected: [pin] } });
  expect(submitted).toMatchObject({ status: 'committed' });
  if (submitted.status !== 'committed') throw new Error('cancel submit failed');
  const delivered = await runtime.port.deliverControl!(fx.ctx, { intentRef: submitted.value.intent.ref });
  expect(delivered).toMatchObject({ status: 'ready' });
  return submitted.value.intent.ref;
}

const TOOL_NAME = 's2b-38-ignoring-tool';
const CALL_ID = 's2b-38-unknown-call';

function fixtureOptions() {
  return {
    additionalSchemas: CONTROL_RECORD_SCHEMAS,
    scriptedReplies: [
      { kind: 'calls' as const, calls: [{ callId: CALL_ID, name: TOOL_NAME, args: {} }] },
      { kind: 'text' as const, text: 'S2B 2B-38 natural terminal after the unknown tool result' },
    ],
  };
}

function ignoringTool(entered: { resolve: () => void }, release: { promise: Promise<void> }): ToolDefinition {
  return controlledTool(TOOL_NAME, async (call: ToolCall) => {
    entered.resolve();
    // Deliberately ignore the cancellation signal: only the Kernel's own drain
    // timeout may end this call, producing the formal outcome_unknown result.
    await release.promise;
    return successResult(call.callId, 'late result after the drain');
  });
}

it('2B-38 (a) (BE1r): the Kernel drain timeout ends the Run outcome_unknown with a counted tally (one step, not an edit, terminal through the Turn end)', async () => {
  const entered = deferred(); const release = deferred();
  const fx = await createS2BRuntimeStoreFixture(fixtureOptions());
  fixtures.push(fx);
  const controls = controlsOn(fx);
  const runtime = createAgentRuntime({ ...fx.deps, controls,
    kernel: withControlledTool(fx, ignoringTool(entered, release)) });

  const prepared = await runtime.port.prepareExecution(fx.ctx, { runRef: fx.claim.runRef, requestId: 's2b-38a-prepare' });
  expect(prepared.status).toBe('ready');
  if (prepared.status !== 'ready') return;
  const running = runtime.port.startRun(fx.ctx, { prepared: prepared.value, consumerId: 's2b-38a-driver', requestId: 's2b-38a-start' });
  try {
    await entered.promise;
    await cancelAndDeliver(fx, controls, runtime, 's2b-38a');
    const finished = await Promise.race([running.then(() => true),
      new Promise<false>((resolve) => { setTimeout(() => resolve(false), 8_000); })]);
    expect(finished, 'the real Kernel drain must finish').toBe(true);
  } finally {
    release.resolve();
    await running.catch(() => undefined);
  }

  const record = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  expect(record).toMatchObject({ status: 'ready', value: { run: { status: 'ended', outcome: 'outcome_unknown' } } });

  const activities = await fx.activity.readRunActivities(fx.ctx, { runRefs: [fx.claim.runRef] });
  expect(activities.status).toBe('ready');
  if (activities.status !== 'ready') return;
  expect(activities.value).toHaveLength(1);
  expect(activities.value[0]).toMatchObject({
    runRef: fx.claim.runRef, status: 'counted', error: false, recordedBy: 'run_end',
    totals: { steps: 1, edits: 0, editsUnknown: 0 }, countedThroughTurnEnd: true, unresolvedCalls: 1,
  });
}, 30_000);

it('2B-38 (b) (BE1r): cancelling the ending unknown-end re-read writes nothing; the next observe ends it with the same tally as (a)', async () => {
  const entered = deferred(); const release = deferred();
  let startPositionMinusOne = 0;
  let armed = false;
  const controller = new AbortController();
  const fx = await createS2BRuntimeStoreFixture(fixtureOptions());
  fixtures.push(fx);
  const controls = controlsOn(fx);
  const wrapped = withBe1rKernelReadFaults(fx.deps.kernelStores, (read) => {
    if (armed && read.limit > 1 && read.after <= startPositionMinusOne) controller.abort();
    return 'pass';
  });
  const refuseEnd: ExecutionEntryPort = { ...fx.entry,
    async recordRunResult() {
      return { status: 'rejected', code: 'unavailable', reason: 'S2B 2B-38b: the driver must not book the unknown end' };
    } };
  const driver = createAgentRuntime({ ...fx.deps, entry: refuseEnd, controls,
    kernel: withControlledTool(fx, ignoringTool(entered, release)) });
  const observer = createAgentRuntime({ ...fx.deps, kernelStores: wrapped });

  const prepared = await driver.port.prepareExecution(fx.ctx, { runRef: fx.claim.runRef, requestId: 's2b-38b-prepare' });
  expect(prepared.status).toBe('ready');
  if (prepared.status !== 'ready') return;
  const running = driver.port.startRun(fx.ctx, { prepared: prepared.value, consumerId: 's2b-38b-driver', requestId: 's2b-38b-start' });
  try {
    await entered.promise;
    await cancelAndDeliver(fx, controls, driver, 's2b-38b');
    // Observe mid-run so the observer's ending observation re-reads the whole Turn.
    const first = await observer.port.observeRun(fx.ctx, { runRef: fx.claim.runRef });
    expect(first.status).toBe('ready');
    if (first.status !== 'ready') return;
    startPositionMinusOne = (first.value.run.executionHistory?.startPosition ?? 1) - 1;
    armed = true;
    const finished = await Promise.race([running.then(() => true),
      new Promise<false>((resolve) => { setTimeout(() => resolve(false), 8_000); })]);
    expect(finished, 'the real Kernel drain must finish').toBe(true);
  } finally {
    release.resolve();
    await running.catch(() => undefined);
  }

  // The driver Runtime refused its own booking, so the Run is still open.
  const open = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  expect(open.status).toBe('ready');
  if (open.status === 'ready') expect(open.value.run.status).not.toBe('ended');

  const cancelled = await observer.port.observeRun({ ...fx.ctx, signal: controller.signal }, { runRef: fx.claim.runRef });
  expect(cancelled).toMatchObject({ status: 'rejected', code: 'cancelled' });
  const stillOpen = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  expect(stillOpen.status).toBe('ready');
  if (stillOpen.status === 'ready') expect(stillOpen.value.run.status).not.toBe('ended');

  armed = false;
  const retried = await observer.port.observeRun(fx.ctx, { runRef: fx.claim.runRef });
  expect(retried.status).toBe('ready');
  const ended = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  expect(ended).toMatchObject({ status: 'ready', value: { run: { status: 'ended', outcome: 'outcome_unknown' } } });

  const activities = await fx.activity.readRunActivities(fx.ctx, { runRefs: [fx.claim.runRef] });
  expect(activities.status).toBe('ready');
  if (activities.status !== 'ready') return;
  expect(activities.value).toHaveLength(1);
  expect(activities.value[0]).toMatchObject({
    runRef: fx.claim.runRef, status: 'counted', error: false, recordedBy: 'run_end',
    totals: { steps: 1, edits: 0, editsUnknown: 0 }, countedThroughTurnEnd: true, unresolvedCalls: 1,
  });
}, 30_000);

it('2B-38 (c) (BE1r): one unknown-end re-read failure plus one submit failure retries the SAME event without idempotency_conflict and keeps unknown(history_read_failed)', async () => {
  const entered = deferred(); const release = deferred();
  let startPositionMinusOne = 0;
  let armed = false;
  const fx = await createS2BRuntimeStoreFixture(fixtureOptions());
  fixtures.push(fx);
  const controls = controlsOn(fx);
  let submitCalls = 0;
  const entry: ExecutionEntryPort = { ...fx.entry,
    async recordRunResult(ctx, request) {
      submitCalls += 1;
      if (submitCalls === 1) return { status: 'rejected', code: 'unavailable', reason: 'S2B 2B-38c: one transient unknown-end write failure' };
      return fx.entry.recordRunResult(ctx, request);
    } };
  const wrapped = withBe1rKernelReadFaults(fx.deps.kernelStores, (read) => {
    if (armed && read.limit > 1 && read.after <= startPositionMinusOne) return 'unavailable';
    return 'pass';
  });
  const runtime = createAgentRuntime({ ...fx.deps, entry, controls, kernelStores: wrapped,
    kernel: withControlledTool(fx, ignoringTool(entered, release)) });

  const prepared = await runtime.port.prepareExecution(fx.ctx, { runRef: fx.claim.runRef, requestId: 's2b-38c-prepare' });
  expect(prepared.status).toBe('ready');
  if (prepared.status !== 'ready') return;
  const running = runtime.port.startRun(fx.ctx, { prepared: prepared.value, consumerId: 's2b-38c-driver', requestId: 's2b-38c-start' });
  try {
    await entered.promise;
    await cancelAndDeliver(fx, controls, runtime, 's2b-38c');
    const first = await runtime.port.observeRun(fx.ctx, { runRef: fx.claim.runRef });
    expect(first.status).toBe('ready');
    if (first.status !== 'ready') return;
    startPositionMinusOne = (first.value.run.executionHistory?.startPosition ?? 1) - 1;
    armed = true;
    const finished = await Promise.race([running.then(() => true),
      new Promise<false>((resolve) => { setTimeout(() => resolve(false), 8_000); })]);
    expect(finished, 'the real Kernel drain must finish').toBe(true);
  } finally {
    release.resolve();
    await running.catch(() => undefined);
  }
  // The ending observation attached unknown and failed its submit; the Run stays open.
  expect(submitCalls).toBe(1);
  const pending = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  expect(pending.status).toBe('ready');
  if (pending.status === 'ready') expect(pending.value.run.status).not.toBe('ended');

  // The next observation reuses the SAME saved event/request (no conflict) and submits it.
  armed = false;
  const retried = await runtime.port.observeRun(fx.ctx, { runRef: fx.claim.runRef });
  expect(retried.status).toBe('ready');
  expect(submitCalls).toBe(2);
  // The retry submitted the SAME saved event/request (a changed one would have
  // been an idempotency_conflict) and the Run is ended outcome_unknown.
  const ended = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  expect(ended).toMatchObject({ status: 'ready', value: { run: { status: 'ended', outcome: 'outcome_unknown' } } });

  const activities = await fx.activity.readRunActivities(fx.ctx, { runRefs: [fx.claim.runRef] });
  expect(activities.status).toBe('ready');
  if (activities.status !== 'ready') return;
  expect(activities.value).toHaveLength(1);
  expect(activities.value[0]).toMatchObject({
    runRef: fx.claim.runRef, status: 'unknown', reason: 'history_read_failed', error: false, recordedBy: 'run_end',
  });
}, 30_000);
