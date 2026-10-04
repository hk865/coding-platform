/** Pure identity and key helpers shared by the workbench controllers. */

import type { CoreScope, RunRef, SessionRef } from '../../app/core-http-types.js';
import type { MessageRefValue } from './scope-state.js';

export const scopeKey = (scope: CoreScope): string => JSON.stringify([scope.projectId, scope.workspaceId]);
export const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Same Session identity (project + session), never a second registry. */
export const sameSession = (left: SessionRef | null, right: SessionRef | null): boolean =>
  left !== null && right !== null && left.projectId === right.projectId && left.sessionId === right.sessionId;

/** The mailbox and Session owner accept the PLAIN `{projectId, sessionId}` ref;
 * an aggregate ref from a create/read is normalized here, never loosened. */
export const plainSessionRef = (ref: SessionRef): SessionRef => ({ projectId: ref.projectId, sessionId: ref.sessionId });

/** Same Run identity (aggregate/project/goal/run), never a title or tabId. */
export const sameRun = (left: RunRef, right: RunRef): boolean =>
  left.aggregateType === right.aggregateType && left.projectId === right.projectId
  && left.goalId === right.goalId && left.runId === right.runId;

/** Exact page key for one opened Session-history page. Scope is the owning
 * ScopeState; the captured conversation/layout + page discriminator (center or
 * tab) + exact SessionRef keep the center and every auxiliary tab separate. */
const sessionHistoryPageKey = (page: string, session: SessionRef): string =>
  `session-history|${page}|${session.projectId}/${session.sessionId}`;

/** Exact page key for one opened execution page: the captured conversation/layout
 * plus the typed execution tab (whose tabId already carries the complete RunRef). */
export const executionPageKey = (tabId: string): string => `execution|${tabId}`;

/** Same persisted message address, so a body/read result only renders for the
 * message the user actually selected. */
export const sameMessage = (left: MessageRefValue, right: MessageRefValue): boolean =>
  left.projectId === right.projectId && left.workspaceId === right.workspaceId && left.messageId === right.messageId;

export function selectedIndex(raw: string, length: number): number {
  const value = Number.parseInt(raw, 10);
  return Number.isSafeInteger(value) && value >= 0 && value < length ? value : 0;
}

export const projectRefFor = (projectId: string) => ({ aggregateType: 'Project' as const, projectId });
export const workspaceRefFor = (scope: CoreScope) =>
  ({ aggregateType: 'Workspace' as const, projectId: scope.projectId, workspaceId: scope.workspaceId });

export const conversationKey = (session: SessionRef | null): string => session === null ? '__project__' : `session:${session.sessionId}`;

/** The center conversation's own Session-history page. */
export const centerSessionHistoryKey = (session: SessionRef): string =>
  sessionHistoryPageKey('center', session);

/** One auxiliary history/session tab's own Session-history page. */
export const tabSessionHistoryKey = (tabId: string, session: SessionRef): string =>
  sessionHistoryPageKey(`tab:${tabId}`, session);
