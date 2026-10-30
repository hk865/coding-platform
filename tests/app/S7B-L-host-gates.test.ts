/**
 * L-host-gates (book-7b.md:1208; SR9 §9.3): the Host's two consumption gates call the ONE delivery rule. With the Goal
 * paused between the facts read and the verdict, an eligible inquiry and an eligible reply skip the round and stay
 * queued; on resume the same messages take the existing `consumeConsultation` path. A person's action_request on the
 * waiting line is dispatched instead: its one `claimed` result drives the existing `select_work` prepare/start.
 * Neither gate re-checks a subset: only the full rule sees the paused Goal. Memory (a business-rule row); A4 shares the
 * one real records backend and body store across the Host start the consumers need, and A3's wrappers return real results.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_SECRETARY_PROFILE_ID, S6A_SECRETARY_ROLE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from '../helpers/S6B1-fixture.js';
import {
  committed, pauseS7AGoal, ready, replyS7AMessage, resumeS7AGoal, sessionOf,
} from '../helpers/S7A-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';
import { interventionDeliveryText } from '../helpers/S7B-delivery-samples.js';
import { waitFor } from '../scenarios/harness.js';

const shared = vi.hoisted(() => ({ backend: undefined as unknown, bodies: undefined as unknown, factsRead: [] as string[] }));
vi.mock('../../src/core/work-graph/views/consumable-sessions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/work-graph/views/consumable-sessions.js')>();
  return { ...actual, createConsumableSessions: (deps: Parameters<typeof actual.createConsumableSessions>[0]) =>
    actual.createConsumableSessions({ ...deps, eligibility: {
      readDeliveryEligibilityFacts: async (ctx, input) => {
        shared.factsRead.push(input.messageRef.messageId);
        return await deps.eligibility.readDeliveryEligibilityFacts(ctx, input);
      },
    } }) };
});
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/in-memory-record-store.js')>();
  return { ...actual, createInMemoryRecordBackend: (options: Parameters<typeof actual.createInMemoryRecordBackend>[0]) => {
    shared.backend ??= { ...actual.createInMemoryRecordBackend(options), close: async () => undefined };
    return shared.backend;
  } };
});
vi.mock('../../src/core/record-store/body-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/body-store.js')>();
  return { ...actual, RawArtifactBodyStore: class SharedRawArtifactBodyStore {
    constructor() { shared.bodies ??= new actual.RawArtifactBodyStore(); return shared.bodies as never; }
  } as never };
});

const worlds: S6AHostWorld[] = [];
afterEach(async () => { await Promise.all(worlds.splice(0).map(world => world.close())); });
const queued = async (world: S6AHostWorld, session: S6ASession, ref: SessionMessage['ref']): Promise<SessionMessage> => {
  const item = (await listed(world, 'inbox', session)).find(entry => entry.ref.messageId === ref.messageId)
    ?? (await listed(world, 'outbox', session)).find(entry => entry.ref.messageId === ref.messageId);
  if (item === undefined) throw new Error(`S7B: the ${ref.messageId} cell left the queue`);
  return item;
};

/** One real Work Run that sends one inquiry: `wait` yields on it, otherwise it ends before its checks. */
async function sendRun(world: S6AHostWorld, input: { goal: GoalRef; session: S6ASession; recipient: S6ASession;
  taskId: string; label: string; text: string; wait: boolean }): Promise<SessionMessage> {
  await world.scripted.script(input.session, [{ kind: 'calls', calls: [{ callId: `s7b-gates-${input.label}`,
    name: 'send_session_message', args: { recipient: input.recipient.ref, text: input.text, intent: 'inquiry',
      needsReply: true, ...(input.wait ? { waitAfterSend: true } : {}) } }] }]);
  await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: input.goal, flowId: `s7b-gates-${input.label}`,
    sessionHint: input.session.ref, kind: 'select_work', taskId: input.taskId },
  input.wait ? {} : { stopBefore: 'open_checks' });
  const message = (await listed(world, 'outbox', input.session)).find(item => item.sender.kind === 'work_run');
  if (message === undefined) throw new Error(`S7B: the ${input.label} inquiry is not in its outbox`);
  return message;
}

