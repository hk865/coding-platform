/**
 * CPL C8 (decision 121-128, `cpl-rulings.md` row C8): the plan shape CPL admits reaches completion, so the G6 class
 * "adopted, every Task done, the Goal never completes" does not recur.
 *
 * World: `openS7AWorkSetup` (memory): the AG2b plan adopted through `plans/propose` + `plans/apply` (two
 * `request_execution` work Tasks and the Goal gate, all three in one required static obligation), the Host's static
 * echo check for every Task and one Work line holding both Tasks. The line's scripted model answers each Run with
 * text; `workflow/advance` is driven from `select_work` (`driveWorkflow`); the Goal is read through `goals/display`.
 *
 * Green today (54b74ac3) and after CPL: this plan already carries the goal gate and the mapping CPL-1 will require.
 * Mutation: the completion rule finds no Goal gate (the G6 class-A refusal) -> the last step is not `complete_goal`.
 */
import { expect, it } from 'vitest';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openS7AWorkSetup } from '../helpers/S7A-fixture.js';

it('C8: an all-request_execution plan with the goal gate and its mapping is adopted, worked and completed', async () => {
  const { world, goal, plan, line } = await openS7AWorkSetup({ backend: 'memory' });
  try {
    expect(plan.tasks.filter(task => task.taskKind === 'work').map(task => task.executionIntent))
      .toEqual(['request_execution', 'request_execution']);
    expect(plan.tasks.filter(task => task.taskKind === 'gate').map(task => task.scope.kind)).toEqual(['goal']);
    await world.scripted.script(line, [{ kind: 'text', text: 'CPL C8 first work' }, { kind: 'text', text: 'CPL C8 second work' }]);
    const steps = await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 'cplt-c8',
      sessionHint: line.ref, kind: 'select_work' });
    expect(steps.at(-1), JSON.stringify(steps.map(step => [step.state, step.reason, step.receipt?.kind])))
      .toMatchObject({ state: 'completed', receipt: { kind: 'complete_goal', result: { status: 'committed' } } });
    const display = (await world.post('goals/display', plain(S6A_SCOPE, { goalRef: goal }))).body as
      { value: { display: { phase: string } } };
    expect(display.value.display.phase).toBe('COMPLETED');
  } finally {
    await world.close();
  }
}, 120_000);
