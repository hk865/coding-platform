/**
 * L-host-gates: `consumeIdle`'s INBOX and OUTBOX reads with one real `inputConsumers` period; the all-Session
 * walk reaches the sending Work line and the two secretary recipients. The table has one row per cell:
 *
 * | cell | send | state before the Host reads |
 * |------|------|-----------------------------|
 * | inbox awaiting | Work Run `action_request`, `every_step` | release `awaiting` |
 * | inbox withdrawn | the person's `messages/send` | release `null`, then `messages/withdraw` |
 * | inbox released | the person's `messages/send` | release `null` |
 * | outbox awaiting | a Work Run `action_request`, `every_step` | release `awaiting`, real Work reply saved |
 * | outbox withdrawn | a Work Run inquiry at `after_plan_confirmation` | release `released`, then withdrawn, real Work reply saved |
 *
 * The person also sends a released control; each cell's result is the one rule's. The replies are real
 * `respond_session_message` calls through real Runs. A3 wraps `platform.workflow.consumeConsultation` and waits for
 * the real calls to complete; A4 shares ONE real memory records backend and body store across the world's Host
 * starts, so `reopen({ sharedMemoryStore: true })` restarts the same store on the same directory.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { advanceUntil, driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld, type S6AReply } from '../helpers/S6A-host-fixture.js';
import {
  S6A_SCOPE, S6A_SECRETARY_PROFILE_ID, S6A_SECRETARY_ROLE, type S6ASession,
} from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from '../helpers/S6B1-fixture.js';
import { committed, ready, replyS7AMessage, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';

// A4: one real in-memory records backend and one real body store, shared by every Host start; the backend's `close`
// leaves it open (the body store has none), so `world.reopen({ sharedMemoryStore: true })` is a real same-store reopen.
const shared = vi.hoisted(() => ({ backend: undefined as unknown, bodies: undefined as unknown }));
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/in-memory-record-store.js')>();
  return { ...actual, createInMemoryRecordBackend: (options: Parameters<typeof actual.createInMemoryRecordBackend>[0]) => {
    if (shared.backend === undefined) {
      shared.backend = { ...actual.createInMemoryRecordBackend(options), close: async () => undefined };
    }
    return shared.backend;
  } };
});
vi.mock('../../src/core/record-store/body-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/body-store.js')>();
  return { ...actual, RawArtifactBodyStore: class SharedRawArtifactBodyStore {
    constructor() {
      shared.bodies ??= new actual.RawArtifactBodyStore();
      return shared.bodies as never;
    }
  } as never };
});

const worlds: S6AHostWorld[] = [];
afterEach(async () => { await Promise.all(worlds.splice(0).map(world => world.close())); });

/** Walk the all-Session batch until the named real consume completes: each beat is one real pass. */
async function pumpUntil(world: S6AHostWorld, reached: Promise<void>, beats = 12): Promise<void> {
  let done = false;
  void reached.then(() => { done = true; });
  for (let beat = 0; beat < beats && !done; beat += 1) {
    const settled = world.consumeBarrier();
    world.clock.advance(25);
    await settled;
    await Promise.resolve();
  }
  await reached;
}
/** The person's own send: `release: null`, the only release a public owner writes. */
const sendAsPerson = async (world: S6AHostWorld, recipient: S6ASession, label: string,
  text: string): Promise<SessionMessage> => committed<SessionMessage>(await world.post('messages/send',
  graphWrite(S6A_SCOPE, { recipient: recipient.ref, text, intent: 'inquiry', needsReply: true,
    goalRef: world.goals.first }, label)),
'control');
const withdrawAsPerson = async (world: S6AHostWorld, messageRef: SessionMessage['ref'], label: string):
Promise<SessionMessage> => committed<SessionMessage>(await world.dispatch('messages/withdraw', world.humanContext(),
  graphWrite(S6A_SCOPE, { messageRef }, label)), 'withdrawal');
