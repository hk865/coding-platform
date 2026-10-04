/** The goal-conversation start dependencies of one scope and the ScopeState factory that attaches its controller. */

import type {
  BootstrapWorkspace,
  CoreScope,
  MaterialsOpenResponse,
  PreparedQueryExecution,
  QueriesAnswerResponse,
  QueryExecutionRecord,
} from '../../../app/core-http-types.js';
import { callCore, outcomeRejectionReason, payloadOf } from '../../api/http.js';
import type { CallOutcome } from '../../api/http.js';
import { tagsFor } from '../../api/request-tags.js';
import { submit } from '../../api/submit.js';
import { saveScopeDisplay } from '../../state/display-preference.js';
import { createScopeState } from '../../state/scope-state.js';
import type { ScopeState } from '../../state/scope-state.js';
import { centerSessionHistoryKey } from '../../state/values.js';
import { runGoalSetup } from './goal-setup.js';
import { createGoalConversationStart } from './goal-start.js';
import type { GoalConversationStartDeps, QueryReadJobValue } from './goal-start.js';
import { runExecution } from '../execution/query-flow.js';
import { executionProfileForScope } from '../execution/run.js';
import { CENTER_HISTORY_LIMIT, buildSessionHistoryRequest } from '../sessions/requests.js';
import { settingsController } from '../settings/wiring.js';

/** The EXISTING operations the narrow controller drives for THIS scope. Every
 * member maps onto GoalSetupRun/ExecutionRun and the same HTTP routes. */
function goalConversationStartDeps(scope: ScopeState): GoalConversationStartDeps {
  const targetScopeOf = (ref: { projectId: string; workspaceId: string }): CoreScope =>
    ({ projectId: ref.projectId, workspaceId: ref.workspaceId });
  const readyValue = <T>(outcome: CallOutcome, label: string): T => {
    if (outcome.kind === 'network') throw new Error(outcome.reason);
    const payload = outcome.payload as { status?: unknown; code?: unknown; reason?: unknown; value?: T };
    if (payload.status !== 'ready') throw new Error(`${label}未就绪：${outcomeRejectionReason(payload)}`);
    return payload.value as T;
  };
  return {
    createGoal: async ({ objective }) => {
      const before = scope.goal?.ref.goalId ?? null;
      scope.goalObjective = objective;
      await runGoalSetup(scope);
      const after = scope.goal?.ref.goalId ?? null;
      if (after === null || after === before) {
        throw new Error(scope.goalSetup?.error ?? scope.error ?? '创建目标未完成，请查看已发送的原请求。');
      }
      return after;
    },
    continueInvestigation: async ({ goalId, question, fromMain, selectedSession }) => {
      // The frozen question/references AND recipient intent are handed to the
      // EXISTING run, never re-read from the live composer/selection; the draft
      // and the selected member may have changed meanwhile.
      scope.forms.goalId = goalId;
      scope.forms.question = question;
      saveScopeDisplay(scope);
      await runExecution(scope, 'investigate', { fromMain: fromMain ?? true,
        selectedSession: selectedSession == null ? null : { ...selectedSession } });
      if (scope.execution.error !== null) throw new Error(scope.execution.error);
      if (scope.mainSession === null) {
        throw new Error(scope.execution.notice ?? '调查未绑定会话，原请求已保留。');
      }
      return { sessionRef: scope.mainSession };
    },
    readHistory: async sessionRef => {
      const key = centerSessionHistoryKey(sessionRef);
      await submit(scope, 'sessions/history',
        buildSessionHistoryRequest(scope.config.scope, sessionRef, null, false, CENTER_HISTORY_LIMIT),
        tagsFor(sessionRef, null, null, null, null, key));
    },
    openSettings: () => { void settingsController.open('models'); },
    lookupProfile: origin => {
      const profile = executionProfileForScope(scope, origin);
      return profile === null ? null : { id: profile.id, consumerId: profile.consumerId };
    },
    readQueryJob: async queryJobRef => {
      const outcome = await callCore('queries/read', { scope: targetScopeOf(queryJobRef), input: queryJobRef });
      const value = readyValue<{ run: QueryReadJobValue['run'] }>(outcome, '调查读取');
      const persisted = value.run.run.executionState;
      return { runRef: value.run.ref, executionState: persisted === undefined ? null
        : { phase: persisted.phase, sessionRef: persisted.sessionRef } };
    },
    prepareQuery: async (queryRunRef, requestId) => {
      const outcome = await callCore('queries/prepare', {
        scope: targetScopeOf(queryRunRef), input: { queryRunRef, requestId } });
      return readyValue<PreparedQueryExecution>(outcome, '调查准备');
    },
    startQuery: async ({ prepared, consumerId, requestId }) => {
      const outcome = await callCore('queries/start', {
        scope: targetScopeOf(prepared.queryRunRef),
        input: { prepared, consumerId, requestId } });
      const value = readyValue<QueryExecutionRecord>(outcome, '调查启动');
      return { runRef: value.run.ref, sessionRef: value.session.ref,
        answerRef: value.answer === null ? null : value.answer.ref,
        outcome: value.run.run.outcome,
        phase: value.run.run.executionState?.phase ?? null,
        status: value.run.run.status };
    },
    readAnswer: async answerRef => {
      const target = targetScopeOf(answerRef);
      const outcome = await callCore('queries/answer', { scope: target, input: answerRef });
      if (outcome.kind === 'network') throw new Error(outcome.reason);
      const payload = payloadOf(outcome) as QueriesAnswerResponse;
      scope.execution.answer = payload;
      if (payload.status !== 'ready') throw new Error(`调查回答未就绪：${outcomeRejectionReason(payload)}`);
      const bodyRead = await callCore('materials/open', { scope: target, input: {
        ref: payload.value.answer.bodyRef, usage: 'historical_explanation' } });
      if (bodyRead.kind === 'response') scope.execution.body = payloadOf(bodyRead) as MaterialsOpenResponse;
    },
  };
}

/** A new ScopeState for one bootstrap workspace, with its own goal-conversation controller. */
export function createScope(config: BootstrapWorkspace): ScopeState {
  return createScopeState(config, scope => createGoalConversationStart(goalConversationStartDeps(scope)));
}
