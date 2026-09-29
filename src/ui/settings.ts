/**
 * Host settings surface — production controller + renderers.
 *
 * The frozen DTO `src/app/host-settings-types.ts` is authoritative and is never
 * modified here. This module stays DOM-free: the controller only drives the
 * injected `HostSettingsPort` and repaints through `render`. The browser entry
 * (`main.ts`) owns the real same-origin fetch client, the DOM mount, the
 * per-scope state merge and the preservation of every existing conversation
 * draft and Session. Pure tests therefore inject a typed port plus a render
 * callback and need no DOM library.
 *
 * The published surface is exactly the DTO routes `snapshot`, `directories`,
 * `models/save`, `models/select` and `workspaces/open`; the request body is the
 * DTO `input` verbatim. No card dashboard, no model registry and no fake
 * directory data are introduced.
 *
 * Contract tokens `tests/app/settings-ui.test.ts` pins:
 *  - entry:  `data-action="open-settings"`, class `settings-entry`.
 *  - dialog: `data-view="settings-dialog"`, `data-action="close-settings"`,
 *            `data-action="settings-section"` with `data-section="workspace"`
 *            or `data-section="models"`, an editable absolute path field
 *            `data-field="settings-directory-path"` and
 *            `data-action="settings-open-workspace"`.
 */
import type { BootstrapResponse, CoreScope } from '../app/core-http-types.js';
import type {
  DirectoryListing,
  HostSettingsPort,
  HostSettingsSnapshot,
  OpenSettingsWorkspace,
  SaveSettingsModel,
  SettingsModel,
  SettingsProvider,
} from '../app/host-settings-types.js';

/** The two panes of the single closeable dialog. */
export type SettingsSection = 'workspace' | 'models';

/** Model editor draft. The API key is page-memory only: it starts empty for a
 * NEW and for an EXISTING model (the Host never sends a stored key back) and is
 * cleared again after a successful save. A blank key is omitted so the server
 * retains the existing credential. */
export type SettingsModelDraft = {
  /** null while creating a new model; a real id while editing. */
  id: string | null;
  label: string;
  provider: SettingsProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
  thinking: 'enabled' | 'disabled' | null;
  reasoningEffort: 'low' | 'high' | 'max' | null;
};

/** Directory-picker + Open form. An empty `projectId` means "create a new
 * project" (the DTO `projectId` is then omitted); otherwise the folder is added
 * as a workspace of that existing project. Permissions default OFF and
 * `commandsAllowed` may never be true while `writeAllowed` is false. */
export type SettingsWorkspaceDraft = {
  path: string;
  name: string;
  projectId: string;
  modelId: string;
  writeAllowed: boolean;
  commandsAllowed: boolean;
};

export type SettingsState = {
  open: boolean;
  section: SettingsSection;
  snapshot: HostSettingsSnapshot | null;
  error: string | null;
  /** True while a settings request is in flight; save/open controls disable. */
  busy: boolean;
  directory: DirectoryListing | null;
  directoryError: string | null;
  model: SettingsModelDraft;
  workspace: SettingsWorkspaceDraft;
};

/** A ready `workspaces/open` result. The merge owner receives the full core
 * bootstrap and the exact opened scope so it can preserve every existing
 * per-scope draft and Session and only add/refresh what actually changed. */
export type SettingsWorkspaceOpened = {
  settings: HostSettingsSnapshot;
  bootstrap: BootstrapResponse;
  scope: CoreScope;
};

export type SettingsControllerOptions = {
  port: HostSettingsPort;
  render: (state: SettingsState) => void;
  /** Owns the merge into the existing workbench states. The controller never
   * replaces per-scope state or conversation drafts itself. */
  onWorkspaceOpened: (opened: SettingsWorkspaceOpened) => void | Promise<void>;
  /** `models/save` and `models/select` answer with settings only, so the
   * caller re-reads the existing core bootstrap for the profile lists. */
  reloadBootstrap: () => void | Promise<void>;
};

