/**
 * P2 T12 (frozen `p2-frozen.md:327`): a real action card reads its full source and versions.
 * The frozen entries are the `dispatch_task` call by the scripted model, the `decisions/queue`
 * card read and `decisions/answer`.
 * 红-setup：G3 的 `buildStageTwo`/`readRunningCommands` 装配（`src/app/core-routes.ts:1301`）。
 * The deleted `message_release` path is never used.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import {
  holdOf, performClaim, p1Worlds, pointerRef, requestOf,
} from '../helpers/P1-reads.js';
import type { P1World } from '../helpers/P1-round-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';

const worlds = p1Worlds();
afterEach(async () => { await worlds.closeAll(); });
const LONG = 600_000;

async function dispatchRound(p1: P1World, task = p1.task.tA, label = 'p2-t12', reason = 'P2 T12 dispatch') {
  await p1.world.scripted.script(p1.lines.A, [{ kind: 'calls', calls: [{ callId: `${label}-dispatch`,
    name: 'dispatch_task', args: { taskRef: task, reason } }] }]);
  const round = await p1.hold(p1.lines.A, label);
  await round.end().catch(() => undefined);
}

type AnswerBody = {
  status: string; code?: string; reason?: string;
  current?: Array<{ ref: { aggregateType?: string }; revision: number }>;
};

describe('T12 action card source and versions', () => {
  it('T12 a dispatch card carries the complete source pins of the action request', async () => {
    const p1 = await worlds.open({ autonomy: 'every_step' });
    await dispatchRound(p1);
    const cards = (await s6aCardsWorkspace(p1.world, S6A_SCOPE).readCards(p1.goal))
      .filter(card => String(card.source.kind) === 'action_release');
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card.source.pins.length).toBeGreaterThan(0);
    expect(card.source.key.length).toBeGreaterThan(0);
  }, LONG);

  it('T12b answering a card after a public action changed its object lists the changed objects in current', async () => {
    const p1 = await worlds.open({ autonomy: 'every_step' });
    await dispatchRound(p1);
    const card = (await s6aCardsWorkspace(p1.world, S6A_SCOPE).readCards(p1.goal))
      .filter(entry => entry.source.kind === 'action_release')
      .find(entry => entry.state === 'waiting_answer'
      && entry.taskRef?.taskId === 'p1-ta');
    expect(card, 'the dispatch card waits').toBeDefined();
    if (card === undefined) throw new Error('T12b: no waiting dispatch card');
    const request = pointerRef((await holdOf(p1, p1.task.tA))?.openDispatch);
    expect(request, 'the request holds the openDispatch slot').not.toBeNull();
    if (request === null) throw new Error('T12b: no open dispatch request');
    const before = await requestOf(p1, request);
    expect(before).toMatchObject({ state: 'pending' });
    if (before === null) throw new Error('T12b: the request is gone');

    /* A public action changes the object: the ordinary claim applies the waiting request (revision +1). */
    expect(await performClaim(p1.world, await p1.claimStep(p1.lines.E, p1.task.tA, 't12b-claim')))
      .toMatchObject({ status: 'committed' });
    const moved = await requestOf(p1, request);
    expect(moved, 'the public action moved the request').not.toBeNull();
    if (moved === null) throw new Error('T12b: the request disappeared');
    expect(moved.revision).toBeGreaterThan(before.revision);

    /* The old card source, answered with the old pins, names the object that changed. */
    const answered = await p1.world.post('decisions/answer', graphWrite(S6A_SCOPE, {
      source: card.source, selection: { kind: 'option', optionId: 'approve' }, text: '', annotations: [],
    }, 'p2-t12b-stale-answer', card.source.pins));
    const body = answered.body as AnswerBody;
    expect(body, 'the stale answer is a revision conflict').toMatchObject({
      status: 'rejected', code: 'revision_conflict',
    });
    expect(body.current, 'current lists the changed objects, not a display sentence').toContainEqual({
      ref: request, revision: moved.revision,
    });
  }, LONG);

  it('T12c old pins given to a new source card are invalid before any conflict', async () => {
    const p1 = await worlds.open({ autonomy: 'every_step' });
    await dispatchRound(p1);
    const first = (await s6aCardsWorkspace(p1.world, S6A_SCOPE).readCards(p1.goal))
      .filter(entry => entry.source.kind === 'action_release')
      .find(entry => entry.state === 'waiting_answer'
      && entry.taskRef?.taskId === 'p1-ta');
    expect(first, 'the first dispatch card').toBeDefined();
    if (first === undefined) throw new Error('T12c: no first dispatch card');
    await dispatchRound(p1, p1.task.tD, 'p2-t12c', 'P2 T12c second dispatch');
    const second = (await s6aCardsWorkspace(p1.world, S6A_SCOPE).readCards(p1.goal))
      .filter(entry => entry.source.kind === 'action_release')
      .find(entry => entry.state === 'waiting_answer'
      && entry.taskRef?.taskId === 'p1-td');
    expect(second, 'the second dispatch card').toBeDefined();
    if (second === undefined) throw new Error('T12c: no second dispatch card');

    const answered = await p1.world.post('decisions/answer', graphWrite(S6A_SCOPE, {
      source: second.source, selection: { kind: 'option', optionId: 'approve' }, text: '', annotations: [],
    }, 'p2-t12c-old-pins', first.source.pins));
    const body = answered.body as AnswerBody;
    expect(body, 'the old pins are not the new source pins, and that is invalid first').toMatchObject({
      status: 'rejected', code: 'invalid',
    });
  }, LONG);
});
