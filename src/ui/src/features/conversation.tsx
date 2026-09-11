import { ActionIcon, Alert, Badge, Box, Button, Checkbox, Collapse, Group, NumberInput, Paper, Select, Stack, Text, Textarea, Tooltip } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { invalidateScope, mutationError } from '../api/hooks';
import type { CommandCheck, LiveRun, ReceiptView, RunEvent } from '../api/types';
import { EmptyState, ErrorState, FieldRow, LoadingState } from '../components/states';
import { fileLineLabel, isActiveRun, number, runLabels, statusTone, summarizeUsage, time, toolCommand, toolNames } from '../format';
import { checkVerdict, lifecycleLabels } from './check-report';
import { Markdown } from '../markdown';
import { useAppState } from '../state/app-store';
import type { ViewProps } from '../workbench/view-props';
import { InitialPlanningView } from './initial-planning';
import { FeedbackChoice } from './feedback-choice';

function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge color={statusTone(status)} variant="light" size="sm">{label ?? status}</Badge>;
}

function ToolEvent({ event, calls }: { event: RunEvent; calls: Map<string, { name?: string; arguments?: Record<string, unknown> }> }) {
  const id = event.data.callId ?? event.data.call?.callId ?? String(event.sequence);
  const call = calls.get(id) ?? event.data.call;
  const state = event.type.slice(5);
  const labels: Record<string, string> = { started: '执行中', completed: '已结束', failed: '执行失败', outcome_unknown: '结果未知' };
  const exit = event.data.result?.output?.find(item => item.kind === 'json' && item.value && typeof item.value === 'object' && 'exitCode' in (item.value as object))?.value as { exitCode?: number } | undefined;
  const output = (event.data.result?.output ?? []).map(item => item.kind === 'text' ? (item.text ?? '') : JSON.stringify(item.value ?? item)).join('\n\n');
  return (
    <details className="tool-event" data-state={state}>
      <summary>
        <span className="tool-name">{toolNames[call?.name ?? ''] ?? call?.name ?? '工具调用'}</span>
        <span className="tool-command">{toolCommand(call).slice(0, 120)}</span>
        <Badge size="xs" variant="light" color={state === 'failed' ? 'red' : state === 'completed' ? 'gray' : 'blue'}>
          {labels[state] ?? state}{exit?.exitCode !== undefined ? ' · 退出码 ' + exit.exitCode : ''}
        </Badge>
      </summary>
      <pre className="tool-args">{call?.arguments ? JSON.stringify(call.arguments, null, 2) : ''}</pre>
      {output ? <pre className="tool-output">{output}</pre> : null}
      <Text size="xs" c="dimmed">工具执行结果不等于验收结论；通过与否以检查报告和独立验收为准。</Text>
    </details>
  );
}

function CheckList({ checks }: { checks: CommandCheck[] }) {
  return (
    <Stack gap={4}>
      {checks.map(check => (
        <Group key={check.requestId} gap="xs" wrap="nowrap" align="flex-start">
          <StatusBadge status={check.status} label={lifecycleLabels[check.status] ?? check.status} />
          <Stack gap={0} style={{ minWidth: 0 }}>
            <Text size="xs" style={{ fontFamily: 'var(--mantine-font-family-monospace)', wordBreak: 'break-all' }}>{check.command ?? '命令未记录（旧记录）'}</Text>
            <Text size="xs" c="dimmed">{time(check.finishedAt ?? check.startedAt)} · 检查结果 {checkVerdict(check)}</Text>
          </Stack>
        </Group>
      ))}
    </Stack>
  );
}

