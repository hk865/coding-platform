import { Alert, Badge, Box, Button, Group, Modal, Paper, Select, Stack, Table, Text, TextInput, Textarea } from '@mantine/core';
import { useMemo, useState } from 'react';
import { mutationError } from '../api/hooks';
import type { ExplorationView } from '../api/types';
import { EmptyState, ErrorState, FieldRow, LoadingState, RawDetails } from '../components/states';
import { statusTone, time } from '../format';
import { Markdown } from '../markdown';
import type { ViewProps } from '../workbench/view-props';

type NodeDraft = { taskId: string; title: string; instruction: string; dependsOn: string };

const DEFAULT_NODES: NodeDraft[] = [
  { taskId: 'entry', title: '入口与启动方式', instruction: '定位项目入口、启动命令与主要依赖，给出文件与行号。', dependsOn: '' },
  { taskId: 'tests', title: '测试与检查方式', instruction: '定位测试目录、检查命令与当前覆盖范围，说明尚未验证的部分。', dependsOn: 'entry' },
];

export function ExplorationView({ api, data, loading, error, goalScope, store }: ViewProps) {
  const [nodes, setNodes] = useState<NodeDraft[]>(DEFAULT_NODES);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'info' | 'error' | 'warning'; text: string } | null>(null);
  const [report, setReport] = useState<{ taskId: string; body: string; digest: string } | null>(null);
  const [review, setReview] = useState<{ taskId: string; runId: string } | null>(null);
  const [verdict, setVerdict] = useState('PASS');
  const [reviewText, setReviewText] = useState('');

  const plan: ExplorationView | null = data?.exploration ?? null;
  const runs = data?.liveRuns ?? [];
  const rows = data?.matrix.status === 'ready' ? data.matrix.matrix.rows : [];
  const reviews = useMemo(() => (plan?.reviews ?? []), [plan]);
  const reports = useMemo(() => (plan?.reports ?? []), [plan]);

  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!data?.goalId) return <EmptyState title="还没有目标" description="只读探索需要一个尚未安装计划的新目标。" />;

  /**
   * One logical exploration action. The request id is reused only while the
   * operation has no formal receipt (unknown outcome); a completed or rejected
   * action ends it, and the next click is a new request.
   */
  const runRequest = async (kind: 'exploration-plan' | 'exploration-run' | 'exploration-review', payload: unknown, send: (requestId: string) => Promise<unknown>): Promise<void> => {
    if (!goalScope) return;
    const claim = await store.beginRequest(goalScope, kind, payload);
    try {
      await send(claim.requestId);
      store.settleRequest(goalScope, kind, claim.requestId);
    } catch (failure) {
      const info = mutationError(failure);
      if (!info.unknown) store.settleRequest(goalScope, kind, claim.requestId);
      throw failure;
    }
  };

  const install = async () => {
    if (!goalScope || busy) return;
    const tasks = nodes.filter(node => node.taskId.trim() && node.instruction.trim()).map(node => ({
      taskId: node.taskId.trim(),
      title: node.title.trim() || node.taskId.trim(),
      instruction: node.instruction.trim(),
      dependsOn: node.dependsOn.split(',').map(value => value.trim()).filter(Boolean),
    }));
    if (tasks.length < 2) { setMessage({ tone: 'error', text: '探索计划需要 2 到 8 个真实工作节点。' }); return; }
    setBusy('install'); setMessage(null);
    try {
      await runRequest('exploration-plan', [goalScope.projectId, goalScope.workspaceId, goalScope.goalId, tasks], requestId => api.explorationPlan(goalScope, { requestId, tasks }));
      setMessage({ tone: 'info', text: '探索计划已安装；节点报告需要逐个审阅，审阅不等于项目测试通过。' });
    } catch (failure) { setMessage({ tone: 'error', text: mutationError(failure).message }); }
    finally { setBusy(null); }
  };

  const runNode = async (taskId: string) => {
    if (!goalScope || busy) return;
    setBusy(taskId); setMessage(null);
    try {
      await runRequest('exploration-run', [goalScope.projectId, goalScope.workspaceId, goalScope.goalId, taskId, 'explore'], requestId => api.explorationRun(goalScope, { requestId, taskId }));
      setMessage({ tone: 'info', text: '已受理只读探索节点：' + taskId + '。本次不修改项目、不运行构建。' });
    } catch (failure) { setMessage({ tone: 'error', text: mutationError(failure).message }); }
    finally { setBusy(null); }
  };

  const submitReview = async () => {
    if (!goalScope || !review || busy) return;
    if (reviewText.trim().length < 10) { setMessage({ tone: 'error', text: '请填写至少 10 个字符的核对依据。' }); return; }
    setBusy('review'); setMessage(null);
    try {
      await runRequest('exploration-review', [goalScope.projectId, goalScope.workspaceId, goalScope.goalId, review.taskId, review.runId, verdict, reviewText.trim()],
        requestId => api.explorationReview(goalScope, { requestId, taskId: review.taskId, runId: review.runId, reviewVerdict: verdict, reviewOrigin: 'operator', reviewText: reviewText.trim() }));
      setReview(null); setReviewText('');
      setMessage({ tone: 'info', text: '审阅结论已提交，由控制引擎判定后更新任务状态。' });
    } catch (failure) { setMessage({ tone: 'error', text: mutationError(failure).message }); }
    finally { setBusy(null); }
  };

  const nodeState = (taskId: string) => {
    const run = runs.find(record => record.spec.taskId === taskId && record.spec.mode === 'explore');
    const nodeReport = reports.find(item => item.taskId === taskId);
    const nodeReview = [...reviews].reverse().find(item => item.taskId === taskId);
    const row = rows.find(item => item.taskId === taskId);
    const dependencies = plan?.tasks?.find(task => task.taskId === taskId)?.dependsOn ?? [];
    const ready = dependencies.every(dep => [...reviews].reverse().find(item => item.taskId === dep && item.verdict === 'PASS' && item.control?.status === 'applied'));
    return { run, report: nodeReport, review: nodeReview, row, dependencies, ready: !!ready };
  };

  const allReviewed = (plan?.tasks ?? []).every(task => reports.some(item => item.taskId === task.taskId) && [...reviews].some(item => item.taskId === task.taskId && item.verdict === 'PASS'));
  const gate = nodeState(plan?.gateTaskId ?? 'gate-goal');

  return (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }}>
      <Group px="sm" py={6} className="panel-head" justify="space-between">
        <Stack gap={0}><Text size="sm" fw={600}>只读探索</Text><Text size="xs" c="dimmed">操作者配置计划 · 模型只读取项目 · 每个节点单独审阅</Text></Stack>
      </Group>
      <Box className="panel-body" style={{ minHeight: 0, overflow: 'auto' }}>
        <Stack gap="sm" p="sm">
          {message ? <Alert color={message.tone === 'error' ? 'red' : message.tone === 'warning' ? 'yellow' : 'blue'} variant="light" role="status">{message.text}</Alert> : null}
          {!plan ? (
            <Paper withBorder p="xs" radius="sm">
              <Text size="xs" fw={600} mb={4}>配置探索计划（2–8 个节点）</Text>
              <Text size="xs" c="dimmed" mb={6}>探索只读取文件并产出报告；不修改项目、不运行构建、不代替真实开发任务。</Text>
              <Stack gap={6}>
                {nodes.map((node, index) => (
                  <Paper key={index} withBorder p={6} radius="sm">
                    <Group gap={4} wrap="nowrap">
                      <TextInput size="xs" w={110} placeholder="taskId" value={node.taskId} onChange={event => setNodes(nodes.map((item, i) => i === index ? { ...item, taskId: event.currentTarget.value } : item))} data-testid={'explore-id-' + index} />
                      <TextInput size="xs" style={{ flex: 1 }} placeholder="标题" value={node.title} onChange={event => setNodes(nodes.map((item, i) => i === index ? { ...item, title: event.currentTarget.value } : item))} />
                      <TextInput size="xs" w={120} placeholder="依赖 id，逗号分隔" value={node.dependsOn} onChange={event => setNodes(nodes.map((item, i) => i === index ? { ...item, dependsOn: event.currentTarget.value } : item))} />
                      {nodes.length > 2 ? <Button size="xs" variant="subtle" onClick={() => setNodes(nodes.filter((_, i) => i !== index))}>删除</Button> : null}
                    </Group>
                    <Textarea mt={4} size="xs" autosize minRows={2} placeholder="该节点要核对什么？" value={node.instruction} onChange={event => setNodes(nodes.map((item, i) => i === index ? { ...item, instruction: event.currentTarget.value } : item))} data-testid={'explore-instruction-' + index} />
                  </Paper>
                ))}
              </Stack>
              <Group gap={4} mt={6}>
                {nodes.length < 8 ? <Button size="xs" variant="light" onClick={() => setNodes([...nodes, { taskId: '', title: '', instruction: '', dependsOn: nodes.at(-1)?.taskId ?? '' }])}>添加节点</Button> : null}
                <Button size="xs" loading={busy === 'install'} onClick={() => void install()} data-testid="install-exploration">安装探索计划</Button>
              </Group>
            </Paper>
          ) : (
            <>
              <Paper withBorder p="xs" radius="sm">
                <Group justify="space-between"><Text size="xs" fw={600}>{plan.planId}</Text><Badge color="gray" variant="light">{plan.planOrigin === 'operator' ? '操作者配置' : plan.planOrigin}</Badge></Group>
                <FieldRow label="来源快照"><span style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}>{plan.sourceDigest?.slice(0, 16)}…</span></FieldRow>
                <FieldRow label="创建时间">{time(plan.createdAt)}</FieldRow>
              </Paper>
              <Table striped withTableBorder fz="xs">
                <Table.Thead><Table.Tr><Table.Th>节点</Table.Th><Table.Th>状态</Table.Th><Table.Th>报告</Table.Th><Table.Th>审阅</Table.Th><Table.Th /></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {(plan.tasks ?? []).map(task => {
                    const state = nodeState(task.taskId);
                    return (
                      <Table.Tr key={task.taskId} data-explore-task={task.taskId}>
                        <Table.Td><Stack gap={0}><Text size="xs" fw={500}>{task.title}</Text><Text size="xs" c="dimmed">{task.taskId}{state.dependencies.length ? ' · 依赖 ' + state.dependencies.join('、') : ''}</Text></Stack></Table.Td>
                        <Table.Td><Badge size="xs" color={statusTone(state.row?.livePhase ?? (state.run ? state.run.status : 'pending'))} variant="light">{state.row?.livePhase ?? (state.run ? state.run.status : '未运行')}</Badge></Table.Td>
                        <Table.Td>{state.report ? <Button size="xs" variant="subtle" onClick={() => setReport({ taskId: task.taskId, body: state.report?.report ?? '', digest: state.report?.reportDigest ?? '' })} data-testid={'explore-report-' + task.taskId}>查看报告</Button> : <Text size="xs" c="dimmed">—</Text>}</Table.Td>
                        <Table.Td>{state.review ? <Badge size="xs" color={state.review.verdict === 'PASS' ? 'green' : 'red'} variant="light">{state.review.verdict}{state.review.control?.status === 'applied' ? ' · 已登记' : ' · 待登记'}</Badge> : <Text size="xs" c="dimmed">未审阅</Text>}</Table.Td>
                        <Table.Td>
                          <Group gap={4} wrap="nowrap">
                            {!state.run && state.ready ? <Button size="xs" loading={busy === task.taskId} onClick={() => void runNode(task.taskId)} data-testid={'explore-run-' + task.taskId}>运行节点</Button> : null}
                            {state.run && state.report && !state.review ? <Button size="xs" variant="light" onClick={() => { setReview({ taskId: task.taskId, runId: state.run!.spec.runId }); setVerdict('PASS'); setReviewText(''); }} data-testid={'explore-review-' + task.taskId}>审阅</Button> : null}
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                  <Table.Tr>
                    <Table.Td><Text size="xs" fw={500}>整体核验（{plan.gateTaskId}）</Text></Table.Td>
                    <Table.Td><Badge size="xs" color={statusTone(gate.row?.livePhase ?? 'pending')} variant="light">{gate.row?.livePhase ?? '待处理'}</Badge></Table.Td>
                    <Table.Td><Text size="xs" c="dimmed">—</Text></Table.Td>
                    <Table.Td>{gate.review ? <Badge size="xs" color={gate.review.verdict === 'PASS' ? 'green' : 'red'} variant="light">{gate.review.verdict}</Badge> : <Text size="xs" c="dimmed">未审阅</Text>}</Table.Td>
                    <Table.Td>{allReviewed && !gate.review ? <Button size="xs" variant="light" onClick={() => { setReview({ taskId: plan.gateTaskId ?? 'gate-goal', runId: '' }); setVerdict('PASS'); setReviewText(''); }} data-testid="explore-review-gate">整体审阅</Button> : null}</Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>
              {(plan.reportErrors ?? []).length ? <Alert color="yellow" variant="light">报告登记失败：{(plan.reportErrors ?? []).map(item => item.runId + ' ' + item.error).join('；')}</Alert> : null}
              <RawDetails value={{ planId: plan.planId, sourceDigest: plan.sourceDigest, reports: reports.map(item => ({ taskId: item.taskId, runId: item.runId, digest: item.reportDigest })), reviews: reviews.map(item => ({ taskId: item.taskId, verdict: item.verdict, control: item.control })) }} label="查看探索依据" />
              <Button size="xs" variant="subtle" onClick={() => store.openView('tasks')}>在任务视图中查看依赖</Button>
            </>
          )}
          <Text size="xs" c="dimmed">只读探索的报告审阅由操作者完成；它不是项目构建或测试通过的证明，也不会自动完成目标。</Text>
        </Stack>
      </Box>

      <Modal opened={!!report} onClose={() => setReport(null)} title={report ? '探索报告 · ' + report.taskId : ''} size="lg">
        {report ? (
          <Stack gap="xs">
            <Text size="xs" c="dimmed">报告摘要 {report.digest.slice(0, 16)}…</Text>
            <Box className="markdown-body"><Markdown text={report.body || '报告内容为空。'} /></Box>
          </Stack>
        ) : null}
      </Modal>

      <Modal opened={!!review} onClose={() => setReview(null)} title="提交审阅结论" size="md">
        <Stack gap="xs">
          <Text size="xs" c="dimmed">核对报告中的文件、行号与未验证项；审阅不等于运行了项目测试。</Text>
          <Select size="xs" label="结论" value={verdict} onChange={value => setVerdict(value ?? 'PASS')} data={[{ value: 'PASS', label: '通过' }, { value: 'FAIL', label: '未通过' }]} />
          <Textarea size="xs" label="核对依据与结论" minRows={5} maxLength={8192} value={reviewText} onChange={event => setReviewText(event.currentTarget.value)} data-testid="review-text" />
          <Group justify="flex-end"><Button size="xs" loading={busy === 'review'} onClick={() => void submitReview()} data-testid="submit-review">提交审阅</Button></Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

