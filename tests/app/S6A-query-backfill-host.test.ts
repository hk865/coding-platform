/**
 * L16: the activity backfill covers Queries. The rows run the real Host on both
 * backends and the real backfill over its own owners.
 *
 * - R-16: with the workspace's Query epoch at 09:00, a Query that ended at
 *   08:50 without its record is a candidate and is backfilled as normal.
 * - a Query claimed with the whole Session aggregate ref (a plain Query through
 *   `queries/claim`) is backfilled, its record naming the plain Session.
 * - a range backfill resumed from a cursor at 11:00 with a new request for
 *   [09:00, 10:00) stays below 10:00: the 10:30 Query is not backfilled.
 * - under a one-record read cap the scan checks what it read before stopping:
 *   one pending Query is backfilled, and two Queries at two instants keep a
 *   continuation until both are.
 * - the mixed page: one Work Run and one Query end at the same instant, so the
 *   merged list answers the Run first (`limit: 1`) and the Query on the next
 *   page; the expected literals are the two refs the public reads named.
 * - a Query whose end commit landed without its QueryActivity is counted once
 *   with `recordedBy: 'backfill'`, and a second scan does not select it again.
 *
 * A Query's missing record is the frozen store-boundary double's (it drops only
 * that record from the real end commit); the Query epoch is the same double's
 * rewrite of the epoch the Host writes at start. The Work Run's missing tally is
 * the counting-off double the 2B rows use: the end commit really runs and
 * carries no activity while `off` is set. Query refs come from the public
 * `queries/read`; a written record is the answer the backfill's own write got,
 * kept by a delegating wrapper around the Host's owner, never a store read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { S6ASession } from '../helpers/S6A-request-fixture.js';
import type { RequestSubmitResultV1 } from '../../src/business/workflow/request-intake.js';
import { createActivityBackfill, type ActivityBackfillDependencies } from '../../src/business/workflow/activity-backfill.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { readExecution, readQuery, workRow } from '../helpers/A2-restart-fixture.js';
import { activityBoundary } from '../helpers/S6A-activity-boundary.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { ensureProjectPointers, openS6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_GOAL_1, S6A_SCOPE } from '../helpers/S6A-request-fixture.js';

const countingOff = vi.hoisted(() => ({ off: false }));
const readCap = vi.hoisted(() => ({ value: undefined as number | undefined }));

// A small read cap set on the Host's own activity owner (rule sheet A2): the factory the platform calls is the
// real one and passes the owner's own `readRecordCap` injection point only in a row that sets `readCap`.
vi.mock('../../src/core/work-graph/tasks/run-activity-service.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/core/work-graph/tasks/run-activity-service.js')>();
  return { ...real,
    createRunActivityService: (deps: Parameters<typeof real.createRunActivityService>[0]) =>
      real.createRunActivityService(readCap.value === undefined ? deps : { ...deps, readRecordCap: readCap.value }) };
});
// The store-boundary double and the counting-off double the frozen fixtures
// name; the boundary builds the commit barrier itself.
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-activity-boundary.js')).inMemoryActivityBoundaryModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-activity-boundary.js')).sqliteActivityBoundaryModule(importOriginal));
vi.mock('../../src/core/agent-runtime/run-activity-tally.js', async (importOriginal) =>
  (await import('../helpers/S2B-counting-off-support.js')).countingOffTallyModule(
    await importOriginal<Record<string, unknown>>(), countingOff));
vi.mock('../../src/core/agent-runtime/run-activity-reader.js', async (importOriginal) =>
  (await import('../helpers/S2B-counting-off-support.js')).countingOffReaderModule(
    await importOriginal<Record<string, unknown>>(), countingOff));

const worlds: S6AHostWorld[] = [];

afterEach(async () => {
  countingOff.off = false;
  readCap.value = undefined;
  activityBoundary.reset();
  const left = commitBarrier.reset();
  const open = worlds.splice(0);
  await Promise.allSettled(open.map(world => world.close()));
  expect(left).toEqual([]);
});

function remember(world: S6AHostWorld): S6AHostWorld {
  worlds.push(world);
  return world;
}

const answerText = (text: string): string =>
  JSON.stringify({ schemaVersion: 1, body: text, ideas: [], goalCardDrafts: [] });

function queued(result: RequestSubmitResultV1): { requestRoot: QueryJobRef; round: QueryJobRef } {
  if (result.status !== 'queued') throw new Error(`S6A: the request was not queued: ${JSON.stringify(result)}`);
  return { requestRoot: result.requestRoot, round: result.round };
}

/** Run one request round on the secretary and answer the ended Query's ref. */
async function endRound(world: S6AHostWorld, secretary: S6ASession, label: string): Promise<QueryRunRef> {
  const submitted = queued(await world.submit({ commandId: `${label}-submit`, goalId: S6A_GOAL_1.goalId,
    text: `${label} question`, recipient: secretary }));
  const view = await world.waitForRequest(submitted.requestRoot,
    current => current.rounds[0]?.status === 'ended', `${label} answers`);
  expect(view.rounds[0]?.status).toBe('ended');
  const query = await readQuery(world.ag2b, submitted.round);
  return query.run.ref;
}