function RunThread({ api, run, store, goalScope }: { api: ViewProps['api']; run: LiveRun; store: ViewProps['store']; goalScope: ViewProps['goalScope'] }) {
  const calls = useMemo(() => {
    const map = new Map<string, { name?: string; arguments?: Record<string, unknown> }>();
    for (const event of run.trace) if (event.type === 'tool.started' && event.data.call) map.set(event.data.call.callId, event.data.call);
    return map;
  }, [run.trace]);
  const usage = summarizeUsage(run.usage);
  const active = isActiveRun(run.status);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const cancel = async () => {
    if (!goalScope) return;
    setCancelling(true); setCancelError(null);
    try { await api.cancelRealTask(goalScope, run.spec.runId); store.notify('info', '已请求停止该运行；服务器确认后状态会更新。'); }
    catch (error) { const info = mutationError(error); setCancelError(info.unknown ? '停止请求结果未知：' + info.message + '（请稍后刷新确认）' : info.message); }
    finally { setCancelling(false); }
  };

  return (
    <Stack gap="sm" className="run-thread" data-run-id={run.spec.runId} data-run-status={run.status}>
      <article className="message user">
        <div className="message-meta"><strong>{run.spec.mode === 'review' ? '独立 Reviewer' : '你'}</strong><Text size="xs" c="dimmed">{run.spec.mode === 'review' ? '只读审阅' : run.spec.mode === 'explore' ? '只读探索' : '开发任务'}</Text></div>
        <div className="message-body"><Markdown text={run.spec.instruction} /></div>
      </article>
      <article className="message assistant">
        <div className="message-meta">
          <strong>执行 Agent</strong>
          <StatusBadge status={run.status} label={runLabels[run.status as keyof typeof runLabels] ?? run.status} />
          <Text size="xs" c="dimmed">{run.spec.runId}</Text>
        </div>
        <div className="message-body">
          <Group gap="xs" mb={4}>
            <Text size="xs" c="dimmed">
              {run.configuration?.model ? run.configuration.model : '模型未报告'}
              {run.configuration?.revision ? ' · 配置版本 ' + run.configuration.revision.slice(0, 8) : ''}
              {run.spec.budget?.contextWindowTokens ? ' · 单次上下文 ' + number(run.spec.budget.contextWindowTokens) + ' tokens' : ''}
            </Text>
          </Group>
          {run.error ? <ErrorState title="运行错误" message={run.error} /> : null}
          {run.trace.length === 0 && active ? <LoadingState label="等待执行事件…" /> : null}
          {run.trace.map(event => {
            if (event.type === 'assistant.message_completed' && event.data.message?.content?.trim()) {
              return <div key={event.sequence + ':msg'} className="assistant-message"><Markdown text={event.data.message.content} /></div>;
            }
            if (/^tool\.(started|completed|failed|outcome_unknown)$/.test(event.type)) {
              return <ToolEvent key={event.sequence + ':' + event.type} event={event} calls={calls} />;
            }
            return null;
          })}
          <details className="usage-details">
            <summary>本次运行用量 · {number(usage.requests)} 次模型调用</summary>
            <Stack gap={2} pl="sm">
              <FieldRow label="累计输入">{number(usage.input)} tokens</FieldRow>
              <FieldRow label="累计输出">{number(usage.output)} tokens</FieldRow>
              <FieldRow label="缓存输入">{number(usage.cached)} tokens</FieldRow>
              <FieldRow label="未报告">{usage.unknown} 次调用用量未完整报告，合计不完整</FieldRow>
            </Stack>
          </details>
          {(run.commandChecks ?? []).length ? (
            <details className="usage-details" open>
              <summary>命令检查 · {run.commandChecks!.length} 次</summary>
              <CheckList checks={run.commandChecks!} />
            </details>
          ) : null}
          {cancelError ? <Text size="xs" c="red">{cancelError}</Text> : null}
          <Group gap="xs" mt={6}>
            {active ? <Button color="red" variant="light" loading={cancelling} onClick={() => void cancel()}>停止执行</Button> : null}
            <Button variant="subtle" onClick={() => store.openView('verification')}>检查与验证</Button>
            <Button variant="subtle" onClick={() => store.openView('logs', { runId: run.spec.runId })}>运行日志</Button>
          </Group>
        </div>
      </article>
    </Stack>
  );
}

