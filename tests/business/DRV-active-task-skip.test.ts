/** DRV §5.1 D-G: the Goal-scope `select_work` skips the gate Task a live watch already advances, while the same selection without it returns the gate's `run_check`. */
// Named mutation: remove the `activeTaskIds` guard immediately before `advanceGate` in `src/business/workflow/workflow.ts` → the same selection returns the active gate's `run_check` step.

import { afterEach, describe, expect, it } from 'vitest';
import type {
  WorkflowAdvanceInput, WorkflowAdvanceInternal, WorkflowAdvanceResult,
} from '../../src/business/workflow/contracts.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { advanceUntil } from '../helpers/A2-restart-fixture.js';
import { AG2B_GATE_TASK_ID, ag2bPlanDraft, graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { checkConfiguration, committed, ready, sessionOf } from '../helpers/S7A-fixture.js';
import { openS7BWorld } from '../helpers/S7B-fixture.js';

const OPERATOR_HUMAN = { kind: 'human' as const, id: OPERATOR.id };
const WORK = 'drv-dg-work';
const GATE = AG2B_GATE_TASK_ID;
type World = Awaited<ReturnType<typeof openS7BWorld>>['world'];
const worlds: World[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

/** One Plan: an optional executable work Task (the gate's producer) and the required gate. */
async function adoptDgPlan(world: World, goal: GoalRef): Promise<void> {
  const base = ag2bPlanDraft([WORK]);
  const draft = { ...base, planId: 'drv-dg-plan', goalId: goal.goalId,
    tasks: base.tasks.map(task => task.taskKind === 'work'
      ? { ...task, requirementLevel: 'optional' as const } : task) };
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  const proposed = await main.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: goal, basedOn: null, draft, reason: { text: 'DRV D-G plan', sources: [] },
  }, 'drv-dg-propose'));
  const proposal = committed<{ ref: unknown; revision: number }>(proposed, 'the D-G Plan proposal');
  const applied = await main.post('plans/apply', graphWrite(S6A_SCOPE, {
    proposalRef: proposal.ref, expectedProposalRevision: proposal.revision, decisionRefs: [],
  }, 'drv-dg-apply'));
  committed(applied, 'the D-G Plan adoption');
}

describe('DRV Goal-scope selection skips an active gate Task (memory)', () => {
  it('D-G select_work skips the gate named by activeTaskIds instead of advancing it', async () => {
    const { world } = await openS7BWorld({ backend: 'memory',
      extraHostOptions: { checks: checkConfiguration(OPERATOR_HUMAN) } });
    worlds.push(world);
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    const goal = (await main.createGoal('drv-dg-goal', 'DRV D-G active gate task')).ref;
    await adoptDgPlan(world, goal);
    const work = { projectId: goal.projectId, goalId: goal.goalId, taskId: WORK };
    const gate = { projectId: goal.projectId, goalId: goal.goalId, taskId: GATE };
    const line = await createS6BLine(main, { label: 'drv-dg-work', role: S6A_WORK_ROLE, tasks: [work] });
    const session = await sessionOf(world, line);
    await world.scripted.script(session, [{ kind: 'text', text: 'DRV D-G work done' }]);

    const advanceWithActiveTasks = async (input: WorkflowAdvanceInput, internal?: WorkflowAdvanceInternal) =>
      ready<Extract<WorkflowAdvanceResult, { status: 'ready' }>['value']>(
        await world.platform.workflow.advanceWork(world.humanContext(), input, internal), 'the D-G Workflow advance');

    // Drive the optional work Run to its real normal end, and stop before the
    // short `open_checks` step (the check itself is never run).
    await advanceUntil(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 'drv-dg-work',
      sessionHint: session.ref, kind: 'select_work', taskId: WORK }, 'open_checks');
    const producer = await main.taskRun(goal, WORK);
    if (producer === null) throw new Error('D-G: the work Task has no ended Run');
    const plan = await main.activePlan(goal);
    if (plan === null) throw new Error('D-G: the Goal has no adopted Plan');

    // The real evidence owner opens the gate round on that producer Run; its one
    // static check is pending and has not run.
    const round = await world.platform.evidence.openVerification(world.humanContext(), {
      input: { subjectRunRef: producer, subject: gate, planRef: plan.ref, gateSubject: 'goal' },
      meta: { requestId: 'drv-dg-gate-round', expected: [] },
    });
    expect(round).toMatchObject({ status: 'committed' });

    const selection = { schemaVersion: 1 as const, goalRef: goal, flowId: 'drv-dg-select',
      sessionHint: null, kind: 'select_work' as const };
    // The gate is the next Task: its step continues the open round.
    const gateStep = await advanceWithActiveTasks(selection, { activeTaskIds: [WORK] });
    expect(gateStep.next).toMatchObject({ kind: 'perform', operation: { kind: 'run_check' } });
    const operation = (gateStep.next as Extract<WorkflowAdvanceInput, { kind: 'perform' }>).operation;
    expect((operation.request as { input: { roundRef: { taskId: string } } }).input.roundRef.taskId).toBe('ag2b-gate');

    // With the gate in the real internal `activeTaskIds`, the same selection
    // skips it instead of returning its step.
    const skipped = await advanceWithActiveTasks(selection, { activeTaskIds: [WORK, GATE] });
    expect(skipped.state).toBe('waiting');
    expect(skipped.next).toBeNull();
  }, 120_000);
});