/** One request round on a new secretary, answered at `at`; its end commit lands without its QueryActivity. */
async function endUnrecorded(world: S6AHostWorld, label: string, at: string): Promise<QueryRunRef> {
  const secretary = await world.createSecretary(label);
  await world.scripted.script(secretary, [{ kind: 'text', text: answerText(`S6A ${label} answer`) }]);
  activityBoundary.dropQueryActivity({ session: secretary.ref }, { label: `the ${label} Query has no record` });
  world.clock.set(at);
  return endRound(world, secretary, label);
}

type QueryWrite = Awaited<ReturnType<S6AHostWorld['platform']['runActivity']['recordQueryActivity']>>;

/**
 * The Host's own activity owner behind a delegating wrapper (rule sheet A3): every member is the real one, and
 * `recordQueryActivity` keeps each answer the backfill's own write got, returned unchanged.
 */
function observedOwner(world: S6AHostWorld): { activity: ActivityBackfillDependencies['activity']; writes: QueryWrite[] } {
  const owner = world.platform.runActivity;
  const writes: QueryWrite[] = [];
  return {
    writes,
    activity: {
      listActivityBackfillCandidates: owner.listActivityBackfillCandidates.bind(owner),
      recordRunActivity: owner.recordRunActivity.bind(owner),
      async recordQueryActivity(ctx, request) {
        const written = await owner.recordQueryActivity(ctx, request);
        writes.push(written);
        return written;
      },
    },
  };
}

const backends = ['memory', 'sqlite'] as const;

/** R-16's example: the workspace's Query epoch is 09:00 and the Query ends at 08:50. */
const R16_QUERY_SINCE = '2026-10-16T09:00:00.000Z';
const R16_QUERY_END = '2026-10-16T08:50:00.000Z';

describe('a Query that ended before the Query epoch without its record', () => {
  it.each(backends)('is a candidate and is backfilled as normal (%s)', async (backend) => {
    // The epoch the Host writes at start is stored as 09:00 (the store-boundary double R-16 allows).
    activityBoundary.setQuerySince(R16_QUERY_SINCE, { workspace: S6A_SCOPE, label: 'the Query epoch is 09:00' });
    const world = remember(await openS6AHostWorld({ backend, at: '2026-10-16T08:00:00.000Z',
      extraHostOptions: { requestDriver: 'on' } }));
    await ensureProjectPointers(world);
    const queryRunRef = await endUnrecorded(world, 'before-epoch', R16_QUERY_END);
    world.clock.set('2026-10-16T10:00:00.000Z');

    const owner = observedOwner(world);
    const backfill = createActivityBackfill({ runtime: world.platform.runtime, activity: owner.activity,
      now: () => world.clock.now(), batchRuns: 10 });
    const batch = await backfill.backfillActivityRange(world.humanContext(), { workspace: world.scope,
      from: '2026-10-16T08:00:00.000Z', to: '2026-10-16T10:00:00.000Z', cursor: null });
    expect(batch).toEqual({ status: 'ready', value: {
      processed: [{ kind: 'query', queryRunRef, outcome: 'counted', reason: null }], next: null, done: true } });
    expect(owner.writes).toMatchObject([{ status: 'committed', value: { outcome: 'created', snapshot: {
      revision: 1, recordedBy: 'backfill', queryRunRef, queryEndedAt: R16_QUERY_END, facts: { status: 'counted' },
    } } }]);
  }, 180_000);
});

