/**
 * G8B-2 B5 的纯表（决定 121-141，`g8b-rulings.md` 测试行 F4、F6；RULES A5、S1、S2）。只调两个纯函数：裁定点名的
 * `standardChangeOf`，和 `validateFutureObligationCoverage`（`personAdopts: true`，先例 `S6C-c7-adoption.test.ts:283-300`）。
 * 起点 v1 和候选 P 见 `tests/helpers/G8B2-plans.ts`，期望值照裁定手写。
 * - F6 今天红：`standardChangeOf` 还不存在，按名取到的是 undefined，一调就抛。包落地后：普通细化读成 null；P 读成
 *   一个被取代的关口（G1 → G2）加一条去掉的义务（o-sub）。改坏：识别多报（普通细化也报）或漏报（少一个关口或义务）。
 * - F4 今天绿（守护）：五种“放宽过头”的 P 变体，人采用照样拒，每一格只有一个错。包落地后 R1、R2 只放过 P 本身。
 *   改坏：放宽过头，比如凡是 superseded 的关口都不再比定义，或源义务丢了一律放过。今天在树上演示过：去掉关口冻结那一条，
 *   (a)(c)(d) 变红；去掉“源义务不能少”那一条，(e) 变红；去掉 `replacementIssues`，(b) 变红。
 */
import { describe, expect, it } from 'vitest';
import type { PlanRevisionDraft, PlanRevisionSnapshot, PlanValidationError, RuntimeTask } from '../../src/contracts/plan.js';
import * as planValidation from '../../src/core/work-graph/tasks/plan-validation.js';
import { deriveFuturePlanDelta, goalGateCountIssue, validateFutureObligationCoverage } from '../../src/core/work-graph/tasks/plan-validation.js';
import { g8b2Gate, g8b2Obligation, g8b2P, g8b2V1, g8b2Work } from '../helpers/G8B2-plans.js';

type StandardChangeV1 = { supersededGates: { taskId: string; replacedByTaskId: string }[]; droppedObligationIds: string[] };
/** 裁定 B5 新增的纯函数，今天还没有：按名取，签名照裁定写。 */
const standardChangeOf = (planValidation as unknown as Record<string, unknown>)['standardChangeOf'] as
  (source: PlanRevisionSnapshot, target: PlanRevisionDraft) => StandardChangeV1 | null;

const ROLE = 'g8b2-builder';
/** 已采用的源计划：纯函数只读计划内容，快照字段照 `S6C-c7-adoption.test.ts:343-364` 手写。 */
const adopted = (draft: PlanRevisionDraft): PlanRevisionSnapshot => ({ ...draft, revision: 1,
  ref: { aggregateType: 'PlanRevision', projectId: 'g8b2', planId: draft.planId },
  goalRef: { aggregateType: 'Goal', projectId: 'g8b2', goalId: draft.goalId },
  acceptedAt: '2026-11-17T00:00:00.000Z' }) as unknown as PlanRevisionSnapshot;
const v1Draft = g8b2V1('g8b2-goal', ROLE);
const v1 = adopted(v1Draft);
const supersede = (replacedByTaskId: string, title?: string) => (task: RuntimeTask): RuntimeTask =>
  ({ ...task, ...(title === undefined ? {} : { title }), disposition: 'superseded', replacedByTaskId });

describe('F6 standardChangeOf', () => {
  // 普通细化：加一个工作任务 W4，挂在 o-main 上；关口和义务都不动。
  const refinement: PlanRevisionDraft = { ...v1Draft, planRevision: 2, tasks: [...v1Draft.tasks, g8b2Work('W4', 'W4 补一件')],
    assignments: [...(v1Draft.assignments ?? []), { taskId: 'W4', role: ROLE, instruction: 'W4 照做' }],
    obligations: v1Draft.obligations.map(entry => entry.obligationId === 'o-main'
      ? { ...entry, taskIds: [...entry.taskIds, 'W4'] } : entry) };
  it.each<[string, PlanRevisionDraft, StandardChangeV1 | null]>([
    ['一次普通细化不是降标或改标', refinement, null],
    ['P：G1 由 G2 取代，o-sub 不带进来', g8b2P(v1, ROLE),
      { supersededGates: [{ taskId: 'G1', replacedByTaskId: 'G2' }], droppedObligationIds: ['o-sub'] }],
  ])('%s', (_name, target, expected) => {
    expect(standardChangeOf(v1, target)).toEqual(expected);
  });
});

