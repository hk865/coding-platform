import { afterEach, describe, expect, it } from 'vitest';
import { bootE3N, countRoute, descendants, hasClass, turns, type PageLog } from './helpers/E3N-page.js';
import { click, pressKey } from './helpers/E3N-interact.js';
import { findClass, findElement, type BootedPage } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import { openE3GW0, e3gSettled, type E3GWorld } from './helpers/E3G-world.js';

/**
 * E3G-5 G40–G44 (test sheet §2.5): the shell is local, the first read is one
 * bootstrap + one goals/list + one goals/conflicts, and one change stream
 * rereads the Goal list when a Session is created.
 */

const worlds: E3GWorld[] = [];
afterEach(async () => {
  for (const opened of worlds.splice(0)) await opened.world.close();
});

function byLabel(root: FakeElement, name: string): FakeElement | undefined {
  return descendants(root).find((element) => element.tagName.toLowerCase() === 'button'
    && element.getAttribute('aria-label') === name);
}

function shell(root: FakeElement): FakeElement {
  const element = findClass(root, 'gx');
  expect(element).toBeDefined();
  return element!;
}

async function boot(opened: E3GWorld): Promise<{ page: BootedPage; log: PageLog }> {
  const booted = await bootE3N(opened.world, 'Goals');
  /* T1: the baseline is after the first read and the stream-open reread. */
  await e3gSettled(booted.log, false);
  return booted;
}

describe('E3G-5 the shell and the first read', () => {
  it('G40 the theme button adds t-light and flips its label locally', async () => {
    const opened = await openE3GW0();
    worlds.push(opened);
    const { page, log } = await boot(opened);
    try {
      expect(countRoute(log, 'goals/list')).toBe(2);
      const root = shell(page.root);
      const theme = byLabel(page.root, '切换到浅色');
      expect(theme).toBeDefined();
      expect(hasClass(root, 't-light')).toBe(false);
      const before = log.calls.length;
      click(theme!);
      await turns(() => hasClass(shell(page.root), 't-light'), 800);
      /* 具名改坏: 主题按钮只改 `aria-label` 不加 `t-light`；G40 的 class 红。 */
      expect(hasClass(shell(page.root), 't-light')).toBe(true);
      expect(theme!.getAttribute('aria-label')).toBe('切换到深色');
      expect(log.calls.length).toBe(before);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('G41 the panel button toggles no-panel locally', async () => {
    const opened = await openE3GW0();
    worlds.push(opened);
    const { page, log } = await boot(opened);
    try {
      expect(countRoute(log, 'goals/list')).toBe(2);
      const button = byLabel(page.root, '显示或隐藏右栏');
      expect(button).toBeDefined();
      expect(hasClass(shell(page.root), 'is-split')).toBe(true);
      expect(hasClass(shell(page.root), 'no-panel')).toBe(false);
      const before = log.calls.length;
      click(button!);
      await turns(() => hasClass(shell(page.root), 'no-panel'), 800);
      /* 具名改坏: 按钮只改 `aria-label` 不改 `class`；G41 的 `no-panel` 红。 */
      expect(hasClass(shell(page.root), 'no-panel')).toBe(true);
      expect(log.calls.length).toBe(before);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('G42 ArrowRight moves the split from 480 to 496', async () => {
    const opened = await openE3GW0();
    worlds.push(opened);
    const { page, log } = await boot(opened);
    try {
      expect(countRoute(log, 'goals/list')).toBe(2);
      const separator = descendants(page.root).find((element) => element.getAttribute('role') === 'separator');
      expect(separator).toBeDefined();
      /* 具名改坏: 步长改成 8；G42 的 `496` 红。 */
      expect(separator!.getAttribute('aria-valuenow')).toBe('480');
      pressKey(separator!, 'ArrowRight');
      await turns(() => separator!.getAttribute('aria-valuenow') === '496', 800);
      expect(separator!.getAttribute('aria-valuenow')).toBe('496');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('G43 the first read is one bootstrap, one list and one conflict read on one stream', async () => {
    const opened = await openE3GW0();
    worlds.push(opened);
    const { page, log } = await boot(opened);
    try {
      /* 具名改坏: 在 `readGoals` 里再 `bootstrap` 一次；G43 的 `bootstrap` 次数红。 */
      expect(log.changes).toBe(1);
      expect(countRoute(log, 'bootstrap')).toBe(2);
      expect(countRoute(log, 'goals/list')).toBe(2);
      expect(countRoute(log, 'goals/conflicts')).toBe(2);
      expect(page.pageFetches()).toBe(1);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('G44 one new Session rereads the list once and keeps the one stream', async () => {
    const opened = await openE3GW0();
    worlds.push(opened);
    /* T6/T1: the N16 wait (`E3N-2-shell-stream.test.ts:194-219`) — first read,
       release the gated stream, the open reread, then exactly one notification. */
    const { page, log } = await bootE3N(opened.world, 'Goals', { mode: 'controlled', gate: true });
    try {
      await turns(() => countRoute(log, 'bootstrap') === 1 && countRoute(log, 'goals/list') === 1, 2_000);
      expect(log.changes).toBe(1);
      log.releaseChanges();
      await turns(() => countRoute(log, 'bootstrap') === 2 && countRoute(log, 'goals/list') === 2, 2_000);
      const before = countRoute(log, 'goals/list');
      await opened.world.createWorkSession('e3g-new');
      const opening = log.openings.at(-1);
      if (opening === undefined) throw new Error('the page did not open its change stream');
      opening.enqueue(new TextEncoder().encode('event: change\nid: c0000000002\ndata: {}\n\n'));
      await turns(() => countRoute(log, 'goals/list') === before + 1, 2_000);
      /* 具名改坏: 另开一条 `subscribeChanges`；G44 的 `changes===1` 红。 */
      expect(countRoute(log, 'goals/list')).toBe(before + 1);
      expect(log.changes).toBe(1);
    } finally {
      await page.restore();
    }
  }, 60_000);
});
