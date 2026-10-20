/**
 * Slice 2B round-2 R1 (review item 1): backfill request ids must not collide
 * across Host lifetimes.
 *
 * The Workflow backfill is the entry point; the WorkGraph `RunActivityPort` is
 * the real `createRunActivityService` over a memory RecordStore; the Runtime
 * `countRunActivity` read side is a small scripted double (first call answers
 * `unknown('kernel_unreadable')`, later calls answer `counted`).
 *
 * Two separate `createActivityBackfill` instances model two Host lifetimes over
 * the SAME store. Once the first lifetime's write has committed, the second
 * lifetime's different facts must commit too, not fail with
 * `idempotency_conflict`; the read side (`readRunActivities`) proves it.
 *
 * Assertions only through the Workflow return and the public
 * `readRunActivities`; expected values are literal.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { RuntimeExecutionPort } from '../../src/core/agent-runtime/ports.js';
import type { RunActivityRead } from '../../src/core/agent-runtime/run-activity-reader.js';
import { unknownFacts } from '../../src/core/agent-runtime/run-activity-reader.js';
import { createActivityBackfill } from '../../src/business/workflow/activity-backfill.js';
import {
  countedFacts, openS2BActivityFixture, WORK_TASK_IDS, type S2BActivityFixture,
} from '../helpers/S2B-activity-fixture.js';
import { viewOf } from '../helpers/S2B-activity-fixture.js';

const DAY = 86_400_000;
const T0 = Date.parse('2026-10-20T00:00:00.000Z');
const at = (offsetDays: number): string => new Date(T0 + offsetDays * DAY).toISOString();

type CountOutcome = RunActivityRead | { kind: 'not_entered' };

/** A scripted Runtime `countRunActivity`: the first answer is `unknown`, then `counted`. */
function scriptedCounter(): { countRunActivity: NonNullable<RuntimeExecutionPort['countRunActivity']> } {
  let calls = 0;
  const countRunActivity: NonNullable<RuntimeExecutionPort['countRunActivity']> = async (_ctx, input) => {
    calls += 1;
    if (calls === 1) {
      return { status: 'ready', value: { kind: 'facts',
        facts: unknownFacts('kernel_unreadable', 'the first Host lifetime could not read the Kernel') } };
    }
    return { status: 'ready', value: { kind: 'facts', facts: countedFacts({
      turnStartedAt: at(-2), lastRecordAt: at(-2), kernelRunId: input.runRef.runId, throughPosition: 5,
    }) } };
  };
  return { countRunActivity };
}


let fixture: S2BActivityFixture | null = null;
afterEach(async () => { await fixture?.close(); fixture = null; });

async function newSession(f: S2BActivityFixture, suffix: string): Promise<SessionRef> {
  return await f.b2.base.createSession(`s2b-r1-session-${suffix}`);
}

describe('S2B round 2 R1 — backfill request identity across Host lifetimes', () => {
  it('R1 a second backfill instance with different facts commits instead of colliding on the request id', async () => {
    fixture = await openS2BActivityFixture('memory');
    const f = fixture;
    const run = await f.runAndEnd(WORK_TASK_IDS[0], await newSession(f, 'a'), at(-2.1), at(-2));
    await f.ensureRecording(at(0));

    const counter = scriptedCounter();
    const activity = { listActivityBackfillCandidates: f.activity.listActivityBackfillCandidates.bind(f.activity),
      recordRunActivity: f.activity.recordRunActivity.bind(f.activity) };
    // Host lifetime 1: the first tally read fails; an `unknown` record is written.
    const firstHost = createActivityBackfill({ runtime: { countRunActivity: counter.countRunActivity },
      activity, now: () => at(0) });
    const firstBatch = await firstHost.backfillRecentActivity(f.ctx, { workspace: f.b2.base.scope, cursor: null });
    expect(firstBatch.status).toBe('ready');
    if (firstBatch.status !== 'ready') return;
    expect(firstBatch.value.processed).toEqual([{ runRef: run, outcome: 'unknown', reason: 'kernel_unreadable' }]);
    expect(viewOf(await f.readRuns([run]), run.runId)).toMatchObject({
      status: 'unknown', reason: 'kernel_unreadable', recordedBy: 'backfill',
    });

    // Host lifetime 2: a fresh instance over the SAME store; the Kernel is now
    // readable, so the facts differ. The cursor of the candidate read moved with
    // the first commit, so this is a different submission identity.
    const secondHost = createActivityBackfill({ runtime: { countRunActivity: counter.countRunActivity },
      activity, now: () => at(0) });
    const secondBatch = await secondHost.backfillRecentActivity(f.ctx, { workspace: f.b2.base.scope, cursor: null });
    expect(secondBatch.status).toBe('ready');
    if (secondBatch.status !== 'ready') return;
    expect(secondBatch.value.processed).toEqual([{ runRef: run, outcome: 'counted', reason: null }]);
    expect(viewOf(await f.readRuns([run]), run.runId)).toMatchObject({
      status: 'counted', recordedBy: 'backfill', totals: { steps: 0, edits: 0, editsUnknown: 0 },
    });
  });
});
