/**
 * A request with a secretary inquiry that is still open is still processing for `reply`. The request root is
 * read through the published `requests/read`; the message states come from the real secretary round, the real
 * recipient replies, the published expiry owner and the person's withdrawal.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { withdrawS7A2Message } from '../helpers/S7A2-fixture.js';
import {
  openS7B2RoundWorld, replyOrExpireS7B2Round, runS7B2Round, twoRepliesS7B2Round,
} from '../helpers/S7B2-secretary-rounds.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

describe('the reply reason', () => {
  it('a secretary inquiry keeps the request processing until it is answered, expires or is withdrawn', async () => {
    const opened = await openS7B2RoundWorld({ backend: 'memory', extraHostOptions: { requestDriver: 'off' } });
    worlds.push(opened.world);
    const world = opened.world;

    const openRound = await runS7B2Round(world, { label: 's7c-gp1-open' });
    const open = ready<RequestCoreViewV1>(
      await world.post('requests/read', plain(S6A_SCOPE, { requestRoot: openRound.round.request.requestRoot })),
      'the open request read');
    expect(open.processing).toBe(true);
    expect(open.reasons).toEqual(['reply']);

    await twoRepliesS7B2Round(world, { sent: openRound, label: 's7c-gp1-answer' });
    const answered = ready<RequestCoreViewV1>(
      await world.post('requests/read', plain(S6A_SCOPE, { requestRoot: openRound.round.request.requestRoot })),
      'the answered request read');
    expect(answered.processing).toBe(false);
    expect(answered.reasons).toEqual([]);

    const withdrawnRound = await runS7B2Round(world, { label: 's7c-gp1-withdrawn' });
    for (const [index, message] of withdrawnRound.messages.entries()) {
      await withdrawS7A2Message(world, message, `s7c-gp1-withdrawn-${String(index)}`);
    }
    const withdrawn = ready<RequestCoreViewV1>(
      await world.post('requests/read', plain(S6A_SCOPE, { requestRoot: withdrawnRound.round.request.requestRoot })),
      'the withdrawn request read');
    expect(withdrawn.processing).toBe(false);
    expect(withdrawn.reasons).toEqual([]);

    const expiringRound = await runS7B2Round(world, { label: 's7c-gp1-expiring' });
    world.clock.advance(61_000);
    for (const message of expiringRound.messages) {
      await replyOrExpireS7B2Round(world, { kind: 'expiry', messageRef: message.ref });
    }
    const expired = ready<RequestCoreViewV1>(
      await world.post('requests/read', plain(S6A_SCOPE, { requestRoot: expiringRound.round.request.requestRoot })),
      'the expired request read');
    expect(expired.processing).toBe(false);
    expect(expired.reasons).toEqual([]);
  });
});
