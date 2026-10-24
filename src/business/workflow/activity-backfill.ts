/**
 * Slice 2B L8/P12: the two Workflow backfill operations.
 *
 * `backfillRecentActivity` is the automatic Host-start job over
 * `[now − ACTIVITY_RECENT_WINDOW_DAYS, now)`; `backfillActivityRange` is the
 * human-facing range job behind `activity/backfill`. Both delegate the candidate
 * rules to the WorkGraph `RunActivityPort` (`listActivityBackfillCandidates`)
 * and the tally to the Runtime's `countRunActivity`, then write the one record
 * through `recordRunActivity` (`recordedBy: 'backfill'`). They never call a
 * model and never change a Run, Task or Attempt (decision 20).
 *
 * The batch cursor is opaque to callers and encodes one keyset position of the
 * `s2b-run-by-workspace-ended` scan. A `retry_later` leaves the cursor pointing
 * at that Run, so the next call starts there again; every other inspected Run
 * advances the cursor strictly past it. Nothing is written when nothing needs
 * doing, so a Host restart without a missing tally writes no ledger event (L8).
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { WorkspaceScope } from '../../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import type { RunRef } from '../../contracts/dispatch.js';
import type { QueryRunRef } from '../../contracts/query-job.js';
import { ACTIVITY_RECENT_WINDOW_DAYS } from '../../contracts/run-activity.js';
import type { RunActivityFactsV1 } from '../../contracts/run-activity.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../contracts/fingerprint.js';
import type { RuntimeExecutionPort } from '../../core/agent-runtime/ports.js';
import type {
  ActivityBackfillCandidate, ActivityBackfillCursor, RunActivityPort,
} from '../../core/work-graph/tasks/run-activity-service.js';
import { reworkActorClassOf } from '../../contracts/task-requeue.js';
import type { ActivityBackfillBatchV1 } from './contracts.js';

/**
 * §10: the measured default batch size. It is injectable (P4) so a test can run
 * one Run per batch; production never passes another value.
 */
export const ACTIVITY_BACKFILL_BATCH_RUNS = 5;

const DAY_MS = 86_400_000;
/** A retry that must restart the scan, so the opaque cursor is not `null` (= done). */
const RESTART_CURSOR = 'restart';

type Cursor = ActivityBackfillCursor;

export type ActivityBackfillDependencies = {
  /**
   * The Runtime read side (L6/L16). A dependency without `countQueryActivity`
   * leaves the Work branch unchanged and makes only a Query candidate answer
   * `unsupported`.
   */
  runtime: Pick<RuntimeExecutionPort, 'countRunActivity'> & Partial<Pick<RuntimeExecutionPort, 'countQueryActivity'>>;
  /**
   * The WorkGraph owner of the candidate scan and the two record writes. A
   * dependency without `recordQueryActivity` has the same narrow effect.
   */
  activity: Pick<RunActivityPort, 'listActivityBackfillCandidates' | 'recordRunActivity'>
    & Partial<Pick<RunActivityPort, 'recordQueryActivity'>>;
  /** The trusted Host clock; required for the recent window and `recordedAt`. */
  now(): string;
  /** P4/L17 injection point; production never passes it. */
  maxPages?: number;
  /** P4 batch-size injection point; production never passes it. */
  batchRuns?: number;
};

export type ActivityBackfillOperations = {
  backfillRecentActivity(ctx: CoreCallContext, input: { workspace: WorkspaceScope; cursor: string | null }):
    Promise<ReadResult<ActivityBackfillBatchV1>>;
  backfillActivityRange(ctx: CoreCallContext, input: { workspace: WorkspaceScope; from: string; to: string; cursor: string | null }):
    Promise<ReadResult<ActivityBackfillBatchV1>>;
};

