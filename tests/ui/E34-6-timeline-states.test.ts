import { afterEach, describe, expect, it, vi } from 'vitest';
import { adaptTaskMapTime, taskMapStatesAt, type TaskMapTimelineRead } from '../../src/ui/adapters/task-map.js';
import { bootPage, findAllClass, findButton, findClass, findElement } from './helpers/boot-page.js';
import { scene } from './helpers/task-map-scene.js';

/** E34-6 (design §6): real timeline segments keep their half-open state and
 * time range; a missing historical reason and attempt ordinal are absent, not
 * guessed. The expected words and instants are hand-written. */
const TIMELINE: TaskMapTimelineRead = {
  tasks: [
    { taskId: 't-plan', segments: [{ from: '2026-11-02T09:00:00.000Z', to: '2026-11-02T10:00:00.000Z', state: 'not_in_plan' },
      { from: '2026-11-02T10:00:00.000Z', to: null, state: 'pending' }] },
    { taskId: 't-run', segments: [{ from: null, to: '2026-11-02T10:20:00.000Z', state: 'running' },
      { from: '2026-11-02T10:20:00.000Z', to: '2026-11-02T10:30:00.000Z', state: 'awaiting_check' },
      { from: '2026-11-02T10:30:00.000Z', to: null, state: 'satisfied' }] },
    { taskId: 't-pause', segments: [{ from: '2026-11-02T10:00:00.000Z', to: '2026-11-02T10:10:00.000Z', state: 'paused' },
      { from: '2026-11-02T10:10:00.000Z', to: null, state: 'running' }] },
    { taskId: 't-defer', segments: [{ from: '2026-11-02T10:00:00.000Z', to: null, state: 'deferred' }] },
    { taskId: 't-unknown', segments: [{ from: null, to: null, state: 'unknown' }] },
  ],
};

afterEach(() => { vi.useRealTimers(); });

/** Poll with the un-faked clock: this row freezes Date to the scene's now. */
async function poll(predicate: () => boolean, timeoutMs = 20_000): Promise<void> {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > timeoutMs) throw new Error('condition not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const LINES = [{ key: { projectId: 'p', workspaceId: 'w', sessionId: 's1' },
  name: { primary: '执行线一' }, status: { own: 'working' }, sessionCount: { status: 'exact', value: 1 },
  chainSessions: [{ projectId: 'p', workspaceId: 'w', sessionId: 's1' }], pinned: false, pinnedBy: [] }];

const TRACK = [{ bars: [
  { kind: 'run', runRef: { projectId: 'p', sessionId: 's1', runId: 'r1' }, taskId: 't-run',
    sessionRef: { projectId: 'p', workspaceId: 'w', sessionId: 's1' }, startAt: '2026-11-02T10:00:00.000Z',
    endAt: '2026-11-02T10:20:00.000Z', result: 'completed', reason: null, pauses: [], previous: null },
  { kind: 'check', roundRef: { projectId: 'p', sessionId: 's1', roundId: 'k1' }, taskId: 't-run',
    sessionRef: { projectId: 'p', workspaceId: 'w', sessionId: 's1' }, startAt: '2026-11-02T10:20:00.000Z',
    endAt: '2026-11-02T10:30:00.000Z', result: 'INCONCLUSIVE', ordinal: 2, previous: null, checksBegun: 1 },
], next: null, queriesIncluded: false, hostRestarts: [{ at: '2026-11-02T10:25:00.000Z', approximate: true }] }];

