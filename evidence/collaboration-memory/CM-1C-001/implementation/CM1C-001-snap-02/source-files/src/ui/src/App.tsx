import { Alert, Box, Button, Checkbox, Divider, Group, MantineProvider, Modal, Select, Stack, Text, Textarea, Tooltip } from '@mantine/core';
import '@mantine/core/styles.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createApi } from './api/client';
import { mutationError, useGuiState, useMeta, useProjectAdder } from './api/hooks';
import { Resizer } from './components/Resizer';
import { ErrorState, LoadingState } from './components/states';
import { runLabels, statusTone } from './format';
import { AppStore, StoreProvider, useAppState, useAppStore, useMediaQuery } from './state/app-store';
import { MIN_CENTER_WIDTH } from './state/layout';
import { theme as mantineTheme } from './theme';
import { BottomDock, BottomResizer, RightWorkbench } from './workbench/Workbench';
import type { ViewProps } from './workbench/view-props';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true, gcTime: 60_000 } } });

function Notices() {
  const store = useAppStore();
  const { notices } = useAppState();
  if (!notices.length) return null;
  return (
    <Stack className="notices" gap={6} data-testid="notices">
      {notices.map(notice => (
        <Alert key={notice.id} color={notice.tone === 'error' ? 'red' : notice.tone === 'warning' ? 'yellow' : notice.tone === 'success' ? 'green' : 'blue'} variant="light" withCloseButton onClose={() => store.dismissNotice(notice.id)} role="status">
          <Text size="xs" fw={500}>{notice.text}</Text>
          {notice.detail ? <Text size="xs" c="dimmed">{notice.detail}</Text> : null}
        </Alert>
      ))}
    </Stack>
  );
}

function GoalDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useAppStore();
  const state = useAppState();
  const api = useMemo(() => createApi(state.meta?.workspaceToken ?? ''), [state.meta?.workspaceToken]);
  const [objective, setObjective] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const scope = state.scope;
  // Goal creation is a formal commit with an idempotency key; an unfinished one is
  // kept across a reload so a retry replays instead of creating a second goal.
  const pendingScope = scope ? { ...scope, goalId: '' } : null;
  const pending = pendingScope ? store.pendingRequests(pendingScope).find(entry => entry.kind === 'goal') ?? null : null;

  const submit = async () => {
    if (!scope || !objective.trim() || busy) return;
    setBusy(true); setError(null); setReceipt(null);
    try {
      const claim = await store.beginRequest(pendingScope!, 'goal', [scope.projectId, scope.workspaceId, objective.trim()]);
      try {
        const result = await api.createGoal(scope, { requestId: claim.requestId, objective: objective.trim() });
        store.settleRequest(pendingScope!, 'goal', claim.requestId);
        store.setGoal(result.goalId);
        store.notify('success', '目标已创建。');
        setObjective(''); onClose();
      } catch (failure) {
        const info = mutationError(failure);
        setError(info.unknown ? '结果未知：' + info.message : info.message);
        if (!info.unknown) store.settleRequest(pendingScope!, 'goal', claim.requestId);
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  };

  const queryReceipt = async () => {
    if (!scope || !pending || checking) return;
    setChecking(true); setError(null);
    try {
      const view = await api.receipt({ ...scope, goalId: pending.requestId }, { requestId: pending.requestId, kind: 'goal' });
      if (view.found) { store.settleRequest(pendingScope!, 'goal', pending.requestId); store.setGoal(pending.requestId); store.notify('info', '服务器已创建该目标。'); setObjective(''); onClose(); }
      else setReceipt('服务器没有该请求的记录：可以用同一标识安全重试。');
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setChecking(false); }
  };

  return (
    <Modal opened={open} onClose={onClose} title="新建目标" centered data-testid="goal-dialog">
      <Stack gap="xs">
        <Text size="xs" c="dimmed">每个目标拥有独立的对话、任务与执行记录。</Text>
        <Textarea label="你希望完成什么？" value={objective} onChange={event => setObjective(event.currentTarget.value)} autosize minRows={3} maxLength={4096} data-testid="goal-objective" />
        {pending ? (
          <Alert color="yellow" variant="light" role="status" data-testid="pending-goal">
            <Stack gap={4}>
              <Text size="xs">上一次创建未收到回执，请求标识 {pending.requestId}</Text>
              <Group gap="xs"><Button size="xs" variant="light" loading={checking} onClick={() => void queryReceipt()} data-testid="query-goal-receipt">查询服务器回执</Button><Text size="xs" c="dimmed">相同内容重试会复用该标识。</Text></Group>
            </Stack>
          </Alert>
        ) : null}
        {receipt ? <Text size="xs" c="dimmed" data-testid="goal-receipt">{receipt}</Text> : null}
        {error ? <Text size="xs" c="red" data-testid="goal-error">{error}</Text> : null}
        <Group justify="flex-end"><Button size="xs" onClick={() => void submit()} loading={busy} disabled={!objective.trim()} data-testid="create-goal">创建目标</Button></Group>
      </Stack>
    </Modal>
  );
}

function AddProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useAppStore();
  const state = useAppState();
  const api = useMemo(() => createApi(state.meta?.workspaceToken ?? ''), [state.meta?.workspaceToken]);
  const [path, setPath] = useState('');
  const [sameProject, setSameProject] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const adder = useProjectAdder(api, sameProject ? state.scope?.projectId : undefined);
  return (
    <Modal opened={open} onClose={onClose} title="添加项目文件夹" centered>
      <Stack gap="xs">
        <Text size="xs" c="dimmed">输入本机绝对目录；原有文件保留，项目会出现在左侧列表。</Text>
        <Checkbox label="登记为当前项目的另一个工作区" checked={sameProject} disabled={!state.scope} onChange={event => setSameProject(event.currentTarget.checked)} data-testid="same-project-workspace" />
        {sameProject ? <Text size="xs" c="dimmed">工作区分别保存运行和文件范围；历史材料需要精确授权后才能共享。</Text> : null}
        <Textarea label="文件夹路径" value={path} onChange={event => setPath(event.currentTarget.value)} autosize minRows={1} data-testid="project-path" />
        {error ? <Text size="xs" c="red">{error}</Text> : null}
        <Group justify="flex-end">
          <Button size="xs" loading={adder.isPending} disabled={!path.trim()} onClick={() => {
            setError(null);
            adder.mutate(path.trim(), {
              onSuccess: project => { void api.meta().then(meta => store.setMeta(meta)); store.setScope({ projectId: project.projectId, workspaceId: project.workspaceId }); store.openView('files'); onClose(); },
              onError: failure => setError(failure.message),
            });
          }} data-testid="add-project">添加并打开</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function Rail(props: ViewProps & { onNewGoal: () => void; onAddProject: () => void; onOpenSettings: () => void; onClose?: () => void }) {
  const { data, store, onNewGoal, onAddProject, onOpenSettings } = props;
  const state = useAppState();
  const goals = (data?.goals ?? []).filter(view => view.status === 'ready').map(view => view.goal);
  const agents = data?.agents.status === 'ready' ? data.agents.agents.rows : [];
  const active = agents.filter(run => run.displayState === 'ongoing' || run.displayState === 'starting');
  return (
    <Stack gap="xs" h="100%" className="rail" p="xs" component="nav" aria-label="项目与目标" data-testid="project-rail">
      <Group gap={4} wrap="nowrap">
        <Select
          size="xs" style={{ flex: 1 }} aria-label="切换项目" value={state.scope?.projectId ?? ''} data-testid="project-select"
          data={(state.meta?.scopes ?? []).filter((entry, index, scopes) => scopes.findIndex(item => item.projectId === entry.projectId) === index).map(entry => ({ value: entry.projectId, label: entry.name ?? entry.projectId }))}
          onChange={value => { const entry = state.meta?.scopes.find(item => item.projectId === value); if (entry) store.setScope({ projectId: entry.projectId, workspaceId: entry.workspaceId }); }}
        />
        <Tooltip label="添加项目文件夹"><Button size="compact-xs" variant="light" onClick={onAddProject} aria-label="添加项目文件夹">＋</Button></Tooltip>
      </Group>
      {(state.meta?.scopes.filter(entry => entry.projectId === state.scope?.projectId).length ?? 0) > 1 ? <Select size="xs" label="工作区" value={state.scope?.workspaceId ?? ''} data-testid="workspace-select"
        data={(state.meta?.scopes ?? []).filter(entry => entry.projectId === state.scope?.projectId).map(entry => ({ value: entry.workspaceId, label: entry.name + ' · ' + entry.workspaceId }))}
        onChange={value => { const entry = state.meta?.scopes.find(item => item.projectId === state.scope?.projectId && item.workspaceId === value); if (entry) store.setScope(entry); }} /> : null}
      <Group gap={4}><Button size="xs" variant="light" fullWidth onClick={onNewGoal} data-testid="new-goal">＋ 新建目标</Button></Group>
      <Text size="xs" c="dimmed" mt={4}>项目会话</Text>
      <Box style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <Stack gap={2} role="list">
          {goals.map(goal => (
            <Button
              key={goal.goalId} variant={goal.goalId === data?.goalId ? 'light' : 'subtle'} justify="flex-start" size="compact-sm"
              role="listitem" aria-current={goal.goalId === data?.goalId ? 'page' : undefined} onClick={() => store.setGoal(goal.goalId)} data-testid={'goal-' + goal.goalId}
            >
              <Text size="xs" truncate>{goal.objective}</Text>
            </Button>
          ))}
          {!goals.length ? <Text size="xs" c="dimmed">还没有目标</Text> : null}
        </Stack>
      </Box>
      <Divider />
      <Stack gap={2}>
        <Group justify="space-between"><Text size="xs" c="dimmed">活跃 Agent</Text><Text size="xs">{active.length}</Text></Group>
        {active.slice(0, 3).map(run => (
          <Group key={run.runRef.runId} gap={4} wrap="nowrap"><Text size="xs" c={statusTone(run.displayState)}>●</Text><Text size="xs" truncate>{run.taskId} · {runLabels[run.displayState]}</Text></Group>
        ))}
        {!active.length ? <Text size="xs" c="dimmed">当前没有运行中的 Agent</Text> : null}
      </Stack>
      <Divider />
      <Group gap={4} justify="space-between">
        <Button size="compact-xs" variant="subtle" onClick={onOpenSettings} data-testid="open-settings">设置</Button>
        <Button size="compact-xs" variant="subtle" onClick={() => store.openView('activity')}>动态</Button>
      </Group>
    </Stack>
  );
}

function Shell() {
  const store = useAppStore();
  const state = useAppState();
  const metaQuery = useMeta(useMemo(() => createApi(''), []));
  const [goalDialog, setGoalDialog] = useState(false);
  const [projectDialog, setProjectDialog] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [viewport, setViewport] = useState(() => window.innerWidth);
  const [rightOpen, setRightOpen] = useState(true);
  const narrow = useMediaQuery('(max-width: 1024px)');

  // The token only exists after /api/meta; a token-less client is used for that one call.
  const api = useMemo(() => createApi(state.meta?.workspaceToken ?? ''), [state.meta?.workspaceToken]);

  useEffect(() => {
    if (metaQuery.data) store.setMeta(metaQuery.data);
  }, [metaQuery.data, store]);

  // Narrow viewports fold the workbench first; the centre column keeps its space.
  useEffect(() => { if (narrow) setRightOpen(false); }, [narrow]);

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Restore the URL scope once meta is known.
  useEffect(() => {
    if (!state.meta || !state.scope) return;
    const params = new URLSearchParams(location.search);
    const projectId = params.get('projectId'), workspaceId = params.get('workspaceId'), goalId = params.get('goalId');
    const entry = state.meta.scopes.find(item => item.projectId === projectId && (workspaceId === null || item.workspaceId === workspaceId));
    if (entry && (entry.projectId !== state.scope.projectId || entry.workspaceId !== state.scope.workspaceId || (goalId && goalId !== state.goalId))) store.setScope({ projectId: entry.projectId, workspaceId: entry.workspaceId }, goalId ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.meta]);

  useEffect(() => {
    if (!state.scope) return;
    const params = new URLSearchParams({ projectId: state.scope.projectId, workspaceId: state.scope.workspaceId });
    if (state.goalId) params.set('goalId', state.goalId);
    params.set('view', state.layout.activeTab);
    history.replaceState(null, '', '?' + params.toString());
  }, [state.scope, state.goalId, state.layout.activeTab]);

  const scope = state.scope;
  const gui = useGuiState(api, scope, state.goalId);

  // Adopt the server-selected goal (first goal of the scope) when none is chosen.
  useEffect(() => {
    if (gui.data?.goalId && !state.goalId) store.setGoal(gui.data.goalId);
  }, [gui.data?.goalId, state.goalId, store]);

  const refresh = useCallback(() => { void gui.refetch(); }, [gui]);
  const viewProps: ViewProps = {
    api, data: gui.data, loading: gui.isLoading, error: gui.error ? (gui.error as Error).message : null,
    store, scope, goalScope: scope && state.goalId ? { ...scope, goalId: state.goalId } : null, refresh, tab: null,
  };

  const widths = useMemo(() => {
    const left = state.layout.left;
    const right = rightOpen && !narrow ? state.layout.right : 0;
    const available = viewport - (right ? right + 6 : 0) - 6;
    return { left: Math.min(left, Math.max(160, available - MIN_CENTER_WIDTH)), right };
  }, [state.layout.left, state.layout.right, rightOpen, narrow, viewport]);

  if (metaQuery.isLoading && !state.meta) return <Box p="xl"><LoadingState label="正在连接本地服务…" /></Box>;
  if (metaQuery.error) return <Box p="xl"><ErrorState title="无法连接本地服务" message={(metaQuery.error as Error).message} action={<Button size="xs" onClick={() => void metaQuery.refetch()}>重试</Button>} /></Box>;

  return (
    <Box className="app" data-testid="app" data-theme={state.layout.theme}>
        <Group className="topbar" px="sm" py={4} gap="xs" wrap="nowrap">
          <Button size="compact-xs" variant="subtle" className="narrow-only" onClick={() => setRailOpen(value => !value)} aria-label="展开项目列表" data-testid="toggle-rail">☰</Button>
          <Text size="sm" fw={600}>Agent Platform 工作台</Text>
          <Text size="xs" c="dimmed">{scope ? (state.meta?.scopes.find(entry => entry.projectId === scope.projectId && entry.workspaceId === scope.workspaceId)?.root ?? scope.projectId) : '未选择项目'}</Text>
          <Box style={{ flex: 1 }} />
          {gui.isFetching ? <Text size="xs" c="dimmed" data-testid="syncing">正在同步…</Text> : <Text size="xs" c="dimmed">已连接 · 本地服务</Text>}
          <Button size="compact-xs" variant="subtle" onClick={() => store.setTheme(state.layout.theme === 'dark' ? 'light' : 'dark')} aria-label="切换明暗主题" data-testid="toggle-theme">{state.layout.theme === 'dark' ? '☀' : '☾'}</Button>
          <Button size="compact-xs" variant="subtle" onClick={refresh} aria-label="刷新项目状态" data-testid="refresh">刷新</Button>
        </Group>

        <Box className="panes" style={{ gridTemplateColumns: (narrow ? 'minmax(0,1fr)' : widths.left + 'px 6px minmax(0,1fr) ' + (rightOpen ? '6px ' + widths.right + 'px' : '0 0')) }}>
          {!narrow ? (
            <>
              <Rail {...viewProps} onNewGoal={() => setGoalDialog(true)} onAddProject={() => setProjectDialog(true)} onOpenSettings={() => store.openView('settings')} />
              <Resizer orientation="vertical" label="调整左侧项目栏宽度" value={widths.left} min={160} max={380} onChange={value => store.updateLayout({ left: value }, false)} onCommit={value => store.updateLayout({ left: value })} onReset={() => store.updateLayout({ left: 240 })} />
            </>
          ) : null}
          <Box className="center" data-testid="center">
            {gui.error && !gui.data ? <ErrorState message={(gui.error as Error).message} action={<Button size="xs" onClick={refresh}>重试</Button>} /> : null}
            <ConversationHost props={viewProps} />
          </Box>
          {!narrow && rightOpen ? (
            <>
              <Resizer orientation="vertical" label="调整右侧工作台宽度" invert value={widths.right} min={260} max={Math.max(300, viewport - widths.left - MIN_CENTER_WIDTH - 12)} onChange={value => store.updateLayout({ right: value }, false)} onCommit={value => store.updateLayout({ right: value })} onReset={() => store.updateLayout({ right: 440 })} />
              <RightWorkbench {...viewProps} viewport={viewport} rightOpen={rightOpen} onToggle={() => setRightOpen(false)} />
            </>
          ) : null}
          {narrow && rightOpen ? (
            <Box className="drawer-right">
              <RightWorkbench {...viewProps} viewport={viewport} rightOpen={rightOpen} onToggle={() => setRightOpen(false)} />
            </Box>
          ) : null}
        </Box>

        {state.layout.bottomOpen ? <BottomResizer value={state.layout.bottom} viewport={viewport} onHeight={value => store.updateLayout({ bottom: value })} /> : null}
        <BottomDock {...viewProps} onToggle={() => store.updateLayout({ bottomOpen: !state.layout.bottomOpen })} onHeight={value => store.updateLayout({ bottom: value })} />

        {narrow && !rightOpen ? <Button className="floating-dock" size="xs" onClick={() => { setRightOpen(true); setRailOpen(false); }} data-testid="open-dock">打开工作台</Button> : null}
        {narrow && railOpen ? (
          <Box className="drawer-left"><Rail {...viewProps} onNewGoal={() => { setGoalDialog(true); setRailOpen(false); }} onAddProject={() => { setProjectDialog(true); setRailOpen(false); }} onOpenSettings={() => { store.openView('settings'); setRailOpen(false); }} onClose={() => setRailOpen(false)} /></Box>
        ) : null}
        {!rightOpen && !narrow ? <Button className="floating-dock" size="xs" variant="light" onClick={() => setRightOpen(true)} data-testid="open-dock">打开工作台</Button> : null}
        <GoalDialog open={goalDialog} onClose={() => setGoalDialog(false)} />
        <AddProjectDialog open={projectDialog} onClose={() => setProjectDialog(false)} />
      <Notices />
    </Box>
  );
}

function ConversationHost({ props }: { props: ViewProps }) {
  const Component = VIEW_REGISTRY_CONVERSATION;
  return <Component {...props} tab={null} />;
}

import { ConversationView } from './features/conversation';
const VIEW_REGISTRY_CONVERSATION = ConversationView;

export function App() {
  const store = useMemo(() => new AppStore(typeof localStorage === 'undefined' ? null : localStorage), []);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return (
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={mantineTheme} defaultColorScheme="auto" forceColorScheme={state.layout.theme === 'auto' ? undefined : state.layout.theme}>
        <StoreProvider store={store}>
          <Shell />
        </StoreProvider>
      </MantineProvider>
    </QueryClientProvider>
  );
}
