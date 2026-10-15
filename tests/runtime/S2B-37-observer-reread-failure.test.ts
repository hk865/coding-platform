/**
 * Slice 2B row 2B-37 (entry BE1r, L6 steps 3-4; L8) — the ending full-Turn
 * re-read fails once (`unavailable`) and the same ending submit fails once; the
 * Run stays open, the FIRST attached facts win (`unknown('history_read_failed')`)
 * and the next observe submits the SAME input without re-reading.
 *
 * Fixture (built only through public calls; follows BE1r):
 * - one real Runtime over `createS2BRuntimeStoreFixture` (memory), real frozen
 *   Kernel and real WorkGraph stores;
 * - `beforeReply` holds the first provider call so the test observes mid-run and
 *   the reduction cache is non-empty when the Run ends;
 * - the Kernel read fault seam makes the ending whole-Turn re-read throw
 *   `unavailable` (the same seam `tests/runtime/B2-runtime-execution.test.ts:553`
 *   uses to fail a port call once);
 * - `recordRunResult` is refused exactly once, like B2 `:553`.
 *
 * The tally is asserted through the public `readRunActivities` (L10): the first
 * attachment wins even though this re-read would succeed now, so the Run is
 * `unknown('history_read_failed')`, not `counted`.
 */
import { afterEach, expect, it } from 'vitest';
import type { ExecutionEntryPort } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import { createS2BRuntimeStoreFixture, type S2BRuntimeStoreFixture } from '../helpers/S2B-runtime-store-fixture.js';
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

it('2B-37 (BE1r): one re-read failure plus one submit failure keeps the Run open; the retry submits the same input, ends it and keeps unknown(history_read_failed)', async () => {
  const providerEntered = deferred();
  const releaseProvider = deferred();
  let startPositionMinusOne = 0;
  let armed = false;
  const fx = await createS2BRuntimeStoreFixture({
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: 's2b-37-read', name: 'read', args: { path: 'b2-read.txt' } }] },
      { kind: 'text', text: 'S2B 2B-37 done' },
    ],
    beforeReply: async (_request, index) => {
      if (index === 0) { providerEntered.resolve(); await releaseProvider.promise; }
    },
  });
  fixtures.push(fx);

  let submitCalls = 0;
  const entry: ExecutionEntryPort = { ...fx.entry,
    async recordRunResult(ctx, request) {
      submitCalls += 1;
      if (submitCalls === 1) return { status: 'rejected', code: 'unavailable', reason: 'S2B 2B-37: one transient terminal write failure' };
      return fx.entry.recordRunResult(ctx, request);
    } };
  const wrapped = withBe1rKernelReadFaults(fx.deps.kernelStores, (read) => {
    if (armed && read.limit > 1 && read.after <= startPositionMinusOne) return 'unavailable';
    return 'pass';
  });
  const runtime = fx.rebuild({ entry, kernelStores: wrapped });

  const prepared = await runtime.port.prepareExecution(fx.ctx, { runRef: fx.claim.runRef, requestId: 's2b-37-prepare' });
  expect(prepared.status).toBe('ready');
  if (prepared.status !== 'ready') return;
  const running = runtime.port.startRun(fx.ctx, { prepared: prepared.value, consumerId: 's2b-37-driver', requestId: 's2b-37-start' });
  await providerEntered.promise;

  // Observe once mid-run so the ending observation must re-read the whole Turn.
  const first = await runtime.port.observeRun(fx.ctx, { runRef: fx.claim.runRef });
  expect(first.status).toBe('ready');
  if (first.status !== 'ready') return;
  startPositionMinusOne = (first.value.run.executionHistory?.startPosition ?? 1) - 1;

  // The ending observation: re-read fails -> unknown attached; the same submit fails once.
  armed = true;
  releaseProvider.resolve();
  await running;
  expect(submitCalls).toBe(1);
  const pending = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  expect(pending.status).toBe('ready');
  if (pending.status === 'ready') expect(pending.value.run.status).not.toBe('ended');

  // The next observation does not re-read: it reuses the saved item (same event,
  // same request) and submits it successfully.
  armed = false;
  const retried = await runtime.port.observeRun(fx.ctx, { runRef: fx.claim.runRef });
  expect(retried).toMatchObject({ status: 'ready', value: { run: { status: 'ended' } } });
  expect(submitCalls).toBe(2);

  const activities = await fx.activity.readRunActivities(fx.ctx, { runRefs: [fx.claim.runRef] });
  expect(activities.status).toBe('ready');
  if (activities.status !== 'ready') return;
  expect(activities.value).toHaveLength(1);
  expect(activities.value[0]).toMatchObject({
    runRef: fx.claim.runRef, status: 'unknown', reason: 'history_read_failed', error: false,
    recordedBy: 'run_end', totals: null, countedThroughTurnEnd: null, unresolvedCalls: null,
  });
}, 60_000);
