/**
 * 真实 HTTP：受理结果在界面上真正可见。
 *
 * 断言的是产品今天的真实行为：经治理入口安装并激活 CoordinationPolicy → 真实工具轮次 FAIL →
 * 组合根触发自动受理 → 只读入口 `/api/real/plan-changes/view` 能看到
 *   - 系统提案（rework-proposal-…）与来源；
 *   - 受理决定：actor=system、authority.strategy=delegated、delegator 指向那份 CoordinationPolicy、
 *     policyVersion 与时间都逐字来自 canonical 事实；
 *   - Goal revision 的 changeReason 是 `autonomous-rework:<proposalId>`；
 *   - 任务处置行 replace：被取代任务被指向返工任务；
 *   并且同一条 `plan_accepted` 时间线条目带上 change（actor=system、reason 同名）。
 *
 * 界面消费的是同一个只读接口，因此这里断言的字段就是「计划变更」视图实际显示的那些字段。
 * 人的决定路径（既有 HumanCollaboration.decide/applyChange）在产品里**还没有**
 * HTTP 提交入口（义务映射里记的"机制存在但无入口"），因此它的可见性由
 * tests/read-model/plan-change-timeline.test.ts 用同一批 canonical 事件覆盖。
 *
 * 计划形状沿用 tests/app/governance.test.ts 的 RW-08 夹具：复核类要求挂在 gate 任务上，
 * 工作任务的失败要求由工具轮次独立承担；否则轮次问题会带一条没有结论的 reviewer 要求，
 * RW-04 的边界 (a) 会（正确地）拒绝自动返工。
 */
import { afterEach, expect, it } from 'vitest';
import type { PlanChangesViewV1 } from '../../src/app/plan-changes.js';
import type { GovernanceActivateResultV1, GovernanceInstallResultV1 } from '../../src/contracts/governance-view.js';
import type { ReworkDriveResultV1, ReworkDriveViewV1 } from '../../src/contracts/rework/drive.js';
import type { VerificationRegisteredCheck, VerificationRoundResult } from '../../src/contracts/verification-round.js';
import { reworkTaskIdFor } from '../../src/contracts/rework/proposal.js';
import { verificationRoundFixture } from './verification-round-fixture.js';
import { createGuiServer } from '../../src/app/server.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

type Fixture = Awaited<ReturnType<typeof verificationRoundFixture>>;
const scopeOf = (fixture: Fixture) => ({ projectId: fixture.scope.projectId, workspaceId: fixture.scope.workspaceId });
const planChangesOf = (fixture: Fixture) =>
  fixture.post<PlanChangesViewV1>('/api/real/plan-changes/view', { ...scopeOf(fixture), goalId: fixture.scope.goalId });
type ReworkStatus = { view: ReworkDriveViewV1; lastDrive: ReworkDriveResultV1 | null };
const reworkStatusOf = (fixture: Fixture) =>
  fixture.post<ReworkStatus>('/api/real/rework/status', { ...scopeOf(fixture), goalId: fixture.scope.goalId });

/** 协调策略 source：自动化额度只能由人显式提交（产品没有内置来源）。 */
const coordinationSource = (policyId: string, maxAutonomousReworks: number) => ({
  policyId,
  content: {
    schemaVersion: 1 as const,
    budget: { maxAutonomousReworks, maxClarifications: 3 },
    allowed: { inScopeRework: true as const, inScopeTesting: true as const },
    scope: { changesRequireHumanDecision: ['requirement', 'acceptance', 'baseline'] },
    upgrade: { path: 'manual-decision' as const, note: '策略升级需人工决定' },
  },
});

function governancePlan() {
  return {
    kind: 'plan', summary: '检查真实文件，再由 gate 任务做独立语义复核。',
    assignments: [{ taskId: 'coding-task', role: 'executor', instruction: '检查 subject.txt 并报告公开结果；独立检查与语义复核由平台承担。' }],
    plan: {
      stages: [{ stageId: 'work', title: 'File task' }],
      tasks: [
        { taskId: 'coding-task', stageId: 'work', title: 'Inspect file', taskKind: 'work', requirementLevel: 'required', disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: 'work' } },
        { taskId: 'gate-goal', title: 'Independent verification', taskKind: 'gate', requirementLevel: 'required', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      ],
      obligations: [
        { obligationId: 'file-behavior', title: '文件行为由工具检查证明', requirementLevel: 'required', taskIds: ['coding-task'], verificationRequirements: [
          { requirementId: 'behavior', requirementLevel: 'required', kind: 'dynamic', description: 'Run all registered behavior checks.' },
        ] },
        { obligationId: 'file-semantics', title: '文件语义由独立复核证明', requirementLevel: 'required', taskIds: ['gate-goal'], verificationRequirements: [
          { requirementId: 'semantics', requirementLevel: 'required', kind: 'reviewer', description: 'Independent semantic review of this source version.' },
        ] },
      ],
      taskHierarchy: { parentOf: [{ parentTaskId: 'gate-goal', childTaskId: 'coding-task' }] },
      executionDag: { dependsOn: [{ taskId: 'gate-goal', dependsOnId: 'coding-task', requires: { kind: 'gate-result', label: 'Current Task verification' } }] },
    },
  };
}

