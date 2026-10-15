/**
 * Slice 2B row 2B-36 (entry BE1r, L6 steps 1-3; RUN-07) — the observer's
 * end-of-Run re-read can be cancelled, writes nothing, and a later observe
 * still ends the Run with the hand-computed tally.
 *
 * Fixture (built only through public calls; follows BE1r):
 * - `createS2BRuntimeStoreFixture` composes the REAL Runtime + frozen Kernel +
 *   real WorkGraph stores (memory) and a scripted model. The fixture exposes
 *   the live store handle and the public activity reads.
 * - The scripted Turn makes one real `read` call and then answers. The first
 *   provider call is held by `beforeReply` so the test can observe mid-run.
 * - The DRIVER Runtime runs the real Turn but its `recordRunResult` is refused:
 *   the row's own observation (on the OBSERVER Runtime) is the one that ends
 *   the Run, so the cancelled re-read and the retry are both reachable.
 *   That driver isolation is fixture plumbing, not an assertion.
 * - The Kernel read fault seam (`withBe1rKernelReadFaults`) aborts the caller
 *   signal while the observer re-reads the whole Turn's first page.
 *
 * Reads go through the public `readRunActivities` (L10), never the database.
 * Expected steps/edits are hand-computed from the one-`read` Turn.
 */
import { afterEach, expect, it } from 'vitest';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
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

it('2B-36 (BE1r): cancelling the ending full-Turn re-read reports cancelled and writes nothing; the next observe ends it counted', async () => {
  const providerEntered = deferred();
  const releaseProvider = deferred();
  // A fresh Turn's locator starts at position 1, so the full re-read resumes at 0.
  let startPositionMinusOne = 0;
  let armed = false;
  const controller = new AbortController();
  const fx = await createS2BRuntimeStoreFixture({
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: 's2b-36-read', name: 'read', args: { path: 'b2-read.txt' } }] },
      { kind: 'text', text: 'S2B 2B-36 done' },
    ],
    beforeReply: async (_request, index) => {
      if (index === 0) { providerEntered.resolve(); await releaseProvider.promise; }
    },
  });
  fixtures.push(fx);

  const wrapped = withBe1rKernelReadFaults(fx.deps.kernelStores, (read) => {
    if (armed && read.limit > 1 && read.after <= startPositionMinusOne) controller.abort();
    return 'pass';
  });
  const refuseEnd: ExecutionEntryPort = { ...fx.entry,
    async recordRunResult() {
      return { status: 'rejected', code: 'unavailable', reason: 'S2B 2B-36: the driver must not book the end' };
    } };
  const driver = createAgentRuntime({ ...fx.deps, entry: refuseEnd });
  const observer = createAgentRuntime({ ...fx.deps, kernelStores: wrapped });

  const prepared = await driver.port.prepareExecution(fx.ctx, { runRef: fx.claim.runRef, requestId: 's2b-36-prepare' });
  expect(prepared.status).toBe('ready');
  if (prepared.status !== 'ready') return;
  const running = driver.port.startRun(fx.ctx, { prepared: prepared.value, consumerId: 's2b-36-driver', requestId: 's2b-36-start' });
  await providerEntered.promise;

  // First observation mid-run: the reduction cache is non-empty from here on.
  const first = await observer.port.observeRun(fx.ctx, { runRef: fx.claim.runRef });
  expect(first.status).toBe('ready');
  if (first.status !== 'ready') return;
  // The full Turn re-read resumes one position before the locator's start.
  startPositionMinusOne = (first.value.run.executionHistory?.startPosition ?? 1) - 1;

  // Let the real Turn finish. The driver Runtime refuses to book the end, so the
  // Run stays open and the observer's own ending observation is the row's.
  armed = true;
  releaseProvider.resolve();
  await running;
  const callsAfterTurn = fx.scripted.calls();
  const before = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  expect(before.status).toBe('ready');
  if (before.status === 'ready') expect(before.value.run.status).not.toBe('ended');

  // The ending observation is cancelled while re-reading the whole Turn's first page.
  const cancelled = await observer.port.observeRun({ ...fx.ctx, signal: controller.signal }, { runRef: fx.claim.runRef });
  expect(cancelled).toMatchObject({ status: 'rejected', code: 'cancelled' });
  const stillOpen = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
  expect(stillOpen.status).toBe('ready');
  if (stillOpen.status === 'ready') expect(stillOpen.value.run.status).not.toBe('ended');

  // No new Kernel records; the next observation reuses the saved boundary/item
  // and ends the Run.
  armed = false;
  const retried = await observer.port.observeRun(fx.ctx, { runRef: fx.claim.runRef });
  expect(retried).toMatchObject({ status: 'ready', value: { run: { status: 'ended' } } });

  const activities = await fx.activity.readRunActivities(fx.ctx, { runRefs: [fx.claim.runRef] });
  expect(activities.status).toBe('ready');
  if (activities.status !== 'ready') return;
  expect(activities.value).toHaveLength(1);
  expect(activities.value[0]).toMatchObject({
    runRef: fx.claim.runRef, status: 'counted', error: false, recordedBy: 'run_end',
    totals: { steps: 1, edits: 0, editsUnknown: 0 }, countedThroughTurnEnd: true, unresolvedCalls: 0,
  });
  // Observing and re-reading never start a new provider call.
  expect(fx.scripted.calls()).toBe(callsAfterTurn);
}, 60_000);
