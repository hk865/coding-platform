import type { CommitCursor } from './command-event.js';
import type { GoalSettingsV1 } from './goal-decisions.js';
import type { GoalContinuationV1, GoalRef, GoalSnapshot } from './ledger.js';
import type { InitializationBindingV1 } from './initialization-binding.js';
import type { GoalCardDraftV1, QueryJobAnswerRef, QueryJobRef, QueryJobSnapshot } from './query-job.js';
import type { SessionMessageRef } from './core/session-message.js';
import type { CoreError } from './core/results.js';

export type GoalConfirmDraftInputV1 = { commandId: string; round: QueryJobRef; index: number };
export type GoalConfirmDraftReceiptV1 = {
  requestRef: QueryJobRef; round: QueryJobRef; index: number;
  goal: GoalSnapshot; binding: InitializationBindingV1;
  attributionRound: QueryJobRef; cursor: CommitCursor;
};
export type GoalConfirmFactsV1 = {
  rounds: readonly QueryJobSnapshot[];              // the request's ordered rounds, as read
  latestAnswered: QueryJobRef | null;               // the rule of request-service.ts:801, applied to `rounds`
  round: QueryJobRef;
  drafts: readonly { index: number; draft: GoalCardDraftV1 }[];
  activeOrder: readonly number[];                   // the project's active Goals' `settings.order`
  confirmed: readonly { answerRef: QueryJobAnswerRef; draftIndex: number }[];  // bindings this answer already made
};
export type GoalConfirmDecisionV1 =
  | { outcome: 'refuse'; code: CoreError; reason: string }
  | { outcome: 'create'; draft: GoalCardDraftV1; objective: string; settings: GoalSettingsV1; order: number };

export type GoalCopyDraftInputV1 = { goalRef: GoalRef };
export type GoalCopyDraftResultV1 = {
  source: { goal: GoalRef; revision: number };
  objective: string; autonomy: GoalSnapshot['settings']['autonomy']; order: number;
  toReconfirm: { waitForGoalRef: GoalRef | null; parallelRisks: readonly GoalRef[] };
  understanding: { noteId: string; version: number } | null;
  interventions: { available: false };
};
export type GoalCopyConfirmInputV1 = {
  commandId: string; sourceGoalRef: GoalRef; expectedSourceRevision: number;
  selectedInterventions: readonly SessionMessageRef[];
};
export type GoalCopyConfirmResultV1 = {
  goal: GoalSnapshot;                       // born at revision 1 with `continuedFrom` and `copiedInterventions`
  receipt: { sourceGoalRef: GoalRef; continuedFrom: GoalContinuationV1;
    selection: 'selection_only' | 'retraction_pending' };
  retractions: readonly { messageRef: SessionMessageRef;
    status: 'retracted' | 'not_retractable' | 'unfinished'; reason: string | null }[];
  cursor: CommitCursor;
};
/** Pointer and head are two records with two revisions: the pointer's `revision` and the head's `version` are
 *  guarded separately (R6B3-17). The structure is ALWAYS returned with the pointer's refKey: a missing pointer is
 *  `revision: null` with no head and no note, never a null result and never invented numbers; an
 *  existing-but-empty pointer carries its real `revision` with `noteId: null` and no head. The pin is the pointer
 *  only: the text is read by the caller at exactly `note.version` (R6B3-34). */
export type GoalUnderstandingPinV1 = {
  pointer: { refKey: string; revision: number | null; noteId: string | null };
  head: { refKey: string; version: number } | null;
  note: { noteId: string; version: number } | null;
};
export type GoalCopyFactsV1 = {
  source: GoalSnapshot;                       // the record as read, with its `revision`
  understanding: GoalUnderstandingPinV1;            // always the pointer refKey; `revision: null` when missing
  selected: readonly { messageRef: SessionMessageRef; version: number; selectable: boolean; reason: string | null }[];
  intervened: readonly SessionMessageRef[];   // `copiedInterventions` already on the source or its copies
};
export type GoalCopyDecisionV1 =
  | { outcome: 'refuse'; code: CoreError; reason: string }
  | { outcome: 'create'; objective: string; settings: GoalSettingsV1;
      continuedFrom: GoalContinuationV1; copiedInterventions: readonly SessionMessageRef[];
      selection: 'selection_only' | 'retraction_pending' };
