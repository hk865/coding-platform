import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { findButton, findClass, findAllClass } from './helpers/boot-page.js';
import { bootE3N, callsTo, countRoute, quietPage, textOf, waitFor, whyText } from './helpers/E3N-page.js';
import { click, pressKey } from './helpers/E3N-interact.js';
import { openW1 } from './helpers/E3N-world.js';
import { cleanupScenarios } from '../scenarios/harness.js';
import { claimedRun, startHost } from '../scenarios/support/control.js';
import { post } from '../helpers/A2-restart-fixture.js';
import {
  AG2B_GOAL_REF, AG2B_SCOPE, AG2B_WORK_TASK_ID, graphWrite, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import type { AG2bHost } from '../helpers/AG2b-collaboration-fixture.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { TaskGraph } from '../../src/contracts/task-graph.js';
import {
  cancelS7AGoal, openS7AWorkWorld, runS7ASameSessionAgain, seedS7AGoalPlan,
} from '../helpers/S7A-fixture.js';
import { sendS7A2PersonMessage, withdrawS7A2Message } from '../helpers/S7A2-fixture.js';
import type { S6ARequestWorld } from '../helpers/S6A-request-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';

/**
 * 4b G1–G5: the Goal bar's reason and hover, the control receipt and its
 * refusals, the cancel confirmation's affected Runs and the two-step requeue.
 */

const worlds: S6ARequestWorld[] = [];
const hosts: AG2bHost[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
  for (const host of hosts.splice(0)) await host.host.close();
});
afterAll(async () => { await cleanupScenarios(); });

async function workTitle(host: AG2bHost): Promise<string> {
  const read = await post<ReadResult<TaskGraph>>(host, 'tasks/query', plain(AG2B_SCOPE, { goalRef: AG2B_GOAL_REF }));
  if (read.status !== 'ready') throw new Error('the task graph must be readable');
  const row = read.value.tasks.find((task) => task.ref.taskId === AG2B_WORK_TASK_ID);
  if (row === undefined) throw new Error('the work Task must be in the graph');
  return row.definition.title;
}

async function controlCount(log: { calls: Array<{ route: string }> }, n: number): Promise<void> {
  await expect.poll(() => log.calls.filter((call) => call.route === 'goals/control').length,
    { timeout: 10_000, interval: 25 }).toBe(n);
}

function sysTexts(root: Parameters<typeof findAllClass>[0]): string[] {
  return findAllClass(root, 'sys-line').map((row) => textOf(row));
}

