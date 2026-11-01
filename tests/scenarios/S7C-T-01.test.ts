/**
 * T-01 (book 1389; DR L2-T-01): a real `request_rework` tool call opens the agent's pending request; the person's
 * `decisions/answer` approve applies it through R's one trusted entry, which keeps the REQUESTER's agent actor. The
 * public reads are the Task graph's own requeue entry (`rework.entries[].requestedBy`) and the automatic-rework
 * notice's `actorClass`, both of which the approved application produced.
 *
 * The task is the FL-1 counted Task, but the tool call needs a RUNNING caller Run: the fixture's Task is already in
 * its successor round, so no new claim is possible (`deriveReworkClass` FC-1 needs an ended afterRun and TD-6 needs
 * an entered caller Run). The row therefore runs the real `request_rework` on the L46 world, the existing public
 * path L1's `S7C1-R-rework-apply` uses, and reports that mismatch.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { DecisionCardV1, DecisionQueueReadV1, NoticeItemV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { TaskRow } from '../../src/core/work-graph/model/plan-contracts.js';
import type { ResolveDecisionReadV1 } from '../../src/business/workflow/contracts.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { openS7BL46World, requestL46Rework } from '../helpers/S7B-L46-fixture.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

async function reworkRequestCard(world: S6AHostWorld, goalRef: GoalRef): Promise<DecisionCardV1> {
  const queue = ready<DecisionQueueReadV1>(await world.post('decisions/queue', plain(S6A_SCOPE, {
    workspace: S6A_SCOPE, goalRef, sections: ['waiting_answer'], page: { limit: 100 },
  })), 'the T-01 queue');
  const listed = queue.waitingAnswer.find(card => card.source.kind === 'rework_request');
  if (listed === undefined) throw new Error('T-01: no waiting rework_request card');
  return ready<DecisionCardV1>(await world.post('decisions/card', plain(S6A_SCOPE,
    { source: listed.source })), 'the rework_request card');
}

async function taskRowOf(world: S6AHostWorld, goalRef: GoalRef, taskId: string): Promise<TaskRow> {
  const graph = ready<{ tasks: TaskRow[] }>(await world.post('tasks/query', plain(S6A_SCOPE, { goalRef })),
    'the T-01 task graph');
  const row = graph.tasks.find(candidate => candidate.ref.taskId === taskId);
  if (row === undefined) throw new Error(`T-01: the Task ${taskId} is not in the graph`);
  return row;
}

describe('T-01', () => {
  it('a real request_rework approved from decisions/answer keeps the requester agent actor', async () => {
    const opened = await openS7BL46World({ backend: 'memory' });
    worlds.push(opened.world);
    const reason = 'S7C T-01: the requester asks for the rework';
    const rework = await requestL46Rework(opened.world, { goalRef: opened.goalRef,
      tasks: { A: opened.tasks.A, B: opened.tasks.B }, afterRun: opened.run, label: 's7c-t-01', reason });
    expect(rework.call.name).toBe('request_rework');
    const card = await reworkRequestCard(opened.world, opened.goalRef);
    const approved = ready<ResolveDecisionReadV1>(await opened.world.post('decisions/answer',
      graphWrite(S6A_SCOPE, { source: card.source, selection: { kind: 'option', optionId: 'approve' },
        text: '', annotations: [] }, 's7c-t-01-answer', card.source.pins)), 'the T-01 answer');
    expect(approved.answer).toMatchObject({ status: 'committed' });
    expect(approved.state).toBe('applied');
    expect(approved.application).toMatchObject({ status: 'committed' });

    // The Task's own requeue entry keeps the requester Run and its agent actor.
    const row = await taskRowOf(opened.world, opened.goalRef, opened.tasks.A.taskId);
    const entry = row.rework?.entries.find(candidate => candidate.reason === reason);
    if (entry === undefined) throw new Error(`T-01: the requeue entry is missing: ${JSON.stringify(row.rework)}`);
    expect(entry.requestedBy).toMatchObject({ kind: 'agent', runRef: rework.execution.run.ref });
    expect(entry).toMatchObject({ automatic: true, autoCount: 1 });

    // The notice's public view agrees: the approved rework counts as the agent's.
    const notices = await ready<{ notices: (NoticeItemV1 & { memberViews?: NoticeItemV1[] })[] }>(
      await opened.world.post('main/read', plain(S6A_SCOPE, { goalId: opened.goalRef.goalId, cursor: null })),
      'the T-01 main read');
    const flat = notices.notices.flatMap(notice => notice.memberViews ?? [notice]);
    const notice = flat.find(item => item.rework?.reason === reason);
    if (notice === undefined) throw new Error('T-01: the requeue notice is missing');
    expect(notice.rework).toMatchObject({ operation: 'requeue', actorClass: 'agent', counted: true, count: 1 });
  });
});
