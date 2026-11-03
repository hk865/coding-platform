import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootPage, findButton, findClass, type PageFetch } from './helpers/boot-page.js';
import { BOARD_NAMES } from './helpers/board-files.js';
import {
  AG2B_PROJECT_REF, AG2B_WORKSPACE_REF, ag2bPlanDraft, graphWrite, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import {
  openS6ARequestWorld, S6A_GOAL_1, S6A_SCOPE, type S6ARequestWorld,
} from '../helpers/S6A-request-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { governS6B } from '../helpers/S6B1-fixture.js';
import { until } from '../helpers/change-stream-reader.js';
import { draftFrom } from '../scenarios/support/common.js';

/**
 * E33-1/2/6/7 at the page level: a real Host, the real routes and the real
 * `bootBoardPage` entry. The page source, token meta and DOM are the served
 * page; the world writes through public routes, and the page notices without a
 * user action (ruling items 3, 4, 6, 7 and 8). E33-7 keeps the nine other
 * boards on their sample mount with zero change-stream requests.
 */

let world: S6ARequestWorld | undefined;

const forward: PageFetch = async (url, init, realFetch) => realFetch(new URL(url, world!.base).href, init);

async function adoptE33Plan(goal: typeof S6A_GOAL_1, draft: ReturnType<typeof ag2bPlanDraft>, label: string): Promise<void> {
  const proposed = await world!.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: goal, basedOn: null, draft, reason: { text: `E33 ${label} plan`, sources: [] },
  }, `e33-${label}-propose`));
  const proposal = proposed.body as { status?: string; value?: { ref?: unknown; revision?: number } };
  if (proposal.status !== 'committed') throw new Error(`E33: the ${label} proposal did not commit: ${JSON.stringify(proposal)}`);
  const applied = await world!.post('plans/apply', graphWrite(S6A_SCOPE, {
    proposalRef: proposal.value?.ref, expectedProposalRevision: proposal.value?.revision, decisionRefs: [],
  }, `e33-${label}-apply`));
  if ((applied.body as { status?: string }).status !== 'committed') {
    throw new Error(`E33: the ${label} adoption did not commit: ${JSON.stringify(applied.body)}`);
  }
}

/** A future plan revision that defers one Task, through `plans/propose` + `plans/apply`. */
async function defer(taskId: string, planId: string): Promise<void> {
  const read = await world!.post('tasks/query', plain(S6A_SCOPE, { goalRef: S6A_GOAL_1 }));
  const graph = (read.body as { value?: { plan: Parameters<typeof draftFrom>[0] } }).value;
  if (graph === undefined) throw new Error(`E33: the task graph is not readable: ${JSON.stringify(read.body)}`);
  const draft = draftFrom(graph.plan, planId, (next) => ({
    ...next, tasks: next.tasks.map((task) => task.taskId === taskId ? { ...task, disposition: 'deferred' as const } : task),
  }));
  const proposed = await world!.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: S6A_GOAL_1, basedOn: graph.plan.ref, draft, reason: { text: `E33 defer ${taskId}`, sources: [] },
  }, `e33-${planId}-propose`));
  const proposal = proposed.body as { status?: string; value?: { ref?: unknown; revision?: number } };
  if (proposal.status !== 'committed') throw new Error(`E33: the deferral proposal did not commit: ${JSON.stringify(proposal)}`);
  const applied = await world!.post('plans/apply', graphWrite(S6A_SCOPE, {
    proposalRef: proposal.value?.ref, expectedProposalRevision: proposal.value?.revision, decisionRefs: [],
  }, `e33-${planId}-apply`));
  if ((applied.body as { status?: string }).status !== 'committed') {
    throw new Error(`E33: the deferral did not commit: ${JSON.stringify(applied.body)}`);
  }
}

beforeAll(async () => {
  const opened = await openS6ARequestWorld({ backend: 'memory' });
  world = opened;
  await governS6B(opened, s6aCardsWorkspace(opened, S6A_SCOPE), opened.goals);
  const draft = ag2bPlanDraft(['e33-a', 'e33-b']);
  draft.planId = 'e33-plan';
  draft.goalId = S6A_GOAL_1.goalId;
  draft.stages = [
    { stageId: 'e33-a-stage', title: 'E33 阶段 A' },
    { stageId: 'e33-b-stage', title: 'E33 阶段 B' },
  ];
  draft.tasks = draft.tasks.map((task) => {
    const stageId = task.taskId === 'e33-a' ? 'e33-a-stage' : 'e33-b-stage';
    return { ...task, stageId, scope: { kind: 'stage' as const, stageId } };
  });
  await adoptE33Plan(S6A_GOAL_1, draft, 'e33');
}, 30_000);

afterAll(async () => {
  await world?.close();
  world = undefined;
});

