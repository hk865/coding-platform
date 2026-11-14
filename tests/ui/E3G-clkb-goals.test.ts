import { afterEach, describe, expect, it } from 'vitest';
import {
  auxTab, bootE3N, callsTo, countRoute, hasClass, quietPage, textOf, turns,
} from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { boardUrlOf, findButtonByLabel, findClass, findElement, findLink } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import {
  decideConflict, e3gConflictOptions, e3gConflictSection, e3gGoalPins, e3gGoalRows,
  openE3GGoals, openE3GW1, type E3GWorld,
} from './helpers/E3G-world.js';
import { openPAW1, planReady } from './helpers/E3P-world.js';
import { completeS7BGoal } from '../helpers/S7B-V-fixture.js';
import { openS7BPlanningWorld } from '../helpers/S7B3-planning-world.js';

/**
 * E3G CLKB: the five Goals click-inventory rows still listed as untested
 * (`clk-current.md` §3 package 5). Every row opens a real Host world, drives
 * the working-copy page through the fake DOM and asserts the DOM or the page's
 * own request; the expected words are the behavior table's, not the page's.
 */

const worlds: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

function conflictCard(root: FakeElement): FakeElement | undefined {
  const section = e3gConflictSection(root);
  return section === undefined ? undefined : findElement(section, (element) => element.tagName.toLowerCase() === 'section'
    && hasClass(element, 'plan'));
}

/** The conflict section once the page has drawn it. */
function conflictSectionOf(root: FakeElement): FakeElement {
  const section = e3gConflictSection(root);
  expect(section).toBeDefined();
  return section!;
}

