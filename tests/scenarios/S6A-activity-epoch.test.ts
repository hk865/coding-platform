/**
 * A workspace's Query recording epoch decides how an ended Query with no
 * activity record reads: below the epoch only the backfill can fill it
 * (`not_backfilled`, no error), at or after it the record should have existed
 * (`not_recorded`, error). The backfill marks only the latter late, a workspace
 * with no epoch reads `no_recording_epoch`, and the Workspace recording's own
 * `since` never moves. A recording stored with a null epoch gets it from the
 * next Host start in one commit; every later start answers that commit's own
 * receipt (the same snapshot and cursor) and writes no second epoch. An epoch
 * commit that throws after it landed is answered by its receipt in the same
 * start; one that throws before it lands fails that start. A recording created
 * with both epochs never needs an epoch commit. The two old Queries are made
 * with the frozen store-boundary double that trims the activity out of a real
 * end commit, and the null epoch with the same double on the recording's own
 * commit (spec `slice-6-SPEC.md:420`).
 *
 * Two in-test wrappers sit on the real dependencies of the epoch rows: an A2
 * fault on the real SQLite `records.commit` of the epoch commit (the commit
 * that writes the `ActivityRecording` at a revision above 1), which throws once
 * after the real commit landed or once before calling it, and counts the epoch
 * commits that landed; and an A3 pass-through on the platform's run-activity
 * service that keeps what each `ensureActivityRecording` call of a Host start
 * returned, unchanged.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { ActivityBackfillBatchV1 } from '../../src/business/workflow/contracts.js';
import type { ActivityCalendarV1, QueryActivityViewV1 } from '../../src/core/work-graph/views/activity-read-model.js';
import * as runActivityModule from '../../src/core/work-graph/tasks/run-activity-service.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { activityBoundary } from '../helpers/S6A-activity-boundary.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { initializeProject, secretaryAnswer } from '../helpers/S6A-history-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_GOAL_1, S6A_SCOPE, type S6ABackend, type S6ASession } from '../helpers/S6A-request-fixture.js';

/**
 * The A2 fault on the real epoch commit (rule sheet A2: a wrapper around the real dependency that fails once). It
 * wraps the SQLite backend the activity boundary built, so it sits outside the boundary and the barrier and sees the
 * commit as the platform prepared it.
 */
const epochCommit = vi.hoisted(() => {
  type Commit = { records: readonly { json: string }[] };
  const state = {
    /** The next epoch commit throws once: after the real commit landed, or before the real commit is called. */
    fault: null as null | 'after_landing' | 'before_landing',
    /** Epoch commits the real store wrote (committed, not replayed). */
    landed: 0,
    /** Faults thrown. */
    thrown: 0,
    reset(): void { state.fault = null; state.landed = 0; state.thrown = 0; },
    /** The commit writes the workspace's `ActivityRecording` at a revision above 1: the Query epoch commit. */
    isEpochCommit(commit: Commit): boolean {
      return commit.records.some(record => {
        try {
          const body = JSON.parse(record.json) as { ref?: { aggregateType?: unknown }; revision?: unknown };
          return body.ref?.aggregateType === 'ActivityRecording' && typeof body.revision === 'number' && body.revision > 1;
        } catch { return false; }
      });
    },
    wrap<B extends { readonly records: { commit(input: never): Promise<unknown> } }>(backend: B): B {
      const real = backend.records as unknown as { commit(input: Commit): Promise<{ status: string; replayed?: boolean }> };
      const commit = async (input: Commit) => {
        if (!state.isEpochCommit(input)) return real.commit(input);
        if (state.fault === 'before_landing') {
          state.fault = null;
          state.thrown += 1;
          throw new Error('S6A epoch fault: the store failed before the epoch commit was written');
        }
        const receipt = await real.commit(input);
        if (receipt.status === 'committed' && receipt.replayed !== true) state.landed += 1;
        if (state.fault === 'after_landing') {
          state.fault = null;
          state.thrown += 1;
          throw new Error('S6A epoch fault: the connection failed after the epoch commit was written');
        }
        return receipt;
      };
      return { ...backend, records: { ...backend.records, commit } } as unknown as B;
    },
  };
  return state;
});

