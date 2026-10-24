// Slice 2B §2: the Run activity contract. A `RunActivity` record holds the
// per-Run step/edit tally, changed files and model usage read from the frozen
// Kernel records; an `ActivityRecording` record marks when a workspace started
// recording. Neither is a Run state field (L4, L16).
// Slice 6A L16: the same tally is recorded for a Query entry, keyed by the full
// `QueryRunRef`; the workspace recording also names the Query epoch.
import type { SessionRef } from './core/identity.js';
import type { RunRef, RunSnapshot } from './dispatch.js';
import type { QueryRunRef } from './query-job.js';

/** L1: the tally rule version. A record carries the version it was computed with. */
export const RUN_ACTIVITY_RULE_VERSION = 1 as const;
/** L2: at most this many 15-minute quarters per Run; the rest go to `overflow`. */
export const ACTIVITY_QUARTER_CAP = 1000;
/** L3: at most this many `definite` and this many `possible` changed files. */
export const RUN_CHANGED_FILES_CAP = 500;
/** L3: at most this many model usage requests. */
export const RUN_USAGE_REQUESTS_CAP = 256;
/** Decision 50 / L8: the automatic backfill window, in days back from now. */
export const ACTIVITY_RECENT_WINDOW_DAYS = 14;
/**
 * L17: the storage-read cap for the L9–L12 reads. Measured before the freeze
 * (§10): 20,000 reads is about 0.5–1.2 s, so it stays 20,000. Injection point
 * only in tests; production never passes another value.
 */
export const ACTIVITY_READ_RECORD_CAP = 20000;
/** L6: at most this many Kernel pages (200 records each) per window read. */
export const RUN_ACTIVITY_MAX_PAGES = 64;
/** Kernel tool names whose effects can count as edits (L1); the platform `write` is recorded as `edit`. */
export const FILE_EDIT_TOOL_NAMES = ['edit', 'shell'] as const;
/** Unknown reasons the automatic backfill retries (L8). */
export const ACTIVITY_AUTO_RETRY_REASONS = ['history_read_failed', 'kernel_unreadable'] as const;

export type RunActivityRef = { aggregateType: 'RunActivity'; projectId: string; goalId: string; runId: string };
export type ActivityTotalsV1 = { steps: number; edits: number; editsUnknown: number };
/** UTC 15-minute quarter start, ISO with `Z` (L2). */
export type ActivityQuarterV1 = ActivityTotalsV1 & { at: string };
export type RunChangedFilesV1 = {
  definite: string[]; possible: string[]; definiteOmitted: number; possibleOmitted: number;
  possiblyIncomplete: boolean; incompleteBecause: ('command_ran' | 'edits_unknown' | 'cap')[];
};
export type RunModelUsageRequestV1 = {
  requestId: string; startedAt: string; usageStatus: 'reported' | 'unknown';
  inputTokens: number | null; outputTokens: number | null; cachedInputTokens: number | null; costUsdMicros: number | null;
};
export type RunModelUsageV1 = {
  requests: RunModelUsageRequestV1[]; omitted: number;
  totals: { inputTokens: number; outputTokens: number; cachedInputTokens: number }; complete: boolean;
};
export type RunActivityUnknownReason =
  | 'no_history_locator' | 'kernel_unreadable' | 'history_read_failed' | 'history_damaged' | 'turn_not_found' | 'capacity';
/** Where the window's upper bound came from (L6). */
export type RunActivityBound = 'end_position' | 'turn_bounds' | 'reconcile_observation' | 'kernel_tail';
export type RunActivityFactsV1 =
  | { status: 'counted'; ruleVersion: number;
      window: { kernelRunId: string; kernelTurnId: string; fromPosition: number; throughPosition: number;
        bound: RunActivityBound; turnTerminal: boolean;                // L4: the reduced Turn in the window is terminal
        unresolvedCalls: number;                                        // L1 end; L4 row 3 uses it
        turnStartedAt: string; lastRecordAt: string };                 // the two times L4's span uses
      quarters: ActivityQuarterV1[];                                    // sorted by `at`, only non-empty quarters, ≤ ACTIVITY_QUARTER_CAP
      overflow: (ActivityTotalsV1 & { firstAt: string; lastAt: string }) | null;
      totals: ActivityTotalsV1; changedFiles: RunChangedFilesV1; usage: RunModelUsageV1 }
  | { status: 'unknown'; ruleVersion: number; reason: RunActivityUnknownReason; detail: string };   // detail ≤ 500 characters
