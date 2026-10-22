/**
 * C3 continuation brief (spec §6.1 contract (e); §4 C1/C3; GAP-49).
 *
 * A requeued Run carries one bounded, pure-data brief inside its
 * content-addressed task manifest (`PreparedTaskManifestV1.continuationBrief`);
 * the Run's immutable `inputBinding.continuationBriefDigest` pins it. The shape,
 * its digest and marker, the shape validator, the source-checkpoint comparison
 * and the Chinese renderer are shared here so the AgentRuntime assembly, the
 * WorkGraph read model and the RUN-02 guard agree. No writer produces a brief
 * before §15 sub-step 5.4.
 */
import type { ArtifactRef } from './artifact.js';
import type { SessionRef } from './core/identity.js';
import type { SessionMessageRef } from './core/session-message.js';
import type { SessionAnomalyAnchorV1 } from './session-anomaly.js';
import type { ControlIntentRef } from './control-intent.js';
import type { RunOutcome, RunRef, TaskAttemptRef, TaskTriple } from './dispatch.js';
import { EVIDENCE_OUTCOMES } from './evidence.js';
import { canonicalJson, sha256Hex, type JsonValue } from './fingerprint.js';
import { truncateUtf8 } from './utf8.js';
import type { RunFailureOrigin } from './no-progress.js';
import type { FailingCheckFactV1 } from './task-failure.js';
import type {
  CapturedPathV1, CrashSuspicionV1, UnknownCallDispositionV1, UnknownCallKindV1, UnknownCallObservationV1,
  UnknownCallReviewRef, WorkspaceCaptureV1,
} from './unknown-call-review.js';
import {
  REWORK_FAILURE_CLASSES, type ReworkActorClass, type ReworkFailureClass, type StopRequester, type TaskRequeueRef,
} from './task-requeue.js';
import { ROUND_CHECK_INCOMPLETE_CAUSES, type VerificationRoundRef } from './verification.js';
import { PLATFORM_PROMPT_PACK_V1 } from './prompts/platform-pack.generated.js';
import type { PromptTextsV1 } from './prompts/prompt-set.js';
import { renderTemplate } from './prompts/render-template.js';

// ------------------------------------------------------------------------ //
// Shapes                                                                    //
// ------------------------------------------------------------------------ //
/** Text cut to `CONTINUATION_BRIEF_LIMITS.textChars`; `truncated` says whether anything was cut. */
export type BoundedTextV1 = { text: string; truncated: boolean };
/** Whether the workspace source changed between two persisted checkpoints. */
export type SourceChangeVerdictV1 = 'changed' | 'unchanged' | 'unknown';
export type ContinuationToolCallV1 = {
  callId: string;
  name: string;
  target: BoundedTextV1 | null;
  result: 'success' | 'error' | 'cancelled' | 'not_started' | 'outcome_unknown';
  sideEffect: 'none' | 'possible' | 'confirmed' | null;
  /** At most `pathsPerCall`. */
  changedPaths: string[];
  changedPathsOmitted: number;
  error: BoundedTextV1 | null;
};
/** Only session messages and artifacts; there is no instruction input. */
export type ContinuationNewInputV1 =
  /**
   * `replyBody` is inlined only when the reply does not go back to the new Run's claim Session, i.e. the message's
   * sender is not a work Run of that Session (§6.1 contract (e) "发给新 Run 所在 Session 之外时"); otherwise that
   * Session's input channel supplies the reply and `replyBody` is null.
   */
  | { kind: 'session_message'; ref: SessionMessageRef; replyBody: BoundedTextV1 | null }
  | { kind: 'artifact'; ref: ArtifactRef; body: BoundedTextV1 | null };
export type ContinuationSourceCheckpointV1 = {
  kind: 'round_open' | 'requeue' | 'brief';
  at: string;
  workspaceRevision: number | null;
  sourceDigest: string | null;
  unavailableReason: string | null;
};
export type ContinuationSessionContinuity =
  | 'same_session_history'
  | 'same_session_without_previous_turn'
  | 'other_session_seeded'
  | 'other_session';
/**
 * Every field is required (null when absent) so the canonical digest is total.
 * The previous Run is always the requeue's afterRun.
 */
export type ContinuationAnomalySectionV1 = {
  anchors: SessionAnomalyAnchorV1[]; omitted: number;
  instructionVersion: 1;
};
/** L6: the diff omission reasons; `section_limit` is the whole-section 8 KiB budget, the rest are per-path read outcomes. */
export type ContinuationDiffOmittedReasonV1 =
  | 'baseline_dirty' | 'binary' | 'too_large' | 'protected' | 'section_limit' | 'not_text';
/** L6: one edited path of one review item. */
export type ContinuationUnknownCallReviewFileV1 = {
  path: string;
  mode: 'replace' | 'create';
  change: CapturedPathV1['change'] | 'unchanged' | 'not_visible' | 'unknown';
  /** L6 excerpt of the Kernel-recorded argument, <=1,000 UTF-16 units. */
  oldText: BoundedTextV1 | null;
  /** L6 excerpt of the Kernel-recorded argument, <=1,000 UTF-16 units. */
  newText: BoundedTextV1 | null;
  /** L6 unified diff, <=2,000 UTF-16 units; all diffs together <=8 KiB UTF-8. */
  diff: BoundedTextV1 | null;
  diffOmittedReason: ContinuationDiffOmittedReasonV1 | null;
};
/** L6: one unknown call in the continuation note. */
export type ContinuationUnknownCallReviewItemV1 = {
  alias: number;
  /** Rendered only in the non-required conclusion line (D8). */
  callId: string;
  toolName: string;
  kind: UnknownCallKindV1;
  summary: BoundedTextV1;
  verdict: UnknownCallObservationV1['verdict'];
  evidence: BoundedTextV1 | null;
  crashSuspicion: CrashSuspicionV1 | null;
  /** D6: the pre-re-judgement model conclusion and self-check, as one bounded text. */
  reviewerConclusion: BoundedTextV1 | null;
  files: ContinuationUnknownCallReviewFileV1[];
};
/**
 * K3 L20/§2: the `unknownCallReview` section of the brief. Group 4 adds the
 * disposition and blocked-command rendering; the type carries the disposition
 * so a later group does not have to change the digest shape.
 */
export type ContinuationUnknownCallReviewDispositionV1 = {
  choice: UnknownCallDispositionV1['choice'];
  source: 'card' | 'direct';
  text: BoundedTextV1 | null;
  /** `dispositionTargets` by alias. */
  targets: number[];
  /** The platform entries among them that are not clear ("结果查不清，重做前先核实"). */
  platformTargets: number[];
  approvedMethods: Array<{ alias: number; command: string; cwd: string | null }>;
  /**
   * K3 L18: the answer's annotations, in the answer's order. `path: null` names
   * the record object, otherwise the file object's path. Rendered as
   * non-required lines, so they shrink and drop with the other optional lines.
   */
  annotations: Array<{ path: string | null; text: string }>;
};
/**
 * K3 B3 item 7 (replaces ruling 6): the blocked commands of ONE review record
 * as the required part signals them. Present only when the record's
 * `blockedCommands` is non-empty, so every brief without one keeps its bytes.
 */
export type ContinuationBlockedCommandV1 = {
  alias: number;
  /** The record's origin Run (`blockedCommands[].reviewRunId`). */
  reviewRunId: string;
  commandSha256: string;
};
/** K3 B3 item 7: one rendered blocked command of the Task's records, newest request state included. */
export type ContinuationBlockedCommandLineV1 = {
  alias: number;
  reviewRunId: string;
  /** The alias's newest request in that record; `used`/`closed`/absent render nothing. */
  requestState: 'pending' | 'allowed' | 'denied' | 'denied_final' | null;
  /** The alias's forms across its requests in that record, declaration order, deduplicated. */
  declaredForms: string[];
};
export type ContinuationUnknownCallReviewV1 = {
  reviewRef: UnknownCallReviewRef;
  revision: number;
  origin: 'takeover_unresolved' | 'human_attested';
  inventory: 'complete' | 'incomplete';
  items: ContinuationUnknownCallReviewItemV1[];
  itemsOmitted: number;
  disposition: ContinuationUnknownCallReviewDispositionV1 | null;
  workspace: {
    status: WorkspaceCaptureV1['status'];
    runBaselineKnown: boolean;
    notVisible: string[];
    changedSample: string[];
    changedOmitted: number;
  };
  /** K3 B3 item 6: present exactly when this record's `blockedCommands` is non-empty. */
  blockedCommands?: ContinuationBlockedCommandV1[];
};
export type ContinuationBriefV1 = {
  schemaVersion: 1;
  /** The new (continuing) Run. */
  runRef: RunRef;
  task: TaskTriple;
  requeueRef: TaskRequeueRef;
  /** Class `interrupted` ⇒ `resume_after_interruption`; every other class ⇒ `rework`. */
  mode: 'rework' | 'resume_after_interruption';
  failureClass: ReworkFailureClass;
  trigger: {
    actorClass: ReworkActorClass;
    goalResume: boolean;
    /** This Task's n-th TaskRequeue, from 1. */
    requeueNumber: number;
    /** From the immutable `TaskRequeue.automation`; null for a non-automatic requeue. */
    autoRework: { count: number; cap: number } | null;
    /** At most `earlierRequeues`. */
    earlierRequeues: Array<{ afterRunId: string; failureClass: ReworkFailureClass }>;
  };
  previous: {
    runRef: RunRef;
    attemptRef: TaskAttemptRef;
    sessionRef: SessionRef;
    outcome: Exclude<RunOutcome, 'outcome_unknown'>;
    origin: RunFailureOrigin;
    interruption: { kind: 'executing' | 'paused'; kernelPaused: boolean; pausedBy: StopRequester | null } | null;
    /** Copied from `TaskRequeue.stopRequester`; `none` is recorded as null. */
    cancelledBy: Exclude<StopRequester, 'none'> | null;
    error: BoundedTextV1 | null;
    limit: { kind: string; observed: number; allowed: number } | null;
    budget: { previousTokenBudget: number; currentTokenBudget: number } | null;
    wait: { messageRef: SessionMessageRef; status: 'pending' | 'read' | 'responded' } | null;
    unacceptedSteers: Array<{ intentRef: ControlIntentRef; text: BoundedTextV1 }>;
    endedAt: string | null;
  };
  /** The nearest ancestor that entered the Kernel when afterRun never did (hops ≤ `factsFromHops`). */
  factsFrom: { runRef: RunRef; hops: number; truncated: boolean };
  stoppedAt: {
    kernel: 'read' | 'not_entered' | 'unavailable';
    reason: string | null;
    turnStatus: 'completed' | 'failed' | 'cancelled' | 'limit_exceeded' | 'yielded' | 'paused' | 'running' | 'interrupted' | null;
    lastPosition: number | null;
    lastToolGroup: { sourceMessageId: string; calls: number } | null;
    lastAssistant: BoundedTextV1 | null;
    window: { fromPosition: number; throughPosition: number; omittedRecords: number } | null;
  };
  toolCalls: {
    confirmed: ContinuationToolCallV1[];
    /** Kernel `pending`/abandoned calls (LA-7). */
    notExecuted: ContinuationToolCallV1[];
    unknown: ContinuationToolCallV1[];
    confirmedOmitted: number;
    notExecutedOmitted: number;
    unknownOmitted: number;
  };
  /** Empty for `same_session_history`: the history already holds them. */
  acceptedInputs: {
    steers: Array<{ intentRef: ControlIntentRef; text: BoundedTextV1 }>;
    steersOmitted: number;
    messages: Array<{ messageRef: SessionMessageRef; part: 'message' | 'response'; excerpt: BoundedTextV1 }>;
    messagesOmitted: number;
  };
  /** The previous Run's chain head. */
  checks: { roundRef: VerificationRoundRef; roundOrdinal: number; failing: FailingCheckFactV1[]; gapCodes: string[] } | null;
  requeue: { reason: BoundedTextV1; reasonAuthor: ReworkActorClass; newInputs: ContinuationNewInputV1[] };
  /** Best effort; never claims "no change" for a window it could not observe. */
  workspace: {
    selfChanged: { status: 'known' | 'partial' | 'not_entered' | 'unavailable'; confirmed: string[]; possible: string[]; omitted: number };
    checkpoints: ContinuationSourceCheckpointV1[];
    /** `from`/`to` are indexes into `checkpoints`; the verdict comes from `compareSourceCheckpoints`. */
    segments: Array<{ from: number; to: number; verdict: SourceChangeVerdictV1; reason: string }>;
    /**
     * Previous Run end → first checkpoint (index `to`, null without one) is never observed. LA-10: when the afterRun
     * never entered, `previousEndedAt` is the end of the `factsFrom` Run.
     */
    unobserved: { from: 'previous_run_end'; to: number | null; previousEndedAt: string | null };
    uncommitted: { status: 'git' | 'not_git' | 'unavailable'; baseCommit: string | null; paths: string[]; omitted: number; reason: string | null };
  };
  session: {
    continuity: ContinuationSessionContinuity;
    /** The new Run's claim Session. */
    sessionRef: SessionRef;
    seededFrom: { sessionRef: SessionRef; throughPosition: number | null } | null;
    boundaryPosition: number | null;
  };
  /** Fixed instruction block (must say files may have changed; re-read before editing). Text change ⇒ new version. */
  standingInstructionVersion: 1;
  /**
   * Slice 1 §2.7: the anomaly anchors actually carried into this brief. Absent
   * means no such section; it is never added to a historical brief's digest.
   */
  anomalies?: ContinuationAnomalySectionV1;
  /**
   * K3 L20: the previous/afterRun's unknown-call review, when one exists.
   * Absent or null means no section; a historical brief is read as null and
   * keeps its old bytes and digest exactly.
   */
  unknownCallReview?: ContinuationUnknownCallReviewV1 | null;
  /**
   * K3 B3 item 7 / lead answer 6: the Task's blocked commands (all of its
   * records, ordered by record creation time then alias) as the standalone
   * optional section. Present only when non-empty; absent or empty renders no
   * bytes, so a brief without blocked commands keeps its digest.
   */
  blockedCommands?: ContinuationBlockedCommandLineV1[];
};