// The frozen activity boundary: the row's allowed store-boundary double (it builds the barrier's module first). The
// SQLite backend also gets the epoch fault above, outside the boundary.
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-activity-boundary.js')).inMemoryActivityBoundaryModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) => {
  const inner = await (await import('../helpers/S6A-activity-boundary.js')).sqliteActivityBoundaryModule(importOriginal);
  return { ...inner,
    createSqliteRecordBackend: (options: Parameters<typeof inner.createSqliteRecordBackend>[0]) =>
      epochCommit.wrap(inner.createSqliteRecordBackend(options)) };
});

const BACKENDS: readonly S6ABackend[] = ['memory', 'sqlite'];
/** The row's epoch, `slice-6-SPEC.md:420`. */
const EPOCH = '2026-10-16T09:00:00.000Z';
/** The Host opens earlier, so the Work `since` (the recording's own start) is 08:00 and never moves. */
const OPEN_AT = '2026-10-16T08:00:00.000Z';
const SINCE = OPEN_AT;
const DAY = { from: '2026-10-16T00:00:00.000Z', to: '2026-10-17T00:00:00.000Z' };
const worlds: S6AHostWorld[] = [];

afterEach(async () => {
  const unfired = activityBoundary.reset();
  const held = commitBarrier.reset();
  const open = worlds.splice(0);
  await Promise.allSettled(open.map(world => world.close()));
  const faultLeft = epochCommit.fault;
  epochCommit.reset();
  expect(unfired).toEqual([]);
  expect(held).toEqual([]);
  expect(faultLeft).toBeNull();
});

function remember(world: S6AHostWorld): S6AHostWorld {
  worlds.push(world);
  return world;
}

type EnsureResult = WriteResult<{ revision: number; since: string; querySince: string | null }>;

/**
 * The A3 pass-through on the platform's run-activity service: every service the platform builds from now on keeps,
 * unchanged, what each `ensureActivityRecording` call answered (one call per Host start of this one-workspace world).
 */
function captureEnsures(): EnsureResult[] {
  const answers: EnsureResult[] = [];
  const real = runActivityModule.createRunActivityService;
  vi.spyOn(runActivityModule, 'createRunActivityService').mockImplementation(deps => {
    const port = real(deps);
    return { ...port, async ensureActivityRecording(ctx, request) {
      const answer = await port.ensureActivityRecording(ctx, request);
      answers.push(structuredClone(answer) as EnsureResult);
      return answer;
    } };
  });
  return answers;
}

async function queryActivity(world: S6AHostWorld, runRef: QueryRunRef): Promise<QueryActivityViewV1> {
  const answer = await world.post('activity/queries', { scope: S6A_SCOPE, input: { refs: [runRef] } });
  if (answer.httpStatus !== 200) throw new Error(`S6A: activity/queries answered ${answer.httpStatus}: ${JSON.stringify(answer.body)}`);
  const body = answer.body as ReadResult<QueryActivityViewV1[]>;
  if (body.status !== 'ready') throw new Error(`S6A: activity/queries was not ready: ${JSON.stringify(body)}`);
  const view = body.value[0];
  if (view === undefined) throw new Error('S6A: activity/queries returned no view');
  return view;
}

async function calendar(world: S6AHostWorld): Promise<ActivityCalendarV1> {
  const answer = await world.post('activity/calendar', { scope: S6A_SCOPE, input: {
    scope: { kind: 'goal', goalRef: S6A_GOAL_1 }, ...DAY, granularity: 'hour', timeZone: 'UTC',
  } });
  if (answer.httpStatus !== 200) throw new Error(`S6A: activity/calendar answered ${answer.httpStatus}`);
  const body = answer.body as ReadResult<ActivityCalendarV1>;
  if (body.status !== 'ready') throw new Error(`S6A: activity/calendar was not ready: ${JSON.stringify(body)}`);
  return body.value;
}

