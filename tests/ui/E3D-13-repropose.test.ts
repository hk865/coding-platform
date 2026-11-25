import { afterEach, describe, expect, it, vi } from 'vitest';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { findClass } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import {
  bootE3N, callsTo, countRoute, descendants, hasClass, quietPage, sentWrite, textOf,
} from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import {
  bootDecide, callsOf, card, cardButton, count, inboxRow, isOff, labelled, opened, pinSet, quiet, sectionRows, settle,
  stepConfirm, typeInto, worldTarget, writeOf, type E3DLog,
} from './helpers/E3D-page.js';
import {
  coldStartCoarseProposal, dexcNextCard, dexcProposal, dexcRounds, openS7D2ColdStartWorld,
  type S7D2ColdStartWorld,
} from '../helpers/S7D2-coldstart-world.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const P = S6A_SCOPE.projectId;
const worlds: S7D2ColdStartWorld[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  await Promise.allSettled(worlds.splice(0).map((world) => world.close()));
  expect(left).toEqual([]);
});

function optionByText(root: FakeElement, label: string): FakeElement | undefined {
  const open = card(root);
  return open === undefined ? undefined : descendants(open).find((element) =>
    element.tagName.toLowerCase() === 'button' && hasClass(element, 'opt-top') && textOf(element).includes(label));
}

/** Main's 详情 rows: the card has one `dc-facts` list and no aria-label (the Decide page's has one). */
function mainFacts(root: FakeElement): Array<{ key: string; value: string }> {
  const open = card(root);
  const list = open === undefined ? undefined : descendants(open).find((element) => hasClass(element, 'dc-facts'));
  if (list === undefined) return [];
  const rows: Array<{ key: string; value: string }> = [];
  for (const child of descendants(list)) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'dt') rows.push({ key: textOf(child), value: '' });
    else if (tag === 'dd' && rows.length > 0) rows[rows.length - 1]!.value = textOf(child);
  }
  return rows;
}

function replyOf(log: E3DLog, route: string): { status?: string; value?: Record<string, unknown> } {
  return (callsOf(log, route).at(-1)?.reply ?? {}) as { status?: string; value?: Record<string, unknown> };
}

