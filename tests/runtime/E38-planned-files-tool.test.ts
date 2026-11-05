/**
 * E38-R3 (E3-8 spec §3.1, §4, §6): `submit_initial_plan` checks a work task's `plannedFiles` in the form schema, so
 * the model can fix the list in the same round (Q28).
 *
 * Steps, all public (FA-01's world, `FA-answer-tool.test.ts:211–:231`): the S6B3 world, its cold-start second
 * workspace, one goal-less `initial_coordination` request held at its start, the scripted model calling the real
 * submit tool twice, then the saved answer through `releaseS6B3DraftAnswer`. Only the fixed form's work task
 * (`tasks[0]`, `fa3-work`) changes. The refused call's result is read from the model request that follows it in the
 * same Turn; its index is counted from the requests the Host recorded before the round started.
 */
import { describe, expect, it, vi } from 'vitest';
import { FA_S6B3_FIXED_FORM } from '../helpers/FA-forms.js';
import {
  configureS6B3SecondWorkspace, holdS6B3RequestAnswer, openS6B3World, releaseS6B3DraftAnswer,
} from '../helpers/S6B3-fixture.js';

// The held round holds a real start commit, so the file owns the two backend mocks (FA-answer-tool's pattern).
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

/** The fixed form with its one work task carrying `plannedFiles`. */
const listedForm = (plannedFiles: string[]) => ({
  ...FA_S6B3_FIXED_FORM,
  plan: { ...FA_S6B3_FIXED_FORM.plan, tasks: [{ ...FA_S6B3_FIXED_FORM.plan.tasks[0], plannedFiles }] },
});

describe('E38-R3: the submit tool checks plannedFiles', () => {
  it('refuses a parent-segment path with the refine reason, then accepts the listed form in the same round', async () => {
    /* Named mutation: drop the per-path refine (the first call is accepted; the toContain on its reason goes red). */
    const world = await openS6B3World({ backend: 'memory' });
    try {
      const second = await configureS6B3SecondWorkspace(world, { name: 'e38r3', goals: 2 });
      const held = await holdS6B3RequestAnswer(world, {
        scope: second.scope, label: 'e38r3', goalId: null, executionKind: 'initial_coordination',
        reply: () => ({ kind: 'calls', calls: [{ callId: 'e38-r3-bad', name: 'submit_initial_plan',
          args: listedForm(['../x.ts']) }] }),
      });
      // The round is held before its start: its first model request is the next one the Host records.
      const before = world.host.model.requests.length;
      world.host.scriptReplies([{ kind: 'calls', calls: [{ callId: 'e38-r3-listed', name: 'submit_initial_plan',
        args: listedForm(['src/fa/a.ts', 'src/fa/b.ts']) }] }]);
      const settled = await releaseS6B3DraftAnswer(world, held)
        .then(answer => ({ answer }), (error: unknown) => ({ error }));

      // The refused call's result is served in the request right after the one that made the call.
      const refused = world.host.model.requests[before + 1]?.messages
        .find(entry => entry.role === 'tool' && entry.callId === 'e38-r3-bad');
      const error = refused?.role === 'tool' && refused.result.status === 'error' ? refused.result.error : undefined;
      expect(error?.code).toBe('invalid_arguments');
      expect(error?.message).toContain('Use a normalized workspace-relative file path');

      if ('error' in settled) throw settled.error;
      expect(JSON.parse(settled.answer.answerText).plan.tasks[0].plannedFiles).toEqual(['src/fa/a.ts', 'src/fa/b.ts']);
    } finally { await world.close(); }
  }, 120_000);
});
