/// <reference lib="dom" />
/** The paint loop: per-tab and per-Session display capture and restore around the one paint of every region. */

import {
  captureFocus,
  captureScroll,
  disclosureKey,
  restoreFocus,
  restoreScroll,
  setHtml,
} from '../../components/dom.js';
import type { ScopeState } from '../../state/scope-state.js';
import { bootstrap, centerSessionOf, renderMemory, scopes, selectedKey } from '../../state/workbench.js';
import { renderCenterBody, renderCenterHead } from '../conversation/center.js';
import { renderComposer } from '../conversation/composer.js';
import { renderDetail } from '../graphs/detail.js';
import { renderNav } from '../nav/project-tree.js';
import { renderScope } from '../setup/panels.js';
import { renderLastPanel, renderTopBar } from './bars.js';
import { applyWorkbenchLayout } from './layout.js';
import { activeLayout } from '../tabs/aux-layout.js';
import { renderTabBody, renderTabs } from '../tabs/strip.js';

function currentCenterKey(): string | null {
  const current = scopes().get(selectedKey());
  if (current === undefined) return null;
  const session = centerSessionOf(current);
  return `${current.key}|${session?.sessionId ?? ''}`;
}
function captureRenderedCenter(): void {
  if (renderMemory.renderedCenterKey === null) return;
  const body = document.getElementById('region-conversation');
  if (body === null) return;
  renderMemory.centerDisplay.set(renderMemory.renderedCenterKey, {
    openDetails: new Map(Array.from(body.querySelectorAll('details')).map(detail => [disclosureKey(detail, body), detail.open])),
  });
}
function restoreCenterDisplay(): void {
  const key = currentCenterKey();
  const body = document.getElementById('region-conversation');
  if (body !== null && key !== null) {
    const saved = renderMemory.centerDisplay.get(key);
    if (saved !== undefined) {
      body.querySelectorAll('details').forEach(detail => {
        const open = saved.openDetails.get(disclosureKey(detail, body));
        if (open !== undefined) detail.open = open;
      });
    }
  }
  renderMemory.renderedCenterKey = key;
}
function captureConversationScroll(): void {
  const body = document.getElementById('region-conversation');
  if (body === null || renderMemory.renderedCenterKey === null) return;
  renderMemory.conversationScroll = { key: renderMemory.renderedCenterKey, top: body.scrollTop,
    atBottom: body.scrollHeight - body.scrollTop - body.clientHeight <= 24 };
}
function restoreConversationScroll(): void {
  const body = document.getElementById('region-conversation');
  if (body === null) return;
  const key = currentCenterKey();
  if (renderMemory.stickToBottom) {
    renderMemory.stickToBottom = false;
    body.scrollTop = body.scrollHeight;
    renderMemory.conversationScroll = key === null ? null : { key, top: body.scrollTop, atBottom: true };
    return;
  }
  // Same Session keeps its place (and sticks to the bottom only if it was
  // already there); a different Session is never pulled to the old offset.
  if (renderMemory.conversationScroll !== null && key !== null && renderMemory.conversationScroll.key === key) {
    body.scrollTop = renderMemory.conversationScroll.atBottom ? body.scrollHeight : renderMemory.conversationScroll.top;
  } else {
    body.scrollTop = 0;
  }
}

const tabKey = (scope: ScopeState, tabId: string | null): string =>
  `${scope.key}|${tabId ?? ''}`;

/** Snapshot the currently rendered auxiliary page before a re-render so each tab
 * keeps its own scroll, text selection and expanded details. */
function captureRenderedTab(): void {
  if (renderMemory.renderedTabKey === null) return;
  const body = document.getElementById('region-tab-body');
  if (body === null) return;
  const editor = body.querySelector<HTMLTextAreaElement>('[data-field="fileEditor"]');
  renderMemory.tabDisplay.set(renderMemory.renderedTabKey, {
    scrollTop: body.scrollTop,
    scrollLeft: body.scrollLeft,
    selectionStart: editor?.selectionStart ?? 0,
    selectionEnd: editor?.selectionEnd ?? 0,
    openDetails: new Map(Array.from(body.querySelectorAll('details')).map(detail => [disclosureKey(detail, body), detail.open])),
  });
}

function restoreTabDisplay(key: string): void {
  const body = document.getElementById('region-tab-body');
  if (body === null) return;
  const saved = renderMemory.tabDisplay.get(key);
  if (saved === undefined) { body.scrollTop = 0; body.scrollLeft = 0; return; }
  body.scrollTop = saved.scrollTop;
  body.scrollLeft = saved.scrollLeft;
  const editor = body.querySelector<HTMLTextAreaElement>('[data-field="fileEditor"]');
  if (editor !== null) {
    try { editor.setSelectionRange(saved.selectionStart, saved.selectionEnd); } catch { /* not selectable */ }
  }
  const details = body.querySelectorAll('details');
  details.forEach(detail => { const open = saved.openDetails.get(disclosureKey(detail, body)); if (open !== undefined) detail.open = open; });
}

/** The one paint of every region. Only main()'s `render` listener calls it;
 * everything else asks for a paint with renderAll()/renderScopeIfSelected(). */
export function paintAll(): void {
  if (bootstrap() === null) return;
  const current = scopes().get(selectedKey());
  captureRenderedTab();
  captureRenderedCenter();
  captureConversationScroll();
  const focus = captureFocus();
  const scroll = captureScroll();
  setHtml('region-topbar', renderTopBar());
  setHtml('region-scope', renderScope());
  setHtml('region-nav', renderNav());
  setHtml('region-center-head', renderCenterHead());
  setHtml('region-conversation', renderCenterBody());
  setHtml('region-composer', renderComposer());
  setHtml('region-tabs', renderTabs());
  setHtml('region-tab-body', renderTabBody());
  setHtml('region-detail', renderDetail());
  setHtml('region-last', renderLastPanel());
  applyWorkbenchLayout();
  restoreScroll(scroll);
  restoreCenterDisplay();
  restoreConversationScroll();
  if (current !== undefined) {
    const layout = activeLayout(current);
    const key = tabKey(current, layout.activeTabId);
    restoreTabDisplay(key);
    renderMemory.renderedTabKey = key;
  }
  restoreFocus(focus);
}
