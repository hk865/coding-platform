/**
 * One secretary round's Query activity, and the readonly copy asked from its
 * line: three real graph tool calls are three steps and no edit, the goal's
 * hourly cell and the Query's track bar carry the same numbers, the copy's
 * Query (two calls, at 10:20 and 10:21) counts on the line it was asked from
 * and never twice, and a Host restart with one more backfill adds nothing. A
 * store failure of the ending commit leaves neither the end nor the activity;
 * the live Host's own retry writes both in one commit, and observing the
 * settled Query again changes nothing. The data come from the Host's public
 * routes and a scripted model; every expected number is hand-computed (spec
 * `slice-6-SPEC.md:419`, L16).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { ActivityBackfillBatchV1 } from '../../src/business/workflow/contracts.js';
import type { QueryExecutionRecord } from '../../src/core/work-graph/queries/contracts.js';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import type { ActivityCalendarV1, QueryActivityViewV1 } from '../../src/core/work-graph/views/activity-read-model.js';
import type { TrackBarsPageV1, TrackQueryBarV1 } from '../../src/core/work-graph/views/track-read-model.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { activityBoundary, queryEndCommitOf } from '../helpers/S6A-activity-boundary.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { initializeProject, secretaryAnswer } from '../helpers/S6A-history-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import {
  S6A_GOAL_1, S6A_SCOPE, S6A_SECRETARY_ROLE_BINDING,
  type S6ABackend, type S6ASession,
} from '../helpers/S6A-request-fixture.js';
import { AG2B_CONSUMER_ID, AG2B_QUERY_BUDGET, AG2B_RUNTIME_BUDGET, graphWrite } from '../helpers/AG2b-collaboration-fixture.js';

// The frozen activity boundary (tests/helpers/S6A-activity-boundary.ts) replaces the barrier's two mocks; it builds
// the barrier's module first, so the world's gates and the boundary's arms work together.
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-activity-boundary.js')).inMemoryActivityBoundaryModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-activity-boundary.js')).sqliteActivityBoundaryModule(importOriginal));

const BACKENDS: readonly S6ABackend[] = ['memory', 'sqlite'];
const worlds: S6AHostWorld[] = [];

afterEach(async () => {
  const unfired = activityBoundary.reset();
  const held = commitBarrier.reset();
  const open = worlds.splice(0);
  await Promise.allSettled(open.map(world => world.close()));
  expect(unfired).toEqual([]);
  expect(held).toEqual([]);
});

function remember(world: S6AHostWorld): S6AHostWorld {
  worlds.push(world);
  return world;
}

/** The spec row's day, hand-written from `slice-6-SPEC.md:419`. */
const DAY = { from: '2026-10-16T00:00:00.000Z', to: '2026-10-17T00:00:00.000Z' };
/** The minutes of the round's three calls and of the copy's two calls (`slice-6-SPEC.md:419`). */
const ROUND_MINUTES = ['2026-10-16T10:05:00.000Z', '2026-10-16T10:06:00.000Z', '2026-10-16T10:07:00.000Z'];
const COPY_MINUTES = ['2026-10-16T10:20:00.000Z', '2026-10-16T10:21:00.000Z'];

async function queryActivity(world: S6AHostWorld, runRef: QueryRunRef): Promise<QueryActivityViewV1> {
  const answer = await world.post('activity/queries', { scope: S6A_SCOPE, input: { refs: [runRef] } });
  if (answer.httpStatus !== 200) throw new Error(`S6A: activity/queries answered ${answer.httpStatus}: ${JSON.stringify(answer.body)}`);
  const body = answer.body as ReadResult<QueryActivityViewV1[]>;
  if (body.status !== 'ready') throw new Error(`S6A: activity/queries was not ready: ${JSON.stringify(body)}`);
  const view = body.value[0];
  if (view === undefined) throw new Error('S6A: activity/queries returned no view');
  return view;
}

