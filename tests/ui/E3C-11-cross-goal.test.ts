import { afterEach, describe, expect, it } from 'vitest';
import { asRecord } from '../../src/ui/values.js';
import { openS7C1World } from '../helpers/S7C-member-fixture.js';
import { findClass } from './helpers/boot-page.js';
import { CHAIN_B_TITLE, bootChain, seedCrossGoalLine, taskBar } from './helpers/E3C-world.js';
import { buttonText, callsOf, memberSearch, metaOf, press, settle, worldSlot } from './helpers/E3M-world.js';
import { countRoute, textOf } from './helpers/E3N-page.js';

/**
 * E3C-11 (test sheet §2.4, E3C-24; Codex #10, Y4): a line whose task belongs
 * to another Goal than `?goal=` — the task bar and the requeue pins follow
 * the Run's task (`run.task`'s Goal), not the URL's Goal. Goal B's state
 * (`Chain B task` failed, a person may requeue) is read before the page opens.
 */

const slot = worldSlot();
afterEach(async () => { await slot.close(); }, 180_000);

describe('E3C-11 a line of another Goal', () => {
  it('E3C-24 the B line shows Chain B task, reads B’s task graph and pins B’s Goal on 重新入队', async () => {
    const s7c = await slot.use('E3C-24', () => openS7C1World({ backend: 'memory', firstRun: 'ended' }), (world) => world.close());
    const b = await seedCrossGoalLine(s7c);
    expect(b.row.effectivePhase).toBe('failed');
    expect(b.row.failure?.requeueActors ?? []).toContain('human');
    const { page, log } = await bootChain(s7c.world, memberSearch('s7c-goal', b.line));
    try {
      expect(textOf(findClass(findClass(page.root, 'main') ?? page.root, 'head-title'))).toContain(CHAIN_B_TITLE);
      const goals = callsOf(log, 'tasks/query').map((call) => asRecord(asRecord(call.input)['goalRef'])['goalId']);
      expect(goals).toContain(b.goal.goalId);
      press(buttonText(taskBar(page.root), '重新入队'), '重新入队');
      await settle(() => countRoute(log, 'tasks/requeue') > 0);
      const calls = callsOf(log, 'tasks/requeue');
      expect(calls).toHaveLength(1);
      /* 具名改坏: 把 Goal pin 的 ref 换成 A 的 Goal；本行的 B GoalRef/revision 断言红。 */
      expect(metaOf(calls[0]).expected).toContainEqual({ ref: b.goal, revision: b.goalRevision });
    } finally {
      await page.restore();
    }
  }, 180_000);
});
