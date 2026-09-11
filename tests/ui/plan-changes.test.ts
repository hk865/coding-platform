/**
 * RW-09「计划变更」视图的渲染字段（UI 单元测试）。
 *
 * 这个视图必须回答一个具体问题：**谁受理了什么、为什么**。因此本文件逐字段断言
 * `describePlanChanges` 产出的行——组件只是把这些行渲染出来，字段缺失/改名会在这里失败。
 * 覆盖两种受理方：系统自动受理（actor=system／authority=delegated）与人的决定
 * （actor=human／authority=user），以及 changeReason 逐字显示、处置行指向返工任务。
 *
 * 边界：这是视图的单元测试（渲染输入），不是浏览器验收；浏览器验收需要真实内核与
 * Chromium，不在本票范围内。视图取数只依赖后端只读接口，接口本身由
 * tests/app/plan-changes.test.ts 用真实 HTTP 覆盖。
 */
import { describe, expect, it } from 'vitest';
import { describePlanChanges } from '../../src/ui/src/features/plan-changes';
import type { PlanProposalSnapshot, UserDecisionSnapshot, GoalRevisionSnapshot } from '../../src/contracts/goal-change.js';
import type { PlanChangesViewV1 } from '../../src/app/plan-changes.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';

const RECORDED = '2026-09-10T10:00:00.000Z';

/** 返工提案：既有 PlanProposalV1 形状 + summary／rework（这两项是视图要如实显示的来源信息）。 */
function reworkProposal() {
  return {
    schemaVersion: 1,
    proposalId: 'rework-proposal-abc',
    projectId: 'proj-1',
    workspaceId: 'ws-1',
    sourceGoalRef: { aggregateType: 'Goal', projectId: 'proj-1', goalId: 'goal-1' },
    sourcePlanRef: { aggregateType: 'PlanRevision', projectId: 'proj-1', planId: 'plan-mvp-1' },
    sourcePlanRevision: 1,
    patch: {
      schemaVersion: 1,
      patchId: 'patch-1',
      projectId: 'proj-1',
      workspaceId: 'ws-1',
      goalRef: { aggregateType: 'Goal', projectId: 'proj-1', goalId: 'goal-1' },
      sourcePlanRef: { aggregateType: 'PlanRevision', projectId: 'proj-1', planId: 'plan-mvp-1' },
      sourcePlanRevision: 1,
      patchDraft: { objective: '同一个目标，换一个承担者重新证明', obligationDeltas: [], taskHierarchy: null },
      inScope: ['in-scope rework'],
      outOfScope: ['acceptance semantics'],
      generatedAt: RECORDED,
    },
    impact: {
      schemaVersion: 1,
      analysisId: 'impact-abc',
      patchRef: { aggregateType: 'PlanRevision', projectId: 'proj-1', planId: 'plan-mvp-1' },
      affectedWorks: [
        { workRef: { aggregateType: 'WorkContext', projectId: 'proj-1', workspaceId: 'ws-1', workId: 'work-coding-task' }, refreshRequired: true, reason: '任务 coding-task 的工作身份需要按新 revision 重新组装' },
      ],
      staleAssumptions: [{ assumption: '任务 coding-task 会继续推进', reason: '它已被取代' }],
      materialsToRefresh: ['planContext:plan-rework-abc@2'],
      independentWork: [],
      generatedAt: RECORDED,
    },
    alternatives: [],
    generatedAt: RECORDED,
    summary: '自动受理返工提案：coding-task 的 behavior 要求失败，由 rework-1 接手',
    rework: { schemaVersion: 1, issues: [{ issueId: 'rework-issue-1', taskId: 'coding-task' }], tasks: [] },
  };
}

const proposalSnapshot = { ref: { aggregateType: 'PlanProposal', projectId: 'proj-1', workspaceId: 'ws-1', proposalId: 'rework-proposal-abc' }, revision: 1, schemaVersion: 1, proposal: reworkProposal(), recordedAt: RECORDED } as unknown as PlanProposalSnapshot;

