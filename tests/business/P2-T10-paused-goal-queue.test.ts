/**
 * P2 T10 (frozen `p2-frozen.md` line 325): messages addressed to a paused Goal are accepted and
 * queued, not refused; while the Goal is paused nothing is delivered, and after resume each
 * message is delivered once. The frozen mutation is “暂停当场拒” (`message-machine.ts:583`).
 *
 * Public entry: one S6A Host world with two Goals; a real Work Run in the active Goal sends through
 * `send_session_message` to a line of the paused Goal; `goals/control` pauses/resumes; the reads are
 * `messages/view`, `messages/outbox` and `sessions/queries`. The expiry/reply-to-a-running-Run half
 * has no public delivery observation in this tree and is reported blocked, not replaced.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionMessageReadV1 } from '../../src/contracts/mailbox.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import { advanceUntil, driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { sessionQueries } from '../helpers/IV-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine } from '../helpers/S6B1-fixture.js';
import { openS7BWorld } from '../helpers/S7B-fixture.js';
import { pauseS7AGoal, ready, resumeS7AGoal, sessionOf } from '../helpers/S7A-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { toolOutputJson } from '../scenarios/support/common.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

type Line = Awaited<ReturnType<typeof sessionOf>>;

async function planFor(ws: ReturnType<typeof s6aCardsWorkspace>, label: string): Promise<{ goal: GoalRef; tasks: readonly TaskTriple[] }> {
  const goal = (await ws.createGoal(`p2-${label}-goal`, `P2 ${label} goal`)).ref;
  const { tasks } = await adoptS6BPlan(ws, goal, {
    label: `p2-${label}`, taskIds: [`p2-${label}-a`], role: S6A_WORK_ROLE.templateId,
  });
  return { goal, tasks };
}

async function lineFor(ws: ReturnType<typeof s6aCardsWorkspace>, world: S6AHostWorld, label: string,
  tasks: readonly TaskTriple[]): Promise<Line> {
  return await sessionOf(world, await createS6BLine(ws, { label: `p2-${label}-line`, role: S6A_WORK_ROLE, tasks }));
}

describe('P2 T10: a paused Goal queues, then delivers once', () => {
  it('an agent send to a paused Goal with a known work line is accepted, not refused busy', async () => {
    const opened = await openS7BWorld({ backend: 'memory' });
    worlds.push(opened.world);
    const world = opened.world;
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    const active = await planFor(ws, 't10-red-a');
    const paused = await planFor(ws, 't10-red-p');
    const sender = await lineFor(ws, world, 't10-red-a', active.tasks);
    const target = await lineFor(ws, world, 't10-red-p', paused.tasks);
    // Give the paused Goal's line a real Work fact first: this is what makes a send owner
    // resolve the recipient's Goal (and therefore the pause) at send time.
    await world.scripted.script(target, [{ kind: 'text', text: 'P2 T10 target first turn' }]);
    const targetClaim = await advanceUntil(world.ag2b, {
      schemaVersion: 1, goalRef: paused.goal, flowId: 'p2-t10-red-p', sessionHint: target.ref,
      kind: 'select_work', taskId: paused.tasks[0]!.taskId,
    }, 'claim_task');
    await driveWorkflow(world.ag2b, targetClaim, { stopBefore: 'open_checks' });
    await pauseS7AGoal(world, paused.goal);

    await world.scripted.script(sender, [
      { kind: 'calls', calls: [{ callId: 't10-paused-send', name: 'send_session_message', args: {
        recipient: target.ref, text: 'P2 T10 message to a paused Goal', needsReply: true,
      } }] },
      { kind: 'text', text: 'P2 T10 red sender done' },
    ]);
    const claim = await advanceUntil(world.ag2b, {
      schemaVersion: 1, goalRef: active.goal, flowId: 'p2-t10-red', sessionHint: sender.ref,
      kind: 'select_work', taskId: active.tasks[0]!.taskId,
    }, 'claim_task');
    await driveWorkflow(world.ag2b, claim, { stopBefore: 'open_checks' });
    const requests = await world.scripted.requests(sender);
    expect(toolOutputJson(requests[1], 't10-paused-send'),
      'T10: a message to a paused Goal is accepted, not refused busy').toMatchObject({ status: 'committed' });
  }, 180_000);

  it('accepts both messages while paused, delivers neither, and delivers each once after resume', async () => {
    const opened = await openS7BWorld({ backend: 'memory' });
    worlds.push(opened.world);
    const world = opened.world;
    const ws = s6aCardsWorkspace(world, S6A_SCOPE);
    const active = await planFor(ws, 't10-a');
    const paused = await planFor(ws, 't10-p');
    const sender = await lineFor(ws, world, 't10-a', active.tasks);
    const target = await lineFor(ws, world, 't10-p', paused.tasks);
    await pauseS7AGoal(world, paused.goal);

    await world.scripted.script(sender, [
      { kind: 'calls', calls: [
        { callId: 't10-reply', name: 'send_session_message', args: {
          recipient: target.ref, text: 'P2 T10 needs a reply', needsReply: true,
        } },
        { callId: 't10-notify', name: 'send_session_message', args: {
          recipient: target.ref, text: 'P2 T10 no reply needed', needsReply: false,
        } },
      ] },
      { kind: 'text', text: 'P2 T10 sender done' },
    ]);
    const claim = await advanceUntil(world.ag2b, {
      schemaVersion: 1, goalRef: active.goal, flowId: 'p2-t10', sessionHint: sender.ref,
      kind: 'select_work', taskId: active.tasks[0]!.taskId,
    }, 'claim_task');
    await driveWorkflow(world.ag2b, claim, { stopBefore: 'open_checks' });

    const requests = await world.scripted.requests(sender);
    const first = toolOutputJson(requests[1], 't10-reply');
    // First P2 assertion: sending to a paused Goal is accepted and queued, never refused in place.
    expect(first, 'T10: a message to a paused Goal is accepted').toMatchObject({ status: 'committed' });
    const second = toolOutputJson(requests[1], 't10-notify');
    expect(second, 'T10: the second message to a paused Goal is accepted').toMatchObject({ status: 'committed' });

    const outbox = ready<{ items: SessionMessageReadV1['message'][] }>(await world.post('messages/outbox',
      plain(S6A_SCOPE, { senderSession: sender.ref, page: { limit: 20 } })), 'the T10 sender outbox');
    const messages = outbox.items.filter(item => item.recipient && 'sessionId' in item.recipient
      && item.recipient.sessionId === target.ref.sessionId);
    expect(messages.map(item => item.ref.messageId), 'T10: both paused-Goal messages are saved')
      .toHaveLength(2);
    for (const message of messages) {
      const view = ready<SessionMessageReadV1>(await world.post('messages/view',
        plain(S6A_SCOPE, message.ref)), 'the queued T10 message');
      expect(view.delivery.delivery, 'T10: a paused-Goal message stays queued while paused').toBe('queued');
    }
    // Nothing is delivered to the paused line: no Query and no model request.
    expect((await sessionQueries(world, target)).length, 'T10: the paused line opens no Query').toBe(0);
    expect(await world.scripted.requests(target), 'T10: the paused line serves no model request').toHaveLength(0);

    await resumeS7AGoal(world, paused.goal);
    await world.scripted.script(target, [{ kind: 'text', text: 'P2 T10 target done' }]);
    const targetClaim = await advanceUntil(world.ag2b, {
      schemaVersion: 1, goalRef: paused.goal, flowId: 'p2-t10-resume', sessionHint: target.ref,
      kind: 'select_work', taskId: paused.tasks[0]!.taskId,
    }, 'claim_task');
    await driveWorkflow(world.ag2b, targetClaim, { stopBefore: 'open_checks' });

    const targetRequests = await world.scripted.requests(target);
    expect(targetRequests.length, 'T10: the resumed line serves one real model request').toBeGreaterThan(0);
    const firstRequest = targetRequests[0]!;
    const text = firstRequest.messages.map(message =>
      'content' in message && typeof message.content === 'string' ? message.content : '').join('\n');
    for (const marker of ['P2 T10 needs a reply', 'P2 T10 no reply needed']) {
      expect(text.split(marker).length - 1, `T10: ${marker} is delivered exactly once after resume`).toBe(1);
    }
    for (const message of messages) {
      const after = ready<SessionMessageReadV1>(await world.post('messages/view',
        plain(S6A_SCOPE, message.ref)), 'the delivered T10 message');
      expect(after.delivery.delivery, 'T10: the resumed message is delivered').toBe('delivered');
    }
  }, 180_000);
});
