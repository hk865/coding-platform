/**
 * The main conversation's read (`main/read`) and one request's read with its
 * cards (`requests/read`) over HTTP, on memory and SQLite (slice-6-SPEC L6, the
 * R-12 row).
 *
 * Prior state comes from the frozen cards world (tests/helpers/S6A-cards-fixture.ts):
 * requests through `requests/submit`, goals through `goals/create`, candidates
 * through `plans/propose`. Expected values are written here from those public
 * inputs and L6, never taken from the read under test:
 * - order and counts: a view's requests newest first, 20 a page; the first goal
 *   by creation shows the no-goal requests made before it after its own, inside
 *   the same 20; a no-goal request made after the first goal appears only in the
 *   no-goal view, and a no-goal cursor taken before the first goal existed
 *   continues to nothing below it;
 * - a request's content: its submit receipt (root, round, text, goal, secretary)
 *   and one queued request round (the world's request driver is off, so the round
 *   is never started and the request stays processing with its secretary);
 * - cards: a request's are the candidate naming its root and its goal's own
 *   cards (no request); a page lists each card once, the goal's own first. The
 *   cards world sets no project pointer, so each goal has the causes
 *   `missing_initial_architecture` and `missing_initial_completion_policy`, and a
 *   goal with no Plan whose last proposal waits has `initial_plan_pending` naming
 *   it (GOAL-21). Card keys are the canonical JSON of each source's identity,
 *   hand-written; the queue's order (kind, then key) is applied here;
 * - a page that shows no notice issues no display token.
 * Opaque values come from public steps only: refs from receipts, and a cursor's
 * `since` from the request's own read made before the page is read. A cursor
 * sent back is only ever a value a read returned.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import {
  openS6ACardsWorld, seedS6AGoalOrder, seedS6ASharedCards, type S6ACandidate, type S6ACardsWorkspace, type S6ACardsWorld,
  type S6ARequest,
} from '../helpers/S6A-cards-fixture.js';
import type { S6ABackend } from '../helpers/S6A-request-fixture.js';

type Page = {
  goalId: string | null;
  requests: (RequestCoreViewV1 & { cardKeys: string[] })[];
  cards: DecisionCardV1[];
  notices: unknown[];
  seenThrough: Record<string, unknown>;
  displayToken: string | null;
  next: { phase: 'goal' | 'pre'; since: CommitCursor; rootKey: string } | null;
};
type RequestRead = RequestCoreViewV1 & { cards: DecisionCardV1[] };

const BACKENDS: readonly S6ABackend[] = ['memory', 'sqlite'];
const worlds: S6ACardsWorld[] = [];

afterEach(async () => {
  const open = worlds.splice(0);
  await Promise.allSettled(open.map(world => world.close()));
});

async function openWorld(backend: S6ABackend): Promise<S6ACardsWorld> {
  const world = await openS6ACardsWorld({ backend });
  worlds.push(world);
  return world;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

function ready<T>(body: unknown, what: string): T {
  if (asRecord(body)['status'] !== 'ready') throw new Error(`${what} was not ready: ${JSON.stringify(body)}`);
  return asRecord(body)['value'] as T;
}

async function readMain(workspace: S6ACardsWorkspace, goalId: string | null, cursor: Page['next'] = null): Promise<Page> {
  return ready<Page>(await workspace.route('main/read', { goalId, cursor }), `main/read of ${String(goalId)}`);
}

async function readRequestCards(workspace: S6ACardsWorkspace, requestRoot: QueryJobRef): Promise<RequestRead> {
  return ready<RequestRead>(await workspace.route('requests/read', { requestRoot }), 'requests/read');
}

const roots = (page: Page): QueryJobRef[] => page.requests.map(entry => entry.requestRoot);
const rootsOf = (requests: readonly S6ARequest[]): QueryJobRef[] => requests.map(entry => entry.requestRoot);
const newestFirst = (requests: readonly S6ARequest[]): QueryJobRef[] => rootsOf(requests).reverse();
const keysOf = (cards: readonly DecisionCardV1[]): string[] => cards.map(card => card.cardKey);

/** The commit position of a request's round, from the request's own read (made before the page under test). */
async function sinceOf(workspace: S6ACardsWorkspace, request: S6ARequest): Promise<CommitCursor> {
  const view = await workspace.readRequest(request.requestRoot);
  return asRecord((view['rounds'] as unknown[])[0])['since'] as CommitCursor;
}

