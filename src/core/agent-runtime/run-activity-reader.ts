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
import { RUN_ACTIVITY_MAX_PAGES, unknownFacts } from '../../contracts/run-activity.js';
import type { RunActivityBound, RunActivityFactsV1 } from '../../contracts/run-activity.js';
import type { SessionRecord } from '../../contracts/core/session.js';
import { applyTurnEvents, decodeKernelEntry, reduceTurnFromStart, type DecodedKernelRecord } from './kernel-turn-facts.js';
import { tallyTurnActivity } from './run-activity-tally.js';
import type { SessionHistoryCursorOwner } from './session-operations.js';
import type { KernelExecutionBinding } from '../work-graph/model/execution-entry-contracts.js';

// The one explicit-unknown constructor lives in the contracts, so the WorkGraph
// closing writes build the same value; the Runtime callers keep importing it here.
export { unknownFacts } from '../../contracts/run-activity.js';

/** L6: the answer of one window read. `retry_later` writes nothing and is retried later. */
export type RunActivityRead = { kind: 'facts'; facts: RunActivityFactsV1 } | { kind: 'retry_later'; reason: string };

/**
 * Kept by a caller that reads the same window again and again (one `fromPosition` and `kernel`,
 * `through: 'kernel_tail'`): the records already decoded and the last position they reach. A read
 * then fetches only the records after it and tallies all of them, which answers exactly what
 * reading the whole window again answers; a read that does not reach the tail within the window's
 * bound adds nothing.
 */
export type RunActivityResume = { decoded: DecodedKernelRecord[]; position: number | null;
  /** The fixed Turn reduced over `decoded`, so a later read applies only the new events. */
  reduced: { state: NonNullable<ReturnType<typeof reduceTurnFromStart>>; position: number } | null };

const PAGE_LIMIT = 200;

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
    resume?: RunActivityResume;
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
  // The whole window holds at most `maxPages` pages; a resumed read counts the records it already holds.
  const cap = maxPages * PAGE_LIMIT;
  const decoded: DecodedKernelRecord[] = [...(input.resume?.decoded ?? [])];
  let cursor = input.resume?.position ?? Math.max(0, input.fromPosition - 1);
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
      if (decoded.length === cap) return { kind: 'facts', facts: unknownFacts('capacity', `the activity window exceeds ${String(maxPages)} pages`) };
      const item = decodeKernelEntry(entry);
      if (item === null) return { kind: 'facts', facts: unknownFacts('history_damaged', 'a raw history entry is damaged or not a Kernel Session record') };
      if (item.position !== expected) return { kind: 'facts', facts: unknownFacts('history_damaged', 'the Kernel history positions are not contiguous') };
      expected += 1;
      decoded.push(item);
    }
    cursor = window.value.nextPosition;
    if (window.value.hasMore && decoded.length === cap) {
      return { kind: 'facts', facts: unknownFacts('capacity', `the activity window exceeds ${String(maxPages)} pages`) };
    }
    if (!window.value.hasMore) {
      const resume = input.resume;
      // The Kernel reducer is a left fold, so applying the new events to the kept state is the full reduction.
      const reduced = resume === undefined ? undefined : resume.reduced === null ? reduceTurnFromStart(decoded, input.kernel)
        : applyTurnEvents(resume.reduced.state, decoded, input.kernel, resume.reduced.position);
      if (resume !== undefined) {
        resume.decoded = decoded;
        resume.position = expected - 1;
        resume.reduced = reduced == null ? null : { state: reduced, position: expected - 1 };
      }
      const facts = tallyTurnActivity(decoded, input.kernel, {
        fromPosition: input.fromPosition, throughPosition: throughPosition ?? input.fromPosition, bound,
      }, reduced);
      return { kind: 'facts', facts };
    }
    if (page === maxPages - 1) {
      return { kind: 'facts', facts: unknownFacts('capacity', `the activity window exceeds ${String(maxPages)} pages`) };
    }
  }
  return { kind: 'facts', facts: unknownFacts('capacity', `the activity window exceeds ${String(maxPages)} pages`) };
}
