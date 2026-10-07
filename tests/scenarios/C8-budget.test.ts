/**
 * A.2 step 6, scenario C8-budget (docs/refactor/STATE-MACHINES-SPEC.md §15.2
 * "第 6 步" row C8-budget; §15.2 5.8 "`stopped/budget_exhausted` 且配置的绑定预算更大时带该预算
 * requeue"; §4 TD-9 AV-11, TASK-03, G-BUDGET; §13.4 #19; §2.1 GOAL-30; C8) through
 * the public composition root on SQLite.
 *
 * The Host drives the real Workflow over a real Kernel with the scripted
 * model. The runtime grant allows one tool call per Run, so Run 1's second
 * `read` exceeds the Kernel limit and Run 1 ends `budget_exhausted`; `start`
 * goes back to the selection (result mapping). The verdict is
 * `stopped/budget_exhausted{minTokenBudgetExclusive}` = Run 1's token budget,
 * the binding's own budget is not larger, so the Workflow requeues nothing and
 * the Goal shows NEEDS_DECISION; another 推进 calls no model and writes nothing.
 * The Host raises the binding budget (`registerWorkflowBinding`); the next 推进
 * requeues with that budget as the Workflow automation actor, the claim and
 * Run 2 carry it (TASK-03), Run 2 passes once the source is fixed and the Goal
 * completes. The §11 invariants are checked after every Workflow step with a
 * receipt.
 *
 * Moved here (A.2 step 6, user decision 31): the one case of
 * tests/composition/A2-auto-rework-budget-platform.test.ts (that file is deleted),
 * its assertions kept; its environment is tests/scenarios/support/rework.ts
 * `openBudgetEnvironment`. Added: the invariant checks, the 0-call 0-write
 * 推进 while stopped, and the claim request's budget.
 *
 * No real model is called: three scripted replies.
 */
