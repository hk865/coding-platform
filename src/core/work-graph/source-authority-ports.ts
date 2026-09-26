import type { CommitCursor } from '../../contracts/command-event.js';
import type { ReadResult } from '../../contracts/core/results.js';
import type { RunSnapshot } from '../../contracts/dispatch.js';
import type { WorkspaceSnapshot } from '../../contracts/ledger.js';
import type { QueryJobRef, QueryJobSnapshot, QueryJobSubmittedEvent, QueryRunSnapshot } from '../../contracts/query-job.js';
import type { ReviewWorkSnapshot } from '../../contracts/reviewer-work.js';
import type { MaterialAuthorityReads } from './materials/record-ports.js';

/** Already accepted canonical facts for source binding; this port owns no state advance. */
export type SourceCanonicalSnapshot =
  | WorkspaceSnapshot | RunSnapshot | ReviewWorkSnapshot | QueryRunSnapshot | QueryJobSnapshot;
export type SourceCanonicalRef = SourceCanonicalSnapshot['ref'];
export type SourceSnapshotResult =
  | { status: 'found'; snapshot: SourceCanonicalSnapshot }
  | { status: 'not_found'; ref: SourceCanonicalRef }
  | { status: 'unavailable'; reason: string }
  | { status: 'unsupported'; reason: string };

/** Exact accepted facts only. Missing facts, unreadable facts, and fact kinds
 * without a provider stay distinct. A found Run is not an execution/read grant:
 * current lifecycle, identity and permissions remain the consumer's checks. */
export type SourceSnapshotReads = {
  load(ref: SourceCanonicalRef): Promise<SourceSnapshotResult>;
  /**
   * R5b.2 exact submission locator. Optional so a snapshot-only Work caller
   * keeps its existing `load` behavior. When present, the formal Query source
   * path resolves the original initiator from the Job's own locator instead of
   * scanning events; absence stays explicitly unsupported and is never faked as
   * an empty page.
   */
  readQuerySubmission?(ref: QueryJobRef): Promise<ReadResult<QueryJobSubmittedEvent>>;
};

/** Reuse the already assembled material canonical reader; no second Store
 * connection, record decoder, candidate lookup or history scan is needed.
 * Workspace/Run/QueryRun are currently supported by that reader. QueryJob and
 * ReviewWork remain unsupported here, not absent. */
export type SourceSnapshotReadDependencies = {
  authority: MaterialAuthorityReads;
  /**
   * R5b.2 optional same-records dependency for the exact QueryJob submission
   * reader. A Work-only caller omits it and keeps today's behavior; the formal
   * Query composition injects the SAME records and enables the exact read.
   */
  records?: import('../record-store/ports.js').GoalRecordTransactionPort
    & import('../record-store/lookup-ports.js').RecordLookupPort;
};

/** Only the original QueryJob submission is interpreted; other history stays opaque. */
export type SourceAuthorityEvent = QueryJobSubmittedEvent | { eventType: 'unrelated' };
export type SourceAuthorityPage = {
  afterCursor: CommitCursor | null;
  throughCursor: CommitCursor | null;
  events: { cursor: CommitCursor; event: SourceAuthorityEvent }[];
  hasMore: boolean;
};

/** Query-origin consumers still require the real event capability. Snapshot-only
 * Work consumers use SourceSnapshotReads; do not supply fake empty event pages. */
export type SourceAuthorityReads = SourceSnapshotReads & {
  events(query: { afterCursor: CommitCursor | null; limit: number }): Promise<SourceAuthorityPage>;
};
