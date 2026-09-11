import { Badge, Group, Paper, Stack, Text } from '@mantine/core';
import type { GuiState } from '../api/types';

export function InitialPlanningView({ data }: { data: GuiState }) {
  return <Stack gap="sm" data-testid="initial-planning">{(data.planning ?? []).map(row => <Paper key={row.queryJobId} withBorder p="sm">
    <Group gap="xs"><Text size="sm" fw={600}>协调与规划</Text><Badge variant="light">{row.status === 'plan_accepted' ? '计划已接纳' : row.status === 'needs_decision' ? '需要产品决定' : row.status === 'closed' ? '协调已停止' : '正在分析'}</Badge></Group>
    {row.proposal?.status === 'plan' ? <><Text size="sm" mt="xs">{row.proposal.plan.origin.summary}</Text><Stack gap={4} mt="xs">{row.proposal.plan.origin.assignments.map(assignment => <Text key={assignment.taskId} size="xs">{assignment.taskId} · {assignment.role}：{assignment.instruction}</Text>)}</Stack><Text size="xs" c="dimmed" mt={4}>任务按依赖派发；执行报告仍需独立验收。</Text></> : null}
    {row.proposal?.status === 'needs_decision' ? <><Text size="sm">{row.proposal.summary}</Text>{row.proposal.questions.map((question, index) => <Text size="sm" key={index}>{index + 1}. {question}</Text>)}</> : null}
    {row.issue ? <Text size="sm" c="red">{row.issue}</Text> : null}
    {row.runs.map((run, index) => <Text key={index} size="xs" c="dimmed" mt={4}>只读协调 · {run.status} · {run.configuration ? run.configuration.provider + ' / ' + run.configuration.model : '等待模型'} · {run.usage.length} 次模型请求</Text>)}
  </Paper>)}</Stack>;
}
