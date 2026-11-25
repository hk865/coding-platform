import { afterEach, expect, it } from 'vitest';
import { createIpfLine, interveneUntilSettled, openIpfWorld, readIpfQueue, sendIntervention } from '../helpers/IPF-world.js';
import { bootE3N, callsOf, count, openedPage, quietPage } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import {
  card, cardButton, isOff, sectionRows, settle, typeInto,
} from './helpers/E3D-page.js';

/**
 * Y11 (table one #2): a planning question's initial card has `options: []` but
 * `actions: ['answer']`; only its text can be sent, as `{kind:'other'}`.
 */
const worlds: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => { await Promise.allSettled(worlds.splice(0).reverse().map((world) => world.close())); });

it('⑪ a planning question with no options answers once with the person\'s text', async () => {
  const w = await openIpfWorld('e3d-pq');
  worlds.push({ close: () => w.world.close() });
  const asker = await createIpfLine(w, 'pq');
  await w.world.scripted.script(asker, [{ kind: 'text', text: JSON.stringify({ schemaVersion: 2,
    kind: 'needs_decision', summary: 'E3D 规划问题', questions: ['先做哪一块？'] }) }]);
  const asked = await sendIntervention(w, { label: 'pq', recipient: asker, goalRef: w.goal });
  expect(await interveneUntilSettled(w, asked.ref)).toMatchObject({ status: 'answer_ready', reason: 'questions' });
  const queue = await readIpfQueue(w);
  expect(queue.status).toBe('ready');
  if (queue.status !== 'ready') return;
  const planned = queue.value.waitingAnswer.find((entry) => entry.source.kind === 'planning_question');
  expect(planned?.options, 'the initial planning card has no options').toEqual([]);
  expect(planned?.actions).toContain('answer');

  const { page, log } = await bootE3N(w.world, 'Decide', { search: '?goal=' + w.goal.goalId });
  try {
    await openedPage(log);
    const row = sectionRows(page.root, '要决定').find((entry) => (entry.textContent ?? '').includes('规划问题'));
    expect(row, 'the planning-question row').toBeDefined();
    click(row!);
    await settle(() => card(page.root) !== undefined, 2_000);
    expect(isOff(cardButton(page.root, '确定'))).toBe(true);
    typeInto(page.root, 'dc-answer', '先做最小的那一块');
    await settle(() => !isOff(cardButton(page.root, '确定')), 2_000);
    click(cardButton(page.root, '确定')!);
    await settle(() => count(log, 'decisions/answer') === 1
      && callsOf(log, 'decisions/answer')[0]!.reply !== undefined, 8_000);
    await quietPage(log);
    const sent = (callsOf(log, 'decisions/answer')[0]!.body as { request: { input: Record<string, unknown> } }).request.input;
    expect(sent['selection']).toEqual({ kind: 'other' });
    expect(sent['text']).toBe('先做最小的那一块');
    await settle(() => sectionRows(page.root, '要决定').every((entry) => !(entry.textContent ?? '').includes('规划问题')), 8_000);
    expect(sectionRows(page.root, '要决定').some((entry) => (entry.textContent ?? '').includes('规划问题'))).toBe(false);
    expect((page.root.textContent ?? '')).not.toContain('这张卡要选一项');
  } finally {
    await page.restore();
  }
}, 240_000);