describe('E3G CLKB Goals rows', () => {
  it('P07-7/P19-6 接受风险并行 puts 与 <the other Goal> 并行，已接受风险 on both Goal rows', async () => {
    const opened = await openE3GW1();
    worlds.push(opened.world);
    const { page } = await openE3GGoals(opened.world, `?goal=${opened.world.goals.first.goalId}`);
    try {
      await turns(() => e3gConflictOptions(page.root).length === 3, 3_000);
      await decideConflict(page, 2);
      const firstLabel = `与 ${opened.world.goals.second.goalId} 并行，已接受风险`;
      const secondLabel = `与 ${opened.world.goals.first.goalId} 并行，已接受风险`;
      await turns(() => textOf(conflictSectionOf(page.root)).includes('已接受并行风险'), 3_000);
      /* The card's own done line keeps both labels; this half is green today. */
      expect(textOf(findClass(conflictSectionOf(page.root), 'plan-line'))).toContain(firstLabel);
      expect(textOf(findClass(conflictSectionOf(page.root), 'plan-line'))).toContain(secondLabel);
      /* 具名改坏: `goals.ts` 不把 labelByGoal 拼进 `line`；下面两行断言红。 */
      const rows = e3gGoalRows(page.root);
      expect(rows).toHaveLength(2);
      expect(textOf(rows[0]!)).toContain(firstLabel);
      expect(textOf(rows[1]!)).toContain(secondLabel);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('P16-6 the Goals 整页查看 link keeps the current Goal in the TaskMap address', async () => {
    const opened = await openE3GW1();
    worlds.push(opened.world);
    const { page } = await openE3GGoals(opened.world, `?goal=${opened.world.goals.second.goalId}`);
    try {
      const tab = auxTab(page.root, '任务图');
      expect(tab).toBeDefined();
      click(tab!);
      await turns(() => tab!.getAttribute('aria-selected') === 'true', 800);
      const link = findLink(page.root, '整页查看', 'TaskMap.dc.html');
      expect(link).toBeDefined();
      /* 具名改坏: `boot.ts` 的 Goals 不在 TaskMap 链接改写列表；本行的 goal 断言红。 */
      const url = boardUrlOf(link!.getAttribute('href'), 'Goals.dc.html');
      expect(url.pathname).toBe('/workbench/TaskMap.dc.html');
      expect(url.searchParams.get('goal')).toBe(opened.world.goals.second.goalId);
      expect(page.assigned()).toEqual([]);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('P16-6 the Plan 整页查看 link keeps the current Goal in the TaskMap address', async () => {
    const w = await openPAW1();
    worlds.push(w.world);
    const { page, log } = await bootE3N(w.world, 'Plan', { search: `?goal=${w.world.goals.first.goalId}` });
    await planReady(log);
    try {
      const link = findLink(page.root, '整页查看', 'TaskMap.dc.html');
      expect(link).toBeDefined();
      /* 具名改坏: `boot.ts` 的 Plan 不在 TaskMap 链接改写列表；本行的 goal 断言红。 */
      const url = boardUrlOf(link!.getAttribute('href'), 'Plan.dc.html');
      expect(url.pathname).toBe('/workbench/TaskMap.dc.html');
      expect(url.searchParams.get('goal')).toBe(w.world.goals.first.goalId);
      expect(page.assigned()).toEqual([]);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('P19-8 after 接受风险并行, moving a Goal up rereads goals/conflicts and keeps both labels with no card', async () => {
    const opened = await openE3GW1();
    worlds.push(opened.world);
    const { page, log } = await openE3GGoals(opened.world, `?goal=${opened.world.goals.first.goalId}`, 'controlled');
    try {
      await turns(() => e3gConflictOptions(page.root).length === 3, 3_000);
      await decideConflict(page, 2);
      await turns(() => textOf(conflictSectionOf(page.root)).includes('已接受并行风险'), 3_000);
      /* No change events in controlled mode: the answer's own rereads are the
         only ones, so a quiet log is this row's baseline. */
      await quietPage(log);
      const pins = await e3gGoalPins(opened.world);
      const reads = countRoute(log, 'goals/conflicts');
      const writes = countRoute(log, 'goals/reorder');
      const up = findButtonByLabel(e3gGoalRows(page.root)[1]!, '上移');
      expect(up).toBeDefined();
      click(up!);
      await turns(() => countRoute(log, 'goals/reorder') === writes + 1, 3_000);
      await turns(() => countRoute(log, 'goals/conflicts') === reads + 1, 3_000);
      /* 具名改坏: `boot.ts:495` 的 `await refresh.reread()` 去掉；本行的 `goals/conflicts` 次数与 DOM 顺序红。 */
      const call = callsTo(log, 'goals/reorder')[0]!;
      expect(call.input).toEqual({ workspace: opened.world.scope,
        goalOrder: [opened.world.goals.second, opened.world.goals.first] });
      expect((call.body as { request: { meta: { expected: unknown } } }).request.meta.expected)
        .toEqual([pins[1], pins[0]]);
      await turns(() => textOf(findClass(e3gGoalRows(page.root)[0]!, 'row-name')) === 'S6A goal two', 3_000);
      expect(findClass(e3gGoalRows(page.root)[0]!, 'row-name')).toBeDefined();
      /* The accepted risk survives the order change: both pointer labels are still
         in `goals/conflicts` and the page draws them; no card reopens. */
      expect(conflictCard(page.root)).toBeUndefined();
      const done = textOf(findClass(conflictSectionOf(page.root), 'plan-line'));
      expect(done).toContain('已接受并行风险');
      expect(done).toContain(`与 ${opened.world.goals.second.goalId} 并行，已接受风险`);
      expect(done).toContain(`与 ${opened.world.goals.first.goalId} 并行，已接受风险`);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('P20-8 the completed Goal row still shows 已完成 and its satisfied state', async () => {
    const planning = await openS7BPlanningWorld();
    worlds.push(planning.world);
    /* `openE3GW2`'s "earlier Goal is COMPLETED" is not true in this tree: its next
       Plan adoption after the completion leaves `goals/display` at RUNNING (the
       list phase is null and the read says RUNNING). Use the two-Goal planning
       world and complete its first Goal, the same public Workflow helper. */
    await completeS7BGoal(planning);
    const { page, log } = await openE3GGoals(planning.world, `?goal=${planning.goalRef.goalId}`);
    try {
      const rows = e3gGoalRows(page.root);
      expect(rows).toHaveLength(2);
      const listed = callsTo(log, 'goals/list')[0]!.reply as
        { value?: { goals?: Array<{ ref?: { goalId?: string }; display?: { phase?: string } }> } };
      const row = listed.value?.goals?.find((goal) => goal.ref?.goalId === planning.goalRef.goalId);
      expect(row?.display?.phase).toBe('COMPLETED');
      /* 具名改坏: `src/ui/adapters/goals.ts:468` 把 `goal.displayPhase` 换成 `null`；本行的“已完成”和 `s-satisfied` 红。 */
      expect(textOf(findClass(rows[0]!, 'gx-line'))).toContain('已完成');
      expect(findClass(rows[0]!, 'sq')!.getAttribute('class') ?? '').toContain('s-satisfied');
      expect(textOf(findClass(rows[1]!, 'gx-line'))).not.toContain('已完成');
    } finally {
      await page.restore();
    }
  }, 60_000);
});
