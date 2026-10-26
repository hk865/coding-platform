import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { DispatchBasisV1, DispatchCounterV1, GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type { PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type { RecordGuard } from '../../record-store/ports.js';

/** The one window: Goal + active Plan + pointer + counter, their real versions and the guards. */
export type DispatchBasisFactsV1 = {
  goal: GoalSnapshot;
  plan: PlanRevisionSnapshot | null;
  pointer: { revision: number | 'none'; anchorRefKey: string; expectedRevision: number | null };
  counter: { record: DispatchCounterV1 | null; refKey: string; expectedRevision: number | null };
  values: DispatchBasisV1;
  /** The ledger watermark the four reads were resolved at; never newer than the pointer it verified. */
  readCursor: CommitCursor;
  guards: readonly RecordGuard[];
};

export type DispatchBasisFactsPort = {
  readDispatchFacts(ctx: CoreCallContext, input: { goalRef: GoalRef }):
    Promise<ReadResult<DispatchBasisFactsV1>>;
};
export type DispatchBasisReadPort = {
  readDispatchBasis(ctx: CoreCallContext, input: { goalRef: GoalRef }):
    Promise<ReadResult<DispatchBasisV1>>;
};

/**
 * The goal understanding pointer's facts: the ONE narrow read the basis needs, declared in model so
 * `tasks/` never imports `notes/`. The adapter is `views/pointer-facts.ts`.
 */
export type GoalUnderstandingPointerFactsV1 = {
  /** The L2 canonical key `goal:<goalId>`. */
  anchorKey: string;
  /** The stored `CurrentPointer` record's key (`currentPointerRefKey`), the CAS address. */
  refKey: string;
  /** The pointer record's revision; `'none'` when the goal has no pointer. */
  revision: number | 'none';
  /** The CAS expectation; `null` iff `revision` is `'none'`, never 0. */
  expectedRevision: number | null;
  /** The watermark of the SAME `readMany` that produced `revision` (or its absence); never a later read's. */
  readCursor: CommitCursor;
};
export interface GoalUnderstandingPointerPort {
  /** A read failure is the failure, never `'none'`; a stage pointer is not this pointer. */
  readGoalUnderstandingPointer(ctx: CoreCallContext, input: { goalRef: GoalRef }):
    Promise<ReadResult<GoalUnderstandingPointerFactsV1>>;
}