/** Bounds of the brief; over-long fields are truncated and counted in `…Omitted` / `truncated`. */
export const CONTINUATION_BRIEF_LIMITS = Object.freeze({
  confirmedToolCalls: 40,
  notExecutedToolCalls: 20,
  unknownToolCalls: 20,
  /** Paths across `selfChanged` and across `uncommitted`. */
  paths: 64,
  pathsPerCall: 8,
  /** Kernel records read while assembling. */
  kernelRecords: 5000,
  /** Rendered text; the fixed instruction block is always kept. */
  renderedBytes: 16_384,
  earlierRequeues: 5,
  factsFromHops: 4,
  newInputs: 16,
  /** Per `BoundedTextV1` field, in UTF-16 code units. */
  textChars: 4000,
} as const);

// ------------------------------------------------------------------------ //
// Digest and marker                                                         //
// ------------------------------------------------------------------------ //
/** `RuntimeInputBindingV1.continuationBriefDigest` = sha256Hex(canonicalJson(brief)). */
export function continuationBriefDigest(brief: ContinuationBriefV1): string {
  return sha256Hex(canonicalJson(brief as unknown as JsonValue));
}
/** The second line of the rendered brief; WorkGraph re-renders and compares the suffix. */
export function continuationBriefMarker(digest: string): string {
  return `[continuation-brief v1 sha256:${digest}]`;
}

// ------------------------------------------------------------------------ //
// Source checkpoints                                                        //
// ------------------------------------------------------------------------ //
/** Any persisted stamp: a checkpoint, a round identity or a refusal's captured source. */
export type SourceCheckpointStampV1 = { sourceDigest: string | null; unavailableReason?: string | null };
/** Compares persisted stamps only; anything it cannot decide is `unknown`. */
export function compareSourceCheckpoints(
  from: SourceCheckpointStampV1 | null,
  to: SourceCheckpointStampV1 | null,
): { verdict: SourceChangeVerdictV1; reason: string } {
  if (from === null || to === null) return { verdict: 'unknown', reason: 'no persisted source checkpoint to compare with' };
  if (from.sourceDigest === null) return { verdict: 'unknown', reason: `the earlier checkpoint has no source digest${because(from)}` };
  if (to.sourceDigest === null) return { verdict: 'unknown', reason: `the later checkpoint has no source digest${because(to)}` };
  return from.sourceDigest === to.sourceDigest
    ? { verdict: 'unchanged', reason: 'the workspace source digest is identical' }
    : { verdict: 'changed', reason: 'the workspace source digest differs' };
}
function because(stamp: SourceCheckpointStampV1): string {
  return stamp.unavailableReason === undefined || stamp.unavailableReason === null ? '' : `: ${stamp.unavailableReason}`;
}

// ------------------------------------------------------------------------ //
// Chinese renderer                                                          //
// ------------------------------------------------------------------------ //
/**
 * Every fixed text and label the renderer needs, read from one pack (ruling
 * 14). A preparation passes the resolved pack; a direct call keeps the
 * generated platform pack, so existing renderer tests are unchanged.
 */
type BriefTexts = {
  pack: PromptTextsV1;
  S: (key: string) => string;
  template: string;
  heading: string;
  standing: readonly string[];
  failureClass: Readonly<Record<ReworkFailureClass, string>>;
  actorClass: Readonly<Record<ReworkActorClass, string>>;
  stopRequester: Readonly<Record<StopRequester, string>>;
  toolResult: Readonly<Record<ContinuationToolCallV1['result'], string>>;
  sideEffect: Readonly<Record<NonNullable<ContinuationToolCallV1['sideEffect']>, string>>;
  waitStatus: Readonly<Record<'pending' | 'read' | 'responded', string>>;
  checkpoint: Readonly<Record<ContinuationSourceCheckpointV1['kind'], string>>;
  anomalyCause: Readonly<Record<SessionAnomalyAnchorV1['cause'], string>>;
  anomalyMixedOwnership: string;
  anomalyLastSentence: string;
  reviewTitle: string;
  reviewNotListed: string;
  reviewBlocked: string;
  blockedTitle: string;
  blockedState: Readonly<Record<'pending' | 'allowed' | 'denied' | 'denied_final', string>>;
  disposition: Readonly<Record<NonNullable<ContinuationUnknownCallReviewV1['disposition']>['choice'], string>>;
  noDisposition: string;
  reviewSource: Readonly<Record<'card' | 'direct', string>>;
  autoSource: string;
  reviewVerdict: Readonly<Record<string, string>>;
  reviewChange: Readonly<Record<ContinuationUnknownCallReviewFileV1['change'], string>>;
  reviewMode: Readonly<Record<'replace' | 'create', string>>;
  reviewDiffReason: Readonly<Record<ContinuationDiffOmittedReasonV1, string>>;
};

/** One fixed string of the resolved pack; a missing key is a pack bug. */
function packString(texts: PromptTextsV1, key: string): string {
  const value = texts.strings[key];
  if (value === undefined) throw new Error(`the resolved prompt pack has no string "${key}"`);
  return value;
}

/** Builds the whole fixed-text table from one pack; nothing falls back per key. */
function briefTexts(texts: PromptTextsV1): BriefTexts {
  const S = (key: string): string => packString(texts, key);
  const template = texts.templates['continuation-brief'] ?? '';
  return {
    pack: texts,
    S,
    template,
    heading: template.slice(0, template.indexOf('\n')),
    standing: Object.freeze(template.slice(template.lastIndexOf('\n\n') + 2).split('\n')),
    failureClass: Object.freeze({
      interrupted: S('brief.failureClass.interrupted') ?? '', cancelled: S('brief.failureClass.cancelled') ?? '',
      check_failed: S('brief.failureClass.check_failed') ?? '', run_failed: S('brief.failureClass.run_failed') ?? '',
      check_incomplete: S('brief.failureClass.check_incomplete') ?? '',
    }),
    actorClass: Object.freeze({
      human: S('brief.actorClass.human') ?? '', system: S('brief.actorClass.system') ?? '',
      agent: S('brief.actorClass.agent') ?? '',
    }),
    stopRequester: {
      human: S('brief.stopRequester.human') ?? '', goal_fan_out: S('brief.stopRequester.goal_fan_out') ?? '',
      system: S('brief.stopRequester.system') ?? '', none: S('brief.stopRequester.none') ?? '',
    },
    toolResult: {
      success: S('brief.toolResult.success') ?? '', error: S('brief.toolResult.error') ?? '',
      cancelled: S('brief.toolResult.cancelled') ?? '', not_started: S('brief.toolResult.not_started') ?? '',
      outcome_unknown: S('brief.toolResult.outcome_unknown') ?? '',
    },
    sideEffect: {
      none: S('brief.sideEffect.none') ?? '', possible: S('brief.sideEffect.possible') ?? '',
      confirmed: S('brief.sideEffect.confirmed') ?? '',
    },
    waitStatus: {
      pending: S('brief.waitStatus.pending') ?? '', read: S('brief.waitStatus.read') ?? '',
      responded: S('brief.waitStatus.responded') ?? '',
    },
    checkpoint: {
      round_open: S('brief.checkpoint.round_open') ?? '', requeue: S('brief.checkpoint.requeue') ?? '',
      brief: S('brief.checkpoint.brief') ?? '',
    },
    anomalyCause: {
      archive_interrupted: S('brief.anomaly.cause.archive_interrupted') ?? '',
      retired_archive: S('brief.anomaly.cause.retired_archive') ?? '',
    },
    anomalyMixedOwnership: S('brief.anomaly.mixedOwnership') ?? '',
    anomalyLastSentence: S('brief.anomaly.lastSentence') ?? '',
    reviewTitle: S('brief.review.title') ?? '',
    reviewNotListed: S('brief.review.notListed') ?? '',
    reviewBlocked: S('brief.review.blocked') ?? '',
    blockedTitle: S('brief.blocked.title') ?? '',
    blockedState: {
      pending: S('brief.blocked.state.pending') ?? '', allowed: S('brief.blocked.state.allowed') ?? '',
      denied: S('brief.blocked.state.denied') ?? '', denied_final: S('brief.blocked.state.denied_final') ?? '',
    },
    disposition: {
      rerun_as_is: S('brief.review.disposition.rerun_as_is') ?? '',
      skip_as_done: S('brief.review.disposition.skip_as_done') ?? '',
      handle_myself: S('brief.review.disposition.handle_myself') ?? '',
      safer_method: S('brief.review.disposition.safer_method') ?? '',
    },
    noDisposition: S('brief.review.noDisposition') ?? '',
    reviewSource: { card: S('brief.review.source.card') ?? '', direct: S('brief.review.source.direct') ?? '' },
    autoSource: S('brief.review.autoSource') ?? '',
    reviewVerdict: {
      no_review_needed: S('brief.review.verdict.no_review_needed') ?? '', done: S('brief.review.verdict.done') ?? '',
      not_done: S('brief.review.verdict.not_done') ?? '',
      compare_in_continuation: S('brief.review.verdict.compare_in_continuation') ?? '',
      pending: S('brief.review.verdict.pending') ?? '', partial: S('brief.review.verdict.partial') ?? '',
      undetermined: S('brief.review.verdict.undetermined') ?? '',
    },
    reviewChange: {
      added: S('brief.review.change.added') ?? '', modified: S('brief.review.change.modified') ?? '',
      deleted: S('brief.review.change.deleted') ?? '', mode_changed: S('brief.review.change.mode_changed') ?? '',
      unchanged: S('brief.review.change.unchanged') ?? '', not_visible: S('brief.review.change.not_visible') ?? '',
      unknown: S('brief.review.change.unknown') ?? '',
    },
    reviewMode: { replace: S('brief.review.mode.replace') ?? '', create: S('brief.review.mode.create') ?? '' },
    reviewDiffReason: {
      baseline_dirty: S('brief.review.diffReason.baseline_dirty') ?? '', binary: S('brief.review.diffReason.binary') ?? '',
      too_large: S('brief.review.diffReason.too_large') ?? '', protected: S('brief.review.diffReason.protected') ?? '',
      section_limit: S('brief.review.diffReason.section_limit') ?? '', not_text: S('brief.review.diffReason.not_text') ?? '',
    },
  };
}

const DEFAULT_TEXTS: PromptTextsV1 = PLATFORM_PROMPT_PACK_V1;

/** Successively shorter caps (UTF-16 code units) tried on every text before body items are left out. */
const RENDER_TEXT_CAPS: readonly number[] = [CONTINUATION_BRIEF_LIMITS.textChars, 1000, 250, 60];
const UTF8 = new TextEncoder();

/** The arrays the template renders; every non-empty part carries the leading LF its joined layout had. */
type ContinuationBriefTemplateParts = {
  body: readonly string[];
  blockedOmission: readonly string[];
  bodyOmission: readonly string[];
  anomalies: readonly string[];
  review: readonly string[];
  blocked: readonly string[];
};
/**
 * Renders the selected parts through the pack template. The title, the marker
 * position and the fixed closing block are the template's; a non-empty part is
 * prefixed with the single LF the old array join supplied, so an empty part
 * renders no bytes at all. `sectionRanges` is not part of the brief output.
 */
function renderBriefTemplateZh(B: BriefTexts, marker: string, parts: ContinuationBriefTemplateParts): string {
  const slot = (lines: readonly string[]): string => (lines.length === 0 ? '' : `\n${lines.join('\n')}`);
  return renderTemplate(B.pack, 'continuation-brief', {
    marker,
    body: slot(parts.body),
    blockedOmission: slot(parts.blockedOmission),
    bodyOmission: slot(parts.bodyOmission),
    anomalies: slot(parts.anomalies),
    review: slot(parts.review),
    blocked: slot(parts.blocked),
  }, []).text;
}

/**
 * Renders the brief as the last section of `manifest.input` (spec §6.1 (e)):
 * line 1 is the title, line 2 `continuationBriefMarker(digest)`; WorkGraph
 * re-renders and compares this suffix. Pure and deterministic. The result stays
 * within `renderedBytes` UTF-8 bytes: every text is first cut shorter step by
 * step, then trailing body lines are left out with a note; the fixed
 * instruction block is always kept. Where the records cannot tell, it says so
 * and never claims "no change".
 *
 * The previous Run's ending: `origin: 'observed'` reads "执行记录" (D-7
 * not-entered cancels and RUN-23 are observed too); a not-entered Run renders
 * from `stoppedAt.kernel: 'not_entered'`; a RUN-23 cancel is recognized by the
 * synthesized `run_cancelled` reason carried in `stoppedAt.reason`
 * (`cancelled_at_reconcile`: Host-restart wording; `cancelled_while_paused`:
 * the in-process wording).
 */
