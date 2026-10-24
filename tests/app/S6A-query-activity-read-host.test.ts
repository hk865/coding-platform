/**
 * L16: Query steps count in the activity reads through the real Host.
 *
 * Every row starts from a real Host and reaches its state through public steps:
 * the request driver, the scripted model's real tools, the request routes, the
 * fixture's Kernel-entry hold, a crash with a new Host on the same SQLite
 * directory, and the Workflow's own Plan adoption and automatic rework. The
 * QueryRunRef each row reads is the one public `queries/read` returns; nothing
 * here reads or writes the record store.
 *
 * - A secretary round's three real tool calls: `activity/queries` counts three
 *   steps, and the calendar adds them to the workspace and to the round's Goal
 *   (not to the other Goal), with no task entry.
 * - A bad answer (`invalid_answer`) still counts the one tool step it booked.
 * - A round dropped before any claim and a round whose Host crashed before the
 *   Kernel entry read `not_entered`, never a zero tally; neither wrote an
 *   activity record, and the calendar's Query coverage counts them.
 * - The workspace calendar keeps two Goals' same task id (`ag2b-work`) as two
 *   task entries, each on its own Goal.
 * - `readQueryActivities` refuses an empty and an oversized reference list,
 *   and answers `unavailable` once the platform has closed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { RequestSubmitResultV1 } from '../../src/business/workflow/request-intake.js';
import type {
  ActivityCalendarScope, ActivityCalendarV1, QueryActivityViewV1,
} from '../../src/core/work-graph/views/activity-read-model.js';
import { AG2B_WORK_TASK_ID } from '../helpers/AG2b-collaboration-fixture.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { openS6ANoticesWorld } from '../helpers/S6A-cards-fixture.js';
import { ensureProjectPointers, openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_GOAL_1, S6A_GOAL_2, S6A_SCOPE } from '../helpers/S6A-request-fixture.js';

const worlds: S6AHostWorld[] = [];

afterEach(async () => {
  const open = worlds.splice(0);
  await Promise.allSettled(open.map(world => world.close()));
});

function remember(world: S6AHostWorld): S6AHostWorld {
  worlds.push(world);
  return world;
}

/** A semantic answer body: the v2 answer format's JSON, as the scripted model writes it. */
const answerText = (text: string): string =>
  JSON.stringify({ schemaVersion: 1, body: text, ideas: [], goalCardDrafts: [] });

function queued(result: RequestSubmitResultV1): { requestRoot: QueryJobRef; round: QueryJobRef } {
  if (result.status !== 'queued') throw new Error(`S6A: the request was not queued: ${JSON.stringify(result)}`);
  return { requestRoot: result.requestRoot, round: result.round };
}

/** The day every row reads; the world opens at 09:00 on it. */
const DAY_FROM = '2026-10-23T00:00:00.000Z';
const DAY_TO = '2026-10-24T00:00:00.000Z';

/** One Query activity view through the public route; a refusal is named, never read as an empty list. */
async function queryActivity(world: S6AHostWorld, queryRunRef: QueryRunRef): Promise<QueryActivityViewV1> {
  const answer = await world.post('activity/queries', { scope: S6A_SCOPE, input: { refs: [queryRunRef] } });
  if (answer.httpStatus !== 200) {
    throw new Error(`S6A: activity/queries answered ${answer.httpStatus}: ${JSON.stringify(answer.body)}`);
  }
  const body = answer.body as ReadResult<QueryActivityViewV1[]>;
  if (body.status !== 'ready') throw new Error(`S6A: activity/queries was not ready: ${JSON.stringify(body)}`);
  expect(body.value).toHaveLength(1);
  return body.value[0]!;
}

/** The workspace or Goal calendar of the day, hour by hour, through the public route. */
async function dayCalendar(world: S6AHostWorld, scope: ActivityCalendarScope): Promise<ActivityCalendarV1> {
  const answer = await world.post('activity/calendar', { scope: S6A_SCOPE, input: {
    scope, from: DAY_FROM, to: DAY_TO, granularity: 'hour', timeZone: 'UTC',
  } });
  if (answer.httpStatus !== 200) {
    throw new Error(`S6A: activity/calendar answered ${answer.httpStatus}: ${JSON.stringify(answer.body)}`);
  }
  const body = answer.body as ReadResult<ActivityCalendarV1>;
  if (body.status !== 'ready') throw new Error(`S6A: activity/calendar was not ready: ${JSON.stringify(body)}`);
  return body.value;
}

