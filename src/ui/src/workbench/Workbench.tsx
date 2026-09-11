import { ActionIcon, Box, Button, Group, Menu, Text, Tooltip } from '@mantine/core';
import { Suspense, useRef } from 'react';
import { Resizer } from '../components/Resizer';
import { VIEW_DEFS, type Tab, type ViewId } from '../state/layout';
import { useAppStore, useAppState } from '../state/app-store';
import { VIEW_REGISTRY } from './registry';
import type { ViewProps } from './view-props';

function ViewHost({ tab, props }: { tab: Tab; props: ViewProps }) {
  const Component = VIEW_REGISTRY[tab.view];
  if (!Component) return <Text size="xs" c="dimmed" p="sm">未知视图：{tab.view}</Text>;
  return <Suspense fallback={<Text size="xs" c="dimmed" p="sm">正在加载视图…</Text>}><Component {...props} tab={tab} /></Suspense>;
}

export function RightWorkbench(props: ViewProps & { viewport: number; rightOpen: boolean; onToggle: () => void }) {
  const store = useAppStore();
  const state = useAppState();
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const { layout } = state;
  const activeTab = layout.tabs.find(tab => tab.id === layout.activeTab) ?? layout.tabs[0] ?? null;

  const selectTab = (id: string) => { store.setActiveTab(id); };
  const closeTab = (id: string) => {
    const tab = layout.tabs.find(item => item.id === id);
    if (tab?.pinned) return;
    store.closeTab(id);
  };

  return (
    <Box className="right-workbench" data-testid="right-workbench">
      <Group className="tab-strip" gap={2} wrap="nowrap" px={6} py={4} ref={tabsRef} role="tablist" aria-label="工作台视图"
        onKeyDown={event => {
          const index = layout.tabs.findIndex(tab => tab.id === layout.activeTab);
          const keys: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
          if (event.key === 'Home') { event.preventDefault(); store.setActiveTab(layout.tabs[0]!.id); return; }
          if (event.key === 'End') { event.preventDefault(); store.setActiveTab(layout.tabs.at(-1)!.id); return; }
          const delta = keys[event.key];
          if (delta === undefined) return;
          event.preventDefault();
          const next = layout.tabs[(index + delta + layout.tabs.length) % layout.tabs.length];
          if (next) store.setActiveTab(next.id);
        }}
      >
        <Group gap={2} wrap="nowrap" style={{ overflowX: 'auto', flex: 1, minWidth: 0 }}>
          {layout.tabs.map(tab => (
            <Group key={tab.id} gap={0} wrap="nowrap" className={'dock-tab' + (tab.id === layout.activeTab ? ' selected' : '') + (tab.pinned ? ' pinned' : '')} data-tab-id={tab.id} data-tab-view={tab.view}>
              <Button
                variant="subtle" size="compact-xs" role="tab" aria-selected={tab.id === layout.activeTab} tabIndex={tab.id === layout.activeTab ? 0 : -1}
                onClick={() => selectTab(tab.id)} data-testid={'tab-' + tab.view}
              >
                {tab.title}{tab.pinned ? ' · 固定' : ''}
              </Button>
              <Tooltip label={tab.pinned ? '取消固定' : '固定标签'}>
                <ActionIcon size="xs" aria-label={(tab.pinned ? '取消固定 ' : '固定 ') + tab.title} onClick={() => store.togglePin(tab.id)}>{tab.pinned ? '★' : '☆'}</ActionIcon>
              </Tooltip>
              <ActionIcon size="xs" aria-label={'关闭 ' + tab.title} disabled={tab.pinned} onClick={() => closeTab(tab.id)} data-testid={'close-' + tab.view}>×</ActionIcon>
            </Group>
          ))}
        </Group>
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <Button size="compact-xs" variant="light" data-testid="add-view" aria-label="打开视图">＋ 视图</Button>
          </Menu.Target>
          <Menu.Dropdown>
            {Object.entries(VIEW_DEFS).filter(([id, definition]) => definition.placement === 'right' && id !== 'file').map(([id, definition]) => (
              <Menu.Item key={id} onClick={() => store.openView(id as ViewId)} data-testid={'open-' + id}>
                {definition.title}{layout.tabs.some(tab => tab.view === id) ? ' · 已打开' : ''}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
        <Tooltip label="收起工作台"><ActionIcon aria-label="收起工作台" onClick={props.onToggle} data-testid="toggle-right">⟩</ActionIcon></Tooltip>
      </Group>
      <Box className="workbench-body" style={{ minHeight: 0, overflow: 'hidden' }}>
        {activeTab ? <ViewHost tab={activeTab} props={props} /> : null}
      </Box>
    </Box>
  );
}

export function BottomDock(props: ViewProps & { onToggle: () => void; onHeight: (height: number) => void }) {
  const store = useAppStore();
  const { layout } = useAppState();
  const tabs: Array<{ id: ViewId; title: string }> = [
    { id: 'terminal', title: '终端' },
    { id: 'logs', title: '运行日志' },
  ];
  const active = tabs.find(tab => tab.id === layout.bottomTab) ?? tabs[0]!;
  const tab: Tab = { id: active.id, view: active.id, title: active.title, pinned: false, payload: props.tab?.payload ?? {} };
  return (
    <Box className="bottom-dock" data-testid="bottom-dock" data-open={layout.bottomOpen}>
      <Group className="dock-head" px="sm" py={2} gap="xs" wrap="nowrap">
        <Group gap={2} role="tablist" aria-label="底部工具">
          {tabs.map(item => (
            <Button key={item.id} size="compact-xs" variant={item.id === active.id ? 'light' : 'subtle'} role="tab" aria-selected={item.id === active.id} onClick={() => store.setBottomTab(item.id)} data-testid={'bottom-tab-' + item.id}>{item.title}</Button>
          ))}
        </Group>
        <Box style={{ flex: 1 }} />
        <Text size="xs" c="dimmed">{layout.bottomOpen ? '拖动上边缘调整高度；折叠不会终止终端会话' : '已折叠 · 后台会话继续运行'}</Text>
        <Button size="compact-xs" variant="subtle" onClick={props.onToggle} data-testid="toggle-bottom">{layout.bottomOpen ? '收起' : '展开'}</Button>
      </Group>
      {layout.bottomOpen ? (
        <Box className="dock-body" style={{ height: layout.bottom - 30, minHeight: 0 }}>
          <ViewHost tab={tab} props={props} />
        </Box>
      ) : null}
    </Box>
  );
}

export function BottomResizer({ onHeight, value, viewport }: { onHeight: (value: number) => void; value: number; viewport: number }) {
  return <Resizer orientation="horizontal" label="调整底部工具区高度" value={value} min={140} max={Math.max(200, Math.floor(viewport * 0.6))} onChange={onHeight} onCommit={onHeight} />;
}

