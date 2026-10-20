/**
 * C3 continuation brief assembly (docs/refactor/STATE-MACHINES-SPEC.md §6.1
 * contract (e); decisions C1, C3; GAP-49).
 *
 * A Run created by a requeue claim starts with a platform-assembled, bounded,
 * factual brief. AgentRuntime assembles it from durable facts only (never a
 * model call): the WorkGraph continuation basis (`readContinuationBasis`), the
 * previous Run's own Kernel Turn read through the Session history owner and
 * reduced with the shared Kernel Turn reader (`kernel-turn-facts.ts`, so
 * "confirmed result" and "pending counts as not started" mean the same as in
 * the observer), and the workspace source checkpoints. Where the records
 * cannot tell, the brief says so and never claims "no change".
 *
 * `readPreviousTurn` does the IO; `assembleContinuationBrief` is pure.
 */
import type { RunState } from '../../../vendor/coding-agent/dist/public-api.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import type { SessionMessageRef } from '../../contracts/core/session-message.js';
import {
  CONTINUATION_BRIEF_LIMITS, compareSourceCheckpoints,
  type BoundedTextV1, type ContinuationAnomalySectionV1, type ContinuationBriefV1, type ContinuationDiffOmittedReasonV1,
  type ContinuationNewInputV1, type ContinuationSourceCheckpointV1, type ContinuationToolCallV1,
  type ContinuationBlockedCommandLineV1,
  type ContinuationUnknownCallReviewFileV1, type ContinuationUnknownCallReviewItemV1, type ContinuationUnknownCallReviewV1,
} from '../../contracts/continuation-brief.js';
import { canonicalJson, type JsonValue } from '../../contracts/fingerprint.js';
import type { SessionAnomalyAnchorV1 } from '../../contracts/session-anomaly.js';
import { reworkActorClassOf, type ReworkFailureClass } from '../../contracts/task-requeue.js';
import type {
  CapturedPathV1, UnknownCallObservationV1, UnknownCallReviewItemV1, UnknownCallReviewV1, WorkspaceCaptureV1,
} from '../../contracts/unknown-call-review.js';
import type { ContinuationBasis, TaskExecutionRecord } from '../work-graph/model/execution-read-contracts.js';
import { roundFailureFacts, runFailureOrigin } from '../work-graph/state/no-progress.js';
import { deriveReworkClass, runErrorOf } from '../work-graph/state/task-failure.js';
import { decodeKernelEntry, reduceTurnFromStart, type DecodedKernelRecord } from './kernel-turn-facts.js';
import type { SessionHistoryCursorOwner } from './session-operations.js';

/** One session message part the Kernel accepted into the Turn (`run.input_accepted`), with the accepted text. */
export type AcceptedMessageInput = { messageRef: SessionMessageRef; part: 'message' | 'response'; text: string };

/** The previous Run's Turn as the Kernel records show it (`stoppedAt`, `toolCalls`, `selfChanged`, `acceptedInputs`). */
export type PreviousTurnFacts =
  | { kernel: 'read'; state: RunState; window: { fromPosition: number; throughPosition: number; omittedRecords: number };
      /** The session message parts the Turn accepted, in Kernel order (a saved reply, inbox mail). */
      acceptedMessages: AcceptedMessageInput[] }
  | { kernel: 'not_entered' }
  | { kernel: 'unavailable'; reason: string };

/** The workspace facts of the brief: its own checkpoint taken at prepare, and the uncommitted paths. */
export type BriefWorkspaceFacts = {
  briefCheckpoint: ContinuationSourceCheckpointV1;
  uncommitted: ContinuationBriefV1['workspace']['uncommitted'];
};

export type AssembleBriefInput = {
  basis: ContinuationBasis;
  /** The Run whose Kernel facts the brief reports: the afterRun, or its nearest entered ancestor. */
  factsRecord: TaskExecutionRecord;
  factsHops: number;
  factsTruncated: boolean;
  turn: PreviousTurnFacts;
  workspace: BriefWorkspaceFacts;
  /** The new Run's claim Session. */
  claimSessionRef: SessionRef;
  /**
   * LA-1, contract (e): the original Session whose completed history the new
   * Session is seeded with (`sessionBasis` of the same prepare), through which
   * position; absent or null when nothing is seeded.
   */
  seededFrom?: { sessionRef: SessionRef; throughPosition: number } | null;
  /**
   * Slice 1 §2.7: the anomaly anchors actually carried into this brief. Absent
   * or null means no section (the old brief bytes and digest stay unchanged).
   */
  anomalies?: ContinuationAnomalySectionV1 | null;
  /**
   * K3 L20: the previous/afterRun's stored review record. Absent or null means
   * no review section (the old brief bytes and digest stay unchanged).
   */
  unknownCallReview?: UnknownCallReviewV1 | null;
  /**
   * K3 L6: the run-start baseline and current file content per path, already
   * read and classified by the caller. Missing paths get no diff.
   */
  unknownCallReviewFiles?: ReadonlyMap<string, { baseline: ReviewFileRead; current: ReviewFileRead }>;
  /** K3 L6: the capture that classifies each path's change; defaults to the review's own capture. */
  unknownCallReviewCapture?: WorkspaceCaptureV1 | null;
  /** K3 L6 (item 6a): the FULL changed list read from the capture Artifact, or null when unreadable. */
  unknownCallReviewCaptureChanges?: readonly CapturedPathV1[] | null;
  /**
   * K3 B3 item 7 / lead answer 5: the Task's blocked commands (all its records,
   * ordered by record creation time then alias), already read by the caller.
   * Absent or empty means no section, so the brief stays byte-identical.
   */
  blockedCommands?: readonly ContinuationBlockedCommandLineV1[] | null;
};

/** Slice 1 §2.7: at most this many anchors are loaded into one brief. */
export const ANOMALY_ANCHOR_LIMIT = 8;

/**
 * Slice 1 §2.7: the bounded anomaly section of the brief. At most 8 anchors,
 * ordered by `recordedAt` then canonical ref; `omitted` counts the anchors not
 * carried. `null`/empty input has no section, so a brief without anomalies
 * keeps its old bytes and digest.
 */
