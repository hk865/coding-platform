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
import type { PlanRevisionDraft, PlanRevisionSnapshot, RuntimeTask } from '../../src/contracts/plan.js';
import * as planValidation from '../../src/core/work-graph/tasks/plan-validation.js';
import { deriveFuturePlanDelta, validateFutureObligationCoverage } from '../../src/core/work-graph/tasks/plan-validation.js';
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
