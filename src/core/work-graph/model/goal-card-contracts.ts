import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type {
  GoalConfirmDraftInputV1, GoalConfirmDraftReceiptV1, GoalCopyConfirmInputV1, GoalCopyConfirmResultV1,
  GoalCopyDraftInputV1, GoalCopyDraftResultV1, GoalUnderstandingPinV1,
} from '../../../contracts/goal-card.js';
import type { InitializationBindingV1 } from '../../../contracts/initialization-binding.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { QueryJobAnswerRef } from '../../../contracts/query-job.js';

/** C writes the binding in the confirm commit; G reads it by answer+draft and by Goal. A missing record for the
 *  named `(answerRef, draftIndex)` is an error (`not_found`); a Goal with no binding is a normal empty array. */
export interface InitializationBindingReadPort {
  readBindingByAnswerDraft(ctx: CoreCallContext,
    input: { answerRef: QueryJobAnswerRef; draftIndex: number }): Promise<ReadResult<InitializationBindingV1>>;
  readBindingByGoal(ctx: CoreCallContext,
    input: { goalRef: GoalRef }): Promise<ReadResult<readonly InitializationBindingV1[]>>;
}
export interface GoalUnderstandingReadPort {
  /** Always returns the pointer refKey and the head/note it could prove; a missing pointer is `revision: null`,
   *  not a null result and not an error. */
  readGoalUnderstanding(ctx: CoreCallContext,
    input: { goalRef: GoalRef }): Promise<ReadResult<GoalUnderstandingPinV1>>;
}
export interface GoalConfirmPort {
  confirmDraft(ctx: CoreCallContext, input: GoalConfirmDraftInputV1):
    Promise<WriteResult<GoalConfirmDraftReceiptV1>>;
}
export interface GoalCopyPort {
  readDraft(ctx: CoreCallContext, input: GoalCopyDraftInputV1):
    Promise<ReadResult<GoalCopyDraftResultV1>>;
  confirm(ctx: CoreCallContext, input: GoalCopyConfirmInputV1):
    Promise<WriteResult<GoalCopyConfirmResultV1>>;
}
