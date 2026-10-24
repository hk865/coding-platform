/**
 * L16: the backfill's two Query dependencies and the Query CAS pin, over the
 * real Host on both backends.
 *
 * - A dependency without either Query member leaves the Work branch unchanged
 *   (a Work Run is still counted) and, with the other Query member real,
 *   makes only the Query branch answer `unsupported`: one row without
 *   `countQueryActivity`, one without `recordQueryActivity`. The Work Run is
 *   the counting-off double's real end (no tally); the Query is the frozen
 *   store-boundary double's real end (its QueryActivity record dropped).
 * - The revision race is the Work one applied to a Query: a first backfill
 *   selects the Query with no record and its real count is held at a gate
 *   (rule sheet A3) before it returns; a public step commits, so a second
 *   backfill selects at another commit cursor and writes the record; released,
 *   the first backfill's write carries its selection's null pin and reports
 *   `skipped`/`record_changed` instead of overwriting or replaying.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { RequestSubmitResultV1 } from '../../src/business/workflow/request-intake.js';
import { createActivityBackfill } from '../../src/business/workflow/activity-backfill.js';
import { deferred, readExecution, readQuery, workRow } from '../helpers/A2-restart-fixture.js';
import { activityBoundary } from '../helpers/S6A-activity-boundary.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { ensureProjectPointers, openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_GOAL_1, type S6ASession } from '../helpers/S6A-request-fixture.js';

const countingOff = vi.hoisted(() => ({ off: false }));

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

async function endRound(world: S6AHostWorld, secretary: S6ASession, label: string): Promise<QueryRunRef> {
  const submitted = queued(await world.submit({ commandId: `${label}-submit`, goalId: S6A_GOAL_1.goalId,
    text: `${label} question`, recipient: secretary }));
  await world.waitForRequest(submitted.requestRoot, current => current.rounds[0]?.status === 'ended',
    `${label} answers`);
  return (await readQuery(world.ag2b, submitted.round)).run.ref;
}

/** A request round on a new secretary whose end commit lands without its QueryActivity. */
async function endUnrecorded(world: S6AHostWorld, label: string): Promise<QueryRunRef> {
  const secretary = await world.createSecretary(label);
  await world.scripted.script(secretary, [{ kind: 'text', text: answerText(`S6A ${label} answer`) }]);
  activityBoundary.dropQueryActivity({ session: secretary.ref }, { label: `the ${label} Query has no record` });
  return endRound(world, secretary, label);
}

/**
 * The real candidate scan and writes with Query members left out: `both` is the Work-only dependency, `count` and
 * `write` leave out one member each and keep the other one real.
 */
function withoutQueryMembers(world: S6AHostWorld, missing: 'both' | 'count' | 'write') {
  const runtime = world.platform.runtime;
  const owner = world.platform.runActivity;
  const countRunActivity = runtime.countRunActivity!.bind(runtime);
  const workActivity = { listActivityBackfillCandidates: owner.listActivityBackfillCandidates.bind(owner),
    recordRunActivity: owner.recordRunActivity.bind(owner) };
  return createActivityBackfill({
    runtime: missing === 'write'
      ? { countRunActivity, countQueryActivity: runtime.countQueryActivity!.bind(runtime) } : { countRunActivity },
    activity: missing === 'count'
      ? { ...workActivity, recordQueryActivity: owner.recordQueryActivity.bind(owner) } : workActivity,
    now: () => world.clock.now(), batchRuns: 10,
  });
}

const backends = ['memory', 'sqlite'] as const;
const oneMissing = [
  { member: 'count', backend: 'memory' }, { member: 'count', backend: 'sqlite' },
  { member: 'write', backend: 'memory' }, { member: 'write', backend: 'sqlite' },
] as const;

describe('a backfill dependency without the Query side', () => {
  it.each(backends)('leaves the Work branch unchanged (%s)', async (backend) => {
    countingOff.off = true;
    const world = remember(await openS6AHostWorld({ backend, secretaryWork: true }));
    await ensureProjectPointers(world);
    await world.makeWorkWaitingSecretary('work');
    const runRef = (await workRow(world.ag2b)).execution;
    expect(runRef).not.toBeNull();
    expect((await readExecution(world.ag2b, runRef!)).run.status).toBe('ended');
    countingOff.off = false;
    world.clock.advance(60 * 60_000);

    const batch = await withoutQueryMembers(world, 'both').backfillRecentActivity(world.humanContext(), {
      workspace: world.scope, cursor: null });
    expect(batch.status).toBe('ready');
    if (batch.status !== 'ready') return;
    expect(batch.value.processed).toEqual([{ kind: 'run', runRef: runRef!, outcome: 'counted', reason: null }]);
  }, 180_000);

  it.each(oneMissing)('without its Query $member member makes only the Query branch answer unsupported ($backend)',
    async ({ member, backend }) => {
      const world = remember(await openS6AHostWorld({ backend, extraHostOptions: { requestDriver: 'on' } }));
      await ensureProjectPointers(world);
      await endUnrecorded(world, `query-without-${member}`);
      world.clock.advance(60 * 60_000);

      const batch = await withoutQueryMembers(world, member).backfillRecentActivity(world.humanContext(), {
        workspace: world.scope, cursor: null });
      expect(batch).toEqual({ status: 'rejected', code: 'unsupported',
        reason: 'the activity backfill has no Query activity dependency' });
    }, 180_000);
});

describe('the Query CAS pin', () => {
  it.each(backends)('reports skipped/record_changed when another backfill writes first (%s)', async (backend) => {
    const world = remember(await openS6AHostWorld({ backend, extraHostOptions: { requestDriver: 'on' } }));
    await ensureProjectPointers(world);
    const queryRunRef = await endUnrecorded(world, 'race');
    world.clock.advance(60 * 60_000);

    const runtime = world.platform.runtime;
    const reached = deferred();
    const release = deferred();
    // The first backfill: its real count is held at the gate before it returns, then returned unchanged.
    const held = createActivityBackfill({
      runtime: {
        countRunActivity: runtime.countRunActivity!.bind(runtime),
        async countQueryActivity(ctx, input) {
          const counted = await runtime.countQueryActivity!(ctx, input);
          reached.resolve();
          await release.promise;
          return counted;
        },
      },
      activity: world.platform.runActivity, now: () => world.clock.now(), batchRuns: 10,
    });
    const firstRun = held.backfillRecentActivity(world.humanContext(), { workspace: world.scope, cursor: null });
    await reached.promise;
    // A public step commits, so the second backfill selects at a later commit cursor: its request is not the
    // first one's, and the first one's write cannot replay it.
    await world.createWorkSession('backfill-cursor-advance');
    const second = await createActivityBackfill({ runtime, activity: world.platform.runActivity,
      now: () => world.clock.now(), batchRuns: 10 }).backfillRecentActivity(world.humanContext(), {
      workspace: world.scope, cursor: null });
    expect(second).toEqual({ status: 'ready', value: {
      processed: [{ kind: 'query', queryRunRef, outcome: 'counted', reason: null }], next: null, done: true } });

    release.resolve();
    expect(await firstRun).toEqual({ status: 'ready', value: {
      processed: [{ kind: 'query', queryRunRef, outcome: 'skipped', reason: 'record_changed' }], next: null,
      done: true } });
  }, 180_000);
});
