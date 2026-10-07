/** R4c.2a: exact persisted facts, never a Kernel entry permit. */
import type { ArtifactRef } from '../../../contracts/artifact.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { ControlIntentSnapshotV1 } from '../../../contracts/control-intent.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { RunRef, RunSnapshot, TaskAttemptSnapshot, TaskLeaseSnapshot } from '../../../contracts/dispatch.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type { TaskRequeueSnapshotV1 } from '../../../contracts/task-requeue.js';
import type { RoundSnapshot } from '../../../contracts/verification.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { RawArtifactStorePort } from '../../record-store/body-ports.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { SessionMessage } from './communication-contracts.js';
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

/**
 * C3 continuation-brief basis (WorkGraph side): the durable facts AgentRuntime
 * assembles a `ContinuationBriefV1` from, read in one `readMany` window. Bodies
 * are returned only for inputs the Run's own TaskRequeue lists. Nothing here
 * is a new record or authorization.
 */
export type ContinuationBasis = {
  /** The new Run; it carries a `requeueRef`. */
  run: RunSnapshot;
  requeue: TaskRequeueSnapshotV1;
  /** Every TaskRequeue of the Task in Run-chain order (oldest first), for the ordinal and earlier classes. */
  allRequeues: TaskRequeueSnapshotV1[];
  /** The afterRun record. */
  previous: TaskExecutionRecord;
  previousIntents: { pointer: ControlIntentSnapshotV1 | null; steers: ControlIntentSnapshotV1[] };
  /** The wait message when the afterRun outcome is `yielded`. */
  previousWait: SessionMessage | null;
  /** `requeue.afterRoundRef` (the chain head). */
  round: RoundSnapshot | null;
  /** Bounded Artifact bodies listed in `requeue.newInputRefs`; `truncated` when the reader cut the body. */
  newInputBodies: { ref: ArtifactRef; body: string | null; truncated: boolean; reason: string | null }[];
  /**
   * Bounded reply texts (the text of the stored message envelope) of listed messages whose sender is not the new
   * claim Session; `truncated` when the reader cut the text.
   */
  replyBodies: { messageRef: SessionMessageRef; body: string | null; truncated: boolean; reason: string | null }[];
  /** Nearest entered ancestor when the afterRun never entered (at most 4 hops); `[]` otherwise. */
  factsChain: { requeue: TaskRequeueSnapshotV1; run: TaskExecutionRecord; round: RoundSnapshot | null }[];
  readThrough: CommitCursor | null;
};

export interface ExecutionReadPort {
  readExecution(ctx: CoreCallContext, ref: RunRef,
    options?: { atLeastCursor?: CommitCursor }): Promise<ReadResult<TaskExecutionRecord>>;
  /** Optional only so an existing narrow `ExecutionReadPort` test double keeps
   * compiling without a new method; the real composition always assembles it. */
  listExecutions?(ctx: CoreCallContext, request: ExecutionListPageRequest): Promise<ReadResult<TaskExecutionPage>>;
  /**
   * C3: the continuation basis of a requeue Run; `not_found` when the Run has
   * no `requeueRef`. Optional like `listExecutions`; the real reader always
   * publishes it.
   */
  readContinuationBasis?(ctx: CoreCallContext, request: { runRef: RunRef }): Promise<ReadResult<ContinuationBasis>>;
}
/** The reader needs BOTH the transactional record port and the real candidate
 * index port. In production and in the existing fixtures they are the SAME
 * physical backend, so the lookup capability is declared here as an explicit
 * intersection (never `any`). It stays optional in the type only so a caller
 * that owns a records port without the index capability still compiles; such a
 * list read returns `incomplete` instead of an empty page. */
export type ExecutionReadDependencies = {
  records: GoalRecordTransactionPort & Partial<RecordLookupPort>;
  /**
   * C3: the raw body store `readContinuationBasis` reads the bounded bodies of
   * a requeue's new inputs from. Absent, those bodies are reported unreadable
   * (null with a reason); every other read is unchanged.
   */
  bodies?: Pick<RawArtifactStorePort, 'read'>;
};
