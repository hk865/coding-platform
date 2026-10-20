/**
 * Slice 2B BE3 (Group B): the Workflow backfill at its own seam.
 *
 * What this file builds and through which public calls:
 *   - a real RecordStore (memory) through `openS2BActivityFixture`
 *     (`createB2ExecutionFixture`): real Goals/Plans/Sessions, real claims and
 *     real `ExecutionEntryPort` entries/ends;
 *   - `RunActivity` records only through the public `RunActivityPort`
 *     (`recordRunActivity`) and the Workflow backfill operation
 *     (`createActivityBackfill`);
 *   - the workspace `ActivityRecording` only through `ensureActivityRecording`;
 *   - assertions only through the public `readRunActivities`/
 *     `readActivityCalendar` reads of `createActivityReadModel`.
 *
 * The Runtime `countRunActivity` read side is a scripted seam here: the
 * Workflow's job is the candidate/range/cursor/write policy (L8), and the
 * Kernel-window behaviour is Group R's rows. No model is called.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../../src/contracts/core/results.js';
import type { RunActivityFactsV1 } from '../../src/contracts/run-activity.js';
import type { RuntimeExecutionPort } from '../../src/core/agent-runtime/ports.js';
import type { RunActivityRead } from '../../src/core/agent-runtime/run-activity-reader.js';
import { unknownFacts } from '../../src/core/agent-runtime/run-activity-reader.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createActivityBackfill } from '../../src/business/workflow/activity-backfill.js';
import {
  countedFacts, openS2BActivityFixture, viewOf, WORK_TASK_IDS, type S2BActivityFixture,
} from '../helpers/S2B-activity-fixture.js';

const DAY = 86_400_000;
const T0 = Date.parse('2026-10-20T00:00:00.000Z');
const at = (offsetDays: number): string => new Date(T0 + offsetDays * DAY).toISOString();

type CountOutcome = RunActivityRead | { kind: 'not_entered' };

/** A scripted Runtime `countRunActivity`; records every Run it is asked about. */
function scriptedCounter(initial: (runRef: RunRef) => CountOutcome | CoreRejection) {
  let handler = initial;
  const calls: RunRef[] = [];
  const countRunActivity: NonNullable<RuntimeExecutionPort['countRunActivity']> = async (_ctx, input) => {
    calls.push(input.runRef);
    const value = handler(input.runRef);
    if ('status' in value && value.status === 'rejected') return value;
    return { status: 'ready', value } as ReadResult<CountOutcome>;
  };
  return { countRunActivity, calls, set(fn: (runRef: RunRef) => CountOutcome | CoreRejection) { handler = fn; } };
}

const humanHost = (fixture: S2BActivityFixture): CoreCallContext => ({
  ...fixture.ctx, principal: { kind: 'host', actor: { kind: 'human', id: 's2b-operator' } },
});

let fixture: S2BActivityFixture | null = null;
afterEach(async () => { await fixture?.close(); fixture = null; });

/** A fresh real Session, so several Runs can occupy one at a time without conflict. */
async function newSession(f: S2BActivityFixture, suffix: string): Promise<SessionRef> {
  return await f.b2.base.createSession(`s2b-backfill-session-${suffix}`);
}

