import { Badge, Box, Group, Paper, Stack, Text } from '@mantine/core';
import { useMemo } from 'react';
import { EmptyState, ErrorState, LoadingState, UnavailableState } from '../components/states';
import { time } from '../format';
import type { ViewProps } from '../workbench/view-props';

type Change = { runId: string; path: string; tool: string; before: string | null; after: string | null; at: string };

/** File changes reconstructed from the run's own tool calls (real evidence, not a git diff). */
export function changesFromRuns(data: NonNullable<ViewProps['data']>): Change[] {
  const changes: Change[] = [];
  for (const run of data.liveRuns ?? []) {
    for (const event of run.trace) {
      if (event.type !== 'tool.completed' && event.type !== 'tool.started') continue;
      const call = event.data.call;
      if (!call || (call.name !== 'edit' && call.name !== 'write')) continue;
      const args = call.arguments ?? {};
      const path = typeof args['path'] === 'string' ? args['path'] : typeof args['file_path'] === 'string' ? args['file_path'] : null;
      if (!path) continue;
      const before = typeof args['oldString'] === 'string' ? args['oldString'] : typeof args['old_string'] === 'string' ? args['old_string'] : typeof args['content'] === 'string' ? null : null;
      const after = typeof args['newString'] === 'string' ? args['newString'] : typeof args['new_string'] === 'string' ? args['new_string'] : typeof args['content'] === 'string' ? args['content'] : null;
      if (changes.some(change => change.runId === run.spec.runId && change.path === path && change.tool === call.name)) continue;
      changes.push({ runId: run.spec.runId, path, tool: call.name, before, after, at: event.at });
    }
  }
  return changes;
}

export function DiffView({ data, loading, error, store }: ViewProps) {
  const changes = useMemo(() => (data ? changesFromRuns(data) : []), [data]);
  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!data?.goalId) return <EmptyState title="还没有目标" description="差异来自一次真实运行的编辑工具调用。" />;
  return (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }}>
      <Group px="sm" py={6} className="panel-head"><Text size="sm" fw={600}>文件改动</Text><Text size="xs" c="dimmed">{changes.length} 个文件</Text></Group>
      <Box className="panel-body" style={{ minHeight: 0, overflow: 'auto' }}>
        <Stack gap="sm" p="sm">
          {!changes.length ? <EmptyState title="本次运行还没有文件改动记录" description="编辑与写入工具的调用参数会显示在这里；没有改动时不会推断。" /> : null}
          {changes.map(change => (
            <Paper key={change.runId + change.path + change.tool} withBorder p="xs" radius="sm" data-testid="diff-entry">
              <Group gap="xs" wrap="nowrap">
                <Badge size="xs" variant="light" color="blue">{change.tool === 'write' ? '写入' : '修改'}</Badge>
                <Text size="xs" style={{ fontFamily: 'var(--mantine-font-family-monospace)', wordBreak: 'break-all' }}>{change.path}</Text>
                <Text size="xs" c="dimmed">{time(change.at)}</Text>
                <Badge size="xs" variant="light" color="gray">运行 {change.runId}</Badge>
                <Text size="xs" c="dimmed" role="button" tabIndex={0} onClick={() => store.openFile(change.path)} onKeyDown={event => { if (event.key === 'Enter') store.openFile(change.path); }}>打开当前文件</Text>
              </Group>
              <Stack gap={2} mt={6}>
                {change.before !== null ? <pre className="diff-before">{change.before}</pre> : null}
                {change.after !== null ? <pre className="diff-after">{change.after}</pre> : null}
              </Stack>
              <Text size="xs" c="dimmed" mt={4}>来源：该运行的编辑工具调用参数；不是工作区 Git 差异。</Text>
            </Paper>
          ))}
          <UnavailableState
            title="Git 工作区差异"
            reason="后端没有提供工作区版本比较接口（无 git 读取、无运行前基线快照），因此不能把当前文件内容当作“本次运行的改动”。"
            dependencies={['工作区基线快照或 git 读取适配', '运行与改动的归属证据', '比较基准的版本标识']}
          />
        </Stack>
      </Box>
    </Stack>
  );
}

