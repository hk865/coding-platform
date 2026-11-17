/**
 * G8B-2 B5：降标的事实读不到时（Astra 审查 G8B-2 第 3 条，lead 11-17 19:3x）。纯表：`decidePlanCandidate` 和把候选卡的
 * 降标读（`CandidateCardFactsV1.standardChange`）分成三种的 `standardChangeStateOf`（先例 `PL-27-decision.test.ts`）。
 * - 三种：读到了、有变化 → changed；读到了、没变化 → unchanged；读失败 → unreadable。
 * - 读失败时，不管审阅、返修和采用策略在哪一档，都不送审、不返修、不尝试采用，直接是人的卡 `standard_change_unreadable`；
 *   卡照常读得到，普通工作照常（出卡只记等待依据，不挡普通选择，同 F3）。
 * - 读到了、没变化时照原表走。
 * 改坏：读失败当成“没有降标”（先送审），或读失败也直接采用。
 */
import { describe, expect, it } from 'vitest';
import * as planCandidate from '../../src/core/work-graph/state/plan-candidate.js';
import { decidePlanCandidate, type PlanCandidateFactsV1 } from '../../src/core/work-graph/state/plan-candidate.js';

const standardChangeStateOf = (planCandidate as unknown as Record<string, unknown>)['standardChangeStateOf'] as
  (read: unknown) => string;

const base = {
  proposal: { ref: { aggregateType: 'PlanProposal', projectId: 'p', workspaceId: 'w', proposalId: 'prop-1' }, revision: 2,
    basedOn: null, source: 'agent_proposal', affectedTaskIds: [] },
  review: { status: 'not_sent' }, fix: null, completedFixes: 0, adoptionPolicy: 'automatic', hasReviewLine: true,
  diagnosis: [],
} as unknown as Omit<PlanCandidateFactsV1, 'standardChange'>;
const UNREADABLE = { status: 'rejected', code: 'unavailable', reason: '降标的事实暂不可读：基准计划读不到' };
const PASS = { status: 'decided', verdict: 'pass', findings: [] };
const FIX = { status: 'decided', verdict: 'fix', findings: [] };

describe('G8B-2 降标的事实读不到', () => {
  it('候选卡的降标读分三种', () => {
    expect(standardChangeStateOf(UNREADABLE)).toBe('unreadable');
    expect(standardChangeStateOf({ status: 'ready', value: null })).toBe('unchanged');
    expect(standardChangeStateOf({ status: 'ready', value: { supersededGates: [], droppedObligations: [], newObligations: [],
      reason: '去掉 sub', proposedBy: { session: null }, personWords: null } })).toBe('changed');
  });

  it.each<[string, Partial<PlanCandidateFactsV1>]>([
    ['还没送审', {}],
    ['审阅要返修', { review: FIX as never, fix: { status: 'not_sent' } as never }],
    ['审阅通过、自动采用', { review: PASS as never }],
  ])('读失败（%s）：不送审、不返修、不采用，直接是人的卡', (_name, facts) => {
    expect(decidePlanCandidate({ ...base, ...facts, standardChange: 'unreadable' } as unknown as PlanCandidateFactsV1))
      .toEqual({ action: 'card', reason: 'standard_change_unreadable' });
  });

  it('读到了、没变化：照原表送审', () => {
    expect(decidePlanCandidate({ ...base, standardChange: 'unchanged' } as unknown as PlanCandidateFactsV1))
      .toMatchObject({ action: 'request_review' });
  });
});