describe('4b goal control receipts', () => {
  it('① pause writes the receipt and the reason line is 只读可用', async () => {
    const host = await startHost();
    hosts.push(host);
    await claimedRun(host, 'e3u-4b-pause', { database: host.database });
    const title = await workTitle(host);
    const { page, log } = await bootE3N(host, 'Main', { search: '?goal=ag2b-goal' });
    try {
      await waitFor(() => findButton(findClass(page.root, 'goalbar')!, '暂停') !== undefined);
      click(findButton(findClass(page.root, 'goalbar')!, '暂停')!);
      await controlCount(log, 1);
      /* 具名改坏: `goalControlReportOf` 的暂停表头删掉“各执行的情况：”；首行断言红。 */
      await expect.poll(() => sysTexts(page.root).some((text) => text.includes('暂停目标：新的领取、进入和检查已停下。各执行的情况：')),
        { timeout: 10_000, interval: 25 }).toBe(true);
      expect(sysTexts(page.root).some((text) => text.includes(`「${title}」：已送去暂停`))).toBe(true);
      expect(whyText(page.root, 'Main')).toBe('只读可用');
      /* 具名改坏: `goalBarTextOf` 的暂停支路写回“已暂停”；这条红。 */
      const why = findClass(page.root, 'gb-why')!;
      expect(why.getAttribute('title')).toContain('暂停期间仍可问一问');
      expect(why.getAttribute('title')).toContain(`「${title}」：已暂停`);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('② resume replaces the receipt with the not-entered branch and leaves no 已暂停', async () => {
    const host = await startHost();
    hosts.push(host);
    await claimedRun(host, 'e3u-4b-resume', { database: host.database });
    const title = await workTitle(host);
    const { page, log } = await bootE3N(host, 'Main', { search: '?goal=ag2b-goal' });
    try {
      await waitFor(() => findButton(findClass(page.root, 'goalbar')!, '暂停') !== undefined);
      click(findButton(findClass(page.root, 'goalbar')!, '暂停')!);
      await controlCount(log, 1);
      /* The in-flight guard keeps the bar busy until the pause's own reread settles. */
      await quietPage(log);
      await waitFor(() => findButton(findClass(page.root, 'goalbar')!, '继续') !== undefined);
      click(findButton(findClass(page.root, 'goalbar')!, '继续')!);
      await controlCount(log, 2);
      /* 具名改坏: 继续回执不读 `controls/read`（`entered` 空）；这一行红。 */
      await expect.poll(() => sysTexts(page.root).some((text) => text.includes('继续目标。各执行的情况：')),
        { timeout: 10_000, interval: 25 }).toBe(true);
      await expect.poll(() => sysTexts(page.root).some((text) => text.includes(`「${title}」：原执行还没进入，恢复已排队`)),
        { timeout: 10_000, interval: 25 }).toBe(true);
      /* 具名改坏: 观察句追加成第二行；`runRows` 长度 2，本行红。 */
      const runRows = sysTexts(page.root).filter((text) => text.includes(`「${title}」`));
      expect(runRows).toHaveLength(1);
      expect(runRows[0]).toContain('原执行还没进入，恢复已排队');
      expect(sysTexts(page.root).some((text) => text.includes(`「${title}」：已送去恢复`))).toBe(false);
      expect(page.root.textContent.includes('已暂停')).toBe(false);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('③ a refused pause says 目标已经暂停了 in the composer note', async () => {
    const opened = await openW1();
    worlds.push(opened.world);
    const goal = opened.world.goals.first;
    const { page, log } = await bootE3N(opened.world, 'Main', { mode: 'controlled', search: '?goal=ag2b-goal' });
    try {
      await quietPage(log);
      await waitFor(() => findButton(findClass(page.root, 'goalbar')!, '暂停') !== undefined);
      const read = await opened.world.post('goals/read', plain(S6A_SCOPE, goal));
      const revision = (read.body as { value: { goal: { revision: number } } }).value.goal.revision;
      const phase = { aggregateType: 'GoalPhase', projectId: goal.projectId, goalId: goal.goalId } as const;
      const paused = await opened.world.post('goals/control', graphWrite(S6A_SCOPE, {
        goalRef: goal, control: 'pause', reason: null,
      }, 'e3u-4b-pause-route', [{ ref: goal, revision }, { ref: phase, revision: 0 }]));
      expect((paused.body as { status?: string }).status).toBe('committed');
      click(findButton(findClass(page.root, 'goalbar')!, '暂停')!);
      await controlCount(log, 2);
      /* 具名改坏: `goalControlTextOf` 的 busy 支路删掉；脚注回“写入失败。”，这一条红。 */
      await expect.poll(() => page.root.textContent.includes('目标已经暂停了。'), { timeout: 10_000, interval: 25 })
        .toBe(true);
    } finally {
      await page.restore();
    }
  }, 60_000);

  it('④ the cancel confirmation lists the Runs that will stop and 不取消 sends nothing', async () => {
    const host = await startHost();
    hosts.push(host);
    await claimedRun(host, 'e3u-4b-cancel', { database: host.database });
    const title = await workTitle(host);
    const { page, log } = await bootE3N(host, 'Main', { search: '?goal=ag2b-goal' });
    try {
      await waitFor(() => findButton(findClass(page.root, 'goalbar')!, '取消') !== undefined);
      click(findButton(findClass(page.root, 'goalbar')!, '取消')!);
      /* 具名改坏: 取消确认删掉 `gb.hasLive` 那一行；这一条红。 */
      await waitFor(() => page.root.textContent.includes(`会停下的执行：「${title}」`));
      expect(countRoute(log, 'goals/control')).toBe(0);
      click(findButton(page.root, '不取消')!);
      expect(countRoute(log, 'goals/control')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('⑤ requeue reads the draft, ticks one intervention and copies with that ref', async () => {
    const opened = await openS7AWorkWorld({ backend: 'memory' });
    worlds.push(opened.world);
    const source = await seedS7AGoalPlan(opened.world);
    const a = await sendS7A2PersonMessage(opened.world, { label: 's7b3-a', recipient: opened.line.ref, goal: source.goal });
    opened.world.clock.advance(1000);
    const b = await sendS7A2PersonMessage(opened.world, { label: 's7b3-b', recipient: opened.line.ref, goal: source.goal });
    await runS7ASameSessionAgain(opened.world, opened.line);
    await cancelS7AGoal(opened.world, source.goal);
    const { page, log } = await bootE3N(opened.world, 'Main', { search: `?goal=${source.goal.goalId}` });
    try {
      await waitFor(() => findButton(findClass(page.root, 'goalbar')!, '重新入队') !== undefined);
      click(findButton(findClass(page.root, 'goalbar')!, '重新入队')!);
      await waitFor(() => findAllClass(page.root, 'dc-check').length === 2);
      expect(countRoute(log, 'goals/copy-draft')).toBe(1);
      expect(countRoute(log, 'goals/copy-confirm')).toBe(0);
      const labels = findAllClass(page.root, 'dc-check');
      expect(labels.map((label) => textOf(label)).map((text) => text.split('（')[0]))
        .toEqual(['S7A2 s7b3-a message', 'S7A2 s7b3-b message']);
      const first = labels[0]!;
      const input = Array.from(first.childNodes).find((node) => node instanceof Object && (node as { tagName?: string }).tagName?.toLowerCase() === 'input') as unknown as {
        dispatch(type: string, event: unknown): void;
      } | undefined;
      if (input === undefined) throw new Error('the first candidate has no checkbox');
      input.dispatch('change', { target: input, currentTarget: input });
      click(findButton(page.root, '复制成新目标')!);
      await expect.poll(() => callsTo(log, 'goals/copy-confirm').filter((call) => call.reply !== undefined).length,
        { timeout: 10_000, interval: 25 }).toBe(1);
      const call = callsTo(log, 'goals/copy-confirm')[0]!;
      expect((call.input as { selectedInterventions: unknown }).selectedInterventions).toEqual([a.ref]);
      expect((call.input as { expectedSourceRevision: number }).expectedSourceRevision)
        .toBe((callsTo(log, 'goals/copy-draft')[0]!.reply as { value: { source: { revision: number } } }).value.source.revision);
      await expect.poll(() => page.root.textContent.includes('已复制成新目标。'), { timeout: 10_000, interval: 25 }).toBe(true);
      expect(b.ref).toBeDefined();
      expect(countRoute(log, 'goals/control')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('⑥ two pause clicks in one turn send exactly one goals/control', async () => {
    const host = await startHost();
    hosts.push(host);
    await claimedRun(host, 'e3u-4b-busy', { database: host.database });
    const { page, log } = await bootE3N(host, 'Main', { search: '?goal=ag2b-goal' });
    try {
      await waitFor(() => findButton(findClass(page.root, 'goalbar')!, '暂停') !== undefined);
      const pause = findButton(findClass(page.root, 'goalbar')!, '暂停')!;
      /* 具名改坏: `control` 去掉 ctlBusy 守卫；连点发两次，次数断言红。 */
      click(pause);
      click(pause);
      await quietPage(log);
      expect(countRoute(log, 'goals/control')).toBe(1);
    } finally {
      await page.restore();
    }
  });

  it('⑦ the requeue dialog focuses 不复制 and Esc returns focus to 重新入队', async () => {
    const opened = await openS7AWorkWorld({ backend: 'memory' });
    worlds.push(opened.world);
    const source = await seedS7AGoalPlan(opened.world);
    await sendS7A2PersonMessage(opened.world, { label: 's7b3-a', recipient: opened.line.ref, goal: source.goal });
    opened.world.clock.advance(1000);
    await sendS7A2PersonMessage(opened.world, { label: 's7b3-b', recipient: opened.line.ref, goal: source.goal });
    await runS7ASameSessionAgain(opened.world, opened.line);
    await cancelS7AGoal(opened.world, source.goal);
    const { page, log } = await bootE3N(opened.world, 'Main', { search: `?goal=${source.goal.goalId}` });
    try {
      await waitFor(() => findButton(findClass(page.root, 'goalbar')!, '重新入队') !== undefined);
      click(findButton(findClass(page.root, 'goalbar')!, '重新入队')!);
      await waitFor(() => findAllClass(page.root, 'dc-check').length === 2);
      const keep = findButton(page.root, '不复制')!;
      /* 具名改坏: 打开确认框时不把焦点移到“不复制”；本行超时红。 */
      await waitFor(() => (document.activeElement as unknown) === keep);
      expect(document.activeElement as unknown).toBe(keep);
      pressKey(keep, 'Escape');
      await waitFor(() => findButton(page.root, '不复制') === undefined);
      expect(document.activeElement).toBe(findButton(findClass(page.root, 'goalbar')!, '重新入队'));
      expect(countRoute(log, 'goals/copy-confirm')).toBe(0);
    } finally {
      await page.restore();
    }
  });

  it('⑧ a revision conflict rereads the copy draft and the second click commits', async () => {
    const opened = await openS7AWorkWorld({ backend: 'memory' });
    worlds.push(opened.world);
    const source = await seedS7AGoalPlan(opened.world);
    await sendS7A2PersonMessage(opened.world, { label: 's7b3-a', recipient: opened.line.ref, goal: source.goal });
    opened.world.clock.advance(1000);
    await sendS7A2PersonMessage(opened.world, { label: 's7b3-b', recipient: opened.line.ref, goal: source.goal });
    await runS7ASameSessionAgain(opened.world, opened.line);
    opened.world.clock.advance(1000);
    const third = await sendS7A2PersonMessage(opened.world, { label: 's7b3-c', recipient: opened.line.ref, goal: source.goal });
    await cancelS7AGoal(opened.world, source.goal);
    const { page, log } = await bootE3N(opened.world, 'Main', {
      search: `?goal=${source.goal.goalId}`,
      rejectOnce: {
        route: 'goals/copy-confirm', code: 'revision_conflict', reason: 'e3u-4b: the source revision moved',
      },
    });
    try {
      await waitFor(() => findButton(findClass(page.root, 'goalbar')!, '重新入队') !== undefined);
      click(findButton(findClass(page.root, 'goalbar')!, '重新入队')!);
      await waitFor(() => findAllClass(page.root, 'dc-check').length === 3);
      /* The first draft is stale after this public withdrawal: the reread must
         replace the dialog's checks, not only the revision field. */
      await withdrawS7A2Message(opened.world, third, 'e3u-4b-conflict');
      click(findButton(page.root, '复制成新目标')!);
      await waitFor(() => page.root.textContent.includes('原目标刚变过，已重新读取，请再确认一次。'));
      expect(findButton(page.root, '复制成新目标')).toBeDefined();
      await waitFor(() => countRoute(log, 'goals/copy-draft') === 2);
      /* 具名改坏: catch 不换 copyDraft（保留旧勾选）；第二份 draft 的“已撤回”不出现，本行超时红。 */
      await waitFor(() => findAllClass(page.root, 'dc-check')
        .some((label) => textOf(label).includes('（已撤回）')));
      click(findButton(page.root, '复制成新目标')!);
      await waitFor(() => callsTo(log, 'goals/copy-confirm').filter((call) => call.reply !== undefined).length === 2);
      const calls = callsTo(log, 'goals/copy-confirm');
      const secondDraft = callsTo(log, 'goals/copy-draft')[1]!.reply as { value: { source: { revision: number } } };
      expect((calls[1]!.input as { expectedSourceRevision: number }).expectedSourceRevision)
        .toBe(secondDraft.value.source.revision);
      await waitFor(() => findButton(page.root, '复制成新目标') === undefined);
    } finally {
      await page.restore();
    }
  });
});
