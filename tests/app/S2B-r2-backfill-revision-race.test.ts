/**
 * Slice 2B round-2 R13 (review item 13): the backfill must carry the revision of
 * the record it selected through its write.
 *
 * If another writer (a RUN-21 end commit or a direct `recordRunActivity`)
 * advances the `RunActivity` after candidate selection but before the backfill's
 * write, the write must report `skipped`/`record_changed` (L8), not `unchanged`.
 * An ordinary retry whose facts do not change and whose revision did not move
 * still reports `unchanged` (L4 rows 4/7).
 *
 * Fixture: `openS2BActivityFixture` (memory) with the real
 * `createRunActivityService`; the Runtime `countRunActivity` double performs
 * the intervening real write. Assertions go through the Workflow return and the
 * public `readRunActivities`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RuntimeExecutionPort } from '../../src/core/agent-runtime/ports.js';
import { unknownFacts } from '../../src/core/agent-runtime/run-activity-reader.js';
import { createActivityBackfill } from '../../src/business/workflow/activity-backfill.js';
import {
  countedFacts, openS2BActivityFixture, WORK_TASK_IDS, type S2BActivityFixture,
} from '../helpers/S2B-activity-fixture.js';
import { viewOf } from '../helpers/S2B-activity-fixture.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';

const DAY = 86_400_000;
const T0 = Date.parse('2026-10-20T00:00:00.000Z');
const at = (offsetDays: number): string => new Date(T0 + offsetDays * DAY).toISOString();


let fixture: S2BActivityFixture | null = null;
afterEach(async () => { await fixture?.close(); fixture = null; });

async function newSession(f: S2BActivityFixture, suffix: string): Promise<SessionRef> {
  return await f.b2.base.createSession(`s2b-r13-session-${suffix}`);
}

function backfillOver(f: S2BActivityFixture, countRunActivity: NonNullable<RuntimeExecutionPort['countRunActivity']>) {
  return createActivityBackfill({
    runtime: { countRunActivity },
    activity: { listActivityBackfillCandidates: f.activity.listActivityBackfillCandidates.bind(f.activity),
      recordRunActivity: f.activity.recordRunActivity.bind(f.activity) },
    now: () => at(0),
  });
}

describe('S2B round 2 R13 — the selected RunActivity revision rides the write', () => {
  it('R13 a write that lands after selection makes the backfill report skipped/record_changed', async () => {
    fixture = await openS2BActivityFixture('memory');
    const f = fixture;
    const run = await f.runAndEnd(WORK_TASK_IDS[0], await newSession(f, 'race'), at(-2.1), at(-2));
    await f.ensureRecording(at(0));
    // Revision 1: a retryable unknown, so the Run is a candidate.
    await f.writeActivity(run, unknownFacts('kernel_unreadable', 'the first read failed'));

    // The Runtime double performs the intervening real write (revision 2) before
    // it answers; the backfill's own write still carries the selected revision 1.
    let advanced = false;
    const countRunActivity: NonNullable<RuntimeExecutionPort['countRunActivity']> = async (_ctx, input) => {
      if (!advanced) {
        advanced = true;
        await f.writeActivity(input.runRef, countedFacts({
          turnStartedAt: at(-2), lastRecordAt: at(-2), kernelRunId: input.runRef.runId, throughPosition: 6,
        }));
      }
      return { status: 'ready', value: { kind: 'facts', facts: countedFacts({
        turnStartedAt: at(-2), lastRecordAt: at(-2), kernelRunId: input.runRef.runId, throughPosition: 7,
      }) } };
    };

    const batch = await backfillOver(f, countRunActivity).backfillRecentActivity(f.ctx, {
      workspace: f.b2.base.scope, cursor: null,
    });
    expect(batch.status).toBe('ready');
    if (batch.status !== 'ready') return;
    expect(batch.value.processed).toEqual([{ runRef: run, outcome: 'skipped', reason: 'record_changed' }]);
    // The intervening write is the surviving record.
    expect(viewOf(await f.readRuns([run]), run.runId)).toMatchObject({
      status: 'counted', recordedBy: 'backfill',
    });
  });

  it('R13 a retry whose revision did not move and whose facts did not change reports unchanged', async () => {
    fixture = await openS2BActivityFixture('memory');
    const f = fixture;
    const run = await f.runAndEnd(WORK_TASK_IDS[1], await newSession(f, 'same'), at(-2.1), at(-2));
    await f.ensureRecording(at(0));
    await f.writeActivity(run, unknownFacts('kernel_unreadable', 'the Kernel is still unreadable'));
    const recordedAt = viewOf(await f.readRuns([run]), run.runId).recordedAt;

    const countRunActivity: NonNullable<RuntimeExecutionPort['countRunActivity']> = async () => ({
      status: 'ready', value: { kind: 'facts',
        facts: unknownFacts('kernel_unreadable', 'the Kernel is still unreadable') },
    });
    const batch = await backfillOver(f, countRunActivity).backfillRecentActivity(f.ctx, {
      workspace: f.b2.base.scope, cursor: null,
    });
    expect(batch.status).toBe('ready');
    if (batch.status !== 'ready') return;
    expect(batch.value.processed).toEqual([{ runRef: run, outcome: 'unchanged', reason: null }]);
    expect(viewOf(await f.readRuns([run]), run.runId).recordedAt).toBe(recordedAt);
  });
});
