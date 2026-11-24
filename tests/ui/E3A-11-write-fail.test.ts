/**
 * E3A-11 (7D2 batch 10 ⑦): the write-failure surface on the page-contract
 * world. World: `openW1` plus `seedArchWorld` (the real Host and its
 * architecture); `bootArchAnswers` replaces only the four route answers below,
 * so the page's own failure lines are what the row checks. Every expected text
 * and count is hand-computed from those answers: `dirty` 3 is the bar's 处,
 * `files` 2 is the confirmation box's 个文件 and the prefilled message.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { findButton, findClass, findElement } from './helpers/boot-page.js';
import { bootArchAnswers } from './helpers/E3A-fixed.js';
import { pageText } from './helpers/E3A-page.js';
import { callsTo, countRoute, descendants, hasClass, textOf, waitFor } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { openW1 } from './helpers/E3N-world.js';
import { seedArchWorld } from './helpers/E3A-world.js';
import { asRecord } from '../../src/ui/values.js';
import type { FakeElement } from './helpers/dom.js';
import type { S6ARequestWorld } from '../helpers/S6A-request-fixture.js';

const worlds: S6ARequestWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

/** One `p.ov-wk` caption row whose text names `needle`. */
function captionRow(root: FakeElement, needle: string) {
  return descendants(root).find((element) => element.tagName.toLowerCase() === 'p'
    && hasClass(element, 'ov-wk') && textOf(element).includes(needle));
}

describe('E3A-11 the write failure surface', () => {
  it('E3A-11 keeps each failed exploration and commit write on the row that sent it', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    await seedArchWorld(opened.world);
    const P = opened.world.scope.projectId;
    const answers = {
      'role-lines/operations': { status: 'ready', value: [{
        operation: { aggregateType: 'CoreOperation', projectId: P, operationId: 'cold_start:' + P },
        action: 'role_line', phase: 'running', actionPhase: 'regions',
        result: null, plannedRounds: 3, followUp: null,
      }] },
      'workspaces/exploration/stop': {
        status: 'rejected', code: 'invalid', reason: 'this workspace has no unfinished exploration',
      },
      'knowledge/status': { status: 'ready', value: { branch: 'main', dirty: 3, files: 2, localOnly: false } },
      'knowledge/commit': { status: 'rejected', code: 'unavailable', reason: 'pre-commit hook: no' },
    } as const;
    const { page, log } = await bootArchAnswers(opened.world, answers);
    try {
      /* FIRST STEP: the page-contract world must read as an ArchOverview page. */
      await waitFor(() => countRoute(log, 'lines/list') >= 1, 30_000);
      expect(findClass(page.root, 'ov-cap-l')).toBeDefined();
      expect(pageText(page)).not.toContain('找不到这个目标。');
      expect(pageText(page)).not.toContain('暂时读不到');

      await waitFor(() => pageText(page).includes('还没初始化完：正在初始化。'), 30_000);
      const explore = captionRow(page.root, '还没初始化完：正在初始化。')!;
      expect(explore).toBeDefined();
      const stop = findElement(explore, (element) => element.tagName.toLowerCase() === 'button'
        && textOf(element) === '停止探索');
      expect(stop).toBeDefined();
      click(stop!);
      await waitFor(() => countRoute(log, 'workspaces/exploration/stop') === 1, 10_000);
      const stopCall = callsTo(log, 'workspaces/exploration/stop')[0]!;
      await waitFor(() => stopCall.reply !== undefined, 30_000);
      expect(asRecord(stopCall.reply)['status']).toBe('rejected');
      /* The stop answer's reason is the owner's own words, and the failure stays on
         this row (the span comes after the button) until the next click. */
      await waitFor(() => textOf(captionRow(page.root, '还没初始化完：正在初始化。')).includes('这个工作区没有在进行的探索。'), 15_000);
      const failedRow = captionRow(page.root, '还没初始化完：正在初始化。')!;
      const failed = findElement(failedRow, (element) => element.tagName.toLowerCase() === 'span'
        && hasClass(element, 'tx-failed'));
      expect(failed).toBeDefined();
      expect(textOf(failed)).toBe('这个工作区没有在进行的探索。');
      const orderButton = findElement(failedRow, (element) => element.tagName.toLowerCase() === 'button'
        && textOf(element) === '停止探索')!;
      expect(failedRow.childNodes.indexOf(orderButton)).toBeLessThan(
        failedRow.childNodes.indexOf(failed!));
      expect(pageText(page)).toContain('停止探索');

      /* The bar counts `dirty` (3 处) while the box and the prefilled message count
         `files` (2 个文件): the two numbers are never interchanged. */
      await waitFor(() => pageText(page).includes('架构图和注记有 3 处改动还没提交'), 15_000);
      click(findButton(page.root, '提交架构图和注记')!);
      const side = findClass(page.root, 'ov-side')!;
      const box = findElement(side, (element) => element.getAttribute('role') === 'alertdialog');
      expect(box).toBeDefined();
      expect(textOf(box)).toContain('只提交 .workbench/ 里的 2 个文件，提交到当前分支 main，不碰代码。');
      const message = findElement(box!, (element) => element.tagName.toLowerCase() === 'textarea');
      expect(message).toBeDefined();
      expect(message!.value).toBe('更新架构图和注记（2 个文件）');

      const submit = findElement(box!, (element) => element.tagName.toLowerCase() === 'button'
        && textOf(element) === '提交');
      expect(submit).toBeDefined();
      click(submit!);
      await waitFor(() => countRoute(log, 'knowledge/commit') === 1, 10_000);
      const commitCall = callsTo(log, 'knowledge/commit')[0]!;
      await waitFor(() => commitCall.reply !== undefined, 30_000);
      expect(asRecord(commitCall.reply)['status']).toBe('rejected');
      /* The commit's `unavailable` reason is shown as it is; the box stays open and
         the bar is still there because no reread happened. */
      await waitFor(() => findElement(page.root, (element) => element.getAttribute('role') === 'alertdialog')
        ?.textContent.includes('提交没成功：pre-commit hook: no') === true, 15_000);
      const openBox = findElement(page.root, (element) => element.getAttribute('role') === 'alertdialog');
      expect(openBox).toBeDefined();
      const commitFailed = findElement(openBox!, (element) => element.tagName.toLowerCase() === 'span'
        && hasClass(element, 'tx-failed'));
      expect(commitFailed).toBeDefined();
      expect(textOf(commitFailed)).toBe('提交没成功：pre-commit hook: no');
      expect(pageText(page)).toContain('架构图和注记有 3 处改动还没提交');
    } finally {
      await page.restore();
    }
  }, 300_000);
});
