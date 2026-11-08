import { afterEach, describe, expect, it } from 'vitest';
import {
  bootE3N, countRoute, descendants, hasClass, textOf, turns, type PageLog,
} from './helpers/E3N-page.js';
import { click, hover, leave } from './helpers/E3N-interact.js';
import { findClass, findElement, type BootedPage } from './helpers/boot-page.js';
import { FakeElement } from './helpers/dom.js';
import { E3G_OVERLAP, e3gSettled, openE3GW0, openE3GW1, type E3GWorld } from './helpers/E3G-world.js';

/**
 * E3G-4 G30–G36 (test sheet §2.4): the 架构图 and 任务图 tabs. The two maps are
 * local after `architecture/read`/`tasks/query`; hover and detail never read
 * `graph/hover` or `graph/detail`.
 */

const worlds: E3GWorld[] = [];
afterEach(async () => {
  for (const opened of worlds.splice(0)) await opened.world.close();
});

function nodesNamed(root: FakeElement, name: string): FakeElement[] {
  return descendants(root).filter((element) => element.tagName.toLowerCase() === 'button'
    && findElement(element, (child) => hasClass(child, 'tr-name') && textOf(child) === name) !== undefined);
}

function squareOf(node: FakeElement): FakeElement | undefined {
  return descendants(node).find((element) => hasClass(element, 'sq'));
}

function tabNamed(root: FakeElement, name: string): FakeElement | undefined {
  return descendants(root).find((element) => element.tagName.toLowerCase() === 'button'
    && hasClass(element, 'nm') && textOf(element) === name);
}

/** One `<span class="k">冲突</span><span class="d-items">…</span>` group of `.d-rel`, on its own. */
function relationGroup(relations: FakeElement, key: string): string {
  const nodes = relations.childNodes;
  const at = nodes.findIndex((node) => node instanceof FakeElement && hasClass(node, 'k') && textOf(node) === key);
  if (at < 0) return '';
  const parts: string[] = [];
  for (let index = at + 1; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (node instanceof FakeElement && hasClass(node, 'k')) break;
    parts.push(node.textContent);
  }
  return parts.join('');
}

/** A task row is a leaf (`nb`); a branch row carries `tr-lb` (both show `.tr-name`). */
function taskNamed(root: FakeElement, name: string): FakeElement | undefined {
  return descendants(root).find((element) => element.tagName.toLowerCase() === 'button'
    && (hasClass(element, 'nb') || hasClass(element, 'tr-lb'))
    && textOf(findElement(element, (child) => hasClass(child, 'tr-name')) ?? element).includes(name));
}

async function openPage(opened: E3GWorld, waitCards: boolean): Promise<{ page: BootedPage; log: PageLog }> {
  const booted = await bootE3N(opened.world, 'Goals');
  /* T1: the baseline is after the first read and the stream-open reread. */
  await e3gSettled(booted.log, waitCards);
  if (waitCards) {
    await turns(() => findClass(booted.page.root, 'plan') !== undefined, 800);
  }
  return booted;
}

