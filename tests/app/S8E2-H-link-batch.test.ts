/**
 * 8E2 H background link batch (slice-8E2-SPEC §2.5 H2 :451–455, §4.1 :705–713,
 * §4.2 :840–841):
 * - E2-16 (:840): one doubtful K1 (compose.ts line 10 edited, E3 read once) is
 *   verified by the Host heartbeat's idle batch — one second-tier program build,
 *   the E3 read after it is verified and builds nothing; a second heartbeat with
 *   an empty queue builds nothing either.
 * - E2-18 (:841): two doubtful links and one held scribe Run; 10 minutes after
 *   the Host started (injected clock) the backlog condition alone fires even
 *   though the line is busy, and the batch is one build. The idle threshold is
 *   1 ms and the Run is held before the E3 reads queue the links, so before the
 *   clock moves only the in-flight count keeps the idle batch off. The advance
 *   leaves the instance lease and the held Run as they were, and `release()`
 *   still ends it.
 *
 * Expectations come only from the spec rows and H2 (the Host option names and
 * values are the rulings' literals :3, :14, :15, not src constants). One world
 * per row, memory only, closed after each row. E3 is the Host route
 * `architecture/semantic-links`; "builds" is `world.linkCheck.builds()` and the
 * heartbeat completion barrier is three consecutive `heartbeat(world, 25)`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { heartbeat } from '../helpers/IV-host-fixture.js';
import {
  holdS8EScribeRun, openS8ESemanticWorld, s8eChangeComposeLine10, s8eLinkVerification, s8eWriteLink,
  S8E_LINKS, type S8ESemanticWorld,
} from '../helpers/S8E-semantic-world.js';

const worlds: S8ESemanticWorld[] = [];
afterEach(async () => {
  await Promise.all(worlds.splice(0).map(world => world.close()));
});

function remember<T extends S8ESemanticWorld>(world: T): T {
  worlds.push(world);
  return world;
}

describe('8E-2 H: the Host background link batch', () => {
  it('E2-16 (:840) the idle heartbeat batches the queue: one build, then the E3 read is verified and builds nothing', async () => {
    const world = remember(await openS8ESemanticWorld({ hostOptions: {
      scribeReminderPeriodMs: 25, linkBatchIdleMs: 1 } }));
    const k1 = await s8eWriteLink(world, S8E_LINKS.K1);
    await s8eChangeComposeLine10(world);

    // Precondition: the E3 read puts K1 in the doubtful queue and builds nothing.
    expect(await s8eLinkVerification(world, k1.noteId, k1.version))
      .toEqual({ status: 'unchecked', reason: 'refs_pending' });

    const b0 = world.linkCheck.builds();
    for (let i = 0; i < 3; i++) await heartbeat(world, 25);
    const b1 = world.linkCheck.builds();
    // The first heartbeat builds one program, after the barrier.
    expect(b1 - b0).toBe(1);
    // The read after it is verified and that step builds nothing.
    expect(await s8eLinkVerification(world, k1.noteId, k1.version)).toEqual({ status: 'verified' });
    expect(world.linkCheck.builds()).toBe(b1);

    for (let i = 0; i < 3; i++) await heartbeat(world, 25);
    // The second heartbeat builds nothing (the queue is empty).
    expect(world.linkCheck.builds()).toBe(b1);
  }, 300_000);

  it('E2-18 (:841) the 10-minute backlog condition batches while a Run is held: one build', async () => {
    const world = remember(await openS8ESemanticWorld({ hostOptions: {
      scribeReminderPeriodMs: 25, linkBatchBacklog: 2, linkBatchIdleMs: 1 } }));
    const k1 = await s8eWriteLink(world, S8E_LINKS.K1);
    const k3 = await s8eWriteLink(world, S8E_LINKS.K3);
    await s8eChangeComposeLine10(world);

    // The Run is held before the E3 reads queue the links: with the 1 ms idle
    // threshold only the in-flight count keeps the idle batch off below.
    const held = await holdS8EScribeRun(world, 'e2-18');
    const b0 = world.linkCheck.builds();
    try {
      // Precondition: both links are doubtful, one E3 read each.
      expect(await s8eLinkVerification(world, k1.noteId, k1.version))
        .toEqual({ status: 'unchecked', reason: 'refs_pending' });
      expect(await s8eLinkVerification(world, k3.noteId, k3.version))
        .toEqual({ status: 'unchecked', reason: 'refs_pending' });

      for (let i = 0; i < 3; i++) await heartbeat(world, 25);
      // Less than 10 minutes after the Host started: the busy Host builds nothing.
      expect(world.linkCheck.builds() - b0).toBe(0);

      // The injected clock moves 10 minutes: the backlog condition is due.
      world.clock.advance(600_000);
      for (let i = 0; i < 3; i++) await heartbeat(world, 25);
      const b1 = world.linkCheck.builds();
      // The backlog fires: one program build.
      expect(b1 - b0).toBe(1);
    } finally {
      // Release the held Run even when the row fails; it must end normally.
      await held.release();
    }
  }, 300_000);
});
