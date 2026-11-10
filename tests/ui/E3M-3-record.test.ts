import { isDeepStrictEqual } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { findAllClass, findClass } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import { countRoute, hasClass, mainHeadTitle, textOf, type PageLog } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import {
  UUID_V4, bootMemberAt, buttonText, callsOf, elementsOf, memberInput, memberSearch, metaOf, openMemberS7C, openMemberW3,
  press, radio, receiptBody, recordRows, settle, typeDraft, worldSlot, type MemberPage,
} from './helpers/E3M-world.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';

/**
 * E3M-3 (test sheet §2.3, M17–M30, G11/G14–G17): the centre — a Run row that
 * opens to 还没接通, the live Run's head, the message track, 问一问 and 直接干预
 * with their own drafts and samples, the copy rows and their side thread, and
 * an earlier record shown in the middle and left again.
 */

const slot = worldSlot();
afterAll(async () => { await slot.close(); }, 180_000);
const w1 = () => slot.use('W1', () => openMemberS7C({ copy: true }), (opened) => opened.s7c.close());
const w3 = () => slot.use('W3', () => openMemberW3(), (opened) => opened.close());
const w2 = () => slot.use('W2', () => openMemberS7C({ firstRun: 'held', track: true }), (opened) => opened.s7c.close());

const WRITE_ROUTES = ['messages/send', 'messages/apply', 'queries/ask', 'controls/submit', 'tasks/requeue'];
const writes = (log: PageLog): number => WRITE_ROUTES.reduce((sum, route) => sum + countRoute(log, route), 0);

const thread = (root: FakeElement): FakeElement | undefined => findClass(root, 'thread');
const sysLines = (root: FakeElement): string[] => findAllClass(thread(root) ?? root, 'sys-line').map((line) => textOf(line));

const bootW1 = async (): Promise<MemberPage & { w: Awaited<ReturnType<typeof w1>> }> => {
  const w = await w1();
  return { w, ...await bootMemberAt(w.s7c.world, memberSearch('s7c-goal', w.module)) };
};

/** A copy's own row in the right panel: the prototype's derived-record `button.row.kid` (`Member.dc.html:990-1019`),
 *  named by its question; the parent message's row is a plain `row` and never matches (lead 11-10). */
const copyRow = (root: FakeElement, question: string): FakeElement | undefined => recordRows(root)
  .find((row) => hasClass(row, 'kid') && textOf(findClass(row, 'row-name')) === question);
const side = (root: FakeElement): FakeElement | undefined => findClass(findClass(root, 'detail') ?? root, 'side');
const sideBubble = (root: FakeElement): string => textOf(findClass(side(root) ?? root, 'bubble'));
const sideProse = (root: FakeElement): string[] => findAllClass(side(root) ?? root, 'prose').map((prose) => textOf(prose));

/** The copy's first answer as `queries/read` states it (the pin-like ref a row reads, as E3G's `e3gCardPins`). */
async function firstAnswerRef(world: Awaited<ReturnType<typeof w1>>['s7c']['world'], round: unknown): Promise<unknown> {
  const read = (await world.post('queries/read', plain(S6A_SCOPE, round))).body as
    { value?: { job?: { job?: { answerRefs?: unknown[] } } } };
  return read.value?.job?.job?.answerRefs?.[0] ?? null;
}