describe('a Query claimed with the whole Session aggregate ref', () => {
  it.each(backends)('is backfilled with the plain Session it ran in (%s)', async (backend) => {
    const world = remember(await openS6AHostWorld({ backend }));
    const session = await world.createSecretary('aggregate-ref');
    await world.scripted.script(session, [{ kind: 'text', text: 'S6A aggregate-ref answer' }]);
    // The plain Query is claimed through `queries/claim` with the Session aggregate ref the
    // `sessions/read` card names, and answered through `queries/prepare` and `queries/start`.
    const refs = await world.occupy(session);
    activityBoundary.dropQueryActivity({ queryRunRef: refs.queryRunRef }, { label: 'the claimed Query has no record' });
    await world.finishQuery(refs);
    world.clock.advance(60 * 60_000);

    const owner = observedOwner(world);
    const backfill = createActivityBackfill({ runtime: world.platform.runtime, activity: owner.activity,
      now: () => world.clock.now(), batchRuns: 10 });
    const batch = await backfill.backfillRecentActivity(world.humanContext(), { workspace: world.scope, cursor: null });
    expect(batch).toEqual({ status: 'ready', value: {
      processed: [{ kind: 'query', queryRunRef: refs.queryRunRef, outcome: 'counted', reason: null }],
      next: null, done: true } });
    expect(owner.writes).toMatchObject([{ status: 'committed', value: { outcome: 'created', snapshot: {
      revision: 1, recordedBy: 'backfill', queryRunRef: refs.queryRunRef, goalId: S6A_GOAL_1.goalId,
      askedSessionRef: null,
    } } }]);
    // The record names the Session as the plain `{ projectId, sessionId }` its creation answered.
    const written = owner.writes[0];
    expect(written?.status === 'committed' ? written.value.snapshot.sessionRef : null).toEqual(session.ref);
  }, 180_000);
});

describe('a range backfill resumed from a later cursor', () => {
  it.each(backends)('stays below the new request\'s own upper bound (%s)', async (backend) => {
    const world = remember(await openS6AHostWorld({ backend, extraHostOptions: { requestDriver: 'on' } }));
    await ensureProjectPointers(world);
    const at0930 = await endUnrecorded(world, 'range-0930', '2026-10-23T09:30:00.000Z');
    await endUnrecorded(world, 'range-1030', '2026-10-23T10:30:00.000Z');
    const at1100 = await endUnrecorded(world, 'range-1100', '2026-10-23T11:00:00.000Z');
    world.clock.set('2026-10-23T12:00:00.000Z');

    const backfill = createActivityBackfill({ runtime: world.platform.runtime, activity: world.platform.runActivity,
      now: () => world.clock.now(), batchRuns: 1 });
    // [09:00, 12:00) newest first: the 11:00 Query, and the 10:30 one is still left.
    const first = await backfill.backfillActivityRange(world.humanContext(), { workspace: world.scope,
      from: '2026-10-23T09:00:00.000Z', to: '2026-10-23T12:00:00.000Z', cursor: null });
    expect(first).toMatchObject({ status: 'ready', value: {
      processed: [{ kind: 'query', queryRunRef: at1100, outcome: 'counted', reason: null }], done: false } });
    if (first.status !== 'ready') return;
    expect(first.value.next).not.toBeNull();
    // The cursor stands at 11:00; the next request asks for [09:00, 10:00) only, so the 10:30 Query is
    // outside it and the 09:30 one is the whole answer.
    const second = await backfill.backfillActivityRange(world.humanContext(), { workspace: world.scope,
      from: '2026-10-23T09:00:00.000Z', to: '2026-10-23T10:00:00.000Z', cursor: first.value.next });
    expect(second).toEqual({ status: 'ready', value: {
      processed: [{ kind: 'query', queryRunRef: at0930, outcome: 'counted', reason: null }], next: null, done: true } });
  }, 180_000);
});

