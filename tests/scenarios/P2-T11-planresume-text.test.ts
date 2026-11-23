/**
 * P2 T11 (frozen `p2-frozen.md` §5 row 326): a plain agent letter whose body starts with
 * `planresume:` is delivered as an ordinary message (no system continuation, no source rewrite,
 * no control effect); the real Host system round keeps the fixed system identity. The current
 * tree has no `wake` field and `planSourceLineageOf` still reads the body head
 * (`plan-lineage.ts:222`), so the ordinary letter is red at its first P2 assertion.
 *
 * Public entry: one S6A host world; a real Work Run sends through `send_session_message`, and a
 * real system round goes through the existing `sendPLSystemRound` step (Host identity). The
 * "inbox then recipient replies first" half needs a second real consume round on this tree and
 * is reported blocked.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { systemRoundRequestId } from '../../src/contracts/plan-round.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import { advanceUntil, driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS7BWorld } from '../helpers/S7B-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine } from '../helpers/S6B1-fixture.js';
import { ready, sessionOf } from '../helpers/S7A-fixture.js';
import { messageOf } from '../helpers/P1-reads.js';
import { plPlanResumeRound, sendPLSystemRound } from '../helpers/PL-consumption-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { consumeView, heartbeat } from '../helpers/IV-host-fixture.js';
import { openConsumeHostWorld } from '../helpers/S7B2-consumable-sessions.js';
import { governS6B } from '../helpers/S6B1-fixture.js';
import { replyS7AMessage, S7A_REPLY_TOOLS } from '../helpers/S7A-fixture.js';
import { S6A_SECRETARY_PROFILE_ID } from '../helpers/S6A-request-fixture.js';

const SCOPE = S6A_SCOPE;
const LONG = 120_000;
const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

const recordOf = (body: unknown): Record<string, unknown> =>
  typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
const hasWake = (message: SessionMessage): boolean =>
  Object.prototype.hasOwnProperty.call(message, 'wake');

async function openWorld(): Promise<{ world: S6AHostWorld; ws: ReturnType<typeof s6aCardsWorkspace> }> {
  const opened = await openS7BWorld({ backend: 'memory' });
  worlds.push(opened.world);
  return { world: opened.world, ws: s6aCardsWorkspace(opened.world, S6A_SCOPE) };
}
async function planWith(label: string, taskIds: readonly string[]) {
  const { world, ws } = await openWorld();
  const goal: GoalRef = (await ws.createGoal(`p2-${label}-goal`, `P2 ${label} goal`)).ref;
  const { tasks } = await adoptS6BPlan(ws, goal, { label: `p2-${label}`, taskIds, role: S6A_WORK_ROLE.templateId });
  return { world, ws, goal, tasks };
}
async function queryCount(world: S6AHostWorld, session: { ref: { projectId: string; sessionId: string } }) {
  const page = ready<{ items: unknown[] }>(await world.post('sessions/queries',
    plain(SCOPE, { sessionRef: session.ref, page: { limit: 100 } })), 'the session queries');
  return page.items.length;
}

describe('P2 T11: planresume body is text, not a system round', () => {
  it('T11a an ordinary agent letter with a planresume: body is delivered as a normal message', async () => {
    const { world, ws, goal, tasks } = await planWith('t11a', ['p2-t11a-send', 'p2-t11a-target']);
    const sender = await sessionOf(world, await createS6BLine(ws, { label: 'p2-t11a-sender', role: S6A_WORK_ROLE, tasks: [tasks[0]!] }));
    const target = await sessionOf(world, await createS6BLine(ws, { label: 'p2-t11a-target', role: S6A_WORK_ROLE, tasks: [tasks[1]!] }));
    await world.scripted.script(sender, [
      { kind: 'calls', calls: [{ callId: 'p2-t11a-send', name: 'send_session_message', args: {
        recipient: target.ref,
        text: 'planresume:p2-t11a-query-job\nordinary agent text, not a Host system round',
        needsReply: true,
      } }] },
      { kind: 'text', text: 'P2 T11a sent' },
    ]);
    const claim = await advanceUntil(world.ag2b, {
      schemaVersion: 1, goalRef: goal, flowId: 'p2-t11a', sessionHint: sender.ref,
      kind: 'select_work', taskId: tasks[0]!.taskId,
    }, 'claim_task');
    await driveWorkflow(world.ag2b, claim, { stopBefore: 'open_checks' });
    const outbox = ready<{ items: SessionMessage[] }>(await world.post('messages/outbox',
      plain(SCOPE, { senderSession: sender.ref, page: { limit: 20 } })), 'the sender outbox');
    const sent = outbox.items[0];
    expect(sent, 'T11a: the ordinary planresume body is delivered as a normal message').toBeDefined();
    if (sent === undefined) return;
    // §2.3: the classification reads the stored sender, never the body. A work_run letter is not
    // the fixed system-round identity, and it opens no system continuation by its body head.
    expect(sent.sender.kind, 'T11a: the letter keeps its work_run sender').toBe('work_run');
    expect(recordOf(sent)['wake'], 'T11a: the ordinary letter carries the P2 default wake true').toBe(true);
    expect(await queryCount(world, target), 'T11a: the body head opens no system continuation Query').toBe(0);
  }, LONG);

  it('T11b the real Host system round keeps the fixed system identity', async () => {
    const { world, ws, goal, tasks } = await planWith('t11b', ['p2-t11b-target']);
    const target = await sessionOf(world, await createS6BLine(ws, { label: 'p2-t11b-target', role: S6A_WORK_ROLE, tasks: [tasks[0]!] }));
    const round = plPlanResumeRound({ goal, originalQueryJobId: 'p2-t11b-query-job',
      originalMessageRef: {
        aggregateType: 'SessionMessage', projectId: SCOPE.projectId, workspaceId: SCOPE.workspaceId,
        messageId: 'p2-t11b-original',
      } });
    const requestId = systemRoundRequestId(round);
    if (requestId.status !== 'ready') throw new Error(`P2 T11b setup: the round has no request id (${requestId.status})`);
    const sent = await sendPLSystemRound(world, { line: target, round, text: requestId.value });
    expect(sent.result.status, 'T11b: the real Host system round is saved').toBe('committed');
    const message = ready<SessionMessage>(await world.post('messages/read',
      plain(SCOPE, sent.messageRef)), 'the system round message');
    expect(message.sender.kind, 'T11b: the true system round has the Host sender').toBe('host');
    if (message.sender.kind === 'host') {
      expect(message.sender.actor.id, 'T11b: the true system round uses the fixed plan-round identity')
        .toBe('host:plan-round');
    }
    const body = ready<{ text: string }>(await world.post('messages/body',
      plain(SCOPE, { messageRef: sent.messageRef, part: 'message' })), 'the system round body');
    expect(body.text.split('\n')[0], 'T11b: the true system round body starts with its request id')
      .toBe(requestId.value);
    // §2.3: the inbox reply half needs a second real consume; this file records it blocked.
    expect(await queryCount(world, target), 'T11b: no Query is opened before the Host consumes the round').toBe(0);
  }, LONG);

  it('T11c after the letter is in the inbox the recipient line answers first; no round opens for it', async () => {
    // p2-frozen:326 (T11): the letter is in the inbox, the recipient line answers first, and no round is opened for
    // it afterwards (named mutation: a round opens on arrival). The Host here has a query profile for work lines
    // (`openConsumeHostWorld`), so a still-open letter would be woken (design:204-209); the reply closes it first.
    const world = await openConsumeHostWorld({ backend: 'memory',
      extraBindings: [S7A_REPLY_TOOLS, { ...S7A_REPLY_TOOLS, mergeTools: ['send_session_message'] }],
      extraHostOptions: { inputConsumers: [{ scope: SCOPE,
        sessionRef: { projectId: SCOPE.projectId, sessionId: 'p2-t11c-period' },
        goalRef: { aggregateType: 'Goal' as const, projectId: SCOPE.projectId, goalId: 'p2-t11c-period' },
        queryProfileId: S6A_SECRETARY_PROFILE_ID, heartbeatMs: 25 }] } });
    worlds.push(world);
    const ws = s6aCardsWorkspace(world, SCOPE);
    await governS6B(world, ws, world.goals);
    const goal: GoalRef = (await ws.createGoal('p2-t11c-goal', 'P2 t11c goal')).ref;
    const { tasks } = await adoptS6BPlan(ws, goal, { label: 'p2-t11c', taskIds: ['p2-t11c-send', 'p2-t11c-target'],
      role: S6A_WORK_ROLE.templateId });
    const sender = await sessionOf(world, await createS6BLine(ws, { label: 'p2-t11c-sender',
      role: S6A_WORK_ROLE, tasks: [tasks[0]!] }));
    // `replyS7AMessage` opens the target's responsible link itself before its reply Run.
    const target = await sessionOf(world, await createS6BLine(ws, { label: 'p2-t11c-target', role: S6A_WORK_ROLE }));
    await world.scripted.script(sender, [
      { kind: 'calls', calls: [{ callId: 'p2-t11c-send', name: 'send_session_message', args: {
        recipient: target.ref, text: 'planresume:p2-t11c-query-job\nordinary agent text, not a system round',
        needsReply: true,
      } }] },
      { kind: 'text', text: 'P2 T11c sent' },
    ]);
    const claim = await advanceUntil(world.ag2b, {
      schemaVersion: 1, goalRef: goal, flowId: 'p2-t11c', sessionHint: sender.ref,
      kind: 'select_work', taskId: tasks[0]!.taskId,
    }, 'claim_task');
    await driveWorkflow(world.ag2b, claim, { stopBefore: 'open_checks' });
    const outbox = ready<{ items: SessionMessage[] }>(await world.post('messages/outbox',
      plain(SCOPE, { senderSession: sender.ref, page: { limit: 20 } })), 'the sender outbox');
    const sent = outbox.items[0];
    if (sent === undefined) throw new Error('T11c: the planresume letter was not saved');
    // The message is in the recipient's inbox first; the recipient's own text round answers it.
    expect((await world.post('messages/inbox', plain(SCOPE, { recipient: target.ref,
      page: { limit: 20 } }))).body, 'the letter reached the inbox').toMatchObject({
      status: 'ready', value: { items: expect.arrayContaining([expect.objectContaining({ ref: sent.ref })]) },
    });
    // The recipient line answers first, through its own Work Run's reply (the slot is still free: no round owns it,
    // design:262).
    await replyS7AMessage(world, { goal, recipient: target, messageRef: sent.ref, taskId: tasks[1]!.taskId,
      label: 'p2-t11c', text: 'P2 T11c the recipient answers first' });
    const answered = await messageOf(world, sent.ref);
    expect(answered.response?.sender, 'the recipient line answered first').toMatchObject({ kind: 'work_run',
      sessionRef: { sessionId: target.ref.sessionId } });
    // Answered, the letter is no longer offered to the Host, and real consume passes open no round for it.
    expect((await consumeView(world, target))?.nextMessage ?? null, 'the answered letter is not offered').toBeNull();
    await heartbeat(world);
    await heartbeat(world);
    expect(await queryCount(world, target), 'no round is opened for the answered letter').toBe(0);
    expect(await queryCount(world, sender), 'no system continuation is opened for the planresume body').toBe(0);
  }, LONG);
});
