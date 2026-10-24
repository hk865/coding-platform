/**
 * The main conversation's reads joined end to end, in one workspace: two goals
 * with three requests each, each read by goal and newest first, the first goal
 * by creation followed by the no-goal requests made before it; then the shared
 * cards on that same workspace, every card once on the page, in the queue and in
 * each of the goal's requests, none of the other goal's; reading leaves the
 * queue and the seen position alone; a card question becomes a follow-up round
 * of the same request, which stays one entry on the page. In a second world the
 * automatic-rework notices fold into one line with their member views, and a
 * request the Host's driver runs is the same QueryRun on the activity track and
 * the same request, with its follow-up, on the goal's page. The data are the
 * worlds' public steps only (spec `slice-6-SPEC.md:416`).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { DecisionCardV1, NoticeItemV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { ActivityCalendarV1 } from '../../src/core/work-graph/views/activity-read-model.js';
import type { TrackQueryBarV1, TrackBarsPageV1 } from '../../src/core/work-graph/views/track-read-model.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import {
  cardRefsOf, openS6ACardsWorld, openS6ANoticesWorld, seedS6AGoalOrder, seedS6ASharedCards,
  type S6ACardsWorkspace, type S6ACardsWorld, type S6ANoticesWorld, type S6ARequest,
} from '../helpers/S6A-cards-fixture.js';
import { secretaryAnswer } from '../helpers/S6A-history-fixture.js';
import { S6A_SCOPE, type S6ABackend } from '../helpers/S6A-request-fixture.js';

// The notices world uses the frozen commit barrier's gates; the two mocks are per test file.
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const BACKENDS: readonly S6ABackend[] = ['memory', 'sqlite'];
type World = S6ACardsWorld | S6ANoticesWorld;
const worlds: World[] = [];

afterEach(async () => {
  const held = commitBarrier.reset();
  const open = worlds.splice(0);
  await Promise.allSettled(open.map(world => world.close()));
  expect(held).toEqual([]);
});

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

type Page = {
  goalId: string | null;
  requests: ({ requestRoot: QueryJobRef; goalId: string | null; cardKeys: string[]; rounds: { ref: QueryJobRef }[] })[];
  cards: DecisionCardV1[];
  notices: (NoticeItemV1 & { memberViews?: NoticeItemV1[] })[];
  seenThrough: Record<string, unknown>;
  displayToken: string | null;
  next: unknown;
};

/** One `main/read` page; `cursor` is sent as given (null, or the `next` a page returned). */
async function readPage(workspace: S6ACardsWorkspace, goalId: string | null, cursor: unknown): Promise<Page> {
  const body = await workspace.route('main/read', { goalId, cursor });
  if (asRecord(body)['status'] !== 'ready') throw new Error(`S6A: main/read was not ready: ${JSON.stringify(body)}`);
  return asRecord(body)['value'] as Page;
}

/** `requests/ask` of one request's round with the card's pins, as the client sends them. */
async function ask(workspace: S6ACardsWorkspace, input: { label: string; round: QueryJobRef; card: DecisionCardV1;
  text: string }): Promise<Record<string, unknown>> {
  return asRecord(await workspace.route('requests/ask', {
    commandId: `s6a-j3-ask-${input.label}`, round: input.round, cardRefs: cardRefsOf(input.card),
    regenerate: false, text: input.text,
  }));
}

const roots = (page: Page): QueryJobRef[] => page.requests.map(entry => entry.requestRoot);
const newestFirst = (requests: readonly S6ARequest[]): QueryJobRef[] => requests.map(entry => entry.requestRoot).reverse();
const cardKeys = (page: Page): string[] => page.cards.map(card => card.cardKey);
const countOf = (keys: readonly string[], key: string): number => keys.filter(entry => entry === key).length;
/** The page's entries of one request root. */
const entriesOf = (page: Page, root: QueryJobRef) =>
  page.requests.filter(entry => entry.requestRoot.queryJobId === root.queryJobId);

