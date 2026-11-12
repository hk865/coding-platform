import { afterEach, describe, expect, it } from 'vitest';
import { findAllClass, findButton, findClass, findElement } from './helpers/boot-page.js';
import {
  answerTexts, bootE3N, callsTo, clickable, countRoute, descendants, hasClass, onMain, quietPage, textOf, thread, userTexts, waitFor,
} from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { answerRequest, openW1, openWA, submitRequest } from './helpers/E3N-world.js';
import { card, cardButton, labelled, typeInto } from './helpers/E3D-page.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE, type S6ARequestWorld } from '../helpers/S6A-request-fixture.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * E3U T-A01–T-A04, T-A16 (test sheet e3main-a-tests §1.1, §1.2): the main
 * conversation reads `main/read` (A12), sends through `requests/submit` (A19),
 * shows a quote's lines (MF11), opens the raw records on 轨迹 (A15), reads the
 * older page through the previous page's `next` (ruling 5, MF4) and keeps two
 * equal asks apart by their request roots (T-A21, review S3). Real Host,
 * scripted model; every expected value is a literal of the row or a public read.
 */

const worlds: S6ARequestWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

const GOAL = '?goal=ag2b-goal';
const SAMPLE = '检查链第 2 轮怎么卡住了';

describe('E3U Main thread', () => {
  it('T-A01 the thread shows the two requests and the secretary answers main/read returns', async () => {
    const opened = await openWA();
    worlds.push(opened.world);
    await answerRequest(opened, { commandId: 'e3u-a01-1', text: '先看第一件事', answer: '第一件事的回答' });
    await answerRequest(opened, { commandId: 'e3u-a01-2', text: '再看第二件事', answer: '第二件事的回答' });
    const { page, log } = await bootE3N(opened.world, 'Main', { search: GOAL });
    try {
      /* 具名改坏: `src/ui/boot.ts` 的 `readMain` 删掉 `main/read` 调用；两条气泡断言红。 */
      await waitFor(() => userTexts(page.root).length === 2);
      expect(userTexts(page.root)).toEqual(['先看第一件事', '再看第二件事']);
      expect(answerTexts(page.root)).toEqual(['第一件事的回答', '第二件事的回答']);
      expect(countRoute(log, 'main/read')).toBeGreaterThanOrEqual(1);
      expect(page.root.textContent).not.toContain(SAMPLE);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('T-A02 发送 submits one request on the page Goal and shows the user text', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Main', { search: GOAL });
    try {
      await quietPage(log);
      typeInto(page.root, 'composer-input', '请总结');
      click(labelled(page.root, '发送')!);
      /* 具名改坏: `askSecretary` 改调 `messages/user-send`；`requests/submit` 的计数红。 */
      await expect.poll(() => countRoute(log, 'requests/submit'), { timeout: 8_000, interval: 25 }).toBe(1);
      const input = callsTo(log, 'requests/submit')[0]!.input as Record<string, unknown>;
      expect(input['goalId']).toBe('ag2b-goal');
      expect(input['text']).toBe('请总结');
      expect(input['continues']).toBeNull();
      expect(input['recipient']).toBeNull();
      expect(input['references']).toEqual([]);
      expect(countRoute(log, 'requests/ask')).toBe(0);
      await waitFor(() => countRoute(log, 'requests/read') >= 1);
      await waitFor(() => userTexts(page.root).includes('请总结'));
    } finally {
      await page.restore();
    }
  }, 60_000);

  /* MF11: a single line reads `endLine ?? startLine`. The Host stores an input
     `endLine: null` with a start line as that start line (request-references.ts:87). */
  it.each([
    ['one line, endLine null', { path: 'src/module.ts', startLine: 5, endLine: null, snapshot: '第五行原文' }, '第 5 行'],
    ['a range', { path: 'src/module.ts', startLine: 5, endLine: 7, snapshot: '第五到七行原文' }, '第 5–7 行'],
    ['the whole file', { path: 'src/module.ts', startLine: null, endLine: null, snapshot: null }, '整个文件'],
  ] as const)('T-A03 a quote in the user bubble reads its lines: %s', async (_name, reference, lines) => {
    const opened = await openW1();
    worlds.push(opened.world);
    await submitRequest(opened.world, { commandId: 'e3u-a03', text: '看这段', references: [{ ...reference }] });
    const { page } = await bootE3N(opened.world, 'Main', { search: GOAL });
    try {
      await waitFor(() => findClass(thread(page.root) ?? page.root, 'bq') !== undefined);
      const quote = findClass(thread(page.root)!, 'bq')!;
      expect(textOf(findClass(quote, 'bq-path'))).toBe('src/module.ts');
      /* 具名改坏: `src/ui/adapters/main.ts` 的引用行号总写 `第 a–b 行`；第一项红（第 5–5 行）。 */
      expect(textOf(quote)).toContain(lines);
      expect(textOf(quote)).not.toContain('null');
      if (reference.snapshot !== null) {
        const toggle = findClass(quote, 'bq-ref');
        if (!textOf(quote).includes(reference.snapshot) && toggle !== undefined) click(toggle);
        expect(textOf(quote)).toContain(reference.snapshot);
      }
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('T-A04 轨迹 reads the request owner’s raw records and shows time, kind and id', async () => {
    const opened = await openWA();
    worlds.push(opened.world);
    await answerRequest(opened, { commandId: 'e3u-a04', text: '轨迹里看', answer: '好的' });
    const main = (await opened.world.post('main/read', plain(S6A_SCOPE, { goalId: 'ag2b-goal', cursor: null }))).body as
      { value: { requests: Array<{ owner: unknown }> } };
    const owner = main.value.requests[0]!.owner;
    const history = (await opened.world.post('sessions/history', plain(S6A_SCOPE, {
      sessionRef: owner, afterCursor: null, throughCursor: null, limit: 100,
    }))).body as { value: { items: Array<{ recordId: string; recordedAt: string; kind: string }> } };
    const first = history.value.items[0]!;
    const { page, log } = await bootE3N(opened.world, 'Main', { search: GOAL });
    try {
      await waitFor(() => countRoute(log, 'main/read') >= 1);
      await quietPage(log);
      click(findElement(page.root, (element) => element.getAttribute('role') === 'tab' && textOf(element) === '轨迹')!);
      await waitFor(() => traceRows(page.root).length > 0 && countRoute(log, 'sessions/history') === 1);
      await quietPage(log);
      expect(countRoute(log, 'sessions/history')).toBe(1);
      /* 具名改坏: `readMain` 把 `sessionRef` 写成执行者线；`sessionRef` 断言红。 */
      expect((callsTo(log, 'sessions/history')[0]!.input as { sessionRef: unknown }).sessionRef).toEqual(owner);
      const cells = findAllClass(traceRows(page.root)[0]!, 'lg-c').map((cell) => textOf(cell));
      expect(cells).toEqual([localShort(first.recordedAt), 'session_created', first.recordId, '']);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('T-A16 the older page is read through the first page’s next and joins above it', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const texts = Array.from({ length: 21 }, (_, index) => `第 ${String(index + 1).padStart(2, '0')} 条`);
    for (const [index, text] of texts.entries()) {
      await submitRequest(opened.world, { commandId: `e3u-a16-${index + 1}`, text });
    }
    const { page, log } = await bootE3N(opened.world, 'Main', { search: GOAL });
    try {
      await waitFor(() => callsTo(log, 'main/read').some((call) => call.reply !== undefined));
      const first = callsTo(log, 'main/read')[0]!;
      expect((first.input as { cursor: unknown }).cursor).toBeNull();
      const next = (first.reply as { value: { next: unknown } }).value.next;
      expect(next).not.toBeNull();
      await waitFor(() => clickable(page.root, '还有更早的对话，点这里展开') !== undefined);
      click(clickable(page.root, '还有更早的对话，点这里展开')!);
      /* 具名改坏: `readMain` 只读 `cursor:null` 那一页；第二页的气泡断言红。 */
      await waitFor(() => userTexts(page.root).length === 21);
      expect(userTexts(page.root)).toEqual(texts);
      const older = callsTo(log, 'main/read').filter((call) => (call.input as { cursor: unknown }).cursor !== null);
      expect(older.length).toBeGreaterThanOrEqual(1);
      for (const call of older) expect((call.input as { cursor: unknown }).cursor).toEqual(next);
    } finally {
      await page.restore();
    }
  }, 90_000);

  it('T-A20 方案卡不编版本和采用状态', async () => {
    const opened = await openWA();
    worlds.push(opened.world);
    await answerRequest(opened, { commandId: 'e3u-a20', text: '给两个做法', answer: '有两个做法。',
      ideas: [{ title: '只重跑没过的两项', detail: '只跑类型检查和单元测试。' },
        { title: '整轮重跑', detail: '所有检查都重跑一遍。' }] });
    const { page } = await bootE3N(opened.world, 'Main', { search: GOAL });
    try {
      await waitFor(() => findClass(page.root, 'plan') !== undefined);
      const plan = findClass(page.root, 'plan')!;
      /* 具名改坏: `title` 写回“方案 · 第 1 版”、`stText` 写回“未采用”；前两句红。 */
      expect(textOf(findClass(plan, 'ttl')!)).toBe('方案');
      expect(textOf(findClass(plan, 'st')!)).toBe('还没接通');
      expect(textOf(plan)).not.toContain('第 1 版');
      expect(textOf(plan)).not.toContain('未采用');
      expect(findClass(plan, 'opt-kv')).toBeUndefined();
    } finally {
      await page.restore();
    }
  });

  /* Main A review S3 (lead 11-12): a waiting bubble is claimed by its own request
     root, never by an equal text. The stream is held, so a reread happens only
     at the two frames the row sends; between them the first ask is a read row
     and the second still a waiting bubble with the same words. */
  it('T-A21 the same words asked twice on a card stay two bubbles, each claimed by its own row', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    await onMain(opened.world, async (page, log) => {
      const SAME = '同一句话';
      const same = (): number => userTexts(page.root).filter((text) => text === SAME).length;
      const answered = (route: string): number => callsTo(log, route).filter((call) => call.reply !== undefined).length;
      const askOnCard = async (n: number): Promise<void> => {
        const decide = (): FakeElement | undefined => findButton(findClass(page.root, 'goalbar') ?? page.root, '需要你决定');
        await waitFor(() => decide() !== undefined);
        click(decide()!);
        await waitFor(() => cardButton(page.root, '问秘书') !== undefined);
        click(cardButton(page.root, '问秘书')!);
        await waitFor(() => card(page.root) === undefined && labelled(page.root, '发送') !== undefined);
        typeInto(page.root, 'composer-input', SAME);
        click(labelled(page.root, '发送')!);
        await waitFor(() => answered('requests/submit') === n && answered('requests/read') === n);
        await quietPage(log);
      };
      const reread = async (id: string): Promise<void> => {
        const reads = answered('main/read');
        log.openings.at(-1)!.enqueue(new TextEncoder().encode(`event: change\nid: ${id}\ndata: {}\n\n`));
        await waitFor(() => answered('main/read') > reads);
        await quietPage(log);
      };
      await askOnCard(1);
      await reread('c0000000002');
      expect(same()).toBe(1);
      await askOnCard(2);
      const roots = log.submits.map((reply) => JSON.stringify((reply as { requestRoot?: unknown }).requestRoot));
      expect(new Set(roots).size).toBe(2);
      /* 具名改坏: `src/ui/boards/Main.dc.html` 的认领改按文字比对（`roots` 换成读回行的文字集合）；这一句红（只剩一条）。 */
      expect(same()).toBe(2);
      await reread('c0000000003');
      expect(same()).toBe(2);
    }, { search: GOAL });
  }, 120_000);
});

/** The trace rows (`.lg-row` without the header `.lg-th`). */
function traceRows(root: FakeElement): FakeElement[] {
  const list = findClass(root, 'lg');
  return list === undefined ? [] : descendants(list).filter((row) => hasClass(row, 'lg-row') && !hasClass(row, 'lg-th'));
}

/** A15 by hand: the browser-local `MM-DD HH:mm` of an ISO time. */
function localShort(iso: string): string {
  const at = new Date(iso);
  const two = (value: number): string => String(value).padStart(2, '0');
  return `${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`;
}
