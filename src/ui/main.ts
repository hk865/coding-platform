/// <reference lib="dom" />
/**
 * R6.1a browser entry for the thin workbench.
 *
 * The page is delivered by the local Host, reads the temporary token from this
 * document's `<meta name="platform-token">`, keeps it in page memory only, and
 * sends it on every bootstrap/core request. It never uses a query string,
 * fragment, `localStorage` or a log to carry the token.
 *
 * The workbench is a persistent layout: the workspace selector, every form and
 * every result area stay mounted. An operation updates only the panel that owns
 * its result (and only while its own workspace is selected), so controls never
 * disappear. State is exactly the page selection, the last original request and
 * the DTOs the Host actually returned; it is never a second business owner.
 *
 * Each async response is written back to the `ScopeState` that issued it, not
 * to whichever workspace is selected when the response arrives. A retry resends
 * the exact frozen body and a replay keeps the original request identity.
 *
 * Default copy is product language; the exact refs/versions/digests, the raw
 * request/receipt and the error code/current live in labeled `<details>`.
 */
import {
  UI_BOOTSTRAP_SUFFIX,
  UI_CORE_API_PREFIX,
  UI_PLATFORM_TOKEN_HEADER,
} from './views.js';
import type {
  BootstrapResponse,
} from '../app/core-http-types.js';
import { token } from './api/auth.js';
import { startLiveUpdates } from './api/live.js';
import { submit } from './api/submit.js';
import { watchRecordChanges } from './state/change-refetch.js';
import { displayPreferenceStore } from './state/display-preference.js';
import {
  scopeKey,
} from './state/values.js';
import {
  mergeBootstrap,
  renderAll,
  scopes,
  selectedKey,
  setSelectedKey,
  store,
  view,
} from './state/workbench.js';
import { createScope } from './views/conversation/goal-start-deps.js';
import {
  buildSessionFindRequest,
} from './views/sessions/requests.js';
import { restoreScopeDisplay } from './views/sessions/restore.js';
import { attachSettingsHandlers, renderSettings, settingsController } from './views/settings/wiring.js';
import { attachHandlers } from './views/shell/events.js';
import {
  app,
  buildShell,
  fatal,
  renderEmptyWorkbench,
} from './views/shell/layout.js';
import { paintAll } from './views/shell/render.js';

// Test-facing seams that now live in their own modules keep this import path.
export { DISPLAY_PREFERENCE_V1_KEY, createScopeDisplayStore } from './state/display-preference.js';
export type {
  ScopeDisplayIds,
  GlobalDisplayPreference,
  DisplayPreferenceStorage,
  ScopeDisplayReadPort,
  ScopeDisplayRestore,
  ScopeDisplayStore,
} from './state/display-preference.js';
export { createGoalConversationStart, goalConversationQueryRunRef } from './views/conversation/goal-start.js';
export type {
  GoalConversationStartProfile,
  GoalConversationStartRequest,
  GoalConversationStartOriginalRun,
  GoalConversationStartStartResult,
  GoalConversationStartSessionRefs,
  GoalConversationStartDeps,
  GoalConversationStartStatus,
  GoalConversationStartSnapshot,
  GoalConversationStartController,
  ResumableOriginalRun,
} from './views/conversation/goal-start.js';
export { DIRECTORY_INVENTORY_PAGE_SIZE, ensureDirectory, showMoreDirectoryInventory } from './views/files/directory.js';
export type {
  DirectoryInventoryState,
  DirectoryInventoryReply,
  DirectoryInventorySend,
} from './views/files/directory.js';

async function fetchBootstrap(): Promise<BootstrapResponse | null> {
  try {
    const response = await fetch(UI_CORE_API_PREFIX + UI_BOOTSTRAP_SUFFIX, { headers: { [UI_PLATFORM_TOKEN_HEADER]: token } });
    if (!response.ok) {
      fatal(response.status === 403 ? '连接已失效，请刷新页面重新连接。' : `读取本地配置失败（HTTP ${response.status}），请刷新页面。`);
      return null;
    }
    return await response.json() as BootstrapResponse;
  } catch (error) {
    fatal(`读取本地配置失败：${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function main(): Promise<void> {
  // The only painter: a `render` intent repaints synchronously, and a scoped one
  // only while that scope is still the selected one.
  store.listen(action => {
    if (action.type === 'render' && (action.scopeKey === null || action.scopeKey === selectedKey())) paintAll();
  });
  if (app === null) return;
  if (token.length === 0) { fatal('无法连接到本地服务：页面缺少连接信息，请刷新页面。'); return; }
  const bootstrap = await fetchBootstrap();
  if (bootstrap === null) return;
  mergeBootstrap(bootstrap, createScope);
  const first = bootstrap.workspaces[0];
  const globalPreference = displayPreferenceStore.readGlobal();
  if (globalPreference.theme !== null) view.theme = globalPreference.theme;
  if (first !== undefined) {
    setSelectedKey(globalPreference.lastScopeKey !== null && scopes().has(globalPreference.lastScopeKey)
      ? globalPreference.lastScopeKey : scopeKey(first.scope));
    view.expandedProjects.add(selectedKey());
  } else {
    setSelectedKey('');
  }
  buildShell();
  attachHandlers();
  attachSettingsHandlers();
  renderSettings(settingsController.state);
  // Task E: change notices drive the read loops; their old polls are only the
  // fallback. Started for an empty bootstrap too: later scopes need notices.
  // The bootstrap's head lets the first `ready` see a commit made while loading.
  startLiveUpdates(status => store.set('connection', status), bootstrap.changesHead);
  watchRecordChanges();
  if (first === undefined) {
    // Empty bootstrap: still expose the gear so the user can open the first
    // real folder. No default scope and no state() call is invented.
    renderEmptyWorkbench();
    return;
  }
  renderAll();
  const initial = scopes().get(selectedKey());
  if (initial !== undefined) await restoreScopeDisplay(initial);
  // First real member directory for the restored scope (no debug "list" step).
  if (initial !== undefined) await submit(initial, 'sessions/find', buildSessionFindRequest(false));
}

// Node/UI tests import this module for its exported seam; only a real browser
// document boots the entry. The guard changes nothing in the browser.
if (typeof document !== 'undefined') void main();
