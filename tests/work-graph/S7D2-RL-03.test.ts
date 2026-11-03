/**
 * RL-03 (`7d2-start-rulings.v4.md:8841`, with `sessions/read` per the O1b run sheet `run-7d2-o1b.md:50`; book
 * `:1306`): an adviser scope already held is refused with the held scope named, and a nested child region is a
 * scope of its own.
 *
 * World: `openS7D2RegionWorld` (tests/helpers/S7D2-role-line-world.ts), memory. Adviser A was opened on region
 * M = `src` through `role-lines/open`; the adopted catalog declares `src/a` (M/x) a child of `src`.
 *
 * Expected (from the row; the canonical M is `canonicalKey({kind:'region',moduleRef:M})`, written out by hand):
 * B on `[region M]` is `{status:'rejected',code:'revision_conflict',scopeOwned:{duty:'adviser',
 * target:{kind:'region',moduleRef:M},holder:A},reason:'scope_owned: the adviser scope <canonical M> is held by
 * <A.sessionId>'}`; B on `[region M/x]` commits, `sessions/read` shows B's region link open on M/x and A's on M; both
 * claims exist (A's refused B; B's refuses a third adviser on M/x naming B); `role-lines/allocation` lists A and B
 * once each among the adviser holders.
 *
 * Named mutation: `role-scope:` no longer selected in `scopeOwnedDetailOfSlot` (`src/contracts/role-lines.ts`), so
 * the refusal falls back to the generic `revision_conflict` with no `scopeOwned` (DR7d2O1b list B: deleting the
 * prefix check alone is not this mutation).
 *
 * O1B-R1-02 (rework-1 A2; the one fault the row now names): a `CommitBarrier.hold` on the late twin's registration
 * commit. Two calls of one `open` race on M; the second ends the operation failed (scope_owned) and cancels its
 * reservation; M is freed and a standby open takes the free seat; then the held registration goes on. It must not
 * register (v4 :2011: no later registration of a terminal op): the adviser holders stay 4 (opening adviser, A, B, the
 * standby; `open.adviser` 4 by hand), no reservation is left and no line holds M. Named mutation: drop the
 * registration's reservation check (`session-directory.ts`): 5 holders and a line on M.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { roleScopeClaimKey } from '../../src/contracts/role-lines.js';
import { byClaimMove, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import {
  openS7D2RegionWorld, openTargetsOf, type S7D2RegionWorld,
} from '../helpers/S7D2-role-line-world.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S7D2RegionWorld[] = [];
afterEach(async () => {
  expect(commitBarrier.reset()).toEqual([]);
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
});

const CANONICAL_M = '{"kind":"region","moduleRef":{"moduleId":"src","projectId":"ag2b-collab-project"}}';

describe('RL-03', () => {
  it('RL-03 (memory): a held adviser region is refused naming its holder; its child region opens', async () => {
    const world = await openS7D2RegionWorld({ backend: 'memory' });
    worlds.push(world);
    const a = world.regionAdviser;
    const regionM = { kind: 'region' as const, moduleRef: world.modules.region };
    const regionX = { kind: 'region' as const, moduleRef: world.modules.child };

    expect((await world.open({ duty: 'adviser', scope: [regionM], requestId: 's7d2-rl03-b-on-m' })).result)
      .toMatchObject({
        status: 'rejected', code: 'revision_conflict',
        scopeOwned: { duty: 'adviser', target: regionM, holder: a.ref },
        reason: `scope_owned: the adviser scope ${CANONICAL_M} is held by ${a.ref.sessionId}`,
      });

    const b = await world.lineOf('s7d2-rl03-b', (await world.open({
      duty: 'adviser', scope: [regionX], requestId: 's7d2-rl03-b-on-x' })).result);
    expect(openTargetsOf(await world.readCard(b))).toEqual([{ kind: 'module', ref: world.modules.child }]);
    expect(openTargetsOf(await world.readCard(a))).toEqual([{ kind: 'module', ref: world.modules.region }]);

    // B's claim is the child's own: a third adviser on M/x is refused naming B.
    expect((await world.open({ duty: 'adviser', scope: [regionX], requestId: 's7d2-rl03-c-on-x' })).result)
      .toMatchObject({ status: 'rejected', code: 'revision_conflict',
        scopeOwned: { duty: 'adviser', target: regionX, holder: b.ref } });

    const holders = (await world.allocation()).duties.adviser.holders.map(holder => holder.session.sessionId);
    expect(holders.filter(id => id === a.ref.sessionId)).toHaveLength(1);
    expect(holders.filter(id => id === b.ref.sessionId)).toHaveLength(1);

    // O1B-R1-02: a terminal open's late registration does not register.
    await world.setOpen('adviser', 4, 's7d2-rl03-cap');
    const held = commitBarrier.hold(byClaimMove(roleScopeClaimKey({ projectRef: { projectId: a.ref.projectId },
      duty: 'adviser', target: regionM })), 'RL-03 late twin');
    const first = world.open({ duty: 'adviser', scope: [regionM], requestId: 's7d2-rl03-late' });
    await held.reached;
    expect((await world.open({ duty: 'adviser', scope: [regionM], requestId: 's7d2-rl03-late' })).result)
      .toMatchObject({ status: 'rejected', code: 'revision_conflict', scopeOwned: { holder: a.ref } });
    expect((await world.changeScope({ session: a, scope: [], requestId: 's7d2-rl03-free-m' })).result)
      .toMatchObject({ status: 'committed' });
    await world.lineOf('s7d2-rl03-fill', (await world.open({ duty: 'adviser', scope: [],
      requestId: 's7d2-rl03-fill' })).result);
    held.release();
    expect((await first).result).toMatchObject({ status: 'rejected', code: 'revision_conflict',
      reason: `scope_owned: the adviser scope ${CANONICAL_M} is held by ${a.ref.sessionId}` });
    const adviser = (await world.allocation()).duties.adviser;
    expect(adviser.holders).toHaveLength(4);
    expect(adviser.reservations).toEqual([]);
    const onM = (await world.findByTarget({ kind: 'module', ref: world.modules.region }))
      .filter(card => openTargetsOf(card).some(target => target.kind === 'module'
        && target.ref.moduleId === world.modules.region.moduleId));
    expect(onM).toEqual([]);
  }, 180_000);
});
