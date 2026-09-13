import { Badge, Box, Group, Paper, Stack, Text } from '@mantine/core';
import { EmptyState, ErrorState, FieldRow, LoadingState, RawDetails, UnavailableState } from '../components/states';
import { eventLabels, runLabels, time, toolCommand, toolNames } from '../format';
import type { ViewProps } from '../workbench/view-props';
import { HistoryMaterialsView } from './history-materials';
import { IndependentReviews } from './independent-review';

export function ActivityView({ data, loading, error }: ViewProps) {
  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  const entries = data?.timeline?.timeline?.entries ?? [];
  return (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }}>
      <Group px="sm" py={6} className="panel-head"><Text size="sm" fw={600}>项目动态</Text><Text size="xs" c="dimmed">{entries.length} 条</Text></Group>
      <Box className="panel-body" style={{ minHeight: 0, overflow: 'auto' }}>
        {!entries.length ? <EmptyState title="暂无动态" description="目标、计划、运行与验证事件会出现在这里。" /> : (
          <Stack gap={4} p="sm">
            {[...entries].reverse().map((entry, index) => (
              <Group key={index} gap="xs" wrap="nowrap" align="flex-start">
                <Text size="xs" c="dimmed" w={70}>{time(entry.occurredAt)}</Text>
                <Text size="xs">{eventLabels[entry.kind] ?? entry.summary}</Text>
                {/* RW-09：计划变更类条目要把变更原因与受理方标出来，否则"计划已接受"这一行
                    无法区分系统自动受理与人的决定。取值来自投影（entry.change），界面只显示。 */}
                {entry.change ? (
                  <>
                    <Badge size="xs" variant="light" color={entry.change.actor.kind === 'system' ? 'blue' : 'green'} data-testid="timeline-change-actor">
                      {entry.change.actor.kind === 'system' ? '系统自动受理' : '人的决定'}
                    </Badge>
                    <Text size="xs" c="dimmed" data-testid="timeline-change-reason" style={{ fontFamily: 'var(--mantine-font-family-monospace)', wordBreak: 'break-all' }}>
                      {entry.refs?.planId ? entry.refs.planId + ' · ' : ''}changeReason {entry.change.reason}
                    </Text>
                  </>
                ) : null}
                {entry.refs?.taskId ? <Text size="xs" c="dimmed">{entry.refs.taskId}</Text> : null}
              </Group>
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  );
}

export function LogsView({ data, loading, error, tab }: ViewProps) {
  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  const runs = data?.liveRuns ?? [];
  const selected = tab?.payload.runId ? runs.find(run => run.spec.runId === tab.payload.runId) : runs.at(-1);
  if (!selected) return <EmptyState title="没有运行日志" description="提交开发任务后，模型与工具事件会记录在这里。" />;
  return (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }}>
      <Group px="sm" py={6} className="panel-head" justify="space-between">
        <Stack gap={0}><Text size="sm" fw={600}>运行日志 · {selected.spec.runId}</Text><Text size="xs" c="dimmed">{runLabels[selected.status as keyof typeof runLabels] ?? selected.status} · {selected.trace.length} 条事件</Text></Stack>
        <RawDetails value={{ spec: selected.spec, status: selected.status, error: selected.error, configuration: selected.configuration }} label="运行依据" />
      </Group>
      <Box className="panel-body" style={{ minHeight: 0, overflow: 'auto' }}>
        <Stack gap={2} p="sm">
          {selected.trace.map(event => (
            <Group key={event.sequence} gap="xs" wrap="nowrap" align="flex-start" data-event-type={event.type}>
              <Text size="xs" c="dimmed" w={64}>{time(event.at)}</Text>
              <Badge size="xs" variant="light" color={event.type.startsWith('tool.failed') || event.type.includes('failed') ? 'red' : event.type.startsWith('tool') ? 'gray' : 'blue'}>{event.type}</Badge>
              <Text size="xs" style={{ wordBreak: 'break-all' }}>
                {event.type === 'assistant.message_completed' ? (event.data.message?.content ?? '').slice(0, 200)
                  : event.data.call ? (toolNames[event.data.call.name] ?? event.data.call.name) + ' · ' + toolCommand(event.data.call).slice(0, 160)
                  : event.data.error ? JSON.stringify(event.data.error).slice(0, 200) : ''}
              </Text>
            </Group>
          ))}
        </Stack>
      </Box>
    </Stack>
  );
}

export function ArchitectureView({ data, loading }: ViewProps) {
  if (loading && !data) return <LoadingState />;
  return (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }}>
      <Group px="sm" py={6} className="panel-head"><Text size="sm" fw={600}>架构</Text></Group>
      <Box className="panel-body" style={{ minHeight: 0, overflow: 'auto' }}>
        <UnavailableState
          title="真实架构图"
          reason="真实应用的 WorkspaceReader 图读取返回 unsupported：没有正式架构快照绑定，也没有图基线来源映射。"
          dependencies={['WorkspaceReader 架构快照契约与 Adapter', '基线到源码快照的映射', '关系违规规则']}
        />
        <Box p="sm">
          <Text size="xs" fw={600} mb={4}>已有事实</Text>
          {data?.graph.status === 'ready' ? (
            <Stack gap={2}>
              <FieldRow label="计划" mono>{data.graph.graph.planRef.planId}</FieldRow>
              <FieldRow label="计划版本">{data.graph.graph.planRevision}</FieldRow>
              <FieldRow label="架构基线" mono>{data.graph.graph.pinnedArchitectureBaseline.ref.baselineId}@{data.graph.graph.pinnedArchitectureBaseline.ref.revision}</FieldRow>
              <FieldRow label="完成策略" mono>{data.graph.graph.pinnedCompletionPolicy.ref.policyId}@{data.graph.graph.pinnedCompletionPolicy.ref.revision}</FieldRow>
              <Text size="xs" c="dimmed" mt={4}>以上为计划固定的基线版本；它不代表已生成架构图。</Text>
            </Stack>
          ) : <Text size="xs" c="dimmed">当前目标没有被接受的计划，因此没有基线绑定事实。</Text>}
        </Box>
      </Box>
    </Stack>
  );
}

