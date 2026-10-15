/**
 * Slice 2C row 2C-11 (LE3): the waiting-reply transitions (T3b/T7, P17, P18).
 *
 * The fixture builds real claims, entries and Run results through the real
 * WorkGraph owners; the pause/cancel pointer is a real `RunControlPort.submitControl`
 * on the ended (yielded) Run. Assertions read only the public `WorkLineReadPort`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import { openLineFixture, rowOf, type LineFixture } from '../helpers/S2C-L-line-support.js';
import { waitContinuation, yieldedEvent } from '../helpers/S2C-L-runs-support.js';

function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`expected ready, got ${JSON.stringify(result)}`);
  return result.value;
}

function waitRef(projectId: string, workspaceId: string, messageId: string): SessionMessageRef {
  return { aggregateType: 'SessionMessage', projectId, workspaceId, messageId };
}

describe.each(['memory', 'sqlite'] as const)('2C-11 waiting reply transitions (%s)', (kind) => {
  const open: LineFixture[] = [];
  afterEach(async () => { for (const fixture of open.splice(0)) await fixture.close(); });
  async function lineFixture(): Promise<LineFixture> {
    const fixture = await openLineFixture(kind);
    open.push(fixture);
    return fixture;
  }

  it('2C-11 (1) a yielded Run reads waiting_reply', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g11-yield', [{ taskId: 'w', title: 'W task' }]);
    const head = (await f.createSession('s11-yield')).ref;
    await f.link(head, { kind: 'task', ref: goal.tasks['w']! }, 'responsible', true);
    const claim = await f.claim('w', head, goal);
    await f.runs.enter(claim.claim);
    await f.runs.recordResult(claim.claim, yieldedEvent(claim.claim, 'yield'),
      waitContinuation(claim.claim, waitRef(head.projectId, f.base.scope.workspaceId, 'w11-yield')));
    const row = rowOf(ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.status.own).toBe('waiting_reply');
    expect(row?.status.ownReason.code).toBe('waiting_reply');
    expect(row?.status.attention).toBeNull();
  });

  it('2C-11 (2) pausing while waiting reads paused (paused_yielded), and continuation_paused is not an attention', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g11-pause', [{ taskId: 'w', title: 'W task' }]);
    const head = (await f.createSession('s11-pause')).ref;
    await f.link(head, { kind: 'task', ref: goal.tasks['w']! }, 'responsible', true);
    const claim = await f.claim('w', head, goal);
    await f.runs.enter(claim.claim);
    await f.runs.recordResult(claim.claim, yieldedEvent(claim.claim, 'pause'),
      waitContinuation(claim.claim, waitRef(head.projectId, f.base.scope.workspaceId, 'w11-pause')));
    await f.runs.submitControl(claim.claim, 'pause');
    const row = rowOf(ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.status.own).toBe('paused');
    expect(row?.status.ownReason.code).toBe('paused_yielded');
    expect(row?.status.attention).toBeNull();
    expect(row?.status.attentionCounts).toEqual({ decide: 0, failed: 0, blocked: 0, unknown: 0 });
  });

  it('2C-11 (3) cancelling while waiting stops waiting and gives the failed continuation_cancelled attention', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g11-cancel', [{ taskId: 'w', title: 'W task' }]);
    const head = (await f.createSession('s11-cancel')).ref;
    await f.link(head, { kind: 'task', ref: goal.tasks['w']! }, 'responsible', true);
    const claim = await f.claim('w', head, goal);
    await f.runs.enter(claim.claim);
    await f.runs.recordResult(claim.claim, yieldedEvent(claim.claim, 'cancel'),
      waitContinuation(claim.claim, waitRef(head.projectId, f.base.scope.workspaceId, 'w11-cancel')));
    await f.runs.submitControl(claim.claim, 'cancel');
    const row = rowOf(ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.status.own).toBe('standby');
    expect(row?.status.own).not.toBe('waiting_reply');
    expect(row?.status.attention?.code).toBe('failed');
    expect(row?.status.attention?.reason.code).toBe('continuation_cancelled');
  });

  it('2C-11 (5) the waiting_reply reason names the continuation message recipient', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g11-recipient', [{ taskId: 'w', title: 'W task' }]);
    const head = (await f.createSession('s11-recipient')).ref;
    const recipient = (await f.createSession('s11-recipient-to')).ref;
    await f.link(head, { kind: 'task', ref: goal.tasks['w']! }, 'responsible', true);
    const mailbox = f.runs.mailbox();
    const sent = await mailbox.sendMessage(f.ctx, { input: { recipient, text: 'S2C-L wait',
      intent: 'inquiry', needsReply: true }, meta: { requestId: 's2c-l-wait-recipient', expected: [] } });
    if (sent.status !== 'committed') throw new Error(`send failed: ${JSON.stringify(sent)}`);
    const claim = await f.claim('w', head, goal);
    await f.runs.enter(claim.claim);
    await f.runs.recordResult(claim.claim, yieldedEvent(claim.claim, 'recipient'), waitContinuation(claim.claim, sent.value.ref));

    const row = rowOf(ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.status.own).toBe('waiting_reply');
    expect(row?.status.ownReason).toMatchObject({ code: 'waiting_reply',
      params: { recipient: recipient.sessionId } });
  });
});