/** The commit positions of several requests, read one by one before the page under test. */
async function sincesOf(workspace: S6ACardsWorkspace, requests: readonly S6ARequest[]): Promise<Map<string, CommitCursor>> {
  const since = new Map<string, CommitCursor>();
  for (const request of requests) since.set(request.requestRoot.queryJobId, await sinceOf(workspace, request));
  return since;
}

/**
 * A request's view, from its submit receipt: one request round, queued (the driver is off), owned and assigned to
 * the receipt's secretary, so processing; a request with a waiting candidate names it and has the `candidate` reason.
 */
function requestView(made: S6ARequest, since: CommitCursor, candidate: S6ACandidate | null = null): RequestCoreViewV1 {
  return {
    requestRoot: made.requestRoot, goalId: made.goalId, effectiveGoalId: made.goalId,
    owner: made.secretary, ownerState: 'owned', processing: true, assignment: 'assigned', waitReason: null,
    reasons: candidate === null ? ['round'] : ['round', 'candidate'],
    rounds: [{
      ref: made.round, kind: 'request', status: 'queued', input: made.text, answer: null, ideas: [], goalCardDrafts: [],
      selectedIdea: null, assignedSession: made.secretary, session: null, absorbedInto: null, closeCode: null,
      closeDetail: null, since,
    }],
    candidate: candidate === null ? null : { proposalRef: candidate.proposal.ref, state: 'candidate', stale: false },
  };
}

/** The canonical JSON of a request root (keys in code-point order), hand-written. */
const rootKeyOf = (ref: QueryJobRef): string =>
  `{"aggregateType":"QueryJob","projectId":"${ref.projectId}","queryJobId":"${ref.queryJobId}","workspaceId":"${ref.workspaceId}"}`;
const goalJsonOf = (goal: GoalRef): string =>
  `{"aggregateType":"Goal","goalId":"${goal.goalId}","projectId":"${goal.projectId}"}`;

/** A card key: the canonical JSON of its decision source's identity, hand-written. */
type CardId = { kind: 'candidate' | 'goal_cause'; key: string };
const candidateCardOf = (goal: GoalRef, request: S6ARequest): CardId =>
  ({ kind: 'candidate', key: `{"goalRef":${goalJsonOf(goal)},"kind":"candidate","requestRef":${rootKeyOf(request.requestRoot)}}` });
const causeCardOf = (goal: GoalRef, code: string, affected = '[]'): CardId =>
  ({ kind: 'goal_cause', key: `{"affected":${affected},"code":"${code}","goalRef":${goalJsonOf(goal)},"kind":"goal_cause"}` });
const pendingPlanCardOf = (goal: GoalRef, candidate: S6ACandidate): CardId => {
  const proposal = candidate.proposal.ref;
  return causeCardOf(goal, 'initial_plan_pending', `[{"ref":{"aggregateType":"PlanProposal","projectId":"${proposal.projectId}",`
    + `"proposalId":"${proposal.proposalId}","workspaceId":"${proposal.workspaceId}"},"revision":${String(candidate.proposal.revision)}}]`);
};
/** A goal's causes with no project pointer and no Plan proposal. */
const pointerCausesOf = (goal: GoalRef): CardId[] =>
  [causeCardOf(goal, 'missing_initial_architecture'), causeCardOf(goal, 'missing_initial_completion_policy')];

