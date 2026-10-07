/** The top bar, the page chooser and the bottom status line. */

import { routeLabel } from '../../api/routes.js';
import { escapeHtml } from '../../components/html.js';
import { topIcon } from '../../components/icons.js';
import { bootstrap, scopes, selectedKey, state, view } from '../../state/workbench.js';

export function renderTopBar(): string {
  if (bootstrap() === null) return '';
  const current = scopes().get(selectedKey());
  const tool = (page: string, label: string, icon: string): string =>
    `<button class="q-icon" data-action="open-page" data-page="${page}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${topIcon(icon)}</button>`;
  return `<button class="q-icon" data-action="toggle-nav" aria-label="展开或收起项目导航" aria-pressed="${String(view.navVisible)}" title="项目导航">${topIcon('panel-left')}</button>`
    + `<strong>${escapeHtml(current?.config.name ?? '工作台')}</strong><span class="q-fill"></span>`
    + `<nav class="q-right-tools" aria-label="右侧资料与工具">`
    + tool('tasks', '任务图', 'git-branch') + tool('architecture', '架构图', 'network')
    + tool('files', '文件树', 'file-text') + tool('terminal', '命令', 'terminal') + tool('diff', 'Diff', 'git-compare')
    + `</nav>`
    + `<button class="q-icon" data-action="toggle-aux" aria-label="显示或隐藏右侧工作区" aria-expanded="${String(view.auxVisible)}" title="辅助工作区">${topIcon(view.auxVisible ? 'panel-right-close' : 'panel-right')}</button>`
    + `<button class="q-icon" data-action="toggle-theme" aria-label="切换明暗主题" title="主题">${topIcon('sun-moon')}</button>`;
}

export function renderPageChooser(): string {
  const item = (page: string, label: string, icon: string): string =>
    `<button data-action="open-page" data-page="${page}">${topIcon(icon)}<span>${escapeHtml(label)}</span></button>`;
  return `<div class="q-chooser" data-view="page-chooser"><span>打开一个工作页面</span>`
    + item('tasks', '任务图', 'git-branch') + item('architecture', '架构图', 'network')
    + item('files', '文件资源管理器', 'file-text') + item('terminal', '命令', 'terminal')
    + item('diff', 'Diff', 'git-compare')
    + `<button data-action="open-setup-tab">${topIcon('settings')}<span>项目设置（次级）</span></button></div>`;
}

export function renderLastPanel(): string {
  const current = state();
  const parts: string[] = [];
  if (current.notice !== null) parts.push(`<span class="notice">${escapeHtml(current.notice)}</span>`);
  if (current.error !== null) parts.push(`<span class="error">${escapeHtml(current.error)}</span>`);
  if (current.sending) parts.push('<span>正在发送…</span>');
  if (current.pending !== null && !current.sending) {
    parts.push(`<span>${escapeHtml(routeLabel(current.pending.route))}：结果尚未确认。</span>`
      + `<button data-action="retry">重试原请求</button>`);
  }
  return parts.join(' ');
}
