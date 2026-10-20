/**
 * K3 (spec §2 L7, §3.2 UCR-01/UCR-02): the `UnknownCallReview` aggregate's only
 * record codec, its replay event and its two lookup indexes.
 *
 * This file owns the strict snapshot decoder: a stored record that carries an
 * unknown field, an out-of-range value or a mismatched field state is `invalid`
 * (a bad record), and every read must fail closed (never guess a field). It
 * performs no I/O; the immutable record is written only through the `state/`
 * constructors.
 *
 * `UnknownCallReviewChanged@1` is the replay event of every review write
 * (spec lines 912-917). The `created` record of RUN-25/RUN-22 is written in the
 * SAME commit as the Run's own `ExecutionRunReconciled` event, so that commit
 * carries no review event (the RecordStore's replay contract reads exactly one
 * event per commit); the standalone disposition/approval/hold writes use this
 * event as their single replay event.
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type { DecisionChangeProofV1 } from '../../../contracts/goal-decisions.js';
import type {
  UnknownCallDecisionReasonV1, UnknownCallInventoryProblemV1,
  UnknownCallReviewRef, UnknownCallReviewStatusV1, UnknownCallReviewV1,
} from '../../../contracts/unknown-call-review.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type {
  DecodeResult, EncodedDomainEvent, EncodedRecord, RecordBackendSchemas,
} from '../../record-store/ports.js';
import type { UnknownCallReviewChangeV1 } from '../state/unknown-call-review.js';
import { encodeEventEnvelope } from '../persistence/event-envelope.js';
import { sessionRefProblem } from '../persistence/rework-codecs.js';
import {
  canonicalOf, hasOnlyKeys, inList, invalid, isNonNeg, isObject, isPos, isSha256Hex,
  nonEmpty, parseObject, utf8Bytes, type UnknownRecord,
} from './codec-fields.js';
import { runRefProblem, sessionMessageRefProblem, taskTripleProblem } from './codec-shape-checks.js';

/** Encoding selector for the immutable review record. */
export const UNKNOWN_CALL_REVIEW_SCHEMA_ID = 'UnknownCallReview@1';
export const UNKNOWN_CALL_REVIEW_CHANGED_EVENT_TYPE = 'UnknownCallReviewChanged';
export const UNKNOWN_CALL_REVIEW_EVENT_SCHEMA_VERSION = 1;
/** §2 L7 index 1: the card source by Goal and status. */
export const K3_UCR_BY_GOAL_STATUS_LOOKUP = 'k3-ucr-by-goal-status';
/** §2 L7 index 2: the start-up 2b/6b source by workspace and `open`. */
export const K3_UCR_BY_WORKSPACE_OPEN_LOOKUP = 'k3-ucr-by-workspace-open';

const CHANGE_KINDS: readonly UnknownCallReviewChangeV1[] = [
  'created', 'round_claimed', 'conclusion_recorded', 'proposal_recorded', 'round_unfinished',
  'settled', 'disposition_applied', 'approval_applied', 'hold_applied', 'hold_released',
];
const PROOF_CHANGES: readonly UnknownCallReviewChangeV1[] = ['disposition_applied', 'approval_applied'];
const STATUSES: readonly UnknownCallReviewStatusV1[] = [
  'pending_review', 'needs_decision', 'awaiting_proposal', 'awaiting_approval', 'resolved',
];
const DECISION_REASONS: readonly UnknownCallDecisionReasonV1[] = [
  'inventory_incomplete', 'review_stopped', 'review_incomplete', 'review_unavailable',
  'partial', 'undetermined', 'crash_possible', 'crash_undetermined',
  'second_consecutive', 'confirm_each_step', 'proposal_missing', 'proposal_declined',
];
const INVENTORY_PROBLEMS: readonly UnknownCallInventoryProblemV1[] = [
  'kernel_unreadable', 'kernel_unreadable_at_stop', 'turn_not_found', 'too_many_calls', 'too_large', 'undecodable_call',
];
const CALL_KINDS = ['read_only', 'platform', 'file_edit', 'process'] as const;
const CRASH_VERDICTS = ['unlikely', 'possible', 'undetermined'] as const;
const CONCLUDED_VERDICTS = ['done', 'not_done', 'partial', 'undetermined'] as const;
const CAPTURE_REASONS = ['not_git', 'no_baseline', 'unstable', 'too_many_changes', 'read_failed', 'not_configured'] as const;
const PATH_CHANGES = ['added', 'modified', 'deleted', 'mode_changed'] as const;
const DISPOSITION_CHOICES = ['rerun_as_is', 'safer_method', 'skip_as_done', 'handle_myself'] as const;
const CALL_ID_MAX_BYTES = 512;
const COMMAND_MAX_BYTES = 4_000;
const CWD_MAX_BYTES = 512;
const RATIONALE_MAX_CHARS = 2_000;
const EVIDENCE_MAX_CHARS = 2_000;
const DETAIL_MAX_CHARS = 500;
const REASON_MAX_CHARS = 2_000;
const MAX_ITEMS = 32;
const MAX_ROUNDS = 8;
const MAX_SAMPLE = 50;
const MAX_NOT_VISIBLE = 32;
const MAX_EVENT_IDS = 8;

