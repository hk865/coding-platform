/** Pure workbench layout state: the tab/draft model and its reducer. */

import type {
  ArchitectureReadBody,
  CoreScope,
  RunRef,
  SessionCard,
  SessionRef,
  TaskGraph,
  WorkspaceFile,
  WorkspaceVersion,
} from '../../app/core-http-types.js';

export type WorkLinkTarget = SessionCard['links'][number]['ref']['target'];
/** The exact original TaskTriple, derived from the public DTO so the UI never
 * value-imports a contract module. It is only a return target; no identity is
 * ever parsed back out of a title/tabId. */
type TaskTriple = Extract<WorkLinkTarget, { kind: 'task' }>['ref'];

// ---------------------------------------------------------------------------
// R6 UI-layout: pure display/layout state over the exact public HTTP DTOs.
//
// Everything below is PURE display state: no DOM, no network, no second business
// owner and no write back into Task/Session. The `WorkbenchLayout` reducer only
// moves tabs, the per-conversation composer draft and the per-file editor draft;
// it can never send a message, save a file or start a model. Renderers only see
// the exact fields their DTO carries and never parse a title/tabId to guess a
// domain ref.
// ---------------------------------------------------------------------------

/** A selection keeps its exact text/lines and the file version it was based
 * on. Unsaved editor text is explicitly marked as a draft snapshot. */
export type WorkbenchDraftReference =
  | { kind: 'path'; path: string }
  | { kind: 'selection'; path: string; text: string; startLine: number; endLine: number;
      version: WorkspaceFile['version']; digest: string; source: 'file' | 'draft_snapshot' };

/** Current conversation composer, distinct from each file editor's text. */
export type WorkbenchDraft = {
  state: 'draft_snapshot';
  text: string;
  references: WorkbenchDraftReference[];
};

/** A graph tab's live display selection. It carries the exact real ref for a
 * Task/Module node (never parsed from a title/tabId); an observed node has no
 * formal target and keeps only its public display identity. */
export type WorkbenchNodeSelection =
  | { kind: 'task'; nodeId: string; target: Extract<WorkLinkTarget, { kind: 'task' }> }
  | { kind: 'module'; nodeId: string; target: Extract<WorkLinkTarget, { kind: 'module' }> }
  | { kind: 'observed'; nodeId: string; label: string; detail: string };

/** Pure per-graph-tab display state: which node is selected in place and which
 * node ids show their full label. It never freezes or writes domain data. */
export type WorkbenchGraphDisplay = { selected: WorkbenchNodeSelection | null; pinned: string[];
  /** Node ids whose full label is shown by default (root/active/ancestors). All
   * other nodes stay dots with a hover preview; selected/pinned always show. */
  labels?: string[] };

// tabId/title are presentation identifiers only. Object navigation uses the
// full typed fields below; scope-only pages use their parent layout.scope.
export type WorkbenchTab = { tabId: string; title: string } & (
  | { kind: 'file'; file: WorkspaceFile; editorDraft: { state: 'draft_snapshot'; text: string } | null }
  // Existing initialization/Goal/Plan controls share the scope-bound setup page.
  | { kind: 'setup' | 'project_chat' }
  | { kind: 'architecture_graph'; selection: ArchitectureReadBody['input']['selection']; display?: WorkbenchGraphDisplay }
  | { kind: 'task_graph'; goal: TaskGraph['plan']['goalRef']; display?: WorkbenchGraphDisplay }
  | { kind: 'directory'; path: string }
  | { kind: 'session_chat'; session: SessionRef }
  | { kind: 'history'; session: SessionRef }
  // R6 Task-execution -> original Session/history: the EXACT RunRef plus the
  // optional original TaskTriple return target. Identity is typed, never parsed.
  | { kind: 'execution_history'; run: RunRef; task: TaskTriple | null }
  | { kind: 'task_detail'; target: Extract<WorkLinkTarget, { kind: 'task' }> }
  | { kind: 'module_detail'; target: Extract<WorkLinkTarget, { kind: 'module' }> }
  // One real Kernel command handle; the snapshot is read back by commandId.
  | { kind: 'terminal'; commandId: string; command: string; cwd: string }
  // One real WorkspaceToolsPort.compareWorkspace request over two exact versions.
  | { kind: 'diff'; before: WorkspaceVersion; after: WorkspaceVersion; prefix: string | null }
  // Prototype `＋` chooser page (reads nothing until a type is chosen).
  | { kind: 'blank' }
  // The Diff entry page: real version pairs are chosen here before any request.
  | { kind: 'compare' }
);

/** Display state for one scope and the exact SessionRef, or project composer
 * when session is null. Tabs/editors are separate from the conversation draft.
 * This state has no network/send capability and never writes Task/Session. */