/** A3: forward every real consume unchanged; record it after it COMPLETES and resolve the named barrier. */
function consumptionBarrier(workflow: S6AHostWorld['platform']['workflow']) {
  const consumed: Array<{ messageId: string; part: 'message' | 'response' | undefined }> = [];
  const waiters: Array<{ ids: Set<string>; resolve: () => void }> = [];
  const real = workflow.consumeConsultation!;
  workflow.consumeConsultation = async (ctx, input) => {
    const result = await real(ctx, input);
    consumed.push({ messageId: input.messageRef.messageId, part: input.part });
    for (const waiter of [...waiters]) {
      if ([...waiter.ids].every(id => consumed.some(entry => entry.messageId === id))) waiter.resolve();
    }
    return result;
  };
  const waitFor = (ids: readonly string[]): Promise<void> => {
    const set = new Set(ids);
    if ([...set].every(id => consumed.some(entry => entry.messageId === id))) return Promise.resolve();
    return new Promise(resolve => waiters.push({ ids: set, resolve }));
  };
  return { consumed, waitFor };
}
/** One real Work Run of the sending line that sends `calls` and ends before the Workflow's open checks. */
async function sendRun(world: S6AHostWorld, sender: S6ASession, taskId: string, label: string,
  calls: Extract<S6AReply, { kind: 'calls' }>['calls']): Promise<void> {
  await world.scripted.script(sender, [{ kind: 'calls', calls },
    { kind: 'text', text: `S7A gate ${label} sent` }]);
  const next = await advanceUntil(world.ag2b, { schemaVersion: 1, goalRef: world.goals.first,
    flowId: `s7a-gate-${label}`, sessionHint: sender.ref, kind: 'select_work', taskId }, 'claim_task');
  await driveWorkflow(world.ag2b, next, { stopBefore: 'open_checks' });
}
/** The recipient's real Work reply, through the shared helper the other S7A tests use. */
async function replyRun(world: S6AHostWorld, recipient: S6ASession, messageRef: SessionMessage['ref'],
  taskId: string, label: string): Promise<void> {
  await replyS7AMessage(world, { goal: world.goals.second, recipient, messageRef, taskId, label,
    text: `the ${label} reply` });
}

