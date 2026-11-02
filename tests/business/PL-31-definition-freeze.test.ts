/**
 * PL-31: a Task whose Run is already entered keeps the Plan revision that Run
 * claimed. A later v2 changes only B and adds C; A's `executions/read` still
 * carries v1 in `run.claim.planRef` and `plan.ref`, while C's Run carries v2
 * (spec §15 PL-31, DR-P4-13). The negative branch changes A's execution
 * definition: `plans/apply` refuses with the existing execution-trace guard
 * (`revision_conflict`, "already has a Run") and the active Plan stays v2.
 *
 * The named mutation is "skip the existing execution-trace guard"; that guard
 * lives in `plan-machine.ts` and its change is not runnable by P4 (P4 does not
 * own that file). This row is the regression that catches it once L closes.
 */
import { afterEach, expect, it } from 'vitest';
import type { RuntimeTask } from '../../src/contracts/plan.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { checkConfiguration, ready, sessionOf } from '../helpers/S7A-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { readExecution } from '../helpers/A2-restart-fixture.js';
import {
  adoptPLTwoStageSkeleton, holdPLTaskRequest, openPLWorkflowWorld, plPlanChangeDraft, satisfyPLTask,
  type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });

it('PL-31: an entered Run keeps v1 while v2 only changes B and adds C; changing A is refused', async () => {
  const workflow = opened = await openPLWorkflowWorld({ label: 'pl-31',
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, {
    label: 'pl-31', stageOneTaskIds: ['pl-a', 'pl-b'],
  });
  const line = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: 'pl-31-line', role: S6A_WORK_ROLE, tasks: skeleton.tasks.filter(task =>
      ['pl-a', 'pl-b'].includes(task.taskId)),
  }));

  // A is entered and its real model request is held; the claim is on v1.
  const held = await holdPLTaskRequest(workflow.world, workflow.goal, 'pl-a', line, 'pl31');
  try {
    expect(held.execution.run.status).toBe('running');
    expect(held.execution.outbox.claim.planRef).toEqual(skeleton.plan.ref);
    expect(held.execution.plan.ref).toEqual(skeleton.plan.ref);
    const aTitle = held.execution.plan.tasks.find(task => task.taskId === 'pl-a')?.title;
    expect(aTitle).toBe('PL stage 1 pl-a');

    // v2: only B's definition changes and C is added; A is untouched.
    const cTask: RuntimeTask = {
      taskId: 'pl-c', stageId: 'pl-stage-1', title: 'PL-31 added C', requirementLevel: 'required',
      taskKind: 'work', disposition: 'active', phase: 'pending',
      scope: { kind: 'stage', stageId: 'pl-stage-1' }, executionIntent: 'request_execution',
      estimatedLines: 10, sizeClass: 'small',
    };
    const v2Draft = plPlanChangeDraft(skeleton.plan, workflow.goal, {
      planId: 'pl-plan-pl-31-v2',
      tasks: [...skeleton.plan.tasks.map(task => task.taskId === 'pl-b'
        ? { ...task, title: 'PL-31 changed B' } : task), cTask],
      assignments: [...(skeleton.plan.assignments ?? []).map(assignment => assignment.taskId === 'pl-b'
        ? { ...assignment, instruction: 'PL-31 changed B instruction' } : assignment),
      { taskId: 'pl-c', role: S6A_WORK_ROLE.templateId, instruction: 'PL-31 added C instruction' }],
      obligations: skeleton.plan.obligations,
    });
    const proposed = (await workflow.main.post('plans/propose', graphWrite(S6A_SCOPE, {
      goalRef: workflow.goal, basedOn: skeleton.plan.ref, draft: v2Draft,
      reason: { text: 'PL-31 only B and C', sources: [], affectedTaskIds: ['pl-b', 'pl-c'] },
    }, 'pl-31-propose'))) as { status: string; value?: PlanProposal };
    expect(proposed.status, JSON.stringify(proposed)).toBe('committed');
    const candidate = proposed.value;
    if (candidate === undefined) throw new Error('PL-31: the v2 candidate was not written');
    const applied = (await workflow.main.post('plans/apply', graphWrite(S6A_SCOPE, {
      proposalRef: candidate.ref, expectedProposalRevision: candidate.revision, decisionRefs: [],
    }, 'pl-31-apply'))) as { status: string; value?: { planRevision?: number } };
    expect(applied.status, JSON.stringify(applied)).toBe('committed');
    const v2 = await workflow.main.activePlan(workflow.goal);
    if (v2 === null) throw new Error('PL-31: v2 is not the active Plan');
    expect(v2.planRevision).toBe(2);
    expect(v2.tasks.some(task => task.taskId === 'pl-c')).toBe(true);

    // A still reads v1: both the claim pointer and the Plan record the Run holds.
    const after = await readExecution(workflow.world.ag2b, held.run);
    expect(after.run.status).toBe('running');
    expect(after.outbox.claim.planRef).toEqual(skeleton.plan.ref);
    expect(after.plan.ref).toEqual(skeleton.plan.ref);
    expect(after.plan.planRevision).toBe(1);
    expect(after.plan.tasks.find(task => task.taskId === 'pl-a')?.title).toBe('PL stage 1 pl-a');
    expect(after.plan.assignments?.find(assignment => assignment.taskId === 'pl-a')?.instruction)
      .toBe('PL pl-31 pl-a');
    expect(after.plan.tasks.some(task => task.taskId === 'pl-c')).toBe(false);

    // C's Run is on v2 (the added Task is not frozen to A's claim).
    const cLine = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
      label: 'pl-31-c-line', role: S6A_WORK_ROLE,
      tasks: [{ projectId: workflow.goal.projectId, goalId: workflow.goal.goalId, taskId: 'pl-c' }],
    }));
    const cRun = await satisfyPLTask(workflow.world, workflow.goal, 'pl-c', cLine, 'pl31c');
    const cExecution = await readExecution(workflow.world.ag2b, cRun);
    expect(cExecution.outbox.claim.planRef).toEqual(v2.ref);
    expect(cExecution.plan.ref).toEqual(v2.ref);
    expect(cExecution.plan.planRevision).toBe(2);

    // Negative branch: v3 changes A's execution definition; the existing trace
    // guard refuses and nothing moves.
    const v3Draft = plPlanChangeDraft(v2, workflow.goal, {
      planId: 'pl-plan-pl-31-neg',
      tasks: v2.tasks.map(task => task.taskId === 'pl-a' ? { ...task, title: 'PL-31 changed A' } : task),
      assignments: (v2.assignments ?? []).map(assignment => assignment.taskId === 'pl-a'
        ? { ...assignment, instruction: 'PL-31 changed A instruction' } : assignment),
      obligations: v2.obligations,
    });
    const negProposed = (await workflow.main.post('plans/propose', graphWrite(S6A_SCOPE, {
      goalRef: workflow.goal, basedOn: v2.ref, draft: v3Draft,
      reason: { text: 'PL-31 changes an entered task', sources: [], affectedTaskIds: ['pl-a'] },
    }, 'pl-31-neg-propose'))) as { status: string; value?: PlanProposal };
    expect(negProposed.status, JSON.stringify(negProposed)).toBe('committed');
    const negCandidate = negProposed.value;
    if (negCandidate === undefined) throw new Error('PL-31: the negative candidate was not written');
    const refused = (await workflow.main.post('plans/apply', graphWrite(S6A_SCOPE, {
      proposalRef: negCandidate.ref, expectedProposalRevision: negCandidate.revision, decisionRefs: [],
    }, 'pl-31-neg-apply'))) as { status: string; code?: string; reason?: string };
    expect(refused.status, JSON.stringify(refused)).toBe('rejected');
    expect(refused.code).toBe('revision_conflict');
    expect(refused.reason ?? '').toContain('already has a Run');
    const stillV2 = ready<{ goal: { activePlanRevision: { planId: string; planRevision?: number } | null } }>(
      await workflow.world.post('goals/read', { scope: { ...S6A_SCOPE }, input: workflow.goal }), 'goals/read');
    expect(stillV2.goal.activePlanRevision?.planId).toBe(v2.ref.planId);
    const still = await readExecution(workflow.world.ag2b, held.run);
    expect(still.plan.ref).toEqual(skeleton.plan.ref);
    // The refused v3 leaves A's instruction where it was, in the Run's Plan and in the active one.
    expect(still.plan.assignments?.find(assignment => assignment.taskId === 'pl-a')?.instruction)
      .toBe('PL pl-31 pl-a');
    expect((await workflow.main.activePlan(workflow.goal))?.assignments
      ?.find(assignment => assignment.taskId === 'pl-a')?.instruction).toBe('PL pl-31 pl-a');
  } finally {
    await held.release();
  }
});
