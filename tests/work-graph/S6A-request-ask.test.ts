/**
 * `requests/ask` (slice-6 spec L6: "问秘书" on a card and "重出" on a stale
 * candidate) over HTTP, on the frozen cards world (memory and SQLite): the
 * cards are real decision-queue cards tied to real requests
 * (`seedS6ASharedCards`), and an `ask` sends a card's `source.pins` as its
 * `cardRefs` (`cardRefsOf`), as the client reads them.
 *
 * Rows:
 * - a card question queues a follow-up on the request's owner that stores the
 *   card's refs and the question; the same command replays to the same round;
 * - a regeneration stores the regeneration request alone, or with the person's
 *   words after a blank line;
 * - rejects: the same ref twice, 21 refs, a ref of another project, a ref of
 *   an object the store keeps no records of (a Task; `invalid`), a round of
 *   another workspace's request (`not_found`) and an ask the person did not
 *   make (`forbidden` at the route); each leaves the request's rounds as they
 *   were. A store whose read fails is not built here (no fixture fails reads);
 *   the pure rows cover that answer.
 *
 * Assertions read public routes only: the request owner read (`readRequest`,
 * the read the cards handle exposes) for the rounds and their stored input,
 * and `queries/read` for the follow-up's stored card refs. Nothing reads a
 * store or writes a record by hand.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { VersionedRef } from '../../src/contracts/ledger.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import {
  cardRefsOf, openS6ACardsWorld, seedS6ASharedCards, type S6ACardsWorld, type S6ASharedCards,
} from '../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';

type Rounds = Array<{ ref: QueryJobRef; kind: string; input: string; assignedSession: unknown }>;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

describe.each(['memory', 'sqlite'] as const)('requests/ask (%s)', (backend) => {
  let cards: S6ACardsWorld;
  let shared: S6ASharedCards;

  beforeAll(async () => {
    cards = await openS6ACardsWorld({ backend });
    shared = await seedS6ASharedCards(cards.main, {
      label: `ask-${backend}`, goal: cards.world.goals.first, otherGoal: cards.world.goals.second,
    });
  });

  afterAll(async () => {
    await cards?.close();
  });

  async function roundsOf(requestRoot: QueryJobRef): Promise<Rounds> {
    return (await cards.main.readRequest(requestRoot))['rounds'] as Rounds;
  }

  async function ask(input: { commandId: string; round: QueryJobRef; cardRefs: VersionedRef[];
    regenerate: boolean; text: string }): Promise<Record<string, unknown>> {
    return asRecord(await cards.main.route('requests/ask', input));
  }

  it('a card question queues a follow-up on the owner with the card refs and the question', async () => {
    const [request] = shared.requests;
    const card = shared.candidates[0]!.card;
    const refs = cardRefsOf(card);
    const before = await roundsOf(request.requestRoot);

    const asked = await ask({ commandId: `ask-card-${backend}`, round: request.round, cardRefs: refs,
      regenerate: false, text: '这个候选为什么先做第二步？' });
    expect(asked['status']).toBe('queued');
    const followupRound = asked['followupRound'] as QueryJobRef;

    const after = await roundsOf(request.requestRoot);
    expect(after).toHaveLength(before.length + 1);
    const followup = after.find(round => round.ref.queryJobId === followupRound.queryJobId);
    expect(followup?.kind).toBe('followup');
    expect(followup?.input).toBe('这个候选为什么先做第二步？');
    // The request is owned, so the follow-up lands on its owner (the submit receipt's secretary).
    expect(followup?.assignedSession).toEqual(request.secretary);
    // The stored card refs are the card's pins exactly as the queue read returned them.
    expect((await readQuery(cards.world.ag2b, followupRound)).job.job.relatedCardRefs).toEqual(card.source.pins);

    // The same command replays to the same round and adds none.
    const replayed = await ask({ commandId: `ask-card-${backend}`, round: request.round, cardRefs: refs,
      regenerate: false, text: '这个候选为什么先做第二步？' });
    expect(replayed).toEqual({ status: 'queued', followupRound });
    expect(await roundsOf(request.requestRoot)).toHaveLength(before.length + 1);
  });

  it('a regeneration stores the request alone, or with the words after a blank line', async () => {
    const [, request] = shared.requests;
    const refs = cardRefsOf(shared.candidates[1]!.card);

    const bare = await ask({ commandId: `ask-regenerate-bare-${backend}`, round: request.round, cardRefs: refs,
      regenerate: true, text: '' });
    expect(bare['status']).toBe('queued');
    const worded = await ask({ commandId: `ask-regenerate-words-${backend}`, round: request.round, cardRefs: refs,
      regenerate: true, text: '只换第二步' });
    expect(worded['status']).toBe('queued');

    const rounds = await roundsOf(request.requestRoot);
    const inputOf = (result: Record<string, unknown>): string | undefined =>
      rounds.find(round => round.ref.queryJobId === (result['followupRound'] as QueryJobRef).queryJobId)?.input;
    expect(inputOf(bare)).toBe('请按当前事实重新出这个候选计划。');
    expect(inputOf(worded)).toBe('请按当前事实重新出这个候选计划。\n\n只换第二步');
  });

  describe('rejects: ask', () => {
    it('rejects the same card ref named twice', async () => {
      const [request] = shared.requests;
      const refs = cardRefsOf(shared.candidates[0]!.card);
      const before = await roundsOf(request.requestRoot);
      const refused = await ask({ commandId: `ask-twice-${backend}`, round: request.round,
        cardRefs: [refs[0]!, refs[0]!], regenerate: false, text: 'twice' });
      expect(refused).toEqual({ status: 'rejected', code: 'invalid',
        reason: 'cardRefs[1] names the same object as an earlier ref' });
      expect(await roundsOf(request.requestRoot)).toEqual(before);
    });

    it('rejects twenty-one card refs', async () => {
      const [request] = shared.requests;
      const many: VersionedRef[] = Array.from({ length: 21 }, (_, index) => ({
        ref: { aggregateType: 'Goal', projectId: S6A_SCOPE.projectId, goalId: `s6a-ask-goal-${index + 1}` }, revision: 1,
      }));
      const before = await roundsOf(request.requestRoot);
      const refused = await ask({ commandId: `ask-many-${backend}`, round: request.round, cardRefs: many,
        regenerate: false, text: 'many' });
      expect(refused).toEqual({ status: 'rejected', code: 'invalid', reason: 'cardRefs must name 1 to 20 refs' });
      expect(await roundsOf(request.requestRoot)).toEqual(before);
    });

    it('rejects a card ref of another project', async () => {
      const [request] = shared.requests;
      const refs = cardRefsOf(shared.candidates[0]!.card);
      const foreign: VersionedRef = { ref: { aggregateType: 'Goal', projectId: 's6a-ask-other-project', goalId: 'g1' },
        revision: 1 };
      const before = await roundsOf(request.requestRoot);
      const refused = await ask({ commandId: `ask-foreign-${backend}`, round: request.round,
        cardRefs: [...refs, foreign], regenerate: false, text: 'foreign' });
      expect(refused).toEqual({ status: 'rejected', code: 'invalid',
        reason: `cardRefs[${refs.length}].ref must name an object of this project` });
      expect(await roundsOf(request.requestRoot)).toEqual(before);
    });

    it('rejects a card ref of an object the store keeps no records of (a Task)', async () => {
      const [request] = shared.requests;
      const refs = cardRefsOf(shared.candidates[0]!.card);
      const task = { ref: { aggregateType: 'Task', projectId: S6A_SCOPE.projectId,
        goalId: cards.world.goals.first.goalId, taskId: 's6a-ask-task' }, revision: 1 } as unknown as VersionedRef;
      const before = await roundsOf(request.requestRoot);
      const refused = await ask({ commandId: `ask-task-${backend}`, round: request.round, cardRefs: [...refs, task],
        regenerate: false, text: 'why this task?' });
      expect(refused).toEqual({ status: 'rejected', code: 'invalid',
        reason: 'a card ref is not a stored object: no record schema registered for aggregateType Task' });
      expect(await roundsOf(request.requestRoot)).toEqual(before);
    });

    it('rejects an ask the person did not make, at the route', async () => {
      const [request] = shared.requests;
      const refs = cardRefsOf(shared.candidates[0]!.card);
      const before = await roundsOf(request.requestRoot);
      const refused = await cards.world.dispatch('requests/ask', cards.world.systemContext(), plain(S6A_SCOPE, {
        commandId: `ask-system-${backend}`, round: request.round, cardRefs: refs, regenerate: false, text: 'system' }));
      expect(refused).toEqual({ status: 'rejected', code: 'forbidden',
        reason: 'only the person may issue a request command' });
      expect(await roundsOf(request.requestRoot)).toEqual(before);
    });

    it('rejects a round of a request in another workspace', async () => {
      const other = await cards.second.submit({ label: `ask-other-workspace-${backend}`, goalId: null });
      const otherBefore = (await cards.second.readRequest(other.requestRoot))['rounds'];
      const refs = cardRefsOf(shared.candidates[0]!.card);
      const refused = await ask({ commandId: `ask-other-workspace-${backend}`, round: other.round, cardRefs: refs,
        regenerate: false, text: 'another workspace' });
      expect(refused).toEqual({ status: 'rejected', code: 'not_found',
        reason: 'the round is not a request round of this workspace' });
      expect((await cards.second.readRequest(other.requestRoot))['rounds']).toEqual(otherBefore);
    });
  });
});
