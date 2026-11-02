/**
 * PL-38 (spec §15.4, v4 §15-38): a deviation with no adviser.
 *
 * The Goal has no adviser line (a secretary line may exist and must never be a
 * recipient). The four facts are built separately so each one proves its own
 * `kind`: a growth Run (small class, +2.5M growth), a lines Run (21 changed
 * lines against `estimatedLines: 10`), a real accumulated-token budget stop and
 * a real `no_new_basis` stop. The production cause reader derives one
 * `goal_cause/no_adviser`, and `decisions/queue` must show the same source.
 *
 * The queue half needs P8's composition wiring (`create-platform.ts` injects
 * the shared facts reader into the cause reader); P7 commits this row red.
 */
import { afterEach, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { S6AReply } from '../helpers/S6A-host-fixture.js';
import { deviationsOfGoal } from '../../src/contracts/plan-deviation.js';
import { createGoalDecisionCauseReader } from '../../src/core/work-graph/tasks/goal-decision-reader.js';
import { usage } from '../helpers/PL-readings-fixture.js';
import {
  deviationFactsOf, drivePLTaskRunsToStop, openPLDeviationWorld,
  type PLDeviationTask, type PLDeviationWorld,
} from '../helpers/PL-deviation-fixture.js';

const opened: PLDeviationWorld[] = [];
afterEach(async () => { for (const fixture of opened.splice(0)) await fixture.close(); });

const LINE_TEXT = Array.from({ length: 21 }, (_, index) => `line ${index + 1}`).join('\n');

/** Run one Task in its own no-adviser world and return its one deviation. */
async function deviationOfOneTask(task: PLDeviationTask, label: string,
  drive: (fixture: PLDeviationWorld, taskId: string) => Promise<void>): Promise<string | undefined> {
  const fixture = await openPLDeviationWorld({ tasks: [task] });
  opened.push(fixture);
  const only = fixture.tasks[0];
  if (only === undefined) throw new Error(`PL-38: the ${label} Plan has no Task`);
  await drive(fixture, only.taskId);
  const ctx: CoreCallContext = fixture.main.humanContext();
  const deviations = deviationsOfGoal(await fixture.readDeviationFacts(ctx));
  expect(deviations.map(deviation => deviation.taskRef.taskId)).toEqual([only.taskId]);
  return deviations[0]?.kind;
}

it('PL-38: growth, lines, budget and stop deviations with no adviser derive one goal_cause/no_adviser shared by the queue', async () => {
  // The growth world also carries the secretary line, the shared cause reader and
  // the queue: the other three kinds are built in their own one-Task worlds.
  const fixture = await openPLDeviationWorld({ tasks: [{ taskId: 'pl38-growth', sizeClass: 'small' }] }
  );
  opened.push(fixture);
  const { world, goal, tasks } = fixture;
  const growth = tasks[0];
  if (growth === undefined) throw new Error('PL-38: the growth Plan has no Task');
  const ctx: CoreCallContext = fixture.main.humanContext();

  // A real secretary line exists; it is never the adviser recipient.
  await fixture.base.line('pl38-secretary');

  const growthLine = await fixture.base.line('pl38-growth', [growth]);
  const growthReplies: S6AReply[] = [
    { kind: 'calls', calls: [{ callId: 'pl38-g1', name: 'read', args: { path: 'src/g.ts' } }], usage: usage(0, 0) },
    { kind: 'calls', calls: [{ callId: 'pl38-g2', name: 'read', args: { path: 'src/g.ts' } }], usage: usage(2_500_000, 0) },
    { kind: 'text', text: 'PL-38 growth done', usage: usage(0, 0) },
  ];
  await fixture.base.runTask({ line: growthLine, taskId: growth.taskId, flowId: 'pl38-g', replies: growthReplies });

  const facts = await fixture.readDeviationFacts(ctx);
  const deviations = deviationsOfGoal(facts);
  expect(deviations.filter(deviation => deviation.taskRef.taskId === growth.taskId)).toMatchObject([
    { kind: 'growth' },
  ]);

  // The lines Task: 21 edited lines against an estimated 10.
  expect(await deviationOfOneTask({ taskId: 'pl38-lines', estimatedLines: 10 }, 'lines',
    async (world, taskId) => {
      const line = await world.base.line('pl38-lines', [world.tasks[0]!]);
      await world.base.runTask({ line, taskId, flowId: 'pl38-l', replies: [
        { kind: 'calls', calls: [{ callId: 'pl38-l1', name: 'edit',
          args: { mode: 'create', path: 'pl38-lines.txt', newText: LINE_TEXT } }] },
        { kind: 'text', text: 'PL-38 lines done', usage: usage(0, 0) },
      ] });
    })).toBe('lines');

  // The budget Task's Run crosses the saved accumulated-token budget.
  expect(await deviationOfOneTask({ taskId: 'pl38-budget' }, 'budget', async (world, taskId) => {
    expect(await world.world.settings('run-budget/save', { workRunTokenBudget: 100_000 }))
      .toMatchObject({ status: 'ready' });
    const line = await world.base.line('pl38-budget', [world.tasks[0]!]);
    await world.base.runTask({ line, taskId, flowId: 'pl38-b', replies: [
      { kind: 'text', text: 'PL-38 budget never completed', usage: usage(150_000, 0) },
    ] });
  })).toBe('budget');

  // The stop Task: the real Run fails and the automatic requeue has no new basis.
  expect(await deviationOfOneTask({ taskId: 'pl38-stop' }, 'stop', async (world, taskId) => {
    const line = await world.base.line('pl38-stop', [world.tasks[0]!]);
    await drivePLTaskRunsToStop(world.world, { goal: world.goal, line, taskId, flowId: 'pl38-s',
      replies: [{ kind: 'fail', message: 'PL-38 stop Run fails' }] });
  })).toBe('stop');

  // The production cause reader derives one shared `goal_cause/no_adviser`.
  const factsReader = deviationFactsOf(fixture.base);
  const reader = createGoalDecisionCauseReader({
    records: world.platform.disconnect.records,
    plans: world.platform.plans,
    recipients: world.platform.recipients,
    readDeviationFacts: (callCtx, goalRef, rows) => factsReader.reader(callCtx)(goalRef, rows),
  });
  const before = await reader.readGoalDecisionCauses(ctx, { goalRef: goal });
  expect(before.status).toBe('ready');
  if (before.status !== 'ready') return;
  const causes = before.value.filter(cause => cause.code === 'no_adviser');
  expect(causes).toHaveLength(1);
  expect(causes[0]!.source.kind).toBe('goal_cause');
  expect(causes[0]!.action).toBeNull();
  expect(causes[0]!.runRef).toBeNull();

  // P8 wires this same reader into the queue source; the queue derives the same card.
  const cards = await fixture.main.readCards(goal);
  const parsedCode = (card: { source: { key: string } }): unknown => {
    try { return (JSON.parse(card.source.key) as { code?: unknown }).code; } catch { return undefined; }
  };
  const queued = cards.filter(card => card.source.kind === 'goal_cause' && parsedCode(card) === 'no_adviser');
  expect(queued).toHaveLength(1);
  expect(queued[0]!.source.key).toBe(causes[0]!.source.key);
});
