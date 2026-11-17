/**
 * G8B-2 B5 连续取代（Astra 审查 G8B-2 第 2 条，lead 11-17 19:3x）。只调两个纯函数：`deriveFuturePlanDelta`、
 * `validateFutureObligationCoverage`（先例 `G8B2-standard-change-pure.test.ts`、`S6C-c7-adoption.test.ts:283-300`）。
 * 起点 v1 照 `tests/helpers/G8B2-plans.ts`：
 * - v2：G1 由 G2 取代，o-sub 保留并加上 G2（第一次取代不去掉要求）；
 * - v3：G2 由 G3 取代，这次去掉 o-sub。o-sub 列的 G1、G2 在 v3 里都不再活动，G2 是这次才不活动的，R2 放开 o-sub。
 * 人采用 v3 要能过：早先被取代的 G1 也列着 o-sub，比 G1 的冻结定义时不能再把 o-sub 算进去，其余照旧比。
 * agent 采用照旧冻结。改坏：G1 的冻结照完整义务比（人采用也报 G1 `gate_definition_changed`），或放开的义务算错。
 */
import { describe, expect, it } from 'vitest';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import { deriveFuturePlanDelta, validateFutureObligationCoverage } from '../../src/core/work-graph/tasks/plan-validation.js';
import { g8b2Gate, g8b2Obligation, g8b2P, g8b2V1 } from '../helpers/G8B2-plans.js';

const ROLE = 'g8b2-builder';
const adopted = (draft: PlanRevisionDraft): PlanRevisionSnapshot => ({ ...draft, revision: 1,
  ref: { aggregateType: 'PlanRevision', projectId: 'g8b2', planId: draft.planId },
  goalRef: { aggregateType: 'Goal', projectId: 'g8b2', goalId: draft.goalId },
  acceptedAt: '2026-11-17T00:00:00.000Z' }) as unknown as PlanRevisionSnapshot;
const judge = (source: PlanRevisionSnapshot, target: PlanRevisionDraft, personAdopts: boolean) => {
  const delta = deriveFuturePlanDelta(source, target);
  if (delta.status !== 'supported') throw new Error(delta.reason);
  return validateFutureObligationCoverage({ source, target, delta: delta.delta, personAdopts });
};

const v1 = adopted(g8b2V1('g8b2-goal', ROLE));
// v2：P 的写法，但 o-sub 留下并加上 G2。
const p = g8b2P(v1, ROLE, { keep: () => true });
const v2Draft: PlanRevisionDraft = { ...p, obligations: p.obligations.map(entry => entry.obligationId === 'o-sub'
  ? { ...entry, taskIds: [...entry.taskIds, 'G2'] } : entry) };
const v2 = adopted(v2Draft);
// v3：G2 由新关口 G3 取代，去掉 o-sub，G3 带一条新义务，o-main 加上 G3。
const v3: PlanRevisionDraft = { ...v2Draft, planId: 'g8b2-plan-v3', planRevision: v2Draft.planRevision + 1,
  tasks: [...v2Draft.tasks.map(task => task.taskId === 'G2'
    ? { ...task, disposition: 'superseded' as const, replacedByTaskId: 'G3' } : task), g8b2Gate('G3', 'G3 目标验收')],
  obligations: [...v2Draft.obligations.filter(entry => entry.obligationId !== 'o-sub').map(entry => entry.obligationId === 'o-main'
    ? { ...entry, taskIds: [...entry.taskIds, 'G3'] } : entry), g8b2Obligation('o-g3', ['G3'], 'r-g3', 'G3 查的')] };

describe('G8B-2 连续取代关口', () => {
  it('第一次取代（G1 → G2，保留 o-sub 并加上 G2），人采用能过', () => {
    expect(judge(v1, v2Draft, true)).toEqual({ status: 'supported' });
  });

  it('第二次取代（G2 → G3，去掉 o-sub），人采用能过；agent 采用照旧冻结', () => {
    expect(judge(v2, v3, true)).toEqual({ status: 'supported' });
    expect(judge(v2, v3, false)).toMatchObject({ status: 'rejected', issues: expect.arrayContaining([
      expect.objectContaining({ code: 'gate_definition_changed', message: expect.stringMatching(/G2/) }),
      expect.objectContaining({ code: 'obligation_semantics_changed', message: expect.stringMatching(/o-sub/) })]) });
  });
});