function rejection(code: CoreRejection['code'], reason: string): CoreRejection {
  return { status: 'rejected', code, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function parseCursor(raw: string | null): Cursor | null | 'invalid' {
  if (raw === null || raw === undefined) return null;
  if (raw === RESTART_CURSOR) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return 'invalid'; }
  if (!isRecord(parsed) || !nonEmpty(parsed['order']) || !nonEmpty(parsed['refKey'])
    || (parsed['kind'] !== 'run' && parsed['kind'] !== 'query')) return 'invalid';
  return { order: parsed['order'] as string, kind: parsed['kind'], refKey: parsed['refKey'] as string };
}

function encodeCursor(cursor: Cursor | null): string | null {
  return cursor === null ? null : JSON.stringify({ order: cursor.order, kind: cursor.kind, refKey: cursor.refKey });
}

/** A retry at the start of the scan is a non-null cursor that decodes to `null` again. */
function encodeRetryCursor(cursor: Cursor | null): string {
  return cursor === null ? RESTART_CURSOR : JSON.stringify({ order: cursor.order, kind: cursor.kind, refKey: cursor.refKey });
}

function parseWorkspace(value: unknown): WorkspaceScope | null {
  if (!isRecord(value) || !nonEmpty(value['projectId']) || !nonEmpty(value['workspaceId'])) return null;
  return { projectId: value['projectId'], workspaceId: value['workspaceId'] };
}

/** L8/L15: only a human Host actor may run the explicit range backfill. */
function isHumanHost(ctx: CoreCallContext): boolean {
  const principal = (ctx as unknown as { principal?: unknown }).principal;
  if (!isRecord(principal) || principal['kind'] !== 'host') return false;
  const actor = principal['actor'];
  if (!isRecord(actor) || (actor['kind'] !== 'human' && actor['kind'] !== 'system') || !nonEmpty(actor['id'])) return false;
  return reworkActorClassOf(principal as never, actor as never) === 'human';
}

function isIsoInstant(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

export function createActivityBackfill(deps: ActivityBackfillDependencies): ActivityBackfillOperations {
  const batchRuns = deps.batchRuns ?? ACTIVITY_BACKFILL_BATCH_RUNS;
  if (!Number.isSafeInteger(batchRuns) || batchRuns < 1) {
    throw new Error('ACTIVITY_BACKFILL_BATCH_RUNS must be a positive safe integer');
  }
  const act = deps.runtime.countRunActivity?.bind(deps.runtime) ?? null;
  const actQuery = typeof deps.runtime.countQueryActivity === 'function'
    ? deps.runtime.countQueryActivity.bind(deps.runtime) : null;
  const writeQuery = typeof deps.activity.recordQueryActivity === 'function'
    ? deps.activity.recordQueryActivity.bind(deps.activity) : null;

  /**
   * R1: a submission identity that does not reset across Host lifetimes. The
   * candidate read's commit cursor changes as soon as any write commits, so two
   * Host lifetimes that retry the same Run with different facts get different
   * request ids; a retry of the same submission (no commit in between) reuses
   * the same id and replays instead of conflicting. The keyset `next` is the
   * first fallback, and a fresh process-local token is the last resort when the
   * store reports no commit cursor at all.
   */
  function submissionToken(
    selection: { cursor: string | null; activityRevision: number | null }, facts: RunActivityFactsV1,
  ): string {
    if (selection.cursor !== null) return selection.cursor;
    // No commit cursor from the backend: fall back to the selected record's
    // revision plus a digest of the facts. That is stable for a retry of the
    // same submission and distinct for different facts, and — unlike a
    // process-local counter or the deterministic keyset — stays unique across
    // Host lifetimes (review round 2, R1).
    return sha256Hex(canonicalJson({ revision: selection.activityRevision, facts } as unknown as JsonValue));
  }

  /**
   * One batch over `[from, to)` by `endedAt`. `mode: 'recent'` retries only the
   * L8 auto-retry reasons; `mode: 'range'` retries any `unknown`.
   */
  async function runBatch(
    ctx: CoreCallContext, workspace: WorkspaceScope, mode: 'recent' | 'range', from: string, to: string,
    cursor: Cursor | null,
  ): Promise<ReadResult<ActivityBackfillBatchV1>> {
    if (act === null) {
      return rejection('unsupported', 'the Runtime does not publish countRunActivity');
    }
    const processed: ActivityBackfillBatchV1['processed'] = [];
    let at = cursor;
    while (processed.length < batchRuns) {
      const listed = await deps.activity.listActivityBackfillCandidates(ctx,
        { workspace, mode, from, to, after: at, limit: 1 });
      if (listed.status !== 'ready') return listed;
      const candidate = listed.value.candidates[0];
      if (candidate === undefined) {
        // The scan found nothing more; a non-null `next` only appears when the
        // read cap stopped it, so the batch is not done yet.
        const next = listed.value.next ?? null;
        return { status: 'ready', value: { processed, next: encodeCursor(next), done: next === null } };
      }
      // A missing Query-side dependency only stops the Query branch; a Work
      // Run in the same list is still processed by the branch above.
      if (candidate.kind === 'query' && (actQuery === null || writeQuery === null)) {
        return rejection('unsupported', 'the activity backfill has no Query activity dependency');
      }
      const counted = candidate.kind === 'run'
        ? await act(ctx, { runRef: candidate.runRef, ...(deps.maxPages === undefined ? {} : { maxPages: deps.maxPages }) })
        : await actQuery!(ctx, { queryRunRef: candidate.queryRunRef,
          ...(deps.maxPages === undefined ? {} : { maxPages: deps.maxPages }) });
      if (counted.status !== 'ready') {
        // L8: a rejected read coded `unavailable`/`cancelled` is retryable and
        // writes nothing; any other failure is returned, never an empty batch.
        if (counted.status === 'rejected' && (counted.code === 'unavailable' || counted.code === 'cancelled')) {
          processed.push(processedItem(candidate, 'retry_later', counted.reason));
          return { status: 'ready', value: { processed, next: encodeRetryCursor(at), done: false } };
        }
        return counted;
      }
      const value = counted.value;
      if (value.kind === 'retry_later') {
        processed.push(processedItem(candidate, 'retry_later', value.reason));
        return { status: 'ready', value: { processed, next: encodeRetryCursor(at), done: false } };
      }
      if (value.kind === 'not_entered') {
        processed.push(processedItem(candidate, 'not_entered', null));
      } else {
        const written = await writeFacts(ctx, candidate, value.facts, { cursor: listed.value.cursor });
        if ('rejection' in written) return written.rejection;
        if ('skipped' in written) {
          processed.push(processedItem(candidate, 'skipped', 'record_changed'));
        } else if (written.outcome === 'unchanged') {
          processed.push(processedItem(candidate, 'unchanged', null));
        } else {
          processed.push(processedItem(candidate,
            value.facts.status === 'counted' ? 'counted' : 'unknown',
            value.facts.status === 'unknown' ? value.facts.reason : null));
        }
      }
      // Advance strictly past the inspected entry; `next` is the keyset of that
      // entry, so passing it back as `after` resumes after it.
      at = listed.value.next;
    }
    // The batch is full. Probe once from the cursor so `done`/`next` are exact
    // (L8: `next: null` means there is nothing left to inspect). R9: the probe
    // can return an empty page WITH a continuation when its read cap stopped the
    // scan; that continuation must be preserved instead of declaring `done`.
    if (at !== null) {
      const probe = await deps.activity.listActivityBackfillCandidates(ctx,
        { workspace, mode, from, to, after: at, limit: 1 });
      if (probe.status !== 'ready') return probe;
      if (probe.value.candidates.length === 0) {
        const next = probe.value.next ?? null;
        return { status: 'ready', value: { processed, next: encodeCursor(next), done: next === null } };
      }
    }
    // R9: a full batch whose last inspected entry had no continuation is done
    // too (the scan is exhausted); `next: null` must not be paired with `done:
    // false`.
    return { status: 'ready', value: { processed, next: encodeCursor(at), done: at === null } };
  }

  /**
   * Write one tally through the WorkGraph owner. A `revision_conflict` is L8's
   * `skipped`/`record_changed` (the end commit committed first); any other
   * rejection is returned unchanged.
   */
  async function writeFacts(ctx: CoreCallContext, candidate: ActivityBackfillCandidate, facts: RunActivityFactsV1,
    selection: { cursor: string | null }):
    Promise<{ outcome: 'created' | 'replaced' | 'unchanged' } | { skipped: true } | { rejection: CoreRejection }> {
    const token = submissionToken({ cursor: selection.cursor, activityRevision: candidate.activityRevision }, facts);
    let written;
    if (candidate.kind === 'run') {
      written = await deps.activity.recordRunActivity(ctx, {
        input: { runRef: candidate.runRef, facts, expectedActivityRevision: candidate.activityRevision },
        meta: { requestId: `s2b-backfill:run:${candidate.runRef.runId}:${token}`, expected: [] },
      });
    } else {
      written = await writeQuery!(ctx, {
        input: { queryRunRef: candidate.queryRunRef, facts, expectedActivityRevision: candidate.activityRevision },
        meta: { requestId: `s2b-backfill:query:${candidate.queryRunRef.queryJobId}:${candidate.queryRunRef.runId}:${token}`,
          expected: [] },
      });
    }
    if (written.status === 'committed') return { outcome: written.value.outcome };
    if (written.code === 'revision_conflict') return { skipped: true };
    return { rejection: written };
  }

  /** The batch entry for one inspected candidate, in its own union member. */
  function processedItem(candidate: ActivityBackfillCandidate, outcome: ActivityBackfillBatchV1['processed'][number]['outcome'],
    reason: string | null): ActivityBackfillBatchV1['processed'][number] {
    return candidate.kind === 'run'
      ? { kind: 'run', runRef: candidate.runRef, outcome, reason }
      : { kind: 'query', queryRunRef: candidate.queryRunRef, outcome, reason };
  }

  return {
    async backfillRecentActivity(ctx, input) {
      const principal = (ctx as unknown as { principal?: unknown }).principal;
      if (!isRecord(principal) || principal['kind'] !== 'host') {
        return rejection('forbidden', 'an activity backfill requires a Host principal');
      }
      const workspace = parseWorkspace(input?.workspace);
      if (workspace === null) return rejection('invalid', 'backfillRecentActivity requires a WorkspaceScope');
      const cursor = parseCursor(input?.cursor ?? null);
      if (cursor === 'invalid') return rejection('invalid', 'the backfill cursor is not readable');
      const to = deps.now();
      const from = new Date(Date.parse(to) - ACTIVITY_RECENT_WINDOW_DAYS * DAY_MS).toISOString();
      return runBatch(ctx, workspace, 'recent', from, to, cursor);
    },
    async backfillActivityRange(ctx, input) {
      if (!isHumanHost(ctx)) {
        return rejection('forbidden', 'only a human operator may backfill an explicit range (L8)');
      }
      const workspace = parseWorkspace(input?.workspace);
      if (workspace === null) return rejection('invalid', 'backfillActivityRange requires a WorkspaceScope');
      if (!isIsoInstant(input?.from) || !isIsoInstant(input?.to) || input.from >= input.to) {
        return rejection('invalid', 'backfillActivityRange requires from < to as ISO instants');
      }
      const cursor = parseCursor(input?.cursor ?? null);
      if (cursor === 'invalid') return rejection('invalid', 'the backfill cursor is not readable');
      return runBatch(ctx, workspace, 'range', input.from, input.to, cursor);
    },
  };
}