/** One backfill pass from the row's day. */
async function backfillPass(world: S6AHostWorld, cursor: string | null): Promise<ActivityBackfillBatchV1> {
  const answer = await world.post('activity/backfill', { scope: S6A_SCOPE, input: {
    workspace: { ...S6A_SCOPE }, ...DAY, cursor,
  } });
  if (answer.httpStatus !== 200) throw new Error(`S6A: activity/backfill answered ${answer.httpStatus}: ${JSON.stringify(answer.body)}`);
  const body = answer.body as ReadResult<ActivityBackfillBatchV1>;
  if (body.status !== 'ready') throw new Error(`S6A: activity/backfill was not ready: ${JSON.stringify(body)}`);
  return body.value;
}

/** Every pass until the backfill reports done; the merged processed list. */
async function backfillAll(world: S6AHostWorld): Promise<ActivityBackfillBatchV1['processed']> {
  const processed: ActivityBackfillBatchV1['processed'] = [];
  let cursor: string | null = null;
  for (let pass = 0; pass < 20; pass += 1) {
    const batch = await backfillPass(world, cursor);
    processed.push(...batch.processed);
    if (batch.done) return processed;
    if (batch.next === null) throw new Error(`S6A: the backfill is not done but names no next: ${JSON.stringify(batch)}`);
    cursor = batch.next;
  }
  throw new Error('S6A: the backfill did not end within 20 passes');
}

/**
 * One real request round that ends at `at` with its activity record trimmed out of the ending commit: hold the
 * model request, arm the frozen double for this round, release, wait for the end.
 */
async function roundWithoutActivity(world: S6AHostWorld, session: S6ASession, commandId: string, at: string):
  Promise<{ job: QueryJobRef; run: QueryRunRef }> {
  await world.scripted.script(session, [{ kind: 'text', text: secretaryAnswer({ body: `${commandId} answer` }) }]);
  const running = await world.gates.modelRequest(session);
  const submitted = await world.submit({ commandId, goalId: S6A_GOAL_1.goalId, text: `S6A epoch ${commandId}`,
    recipient: session });
  if (submitted.status !== 'queued') throw new Error(`S6A: the request was not queued: ${JSON.stringify(submitted)}`);
  await running.reached;
  activityBoundary.dropQueryActivity({ round: submitted.round }, { label: `drop ${commandId}` });
  world.clock.set(at);
  running.release();
  await world.waitForRequest(submitted.requestRoot,
    current => current.rounds.some(round => round.ref.queryJobId === submitted.round.queryJobId && round.status === 'ended'),
    `the ${commandId} round answers`);
  const read = await readQuery(world.ag2b, submitted.round);
  return { job: submitted.round, run: read.run.ref };
}

/** A SQLite world whose first start stores its recording with `querySince: null` (the double's one rewrite). */
async function openWithNullEpoch(): Promise<{ world: S6AHostWorld; a: S6ASession }> {
  activityBoundary.setQuerySince(null, { times: 1, label: 'start with no epoch' });
  const world = remember(await openS6AHostWorld({ backend: 'sqlite', at: OPEN_AT,
    extraHostOptions: { requestDriver: 'on' } }));
  await initializeProject(world);
  const a = await world.createSecretary('a');
  return { world, a };
}

