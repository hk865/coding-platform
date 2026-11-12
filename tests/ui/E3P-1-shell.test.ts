import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findClass, findElement } from './helpers/boot-page.js';
import { bootE3N, descendants, hasClass, quietPage, textOf, waitFor } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { openE3GW0, type E3GWorld } from './helpers/E3G-world.js';
import { planReady } from './helpers/E3P-world.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * E3P PA-01, PA-02 (test sheet e3plan-a-tests §2.1): the Plan rail reads the
 * real Host. W0 has four waiting `goal_cause` cards, two per Goal, and no
 * notice; both rows only read, so they share one W0.
 */

let w: E3GWorld;
beforeAll(async () => { w = await openE3GW0(); }, 120_000);
afterAll(async () => { await w?.world.close(); });

/** The `.row` items of the rail section named `需要你处理`, in document order. */
function inboxRows(root: FakeElement): FakeElement[] {
  const section = findElement(root, (element) => hasClass(element, 'rail-sec')
    && element.getAttribute('aria-label') === '需要你处理');
  return section === undefined ? [] : descendants(section).filter((element) => hasClass(element, 'row'));
}

/** The rail's Goal rows (`.row` carrying `.row-ord`), whatever element the template draws them with. */
function goalRows(root: FakeElement): FakeElement[] {
  const rail = findClass(root, 'rail');
  return rail === undefined ? [] : descendants(rail).filter((element) => hasClass(element, 'row')
    && findClass(element, 'row-ord') !== undefined);
}

/** Sample words of the prototype's own start (its goal, autonomy, phase hint and inbox task). */
const SAMPLE = ['工作台界面改版', '方案确认后自动', '确认目标卡和第一版方案后', '要改目标卡', '检查不完整判定'];

/** What the wired rail and centre show: their text plus every title, placeholder and label. */
function shown(root: FakeElement): string {
  const parts = [findClass(root, 'rail'), findElement(root, (element) => element.tagName.toLowerCase() === 'main')]
    .filter((element): element is FakeElement => element !== undefined);
  return parts.flatMap((part) => [textOf(part), ...descendants(part).flatMap((element) =>
    ['title', 'placeholder', 'aria-label'].map((name) => element.getAttribute(name) ?? ''))]).join('\n');
}

/** The head's title and autonomy label (its second `.head-sub`), and the composer's hint. */
function head(root: FakeElement): { title: string; auto: string; autoTip: string | null; hint: string | null } {
  const bar = findClass(root, 'head');
  const subs = bar === undefined ? [] : descendants(bar).filter((element) => hasClass(element, 'head-sub'));
  const input = findElement(root, (element) => element.getAttribute('id') === 'plan-input');
  return { title: textOf(findClass(root, 'head-title')), auto: textOf(subs[1]), autoTip: subs[1]?.getAttribute('title') ?? null,
    hint: input?.getAttribute('placeholder') ?? null };
}

describe('E3P Plan rail', () => {
  it('PA-S1 with a Host no prototype sample shows: a failed read and a read Goal (merge, lead F8)', async () => {
    const failed = await bootE3N(w.world, 'Plan', { search: '?goal=pa-no-such-goal' });
    try {
      await waitFor(() => failed.page.root.textContent.includes('找不到这个目标。'));
      /* 具名改坏（合并方跑过）: 标题回落成样例的 `base.headTitle`，或自治回落成 `base.autoLabel`；
         这一句红（读失败时画“工作台界面改版”“方案确认后自动”）。 */
      expect(head(failed.page.root)).toEqual({ title: '', auto: '', autoTip: '', hint: '问秘书，或说出你要做的事' });
      for (const word of SAMPLE) expect(shown(failed.page.root)).not.toContain(word);
    } finally {
      await failed.page.restore();
    }
    const { page, log } = await bootE3N(w.world, 'Plan', { search: '?goal=ag2b-goal' });
    try {
      await planReady(log);
      /* 读到目标、没有目标卡草稿：标题是目标的 objective，自治和提示不取样例。 */
      expect(head(page.root)).toEqual({ title: 'S6A goal one', auto: '', autoTip: '', hint: '问秘书，或说出你要做的事' });
      for (const word of SAMPLE) expect(shown(page.root)).not.toContain(word);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('PA-01 需要你决定 counts this Goal’s cards, 请知悉 links to Main on this Goal', async () => {
    const { page, log } = await bootE3N(w.world, 'Plan', { search: '?goal=ag2b-goal' });
    try {
      await planReady(log);
      const rows = inboxRows(page.root);
      expect(rows.map((row) => textOf(findClass(row, 'row-name')))).toEqual(['需要你决定', '请知悉']);
      expect(rows[0]!.tagName.toLowerCase()).toBe('button');
      /* 具名改坏: P01 用工作区总数 `nav.inbox.decideN`；页面显示 4，这一句红。 */
      expect(textOf(findClass(rows[0]!, 'row-meta'))).toBe('2');
      expect(rows[1]!.tagName.toLowerCase()).toBe('a');
      expect(textOf(findClass(rows[1]!, 'row-meta'))).toBe('0');
      /* 具名改坏: 请知悉链接不带 `?goal=`；这一句红。 */
      expect(rows[1]!.getAttribute('href')).toBe('Main.dc.html?goal=ag2b-goal');
      expect(page.assigned()).toEqual([]);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('PA-02 the Goal rows show ordinal and name, mark the current one and link the other to Main', async () => {
    const { page, log } = await bootE3N(w.world, 'Plan', { search: '?goal=ag2b-goal' });
    try {
      await planReady(log);
      const rows = goalRows(page.root);
      expect(rows.map((row) => textOf(findClass(row, 'row-ord')))).toEqual(['1', '2']);
      expect(rows.map((row) => textOf(findClass(row, 'row-name')))).toEqual(['目标 1 · S6A goal one', '目标 2 · S6A goal two']);
      expect(rows[0]!.getAttribute('aria-current')).toBe('true');
      expect(['', null]).toContain(rows[1]!.getAttribute('aria-current'));
      /* 具名改坏: 所有目标行链接都用当前目标；这一句红。 */
      expect(rows[1]!.getAttribute('href')).toBe('Main.dc.html?goal=s6a-goal-2');
      const rail = findElement(page.root, (element) => hasClass(element, 'rail-sec')
        && element.getAttribute('aria-label') === '工作线');
      const lines = rail === undefined ? [] : descendants(rail).filter((element) => element.tagName.toLowerCase() === 'button'
        && hasClass(element, 'row') && hasClass(element, 'wl-row'));
      const dataLine = lines.find((line) => !textOf(findClass(line, 'row-name')).includes('秘书'))!;
      /* 具名改坏: 数据工作线行不画未接通，点了写 `s.line`；下面三句红。 */
      expect(dataLine.getAttribute('aria-disabled')).toBe('true');
      expect(dataLine.getAttribute('title')).toBe('还没接通');
      const calls = log.calls.length;
      click(dataLine);
      await quietPage(log);
      expect(log.calls.length).toBe(calls);
      expect(hasClass(lines.find((line) => textOf(findClass(line, 'row-name')).includes('秘书'))!, 'is-current')).toBe(true);
    } finally {
      await page.restore();
    }
  }, 60_000);
});
