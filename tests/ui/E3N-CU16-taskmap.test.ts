/**
 * CU16A (7D2 batch 16a): the task map's failure facts and round chain in 更多,
 * the detail's 延后 / 取消 / 恢复 with a note, the dropped list's 恢复, the
 * anomaly anchors and the calendar's backfill.
 *
 * Rows ①, ③, ④, ⑤ and ⑦ are business flows through the real Host and page
 * clicks; ⑥ uses the scene read because "not backfilled" needs another store.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GraphWrite } from '../../src/core/work-graph/model/session-contracts.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { ArchiveLineInput, ArchiveLineResultV1 } from '../../src/business/workflow/session-archive.js';
import { AG2B_GOAL_REF, AG2B_SCOPE, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { readExecution } from '../helpers/A2-restart-fixture.js';
import { archivedLineContaining, lineArchived, ready, runMaintenance } from '../helpers/S2C-K-scenario-support.js';
import { execution, redrivePolicy, textReply } from '../scenarios/support/common.js';
import { cleanupScenarios, openHostScenario, performs, type HostScenario } from '../scenarios/harness.js';
import { bootPage, findAllClass, findButton, findClass, findElement, type BootedPage } from './helpers/boot-page.js';
import { FakeElement } from './helpers/dom.js';
import { click, hover, pressKey } from './helpers/E3N-interact.js';
import { bootE3N, callsTo, countRoute, quietPage, routesSince, sentWrite, textOf, waitFor } from './helpers/E3N-page.js';
import { relationGroup } from './helpers/E3A-page.js';
import { openCapWorld, openDeferredWorld, openReverifyWorld } from './helpers/E3D-world.js';
import { scene } from './helpers/task-map-scene.js';

afterEach(cleanupScenarios);

const WORK = 'Independent work ag2b-work';
const TASK_ID = 'ag2b-work';

const dagNode = (root: FakeElement, title: string): FakeElement | undefined => findElement(root,
  (element) => element.tagName.toLowerCase() === 'button'
    && (element.getAttribute('class') ?? '').split(/\s+/).includes('dg-node')
    && element.textContent.includes(title));

async function openTask(page: BootedPage, title: string): Promise<FakeElement> {
  await waitFor(() => dagNode(page.root, title) !== undefined);
  click(dagNode(page.root, title)!);
  await waitFor(() => textOf(findClass(page.root, 'detail')).includes(title));
  return findClass(page.root, 'detail')!;
}

/** The 更多 block's `dt`/`dd` pairs, in order. */
function morePairs(detail: FakeElement): string[][] {
  const dl = findAllClass(detail, 'd-dl')[1];
  const pairs: string[][] = [];
  let key = '';
  for (const child of dl?.childNodes ?? []) {
    if (!(child instanceof FakeElement)) continue;
    if (child.tagName.toLowerCase() === 'dt') key = textOf(child);
    if (child.tagName.toLowerCase() === 'dd') pairs.push([key, textOf(child)]);
  }
  return pairs;
}

const dialog = (root: FakeElement): FakeElement | undefined =>
  findElement(root, (element) => element.getAttribute('role') === 'alertdialog');