export function renderContinuationBriefZh(brief: ContinuationBriefV1, digest: string, texts: PromptTextsV1 = DEFAULT_TEXTS): string {
  const B = briefTexts(texts);
  const marker = continuationBriefMarker(digest);
  const head = [B.heading, marker];
  const tail = ['', ...B.standing];
  const limit = CONTINUATION_BRIEF_LIMITS.renderedBytes;
  const anomalies = brief.anomalies;
  const review = brief.unknownCallReview ?? null;
  const allPaths = anomalies === undefined ? 0 : anomalyPathLineCount(anomalies);
  const allReviewLines = review === null ? 0 : unknownCallReviewOptionalLineCount(review);
  const blockedAll = brief.blockedCommands ?? [];
  const blockedKeepMax = Math.min(16, blockedAll.length);
  let blockedOmitted = 0;
  let body: string[] = [];
  let anomaly: string[] = [];
  let reviewLines: string[] = [];
  // K3 B3 item 7 / lead answer 6: the blocked section is an ordinary OPTIONAL
  // part that goes FIRST. With every other optional part at full length, take
  // its entries away from the end (the count line first, then the lines from the
  // last; the empty line and heading go with the last line) before the text caps
  // shorten or the other optional lines are omitted.
  if (blockedAll.length > 0) {
    const firstCap = RENDER_TEXT_CAPS[0]!;
    const fullBody = briefBodyZh(B, brief, firstCap);
    const fullAnomaly = anomalyLinesZh(B, brief, firstCap, allPaths);
    const fullReview = unknownCallReviewLinesZh(B, brief, firstCap, allReviewLines);
    // K3 B3 item 9: the count line is its own last entry (present only while all
    // 16 lines are shown and the Task has more), and every candidate is measured
    // WITH the note for the command lines it just removed — the count line itself
    // is never counted. Removing all command lines also removes the empty line
    // and heading, so the whole section is gone at `keep === 0`. The note stays
    // inside the `blocked` part here: it follows the section's last line and
    // precedes the fixed closing block, and the template's separate
    // `blockedOmission` slot is the position used once the section is gone.
    const candidate = (keep: number, withCountLine: boolean): string => {
      const removed = blockedKeepMax - keep;
      const note = removed > 0 ? [omittedNoteZh(B, removed)] : [];
      return renderBriefTemplateZh(B, marker, {
        body: fullBody, blockedOmission: [], bodyOmission: [], anomalies: fullAnomaly, review: fullReview,
        blocked: [...blockedCommandsLinesZh(B, blockedAll, keep, withCountLine), ...note],
      });
    };
    if (blockedAll.length > blockedKeepMax) {
      const text = candidate(blockedKeepMax, true);
      if (utf8Length(text) <= limit) return text;
    }
    for (let keep = blockedKeepMax; keep >= 0; keep -= 1) {
      const text = candidate(keep, false);
      if (utf8Length(text) <= limit) return text;
    }
    // The whole section is gone and the brief is still over: only now do the
    // ordinary caps and omissions apply to the other optional parts.
    blockedOmitted = blockedKeepMax;
  }
  for (const cap of RENDER_TEXT_CAPS) {
    body = briefBodyZh(B, brief, cap);
    anomaly = anomalyLinesZh(B, brief, cap, allPaths);
    reviewLines = unknownCallReviewLinesZh(B, brief, cap, allReviewLines);
    // The removed blocked command lines are already owed a note; measure every
    // cap candidate WITH it and return that measured text (never a shorter one).
    const note = blockedOmitted > 0 ? [omittedNoteZh(B, blockedOmitted)] : [];
    const text = renderBriefTemplateZh(B, marker, {
      body, blockedOmission: note, bodyOmission: [], anomalies: anomaly, review: reviewLines, blocked: [],
    });
    if (utf8Length(text) <= limit) return text;
  }
  if (anomalies === undefined && review === null && blockedAll.length === 0) {
    // A brief without either mandatory section keeps its old bytes: this is the
    // original bounded fallback, the longest prefix of ordinary body lines.
    const fixed = utf8Length([...head, ...tail].join('\n'));
    let used = fixed;
    let kept = 0;
    for (const line of body) {
      const next = used + 1 + utf8Length(line);
      if (next + 1 + utf8Length(omittedNoteZh(B, body.length - kept - 1)) > limit) break;
      used = next;
      kept += 1;
    }
    return renderBriefTemplateZh(B, marker, {
      body: body.slice(0, kept), blockedOmission: [], bodyOmission: [omittedNoteZh(B, body.length - kept)],
      anomalies: [], review: [], blocked: [],
    });
  }
  // Still too long with the shortest texts. Every present mandatory section is
  // kept in full (spec §2.7; K3 L20 "必需部分"); only its optional lines are
  // budgeted, counting what is left out. If even the mandatory lines do not fit,
  // refuse `capacity` instead of silently dropping a section.
  const cap = RENDER_TEXT_CAPS[RENDER_TEXT_CAPS.length - 1]!;
  let suffixMandatory: string[];
  if (review === null) {
    let budgeted: string[] | null = null;
    for (let allowed = allPaths; allowed >= 0; allowed -= 1) {
      const candidate = anomalyLinesZh(B, brief, cap, allowed);
      if (utf8Length([...head, ...candidate, ...tail].join('\n')) <= limit) { budgeted = candidate; break; }
    }
    if (budgeted === null) {
      throw new ContinuationBriefCapacityError(
        `the mandatory anomaly section does not fit in the ${String(limit)}-byte continuation brief limit`);
    }
    suffixMandatory = budgeted;
  } else {
    // K3 L20: the review section is a second mandatory part, placed after the
    // anomaly section and before the fixed closing block. Budget the optional
    // lines of both sections (anomaly paths first, then the review detail) while
    // keeping every mandatory line.
    let chosen: string[] | null = null;
    for (let allowedAnomaly = allPaths; allowedAnomaly >= 0 && chosen === null; allowedAnomaly -= 1) {
      for (let allowedReview = allReviewLines; allowedReview >= 0; allowedReview -= 1) {
        const candidate = [...anomalyLinesZh(B, brief, cap, allowedAnomaly), ...unknownCallReviewLinesZh(B, brief, cap, allowedReview)];
        if (utf8Length([...head, ...candidate, ...tail].join('\n')) <= limit) { chosen = candidate; break; }
      }
    }
    if (chosen === null) {
      throw new ContinuationBriefCapacityError(
        `the mandatory unknown-call review section does not fit in the ${String(limit)}-byte continuation brief limit`);
    }
    suffixMandatory = chosen;
  }
  const suffix = [...suffixMandatory, ...tail];
  const fixed = utf8Length([...head, ...suffix].join('\n'));
  let used = fixed;
  let kept = 0;
  for (const line of body) {
    const next = used + 1 + utf8Length(line);
    if (next + 1 + utf8Length(omittedNoteZh(B, body.length - kept - 1 + blockedOmitted)) > limit) break;
    used = next;
    kept += 1;
  }
  const withNote = renderBriefTemplateZh(B, marker, {
    body: body.slice(0, kept), blockedOmission: [], bodyOmission: [omittedNoteZh(B, body.length - kept + blockedOmitted)],
    anomalies: suffixMandatory, review: [], blocked: [],
  });
  return kept === 0 && utf8Length(withNote) > limit ? [...head, ...suffix].join('\n') : withNote;
}

function omittedNoteZh(B: BriefTexts, lines: number): string {
  return `${B.S('brief.omitted.prefix')}${String(CONTINUATION_BRIEF_LIMITS.renderedBytes)}`
    + `${B.S('brief.omitted.between')}${String(lines)}${B.S('brief.omitted.suffix')}`;
}
function utf8Length(text: string): number {
  return UTF8.encode(text).length;
}
/**
 * K3 B3 item 7/9: the optional `### 被拦的命令` section. `keep` is the number of
 * command lines still rendered (0..16); `withCountLine` shows the count line,
 * which is the section's own last entry and is only shown while all 16 lines
 * are. The caller counts every removed command line in the ordinary omission
 * note and measures the candidate together with that note; the count line is
 * never counted, and the empty line plus heading disappear with the last line.
 */
function blockedCommandsLinesZh(
  B: BriefTexts, entries: NonNullable<ContinuationBriefV1['blockedCommands']>, keep: number, withCountLine: boolean,
): string[] {
  if (entries.length === 0 || keep <= 0) return [];
  const lines: string[] = ['', B.blockedTitle];
  for (const entry of entries.slice(0, Math.min(16, keep))) {
    let line = `${B.S('brief.blocked.lineLead')}${String(entry.alias)}${B.S('brief.blocked.lineMiddle')}`
      + `${entry.reviewRunId.slice(0, 8)}${B.S('brief.blocked.lineSuffix')}`;
    if (entry.requestState !== null) line += `${B.S('brief.blocked.stateLead')}${B.blockedState[entry.requestState]}`;
    const forms: string[] = [];
    const seen = new Set<string>();
    for (const raw of entry.declaredForms) {
      if (seen.has(raw)) continue;
      seen.add(raw);
      forms.push(truncateUtf8(raw, 160));
    }
    if (forms.length > 0) {
      line += `${B.S('brief.blocked.formsLead')}${forms.slice(0, 3).join(B.S('brief.list.separator'))}`;
      if (forms.length > 3) line += `${B.S('brief.blocked.formsMoreLead')}${String(forms.length)}${B.S('brief.blocked.formsMoreSuffix')}`;
    }
    lines.push(line);
  }
  if (withCountLine && entries.length > 16) {
    lines.push(`${B.S('brief.blocked.omittedLead')}${String(entries.length - 16)}${B.S('brief.blocked.omittedSuffix')}`);
  }
  return lines;
}
/** `text` cut to `cap` UTF-16 code units without splitting a surrogate pair; continuation lines are indented. */
function clip(B: BriefTexts, text: string, cap: number): string {
  let cut = text;
  if (text.length > cap) {
    const end = cap > 0 && /[\uD800-\uDBFF]/.test(text.charAt(cap - 1)) ? cap - 1 : cap;
    cut = `${text.slice(0, end)}${B.S('brief.clip.truncatedSuffix')}`;
  }
  return cut.replace(/\r?\n/g, B.S('brief.clip.newlineIndent'));
}
function boundedZh(B: BriefTexts, value: BoundedTextV1, cap: number): string {
  const text = clip(B, value.text, cap);
  const truncated = B.S('brief.clip.truncatedSuffix');
  return value.truncated && !text.endsWith(truncated) ? `${text}${truncated}` : text;
}
function listZh(B: BriefTexts, items: readonly string[], cap: number): string {
  return items.length === 0
    ? B.S('brief.list.none') : items.map((item) => clip(B, item, cap)).join(B.S('brief.list.separator'));
}
function moreZh(B: BriefTexts, omitted: number): string {
  return omitted > 0 ? `${B.S('brief.list.morePrefix')}${String(omitted)}${B.S('brief.list.moreSuffix')}` : '';
}