function hourCell(value: ActivityCalendarV1, hour: number) {
  const cell = value.cells.find(candidate => candidate.localHour === hour);
  if (cell === undefined) throw new Error(`S6A: no calendar cell for local hour ${String(hour)}`);
  return cell;
}

function cellWithTasks(value: ActivityCalendarV1) {
  const cell = value.cells.find(candidate => candidate.tasks.length > 0);
  if (cell === undefined) throw new Error('S6A: no calendar cell carries a task');
  return cell;
}

const backends = ['memory', 'sqlite'] as const;

describe('the Query activity reads of one ended QueryRun', () => {
  it.each(backends)('counts the three real tool calls of a secretary round and places them on its Goal (%s)',
    async backend => {
      const world = remember(await openS6AHostWorld({ backend, extraHostOptions: { requestDriver: 'on' } }));
      await ensureProjectPointers(world);
      const a = await world.createSecretary('a');
      await world.scripted.script(a, [
        { kind: 'calls', calls: [{ callId: 's6a-read-list-1', name: 'list_files', args: { prefix: '.' } }] },
        { kind: 'calls', calls: [{ callId: 's6a-read-list-2', name: 'list_files', args: { prefix: '.' } }] },
        { kind: 'calls', calls: [{ callId: 's6a-read-list-3', name: 'list_files', args: { prefix: '.' } }] },
        { kind: 'text', text: answerText('S6A read answer') },
      ]);
      // One hold per model request: each is released a minute after the previous,
      // so the three booked calls fall at 10:05, 10:06 and 10:07.
      const holds = [
        await world.gates.modelRequest(a),
        await world.gates.modelRequest(a),
        await world.gates.modelRequest(a),
      ];
      const submitted = queued(await world.submit({ commandId: 's6a-read-round-1', goalId: S6A_GOAL_1.goalId,
        text: 'S6A read request', recipient: a }));
      const minutes = ['2026-10-23T10:05:00.000Z', '2026-10-23T10:06:00.000Z', '2026-10-23T10:07:00.000Z'];
      for (const [index, hold] of holds.entries()) {
        await hold.reached;
        world.clock.set(minutes[index]!);
        hold.release();
      }
      const ended = await world.waitForRequest(submitted.requestRoot,
        current => current.rounds[0]?.status === 'ended', 'the round answers');
      expect(ended.rounds[0]).toMatchObject({ status: 'ended', answer: 'S6A read answer', session: a.ref });
      const query = await readQuery(world.ag2b, submitted.round);
      expect(await queryActivity(world, query.run.ref)).toMatchObject({
        queryRunRef: query.run.ref,
        status: 'counted', reason: null, error: false,
        totals: { steps: 3, edits: 0 },
        recordedBy: 'query_end',
        countedThroughTurnEnd: true, unresolvedCalls: 0,
        sessionRef: a.ref, askedSessionRef: null, goalId: S6A_GOAL_1.goalId,
      });

      // The workspace day: the queries' three steps are the cell's three steps,
      // and a Query adds no task entry.
      const workspace = await dayCalendar(world, { kind: 'workspace' });
      expect(workspace.goalRef).toBeNull();
      expect(hourCell(workspace, 10)).toMatchObject({ steps: 3, querySteps: 3, tasks: [] });
      expect(workspace.totals).toMatchObject({ steps: 3, querySteps: 3 });

      // The round's own Goal shows the steps; the other Goal has no Query step
      // in any cell.
      const goalOne = await dayCalendar(world, { kind: 'goal', goalRef: S6A_GOAL_1 });
      expect(hourCell(goalOne, 10)).toMatchObject({ steps: 3, querySteps: 3 });
      expect(goalOne.totals).toMatchObject({ querySteps: 3 });
      const goalTwo = await dayCalendar(world, { kind: 'goal', goalRef: S6A_GOAL_2 });
      expect(goalTwo.totals.querySteps).toBe(0);
      expect(goalTwo.cells.every(cell => cell.querySteps === 0)).toBe(true);
    }, 120_000);

  it.each(backends)('counts the booked tool step of a bad answer (%s)', async backend => {
    const world = remember(await openS6AHostWorld({ backend, extraHostOptions: { requestDriver: 'on' } }));
    await ensureProjectPointers(world);
    const a = await world.createSecretary('a');
    await world.scripted.script(a, [
      { kind: 'calls', calls: [{ callId: 's6a-read-bad-1', name: 'list_files', args: { prefix: '.' } }] },
      { kind: 'text', text: 'this is not the answer format' },
    ]);
    const submitted = queued(await world.submit({ commandId: 's6a-read-bad-round', goalId: S6A_GOAL_1.goalId,
      text: 'S6A bad answer request', recipient: a }));
    await world.waitForRequest(submitted.requestRoot,
      current => current.rounds[0]?.status === 'ended', 'the bad answer closes the round');
    const query = await readQuery(world.ag2b, submitted.round);
    expect(query.job.job.closeReason).toMatchObject({ code: 'invalid_answer' });
    expect(query.run.run).toMatchObject({ status: 'closed' });
    expect(await queryActivity(world, query.run.ref)).toMatchObject({
      status: 'counted', reason: null, error: false,
      totals: { steps: 1 },
      recordedBy: 'query_end',
    });
  }, 120_000);
});

