/**
 * P1 S1–S7, K1 (contract `p1-frozen.md` 2.3, 2.4, 2.7; section 五) and the review table's C3, C5, C6
 * (`cp1-review-rulings.md`): a round's stop request on E's running tB, the platform's delivery of a released stop and
 * its settle (`deliverStop`, `settle`, through `P1-platform-entry.ts`, ruling T1), and the control owner's
 * action-sourced steer. The Run, its pause and its control intents are read through `executions/read` and
 * `controls/read`; the request and the hold through the owners' public reads; an answer's intent only from a
 * successful answer (`answeredIntentOf`). Expected values are the contract's and the rework table's; the steer text is 2.3's
 * sentence around this row's own reason.
 *
 * Red before P1: `platform.actionRequests` did not exist; K1's `source` was not part of `controls/submit`. Red until
 * the review's fixes: S7 (C3: the delivery read the Run before the intent and answered its lost not-sent write from
 * the control owner's replay), C5 (`settle` voided a stop card), C6 (an ended Run was refused before the waiting card
 * was named).
 *
 * Mutations (lead): S1 the stop card does not take `pendingStop`; S2 the release writes no hold; S3 the steer
 * fingerprint keeps `expected`; S4 the delivery does not read the pointer; S5 the delivery records notSent although
 * the deterministic intent already exists; S6 the delivery does not see the ended Run; S7 the not-sent write does not
 * guard "no intent yet", or does not re-read the intent after losing; K1 the new paused refusal deleted; C5, C6 the
 * review fix removed (`settle` takes only a dispatch; the waiting card is named before the running-Run check); X1 a
 * card read through the pointer still counts when it is no longer pending (red until the second review fix). The M
 * rows follow the named mutations (`cp1-mut-rulings.md`): M3-3 the paused refusal deleted; M3-8 the withdraw right
 * always granted (a round, a Host); M3-9, M3-10 the automation checks deleted, or a pending card delivered; M3-11 the
 * steer not cut; M7-1 each part of the source shape check deleted. M3-4 is U2's (the pure table); M3-6, M3-7 (the
 * card answer) wait for P2's real card.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalRefKey } from '../../src/core/work-graph/persistence/record-codecs.js';
import type { ActionRequestRef } from '../../src/contracts/action-request.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { roleReadGate } from '../helpers/S8C-role-read-gate.js';
import { deliverStop, otherHostWithdraw, platformSettle } from '../helpers/P1-platform-entry.js';
import type { P1HeldRound, P1World } from '../helpers/P1-round-fixture.js';
import {
  actionRefOf, holdOf, answeredIntentOf, p1Worlds, pointerRef, reachedBefore, requestOf, runRecordOf, steersOf, write,
} from '../helpers/P1-reads.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';

// The commit barrier on both backends, and (S7) the existing read gate over the same records (A3).
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const { inMemoryBarrierModule } = await import('../helpers/S6A-commit-barrier.js');
  const { inMemoryRoleGateModule } = await import('../helpers/S8C-role-read-gate.js');
  return await inMemoryRoleGateModule(() => inMemoryBarrierModule(importOriginal));
});
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) => {
  const { sqliteBarrierModule } = await import('../helpers/S6A-commit-barrier.js');
  const { roleReadGate: gate } = await import('../helpers/S8C-role-read-gate.js');
  const barrier = await sqliteBarrierModule(importOriginal);
  return { ...barrier, createSqliteRecordBackend: (options: Parameters<typeof barrier.createSqliteRecordBackend>[0]) => {
    const backend = barrier.createSqliteRecordBackend(options);
    const real = backend.records;
    return { ...backend, records: { ...real,
      readMany: (keys: readonly string[]) => gate.read(keys, next => real.readMany(next)) } };
  } };
});

const worlds = p1Worlds();
afterEach(async () => {
  roleReadGate.reset();
  const unreleased = commitBarrier.reset();
  await worlds.closeAll();
  expect(unreleased).toEqual([]);
});
/** Every stop row runs on a world whose tB is running. */
const openRunning = (options: { backend?: 'memory' | 'sqlite'; autonomy?: 'every_step' } = {}): Promise<P1World> =>
  worlds.open({ running: true, ...options });