/** Select the record rows in turn until the detail offers `label` (the row's precondition, not its action). */
async function detailOffering(root: FakeElement, label: string): Promise<FakeElement | undefined> {
  for (let index = 0; index < recordRows(root).length; index += 1) {
    click(recordRows(root)[index]!);
    await settle(() => buttonText(findClass(root, 'detail'), label) !== undefined, 300);
    const found = buttonText(findClass(root, 'detail'), label);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The page question's Query (the `queries/ask` answer of the 问一问 row), read by the copy row that follows it. */
let pageRound: unknown = null;

describe('E3M-3 the Member centre', () => {
  it('R18 a Run row opens to 还没接通 only (M17/G11, 部分)', async () => {
    const { page } = await bootW1();
    try {
      press(elementsOf(thread(page.root), 'button', 'run')[0], 'button.run');
      await settle(() => findAllClass(thread(page.root)!, 'steps').length > 0);
      /* 具名改坏: 适配器把 `kernel_session_record_json` 解析成步骤，`.step-verb` 出现；本行的“只有还没接通”红。 */
      expect(findAllClass(thread(page.root)!, 'steps').map((steps) => textOf(steps))).toEqual(['还没接通']);
      expect(findClass(thread(page.root)!, 'step-verb')).toBeUndefined();
      expect(textOf(thread(page.root))).not.toContain('S7C first Work answer');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('R22 问一问 sends one queries/ask with a UUID command id (M25/M29/G14/G17)', async () => {
    const { w, ...booted } = await bootW1();
    const { page, log } = booted;
    try {
      typeDraft(page.root, 'E3M page question');
      press(findClass(page.root, 'send'), 'send');
      await settle(() => booted.receipts.some((receipt) => receipt.route === 'queries/ask'));
      /* 具名改坏: `askLine` 改走 `messages/send`；本行的 `queries/ask` 红。 */
      const calls = callsOf(log, 'queries/ask');
      expect(calls).toHaveLength(1);
      expect(calls[0]!.input).toEqual({
        sessionRef: { projectId: 'ag2b-collab-project', sessionId: w.module.sessionId },
        question: 'E3M page question', commandId: expect.stringMatching(UUID_V4),
      });
      expect(countRoute(log, 'messages/send')).toBe(0);
      expect(receiptBody(booted, 'queries/ask')?.['status']).toBe('queued');
      pageRound = receiptBody(booted, 'queries/ask')?.['round'] ?? null;
    } finally {
      await page.restore();
    }
  }, 120_000);

  /* lead 11-10: `queries/ask` runs the copy to its answer at once (copies `settled`, `queries/answer` ready), so the
     row reads the answered half; the 正在建立咨询… half of the sheet is not reachable on a public path. */
  it('R23 the page question’s copy is answered: its row names the question and does not wait (M36 answered half)', async () => {
    const w = await w1();
    /* Read before the page boots: the booted page's fetch would log this read as the page's own (lead 11-10). */
    const answer = await firstAnswerRef(w.s7c.world, pageRound);
    const { page, log } = await bootMemberAt(w.s7c.world, memberSearch('s7c-goal', w.module));
    try {
      const row = copyRow(page.root, 'E3M page question');
      /* 具名改坏: 适配器从 `message.requestRoot` 找 Query（`SessionMessage` 没有这个字段），`query=null`，问题原文空；本行的“副本行含问题原文”红。 */
      expect(row).toBeDefined();
      expect(findAllClass(row!, 'cw-wait')).toHaveLength(0);
      expect(callsOf(log, 'queries/read').filter((call) => isDeepStrictEqual(call.input, pageRound))).toHaveLength(1);
      expect(callsOf(log, 'queries/answer').filter((call) => isDeepStrictEqual(call.input, answer))).toHaveLength(1);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('R24 直接干预 sends one action_request that needs a reply (M26/G15)', async () => {
    const { w, ...booted } = await bootW1();
    const { page, log } = booted;
    try {
      press(radio(page.root, '直接干预'), '直接干预');
      await settle(() => radio(page.root, '直接干预')?.getAttribute('aria-checked') === 'true');
      typeDraft(page.root, 'E3M intervention');
      press(findClass(page.root, 'send'), 'send');
      const bubbles = () => elementsOf(thread(page.root), 'div', 'msg-user').map((message) => textOf(findClass(message, 'bubble')));
      await settle(() => booted.receipts.some((receipt) => receipt.route === 'messages/send') && bubbles().includes('E3M intervention'), 5_000);
      const calls = callsOf(log, 'messages/send');
      expect(calls).toHaveLength(1);
      /* 具名改坏: `intent` 改成 `notify`；本行的 `input` 红。 */
      expect(calls[0]!.input).toEqual({
        recipient: { projectId: 'ag2b-collab-project', sessionId: w.module.sessionId },
        text: 'E3M intervention', intent: 'action_request', needsReply: true,
      });
      expect(metaOf(calls[0]).requestId).toMatch(UUID_V4);
      expect(metaOf(calls[0]).expected).toEqual([]);
      expect(receiptBody(booted, 'messages/send')?.['status']).toBe('committed');
      expect(receiptBody(booted, 'messages/send')?.['sendStatus']).toBe('sent');
      expect(bubbles()).toContain('E3M intervention');
    } finally {
      await page.restore();
    }
  }, 120_000);

  it.each([
    { entry: '切到直接干预', back: false, expected: '' },
    { entry: '切回问一问', back: true, expected: 'E3M draft' },
  ])('R25 each mode keeps its own draft: $entry (M27/M28/G16)', async ({ back, expected }) => {
    const { page, log } = await bootW1();
    try {
      expect(countRoute(log, 'lines/read')).toBe(1);
      typeDraft(page.root, 'E3M draft');
      press(radio(page.root, '直接干预'), '直接干预');
      if (back) {
        await settle(() => radio(page.root, '直接干预')?.getAttribute('aria-checked') === 'true');
        press(radio(page.root, '问一问'), '问一问');
      }
      await settle(() => memberInput(page.root)?.value === expected, 500);
      /* 具名改坏: 两模式共用一个草稿；切回的条目红。 */
      expect(memberInput(page.root)?.value).toBe(expected);
      expect(writes(log)).toBe(0);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it.each([
    { entry: '问一问', intervene: false, expected: '现在改到哪了？还差什么？' },
    { entry: '直接干预', intervene: true, expected: '推送事件里的状态词直接用规格里的那张表，不要自己起名。' },
  ])('R26 填入示例 fills the sample of $entry (M27/M28/G16)', async ({ intervene, expected }) => {
    const { page, log } = await bootW1();
    try {
      expect(countRoute(log, 'lines/read')).toBe(1);
      if (intervene) {
        press(radio(page.root, '直接干预'), '直接干预');
        await settle(() => radio(page.root, '直接干预')?.getAttribute('aria-checked') === 'true');
      }
      press(buttonText(page.root, '填入示例'), '填入示例');
      await settle(() => memberInput(page.root)?.value === expected, 500);
      /* 具名改坏: 两个模式用同一句样例；干预条目红。 */
      expect(memberInput(page.root)?.value).toBe(expected);
      expect(writes(log)).toBe(0);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('R28 the asked copy is answered: its side thread shows the question and E3M copy answer (M35/M38)', async () => {
    const { w, page } = await bootW1();
    try {
      expect(w.copyRound).not.toBeNull();
      const row = copyRow(page.root, 'E3M copy question');
      expect(row).toBeDefined();
      expect(findAllClass(row!, 'cw-wait')).toHaveLength(0);
      press(row, 'the copy row');
      await settle(() => sideBubble(page.root) !== '' && sideProse(page.root).includes('E3M copy answer'));
      /* 具名改坏: 侧线程拿 `messageId` 冒充正文；本行的原文红。 */
      expect(sideBubble(page.root)).toBe('E3M copy question');
      expect(sideProse(page.root)).toContain('E3M copy answer');
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('R29 据此直接干预 switches to 直接干预 with the sample and sends nothing (M39)', async () => {
    const { page, log } = await bootW1();
    try {
      press(copyRow(page.root, 'E3M copy question'), 'the copy row');
      await settle(() => buttonText(findClass(page.root, 'detail'), '据此直接干预') !== undefined);
      press(buttonText(findClass(page.root, 'detail'), '据此直接干预'), '据此直接干预');
      await settle(() => radio(page.root, '直接干预')?.getAttribute('aria-checked') === 'true');
      expect(radio(page.root, '直接干预')?.getAttribute('aria-checked')).toBe('true');
      expect(memberInput(page.root)?.value).toBe('推送事件里的状态词直接用规格里的那张表，不要自己起名。');
      /* 具名改坏: 点“据此直接干预”直接发送；本行的零请求红。 */
      expect(countRoute(log, 'messages/send')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('R19 在中间查看 shows the earlier record with 回到这条工作线 and reads no line (M18/M39)', async () => {
    const w = await w3();
    const { page, log } = await bootMemberAt(w.world, memberSearch('ag2b-goal', w.worker.ref));
    try {
      expect(countRoute(log, 'lines/read')).toBe(1);
      const view = await detailOffering(page.root, '在中间查看');
      const before = log.calls.length;
      press(view, '在中间查看');
      await settle(() => sysLines(page.root).some((line) => line.includes('回到这条工作线')));
      expect(sysLines(page.root).some((line) => line.includes('回到这条工作线'))).toBe(true);
      /* 具名改坏: `在中间查看` 再读一次 `lines/read`；本行的请求数红。 */
      expect(callsOf(log, 'lines/read', before)).toHaveLength(0);
      expect(callsOf(log, 'lines/page', before)).toHaveLength(0);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('R27 回到这条工作线 brings the line’s own record back and reads no line (M18/M39)', async () => {
    const w = await w3();
    const { page, log } = await bootMemberAt(w.world, memberSearch('ag2b-goal', w.worker.ref));
    try {
      expect(countRoute(log, 'lines/read')).toBe(1);
      press(await detailOffering(page.root, '在中间查看'), '在中间查看');
      await settle(() => buttonText(findClass(page.root, 'detail'), '回到这条工作线') !== undefined);
      const before = log.calls.length;
      press(buttonText(findClass(page.root, 'detail'), '回到这条工作线'), '回到这条工作线');
      await settle(() => !sysLines(page.root).some((line) => line.includes('回到这条工作线')));
      expect(sysLines(page.root).some((line) => line.includes('回到这条工作线'))).toBe(false);
      expect(mainHeadTitle(page.root)).toBe('执行者');
      /* 具名改坏: `回到这条工作线` 再读一次 `lines/page`；本行的请求数红。 */
      expect(callsOf(log, 'lines/read', before)).toHaveLength(0);
      expect(callsOf(log, 'lines/page', before)).toHaveLength(0);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('R20 the live Run row reads 正在执行：… 起 and reads its Run once (M19, 部分)', async () => {
    const w = await w2();
    const { page, log } = await bootMemberAt(w.s7c.world, memberSearch('s7c-goal', w.module));
    try {
      const run = elementsOf(thread(page.root), 'button', 'run')[0];
      const head = elementsOf(run, 'span').find((span) => !(span.getAttribute('class') ?? '').split(/\s+/).includes('t'));
      /* 具名改坏: 把 Run 行头文字改成 `已结束：`；本行的头红。 */
      expect(textOf(head)).toMatch(/^正在执行：/);
      expect(textOf(findClass(run!, 't'))).toMatch(/ 起$/);
      expect(callsOf(log, 'executions/read').filter((call) => isDeepStrictEqual(call.input, w.s7c.run.runRef))).toHaveLength(1);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('R21 the sent message’s track reads 已排队 and a click writes nothing (M20/M21)', async () => {
    const w = await w2();
    const { page, log } = await bootMemberAt(w.s7c.world, memberSearch('s7c-goal', w.module));
    try {
      const message = () => elementsOf(thread(page.root), 'div', 'msg-user')
        .find((entry) => textOf(findClass(entry, 'bubble')) === 'E3M track message');
      expect(message()).toBeDefined();
      const track = () => findClass(message()!, 'deliv');
      expect(track()?.getAttribute('aria-label') ?? '').toMatch(/^消息状态：/);
      expect(textOf(findClass(track()!, 'on'))).toBe('已排队');
      press(track(), '.deliv');
      await settle(() => countRoute(log, 'messages/apply') + countRoute(log, 'messages/send') > 0, 300);
      /* 具名改坏: 点状态轨时 `advance()` 发写；本行的零请求红。 */
      expect(countRoute(log, 'messages/apply') + countRoute(log, 'messages/send')).toBe(0);
      expect(textOf(findClass(track()!, 'on'))).toBe('已排队');
    } finally {
      await page.restore();
    }
  }, 120_000);
});
