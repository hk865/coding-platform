/**
 * P2 T18 (frozen `p2-frozen.md:333`; handoff 1): the three refusals at the action owner.
 * This row is already GREEN at the base tag; the named mutations are the one line each
 * refusal depends on. Service row: the request is the held round's own dispatch and the
 * Host/operator contexts come from the world; no store is read.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { hostClaim } from '../helpers/P1-platform-entry.js';
import {
  actionRefOf, dispatchSequence, holdOf, p1Worlds, pointerRef, requestOf, write,
} from '../helpers/P1-reads.js';
import type { P1World } from '../helpers/P1-round-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { dexcAnswer } from '../helpers/S7D2-coldstart-world.js';

const worlds = p1Worlds();
afterEach(async () => { await worlds.closeAll(); });
const LONG = 600_000;

async function pendingDispatch(p1: P1World, label: string) {
  const a = await p1.hold(p1.lines.A, label);
  const sent = await p1.world.platform.actionRequests.requestDispatch(a.ctx,
    write({ taskRef: p1.task.tA, reason: `P2 ${label} dispatch` }, `${label}-dispatch`));
  expect(sent).toMatchObject({ status: 'needs_decision' });
  const ref = actionRefOf(sent);
  const read = await requestOf(p1, ref);
  return { a, ref, revision: read!.revision };
}

describe('T18 handoff 1: the three owner refusals', () => {
  it('T18a a query-round context may not approve: forbidden, the request stays pending and its card slot moves not', async () => {
    const p1 = await worlds.open({ running: true, autonomy: 'every_step' });
    const { a, ref, revision } = await pendingDispatch(p1, 't18a');
    const refused = await p1.world.platform.actionRequests.approve(a.ctx, {
      request: ref, revision, commandId: 'p2-t18-q', answerRef: a.source,
    });
    expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden',
      reason: 'only the Host may approve or deny an action request' });
    expect((await requestOf(p1, ref))?.state).toBe('pending');
    expect(pointerRef((await holdOf(p1, p1.task.tA))?.openDispatch)).toEqual(ref);
  }, LONG);

  it('T18b after the requester withdraws, an answer at the old revision is a revision_conflict with the current version', async () => {
    const p1 = await worlds.open({ running: true, autonomy: 'every_step' });
    const { a, ref, revision } = await pendingDispatch(p1, 't18b');
    // The owner needs the saved card answer, not the round's source: save the real answer through the
    // decision-message owner (the answer step alone, no application) and pass its message ref.
    const card = (await s6aCardsWorkspace(p1.world, S6A_SCOPE).readCards(p1.goal))
      .find(entry => String(entry.source.kind) === 'action_release' && entry.state === 'waiting_answer'
        && entry.taskRef?.taskId === 'p1-ta');
    expect(card, 'T18b: the dispatch card waits').toBeDefined();
    if (card === undefined) throw new Error('T18b: no waiting dispatch card');
    const answer = await p1.world.platform.decisionMessages.answerDecision(p1.world.humanContext(), {
      input: { source: card.source, selection: { kind: 'option', optionId: 'approve' }, text: '', annotations: [] },
      meta: { requestId: 'p2-t18b-answer', expected: card.source.pins },
    });
    expect(answer).toMatchObject({ status: 'committed' });
    if (answer.status !== 'committed') throw new Error('T18b: the saved answer did not commit');
    expect(await p1.world.platform.actionRequests.withdraw(a.ctx,
      write({ request: ref }, 'p2-t18b-withdraw'))).toMatchObject({ status: 'committed' });
    const stale = await p1.world.platform.actionRequests.approve(p1.world.humanContext(), {
      request: ref, revision, commandId: 'p2-t18b-stale', answerRef: answer.value.ref,
    });
    expect(stale).toMatchObject({ status: 'rejected', code: 'revision_conflict',
      reason: 'the action request changed since that revision' });
    expect(stale.status === 'rejected' ? stale.current : undefined).toEqual([{ ref, revision: revision + 1 }]);
  }, LONG);

  it('T18c a served claim at r1 meets the request at r2: revision_conflict, counter and pointer unchanged', async () => {
    const p1 = await worlds.open({ running: true, autonomy: 'every_step' });
    const { a, ref, revision } = await pendingDispatch(p1, 't18c');
    /* gl-frozen.md:7 (GL-2, lead ruling 4) / :172 (the T34 fix; lead notice
       `a-lead-notice-b-group.md`): a named advance reads the same claimHold, so end tB's Run first
       (M-04, tests/business/P2-T14-action-rounds.test.ts:131-132). This row's claim is the
       stale-revision refusal, so there is no claim receipt to re-read the line from. */
    await p1.endB();
    const step = await p1.claimStep(p1.lines.E, p1.task.tA, 't18c-r1');
    /* Approve through the real card answer; the owner needs the saved answer, not the round source. */
    const card = (await s6aCardsWorkspace(p1.world, S6A_SCOPE).readCards(p1.goal))
      .find(entry => String(entry.source.kind) === 'action_release' && entry.state === 'waiting_answer'
        && entry.taskRef?.taskId === 'p1-ta');
    expect(card, 'T18c: the dispatch card waits').toBeDefined();
    if (card === undefined) throw new Error('T18c: no waiting dispatch card');
    expect(await dexcAnswer(p1.world, card, 'approve', '', 'p2-t18c-open')).toMatchObject({ status: 'ready' });
    const before = await dispatchSequence(p1);
    const pointer = pointerRef((await holdOf(p1, p1.task.tA))?.openDispatch);
    const conflict = await hostClaim(p1.world, step, { servedRequest: { ref, revision } });
    expect(conflict).toMatchObject({ status: 'rejected', code: 'revision_conflict',
      reason: 'the servedRequest changed since that revision' });
    expect(conflict.status === 'rejected' ? conflict.current : undefined).toEqual([{ ref, revision: revision + 1 }]);
    expect(await dispatchSequence(p1)).toBe(before);
    expect(pointerRef((await holdOf(p1, p1.task.tA))?.openDispatch)).toEqual(pointer);
  }, LONG);
});