describe.each(BACKENDS)('R-12 joined: two goals by creation, cards once, ask on the page (%s)', (backend: S6ABackend) => {
  it('two goals of three requests read newest first, the earlier no-goal requests after the first goal’s own, every card once, and a card question as a follow-up of the same request', async () => {
    const cards = await openS6ACardsWorld({ backend });
    worlds.push(cards);
    const workspace = cards.second;

    // The second workspace has no goal: two no-goal requests, the first goal, one more no-goal request, the second
    // goal with three requests, then three requests on the first goal.
    const order = await seedS6AGoalOrder(workspace, { label: 'j3', before: 2, after: 1, onAsked: 3, onFirst: 3 });
    const first = order.first.ref;
    const asked = order.asked.ref;
    // The first goal's page: its own three, newest first, then the no-goal requests made before it, newest first.
    // All five fit on one page (20 a page), so `next` is null; V1 already pages `main/read` across the 20 boundary on
    // the goal part and on the pre-goal part (tests/app/S6A-main-read.test.ts:174, :188), so this row sends the real
    // `next` back on one page instead of adding requests to cross it.
    const firstPage = await readPage(workspace, first.goalId, null);
    expect(firstPage.goalId).toBe(first.goalId);
    expect(roots(firstPage)).toEqual([...newestFirst(order.onFirst), ...newestFirst(order.before)]);
    expect(firstPage.next).toBeNull();
    const askedPage = await readPage(workspace, asked.goalId, null);
    expect(roots(askedPage)).toEqual(newestFirst(order.onAsked));
    expect(askedPage.next).toBeNull();
    // A no-goal request made after the first goal is in the no-goal view only.
    expect(roots(await readPage(workspace, null, null))).toEqual([order.after[0]!.requestRoot]);

    // The cards on the same workspace: a candidate for each of two more requests on the first goal, an independent
    // candidate on the second goal, and the first goal's own cards (no request), which belong to all its requests.
    const shared = await seedS6ASharedCards(workspace, { label: 'j3', goal: first, otherGoal: asked });
    const page = await readPage(workspace, first.goalId, null);
    expect(roots(page)).toEqual([...newestFirst(shared.requests), ...newestFirst(order.onFirst), ...newestFirst(order.before)]);
    const keys = cardKeys(page);
    const queueKeys = shared.all.map(card => card.cardKey);
    const goalRequests = page.requests.filter(entry => entry.goalId === first.goalId);
    expect(goalRequests).toHaveLength(5);
    // Each of the goal's own cards: once on the page, once in the queue, once in each of the goal's requests.
    for (const card of shared.goalCards) {
      expect(countOf(keys, card.cardKey)).toBe(1);
      expect(countOf(queueKeys, card.cardKey)).toBe(1);
      for (const entry of goalRequests) expect(countOf(entry.cardKeys, card.cardKey)).toBe(1);
    }
    // Each request's candidate: once on the page and once in its own request.
    for (const [index, candidate] of shared.candidates.entries()) {
      expect(countOf(keys, candidate.card.cardKey)).toBe(1);
      const [entry] = entriesOf(page, shared.requests[index]!.requestRoot);
      expect(countOf(entry!.cardKeys, candidate.card.cardKey)).toBe(1);
    }
    // None of the other goal's cards.
    for (const card of shared.otherGoalCards) expect(countOf(keys, card.cardKey)).toBe(0);
    // Reading wrote nothing: no notice, no token, and the page read again with its own `next` is the same.
    expect(page.notices).toEqual([]);
    expect(page.displayToken).toBeNull();
    expect(page.seenThrough).toEqual({});
    expect(await readPage(workspace, first.goalId, page.next)).toEqual(page);

    // A card question through `requests/ask` becomes a follow-up round of the SAME request.
    const [r1] = shared.requests;
    const answered = await ask(workspace, { label: 'card', round: r1.round, card: shared.candidates[0]!.card,
      text: 'S6A ask about this card' });
    expect(answered['status']).toBe('queued');
    const followup = answered['followupRound'] as QueryJobRef;
    // The page lists the request once, carrying exactly its round and the follow-up; no request is added.
    const after = await readPage(workspace, first.goalId, null);
    expect(roots(after)).toEqual(roots(page));
    const entries = entriesOf(after, r1.requestRoot);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.rounds.map(round => round.ref)).toEqual([r1.round, followup]);
  }, 180_000);
});

