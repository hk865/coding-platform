/**
 * G8A (decision 121-136, `g8-rulings.md` 测试行 C1, C4). World and steps: `G8-world.ts` (S6C host world, request driver,
 * a folder the person opens with write and commands). Real calls; public routes and the Host settings `snapshot` (the
 * workspace check configuration read A3 extends); memory only (S3). A plan's own checks ride beside `plan` on the
 * submit form (`g8PlanCall`). Both rows were red before the package at the round: the strict plan form refused the
 * key (`answer-tools.ts:455-464` at 0c56a8b9) and the round's only call ended without an answer.
 * - C1 (A1-A3): a project initialized with `g8-seed-check` for its seed Tasks only; a new Goal's plan round brings
 *   `g8-c1-check` for its own Tasks and passes (coverage counts the plan's checks); the person's `plans/apply` installs
 *   it, recorded as from this plan and approved by a person (what the snapshot adds against its read before the apply),
 *   and the new work Task's check round holds exactly it. Mutation: the plan round's plan cannot carry checks or the
 *   submit ignores them (today's code).
 * - C4 (A4): a second workspace of the S6A project; its Goal has plan v1; a secretary change of one new Task (which the
 *   platform adopts by itself, 121-112) brings the new `g8-c4-check`. A delegating wrapper around the Host's real
 *   plan-turn entry tells when the Host's own call has returned (before the package that call adopted such a change);
 *   then it is still a candidate: plan v1 stays, nothing is installed, the person's candidate card lists the check (id,
 *   kind, command, Task); the person's `plans/apply` installs it and adopts plan v2. Mutation named: the automatic
 *   adoption goes on with the new check (shown on the merged tree, red at the candidate).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_WORKBENCH_ROLE } from '../../src/app/runtime-configuration.js';
import type { PlanRoundEndResultV1, PlanTurnFactsV1 } from '../../src/business/workflow/ports.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import {
  g8Check, g8ModelId, g8NewGoal, g8PlanCall, g8PlanDraft, g8PlanForm, g8Steps, openG8Project, type G8Workspace,
} from '../helpers/G8-world.js';
import { adoptPLPlanDraft } from '../helpers/PL-workflow-fixture.js';
import { initializeProject } from '../helpers/S6A-history-fixture.js';
import { openS6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { addS7D2SecondWorkspace } from '../helpers/S7D2-role-line-world.js';
import { waitFor } from './harness.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.allSettled(cleanup.splice(0).reverse().map(close => close())); });

const ROLE = 'local-workbench';
type PlanTurnEntry = (ctx: CoreCallContext, turn: PlanTurnFactsV1) => Promise<PlanRoundEndResultV1>;
const planOf = async (steps: G8Workspace, goal: GoalRef) =>
  (await steps.read<{ plan: { planRevision: number; tasks: { taskId: string }[] } }>('tasks/query', { goalRef: goal })).plan;

describe('G8A: a later plan brings its own checks and whoever adopts it approves them', () => {
  it('C1: the new Goal\'s plan round brings a check; the person\'s adoption installs it; its Task\'s round holds it', async () => {
    const project = await openG8Project('g8-c1', [g8Check('g8-seed-check', ['g8-seed-work', 'g8-seed-gate'])]);
    cleanup.push(project.close);
    const check = g8Check('g8-c1-check', ['g8-c1-work', 'g8-c1-gate']);
    const flow = await g8NewGoal(project, 'g8-c1', [g8PlanCall('g8-c1-plan', g8PlanForm('g8-c1', ROLE, [check]))]);
    const round = await project.readRound(flow.requestRoot, flow.planRound);
    expect({ status: round.status, closeCode: round.closeCode }, JSON.stringify(round))
      .toEqual({ status: 'ended', closeCode: null });
    const head = await project.candidate(flow.goal, flow.requestRoot);
    // The person opens an executor line and installs its script before adopting: the platform starts the driver when
    // this Goal-card Goal's first plan is adopted, and it runs the Task and opens its check round at once.
    const executor = await project.line('g8-c1-executor', LOCAL_WORKBENCH_ROLE);
    await project.world.scripted.script(executor, [{ kind: 'text', text: 'G8 C1 done' }], project.scope);
    const before = JSON.stringify(await project.settingsEntry());
    expect(await project.apply(flow.goal, head, 'g8-c1-apply')).toMatchObject({ status: 'committed' });
    const workspace = await project.settingsEntry();
    expect(workspace.checks?.map(entry => entry.checkId).sort()).toEqual(['g8-c1-check', 'g8-seed-check']);
    expect(workspace.checks?.find(entry => entry.checkId === 'g8-c1-check')).toMatchObject(check);
    const after = JSON.stringify(workspace);
    expect([head.draft.planId, head.ref.proposalId].some(id => !before.includes(id) && after.includes(id)), after).toBe(true);
    expect(after, 'the approval names the person').toContain('"approvedBy":{"kind":"person"}');
    expect(before).not.toContain('"approvedBy":{"kind":"person"}');

    const planRef = (await project.read<{ goal: { activePlanRevision: unknown } }>('goals/read', flow.goal)).goal
      .activePlanRevision;
    const node = { kind: 'task', ref: { projectId: flow.goal.projectId, goalId: flow.goal.goalId, taskId: 'g8-c1-work' },
      planRef };
    const rounds = await waitFor(async () => (await project.read<{ items: { round: { ref: unknown } }[] }>('graph/look', {
      goalRef: flow.goal, target: { kind: 'node', node }, relation: 'checks', page: { afterCursor: null, limit: 10 } })).items,
    items => items.length > 0, 'the check round of g8-c1-work');
    expect((await project.read<{ checks: { checkId: string }[] }>('verification/round', { roundRef: rounds[0]!.round.ref }))
      .checks.map(entry => entry.checkId)).toEqual(['g8-c1-check']);
  }, 180_000);

  it('C4: a change the platform would adopt brings a new check: a card for the person, who installs and adopts', async () => {
    const world = await openS6AHostWorld({ backend: 'memory', extraHostOptions: { requestDriver: 'on' } });
    cleanup.push(() => world.close());
    await initializeProject(world);
    const second = await addS7D2SecondWorkspace(world, 'g8-c4', { writeAllowed: true, commandsAllowed: true });
    cleanup.push(second.remove);
    expect((await world.settings('models/select', { scope: second.scope, modelId: await g8ModelId(world) })).status)
      .toBe('ready');
    const steps = g8Steps(world, second.scope, 'g8-c4');
    await adoptPLPlanDraft(second.workspace, second.goal, g8PlanDraft(second.goal, 'g8-c4-base', ROLE), 'g8-c4');
    // The completion barrier (RULES A3, review g8cr item 7): the Host reads `platform.workflow.proposeFromPlanTurn` on
    // each pass (`host.ts:1423-1464`); this wrapper calls the real entry unchanged and records what it returned.
    const workflow = world.platform.workflow as unknown as { proposeFromPlanTurn: PlanTurnEntry };
    const real = workflow.proposeFromPlanTurn;
    const turns = new Map<string, PlanRoundEndResultV1>();
    const spy = vi.spyOn(workflow, 'proposeFromPlanTurn').mockImplementation(async (ctx, turn) => {
      const result = await real.call(workflow, ctx, turn);
      turns.set(turn.ref.queryJobId, result);
      return result;
    });
    cleanup.push(async () => { spy.mockRestore(); });
    const check = g8Check('g8-c4-check', ['g8-c4-work'], 'echo G8_C4_CHECK');
    const secretary = await steps.line('g8-c4-change');
    await world.scripted.script(secretary, [g8PlanCall('g8-c4-plan', g8PlanForm('g8-c4', ROLE, [check], true))],
      steps.scope);
    const asked = await steps.ask('g8-c4-change', secretary, second.goal);
    const round = await steps.readRound(asked.requestRoot, asked.round);
    expect({ status: round.status, closeCode: round.closeCode }, JSON.stringify(round))
      .toEqual({ status: 'ended', closeCode: null });
    expect(await waitFor(async () => turns.get(asked.round.queryJobId), result => result !== undefined,
      'the Host\'s own plan turn of the round')).toEqual({ status: 'done' });
    const head = (await steps.read<{ head: PlanProposal | null }>('plans/request-candidate',
      { goalRef: second.goal, requestRef: asked.requestRoot })).head;
    expect(head?.status, 'the platform adopted the plan bringing a new check').toBe('candidate');
    expect((await planOf(steps, second.goal)).planRevision).toBe(1);
    expect(JSON.stringify(await steps.settingsEntry())).not.toContain('g8-c4-check');
    const queue = await steps.read<DecisionQueueReadV1>('decisions/queue', { workspace: steps.scope,
      goalRef: second.goal, sections: ['waiting_answer'], page: { limit: 100 } });
    const card = JSON.stringify(queue.waitingAnswer.find(item => item.source.kind === 'candidate'
      && item.requestRef?.queryJobId === asked.requestRoot.queryJobId) ?? null);
    for (const fact of ['g8-c4-check', '"static"', 'echo G8_C4_CHECK', 'g8-c4-work']) {
      expect(card, `the card lists ${fact}`).toContain(fact);
    }

    expect(await steps.apply(second.goal, head!, 'g8-c4-apply')).toMatchObject({ status: 'committed' });
    const plan = await planOf(steps, second.goal);
    expect({ revision: plan.planRevision, adds: plan.tasks.some(task => task.taskId === 'g8-c4-work') })
      .toEqual({ revision: 2, adds: true });
    expect((await steps.settingsEntry()).checks?.find(item => item.checkId === 'g8-c4-check')).toMatchObject(check);
  }, 180_000);
});
