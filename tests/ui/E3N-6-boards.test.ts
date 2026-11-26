import { afterEach, describe, expect, it } from 'vitest';
import { bootE3N, pickTab, waitFor } from './helpers/E3N-page.js';
import { findElement } from './helpers/boot-page.js';
import { openW1 } from './helpers/E3N-world.js';
import type { S6ARequestWorld } from '../helpers/S6A-request-fixture.js';

/**
 * E3W N50 (run sheet §2.6): the shell mounts each of the two boards, opens
 * exactly one change stream, fetches the page once and shows the real Goal
 * name with no unrendered template text.
 */

const worlds: S6ARequestWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

describe('E3N-6 the shell for both boards', () => {
  it.each(['Main', 'TaskMap'])('N50 %s mounts real data, one stream and one page fetch', async (name) => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, name as 'Main' | 'TaskMap', { search: '?goal=ag2b-goal' });
    try {
      /* 具名改坏: `src/ui/boot.ts` 的 `BOARD_READERS` 少了 `Main`（现在注册
         `TaskMap`、`Main`、`Goals`、`ArchOverview`、`Decide`、`Member`、`Chain`），Main 走样例；
         N50 的 Main `changes` 和 `pageFetches` 断言红。 */
      await expect.poll(() => log.changes, { timeout: 10_000, interval: 25 }).toBe(1);
      expect(page.pageFetches()).toBe(1);
      expect(page.root.textContent.length).toBeGreaterThan(0);
      expect(page.root.textContent).not.toContain('{{');
      expect(page.root.textContent).not.toContain('NaN');
      expect(page.root.textContent).not.toContain('undefined');
      expect(page.root.textContent).toContain('S6A goal one');
    } finally {
      await page.restore();
    }
  }, 60_000);
});

describe('E3N-6 完整架构图 carries the Goal', () => {
  it.each(['Main', 'Plan', 'Decide', 'Done'] as const)(
    'N51 %s keeps the URL Goal on 完整架构图', async (name) => {
      const opened = await openW1();
      worlds.push(opened.world);
      const goalId = opened.world.goals.first.goalId;
      const { page, log } = await bootE3N(opened.world, name, { search: `?goal=${goalId}` });
      try {
        await pickTab(page, log, '架构图');
        await waitFor(() => findElement(page.root, (element) => element.tagName.toLowerCase() === 'a'
          && (element.getAttribute('href') ?? '').startsWith('ArchOverview.dc.html')) !== undefined);
        const link = findElement(page.root, (element) => element.tagName.toLowerCase() === 'a'
          && (element.getAttribute('href') ?? '').startsWith('ArchOverview.dc.html'));
        expect(link).toBeDefined();
        /* 具名改坏: 把这一页的 href 改回静态的 `ArchOverview.dc.html`；本行的 goal 断言红。 */
        const url = new URL(link!.getAttribute('href') ?? '', `http://host/workbench/${name}.dc.html`);
        expect(url.pathname).toBe('/workbench/ArchOverview.dc.html');
        expect(url.searchParams.get('goal')).toBe(goalId);
        if (name === 'Decide') {
          /* DecideData keeps its navigation under `nav`: with no URL Goal the
             link must still take the Goal the page's own read published. */
          const read = await bootE3N(opened.world, 'Decide', { search: '' });
          try {
            await pickTab(read.page, read.log, '架构图');
            const href = findElement(read.page.root, (element) => element.tagName.toLowerCase() === 'a'
              && (element.getAttribute('href') ?? '').startsWith('ArchOverview.dc.html'))!
              .getAttribute('href') ?? '';
            /* 具名改坏: boot 不把 Decide 读到的目标放进链接；本段红。 */
            expect(new URL(href, 'http://host/workbench/Decide.dc.html').searchParams.get('goal')).toBe(goalId);
          } finally {
            await read.page.restore();
          }
        }
        /* 具名改坏: 读失败时把 archHref 置空或改成别的目标；本段红。 */
        const failed = await bootE3N(opened.world, name, {
          search: `?goal=${goalId}`, unavailable: 'goals/list',
        });
        try {
          await pickTab(failed.page, failed.log, '架构图');
          await waitFor(() => findElement(failed.page.root, (element) => element.tagName.toLowerCase() === 'a'
            && (element.getAttribute('href') ?? '').startsWith('ArchOverview.dc.html')) !== undefined);
          const href = findElement(failed.page.root, (element) => element.tagName.toLowerCase() === 'a'
            && (element.getAttribute('href') ?? '').startsWith('ArchOverview.dc.html'))!
            .getAttribute('href') ?? '';
          expect(new URL(href, `http://host/workbench/${name}.dc.html`).searchParams.get('goal')).toBe(goalId);
        } finally {
          await failed.page.restore();
        }
      } finally {
        await page.restore();
      }
    });
});
