import type { ExecutionsListResponse, TaskGraph } from '../../../app/core-http-types.js';
import { callCore, payloadOf } from '../../api/http.js';
import type { ExecutionListCache, ScopeState } from '../../state/scope-state.js';
import { renderScopeIfSelected } from '../../state/workbench.js';
import { taskTimelineRunKey } from '../observe/render.js';

// --- Bounded real execution list shared by the timeline/fold/active modules ---

export function currentGoalRefForList(scope: ScopeState): TaskGraph['plan']['goalRef'] | null {
  const goalId = scope.forms.goalId.trim() || scope.goal?.ref.goalId || '';
  if (goalId.length === 0) return null;
  return { aggregateType: 'Goal', projectId: scope.config.scope.projectId, goalId };
}

export async function loadExecutions(scope: ScopeState, next: boolean, requestedGoal?: TaskGraph['plan']['goalRef']): Promise<void> {
  const selectedTab = scope.auxTabs.find(tab => tab.tabId === scope.auxActiveTabId);
  const goalRef = requestedGoal ?? (selectedTab?.kind === 'task_graph' ? selectedTab.goal : currentGoalRefForList(scope));
  if (goalRef === null) { scope.error = '请先创建或选择目标。'; renderScopeIfSelected(scope); return; }
  const previous = scope.executionList;
  const sameGoal = previous?.goalRef.projectId === goalRef.projectId && previous.goalRef.goalId === goalRef.goalId;
  const afterCursor = next && sameGoal ? previous!.nextCursor : null;
  if (next && (previous === null || afterCursor === null)) { scope.notice = '执行列表没有更多页。'; renderScopeIfSelected(scope); return; }
  const reuse = next && previous !== null && sameGoal;
  const list: ExecutionListCache = reuse ? previous
    : { goalRef, items: [], nextCursor: null, readThrough: null, loading: true, error: null };
  list.loading = true;
  list.error = null;
  scope.executionList = list;
  renderScopeIfSelected(scope);
  const outcome = await callCore('executions/list', { scope: scope.config.scope, input: { goalRef, page: { afterCursor, limit: 50 } } });
  list.loading = false;
  if (outcome.kind === 'network') { list.error = `执行列表读取失败：${outcome.reason}`; renderScopeIfSelected(scope); return; }
  if (outcome.status === 403) { list.error = '连接已失效，请刷新页面。'; renderScopeIfSelected(scope); return; }
  const payload = payloadOf(outcome) as ExecutionsListResponse;
  if (payload.status !== 'ready') {
    list.error = `执行列表未就绪（${payload.status}）：${payload.status === 'rejected' ? payload.reason : ''}`;
    renderScopeIfSelected(scope);
    return;
  }
  const seen = new Set(list.items.map(item => taskTimelineRunKey(item.run.ref)));
  for (const item of payload.value.items) {
    const key = taskTimelineRunKey(item.run.ref);
    if (seen.has(key)) continue;
    seen.add(key);
    list.items.push(item);
  }
  list.nextCursor = payload.value.nextCursor;
  list.readThrough = payload.value.readThrough;
  renderScopeIfSelected(scope);
}