describe('the calendar of a Query that has started and not ended', () => {
  it.each(backends)('counts the running round in progress and the day is not complete (%s)', async backend => {
    const world = remember(await openS6AHostWorld({ backend, extraHostOptions: { requestDriver: 'on' } }));
    await ensureProjectPointers(world);
    const a = await world.createSecretary('a');
    await world.scripted.script(a, [{ kind: 'text', text: answerText('S6A running answer') }]);
    // The round's one model request is held: its start commit has landed and
    // it has not ended, so it has no activity record yet.
    const hold = await world.gates.modelRequest(a);
    const submitted = queued(await world.submit({ commandId: 's6a-read-running-1', goalId: S6A_GOAL_1.goalId,
      text: 'S6A running request', recipient: a }));
    await hold.reached;
    world.clock.set('2026-10-23T09:30:00.000Z');

    // Started at 09:00 and still running at 09:30: the 09:00 cell holds one
    // Query in progress, so neither that cell nor the day is complete.
    const workspace = await dayCalendar(world, { kind: 'workspace' });
    expect(workspace.coverage.queries.runsInProgress).toBe(1);
    expect(hourCell(workspace, 9)).toMatchObject({ inProgressQueries: 1, querySteps: 0, complete: false });
    expect(workspace.totals.complete).toBe(false);
    // The round's own Goal shows it the same way; the other Goal does not.
    const goalOne = await dayCalendar(world, { kind: 'goal', goalRef: S6A_GOAL_1 });
    expect(goalOne.coverage.queries.runsInProgress).toBe(1);
    expect(hourCell(goalOne, 9)).toMatchObject({ inProgressQueries: 1, complete: false });
    const goalTwo = await dayCalendar(world, { kind: 'goal', goalRef: S6A_GOAL_2 });
    expect(goalTwo.coverage.queries.runsInProgress).toBe(0);
    expect(goalTwo.totals.complete).toBe(true);

    hold.release();
    await world.waitForRequest(submitted.requestRoot,
      current => current.rounds[0]?.status === 'ended', 'the held round answers');
  }, 120_000);
});

