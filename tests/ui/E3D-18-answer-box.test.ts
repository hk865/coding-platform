import { afterEach, expect, it } from 'vitest';
import { openE3GW1 } from './helpers/E3G-world.js';
import {
  bootDecide, card, cardButton, callsOf, count, opened, quiet, sectionRows, settle, typeInto, worldTarget, writeOf,
} from './helpers/E3D-page.js';
import { click } from './helpers/E3N-interact.js';
import { descendants, textOf } from './helpers/E3N-page.js';

/**
 * Y11/Y12 (D42-1, D103-1): the conflict card's answer box and the answer-body
 * view. The annotation half is blocked: the conflict source carries `objects: []`
 * in `goal-conflict.ts:119`, while the card's files come from the read model, so
 * `decision-service.ts:815` rejects any annotation as “outside the card”.
 */
const worlds: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => { await Promise.allSettled(worlds.splice(0).reverse().map((w) => w.close())); });

it('⑦ a conflict card sends the person\'s words and 看答复 shows them', async () => {
  const w = await openE3GW1();
  worlds.push({ close: () => w.world.close() });
  const { page, log } = await bootDecide(worldTarget(w.world));
  try {
    await opened(log);
    const conflict = sectionRows(page.root, '要决定').find((row) => textOf(row).includes('冲突'));
    expect(conflict, 'the conflict row').toBeDefined();
    click(conflict!);
    await settle(() => card(page.root) !== undefined, 3_000);
    expect(descendants(card(page.root)!).some((element) => element.getAttribute('id') === 'dc-answer')).toBe(true);
    /* 冲突卡必须选：只写话不选，“确定”仍灰。 */
    typeInto(page.root, 'dc-answer', '先等目标 1');
    await settle(() => cardButton(page.root, '等前一个目标') !== undefined, 1_000);
    expect(cardButton(page.root, '确定')!.getAttribute('aria-disabled')).toBe('true');
    click(cardButton(page.root, '等前一个目标')!);
    await settle(() => cardButton(page.root, '等前一个目标')?.getAttribute('aria-checked') === 'true', 2_000);
    click(cardButton(page.root, '确定')!);
    await settle(() => count(log, 'decisions/answer') === 1
      && callsOf(log, 'decisions/answer')[0]!.reply !== undefined, 8_000);
    await quiet(log);
    expect(count(log, 'decisions/answer')).toBe(1);
    const sent = writeOf(callsOf(log, 'decisions/answer')[0]!);
    expect(sent.input['text']).toBe('先等目标 1');
    expect(sent.input['annotations']).toEqual([]);
    expect((callsOf(log, 'decisions/answer')[0]!.reply as { status?: string }).status).toBe('ready');
    /* 已处理 → 这张卡 → 看答复。 */
    const tab = (name: string) => descendants(page.root).find((element) =>
      element.tagName.toLowerCase() === 'button' && textOf(element) === name);
    click(tab('已处理')!);
    await settle(() => callsOf(log, 'decisions/queue').length > 1, 8_000);
    await quiet(log);
    const doneRow = sectionRows(page.root, '已处理').find((row) => textOf(row).includes('等前一个目标'));
    expect(doneRow, 'the answered conflict row').toBeDefined();
    click(doneRow!);
    await settle(() => cardButton(page.root, '看答复') !== undefined, 3_000);
    click(cardButton(page.root, '看答复')!);
    await settle(() => (callsOf(log, 'materials/open').at(-1)?.reply !== undefined), 8_000);
    await quiet(log);
    expect(textOf(card(page.root)!)).toContain('你的话：先等目标 1');
    expect(textOf(page.root)).not.toContain('user_decision_response');
  } finally {
    await page.restore();
  }
}, 240_000);
