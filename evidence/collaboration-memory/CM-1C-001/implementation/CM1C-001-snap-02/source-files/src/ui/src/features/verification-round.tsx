import { Alert, Badge, Button, Group, Paper, Select, Stack, Table, Text } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import type { VerificationRoundView } from '../../../contracts/verification-round.js';
import type { Api } from '../api/client';
import { mutationError } from '../api/hooks';
import type { GoalScope, LiveRun } from '../api/types';
import type { AppStore } from '../state/app-store';
import { FieldRow, RawDetails } from '../components/states';
import { time } from '../format';
import { newCheckDraft, VerificationCheckEditor } from './verification-check-editor';
import { checkpointLabels, lifecycleLabels } from './check-report';

const lifecycle: Record<VerificationRoundView['status'], string> = {
  incomplete: '缺少材料或配置', rejected: '未受理', running: '检查进行中', interrupted: '等待对账或继续', completed: '本轮处理结束',
};
const tone = (outcome: VerificationRoundView['outcome']) => outcome === 'FAIL' ? 'red' : outcome === 'PASS' ? 'green' : 'yellow';
function checkStatus(record: VerificationRoundView['checks'][number]['record']) {
  if (!record) return '尚未执行';
  if (record.result?.status === 'ready') return record.result.observations.map(observation => observation.result).join('、');
  return checkpointLabels[record.lifecycle ?? ''] ?? lifecycleLabels[record.status] ?? record.status;
}

