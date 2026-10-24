/**
 * The unassigned-request read through the real Host at the page bound: one
 * call reads one 200-row index page and answers its continuation, so a
 * request on page 2 is not returned by the first call.
 *
 * It needs more than 200 request rounds made through public submits (22-27 s
 * per backend in the daily suite with five workers), so it runs in the scale
 * batch (`npm run test:scale`, decision 86-6) with its own time limit.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import {
  openS6ARequestWorld, S6A_GOAL_1, S6A_SCOPE, type S6ARequestWorld,
} from '../helpers/S6A-request-fixture.js';

/** 201 public submits, an archive and one read. */
const PAGE_BOUND_TIMEOUT_MS = 180_000;

type SubmitOverride = { goalId?: string | null; continues?: QueryJobRef | null; recipient?: SessionRef | null };

function submitInput(commandId: string, text: string, override: SubmitOverride = {}) {
  return { commandId, goalId: S6A_GOAL_1.goalId, text, continues: null, recipient: null, ...override };
}

for (const backend of ['memory', 'sqlite'] as const) {
  describe(`S6A unassigned requests at the page bound (${backend})`, () => {
    let world: S6ARequestWorld;

    beforeEach(async () => {
      world = await openS6ARequestWorld({ backend });
    });

    afterEach(async () => {
      await world.close();
    });

    const ctx = (): CoreCallContext => world.humanContext();

    async function submit(commandId: string, text: string, override: SubmitOverride = {}) {
      return world.platform.requestIntake.submitRequest(ctx(), submitInput(commandId, text, override));
    }

    // ---------------------------------------------------------------------
    // One 200-row index page per call; the drain owns the page budget.
    // ---------------------------------------------------------------------
    it('reads one index page per call and returns its continuation', { timeout: PAGE_BOUND_TIMEOUT_MS }, async () => {
      const first = await world.createSecretary('secretary-1');
      const second = await world.createSecretary('secretary-2');
      const root = await submit('s6a-page-bound', 'page-bound root', { recipient: first.ref });
      if (root.status !== 'queued') throw new Error('the root submit failed');
      // 199 owned follow-ups make page 1 exactly 200 rows that cannot qualify.
      for (let index = 0; index < 199; index += 1) {
        const followup = await submit(`s6a-page-bound-${index}`, `owned follow-up ${index}`,
          { goalId: null, continues: root.round });
        if (followup.status !== 'queued') throw new Error(`follow-up ${index} failed: ${JSON.stringify(followup)}`);
      }
      const later = await submit('s6a-page-bound-later', 'the later request', { recipient: second.ref });
      if (later.status !== 'queued') throw new Error('the later request failed');
      await world.archive(second);

      const page = await world.platform.requestRounds.unassigned(ctx(), S6A_SCOPE, { limit: 20, continuation: null });
      if (page.status !== 'ready') throw new Error(`the page failed: ${JSON.stringify(page)}`);
      // The later request sits on page 2; a one-page read reports only the cursor.
      expect(page.value.requests).toEqual([]);
      expect(page.value.continuation).not.toBeNull();
      expect(page.value.wrapped).toBe(false);
    });
  });
}