/** A Run with no position record, no authorization and no `startedAt` (a §7 legacy shape). */
async function commitLegacyRun(f: S2BActivityFixture, runId: string, endedAt: string,
  taskId: string = WORK_TASK_IDS[7]): Promise<RunRef> {
  const ref: RunRef = { aggregateType: 'Run', projectId: f.goalRef.projectId, goalId: f.goalRef.goalId, runId };
  const goalRead = await f.b2.base.plans.queryGoal(f.ctx, f.goalRef);
  if (goalRead.status !== 'ready' || goalRead.value.goal.activePlanRevision === null) {
    throw new Error('the S2B activity Goal has no accepted plan');
  }
  const snapshot = {
    ref, revision: 1, schemaVersion: 1,
    task: { projectId: ref.projectId, goalId: ref.goalId, taskId }, attemptId: `attempt-${runId}`,
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


/** One public `readExecution` snapshot, used to prove the backfill changed no Run or Task. */
async function executionOf(f: S2BActivityFixture, reader: ReturnType<typeof createRunStateReader>,
  runRef: RunRef): Promise<TaskExecutionRecord> {
  const read = await reader.readExecution(f.ctx, runRef);
  if (read.status !== 'ready') throw new Error(`the execution read was not ready: ${JSON.stringify(read)}`);
  return read.value;
}

/** The Run's state/results plus the claimed Task's state/results from its accepted Plan. */
function executionState(record: TaskExecutionRecord) {
  return { run: record.run, task: record.plan.tasks.find(candidate => candidate.taskId === record.run.task.taskId) };
}

describe('S2B Group B — Workflow backfill (BE3)', () => {
  it('2B-16 automatic backfill covers only [now-14d, now), leaves older Runs and writes no model call', async () => {
    fixture = await openS2BActivityFixture('memory');
    const f = fixture;
    // Four executions ended 2, 13, 15 and 30 days before the recording epoch.
    const r2 = await f.runAndEnd(WORK_TASK_IDS[0], await newSession(f, '16a'), at(-2.1), at(-2));
    const r13 = await f.runAndEnd(WORK_TASK_IDS[1], await newSession(f, '16b'), at(-13.1), at(-13));
    const r15 = await f.runAndEnd(WORK_TASK_IDS[2], await newSession(f, '16c'), at(-15.1), at(-15));
    const r30 = await f.runAndEnd(WORK_TASK_IDS[3], await newSession(f, '16d'), at(-30.1), at(-30));
    await f.ensureRecording(at(0));
    const runs = [r2, r13, r15, r30];
    // Capture each Run's and its Task's state/results through the public
    // `readExecution` before the backfill (L8/rule 4: counting changes neither).
    const executions = createRunStateReader({ records: f.b2.base.records });
    const beforeStates = new Map<string, ReturnType<typeof executionState>>();
    for (const ref of runs) {
      beforeStates.set(ref.runId, executionState(await executionOf(f, executions, ref)));
    }
    // The fixture's model port is the scripted provider seam: any model work for
    // this workspace must go through it. The backfill must call it ZERO times.
    const authorizeModel = vi.spyOn(f.b2.model, 'authorizeModelRequest');
    const recordModelAttempt = vi.spyOn(f.b2.model, 'recordModelRequestAttempt');

    const counter = scriptedCounter(runRef => ({ kind: 'facts', facts: countedFacts({
      turnStartedAt: at(-2), lastRecordAt: at(-2), quarters: [], throughPosition: 4,
    }) }));
    const backfill = createActivityBackfill({ runtime: { countRunActivity: counter.countRunActivity },
      activity: f.activity, now: () => at(0) });

    const batch = await backfill.backfillRecentActivity(f.ctx, { workspace: f.b2.base.scope, cursor: null });
    expect(batch.status).toBe('ready');
    if (batch.status !== 'ready') return;
    expect(batch.value.done).toBe(true);
    expect(batch.value.processed.map(entry => entry.runRef.runId)).toEqual([r2.runId, r13.runId]);
    expect(batch.value.processed.every(entry => entry.outcome === 'counted')).toBe(true);

    const after = await f.readRuns([r2, r13, r15, r30]);
    for (const runId of [r2.runId, r13.runId]) {
      const view = viewOf(after, runId);
      expect(view, runId).toMatchObject({ status: 'counted', reason: null, error: false, recordedBy: 'backfill' });
      expect(view.recordedAt).not.toBeNull();
    }
    for (const runId of [r15.runId, r30.runId]) {
      expect(viewOf(after, runId), runId).toMatchObject({ status: 'unknown', reason: 'not_backfilled', error: false });
    }
    // The Runs and Tasks are unchanged by the backfill (rule 4): re-read the
    // same public `readExecution` and compare the Run and claimed Task exactly.
    for (const ref of runs) {
      const afterState = executionState(await executionOf(f, executions, ref));
      expect(afterState, ref.runId).toEqual(beforeStates.get(ref.runId));
    }
    // The claim: the backfill wrote no model call, asserted through the fixture's
    // scripted model port with a literal 0.
    expect(authorizeModel, 'the backfill authorizes no model request').toHaveBeenCalledTimes(0);
    expect(recordModelAttempt, 'the backfill records no model attempt').toHaveBeenCalledTimes(0);
    // A restart re-runs the recent batch: the two recorded Runs are no longer
    // candidates, the two old ones are out of range, nothing is written.
    const first = viewOf(after, r2.runId).recordedAt;
    const second = await backfill.backfillRecentActivity(f.ctx, { workspace: f.b2.base.scope, cursor: null });
    expect(second.status).toBe('ready');
    if (second.status !== 'ready') return;
    expect(second.value.processed).toEqual([]);
    expect(second.value.done).toBe(true);
    expect(viewOf(await f.readRuns([r2, r13]), r2.runId).recordedAt).toBe(first);
  });

  it('2B-17 the human range backfill batches with a cursor, resumes, and a re-run writes nothing', async () => {
    fixture = await openS2BActivityFixture('memory');
    const f = fixture;
    const r15 = await f.runAndEnd(WORK_TASK_IDS[0], await newSession(f, '17a'), at(-15.1), at(-15));
    const r30 = await f.runAndEnd(WORK_TASK_IDS[1], await newSession(f, '17b'), at(-30.1), at(-30));
    await f.ensureRecording(at(0));

    const counter = scriptedCounter(runRef => ({ kind: 'facts', facts: countedFacts({
      turnStartedAt: '2026-10-01T00:00:00.000Z', lastRecordAt: '2026-10-01T00:00:00.000Z',
      kernelRunId: runRef.runId, throughPosition: 3,
    }) }));
    const backfill = createActivityBackfill({ runtime: { countRunActivity: counter.countRunActivity },
      activity: f.activity, now: () => at(0), batchRuns: 1 });
    const ctx = humanHost(f);
    const range = { workspace: f.b2.base.scope, from: at(-40), to: at(-10) };

    const first = await backfill.backfillActivityRange(ctx, { ...range, cursor: null });
    expect(first.status).toBe('ready');
    if (first.status !== 'ready') return;
    expect(first.value.processed).toHaveLength(1);
    expect(first.value.processed[0]!.runRef.runId).toBe(r15.runId);
    expect(first.value.next).not.toBeNull();
    expect(first.value.done).toBe(false);
    // The other Run is still unmaterialised until the cursor is followed.
    expect(viewOf(await f.readRuns([r30]), r30.runId)).toMatchObject({ status: 'unknown', reason: 'not_backfilled' });

    const second = await backfill.backfillActivityRange(ctx, { ...range, cursor: first.value.next });
    expect(second.status).toBe('ready');
    if (second.status !== 'ready') return;
    expect(second.value.processed).toHaveLength(1);
    expect(second.value.processed[0]!.runRef.runId).toBe(r30.runId);
    expect(second.value.next).toBeNull();
    expect(second.value.done).toBe(true);

    const recorded = await f.readRuns([r15, r30]);
    const beforeRerun = [viewOf(recorded, r15.runId), viewOf(recorded, r30.runId)];
    expect(beforeRerun.every(view => view.status === 'counted' && view.recordedBy === 'backfill')).toBe(true);

    const rerun = await backfill.backfillActivityRange(ctx, { ...range, cursor: null });
    expect(rerun.status).toBe('ready');
    if (rerun.status !== 'ready') return;
    expect(rerun.value.processed).toEqual([]);
    expect(rerun.value.next).toBeNull();
    expect(rerun.value.done).toBe(true);
    const afterRerun = await f.readRuns([r15, r30]);
    for (const runId of [r15.runId, r30.runId]) {
      expect(viewOf(afterRerun, runId).recordedAt).toBe(viewOf(recorded, runId).recordedAt);
    }
  });

  it('2B-18 backfill writes unknown, retries the retryable reasons, and honours a rejected read', async () => {
    fixture = await openS2BActivityFixture('memory');
    const f = fixture;
    const old = await commitLegacyRun(f, 'legacy-no-locator', at(-5));
    const missing = await f.runAndEnd(WORK_TASK_IDS[0], await newSession(f, '18a'), at(-3.1), at(-3));
    await f.ensureRecording(at(0));

    // The special-case Runs answer with an explicit fact; everything else is counted.
    let handler: (runRef: RunRef) => CountOutcome | CoreRejection = runRef =>
      runRef.runId === old.runId
        ? { kind: 'facts', facts: unknownFacts('no_history_locator', 'the Run has no position record') }
        : runRef.runId === missing.runId
          ? { kind: 'facts', facts: unknownFacts('kernel_unreadable', 'the Kernel store is missing') }
          : { kind: 'facts', facts: countedFacts({ turnStartedAt: at(-3), lastRecordAt: at(-3), throughPosition: 4 }) };
    const counter = scriptedCounter(runRef => handler(runRef));
    let current = at(0);
    const backfill = createActivityBackfill({ runtime: { countRunActivity: counter.countRunActivity },
      activity: f.activity, now: () => current });

    const first = await backfill.backfillRecentActivity(f.ctx, { workspace: f.b2.base.scope, cursor: null });
    expect(first.status).toBe('ready');
    if (first.status !== 'ready') return;
    expect(viewOf(await f.readRuns([old]), old.runId)).toMatchObject({ status: 'unknown', reason: 'no_history_locator' });
    expect(viewOf(await f.readRuns([missing]), missing.runId)).toMatchObject({ status: 'unknown', reason: 'kernel_unreadable' });

    // The Kernel recovers: the automatic recent backfill retries that reason and replaces it.
    counter.set(runRef => runRef.runId === old.runId
      ? { kind: 'facts', facts: unknownFacts('no_history_locator', 'still no locator') }
      : { kind: 'facts', facts: countedFacts({ turnStartedAt: at(-3), lastRecordAt: at(-3), throughPosition: 6 }) });
    const second = await backfill.backfillRecentActivity(f.ctx, { workspace: f.b2.base.scope, cursor: null });
    expect(second.status).toBe('ready');
    expect(viewOf(await f.readRuns([missing]), missing.runId)).toMatchObject({ status: 'counted', recordedBy: 'backfill' });

    // A read rejected `unavailable` is `retry_later`: nothing is written and the
    // cursor points at that Run, so the next batch finishes it.
    current = at(1);
    const retry = await f.runAndEnd(WORK_TASK_IDS[1], await newSession(f, '18b'), at(0.4), at(0.5));
    let rejectOnce = true;
    counter.set(runRef => {
      if (runRef.runId === retry.runId && rejectOnce) {
        rejectOnce = false;
        return { status: 'rejected', code: 'unavailable', reason: 'the Kernel read is temporarily unavailable' };
      }
      return { kind: 'facts', facts: countedFacts({ turnStartedAt: at(0.4), lastRecordAt: at(0.5), throughPosition: 4 }) };
    });
    const retryBatch = await backfill.backfillRecentActivity(f.ctx, { workspace: f.b2.base.scope, cursor: null });
    expect(retryBatch.status).toBe('ready');
    if (retryBatch.status !== 'ready') return;
    const retried = retryBatch.value.processed.find(entry => entry.runRef.runId === retry.runId);
    expect(retried).toMatchObject({ outcome: 'retry_later' });
    expect(retryBatch.value.next).not.toBeNull();
    expect(viewOf(await f.readRuns([retry]), retry.runId)).toMatchObject({ status: 'unknown', reason: 'not_recorded', error: true });
    const recovered = await backfill.backfillRecentActivity(f.ctx, { workspace: f.b2.base.scope, cursor: retryBatch.value.next });
    expect(recovered.status).toBe('ready');
    expect(viewOf(await f.readRuns([retry]), retry.runId)).toMatchObject({ status: 'counted' });
  });

  it('2B-19 a Run that ended after recording began but has no tally is an error and is made recorded_late by the next start', async () => {
    fixture = await openS2BActivityFixture('memory');
    const f = fixture;
    await f.ensureRecording(at(0));
    // Counting off: the Run ends 2 days after the epoch and carries no record.
    const missed = await f.runAndEnd(WORK_TASK_IDS[0], await newSession(f, '19a'), at(2), at(2.1));
    const read1 = await f.readRuns([missed]);
    expect(viewOf(read1, missed.runId)).toMatchObject({ status: 'unknown', reason: 'not_recorded', error: true, recordedAt: null });
    // Reading the calendar never backfills; it reports the uncovered Run.
    const calendar1 = await f.readCalendar({ goalRef: f.goalRef, from: at(1), to: at(3), granularity: 'hour', timeZone: 'UTC' });
    expect(calendar1.status).toBe('ready');
    if (calendar1.status !== 'ready') return;
    expect(calendar1.value.coverage.runsUncounted).toContainEqual({ reason: 'not_recorded', count: 1 });
    expect(calendar1.value.totals.complete).toBe(false);
    expect(viewOf(await f.readRuns([missed]), missed.runId).status).toBe('unknown');

    const counter = scriptedCounter(() => ({ kind: 'facts', facts: countedFacts({
      turnStartedAt: at(2), lastRecordAt: at(2.1), quarters: [{ at: '2026-10-22T00:00:00.000Z', steps: 3, edits: 1, editsUnknown: 0 }],
      throughPosition: 4,
    }) }));
    const backfill = createActivityBackfill({ runtime: { countRunActivity: counter.countRunActivity },
      activity: f.activity, now: () => at(3) });
    const batch = await backfill.backfillRecentActivity(f.ctx, { workspace: f.b2.base.scope, cursor: null });
    expect(batch.status).toBe('ready');
    const read2 = await f.readRuns([missed]);
    expect(viewOf(read2, missed.runId)).toMatchObject({
      status: 'counted', reason: 'recorded_late', error: true, recordedBy: 'backfill', totals: { steps: 3, edits: 1, editsUnknown: 0 },
    });
    const calendar2 = await f.readCalendar({ goalRef: f.goalRef, from: at(1), to: at(3), granularity: 'hour', timeZone: 'UTC' });
    expect(calendar2.status).toBe('ready');
    if (calendar2.status !== 'ready') return;
    expect(calendar2.value.coverage.runsRecordedLate).toBe(1);
    expect(calendar2.value.totals.steps).toBeGreaterThanOrEqual(3);

    // The same applies to a Run whose end was booked `unknown('history_read_failed')`.
    const failed = await f.runAndEnd(WORK_TASK_IDS[1], await newSession(f, '19b'), at(2.2), at(2.3));
    await f.writeActivity(failed, unknownFacts('history_read_failed', 'the end read failed') as RunActivityFactsV1);
    const retried = await backfill.backfillRecentActivity(f.ctx, { workspace: f.b2.base.scope, cursor: null });
    expect(retried.status).toBe('ready');
    expect(viewOf(await f.readRuns([failed]), failed.runId)).toMatchObject({ status: 'counted', reason: 'recorded_late', error: true });
  });

  it('2B-20 only a human Host actor runs the range backfill; a platform automation actor is forbidden', async () => {
    fixture = await openS2BActivityFixture('memory');
    const f = fixture;
    await f.ensureRecording(at(0));
    const counter = scriptedCounter(() => ({ kind: 'facts', facts: countedFacts({ turnStartedAt: at(0), lastRecordAt: at(0) }) }));
    const backfill = createActivityBackfill({ runtime: { countRunActivity: counter.countRunActivity },
      activity: f.activity, now: () => at(0) });
    const range = { workspace: f.b2.base.scope, from: at(-40), to: at(10), cursor: null };

    const automation: CoreCallContext = { ...f.ctx,
      principal: { kind: 'host', actor: { kind: 'system', id: 'workflow:auto-rework' } } };
    expect(await backfill.backfillActivityRange(automation, range)).toMatchObject({ status: 'rejected', code: 'forbidden' });
    const member: CoreCallContext = { ...f.ctx, principal: { kind: 'work_run', actor: { kind: 'agent', runRef: { aggregateType: 'Run', projectId: f.goalRef.projectId, goalId: f.goalRef.goalId, runId: 'x' } } } as never };
    expect(await backfill.backfillActivityRange(member, range)).toMatchObject({ status: 'rejected', code: 'forbidden' });
    // A Host started with a non-automation `kind:'system'` actor is an operator (F35).
    const systemOperator: CoreCallContext = { ...f.ctx,
      principal: { kind: 'host', actor: { kind: 'system', id: 's2b-system-operator' } } };
    expect(await backfill.backfillActivityRange(systemOperator, range)).toMatchObject({ status: 'ready' });
  });

  it('2B-42 an old Run with no locator and no authorization is a candidate and backfills to unknown(no_history_locator)', async () => {
    fixture = await openS2BActivityFixture('memory');
    const f = fixture;
    const old = await commitLegacyRun(f, 'legacy-before-epoch', at(-5));
    await f.ensureRecording(at(0));
    // Before any backfill it reads `not_backfilled`, not `not_entered` and not 0.
    expect(viewOf(await f.readRuns([old]), old.runId)).toMatchObject({
      status: 'unknown', reason: 'not_backfilled', error: false, totals: null, recordedAt: null,
    });
    const calendar = await f.readCalendar({ goalRef: f.goalRef, from: at(-6), to: at(-4), granularity: 'hour', timeZone: 'UTC' });
    expect(calendar.status).toBe('ready');
    if (calendar.status !== 'ready') return;
    // No `startedAt`, so it is not placed in a cell; the window is incomplete.
    expect(calendar.value.coverage.runsUnplaced).toBe(1);
    expect(calendar.value.totals.complete).toBe(false);
    expect(calendar.value.cells.every(cell => cell.uncountedRuns === 0)).toBe(true);

    const counter = scriptedCounter(() => ({ kind: 'facts', facts: unknownFacts('no_history_locator', 'no position record') }));
    const backfill = createActivityBackfill({ runtime: { countRunActivity: counter.countRunActivity },
      activity: f.activity, now: () => at(0) });
    const batch = await backfill.backfillActivityRange(humanHost(f), {
      workspace: f.b2.base.scope, from: at(-40), to: at(0), cursor: null,
    });
    expect(batch.status).toBe('ready');
    if (batch.status !== 'ready') return;
    expect(batch.value.processed).toEqual([{ runRef: old, outcome: 'unknown', reason: 'no_history_locator' }]);
    expect(viewOf(await f.readRuns([old]), old.runId)).toMatchObject({
      status: 'unknown', reason: 'no_history_locator', error: false, recordedBy: 'backfill',
    });
    const after = await f.readCalendar({ goalRef: f.goalRef, from: at(-6), to: at(-4), granularity: 'hour', timeZone: 'UTC' });
    expect(after.status).toBe('ready');
    if (after.status !== 'ready') return;
    expect(after.value.coverage.runsUnplaced).toBe(1);
  });
});