export interface SettingsController {
  readonly state: SettingsState;
  open(section?: SettingsSection): Promise<void>;
  close(): void;
  setSection(section: SettingsSection): void;
  loadSnapshot(): Promise<void>;
  browse(path?: string): Promise<void>;
  newModel(): void;
  editModel(id: string): void;
  setModelField<K extends keyof SettingsModelDraft>(field: K, value: SettingsModelDraft[K]): void;
  setWorkspaceField<K extends keyof SettingsWorkspaceDraft>(field: K, value: SettingsWorkspaceDraft[K]): void;
  saveModel(): Promise<void>;
  selectModel(scope: CoreScope, modelId: string): Promise<void>;
  openWorkspace(): Promise<void>;
  /** Display-only: true when the latest ready `workspaces/open` still belongs
   * to the dialog interaction that issued it. `main.ts` always merges the
   * authoritative returned bootstrap, but selects the scope only while this is
   * true (so a close/reopen cannot be stolen by a late response). */
  shouldSelectOpened(): boolean;
  /** Surface a merge-owner-detected inconsistency in the dialog state. */
  reportError(message: string): void;
}

/** One project heading with its ordered workspace children. Used by the left
 * navigation so a second workspace under the same project is never swallowed
 * and no scope is substituted by the first one. A single-workspace project
 * stays one child; the renderer adds no unnecessary extra nesting. */
export type SettingsWorkspaceGroup<T extends { scope: CoreScope }> = {
  projectId: string;
  workspaces: T[];
};

function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, character => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

function providerLabel(provider: SettingsProvider): string {
  return provider === 'deepseek' ? 'DeepSeek Chat' : 'OpenAI Responses';
}

function emptyModelDraft(): SettingsModelDraft {
  return { id: null, label: '', provider: 'deepseek', model: '', baseUrl: '',
    apiKey: '', thinking: null, reasoningEffort: null };
}

function emptyWorkspaceDraft(): SettingsWorkspaceDraft {
  return { path: '', name: '', projectId: '', modelId: '', writeAllowed: false, commandsAllowed: false };
}

/** Group workspaces by `scope.projectId` in first-seen order, keeping every
 * workspace. Works for both `SettingsWorkspace[]` and `BootstrapWorkspace[]`. */
export function groupWorkspacesByProject<T extends { scope: CoreScope }>(
  workspaces: readonly T[],
): SettingsWorkspaceGroup<T>[] {
  const groups: SettingsWorkspaceGroup<T>[] = [];
  const index = new Map<string, number>();
  for (const workspace of workspaces) {
    const projectId = workspace.scope.projectId;
    const existing = index.get(projectId);
    if (existing === undefined) {
      index.set(projectId, groups.length);
      groups.push({ projectId, workspaces: [workspace] });
    } else {
      const group = groups[existing];
      if (group !== undefined) group.workspaces.push(workspace);
    }
  }
  return groups;
}

function buildSaveModel(draft: SettingsModelDraft): SaveSettingsModel {
  const input: SaveSettingsModel = { label: draft.label, provider: draft.provider, model: draft.model };
  if (draft.id !== null && draft.id.length > 0) input.id = draft.id;
  const baseUrl = draft.baseUrl.trim();
  if (baseUrl.length > 0) input.baseUrl = baseUrl;
  // Blank key: omit the field entirely so the server keeps the stored one.
  if (draft.apiKey.length > 0) input.apiKey = draft.apiKey;
  if (draft.thinking !== null) input.thinking = draft.thinking;
  if (draft.reasoningEffort !== null) input.reasoningEffort = draft.reasoningEffort;
  return input;
}

