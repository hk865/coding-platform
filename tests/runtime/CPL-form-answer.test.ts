/**
 * CPL (decision 121-128, `cpl-rulings.md` rows C1, C2, C5): the secretary's initial plan form is held to the
 * completion template and to check coverage in the same round it is submitted, so the model can fix it there.
 *
 * Steps, all public: the S6B3 world's second workspace (cold start, no governance), a held `initial_coordination`
 * round whose scripted model calls `submit_initial_plan`, a second scripted call when the first is refused, then the
 * round's saved answer (`releaseS6B3DraftAnswer`) and the refused call's tool output. Forms are written here by hand
 * on top of `FA_S6B3_FIXED_FORM` (its catalog, drafts and served role); every task is goal-scoped.
 *
 * Red today (54b74ac3): C1, C2 and C5 (a) fail at `expect(refused?.status).toBe('rejected')` ("the first submit was
 * accepted"), because `validatePlanDraft` (`plan-validation.ts:93`) exempts `request_execution` work from the goal
 * gate + mapping template and layer 2 (`answer-tools.ts:676`) checks no coverage. They turn green when CPL-1 holds
 * that work to the template and CPL-2 judges `setup.checks` at the form. C5 (b) is green today and stays green.
 * Each refusal guards a product rule: a Goal completes only through its goal gate and covered required obligations
 * (97-3; `completion-policy.ts:171-212`), so a plan that cannot complete goes back to the model while it can fix it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FA_S6B3_FIXED_FORM, FA_S6B3_SERVED_ROLE } from '../helpers/FA-forms.js';
import {
  configureS6B3SecondWorkspace, holdS6B3RequestAnswer, openS6B3World, releaseS6B3DraftAnswer, type S6B3World,
} from '../helpers/S6B3-fixture.js';
import { toolOutputJson } from '../scenarios/support/common.js';

// The S6B3 second scope holds a real start commit, so the file owns the two backend mocks (FA-answer-tool's pattern).
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6B3World[] = [];
afterEach(async () => { await Promise.allSettled(worlds.splice(0).map(world => world.close())); });

type Problem = { section: string; reason: string };
/** The booked answer's members the rows read. */
type Booked = { plan: { obligations: { taskIds: string[]; verificationRequirements: { kind: string }[] }[] };
  setup: { checks: { kind: string }[] } };
const WORK = { taskId: 'cplt-work', title: 'CPL work', requirementLevel: 'required', taskKind: 'work',
  disposition: 'active', scope: { kind: 'goal' }, executionIntent: 'request_execution' } as const;
const GATE = { taskId: 'cplt-gate', title: 'CPL goal gate', requirementLevel: 'required', taskKind: 'gate',
  disposition: 'active', scope: { kind: 'goal' } } as const;
const check = (checkId: string, kind: 'static' | 'dynamic') =>
  ({ checkId, kind, command: 'true', cwd: '.', timeoutMs: 60_000, taskIds: 'all' as const });

/** One initial plan form: the tasks, the ids its one required obligation maps, its requirement kind, the checks. */
function form(input: { tasks: readonly object[]; mapped: readonly string[]; checks: readonly object[];
  kind?: string; kinds?: readonly string[] }) {
  return { ...FA_S6B3_FIXED_FORM, summary: 'CPL plan',
    plan: { stages: [], tasks: input.tasks,
      assignments: [{ taskId: WORK.taskId, role: FA_S6B3_SERVED_ROLE, instruction: 'CPL work' }],
      obligations: [{ obligationId: 'cplt-acceptance', title: 'CPL acceptance', requirementLevel: 'required',
        taskIds: input.mapped, verificationRequirements: [{ requirementId: 'cplt-requirement',
          requirementLevel: 'required', kind: input.kind ?? 'static', description: 'CPL requirement' }] }],
      taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } },
    setup: { ...FA_S6B3_FIXED_FORM.setup, checks: input.checks,
      completionPolicy: { requirementKinds: input.kinds ?? ['static', 'dynamic'], minimumRequiredRequirementsPerObligation: 1 } } };
}