const failingCheck = (fixture: Fixture): VerificationRegisteredCheck => ({
  checkId: 'rw09-failing-check', kind: 'dynamic', command: 'exit 1', cwd: '.', timeoutMs: 3000,
  appliesTo: { workspaceId: fixture.scope.workspaceId, taskIds: [fixture.taskId] },
});

async function failRound(fixture: Fixture): Promise<void> {
  const started = await fixture.post<VerificationRoundResult>('/api/real/verifications/rounds/start', {
    ...scopeOf(fixture), goalId: fixture.scope.goalId, runId: fixture.runId, taskId: fixture.taskId, requestId: 'rw09-failing-round', allowExecute: true,
    configuration: { checks: [failingCheck(fixture)] },
  });
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  expect(started.body.round.outcome).toBe('FAIL');
}

/** 轮询只读入口直到自动受理发生（判据由调用方给出，测试不解释业务）。 */
async function waitForAccepted(fixture: Fixture, timeoutMs = 60000): Promise<ReworkStatus> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = (await reworkStatusOf(fixture)).body;
    if (status.lastDrive?.outcomes.some(outcome => outcome.status === 'accepted') === true) return status;
    if (Date.now() >= deadline) throw Error('自动受理没有发生：' + JSON.stringify(status.lastDrive));
    await new Promise(done => setTimeout(done, 50));
  }
}

