import { afterEach, describe, expect, it } from 'vitest';
import {
  answerDoneAsk, bootDone, composerBox, openDoneDeliveryWorld,
} from './helpers/E3DN-done-world.js';
import { findClass, findLink } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import { byLabel } from './helpers/E3C-world.js';
import { card, sendButton, typeInto } from './helpers/E3D-page.js';
import { buttonText, press, settle, UUID_V4, worldSlot } from './helpers/E3M-world.js';
import { notConnected } from './helpers/E3N-interact.js';
import { countRoute, descendants, hasClass, textOf } from './helpers/E3N-page.js';

/**
 * E3DN-5 D13–D14b (test sheet §2.5): the delivery card shows only on a
 * completed Goal; its 接受 / 部分接受 / 要求补做 wait for the acceptance
 * package (unconnected); 问秘书 asks through `requests/submit` and reads the
 * request once. The world's request driver is off, so the test answers the
 * page's round through the public Query routes before the page's one
 * `requests/read` goes out (`answerDoneAsk`).
 */

const slot = worldSlot();
afterEach(async () => { await slot.close(); }, 180_000);

const completedWorld = () => slot.use('completed', () => openDoneDeliveryWorld(), (done) => done.close());
const openWorld = () => slot.use('open', () => openDoneDeliveryWorld({ completed: false }), (done) => done.close());
const goalBar = (root: FakeElement) => byLabel(root, '目标状态');
const bubbles = (root: FakeElement, name: string) => descendants(root)
  .filter((element) => hasClass(element, name)).map((element) => textOf(element));

describe('E3DN-5 the delivery card and 问秘书', () => {
  it.each([{ action: '接受' }, { action: '部分接受' }, { action: '要求补做' }])(
    'D13 $action is unconnected and opens nothing', async ({ action }) => {
      const done = await completedWorld();
      const { page, log } = await bootDone(done.world, done.goal.goalId);
      try {
        await settle(() => card(page.root) !== undefined, 10_000);
        const open = card(page.root)!;
        /* 具名改坏: COMPLETED 的 why 写死“等你验收”；本行红。 */
        expect(textOf(findClass(goalBar(page.root)!, 'gb-why'))).toBe('');
        expect(textOf(findClass(open, 'dc-title'))).toContain('交付');
        expect(textOf(findClass(open, 'dc-title'))).toContain('目标 1');
        const before = log.calls.length;
        /* 具名改坏: 去掉“接受”的 `aria-disabled`；本条目的 aria 断言红。 */
        notConnected(buttonText(open, action)!);
        expect(log.calls.length).toBe(before);
        /* 具名改坏: 去掉“部分接受”的守卫（打开勾选面板）；本条目 notConnected 的 preventDefault 断言红。 */
        expect(findClass(page.root, 'dv-pick')).toBeUndefined();
      } finally {
        await page.restore();
      }
    }, 180_000);

  it('D13b an active Goal shows the composer, not the delivery card', async () => {
    const done = await openWorld();
    const { page } = await bootDone(done.world, done.goal.goalId);
    try {
      await settle(() => buttonText(byLabel(page.root, '目标状态'), '暂停') !== undefined, 10_000);
      /* 具名改坏: 未完成也画卡；本行红。 */
      expect(card(page.root)).toBeUndefined();
      /* 具名改坏: `canView: !!D`；未完成的目标也画“查看交付”，本行红。 */
      expect(findLink(page.root, '查看交付')).toBeUndefined();
      expect(composerBox(page.root)).toBeDefined();
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('D14 问秘书 submits the typed text on the Goal and reads the request once', async () => {
    const done = await completedWorld();
    const answer = 'E3DN D14 秘书的回答';
    const { page, log } = await bootDone(done.world, done.goal.goalId, {
      before: { 'requests/read': (pageLog) => answerDoneAsk(done.world, pageLog, 'e3dn-d14', answer) },
    });
    try {
      await settle(() => card(page.root) !== undefined, 10_000);
      press(buttonText(card(page.root), '问秘书'), '问秘书');
      await settle(() => composerBox(page.root) !== undefined, 5_000);
      /* §2.10/N43: the prefill is the adapter's `askRef`, not a parse of `path`. */
      expect(textOf(findClass(page.root, 'composer-ref'))).toContain('目标 1 的交付');
      typeInto(page.root, 'composer-input', '看看这一项');
      press(sendButton(page.root), '发送');
      await settle(() => bubbles(page.root, 'msg-agent').some((text) => text.includes(answer)), 20_000);
      /* 具名改坏: 用 `messages/user-send`；本行的 `requests/submit` 红。 */
      expect(countRoute(log, 'requests/submit')).toBe(1);
      const input = log.calls.find((call) => call.route === 'requests/submit')!.input as Record<string, unknown>;
      expect(input['text']).toBe('看看这一项');
      expect(input['references']).toEqual([]);
      expect(input['goalId']).toBe(done.goal.goalId);
      expect(String(input['commandId'])).toMatch(UUID_V4);
      expect(countRoute(log, 'requests/read')).toBe(1);
      expect(bubbles(page.root, 'msg-user').some((text) => text.includes('看看这一项'))).toBe(true);
      expect(bubbles(page.root, 'msg-agent').some((text) => text.includes(answer))).toBe(true);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('D14b an empty draft with no reference keeps 发送 off and sends nothing', async () => {
    const done = await openWorld();
    const { page, log } = await bootDone(done.world, done.goal.goalId);
    try {
      await settle(() => goalBar(page.root) !== undefined && composerBox(page.root) !== undefined, 10_000);
      typeInto(page.root, 'composer-input', '');
      const send = sendButton(page.root);
      expect(hasClass(send!, 'is-off')).toBe(true);
      const before = log.calls.length;
      /* 具名改坏: 空白也发；本行的“不发请求”红。 */
      press(send, '发送');
      expect(log.calls.length).toBe(before);
    } finally {
      await page.restore();
    }
  }, 180_000);
});
