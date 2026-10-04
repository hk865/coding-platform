/** The auxiliary tab strip and the dispatch of the active tab body. */

import { escapeHtml } from '../../components/html.js';
import { topIcon } from '../../components/icons.js';
import { state, view } from '../../state/workbench.js';
import { renderCompareForm, renderDiffTab, renderDirectoryTab, renderFileTab } from '../files/tabs.js';
import { renderModuleDetailTab, renderTaskDetailTab } from '../graphs/detail.js';
import { renderArchitectureTab, renderGraphContext, renderTaskTab } from '../graphs/tabs.js';
import { renderExecutionHistoryTab, renderHistoryTab, renderSessionTab } from '../sessions/tabs.js';
import { renderSetupTab } from '../setup/panels.js';
import { renderPageChooser } from '../shell/bars.js';
import { syncActiveLayout } from './aux-layout.js';
import { renderTerminalTab } from '../terminal/commands.js';

export function renderTabs(): string {
  const layout = syncActiveLayout(state());
  const tabs = layout.tabs.map(tab => {
    const active = tab.tabId === layout.activeTabId;
    const draft = tab.kind === 'file' && tab.editorDraft !== null;
    return `<span class="q-page${active ? ' active' : ''}">`
      + `<button data-action="activate-tab" data-tab="${escapeHtml(tab.tabId)}" aria-pressed="${String(active)}">${escapeHtml(tab.title)}${draft ? ' · 草稿' : ''}</button>`
      + `<button class="q-page-close" data-action="close-tab" data-tab="${escapeHtml(tab.tabId)}" aria-label="关闭 ${escapeHtml(tab.title)}">×</button></span>`;
  }).join('');
  return `<div class="q-pages" role="tablist">${tabs}</div>`
    + `<button class="q-icon" data-action="open-page" data-page="blank" aria-label="新建页面" title="新建页面">${topIcon('plus')}</button>`
    + `<button class="q-icon" data-action="expand-aux" aria-label="放大辅助区" aria-pressed="${String(view.auxExpanded)}" title="放大辅助区">${topIcon('maximize')}</button>`
    + `<button class="q-icon" data-action="toggle-aux" aria-label="隐藏辅助区" title="隐藏辅助区">${topIcon('panel-right-close')}</button>`;
}

export function renderTabBody(): string {
  const layout = syncActiveLayout(state());
  const tab = layout.tabs.find(candidate => candidate.tabId === layout.activeTabId);
  if (tab === undefined) return renderPageChooser();
  const context = (tab.kind === 'task_graph' || tab.kind === 'architecture_graph') ? renderGraphContext(tab) : '';
  switch (tab.kind) {
    case 'setup': return renderSetupTab();
    case 'project_chat': return '<p class="muted">项目主对话显示在中间栏。</p>';
    case 'session_chat': return renderSessionTab(tab);
    case 'history': return renderHistoryTab(tab);
    case 'execution_history': return renderExecutionHistoryTab(tab);
    case 'file': return renderFileTab(layout, tab);
    case 'directory': return renderDirectoryTab(layout, tab);
    case 'task_graph': return context + renderTaskTab(tab);
    case 'architecture_graph': return context + renderArchitectureTab(tab);
    case 'task_detail': return renderTaskDetailTab(tab);
    case 'module_detail': return renderModuleDetailTab(tab);
    case 'terminal': return renderTerminalTab(tab);
    case 'diff': return renderDiffTab(tab);
    case 'compare': return renderCompareForm();
    case 'blank': return renderPageChooser();
    default: return renderPageChooser();
  }
}
