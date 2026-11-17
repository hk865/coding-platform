/**
 * CPL (decision 121-128, `cpl-rulings.md` rows C4, C6, C7, C10, C11): what `plans/propose` + `plans/apply` adopt.
 *
 * World: `openS7AWorkSetup` (memory): governance with the `['static']` policy, the Host's static echo check for every
 * Task, and goal `s7a-goal` with the adopted AG2b plan (two `request_execution` work Tasks, the Goal gate, one required
 * static obligation mapping all three). Other goals come from `goals/create`; a check configuration change is the
 * Host's own input (`registerCheckConfiguration`, rule sheet A8). Reads: `goals/read`, `tasks/query`.
 *
 * Today (54b74ac3): C4 is green and stays green (`plan_only` keeps its exemption; the plan_only-only plan with no
 * gate is W2-future-intent's first row, so it is not repeated here). C6 fails at
 * `expect(applied.status).toBe('rejected')`: neither adoption site (`plan-service.ts:1708`, `:3260`) judges check
 * coverage, so the plan whose static requirement no installed check covers is adopted; green once CPL-2 refuses it.
 * C7 fails at `expect(proposal.issues…)`: `plan-validation.ts:93` exempts `request_execution` work from the template,
 * so the gate-less plan carries no issue and is adopted; green once CPL-1 holds that work to the template.
 * C10 fails at the same `proposal.issues` line: besides that exemption, the mapping loop (`plan-validation.ts:106`)
 * reads only goal gates; green once R1 maps every required active gate. C11 fails at `expect(applied.status)`: change
 * adoption judges no coverage; green once CPL-2 (S1 + R2) judges the obligation whose requirementLevel changed.
 * The refusals guard a product rule: a Goal completes only through its goal gate and covered required obligations
 * (97-3; `completion-policy.ts:171-212`), so a plan that can never complete is not adopted.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { ag2bChecksConfiguration, ag2bPlanDraft, graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { plPlanChangeDraft, plSkeletonDraft } from '../helpers/PL-workflow-fixture.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { governS6B } from '../helpers/S6B1-fixture.js';
import { openS7AWorkSetup } from '../helpers/S7A-fixture.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => { await Promise.allSettled(worlds.splice(0).map(world => world.close())); });

async function openPlanWorld() {
  const setup = await openS7AWorkSetup({ backend: 'memory' });
  worlds.push(setup.world);
  return { ...setup, main: s6aCardsWorkspace(setup.world, S6A_SCOPE) };
}

type Proposal = { ref: unknown; revision: number; issues: { code: string; message: string }[] };
/** `plans/propose` (must commit) then `plans/apply`; the proposal and the apply body as returned. */
async function proposeApply(main: S6ACardsWorkspace, goal: GoalRef, basedOn: unknown, draft: PlanRevisionDraft, label: string) {
  const proposed = await main.post('plans/propose', graphWrite(main.scope, { goalRef: goal, basedOn, draft,
    reason: { text: `CPL ${label}`, sources: [] } }, `cplt-${label}-propose`)) as { status: string; value: Proposal };
  expect(proposed.status, JSON.stringify(proposed)).toBe('committed');
  const applied = await main.post('plans/apply', graphWrite(main.scope, { proposalRef: proposed.value.ref,
    expectedProposalRevision: proposed.value.revision, decisionRefs: [] }, `cplt-${label}-apply`)) as
    { status: string; code?: string; reason?: string };
  return { proposal: proposed.value, applied };
}
const activePlanOf = async (main: S6ACardsWorkspace, goal: GoalRef) =>
  ((await main.route('goals/read', goal)) as { value: { goal: { activePlanRevision: unknown } } }).value.goal.activePlanRevision;
/** The AG2b draft for `goal` with its work Tasks assigned to the world's Work role (`adoptS6BPlan`'s draft). */
const ag2bFor = (goal: GoalRef, planId: string, workIds = ['cplt-1', 'cplt-2']): PlanRevisionDraft => ({
  ...ag2bPlanDraft(workIds), planId, goalId: goal.goalId,
  assignments: workIds.map(taskId => ({ taskId, role: S6A_WORK_ROLE.templateId, instruction: `CPL ${taskId}` })) });

