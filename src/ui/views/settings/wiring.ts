/// <reference lib="dom" />

import type { BootstrapResponse } from '../../../app/core-http-types.js';
import type { SettingsProvider } from '../../../app/host-settings-types.js';
import { token } from '../../api/auth.js';
import { createHostSettingsPort } from '../../api/http.js';
import { UI_BOOTSTRAP_SUFFIX, UI_CORE_API_PREFIX, UI_PLATFORM_TOKEN_HEADER } from '../../api/protocol.js';
import { createSettingsController, renderSettingsDialog, renderSettingsEntry } from '../../settings.js';
import type { SettingsController, SettingsState, SettingsWorkspaceOpened } from '../../settings.js';
import { scopeKey } from '../../state/values.js';
import { mergeBootstrap, renderAll, scopes, selectedKey, setSelectedKey, view } from '../../state/workbench.js';
import { createScope } from '../conversation/goal-start-deps.js';

// ---------------------------------------------------------------------------
// Host settings surface (frozen DTO; no backend/views/history change)
// ---------------------------------------------------------------------------

export const settingsController: SettingsController = createSettingsController({
  port: createHostSettingsPort(),
  render: current => renderSettings(current),
  onWorkspaceOpened: opened => mergeOpenedWorkspace(opened),
  reloadBootstrap: () => reloadCoreBootstrap(),
});

/** A profile refresh after models/save or models/select must never wipe the
 * page or the settings dialog. `models/save|select` return settings only, so
 * the existing core bootstrap is re-read here for the profile lists. */
async function reloadCoreBootstrap(): Promise<void> {
  const response = await fetch(UI_CORE_API_PREFIX + UI_BOOTSTRAP_SUFFIX, {
    headers: { [UI_PLATFORM_TOKEN_HEADER]: token },
  });
  if (!response.ok) {
    // Prefer the Host's structured reason; fall back to the transport status.
    const payload: unknown = await response.json().catch(() => null);
    const reason = payload !== null && typeof payload === 'object'
      && typeof (payload as Record<string, unknown>).reason === 'string'
      ? (payload as Record<string, unknown>).reason as string
      : `HTTP ${response.status}`;
    throw new Error(reason);
  }
  const next = await response.json() as BootstrapResponse;
  mergeBootstrap(next, createScope);
  if (!scopes().has(selectedKey()) && next.workspaces[0] !== undefined) {
    setSelectedKey(scopeKey(next.workspaces[0].scope));
    view.expandedProjects.add(selectedKey());
  }
  if (scopes().has(selectedKey())) renderAll();
}

/** `workspaces/open` already returns the full bootstrap + exact scope; the
 * merge owner preserves every other scope, explicitly selects the opened one
 * and leaves each scope's own draft/Session object untouched. */
async function mergeOpenedWorkspace(opened: SettingsWorkspaceOpened): Promise<void> {
  // The returned bootstrap is authoritative and is ALWAYS merged, even when the
  // user closed the dialog while the request was in flight: the opened
  // workspace is never discarded.
  mergeBootstrap(opened.bootstrap, createScope);
  const key = scopeKey(opened.scope);
  if (!scopes().has(key)) {
    // Only the authoritative bootstrap creates scopes. Never fabricate one with
    // an invented revision; surface the precise inconsistency instead.
    settingsController.reportError(
      `Host 返回的 bootstrap 未包含刚打开的工作区（${key}），未选中任何工作区；请刷新后重试。`);
    return;
  }
  // Selection is a display action: keep it only while the explicit dialog
  // interaction that issued the request is still the current one.
  if (!settingsController.shouldSelectOpened()) {
    if (scopes().has(selectedKey())) renderAll();
    return;
  }
  setSelectedKey(key);
  view.expandedProjects.add(key);
  renderAll();
}

/** Repaint only the settings mount. Structural changes call it; per-keystroke
 * field edits do not, so the focused control and its caret survive. */
export function renderSettings(current: SettingsState): void {
  const mount = document.getElementById('settings-mount');
  if (mount === null) return;
  mount.innerHTML = renderSettingsEntry(current) + (current.open ? renderSettingsDialog(current) : '');
}

