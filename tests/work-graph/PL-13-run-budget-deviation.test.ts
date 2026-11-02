/**
 * PL-13 (spec §15.3, v3 §9-13): a real accumulated-token Run budget.
 *
 * The Work binding's Run budget is a saved 1,000 tokens; two reported requests
 * of 600 tokens each exhaust it, so the third request is refused by the Runtime
 * and the Run ends `budget_exhausted` (not the tool-call cap `C8-budget` uses).
 * The shared facts reader reports the `budget` deviation with the exclusive
 * minimum; another Plan Task B still runs; `tasks/requeue` with a larger budget
 * lets A continue. Values are literals, never read back from the reader.
 */
import { afterEach, expect, it } from 'vitest';
import type { S6AReply } from '../helpers/S6A-host-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { usage } from '../helpers/PL-readings-fixture.js';
import { deviationRequestId, deviationsOfGoal } from '../../src/contracts/plan-deviation.js';
import { openPLDeviationWorld, runRevisionOf, type PLDeviationWorld } from '../helpers/PL-deviation-fixture.js';

const opened: PLDeviationWorld[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

it('PL-13: accumulated tokens exhaust the Run budget, the budget deviation is read, B advances and requeue continues A', async () => {
  const fixture = await openPLDeviationWorld({ tasks: [{ taskId: 'pl13-a' }, { taskId: 'pl13-b' }] });
  opened.push(fixture);
  const { world, goal, tasks } = fixture;
  const [a, b] = tasks;
  if (a === undefined || b === undefined) throw new Error('PL-13: the Plan needs two Tasks');
  expect(await world.settings('run-budget/save', { workRunTokenBudget: 100_000 })).toMatchObject({ status: 'ready' });
  const ctx = fixture.main.humanContext();

  const aLine = await fixture.base.line('pl13-a', [a]);
  const aReplies: S6AReply[] = [
    { kind: 'text', text: 'PL-13 A never asked', usage: usage(150_000, 0) },
  ];
  const aRun = await fixture.base.runTask({ line: aLine, taskId: a.taskId, flowId: 'pl13-a-1', replies: aReplies });
  const exhausted = await world.post('executions/read', plain(S6A_SCOPE, aRun));
  expect(exhausted.body).toMatchObject({ status: 'ready', value: { run: {
    status: 'ended', outcome: 'budget_exhausted', budget: { tokenBudget: 100_000 },
  } } });

  const facts = await fixture.readDeviationFacts(ctx);
  const budget = facts.plan.tasks.find(task => task.taskId === a.taskId);
  expect(budget).toMatchObject({
    taskId: a.taskId, usage: { tokens: 150_000, complete: true }, trigger: { planRevision: 1 },
    failure: { runRef: { runId: aRun.runId }, automation: { verdict: { kind: 'stopped', reason: 'budget_exhausted',
      detail: { minTokenBudgetExclusive: 100_000 } } } },
  });
  const deviations = deviationsOfGoal(facts);
  expect(deviations).toHaveLength(1);
  expect(deviations[0]).toMatchObject({
    kind: 'budget', taskRef: { taskId: 'pl13-a' }, planRevision: 1,
    runRef: { runId: aRun.runId }, minTokenBudgetExclusive: 100_000, usage: { tokens: 150_000, complete: true },
  });
  expect(deviationRequestId(deviations[0]!)).toBe(`deviation:${goal.goalId}:pl13-a:budget:1`);

  // B is independent: its own Run completes while A is stopped.
  const bLine = await fixture.base.line('pl13-b', [b]);
  await world.scripted.script(bLine, [{ kind: 'text', text: 'PL-13 B done' }]);
  const bRun = await fixture.base.runTask({ line: bLine, taskId: b.taskId, flowId: 'pl13-b-1',
    replies: [{ kind: 'text', text: 'PL-13 B done' }] });
  const bDone = await world.post('executions/read', plain(S6A_SCOPE, bRun));
  expect(bDone.body).toMatchObject({ status: 'ready', value: { run: { outcome: 'completed' } } });

  // A person raises A's budget through the public requeue route.
  const goalRead = await world.post('goals/read', plain(S6A_SCOPE, goal));
  const goalRevision = (goalRead.body as { value?: { goal?: { revision?: number } } }).value?.goal?.revision;
  if (goalRevision === undefined) throw new Error('PL-13: goals/read has no Goal revision');
  const runRevision = await runRevisionOf(world, aRun);
  const requeue = await world.post('tasks/requeue', graphWrite(S6A_SCOPE, {
    taskRef: a, afterRunRef: aRun, reason: 'PL-13 larger budget',
    budget: { tokenBudget: 200_000, deadline: null },
  }, 'pl13-requeue', [{ ref: goal, revision: goalRevision }, { ref: aRun, revision: runRevision }]));
  expect(requeue.body).toMatchObject({ status: 'committed', value: { kind: 'requeued' } });

  const continued = await fixture.base.runTask({ line: aLine, taskId: a.taskId, flowId: 'pl13-a-2',
    replies: [{ kind: 'text', text: 'PL-13 A done' }] });
  const continuedRead = await world.post('executions/read', plain(S6A_SCOPE, continued));
  expect(continuedRead.body).toMatchObject({ status: 'ready', value: { run: {
    outcome: 'completed', budget: { tokenBudget: 200_000 },
  } } });
  const after = await fixture.readDeviationFacts(ctx);
  expect(after.plan.tasks.find(task => task.taskId === a.taskId)?.failure).toBeNull();
  expect(deviationsOfGoal(after)).toEqual([]);
}, 1100_000);