describe('C4: the plan_only placeholder of a PL skeleton stays exempt from the template', () => {
  // Mutation: plan_only work also held to the template -> C4 is refused for its unmapped placeholder.
  it.each([
    { row: 'C4 PL skeleton with the goal gate and an unmapped stage-2 placeholder', placeholder: 'pl-placeholder-pl-stage-2',
      draft: (goal: GoalRef): PlanRevisionDraft => {
        const skeleton = plSkeletonDraft(goal, { label: 'cplt-c4', goalGate: true });
        return { ...skeleton, obligations: skeleton.obligations.map(obligation => ({ ...obligation,
          taskIds: obligation.taskIds.filter(taskId => taskId !== 'pl-placeholder-pl-stage-2') })) };
      } },
  ])('$row is adopted', async ({ row, placeholder, draft }) => {
    const { main } = await openPlanWorld();
    const label = row.slice(0, 2).toLowerCase();
    const goal = (await main.createGoal(`cplt-${label}`)).ref;
    const { applied } = await proposeApply(main, goal, null, draft(goal), label);
    expect(applied.status, JSON.stringify(applied)).toBe('committed');
    expect((await main.activePlan(goal))?.tasks.map(task => task.taskId)).toContain(placeholder);
  }, 120_000);
});

/** `draft` plus one new `request_execution` Task carried by a new required obligation of `kind` (`cplt-<label>-req`). */
const withNewObligation = (draft: PlanRevisionDraft, label: string, kind: string): PlanRevisionDraft => ({ ...draft,
  tasks: [...draft.tasks, { taskId: `cplt-${label}-new`, title: 'CPL new work', requirementLevel: 'required', taskKind: 'work',
    disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' }],
  assignments: [...(draft.assignments ?? []), { taskId: `cplt-${label}-new`, role: S6A_WORK_ROLE.templateId, instruction: 'CPL' }],
  obligations: [...draft.obligations, { obligationId: `cplt-${label}-acceptance`, title: 'CPL new acceptance',
    requirementLevel: 'required', taskIds: [`cplt-${label}-new`], verificationRequirements: [{ requirementId: `cplt-${label}-req`,
      requirementLevel: 'required', kind, description: `CPL ${kind} check` }] }] });
const dynamicOnly = (world: S6AHostWorld, label: string) => world.platform.registerCheckConfiguration({
  configuration: ag2bChecksConfiguration({ actor: world.ag2b.actor, kind: 'dynamic', revision: `cplt-${label}-dynamic@1` }) });

describe('C6: adoption refuses a required requirement no installed check covers', () => {
  // Mutation: the adoption site judges no coverage -> its cell adopts the plan.
  it.each([
    { cell: 'initial adoption (no active plan)', existing: false },
    { cell: 'change adoption (the active plan moves)', existing: true },
  ])('$cell: refused naming the requirement; the active plan revision is unchanged', async ({ existing }) => {
    const { world, main, goal: adopted, plan } = await openPlanWorld();
    const goal = existing ? adopted : (await main.createGoal('cplt-c6')).ref;
    const draft = withNewObligation(existing
      ? { ...ag2bPlanDraft(['s7a-run-1', 's7a-run-2']), planId: 'cplt-c6-move', goalId: goal.goalId,
        planRevision: plan.planRevision + 1, assignments: plan.assignments ?? [] }
      : ag2bFor(goal, 'cplt-c6'), 'c6', 'static');
    // The Host's installed configuration now has only a dynamic check; `cplt-c6-req` requires `static`.
    dynamicOnly(world, 'c6');
    const before = await activePlanOf(main, goal);
    const { applied } = await proposeApply(main, goal, existing ? plan.ref : null, draft, 'c6');
    expect(applied.status, JSON.stringify(applied)).toBe('rejected');
    expect(applied.reason).toContain('cplt-c6-req');
    expect(await activePlanOf(main, goal)).toEqual(before);
  }, 120_000);
});

describe('C7: adoption refuses request_execution work without a goal gate', () => {
  // Mutation: the initial adoption site bypasses `validatePlanDraft` -> the gate-less plan is adopted.
  it('the proposal carries missing_active_required_goal_gate and plans/apply refuses it; nothing is adopted', async () => {
    const { main } = await openPlanWorld();
    const goal = (await main.createGoal('cplt-c7')).ref;
    const full = ag2bFor(goal, 'cplt-c7');
    const gateless = { ...full, tasks: full.tasks.filter(task => task.taskKind === 'work'),
      obligations: full.obligations.map(obligation => ({ ...obligation, taskIds: ['cplt-1', 'cplt-2'] })) };
    const { proposal, applied } = await proposeApply(main, goal, null, gateless, 'c7');
    expect(proposal.issues.map(issue => issue.code)).toContain('missing_active_required_goal_gate');
    expect(applied).toMatchObject({ status: 'rejected', code: 'incomplete' });
    expect(await activePlanOf(main, goal)).toBeNull();
  }, 120_000);
});

describe('C10 (R1): every required active stage gate is mapped by a required obligation', () => {
  // Mutation: the mapping loop skips stage gates -> the plan with the unmapped stage gate is adopted.
  it('plans/apply refuses the unmapped stage gate (task_obligation_mapping); nothing is adopted', async () => {
    const { main } = await openPlanWorld();
    const goal = (await main.createGoal('cplt-c10')).ref;
    const full = ag2bFor(goal, 'cplt-c10');
    const draft: PlanRevisionDraft = { ...full, stages: [{ stageId: 'cplt-c10-stage', title: 'CPL C10 stage' }],
      tasks: [...full.tasks, { taskId: 'cplt-c10-stage-gate', title: 'CPL C10 stage gate', requirementLevel: 'required',
        taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: 'cplt-c10-stage' } }] };
    const { proposal, applied } = await proposeApply(main, goal, null, draft, 'c10');
    expect(proposal.issues.filter(issue => issue.code === 'task_obligation_mapping').map(issue => issue.message))
      .toEqual([expect.stringContaining('cplt-c10-stage-gate')]);
    expect(applied).toMatchObject({ status: 'rejected', code: 'incomplete', reason: expect.stringContaining('cplt-c10-stage-gate') });
    expect(await activePlanOf(main, goal)).toBeNull();
  }, 120_000);
});

describe('C11 (R2): change adoption judges an obligation promoted from optional to required', () => {
  // Mutation: the change filter compares obligations without requirementLevel -> the promoted one is not judged.
  it('refused naming its static requirement; the active plan is unchanged', async () => {
    // World: SB06's governance step (`SB06-witness-fixture.ts:78-80`) with a static + dynamic policy, no Host checks.
    const world = await openS6AHostWorld({ backend: 'memory' });
    worlds.push(world);
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    await world.setResumeOnStartup(false);
    await (await governS6B(world, main, world.goals)).activatePolicy({ content: { schemaVersion: 1,
      requirementKinds: ['static', 'dynamic'], minimumRequiredRequirementsPerObligation: 1 } });
    const goal = world.goals.first;
    const source = ag2bFor(goal, 'cplt-c11');
    const later = { obligationId: 'cplt-c11-later', title: 'CPL C11 later acceptance', requirementLevel: 'optional' as const,
      taskIds: ['cplt-1', 'cplt-2'], verificationRequirements: [{ requirementId: 'cplt-c11-static',
        requirementLevel: 'required' as const, kind: 'static', description: 'CPL C11 static check' }] };
    const adopted = await proposeApply(main, goal, null, { ...source, obligations: [...source.obligations, later] }, 'c11-source');
    expect(adopted.applied.status, JSON.stringify(adopted.applied)).toBe('committed');
    const plan = (await main.activePlan(goal))!;
    const before = await activePlanOf(main, goal);
    dynamicOnly(world, 'c11');
    const change = withNewObligation({ ...source, planId: 'cplt-c11-move', planRevision: plan.planRevision + 1,
      obligations: [...source.obligations, { ...later, requirementLevel: 'required' }] }, 'c11', 'dynamic');
    const { applied } = await proposeApply(main, goal, plan.ref, change, 'c11');
    expect(applied.status, JSON.stringify(applied)).toBe('rejected');
    expect(applied.reason).toContain('cplt-c11-static');
    expect(await activePlanOf(main, goal)).toEqual(before);
  }, 120_000);
});

describe('E08: a later revision never adds a task that starts cancelled or superseded', () => {
  // G6 第六次 E08：改计划时模型新造了一个一出生就是已取消的副本，原任务照旧 active，计划自相矛盾。上一版没有这个
  // 任务号、disposition 却是 cancelled 或 superseded（lead 11-17：取代同理），交表和采用共用的 validatePlanDraft 照问题
  // 清单报出来，plans/apply 拒绝；把已有任务本身取消或取代照常采用；首版计划没有上一版，不查。期望值按这条规则手写。
  // 变异：去掉这条检查 -> 两格的第一段断言都转红；只查 cancelled -> superseded 那一格转红。
  type Ended = 'cancelled' | 'superseded';
  const born = (taskId: string, disposition: Ended): PlanRevisionDraft['tasks'][number] => ({ taskId,
    title: `CPL E08 ${disposition} copy`, requirementLevel: 'required', taskKind: 'work', disposition, phase: 'pending',
    scope: { kind: 'goal' }, ...(disposition === 'superseded' ? { replacedByTaskId: 's7a-run-1' } : {}) });
  const copyAssignment = (taskId: string) => ({ taskId, role: S6A_WORK_ROLE.templateId, instruction: 'CPL E08 copy' });
  const issueOf = (taskId: string, disposition: Ended) => ({ path: `tasks[${taskId}].disposition`,
    code: 'unsupported_execution_change', message: `new task ${taskId} starts ${disposition}: to cancel or supersede an `
      + 'existing task, set that task\'s own disposition and keep its taskId; a task that is new in this revision never '
      + 'starts cancelled or superseded' });

  it.each(['cancelled', 'superseded'] as const)('a new task that starts %s is an issue on propose and refused on apply; '
    + 'ending the task itself that way is adopted', async (disposition) => {
    const { main, goal, plan } = await openPlanWorld();
    const change = (planId: string, tasks: PlanRevisionDraft['tasks'], extra: ReturnType<typeof copyAssignment>[] = []) =>
      plPlanChangeDraft(plan, goal, { planId, tasks, assignments: [...(plan.assignments ?? []), ...extra],
        obligations: plan.obligations });
    const copy = await proposeApply(main, goal, plan.ref, change(`cplt-e08-${disposition}`,
      [...plan.tasks, born('cplt-e08-copy', disposition)], [copyAssignment('cplt-e08-copy')]), `e08-${disposition}`);
    expect(copy.proposal.issues).toEqual([issueOf('cplt-e08-copy', disposition)]);
    expect(copy.applied).toMatchObject({ status: 'rejected', code: 'unsupported',
      reason: expect.stringContaining(issueOf('cplt-e08-copy', disposition).message) });
    expect(await activePlanOf(main, goal)).toEqual(plan.ref);

    const itself = await proposeApply(main, goal, plan.ref, change(`cplt-e08-${disposition}-itself`, plan.tasks.map(task =>
      task.taskId === 's7a-run-2' ? { ...task, disposition,
        ...(disposition === 'superseded' ? { replacedByTaskId: 's7a-run-1' } : {}) } : task)), `e08-${disposition}-itself`);
    expect(itself.proposal.issues).toEqual([]);
    expect(itself.applied.status, JSON.stringify(itself.applied)).toBe('committed');
    expect((await main.activePlan(goal))?.tasks.find(task => task.taskId === 's7a-run-2')?.disposition).toBe(disposition);
  }, 120_000);

  it('a first plan has no earlier revision, so its cancelled task is not judged', async () => {
    const { main } = await openPlanWorld();
    const goal = (await main.createGoal('cplt-e08-first')).ref;
    const draft = ag2bFor(goal, 'cplt-e08-first');
    const { proposal, applied } = await proposeApply(main, goal, null,
      { ...draft, tasks: [...draft.tasks, born('cplt-e08-first-copy', 'cancelled')],
        assignments: [...(draft.assignments ?? []), copyAssignment('cplt-e08-first-copy')] }, 'e08-first');
    expect(proposal.issues).toEqual([]);
    expect(applied.status, JSON.stringify(applied)).toBe('committed');
  }, 120_000);
});
