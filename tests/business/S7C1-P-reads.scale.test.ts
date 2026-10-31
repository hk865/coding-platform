/**
 * Book §5 `P-reads` (`book-7c.md:1368`; P-S1): the 401st Session is not a create limit — the chooser reads
 * 8 x 50 = 400, marks `directory` and ranks the read set; the 401st create is not refused.
 *
 * Runs in the scale batch only (`npm run test:scale`, `vitest.scale.config.ts`): the 401-real-Session setup does not
 * fit the daily suite's budget.
 */
import { describe, expect, it } from 'vitest';
import { plainSessionRefKey } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { openS7C1Chooser } from '../helpers/S7C1-p-directory-delta.js';
import { openS7C1PagingWorld } from '../helpers/S7C1-p-paging-world.js';

describe.each(['memory', 'sqlite'] as const)('P-reads: the 401st Session on %s (book-7c.md:1368; P-S1)', backend => {
  it('the 401st Session is not a create limit: 400 are read, the bound is marked and the read set is ranked', async () => {
    const world = await openS7C1PagingWorld({ backend, mode: 'bound' });
    try {
      if (world.bound === null) throw new Error('P-reads: the bound mode built no 401-Session set');
      expect(world.bound.sessions).toHaveLength(401);
      const { chooser, goal, owned, binding } = await openS7C1Chooser(world);
      const result = await chooser.chooseSession(owned, goal, binding, null, null);
      expect(result.kind).toBe('reuse');
      if (result.kind !== 'reuse') throw new Error(`P-reads: the chooser did not reuse: ${JSON.stringify(result)}`);

      // The read set is the first 400 keys; the newest activity in it wins instead of the first read entry.
      const readSet = world.bound.sessions.slice(0, 400);
      const newest = readSet.reduce((best, session) => session.createdAt > best.createdAt ? session : best);
      expect(plainSessionRefKey(result.card.record.ref)).toBe(plainSessionRefKey(newest.ref));
      expect(plainSessionRefKey(result.card.record.ref)).not.toBe(world.bound.keys[0]);
      expect(result.basis.candidates).toBe(400);
      expect(result.basis.incomplete).toEqual(['directory']);
      expect(result.basis.rank).toBe('latest_activity');
    } finally {
      await world.close();
    }
  });
});
