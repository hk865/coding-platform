/**
 * BK-D default reply-deadline rows (DL-01 … DL-06): `reply-deadline/save` (minutes, `null` clears), the snapshot's
 * `replyDeadline{saved, default}`, and the message's frozen `deadlineMs`/`deadline` through `messages/read`. A frozen
 * deadline is the send time the message itself records (its `createdAt`, read back the same way) plus the duration:
 * the world's setup moves the injected `S6AClock` before the send, so no row assumes the send instant. DL-02 alone
 * asks for the 40 ms heartbeat the expiry row uses (S7B-L-expiry-host.test.ts:45), so the other rows keep the
 * default Host period.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6AClock } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { sessionOf } from '../helpers/S7A-fixture.js';
import { openS7BWorld, readS7BMessage, runS7BWait, sendS7BWaitingInquiry } from '../helpers/S7B-fixture.js';
import { replyDeadlineOf, settingsOf } from '../helpers/BKD-world.js';
import { heartbeat } from '../helpers/IV-host-fixture.js';
import { waitFor } from '../scenarios/harness.js';

const PROJECT = S6A_SCOPE.projectId;
const worlds: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});
async function openDeadlineWorld(backend: 'memory' | 'sqlite' = 'memory', fast = false) {
  const opened = await openS7BWorld({ backend,
    ...(fast ? { extraHostOptions: { scribeReminderPeriodMs: 40 } } : {}) });
  worlds.push(opened.world);
  return opened;
}
const deadlineOf = (clock: S6AClock, minutes: number): { deadline: string; deadlineMs: number } => ({
  deadline: new Date(Date.parse(clock.now()) + minutes * 60_000).toISOString(), deadlineMs: minutes * 60_000 });
/** The deadline a message freezes: its own recorded send time plus `ms`. */
const afterSend = (message: { createdAt: string }, ms: number): string =>
  new Date(Date.parse(message.createdAt) + ms).toISOString();
