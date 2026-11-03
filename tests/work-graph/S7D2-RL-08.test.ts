/**
 * RL-08 (`book-7d2-frozen.md:1311`; `7d2-start-rulings.v4.md:8846`): the retained cap's re-admission.
 *
 * Two adviser lines are archived through the formal `sessions/archive`; allocation reads 0 holders / 0
 * reservations and `open.adviser = 1`. Reactivating A with the free seat adds A as a holder in that one commit
 * and takes no reservation. Reactivating B while A holds the only seat is the exact `capacity/at_cap` refusal,
 * allocation does not move, and no `role_capacity` card is written.
 *
 * The row is a business row and runs on memory only (`tests/RULES.md` S3). The named mutation is to write B's
 * holder without the reactivation admission; it is not applied here.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { openS7D2RetainedWorld, type S7D2RetainedWorld } from '../helpers/S7D2-admission-world.js';

const worlds: S7D2RetainedWorld[] = [];

afterEach(async () => {
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
});

describe('RL-08: the retained cap re-admits one holder, not a reservation', () => {
  it('A is added as the one holder at its reactivation commit; B at the cap is at_cap and writes no card', async () => {
    const world = await openS7D2RetainedWorld({ backend: 'memory' });
    worlds.push(world);

    const queueBefore = await world.queue();
    const reactivated = await world.reactivate(world.a, 's7d2-reactivate-a');
    expect(reactivated).toMatchObject({ status: 'committed' });
    const cursor = reactivated['cursor'];
    expect(typeof cursor).toBe('string');

    const afterA = await world.world.allocation();
    expect(afterA.duties.adviser.holders).toHaveLength(1);
    expect(afterA.duties.adviser.holders[0]).toMatchObject({ session: world.a.ref, since: cursor });
    expect(afterA.duties.adviser.reservations).toEqual([]);
    expect((await world.world.world.readSession(world.a.ref)).record.lifecycle).toBe('active');

    const refused = await world.reactivate(world.b, 's7d2-reactivate-b');
    expect(refused).toEqual({ status: 'rejected', code: 'capacity',
      reason: 'at_cap: adviser has 1 holder(s) and 0 reservation(s) against open limit 1',
      detail: { duty: 'adviser', holders: 1, reservations: 0, open: 1, episode: null } });

    const afterB = await world.world.allocation();
    expect(afterB.duties.adviser.revision).toBe(afterA.duties.adviser.revision);
    expect(afterB.duties.adviser.holders).toEqual(afterA.duties.adviser.holders);
    expect(afterB.duties.adviser.reservations).toEqual([]);
    expect((await world.world.world.readSession(world.b.ref)).record.lifecycle).toBe('archived');

    const queue = await world.queue();
    expect(queue.waitingAnswer).toHaveLength(queueBefore.waitingAnswer.length);
    expect(queue.waitingAnswer.map(card => String(card.source.kind))).not.toContain('role_capacity');
  });
});