describe('rejects: F4 人采用也只放过“标成 superseded、指向本次新增的关口”', () => {
  // (d) 要源计划里另有一个关口 G0：带着它自己的义务 o-zero，原样留在目标里。
  const withG0 = adopted({ ...v1Draft, tasks: [...v1Draft.tasks, g8b2Gate('G0', 'G0 另一个关口')],
    obligations: [...v1Draft.obligations, g8b2Obligation('o-zero', ['G0'], 'r-zero', 'G0 查的')] });
  // 每格：拒绝码照裁定，拒绝的话要点名出错的那一项（G1，或 (e) 的 o-main 和裁定写明的 `missing from the candidate`）。
  it.each<[string, PlanRevisionSnapshot, PlanRevisionDraft, string, RegExp]>([
    ['(a) G1 改成 cancelled', v1, g8b2P(v1, ROLE, { g1: task => ({ ...task, disposition: 'cancelled' }) }),
      'gate_definition_changed', /G1/],
    ['(b) G1 取代，replacedByTaskId 指向工作任务 W1', v1, g8b2P(v1, ROLE, { g1: supersede('W1') }),
      'unsupported_execution_change', /G1/],
    ['(c) G1 取代，但改了 G1 的标题', v1, g8b2P(v1, ROLE, { g1: supersede('G2', 'G1 改了名') }),
      'gate_definition_changed', /G1/],
    ['(d) G1 取代，指向源计划里已有的关口 G0', withG0, g8b2P(withG0, ROLE, { g1: supersede('G0') }),
      'gate_definition_changed', /G1/],
    ['(e) 不带 o-main（W1 仍是 active）', v1, g8b2P(v1, ROLE, { keep: id => id !== 'o-sub' && id !== 'o-main' }),
      'obligation_semantics_changed', /o-main.*missing from the candidate/],
  ])('%s', (_name, source, target, code, mentions) => {
    const delta = deriveFuturePlanDelta(source, target);
    if (delta.status !== 'supported') throw new Error(delta.reason);
    expect(validateFutureObligationCoverage({ source, target, delta: delta.delta, personAdopts: true })).toMatchObject({
      status: 'rejected', issues: expect.arrayContaining([expect.objectContaining({ code,
        message: expect.stringMatching(mentions) })]) });
  });
});

