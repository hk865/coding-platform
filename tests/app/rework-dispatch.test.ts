/**
 * RW-07 真实产品链：**验证 FAIL → 自动受理成新 revision → 产品自己的派发入口把返工任务
 * 跑出来**。
 *
 * 这里用的是完整产品宿主：真实 HTTP 服务、真实内核（只有外部模型是本地桩）、真实 SQLite
 * 账本与 Vault、真实治理入口（人经 install/activate 授予自动化返工预算）、真实 Verification
 * 轮次、真实 RW-03 编译器与 RW-04 受理入口。测试**没有**调用 claimTask，也没有自己拼问题：
 * 它只提交一次真实 FAIL 轮次，然后等产品把返工任务派发出去。
 *
 * 组合根的两个触发点（都在 src/app/service.ts，本票不改它们，只依赖它们）：
 *   - 验证收口之后触发返工驱动（triggerRework）；
 *   - 受理推进 revision 之后继续走既有派发收口（advancePlanning → PlannedTaskDispatch.drivePending）。
 * RW-07 之前，第二步只会遍历初始 origin 的 assignments，返工任务没有任何入口认领它——
 * 本用例断言的正是这一跳现在接通了。
 */
import { afterEach, expect, it } from 'vitest';
import type { VerificationRegisteredCheck, VerificationRoundResult } from '../../src/contracts/verification-round.js';
import type { ReworkDriveResultV1, ReworkDriveViewV1 } from '../../src/contracts/rework/drive.js';
import type { GovernanceActivateResultV1, GovernanceInstallResultV1 } from '../../src/contracts/governance-view.js';
import { verificationRoundFixture as createRoundFixture } from './verification-round-fixture.js';
import { createGuiServer } from '../../src/app/server.js';

const cleanup: Array<() => Promise<void>> = [];
/**
 * 初始协调的模型桩提案：只声明**工具类**验收要求。
 * 为什么不用夹具默认提案：RW-04 的自动受理边界 (a) 要求每条失败要求都有已提交结论，而工具
 * 轮次不产生 reviewer 类要求的结论（那条要求会被如实记成"没有结论"并让自动受理转人工）。
 * 本用例要验证的是"受理之后的派发跳"，因此计划里只放工具类要求，避免把两件事混在一起。
 */
function dynamicOnlyProposal() {
  return {
    kind: 'plan',
    summary: '用工具检查核对 subject.txt 的实际行为。',
    assignments: [{ taskId: 'coding-task', role: 'executor', instruction: 'Inspect subject.txt and report its public result; registered tool checks must verify it.' }],
    plan: {
      stages: [{ stageId: 'work', title: 'File task' }],
      tasks: [
        { taskId: 'coding-task', stageId: 'work', title: 'Inspect file', taskKind: 'work', requirementLevel: 'required', disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: 'work' } },
        { taskId: 'gate-goal', title: 'Independent verification', taskKind: 'gate', requirementLevel: 'required', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      ],
      obligations: [{
        obligationId: 'coding-result', title: 'File behavior verified by registered checks', requirementLevel: 'required', taskIds: ['coding-task', 'gate-goal'],
        verificationRequirements: [{ requirementId: 'independent-check', requirementLevel: 'required', kind: 'dynamic', description: 'Run all registered behavior checks.' }],
      }],
      taskHierarchy: { parentOf: [{ parentTaskId: 'gate-goal', childTaskId: 'coding-task' }] },
      executionDag: { dependsOn: [{ taskId: 'gate-goal', dependsOnId: 'coding-task', requires: { kind: 'gate-result', label: 'Current Task verification' } }] },
    },
  };
}
const fixtureFor = () => createRoundFixture(cleanup, true, createGuiServer, { plan: () => dynamicOnlyProposal() });
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
type Fixture = Awaited<ReturnType<typeof fixtureFor>>;
const scopeFor = (fixture: Fixture) => ({ ...fixture.scope, runId: fixture.runId, taskId: fixture.taskId });
const check = (fixture: Fixture, checkId: string, command: string): VerificationRegisteredCheck => ({
  checkId, kind: 'dynamic', command, cwd: '.', timeoutMs: 3000,
  appliesTo: { workspaceId: fixture.scope.workspaceId, taskIds: [fixture.taskId] },
});
/** 人经正式治理入口提交的协调策略：它授予的自动返工额度就是自动受理的授权来源。 */
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
const FAILING_COMMAND = 'exit 1';

