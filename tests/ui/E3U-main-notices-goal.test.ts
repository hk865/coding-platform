import { afterEach, describe, expect, it } from 'vitest';
import { findClass, findElement } from './helpers/boot-page.js';
import {
  callsTo, goalRows, hasClass, mainHeadTitle, onMain, pickTab, textOf, treeNames,
} from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { card, cardTitle, inboxRow, labelled, rowMeta } from './helpers/E3D-page.js';
import { openE3GW1 } from './helpers/E3G-world.js';
import { seePlanAdoptions } from './helpers/E3D-world.js';
import { openS6ANoticesWorld } from '../helpers/S6A-cards-fixture.js';

/**
 * CLKA package 2 (run sheet 7d2-clka): the Main page's automatic-rework notice
 * and a Goal pick's task graph.
 *
 * P06-7/P14-7 (click list Main, UI-WORKBENCH decision 42): an automatic rework
 * of a Goal folds to one line under that Goal, e.g.
 * `自动返工 · <task> · 第 n 次（n/3）`, and the same item is in 请知悉. The
 * producer writes that summary (`src/core/work-graph/views/automatic-rework-
 * notices.ts:599`); the fixtures' three reworks are all first reworks, so the
 * hand-computed literal is 第 1 次（1/3）, and the third one names goal 1's own
 * second task (`s6a-cards-work-2`), unique to that Goal.
 *
 * P21-2 (click list Main/TaskMap): a rail Goal pick, then the 任务图 tab, shows
 * that Goal's tasks; `goals/read` and `tasks/query` name the picked Goal.
 */

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

describe('E3U Main notices and the picked Goal’s task graph', () => {
  it('P06-7/P14-7 an automatic rework folds under its Goal and is also in 请知悉', async () => {
    const opened = await openS6ANoticesWorld({ backend: 'memory' });
    closers.push(() => opened.close());
    const seeded = await opened.seedReworkNotices();
    /* The two Plan adoptions are their own notices; marking them seen leaves the
       three automatic reworks as the 请知悉 queue, in the fixture's order. */
    await seePlanAdoptions(opened.main, 'clka-p2-main');
    const third = seeded.notices[2]!;
    const fold = '自动返工 · s6a-cards-work-2 · 第 1 次（1/3）';
    expect(third.notice.summary).toBe(fold);
    /* `main/read` folds every automatic rework of one Goal into one line whose
       `summary` counts them (slice-6-SPEC L6 `:202`, `notice-grouping.ts:168`);
       the rail shows that folded line, not its members. */
    const railFold = '2 条自动返工';

    await onMain(opened.world, async (page, log) => {
      expect(rowMeta(inboxRow(page.root, '请知悉'))).toBe('3');
      click(inboxRow(page.root, '请知悉')!);
      await expect.poll(() => cardTitle(page.root), { timeout: 10_000, interval: 25 }).not.toBe('');
      /* The queue orders goal 1, goal 2, goal 1; 下一条 reaches the third. */
      click(labelled(card(page.root), '下一条')!);
      click(labelled(card(page.root), '下一条')!);
      await expect.poll(() => cardTitle(page.root), { timeout: 10_000, interval: 25 }).toBe(fold);
      expect(textOf(findClass(card(page.root)!, 'lvl'))).toBe('请知悉');

      /* 页面错，已修：`MainPageV1` 原先丢了 `main/read` 的 `notices`，
         `adaptMain` 也丢掉它们，`Main.dc.html` 的目标区因此不画折叠行。
         依据：slice-6-SPEC.md:202 的 L6 要求“按目标折叠（自动返工的通知
         折成一条‘n 条自动返工’，点开看）”，`notice-grouping.ts:168` 给出这一行。 */
      const rail = findClass(page.root, 'rail');
      expect(rail).toBeDefined();
      const selectedRow = goalRows(page.root).find((row) => hasClass(row, 'is-on'));
      expect(selectedRow).toBeDefined();
      expect(findElement(selectedRow!, (element) => textOf(element) === railFold)).toBeDefined();
    }, { search: `?goal=${opened.world.goals.first.goalId}` });
  }, 180_000);

  it('P21-2 picking the second Goal switches the 任务图 tree and its task read', async () => {
    const opened = await openE3GW1();
    closers.push(() => opened.world.close());
    const first = 'Independent work e3g-one-work';
    const second = 'Independent work e3g-two-work';
    await onMain(opened.world, async (page, log) => {
      const rows = goalRows(page.root);
      expect(rows).toHaveLength(2);
      expect(textOf(findClass(rows[1]!, 'row-ord'))).toBe('2');
      click(rows[1]!);
      await expect.poll(() => mainHeadTitle(page.root), { timeout: 10_000, interval: 25 })
        .toBe('S6A goal two');
      await pickTab(page, log, '任务图');
      /* 具名改坏: `src/ui/boot.ts` 的 `readNav` 用 `goals.goals[0]` 的 Goal 读
         `tasks/query`，不读 `selected`；任务图仍画目标 1 的任务，这一句红。 */
      expect(treeNames(page.root)).toContain(second);
      expect(treeNames(page.root)).not.toContain(first);
      const graph = callsTo(log, 'tasks/query').at(-1)!;
      expect((graph.input as { goalRef: { goalId: string } }).goalRef.goalId)
        .toBe(opened.world.goals.second.goalId);
      const read = callsTo(log, 'goals/read').at(-1)!;
      expect((read.input as { goalId: string }).goalId).toBe(opened.world.goals.second.goalId);
      expect((read.reply as { value?: { ordinal?: unknown } }).value?.ordinal).toBe(2);
      expect(page.assigned()).toEqual([]);
    }, { search: `?goal=${opened.world.goals.first.goalId}` });
  }, 180_000);
});
