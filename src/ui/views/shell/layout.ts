/// <reference lib="dom" />

import { setHtml } from '../../components/dom.js';
import { renderGap } from '../../components/html.js';
import { view } from '../../state/workbench.js';

// ---------------------------------------------------------------------------
// R6 UI-layout: fixed three-column workbench over the existing read results.
// Left = project/Agent navigation, center = original Session conversation,
// right = multi-tab auxiliary workspace. Layout/selection/tab/scroll/draft are
// display state only; every write still flows through the builders above.
// ---------------------------------------------------------------------------

export const AUX_MIN_LEFT = 180;
export const AUX_MIN_RIGHT = 240;
const AUX_MIN_CENTER = 320;

export const app = typeof document === 'undefined' ? null : document.getElementById('app');

/** Apply the display-only splitter widths and the auxiliary hidden/expanded
 * state without rebuilding any panel or issuing a request. */
export function applyWorkbenchLayout(): void {
  const root = document.getElementById('workbench-root');
  if (root === null) return;
  root.style.setProperty('--wb-left', `${view.leftWidth}px`);
  root.style.setProperty('--wb-right', `${view.rightWidth}px`);
  root.dataset.aux = String(view.auxVisible);
  root.dataset.expanded = String(view.auxExpanded);
  root.dataset.nav = String(view.navVisible);
  document.documentElement.dataset.theme = view.theme;
  const panel = document.getElementById('region-panel');
  if (panel !== null) panel.hidden = !view.auxVisible;
  for (const splitter of document.querySelectorAll<HTMLElement>('[data-splitter]')) {
    const side = splitter.dataset.splitter === 'left' ? 'left' : 'right';
    splitter.setAttribute('aria-valuenow', String(side === 'left' ? view.leftWidth : view.rightWidth));
    splitter.setAttribute('aria-valuemin', String(side === 'left' ? AUX_MIN_LEFT : AUX_MIN_RIGHT));
  }
}

export function buildShell(): void {
  if (app === null) return;
  app.innerHTML = `<div class="workbench-root" id="workbench-root" data-aux="false" data-expanded="false" data-nav="true">`
    + `<header class="q-top" id="region-topbar" data-view="topbar"></header>`
    + `<div class="q-body">`
    + `<aside class="q-side" id="region-side" aria-label="项目与成员"><div id="region-scope"></div>`
    + `<div id="region-nav" class="q-side-scroll" data-scroll="nav"></div>`
    + `<div class="q-split q-split-left" id="splitter-left" role="separator" aria-orientation="vertical" tabindex="0" aria-label="调整左栏宽度" data-splitter="left"></div></aside>`
    + `<main class="q-center"><div id="region-center-head"></div>`
    + `<div class="q-chat" id="region-conversation" data-scroll="conversation"></div>`
    + `<div class="q-compose-wrap" id="region-composer"></div></main>`
    + `<aside class="q-panel" id="region-panel" aria-label="辅助工作区" hidden><div class="q-panelhead" id="region-tabs"></div>`
    + `<div class="q-panel-scroll" id="region-tab-body" data-scroll="tab-body"></div>`
    + `<div class="q-detail" id="region-detail" hidden></div>`
    + `<div class="q-split q-split-right" id="splitter-right" role="separator" aria-orientation="vertical" tabindex="0" aria-label="调整右栏宽度" data-splitter="right"></div></aside>`
    + `</div><div id="settings-mount"></div><div class="q-status" id="region-last"></div></div>`;
  applyWorkbenchLayout();
}

export function fatal(message: string): void {
  if (app !== null) app.innerHTML = renderGap('本地服务', message);
}

/** Update only the rendered graphs' selected mark and the selection panel; the
 * node elements themselves are never replaced. */
// (removed) node selection re-renders the graph and the lower detail pane.
export function splitLimit(side: 'left' | 'right'): number {
  const available = window.innerWidth - AUX_MIN_CENTER - 12;
  return side === 'left'
    ? Math.max(AUX_MIN_LEFT, available - view.rightWidth)
    : Math.max(AUX_MIN_RIGHT, available - view.leftWidth);
}

export function setSplit(side: 'left' | 'right', width: number): void {
  const bounded = Math.min(splitLimit(side), Math.max(side === 'left' ? AUX_MIN_LEFT : AUX_MIN_RIGHT, width));
  if (side === 'left') view.leftWidth = bounded;
  else { view.rightWidth = bounded; view.savedRightWidth = bounded; }
  applyWorkbenchLayout();
}

/** The first-folder shell: no invented scope, no state() call, settings only. */
export function renderEmptyWorkbench(): void {
  setHtml('region-topbar', '<strong>工作台</strong>');
  setHtml('region-scope', '');
  setHtml('region-nav', '<div class="q-section">项目</div><p class="q-nav-empty">还没有工作区</p>');
  setHtml('region-center-head', '');
  setHtml('region-conversation',
    '<section class="conversation" data-view="empty-workspace"><h2>尚未打开工作区</h2>'
    + '<p class="muted">使用左下角“设置”打开本机的一个真实文件夹作为第一个工作区。</p></section>');
  setHtml('region-composer', '');
  setHtml('region-tabs', '');
  setHtml('region-tab-body', '');
  setHtml('region-detail', '');
  setHtml('region-last', '');
}
