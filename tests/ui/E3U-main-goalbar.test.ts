import { afterEach, describe, expect, it } from 'vitest';
import { findButton, findClass } from './helpers/boot-page.js';
import {
  bootE3N, callsTo, countRoute, goalRowNamed, goalRows, lineRows, mainHeadTitle, onMain, quietPage, textOf, waitFor, whyText,
} from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { cancelGoal, openW1, openWProgress } from './helpers/E3N-world.js';
import { inboxRow, rowMeta } from './helpers/E3D-page.js';
import { openOldAnswerWorld } from './helpers/E3D-world.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { openS6ARequestWorld, S6A_SCOPE, type S6ARequestWorld } from '../helpers/S6A-request-fixture.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * E3U T-A05, T-A11, T-A17, T-A18 (test sheet e3main-a-tests §1.2): the goal
 * bar's progress and working count (A05, A07), 重新入队 as a copy (A10), the
 * rail's local re-sort (L05) and each Goal row's own waiting count (L04, MF13).
 */

const worlds: S6ARequestWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

function lineNames(root: FakeElement): string[] {
  return lineRows(root).map((row) => textOf(findClass(row, 'row-name') ?? row));
}

describe('E3U Main goal bar and rail', () => {
  it.each([
    { entry: 'a project without a Goal', unavailable: undefined, title: '还没有目标' },
    { entry: 'a first read that failed', unavailable: 'main/read', title: '' },
  ])('LEAD-1 the head never names the sample goal: $entry', async ({ unavailable, title }) => {
    const world = await openS6ARequestWorld({ backend: 'memory', defaultGoals: false });
    worlds.push(world);
    await onMain(world, async (page) => {
      /* 具名改坏: `Main.dc.html` 的 `headTitle` 落回 `base.headTitle`；“没有目标”一条红。
         只要没选中目标就写“还没有目标”（不看这次读成没成功）；“读失败”一条红。 */
      expect(mainHeadTitle(page.root)).toBe(title);
    }, { search: '', mode: 'stream', ...(unavailable === undefined ? {} : { unavailable }) });
  }, 120_000);

  it('T-A05 the goal bar counts 1/2 satisfied and one working line', async () => {
    const opened = await openWProgress();
    worlds.push(opened.world);
    const lines = (await opened.world.post('lines/list', plain(S6A_SCOPE, { workspace: S6A_SCOPE }))).body as
      { value: { counts: { working: { value: number } } } };
    expect(lines.value.counts.working.value).toBe(1);
    const { page } = await bootE3N(opened.world, 'Main', { search: `?goal=${opened.goal.goalId}` });
    try {
      /* 具名改坏: `src/ui/adapters/main.ts` 把 `done` 算成 `tasks.length`；“1/2”红（变成“2/2”）。 */
      await waitFor(() => textOf(findClass(page.root, 'gb-item')) === '1/2 已满足');
      expect(whyText(page.root, 'Main')).toBe('1 条工作线工作中');
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('T-A11 重新入队 copies the cancelled Goal and sends no goal control', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    await cancelGoal(opened.world, opened.world.goals.first);
    const { page, log } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal' });
    try {
      await waitFor(() => findButton(findClass(page.root, 'goalbar') ?? page.root, '重新入队') !== undefined);
      click(findButton(findClass(page.root, 'goalbar')!, '重新入队')!);
      /* 具名改坏: `copyGoal` 改调 `goals/control`；`goals/control` 零次红。 */
      await expect.poll(() => callsTo(log, 'goals/copy-confirm').filter((call) => call.reply !== undefined).length,
        { timeout: 8_000, interval: 25 }).toBe(1);
      expect(countRoute(log, 'goals/copy-draft')).toBe(1);
      expect((callsTo(log, 'goals/copy-confirm')[0]!.input as { selectedInterventions: unknown }).selectedInterventions)
        .toEqual([]);
      await waitFor(() => goalRows(page.root).length === 3);
      expect(countRoute(log, 'goals/control')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('T-A17 a new line order is offered, re-sorts only on the click and writes no Goal order', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal' });
    try {
      await waitFor(() => lineRows(page.root).length === 3);
      await quietPage(log);
      expect(lineNames(page.root)).toEqual(['秘书（主对话）', '秘书 1', '执行者']);
      /* The real Host orders lines by `sortKey` (pinned first); a message does not change it, a pin does:
         pinning the executor (the list's second row) puts it before 秘书 1. */
      const rows = (await opened.world.post('lines/list', plain(S6A_SCOPE, { workspace: S6A_SCOPE }))).body as
        { value: { rows: Array<{ key: unknown }> } };
      const registration = (await opened.world.post('workspaces/registration', plain(S6A_SCOPE, { ...S6A_SCOPE }))).body as
        { value: { workspace: { ref: unknown; revision: number } } };
      const pinned = await opened.world.post('lines/pin', graphWrite(S6A_SCOPE, {
        workspace: S6A_SCOPE, add: [rows.value.rows[1]!.key], remove: [],
      }, 'e3u-a17-pin', [{ ref: registration.value.workspace.ref, revision: registration.value.workspace.revision }]));
      expect((pinned.body as { status?: string }).status).toBe('committed');
      await waitFor(() => findButton(page.root, '顺序已变') !== undefined);
      expect(lineNames(page.root)).toEqual(['秘书（主对话）', '秘书 1', '执行者']);
      click(findButton(page.root, '顺序已变')!);
      await waitFor(() => lineNames(page.root)[1] === '执行者');
      expect(lineNames(page.root)).toEqual(['秘书（主对话）', '执行者', '秘书 1']);
      /* 具名改坏: `rail.resort` 改调 `goals/reorder`；零写断言红。 */
      expect(countRoute(log, 'goals/reorder')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('T-A18 each Goal row counts its own waiting cards; the inbox keeps the workspace total', async () => {
    const opened = await openOldAnswerWorld();
    worlds.push(opened.world);
    /* The candidate card and the `initial_plan_pending` card it brings are Goal one's; Goal two has none. */
    const queue = (await opened.world.post('decisions/queue', plain(S6A_SCOPE, { workspace: S6A_SCOPE,
      sections: ['waiting_answer'], page: { limit: 100 } }))).body as
      { value: { waitingAnswer: Array<{ subject: { goalRef?: { goalId: string } } }> } };
    expect(queue.value.waitingAnswer.map((entry) => entry.subject.goalRef?.goalId)).toEqual(['ag2b-goal', 'ag2b-goal']);
    const { page } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal' });
    try {
      await waitFor(() => goalRows(page.root).length === 2);
      /* 具名改坏: `Main.dc.html` 的 `goals` 不按 `nBy[goalId]` 覆盖、沿用底座的 `n:0`；第一行的“2”红。 */
      await waitFor(() => rowMeta(goalRowNamed(page.root, 'S6A goal one')) === '2');
      expect(findClass(goalRowNamed(page.root, 'S6A goal two')!, 'row-meta')).toBeUndefined();
      expect(rowMeta(inboxRow(page.root, '需要你决定'))).toBe('2');
    } finally {
      await page.restore();
    }
  }, 60_000);
});
