/**
 * X-send-versions (§2.1, §3.3, §5.3): the send's own release, its pins, the inquiry's frozen
 * duration, `sendStatus`, `expected`'s one legal send, the Goal/`taskRef`/`followupOf`
 * attribution, and the conflict's `dispatchCurrent`. Real mailbox over one real store, both
 * backends; every state comes from the public owner methods.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createSessionActivityReader } from '../../src/core/work-graph/sessions/session-activity.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { ClaimFixtureKind } from '../helpers/task-claim-fixture.js';
import type { SessionMailboxDependencies } from '../../src/core/work-graph/model/communication-contracts.js';
import { createDispatchBasisReader } from '../../src/core/work-graph/tasks/dispatch-basis.js';
import { createGoalPointerFacts } from '../../src/core/work-graph/views/pointer-facts.js';
import { createC1Harness, type C1Harness } from '../helpers/C1-mailbox-fixture.js';

const KINDS = ['memory', 'sqlite'] as const;
const harnesses: C1Harness[] = [];
async function openC1World(kind: ClaimFixtureKind): Promise<C1Harness> {
  const harness = await createC1Harness(kind);
  harnesses.push(harness);
  return harness;
}
afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close();
});

type SendInput = Parameters<C1Harness['mailbox']['sendMessage']>[1]['input'];
function send(h: C1Harness, input: SendInput, requestId: string, ctx = h.ctxWork) {
  return h.mailbox.sendMessage(ctx, { input, meta: { requestId, expected: [] } });
}
/** The Session's stored activity revision, read through the production read port. */
async function activityRevision(h: C1Harness, session: SessionRef): Promise<number> {
  const read = await createSessionActivityReader({ records: h.backend.records })
    .readSessionActivity(h.ctxHost, { session });
  expect(read).toMatchObject({ status: 'ready' });
  return read.status === 'ready' ? read.value.revision : -1;
}

describe.each(KINDS)('X-send-versions: the send release and its claims (%s)', kind => {
  it('a person\'s send keeps release null, no pins and no Session advance', async () => {
    const h = await openC1World(kind);
    const before = await activityRevision(h, h.busySession);
    const sent = await send(h, { recipient: h.busySession, text: 'please review the plan', intent: 'inquiry' }, 'x-sv-person-1', h.ctxHost);
    expect(sent).toMatchObject({ status: 'committed', sendStatus: 'sent', replayed: false });
    if (sent.status !== 'committed') return;
    // An inquiry freezes its injected duration; a release-null send stores no instant.
    expect(sent.value).toMatchObject({ release: null, pins: null, deadline: null, deadlineMs: 86_400_000, revision: 1 });
    expect(await activityRevision(h, h.busySession)).toBe(before);
  });

  it('an agent\'s notify is released but never advances the recipient Session', async () => {
    const h = await openC1World(kind);
    const before = await activityRevision(h, h.busySession);
    const sent = await send(h, { recipient: h.busySession, text: 'for information', intent: 'notify' }, 'x-sv-notify-1');
    expect(sent).toMatchObject({ status: 'committed', sendStatus: 'sent' });
    if (sent.status !== 'committed') return;
    expect(sent.value).toMatchObject({ release: 'released', pins: null, deadline: null, deadlineMs: null });
    expect(await activityRevision(h, h.busySession)).toBe(before);
  });

  it('expected is ignored on a send that is not a goal-bearing action_request', async () => {
    const h = await openC1World(kind);
    const sent = await send(h, {
      recipient: h.busySession, text: 'with a basis', intent: 'notify',
      expected: { planRevision: 9, pointerRevision: 9, dispatchSequence: 9 },
    }, 'x-sv-expected-1');
    expect(sent).toMatchObject({ status: 'committed' });
    if (sent.status !== 'committed') return;
    expect(sent.value.pins).toBeNull();
  });

  it('an agent action_request without expected is invalid and with no basis read unsupported', async () => {
    const h = await openC1World(kind);
    const withoutBasis = await send(h, {
      recipient: h.busySession, text: 'please approve', intent: 'action_request',
    }, 'x-sv-action-1');
    expect(withoutBasis).toMatchObject({ status: 'rejected', code: 'invalid' });

    // The C1 dependency bag binds no `dispatchBasis`, which is `unsupported` by
    // rule and never a silent "no plan".
    const noRead = await send(h, {
      recipient: h.busySession, text: 'please approve', intent: 'action_request',
      expected: { planRevision: 3, pointerRevision: 7, dispatchSequence: 2 },
    }, 'x-sv-action-2');
    expect(noRead).toMatchObject({ status: 'rejected', code: 'unsupported' });

    const inbox = await h.mailbox.readInbox(h.ctxHost, { recipient: h.busySession, page: { limit: 10 } });
    expect(inbox).toMatchObject({ status: 'ready' });
    if (inbox.status !== 'ready') return;
    expect(inbox.value.items).toEqual([]);
  });

});

