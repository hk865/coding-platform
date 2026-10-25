/**
 * The narrow read port of a Session's activity record.
 *
 * A Session has at most one activity record, and its absence is real state:
 * the Session's creation time at revision 0, never stored. A reader therefore
 * returns the absent default rather than `not_found` when the record has never
 * been written, and keeps `record: null` distinct from a damaged record.
 *
 * The implementation lives in `sessions/session-activity.ts`; callers receive
 * the port and never build record keys or decode the stored envelope.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { SessionActivityV1 } from '../../../contracts/session-activity.js';

export type SessionActivityStateV1 = {
  session: SessionRef; revision: number /* 0 = absent */; lastActivityAt: string; record: SessionActivityV1 | null;
};
export interface SessionActivityReadPort {
  readSessionActivity(ctx: CoreCallContext, input: { session: SessionRef }): Promise<ReadResult<SessionActivityStateV1>>;
}
