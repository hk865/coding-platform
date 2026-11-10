import { afterAll, describe, expect, it } from 'vitest';
import { findClass } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import { bootE3N, countRoute, descendants, hasClass, lineHeadTitle, lineRows, textOf } from './helpers/E3N-page.js';
import { openW1, openW2 } from './helpers/E3N-world.js';
import {
  buttonText, callsOf, elementsOf, memberSearch, openMemberS7C, press, radio, railRowOf, settle, worldSlot,
} from './helpers/E3M-world.js';
import type { S6ARequestWorld } from '../helpers/S6A-request-fixture.js';

/**
 * E3M-1 (test sheet §2.1, M01–M07, DM1): the rail of the Member page — the
 * inbox, the static Goal rows, the line rows with this page's own line, the
 * archive expansion and an archived line's read-only view. The change stream
 * is held, so every count is the page's own reads.
 */

const slot = worldSlot();
afterAll(async () => { await slot.close(); }, 180_000);
const w0 = () => slot.use('W0', () => openW1(), (opened) => opened.world.close());
const w5 = () => slot.use('W5', () => openW2(), (opened) => opened.world.close());
const w1 = () => slot.use('W1', () => openMemberS7C(), (opened) => opened.s7c.close());

const boot = (world: S6ARequestWorld, search: string) => bootE3N(world, 'Member', { search, mode: 'controlled', gate: true });

const urlOf = (element: FakeElement | undefined): URL =>
  new URL(element?.getAttribute('href') ?? '', 'http://host/workbench/Member.dc.html');

const firstOf = (holder: FakeElement | undefined, tags: string[]): FakeElement | undefined =>
  holder === undefined ? undefined : descendants(holder).find((element) => tags.includes(element.tagName.toLowerCase()));

const clickHandlers = (element: FakeElement | undefined): number => element?.listeners.get('click')?.length ?? 0;

const archiveToggle = (root: FakeElement): FakeElement | undefined =>
  elementsOf(findClass(root, 'rail'), 'button').find((element) => element.getAttribute('aria-expanded') !== null);

const archivedRows = (root: FakeElement): FakeElement[] =>
  elementsOf(findClass(root, 'rail'), 'button').filter((element) => hasClass(element, 'is-arch'));

