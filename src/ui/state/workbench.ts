/** The page's workbench store: selection, bootstrap, scopes, view, render memory and the `render` intent. */

import type { BootstrapResponse, BootstrapWorkspace, SessionRef } from '../../app/core-http-types.js';
import type { ScopeState } from './scope-state.js';
import { createStore } from './store.js';
import type { Store } from './store.js';
import { scopeKey } from './values.js';

/** Display-only layout state (widths, panels, graph modes, expanded projects, theme). */
export type ViewState = {
  leftWidth: number; rightWidth: number; savedRightWidth: number;
  auxVisible: boolean; auxExpanded: boolean; navVisible: boolean;
  centerMode: 'chat' | 'observe'; centerMenuOpen: boolean; centerIdentityOpen: boolean;
  graphModes: Map<string, string>; graphEdges: Map<string, string>; detailOpen: Map<string, boolean>;
  contextNode: string | null; expandedProjects: Set<string>; theme: 'light' | 'dark' | 'system';
};

type TabDisplayState = { scrollTop: number; scrollLeft: number; selectionStart: number; selectionEnd: number; openDetails: Map<string, boolean> };

/** Center-conversation display state. Expanded <details> is captured from the
 * OLD DOM under the key that was rendered for it (never under the new state's
 * Session), then restored only when the freshly rendered DOM matches that key. */
type CenterDisplayState = { openDetails: Map<string, boolean> };
type ConversationScrollState = { key: string; top: number; atBottom: boolean };

/** What the paint remembers between two paints. Only the paint writes it, plus
 * `view-latest`, which sets `stickToBottom` before it asks for a paint. */
export type RenderMemory = {
  tabDisplay: Map<string, TabDisplayState>; renderedTabKey: string | null;
  centerDisplay: Map<string, CenterDisplayState>; renderedCenterKey: string | null;
  conversationScroll: ConversationScrollState | null; stickToBottom: boolean;
};

export type WorkbenchSlices = {
  bootstrap: BootstrapResponse | null;
  scopes: Map<string, ScopeState>;
  selectedKey: string;
  requestSeq: number;
  view: ViewState;
  renderMemory: RenderMemory;
  diffText: Map<string, { path: string; before: string; after: string }>;
  splitDrag: { side: 'left' | 'right'; startX: number; startWidth: number } | null;
};

/** `render` repaints synchronously; a scoped one only while that scope is still selected. */
export type WorkbenchAction = { readonly type: 'render'; readonly scopeKey: string | null };

/** Fresh slices with the page's initial values; every call gets its own maps and sets. */
export function createWorkbenchStore(): Store<WorkbenchSlices, WorkbenchAction> {
  return createStore<WorkbenchSlices, WorkbenchAction>({
    bootstrap: null,
    scopes: new Map<string, ScopeState>(),
    selectedKey: '',
    requestSeq: 0,
    view: { leftWidth: 180, rightWidth: 300, savedRightWidth: 300, auxVisible: false, auxExpanded: false,
      navVisible: true, centerMode: 'chat', centerMenuOpen: false, centerIdentityOpen: false,
      graphModes: new Map<string, string>(), graphEdges: new Map<string, string>(), detailOpen: new Map<string, boolean>(), contextNode: null,
      expandedProjects: new Set<string>(),
      theme: 'system' },
    renderMemory: {
      tabDisplay: new Map<string, TabDisplayState>(), renderedTabKey: null,
      centerDisplay: new Map<string, CenterDisplayState>(), renderedCenterKey: null,
      conversationScroll: null, stickToBottom: false,
    },
    diffText: new Map<string, { path: string; before: string; after: string }>(),
    splitDrag: null,
  });
}

/** The page's one store. `scopes`, `view`, `renderMemory` and `diffText` are
 * stable containers: mutated in place by their owners and never set() again. */
export const store = createWorkbenchStore();
export const view: ViewState = store.get('view');
export const renderMemory: RenderMemory = store.get('renderMemory');
export const scopes = (): Map<string, ScopeState> => store.get('scopes');
export const diffText = (): Map<string, { path: string; before: string; after: string }> => store.get('diffText');
export const selectedKey = (): string => store.get('selectedKey');
export const setSelectedKey = (key: string): void => store.set('selectedKey', key);
/** Replaced on every merge: read it at call time, never keep it in a module const. */
export const bootstrap = (): BootstrapResponse | null => store.get('bootstrap');

export function state(): ScopeState {
  const current = scopes().get(selectedKey());
  if (current === undefined) throw new Error('the workbench has no selected scope');
  return current;
}

function review(): BootstrapResponse['review'] {
  return bootstrap()?.review ?? null;
}

type ReviewMaterial = NonNullable<BootstrapResponse['review']>;
type ReviewPolicies = NonNullable<ReviewMaterial['policies']>;
type ReviewGoals = NonNullable<ReviewMaterial['goals']>;
type ReviewArchitectures = NonNullable<ReviewMaterial['architectures']>;
type ReviewPlans = NonNullable<ReviewMaterial['plans']>;

export function reviewPolicies(): ReviewPolicies { return review()?.policies ?? []; }
export function reviewGoals(): ReviewGoals { return review()?.goals ?? []; }
export function reviewArchitectures(): ReviewArchitectures { return review()?.architectures ?? []; }
export function reviewPlans(): ReviewPlans { return review()?.plans ?? []; }
export function reviewSessionRoles(): NonNullable<ReviewMaterial['sessionRoles']> { return review()?.sessionRoles ?? []; }

/** The ONE request sequence: request ids, run flow ids and new goal ids all take the next number from it. */
export function nextRequestSeq(): number {
  const next = store.get('requestSeq') + 1;
  store.set('requestSeq', next);
  return next;
}

export function freshRequestId(route: string): string {
  const seq = nextRequestSeq();
  return `r6-${route.replaceAll('/', '-')}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

/** Only the issuing workspace is re-rendered; a response for a workspace the
 * user has navigated away from still updates that workspace's state and is
 * shown when the user returns to it. */
export function renderScopeIfSelected(scope: ScopeState): void {
  store.dispatch({ type: 'render', scopeKey: scope.key });
}

/** Repaint the selected workspace now (main()'s listener runs the paint before this returns). */
export function renderAll(): void {
  store.dispatch({ type: 'render', scopeKey: null });
}

export const centerSessionOf = (scope: ScopeState): SessionRef | null => scope.activeSession ?? scope.mainSession;

/** Merge a new bootstrap without ever replacing an existing ScopeState object:
 * every existing per-scope draft, Session and captured run identity survives a
 * workspace open or a profile refresh; `create` runs only for new keys. */
export function mergeBootstrap(next: BootstrapResponse, create: (config: BootstrapWorkspace) => ScopeState): void {
  store.set('bootstrap', next);
  for (const workspace of next.workspaces) {
    const key = scopeKey(workspace.scope);
    const existing = scopes().get(key);
    if (existing === undefined) scopes().set(key, create(workspace));
    else existing.config = workspace;
  }
}