async function calendar(world: S6AHostWorld, input: { goalRef?: GoalRef; sessionRefs: SessionRef[] }): Promise<ActivityCalendarV1> {
  const answer = await world.post('activity/calendar', { scope: S6A_SCOPE, input: {
    scope: input.goalRef === undefined ? { kind: 'workspace' } : { kind: 'goal', goalRef: input.goalRef },
    ...DAY, granularity: 'hour', timeZone: 'UTC', sessionRefs: input.sessionRefs,
  } });
  if (answer.httpStatus !== 200) throw new Error(`S6A: activity/calendar answered ${answer.httpStatus}: ${JSON.stringify(answer.body)}`);
  const body = answer.body as ReadResult<ActivityCalendarV1>;
  if (body.status !== 'ready') throw new Error(`S6A: activity/calendar was not ready: ${JSON.stringify(body)}`);
  return body.value;
}

/** The Query bars of one track page (this world runs no Work and no check), with each bar's activity view. */
async function queryBars(world: S6AHostWorld, sessionRefs: SessionRef[]): Promise<TrackQueryBarV1[]> {
  const answer = await world.post('activity/track', { scope: S6A_SCOPE, input: {
    goalRef: S6A_GOAL_1, ...DAY, cursor: null, limit: 50, sessionRefs,
  } });
  if (answer.httpStatus !== 200) throw new Error(`S6A: activity/track answered ${answer.httpStatus}: ${JSON.stringify(answer.body)}`);
  const body = answer.body as ReadResult<TrackBarsPageV1>;
  if (body.status !== 'ready') throw new Error(`S6A: activity/track was not ready: ${JSON.stringify(body)}`);
  return body.value.bars.filter((bar): bar is TrackQueryBarV1 => bar.kind === 'query');
}

async function backfill(world: S6AHostWorld): Promise<ActivityBackfillBatchV1> {
  const answer = await world.post('activity/backfill', { scope: S6A_SCOPE, input: {
    workspace: { ...S6A_SCOPE }, ...DAY, cursor: null,
  } });
  if (answer.httpStatus !== 200) throw new Error(`S6A: activity/backfill answered ${answer.httpStatus}: ${JSON.stringify(answer.body)}`);
  const body = answer.body as ReadResult<ActivityBackfillBatchV1>;
  if (body.status !== 'ready') throw new Error(`S6A: activity/backfill was not ready: ${JSON.stringify(body)}`);
  return body.value;
}

const roundOf = (view: RequestCoreViewV1, round: QueryJobRef) =>
  view.rounds.find(entry => entry.ref.queryJobId === round.queryJobId);

/** One secretary round of three graph calls at the row's three minutes, answered; its QueryRunRef. */
async function threeCallRound(world: S6AHostWorld, session: S6ASession, commandId: string): Promise<QueryRunRef> {
  await world.scripted.script(session, [
    { kind: 'calls', calls: [{ callId: `${commandId}-look-1`, name: 'look_graph', args: { mode: 'path', path: 'src' } }] },
    { kind: 'calls', calls: [{ callId: `${commandId}-find`, name: 'find_graph', args: { needle: 'src' } }] },
    { kind: 'calls', calls: [{ callId: `${commandId}-look-2`, name: 'look_graph', args: { mode: 'path', path: 'src' } }] },
    { kind: 'text', text: secretaryAnswer({ body: `${commandId} answer` }) },
  ]);
  const holds = [await world.gates.modelRequest(session), await world.gates.modelRequest(session),
    await world.gates.modelRequest(session)];
  const submitted = await world.submit({ commandId, goalId: S6A_GOAL_1.goalId, text: `S6A activity ${commandId}`,
    recipient: session });
  if (submitted.status !== 'queued') throw new Error(`S6A: the request was not queued: ${JSON.stringify(submitted)}`);
  for (const [index, hold] of holds.entries()) {
    await hold.reached;
    world.clock.set(ROUND_MINUTES[index]!);
    hold.release();
  }
  const view = await world.waitForRequest(submitted.requestRoot,
    current => roundOf(current, submitted.round)?.status === 'ended', 'the three-call round answers');
  expect(roundOf(view, submitted.round)).toMatchObject({ status: 'ended', answer: `${commandId} answer` });
  return (await readQuery(world.ag2b, submitted.round)).run.ref;
}

