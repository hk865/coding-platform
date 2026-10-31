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
 *
 * The bounds and the marker line live in the leaf `continuation-brief-base.ts`
 * and the Chinese renderer in `continuation-brief-render.ts`; both are
 * re-exported from here, so every importer keeps this module path. The
 * renderer reads the shapes below with `import type` only.
 */
import type { ArtifactRef } from './artifact.js';
import type { SessionRef } from './core/identity.js';
import type { SessionMessageRef } from './core/session-message.js';
import type { SessionAnomalyAnchorV1 } from './session-anomaly.js';
import type { ControlIntentRef } from './control-intent.js';
import type { RunOutcome, RunRef, TaskAttemptRef, TaskTriple } from './dispatch.js';
import { EVIDENCE_OUTCOMES } from './evidence.js';
import { canonicalJson, sha256Hex, type JsonValue } from './fingerprint.js';
import { CONTINUATION_BRIEF_LIMITS } from './continuation-brief-base.js';
import { nonEmpty } from './validation/common.js';
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

// The bounds and the marker line are in `continuation-brief-base.ts`, the Chinese renderer in
// `continuation-brief-render.ts`; re-exported here so every importer keeps this module path.
export { CONTINUATION_BRIEF_LIMITS, continuationBriefMarker } from './continuation-brief-base.js';
export {
  ContinuationBriefCapacityError, approvedMethodLinesZh, renderContinuationBriefZh, templateToolNames,
} from './continuation-brief-render.js';

// ------------------------------------------------------------------------ //
// Digest                                                                    //
// ------------------------------------------------------------------------ //
/** `RuntimeInputBindingV1.continuationBriefDigest` = sha256Hex(canonicalJson(brief)). */
export function continuationBriefDigest(brief: ContinuationBriefV1): string {
  return sha256Hex(canonicalJson(brief as unknown as JsonValue));
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
