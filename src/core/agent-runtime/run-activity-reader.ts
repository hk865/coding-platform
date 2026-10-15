/**
 * Slice 2B L6: the window reader behind every end-of-Run tally.
 *
 * `readRunActivityFacts` is given an EXPLICIT window `{kernel, fromPosition,
 * through}` by its caller; it never reads the Run's stored position record
 * (F26, F27). `through` is either a position plus where that bound came from,
 * or `'kernel_tail'` (read to the Kernel's current last record and filter by
 * the fixed Turn identity). `turnTerminal` is always the reduced Turn's status
 * inside the window, never a property of the bound (L4).
 *
 * The read is bounded: 200 records per page, `RUN_ACTIVITY_MAX_PAGES` pages
 * by default (injectable in tests, P4/L17). A probe that proves nothing is
 * `retry_later` (nothing is written); a damaged or non-contiguous history is an
 * explicit `unknown`; a read failure is returned, never turned into success,
 * zero or an empty result (rule 3).
 */
import { RUN_ACTIVITY_MAX_PAGES, RUN_ACTIVITY_RULE_VERSION } from '../../contracts/run-activity.js';
import type { RunActivityBound, RunActivityFactsV1, RunActivityUnknownReason } from '../../contracts/run-activity.js';
import type { SessionRecord } from '../../contracts/core/session.js';
import { decodeKernelEntry, type DecodedKernelRecord } from './kernel-turn-facts.js';
import { tallyTurnActivity } from './run-activity-tally.js';
import type { SessionHistoryCursorOwner } from './session-operations.js';
import type { KernelExecutionBinding } from '../work-graph/model/execution-entry-contracts.js';

/** L6: the answer of one window read. `retry_later` writes nothing and is retried later. */
export type RunActivityRead = { kind: 'facts'; facts: RunActivityFactsV1 } | { kind: 'retry_later'; reason: string };

const PAGE_LIMIT = 200;
const DETAIL_LIMIT = 500;

function truncateDetail(reason: string): string {
  return reason.length <= DETAIL_LIMIT ? reason : reason.slice(0, DETAIL_LIMIT);
}

/** L6: an explicit unknown with the rule version and a bounded detail. */
export function unknownFacts(reason: RunActivityUnknownReason, detail: string): RunActivityFactsV1 {
  return { status: 'unknown', ruleVersion: RUN_ACTIVITY_RULE_VERSION, reason, detail: truncateDetail(detail) };
}

/**
 * L6: read the explicit window and tally it.
 *
 * Errors:
 * - `missing`/`damaged` probe → `unknown('kernel_unreadable')`;
 * - `transient`/`host_config`/`cancelled` probe, or a rejected read coded
 *   `unavailable`/`cancelled` → `retry_later` (nothing is written);
 * - any other read failure → `unknown('history_read_failed')`;
 * - a damaged or non-contiguous record → `unknown('history_damaged')`;
 * - more than `maxPages` pages → `unknown('capacity')`;
 * - no `turn.started` of the fixed identity → `unknown('turn_not_found')`
 *   (the pure tally makes that decision).
 */
export async function readRunActivityFacts(
  owner: SessionHistoryCursorOwner,
  input: {
    session: SessionRecord;
    kernel: KernelExecutionBinding;
    fromPosition: number;
    through: { position: number; bound: Exclude<RunActivityBound, 'kernel_tail'> } | 'kernel_tail';
    probeFirst: boolean;
    signal: AbortSignal;
    maxPages?: number;
  },
): Promise<RunActivityRead> {
  const maxPages = input.maxPages ?? RUN_ACTIVITY_MAX_PAGES;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
    return { kind: 'retry_later', reason: 'maxPages must be a positive safe integer' };
  }
  if (input.probeFirst) {
    const probe = await owner.probe({ session: input.session, signal: input.signal });
    if (probe.verdict === 'missing' || probe.verdict === 'damaged') {
      return { kind: 'facts', facts: unknownFacts('kernel_unreadable', probe.reason) };
    }
    if (probe.verdict !== 'ready') return { kind: 'retry_later', reason: probe.reason };
  }
  const bound: RunActivityBound = input.through === 'kernel_tail' ? 'kernel_tail' : input.through.bound;
  const decoded: DecodedKernelRecord[] = [];
  let cursor = Math.max(0, input.fromPosition - 1);
  let expected = cursor + 1;
  let throughPosition: number | null = input.through === 'kernel_tail' ? null : input.through.position;
  for (let page = 0; page < maxPages; page += 1) {
    let window;
    try {
      window = await owner.readPositionWindow({
        session: input.session, afterPosition: cursor, throughPosition, limit: PAGE_LIMIT, signal: input.signal,
      });
    } catch (error) {
      if (input.signal.aborted) return { kind: 'retry_later', reason: 'the activity window read was cancelled' };
      return { kind: 'facts', facts: unknownFacts('history_read_failed', error instanceof Error ? error.message : String(error)) };
    }
    if (window.status !== 'ready') {
      if (window.status === 'rejected' && (window.code === 'unavailable' || window.code === 'cancelled')) {
        return { kind: 'retry_later', reason: window.reason };
      }
      const detail = window.status === 'rejected' ? window.reason : `the Kernel history is ${window.status}`;
      return { kind: 'facts', facts: unknownFacts('history_read_failed', detail) };
    }
    throughPosition = window.value.throughPosition;
    for (const entry of window.value.entries) {
      const item = decodeKernelEntry(entry);
      if (item === null) return { kind: 'facts', facts: unknownFacts('history_damaged', 'a raw history entry is damaged or not a Kernel Session record') };
      if (item.position !== expected) return { kind: 'facts', facts: unknownFacts('history_damaged', 'the Kernel history positions are not contiguous') };
      expected += 1;
      decoded.push(item);
    }
    cursor = window.value.nextPosition;
    if (!window.value.hasMore) {
      const facts = tallyTurnActivity(decoded, input.kernel, {
        fromPosition: input.fromPosition, throughPosition: throughPosition ?? input.fromPosition, bound,
      });
      return { kind: 'facts', facts };
    }
    if (page === maxPages - 1) {
      return { kind: 'facts', facts: unknownFacts('capacity', `the activity window exceeds ${String(maxPages)} pages`) };
    }
  }
  return { kind: 'facts', facts: unknownFacts('capacity', `the activity window exceeds ${String(maxPages)} pages`) };
}
