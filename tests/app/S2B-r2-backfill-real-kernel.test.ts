/**
 * Slice 2B round-2 Group B (R11): 2B-16 and 2B-17 through the Host/Workflow with
 * REAL Kernel history and the test-only "counting off" module double (spec
 * §7/F34), not a scripted `countRunActivity`.
 *
 * What it builds and through which public calls:
 *   - real SQLite Runs with real position records and real Kernel Turns through
 *     `S2B-r2-backfill-kernel-support.ts` (`createS2BRuntimeStoreFixture`, real
 *     `RuntimeExecutionPort`), driven while the counting-off double makes their
 *     end commits carry no `activity` (spec §7: "旧执行" and "开始记录以后缺计数");
 *   - the epoch + automatic 14-day backfill through the real app Host
 *     (`createLocalWorkbenchHost`), which writes the epoch and runs the
 *     `Workflow.backfillRecentActivity` loop against the real Kernel;
 *   - the human range batches through the SAME leased Host's real
 *     `activity/backfill` HTTP route (the Workflow binding the Host publishes),
 *     over the real Runtime `countRunActivity`;
 *   - assertions only through the public `readRunActivities` and the route's
 *     batch return; every step count is a hand-computed literal.
 *
 * No real model, no network. Runs are read-only Scripted Kernel turns.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { LocalWorkbenchHost } from '../../src/app/host.js';
import { CORE_API_PREFIX, PLATFORM_TOKEN_HEADER } from '../../src/app/core-http-types.js';
import {
  openKernelBackfillRuns, startKernelBackfillHost, type KernelBackfillFixture,
} from '../helpers/S2B-r2-backfill-kernel-support.js';
import { resetActivityBackfillGate, viewOf } from '../helpers/S2B-activity-fixture.js';
import { readPageToken } from '../helpers/AG2b-collaboration-fixture.js';

/** §7 counting-off double: while `off`, end commits carry no `activity` and the reader retries. */
const countingOff = vi.hoisted(() => ({ off: false }));
vi.mock('../../src/core/agent-runtime/run-activity-tally.js', async (importOriginal) => {
  const { countingOffTallyModule } = await import('../helpers/S2B-counting-off-support.js');
  return countingOffTallyModule(await importOriginal<Record<string, unknown>>(), countingOff);
});
vi.mock('../../src/core/agent-runtime/run-activity-reader.js', async (importOriginal) => {
  const { countingOffReaderModule } = await import('../helpers/S2B-counting-off-support.js');
  return countingOffReaderModule(await importOriginal<Record<string, unknown>>(), countingOff);
});
vi.mock('../../src/business/workflow/activity-backfill.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { activityBackfillGateModule } = await import('../helpers/S2B-activity-fixture.js');
  return activityBackfillGateModule(actual);
});

const DAY = 86_400_000;
const T0 = Date.parse('2026-10-20T00:00:00.000Z');
const at = (offsetDays: number): string => new Date(T0 + offsetDays * DAY).toISOString();

let fixture: KernelBackfillFixture | null = null;
let host: LocalWorkbenchHost | null = null;
afterEach(async () => {
  countingOff.off = false;
  await host?.close().catch(() => undefined);
  await fixture?.fx.close().catch(() => undefined);
  host = null; fixture = null;
});

/** POST one `activity/backfill` request to the leased Host and return its body. */
async function postActivityBackfill(
  base: string, token: string, scope: WorkspaceScope,
  input: { from: string; to: string; cursor: string | null; workspace: WorkspaceScope },
): Promise<unknown> {
  const response = await fetch(new URL(`${CORE_API_PREFIX}activity/backfill`, base).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', [PLATFORM_TOKEN_HEADER]: token },
    body: JSON.stringify({ scope, input }),
  });
  return await response.json();
}

