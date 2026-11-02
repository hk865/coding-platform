/**
 * PL-51 (v4 §15-51): both soft lines end with "the adviser does not change the
 * plan" and the person reads `plan_notice`, never a Session notify.
 *
 * Task A's one Run edits 21 real lines and reaches 2.1M growth, so `growth` and
 * `lines` are both sent once on revision 2. The adviser answers each with fixed
 * non-v2 text. Both public notice reads (`decisions/queue` and `main/read`) show
 * the same two `deviation-notice:<goalId>:<requestId>` items; A stays active and
 * another Task still opens a new execution. A budget-exhausted Task with the
 * same soft readings sends only the `budget` round, never `growth`/`lines`, and
 * a Session-only message adds nothing to the person's queue.
 */
import { afterEach, expect, it } from 'vitest';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { systemRoundMessageRef } from '../../src/contracts/plan-round.js';
import { deviationsOfGoal } from '../../src/contracts/plan-deviation.js';
import { advanceUntil, post, readExecution } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { usage } from '../helpers/PL-readings-fixture.js';
import {
  openPLDeviationConsumptionWorld, PL_LINES_21, runSoftLineDeviationPair, type PLDeviationConsumptionWorld,
} from '../helpers/PL-deviation-fixture.js';

const opened: PLDeviationConsumptionWorld[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close().catch(() => undefined); });


