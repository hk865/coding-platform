/**
 * Slice 5 scenario SC02 (SPEC §5.4, §6.3 F73; §4.3, §4.5–§4.6):
 * "goal conflict and automatic rework" on the real Host over HTTP, SQLite and
 * the scripted model.
 *
 * Two real Goals A/B get active Plans whose work Task is scoped to module M
 * (executed files come only from the real
 * `tasks/goal-executed-files-reader.ts`; the "planned module vs executed file"
 * case is GS11). The
 * scenario then reads the conflict card (no labels before the risk is accepted),
 * accepts the parallel risk, reorders while a Run is occupied, drives one real
 * system requeue, one real agent requeue and one real automatic reverify, reads
 * one notice category's first page, marks only the displayed item, restarts and
 * shows the rest remain, then changes one side's Plan.
 *
 * Part 1 leaves the read model as a stub, so the test stops at the first entry
 * (`decisions.queryGoalConflicts`) with its `not implemented:` throw. Scripted
 * provider only; provider calls are the fixed `S5_SC02_REPLIES` budget.
 */
import { afterEach, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import { assertInvariants, cleanupScenarios, hostCtx, openHostScenario, performs } from './harness.js';
import { draftFrom } from './support/common.js';
import { ownerRequeue } from './support/rework.js';
import {
  S5_GOAL_A, S5_GOAL_B, S5_OPERATOR, S5_SC02_REPLIES, S5_WORK_TASK_A, S5_WORK_TASK_A2, acceptParallelRisk,
  applyCandidate, markNoticesSeen, proposeCandidate, queryDecisionQueue, queryGoalConflicts, readActivePlan,
  reorderGoals, s5AgentRequeue, s5ConflictKey, s5StoreSnapshot, seedConflictWorld,
} from './support/S5-decisions.js';

afterEach(async () => {
  await cleanupScenarios();
});

it('SC02 two Goals conflicting on module M: no labels before the accepted risk, one system and one agent requeue, one automatic reverify and three notices, restart, then one Plan change', async () => {
  const h = await openHostScenario({ actor: S5_OPERATOR, check: 'fail', workIds: [S5_WORK_TASK_A, S5_WORK_TASK_A2],
    // The scenario drives every rework explicitly; the start-up re-drive stays off
    // so a restart never consumes a business-model reply on its own.
    automation: { schemaVersion: 1, autoReworkLimit: 3, resumeOnStartup: 'off' },
    script: { replies: S5_SC02_REPLIES } });

  const world = await seedConflictWorld(h);
  expect(h.modelCalls(), 'the two-goal seed adds no provider call').toBe(0);

  // Before the risk is accepted: exactly one three-option card and NO labels.
  // Part 1 stub: `not implemented: DecisionReadPort.queryGoalConflicts`.
  const conflicts = await queryGoalConflicts(world.platform, world.ctx);
  if (conflicts.status !== 'ready') throw new Error(`the conflict read must be ready: ${JSON.stringify(conflicts)}`);
  const first = conflicts.value;
  expect(first.footprintCompleteness).toHaveLength(2);
  expect(first.footprintCompleteness).toEqual(expect.arrayContaining([
    expect.objectContaining({ goalRef: S5_GOAL_A, executedFiles: 'available', possiblyIncomplete: false }),
    expect.objectContaining({ goalRef: S5_GOAL_B, executedFiles: 'available', possiblyIncomplete: false })]));
  expect(first.cards).toHaveLength(1);
  expect(first.labels, 'no risk label is shown before the risk is accepted').toHaveLength(0);
  const conflictCard = first.cards[0];
  if (conflictCard === undefined) throw new Error('the conflict card must exist');
  const initialA = await readActivePlan(world.platform, world.ctx, S5_GOAL_A);
  const initialB = await readActivePlan(world.platform, world.ctx, S5_GOAL_B);
  const conflictKey = s5ConflictKey([{ goalRef: S5_GOAL_A, planRef: initialA.ref },
    { goalRef: S5_GOAL_B, planRef: initialB.ref }]);
  expect(conflictCard).toMatchObject({ cardKey: conflictKey, source: { kind: 'goal_conflict', key: conflictKey } });
  expect(conflictCard.options).toEqual([
    { id: 'wait', label: '等前一个目标', effect: 'apply' },
    { id: 'order', label: '调整顺序', effect: 'apply' },
    { id: 'parallel', label: '接受风险并行', effect: 'apply' },
  ]);

  // Accept the parallel risk: the card closes and the two labels stay as notes.
  const accepted = await acceptParallelRisk(world.platform, world.ctx, { source: conflictCard.source,
    earlier: S5_GOAL_A, later: S5_GOAL_B });
  expect(accepted).toMatchObject({ status: 'ready', value: { state: 'applied' } });
  const afterAccept = await queryGoalConflicts(world.platform, world.ctx);
  if (afterAccept.status !== 'ready') throw new Error(`the conflict read must be ready: ${JSON.stringify(afterAccept)}`);
  expect(afterAccept.value.cards).toHaveLength(0);
  expect(afterAccept.value.labels).toHaveLength(2);
  expect(afterAccept.value.labels).toEqual(expect.arrayContaining([
    expect.objectContaining({ goalRef: S5_GOAL_A, otherGoalRef: S5_GOAL_B }),
    expect.objectContaining({ goalRef: S5_GOAL_B, otherGoalRef: S5_GOAL_A }),
  ]));

  // Occupy a Run of Task A, then reorder: the note never stops or cancels it.
  const occupying = await h.advance(h.select('s5-sc02-occupy', S5_WORK_TASK_A), { stopBefore: performs('prepare') });
  if (occupying.next === null) throw new Error('the work Run must be occupied before prepare');
  const occupiedRun = (await h.taskRow(S5_WORK_TASK_A)).execution;
  if (occupiedRun === null) throw new Error('the work Task must hold an occupied Run');
  const occupied = await world.platform.executions.readExecution(world.ctx, occupiedRun);
  if (occupied.status !== 'ready') throw new Error('the occupied Run must be readable');
  const reordered = await reorderGoals(world.platform, world.ctx, { goalOrder: [S5_GOAL_B, S5_GOAL_A] });
  expect(reordered).toMatchObject({ status: 'committed' });
  expect((await h.taskRow(S5_WORK_TASK_A)).execution, 'the occupied Run is kept across the reorder note').toEqual(occupiedRun);
  const stillOccupied = await world.platform.executions.readExecution(world.ctx, occupiedRun);
  if (stillOccupied.status !== 'ready') throw new Error('the occupied Run must remain readable');
  expect(stillOccupied.value.run).toEqual(occupied.value.run);
  expect(stillOccupied.value.session.occupancy).toEqual(occupied.value.session.occupancy);
  const afterReorder = await queryGoalConflicts(world.platform, world.ctx);
  if (afterReorder.status !== 'ready') throw new Error(`the conflict read must be ready: ${JSON.stringify(afterReorder)}`);
  expect(afterReorder.value.labels).toHaveLength(2);
  expect(afterReorder.value.labels).toEqual(expect.arrayContaining(afterAccept.value.labels));
  expect(afterReorder.value.cards).toEqual([]);

  // Finish the occupied Run: it fails and stops before its automatic requeue.
  const failedA = await h.advance(occupying.next, { stopBefore: performs('requeue_task') });
  const failedTaskARun = (await h.taskRow(S5_WORK_TASK_A)).execution;
  if (failedTaskARun === null) throw new Error('the failed Task A Run must be selected');
  expect(failedA.state).toBe('stopped');

  // Owner-seeded Agent admission (not a scripted tool call): a fresh Session
  // claims A2, enters with requeue_task granted, requeues A, then settles.
  const beforeAgent = h.modelCalls();
  const agentRequeue = await s5AgentRequeue(h, failedTaskARun);
  expect(agentRequeue, 'the agent requeue is driven through the real owner').toMatchObject({ status: 'committed',
    value: { kind: 'requeued', requeue: { requestedBy: { kind: 'agent' },
      automation: { automatic: true, counted: true, autoCount: 1, cap: 3 } } } });
  if (agentRequeue.status !== 'committed' || agentRequeue.value.kind !== 'requeued') throw new Error('Agent requeue must commit');
  expect(h.modelCalls()).toBe(beforeAgent);
  const auxiliary = (await h.taskRow(S5_WORK_TASK_A2)).execution;
  if (auxiliary === null) throw new Error('the auxiliary Run must be persisted');
  expect(await world.platform.executions.readExecution(world.ctx, auxiliary)).toMatchObject({ status: 'ready',
    value: { run: { status: 'ended', outcome: 'completed' }, session: { occupancy: null } } });
  await assertInvariants(h, 'SC02 after the admitted Agent requeue and auxiliary settlement');

  // The chain's second requeue is the real system/automation one.
  const failedAgain = await h.advance(h.select('s5-sc02-fail-a-again', S5_WORK_TASK_A), { stopBefore: performs('requeue_task') });
  const secondRun = (await h.taskRow(S5_WORK_TASK_A)).execution;
  if (secondRun === null) throw new Error('the second Task A Run must be selected');
  expect(await readFile(join(h.root, 'src/s5-rework-basis.ts'), 'utf8')).toBe('export const s5ReworkBasis = 2;\n');
  const system = await ownerRequeue(await h.direct(), hostCtx({ ...WORKFLOW_AUTOMATION_ACTOR }), secondRun, 's5-sc02-system-requeue');
  expect(system).toMatchObject({ status: 'committed', value: { kind: 'requeued',
    requeue: { automation: { automatic: true, counted: true, autoCount: 2, cap: 3 },
      requestedBy: WORKFLOW_AUTOMATION_ACTOR } } });
  if (system.status !== 'committed' || system.value.kind !== 'requeued') throw new Error('system requeue must commit');
  expect(system.value.requeue.basis.source.sourceDigest).not.toBe(agentRequeue.value.requeue.basis.source.sourceDigest);
  expect(failedAgain.state).toBe('stopped');

  // One real automatic reverify: an inconclusive check opens the successor round.
  await h.restart({ check: { timeoutAfterMs: 3_000 } });
  const toReverify = await h.advance(h.select('s5-sc02-reverify', S5_WORK_TASK_A), { stopBefore: performs('reverify_round') });
  if (toReverify.next === null) throw new Error('the automatic reverify must be derived');
  // Perform exactly this reverify, then stop at the next selection safe point.
  // No successor check or second automatic reverify is smuggled into the row.
  const reverified = await h.advance(toReverify.next, { stopBefore: input => input.kind === 'select_work' });
  expect(reverified.state).toBe('stopped');
  expect(reverified.receipts).toHaveLength(1);
  expect(reverified.receipts[0]).toMatchObject({ kind: 'reverify_round', result: { status: 'committed',
    value: { kind: 'reverified', round: { chain: { autoCount: 1, ordinal: 2,
      reverify: { actorClass: 'system', requestedBy: WORKFLOW_AUTOMATION_ACTOR } } } } } });
  const reverifyReceipt = reverified.receipts[0];
  if (reverifyReceipt?.kind !== 'reverify_round' || reverifyReceipt.result.status !== 'committed'
    || reverifyReceipt.result.value.kind !== 'reverified') throw new Error('the one automatic reverify must commit');
  const reverifiedRound = reverifyReceipt.result.value.round;
  expect(h.modelCalls()).toBe(S5_SC02_REPLIES.length);

  // One category's first page: mark only the displayed item, then restart and
  // show the remaining notices are still there.
  const platformAfterReverify = await h.direct();
  const beforeRead = s5StoreSnapshot(join(h.database, 'ledger.sqlite'));
  const firstPage = await queryDecisionQueue(platformAfterReverify, world.ctx,
    { sections: ['notices'], categories: ['automatic_rework'], page: { limit: 1 } });
  if (firstPage.status !== 'ready') throw new Error(`the notice page must be ready: ${JSON.stringify(firstPage)}`);
  expect(firstPage.value.notices).toHaveLength(1);
  expect(firstPage.value.counts.notices.automatic_rework).toBe(3);
  const displayed = firstPage.value.notices[0];
  if (displayed === undefined) throw new Error('the displayed notice must exist');
  expect(firstPage.value.seenThrough).toEqual({ automatic_rework: displayed.position });
  expect(s5StoreSnapshot(join(h.database, 'ledger.sqlite'))).toEqual(beforeRead);
  if (firstPage.value.displayToken === null) throw new Error('the notice page must carry a display token');
  const marked = await markNoticesSeen(platformAfterReverify, world.ctx, { displayToken: firstPage.value.displayToken,
    seenThrough: firstPage.value.seenThrough });
  expect(marked).toMatchObject({ status: 'committed' });

  await h.restart();
  const platformAfterSeen = await h.direct();
  const remaining = await queryDecisionQueue(platformAfterSeen, world.ctx, { sections: ['notices'], categories: ['automatic_rework'] });
  if (remaining.status !== 'ready') throw new Error(`the remaining notices must be ready: ${JSON.stringify(remaining)}`);
  expect(remaining.value.notices, 'the unseen notices survive the restart').toHaveLength(2);
  const allNotices = [displayed, ...remaining.value.notices];
  expect(new Set(allNotices.map(notice => notice.itemKey)).size).toBe(3);
  expect(allNotices.map(notice => notice.rework)).toEqual(expect.arrayContaining([
    expect.objectContaining({ operation: 'requeue', actorClass: 'agent', count: 1, cap: 3,
      sourceRef: agentRequeue.value.requeue.ref }),
    expect.objectContaining({ operation: 'requeue', actorClass: 'system', count: 2, cap: 3,
      sourceRef: system.value.requeue.ref }),
    expect.objectContaining({ operation: 'reverify', actorClass: 'system', count: 1, cap: 3,
      sourceRef: reverifiedRound.ref }),
  ]));

  // Change one side's Plan: the labels end and the new pair gets its own card.
  const planA = await readActivePlan(platformAfterSeen, world.ctx, S5_GOAL_A);
  const changed = await proposeCandidate(platformAfterSeen, world.ctx, { goalRef: S5_GOAL_A, basedOn: planA.ref,
    // A new immutable pointer with every Task/definition preserved, including
    // traced A2. W1 forbids physically removing any Task from the source Plan.
    draft: draftFrom(planA, 's5-plan-a2'),
    requestRef: null, requestId: 's5-conflict-propose-a2' });
  const applied = await applyCandidate(platformAfterSeen, world.ctx, changed, { requestId: 's5-conflict-apply-a2' });
  expect(applied).toMatchObject({ status: 'committed' });
  const afterPlanChange = await queryGoalConflicts(platformAfterSeen, world.ctx);
  if (afterPlanChange.status !== 'ready') throw new Error(`the conflict read must be ready: ${JSON.stringify(afterPlanChange)}`);
  expect(afterPlanChange.value.labels).toHaveLength(0);
  expect(afterPlanChange.value.cards).toHaveLength(1);
  expect(afterPlanChange.value.cards[0]?.source.key).not.toBe(conflictCard.source.key);
  expect(h.modelCalls(), 'notice reads, markSeen, restart and Plan change add no calls').toBe(S5_SC02_REPLIES.length);
  await assertInvariants(h, 'SC02 after the one Plan change');
}, 180_000);
