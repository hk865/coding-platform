/**
 * A request whose message is awaiting release, or approved and still paused, is still processing for `release`.
 * Approval and the actual release are two steps. The states come from the real secretary send, the person's
 * approval/denial and withdrawal, all read through `requests/read`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import {
  approveS7A2Message, sendS7A2Request, withdrawS7A2Message,
} from '../helpers/S7A2-fixture.js';
import {
  committed, openS7AWorkWorld, pauseS7AGoal, ready, setS7AAutonomy,
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
    const opened = await openS7AWorkWorld({ backend: 'memory' });
    worlds.push(opened.world);
    const world = opened.world;
    await setS7AAutonomy(world, opened.goal, 'every_step');

    const sent = await sendS7A2Request(world, {
      label: 's7c-gp1b-send', goal: opened.goal, recipient: opened.line.ref, intent: 'action_request',
    });
    const root = sent.requestRoot;
    if (root === null) throw new Error('the secretary action request has no request root');
    await pauseS7AGoal(world, opened.goal);
    const awaiting = ready<RequestCoreViewV1>(
      await world.post('requests/read', plain(S6A_SCOPE, { requestRoot: root })), 'the awaiting request read');
    expect(awaiting.processing).toBe(true);
    expect(awaiting.reasons).toEqual(['release']);

    const approved = await approveS7A2Message(world, sent, 's7c-gp1b-approve');
    expect(approved.release).toBe('approved');
    const afterApproval = ready<RequestCoreViewV1>(
      await world.post('requests/read', plain(S6A_SCOPE, { requestRoot: root })), 'the approved request read');
    expect(afterApproval.processing).toBe(true);
    expect(afterApproval.reasons).toEqual(['release']);

    const denied = await sendS7A2Request(world, {
      label: 's7c-gp1b-deny', goal: opened.goal, recipient: opened.line.ref, intent: 'action_request',
    });
    if (denied.requestRoot === null) throw new Error('the denied action request has no request root');
    committed(await world.post('messages/release',
      graphWrite(S6A_SCOPE, { messageRef: denied.ref, allow: false }, 's7c-gp1b-deny')), 'the denial');
    const afterDenial = ready<RequestCoreViewV1>(
      await world.post('requests/read', plain(S6A_SCOPE, { requestRoot: denied.requestRoot })),
      'the denied request read');
    expect(afterDenial.processing).toBe(false);
    expect(afterDenial.reasons).toEqual([]);

    const withdrawnSent = await sendS7A2Request(world, {
      label: 's7c-gp1b-withdraw', goal: opened.goal, recipient: opened.line.ref, intent: 'action_request',
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
