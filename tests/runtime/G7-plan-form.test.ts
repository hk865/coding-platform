/**
 * G7P (decision 121-133, `g7-rulings.md` "测试行" P1b, P3) at the initial plan form. CPL's world and steps
 * (`CPL-form-answer.test.ts:57-73`): the S6B3 second workspace, a held `initial_coordination` round, a scripted
 * `submit_initial_plan`, a fixed second call; the saved answer and the refused call's output. Memory only (S3).
 * Both red today at `expect(refused?.status).toBe('rejected')` (the first form is accepted):
 * - P1b: `uncoveredRequirementIssues` (`answer-tools.ts:679-681`) matches a check by kind only, so a check listing only
 *   `task-1` covers `t-users`. Green when coverage uses the checks that apply to each Task. Mutation: coverage ignores
 *   `taskIds`. Reason: product rule (rulings P1) — that Task's check round could never pass.
 * - P3: `validatePlanDraft` has no witness rule. Green when it refuses witness on an obligation of a non-explore work
 *   Task. Mutation: that rule removed. Reason: product rule (rulings P3) — the witness check fails every Run that
 *   changes a file (`witness-check.ts:37-41`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FA_S6B3_FIXED_FORM, FA_S6B3_SERVED_ROLE } from '../helpers/FA-forms.js';
import {
  configureS6B3SecondWorkspace, holdS6B3RequestAnswer, openS6B3World, releaseS6B3DraftAnswer, type S6B3World,
} from '../helpers/S6B3-fixture.js';
import { toolOutputJson } from '../scenarios/support/common.js';

// The S6B3 second scope holds a real start commit, so the file owns the two backend mocks (CPL's pattern).
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6B3World[] = [];
afterEach(async () => { await Promise.allSettled(worlds.splice(0).map(world => world.close())); });

type Problem = { section: string; reason: string };
type Booked = { plan: { obligations: { obligationId: string; taskIds: string[] }[] }; setup: { checks: { taskIds: unknown }[] } };

const task = (taskId: string, extra: object = {}) => ({ taskId, title: taskId, requirementLevel: 'required',
  taskKind: 'work', disposition: 'active', scope: { kind: 'goal' }, executionIntent: 'request_execution', ...extra });
const GATE = { taskId: 'g7-gate', title: 'G7 goal gate', requirementLevel: 'required', taskKind: 'gate',
  disposition: 'active', scope: { kind: 'goal' } };
const obligation = (obligationId: string, taskIds: readonly string[], kind: string) => ({ obligationId,
  title: obligationId, requirementLevel: 'required', taskIds, verificationRequirements: [{
    requirementId: `${obligationId}-requirement`, requirementLevel: 'required', kind, description: `${kind} acceptance` }] });
const check = (checkId: string, taskIds: 'all' | readonly string[]) =>
  ({ checkId, kind: 'static', command: 'true', cwd: '.', timeoutMs: 60_000, taskIds });

/** One initial plan form on top of `FA_S6B3_FIXED_FORM` (its catalog, drafts and served role). */
function form(tasks: readonly object[], obligations: readonly object[], checks: readonly object[]) {
  return { ...FA_S6B3_FIXED_FORM, summary: 'G7 plan',
    plan: { stages: [], tasks, obligations, taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
      assignments: tasks.filter(entry => (entry as { taskKind: string }).taskKind === 'work').map(entry =>
        ({ taskId: (entry as { taskId: string }).taskId, role: FA_S6B3_SERVED_ROLE, instruction: 'G7 work' })) },
    setup: { ...FA_S6B3_FIXED_FORM.setup, checks,
      completionPolicy: { requirementKinds: ['static', 'witness'], minimumRequiredRequirementsPerObligation: 1 } } };
}

/** One held cold-start round: `first` is submitted, `fixed` is the second scripted submit of the same round. */
async function submitInitialPlans(label: string, first: object, fixed: object) {
  const world = await openS6B3World({ backend: 'memory' });
  worlds.push(world);
  const second = await configureS6B3SecondWorkspace(world, { name: label, goals: 2 });
  const call = (callId: string, args: object) => ({ kind: 'calls' as const,
    calls: [{ callId, name: 'submit_initial_plan', args: args as Record<string, unknown> }] });
  const held = await holdS6B3RequestAnswer(world, { scope: second.scope, label, goalId: null,
    executionKind: 'initial_coordination', reply: () => call(`${label}-first`, first) });
  world.host.scriptReplies([call(`${label}-fixed`, fixed)]);
  const answer = await releaseS6B3DraftAnswer(world, held);
  const refusedIn = world.host.model.requests.find(request =>
    request.messages.some(entry => entry.role === 'tool' && entry.callId === `${label}-first`));
  return { booked: JSON.parse(answer.answerText) as Booked,
    refused: toolOutputJson(refusedIn, `${label}-first`) as { status: string; problems: Problem[] } | undefined };
}

