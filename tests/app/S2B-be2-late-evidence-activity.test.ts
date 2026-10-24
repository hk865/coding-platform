/**
 * Slice 2B row 2B-14 (entry BE2 + BE1r, L4/L5/L8; RUN-21, RUN-22) — late
 * evidence after an unreadable or incomplete end:
 *   (a) after RUN-20(ii), the Kernel becomes readable again; the next start's
 *       reconcile books the late terminal (RUN-21) and `unknown` becomes
 *       `counted` (`recordedBy: 'run_end'`). The automatic backfill that runs
 *       after the reconcile in the same start does not process it.
 *   (b) a `counted` but incomplete RUN-20(i) is replaced by the complete
 *       RUN-21: a human range backfill covering it does nothing (it never
 *       replaces a current-rule `counted`) and the `recordedAt` is unchanged;
 *       the next start's reconcile replaces it. Both restart once more with no
 *       new evidence → the record is unchanged.
 *   (c) a RUN-22 human attestation leaves the tally unchanged.
 *
 * Fixture (built only through public calls; follows BE2 / P7 / P6):
 * - `createS2BRuntimeStoreFixture` (memory) + `blockingTool` (P6) held in
 *   flight; the probe fault uses the BE2 `get`/`read` Kernel-store seam;
 * - the Workflow backfill is the real `createActivityBackfill` bound to the
 *   live Runtime `countRunActivity` over the same store;
 * - the attestation is the real WorkGraph `resolveUnknownRun`.
 *
 * Reads go through the public `readRunActivities`.
 */
import { afterEach, expect, it } from 'vitest';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import { createSessionHistoryCursorOwner } from '../../src/core/agent-runtime/session-operations.js';
import { readReviewDraftAtEntry } from '../../src/core/agent-runtime/run-reconcile.js';
import { createS2BRuntimeStoreFixture, type S2BRuntimeStoreFixture } from '../helpers/S2B-runtime-store-fixture.js';
import { deferred } from '../helpers/A2-restart-fixture.js';
import { blockingTool } from '../helpers/S2B-runtime-tools-support.js';
import {
  BE2_HOST_1, BE2_HOST_2, BE2_HOST_3, backfillOn, be2ExtraSchemas, controlsOn, currentPin,
  humanCtx, prepare, restartHost, viewOf, withBe2KernelStoreFaults, withTool,
} from '../helpers/S2B-be2-reconcile-support.js';

const fixtures: S2BRuntimeStoreFixture[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});


/** One Run with a `blockingTool` call in flight; returns the fixture and release. */
async function inFlightRun(label: string) {
  const toolName = `s2b-14-${label}-tool`;
  const entered = deferred();
  const release = deferred();
  const fx = await createS2BRuntimeStoreFixture({
    additionalSchemas: be2ExtraSchemas(),
    scriptedReplies: [
      { kind: 'calls', calls: [{ callId: `s2b-14-${label}-call`, name: toolName, args: {} }] },
      { kind: 'text', text: `S2B 2B-14${label} done after the late result` },
    ],
  });
  fixtures.push(fx);
  const controls = controlsOn(fx);
  const deps = fx.rebuildDeps({ hostInstance: BE2_HOST_1, runReconcile: true });
  const runtime = createAgentRuntime({ ...deps, controls,
    kernel: withTool(deps.kernel, blockingTool(toolName, entered.resolve, release.promise)) });
  const prepared = await prepare(fx, runtime, `s2b-14${label}-prepare`);
  const running = runtime.port.startRun(fx.ctx, { prepared, consumerId: `s2b-14${label}-driver`, requestId: `s2b-14${label}-start` });
  await entered.promise;
  return { fx, controls, runtime, running, release };
}

