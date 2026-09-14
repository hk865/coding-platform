/**
 * Workbench layout: which views are open, how wide the panes are, and where the
 * bottom tool area sits.
 *
 * Layout is display state and lives in the browser under a versioned, scoped key.
 * Nothing here is a business fact: restoring a layout never restores a task.
 */
import type { Scope } from '../api/types';

export const LAYOUT_VERSION = 2;
export const LAYOUT_KEY_PREFIX = 'agent-platform.workbench.v2';
export const MIN_CENTER_WIDTH = 280;
export const DEFAULT_LEFT = 240;
export const DEFAULT_RIGHT = 440;
export const DEFAULT_BOTTOM = 240;

export type Placement = 'right' | 'bottom';

export type ViewId =
  | 'conversation' | 'files' | 'file' | 'diff' | 'tasks' | 'task-graph' | 'agents' | 'verification'
  | 'activity' | 'settings' | 'exploration' | 'terminal' | 'logs' | 'architecture' | 'reviewer' | 'memory' | 'continuation' | 'rework' | 'plan-changes';

export type TabPayload = { path?: string; lines?: { start: number; end: number } | undefined; runId?: string; taskId?: string };

export type Tab = { id: string; view: ViewId; title: string; pinned: boolean; payload: TabPayload };

export type ThemePreference = 'light' | 'dark' | 'auto';

export type LayoutState = {
  version: number;
  left: number;
  right: number;
  bottom: number;
  bottomOpen: boolean;
  tabs: Tab[];
  activeTab: string;
  bottomTab: string;
  theme: ThemePreference;
};

export const VIEW_DEFS: Record<ViewId, { title: string; placement: Placement; scope: 'workspace' | 'goal' | 'global'; singleton: boolean }> = {
  conversation: { title: '主对话', placement: 'right', scope: 'goal', singleton: true },
  files: { title: '文件', placement: 'right', scope: 'workspace', singleton: true },
  file: { title: '文件预览', placement: 'right', scope: 'workspace', singleton: false },
  diff: { title: '差异', placement: 'right', scope: 'goal', singleton: true },
  tasks: { title: '任务', placement: 'right', scope: 'goal', singleton: true },
  'task-graph': { title: '任务图', placement: 'right', scope: 'goal', singleton: true },
  agents: { title: 'Agent', placement: 'right', scope: 'goal', singleton: true },
  verification: { title: '检查与验证', placement: 'right', scope: 'goal', singleton: true },
  activity: { title: '动态', placement: 'right', scope: 'goal', singleton: true },
  exploration: { title: '只读探索', placement: 'right', scope: 'goal', singleton: true },
  settings: { title: '设置', placement: 'right', scope: 'global', singleton: true },
  architecture: { title: '架构', placement: 'right', scope: 'goal', singleton: true },
  reviewer: { title: 'Reviewer', placement: 'right', scope: 'goal', singleton: true },
  memory: { title: '记忆与规则', placement: 'right', scope: 'goal', singleton: true },
  continuation: { title: '任务续跑', placement: 'right', scope: 'goal', singleton: true },
  rework: { title: '返工与问题', placement: 'right', scope: 'goal', singleton: true },
  // RW-09：受理结果的可见性。它是独立可读的区块（谁受理了什么），不并入返工面板。
  'plan-changes': { title: '计划变更', placement: 'right', scope: 'goal', singleton: true },
  terminal: { title: '终端', placement: 'bottom', scope: 'workspace', singleton: true },
  logs: { title: '运行日志', placement: 'bottom', scope: 'goal', singleton: true },
};

export const DEFAULT_TABS: Tab[] = [
  { id: 'tasks', view: 'tasks', title: '任务', pinned: false, payload: {} },
  { id: 'files', view: 'files', title: '文件', pinned: false, payload: {} },
  { id: 'agents', view: 'agents', title: 'Agent', pinned: false, payload: {} },
  { id: 'verification', view: 'verification', title: '检查与验证', pinned: false, payload: {} },
];

export function layoutKey(scope: Scope): string {
  return `${LAYOUT_KEY_PREFIX}::${encodeURIComponent(scope.projectId)}::${encodeURIComponent(scope.workspaceId)}`;
}

