/**
 * Slice 2B row 2B-10 (entry BE2, L5/rule 5; RUN-18) — the Kernel wrote the
 * Turn's terminal but the result was never booked (the A8-3a crash point: the
 * end commit is refused). The next start books the Kernel's own terminal
 * through `recordRunResult` (RUN-18) with the hand-computed tally; a further
 * start changes nothing.
 *
 * Fixture (built only through public calls; follows BE2 / P7 / P6):
 * - `createS2BRuntimeStoreFixture` (memory): real Runtime + frozen Kernel +
 *   scripted model + real WorkGraph stores; the live activity reads assert.
 * - the driver Runtime's `recordRunResult` is refused, so the Run stays open
 *   with a Kernel terminal (the crashed process booked nothing).
 * - `restartedHost` (P6) reconciles the restart; the same store serves reads.
 *
 * The tally is read through the public `readRunActivities` (L10). The P7
 * fixture's Role is read-only (no `write`/`shell`), so the Turn uses real
 * `read` calls; the hand-computed steps count them and edits stay 0.
 */
import { afterEach, expect, it } from 'vitest';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import { createS2BRuntimeStoreFixture, type S2BRuntimeStoreFixture } from '../helpers/S2B-runtime-store-fixture.js';
import {
  BE2_HOST_1, BE2_HOST_2, BE2_HOST_3, controlsOn, prepare, refusingEntry,
  restartHost, viewOf,
} from '../helpers/S2B-be2-reconcile-support.js';

const fixtures: S2BRuntimeStoreFixture[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});

const RUN18_AT = '2026-09-26T01:00:00.000Z';

it('2B-10 (BE2, RUN-18): a Kernel terminal the observer could not book is counted by the next start; a further start leaves it unchanged', async () => {
  const fx = await createS2BRuntimeStoreFixture({
    scriptedReplies: [
      { kind: 'calls', calls: [
        { callId: 's2b-10-read-1', name: 'read', args: { path: 'b2-read.txt' } },
        { callId: 's2b-10-read-2', name: 'read', args: { path: 'b2-read.txt' } },
      ] },
      { kind: 'calls', calls: [{ callId: 's2b-10-read-3', name: 'read', args: { path: 'b2-read.txt' } }] },
      { kind: 'text', text: 'S2B 2B-10 done' },
    ],
  });
  fixtures.push(fx);
  const controls = controlsOn(fx);
  const deps = fx.rebuildDeps({ hostInstance: BE2_HOST_1, runReconcile: true });
  const crashed = createAgentRuntime({ ...deps, controls,
    entry: refusingEntry(fx, 'S2B 2B-10: the end commit was lost with the process') });

  const prepared = await prepare(fx, crashed, 's2b-10-prepare');
  await crashed.port.startRun(fx.ctx, { prepared, consumerId: 's2b-10-driver', requestId: 's2b-10-start' });

  // The Kernel terminal is durable but the observer's booking was refused.
  const before = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  expect(before).toMatchObject({ status: 'ready', value: { run: { status: 'running' } } });
  expect(fx.scripted.calls()).toBe(3);

  // The restart books the Kernel's own terminal (RUN-18) with the tally.
  fx.setNow(RUN18_AT);
  const second = await restartHost(fx, BE2_HOST_2, controls).reconcile();
  expect(second).toMatchObject({ row: 'W-09', status: 'reconciled', reason: 'terminal completed' });

  const counted = await viewOf(fx);
  expect(counted).toMatchObject({
    runRef: fx.claim.runRef, status: 'counted', reason: null, error: false, recordedBy: 'run_end',
    totals: { steps: 3, edits: 0, editsUnknown: 0 },
    countedThroughTurnEnd: true, unresolvedCalls: 0, recordedAt: RUN18_AT,
  });
  expect(counted.changedFiles).toMatchObject({ definite: 0, possible: 0, possiblyIncomplete: false });

  // A further start with no new evidence writes nothing.
  const third = await restartHost(fx, BE2_HOST_3, controls).reconcile();
  expect(third).toMatchObject({ status: 'left' });
  const unchanged = await viewOf(fx);
  expect(unchanged.recordedAt).toBe(RUN18_AT);
  expect(unchanged.totals).toEqual({ steps: 3, edits: 0, editsUnknown: 0 });
  expect(fx.scripted.calls(), 'no model call during the restarts').toBe(3);
}, 60_000);
