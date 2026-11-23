/**
 * P2 T17 (frozen row :332): two hold sources and one dispatch request on one
 * Task; the person's release-all goes through the frozen public entry
 * `tasks/hold/release`; a pending stop card keeps the slot after the causes are
 * released. The owner stand-ins (`claimHolds.place`/`release`, `actionRequests`)
 * build the state; the row's own entries are the route and the cardKey receipt.
 * 红-setup：G3 的 `buildStageTwo`/`readRunningCommands` 装配（`src/app/core-routes.ts:1301`）。
 */
import { describe, expect, it } from 'vitest';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { hostClaim, placeScribeStop } from '../helpers/P1-platform-entry.js';
import {
  actionRefOf, dispatchSequence, holdOf, performClaim, p1Worlds, pointerRef, reasonNamed, requestOf, reworkPins,
  write,
} from '../helpers/P1-reads.js';
import type { P1World } from '../helpers/P1-round-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';

/** The Task's one waiting action card of the stop request. */
async function stopCardOf(p1: P1World, taskId: string) {
  return (await s6aCardsWorkspace(p1.world, S6A_SCOPE).readCards(p1.goal))
    .find(card => String(card.source.kind) === 'action_release' && card.state === 'waiting_answer'
      && card.taskRef?.taskId === taskId);
}

type Receipt = { status: string; value?: { ref: { requestId: string } } };

describe('P2 T17: release-all is the person route and a pending stop keeps the slot', () => {
  it('carries cardKey on the dispatch receipt and never serves the request while the stop card waits', async () => {
    const worlds = p1Worlds();
    const p1 = await worlds.open({ running: true, autonomy: 'every_step' });
    try {
      const [a, s] = await p1.holdRounds([p1.lines.A, p1.lines.S], 'p2-t17');
      for (const [round, label] of [[a, 'adviser'], [s, 'secretary']] as const) {
        expect(await p1.world.platform.claimHolds.place(round.ctx,
          write({ taskRef: p1.task.tA, reason: `P2 T17 ${label} hold` }, `p2-t17-hold-${label}`)))
          .toMatchObject({ status: 'committed' });
      }
      const dispatch = await p1.world.platform.actionRequests.requestDispatch(a.ctx,
        write({ taskRef: p1.task.tA, reason: 'P2 T17 dispatch' }, 'p2-t17-dispatch'));
      // The new receipt field is reached through a JSON boundary, not a cast:
      // P1's typed receipt only carries `actionRef`, P2 adds `cardKey`.
      const dispatchReceipt: unknown = JSON.parse(JSON.stringify(dispatch));
      expect(dispatchReceipt, 'the dispatch receipt is needs_decision with a cardKey')
        .toMatchObject({ status: 'needs_decision', cardKey: expect.any(String) });
      if (!('actionRef' in dispatch)) throw new Error('T17: the dispatch receipt names no request');

      const stop = await p1.world.platform.actionRequests.requestStop(a.ctx,
        write({ taskRef: p1.task.tB, reason: 'P2 T17 stop' }, 'p2-t17-stop'));
      expect(stop).toMatchObject({ status: 'needs_decision' });

      const before = await p1.world.platform.claimHolds.readHold(p1.world.humanContext(),
        { taskRef: p1.task.tA });
      if (before.status !== 'ready') throw new Error('T17: no hold record');
      expect(await p1.world.platform.claimHolds.release(a.ctx,
        write({ taskRef: p1.task.tA, reasonId: reasonNamed(before.value, 'P2 T17 adviser hold').id },
          'p2-t17-release-one'))).toMatchObject({ status: 'committed' });

      // The person's entry: the frozen `tasks/hold/release` route, not the owner.
      const released = (await p1.world.post('tasks/hold/release', graphWrite(S6A_SCOPE,
        { taskRef: p1.task.tA }, 'p2-t17-release-all'))).body as Receipt;
      expect(released.status, 'the person release-all entry exists').toBe('committed');

      const after = await p1.world.platform.claimHolds.readHold(p1.world.humanContext(),
        { taskRef: p1.task.tA });
      if (after.status !== 'ready') throw new Error('T17: the hold record disappeared');
      expect(after.value.reasons.filter(reason => reason.state === 'held')).toHaveLength(0);
    } finally {
      await worlds.closeAll();
    }
  }, 240_000);
});

