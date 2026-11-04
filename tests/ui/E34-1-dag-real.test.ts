import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ag2bPlanDraft } from '../helpers/AG2b-collaboration-fixture.js';
import { openS6ARequestWorld, S6A_GOAL_1, S6A_SCOPE, S6A_WORK_ROLE, type S6ARequestWorld } from '../helpers/S6A-request-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { createS6BLine, governS6B } from '../helpers/S6B1-fixture.js';
import { adoptE34Plan, readE34Map } from './helpers/E34-plan.js';
import { bootPage, findButton, findClass, type PageFetch } from './helpers/boot-page.js';
import { until } from '../helpers/change-stream-reader.js';

/** E34-1 (ruling 1, 3a): the public plan path feeds one Task row into the DAG,
 * the outline and the detail; a hover stays local and issues no request. */
let world: S6ARequestWorld | undefined;
const forward: PageFetch = async (url, init, realFetch) => realFetch(new URL(url, world!.base).href, init);

beforeAll(async () => {
  const opened = await openS6ARequestWorld({ backend: 'memory' });
  world = opened;
  await governS6B(opened, s6aCardsWorkspace(opened, S6A_SCOPE), opened.goals);
  const draft = ag2bPlanDraft(['e34-a', 'e34-b']);
  draft.planId = 'e34-1-plan';
  draft.goalId = S6A_GOAL_1.goalId;
  draft.stages = [{ stageId: 'e34-1-stage', title: 'E34 阶段' }];
  draft.tasks = draft.tasks.map((task) => ({
    ...task, stageId: 'e34-1-stage',
    title: task.taskKind === 'gate' ? 'E34 goal gate' : `Independent work ${task.taskId}`,
    scope: { kind: 'stage' as const, stageId: 'e34-1-stage' },
  }));
  draft.executionDag = { dependsOn: [
    { taskId: 'e34-b', dependsOnId: 'e34-a', requires: { kind: 'output-contract', label: 'E34 A output' } },
    { taskId: 'ag2b-gate', dependsOnId: 'e34-b', requires: { kind: 'gate-result', label: 'E34 B result' } },
  ] };
  await adoptE34Plan(opened, S6A_SCOPE, S6A_GOAL_1, draft, 'dag-real');
  /* A real responsible line: the detail owner row is a `graph/detail` summary
     fact, not one of the `tasks/query` assignment fields. */
  await createS6BLine(s6aCardsWorkspace(opened, S6A_SCOPE), {
    label: 'e34-1-owner', role: S6A_WORK_ROLE,
    tasks: [{ projectId: S6A_SCOPE.projectId, goalId: S6A_GOAL_1.goalId, taskId: 'e34-a' }],
  });
}, 30_000);

afterAll(async () => {
  await world?.close();
  world = undefined;
});

describe('E34-1 one real Task across DAG, outline and detail', () => {
  it('E34-1 shows the same name and current state in all three views; hover issues no request', async () => {
    const data = await readE34Map(world!, S6A_GOAL_1.goalId);
    expect(data.tasks.find((task) => task.id === 'e34-a')?.name).toBe('Independent work e34-a');
    expect(data.tasks.find((task) => task.id === 'e34-a')?.st).toBe('claimable');

    const routes: string[] = [];
    let changesSeen!: () => void;
    const streamAttempted = new Promise<void>((resolve) => { changesSeen = resolve; });
    const page = await bootPage({
      name: 'TaskMap', search: `?goal=${S6A_GOAL_1.goalId}`, token: world!.token,
      request: async (url, init, realFetch) => {
        if (url.includes('/api/real/core/changes')) {
          changesSeen();
          return new Response('{}', { status: 404 });
        }
        routes.push(url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length));
        return forward(url, init, realFetch);
      },
    });
    try {
      await streamAttempted;
      await until(() => page.root.textContent.includes('Independent work e34-a'), 20_000);
      const node = findButton(page.root, 'Independent work e34-a')!;
      expect(node).toBeDefined();
      expect(node.getAttribute('aria-label')).toContain('可领取');
      expect(node.getAttribute('class')).toContain('dg-node');

      /* Hover is local: after the page settled (the stream attempt is the
         completion barrier), the request list does not grow. */
      const before = routes.length;
      node.dispatch('mouseenter');
      await new Promise<void>((resolve) => {
        const { port1, port2 } = new MessageChannel();
        port1.onmessage = () => { port1.close(); port2.close(); resolve(); };
        port2.postMessage(null);
      });
      expect(routes.slice(before)).toEqual([]);
      expect(findClass(page.root, 'hcard')!.textContent).toContain('Independent work e34-a');

      /* A click awaits graph/detail and shows the route-only assignment text. */
      findButton(page.root, 'Independent work e34-a')!.dispatch('click');
      await until(() => routes.includes('graph/detail'), 20_000);
      await until(() => (findClass(page.root, 'detail')?.textContent ?? '').includes('Perform independent work e34-a'), 20_000);
      const detail = findClass(page.root, 'detail')!;
      expect(detail.textContent).toContain('Independent work e34-a');
      expect(detail.textContent).toContain('可领取');
      /* Only the summary supplies `responsibleNow`: discarding `graph/detail`
         drops this row. */
      expect(detail.textContent).toContain('负责的 Agent');
      expect(detail.textContent).toContain('Independent work e34-a · 待命');
      expect(routes).toContain('graph/detail');
      /* The detail's participants page is the only source of `d-lines`; the
         summary, hover and tasks/query never carry this row. */
      await expect.poll(() => findClass(page.root, 'd-lines')?.textContent ?? '').toContain('Independent work e34-a');

      findButton(page.root, '大纲')!.dispatch('click');
      expect(findButton(page.root, 'Independent work e34-a')).toBeDefined();
      expect(page.root.textContent).toContain('Independent work e34-a');
      expect(page.root.textContent).toContain('可领取');
    } finally {
      await page.restore();
    }
  }, 30_000);
});
