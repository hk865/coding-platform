/**
 * G-02 (acceptance, memory): the person copies a cancelled Goal and plans the copy as a Goal of its own. Rows 37 and 38
 * prove the copy's rules (the preview, `continuedFrom` and the pinned text, the rewrite race, the replay); this
 * scenario strings the preview, the confirm and the copy's first planning round into what the person sees.
 */
import { describe, expect, it } from 'vitest';
import type { GoalCopyConfirmResultV1, GoalCopyDraftResultV1 } from '../../src/contracts/goal-card.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import {
  callS6B3LateRoute, configureS6B3SecondWorkspace, openS6B3World, readS6B3DecisionQuestionKeys, runS6B3PlanningQuery,
  seedS6B3CancelledGoal, valueOf,
} from '../helpers/S6B3-fixture.js';

describe('G-02: a cancelled Goal is copied and the copy is planned (memory)', () => {
  it('copies what the preview showed, plans the copy on its own and leaves the source cancelled', async () => {
    const world = await openS6B3World({ backend: 'memory' });
    try {
      const { scope } = await configureS6B3SecondWorkspace(world, { name: 'g02', goals: 2 });
      const source = await seedS6B3CancelledGoal(world, { scope, settings: { autonomy: 'after_plan_confirmation' },
        understanding: { topic: 'G-02 reader', conclusion: 'G-02: the old reader is cancelled.', sections: {
          status: 'Cancelled.', decided: 'Copy it.', open: 'Nothing.', next: 'Copy.', risks: 'None.' } } });
      const route = async <T>(suffix: string, input: unknown, status: 'ready' | 'committed'): Promise<T> =>
        valueOf<T>(await callS6B3LateRoute(world, suffix, '6b3-w3', plain(scope, input)), status, suffix);
      // The person confirms exactly what the preview showed: its source pin and no intervention.
      const preview = await route<GoalCopyDraftResultV1>('goals/copy-draft', { goalRef: source.goal.ref }, 'ready');
      const copy = await route<GoalCopyConfirmResultV1>('goals/copy-confirm', { commandId: 'g02-copy',
        sourceGoalRef: preview.source.goal, expectedSourceRevision: preview.source.revision, selectedInterventions: [] },
      'committed');
      expect(copy.goal.continuedFrom).toEqual({ goal: preview.source.goal, sourceRevision: preview.source.revision,
        understanding: preview.understanding });
      // The copy is planned as its own Goal: its planning round gives a question card under the copy, none under the source.
      await runS6B3PlanningQuery(world, { scope, goalRef: copy.goal.ref, label: 'g02-copy' });
      expect(await readS6B3DecisionQuestionKeys(world, { scope, goals: [copy.goal.ref] })).toHaveLength(1);
      expect(await readS6B3DecisionQuestionKeys(world, { scope, goals: [source.goal.ref] })).toEqual([]);
      expect((await route<{ goal: GoalSnapshot }>('goals/read', source.goal.ref, 'ready')).goal)
        .toMatchObject({ desiredState: 'cancelled', revision: source.cancelledRevision });
    } finally {
      await world.close();
    }
  });
});
