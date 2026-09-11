import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { GoalScope, Meta, ProjectEntry, RequestReference, Scope } from '../api/types';
import { clampPaneWidths, defaultLayout, layoutKey, nextFileTabId, parseLayout, serializeLayout, VIEW_DEFS, type LayoutState, type Tab, type TabPayload, type ThemePreference, type ViewId } from './layout';
import { emptyDraft, goalKey, readDrafts, scopeKey, upsertReference, writeDrafts, type DraftMap, type DraftState } from './drafts';
import { PendingStore, type PendingKind, type PendingRecord } from './pending';

export type Notice = { id: number; tone: 'info' | 'success' | 'warning' | 'error'; text: string; detail?: string };

type Listener = () => void;

/**
 * Display-layer state: current scope, workbench layout, drafts and notices.
 * Business facts always come from the server queries; nothing here is persisted
 * back to the ledger.
 */
export class AppStore {
  /** Logical requests whose formal receipt has not arrived yet (survives reload). */
  readonly pending: PendingStore;
  private listeners = new Set<Listener>();
  private state: {
    meta: Meta | null;
    scope: Scope | null;
    goalId: string;
    layout: LayoutState;
    droppedTabs: string[];
    drafts: DraftMap;
    notices: Notice[];
    generation: number;
  };

  constructor(private readonly storage: Storage | null) {
    this.pending = new PendingStore(storage);
    const initialLayout = defaultLayout();
    initialLayout.theme = this.readTheme();
    this.state = { meta: null, scope: null, goalId: '', layout: initialLayout, droppedTabs: [], drafts: storage ? readDrafts(storage) : {}, notices: [], generation: 0 };
  }

  private readTheme(): ThemePreference {
    try { const raw = this.storage?.getItem('agent-platform.workbench.theme.v2'); if (raw === 'light' || raw === 'dark' || raw === 'auto') return raw; } catch { /* storage unavailable */ }
    return 'auto';
  }

  subscribe = (listener: Listener): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private emit(patch: Partial<AppStore['state']>): void { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }

  setMeta(meta: Meta): void {
    const scope = this.state.scope && meta.scopes.some(entry => entry.projectId === this.state.scope?.projectId && entry.workspaceId === this.state.scope?.workspaceId)
      ? this.state.scope
      : meta.scopes[0] ?? null;
    this.emit({ meta, scope });
    if (scope) this.setScope(scope, this.state.goalId);
  }

  setScope(scope: Scope, goalId = ''): void {
    const current = this.state.scope;
    if (current && current.projectId === scope.projectId && current.workspaceId === scope.workspaceId && this.state.goalId === goalId) return;
    const { state, dropped } = this.restoreLayout(scope);
    this.emit({ scope: { ...scope }, goalId, layout: state, droppedTabs: dropped, generation: this.state.generation + 1 });
  }

  private restoreLayout(scope: Scope): { state: LayoutState; dropped: string[] } {
    const raw = this.storage?.getItem(layoutKey(scope)) ?? null;
    const parsed = parseLayout(raw);
    const theme = this.state.layout.theme;
    return { state: { ...parsed.state, theme }, dropped: parsed.dropped };
  }

  setGoal(goalId: string): void { if (this.state.goalId === goalId) return; this.emit({ goalId, generation: this.state.generation + 1 }); }

  updateLayout(patch: Partial<LayoutState>, persist = true): void {
    const layout = { ...this.state.layout, ...patch };
    this.emit({ layout });
    if (persist) this.persistLayout(layout);
  }

  private persistLayout(layout: LayoutState): void {
    const scope = this.state.scope;
    if (!scope || !this.storage) return;
    try { this.storage.setItem(layoutKey(scope), serializeLayout(layout)); } catch { /* storage full or unavailable */ }
  }

