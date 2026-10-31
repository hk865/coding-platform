/**
 * Book §5 `P-suggest` (`book-7c.md:1369`; §3.2 item 6 `:375–387`): with every candidate filtered out (their real
 * archive requests leave no reusable card) the chooser answers `create` and names its basis — it never creates a
 * line and never reuses a filtered-out card (A-01).
 *
 * The prior state is public steps only (`sessions/create`, `sessions/archive-line`); the chooser is the real
 * factory over the Host's owners. A `create` with `rank: 'none'`, `candidates: 0` and no `reuse` arm is the
 * assertion; the directory count before and after shows no line was opened.
 */
import { describe, expect, it } from 'vitest';
import { readGoal } from '../helpers/A2-restart-fixture.js';
import { openS6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { WORKFLOW } from '../helpers/S6A-request-fixture.js';
import { pickChooser, pickOwned } from '../helpers/S7C1-p-directory-delta.js';

describe('P-suggest: no suitable member (book-7c.md:1369)', () => {
  it('a filtered-out set -> create with rank none and candidates 0, never reuse (A-01)', async () => {
    const world = await openS6AHostWorld({ backend: 'memory' });
    try {
      for (let index = 0; index < 3; index += 1) {
        const session = await world.createWorkSession(`s7c1-p-suggest-filtered-${String(index)}`);
        await world.requestArchive(session);
      }
      const before = (await world.listSessions()).length;
      const chooser = pickChooser(world);
      const goal = await readGoal(world.ag2b, world.goals.first);
      const result = await chooser.chooseSession(pickOwned(world), goal, WORKFLOW.bindings[0]!, null, null);

      expect(result.kind).toBe('create');
      if (result.kind !== 'create') throw new Error(`P-suggest: the chooser reused a filtered-out card: ${JSON.stringify(result)}`);
      expect(result.basis).toEqual({ rank: 'none', incomplete: [], candidates: 0 });
      expect('card' in result).toBe(false);
      // No line was opened: the directory holds exactly what the public steps built.
      expect((await world.listSessions()).length).toBe(before);
    } finally {
      await world.close();
    }
  });
});