describe.each(BACKENDS)('R-16: an ended Query without a record against the epoch (%s)', (backend: S6ABackend) => {
  it('below the epoch it is not_backfilled, at or above it not_recorded with an error; the backfill marks only the latter late', async () => {
    // The epoch is set on the workspace recording's own commit (the Host start writes it at the open instant).
    activityBoundary.setQuerySince(EPOCH);
    const world = remember(await openS6AHostWorld({ backend, at: OPEN_AT, extraHostOptions: { requestDriver: 'on' } }));
    await initializeProject(world);
    const a = await world.createSecretary('a');

    const early = (await roundWithoutActivity(world, a, 's6a-epoch-0850', '2026-10-16T08:50:00.000Z')).run;
    const late = (await roundWithoutActivity(world, a, 's6a-epoch-0930', '2026-10-16T09:30:00.000Z')).run;
    expect(await queryActivity(world, early)).toMatchObject({
      queryRunRef: early, status: 'unknown', reason: 'not_backfilled', error: false,
      totals: null, recordedBy: null,
    });
    expect(await queryActivity(world, late)).toMatchObject({
      queryRunRef: late, status: 'unknown', reason: 'not_recorded', error: true,
      totals: null, recordedBy: null,
    });
    // The Work `since` is the calendar's recordingSince, unchanged by the epoch.
    expect((await calendar(world)).recordingSince).toBe(SINCE);

    const processed = await backfillAll(world);
    expect(processed).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'query', queryRunRef: early, outcome: 'counted' }),
      expect.objectContaining({ kind: 'query', queryRunRef: late, outcome: 'counted' }),
    ]));
    // Before the epoch the backfill is the normal path; at or after it the record is late.
    expect(await queryActivity(world, early)).toMatchObject({
      status: 'counted', reason: null, error: false, recordedBy: 'backfill', totals: { steps: 0 },
    });
    expect(await queryActivity(world, late)).toMatchObject({
      status: 'counted', reason: 'recorded_late', error: true, recordedBy: 'backfill', totals: { steps: 0 },
    });
    expect((await calendar(world)).recordingSince).toBe(SINCE);
  }, 180_000);
});

describe.each(BACKENDS)('R-16: a workspace with no Query epoch (%s)', (backend: S6ABackend) => {
  it('reads no_recording_epoch for an ended Query with no record', async () => {
    activityBoundary.setQuerySince(null);
    const world = remember(await openS6AHostWorld({ backend, at: OPEN_AT, extraHostOptions: { requestDriver: 'on' } }));
    await initializeProject(world);
    const a = await world.createSecretary('a');
    const runRef = (await roundWithoutActivity(world, a, 's6a-epoch-none', '2026-10-16T08:50:00.000Z')).run;
    expect(await queryActivity(world, runRef)).toMatchObject({
      status: 'unknown', reason: 'no_recording_epoch', error: false, totals: null,
    });
    // The Work `since` is still its own.
    expect((await calendar(world)).recordingSince).toBe(SINCE);
  }, 180_000);
});

