/**
 * A candidate that physically removes a Task (`slice-PL-SPEC.md` "不删任务，用 disposition") is refused at the real
 * `plans/propose`: adoption and the review's preparation both refuse it, so a recorded one could only loop unseen.
 */
import { afterEach, expect, it } from 'vitest';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { adoptPLTwoStageSkeleton, openPLWorkflowWorld, plPlanChangeDraft, type PLWorkflowWorld }
  from '../helpers/PL-workflow-fixture.js';

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });

it('a candidate that drops a Task is refused with the Task named, and a disposition change still proposes', async () => {
  const workflow = opened = await openPLWorkflowWorld({ label: 'pl-drop' });
  const { plan } = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, { label: 'pl-drop' });
  const assignments = plan.assignments ?? [];

  const dropped = plPlanChangeDraft(plan, workflow.goal, { planId: 'pl-plan-pl-drop-1',
    tasks: plan.tasks.filter(task => task.taskId !== 'pl-b'),
    assignments: assignments.filter(row => row.taskId !== 'pl-b'), obligations: plan.obligations });
  const refused = await workflow.main.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: workflow.goal, basedOn: plan.ref, draft: dropped, reason: { text: 'pl-drop', sources: [] },
  }, 'pl-drop-propose'));
  expect(refused).toMatchObject({ status: 'rejected', code: 'unsupported',
    reason: expect.stringContaining('pl-b') });

  const kept = plPlanChangeDraft(plan, workflow.goal, { planId: 'pl-plan-pl-drop-2',
    tasks: plan.tasks.map(task => task.taskId === 'pl-b' ? { ...task, disposition: 'deferred' as const } : task),
    assignments, obligations: plan.obligations });
  const proposed = await workflow.main.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: workflow.goal, basedOn: plan.ref, draft: kept, reason: { text: 'pl-keep', sources: [] },
  }, 'pl-keep-propose'));
  expect(proposed).toMatchObject({ status: 'committed' });
}, 60_000);