function briefBodyZh(B: BriefTexts, brief: ContinuationBriefV1, cap: number): string[] {
  const t = (value: BoundedTextV1): string => boundedZh(B, value, cap);
  const lines: string[] = [];
  const section = (title: string): void => { lines.push('', `### ${title}`); };
  const trigger = brief.trigger;
  const previous = brief.previous;
  const stoppedAt = brief.stoppedAt;

  let summary = `${B.S('brief.summary.lead')}${brief.task.taskId}${B.S('brief.summary.afterTask')}`
    + `${brief.mode === 'rework' ? B.S('brief.mode.rework') : B.S('brief.mode.resumeAfterInterruption')}${B.S('brief.summary.afterMode')}`
    + `${B.S('brief.summary.requeueLead')}${String(trigger.requeueNumber)}${B.S('brief.summary.beforeFailureClass')}`
    + `${B.failureClass[brief.failureClass]}${B.S('brief.summary.beforeActor')}`
    + `${B.actorClass[trigger.actorClass]}`;
  if (trigger.goalResume) summary += B.S('brief.summary.goalResume');
  if (trigger.autoRework !== null) {
    summary += `${B.S('brief.summary.autoRework')}${String(trigger.autoRework.count)}/${String(trigger.autoRework.cap)}`;
  }
  lines.push(`${summary}。`);
  if (trigger.earlierRequeues.length > 0) {
    lines.push(`${B.S('brief.earlierRequeues.lead')}${trigger.earlierRequeues
      .map((earlier) => `${earlier.afterRunId}（${B.failureClass[earlier.failureClass]}）`).join(B.S('brief.list.separator'))}。`);
  }
  lines.push(continuityZh(B, brief.session));

  section(B.S('brief.section.previous'));
  lines.push(`${B.S('brief.previous.runLead')}${previous.runRef.runId}${B.S('brief.previous.sessionOpen')}`
    + `${previous.sessionRef.sessionId}）${endingZh(B, brief)}。`);
  if (brief.factsFrom.hops > 0) {
    lines.push(`${B.S('brief.previous.factsFromLead')}${brief.factsFrom.runRef.runId}${B.S('brief.previous.factsFromHopsOpen')}`
      + `${String(brief.factsFrom.hops)}${B.S('brief.previous.factsFromHopsSuffix')}`
      + `${brief.factsFrom.truncated ? B.S('brief.previous.factsFromTruncated') : ''}）。`);
  }
  if (previous.interruption !== null) {
    const interruption = previous.interruption;
    lines.push(`${B.S('brief.interruption.lead')}`
      + `${interruption.kind === 'paused' ? B.S('brief.interruption.paused') : B.S('brief.interruption.executing')}`
      + `${B.S('brief.interruption.kernelPrefix')}`
      + `${interruption.kernelPaused ? B.S('brief.interruption.reached') : B.S('brief.interruption.notReached')}`
      + `${B.S('brief.interruption.pointReachedSuffix')}`
      + `${interruption.pausedBy === null || interruption.pausedBy === 'none' ? '' : `${B.S('brief.interruption.requesterPrefix')}${B.stopRequester[interruption.pausedBy]}`}。`);
  }
  if (previous.cancelledBy !== null) {
    lines.push(`${B.S('brief.previous.cancelledByLead')}${B.stopRequester[previous.cancelledBy]}。`);
  }
  if (previous.error !== null) lines.push(`${B.S('brief.previous.errorLead')}${t(previous.error)}`);
  if (previous.limit !== null) {
    lines.push(`${B.S('brief.previous.limitLead')}${clip(B, previous.limit.kind, cap)}${B.S('brief.previous.limitObserved')}`
      + `${String(previous.limit.observed)}${B.S('brief.previous.limitAllowed')}${String(previous.limit.allowed)}。`);
  }
  if (previous.budget !== null) {
    lines.push(`${B.S('brief.previous.budgetLead')}${String(previous.budget.previousTokenBudget)}`
      + `${B.S('brief.previous.budgetCurrent')}${String(previous.budget.currentTokenBudget)}。`);
  }
  if (previous.wait !== null) {
    lines.push(`${B.S('brief.previous.waitLead')}${previous.wait.messageRef.messageId}：${B.waitStatus[previous.wait.status]}。`);
  }
  for (const steer of previous.unacceptedSteers) {
    lines.push(`${B.S('brief.previous.steerLead')}${steer.intentRef.intentId}：${t(steer.text)}`);
  }
  if (previous.endedAt !== null) lines.push(`${B.S('brief.previous.endedAtLead')}${previous.endedAt}。`);

  section(B.S('brief.section.stoppedAt'));
  if (stoppedAt.kernel === 'read') {
    lines.push(`${B.S('brief.stoppedAt.positionLead')}`
      + `${stoppedAt.lastPosition === null ? B.S('brief.unknown') : String(stoppedAt.lastPosition)}`
      + `${B.S('brief.stoppedAt.turnLead')}${stoppedAt.turnStatus ?? B.S('brief.unknown')}。`);
  } else {
    lines.push(stoppedAt.kernel === 'not_entered' ? B.S('brief.stoppedAt.notEntered') : B.S('brief.stoppedAt.unavailable'));
  }
  if (stoppedAt.reason !== null) lines.push(`${B.S('brief.stoppedAt.reasonLead')}${clip(B, stoppedAt.reason, cap)}`);
  if (stoppedAt.lastToolGroup !== null) {
    lines.push(`${B.S('brief.stoppedAt.toolGroupLead')}${stoppedAt.lastToolGroup.sourceMessageId}，`
      + `${String(stoppedAt.lastToolGroup.calls)}${B.S('brief.stoppedAt.toolGroupCallsSuffix')}`);
  }
  if (stoppedAt.lastAssistant !== null) lines.push(`${B.S('brief.stoppedAt.lastAssistantLead')}${t(stoppedAt.lastAssistant)}`);
  if (stoppedAt.window !== null) {
    lines.push(`${B.S('brief.stoppedAt.windowLead')}${String(stoppedAt.window.fromPosition)}`
      + `${B.S('brief.stoppedAt.windowRange')}${String(stoppedAt.window.throughPosition)}`
      + `${stoppedAt.window.omittedRecords > 0 ? `${B.S('brief.stoppedAt.windowOmittedLead')}${String(stoppedAt.window.omittedRecords)}${B.S('brief.stoppedAt.windowOmittedSuffix')}` : ''}。`);
  }

  section(B.S('brief.section.toolCalls'));
  const calls = brief.toolCalls;
  const groups: Array<[string, ContinuationToolCallV1[], number]> = [
    [B.S('brief.toolGroup.confirmed'), calls.confirmed, calls.confirmedOmitted],
    [B.S('brief.toolGroup.notExecuted'), calls.notExecuted, calls.notExecutedOmitted],
    [B.S('brief.toolGroup.unknown'), calls.unknown, calls.unknownOmitted],
  ];
  if (groups.every(([, listed, omitted]) => listed.length === 0 && omitted === 0)) {
    lines.push(stoppedAt.kernel === 'unavailable' ? B.S('brief.toolCalls.noneUnavailable') : B.S('brief.toolCalls.none'));
  }
  for (const [label, listed, omitted] of groups) {
    if (listed.length === 0 && omitted === 0) continue;
    lines.push(`- ${label}：${String(listed.length + omitted)}${B.S('brief.toolCalls.countSuffix')}${moreZh(B, omitted)}`);
    for (const call of listed) lines.push(`  - ${toolCallZh(B, call, cap)}`);
  }

  if (brief.checks !== null) {
    const checks = brief.checks;
    section(B.S('brief.section.checks'));
    lines.push(`${B.S('brief.checks.roundLead')}${checks.roundRef.roundId}${B.S('brief.checks.ordinalOpen')}`
      + `${String(checks.roundOrdinal)}${B.S('brief.checks.failingMiddle')}`
      + `${checks.failing.length === 0 ? B.S('brief.list.none') : ''}`);
    for (const failing of checks.failing) {
      lines.push(`  - ${failing.checkId}${B.S('brief.checks.itemPhase')}${failing.phase}${B.S('brief.checks.itemOutcome')}`
        + `${failing.outcome ?? B.S('brief.list.none')}`
        + `${failing.cause === null ? '' : `${B.S('brief.checks.causeLead')}${failing.cause}`}`
        + `${failing.reportRef === null ? B.S('brief.checks.noReport') : `${B.S('brief.checks.reportLead')}${failing.reportRef.digest}`}`);
    }
    if (checks.gapCodes.length > 0) lines.push(`${B.S('brief.checks.gapsLead')}${listZh(B, checks.gapCodes, cap)}`);
  }

  section(B.S('brief.section.requeue'));
  lines.push(`${B.S('brief.requeue.reasonLead')}${B.actorClass[brief.requeue.reasonAuthor]}`
    + `${B.S('brief.requeue.reasonMiddle')}${t(brief.requeue.reason)}`);
  if (brief.requeue.newInputs.length === 0) lines.push(B.S('brief.requeue.none'));
  for (const input of brief.requeue.newInputs) {
    lines.push(input.kind === 'session_message'
      ? `${B.S('brief.requeue.messageLead')}${input.ref.messageId}${input.replyBody === null ? '' : `${B.S('brief.requeue.replyLead')}${t(input.replyBody)}`}`
      : `${B.S('brief.requeue.materialLead')}${input.ref.contentType}${B.S('brief.requeue.materialDigestLead')}`
        + `${input.ref.digest}${input.body === null ? '' : `：${t(input.body)}`}`);
  }

  section(B.S('brief.section.workspace'));
  const workspace = brief.workspace;
  const self = workspace.selfChanged;
  if (self.status === 'unavailable') lines.push(B.S('brief.workspace.selfUnavailable'));
  else if (self.status === 'not_entered') lines.push(B.S('brief.workspace.selfNotEntered'));
  else {
    lines.push(`${B.S('brief.workspace.selfLead')}`
      + `${self.status === 'known' ? B.S('brief.workspace.selfComplete') : B.S('brief.workspace.selfPartial')}`
      + `${B.S('brief.workspace.selfMiddle')}${listZh(B, self.confirmed, cap)}`
      + `${self.possible.length === 0 ? '' : `${B.S('brief.workspace.possibleLead')}${listZh(B, self.possible, cap)}`}${moreZh(B, self.omitted)}`);
  }
  const unobservedTo = workspace.unobserved.to === null ? null : workspace.checkpoints[workspace.unobserved.to];
  lines.push(`${B.S('brief.workspace.unobservedLead')}${workspace.unobserved.previousEndedAt ?? B.S('brief.workspace.timeUnknown')}`
    + `${B.S('brief.workspace.unobservedMiddle')}`
    + `${unobservedTo === undefined || unobservedTo === null ? B.S('brief.workspace.thisStart') : `“${B.checkpoint[unobservedTo.kind]}”`}`
    + `${B.S('brief.workspace.unobservedAfter')}${B.S('brief.workspace.unobservedTail')}`);
  for (const segment of workspace.segments) {
    const from = workspace.checkpoints[segment.from];
    const to = workspace.checkpoints[segment.to];
    if (from === undefined || to === undefined) continue;
    const verdict = segment.verdict === 'changed' ? B.S('brief.workspace.verdictChanged')
      : segment.verdict === 'unchanged' ? B.S('brief.workspace.verdictUnchanged')
        : `${B.S('brief.workspace.verdictUnknownOpen')}${clip(B, segment.reason, cap)}）`;
    lines.push(`- ${B.checkpoint[from.kind]}${B.S('brief.workspace.segmentArrow')}${B.checkpoint[to.kind]}：${verdict}`);
  }
  const uncommitted = workspace.uncommitted;
  if (uncommitted.status === 'git') {
    lines.push(`${B.S('brief.workspace.uncommittedGitLead')}${uncommitted.baseCommit ?? B.S('brief.workspace.unknownCommit')}`
      + `${B.S('brief.workspace.uncommittedGitMiddle')}${listZh(B, uncommitted.paths, cap)}${moreZh(B, uncommitted.omitted)}`);
  } else if (uncommitted.status === 'not_git') {
    lines.push(B.S('brief.workspace.notGit'));
  } else {
    lines.push(`${B.S('brief.workspace.uncommittedUnknown')}${uncommitted.reason === null ? '' : `：${clip(B, uncommitted.reason, cap)}`}。`);
  }

  const accepted = brief.acceptedInputs;
  if (accepted.steers.length + accepted.steersOmitted + accepted.messages.length + accepted.messagesOmitted > 0) {
    section(B.S('brief.section.acceptedInputs'));
    for (const steer of accepted.steers) lines.push(`${B.S('brief.accepted.steerLead')}${steer.intentRef.intentId}：${t(steer.text)}`);
    if (accepted.steersOmitted > 0) {
      lines.push(`${B.S('brief.accepted.omittedLead')}${String(accepted.steersOmitted)}${B.S('brief.accepted.steersOmittedSuffix')}`);
    }
    for (const message of accepted.messages) {
      lines.push(`${B.S('brief.accepted.messageLead')}${message.messageRef.messageId}（`
        + `${message.part === 'message' ? B.S('brief.accepted.messageInbound') : B.S('brief.accepted.messageReply')}`
        + `）：${t(message.excerpt)}`);
    }
    if (accepted.messagesOmitted > 0) {
      lines.push(`${B.S('brief.accepted.omittedLead')}${String(accepted.messagesOmitted)}${B.S('brief.accepted.messagesOmittedSuffix')}`);
    }
  }
  return lines;
}

/**
 * Slice 1 §2.7: the `### 异常锚点` section. Empty without `anomalies`, so an
 * old brief renders byte-identically. Each carried anchor keeps its ref, cause,
 * the unknown/mixed-ownership warning where it applies and the fixed closing
 * sentence; only the path lists are clipped by `cap`. `pathLimit` is the number
 * of path lines that may still be written (spec §2.7 budgets them first under
 * the `renderedBytes` bound); every path line left out is counted once.
 */
function anomalyLinesZh(B: BriefTexts, brief: ContinuationBriefV1, cap: number, pathLimit: number): string[] {
  const section = brief.anomalies;
  if (section === undefined) return [];
  const lines: string[] = ['', B.S('brief.anomaly.title')];
  let pathLines = 0;
  let droppedPaths = 0;
  for (const anchor of section.anchors) {
    const files = anchor.changedFiles;
    lines.push(`${B.S('brief.anomaly.anchorLead')}${anchor.runRef.runId}${B.S('brief.anomaly.sessionOpen')}`
      + `${anchor.sessionRef.sessionId}${B.S('brief.anomaly.taskMiddle')}${anchor.task.taskId}`
      + `${B.S('brief.anomaly.reasonMiddle')}${B.anomalyCause[anchor.cause]}`
      + `${B.S('brief.anomaly.recordedAtMiddle')}${anchor.recordedAt}${B.S('brief.anomaly.anchorSuffix')}`);
    if (files.status === 'unavailable') {
      lines.push(`${B.S('brief.anomaly.filesUnavailableLead')}${files.reason === null ? '' : `（${clip(B, files.reason, cap)}）`}。`);
    } else if (files.status === 'not_entered') {
      lines.push(B.S('brief.anomaly.filesNotEntered'));
    } else if (pathLines < pathLimit) {
      pathLines += 1;
      lines.push(`${B.S('brief.anomaly.confirmedFilesLead')}${listZh(B, files.confirmed, cap)}`
        + `${files.possible.length === 0 ? '' : `${B.S('brief.workspace.possibleLead')}${listZh(B, files.possible, cap)}`}`
        + `${moreZh(B, files.omitted)}。`);
    } else {
      pathLines += 1;
      droppedPaths += 1;
    }
    if (files.source === 'worktree') lines.push(`${B.S('brief.anomaly.mixedLead')}${B.anomalyMixedOwnership}。`);
  }
  if (section.omitted > 0) {
    lines.push(`${B.S('brief.anomaly.omittedAnchorsLead')}${String(section.omitted)}${B.S('brief.anomaly.omittedAnchorsSuffix')}`);
  }
  if (droppedPaths > 0) {
    lines.push(`${B.S('brief.anomaly.omittedPathsLead')}${String(droppedPaths)}${B.S('brief.anomaly.omittedPathsSuffix')}`);
  }
  lines.push(B.anomalyLastSentence);
  return lines;
}

/** The number of optional path lines the anomaly section can render. */
function anomalyPathLineCount(section: ContinuationAnomalySectionV1): number {
  let count = 0;
  for (const anchor of section.anchors) {
    const status = anchor.changedFiles.status;
    if (status !== 'unavailable' && status !== 'not_entered') count += 1;
  }
  return count;
}

// ------------------------------------------------------------------------ //
// K3 L20: unknown-call review section                                       //
// ------------------------------------------------------------------------ //
/** One non-required conclusion line per item (`#n = <callId>（<工具名>）：…`; D8: the callId appears only here). */
function reviewItemConclusionZh(B: BriefTexts, item: ContinuationUnknownCallReviewItemV1, cap: number): string {
  const parts = [B.reviewVerdict[item.verdict] ?? item.verdict];
  if (item.evidence !== null) parts.push(`${B.S('brief.review.evidencePrefix')}${boundedZh(B, item.evidence, cap)}`);
  if (item.crashSuspicion !== null) {
    const suspicion = item.crashSuspicion.verdict === 'unlikely' ? B.S('brief.review.crash.unlikely')
      : item.crashSuspicion.verdict === 'possible' ? B.S('brief.review.crash.possible') : B.S('brief.review.crash.unknown');
    parts.push(`${B.S('brief.review.crashPrefix')}${suspicion}（${clip(B, item.crashSuspicion.evidence, cap)}）`);
  }
  if (item.reviewerConclusion !== null) {
    parts.push(`${B.S('brief.review.reviewerPrefix')}${boundedZh(B, item.reviewerConclusion, cap)}`);
  }
  return `- #${String(item.alias)} = ${clip(B, item.callId, cap)}（${clip(B, item.toolName, cap)}）`
    + `${B.S('brief.review.conclusionMiddle')}${parts.join(B.S('brief.separator.semicolon'))}`;
}
function reviewFileLinesZh(B: BriefTexts, file: ContinuationUnknownCallReviewFileV1, cap: number): string[] {
  const lines = [`${B.S('brief.review.fileLead')}${clip(B, file.path, cap)}（${B.reviewMode[file.mode]}`
    + `${B.S('brief.review.fileChangeMiddle')}${B.reviewChange[file.change]}。`];
  if (file.oldText !== null) lines.push(`${B.S('brief.review.oldText')}${boundedZh(B, file.oldText, cap)}`);
  if (file.newText !== null) lines.push(`${B.S('brief.review.newText')}${boundedZh(B, file.newText, cap)}`);
  if (file.diff !== null) lines.push(`${B.S('brief.review.diff')}${boundedZh(B, file.diff, cap)}`);
  else if (file.diffOmittedReason !== null) {
    lines.push(`${B.S('brief.review.diffOmitted')}${B.reviewDiffReason[file.diffOmittedReason]}。`);
  }
  return lines;
}
/** The non-required lines of the review section, in render order (never the fixed lines). */
function unknownCallReviewOptionalLinesZh(B: BriefTexts, section: ContinuationUnknownCallReviewV1, cap: number): string[] {
  const lines: string[] = [];
  for (const item of section.items) {
    lines.push(reviewItemConclusionZh(B, item, cap));
    for (const file of item.files) lines.push(...reviewFileLinesZh(B, file, cap));
  }
  // K3 L18: annotations are optional lines after the per-item conclusions. The
  // ② owner already turned the answer object into `null` (the record) or a path.
  for (const annotation of section.disposition?.annotations ?? []) {
    lines.push(`${B.S('brief.review.annotationLead')}`
      + `${annotation.path === null ? B.S('brief.review.annotationRecord') : clip(B, annotation.path, cap)}`
      + `${B.S('brief.review.annotationMiddle')}${clip(B, annotation.text, cap)}`);
  }
  return lines;
}
function unknownCallReviewOptionalLineCount(section: ContinuationUnknownCallReviewV1): number {
  let count = section.disposition?.annotations.length ?? 0;
  for (const item of section.items) {
    count += 1;
    for (const file of item.files) {
      count += 1 + (file.oldText === null ? 0 : 1) + (file.newText === null ? 0 : 1)
        + (file.diff !== null || file.diffOmittedReason !== null ? 1 : 0);
    }
  }
  return count;
}
/**
 * K3 L20: the approved-method lines (`approvedMethodLinesZh`). ONE pure
 * function shared by the WorkGraph owner's byte-budget measurement and the
 * renderer: the alias comes from the item's position in the record, so what is
 * measured at write time is exactly what the continuation will say. A command's
 * or a cwd's `\r\n`/`\n` becomes `\n` plus two spaces (the `clip` indentation,
 * L20: both the command and cwd), and the methods are joined with `\n`; nothing
 * is clipped or omitted.
 */
