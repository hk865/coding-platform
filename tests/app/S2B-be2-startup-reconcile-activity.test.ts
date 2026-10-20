/**
 * Slice 2B row 2B-11 (entry BE2, L5/L7; F27) — one example per start-up
 * reconcile ending, each asserting its own activity read:
 *   (a) RUN-19: the process crashed during a model call; the Kernel has no
 *       terminal and no running call → `counted`, `countedThroughTurnEnd: false`.
 *   (b) RUN-24: a person paused the Run and the process restarted →
 *       `counted`, `countedThroughTurnEnd: false`.
 *   (c) RUN-20(i): a tool call is still in flight (BE1r `blockingTool`, as
 *       `tests/runtime/A2-reconcile-runtime.test.ts:230`) → `counted`,
 *       `countedThroughTurnEnd: false`, that call is one step.
 *   (d) RUN-20(ii): the probe proves the Kernel unreadable →
 *       `unknown('kernel_unreadable')`; the calendar marks `uncountedRuns: 1`
 *       for every hour from the Run start to its end, never 0.
 *
 * Fixture (built only through public calls; follows BE2 / P7 / P6):
 * - `createS2BRuntimeStoreFixture` (memory): real Runtime + frozen Kernel +
 *   scripted model + real WorkGraph stores;
 * - `restartedHost` (P6) for (a)-(c); for (d) its classifier owner is replaced
 *   with one over the real Kernel store wrapped by the BE2 `get`/`read` fault
 *   seam (`withBe2KernelStoreFaults`) so the step-1 probe answers `damaged`;
 * - the clock is the fixture's platform clock; the Kernel's real clock is not
 *   asserted.
 *
 * Reads go through the public `readRunActivities` / `readActivityCalendar`.
 */
import { afterEach, expect, it } from 'vitest';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import { createSessionHistoryCursorOwner } from '../../src/core/agent-runtime/session-operations.js';
import { createS2BRuntimeStoreFixture, type S2BRuntimeStoreFixture } from '../helpers/S2B-runtime-store-fixture.js';
import { deferred } from '../helpers/A2-restart-fixture.js';
import { blockingTool } from '../helpers/S2B-runtime-tools-support.js';
import {
  BE2_HOST_1, BE2_HOST_2, be2ExtraSchemas, calendarOf, controlsOn, prepare, restartHost, submitControl,
  viewOf, withBe2KernelStoreFaults, withTool,
} from '../helpers/S2B-be2-reconcile-support.js';

const fixtures: S2BRuntimeStoreFixture[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});


it('2B-11 (RUN-19): a crash during a model call (no terminal, nothing in flight) is counted with countedThroughTurnEnd false', async () => {
  const entered = deferred();
  const release = deferred();
  const fx = await createS2BRuntimeStoreFixture({
    additionalSchemas: be2ExtraSchemas(),
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: 's2b-11a-read', name: 'read', args: { path: 'b2-read.txt' } }] },
      { kind: 'text', text: 'S2B 2B-11a done' },
    ],
    beforeReply: async (_request, index) => {
      if (index === 0) { entered.resolve(); await release.promise; }
    },
  });
  fixtures.push(fx);
  const controls = controlsOn(fx);
  const runtime = createAgentRuntime({ ...fx.rebuildDeps({ hostInstance: BE2_HOST_1, runReconcile: true }), controls });
  const prepared = await prepare(fx, runtime, 's2b-11a-prepare');
  const running = runtime.port.startRun(fx.ctx, { prepared, consumerId: 's2b-11a-driver', requestId: 's2b-11a-start' });
  try {
    await entered.promise;
    fx.setNow('2026-09-26T02:00:00.000Z');
    const report = await restartHost(fx, BE2_HOST_2, controls).reconcile();
    expect(report).toMatchObject({ row: 'W-11', status: 'reconciled' });

    const view = await viewOf(fx);
    expect(view).toMatchObject({
      status: 'counted', recordedBy: 'run_end', error: false,
      totals: { steps: 0, edits: 0, editsUnknown: 0 }, countedThroughTurnEnd: false, unresolvedCalls: 0,
    });
  } finally {
    release.resolve();
    await running.catch(() => undefined);
  }
}, 60_000);

it('2B-11 (RUN-24): a person-paused Run restarted while paused is counted with countedThroughTurnEnd false', async () => {
  let fx!: S2BRuntimeStoreFixture;
  let controls!: ReturnType<typeof controlsOn>;
  fx = await createS2BRuntimeStoreFixture({
    additionalSchemas: be2ExtraSchemas(),
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: 's2b-11b-read', name: 'read', args: { path: 'b2-read.txt' } }] },
      { kind: 'text', text: 'S2B 2B-11b must not be reached' },
    ],
    beforeReply: async (_request, index) => {
      if (index === 0) await submitControl(fx, controls, 'pause', 'S2B 2B-11b: a person pauses', 's2b-11b-pause');
    },
  });
  fixtures.push(fx);
  controls = controlsOn(fx);
  const runtime = createAgentRuntime({ ...fx.rebuildDeps({ hostInstance: BE2_HOST_1, runReconcile: true }), controls });
  const prepared = await prepare(fx, runtime, 's2b-11b-prepare');
  await runtime.port.startRun(fx.ctx, { prepared, consumerId: 's2b-11b-driver', requestId: 's2b-11b-start' });

  const running = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  expect(running).toMatchObject({ status: 'ready', value: { run: { status: 'running', controlState: { desiredState: 'paused' } } } });

  fx.setNow('2026-09-26T02:00:00.000Z');
  const report = await restartHost(fx, BE2_HOST_2, controls).reconcile();
  expect(report).toMatchObject({ row: 'W-20', status: 'reconciled' });

  const view = await viewOf(fx);
  expect(view).toMatchObject({
    status: 'counted', recordedBy: 'run_end', error: false, countedThroughTurnEnd: false,
  });
}, 60_000);

