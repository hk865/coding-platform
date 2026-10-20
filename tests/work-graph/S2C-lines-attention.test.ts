/**
 * Slice 2C row 2C-12 (LE3): the attention is consistent with 2A's real queue.
 *
 * The Run facts are built through the real WorkGraph owners (claim, entry,
 * result); the queue is the real `createDecisionReadModel` over the same
 * records, so every card is a real card. Assertions read only the public
 * `WorkLineReadPort` and the public decision queue.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { decisionReadsOver, openLineFixture, rowOf, type LineFixture } from '../helpers/S2C-L-line-support.js';
import { crashedEvent } from '../helpers/S2C-L-runs-support.js';

function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`expected ready, got ${JSON.stringify(result)}`);
  return result.value;
}

describe.each(['memory', 'sqlite'] as const)('2C-12 attention from the real queue (%s)', (kind) => {
  const open: LineFixture[] = [];
  afterEach(async () => { for (const fixture of open.splice(0)) await fixture.close(); });
  async function lineFixture(): Promise<LineFixture> {
    const fixture = await openLineFixture(kind);
    open.push(fixture);
    return fixture;
  }

  it('2C-12 (1) a crashed Run is standby with the failed run_failed attention', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g12-fail', [{ taskId: 'f', title: 'F task' }]);
    const head = (await f.createSession('s12-fail')).ref;
    await f.link(head, { kind: 'task', ref: goal.tasks['f']! }, 'responsible', true);
    const claim = await f.claim('f', head, goal);
    await f.runs.enter(claim.claim);
    await f.runs.recordResult(claim.claim, crashedEvent(claim.claim, 'fail'));
    const row = rowOf(ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.status.own).toBe('standby');
    expect(row?.status.attention?.code).toBe('failed');
    expect(row?.status.attention?.reason.code).toBe('run_failed');
  });

  it('2C-12 (2) the real auto_rework_pending card lands through its source.pins task pin', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g12-card', [{ taskId: 'r', title: 'Rework task' }]);
    const head = (await f.createSession('s12-card')).ref;
    await f.link(head, { kind: 'task', ref: goal.tasks['r']! }, 'responsible', true);
    const claim = await f.claim('r', head, goal);
    await f.runs.enter(claim.claim);
    await f.runs.recordResult(claim.claim, crashedEvent(claim.claim, 'card'));

    // The card itself: a real goal-cause card whose objects are empty and whose
    // task pin lives only in source.pins.
    const queue = ready(await decisionReadsOver(f.base, f.records).queryDecisionQueue(f.ctx, {
      workspace: f.base.scope, sections: ['waiting_answer'], page: { limit: 100 },
    }));
    const card = queue.waitingAnswer.find((entry) => entry.source.kind === 'goal_cause'
      && JSON.parse(entry.source.key).code === 'auto_rework_pending'
      && JSON.parse(entry.source.key).affected.some((pin: { ref: { aggregateType?: string } }) => pin.ref.aggregateType === 'Task'));
    expect(card).toBeDefined();
    expect(card?.objects).toEqual([]);
    expect(JSON.parse(card!.source.key).code).toBe('auto_rework_pending');

    const reader = f.queueReader();
    const row = rowOf(ready(await reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.status.attention?.code).toBe('decide');
    expect(row?.status.attention?.reason.code).toBe('card');
    expect(row?.status.attention?.reason.params.code).toBe('auto_rework_pending');
    expect(row?.status.attentionCounts.decide).toBe(1);
    expect(row?.status.attentionCounts.failed).toBe(1);
  });

  it('2C-12 (3) a failed task plus the pending card on one line counts decide 1 and failed 1', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g12-both', [{ taskId: 'b', title: 'Both task' }]);
    const head = (await f.createSession('s12-both')).ref;
    await f.link(head, { kind: 'task', ref: goal.tasks['b']! }, 'responsible', true);
    const claim = await f.claim('b', head, goal);
    await f.runs.enter(claim.claim);
    await f.runs.recordResult(claim.claim, crashedEvent(claim.claim, 'both'));
    const row = rowOf(ready(await f.queueReader().listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.status.attention?.code).toBe('decide');
    expect(row?.status.attentionCounts.decide).toBe(1);
    expect(row?.status.attentionCounts.failed).toBe(1);
  });

  it('2C-12 (4) a failed decision-queue read makes every row attention-complete false and read-incomplete', async () => {
    const f = await lineFixture();
    const head = (await f.createSession('s12-queue-fail')).ref;
    const queueRecords = {
      ...f.records,
      async lookup(request: { index: string } & Record<string, unknown>) {
        if (request.index === 'a2-goal-by-workspace') {
          return { status: 'rejected', code: 'unavailable', reason: 'injected queue lookup failure' };
        }
        return f.records.lookup(request as never);
      },
    } as typeof f.records;
    const reader = f.queueReader(f.records, undefined, { decisions: queueRecords });
    const list = ready(await reader.listWorkLines(f.ctx, { workspace: f.base.scope }));
    const row = rowOf(list.rows, head);
    expect(list.attentionComplete).toBe(false);
    expect(list.attentionProblem).toContain('decision_queue_read_failed');
    expect(row?.status.attention).toBeNull();
    expect(row?.status.attentionComplete).toBe(false);
  });

  it('2C-12 (5) required_task_deferred carries a task pin in source.pins but does not land on the line', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g12-deferred', [
      { taskId: 'p', title: 'Plan-only task', executionIntent: 'plan_only' },
      { taskId: 'd', title: 'Deferred task', disposition: 'deferred' },
    ]);
    const head = (await f.createSession('s12-deferred')).ref;
    await f.link(head, { kind: 'task', ref: goal.tasks['d']! }, 'responsible', true);
    const queue = ready(await decisionReadsOver(f.base, f.records).queryDecisionQueue(f.ctx, {
      workspace: f.base.scope, sections: ['waiting_answer'], page: { limit: 100 },
    }));
    const deferred = queue.waitingAnswer.find((entry) => entry.source.kind === 'goal_cause'
      && JSON.parse(entry.source.key).code === 'required_task_deferred');
    expect(deferred).toBeDefined();
    expect(JSON.parse(deferred!.source.key).affected.some((pin: { ref: { aggregateType?: string } }) => pin.ref.aggregateType === 'Task')).toBe(true);

    const row = rowOf(ready(await f.queueReader().listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.status.attention).toBeNull();
    expect(row?.status.attentionCounts.decide).toBe(0);
  });

  it('2C-12 (6) a goal-level reason card with no task pin lands on no line', async () => {
    const f = await lineFixture();
    const goalRef = await f.runs.bareGoal('g12-bare');
    const goalRead = ready(await f.base.plans.queryGoal(f.ctx, goalRef));
    const draft: PlanRevisionDraft = { schemaVersion: 2, planId: 'g12-bare-plan', planRevision: 1, goalId: 'g12-bare',
      stages: [],
      tasks: [
        { taskId: 't', title: 'Bare task', requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
        { taskId: 'gt', title: 'Bare gate', requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      ],
      assignments: [{ taskId: 't', role: 'builder', instruction: 'Bare task' }],
      obligations: [{ obligationId: 'g12-bare-obligation', title: 'Deliver', requirementLevel: 'required', taskIds: ['t', 'gt'],
        verificationRequirements: [{ requirementId: 'g12-bare-check', requirementLevel: 'required', kind: 'test', description: 'Tests pass' }] }],
      taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } };
    const proposed = await f.base.plans.proposePlan(f.ctx, { input: { goalRef, basedOn: null, draft,
      reason: { text: 'pending plan', sources: [] } },
      meta: { requestId: 'g12-bare-propose', expected: [{ ref: goalRef, revision: goalRead.goal.revision }] } });
    expect(proposed.status).toBe('committed');

    const queue = ready(await decisionReadsOver(f.base, f.records).queryDecisionQueue(f.ctx, {
      workspace: f.base.scope, sections: ['waiting_answer'], page: { limit: 100 },
    }));
    const pending = queue.waitingAnswer.find((entry) => entry.source.kind === 'goal_cause'
      && JSON.parse(entry.source.key).code === 'initial_plan_pending');
    expect(pending).toBeDefined();
    expect(pending?.senderSessionRef).toBeNull();

    const head = (await f.createSession('s12-bare-line')).ref;
    const row = rowOf(ready(await f.queueReader().listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.status.attention).toBeNull();
    expect(row?.status.attentionCounts.decide).toBe(0);
  });

  it('2C-12 (7) an auto_rework_cap_reached goal cause lands through its task pin with empty objects', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g12-cap', [{ taskId: 'c', title: 'Cap task' }]);
    const head = (await f.createSession('s12-cap')).ref;
    await f.link(head, { kind: 'task', ref: goal.tasks['c']! }, 'responsible', true);
    const claim = await f.claim('c', head, goal);
    await f.runs.enter(claim.claim);
    await f.runs.recordResult(claim.claim, crashedEvent(claim.claim, 'cap'));

    const queue = ready(await decisionReadsOver(f.base, f.records, { autoReworkLimit: 0 }).queryDecisionQueue(f.ctx, {
      workspace: f.base.scope, sections: ['waiting_answer'], page: { limit: 100 },
    }));
    const card = queue.waitingAnswer.find((entry) => entry.source.kind === 'goal_cause'
      && JSON.parse(entry.source.key).code === 'auto_rework_cap_reached');
    expect(card).toBeDefined();
    expect(card?.objects).toEqual([]);

    const row = rowOf(ready(await f.queueReader(undefined, undefined, { autoReworkLimit: 0 }).listWorkLines(f.ctx, {
      workspace: f.base.scope,
    })).rows, head);
    expect(row?.status.attention?.code).toBe('decide');
    expect(row?.status.attention?.reason.params.code).toBe('auto_rework_cap_reached');
  });

  it('2C-12 (8) with two pending cards on one line the smaller card key is the most urgent', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g12-two-cards', [
      { taskId: 'c1', title: 'Card one' }, { taskId: 'c2', title: 'Card two' },
    ]);
    const head = (await f.createSession('s12-two-cards')).ref;
    for (const taskId of ['c1', 'c2']) {
      await f.link(head, { kind: 'task', ref: goal.tasks[taskId]! }, 'responsible', true);
      const claim = await f.claim(taskId, head, goal);
      await f.runs.enter(claim.claim);
      await f.runs.recordResult(claim.claim, crashedEvent(claim.claim, `g12-${taskId}`));
    }
    const queue = ready(await decisionReadsOver(f.base, f.records).queryDecisionQueue(f.ctx, {
      workspace: f.base.scope, sections: ['waiting_answer'], page: { limit: 100 },
    }));
    const keys = queue.waitingAnswer
      .filter((entry) => entry.source.kind === 'goal_cause'
        && JSON.parse(entry.source.key).code === 'auto_rework_pending')
      .map((entry) => entry.cardKey)
      .sort();
    expect(keys).toHaveLength(2);
    const row = rowOf(ready(await f.queueReader().listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
    expect(row?.status.attention?.code).toBe('decide');
    const ref = row?.status.attention?.reason.refs[0];
    expect(ref?.kind).toBe('card');
    if (ref?.kind !== 'card') throw new Error('card ref expected');
    expect(ref.cardKey).toBe(keys[0]);
    expect(row?.status.attentionCounts.decide).toBe(2);
  });

  it('2C-12 (10) the detail lists every attention candidate with its source', async () => {
    const f = await lineFixture();
    const goal = await f.addGoal('g12-all', [
      { taskId: 'c1', title: 'Card one' }, { taskId: 'c2', title: 'Card two' },
    ]);
    const head = (await f.createSession('s12-all')).ref;
    for (const taskId of ['c1', 'c2']) {
      await f.link(head, { kind: 'task', ref: goal.tasks[taskId]! }, 'responsible', true);
      const claim = await f.claim(taskId, head, goal);
      await f.runs.enter(claim.claim);
      await f.runs.recordResult(claim.claim, crashedEvent(claim.claim, `g12-all-${taskId}`));
    }
    const detail = ready(await f.queueReader().readWorkLine(f.ctx, { workspace: f.base.scope, key: head }));
    if (detail.kind !== 'line') throw new Error('expected a line detail');
    // Two crashed tasks (failed) and their two goal-cause cards (decide).
    expect(detail.attentionAll).toHaveLength(4);
    expect(detail.attentionAll.filter((entry) => entry.code === 'decide')).toHaveLength(2);
    expect(detail.attentionAll.filter((entry) => entry.source.kind === 'card')).toHaveLength(2);
    expect(detail.attentionAll.filter((entry) => entry.code === 'failed')).toHaveLength(2);
    expect(detail.row.status.attention?.code).toBe('decide');
  });
});
