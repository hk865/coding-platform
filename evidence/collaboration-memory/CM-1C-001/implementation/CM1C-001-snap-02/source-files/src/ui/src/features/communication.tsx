import { Alert, Badge, Group, Paper, Stack, Text } from '@mantine/core';
import type { GuiState } from '../api/types';

const reasons: Record<string, string> = {
  waiting_for_report: '等待报告', waiting_for_predecessor: '报告已有回应，等待前次运行结束',
  waiting_for_admission_checks: '等待投递、权限和接续核对', satisfied: '已建立后继运行',
  cancelled: '已取消等待', cancel_requested: '正在取消', timed_out: '等待已超时',
};
const labels: Record<string, string> = {
  DirectedRequestSent: '已发送请求', DirectedRequestResponded: '已收到回应', DeliveryRecorded: '报告已投递',
  WaitConditionRegistered: '已登记等待', WaitConditionSatisfied: '等待已满足', WaitConditionCancelled: '等待已取消',
  WaitConditionTimedOut: '等待已超时', SubscriptionCreated: '开始订阅', SubscriptionCancelled: '订阅已取消',
  CommunicationAdmissionRecorded: '已建立后继运行', CommunicationIntentReconciled: '已核对不确定结果',
};
export function CommunicationView({ data }: { data: GuiState }) {
  const view = data.communication;
  if (!view) return null;
  if (view.status !== 'ready') return <Alert color="yellow" data-testid="communication-incomplete">通信记录尚未完整读取，请刷新后重试。<Text size="xs">{view.reason}</Text></Alert>;
  if (!view.waits.length && !view.timeline.length && !view.failures.length) return null;
  return <Paper withBorder p="sm" data-testid="communication-view"><Stack gap="xs">
    <Group justify="space-between"><Text fw={600}>协作与等待</Text><Text size="xs" c="dimmed">账本位置 {view.sourceCursor ?? '暂无记录'}</Text></Group>
    <Text size="xs" c="dimmed">当前工作区：待推进 {view.backlog.pending} · 已领取 {view.backlog.leased} · 等待重试 {view.backlog.retry} · 待处理 {view.backlog.blocked}</Text>
    {view.waits.map(wait => <div key={wait.waitId} data-testid="communication-wait">
      <Group gap="xs"><Badge variant="light">{wait.mode === 'any' ? '任一可替代报告' : '全部条件'}</Badge><Text size="sm">{reasons[wait.reason] ?? wait.reason}</Text></Group>
      <Text size="xs" c="dimmed">工作 {wait.workId} · 条件已有回应 {wait.matched}/{wait.total} · 报告已投递 {wait.delivered}/{wait.total}{wait.winnerDeliveryId ? ' · 已选报告 ' + wait.winnerDeliveryId : ''}</Text>
      {wait.winnerDeliveryId ? <Text size="xs" c="dimmed">后继已受理；报告是否进入模型，以实际运行的输入记录为准。其他工作继续，迟到报告仍保留。</Text> : null}
    </div>)}
    {view.failures.map(failure => <Alert key={failure.intentId} color="yellow" variant="light"><Text size="xs">通信推进需要处理：{failure.reason ?? failure.status}</Text></Alert>)}
    <details><summary>工作区通信记录（最近 {view.timeline.length} 条）</summary><Stack gap={3} mt="xs">
      {view.timeline.map(event => <Text size="xs" key={event.cursor}>{event.at} · {labels[event.type] ?? '通信推进状态更新'} · {event.id}</Text>)}
    </Stack></details>
  </Stack></Paper>;
}