describe('R-16 SQLite only: the epoch commit on the next start (a Host restart)', () => {
  it('a null epoch is written by the next start in one commit, and every later start answers that commit’s receipt', async () => {
    const ensures = captureEnsures();
    // 1. The first start stores the recording with `querySince: null` (the one rewrite); its writer answers what it
    //    wrote, both epochs at the open instant.
    const { world, a } = await openWithNullEpoch();
    expect(ensures).toEqual([expect.objectContaining({ status: 'committed', replayed: false,
      value: expect.objectContaining({ revision: 1, since: SINCE, querySince: SINCE }) })]);
    const runRef = (await roundWithoutActivity(world, a, 's6a-epoch-retry', '2026-10-16T08:30:00.000Z')).run;
    expect(await queryActivity(world, runRef)).toMatchObject({ status: 'unknown', reason: 'no_recording_epoch' });

    // 2. The next start writes the epoch at its own instant (09:00) in one commit and keeps `since`: a Query ended
    //    after that instant reads not_recorded, never no_recording_epoch.
    world.clock.set(EPOCH);
    await world.reopen();
    expect(ensures).toHaveLength(2);
    const written = ensures[1]!;
    expect(written).toMatchObject({ status: 'committed', replayed: false,
      value: { revision: 2, since: SINCE, querySince: EPOCH } });
    expect(epochCommit.landed).toBe(1);
    expect((await calendar(world)).recordingSince).toBe(SINCE);
    const after = (await roundWithoutActivity(world, a, 's6a-epoch-after', '2026-10-16T09:30:00.000Z')).run;
    expect(await queryActivity(world, after)).toMatchObject({
      status: 'unknown', reason: 'not_recorded', error: true,
    });

    // 3. An unrelated commit and one more start at 10:00: the start finds the epoch commit's own receipt (the Host's
    //    stable request id) and answers its original snapshot and cursor, a replay; no second epoch is written, so a
    //    Query ended at 09:45 still reads not_recorded.
    world.clock.set('2026-10-16T10:00:00.000Z');
    await world.bumpRevision(a);
    await world.reopen();
    expect(ensures).toHaveLength(3);
    expect(ensures[2]).toEqual({ ...written, replayed: true });
    expect(epochCommit.landed).toBe(1);
    expect((await calendar(world)).recordingSince).toBe(SINCE);
    const kept = (await roundWithoutActivity(world, a, 's6a-epoch-kept', '2026-10-16T09:45:00.000Z')).run;
    expect(await queryActivity(world, kept)).toMatchObject({
      status: 'unknown', reason: 'not_recorded', error: true,
    });
  }, 180_000);

  it('an epoch commit that throws after it landed is answered by its own receipt in the same start', async () => {
    const ensures = captureEnsures();
    const { world, a } = await openWithNullEpoch();
    // The next start's epoch commit lands, then the store call throws: the same start finds the commit's receipt.
    epochCommit.fault = 'after_landing';
    world.clock.set(EPOCH);
    await world.reopen();
    expect(epochCommit.thrown).toBe(1);
    expect(epochCommit.landed).toBe(1);
    expect(ensures).toHaveLength(2);
    const recovered = ensures[1]!;
    expect(recovered).toMatchObject({ status: 'committed', replayed: true,
      value: { revision: 2, since: SINCE, querySince: EPOCH } });
    const after = (await roundWithoutActivity(world, a, 's6a-epoch-landed', '2026-10-16T09:30:00.000Z')).run;
    expect(await queryActivity(world, after)).toMatchObject({ status: 'unknown', reason: 'not_recorded', error: true });

    // The start after that answers the same receipt (the same snapshot and cursor) and writes nothing.
    world.clock.set('2026-10-16T10:00:00.000Z');
    await world.reopen();
    expect(ensures).toHaveLength(3);
    expect(ensures[2]).toEqual(recovered);
    expect(epochCommit.landed).toBe(1);
  }, 180_000);

  it('an epoch commit that throws before it lands fails that start, which writes no epoch', async () => {
    // The next start (the row's "written by the next start") cannot be made here: the frozen request world restarts
    // only from a running Host (tests/helpers/S6A-request-fixture.ts:762-770, `current()` at :513-516), and a start
    // that failed leaves none.
    const ensures = captureEnsures();
    const { world } = await openWithNullEpoch();
    epochCommit.fault = 'before_landing';
    world.clock.set(EPOCH);
    await expect(world.reopen()).rejects.toThrow(/the query activity epoch commit failed/);
    expect(epochCommit.thrown).toBe(1);
    expect(epochCommit.landed).toBe(0);
    expect(ensures).toHaveLength(2);
    expect(ensures[1]).toMatchObject({ status: 'rejected', code: 'unavailable' });
  }, 180_000);

  it('a recording created with both epochs answers every restart with no epoch commit', async () => {
    const ensures = captureEnsures();
    const world = remember(await openS6AHostWorld({ backend: 'sqlite', at: OPEN_AT,
      extraHostOptions: { requestDriver: 'on' } }));
    expect(ensures).toEqual([expect.objectContaining({ status: 'committed', replayed: false,
      value: expect.objectContaining({ revision: 1, since: SINCE, querySince: SINCE }) })]);
    world.clock.set(EPOCH);
    await world.reopen();
    expect(ensures).toHaveLength(2);
    expect(ensures[1]).toMatchObject({ status: 'committed', replayed: true,
      value: { revision: 1, since: SINCE, querySince: SINCE } });
    expect(epochCommit.landed).toBe(0);
  }, 180_000);
});