const systemDecision = {
  ref: { aggregateType: 'UserDecision', projectId: 'proj-1', workspaceId: 'ws-1', decisionId: 'auto-decision-1' },
  revision: 1,
  schemaVersion: 1,
  recordedAt: RECORDED,
  decision: {
    schemaVersion: 1, decisionId: 'auto-decision-1', projectId: 'proj-1', workspaceId: 'ws-1',
    proposalRef: { aggregateType: 'PlanProposal', projectId: 'proj-1', workspaceId: 'ws-1', proposalId: 'rework-proposal-abc' },
    subject: { goalRef: { aggregateType: 'Goal', projectId: 'proj-1', goalId: 'goal-1' }, sourcePlanRef: { aggregateType: 'PlanRevision', projectId: 'proj-1', planId: 'plan-mvp-1' }, sourcePlanRevision: 1 },
    outcome: 'accept',
    actor: { kind: 'system', id: 'autonomous-rework' },
    authority: { strategy: 'delegated', delegator: 'coordination-policy:coordination-policy-main@1', policyVersion: 'coordination-policy-main@1#digest' },
    authorizedTarget: { goalId: 'goal-1', newObjective: '同一个目标，换一个承担者重新证明', sourcePlanDigest: 'digest' },
    summary: '自动受理返工提案（rework-proposal-abc）：四条边界 (a)-(d) 同时满足',
    decidedAt: '2026-09-10T10:00:01.000Z',
  },
} as unknown as UserDecisionSnapshot;

const humanDecision = {
  ref: { aggregateType: 'UserDecision', projectId: 'proj-1', workspaceId: 'ws-1', decisionId: 'human-decision-1' },
  revision: 1,
  schemaVersion: 1,
  recordedAt: RECORDED,
  decision: {
    ...systemDecision.decision,
    decisionId: 'human-decision-1',
    actor: { kind: 'human', id: 'user-owner-1' },
    authority: { strategy: 'user', delegator: null, policyVersion: 'user-decision-policy@1' },
    summary: '人接受这份计划变更',
    decidedAt: '2026-09-10T10:05:00.000Z',
  },
} as unknown as UserDecisionSnapshot;

const systemRevision = {
  ref: { aggregateType: 'GoalRevision', projectId: 'proj-1', workspaceId: 'ws-1', goalId: 'goal-1', revision: 3 },
  revision: 1, schemaVersion: 1, recordedAt: RECORDED,
  change: {
    schemaVersion: 1,
    goalRef: { aggregateType: 'Goal', projectId: 'proj-1', goalId: 'goal-1' },
    revision: 3,
    activePlanRef: { aggregateType: 'PlanRevision', projectId: 'proj-1', planId: 'plan-rework-abc' },
    supersededPlanRefs: [{ aggregateType: 'PlanRevision', projectId: 'proj-1', planId: 'plan-mvp-1' }],
    changedAt: '2026-09-10T10:00:02.000Z',
    reason: 'autonomous-rework:rework-proposal-abc',
  },
} as GoalRevisionSnapshot;

const humanRevision = {
  ...systemRevision,
  ref: { ...systemRevision.ref, revision: 4 },
  change: { ...systemRevision.change, revision: 4, activePlanRef: { aggregateType: 'PlanRevision' as const, projectId: 'proj-1', planId: 'plan-mvp-1-v2' }, changedAt: '2026-09-10T10:05:01.000Z', reason: 'user-decision-accepted' },
} as GoalRevisionSnapshot;

function viewWith(decisions: UserDecisionSnapshot[], revisions: GoalRevisionSnapshot[]): PlanChangesViewV1 {
  return {
    status: 'ready',
    freshness: makeCommitCursor(1),
    proposals: [proposalSnapshot],
    decisions,
    revisions,
    dispositions: [{
      taskId: 'coding-task',
      disposition: 'replace',
      sourcePlanRef: { aggregateType: 'PlanRevision', projectId: 'proj-1', planId: 'plan-mvp-1' },
      targetPlanRef: { aggregateType: 'PlanRevision', projectId: 'proj-1', planId: 'plan-rework-abc' },
      replacedByTaskId: 'rework-1',
      obligationSignatureChanged: false,
      reason: '原任务的 behavior 要求未通过，由 rework-1 在同一义务下接手',
    }],
  };
}

const rowById = <T extends { id: string }>(rows: T[], id: string): T => rows.find(row => row.id === id)!;
const fieldOf = (row: { fields: Array<{ label: string; value: string }> }, label: string) => row.fields.find(field => field.label === label)!;

