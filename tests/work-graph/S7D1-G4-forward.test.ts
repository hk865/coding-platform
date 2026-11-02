/**
 * G4-forward: a message sent to a line of the second workspace is forwarded, in the same project, from that
 * workspace to a line of the first workspace; the copy keeps the
 * original body ref, and `messages/body` in the receiving workspace returns the exact original text (the
 * material workspace lift). A cross-project target stays `invalid`/`cross_workspace_forward`. The message is
 * undelivered because its recipient line is archived first.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MessageBody, SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { S6A_SECRETARY_ROLE } from '../helpers/S6A-request-fixture.js';
import { archiveS7D1Line, openS7D1ProjectCardWorld } from '../helpers/S7D1-project-card-world.js';
import { ready } from '../helpers/S7A-fixture.js';

/** The one original text the row asserts back. */
const BODY_TEXT = 'S7D1 G4 forward original body text';

describe('the same-project forward into the other workspace', () => {
  let opened: Awaited<ReturnType<typeof openS7D1ProjectCardWorld>>;
  beforeAll(async () => { opened = await openS7D1ProjectCardWorld({ backend: 'memory' }); }, 180_000);
  afterAll(async () => { await opened?.world.close(); });

  it('forwards to the other workspace and reads the exact original body there, while a cross-project target stays refused', async () => {
    // A real Run in A sends the original message to an A line, which is archived before the forward.
    const recipient = await createS6BLine(opened.a, { label: 's7d1-forward-recipient', role: S6A_SECRETARY_ROLE });
    const task = opened.lines.scribe.nextTask();
    opened.world.scriptReplies([
      { kind: 'calls', calls: [{ callId: 's7d1-g4-forward-send', name: 'send_session_message',
        args: { recipient: recipient.ref, text: BODY_TEXT, intent: 'inquiry', needsReply: true } }] },
      { kind: 'text', text: 'S7D1 G4 forward sent' },
    ]);
    await driveWorkflow(opened.world.ag2b, { schemaVersion: 1, goalRef: opened.lines.scribe.goal,
      flowId: 's7d1-g4-forward-send', sessionHint: opened.lines.scribe.line.ref, kind: 'select_work',
      taskId: task.taskId });
    const outbox = ready<{ items: SessionMessage[] }>(await opened.a.route('messages/outbox', {
      senderSession: opened.lines.scribe.line.ref, page: { limit: 10 },
    }), 'the sender outbox');
    const sent = outbox.items.find((candidate) => {
      const to = candidate.recipient;
      return !('kind' in to) && to.sessionId === recipient.ref.sessionId;
    });
    if (sent === undefined) throw new Error(`the original message is not in the sender outbox: ${JSON.stringify(outbox.items)}`);
    await archiveS7D1Line(opened.a, recipient, 'forward-recipient');

    // A forwards the original to a live B line: the copy is written in B, the sender line stays in A.
    const bTarget = await createS6BLine(opened.b, { label: 's7d1-forward-b-target', role: S6A_SECRETARY_ROLE });
    const first = await opened.a.route('messages/forward', {
      commandId: 's7d1-g4-forward-a-to-b', messageRef: sent.ref, to: bTarget.ref,
    });
    expect(first).toMatchObject({ status: 'forwarded' });
    const inB = (first as { message: SessionMessage }).message;
    expect(inB.originalRef).toEqual(sent.ref);
    expect(inB.ref.workspaceId).toBe(opened.b.scope.workspaceId);
    await archiveS7D1Line(opened.b, bTarget, 'forward-b-target');

    // A cross-project target keeps the old refusal before any destination read (the B copy stays unfowarded).
    expect(await opened.b.route('messages/forward', {
      commandId: 's7d1-g4-forward-foreign', messageRef: inB.ref,
      to: { projectId: 's7d1-other-project', sessionId: 's7d1-other-session' },
    })).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'cross_workspace_forward' });

    // B forwards the copy to a live line of the first workspace: the receiving workspace is A and the sender
    // line B reads is the scribe's in A, not B's own context.
    const forwarded = await opened.b.route('messages/forward', {
      commandId: 's7d1-g4-forward-b-to-a', messageRef: inB.ref, to: opened.lines.adviser.ref,
    });
    expect(forwarded).toMatchObject({ status: 'forwarded' });
    const copy = (forwarded as { message: SessionMessage }).message;
    expect(copy.originalRef).toEqual(inB.ref);
    expect(copy.ref.workspaceId).toBe(opened.a.scope.workspaceId);

    // B reads the original body, which is stored in A: the material workspace lift opens it here.
    const body = ready<MessageBody>(await opened.b.route('messages/body', {
      messageRef: inB.ref, part: 'message',
    }), 'the receiving body read');
    expect(body.text).toBe('S7D1 G4 forward original body text');
  });
});
