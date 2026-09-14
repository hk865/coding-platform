import { Alert, Group, Text } from '@mantine/core';
import type { DispatchBacklogView } from '../../../contracts/dispatch-backlog.js';

export function DispatchBacklog({ view }: { view: DispatchBacklogView | undefined }) {
  if (!view) return null;
  if (view.status === 'unavailable') return <Alert color="yellow">{view.reason}</Alert>;
  const b = view.backlog;
  if (!b.pending) return null;
  return <Alert title="待派发工作" data-testid="dispatch-backlog" color={b.quarantined ? 'yellow' : 'blue'}>
    <Group gap="md"><Text size="sm">可调度 {b.due}</Text><Text size="sm">延后重试 {b.delayed}</Text><Text size="sm">需对账 {b.quarantined}</Text></Group>
    {b.oldestPendingAgeMs !== null ? <Text size="xs">最早待办已等待 {Math.floor(b.oldestPendingAgeMs / 1000)} 秒</Text> : null}
    {b.blocked.map(item => <Text key={item.intentId} size="xs">{item.reason}{item.quarantined ? '；等待对账' : '；重试时间 ' + item.availableAt}</Text>)}
  </Alert>;
}
