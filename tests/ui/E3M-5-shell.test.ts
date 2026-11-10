import { afterAll, describe, expect, it } from 'vitest';
import { findAllClass, findClass } from './helpers/boot-page.js';
import { lineHeadTitle, mainHeadTitle, textOf } from './helpers/E3N-page.js';
import {
  bootMemberAt, callsOf, memberSearch, openMemberS7C, press, railRowOf, settle, worldSlot,
} from './helpers/E3M-world.js';

/**
 * E3M-5 (test sheet §2.5, G01/G02): another line's view inside the Member
 * page — its head, the back row to this page's own line, and its two 整页查看
 * links with the three line parameters (N09, X4).
 */

const slot = worldSlot();
afterAll(async () => { await slot.close(); }, 180_000);
const w1 = () => slot.use('W1', () => openMemberS7C(), (opened) => opened.s7c.close());

/** The page on the module line. */
async function bootModule(): Promise<Awaited<ReturnType<typeof bootMemberAt>> & { w: Awaited<ReturnType<typeof w1>> }> {
  const w = await w1();
  return { w, ...await bootMemberAt(w.s7c.world, memberSearch('s7c-goal', w.module)) };
}

/** The precondition click on `s7c-work`'s rail row, inside the row's own try. */
async function openWorkLine(booted: Awaited<ReturnType<typeof bootModule>>): Promise<void> {
  press(await railRowOf(booted.page.root, booted.w.s7c.world, booted.w.work), 's7c-work');
  await settle(() => findClass(booted.page.root, 'lv-headbar') !== undefined && lineHeadTitle(booted.page.root) !== '');
}

describe('E3M-5 another line inside the Member page', () => {
  it('R37 the line view names the line and the way back (G01)', async () => {
    const booted = await bootModule();
    const { page } = booted;
    try {
      await openWorkLine(booted);
      /* 具名改坏: lv 头拿 `sessionId` 当名字；本行的 `执行者` 红。 */
      expect(lineHeadTitle(page.root)).toBe('执行者');
      /* lead 11-10: the back row names this page's own line, `s7c-module`, by its nav name (`lines/list` `name.primary`, its Task `s7c-m1`'s title). */
      expect(textOf(findClass(page.root, 'lv-back'))).toBe('回到 Independent work s7c-m1');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('R38 the back row rereads this page’s own line once (G01)', async () => {
    const booted = await bootModule();
    const { w, page, log } = booted;
    try {
      await openWorkLine(booted);
      const before = log.calls.length;
      press(findClass(page.root, 'lv-back'), 'the back row');
      await settle(() => findClass(page.root, 'lv-headbar') === undefined && callsOf(log, 'lines/read', before).length > 0);
      expect(mainHeadTitle(page.root)).toBe('执行者');
      /* 具名改坏: 返回只改本地 state、不重读；本行的 `lines/read` 次数红。 */
      expect(callsOf(log, 'lines/read', before).map((call) => (call.input as { key?: unknown }).key))
        .toEqual([{ projectId: 'ag2b-collab-project', sessionId: w.module.sessionId }]);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it.each([
    { entry: 'Member', file: '/workbench/Member.dc.html' },
    { entry: 'Chain', file: '/workbench/Chain.dc.html' },
  ])('R39 the $entry 整页查看 link carries the Goal and the line (G02, N09, X4)', async ({ file }) => {
    const booted = await bootModule();
    const { w, page } = booted;
    try {
      await openWorkLine(booted);
      const links = findAllClass(page.root, 'plink');
      expect(links.map((link) => textOf(link))).toEqual(['整页查看', '整页查看']);
      const link = links.find((entry) => new URL(entry.getAttribute('href') ?? '', 'http://host/workbench/Member.dc.html').pathname === file);
      expect(link).toBeDefined();
      const url = new URL(link!.getAttribute('href')!, 'http://host/workbench/Member.dc.html');
      /* 具名改坏: `lineHref` 省 `lineProject`；两个条目的 `searchParams` 红。 */
      expect([...url.searchParams.keys()].sort()).toEqual(['goal', 'lineProject', 'lineSession']);
      expect(url.searchParams.get('goal')).toBe('s7c-goal');
      expect(url.searchParams.get('lineProject')).toBe('ag2b-collab-project');
      expect(url.searchParams.get('lineSession')).toBe(w.work.sessionId);
      expect(link!.getAttribute('target')).toBeNull();
    } finally {
      await page.restore();
    }
  }, 120_000);
});
