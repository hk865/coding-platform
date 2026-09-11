/**
 * RW-06 真实 HTTP 接线：验证归约之后，组合根自动触发返工驱动，结论可由只读入口查询。
 *
 * 这里用的是**真实应用**：真实 HTTP 服务、真实内核（只有外部模型是本地桩）、真实 SQLite
 * 账本与 Vault、真实 VerificationService 的问题出口、真实 RW-03 编译器与 RW-04 受理入口。
 *
 * 本文件断言的是产品今天的真实行为：产品里**没有**经 install/activate 生效的
 * CoordinationPolicy，因此 RW-04 不套用任何默认预算，自动受理被拒绝——而这个结论必须
 * 可见（驱动结果与 canonical 事实都能查到），并且**零写入**（没有落账提案、没有第二个
 * revision）。授予自动化预算属于治理入口，不是本驱动可以自己决定的事。
 * 「满足四条边界后受理成新 revision 并把返工任务派发出去」的完整链在真实 harness 上验证
 * （tests/control/rework-drive-harness.test.ts）。
 */
import { afterEach, expect, it } from 'vitest';
import type { VerificationRegisteredCheck, VerificationRoundResult } from '../../src/contracts/verification-round.js';
import type { OpenIssuesViewV1 } from '../../src/contracts/rework/issues.js';
import type { ReworkDriveResultV1, ReworkDriveViewV1 } from '../../src/contracts/rework/drive.js';
import { verificationRoundFixture as createRoundFixture } from './verification-round-fixture.js';
import { independentReviewFixture } from './independent-review-fixture.js';
import { createGuiServer } from '../../src/app/server.js';

const cleanup: Array<() => Promise<void>> = [];
const fixtureFor = (reviewerRequired = false) => createRoundFixture(cleanup, reviewerRequired, createGuiServer);
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
type Fixture = Awaited<ReturnType<typeof fixtureFor>>;
const scopeFor = (fixture: Fixture) => ({ ...fixture.scope, runId: fixture.runId, taskId: fixture.taskId });
const check = (fixture: Fixture, checkId: string, command: string, timeoutMs = 3000): VerificationRegisteredCheck => ({
  checkId, kind: 'dynamic', command, cwd: '.', timeoutMs,
  appliesTo: { workspaceId: fixture.scope.workspaceId, taskIds: [fixture.taskId] },
});

type ReworkStatus = { view: ReworkDriveViewV1; lastDrive: ReworkDriveResultV1 | null };
/** 只依赖作用域与 HTTP 入口：审阅夹具是同一种宿主的不同封装，不重复断言它的形状。 */
const statusOf = (fixture: { scope: { projectId: string; workspaceId: string }; post: <T>(path: string, input: unknown) => Promise<{ status: number; body: T }> }) =>
  fixture.post<ReworkStatus>('/api/real/rework/status', { ...fixture.scope });

it('工具轮次真实 FAIL 之后自动触发：产生真实提案，边界不满足时停住并可见，且零写入；重复触发幂等、重启后由 canonical 重建', async () => {
  const fixture = await fixtureFor();
  const started = await fixture.post<VerificationRoundResult>('/api/real/verifications/rounds/start', {
    ...scopeFor(fixture), requestId: 'rw06-fail', allowExecute: true,
    configuration: { checks: [check(fixture, 'failing-check', 'exit 1')] },
  });
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  expect(started.body.round.outcome).toBe('FAIL');
  const planInEffect = started.body.round.materialIdentity!.planRef.planId;

  // 触发点在验证收口之后：上面这个动作返回时驱动已经跑过（不是按需才跑）。
  const status = await statusOf(fixture);
  expect(status.status, JSON.stringify(status.body)).toBe(200);
  const { view, lastDrive } = status.body;
  expect(lastDrive, JSON.stringify(status.body)).not.toBeNull();
  expect(lastDrive!.status, JSON.stringify(lastDrive)).toBe('driven');
  expect(lastDrive!.scope).toEqual({ projectId: fixture.scope.projectId, workspaceId: fixture.scope.workspaceId, goalId: fixture.scope.goalId });

  // 未处置问题与既有只读出口是同一份事实（同一次读取逐字一致）。
  const issues = await fixture.post<OpenIssuesViewV1>('/api/real/rework/issues', { ...fixture.scope });
  expect(view.issues).toEqual(issues.body);
  expect(view.issues.status).toBe('ready');
  if (view.issues.status !== 'ready') return;
  expect(view.issues.issues.length).toBeGreaterThan(0);
  expect(view.issues.issues.every((issue) => issue.currentness.status === 'open')).toBe(true);

  // 提案由 RW-03 的真实编译器从真实 FAIL 机械推导出来，身份是确定性的。
  expect(view.proposal.status, JSON.stringify(view.proposal)).toBe('proposal');
  expect(view.proposal.proposalId!.startsWith('rework-proposal-')).toBe(true);
  expect(view.proposal.planId!.startsWith('plan-rework-')).toBe(true);
  expect(view.proposal.message).toContain(view.proposal.proposalId!);

  // 受理结论可见：产品没有生效的 CoordinationPolicy，RW-04 不套默认预算，拒绝自动受理。
  const outcome = lastDrive!.outcomes[0]!;
  expect(outcome.status, JSON.stringify(outcome)).toBe('rejected');
  if (outcome.status !== 'rejected') return;
  expect(outcome.origin).toBe('acceptance');
  expect(outcome.code).toBe('governance_unavailable');
  expect(outcome.reasons.join(' ')).toContain('CoordinationPolicy');
  expect(lastDrive!.acceptedPlanRefs).toEqual([]);
  expect(lastDrive!.issues).toEqual(view.issues);

  // 零写入：没有落账提案，也没有把 revision 往前推。
  expect(view.acceptance.proposalRecorded).toBe(false);
  expect(view.acceptance.applied).toBe(false);
  expect(view.acceptance.appliedProposalId).toBeNull();
  expect(view.acceptance.activePlanRef!.planId).toBe(planInEffect);

  // 重复触发（同一轮次重放同样会再次触发驱动）：结论逐字相同，没有第二个 revision。
  const replay = await fixture.post<VerificationRoundResult>('/api/real/verifications/rounds/start', {
    ...scopeFor(fixture), requestId: 'rw06-fail', allowExecute: true,
    configuration: { checks: [check(fixture, 'failing-check', 'exit 1')] },
  });
  expect(replay.body.replayed).toBe(true);
  const again = await statusOf(fixture);
  expect(again.body.view).toEqual(view);
  expect(again.body.lastDrive!.outcomes).toEqual(lastDrive!.outcomes);
  expect(again.body.view.acceptance.activePlanRef!.planId).toBe(planInEffect);

  // 重启：会话内的触发结果不冒充持久事实（为 null），而问题是持久事实，
  // 由 journal 重建后与重启前逐字一致。
  await fixture.restart();
  const reopened = await statusOf(fixture);
  expect(reopened.body.lastDrive).toBeNull();
  expect(reopened.body.view.issues).toEqual(view.issues);
  expect(reopened.body.view.proposal).toEqual(view.proposal);
  expect(reopened.body.view.acceptance).toEqual(view.acceptance);
}, 120000);

