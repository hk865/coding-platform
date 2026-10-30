/**
 * Slice 2C row 2C-11 (LE3): the waiting-reply transitions (T3b/T7, P17, P18).
 *
 * The fixture builds real claims and Runs through the real WorkGraph/Runtime owners: the waiting message is the
 * scripted `send_session_message` call of a real yielded Run, and the pause/cancel pointer is a real
 * `RunControlPort.submitControl` on that ended (yielded) Run. Assertions read only the public `WorkLineReadPort`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import { openLineFixture, rowOf, waitingRun, type LineFixture } from '../helpers/S2C-L-line-support.js';

function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`expected ready, got ${JSON.stringify(result)}`);
  return result.value;
}

describe.each(['memory', 'sqlite'] as const)('2C-11 waiting reply transitions (%s)', (kind) => {
  const open: LineFixture[] = [];
  afterEach(async () => {
    for (const fixture of open.splice(0)) await fixture.close();
  });
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
    await waitingRun(f, { label: 'yield', goal, head, recipient: f.base.sessions.second });
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
    const { claim } = await waitingRun(f, { label: 'pause', goal, head, recipient: f.base.sessions.second });
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
    const { claim } = await waitingRun(f, { label: 'cancel', goal, head, recipient: f.base.sessions.second });
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
    await waitingRun(f, { label: 'recipient', goal, head, recipient });

    const row = rowOf(ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.status.own).toBe('waiting_reply');
    expect(row?.status.ownReason).toMatchObject({ code: 'waiting_reply',
      params: { recipient: recipient.sessionId } });
  });
});
