import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ag2bPlanDraft } from '../helpers/AG2b-collaboration-fixture.js';
import { openS6ARequestWorld, S6A_GOAL_1, S6A_SCOPE, type S6ARequestWorld } from '../helpers/S6A-request-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { governS6B } from '../helpers/S6B1-fixture.js';
import { adoptE34Plan, readE34Map } from './helpers/E34-plan.js';
import { bootPage, findButton, findClass } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';

/** E34-3 (ruling 1, 3a): one public 50-Task plan with branches and cross-stage
 * edges — every real identity and edge, the longest unfinished chain and the
 * selection linkage, with no 600-task generator in the path. */
let world: S6ARequestWorld | undefined;
const ids = Array.from({ length: 50 }, (_, i) => `e34-3-${i}`);
const name = (id: string): string => `Independent work ${id}-with-a-deliberately-long-name`;

function nodesWithClass(root: FakeElement, cls: string): FakeElement[] {
  const found: FakeElement[] = [];
  const walk = (el: FakeElement): void => {
    if ((el.getAttribute('class') ?? '').split(/\s+/).includes(cls)) found.push(el);
    for (const child of el.childNodes) if (child instanceof Object && 'tagName' in child) walk(child as FakeElement);
  };
  walk(root);
  return found;
}

beforeAll(async () => {
  const opened = await openS6ARequestWorld({ backend: 'memory' });
  world = opened;
  await governS6B(opened, s6aCardsWorkspace(opened, S6A_SCOPE), opened.goals);
  const draft = ag2bPlanDraft(ids);
  draft.planId = 'e34-3-plan';
  draft.goalId = S6A_GOAL_1.goalId;
  draft.stages = [{ stageId: 'e34-3-s1', title: 'E34 五十阶段一' }, { stageId: 'e34-3-s2', title: 'E34 五十阶段二' }];
  draft.tasks = draft.tasks.map((task) => {
    if (task.taskKind === 'gate') {
      return { ...task, title: 'E34 fifty goal gate', stageId: 'e34-3-s2', scope: { kind: 'stage' as const, stageId: 'e34-3-s2' } };
    }
    const index = Number(task.taskId.slice('e34-3-'.length));
    const stageId = index % 2 === 0 ? 'e34-3-s1' : 'e34-3-s2';
    return { ...task, title: name(task.taskId), stageId, scope: { kind: 'stage' as const, stageId } };
  });
  const dependsOn: Array<{ taskId: string; dependsOnId: string; requires: { kind: 'output-contract' | 'artifact' | 'gate-result'; label: string } }> = [];
  for (let i = 1; i < ids.length; i += 1) {
    dependsOn.push({ taskId: ids[i]!, dependsOnId: ids[i - 1]!, requires: { kind: 'output-contract', label: `E34 ${i}` } });
    if (i >= 2) dependsOn.push({ taskId: ids[i]!, dependsOnId: ids[i - 2]!, requires: { kind: 'artifact', label: `E34 ${i - 2}` } });
  }
  dependsOn.push({ taskId: 'ag2b-gate', dependsOnId: ids[49]!, requires: { kind: 'gate-result', label: 'E34 last' } });
  draft.executionDag = { dependsOn };
  await adoptE34Plan(opened, S6A_SCOPE, S6A_GOAL_1, draft, 'dag-50');
}, 30_000);

afterAll(async () => {
  await world?.close();
  world = undefined;
});

describe('E34-3 a real 50-Task plan', () => {
  it('E34-3 carries 50 identities, every edge, the longest chain and the selection', async () => {
    const data = await readE34Map(world!, S6A_GOAL_1.goalId);
    expect(data.tasks.filter((task) => !task.gate).map((task) => task.id).sort()).toEqual([...ids].sort());
    expect(new Set(data.dag.nodes).size).toBe(51);
    expect(data.dag.edges.length).toBe(98);
    for (const id of ids.slice(1)) {
      expect(data.dag.edges).toContainEqual({ taskId: id, dependsOnId: ids[ids.indexOf(id) - 1],
        requires: { kind: 'output-contract', label: `E34 ${ids.indexOf(id)}` } });
    }
    expect(data.dag.crit).toEqual([...ids, 'ag2b-gate']);
    expect(data.dag.crit.length).toBe(51);

    const page = await bootPage({
      name: 'TaskMap', search: `?goal=${S6A_GOAL_1.goalId}`, token: world!.token,
      request: async (url, init, realFetch) => realFetch(new URL(url, world!.base).href, init),
    });
    try {
      findButton(page.root, 'DAG')!.dispatch('click');
      expect(nodesWithClass(page.root, 'dg-node')).toHaveLength(51);
      findButton(page.root, name('e34-3-25'))!.dispatch('click');
      const detail = findClass(page.root, 'detail')!.textContent;
      expect(detail).toContain(name('e34-3-25'));
      expect(detail).toContain(name('e34-3-24'));
      expect(detail).toContain(name('e34-3-23'));
      expect(page.root.textContent).not.toContain('状态机可靠性改造');
      expect(data.dag.band).toEqual([]);
    } finally {
      await page.restore();
    }
  }, 30_000);
});
