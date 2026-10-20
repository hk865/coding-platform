/**
 * Slice 2B BE3 (Group B): the Host half of the backfill.
 *
 * What this file builds and through which public calls:
 *   - a real SQLite RecordStore through `openS2BActivityFixture`
 *     (`createB2ExecutionFixture`): real Goals/Plans/Sessions and real
 *     `ExecutionEntryPort` entries/ends, with NO `RunActivity` for the Runs;
 *   - the workspace `ActivityRecording` and the automatic recent backfill only
 *     through `createLocalWorkbenchHost`'s own start-up;
 *   - assertions only through `host.reconcile` (the public Host return) and the
 *     public `readActivityCalendar`/`readRunActivities` reads over a secondary
 *     connection.
 *
 * The synthetic Runs have a Kernel Session header but no Kernel records, so the
 * real `countRunActivity` writes an explicit `unknown` (never a silent 0). The
 * `counted` values of 2B-16/2B-18/2B-19 are covered by
 * `tests/app/S2B-backfill-workflow.test.ts` with a scripted tally; this file
 * proves the Host writes the epoch, runs the automatic window, and writes
 * nothing without the instance lease.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { RecordOrderedLookupPort } from '../../src/core/record-store/lookup-ports.js';
import { createActivityReadModel } from '../../src/core/work-graph/views/activity-read-model.js';
import { createLocalWorkbenchHost } from '../../src/app/host.js';
import { acquireHostInstanceLease } from '../../src/app/host-instance-lease.js';
import { openS2BActivityFixture, resetActivityBackfillGate, WORK_TASK_IDS, type S2BActivityFixture } from '../helpers/S2B-activity-fixture.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';

vi.mock('../../src/business/workflow/activity-backfill.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { activityBackfillGateModule } = await import('../helpers/S2B-activity-fixture.js');
  return activityBackfillGateModule(actual);
});

const DAY = 86_400_000;
const T0 = Date.parse('2026-10-20T00:00:00.000Z');
const at = (offsetDays: number): string => new Date(T0 + offsetDays * DAY).toISOString();

let fixture: S2BActivityFixture | null = null;
let host: Awaited<ReturnType<typeof createLocalWorkbenchHost>> | null = null;
let secondary: Awaited<ReturnType<S2BActivityFixture['b2']['base']['reopenService']>> | null = null;

afterEach(async () => {
  await host?.close().catch(() => undefined);
  await secondary?.close().catch(() => undefined);
  await fixture?.close().catch(() => undefined);
  host = null; secondary = null; fixture = null;
});

async function newSession(f: S2BActivityFixture, suffix: string): Promise<SessionRef> {
  return await f.b2.base.createSession(`s2b-host-session-${suffix}`);
}

type Reads = Pick<ReturnType<typeof createActivityReadModel>, 'readRunActivities' | 'readActivityCalendar'>;

function readModelOver(records: unknown, now: () => string): Reads {
  return createActivityReadModel({ records: records as never, now });
}

describe('S2B Group B — Host backfill wiring (BE3)', () => {
  it('2B-16 the leased Host records the epoch before reconcile and auto-backfills only the last 14 days', async () => {
    fixture = await openS2BActivityFixture('sqlite');
    const f = fixture;
    const r2 = await f.runAndEnd(WORK_TASK_IDS[0], await newSession(f, 'h16a'), at(-2.1), at(-2));
    const r13 = await f.runAndEnd(WORK_TASK_IDS[1], await newSession(f, 'h16b'), at(-13.1), at(-13));
    const r15 = await f.runAndEnd(WORK_TASK_IDS[2], await newSession(f, 'h16c'), at(-15.1), at(-15));
    const r30 = await f.runAndEnd(WORK_TASK_IDS[3], await newSession(f, 'h16d'), at(-30.1), at(-30));
    const directory = f.b2.base.directory;
    await f.b2.base.closeBackend();

    const scope: WorkspaceScope = { projectId: f.b2.base.scope.projectId, workspaceId: f.b2.base.scope.workspaceId };
    let now = at(0);
    const backfillCompleted = resetActivityBackfillGate();
    host = await createLocalWorkbenchHost({
      storage: { kind: 'sqlite', directory },
      actor: { kind: 'human', id: 's2b-host-operator' },
      workspaces: [{ scope, name: 'S2B backfill host', root: directory, workspaceRevision: 1, readPrefixes: ['.'] }],
      kernelStores: { entries: [{ adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store',
        workspace: scope, databasePath: join(directory, 'kernel.sqlite') }] },
      now: () => now,
    });
    secondary = await f.b2.base.reopenService();
    const reads = readModelOver(secondary.records as unknown as RecordOrderedLookupPort, () => now);

    // The epoch is written by the leased Host itself (not by the fixture).
    const calendar = await reads.readActivityCalendar(f.ctx, {
      goalRef: f.goalRef, from: at(-1), to: at(1), granularity: 'hour', timeZone: 'UTC',
    });
    expect(calendar.status).toBe('ready');
    if (calendar.status !== 'ready') return;
    expect(calendar.value.recordingSince).toBe(at(0));

    // The background automatic backfill turns the two in-range Runs into explicit
    // records; the two older Runs stay `not_backfilled`.
    await backfillCompleted;
    const after = await reads.readRunActivities(f.ctx, { runRefs: [r2, r13, r15, r30] });
    expect(after.status).toBe('ready');
    if (after.status !== 'ready') return;
    const byId = new Map(after.value.map(view => [(view.runRef as RunRef).runId, view]));
    for (const runId of [r2.runId, r13.runId]) {
      const view = byId.get(runId)!;
      expect(view.recordedBy, runId).toBe('backfill');
      expect(view.status, runId).toBe('unknown');
      expect(view.totals, runId).toBeNull();
    }
    for (const runId of [r15.runId, r30.runId]) {
      expect(byId.get(runId), runId).toMatchObject({ status: 'unknown', reason: 'not_backfilled', recordedBy: null });
    }

    // A second start writes no recording again and no more activity.
    const recordedAt = byId.get(r2.runId)!.recordedAt;
    now = at(0.5);
    await host.close();
    host = await createLocalWorkbenchHost({
      storage: { kind: 'sqlite', directory },
      actor: { kind: 'human', id: 's2b-host-operator' },
      workspaces: [{ scope, name: 'S2B backfill host', root: directory, workspaceRevision: 1, readPrefixes: ['.'] }],
      kernelStores: { entries: [{ adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store',
        workspace: scope, databasePath: join(directory, 'kernel.sqlite') }] },
      now: () => now,
    });
    const reread = await reads.readRunActivities(f.ctx, { runRefs: [r2] });
    expect(reread.status).toBe('ready');
    if (reread.status !== 'ready') return;
    expect(reread.value[0]!.recordedAt).toBe(recordedAt);
  }, 60_000);

  it('2B-20 a Host without the instance lease writes no recording and no backfill', async () => {
    fixture = await openS2BActivityFixture('sqlite');
    const f = fixture;
    const missed = await f.runAndEnd(WORK_TASK_IDS[0], await newSession(f, 'h20a'), at(-1.1), at(-1));
    const directory = f.b2.base.directory;
    await f.b2.base.closeBackend();
    // A live peer holds the local lock: this Host serves reads and owner writes only.
    await acquireHostInstanceLease({ directory, now: () => at(0) });

    const scope: WorkspaceScope = { projectId: f.b2.base.scope.projectId, workspaceId: f.b2.base.scope.workspaceId };
    host = await createLocalWorkbenchHost({
      storage: { kind: 'sqlite', directory },
      actor: { kind: 'human', id: 's2b-host-operator' },
      workspaces: [{ scope, name: 'S2B no-lease host', root: directory, workspaceRevision: 1, readPrefixes: ['.'] }],
      kernelStores: { entries: [{ adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store',
        workspace: scope, databasePath: join(directory, 'kernel.sqlite') }] },
      now: () => at(0),
    });
    expect(host.reconcile.lease).toBe('held_by_other');
    secondary = await f.b2.base.reopenService();
    const reads = readModelOver(secondary.records as unknown as RecordOrderedLookupPort, () => at(0));

    const calendar = await reads.readActivityCalendar(f.ctx, {
      goalRef: f.goalRef, from: at(-2), to: at(1), granularity: 'hour', timeZone: 'UTC',
    });
    expect(calendar.status).toBe('ready');
    if (calendar.status !== 'ready') return;
    expect(calendar.value.recordingSince).toBeNull();
    const read = await reads.readRunActivities(f.ctx, { runRefs: [missed] });
    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.value[0]).toMatchObject({ status: 'unknown', reason: 'no_recording_epoch', recordedBy: null });
  }, 60_000);
});