export function approvedMethodLinesZh(
  methods: ReadonlyArray<{ alias: number; command: string; cwd: string | null }>,
  texts: PromptTextsV1 = DEFAULT_TEXTS,
): string[] {
  return approvedMethodLinesWith(briefTexts(texts), methods);
}
function approvedMethodLinesWith(
  B: BriefTexts,
  methods: ReadonlyArray<{ alias: number; command: string; cwd: string | null }>,
): string[] {
  const indent = B.S('brief.approved.newlineIndent') ?? '';
  return methods.map(method =>
    `${B.S('brief.approved.lead')}${String(method.alias)}${B.S('brief.approved.cwdLead')}`
    + `${(method.cwd ?? '.').replace(/\r\n|\n/g, indent)}${B.S('brief.approved.afterCwd')}`
    + `${indent}${method.command.replace(/\r\n|\n/g, indent)}`);
}

/**
 * K3 L20 and lead ruling 5: the review section. The title, the count line, the
 * one-line disposition, the always-present targets line (it reads `无` when
 * there are none), the platform line when it names any, and the fixed sentence
 * are mandatory; the per-item detail (conclusion, evidence, `reviewerConclusion`,
 * excerpts and diffs) and the annotations are bounded by `optionalLimit` and
 * left out by the caller without dropping a mandatory line. The approved-method
 * block sits between the targets and platform lines and is mandatory too (never
 * shortened or omitted); B3 adds the blocked-command sentence after the fixed
 * sentence, which is not built here.
 */
function unknownCallReviewLinesZh(B: BriefTexts, brief: ContinuationBriefV1, cap: number, optionalLimit: number): string[] {
  const section = brief.unknownCallReview ?? null;
  if (section === null) return [];
  const count = section.items.length;
  const lines: string[] = ['', B.reviewTitle,
    `${B.S('brief.review.countLead')}${String(count)}${B.S('brief.review.countMiddle')}${String(count)}`
    + `${B.S('brief.review.countOmittedLead')}${String(section.itemsOmitted)}${B.S('brief.review.countOmittedSuffix')}`
    + B.S('brief.review.countNote')];
  lines.push(...unknownCallReviewOptionalLinesZh(B, section, cap).slice(0, Math.max(0, optionalLimit)));
  const disposition = section.disposition;
  const option = disposition === null
    ? B.noDisposition
    : B.disposition[disposition.choice];
  const source = disposition === null
    ? B.autoSource
    : B.reviewSource[disposition.source];
  // L20: ONE line; the 附言 is clipped to 60 UTF-16 units by `clip`, not RENDER_TEXT_CAPS.
  const note = disposition === null || disposition.text === null || disposition.text.text.length === 0
    ? '' : `${B.S('brief.review.noteLead')}${clip(B, disposition.text.text, 60)}`;
  lines.push(`${B.S('brief.review.dispositionLead')}${option}（${source}）${note}。`);
  // Lead ruling 5: the targets line is ALWAYS present; with no targets (settled
  // by itself or an empty set) it reads exactly `无`. The platform line below
  // stays present only when it names any.
  const targets = disposition === null ? [] : disposition.targets;
  lines.push(targets.length === 0
    ? B.S('brief.review.targetsNone')
    : `${B.S('brief.review.targetsLead')}${targets.map(alias => `#${String(alias)}`).join(B.S('brief.list.separator'))}。`);
  // L20: the approved methods are part of the mandatory block: every line is
  // written whole, between the targets line and the platform line. No approved
  // methods means no bytes change (an absent/empty array renders nothing).
  if (disposition !== null && disposition.approvedMethods.length > 0) {
    lines.push(...approvedMethodLinesWith(B, disposition.approvedMethods));
  }
  if (disposition !== null && disposition.platformTargets.length > 0) {
    lines.push(`${B.S('brief.review.platformLead')}`
      + `${disposition.platformTargets.map(alias => `#${String(alias)}`).join(B.S('brief.list.separator'))}`
      + B.S('brief.review.platformSuffix'));
  }
  lines.push(B.reviewNotListed);
  // K3 B3 item 6: the required signal, present exactly when this record blocked
  // at least one original command. No blocked commands renders no new bytes.
  if (section.blockedCommands !== undefined && section.blockedCommands.length > 0) {
    lines.push(B.reviewBlocked);
  }
  return lines;
}

/**
 * Slice 1 §2.7: `renderContinuationBriefZh` refuses `capacity` when even the
 * mandatory part of the anomaly section cannot fit in `renderedBytes`, instead
 * of silently dropping the section. The preparation owner maps this to a
 * `capacity` rejection.
 */
export class ContinuationBriefCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContinuationBriefCapacityError';
  }
}

function endingZh(B: BriefTexts, brief: ContinuationBriefV1): string {  const previous = brief.previous;
  // `factsFrom.hops > 0` only when the previous Run itself never entered the Kernel.
  if (brief.stoppedAt.kernel === 'not_entered' || brief.factsFrom.hops > 0) {
    return `${B.S('brief.ending.notEnteredLead')}${previous.outcome}）`;
  }
  if (previous.outcome === 'cancelled' && brief.stoppedAt.reason === 'cancelled_at_reconcile') {
    return B.S('brief.ending.cancelledAtReconcile');
  }
  if (previous.outcome === 'cancelled' && brief.stoppedAt.reason === 'cancelled_while_paused') {
    return B.S('brief.ending.cancelledWhilePaused');
  }
  switch (previous.origin) {
    case 'observed':
      return `${B.S('brief.ending.observedLead')}${previous.outcome}${B.S('brief.ending.observedSuffix')}`;
    case 'host_interrupted':
      return `${B.S('brief.ending.hostInterruptedLead')}${previous.outcome}`;
    case 'human_attested':
      return `${B.S('brief.ending.humanAttestedLead')}${previous.outcome}`;
  }
}

function continuityZh(B: BriefTexts, session: ContinuationBriefV1['session']): string {
  const here = `${B.S('brief.continuity.sessionPrefix')}${session.sessionRef.sessionId}`;
  switch (session.continuity) {
    case 'same_session_history':
      return `${B.S('brief.continuity.sameHistoryLead')}${here}${B.S('brief.continuity.sameHistorySuffix')}`;
    case 'same_session_without_previous_turn':
      return `${B.S('brief.continuity.sameHistoryLead')}${here}${B.S('brief.continuity.sameWithoutTurnSuffix')}`;
    case 'other_session_seeded': {
      const seeded = session.seededFrom;
      const from = seeded === null ? B.S('brief.continuity.before') : `${B.S('brief.continuity.sessionPrefix')}${seeded.sessionRef.sessionId}`
        + `${seeded.throughPosition === null ? '' : `${B.S('brief.continuity.throughPosition')}${String(seeded.throughPosition)}`}`;
      return `${B.S('brief.continuity.otherLead')}${here}${B.S('brief.continuity.seededMiddle')}${from}${B.S('brief.continuity.seededSuffix')}`;
    }
    case 'other_session':
      return `${B.S('brief.continuity.otherLead')}${here}${B.S('brief.continuity.otherSuffix')}`;
  }
}

function toolCallZh(B: BriefTexts, call: ContinuationToolCallV1, cap: number): string {
  const parts = [`${call.name}${B.S('brief.toolCall.openCallId')}${call.callId}${B.S('brief.toolCall.beforeResult')}`
    + `${B.toolResult[call.result]}`];
  if (call.sideEffect !== null) parts.push(B.sideEffect[call.sideEffect]);
  if (call.target !== null) parts.push(`${B.S('brief.toolCall.targetLead')}${boundedZh(B, call.target, cap)}`);
  if (call.changedPaths.length > 0 || call.changedPathsOmitted > 0) {
    parts.push(`${B.S('brief.toolCall.changedLead')}${listZh(B, call.changedPaths, cap)}${moreZh(B, call.changedPathsOmitted)}`);
  }
  if (call.error !== null) parts.push(`${B.S('brief.toolCall.errorLead')}${boundedZh(B, call.error, cap)}`);
  return parts.join(B.S('brief.separator.semicolon'));
}

