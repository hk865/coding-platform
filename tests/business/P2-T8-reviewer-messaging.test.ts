/**
 * P2 T8 (frozen `p2-frozen.md` line 323): an agent may not send a reviewer a message that needs a
 * reply, a reviewer may send only “请知悉”, a no-reply message to a reviewer is accepted, and a
 * person's direct message is unchanged. Every expected literal is the frozen row's own.
 *
 * Public entry: the PL Host world (`openPLWorkflowWorld`), a real Work Run's
 * `send_session_message`, the person's `messages/send`, `messages/view`, `messages/outbox`.
 * The reviewer's own send has no mounted entry in this tree (reviewer Query rounds build no
 * mailbox tools), so that row is attempted through the named scripted tool call and reported
 * red at “入口还没有”, never replaced by an owner stand-in.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { SessionMessageReadV1 } from '../../src/contracts/mailbox.js';
import { advanceUntil, driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { P2_COORDINATION_TOOL_NAMES, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { committed, ready } from '../helpers/S7A-fixture.js';
import { sessionOf } from '../helpers/S7A-fixture.js';
import { responsibleLinkRef } from '../../src/core/work-graph/sessions/session-responsibility-service.js';
import { toolOutputJson } from '../scenarios/support/common.js';
import { waitFor } from '../scenarios/harness.js';
import {
  adoptPLTwoStageSkeleton, createPLReviewerLine, openPLWorkflowWorld, type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';

const NEEDS_REPLY = '审阅者不回复（C23），要回复请发给参谋或秘书';
const OVERREACH = '独立审阅只发请知悉';

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });

async function world(label: string) {
  const workflow = opened = await openPLWorkflowWorld({ label, tools: P2_COORDINATION_TOOL_NAMES });
  const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, {
    label, stageOneTaskIds: [`${label}-a`],
  });
  const sender = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: `${label}-sender`, role: S6A_WORK_ROLE,
    tasks: skeleton.tasks.filter(task => task.taskId === `${label}-a`),
  }));
  const reviewer = await createPLReviewerLine(workflow.world, workflow.main, `${label}-reviewer`);
  // The public `sessions/link` route gives the reviewer the Goal link the consume page needs.
  const card = await workflow.world.readSession(reviewer.ref);
  const target = { kind: 'goal' as const, ref: workflow.goal };
  committed(await workflow.world.post('sessions/link', graphWrite(S6A_SCOPE, {
    sessionRef: reviewer.ref, target, relation: 'responsible', active: true,
  }, `p2-t8-link-${label}`, [
    { ref: card.record.ref, revision: card.record.revision },
    { ref: responsibleLinkRef(reviewer.ref, target), revision: 0 },
  ])), 'the reviewer Goal link');
  return { workflow, sender, reviewer, taskId: `${label}-a` };
}

describe('P2 T8: reviewer messaging', () => {
  it('an agent message to the reviewer that needs a reply is refused with the frozen sentence', async () => {
    const { workflow, sender, reviewer, taskId } = await world('p2-t8');
    await workflow.world.scripted.script(sender, [
      { kind: 'calls', calls: [
        { callId: 't8-needs-reply', name: 'send_session_message', args: {
          recipient: reviewer.ref, text: 'P2 T8 needs a reply', needsReply: true,
        } },
        { callId: 't8-notify', name: 'send_session_message', args: {
          recipient: reviewer.ref, text: 'P2 T8 only for information', needsReply: false,
        } },
      ] },
      { kind: 'text', text: 'P2 T8 sender done' },
    ]);
    const claim = await advanceUntil(workflow.world.ag2b, {
      schemaVersion: 1, goalRef: workflow.goal, flowId: 'p2-t8', sessionHint: sender.ref,
      kind: 'select_work', taskId,
    }, 'claim_task');
    await driveWorkflow(workflow.world.ag2b, claim, { stopBefore: 'open_checks' });

    const requests = await workflow.world.scripted.requests(sender);
    const refused = toolOutputJson(requests[1], 't8-needs-reply');
    expect(refused, `T8: a needs-reply send to the reviewer must be refused with ${NEEDS_REPLY}`)
      .toMatchObject({ status: 'rejected', reason: NEEDS_REPLY });
    const notified = toolOutputJson(requests[1], 't8-notify');
    expect(notified, 'T8: the no-reply message to the reviewer is accepted').toMatchObject({ status: 'committed' });

    // The refused message wrote nothing; the notify one did, and both are readable through the
    // public reads (the refused one does not exist).
    const outbox = ready<{ items: SessionMessage[] }>(await workflow.world.post('messages/outbox',
      plain(S6A_SCOPE, { senderSession: sender.ref, page: { limit: 20 } })), 'the T8 sender outbox');
    const sent = outbox.items.filter(item => item.sender.kind === 'work_run');
    expect(sent.map(item => item.ref.messageId), 'T8: only the no-reply letter was saved').toHaveLength(1);
    const view = ready<SessionMessageReadV1>(await workflow.world.post('messages/view',
      plain(S6A_SCOPE, sent[0]!.ref)), 'the T8 notify message');
    expect(view.message.recipient, 'T8: the accepted letter is addressed to the reviewer').toEqual(reviewer.ref);
    expect(view.message.needsReply, 'T8: the accepted letter needs no reply').not.toBe(true);
  }, 120_000);

  it('the person\'s direct message to the reviewer is unchanged', async () => {
    const { workflow, reviewer } = await world('p2-t8-person');
    const answer = await workflow.world.post('messages/send', graphWrite(S6A_SCOPE, {
      recipient: reviewer.ref, text: 'P2 T8 the person writes', needsReply: true,
    }, 'p2-t8-person-send', []));
    expect(answer.body, 'T8: the person\'s direct message is accepted').toMatchObject({ status: 'committed' });
    const value = (answer.body as { value?: { ref?: SessionMessage['ref'] } }).value;
    if (value?.ref === undefined) throw new Error(`T8: the person send has no ref: ${JSON.stringify(answer.body)}`);
    const view = ready<{ message: SessionMessage }>(await workflow.world.post('messages/view',
      plain(S6A_SCOPE, value.ref)), 'the person message');
    expect(view.message.sender, 'T8: the person message keeps the host human sender').toMatchObject({ kind: 'host' });
    expect(view.message.needsReply, 'T8: the person message may still need a reply').toBe(true);
  }, 60_000);

  it('the reviewer\'s own needs-reply send is refused (attempted; the Host consume loop does not run)', async () => {
    const { workflow, sender, reviewer, taskId } = await world('p2-t8-overreach');
    // The reviewer line is woken by an ordinary no-reply letter; its text round is the only place
    // the frozen row's `send_session_message` entry can be attempted today.
    // The reviewer's text round is opened by the Host consumer from a real AGENT wake: design §2.3's table admits a
    // `work_run`/`secretary_round`/`query_run` message (or a platform system one) with a Goal; a Host human message
    // without `entry` is a plain notify and opens no round. The sender line's own Run sends the wake, then the
    // reviewer's consumer profile opens its text round on the next measured pass.
    await workflow.world.scripted.script(reviewer, [
      { kind: 'calls', calls: [{ callId: 't8-overreach', name: 'send_session_message', args: {
        recipient: sender.ref, text: 'P2 T8 reviewer overreach', needsReply: true,
      } }] },
      { kind: 'text', text: 'P2 T8 reviewer done' },
    ]);
    await workflow.world.scripted.script(sender, [
      { kind: 'calls', calls: [{ callId: 't8-wake', name: 'send_session_message', args: {
        recipient: reviewer.ref, text: 'P2 T8 wake the reviewer', needsReply: false, wake: true,
      } }] },
      { kind: 'text', text: 'P2 T8 sender woke the reviewer' },
    ]);
    const claim = await advanceUntil(workflow.world.ag2b, {
      schemaVersion: 1, goalRef: workflow.goal, flowId: 'p2-t8-overreach', sessionHint: sender.ref,
      kind: 'select_work', taskId,
    }, 'claim_task');
    await driveWorkflow(workflow.world.ag2b, claim, { stopBefore: 'open_checks' });
    // The fixture clock drives the Host's consume loop: each poll registers the barrier, advances 25 ms and waits
    // for a real pass (S7A-host-gates:57–:67); a wall-clock poll alone never wakes the loop.
    const requests = await waitFor(async () => {
      const settled = workflow.world.consumeBarrier();
      workflow.world.clock.advance(25);
      await settled;
      return await workflow.world.scripted.requests(reviewer);
    }, found => found.length > 1, 'the reviewer text round');
    expect(requests.length, 'T8: the reviewer send entry is mounted')
      .toBeGreaterThan(0);
    const refused = toolOutputJson(requests.at(-1)!, 't8-overreach');
    expect(refused, `T8: the reviewer's overreach must be refused with ${OVERREACH}`)
      .toMatchObject({ status: 'rejected', reason: OVERREACH });
  }, 120_000);
});
