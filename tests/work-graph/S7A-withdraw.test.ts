/** X-withdraw (§3.3, §5.5): the open-execution read, the live-offer refusals, the CAS/horizon
 * interleaves and the original receipt; a Host restart reconciles an accepted input before a withdraw. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { deriveSessionInputId } from '../../src/core/work-graph/model/communication-contracts.js';
import type { ClaimFixtureKind } from '../helpers/task-claim-fixture.js';
import { createC1Harness, type C1Harness } from '../helpers/C1-mailbox-fixture.js';
import { createRecipientExecutions } from '../../src/core/work-graph/sessions/recipient-executions.js';
import { createSessionFactsService } from '../../src/core/work-graph/tasks/session-facts.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { committed, crashS7AHost, holdS7ACommitter, openS7AWorkWorld, ready, runS7ASameSessionAgain } from '../helpers/S7A-fixture.js';
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const harnesses: C1Harness[] = [];
const worlds: S6AHostWorld[] = [];
const runs: Promise<unknown>[] = [];
async function openC1World(): Promise<C1Harness> {
  const h = await createC1Harness('memory');
  harnesses.push(h);
  return h;
}
afterEach(async () => {
  commitBarrier.reset();
  for (const h of harnesses.splice(0)) await h.close();
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
  await Promise.allSettled(runs.splice(0));
});

function withdraw(h: C1Harness, ctx: CoreCallContext, ref: SessionMessageRef, requestId: string,
  mailbox = h.mailbox) {
  return mailbox.withdrawMessage(ctx, { input: { messageRef: ref }, meta: { requestId, expected: [] } });
}
async function sent(h: C1Harness, ctx: CoreCallContext, to = h.idleSession, requestId = 'xw-send') {
  const result = await h.mailbox.sendMessage(ctx, {
    input: { recipient: to, text: 'withdraw me', needsReply: true }, meta: { requestId, expected: [] },
  });
  if (result.status !== 'committed') throw new Error(`the send did not commit: ${JSON.stringify(result)}`);
  return result.value;
}
async function read(h: C1Harness, ref: SessionMessageRef) {
  const result = await h.mailbox.readMessage(h.ctxHost, ref);
  if (result.status !== 'ready') throw new Error(`the message is not readable: ${JSON.stringify(result)}`);
  return result.value;
}
function withdrawPin(ref: SessionMessageRef, revision: number) {
  return { ref, revision };
}
type RecipientFault = 'missing-execution' | 'work-page' | 'query-page';
/** The same real Session-facts and execution readers the world uses, with one named fault. */
function faultReader(h: C1Harness, fault: RecipientFault) {
  const sessions = createSessionFactsService({ records: h.backend.records });
  const executions = createRunStateReader({ records: h.backend.records, bodies: h.rawBodies() });
  return createRecipientExecutions({
    sessions: fault === 'work-page'
      ? { ...sessions, async listSessionExecutions() { throw new Error('the Work page read failed'); } }
      : fault === 'query-page'
        ? { ...sessions, async listSessionQueries() { throw new Error('the Query page read failed'); } }
        : sessions,
    executions: fault === 'missing-execution'
      ? { ...executions, async readExecution(...args: Parameters<typeof executions.readExecution>) {
        const [ctx, ref, options] = args;
        return executions.readExecution(ctx, { ...ref, runId: `${ref.runId}-absent` }, options);
      } }
      : executions,
    records: h.backend.records,
  });
}

