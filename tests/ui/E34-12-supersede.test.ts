import { afterEach, afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { committedRouteValue, createHostClient, readyRouteValue } from '../../src/ui/host-client.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { readTaskMap } from '../../src/ui/boot.js';
import {
  adaptTaskMap, adaptTaskMapDetail, type TaskMapDisplayRead, type TaskMapGoalRead, type TaskMapGraphRead,
  type TaskMapNodeDetailData, type TaskMapSummaryRead,
} from '../../src/ui/adapters/task-map.js';
import {
  adoptPLPlanDraft, adoptPLTwoStageSkeleton, openPLWorkflowWorld, plSupersedeDraft,
  type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';
import { bootPage, findButton, findClass } from './helpers/boot-page.js';
import { scene } from './helpers/task-map-scene.js';
import { until } from '../helpers/change-stream-reader.js';
import { BoardView } from '../../src/ui/runtime.js';
import { loadBoard } from './helpers/board-files.js';
import type { PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { VNode } from '../../src/ui/render.js';

/** E34-12 (ruling 2/5): a real future revision records cancellation/replacement;
 * the date comes from the real `setIn` Plan's acceptedAt, and the detail adapter
 * hides missing plan files, per-file counts and attempt ordinals while keeping
 * status words and times. */
function vText(node: VNode): string {
  return node.kind === 'text' ? node.text : node.children.map(vText).join('');
}

function vWithClass(nodes: VNode[], name: string): (VNode & { kind: 'element' }) | undefined {
  for (const node of nodes) {
    if (node.kind === 'text') continue;
    const cls = node.attrs.find((attr) => attr.name === 'class');
    if (cls !== undefined && typeof cls.value === 'string' && cls.value.split(/\s+/).includes(name)) return node;
    const found = vWithClass(node.children, name);
    if (found !== undefined) return found;
  }
  return undefined;
}

let pl: PLWorkflowWorld | undefined;
let before: PlanRevisionSnapshot;
let after: PlanRevisionSnapshot;
let detail: TaskMapNodeDetailData | null = null;

/* Browser-local `MM-DD HH:mm`, the same Intl rule the page uses; never an ISO slice. */
const shortAt = (iso: string): string => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const part = (type: string): string => parts.find((entry) => entry.type === type)?.value ?? '';
  return part('month') + '-' + part('day') + ' ' + part('hour') + ':' + part('minute');
};

beforeAll(async () => {
  pl = await openPLWorkflowWorld({ backend: 'memory', label: 'e34-12' });
  const skeleton = await adoptPLTwoStageSkeleton(pl.main, pl.goal, { label: 'e34-12' });
  before = skeleton.plan;
  const draft = plSupersedeDraft(before, pl.goal, 'e34-12');
  const proposed = await pl.main.post('plans/propose', graphWrite(pl.main.scope, {
    goalRef: pl.goal, basedOn: before.ref, draft, reason: { text: 'E34-12 supersede', sources: [] },
  }, 'e34-12-supersede-propose'));
  const proposal = committedRouteValue<{ ref: unknown; revision: number }>(proposed as never, 'plans/propose');
  const applied = await pl.main.post('plans/apply', graphWrite(pl.main.scope, {
    proposalRef: proposal.ref, expectedProposalRevision: proposal.revision, decisionRefs: [],
  }, 'e34-12-supersede-apply'));
  committedRouteValue(applied as never, 'plans/apply');
  const plan = await pl.main.activePlan(pl.goal);
  if (plan === null) throw new Error('E34-12: no adopted revision');
  after = plan;
}, 40_000);

afterEach(() => { vi.useRealTimers(); });

afterAll(async () => { await pl?.close(); pl = undefined; });

describe('E34-12 a real future revision and the detail subrows', () => {
  /* Named mutation: delete the board's dropped read action; the row keeps the
     word but loses the date. The page must ask, not mount a pre-read map. */
  it('E34-12 the drop button reads the disposition date', async () => {
    let page: Awaited<ReturnType<typeof bootPage>> | undefined;
    const planRefs: unknown[] = [];
    try {
      page = await bootPage({
        name: 'TaskMap', search: `?goal=${pl!.goal.goalId}`, token: pl!.world.token,
        request: async (url, init, realFetch) => {
          const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
          if (route === 'tasks/query') {
            const envelope = JSON.parse(String(init?.body ?? '{}')) as { input?: { planRef?: unknown } };
            if (envelope.input?.planRef !== undefined) planRefs.push(envelope.input.planRef);
          }
          return realFetch(new URL(url, pl!.world.base).href, init);
        },
      });
      await until(() => findClass(page!.root, 'dg-drop-btn') !== undefined, 20_000);
      findClass(page.root, 'dg-drop-btn')!.dispatch('click');
      await until(() => (findClass(page!.root, 'dg-drop-why')?.textContent ?? '').includes(shortAt(after.acceptedAt)), 20_000);
      expect(findClass(page.root, 'dg-drop-why')!.textContent).toContain(shortAt(after.acceptedAt));
      expect(planRefs.length).toBeGreaterThan(0);
      expect(planRefs).toContainEqual(after.ref);
    } finally {
      await page?.restore();
    }
  }, 40_000);

  it('E34-12 records the replacement and its real setIn date, and hides missing detail subrows', async () => {
    const client = createHostClient(pl!.world.token, new URL(pl!.world.base).origin);
    const { data } = await readTaskMap(client, pl!.goal.goalId, { dropped: true });
    expect(data).not.toBeNull();
    const dropped = data!.dag.dropped.find((row) => row.id === 'pl-a');
    expect(dropped?.word).toBe('已替代');
    expect(dropped?.at).toBe(shortAt(after.acceptedAt));
    expect(after.tasks.find((task) => task.taskId === 'pl-a')?.disposition).toBe('superseded');
    expect(after.tasks.find((task) => task.taskId === 'pl-a')?.replacedByTaskId).toBe('pl-a2');
    expect(dropped?.why).toBe('E34-12 supersede');

    const boot = await client.bootstrap();
    const scope = boot.workspaces[0]!.scope;
    const graph = readyRouteValue<{
      plan: { ref: unknown }; tasks: Array<{ ref: unknown }>;
    }>(await client.post('tasks/query', scope, {
      goalRef: { aggregateType: 'Goal', projectId: scope.projectId, goalId: pl!.goal.goalId },
    }), 'tasks/query');
    const row = graph.tasks.find((entry) => (entry.ref as { taskId?: string }).taskId === 'pl-a2')!;
    const summary = readyRouteValue<TaskMapSummaryRead>(await client.post('graph/detail', scope, {
      goalRef: { aggregateType: 'Goal', projectId: scope.projectId, goalId: pl!.goal.goalId },
      node: { kind: 'task', ref: row.ref, planRef: graph.plan.ref },
      section: 'summary', page: { afterCursor: null, limit: 100 },
    }), 'graph/detail');
    detail = adaptTaskMapDetail(summary, [], null, null, 'pending');
    expect(detail?.word).toBe('待执行');
    expect(detail?.hasFiles).toBe(false);
    expect(detail?.files).toEqual([]);
    expect(detail?.attemptOrdinal).toBeNull();
    expect((detail as unknown as Record<string, unknown>).lineCounts).toBeUndefined();
    expect((detail as unknown as Record<string, unknown>).plannedFiles).toBeUndefined();
    expect(detail?.disposition).toBeNull();

    /* Render the already-read map: the drop row expands from the same public
       read, so no extra page/SSE teardown is involved. */
    const board = loadBoard('TaskMap', fileURLToPath(new URL('../../src/ui/boards/', import.meta.url)));
    const view = new BoardView(board, { ...board.defaults, data: data!, readState: { status: 'ready' }, dataVersion: 1 });
    view.render();
    const drop = vWithClass(view.tree, 'dg-drop-btn')!;
    const click = drop.attrs.find((attr) => attr.name === 'onClick');
    (click!.value as { handler: (event: unknown) => void }).handler({});
    const rowText = vText(vWithClass(view.tree, 'dg-drop-row')!);
    expect(rowText).toContain('已替代');
    expect(rowText).toContain(shortAt(after.acceptedAt));
    expect(rowText).not.toContain('第 1 次尝试');
  }, 40_000);

  it('E34-12 a dropped task without setIn keeps its word and hides only the date', () => {
    const goal: TaskMapGoalRead = { goal: { ref: { goalId: 'g1' }, objective: 'E34-12 目标' } };
    const display: TaskMapDisplayRead = { display: { phase: 'RUNNING' } };
    const graph = {
      plan: { ref: { planId: 'p1', revision: 1 }, stages: [], executionDag: { dependsOn: [] }, obligations: [], tasks: [] },
      tasks: [{
        ref: { projectId: 'p', goalId: 'g1', taskId: 'gone' },
        definition: { taskId: 'gone', title: '被替代的任务', disposition: 'superseded', phase: 'pending' },
        effectivePhase: 'pending', disposition: 'superseded',
        dispositionChange: { replacedByTaskId: 'done', reason: { text: 'E34-12 无日期' }, setIn: null },
      }],
    } as unknown as TaskMapGraphRead;
    const data = adaptTaskMap(goal, graph, display);
    expect(data.dag.dropped[0]).toMatchObject({ id: 'gone', word: '已替代', why: 'E34-12 无日期' });
    expect(data.dag.dropped[0]!.at).toBeUndefined();

    const board = loadBoard('TaskMap', fileURLToPath(new URL('../../src/ui/boards/', import.meta.url)));
    const view = new BoardView(board, { ...board.defaults, data, readState: { status: 'ready' }, dataVersion: 1 });
    view.render();
    const button = vWithClass(view.tree, 'dg-drop-btn')!;
    const click = button.attrs.find((attr) => attr.name === 'onClick');
    (click!.value as { handler: (event: unknown) => void }).handler({});
    const row = vText(vWithClass(view.tree, 'dg-drop-row')!);
    expect(row).toContain('已替代');
    expect(row).toContain('E34-12 无日期');
    expect(row).not.toMatch(/\d{2}-\d{2} \d{2}:\d{2}/);
  });

  it('E34-12 actual files with availability=file show the real file text', () => {
    const summary = {
      section: 'summary',
      task: {
        task: { taskId: 't-file', title: '有实际文件' }, phase: 'pending', disposition: 'active',
        actualFiles: { availability: 'available', value: [{ runRef: { runId: 'r1' }, path: 'src/ui/x.ts', certainty: 'definite' }] },
      },
    } as unknown as TaskMapSummaryRead;
    const detail = adaptTaskMapDetail(summary, [], null, null, 'pending')!;
    expect(detail.hasFiles).toBe(true);
    expect(detail.files[0]!.files[0]!.name).toBe('x.ts');
    expect(detail.files[0]!.files[0]!.tag).toBe('实际改过');
    expect(detail.files[0]!.files[0]!.path).toBe('src/ui/x.ts');
  });

  it('E34-12 real rework entries render without a fabricated attempt ordinal', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(scene.now));
    let page: Awaited<ReturnType<typeof bootPage>> | undefined;
    try {
      page = await bootPage({
        name: 'TaskMap', search: '?goal=g1', token: 'e34-12-token',
        request: async (url, init) => {
          const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
          if (route === 'changes') return new Response('{}', { status: 404 });
          const envelope = init?.body === undefined ? {} : JSON.parse(String(init.body)) as { input?: unknown };
          const input = envelope.input ?? envelope;
          return new Response(JSON.stringify(scene.reply(route, input)), { status: 200 });
        },
      });
      findButton(page.root, '检查不完整判定')!.dispatch('click');
      const detail = findClass(page.root, 'detail')!.textContent;
      expect(detail).toContain('系统自动');
      expect(detail).toContain('lint 3 项');
      expect(detail).not.toContain('第 1 次尝试');
    } finally {
      await page?.restore();
    }
  }, 40_000);

  /* Named mutation: restore `out.hasArch = !S.live && arch.length > 0`, which
     hides the live task's real files. */
  it('E34-12 a live task detail shows its actual files', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(scene.now));
    let page: Awaited<ReturnType<typeof bootPage>> | undefined;
    const start = performance.now();
    try {
      page = await bootPage({
        name: 'TaskMap', search: '?goal=g1', token: 'e34-12-files',
        request: async (url, init) => {
          const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
          if (route === 'changes') return new Response('{}', { status: 404 });
          /* The catalog branch groups each actual file under its module; a page
             without it puts the same file under 未归入模块. */
          if (route === 'architecture/read') {
            return new Response(JSON.stringify({ status: 'ready', value: { catalog: { catalog: {
              modules: [{ ref: { moduleId: 'e34-12-ui' }, name: '界面', paths: ['src/ui/'] }],
              containment: { parentOf: [] },
            } } } }), { status: 200 });
          }
          const envelope = init?.body === undefined ? {} : JSON.parse(String(init.body)) as { input?: unknown };
          const input = (envelope.input ?? envelope) as Record<string, unknown>;
          const reply = scene.reply(route, input) as { value?: { task?: Record<string, unknown> } };
          if (route === 'graph/detail' && reply.value?.task !== undefined) {
            reply.value.task.actualFiles = {
              availability: 'available',
              value: [{ runRef: { runId: 'r1' }, path: 'src/ui/x.ts', workspaceId: 'scene', certainty: 'definite' }],
            };
          }
          return new Response(JSON.stringify(reply), { status: 200 });
        },
      });
      while (!page.root.textContent.includes('重新入队与失败类别')) {
        if (performance.now() - start > 20_000) throw new Error('condition not reached in time');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      findButton(page.root, '重新入队与失败类别')!.dispatch('click');
      while (!(findClass(page!.root, 'detail')?.textContent ?? '').includes('实际改过')) {
        if (performance.now() - start > 20_000) throw new Error('condition not reached in time');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const detail = findClass(page.root, 'detail')!.textContent;
      expect(detail).toContain('实际改过');
      expect(detail).toContain('x.ts');
      expect(detail).toContain('界面');
      expect(detail).not.toContain('未归入模块');
      expect(page.root.textContent).not.toContain('NaN');
    } finally {
      await page?.restore();
      vi.useRealTimers();
    }
  }, 60_000);
});