it('2B-14 (a) (RUN-21 at a restart): a recovered Kernel turns unknown(kernel_unreadable) into counted, and the automatic backfill skips it', async () => {
  const { fx, controls, running, release } = await inFlightRun('a');
  try {
    fx.setNow('2026-09-26T03:00:00.000Z');
    const first = restartHost(fx, BE2_HOST_2, controls);
    const wrapped = withBe2KernelStoreFaults(fx.deps.kernelStores, { get: () => 'corrupt' });
    first.classifier.owner = createSessionHistoryCursorOwner({ kernelStores: wrapped });
    expect(await first.reconcile()).toMatchObject({ row: 'W-14', status: 'reconciled' });
    expect(await viewOf(fx)).toMatchObject({ status: 'unknown', reason: 'kernel_unreadable' });

    // The Kernel is readable again; the old process's late result ends its Turn.
    release.resolve();
    await running;

    fx.setNow('2026-09-26T04:00:00.000Z');
    const second = await restartHost(fx, BE2_HOST_2, controls).reconcile();
    expect(second).toMatchObject({ row: 'W-15', status: 'reconciled' });
    const counted = await viewOf(fx);
    expect(counted).toMatchObject({
      status: 'counted', recordedBy: 'run_end', error: false,
      totals: { steps: 1, edits: 0, editsUnknown: 0 }, countedThroughTurnEnd: true, unresolvedCalls: 0,
      recordedAt: '2026-09-26T04:00:00.000Z',
    });

    // The automatic backfill of the same start runs after the reconcile and does
    // not touch the record it just booked. Advance the clock past the Run's
    // `endedAt` (the 04:00 reconcile commit) so the Run really sits inside
    // `[now − 14d, now)`: the ordered read uses an exclusive `endedAt < to`, and
    // at `now === endedAt` the Run would be filtered out by the window bound
    // before the candidate rule applied (a vacuous "not processed"). With it
    // inside the window it is skipped as a current-rule `counted` record
    // (L4 row 4 / L8), which is what this assertion pins.
    const backfill = backfillOn(fx, { now: () => '2026-09-26T05:00:00.000Z' });
    const batch = await backfill.backfillRecentActivity(fx.ctx, { workspace: fx.scope, cursor: null });
    expect(batch.status).toBe('ready');
    if (batch.status !== 'ready') return;
    expect(batch.value.processed.find(entry => entry.kind === 'run' && entry.runRef.runId === fx.claim.runRef.runId)).toBeUndefined();

    // No new evidence: the record is unchanged.
    expect(await restartHost(fx, BE2_HOST_3, controls).reconcile()).toMatchObject({ status: 'left' });
    expect((await viewOf(fx)).recordedAt).toBe('2026-09-26T04:00:00.000Z');
  } finally {
    release.resolve();
    await running.catch(() => undefined);
  }
}, 60_000);

