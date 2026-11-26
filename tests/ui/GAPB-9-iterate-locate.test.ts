import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { findButton, findClass, findElement } from './helpers/boot-page.js';
import {
  auxTab, bootE3N, bootMainCard, callsTo, countRoute, hasClass, quietPage, revealTreeNode, settledN, textOf,
  treeFileNames, waitFor,
} from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { answerRequest, openWA } from './helpers/E3N-world.js';
import { openCapWorld, taskCardOf } from './helpers/E3D-world.js';
import { openE3GW1 } from './helpers/E3G-world.js';
import { card, detailTitle, labelled, openFromGoalBar, typeInto } from './helpers/E3D-page.js';
import { conflictGoal, quoteModuleLine } from './helpers/GAPB-quote.js';
import { cleanupScenarios } from '../scenarios/harness.js';
import type { S6ARequestWorld } from '../helpers/S6A-request-fixture.js';

/**
 * GAPB-9 (goal card B, B9): 在对话里修改 continues the request that made the
 * plan card (`requests/submit` with `continues`), and a decision card's path
 * opens the right panel on the thing the card names — the task in 任务图, or
 * the two Goals' overlap files in 架构图.
 *
 * B9-1 is red on `7dcug3t-base`: the button stays `nc`, so the send is an
 * ordinary Goal request (`continues: null`, `goalId` set). B9-2/B9-3 are red
 * because the path stays `nc`: the panel never opens, so no `graph/detail` or
 * `architecture/read` follows.
 */

const worlds: S6ARequestWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});
afterAll(async () => {
  await cleanupScenarios();
});

const GOAL = '?goal=ag2b-goal';

describe('GAPB-9 the plan card and the decision card', () => {
  it('B9-1 在对话里修改 continues the request that made the plan', async () => {
    const opened = await openWA();
    worlds.push(opened.world);
    const request = await answerRequest(opened, {
      commandId: 'gapb9-1', text: '给两个做法', answer: '有两个做法。',
      ideas: [{ title: '只重跑没过的两项', detail: '只跑类型检查和单元测试。' },
        { title: '整轮重跑', detail: '所有检查都重跑一遍。' }],
    });
    const { page, log } = await bootE3N(opened.world, 'Main', { search: GOAL });
    try {
      await waitFor(() => findButton(page.root, '在对话里修改') !== undefined);
      await quietPage(log);
      await quoteModuleLine(page, log);
      click(findButton(page.root, '在对话里修改')!);
      typeInto(page.root, 'composer-input', '把顺序换一下');
      click(labelled(page.root, '发送')!);
      await settledN(log, 'requests/submit', 1);
      const input = callsTo(log, 'requests/submit')[0]!.input as Record<string, unknown>;
      /* 具名改坏: `iterate` 保持 `nc`（或发送仍走普通 `askSecretary(text, refs)`）；`continues` 与
         `goalId` 两句红；去掉 `askSecretary(..., refs, {continues})` 的引用，`references` 那句红。 */
      expect(input['continues']).toEqual(request.requestRoot);
      expect(input['goalId']).toBeNull();
      expect(input['references']).toEqual([{ path: 'src/module.ts', startLine: 1, endLine: 1, snapshot: null }]);
      expect(countRoute(log, 'requests/ask')).toBe(0);
      /* The card's success clears the draft and the quote. */
      await waitFor(() => findClass(page.root, 'composer-quote') === undefined);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('B9-2 a card with a task opens 任务图 at that task and reads its detail once', async () => {
    const h = await openCapWorld();
    const waiting = await taskCardOf(h, 'ag2b-work');
    const { page, log } = await bootMainCard(h, GOAL);
    try {
      await openFromGoalBar(page);
      await quietPage(log);
      /* The Goal may show another card first; 下一条 reaches the stop card whose
         path is live (a card without a task keeps it grey). */
      for (let tries = 0; tries < 4 && hasClass(findClass(card(page.root)!, 'ellipsis')!, 'is-off'); tries += 1) {
        click(labelled(card(page.root), '下一条')!);
        await quietPage(log);
      }
      const before = log.calls.length;
      click(findClass(card(page.root)!, 'ellipsis')!);
      /* 具名改坏: `dc.locate` 保持 `nc`（或只 `set` 不开 `readMore`）；下面三句各自红：
         页签不是任务图、`graph/detail` 0 次、详情没有标题。 */
      await waitFor(() => auxTab(page.root, '任务图')?.getAttribute('aria-selected') === 'true');
      await waitFor(() => detailTitle(page.root) === 'Independent work ag2b-work');
      await quietPage(log);
      const reads = log.calls.slice(before).filter((call) => call.route === 'graph/detail').map((call) =>
        call.input as { section?: unknown; node?: { kind?: unknown; ref?: { taskId?: unknown } } });
      /* One detail open reads its summary, one participants page and one risks page. */
      expect(reads.map((read) => read.section)).toEqual(['summary', 'participants', 'risks']);
      expect(reads[0]!.node).toMatchObject({ kind: 'task', ref: { taskId: waiting.taskRef?.taskId } });
      expect(hasClass((await revealTreeNode(page.root, 'Independent work ag2b-work'))!, 'is-sel')).toBe(true);
    } finally {
      await page.restore();
    }
  }, 240_000);

  it('B9-3 a conflict card opens 架构图 on the files both Goals change', async () => {
    const opened = await openE3GW1();
    worlds.push(opened.world);
    const goalId = await conflictGoal(opened.world);
    const { page, log } = await bootE3N(opened.world, 'Main', { search: `?goal=${goalId}` });
    try {
      await openFromGoalBar(page);
      await quietPage(log);
      const before = log.calls.length;
      click(findClass(card(page.root)!, 'ellipsis')!);
      /* 具名改坏: 冲突一支照 Decide 今天开任务图，或把 `workOnly` 写成 true；页签、`architecture/read`、
         `architecture/work-scope` 三句各自红。 */
      await waitFor(() => auxTab(page.root, '架构图')?.getAttribute('aria-selected') === 'true');
      await waitFor(() => log.calls.slice(before).some((call) => call.route === 'architecture/read' && call.reply !== undefined));
      await quietPage(log);
      expect(countRoute(log, 'architecture/work-scope')).toBe(0);
      const read = log.calls.slice(before).find((call) => call.route === 'architecture/read')!;
      expect((read.input as { selection?: unknown }).selection).toEqual({ kind: 'current' });
      /* Current work draws exactly the two overlap files (their catalog names are the
         last segments, adapters/goals.ts), and the scope stays 当前工作. */
      await waitFor(() => treeFileNames(page.root).length === 2);
      expect(treeFileNames(page.root)).toEqual(['core-routes.ts', 'views.ts']);
      const work = findElement(page.root, (element) => element.tagName.toLowerCase() === 'button'
        && textOf(element) === '当前工作');
      expect(work?.getAttribute('aria-pressed')).toBe('true');
    } finally {
      await page.restore();
    }
  }, 120_000);
});