describe('CU16A task map: failure facts, rounds, dispositions, anchors and backfill', () => {
  it('① 更多 shows the cap facts and the rework counts; the round chain is not read', async () => {
    const h = await openCapWorld();
    const { page, log } = await bootE3N(h.host, 'TaskMap',
      { search: '?goal=' + AG2B_GOAL_REF.goalId, mode: 'controlled' });
    try {
      const from = log.calls.length;
      const detail = await openTask(page, WORK);
      await quietPage(log);
      click(findButton(detail, '更多')!);
      await waitFor(() => morePairs(detail).some(([key]) => key === '失败类别'));
      const pairs = morePairs(detail);
      const value = (key: string): string => pairs.filter(([own]) => own === key).map(([, v]) => v).join('｜');
      expect(value('失败类别')).toBe('检查未通过');
      expect(value('自动返工')).toBe('3/3（上限是当前设置，调高会立刻解除停止）');
      expect(value('检查')).toContain('未通过');
      expect(value('检查')).toContain('没过：');
      expect(pairs.filter(([key]) => key === '尝试'), 'one attempt row').toHaveLength(1);
      expect(['返工', '出路', '轮次'].filter((key) => pairs.some(([own]) => own === key))).toEqual([]);
      const rework = textOf(relationGroup(detail, '返工'));
      expect(rework).toContain('第 1 次 · 系统自动（1/3） · 检查未通过');
      expect(rework).toContain('第 2 次 · 系统自动（2/3） · 检查未通过');
      expect(rework).toContain('第 3 次 · 系统自动（3/3） · 检查未通过');
      /* One attached read per refresh after the selection, and one waits read
         per refresh (this Goal has a waiting card). */
      const since = log.calls.slice(from);
      const refreshes = since.filter((call) => call.route === 'tasks/query').length;
      const anomalyReads = since.filter((call) => call.route === 'graph/detail'
        && (call.input as { section?: string }).section === 'anomalies');
      expect(refreshes).toBeGreaterThan(0);
      expect(anomalyReads).toHaveLength(refreshes);
      expect(since.filter((call) => call.route === 'workflow/waits')).toHaveLength(refreshes);
      expect(countRoute(log, 'verification/round')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('③ 恢复任务 confirms with a note, Esc returns focus, and one propose carries the note and the read revision', async () => {
    const h = await openDeferredWorld();
    const { page, log } = await bootE3N(h.host, 'TaskMap',
      { search: '?goal=' + AG2B_GOAL_REF.goalId, mode: 'controlled' });
    try {
      const detail = await openTask(page, WORK);
      await waitFor(() => findButton(detail, '恢复任务') !== undefined);
      expect(findButton(detail, '延后任务'), 'a deferred Task offers no defer').toBeUndefined();
      expect(findButton(detail, '取消任务')).toBeDefined();

      click(findButton(detail, '恢复任务')!);
      await waitFor(() => dialog(page.root) !== undefined);
      const card = dialog(page.root)!;
      expect(card.getAttribute('aria-label')).toBe('恢复这个任务？');
      expect(textOf(findButton(card, '不了')!)).toBe('不了');
      await waitFor(() => document.activeElement === (findButton(card, '不了') as unknown as Element));
      const fromNoWrite = log.calls.length;
      pressKey(card, 'Escape');
      await waitFor(() => dialog(page.root) === undefined);
      expect(routesSince(log, fromNoWrite).filter((route) => route.startsWith('plans/'))).toEqual([]);
      await waitFor(() => document.activeElement === (findButton(detail, '恢复任务') as unknown as Element));

      const revision = (() => {
        const reply = [...callsTo(log, 'goals/read')].reverse().find((call) => call.reply !== undefined)?.reply as
          { value?: { goal?: { revision?: number } } } | undefined;
        return reply?.value?.goal?.revision;
      })();
      const from = log.calls.length;
      click(findButton(detail, '恢复任务')!);
      await waitFor(() => dialog(page.root) !== undefined);
      const note = findElement(dialog(page.root)!, (element) => element.getAttribute('id') === 'tm-disp-note')!;
      note.value = '先恢复看看';
      note.dispatch('input');
      const confirm = findButton(dialog(page.root)!, '恢复任务')!;
      click(confirm);
      click(confirm);
      await waitFor(() => routesSince(log, from).includes('plans/apply'));
      await waitFor(() => callsTo(log, 'plans/propose').at(-1)?.reply !== undefined);
      const since = routesSince(log, from);
      expect(since.filter((route) => route === 'plans/propose'), 'one propose').toHaveLength(1);
      expect(since.filter((route) => route === 'plans/apply'), 'one apply').toHaveLength(1);
      const write = sentWrite(callsTo(log, 'plans/propose').at(-1));
      const draft = write.input['draft'] as { tasks: Array<Record<string, unknown>> };
      const changed = draft.tasks.find((task) => task['taskId'] === TASK_ID)!;
      expect(changed['disposition']).toBe('active');
      expect('replacedByTaskId' in changed).toBe(false);
      expect((write.input['reason'] as { text: string }).text).toBe('先恢复看看');
      expect((write.input['reason'] as { affectedTaskIds: string[] }).affectedTaskIds).toEqual([TASK_ID]);
      const expected = write.meta.expected as Array<{ ref: { goalId: string }; revision: number }>;
      expect(expected).toHaveLength(1);
      expect(expected[0]!.ref.goalId).toBe('ag2b-goal');
      expect(expected[0]!.revision).toBe(revision);
      await waitFor(() => !textOf(findClass(page.root, 'detail')).includes('已延后'));
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('④ cancel without a note, then restore from the dropped list; the first restore shows the busy refusal', async () => {
    const h = await openCapWorld();
    const restoreDraft = (input: unknown): boolean => {
      const draft = (input as { draft?: { tasks?: Array<Record<string, unknown>> } }).draft;
      return (draft?.tasks ?? []).some((task) => task['taskId'] === TASK_ID && task['disposition'] === 'active');
    };
    const { page, log } = await bootE3N(h.host, 'TaskMap', { search: '?goal=' + AG2B_GOAL_REF.goalId,
      mode: 'controlled', rejectOnce: { route: 'plans/propose', input: restoreDraft,
        code: 'busy', reason: 'stopping_affected_work' } });
    try {
      const detail = await openTask(page, WORK);
      await waitFor(() => findButton(detail, '取消任务') !== undefined);
      click(findButton(detail, '取消任务')!);
      await waitFor(() => dialog(page.root) !== undefined);
      expect(dialog(page.root)!.getAttribute('aria-label')).toBe('取消这个任务？');
      click(findButton(dialog(page.root)!, '取消任务')!);
      await waitFor(() => textOf(findClass(page.root, 'detail')).includes('已取消')
        || textOf(page.root).includes('另有已取消 1 个任务'));
      const write = sentWrite(callsTo(log, 'plans/propose').at(-1));
      expect((write.input['reason'] as { text: string }).text).toBe('取消任务');
      await waitFor(() => findElement(page.root, (element) =>
        (element.getAttribute('class') ?? '').includes('dg-drop-btn')) !== undefined);
      click(findElement(page.root, (element) => (element.getAttribute('class') ?? '').includes('dg-drop-btn'))!);
      await waitFor(() => findButton(page.root, '恢复') !== undefined);
      click(findButton(page.root, '恢复')!);
      await waitFor(() => textOf(page.root).includes('有工作还在停下，等停下后再点一次。'));
      click(findButton(page.root, '恢复')!);
      await waitFor(() => !textOf(page.root).includes('另有已取消 1 个任务'));
      expect(textOf(page.root)).not.toContain('有工作还在停下');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('⑤ 异常锚点 counts the unclaimed anchor, marks the Task, and the detail lists it', async () => {
    const h = await openHostScenario({
      automation: redrivePolicy(false),
      script: { replies: [
        { kind: 'calls', calls: [{ callId: 'p12-8-edit', name: 'edit',
          args: { mode: 'create', path: 'src/p12-8-changed.txt', newText: 'P12-8 changed file\n' } }] },
        textReply('P12-8 the archived Run never answers'),
      ] },
    });
    const held = h.holdReply(1);
    let page: BootedPage | undefined;
    try {
      const toStart = await h.advance(h.select('p12-8-run1', 'ag2b-work'), { stopBefore: performs('start') });
      if (toStart.next === null) throw new Error('P12-8: the Workflow must reach the start');
      const starting = h.post('workflow/advance', plain(AG2B_SCOPE, toStart.next));
      await held.reached;
      const runRef = (await h.taskRow()).execution;
      if (runRef === null) throw new Error('P12-8: the work Run must be selected');
      const session = (await readExecution(h.host, runRef)).session;
      const head = session.ref.sessionId;
      const request: GraphWrite<ArchiveLineInput> = {
        input: { sessionRef: { projectId: session.ref.projectId, sessionId: head },
          reason: 'P12-8: the person archives the running line',
          tasks: [{ target: { kind: 'task', ref: { projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId, taskId: 'ag2b-work' } },
            disposition: { kind: 'drop' } }], wait: null },
        meta: { requestId: 'p12-8-archive', expected: [{ ref: session.ref, revision: session.revision }] },
      };
      const started = await h.post<ReadResult<ArchiveLineResultV1>>('sessions/archive-line', { scope: AG2B_SCOPE, request });
      expect(started.status).toBe('ready');
      held.fail('P12-8: the archive stops the held Turn');
      await starting;
      await h.advance(h.select('p12-8-advance'), { stopBefore: performs('start') });
      await runMaintenance(h, 'p12-8-maintenance');
      expect(existsSync(join(h.root, 'src/p12-8-changed.txt'))).toBe(true);
      const archived = ready(await lineArchived(h), 'lines/archived');
      const who = archivedLineContaining(archived, head)!.name.primary;

      const { page: booted, log } = await bootE3N(h.host, 'TaskMap',
        { search: '?goal=' + AG2B_GOAL_REF.goalId, mode: 'controlled' });
      page = booted;
      await waitFor(() => dagNode(page!.root, WORK) !== undefined);
      const from = log.calls.length;
      const anchorItem = findElement(page.root, (element) =>
        (element.getAttribute('class') ?? '').includes('tm-ai') && textOf(element).startsWith('异常锚点'));
      expect(anchorItem, '需要关注 has the anchor item').toBeDefined();
      expect(textOf(anchorItem)).toContain('1 条');
      click(anchorItem!);
      await waitFor(() => textOf(page!.root).includes('标出：异常锚点 1'));
      const detail = await openTask(page, WORK);
      await waitFor(() => textOf(detail).includes('异常锚点'));
      const relation = textOf(relationGroup(detail, '异常锚点'));
      expect(relation).toContain(who);
      expect(relation).toContain('执行中被归档，执行被中断');
      expect(relation).toContain('你归档');
      expect(relation).toContain('结果没核对');
      expect(relation.includes('p12-8-changed.txt') || relation.includes('改动未知')).toBe(true);
      await quietPage(log);
      const since = log.calls.slice(from);
      const refreshes = since.filter((call) => call.route === 'tasks/query').length;
      const anomalyReads = since.filter((call) => call.route === 'graph/detail'
        && (call.input as { section?: string }).section === 'anomalies');
      expect(refreshes).toBeGreaterThan(0);
      expect(anomalyReads).toHaveLength(refreshes);
      expect(anomalyReads.every((call) =>
        ((call.input as { node?: { ref?: { taskId?: string } } }).node?.ref?.taskId) === TASK_ID)).toBe(true);
    } finally {
      held.fail('P12-8 cleanup');
      await page?.restore();
    }
  }, 180_000);

  it('⑦ the round chain in 更多 has one line per round and reads verification/round once', async () => {
    const h = await openReverifyWorld();
    const { page, log } = await bootE3N(h.host, 'TaskMap',
      { search: '?goal=' + AG2B_GOAL_REF.goalId, mode: 'controlled' });
    try {
      const from = log.calls.length;
      const detail = await openTask(page, WORK);
      await waitFor(() => findButton(detail, '更多') !== undefined);
      click(findButton(detail, '更多')!);
      await waitFor(() => morePairs(detail).some(([key]) => key === '轮次'));
      const rounds = morePairs(detail).filter(([key]) => key === '轮次').map(([, value]) => value);
      expect(rounds).toHaveLength(2);
      expect(rounds[0]).toContain('第 1 轮');
      expect(rounds[1]).toContain('第 2 轮');
      expect(rounds.every((line) => (line ?? '').includes('不完整'))).toBe(true);
      await quietPage(log);
      /* One read per refresh while the detail stays open (known limitation 1),
         each pinned to the row's chain head. */
      const since = log.calls.slice(from);
      const refreshes = since.filter((call) => call.route === 'tasks/query').length;
      const calls = callsTo(log, 'verification/round');
      expect(calls).toHaveLength(refreshes);
      const graph = [...callsTo(log, 'tasks/query')].reverse().find((call) => call.reply !== undefined)!.reply as
        { value: { tasks: Array<Record<string, unknown>> } };
      const row = graph.value.tasks.find((task) =>
        (task['definition'] as Record<string, unknown>)['taskId'] === TASK_ID) as
        { failure: { round: { roundRef: unknown } } };
      expect(calls.every((call) => (call.input as { roundRef?: unknown }).roundRef !== undefined
        && ((call.input as { roundRef?: unknown }).roundRef as { runId?: string }).runId
          === (row.failure.round.roundRef as { runId?: string }).runId)).toBe(true);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('⑥ the incomplete calendar says why and backfills the read span in one call', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(scene.now));
    const calendarInputs: Array<Record<string, unknown>> = [];
    const backfillInputs: Array<Record<string, unknown>> = [];
    let page: BootedPage | undefined;
    try {
      page = await bootPage({ name: 'TaskMap', search: '?goal=g1', token: 'cu16a-backfill',
        request: async (url, init) => {
          const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
          if (route === 'changes') return new Response('{}', { status: 404 });
          const envelope = init?.body === undefined ? {} : JSON.parse(String(init.body)) as { input?: unknown };
          const input = (envelope.input ?? envelope) as Record<string, unknown>;
          if (route === 'activity/calendar') calendarInputs.push(input);
          if (route === 'activity/backfill') {
            backfillInputs.push(input);
            return new Response(JSON.stringify({ status: 'ready',
              value: { processed: [], next: null, done: true } }), { status: 200 });
          }
          const reply = scene.reply(route, input) as { value?: {
            totals?: Record<string, unknown>; coverage?: Record<string, unknown>;
            cells?: Array<Record<string, unknown>> } };
          if (route === 'activity/calendar' && reply.value !== undefined) {
            reply.value.totals = { ...(reply.value.totals ?? {}), complete: false };
            reply.value.coverage = { runsUncounted: [{ reason: 'not_backfilled', count: 2 }] };
            const today = reply.value.cells?.find((cell) => cell['localDate'] === '2026-10-04');
            if (today !== undefined) { today['complete'] = false; today['uncountedRuns'] = 2; }
          }
          return new Response(JSON.stringify(reply), { status: 200 });
        } });
      await waitFor(() => page!.root.textContent.includes('状态机规格对齐'));
      click(findButton(page.root, '轨道')!);
      await waitFor(() => (findClass(page!.root, 'tl-sum')?.textContent ?? '').includes('有的记录还没补算'));
      const before = calendarInputs.map((entry) => ({ from: String(entry['from']),
        to: String(entry['to']) }));
      const from = before.map((entry) => entry.from).sort()[0];
      const to = before.map((entry) => entry.to).sort().slice(-1)[0];
      const calls = calendarInputs.length;
      click(findButton(page.root, '补算这一段')!);
      await waitFor(() => backfillInputs.length === 1);
      expect(backfillInputs[0]).toEqual({ workspace: { projectId: 'ple34b', workspaceId: 'scene' },
        from, to, cursor: null });
      await waitFor(() => calendarInputs.length > calls);
    } finally {
      page?.restore();
      vi.useRealTimers();
    }
  }, 120_000);
});
