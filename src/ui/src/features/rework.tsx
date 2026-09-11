/**
 * 返工与问题面板：只展示 VerificationEngine 提供的未处置问题，以及最近一次自动触发的结论。
 *
 * 这里不做验收判断，也不推断返工是否已受理：问题来自已提交的验证轮次与独立审阅
 * 结论，当前时效由后端给出（open/superseded/unknown）；受理结论来自 canonical 重建的
 * 视图与本进程最近一次触发的结构化结果（RW-06 驱动）。界面只负责把问题、负责任务、
 * 失败要求、来源与"为什么没有自动受理"呈现给人。
 */
import { Alert, Badge, Box, Group, Stack, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { OpenIssuesViewV1, ReworkIssueViewV1 } from '../../../contracts/rework/issues.js';
import type { ReworkDriveOutcomeV1 } from '../../../contracts/rework/drive.js';
import type { Api } from '../api/client';
import { ErrorState, LoadingState, Panel, RawDetails } from '../components/states';
import type { GoalScope } from '../api/types';
import type { AppStore } from '../state/app-store';

const currentnessLabel: Record<ReworkIssueViewV1['currentness']['status'], string> = {
  open: '属于当前计划版本', superseded: '已被新版本取代', unknown: '无法判断当前版本',
};
const currentnessTone: Record<ReworkIssueViewV1['currentness']['status'], string> = {
  open: 'red', superseded: 'gray', unknown: 'yellow',
};

function IssueCard({ issue }: { issue: ReworkIssueViewV1 }) {
  return (
    <Panel title={'任务 ' + issue.taskId} description={issue.summary}>
      <Group gap={6} mb={6}>
        <Badge size="sm" color={currentnessTone[issue.currentness.status]} variant="light">{currentnessLabel[issue.currentness.status]}</Badge>
        <Badge size="sm" variant="light">{issue.source.kind === 'verification_round' ? '工具验证轮次' : '独立审阅'}</Badge>
        {issue.source.kind === 'verification_round'
          ? <Badge size="sm" variant="light">{issue.source.outcome}{issue.source.status === 'interrupted' ? '（中断轮次）' : ''}</Badge>
          : null}
      </Group>
      <Table withTableBorder verticalSpacing={4} fz="xs">
        <Table.Thead><Table.Tr><Table.Th>验收要求</Table.Th><Table.Th>种类</Table.Th><Table.Th>失败依据</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {issue.failedRequirements.map(requirement => (
            <Table.Tr key={requirement.obligationId + '/' + requirement.requirementId}>
              <Table.Td><Text size="xs">{requirement.obligationId} / {requirement.requirementId}</Text></Table.Td>
              <Table.Td><Text size="xs">{requirement.kind}</Text></Table.Td>
              <Table.Td><Text size="xs">{requirement.reason}</Text></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Stack gap={2} mt={6}>
        <Text size="xs" c="dimmed">问题来源：{JSON.stringify(issue.source)}</Text>
        <Text size="xs" c="dimmed">产生于 {issue.detectedAt}；Run {issue.runRef.runId}</Text>
        {issue.currentness.issues.map((note, index) => <Text key={index} size="xs" c="dimmed">{note}</Text>)}
      </Stack>
      <RawDetails value={issue} />
    </Panel>
  );
}

/** 一次触发的处置结论：额度、边界与拒绝码都原样呈现，不在这里改写原因。 */
function DriveOutcome({ outcome }: { outcome: ReworkDriveOutcomeV1 }) {
  const budget = 'budget' in outcome ? outcome.budget : null;
  return (
    <Stack gap={2}>
      <Group gap={6}>
        <Text size="xs" fw={500}>任务 {outcome.groupTaskId}</Text>
        <Badge size="sm" variant="light" color={outcome.status === 'accepted' ? 'green' : outcome.status === 'needs_human_decision' ? 'yellow' : 'gray'}>{outcome.status}</Badge>
        {'code' in outcome ? <Badge size="sm" variant="light" color="red">{outcome.code}</Badge> : null}
      </Group>
      {budget === null
        ? <Text size="xs" c="dimmed">没有生效的协调策略：本次没有可用的自动化额度（平台不套用默认预算）。</Text>
        : <Text size="xs" c="dimmed">授权来自 {budget.policyId}@{budget.policyRevision}：额度 {budget.used}/{budget.limit}（剩余 {budget.remaining}）。</Text>}
      {outcome.reasons.map((reason, index) => <Text key={index} size="xs" c="dimmed">{reason}</Text>)}
    </Stack>
  );
}

export function ReworkView({ api, goalScope, store }: { api: Api; goalScope: GoalScope | null; store: AppStore }) {
  const key = goalScope ? [goalScope.projectId, goalScope.workspaceId, goalScope.goalId].join(':') : 'none';
  const pending = goalScope === null ? 0 : store.pendingRequests(goalScope).length;
  const query = useQuery({
    queryKey: ['rework-issues', key, pending],
    enabled: goalScope !== null,
    queryFn: () => api.reworkIssues(goalScope!),
  });
  const status = useQuery({
    queryKey: ['rework-status', key, pending],
    enabled: goalScope !== null,
    queryFn: () => api.reworkStatus(goalScope!),
  });
  /**
   * RW-10：自动返工是否被人停用（allowed.inScopeRework）。这里读的是治理视图的**同一份**事实
   * （服务端 automationSwitch），不自己推断、也不缓存成界面状态；有额度展示的地方就一并显示它，
   * 因为「还有额度」与「自动返工被停用」是两件必须同时看到的事。
   */
  const governance = useQuery({
    queryKey: ['rework-governance-switch', key],
    enabled: goalScope !== null,
    queryFn: () => api.governanceView(goalScope!),
  });
  const view: OpenIssuesViewV1 | undefined = query.data;
  const lastDrive = status.data?.lastDrive ?? null;
  const automationSwitch = governance.data?.automationSwitch ?? null;
  return (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }}>
      <Group px="sm" py={6} className="panel-head"><Text size="sm" fw={600}>返工与问题</Text></Group>
      <Box className="panel-body" style={{ minHeight: 0, overflow: 'auto' }}>
        {goalScope === null ? <Alert color="yellow" variant="light">请先选择目标</Alert> : null}
        {query.isLoading ? <LoadingState label="正在读取未处置问题…" /> : null}
        {query.error ? <ErrorState message={query.error instanceof Error ? query.error.message : String(query.error)} /> : null}
        {view?.status === 'unavailable' ? <Alert color="yellow" variant="light">{view.message}</Alert> : null}
        {view?.status === 'none' ? <Alert color="green" variant="light">当前没有未处置的验收问题：已提交的验证轮次与独立审阅没有留下未通过的要求。</Alert> : null}
        {goalScope !== null ? (
          <Box p="sm" pb={0}>
            <Panel title="自动返工触发结论" description="本进程最近一次触发；受理事实由 canonical 事实重建，重启后这里为空而不冒充历史。">
              {governance.isLoading ? <LoadingState label="正在读取自动返工开关…" /> : null}
              {governance.error ? <ErrorState message={governance.error instanceof Error ? governance.error.message : String(governance.error)} /> : null}
              {automationSwitch !== null ? (
                <Alert
                  mb={6}
                  variant="light"
                  data-testid="rework-switch"
                  color={automationSwitch.inScopeRework === true ? 'green' : automationSwitch.inScopeRework === false ? 'orange' : 'yellow'}
                  title={automationSwitch.inScopeRework === true ? '自动返工：已授权（范围内）' : automationSwitch.inScopeRework === false ? '自动返工：已被人停用' : '自动返工：没有生效策略'}
                >
                  <Text size="xs">{automationSwitch.note}</Text>
                </Alert>
              ) : null}
              {status.isLoading ? <LoadingState label="正在读取触发结论…" /> : null}
              {status.error ? <ErrorState message={status.error instanceof Error ? status.error.message : String(status.error)} /> : null}
              {!status.isLoading && lastDrive === null ? <Text size="xs" c="dimmed">本进程还没有触发过自动返工。返工在验证结论被接纳并归约之后由组合根触发。</Text> : null}
              {lastDrive !== null ? (
                <Stack gap="xs">
                  <Group gap={6}>
                    <Badge size="sm" variant="light">{lastDrive.status}</Badge>
                    <Text size="xs" c="dimmed">受理成新 revision：{lastDrive.acceptedPlanRefs.length} 次</Text>
                  </Group>
                  {lastDrive.outcomes.length === 0 ? <Text size="xs" c="dimmed">这次触发没有需要处置的任务分组。</Text> : null}
                  {lastDrive.outcomes.map(outcome => <DriveOutcome key={outcome.groupTaskId + ':' + outcome.status} outcome={outcome} />)}
                  {lastDrive.gaps.map((gap, index) => <Text key={index} size="xs" c="dimmed">{gap}</Text>)}
                  <Text size="xs" c="dimmed">自动化额度在「设置 → 治理与策略」里由人显式安装并激活；没有生效的协调策略时，平台不会自动受理。</Text>
                </Stack>
              ) : null}
            </Panel>
          </Box>
        ) : null}
        {view?.status === 'ready' ? (
          <Stack gap="sm" p="sm">
            <Alert color="blue" variant="light">
              这些是验证结论留下的未处置问题。在协调策略授予的额度内，框架会自动受理返工并派发；本面板只读，受理结果与处置见「计划变更」。需要人决定的越界返工目前没有提交入口。
            </Alert>
            {view.issues.map(issue => <IssueCard key={issue.issueId} issue={issue} />)}
            {view.gaps.length ? (
              <Panel title="读取时标注的边界">
                {view.gaps.map((gap, index) => <Text key={index} size="xs" c="dimmed">{gap}</Text>)}
              </Panel>
            ) : null}
          </Stack>
        ) : null}
      </Box>
    </Stack>
  );
}