export function assembleAnomalySection(
  anchors: readonly SessionAnomalyAnchorV1[],
): ContinuationAnomalySectionV1 | null {
  if (anchors.length === 0) return null;
  const ordered = [...anchors].sort((left, right) => {
    if (left.recordedAt < right.recordedAt) return -1;
    if (left.recordedAt > right.recordedAt) return 1;
    const leftKey = canonicalJson(left.ref as unknown as JsonValue);
    const rightKey = canonicalJson(right.ref as unknown as JsonValue);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  const carried = ordered.slice(0, ANOMALY_ANCHOR_LIMIT);
  return { anchors: carried, omitted: ordered.length - carried.length, instructionVersion: 1 };
}

// ------------------------------------------------------------------------ //
// K3 L6/L20: the unknown-call review section                                //
// ------------------------------------------------------------------------ //
/** K3 L6: one side of a file read, classified by the read-only caller (never by this pure function). */
export type ReviewFileRead =
  | { status: 'ready'; text: string }
  | { status: 'unavailable'; reason: ContinuationDiffOmittedReasonV1 | 'read_failed' };

export type UnknownCallReviewSectionInput = {
  review: UnknownCallReviewV1;
  /** The Kernel-recorded tool arguments by callId (the `oldText`/`newText` excerpts). */
  callArguments?: ReadonlyMap<string, Record<string, unknown>>;
  /** The run-start baseline and current file content per path, already read. */
  files?: ReadonlyMap<string, { baseline: ReviewFileRead; current: ReviewFileRead }>;
  /** The capture whose changed paths classify `change`; defaults to the review's own capture. */
  capture?: WorkspaceCaptureV1 | null;
  /**
   * K3 L6 (item 6a): the FULL changed list read from the capture Artifact
   * (`captureRef`). `null`/absent means the Artifact could not be read, so the
   * bounded sample is all the classifier has.
   */
  captureChanges?: readonly CapturedPathV1[] | null;
};

/** L6: `oldText`/`newText` excerpts. */
const REVIEW_EXCERPT_CHARS = 1_000;
/** L6: one path's diff. */
const REVIEW_DIFF_CHARS = 2_000;
/** L6: all diffs of the section together. */
const REVIEW_SECTION_DIFF_BYTES = 8 * 1024;
const REVIEW_UTF8 = new TextEncoder();
const REVIEW_OLD_TEXT_KEYS: readonly string[] = ['oldText', 'old_string'];
const REVIEW_NEW_TEXT_KEYS: readonly string[] = ['newText', 'new_string', 'content', 'text'];

/** A bounded text with a field-specific cap (the contract's own `BoundedTextV1` shape). */
function boundedTo(text: string, cap: number): BoundedTextV1 {
  return text.length > cap ? { text: text.slice(0, cap), truncated: true } : { text, truncated: false };
}
function reviewArgText(args: Record<string, unknown> | undefined, keys: readonly string[]): string | null {
  if (args === undefined) return null;
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}
function reviewSummary(item: UnknownCallReviewItemV1): BoundedTextV1 {
  const summary = item.summary;
  const text = summary.command !== null && summary.command.length > 0 ? summary.command
    : summary.mode !== null && summary.paths.length > 0 ? `${summary.mode} ${summary.paths.join('、')}`
      : item.toolName;
  const boundedText = bounded(text);
  return summary.truncated ? { text: boundedText.text, truncated: true } : boundedText;
}
/** The human evidence text of an observation: a review-round string or a platform lookup outcome. */
function reviewEvidence(observed: UnknownCallObservationV1): string | null {
  if (!('evidence' in observed) || observed.evidence === undefined) return null;
  const evidence = observed.evidence;
  if (typeof evidence === 'string') return evidence;
  if (evidence.kind === 'receipt') return `平台回执：${evidence.eventIds.join('、')}`;
  if (evidence.kind === 'not_committed') return '平台没有提交记录';
  return `平台查找失败：${evidence.reason}`;
}
/** A `read_failed` reason has no `diffOmittedReason`; it degrades to a null reason, never a diff. */
function diffReasonOf(reason: ContinuationDiffOmittedReasonV1 | 'read_failed'): ContinuationDiffOmittedReasonV1 | null {
  return reason === 'read_failed' ? null : reason;
}
/** LCS-based line diff over a bounded window; a fallback replace when the inputs are too large to align. */
function diffOperations(before: readonly string[], after: readonly string[]): Array<{ kind: 'same' | 'del' | 'add'; line: string }> {
  if (before.length * after.length > 250_000) {
    return [...before.map((line) => ({ kind: 'del' as const, line })), ...after.map((line) => ({ kind: 'add' as const, line }))];
  }
  const rows = before.length + 1;
  const columns = after.length + 1;
  const table: Uint32Array[] = Array.from({ length: rows }, () => new Uint32Array(columns));
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i]![j] = before[i] === after[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const operations: Array<{ kind: 'same' | 'del' | 'add'; line: string }> = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) { operations.push({ kind: 'same', line: before[i]! }); i += 1; j += 1; }
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) { operations.push({ kind: 'del', line: before[i]! }); i += 1; }
    else { operations.push({ kind: 'add', line: after[j]! }); j += 1; }
  }
  while (i < before.length) { operations.push({ kind: 'del', line: before[i]! }); i += 1; }
  while (j < after.length) { operations.push({ kind: 'add', line: after[j]! }); j += 1; }
  return operations;
}
/** A unified diff (`--- a/…`, `+++ b/…`, one hunk); the caller bounds it further. */
function unifiedDiffText(path: string, oldText: string, newText: string): string {
  const before = oldText === '' ? [] : oldText.split('\n');
  const after = newText === '' ? [] : newText.split('\n');
  const operations = diffOperations(before, after);
  const startOld = before.length === 0 ? 0 : 1;
  const startNew = after.length === 0 ? 0 : 1;
  const header = `@@ -${String(startOld)},${String(before.length)} +${String(startNew)},${String(after.length)} @@`;
  const lines = [`--- a/${path}`, `+++ b/${path}`, header];
  for (const operation of operations) {
    lines.push(`${operation.kind === 'same' ? ' ' : operation.kind === 'del' ? '-' : '+'}${operation.line}`);
  }
  return lines.join('\n');
}

/**
 * K3 L6/§2: the pure `unknownCallReview` section. Per item it copies the alias,
 * callId, tool name, kind, bounded summary, the observed verdict/evidence/crash
 * suspicion and the D6 `reviewerConclusion`; for `file_edit` items it adds one
 * entry per `summary.paths`, classified against the capture's changed paths,
 * bounded Kernel-argument excerpts and the L6 unified diff with its caps. The
 * record's disposition is projected to the contract's alias form (L19/L20).
 */