const LONG = 600_000;
const steerText = (reason: string) => `请收尾停下：${reason}；把做到一半的东西交代清楚再结束`;

/** S2's first half: A asks to stop tB in the automatic level; the stop is released with its hold reason. */
async function releasedStop(p1: P1World, a: P1HeldRound, label: string) {
  const released = await p1.world.platform.actionRequests.requestStop(a.ctx,
    write({ taskRef: p1.task.tB, reason: `P1 ${label} stop` }, `${label}-stop`));
  expect(released).toMatchObject({ status: 'released', notSent: null });
  return released as { actionRef: ActionRequestRef; holdReasonId: string };
}

/** The operator's pause of `run` through `controls/submit`, pinned at the Run revision just read. */
async function pause(p1: P1World, run: RunRef, label: string) {
  const revision = (await runRecordOf(p1.world, run)).revision;
  const paused = (await p1.world.post('controls/submit', graphWrite(S6A_SCOPE, { runRef: run, kind: 'pause',
    reason: `P1 ${label} pause` }, `${label}-pause`, [{ ref: run, revision }]))).body;
  expect(paused).toMatchObject({ status: 'committed' });
}

describe('S1, S2, S4–S6: the stop request and its delivery', () => {
  it('S1: every step; A asks to stop tB (needs a decision, takes pendingStop); a second ask is busy; A withdraws', async () => {
    const p1 = await openRunning({ autonomy: 'every_step' });
    const a = await p1.hold(p1.lines.A, 's1-a');
    const { actionRequests } = p1.world.platform;
    const card = await actionRequests.requestStop(a.ctx, write({ taskRef: p1.task.tB, reason: 'P1 S1 stop' }, 's1-stop'));
    expect(card).toMatchObject({ status: 'needs_decision' });
    expect(pointerRef((await holdOf(p1, p1.task.tB))?.pendingStop)).toEqual(actionRefOf(card));

    const again = await actionRequests.requestStop(a.ctx, write({ taskRef: p1.task.tB, reason: 'P1 S1 again' }, 's1-again'));
    expect(again).toMatchObject({ status: 'rejected', code: 'busy' });
    if (again.status === 'rejected') expect(again.reason).toContain('pending stop request');
    if (again.status === 'rejected') expect(again.current?.map(pin => pin.ref)).toContainEqual(actionRefOf(card));

    expect(await actionRequests.withdraw(a.ctx, write({ request: actionRefOf(card) }, 's1-withdraw')))
      .toMatchObject({ status: 'committed' });
    expect((await holdOf(p1, p1.task.tB))?.pendingStop ?? null).toBeNull();
  }, LONG);

  it('S2: automatic; the stop is released with a stop reason; the delivery queues one steer with the closing text', async () => {
    const p1 = await openRunning();
    const a = await p1.hold(p1.lines.A, 's2-a');
    const released = await releasedStop(p1, a, 's2');
    expect((await holdOf(p1, p1.task.tB))?.reasons).toMatchObject([
      { id: released.holdReasonId, kind: 'stop', state: 'held' }]);
    await deliverStop(p1.world, released.actionRef);
    expect(await steersOf(p1.world, p1.runB!)).toMatchObject([
      { kind: 'steer', status: 'queued', reason: steerText('P1 s2 stop') }]);
  }, LONG);

  it('S4: the operator pauses the Run after the release; the delivery records person_stopped and sends nothing', async () => {
    const p1 = await openRunning();
    const a = await p1.hold(p1.lines.A, 's4-a');
    const released = await releasedStop(p1, a, 's4');
    await pause(p1, p1.runB!, 's4');
    await deliverStop(p1.world, released.actionRef);
    expect(await requestOf(p1, released.actionRef)).toMatchObject({ state: 'released',
      outcome: { notSent: 'person_stopped' } });
    expect((await holdOf(p1, p1.task.tB))?.reasons).toMatchObject([{ kind: 'stop', state: 'held' }]);
    expect(await steersOf(p1.world, p1.runB!)).toEqual([]);
  }, LONG);

  // Ruling ③: "no intent read first" has no public trace (the control owner replays the resubmitted steer), so S5's
  // mutation is the delivery recording notSent although the intent exists (notSent turns non-null).
  it('S5: a second delivery answers the intent already there; notSent stays null', async () => {
    const p1 = await openRunning();
    const a = await p1.hold(p1.lines.A, 's5-a');
    const released = await releasedStop(p1, a, 's5');
    const first = await deliverStop(p1.world, released.actionRef);
    const second = await deliverStop(p1.world, released.actionRef);
    expect(answeredIntentOf(second)?.ref).toBeDefined();
    expect(answeredIntentOf(second)?.ref).toEqual(answeredIntentOf(first)?.ref);
    expect(await requestOf(p1, released.actionRef)).toMatchObject({ outcome: { notSent: null } });
    expect(await steersOf(p1.world, p1.runB!)).toHaveLength(1);
  }, LONG);

  it('S6: the Run ends after the release; the delivery records run_ended and sends nothing', async () => {
    const p1 = await openRunning();
    const a = await p1.hold(p1.lines.A, 's6-a');
    const released = await releasedStop(p1, a, 's6');
    await p1.endB();
    await deliverStop(p1.world, released.actionRef);
    expect(await requestOf(p1, released.actionRef)).toMatchObject({ state: 'released',
      outcome: { notSent: 'run_ended' } });
    expect((await holdOf(p1, p1.task.tB))?.reasons).toMatchObject([{ kind: 'stop', state: 'held' }]);
    expect(await steersOf(p1.world, p1.runB!)).toEqual([]);
  }, LONG);

  it('M3-11: automatic; A\'s stop reason is 700 × `界` (2,100 bytes); the delivered steer is cut at a UTF-8 character to 2,046 bytes', async () => {
    const p1 = await openRunning();
    const a = await p1.hold(p1.lines.A, 'm311-a');
    const released = await p1.world.platform.actionRequests.requestStop(a.ctx,
      write({ taskRef: p1.task.tB, reason: '界'.repeat(700) }, 'm311-stop'));
    await deliverStop(p1.world, actionRefOf(released));
    // Hand-counted (2.3: cut to 2,048 UTF-8 bytes): the head `请收尾停下：` is 6 × 3 = 18 bytes; 676 × `界` = 2,028
    // bytes makes 2,046; one more `界` would be 2,049. The rest of the reason and the closing tail are cut.
    expect(await steersOf(p1.world, p1.runB!)).toMatchObject([{ reason: `请收尾停下：${'界'.repeat(676)}` }]);
  }, LONG);
});

