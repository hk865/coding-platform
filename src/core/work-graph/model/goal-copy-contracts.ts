/**
 * The copy's two ports: one reads the source Goal's selectable interventions by page, the other retracts one copied
 * intervention. The copy owner implements them and the confirm owner injects them; this file declares only the types.
 *
 * A read failure is a rejection, never an empty set: a caller never reads "nothing to copy" from a failed read.
 * `readThrough` is the ledger cursor the page was read at, and `nextCursor` is the codebase's paged-read cursor.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { GoalRef } from '../../../contracts/ledger.js';

export type CopyInterventionCandidateV1 = {
  messageRef: SessionMessageRef; version: number; selectable: boolean; reason: string | null;
};

export interface CopyInterventionReadPort {
  readCopyInterventions(ctx: CoreCallContext, input: { sourceGoalRef: GoalRef; page: { limit: number /* 1..200 */; cursor?: string } }):
    Promise<ReadResult<{ candidates: CopyInterventionCandidateV1[]; readThrough: CommitCursor | null; nextCursor: string | null }>>;
}

export interface CopyInterventionRetractionPort {
  retractCopiedIntervention(ctx: CoreCallContext, input: { commandId: string; sourceGoalRef: GoalRef; messageRef: SessionMessageRef }):
    Promise<{ status: 'retracted' | 'not_retractable'; reason: string | null } | CoreRejection>;
}
