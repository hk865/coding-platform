/**
 * Slice 2B round-2 R9 (review item 9): the backfill must not report `done` while
 * candidates remain after its read cap.
 *
 * A long stretch of already-counted Runs sits between the first processed
 * candidate and the (oldest) missing Run. The injected `readRecordCap` stops the
 * candidate scan with a continuation (`next`) before it reaches the missing Run,
 * so the batch-full exhaustion probe returns no candidates but a non-null
 * `next`. The first call must NOT be `done` and must point at that continuation;
 * the later call, using it, reaches the missing Run.
 *
 * Fixture: `openS2BActivityFixture` (memory) with the real
 * `createRunActivityService` (candidate scan + write); the Runtime
 * `countRunActivity` is a small scripted counter. Assertions go through the
 * Workflow return and the public `readRunActivities`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { RuntimeExecutionPort } from '../../src/core/agent-runtime/ports.js';
import { createRunActivityService } from '../../src/core/work-graph/tasks/run-activity-service.js';
import type { RunActivityViewV1 } from '../../src/core/work-graph/views/activity-read-model.js';
import { createActivityBackfill } from '../../src/business/workflow/activity-backfill.js';
import {
  countedFacts, openS2BActivityFixture, type S2BActivityFixture,
} from '../helpers/S2B-activity-fixture.js';

const T0 = Date.parse('2026-10-20T00:00:00.000Z');
const atMin = (minutes: number): string => new Date(T0 + minutes * 60_000).toISOString();
/** The index page is 100 records; 101 counted Runs force the scan past one page. */
const COUNTED_RUNS = 101;

function viewOf(read: ReadResult<RunActivityViewV1[]>, runId: string): RunActivityViewV1 {
  if (read.status !== 'ready') throw new Error(`the activity read was not ready: ${JSON.stringify(read)}`);
  const found = read.value.find(view => view.runRef.runId === runId);
  if (found === undefined) throw new Error(`no activity view for ${runId}`);
  return found;
}

let fixture: S2BActivityFixture | null = null;
afterEach(async () => { await fixture?.close(); fixture = null; });

/** A Run with no position record, no authorization and no `startedAt` (a §7 legacy shape). */
async function commitLegacyRun(f: S2BActivityFixture, runId: string, endedAt: string): Promise<RunRef> {
  const ref: RunRef = { aggregateType: 'Run', projectId: f.goalRef.projectId, goalId: f.goalRef.goalId, runId };
  const goalRead = await f.b2.base.plans.queryGoal(f.ctx, f.goalRef);
  if (goalRead.status !== 'ready' || goalRead.value.goal.activePlanRevision === null) {
    throw new Error('the S2B activity Goal has no accepted plan');
  }
  const snapshot = {
    ref, revision: 1, schemaVersion: 1,
    task: { projectId: ref.projectId, goalId: ref.goalId, taskId: 'work-1' }, attemptId: `attempt-${runId}`,
    planRef: goalRead.value.goal.activePlanRevision, roleBinding: f.b2.base.roleBinding, budget: f.b2.base.budget,
    workspaceSnapshot: { workspaceId: f.b2.base.scope.workspaceId, revision: 1 },
    status: 'ended', outcome: 'failed', exitCode: null, lastEventSeq: 0,
    lastRuntimeEventId: '', lastFactEventId: '', envelope: null, startedAt: null, endedAt,
  };
  const result = await f.b2.base.commitRaw([{
    refKey: canonicalJson(ref as unknown as JsonValue), schemaId: 'RunSnapshot@1', revision: 1,
    json: JSON.stringify(snapshot),
  }]);
  if (result.status !== 'committed') throw new Error(`the legacy Run seed failed: ${JSON.stringify(result)}`);
  return ref;
}

/** A scripted Runtime `countRunActivity` that always answers `counted`. */
function countedCounter(): NonNullable<RuntimeExecutionPort['countRunActivity']> {
  return async (_ctx, input) => ({ status: 'ready', value: { kind: 'facts', facts: countedFacts({
    turnStartedAt: atMin(-200), lastRecordAt: atMin(-200), kernelRunId: input.runRef.runId, throughPosition: 3,
  }) } });
}

describe('S2B round 2 R9 — the backfill keeps the scan continuation', () => {
  it('R9 the batch-full probe keeps a non-null continuation instead of declaring done', async () => {
    fixture = await openS2BActivityFixture('memory');
    const f = fixture;
    await f.ensureRecording(atMin(-1));

    // Newest candidate, then a long counted stretch, then the missing Run.
    const firstCandidate = await commitLegacyRun(f, 'r9-first-candidate', atMin(-60));
    for (let index = 0; index < COUNTED_RUNS; index += 1) {
      const endedAt = atMin(-61 - index);
      await f.seedLegacyActivity(`counted-${String(index)}`, endedAt, endedAt, countedFacts({
        turnStartedAt: endedAt, lastRecordAt: endedAt, throughPosition: 3,
      }));
    }
    const missing = await commitLegacyRun(f, 'r9-missing', atMin(-200));

    // A small read cap makes the candidate scan stop with a continuation.
    let seq = 0;
    const activity = createRunActivityService({ records: f.records, now: () => atMin(0),
      eventId: () => `s2b-r9-activity-event-${++seq}`, readRecordCap: 3 });
    const backfill = createActivityBackfill({
      runtime: { countRunActivity: countedCounter() }, activity, now: () => atMin(0), batchRuns: 1,
    });

    const first = await backfill.backfillRecentActivity(f.ctx, { workspace: f.b2.base.scope, cursor: null });
    expect(first.status).toBe('ready');
    if (first.status !== 'ready') return;
    expect(first.value.processed).toEqual([{ runRef: firstCandidate, outcome: 'counted', reason: null }]);
    expect(first.value.done).toBe(false);
    expect(first.value.next).not.toBeNull();

    const second = await backfill.backfillRecentActivity(f.ctx, { workspace: f.b2.base.scope, cursor: first.value.next });
    expect(second.status).toBe('ready');
    if (second.status !== 'ready') return;
    expect(second.value.processed).toEqual([{ runRef: missing, outcome: 'counted', reason: null }]);
    expect(second.value.done).toBe(true);
    expect(second.value.next).toBeNull();

    expect(viewOf(await f.readRuns([missing]), missing.runId)).toMatchObject({
      status: 'counted', recordedBy: 'backfill',
    });
  }, 60_000);
});