describe('S3, S7 (storage, both backends): two deliveries make one intent', () => {
  it.each(['memory', 'sqlite'] as const)('S3 %s: the first delivery\'s commit is held, the second completes: one intent', async (backend) => {
    const p1 = await openRunning({ backend });
    const a = await p1.hold(p1.lines.A, 's3-a');
    const released = await releasedStop(p1, a, 's3');
    const held = commitBarrier.hold(commit => commit.records.some(record =>
      record.refKey.includes('"aggregateType":"ControlIntent"')), 'S3 first delivery');
    const first = deliverStop(p1.world, released.actionRef);
    let second: unknown;
    try {
      await reachedBefore(held.reached, first);
      second = await deliverStop(p1.world, released.actionRef);
    } finally {
      held.release();
    }
    const steers = await steersOf(p1.world, p1.runB!);
    expect(steers).toHaveLength(1);
    expect(answeredIntentOf(await first)?.ref).toEqual(steers[0]!.ref);
    expect(answeredIntentOf(second)?.ref).toEqual(steers[0]!.ref);
  }, LONG);

  // Ruling ③: both deliveries above read the same Run revision, and a stale pin is retried through the intent read,
  // so a fingerprint that keeps `expected` gives the same answers there. The control owner's own replay shows it: the
  // same sourced steer resent with the Run revision re-read after the first one landed answers the first intent.
  it.each(['memory', 'sqlite'] as const)('S3 %s: the same sourced steer resent at a newer Run revision answers the first intent', async (backend) => {
    const p1 = await openRunning({ backend });
    const a = await p1.hold(p1.lines.A, 's3f-a');
    const released = await releasedStop(p1, a, 's3f');
    const sourcedSteer = async (revision: number) => (await p1.world.post('controls/submit', graphWrite(S6A_SCOPE, {
      runRef: p1.runB, kind: 'steer', reason: 'P1 S3 sourced steer',
      source: { kind: 'action_request', actionRef: released.actionRef } }, 's3f-steer', [{ ref: p1.runB, revision }]))).body;
    const before = (await runRecordOf(p1.world, p1.runB!)).revision;
    const first = await sourcedSteer(before);
    const after = (await runRecordOf(p1.world, p1.runB!)).revision;
    expect(after).not.toBe(before);
    expect(first).toMatchObject({ status: 'committed' });
    const second = await sourcedSteer(after);
    expect(second).toMatchObject({ status: 'committed', replayed: true });
    // Each answer against the one steer the public read shows (ruling X5: two missing fields never compare equal).
    const steers = await steersOf(p1.world, p1.runB!);
    expect(steers).toHaveLength(1);
    expect(answeredIntentOf(first)?.ref).toEqual(steers[0]!.ref);
    expect(answeredIntentOf(second)?.ref).toEqual(steers[0]!.ref);
  }, LONG);

  it.each(['memory', 'sqlite'] as const)('S7 %s: one delivery read "no intent" and waits; the other delivers; the Run ends; the first answers the other\'s intent', async (backend) => {
    const p1 = await openRunning({ backend });
    const a = await p1.hold(p1.lines.A, 's7-a');
    const released = await releasedStop(p1, a, 's7');
    // C3: the first delivery reads the intent (absent) and only then the original Run; hold that Run read, so the
    // first goes on to its not-sent write after the other delivery's steer has landed and the Run has ended.
    const runKey = canonicalRefKey(p1.runB!);
    let intentRead = false;
    const gate = roleReadGate.holdRead(keys => {
      if (!intentRead) intentRead = keys.some(key => key.includes('"aggregateType":"ControlIntent"'));
      else if (keys.includes(runKey)) return true;
      return false;
    });
    const first = deliverStop(p1.world, released.actionRef);
    let second: unknown;
    try {
      await reachedBefore(gate.reached, first);
      second = await deliverStop(p1.world, released.actionRef);
      // Ruling X5: the other delivery's answer against the public read while its steer is still the latest state.
      const landed = await steersOf(p1.world, p1.runB!);
      expect(landed).toHaveLength(1);
      expect(second).toMatchObject({ status: 'steer' });
      expect(answeredIntentOf(second)).toMatchObject({ ref: landed[0]!.ref, status: landed[0]!.status });
      await p1.endB();
    } finally {
      gate.release();
    }
    const steers = await steersOf(p1.world, p1.runB!);
    expect(steers).toHaveLength(1);
    const answered = await first;
    expect(answered).toMatchObject({ status: 'steer' });
    expect(answeredIntentOf(answered)).toMatchObject({ ref: steers[0]!.ref, status: steers[0]!.status });
    expect(await requestOf(p1, released.actionRef)).toMatchObject({ outcome: { notSent: null } });
  }, LONG);
});