describe('the candidate read under a one-record read cap', () => {
  it.each(backends)('answers the one pending Query, and is done only after it (%s)', async (backend) => {
    readCap.value = 1;
    const world = remember(await openS6AHostWorld({ backend, extraHostOptions: { requestDriver: 'on' } }));
    await ensureProjectPointers(world);
    const queryRunRef = await endUnrecorded(world, 'cap-one', '2026-10-23T10:00:00.000Z');
    world.clock.set('2026-10-23T12:00:00.000Z');

    const backfill = createActivityBackfill({ runtime: world.platform.runtime, activity: world.platform.runActivity,
      now: () => world.clock.now(), batchRuns: 1 });
    const batch = await backfill.backfillRecentActivity(world.humanContext(), { workspace: world.scope, cursor: null });
    expect(batch).toEqual({ status: 'ready', value: {
      processed: [{ kind: 'query', queryRunRef, outcome: 'counted', reason: null }], next: null, done: true } });
  }, 180_000);

  it.each(backends)('keeps a continuation across two instants until both are backfilled (%s)', async (backend) => {
    readCap.value = 1;
    const world = remember(await openS6AHostWorld({ backend, extraHostOptions: { requestDriver: 'on' } }));
    await ensureProjectPointers(world);
    const at1000 = await endUnrecorded(world, 'cap-1000', '2026-10-23T10:00:00.000Z');
    const at1030 = await endUnrecorded(world, 'cap-1030', '2026-10-23T10:30:00.000Z');
    world.clock.set('2026-10-23T12:00:00.000Z');

    const backfill = createActivityBackfill({ runtime: world.platform.runtime, activity: world.platform.runActivity,
      now: () => world.clock.now(), batchRuns: 1 });
    // Newest first: the 10:30 Query, and the 10:00 one is still left.
    const first = await backfill.backfillRecentActivity(world.humanContext(), { workspace: world.scope, cursor: null });
    expect(first).toMatchObject({ status: 'ready', value: {
      processed: [{ kind: 'query', queryRunRef: at1030, outcome: 'counted', reason: null }], done: false } });
    if (first.status !== 'ready') return;
    expect(first.value.next).not.toBeNull();
    const second = await backfill.backfillRecentActivity(world.humanContext(), { workspace: world.scope,
      cursor: first.value.next });
    expect(second).toEqual({ status: 'ready', value: {
      processed: [{ kind: 'query', queryRunRef: at1000, outcome: 'counted', reason: null }], next: null, done: true } });
  }, 180_000);
});