describe('E34-6 the real timeline keeps states and ranges, not missing history', () => {
  it('E34-6 maps each task state at an instant and keeps state words, ranges and real marks', () => {
    const at = taskMapStatesAt(TIMELINE, '2026-11-02T10:25:00.000Z');
    expect(at.get('t-plan')?.st).toBe('pending');
    expect(at.get('t-run')?.st).toBe('verifying');
    expect(at.get('t-pause')?.st).toBe('running');
    expect(at.get('t-defer')?.st).toBe('deferred');
    expect(taskMapStatesAt(TIMELINE, '2026-11-02T09:30:00.000Z').get('t-plan')).toMatchObject({
      st: 'pending', raw: 'not_in_plan', word: '不在计划里', off: true, faint: true,
    });
    expect(at.get('t-unknown')).toMatchObject({ st: 'pending', raw: 'unknown', word: '未知' });

    const time = adaptTaskMapTime(TRACK, null, TIMELINE, LINES);
    const history = time.history.find((row) => row.taskId === 't-pause')!;
    expect(history.segments.map((s) => [s.state, s.word, s.from, s.to])).toEqual([
      ['paused', '已暂停', '2026-11-02T10:00:00.000Z', '2026-11-02T10:10:00.000Z'],
      ['running', '执行中', '2026-11-02T10:10:00.000Z', null],
    ]);
    expect((history.segments[0] as unknown as Record<string, unknown>).reason).toBeUndefined();
    expect((history.segments[0] as unknown as Record<string, unknown>).attemptOrdinal).toBeUndefined();

    const row = time.rows[0]!;
    expect(row.bars.map((b) => [b.kind, b.word, b.ordinal, b.taskId])).toEqual([
      ['run', '已结束', null, 't-run'], ['check', '检查不完整', 2, 't-run'],
    ]);
    expect(row.bars[1]!.marks).toEqual(['检查不完整']);
    expect(time.hostRestarts).toEqual([{ at: '2026-11-02T10:25:00.000Z', approximate: true }]);
  });

  it('E34-6 drags the cursor: the timeline stays and the DAG, 现在 and detail move', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(scene.now));
    const routes: string[] = [];
    let page: Awaited<ReturnType<typeof bootPage>> | undefined;
    try {
      page = await bootPage({
        name: 'TaskMap', search: '?goal=g1', token: 'e34-6-token',
        request: async (url, init) => {
          const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
          if (route !== 'changes') routes.push(route);
          if (route === 'changes') return new Response('{}', { status: 404 });
          const envelope = init?.body === undefined ? {} : JSON.parse(String(init.body)) as { input?: unknown };
          const input = envelope.input ?? envelope;
          return new Response(JSON.stringify(scene.reply(route, input)), { status: 200 });
        },
      });
      expect(page.root.textContent).toContain('状态机规格对齐');
      /* A specific Task's live state, not only the 回放 shell word. */
      expect(findButton(page.root, '取消传播')!.getAttribute('aria-label')).toContain('可领取');
      findButton(page.root, '状态机规格对齐')!.dispatch('click');
      const detailBefore = findClass(page.root, 'detail')!.textContent;
      expect(detailBefore).not.toContain('回放');

      routes.length = 0;
      const axis = findClass(page.root, 'wl-axis')!;
      (axis as unknown as { getBoundingClientRect: () => Record<string, number> }).getBoundingClientRect =
        () => ({ left: 0, top: 0, width: 1000, height: 20, right: 1000, bottom: 20 });
      axis.dispatch('pointerdown', { currentTarget: axis, clientX: 500, pointerId: 1 });
      axis.dispatch('pointermove', { currentTarget: axis, clientX: 700, pointerId: 1 });
      axis.dispatch('pointermove', { currentTarget: axis, clientX: 760, pointerId: 1 });
      await poll(() => routes.includes('tasks/timeline')
        && (findClass(page!.root, 'dg-now')?.textContent ?? '').includes('回放'));
      /* Row 21: the replay demand survives a reread, so every read in replay
         asks `tasks/timeline`; the old "exactly one" changed with that rule. */
      expect(routes.filter((route) => route === 'tasks/timeline').length).toBeGreaterThanOrEqual(1);

      const now = findClass(page!.root, 'dg-now')!;
      expect(now.textContent).toContain('回放');
      /* At the cursor the same node is historical: only the board's history
         query supplies this state, so `hist=null` turns this row red. */
      expect(findButton(page.root, '取消传播')!.getAttribute('aria-label')).toContain('待执行');
      const detailAfter = findClass(page!.root, 'detail')!.textContent;
      expect(detailAfter).not.toBe(detailBefore);
      expect(page.root.textContent).not.toContain('NaN');
      expect(page.root.textContent).not.toContain('undefined');
    } finally {
      await page?.restore();
    }
  }, 60_000);

  /* Named mutations: restore `demand.replay = false` after the first replay
     read (a), or make critPath keep reading `data.dag.crit` at a historical
     cursor (b). */
  it('E34-6 a reread during replay keeps the timeline and recomputes the critical path at t', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(scene.now));
    let page: Awaited<ReturnType<typeof bootPage>> | undefined;
    const routes: string[] = [];
    try {
      page = await bootPage({
        name: 'TaskMap', search: '?goal=g1', token: 'e34-6-replay',
        request: async (url, init) => {
          const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
          if (route !== 'changes') routes.push(route);
          if (route === 'changes') return new Response('{}', { status: 404 });
          const envelope = init?.body === undefined ? {} : JSON.parse(String(init.body)) as { input?: unknown };
          const input = (envelope.input ?? envelope) as Record<string, unknown>;
          const reply = scene.reply(route, input) as unknown as {
            value?: { tasks?: Array<{ taskId: string; segments: Array<{ state: string; from: string | null; to: string | null }> }> };
          };
          if (route === 'tasks/timeline' && reply.value?.tasks !== undefined) {
            /* T26 is pending at the cursor and its downstream Tasks are in the
               plan too, so the open chain through T26 stays the longest one
               (Tasks the timeline still marks not_in_plan are no candidates). */
            for (const taskId of ['T26', 'T32', 'T33']) {
              const task = reply.value.tasks.find((entry) => entry.taskId === taskId);
              if (task !== undefined) task.segments = [{ state: 'pending', from: null, to: null }];
            }
          }
          return new Response(JSON.stringify(reply), { status: 200 });
        },
      });
      expect(page.root.textContent).toContain('状态机规格对齐');
      const axis = findClass(page.root, 'wl-axis')!;
      (axis as unknown as { getBoundingClientRect: () => Record<string, number> }).getBoundingClientRect =
        () => ({ left: 0, top: 0, width: 1000, height: 20, right: 1000, bottom: 20 });
      axis.dispatch('pointerdown', { currentTarget: axis, clientX: 500, pointerId: 1 });
      axis.dispatch('pointermove', { currentTarget: axis, clientX: 760, pointerId: 1 });
      await poll(() => (findClass(page!.root, 'dg-now')?.textContent ?? '').includes('回放'));
      await poll(() => routes.includes('tasks/timeline'));
      const timelineBefore = routes.filter((route) => route === 'tasks/timeline').length;

      /* A later detail read reruns the whole page loop and must keep replay. */
      const detailReads = routes.filter((route) => route === 'graph/detail').length;
      findButton(page.root, 'core-routes 拆分')!.dispatch('click');
      await poll(() => routes.filter((route) => route === 'graph/detail').length > detailReads);
      await poll(() => routes.filter((route) => route === 'tasks/timeline').length > timelineBefore);
      await poll(() => (findClass(page!.root, 'dg-at')?.textContent ?? '').includes('待执行'));
      expect(findClass(page.root, 'dg-now')!.textContent).toContain('回放');
      expect(findClass(page.root, 'dg-at')!.textContent).toContain('待执行');

      findButton(page.root, '关键路径')!.dispatch('click');
      await poll(() => findButton(page!.root, 'core-routes 拆分') !== undefined, 10_000);
      const node = findButton(page.root, 'core-routes 拆分')!;
      expect(node.getAttribute('class')).toContain('is-crit');
      expect(findElement(page.root, (element) => (element.getAttribute('class') ?? '').includes('is-crit'))).toBeDefined();
      expect(page.root.textContent).not.toContain('NaN');
      expect(page.root.textContent).not.toContain('undefined');
    } finally {
      await page?.restore();
      vi.useRealTimers();
    }
  }, 60_000);

  it('E34-6 a Task the plan adopts later is not on the critical path before it entered the plan', async () => {
    /* Row 5: the real timeline returns `not_in_plan` before the plan adopts
       T33; the adapter keeps that as off/faint. At a cursor before adoption
       the critical path must treat the off Task as absent, not as pending. */
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(scene.now));
    let page: Awaited<ReturnType<typeof bootPage>> | undefined;
    const adoption = '2026-10-04T14:00:00+08:00';
    try {
      page = await bootPage({
        name: 'TaskMap', search: '?goal=g1', token: 'e34-6-adopt',
        request: async (url, init) => {
          const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
          if (route === 'changes') return new Response('{}', { status: 404 });
          const envelope = init?.body === undefined ? {} : JSON.parse(String(init.body)) as { input?: unknown };
          const input = (envelope.input ?? envelope) as Record<string, unknown>;
          const reply = scene.reply(route, input) as unknown as {
            value?: { tasks?: Array<{ taskId: string; segments: Array<{ state: string; from: string | null; to: string | null }> }> };
          };
          if (route === 'tasks/timeline' && reply.value?.tasks !== undefined) {
            for (const task of reply.value.tasks) {
              task.segments = task.taskId === 'T33'
                ? [{ state: 'not_in_plan', from: null, to: adoption },
                   { state: 'pending', from: adoption, to: null }]
                : [{ state: task.taskId === 'GATE' ? 'pending' : 'satisfied', from: null, to: null }];
            }
          }
          return new Response(JSON.stringify(reply), { status: 200 });
        },
      });
      expect(page.root.textContent).toContain('状态机规格对齐');
      const axis = findClass(page.root, 'wl-axis')!;
      (axis as unknown as { getBoundingClientRect: () => Record<string, number> }).getBoundingClientRect =
        () => ({ left: 0, top: 0, width: 1000, height: 20, right: 1000, bottom: 20 });
      axis.dispatch('pointerdown', { currentTarget: axis, clientX: 500, pointerId: 1 });
      axis.dispatch('pointermove', { currentTarget: axis, clientX: 760, pointerId: 1 });
      await poll(() => (findClass(page!.root, 'dg-now')?.textContent ?? '').includes('回放'));
      await poll(() => (findButton(page!.root, '服务拆分验收')?.getAttribute('aria-label') ?? '').includes('不在计划里'));
      findButton(page.root, '关键路径')!.dispatch('click');
      await poll(() => findButton(page!.root, '服务拆分验收') !== undefined, 10_000);
      const node = findButton(page.root, '服务拆分验收')!;
      expect(node.getAttribute('aria-label')).toContain('不在计划里');
      expect(node.getAttribute('class')).not.toContain('is-crit');
    } finally {
      await page?.restore();
      vi.useRealTimers();
    }
  }, 60_000);

  it('E34-6 a goal end adopted later leaves the old open Tasks on the critical path before adoption', async () => {
    /* Row B: the plan's only end (GATE) arrives with a later adoption and the old
       Tasks keep their real unfinished states. Before adoption GATE and its edges
       do not exist, so the ends are the Tasks that fed it. Hand-computed from the
       scene: T13 running (1), T15 failed on T13 (2), T18 pending on T15 (3); the
       other ends reach at most 2. Named mutation: keep an absent successor's edge
       when choosing the end; every Task then has a successor, the only end is the
       absent GATE of length zero, and the path comes back empty. */
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(scene.now));
    let page: Awaited<ReturnType<typeof bootPage>> | undefined;
    const adoption = '2026-10-04T14:00:00+08:00';
    try {
      page = await bootPage({
        name: 'TaskMap', search: '?goal=g1', token: 'e34-6-end',
        request: async (url, init) => {
          const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
          if (route === 'changes') return new Response('{}', { status: 404 });
          const envelope = init?.body === undefined ? {} : JSON.parse(String(init.body)) as { input?: unknown };
          const input = (envelope.input ?? envelope) as Record<string, unknown>;
          const reply = scene.reply(route, input) as unknown as {
            value?: { tasks?: Array<{ taskId: string; segments: Array<{ state: string; from: string | null; to: string | null }> }> };
          };
          if (route === 'tasks/timeline' && reply.value?.tasks !== undefined) {
            reply.value.tasks.find((task) => task.taskId === 'GATE')!.segments = [
              { state: 'not_in_plan', from: null, to: adoption },
              { state: 'pending', from: adoption, to: null },
            ];
          }
          return new Response(JSON.stringify(reply), { status: 200 });
        },
      });
      expect(page.root.textContent).toContain('状态机规格对齐');
      const axis = findClass(page.root, 'wl-axis')!;
      (axis as unknown as { getBoundingClientRect: () => Record<string, number> }).getBoundingClientRect =
        () => ({ left: 0, top: 0, width: 1000, height: 20, right: 1000, bottom: 20 });
      axis.dispatch('pointerdown', { currentTarget: axis, clientX: 500, pointerId: 1 });
      axis.dispatch('pointermove', { currentTarget: axis, clientX: 760, pointerId: 1 });
      await poll(() => (findClass(page!.root, 'dg-now')?.textContent ?? '').includes('回放'));
      await poll(() => (findButton(page!.root, '目标验收')?.getAttribute('aria-label') ?? '').includes('不在计划里'));
      findButton(page.root, '关键路径')!.dispatch('click');
      await poll(() => findClass(page!.root, 'dg-node') !== undefined, 10_000);
      const onPath = findAllClass(page.root, 'dg-node')
        .filter((node) => (node.getAttribute('class') ?? '').split(/\s+/).includes('is-crit'))
        .map((node) => node.textContent);
      expect(['重新入队与失败类别', '启动核对', '重新入队验收'].map((name) =>
        onPath.filter((text) => text.includes(name)).length)).toEqual([1, 1, 1]);
      expect(onPath.some((text) => text.includes('目标验收'))).toBe(false);
      expect(onPath).toHaveLength(3);
    } finally {
      await page?.restore();
      vi.useRealTimers();
    }
  }, 60_000);
});
