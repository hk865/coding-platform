import { afterAll, expect, it } from 'vitest';
import { cleanupScenarios } from '../scenarios/harness.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { card, cardButton, cardPos, isOff, labelled, sectionRows, settle, typeInto } from './helpers/E3D-page.js';
import { findElement } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import { memberWorld, openT33 } from './helpers/E3D-world.js';
import { click } from './helpers/E3N-interact.js';
import { bootE3N, callsOf, count, descendants, hasClass, openedPage, quietPage, textOf } from './helpers/E3N-page.js';

/**
 * Y11/Y14b (D103-1, C4, C7): the release card's source line and the text-only
 * answer's owner refusal; the member-creation card keeps 确定 off with the tip
 * and sends nothing (its requestRef is null).
 */
afterAll(async () => { await cleanupScenarios(); });

type LineListRow = { key?: { sessionId?: string }; name?: string | { source?: string; primary?: string } };
const lineRowsOf = async (world: Awaited<ReturnType<typeof openT33>>['p1']['world']) => {
  const reply = await world.post('lines/list', plain(S6A_SCOPE, { workspace: S6A_SCOPE })) as
    { body?: { value?: { rows?: LineListRow[] } }; value?: { rows?: LineListRow[] } };
  return (reply.body ?? reply).value?.rows ?? [];
};

it('⑧a the release card says where it came from; words alone leave 确定 grey and send nothing', async () => {
  const { p1 } = await openT33();
  const { page, log } = await bootE3N(p1.world, 'Decide');
  try {
    await openedPage(log);
    const rows = sectionRows(page.root, '要决定');
    let dispatch: ReturnType<typeof sectionRows>[number] | undefined;
    for (const row of rows) {
      click(row);
      await settle(() => card(page.root) !== undefined, 2_000);
      click(cardButton(page.root, '详情')!);
      await settle(() => cardButton(page.root, '批准') !== undefined, 1_000);
      if (cardButton(page.root, '批准') !== undefined) { dispatch = row; break; }
    }
    expect(dispatch, 'the dispatch card').toBeDefined();
    const sender = sectionRows(page.root, '要决定').length > 0 ? callsOf(log, 'decisions/queue').at(-1)?.reply : undefined;
    const cardReply = (sender as { value?: { waitingAnswer?: Array<{ source?: { kind?: string }; senderSessionRef?: { sessionId?: string } }> } } | undefined)
      ?.value?.waitingAnswer?.find((entry) => entry.source?.kind === 'action_release');
    const rowsList = await lineRowsOf(p1.world);
    const line = rowsList.find((row) => row.key?.sessionId === cardReply?.senderSessionRef?.sessionId);
    const rawName = line?.name;
    const lineName = typeof rawName === 'string' ? rawName
      : rawName?.source === 'duty_only' ? ({ adviser: '参谋' } as Record<string, string>)[rawName.primary ?? '']
        : rawName?.primary;
    expect(lineName, 'the sender line is in lines/list').toBeDefined();
    const lineText = descendants(card(page.root)!).find((element) => hasClass(element, 'dc-line'));
    expect(lineText === undefined ? '' : textOf(lineText)).toContain('来自 ');
    expect(lineText === undefined ? '' : textOf(lineText)).toContain(lineName!);
    expect(lineText === undefined ? '' : textOf(lineText)).toContain(' · 目标 ');
    /* Lead 11-25: 确定 reads needsOption, as the main card does; a release card
       the server refuses words alone for keeps 确定 grey and sends nothing. */
    typeInto(page.root, 'dc-answer', '先按现在这样做');
    await quietPage(log);
    expect(isOff(cardButton(page.root, '确定'))).toBe(true);
    click(cardButton(page.root, '确定')!);
    await quietPage(log);
    expect(count(log, 'decisions/answer')).toBe(0);
    expect(count(log, 'requests/ask')).toBe(0);
  } finally {
    await page.restore();
    await p1.close();
  }
}, 240_000);