it('安装并激活协调策略后真实 FAIL 被自动受理：提案、system 决定、changeReason 与处置行都可见', async () => {
  const fixture = await verificationRoundFixture(cleanup, true, createGuiServer, { plan: governancePlan });
  const scope = scopeOf(fixture);

  // 1) 授权：经产品入口安装并激活 CoordinationPolicy（额度 2）。
  const install = await fixture.post<GovernanceInstallResultV1>('/api/real/governance/install', { ...scope, kind: 'CoordinationPolicy', source: coordinationSource('coordination-policy-main', 2) });
  expect(install.body, JSON.stringify(install.body)).toMatchObject({ status: 'committed' });
  const activate = await fixture.post<GovernanceActivateResultV1>('/api/real/governance/activate', { ...scope, kind: 'CoordinationPolicy', pin: { ref: install.body.revisionRef!, digest: install.body.contentDigest! } });
  expect(activate.body, JSON.stringify(activate.body)).toMatchObject({ status: 'committed' });

  // 2) 真实失败链：工具轮次 FAIL → 组合根触发自动受理。
  await failRound(fixture);
  const settled = await waitForAccepted(fixture);
  const accepted = settled.lastDrive!.outcomes.find(outcome => outcome.status === 'accepted')!;
  if (accepted.status !== 'accepted') throw Error('unreachable');
  const primaryIssueId = accepted.issueIds[0]!;

  // 3) 只读入口：四类事实都在，并且能看出这是系统自动受理。
  const view = await planChangesOf(fixture);
  expect(view.status, JSON.stringify(view.body)).toBe(200);
  expect(view.body.status, JSON.stringify(view.body)).toBe('ready');
  if (view.body.status !== 'ready') return;

  // 提案：身份就是受理回执里的那一份，来源与影响摘要都来自投影。
  const proposal = view.body.proposals.find(entry => entry.proposal.proposalId === accepted.proposalId);
  expect(proposal, JSON.stringify(view.body.proposals.map(entry => entry.proposal.proposalId))).toBeDefined();
  expect(proposal!.proposal.sourcePlanRef.planId).not.toBe(accepted.planRef.planId);
  expect(proposal!.proposal.patch.patchDraft.objective.length).toBeGreaterThan(0);
  expect(proposal!.proposal.impact.affectedWorks.length).toBeGreaterThan(0);

  // 决定：canonical 的 actor=system、授权来源=delegated、delegator 指向那份策略、策略版本与时间都在。
  const decision = view.body.decisions.find(entry => entry.decision.proposalRef.proposalId === accepted.proposalId);
  expect(decision, JSON.stringify(view.body.decisions.map(entry => entry.decision.decisionId))).toBeDefined();
  expect(decision!.decision.actor).toEqual({ kind: 'system', id: 'autonomous-rework' });
  expect(decision!.decision.outcome).toBe('accept');
  expect(decision!.decision.authority.strategy).toBe('delegated');
  expect(decision!.decision.authority.delegator).toBe('coordination-policy:coordination-policy-main@1');
  expect(decision!.decision.authority.policyVersion.length).toBeGreaterThan(0);
  expect(Number.isFinite(Date.parse(decision!.decision.decidedAt))).toBe(true);

  // revision：changeReason 逐字是 autonomous-rework:<proposalId>，新计划就是受理回执里的那一份。
  const revision = view.body.revisions.find(row => row.change.activePlanRef.planId === accepted.planRef.planId)!;
  expect(revision.change.reason).toBe('autonomous-rework:' + accepted.proposalId);
  expect(revision.change.activePlanRef.planId).toBe(accepted.planRef.planId);
  expect(revision.change.supersededPlanRefs.map(ref => ref.planId)).toContain(proposal!.proposal.sourcePlanRef.planId);
  // revision 号由 canonical 事实给出（初始计划受理也占一次），这里不断言具体数字，
  // 只要求它是一次真实推进，并且时间线与视图给出的是同一个编号。
  const goalRevision = revision.change.revision;
  expect(goalRevision).toBeGreaterThanOrEqual(2);

  // 处置行：原任务被 replace，取代者就是返工任务。
  const disposition = view.body.dispositions.find(row => row.taskId === fixture.taskId)!;
  expect(disposition, JSON.stringify(view.body.dispositions)).toBeDefined();
  expect(disposition.disposition).toBe('replace');
  expect(disposition.replacedByTaskId).toBe(reworkTaskIdFor(primaryIssueId));
  expect(disposition.sourcePlanRef.planId).toBe(proposal!.proposal.sourcePlanRef.planId);
  expect(disposition.targetPlanRef.planId).toBe(accepted.planRef.planId);
  expect(disposition.reason.length).toBeGreaterThan(0);

  // 4) 时间线：同一条 plan_accepted 条目带上 change，界面据此区分系统自动受理与人的决定。
  const state = await fixture.state();
  expect(state.timeline.status, JSON.stringify(state.timeline)).toBe('ready');
  const entry = state.timeline.timeline!.entries.find(item => item.refs.planId === accepted.planRef.planId)!;
  expect(entry, JSON.stringify(state.timeline.timeline!.entries)).toBeDefined();
  expect(entry.kind).toBe('plan_accepted');
  expect(entry.change).toEqual({
    reason: 'autonomous-rework:' + accepted.proposalId,
    actor: { kind: 'system', id: 'autonomous-rework' },
    goalRevision,
    activePlanId: accepted.planRef.planId,
    supersededPlanIds: [proposal!.proposal.sourcePlanRef.planId],
  });
  // 计划的初始受理那条不带 change：不能把"不是计划变更"说成"原因未知"。
  const initial = state.timeline.timeline!.entries.find(item => item.kind === 'plan_accepted' && !item.change)!;
  expect(initial.change).toBeUndefined();

  // 5) 重启：视图由 canonical 事实重建，受理结论逐字一致（不是进程内缓存）。
  // 返工Run现在会自动重验；本夹具的exit 1会再次失败并合法追加第二次变更。
  // 提案、决定、版本历史必须逐字保留；处置行是最新变更的视图，不能假定停止增长。
  await fixture.restart();
  const reopened = await planChangesOf(fixture);
  expect(reopened.body.status).toBe('ready');
  if (reopened.body.status !== 'ready') return;
  expect(reopened.body.proposals).toEqual(expect.arrayContaining(view.body.proposals));
  expect(reopened.body.decisions).toEqual(expect.arrayContaining(view.body.decisions));
  expect(reopened.body.revisions).toEqual(expect.arrayContaining(view.body.revisions));
  expect(reopened.body.dispositions.find(row => row.taskId === fixture.taskId)).toMatchObject({
    disposition: 'replace', replacedByTaskId: reworkTaskIdFor(primaryIssueId),
  });
  const latest = reopened.body.revisions.at(-1)!.change;
  for (const row of reopened.body.dispositions) {
    expect(row.targetPlanRef).toEqual(latest.activePlanRef);
    expect(latest.supersededPlanRefs).toContainEqual(row.sourcePlanRef);
  }
}, 180000);

it('没有计划变更时视图明确说明，而不是空白', async () => {
  const fixture = await verificationRoundFixture(cleanup, true, createGuiServer, { plan: governancePlan });
  const view = await planChangesOf(fixture);
  expect(view.status, JSON.stringify(view.body)).toBe(200);
  // 目标与初始计划都在，但没有任何计划变更事实：投影返回 not_found，应用层如实说清是"没有变更"。
  expect(view.body.status, JSON.stringify(view.body)).toBe('empty');
  expect((view.body as { reason: string }).reason).toContain('没有已落账的计划变更事实');
  expect(typeof (view.body as { observedCursor: string | null }).observedCursor).toBe('string');

  // 目标不存在时不静默返回空视图，而是明确拒绝（作用域由入口校验）。
  const unknown = await fixture.post<{ error?: string }>('/api/real/plan-changes/view', { ...scopeOf(fixture), goalId: 'no-such-goal' });
  expect(unknown.status).toBe(400);
  expect(String(unknown.body.error)).toContain('目标不存在');
}, 120000);