describe('X-withdraw: who and the open offer', () => {
  it('a person withdraws a pending message and the same command id replays first', async () => {
    const h = await openC1World();
    const message = await sent(h, h.ctxHost);
    const first = await withdraw(h, h.ctxHost, message.ref, 'xw-person');
    expect(first).toMatchObject({ status: 'committed', replayed: false });
    if (first.status !== 'committed') return;
    expect(first.value).toMatchObject({ revision: 2, status: 'pending', withdrawnAt: '2026-09-26T00:00:00.000Z',
      readAt: null, response: null });
    expect(await read(h, message.ref)).toEqual(first.value);

    await sent(h, h.ctxHost, h.idleSession, 'xw-person-other');
    const replayed = await withdraw(h, h.ctxHost, message.ref, 'xw-person');
    expect(replayed).toMatchObject({ status: 'committed', replayed: true, cursor: first.cursor });
    if (replayed.status !== 'committed') return;
    expect(replayed.value).toEqual(first.value);

    // Another command id on the now-withdrawn message is invalid.
    expect(await withdraw(h, h.ctxHost, message.ref, 'xw-person-second'))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
  });

  it('a Work Run withdraws its own message through the current admission', async () => {
    const h = await openC1World();
    const message = await sent(h, h.ctxWork);
    const withdrawn = await withdraw(h, h.ctxWork, message.ref, 'xw-work-own');
    expect(withdrawn).toMatchObject({ status: 'committed', value: { withdrawnAt: '2026-09-26T00:00:00.000Z' } });
  });

  it('refuses a live offer at the recipient line and writes nothing', async () => {
    const h = await openC1World();
    const message = await sent(h, h.ctxHost, h.busySession, 'xw-offer-send');
    expect(await withdraw(h, h.ctxHost, message.ref, 'xw-offer'))
      .toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(await read(h, message.ref)).toMatchObject({ revision: 1, status: 'pending', withdrawnAt: null });
  });

  it.each([
    { fault: 'missing-execution' as const },
    { fault: 'work-page' as const, reason: 'the Work page read failed' },
    { fault: 'query-page' as const, reason: 'the Query page read failed' },
  ])('an injected $fault in the real readers is unavailable and writes nothing', async ({ fault, reason }) => {
    const h = await openC1World();
    const message = await sent(h, h.ctxHost, h.busySession, `xw-fault-send-${fault}`);
    const faulted = h.makeMailbox(h.backend.records, h.materials, undefined, faultReader(h, fault));
    expect(await withdraw(h, h.ctxHost, message.ref, `xw-fault-${fault}`, faulted))
      .toMatchObject({ status: 'rejected', code: 'unavailable',
        ...(reason === undefined ? {} : { reason: expect.stringContaining(reason) }) });
    expect(await read(h, message.ref)).toMatchObject({ revision: 1, status: 'pending', withdrawnAt: null });
  });

  it('is unsupported when the recipient-execution read is not injected', async () => {
    const h = await openC1World();
    const message = await sent(h, h.ctxHost);
    const withoutReader = h.makeMailbox(h.backend.records, h.materials, undefined, null);
    expect(await withdraw(h, h.ctxHost, message.ref, 'xw-no-reader', withoutReader))
      .toMatchObject({ status: 'rejected', code: 'unsupported' });
  });

  it('refuses a read message and a responded message', async () => {
    const h = await openC1World();
    const readMessage = await sent(h, h.ctxHost, h.busySession, 'xw-read-send');
    const acked = await h.mailbox.ackMessage(h.ctxWork, {
      input: { messageRef: readMessage.ref }, meta: { requestId: 'xw-ack', expected: [withdrawPin(readMessage.ref, 1)] },
    });
    expect(acked).toMatchObject({ status: 'committed', value: { status: 'read' } });
    expect(await withdraw(h, h.ctxHost, readMessage.ref, 'xw-read'))
      .toMatchObject({ status: 'rejected', code: 'invalid' });

    const replied = await sent(h, h.ctxHost, h.busySession, 'xw-respond-send');
    expect(await h.mailbox.respondMessage(h.ctxWork, {
      input: { messageRef: replied.ref, text: 'done' },
      meta: { requestId: 'xw-respond', expected: [withdrawPin(replied.ref, 1)] },
    })).toMatchObject({ status: 'committed', value: { status: 'responded' } });
    expect(await withdraw(h, h.ctxHost, replied.ref, 'xw-respond'))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
  });
});