// --------------------------------------------------------------------------
// Shared sub-shape validators
// --------------------------------------------------------------------------

function actorProblem(value: unknown, label: string): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['kind', 'id'])
    || (value['kind'] !== 'human' && value['kind'] !== 'system') || !nonEmpty(value['id'])) {
    return `${label} must be a trusted human/system actor`;
  }
  return null;
}
function takenOverProofProblem(value: unknown): string | null {
  if (!isObject(value)) return 'review origin proof must be an object';
  switch (value['kind']) {
    case 'hl01_no_lock':
      return hasOnlyKeys(value, ['kind']) ? null : 'review origin hl01 proof carries unknown fields';
    case 'memory_store':
      return hasOnlyKeys(value, ['kind']) ? null : 'review origin memory proof carries unknown fields';
    case 'hl03_stale_lock':
      if (!hasOnlyKeys(value, ['kind', 'previousInstanceId', 'previousPid'])
        || !nonEmpty(value['previousInstanceId']) || !isNonNeg(value['previousPid'])) {
        return 'review origin hl03 proof is incomplete';
      }
      return null;
    default:
      return 'review origin proof kind is not recognized';
  }
}
function originProblem(value: unknown): string | null {
  if (!isObject(value)) return 'review origin must be an object';
  if (value['kind'] === 'takeover_unresolved') {
    if (!hasOnlyKeys(value, ['kind', 'hostInstanceId', 'proof']) || !nonEmpty(value['hostInstanceId'])) {
      return 'review origin takeover_unresolved is incomplete';
    }
    return takenOverProofProblem(value['proof']);
  }
  if (value['kind'] === 'human_attested') {
    if (!hasOnlyKeys(value, ['kind', 'attestedBy', 'reason'])) return 'review origin human_attested carries unknown fields';
    const actor = actorProblem(value['attestedBy'], 'review origin attestedBy');
    if (actor !== null) return actor;
    if (typeof value['reason'] !== 'string' || value['reason'].length > REASON_MAX_CHARS) {
      return `review origin reason must be a string of at most ${String(REASON_MAX_CHARS)} characters`;
    }
    return null;
  }
  return 'review origin kind is not recognized';
}
function kernelCallRefProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['adapterId', 'kernelSessionId', 'kernelRunId', 'turnId',
    'callId', 'declaredPosition', 'startedPosition'])) {
    return 'review item kernel must be a complete KernelCallRefV1';
  }
  for (const key of ['adapterId', 'kernelSessionId', 'kernelRunId', 'turnId', 'callId']) {
    if (!nonEmpty(value[key])) return `review item kernel.${key} must be a non-empty string`;
  }
  if (utf8Bytes(value['callId'] as string) > CALL_ID_MAX_BYTES) return 'review item kernel.callId exceeds 512 bytes';
  if (!isNonNeg(value['declaredPosition'])) return 'review item kernel.declaredPosition must be a non-negative integer';
  if (!(value['startedPosition'] === null || isNonNeg(value['startedPosition']))) {
    return 'review item kernel.startedPosition must be null or a non-negative integer';
  }
  return null;
}
function crashSuspicionProblem(value: unknown, label: string): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['verdict', 'evidence'])
    || !inList(value['verdict'], CRASH_VERDICTS)
    || typeof value['evidence'] !== 'string' || value['evidence'].length > 1_000) {
    return `${label} must be {verdict, evidence}`;
  }
  return null;
}
function platformEvidenceProblem(value: unknown): string | null {
  if (!isObject(value)) return 'review platform evidence must be an object';
  switch (value['kind']) {
    case 'receipt':
      if (!hasOnlyKeys(value, ['kind', 'cursor', 'eventIds']) || !nonEmpty(value['cursor'])
        || !Array.isArray(value['eventIds']) || value['eventIds'].length > MAX_EVENT_IDS
        || !value['eventIds'].every(nonEmpty)) {
        return 'review platform receipt evidence is incomplete';
      }
      return null;
    case 'not_committed':
      return hasOnlyKeys(value, ['kind']) ? null : 'review platform not_committed evidence carries unknown fields';
    case 'lookup_failed':
      if (!hasOnlyKeys(value, ['kind', 'reason']) || typeof value['reason'] !== 'string'
        || value['reason'].length > DETAIL_MAX_CHARS) {
        return 'review platform lookup_failed evidence is incomplete';
      }
      return null;
    default:
      return 'review platform evidence kind is not recognized';
  }
}
function observationProblem(value: unknown): string | null {
  if (!isObject(value)) return 'review item observed must be an object';
  const verdict = value['verdict'];
  if (verdict === 'no_review_needed' || verdict === 'compare_in_continuation') {
    return value['by'] === 'platform' && hasOnlyKeys(value, ['verdict', 'by'])
      ? null : 'review item observed platform verdict is malformed';
  }
  if (verdict === 'done' || verdict === 'not_done' || verdict === 'undetermined' || verdict === 'partial') {
    if (value['by'] === 'platform') {
      // L17: `partial` is only ever a concluded (review_round/settlement)
      // observation; the platform lookup evidence has no `partial` verdict.
      if (verdict === 'partial') return 'review item observed partial must come from a review round or settlement';
      if (!hasOnlyKeys(value, ['verdict', 'by', 'evidence'])) return 'review item observed platform verdict carries unknown fields';
      return platformEvidenceProblem(value['evidence']);
    }
    if (value['by'] === 'review_round' || value['by'] === 'settlement') {
      if (!hasOnlyKeys(value, ['verdict', 'by', 'evidence', 'roundRunRef', 'crashSuspicion', 'reviewerConclusion'])) {
        return 'review item observed conclusion carries unknown fields';
      }
      if (typeof value['evidence'] !== 'string' || value['evidence'].length === 0
        || value['evidence'].length > EVIDENCE_MAX_CHARS) {
        return 'review item observed evidence must be 1..2000 characters';
      }
      if (!(value['roundRunRef'] === null || runRefProblem(value['roundRunRef'], 'review item observed roundRunRef') === null)) {
        return 'review item observed roundRunRef must be null or a RunRef';
      }
      const crash = crashSuspicionProblem(value['crashSuspicion'], 'review item observed crashSuspicion');
      if (crash !== null) return crash;
      const reviewer = value['reviewerConclusion'];
      if (reviewer === null) return null;
      if (!isObject(reviewer) || !hasOnlyKeys(reviewer, ['verdict', 'evidence', 'crashSuspicion'])
        || !inList(reviewer['verdict'], CONCLUDED_VERDICTS)
        || typeof reviewer['evidence'] !== 'string' || reviewer['evidence'].length > EVIDENCE_MAX_CHARS) {
        return 'review item observed reviewerConclusion is malformed';
      }
      return crashSuspicionProblem(reviewer['crashSuspicion'], 'review item observed reviewerConclusion.crashSuspicion');
    }
    return 'review item observed by is not recognized';
  }
  if (verdict === 'pending') {
    return value['by'] === null && hasOnlyKeys(value, ['verdict', 'by'])
      ? null : 'review item observed pending must carry by: null';
  }
  return 'review item observed verdict is not recognized';
}
function itemProblem(value: unknown, label: string): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['alias', 'callId', 'toolName', 'kind', 'contained', 'kernel',
    'argumentsDigest', 'summary', 'startedAt', 'observed'])) {
    return `${label} must be a complete UnknownCallReviewItemV1`;
  }
  if (!isPos(value['alias'])) return `${label}.alias must be a positive integer`;
  if (!nonEmpty(value['callId']) || utf8Bytes(value['callId']) > CALL_ID_MAX_BYTES) {
    return `${label}.callId must be 1..512 UTF-8 bytes`;
  }
  if (!nonEmpty(value['toolName'])) return `${label}.toolName must be a non-empty string`;
  if (!inList(value['kind'], CALL_KINDS)) return `${label}.kind is not recognized`;
  if (typeof value['contained'] !== 'boolean') return `${label}.contained must be a boolean`;
  const kernel = kernelCallRefProblem(value['kernel']);
  if (kernel !== null) return kernel;
  if (!isSha256Hex(value['argumentsDigest'])) return `${label}.argumentsDigest must be a lowercase sha256 hex`;
  const summary = value['summary'];
  if (!isObject(summary) || !hasOnlyKeys(summary, ['command', 'cwd', 'mode', 'paths', 'pathsOmitted', 'truncated'])) {
    return `${label}.summary is malformed`;
  }
  if (!(summary['command'] === null || (typeof summary['command'] === 'string' && summary['command'].length <= 512))) {
    return `${label}.summary.command must be null or at most 512 characters`;
  }
  if (!(summary['cwd'] === null || typeof summary['cwd'] === 'string')) return `${label}.summary.cwd must be null or a string`;
  if (!(summary['mode'] === null || summary['mode'] === 'replace' || summary['mode'] === 'create')) {
    return `${label}.summary.mode is not recognized`;
  }
  if (!Array.isArray(summary['paths']) || summary['paths'].length > 8
    || !summary['paths'].every(path => nonEmpty(path) && path.length <= 512)) {
    return `${label}.summary.paths must be at most 8 non-empty strings of at most 512 characters`;
  }
  if (!isNonNeg(summary['pathsOmitted'])) return `${label}.summary.pathsOmitted must be a non-negative integer`;
  if (typeof summary['truncated'] !== 'boolean') return `${label}.summary.truncated must be a boolean`;
  if (!(value['startedAt'] === null || nonEmpty(value['startedAt']))) return `${label}.startedAt must be null or a timestamp`;
  return observationProblem(value['observed']);
}
function proposalProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['proposalId', 'callId', 'alias', 'command', 'cwd', 'rationale', 'roundRunRef'])) {
    return 'review proposal is malformed';
  }
  if (!nonEmpty(value['proposalId'])) return 'review proposal.proposalId is required';
  if (!nonEmpty(value['callId']) || utf8Bytes(value['callId'] as string) > CALL_ID_MAX_BYTES) {
    return 'review proposal.callId must be 1..512 UTF-8 bytes';
  }
  if (!isPos(value['alias'])) return 'review proposal.alias must be a positive integer';
  if (typeof value['command'] !== 'string' || utf8Bytes(value['command']) === 0 || utf8Bytes(value['command']) > COMMAND_MAX_BYTES) {
    return 'review proposal.command must be 1..4000 UTF-8 bytes';
  }
  if (!(value['cwd'] === null
    || (typeof value['cwd'] === 'string' && utf8Bytes(value['cwd']) >= 1
      && utf8Bytes(value['cwd']) <= CWD_MAX_BYTES))) {
    return 'review proposal.cwd must be null or 1..512 UTF-8 bytes';
  }
  if (typeof value['rationale'] !== 'string' || value['rationale'].length === 0
    || value['rationale'].length > RATIONALE_MAX_CHARS) {
    return 'review proposal.rationale must be 1..2000 characters';
  }
  return runRefProblem(value['roundRunRef'], 'review proposal.roundRunRef');
}
function blockedCommandProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['reviewRunId', 'alias', 'commandSha256', 'kernelCallRef',
    'actions', 'expansions', 'truncated'])) {
    return 'review blockedCommand is malformed';
  }
  if (!nonEmpty(value['reviewRunId']) || !isPos(value['alias']) || !nonEmpty(value['commandSha256'])) {
    return 'review blockedCommand identity is incomplete';
  }
  const kernel = kernelCallRefProblem(value['kernelCallRef']);
  if (kernel !== null) return kernel;
  if (!Array.isArray(value['actions']) || !value['actions'].every(action => isObject(action)
    && hasOnlyKeys(action, ['text', 'sha256']) && nonEmpty(action['text']) && nonEmpty(action['sha256']))) {
    return 'review blockedCommand.actions is malformed';
  }
  const expansions = value['expansions'];
  if (!Array.isArray(expansions) || !expansions.every(expansion => isObject(expansion)
    && hasOnlyKeys(expansion, ['action', 'scriptName', 'scriptText', 'actions', 'basis'])
    && nonEmpty(expansion['action']) && nonEmpty(expansion['scriptName'])
    && typeof expansion['scriptText'] === 'string'
    && Array.isArray(expansion['actions'])
    && expansion['actions'].every(action => isObject(action) && hasOnlyKeys(action, ['text', 'sha256'])
      && nonEmpty(action['text']) && nonEmpty(action['sha256']))
    && (isObject(expansion['basis']) || expansion['basis'] === null))) {
    return 'review blockedCommand.expansions is malformed';
  }
  if (typeof value['truncated'] !== 'boolean') return 'review blockedCommand.truncated must be a boolean';
  return null;
}
function dispositionProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['choice', 'source', 'targets', 'answerMessageRef', 'answeredRevision',
    'appliedBy', 'appliedAt', 'text', 'annotations', 'approval', 'approvedMethods', 'hold'])) {
    return 'review disposition is malformed';
  }
  if (!inList(value['choice'], DISPOSITION_CHOICES)) return 'review disposition.choice is not recognized';
  if (value['source'] !== 'card' && value['source'] !== 'direct') return 'review disposition.source is not recognized';
  if (!Array.isArray(value['targets']) || !value['targets'].every(nonEmpty)) {
    return 'review disposition.targets must be an array of call ids';
  }
  if (!(value['answerMessageRef'] === null
    || sessionMessageRefProblem(value['answerMessageRef'], 'review disposition.answerMessageRef') === null)) {
    return 'review disposition.answerMessageRef must be null or a SessionMessageRef';
  }
  if (!isNonNeg(value['answeredRevision'])) return 'review disposition.answeredRevision must be a non-negative integer';
  const actor = actorProblem(value['appliedBy'], 'review disposition.appliedBy');
  if (actor !== null) return actor;
  if (!nonEmpty(value['appliedAt'])) return 'review disposition.appliedAt is required';
  if (!(value['text'] === null || (typeof value['text'] === 'string' && value['text'].length <= REASON_MAX_CHARS))) {
    return 'review disposition.text must be null or at most 2000 characters';
  }
  const annotations = value['annotations'];
  if (!Array.isArray(annotations) || !annotations.every(annotation => isObject(annotation)
    && hasOnlyKeys(annotation, ['path', 'text'])
    && (annotation['path'] === null || nonEmpty(annotation['path']))
    && typeof annotation['text'] === 'string')) {
    return 'review disposition.annotations must be an array of { path, text }';
  }
  const approval = value['approval'];
  if (approval !== null) {
    if (!isObject(approval) || !hasOnlyKeys(approval, ['decision', 'answerMessageRef', 'answeredRevision',
      'appliedBy', 'appliedAt'])
      || (approval['decision'] !== 'approve' && approval['decision'] !== 'decline')
      || sessionMessageRefProblem(approval['answerMessageRef'], 'review disposition.approval.answerMessageRef') !== null
      || !isNonNeg(approval['answeredRevision'])
      || actorProblem(approval['appliedBy'], 'review disposition.approval.appliedBy') !== null
      || !nonEmpty(approval['appliedAt'])) {
      return 'review disposition.approval is malformed';
    }
  }
  const methods = value['approvedMethods'];
  if (methods !== null) {
    if (!Array.isArray(methods) || !methods.every(method => isObject(method)
      && hasOnlyKeys(method, ['proposalId', 'callId', 'alias', 'command', 'cwd'])
      && nonEmpty(method['proposalId']) && nonEmpty(method['callId']) && isPos(method['alias'])
      && typeof method['command'] === 'string'
      && (method['cwd'] === null || typeof method['cwd'] === 'string'))) {
      return 'review disposition.approvedMethods is malformed';
    }
  }
  if (!(value['hold'] === null || value['hold'] === 'held' || value['hold'] === 'released')) {
    return 'review disposition.hold is not recognized';
  }
  return null;
}
function workspaceProblem(value: unknown): string | null {
  if (!isObject(value)) return 'review workspace must be an object';
  if (value['status'] === 'captured') {
    if (!hasOnlyKeys(value, ['status', 'runBaselineKnown', 'baseCommit', 'headNow', 'captureRef',
      'changedCount', 'sample', 'notVisible', 'notVisibleOmitted'])) {
      return 'review workspace captured carries unknown fields';
    }
    if (typeof value['runBaselineKnown'] !== 'boolean') return 'review workspace.runBaselineKnown must be a boolean';
    if (!nonEmpty(value['baseCommit']) || !nonEmpty(value['headNow'])) return 'review workspace commits are required';
    const capture = value['captureRef'];
    if (!isObject(capture) || capture['kind'] !== 'artifact' || !nonEmpty(capture['contentType'])
      || !nonEmpty(capture['digest']) || !isNonNeg(capture['sizeBytes']) || !isObject(capture['source'])) {
      return 'review workspace.captureRef must be an ArtifactRef';
    }
    if (!isNonNeg(value['changedCount'])) return 'review workspace.changedCount must be a non-negative integer';
    if (!Array.isArray(value['sample']) || value['sample'].length > MAX_SAMPLE
      || !value['sample'].every(entry => isObject(entry) && hasOnlyKeys(entry, ['path', 'change'])
        && nonEmpty(entry['path']) && inList(entry['change'], PATH_CHANGES))) {
      return 'review workspace.sample is malformed';
    }
    if (!Array.isArray(value['notVisible']) || value['notVisible'].length > MAX_NOT_VISIBLE
      || !value['notVisible'].every(nonEmpty)) {
      return 'review workspace.notVisible is malformed';
    }
    if (!isNonNeg(value['notVisibleOmitted'])) return 'review workspace.notVisibleOmitted must be a non-negative integer';
    return null;
  }
  if (value['status'] === 'unavailable') {
    if (!hasOnlyKeys(value, ['status', 'runBaselineKnown', 'reason', 'detail'])
      || typeof value['runBaselineKnown'] !== 'boolean' || !inList(value['reason'], CAPTURE_REASONS)
      || typeof value['detail'] !== 'string' || value['detail'].length > DETAIL_MAX_CHARS) {
      return 'review workspace unavailable capture is malformed';
    }
    return null;
  }
  return 'review workspace status is not recognized';
}
function streakProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['priorAutoCleanup', 'priorUnknownProcess', 'resetRunRef'])
    || typeof value['priorAutoCleanup'] !== 'boolean' || typeof value['priorUnknownProcess'] !== 'boolean') {
    return 'review streak is malformed';
  }
  if (value['resetRunRef'] === null) return null;
  return runRefProblem(value['resetRunRef'], 'review streak.resetRunRef');
}
function activeRoundProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['runRef', 'phase', 'round', 'stateEntry', 'startedRevision'])
    || (value['phase'] !== 'review' && value['phase'] !== 'proposal')
    || !isPos(value['round']) || !isPos(value['stateEntry']) || !isPos(value['startedRevision'])) {
    return 'review activeRound is malformed';
  }
  return runRefProblem(value['runRef'], 'review activeRound.runRef');
}
function roundRecordProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['runRef', 'phase', 'round', 'stateEntry', 'result'])
    || (value['phase'] !== 'review' && value['phase'] !== 'proposal')
    || !isPos(value['round']) || !isPos(value['stateEntry'])
    || (value['result'] !== 'finished' && value['result'] !== 'unfinished' && value['result'] !== 'stopped')) {
    return 'review round record is malformed';
  }
  return runRefProblem(value['runRef'], 'review round runRef');
}
function reviewRefProblem(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'goalId', 'runId'])
    || value['aggregateType'] !== 'UnknownCallReview'
    || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId']) || !nonEmpty(value['runId'])) {
    return 'review ref must be a complete UnknownCallReviewRef';
  }
  return null;
}

