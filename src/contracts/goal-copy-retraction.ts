import type { SessionMessageRef } from './core/session-message.js';

/** The candidate's state: the first row of the book's table that matches names it (7a:603–:619). */
export type CopyInterventionStateV1 =
  | 'withdrawn' | 'applied' | 'rejected'   // disposed: the first exclusion, in the book's order (no `denied`, C-07)
  | 'copied'                               // selected by another copy of the source, or forwarded
  | 'delivered'                            // an accepted `part: 'message'` input, or `read` / `responded`
  | 'not_delivered';                       // queued, or held for an archived or retired recipient line

/** One candidate. `selectable` and `retractable` are separate facts, each with its own reason (7a:611). */
export type CopyInterventionCandidateV1 = {
  messageRef: SessionMessageRef;
  version: number;                                   // the message record's `revision`, as read
  state: CopyInterventionStateV1;
  selectable: boolean;
  reason: CopyInterventionStateV1 | null;            // why it is not selectable; null when selectable
  retractable: boolean;
  retractReason: CopyInterventionStateV1 | null;     // why it is not retractable; null when retractable
};
