/**
 * A request whose message is awaiting release, or approved and still paused, is still processing for `release`.
 * Approval and the actual release are two steps. The states come from the real secretary send, the person's
 * approval/denial and withdrawal, all read through `requests/read`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import {
  answerS7A2Card, readS7A2Card, sendS7A2RequestWithDispatch, withdrawS7A2Message,
} from '../helpers/S7A2-fixture.js';
import {
  openS7AWorkWorldWithActions, pauseS7AGoal, ready, setS7AAutonomy,
} from '../helpers/S7A-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

describe('the release reason', () => {
  it('awaiting and approved both stay processing until the message is rejected or withdrawn', async () => {
    const opened = await openS7AWorkWorldWithActions({ backend: 'memory' });
    worlds.push(opened.world);
    const world = opened.world;
    await setS7AAutonomy(world, opened.goal, 'every_step');

    const sent = await sendS7A2RequestWithDispatch(world, {
      label: 's7c-gp1b-send', goal: opened.goal, recipient: opened.line.ref,
    });
    const root = sent.requestRoot;
    if (root === null) throw new Error('the secretary action request has no request root');
    await pauseS7AGoal(world, opened.goal);
    const awaiting = ready<RequestCoreViewV1>(
      await world.post('requests/read', plain(S6A_SCOPE, { requestRoot: root })), 'the awaiting request read');
    expect(awaiting.processing).toBe(true);
    // P2 §6 (S7C-GP-1-release:44): the request's pending work is the agent's dispatch action request, not a message
    // release queue. The frozen reason enum has no `dispatch`; the projection names the pending reply work `reply`.
    expect(awaiting.reasons).toEqual(['reply']);

    const afterApproval = ready<RequestCoreViewV1>(
      await world.post('requests/read', plain(S6A_SCOPE, { requestRoot: root })), 'the approved request read');
    expect(afterApproval.processing).toBe(true);
    expect(afterApproval.reasons).toEqual(['reply']);

    // The person denies the FIRST request's `action_release` card through `decisions/answer`; the message queue is
    // gone. Denying it also frees the one unfinished work Task, so the withdrawal below can dispatch it again.
    const card = await readS7A2Card(world, opened.goal);
    await answerS7A2Card(world, { source: card.source, optionId: 'deny', label: 's7c-gp1b-deny' });
    const afterDenial = ready<RequestCoreViewV1>(
      await world.post('requests/read', plain(S6A_SCOPE, { requestRoot: root })),
      'the denied request read');
    // Denying the dispatch action request frees the card, but the secretary's request message still needs its reply
    // (P2 §2.5 AR-05 closes the action request only): the request stays processing for `reply` until the message is
    // withdrawn below.
    expect(afterDenial.processing).toBe(true);
    expect(afterDenial.reasons).toEqual(['reply']);

    const withdrawnSent = await sendS7A2RequestWithDispatch(world, {
      label: 's7c-gp1b-withdraw', goal: opened.goal, recipient: opened.line.ref,
    });
    if (withdrawnSent.requestRoot === null) throw new Error('the withdrawn action request has no request root');
    await withdrawS7A2Message(world, withdrawnSent, 's7c-gp1b-withdraw');
    const afterWithdrawal = ready<RequestCoreViewV1>(
      await world.post('requests/read', plain(S6A_SCOPE, { requestRoot: withdrawnSent.requestRoot })),
      'the withdrawn request read');
    expect(afterWithdrawal.processing).toBe(false);
    expect(afterWithdrawal.reasons).toEqual([]);
  });
});
