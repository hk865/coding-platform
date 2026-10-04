/** The single writer from a core route reply to the ScopeState that issued the request. */

import type {
  CoreRouteSuffix,
  ExecutionsHistoryResponse,
  ExecutionsReadResponse,
  MessagesBodyResponse,
  MessagesInboxResponse,
  MessagesReadResponse,
  RuntimeCapabilitiesResponse,
  SessionsCreateResponse,
  SessionsFindResponse,
  SessionsHistoryResponse,
  SessionsOperationResponse,
  SessionsReadResponse,
  WorkflowConsultationResponse,
} from '../../app/core-http-types.js';
import type { RequestTags } from '../api/request-tags.js';
import { GRAPH_WRITE_ROUTES } from '../api/routes.js';
import { list } from '../components/html.js';
import { saveScopeDisplay } from './display-preference.js';
import type {
  AdoptValue,
  CaptureValue,
  FileValue,
  GoalValue,
  PlanValue,
  PolicyActiveValue,
  PolicyInstallValue,
  ProjectValue,
  ProposalValue,
  ScopeState,
  SourcePageValue,
  WorkspaceValue,
} from './scope-state.js';
import { record, sameSession } from './values.js';
import {
  matchesHistoryAppendCursor,
  probeResumableOriginal,
  selectSession,
  sessionRefFromCard,
  sessionRefFromRecord,
} from '../views/sessions/requests.js';
import { architectureSelectionKeyOf, taskGoalIdOf } from '../views/setup/requests.js';