describe('rejects: C5, C6, X1, the stop card stays the one card', () => {
  it('C5: every step; the platform settles A\'s pending stop card: revision_conflict; the card and pendingStop stay', async () => {
    const p1 = await openRunning({ autonomy: 'every_step' });
    const a = await p1.hold(p1.lines.A, 'c5-a');
    const card = await p1.world.platform.actionRequests.requestStop(a.ctx,
      write({ taskRef: p1.task.tB, reason: 'P1 C5 stop' }, 'c5-stop'));
    expect(card).toMatchObject({ status: 'needs_decision' });
    // P2 §2.5: the caller that judged the cause passes it and the adopted Plan revision it read.
    const plan = await p1.world.platform.plans.queryGoal(p1.world.humanContext(), p1.goal, { scope: 'project' });
    if (plan.status !== 'ready' || plan.value.goal.activePlanRevision === null) {
      throw new Error('P1: the settle Goal has no adopted Plan revision');
    }
    expect(await platformSettle(p1.world, actionRefOf(card), 'P1 C5 the task is done', 'c5-settle',
      { kind: 'task_completed', planRevision: plan.value.goal.activePlanRevision }))
      .toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(await requestOf(p1, actionRefOf(card))).toMatchObject({ state: 'pending' });
    expect(pointerRef((await holdOf(p1, p1.task.tB))?.pendingStop)).toEqual(actionRefOf(card));
  }, LONG);

  it('C6: every step; tB\'s Run ends while A\'s stop card waits; a second ask is busy (pending stop request) naming the card', async () => {
    const p1 = await openRunning({ autonomy: 'every_step' });
    const a = await p1.hold(p1.lines.A, 'c6-a');
    const { actionRequests } = p1.world.platform;
    const card = await actionRequests.requestStop(a.ctx, write({ taskRef: p1.task.tB, reason: 'P1 C6 stop' }, 'c6-stop'));
    expect(card).toMatchObject({ status: 'needs_decision' });
    await p1.endB();
    const again = await actionRequests.requestStop(a.ctx, write({ taskRef: p1.task.tB, reason: 'P1 C6 again' }, 'c6-again'));
    expect(again).toMatchObject({ status: 'rejected', code: 'busy' });
    if (again.status === 'rejected') expect(again.reason).toContain('pending stop request');
    if (again.status === 'rejected') expect(again.current?.map(pin => pin.ref)).toContainEqual(actionRefOf(card));
  }, LONG);

  it('X1: every step; tB\'s Run ended while A\'s card X waits; X is withdrawn after a second ask read the pointer and before it read X: invalid (no running Run)', async () => {
    const p1 = await openRunning({ autonomy: 'every_step' });
    const a = await p1.hold(p1.lines.A, 'x1-a');
    const { actionRequests } = p1.world.platform;
    const card = await actionRequests.requestStop(a.ctx, write({ taskRef: p1.task.tB, reason: 'P1 X1 stop' }, 'x1-stop'));
    expect(card).toMatchObject({ status: 'needs_decision' });
    await p1.endB();
    // The second ask reads the hold's pointer, then the card it names: that read of X waits until X is withdrawn.
    const cardKey = canonicalRefKey(actionRefOf(card));
    const gate = roleReadGate.holdRead(keys => keys.includes(cardKey));
    const asking = actionRequests.requestStop(a.ctx, write({ taskRef: p1.task.tB, reason: 'P1 X1 again' }, 'x1-again'));
    try {
      await reachedBefore(gate.reached, asking);
      expect(await actionRequests.withdraw(a.ctx, write({ request: actionRefOf(card) }, 'x1-withdraw')))
        .toMatchObject({ status: 'committed' });
    } finally {
      gate.release();
    }
    const refused = await asking;
    expect(refused).toMatchObject({ status: 'rejected', code: 'invalid' });
    if (refused.status === 'rejected') expect(refused.reason).toContain('no running Run');
    expect(await requestOf(p1, actionRefOf(card))).toMatchObject({ state: 'withdrawn' });
    expect((await holdOf(p1, p1.task.tB))?.pendingStop ?? null).toBeNull();
  }, LONG);

  it('M3-3: the operator paused tB\'s Run; A asks to stop it: busy (already paused or stopping); no hold', async () => {
    const p1 = await openRunning();
    const a = await p1.hold(p1.lines.A, 'm33-a');
    await pause(p1, p1.runB!, 'm33');
    const refused = await p1.world.platform.actionRequests.requestStop(a.ctx,
      write({ taskRef: p1.task.tB, reason: 'P1 M3-3 stop' }, 'm33-stop'));
    expect(refused).toMatchObject({ status: 'rejected', code: 'busy',
      reason: expect.stringContaining('already paused or stopping') });
    expect(await holdOf(p1, p1.task.tB)).toBeNull();
  }, LONG);

});