describe('S2B round-2 Group B — real Kernel history backfill (BE3)', () => {
  it('2B-16 the leased app Host writes the epoch and auto-backfills real Kernel Runs only in [now-14d, now)', async () => {
    countingOff.off = true;
    fixture = await openKernelBackfillRuns([{ at: at(-2), calls: 3 }, { at: at(-15), calls: 2 }]);
    const f = fixture;
    const recent = f.runs[0]!;
    const old = f.runs[1]!;
    // Counting off: the Runs ended with no `RunActivity` (no epoch yet).
    const before = await f.reads().readRunActivities(f.fx.ctx, { runRefs: [recent.ref, old.ref] });
    expect(before.status).toBe('ready');
    if (before.status !== 'ready') return;
    expect(before.value.map((view) => view.status)).toEqual(['unknown', 'unknown']);

    countingOff.off = false;
    const backfillCompleted = resetActivityBackfillGate();
    host = await startKernelBackfillHost(f, () => at(0));
    expect(host.reconcile.lease).toBe('owned');

    await backfillCompleted;

    const after = await f.reads().readRunActivities(f.fx.ctx, { runRefs: [recent.ref, old.ref] });
    expect(after.status).toBe('ready');
    if (after.status !== 'ready') return;
    // Hand-computed: 3 real `read` calls -> steps 3, edits 0, the end commit was
    // the recording epoch's start, so this is not a late record.
    expect(viewOf(after, recent.ref.runId)).toMatchObject({
      status: 'counted', reason: null, error: false, recordedBy: 'backfill',
      totals: { steps: 3, edits: 0, editsUnknown: 0 },
      countedThroughTurnEnd: true, unresolvedCalls: 0,
    });
    // The -15d Run is outside the automatic window and stays unbackfilled.
    expect(viewOf(after, old.ref.runId)).toMatchObject({
      status: 'unknown', reason: 'not_backfilled', error: false, recordedBy: null,
    });

    // No model call after the Host started: the backfill reads the Kernel only.
    expect(f.fx.scripted.calls()).toBe(4);
  }, 120_000);

  it('2B-17 the leased Host human range route backfills real Kernel Runs and a re-run writes nothing', async () => {
    countingOff.off = true;
    fixture = await openKernelBackfillRuns([{ at: at(-20), calls: 3 }, { at: at(-25), calls: 2 }]);
    const f = fixture;
    const older = f.runs[0]!;
    const oldest = f.runs[1]!;
    countingOff.off = false;
    // The leased Host itself writes the epoch at start-up; the test never writes it.
    host = await startKernelBackfillHost(f, () => at(0));
    expect(host.reconcile.lease).toBe('owned');
    // The Host-written epoch makes these two ended Runs read `not_backfilled`
    // (before it they would read `no_recording_epoch`).
    const beforeRange = await f.reads().readRunActivities(f.fx.ctx, { runRefs: [older.ref, oldest.ref] });
    expect(beforeRange.status).toBe('ready');
    if (beforeRange.status !== 'ready') return;
    expect(beforeRange.value.map((view) => view.reason)).toEqual(['not_backfilled', 'not_backfilled']);

    const address = await host.listen(0);
    const token = await readPageToken(address.url);
    const fullRange = { workspace: f.scope, from: at(-40), to: at(0) };

    // The real `activity/backfill` route. The Host's production batch size is 5,
    // so each call is bounded to one Run's ended window to keep this one Run per
    // route call (the cursor flow itself stays pinned by the round-1
    // supplementary `S2B-backfill-workflow.test.ts` 2B-17). The scan runs
    // newest-ended first.
    const first = await postActivityBackfill(address.url, token, f.scope,
      { ...fullRange, from: at(-21), to: at(0), cursor: null });
    expect(first).toMatchObject({ status: 'ready', value: {
      processed: [{ runRef: older.ref, outcome: 'counted', reason: null }],
      next: null, done: true,
    } });
    expect(viewOf(await f.reads().readRunActivities(f.fx.ctx, { runRefs: [oldest.ref] }), oldest.ref.runId))
      .toMatchObject({ status: 'unknown', reason: 'not_backfilled' });

    const second = await postActivityBackfill(address.url, token, f.scope,
      { ...fullRange, from: at(-40), to: at(-21), cursor: null });
    expect(second).toMatchObject({ status: 'ready', value: {
      processed: [{ runRef: oldest.ref, outcome: 'counted', reason: null }],
      next: null, done: true,
    } });

    const counted = await f.reads().readRunActivities(f.fx.ctx, { runRefs: [older.ref, oldest.ref] });
    expect(counted.status).toBe('ready');
    if (counted.status !== 'ready') return;
    expect(viewOf(counted, older.ref.runId)).toMatchObject({
      status: 'counted', reason: null, recordedBy: 'backfill',
      totals: { steps: 3, edits: 0, editsUnknown: 0 },
    });
    expect(viewOf(counted, oldest.ref.runId)).toMatchObject({
      status: 'counted', reason: null, recordedBy: 'backfill',
      totals: { steps: 2, edits: 0, editsUnknown: 0 },
    });
    const beforeRerun = [viewOf(counted, older.ref.runId).recordedAt, viewOf(counted, oldest.ref.runId).recordedAt];

    // Re-running the whole range through the route finds no candidates (L8: the
    // records are progress).
    const rerun = await postActivityBackfill(address.url, token, f.scope, { ...fullRange, cursor: null });
    expect(rerun).toMatchObject({ status: 'ready', value: { processed: [], next: null, done: true } });
    const afterRerun = await f.reads().readRunActivities(f.fx.ctx, { runRefs: [older.ref, oldest.ref] });
    expect(afterRerun.status).toBe('ready');
    if (afterRerun.status !== 'ready') return;
    expect([viewOf(afterRerun, older.ref.runId).recordedAt, viewOf(afterRerun, oldest.ref.runId).recordedAt])
      .toEqual(beforeRerun);
  }, 120_000);
});