export type RunActivitySnapshot = {
  ref: RunActivityRef; revision: number; schemaVersion: 1;
  runRef: RunRef; taskId: string; workspaceId: string; sessionRef: SessionRef | null;   // L17
  runEndedAt: string;
  recordedBy: 'run_end' | 'backfill'; recordedAt: string;
  facts: RunActivityFactsV1;
  span: { firstAt: string | null; lastAt: string; basis: 'kernel' | 'run_times' };       // L4: lastAt is always text
};
/** L16: one Query entry's tally, keyed by the full QueryRunRef so two attempts never share a record. */
export type QueryActivityRef = {
  aggregateType: 'QueryActivity'; projectId: string; workspaceId: string; queryJobId: string; runId: string;
};
export type QueryActivitySnapshot = {
  ref: QueryActivityRef; revision: number; schemaVersion: 1;
  queryRunRef: QueryRunRef;
  sessionRef: SessionRef | null;          // the Session that ran it; null before a claim
  askedSessionRef: SessionRef | null;     // only a consultation copy's formal source Session
  goalId: string | null;
  queryEndedAt: string;
  recordedAt: string;
  recordedBy: 'query_end' | 'backfill';
  facts: RunActivityFactsV1;
  span: { firstAt: string | null; lastAt: string; basis: 'kernel' | 'run_times' };  // same as the Work record
};
export type ActivityRecordingRef = { aggregateType: 'ActivityRecording'; projectId: string; workspaceId: string };
export type ActivityRecordingSnapshot = {
  ref: ActivityRecordingRef; revision: number; schemaVersion: 1;
  since: string;
  /** The Query epoch; null means no Query epoch has started yet. Required in the current format. */
  querySince: string | null;
};

/** L6: an unknown tally's `detail` is cut to this many characters. */
const ACTIVITY_UNKNOWN_DETAIL_LIMIT = 500;

/**
 * L6: an explicit unknown with the rule version and a bounded detail. The one
 * constructor of an uncounted tally: the Runtime readers and the WorkGraph
 * closing writes build it here, so an unread window is never written as zero.
 */
export function unknownFacts(reason: RunActivityUnknownReason, detail: string): RunActivityFactsV1 {
  return { status: 'unknown', ruleVersion: RUN_ACTIVITY_RULE_VERSION, reason,
    detail: detail.length <= ACTIVITY_UNKNOWN_DETAIL_LIMIT ? detail : detail.slice(0, ACTIVITY_UNKNOWN_DETAIL_LIMIT) };
}

/**
 * Slice 2B L7/round-2 R5: the ONE predicate for "the Run never entered the
 * Kernel, so a missing record counts as 0". L7's cases plus the platform's own
 * `not_entered` reconcile proof, and only
 * for an ended Run with no position record:
 *
 *   - a reconcile observation `not_entered` (RUN-09 (R), RUN-16): the platform's
 *     own proof, which legitimately keeps the Kernel identity it began; or
 *   - a V2 authorization phase `authorized` or `revoked` with NO Kernel
 *     identity (`authorization.kernel === null`); or
 *   - no authorization at all and `endedAt >= since` (the only way to reach
 *     `ended` from `Claimed`, i.e. RUN-09).
 *
 * A V2 authorization that already carries a Kernel identity and has no
 * `not_entered` reconcile proof is never "never entered" (round-3 R5). V1
 * authorization never proves non-entry either (the round-1 shortcut R5
 * removes), and a Run that is still `starting`/`running` is never classified
 * here: the callers must treat it as incomplete instead.
 */
export function provenNotEnteredKernel(run: RunSnapshot, since: string | null): boolean {
  if (run.executionHistory !== undefined) return false;
  if (run.status !== 'ended') return false;
  // A reconcile that observed `not_entered` is the platform's own proof, and it
  // keeps the Kernel identity it began (`revokedRunRecord`, RUN-09 (R), RUN-16),
  // so it is checked before the authorization binding.
  if (run.reconciliation?.observation.kind === 'not_entered') return true;
  const authorization = run.executionAuthorization;
  if (authorization !== undefined) {
    return authorization.kernel === null
      && (authorization.phase === 'authorized' || authorization.phase === 'revoked');
  }
  return run.endedAt !== null && since !== null && run.endedAt >= since;
}
