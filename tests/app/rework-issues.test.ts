/**
 * 真实 HTTP 消费：/api/real/rework/issues 必须把真实工具轮次留下的 FAIL 呈现为
 * 带来源、且能回答「为什么 fail」的未处置问题（这是界面与返工提案共用的同一份事实出口）。
 *
 * 边界：命令真实执行在沙箱里（分类由 CommandCheckProvider 判定并持久化）。失败事实里
 * 的分类／命令／超时预算／来源摘要／报告引用来自 journal 的检查记录与轮次；退出码、是否
 * 超时、stderr 摘要这些只存在于原始报告正文里的事实，要么给出真值，要么给出明确缺口，
 * 不允许两者都没有。原始报告本身通过既有 /api/real/verifications/check-report 读取，
 * 下面的断言用它核对「问题指的报告就是那份真实报告」。
 */
import { afterEach, expect, it } from 'vitest';
import type { VerificationRegisteredCheck, VerificationRoundResult, VerificationRoundView } from '../../src/contracts/verification-round.js';
import type { OpenIssuesViewV1 } from '../../src/contracts/rework/issues.js';
import { verificationRoundFixture as createRoundFixture } from './verification-round-fixture.js';
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

/** 唯一一份问题视图：只有一个任务时断言必须打在确定的那一条上。 */
const onlyIssue = (view: OpenIssuesViewV1) => {
  if (view.status !== 'ready') throw Error('expected ready: ' + JSON.stringify(view));
  expect(view.issues).toHaveLength(1);
  return view.issues[0]!;
};

it('真实失败的检查轮次成为带来源的未处置问题，并通过 HTTP 只读出口返回', async () => {
  const fixture = await fixtureFor();
  const started = await fixture.post<VerificationRoundResult>('/api/real/verifications/rounds/start', {
    ...scopeFor(fixture), requestId: 'rework-fail', allowExecute: true,
    configuration: { checks: [check(fixture, 'failing-check', 'exit 1')] },
  });
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  expect(started.body.round.outcome).toBe('FAIL');

  const issues = await fixture.post<OpenIssuesViewV1>('/api/real/rework/issues', { ...fixture.scope });
  expect(issues.status, JSON.stringify(issues.body)).toBe(200);
  expect(issues.body.status).toBe('ready');
  const issue = onlyIssue(issues.body);
  expect(issue.taskId).toBe(fixture.taskId);
  expect(issue.source).toMatchObject({ kind: 'verification_round', requestId: 'rework-fail', outcome: 'FAIL', status: 'completed' });
  expect(issue.source.kind === 'verification_round' && issue.source.sourceDigest !== null).toBe(true);
  expect(issue.runRef.runId).toBe(fixture.runId);
  expect(issue.planRef.planId.length).toBeGreaterThan(0);
  expect(issue.failedRequirements.length).toBeGreaterThan(0);
  expect(issue.failedRequirements.every(requirement => requirement.obligationId.length > 0 && requirement.requirementId.length > 0)).toBe(true);
  expect(issue.evidenceRefs.length).toBeGreaterThan(0);
  expect(issue.currentness.status).toBe('open');
  expect(issue.issueId.startsWith('rework-issue-')).toBe(true);
  expect(issue.reworkTaskId.startsWith('rework-')).toBe(true);

  // 失败事实：真实命令退出非零 -> 分类与命令来自持久记录，报告引用指向那份真实报告。
  const requirement = issue.failedRequirements[0]!;
  const failure = requirement.failure;
  expect(failure.kind).toBe('dynamic');
  expect(failure.checkId).toBe('failing-check');
  expect(failure.failedCheckIds).toEqual(['failing-check']);
  expect(failure.category).toBe('tool_check');
  expect(failure.result).toBe('FAIL');
  expect(failure.command).toBe('exit 1');
  expect(failure.timeoutMs).toBe(3000);
  expect(failure.sourceDigest).toBe(issue.source.kind === 'verification_round' ? issue.source.sourceDigest : null);
  expect(failure.reportRef).not.toBeNull();
  expect(typeof failure.durationMs).toBe('number');
  // 退出码只存在于原始报告正文里：要么给真值，要么给出为什么取不到，不能两者都没有。
  const explained = failure.gaps.some(gap => gap.includes('reportRef') || gap.includes('不可读取') || gap.includes('没有命令执行记录'));
  expect(failure.exitCode === 1 || explained).toBe(true);
  // 人类可读原因必须能看出「为什么 fail」，而不是只说结论。
  expect(requirement.reason).toContain('failing-check');
  expect(requirement.reason).toContain('tool_check');
  expect(requirement.reason).toContain('exit 1');

  // 同一份事实的真值所在的报告：用既有报告出口读回，证明问题里的引用不是空引用。
  // rounds/read 直接返回轮次视图（不是 start/resume 的 { round, replayed }）。
  const round = await fixture.post<VerificationRoundView>('/api/real/verifications/rounds/read', { ...scopeFor(fixture), requestId: 'rework-fail' });
  expect(round.status, JSON.stringify(round.body)).toBe(200);
  const child = round.body.checks[0]!;
  const report = await fixture.post<{ reports: Array<{ category?: string; result?: string; execution?: { exitCode?: number | null; timedOut?: boolean; stderr?: { text?: string } } }> }>(
    '/api/real/verifications/check-report', { ...fixture.scope, runId: fixture.runId, requestId: child.requestId });
  expect(report.status, JSON.stringify(report.body)).toBe(200);
  const stored = report.body.reports[0]!;
  expect(stored.category).toBe('tool_check');
  expect(stored.result).toBe('FAIL');
  expect(stored.execution?.exitCode).toBe(1);
  // 问题里的报告引用与那份报告是同一次检查的同一条记录。
  expect(failure.reportRef!.digest).toBe(child.record!.progress!.phase === 'report_stored' ? child.record!.progress!.artifactRef.digest : '');

  // 重复读取必须得到同一身份：问题身份是确定性事实，不是每次生成的随机值。
  const again = await fixture.post<OpenIssuesViewV1>('/api/real/rework/issues', { ...fixture.scope });
  expect(again.body).toEqual(issues.body);

  // 重开后仍能重建同一份问题（持久事实，而不是内存偶发状态）。
  await fixture.restart();
  const reopened = await fixture.post<OpenIssuesViewV1>('/api/real/rework/issues', { ...fixture.scope });
  expect(reopened.body).toEqual(issues.body);
}, 90000);

