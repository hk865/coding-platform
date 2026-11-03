import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  adaptTaskMap, adaptTaskMapTime, type TaskMapDisplayRead, type TaskMapGoalRead, type TaskMapGraphRead,
} from '../../src/ui/adapters/task-map.js';
import { BoardView } from '../../src/ui/runtime.js';
import { loadBoard } from './helpers/board-files.js';
import { bootPage, findButton, findClass, type BootedPage } from './helpers/boot-page.js';
import { scene } from './helpers/task-map-scene.js';
import type { FakeElement } from './helpers/dom.js';
import type { TaskGraph } from '../../src/core/work-graph/model/plan-contracts.js';
import type { WorkLineListV1 } from '../../src/contracts/work-line.js';
import type { TrackQueryBarV1 } from '../../src/core/work-graph/views/track-read-model.js';

const WORKING = fileURLToPath(new URL('../../src/ui/boards/', import.meta.url));
const PROJECT = 'ple34b';
const WORKSPACE = 'scene';

afterEach(() => { vi.useRealTimers(); });

type Ready<T> = { status: 'ready'; value: T };
const ready = <T,>(reply: unknown): T => (reply as Ready<T>).value;

async function poll(predicate: () => boolean, timeoutMs = 20_000): Promise<void> {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > timeoutMs) throw new Error('condition not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function nodesWithClass(root: FakeElement, cls: string): FakeElement[] {
  const found: FakeElement[] = [];
  const walk = (el: FakeElement): void => {
    if ((el.getAttribute('class') ?? '').split(/\s+/).includes(cls)) found.push(el);
    for (const child of el.childNodes) if (child instanceof Object && 'tagName' in child) walk(child as FakeElement);
  };
  walk(root);
  return found;
}

/** Boot the scene page, with an optional route-reply rewrite for a test row; `live` keeps the change stream open (by default it is answered 404, so the page is stale). */
function scenePage(
  rewrite?: (route: string, reply: unknown, input: Record<string, unknown>) => unknown,
  onRoute?: (route: string) => void,
  live = false,
): Promise<BootedPage> {
  return bootPage({
    name: 'TaskMap', search: '?goal=g1', token: 'e34-14-token',
    request: async (url, init) => {
      if (init?.signal?.aborted) return new Promise<Response>(() => {});
      const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
      if (route === 'changes') return live ? new Response(new ReadableStream<Uint8Array>(), { status: 200 }) : new Response('{}', { status: 404 });
      onRoute?.(route);
      const envelope = init?.body === undefined ? {} : JSON.parse(String(init.body)) as { input?: unknown };
      const input = envelope.input ?? envelope;
      const raw = scene.reply(route, input);
      const reply = rewrite === undefined ? raw : rewrite(route, raw, input as Record<string, unknown>);
      return new Response(JSON.stringify(reply), { status: 200 });
    },
  });
}

const goalRead = (): TaskMapGoalRead => ready<TaskMapGoalRead>(scene.reply('goals/read', {}));
const displayRead = (): TaskMapDisplayRead => ready<TaskMapDisplayRead>(scene.reply('goals/display', {}));