// After the named mutations (`cp1-mut-rulings.md` B): one wrong caller per row. The card's answer (approve, deny) is
// not written here: P1 has no formal card answer to name (contract Q12), so it is checked on the real card in P2.
const refusedFor = (reason: string) =>
  ({ status: 'rejected', code: 'forbidden', reason: expect.stringContaining(reason) });
type CardCall = (p1: P1World, a: P1HeldRound, card: ActionRequestRef) => Promise<unknown>;
const cardCalls: Array<[string, string, object, CardCall]> = [
  ['M3-8', 'S\'s round withdraws it: forbidden', refusedFor('only the requesting line or the configured operator'),
    async (p1, a, card) => {
      await a.end();
      const s = await p1.hold(p1.lines.S, 'm38-s');
      return await p1.world.platform.actionRequests.withdraw(s.ctx, write({ request: card }, 'm38-withdraw-s'));
    }],
  ['M3-8', 'a Host that is not the operator withdraws it: forbidden', refusedFor('only the configured operator may'),
    async (p1, _a, card) => await otherHostWithdraw(p1.world, card, 'm38-withdraw-host')],
  ['M3-10', 'the platform delivers it before it is released: unchanged', { status: 'unchanged' },
    async (p1, _a, card) => await deliverStop(p1.world, card)],
];

