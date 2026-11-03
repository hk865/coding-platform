import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootPage, findButton, findClass, type PageFetch } from './helpers/boot-page.js';
import { ag2bPlanDraft, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { openS6ARequestWorld, S6A_GOAL_1, S6A_SCOPE, type S6ARequestWorld } from '../helpers/S6A-request-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { governS6B } from '../helpers/S6B1-fixture.js';
import { until } from '../helpers/change-stream-reader.js';
import { draftFrom } from '../scenarios/support/common.js';

/** E34-10 (design §3/§6): a deferred Task adopted through the public plan routes
 * reaches the open DAG and detail; the person's selection, collapsed stage, pin
 * and open time window survive the reread, and a failed reread keeps the last
 * data instead of blanking the page. */
let world: S6ARequestWorld | undefined;

const forward: PageFetch = async (url, init, realFetch) => realFetch(new URL(url, world!.base).href, init);

async function adoptDeferredPlan(label: string): Promise<void> {
  const draft = ag2bPlanDraft(['e34-10-a', 'e34-10-b']);
  draft.planId = 'e34-10-plan'; draft.goalId = S6A_GOAL_1.goalId;
  draft.stages = [
    { stageId: 'e34-10-stage-a', title: 'E34-10 阶段 A' },
    { stageId: 'e34-10-stage-b', title: 'E34-10 阶段 B' },
  ];
  draft.tasks = draft.tasks.map((task) => {
    const stageId = task.taskId === 'e34-10-a' ? 'e34-10-stage-a' : 'e34-10-stage-b';
    return { ...task, stageId, title: '独立工作 ' + task.taskId, scope: { kind: 'stage' as const, stageId } };
  });
  const proposed = await world!.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: S6A_GOAL_1, basedOn: null, draft, reason: { text: `E34-10 ${label} plan`, sources: [] },
  }, `e34-10-${label}-propose`));
  const proposal = proposed.body as { status?: string; value?: { ref?: unknown; revision?: number } };
  if (proposal.status !== 'committed') throw new Error('E34-10: the proposal did not commit');
  const applied = await world!.post('plans/apply', graphWrite(S6A_SCOPE, {
    proposalRef: proposal.value?.ref, expectedProposalRevision: proposal.value?.revision, decisionRefs: [],
  }, `e34-10-${label}-apply`));
  if ((applied.body as { status?: string }).status !== 'committed') throw new Error('E34-10: the adoption did not commit');
}

async function defer(taskId: string): Promise<void> {
  const read = await world!.post('tasks/query', plain(S6A_SCOPE, { goalRef: S6A_GOAL_1 }));
  const graph = (read.body as { value?: { plan: Parameters<typeof draftFrom>[0] } }).value;
  if (graph === undefined) throw new Error('E34-10: no task graph');
  const draft = draftFrom(graph.plan, 'e34-10-defer', (next) => ({
    ...next, tasks: next.tasks.map((task) => task.taskId === taskId ? { ...task, disposition: 'deferred' as const } : task),
  }));
  const proposed = await world!.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: S6A_GOAL_1, basedOn: graph.plan.ref, draft, reason: { text: `E34-10 defer ${taskId}`, sources: [] },
  }, 'e34-10-defer-propose'));
  const proposal = proposed.body as { status?: string; value?: { ref?: unknown; revision?: number } };
  if (proposal.status !== 'committed') throw new Error('E34-10: the deferral proposal did not commit');
  const applied = await world!.post('plans/apply', graphWrite(S6A_SCOPE, {
    proposalRef: proposal.value?.ref, expectedProposalRevision: proposal.value?.revision, decisionRefs: [],
  }, 'e34-10-defer-apply'));
  if ((applied.body as { status?: string }).status !== 'committed') throw new Error('E34-10: the deferral did not commit');
}

beforeAll(async () => {
  const opened = await openS6ARequestWorld({ backend: 'memory' });
  world = opened;
  await governS6B(opened, s6aCardsWorkspace(opened, S6A_SCOPE), opened.goals);
  await adoptDeferredPlan('adopt');
}, 40_000);

afterAll(async () => { await world?.close(); world = undefined; });

