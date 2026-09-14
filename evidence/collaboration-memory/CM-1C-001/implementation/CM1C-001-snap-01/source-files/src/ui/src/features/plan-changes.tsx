/**
 * 「计划变更」视图：谁受理了什么、为什么。
 *
 * 数据只有一个来源：应用层只读入口 `/api/real/plan-changes/view`（它本身直接转发既有的
 * ReadModelIndex.planChangeView 投影）。本文件不判断受理是否成立、不推导处置、不解析 id 形状，
 * 也不把 `autonomous-rework:` 之类的字符串当作规则来解释：受理方与授权来源一律读 canonical
 * 字段（`decision.actor`／`decision.authority`），变更原因一律读投影给出的
 * `revision.change.reason`，界面只负责把它们如实排出来。
 *
 * 为什么把取数逻辑单独放在 `describePlanChanges` 里：界面要回答的字段（提案身份与来源、
 * 决定的结果／受理方／授权来源／策略版本／时间、每次 revision 的 changeReason、每条处置行）
 * 必须逐个可断言，而不是埋在 JSX 里。组件只是把这些行渲染出来。
 */
import { Alert, Badge, Box, Group, Stack, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { PlanChangesViewV1 } from '../../../app/plan-changes.js';
import type { Api } from '../api/client';
import { ErrorState, LoadingState, Panel, RawDetails } from '../components/states';
import type { GoalScope } from '../api/types';
import type { AppStore } from '../state/app-store';

export type PlanChangeField = { label: string; value: string; mono?: boolean };
export type PlanChangeRow = {
  id: string;
  title: string;
  /** 徽标文字与配色：决定行用它一眼区分「系统自动受理」与「人的决定」。 */
  badge: string;
  tone: string;
  fields: PlanChangeField[];
  notes: string[];
};
export type PlanChangeGroup = { key: string; title: string; description: string; empty: string; rows: PlanChangeRow[] };
export type PlanChangeDisplay = {
  status: 'ready' | 'empty' | 'unavailable';
  /** empty／unavailable 时直接显示的原因；ready 时为 null。 */
  message: string | null;
  groups: PlanChangeGroup[];
};

/** 受理方：只由 canonical 的 actor.kind 决定，不做字符串前缀判断。 */
function actorLabel(actor: { kind: string; id: string }): { badge: string; tone: string; value: string } {
  return actor.kind === 'system'
    ? { badge: '系统自动受理', tone: 'blue', value: actor.id }
    : { badge: '人的决定', tone: 'green', value: actor.id };
}

/** 影响摘要：只统计投影给出的字段，不解释它们意味着什么。 */
function impactFields(impact: {
  affectedWorks: Array<{ reason: string; refreshRequired: boolean }>;
  staleAssumptions: Array<{ assumption: string; reason: string }>;
  materialsToRefresh: string[];
  independentWork: Array<{ reason: string }>;
}): PlanChangeField[] {
  const refresh = impact.affectedWorks.filter(work => work.refreshRequired).length;
  const fields: PlanChangeField[] = [{
    label: '影响摘要',
    value: '受影响工作 ' + impact.affectedWorks.length + ' 个（需刷新 ' + refresh + '）· 材料待刷新 ' + impact.materialsToRefresh.length + ' 项'
      + ' · 独立工作 ' + impact.independentWork.length + ' 个 · 过期假设 ' + impact.staleAssumptions.length + ' 条',
  }];
  const reasons = impact.affectedWorks.map(work => work.reason).filter(reason => reason.length > 0);
  if (reasons.length > 0) fields.push({ label: '影响明细', value: bounded(reasons) });
  const assumptions = impact.staleAssumptions.map(item => item.assumption);
  if (assumptions.length > 0) fields.push({ label: '过期假设', value: bounded(assumptions) });
  return fields;
}

/** 有界展示：多余的部分明确省略，不静默截断成"就这些"。 */
function bounded(values: string[], max = 3): string {
  return values.slice(0, max).join('；') + (values.length > max ? '；…（共 ' + values.length + ' 条）' : '');
}

export function describePlanChanges(view: PlanChangesViewV1 | undefined, error?: unknown): PlanChangeDisplay {
  if (error !== undefined && error !== null) {
    return { status: 'unavailable', message: error instanceof Error ? error.message : String(error), groups: [] };
  }
  if (view === undefined) return { status: 'ready', message: null, groups: [] };
  if (view.status !== 'ready') return { status: view.status, message: view.reason, groups: [] };

  const proposalRows: PlanChangeRow[] = view.proposals.map(snapshot => {
    const proposal = snapshot.proposal;
    // 返工提案在既有 PlanProposalV1 上多带 summary／rework；普通计划变更没有这两项，
    // 因此按存在与否展示，不为它编造摘要。
    const extra = proposal as { summary?: string; rework?: { issues: Array<{ issueId: string; taskId: string }> } };
    return {
      id: proposal.proposalId,
      title: proposal.proposalId,
      badge: proposal.sourcePlanRef.planId,
      tone: 'gray',
      fields: [
        { label: '来源目标', value: proposal.sourceGoalRef.goalId },
        { label: '来源计划', value: proposal.sourcePlanRef.planId + '@' + proposal.sourcePlanRevision, mono: true },
        { label: '目标（objective）', value: proposal.patch.patchDraft.objective },
        ...(extra.summary === undefined ? [] : [{ label: '摘要', value: extra.summary }]),
        ...(extra.rework === undefined
          ? []
          : [{ label: '来源问题', value: bounded(extra.rework.issues.map(issue => issue.taskId + ' / ' + issue.issueId)) }]),
        ...impactFields(proposal.impact),
        { label: '记录时间', value: snapshot.recordedAt },
      ],
      notes: [],
    };
  });

  const decisionRows: PlanChangeRow[] = view.decisions.map(snapshot => {
    const decision = snapshot.decision;
    const actor = actorLabel(decision.actor);
    return {
      id: decision.decisionId,
      title: decision.decisionId,
      badge: actor.badge,
      tone: actor.tone,
      fields: [
        { label: '结果（outcome）', value: decision.outcome },
        { label: '受理方', value: actor.badge + '（' + decision.actor.kind + ':' + actor.value + '）' },
        { label: '授权来源', value: decision.authority.strategy },
        { label: '委托人（delegator）', value: decision.authority.delegator ?? '无（直接授权）' },
        { label: '策略版本', value: decision.authority.policyVersion },
        { label: '时间', value: decision.decidedAt },
        { label: '提案', value: decision.proposalRef.proposalId, mono: true },
        ...(decision.summary === null ? [] : [{ label: '说明', value: decision.summary }]),
      ],
      notes: [],
    };
  });

  const revisionRows: PlanChangeRow[] = view.revisions.map(snapshot => {
    const change = snapshot.change;
    return {
      id: 'goal-revision-' + change.revision,
      // changeReason 逐字来自 canonical 的 GoalRevisionRecorded.change.reason：
      // 人的决定受理是 user-decision-accepted，系统自动受理是 autonomous-rework:<proposalId>。
      // 界面原样显示这个取值，不解析它的前缀（前缀是受理方的措辞，规则只应存在于 ControlEngine）。
      title: change.activePlanRef.planId + '@' + change.revision,
      badge: change.reason,
      tone: 'gray',
      fields: [
        { label: '计划', value: change.activePlanRef.planId, mono: true },
        { label: '目标 revision', value: String(change.revision) },
        { label: '变更原因（changeReason）', value: change.reason, mono: true },
        { label: '被取代的计划', value: change.supersededPlanRefs.map(ref => ref.planId).join('、') || '无' },
        { label: '变更时间', value: change.changedAt },
      ],
      notes: [],
    };
  });

  const dispositionRows: PlanChangeRow[] = view.dispositions.map(row => ({
    id: row.taskId,
    title: row.taskId,
    badge: row.disposition,
    tone: row.disposition === 'replace' ? 'orange' : 'gray',
    fields: [
      { label: '处置（disposition）', value: row.disposition },
      { label: '取代者任务', value: row.replacedByTaskId ?? '无', mono: true },
      { label: '计划', value: row.sourcePlanRef.planId + ' → ' + row.targetPlanRef.planId, mono: true },
      { label: '义务签名是否变化', value: row.obligationSignatureChanged ? '是' : '否' },
      { label: '理由', value: row.reason },
    ],
    notes: [],
  }));

  return {
    status: 'ready',
    message: null,
    groups: [
      { key: 'proposals', title: '提案', description: '已落账的计划变更提案（含返工提案）。提案只提出，受理与否看决定行。', empty: '还没有落账的计划变更提案。', rows: proposalRows },
      { key: 'decisions', title: '决定', description: '受理这份提案的决定。actor=system 的是平台按已授权范围自动受理，actor=human 的是人的决定。', empty: '还没有受理决定。', rows: decisionRows },
      { key: 'revisions', title: 'Goal revision', description: '每次变更生效后的 revision 与它的 changeReason（逐字来自 canonical 事实）。', empty: '还没有因计划变更产生的 revision。', rows: revisionRows },
      { key: 'dispositions', title: '任务处置', description: '这次变更对源计划里的任务做了什么：保留／取消／取代／重验／续跑。', empty: '没有需要展示的任务处置行（或两侧计划快照尚未投影完成）。', rows: dispositionRows },
    ],
  };
}

function RowCard({ row }: { row: PlanChangeRow }) {
  return (
    <Panel title={row.title} actions={<Badge size="sm" variant="light" color={row.tone}>{row.badge}</Badge>}>
      <Table withTableBorder verticalSpacing={4} fz="xs">
        <Table.Tbody>
          {row.fields.map(field => (
            <Table.Tr key={field.label}>
              <Table.Td w={170}><Text size="xs" c="dimmed">{field.label}</Text></Table.Td>
              <Table.Td><Text size="xs" style={field.mono ? { fontFamily: 'var(--mantine-font-family-monospace)', wordBreak: 'break-all' } : undefined}>{field.value}</Text></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {row.notes.map((note, index) => <Text key={index} size="xs" c="dimmed" mt={4}>{note}</Text>)}
    </Panel>
  );
}

export function PlanChangesView({ api, goalScope, store }: { api: Api; goalScope: GoalScope | null; store: AppStore }) {
  const key = goalScope ? [goalScope.projectId, goalScope.workspaceId, goalScope.goalId].join(':') : 'none';
  const pending = goalScope === null ? 0 : store.pendingRequests(goalScope).length;
  const query = useQuery({
    queryKey: ['plan-changes', key, pending],
    enabled: goalScope !== null,
    queryFn: () => api.planChangesView(goalScope!),
  });
  const display = describePlanChanges(query.data, query.error);
  return (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }}>
      <Group px="sm" py={6} className="panel-head"><Text size="sm" fw={600}>计划变更</Text></Group>
      <Box className="panel-body" style={{ minHeight: 0, overflow: 'auto' }}>
        {goalScope === null ? <Alert color="yellow" variant="light" m="xs">请先选择目标</Alert> : null}
        {goalScope !== null && query.isLoading ? <LoadingState label="正在读取计划变更…" /> : null}
        {goalScope !== null && query.error ? <ErrorState message={display.message ?? '读取失败'} /> : null}
        {display.status === 'empty' ? <Alert color="gray" variant="light" m="xs" data-state="empty">{display.message}</Alert> : null}
        {display.status === 'unavailable' && !query.error ? <Alert color="yellow" variant="light" m="xs" data-state="unavailable">{display.message}</Alert> : null}
        {display.status === 'ready' && query.data !== undefined ? (
          <Stack gap="sm" p="sm">
            <Alert color="blue" variant="light">
              这里只读已落账的事实：提案、受理决定、revision 与任务处置全部来自后端既有投影。界面不代你判断受理是否成立，也不提供提交入口。
            </Alert>
            {display.groups.map(group => (
              <Panel key={group.key} title={group.title} description={group.description}>
                {group.rows.length === 0
                  ? <Text size="xs" c="dimmed" data-testid={'plan-change-empty-' + group.key}>{group.empty}</Text>
                  : <Stack gap="xs">{group.rows.map(row => <RowCard key={row.id} row={row} />)}</Stack>}
              </Panel>
            ))}
            <RawDetails value={query.data} label="查看原始投影" />
          </Stack>
        ) : null}
      </Box>
    </Stack>
  );
}
