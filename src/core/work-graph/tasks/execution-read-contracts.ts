/** R4c.2a: exact persisted facts, never a Kernel entry permit. */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { RunRef, RunSnapshot, TaskAttemptSnapshot, TaskLeaseSnapshot } from '../../../contracts/dispatch.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
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

/**
 * MVP UI connection: a bounded, scope-bound page of real executions for one
 * Goal (optionally narrowed to one Task). `page.limit` is 1–100; `afterCursor`
 * is an opaque cursor bound to the exact scope + query, so a cursor from
 * another Goal/Task/workspace is never accepted. The read reuses the existing
 * `r3c-run-by-goal` / `r4c-run-by-task` candidate indexes and the canonical
 * Run reader; it is not a second history store and never scans the whole graph.
 */
export type ExecutionListPageRequest = {
  goalRef: GoalRef;
  taskId?: string;
  page: { afterCursor: string | null; limit: number };
};

/** The existing `TaskExecutionRecord` facts per item plus the page cursor and
 * the real read watermark of the authoritative read window. */
export type TaskExecutionPage = {
  items: TaskExecutionRecord[];
  nextCursor: string | null;
  readThrough: CommitCursor | null;
};

export interface ExecutionReadPort {
  readExecution(ctx: CoreCallContext, ref: RunRef,
    options?: { atLeastCursor?: CommitCursor }): Promise<ReadResult<TaskExecutionRecord>>;
  /** Optional only so an existing narrow `ExecutionReadPort` test double keeps
   * compiling without a new method; the real composition always assembles it. */
  listExecutions?(ctx: CoreCallContext, request: ExecutionListPageRequest): Promise<ReadResult<TaskExecutionPage>>;
}
/** The reader needs BOTH the transactional record port and the real candidate
 * index port. In production and in the existing fixtures they are the SAME
 * physical backend, so the lookup capability is declared here as an explicit
 * intersection (never `any`). It stays optional in the type only so a caller
 * that owns a records port without the index capability still compiles; such a
 * list read returns `incomplete` instead of an empty page. */
export type ExecutionReadDependencies = {
  records: GoalRecordTransactionPort & Partial<RecordLookupPort>;
};