  openView(view: ViewId, payload: TabPayload = {}, title?: string): void {
    const definition = VIEW_DEFS[view];
    if (!definition || definition.placement !== 'right') return;
    const { layout } = this.state;
    if (definition.singleton && layout.tabs.some(tab => tab.view === view)) {
      const existing = layout.tabs.find(tab => tab.view === view)!;
      this.updateLayout({ activeTab: existing.id, tabs: layout.tabs.map(tab => tab.id === existing.id ? { ...tab, payload: { ...tab.payload, ...payload } } : tab) });
      return;
    }
    const tab: Tab = { id: definition.singleton ? view : nextFileTabId(layout.tabs), view, title: title ?? definition.title, pinned: false, payload };
    this.updateLayout({ tabs: [...layout.tabs, tab], activeTab: tab.id });
  }

  openFile(path: string, lines?: { start: number; end: number }): void {
    const { layout } = this.state;
    const existing = layout.tabs.find(tab => tab.view === 'file' && tab.payload.path === path);
    if (existing) { this.updateLayout({ activeTab: existing.id, tabs: layout.tabs.map(tab => tab.id === existing.id ? { ...tab, payload: { ...tab.payload, ...(lines ? { lines } : {}) } } : tab) }); return; }
    const tab: Tab = { id: nextFileTabId(layout.tabs), view: 'file', title: path.split('/').pop() ?? path, pinned: false, payload: { path, ...(lines ? { lines } : {}) } };
    this.updateLayout({ tabs: [...layout.tabs, tab], activeTab: tab.id });
  }

  closeTab(id: string): void {
    const { layout } = this.state;
    const index = layout.tabs.findIndex(tab => tab.id === id);
    if (index < 0) return;
    const tabs = layout.tabs.filter(tab => tab.id !== id);
    const next = tabs.length ? tabs : defaultLayout().tabs;
    const activeTab = layout.activeTab === id ? (next[Math.min(index, next.length - 1)]?.id ?? next[0]!.id) : layout.activeTab;
    this.updateLayout({ tabs: next, activeTab });
  }

  togglePin(id: string): void { this.updateLayout({ tabs: this.state.layout.tabs.map(tab => tab.id === id ? { ...tab, pinned: !tab.pinned } : tab) }); }
  setActiveTab(id: string): void { this.updateLayout({ activeTab: id }); }
  setBottomTab(id: string): void { this.updateLayout({ bottomTab: id, bottomOpen: true }); }
  setTheme(theme: ThemePreference): void { this.updateLayout({ theme }, false); try { this.storage?.setItem('agent-platform.workbench.theme.v2', theme); } catch { /* ignore */ } }
  restoreTheme(): ThemePreference { return this.state.layout.theme; }

  setWidths(input: { left?: number; right?: number; viewport: number; rightOpen: boolean }): void {
    const clamped = clampPaneWidths({ left: input.left ?? this.state.layout.left, right: input.right ?? this.state.layout.right, viewport: input.viewport, rightOpen: input.rightOpen });
    this.updateLayout(clamped);
  }

  resetLayout(): void {
    const fresh = defaultLayout();
    fresh.theme = this.state.layout.theme;
    this.emit({ layout: fresh, droppedTabs: [] });
    this.persistLayout(fresh);
  }

  /** Drops restored file tabs whose path no longer resolves; the reason stays visible. */
  invalidateTab(id: string, reason: string): void {
    const tab = this.state.layout.tabs.find(item => item.id === id);
    if (!tab) return;
    const tabs = this.state.layout.tabs.filter(item => item.id !== id);
    this.emit({ layout: { ...this.state.layout, tabs: tabs.length ? tabs : defaultLayout().tabs }, droppedTabs: [...this.state.droppedTabs, `${tab.title}：${reason}`] });
  }

  draft(scope: GoalScope | null): DraftState { return (scope && this.state.drafts[goalKey(scope)]) || emptyDraft(); }

  updateDraft(scope: GoalScope, patch: Partial<DraftState>): void {
    const key = goalKey(scope);
    const drafts = { ...this.state.drafts, [key]: { ...this.draft(scope), ...patch } };
    this.emit({ drafts });
    if (this.storage) writeDrafts(this.storage, drafts);
  }