function SemanticQuery({ api, goalScope, store, refresh }: ViewProps) {
  const [question, setQuestion] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const scopeKey = JSON.stringify(goalScope), current = useRef(scopeKey); current.current = scopeKey;
  useEffect(() => { setQuestion(''); setMessage(''); }, [scopeKey]);
  const submit = async () => {
    if (!goalScope || !question.trim() || busy) return;
    setBusy(true); setMessage('');
    try {
      const claim = await store.beginRequest(goalScope, 'semantic-query', [goalScope, question.trim()]);
      try { await api.semanticQuery(goalScope, { requestId: claim.requestId, question: question.trim() }); store.settleRequest(goalScope, 'semantic-query', claim.requestId); }
      catch (error) { if (!mutationError(error).unknown) store.settleRequest(goalScope, 'semantic-query', claim.requestId); throw error; }
      if (current.current === scopeKey) { setMessage('只读查询已登记，将在独立运行中回答。'); setQuestion(''); refresh(); }
    } catch (error) { if (current.current === scopeKey) setMessage(mutationError(error).message); }
    finally { setBusy(false); }
  };
  return <Box px="sm" py={6}><Group align="flex-end"><Textarea size="xs" style={{ flex: 1 }} label="独立只读提问" value={question} onChange={event => setQuestion(event.currentTarget.value)} maxLength={4096} autosize minRows={1} maxRows={3} data-testid="semantic-question" /><Button size="xs" loading={busy} disabled={!question.trim()} onClick={() => void submit()} data-testid="semantic-ask">提问</Button></Group><Text size="xs" c="dimmed">使用当前模型设置读取公开事实与源码，不中断开发运行。{message}</Text></Box>;
}

function FixtureAnswers({ data,api,goalScope,refresh }: Pick<ViewProps,'api'|'goalScope'|'refresh'> & { data: NonNullable<ViewProps['data']> }) {
  const queries = data.queries.filter(query => query.status === 'ready' && query.job.goalId === data.goalId && query.job.intent.execution?.kind !== 'initial_coordination');
  if (!queries.length) return null;
  return (
    <Stack gap="sm">
      {queries.map(query => (
        <Stack key={query.job.queryJobId} gap="xs">
          <article className="message user"><div className="message-meta"><strong>{query.job.intent.execution?.kind === 'execution_coordination' ? '执行反馈' : '你'}</strong></div><div className="message-body"><Text size="sm">{query.job.intent.question}</Text>
            {query.job.intent.execution?.feedback ? <Text size="xs" c="dimmed">任务 {query.job.intent.execution.feedback.taskId} · Run {query.job.intent.execution.feedback.runRef.runId} · 来源 {query.job.intent.execution.feedback.reportRef.digest}</Text> : null}
          </div></article>
          <article className="message assistant">
            <div className="message-meta"><strong>项目助手</strong><Badge color="gray" variant="light">{query.job.intent.execution?.kind === 'execution_coordination' ? '协调角色调查' : query.job.intent.execution ? '独立只读模型查询' : '测试适配器回答'}</Badge></div>
            <div className="message-body">
              <Text size="sm">{query.currentAnswer?.answer ?? query.job.closeReason?.message ?? '查询已记录，等待回答…'}</Text>
              {queries.some(next=>next.job.intent.execution?.feedback?.supersedesQueryJobId===query.job.queryJobId)
                ? <Text size="xs" c="dimmed">已有后续调查，本回答保留为历史材料。</Text>
                : query.currentAnswer?<FeedbackChoice answer={query.currentAnswer} api={api} goalScope={goalScope} refresh={refresh}/>:null}
              {query.job.intent.execution?.feedback?.decisionRef?<Text size="xs">关联人的决定：{query.job.intent.execution.feedback.decisionRef.decisionId}</Text>:null}
              {query.currentAnswer?.stale ? <Text size="xs" c="orange">来源版本已变化，回答保留为历史材料。</Text> : null}
              {query.currentAnswer?.sources?.length ? (
                <details className="usage-details"><summary>{query.currentAnswer.sources.length} 项事实与源码来源</summary>
                  <Stack gap={2} pl="sm">{query.currentAnswer.sources.map(source => <Text key={source.refKey} size="xs">{source.label ?? source.refKey} · {source.version}</Text>)}</Stack>
                </details>
              ) : null}
            </div>
          </article>
        </Stack>
      ))}
    </Stack>
  );
}

/**
 * Declared capacities only. Cumulative limits (input/output tokens, model calls,
 * tool calls, run duration) start as null = "not limited"; the operator must set
 * them explicitly, and an unset value is never replaced by a hidden default in
 * the UI, the HTTP layer, the RunSpec or the kernel limit guard.
 */
