import { afterEach, describe, expect, it } from 'vitest';
import { bootE3N, callsTo, quietPage, userTexts, waitFor } from './helpers/E3N-page.js';
import { answerRequest, openW1, openWA } from './helpers/E3N-world.js';
import { composerNote, quoteModuleLine } from './helpers/GAPB-quote.js';
import type { S6ARequestWorld } from '../helpers/S6A-request-fixture.js';

/**
 * GAPB-8 (goal card B, B8): the composer's `.to` names the secretary this
 * message reaches. The page reads `requests/recipient` for the selected Goal;
 * a quote keeps its existing sentence above it, and a failed read leaves the
 * sentence off without failing the page.
 *
 * All four rows are red on `7dcug3t-base`: the page never calls
 * `requests/recipient`, so the sentence is absent and the read count is 0.
 */

const worlds: S6ARequestWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

const GOAL = '?goal=ag2b-goal';

describe('GAPB-8 the composer names the secretary', () => {
  it('B8-1 选中目标时读 requests/recipient，脚注写将交给左栏那位秘书', async () => {
    const opened = await openWA();
    worlds.push(opened.world);
    await answerRequest(opened, { commandId: 'gapb8-1', text: '这件事交给谁', answer: '交给秘书 1' });
    const { page, log } = await bootE3N(opened.world, 'Main', { search: GOAL });
    try {
      await waitFor(() => composerNote(page) === '将交给 秘书 1');
      /* 具名改坏: `readMain` 不调用 `readRecipient`（不发 `requests/recipient`、`recipientNoteOf` 回空串）；
         下面读数 0、脚注那一句也红。 */
      const reads = callsTo(log, 'requests/recipient');
      expect(reads.length).toBeGreaterThanOrEqual(1);
      expect((reads[0]!.input as { goalRef?: unknown }).goalRef).toEqual({
        aggregateType: 'Goal', projectId: 'ag2b-collab-project', goalId: 'ag2b-goal',
      });
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('B8-2 没有空闲秘书时脚注写等空闲的秘书接手', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    /* The only secretary holds a Query; the Goal has no earlier request naming one. */
    await opened.world.occupy(opened.secretary);
    const { page } = await bootE3N(opened.world, 'Main', { search: GOAL });
    try {
      /* 具名改坏: `recipientNoteOf(null, nav)` 回空串而不写“等空闲的秘书接手”；这一句红。 */
      await waitFor(() => composerNote(page) === '等空闲的秘书接手');
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('B8-3 requests/recipient 读失败时不写这一句，页面别处照常', async () => {
    const opened = await openWA();
    worlds.push(opened.world);
    await answerRequest(opened, { commandId: 'gapb8-3', text: '读失败也要看得见', answer: '好' });
    const { page, log } = await bootE3N(opened.world, 'Main', { search: GOAL, unavailable: 'requests/recipient' });
    try {
      await waitFor(() => callsTo(log, 'requests/recipient').length >= 1);
      await quietPage(log);
      /* 具名改坏: `readRecipient` 吞掉 `unavailable` 后仍写一句，或把失败抛给整次读；
         前一句红（脚注非空），后一种让气泡消失、后两句红。 */
      expect(composerNote(page)).toBe('');
      expect(userTexts(page.root)).toEqual(['读失败也要看得见']);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('B8-4 有引用时脚注是引用提示，不写将交给谁', async () => {
    const opened = await openWA();
    worlds.push(opened.world);
    await answerRequest(opened, { commandId: 'gapb8-4', text: '引用一行', answer: '收到' });
    const { page, log } = await bootE3N(opened.world, 'Main', { search: GOAL });
    try {
      await quoteModuleLine(page, log);
      await waitFor(() => composerNote(page) === '已引用到草稿，还没有发送');
      /* 具名改坏: `composerNote` 把“将交给”排在引用提示之前；脚注那一句红。
         读数这一句钉住本卡没关掉这次读（改砸时先看得到 0 次）。 */
      expect(callsTo(log, 'requests/recipient').length).toBeGreaterThanOrEqual(1);
    } finally {
      await page.restore();
    }
  }, 120_000);
});