describe('G7P P1b: a check applies only to the Tasks its taskIds name, already at the form', () => {
  it('P1b: a static check listing only task-1 leaves t-users uncovered; the form names the Task and the requirement', async () => {
    const tasks = [task('t-users'), GATE];
    const obligations = [obligation('g7-acceptance', ['t-users', 'g7-gate'], 'static')];
    const { refused, booked } = await submitInitialPlans('g7p1b',
      form(tasks, obligations, [check('g7-readme', ['task-1'])]),
      form(tasks, obligations, [check('g7-readme', ['task-1']), check('g7-users-check', ['t-users', 'g7-gate'])]));
    expect(refused?.status, 'the first submit was accepted').toBe('rejected');
    expect(refused!.problems.some(problem => problem.reason.includes('t-users')
      && problem.reason.includes('g7-acceptance-requirement')), JSON.stringify(refused!.problems)).toBe(true);
    expect(booked.setup.checks.map(entry => entry.taskIds)).toEqual([['task-1'], ['t-users', 'g7-gate']]);
  }, 120_000);
});

describe('G7P P3: a witness requirement sits only on an obligation whose work Tasks are all explore Tasks', () => {
  it('P3: witness on an ordinary work Task is refused, naming the obligation and the Task; on the explore Task it is booked', async () => {
    const work = task('t1-remove');
    const explore = task('g7-explore', { sizeClass: 'explore' });
    const checks = [check('g7-static', 'all')];
    const { refused, booked } = await submitInitialPlans('g7p3',
      form([work, GATE], [obligation('g7-acceptance', ['t1-remove', 'g7-gate'], 'static'),
        obligation('g7-witness', ['t1-remove'], 'witness')], checks),
      form([explore, work, GATE], [obligation('g7-acceptance', ['t1-remove', 'g7-gate'], 'static'),
        obligation('g7-explore-read', ['g7-explore'], 'witness')], checks));
    expect(refused?.status, 'the first submit was accepted').toBe('rejected');
    expect(refused!.problems).toHaveLength(1);
    expect(refused!.problems[0]!.reason).toContain('g7-witness');
    expect(refused!.problems[0]!.reason).toContain('t1-remove');
    expect(booked.plan.obligations.map(entry => entry.obligationId)).toEqual(['g7-acceptance', 'g7-explore-read']);
  }, 120_000);
});

// E09F 第 3 件（lead 11-17）：平台满足不了 `decision`、`output-contract` 依赖（context-input-service.ts:621-627、
// :693-697），首版计划交表时就退回，写明“要等别的任务做完，用执行先后表达；要定的事交给参谋或人”（lead 11-17 18:0x
// 定的说法，不建议改用 artifact）。第二次交表把那条边换成这次不退回的种类（artifact），照常收下。
describe('E09F: a first plan with a dependency kind the platform cannot satisfy is refused at the form', () => {
  it('an output-contract edge is refused, naming the edge, its kind and the way out; an edge of another kind is booked', async () => {
    const tasks = [task('t-decide'), task('t-build'), GATE];
    const obligations = [obligation('g7-acceptance', ['t-decide', 't-build', 'g7-gate'], 'static')];
    const checks = [check('g7-static', 'all')];
    const withEdge = (kind: string) => { const base = form(tasks, obligations, checks);
      return { ...base, plan: { ...base.plan, executionDag: { dependsOn: [{ taskId: 't-build', dependsOnId: 't-decide',
        requires: { kind, label: 'the parseDate return shape' } }] } } }; };
    const { refused, booked } = await submitInitialPlans('e09f3', withEdge('output-contract'), withEdge('artifact'));
    expect(refused?.status, 'the first submit was accepted').toBe('rejected');
    expect(refused!.problems).toHaveLength(1);
    expect(refused!.problems[0]!.reason).toContain('t-build');
    expect(refused!.problems[0]!.reason).toContain('"output-contract"');
    expect(refused!.problems[0]!.reason).toContain('execution order (executionDag.dependsOn)');
    expect(refused!.problems[0]!.reason).toContain('to the adviser or the person');
    expect(refused!.problems[0]!.reason).not.toContain('"artifact"');
    expect((booked.plan as unknown as { executionDag: { dependsOn: { requires: { kind: string } }[] } })
      .executionDag.dependsOn.map(edge => edge.requires.kind)).toEqual(['artifact']);
  }, 120_000);
});