it('2B-11 (RUN-20(i)): a tool call still in flight is one step and the tally is incomplete', async () => {
  const toolName = 's2b-11c-in-flight-tool';
  const entered = deferred();
  const release = deferred();
  const fx = await createS2BRuntimeStoreFixture({
    additionalSchemas: be2ExtraSchemas(),
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: 's2b-11c-call', name: toolName, args: {} }] },
      { kind: 'text', text: 'S2B 2B-11c done after the late result' },
    ],
  });
  fixtures.push(fx);
  const controls = controlsOn(fx);
  const deps = fx.rebuildDeps({ hostInstance: BE2_HOST_1, runReconcile: true });
  const runtime = createAgentRuntime({ ...deps, controls,
    kernel: withTool(deps.kernel, blockingTool(toolName, entered.resolve, release.promise)) });
  const prepared = await prepare(fx, runtime, 's2b-11c-prepare');
  const running = runtime.port.startRun(fx.ctx, { prepared, consumerId: 's2b-11c-driver', requestId: 's2b-11c-start' });
  try {
    await entered.promise;
    fx.setNow('2026-09-26T02:00:00.000Z');
    const report = await restartHost(fx, BE2_HOST_2, controls).reconcile();
    expect(report).toMatchObject({ row: 'W-13', status: 'reconciled', reason: 'unknown' });

    const view = await viewOf(fx);
    expect(view).toMatchObject({
      status: 'counted', recordedBy: 'run_end', error: false,
      totals: { steps: 1, edits: 0, editsUnknown: 0 }, countedThroughTurnEnd: false, unresolvedCalls: 1,
    });
  } finally {
    release.resolve();
    await running.catch(() => undefined);
  }
}, 60_000);

it('2B-11 (RUN-20(ii)): an unreadable Kernel probe writes unknown(kernel_unreadable) and the calendar marks every hour, never 0', async () => {
  const toolName = 's2b-11d-in-flight-tool';
  const entered = deferred();
  const release = deferred();
  const fx = await createS2BRuntimeStoreFixture({
    additionalSchemas: be2ExtraSchemas(),
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: 's2b-11d-call', name: toolName, args: {} }] },
      { kind: 'text', text: 'S2B 2B-11d done after the late result' },
    ],
  });
  fixtures.push(fx);
  const controls = controlsOn(fx);
  const deps = fx.rebuildDeps({ hostInstance: BE2_HOST_1, runReconcile: true });
  const runtime = createAgentRuntime({ ...deps, controls,
    kernel: withTool(deps.kernel, blockingTool(toolName, entered.resolve, release.promise)) });
  const prepared = await prepare(fx, runtime, 's2b-11d-prepare');
  fx.setNow('2026-09-26T10:00:00.000Z');
  const running = runtime.port.startRun(fx.ctx, { prepared, consumerId: 's2b-11d-driver', requestId: 's2b-11d-start' });
  try {
    await entered.promise;
    fx.setNow('2026-09-26T12:00:00.000Z');
    const restarted = restartHost(fx, BE2_HOST_2, controls);
    const wrapped = withBe2KernelStoreFaults(fx.deps.kernelStores, { get: () => 'corrupt' });
    restarted.classifier.owner = createSessionHistoryCursorOwner({ kernelStores: wrapped });
    const report = await restarted.reconcile();
    expect(report).toMatchObject({ row: 'W-14', status: 'reconciled' });

    const view = await viewOf(fx);
    expect(view).toMatchObject({
      status: 'unknown', reason: 'kernel_unreadable', error: false, recordedBy: 'run_end',
      totals: null, countedThroughTurnEnd: null, unresolvedCalls: null,
    });

    fx.setNow('2026-09-26T13:00:00.000Z');
    const calendar = await calendarOf(fx, {
      from: '2026-09-26T10:00:00.000Z', to: '2026-09-26T12:00:00.000Z', granularity: 'hour', timeZone: 'UTC',
    });
    expect(calendar.cells).toHaveLength(2);
    expect(calendar.cells.map(cell => [cell.localHour, cell.uncountedRuns, cell.complete]))
      .toEqual([[10, 1, false], [11, 1, false]]);
    expect(calendar.totals.complete).toBe(false);
    expect(calendar.coverage.runsUncounted).toEqual([{ reason: 'kernel_unreadable', count: 1 }]);
    expect(calendar.coverage.runsCounted).toBe(0);
  } finally {
    release.resolve();
    await running.catch(() => undefined);
  }
}, 60_000);