/**
 * The existing ask-a-copy entry with a copy that makes two real tool calls. The consultation route creates the copy
 * Session and records the fixed derivation before it reads the Goal; its first call names a Goal that does not exist,
 * so it answers rejected after the copy's Kernel Session exists. The copy's Session is then given its scripted model
 * (two `look_graph` calls and an answer) and the route is called again with goal g1: the recorded derivation is
 * reused. That call is started and not awaited; each of the copy's two model requests is held at a gate, where the
 * Kernel's clock is set to 10:20 and then 10:21 before it goes on, so the two calls land a minute apart. The person's
 * consultation asks for no run timeout (`timeoutMs: null`, a value the route takes): the AG2b budget's 60 s cap
 * would end the copy's run as `timeout` when the clock steps from the round's 10:07 to 10:20.
 */
async function copyWithTwoCalls(world: S6AHostWorld, source: S6ASession):
  Promise<{ session: SessionRef; runRef: QueryRunRef }> {
  const sent = await world.post('messages/send', graphWrite(S6A_SCOPE, {
    recipient: source.ref, text: 'S6A activity copy question', intent: 'inquiry', needsReply: true,
  }, 's6a-activity-copy-send'));
  const sentBody = sent.body as { status: string; value?: { ref: unknown } };
  if (sentBody.status !== 'committed') throw new Error(`S6A: the inquiry did not commit: ${JSON.stringify(sent.body)}`);
  const messageRef = sentBody.value!.ref;
  const consultation = async (goalRef: GoalRef): Promise<unknown> => (await world.post('workflow/consultation', {
    scope: S6A_SCOPE, input: { schemaVersion: 1, messageRef, goalRef, roleBinding: S6A_SECRETARY_ROLE_BINDING,
      runtimeBudget: { ...AG2B_RUNTIME_BUDGET, timeoutMs: null }, budget: AG2B_QUERY_BUDGET, consumerId: AG2B_CONSUMER_ID },
  })).body;
  // 1. The copy's Session is created and its derivation recorded before the Goal read refuses the call.
  const missing = { aggregateType: 'Goal' as const, projectId: S6A_SCOPE.projectId, goalId: 's6a-activity-no-such-goal' };
  expect(await consultation(missing)).toMatchObject({ status: 'rejected' });
  const message = await world.post('messages/read', { scope: S6A_SCOPE, input: messageRef });
  const messageBody = message.body as ReadResult<{ consultationDerivation?: { childSessionRef: SessionRef } }>;
  if (messageBody.status !== 'ready') throw new Error(`S6A: messages/read was not ready: ${JSON.stringify(message.body)}`);
  const childRef = messageBody.value.consultationDerivation?.childSessionRef;
  if (childRef === undefined) throw new Error(`S6A: the inquiry recorded no copy: ${JSON.stringify(messageBody.value)}`);
  const card = await world.readSession(childRef);
  const copySession: S6ASession = { label: 'copy', ref: childRef, aggregateRef: card.record.ref,
    role: card.record.role, createdAt: card.record.createdAt };
  await world.scripted.script(copySession, [
    { kind: 'calls', calls: [{ callId: 's6a-activity-copy-1', name: 'look_graph', args: { mode: 'path', path: 'src' } }] },
    { kind: 'calls', calls: [{ callId: 's6a-activity-copy-2', name: 'look_graph', args: { mode: 'path', path: 'src' } }] },
    { kind: 'text', text: 'S6A activity copy answer' },
  ]);
  // 2. The same entry again with goal g1, its two model requests held one after the other.
  const holds = [await world.gates.modelRequest(copySession), await world.gates.modelRequest(copySession)];
  const running = consultation(S6A_GOAL_1);
  const endedEarly = running.then(body => {
    throw new Error(`S6A: the consultation ended before the copy's model request was held: ${JSON.stringify(body).slice(0, 400)}`);
  });
  endedEarly.catch(() => undefined);
  for (const [index, hold] of holds.entries()) {
    await Promise.race([hold.reached, endedEarly]);
    world.clock.set(COPY_MINUTES[index]!);
    hold.release();
  }
  const second = await running as { status: string; value?: { query?: { run?: { ref?: QueryRunRef } } } };
  if (second.status !== 'ready') throw new Error(`S6A: the consultation was refused: ${JSON.stringify(second).slice(0, 400)}`);
  const runRef = second.value?.query?.run?.ref;
  if (runRef === undefined) throw new Error(`S6A: the consultation returned no copy Query: ${JSON.stringify(second).slice(0, 400)}`);
  return { session: childRef, runRef };
}

