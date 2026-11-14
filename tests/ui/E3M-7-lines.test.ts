import { afterAll, describe, expect, it } from 'vitest';
import { asRecord, asText } from '../../src/ui/values.js';
import { findClass, findElement } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import { countRoute, descendants, hasClass, lineHeadTitle, mainHeadTitle, textOf, userTexts, type PageLog } from './helpers/E3N-page.js';
import {
  bootMemberAt, callsOf, elementsOf, memberSearch, openMemberS7C, press, radio, railRowOf, receiptBody, settle, worldSlot,
} from './helpers/E3M-world.js';
import { transferS7ASession } from '../helpers/S7A-fixture.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';

/**
 * E3M-7 (clk-current rows P02-10, P02-11, P07-1, P08-1, P08-6): the line-view
 * composer and the other Session lines — switching to 直接干预 without a write,
 * one inline send to the opened line, two lines read by their own keys, and the
 * archived line's original history. W1 is the S7C world; every state comes from
 * a public route before the page boots (a write during the booted page would
 * enter its own read log).
 */

const slot = worldSlot();
afterAll(async () => { await slot.close(); }, 180_000);
const w1 = () => slot.use('W1', () => openMemberS7C(), (opened) => opened.s7c.close());
/* The work line's earlier message, kept as the archived line's original history. */
const ARCHIVED_TEXT = 'E3M archived history';
/* W1 with one public message on the work line, then that line archived by the public route. */
const w1Archived = () => slot.use('W1-archived', async () => {
  const opened = await openMemberS7C();
  try {
    const sent = asRecord((await opened.s7c.world.post('messages/send', graphWrite(S6A_SCOPE, {
      recipient: opened.work, text: ARCHIVED_TEXT, intent: 'action_request', needsReply: true,
    }, 'e3m-archived-history'))).body);
    if (sent['status'] !== 'committed') throw new Error(`E3M-7: the work line's message did not commit: ${JSON.stringify(sent)}`);
    await opened.s7c.world.archive(opened.s7c.lines.work);
    return opened;
  } catch (error) {
    await opened.s7c.close().catch(() => undefined);
    throw error;
  }
}, (opened) => opened.s7c.close());

/* W1 with `s7c-m1` handed from the module line to the work line (public transfer). */
const w1Handoff = () => slot.use('W1-handoff', async () => {
  const opened = await openMemberS7C();
  try {
    await transferS7ASession(opened.s7c.world, opened.module, opened.work,
      { kind: 'task', ref: opened.s7c.tasks[0]! });
    return opened;
  } catch (error) {
    await opened.s7c.close().catch(() => undefined);
    throw error;
  }
}, (opened) => opened.s7c.close());

const writes = (log: PageLog): number =>
  ['messages/send', 'queries/ask', 'controls/submit'].reduce((sum, route) => sum + countRoute(log, route), 0);

/**
 * The line-view composer (`Member.dc.html:890-945`): the `lv-input` textarea in
 * its `.dock`, its 直接干预 radio and its `.send`; `type` types into the textarea
 * the way the runtime's `onChange` listens (`input`). The header composer
 * (`member-input`) is not in the document while a line view is open
 * (`lv.hide`, `Member.dc.html:200`), so this dock is the only one.
 */
function lineComposer(root: FakeElement): {
  dock: FakeElement | undefined; box: FakeElement | undefined; act: FakeElement | undefined; send: FakeElement | undefined;
  type(text: string): void;
} {
  const dock = findClass(root, 'dock');
  const box = findElement(root, (element) => element.getAttribute('id') === 'lv-input');
  const composer = dock === undefined ? undefined : findClass(dock, 'composer');
  const mode = composer === undefined ? undefined : findClass(composer, 'mode');
  const act = mode === undefined ? undefined : descendants(mode)
    .find((element) => element.getAttribute('role') === 'radio' && textOf(element).includes('直接干预'));
  const foot = composer === undefined ? undefined : findClass(composer, 'composer-foot');
  const send = foot === undefined ? undefined : findClass(foot, 'send');
  return { dock, box, act, send, type(text: string): void {
    if (box === undefined) throw new Error('E3M-7: the line view has no lv-input');
    box.value = text;
    box.dispatch('input', { target: box, currentTarget: box });
  } };
}

