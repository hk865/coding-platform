/** R-restart: one SQLite Host crash and reopen keeps one reply round and one model entry. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { waitReplyDeliveryText } from '../helpers/S7B-delivery-samples.js';
import { requestUserText } from '../helpers/S7B2-secretary-rounds.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import {
  openS7B2RoundWorld, replyOrExpireS7B2Round, runS7B2Round,
  s7b2WaitRounds, scriptS7B2RoundAnswer, startS7B2RoundDriver,
} from '../helpers/S7B2-secretary-rounds.js';

vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  commitBarrier.reset();
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

describe('S7B-2 R restart (SQLite)', () => {
  it('keeps one reply round and one model entry across a real Host crash and reopen', async () => {
    const { world } = await openS7B2RoundWorld({ backend: 'sqlite',
      extraHostOptions: { requestDriver: 'off' } });
    worlds.push(world);
    const label = 'r-restart';
    const held = await runS7B2Round(world, { label });
    await scriptS7B2RoundAnswer(world, { round: held.round, label });
    await startS7B2RoundDriver(world, 'sqlite');
    const append = commitBarrier.holdAfter(byIdentityPrefix('request.reply:'), 'the reply round append');
    const reply = await replyOrExpireS7B2Round(world, { kind: 'reply', goal: held.goal,
      recipient: held.recipients[0], message: held.messages[0].ref, task: held.tasks[0], label });
    await append.reached;
    await world.crash();

    const root = held.round.request.requestRoot;
    const view = await world.waitForRequest(root, current => s7b2WaitRounds(current, 'reply').length > 0,
      'the reply round after the reopen');
    const rounds = s7b2WaitRounds(view, 'reply');
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({ kind: 'reply', assignedSession: held.round.secretary.ref });
    const roundJob = await readQuery(world.ag2b, rounds[0]!.ref);
    expect(roundJob.job.job.relatedMessageRef).toEqual(reply.message.ref);
    expect(roundJob.job.job.intent.correlationId)
      .toBe(`wait-round:{"aggregateType":"SessionMessage","messageId":${JSON.stringify(reply.message.ref.messageId)},"projectId":"ag2b-collab-project","workspaceId":"ag2b-collab-workspace"}:reply`);

    const expected = waitReplyDeliveryText({ messageId: reply.message.ref.messageId,
      question: `S7B2 ${label} message 0`, body: `S7B ${label} reply` });
    const serving = async (): Promise<ModelRequest[]> =>
      (await world.scripted.requests(held.round.secretary)).filter(request => requestUserText(request).includes(expected));
    await expect.poll(async () => (await serving()).length, { timeout: 20_000, interval: 20 }).toBeGreaterThan(0);
    expect(await serving()).toHaveLength(1);
  }, 180_000);
});