/** The queue's order within one goal's waiting cards: source kind, then key (ASCII, so code-unit order is byte order). */
const queueOrder = (cards: readonly CardId[]): string[] => [...cards]
  .sort((left, right) => left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
  .map(card => card.key);

describe.each(BACKENDS)('main/read and requests/read (%s)', backend => {
  it('R-12: two goals with three requests each read per goal, newest first, and no no-goal request', async () => {
    const cards = await openWorld(backend);
    const { first, second } = cards.world.goals;
    const onFirst: S6ARequest[] = [];
    const onSecond: S6ARequest[] = [];
    for (let index = 1; index <= 3; index += 1) {
      onFirst.push(await cards.main.submit({ label: `two-goals-1-${String(index)}`, goalId: first.goalId }));
      onSecond.push(await cards.main.submit({ label: `two-goals-2-${String(index)}`, goalId: second.goalId }));
    }
    const since = await sincesOf(cards.main, [...onFirst, ...onSecond]);
    const view = (made: S6ARequest, goal: GoalRef) =>
      ({ ...requestView(made, since.get(made.requestRoot.queryJobId)!), cardKeys: queueOrder(pointerCausesOf(goal)) });

    const firstPage = await readMain(cards.main, first.goalId);
    expect(firstPage.goalId).toBe(first.goalId);
    expect(firstPage.requests).toEqual([...onFirst].reverse().map(made => view(made, first)));
    expect(keysOf(firstPage.cards)).toEqual(queueOrder(pointerCausesOf(first)));
    expect(firstPage.next).toBeNull();
    const secondPage = await readMain(cards.main, second.goalId);
    expect(secondPage.requests).toEqual([...onSecond].reverse().map(made => view(made, second)));
    expect(secondPage.next).toBeNull();
    const noGoal = await readMain(cards.main, null);
    expect(noGoal.goalId).toBeNull();
    expect(noGoal.requests).toEqual([]);
    expect(noGoal.cards).toEqual([]);
    expect(noGoal.next).toBeNull();
  });

  it('R-12: 21 requests on one goal read as a page of 20 and a page of 1', async () => {
    const cards = await openWorld(backend);
    const goal = cards.world.goals.second;
    const made = await cards.main.submitMany({ label: 'twenty-one', goalId: goal.goalId, count: 21 });
    const twentiethSince = await sinceOf(cards.main, made[1]!);

    const page1 = await readMain(cards.main, goal.goalId);
    expect(roots(page1)).toEqual(newestFirst(made.slice(1)));
    expect(page1.next).toEqual({ phase: 'goal', since: twentiethSince, rootKey: rootKeyOf(made[1]!.requestRoot) });
    const page2 = await readMain(cards.main, goal.goalId, page1.next);
    expect(roots(page2)).toEqual([made[0]!.requestRoot]);
    expect(page2.next).toBeNull();
  });

  it('R-12: the first goal by creation shows the earlier no-goal requests after its own, within the 20', async () => {
    const cards = await openWorld(backend);
    const workspace = cards.second;
    const early = await workspace.submitMany({ label: 'early', goalId: null, count: 2 });
    // With no goal in the workspace, the no-goal view holds every no-goal request.
    expect(roots(await readMain(workspace, null))).toEqual(newestFirst(early));

    // The first goal is created after `early` and one more no-goal request and is never asked about; the goal
    // created second is asked about first; one no-goal request comes between the two goals.
    const order = await seedS6AGoalOrder(workspace, { label: 'order', before: 1, after: 1, onAsked: 3, onFirst: 0 });
    const preGoal = [...early, ...order.before];
    const firstView = await readMain(workspace, order.first.ref.goalId);
    expect(roots(firstView)).toEqual(newestFirst(preGoal));
    expect(firstView.next).toBeNull();
    expect(roots(await readMain(workspace, order.asked.ref.goalId))).toEqual(newestFirst(order.onAsked));
    // The no-goal request made after the first goal is only in the no-goal view.
    expect(roots(await readMain(workspace, null))).toEqual(rootsOf(order.after));

    // 18 requests on the first goal: its page holds them, then the two newest pre-goal requests (20 in all).
    const onFirst = await workspace.submitMany({ label: 'on-first', goalId: order.first.ref.goalId, count: 18 });
    const lastShownSince = await sinceOf(workspace, early[1]!);
    const page1 = await readMain(workspace, order.first.ref.goalId);
    expect(roots(page1)).toEqual([...newestFirst(onFirst), order.before[0]!.requestRoot, early[1]!.requestRoot]);
    expect(page1.next).toEqual({ phase: 'pre', since: lastShownSince, rootKey: rootKeyOf(early[1]!.requestRoot) });
    const page2 = await readMain(workspace, order.first.ref.goalId, page1.next);
    expect(roots(page2)).toEqual([early[0]!.requestRoot]);
    expect(page2.next).toBeNull();
    expect(roots(await readMain(workspace, null))).toEqual(rootsOf(order.after));
    expect(roots(await readMain(workspace, order.asked.ref.goalId))).toEqual(newestFirst(order.onAsked));
  });

  it('R-12: a no-goal cursor taken before the first goal existed continues to nothing older than that goal', async () => {
    const cards = await openWorld(backend);
    const workspace = cards.second;
    const made = await workspace.submitMany({ label: 'before-any-goal', goalId: null, count: 21 });
    const twentiethSince = await sinceOf(workspace, made[1]!);
    const page1 = await readMain(workspace, null);
    expect(roots(page1)).toEqual(newestFirst(made.slice(1)));
    expect(page1.next).toEqual({ phase: 'goal', since: twentiethSince, rootKey: rootKeyOf(made[1]!.requestRoot) });

    await workspace.createGoal('s6a-cards-late-first', 'S6A cards: the first goal, created between two pages');
    const later = await workspace.submit({ label: 'after-the-goal', goalId: null });
    const page2 = await readMain(workspace, null, page1.next);
    expect(page2.requests).toEqual([]);
    expect(page2.next).toBeNull();
    expect(roots(await readMain(workspace, null))).toEqual([later.requestRoot]);
  });

  it('R-12: a page lists each card once, as the queue shows it, and a page with no notice issues no token', async () => {
    const cards = await openWorld(backend);
    const { first, second } = cards.world.goals;
    const shared = await seedS6ASharedCards(cards.main, { label: 'shared', goal: first, otherGoal: second });
    const [r1, r2] = shared.requests;
    const c1 = shared.candidates[0]!;
    const c2 = shared.candidates[1]!;
    const since = await sincesOf(cards.main, [r1, r2]);
    const goalOwn = [...pointerCausesOf(first), pendingPlanCardOf(first, c2)];
    const queue = await cards.main.readCards(first);
    const queueCard = (key: string): DecisionCardV1 | undefined => queue.find(card => card.cardKey === key);

    const page = await readMain(cards.main, first.goalId);
    const pageKeys = [...queueOrder(goalOwn), candidateCardOf(first, r2).key, candidateCardOf(first, r1).key];
    expect(keysOf(page.cards)).toEqual(pageKeys);
    expect(page.cards).toEqual(pageKeys.map(queueCard));
    expect(page.requests).toEqual([
      { ...requestView(r2, since.get(r2.requestRoot.queryJobId)!, c2), cardKeys: queueOrder([candidateCardOf(first, r2), ...goalOwn]) },
      { ...requestView(r1, since.get(r1.requestRoot.queryJobId)!, c1), cardKeys: queueOrder([candidateCardOf(first, r1), ...goalOwn]) },
    ]);
    expect(page.notices).toEqual([]);
    expect(page.seenThrough).toEqual({});
    expect(page.displayToken).toBeNull();
  });

  it('requests/read: a goal request reads its own candidate and its goal’s own cards, a no-goal request only its rounds’', async () => {
    const cards = await openWorld(backend);
    const { first, second } = cards.world.goals;
    const shared = await seedS6ASharedCards(cards.main, { label: 'request-read', goal: first, otherGoal: second });
    const [r1, r2] = shared.requests;
    const c1 = shared.candidates[0]!;
    const c2 = shared.candidates[1]!;
    const noGoal = await cards.main.submit({ label: 'request-read-no-goal', goalId: null });
    const since = await sincesOf(cards.main, [r1, r2, noGoal]);
    const goalOwn = [...pointerCausesOf(first), pendingPlanCardOf(first, c2)];
    const queue = await cards.main.readCards(first);
    const queueCards = (ids: readonly CardId[]): (DecisionCardV1 | undefined)[] =>
      queueOrder(ids).map(key => queue.find(card => card.cardKey === key));

    expect(await readRequestCards(cards.main, r1.requestRoot)).toEqual({
      ...requestView(r1, since.get(r1.requestRoot.queryJobId)!, c1), cards: queueCards([candidateCardOf(first, r1), ...goalOwn]),
    });
    expect(await readRequestCards(cards.main, r2.requestRoot)).toEqual({
      ...requestView(r2, since.get(r2.requestRoot.queryJobId)!, c2), cards: queueCards([candidateCardOf(first, r2), ...goalOwn]),
    });
    expect(await readRequestCards(cards.main, noGoal.requestRoot))
      .toEqual({ ...requestView(noGoal, since.get(noGoal.requestRoot.queryJobId)!), cards: [] });
  });

  describe('rejects: main/read and requests/read', () => {
    it('a goal this workspace does not have is not_found', async () => {
      const cards = await openWorld(backend);
      const made = await cards.main.submit({ label: 'reject-goal', goalId: cards.world.goals.first.goalId });
      expect(asRecord(await cards.main.route('main/read', { goalId: 's6a-no-such-goal', cursor: null })))
        .toEqual({ status: 'not_found' });
      expect(roots(await readMain(cards.main, cards.world.goals.first.goalId))).toEqual([made.requestRoot]);
    });

    it('a main/read without its cursor field is invalid', async () => {
      const cards = await openWorld(backend);
      const goal = cards.world.goals.second;
      const made = await cards.main.submitMany({ label: 'reject-cursor', goalId: goal.goalId, count: 21 });
      const page1 = await readMain(cards.main, goal.goalId);
      const answer = asRecord(await cards.main.route('main/read', { goalId: goal.goalId }));
      expect(answer['status']).toBe('rejected');
      expect(answer['code']).toBe('invalid');
      expect(roots(await readMain(cards.main, goal.goalId, page1.next))).toEqual([made[0]!.requestRoot]);
    });

    it('a pre-goal cursor on a goal that is not the first goal is invalid', async () => {
      const cards = await openWorld(backend);
      const workspace = cards.second;
      const order = await seedS6AGoalOrder(workspace, { label: 'reject-pre', before: 3, after: 0, onAsked: 1, onFirst: 18 });
      const page1 = await readMain(workspace, order.first.ref.goalId);
      expect(page1.next?.phase).toBe('pre');
      const answer = asRecord(await workspace.route('main/read', { goalId: order.asked.ref.goalId, cursor: page1.next }));
      expect(answer['status']).toBe('rejected');
      expect(answer['code']).toBe('invalid');
      expect(roots(await readMain(workspace, order.asked.ref.goalId))).toEqual(rootsOf(order.onAsked));
    });

    it('requests/read of a root that is no request of this workspace is not_found', async () => {
      const cards = await openWorld(backend);
      const made = await cards.main.submit({ label: 'reject-read', goalId: cards.world.goals.first.goalId });
      const missing: QueryJobRef = { ...made.requestRoot, queryJobId: 's6a-no-such-request' };
      expect(asRecord(await cards.main.route('requests/read', { requestRoot: missing }))).toEqual({ status: 'not_found' });
      expect((await readRequestCards(cards.main, made.requestRoot)).requestRoot).toEqual(made.requestRoot);
    });
  });
});