describe.each(BACKENDS)('R-15: Query activity of a secretary round (%s)', (backend: S6ABackend) => {
  it('the round counts three steps, the goal calendar and the track show them, the copy counts once on the asked line, and a restart adds no record', async () => {
    const world = remember(await openS6AHostWorld({ backend, at: '2026-10-16T09:00:00.000Z',
      extraHostOptions: { requestDriver: 'on' }, secretaryTools: ['read', 'look_graph', 'find_graph'] }));
    await initializeProject(world);
    const s = await world.createSecretary('s');
    const runRef = await threeCallRound(world, s, 's6a-activity-r15');

    expect(await queryActivity(world, runRef)).toMatchObject({
      queryRunRef: runRef, status: 'counted', reason: null, error: false,
      totals: { steps: 3, edits: 0 }, recordedBy: 'query_end',
      sessionRef: s.ref, askedSessionRef: null, goalId: S6A_GOAL_1.goalId,
    });

    const goal = await calendar(world, { goalRef: S6A_GOAL_1, sessionRefs: [s.ref] });
    const ten = goal.cells.find(cell => cell.localHour === 10);
    if (ten === undefined) throw new Error(`S6A: no 10:00 cell: ${JSON.stringify(goal.cells)}`);
    // Three steps, all of them the round's Query steps; the answer text is not a step.
    expect({ steps: ten.steps, querySteps: ten.querySteps, edits: ten.edits }).toEqual({ steps: 3, querySteps: 3, edits: 0 });

    const bars = await queryBars(world, [s.ref]);
    expect(bars).toHaveLength(1);
    // The round answered after its third call, at 10:07.
    expect(bars[0]).toMatchObject({ queryRunRef: runRef, sessionRef: s.ref, askedSessionRef: null, via: 'turn',
      result: 'answered', endAt: ROUND_MINUTES[2],
      activity: { status: 'counted', recordedBy: 'query_end', totals: { steps: 3, edits: 0 } } });

    // The existing ask-a-copy entry: an inquiry to S, and the copy's Query runs with two real tool calls of its own.
    const copy = await copyWithTwoCalls(world, s);
    expect(await queryActivity(world, copy.runRef)).toMatchObject({
      queryRunRef: copy.runRef, status: 'counted', recordedBy: 'query_end',
      sessionRef: copy.session, askedSessionRef: s.ref, goalId: S6A_GOAL_1.goalId,
      totals: { steps: 2, edits: 0 },
    });
    // The day holds 3 + 2 steps on the asked line, once; naming the copy too changes nothing.
    const asked = await calendar(world, { goalRef: S6A_GOAL_1, sessionRefs: [s.ref] });
    const both = await calendar(world, { goalRef: S6A_GOAL_1, sessionRefs: [s.ref, copy.session] });
    expect(asked.totals).toMatchObject({ steps: 5, querySteps: 5 });
    expect(both.totals).toEqual(asked.totals);
    expect(asked.coverage.queries.runsCounted).toBe(2);
    const copyBars = await queryBars(world, [s.ref]);
    expect(copyBars.map(bar => [bar.queryRunRef.runId, bar.via, bar.askedSessionRef?.sessionId ?? null]))
      .toEqual([[runRef.runId, 'turn', null], [copy.runRef.runId, 'consultation', s.ref.sessionId]]);
    // The copy answered after its second call, at 10:21.
    expect(copyBars[1]).toMatchObject({ endAt: COPY_MINUTES[1],
      activity: { status: 'counted', totals: { steps: 2, edits: 0 }, askedSessionRef: s.ref } });

    if (backend === 'sqlite') {
      // A real restart after the copy, then one more backfill: nothing is missing, so it processes nothing, and the
      // line still holds 5 steps, with or without the copy named.
      await world.reopen();
      expect((await backfill(world)).processed).toEqual([]);
      for (const sessionRefs of [[s.ref], [s.ref, copy.session]]) {
        expect((await calendar(world, { goalRef: S6A_GOAL_1, sessionRefs })).totals).toMatchObject({ steps: 5, querySteps: 5 });
      }
      expect(await queryActivity(world, runRef)).toMatchObject({ status: 'counted', recordedBy: 'query_end',
        totals: { steps: 3, edits: 0 } });
      expect(await queryActivity(world, copy.runRef)).toMatchObject({ status: 'counted', recordedBy: 'query_end',
        totals: { steps: 2, edits: 0 } });
    }
  }, 180_000);
});

