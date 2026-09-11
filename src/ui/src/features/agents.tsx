import { Badge, Box, Button, Group, Paper, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import type { AgentRunRow } from '../api/types';
import { EmptyState, ErrorState, FieldRow, LoadingState, RawDetails } from '../components/states';
import { runLabels, statusTone, taskPhaseLabels, time } from '../format';
import type { ViewProps } from '../workbench/view-props';

const activeStates = new Set(['starting', 'ongoing']);

function AgentCard({ run, title, data, onSelect }: { run: AgentRunRow; title: string; data: NonNullable<ViewProps['data']>; onSelect: () => void }) {
  const live = (data.liveRuns ?? []).find(record => record.spec.runId === run.runRef.runId);
  const task = data.matrix.status === 'ready' ? data.matrix.matrix.rows.find(row => row.taskId === run.taskId) : undefined;
  const lastMessage = [...(live?.trace ?? [])].reverse().find(event => event.type === 'assistant.message_completed' && event.data.message?.content?.trim());
  const currentTool = [...(live?.trace ?? [])].reverse().find(event => event.type === 'tool.started');
  return (
    <Paper withBorder p="xs" radius="sm" data-run-id={run.runRef.runId} data-run-state={run.displayState}>
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Group gap={6} wrap="nowrap"><Text size="sm" fw={500}>{title}</Text><Badge color={statusTone(run.displayState)} variant="light">{runLabels[run.displayState]}</Badge></Group>
          <Text size="xs" c="dimmed">任务：{task?.title ?? run.taskId} · 角色模板 {run.binding.templateId}</Text>
          <Text size="xs" c="dimmed">{time(run.startedAt)} → {time(run.endedAt)}</Text>
          {currentTool ? <Text size="xs" c="dimmed">当前工具：{String(currentTool.data.call?.name ?? '工具调用')}</Text> : null}
          {lastMessage ? <Text size="xs" className="agent-message" lineClamp={3}>{lastMessage.data.message?.content}</Text> : null}
        </Stack>
        <Button size="xs" variant="subtle" onClick={onSelect}>详情</Button>
      </Group>
    </Paper>
  );
}

export function AgentsView({ data, loading, error, store }: ViewProps) {
  const [selected, setSelected] = useState<string | null>(null);
  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!data?.goalId) return <EmptyState title="还没有目标" description="创建目标并提交开发任务后，这里会显示运行中的 Agent。" />;
  const rows = data.agents.status === 'ready' ? data.agents.agents.rows : [];
  const active = rows.filter(run => activeStates.has(run.displayState));
  const past = rows.filter(run => !activeStates.has(run.displayState));
  const selectedRun = rows.find(run => run.runRef.runId === selected);
  const live = selectedRun ? (data.liveRuns ?? []).find(record => record.spec.runId === selectedRun.runRef.runId) : undefined;

  return (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }}>
      <Group px="sm" py={6} className="panel-head" justify="space-between">
        <Stack gap={0}>
          <Text size="sm" fw={600}>Agent 运行</Text>
          <Text size="xs" c="dimmed">{active.length} 个进行中 · {past.length} 个已结束</Text>
        </Stack>
      </Group>
      <Box className="panel-body" style={{ minHeight: 0, overflow: 'auto' }}>
        <Stack gap={6} p="sm">
          {!rows.length ? <EmptyState title="没有运行记录" description="提交开发任务后，运行会出现在这里。" /> : null}
          {active.map((run, index) => <AgentCard key={run.runRef.runId} run={run} title={'Agent ' + String(index + 1).padStart(2, '0')} data={data} onSelect={() => setSelected(run.runRef.runId)} />)}
          {past.length ? <Text size="xs" c="dimmed" mt="xs">已结束的运行</Text> : null}
          {past.map((run, index) => <AgentCard key={run.runRef.runId} run={run} title={'Agent ' + String(active.length + index + 1).padStart(2, '0')} data={data} onSelect={() => setSelected(run.runRef.runId)} />)}
        </Stack>
        {selectedRun ? (
          <Stack gap={6} p="sm" data-testid="agent-detail">
            <Group justify="space-between"><Text size="sm" fw={600}>运行详情</Text><Button size="xs" variant="subtle" onClick={() => setSelected(null)}>关闭</Button></Group>
            <FieldRow label="运行标识" mono>{selectedRun.runRef.runId}</FieldRow>
            <FieldRow label="任务">{selectedRun.taskId}</FieldRow>
            <FieldRow label="状态">{runLabels[selectedRun.displayState]}</FieldRow>
            <FieldRow label="任务判定">{data.matrix.status === 'ready' ? taskPhaseLabels[String(data.matrix.matrix.rows.find(row => row.taskId === selectedRun.taskId)?.livePhase ?? '')] ?? '尚无正式判定' : '—'}</FieldRow>
            <FieldRow label="角色绑定" mono>{selectedRun.binding.templateId}</FieldRow>
            {live?.configuration ? <FieldRow label="模型配置">{live.configuration.model ?? '—'} · 版本 {live.configuration.revision?.slice(0, 8) ?? '—'}</FieldRow> : null}
            <Group gap={4}>
              <Button size="xs" variant="light" onClick={() => store.openView('logs', { runId: selectedRun.runRef.runId })}>查看运行日志</Button>
              <Button size="xs" variant="subtle" onClick={() => store.openView('verification')}>检查与验证</Button>
            </Group>
            <RawDetails value={{ run: selectedRun, live: live ? { status: live.status, error: live.error, usage: live.usage.length } : null }} />
          </Stack>
        ) : null}
      </Box>
    </Stack>
  );
}

