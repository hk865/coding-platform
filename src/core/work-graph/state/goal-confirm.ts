/** The pure `goals/confirm-draft` rules: the refusal order, the confirmed objective text and the immutable
 *  initialization binding. No I/O, no clock, no id; the owner only calls, encodes and submits. */
import { normalizeObjective } from '../../../contracts/command-event.js';
import type {
  GoalConfirmDecisionV1, GoalConfirmDraftInputV1, GoalConfirmFactsV1,
} from '../../../contracts/goal-card.js';
import type { InitializationBindingV1 } from '../../../contracts/initialization-binding.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { GoalScreeningV1, QueryJobAnswerRef, QueryJobRef } from '../../../contracts/query-job.js';
import { sameRef } from './ref-equality.js';

export type DecideGoalConfirm =
  (facts: GoalConfirmFactsV1, input: GoalConfirmDraftInputV1) => GoalConfirmDecisionV1;
/** The one binding constructor; the task service only encodes and submits its result. */
export type NewInitializationBinding = (input: {
  answerRef: QueryJobAnswerRef; answerDigest: string; requestRef: QueryJobRef;
  draftIndex: number; goalRef: GoalRef; screening: GoalScreeningV1 | null;
}) => InitializationBindingV1;
export type ConfirmObjectiveText = (objective: string, completion: readonly string[]) => string;

export function confirmObjectiveText(objective: string, completion: readonly string[]): string {
  return normalizeObjective(objective) + "\n\n完成标准：\n"
    + completion.map((line) => "- " + normalizeObjective(line)).join("\n");
}

const LATEST_ANSWER_REASON = 'the round is no longer the request latest answered round';
const DRAFT_INDEX_REASON = 'index is outside the answer goal card drafts';
const ALREADY_CONFIRMED_REASON = 'the draft already created a goal; one card never makes two goals';

/** The one confirm-draft decision. Order: the latest answered round, then the draft index, then the already-
 *  confirmed pair, so a command carrying several faults refuses the earlier one; same-commandId replay is R2's. */
export const decideGoalConfirm: DecideGoalConfirm = (facts, input) => {
  if (facts.latestAnswered === null || !sameRef(facts.latestAnswered, facts.round)) {
    return { outcome: 'refuse', code: 'revision_conflict', reason: LATEST_ANSWER_REASON };
  }
  if (!Number.isInteger(input.index) || input.index < 0 || input.index >= facts.drafts.length) {
    return { outcome: 'refuse', code: 'invalid', reason: DRAFT_INDEX_REASON };
  }
  // One answered Job has one answer, so a binding of another answer cannot block this draft.
  const confirmed = facts.confirmed.some((entry) =>
    entry.draftIndex === input.index
    && entry.answerRef.projectId === facts.round.projectId
    && entry.answerRef.workspaceId === facts.round.workspaceId
    && entry.answerRef.queryJobId === facts.round.queryJobId);
  if (confirmed) return { outcome: 'refuse', code: 'revision_conflict', reason: ALREADY_CONFIRMED_REASON };

  const { draft } = facts.drafts[input.index]!;
  const objective = confirmObjectiveText(draft.objective, draft.completion);
  const order = facts.activeOrder.length === 0 ? 0 : Math.max(...facts.activeOrder) + 1;
  return {
    outcome: 'create',
    draft,
    objective,
    settings: { schemaVersion: 1, autonomy: draft.autonomy, order, waitForGoalRef: null, parallelRisks: [] },
    order,
  };
};

/** The immutable `InitializationBinding@1` record; `ref` names the answer and draft, in the answer's project. */
export const newInitializationBinding: NewInitializationBinding = (input) => ({
  ref: {
    aggregateType: 'InitializationBinding',
    projectId: input.answerRef.projectId,
    answerRef: input.answerRef,
    draftIndex: input.draftIndex,
  },
  revision: 1,
  answerRef: input.answerRef,
  answerDigest: input.answerDigest,
  requestRef: input.requestRef,
  draftIndex: input.draftIndex,
  goalRef: input.goalRef,
  goalRevision: 1,
  screening: input.screening,
});