describe('E3D-13 the structural card asks for another proposal', () => {
  it('X6/X7 Main writes 重新提 in the card; Decide writes the reason once and the adviser re-runs', async () => {
    const coldMain = await openS7D2ColdStartWorld({ backend: 'memory' });
    worlds.push(coldMain);
    await coldMain.initialize();
    await coldMain.advanceTo('coarse_split');
    const mainCard = await dexcNextCard(coldMain);
    const mainPin = await coldMain.pin();
    await coldMain.host.scripted.script(coldMain.lines.adviser,
      dexcProposal('e3d13-main-coarse', mainPin, coldStartCoarseProposal(P).ops, 'E3D-13 main coarse'));
    void mainCard;

    /* D42-1's Main half: the card takes the reason and writes once; it no longer sends the person to Decide. */
    const main = await bootE3N(coldMain.host, 'Main');
    try {
      await quietPage(main.log);
      click(inboxRow(main.page.root, '需要你决定')!);
      await settle(() => card(main.page.root) !== undefined, 3_000);
      expect(card(main.page.root)).toBeDefined();
      for (let index = 0; index < 5 && optionByText(main.page.root, '不对，重新提') === undefined; index += 1) {
        const first = textOf(findClass(card(main.page.root)!, 'dc-title'));
        const next = labelled(card(main.page.root), '下一条');
        if (next === undefined) break;
        click(next);
        await settle(() => textOf(findClass(card(main.page.root)!, 'dc-title')) !== first, 1_000);
      }
      const pick = optionByText(main.page.root, '不对，重新提');
      expect(pick).toBeDefined();
      click(pick!);
      await settle(() => descendants(card(main.page.root)!).some((element) => hasClass(element, 'opt-how')), 2_000);
      const guide = descendants(card(main.page.root)!).find((element) => hasClass(element, 'opt-how'));
      expect(textOf(guide)).toBe('要写一句哪里不对：在上面的框里写原因，写完再点确定。');
      const go = cardButton(main.page.root, '确定');
      /* 具名改坏: 空原因也放行；本行的 isOff 和下面的 0 次红。 */
      expect(isOff(go)).toBe(true);
      click(go!);
      await quietPage(main.log);
      expect(countRoute(main.log, 'decisions/answer')).toBe(0);
      click(cardButton(main.page.root, '详情')!);
      await quietPage(main.log);
      const facts = mainFacts(main.page.root);
      expect(facts.filter((fact) => fact.key === '会新建').map((fact) => fact.value)).toEqual([
        '新模块 docs 的文件，批准时定名', '新模块 src 的文件，批准时定名',
        '新模块 src/a 的文件，批准时定名', '新模块 src/b 的文件，批准时定名',
      ]);
      expect(facts.find((fact) => fact.key === '会修改')?.value).toBe('平台写的：.workbench/architecture.json');
      typeInto(main.page.root, 'dc-answer', '先不动目标 2 的文件');
      const annotation = descendants(card(main.page.root)!).find((element) =>
        element.tagName.toLowerCase() === 'textarea' && element.getAttribute('id') !== 'dc-answer');
      expect(annotation).toBeDefined();
      annotation!.value = '这个文件先别动';
      annotation!.dispatch('input', { target: annotation, currentTarget: annotation });
      await settle(() => !isOff(cardButton(main.page.root, '确定')), 2_000);
      click(cardButton(main.page.root, '确定')!);
      await settle(() => countRoute(main.log, 'decisions/answer') === 1, 3_000);
      const sent = sentWrite(callsTo(main.log, 'decisions/answer')[0]);
      expect(sent.input['selection']).toEqual({ kind: 'option', optionId: 'repropose' });
      expect(sent.input['text']).toBe('先不动目标 2 的文件');
      const annotations = sent.input['annotations'] as Array<{ text: string }>;
      expect(annotations).toHaveLength(1);
      expect(annotations[0]!.text).toBe('这个文件先别动');
    } finally {
      await main.page.restore();
    }

    const cold = await openS7D2ColdStartWorld({ backend: 'memory' });
    worlds.push(cold);
    await cold.initialize();
    await cold.advanceTo('coarse_split');
    const cardNow = await dexcNextCard(cold);
    const pin = await cold.pin();
    await cold.host.scripted.script(cold.lines.adviser,
      dexcProposal('e3d13-coarse', pin, coldStartCoarseProposal(P).ops, 'E3D-13 coarse again'));

    /* X6: Decide opens the picked repropose step, writes once with the typed reason. */
    const { page, log } = await bootDecide(worldTarget(cold.host));
    try {
      await opened(log);
      const cardRow = sectionRows(page.root, '要决定').find((entry) => textOf(entry).includes('结构提案'));
      expect(cardRow).toBeDefined();
      click(cardRow!);
      await settle(() => card(page.root) !== undefined, 3_000);
      const repropose = optionByText(page.root, '不对，重新提');
      expect(repropose).toBeDefined();
      click(repropose!);
      await settle(() => optionByText(page.root, '不对，重新提')?.getAttribute('aria-checked') === 'true', 2_000);
      /* 裁定 22: 选中“不对，重新提”不再开步骤；确定只认同一个输入框。 */
      expect(isOff(cardButton(page.root, '确定'))).toBe(true);
      click(cardButton(page.root, '确定')!);
      await settle(() => findClass(card(page.root)!, 'dc-step') === undefined, 1_000);
      typeInto(page.root, 'dc-answer', '   ');
      await settle(() => isOff(cardButton(page.root, '确定')), 1_000);
      /* 具名改坏: 空原因也放行；本行的 isOff 和下面的 0 次红。 */
      expect(isOff(cardButton(page.root, '确定'))).toBe(true);
      click(cardButton(page.root, '确定')!);
      await quiet(log);
      expect(count(log, 'decisions/answer')).toBe(0);
      typeInto(page.root, 'dc-answer', '分得太粗');
      await settle(() => !isOff(cardButton(page.root, '确定')), 2_000);
      expect(isOff(cardButton(page.root, '确定'))).toBe(false);
      /* F2: the class itself must follow `off`, not just aria-disabled, or `kit.css`'s
         `pointer-events:none` keeps a real browser's enabled confirm dead. */
      expect(hasClass(cardButton(page.root, '确定')!, 'is-off')).toBe(false);
      const confirm = cardButton(page.root, '确定')!;
      /* 同一拍里点两下：第二下走重画后的 handler，`off` 和 `go` 里的 busy 两处都挡住。 */
      const listener = confirm.listeners.get('click')![0]!;
      const held = commitBarrier.hold(byIdentityPrefix('session-message-decision-'), 'E3D-13 answer in flight');
      click(confirm);
      listener({ type: 'click', target: confirm, preventDefault() {}, stopPropagation() {} });
      await held.reached;
      /* 写口在途时“确定”灰掉；再点不会发第二次。 */
      expect(isOff(cardButton(page.root, '确定'))).toBe(true);
      click(cardButton(page.root, '确定')!);
      expect(count(log, 'decisions/answer')).toBe(1);
      held.release();
      await settle(() => callsOf(log, 'decisions/answer').some((call) => call.reply !== undefined), 5_000);
      await quiet(log);
      expect(count(log, 'decisions/answer')).toBe(1);
      const sent = writeOf(callsOf(log, 'decisions/answer')[0]!);
      expect(sent.input['selection']).toEqual({ kind: 'option', optionId: 'repropose' });
      expect(sent.input['text']).toBe('分得太粗');
      expect(sent.input['annotations']).toEqual([]);
      expect(pinSet(sent.meta.expected)).toEqual(pinSet(cardNow.source.pins));
      expect((replyOf(log, 'decisions/answer').value?.['answer'] as { status?: string } | undefined)?.status)
        .toBe('committed');
      /* 先等新卡再数轮（DEXC-10）：重提开一轮跟进，第二轮的正文带原因。 */
      await dexcNextCard(cold, cardNow);
      const rounds = await dexcRounds(cold.host, cold.lines.adviser);
      expect(rounds).toHaveLength(2);
      expect(rounds[1]).toContain('分得太粗');
    } finally {
      await page.restore();
    }
  }, 300_000);
});
