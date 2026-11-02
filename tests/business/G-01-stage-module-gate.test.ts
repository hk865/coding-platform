/**
 * PL G-01 (stage and module cells): a gate whose covered required work is
 * satisfied is selected before the next stage's `plan_only` placeholder keeps
 * `unfinishedWork` non-empty (spec §5.1.3). The public entry is
 * `workflow/driver-start`; the expectations come from the row (the cell's gate
 * `satisfied` while the later placeholder and the active Plan stay v1, then a
 * `refine:` reaches the adviser line). The module cell's gate covers a real
 * module-scope work task and its producer, never an empty coverage.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import {
  adoptPLTwoStageSkeleton, createPLReviewerLine, openPLWorkflowWorld, plStageTwoDraft, plSystemRoundRef,
  plToolPlanOf, requestHeads, satisfyPLTask, type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';
import { createPLAdviserLine } from '../helpers/PL-consumption-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';
import { readBody, readProposal, waitForResponse } from '../helpers/IV-host-fixture.js';
import { advanceUntil } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { PlanProposalRef } from '../../src/core/work-graph/model/plan-contracts.js';
import { checkConfiguration, ready, sessionOf } from '../helpers/S7A-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { waitFor } from '../scenarios/harness.js';
import { startGoalDriver, waitDriver } from '../helpers/DRV-fixture.js';

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });

const cells = [
  { cell: 'stage', moduleGate: undefined, moduleWork: null },
  { cell: 'module', moduleGate: { stageId: 'pl-stage-1', moduleRef: 's6a-core' }, moduleWork: 'pl-module-work' },
] as const;

/** One opened cell: the skeleton adopted, the covering work satisfied, an idle adviser line. */
async function satisfiedCell({ cell, moduleGate, moduleWork }: (typeof cells)[number]) {
  const workflow = opened = await openPLWorkflowWorld({ label: `pl-g01-${cell}`,
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, {
    label: `pl-g01-${cell}`, stageOneTaskIds: ['pl-a'],
    ...(moduleGate === undefined ? {} : { moduleGate }),
  });
  const responsible = skeleton.tasks.filter(task =>
    task.taskId === 'pl-a' || (moduleWork !== null && task.taskId === moduleWork));
  const line = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: `pl-g01-work-${cell}`, role: S6A_WORK_ROLE, tasks: responsible,
  }));
  const adviser = await createPLAdviserLine(workflow.world, `pl-g01-adviser-${cell}`);
  // The covering work completes through its real claim and check round.
  await satisfyPLTask(workflow.world, workflow.goal, 'pl-a', line, `g01-${cell}`);
  if (moduleWork !== null) await satisfyPLTask(workflow.world, workflow.goal, moduleWork, line, `g01-${cell}`);
  return { workflow, skeleton, adviser };
}