it('the Host skips the awaiting and withdrawn cells and consumes only the released controls', async () => {
  const world = await openS6AHostWorld({ backend: 'memory', secretaryWork: true,
    secretaryTools: ['read', 'send_session_message', 'respond_session_message'] });
  worlds.push(world);
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  await world.setResumeOnStartup(false);
  await governS6B(world, main, world.goals);
  const goal = world.goals.first;
  const { tasks } = await adoptS6BPlan(main, goal, { label: 's7a-gate',
    taskIds: ['s7a-gate-awaiting-send', 's7a-gate-withdrawn-send'], role: S6A_SECRETARY_ROLE.templateId });
  const made = await createS6BLine(main, { label: 's7a-gate-sender', role: S6A_SECRETARY_ROLE, tasks });
  const senderCard = await world.readSession(made.ref);
  const sender: S6ASession = { ...made, aggregateRef: senderCard.record.ref,
    role: structuredClone(senderCard.record.role), createdAt: senderCard.record.createdAt };
  const awaiting = await world.createSecretary('s7a-gate-awaiting');
  const withdrawn = await world.createSecretary('s7a-gate-withdrawn');
  const scan1 = await world.createSecretary('s7a-gate-scan-1');
  const scan2 = await world.createSecretary('s7a-gate-scan-2');
  const basis = (await world.dispatch('goals/dispatch-basis', world.humanContext(),
    plain(S6A_SCOPE, { goalRef: goal })) as { status: string; value?: Record<string, unknown> }).value;
  // Two outbox cells in one table, one loop: the Work Run's action_request left awaiting by `every_step`, and an
  // inquiry released at `after_plan_confirmation`, withdrawn before any reply.
  const outboxCells = [
    { label: 'awaiting-send', task: tasks[0]!.taskId, recipient: awaiting, autonomy: 'every_step' as const,
      text: 'S7A gate awaiting', args: { intent: 'action_request' as const, needsReply: true, expected: basis },
      release: 'awaiting', pinned: true, withdraw: false },
    { label: 'withdrawn-send', task: tasks[1]!.taskId, recipient: withdrawn,
      autonomy: 'after_plan_confirmation' as const, text: 'S7A gate withdrawn',
      args: { intent: 'inquiry' as const, needsReply: true }, release: 'released', pinned: false, withdraw: true },
  ];
  const outboxSent: SessionMessage[] = [];
  for (const cell of outboxCells) {
    await setS7AAutonomy(world, goal, cell.autonomy);
    await sendRun(world, sender, cell.task, cell.label, [{ callId: `s7a-gate-${cell.label}`,
      name: 'send_session_message', args: { recipient: cell.recipient.ref, text: cell.text, ...cell.args } }]);
    const message = (await listed(world, 'inbox', cell.recipient)).find(item => item.sender.kind === 'work_run');
    if (message === undefined) throw new Error(`S7A: the Work Run sent no ${cell.label} cell`);
    expect(message).toMatchObject({ release: cell.release, withdrawnAt: null });
    if (cell.pinned) expect(message.pins).not.toBeNull();
    if (cell.withdraw) expect(await withdrawAsPerson(world, message.ref, `s7a-gate-withdraw-${cell.label}`))
      .toMatchObject({ withdrawnAt: expect.any(String) });
    outboxSent.push(message);
  }
  const awaitingSent = outboxSent[0]!;
  const withdrawnSent = outboxSent[1]!;
  // The inbox cell is withdrawn BEFORE the consumer reads it and is the person's own (release null).
  const inboxWithdrawn = await sendAsPerson(world, withdrawn, 's7a-gate-inbox-withdrawn', 'S7A gate inbox withdrawn');
  expect(inboxWithdrawn).toMatchObject({ release: null, withdrawnAt: null });
  expect(await withdrawAsPerson(world, inboxWithdrawn.ref, 's7a-gate-withdraw-inbox'))
    .toMatchObject({ withdrawnAt: expect.any(String) });
  // Both outbox cells get the recipient's real Work reply (a real Run calling `respond_session_message`).
  const replyPlan = await adoptS6BPlan(s6aCardsWorkspace(world, S6A_SCOPE), world.goals.second,
    { label: 's7a-gate-replies', taskIds: ['s7a-gate-reply-awaiting', 's7a-gate-reply-withdrawn'],
      role: S6A_SECRETARY_ROLE.templateId });
  await replyRun(world, awaiting, awaitingSent.ref, replyPlan.tasks[0]!.taskId, 'awaiting');
  await replyRun(world, withdrawn, withdrawnSent.ref, replyPlan.tasks[1]!.taskId, 'withdrawn');
  // The sending line is idle: the last Run ended and the Session is unoccupied.
  const senderNow = await world.readSession(sender.ref);
  expect({ availability: senderNow.availability, occupancy: senderNow.record.occupancy }).toEqual(
    { availability: 'idle', occupancy: null });
  const lastRun = senderNow.record.lastExecutionRef;
  if (lastRun?.aggregateType !== 'Run') throw new Error('S7A: the sending line has no last Run');
  expect(ready<{ run: { status: string } }>(await world.post('executions/read', plain(S6A_SCOPE, lastRun)),
    'the last Run')).toMatchObject({ run: { status: 'ended' } });
  // A4: a real same-store reopen — the same records, bodies and directory; the consumers are a start option.
  // One 25 ms consumer is the period only: the all-Session walk reaches every gate cell, not three named lines.
  await world.reopen({ sharedMemoryStore: true, extraHostOptions: { inputConsumers: [{
    scope: S6A_SCOPE, sessionRef: awaiting.ref, goalRef: goal, queryProfileId: S6A_SECRETARY_PROFILE_ID,
    heartbeatMs: 25 }] } });
  // The reopened Host's own startup scans left the three saved forbidden cells alone: a public read of both inboxes
  // shows no accepted input on any of them (the ids are listed in the order the Host would scan them).
  const reopenedInbox = [...await listed(world, 'inbox', awaiting), ...await listed(world, 'inbox', withdrawn)];
  const forbiddenIds = [awaitingSent.ref.messageId, withdrawnSent.ref.messageId, inboxWithdrawn.ref.messageId];
  const savedCells = forbiddenIds.map(id => reopenedInbox.find(item => item.ref.messageId === id));
  if (savedCells.some(cell => cell === undefined)) throw new Error('S7A: a reopened read lost a saved cell');
  expect(savedCells.map(cell => cell?.acceptedInputs ?? [])).toEqual([[], [], []]);
  // The awaiting Work Run's message body was saved before the reopen; the new Host reads it from the same store.
  expect(ready<{ text: string }>(await world.post('messages/body',
    plain(S6A_SCOPE, { messageRef: awaitingSent.ref, part: 'message' })), 'the awaiting message body').text)
    .toBe('S7A gate awaiting');
  world.scriptReplies(Array.from({ length: 8 }, () => ({ kind: 'text', text: 'S7A gate consultation answer' })));
  const { consumed, waitFor } = consumptionBarrier(world.platform.workflow);
  // The startup scans skip the saved awaiting/withdrawn cells: each sentinel's real consume proves its own scan;
  // each beat below is one real barrier-terminated pass, never a sleep or a wall-clock poll.
  const sentinel1 = await sendAsPerson(world, scan1, 's7a-gate-quiesce-1', 'S7A gate quiesce 1');
  await pumpUntil(world, waitFor([sentinel1.ref.messageId]));
  // A later message on the same line: the first inquiry is answered, so it must not stay that line's first offer.
  const sameLine = await sendAsPerson(world, scan1, 's7a-gate-quiesce-1b', 'S7A gate quiesce 1b');
  const sentinel2 = await sendAsPerson(world, scan2, 's7a-gate-quiesce-2', 'S7A gate quiesce 2');
  await pumpUntil(world, waitFor([sentinel2.ref.messageId]));
  const sentinels: SessionMessage[] = [sentinel1, sameLine, sentinel2];
  // A gate that is deleted lets the Host consume one of the three refused cells: `refused` resolves and the
  // consumption-set assertions below fail as a real assertion in normal time, not as a 120-second timeout.
  const refused = Promise.race([waitFor([awaitingSent.ref.messageId]), waitFor([withdrawnSent.ref.messageId]),
    waitFor([inboxWithdrawn.ref.messageId])]);
  // The trigger: the person's two controls, then one more sent to the sending line so its outbox scan settles.
  const awaitingControl = await sendAsPerson(world, awaiting, 's7a-gate-awaiting-control', 'S7A gate awaiting control');
  const withdrawnControl = await sendAsPerson(world, withdrawn, 's7a-gate-withdrawn-control', 'S7A gate withdrawn control');
  const controlsDone = waitFor([awaitingControl.ref.messageId, withdrawnControl.ref.messageId]);
  await Promise.race([pumpUntil(world, controlsDone), refused]);
  const senderControl = await sendAsPerson(world, sender, 's7a-gate-sender-settle', 'S7A gate sender settle');
  const settled = waitFor([senderControl.ref.messageId]);
  await Promise.race([pumpUntil(world, settled), refused]);
  // The outbox cells were never consumed as responses and are still listed with their real replies. The one
  // consumption set is the person's released sends; no awaiting/withdrawn ref was consumed at all.
  expect(consumed.filter(entry => entry.part === 'response')).toEqual([]);
  expect([...new Set(consumed.map(entry => entry.messageId))].sort()).toEqual(
    [...sentinels, awaitingControl, withdrawnControl, senderControl].map(message => message.ref.messageId).sort());
  const outbox = await listed(world, 'outbox', sender);
  for (const sent of [awaitingSent, withdrawnSent]) {
    const entry = outbox.find(item => item.ref.messageId === sent.ref.messageId);
    expect(entry).toMatchObject({ ref: sent.ref });
    expect(entry?.response).not.toBeNull();
  }
  expect(outbox.find(item => item.ref.messageId === withdrawnSent.ref.messageId))
    .toMatchObject({ release: 'released', withdrawnAt: expect.any(String), response: expect.anything() });
  for (const [session, refs] of [[awaiting, [awaitingSent.ref, awaitingControl.ref]],
    [withdrawn, [withdrawnSent.ref, inboxWithdrawn.ref, withdrawnControl.ref]]] as const) {
    expect((await listed(world, 'inbox', session)).map(item => item.ref.messageId)).toEqual(expect.arrayContaining(
      refs.map(ref => ref.messageId)));
  }
  expect((await listed(world, 'inbox', withdrawn)).find(item => item.ref.messageId === inboxWithdrawn.ref.messageId))
    .toMatchObject({ release: null, withdrawnAt: expect.any(String) });
}, 120_000);
