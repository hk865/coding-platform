/**
 * H-consume (SR7 H.4, H-M): the Host's one all-Session consume batch over C's published `readConsumableSessions`
 * view, the kind dispatch and the two skip reasons.
 *
 * Public entry: `openS7B2ConsumeWorld` (TE5, one 25 ms consumer) and `world.consumeBarrier()`; the clock only clears
 * the frozen `Date.now()` throttle, so the barrier is the completion signal.
 *
 * Expected (SR7 H.4): 8 Sessions open on heartbeat 1 and the remaining 2 on heartbeat 2; notify-only and unmatched
 * role open no model call, the latter returning `{ reason: 'no_profile' }`; the goal-less person is
 * `{ reason: 'no_goal' }` with `acceptedInputs` staying `[]`; both ordinary late replies are consumed with an accepted
 * `response` input; a person message and one released agent `action_request` in the same Session turn on the person
 * message while the action_request stays queued.
 */
import { afterEach, expect, it } from 'vitest';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { plainSessionRefKey } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { advanceUntil, driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine } from '../helpers/S6B1-fixture.js';
import { openS7B2ConsumeWorld, type S7B2ConsumeWorld } from '../helpers/S7B2-consumable-sessions.js';
import { committed, ready, sessionOf, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { listed, readS7BMessage, runS7BWait } from '../helpers/S7B-fixture.js';

const worlds: S7B2ConsumeWorld[] = [];
afterEach(async () => { await Promise.all(worlds.splice(0).map(consume => consume.world.close())); });

/** The one heartbeat trigger: register the barrier, clear the frozen throttle, then await the real pass. */
async function heartbeat(consume: S7B2ConsumeWorld): Promise<void> {
  const settled = consume.world.consumeBarrier();
  consume.world.clock.advance(25);
  await settled;
}

/** The person's own message in the Session's inbox (host human sender), read through `messages/inbox`. */
async function personMessageOf(consume: S7B2ConsumeWorld, session: S6ASession): Promise<SessionMessage | undefined> {
  return (await listed(consume.world, 'inbox', session))
    .find(message => message.sender.kind === 'host' && message.sender.actor.kind === 'human');
}

/** The sender's responded message: the outbox read the row uses (no store read and no hand-made ref). */
async function respondedOf(consume: S7B2ConsumeWorld, session: S6ASession): Promise<SessionMessage | undefined> {
  return (await listed(consume.world, 'outbox', session)).find(message => message.response !== null);
}

/** The response input the Host accepted on a sender's ordinary late reply, from the outbox message itself. */
async function acceptedResponseParts(consume: S7B2ConsumeWorld, sender: S6ASession): Promise<string[]> {
  const sent = await respondedOf(consume, sender);
  if (sent === undefined) return [];
  return (sent.acceptedInputs ?? []).filter(input => input.part === 'response').map(input => input.part);
}

it('opens 8 then 2 Sessions, skips the two reasons and turns on the person message first', async () => {
  const consume = await openS7B2ConsumeWorld();
  worlds.push(consume);
  const { world, eligible, notify, unmatchedRole, goalLess } = consume;
  // Every consultation and intervention answers from the world's scripted provider; the count is its `calls()`.
  world.scriptReplies(Array.from({ length: 30 }, (_, index) => ({
    kind: 'text' as const, text: `S7B2 consume answer ${index + 1}` })));

  // C's view returns eight candidate Sessions per page; the notify-only line is within the next eight items after
  // page 1's last key, so heartbeat 2's measured page contains it (not a Session the row merely never asks to read).
  const sessionKeyOf = (session: S6ASession): string => plainSessionRefKey(session.ref);
  const sessionKeys = (await world.listSessions()).map(card => plainSessionRefKey({
    projectId: card.record.ref.projectId, sessionId: card.record.ref.sessionId })).sort();
  const pageTwo = sessionKeys.filter(key => key > sessionKeyOf(eligible[7]!)).slice(0, 8);
  expect(pageTwo).toContain(sessionKeyOf(notify));

  // Heartbeat 1: exactly the first eight eligible Sessions open one consultation turn.
  const callsBefore = world.model.calls();
  await heartbeat(consume);
  expect(world.model.calls() - callsBefore).toBe(8);
  for (const session of eligible.slice(0, 8)) {
    expect((await personMessageOf(consume, session))?.status).toBe('responded');
  }
  for (const session of eligible.slice(8)) {
    expect((await personMessageOf(consume, session))?.status).toBe('pending');
  }
  expect(world.host.consumeStatus).toEqual([]);

  // Heartbeat 2: exactly the remaining two eligible Sessions open. Its page also scans the notify-only line (0 model
  // calls) and returns the two skip reasons; the two ordinary late replies are the other turns this page can offer.
  await heartbeat(consume);
  for (const session of eligible) {
    expect((await personMessageOf(consume, session))?.status).toBe('responded');
  }
  expect(await consume.world.scripted.requests(notify)).toHaveLength(0);
  expect(await consume.world.scripted.requests(unmatchedRole)).toHaveLength(0);
  expect(await consume.world.scripted.requests(goalLess)).toHaveLength(0);
  expect(world.host.consumeStatus).toHaveLength(2);
  expect(world.host.consumeStatus).toContainEqual({ sessionRef: unmatchedRole.ref, reason: 'no_profile' });
  expect(world.host.consumeStatus).toContainEqual({ sessionRef: goalLess.ref, reason: 'no_goal' });

  // Heartbeat 3: the wrapped remainder. Both ordinary late replies carry the accepted response input; the two
  // skipped lines never turned, so their messages are still pending with no accepted input.
  await heartbeat(consume);
  expect(await acceptedResponseParts(consume, consume.replies[0])).toEqual(['response']);
  expect(await acceptedResponseParts(consume, consume.replies[1])).toEqual(['response']);
  const skipped = [await personMessageOf(consume, unmatchedRole), await personMessageOf(consume, goalLess)];
  expect(skipped.every(message => message?.status === 'pending')).toBe(true);
  for (const message of skipped) expect(message!.acceptedInputs ?? []).toEqual([]);

  // Person first: a yielded line gives the person's intervention a real released prior Run; one released agent
  // action_request lands in the same Session. The person message must be the one turn and the agent one stays queued.
  const wait = await runS7BWait(world, { label: 's7b2-h-person-first' });
  const person = committed<SessionMessage>(await world.post('messages/send', graphWrite(S6A_SCOPE, {
    recipient: wait.sender.ref, text: 'S7B2 H person first', intent: 'action_request', needsReply: true,
    goalRef: wait.goal, taskRef: wait.tasks[0]!,
  }, 's7b2-h-person-first-person')), 'the person message');
  // The released agent action_request: a real Work Run on its own Goal/Task sends it, then the person releases it.
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  const agentGoal = (await main.createGoal('s7b2-h-person-first-agent', 'S7B2 H agent goal')).ref;
  const agentPlan = await adoptS6BPlan(main, agentGoal, { label: 's7b2-h-person-first-agent',
    taskIds: ['s7b2-h-person-first-agent-task'], role: S6A_WORK_ROLE.templateId });
  const agentLine = await sessionOf(world, await createS6BLine(main, { label: 's7b2-h-person-first-agent-line',
    role: S6A_WORK_ROLE, tasks: [agentPlan.tasks[0]!] }));
  await setS7AAutonomy(world, agentGoal, 'after_plan_confirmation');
  const basis = ready<import('../../src/contracts/ledger.js').DispatchBasisV1>(await world.post('goals/dispatch-basis',
    plain(S6A_SCOPE, { goalRef: agentGoal })), 'the agent dispatch basis');
  await world.scripted.script(agentLine, [{ kind: 'calls', calls: [{ callId: 's7b2-h-person-first-agent',
    name: 'send_session_message', args: { recipient: wait.sender.ref, text: 'S7B2 H agent action request',
      intent: 'action_request', needsReply: true, expected: basis } }] }, { kind: 'text', text: 'S7B2 H agent sent' }]);
  const next = await advanceUntil(world.ag2b, { schemaVersion: 1, goalRef: agentGoal,
    flowId: 's7b2-h-person-first-agent', sessionHint: agentLine.ref, kind: 'select_work',
    taskId: agentPlan.tasks[0]!.taskId }, 'claim_task');
  await driveWorkflow(world.ag2b, next, { stopBefore: 'open_checks' });
  const actionRequest = (await listed(consume.world, 'inbox', wait.sender))
    .find(message => message.sender.kind === 'work_run' && message.intent === 'action_request');
  if (actionRequest === undefined) throw new Error('S7B2: the agent action_request is not in the target inbox');
  expect(actionRequest.release).toBe('released');
  await world.scripted.script(wait.sender, [{ kind: 'text', text: 'S7B2 consume person-first answer' }]);
  for (let pass = 0; pass < 6; pass += 1) {
    await heartbeat(consume);
    const read = await readS7BMessage(consume.world, person.ref);
    if ((read.acceptedInputs ?? []).some(input => input.part === 'message')) break;
  }
  const personRead = await readS7BMessage(consume.world, person.ref);
  expect((personRead.acceptedInputs ?? []).some(input => input.part === 'message')).toBe(true);
  expect((await readS7BMessage(consume.world, actionRequest.ref)).acceptedInputs ?? []).toEqual([]);
}, 120_000);