/** One held cold-start round: `first` is submitted, `fixed` (if any) is the second scripted submit of the same round. */
async function submitInitialPlans(label: string, first: object, fixed: object | null) {
  const world = await openS6B3World({ backend: 'memory' });
  worlds.push(world);
  const second = await configureS6B3SecondWorkspace(world, { name: label, goals: 2 });
  const call = (callId: string, args: object) => ({ kind: 'calls' as const,
    calls: [{ callId, name: 'submit_initial_plan', args: args as Record<string, unknown> }] });
  const held = await holdS6B3RequestAnswer(world, { scope: second.scope, label, goalId: null,
    executionKind: 'initial_coordination', reply: () => call(`${label}-first`, first) });
  if (fixed !== null) world.host.scriptReplies([call(`${label}-fixed`, fixed)]);
  const answer = await releaseS6B3DraftAnswer(world, held);
  const refusedIn = world.host.model.requests.find(request =>
    request.messages.some(entry => entry.role === 'tool' && entry.callId === `${label}-first`));
  return { world, booked: JSON.parse(answer.answerText) as Booked,
    refused: toolOutputJson(refusedIn, `${label}-first`) as { status: string; problems: Problem[] } | undefined };
}

const FIXED = form({ tasks: [WORK, GATE], mapped: ['cplt-work', 'cplt-gate'], checks: [check('cplt-static', 'static')] });

describe('C1, C2: request_execution work is held to the goal gate + mapping template at the form', () => {
  // Mutations: C1 — CPL-1 back to the old exemption; C2 — the mapping loop removed. Each refused form has one problem.
  it.each([
    { row: 'C1 no goal gate', first: form({ tasks: [WORK], mapped: ['cplt-work'], checks: [check('cplt-static', 'static')] }),
      names: (reason: string) => /goal/i.test(reason) && /gate/i.test(reason) },
    { row: 'C2 work not mapped', first: form({ tasks: [WORK, GATE], mapped: ['cplt-gate'], checks: [check('cplt-static', 'static')] }),
      names: (reason: string) => reason.includes('cplt-work') },
  ])('$row: the submit names the problem in the plan section, the fixed form is booked in the same round', async ({ row, first, names }) => {
    const { refused, booked, world } = await submitInitialPlans(row.slice(0, 2).toLowerCase(), first, FIXED);
    expect(refused?.status, 'the first submit was accepted').toBe('rejected');
    expect(refused!.problems).toHaveLength(1);
    expect(refused!.problems[0]!.section).toBe('plan');
    expect(names(refused!.problems[0]!.reason), refused!.problems[0]!.reason).toBe(true);
    expect(booked.plan.obligations[0]!.taskIds).toEqual(['cplt-work', 'cplt-gate']);
    expect(world.host.model.requests).toHaveLength(2);
  }, 120_000);
});

describe('C5: every required requirement is covered by a check of setup.checks at the form', () => {
  // Mutation: the form judges no coverage -> the static requirement with only a dynamic check is booked at once.
  it('(a) a static requirement with only a dynamic check is named, then the form with a static check is booked', async () => {
    const first = form({ tasks: [WORK, GATE], mapped: ['cplt-work', 'cplt-gate'], checks: [check('cplt-dynamic', 'dynamic')] });
    const fixed = form({ tasks: [WORK, GATE], mapped: ['cplt-work', 'cplt-gate'],
      checks: [check('cplt-dynamic', 'dynamic'), check('cplt-static', 'static')] });
    const { refused, booked } = await submitInitialPlans('c5a', first, fixed);
    expect(refused?.status, 'the first submit was accepted').toBe('rejected');
    expect(refused!.problems).toHaveLength(1);
    expect(['plan', 'setup']).toContain(refused!.problems[0]!.section);
    expect(refused!.problems[0]!.reason).toContain('cplt-requirement');
    expect(refused!.problems[0]!.reason).toMatch(/\bstatic\b/);
    expect(booked.setup.checks.map(entry => entry.kind)).toEqual(['dynamic', 'static']);
  }, 120_000);

  // Mutation: a reviewer requirement counted as uncovered -> this form is refused and the round asks again.
  it('(b) a reviewer-only requirement with no checks is booked at the first submit', async () => {
    const only = form({ tasks: [WORK, GATE], mapped: ['cplt-work', 'cplt-gate'], checks: [], kind: 'reviewer', kinds: ['reviewer'] });
    const { refused, booked, world } = await submitInitialPlans('c5b', only, null);
    expect(refused).toBeUndefined();
    expect(world.host.model.requests).toHaveLength(1);
    expect(booked.plan.obligations[0]!.verificationRequirements[0]!.kind).toBe('reviewer');
  }, 120_000);
});
