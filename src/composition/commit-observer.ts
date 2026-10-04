/**
 * Task E: the one observation seam over the shared RecordStore commit path.
 *
 * Every platform writer receives the SAME `backend.records` object built by
 * `createTargetPlatform`, so wrapping its `commit` once here sees every ledger
 * commit of this process without touching a core service or the frozen Kernel.
 * The wrapper is purely additive: it forwards the exact `PreparedCommit`,
 * returns the exact receipt, and reports only commits that really appended
 * events (`committed` and not `replayed`). An observer failure is swallowed so
 * it can never change, delay or throw into a write receipt.
 *
 * The observer receives coarse facts only: the commit cursor (the `events`
 * table autoincrement id) and the aggregate type/project of each touched ref.
 * It never receives a record body.
 */
import type { CommitCursor } from '../contracts/command-event.js';
import type { RecordLookupPort } from '../core/record-store/lookup-ports.js';
import type { GoalRecordTransactionPort, PreparedCommit, StoreCommitReceipt } from '../core/record-store/ports.js';

/** One ref a commit wrote; `projectId` is null when the ref carries none. */
export type RecordCommitAggregate = { aggregateType: string; projectId: string | null };

export type RecordCommitNotice = { cursor: CommitCursor; aggregates: RecordCommitAggregate[] };

export type RecordCommitObserver = {
  /** Called once before any writer exists, with the ledger head: `null` for an
   * empty ledger, `'unknown'` when the head could not be read. */
  started(head: CommitCursor | null | 'unknown'): void;
  /** Called after every non-replayed commit, in commit order. */
  committed(notice: RecordCommitNotice): void;
};

type ObservedRecords = GoalRecordTransactionPort & RecordLookupPort;
type ObservableBackend = { readonly records: ObservedRecords; close(): Promise<void> };

function aggregatesOf(input: PreparedCommit): RecordCommitAggregate[] {
  const records: readonly unknown[] = Array.isArray(input?.records) ? input.records : [];
  const aggregates: RecordCommitAggregate[] = [];
  for (const record of records) {
    const refKey = typeof record === 'object' && record !== null ? (record as { refKey?: unknown }).refKey : undefined;
    if (typeof refKey !== 'string') continue;
    let ref: unknown;
    try { ref = JSON.parse(refKey); } catch { continue; }
    if (typeof ref !== 'object' || ref === null) continue;
    const { aggregateType, projectId } = ref as { aggregateType?: unknown; projectId?: unknown };
    if (typeof aggregateType !== 'string' || aggregateType.length === 0) continue;
    aggregates.push({ aggregateType, projectId: typeof projectId === 'string' && projectId.length > 0 ? projectId : null });
  }
  return aggregates;
}

/**
 * Return a backend whose `records.commit` also reports to `observer`. Without
 * an observer the original backend is returned unchanged. The head is read
 * BEFORE the wrapper is published, while no writer exists yet, so no commit can
 * fall between the reported head and the first observed commit.
 */
export async function observeRecordCommits(
  backend: ObservableBackend, observer: RecordCommitObserver | undefined,
): Promise<ObservableBackend> {
  if (observer === undefined) return backend;
  let head: CommitCursor | null | 'unknown' = 'unknown';
  try {
    const read = await backend.records.readMany([]);
    if (read.status === 'ready') head = read.value.readThrough;
  } catch { /* the head stays unknown; resumes then answer reset */ }
  try { observer.started(head); } catch { /* an observer never blocks the platform */ }
  const raw = backend.records;
  const commit = async (input: PreparedCommit): Promise<StoreCommitReceipt> => {
    const aggregates = aggregatesOf(input);
    const receipt = await raw.commit(input);
    if (receipt.status === 'committed' && !receipt.replayed) {
      try { observer.committed({ cursor: receipt.cursor, aggregates }); } catch { /* the receipt is unchanged */ }
    }
    return receipt;
  };
  // Both RecordStore backends build `records` from closures without `this`, so
  // the spread keeps every other method exactly as it was.
  return { records: { ...raw, commit }, close: () => backend.close() };
}