it('Q1 switching cards shows the next card’s own empty pick, so an untouched card cannot be confirmed', async () => {
  const { p1 } = await openT33();
  const { page, log } = await bootE3N(p1.world, 'Decide');
  try {
    await openedPage(log);
    const rows = sectionRows(page.root, '要决定');
    let dispatchText = '';
    for (const row of rows) {
      click(row);
      await settle(() => card(page.root) !== undefined, 2_000);
      if (cardButton(page.root, '批准') !== undefined) { dispatchText = textOf(row); break; }
    }
    expect(dispatchText).not.toBe('');
    click(cardButton(page.root, '批准')!);
    await settle(() => descendants(card(page.root)!).some((element) => hasClass(element, 'opt') && hasClass(element, 'is-on')), 1_000);
    expect(isOff(cardButton(page.root, '确定'))).toBe(false);
    const before = cardPos(page.root);
    click(labelled(card(page.root), '下一条')!);
    await settle(() => cardPos(page.root) !== before, 2_000);
    expect(card(page.root)).toBeDefined();
    expect(descendants(card(page.root)!).filter((element) => hasClass(element, 'opt') && hasClass(element, 'is-on'))).toEqual([]);
    expect(isOff(cardButton(page.root, '确定'))).toBe(true);
  } finally {
    await page.restore();
    await p1.close();
  }
}, 240_000);

/** The open card's options drawn on (`.opt.is-on`), and its answer box. */
const onOptions = (root: FakeElement): FakeElement[] =>
  descendants(card(root)!).filter((element) => hasClass(element, 'opt') && hasClass(element, 'is-on'));
const answerBox = (root: FakeElement): FakeElement | undefined =>
  findElement(card(root)!, (element) => element.getAttribute('id') === 'dc-answer');

/* Lead 11-25 (fix 2/3/4, items 1 and 4): a card's pick, words and annotations
   are kept by its cardKey. The card the page shows on opening answers without
   a click on its row; answered, it leaves the queue and the card the page falls
   to shows its own empty inputs; words on a card stay on it across a close. */
it('Q3 the card shown on opening answers at once, and its pick and words stay on that card', async () => {
  const { p1 } = await openT33();
  const { page, log } = await bootE3N(p1.world, 'Decide');
  try {
    await openedPage(log);
    await settle(() => card(page.root) !== undefined, 2_000);
    const first = cardPos(page.root);
    const option = descendants(card(page.root)!).find((element) => element.tagName.toLowerCase() === 'button'
      && hasClass(element, 'opt-top'));
    expect(option, 'the opening card has options').toBeDefined();
    click(option!);
    await settle(() => onOptions(page.root).length === 1, 1_000);
    /* 具名改坏: 选中项仍只认 `s.dec === cur.key`；打开页面时显示的卡点选项不亮，本行红。 */
    expect(onOptions(page.root)).toHaveLength(1);
    expect(isOff(cardButton(page.root, '确定'))).toBe(false);
    typeInto(page.root, 'dc-answer', '先按这张卡说的办');
    await settle(() => answerBox(page.root)?.value === '先按这张卡说的办', 1_000);

    click(cardButton(page.root, '确定')!);
    await settle(() => callsOf(log, 'decisions/answer').some((call) => call.reply !== undefined), 8_000);
    await quietPage(log);
    expect(count(log, 'decisions/answer')).toBe(1);
    await settle(() => card(page.root) !== undefined && cardPos(page.root) !== first, 2_000);
    expect(answerBox(page.root), 'the card the page fell to has its own answer box').toBeDefined();
    /* 具名改坏（改前的样子）: 写的话记在一个 `answerText` 上，换卡入口清、答完不清；落到的卡框里还是上一张的话，本行红。 */
    expect(answerBox(page.root)!.value).toBe('');
    expect(onOptions(page.root)).toEqual([]);
    expect(isOff(cardButton(page.root, '确定'))).toBe(true);
    click(cardButton(page.root, '确定')!);
    await quietPage(log);
    expect(count(log, 'decisions/answer')).toBe(1);

    /* Back on a card after leaving it, its words are still there. */
    typeInto(page.root, 'dc-answer', '这张先别动');
    await settle(() => answerBox(page.root)?.value === '这张先别动', 1_000);
    click(labelled(card(page.root), '稍后处理')!);
    await settle(() => card(page.root) === undefined, 1_000);
    click(sectionRows(page.root, '要决定')[0]!);
    await settle(() => card(page.root) !== undefined, 2_000);
    /* 具名改坏: 点行时把这张卡的输入清掉；回到这张卡写的话没了，本行红。 */
    expect(answerBox(page.root)?.value).toBe('这张先别动');
  } finally {
    await page.restore();
    await p1.close();
  }
}, 240_000);

/* Lead 11-25 ruling 2: a failed write's line belongs to its card. A card switch
   keeps it under that card, and the other card shows none. */