describe('P2 T17: the person release-all entry', () => {
  it('registers tasks/hold/release (red today: the route is not in the table)', async () => {
    const worlds = p1Worlds();
    const p1 = await worlds.open();
    try {
      const body = (await p1.world.post('tasks/hold/release', graphWrite(S6A_SCOPE,
        { taskRef: p1.task.tA }, 'p2-t17-entry'))).body as { status: string };
      /* S-2: only the status is fixed; this Task has no held reason, so the route answers `unchanged`. */
      expect(body.status, 'the tasks/hold/release entry exists').toBe('unchanged');
    } finally {
      await worlds.closeAll();
    }
  }, 120_000);
});

describe('P2 T17: one release leaves the dispatch request unserved', () => {
  it('an agent releasing one reason still leaves the serving claim busy and the request open', async () => {
    const worlds = p1Worlds();
    const p1 = await worlds.open({ running: true });
    try {
      const [a, s] = await p1.holdRounds([p1.lines.A, p1.lines.S], 'p2-t17c');
      for (const [round, label] of [[a, 'adviser'], [s, 'secretary']] as const) {
        expect(await p1.world.platform.claimHolds.place(round.ctx,
          write({ taskRef: p1.task.tA, reason: `P2 T17c ${label} hold` }, `p2-t17c-hold-${label}`)))
          .toMatchObject({ status: 'committed' });
      }
      const dispatch = await p1.world.platform.actionRequests.requestDispatch(a.ctx,
        write({ taskRef: p1.task.tA, reason: 'P2 T17c dispatch' }, 'p2-t17c-dispatch'));
      expect(dispatch, 'the automatic dispatch request is open').toMatchObject({ status: 'requested' });
      const ref = actionRefOf(dispatch);
      const before = await requestOf(p1, ref);
      expect(before).toMatchObject({ state: 'open' });
      if (before === null) throw new Error('T17c: the request is gone');
      const hold = await holdOf(p1, p1.task.tA);
      expect(await p1.world.platform.claimHolds.release(a.ctx,
        write({ taskRef: p1.task.tA, reasonId: reasonNamed(hold, 'P2 T17c adviser hold').id },
          'p2-t17c-release-one'))).toMatchObject({ status: 'committed' });

      const claimed = await hostClaim(p1.world, await p1.claimStep(p1.lines.E, p1.task.tA, 'p2-t17c-claim'),
        { servedRequest: { ref, revision: before.revision } });
      expect(claimed, 'the remaining hold keeps the request unserved').toMatchObject({
        status: 'rejected', code: 'busy',
      });
      expect(claimed.status === 'rejected' ? claimed.reason : undefined).toContain('P2 T17c secretary hold');
      expect(await dispatchSequence(p1), 'the request is not served').toBe(0);
      expect(await requestOf(p1, ref), 'the request is still open at the same revision').toMatchObject({
        state: 'open', revision: before.revision,
      });
    } finally {
      await worlds.closeAll();
    }
  });
});

describe('P2 T17: release-all leaves the pending stop slot', () => {
  it('releasing every reason on the stop card Task clears the causes but the card hold still blocks the claim', async () => {
    const worlds = p1Worlds();
    const p1 = await worlds.open({ running: true, autonomy: 'every_step' });
    try {
      const [a, s] = await p1.holdRounds([p1.lines.A, p1.lines.S], 'p2-t17d');
      const run = p1.runB;
      if (run === null) throw new Error('T17d: tB is not running');
      expect(await p1.world.platform.claimHolds.place(s.ctx,
        write({ taskRef: p1.task.tB, reason: 'P2 T17d secretary hold' }, 'p2-t17d-hold-s')))
        .toMatchObject({ status: 'committed' });
      expect(await placeScribeStop(p1.world, { taskRef: p1.task.tB, reason: 'P2 T17d scribe stop',
        sourceMessage: a.source, run, operationId: 'p2-t17d-scribe' }, 'p2-t17d-scribe'))
        .toMatchObject({ status: 'committed' });
      const stop = await p1.world.platform.actionRequests.requestStop(a.ctx,
        write({ taskRef: p1.task.tB, reason: 'P2 T17d stop' }, 'p2-t17d-stop'));
      expect(stop).toMatchObject({ status: 'needs_decision' });
      const stopRef = actionRefOf(stop);

      /* The person's entry: every held cause goes, the waiting card slot stays. */
      const released = (await p1.world.post('tasks/hold/release',
        graphWrite(S6A_SCOPE, { taskRef: p1.task.tB }, 'p2-t17d-release-all'))).body as Receipt;
      expect(released.status, 'the person release-all entry commits').toBe('committed');
      const hold = await holdOf(p1, p1.task.tB);
      expect(hold?.reasons.filter(reason => reason.state === 'held'), 'every cause is released').toHaveLength(0);
      expect(pointerRef(hold?.pendingStop), 'the stop card slot is untouched').toEqual(stopRef);

      /* The Run ends and the person reworks tB; the waiting stop card is what keeps the claim away. */
      await p1.endB();
      expect((await p1.world.post('tasks/requeue', graphWrite(S6A_SCOPE, { taskRef: p1.task.tB,
        afterRunRef: run, reason: 'P2 T17d rework' }, 'p2-t17d-requeue', await reworkPins(p1, run)))).body)
        .toMatchObject({ status: 'committed' });
      const claimed = await performClaim(p1.world, await p1.claimStep(p1.lines.E, p1.task.tB, 'p2-t17d-claim'));
      expect(claimed, 'the pending stop card still blocks the claim').toMatchObject({
        status: 'rejected', code: 'busy',
      });
      expect(claimed.reason).toContain('stop request');
    } finally {
      await worlds.closeAll();
    }
  });
});

