/// <reference lib="dom" />
/** Document event wiring: clicks and keys to actions, in-place field sync, graph-node pins and context menu, and the splitters. */

import { stopPoll } from '../../api/refresh.js';
import { submit } from '../../api/submit.js';
import { updateLensCanvas } from '../../components/dom.js';
import { reduceWorkbenchLayout } from '../../state/layout.js';
import type { Forms, ScopeState } from '../../state/scope-state.js';
import { renderAll, renderScopeIfSelected, scopes, selectedKey, state, store, view } from '../../state/workbench.js';
import { renderCenterBody } from '../conversation/center.js';
import { refreshExecutionButtons } from '../execution/panel.js';
import { selectGraphNode } from '../graphs/interaction.js';
import { switchScope } from '../nav/project-tree.js';
import { buildSessionFindRequest } from '../sessions/requests.js';
import { architectureDraftPreview } from '../setup/requests.js';
import { handleAction } from './actions.js';
import { AUX_MIN_LEFT, AUX_MIN_RIGHT, applyWorkbenchLayout, setSplit, splitLimit } from './layout.js';
import { storeLayout, syncActiveLayout } from '../tabs/aux-layout.js';
import { renderTabBody } from '../tabs/strip.js';

function applyCompareField(scope: ScopeState, field: string, value: string): boolean {
  switch (field) {
    case 'compareBeforeKind': scope.compareForm.beforeKind = value as 'working_tree' | 'git' | 'capture'; return true;
    case 'compareBeforeCommit': scope.compareForm.beforeCommit = value; return true;
    case 'compareAfterKind': scope.compareForm.afterKind = value as 'working_tree' | 'git' | 'capture'; return true;
    case 'compareAfterCommit': scope.compareForm.afterCommit = value; return true;
    case 'comparePrefix': scope.compareForm.prefix = value; return true;
    default: return false;
  }
}

function onField(field: string, value: string): void {
  const current = scopes().get(selectedKey());
  if (current === undefined) return;
  if (applyCompareField(current, field, value)) return;
  if (field === 'timelineFocus') { current.timeline.focus = Number(value); return; }
  if (field === 'timelineZoom') { current.timeline.zoom = Number(value); return; }
  if (field in current.forms) current.forms[field as keyof Forms] = value;
  if (field === 'goalId') {
    // A different explicit Goal owns a different host handle. Unbind only the
    // PAGE's timer/panel/epoch; the Host driver for the old Goal keeps running,
    // and any pending unconfirmed request stays intact.
    if (current.collaborationPoll !== null) { stopPoll(current.collaborationPoll); current.collaborationPoll = null; }
    current.collaborationEpoch += 1;
    current.collaboration = null;
    current.collaborationSyncedGoal = null;
  }
}