export function ReviewerView({ api, data, loading, error, goalScope, store, refresh }: ViewProps) {
  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!goalScope) return <EmptyState title="请选择目标" description="独立审阅针对目标中的真实任务与已保存工具轮次。" />;
  const runs = (data?.liveRuns ?? []).filter(run => run.spec.mode !== 'explore' && run.spec.mode !== 'review');
  return (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }}>
      <Group px="sm" py={6} className="panel-head"><Text size="sm" fw={600}>Reviewer</Text></Group>
      <Box className="panel-body" style={{ minHeight: 0, overflow: 'auto' }}>
        <Box p="sm"><IndependentReviews key={[goalScope.projectId, goalScope.workspaceId, goalScope.goalId].join(':')} api={api} scope={goalScope} runs={runs} store={store} refresh={refresh} /></Box>
      </Box>
    </Stack>
  );
}

export function MemoryView(props: ViewProps) {
  const { data } = props;
  return (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }}>
      <Group px="sm" py={6} className="panel-head"><Text size="sm" fw={600}>记忆与规则</Text></Group>
      <Box className="panel-body" style={{ minHeight: 0, overflow: 'auto' }}>
        <UnavailableState
          title="长期记忆与规则管理"
          reason="没有记忆内容、适用范围、来源与作废回执的读写接口；已保存的设置值没有真实消费者时不会被标为生效。"
          dependencies={['记忆/规则存储与版本契约', '适用范围与来源字段', '运行侧消费证据']}
        />
        <Box p="sm">
          <Text size="xs" fw={600} mb={4}>当前可确认的事实</Text>
          <FieldRow label="完成策略"><span style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}>{data?.graph.status === 'ready' ? data.graph.graph.pinnedCompletionPolicy.ref.policyId + '@' + data.graph.graph.pinnedCompletionPolicy.ref.revision : '—'}</span></FieldRow>
          <Text size="xs" c="dimmed">这些版本由计划固定，可在“架构”视图查看来源。</Text>
          <HistoryMaterialsView {...props} />
        </Box>
      </Box>
    </Stack>
  );
}

export function ContinuationView({ data }: ViewProps) {
  const unknown = (data?.liveRuns ?? []).filter(run => run.status === 'outcome_unknown');
  return (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }}>
      <Group px="sm" py={6} className="panel-head"><Text size="sm" fw={600}>任务续跑</Text></Group>
      <Box className="panel-body" style={{ minHeight: 0, overflow: 'auto' }}>
        <UnavailableState
          title="中断任务续跑"
          reason="运行时声明 supportsSnapshot=false，且没有副作用对账与租约恢复流程；直接“继续”会绕过控制层并重复外部副作用。"
          dependencies={['运行快照与材料响应契约', '强杀后的副作用与租约对账', '可恢复事实的正式接纳']}
        />
        {unknown.length ? (
          <Box p="sm">
            <Text size="xs" fw={600} mb={4}>结果未知的运行（需人工核对工作区）</Text>
            <Stack gap={4}>
              {unknown.map(run => (
                <Paper key={run.spec.runId} withBorder p="xs" radius="sm">
                  <Group gap={4}><Badge color="yellow" variant="light">结果未知</Badge><Text size="xs" style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}>{run.spec.runId}</Text></Group>
                  <Text size="xs" c="dimmed">{run.error ?? '宿主中断，未自动重跑；需核对工作区副作用。'}</Text>
                </Paper>
              ))}
            </Stack>
          </Box>
        ) : <Box p="sm"><Text size="xs" c="dimmed">当前没有结果未知的运行。</Text></Box>}
      </Box>
    </Stack>
  );
}