async function handleSettingsAction(action: string, element: HTMLElement): Promise<void> {
  switch (action) {
    case 'open-settings': { await settingsController.open(); return; }
    case 'close-settings': { settingsController.close(); return; }
    case 'settings-section': {
      settingsController.setSection(element.dataset.section === 'models' ? 'models' : 'workspace');
      return;
    }
    case 'settings-directory-go':
    case 'settings-directory-refresh': { await settingsController.browse(settingsController.state.workspace.path); return; }
    case 'settings-directory-parent': {
      const parent = settingsController.state.directory?.parent ?? null;
      if (parent !== null) await settingsController.browse(parent);
      return;
    }
    case 'settings-directory-child': { await settingsController.browse(element.dataset.path ?? ''); return; }
    case 'settings-open-workspace': { await settingsController.openWorkspace(); return; }
    case 'settings-new-model': { settingsController.newModel(); return; }
    case 'settings-edit-model': { settingsController.editModel(element.dataset.model ?? ''); return; }
    case 'settings-save-model': { await settingsController.saveModel(); return; }
    default: return;
  }
}

function settingsInputField(target: HTMLInputElement | HTMLTextAreaElement): void {
  const field = target.dataset.field;
  if (field === undefined) return;
  switch (field) {
    case 'settings-directory-path': settingsController.setWorkspaceField('path', target.value); return;
    case 'settings-workspace-name': settingsController.setWorkspaceField('name', target.value); return;
    case 'settings-model-label': settingsController.setModelField('label', target.value); return;
    case 'settings-model-model': settingsController.setModelField('model', target.value); return;
    case 'settings-model-baseurl': settingsController.setModelField('baseUrl', target.value); return;
    case 'settings-model-apikey': settingsController.setModelField('apiKey', target.value); return;
    default: return;
  }
}

function settingsChangeField(target: HTMLInputElement | HTMLSelectElement): void {
  if (target.dataset.action === 'settings-select-model' && target instanceof HTMLSelectElement) {
    void settingsController.selectModel(
      { projectId: target.dataset.scopeProject ?? '', workspaceId: target.dataset.scopeWorkspace ?? '' },
      target.value,
    );
    return;
  }
  const field = target.dataset.field;
  if (field === undefined) return;
  switch (field) {
    case 'settings-workspace-project':
      settingsController.setWorkspaceField('projectId', target.value);
      renderSettings(settingsController.state);
      return;
    case 'settings-workspace-model': settingsController.setWorkspaceField('modelId', target.value); return;
    case 'settings-workspace-write':
      settingsController.setWorkspaceField('writeAllowed', target instanceof HTMLInputElement && target.checked);
      renderSettings(settingsController.state);
      return;
    case 'settings-workspace-commands':
      settingsController.setWorkspaceField('commandsAllowed', target instanceof HTMLInputElement && target.checked);
      renderSettings(settingsController.state);
      return;
    case 'settings-model-provider':
      if (target instanceof HTMLSelectElement) settingsController.setModelField('provider', target.value as SettingsProvider);
      renderSettings(settingsController.state);
      return;
    case 'settings-model-thinking':
      if (target instanceof HTMLSelectElement) {
        settingsController.setModelField('thinking', target.value === '' ? null : target.value as 'enabled' | 'disabled');
      }
      return;
    case 'settings-model-effort':
      if (target instanceof HTMLSelectElement) {
        settingsController.setModelField('reasoningEffort', target.value === '' ? null : target.value as 'low' | 'high' | 'max');
      }
      return;
    default: return;
  }
}

/** Isolated settings events: every handler stops propagation, so the existing
 * conversation/draft document handlers never receive a settings interaction. */
export function attachSettingsHandlers(): void {
  const mount = document.getElementById('settings-mount');
  if (mount === null) return;
  mount.addEventListener('click', event => {
    const target = event.target as HTMLElement | null;
    const element = target?.closest<HTMLElement>('[data-action]') ?? null;
    if (element === null || !mount.contains(element)) return;
    if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) return;
    const action = element.dataset.action ?? '';
    if (action.length === 0 || action === 'noop') return;
    event.preventDefault();
    event.stopPropagation();
    void handleSettingsAction(action, element);
  });
  mount.addEventListener('input', event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    event.stopPropagation();
    settingsInputField(target);
  });
  mount.addEventListener('change', event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    event.stopPropagation();
    settingsChangeField(target);
  });
  // Swallow keys inside the dialog so the main Enter/Space action handler never
  // sees a settings button; Escape still closes the dialog.
  mount.addEventListener('keydown', event => {
    if (event.key === 'Escape') settingsController.close();
    event.stopPropagation();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !settingsController.state.open) return;
    event.preventDefault();
    settingsController.close();
  });
}
