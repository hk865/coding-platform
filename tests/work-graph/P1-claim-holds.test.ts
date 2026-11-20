/**
 * P1 H1–H6 (contract `p1-frozen.md` 2.4, 2.5, 2.6; section 五) and the review table's C2, C4 (`cp1-review-rulings.md`):
 * the `TaskClaimHold` owner (`platform.claimHolds`) and the claim owner reading it. Rounds are `openP1World`'s held
 * planning rounds; the platform's scribe stop, the operator's release-all and withdraw, and the Host's marked claim go
 * through `P1-platform-entry.ts` (ruling T1); every other claim is the Workflow's own claim step performed through the
 * public `workflow/advance`. Each scribe stop names a Run of its own Task. Expected values are the contract's and the
 * rework table's.
 *
 * Red before P1: `platform.claimHolds` did not exist. Red until the review's fixes: C2 (`place` did not guard the
 * Goal), C4 (`releaseAll` and `withdraw` acted on another project's records).
 *
 * Mutations (lead): H1 releasing one reason releases all; H2 a secretary may release the scribe's reason; H3 the
 * person's release-all skips the scribe's reason, or clears `pendingStop`; H4 the rework releases the hold; H5 the
 * claim ignores the intervention mark (the claim is busy); H6 the right drops "any secretary or adviser of this Goal"
 * (S is refused), or drops the responsible link check (B may release); C2, C4 the review fix removed (the Goal
 * guard on `place`; the project check of `releaseAll`, of `withdraw`); N2 the Goal guard on `placeScribeStop`
 * removed (red until the second review fix). The M rows follow the named mutations (`cp1-mut-rulings.md`): M4-7
 * `releaseAll`'s Host or operator check deleted; M4-8 `placeScribeStop`'s automation check deleted, whole or in part.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import {
  hostClaim, otherHostReleaseAll, P1_OTHER_PROJECT, personReleaseAll, personWithdraw, placeScribeStop,
} from '../helpers/P1-platform-entry.js';
import type { P1HeldRound, P1World } from '../helpers/P1-round-fixture.js';
import {
  actionRefOf, cancelByPlan, holdOf, p1Worlds, performClaim, personRequestsAction, personSends, pointerRef,
  reachedBefore, reasonNamed, requestOf, reworkPins, write,
} from '../helpers/P1-reads.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds = p1Worlds();
afterEach(async () => {
  const unreleased = commitBarrier.reset();
  await worlds.closeAll();
  expect(unreleased).toEqual([]);
});
const LONG = 600_000;

describe('H1–H6: holding a Task back from its claim', () => {
  it('H1: A and S each hold tA; A releases its own; the claim is busy with S\'s reason; after S releases it claims', async () => {
    const p1 = await worlds.open();
    const [a, s] = await p1.holdRounds([p1.lines.A, p1.lines.S], 'h1');
    const { claimHolds } = p1.world.platform;
    expect(await claimHolds.place(a.ctx, write({ taskRef: p1.task.tA, reason: 'P1 H1 adviser hold' }, 'h1-place-a')))
      .toMatchObject({ status: 'committed' });
    expect(await claimHolds.place(s.ctx, write({ taskRef: p1.task.tA, reason: 'P1 H1 secretary hold' }, 'h1-place-s')))
      .toMatchObject({ status: 'committed' });
    const both = await holdOf(p1, p1.task.tA);
    expect(both?.reasons.filter((reason: { state: string }) => reason.state === 'held')).toHaveLength(2);

    expect(await claimHolds.release(a.ctx, write({ taskRef: p1.task.tA,
      reasonId: reasonNamed(both, 'P1 H1 adviser hold').id }, 'h1-release-a'))).toMatchObject({ status: 'committed' });
    const one = await holdOf(p1, p1.task.tA);
    expect(one?.reasons.filter((reason: { state: string }) => reason.state === 'held').map((reason: { reason: string }) => reason.reason))
      .toEqual(['P1 H1 secretary hold']);

    const busy = await performClaim(p1.world, await p1.claimStep(p1.lines.E, p1.task.tA, 'h1-first'));
    expect(busy).toMatchObject({ status: 'rejected', code: 'busy' });
    expect(busy.reason).toContain('claim hold');
    expect(busy.reason).toContain('P1 H1 secretary hold');

    expect(await claimHolds.release(s.ctx, write({ taskRef: p1.task.tA,
      reasonId: reasonNamed(one, 'P1 H1 secretary hold').id }, 'h1-release-s'))).toMatchObject({ status: 'committed' });
    expect(await performClaim(p1.world, await p1.claimStep(p1.lines.E, p1.task.tA, 'h1-again')))
      .toMatchObject({ status: 'committed' });
  }, LONG);

  it('H2: the platform\'s scribe stop on tC (its own Run): the secretary may not release it, the responsible adviser may', async () => {
    const p1 = await worlds.open();
    const [a, s] = await p1.holdRounds([p1.lines.A, p1.lines.S], 'h2');
    expect(await placeScribeStop(p1.world, { taskRef: p1.task.tC, reason: 'P1 H2 scribe stop',
      sourceMessage: a.source, run: p1.runC, operationId: 'p1-h2-scribe' }, 'h2-scribe')).toMatchObject({ status: 'committed' });
    const reasonId = reasonNamed(await holdOf(p1, p1.task.tC), 'P1 H2 scribe stop').id;

    const bySecretary = await p1.world.platform.claimHolds.release(s.ctx,
      write({ taskRef: p1.task.tC, reasonId }, 'h2-release-s'));
    expect(bySecretary).toMatchObject({ status: 'rejected', code: 'forbidden' });
    if (bySecretary.status === 'rejected') expect(bySecretary.reason).toContain('responsible adviser');
    expect(reasonNamed(await holdOf(p1, p1.task.tC), 'P1 H2 scribe stop').state).toBe('held');

    expect(await p1.world.platform.claimHolds.release(a.ctx, write({ taskRef: p1.task.tC, reasonId }, 'h2-release-a')))
      .toMatchObject({ status: 'committed' });
    expect(reasonNamed(await holdOf(p1, p1.task.tC), 'P1 H2 scribe stop').state).toBe('released');
  }, LONG);

  it('H3: every step; tB holds S\'s reason, the scribe\'s and A\'s stop card; the person releases all; the claim is still busy (stop request)', async () => {
    const p1 = await worlds.open({ running: true, autonomy: 'every_step' });
    const [a, s] = await p1.holdRounds([p1.lines.A, p1.lines.S], 'h3');
    expect(await p1.world.platform.claimHolds.place(s.ctx,
      write({ taskRef: p1.task.tB, reason: 'P1 H3 secretary hold' }, 'h3-place-s'))).toMatchObject({ status: 'committed' });
    expect(await placeScribeStop(p1.world, { taskRef: p1.task.tB, reason: 'P1 H3 scribe stop',
      sourceMessage: a.source, run: p1.runB!, operationId: 'p1-h3-scribe' }, 'h3-scribe')).toMatchObject({ status: 'committed' });
    const card = await p1.world.platform.actionRequests.requestStop(a.ctx,
      write({ taskRef: p1.task.tB, reason: 'P1 H3 stop' }, 'h3-stop'));
    expect(card).toMatchObject({ status: 'needs_decision' });

    expect(await personReleaseAll(p1.world, p1.task.tB, 'h3-release-all')).toMatchObject({ status: 'committed' });
    const hold = await holdOf(p1, p1.task.tB);
    expect(hold?.reasons.map((reason: { reason: string; state: string }) => [reason.reason, reason.state])).toEqual([
      ['P1 H3 secretary hold', 'released'], ['P1 H3 scribe stop', 'released']]);
    expect(pointerRef(hold?.pendingStop)).toEqual(actionRefOf(card));

    // The claim reads the hold only after the Session admission, so E must be free: its Run ends (failed), the person
    // reworks tB (`tasks/requeue`), and the Workflow's own claim of that rework meets the stop card.
    await p1.endB();
    expect((await p1.world.post('tasks/requeue', graphWrite(S6A_SCOPE, { taskRef: p1.task.tB, afterRunRef: p1.runB,
      reason: 'P1 H3 person rework' }, 'h3-requeue', await reworkPins(p1, p1.runB!)))).body)
      .toMatchObject({ status: 'committed', value: { kind: 'requeued' } });
    const claimed = await performClaim(p1.world, await p1.claimStep(p1.lines.E, p1.task.tB, 'h3'));
    expect(claimed).toMatchObject({ status: 'rejected', code: 'busy' });
    expect(claimed.reason).toContain('stop request');
  }, LONG);

  it('H4: tC holds S\'s reason; A\'s round reworks tC; the claim with the returned requeueRef is busy (claim hold)', async () => {
    const p1 = await worlds.open();
    const [a, s] = await p1.holdRounds([p1.lines.A, p1.lines.S], 'h4');
    expect(await p1.world.platform.claimHolds.place(s.ctx,
      write({ taskRef: p1.task.tC, reason: 'P1 H4 secretary hold' }, 'h4-place-s'))).toMatchObject({ status: 'committed' });
    const rework = await p1.world.platform.claims.requeueTask!(a.ctx, { input: { taskRef: p1.task.tC,
      afterRunRef: p1.runC, reason: 'P1 H4 rework' }, meta: { requestId: 'h4-rework', expected: await reworkPins(p1, p1.runC) } });
    expect(rework).toMatchObject({ status: 'committed', value: { kind: 'requeued' } });
    expect(reasonNamed(await holdOf(p1, p1.task.tC), 'P1 H4 secretary hold').state).toBe('held');

    const step = await p1.claimStep(p1.lines.E2, p1.task.tC, 'h4');
    if (rework.status !== 'committed' || rework.value.kind !== 'requeued') return;
    expect(step).toMatchObject({ operation: { request: { input: { requeueRef: rework.value.requeue.ref } } } });
    const claimed = await performClaim(p1.world, step);
    expect(claimed).toMatchObject({ status: 'rejected', code: 'busy' });
    expect(claimed.reason).toContain('claim hold');
  }, LONG);

  it('H5: tA holds S\'s reason and the scribe\'s; the Host\'s intervention claim on tA claims and releases both', async () => {
    const p1 = await worlds.open();
    // The scribe stops a Run of tA itself: E runs tA to a failed check first, and the person reworks it below.
    const runA = await p1.failWork(p1.lines.E, p1.task.tA, 'h5-ta');
    const [a, s] = await p1.holdRounds([p1.lines.A, p1.lines.S], 'h5');
    expect(await p1.world.platform.claimHolds.place(s.ctx,
      write({ taskRef: p1.task.tA, reason: 'P1 H5 secretary hold' }, 'h5-place-s'))).toMatchObject({ status: 'committed' });
    expect(await placeScribeStop(p1.world, { taskRef: p1.task.tA, reason: 'P1 H5 scribe stop',
      sourceMessage: a.source, run: runA, operationId: 'p1-h5-scribe' }, 'h5-scribe')).toMatchObject({ status: 'committed' });
    expect((await p1.world.post('tasks/requeue', graphWrite(S6A_SCOPE, { taskRef: p1.task.tA, afterRunRef: runA,
      reason: 'P1 H5 person rework' }, 'h5-requeue', await reworkPins(p1, runA)))).body)
      .toMatchObject({ status: 'committed', value: { kind: 'requeued' } });
    // The person's direct action_request on tA to E is the intervention the claim carries.
    const messageRef = await personRequestsAction(p1, p1.lines.E, p1.task.tA, 'P1 H5 do tA now', 'h5-intervene');
    const claimed = await hostClaim(p1.world, await p1.claimStep(p1.lines.E, p1.task.tA, 'h5'),
      { intervention: { messageRef } });
    expect(claimed).toMatchObject({ status: 'committed' });
    const hold = await holdOf(p1, p1.task.tA);
    expect(hold?.reasons).toHaveLength(2);
    for (const reason of hold?.reasons ?? []) {
      expect(reason).toMatchObject({ state: 'released', releasedBy: { kind: 'intervention', messageRef } });
    }
  }, LONG);

  it('H6: A holds tA; the region adviser B may not release A\'s reason (may not release); the secretary S may', async () => {
    const p1 = await worlds.open();
    const [a, s, b] = await p1.holdRounds([p1.lines.A, p1.lines.S, p1.lines.B], 'h6');
    const { claimHolds } = p1.world.platform;
    expect(await claimHolds.place(a.ctx, write({ taskRef: p1.task.tA, reason: 'P1 H6 adviser hold' }, 'h6-place-a')))
      .toMatchObject({ status: 'committed' });
    const reasonId = reasonNamed(await holdOf(p1, p1.task.tA), 'P1 H6 adviser hold').id;

    const byRegion = await claimHolds.release(b.ctx, write({ taskRef: p1.task.tA, reasonId }, 'h6-release-b'));
    expect(byRegion).toMatchObject({ status: 'rejected', code: 'forbidden' });
    if (byRegion.status === 'rejected') expect(byRegion.reason).toContain('may not release');
    expect(reasonNamed(await holdOf(p1, p1.task.tA), 'P1 H6 adviser hold').state).toBe('held');

    expect(await claimHolds.release(s.ctx, write({ taskRef: p1.task.tA, reasonId }, 'h6-release-s')))
      .toMatchObject({ status: 'committed' });
    expect(reasonNamed(await holdOf(p1, p1.task.tA), 'P1 H6 adviser hold')).toMatchObject({ state: 'released',
      releasedBy: { kind: 'agent', session: p1.lines.S.ref } });
  }, LONG);
});

describe('C2, N2 (storage, both backends): a hold guards the Goal it read', () => {
  it.each(['memory', 'sqlite'] as const)('C2 %s: a new Plan cancels tA while A\'s hold of tA waits after its reads: the hold conflicts', async (backend) => {
    const p1 = await worlds.open({ backend });
    const a = await p1.hold(p1.lines.A, 'c2-a');
    const held = commitBarrier.hold(commit => commit.records.some(record =>
      record.refKey.includes('"aggregateType":"TaskClaimHold"')), 'C2 place');
    const placing = p1.world.platform.claimHolds.place(a.ctx, write({ taskRef: p1.task.tA, reason: 'P1 C2 hold' }, 'c2-place'));
    try {
      await reachedBefore(held.reached, placing);
      await cancelByPlan(p1, p1.task.tA, 'c2');
    } finally {
      held.release();
    }
    expect(await placing).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(await holdOf(p1, p1.task.tA)).toBeNull();
  }, LONG);

  it.each(['memory', 'sqlite'] as const)('N2 %s: a new Plan cancels tC while the platform\'s scribe stop on tC waits after its reads: the stop conflicts; no scribe reason', async (backend) => {
    const p1 = await worlds.open({ backend });
    const source = await personSends(p1.world, p1.lines.A, 'P1 N2 scribe source', 'n2-source', false);
    const held = commitBarrier.hold(commit => commit.records.some(record =>
      record.refKey.includes('"aggregateType":"TaskClaimHold"')), 'N2 scribe stop');
    const placing = placeScribeStop(p1.world, { taskRef: p1.task.tC, reason: 'P1 N2 scribe stop', sourceMessage: source,
      run: p1.runC, operationId: 'p1-n2-scribe' }, 'n2-scribe');
    try {
      await reachedBefore(held.reached, placing);
      await cancelByPlan(p1, p1.task.tC, 'n2');
    } finally {
      held.release();
    }
    expect(await placing).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(await holdOf(p1, p1.task.tC)).toBeNull();
  }, LONG);
});

describe('rejects: C4, the operator\'s writes in another project\'s context', () => {
  it('releaseAll of tA from another project: forbidden; A\'s reason stays held', async () => {
    const p1 = await worlds.open();
    const a = await p1.hold(p1.lines.A, 'c4-hold-a');
    expect(await p1.world.platform.claimHolds.place(a.ctx, write({ taskRef: p1.task.tA, reason: 'P1 C4 hold' },
      'c4-place'))).toMatchObject({ status: 'committed' });
    const refused = await personReleaseAll(p1.world, p1.task.tA, 'c4-release-all', P1_OTHER_PROJECT);
    expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden' });
    if (refused.status === 'rejected') expect(refused.reason).toContain('project');
    expect(reasonNamed(await holdOf(p1, p1.task.tA), 'P1 C4 hold').state).toBe('held');
  }, LONG);

  it('withdraw of A\'s open dispatch from another project: forbidden; the request stays open', async () => {
    const p1 = await worlds.open();
    const a = await p1.hold(p1.lines.A, 'c4-withdraw-a');
    const requested = await p1.world.platform.actionRequests.requestDispatch(a.ctx,
      write({ taskRef: p1.task.tA, reason: 'P1 C4 dispatch' }, 'c4-dispatch'));
    expect(requested).toMatchObject({ status: 'requested' });
    const refused = await personWithdraw(p1.world, actionRefOf(requested), 'c4-withdraw', P1_OTHER_PROJECT);
    expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden' });
    if (refused.status === 'rejected') expect(refused.reason).toContain('project');
    expect(await requestOf(p1, actionRefOf(requested))).toMatchObject({ state: 'open' });
  }, LONG);
});

// After the named mutations (`cp1-mut-rulings.md` B): only the operator releases all, only the platform places a
// scribe stop. One world, one caller per row; A's reason on tC stays the only one, held.
const scribeOnTC = (p1: P1World, a: P1HeldRound) => write({ taskRef: p1.task.tC, reason: 'P1 M4-8 scribe stop',
  sourceMessage: a.source, run: p1.runC, operationId: 'p1-m48-scribe' }, 'm48-scribe');
const holdCallers: Array<[string, string, string, (p1: P1World, a: P1HeldRound) => Promise<unknown>]> = [
  ['M4-7', 'A\'s round releases every reason', 'only the configured operator may release every claim hold reason',
    async (p1, a) => await p1.world.platform.claimHolds.releaseAll(a.ctx, write({ taskRef: p1.task.tC }, 'm47-a'))],
  ['M4-7', 'a Host that is not the operator releases every reason', 'only the configured operator may release every',
    async p1 => await otherHostReleaseAll(p1.world, p1.task.tC, 'm47-host')],
  ['M4-8', 'A\'s round places a scribe stop', 'only the platform automation may place a scribe stop',
    async (p1, a) => await p1.world.platform.claimHolds.placeScribeStop(a.ctx, scribeOnTC(p1, a))],
  ['M4-8', 'the operator places a scribe stop', 'only the platform automation may place a scribe stop',
    async (p1, a) => await p1.world.platform.claimHolds.placeScribeStop(p1.world.humanContext(), scribeOnTC(p1, a))],
];

describe('rejects: M4-7, M4-8, releasing all or placing a scribe stop by a wrong caller', () => {
  it.each(holdCallers)('%s: A holds tC; %s: forbidden (%s); A\'s reason stays the only one', async (_id, _who, reason, call) => {
    const p1 = await worlds.open();
    const a = await p1.hold(p1.lines.A, 'm4-a');
    expect(await p1.world.platform.claimHolds.place(a.ctx, write({ taskRef: p1.task.tC, reason: 'P1 M4 hold' },
      'm4-place'))).toMatchObject({ status: 'committed' });
    // `resolves`: the owner answers its refusal; a caller check removed shows as a rejected promise here.
    await expect(call(p1, a)).resolves.toMatchObject({ status: 'rejected', code: 'forbidden',
      reason: expect.stringContaining(reason) });
    expect((await holdOf(p1, p1.task.tC))?.reasons).toMatchObject([{ reason: 'P1 M4 hold', state: 'held' }]);
  }, LONG);
});