describe('goalGateCountIssue: only newly added open goal gates are refused', () => {
  // 决定 121-149（冻结稿二·R1）：只报这一版比上一版多出来的多道；源计划原样带着的已了结关口不算。今天整组红在
  // `goalGateCountIssue` 还没有这个导出。(g)(h) 守冻结稿开头的更正 1、6：只在有可执行的必需工作时查（和“缺目标
  // 关口”同一范围）；没有还没了结的已采用目标关口（首版）时原文只写第一句。
  const withG0 = adopted({ ...v1Draft, tasks: [...v1Draft.tasks, g8b2Gate('G0', 'G0 another gate')],
    obligations: [...v1Draft.obligations, g8b2Obligation('o-zero', ['G0'], 'r-zero', 'G0 check')] });
  const targetOf = (source: PlanRevisionSnapshot, added: RuntimeTask[] = []): PlanRevisionDraft =>
    ({ ...source, planRevision: source.planRevision + 1, goalId: source.goalRef.goalId, tasks: [...source.tasks, ...added] });
  const message = 'the plan has 3 active required goal gates (G1, G0, G2); a plan has exactly one open goal gate. '
    + 'Keep one: leave out the new gate and let the new obligation list only the new work tasks (an adopted gate keeps '
    + 'exactly the obligations that list it), or, if the person changed what the '
    + 'goal must meet, list the adopted gate (G1, G0) with its own taskId and disposition "superseded" and '
    + 'replacedByTaskId naming the new gate; a task you leave out of a segment stays as it is and stays active';
  it.each<[string, PlanRevisionSnapshot | null, PlanRevisionDraft, ReadonlySet<string>, PlanValidationError | null]>([
    ['(d) the same two-gate plan carried forward is not re-judged', withG0, targetOf(withG0), new Set(), null],
    ['(e) a third open gate is reported', withG0, targetOf(withG0, [g8b2Gate('G2', 'G2 third gate')]), new Set(),
      { path: 'tasks', code: 'multiple_active_goal_gates', message }],
    ['(f) a satisfied source gate is not counted', v1, { ...targetOf(v1, [g8b2Gate('G2', 'G2 successor')]),
      obligations: [...v1.obligations, g8b2Obligation('o-r45', ['G2'], 'r-r45', 'G2 check')] }, new Set(['G1']), null],
    // before 和 <adopted> 都去掉已了结的关口：G1 已满足、原样带着，G0 开着，再加 G2，算两道，只列 G0。
    ['(i) a satisfied source gate leaves both the count and the adopted list', withG0, { ...targetOf(withG0,
      [g8b2Gate('G2', 'G2 third gate')]), obligations: [...withG0.obligations, g8b2Obligation('o-r45i', ['G2'], 'r-r45i',
      'G2 check')] }, new Set(['G1']), { path: 'tasks', code: 'multiple_active_goal_gates',
      message: 'the plan has 2 active required goal gates (G0, G2); a plan has exactly one open goal gate. Keep one: '
        + 'leave out the new gate and let the new obligation list only the new work tasks (an adopted gate keeps exactly '
        + 'the obligations that list it), or, if the person changed what the goal must meet, list the adopted gate (G0) '
        + 'with its own taskId and disposition "superseded" and replacedByTaskId naming the new gate; a task you leave '
        + 'out of a segment stays as it is and stays active' }],
    ['(g) without executable required work two gates are not judged', null, { ...targetOf(withG0),
      tasks: withG0.tasks.map(task => task.taskKind === 'work' ? { ...task, executionIntent: 'plan_only' as const } : task) },
      new Set(), null],
    ['(h) a first plan with two gates gets only the first sentence', null, targetOf(withG0), new Set(),
      { path: 'tasks', code: 'multiple_active_goal_gates',
        message: 'the plan has 2 active required goal gates (G1, G0); a plan has exactly one open goal gate' }],
  ])('%s', (_name, source, target, terminalTaskIds, expected) => {
    expect(goalGateCountIssue(target, source, terminalTaskIds)).toEqual(expected);
  });
  // 和上面的原文配套：新义务挂到已采用的目标关口 G1 上，关口冻结拒；原文叫它要关口就加新阶段自己的关口，目标关口只在
  // 没有还开着的目标关口时才新加。
  it(`the gate freeze names a new stage's own gate, or a new goal gate only when no goal gate is still open`, () => {
    const target: PlanRevisionDraft = { ...targetOf(v1, [g8b2Work('W4', 'W4 补一件')]),
      obligations: [...v1.obligations, g8b2Obligation('o-w4', ['W4', 'G1'], 'r-w4', 'W4 查的')] };
    const delta = deriveFuturePlanDelta(v1, target);
    if (delta.status !== 'supported') throw new Error(delta.reason);
    expect(validateFutureObligationCoverage({ source: v1, target, delta: delta.delta, personAdopts: true })).toMatchObject({
      status: 'rejected', issues: expect.arrayContaining([{ path: 'tasks[G1]', code: 'gate_definition_changed',
        message: 'source gate task G1 changed its definition or acceptance relationships: an adopted gate keeps its '
          + 'definition and exactly the obligations that list it, with their content. Leave the gate and those obligations '
          + 'as adopted; a new obligation lists the new work tasks and, when it needs a gate, a new gate task (a new '
          + `stage's own gate, or a new goal gate only when no goal gate is still open: a plan keeps exactly one open goal `
          + 'gate). Only a plan the person adopts may supersede a gate: mark it superseded with '
          + 'replacedByTaskId naming a new gate task that carries a new obligation' }]) });
  });
});