describe('the merged activity backfill page', () => {
  it.each(backends)('answers the Work Run before the Query at one instant (%s)', async (backend) => {
    countingOff.off = true;
    const world = remember(await openS6AHostWorld({ backend, secretaryWork: true,
      extraHostOptions: { requestDriver: 'on' } }));
    await ensureProjectPointers(world);
    await world.makeWorkWaitingSecretary('work');
    // The Work Run ended under the counting-off double, so it has no tally yet.
    const runRef = (await workRow(world.ag2b)).execution;
    expect(runRef).not.toBeNull();
    const execution = await readExecution(world.ag2b, runRef!);
    expect(execution.run.status).toBe('ended');
    const workEndedAt = execution.run.endedAt!;
    countingOff.off = false;

    const secretary = await world.createSecretary('query');
    await world.scripted.script(secretary, [{ kind: 'text', text: answerText('S6A mixed answer') }]);
    activityBoundary.dropQueryActivity({ session: secretary.ref }, { label: 'the mixed Query has no record' });
    world.clock.set(workEndedAt);
    const submitted = queued(await world.submit({ commandId: 's6a-mixed-submit', goalId: S6A_GOAL_1.goalId,
      text: 'S6A mixed question', recipient: secretary }));
    await world.waitForRequest(submitted.requestRoot, current => current.rounds[0]?.status === 'ended',
      'the mixed Query answers');
    const queryRunRef = (await readQuery(world.ag2b, submitted.round)).run.ref;
    expect(queryRunRef).not.toBeNull();
    // Both ended at the same instant; the backfill's window upper bound is now,
    // strictly above that instant.
    const queryEndedAt = (await readQuery(world.ag2b, submitted.round)).run.run.endedAt;
    expect(queryEndedAt).toBe(workEndedAt);
    world.clock.advance(60 * 60_000);

    const backfill = createActivityBackfill({ runtime: world.platform.runtime,
      activity: world.platform.runActivity, now: () => world.clock.now(), batchRuns: 1 });
    const first = await backfill.backfillRecentActivity(world.humanContext(), {
      workspace: world.scope, cursor: null });
    expect(first.status).toBe('ready');
    if (first.status !== 'ready') return;
    expect(first.value.processed).toEqual([{ kind: 'run', runRef: runRef!, outcome: 'counted', reason: null }]);
    expect(first.value.done).toBe(false);
    expect(first.value.next).not.toBeNull();

    const second = await backfill.backfillRecentActivity(world.humanContext(), {
      workspace: world.scope, cursor: first.value.next });
    expect(second.status).toBe('ready');
    if (second.status !== 'ready') return;
    expect(second.value.processed).toEqual([
      { kind: 'query', queryRunRef, outcome: 'counted', reason: null },
    ]);
    expect(second.value.done).toBe(true);
  }, 180_000);
});

describe('a Query that ended without its QueryActivity', () => {
  it.each(backends)('is counted once with recordedBy backfill and is not a candidate again (%s)', async (backend) => {
    const world = remember(await openS6AHostWorld({ backend, extraHostOptions: { requestDriver: 'on' } }));
    await ensureProjectPointers(world);
    const secretary = await world.createSecretary('dropped');
    await world.scripted.script(secretary, [{ kind: 'text', text: answerText('S6A dropped answer') }]);
    activityBoundary.dropQueryActivity({ session: secretary.ref }, { label: 'the end commit has no QueryActivity' });
    const queryRunRef = await endRound(world, secretary, 'dropped');
    world.clock.advance(60 * 60_000);

    const owner = observedOwner(world);
    const backfill = createActivityBackfill({ runtime: world.platform.runtime, activity: owner.activity,
      now: () => world.clock.now(), batchRuns: 10 });
    const batch = await backfill.backfillRecentActivity(world.humanContext(), {
      workspace: world.scope, cursor: null });
    expect(batch.status).toBe('ready');
    if (batch.status !== 'ready') return;
    expect(batch.value.processed).toEqual([
      { kind: 'query', queryRunRef, outcome: 'counted', reason: null },
    ]);
    // The one write the backfill made: a new record at revision 1, recorded by the backfill, naming the Query, the
    // request's goal and the secretary it ran in, with the one text reply's tally (no tool step).
    expect(owner.writes).toMatchObject([{ status: 'committed', value: { outcome: 'created', snapshot: {
      revision: 1, recordedBy: 'backfill', queryRunRef, goalId: S6A_GOAL_1.goalId, sessionRef: secretary.ref,
      askedSessionRef: null, facts: { status: 'counted', totals: { steps: 0 } },
    } } }]);

    const again = await backfill.backfillRecentActivity(world.humanContext(), {
      workspace: world.scope, cursor: null });
    expect(again.status).toBe('ready');
    if (again.status !== 'ready') return;
    expect(again.value.processed).toEqual([]);
    expect(again.value.done).toBe(true);
    expect(owner.writes).toHaveLength(1);
  }, 180_000);
});
