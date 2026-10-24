/**
 * L16: where a readonly copy's Query counts, through the real Host.
 *
 * Data, all through public steps of the frozen request world: a secretary `a`
 * answers one plain Query on goal 1 at 10:00 (`occupy` + `finishQuery`), then
 * the real copy path (`workflow/consultation`) asks a readonly copy of `a` on
 * goal 1 at 11:00; the copy's one model call fails at the provider. Every
 * assertion reads the public `activity/calendar` and `activity/track` routes.
 *
 * - The Goal calendar filters a copy's Query by its Goal like any other Query,
 *   also when `sessionRefs` names the asked line: goal 2's calendar on `[a]`
 *   counts no Query, goal 1's counts the turn and the copy.
 * - The track draws a copy's Query once, as a consultation on the line it was
 *   asked from, whatever the order of `sessionRefs` and whether the copy, its
 *   source or both are named; the track does not filter a copy by its Goal.
 *   Each Query bar carries that Query's own activity view.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { ActivityCalendarV1 } from '../../src/core/work-graph/views/activity-read-model.js';
import type { TrackBarsPageV1, TrackQueryBarV1 } from '../../src/core/work-graph/views/track-read-model.js';
import {
  openS6ARequestWorld, S6A_GOAL_1, S6A_GOAL_2, S6A_SCOPE,
  type S6ABackend, type S6AQueryRefs, type S6ARequestWorld, type S6ASession,
} from '../helpers/S6A-request-fixture.js';
import type { QueryRunRef } from '../../src/contracts/query-job.js';

const worlds: S6ARequestWorld[] = [];

afterEach(async () => {
  const open = worlds.splice(0);
  await Promise.all(open.map(world => world.close()));
});

const DAY_FROM = '2026-10-23T00:00:00.000Z';
const DAY_TO = '2026-10-24T00:00:00.000Z';

type CopyWorld = {
  world: S6ARequestWorld; a: S6ASession; turn: S6AQueryRefs; copy: SessionRef; consultation: QueryRunRef;
};

/** `a`'s plain goal-1 turn at 10:00, then a readonly copy of `a` asked on goal 1 at 11:00. */
async function openCopyWorld(backend: S6ABackend): Promise<CopyWorld> {
  const world = await openS6ARequestWorld({ backend });
  worlds.push(world);
  const a = await world.createSecretary('a');
  world.clock.set('2026-10-23T10:00:00.000Z');
  const turn = await world.occupy(a);
  await world.finishQuery(turn);
  world.clock.set('2026-10-23T11:00:00.000Z');
  const made = await world.makeReadonlyCopy(a, 's6a-k-copy');
  world.clock.set('2026-10-23T12:00:00.000Z');
  return { world, a, turn, copy: made.copy.ref, consultation: made.query.queryRunRef };
}

async function goalCalendar(world: S6ARequestWorld, goalRef: GoalRef, sessionRefs: SessionRef[]): Promise<ActivityCalendarV1> {
  const answer = await world.post('activity/calendar', { scope: S6A_SCOPE, input: {
    scope: { kind: 'goal', goalRef }, from: DAY_FROM, to: DAY_TO, granularity: 'hour', timeZone: 'UTC', sessionRefs,
  } });
  if (answer.httpStatus !== 200) throw new Error(`S6A: activity/calendar answered ${answer.httpStatus}: ${JSON.stringify(answer.body)}`);
  const body = answer.body as ReadResult<ActivityCalendarV1>;
  if (body.status !== 'ready') throw new Error(`S6A: activity/calendar was not ready: ${JSON.stringify(body)}`);
  return body.value;
}

