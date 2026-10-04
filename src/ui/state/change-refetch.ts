/**
 * Record-notice refetches (task E). A commit notice that touches `goals` or
 * `tasks` of the selected workspace's project re-reads the Goal detail and the
 * Task graph that workspace already shows, and nothing else. It is quiet: it
 * writes only those two slices, and only from a `ready` reply for the same Goal
 * that is still shown (like the one-time sync after a completed collaboration),
 * so it never touches the pending request, error, notice, forms or the last
 * request. A workspace that is not selected keeps what it had, as before.
 */
import type { ChangeKind, ChangeNotice, CoreScope } from '../../app/core-http-types.js';
import { callCore, payloadOf } from '../api/http.js';
import { refreshHub } from '../api/refresh.js';
import type { RefreshHub } from '../api/refresh.js';
import type { ScopeState } from './scope-state.js';
import { record } from './values.js';
import { renderScopeIfSelected, scopes, selectedKey } from './workbench.js';

const GOAL_GRAPH_KINDS: ReadonlySet<ChangeKind> = new Set<ChangeKind>(['goals', 'tasks']);

/** The Goal of a `ready` goals/read reply; null for nothing shown or a failed read. */
export function shownGoalId(goalRead: unknown): string | null {
  const envelope = record(goalRead);
  if (envelope.status !== 'ready') return null;
  const goalId = record(record(record(envelope.value).goal).ref).goalId;
  return typeof goalId === 'string' && goalId.length > 0 ? goalId : null;
}

function shownGraphGoalId(scope: ScopeState): string | null {
  return scope.taskGraph !== null && scope.taskGraphGoalId.length > 0 ? scope.taskGraphGoalId : null;
}

export function goalGraphNoticeMatches(scope: ScopeState | undefined, notice: ChangeNotice): boolean {
  if (scope === undefined || !notice.kinds.some(kind => GOAL_GRAPH_KINDS.has(kind))) return false;
  if (!notice.projects.includes(scope.config.scope.projectId)) return false;
  return shownGoalId(scope.goalRead) !== null || shownGraphGoalId(scope) !== null;
}

const goalRef = (target: CoreScope, goalId: string) => ({ aggregateType: 'Goal' as const, projectId: target.projectId, goalId });

/** Re-read the shown Goal detail and Task graph of one workspace. */
export async function refetchGoalGraph(scope: ScopeState): Promise<void> {
  const target = scope.config.scope;
  const goalId = shownGoalId(scope.goalRead);
  const graphGoalId = shownGraphGoalId(scope);
  let changed = false;
  if (goalId !== null) {
    const payload = payloadOf(await callCore('goals/read', { scope: target, input: goalRef(target, goalId) }));
    if (record(payload).status === 'ready' && shownGoalId(scope.goalRead) === goalId) { scope.goalRead = payload; changed = true; }
  }
  if (graphGoalId !== null) {
    const payload = payloadOf(await callCore('tasks/query', { scope: target, input: { goalRef: goalRef(target, graphGoalId) } }));
    if (record(payload).status === 'ready' && shownGraphGoalId(scope) === graphGoalId) { scope.taskGraph = payload; changed = true; }
  }
  if (changed) renderScopeIfSelected(scope);
}

/** Register the record-notice refetches on the page hub. Returns the unsubscribe. */
export function watchRecordChanges(hub: Pick<RefreshHub, 'watchChanges'> = refreshHub): () => void {
  const selected = (): ScopeState | undefined => scopes().get(selectedKey());
  return hub.watchChanges(notice => goalGraphNoticeMatches(selected(), notice), () => {
    const scope = selected();
    return scope === undefined ? undefined : refetchGoalGraph(scope);
  });
}