function buildOpenWorkspace(draft: SettingsWorkspaceDraft): OpenSettingsWorkspace {
  const input: OpenSettingsWorkspace = {
    path: draft.path.trim(),
    writeAllowed: draft.writeAllowed,
    commandsAllowed: draft.commandsAllowed,
  };
  const name = draft.name.trim();
  if (name.length > 0) input.name = name;
  if (draft.modelId.length > 0) input.modelId = draft.modelId;
  // Empty means "create a new project": omit `projectId` rather than send ''.
  if (draft.projectId.length > 0) input.projectId = draft.projectId;
  return input;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createSettingsController(options: SettingsControllerOptions): SettingsController {
  const state: SettingsState = {
    open: false, section: 'workspace', snapshot: null, error: null, busy: false,
    directory: null, directoryError: null,
    model: emptyModelDraft(), workspace: emptyWorkspaceDraft(),
  };
  const render = (): void => options.render(state);
  // Bumped by every explicit open/close so a late `workspaces/open` response
  // cannot select a scope for a dialog interaction that is no longer current.
  let dialogGeneration = 0;
  let openedSelectionCurrent = false;

  async function loadSnapshot(): Promise<void> {
    state.busy = true;
    state.error = null;
    render();
    const response = await options.port.call('snapshot', {});
    state.busy = false;
    if (response.status === 'ready') {
      state.snapshot = response.value;
    } else {
      state.error = response.reason;
    }
    render();
  }

  async function open(section?: SettingsSection): Promise<void> {
    dialogGeneration += 1;
    state.open = true;
    if (section !== undefined) state.section = section;
    render();
    await loadSnapshot();
  }

  function close(): void {
    // Only flips the flag (plus the generation). An in-flight request
    // completing later must not reopen the dialog or select its scope; every
    // completion repaints from this same state.
    dialogGeneration += 1;
    state.open = false;
    render();
  }

  function setSection(section: SettingsSection): void {
    state.section = section;
    render();
  }

  async function browse(path?: string): Promise<void> {
    const target = (path ?? state.workspace.path).trim();
    state.busy = true;
    state.directoryError = null;
    render();
    const response = await options.port.call('directories', target.length === 0 ? {} : { path: target });
    state.busy = false;
    if (response.status === 'ready') {
      state.directory = response.value;
      state.workspace.path = response.value.path;
    } else {
      state.directoryError = response.reason;
    }
    render();
  }

  function newModel(): void {
    state.model = emptyModelDraft();
    render();
  }

  function editModel(id: string): void {
    const model = state.snapshot?.models.find(candidate => candidate.id === id);
    if (model === undefined) return;
    state.model = hydrateModel(model);
    render();
  }

  function setModelField<K extends keyof SettingsModelDraft>(field: K, value: SettingsModelDraft[K]): void {
    state.model[field] = value;
    if (field === 'provider' && value !== 'deepseek') {
      state.model.thinking = null;
      state.model.reasoningEffort = null;
    }
    // No repaint: typing must keep the focused control and its caret.
  }

  function setWorkspaceField<K extends keyof SettingsWorkspaceDraft>(field: K, value: SettingsWorkspaceDraft[K]): void {
    state.workspace[field] = value;
    if (field === 'commandsAllowed' && value === true) state.workspace.writeAllowed = true;
    if (field === 'writeAllowed' && value === false) state.workspace.commandsAllowed = false;
    // No repaint: typing must keep the focused control and its caret.
  }

  async function saveModel(): Promise<void> {
    const input = buildSaveModel(state.model);
    const previousModelIds = new Set(state.snapshot?.models.map(model => model.id) ?? []);
    state.busy = true;
    state.error = null;
    render();
    try {
      const response = await options.port.call('models/save', input);
      if (response.status !== 'ready') {
        state.error = response.reason;
        return;
      }
      state.snapshot = response.value;
      if (state.model.id === null) {
        const created = response.value.models.filter(model => !previousModelIds.has(model.id)
          && model.label === input.label && model.provider === input.provider && model.model === input.model);
        if (created.length === 1) state.model = hydrateModel(created[0]!);
      }
      // The browser never keeps or echoes a saved secret.
      state.model.apiKey = '';
      try {
        await options.reloadBootstrap();
      } catch (error) {
        // Keep the successful settings snapshot; never roll it back. The user
        // is told the profile list may be stale and can retry the refresh.
        state.error = `设置已保存，但核心配置刷新失败：${errorMessage(error)}。可稍后重试刷新。`;
      }
    } catch (error) {
      state.error = `保存模型失败：${errorMessage(error)}`;
    } finally {
      state.busy = false;
      render();
    }
  }

  async function selectModel(scope: CoreScope, modelId: string): Promise<void> {
    state.busy = true;
    state.error = null;
    render();
    try {
      const response = await options.port.call('models/select', { scope, modelId });
      if (response.status !== 'ready') {
        state.error = response.reason;
        return;
      }
      state.snapshot = response.value;
      try {
        await options.reloadBootstrap();
      } catch (error) {
        state.error = `模型选择已保存，但核心配置刷新失败：${errorMessage(error)}。可稍后重试刷新。`;
      }
    } catch (error) {
      state.error = `选择模型失败：${errorMessage(error)}`;
    } finally {
      state.busy = false;
      render();
    }
  }

  async function openWorkspace(): Promise<void> {
    const input = buildOpenWorkspace(state.workspace);
    const issued = dialogGeneration;
    openedSelectionCurrent = false;
    state.busy = true;
    state.error = null;
    render();
    try {
      const response = await options.port.call('workspaces/open', input);
      if (response.status !== 'ready') {
        state.error = response.reason;
        return;
      }
      state.snapshot = response.value.settings;
      // The merge owner always receives the authoritative result; selection is
      // only current while the issuing dialog interaction is still current.
      openedSelectionCurrent = state.open && issued === dialogGeneration;
      await options.onWorkspaceOpened(response.value);
      if (openedSelectionCurrent && state.error === null) close();
    } catch (error) {
      state.error = `打开工作区失败：${errorMessage(error)}`;
    } finally {
      state.busy = false;
      render();
    }
  }

  function shouldSelectOpened(): boolean {
    return openedSelectionCurrent;
  }

  function reportError(message: string): void {
    state.error = message;
    render();
  }

  return {
    state,
    open,
    close,
    setSection,
    loadSnapshot,
    browse,
    newModel,
    editModel,
    setModelField,
    setWorkspaceField,
    saveModel,
    selectModel,
    openWorkspace,
    shouldSelectOpened,
    reportError,
  };
}

function hydrateModel(model: SettingsModel): SettingsModelDraft {
  return {
    id: model.id,
    label: model.label,
    provider: model.provider,
    model: model.model,
    baseUrl: model.baseUrl,
    // Never repopulate a stored credential; the Host only reports whether one exists.
    apiKey: '',
    thinking: model.thinking ?? null,
    reasoningEffort: model.reasoningEffort ?? null,
  };
}

/** Fixed bottom-left gear entry, rendered OUTSIDE the scrolling project
 * navigation. Returns markup only; `main.ts` mounts it. */
export function renderSettingsEntry(state: SettingsState): string {
  return `<button type="button" class="settings-entry" id="settings-entry" data-action="open-settings"`
    + ` aria-haspopup="dialog" aria-expanded="${String(state.open)}" title="设置">`
    + `<span class="settings-entry-gear" aria-hidden="true">&#9881;</span><span>设置</span></button>`;
}

/** The single closeable dialog with the Workspace and Models sections. It is
 * always returned in full; `main.ts` decides whether to mount it. */
export function renderSettingsDialog(state: SettingsState): string {
  const busy = state.busy ? ' disabled' : '';
  const tab = (section: SettingsSection, label: string): string =>
    `<button type="button" role="tab" data-action="settings-section" data-section="${section}"`
    + ` aria-selected="${String(state.section === section)}">${label}</button>`;
  return `<div class="settings-modal" data-view="settings-dialog" role="dialog" aria-modal="true" aria-label="设置">`
    + `<header class="settings-modal-head"><h2>设置</h2>`
    + `<button type="button" class="settings-close" data-action="close-settings" aria-label="关闭设置" title="关闭">&#215;</button></header>`
    + `<div class="settings-tabs" role="tablist">${tab('workspace', '工作区')}${tab('models', '模型')}</div>`
    + `<div class="settings-body">`
    + (state.section === 'workspace' ? renderWorkspaceSection(state, busy) : renderModelsSection(state, busy))
    + `</div>`
    + (state.error === null ? '' : `<p class="settings-error" role="alert">${escapeHtml(state.error)}</p>`)
    + `</div>`;
}

function renderModelOptions(models: readonly SettingsModel[], selectedId: string, allowUnassigned = true): string {
  const options = models.map(model =>
    `<option value="${escapeHtml(model.id)}"${model.id === selectedId ? ' selected' : ''}>`
    + `${escapeHtml(model.label)} · ${escapeHtml(providerLabel(model.provider))} · ${escapeHtml(model.model)}`
    + (model.credentialConfigured ? '' : '（未配置密钥）') + `</option>`).join('');
  return `<option value=""${selectedId === '' ? ' selected' : ''}${allowUnassigned ? '' : ' disabled'}>${allowUnassigned ? '（不指定）' : '（尚未选择）'}</option>` + options;
}

function renderWorkspaceList(snapshot: HostSettingsSnapshot | null, busy: string): string {
  const groups = groupWorkspacesByProject(snapshot?.workspaces ?? []);
  if (groups.length === 0) return '<p class="muted">尚无已配置工作区。</p>';
  const models = snapshot?.models ?? [];
  return groups.map(group => {
    const workspaces = group.workspaces.map(workspace =>
      `<li data-scope-project="${escapeHtml(workspace.scope.projectId)}" data-scope-workspace="${escapeHtml(workspace.scope.workspaceId)}">`
      + `<div class="settings-workspace-name">${escapeHtml(workspace.name)}</div>`
      + `<div class="muted settings-workspace-root">${escapeHtml(workspace.root)}</div>`
      + `<label class="settings-field settings-inline">模型`
      + `<select data-action="settings-select-model" data-scope-project="${escapeHtml(workspace.scope.projectId)}"`
      + ` data-scope-workspace="${escapeHtml(workspace.scope.workspaceId)}"${busy}>`
      + renderModelOptions(models, workspace.modelId ?? '', false)
      + `</select></label></li>`).join('');
    return `<div class="settings-project-group" data-project="${escapeHtml(group.projectId)}">`
      + `<h4>${escapeHtml(group.workspaces[0]?.name ?? group.projectId)}</h4><ul class="settings-workspace-list">${workspaces}</ul></div>`;
  }).join('');
}

function renderWorkspaceSection(state: SettingsState, busy: string): string {
  const directory = state.directory;
  const parent = directory?.parent ?? null;
  const children = directory === null ? ''
    : directory.directories.length === 0 ? '<li class="muted">（没有子目录）</li>'
      : directory.directories.map(entry =>
        `<li><button type="button" data-action="settings-directory-child" data-path="${escapeHtml(entry.path)}">`
        + `${escapeHtml(entry.name)}</button></li>`).join('');
  const groups = groupWorkspacesByProject(state.snapshot?.workspaces ?? []);
  const projectOptions = groups.map(group =>
    `<option value="${escapeHtml(group.projectId)}"${state.workspace.projectId === group.projectId ? ' selected' : ''}>`
    + `${escapeHtml(group.workspaces[0]?.name ?? group.projectId)}</option>`).join('');
  const models = state.snapshot?.models ?? [];
  return `<section data-panel="workspace" class="settings-section-panel">`
    + `<p class="settings-hint">输入目录路径，或点击“浏览文件夹”选择本机目录。</p>`
    + `<label class="settings-field">文件夹绝对路径`
    + `<input type="text" data-field="settings-directory-path" value="${escapeHtml(state.workspace.path)}"`
    + ` placeholder="/绝对路径" autocomplete="off" spellcheck="false"></label>`
    + `<div class="settings-row">`
    + `<button type="button" data-action="settings-directory-go"${busy}>${directory === null ? '浏览文件夹' : '转到'}</button>`
    + `<button type="button" data-action="settings-directory-parent"${parent === null ? ' disabled' : busy}>上级</button>`
    + `<button type="button" data-action="settings-directory-refresh"${busy}>刷新</button>`
    + `</div>`
    + (directory === null ? '' : `<p class="muted settings-directory-current">当前：${escapeHtml(directory.path)}`
      + `${directory.truncated ? ' · 列表已截断' : ''}</p>`)
    + (state.directoryError === null ? '' : `<p class="settings-error" role="alert">${escapeHtml(state.directoryError)}</p>`)
    + (children === '' ? '' : `<ul class="settings-directory-list">${children}</ul>`)
    + `<label class="settings-field">名称（可选）`
    + `<input type="text" data-field="settings-workspace-name" value="${escapeHtml(state.workspace.name)}" autocomplete="off"></label>`
    + `<label class="settings-field">归属项目`
    + `<select data-field="settings-workspace-project"><option value=""${state.workspace.projectId === '' ? ' selected' : ''}>`
    + `新建项目</option>${projectOptions}</select></label>`
    + (state.workspace.projectId === ''
      ? '<p class="muted settings-hint">将创建一个新项目。</p>'
      : `<p class="muted settings-hint">将添加为所选项目的新工作区。</p>`)
    + `<label class="settings-field">配置模型`
    + `<select data-field="settings-workspace-model">${renderModelOptions(models, state.workspace.modelId)}</select></label>`
    + `<label class="settings-check"><input type="checkbox" data-field="settings-workspace-write"`
    + `${state.workspace.writeAllowed ? ' checked' : ''}${busy}>允许写入</label>`
    + `<label class="settings-check"><input type="checkbox" data-field="settings-workspace-commands"`
    + `${state.workspace.commandsAllowed ? ' checked' : ''}${state.workspace.writeAllowed ? '' : ' disabled'}${busy}>`
    + `允许运行命令（需先允许写入）</label>`
    + `<div class="settings-row"><button type="button" data-action="settings-open-workspace"${busy}>打开此文件夹</button></div>`
    + `<details class="settings-existing"><summary>已配置工作区（按项目分组）</summary>`
    + renderWorkspaceList(state.snapshot, busy) + `</details>`
    + `</section>`;
}

function renderModelsSection(state: SettingsState, busy: string): string {
  const models = state.snapshot?.models ?? [];
  const list = models.length === 0 ? '<p class="muted">尚无已配置模型。</p>'
    : `<ul class="settings-model-list">${models.map(model =>
      `<li data-model="${escapeHtml(model.id)}">`
      + `<div class="settings-model-name">${escapeHtml(model.label)}</div>`
      + `<div class="muted">${escapeHtml(providerLabel(model.provider))} · ${escapeHtml(model.model)}`
      + ` · ${model.credentialConfigured ? '密钥已配置' : '密钥未配置'}</div>`
      + `<div class="settings-row"><button type="button" data-action="settings-edit-model"`
      + ` data-model="${escapeHtml(model.id)}"${busy}>编辑</button></div></li>`).join('')}</ul>`;
  const draft = state.model;
  const deepseek = draft.provider === 'deepseek';
  return `<section data-panel="models" class="settings-section-panel">`
    + list
    + `<div class="settings-model-form"><h3>${draft.id === null ? '新建模型' : '编辑模型'}</h3>`
    + `<label class="settings-field">名称<input type="text" data-field="settings-model-label"`
    + ` value="${escapeHtml(draft.label)}" autocomplete="off"></label>`
    + `<label class="settings-field">协议<select data-field="settings-model-provider">`
    + `<option value="deepseek"${deepseek ? ' selected' : ''}>DeepSeek Chat</option>`
    + `<option value="openai"${deepseek ? '' : ' selected'}>OpenAI Responses</option></select></label>`
    + `<label class="settings-field">模型<input type="text" data-field="settings-model-model"`
    + ` value="${escapeHtml(draft.model)}" autocomplete="off" placeholder="服务商提供的模型名称"></label>`
    + `<label class="settings-field">Base URL<input type="text" data-field="settings-model-baseurl"`
    + ` value="${escapeHtml(draft.baseUrl)}" autocomplete="off" spellcheck="false"></label>`
    + `<label class="settings-field">API Key（密码，留空保留现有）`
    + `<input type="password" data-field="settings-model-apikey" value="${escapeHtml(draft.apiKey)}"`
    + ` autocomplete="new-password" placeholder="${draft.id === null ? '' : '留空保留现有密钥'}"></label>`
    + (deepseek
      ? `<label class="settings-field">思考<select data-field="settings-model-thinking">`
        + `<option value=""${draft.thinking === null ? ' selected' : ''}>默认</option>`
        + `<option value="enabled"${draft.thinking === 'enabled' ? ' selected' : ''}>enabled</option>`
        + `<option value="disabled"${draft.thinking === 'disabled' ? ' selected' : ''}>disabled</option></select></label>`
        + `<label class="settings-field">推理强度<select data-field="settings-model-effort">`
        + `<option value=""${draft.reasoningEffort === null ? ' selected' : ''}>默认</option>`
        + `<option value="low"${draft.reasoningEffort === 'low' ? ' selected' : ''}>low</option>`
        + `<option value="high"${draft.reasoningEffort === 'high' ? ' selected' : ''}>high</option>`
        + `<option value="max"${draft.reasoningEffort === 'max' ? ' selected' : ''}>max</option></select></label>`
      : '')
    + `<div class="settings-row"><button type="button" data-action="settings-save-model"${busy}>保存模型</button>`
    + `<button type="button" data-action="settings-new-model"${busy}>新建模型</button></div>`
    + `<p class="settings-hint">保存不会启动模型；新选择用于后续执行，已开始的执行保留原模型。</p>`
    + `</div></section>`;
}