it('独立审阅交付 FAIL 结论之后同样触发驱动：问题来源是审阅结论，提案照样机械推导出来', async () => {
  const fixture = await independentReviewFixture(cleanup, createGuiServer, { result: 'FAIL' });
  const round = await fixture.round();
  expect(round.status, JSON.stringify(round.body)).toBe(200);
  const started = await fixture.start();
  expect(started.response.status, JSON.stringify(started.response.body)).toBe(200);

  // 审阅在后台交付正式结论；驱动在 resume 完成之后被触发。等到「审阅来源的问题」也进入了
  // 一次触发的结论为止（早先由工具轮次触发的那一次不可能包含它）。
  const deadline = Date.now() + 30000;
  let view: ReworkDriveViewV1 | null = null;
  let lastDrive: ReworkDriveResultV1 | null = null;
  for (;;) {
    const current = (await statusOf(fixture)).body;
    const issues = current.view.issues.status === 'ready' ? current.view.issues.issues : [];
    const reviewIssue = issues.find((issue) => issue.source.kind === 'review_verdict' && issue.currentness.status === 'open');
    if (reviewIssue !== undefined && current.lastDrive?.outcomes.some((outcome) => outcome.issueIds.includes(reviewIssue.issueId))) {
      view = current.view;
      lastDrive = current.lastDrive;
      break;
    }
    if (Date.now() >= deadline) throw Error('返工驱动没有被独立审阅路径触发：' + JSON.stringify(current));
    await new Promise((done) => setTimeout(done, 50));
  }
  if (view === null || lastDrive === null) throw Error('unreachable');
  // 问题来源如实标为审阅结论，而不是被改写成工具轮次的形状。
  expect(view.issues.status).toBe('ready');
  if (view.issues.status !== 'ready') return;
  expect(view.issues.issues.some((issue) => issue.source.kind === 'review_verdict')).toBe(true);
  // 提案照样由 RW-03 从审阅结论机械推导出来（身份确定性）。
  expect(view.proposal.status, JSON.stringify(view.proposal)).toBe('proposal');
  expect(view.proposal.proposalId!.startsWith('rework-proposal-')).toBe(true);
  // 受理结论可见且零写入：产品没有生效的 CoordinationPolicy，不套默认预算。
  const outcome = lastDrive.outcomes[0]!;
  expect(outcome.status).toBe('rejected');
  if (outcome.status !== 'rejected') return;
  expect(outcome.code).toBe('governance_unavailable');
  expect(view.acceptance.applied).toBe(false);
  expect(view.acceptance.activePlanRef!.planId).not.toBe(view.proposal.planId);
}, 180000);

it('没有任何验证结论时：只读视图不编造提案，也没有触发结果', async () => {
  const fixture = await fixtureFor();
  const status = await statusOf(fixture);
  expect(status.status, JSON.stringify(status.body)).toBe(200);
  expect(status.body.lastDrive).toBeNull();
  expect(status.body.view.issues).toMatchObject({ status: 'none' });
  expect(status.body.view.proposal).toMatchObject({ status: 'not_compiled', proposalId: null, planId: null });
  expect(status.body.view.acceptance).toMatchObject({ proposalRecorded: false, applied: false });
}, 60000);
