/** Session reads: the resumable-original probe, Session selection and the Session, inbox, history and runtime request builders. */

import type {
  CoreScope,
  QueriesReadResponse,
  SessionCard,
  SessionRef,
  SessionsHistoryResponse,
} from '../../../app/core-http-types.js';
import { callCore, payloadOf } from '../../api/http.js';
import { saveScopeDisplay } from '../../state/display-preference.js';
import type { MessageRefValue, ScopeState } from '../../state/scope-state.js';
import { record, sameSession, selectedIndex } from '../../state/values.js';
import { freshRequestId, renderScopeIfSelected, reviewSessionRoles, state } from '../../state/workbench.js';
import { goalConversationQueryRunRef, queryJobRefOf, sameQueryRunRef } from '../conversation/goal-start.js';

/** Read-only probe: only a positively-read claimed/prepared original QueryRun of
 * the displayed Session becomes a resumable candidate. It never prepares,
 * starts, claims or clears occupancy; a read error or another phase clears it. */
export async function probeResumableOriginal(scope: ScopeState, sessionRef: SessionRef, card: SessionCard): Promise<void> {
  const clear = (): void => {
    if (scope.execution.resumable !== null && sameSession(scope.execution.resumable.session, sessionRef)) {
      scope.execution.resumable = null;
      renderScopeIfSelected(scope);
    }
  };
  const original = goalConversationQueryRunRef(card.record);
  if (original === null) { clear(); return; }
  const outcome = await callCore('queries/read', { scope: { projectId: original.projectId,
    workspaceId: original.workspaceId }, input: queryJobRefOf(original) });
  // A late response may only update the scope+Session still displayed.
  if (!sameSession(scope.mainSession, sessionRef) && !sameSession(scope.activeSession, sessionRef)) return;
  if (outcome.kind !== 'response') { clear(); return; }
  const payload = payloadOf(outcome) as QueriesReadResponse;
  const persisted = payload.status === 'ready' ? payload.value.run.run.executionState : undefined;
  if (payload.status !== 'ready' || !sameQueryRunRef(payload.value.run.ref, original)
    || !sameSession(persisted?.sessionRef ?? null, sessionRef)) { clear(); return; }
  scope.execution.resumable = persisted === undefined ? null
    : { session: sessionRef, queryRunRef: original, phase: persisted.phase };
  renderScopeIfSelected(scope);
}

// ---------------------------------------------------------------------------
// Explicit action handlers
// ---------------------------------------------------------------------------

/** Selecting a Session is the ONLY place that changes `activeSession`. It also
 * drops the previously selected message so a body action can never target a
 * message that belongs to another Session. A late response still keeps its own
 * Session tag in state but no longer matches the active selection. */
export function selectSession(scope: ScopeState, ref: SessionRef): void {
  if (!sameSession(scope.activeSession, ref)) scope.activeMessage = null;
  scope.activeSession = ref;
  saveScopeDisplay(scope);
}