it('2B-14 (b) (RUN-21 at a restart): a counted-but-incomplete RUN-20(i) is not replaced by a human backfill, then is completed by the next start', async () => {
  const { fx, controls, running, release } = await inFlightRun('b');
  try {
    fx.setNow('2026-09-26T03:00:00.000Z');
    const first = await restartHost(fx, BE2_HOST_2, controls).reconcile();
    expect(first).toMatchObject({ row: 'W-13', status: 'reconciled' });
    const incomplete = await viewOf(fx);
    expect(incomplete).toMatchObject({
      status: 'counted', recordedBy: 'run_end', totals: { steps: 1, edits: 0, editsUnknown: 0 },
      countedThroughTurnEnd: false, unresolvedCalls: 1, recordedAt: '2026-09-26T03:00:00.000Z',
    });

    release.resolve();
    await running;

    // A human range backfill covering the Run writes nothing: backfill never
    // replaces a current-rule `counted`.
    const backfill = backfillOn(fx, { now: () => '2026-09-26T04:00:00.000Z' });
    const batch = await backfill.backfillActivityRange(humanCtx(fx), {
      workspace: fx.scope, from: '2026-09-26T00:00:00.000Z', to: '2026-09-27T00:00:00.000Z', cursor: null,
    });
    expect(batch.status).toBe('ready');
    if (batch.status !== 'ready') return;
    expect(batch.value.processed).toEqual([]);
    const stillIncomplete = await viewOf(fx);
    expect(stillIncomplete.recordedAt).toBe('2026-09-26T03:00:00.000Z');
    expect(stillIncomplete.countedThroughTurnEnd).toBe(false);

    // The next start's reconcile books the late terminal (RUN-21) in the same commit.
    fx.setNow('2026-09-26T05:00:00.000Z');
    const second = await restartHost(fx, BE2_HOST_2, controls).reconcile();
    expect(second).toMatchObject({ row: 'W-15', status: 'reconciled' });
    const complete = await viewOf(fx);
    expect(complete).toMatchObject({
      status: 'counted', recordedBy: 'run_end', error: false, totals: { steps: 1, edits: 0, editsUnknown: 0 },
      countedThroughTurnEnd: true, unresolvedCalls: 0, recordedAt: '2026-09-26T05:00:00.000Z',
    });
    expect(complete.recordedAt).not.toBe(incomplete.recordedAt);

    // No new evidence: the record is unchanged.
    expect(await restartHost(fx, BE2_HOST_3, controls).reconcile()).toMatchObject({ status: 'left' });
    expect((await viewOf(fx)).recordedAt).toBe('2026-09-26T05:00:00.000Z');
  } finally {
    release.resolve();
    await running.catch(() => undefined);
  }
}, 60_000);

it('2B-14 (c) (RUN-22): a human attestation of an unknown end leaves the tally unchanged', async () => {
  const { fx, controls, running, release } = await inFlightRun('c');
  try {
    fx.setNow('2026-09-26T03:00:00.000Z');
    expect(await restartHost(fx, BE2_HOST_2, controls).reconcile()).toMatchObject({ row: 'W-13', status: 'reconciled' });
    const before = await viewOf(fx);
    expect(before).toMatchObject({ status: 'counted', recordedAt: '2026-09-26T03:00:00.000Z' });

    fx.setNow('2026-09-26T03:30:00.000Z');
    // K3 (lead §5.3): the Run went RUN-20(i) with one unresolved call, so the
    // review draft is read through the same path as the Host entry (no lookup,
    // no capture wired -> workspace not_configured) and passed as `review`.
    const restarted = restartHost(fx, BE2_HOST_2, controls);
    const runRead = await restarted.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
    if (runRead.status !== 'ready') throw new Error(`the Run must be readable: ${JSON.stringify(runRead)}`);
    const auth = runRead.value.run.executionAuthorization;
    const kernel = auth !== undefined && 'schemaVersion' in auth && auth.schemaVersion === 2 ? auth.kernel : null;
    if (kernel === null) throw new Error('2B-14 (c) needs a Kernel binding');
    const draft = await readReviewDraftAtEntry({ owner: restarted.classifier.owner }, fx.ctx, { record: runRead.value,
      kernel, startPosition: runRead.value.run.executionHistory?.startPosition ?? null });
    if (!draft.ok) throw new Error(`the review draft must be readable: ${JSON.stringify(draft.rejection)}`);
    const attached = await restarted.deps.runReconcile!.resolveUnknownRun(fx.ctx, {
      input: { runRef: fx.claim.runRef, reason: 'S2B 2B-14c: a person checked the workspace by hand',
        kernelTurnOpen: draft.kernelTurnOpen, inputsConfirmed: draft.inputsConfirmed, review: draft.draft },
      meta: { requestId: 's2b-14c-attest', expected: [await currentPin(fx)] },
    });
    expect(attached).toMatchObject({ status: 'committed', value: { status: 'ended', outcome: 'crashed' } });

    const after = await viewOf(fx);
    expect(after.recordedAt).toBe(before.recordedAt);
    expect(after.totals).toEqual(before.totals);
    expect(after.status).toBe('counted');
  } finally {
    release.resolve();
    await running.catch(() => undefined);
  }
}, 60_000);
