/**
 * Round-2 R11 Group S: the yielded Run and its successor reached through the
 * REAL public flows — the Host's Workflow drives a Run that genuinely yields on
 * a `send_session_message` wait (RD-3), the recipient answers through the public
 * `workflow/consultation`, and the Workflow claims the continuation Run whose
 * `consumedWait` names the yielded Run. The task-state timeline is then read
 * through the public `readTaskStateTimeline` on the same files.
 *
 * The round-1 `S2B-32-task-timeline-fold.test.ts` "yielded" case stays as the
 * supplementary direct-observation version with distinct hand-written times;
 * this test proves the same `waiting_reply` fact is produced by the real flow.
 *
 * The scenario platform clock is the harness's fixed string (spec F14), so the
 * plan/run instants collapse to one timestamp and the reader emits the
 * intermediate `pending`/`running` segments with zero length; the assertions
 * therefore pin the state sequence and the run refs, not the clock.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { TaskStateTimelinePageV1 } from '../../src/core/work-graph/views/task-state-timeline.js';
import {
  cleanupScenarios, hostCtx, openHostScenario, performs, type HostScenario,
} from '../scenarios/harness.js';
import { NO_REDRIVE, selectedRun, taskRefOf } from '../scenarios/support/common.js';
import {
  AG2B_CONSUMER_ID, AG2B_GOAL_REF, AG2B_QUERY_BUDGET, AG2B_QUERY_ROLE, AG2B_QUERY_ROLE_BINDING,
  AG2B_RUNTIME_BUDGET, AG2B_SCOPE, AG2B_WORK_TASK_ID, createAG2bSession, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import { post, readExecution } from '../helpers/A2-restart-fixture.js';

afterEach(async () => { await cleanupScenarios(); });

describe('S2B-r2 Group S yielded Run and successor', () => {
  it('2B-32 yielded and its continuation claim are real and the timeline reads waiting_reply', async () => {
    let h: HostScenario | undefined;
    let recipient: SessionRef | undefined;
    const send = { callId: 'r2s-wait-send', name: 'send_session_message',
      args: { recipient: {}, text: 'r2s question', replyMode: 'wait' } as Record<string, unknown> };
    const scenario = await openHostScenario({ check: 'pass', automation: NO_REDRIVE, script: {
      replies: [{ kind: 'calls', calls: [send] }, { kind: 'text', text: 'r2s continuation done' }],
      queryReplies: [{ kind: 'text', text: 'r2s reply' }],
      duringReply: async (index) => {
        if (index !== 0 || h === undefined || recipient === undefined) return;
        send.args['recipient'] = { projectId: recipient.projectId, sessionId: recipient.sessionId };
      } } });
    h = scenario;
    recipient = (await createAG2bSession(scenario.host, 'r2s-recipient', AG2B_QUERY_ROLE,
      [{ target: { kind: 'task', ref: taskRefOf() }, relation: 'participates' }])).sessionRef;

    // 1. The Workflow runs the Task and the real Kernel Turn yields on the wait.
    const first = await scenario.advance(scenario.select('r2s-wait', AG2B_WORK_TASK_ID), { invariants: false });
    expect(first.state).toBe('waiting');
    const yieldedRef = await selectedRun(scenario);
    const yielded = await readExecution(scenario.host, yieldedRef);
    expect(yielded.run).toMatchObject({ status: 'ended', outcome: 'yielded', continuation: { kind: 'wait_reply' } });
    const messageRef = yielded.run.continuation?.messageRef;

    // 2. The recipient answers the wait through the formal consultation.
    const consulted = await post<{ status: string; value: { state: string } }>(scenario.host, 'workflow/consultation',
      plain(AG2B_SCOPE, { schemaVersion: 1, messageRef, goalRef: AG2B_GOAL_REF, roleBinding: AG2B_QUERY_ROLE_BINDING,
        runtimeBudget: AG2B_RUNTIME_BUDGET, budget: AG2B_QUERY_BUDGET, consumerId: AG2B_CONSUMER_ID }));
    expect(consulted).toMatchObject({ status: 'ready', value: { state: 'responded' } });

    // 3. The Workflow claims the continuation in the same Session; stop before it starts.
    const claimed = await scenario.advance(scenario.select('r2s-wait-2', AG2B_WORK_TASK_ID),
      { stopBefore: performs('start'), invariants: false });
    expect(claimed.state).toBe('stopped');
    expect(claimed.receipts.map((receipt) => receipt.kind)).toContain('claim_task');
    const successorRef = await selectedRun(scenario);
    expect(successorRef.runId).not.toBe(yieldedRef.runId);
    const successor = await readExecution(scenario.host, successorRef);
    expect(successor.run.consumedWait?.runRef).toEqual(yieldedRef);
    expect(successor.session.ref.sessionId).toBe(yielded.session.ref.sessionId);

    // 4. The public timeline read on the same files folds the real yielded end.
    const platform = await scenario.direct() as unknown as {
      timeline: { readTaskStateTimeline(ctx: unknown, input: unknown): Promise<{ status: string; value?: TaskStateTimelinePageV1 }> };
    };
    const read = await platform.timeline.readTaskStateTimeline(hostCtx(scenario.stepActor()),
      { goalRef: AG2B_GOAL_REF, cursor: null, limit: 200 });
    expect(read.status).toBe('ready');
    const task = read.value?.tasks.find((candidate) => candidate.taskId === AG2B_WORK_TASK_ID);
    if (task === undefined) throw new Error('ag2b-work is not in the timeline page');

    expect(task.segments.map((segment) => segment.state)).toEqual(['not_in_plan', 'pending', 'running', 'waiting_reply']);
    const waiting = task.segments.find((segment) => segment.state === 'waiting_reply');
    expect(waiting?.point).toMatchObject({ kind: 'run_end', source: { aggregateType: 'Run', runId: yieldedRef.runId } });
    // The successor's start was stopped before execution, so its `run_start` has no time.
    expect(task.untimedPoints).toContainEqual({ kind: 'run_start', source: successorRef });
  }, 300_000);
});
