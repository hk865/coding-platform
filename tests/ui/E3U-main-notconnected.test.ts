import { afterEach, describe, expect, it } from 'vitest';
import { findAllClass, findButton, findElement } from './helpers/boot-page.js';
import {
  bootE3N, countRoute, descendants, hasClass, quietPage, textOf, thread, userTexts, waitFor,
} from './helpers/E3N-page.js';
import { notConnected } from './helpers/E3N-interact.js';
import { answerRequest, openW1, openWA } from './helpers/E3N-world.js';
import type { S6ARequestWorld } from '../helpers/S6A-request-fixture.js';

/**
 * E3U T-A12–T-A14 (test sheet e3main-a-tests §1.1, §1.2): the page's two read
 * failures (ruling item 6: the text comes from the reply code) and the run
 * block drawn unconnected (A13, ruling A-2, third round Main 3). The four
 * unconnected assertions live in `E3N-interact.ts` only.
 */

const worlds: S6ARequestWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

const SAMPLE = '检查链第 2 轮怎么卡住了';

describe('E3U Main read failures and the unconnected run block', () => {
  it('T-A12 an unknown Goal stops at the navigation read: the error text, 重试 and no main/read', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Main', { search: '?goal=e3u-no-such-goal' });
    try {
      /* 具名改坏: `readMain` 吞掉 `readNav` 的 `not_found`、返回空数据；错误态断言红。 */
      await waitFor(() => page.root.textContent.includes('找不到这个目标。'));
      expect(findButton(page.root, '重试')).toBeDefined();
      await quietPage(log);
      expect(countRoute(log, 'main/read')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('T-A13 main/read unavailable shows the code’s text and no sample thread', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal', unavailable: 'main/read' });
    try {
      /* 具名改坏: `pageProps` 的错误分支改成空数据；错误文字红。 */
      await waitFor(() => page.root.textContent.includes('暂时读不到，可以重试。'));
      expect(countRoute(log, 'main/read')).toBeGreaterThanOrEqual(1);
      expect(page.root.textContent).not.toContain(SAMPLE);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('T-A14 a round with a session draws the prototype run button, unconnected, between the bubble and the answer', async () => {
    const opened = await openWA();
    worlds.push(opened.world);
    await answerRequest(opened, { commandId: 'e3u-a14', text: '跑一下', answer: '跑完了' });
    const { page, log } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal' });
    try {
      await waitFor(() => userTexts(page.root).includes('跑一下'));
      const holder = thread(page.root)!;
      const run = findElement(holder, (element) => element.tagName.toLowerCase() === 'button' && hasClass(element, 'run'));
      expect(run).toBeDefined();
      expect(textOf(run)).toBe('运行步骤还没接通');
      const order = descendants(holder);
      const user = findAllClass(holder, 'msg-user').find((row) => textOf(row).includes('跑一下'))!;
      const agent = findAllClass(holder, 'msg-agent').find((row) => textOf(row).includes('跑完了'))!;
      expect(order.indexOf(user)).toBeLessThan(order.indexOf(run!));
      expect(order.indexOf(run!)).toBeLessThan(order.indexOf(agent));
      expect(findAllClass(holder, 'sys-line').some((line) => descendants(line).includes(run!))).toBe(false);
      await quietPage(log);
      const calls = log.calls.length;
      const before = page.root.textContent;
      /* 具名改坏: `Main.dc.html` 删掉运行块的 `is-off`；`is-off` 断言红。 */
      expect(notConnected(run!)).toBe('未接通');
      await quietPage(log);
      expect(log.calls.length).toBe(calls);
      expect(page.root.textContent).toBe(before);
      expect(findAllClass(holder, 'steps')).toEqual([]);
    } finally {
      await page.restore();
    }
  }, 60_000);
});