const DEFAULT_BUDGET = { contextWindowTokens: 128000, inputTokens: null as number | null, outputTokens: null as number | null, maxRequests: null as number | null, maxToolCalls: null as number | null, timeoutMs: null as number | null, perResponseTokens: 4096 };
type BudgetDraft = typeof DEFAULT_BUDGET;
/** Empty cumulative field = "not limited"; never coerced to a default number. */
const optionalNumber = (value: string | number | bigint): number | null => {
  if (value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
};

/**
 * Fixture-mode query box. It is visually and textually separate from the real task
 * entry so nobody mistakes a test-adapter answer for a model answer.
 */
function FixtureQuery({ api, data, goalScope, refresh, store }: ViewProps) {
  const [question, setQuestion] = useState('');
  const [focus, setFocus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = data?.matrix.status === 'ready' ? data.matrix.matrix.rows : [];
  const submit = async () => {
    if (!goalScope || !question.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const claim = await store.beginRequest(goalScope, 'fixture-query', [goalScope.projectId, goalScope.workspaceId, goalScope.goalId, question.trim(), focus]);
      try {
        await api.submitQuery(goalScope, { requestId: claim.requestId, question: question.trim(), ...(focus ? { focusTaskId: focus } : {}) });
        store.settleRequest(goalScope, 'fixture-query', claim.requestId);
      } catch (failure) {
        const info = mutationError(failure);
        if (!info.unknown) store.settleRequest(goalScope, 'fixture-query', claim.requestId);
        throw failure;
      }
      setQuestion('');
      store.notify('info', '查询已提交，回答由测试适配器生成，不代表真实模型结论。');
      refresh();
    } catch (failure) { setError(mutationError(failure).message); }
    finally { setBusy(false); }
  };
  return (
    <Box className="fixture-query" px="sm" py={6}>
      <Group gap="xs" wrap="wrap" align="flex-end">
        <Select size="xs" w={150} value={focus} onChange={value => setFocus(value ?? '')} placeholder="全部任务" aria-label="限定任务" data={[{ value: '', label: '全部任务' }, ...rows.map(row => ({ value: row.taskId, label: row.title }))]} />
        <Textarea size="xs" style={{ flex: 1, minWidth: 160 }} autosize minRows={1} maxRows={3} maxLength={4096} value={question} onChange={event => setQuestion(event.currentTarget.value)} aria-label="测试适配器查询" placeholder="向测试适配器提问（不调用真实模型）" data-testid="fixture-question" />
        <Button size="xs" variant="light" loading={busy} disabled={!question.trim()} onClick={() => void submit()} data-testid="fixture-ask">查询</Button>
      </Group>
      <Text size="xs" c="dimmed" mt={4}>此入口使用本地测试适配器，回答带来源但固定。</Text>
      {error ? <Text size="xs" c="red" mt={2}>{error}</Text> : null}
    </Box>
  );
}

function Composer(props: ViewProps) {
  const { api, data, store, scope, goalScope, refresh } = props;
  const queryClient = useQueryClient();
  const draft = store.draft(goalScope);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; unknown: boolean } | null>(null);
  const [showBudget, setShowBudget] = useState(false);
  const [budget, setBudget] = useState<BudgetDraft>(DEFAULT_BUDGET);
  const [receipt, setReceipt] = useState<ReceiptView | null>(null);
  const [checking, setChecking] = useState(false);
  const pending = goalScope ? store.pendingRequests(goalScope).find(entry => entry.kind === 'real-task') ?? null : null;

  const activeRun = (data?.liveRuns ?? []).find(run => isActiveRun(run.status));
  const hasRealPlan = data?.executionCapability?.executor === 'coding-agent' && data.graph.status === 'ready';
  const planningActive = data?.planning?.some(row => ['pending', 'running'].includes(row.status));
  const canSubmit = !!goalScope && draft.instruction.trim().length > 0 && draft.allowWrite && !submitting && !activeRun && !planningActive;
  const update = (patch: Partial<typeof draft>) => { if (goalScope) store.updateDraft(goalScope, patch); };

  const submit = async () => {
    if (!goalScope || !canSubmit) return;
    const instruction = draft.instruction.trim();
    const references = draft.references;
    setSubmitting(true); setError(null); setReceipt(null);
    try {
      // The identity covers everything that changes the request: scope, instruction,
      // referenced material, write permission and the whole budget object. An
      // unconfigured cumulative limit is null here and stays null end to end.
      const claim = await store.beginRequest(goalScope, 'real-task', [goalScope.projectId, goalScope.workspaceId, goalScope.goalId, instruction, references, draft.allowWrite, budget]);
      if (claim.replaced) store.notify('warning', '提交内容或预算已改变，将作为新请求提交。', '原未决标识 ' + claim.replaced + ' 不会被复用，也不会被静默覆盖。');
      try {
        const result = await api.runRealTask(goalScope, { requestId: claim.requestId, instruction, allowWrite: true, references, budget });
        store.settleRequest(goalScope, 'real-task', claim.requestId);
        store.clearDraft(goalScope);
        store.notify('success', '服务器已受理开发任务：' + result.runId, '受理不等于完成，运行结果以服务器事实为准。');
        invalidateScope(queryClient, scope);
        refresh();
      } catch (failure) {
        const info = mutationError(failure);
        setError(info);
        // A definite rejection ends this logical request; only an unknown outcome
        // keeps the id so a retry replays instead of creating a second run.
        if (!info.unknown) store.settleRequest(goalScope, 'real-task', claim.requestId);
        else store.notify('warning', '提交结果未知：' + info.message, '重试会复用同一请求标识；也可以先查询服务器回执。');
      }
    } catch (failure) { setError(mutationError(failure)); }
    finally { setSubmitting(false); }
  };

  const queryReceipt = async () => {
    if (!goalScope || !pending || checking) return;
    setChecking(true); setError(null);
    try {
      const view = await api.receipt(goalScope, { requestId: pending.requestId, kind: 'real-task' });
      setReceipt(view);
      if (view.found) {
        store.settleRequest(goalScope, 'real-task', pending.requestId);
        store.clearDraft(goalScope);
        store.notify('info', '服务器已受理该请求：' + (view.runId ?? '') + '（正式运行状态 ' + (view.runStatus ?? '未知') + '）', '这是服务器记录的事实，不是模型完成声明。');
        invalidateScope(queryClient, scope);
        refresh();
      }
    } catch (failure) { setError(mutationError(failure)); }
    finally { setChecking(false); }
  };

  if (!goalScope) {
    return <Box p="sm" className="composer"><Text size="sm" c="dimmed">先选择一个目标，才能提交开发任务。</Text></Box>;
  }

  return (
    <Box className="composer" data-state={activeRun ? 'running' : 'idle'}>
      {draft.references.length ? (
        <Group gap={6} mb={6} wrap="wrap" data-testid="reference-chips">
          {draft.references.map(reference => (
            <Paper key={reference.path} withBorder px="xs" py={2} radius="xl" className="reference-chip">
              <Group gap={6} wrap="nowrap">
                <Text size="xs" style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}>{reference.path}{fileLineLabel(reference.lines)}</Text>
                <Tooltip label={'提交时服务器会重新核对版本 · SHA-256 ' + reference.sha256.slice(0, 12)}>
                  <Text size="xs" c="dimmed">v{reference.sha256.slice(0, 8)}</Text>
                </Tooltip>
                <ActionIcon size="xs" aria-label={'移除引用 ' + reference.path} onClick={() => store.removeReference(goalScope, reference.path)}>×</ActionIcon>
              </Group>
            </Paper>
          ))}
        </Group>
      ) : null}
      <Textarea
        value={draft.instruction}
        onChange={event => update({ instruction: event.currentTarget.value })}
        onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void submit(); } }}
        autosize minRows={2} maxRows={8} maxLength={4096}
        aria-label="开发任务要求"
        placeholder={activeRun ? '当前有运行正在进行；可以继续编写草稿，提交需等待本次运行结束。' : '描述要实现或修复的内容，以及验收条件（Ctrl/Cmd + Enter 提交）'}
        data-testid="composer-input"
        disabled={submitting}
      />
      <Group justify="space-between" mt={6} wrap="wrap" gap="xs">
        <Group gap="xs">
          <Checkbox size="xs" checked={draft.allowWrite} onChange={event => update({ allowWrite: event.currentTarget.checked })} label="允许在当前项目内修改文件（工具网络关闭）" data-testid="allow-write" />
          <Button variant="subtle" onClick={() => setShowBudget(value => !value)} aria-expanded={showBudget}>本次运行限额</Button>
        </Group>
        <Group gap="xs">
          {data?.executionCapability?.fixtureEnabled === true && data.graph.status === 'ready' ? (
            <Tooltip label="样例计划使用测试适配器，不调用真实模型"><Text size="xs" c="dimmed">样例计划</Text></Tooltip>
          ) : null}
          <Button onClick={() => void submit()} loading={submitting} disabled={!canSubmit} data-testid="submit-task">执行开发任务</Button>
        </Group>
      </Group>
      <Collapse expanded={showBudget}>
        <Stack gap={4} mt="xs" className="budget-grid">
          <Text size="xs" c="dimmed">上下文容量与单次响应输出是一次调用的声明容量（不是对模型能力的探测）；累计项留空表示不限制，只有你填写后服务器才会执行累计约束。</Text>
          <Group gap="sm" wrap="wrap">
            <NumberInput size="xs" label="上下文容量（声明值）" value={budget.contextWindowTokens} min={1} max={1000000} onChange={value => setBudget({ ...budget, contextWindowTokens: Number(value) || 1 })} w={150} />
            <NumberInput size="xs" label="累计输入" value={budget.inputTokens ?? ''} min={1} max={25000000} placeholder="不限制" onChange={value => setBudget({ ...budget, inputTokens: optionalNumber(value) })} w={120} data-testid="budget-input-tokens" />
            <NumberInput size="xs" label="累计输出" value={budget.outputTokens ?? ''} min={1} max={128000} placeholder="不限制" onChange={value => setBudget({ ...budget, outputTokens: optionalNumber(value) })} w={120} />
            <NumberInput size="xs" label="模型调用" value={budget.maxRequests ?? ''} min={1} max={128} placeholder="不限制" onChange={value => setBudget({ ...budget, maxRequests: optionalNumber(value) })} w={100} />
            <NumberInput size="xs" label="工具调用" value={budget.maxToolCalls ?? ''} min={1} max={256} placeholder="不限制" onChange={value => setBudget({ ...budget, maxToolCalls: optionalNumber(value) })} w={100} />
            <NumberInput size="xs" label="运行最长秒数" value={budget.timeoutMs === null ? '' : budget.timeoutMs / 1000} min={1} max={900} placeholder="不限制" onChange={value => setBudget({ ...budget, timeoutMs: optionalNumber(value) === null ? null : optionalNumber(value)! * 1000 })} w={110} />
            <NumberInput size="xs" label="单次响应输出" value={budget.perResponseTokens} min={256} max={8192} onChange={value => setBudget({ ...budget, perResponseTokens: Number(value) || 4096 })} w={120} />
          </Group>
          <Text size="xs" c="dimmed">命令检查的单次超时在“检查与验证”中单独设置，不受这里影响。</Text>
        </Stack>
      </Collapse>
      {pending ? (
        <Alert color="yellow" variant="light" mt={6} role="status" data-testid="pending-request">
          <Stack gap={4}>
            <Text size="xs">上一次提交未收到回执，请求标识 {pending.requestId}</Text>
            <Group gap="xs">
              <Button size="xs" variant="light" loading={checking} onClick={() => void queryReceipt()} data-testid="query-receipt">查询服务器回执</Button>
              <Text size="xs" c="dimmed">内容与预算不变时再次提交会复用该标识，不会重复创建任务。</Text>
            </Group>
          </Stack>
        </Alert>
      ) : null}
      {receipt ? (
        <Alert color={receipt.found ? 'blue' : 'gray'} variant="light" mt={6} role="status" data-testid="submit-receipt">
          {receipt.found
            ? '服务器已受理：' + (receipt.runId ?? '') + ' · 正式运行状态 ' + (receipt.runStatus ?? '未知') + (receipt.runtimeStatus ? ' · 执行器状态 ' + receipt.runtimeStatus : '')
            : '服务器没有该请求的记录：可以安全地用同一标识重试。'}
        </Alert>
      ) : null}
      {error ? (
        <Stack gap={4} mt={6}>
          <Text size="xs" c="red" data-testid="submit-error">{error.unknown ? '结果未知：' + error.message : error.message}</Text>
          {error.unknown ? <Text size="xs" c="dimmed">请先查询服务器回执，或用同一内容与预算重试（会复用请求标识）。</Text> : null}
        </Stack>
      ) : null}
      {!hasRealPlan && !activeRun ? <Text size="xs" c="dimmed" mt={4}>提交后先分析源码并提出计划，计划接纳后按依赖执行；累计限制只在你填写时生效。</Text> : null}
    </Box>
  );
}

