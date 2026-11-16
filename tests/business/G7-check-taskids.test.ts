/**
 * G7P (decision 121-133, `g7-rulings.md` "测试行" P1a). The S9 review world's recipe (S9-review-fixture.ts:124-153) with
 * the Host's checks as input (as S6C S7): a README check listing only `task-1` and an `"all"` check. Goal 2 adopts a
 * plan whose `t-users` needs a static check; its Run ends on `workflow/advance`, the drive stops before `run_check`, and
 * `verification/round` reads the round. Memory only (S3). Red today at the check list (`['g7-readme', 'g7-all']`): the
 * round takes every check of a covering kind (`verification.ts:355`, `verification-plan.ts:103`), never `taskIds`.
 * Green when the round keeps the checks that apply to its Task. Mutation: the choice ignores `taskIds` (today's code).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { VerificationRoundRef } from '../../src/contracts/verification.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import { advanceUntil, driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { adoptPLPlanDraft } from '../helpers/PL-workflow-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine, governS6B } from '../helpers/S6B1-fixture.js';
import { checkConfiguration, ready, receiptOf, sessionOf } from '../helpers/S7A-fixture.js';
import { workTask } from '../scenarios/support/plan.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

const command = (checkId: string, taskIds: 'all' | readonly string[]) =>
  ({ checkId, kind: 'static' as const, command: 'echo G7_CHECK_OK', cwd: '.', timeoutMs: 60_000, taskIds });

/** The new Goal's plan: `t-users` and the Goal gate under one required static obligation. */
const usersPlan = (goalId: string): PlanRevisionDraft => ({
  schemaVersion: 2, planId: 'g7-p1a-plan', planRevision: 1, goalId, stages: [],
  tasks: [workTask('t-users', 'G7 users list'), { taskId: 'g7-gate', title: 'G7 Goal gate', requirementLevel: 'required',
    taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
  assignments: [{ taskId: 't-users', role: S6A_WORK_ROLE.templateId, instruction: 'List the users' }],
  obligations: [{ obligationId: 'g7-acceptance', title: 'G7 users acceptance', requirementLevel: 'required',
    taskIds: ['t-users', 'g7-gate'], verificationRequirements: [{ requirementId: 'g7-static',
      requirementLevel: 'required', kind: 'static', description: 'Registered static command check' }] }],
  taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
});

describe('G7P P1a: a check runs only in the rounds of the Tasks its taskIds name', () => {
  it('P1a: the check round of t-users holds the "all" check and not the one listing only task-1', async () => {
    const world = await openS6AHostWorld({ backend: 'memory', extraHostOptions: { checks: {
      ...checkConfiguration({ kind: 'human', id: OPERATOR.id }),
      checks: [command('g7-readme', ['task-1']), command('g7-all', 'all')] } } });
    worlds.push(world);
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    await governS6B(world, main, world.goals);
    const goal = world.goals.second;
    await adoptPLPlanDraft(main, goal, usersPlan(goal.goalId), 'g7-p1a');
    const line = await sessionOf(world, await createS6BLine(main, { label: 'g7-p1a-line', role: S6A_WORK_ROLE,
      tasks: [{ projectId: goal.projectId, goalId: goal.goalId, taskId: 't-users' }] }));
    await world.scripted.script(line, [{ kind: 'text', text: 'G7 P1a users listed' }]);
    const claim = await advanceUntil(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 'g7-p1a',
      sessionHint: line.ref, kind: 'select_work', taskId: 't-users' }, 'claim_task');
    const receipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(world.ag2b, claim, { receipts, stopBefore: 'run_check' });
    const roundRef = (receiptOf(receipts, 'open_checks')?.result as { value: { ref: VerificationRoundRef } }).value.ref;
    const round = ready<{ checks: { checkId: string }[] }>(await world.post('verification/round',
      plain(S6A_SCOPE, { roundRef })), 'verification/round');
    expect(round.checks.map(entry => entry.checkId)).toEqual(['g7-all']);
  }, 120_000);
});