describe('E34-14 the route facts keep their state, result and reason words', () => {
  it('E34-14 the decide Task is a real failed+check_failed row whose stop reason is read from the failure verdict', () => {
    /* Named mutation: read the stop reason from `phaseCause.code` again. Then
       the phase projection `check_failed` reaches taskState and the card turns
       into 失败/受阻 instead of the prototype's 需要你决定. */
    const graph = ready<TaskGraph>(scene.reply('tasks/query', {}));
    const row = graph.tasks.find((task) => task.ref.taskId === 'T21')!;
    expect(row.effectivePhase).toBe('failed');
    expect(row.phaseCause?.code).toBe('check_failed');
    expect(row.failure?.automation.verdict).toMatchObject({
      kind: 'stopped', reason: 'auto_rework_cap_reached',
    });
    const data = adaptTaskMap(goalRead(), graph as unknown as TaskMapGraphRead, displayRead());
    expect(data.tasks.find((task) => task.id === 'T21')).toMatchObject({
      st: 'decide', why: '自动返工已达上限（3/3）',
    });
  });

  it('E34-14 blocked unknown outcomes are 需要你决定 and paused causes are 已暂停，可继续 while the raw phase stays blocked', () => {
    /* Named mutation: drop the blocked branch in taskState; all three fall
       back to `blocked` (受阻), so the two words and colours change. */
    const graph = JSON.parse(JSON.stringify(ready<TaskGraph>(scene.reply('tasks/query', {})))) as TaskGraph;
    const causes: Array<[string, string]> = [
      ['T01', 'run_outcome_unknown'], ['T02', 'continuation_paused'], ['T03', 'paused_interrupted'],
    ];
    for (const [taskId, code] of causes) {
      const row = graph.tasks.find((task) => task.ref.taskId === taskId)!;
      row.effectivePhase = 'blocked';
      row.phaseCause = { code: code as NonNullable<typeof row.phaseCause>['code'] };
    }
    const data = adaptTaskMap(goalRead(), graph as unknown as TaskMapGraphRead, displayRead());
    const stateOf = (id: string): string | undefined => data.tasks.find((task) => task.id === id)?.st;
    expect(stateOf('T01')).toBe('decide');
    expect(stateOf('T02')).toBe('waiting');
    expect(stateOf('T03')).toBe('waiting');
    /* The raw projection is still `blocked`; only the display word/colour moved. */
    for (const [taskId] of causes) {
      expect(graph.tasks.find((task) => task.ref.taskId === taskId)!.effectivePhase).toBe('blocked');
    }
  });

  const pausedRow = (taskId: string, code: string) => (route: string, reply: unknown): unknown => {
    if (route !== 'tasks/query') return reply;
    const page = reply as { value: { tasks: Array<{ ref: { taskId: string }; effectivePhase: string; phaseCause: unknown }> } };
    const row = page.value.tasks.find((entry) => entry.ref.taskId === taskId)!;
    row.effectivePhase = 'blocked';
    row.phaseCause = { code };
    return page;
  };

  it.each([
    ['T02', '原因码表', 'continuation_paused'],
    ['T03', '目标展示名', 'paused_interrupted'],
  ] as const)('E34-14 the detail of %s keeps 已暂停，可继续 when the map state is waiting', async (taskId, title, cause) => {
    /* Named mutation: drop `waiting` from PHASE_WORD. The map still says
       已暂停，可继续, but the opened detail replaces it with 未知. */
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(scene.now));
    let page: BootedPage | undefined;
    let detailReads = 0;
    try {
      page = await scenePage(pausedRow(taskId, cause), (route) => { if (route === 'graph/detail') detailReads += 1; });
      await poll(() => page!.root.textContent.includes('状态机规格对齐'));
      const node = findButton(page.root, title);
      expect(node).toBeDefined();
      node!.dispatch('click');
      await poll(() => detailReads > 0);
      await poll(() => (findClass(page!.root, 'detail')?.textContent ?? '').includes(title));
      const detail = findClass(page.root, 'detail')!;
      expect(detail.textContent).toContain('已暂停，可继续');
      expect(detail.textContent).not.toContain('未知');
    } finally {
      await page?.restore();
    }
  }, 60_000);

  it('E34-14 the detail of the auto-rework cap keeps 自动返工已达上限 from the map', async () => {
    /* Named mutation: let the summary `phaseCause: check_failed` win over the
       map row's read reason. The map keeps 自动返工已达上限, but the opened
       detail falls back to 检查未通过. */
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(scene.now));
    let page: BootedPage | undefined;
    let detailReads = 0;
    try {
      page = await scenePage(undefined, (route) => { if (route === 'graph/detail') detailReads += 1; });
      await poll(() => page!.root.textContent.includes('状态机可靠性改造'));
      const node = findButton(page.root, '检查不完整判定');
      expect(node).toBeDefined();
      node!.dispatch('click');
      await poll(() => detailReads > 0);
      await poll(() => (findClass(page!.root, 'detail')?.textContent ?? '').includes('检查不完整判定'));
      const detail = findClass(page.root, 'detail')!;
      expect(detail.textContent).toContain('自动返工已达上限');
    } finally {
      await page?.restore();
    }
  }, 60_000);

  it('E34-14 the detail of a future intention keeps 未来意图 from the map', async () => {
    /* Named mutation: recompute the detail word from phase/disposition again;
       the future intention turns 待执行 in the detail while the map still says
       未来意图. */
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(scene.now));
    let page: BootedPage | undefined;
    let detailReads = 0;
    try {
      page = await scenePage(undefined, (route) => { if (route === 'graph/detail') detailReads += 1; });
      await poll(() => page!.root.textContent.includes('状态机可靠性改造'));
      const future = findButton(page.root, '重新验收');
      expect(future).toBeDefined();
      future!.dispatch('click');
      /* Wait until the real `graph/detail` summary has come back; only then
         does the detail take its word from the adapted projection. */
      await poll(() => detailReads > 0);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const detail = findClass(page.root, 'detail')!;
      expect(detail.textContent).toContain('重新验收');
      expect(detail.textContent).toContain('未来意图');
      expect(detail.textContent).not.toContain('待执行');
    } finally {
      await page?.restore();
    }
  }, 60_000);

  it('E34-14 timeout, gap and not_entered keep their own result words in the table and the hover card', async () => {
    /* Named mutation: remove `timeout`/`gap`/`not_entered` from the result
       tables; all three fall back to 执行结果待核对 (unknown). */
    const line = ready<WorkLineListV1>(scene.reply('lines/list', {})).rows
      .find((row) => row.name.primary === '秘书（主对话）')!;
    const session = { projectId: PROJECT, sessionId: 'SC' };
    const extra = (['timeout', 'gap', 'not_entered'] as const).map((result, index): TrackQueryBarV1 => ({
      kind: 'query',
      queryRunRef: { aggregateType: 'QueryRun', projectId: PROJECT, workspaceId: WORKSPACE,
        queryJobId: 'q-' + result, runId: 'qr-' + result },
      sessionRef: session, askedSessionRef: session, via: 'turn',
      startAt: '2026-10-04T13:5' + String(index) + ':00+08:00',
      endAt: '2026-10-04T13:5' + String(index) + ':30+08:00',
      result,
      activity: { queryRunRef: { aggregateType: 'QueryRun', projectId: PROJECT, workspaceId: WORKSPACE,
        queryJobId: 'q-' + result, runId: 'qr-' + result }, status: 'counted', reason: null, error: false,
      totals: { steps: 1, edits: 0, editsUnknown: 0 }, changedFiles: null, usage: null, recordedBy: 'query_end', recordedAt: null,
      countedThroughTurnEnd: null, unresolvedCalls: null, sessionRef: session, askedSessionRef: session, goalId: 'g1' },
    }));
    const time = adaptTaskMapTime([{ bars: extra, next: null }], null, null, [line], scene.now,
      { working: { status: 'exact', value: 3 } });
    expect(time.rows[0]!.bars.map((bar) => bar.word)).toEqual(['超时', '没有正式回答', '没有开始']);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(scene.now));
    let page: BootedPage | undefined;
    try {
      page = await scenePage((route, reply) => {
        if (route !== 'activity/track') return reply;
        const pageReply = reply as Ready<{ bars: unknown[] }>;
        pageReply.value.bars.push(...extra);
        return pageReply;
      });
      await poll(() => page!.root.textContent.includes('状态机可靠性改造'));
      findButton(page.root, '轨道')!.dispatch('click');
      await poll(() => nodesWithClass(page!.root, 'k-talk').some((bar) => bar.getAttribute('aria-label')?.includes('超时')));
      for (const word of ['超时', '没有正式回答', '没有开始']) {
        const bar = nodesWithClass(page.root, 'k-talk').find((entry) => entry.getAttribute('aria-label')?.includes(word));
        expect(bar).toBeDefined();
        bar!.dispatch('mouseenter', { currentTarget: bar });
        const card = findClass(page.root, 'hcard')!;
        expect(card.textContent).toContain(word);
        expect(card.textContent).not.toContain('执行结果待核对');
      }
    } finally {
      await page?.restore();
    }
  }, 60_000);

  it('E34-14 invents neither 第 1 段 nor 现在起 when no segment or start fact exists', async () => {
    /* Named mutation: restore `segOf[b.id] = 1` / `first: now`; the card says
       工作记录第 1 段 and the selected line says <now> 起. */
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(scene.now));
    let page: BootedPage | undefined;
    try {
      page = await scenePage();
      await poll(() => page!.root.textContent.includes('状态机可靠性改造'));
      findButton(page.root, '轨道')!.dispatch('click');
      await poll(() => findButton(page!.root, '全部') !== undefined);
      findButton(page.root, '全部')!.dispatch('click');
      await poll(() => nodesWithClass(page!.root, 'tl-b').some((bar) => bar.getAttribute('aria-label')?.includes('前端拆分')));
      const bar = nodesWithClass(page.root, 'tl-b').find((entry) => entry.getAttribute('aria-label')?.includes('前端拆分'))!;
      bar.dispatch('mouseenter', { currentTarget: bar });
      const card = findClass(page.root, 'hcard')!;
      expect(card.textContent).toContain('工作线');
      expect(card.textContent).not.toContain('第 1 段');
    } finally {
      await page?.restore();
    }

    /* A line whose bars were not loaded has no start fact: selecting it shows
       the real session count, never a synthesized "now" start. */
    const graph = ready<TaskGraph>(scene.reply('tasks/query', {}));
    const data = adaptTaskMap(goalRead(), graph as unknown as TaskMapGraphRead, displayRead(), {
      lines: ready<WorkLineListV1>(scene.reply('lines/list', {})),
      hover: ready<{ tasks?: unknown[]; groups?: unknown[] }>(scene.reply('graph/hover', {})),
    });
    const line = ready<WorkLineListV1>(scene.reply('lines/list', {})).rows
      .find((row) => row.name.primary === '架构参谋')!;
    data.time = adaptTaskMapTime([{ bars: [], next: null }], null, null, [line], scene.now,
      { working: { status: 'exact', value: 0 }, archived: { status: 'exact', value: 0 } });
    const board = loadBoard('TaskMap', WORKING);
    const view = new BoardView(board, { ...board.defaults, data, readState: { status: 'ready' }, dataVersion: 1 });
    view.instance.setState({ view: 'lanes', wlSel: data.time.rows[0]!.id });
    const vals = view.instance.renderVals() as { wl: { selSub: string } };
    expect(vals.wl.selSub).toBe('工作记录 1 段');
    expect(vals.wl.selSub).not.toContain('起');
  });

  it('E34-14 the now column carries the bar’s changed files and check round, never an attempt ordinal or a cursor-time x/y', async () => {
    /* Named mutation: build the now sum from `x.why` only (drop the bar facts);
       the real 已改至少 3 个文件 / 正式检查第 2 轮进行中 / 已开始 5 项 disappear. */
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(scene.now));
    let page: BootedPage | undefined;
    try {
      page = await scenePage((route, reply) => {
        if (route !== 'activity/track') return reply;
        const bars = (reply as { value: { bars: Array<Record<string, unknown>> } }).value.bars;
        for (const bar of bars) {
          const activity = bar.activity as Record<string, unknown> | null;
          if (bar.kind === 'run' && bar.taskId === 'T28' && bar.endAt === null && activity !== null) {
            activity.changedFiles = { definite: 3, possible: 2, possiblyIncomplete: true };
          }
          if (bar.kind === 'check' && bar.taskId === 'T14') {
            bar.ordinal = 2;
            bar.checksBegun = 5;
          }
        }
        return reply;
      });
      await poll(() => (findClass(page!.root, 'dg-now')?.textContent ?? '').includes('已改'));
      const now = findClass(page.root, 'dg-now')!;
      /* `definite` only, prefixed 至少 by `possiblyIncomplete`; `possible` is
         not named by the row and stays out. */
      expect(now.textContent).toContain('已改至少 3 个文件');
      expect(now.textContent).not.toContain('5 个文件');
      expect(now.textContent).toContain('正式检查第 2 轮进行中');
      expect(now.textContent).toContain('已开始 5 项');
      /* `checksBegun` is begun, not completed; there is no attempt ordinal and
         no cursor-time x/y in these reads (the prototype's 9/14 项已完成,
         prototype:783). A.2's （n/cap） is a real count (DESIGN `:606`) and is
         cut out first. Named mutation: print `checksBegun + '/14 项'`. */
      expect(now.textContent).not.toContain('已完成');
      expect(now.textContent).not.toContain('次尝试');
      expect(now.textContent.replace(/（\d+\/\d+）/g, '')).not.toMatch(/\d+\s*\/\s*\d+/);
    } finally {
      await page?.restore();
    }
  }, 60_000);

  it('E34-14 shows the goal bar’s working count and the assignment instruction in the hover card', async () => {
    /* On a live stream (6.1: a dropped one says 重连 instead). Named mutation:
       drop the lines/list count from barWhy and leave taskCard.sem on the empty
       task semantic; the working count and the instruction disappear. */
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(scene.now));
    let page: BootedPage | undefined;
    try {
      page = await scenePage((route, reply) => {
        if (route !== 'tasks/query') return reply;
        const graph = (reply as Ready<TaskGraph>).value;
        graph.plan.assignments = [{ taskId: 'T01', role: 'executor', instruction: '先读状态机规格再动手' }];
        return reply;
      }, undefined, true);
      await poll(() => page!.root.textContent.includes('状态机可靠性改造'));
      const why = findClass(page.root, 'why')!;
      expect(why.textContent).toBe('3 条工作线工作中');

      const task = findButton(page.root, '状态机规格对齐')!;
      task.dispatch('mouseenter', { currentTarget: task });
      const card = findClass(page.root, 'hcard')!;
      expect(card.textContent).toContain('状态机规格对齐');
      expect(card.textContent).toContain('先读状态机规格再动手');
    } finally {
      await page?.restore();
    }
  }, 60_000);
});
