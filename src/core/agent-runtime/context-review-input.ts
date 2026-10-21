import type { UnknownCallReviewInputV1 } from '../../contracts/core/prepared-execution.js';
import type {
  CapturedPathV1, UnknownCallReviewRef, UnknownCallReviewV1,
} from '../../contracts/unknown-call-review.js';
import { utf8Bytes } from './context-support.js';

/** D8: one command and its cwd together may not exceed this many UTF-8 bytes. */
export const REVIEW_COMMAND_MAX_BYTES = 4 * 1024;

// ------------------------------------------------------------------------ //
// K3 L13: the review-round instruction (structured + rendered)              //
// ------------------------------------------------------------------------ //

/** L13: the command/cwd pair read from the original Run's Kernel facts. */
export type ReviewCommandFactV1 = { command: string | null; cwd: string | null };

/** Cut a string to at most `maxBytes` UTF-8 bytes on a code-point boundary. */
function truncateUtf8(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  if (utf8Bytes(text) <= maxBytes) return text;
  let used = 0;
  let out = '';
  const encoder = new TextEncoder();
  for (const character of text) {
    const size = encoder.encode(character).length;
    if (used + size > maxBytes) break;
    out += character;
    used += size;
  }
  return out;
}

/**
 * K3 L13/D8: the structured `UnknownCallReviewInputV1` for a review round. Only
 * `process` items are listed, by alias; the structured items never carry the
 * Kernel callId (D8). A command whose command+cwd exceeds 4 KiB is cut and marked
 * `truncated`; without the full Kernel command the record's own 512-char cut is
 * `truncated` too. The written conclusion of an earlier unfinished round is
 * carried as `current`.
 */
export function buildUnknownCallReviewInputV1(input: {
  review: UnknownCallReviewV1;
  reviewRef: UnknownCallReviewRef;
  phase: 'review' | 'proposal';
  round: number;
  commandFacts?: ReadonlyMap<number, ReviewCommandFactV1>;
  targets?: number[] | null;
  personText?: string | null;
  /** L18/lead answer 3: the disposition answer's annotations, in answer order (proposal only). */
  annotations?: Array<{ path: string | null; text: string }>;
  /** L20/D7: the undetermined platform aliases of a mixed card (proposal only). */
  platformTargets?: number[];
  /**
   * F/L6: the full changed-path list from the capture Artifact, or null/absent
   * when it cannot be read (then the record's 50-path sample is the fallback).
   */
  fullChanges?: CapturedPathV1[] | null;
}): UnknownCallReviewInputV1 {
  const { review } = input;
  const processItems = review.items.filter(item => item.kind === 'process');
  const items = processItems.map((item) => {
    const fact = input.commandFacts?.get(item.alias);
    const command = fact?.command ?? item.summary.command;
    const cwd = fact?.cwd ?? item.summary.cwd;
    const commandBytes = command === null ? 0 : utf8Bytes(command);
    const originalCwdBytes = cwd === null ? 0 : utf8Bytes(cwd);
    const overLimit = commandBytes + originalCwdBytes > REVIEW_COMMAND_MAX_BYTES;
    const truncated = overLimit || (fact === undefined && item.summary.truncated);
    // F: cut the cwd to the 4 KiB budget FIRST, then give the command the rest.
    const boundedCwd = cwd === null ? null : truncateUtf8(cwd, REVIEW_COMMAND_MAX_BYTES);
    const cwdBytes = boundedCwd === null ? 0 : utf8Bytes(boundedCwd);
    const budget = Math.max(0, REVIEW_COMMAND_MAX_BYTES - cwdBytes);
    const boundedCommand = command === null
      ? null
      : truncated ? { text: truncateUtf8(command, budget), truncated: true } : { text: command, truncated: false };
    const sameBatch = review.items
      .filter(other => other.alias !== item.alias && other.kernel.declaredPosition === item.kernel.declaredPosition)
      .map(other => other.alias);
    const concluded = item.observed.by === 'review_round' || item.observed.by === 'settlement';
    return {
      alias: item.alias, toolName: item.toolName,
      display: truncated ? 'truncated' as const : 'full' as const,
      command: boundedCommand, cwd: boundedCwd, startedAt: item.startedAt, sameBatch,
      current: concluded ? item.observed : null,
      // L20/lead answer 3: proposal only, so the review phase's structured bytes
      // stay identical. Trimming nulls command/cwd but keeps this record cut.
      ...(input.phase === 'proposal' ? { summaryCommand: item.summary.command } : {}),
    };
  });
  const captured = review.workspace;
  let workspace: UnknownCallReviewInputV1['workspace'];
  if (captured.status === 'captured') {
    // F/L6: the first 200 from the FULL capture; the record's sample is only the
    // fallback when the capture Artifact is not readable.
    const changedSample = (input.fullChanges ?? captured.sample).slice(0, 200);
    workspace = {
      status: 'captured', runBaselineKnown: captured.runBaselineKnown,
      notVisible: [...captured.notVisible], notVisibleOmitted: captured.notVisibleOmitted,
      changedSample, changedOmitted: Math.max(0, captured.changedCount - changedSample.length),
    };
  } else {
    workspace = {
      status: 'unavailable', runBaselineKnown: captured.runBaselineKnown,
      notVisible: [], notVisibleOmitted: 0, changedSample: [], changedOmitted: 0,
    };
  }
  return {
    reviewRef: { ...input.reviewRef }, revision: review.revision, phase: input.phase, round: input.round,
    items, targets: input.targets ?? null, personText: input.personText ?? null,
    annotations: (input.annotations ?? []).map(annotation => ({ ...annotation })),
    platformTargets: [...(input.platformTargets ?? [])],
    workspace,
  };
}

/**
 * K3 L13/D8: the next trim in the fixed order — the changed sample from the
 * back, then `notVisible` from the back, then items from the last one. `null`
 * is the floor (alias + tool name stay on every item).
 */
export function trimUnknownCallReviewInput(review: UnknownCallReviewInputV1): UnknownCallReviewInputV1 | null {
  const workspace = review.workspace;
  if (workspace.changedSample.length > 0) {
    return { ...review, workspace: { ...workspace,
      changedSample: workspace.changedSample.slice(0, -1), changedOmitted: workspace.changedOmitted + 1 } };
  }
  if (workspace.notVisible.length > 0) {
    return { ...review, workspace: { ...workspace,
      notVisible: workspace.notVisible.slice(0, -1), notVisibleOmitted: workspace.notVisibleOmitted + 1 } };
  }
  const lastExpanded = [...review.items].reverse().find(item => item.display !== 'unexpanded');
  if (lastExpanded === undefined) return null;
  const at = review.items.indexOf(lastExpanded);
  // L20/lead answer 3: `command`/`cwd`/`current` go; a proposal item's
  // `summaryCommand` stays with the spread so the proposal block can still show
  // the record's cut.
  return { ...review, items: review.items.map((item, index) => index === at
    ? { ...item, display: 'unexpanded' as const, command: null, cwd: null, current: null } : item) };
}
