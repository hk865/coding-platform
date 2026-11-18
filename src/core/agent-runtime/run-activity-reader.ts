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

/** 一段读窗：位置、上界、是否先探测、页数上限，和接着读时手里已有的记录。 */
export type TurnWindowInput = {
  session: SessionRecord;
  fromPosition: number;
  through: { position: number; bound: Exclude<RunActivityBound, 'kernel_tail'> } | 'kernel_tail';
  probeFirst: boolean;
  signal: AbortSignal;
  maxPages?: number;
  /** 只读它已有的记录和位置，从那之后接着读；不改它。 */
  resume?: RunActivityResume;
};

/**
 * 读窗的翻页解码（活动计数和 Run 步骤共用）：读到的记录、冻住的上界和最后一条的位置；
 * 读不出时的回答和计数完全一样（见下面 `readRunActivityFacts` 的错误表），`turn_not_found` 由用的一方判。
 */
export async function readTurnWindow(owner: SessionHistoryCursorOwner, input: TurnWindowInput): Promise<
  { kind: 'records'; decoded: DecodedKernelRecord[]; throughPosition: number; lastPosition: number } | RunActivityRead> {
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
      return { kind: 'records', decoded, throughPosition: throughPosition ?? input.fromPosition, lastPosition: expected - 1 };
    }
    if (page === maxPages - 1) {
      return { kind: 'facts', facts: unknownFacts('capacity', `the activity window exceeds ${String(maxPages)} pages`) };
    }
  }
  return { kind: 'facts', facts: unknownFacts('capacity', `the activity window exceeds ${String(maxPages)} pages`) };
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
  input: TurnWindowInput & { kernel: KernelExecutionBinding },
): Promise<RunActivityRead> {
  const read = await readTurnWindow(owner, input);
  if (read.kind !== 'records') return read;
  const reduced = advanceResume(input.resume, read, input.kernel);
  const bound: RunActivityBound = input.through === 'kernel_tail' ? 'kernel_tail' : input.through.bound;
  const facts = tallyTurnActivity(read.decoded, input.kernel, {
    fromPosition: input.fromPosition, throughPosition: read.throughPosition, bound,
  }, reduced);
  return { kind: 'facts', facts };
}

/**
 * 接着读的那一步（活动计数和 Run 步骤共用）：把这次读到的记录归约进 `resume` 手里的 Turn 状态，
 * 再把 `resume` 推到这次读到的位置。没有 `resume` 时是 undefined，由计数自己从头归约。
 */
export function advanceResume(resume: RunActivityResume | undefined,
  read: { decoded: DecodedKernelRecord[]; lastPosition: number }, kernel: KernelExecutionBinding,
): ReturnType<typeof reduceTurnFromStart> | undefined {
  if (resume === undefined) return undefined;
  // The Kernel reducer is a left fold, so applying the new events to the kept state is the full reduction.
  const reduced = resume.reduced === null ? reduceTurnFromStart(read.decoded, kernel)
    : applyTurnEvents(resume.reduced.state, read.decoded, kernel, resume.reduced.position);
  resume.decoded = read.decoded;
  resume.position = read.lastPosition;
  resume.reduced = reduced === null ? null : { state: reduced, position: read.lastPosition };
  return reduced;
}