export type WorkbenchLayout = {
  scope: CoreScope;
  session: SessionRef | null;
  tabs: WorkbenchTab[];
  activeTabId: string | null;
  composerDraft: WorkbenchDraft;
  /** Archived pages can browse files but cannot edit or add to a sendable draft. */
  readOnly: boolean;
};

export type WorkbenchLayoutAction =
  | { kind: 'open_tab'; tab: WorkbenchTab }
  | { kind: 'activate_tab'; tabId: string }
  | { kind: 'close_tab'; tabId: string }
  | { kind: 'edit_file_draft'; tabId: string; text: string }
  | { kind: 'edit_composer'; text: string }
  | { kind: 'add_reference'; reference: WorkbenchDraftReference }
  | { kind: 'select_node'; tabId: string; selection: WorkbenchNodeSelection }
  | { kind: 'toggle_pin'; tabId: string; nodeId: string };

/** The pure tab/draft reducer. Every branch is a display-only move: no HTTP, no
 * send, no file save. On an archived (read-only) layout the edit branches are
 * no-ops so a file can be browsed but never turned into a sendable draft. */
export function reduceWorkbenchLayout(layout: WorkbenchLayout, action: WorkbenchLayoutAction): WorkbenchLayout {
  switch (action.kind) {
    case 'open_tab': {
      const existing = layout.tabs.find(tab => tab.tabId === action.tab.tabId);
      // Re-opening a tab keeps its saved display state: the file editor snapshot
      // or the graph tab's selected/pinned node set. A fresh read never discards
      // what the user is looking at.
      let tab: WorkbenchTab = action.tab;
      if (existing !== undefined && existing.kind === 'file' && action.tab.kind === 'file'
        && action.tab.editorDraft === null) {
        tab = { ...action.tab, editorDraft: existing.editorDraft };
      } else if (existing !== undefined && existing.kind === 'task_graph' && action.tab.kind === 'task_graph') {
        const display = action.tab.display ?? existing.display;
        tab = display === undefined ? action.tab : { ...action.tab, display };
      } else if (existing !== undefined && existing.kind === 'architecture_graph' && action.tab.kind === 'architecture_graph') {
        const display = action.tab.display ?? existing.display;
        tab = display === undefined ? action.tab : { ...action.tab, display };
      }
      const tabs = existing === undefined
        ? [...layout.tabs, tab]
        : layout.tabs.map(current => current.tabId === tab.tabId ? tab : current);
      return { ...layout, tabs, activeTabId: tab.tabId };
    }
    case 'activate_tab':
      return layout.tabs.some(tab => tab.tabId === action.tabId)
        ? { ...layout, activeTabId: action.tabId }
        : layout;
    case 'close_tab': {
      if (!layout.tabs.some(tab => tab.tabId === action.tabId)) return layout;
      const tabs = layout.tabs.filter(tab => tab.tabId !== action.tabId);
      const activeTabId = layout.activeTabId === action.tabId
        ? (tabs.length === 0 ? null : tabs[tabs.length - 1]!.tabId)
        : layout.activeTabId;
      return { ...layout, tabs, activeTabId };
    }
    case 'edit_file_draft':
      if (layout.readOnly) return layout;
      // A historical/capture read version is never turned into an edited buffer.
      return { ...layout, tabs: layout.tabs.map(tab =>
        tab.tabId === action.tabId && tab.kind === 'file' && tab.file.version.kind === 'working_tree'
          ? { ...tab, editorDraft: { state: 'draft_snapshot' as const, text: action.text } }
          : tab) };
    case 'edit_composer':
      if (layout.readOnly) return layout;
      return { ...layout, composerDraft: { ...layout.composerDraft, text: action.text } };
    case 'add_reference':
      if (layout.readOnly) return layout;
      return { ...layout, composerDraft: {
        ...layout.composerDraft,
        references: [...layout.composerDraft.references, action.reference],
      } };
    case 'select_node':
      return { ...layout, tabs: layout.tabs.map(tab =>
        tab.tabId === action.tabId && (tab.kind === 'task_graph' || tab.kind === 'architecture_graph')
          ? { ...tab, display: { selected: action.selection, pinned: tab.display?.pinned ?? [] } }
          : tab) };
    case 'toggle_pin':
      return { ...layout, tabs: layout.tabs.map(tab => {
        if (tab.tabId !== action.tabId || (tab.kind !== 'task_graph' && tab.kind !== 'architecture_graph')) return tab;
        const pinned = tab.display?.pinned ?? [];
        const next = pinned.includes(action.nodeId)
          ? pinned.filter(id => id !== action.nodeId)
          : [...pinned, action.nodeId];
        return { ...tab, display: { selected: tab.display?.selected ?? null, pinned: next } };
      }) };
  }
}
