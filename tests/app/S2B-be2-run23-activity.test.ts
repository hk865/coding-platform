/**
 * Slice 2B row 2B-12 (entry BE2, L5; RUN-23) — a cancel of a Run paused at a
 * safe point:
 *   (a) in process, the live handle's exit proof (`stopPausedRunInProcess`
 *       through `deliverControl`) books the end → `counted`;
 *   (b) at a restart, the start-up reconcile books the same clean paused Turn
 *       with a queued cancel (W-12) → `counted`.
 *
 * Fixture (built only through public calls; follows BE2 / P7 / P6):
 * - `createS2BRuntimeStoreFixture` (memory) with the real control records
 *   registered (`be2ExtraSchemas`); real Runtime + frozen Kernel + scripted
 *   model + real WorkGraph stores;
 * - the BE1r `controlledTool` (unchanged copy in
 *   `S2B-runtime-tools-support.ts`) blocks only the first of two serial groups,
 *   so the pause lands at the group boundary with nothing in flight;
 * - `restartedHost` (P6) for (b).
 *
 * Reads go through the public `readRunActivities`.
 */
import { afterEach, expect, it } from 'vitest';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import type { ToolCall, ToolResult } from '../../vendor/coding-agent/dist/public-api.js';
import { createS2BRuntimeStoreFixture, type S2BRuntimeStoreFixture } from '../helpers/S2B-runtime-store-fixture.js';
import { deferred } from '../helpers/A2-restart-fixture.js';
import { controlledTool } from '../helpers/S2B-runtime-tools-support.js';
import {
  BE2_HOST_1, BE2_HOST_2, be2ExtraSchemas, controlsOn, prepare, restartHost, submitControl, viewOf, withTool,
} from '../helpers/S2B-be2-reconcile-support.js';

const fixtures: S2BRuntimeStoreFixture[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});


function successResult(callId: string): ToolResult {
  return { schemaVersion: 1, callId, status: 'success', output: [{ kind: 'text', text: 'controlled tool completed' }],
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] } };
}

function twoGroupTool(label: string, entered: { resolve: () => void }, release: { promise: Promise<void> }) {
  const name = `s2b-12-${label}-tool`;
  const tool = controlledTool(name, async (call: ToolCall) => {
    if (call.callId === `${label}-group-1`) { entered.resolve(); await release.promise; }
    return successResult(call.callId);
  });
  return { name, tool };
}

/** Start a Turn that pauses at the group boundary with nothing in flight. */
async function pausedTurn(label: string) {
  const entered = deferred();
  const release = deferred();
  const { name, tool } = twoGroupTool(label, entered, release);
  const fx = await createS2BRuntimeStoreFixture({
    additionalSchemas: be2ExtraSchemas(),
    scriptedReplies: [
      { kind: 'calls', calls: [
        { callId: `${label}-group-1`, name, args: {} },
        { callId: `${label}-group-2`, name, args: {} },
      ] },
      { kind: 'text', text: 'S2B 2B-12: must not run after the pause' },
    ],
  });
  fixtures.push(fx);
  const controls = controlsOn(fx);
  const deps = fx.rebuildDeps({ hostInstance: BE2_HOST_1, runReconcile: true });
  const runtime = createAgentRuntime({ ...deps, controls, kernel: withTool(deps.kernel, tool) });
  const prepared = await prepare(fx, runtime, `s2b-12-${label}-prepare`);
  const running = runtime.port.startRun(fx.ctx, { prepared, consumerId: `s2b-12-${label}-driver`, requestId: `s2b-12-${label}-start` });
  await entered.promise;
  const pauseRef = await submitControl(fx, controls, 'pause', 'S2B 2B-12: pause at the safe point', `s2b-12-${label}-pause`);
  const delivered = await runtime.port.deliverControl!(fx.ctx, { intentRef: pauseRef });
  expect(delivered).toMatchObject({ status: 'ready' });
  release.resolve();
  await running;
  // The live handle exited at the safe point and the pause is now applied.
  const ack = await controls.readControl(fx.ctx, pauseRef);
  expect(ack).toMatchObject({ status: 'ready', value: { status: 'applied', observation: { kind: 'paused' } } });
  const record = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  expect(record).toMatchObject({ status: 'ready', value: { run: { status: 'running', controlState: { desiredState: 'paused' } } } });
  return { fx, controls, runtime };
}

it('2B-12 (RUN-23 in process): a cancel of a Run paused at a safe point is counted on the live exit proof', async () => {
  const { fx, controls, runtime } = await pausedTurn('a');
  fx.setNow('2026-09-26T03:00:00.000Z');
  const cancelRef = await submitControl(fx, controls, 'cancel', 'S2B 2B-12a: stop while paused', 's2b-12a-cancel');
  const delivered = await runtime.port.deliverControl!(fx.ctx, { intentRef: cancelRef });
  expect(delivered).toMatchObject({ status: 'ready', value: { status: 'applied',
    observation: { origin: 'platform_paused_stop', kind: 'cancelled' } } });
  const ended = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  expect(ended).toMatchObject({ status: 'ready', value: { run: { status: 'ended', outcome: 'cancelled' } } });

  const view = await viewOf(fx);
  expect(view).toMatchObject({
    status: 'counted', recordedBy: 'run_end', error: false,
    totals: { steps: 1, edits: 0, editsUnknown: 0 },
  });
}, 60_000);

it('2B-12 (RUN-23 at a restart): the start-up reconcile books the paused stop of a queued cancel as counted', async () => {
  const { fx, controls } = await pausedTurn('b');
  await submitControl(fx, controls, 'cancel', 'S2B 2B-12b: stop while paused', 's2b-12b-cancel');
  fx.setNow('2026-09-26T03:00:00.000Z');
  const report = await restartHost(fx, BE2_HOST_2, controls).reconcile();
  expect(report).toMatchObject({ row: 'W-12', status: 'reconciled' });
  const ended = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  expect(ended).toMatchObject({ status: 'ready', value: { run: { status: 'ended', outcome: 'cancelled' } } });

  const view = await viewOf(fx);
  expect(view).toMatchObject({
    status: 'counted', recordedBy: 'run_end', error: false,
    totals: { steps: 1, edits: 0, editsUnknown: 0 },
  });
}, 60_000);