describe('RW-09 计划变更视图的渲染行', () => {
  it('系统自动受理：提案来源、system 决定与 delegated 授权、changeReason、处置行全部可读', () => {
    const display = describePlanChanges(viewWith([systemDecision], [systemRevision]));
    expect(display.status).toBe('ready');
    const [proposals, decisions, revisions, dispositions] = display.groups;
    expect(display.groups.map(group => group.key)).toEqual(['proposals', 'decisions', 'revisions', 'dispositions']);

    // 提案：身份、来源、目标与影响摘要。
    const proposal = rowById(proposals!.rows, 'rework-proposal-abc');
    expect(proposal.title).toBe('rework-proposal-abc');
    expect(fieldOf(proposal, '来源计划').value).toBe('plan-mvp-1@1');
    expect(fieldOf(proposal, '目标（objective）').value).toBe('同一个目标，换一个承担者重新证明');
    expect(fieldOf(proposal, '影响摘要').value).toContain('受影响工作 1 个（需刷新 1）');
    expect(fieldOf(proposal, '来源问题').value).toContain('coding-task / rework-issue-1');
    expect(fieldOf(proposal, '摘要').value).toContain('rework-1 接手');

    // 决定：一眼看出这是系统自动受理，并且授权来源与策略版本都在。
    const decision = rowById(decisions!.rows, 'auto-decision-1');
    expect(decision.badge).toBe('系统自动受理');
    expect(decision.tone).toBe('blue');
    expect(fieldOf(decision, '结果（outcome）').value).toBe('accept');
    expect(fieldOf(decision, '受理方').value).toContain('system:autonomous-rework');
    expect(fieldOf(decision, '授权来源').value).toBe('delegated');
    expect(fieldOf(decision, '委托人（delegator）').value).toBe('coordination-policy:coordination-policy-main@1');
    expect(fieldOf(decision, '策略版本').value).toBe('coordination-policy-main@1#digest');
    expect(fieldOf(decision, '时间').value).toBe('2026-09-10T10:00:01.000Z');
    expect(fieldOf(decision, '提案').value).toBe('rework-proposal-abc');

    // revision：planId@revision 与逐字 changeReason。
    const revision = rowById(revisions!.rows, 'goal-revision-3');
    expect(revision.title).toBe('plan-rework-abc@3');
    expect(revision.badge).toBe('autonomous-rework:rework-proposal-abc');
    expect(fieldOf(revision, '变更原因（changeReason）').value).toBe('autonomous-rework:rework-proposal-abc');
    expect(fieldOf(revision, '被取代的计划').value).toBe('plan-mvp-1');

    // 处置行：replace 指向返工任务，来源与目标计划都在。
    const disposition = rowById(dispositions!.rows, 'coding-task');
    expect(disposition.badge).toBe('replace');
    expect(fieldOf(disposition, '取代者任务').value).toBe('rework-1');
    expect(fieldOf(disposition, '计划').value).toBe('plan-mvp-1 → plan-rework-abc');
    expect(fieldOf(disposition, '理由').value).toContain('rework-1');
  });

  it('人的决定如实显示为人的决定：actor=human、authority=user、changeReason=user-decision-accepted', () => {
    const display = describePlanChanges(viewWith([systemDecision, humanDecision], [systemRevision, humanRevision]));
    const decisions = display.groups.find(group => group.key === 'decisions')!.rows;
    const human = rowById(decisions, 'human-decision-1');
    expect(human.badge).toBe('人的决定');
    expect(human.tone).toBe('green');
    expect(fieldOf(human, '受理方').value).toContain('human:user-owner-1');
    expect(fieldOf(human, '授权来源').value).toBe('user');
    expect(fieldOf(human, '委托人（delegator）').value).toBe('无（直接授权）');
    // 同一条时间线上两条 revision 的原因不同：系统自动受理 vs 人的决定。
    const revisions = display.groups.find(group => group.key === 'revisions')!.rows;
    expect(revisions.map(row => row.badge)).toEqual(['autonomous-rework:rework-proposal-abc', 'user-decision-accepted']);
    expect(rowById(revisions, 'goal-revision-4').title).toBe('plan-mvp-1-v2@4');
  });

  it('没有计划变更时说清楚，而不是空白；读不到时给出原因', () => {
    const empty = describePlanChanges({ status: 'empty', reason: '该目标没有已落账的计划变更事实。', observedCursor: makeCommitCursor(1) });
    expect(empty.status).toBe('empty');
    expect(empty.message).toContain('没有已落账的计划变更事实');
    expect(empty.groups).toEqual([]);

    const unavailable = describePlanChanges({ status: 'unavailable', reason: '投影尚未推进', observedCursor: null });
    expect(unavailable.status).toBe('unavailable');
    expect(unavailable.message).toBe('投影尚未推进');

    const failed = describePlanChanges(undefined, new Error('连接失败'));
    expect(failed.status).toBe('unavailable');
    expect(failed.message).toBe('连接失败');
  });

  it('某一类事实为空时该区块给出明确说明，而不是静默留空', () => {
    const display = describePlanChanges({ status: 'ready', freshness: makeCommitCursor(1), proposals: [], decisions: [], revisions: [], dispositions: [] });
    expect(display.groups.every(group => group.empty.length > 0)).toBe(true);
    expect(display.groups.every(group => group.rows.length === 0)).toBe(true);
  });
});