const REVIEW_BODY_KEYS: readonly string[] = [
  'ref', 'schemaVersion', 'revision', 'workspaceId', 'task', 'runRef', 'sessionRef', 'origin',
  'inventory', 'inventoryProblem', 'items', 'itemsOmitted', 'workspace', 'streak', 'status', 'open',
  'decisionReasons', 'dispositionTargets', 'proposalTargets', 'stateEntry', 'activeRound', 'rounds',
  'proposals', 'blockedCommands', 'disposition', 'createdAt', 'updatedAt',
];

/**
 * The strict snapshot body check: every field is validated and cross-checked, so
 * a record that disagrees with its own key or with the derived `open` is
 * refused. Exported because the `UnknownCallReviewChanged@1` event carries the
 * whole post-change record and must judge it identically.
 */
export function unknownCallReviewBodyProblem(value: unknown): string | null {
  if (!isObject(value)) return 'the review record must be an object';
  if (!hasOnlyKeys(value, REVIEW_BODY_KEYS)) return 'the review record carries unknown fields';
  const ref = reviewRefProblem(value['ref']);
  if (ref !== null) return ref;
  const body = value as UnknownRecord;
  const reviewRef = body['ref'] as UnknownRecord;
  if (body['schemaVersion'] !== 1) return 'review schemaVersion must be 1';
  if (!isPos(body['revision'])) return 'review revision must be a positive integer';
  if (!nonEmpty(body['workspaceId'])) return 'review workspaceId must be a non-empty string';
  const task = taskTripleProblem(body['task'], 'review task');
  if (task !== null) return task;
  const taskValue = body['task'] as UnknownRecord;
  const run = runRefProblem(body['runRef'], 'review runRef');
  if (run !== null) return run;
  const runValue = body['runRef'] as UnknownRecord;
  const session = sessionRefProblem(body['sessionRef'], 'review sessionRef');
  if (session !== null) return session;
  const sessionValue = body['sessionRef'] as UnknownRecord;
  const origin = originProblem(body['origin']);
  if (origin !== null) return origin;
  if (body['inventory'] !== 'complete' && body['inventory'] !== 'incomplete') return 'review inventory is not recognized';
  if (!(body['inventoryProblem'] === null || inList(body['inventoryProblem'], INVENTORY_PROBLEMS))) {
    return 'review inventoryProblem is not recognized';
  }
  if (body['inventory'] === 'complete' && body['inventoryProblem'] !== null) {
    return 'review complete inventory must not name a problem';
  }
  if (body['inventory'] === 'incomplete' && body['inventoryProblem'] === null) {
    return 'review incomplete inventory must name its problem';
  }
  const items = body['items'];
  if (!Array.isArray(items) || items.length > MAX_ITEMS) return `review holds at most ${String(MAX_ITEMS)} items`;
  for (const [index, entry] of items.entries()) {
    const item = itemProblem(entry, `review item ${String(index)}`);
    if (item !== null) return item;
    if ((entry as UnknownRecord)['alias'] !== index + 1) return 'review item aliases must be 1..n in Kernel order';
  }
  if (!isNonNeg(body['itemsOmitted'])) return 'review itemsOmitted must be a non-negative integer';
  const workspace = workspaceProblem(body['workspace']);
  if (workspace !== null) return workspace;
  const streak = streakProblem(body['streak']);
  if (streak !== null) return streak;
  if (!inList(body['status'], STATUSES)) return 'review status is not recognized';
  const active = body['activeRound'];
  if (active !== null) {
    const activeProblem = activeRoundProblem(active);
    if (activeProblem !== null) return activeProblem;
  }
  const status = body['status'] as UnknownCallReviewStatusV1;
  const expectedOpen = status !== 'resolved' || active !== null ? 'yes' : 'no';
  if (body['open'] !== expectedOpen) return 'review open disagrees with its status/activeRound';
  if (!Array.isArray(body['decisionReasons']) || !body['decisionReasons'].every(reason => inList(reason, DECISION_REASONS))) {
    return 'review decisionReasons is malformed';
  }
  for (const key of ['dispositionTargets', 'proposalTargets']) {
    const list = body[key];
    if (!(list === null || (Array.isArray(list) && list.every(nonEmpty)))) return `review ${key} is malformed`;
  }
  if (!isPos(body['stateEntry'])) return 'review stateEntry must be a positive integer';
  const rounds = body['rounds'];
  if (!Array.isArray(rounds) || rounds.length > MAX_ROUNDS) return `review holds at most ${String(MAX_ROUNDS)} rounds`;
  for (const entry of rounds) {
    const round = roundRecordProblem(entry);
    if (round !== null) return round;
  }
  if (!Array.isArray(body['proposals'])) return 'review proposals must be an array';
  for (const entry of body['proposals']) {
    const proposal = proposalProblem(entry);
    if (proposal !== null) return proposal;
  }
  if (!Array.isArray(body['blockedCommands'])) return 'review blockedCommands must be an array';
  for (const entry of body['blockedCommands']) {
    const blocked = blockedCommandProblem(entry);
    if (blocked !== null) return blocked;
  }
  if (body['disposition'] !== null) {
    const disposition = dispositionProblem(body['disposition']);
    if (disposition !== null) return disposition;
  }
  if (!nonEmpty(body['createdAt']) || !nonEmpty(body['updatedAt'])) return 'review timestamps are required';
  // Identity cross-checks: the key and every nested scope must agree.
  if (reviewRef['projectId'] !== runValue['projectId'] || reviewRef['goalId'] !== runValue['goalId']
    || reviewRef['runId'] !== runValue['runId']) {
    return 'review ref disagrees with its runRef';
  }
  if (taskValue['projectId'] !== reviewRef['projectId'] || taskValue['goalId'] !== reviewRef['goalId']) {
    return 'review task belongs to another Goal/project';
  }
  if (sessionValue['projectId'] !== reviewRef['projectId']) return 'review sessionRef belongs to another project';
  return null;
}

