/**
 * Slice 5 §4.1/§8.2: the ONE decision-answer lookup.
 *
 * It moved here from `views/decision-read-model.ts` (K3 group 4 B1) so both the
 * read model and the `tasks/` readers import the same function; there is no
 * second copy. Behaviour is unchanged: the synthetic answer index is paged to
 * its end (2A L6/L10) and a damaged stored answer is a read failure, never a
 * silent "this source has no answer". The stable-window pager itself is the
 * shared one in `persistence/lookup-all.ts`.
 */
import type { CoreRejection } from '../../../contracts/core/results.js';
import type { WorkspaceScope } from '../../../contracts/core/identity.js';
import type { DecisionSourceV1 } from '../../../contracts/goal-decisions.js';
import type { S5RecordPort } from '../model/decision-contracts.js';
import type { SessionMessage } from '../model/communication-contracts.js';
import { lookupAll } from '../persistence/lookup-all.js';
import {
  decodeSessionMessageRecord,
  S5_DECISION_ANSWER_BY_SOURCE,
} from '../sessions/message-record-codecs.js';

/** The read-only slice this lookup needs (`views/` passes its own narrow port). */
export type DecisionAnswerLookupRecords = Pick<S5RecordPort, 'readMany' | 'lookup'>;

function isUserDecisionResponse(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && typeof (value as { decision?: unknown }).decision === 'object'
    && (value as { decision?: unknown }).decision !== null;
}

export async function findAnswerMessage(
  records: DecisionAnswerLookupRecords,
  workspace: WorkspaceScope,
  source: DecisionSourceV1,
): Promise<SessionMessage | null> {
  const batch = await lookupAll(records, S5_DECISION_ANSWER_BY_SOURCE,
    [workspace.projectId, workspace.workspaceId, source.kind, source.key]);
  for (const record of batch.items) {
    const decoded = decodeSessionMessageRecord(record);
    if (decoded.status !== 'decoded') {
      // §8.2 data row: a damaged answer record is `unavailable`, never skipped
      // into the false fact "this source has no answer".
      throw { status: 'rejected', code: 'unavailable',
        reason: `answer message ${record.refKey}: ${decoded.reason}` } as CoreRejection;
    }
    const message = decoded.value;
    if (message.decision?.syntheticAnswer !== true || message.status !== 'responded') continue;
    if (isUserDecisionResponse(message.response)) return message;
  }
  // 2A L6/L10: the answer index is read to its end, so a full scan that found
  // no answer really proves this source has none.
  return null;
}