describe('E3M-1 the Member rail', () => {
  it('R01 the inbox rows count the waiting cards and 0 notices and link to Main with the Goal (M01/M02)', async () => {
    const { world } = await w0();
    const { page } = await boot(world, '?goal=ag2b-goal');
    try {
      const inbox = descendants(page.root).find((element) => hasClass(element, 'rail-sec')
        && element.getAttribute('aria-label') === '需要你处理');
      const links = elementsOf(inbox, 'a');
      expect(links.map((link) => textOf(findClass(link, 'row-name')))).toEqual(['需要你决定', '请知悉']);
      /* lead 11-10: W0's two seeded Goals have neither an adopted architecture nor a completion policy, so
         `decisions/queue` holds 4 waiting `goal_cause` cards (`missing_initial_architecture` and
         `missing_initial_completion_policy` for `ag2b-goal` and `s6a-goal-2`) and no notice.
         具名改坏: `nav.ts` 的 `adaptNav` 不读 `counts.waitingAnswer`、把 `decideN` 写死为 `0`；本行的 `4` 红。 */
      expect(links.map((link) => textOf(findClass(link, 'row-meta')))).toEqual(['4', '0']);
      for (const link of links) {
        expect(urlOf(link).pathname).toBe('/workbench/Main.dc.html');
        expect(urlOf(link).searchParams.get('goal')).toBe('ag2b-goal');
      }
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('R02 the Goal section draws the two nav.goals rows, static (DM1 改)', async () => {
    const { world } = await w0();
    const { page } = await boot(world, '?goal=ag2b-goal');
    try {
      const rail = findClass(page.root, 'rail');
      const rows = elementsOf(rail, 'div', 'row').filter((row) => hasClass(row, 'is-static'));
      /* 具名改坏: `member.ts` 把目标段接回原型样例；本行的 `.row-name` 红。 */
      expect(rows.map((row) => textOf(findClass(row, 'row-name')))).toEqual(['S6A goal one', 'S6A goal two']);
      expect(rows.map((row) => textOf(findClass(row, 'row-ord')))).toEqual(['1', '2']);
      for (const row of rows) {
        expect(clickHandlers(row)).toBe(0);
        expect(row.getAttribute('onclick')).toBeNull();
        expect(row.getAttribute('onClick')).toBeNull();
      }
      expect(textOf(rail)).not.toContain('WorkGraph 拆分');
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('R03 the rail lines: the main link, 秘书 1 and this page’s own 执行者 as current (M03)', async () => {
    const { world, work } = await w0();
    const { page } = await boot(world, memberSearch('ag2b-goal', work.ref));
    try {
      const rows = lineRows(page.root);
      expect(rows).toHaveLength(3);
      const main = firstOf(rows[0], ['a', 'button']);
      expect(main?.tagName.toLowerCase()).toBe('a');
      expect(textOf(findClass(main!, 'row-name'))).toBe('秘书（主对话）');
      expect(main?.getAttribute('aria-current')).toBeNull();
      const secretary = firstOf(rows[1], ['a', 'button']);
      expect(secretary?.tagName.toLowerCase()).toBe('button');
      expect(textOf(findClass(secretary!, 'row-name'))).toBe('秘书 1');
      const own = firstOf(rows[2], ['a', 'button']);
      expect(textOf(findClass(own!, 'row-name'))).toBe('执行者');
      /* 具名改坏: `member.ts` 忽略 `selected`，总把第一条线设成 current；本行的 `aria-current` 红。 */
      expect(own?.tagName.toLowerCase()).toBe('button');
      expect(own?.getAttribute('aria-current')).toBe('page');
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('R05 秘书（主对话） is a link to Main with the Goal, 秘书 1 a button (M05)', async () => {
    const { world } = await w0();
    const { page } = await boot(world, '?goal=ag2b-goal');
    try {
      const rows = lineRows(page.root);
      const main = firstOf(rows[0], ['a', 'button']);
      /* 具名改坏: 合成行改成 `button`；本行的 `tagName` 红。 */
      expect(main?.tagName.toLowerCase()).toBe('a');
      expect(textOf(findClass(main!, 'row-name'))).toBe('秘书（主对话）');
      expect(urlOf(main).pathname).toBe('/workbench/Main.dc.html');
      expect(urlOf(main).searchParams.get('goal')).toBe('ag2b-goal');
      expect(clickHandlers(main)).toBe(0);
      const secretary = firstOf(rows[1], ['a', 'button']);
      expect(secretary?.tagName.toLowerCase()).toBe('button');
      expect(textOf(findClass(secretary!, 'row-name'))).toBe('秘书 1');
    } finally {
      await page.restore();
    }
  }, 120_000);

  it.each([{ entry: '展开' }, { entry: '收起' }])('R06 the archive row: $entry (M06)', async ({ entry }) => {
    const { world, work } = await w5();
    const { page, log } = await boot(world, memberSearch('ag2b-goal', work.ref));
    try {
      /* 具名改坏: 首读就带 `archive:true`；展开条目的“点击前 0”红。 */
      expect(countRoute(log, 'lines/archived')).toBe(0);
      press(archiveToggle(page.root), '已归档');
      await settle(() => countRoute(log, 'lines/archived') > 0 && archivedRows(page.root).length > 0);
      expect(countRoute(log, 'lines/archived')).toBe(1);
      if (entry === '展开') {
        expect(archiveToggle(page.root)?.getAttribute('aria-expanded')).toBe('true');
        expect(archivedRows(page.root).map((row) => textOf(findClass(row, 'row-name')))).toEqual(['执行者']);
        return;
      }
      const archivedReads = countRoute(log, 'lines/archived');
      press(archiveToggle(page.root), '已归档');
      await settle(() => archivedRows(page.root).length === 0 && countRoute(log, 'lines/list') >= 3);
      /* 具名改坏: 收起不传 `archive:false`；收起条目的 `lines/archived` 次数红。 */
      expect(archiveToggle(page.root)?.getAttribute('aria-expanded')).toBe('false');
      expect(archivedRows(page.root)).toHaveLength(0);
      expect(countRoute(log, 'lines/archived')).toBe(archivedReads);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('R07 an archived line opens read-only: one lines/read, 直接干预 disabled, no 暂停/取消 (M07)', async () => {
    const { world, work, archived } = await w5();
    const { page, log } = await boot(world, memberSearch('ag2b-goal', work.ref));
    try {
      press(archiveToggle(page.root), '已归档');
      await settle(() => archivedRows(page.root).length > 0);
      const before = log.calls.length;
      const row = archivedRows(page.root)[0];
      press(row, 'line row');
      await settle(() => callsOf(log, 'lines/read', before).length > 0 && lineHeadTitle(page.root) === '执行者');
      const reads = callsOf(log, 'lines/read', before)
        .filter((call) => (call.input as { key?: { sessionId?: string } }).key?.sessionId === archived.ref.sessionId);
      expect(reads).toHaveLength(1);
      expect(lineHeadTitle(page.root)).toBe('执行者');
      expect(radio(page.root, '直接干预')?.getAttribute('aria-disabled')).toBe('true');
      /* 具名改坏: 归档线也画 `暂停/取消`；本行的“没有按钮”红。 */
      const acts = findClass(page.root, 'lv-acts');
      expect(buttonText(acts, '暂停')).toBeUndefined();
      expect(buttonText(acts, '取消')).toBeUndefined();
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('R04 another line’s row rereads lines/read with its key and opens its view (M04)', async () => {
    const w = await w1();
    const { page, log } = await boot(w.s7c.world, memberSearch('s7c-goal', w.module));
    try {
      expect(countRoute(log, 'lines/read')).toBe(1);
      const row = await railRowOf(page.root, w.s7c.world, w.work);
      press(row, 'line row');
      await settle(() => countRoute(log, 'lines/read') >= 2 && lineHeadTitle(page.root) === '执行者');
      /* 具名改坏: `openLine` 只改本地状态、不 `refresh.reread()`；本行的 `lines/read` 次数红。 */
      expect(countRoute(log, 'lines/read')).toBe(2);
      expect((callsOf(log, 'lines/read').at(-1)?.input as { key?: unknown }).key)
        .toEqual({ projectId: 'ag2b-collab-project', sessionId: w.work.sessionId });
      expect(lineHeadTitle(page.root)).toBe('执行者');
    } finally {
      await page.restore();
    }
  }, 180_000);
});