it('PL-51: two soft lines answer "no plan change", both public reads show the notice, A continues and a hard stop suppresses soft rounds', async () => {
  const fixture = opened[0] = await openPLDeviationConsumptionWorld({
    label: 'pl51', taskIds: ['pl51-a', 'pl51-b'], write: true, checks: true,
    sizes: [{ taskId: 'pl51-a', sizeClass: 'small', estimatedLines: 10 },
      { taskId: 'pl51-b', sizeClass: 'small' }],
  });
  const { world, goal, tasks, line, adviser } = fixture;
  const [a, b] = tasks;
  if (a === undefined || b === undefined) throw new Error('PL-51: the Plan needs two Tasks');

  const pair = await runSoftLineDeviationPair(fixture, {
    taskId: a.taskId, flowId: 'pl51-a1', path: 'pl51-lines.txt', prefix: 'PL-51',
    async beforeGrowthAnswer() {
      // Before the answer the person's queue has no notice for the growth round.
      const before = await fixture.main.readNotices({ goal, categories: ['plan_notice'], limit: 100 });
      expect(before.notices.filter(notice => notice.itemKey?.includes(`:growth:2`))).toHaveLength(0);
    },
  });

  // Both reads carry the same two keys, once each.
  const queue = await fixture.main.readNotices({ goal, categories: ['plan_notice'], limit: 100 });
  const queueKeys = queue.notices.map(notice => notice.itemKey);
  const growthKey = `deviation-notice:${goal.goalId}:deviation:${goal.goalId}:${a.taskId}:growth:2`;
  const linesKey = `deviation-notice:${goal.goalId}:deviation:${goal.goalId}:${a.taskId}:lines:2`;
  expect(queueKeys).toContain(growthKey);
  expect(queueKeys).toContain(linesKey);
  expect(queueKeys.filter(key => key === growthKey)).toHaveLength(1);
  expect(queueKeys.filter(key => key === linesKey)).toHaveLength(1);
  const lineNotice = queue.notices.find(notice => notice.itemKey === linesKey);
  expect(lineNotice?.summary).toContain('参谋不改计划');
  expect(lineNotice?.summary).toContain(pair.linesAnswer);
  const main = ready<{ notices: Array<{ itemKey?: string; category?: string; summary?: string }> }>(
    await fixture.main.route('main/read', { goalId: goal.goalId, cursor: null }), 'main/read');
  const mainKeys = main.notices.filter(notice => notice.category === 'plan_notice').map(notice => notice.itemKey);
  expect(mainKeys).toEqual(expect.arrayContaining([growthKey, linesKey]));

  // A is neither stopped nor deferred; B opens a new execution.
  const graph = ready<{ tasks: Array<{ ref: { taskId: string }; effectivePhase: string;
    disposition: string; execution: { runId: string } | null }> }>(
    (await world.post('tasks/query', plain(S6A_SCOPE, { goalRef: goal }))).body, 'the task graph');
  const rowA = graph.tasks.find(row => row.ref.taskId === a.taskId);
  expect(rowA).toMatchObject({ disposition: 'active' });
  expect(rowA?.effectivePhase).not.toBe('stopped');
  expect(rowA?.effectivePhase).not.toBe('deferred');
  const bRun = await fixture.runTask({ line, taskId: b.taskId, flowId: 'pl51-b1',
    replies: [{ kind: 'text', text: 'PL-51 B done' }] });
  expect((await readExecution(world.ag2b, bRun)).run).toMatchObject({ status: 'ended', outcome: 'completed' });

  // Hard stop comparison: a budget-exhausted Task with soft readings sends only `budget`.
  const budgetWorld = opened[1] = await openPLDeviationConsumptionWorld({
    label: 'pl51b', taskIds: ['pl51-c'], write: true, checks: true,
    sizes: [{ taskId: 'pl51-c', sizeClass: 'small', estimatedLines: 10 }],
  });
  const c = budgetWorld.tasks[0];
  if (c === undefined) throw new Error('PL-51: the budget Plan needs its Task');
  expect(await budgetWorld.world.settings('run-budget/save', { workRunTokenBudget: 100_000 }))
    .toMatchObject({ status: 'ready' });
  await budgetWorld.runTask({ line: budgetWorld.line, taskId: c.taskId, flowId: 'pl51-c1', replies: [
    { kind: 'calls', calls: [{ callId: 'pl51-c-edit', name: 'edit',
      args: { mode: 'create', path: 'pl51-budget-lines.txt', newText: PL_LINES_21 } }], usage: usage(0, 0) },
    { kind: 'text', text: 'PL-51 C budget', usage: usage(2_100_000, 0) },
  ] });
  const budgetRef = systemRoundMessageRef(S6A_SCOPE, `deviation:${budgetWorld.goal.goalId}:${c.taskId}:budget:2`);
  if (budgetRef.status !== 'ready') throw new Error('PL-51: no budget ref');
  const budgetSend = await advanceUntil(budgetWorld.world.ag2b, { schemaVersion: 1, goalRef: budgetWorld.goal,
    flowId: 'pl51-c2', sessionHint: null, kind: 'select_work' }, 'send_system_round');
  expect(JSON.stringify(budgetSend)).toContain(`:budget:2`);
  expect(JSON.stringify(budgetSend)).not.toContain(`:growth:2`);
  ready(await post(budgetWorld.world.ag2b, 'workflow/advance', plain(S6A_SCOPE, budgetSend)), 'the budget round');
  const budgetMessage = ready<SessionMessage>((await budgetWorld.world.post('messages/read',
    plain(S6A_SCOPE, budgetRef.value))).body, 'the budget message');
  expect(budgetMessage.sender).toMatchObject({ kind: 'host', actor: { kind: 'system', id: 'host:plan-round' } });
  // The hard stop's soft readings are real, but `deviationsOfGoal` returns only `budget`.
  const hardFacts = await budgetWorld.readDeviationFacts(budgetWorld.main.humanContext());
  const hardKind = hardFacts.plan.tasks.find(task => task.taskId === c.taskId);
  expect(hardKind?.usage?.growth.tokens).toBe(2_100_000);
  expect(hardKind?.lines?.added).toBe(21);
  expect(deviationsOfGoal(hardFacts).filter(deviation => deviation.taskRef.taskId === c.taskId)
    .map(deviation => deviation.kind)).toEqual(['budget']);
  // Sending the budget round does not leave a soft round to send afterwards.
  const afterBudget = await post(budgetWorld.world.ag2b, 'workflow/advance', plain(S6A_SCOPE, {
    schemaVersion: 1, goalRef: budgetWorld.goal, flowId: 'pl51-c3', sessionHint: null, kind: 'select_work' }));
  expect(JSON.stringify(afterBudget)).not.toContain(`:growth:2`);
  expect(JSON.stringify(afterBudget)).not.toContain(`:lines:2`);

  // The Session got the system round; the person only gets it after the text answer.
  const hardQueue = await budgetWorld.main.readNotices({ goal: budgetWorld.goal, categories: ['plan_notice'], limit: 100 });
  expect(hardQueue.notices.filter(notice => notice.itemKey?.includes(`:budget:2`))).toHaveLength(0);
}, 240_000);
