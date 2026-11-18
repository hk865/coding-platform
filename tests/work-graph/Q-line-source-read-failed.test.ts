/**
 * D3 (Q frozen row; 121-146, R5 lines/list): one card source whose read fails is `read_failed`; the line whose
 * card was read still shows `decide`, and the list is `attentionComplete: false` with the source named, never the
 * whole queue's failure and never a complete column. Today this row is red at `attention.code`: the queue still
 * rejects whole, so the line loses its readable card and falls back to `failed`.
 *
 * Public steps only: the S2C line world builds the Goal, Run and card through the real owners; the fault wraps the
 * real records port at the one lookup the candidate source uses (`plan-proposal-by-goal`), an A2 injection.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  failingLookup, openLineFixture, rowOf, type LineFixture,
} from '../helpers/S2C-L-line-support.js';
import { crashedEvent } from '../helpers/S2C-L-runs-support.js';

let opened: LineFixture | null = null;
afterEach(async () => { await opened?.close(); opened = null; });

describe('D3 lines/list with one unreadable card source (memory)', () => {
  it('keeps the read card on its line and marks the list incomplete with the source name', async () => {
    const f = await openLineFixture('memory');
    opened = f;
    const goal = await f.addGoal('q-d3-goal', [{ taskId: 'q-d3-task', title: 'Q D3 task' }]);
    const head = (await f.createSession('q-d3-line')).ref;
    await f.link(head, { kind: 'task', ref: goal.tasks['q-d3-task']! }, 'responsible', true);
    const claim = await f.claim('q-d3-task', head, goal);
    await f.runs.enter(claim.claim);
    await f.runs.recordResult(claim.claim, crashedEvent(claim.claim, 'q-d3'));

    // The real queue's candidate source reads this one lookup; every other read is the real one.
    const failing = failingLookup(f.records, 'plan-proposal-by-goal');
    const reader = f.queueReader(f.records, undefined, { decisions: failing.records });
    const listed = await reader.listWorkLines(f.ctx, { workspace: f.base.scope });
    if (listed.status !== 'ready') throw new Error(`expected ready, got ${JSON.stringify(listed)}`);
    const list = listed.value;
    const row = rowOf(list.rows, head);

    // The readable goal_cause card still puts the line in `decide`.
    expect(row?.status.attention?.code).toBe('decide');
    expect(list.attentionComplete).toBe(false);
    expect(list.attentionProblem).toBe('decision_queue_source_read_failed: candidate');
    expect(row?.status.attentionComplete).toBe(false);
  });
});
