import { afterEach, describe, expect, it } from 'vitest';
import { findButton, findClass, findElement } from './helpers/boot-page.js';
import { bootE3N, countRoute, textOf } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { openW1, openW4 } from './helpers/E3N-world.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { S6ARequestWorld } from '../helpers/S6A-request-fixture.js';

/**
 * E3W N30–N33 (run sheet §2.4): the goal bar's pause/resume/cancel over
 * `goals/control`, the two `meta.expected` pins and the non-zero GoalPhase
 * revision a completed old Plan leaves behind. The page's own button is the
 * only entry; the request body is what the page sent.
 */

const worlds: S6ARequestWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

type Call = { body: unknown; input: unknown };

function expectedOf(call: Call | undefined): unknown {
  return (call?.body as { request?: { meta?: { expected?: unknown } } })?.request?.meta?.expected;
}

async function controlCall(log: { calls: Array<{ route: string }> }, n: number): Promise<Call & { route: string }> {
  await expect.poll(() => log.calls.filter((call) => call.route === 'goals/control').length,
    { timeout: 10_000, interval: 25 }).toBe(n);
  return log.calls.filter((call) => call.route === 'goals/control').at(-1)! as Call & { route: string };
}

async function pause(goalbar: ReturnType<typeof findButton>): Promise<void> {
  expect(goalbar).toBeDefined();
  click(goalbar!);
}

function pins(projectId: string, goalId: string, goalRevision: number, phaseRevision: number): unknown {
  return [
    { ref: { aggregateType: 'Goal', projectId, goalId }, revision: goalRevision },
    { ref: { aggregateType: 'GoalPhase', projectId, goalId }, revision: phaseRevision },
  ];
}

describe('E3N-4 goal control', () => {
  it('N30 pause sends both pins at the Goal revision 1 and GoalPhase 0', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal' });
    try {
      await pause(findButton(page.root, '暂停'));
      /* 具名改坏: 目标栏写入口删掉 `GoalPhase` 那一项；Host 回 `invalid`，
         N30 的 `committed` 和 `meta.expected` 两条红。 */
      const call = await controlCall(log, 1);
      expect((call.input as { control?: unknown }).control).toBe('pause');
      expect((call.input as { reason?: unknown }).reason).toBeNull();
      expect(expectedOf(call)).toEqual(pins(opened.world.scope.projectId, 'ag2b-goal', 1, 0));
      await expect.poll(() => page.root.textContent.includes('已暂停'), { timeout: 10_000, interval: 25 }).toBe(true);
      expect(findButton(page.root, '继续')).toBeDefined();
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('N31 resume sends Goal revision 2 and the same GoalPhase pin', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal' });
    try {
      await pause(findButton(page.root, '暂停'));
      await controlCall(log, 1);
      const goalbar = findClass(page.root, 'goalbar')!;
      await expect.poll(() => findButton(goalbar, '继续') !== undefined, { timeout: 10_000, interval: 25 }).toBe(true);
      click(findButton(goalbar, '继续')!);
      /* 具名改坏: 继续时复用旧 pins（Goal@1）；Host 回 `revision_conflict`，
         N31 的 `committed` 和 `revision===2` 红。 */
      const call = await controlCall(log, 2);
      expect((call.input as { control?: unknown }).control).toBe('resume');
      const expected = expectedOf(call) as Array<{ revision: number }>;
      expect(expected[0]!.revision).toBe(2);
      expect(expected[1]).toEqual({
        ref: { aggregateType: 'GoalPhase', projectId: opened.world.scope.projectId, goalId: 'ag2b-goal' }, revision: 0,
      });
      await expect.poll(() => !page.root.textContent.includes('已暂停'), { timeout: 10_000, interval: 25 }).toBe(true);
      expect(findButton(page.root, '暂停')).toBeDefined();
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('N32 cancel asks first, sends nothing until the confirmation and pins Goal revision 3', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal' });
    try {
      await pause(findButton(page.root, '暂停'));
      await controlCall(log, 1);
      const goalbar = findClass(page.root, 'goalbar')!;
      await expect.poll(() => findButton(goalbar, '继续') !== undefined, { timeout: 10_000, interval: 25 }).toBe(true);
      click(findButton(goalbar, '继续')!);
      await controlCall(log, 2);
      await expect.poll(() => findButton(goalbar, '暂停') !== undefined, { timeout: 10_000, interval: 25 }).toBe(true);

      click(findButton(goalbar, '取消')!);
      expect(countRoute(log, 'goals/control')).toBe(2);
      /* 具名改坏: “取消”的 `onClick` 从 `gb.askCancel` 改成 `gb.cancel`；
         N32 的“第一次点击后请求数 0”红。 */
      expect(findElement(page.root, (element) => element.getAttribute('role') === 'alertdialog')).toBeDefined();
      click(findButton(page.root, '不取消')!);
      expect(countRoute(log, 'goals/control')).toBe(2);

      click(findButton(goalbar, '取消')!);
      const confirm = findButton(page.root, '取消目标');
      expect(confirm).toBeDefined();
      click(confirm!);
      const call = await controlCall(log, 3);
      expect((call.input as { control?: unknown }).control).toBe('cancel');
      expect(expectedOf(call)).toEqual(pins(opened.world.scope.projectId, 'ag2b-goal', 3, 0));
      await expect.poll(() => page.root.textContent.includes('已取消'), { timeout: 10_000, interval: 25 }).toBe(true);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('N33 a completed old Plan leaves GoalPhase revision 1 and pause pins it', async () => {
    const opened = await openW4();
    worlds.push(opened.world);
    const goal = opened.goal;
    const read = await opened.world.post('goals/read', plain(opened.world.scope, goal));
    const revision = (read.body as { value: { goal: { revision: number } } }).value.goal.revision;
    const graph = await opened.world.post('tasks/query', plain(opened.world.scope, { goalRef: goal }));
    expect((graph.body as { value: { completion: { snapshot: { revision: number } } } })
      .value.completion.snapshot.revision).toBe(1);
    const { page, log } = await bootE3N(opened.world, 'Main', { search: `?goal=${goal.goalId}` });
    try {
      expect(countRoute(log, 'tasks/query')).toBeGreaterThanOrEqual(1);
      const goalbar = findClass(page.root, 'goalbar');
      expect(goalbar).toBeDefined();
      expect(goalbar!.textContent).not.toBe('');
      await pause(findButton(page.root, '暂停'));
      /* 具名改坏: 页面把 GoalPhase 版本写死成 0；N33 的 `revision:1` 红。
         把 `tasks/query` 的 `completion` 读删掉、只发 Goal；Host 回 `invalid`，`committed` 红。 */
      const call = await controlCall(log, 1);
      const expected = expectedOf(call) as Array<{ revision: number }>;
      expect(expected[0]!.revision).toBe(revision);
      expect(expected[1]).toEqual({
        ref: { aggregateType: 'GoalPhase', projectId: goal.projectId, goalId: goal.goalId }, revision: 1,
      });
      await expect.poll(() => page.root.textContent.includes('已暂停'), { timeout: 10_000, interval: 25 }).toBe(true);
      expect(textOf(findClass(page.root, 'goalbar'))).toContain('已暂停');
    } finally {
      await page.restore();
    }
  }, 120_000);
});
