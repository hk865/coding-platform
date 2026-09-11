import { Badge, Box, Button, Group, Paper, Stack, Text, Tooltip } from '@mantine/core';
import { useState } from 'react';
import { mutationError } from '../api/hooks';
import { EmptyState, ErrorState, FieldRow, LoadingState, RawDetails } from '../components/states';
import { runLabels, statusTone, taskPhaseLabels, time } from '../format';
import type { GuiState, PlanMatrixRow } from '../api/types';
import type { ViewProps } from '../workbench/view-props';

export function taskLabel(row: PlanMatrixRow): string {
  return row.title?.trim() || row.taskId;
}

export function TaskStateBadge({ row }: { row: PlanMatrixRow }) {
  const phase = row.livePhase ?? row.plannedPhase;
  return (
    <Group gap={4} wrap="nowrap">
      <Badge color={statusTone(String(phase))} variant="light">{taskPhaseLabels[String(phase)] ?? phase}</Badge>
      {row.phaseMismatch ? <Tooltip label="计划声明与实际判定不一致"><Badge color="yellow" variant="light">不一致</Badge></Tooltip> : null}
    </Group>
  );
}

function dependenciesOf(data: GuiState, taskId: string) {
  const graph = data.graph.status === 'ready' ? data.graph.graph : null;
  return (graph?.executionDag.dependsOn ?? []).filter(edge => edge.taskId === taskId);
}

export function TaskDetail({ data, taskId, onClose }: { data: GuiState; taskId: string; onClose?: () => void }) {
  const rows = data.matrix.status === 'ready' ? data.matrix.matrix.rows : [];
  const row = rows.find(item => item.taskId === taskId);
  if (!row) return <EmptyState title="任务不存在" description="该任务不属于当前目标的计划。" />;
  const edges = dependenciesOf(data, taskId);
  const runs = (data.agents.status === 'ready' ? data.agents.agents.rows : []).filter(run => run.taskId === taskId);
  const entries = data.evidence.flatMap(view => (view.status === 'ready' && view.evidence.taskId === taskId ? view.evidence.evidence : []));
  const graph = data.graph.status === 'ready' ? data.graph.graph : null;
  return (
    <Stack gap="sm" p="sm" data-testid="task-detail">
      <Group justify="space-between" wrap="nowrap">
        <Stack gap={2}>
          <Text size="sm" fw={600}>{taskLabel(row)}</Text>
          <Group gap={4}><TaskStateBadge row={row} /><Badge color="gray" variant="light">{row.taskKind === 'gate' ? '验收门禁' : '工作'}</Badge><Badge color="gray" variant="light">{row.requirementLevel}</Badge></Group>
        </Stack>
        {onClose ? <Button size="xs" variant="subtle" onClick={onClose}>关闭</Button> : null}
      </Group>
      <FieldRow label="阶段">{row.stageTitle ?? row.stageId ?? '—'}</FieldRow>
      <FieldRow label="计划判定">{taskPhaseLabels[row.plannedPhase] ?? row.plannedPhase}</FieldRow>
      <FieldRow label="正式判定">{row.livePhase ? (taskPhaseLabels[row.livePhase] ?? row.livePhase) : '尚无正式判定'}</FieldRow>
      <FieldRow label="任务标识"><span style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}>{row.taskId}</span></FieldRow>
      <Stack gap={2}>
        <Text size="xs" fw={500}>依赖</Text>
        {edges.length ? edges.map(edge => {
          const dependency = rows.find(item => item.taskId === edge.dependsOnId);
          const satisfied = dependency?.livePhase === 'satisfied';
          return (
            <Group key={edge.taskId + edge.dependsOnId} gap="xs">
              <Badge size="xs" color={satisfied ? 'green' : 'gray'} variant="light">{satisfied ? '已满足' : '未满足'}</Badge>
              <Text size="xs">{dependency ? taskLabel(dependency) : edge.dependsOnId}</Text>
              <Text size="xs" c="dimmed">{edge.requires.label}</Text>
            </Group>
          );
        }) : <Text size="xs" c="dimmed">无前置依赖</Text>}
      </Stack>
      <Stack gap={2}>
        <Text size="xs" fw={500}>执行记录</Text>
        {runs.length ? runs.map(run => (
          <Group key={run.runRef.runId} gap="xs" wrap="nowrap">
            <Badge size="xs" color={statusTone(run.displayState)} variant="light">{runLabels[run.displayState]}</Badge>
            <Text size="xs" style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}>{run.runRef.runId}</Text>
            <Text size="xs" c="dimmed">{time(run.startedAt)} → {time(run.endedAt)}</Text>
          </Group>
        )) : <Text size="xs" c="dimmed">尚未运行。运行结束不会让任务自动通过。</Text>}
      </Stack>
      <Stack gap={2}>
        <Text size="xs" fw={500}>证据（{entries.length}）</Text>
        {entries.length ? entries.map(entry => (
          <Paper key={entry.evidenceId} withBorder p={6} radius="sm">
            <Group gap={4} wrap="nowrap"><Badge size="xs" color={statusTone(entry.outcome)} variant="light">{entry.outcome}</Badge><Text size="xs">{entry.kind}</Text><Text size="xs" c="dimmed">{entry.marker}</Text></Group>
            <Text size="xs" c="dimmed">{entry.summary}</Text>
            <Text size="xs" c="dimmed">{time(entry.admittedAt)}{entry.artifactRef?.digest ? ' · 报告摘要 ' + entry.artifactRef.digest.slice(0, 12) : ''}</Text>
          </Paper>
        )) : <Text size="xs" c="dimmed">尚无证据。工具执行成功不等于验收通过。</Text>}
      </Stack>
      {graph ? <RawDetails label="查看任务原始事实" value={{ row, edges, runs: runs.map(run => run.runRef.runId), evidence: entries.map(entry => entry.evidenceId) }} /> : null}
    </Stack>
  );
}