export function assembleUnknownCallReviewSection(input: UnknownCallReviewSectionInput): ContinuationUnknownCallReviewV1 {
  const review = input.review;
  const capture = input.capture === undefined ? review.workspace : input.capture;
  const changed = capture !== null && capture.status === 'captured' ? capture.sample : [];
  const notVisible = capture !== null && capture.status === 'captured' ? capture.notVisible : [];
  // L6 (item 6a): the full Artifact changes, when the caller could read them.
  const fullChanges = input.captureChanges ?? null;
  const sampleTruncated = capture !== null && capture.status === 'captured' && capture.changedCount > capture.sample.length;
  const changeOf = (path: string): ContinuationUnknownCallReviewFileV1['change'] => {
    const source = fullChanges ?? changed;
    const hit = source.find((entry) => entry.path === path);
    if (hit !== undefined) return hit.change;
    if (notVisible.some((prefix) => path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`))) {
      return 'not_visible';
    }
    // The Artifact could not be read and the bounded sample cannot speak for
    // every changed path: saying "unchanged" would state an unknown fact.
    if (fullChanges === null && sampleTruncated) return 'unknown';
    return 'unchanged';
  };
  let sectionDiffBytes = 0;
  const items: ContinuationUnknownCallReviewItemV1[] = review.items.map((item) => {
    const observed = item.observed;
    const evidenceText = reviewEvidence(observed);
    const crashSuspicion = 'crashSuspicion' in observed && observed.crashSuspicion !== undefined ? observed.crashSuspicion : null;
    const reviewerConclusion = 'reviewerConclusion' in observed && observed.reviewerConclusion !== null
      && observed.reviewerConclusion !== undefined ? bounded(observed.reviewerConclusion.evidence) : null;
    const files: ContinuationUnknownCallReviewFileV1[] = item.kind !== 'file_edit' ? [] : item.summary.paths.map((path) => {
      const mode = item.summary.mode ?? 'replace';
      const args = input.callArguments?.get(item.callId);
      const oldRaw = reviewArgText(args, REVIEW_OLD_TEXT_KEYS);
      const newRaw = reviewArgText(args, REVIEW_NEW_TEXT_KEYS);
      const oldText = oldRaw === null ? null : boundedTo(oldRaw, REVIEW_EXCERPT_CHARS);
      const newText = newRaw === null ? null : boundedTo(newRaw, REVIEW_EXCERPT_CHARS);
      const read = input.files?.get(path);
      let diff: BoundedTextV1 | null = null;
      let diffOmittedReason: ContinuationUnknownCallReviewFileV1['diffOmittedReason'] = null;
      if (read === undefined) {
        diffOmittedReason = diffReasonOf(mode === 'create' ? 'baseline_dirty' : 'read_failed');
      } else if (read.baseline.status === 'unavailable') {
        diffOmittedReason = diffReasonOf(read.baseline.reason);
      } else if (read.current.status === 'unavailable') {
        diffOmittedReason = diffReasonOf(read.current.reason);
      } else {
        const text = unifiedDiffText(path, read.baseline.text, read.current.text);
        const bytes = REVIEW_UTF8.encode(text).length;
        if (sectionDiffBytes + bytes > REVIEW_SECTION_DIFF_BYTES) diffOmittedReason = 'section_limit';
        else { sectionDiffBytes += bytes; diff = boundedTo(text, REVIEW_DIFF_CHARS); }
      }
      return { path, mode, change: changeOf(path), oldText, newText, diff, diffOmittedReason };
    });
    return { alias: item.alias, callId: item.callId, toolName: item.toolName, kind: item.kind,
      summary: reviewSummary(item), verdict: observed.verdict,
      evidence: evidenceText === null ? null : bounded(evidenceText), crashSuspicion,
      reviewerConclusion, files };
  });
  const recordDisposition = review.disposition;
  const disposition: ContinuationUnknownCallReviewV1['disposition'] = recordDisposition === null ? null : (() => {
    const aliasOf = new Map(review.items.map(item => [item.callId, item.alias] as const));
    const proposalTargets = new Set(review.proposalTargets ?? []);
    const aliasesOf = (callIds: readonly string[]): number[] => callIds
      .map(callId => aliasOf.get(callId))
      .filter((alias): alias is number => alias !== undefined);
    return {
      choice: recordDisposition.choice,
      source: recordDisposition.source,
      text: recordDisposition.text === null ? null : bounded(recordDisposition.text),
      targets: aliasesOf(recordDisposition.targets),
      platformTargets: aliasesOf((review.dispositionTargets ?? []).filter(callId => !proposalTargets.has(callId))),
      approvedMethods: (recordDisposition.approvedMethods ?? []).map(method => ({
        alias: method.alias, command: method.command, cwd: method.cwd,
      })),
      // The ② owner already mapped each answer object to the card's canonical
      // form: the aggregate object became `null`, a file object its path.
      annotations: (recordDisposition.annotations ?? []).map(annotation => ({
        path: annotation.path, text: annotation.text,
      })),
    };
  })();
  return {
    reviewRef: { ...review.ref },
    revision: review.revision,
    origin: review.origin.kind,
    inventory: review.inventory,
    items,
    itemsOmitted: review.itemsOmitted,
    disposition,
    workspace: {
      status: capture === null ? review.workspace.status : capture.status,
      runBaselineKnown: capture === null ? review.workspace.runBaselineKnown : capture.runBaselineKnown,
      notVisible: capture !== null && capture.status === 'captured' ? [...capture.notVisible] : [],
      changedSample: changed.map((entry) => entry.path),
      changedOmitted: capture !== null && capture.status === 'captured'
        ? Math.max(0, capture.changedCount - capture.sample.length) : 0,
    },
    // K3 B3 item 6 / answer 5: present exactly when the record blocked a command.
    ...(review.blockedCommands.length === 0 ? {} : {
      blockedCommands: review.blockedCommands.map(entry => ({
        alias: entry.alias, reviewRunId: entry.reviewRunId, commandSha256: entry.commandSha256,
      })),
    }),
  };
}

const PAGE_LIMIT = 200;
/**
 * The accepted steers and messages the brief lists one by one; the rest are
 * counted in `steersOmitted` / `messagesOmitted`. The contract names no count
 * for them, so they share the new-input bound.
 */
const ACCEPTED_INPUTS_LISTED = CONTINUATION_BRIEF_LIMITS.newInputs;

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A complete SessionMessage ref as the mailbox input supply writes it into `sourceRef`, or null. */
function messageRefOf(value: unknown): SessionMessageRef | null {
  if (!isRecordValue(value) || value['aggregateType'] !== 'SessionMessage') return null;
  const { projectId, workspaceId, messageId } = value;
  if (typeof projectId !== 'string' || typeof workspaceId !== 'string' || typeof messageId !== 'string'
    || projectId.length === 0 || workspaceId.length === 0 || messageId.length === 0) return null;
  return { aggregateType: 'SessionMessage', projectId, workspaceId, messageId };
}

/**
 * The session message parts the fixed Turn accepted: its own `run.input_accepted`
 * events whose source is a SessionMessage part (`execution-inputs.ts`). A
 * steer or another source is not a message; the steers come from the Run's
 * control intents.
 */
export function acceptedMessagesOf(records: readonly DecodedKernelRecord[], kernel: { runId: string; turnId: string }): AcceptedMessageInput[] {
  const accepted: AcceptedMessageInput[] = [];
  for (const item of records) {
    if (item.record.recordType !== 'agent.event') continue;
    const event = item.record.payload.event;
    if (event.type !== 'run.input_accepted' || event.meta.runId !== kernel.runId || event.meta.turnId !== kernel.turnId) continue;
    const source = event.payload.input.sourceRef;
    if (!isRecordValue(source) || source['kind'] !== 'SessionMessage') continue;
    const messageRef = messageRefOf(source['messageRef']);
    const part = source['part'];
    if (messageRef === null || (part !== 'message' && part !== 'response')) continue;
    accepted.push({ messageRef, part, text: event.payload.input.text });
  }
  return accepted;
}

/**
 * A read that may succeed later (W-25, SD-2): a cancelled read or an
 * unavailable Kernel store (busy, not registered by this Host) is not a fact
 * about the Turn, so the caller does not pin a degraded brief and retries.
 */
export type PreviousTurnRetry = { kernel: 'retry'; code: 'cancelled' | 'unavailable'; reason: string };

/**
 * Reads the Kernel records of one Run's Turn (its execution-history locator,
 * at most `CONTINUATION_BRIEF_LIMITS.kernelRecords`) through the Session's own
 * Kernel mapping and reduces them from `turn.started`. A Run that never
 * entered has no Turn; a missing, damaged or non-contiguous history is the
 * `unavailable` fact; a cancelled read or an unavailable store is `retry`.
 */
/**
 * L9 (D1): a same-Session continuation locates the previous Turn by its exact
 * Kernel identity through the injected `readTurnBounds` (resolved at call time,
 * M2), not by scanning the Session from its start.
 */
export type PreviousTurnReadOptions = { sameSession?: boolean };

type RunHistoryLocator = NonNullable<TaskExecutionRecord['run']['executionHistory']>;
type KernelBinding = RunHistoryLocator['kernel'];

type WindowRead =
  | { ok: true; decoded: DecodedKernelRecord[]; frozenThrough: number }
  | { ok: false; retry: PreviousTurnRetry }
  | { ok: false; reason: string };

/** One bounded page loop over `afterPosition` through `throughPosition` (null freezes the real tail). */
async function readBoundedWindow(
  owner: SessionHistoryCursorOwner, record: TaskExecutionRecord,
  afterPosition: number, throughPosition: number | null, signal: AbortSignal,
): Promise<WindowRead> {
  const decoded: DecodedKernelRecord[] = [];
  let frozenThrough: number | null = throughPosition;
  let cursor = afterPosition;
  let expected = afterPosition + 1;
  while (decoded.length < CONTINUATION_BRIEF_LIMITS.kernelRecords) {
    let window;
    try {
      window = await owner.readPositionWindow({ session: record.session, afterPosition: cursor, throughPosition: frozenThrough,
        limit: Math.min(PAGE_LIMIT, CONTINUATION_BRIEF_LIMITS.kernelRecords - decoded.length), signal });
    } catch (error) {
      if (signal.aborted) return { ok: false, retry: { kernel: 'retry', code: 'cancelled', reason: 'the Turn history read was cancelled' } };
      return { ok: false, retry: { kernel: 'retry', code: 'unavailable',
        reason: `the Turn history read failed: ${error instanceof Error ? error.message : String(error)}` } };
    }
    // A page that resolves after the caller cancelled is cancellation, never a
    // partial Turn read.
    if (signal.aborted) return { ok: false, retry: { kernel: 'retry', code: 'cancelled', reason: 'the Turn history read was cancelled' } };
    if (window.status !== 'ready') {
      const reason = window.status === 'rejected' ? window.reason : `the Turn history is ${window.status}`;
      if (window.status === 'rejected' && (window.code === 'cancelled' || window.code === 'unavailable')) {
        return { ok: false, retry: { kernel: 'retry', code: window.code, reason } };
      }
      return { ok: false, reason };
    }
    frozenThrough = window.value.throughPosition;
    for (const entry of window.value.entries) {
      const item = decodeKernelEntry(entry);
      if (item === null || item.position !== expected) return { ok: false, reason: 'the Turn history is damaged or not contiguous' };
      expected += 1;
      decoded.push(item);
    }
    cursor = window.value.nextPosition;
    if (!window.value.hasMore) break;
  }
  return { ok: true, decoded, frozenThrough: frozenThrough ?? afterPosition };
}

/**
 * L9 (D1): the exact `[turn.started, run.interrupted]` window the Kernel's
 * `readTurnBounds` located. A window past the record limit, a damaged window or
 * a reduction that disagrees with the recorded closure is `unavailable`, never
 * `not_entered`/`running`/`paused`.
 */
async function readInterruptedTurnWindow(
  owner: SessionHistoryCursorOwner, record: TaskExecutionRecord, kernel: KernelBinding,
  startPosition: number, endPosition: number, signal: AbortSignal,
): Promise<PreviousTurnFacts | PreviousTurnRetry> {
  if (endPosition - startPosition + 1 > CONTINUATION_BRIEF_LIMITS.kernelRecords) {
    return { kernel: 'unavailable', reason: 'the interrupted Turn window exceeds the recorded brief limit' };
  }
  const read = await readBoundedWindow(owner, record, startPosition - 1, endPosition, signal);
  if (!read.ok) return 'retry' in read ? read.retry : { kernel: 'unavailable', reason: read.reason };
  const state = reduceTurnFromStart(read.decoded, kernel);
  if (state === null) return { kernel: 'unavailable', reason: 'the Turn start record is not in the history window' };
  if (state.status !== 'interrupted') {
    return { kernel: 'unavailable', reason: 'the Kernel Turn does not match its recorded interrupted closure' };
  }
  const last = read.decoded.at(-1)?.position ?? startPosition;
  return { kernel: 'read', state, window: { fromPosition: startPosition, throughPosition: last, omittedRecords: 0 },
    acceptedMessages: acceptedMessagesOf(read.decoded, kernel) };
}

/**
 * The platform-window read kept for every non-D1 case (L9 "其它情况"): a
 * recorded Kernel terminal, an open/paused Turn, or a locator-less attested Run
 * whose exact identity located its Turn. The reduced state and the accepted
 * messages always come from the same selected records.
 */
async function readPlatformTurnWindow(
  owner: SessionHistoryCursorOwner, record: TaskExecutionRecord, kernel: KernelBinding,
  locator: RunHistoryLocator | undefined, enteredStart: number | undefined, signal: AbortSignal,
): Promise<PreviousTurnFacts | PreviousTurnRetry> {
  const fromPosition = locator !== undefined ? Math.max(0, locator.startPosition - 1) : Math.max(0, (enteredStart ?? 1) - 1);
  const recordedEnd = locator?.endPosition ?? null;
  // L9 (D11): the ordinary platform-window read is always bounded by
  // `endPosition ?? observedThroughPosition` (`observedThroughPosition` is a number
  // whenever a locator exists). Only the identity-derived same-Session path
  // (`locator === undefined`, entered through `readTurnBounds`) may read to the
  // Session tail so the interrupted closure can be located there.
  const recordedThrough = recordedEnd ?? locator?.observedThroughPosition ?? null;
  const readToTail = locator === undefined;
  const read = await readBoundedWindow(owner, record, fromPosition, readToTail ? null : recordedThrough, signal);
  if (!read.ok) return 'retry' in read ? read.retry : { kernel: 'unavailable', reason: read.reason };
  const decoded = read.decoded;
  let state = reduceTurnFromStart(decoded, kernel);
  if (state === null) {
    // A genuinely never-entered Run (no locator and no located identity) keeps
    // the old "not entered"; a located Run is damaged.
    if (locator === undefined && enteredStart === undefined) return { kernel: 'not_entered' };
    return { kernel: 'unavailable', reason: 'the Turn start record is not in the history window' };
  }
  let selected = decoded;
  let effectiveThrough = read.frozenThrough;
  let last = decoded.at(-1)?.position ?? fromPosition;
  if (state.status === 'interrupted') {
    // L9: from `turn.started` to `run.interrupted`; never past the close event.
    const terminal = terminalPositionOf(decoded, kernel);
    if (terminal !== null) {
      selected = decoded.filter((item) => item.position <= terminal);
      effectiveThrough = terminal;
      last = terminal;
    }
  } else if (locator === undefined && enteredStart === undefined) {
    return { kernel: 'not_entered' };
  } else if (recordedEnd === null && locator !== undefined) {
    // The old bounded window for a paused/running Turn that has no Kernel end.
    const through = locator.observedThroughPosition;
    const bounded = decoded.filter((item) => item.position <= through);
    const boundedState = reduceTurnFromStart(bounded, kernel);
    if (boundedState === null) return { kernel: 'unavailable', reason: 'the Turn start record is not in the history window' };
    state = boundedState;
    selected = bounded;
    effectiveThrough = through;
    last = bounded.at(-1)?.position ?? fromPosition;
  }
  return { kernel: 'read', state, window: { fromPosition: fromPosition + 1, throughPosition: Math.max(fromPosition + 1, last),
    omittedRecords: Math.max(0, effectiveThrough - last) }, acceptedMessages: acceptedMessagesOf(selected, kernel) };
}

export async function readPreviousTurn(
  owner: SessionHistoryCursorOwner, record: TaskExecutionRecord, signal: AbortSignal,
  options: PreviousTurnReadOptions = {},
): Promise<PreviousTurnFacts | PreviousTurnRetry> {
  const locator = record.run.executionHistory;
  // L9: only an attested Run may have entered the Kernel without any execution
  // history locator. Every other locator-less Run keeps the old "not entered".
  const attested = record.run.reconciliation?.observation?.kind === 'human_attested';
  if (locator === undefined && !attested) return { kernel: 'not_entered' };
  const kernel = locator?.kernel ?? kernelBindingOf(record.run);
  if (kernel === null) return { kernel: 'not_entered' };
  if (kernel.adapterId !== record.session.kernel.adapterId
    || kernel.kernelSessionId !== record.session.kernel.kernelSessionId) {
    return { kernel: 'unavailable', reason: 'the Run history locator disagrees with its claim Session mapping' };
  }
  // L9 (D1/D2/D8): only a Run that can still be an interrupted Turn is looked
  // up by its exact Kernel identity through the injected `readTurnBounds` (M2).
  // A previous Run whose platform position record already holds an `endPosition`
  // completed normally and cannot be an interrupted Turn, so it keeps today's
  // platform-window read (`readPositionWindow`) and never consults the identity
  // seam. The seam is needed only when the previous Run has no `endPosition`
  // (the interrupted or unknown case).
  const hasRecordedEnd = locator !== undefined && locator.endPosition !== null;
  if (options.sameSession === true && !hasRecordedEnd) {
    if (signal.aborted) return { kernel: 'retry', code: 'cancelled', reason: 'the Turn bounds read was cancelled' };
    let bounds;
    try {
      bounds = await owner.readTurnBounds({ session: record.session, kernelRunId: kernel.runId, signal });
    } catch (error) {
      // Only the signal turns this port's throw into cancellation; a throw with
      // the signal clear keeps today's propagation.
      if (signal.aborted) return { kernel: 'retry', code: 'cancelled', reason: 'the Turn bounds read was cancelled' };
      throw error;
    }
    // `readTurnBounds` has no cancelled result of its own: judge it by the
    // signal, never by a fabricated dependency result.
    if (signal.aborted) return { kernel: 'retry', code: 'cancelled', reason: 'the Turn bounds read was cancelled' };
    if (bounds.status === 'unsupported' || bounds.status === 'unreadable') {
      return { kernel: 'retry', code: 'unavailable', reason: bounds.reason };
    }
    if (bounds.status === 'not_found') {
      return locator === undefined ? { kernel: 'not_entered' }
        : { kernel: 'unavailable', reason: 'the Turn start record is not in the Kernel history' };
    }
    if (bounds.terminalStatus === 'interrupted' && bounds.endPosition !== null) {
      return readInterruptedTurnWindow(owner, record, kernel, bounds.startPosition, bounds.endPosition, signal);
    }
    return readPlatformTurnWindow(owner, record, kernel, locator, bounds.startPosition, signal);
  }
  return readPlatformTurnWindow(owner, record, kernel, locator, undefined, signal);
}

/** The begin authorization's fixed Kernel identity, or null for an unknown Run. */
function kernelBindingOf(run: TaskExecutionRecord['run']): NonNullable<TaskExecutionRecord['run']['executionHistory']>['kernel'] | null {
  const auth = run.executionAuthorization;
  return auth !== undefined ? auth.kernel : null;
}

/** The Kernel event types that end a Turn; `run.interrupted` is one (L1/L9). */
const TERMINAL_KERNEL_EVENT_TYPES: ReadonlySet<string> = new Set([
  'run.completed', 'run.failed', 'run.cancelled', 'run.limit_exceeded', 'run.yielded', 'run.interrupted',
]);

/** The fixed Turn's own last terminal `agent.event` position, or null. */
function terminalPositionOf(
  records: readonly DecodedKernelRecord[], kernel: NonNullable<TaskExecutionRecord['run']['executionHistory']>['kernel'],
): number | null {
  let position: number | null = null;
  for (const item of records) {
    if (item.record.recordType !== 'agent.event') continue;
    const event = item.record.payload.event;
    if (event.meta.runId !== kernel.runId || event.meta.turnId !== kernel.turnId) continue;
    if (!TERMINAL_KERNEL_EVENT_TYPES.has(event.type)) continue;
    position = item.position;
  }
  return position;
}

function bounded(text: string): BoundedTextV1 {
  const cap = CONTINUATION_BRIEF_LIMITS.textChars;
  return text.length > cap ? { text: text.slice(0, cap), truncated: true } : { text, truncated: false };
}

/** The Kernel-recorded tool arguments by callId, for the review section's L6 excerpts. */
function callArgumentsOf(turn: PreviousTurnFacts): ReadonlyMap<string, Record<string, unknown>> {
  const argumentsByCallId = new Map<string, Record<string, unknown>>();
  if (turn.kernel !== 'read') return argumentsByCallId;
  for (const entry of turn.state.transcript) {
    if (entry.kind !== 'assistant_message') continue;
    for (const call of entry.toolCalls) argumentsByCallId.set(call.callId, call.arguments as Record<string, unknown>);
  }
  return argumentsByCallId;
}

/** A body the basis reader already bounded: cut there, it stays marked cut (contract (e) "…Omitted / truncated"). */
function boundedBody(entry: { body: string | null; truncated: boolean } | undefined): BoundedTextV1 | null {
  if (entry === undefined || entry.body === null) return null;
  const text = bounded(entry.body);
  return entry.truncated ? { text: text.text, truncated: true } : text;
}

/** A tool call's target: its path, file or command argument, when it has one. */
function targetOf(args: Record<string, unknown>): BoundedTextV1 | null {
  for (const key of ['path', 'file', 'filePath', 'command']) {
    const value = args[key];
    if (typeof value === 'string' && value.length > 0) return bounded(value);
  }
  return null;
}

type ToolFacts = { calls: ContinuationBriefV1['toolCalls']; confirmedPaths: string[]; possiblePaths: string[]; unknownCount: number;
  /** Edit-type calls with no recorded result (K7): never confirmed. */
  unobserved: number };

/** The Kernel file-mutating tools whose requested path can be read from the call arguments. */
const EDIT_TOOL_NAMES = new Set<string>(['edit', 'write']);

/** The workspace-relative path argument of an edit-type call, or null. */
function editPathArgumentOf(args: Record<string, unknown>): string | null {
  for (const key of ['path', 'file', 'filePath']) {
    const value = args[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

/**
 * The changed-file split shared by the brief's `workspace.selfChanged` and the
 * archive anchor's `changedFiles` (§2.6, K7): a recorded result contributes its
 * Kernel `effects` (confirmed/possible); an edit-type call with no recorded
 * result contributes its requested path as `possible` only, never `confirmed`.
 */
export function selfChangedFactsOf(state: RunState): {
  confirmed: string[]; possible: string[]; unobserved: number; unknownCount: number;
} {
  const tools = toolFactsOf(state);
  return { confirmed: tools.confirmedPaths, possible: tools.possiblePaths, unobserved: tools.unobserved,
    unknownCount: tools.unknownCount };
}

/**
 * The Turn's tool calls in three groups (C3): a call with a recorded result is
 * confirmed (an `outcome_unknown` error is unknown); a batch call still
 * `pending` or `abandoned` never ran; `running`/`outcome_unknown` is unknown.
 */
function toolFactsOf(state: RunState): ToolFacts {
  const requested = new Map<string, { name: string; args: Record<string, unknown> }>();
  for (const entry of state.transcript) {
    if (entry.kind !== 'assistant_message') continue;
    for (const call of entry.toolCalls) requested.set(call.callId, { name: call.name, args: call.arguments as Record<string, unknown> });
  }
  const confirmed: ContinuationToolCallV1[] = [];
  const unknown: ContinuationToolCallV1[] = [];
  const notExecuted: ContinuationToolCallV1[] = [];
  const confirmedPaths: string[] = [];
  const possiblePaths: string[] = [];
  const seen = new Set<string>();
  const callOf = (callId: string, result: ContinuationToolCallV1['result'], sideEffect: ContinuationToolCallV1['sideEffect'],
    paths: readonly string[], error: string | null): ContinuationToolCallV1 => {
    const call = requested.get(callId);
    return { callId, name: call?.name ?? 'unknown', target: call === undefined ? null : targetOf(call.args), result, sideEffect,
      changedPaths: paths.slice(0, CONTINUATION_BRIEF_LIMITS.pathsPerCall),
      changedPathsOmitted: Math.max(0, paths.length - CONTINUATION_BRIEF_LIMITS.pathsPerCall),
      error: error === null ? null : bounded(error) };
  };
  for (const entry of state.transcript) {
    if (entry.kind !== 'tool_result') continue;
    seen.add(entry.callId);
    const result = entry.result;
    switch (result.status) {
      case 'success':
      case 'cancelled': {
        const paths = [...result.effects.changedPaths];
        (result.effects.sideEffect === 'confirmed' ? confirmedPaths : result.effects.sideEffect === 'possible' ? possiblePaths : [])
          .push(...paths);
        confirmed.push(callOf(entry.callId, result.status, result.effects.sideEffect, paths, null));
        break;
      }
      case 'error': {
        const paths = [...result.effects.changedPaths];
        if (result.error.code === 'outcome_unknown') {
          possiblePaths.push(...paths);
          unknown.push(callOf(entry.callId, 'outcome_unknown', result.effects.sideEffect, paths, result.error.message));
        } else {
          (result.effects.sideEffect === 'confirmed' ? confirmedPaths : result.effects.sideEffect === 'possible' ? possiblePaths : [])
            .push(...paths);
          confirmed.push(callOf(entry.callId, 'error', result.effects.sideEffect, paths, result.error.message));
        }
        break;
      }
      default: break;
    }
  }
  for (const call of state.toolBatch?.calls ?? []) {
    const callId = call.requestedCall.callId;
    if (seen.has(callId)) continue;
    if (!requested.has(callId)) requested.set(callId, { name: call.requestedCall.name, args: call.requestedCall.arguments as Record<string, unknown> });
    if (call.status === 'pending' || call.status === 'abandoned') notExecuted.push(callOf(callId, 'not_started', null, [], null));
    else if (call.status === 'running' || call.status === 'outcome_unknown') unknown.push(callOf(callId, 'outcome_unknown', 'possible', [], null));
  }
  // K7: an edit-type call with no recorded result is never a confirmed change;
  // its requested path stays "possible" (and makes the window partial).
  let unobserved = 0;
  for (const [callId, call] of requested) {
    if (seen.has(callId) || !EDIT_TOOL_NAMES.has(call.name)) continue;
    unobserved += 1;
    const path = editPathArgumentOf(call.args);
    if (path !== null) possiblePaths.push(path);
  }
  const cut = (list: ContinuationToolCallV1[], cap: number) => ({ listed: list.slice(0, cap), omitted: Math.max(0, list.length - cap) });
  const c = cut(confirmed, CONTINUATION_BRIEF_LIMITS.confirmedToolCalls);
  const n = cut(notExecuted, CONTINUATION_BRIEF_LIMITS.notExecutedToolCalls);
  const u = cut(unknown, CONTINUATION_BRIEF_LIMITS.unknownToolCalls);
  return { calls: { confirmed: c.listed, notExecuted: n.listed, unknown: u.listed, confirmedOmitted: c.omitted,
    notExecutedOmitted: n.omitted, unknownOmitted: u.omitted },
    confirmedPaths: [...new Set(confirmedPaths)], possiblePaths: [...new Set(possiblePaths)], unknownCount: unknown.length,
    unobserved };
}

const TURN_STATUSES = ['completed', 'failed', 'cancelled', 'limit_exceeded', 'yielded', 'paused', 'running', 'interrupted'] as const;

function stoppedAtOf(turn: PreviousTurnFacts, reason: string | null): ContinuationBriefV1['stoppedAt'] {
  if (turn.kernel !== 'read') {
    return { kernel: turn.kernel, reason: turn.kernel === 'unavailable' ? turn.reason : reason, turnStatus: null, lastPosition: null,
      lastToolGroup: null, lastAssistant: null, window: null };
  }
  const state = turn.state;
  const status = (TURN_STATUSES as readonly string[]).includes(state.status) ? state.status as typeof TURN_STATUSES[number] : 'running';
  let lastAssistant: BoundedTextV1 | null = null;
  let lastToolGroup: ContinuationBriefV1['stoppedAt']['lastToolGroup'] = null;
  for (const entry of state.transcript) {
    if (entry.kind !== 'assistant_message') continue;
    if (entry.message.content.length > 0) lastAssistant = bounded(entry.message.content);
    if (entry.toolCalls.length > 0) lastToolGroup = { sourceMessageId: entry.message.messageId, calls: entry.toolCalls.length };
  }
  if (state.toolBatch !== null) lastToolGroup = { sourceMessageId: state.toolBatch.sourceMessageId, calls: state.toolBatch.calls.length };
  // Rule 3 / L9: the interrupted Turn's raw process never reaches the model
  // input. Its accepted inputs and tool facts are listed, but the last assistant
  // text is transcript and is suppressed.
  if (state.status === 'interrupted') lastAssistant = null;
  return { kernel: 'read', reason, turnStatus: status, lastPosition: turn.window.throughPosition, lastToolGroup, lastAssistant,
    window: turn.window };
}

/** The Kernel `run.failed` text of a reduced Turn (the third source of `runErrorOf`). */
function kernelFailedText(turn: PreviousTurnFacts): string | null {
  if (turn.kernel !== 'read') return null;
  const outcome = turn.state.outcome;
  return outcome !== null && outcome.kind === 'failed' ? `${outcome.failure.code}: ${outcome.failure.message}` : null;
}

/** The synthesized terminal reason RUN-23 leaves in the payload (rendered differently from an observed cancel). */
function stopReasonOf(record: TaskExecutionRecord): string | null {
  const payload = record.run.terminalPayload;
  return payload !== undefined && payload.kind === 'cancelled' ? payload.reason : null;
}

/**
 * The brief (spec §6.1 contract (e)) from the basis and the facts read beside
 * it. Pure; every list and text is bounded by `CONTINUATION_BRIEF_LIMITS`.
 */
export function assembleContinuationBrief(input: AssembleBriefInput): ContinuationBriefV1 {
  const { basis, turn } = input;
  const requeue = basis.requeue;
  const previous = basis.previous;
  const head = basis.round;
  // Contract (e) `factsFrom`: an afterRun that never entered the Kernel has no round of its own; the failed checks
  // listed are the facts Run's, the round its own TaskRequeue covered (§15.2 C3-not-entered-chain "来自更早的 Run").
  const factsHop = head === null ? basis.factsChain.at(-1) ?? null : null;
  const checksRound = head ?? factsHop?.round ?? null;
  // LA-10: the Run the workspace section speaks of (its checks, `selfChanged`, its end): the facts Run when the afterRun
  // never entered.
  const checkedRun = factsHop === null ? previous.run : factsHop.run.run;
  // TD-8: the class is re-derived from the facts the requeue covered (the stored one is the audit copy).
  const derivation = deriveReworkClass(previous.run, basis.previousIntents.pointer,
    head === null ? { kind: 'none' } : { kind: 'head', head, chain: [head] });
  const failureClass: ReworkFailureClass = derivation.kind === 'class' ? derivation.failureClass : requeue.failureClass;
  const actorClass = reworkActorClassOf(null, requeue.requestedBy) ?? 'human';
  // The reader returns them in Run-chain order (oldest first), as `TaskRow.rework.entries`.
  const ordered = basis.allRequeues;
  const position = ordered.findIndex((candidate) => candidate.ref.afterRunId === requeue.ref.afterRunId);
  const earlier = (position < 0 ? ordered : ordered.slice(0, position)).filter((candidate) => candidate.ref.afterRunId !== requeue.ref.afterRunId);
  const outcome = requeue.afterOutcome;
  const observation = previous.run.reconciliation?.observation;
  const error = runErrorOf(previous.run, kernelFailedText(turn));
  const limitOutcome = turn.kernel === 'read' && turn.state.outcome !== null && turn.state.outcome.kind === 'limit_exceeded'
    ? turn.state.outcome : null;
  const sameSession = input.claimSessionRef.sessionId === previous.outbox.claim.sessionRef.sessionId;
  const previousEnd = previous.run.executionHistory?.endPosition ?? null;
  // A seeded claim Session (it has no completed history of its own) continues the ORIGINAL Session's history,
  // also when it is the never-entered afterRun's Session (A8-3r).
  const seededFrom = input.seededFrom ?? null;
  const continuity: ContinuationBriefV1['session']['continuity'] = seededFrom !== null ? 'other_session_seeded'
    : sameSession ? previousEnd !== null ? 'same_session_history' : 'same_session_without_previous_turn'
      : 'other_session';
  const tools = turn.kernel === 'read' ? toolFactsOf(turn.state) : null;
  // K3 L20: the previous/afterRun's review section, rendered only when a record was read.
  const unknownCallReview = input.unknownCallReview === undefined || input.unknownCallReview === null ? null
    : assembleUnknownCallReviewSection({
      review: input.unknownCallReview,
      callArguments: callArgumentsOf(turn),
      ...(input.unknownCallReviewFiles === undefined ? {} : { files: input.unknownCallReviewFiles }),
      ...(input.unknownCallReviewCapture === undefined ? {} : { capture: input.unknownCallReviewCapture }),
      ...(input.unknownCallReviewCaptureChanges === undefined ? {} : { captureChanges: input.unknownCallReviewCaptureChanges }),
    });
  const steersApplied = basis.previousIntents.steers.filter((steer) => steer.kind === 'steer' && steer.status === 'applied');
  const steersOpen = basis.previousIntents.steers.filter((steer) => steer.kind === 'steer' && steer.status !== 'applied');
  // Contract (e): the accepted steers and messages are listed unless the new Run's history already holds them.
  const acceptedSteers = continuity === 'same_session_history' ? [] : steersApplied;
  const acceptedMessages = continuity === 'same_session_history' || turn.kernel !== 'read' ? [] : turn.acceptedMessages;
  const newInputs: ContinuationNewInputV1[] = requeue.newInputRefs.slice(0, CONTINUATION_BRIEF_LIMITS.newInputs).map((ref) => {
    if (ref.kind === 'artifact') {
      return { kind: 'artifact', ref: ref.ref,
        body: boundedBody(basis.newInputBodies.find((entry) => entry.ref.digest === ref.ref.digest)) };
    }
    return { kind: 'session_message', ref: ref.ref,
      replyBody: boundedBody(basis.replyBodies.find((entry) => entry.messageRef.messageId === ref.ref.messageId)) };
  });
  const checkpoints: ContinuationSourceCheckpointV1[] = [];
  if (checksRound !== null) {
    // LA-10: the workspace timeline starts at the round the listed checks come from (the facts Run's when the afterRun
    // never entered). The round record keeps no instant; its capture is after the end of the Run it checked.
    checkpoints.push({ kind: 'round_open', at: checkedRun.endedAt ?? requeue.requestedAt,
      workspaceRevision: checksRound.identity.workspaceRevision, sourceDigest: checksRound.identity.sourceDigest,
      unavailableReason: null });
  }
  checkpoints.push({ kind: 'requeue', at: requeue.requestedAt, workspaceRevision: requeue.basis.source.workspaceRevision,
    sourceDigest: requeue.basis.source.sourceDigest, unavailableReason: null });
  checkpoints.push(input.workspace.briefCheckpoint);
  const segments = checkpoints.slice(1).map((checkpoint, index) => {
    const compared = compareSourceCheckpoints(checkpoints[index] ?? null, checkpoint);
    return { from: index, to: index + 1, verdict: compared.verdict, reason: compared.reason };
  });
  const selfChanged: ContinuationBriefV1['workspace']['selfChanged'] = turn.kernel === 'not_entered'
    ? { status: 'not_entered', confirmed: [], possible: [], omitted: 0 }
    : turn.kernel === 'unavailable' || tools === null
      ? { status: 'unavailable', confirmed: [], possible: [], omitted: 0 }
      : (() => {
        const confirmed = tools.confirmedPaths.slice(0, CONTINUATION_BRIEF_LIMITS.paths);
        const possible = tools.possiblePaths.filter((path) => !confirmed.includes(path))
          .slice(0, CONTINUATION_BRIEF_LIMITS.paths - confirmed.length);
        const omitted = tools.confirmedPaths.length + tools.possiblePaths.length - confirmed.length - possible.length;
        return { status: tools.unknownCount > 0 || tools.unobserved > 0 || turn.window.omittedRecords > 0 ? 'partial' as const : 'known' as const,
          confirmed, possible, omitted: Math.max(0, omitted) };
      })();
  return {
    schemaVersion: 1,
    runRef: { ...basis.run.ref },
    task: { ...requeue.task },
    requeueRef: { ...requeue.ref },
    mode: failureClass === 'interrupted' ? 'resume_after_interruption' : 'rework',
    failureClass,
    trigger: {
      actorClass,
      goalResume: requeue.trigger !== undefined,
      requeueNumber: position < 0 ? ordered.length + 1 : position + 1,
      autoRework: requeue.automation.automatic && requeue.automation.cap !== null
        ? { count: requeue.automation.autoCount, cap: requeue.automation.cap } : null,
      earlierRequeues: earlier.slice(-CONTINUATION_BRIEF_LIMITS.earlierRequeues)
        .map((candidate) => ({ afterRunId: candidate.ref.afterRunId, failureClass: candidate.failureClass })),
    },
    previous: {
      runRef: { ...previous.run.ref },
      attemptRef: { ...previous.attempt.ref },
      sessionRef: { projectId: previous.outbox.claim.sessionRef.projectId, sessionId: previous.outbox.claim.sessionRef.sessionId },
      outcome,
      origin: runFailureOrigin(previous.run),
      interruption: failureClass === 'interrupted' && observation !== undefined && observation.kind === 'interrupted_clean'
        ? { kind: requeue.interruption ?? 'executing', kernelPaused: observation.kernelPaused,
          pausedBy: requeue.interruption === 'paused' ? requeue.stopRequester : null }
        : null,
      cancelledBy: failureClass === 'cancelled' && requeue.stopRequester !== 'none' ? requeue.stopRequester : null,
      error: error.error === null ? null : bounded(error.error),
      limit: limitOutcome === null ? null : { kind: limitOutcome.limit, observed: limitOutcome.observed, allowed: limitOutcome.allowed },
      budget: outcome === 'budget_exhausted'
        ? { previousTokenBudget: previous.run.budget.tokenBudget, currentTokenBudget: basis.run.budget.tokenBudget } : null,
      wait: basis.previousWait === null ? null : { messageRef: { ...basis.previousWait.ref }, status: basis.previousWait.status },
      unacceptedSteers: steersOpen.map((steer) => ({ intentRef: { ...steer.ref }, text: bounded(steer.reason ?? '') })),
      endedAt: previous.run.endedAt,
    },
    factsFrom: { runRef: { ...input.factsRecord.run.ref }, hops: input.factsHops, truncated: input.factsTruncated },
    stoppedAt: stoppedAtOf(turn, stopReasonOf(input.factsRecord)),
    toolCalls: tools === null
      ? { confirmed: [], notExecuted: [], unknown: [], confirmedOmitted: 0, notExecutedOmitted: 0, unknownOmitted: 0 }
      : tools.calls,
    acceptedInputs: {
      steers: acceptedSteers.slice(0, ACCEPTED_INPUTS_LISTED)
        .map((steer) => ({ intentRef: { ...steer.ref }, text: bounded(steer.reason ?? '') })),
      steersOmitted: Math.max(0, acceptedSteers.length - ACCEPTED_INPUTS_LISTED),
      messages: acceptedMessages.slice(0, ACCEPTED_INPUTS_LISTED)
        .map((message) => ({ messageRef: { ...message.messageRef }, part: message.part, excerpt: bounded(message.text) })),
      messagesOmitted: Math.max(0, acceptedMessages.length - ACCEPTED_INPUTS_LISTED),
    },
    checks: checksRound === null ? null : { roundRef: { ...checksRound.ref }, roundOrdinal: checksRound.chain?.ordinal ?? 1,
      failing: roundFailureFacts(checksRound).checks, gapCodes: roundFailureFacts(checksRound).gapCodes },
    requeue: { reason: bounded(requeue.reason), reasonAuthor: actorClass, newInputs },
    workspace: {
      selfChanged,
      checkpoints,
      segments,
      // LA-10: the unobserved window starts at the end of that same Run, so it never runs backwards from round_open.
      unobserved: { from: 'previous_run_end', to: checkpoints.length > 0 ? 0 : null, previousEndedAt: checkedRun.endedAt },
      uncommitted: input.workspace.uncommitted,
    },
    session: {
      continuity,
      sessionRef: { projectId: input.claimSessionRef.projectId, sessionId: input.claimSessionRef.sessionId },
      seededFrom: seededFrom === null ? null : { sessionRef: { projectId: seededFrom.sessionRef.projectId,
        sessionId: seededFrom.sessionRef.sessionId }, throughPosition: seededFrom.throughPosition },
      boundaryPosition: continuity === 'same_session_history' ? previousEnd : null,
    },
    standingInstructionVersion: 1,
    // Slice 1 §2.7: absent (never null) without a section, so an old brief's
    // bytes and digest stay unchanged.
    ...(input.anomalies === undefined || input.anomalies === null ? {} : { anomalies: input.anomalies }),
    // K3 L20: absent (never null) without a record, same reason.
    ...(unknownCallReview === null ? {} : { unknownCallReview }),
    // K3 B3 item 7: the Task's blocked-command lines, absent when empty.
    ...(input.blockedCommands === undefined || input.blockedCommands === null || input.blockedCommands.length === 0
      ? {} : { blockedCommands: input.blockedCommands.map(entry => ({
        alias: entry.alias, reviewRunId: entry.reviewRunId, requestState: entry.requestState,
        declaredForms: [...entry.declaredForms],
      })) }),
  };
}