// Mutation: the snapshot drops `replyDeadline`, or the constant stops being 1440.
it('DL-01 the snapshot publishes 1440 minutes and an unanswered inquiry freezes 24 hours', async () => {
  const { world } = await openDeadlineWorld();
  expect(await replyDeadlineOf(world)).toEqual({ saved: {}, default: 1440 });
  const sent = await runS7BWait(world, { label: 'dl-01' });
  const message = await readS7BMessage(world, sent.message);
  expect(message).toMatchObject({ deadline: afterSend(message, 86_400_000), deadlineMs: 86_400_000 });
});
// Mutation: the mailbox captures the deadline at construction, or an already-sent message is recomputed.
it('DL-02 a saved project value applies to the next send only and expires at the minute', async () => {
  const { world, clock } = await openDeadlineWorld('memory', true);
  const first = await runS7BWait(world, { label: 'dl-02-first' });
  const firstDeadline = afterSend(await readS7BMessage(world, first.message), 86_400_000);
  clock.advance(3_600_000);
  expect(await settingsOf(world, 'reply-deadline/save', { projectId: PROJECT, minutes: 30 }))
    .toMatchObject({ status: 'ready' });
  expect(await replyDeadlineOf(world)).toEqual({ saved: { [PROJECT]: 30 }, default: 1440 });
  const second = await runS7BWait(world, { label: 'dl-02-second' });
  const sentSecond = await readS7BMessage(world, second.message);
  const deadline = afterSend(sentSecond, 1_800_000);
  expect(sentSecond).toMatchObject({ deadline, deadlineMs: 1_800_000 });
  expect((await readS7BMessage(world, first.message)).deadline).toBe(firstDeadline);
  // Two real passes ending at 29:59 after the send: the second starts after the first, so an early expiry would
  // already be visible here. Each `heartbeat` arms the pass, then moves the clock 25 ms so the throttle lets it run (a
  // bare `consumeBarrier()` with the clock standing still never sees a second pass), so they start 50 ms earlier.
  clock.set(new Date(Date.parse(deadline) - 1_050).toISOString());
  await heartbeat(world);
  await heartbeat(world);
  expect((await readS7BMessage(world, second.message)).expiredAt).toBeNull();
  clock.advance(1_000);
  const expired = await waitFor(() => readS7BMessage(world, second.message),
    message => message.expiredAt !== null, 'the 30-minute expiry');
  expect(expired.expiredAt).toBe(deadline);
  expect((await readS7BMessage(world, first.message)).expiredAt).toBeNull();
});
// Mutation: the explicit `deadlineMs` loses its priority to the saved project value (30 minutes).
it('DL-03 an explicit deadline still wins over the saved project value', async () => {
  const { world } = await openDeadlineWorld();
  expect(await settingsOf(world, 'reply-deadline/save', { projectId: PROJECT, minutes: 30 }))
    .toMatchObject({ status: 'ready' });
  const wait = await runS7BWait(world, { label: 'dl-03' });
  const ws = s6aCardsWorkspace(world, S6A_SCOPE);
  const line = await sessionOf(world, await createS6BLine(ws, { label: 'dl-03-line', role: S6A_WORK_ROLE,
    tasks: [wait.tasks[1]!] }));
  const sent = await sendS7BWaitingInquiry(world, { goal: wait.goal, session: line, taskId: wait.tasks[1]!.taskId,
    label: 'dl-03-explicit', body: { recipient: wait.recipient.ref, text: 'BK-D explicit five minutes',
      needsReply: true, waitAfterSend: true, deadlineMs: 300_000 } });
  expect(sent).toMatchObject(deadlineOf(world.clock, 5));
});
// Mutation: `null` leaves the old key in the saved table instead of deleting it.
it('DL-04 clearing the project value returns to the 24-hour default', async () => {
  const { world } = await openDeadlineWorld();
  const save = (minutes: number | null) => settingsOf(world, 'reply-deadline/save', { projectId: PROJECT, minutes });
  await save(30);
  expect(await replyDeadlineOf(world)).toEqual({ saved: { [PROJECT]: 30 }, default: 1440 });
  expect(await save(null)).toMatchObject({ status: 'ready' });
  expect(await replyDeadlineOf(world)).toEqual({ saved: {}, default: 1440 });
  const sent = await runS7BWait(world, { label: 'dl-04' });
  expect((await readS7BMessage(world, sent.message)).deadlineMs).toBe(86_400_000);
});
describe('rejects: reply-deadline/save', () => {
// Mutations, one per entry: the positive-integer check, the one-year bound, and the opened-project check.
it.each([
  ['zero', { projectId: PROJECT, minutes: 0 }, 'invalid'],
  ['fractional', { projectId: PROJECT, minutes: 1.5 }, 'invalid'],
  ['string', { projectId: PROJECT, minutes: '30' }, 'invalid'],
  ['missing project', { minutes: 30 }, 'invalid'],
  ['unopened project', { projectId: 'not-this-project', minutes: 30 }, 'not_found'],
  ['over one year', { projectId: PROJECT, minutes: 525_601 }, 'invalid'],
] as const)('DL-05 rejects %s', async (_label, input, code) => {
  const { world } = await openDeadlineWorld();
  const before = await replyDeadlineOf(world);
  expect(await settingsOf(world, 'reply-deadline/save', input)).toMatchObject({ status: 'rejected', code });
  expect(await replyDeadlineOf(world)).toEqual(before);
  expect(before).toEqual({ saved: {}, default: 1440 });
});
});
// Mutation: the startup reads the saved table but the Host never writes it (the save is memory-only).
it('DL-06 (SQLite only: the Host restart) the project value survives a reopen', async () => {
  const { world } = await openDeadlineWorld('sqlite');
  expect(await settingsOf(world, 'reply-deadline/save', { projectId: PROJECT, minutes: 30 }))
    .toMatchObject({ status: 'ready' });
  await world.reopen();
  expect(await replyDeadlineOf(world)).toEqual({ saved: { [PROJECT]: 30 }, default: 1440 });
  const sent = await runS7BWait(world, { label: 'dl-06' });
  expect((await readS7BMessage(world, sent.message)).deadlineMs).toBe(1_800_000);
});