/** A3: hold the real store's commit at a test-controlled gate and return its real result. */
type MailboxRecords = NonNullable<Parameters<C1Harness['makeMailbox']>[0]>;
type DispatchFactsPort = NonNullable<SessionMailboxDependencies['dispatchBasis']>;
function holdCommits(records: MailboxRecords, reached: () => void, wait: Promise<void>): MailboxRecords {
  return new Proxy(records, {
    get(target, property) {
      if (property === 'commit') return async (prepared: Parameters<MailboxRecords['commit']>[0]) => {
        reached(); await wait; return target.commit(prepared);
      };
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  }) as MailboxRecords;
}
const raceInput = (h: C1Harness, requestId: string) => ({ input: {
  recipient: h.idleSession, text: 'may I proceed?', intent: 'action_request' as const, needsReply: true,
  expected: { planRevision: 1, pointerRevision: 'none' as const, dispatchSequence: 0 } }, meta: { requestId, expected: [] } });

describe.each(KINDS)('X-send-versions: the Goal window and the commit race (%s)', kind => {
  it('refuses a basis whose Goal moved after its one read, instead of committing the old pins', async () => {
    const h = await openC1World(kind);
    const records = h.backend.records;
    const real = createDispatchBasisReader({ records, pointer: createGoalPointerFacts({ records }) });
    let arrived!: () => void, resume!: () => void;
    const reached = new Promise<void>(resolve => { arrived = resolve; });
    const released = new Promise<void>(resolve => { resume = resolve; });
    let first = true;
    const held: DispatchFactsPort = { async readDispatchFacts(ctx, input) {
      const result = await real.readDispatchFacts(ctx, { goalRef: input.goalRef });
      if (first) { first = false; arrived(); await released; }
      return result;
    } };
    const pending = h.makeMailbox(records, h.materials, undefined, undefined, held)
      .sendMessage(h.ctxWork, raceInput(h, 'x-sv-basis-goal-moved'));
    await reached;
    await h.setGoalAutonomy('every_step'); // the real settings write moves the Goal after the read
    resume();
    expect(await pending).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    const inbox = await h.mailbox.readInbox(h.ctxHost, { recipient: h.idleSession, page: { limit: 10 } });
    expect(inbox).toMatchObject({ status: 'ready', value: { items: [] } });
  });

  it('names the moved three versions after a real commit race, from one more read', async () => {
    const h = await openC1World(kind);
    const records = h.backend.records;
    const real = createDispatchBasisReader({ records, pointer: createGoalPointerFacts({ records }) });
    let reads = 0, bothRead!: () => void;
    const ready = new Promise<void>(resolve => { bothRead = resolve; });
    const gated: DispatchFactsPort = { async readDispatchFacts(ctx, input) {
      reads += 1;
      const result = await real.readDispatchFacts(ctx, { goalRef: input.goalRef });
      if (reads === 2) bothRead();
      await ready;
      return result;
    } };
    const mailbox = h.makeMailbox(records, h.materials, undefined, undefined, gated);
    const [first, second] = await Promise.all([mailbox.sendMessage(h.ctxWork, raceInput(h, 'x-sv-race-a')),
      mailbox.sendMessage(h.ctxWork, raceInput(h, 'x-sv-race-b'))]);
    expect([first.status, second.status].filter(status => status === 'committed')).toHaveLength(1);
    const loser = first.status === 'rejected' ? first : second;
    expect(loser).toMatchObject({ status: 'rejected', code: 'revision_conflict',
      dispatchCurrent: { planRevision: 1, pointerRevision: 'none', dispatchSequence: 1 } });
    expect(reads).toBe(3); // both reads plus the loser's one post-miss read
    const inbox = await h.mailbox.readInbox(h.ctxHost, { recipient: h.idleSession, page: { limit: 10 } });
    expect(inbox).toMatchObject({ status: 'ready', value: { items: [expect.anything()] } });
  });

  it('returns the original written when the one post-conflict re-read throws', async () => {
    const h = await openC1World(kind);
    const records = h.backend.records;
    const real = createDispatchBasisReader({ records, pointer: createGoalPointerFacts({ records }) });
    let reads = 0, bothRead!: () => void;
    const ready = new Promise<void>(resolve => { bothRead = resolve; });
    // A2: the real reader fails once, at the loser's post-conflict re-read only.
    const failing: DispatchFactsPort = { async readDispatchFacts(ctx, input) {
      reads += 1;
      if (reads === 3) throw new Error('the post-conflict read failed once');
      const result = await real.readDispatchFacts(ctx, { goalRef: input.goalRef });
      if (reads === 2) bothRead();
      await ready;
      return result;
    } };
    const mailbox = h.makeMailbox(records, h.materials, undefined, undefined, failing);
    const [first, second] = await Promise.all([mailbox.sendMessage(h.ctxWork, raceInput(h, 'x-sv-reread-a')),
      mailbox.sendMessage(h.ctxWork, raceInput(h, 'x-sv-reread-b'))]);
    expect([first.status, second.status].filter(status => status === 'committed')).toHaveLength(1);
    const loser = first.status === 'rejected' ? first : second;
    expect(loser).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(loser.status === 'rejected' ? loser.dispatchCurrent : undefined).toBeUndefined();
    expect(reads).toBe(3);
    const inbox = await h.mailbox.readInbox(h.ctxHost, { recipient: h.idleSession, page: { limit: 10 } });
    expect(inbox).toMatchObject({ status: 'ready', value: { items: [expect.anything()] } });
  });

  it('does not project dispatchCurrent for an activity-only conflict', async () => {
    const h = await openC1World(kind);
    const records = h.backend.records;
    const real = createDispatchBasisReader({ records, pointer: createGoalPointerFacts({ records }) });
    let reads = 0;
    const counting: DispatchFactsPort = { async readDispatchFacts(ctx, input) {
      reads += 1;
      return real.readDispatchFacts(ctx, { goalRef: input.goalRef });
    } };
    let arrived!: () => void, resume!: () => void;
    const reached = new Promise<void>(resolve => { arrived = resolve; });
    const released = new Promise<void>(resolve => { resume = resolve; });
    const pending = h.makeMailbox(holdCommits(records, arrived, released), h.materials, undefined, undefined, counting)
      .sendMessage(h.ctxWork, raceInput(h, 'x-sv-activity-conflict'));
    await reached;
    expect(await h.mailbox.sendMessage(h.ctxWork, {
      input: { recipient: h.idleSession, text: 'advance', intent: 'inquiry' },
      meta: { requestId: 'x-sv-activity-move', expected: [] },
    })).toMatchObject({ status: 'committed' });
    resume();
    const sent = await pending;
    expect(sent).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(sent.status === 'rejected' ? sent.dispatchCurrent : undefined).toBeUndefined();
    expect(reads).toBe(1); // an activity-only conflict is never re-read
  });
});

describe('X-send-versions: the inquiry deadline (memory)', () => {
  it('freezes a fractional duration and refuses an unrepresentable instant', async () => {
    const h = await openC1World('memory');
    expect(await send(h, { recipient: h.idleSession, text: 'fractional', intent: 'inquiry', deadlineMs: 1500.5 },
      'x-sv-deadline-fractional')).toMatchObject({ status: 'committed', value: {
      release: 'released', deadlineMs: 1500.5, deadline: '2026-09-26T00:00:01.500Z' } });
    expect(await send(h, { recipient: h.idleSession, text: 'overflow', intent: 'inquiry',
      deadlineMs: 8_700_000_000_000_000 }, 'x-sv-deadline-overflow')).toMatchObject({ status: 'rejected', code: 'invalid' });
    const inbox = await h.mailbox.readInbox(h.ctxHost, { recipient: h.idleSession, page: { limit: 10 } });
    expect(inbox).toMatchObject({ status: 'ready', value: { items: [expect.anything()] } });
  });
});