describe('E33-1 an external write reaches the open page', () => {
  it('E33-1 a deferral through the real routes changes the outline with no page action', async () => {
    const page = await bootPage({
      name: 'TaskMap', search: `?goal=${S6A_GOAL_1.goalId}`, token: world!.token, request: forward,
    });
    try {
      /* Ruling 3: the default page is the DAG with its dock and now column. */
      expect(findClass(page.root, 'dg-now')).toBeDefined();
      expect(findClass(page.root, 'is-dock')).toBeDefined();
      findButton(page.root, '大纲')!.dispatch('click');
      findButton(page.root, 'E33 阶段 A')!.dispatch('click');
      expect(page.root.textContent).toContain('Independent work e33-a');
      expect(page.root.textContent).toContain('待执行');
      await defer('e33-a', 'e33-plan-defer-a');
      await until(() => page.root.textContent.includes('已延后'), 10_000);
      expect(page.root.textContent).toContain('Independent work e33-a');
    } finally {
      await page.restore();
    }
  }, 30_000);
});

describe('E33-2 the person’s selection and expansion survive a reread', () => {
  it('E33-2 selected task and collapsed stage stay put while the detail shows the new word', async () => {
    const page = await bootPage({
      name: 'TaskMap', search: `?goal=${S6A_GOAL_1.goalId}`, token: world!.token, request: forward,
    });
    try {
      /* The outline is not the default view; collapse is an outline action. */
      findButton(page.root, '大纲')!.dispatch('click');
      const stageA = (): ReturnType<typeof findButton> => findButton(page.root, 'E33 阶段 A');
      for (let click = 0; click < 4 && stageA()!.getAttribute('aria-expanded') !== 'false'; click += 1) {
        const before = stageA()!.getAttribute('aria-expanded');
        stageA()!.dispatch('click');
        await until(() => stageA()!.getAttribute('aria-expanded') !== before, 2_000);
      }
      expect(stageA()!.getAttribute('aria-expanded')).toBe('false');
      expect(findButton(page.root, 'Independent work e33-a')).toBeUndefined();

      /* B is still there: open it, select its Task, then let the real reread
         update the same detail to 已延后. */
      findButton(page.root, 'E33 阶段 B')!.dispatch('click');
      findButton(page.root, 'Independent work e33-b')!.dispatch('click');
      await until(() => (findClass(page.root, 'detail')?.textContent ?? '').includes('Independent work e33-b'), 10_000);
      expect(findClass(page.root, 'detail')!.textContent).toContain('待执行');
      await defer('e33-b', 'e33-plan-defer-b');
      await until(() => (findClass(page.root, 'detail')?.textContent ?? '').includes('已延后'), 10_000);
      expect(findClass(page.root, 'detail')!.textContent).toContain('Independent work e33-b');
      expect(findButton(page.root, 'Independent work e33-a')).toBeUndefined();
    } finally {
      await page.restore();
    }
  }, 30_000);
});

describe('E33-6 a Goal created after the empty page appears', () => {
  it('E33-6 the empty page subscribes and shows the new Goal and its no-plan text', async () => {
    const empty = await openS6ARequestWorld({ backend: 'memory', defaultGoals: false });
    try {
      const page = await bootPage({
        name: 'TaskMap', token: empty.token,
        request: async (url, init, realFetch) => realFetch(new URL(url, empty.base).href, init),
      });
      try {
        expect(page.root.textContent).toContain('这个项目还没有目标。');
        const created = await empty.post('goals/create', graphWrite(S6A_SCOPE, {
          goalId: 'e33-new-goal', workspace: S6A_SCOPE, objective: 'E33 新目标',
        }, 'e33-new-goal', [{ ref: AG2B_PROJECT_REF, revision: 1 }, { ref: AG2B_WORKSPACE_REF, revision: 1 }]));
        expect((created.body as { status?: string }).status).toBe('committed');
        await until(() => page.root.textContent.includes('E33 新目标'), 10_000);
        expect(page.root.textContent).toContain('这个目标还没有采用的计划。');
      } finally {
        await page.restore();
      }
    } finally {
      await empty.close();
    }
  }, 30_000);
});

const NINE_BOARDS = BOARD_NAMES.filter((name) => name !== 'TaskMap');

describe('E33-7 only the wired board opens a change stream', () => {
  it.each(NINE_BOARDS)('E33-7 %s mounts the sample with zero changes requests', async (name) => {
    let changes = 0;
    const page = await bootPage({
      name, token: 'e33-token',
      request: async (url) => {
        if (url.includes('/api/real/core/changes')) changes += 1;
        const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
        const replies: Record<string, unknown> = {
          bootstrap: { workspaces: [{ scope: { projectId: 'e33-p', workspaceId: 'e33-w' }, name: 'E33', workspaceRevision: 1 }], review: null, execution: {}, changesHead: 'c0' },
          'goals/conflicts': { status: 'ready', value: { footprintCompleteness: [] } },
        };
        return new Response(JSON.stringify(replies[route] ?? { status: 'not_found', code: 'not_found' }), { status: 200 });
      },
    });
    try {
      expect(page.root.textContent.length).toBeGreaterThan(0);
    } finally {
      await page.restore();
    }
    expect(changes).toBe(0);
  }, 30_000);
});