/** The Query bars of one track page (the request world has no Work Run and no check), with their activity facts. */
async function queryBars(world: S6ARequestWorld, goalRef: GoalRef, sessionRefs: SessionRef[]) {
  const answer = await world.post('activity/track', { scope: S6A_SCOPE, input: {
    goalRef, from: DAY_FROM, to: DAY_TO, cursor: null, limit: 50, sessionRefs,
  } });
  if (answer.httpStatus !== 200) throw new Error(`S6A: activity/track answered ${answer.httpStatus}: ${JSON.stringify(answer.body)}`);
  const body = answer.body as ReadResult<TrackBarsPageV1>;
  if (body.status !== 'ready') throw new Error(`S6A: activity/track was not ready: ${JSON.stringify(body)}`);
  expect(body.value.next).toBeNull();
  return body.value.bars
    .filter((bar): bar is TrackQueryBarV1 => bar.kind === 'query')
    .map(bar => ({ queryRunRef: bar.queryRunRef, sessionRef: bar.sessionRef, askedSessionRef: bar.askedSessionRef,
      via: bar.via, startAt: bar.startAt, endAt: bar.endAt, result: bar.result,
      activity: { queryRunRef: bar.activity.queryRunRef, status: bar.activity.status, recordedBy: bar.activity.recordedBy,
        sessionRef: bar.activity.sessionRef, askedSessionRef: bar.activity.askedSessionRef, goalId: bar.activity.goalId } }));
}

/**
 * The two bars, hand-written from the steps: `a`'s answered turn at 10:00 on its own line, and the copy's
 * failed Query at 11:00 drawn on the copy as a consultation asked from `a`. Each bar's activity is the
 * Query's own record: written at the Query's end, on the Session that ran it, the copy's naming `a` as asked.
 */
function expectedBars({ a, turn, copy, consultation }: CopyWorld) {
  return {
    turnBar: { queryRunRef: turn.queryRunRef, sessionRef: a.ref, askedSessionRef: null, via: 'turn',
      startAt: '2026-10-23T10:00:00.000Z', endAt: '2026-10-23T10:00:00.000Z', result: 'answered',
      activity: { queryRunRef: turn.queryRunRef, status: 'counted', recordedBy: 'query_end',
        sessionRef: a.ref, askedSessionRef: null, goalId: S6A_GOAL_1.goalId } },
    consultationBar: { queryRunRef: consultation, sessionRef: copy, askedSessionRef: a.ref, via: 'consultation',
      startAt: '2026-10-23T11:00:00.000Z', endAt: '2026-10-23T11:00:00.000Z', result: 'failed',
      activity: { queryRunRef: consultation, status: 'counted', recordedBy: 'query_end',
        sessionRef: copy, askedSessionRef: a.ref, goalId: S6A_GOAL_1.goalId } },
  };
}

describe.each(['memory', 'sqlite'] as const)('a readonly copy\'s Query in the activity reads (%s)', backend => {
  it('the Goal calendar filters a copy\'s Query by its Goal when sessionRefs names the asked line', async () => {
    const { world, a } = await openCopyWorld(backend);

    const otherGoal = await goalCalendar(world, S6A_GOAL_2, [a.ref]);
    expect(otherGoal.coverage.queries).toEqual({
      runsCounted: 0, runsRecordedLate: 0, runsNotEntered: 0, runsInProgress: 0, runsUncounted: [],
      runsUnplaced: 0, checksUnplaced: 0, runsSessionUnknown: 0, checksGateUnplaced: 0,
    });
    // Goal 1 on the same line: `a`'s turn and the copy asked from `a`.
    const ownGoal = await goalCalendar(world, S6A_GOAL_1, [a.ref]);
    expect(ownGoal.coverage.queries.runsCounted).toBe(2);
  });

  it('the track draws a copy\'s Query once, as a consultation on the asked line, in any sessionRefs order', async () => {
    const opened = await openCopyWorld(backend);
    const { world, a, copy } = opened;
    const { turnBar, consultationBar } = expectedBars(opened);

    expect(await queryBars(world, S6A_GOAL_1, [a.ref])).toEqual([turnBar, consultationBar]);
    expect(await queryBars(world, S6A_GOAL_1, [a.ref, copy])).toEqual([turnBar, consultationBar]);
    expect(await queryBars(world, S6A_GOAL_1, [copy, a.ref])).toEqual([turnBar, consultationBar]);
    // Only the copy named: still a consultation asked from `a`, never a turn of the copy.
    expect(await queryBars(world, S6A_GOAL_1, [copy])).toEqual([consultationBar]);
  });

  it('the track does not filter a copy by its Goal, and still filters a plain turn by its Goal', async () => {
    const opened = await openCopyWorld(backend);
    const { world, a, copy } = opened;
    const { consultationBar } = expectedBars(opened);

    expect(await queryBars(world, S6A_GOAL_2, [a.ref])).toEqual([consultationBar]);
    expect(await queryBars(world, S6A_GOAL_2, [copy, a.ref])).toEqual([consultationBar]);
  });
});