describe('P2 T17: rejecting or withdrawing the stop card frees the slot without writing stop', () => {
  it.each(['reject', 'withdraw'] as const)('%s: the card hold is released, no stop cause is written, the claim then commits',
    async (how) => {
      const worlds = p1Worlds();
      const p1 = await worlds.open({ running: true, autonomy: 'every_step' });
      try {
        const [a, s] = await p1.holdRounds([p1.lines.A, p1.lines.S], `p2-t17e-${how}`);
        const run = p1.runB;
        if (run === null) throw new Error(`T17e ${how}: tB is not running`);
        expect(await p1.world.platform.claimHolds.place(s.ctx,
          write({ taskRef: p1.task.tB, reason: 'P2 T17e secretary hold' }, `p2-t17e-hold-${how}`)))
          .toMatchObject({ status: 'committed' });
        const stop = await p1.world.platform.actionRequests.requestStop(a.ctx,
          write({ taskRef: p1.task.tB, reason: 'P2 T17e stop' }, `p2-t17e-stop-${how}`));
        expect(stop).toMatchObject({ status: 'needs_decision' });
        const stopRef = actionRefOf(stop);
        /* The other causes are released through the person's route; only the card slot remains. */
        const released = (await p1.world.post('tasks/hold/release',
          graphWrite(S6A_SCOPE, { taskRef: p1.task.tB }, `p2-t17e-release-${how}`))).body as Receipt;
        expect(released.status).toBe('committed');

        if (how === 'reject') {
          const card = await stopCardOf(p1, 'p1-tb');
          expect(card, 'the stop card waits').toBeDefined();
          if (card === undefined) throw new Error('T17e reject: no waiting stop card');
          const answered = await p1.world.post('decisions/answer', graphWrite(S6A_SCOPE, {
            source: card.source, selection: { kind: 'option', optionId: 'deny' }, text: '', annotations: [],
          }, 'p2-t17e-deny', card.source.pins));
          expect(answered.body, 'the deny is answered').toMatchObject({ status: 'ready' });
          expect(await requestOf(p1, stopRef)).toMatchObject({ state: 'denied' });
        } else {
          expect(await p1.world.platform.actionRequests.withdraw(a.ctx,
            write({ request: stopRef }, `p2-t17e-withdraw-${how}`))).toMatchObject({ status: 'committed' });
          expect(await requestOf(p1, stopRef)).toMatchObject({ state: 'withdrawn' });
        }

        const hold = await holdOf(p1, p1.task.tB);
        expect(pointerRef(hold?.pendingStop), 'the card slot is released').toBeNull();
        expect(hold?.reasons.filter(reason => reason.kind === 'stop'), 'no stop cause is written').toEqual([]);

        await p1.endB();
        expect((await p1.world.post('tasks/requeue', graphWrite(S6A_SCOPE, { taskRef: p1.task.tB,
          afterRunRef: run, reason: `P2 T17e rework ${how}` },
          `p2-t17e-requeue-${how}`, await reworkPins(p1, run)))).body).toMatchObject({ status: 'committed' });
        expect(await performClaim(p1.world, await p1.claimStep(p1.lines.E, p1.task.tB, `p2-t17e-claim-${how}`)),
          'the Goal loop claims only after the card hold is gone').toMatchObject({ status: 'committed' });
      } finally {
        await worlds.closeAll();
      }
    });
});