describe.each(['memory', 'sqlite'] as const)('X-withdraw: the commit interleaves (%s)', kind => {
  async function openKind(): Promise<C1Harness> {
    const h = await createC1Harness(kind as ClaimFixtureKind);
    harnesses.push(h);
    return h;
  }

  it('the original receipt replays before any current admission', async () => {
    const h = await openKind();
    const message = await sent(h, h.ctxHost);
    const first = await withdraw(h, h.ctxHost, message.ref, 'xw-replay');
    expect(first).toMatchObject({ status: 'committed', replayed: false });
    if (first.status !== 'committed') return;
    // A real commit moves the ledger after the first receipt was written.
    await sent(h, h.ctxHost, h.idleSession, 'xw-replay-other');
    expect(await withdraw(h, h.ctxHost, message.ref, 'xw-replay'))
      .toMatchObject({ status: 'committed', replayed: true, cursor: first.cursor, value: first.value });

    // A concurrent SAME-identity commit lands after this call's receipt miss; its
    // later state refusal must restore that receipt, not answer invalid.
    const raced = await sent(h, h.ctxHost, h.idleSession, 'xw-race-send');
    let swapped = false;
    const records = { ...h.backend.records, async readMany(keys: string[]) {
      if (!swapped) {
        swapped = true;
        await withdraw(h, h.ctxHost, raced.ref, 'xw-race', h.makeMailbox());
      }
      return h.backend.records.readMany(keys);
    } };
    expect(await withdraw(h, h.ctxHost, raced.ref, 'xw-race', h.makeMailbox(records)))
      .toMatchObject({ status: 'committed', replayed: true });
  });

  it('a message revision that moves after the read is a revision_conflict', async () => {
    const h = await openKind();
    const message = await sent(h, h.ctxHost);
    const other = h.makeMailbox();
    const racing = h.makeMailbox(h.backend.records, h.materials, undefined, {
      async readRecipientOpenExecutions(ctx, input) {
        // A real second withdraw commits, then the real reader is called again: the new horizon
        // meets the old message, so only the message CAS can refuse it.
        await withdraw(h, h.ctxHost, message.ref, 'xw-revision-inner', other);
        return h.recipientExecutions.readRecipientOpenExecutions(ctx, input);
      },
    });
    expect(await withdraw(h, h.ctxHost, message.ref, 'xw-revision', racing))
      .toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(await read(h, message.ref)).toMatchObject({ revision: 2, withdrawnAt: '2026-09-26T00:00:00.000Z' });
  });

  it('a ledger horizon that moves after the read is a revision_conflict', async () => {
    const h = await openKind();
    const message = await sent(h, h.ctxHost);
    const racing = h.makeMailbox(h.backend.records, h.materials, undefined, {
      async readRecipientOpenExecutions(ctx, input) {
        const read = await h.recipientExecutions.readRecipientOpenExecutions(ctx, input);
        // A real commit after the horizon makes the window stale; the message stays at revision 1,
        // so only the horizon guard can refuse it.
        await sent(h, h.ctxHost, h.idleSession, 'xw-horizon-other');
        return read;
      },
    });
    expect(await withdraw(h, h.ctxHost, message.ref, 'xw-horizon', racing))
      .toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(await read(h, message.ref)).toMatchObject({ revision: 1, status: 'pending', withdrawnAt: null });
  });
});

describe('X-withdraw: the Host restart (SQLite only)', () => {
  it('reconciles the accepted input before a withdraw can succeed', async () => {
    const { world, goal, line } = await openS7AWorkWorld({ backend: 'sqlite' });
    worlds.push(world);
    // `action_request`, because the input supply never offers `inquiry` bodies.
    const sent = committed<SessionMessage>(await world.post('messages/send',
      graphWrite(S6A_SCOPE, { recipient: line.ref, text: 'S7A restart withdraw', intent: 'action_request', needsReply: true },
        's7a-restart-send')), 'the person send');
    const hold = holdS7ACommitter(world, commit => commit.identityKey.startsWith('input-accepted:')
      && commit.events.some(event => event.eventType === 'SessionMessageInputAccepted'));
    // The start stays suspended at the held mirror commit; teardown releases it.
    runs.push(runS7ASameSessionAgain(world, line).catch(() => undefined));
    await crashS7AHost(world, hold);

    const accepted = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, sent.ref)),
      'the restarted message');
    expect(accepted.acceptedInputs).toHaveLength(1);
    expect(accepted.acceptedInputs?.[0]).toMatchObject({
      inputId: deriveSessionInputId(sent.ref, 'message'), part: 'message',
      executionRef: { aggregateType: 'Run', projectId: S6A_SCOPE.projectId, goalId: goal.goalId },
    });
    expect((await world.post('messages/withdraw',
      graphWrite(S6A_SCOPE, { messageRef: sent.ref }, 's7a-restart-withdraw'))).body)
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(commitBarrier.unreleased()).toContain('S7A input accepted');
  });
});
