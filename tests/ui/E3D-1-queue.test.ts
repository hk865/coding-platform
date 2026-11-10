import { afterAll, describe, expect, it } from 'vitest';
import { findClass, findElement } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import { descendants, goalRows, hasClass, lineHeadTitle, lineRows, textOf } from './helpers/E3N-page.js';
import { click, hover } from './helpers/E3N-interact.js';
import { openE3GW0, openE3GW1, type E3GWorld } from './helpers/E3G-world.js';
import {
  bootDecide, callsOf, count, firstWorkLine, inboxRow, lineControl, opened, quiet, rowMeta, rowName, sectionNames,
  sectionRows, settle, worldTarget, cardTitle,
} from './helpers/E3D-page.js';
import { seePlanAdoptions } from './helpers/E3D-world.js';
import { openS6ANoticesWorld, type S6ANoticesWorld } from '../helpers/S6A-cards-fixture.js';
import type { S6ASession } from '../helpers/S6A-request-fixture.js';

/**
 * E3D-1 D01–D07 (test sheet §2.1): the rail's two inbox rows, the 请知悉
 * section, the Goal filter, the rail lines, their hover card and the archive.
 * W1 is the E3G conflict world, W2n the three automatic reworks (positions 1,
 * 2, 3; the two plan adoptions marked seen first through the public route, so
 * the 请知悉 section holds only the reworks), W0 the two-Goal world plus one
 * archived executor line (`sessions/archive-line`).
 */

let w1: E3GWorld | null = null;
let w2n: S6ANoticesWorld | null = null;
let w0: { opened: E3GWorld; archived: S6ASession } | null = null;

afterAll(async () => {
  await w1?.world.close();
  await w2n?.close();
  await w0?.opened.world.close();
});

async function worldW1(): Promise<E3GWorld> {
  w1 ??= await openE3GW1();
  return w1;
}

async function worldW2n(): Promise<S6ANoticesWorld> {
  if (w2n === null) {
    w2n = await openS6ANoticesWorld({ backend: 'memory' });
    await w2n.seedReworkNotices();
    await seePlanAdoptions(w2n.main, 'e3d-1-w2n');
  }
  return w2n;
}

async function worldW0(): Promise<{ opened: E3GWorld; archived: S6ASession }> {
  if (w0 === null) {
    const made = await openE3GW0();
    const archived = await made.world.createWorkSession('e3d-archived');
    await made.world.archive(archived);
    w0 = { opened: made, archived };
  }
  return w0;
}

/** The hover card's `dt`/`dd` pairs. */
function cardRows(hcard: FakeElement): Array<{ key: string; value: string }> {
  const pairs: Array<{ key: string; value: string }> = [];
  for (const child of descendants(hcard)) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'dt') pairs.push({ key: textOf(child), value: '' });
    else if (tag === 'dd' && pairs.length > 0) pairs[pairs.length - 1]!.value = textOf(child);
  }
  return pairs;
}

function archivedRows(root: FakeElement): FakeElement[] {
  const list = findClass(root, 'rail-archived');
  return list === undefined ? [] : descendants(list).filter((element) => element.tagName.toLowerCase() === 'button');
}