export function applyResult(scope: ScopeState, route: CoreRouteSuffix, payload: unknown, tags: RequestTags): void {
  const envelope = record(payload);
  if (envelope.status === 'committed') scope.conflict = null;
  if (envelope.status === 'rejected' && GRAPH_WRITE_ROUTES.has(route)) {
    if (envelope.code === 'revision_conflict' || envelope.code === 'idempotency_conflict') {
      scope.conflict = { route, current: list(envelope.current) };
    }
  }
  switch (route) {
    case 'projects/create': if (envelope.status === 'committed') scope.project = envelope.value as ProjectValue; break;
    case 'workspaces/register': if (envelope.status === 'committed') scope.workspace = envelope.value as WorkspaceValue; break;
    case 'completion-policies/install': if (envelope.status === 'committed') scope.policyInstall = envelope.value as PolicyInstallValue; break;
    case 'completion-policies/activate': if (envelope.status === 'committed') scope.policyActive = envelope.value as PolicyActiveValue; break;
    case 'goals/create': if (envelope.status === 'committed') scope.goal = envelope.value as GoalValue; break;
    case 'architecture/adopt-initial': if (envelope.status === 'committed') scope.adopted = envelope.value as AdoptValue; break;
    case 'plans/propose': if (envelope.status === 'committed') scope.proposal = envelope.value as ProposalValue; break;
    case 'plans/apply': if (envelope.status === 'committed') scope.plan = envelope.value as PlanValue; break;
    case 'architecture/capture': if (envelope.status === 'committed') scope.observedCapture = envelope.value; break;
    case 'goals/read': {
      scope.goalRead = payload;
      const detail = record(envelope.value);
      const goalRef = record(record(detail.goal).ref);
      if (typeof goalRef.goalId === 'string' && scope.forms.goalId.trim().length === 0) {
        scope.forms.goalId = goalRef.goalId;
        saveScopeDisplay(scope);
      }
      const pending = detail.pendingPlan === null || detail.pendingPlan === undefined ? null : record(detail.pendingPlan);
      const pendingRef = pending === null ? {} : record(pending.ref);
      if (typeof pendingRef.proposalId === 'string' && scope.forms.proposalId.trim().length === 0) scope.forms.proposalId = pendingRef.proposalId;
      break;
    }
    case 'plans/proposal': scope.proposalRead = payload; break;
    case 'architecture/read': {
      scope.architectureRead = payload;
      scope.architectureReadSelection = architectureSelectionKeyOf(scope.lastRequest?.body);
      const baseline = record(record(envelope.value).baseline);
      if (typeof baseline.baselineId === 'string') scope.forms.baselineId = baseline.baselineId;
      if (typeof baseline.revision === 'number') scope.forms.baselineRevision = String(baseline.revision);
      break;
    }
    case 'tasks/query': {
      scope.taskGraph = payload;
      scope.taskGraphGoalId = taskGoalIdOf(scope.lastRequest?.body);
      break;
    }
    case 'architecture/query': scope.observed = payload; break;
    case 'source/capture':
      if (envelope.status === 'ready') { scope.capture = envelope.value as CaptureValue; scope.sourcePage = null; }
      break;
    case 'source/query': if (envelope.status === 'ready') scope.sourcePage = envelope.value as SourcePageValue; break;
    case 'files/read': if (envelope.status === 'ready') scope.file = envelope.value as FileValue; break;
    case 'sessions/find':
      if (tags.workTarget !== null) {
        // Related target list: keep the exact filter it was read under. A
        // response whose filter is no longer current is dropped (never shown or
        // continued under the new condition); a newer result, including a real
        // failure, replaces the old ready page for the same target + filter.
        if (tags.filterIncludeArchived === scope.sessionIncludeArchived) {
          scope.relatedSessions = { target: tags.workTarget,
            includeArchived: tags.filterIncludeArchived ?? scope.sessionIncludeArchived,
            role: tags.relatedRole, result: payload as SessionsFindResponse };
        }
      } else if (envelope.status === 'ready') {
        scope.sessionFind = payload as SessionsFindResponse;
      }
      break;
    case 'sessions/read': {
      // Store THIS read's result even when it is rejected/not_ready/not_found, so
      // a failed refresh can never leave the previous ready detail in place.
      const session = tags.session ?? (envelope.status === 'ready' ? sessionRefFromCard(envelope.value) : null);
      if (session !== null) {
        const read = { session, result: payload as SessionsReadResponse };
        if (sameSession(scope.mainSession, session)) scope.mainSessionRead = read;
        if (!sameSession(scope.mainSession, session) || sameSession(scope.activeSession, session)) scope.sessionRead = read;
        // A read-only probe: it may only offer 继续准备调查, never prepare/start.
        if (read.result.status === 'ready') void probeResumableOriginal(scope, session, read.result.value);
      }
      break;
    }
    case 'sessions/operation':
      scope.sessionOperationRead = payload as SessionsOperationResponse;
      break;
    case 'runtime/capabilities':
      scope.runtimeCapabilities = payload as RuntimeCapabilitiesResponse;
      break;
    case 'sessions/create': {
      scope.sessionCreateReceipt = payload as SessionsCreateResponse;
      if (envelope.status === 'completed') {
        const selected = sessionRefFromRecord(envelope.value);
        if (selected !== null) selectSession(scope, selected);
      }
      break;
    }
    case 'messages/inbox':
      if (envelope.status === 'ready' && tags.session !== null) scope.inbox = { session: tags.session, result: payload as MessagesInboxResponse };
      break;
    case 'messages/read':
      if (envelope.status === 'ready' && tags.session !== null && tags.messageRef !== null)
        scope.message = { session: tags.session, messageRef: tags.messageRef, result: payload as MessagesReadResponse };
      break;
    case 'messages/body':
      if (envelope.status === 'ready' && tags.session !== null && tags.messageRef !== null && tags.part !== null)
        scope.messageBody = { session: tags.session, messageRef: tags.messageRef, part: tags.part, result: payload as MessagesBodyResponse };
      break;
    case 'sessions/history': {
      if (tags.session !== null && tags.pageKey !== null) {
        if (tags.historyGeneration !== undefined
          && scope.historyGenerations.get(tags.pageKey) !== tags.historyGeneration) break;
        const previous = scope.sessionHistories.get(tags.pageKey);
        const page = envelope.status === 'ready'
          ? payload as Extract<SessionsHistoryResponse, { status: 'ready' }> : null;
        if (tags.historyNext) {
          // A next page may extend only the exact cursor captured when sent.
          if (previous === undefined || !sameSession(previous.session, tags.session)
            || previous.result.status !== 'ready'
            || !matchesHistoryAppendCursor(previous.result, tags.historyAfterCursor)) break;
          if (page === null) {
            scope.error = `历史继续加载失败：${typeof envelope.reason === 'string' ? envelope.reason : String(envelope.status ?? '未知结果')}`;
            break;
          }
          const entryKey = (item: typeof page.value.items[number]): string =>
            JSON.stringify([item.source.adapterId, item.source.kernelSessionId, item.source.position, item.recordId]);
          const seen = new Set(previous.result.value.items.map(entryKey));
          const items = [...previous.result.value.items];
          for (const item of page.value.items) {
            const key = entryKey(item);
            if (!seen.has(key)) { seen.add(key); items.push(item); }
          }
          scope.sessionHistories.set(tags.pageKey, { session: tags.session,
            result: { status: 'ready', value: { ...page.value, items } } });
        } else {
          scope.sessionHistories.set(tags.pageKey, { session: tags.session, result: payload as SessionsHistoryResponse });
        }
      }
      break;
    }
    case 'workflow/consultation':
      if (tags.session !== null && tags.messageRef !== null)
        scope.consultation = { session: tags.session, messageRef: tags.messageRef, result: payload as WorkflowConsultationResponse };
      break;
    case 'executions/read':
      if (tags.run !== null && tags.pageKey !== null)
        scope.executionReads.set(tags.pageKey, { run: tags.run, result: payload as ExecutionsReadResponse });
      break;
    case 'executions/history':
      if (tags.run !== null && tags.pageKey !== null)
        scope.executionHistories.set(tags.pageKey,
          { scope: scope.config.scope, run: tags.run, result: payload as ExecutionsHistoryResponse });
      break;
  }
}
