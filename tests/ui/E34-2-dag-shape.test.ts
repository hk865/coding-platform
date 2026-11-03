import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHostClient } from '../../src/ui/host-client.js';
import { readTaskMap } from '../../src/ui/boot.js';
import type { TaskMapData } from '../../src/ui/adapters/task-map.js';
import { adoptPLTwoStageSkeleton, openPLWorkflowWorld, type PLWorkflowWorld } from '../helpers/PL-workflow-fixture.js';
import { bootPage, findButton, findClass } from './helpers/boot-page.js';

/** E34-2 (ruling 1, 3a): the DAG shape of one publicly adopted no-dependency
 * plan — independent nodes, the unscheduled band (all four conditions), no
 * synthetic acceptance node, and real gates whose stage lives only in `scope`. */
let pl: PLWorkflowWorld | undefined;

async function mapOf(): Promise<TaskMapData> {
  const { data } = await readTaskMap(createHostClient(pl!.world.token, new URL(pl!.world.base).origin), pl!.goal.goalId);
  if (data === null) throw new Error('E34-2: no map');
  return data;
}

beforeAll(async () => {
  pl = await openPLWorkflowWorld({ backend: 'memory', label: 'e34-2' });
  await adoptPLTwoStageSkeleton(pl.main, pl.goal, {
    label: 'e34-2', stageOneTaskIds: ['e34-2-a', 'e34-2-b'],
    goalPlaceholderTaskId: 'e34-2-loose', goalGate: true, placeholderDisposition: 'deferred',
  });
}, 30_000);

afterAll(async () => {
  await pl?.close();
  pl = undefined;
});

describe('E34-2 the public no-dependency plan shapes the real DAG', () => {
  it('E34-2 keeps independent tasks, the unscheduled band, real gates and no synthetic GATE', async () => {
    const data = await mapOf();
    expect(data.dag.edges).toEqual([]);
    expect(data.dag.gateIds.sort()).toEqual(['pl-gate-goal', 'pl-gate-pl-stage-1', 'pl-gate-pl-stage-2']);
    expect(data.dag.band).toEqual(['e34-2-loose']);
    /* a deferred intent that carries an obligation is not unscheduled */
    expect(data.dag.nodes).toContain('pl-placeholder-pl-stage-2');
    expect(data.tasks.find((task) => task.id === 'pl-placeholder-pl-stage-2')?.st).toBe('deferred');
    /* the real stage gate declares its stage only in definition.scope.stageId */
    const stageGate = data.tasks.find((task) => task.id === 'pl-gate-pl-stage-1');
    expect(stageGate?.gate).toBe(true);
    expect(stageGate?.stageId).toBe('pl-stage-1');
    expect(data.tasks.find((task) => task.id === 'pl-gate-goal')?.stageId).toBeNull();

    const page = await bootPage({
      name: 'TaskMap', search: `?goal=${pl!.goal.goalId}`, token: pl!.world.token,
      request: async (url, init, realFetch) => realFetch(new URL(url, pl!.world.base).href, init),
    });
    try {
      findButton(page.root, 'DAG')!.dispatch('click');
      const top = (name: string): string | undefined =>
        findButton(page.root, name)!.getAttribute('style')!.match(/top:\s*([-\d.]+)px/)![1];
      expect(top('PL stage 1 e34-2-a')).toBe(top('PL stage 1 e34-2-b'));
      /* Ruling 3: a real gate is an ordinary `dg-node` with `is-gate`; the
         goal-level gate is the layout's pull, not a synthetic 600 cluster. */
      const gate = findButton(page.root, 'PL goal acceptance')!;
      expect(gate.getAttribute('class')).toContain('dg-node');
      expect(gate.getAttribute('class')).toContain('is-gate');
      expect(findClass(page.root, 'dg-band')!.textContent).toContain('PL goal-level placeholder e34-2-loose');
      expect(page.root.textContent).toContain('PL goal acceptance');
      /* The critical-path hint names the goal acceptance in words; no node is
         synthesized for it. */
      expect(findButton(page.root, '目标验收')).toBeUndefined();
    } finally {
      await page.restore();
    }
  }, 30_000);
});