export function ConversationView(props: ViewProps) {
  const { data, loading, error, store, refresh } = props;
  const appState = useAppState();
  const scroller = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unread, setUnread] = useState(0);
  const lastCount = useRef(0);

  const runs = data?.liveRuns ?? [];
  const messageCount = useMemo(() => runs.reduce((total, run) => total + 1 + run.trace.filter(event => event.type === 'assistant.message_completed').length, 0) + (data?.queries.length ?? 0) * 2, [runs, data?.queries.length]);

  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    if (atBottom) { node.scrollTop = node.scrollHeight; setUnread(0); }
    else if (messageCount > lastCount.current) setUnread(messageCount - lastCount.current);
    lastCount.current = messageCount;
  }, [messageCount, atBottom]);

  const onScroll = useCallback(() => {
    const node = scroller.current;
    if (!node) return;
    const bottom = node.scrollHeight - node.clientHeight - node.scrollTop < 80;
    setAtBottom(bottom);
    if (bottom) setUnread(0);
  }, []);

  const goal = data?.goals.find(view => view.status === 'ready' && view.goal.goalId === data.goalId);
  const objective = goal?.status === 'ready' ? goal.goal.objective : '';
  const status = data?.goalStatus.status === 'ready' ? data.goalStatus.goal : null;
  const rows = data?.matrix.status === 'ready' ? data.matrix.matrix.rows : [];
  const verified = rows.filter(row => row.livePhase === 'satisfied').length;
  const realMode = data?.executionCapability?.executor === 'coding-agent' || (data?.liveRuns?.length ?? 0) > 0;

  return (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }} data-testid="conversation">
      {appState.droppedTabs.length ? (
        <Box px="xs" pt="xs"><ErrorState title="部分恢复的标签不可用" message={appState.droppedTabs.join('；')} /></Box>
      ) : null}
      <div className="conversation-scroll" ref={scroller} onScroll={onScroll} tabIndex={0} aria-label="项目对话记录" data-testid="conversation-scroll">
        <Stack gap="md" p="md" className="conversation-inner">
          <div className="goal-heading">
            <Text fw={600} size="md">{objective || '新建目标，开始项目对话'}</Text>
            <Group gap="xs" mt={4} wrap="wrap">
              {status ? <StatusBadge status={status.phase} label={'目标：' + status.phase} /> : <Badge color="gray" variant="light">目标尚无正式完成判定</Badge>}
              <Text size="xs" c="dimmed">已验证任务 {verified} / {rows.length}</Text>
              <Text size="xs" c="dimmed">存储 {data?.storage ?? '—'} · 执行 {realMode ? 'coding-agent' : 'fixture'}</Text>
            </Group>
          </div>
          {data ? <InitialPlanningView data={data} /> : null}
          {loading && !data ? <LoadingState label="正在读取项目状态…" /> : null}
          {error ? <ErrorState message={error} action={<Button size="xs" variant="light" onClick={refresh}>重试</Button>} /> : null}
          {data && !runs.length && !data.queries.length ? (
            <EmptyState
              title={data.goalId ? '还没有执行记录' : '先创建一个目标'}
              description={data.goalId ? '在下方描述要实现的内容并允许写入，提交后这里会显示真实的模型与工具活动。' : '左侧可以新建目标；目标保存后即可提交开发任务。'}
            />
          ) : null}
          {data ? <FixtureAnswers data={data} api={props.api} goalScope={props.goalScope} refresh={refresh} /> : null}
          {runs.map(run => <RunThread key={run.spec.runId} api={props.api} run={run} store={store} goalScope={props.goalScope} />)}
          {data?.exploration ? (
            <Paper withBorder p="sm" radius="sm">
              <Group justify="space-between"><Text size="sm" fw={600}>只读探索计划</Text><Button size="xs" variant="light" onClick={() => store.openView('tasks')}>打开任务</Button></Group>
              <Text size="xs" c="dimmed" mt={4}>探索只读取文件并产出报告，不修改项目、不运行构建；每个节点报告单独审阅。</Text>
            </Paper>
          ) : null}
        </Stack>
      </div>
      {unread > 0 && !atBottom ? (
        <Button className="new-messages" size="xs" variant="filled" onClick={() => { setAtBottom(true); setUnread(0); const node = scroller.current; if (node) node.scrollTop = node.scrollHeight; }} data-testid="new-messages">
          {unread} 条新消息 · 回到最新
        </Button>
      ) : null}
      {data?.executionCapability?.fixtureEnabled === true && data.matrix.status === 'ready' ? <FixtureQuery {...props} /> : null}
      {props.goalScope ? <SemanticQuery {...props} /> : null}
      <Composer {...props} />
    </Stack>
  );
}