describe('PL G-01: a stage/module gate passes before a later plan_only placeholder', () => {
  it.each(cells)('$cell gate', async (input) => {
    const { cell, moduleWork } = input;
    const { workflow, skeleton, adviser } = await satisfiedCell(input);

    // The Host consumes the refine round on the adviser line; the answer writes the
    // real stage-2 candidate (no reviewer line here, so it becomes a card, not an adoption).
    const placeholder = skeleton.plan.tasks.find(task => task.taskId === 'pl-placeholder-pl-stage-2');
    const stage = skeleton.plan.stages.find(entry => entry.stageId === 'pl-stage-2');
    const obligation = skeleton.plan.obligations.find(entry => entry.obligationId === 'pl-obligation-stage-2');
    if (placeholder === undefined || stage === undefined || obligation === undefined) {
      throw new Error('PL G-01: the stage-2 skeleton is incomplete');
    }
    await workflow.world.scripted.script(adviser, [{ kind: 'calls', calls: [{
      callId: `pl-g01-refine-${cell}`, name: 'submit_plan_round', args: {
        answerKind: 'plan', summary: `PL g01 ${cell} stage 2`,
        plan: { schemaVersion: 2, planId: skeleton.plan.planId,
          planRevision: skeleton.plan.planRevision + 1, goalId: workflow.goal.goalId,
          stages: [structuredClone(stage)],
          tasks: [{ ...structuredClone(placeholder), executionIntent: 'request_execution', estimatedLines: 10 }],
          assignments: [{ taskId: placeholder.taskId, role: S6A_WORK_ROLE.templateId,
            instruction: `PL g01 ${cell} stage 2 work` }],
          obligations: [structuredClone(obligation)],
          taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } },
        reason: { text: `PL g01 ${cell} stage 2`, affectedTaskIds: [placeholder.taskId] },
      } }] }]);
    // The real Goal driver advances the covered gate and then sends the refine.
    await startGoalDriver(workflow.world, workflow.goal, `pl-g01-${cell}-gate`);
    const gateId = cell === 'stage' ? 'pl-gate-pl-stage-1' : 'pl-gate-module';
    const graphOf = async () => ready<{ plan: { planRevision: number };
      tasks: Array<Record<string, unknown>> }>(
      await workflow.main.route('tasks/query', { goalRef: workflow.goal }), 'tasks/query');
    const graph = await waitFor(graphOf, read => read.tasks
      .find(task => (task['ref'] as { taskId?: string }).taskId === gateId)
      ?.effectivePhase === 'satisfied', `G-01: the ${cell} gate passes`);
    const gate = graph.tasks.find(task => (task['ref'] as { taskId?: string }).taskId === gateId);
    expect(gate).toMatchObject({ effectivePhase: 'satisfied' });
    if (moduleWork !== null) {
      const work = graph.tasks.find(task => (task['ref'] as { taskId?: string }).taskId === moduleWork);
      expect(work).toMatchObject({ effectivePhase: 'satisfied',
        definition: { scope: { kind: 'module', moduleRef: 's6a-core' }, taskKind: 'work' } });
    }
    const later = graph.tasks.find(task => (task['ref'] as { taskId?: string }).taskId === 'pl-placeholder-pl-stage-2');
    expect(later).toMatchObject({ effectivePhase: 'pending', definition: { executionIntent: 'plan_only' } });
    expect(graph.plan.planRevision).toBe(1);

    // The driver's own pass is observable, and the adviser line carries the refine
    // round after the gate was already satisfied.
    const roundsOf = async () => (await listed(workflow.world, 'inbox', adviser)).filter(message =>
      message.sender.kind === 'host' && message.sender.actor.kind === 'system');
    await waitDriver(workflow.world, workflow.goal, undefined, snapshot => snapshot.last !== null,
      'G-01: the Goal driver advances the gate and sends the refine');
    const rounds = await waitFor(roundsOf, messages => messages.length > 0,
      'G-01: the refine round reaches the adviser');
    const texts = await Promise.all(rounds.map(async message =>
      (await readBody(workflow.world, message.ref, 'message')).split('\n')[0] ?? ''));
    expect(texts.some(text => text.startsWith('refine:'))).toBe(true);
    expect(texts, 'G-01: the refine names this Goal, the later stage and the Plan revision')
      .toContain(`refine:${workflow.goal.goalId}:pl-stage-2:1`);
  });

  it.each(cells)('$cell gate: the refine is sent only after the gate passed', async (input) => {
    const { workflow, adviser } = await satisfiedCell(input);
    await workflow.world.scripted.script(adviser, [{ kind: 'text', text: 'PL g01 order reply' }]);
    const gateId = input.cell === 'stage' ? 'pl-gate-pl-stage-1' : 'pl-gate-module';
    // Public selection up to the unperformed refine send: everything before it has happened.
    const send = await advanceUntil(workflow.world.ag2b, { schemaVersion: 1, goalRef: workflow.goal,
      flowId: `pl-g01-${input.cell}-order`, sessionHint: null, kind: 'select_work' }, 'send_system_round');
    const graph = ready<{ tasks: Array<Record<string, unknown>> }>(
      await workflow.main.route('tasks/query', { goalRef: workflow.goal }), 'tasks/query');
    expect(graph.tasks.find(task => (task['ref'] as { taskId?: string }).taskId === gateId),
      'G-01: the gate passed before the refine send').toMatchObject({ effectivePhase: 'satisfied' });
    expect(await requestHeads(workflow, adviser), 'G-01: no refine before the gate').toEqual([]);

    const sent = await workflow.world.post('workflow/advance', plain(S6A_SCOPE, send));
    expect(sent.body, JSON.stringify(sent.body)).toMatchObject({ status: 'ready' });
    expect(await requestHeads(workflow, adviser)).toEqual([`refine:${workflow.goal.goalId}:pl-stage-2:1`]);
  });

  // G-01, G-02, G-12 name the same rule: a stage without a gate is a review matter,
  // never an admission refusal, so one row carries it.
  it('a model segment adding a stage with no stage gate is a candidate, and the gap is the review finding', async () => {
    const workflow = opened = await openPLWorkflowWorld({ label: 'pl-g01-no-gate',
      extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
    const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, {
      label: 'pl-g01-no-gate', stageOneTaskIds: ['pl-a'],
    });
    const line = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
      label: 'pl-g01-no-gate-work', role: S6A_WORK_ROLE, tasks: skeleton.tasks.filter(task => task.taskId === 'pl-a'),
    }));
    const adviser = await createPLAdviserLine(workflow.world, 'pl-g01-no-gate-adviser');
    const reviewer = await createPLReviewerLine(workflow.world, workflow.main, 'pl-g01-no-gate-reviewer');
    await satisfyPLTask(workflow.world, workflow.goal, 'pl-a', line, 'g01-no-gate');

    const refined = plStageTwoDraft(skeleton.plan, workflow.goal, 'g01-no-gate');
    const placeholder = refined.tasks.find(task => task.taskId === 'pl-placeholder-pl-stage-2');
    if (placeholder === undefined) throw new Error('PL G-01: the stage-2 placeholder is missing');
    const finding = { taskId: null, text: 'pl-stage-3 has no stage gate' };
    await workflow.world.scripted.script(adviser, [{ kind: 'calls', calls: [{
      callId: 'pl-g01-no-gate-refine', name: 'submit_plan_round', args: {
        answerKind: 'plan', summary: 'PL g01 a gate-less stage',
        plan: plToolPlanOf({ ...refined,
          stages: [{ stageId: 'pl-stage-2', title: 'PL stage 2' }, { stageId: 'pl-stage-3', title: 'PL stage 3' }],
          tasks: [placeholder, { taskId: 'pl-no-gate-later', stageId: 'pl-stage-3', title: 'PL stage 3 later',
            requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending',
            scope: { kind: 'stage', stageId: 'pl-stage-3' }, executionIntent: 'plan_only', sizeClass: 'small' }],
          assignments: (refined.assignments ?? []).filter(entry => entry.taskId === placeholder.taskId),
          obligations: refined.obligations.filter(entry => entry.obligationId === 'pl-obligation-stage-2') }),
        reason: { text: 'PL g01 a gate-less stage', affectedTaskIds: [placeholder.taskId] },
      } }] }]);
    await workflow.world.scripted.script(reviewer, [{ kind: 'calls', calls: [{
      callId: 'pl-g01-no-gate-review', name: 'submit_plan_review', args: { verdict: 'fix', findings: [finding] },
    }] }]);
    await workflow.world.scripted.script(adviser, [{ kind: 'text', text: 'PL g01 fix round reply' }]);
    await startGoalDriver(workflow.world, workflow.goal, 'pl-g01-no-gate-flow');

    const reviewRef = await plSystemRoundRef(workflow, reviewer, 'planreview:');
    const answered = await waitForResponse(workflow.world, reviewRef, 48);
    expect(answered.response, 'G-01: the gate-less candidate reaches its review').not.toBeNull();
    const head = (await readBody(workflow.world, reviewRef, 'message')).split('\n')[0] ?? '';
    const proposalRef: PlanProposalRef = { aggregateType: 'PlanProposal', projectId: workflow.goal.projectId,
      workspaceId: S6A_SCOPE.workspaceId, proposalId: head.slice('planreview:'.length).split(':')[0] ?? '' };
    const candidate = await readProposal(workflow.world, proposalRef);
    expect(candidate.draft.stages.map(stage => stage.stageId)).toContain('pl-stage-3');
    expect(candidate.draft.tasks.some(task => task.taskKind === 'gate' && task.scope.kind === 'stage'
      && task.scope.stageId === 'pl-stage-3'), 'G-01: the variant really has no stage-3 gate').toBe(false);
    const card = ready<{ exactReview: unknown }>(await workflow.main.route('decisions/candidate-card',
      { goalRef: workflow.goal, proposalRef }), 'decisions/candidate-card');
    expect(card.exactReview, 'G-01: the missing gate is the review finding')
      .toMatchObject({ status: 'ready', value: { status: 'decided', verdict: 'fix', findings: [finding] } });
  }, 120_000);
});