  addReference(scope: GoalScope, reference: RequestReference): { ok: boolean; message: string } {
    const draft = this.draft(scope);
    const result = upsertReference(draft.references, reference);
    if (result.overflow) return { ok: false, message: '一个任务最多引用 8 个文件。' };
    this.updateDraft(scope, { references: result.references });
    return { ok: true, message: result.replaced ? '引用已更新为当前版本。' : '文件已加入当前任务草稿。' };
  }

  removeReference(scope: GoalScope, path: string): void { this.updateDraft(scope, { references: this.draft(scope).references.filter(item => item.path !== path) }); }
  clearDraft(scope: GoalScope): void { this.updateDraft(scope, emptyDraft()); }

  /** Remember the terminal session per scope so a reload reattaches to it. */
  getTerminalSession(scope: Scope | null): string {
    if (!scope || !this.storage) return '';
    try { return this.storage.getItem('agent-platform.workbench.terminal.v2::' + scopeKey(scope)) ?? ''; } catch { return ''; }
  }
  setTerminalSession(scope: Scope | null, sessionId: string): void {
    if (!scope || !this.storage) return;
    try {
      const key = 'agent-platform.workbench.terminal.v2::' + scopeKey(scope);
      if (sessionId) this.storage.setItem(key, sessionId); else this.storage.removeItem(key);
    } catch { /* storage unavailable */ }
  }

  /** Claim/reuse the requestId of one logical operation (see state/pending.ts). */
  async beginRequest(scope: GoalScope, kind: PendingKind, payload: unknown): Promise<{ requestId: string; replayed: boolean; replaced: string | null }> {
    const claim = await this.pending.begin(scope, kind, payload);
    this.emit({});
    return claim;
  }

  /** A formal receipt arrived: this logical request is over. */
  settleRequest(scope: GoalScope, kind: PendingKind, requestId: string): void {
    if (this.pending.settle(scope, kind, requestId)) this.emit({});
  }

  pendingRequests(scope: GoalScope): PendingRecord[] { return this.pending.list(scope); }

  notify(tone: Notice['tone'], text: string, detail?: string): number {
    const id = Date.now() + Math.random();
    this.emit({ notices: [...this.state.notices.slice(-3), { id, tone, text, ...(detail ? { detail } : {}) }] });
    return id;
  }
  dismissNotice(id: number): void { this.emit({ notices: this.state.notices.filter(notice => notice.id !== id) }); }
}

const StoreContext = createContext<AppStore | null>(null);

export function StoreProvider({ storage, store, children }: { storage?: Storage | null; store?: AppStore; children: ReactNode }) {
  const ref = useRef<AppStore | null>(null);
  if (!ref.current) ref.current = store ?? new AppStore(storage ?? null);
  return <StoreContext.Provider value={ref.current}>{children}</StoreContext.Provider>;
}

export function useAppStore(): AppStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('AppStore 未初始化');
  return store;
}

export function useAppState() {
  const store = useAppStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useScope(): Scope | null { return useAppState().scope; }
export function useGoalScope(): GoalScope | null {
  const state = useAppState();
  if (!state.scope || !state.goalId) return null;
  return { ...state.scope, goalId: state.goalId };
}

/** Generation counter used to ignore responses that belong to a previous scope. */
export function useScopeGeneration(): number { return useAppState().generation; }

export function useProjectEntry(): ProjectEntry | null {
  const state = useAppState();
  return state.meta?.scopes.find(entry => entry.projectId === state.scope?.projectId && entry.workspaceId === state.scope?.workspaceId) ?? null;
}

export function useNotices() {
  const store = useAppStore();
  const { notices } = useAppState();
  const dismiss = useCallback((id: number) => store.dismissNotice(id), [store]);
  return useMemo(() => ({ notices, dismiss }), [notices, dismiss]);
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const handler = () => setMatches(list.matches);
    list.addEventListener('change', handler);
    setMatches(list.matches);
    return () => list.removeEventListener('change', handler);
  }, [query]);
  return matches;
}