/** The service owns coverage, currentness, outcomes and recovery; this view renders its facts. */
export function VerificationRounds({ api, scope, runs, store, refresh, openReport }: {
  api: Api;
  scope: GoalScope;
  runs: LiveRun[];
  store: AppStore;
  refresh: () => void;
  openReport: (runId: string, requestId: string) => void;
}) {
  const [runId, setRunId] = useState('');
  const [drafts, setDrafts] = useState(() => [newCheckDraft(1)]);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [view, setView] = useState<VerificationRoundView | null>(null);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const mounted = useRef(true), readSequence = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; readSequence.current++; }; }, []);
  const selected = runs.find(run => run.spec.runId === runId) ?? runs.at(-1);
  const rounds = runs.flatMap(run => run.rounds ?? []);
  const pending = store.pendingRequests(scope).find(entry => entry.kind === 'verification-round');

  async function load(roundScope: VerificationRoundView['scope'], requestId: string) {
    const sequence = ++readSequence.current;
    setReading(true);
    try {
      const result = await api.verificationRound(roundScope, requestId);
      if (mounted.current && sequence === readSequence.current) { setView(result); setMessage(null); }
    } catch (error) {
      if (mounted.current && sequence === readSequence.current) setMessage({ error: true, text: mutationError(error).message });
    } finally { if (mounted.current && sequence === readSequence.current) setReading(false); }
  }

  async function execute() {
    if (!selected || busy) return;
    const target = { ...scope, runId: selected.spec.runId, taskId: selected.spec.taskId };
    const configuration = { checks: drafts.map(check => ({
      checkId: check.checkId.trim(), kind: check.kind, command: check.command, cwd: check.cwd,
      timeoutMs: Number(check.seconds) * 1000, appliesTo: { workspaceId: scope.workspaceId, taskIds: [target.taskId] },
    })) };
    if (!configuration.checks.length || configuration.checks.some(check => !check.checkId || !check.command.trim() || !check.cwd.trim() || !Number.isSafeInteger(check.timeoutMs) || check.timeoutMs < 1000 || check.timeoutMs > 600000)) {
      setMessage({ error: true, text: '请填写每项检查的标识、命令、执行目录，以及 1–600 秒的单次超时。' });
      return;
    }
    setBusy(true); setMessage(null);
    try {
      const claim = await store.beginRequest(scope, 'verification-round', { ...target, configuration });
      try {
        const result = await api.startVerificationRound(target, { requestId: claim.requestId, allowExecute: true, configuration });
        store.settleRequest(scope, 'verification-round', claim.requestId);
        if (mounted.current) {
          readSequence.current++; setReading(false); setView(result.round);
          setMessage({ error: false, text: result.replayed ? '已返回原轮次，未重复执行检查。' : '轮次已保存；覆盖与正式任务状态见下方结果。' });
          refresh();
        }
      } catch (error) {
        const failure = mutationError(error);
        if (!failure.unknown) store.settleRequest(scope, 'verification-round', claim.requestId);
        if (mounted.current) setMessage({ error: !failure.unknown, text: failure.unknown ? '提交结果未知。保留同一请求标识，请先查询回执：' + failure.message : failure.message });
      }
    } catch (error) { if (mounted.current) setMessage({ error: true, text: mutationError(error).message }); }
    finally { if (mounted.current) setBusy(false); }
  }

  async function queryReceipt() {
    if (!pending || reading) return;
    setReading(true);
    try {
      const receipt = await api.receipt(scope, { requestId: pending.requestId, kind: 'verification-round' });
      if (receipt.found && receipt.round) {
        store.settleRequest(scope, 'verification-round', pending.requestId);
        if (mounted.current) { await load({ ...scope, runId: receipt.round.runId, taskId: receipt.round.taskId }, receipt.requestId); refresh(); }
      } else if (mounted.current) setMessage({ error: false, text: '服务器未发现该轮次。原请求标识仍保留，恢复原配置后可用同一标识重试。' });
    } catch (error) { if (mounted.current) setMessage({ error: true, text: mutationError(error).message }); }
    finally { if (mounted.current) setReading(false); }
  }

  async function resume() {
    if (!view || busy) return;
    setBusy(true); setMessage(null);
    try {
      const result = await api.resumeVerificationRound(view.scope, view.requestId);
      if (mounted.current) { readSequence.current++; setReading(false); setView(result.round); refresh(); }
    } catch (error) { if (mounted.current) setMessage({ error: true, text: mutationError(error).message }); }
    finally { if (mounted.current) setBusy(false); }
  }

  return <Stack gap="xs" data-testid="verification-rounds">
    <Paper withBorder p="xs">
      <Stack gap="xs">
        <Text size="sm" fw={600}>任务验证轮次</Text>
        <Text size="xs" c="dimmed">配置此任务适用的全部工具检查。每轮固定计划、来源与检查配置；工具覆盖和独立审阅分别显示。</Text>
        <Select size="xs" label="针对任务运行" value={selected?.spec.runId ?? null} disabled={busy} onChange={value => setRunId(value ?? '')} data={runs.map(run => ({ value: run.spec.runId, label: (run.taskTitle ?? run.spec.taskId) + ' · ' + run.spec.runId }))} data-testid="round-run" />
        <VerificationCheckEditor checks={drafts} onChange={setDrafts} disabled={busy} />
        <Text size="xs" c="dimmed">以上检查仅适用于所选任务。点击后将在该工作区执行命令，并保存配置、报告和正式接纳结果。</Text>
        <Button size="xs" onClick={() => void execute()} loading={busy} disabled={!selected} data-testid="start-verification-round">执行本轮全部检查</Button>
        {pending ? <Alert color="yellow" data-testid="round-pending">
          <Text size="xs">轮次请求尚未确认：{pending.requestId}</Text>
          <Button size="xs" variant="light" mt={4} loading={reading} onClick={() => void queryReceipt()} data-testid="round-query-receipt">查询轮次回执</Button>
        </Alert> : null}
        {message ? <Alert color={message.error ? 'red' : 'blue'} role="status" data-testid="round-message">{message.text}</Alert> : null}
      </Stack>
    </Paper>
    <Text size="xs" fw={600}>已保存轮次（{rounds.length}）</Text>
    {rounds.map(round => <Group key={round.roundId} justify="space-between" wrap="wrap">
      <Stack gap={2}><Text size="xs">{round.scope.taskId} · {time(round.createdAt)}</Text><Text size="xs" c="dimmed">{lifecycle[round.status]} · {round.outcome ?? '尚无汇总结论'}</Text></Stack>
      <Button size="xs" variant="light" loading={reading} onClick={() => void load(round.scope, round.requestId)} data-testid={`open-round-${round.requestId}`}>查看并核对来源</Button>
    </Group>)}
    {view ? <Paper withBorder p="xs" data-testid="verification-round-detail">
      <Stack gap="xs">
        <Group justify="space-between"><Text size="sm" fw={600}>轮次结果</Text><Badge color={tone(view.outcome)} data-testid="round-outcome">{view.outcome ?? '未得出结论'}</Badge></Group>
        <FieldRow label="任务 / 运行">{view.scope.taskId} / {view.scope.runId}</FieldRow>
        <FieldRow label="轮次状态">{lifecycle[view.status]}</FieldRow>
        <FieldRow label="当前来源资格">{view.current.status === 'current' ? '当前有效来源' : view.current.status === 'stale' ? '已过期，只保留历史解释' : '当前来源无法确认'}</FieldRow>
        {view.current.issues.map((issue, index) => <Text key={index} size="xs" c="yellow">{issue}</Text>)}
        <FieldRow label="检查配置版本">{view.configuration ? `${view.configuration.version} · ${view.configuration.digest}` : '未配置'}</FieldRow>
        <FieldRow label="来源摘要" mono>{view.materialIdentity?.sourceDigest ?? '未取得'}</FieldRow>
        <FieldRow label="来源比较基准">{view.sourceProof?.kind === 'git-head-worktree' ? `当前 HEAD ${view.sourceProof.baseCommit.slice(0, 12)}；Run 前态未知` : '当前工作区快照；Run 前态未知'}</FieldRow>
        <FieldRow label="计划 / 工作区版本">{view.materialIdentity ? `${view.materialIdentity.planRef.planId}@${view.materialIdentity.planRevision} / ${view.materialIdentity.workspaceRevision}` : '未取得'}</FieldRow>
        <FieldRow label="正式任务状态">{view.control.taskPhase ?? '尚无归约回执'}</FieldRow>
        <FieldRow label="正式目标状态">{view.control.goalPhase ?? '尚无归约回执'}</FieldRow>
        {view.gaps.length ? <Alert color="yellow" data-testid="round-gaps"><Stack gap={2}>{view.gaps.map((gap, index) => <Text size="xs" key={index}>{gap.message}</Text>)}</Stack></Alert> : null}
        <Table fz="xs" withTableBorder data-testid="round-coverage">
          <Table.Thead><Table.Tr><Table.Th>义务 / 要求</Table.Th><Table.Th>检查集合</Table.Th><Table.Th>覆盖结果</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{view.coverage.map(coverage => <Table.Tr key={coverage.obligationId + ':' + coverage.requirementId}>
            <Table.Td>{coverage.obligationId} / {coverage.requirementId}</Table.Td><Table.Td>{coverage.kind === 'reviewer' ? '独立 Reviewer' : coverage.checkIds.join('、')}</Table.Td><Table.Td>{coverage.result ?? '尚未满足'}</Table.Td>
          </Table.Tr>)}</Table.Tbody>
        </Table>
        {view.checks.map(check => <Paper key={check.definition.checkId} withBorder p={6} data-testid={`round-result-${check.definition.checkId}`}>
          <Text size="xs" fw={600}>{check.definition.checkId} · {check.definition.kind}</Text>
          <Text size="xs" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{check.definition.command}</Text>
          <Text size="xs" c="dimmed">目录 {check.definition.cwd} · 单次超时 {check.definition.timeoutMs / 1000} 秒</Text>
          <Text size="xs">{checkStatus(check.record)}</Text>
          {check.record?.progress?.phase === 'report_stored' ? <Button size="xs" variant="subtle" onClick={() => openReport(view.scope.runId, check.requestId)} data-testid={`round-report-${check.definition.checkId}`}>查看原始检查报告</Button> : null}
        </Paper>)}
        <FieldRow label="聚合报告" mono>{view.aggregate?.artifactRef.digest ?? '尚未保存'}</FieldRow>
        <FieldRow label="正式证据接纳">{view.aggregate ? view.aggregate.admissions.map(admission => `${admission.coverage.requirementId}: ${admission.status === 'admitted' ? '已接纳' : '待接纳'}`).join('；') : '尚无聚合证据'}</FieldRow>
        <Group>
          <Button size="xs" variant="light" loading={reading} onClick={() => void load(view.scope, view.requestId)}>刷新来源与进度</Button>
          {view.status === 'interrupted' ? <Button size="xs" color="yellow" disabled={view.current.status !== 'current'} loading={busy} onClick={() => void resume()} data-testid="resume-verification-round">对账并继续未执行检查</Button> : null}
        </Group>
        <Text size="xs" c="dimmed">轮次结束只描述检查处理进度。Task 与 Goal 是否完成，以正式归约回执为准。</Text>
        <RawDetails value={view} label="查看轮次完整记录" />
      </Stack>
    </Paper> : null}
  </Stack>;
}
