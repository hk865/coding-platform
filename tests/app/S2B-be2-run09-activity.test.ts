/**
 * Slice 2B row 2B-13 (entry BE2, L5/L7; RUN-09, RUN-09 (R)) — a cancel before
 * the Run ever entered the Kernel:
 *   (a) in process, the platform applies the cancel on a claimed Run
 *       (`platform_not_entered`) → `readRunActivities` is `not_entered`,
 *       steps 0; the calendar has no activity cell for it and does not count
 *       it as uncounted;
 *   (b) at a restart, the start-up reconcile revokes the entering Run and the
 *       queued cancel ends it in the same commit (W-05) → the same read.
 *
 * Fixture (built only through public calls; follows BE2 / P7 / P6):
 * - `createS2BRuntimeStoreFixture` (memory) with the real control and evidence
 *   groups registered (`be2ExtraSchemas`); real Runtime + frozen Kernel +
 *   scripted model + real WorkGraph stores;
 * - the workspace `ActivityRecording` epoch is created through the real public
 *   `RunActivityPort.ensureActivityRecording`, so L7 can prove non-entry;
 * - (b) enters the Kernel with a never-returning driver (`A2-reconcile-runtime`
 *   W-05 shape) and reconciles through `restartedHost` (P6).
 *
 * Reads go through the public `readRunActivities` / `readActivityCalendar`.
 */
import { afterEach, expect, it } from 'vitest';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import { createS2BRuntimeStoreFixture, type S2BRuntimeStoreFixture } from '../helpers/S2B-runtime-store-fixture.js';
import {
  BE2_HOST_1, BE2_HOST_2, activityPortOn, be2ExtraSchemas, calendarOf, controlsOn, ensureEpoch,
  prepare, restartHost, submitControl, viewOf,
} from '../helpers/S2B-be2-reconcile-support.js';

const fixtures: S2BRuntimeStoreFixture[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});

const WINDOW = { from: '2026-09-26T00:00:00.000Z', to: '2026-09-26T01:00:00.000Z', granularity: 'hour' as const, timeZone: 'UTC' };

it('2B-13 (RUN-09 in process): a cancel of a claimed Run that never entered is not_entered with 0 steps and no uncounted cell', async () => {
  const fx = await createS2BRuntimeStoreFixture({ additionalSchemas: be2ExtraSchemas() });
  fixtures.push(fx);
  await ensureEpoch(fx, activityPortOn(fx, () => '2026-09-26T00:00:00.000Z'));
  const controls = controlsOn(fx, () => '2026-09-26T00:00:00.000Z');

  const started = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  expect(started).toMatchObject({ status: 'ready', value: { run: { status: 'starting' } } });

  await submitControl(fx, controls, 'cancel', 'S2B 2B-13a: never entered', 's2b-13a-cancel');
  const ended = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  expect(ended).toMatchObject({ status: 'ready', value: { run: { status: 'ended', outcome: 'cancelled' } } });

  const view = await viewOf(fx);
  expect(view).toMatchObject({ status: 'not_entered', reason: null, error: false,
    totals: { steps: 0, edits: 0, editsUnknown: 0 }, recordedBy: null, recordedAt: null });

  const calendar = await calendarOf(fx, WINDOW);
  expect(calendar.cells.every(cell => cell.uncountedRuns === 0 && cell.steps === 0 && cell.edits === 0)).toBe(true);
  expect(calendar.coverage.runsNotEntered).toBe(1);
  expect(calendar.coverage.runsUncounted).toEqual([]);
  expect(calendar.totals).toMatchObject({ steps: 0, edits: 0, checks: 0, complete: true });
}, 60_000);

it('2B-13 (RUN-09 (R) at a restart): a queued cancel ends an entering Run that never entered and it stays not_entered', async () => {
  const fx = await createS2BRuntimeStoreFixture({ additionalSchemas: be2ExtraSchemas() });
  fixtures.push(fx);
  await ensureEpoch(fx, activityPortOn(fx, () => '2026-09-26T00:00:00.000Z'));
  const controls = controlsOn(fx, () => '2026-09-26T00:00:00.000Z');
  const deps = fx.rebuildDeps({ hostInstance: BE2_HOST_1, runReconcile: true });
  // A driver stuck before any Kernel record: the Run reaches `entering` with no Turn.
  const stuck = createAgentRuntime({ ...deps, controls,
    kernel: { ...deps.kernel, runCodingAgent: () => new Promise(() => undefined) } });
  const prepared = await prepare(fx, stuck, 's2b-13b-prepare');
  void stuck.port.startRun(fx.ctx, { prepared, consumerId: 's2b-13b-driver', requestId: 's2b-13b-start' });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const record = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
    const auth = record.status === 'ready' ? record.value.run.executionAuthorization : undefined;
    if (auth !== undefined && 'phase' in auth && auth.phase === 'entering') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const entered = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  expect(entered).toMatchObject({ status: 'ready', value: { run: { executionAuthorization: { phase: 'entering' } } } });

  await submitControl(fx, controls, 'cancel', 'S2B 2B-13b: never entered', 's2b-13b-cancel');
  fx.setNow('2026-09-26T00:30:00.000Z');
  const report = await restartHost(fx, BE2_HOST_2, controls).reconcile();
  expect(report).toMatchObject({ row: 'W-05', status: 'reconciled', reason: 'not_entered' });
  const ended = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  expect(ended).toMatchObject({ status: 'ready', value: { run: { status: 'ended', outcome: 'cancelled' } } });

  const view = await viewOf(fx);
  expect(view).toMatchObject({ status: 'not_entered', reason: null, error: false,
    totals: { steps: 0, edits: 0, editsUnknown: 0 } });

  const calendar = await calendarOf(fx, WINDOW);
  expect(calendar.cells.every(cell => cell.uncountedRuns === 0 && cell.steps === 0)).toBe(true);
  expect(calendar.coverage.runsNotEntered).toBe(1);
  expect(calendar.coverage.runsUncounted).toEqual([]);
}, 60_000);