describe('the not-entered Query activity of the empty write paths', () => {
  it.each(backends)('reads a request dropped before any claim as not_entered, never zero (%s)', async backend => {
    const world = remember(await openS6AHostWorld({ backend }));
    await ensureProjectPointers(world);
    const b = await world.createSecretary('b');
    // The request driver is off: the round waits on B unclaimed until the drop
    // ends it, so it never entered the Kernel and writes no activity record.
    const submitted = queued(await world.submit({ commandId: 's6a-read-drop-1', goalId: S6A_GOAL_1.goalId,
      text: 'S6A dropped request', recipient: b }));
    expect(await world.drop({ commandId: 's6a-read-drop-2', round: submitted.round })).toMatchObject({ status: 'routed' });
    const query = await readQuery(world.ag2b, submitted.round);
    expect(query.run.run).toMatchObject({ status: 'closed', outcome: 'not_entered' });
    expect(query.run.run.endedAt).not.toBeNull();
    expect(query.run.run.executionState).toBeUndefined();
    expect(await queryActivity(world, query.run.ref)).toMatchObject({
      status: 'not_entered', reason: null, error: false,
      totals: { steps: 0, edits: 0, editsUnknown: 0 },
      changedFiles: { definite: 0, possible: 0, possiblyIncomplete: false },
      recordedBy: null, sessionRef: null,
    });
    const workspace = await dayCalendar(world, { kind: 'workspace' });
    expect(workspace.coverage.queries.runsNotEntered).toBe(1);
  }, 120_000);

  it('reads a round whose Host crashed before the Kernel entry as not_entered (SQLite only)', async () => {
    const world = remember(await openS6AHostWorld({ backend: 'sqlite',
      extraHostOptions: { requestDriver: 'on' } }));
    await ensureProjectPointers(world);
    const a = await world.createSecretary('a');
    await world.setResumeOnStartup(true);
    // The start commit has landed and the Kernel has not been entered; the
    // abandoned Host keeps that step held while the next Host reconciles.
    const entry = await world.gates.beforeKernel(a);
    const submitted = queued(await world.submit({ commandId: 's6a-read-crash-1', goalId: S6A_GOAL_1.goalId,
      text: 'S6A crashed request', recipient: a }));
    await entry.reached;
    // The crashed attempt's own ref: the restarted Host starts a new attempt on
    // the same round, so the Job points at that one from here on.
    const crashed = (await readQuery(world.ag2b, submitted.round)).run.ref;
    await world.crash({ extraHostOptions: { requestDriver: 'on' } });
    // The round was claimed, so the view carries the claiming line; the tally is
    // still the Work view's zeros because no Kernel record was ever read.
    expect(await queryActivity(world, crashed)).toMatchObject({
      status: 'not_entered', reason: null, error: false,
      totals: { steps: 0, edits: 0, editsUnknown: 0 },
      recordedBy: null, sessionRef: a.ref,
    });
    const workspace = await dayCalendar(world, { kind: 'workspace' });
    expect(workspace.coverage.queries.runsNotEntered).toBe(1);
  }, 180_000);
});

describe('the workspace calendar keeps two Goals\' same task id apart', () => {
  it.each(backends)('shows one task entry per Goal for ag2b-work and filters by Goal (%s)', async backend => {
    const notices = await openS6ANoticesWorld({ backend });
    remember(notices.world);
    // One automatic rework per Goal runs its `ag2b-work` Run with one real tool
    // step and then fails, so each Goal's activity record is one step on the
    // same task id.
    await notices.rework({ label: 's6a-read-goal-1', goal: notices.world.goals.first, taskId: AG2B_WORK_TASK_ID });
    await notices.rework({ label: 's6a-read-goal-2', goal: notices.world.goals.second, taskId: AG2B_WORK_TASK_ID });

    const workspace = await dayCalendar(notices.world, { kind: 'workspace' });
    const cell = cellWithTasks(workspace);
    expect(cell.tasks).toHaveLength(2);
    expect(cell.tasks.find(task => task.goalId === S6A_GOAL_1.goalId)).toEqual({
      taskId: 'ag2b-work', goalId: S6A_GOAL_1.goalId, steps: 1, edits: 0, checks: 0,
    });
    expect(cell.tasks.find(task => task.goalId === S6A_GOAL_2.goalId)).toEqual({
      taskId: 'ag2b-work', goalId: S6A_GOAL_2.goalId, steps: 1, edits: 0, checks: 0,
    });

    const goalOne = cellWithTasks(await dayCalendar(notices.world, { kind: 'goal', goalRef: S6A_GOAL_1 }));
    expect(goalOne.tasks).toHaveLength(1);
    expect(goalOne.tasks[0]).toMatchObject({ taskId: 'ag2b-work', goalId: S6A_GOAL_1.goalId, steps: 1 });
    const goalTwo = cellWithTasks(await dayCalendar(notices.world, { kind: 'goal', goalRef: S6A_GOAL_2 }));
    expect(goalTwo.tasks).toHaveLength(1);
    expect(goalTwo.tasks[0]).toMatchObject({ taskId: 'ag2b-work', goalId: S6A_GOAL_2.goalId, steps: 1 });
  }, 180_000);
});