describe('rejects: M3-8–M3-10, a stop or dispatch request acted on by a wrong caller; nothing changes', () => {
  it.each(cardCalls)('%s: every step; A\'s stop card on tB; %s; the card stays pending, nothing is sent', async (_id, _who, expected, call) => {
    const p1 = await openRunning({ autonomy: 'every_step' });
    const a = await p1.hold(p1.lines.A, 'm3-card-a');
    const card = actionRefOf(await p1.world.platform.actionRequests.requestStop(a.ctx,
      write({ taskRef: p1.task.tB, reason: 'P1 M3 stop' }, 'm3-stop')));
    expect(await call(p1, a, card)).toMatchObject(expected);
    expect(await requestOf(p1, card)).toMatchObject({ state: 'pending' });
    expect(pointerRef((await holdOf(p1, p1.task.tB))?.pendingStop)).toEqual(card);
    expect(await steersOf(p1.world, p1.runB!)).toEqual([]);
  }, LONG);

  it('M3-9: automatic; A\'s dispatch of tA is open; the operator settles it: forbidden (only the platform automation); the request stays open in its pointer', async () => {
    const p1 = await worlds.open();
    const a = await p1.hold(p1.lines.A, 'm39-a');
    const open = actionRefOf(await p1.world.platform.actionRequests.requestDispatch(a.ctx,
      write({ taskRef: p1.task.tA, reason: 'P1 M3-9 dispatch' }, 'm39-dispatch')));
    // `settle` now carries the owner's basis (P2 §2.5); the operator's refusal is the permission, not the input.
    const plan = await p1.world.platform.plans.queryGoal(p1.world.humanContext(), p1.goal, { scope: 'project' });
    if (plan.status !== 'ready' || plan.value.goal.activePlanRevision === null) {
      throw new Error('P1: the settle Goal has no adopted Plan revision');
    }
    expect(await p1.world.platform.actionRequests.settle(p1.world.humanContext(),
      write({ request: open, reason: 'P1 M3-9 settle',
        basis: { kind: 'task_cancelled', planRevision: plan.value.goal.activePlanRevision } }, 'm39-settle')))
      .toMatchObject(refusedFor('only the platform automation may settle'));
    expect(await requestOf(p1, open)).toMatchObject({ state: 'open' });
    expect(pointerRef((await holdOf(p1, p1.task.tA))?.openDispatch)).toEqual(open);
  }, LONG);

  it('M3-10: automatic; A\'s stop of tB is released and not sent; the operator delivers it: forbidden (only the platform automation); nothing is sent', async () => {
    const p1 = await openRunning();
    const a = await p1.hold(p1.lines.A, 'm310-a');
    const released = await releasedStop(p1, a, 'm310');
    expect(await p1.world.platform.actionRequests.deliverStop(p1.world.humanContext(), { request: released.actionRef }))
      .toMatchObject(refusedFor('only the platform automation may deliver a stop'));
    expect(await requestOf(p1, released.actionRef)).toMatchObject({ state: 'released', outcome: { notSent: null } });
    expect(await steersOf(p1.world, p1.runB!)).toEqual([]);
  }, LONG);
});

