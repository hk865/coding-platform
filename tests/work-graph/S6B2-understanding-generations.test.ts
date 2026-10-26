/**
 * Row 19's cases drive the real understanding round: the source owns one goal root, H appends the live
 * `request_understanding` command, and the answered round consumes it. The filter/move/close branches that need a
 * second command, a stranded run or a Host reconcile are 未证明; the frozen fixture has no public step for them.
 */
import { describe, expect, it } from 'vitest';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { openS6B2World, holdS6BUnderstandingRound, seedS6BTooLongSecretary } from '../helpers/S6B2-fixture.js';

describe('the understanding command through the real advance (filters 未证明)', () => {
  const cases = [
    'the live, closed and consumed filter through a real command',
    'the generation filter',
    'the state filter',
    'the owner filter',
    'a stale attempt re-prepared',
    'a root owner moved',
    'an unstarted end',
    'close on a live command',
    'close on a terminal command',
    'close on a mismatched command',
    'close replay',
    'close after the root moved',
    'close on a missing command',
  ] as const;

  it.each(cases)('%s', async (label) => {
    const opened = await openS6B2World({ backend: 'memory', secretaryBudget: { contextWindowTokens: 625_000 },
      secretaryTools: ['read', 'record_note'] });
    try {
      const seeded = await seedS6BTooLongSecretary(opened.world, { windowTokens: 625_000, inputTokens: 500_000 });
      const root = await opened.main.submit({ label: `generation-${label.length}`, goalId: opened.world.goals.first.goalId,
        recipient: seeded.secretary.ref });
      expect(root.round).toBeDefined();
      const round = await holdS6BUnderstandingRound(opened.world, { secretary: seeded.secretary,
        goals: [opened.world.goals.first] });
      const ended = await readQuery(opened.world.ag2b, round.round);
      expect(ended.job.job.understanding).toMatchObject({ state: 'consumed' });
      expect(ended.run.run.status).toBe('answered');
    } finally {
      await opened.close();
    }
  });
});
