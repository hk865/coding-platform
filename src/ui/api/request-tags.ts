/** Request attribution tags frozen when a request is built. */

import type { RunRef, SessionRef } from '../../app/core-http-types.js';
import type { WorkLinkTarget } from '../state/layout.js';
import type { MessageRefValue } from '../state/scope-state.js';

/** Attribution captured when a request is built. It lets an async response be
 * written back to the scope AND the Session/message it was actually issued for,
 * even if the user has since selected another scope or Session. */
export type RequestTags = {
  session: SessionRef | null;
  messageRef: MessageRefValue | null;
  part: 'message' | 'response' | null;
  /** Present only for a `sessions/find` driven by a real WorkLinkTarget, so the
   * related-session page never overwrites the project directory page. */
  workTarget: WorkLinkTarget | null;
  /** Present only for an `executions/*` read, so a late run-window response is
   * written back under its exact RunRef and never shown under another Run. */
  run: RunRef | null;
  /** The exact page (scope + captured conversation/layout/tab + object) that
   * issued the request. A response is stored under this key, so returning to an
   * old page keeps its own result/cursor and a late response never lands on
   * another page or re-opens a closed one. */
  pageKey: string | null;
  /** For a related `sessions/find`: the exact includeArchived filter the request
   * was read under. A response read under a no-longer-current filter is dropped. */
  filterIncludeArchived: boolean | null;
  /** For a related `sessions/find`: the original optional role, preserved only
   * when the issued request actually carried one. */
  relatedRole: unknown | null;
  /** True only for a `next-*` center history read whose page must be APPENDED to
   * the page already stored under the same exact scope+Session key. */
  historyNext: boolean;
  historyAfterCursor?: string | null;
  historyGeneration?: number;
};
export const noTags: RequestTags = { session: null, messageRef: null, part: null, workTarget: null, run: null,
  pageKey: null, filterIncludeArchived: null, relatedRole: null, historyNext: false };
export const tagsFor = (
  session: SessionRef | null,
  messageRef: MessageRefValue | null = null,
  part: 'message' | 'response' | null = null,
  workTarget: WorkLinkTarget | null = null,
  run: RunRef | null = null,
  pageKey: string | null = null,
  historyNext = false,
): RequestTags => ({ session, messageRef, part, workTarget, run, pageKey,
  filterIncludeArchived: null, relatedRole: null, historyNext });
/** Related-target read tags: the exact target, filter and (optional) role. */
export const tagsForRelated = (target: WorkLinkTarget, includeArchived: boolean, role: unknown | null): RequestTags =>
  ({ session: null, messageRef: null, part: null, workTarget: target, run: null, pageKey: null,
    filterIncludeArchived: includeArchived, relatedRole: role ?? null, historyNext: false });