describe.each(BACKENDS)('R-15: the terminal commit fails once (%s)', (backend: S6ABackend) => {
  it('the failed terminal commit writes neither the end nor the activity; the Host retry writes both, and observing again changes nothing', async () => {
    const world = remember(await openS6AHostWorld({ backend, at: '2026-10-16T09:00:00.000Z',
      extraHostOptions: { requestDriver: 'on' }, secretaryTools: ['read', 'look_graph', 'find_graph'] }));
    await initializeProject(world);
    const s = await world.createSecretary('s');
    await world.scripted.script(s, [
      { kind: 'calls', calls: [{ callId: 's6a-activity-reject-1', name: 'look_graph', args: { mode: 'path', path: 'src' } }] },
      { kind: 'text', text: secretaryAnswer({ body: 'S6A reject answer' }) },
    ]);
    // The store fails the first commit that ends this Query; the next one (the live Host's own retry of the same
    // terminal observation, after the refused one) is held before it reaches the store.
    const reject = activityBoundary.rejectQueryEnd({ session: s.ref }, 'R-15 terminal commit');
    const retry = commitBarrier.hold(commit => reject.fired() === 1 && queryEndCommitOf({ session: s.ref })(commit),
      'R-15 the terminal retry');
    const call = await world.gates.modelRequest(s);
    const submitted = await world.submit({ commandId: 's6a-activity-reject-1', goalId: S6A_GOAL_1.goalId,
      text: 'S6A activity reject request', recipient: s });
    if (submitted.status !== 'queued') throw new Error(`S6A: the request was not queued: ${JSON.stringify(submitted)}`);
    await call.reached;
    world.clock.set('2026-10-16T10:15:00.000Z');
    call.release();

    // The retry has arrived: the refused commit landed nothing, neither the end nor the activity.
    await retry.reached;
    expect(reject.fired()).toBe(1);
    const before = await readQuery(world.ag2b, submitted.round);
    const runRef = before.run.ref;
    expect(before.run.run).toMatchObject({ endedAt: null, outcome: null });
    expect(before.job.job.status).not.toBe('closed');
    expect(roundOf(await world.readRequest(submitted.requestRoot), submitted.round)).toMatchObject({ answer: null });
    expect(await queryActivity(world, runRef)).toMatchObject({ status: 'in_progress', recordedBy: null, totals: null });

    // Released, the retry lands the end and the activity together.
    retry.release();
    const view = await world.waitForRequest(submitted.requestRoot,
      current => roundOf(current, submitted.round)?.status === 'ended', 'the retry ends the round');
    expect(roundOf(view, submitted.round)).toMatchObject({ status: 'ended', answer: 'S6A reject answer' });
    const ended = await readQuery(world.ag2b, submitted.round);
    expect(ended.run.run.endedAt).not.toBeNull();
    const counted = await queryActivity(world, runRef);
    expect(counted).toMatchObject({ status: 'counted', recordedBy: 'query_end', totals: { steps: 1, edits: 0 } });

    // A replay: the public observation of the settled Query answers it as stored and writes nothing.
    const observed = await world.post('queries/observe', { scope: S6A_SCOPE, input: { queryRunRef: runRef } });
    expect(observed.httpStatus).toBe(200);
    const replay = observed.body as ReadResult<QueryExecutionRecord>;
    expect(replay).toMatchObject({ status: 'ready', value: { run: { ref: runRef, revision: ended.run.revision } } });
    expect((await readQuery(world.ag2b, submitted.round)).run.revision).toBe(ended.run.revision);
    expect(await queryActivity(world, runRef)).toEqual(counted);
  }, 180_000);
});
