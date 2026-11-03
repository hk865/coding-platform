/**
 * R7 (8C G5): the `auto` start-up scan retries a staged repair after a crash.
 *
 * W-A on SQLite: a real small `set_responsibility` repair, a real Workflow
 * `finalize_checks` PASS, and the `complete_task` commit held AFTER the store
 * answered (A3 `holdAfter`, matched by its `r3e-complete-task:` identity, never
 * a `complete_task:` request id) so the activation that runs in the same
 * `complete_task` arm has not begun. The Host is then crashed; the new Host's
 * real start-up reconcile must find the staged repair by Goal and activate it
 * once. A second start (same `auto`) proves the scan is idempotent: no second
 * catalog revision and no second note version. The same table carries the `off`
 * start (the staged repair stays staged and the revision unchanged) and a
 * finalised FAIL round (the scan must not activate a round that is not a
 * finalised PASS). State comes only from public steps; nothing is read from the
 * store and no pin, round, receipt or context is built by hand.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openS8CRepairWorld, plain, type S8CRepairWorld } from '../helpers/S8C-repair-world.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S8CRepairWorld[] = [];

afterEach(async () => {
  // Every gate first (a held step of an abandoned Host never resolves
  // otherwise), then the Hosts; the same order the barrier's own header asks for.
  const left = commitBarrier.reset();
  await Promise.all(worlds.splice(0).map(world => world.close()));
  expect(left).toEqual([]);
});

/** The Host's own `automation/save`, exactly the route its page uses. */
async function saveResumeOnStartup(world: S8CRepairWorld, mode: 'auto' | 'off'): Promise<void> {
  const snapshot = await world.world.settings('snapshot', {});
  if (snapshot.status !== 'ready') {
    throw new Error(`R7: the Host settings are not readable: ${JSON.stringify(snapshot)}`);
  }
  const saved = await world.world.settings('automation/save', {
    autoReworkLimit: snapshot.value.automation.autoReworkLimit, resumeOnStartup: mode,
  });
  expect(saved.status).toBe('ready');
}

type R7Variant = {
  name: string; mode: 'auto' | 'off'; outcome: 'PASS' | 'FAIL'; activated: boolean;
};

const variants: readonly R7Variant[] = [
  { name: 'auto: the start-up scan activates the staged repair once', mode: 'auto', outcome: 'PASS', activated: true },
  { name: 'off: the start-up scan leaves the staged repair staged', mode: 'off', outcome: 'PASS', activated: false },
  { name: 'auto: a round that is not a finalised PASS is not activated', mode: 'auto', outcome: 'FAIL',
    activated: false },
];

describe('R7 (a): the start-up scan retries the staged repair by Goal', () => {
  it.each(variants)('$name', async (variant) => {
    const world = await openS8CRepairWorld({ label: `r7-${variant.mode}-${variant.outcome}`,
      backend: 'sqlite' });
    worlds.push(world);
    const before = await world.readCatalog();
    const staged = await world.writeRepair({ ops: [{ op: 'set_responsibility', moduleId: 's6a-core',
      text: 'R7 repaired core' }] });
    expect(staged.version).toBe(1);
    expect((await world.pin()).catalogRef.revision).toBe(before);

    if (variant.outcome === 'PASS') {
      const outcome = await world.pass(staged);
      expect(outcome.finalize.result).toMatchObject({ status: 'committed', value: { outcome: 'PASS' } });
      if (outcome.next === null || outcome.next.kind !== 'perform'
        || outcome.next.operation.kind !== 'complete_task') {
        throw new Error(`R7: the PASS did not stop before complete_task: ${JSON.stringify(outcome.next)}`);
      }
      await saveResumeOnStartup(world, variant.mode);
      // The complete_task commit lands, but its return is held: the activation
      // in the same arm has not run when the Host is abandoned.
      const hold = commitBarrier.holdAfter(byIdentityPrefix('r3e-complete-task:'), 'R7 complete_task return');
      const driving = world.world.post('workflow/advance', plain(S6A_SCOPE, outcome.next))
        .then(() => undefined, () => undefined);
      try {
        await hold.reached;
        await world.world.crash();
        // The new Host's start-up reconcile already ran inside `crash()`.
        if (variant.activated) {
          expect(await world.readCatalog()).toBe(before + 1);
          expect(await world.readNote(staged.noteId)).toMatchObject({ version: staged.version + 1,
            storedState: 'accepted' });
        } else {
          expect(await world.readCatalog()).toBe(before);
          expect(await world.readNote(staged.noteId)).toMatchObject({ version: staged.version,
            storedState: 'staged' });
        }
        // The second start is the second scan: an accepted note leaves the
        // staged collection and a staged one is re-tried without a write.
        await world.world.reopen();
        if (variant.activated) {
          expect(await world.readCatalog()).toBe(before + 1);
          expect(await world.readNote(staged.noteId)).toMatchObject({ version: staged.version + 1,
            storedState: 'accepted' });
        } else {
          expect(await world.readCatalog()).toBe(before);
          expect(await world.readNote(staged.noteId)).toMatchObject({ version: staged.version,
            storedState: 'staged' });
        }
      } finally {
        // The off Host only continues its held complete_task here, after the
        // row's reads; the auto Host replays the identity the new Host wrote.
        hold.release();
        await driving;
      }
      return;
    }

    // The finalised FAIL round: nothing is held, the note stays staged and the
    // scan's `activateRepair` must answer `not_ready` rather than write.
    const failed = await world.fail(staged);
    expect(failed.finalize.result).toMatchObject({ status: 'committed', value: { outcome: 'FAIL' } });
    await saveResumeOnStartup(world, variant.mode);
    await world.world.crash();
    expect(await world.readCatalog()).toBe(before);
    expect(await world.readNote(staged.noteId)).toMatchObject({ version: staged.version, storedState: 'staged' });
    await world.world.reopen();
    expect(await world.readCatalog()).toBe(before);
    expect(await world.readNote(staged.noteId)).toMatchObject({ version: staged.version, storedState: 'staged' });
  });
});