it('Q5 a failed answer’s line stays under its card across a switch, and the other card has none', async () => {
  const { p1 } = await openT33();
  const { page, log } = await bootE3N(p1.world, 'Decide',
    { rejectOnce: { route: 'decisions/answer', code: 'unavailable', reason: 'E3D Q5: the answer write failed' } });
  const failLine = (): string => descendants(card(page.root)!).filter((element) => hasClass(element, 'tx-failed'))
    .map((element) => textOf(element)).join('');
  try {
    await openedPage(log);
    await settle(() => card(page.root) !== undefined, 2_000);
    const first = cardPos(page.root);
    click(descendants(card(page.root)!).find((element) => element.tagName.toLowerCase() === 'button'
      && hasClass(element, 'opt-top'))!);
    await settle(() => onOptions(page.root).length === 1, 1_000);
    click(cardButton(page.root, '确定')!);
    await settle(() => failLine() !== '', 5_000);
    const failed = failLine();
    expect(failed).not.toBe('');
    click(labelled(card(page.root), '下一条')!);
    await settle(() => cardPos(page.root) !== first, 2_000);
    expect(failLine()).toBe('');
    click(sectionRows(page.root, '要决定')[0]!);
    await settle(() => cardPos(page.root) === first, 2_000);
    /* 具名改坏: 点行时清 `cardFail`；回到写失败的卡，失败字没了，本行红。 */
    expect(failLine()).toBe(failed);
    expect(count(log, 'decisions/answer')).toBe(1);
  } finally {
    await page.restore();
    await p1.close();
  }
}, 240_000);

/* Review 1 (lead 11-25): the kept pick must not let a card send its answer twice;
   an answer in flight belongs to its card across a switch, as on Main. */
it('Q4 an answer in flight stays with its card across a switch, so that card cannot send it twice', async () => {
  const { p1 } = await openT33();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let answers = 0;
  const { page, log } = await bootE3N(p1.world, 'Decide',
    { before: { 'decisions/answer': async () => { answers += 1; await gate; } } });
  try {
    await openedPage(log);
    await settle(() => card(page.root) !== undefined, 2_000);
    const first = cardPos(page.root);
    click(descendants(card(page.root)!).find((element) => element.tagName.toLowerCase() === 'button'
      && hasClass(element, 'opt-top'))!);
    await settle(() => onOptions(page.root).length === 1, 1_000);
    click(cardButton(page.root, '确定')!);
    await settle(() => answers === 1, 2_000);
    click(labelled(card(page.root), '下一条')!);
    await settle(() => cardPos(page.root) !== first, 2_000);
    click(sectionRows(page.root, '要决定')[0]!);
    await settle(() => cardPos(page.root) === first, 2_000);
    /* 具名改坏: 换卡时把 `cardBusy` 清掉；回到在途的卡“确定”又能点，第二下发出去，下面两行红。 */
    expect(isOff(cardButton(page.root, '确定'))).toBe(true);
    click(cardButton(page.root, '确定')!);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(answers).toBe(1);
    release();
    await settle(() => callsOf(log, 'decisions/answer').some((call) => call.reply !== undefined), 8_000);
    await quietPage(log);
    expect(count(log, 'decisions/answer')).toBe(1);
  } finally {
    release();
    await page.restore();
    await p1.close();
  }
}, 240_000);

it('⑧b the member-creation card keeps 确定 off and sends no request', async () => {
  const { h } = await memberWorld();
  const { page, log } = await bootE3N(h.host, 'Decide');
  try {
    await openedPage(log);
    const row = sectionRows(page.root, '要决定').find((entry) => (entry.textContent ?? '').includes('成员创建'));
    expect(row).toBeDefined();
    click(row!);
    await settle(() => card(page.root) !== undefined, 2_000);
    typeInto(page.root, 'dc-answer', '这个成员先缓一缓');
    await settle(() => isOff(cardButton(page.root, '确定')), 1_000);
    const decide = cardButton(page.root, '确定');
    expect(isOff(decide)).toBe(true);
    expect(decide!.getAttribute('title')).toBe('这张卡没有请求号；点‘问秘书’');
    click(decide!);
    await quietPage(log);
    expect(count(log, 'decisions/answer')).toBe(0);
    expect(count(log, 'requests/ask')).toBe(0);
    expect(count(log, 'requests/submit')).toBe(0);
  } finally {
    await page.restore();
  }
}, 240_000);