// ------------------------------------------------------------------------ //
// Shape validator (used by the manifest codec)                              //
// ------------------------------------------------------------------------ //
type Obj = Record<string, unknown>;
type Problem = string | null;
const LIMITS = CONTINUATION_BRIEF_LIMITS;
const ACTOR_CLASSES: readonly ReworkActorClass[] = ['human', 'system', 'agent'];
const STOP_REQUESTERS: readonly StopRequester[] = ['human', 'goal_fan_out', 'system', 'none'];
const KNOWN_OUTCOMES: readonly string[] = ['completed', 'failed', 'cancelled', 'budget_exhausted', 'crashed', 'yielded'];
const ORIGINS: readonly RunFailureOrigin[] = ['observed', 'host_interrupted', 'human_attested'];
const MESSAGE_STATUSES: readonly string[] = ['pending', 'read', 'responded'];
const TURN_STATUSES: readonly string[] = ['completed', 'failed', 'cancelled', 'limit_exceeded', 'yielded', 'paused', 'running', 'interrupted'];
const TOOL_RESULTS: readonly string[] = ['success', 'error', 'cancelled', 'not_started', 'outcome_unknown'];
const SIDE_EFFECTS: readonly string[] = ['none', 'possible', 'confirmed'];
const CHECK_PHASES: readonly string[] = ['pending', 'executing', 'finished', 'interrupted'];
const SOURCE_REF_KINDS: readonly string[] = ['plan-revision', 'workspace', 'governance', 'artifact', 'memory'];
const CONTINUITIES: readonly ContinuationSessionContinuity[] = [
  'same_session_history', 'same_session_without_previous_turn', 'other_session_seeded', 'other_session',
];

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** The object with exactly `keys` (all required) plus `optional` keys, or the problem. */
function exact(value: unknown, path: string, keys: readonly string[], optional: readonly string[] = []): Obj | string {
  if (!isObj(value)) return `${path} must be an object`;
  for (const key of Object.keys(value)) {
    if (!keys.includes(key) && !optional.includes(key)) return `${path} carries unknown field ${key}`;
  }
  for (const key of keys) if (!Object.hasOwn(value, key)) return `${path}.${key} is required`;
  return value;
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function isSha256(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
function inList(value: unknown, allowed: readonly string[], path: string): Problem {
  return typeof value === 'string' && allowed.includes(value) ? null : `${path} must be one of ${allowed.join('|')}`;
}
function nullableString(value: unknown, path: string): Problem {
  return value === null || typeof value === 'string' ? null : `${path} must be a string or null`;
}
function nullableCount(value: unknown, path: string): Problem {
  return value === null || isCount(value) ? null : `${path} must be a non-negative safe integer or null`;
}
function boolean(value: unknown, path: string): Problem {
  return typeof value === 'boolean' ? null : `${path} must be a boolean`;
}
function count(value: unknown, path: string): Problem {
  return isCount(value) ? null : `${path} must be a non-negative safe integer`;
}
function list(value: unknown, path: string, max: number | null, item: (entry: unknown, path: string) => Problem): Problem {
  if (!Array.isArray(value)) return `${path} must be an array`;
  if (max !== null && value.length > max) return `${path} holds more than ${max} entries`;
  for (const [index, entry] of value.entries()) {
    const problem = item(entry, `${path}[${index}]`);
    if (problem !== null) return problem;
  }
  return null;
}
function pathList(value: unknown, path: string, max: number): Problem {
  return list(value, path, max, (entry, at) => (nonEmpty(entry) ? null : `${at} must be a non-empty string`));
}
function boundedText(value: unknown, path: string): Problem {
  const text = exact(value, path, ['text', 'truncated']);
  if (typeof text === 'string') return text;
  if (typeof text['text'] !== 'string') return `${path}.text must be a string`;
  if (text['text'].length > LIMITS.textChars) return `${path}.text exceeds ${LIMITS.textChars} characters`;
  return boolean(text['truncated'], `${path}.truncated`);
}
function nullableBoundedText(value: unknown, path: string): Problem {
  return value === null ? null : boundedText(value, path);
}
function ref(value: unknown, path: string, aggregateType: string | null, fields: readonly string[]): Problem {
  const keys = aggregateType === null ? fields : ['aggregateType', ...fields];
  const record = exact(value, path, keys);
  if (typeof record === 'string') return record;
  if (aggregateType !== null && record['aggregateType'] !== aggregateType) return `${path}.aggregateType must be ${aggregateType}`;
  for (const field of fields) if (!nonEmpty(record[field])) return `${path}.${field} must be a non-empty string`;
  return null;
}
const runRef = (value: unknown, path: string): Problem => ref(value, path, 'Run', ['projectId', 'goalId', 'runId']);
const attemptRef = (value: unknown, path: string): Problem =>
  ref(value, path, 'TaskAttempt', ['projectId', 'goalId', 'taskId', 'attemptId']);
const taskTriple = (value: unknown, path: string): Problem => ref(value, path, null, ['projectId', 'goalId', 'taskId']);
const requeueRef = (value: unknown, path: string): Problem =>
  ref(value, path, 'TaskRequeue', ['projectId', 'goalId', 'taskId', 'afterRunId']);
const sessionRef = (value: unknown, path: string): Problem => ref(value, path, null, ['projectId', 'sessionId']);
const messageRef = (value: unknown, path: string): Problem =>
  ref(value, path, 'SessionMessage', ['projectId', 'workspaceId', 'messageId']);
const intentRef = (value: unknown, path: string): Problem =>
  ref(value, path, 'ControlIntent', ['projectId', 'workspaceId', 'intentId']);
const roundRef = (value: unknown, path: string): Problem =>
  ref(value, path, 'VerificationRound', ['projectId', 'workspaceId', 'goalId', 'taskId', 'runId', 'roundId']);
function artifactRef(value: unknown, path: string): Problem {
  const artifact = exact(value, path, ['kind', 'contentType', 'digest', 'sizeBytes', 'source']);
  if (typeof artifact === 'string') return artifact;
  if (artifact['kind'] !== 'artifact') return `${path}.kind must be artifact`;
  if (!nonEmpty(artifact['contentType'])) return `${path}.contentType must be a non-empty string`;
  if (!isSha256(artifact['digest'])) return `${path}.digest must be a sha256 hex`;
  if (!isCount(artifact['sizeBytes'])) return `${path}.sizeBytes must be a non-negative safe integer`;
  const source = artifact['source'];
  if (!isObj(source)) return `${path}.source must be an object`;
  for (const key of Object.keys(source)) {
    if (!['kind', 'refId', 'revision', 'digest'].includes(key)) return `${path}.source carries unknown field ${key}`;
  }
  return inList(source['kind'], SOURCE_REF_KINDS, `${path}.source.kind`)
    ?? (nonEmpty(source['refId']) ? null : `${path}.source.refId must be a non-empty string`)
    ?? (typeof source['revision'] === 'string' ? null : `${path}.source.revision must be a string`)
    ?? (source['digest'] === undefined || typeof source['digest'] === 'string' ? null : `${path}.source.digest must be a string`);
}

const BRIEF_KEYS = [
  'schemaVersion', 'runRef', 'task', 'requeueRef', 'mode', 'failureClass', 'trigger', 'previous', 'factsFrom',
  'stoppedAt', 'toolCalls', 'acceptedInputs', 'checks', 'requeue', 'workspace', 'session', 'standingInstructionVersion',
] as const;

/** Null when `value` is a well-formed `ContinuationBriefV1`; otherwise the first problem. */
export function continuationBriefShapeProblem(value: unknown): string | null {
  const brief = exact(value, 'continuationBrief', BRIEF_KEYS, ['anomalies', 'unknownCallReview', 'blockedCommands']);
  if (typeof brief === 'string') return brief;
  if (brief['schemaVersion'] !== 1) return 'continuationBrief.schemaVersion must be 1';
  if (brief['standingInstructionVersion'] !== 1) return 'continuationBrief.standingInstructionVersion must be 1';
  const shape = runRef(brief['runRef'], 'continuationBrief.runRef')
    ?? taskTriple(brief['task'], 'continuationBrief.task')
    ?? requeueRef(brief['requeueRef'], 'continuationBrief.requeueRef')
    ?? inList(brief['mode'], ['rework', 'resume_after_interruption'], 'continuationBrief.mode')
    ?? inList(brief['failureClass'], REWORK_FAILURE_CLASSES, 'continuationBrief.failureClass')
    ?? triggerProblem(brief['trigger'])
    ?? previousProblem(brief['previous'])
    ?? factsFromProblem(brief['factsFrom'])
    ?? stoppedAtProblem(brief['stoppedAt'])
    ?? toolCallsProblem(brief['toolCalls'])
    ?? acceptedInputsProblem(brief['acceptedInputs'])
    ?? checksProblem(brief['checks'])
    ?? requeueProblem(brief['requeue'])
    ?? workspaceProblem(brief['workspace'])
    ?? sessionProblem(brief['session'])
    ?? anomaliesProblem(brief['anomalies'])
    ?? unknownCallReviewProblem(brief['unknownCallReview'])
    ?? blockedCommandsProblem(brief['blockedCommands']);
  if (shape !== null) return shape;
  if ((brief['failureClass'] === 'interrupted') !== (brief['mode'] === 'resume_after_interruption')) {
    return 'continuationBrief.mode must be resume_after_interruption exactly when failureClass is interrupted';
  }
  return null;
}

function triggerProblem(value: unknown): Problem {
  const path = 'continuationBrief.trigger';
  const trigger = exact(value, path, ['actorClass', 'goalResume', 'requeueNumber', 'autoRework', 'earlierRequeues']);
  if (typeof trigger === 'string') return trigger;
  return inList(trigger['actorClass'], ACTOR_CLASSES, `${path}.actorClass`)
    ?? boolean(trigger['goalResume'], `${path}.goalResume`)
    ?? (Number.isSafeInteger(trigger['requeueNumber']) && (trigger['requeueNumber'] as number) >= 1
      ? null : `${path}.requeueNumber must be a positive safe integer`)
    ?? (trigger['autoRework'] === null ? null : autoReworkProblem(trigger['autoRework'], `${path}.autoRework`))
    ?? list(trigger['earlierRequeues'], `${path}.earlierRequeues`, LIMITS.earlierRequeues, (entry, at) => {
      const earlier = exact(entry, at, ['afterRunId', 'failureClass']);
      if (typeof earlier === 'string') return earlier;
      return (nonEmpty(earlier['afterRunId']) ? null : `${at}.afterRunId must be a non-empty string`)
        ?? inList(earlier['failureClass'], REWORK_FAILURE_CLASSES, `${at}.failureClass`);
    });
}
function autoReworkProblem(value: unknown, path: string): Problem {
  const auto = exact(value, path, ['count', 'cap']);
  if (typeof auto === 'string') return auto;
  return count(auto['count'], `${path}.count`) ?? count(auto['cap'], `${path}.cap`);
}

function previousProblem(value: unknown): Problem {
  const path = 'continuationBrief.previous';
  const previous = exact(value, path, [
    'runRef', 'attemptRef', 'sessionRef', 'outcome', 'origin', 'interruption', 'cancelledBy', 'error', 'limit',
    'budget', 'wait', 'unacceptedSteers', 'endedAt',
  ]);
  if (typeof previous === 'string') return previous;
  return runRef(previous['runRef'], `${path}.runRef`)
    ?? attemptRef(previous['attemptRef'], `${path}.attemptRef`)
    ?? sessionRef(previous['sessionRef'], `${path}.sessionRef`)
    ?? inList(previous['outcome'], KNOWN_OUTCOMES, `${path}.outcome`)
    ?? inList(previous['origin'], ORIGINS, `${path}.origin`)
    ?? (previous['interruption'] === null ? null : interruptionProblem(previous['interruption'], `${path}.interruption`))
    ?? (previous['cancelledBy'] === null ? null
      : inList(previous['cancelledBy'], STOP_REQUESTERS.filter((requester) => requester !== 'none'), `${path}.cancelledBy`))
    ?? nullableBoundedText(previous['error'], `${path}.error`)
    ?? (previous['limit'] === null ? null : limitProblem(previous['limit'], `${path}.limit`))
    ?? (previous['budget'] === null ? null : budgetProblem(previous['budget'], `${path}.budget`))
    ?? (previous['wait'] === null ? null : waitProblem(previous['wait'], `${path}.wait`))
    ?? list(previous['unacceptedSteers'], `${path}.unacceptedSteers`, null, steerProblem)
    ?? nullableString(previous['endedAt'], `${path}.endedAt`);
}
function interruptionProblem(value: unknown, path: string): Problem {
  const interruption = exact(value, path, ['kind', 'kernelPaused', 'pausedBy']);
  if (typeof interruption === 'string') return interruption;
  return inList(interruption['kind'], ['executing', 'paused'], `${path}.kind`)
    ?? boolean(interruption['kernelPaused'], `${path}.kernelPaused`)
    ?? (interruption['pausedBy'] === null ? null : inList(interruption['pausedBy'], STOP_REQUESTERS, `${path}.pausedBy`));
}
function limitProblem(value: unknown, path: string): Problem {
  const limit = exact(value, path, ['kind', 'observed', 'allowed']);
  if (typeof limit === 'string') return limit;
  return (nonEmpty(limit['kind']) ? null : `${path}.kind must be a non-empty string`)
    ?? count(limit['observed'], `${path}.observed`) ?? count(limit['allowed'], `${path}.allowed`);
}
function budgetProblem(value: unknown, path: string): Problem {
  const budget = exact(value, path, ['previousTokenBudget', 'currentTokenBudget']);
  if (typeof budget === 'string') return budget;
  return count(budget['previousTokenBudget'], `${path}.previousTokenBudget`)
    ?? count(budget['currentTokenBudget'], `${path}.currentTokenBudget`);
}
function waitProblem(value: unknown, path: string): Problem {
  const wait = exact(value, path, ['messageRef', 'status']);
  if (typeof wait === 'string') return wait;
  return messageRef(wait['messageRef'], `${path}.messageRef`) ?? inList(wait['status'], MESSAGE_STATUSES, `${path}.status`);
}
function steerProblem(value: unknown, path: string): Problem {
  const steer = exact(value, path, ['intentRef', 'text']);
  if (typeof steer === 'string') return steer;
  return intentRef(steer['intentRef'], `${path}.intentRef`) ?? boundedText(steer['text'], `${path}.text`);
}

function factsFromProblem(value: unknown): Problem {
  const path = 'continuationBrief.factsFrom';
  const factsFrom = exact(value, path, ['runRef', 'hops', 'truncated']);
  if (typeof factsFrom === 'string') return factsFrom;
  return runRef(factsFrom['runRef'], `${path}.runRef`)
    ?? (isCount(factsFrom['hops']) && factsFrom['hops'] <= LIMITS.factsFromHops
      ? null : `${path}.hops must be an integer 0..${LIMITS.factsFromHops}`)
    ?? boolean(factsFrom['truncated'], `${path}.truncated`);
}

function stoppedAtProblem(value: unknown): Problem {
  const path = 'continuationBrief.stoppedAt';
  const stoppedAt = exact(value, path, ['kernel', 'reason', 'turnStatus', 'lastPosition', 'lastToolGroup', 'lastAssistant', 'window']);
  if (typeof stoppedAt === 'string') return stoppedAt;
  return inList(stoppedAt['kernel'], ['read', 'not_entered', 'unavailable'], `${path}.kernel`)
    ?? nullableString(stoppedAt['reason'], `${path}.reason`)
    ?? (stoppedAt['turnStatus'] === null ? null : inList(stoppedAt['turnStatus'], TURN_STATUSES, `${path}.turnStatus`))
    ?? nullableCount(stoppedAt['lastPosition'], `${path}.lastPosition`)
    ?? (stoppedAt['lastToolGroup'] === null ? null : toolGroupProblem(stoppedAt['lastToolGroup'], `${path}.lastToolGroup`))
    ?? nullableBoundedText(stoppedAt['lastAssistant'], `${path}.lastAssistant`)
    ?? (stoppedAt['window'] === null ? null : windowProblem(stoppedAt['window'], `${path}.window`));
}
function toolGroupProblem(value: unknown, path: string): Problem {
  const group = exact(value, path, ['sourceMessageId', 'calls']);
  if (typeof group === 'string') return group;
  return (nonEmpty(group['sourceMessageId']) ? null : `${path}.sourceMessageId must be a non-empty string`)
    ?? count(group['calls'], `${path}.calls`);
}
function windowProblem(value: unknown, path: string): Problem {
  const window = exact(value, path, ['fromPosition', 'throughPosition', 'omittedRecords']);
  if (typeof window === 'string') return window;
  const shape = count(window['fromPosition'], `${path}.fromPosition`)
    ?? count(window['throughPosition'], `${path}.throughPosition`)
    ?? count(window['omittedRecords'], `${path}.omittedRecords`);
  if (shape !== null) return shape;
  return (window['fromPosition'] as number) <= (window['throughPosition'] as number)
    ? null : `${path}.fromPosition must not exceed throughPosition`;
}

function toolCallsProblem(value: unknown): Problem {
  const path = 'continuationBrief.toolCalls';
  const calls = exact(value, path, ['confirmed', 'notExecuted', 'unknown', 'confirmedOmitted', 'notExecutedOmitted', 'unknownOmitted']);
  if (typeof calls === 'string') return calls;
  return list(calls['confirmed'], `${path}.confirmed`, LIMITS.confirmedToolCalls, toolCallProblem)
    ?? list(calls['notExecuted'], `${path}.notExecuted`, LIMITS.notExecutedToolCalls, toolCallProblem)
    ?? list(calls['unknown'], `${path}.unknown`, LIMITS.unknownToolCalls, toolCallProblem)
    ?? count(calls['confirmedOmitted'], `${path}.confirmedOmitted`)
    ?? count(calls['notExecutedOmitted'], `${path}.notExecutedOmitted`)
    ?? count(calls['unknownOmitted'], `${path}.unknownOmitted`);
}
function toolCallProblem(value: unknown, path: string): Problem {
  const call = exact(value, path, ['callId', 'name', 'target', 'result', 'sideEffect', 'changedPaths', 'changedPathsOmitted', 'error']);
  if (typeof call === 'string') return call;
  return (nonEmpty(call['callId']) ? null : `${path}.callId must be a non-empty string`)
    ?? (nonEmpty(call['name']) ? null : `${path}.name must be a non-empty string`)
    ?? nullableBoundedText(call['target'], `${path}.target`)
    ?? inList(call['result'], TOOL_RESULTS, `${path}.result`)
    ?? (call['sideEffect'] === null ? null : inList(call['sideEffect'], SIDE_EFFECTS, `${path}.sideEffect`))
    ?? pathList(call['changedPaths'], `${path}.changedPaths`, LIMITS.pathsPerCall)
    ?? count(call['changedPathsOmitted'], `${path}.changedPathsOmitted`)
    ?? nullableBoundedText(call['error'], `${path}.error`);
}

function acceptedInputsProblem(value: unknown): Problem {
  const path = 'continuationBrief.acceptedInputs';
  const inputs = exact(value, path, ['steers', 'steersOmitted', 'messages', 'messagesOmitted']);
  if (typeof inputs === 'string') return inputs;
  return list(inputs['steers'], `${path}.steers`, null, steerProblem)
    ?? count(inputs['steersOmitted'], `${path}.steersOmitted`)
    ?? list(inputs['messages'], `${path}.messages`, null, (entry, at) => {
      const message = exact(entry, at, ['messageRef', 'part', 'excerpt']);
      if (typeof message === 'string') return message;
      return messageRef(message['messageRef'], `${at}.messageRef`)
        ?? inList(message['part'], ['message', 'response'], `${at}.part`)
        ?? boundedText(message['excerpt'], `${at}.excerpt`);
    })
    ?? count(inputs['messagesOmitted'], `${path}.messagesOmitted`);
}

function checksProblem(value: unknown): Problem {
  if (value === null) return null;
  const path = 'continuationBrief.checks';
  const checks = exact(value, path, ['roundRef', 'roundOrdinal', 'failing', 'gapCodes']);
  if (typeof checks === 'string') return checks;
  return roundRef(checks['roundRef'], `${path}.roundRef`)
    ?? (Number.isSafeInteger(checks['roundOrdinal']) && (checks['roundOrdinal'] as number) >= 1
      ? null : `${path}.roundOrdinal must be a positive safe integer`)
    ?? list(checks['failing'], `${path}.failing`, null, failingCheckProblem)
    ?? list(checks['gapCodes'], `${path}.gapCodes`, null, (entry, at) => (nonEmpty(entry) ? null : `${at} must be a non-empty string`));
}
function failingCheckProblem(value: unknown, path: string): Problem {
  const check = exact(value, path, ['checkId', 'phase', 'outcome', 'cause', 'reportRef']);
  if (typeof check === 'string') return check;
  return (nonEmpty(check['checkId']) ? null : `${path}.checkId must be a non-empty string`)
    ?? inList(check['phase'], CHECK_PHASES, `${path}.phase`)
    ?? (check['outcome'] === null ? null : inList(check['outcome'], EVIDENCE_OUTCOMES, `${path}.outcome`))
    ?? (check['cause'] === null ? null : inList(check['cause'], ROUND_CHECK_INCOMPLETE_CAUSES, `${path}.cause`))
    ?? (check['reportRef'] === null ? null : artifactRef(check['reportRef'], `${path}.reportRef`));
}

function requeueProblem(value: unknown): Problem {
  const path = 'continuationBrief.requeue';
  const requeue = exact(value, path, ['reason', 'reasonAuthor', 'newInputs']);
  if (typeof requeue === 'string') return requeue;
  return boundedText(requeue['reason'], `${path}.reason`)
    ?? inList(requeue['reasonAuthor'], ACTOR_CLASSES, `${path}.reasonAuthor`)
    ?? list(requeue['newInputs'], `${path}.newInputs`, LIMITS.newInputs, newInputProblem);
}
function newInputProblem(value: unknown, path: string): Problem {
  if (!isObj(value)) return `${path} must be an object`;
  if (value['kind'] === 'session_message') {
    const input = exact(value, path, ['kind', 'ref', 'replyBody']);
    if (typeof input === 'string') return input;
    return messageRef(input['ref'], `${path}.ref`) ?? nullableBoundedText(input['replyBody'], `${path}.replyBody`);
  }
  if (value['kind'] === 'artifact') {
    const input = exact(value, path, ['kind', 'ref', 'body']);
    if (typeof input === 'string') return input;
    return artifactRef(input['ref'], `${path}.ref`) ?? nullableBoundedText(input['body'], `${path}.body`);
  }
  return `${path}.kind must be session_message or artifact`;
}

function workspaceProblem(value: unknown): Problem {
  const path = 'continuationBrief.workspace';
  const workspace = exact(value, path, ['selfChanged', 'checkpoints', 'segments', 'unobserved', 'uncommitted']);
  if (typeof workspace === 'string') return workspace;
  const checkpoints = workspace['checkpoints'];
  const shape = selfChangedProblem(workspace['selfChanged'], `${path}.selfChanged`)
    ?? list(checkpoints, `${path}.checkpoints`, null, checkpointProblem)
    ?? uncommittedProblem(workspace['uncommitted'], `${path}.uncommitted`);
  if (shape !== null) return shape;
  const checkpointCount = (checkpoints as unknown[]).length;
  const isIndex = (index: unknown): boolean => isCount(index) && index < checkpointCount;
  return list(workspace['segments'], `${path}.segments`, null, (entry, at) => {
    const segment = exact(entry, at, ['from', 'to', 'verdict', 'reason']);
    if (typeof segment === 'string') return segment;
    return (isIndex(segment['from']) && isIndex(segment['to']) ? null : `${at}.from/to must be checkpoint indexes`)
      ?? inList(segment['verdict'], ['changed', 'unchanged', 'unknown'], `${at}.verdict`)
      ?? (typeof segment['reason'] === 'string' ? null : `${at}.reason must be a string`);
  }) ?? unobservedProblem(workspace['unobserved'], `${path}.unobserved`, isIndex);
}
function selfChangedProblem(value: unknown, path: string): Problem {
  const changed = exact(value, path, ['status', 'confirmed', 'possible', 'omitted']);
  if (typeof changed === 'string') return changed;
  const shape = inList(changed['status'], ['known', 'partial', 'not_entered', 'unavailable'], `${path}.status`)
    ?? pathList(changed['confirmed'], `${path}.confirmed`, LIMITS.paths)
    ?? pathList(changed['possible'], `${path}.possible`, LIMITS.paths)
    ?? count(changed['omitted'], `${path}.omitted`);
  if (shape !== null) return shape;
  return (changed['confirmed'] as unknown[]).length + (changed['possible'] as unknown[]).length <= LIMITS.paths
    ? null : `${path} lists more than ${LIMITS.paths} paths`;
}
function checkpointProblem(value: unknown, path: string): Problem {
  const checkpoint = exact(value, path, ['kind', 'at', 'workspaceRevision', 'sourceDigest', 'unavailableReason']);
  if (typeof checkpoint === 'string') return checkpoint;
  return inList(checkpoint['kind'], ['round_open', 'requeue', 'brief'], `${path}.kind`)
    ?? (nonEmpty(checkpoint['at']) ? null : `${path}.at must be a non-empty string`)
    ?? nullableCount(checkpoint['workspaceRevision'], `${path}.workspaceRevision`)
    ?? (checkpoint['sourceDigest'] === null || isSha256(checkpoint['sourceDigest'])
      ? null : `${path}.sourceDigest must be a sha256 hex or null`)
    ?? nullableString(checkpoint['unavailableReason'], `${path}.unavailableReason`);
}
function unobservedProblem(value: unknown, path: string, isIndex: (index: unknown) => boolean): Problem {
  const unobserved = exact(value, path, ['from', 'to', 'previousEndedAt']);
  if (typeof unobserved === 'string') return unobserved;
  return (unobserved['from'] === 'previous_run_end' ? null : `${path}.from must be previous_run_end`)
    ?? (unobserved['to'] === null || isIndex(unobserved['to']) ? null : `${path}.to must be a checkpoint index or null`)
    ?? nullableString(unobserved['previousEndedAt'], `${path}.previousEndedAt`);
}
function uncommittedProblem(value: unknown, path: string): Problem {
  const uncommitted = exact(value, path, ['status', 'baseCommit', 'paths', 'omitted', 'reason']);
  if (typeof uncommitted === 'string') return uncommitted;
  return inList(uncommitted['status'], ['git', 'not_git', 'unavailable'], `${path}.status`)
    ?? nullableString(uncommitted['baseCommit'], `${path}.baseCommit`)
    ?? pathList(uncommitted['paths'], `${path}.paths`, LIMITS.paths)
    ?? count(uncommitted['omitted'], `${path}.omitted`)
    ?? nullableString(uncommitted['reason'], `${path}.reason`);
}

function sessionProblem(value: unknown): Problem {
  const path = 'continuationBrief.session';
  const session = exact(value, path, ['continuity', 'sessionRef', 'seededFrom', 'boundaryPosition']);
  if (typeof session === 'string') return session;
  return inList(session['continuity'], CONTINUITIES, `${path}.continuity`)
    ?? sessionRef(session['sessionRef'], `${path}.sessionRef`)
    ?? (session['seededFrom'] === null ? null : seededFromProblem(session['seededFrom'], `${path}.seededFrom`))
    ?? nullableCount(session['boundaryPosition'], `${path}.boundaryPosition`);
}
function seededFromProblem(value: unknown, path: string): Problem {
  const seeded = exact(value, path, ['sessionRef', 'throughPosition']);
  if (typeof seeded === 'string') return seeded;
  return sessionRef(seeded['sessionRef'], `${path}.sessionRef`)
    ?? nullableCount(seeded['throughPosition'], `${path}.throughPosition`);
}

// ------------------------------------------------------------------------ //
// Slice 1 §2.7: anomaly section shape                                       //
// ------------------------------------------------------------------------ //
const ANOMALY_SECTION_KEYS = ['anchors', 'omitted', 'instructionVersion'] as const;
const ANOMALY_ANCHOR_LIMIT = 8;
const ANOMALY_CAUSES: readonly string[] = ['archive_interrupted', 'retired_archive'];
const ARCHIVE_CHANGED_SOURCES: readonly string[] = ['kernel', 'worktree', 'unknown'];
const ARCHIVE_CHANGED_STATUSES: readonly string[] = ['known', 'partial', 'not_entered', 'unavailable'];

function recordRef(value: unknown, path: string): Problem {
  const result = exact(value, path, ['identityKey', 'fingerprint']);
  if (typeof result === 'string') return result;
  if (!nonEmpty(result['identityKey']) || !nonEmpty(result['fingerprint'])) return `${path} must name a real receipt`;
  return null;
}
function planRef(value: unknown, path: string): Problem {
  return ref(value, path, 'PlanRevision', ['projectId', 'planId']);
}
function roleRef(value: unknown, path: string): Problem {
  if (!isObj(value)) return `${path} must be an object`;
  if (value['kind'] === 'legacy_template') {
    const role = exact(value, path, ['kind', 'templateId', 'templateRevision']);
    if (typeof role === 'string') return role;
    return nonEmpty(role['templateId']) && nonEmpty(role['templateRevision'])
      ? null : `${path} legacy_template requires templateId and templateRevision`;
  }
  if (value['kind'] === 'role_spec') {
    const role = exact(value, path, ['kind', 'pin']);
    if (typeof role === 'string') return role;
    const pin = role['pin'];
    if (!isObj(pin)) return `${path}.pin must be an object`;
    const pinShape = exact(pin, `${path}.pin`, ['ref', 'digest']);
    if (typeof pinShape === 'string') return pinShape;
    if (!nonEmpty(pin['digest'])) return `${path}.pin.digest is required`;
    const reference = exact(pin['ref'], `${path}.pin.ref`, ['aggregateType', 'projectId', 'roleId', 'revision']);
    if (typeof reference === 'string') return reference;
    if (reference['aggregateType'] !== 'RoleSpecRevision' || !nonEmpty(reference['projectId'])
      || !nonEmpty(reference['roleId']) || !isCount(reference['revision']) || reference['revision'] < 1) {
      return `${path}.pin.ref must be a complete RoleSpecRevisionRef`;
    }
    return null;
  }
  return `${path}.kind must be role_spec or legacy_template`;
}
function changedFilesProblem(value: unknown, path: string): Problem {
  const files = exact(value, path, ['source', 'status', 'confirmed', 'possible', 'omitted', 'baseCommit',
    'runBaselineKnown', 'reason']);
  if (typeof files === 'string') return files;
  const shape = inList(files['source'], ARCHIVE_CHANGED_SOURCES, `${path}.source`)
    ?? inList(files['status'], ARCHIVE_CHANGED_STATUSES, `${path}.status`)
    ?? pathList(files['confirmed'], `${path}.confirmed`, LIMITS.paths)
    ?? pathList(files['possible'], `${path}.possible`, LIMITS.paths)
    ?? count(files['omitted'], `${path}.omitted`)
    ?? nullableString(files['baseCommit'], `${path}.baseCommit`)
    ?? (files['runBaselineKnown'] === false ? null : `${path}.runBaselineKnown must be false`)
    ?? nullableString(files['reason'], `${path}.reason`);
  return shape;
}
function anomalyAnchorProblem(value: unknown, path: string): Problem {
  const anchor = exact(value, path, ['ref', 'revision', 'schemaVersion', 'workspaceId', 'task', 'planRef',
    'lineHead', 'sessionRef', 'role', 'runRef', 'attemptRef', 'cause', 'archiveRequestId',
    'archiveRequestReceipt', 'archivedBy', 'recordedAt', 'changedFiles', 'resultVerification']);
  if (typeof anchor === 'string') return anchor;
  if (anchor['revision'] !== 1) return `${path}.revision must be 1`;
  if (anchor['schemaVersion'] !== 1) return `${path}.schemaVersion must be 1`;
  const anchorRef = exact(anchor['ref'], `${path}.ref`, ['aggregateType', 'projectId', 'goalId', 'runId']);
  if (typeof anchorRef === 'string') return anchorRef;
  if (anchorRef['aggregateType'] !== 'SessionAnomalyAnchor') return `${path}.ref must be a SessionAnomalyAnchorRef`;
  const run = runRef(anchor['runRef'], `${path}.runRef`);
  if (run !== null) return run;
  const runValue = anchor['runRef'] as Obj;
  const shape = inList(anchor['cause'], ANOMALY_CAUSES, `${path}.cause`)
    ?? (nonEmpty(anchor['workspaceId']) ? null : `${path}.workspaceId is required`)
    ?? taskTriple(anchor['task'], `${path}.task`)
    ?? planRef(anchor['planRef'], `${path}.planRef`)
    ?? sessionRef(anchor['lineHead'], `${path}.lineHead`)
    ?? sessionRef(anchor['sessionRef'], `${path}.sessionRef`)
    ?? roleRef(anchor['role'], `${path}.role`)
    ?? attemptRef(anchor['attemptRef'], `${path}.attemptRef`)
    ?? (nonEmpty(anchor['archiveRequestId']) ? null : `${path}.archiveRequestId is required`)
    ?? recordRef(anchor['archiveRequestReceipt'], `${path}.archiveRequestReceipt`)
    ?? ((isObj(anchor['archivedBy']) && hasOnlyKeys(anchor['archivedBy'], ['kind', 'id'])
      && (anchor['archivedBy']['kind'] === 'human' || anchor['archivedBy']['kind'] === 'system')
      && nonEmpty(anchor['archivedBy']['id'])) ? null : `${path}.archivedBy must be a human/system actor`)
    ?? (nonEmpty(anchor['recordedAt']) ? null : `${path}.recordedAt is required`)
    ?? changedFilesProblem(anchor['changedFiles'], `${path}.changedFiles`)
    ?? (anchor['resultVerification'] === 'not_checked' ? null : `${path}.resultVerification must be not_checked`);
  if (shape !== null) return shape;
  if (anchorRef['projectId'] !== runValue['projectId'] || anchorRef['goalId'] !== runValue['goalId']
    || anchorRef['runId'] !== runValue['runId']) return `${path}.ref disagrees with its runRef`;
  return null;
}
function hasOnlyKeys(value: Obj, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function anomaliesProblem(value: unknown): Problem {
  if (value === undefined) return null;
  const section = exact(value, 'continuationBrief.anomalies', ANOMALY_SECTION_KEYS);
  if (typeof section === 'string') return section;
  if (section['instructionVersion'] !== 1) return 'continuationBrief.anomalies.instructionVersion must be 1';
  if (!isCount(section['omitted'])) return 'continuationBrief.anomalies.omitted must be a non-negative safe integer';
  const anchors = section['anchors'];
  if (!Array.isArray(anchors)) return 'continuationBrief.anomalies.anchors must be an array';
  if (anchors.length > ANOMALY_ANCHOR_LIMIT) {
    return `continuationBrief.anomalies.anchors holds more than ${String(ANOMALY_ANCHOR_LIMIT)} entries`;
  }
  let previous: { recordedAt: string; refKey: string } | null = null;
  for (const [index, entry] of anchors.entries()) {
    const at = `continuationBrief.anomalies.anchors[${index}]`;
    const problem = anomalyAnchorProblem(entry, at);
    if (problem !== null) return problem;
    const anchor = entry as Obj;
    let refKey: string;
    try { refKey = canonicalJson(anchor['ref'] as JsonValue); } catch { return `${at}.ref cannot be encoded`; }
    const current = { recordedAt: anchor['recordedAt'] as string, refKey };
    if (previous !== null
      && (current.recordedAt < previous.recordedAt
        || (current.recordedAt === previous.recordedAt && current.refKey < previous.refKey))) {
      return 'continuationBrief.anomalies.anchors must be sorted by recordedAt then canonical ref';
    }
    previous = current;
  }
  return null;
}

// ------------------------------------------------------------------------ //
// K3 L20: unknown-call review section shape                                 //
// ------------------------------------------------------------------------ //
const REVIEW_ORIGINS: readonly string[] = ['takeover_unresolved', 'human_attested'];
const REVIEW_INVENTORIES: readonly string[] = ['complete', 'incomplete'];
const REVIEW_KINDS: readonly string[] = ['read_only', 'platform', 'file_edit', 'process'];
const REVIEW_VERDICTS: readonly string[] = [
  'no_review_needed', 'done', 'not_done', 'compare_in_continuation', 'pending', 'partial', 'undetermined',
];
const REVIEW_CRASH_VERDICTS: readonly string[] = ['unlikely', 'possible', 'undetermined'];
const REVIEW_CHANGES: readonly string[] = ['added', 'modified', 'deleted', 'mode_changed', 'unchanged', 'not_visible', 'unknown'];
const REVIEW_MODES: readonly string[] = ['replace', 'create'];
const REVIEW_DIFF_REASONS: readonly string[] = ['baseline_dirty', 'binary', 'too_large', 'protected', 'section_limit', 'not_text'];
const REVIEW_CHOICES: readonly string[] = ['rerun_as_is', 'safer_method', 'skip_as_done', 'handle_myself'];
const REVIEW_SOURCES: readonly string[] = ['card', 'direct'];
const REVIEW_ITEM_LIMIT = 32;
/** L6: `oldText`/`newText` excerpts per path. */
const REVIEW_EXCERPT_CHARS = 1_000;
/** L6: one path's diff. */
const REVIEW_DIFF_CHARS = 2_000;
const REVIEW_WORKSPACE_STATUSES: readonly string[] = ['captured', 'unavailable'];

/** `boundedText` with a field-specific cap smaller than `CONTINUATION_BRIEF_LIMITS.textChars`. */
function boundedTextWithin(value: unknown, path: string, max: number): Problem {
  const text = exact(value, path, ['text', 'truncated']);
  if (typeof text === 'string') return text;
  if (typeof text['text'] !== 'string') return `${path}.text must be a string`;
  if (text['text'].length > max) return `${path}.text exceeds ${max} characters`;
  return boolean(text['truncated'], `${path}.truncated`);
}
function reviewRefProblem(value: unknown, path: string): Problem {
  const reference = exact(value, path, ['aggregateType', 'projectId', 'goalId', 'runId']);
  if (typeof reference === 'string') return reference;
  if (reference['aggregateType'] !== 'UnknownCallReview') return `${path}.aggregateType must be UnknownCallReview`;
  for (const field of ['projectId', 'goalId', 'runId']) {
    if (!nonEmpty(reference[field])) return `${path}.${field} must be a non-empty string`;
  }
  return null;
}
function crashSuspicionProblem(value: unknown, path: string): Problem {
  if (value === null) return null;
  const suspicion = exact(value, path, ['verdict', 'evidence']);
  if (typeof suspicion === 'string') return suspicion;
  return inList(suspicion['verdict'], REVIEW_CRASH_VERDICTS, `${path}.verdict`)
    ?? (nonEmpty(suspicion['evidence']) && (suspicion['evidence'] as string).length <= REVIEW_EXCERPT_CHARS
      ? null : `${path}.evidence must be a non-empty string of at most ${REVIEW_EXCERPT_CHARS} characters`);
}
function reviewFileProblem(value: unknown, path: string): Problem {
  const file = exact(value, path, ['path', 'mode', 'change', 'oldText', 'newText', 'diff', 'diffOmittedReason']);
  if (typeof file === 'string') return file;
  return (nonEmpty(file['path']) ? null : `${path}.path must be a non-empty string`)
    ?? inList(file['mode'], REVIEW_MODES, `${path}.mode`)
    ?? inList(file['change'], REVIEW_CHANGES, `${path}.change`)
    ?? (file['oldText'] === null ? null : boundedTextWithin(file['oldText'], `${path}.oldText`, REVIEW_EXCERPT_CHARS))
    ?? (file['newText'] === null ? null : boundedTextWithin(file['newText'], `${path}.newText`, REVIEW_EXCERPT_CHARS))
    ?? (file['diff'] === null ? null : boundedTextWithin(file['diff'], `${path}.diff`, REVIEW_DIFF_CHARS))
    ?? (file['diffOmittedReason'] === null ? null : inList(file['diffOmittedReason'], REVIEW_DIFF_REASONS, `${path}.diffOmittedReason`));
}
function reviewItemProblem(value: unknown, path: string): Problem {
  const item = exact(value, path, [
    'alias', 'callId', 'toolName', 'kind', 'summary', 'verdict', 'evidence', 'crashSuspicion', 'reviewerConclusion', 'files',
  ]);
  if (typeof item === 'string') return item;
  return (isCount(item['alias']) && (item['alias'] as number) >= 1 ? null : `${path}.alias must be a positive safe integer`)
    ?? (nonEmpty(item['callId']) ? null : `${path}.callId must be a non-empty string`)
    ?? (nonEmpty(item['toolName']) ? null : `${path}.toolName must be a non-empty string`)
    ?? inList(item['kind'], REVIEW_KINDS, `${path}.kind`)
    ?? boundedText(item['summary'], `${path}.summary`)
    ?? inList(item['verdict'], REVIEW_VERDICTS, `${path}.verdict`)
    ?? nullableBoundedText(item['evidence'], `${path}.evidence`)
    ?? crashSuspicionProblem(item['crashSuspicion'], `${path}.crashSuspicion`)
    ?? nullableBoundedText(item['reviewerConclusion'], `${path}.reviewerConclusion`)
    ?? list(item['files'], `${path}.files`, null, reviewFileProblem);
}
function reviewDispositionProblem(value: unknown, path: string): Problem {
  if (value === null) return null;
  const disposition = exact(value, path, ['choice', 'source', 'text', 'targets', 'platformTargets', 'approvedMethods',
    'annotations']);
  if (typeof disposition === 'string') return disposition;
  return inList(disposition['choice'], REVIEW_CHOICES, `${path}.choice`)
    ?? inList(disposition['source'], REVIEW_SOURCES, `${path}.source`)
    ?? nullableBoundedText(disposition['text'], `${path}.text`)
    ?? list(disposition['targets'], `${path}.targets`, null, (entry, at) =>
      (isCount(entry) && (entry as number) >= 1 ? null : `${at} must be a positive safe integer`))
    ?? list(disposition['platformTargets'], `${path}.platformTargets`, null, (entry, at) =>
      (isCount(entry) && (entry as number) >= 1 ? null : `${at} must be a positive safe integer`))
    ?? list(disposition['approvedMethods'], `${path}.approvedMethods`, null, (entry, at) => {
      const method = exact(entry, at, ['alias', 'command', 'cwd']);
      if (typeof method === 'string') return method;
      return (isCount(method['alias']) && (method['alias'] as number) >= 1 ? null : `${at}.alias must be a positive safe integer`)
        ?? (nonEmpty(method['command']) ? null : `${at}.command must be a non-empty string`)
        ?? nullableString(method['cwd'], `${at}.cwd`);
    })
    ?? list(disposition['annotations'], `${path}.annotations`, null, (entry, at) => {
      const annotation = exact(entry, at, ['path', 'text']);
      if (typeof annotation === 'string') return annotation;
      return (annotation['path'] === null || nonEmpty(annotation['path']) ? null
        : `${at}.path must be null or a non-empty string`)
        ?? (typeof annotation['text'] === 'string' ? null : `${at}.text must be a string`);
    });
}
function reviewWorkspaceProblem(value: unknown, path: string): Problem {
  const workspace = exact(value, path, ['status', 'runBaselineKnown', 'notVisible', 'changedSample', 'changedOmitted']);
  if (typeof workspace === 'string') return workspace;
  return inList(workspace['status'], REVIEW_WORKSPACE_STATUSES, `${path}.status`)
    ?? boolean(workspace['runBaselineKnown'], `${path}.runBaselineKnown`)
    ?? pathList(workspace['notVisible'], `${path}.notVisible`, 32)
    ?? list(workspace['changedSample'], `${path}.changedSample`, null, (entry, at) =>
      (nonEmpty(entry) ? null : `${at} must be a non-empty string`))
    ?? count(workspace['changedOmitted'], `${path}.changedOmitted`);
}
function unknownCallReviewProblem(value: unknown): Problem {
  if (value === undefined || value === null) return null;
  const path = 'continuationBrief.unknownCallReview';
  const section = exact(value, path, [
    'reviewRef', 'revision', 'origin', 'inventory', 'items', 'itemsOmitted', 'disposition', 'workspace',
  ], ['blockedCommands']);
  if (typeof section === 'string') return section;
  return reviewRefProblem(section['reviewRef'], `${path}.reviewRef`)
    ?? (Number.isSafeInteger(section['revision']) && (section['revision'] as number) >= 1
      ? null : `${path}.revision must be a positive safe integer`)
    ?? inList(section['origin'], REVIEW_ORIGINS, `${path}.origin`)
    ?? inList(section['inventory'], REVIEW_INVENTORIES, `${path}.inventory`)
    ?? list(section['items'], `${path}.items`, REVIEW_ITEM_LIMIT, reviewItemProblem)
    ?? count(section['itemsOmitted'], `${path}.itemsOmitted`)
    ?? reviewDispositionProblem(section['disposition'], `${path}.disposition`)
    ?? reviewWorkspaceProblem(section['workspace'], `${path}.workspace`)
    ?? reviewBlockedCommandsProblem(section['blockedCommands'], `${path}.blockedCommands`);
}

// ------------------------------------------------------------------------ //
// K3 B3 item 7: blocked-command shape                                        //
// ------------------------------------------------------------------------ //
const BLOCKED_REQUEST_STATES: readonly string[] = ['pending', 'allowed', 'denied', 'denied_final'];
/** The alias range of a review item (L7/L8: #1–#32). */
function blockedAlias(value: unknown, path: string): Problem {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= REVIEW_ITEM_LIMIT
    ? null : `${path} must be an integer 1..${String(REVIEW_ITEM_LIMIT)}`;
}
function reviewBlockedCommandsProblem(value: unknown, path: string): Problem {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return `${path} must be an array`;
  for (const [index, entry] of value.entries()) {
    const at = `${path}[${index}]`;
    const blocked = exact(entry, at, ['alias', 'reviewRunId', 'commandSha256']);
    if (typeof blocked === 'string') return blocked;
    const problem = blockedAlias(blocked['alias'], `${at}.alias`)
      ?? (nonEmpty(blocked['reviewRunId']) ? null : `${at}.reviewRunId must be a non-empty string`)
      ?? (isSha256(blocked['commandSha256']) ? null : `${at}.commandSha256 must be a sha256 hex`);
    if (problem !== null) return problem;
  }
  return null;
}
function blockedCommandsProblem(value: unknown): Problem {
  if (value === undefined) return null;
  const path = 'continuationBrief.blockedCommands';
  if (!Array.isArray(value)) return `${path} must be an array`;
  for (const [index, entry] of value.entries()) {
    const at = `${path}[${index}]`;
    const blocked = exact(entry, at, ['alias', 'reviewRunId', 'requestState', 'declaredForms']);
    if (typeof blocked === 'string') return blocked;
    const problem = blockedAlias(blocked['alias'], `${at}.alias`)
      ?? (nonEmpty(blocked['reviewRunId']) ? null : `${at}.reviewRunId must be a non-empty string`)
      ?? (blocked['requestState'] === null ? null : inList(blocked['requestState'], BLOCKED_REQUEST_STATES,
        `${at}.requestState`))
      ?? list(blocked['declaredForms'], `${at}.declaredForms`, null,
        (form, formAt) => (nonEmpty(form) ? null : `${formAt} must be a non-empty string`));
    if (problem !== null) return problem;
  }
  return null;
}