const badSources: Array<[string, (ref: ActionRequestRef) => unknown]> = [
  ['an unknown kind', ref => ({ kind: 'action', actionRef: ref })],
  ['a field more', ref => ({ kind: 'action_request', actionRef: ref, note: 'P1 M7-1' })],
  ['an incomplete actionRef', ref => ({ kind: 'action_request', actionRef: { aggregateType: ref.aggregateType,
    requestId: ref.requestId } })],
];

describe('rejects: K1, M7-1, an action steer on a paused Run or with a malformed source', () => {
  it.each(badSources)('M7-1: controls/submit of a steer whose source has %s: invalid (the control source); no intent', async (_what, sourceOf) => {
    const p1 = await openRunning();
    const a = await p1.hold(p1.lines.A, 'm71-a');
    const released = await releasedStop(p1, a, 'm71');
    const revision = (await runRecordOf(p1.world, p1.runB!)).revision;
    const refused = (await p1.world.post('controls/submit', graphWrite(S6A_SCOPE, { runRef: p1.runB, kind: 'steer',
      reason: 'P1 M7-1 steer', source: sourceOf(released.actionRef) }, 'm71-steer', [{ ref: p1.runB, revision }]))).body;
    expect(refused).toMatchObject({ status: 'rejected', code: 'invalid',
      reason: 'the control source must be {kind: "action_request", actionRef: a complete ActionRequestRef}' });
    expect(await steersOf(p1.world, p1.runB!)).toEqual([]);
  }, LONG);

  it('the operator paused tB\'s Run; controls/submit of a steer sourced from S2\'s request is busy (paused); no intent', async () => {
    const p1 = await openRunning();
    const a = await p1.hold(p1.lines.A, 'k1-a');
    const released = await releasedStop(p1, a, 'k1');
    await pause(p1, p1.runB!, 'k1');
    const revision = (await runRecordOf(p1.world, p1.runB!)).revision;
    const refused = (await p1.world.post('controls/submit', graphWrite(S6A_SCOPE, { runRef: p1.runB, kind: 'steer',
      reason: 'P1 K1 steer', source: { kind: 'action_request', actionRef: released.actionRef } }, 'k1-steer',
    [{ ref: p1.runB, revision }]))).body as { status: string; code?: string; reason?: string };
    expect(refused).toMatchObject({ status: 'rejected', code: 'busy' });
    expect(refused.reason).toContain('paused');
    expect(await steersOf(p1.world, p1.runB!)).toEqual([]);
  }, LONG);
});
