/** The one core request path: freeze the request on its scope, send it and hand the reply to applyResult. */

import type { CoreRouteSuffix } from '../../app/core-http-types.js';
import { callCore } from './http.js';
import { noTags } from './request-tags.js';
import type { RequestTags } from './request-tags.js';
import { applyResult } from '../state/apply-result.js';
import type { ScopeState } from '../state/scope-state.js';
import { centerSessionHistoryKey, record } from '../state/values.js';
import { renderScopeIfSelected } from '../state/workbench.js';
import { matchesHistoryAppendCursor } from '../views/sessions/requests.js';

export async function submit(scope: ScopeState, route: CoreRouteSuffix, body: unknown, tags: RequestTags = noTags): Promise<void> {
  if (route === 'sessions/history' && tags.session !== null && tags.pageKey === centerSessionHistoryKey(tags.session)) {
    const after = record(record(body).input).afterCursor;
    const afterCursor = typeof after === 'string' ? after : null;
    const generation = (scope.historyGenerations.get(tags.pageKey) ?? 0) + (afterCursor === null ? 1 : 0);
    scope.historyGenerations.set(tags.pageKey, generation);
    tags = { ...tags, historyNext: afterCursor !== null, historyAfterCursor: afterCursor, historyGeneration: generation };
  }
  scope.pending = { route, body, tags };
  scope.sending = true;
  scope.error = null;
  scope.notice = null;
  renderScopeIfSelected(scope);

  const outcome = await callCore(route, body);
  if (tags.historyGeneration !== undefined && tags.pageKey !== null
    && scope.historyGenerations.get(tags.pageKey) !== tags.historyGeneration) return;
  if (tags.historyGeneration !== undefined && tags.historyNext && tags.pageKey !== null) {
    const previous = scope.sessionHistories.get(tags.pageKey);
    if (previous?.result.status !== 'ready' || !matchesHistoryAppendCursor(previous.result, tags.historyAfterCursor)) return;
  }
  scope.sending = false;
  if (outcome.kind === 'network') {
    scope.error = '连接中断，未收到回执。可重新发送原请求（内容保持不变）。';
    renderScopeIfSelected(scope);
    return;
  }
  if (outcome.status === 403) {
    scope.error = '连接已失效，请刷新页面重新连接。未完成的写操作不会自动重发。';
    renderScopeIfSelected(scope);
    return;
  }
  scope.pending = null;
  scope.lastRequest = { route, body, tags };
  scope.lastResponse = { route, payload: outcome.payload };
  applyResult(scope, route, outcome.payload, tags);
  renderScopeIfSelected(scope);
}