export function attachHandlers(): void {
  document.addEventListener('click', event => {
    const target = event.target as HTMLElement | null;
    const element = target?.closest<HTMLElement>('[data-action]') ?? null;
    if (element === null) return;
    // Checkbox/select/textarea actions are handled by their own input/change
    // events so a click never cancels the native control.
    if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) return;
    const action = element.dataset.action ?? '';
    if (action === '' || action === 'noop') return;
    event.preventDefault();
    if (action === 'select-node' && (element.classList.contains('graph-node') || element.classList.contains('q-graphnode'))) {
      selectGraphNode(state(), element);
      return;
    }
    void handleAction(action, element);
  });

  // Keyboard equivalent for non-button controls (e.g. the tab close affordance).
  document.addEventListener('keydown', event => {
    const target = event.target as HTMLElement | null;
    const element = target?.closest<HTMLElement>('[data-action]') ?? null;
    if (element === null || element instanceof HTMLInputElement
      || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) return;
    if ((event.key === 'p' || event.key === 'P') && (element.classList.contains('graph-node') || element.classList.contains('q-graphnode'))) {
      event.preventDefault();
      void handleAction('toggle-pin', element);
      return;
    }
    if (element instanceof HTMLButtonElement || (event.key !== 'Enter' && event.key !== ' ')) return;
    const action = element.dataset.action ?? '';
    if (action === '' || action === 'noop') return;
    event.preventDefault();
    void handleAction(action, element);
  });

  // Enter sends the composer; Shift+Enter inserts a newline; IME composition is
  // never intercepted. The send still goes through the existing real action.
  document.addEventListener('keydown', event => {
    const element = event.target;
    if (!(element instanceof HTMLTextAreaElement) || element.dataset.field !== 'composerText') return;
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    const composer = element.closest<HTMLElement>('[data-view="composer"]');
    const send = composer?.querySelector<HTMLButtonElement>('.q-send') ?? null;
    if (send === null || send.disabled) return;
    event.preventDefault();
    send.click();
  });

  // Typing only syncs this scope's display state; it never rebuilds the focused
  // control, so a late response cannot drop the current draft or editor text.
  document.addEventListener('input', event => {
    const element = event.target;
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return;
    const field = element.dataset.field;
    if (field === undefined) return;
    const current = scopes().get(selectedKey());
    if (current === undefined) return;
    if (field === 'composerText') {
      // Store the draft without rebuilding the DOM, so typing keeps focus.
      storeLayout(current, reduceWorkbenchLayout(syncActiveLayout(current), { kind: 'edit_composer', text: element.value }));
      return;
    }
    if (field === 'fileEditor') {
      storeLayout(current, reduceWorkbenchLayout(syncActiveLayout(current),
        { kind: 'edit_file_draft', tabId: element.dataset.tab ?? '', text: element.value }));
      const layout = syncActiveLayout(current);
      const tab = layout.tabs.find(candidate => candidate.tabId === element.dataset.tab);
      const page = element.closest<HTMLElement>('[data-view="file-page"]');
      if (tab?.kind === 'file' && page !== null) {
        const changed = element.value !== tab.file.content;
        const editable = !layout.readOnly && tab.file.version.kind === 'working_tree'
          && current.config.writeAllowed === true;
        const save = page.querySelector<HTMLButtonElement>('[data-action="save-file"]');
        if (save !== null) save.disabled = !editable || !changed;
        const status = page.querySelector<HTMLElement>('[data-draft-state]');
        if (status !== null) {
          status.dataset.draftState = changed ? 'draft_snapshot' : 'saved';
          status.textContent = changed ? '草稿快照（未保存，仅本页内存）' : '与已读取版本一致';
        }
      }
      return;
    }
    onField(field, element.value);
    // Keep the explicit paste control usable while typing: refresh only the
    // preview and the button's disabled state, never rebuilding the focused
    // textarea. This is the same in-place pattern as the file-save draft.
    if (field === 'architectureDraft') {
      const preview = document.querySelector<HTMLElement>('[data-architecture-draft-preview]');
      if (preview !== null) preview.innerHTML = architectureDraftPreview(element.value);
      const draftButton = document.querySelector<HTMLButtonElement>('[data-action="adopt-architecture-draft"]');
      if (draftButton !== null) draftButton.disabled = element.value.trim().length === 0 || current.sending;
      return;
    }
    // The timeline lens may live in the center observation body or in an
    // auxiliary Task page; re-render both from the scope's display state (the
    // focused range keeps its value in `current.timeline`).
    if (field === 'timelineFocus' || field === 'timelineZoom') {
      updateLensCanvas('region-conversation', renderCenterBody());
      updateLensCanvas('region-tab-body', renderTabBody());
      return;
    }
    // A typed Goal immediately enables the formal continue/refresh entry, while
    // the focused input is left untouched.
    if (field === 'goalId') refreshExecutionButtons(current);
  });

  document.addEventListener('change', event => {
    const element = event.target;
    if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) return;
    const current = scopes().get(selectedKey());
    if (current === undefined) return;
    if (element.dataset.action === 'select-scope') { switchScope(element.value); return; }
    if (element.dataset.action === 'toggle-archived') {
      current.sessionIncludeArchived = element instanceof HTMLInputElement && element.checked;
      current.sessionFind = null;
      // The old target result was read under the previous includeArchived filter;
      // mark it unread instead of keeping the stale list under a new label.
      current.relatedSessions = null;
      void submit(current, 'sessions/find', buildSessionFindRequest(false));
      return;
    }
    const field = element.dataset.field;
    if (field === undefined) return;
    onField(field, element.value);
    if (field.startsWith('compare')) { renderAll(); return; }
    if (field === 'goalId') refreshExecutionButtons(current);
    // Only the architecture-range selector reveals dependent inputs; refresh the
    // auxiliary body without touching the conversation or the composer draft.
    if (field === 'archSelection') renderAll();
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const current = scopes().get(selectedKey());
    let changed = false;
    if (view.contextNode !== null) { view.contextNode = null; changed = true; }
    if (view.centerMenuOpen) { view.centerMenuOpen = false; changed = true; }
    if (view.auxExpanded) { view.auxExpanded = false; applyWorkbenchLayout(); changed = true; }
    if (changed && current !== undefined) { event.preventDefault(); renderScopeIfSelected(current); }
  });

  const graphNodeTarget = (event: Event): HTMLElement | null => {
    const target = event.target as Element | null;
    const element = target?.closest('[data-action]') as HTMLElement | null;
    return element !== null && (element.classList.contains('graph-node') || element.classList.contains('q-graphnode')) ? element : null;
  };
  document.addEventListener('dblclick', event => {
    const element = graphNodeTarget(event);
    if (element === null) return;
    event.preventDefault();
    void handleAction('toggle-pin', element);
  });
  document.addEventListener('contextmenu', event => {
    const element = graphNodeTarget(event);
    if (element === null) return;
    event.preventDefault();
    const current = scopes().get(selectedKey());
    if (current === undefined) return;
    selectGraphNode(current, element);
    view.contextNode = element.dataset.node ?? null;
    renderScopeIfSelected(current);
  });

  document.addEventListener('pointerdown', event => {
    const target = event.target as HTMLElement | null;
    const splitter = target?.closest<HTMLElement>('[data-splitter]') ?? null;
    if (splitter === null) return;
    event.preventDefault();
    const side = splitter.dataset.splitter === 'right' ? 'right' : 'left';
    store.set('splitDrag', { side, startX: event.clientX, startWidth: side === 'left' ? view.leftWidth : view.rightWidth });
    splitter.setPointerCapture(event.pointerId);
  });
  document.addEventListener('pointermove', event => {
    const splitDrag = store.get('splitDrag');
    if (splitDrag === null) return;
    const delta = event.clientX - splitDrag.startX;
    setSplit(splitDrag.side, splitDrag.side === 'left' ? splitDrag.startWidth + delta : splitDrag.startWidth - delta);
  });
  document.addEventListener('pointerup', () => { store.set('splitDrag', null); });
  document.addEventListener('pointercancel', () => { store.set('splitDrag', null); });

  document.addEventListener('keydown', event => {
    const target = event.target as HTMLElement | null;
    const splitter = target?.closest<HTMLElement>('[data-splitter]') ?? null;
    if (splitter === null) return;
    const side = splitter.dataset.splitter === 'right' ? 'right' : 'left';
    const step = event.shiftKey ? 48 : 16;
    const current = side === 'left' ? view.leftWidth : view.rightWidth;
    let next = current;
    if (event.key === 'ArrowLeft') next = side === 'left' ? current - step : current + step;
    else if (event.key === 'ArrowRight') next = side === 'left' ? current + step : current - step;
    else if (event.key === 'Home') next = side === 'left' ? AUX_MIN_LEFT : AUX_MIN_RIGHT;
    else if (event.key === 'End') next = splitLimit(side);
    else return;
    event.preventDefault();
    setSplit(side, next);
  });
}