import { afterEach, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import { assertInvariantsAt, cleanupScenarios, fileCounts } from './harness.js';
import {
  BUDGET_BINDING_BUDGET as BINDING_BUDGET, BUDGET_CONSUMER_ID as CONSUMER_ID, BUDGET_RAISED_BUDGET as RAISED_BUDGET,
  BUDGET_ROLE_BINDING as roleBinding, BUDGET_SCOPE as scope, BUDGET_SESSION_ROLE as sessionRole, BUDGET_TASK_ID as TASK_ID,
  budgetCtx as ctx, budgetDisplay as display, budgetDrive, budgetSelect as select, budgetTaskRow as taskRow, claimInputsOf,
  cleanupRework, openBudgetEnvironment,
} from './support/rework.js';

afterEach(async () => {
  await cleanupRework();
  await cleanupScenarios();
});

it('AV-11, §13.4 #19: an exhausted Run waits until the binding budget is larger, then the Workflow requeues with it and the claim carries it', async () => {
  const { platform, scripted, workspaceRoot, directory, target } = await openBudgetEnvironment();
  const drive = (input: Parameters<typeof budgetDrive>[2], label: string) => budgetDrive(platform, target, input, label);
  await assertInvariantsAt(target, 'seeded');

  // Run 1 exceeds the one-tool limit: `start` returns it ended budget_exhausted and goes back to the selection,
  // which stops on the verdict (the binding budget is the exhausted one, not larger).
  const first = await drive(select('a2-budget-flow-1'), 'budget-1');
  const started = first.find(step => step.receipt?.kind === 'start');
  expect(started).toMatchObject({ state: 'advance', next: { kind: 'select_work' },
    receipt: { result: { status: 'ready', value: { run: { status: 'ended', outcome: 'budget_exhausted', budget: BINDING_BUDGET } } } } });
  expect(first.at(-1)).toMatchObject({ state: 'waiting', next: null, reason: `the selected Task ${TASK_ID} is not executable right now` });
  expect(first.some(step => step.next?.kind === 'perform' && step.next.operation.kind === 'requeue_task')).toBe(false);
  expect(scripted.calls(), 'Run 1: the first read, then the request whose read exceeds the limit').toBe(2);
  const exhausted = await taskRow(platform);
  expect(exhausted).toMatchObject({ effectivePhase: 'failed', phaseCause: { code: 'run_failed' },
    failure: { failureClass: 'run_failed', run: { outcome: 'budget_exhausted', budget: BINDING_BUDGET },
      automation: { lastRefusal: null, verdict: { kind: 'stopped', reason: 'budget_exhausted',
        detail: { minTokenBudgetExclusive: BINDING_BUDGET.tokenBudget } } } } });
  expect(exhausted.rework).toBeUndefined();
  expect(await display(platform)).toMatchObject({ phase: 'NEEDS_DECISION', row: 'GOAL-30',
    cause: { code: 'budget_exhausted', taskId: TASK_ID, detail: { minTokenBudgetExclusive: BINDING_BUDGET.tokenBudget } } });
  const run1Ref = exhausted.execution;
  if (run1Ref === null) throw new Error('Run 1 must be selected');

  // Row "推进 0 调用": while stopped, another 推进 (Task-level and Goal-level) calls no model and writes nothing.
  const atStop = { calls: scripted.calls(), files: fileCounts(directory) };
  for (const input of [select('a2-budget-flow-1-again'), select('a2-budget-flow-1-goal', true)]) {
    const again = await drive(input, input.flowId);
    expect(again, input.flowId).toMatchObject([{ state: 'waiting', next: null, receipt: null }]);
  }
  expect({ calls: scripted.calls(), files: fileCounts(directory) }).toEqual(atStop);

  // The Host raises the Workflow binding budget; the source is fixed so Run 2's round can pass.
  platform.registerWorkflowBinding({ consumerId: CONSUMER_ID,
    binding: { workspace: scope, sessionRole, roleBinding, budget: RAISED_BUDGET } });
  await writeFile(join(workspaceRoot, 'fixed.txt'), 'fixed\n');
  const second = await drive(select('a2-budget-flow-2', true), 'budget-2');
  expect(second.at(-1), JSON.stringify(second.map(step => [step.state, step.reason, step.receipt?.kind])))
    .toMatchObject({ state: 'completed', receipt: { kind: 'complete_goal' } });
  // The automatic requeue carries the larger budget (G-BUDGET passes), as the automation actor.
  expect(second.find(step => step.receipt?.kind === 'requeue_task')).toMatchObject({ state: 'advance', next: { kind: 'select_work' },
    receipt: { result: { status: 'committed', value: { kind: 'requeued', requeue: { afterRunRef: run1Ref, afterOutcome: 'budget_exhausted',
      failureClass: 'run_failed', budget: RAISED_BUDGET, reason: 'auto-rework:run_failed#1', requestedBy: WORKFLOW_AUTOMATION_ACTOR,
      automation: { automatic: true, counted: true, autoCount: 1 } } } } } });
  // TASK-03: the claim and Run 2 carry the pinned budget.
  expect(second.find(step => step.receipt?.kind === 'claim_task')).toMatchObject({ receipt: { result: { status: 'committed' } } });
  const requeueRef = target.lastWorld?.requeues.find(requeue => requeue.afterRunRef.runId === run1Ref.runId)?.ref;
  expect(claimInputsOf(second)).toMatchObject([{ taskId: TASK_ID, budget: RAISED_BUDGET, requeueRef }]);
  const done = await taskRow(platform);
  expect(done).toMatchObject({ effectivePhase: 'satisfied' });
  const run2Ref = done.execution;
  if (run2Ref === null || run2Ref.runId === run1Ref.runId) throw new Error('Run 2 must be selected');
  const run2 = await platform.executions.readExecution(ctx(), run2Ref);
  expect(run2).toMatchObject({ status: 'ready', value: { run: { outcome: 'completed', budget: RAISED_BUDGET,
    requeueRef: { afterRunId: run1Ref.runId } } } });
  expect(await display(platform)).toMatchObject({ phase: 'COMPLETED' });
  expect(scripted.calls()).toBe(3);
}, 120_000);