it('真实超时被杀：问题直接回报 timeout，而不是只给一个 FAIL', async () => {
  const fixture = await fixtureFor();
  const started = await fixture.post<VerificationRoundResult>('/api/real/verifications/rounds/start', {
    ...scopeFor(fixture), requestId: 'rework-timeout', allowExecute: true,
    configuration: { checks: [check(fixture, 'slow-check', 'sleep 5', 1000)] },
  });
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  // 超时不是 PASS，也不是「验收失败」：轮次结论为 INCONCLUSIVE，问题必须如实回报分类。
  expect(started.body.round.outcome).toBe('INCONCLUSIVE');

  const issues = await fixture.post<OpenIssuesViewV1>('/api/real/rework/issues', { ...fixture.scope });
  expect(issues.status, JSON.stringify(issues.body)).toBe(200);
  const requirement = onlyIssue(issues.body).failedRequirements.find(entry => entry.failure.checkId === 'slow-check')!;
  expect(requirement, JSON.stringify(issues.body)).toBeDefined();
  expect(requirement.failure.category).toBe('timeout');
  expect(requirement.failure.result).toBe('INCONCLUSIVE');
  expect(requirement.failure.timeoutMs).toBe(1000);
  expect(requirement.reason).toContain('timeout');
  // timedOut 只在原始报告正文里；没有读取端口时必须写明缺口，不允许静默省略。
  const explained = requirement.failure.gaps.some(gap => gap.includes('reportRef') || gap.includes('不可读取'));
  expect(requirement.failure.timedOut === true || explained).toBe(true);
}, 90000);

it('没有失败结论时问题出口返回明确的空状态，而不是编造问题', async () => {
  const fixture = await fixtureFor();
  const issues = await fixture.post<OpenIssuesViewV1>('/api/real/rework/issues', { ...fixture.scope });
  expect(issues.status, JSON.stringify(issues.body)).toBe(200);
  expect(issues.body).toMatchObject({ status: 'none' });
}, 60000);
