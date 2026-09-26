/** R4c.2a: exact persisted facts, never a Kernel entry permit. */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { RunRef, RunSnapshot, TaskAttemptSnapshot, TaskLeaseSnapshot } from '../../../contracts/dispatch.js';
import type { PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { TaskClaimOutbox } from './claim-contracts.js';

/** One final atomic readMany window. Mutable Session/Lease describe the current
 * facts and may no longer belong to this historical claim; no authorization is
 * inferred. Missing required claim-linked records is incomplete, not absence. */
export type TaskExecutionRecord = {
  run: RunSnapshot;
  attempt: TaskAttemptSnapshot;
  outbox: TaskClaimOutbox;
  plan: PlanRevisionSnapshot;
  session: SessionRecord;
  lease: TaskLeaseSnapshot | null;
  readThrough: CommitCursor | null;
};
export interface ExecutionReadPort {
  readExecution(ctx: CoreCallContext, ref: RunRef,
    options?: { atLeastCursor?: CommitCursor }): Promise<ReadResult<TaskExecutionRecord>>;
}
export type ExecutionReadDependencies = { records: GoalRecordTransactionPort };