it('真实 FAIL 自动受理成新 revision 之后，产品自己的派发入口把返工任务认领并跑出一个 Run', async () => {
  const fixture = await fixtureFor();
  // 前置：初始计划已经由产品派发并跑完（fixture 自己等到 run completed）。
  expect(fixture.runId).not.toBe('');

  // 1) 人经正式治理入口安装并激活协调策略（预算 1 次自动返工）；没有它自动受理会 governance_unavailable。
  const source = coordinationSource('rw07-coordination-policy', 1);
  const installed = await fixture.post<GovernanceInstallResultV1>('/api/real/governance/install', { ...fixture.scope, kind: 'CoordinationPolicy', source });
  expect(installed.body, JSON.stringify(installed.body)).toMatchObject({ status: 'committed', sourceOrigin: 'caller-provided' });
  const pin = { ref: installed.body.revisionRef!, digest: installed.body.contentDigest! };
  const activated = await fixture.post<GovernanceActivateResultV1>('/api/real/governance/activate', { ...fixture.scope, kind: 'CoordinationPolicy', pin });
  expect(activated.body, JSON.stringify(activated.body)).toMatchObject({ status: 'committed', activatedRevision: installed.body.revisionRef });

  // 2) 一次真实的工具轮次 FAIL：验证收口之后组合根自动触发返工驱动。
  const started = await fixture.post<VerificationRoundResult>('/api/real/verifications/rounds/start', {
    ...scopeFor(fixture), requestId: 'rw07-fail', allowExecute: true,
    configuration: { checks: [check(fixture, 'rw07-failing-check', FAILING_COMMAND)] },
  });
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  expect(started.body.round.outcome).toBe('FAIL');
  const supersededPlanId = started.body.round.materialIdentity!.planRef.planId;

  // 3) 等产品自己把这一跳走完：受理成新 revision，并且返工任务被派发成一个真实 Run。
  const deadline = Date.now() + 90000;
  let view: ReworkDriveViewV1 | null = null, lastDrive: ReworkDriveResultV1 | null = null, reworkTaskId = '', reworkRun: { spec: { runId: string; taskId: string; instruction: string }; status: string } | null = null;
  for (;;) {
    const status = await fixture.post<{ view: ReworkDriveViewV1; lastDrive: ReworkDriveResultV1 | null }>('/api/real/rework/status', { ...fixture.scope });
    const state = await fixture.state();
    // 问题的当前性会随受理改变（受理后它来自已被取代的 revision），因此取**最近一次驱动**
    // 回报的问题事实；不管当前性如何，它都带着确定性的返工任务身份。
    const driven = status.body.lastDrive?.issues.status === 'ready' ? status.body.lastDrive.issues.issues : [];
    const viewed = status.body.view.issues.status === 'ready' ? status.body.view.issues.issues : [];
    const candidate = driven[0] ?? viewed[0];
    if (candidate) reworkTaskId = candidate.reworkTaskId;
    const run = state.liveRuns.find((entry) => entry.spec.taskId === reworkTaskId) ?? null;
    if (status.body.view.acceptance.applied && reworkTaskId !== '' && run !== null) {
      view = status.body.view; lastDrive = status.body.lastDrive; reworkRun = run; break;
    }
    if (Date.now() >= deadline) throw Error('返工任务没有被产品派发出去：' + JSON.stringify({ applied: status.body.view.acceptance, reworkTaskId, runs: state.liveRuns.map((entry) => entry.spec.taskId), lastDrive: status.body.lastDrive }));
    await new Promise((done) => setTimeout(done, 50));
  }
  if (view === null || lastDrive === null || reworkRun === null) throw Error('unreachable');

  // 受理是真的自动受理：四条边界都满足，active revision 前进到新计划。
  const outcome = lastDrive.outcomes[0]!;
  expect(outcome.status, JSON.stringify(outcome)).toBe('accepted');
  if (outcome.status !== 'accepted') return;
  expect(view.acceptance.appliedProposalId).toBe(outcome.proposalId);
  expect(view.acceptance.activePlanRef!.planId).not.toBe(supersededPlanId);

  // 派发是真的：返工任务的 Run 由产品自己的派发入口认领（测试没有 claimTask），
  // 指令正文引用的是已提交的失败事实，而不是空指令或初始计划的旧指令。
  expect(reworkRun.spec.runId.startsWith('real-')).toBe(true);
  expect(reworkRun.spec.instruction).toContain('已提交的失败事实');
  expect(reworkRun.spec.instruction).toContain(FAILING_COMMAND);
  expect(reworkRun.spec.instruction).toContain('coding-result');

  // 被取代的任务不再被派发（它只有初始那一个 Run），gate 从来没有实现 Run。
  const state = await fixture.state();
  expect(state.liveRuns.filter((entry) => entry.spec.taskId === fixture.taskId)).toHaveLength(1);
  expect(state.liveRuns.some((entry) => entry.spec.taskId === 'gate-goal')).toBe(false);

  // 4) 重启后仍一致：指派与新 revision 都是 canonical 事实，重建后返工任务仍在计划里，
  //    重复推进也不会再产生第二个认领（Run 身份确定性）。
  const before = state.liveRuns.map((entry) => entry.spec.runId).sort();
  await fixture.restart();
  const reopened = await fixture.post<{ view: ReworkDriveViewV1; lastDrive: ReworkDriveResultV1 | null }>('/api/real/rework/status', { ...fixture.scope });
  // 自动重验可能新增FAIL和待决定的提案预览；原受理身份和旧失败必须保留。
  expect(reopened.body.view.acceptance.applied).toBe(true);
  expect(reopened.body.view.acceptance.appliedProposalId).toBe(outcome.proposalId);
  expect(reopened.body.view.acceptance.activePlanRef).toEqual(view.acceptance.activePlanRef);
  expect(reopened.body.view.issues.status).toBe('ready');
  if(reopened.body.view.issues.status==='ready' && view.issues.status==='ready') {
    for(const issue of view.issues.issues) expect(reopened.body.view.issues.issues.some(row=>row.issueId===issue.issueId)).toBe(true);
  }
  // 启动恢复会重新驱动已结束Run，lastDrive可以是本次会话的新回执。
  const after = (await fixture.state()).liveRuns.map((entry) => entry.spec.runId).sort();
  expect(after).toEqual(before);
}, 180000);
