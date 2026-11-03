import { describe, expect, it } from 'vitest';
import { adaptTaskMapDecisionCards, type TaskMapQueueRead } from '../../src/ui/adapters/task-map.js';
import { findButton } from './helpers/boot-page.js';
import { GOAL, SCOPE, withE35Page } from './helpers/e35-host.js';
import { until } from '../helpers/change-stream-reader.js';

/**
 * E35-A (user's answer A, HO:2051): 需要关注 adds one item “需要你决定 n 张卡”
 * from this Goal's `decisions/queue`; an unavailable notice kind is not a
 * missing card, an unavailable card source makes the count 至少; no read, no item.
 */

const NOTICES = ['member_notice', 'second_expiry', 'handoff', 'note_review', 'undelivered_reply', 'automatic_rework',
  'continuation', 'disconnect', 'member_created', 'project_notice', 'plan_adoption', 'plan_notice'];
const queueOf = (waitingAnswer: number, off: string[], extra: string[] = []): TaskMapQueueRead => ({
  counts: { waitingAnswer },
  capabilities: ['goal_cause', 'member_creation', ...NOTICES, ...extra]
    .map((source) => ({ source, availability: off.includes(source) ? 'not_available' : 'available' })),
});

describe('E35-A the decision-card count', () => {
  it.each([
    ['only second_expiry is unavailable (the real Host)', { ...queueOf(2, ['second_expiry']), countsComplete: false }, { n: 2, atLeast: false }],
    ['a card source is unavailable', queueOf(1, ['goal_cause']), { n: 1, atLeast: true }],
    ['an unknown source is unavailable', queueOf(1, ['e35a_new_source'], ['e35a_new_source']), { n: 1, atLeast: true }],
    ['no waiting card', queueOf(0, []), null],
    ['no counts', { capabilities: [] }, null],
  ])('E35-A adapts %s', (_name, read, expected) => {
    /* Named mutation: per row, 至少 follows countsComplete, or a 0 or missing count becomes an item. */
    expect(adaptTaskMapDecisionCards(read as TaskMapQueueRead)).toEqual(expected);
  });
});

/** This Goal's card queue as the row sets it; the inputs it was read with. */
function cards(queue: { reply: unknown }) {
  const inputs: unknown[] = [];
  return { inputs, answer: (route: string, input: unknown): unknown => { if (route !== 'decisions/queue') return undefined; inputs.push(input); return queue.reply; } };
}

describe('E35-A the page reads the Goal’s waiting cards', () => {
  it('E35-A one waiting card is an attention item that opens 需要你决定, read with the Goal and its sections', async () => {
    /* Named mutation: the item links to Main, not Decide.dc.html. */
    const queue = { reply: { status: 'ready', value: queueOf(1, ['second_expiry']) } };
    const read = cards(queue);
    await withE35Page(read.answer, async (page, notify) => {
      await until(() => page.root.textContent.includes('1 张卡'), 20_000);
      expect(page.root.textContent).toContain('需要你决定');
      expect(page.root.textContent).not.toContain('现在没有需要你决定');
      expect(read.inputs[0]).toEqual({ workspace: SCOPE, goalRef: GOAL, sections: ['waiting_answer'], page: { limit: 1 } });
      findButton(page.root, '1 张卡')!.dispatch('click');
      expect(page.assigned()).toEqual(['Decide.dc.html']);
      /* Another place answers the card: the next notification rereads 0 and the item goes. */
      queue.reply = { status: 'ready', value: queueOf(0, ['second_expiry']) };
      notify();
      await until(() => !page.root.textContent.includes('张卡'), 20_000);
      expect(page.root.textContent).toContain('现在没有需要你决定');
    });
  });

  it('E35-A an unread queue shows no item and no 0', async () => {
    /* Named mutation: an unread queue reads as 0 and shows 需要你决定 0 张卡. */
    const read = cards({ reply: { status: 'rejected', code: 'not_found', reason: 'no queue' } });
    await withE35Page(read.answer, async (page) => {
      await until(() => read.inputs.length > 0 && page.root.textContent.includes('现在没有需要你决定'), 20_000);
      expect(page.root.textContent).not.toContain('张卡');
    });
  });
});