export function defaultLayout(): LayoutState {
  return {
    version: LAYOUT_VERSION,
    left: DEFAULT_LEFT,
    right: DEFAULT_RIGHT,
    bottom: DEFAULT_BOTTOM,
    bottomOpen: false,
    tabs: DEFAULT_TABS.map(tab => ({ ...tab, payload: {} })),
    activeTab: 'tasks',
    bottomTab: 'terminal',
    theme: 'auto',
  };
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(Math.max(Math.round(number), min), Math.max(min, max));
}

/**
 * Pane widths for a viewport. The centre column keeps at least MIN_CENTER_WIDTH;
 * the side panes give way before the centre does, and a pane that cannot fit
 * collapses to its minimum instead of pushing the centre off screen.
 */
export function clampPaneWidths(input: { left: number; right: number; viewport: number; rightOpen: boolean; minCenter?: number }): { left: number; right: number } {
  const minCenter = input.minCenter ?? MIN_CENTER_WIDTH;
  const minLeft = 160, minRight = 260;
  let left = clampNumber(input.left, minLeft, 380, DEFAULT_LEFT);
  let right = input.rightOpen ? clampNumber(input.right, minRight, 900, DEFAULT_RIGHT) : 0;
  const available = input.viewport - minCenter - (input.rightOpen ? 12 : 0);
  if (left + right > available) {
    const overflow = left + right - available;
    const rightGive = input.rightOpen ? Math.min(overflow, Math.max(0, right - minRight)) : 0;
    right -= rightGive;
    const remaining = overflow - rightGive;
    if (remaining > 0) left = Math.max(minLeft, left - remaining);
  }
  return { left, right };
}

export function parseLayout(raw: string | null): { state: LayoutState; dropped: string[] } {
  const base = defaultLayout();
  if (!raw) return { state: base, dropped: [] };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { state: base, dropped: ['已保存的布局无法解析，已恢复默认布局'] }; }
  if (!parsed || typeof parsed !== 'object') return { state: base, dropped: ['已保存的布局格式无效，已恢复默认布局'] };
  const value = parsed as Partial<LayoutState> & { version?: number };
  if (value.version !== LAYOUT_VERSION) return { state: base, dropped: ['布局版本已更新，已恢复默认布局'] };
  const dropped: string[] = [];
  const seen = new Set<string>();
  const tabs: Tab[] = [];
  for (const candidate of Array.isArray(value.tabs) ? value.tabs : []) {
    if (!candidate || typeof candidate !== 'object') continue;
    const tab = candidate as Tab;
    const definition = VIEW_DEFS[tab.view];
    if (!definition || definition.placement !== 'right') { dropped.push(`未知视图：${String(tab.view)}`); continue; }
    if (typeof tab.id !== 'string' || seen.has(tab.id)) { dropped.push('重复的标签已忽略'); continue; }
    if (tab.view === 'file' && (typeof tab.payload?.path !== 'string' || !tab.payload.path)) { dropped.push('文件标签缺少路径'); continue; }
    seen.add(tab.id);
    tabs.push({ id: tab.id, view: tab.view, title: typeof tab.title === 'string' && tab.title ? tab.title : definition.title, pinned: tab.pinned === true, payload: tab.payload && typeof tab.payload === 'object' ? tab.payload : {} });
  }
  if (!tabs.length) tabs.push(...DEFAULT_TABS.map(tab => ({ ...tab, payload: {} })));
  const activeTab = tabs.some(tab => tab.id === value.activeTab) ? String(value.activeTab) : tabs[0]!.id;
  const bottomTab = VIEW_DEFS[value.bottomTab as ViewId]?.placement === 'bottom' ? String(value.bottomTab) : 'terminal';
  return {
    state: {
      version: LAYOUT_VERSION,
      left: clampNumber(value.left, 160, 380, DEFAULT_LEFT),
      right: clampNumber(value.right, 260, 900, DEFAULT_RIGHT),
      bottom: clampNumber(value.bottom, 140, 640, DEFAULT_BOTTOM),
      bottomOpen: value.bottomOpen === true,
      tabs, activeTab, bottomTab,
      theme: value.theme === 'light' || value.theme === 'dark' ? value.theme : 'auto',
    },
    dropped,
  };
}

export function serializeLayout(state: LayoutState): string {
  return JSON.stringify({ ...state, version: LAYOUT_VERSION });
}

export function nextFileTabId(tabs: Tab[]): string {
  let index = 1;
  const used = new Set(tabs.map(tab => tab.id));
  while (used.has(`file-${index}`)) index += 1;
  return `file-${index}`;
}