describe('E3D-1 the rail and the queue', () => {
  it('D01 需要你决定 counts the one waiting card and opens it', async () => {
    const world = await worldW1();
    const { page, log } = await bootDecide(worldTarget(world.world));
    try {
      await opened(log);
      const decide = inboxRow(page.root, '需要你决定');
      /* 具名改坏: `inbox.decideN` 用 `history.length`（W1 的两张已关的候选卡）；D01 的 `1` 红。 */
      expect(rowMeta(decide)).toBe('1');
      click(decide!);
      await settle(() => cardTitle(page.root) !== '', 2_000);
      expect(cardTitle(page.root)).toBe('与目标 1 冲突');
      expect(inboxRow(page.root, '需要你决定')?.getAttribute('aria-current')).toBe('page');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('D02 the three automatic reworks are 请知悉 rows, the first one by its summary', async () => {
    const world = await worldW2n();
    const { page, log } = await bootDecide(worldTarget(world.world));
    try {
      await opened(log);
      /* 具名改坏: 把请知悉项当要决定项（`level:'decide'`）；D02 的段名 `请知悉` 红。 */
      expect(sectionNames(page.root)).toContain('请知悉');
      const rows = sectionRows(page.root, '请知悉');
      expect(rows).toHaveLength(3);
      expect(rowName(rows[0])).toBe('自动返工 · ag2b-work · 第 1 次（1/3）');
      expect(sectionRows(page.root, '要决定').map(rowName)).not.toContain('自动返工 · ag2b-work · 第 1 次（1/3）');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('D03 a Goal row filters the queue to that Goal', async () => {
    const world = await worldW2n();
    const { page, log } = await bootDecide(worldTarget(world.world));
    try {
      await opened(log);
      const second = goalRows(page.root).find((row) => textOf(findClass(row, 'row-ord')) === '2');
      expect(second).toBeDefined();
      const before = count(log, 'decisions/queue');
      click(second!);
      await settle(() => callsOf(log, 'decisions/queue').slice(before)
        .some((call) => (call.input as { goalRef?: unknown }).goalRef !== undefined && call.reply !== undefined), 3_000);
      await quiet(log);
      /* 具名改坏: 适配器忽略 `goalRef`；D03 的 `1` 红。 */
      expect(sectionRows(page.root, '请知悉')).toHaveLength(1);
      expect(textOf(findClass(page.root, 'dq-filter'))).toBe('只看目标 2：S6A goal two');
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('D04 the rail lists the secretary and the work line; a work line reads lines/read with its key', async () => {
    const world = await worldW0();
    const { page, log } = await bootDecide(worldTarget(world.opened.world));
    try {
      await opened(log);
      expect(lineRows(page.root)).toHaveLength(2);
      const line = firstWorkLine(page.root);
      expect(line).toBeDefined();
      click(line!);
      await settle(() => findClass(page.root, 'lv-thread') !== undefined
        && callsOf(log, 'lines/read').some((call) => call.reply !== undefined), 3_000);
      /* 具名改坏: 点线只改右栏不读 `lines/read`；D04 的 `.lv-thread` 红。 */
      expect(findClass(page.root, 'lv-thread')).toBeDefined();
      expect(lineHeadTitle(page.root)).toBe('执行者');
      expect((callsOf(log, 'lines/read')[0]?.input as { key?: unknown } | undefined)?.key).toEqual(world.opened.work.ref);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('D05 hovering the first line shows its card from loaded data only', async () => {
    const world = await worldW0();
    const { page, log } = await bootDecide(worldTarget(world.opened.world));
    try {
      await opened(log);
      const holder = lineRows(page.root)[0];
      expect(holder).toBeDefined();
      const before = await quiet(log);
      hover(lineControl(holder!)!);
      const hcardOf = (): FakeElement | undefined => findElement(holder!, (element) => hasClass(element, 'hcard'));
      await settle(() => hcardOf() !== undefined, 1_500);
      const shown = hcardOf();
      /* 具名改坏: 悬停卡自己发请求；D05 的零请求红。 */
      expect(shown).toBeDefined();
      const rows = cardRows(shown!);
      expect(rows.find((row) => row.key === '正在做')?.value).toBe('没有进行中的工作');
      expect(rows.find((row) => row.key === '最近一步')?.value).toBe('');
      expect(log.calls.length).toBe(before);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('D06 已归档 1 条 reads lines/archived only when it opens', async () => {
    const world = await worldW0();
    const { page, log } = await bootDecide(worldTarget(world.opened.world));
    try {
      await opened(log);
      const toggle = findClass(page.root, 'rail-arch');
      expect(toggle).toBeDefined();
      /* 具名改坏: 一直读 `lines/archived`；D06 的“不展开 0”红。 */
      expect(count(log, 'lines/archived')).toBe(0);
      click(toggle!);
      await settle(() => archivedRows(page.root).length > 0, 3_000);
      expect(findClass(page.root, 'rail-arch')?.getAttribute('aria-expanded')).toBe('true');
      expect(archivedRows(page.root)).toHaveLength(1);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('D07 an archived line opens its record through lines/read and controls nothing', async () => {
    const world = await worldW0();
    const { page, log } = await bootDecide(worldTarget(world.opened.world));
    try {
      await opened(log);
      const toggle = findClass(page.root, 'rail-arch');
      expect(toggle).toBeDefined();
      click(toggle!);
      await settle(() => archivedRows(page.root).length > 0, 3_000);
      const row = archivedRows(page.root)[0];
      expect(row).toBeDefined();
      click(row!);
      await settle(() => findClass(page.root, 'lv-thread') !== undefined
        && callsOf(log, 'lines/read').some((call) => call.reply !== undefined), 3_000);
      /* 具名改坏: 点归档线不读 `lines/read`；D07 的 `.lv-thread` 红。 */
      expect(findClass(page.root, 'lv-thread')).toBeDefined();
      expect((callsOf(log, 'lines/read').at(-1)?.input as { key?: unknown } | undefined)?.key).toEqual(world.archived.ref);
      expect(count(log, 'controls/submit')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 60_000);
});
