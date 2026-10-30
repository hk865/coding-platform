/** R-reply-round: one reply, two replies, a handoff and an expiry each make one round on the request root. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  SessionMessage,
} from '../../src/core/work-graph/model/communication-contracts.js';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { waitExpiryDeliveryText, waitReplyDeliveryText } from '../helpers/S7B-delivery-samples.js';
import {
  handoffS7B2Round, openS7B2RoundWorld, replyOrExpireS7B2Round, requestUserText, runS7B2Round,
  s7b2WaitRounds, scriptS7B2RoundAnswer, startS7B2RoundDriver, twoRepliesS7B2Round,
} from '../helpers/S7B2-secretary-rounds.js';
import { driveS6BHandoff } from '../helpers/S6B2-fixture.js';
import { readS7BMessage } from '../helpers/S7B-fixture.js';

const shared = vi.hoisted(() => ({ backend: undefined as unknown, bodies: undefined as unknown }));
vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/in-memory-record-store.js')>();
  const barrier = await import('../helpers/S6A-commit-barrier.js');
  const wrapped = await barrier.inMemoryBarrierModule(async () => actual);
  return { ...actual, createInMemoryRecordBackend: (options: Parameters<typeof actual.createInMemoryRecordBackend>[0]) => {
    shared.backend ??= { ...wrapped.createInMemoryRecordBackend(options), close: async () => undefined };
    return shared.backend;
  } };
});
vi.mock('../../src/core/record-store/body-store.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/body-store.js')>();
  return { ...actual, RawArtifactBodyStore: class SharedRawArtifactBodyStore {
    constructor() { shared.bodies ??= new actual.RawArtifactBodyStore(); return shared.bodies as never; }
  } as never };
});

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  commitBarrier.reset();
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
  shared.backend = undefined;
  shared.bodies = undefined;
});

function serving(requests: readonly ModelRequest[], expected: string): ModelRequest[] {
  return requests.filter(request => requestUserText(request).includes(expected));
}

const question = (label: string, index = 0): string => `S7B2 ${label} message ${index}`;

describe('S7B-2 R reply round', () => {
  it.each(['single reply', 'two replies', 'handoff before reply', 'expiry'] as const)(
    'one source makes one reply/expiry round on the request root: %s', async variant => {
      const { world } = await openS7B2RoundWorld({ backend: 'memory',
        extraHostOptions: { requestDriver: 'off' } });
      worlds.push(world);
      const label = `r-${variant.replaceAll(' ', '-')}`;
      let replies: readonly [SessionMessage, SessionMessage] | undefined;
      const held = variant === 'two replies'
        ? await runS7B2Round(world, { label,
          use: async sent => { replies = (await twoRepliesS7B2Round(world, { sent, label })).replies; } })
        : await runS7B2Round(world, { label });
      await scriptS7B2RoundAnswer(world, { round: held.round, label });
      await startS7B2RoundDriver(world, 'memory');
      const root = held.round.request.requestRoot;
      const secretary = held.round.secretary.ref;

      if (variant === 'single reply') {
        const reply = await replyOrExpireS7B2Round(world, { kind: 'reply', goal: held.goal,
          recipient: held.recipients[0], message: held.messages[0].ref, task: held.tasks[0], label });
        const view = await world.waitForRequest(root, current => s7b2WaitRounds(current, 'reply').length === 1,
          'the reply round');
        const rounds = s7b2WaitRounds(view, 'reply');
        expect(rounds).toHaveLength(1);
        expect(rounds[0]).toMatchObject({ kind: 'reply', assignedSession: secretary });
        const roundJob = await readQuery(world.ag2b, rounds[0]!.ref);
        expect(roundJob.job.job.relatedMessageRef).toEqual(reply.message.ref);
        expect(roundJob.job.job.intent.correlationId)
          .toBe(`wait-round:{"aggregateType":"SessionMessage","messageId":${JSON.stringify(reply.message.ref.messageId)},"projectId":"ag2b-collab-project","workspaceId":"ag2b-collab-workspace"}:reply`);
        const expected = waitReplyDeliveryText({ messageId: reply.message.ref.messageId,
          question: question(label), body: `S7B ${label} reply` });
        await expect.poll(async () => serving(await world.scripted.requests(held.round.secretary), expected).length,
          { timeout: 20_000, interval: 20 }).toBe(1);
      }

      if (variant === 'two replies') {
        if (replies === undefined) throw new Error('S7B2: the two replies are not in the held round');
        const view = await world.waitForRequest(root, current => s7b2WaitRounds(current, 'reply').length === 2,
          'the two reply rounds');
        const rounds = s7b2WaitRounds(view, 'reply');
        expect(rounds).toHaveLength(2);
        const roundJobs = await Promise.all(rounds.map(round => readQuery(world.ag2b, round.ref)));
        expect(roundJobs.map(read => read.job.job.relatedMessageRef?.messageId).sort())
          .toEqual(replies.map(reply => reply.ref.messageId).sort());
        for (const roundJob of roundJobs) {
          const related = roundJob.job.job.relatedMessageRef;
          expect(related).not.toBeNull();
          expect(roundJob.job.job.intent.correlationId)
            .toBe(`wait-round:{"aggregateType":"SessionMessage","messageId":${JSON.stringify(related!.messageId)},"projectId":"ag2b-collab-project","workspaceId":"ag2b-collab-workspace"}:reply`);
        }
        const executing = rounds.filter(round => round.absorbedInto === null);
        const absorbed = rounds.filter(round => round.absorbedInto !== null);
        expect(executing).toHaveLength(1);
        expect(absorbed).toHaveLength(1);
        expect(absorbed[0]!.absorbedInto).toEqual(executing[0]!.ref);
        expect(rounds.every(round => round.assignedSession?.sessionId === secretary.sessionId)).toBe(true);
      }

      if (variant === 'handoff before reply') {
        const handoff = await handoffS7B2Round(world, { source: held.round.secretary.ref, label });
        const reply = await replyOrExpireS7B2Round(world, { kind: 'reply', goal: held.goal,
          recipient: held.recipients[0], message: held.messages[0].ref, task: held.tasks[0], label });
        const view = await world.waitForRequest(root, current => s7b2WaitRounds(current, 'reply').length === 1,
          'the successor reply round');
        const rounds = s7b2WaitRounds(view, 'reply');
        const roundJob = await readQuery(world.ag2b, rounds[0]!.ref);
        expect(roundJob.job.job.relatedMessageRef).toEqual(reply.message.ref);
        expect(roundJob.job.job.intent.correlationId)
          .toBe(`wait-round:{"aggregateType":"SessionMessage","messageId":${JSON.stringify(reply.message.ref.messageId)},"projectId":"ag2b-collab-project","workspaceId":"ag2b-collab-workspace"}:reply`);
        expect(rounds[0]!.assignedSession).toEqual(handoff.successor);
        await world.waitForRequest(root, current => s7b2WaitRounds(current, 'reply')[0]?.status === 'ended',
          'the successor reply round ends');
        const entries = (await readS7BMessage(world, reply.message.ref)).acceptedInputs ?? [];
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ part: 'response', evidence: 'query_entered', consumesWait: true });
      }

      if (variant === 'expiry') {
        world.clock.advance(60_001);
        const expired = await replyOrExpireS7B2Round(world, { kind: 'expiry', messageRef: held.messages[0].ref });
        expect(expired.message.expiredAt).not.toBeNull();
        const deadline = expired.message.deadline;
        expect(deadline).not.toBeNull();
        const view = await world.waitForRequest(root, current => s7b2WaitRounds(current, 'expiry').length === 1,
          'the expiry round');
        const rounds = s7b2WaitRounds(view, 'expiry');
        expect(rounds[0]).toMatchObject({ kind: 'expiry', assignedSession: secretary });
        const expiryJob = await readQuery(world.ag2b, rounds[0]!.ref);
        expect(expiryJob.job.job.relatedMessageRef).toEqual(expired.message.ref);
        expect(expiryJob.job.job.intent.correlationId)
          .toBe(`wait-round:{"aggregateType":"SessionMessage","messageId":${JSON.stringify(expired.message.ref.messageId)},"projectId":"ag2b-collab-project","workspaceId":"ag2b-collab-workspace"}:expiry`);
        const expected = waitExpiryDeliveryText({ messageId: expired.message.ref.messageId,
          question: question(label), deadline: deadline!, expiryCount: 1 });
        await expect.poll(async () => serving(await world.scripted.requests(held.round.secretary), expected).length,
          { timeout: 20_000, interval: 20 }).toBe(1);
      }
    }, 180_000);
});
