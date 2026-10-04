/** Display restore: re-open the stored Goal and Session selection of one scope through the owner reads. */

import type { SessionCard, SessionRef, SessionsReadResponse } from '../../../app/core-http-types.js';
import { callCore, payloadOf } from '../../api/http.js';
import { tagsFor } from '../../api/request-tags.js';
import { submit } from '../../api/submit.js';
import { displayPreferenceStore } from '../../state/display-preference.js';
import type { ScopeDisplayReadPort } from '../../state/display-preference.js';
import type { GoalValue, ScopeState } from '../../state/scope-state.js';
import { centerSessionHistoryKey, record, sameSession } from '../../state/values.js';
import { renderAll } from '../../state/workbench.js';
import { loadPlanCandidate } from '../execution/planning.js';
import { CENTER_HISTORY_LIMIT, buildSessionHistoryRequest, probeResumableOriginal } from './requests.js';

/** Re-open the stored display identity for THIS scope through the formal owner
 * reads. A restore is NOT a selection: it applies the ready Goal/active/main
 * facts in ONE guarded step and never rewrites the persisted preference. */
export async function restoreScopeDisplay(scope: ScopeState): Promise<void> {
  if (scope.displayRestore !== 'idle') return;
  scope.displayRestore = 'running';
  const target = scope.config.scope;
  let networkFailed = false;
  const read: ScopeDisplayReadPort = {
    readGoal: async goalId => {
      const outcome = await callCore('goals/read',
        { scope: target, input: { aggregateType: 'Goal', projectId: target.projectId, goalId } });
      if (outcome.kind === 'network') networkFailed = true;
      const payload = outcome.kind === 'response' ? payloadOf(outcome) : null;
      return payload !== null && record(payload).status === 'ready'
        ? { status: 'ready' as const, value: record(payload).value } : null;
    },
    readSession: async sessionId => {
      const outcome = await callCore('sessions/read',
        { scope: target, input: { projectId: target.projectId, sessionId } });
      if (outcome.kind === 'network') networkFailed = true;
      const payload = outcome.kind === 'response' ? payloadOf(outcome) : null;
      return payload !== null && record(payload).status === 'ready'
        ? { status: 'ready' as const, value: record(payload).value } : null;
    },
  };
  const restored = await displayPreferenceStore.restore(target, read);
  // ONE guarded application with no await in between. Only facts that still
  // match the stored selection are applied, and nothing is persisted.
  if (restored !== null) {
    const live = displayPreferenceStore.load(target);
    if (restored.goalId !== null && live.goalId === restored.goalId) {
      const goal = record(record(restored.goalRead).value).goal;
      scope.goalRead = restored.goalRead;
      scope.goal = goal as GoalValue;
      const objective = record(goal).objective;
      if (typeof objective === 'string') scope.goalObjective = objective;
      scope.forms.goalId = restored.goalId;
    }
    if (restored.sessionId !== null && live.sessionId === restored.sessionId) {
      const ref: SessionRef = { projectId: target.projectId, sessionId: restored.sessionId };
      if (!sameSession(scope.activeSession, ref)) scope.activeMessage = null;
      scope.activeSession = ref;
      scope.sessionRead = { session: ref, result: restored.sessionRead as SessionsReadResponse };
    }
    if (restored.mainSessionId !== null && live.mainSessionId === restored.mainSessionId) {
      const ref: SessionRef = { projectId: target.projectId, sessionId: restored.mainSessionId };
      scope.mainSession = ref;
      scope.mainSessionRead = { session: ref, result: restored.mainSessionRead as SessionsReadResponse };
    }
  }
  // Only reads follow, each guarded by the CURRENT identity and tagged to the
  // scope/Session it was issued for.
  if (restored !== null && restored.goalId !== null && scope.forms.goalId.trim() === restored.goalId) {
    await loadPlanCandidate(scope);
  }
  if (restored !== null && restored.sessionId !== null
    && sameSession(scope.activeSession, { projectId: target.projectId, sessionId: restored.sessionId })
    && scope.activeSession !== null) {
    const ref = scope.activeSession;
    void probeResumableOriginal(scope, ref, record(restored.sessionRead).value as SessionCard);
    const key = centerSessionHistoryKey(ref);
    await submit(scope, 'sessions/history', buildSessionHistoryRequest(target, ref, null, false, CENTER_HISTORY_LIMIT),
      tagsFor(ref, null, null, null, null, key));
  }
  if (restored !== null && restored.mainSessionId !== null
    && sameSession(scope.mainSession, { projectId: target.projectId, sessionId: restored.mainSessionId })
    && scope.mainSession !== null) {
    const ref = scope.mainSession;
    void probeResumableOriginal(scope, ref, record(restored.mainSessionRead).value as SessionCard);
    const key = centerSessionHistoryKey(ref);
    await submit(scope, 'sessions/history', buildSessionHistoryRequest(target, ref, null, false, CENTER_HISTORY_LIMIT),
      tagsFor(ref, null, null, null, null, key));
  }
  renderAll();
  // Success or a formal missing/not-ready answer completes the restore without
  // faking success; a network failure is retryable on the next switch back.
  scope.displayRestore = networkFailed ? 'idle' : 'done';
}