// --------------------------------------------------------------------------
// Record encode/decode
// --------------------------------------------------------------------------

export function unknownCallReviewRefKey(ref: UnknownCallReviewRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}

export function encodeUnknownCallReview(review: UnknownCallReviewV1): EncodedRecord {
  return {
    refKey: unknownCallReviewRefKey(review.ref),
    schemaId: UNKNOWN_CALL_REVIEW_SCHEMA_ID,
    revision: review.revision,
    json: JSON.stringify(review),
  };
}

export function decodeUnknownCallReview(record: EncodedRecord): DecodeResult<UnknownCallReviewV1> {
  if (record.schemaId !== UNKNOWN_CALL_REVIEW_SCHEMA_ID) {
    return invalid(`expected schemaId ${UNKNOWN_CALL_REVIEW_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const body = parseObject(record.json);
  if (body === null) return invalid('UnknownCallReview record json is not an object');
  if (!isObject(body['ref']) || !isPos(body['revision']) || body['revision'] !== record.revision) {
    return invalid('UnknownCallReview record envelope is invalid');
  }
  const canonical = canonicalOf(body['ref']);
  if (canonical === null || canonical !== record.refKey) {
    return invalid('UnknownCallReview refKey disagrees with the record body');
  }
  const problem = unknownCallReviewBodyProblem(body);
  if (problem !== null) return invalid(`UnknownCallReview record payload is invalid: ${problem}`);
  return { status: 'decoded', value: body as unknown as UnknownCallReviewV1 };
}

// --------------------------------------------------------------------------
// The replay event
// --------------------------------------------------------------------------

export type UnknownCallReviewChangedEventV1 = {
  eventId: string;
  eventType: typeof UNKNOWN_CALL_REVIEW_CHANGED_EVENT_TYPE;
  schemaVersion: typeof UNKNOWN_CALL_REVIEW_EVENT_SCHEMA_VERSION;
  occurredAt: string;
  identityKey: string;
  fingerprint: string;
  actor: Extract<ActorRef, { kind: 'human' | 'system' }>;
  requestId: string;
  change: UnknownCallReviewChangeV1;
  review: UnknownCallReviewV1;
  /**
   * L19: `disposition_applied` / `approval_applied` may carry the fifth-slice
   * `DecisionChangeProofV1`. The codec accepts it structurally (it is the
   * decision-application owner's shape).
   */
  proof?: DecisionChangeProofV1;
};

const EVENT_KEYS: readonly string[] = [
  'eventId', 'eventType', 'schemaVersion', 'occurredAt', 'identityKey', 'fingerprint', 'actor',
  'requestId', 'change', 'review', 'proof',
];

export function encodeUnknownCallReviewChangedEvent(event: UnknownCallReviewChangedEventV1): EncodedDomainEvent {
  return encodeEventEnvelope(event);
}

export function unknownCallReviewChangedEventFromEvent(
  event: EncodedDomainEvent,
): DecodeResult<UnknownCallReviewChangedEventV1> {
  if (event.eventType !== UNKNOWN_CALL_REVIEW_CHANGED_EVENT_TYPE) {
    return invalid(`expected eventType ${UNKNOWN_CALL_REVIEW_CHANGED_EVENT_TYPE}, got ${event.eventType}`);
  }
  if (event.schemaVersion !== UNKNOWN_CALL_REVIEW_EVENT_SCHEMA_VERSION) {
    return invalid(`expected schemaVersion ${String(UNKNOWN_CALL_REVIEW_EVENT_SCHEMA_VERSION)}, got ${String(event.schemaVersion)}`);
  }
  if (!nonEmpty(event.eventId) || !nonEmpty(event.occurredAt)) return invalid('UnknownCallReviewChanged envelope is incomplete');
  const body = parseObject(event.json);
  if (body === null) return invalid('UnknownCallReviewChanged event json is not an object');
  if (body['eventId'] !== event.eventId || body['eventType'] !== event.eventType
    || body['schemaVersion'] !== event.schemaVersion || body['occurredAt'] !== event.occurredAt) {
    return invalid('UnknownCallReviewChanged event envelope disagrees with the event json');
  }
  if (!hasOnlyKeys(body, EVENT_KEYS)) return invalid('UnknownCallReviewChanged carries unknown fields');
  if (!nonEmpty(body['identityKey']) || !nonEmpty(body['fingerprint']) || !nonEmpty(body['requestId'])) {
    return invalid('UnknownCallReviewChanged requires its identity and request id');
  }
  const actor = actorProblem(body['actor'], 'UnknownCallReviewChanged actor');
  if (actor !== null) return invalid(actor);
  if (!inList(body['change'], CHANGE_KINDS)) return invalid('UnknownCallReviewChanged change is not recognized');
  const change = body['change'];
  const hasProof = body['proof'] !== undefined;
  if (hasProof !== PROOF_CHANGES.includes(change)) {
    return invalid('UnknownCallReviewChanged carries a proof only for disposition_applied/approval_applied');
  }
  if (hasProof && !isObject(body['proof'])) return invalid('UnknownCallReviewChanged proof must be an object');
  const review = body['review'];
  if (!isObject(review)) return invalid('UnknownCallReviewChanged requires the whole post-change record');
  if (review['schemaVersion'] !== 1 || !isPos(review['revision'])) {
    return invalid('UnknownCallReviewChanged review envelope is invalid');
  }
  const problem = unknownCallReviewBodyProblem(review);
  if (problem !== null) return invalid(`UnknownCallReviewChanged review is invalid: ${problem}`);
  return { status: 'decoded', value: body as unknown as UnknownCallReviewChangedEventV1 };
}

// --------------------------------------------------------------------------
// The single registration
// --------------------------------------------------------------------------

export const UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [
    {
      aggregateType: 'UnknownCallReview',
      schemaId: UNKNOWN_CALL_REVIEW_SCHEMA_ID,
      validate: (record) => {
        const decoded = decodeUnknownCallReview(record);
        return decoded.status === 'decoded' ? { status: 'decoded', value: record } : decoded;
      },
    },
  ],
  events: [
    {
      eventType: UNKNOWN_CALL_REVIEW_CHANGED_EVENT_TYPE,
      schemaVersion: UNKNOWN_CALL_REVIEW_EVENT_SCHEMA_VERSION,
      validate: (event) => {
        const decoded = unknownCallReviewChangedEventFromEvent(event);
        return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
      },
    },
  ],
  lookups: [
    { name: K3_UCR_BY_GOAL_STATUS_LOOKUP, aggregateType: 'UnknownCallReview',
      paths: ['ref.projectId', 'workspaceId', 'ref.goalId', 'status'] },
    { name: K3_UCR_BY_WORKSPACE_OPEN_LOOKUP, aggregateType: 'UnknownCallReview',
      paths: ['ref.projectId', 'workspaceId', 'open'] },
  ],
};