describe('E3M-7 the line view and the other Session lines', () => {
  it('P02-10 the line-view 直接干预 switches with its own placeholder and foot, and writes nothing', async () => {
    const w = await w1();
    const booted = await bootMemberAt(w.s7c.world, memberSearch('s7c-goal', w.module));
    const { page } = booted;
    try {
      press(await railRowOf(page.root, w.s7c.world, w.work), 'the work line row');
      await settle(() => lineHeadTitle(page.root) === '执行者');
      const composer = lineComposer(page.root);
      press(composer.act, 'the line-view 直接干预');
      await settle(() => composer.act?.getAttribute('aria-checked') === 'true');
      /* 具名改坏（测试内）: 点 问一问 而不是 直接干预；本行的 `aria-checked` 红。 */
      expect(composer.act?.getAttribute('aria-checked')).toBe('true');
      expect(composer.box?.getAttribute('placeholder')).toBe('要它改什么…');
      expect(textOf(composer.dock === undefined ? undefined : findClass(composer.dock, 'to'))).toBe('下一个安全点交给它');
      expect(writes(booted.log)).toBe(0);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('P02-11 the line-view send writes one action_request to the opened line and shows its bubble', async () => {
    const w = await w1();
    const booted = await bootMemberAt(w.s7c.world, memberSearch('s7c-goal', w.module));
    const { page, log } = booted;
    try {
      press(await railRowOf(page.root, w.s7c.world, w.work), 'the work line row');
      await settle(() => lineHeadTitle(page.root) === '执行者');
      const composer = lineComposer(page.root);
      press(composer.act, 'the line-view 直接干预');
      await settle(() => composer.act?.getAttribute('aria-checked') === 'true');
      composer.type('E3M inline intervention');
      press(composer.send, 'the line-view send');
      await settle(() => booted.receipts.some((receipt) => receipt.route === 'messages/send')
        && userTexts(page.root).includes('E3M inline intervention'), 5_000);
      /* 具名改坏（测试内）: 期望的 `intent` 写成 `notify`；本行的 `input` 红。 */
      const calls = callsOf(log, 'messages/send');
      expect(calls).toHaveLength(1);
      expect(calls[0]!.input).toEqual({
        recipient: { projectId: 'ag2b-collab-project', sessionId: w.work.sessionId },
        text: 'E3M inline intervention', intent: 'action_request', needsReply: true,
      });
      expect(calls[0]!.input).not.toHaveProperty('waitAfterSend');
      expect(calls[0]!.input).not.toHaveProperty('deadlineMs');
      const receipt = receiptBody(booted, 'messages/send');
      expect(receipt?.['status']).toBe('committed');
      expect(receipt?.['sendStatus']).toBe('sent');
      const messageId = asText(asRecord(asRecord(receipt?.['value'])?.['ref'])?.['messageId']);
      expect(messageId).not.toBe('');
      expect(callsOf(log, 'messages/view').filter((call) => asRecord(call.input)['messageId'] === messageId).length)
        .toBeGreaterThanOrEqual(1);
      expect(lineHeadTitle(page.root)).toBe('执行者');
      expect(userTexts(page.root)).toContain('E3M inline intervention');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('P07-1 two Session lines open by their own keys under the same 执行者 header', async () => {
    const w = await w1();
    const { page, log } = await bootMemberAt(w.s7c.world, memberSearch('s7c-goal', w.module));
    try {
      press(await railRowOf(page.root, w.s7c.world, w.work), 'the work line row');
      await settle(() => callsOf(log, 'lines/read').length >= 2 && lineHeadTitle(page.root) === '执行者');
      const workRead = callsOf(log, 'lines/read').at(-1);
      /* 具名改坏（测试内）: work 的期望 key 写成 module 的 key；本行的 key 红。 */
      expect(workRead?.input).toEqual(expect.objectContaining({
        key: { projectId: 'ag2b-collab-project', sessionId: w.work.sessionId },
      }));
      expect(lineHeadTitle(page.root)).toBe('执行者');
      press(await railRowOf(page.root, w.s7c.world, w.module), 'the module line row');
      await settle(() => callsOf(log, 'lines/read').length >= 3 && mainHeadTitle(page.root) === '执行者');
      const moduleRead = callsOf(log, 'lines/read').at(-1);
      /* 具名改坏（测试内）: module 的期望 key 写成 work 的 key；本行的 key 红。 */
      expect(moduleRead?.input).toEqual(expect.objectContaining({
        key: { projectId: 'ag2b-collab-project', sessionId: w.module.sessionId },
      }));
      expect(mainHeadTitle(page.root)).toBe('执行者');
      const first = asRecord(workRead?.input)['key'];
      const second = asRecord(moduleRead?.input)['key'];
      expect(asText(asRecord(first)['sessionId'])).not.toBe(asText(asRecord(second)['sessionId']));
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('P08-6 after the handoff the successor line shows the task and its inline send writes to it', async () => {
    const w = await w1Handoff();
    const booted = await bootMemberAt(w.s7c.world, memberSearch('s7c-goal', w.module));
    const { page, log } = booted;
    try {
      press(await railRowOf(page.root, w.s7c.world, w.work), 'the work line row');
      await settle(() => lineHeadTitle(page.root) === '执行者');
      /* The transfer is the state before the write: the work line's own facts name
         the Task it is now responsible for, and its attempt row is drawn. */
      const facts = textOf(findClass(page.root, 'lv-facts'));
      expect(facts).toContain('Independent work s7c-m1');
      expect(facts).toContain('尝试');
      const composer = lineComposer(page.root);
      press(composer.act, 'the line-view 直接干预');
      await settle(() => composer.act?.getAttribute('aria-checked') === 'true');
      composer.type('E3M successor intervention');
      press(composer.send, 'the line-view send');
      await settle(() => booted.receipts.some((receipt) => receipt.route === 'messages/send')
        && userTexts(page.root).includes('E3M successor intervention'), 5_000);
      /* 具名改坏（测试内）: 期望的 recipient 写成页头 module 线；本行的 input 红。 */
      const calls = callsOf(log, 'messages/send');
      expect(calls).toHaveLength(1);
      expect(calls[0]!.input).toEqual({
        recipient: { projectId: 'ag2b-collab-project', sessionId: w.work.sessionId },
        text: 'E3M successor intervention', intent: 'action_request', needsReply: true,
      });
      expect(receiptBody(booted, 'messages/send')?.['status']).toBe('committed');
      expect(userTexts(page.root)).toContain('E3M successor intervention');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('P08-1 the archived work line opens read-only with its original history', async () => {
    const w = await w1Archived();
    const { page, log } = await bootMemberAt(w.s7c.world, memberSearch('s7c-goal', w.module));
    try {
      const rail = (): FakeElement | undefined => findClass(page.root, 'rail');
      const archivedRow = (): FakeElement | undefined => elementsOf(rail(), 'button').find((element) => hasClass(element, 'is-arch'));
      const toggle = elementsOf(rail(), 'button').find((element) => element.getAttribute('aria-expanded') !== null);
      press(toggle, 'the 已归档 row');
      await settle(() => countRoute(log, 'lines/archived') > 0 && archivedRow() !== undefined);
      const before = log.calls.length;
      press(archivedRow(), 'the archived work row');
      await settle(() => callsOf(log, 'lines/read', before).length > 0 && lineHeadTitle(page.root) === '执行者');
      const reads = callsOf(log, 'lines/read', before)
        .filter((call) => asText(asRecord(asRecord(call.input)['key'])['sessionId']) === w.work.sessionId);
      expect(reads).toHaveLength(1);
      expect(lineHeadTitle(page.root)).toBe('执行者');
      expect(radio(page.root, '直接干预')?.getAttribute('aria-disabled')).toBe('true');
      /* 具名改坏（测试内）: 期望的历史文本换个字（`…（旧）`）；本行的 `userTexts` 红。 */
      expect(userTexts(page.root)).toContain(ARCHIVED_TEXT);
    } finally {
      await page.restore();
    }
  }, 180_000);
});
