/// <reference lib="dom" />
/** Action dispatch: the selected scope first, then the one area table that owns the action; plus the shell actions and the explicit conflict rebuild. */

import { submit } from '../../api/submit.js';
import { saveGlobalDisplay } from '../../state/display-preference.js';
import { reduceWorkbenchLayout } from '../../state/layout.js';
import type { ProjectValue, ScopeState, WorkspaceValue } from '../../state/scope-state.js';
import { record } from '../../state/values.js';
import { renderAll, renderScopeIfSelected, state, view } from '../../state/workbench.js';
import { conversationActions } from '../conversation/actions.js';
import { retryGoalSetup } from '../conversation/goal-setup.js';
import { retryMemberSend } from '../conversation/member-mail.js';
import { executionActions } from '../execution/actions.js';
import { retryExecution } from '../execution/query-flow.js';
import { fileActions } from '../files/actions.js';
import { graphActions } from '../graphs/actions.js';
import { openPageKind, switchScope } from '../nav/project-tree.js';
import { sessionActions } from '../sessions/actions.js';
import { setupActions } from '../setup/actions.js';
import { applyWorkbenchLayout } from './layout.js';
import { openTab, setupTab, storeLayout, syncActiveLayout } from '../tabs/aux-layout.js';
import { terminalActions } from '../terminal/commands.js';

/** One action's handler: the body of its former `handleAction` case, unchanged. `action` is the dispatched name. */
export type ActionHandler = (scope: ScopeState, element: HTMLElement, action: string) => void | Promise<void>;
/** Action name -> handler; one table per area. */
export type ActionTable = Readonly<Record<string, ActionHandler>>;

/** Runs one explicit user action. The selected scope is read first, as before (it throws when nothing is
 * selected); the owning table's handler then runs synchronously up to its first await. An unknown name is a no-op. */
export async function handleAction(action: string, element: HTMLElement): Promise<void> {
  const scope = state();
  const handler = lookup(action);
  if (handler === undefined) return;
  await handler(scope, element, action);
}

/** The area tables. Read only while an action runs, never while the modules load, so import cycles stay harmless. */
export function actionTables(): Readonly<Record<string, ActionTable>> {
  return {
    shell: shellActions, conversation: conversationActions, sessions: sessionActions, execution: executionActions,
    setup: setupActions, files: fileActions, graphs: graphActions, terminal: terminalActions,
  };
}

/** Own properties only, so an inherited name such as `toString` or `constructor` is never an action. */
export function lookup(action: string): ActionHandler | undefined {
  for (const table of Object.values(actionTables())) if (Object.hasOwn(table, action)) return table[action];
  return undefined;
}

const shellActions = {
  // --- prototype shell: display-only navigation / modes -------------------
  'open-page': async (scope, element) => { await openPageKind(scope, element.dataset.page ?? 'blank'); return; },
  'select-scope': (scope, element) => { switchScope(element.dataset.scopeKey ?? ''); return; },
  'toggle-project': (scope, element) => {
    const key = element.dataset.scopeKey ?? '';
    if (key.length === 0) return;
    if (view.expandedProjects.has(key)) view.expandedProjects.delete(key); else view.expandedProjects.add(key);
    renderAll();
    return;
  },
  'toggle-nav': () => { view.navVisible = !view.navVisible; applyWorkbenchLayout(); return; },
  'set-center-mode': (scope, element) => { view.centerMode = element.dataset.mode === 'observe' ? 'observe' : 'chat'; renderScopeIfSelected(scope); return; },
  'toggle-center-menu': scope => { view.centerMenuOpen = !view.centerMenuOpen; renderScopeIfSelected(scope); return; },
  'toggle-center-identity': scope => { view.centerIdentityOpen = !view.centerIdentityOpen; renderScopeIfSelected(scope); return; },
  'toggle-theme': () => { view.theme = view.theme === 'dark' ? 'light' : view.theme === 'light' ? 'system' : 'dark';
    applyWorkbenchLayout(); saveGlobalDisplay(); return; },
  'open-setup-tab': scope => { openTab(scope, setupTab()); renderScopeIfSelected(scope); return; },
  'activate-tab': (scope, element) => {
    view.contextNode = null;
    const tabId = element.dataset.tab ?? '';
    storeLayout(scope, reduceWorkbenchLayout(syncActiveLayout(scope), { kind: 'activate_tab', tabId }));
    renderScopeIfSelected(scope);
    return;
  },
  'close-tab': (scope, element) => {
    view.contextNode = null;
    const tabId = element.dataset.tab ?? '';
    storeLayout(scope, reduceWorkbenchLayout(syncActiveLayout(scope), { kind: 'close_tab', tabId }));
    renderScopeIfSelected(scope);
    return;
  },
  'toggle-aux': scope => {
    view.auxVisible = !view.auxVisible;
    if (!view.auxVisible) view.auxExpanded = false;
    applyWorkbenchLayout();
    renderScopeIfSelected(scope);
    return;
  },
  'expand-aux': scope => {
    if (!view.auxVisible) { scope.error = '辅助区已隐藏，请先显示。'; renderScopeIfSelected(scope); return; }
    view.auxExpanded = !view.auxExpanded;
    applyWorkbenchLayout();
    renderScopeIfSelected(scope);
    return;
  },
  'retry': async scope => {
    if (scope.goalSetup !== null && scope.goalSetup.pending !== null) { await retryGoalSetup(scope); return; }
    if (scope.memberMail !== null && scope.memberMail.sendState === 'failed' && scope.memberMail.request !== null) {
      await retryMemberSend(scope);
      return;
    }
    if (scope.execution.pending !== null) { await retryExecution(scope); return; }
    if (scope.pending !== null) await submit(scope, scope.pending.route, scope.pending.body, scope.pending.tags);
    return;
  },
  'replay': async scope => { if (scope.lastRequest !== null) await submit(scope, scope.lastRequest.route, scope.lastRequest.body, scope.lastRequest.tags); return; },
  'rebuild-conflict': scope => { rebuildFromConflict(scope); return; },
} satisfies ActionTable;

/** An explicit user action, never automatic: adopt the real `current` pins the
 * domain returned (so the next explicitly built request can use them) and stop.
 * It never fakes a success and never loops on a stale version. */
function rebuildFromConflict(scope: ScopeState): void {
  const conflict = scope.conflict;
  if (conflict === null) return;
  let adopted = false;
  for (const entry of conflict.current) {
    const pin = record(entry);
    const ref = record(pin.ref);
    const revision = Number(pin.revision);
    if (!Number.isSafeInteger(revision)) continue;
    if (ref.aggregateType === 'Project' && scope.project === null) {
      scope.project = { ref, revision } as unknown as ProjectValue;
      adopted = true;
    }
    if (ref.aggregateType === 'Workspace' && scope.workspace === null) {
      scope.workspace = { ref, revision } as unknown as WorkspaceValue;
      adopted = true;
    }
  }
  scope.conflict = null;
  scope.notice = adopted
    ? '已采用返回的当前版本。请继续下一步；写操作不会自动重发。'
    : '该冲突没有可直接采用的版本，请核对输入后重新操作；不会伪造成功。';
  scope.error = null;
  renderScopeIfSelected(scope);
}