export function requireBody(scope: ScopeState, body: unknown | null): body is unknown {
  if (body === null) {
    if (scope.error === null) scope.error = '缺少必要输入或上一步结果，请补全后重试。';
    renderScopeIfSelected(scope);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// R6.1b-1 Session / message / history request builders. Each one is derived
// from the exact public port second argument; `sessions/create` is plain (its
// own `meta` is the real request) and `messages/send` keeps the original
// GraphWrite envelope. The trusted sender/actor is never built here.
// ---------------------------------------------------------------------------

export function sessionRolesForScope(scope: CoreScope) {
  return reviewSessionRoles().filter(entry =>
    entry.scope.projectId === scope.projectId && entry.scope.workspaceId === scope.workspaceId);
}

export function sessionRefFromRecord(value: unknown): SessionRef | null {
  const ref = record(record(value).ref);
  const projectId = ref.projectId;
  const sessionId = ref.sessionId;
  return typeof projectId === 'string' && typeof sessionId === 'string' ? { projectId, sessionId } : null;
}

export function sessionRefFromCard(value: unknown): SessionRef | null {
  return sessionRefFromRecord(record(value).record);
}

export function sessionRefFromFind(current: ScopeState, sessionId: string): SessionRef | null {
  const found = current.sessionFind;
  if (found === null || found.status !== 'ready') return null;
  const card = found.value.items.find(item => item.record.ref.sessionId === sessionId);
  if (card === undefined) return null;
  return { projectId: card.record.ref.projectId, sessionId: card.record.ref.sessionId };
}

export function messageRefFromInbox(current: ScopeState, messageId: string): MessageRefValue | null {
  const inbox = current.inbox;
  if (inbox === null || inbox.result.status !== 'ready') return null;
  const found = inbox.result.value.items.find(item => item.ref.messageId === messageId);
  return found === undefined ? null : found.ref;
}

export function buildSessionFindRequest(next: boolean): unknown | null {
  const current = state();
  const scope = current.config.scope;
  if (!next) return { scope, input: { workspace: scope, includeArchived: current.sessionIncludeArchived, page: { limit: 10 } } };
  const previous = current.sessionFind;
  if (previous === null || previous.status !== 'ready' || previous.value.nextCursor === null) return null;
  return { scope, input: { workspace: scope, includeArchived: current.sessionIncludeArchived, page: {
    limit: 10, cursor: previous.value.nextCursor, atLeastCursor: previous.value.sourceCursor } } };
}

export function buildSessionCreateRequest(): unknown | null {
  const current = state();
  const scope = current.config.scope;
  const roles = sessionRolesForScope(scope);
  const role = roles[selectedIndex(current.forms.sessionRoleIndex, roles.length)];
  if (role === undefined) return null;
  return { scope, input: {
    workspace: scope,
    role: role.role,
    recommendedRefs: [],
    initialLinks: [],
    meta: { requestId: freshRequestId('sessions/create'), expected: [] },
  } };
}

export function buildSessionReadRequest(scope: CoreScope, ref: SessionRef): unknown {
  return { scope, input: ref };
}

export function buildSessionOperationRequest(): unknown | null {
  const current = state();
  const receipt = current.sessionCreateReceipt;
  if (receipt === null || receipt.status === 'rejected') return null;
  return { scope: current.config.scope, input: receipt.operationRef };
}

/** The result stored for one exact page key, or null when that page was never
 * read. The center and each auxiliary page pass their own stored result into the
 * one builder below, so they never borrow another page's cursor. */
export function storedSessionHistoryPage(scope: ScopeState, key: string | null): SessionsHistoryResponse | null {
  return key === null ? null : scope.sessionHistories.get(key)?.result ?? null;
}

/** An append may follow a published next cursor, or refresh a previously read
 * tail using its exact last saved record cursor. A newer prefix invalidates it. */
export function matchesHistoryAppendCursor(previous: Extract<SessionsHistoryResponse, { status: 'ready' }>, after: string | null | undefined): boolean {
  if (after === null || after === undefined) return false;
  const page = previous.value;
  return (page.nextCursor ?? page.items.at(-1)?.cursor) === after;
}

/** The center conversation reads a 50-record first page; an auxiliary
 * history/session tab keeps its own smaller independent page. */
export const CENTER_HISTORY_LIMIT = 50;
const AUX_HISTORY_LIMIT = 10;

/** The ONE explicit Session-history request builder. It receives the exact
 * scope, Session and the original page whose `nextCursor` is being followed, so
 * the center path and every auxiliary history/session tab page their own object
 * and never borrow another object's cursor. A null `next` rebuilds the head
 * (afterCursor null); empty `items` with a non-null `nextCursor` still continues. */
export function buildSessionHistoryRequest(
  targetScope: CoreScope, ref: SessionRef, previous: SessionsHistoryResponse | null, next: boolean,
  limit: number = AUX_HISTORY_LIMIT,
): unknown | null {
  let afterCursor: string | null = null;
  if (next) {
    if (previous === null || previous.status !== 'ready' || previous.value.nextCursor === null) return null;
    afterCursor = previous.value.nextCursor;
  }
  return { scope: targetScope, input: { sessionRef: ref, afterCursor, throughCursor: null, limit } };
}

export function buildInboxRequest(next: boolean): unknown | null {
  const current = state();
  const recipient = current.activeSession;
  if (recipient === null) return null;
  if (!next) return { scope: current.config.scope, input: { recipient, page: { limit: 10 } } };
  const previous = current.inbox;
  if (previous === null || !sameSession(previous.session, recipient)
    || previous.result.status !== 'ready' || previous.result.value.nextCursor === null) return null;
  return { scope: current.config.scope, input: { recipient, page: {
    limit: 10, cursor: previous.result.value.nextCursor, atLeastCursor: previous.result.value.sourceCursor } } };
}

export function buildRuntimeCapabilitiesRequest(): unknown {
  const current = state();
  return { scope: current.config.scope, input: current.config.scope };
}
