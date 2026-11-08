import { afterEach, describe, expect, it } from 'vitest';
import { findButton, findClass, findElement, findLink } from './helpers/boot-page.js';
import {
  bootE3N, countRoute, descendants, lineHeadTitle, lineRowNamed, lineRows, mainHeadTitle, textOf, waitFor,
} from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { openW1, openW2 } from './helpers/E3N-world.js';
import type { S6ARequestWorld } from '../helpers/S6A-request-fixture.js';

/**
 * E3W N20–N24 (run sheet §2.3): the rail's real work lines, selecting one,
 * coming back to the main conversation with its draft, the line head's Member
 * link with its two line parameters, and the archived expansion.
 */

const worlds: S6ARequestWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

function composerValue(root: Parameters<typeof findElement>[0]): string {
  return findElement(root, (element) => element.getAttribute('id') === 'composer-input')?.value ?? '';
}

function archivedRow(root: Parameters<typeof findElement>[0], name: string): ReturnType<typeof findElement> {
  const archive = findClass(root, 'rail-archived');
  if (archive === undefined) return undefined;
  return descendants(archive).find((element) => element.tagName.toLowerCase() === 'button'
    && textOf(element) === name);
}

describe('E3N-3 the rail work lines', () => {
  it('N20 the rail shows the main conversation and the two real lines', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal' });
    try {
      /* 具名改坏: 壳适配器把 `lines/list` 的 `rows` 截成 `rows.slice(0,1)`；
         N20 的 3 行和 `执行者` 红。 */
      const rows = lineRows(page.root);
      expect(rows).toHaveLength(3);
      expect(rows.map((row) => textOf(findClass(row, 'row-name'))))
        .toEqual(['秘书（主对话）', '秘书 1', '执行者']);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('N21 selecting the executor reads its line with the Session key', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal' });
    try {
      const row = lineRowNamed(page.root, '执行者');
      expect(row).toBeDefined();
      click(row!);
      /* 具名改坏: 选线处理把 `key` 写成 `{projectId, sessionId: sessionId + 'x'}`；
         N21 的 `lines/read` deepEqual 红（Host 回 `not_found`，中栏不出现 `执行者`）。 */
      await expect.poll(() => countRoute(log, 'lines/read'), { timeout: 10_000, interval: 25 }).toBe(1);
      const call = log.calls.find((entry) => entry.route === 'lines/read');
      expect((call?.input as { key?: unknown }).key).toEqual(opened.work.ref);
      expect(lineHeadTitle(page.root)).toBe('执行者');
      expect(lineRowNamed(page.root, '执行者')?.getAttribute('aria-current')).toBe('true');
      const head = findClass(page.root, 'lv-mh');
      expect(head?.textContent).toContain('状态');
      expect(head?.textContent).toContain('待命');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('N22 回到主对话 restores the main draft and the goal head', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal' });
    try {
      const composer = findElement(page.root, (element) => element.getAttribute('id') === 'composer-input');
      composer!.value = '主对话草稿';
      composer!.dispatch('input', { target: composer, currentTarget: composer });
      const row = lineRowNamed(page.root, '执行者');
      expect(row).toBeDefined();
      click(row!);
      expect(lineHeadTitle(page.root)).toBe('执行者');

      const back = findButton(page.root, '回到主对话');
      expect(back).toBeDefined();
      click(back!);
      /* 具名改坏: `lvLeave()` 里改成 `draft: ''`；N22 的输入框值红。 */
      expect(findClass(page.root, 'lv-headbar')).toBeUndefined();
      expect(mainHeadTitle(page.root)).toBe('S6A goal one');
      expect(composerValue(page.root)).toBe('主对话草稿');
      expect(lineRowNamed(page.root, '执行者')?.getAttribute('aria-current')).not.toBe('true');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('N23 the line head 整页查看 link names the Goal and the line Session', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal' });
    try {
      const row = lineRowNamed(page.root, '执行者');
      expect(row).toBeDefined();
      click(row!);
      expect(lineHeadTitle(page.root)).toBe('执行者');
      /* 具名改坏: 整页链接里删掉 `lineSession` 参数；N23 的 `lineSession` 断言红。 */
      const link = findLink(page.root, '整页查看', 'Member.dc.html');
      expect(link).toBeDefined();
      const url = new URL(link!.getAttribute('href')!, 'http://host/workbench/Main.dc.html');
      expect(url.pathname).toBe('/workbench/Member.dc.html');
      expect(url.searchParams.get('goal')).toBe('ag2b-goal');
      expect(url.searchParams.get('lineProject')).toBe(opened.work.ref.projectId);
      expect(url.searchParams.get('lineSession')).toBe(opened.work.ref.sessionId);
      expect(page.assigned()).toEqual([]);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('N24 已归档 reads lines/archived once and does not reread lines/list', async () => {
    const opened = await openW2();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal' });
    try {
      /* Boundary 2: the stream-open reread has landed before the archive click.
         `tasks/query` is readNav's last route, after its archive branch; waiting
         for it proves the click cannot be absorbed by the in-flight read (which
         would set `archive` before that read decides whether to read it). */
      await expect.poll(() => countRoute(log, 'lines/list'), { timeout: 10_000, interval: 25 }).toBe(2);
      await waitFor(() => countRoute(log, 'tasks/query') >= 2);
      const before = countRoute(log, 'lines/list');
      const expand = findClass(page.root, 'rail-arch');
      expect(expand).toBeDefined();
      click(expand!);
      /* 具名改坏: 归档展开的处理改成再读 `lines/list`；N24 的 `lines/archived` 存在断言红。 */
      await expect.poll(() => countRoute(log, 'lines/archived'), { timeout: 10_000, interval: 25 }).toBe(1);
      const call = log.calls.find((entry) => entry.route === 'lines/archived');
      expect((call?.input as { page?: { limit?: number } }).page?.limit).toBe(100);
      /* The route is counted when it is sent; its rows render after the reply. */
      await waitFor(() => archivedRow(page.root, '执行者') !== undefined, 10_000);
      expect(archivedRow(page.root, '执行者')).toBeDefined();
      /* The same refresh loop rereads the chrome once for the archive demand
         (`readNav` reads `lines/list` with `lines/archived`); the archive read
         itself must be exactly one, which the poll above asserts. */
      expect(countRoute(log, 'lines/list')).toBe(before + 1);
    } finally {
      await page.restore();
    }
  }, 60_000);
});