describe.each(BACKENDS)('R-12 joined: the notices, the seen position and the activity in one world (%s)', (backend: S6ABackend) => {
  it('a rework line with its members, an unchanged queue, and the same request on K’s track and on the goal page with its follow-up', async () => {
    const notices = await openS6ANoticesWorld({ backend, at: '2026-10-16T09:00:00.000Z',
      extraHostOptions: { requestDriver: 'on' }, secretaryTools: ['read', 'list_files'] });
    worlds.push(notices);
    const main = notices.main;
    const first = notices.world.goals.first;
    const seeded = await notices.seedReworkNotices();
    const [n1, , n3] = seeded.notices;

    // The goal's page folds the two rework notices into one line that carries their member views.
    const page = await readPage(main, first.goalId, null);
    expect(page.notices).toHaveLength(1);
    expect(page.notices[0]).toMatchObject({ category: 'automatic_rework' });
    expect(page.notices[0]!.memberViews?.map(notice => notice.itemKey)).toEqual([n1!.notice.itemKey, n3!.notice.itemKey]);
    expect(page.notices[0]!.members).toHaveLength(2);
    expect(page.seenThrough).toEqual({ automatic_rework: n1!.notice.position });
    expect(typeof page.displayToken).toBe('string');
    // Reading wrote nothing: the queue still shows all three, and a second read answers the same position.
    expect((await main.readNotices()).notices).toHaveLength(3);
    const again = await readPage(main, first.goalId, null);
    expect(again.notices).toEqual(page.notices);
    expect(again.seenThrough).toEqual(page.seenThrough);

    // A request on the first goal that the Host's driver runs with two tool calls: K's activity counts it ...
    const s = await notices.world.createSecretary('j3-s');
    await notices.world.scripted.script(s, [
      { kind: 'calls', calls: [{ callId: 's6a-j3-1', name: 'list_files', args: { prefix: '.' } }] },
      { kind: 'calls', calls: [{ callId: 's6a-j3-2', name: 'list_files', args: { prefix: '.' } }] },
      { kind: 'text', text: secretaryAnswer({ body: 'S6A j3 answer' }) },
    ]);
    const holds = [await notices.world.gates.modelRequest(s), await notices.world.gates.modelRequest(s)];
    const submitted = await notices.world.submit({ commandId: 's6a-j3-activity', goalId: first.goalId,
      text: 'S6A j3 activity request', recipient: s });
    if (submitted.status !== 'queued') throw new Error(`S6A: the request was not queued: ${JSON.stringify(submitted)}`);
    for (const [index, hold] of holds.entries()) {
      await hold.reached;
      notices.world.clock.set(index === 0 ? '2026-10-16T10:00:00.000Z' : '2026-10-16T10:01:00.000Z');
      hold.release();
    }
    await notices.world.waitForRequest(submitted.requestRoot,
      current => current.rounds.some(round => round.ref.queryJobId === submitted.round.queryJobId && round.status === 'ended'),
      'the joined request answers');
    // ... and the main read lists the same request once on the same goal's page.
    expect(entriesOf(await readPage(main, first.goalId, null), submitted.requestRoot)).toHaveLength(1);

    const calendarAnswer = await notices.world.post('activity/calendar', { scope: S6A_SCOPE, input: {
      scope: { kind: 'goal', goalRef: first }, from: '2026-10-16T00:00:00.000Z', to: '2026-10-17T00:00:00.000Z',
      granularity: 'hour', timeZone: 'UTC', sessionRefs: [s.ref],
    } });
    const calendarBody = calendarAnswer.body as ReadResult<ActivityCalendarV1>;
    if (calendarBody.status !== 'ready') throw new Error(`S6A: activity/calendar was not ready: ${JSON.stringify(calendarBody)}`);
    const ten = calendarBody.value.cells.find(cell => cell.localHour === 10);
    if (ten === undefined) throw new Error(`S6A: no 10:00 cell: ${JSON.stringify(calendarBody.value.cells)}`);
    expect({ steps: ten.steps, querySteps: ten.querySteps }).toEqual({ steps: 2, querySteps: 2 });
    const trackAnswer = await notices.world.post('activity/track', { scope: S6A_SCOPE, input: {
      goalRef: first, from: '2026-10-16T00:00:00.000Z', to: '2026-10-17T00:00:00.000Z', cursor: null, limit: 50,
      sessionRefs: [s.ref],
    } });
    const trackBody = trackAnswer.body as ReadResult<TrackBarsPageV1>;
    if (trackBody.status !== 'ready') throw new Error(`S6A: activity/track was not ready: ${JSON.stringify(trackBody)}`);
    const bars = trackBody.value.bars.filter((bar): bar is TrackQueryBarV1 => bar.kind === 'query');
    expect(bars).toHaveLength(1);
    // The track's bar is this round's own QueryRun.
    expect(bars[0]!.queryRunRef).toEqual((await readQuery(notices.world.ag2b, submitted.round)).run.ref);
    expect(bars[0]!.activity).toMatchObject({ status: 'counted', totals: { steps: 2, edits: 0 }, goalId: first.goalId });

    // A card question about a candidate of this goal, asked on this request's round, lands as its follow-up.
    const candidate = await main.proposeCandidate({ label: 'j3-candidate', goal: first, request: null });
    const card = (await main.readCards(first)).find(entry => entry.source.kind === 'candidate'
      && entry.source.pins.some(pin => asRecord(pin.ref)['proposalId'] === candidate.proposal.ref.proposalId));
    if (card === undefined) throw new Error('S6A: the candidate has no card');
    const asked = await ask(main, { label: 'rework', round: submitted.round, card, text: 'S6A ask in the notices world' });
    expect(asked['status']).toBe('queued');
    // The page lists the request once, with exactly the original round and the returned follow-up round.
    const entries = entriesOf(await readPage(main, first.goalId, null), submitted.requestRoot);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.rounds.map(round => round.ref)).toEqual([submitted.round, asked['followupRound']]);
  }, 240_000);
});