describe('E34-10 an external deferral updates the open page without losing its place', () => {
  it('E34-10 keeps selection, collapsed stage, pin and the open window, then keeps data when a reread fails', async () => {
    let fail = false;
    /* The track window is the from/to the page asks for; the fake execution
       index gives 全部 one day before this week so its request window is
       distinguishable from 本周's on any weekday. */
    const trackInputs: Array<{ from?: string; to?: string }> = [];
    const executionReads: unknown[] = [];
    const weekStart = (() => {
      const d = new Date();
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
    })();
    const quarter = (ms: number): string => new Date(Math.floor(ms / (15 * 60_000)) * 15 * 60_000).toISOString();
    const oldStart = weekStart - 24 * 60 * 60_000;
    const page = await bootPage({
      name: 'TaskMap', search: `?goal=${S6A_GOAL_1.goalId}`, token: world!.token,
      request: async (url, init, realFetch) => {
        if (fail && !url.includes('/changes')) throw new Error('E34-10: the reread failed');
        const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
        const envelope = JSON.parse(String(init?.body ?? '{}')) as { input?: unknown };
        if (route === 'activity/track') trackInputs.push(envelope.input as { from?: string; to?: string });
        if (route === 'executions/list') {
          executionReads.push(envelope.input);
          return new Response(JSON.stringify({ status: 'ready', value: { items: [{
            run: { ref: { aggregateType: 'Run', projectId: S6A_GOAL_1.projectId, goalId: S6A_GOAL_1.goalId,
              runId: 'e34-10-old-run' }, task: { taskId: 'e34-10-a' }, startedAt: new Date(oldStart).toISOString() },
          }], nextCursor: null } }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return realFetch(new URL(url, world!.base).href, init);
      },
    });
    try {
      /* select task A in the DAG and pin it by double-click */
      findButton(page.root, 'DAG')!.dispatch('click');
      findButton(page.root, '独立工作 e34-10-a')!.dispatch('click');
      expect(findClass(page.root, 'detail')!.textContent).toContain('独立工作 e34-10-a');
      findButton(page.root, '独立工作 e34-10-a')!.dispatch('dblclick');
      expect(findClass(page.root, 'detail')!.textContent).toContain('已固定');
      /* collapse stage A in the outline */
      findButton(page.root, '大纲')!.dispatch('click');
      findButton(page.root, 'E34-10 阶段 A')!.dispatch('click');
      findButton(page.root, 'E34-10 阶段 A')!.dispatch('click');
      expect(findButton(page.root, 'E34-10 阶段 A')!.getAttribute('aria-expanded')).toBe('false');

      /* The time window is only real if the track was actually opened; select
         本周 there and prove the request asks for that week, not today. */
      findButton(page.root, '轨道')!.dispatch('click');
      findButton(page.root, '本周')!.dispatch('click');
      await until(() => trackInputs.some((input) => input.from === quarter(weekStart)), 15_000);
      expect(findButton(page.root, '本周')!.getAttribute('aria-pressed')).toBe('true');
      /* Switching back to 轨道 must keep the window the button shows. */
      findButton(page.root, 'DAG')!.dispatch('click');
      const beforeLanes = trackInputs.length;
      findButton(page.root, '轨道')!.dispatch('click');
      await until(() => trackInputs.length > beforeLanes, 15_000);
      expect(trackInputs.at(-1)!.from).toBe(quarter(weekStart));
      /* 全部 reads the execution index and starts the track at its earliest
         start, so the request window follows the button too. */
      findButton(page.root, '全部')!.dispatch('click');
      await until(() => executionReads.length > 0 && trackInputs.some((input) =>
        Date.parse(input.from ?? '') <= oldStart), 20_000);
      expect(findButton(page.root, '全部')!.getAttribute('aria-pressed')).toBe('true');
      expect(trackInputs.at(-1)!.from).toBe(quarter(oldStart));
      /* Back to 本周 for the deferred reread below. */
      findButton(page.root, '本周')!.dispatch('click');
      await until(() => trackInputs.at(-1)?.from === quarter(weekStart), 15_000);

      await defer('e34-10-a');
      findButton(page.root, 'DAG')!.dispatch('click');
      await until(() => (findClass(page.root, 'detail')?.textContent ?? '').includes('已延后'), 15_000);
      expect(findClass(page.root, 'detail')!.textContent).toContain('独立工作 e34-10-a');
      expect(findClass(page.root, 'detail')!.textContent).toContain('已固定');
      findButton(page.root, '大纲')!.dispatch('click');
      expect(findButton(page.root, 'E34-10 阶段 A')!.getAttribute('aria-expanded')).toBe('false');

      /* a failed reread keeps the last data and marks the page stale */
      fail = true;
      findButton(page.root, 'DAG')!.dispatch('click');
      expect(findButton(page.root, '本周')!.getAttribute('aria-pressed')).toBe('true');
      findButton(page.root, '独立工作 e34-10-b')!.dispatch('click');
      await until(() => findClass(page.root, 'detail') !== undefined
        && page.root.textContent.includes('读取失败'), 15_000);
      expect(page.root.textContent).toContain('独立工作 e34-10-a');
      expect(page.root.textContent).toContain('独立工作 e34-10-b');
    } finally {
      await page.restore();
    }
  }, 60_000);
});