describe('the Query activity read and the platform close', () => {
  it.each(backends)('answers unavailable once the platform has closed (%s)', async backend => {
    const world = remember(await openS6AHostWorld({ backend }));
    await ensureProjectPointers(world);
    const b = await world.createSecretary('b');
    const submitted = queued(await world.submit({ commandId: 's6a-read-close-1', goalId: S6A_GOAL_1.goalId,
      text: 'S6A read after close request', recipient: b }));
    await world.drop({ commandId: 's6a-read-close-2', round: submitted.round });
    const query = await readQuery(world.ag2b, submitted.round);
    const ctx = world.humanContext();
    const platform = world.platform;
    expect(await platform.activity.readQueryActivities(ctx, { refs: [query.run.ref] }))
      .toMatchObject({ status: 'ready', value: [{ queryRunRef: query.run.ref, status: 'not_entered' }] });

    // The Host and its platform close. The read is one of the reads the close
    // drains, so from then on the platform refuses it itself and never reaches
    // the closed store.
    await world.close();
    expect(await platform.activity.readQueryActivities(ctx, { refs: [query.run.ref] }))
      .toEqual({ status: 'rejected', code: 'unavailable', reason: 'platform is closing' });
  }, 120_000);
});

describe('rejects: activity/queries reference counts', () => {
  it.each(backends)('refuses an empty reference list (%s)', async backend => {
    const world = remember(await openS6AHostWorld({ backend }));
    await ensureProjectPointers(world);
    const b = await world.createSecretary('b');
    const submitted = queued(await world.submit({ commandId: 's6a-read-reject-1', goalId: S6A_GOAL_1.goalId,
      text: 'S6A rejected count request', recipient: b }));
    await world.drop({ commandId: 's6a-read-reject-2', round: submitted.round });
    const query = await readQuery(world.ag2b, submitted.round);
    const before = await queryActivity(world, query.run.ref);
    const answer = await world.post('activity/queries', { scope: S6A_SCOPE, input: { refs: [] } });
    expect(answer.body).toMatchObject({ status: 'rejected', code: 'invalid' });
    // The prior Query still reads the same: the refusal wrote nothing.
    expect(await queryActivity(world, query.run.ref)).toEqual(before);
  }, 120_000);

  it.each(backends)('refuses more than 200 references (%s)', async backend => {
    const world = remember(await openS6AHostWorld({ backend }));
    await ensureProjectPointers(world);
    const b = await world.createSecretary('b');
    const submitted = queued(await world.submit({ commandId: 's6a-read-reject-many-1', goalId: S6A_GOAL_1.goalId,
      text: 'S6A many references request', recipient: b }));
    await world.drop({ commandId: 's6a-read-reject-many-2', round: submitted.round });
    const query = await readQuery(world.ag2b, submitted.round);
    const before = await queryActivity(world, query.run.ref);
    const refs: QueryRunRef[] = Array.from({ length: 201 }, (_unused, index) => ({
      aggregateType: 'QueryRun' as const, projectId: S6A_SCOPE.projectId,
      workspaceId: S6A_SCOPE.workspaceId,
      queryJobId: `s6a-read-many-${String(index)}`, runId: `s6a-read-many-run-${String(index)}`,
    }));
    const answer = await world.post('activity/queries', { scope: S6A_SCOPE, input: { refs } });
    expect(answer.body).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await queryActivity(world, query.run.ref)).toEqual(before);
  }, 120_000);
});
