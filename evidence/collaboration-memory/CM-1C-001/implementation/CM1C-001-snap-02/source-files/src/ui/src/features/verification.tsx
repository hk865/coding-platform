import { Alert, Badge, Box, Button, Group, Paper, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { mutationError } from '../api/hooks';
import type { CheckReportsResponse, ReceiptView } from '../api/types';
import { EmptyState, ErrorState, FieldRow, LoadingState, RawDetails, UnavailableState } from '../components/states';
import { statusTone, time } from '../format';
import type { ViewProps } from '../workbench/view-props';
import { adaptCheckReport, checkVerdict, lifecycleLabels, checkpointLabels } from './check-report';
import { VerificationRounds } from './verification-round';
import { IndependentReviews } from './independent-review';

type OpenReport = { scopeKey: string; runId: string; requestId: string; response: CheckReportsResponse } | null;

export function VerificationView({ api, data, loading, error, goalScope, store, refresh }: ViewProps) {
  const [command, setCommand] = useState('python3 -m unittest discover -s tests -v');
  const [kind, setKind] = useState<string>('dynamic');
  const [seconds, setSeconds] = useState(120);
  const [runId, setRunId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'error' | 'warning'; text: string } | null>(null);
  const [report, setReport] = useState<OpenReport>(null);
  const [receipt, setReceipt] = useState<ReceiptView | null>(null);
  const [checking, setChecking] = useState(false);

  const scopeKey = goalScope ? [goalScope.projectId, goalScope.workspaceId, goalScope.goalId].join('::') : '';
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  // Switching project or goal must drop a report that belongs to the previous scope,
  // and a late response for the old scope must never render under the new one.
  useEffect(() => { setReport(null); setMessage(null); setReceipt(null); setRunId(''); }, [scopeKey]);

  const runs = data?.liveRuns ?? [];
  const candidates = runs.filter(run => run.spec.mode !== 'explore' && run.spec.mode !== 'review');
  const effectiveRun = runId || candidates.at(-1)?.spec.runId || '';
  const checks = candidates.flatMap(run => (run.commandChecks ?? []).map(check => ({ runId: run.spec.runId, check })));
  const verifications = candidates.flatMap(run => (run.verifications ?? []).map(entry => ({ runId: run.spec.runId, entry })));
  const pendingCheck = goalScope ? store.pendingRequests(goalScope).find(entry => entry.kind === 'command-check') ?? null : null;

  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!data?.goalId) return <EmptyState title="还没有目标" description="检查命令针对一次真实运行执行；先提交开发任务。" />;

  const execute = async () => {
    if (!goalScope || !effectiveRun || busy) return;
    setBusy(true); setMessage(null); setReceipt(null);
    const timeoutMs = seconds * 1000;
    try {
      // One logical check = scope + run + command + kind + single-run timeout.
      // A retry after an unknown outcome reuses this id and payload; a new click
      // after a formal receipt is a new execution with a new id.
      const claim = await store.beginRequest(goalScope, 'command-check', [goalScope.projectId, goalScope.workspaceId, goalScope.goalId, effectiveRun, command, kind, timeoutMs]);
      if (claim.replayed) setMessage({ tone: 'info', text: '重试同一未决检查请求：' + claim.requestId });
      if (claim.replaced) setMessage({ tone: 'warning', text: '检查内容已改变，将作为新请求提交（原未决标识 ' + claim.replaced + ' 不再复用）。' });
      try {
        await api.runCheck(goalScope, { runId: effectiveRun, requestId: claim.requestId, command, kind, timeoutMs, allowExecute: true });
        store.settleRequest(goalScope, 'command-check', claim.requestId);
        setMessage({ tone: 'info', text: '检查已受理并保存报告：' + claim.requestId });
        refresh();
      } catch (failure) {
        const info = mutationError(failure);
        if (info.unknown) setMessage({ tone: 'warning', text: '检查结果未知：' + info.message + '（同一标识可安全重试，或先查询回执）' });
        else { store.settleRequest(goalScope, 'command-check', claim.requestId); setMessage({ tone: 'error', text: info.message }); }
      }
    } catch (failure) { setMessage({ tone: 'error', text: mutationError(failure).message }); }
    finally { setBusy(false); }
  };

  const queryReceipt = async () => {
    if (!goalScope || !pendingCheck || checking) return;
    setChecking(true); setMessage(null);
    try {
      const view = await api.receipt(goalScope, { requestId: pendingCheck.requestId, kind: 'command-check' });
      setReceipt(view);
      if (view.found) { store.settleRequest(goalScope, 'command-check', pendingCheck.requestId); refresh(); }
    } catch (failure) { setMessage({ tone: 'error', text: mutationError(failure).message }); }
    finally { setChecking(false); }
  };

  const open = async (targetRun: string, requestId: string) => {
    if (!goalScope) return;
    const openedFor = scopeKey;
    setMessage(null);
    try {
      const response = await api.checkReport(goalScope, targetRun, requestId);
      if (scopeRef.current !== openedFor) return; // a late report must not appear in another scope
      setReport({ scopeKey: openedFor, runId: targetRun, requestId, response });
    } catch (failure) { if (scopeRef.current === openedFor) setMessage({ tone: 'error', text: mutationError(failure).message }); }
  };

  const shown = report && report.scopeKey === scopeKey ? adaptCheckReport(report.response) : null;
  const reconcileOrAdmit = async (operation: 'reconcile' | 'admit') => {
    if (!goalScope || !report || report.scopeKey !== scopeKey || busy) return;
    const target = report, openedFor = scopeKey;
    setBusy(true); setMessage(null);
    try {
      if (operation === 'reconcile') await api.reconcileCheck(goalScope, target.runId, target.requestId);
      else {
        const digest = target.response.observations[0]?.artifactRef?.digest;
        if (!digest) throw Error('报告缺少可核对的正文摘要');
        await api.admitCheckEvidence(goalScope, target.runId, target.requestId, digest);
      }
      const response = await api.checkReport(goalScope, target.runId, target.requestId);
      if (scopeRef.current !== openedFor) return;
      setReport({ ...target, response });
      setMessage({ tone: 'info', text: operation === 'reconcile' ? '检查已对账，结果来自已保存的报告。' : '原报告已登记为检查证据。任务与目标仍按完成策略判定。' });
      refresh();
    } catch (failure) {
      if (scopeRef.current === openedFor) {
        const info = mutationError(failure);
        setMessage({ tone: info.unknown ? 'warning' : 'error', text: info.message + (info.unknown ? '；可重新查看原报告状态或使用同一报告重试。' : '') });
      }
    } finally { setBusy(false); }
  };

  return (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }}>
      <Group px="sm" py={6} className="panel-head" justify="space-between">
        <Stack gap={0}><Text size="sm" fw={600}>检查与验证</Text><Text size="xs" c="dimmed">命令检查、持久报告与独立验收结果</Text></Stack>
      </Group>
      <Box className="panel-body" style={{ minHeight: 0, overflow: 'auto' }}>
        <Stack gap="sm" p="sm">
          {!candidates.length ? <EmptyState title="还没有真实运行" description="命令检查需要一个已完成或正在运行的真实任务。" /> : null}
          {goalScope && candidates.length ? <VerificationRounds key={scopeKey} api={api} scope={goalScope} runs={candidates} store={store} refresh={refresh} openReport={(targetRun, requestId) => void open(targetRun, requestId)} /> : null}
          {goalScope && candidates.length ? <IndependentReviews key={'review-' + scopeKey} api={api} scope={goalScope} runs={candidates} store={store} refresh={refresh} /> : null}
          {candidates.length ? (
            <Paper withBorder p="xs" radius="sm">
              <Text size="xs" fw={600} mb={4}>运行独立检查</Text>
              <Stack gap={4}>
                <Select size="xs" label="针对运行" value={effectiveRun} onChange={value => setRunId(value ?? '')} data={candidates.map(run => ({ value: run.spec.runId, label: run.spec.runId + ' · ' + (run.taskTitle ?? run.spec.taskId) }))} data-testid="check-run" />
                <TextInput size="xs" label="检查命令" value={command} onChange={event => setCommand(event.currentTarget.value)} data-testid="check-command" />
                <Group gap="xs" align="flex-end">
                  <Select size="xs" label="类型" value={kind} onChange={value => setKind(value ?? 'dynamic')} data={[{ value: 'dynamic', label: '行为测试' }, { value: 'static', label: '静态检查' }]} w={130} />
                  <TextInput size="xs" label="单次超时（秒）" value={String(seconds)} onChange={event => setSeconds(Number(event.currentTarget.value.replace(/\D/g, '')) || 1)} w={130} />
                  <Button size="xs" loading={busy} onClick={() => void execute()} disabled={!effectiveRun || !command.trim()} data-testid="run-check">执行并保存报告</Button>
                </Group>
                <Text size="xs" c="dimmed">检查在项目沙箱内执行；单次超时只约束这一条命令。结果会保存但不直接完成任务，也不会自动完成目标。</Text>
                {message ? <Alert color={message.tone === 'error' ? 'red' : message.tone === 'warning' ? 'yellow' : 'blue'} variant="light" role="status" data-testid="check-message">{message.text}</Alert> : null}
                {pendingCheck ? (
                  <Alert color="yellow" variant="light" role="status" data-testid="check-pending">
                    <Stack gap={4}>
                      <Text size="xs">有一条检查请求未收到回执：{pendingCheck.requestId}</Text>
                      <Group gap="xs">
                        <Button size="xs" variant="light" loading={checking} onClick={() => void queryReceipt()} data-testid="query-check-receipt">查询服务器回执</Button>
                        <Text size="xs" c="dimmed">内容未改变时再次执行会复用该标识，不会重复创建记录。</Text>
                      </Group>
                    </Stack>
                  </Alert>
                ) : null}
                {receipt ? (
                  <Alert color={receipt.found ? 'blue' : 'gray'} variant="light" role="status" data-testid="check-receipt">
                    {receipt.found
                      ? '服务器已记录该检查：' + (receipt.check ? (lifecycleLabels[receipt.check.status] ?? receipt.check.status) + ' · ' + (receipt.check.command ?? '命令未记录') : '记录已存在')
                      : '服务器没有该请求的记录；可用同一标识安全重试。'}
                  </Alert>
                ) : null}
              </Stack>
            </Paper>
          ) : null}

          <Text size="xs" fw={600}>命令检查记录（{checks.length}）</Text>
          {checks.length ? (
            <Table striped highlightOnHover withTableBorder fz="xs">
              <Table.Thead><Table.Tr><Table.Th>记录状态</Table.Th><Table.Th>命令</Table.Th><Table.Th>类型</Table.Th><Table.Th>时间</Table.Th><Table.Th>检查结果</Table.Th><Table.Th /></Table.Tr></Table.Thead>
              <Table.Tbody>
                {checks.map(({ runId: targetRun, check }) => (
                  <Table.Tr key={check.requestId}>
                    <Table.Td><Badge size="xs" color={statusTone(check.status)} variant="light">{lifecycleLabels[check.status] ?? check.status}</Badge></Table.Td>
                    <Table.Td><Text size="xs" style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}>{check.command ?? '未记录'}</Text></Table.Td>
                    <Table.Td><Text size="xs">{check.kind === 'static' ? '静态检查' : check.kind === 'dynamic' ? '行为测试' : '未记录'}</Text></Table.Td>
                    <Table.Td><Text size="xs" c="dimmed">{time(check.finishedAt ?? check.startedAt)}</Text></Table.Td>
                    <Table.Td><Text size="xs">{checkVerdict(check)}</Text></Table.Td>
                    <Table.Td><Button size="xs" variant="subtle" onClick={() => void open(targetRun, check.requestId)} data-testid={'report-' + check.requestId}>查看报告</Button></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          ) : <Text size="xs" c="dimmed">尚无命令检查记录。</Text>}

          {shown ? (
            <Paper withBorder p="xs" radius="sm" data-testid="check-report">
              <Group justify="space-between"><Text size="xs" fw={600}>报告 · {shown.requestId}</Text><Button size="xs" variant="subtle" onClick={() => setReport(null)}>关闭</Button></Group>
              <FieldRow label="记录状态">{shown.lifecycle}</FieldRow>
              <FieldRow label="持久处理进度">{report?.response.lifecycle ? checkpointLabels[report.response.lifecycle] ?? report.response.lifecycle : '未记录'}</FieldRow>
              {report?.response.recovery ? <Alert color="yellow" variant="light" mt={6} data-testid="check-recovery">{report.response.recovery.reason}</Alert> : null}
              <FieldRow label="正式检查证据">{report?.response.evidenceAdmission?.status === 'admitted' ? '已登记' : report?.response.evidenceAdmission?.status === 'pending' ? '等待登记回执' : '尚未登记'}</FieldRow>
              <Group gap="xs" my={6}>
                {report?.response.lifecycle === 'reconciliation_required' || report?.response.status === 'interrupted' ? <Button size="xs" variant="light" loading={busy} onClick={() => void reconcileOrAdmit('reconcile')} data-testid="reconcile-check">依据原报告对账</Button> : null}
                {report?.response.lifecycle === 'lease_released' && report.response.observations.length === 1 && report.response.reports[0]?.category === 'tool_check' && report.response.reports[0]?.effects === 'known' && report.response.evidenceAdmission?.status !== 'admitted'
                  ? <Button size="xs" variant="light" loading={busy} onClick={() => void reconcileOrAdmit('admit')} data-testid="admit-check-evidence">将原报告登记为检查证据</Button> : null}
              </Group>
              <FieldRow label="命令" mono>{shown.command ?? '未记录'}</FieldRow>
              <FieldRow label="检查类型">{shown.kind === 'static' ? '静态检查' : shown.kind === 'dynamic' ? '行为测试' : '未记录'}</FieldRow>
              <FieldRow label="单次超时">{shown.timeoutMs === null ? '未记录' : shown.timeoutMs + ' ms'}</FieldRow>
              <FieldRow label="开始 / 结束">{time(shown.startedAt)} → {time(shown.finishedAt)}</FieldRow>
              <FieldRow label="记录来源">{report?.runId ?? '—'}</FieldRow>

              {shown.observations.length ? shown.observations.map((observation, index) => (
                <Stack key={index} gap={2} mt={6} data-testid={'observation-' + index}>
                  <Group gap={6}><Badge size="xs" color={statusTone(observation.result)} variant="light">{observation.result}</Badge><Text size="xs">{observation.checkId} · {observation.kind}</Text></Group>
                  <Text size="xs" c="dimmed">{observation.summary}</Text>
                  <Text size="xs" c="dimmed">报告材料{observation.reportSaved ? '已保存到 ArtifactVault' : '未保存（无法读取正文）'}</Text>
                </Stack>
              )) : <Text size="xs" c="dimmed" mt={4}>该检查没有产生观测结果。</Text>}

              {shown.reportsMissing ? <Alert color="yellow" variant="light" mt={6}>至少一项检查结果没有持久报告正文，界面不补造内容。</Alert> : null}
              {shown.reports.map((entry, index) => (
                <Stack key={entry.observationId + index} gap={2} mt={8} data-testid={'report-body-' + index}>
                  <Text size="xs" fw={600}>报告正文 · {entry.observationId}</Text>
                  <FieldRow label="命令" mono>{entry.command}</FieldRow>
                  <FieldRow label="分类">{entry.category}</FieldRow>
                  <FieldRow label="结果">{entry.result}</FieldRow>
                  <FieldRow label="退出码 / 超时">{entry.exitCode === null ? '未报告退出码' : String(entry.exitCode)}{entry.timedOut ? ' · 超时' : ''}{entry.cancelled ? ' · 已取消' : ''}{entry.signal ? ' · 信号 ' + entry.signal : ''}</FieldRow>
                  <FieldRow label="来源摘要" mono>{entry.sourceDigest.slice(0, 24)}</FieldRow>
                  <FieldRow label="工作区版本">{entry.workspaceRevision === null ? '未记录' : String(entry.workspaceRevision)}</FieldRow>
                  <FieldRow label="计划版本">{entry.planRef ?? '未记录'}</FieldRow>
                  <FieldRow label="沙箱">{entry.sandboxProfileVersion ?? '未记录'}</FieldRow>
                  <FieldRow label="时间">{time(entry.startedAt)} → {time(entry.endedAt)}</FieldRow>
                  {entry.missing.length ? <Text size="xs" c="yellow">报告缺少字段：{entry.missing.join('、')}（旧记录可能没有该投影）</Text> : null}
                  <Text size="xs" fw={500} mt={2}>标准输出{entry.stdoutTruncated ? '（已截断）' : ''}</Text>
                  {entry.stdout ? <pre className="report-output" data-testid={'report-stdout-' + index}>{entry.stdout}</pre> : <Text size="xs" c="dimmed" data-testid={'report-stdout-' + index}>（空）</Text>}
                  <Text size="xs" fw={500} mt={2}>标准错误{entry.stderrTruncated ? '（已截断）' : ''}</Text>
                  {entry.stderr ? <pre className="report-output" data-testid={'report-stderr-' + index}>{entry.stderr}</pre> : <Text size="xs" c="dimmed" data-testid={'report-stderr-' + index}>（空）</Text>}
                </Stack>
              ))}
              <RawDetails value={report?.response ?? {}} label="查看原始报告 JSON" />
            </Paper>
          ) : null}

          <Text size="xs" fw={600}>独立验收记录（{verifications.length}）</Text>
          {verifications.length ? verifications.map(({ entry }) => (
            <Paper key={entry.verificationId} withBorder p="xs" radius="sm">
              <Group gap={4}><Badge size="xs" color={statusTone(entry.verdict)} variant="light">{entry.verdict}</Badge><Text size="xs">{entry.purpose}</Text><Text size="xs" c="dimmed">{entry.source?.name ?? '外部评分器'} · {time(entry.completedAt ?? entry.importedAt)}</Text></Group>
              <Text size="xs" c="dimmed">通过 {entry.counts?.passed ?? '—'} · 失败 {entry.counts?.failed ?? '—'} · 缺失 {entry.counts?.missing ?? '—'} · 正式判定{entry.control?.status === 'applied' ? '已回流' : '待回流'}</Text>
              {(entry.failedTests ?? []).length ? <Text size="xs" c="red">失败：{(entry.failedTests ?? []).join('、')}</Text> : null}
              {(entry.missingTests ?? []).length ? <Text size="xs" c="yellow">缺失：{(entry.missingTests ?? []).join('、')}</Text> : null}
            </Paper>
          )) : <Text size="xs" c="dimmed">尚无独立验收记录。模型完成声明不会自动变成通过。</Text>}

          <UnavailableState
            title="授权返工与重验"
            reason="独立审阅的阻断问题会保留。范围内的自动返工已接通：验证留下问题 → 生成返工提案 → 在协调策略授权内自动受理成新的计划修订 → 按新修订派发返工任务；这些事实在「返工与问题」与「计划变更」两个视图中查看，本视图不重复。尚缺的是：需要人决定的越界返工没有提交入口；返工后的最新版本还没有自动重新验证与再次归约。"
            dependencies={['需人决定的返工提交入口', '返工后最新版本的重新验证与再次归约']}
          />
        </Stack>
      </Box>
    </Stack>
  );
}