it('a paused Goal keeps both gates queued, resume consumes the inquiry and reply, and a claimed intervention drives select_work', async () => {
  shared.factsRead.length = 0;
  const world = await openS6AHostWorld({ backend: 'memory', secretaryWork: true,
    secretaryTools: ['read', 'send_session_message', 'respond_session_message'] });
  worlds.push(world);
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  await governS6B(world, main, world.goals);
  const goal = world.goals.first;
  const { tasks } = await adoptS6BPlan(main, goal, { label: 'gates',
    taskIds: ['s7b-gates-wait', 's7b-gates-question', 's7b-gates-reply'], role: S6A_SECRETARY_ROLE.templateId });
  const line = async (label: string, index?: number) => await sessionOf(world,
    await createS6BLine(main, { label, role: S6A_SECRETARY_ROLE, ...(index === undefined ? {} : { tasks: [tasks[index]!] }) }));
  const sender = await line('s7b-gates-sender', 0);
  const sender2 = await line('s7b-gates-sender2', 1);
  const waitRecipient = await line('s7b-gates-wait-recipient');
  const responder = await line('s7b-gates-responder');
  const third = await line('s7b-gates-third');
  const wait = await sendRun(world, { goal, session: sender, recipient: waitRecipient, taskId: tasks[0]!.taskId,
    label: 'wait', text: 'S7B gates wait question', wait: true });
  const question = await sendRun(world, { goal, session: sender2, recipient: responder, taskId: tasks[1]!.taskId,
    label: 'question', text: 'S7B gates answered question', wait: false });
  await replyS7AMessage(world, { goal, recipient: responder, messageRef: question.ref, taskId: tasks[2]!.taskId,
    label: 'gates-reply', text: 'S7B gates answer' });
  const person = committed<SessionMessage>(await world.post('messages/send', graphWrite(S6A_SCOPE, {
    recipient: third.ref, text: 'S7B gates person question', intent: 'inquiry', needsReply: true, goalRef: goal,
  }, 's7b-gates-person')), 'the person inquiry');
  const intervention = committed<SessionMessage>(await world.post('messages/send', graphWrite(S6A_SCOPE, {
    recipient: sender.ref, text: 'S7B gates intervention', intent: 'action_request', goalRef: goal, taskRef: tasks[0],
  }, 's7b-gates-intervention')), 'the intervention message');
  await pauseS7AGoal(world, goal);
  await world.reopen({ sharedMemoryStore: true, extraHostOptions: { inputConsumers: [third, sender2, sender].map(
    (session, index) => ({ scope: S6A_SCOPE, sessionRef: session.ref, goalRef: goal,
      queryProfileId: S6A_SECRETARY_PROFILE_ID, heartbeatMs: 25 + index })) } });
  world.scriptReplies(Array.from({ length: 8 }, () => ({ kind: 'text', text: 'S7B gates consultation answer' })));
  // A3: both gates' one facts read, the two consume calls and the intervention dispatch, every real result unchanged.
  const workflow = world.platform.workflow as unknown as {
    consumeConsultation?: (ctx: never, input: never) => Promise<unknown>;
    handleIntervention?: (ctx: never, input: never) => Promise<{ status: string }>;
  };
  if (workflow.handleIntervention === undefined) {
    throw new Error('the Host gates need platform.workflow.handleIntervention');
  }
  const factsRead = shared.factsRead;
  const consumed: Array<{ id: string; part: string | undefined }> = [];
  const handled: Array<{ id: string; status: string }> = [];
  const realConsume = workflow.consumeConsultation!;
  const realHandle = workflow.handleIntervention;
  workflow.consumeConsultation = async (ctx, input) => {
    const body = input as { messageRef: { messageId: string }; part?: string };
    const result = await realConsume(ctx, input);
    consumed.push({ id: body.messageRef.messageId, part: body.part });
    return result;
  };
  workflow.handleIntervention = async (ctx, input) => {
    const result = await realHandle(ctx, input);
    handled.push({ id: (input as { messageRef: { messageId: string } }).messageRef.messageId, status: result.status });
    return result;
  };
  // Paused: both gates read the three facts, skip every cell and consume nothing. The consumer throttle is on
  // `Date.now()` (frozen by the world's fake clock), so a clock step triggers the scan.
  world.clock.advance(100);
  await waitFor(async () => [...factsRead], ids => [person, question, intervention]
    .every(message => ids.includes(message.ref.messageId)), 'both gates to read the three delivery facts');
  expect({ consumed, handled }).toEqual({ consumed: [], handled: [] });
  for (const [session, ref] of [[third, person.ref], [sender2, question.ref], [sender, intervention.ref]] as const) {
    expect((await queued(world, session, ref)).acceptedInputs ?? []).toEqual([]);
  }
  // Resume: the inquiry and the reply take the consume path; the person's action_request takes the dispatch.
  await resumeS7AGoal(world, goal);
  world.clock.advance(100);
  await waitFor(async () => [...consumed], entries => entries.some(entry => entry.id === person.ref.messageId
    && entry.part === undefined) && entries.some(entry => entry.id === question.ref.messageId
    && entry.part === 'response'), 'the two eligible cells to be consumed');
  await waitFor(async () => [...handled], entries => entries.some(entry => entry.id === intervention.ref.messageId
    && entry.status === 'claimed'), 'the intervention dispatch to claim');
  expect(consumed.some(entry => entry.id === intervention.ref.messageId), 'the dispatch is not a consultation').toBe(false);
  expect(handled.some(entry => entry.id === person.ref.messageId || entry.id === question.ref.messageId)).toBe(false);
  // The claimed result drives the existing select_work prepare/start: a new Run on the waiting line renders the
  // person's intervention text in its own model request.
  const latest = await waitFor(async () => ready<{ latestWork: { runRef: { runId: string } } | null }>(
    await world.post('sessions/facts', plain(S6A_SCOPE, sender.ref)), 'the sender facts'),
  facts => facts.latestWork !== null && facts.latestWork.runRef.runId !== (wait.sender.kind === 'work_run' ? wait.sender.runRef.runId : ''),
  'the claimed intervention Run');
  const expected = interventionDeliveryText({ messageId: intervention.ref.messageId, body: 'S7B gates intervention' });
  // Any request, not the last: a later consultation turn may follow the intervention Run's request.
  await waitFor(async () => [...world.model.requests], requests => requests.some(request => request.messages
    .some(message => message.role === 'user' && String(message.content).includes(expected))),
  'the intervention prepare/start model request');
}, 120_000);