describe('E3G-4 the two maps', () => {
  it('G30 the architecture map lights the two overlapping files as undecided', async () => {
    const opened = await openE3GW1();
    worlds.push(opened);
    const { page, log } = await openPage(opened, true);
    try {
      /* 具名改坏: 适配器把冲突文件的格子画成 `s-none`；G30 的 `s-decide` 红。 */
      expect(countRoute(log, 'architecture/read')).toBe(2);
      for (const path of E3G_OVERLAP) {
        const node = nodesNamed(page.root, path.split('/').pop()!)[0];
        expect(node).toBeDefined();
        expect(squareOf(node!)?.getAttribute('class') ?? '').toContain('s-decide');
      }
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('G31 switching the scope is local and keeps the default on 重叠的文件', async () => {
    const opened = await openE3GW1();
    worlds.push(opened);
    const { page, log } = await openPage(opened, true);
    try {
      const overlap = descendants(page.root).find((element) => element.tagName.toLowerCase() === 'button'
        && element.getAttribute('aria-pressed') !== null && textOf(element) === '重叠的文件');
      const pair = descendants(page.root).find((element) => element.tagName.toLowerCase() === 'button'
        && element.getAttribute('aria-pressed') !== null && textOf(element) === '两个目标的文件');
      expect(overlap).toBeDefined();
      expect(pair).toBeDefined();
      /* 具名改坏: 切换范围时再读一次 `architecture/read`；G31 的“不发请求”红。 */
      expect(countRoute(log, 'goals/conflicts')).toBe(2);
      expect(overlap!.getAttribute('aria-pressed')).toBe('true');
      const before = log.calls.length;
      click(pair!);
      await turns(() => pair!.getAttribute('aria-pressed') === 'true', 800);
      expect(overlap!.getAttribute('aria-pressed')).toBe('false');
      click(overlap!);
      await turns(() => overlap!.getAttribute('aria-pressed') === 'true', 800);
      expect(log.calls.length).toBe(before);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('G32 the task map draws both Goals and their tasks on the overlapping files', async () => {
    const opened = await openE3GW1();
    worlds.push(opened);
    const { page, log } = await openPage(opened, true);
    try {
      const tab = tabNamed(page.root, '任务图');
      expect(tab).toBeDefined();
      click(tab!);
      await turns(() => tab!.getAttribute('aria-selected') === 'true', 800);
      /* 具名改坏: 任务图只画第一个目标；G32 的第二个目标名红。 */
      const names = descendants(page.root).filter((element) => hasClass(element, 'tr-name')).map((element) => textOf(element));
      expect(names).toContain('S6A goal one');
      expect(names).toContain('S6A goal two');
      expect(names).toContain('Independent work e3g-one-work');
      expect(names).toContain('Independent work e3g-two-work');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('G33 hovering a task node shows its card locally', async () => {
    const opened = await openE3GW1();
    worlds.push(opened);
    const { page, log } = await openPage(opened, true);
    try {
      click(tabNamed(page.root, '任务图')!);
      await turns(() => tabNamed(page.root, '任务图')!.getAttribute('aria-selected') === 'true', 800);
      const task = taskNamed(page.root, 'Independent work');
      expect(task).toBeDefined();
      hover(task!);
      await turns(() => findElement(page.root, (element) => element.getAttribute('role') === 'tooltip') !== undefined, 800);
      /* 具名改坏: 悬停去读 `graph/hover`；G33 的零请求红。 */
      expect(textOf(findElement(page.root, (element) => element.getAttribute('role') === 'tooltip'))).toContain('views.ts');
      leave(task!);
      await turns(() => findElement(page.root, (element) => element.getAttribute('role') === 'tooltip') === undefined, 800);
      expect(countRoute(log, 'graph/hover')).toBe(0);
      expect(countRoute(log, 'graph/detail')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('G34 a task detail lists the overlapping file under 冲突 without graph/detail', async () => {
    const opened = await openE3GW1();
    worlds.push(opened);
    const { page, log } = await openPage(opened, true);
    try {
      click(tabNamed(page.root, '任务图')!);
      await turns(() => tabNamed(page.root, '任务图')!.getAttribute('aria-selected') === 'true', 800);
      const task = taskNamed(page.root, 'Independent work');
      expect(task).toBeDefined();
      click(task!);
      await turns(() => findClass(page.root, 'detail') !== undefined, 800);
      const detail = findClass(page.root, 'detail')!;
      const relations = findClass(detail, 'd-rel');
      expect(relations).toBeDefined();
      /* 具名改坏: 详情改成读 `graph/detail`；G34 的零请求红。 */
      expect(relationGroup(relations!, '冲突')).toContain('src/ui/views.ts');
      expect(countRoute(log, 'graph/detail')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('G35 a world without a conflict reads no architecture and draws no card', async () => {
    const opened = await openE3GW0();
    worlds.push(opened);
    const { page, log } = await openPage(opened, false);
    try {
      /* 具名改坏: 无条件读 `architecture/read`；G35 的零请求红。 */
      expect(countRoute(log, 'architecture/read')).toBe(0);
      expect(findElement(page.root, (element) => element.tagName.toLowerCase() === 'section'
        && hasClass(element, 'plan'))).toBeUndefined();
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('G36 a conflict file ref selects it in the architecture tab without a read', async () => {
    const opened = await openE3GW1();
    worlds.push(opened);
    const { page, log } = await openPage(opened, true);
    try {
      const ref = descendants(page.root).find((element) => element.tagName.toLowerCase() === 'button'
        && hasClass(element, 'ref') && textOf(element) === 'src/ui/views.ts');
      expect(ref).toBeDefined();
      const before = log.calls.length;
      click(ref!);
      await turns(() => (tabNamed(page.root, '架构图')?.getAttribute('aria-selected')) === 'true', 800);
      /* 具名改坏: 点击去读 `architecture/find`；G36 的“请求数不变”红。 */
      expect(tabNamed(page.root, '架构图')!.getAttribute('aria-selected')).toBe('true');
      const node = nodesNamed(page.root, 'views.ts')[0];
      expect(node).toBeDefined();
      expect(hasClass(node!, 'is-sel')).toBe(true);
      expect(log.calls.length).toBe(before);
    } finally {
      await page.restore();
    }
  }, 60_000);
});
