import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { findClass } from './helpers/boot-page.js';
import { bootE3N, callsTo, quietPage, settledN, waitFor } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { openOldAnswerWorld } from './helpers/E3D-world.js';
import { card, cardButton, cardTitle, labelled, openFromGoalBar, typeInto } from './helpers/E3D-page.js';
import { composerNote, quoteModuleLine } from './helpers/GAPB-quote.js';
import { cleanupScenarios } from '../scenarios/harness.js';
import type { S6ARequestWorld } from '../helpers/S6A-request-fixture.js';

/**
 * GAPB-9 (goal card B, B9, the quote rule of L3): asking about a card does not
 * take a quote (`requests/ask` receives no `references`), so the quote stays in
 * the draft and the composer's `.to` says it was not sent. Red on
 * `7dcug3t-base` because `sendMain` clears `quotes` after the ask.
 *
 * The card is D44a's candidate, which names its request, so the ask is the
 * `requests/ask` path (a card without a request submits the text instead;
 * `E3U-main-card` T-A10 pins that path).
 */

const worlds: S6ARequestWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});
afterAll(async () => {
  await cleanupScenarios();
});

describe('GAPB-9 asking about a card keeps the quote', () => {
  it('B9-4 a quote stays in the draft and the footnote says it did not go with the ask', async () => {
    const opened = await openOldAnswerWorld();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal' });
    try {
      await quoteModuleLine(page, log);
      await waitFor(() => composerNote(page) === '已引用到草稿，还没有发送');
      await openFromGoalBar(page);
      /* The candidate card is named by its request's Task; 下一条 reaches it (T-A09's step). */
      if (!cardTitle(page.root).includes('计划候选')) click(labelled(card(page.root), '下一条')!);
      await waitFor(() => cardTitle(page.root).includes('计划候选'));
      click(cardButton(page.root, '问秘书')!);
      await waitFor(() => card(page.root) === undefined && labelled(page.root, '发送') !== undefined);
      typeInto(page.root, 'composer-input', '这张卡怎么处理');
      click(labelled(page.root, '发送')!);
      await settledN(log, 'requests/ask', 1);
      /* The send's state update lands after the reply: wait for its sentence, then read the bar. */
      await waitFor(() => composerNote(page) === '引用没有随这次发出（这一种发送不带引用），还在草稿里。');
      /* 具名改坏: `sendMain` 的 `askCardKey` 分支成功后照旧清 `quotes`（`draft: '', quotes: []`）；
         脚注那句先红，“引用还在”这一句也红。`references` 那句是 Host 的入参形状，照旧过。 */
      expect(findClass(page.root, 'composer-quote')).toBeDefined();
      expect('references' in (callsTo(log, 'requests/ask')[0]!.input as Record<string, unknown>)).toBe(false);
      await quietPage(log);
    } finally {
      await page.restore();
    }
  }, 120_000);
});