export function TasksView(props: ViewProps) {
  const { api, data, loading, error, store, goalScope, refresh } = props;
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const fixtureMode = data?.executionCapability?.fixtureEnabled === true;
  const act = async (key: string, run: () => Promise<unknown>, success: string) => {
    if (!goalScope || busy) return;
    setBusy(key); setMessage(null);
    try { await run(); setMessage({ tone: 'info', text: success }); refresh(); }
    catch (failure) { setMessage({ tone: 'error', text: mutationError(failure).message }); }
    finally { setBusy(null); }
  };
  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!data?.goalId) return <EmptyState title="还没有目标" description="先创建一个目标，再提交开发任务。" />;
  const rows = data.matrix.status === 'ready' ? data.matrix.matrix.rows : [];
  const graph = data.graph.status === 'ready' ? data.graph.graph : null;
  const activeRuns = data.agents.status === 'ready' ? data.agents.agents.rows : [];

  return (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }}>
      <Group justify="space-between" px="sm" py={6} className="panel-head">
        <Stack gap={0}>
          <Text size="sm" fw={600}>任务</Text>
          <Text size="xs" c="dimmed">{rows.length} 项 · {rows.filter(row => row.livePhase === 'satisfied').length} 项已验证</Text>
        </Stack>
        <Group gap={4}>
          <Button size="xs" variant="light" onClick={() => store.openView('task-graph')}>任务图</Button>
        </Group>
      </Group>
      <Box className="panel-body" style={{ minHeight: 0, overflow: 'auto' }}>
        {message ? <Text size="xs" c={message.tone === 'error' ? 'red' : 'dimmed'} px="sm" pt="xs">{message.text}</Text> : null}
        {!rows.length ? (
          <Stack gap="xs" align="flex-start" p="md">
            <Text size="sm" fw={600}>还没有执行计划</Text>
            <Text size="xs" c="dimmed">在下方提交开发任务后，服务器会创建真实计划。若只想走通本地测试适配器，可以安装样例计划。</Text>
            {goalScope ? (
              <Button size="xs" variant="light" loading={busy === 'plan'} onClick={() => void act('plan', () => api.installSamplePlan(goalScope), '样例计划已安装（测试适配器，不调用真实模型）。')} data-testid="install-sample-plan">安装样例计划（测试适配器）</Button>
            ) : null}
          </Stack>
        ) : (
          <Stack gap={6} p="sm">
            {rows.map(row => {
              const edges = dependenciesOf(data, row.taskId);
              const run = activeRuns.find(item => item.taskId === row.taskId);
              const blocked = edges.some(edge => rows.find(item => item.taskId === edge.dependsOnId)?.livePhase !== 'satisfied');
              return (
                <Paper key={row.taskId} withBorder p="xs" radius="sm" className="task-row" data-task-id={row.taskId} data-task-phase={row.livePhase ?? row.plannedPhase}>
                  <Group justify="space-between" wrap="nowrap" align="flex-start">
                    <Stack gap={2} style={{ minWidth: 0 }}>
                      <Group gap={6} wrap="nowrap"><Text size="sm" fw={500} truncate>{taskLabel(row)}</Text><TaskStateBadge row={row} /></Group>
                      <Text size="xs" c="dimmed">{row.taskKind === 'gate' ? '目标验收门禁' : row.stageTitle ?? '项目任务'}{run ? ' · ' + runLabels[run.displayState] : ''}</Text>
                      {edges.length ? <Text size="xs" c="dimmed">依赖：{edges.map(edge => rows.find(item => item.taskId === edge.dependsOnId)?.title ?? edge.dependsOnId).join('、')}{blocked ? '（未满足）' : ''}</Text> : null}
                    </Stack>
                    <Group gap={4} wrap="nowrap">
                      {fixtureMode && row.taskKind === 'work' && !run ? <Button size="xs" variant="light" loading={busy === row.taskId} onClick={() => void act(row.taskId, () => api.runSampleTask(goalScope!, row.taskId), '样例任务已运行（测试适配器）。')} data-testid={'run-sample-' + row.taskId}>运行样例任务</Button> : null}
                      <Button size="xs" variant="subtle" onClick={() => setSelected(row.taskId)} data-testid={'task-detail-' + row.taskId}>详情</Button>
                      {run ? <Button size="xs" variant="subtle" onClick={() => store.openView('logs', { runId: run.runRef.runId, taskId: row.taskId })}>日志</Button> : null}
                    </Group>
                  </Group>
                </Paper>
              );
            })}
          </Stack>
        )}
        {selected ? <TaskDetail data={data} taskId={selected} onClose={() => setSelected(null)} /> : null}
        {graph ? <Box p="sm"><RawDetails label="计划与基线版本" value={{ plan: graph.planRef, acceptedAt: graph.acceptedAt, completionPolicy: graph.pinnedCompletionPolicy.ref, architectureBaseline: graph.pinnedArchitectureBaseline.ref, sourceCursor: graph.sourceCursor }} /></Box> : null}
        {goalScope ? null : null}
      </Box>
    </Stack>
  );
}
