import { afterEach, describe, expect, it } from 'vitest';
import { click } from './helpers/E3N-interact.js';
import { bootE3N, callsOf, count, descendants, openedPage, quietPage, textOf } from './helpers/E3N-page.js';
import {
  card, cardButton, sectionRows, settle, writeOf,
} from './helpers/E3D-page.js';
import { openE3GW1, type E3GWorld } from './helpers/E3G-world.js';
import { failApplicationOnce } from './helpers/GAPB5-application-fault.js';

/**
 * GAPB-5 (frozen card B §B5): the answer committed, its application did not
 * record. The card says 已答复，落实没记上 and offers 重试落实 only on the same
 * page; the retry sends the SAME `decisions/answer` request (requestId, input,
 * expected) and the card then reads 已落实. A fresh page still shows the
 * pending row but has no retry basis and so no button; the page never calls
 * `decisions/application`.
 *
 * Today both rows are red: nothing records the first request, nothing draws the
 * row or the button.
 *
 * Named mutations (one per row):
 * - B5-1: retry with a fresh `requestId` (or a rebuilt input) → the idempotency
 *   replay is lost, the second answer does not reach `applied`, and the
 *   requestId/input equality assertion is red.
 * - B5-2: keep the retry basis in a module-level variable instead of the page's
 *   own memory → the rebooting page still offers 重试落实 and the count is 1.
 */
const worlds: E3GWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.world.close().catch(() => undefined); });

async function openFailingWorld(): Promise<E3GWorld> {
  const restore = failApplicationOnce();
  try {
    const world = await openE3GW1();
    worlds.push(world);
    return world;
  } finally {
    restore();
  }
}

function tabNamed(root: Parameters<typeof sectionRows>[0], name: string) {
  return descendants(root).find((element) => element.tagName.toLowerCase() === 'button' && textOf(element).startsWith(name));
}

function conflictRow(root: Parameters<typeof sectionRows>[0], section: string) {
  return sectionRows(root, section).find((row) => textOf(row).includes('冲突'));
}

/** Open the conflict card, pick 等前一个目标 and confirm; waits for the answer. */
async function answerWait(page: Parameters<typeof sectionRows>[0], log: Parameters<typeof count>[0]): Promise<void> {
  const row = conflictRow(page, '要决定');
  expect(row, 'the conflict row').toBeDefined();
  click(row!);
  await settle(() => card(page) !== undefined, 3_000);
  click(cardButton(page, '等前一个目标')!);
  await settle(() => cardButton(page, '等前一个目标')?.getAttribute('aria-checked') === 'true', 2_000);
  click(cardButton(page, '确定')!);
  await settle(() => callsOf(log, 'decisions/answer').some((call) => call.reply !== undefined), 8_000);
  await quietPage(log);
}

/** Open the answered card from 已答复、待落实 (the page reread closed the answering card). */
async function openPendingCard(page: Parameters<typeof sectionRows>[0], log: Parameters<typeof count>[0]): Promise<void> {
  /* the answering page already moved to the answered card (已处理, 待落实); leaving it drops the retry basis */
  if (card(page) === undefined || !textOf(card(page)!).includes('已答复')) {
    const queued = count(log, 'decisions/queue');
    click(tabNamed(page, '已处理')!);
    await settle(() => count(log, 'decisions/queue') > queued, 8_000);
    await quietPage(log);
    const row = conflictRow(page, '已答复、待落实');
    expect(row, 'the answered card waits in 已答复、待落实').toBeDefined();
    click(row!);
    await settle(() => card(page) !== undefined, 3_000);
  }
  const details = cardButton(page, '详情');
  if (details !== undefined && details.getAttribute('aria-expanded') !== 'true') click(details);
}

describe('GAPB-5 reapply the answer application', () => {
  it('B5-1 重试落实 resends the same decisions/answer and the card becomes 已落实', async () => {
    const world = await openFailingWorld();
    const { page, log } = await bootE3N(world.world, 'Decide', { search: '?goal=' + world.world.goals.second.goalId });
    try {
      await openedPage(log);
      await answerWait(page.root, log);
      const first = writeOf(callsOf(log, 'decisions/answer')[0]!);
      expect((callsOf(log, 'decisions/answer')[0]!.reply as { value?: { state?: string } }).value?.state)
        .toBe('application_not_recorded');
      await openPendingCard(page.root, log);
      expect(textOf(card(page.root)!)).toContain('已答复，落实没记上');
      const retry = cardButton(page.root, '重试落实');
      expect(retry, 'the same-page retry').toBeDefined();
      click(retry!);
      await settle(() => callsOf(log, 'decisions/answer').length === 2
        && callsOf(log, 'decisions/answer')[1]!.reply !== undefined, 10_000);
      await quietPage(log);
      expect(count(log, 'decisions/answer')).toBe(2);
      const second = writeOf(callsOf(log, 'decisions/answer')[1]!);
      expect(second.meta.requestId).toBe(first.meta.requestId);
      expect(second.input).toEqual(first.input);
      expect(second.meta.expected).toEqual(first.meta.expected);
      expect((callsOf(log, 'decisions/answer')[1]!.reply as { value?: { state?: string } }).value?.state).toBe('applied');
      expect(count(log, 'decisions/application')).toBe(0);
      const doneRow = sectionRows(page.root, '已处理').find((row) => textOf(row).includes('已落实'));
      expect(doneRow, 'the applied card in 已处理').toBeDefined();
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('B5-2 a fresh page keeps the pending row but has no retry basis', async () => {
    const world = await openFailingWorld();
    const first = await bootE3N(world.world, 'Decide', { search: '?goal=' + world.world.goals.second.goalId });
    try {
      await openedPage(first.log);
      await answerWait(first.page.root, first.log);
      await openPendingCard(first.page.root, first.log);
      expect(cardButton(first.page.root, '重试落实'), 'the answering page has the retry').toBeDefined();
    } finally {
      await first.page.restore();
    }
    const second = await bootE3N(world.world, 'Decide', { search: '?goal=' + world.world.goals.second.goalId });
    try {
      await openedPage(second.log);
      const queued = count(second.log, 'decisions/queue');
      click(tabNamed(second.page.root, '已处理')!);
      await settle(() => count(second.log, 'decisions/queue') > queued, 8_000);
      await quietPage(second.log);
      const row = conflictRow(second.page.root, '已答复、待落实');
      expect(row, 'the pending row survives the refresh').toBeDefined();
      click(row!);
      await settle(() => card(second.page.root) !== undefined, 3_000);
      expect(textOf(card(second.page.root)!)).toContain('已答复，落实没记上');
      expect(cardButton(second.page.root, '重试落实')).toBeUndefined();
      expect(count(second.log, 'decisions/answer')).toBe(0);
    } finally {
      await second.page.restore();
    }
  }, 180_000);
});
