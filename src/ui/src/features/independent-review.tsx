import { Alert, Badge, Button, Group, Paper, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import type { ReviewMaterialResult, ReviewPhase, ReviewRequestView, ReviewerSemanticReportV1 } from '../../../contracts/reviewer-verification.js';
import type { ReviewerProfileResult } from '../../../contracts/reviewer-context.js';
import type { VerificationRoundScope } from '../../../contracts/verification-context.js';
import type { Api } from '../api/client';
import type { GoalScope, LiveRun } from '../api/types';
import type { AppStore } from '../state/app-store';
import { mutationError } from '../api/hooks';
import { FieldRow, RawDetails } from '../components/states';

const phases: Record<ReviewPhase, string> = {
  requested: '请求已保存', material_pending: '材料或配置待补齐', work_pending: '正式审阅待受理', work_rejected: '审阅未受理',
  awaiting_result: '等待独立审阅结果', report_recorded: '原报告已保存', assessment_rejected: '报告资格未通过',
  admission_pending: '等待证据接纳', reduction_pending: '等待任务归约', settled: '审阅处理结束',
};

export function IndependentReviews({ api, scope, runs, store, refresh }: {
  api: Api; scope: GoalScope; runs: LiveRun[]; store: AppStore; refresh: () => void;
}) {
  const rounds = runs.flatMap(run => run.rounds ?? []);
  const reviews = runs.flatMap(run => run.reviews ?? []);
  const [roundId, setRoundId] = useState('');
  const selected = rounds.find(round => round.requestId === roundId) ?? rounds.at(-1);
  const [profile, setProfile] = useState<ReviewerProfileResult | null>(null);
  const [material, setMaterial] = useState<ReviewMaterialResult | null>(null);
  const [view, setView] = useState<ReviewRequestView | null>(null);
  const [rawReport, setRawReport] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [recoveryReason, setRecoveryReason] = useState('已处理启动前失败，授权重新受理');
  const mounted = useRef(true), readSequence = useRef(0), operationActive = useRef(false);
  const pending = store.pendingRequests(scope).find(request => request.kind === 'independent-review');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; readSequence.current++; }; }, []);
  useEffect(() => { setProfile(null); setMaterial(null); }, [selected?.requestId]);

  async function perform(operation: () => Promise<void>) {
    if (operationActive.current) return;
    operationActive.current = true;
    setBusy(true); setMessage(null);
    try { await operation(); }
    catch (error) { if (mounted.current) setMessage(mutationError(error).message); }
    finally { operationActive.current = false; if (mounted.current) setBusy(false); }
  }
  async function load(target: VerificationRoundScope, requestId: string) {
    const sequence = ++readSequence.current;
    const result = await api.review(target, requestId);
    if (mounted.current && sequence === readSequence.current) { setView(result); setRawReport(null); }
  }
  async function prepare() {
    if (!selected) return;
    const [nextProfile, nextMaterial] = await Promise.all([
      api.reviewerProfile(selected.scope), api.reviewMaterial(selected.scope, selected.requestId),
    ]);
    if (mounted.current) { setProfile(nextProfile); setMaterial(nextMaterial); }
  }
  async function start() {
    if (!selected || profile?.status !== 'ready' || material?.status !== 'ready') return;
    const input = { roundRequestId: selected.requestId, reviewerConfigRef: profile.ref, allowExecute: true as const };
    const claim = await store.beginRequest(scope, 'independent-review', { ...selected.scope, ...input });
    try {
      const result = await api.startReview(selected.scope, { ...input, requestId: claim.requestId });
      store.settleRequest(scope, 'independent-review', claim.requestId);
      if (mounted.current) { readSequence.current++; setView(result.review); setRawReport(null); refresh(); }
    } catch (error) {
      const failure = mutationError(error);
      if (!failure.unknown) store.settleRequest(scope, 'independent-review', claim.requestId);
      if (mounted.current) setMessage(failure.unknown ? '提交结果未知。原请求标识已保留，请先查询审阅回执。' : failure.message);
    }
  }
  async function receipt() {
    if (!pending) return;
    const result = await api.receipt(scope, { kind: 'independent-review', requestId: pending.requestId });
    if (result.found && result.review) {
      store.settleRequest(scope, 'independent-review', pending.requestId);
      await load(result.review.scope, result.requestId);
      refresh();
    } else if (mounted.current) setMessage('服务器尚无此请求记录。保持原轮次和配置，可复用同一标识重试。');
  }
  async function resume() {
    if (!view) return;
    const result = await api.resumeReview(view.scope, view.requestId);
    if (mounted.current) { readSequence.current++; setView(result.review); setRawReport(null); refresh(); }
  }
  async function recover() {
    if (!view?.recovery.allowed || !recoveryReason.trim()) return;
    const input = { previousRequestId: view.requestId, allowExecute: true as const, reason: recoveryReason.trim() };
    const claim = await store.beginRequest(scope, 'independent-review', { operation: 'recover', ...view.scope, ...input });
    try {
      const result = await api.recoverReview(view.scope, { ...input, requestId: claim.requestId });
      store.settleRequest(scope, 'independent-review', claim.requestId);
      if (mounted.current) { readSequence.current++; setView(result.review); setRawReport(null); refresh(); }
    } catch (error) {
      const failure = mutationError(error);
      if (!failure.unknown) store.settleRequest(scope, 'independent-review', claim.requestId);
      if (mounted.current) setMessage(failure.unknown ? '恢复提交结果未知。授权请求标识已保留，请先查询审阅回执。' : failure.message);
    }
  }
  async function report() {
    if (!view) return;
    const result = await api.reviewReport(view.scope, view.requestId);
    if (mounted.current) setRawReport(result.body);
  }

  useEffect(() => {
    if (!view || busy || !['requested', 'work_pending', 'awaiting_result', 'report_recorded', 'admission_pending', 'reduction_pending'].includes(view.phase)) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void api.review(view.scope, view.requestId).then(result => {
        if (!cancelled && mounted.current) setView(result);
      }).catch(error => { if (!cancelled && mounted.current) setMessage(mutationError(error).message); });
    }, 2500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [api, view, busy]);

  const profileIssues = profile && profile.status !== 'ready' ? (profile.status === 'incomplete' ? profile.missing : profile.issues) : [];
  const materialIssues = material && material.status !== 'ready' ? (material.status === 'incomplete' ? material.missing : material.issues) : [];
  const decision = view?.assessment?.body.decision;
  let details: ReviewerSemanticReportV1 | null = null;
  if (rawReport !== null && decision?.status === 'accepted') {
    try { const parsed = JSON.parse(rawReport); if (parsed.kind === 'independent-review-result' && Array.isArray(parsed.issues) && Array.isArray(parsed.citations)) details = parsed; }
    catch { /* The raw body remains visible even when it cannot be rendered as structured issues. */ }
  }
  return <Paper withBorder p="xs" data-testid="independent-reviews"><Stack gap="xs">
    <Text size="sm" fw={600}>独立 Reviewer</Text>
    <Text size="xs" c="dimmed">先完成此任务的全部工具检查，再由独立只读运行审阅同一份源码和原始报告。任务是否完成由正式证据与归约结果决定。</Text>
    <Select size="xs" label="审阅所依据的工具轮次" value={selected?.requestId ?? null} disabled={busy} onChange={value => setRoundId(value ?? '')}
      data={rounds.map(round => ({ value: round.requestId, label: `${round.scope.taskId} · ${round.requestId} · ${round.outcome ?? '未结束'}` }))} data-testid="review-round" />
    <Group gap="xs">
      <Button size="xs" variant="light" disabled={!selected} loading={busy} onClick={() => void perform(prepare)} data-testid="prepare-review">核对材料与审阅配置</Button>
      <Button size="xs" disabled={profile?.status !== 'ready' || material?.status !== 'ready'} loading={busy} onClick={() => void perform(start)} data-testid="start-review">发起独立审阅</Button>
    </Group>
    {profile?.status === 'ready' ? <Stack gap={2} data-testid="review-profile">
      <Text size="xs">审阅模型：{profile.profile.model.provider} / {profile.profile.model.model}</Text>
      <Text size="xs" c="dimmed">只读权限；沿用原任务预算。模型配置或来源变化后需重新核对。</Text>
    </Stack> : null}
    {material?.status === 'ready' ? <Text size="xs" c="green">工具材料已核对，待审阅要求 {material.descriptor.requiredReviewerCoverage.length} 项。</Text> : null}
    {[...profileIssues, ...materialIssues].map((issue, index) => <Text size="xs" c="yellow" key={index}>{issue}</Text>)}
    {pending ? <Alert color="yellow" data-testid="review-pending"><Text size="xs">审阅请求尚未确认：{pending.requestId}</Text><Button size="xs" loading={busy} onClick={() => void perform(receipt)} data-testid="review-query-receipt">查询审阅回执</Button></Alert> : null}
    {message ? <Alert color="yellow" role="status" data-testid="review-message">{message}</Alert> : null}
    <Text size="xs" fw={600}>已保存审阅（{reviews.length}）</Text>
    {reviews.map(review => <Group key={review.reviewId} justify="space-between"><Text size="xs">{review.scope.taskId} · {phases[review.phase]}</Text><Button size="xs" variant="light" loading={busy} onClick={() => void perform(() => load(review.scope, review.requestId))} data-testid={`open-review-${review.requestId}`}>查看审阅</Button></Group>)}
    {view ? <Stack gap="xs" data-testid="review-detail">
      <FieldRow label="审阅状态">{phases[view.phase]}</FieldRow>
      <FieldRow label="独立运行" mono>{view.work?.reviewerRunRef.runId ?? '尚未建立'}</FieldRow>
      {view.recoveryRequest ? <Text size="xs">恢复自请求：{view.recoveryRequest.previousRequestId}；授权原因：{view.recoveryRequest.reason}</Text> : null}
      <FieldRow label="当前材料资格">{view.current.status === 'current' ? '当前有效' : view.current.status === 'stale' ? '来源或配置已过期' : '当前无法确认'}</FieldRow>
      {view.current.issues.map((issue, index) => <Text size="xs" c="yellow" key={index}>{issue}</Text>)}
      {view.gaps.map((gap, index) => <Text size="xs" c="yellow" key={index}>{gap.message}</Text>)}
      {view.execution?.status === 'ended' && !view.rawReportRef ? <Alert color={view.recovery.allowed ? 'yellow' : 'gray'} data-testid="review-recovery">
        <Stack gap="xs">
          <Text size="xs">失败原因：{view.recovery.failureReason || '没有足够的持久失败说明'}</Text>
          <Text size="xs">{view.recovery.allowed ? '服务端已确认模型与工具尚未启动，可显式授权重新受理。' : '不允许重新执行：' + view.recovery.issues.join('；')}</Text>
          <Text size="xs" c="dimmed">原审阅记录保留。授权后建立新的独立审阅，并重新核对材料和结果。</Text>
          <TextInput size="xs" label="恢复授权原因" value={recoveryReason} maxLength={1000} disabled={busy || !view.recovery.allowed} onChange={event => setRecoveryReason(event.currentTarget.value)} data-testid="review-recovery-reason" />
          <Button size="xs" color="yellow" disabled={!view.recovery.allowed || !recoveryReason.trim()} loading={busy} onClick={() => void perform(recover)} data-testid="recover-review">授权重新受理审阅</Button>
        </Stack>
      </Alert> : null}
      {decision?.status === 'accepted' ? <Table withTableBorder fz="xs" data-testid="review-requirements"><Table.Thead><Table.Tr><Table.Th>义务 / 要求</Table.Th><Table.Th>结果</Table.Th><Table.Th>依据摘要</Table.Th></Table.Tr></Table.Thead><Table.Tbody>
        {decision.requirements.map(requirement => <Table.Tr key={requirement.obligationId + ':' + requirement.requirementId}><Table.Td>{requirement.obligationId} / {requirement.requirementId}</Table.Td><Table.Td><Badge color={requirement.outcome === 'PASS' ? 'green' : requirement.outcome === 'FAIL' ? 'red' : 'yellow'}>{requirement.outcome}</Badge></Table.Td><Table.Td>{requirement.summary}</Table.Td></Table.Tr>)}
      </Table.Tbody></Table> : decision?.status === 'rejected' ? <Alert color="red">报告未通过资格校验：{decision.reasonCodes.join('、')}</Alert> : null}
      <FieldRow label="正式证据接纳">{view.formal.resultRef ? `${view.formal.evidenceRefs.length} 条证据` : '尚未接纳'}</FieldRow>
      <FieldRow label="正式任务状态">{view.formal.taskPhase ?? '尚无归约回执'}</FieldRow>
      <FieldRow label="正式目标状态">{view.formal.goalPhase ?? '尚无归约回执'}</FieldRow>
      <Group gap="xs">
        <Button size="xs" variant="light" loading={busy} onClick={() => void perform(() => load(view.scope, view.requestId))}>刷新审阅状态</Button>
        {view.rawReportRef ? <Button size="xs" variant="light" loading={busy} onClick={() => void perform(report)} data-testid="review-raw-report">查看原始审阅报告</Button> : null}
        {!['settled', 'assessment_rejected', 'work_rejected'].includes(view.phase) ? <Button size="xs" color="yellow" loading={busy} onClick={() => void perform(resume)} data-testid="resume-review">对账并继续此审阅</Button> : null}
      </Group>
      {details?.issues.map(issue => <Paper withBorder p="xs" key={issue.issueId} data-testid="review-issue">
        <Text size="xs" fw={600}>{issue.description}</Text><Text size="xs">影响：{issue.impact}</Text>
        <Text size="xs" c="dimmed">涉及要求：{issue.coverage.map(item => item.obligationId + ' / ' + item.requirementId).join('；')}</Text>
        {details!.citations.filter(citation => issue.citationIds.includes(citation.citationId)).map(citation => <Text size="xs" key={citation.citationId}>
          {citation.location.kind === 'source-lines' ? `${citation.location.path}:${citation.location.startLine}–${citation.location.endLine}` : `${citation.materialId} ${citation.location.pointer}`}
        </Text>)}
      </Paper>)}
      {rawReport !== null ? <Paper withBorder p="xs"><Text size="xs" c="dimmed">已保存的历史原报告；当前材料资格与正式接纳状态见上方。</Text><Text size="xs" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }} data-testid="review-raw-body">{rawReport}</Text></Paper> : null}
      <RawDetails value={view} label="查看完整审阅记录" />
    </Stack> : null}
  </Stack></Paper>;
}