it('a queued notify opens no turn and is skipped before the inquiry behind it', async () => {
  shared.backend = undefined; shared.bodies = undefined;
  const world = await openS6AHostWorld({ backend: 'memory', secretaryWork: true,
    secretaryTools: ['read', 'send_session_message', 'respond_session_message'] }); worlds.push(world);
  const main = s6aCardsWorkspace(world, S6A_SCOPE); await governS6B(world, main, world.goals);
  const { tasks } = await adoptS6BPlan(main, world.goals.first, { label: 'notify', taskIds: ['s7b-gates-notify'],
    role: S6A_SECRETARY_ROLE.templateId }); const goal = world.goals.first;
  const line = await sessionOf(world, await createS6BLine(main, { label: 's7b-gates-notify-line',
    role: S6A_SECRETARY_ROLE, tasks: [tasks[0]!] }));
  await sendRun(world, { goal, session: line, taskId: tasks[0]!.taskId, label: 'notify-wait',
    recipient: await sessionOf(world, await createS6BLine(main, { label: 's7b-gates-notify-recipient',
      role: S6A_SECRETARY_ROLE })), text: 'S7B gates notify wait question', wait: true });
  const notify = committed<SessionMessage>(await world.post('messages/send', graphWrite(S6A_SCOPE, {
    recipient: line.ref, text: 'S7B gates notify first', intent: 'notify', goalRef: goal, taskRef: tasks[0],
  }, 's7b-gates-notify')), 'the person notify');
  const inquiry = committed<SessionMessage>(await world.post('messages/send', graphWrite(S6A_SCOPE, {
    recipient: line.ref, text: 'S7B gates inquiry second', intent: 'inquiry', needsReply: true,
    goalRef: goal }, 's7b-gates-inquiry')), 'the inquiry behind the notify');
  await pauseS7AGoal(world, goal);
  await world.reopen({ sharedMemoryStore: true, extraHostOptions: { inputConsumers: [{ scope: S6A_SCOPE,
    sessionRef: line.ref, goalRef: goal, queryProfileId: S6A_SECRETARY_PROFILE_ID, heartbeatMs: 25 }] } });
  const workflow = world.platform.workflow as unknown as { handleIntervention: (ctx: never, input: never) => Promise<{ status: string }> }; const realHandle = workflow.handleIntervention; const handled: string[] = [];
  workflow.handleIntervention = async (ctx, input) => { const result = await realHandle(ctx, input); handled.push(result.status); return result; };
  world.scriptReplies(Array.from({ length: 4 }, () => ({ kind: 'text', text: 'S7B gates notify answer' })));
  await resumeS7AGoal(world, goal); world.clock.advance(100);
  await waitFor(async () => queued(world, line, inquiry.ref),
    message => message.response !== null, 'the inquiry behind the notify to take its turn');
  const still = await queued(world, line, notify.ref);
  expect([still.delivery, still.acceptedInputs ?? []]).toEqual(['queued', []]); expect(handled).toEqual([]);
}, 120_000);
