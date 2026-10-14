/**
 * C1 SessionMessage record/event codecs and lookup declarations.
 *
 * The WorkGraph owns this closed schemaId list; the RecordStore only selects a
 * codec from the aggregateType of the full ref and applies mechanical CAS,
 * claims, cursor binding and one transaction. This file performs no I/O, no
 * admission, no fold and no transaction.
 *
 * Frozen rules enforced here:
 *   - `SessionMessage@1` has the FULL `SessionMessageRef` as its canonical key
 *     and its body revision must equal the encoded record revision. Text is
 *     never inlined: only the body `ArtifactRef` is persisted.
 *   - `SessionMessageSent@1` / `SessionMessageRead@1` /
 *     `SessionMessageResponded@1` save the complete returned message metadata
 *     plus the real command actor/identity, so an idempotent replay can restore
 *     the ORIGINAL receipt through `eventAt` without re-deriving current state.
 *   - the two recipient lookup indexes are registered with the record codec;
 *     no hand-written SQL table or second index exists.
 */
import type { ArtifactRef } from '../../../contracts/artifact.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { RoleBindingRefV1, RunRef, SourceRefV1 } from '../../../contracts/dispatch.js';
import type { QueryJobAnswerRef, QueryRunRef } from '../../../contracts/query-job.js';
import { MAX_AUTO_REWORK_LIMIT } from '../../../contracts/task-requeue.js';
import type { RecordLookupIndex } from '../../record-store/lookup-ports.js';
import type {
  DecodeResult, EncodedDomainEvent, EncodedRecord, RecordBackendSchemas,
} from '../../record-store/ports.js';
import { isJsonObject, isNonEmptyString, parseJsonObject } from '../../record-store/record-codec.js';
import { checkArtifactRef, checkPlainSessionRef, checkSessionBody, isNonZeroPlatformCursor, isPlatformCursor } from './session-record-codecs.js';
import type { Slice1EventHeaderV1 } from './lifecycle-record-codecs.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { ArchiveStepRefV1 } from '../../../contracts/core/session-archive.js';
import { SESSION_REPLY_BY_HANDLER_LOOKUP } from '../model/session-facts-contracts.js';
import type { MessageQueryAnswerSender, MessageSender, SessionMessage } from '../model/communication-contracts.js';
import type { NoticeOriginWireV1 } from '../persistence/decision-record-codecs.js';
import { aggregateRefProblem } from '../persistence/decision-record-codecs.js';

/** Encoding selector for the persisted message record. */
export const SESSION_MESSAGE_SCHEMA_ID = 'SessionMessage@1';

/** Replay event selectors. Each event restores its original receipt. */
export const SESSION_MESSAGE_SENT_EVENT_TYPE = 'SessionMessageSent';
export const SESSION_MESSAGE_READ_EVENT_TYPE = 'SessionMessageRead';
export const SESSION_MESSAGE_RESPONDED_EVENT_TYPE = 'SessionMessageResponded';
export const SESSION_MESSAGE_DERIVATION_EVENT_TYPE = 'SessionMessageConsultationDerived';
export const SESSION_MESSAGE_INPUT_ACCEPTED_EVENT_TYPE = 'SessionMessageInputAccepted';
/** Slice 5 replay event selectors (SPEC §2.3, §2.8). */
export const SESSION_MESSAGE_DECISION_ANSWERED_EVENT_TYPE = 'SessionMessageDecisionAnswered';
export const SESSION_MESSAGE_DECISION_APPLIED_EVENT_TYPE = 'SessionMessageDecisionApplied';
export const SESSION_MESSAGE_EVENT_SCHEMA_VERSION = 1;
/** Slice 1 §2.9: the wait-disposal replay event written by the mailbox owner. */
export const ARCHIVE_WAIT_DISPOSED_EVENT_TYPE = 'ArchiveWaitDisposed';

/** Registered lookup index names (`core/record-store/lookup-ports.ts`). */
export const SESSION_MESSAGE_BY_RECIPIENT_LOOKUP = 'session-message-by-recipient';
export const SESSION_MESSAGE_BY_RECIPIENT_STATUS_LOOKUP = 'session-message-by-recipient-status';
/** The sender Work Run outbox index: complete scope + the nested RunRef. A host
 * sender has no `sender.runRef`, so its missing scalar paths are null and never
 * become a candidate of a concrete Run query. */
export const SESSION_MESSAGE_BY_SENDER_RUN_LOOKUP = 'session-message-by-sender-run';
export const SESSION_MESSAGE_BY_SENDER_SESSION_LOOKUP = 'session-message-by-sender-session';
/** Slice 5 decision indexes on the SAME SessionMessage aggregate codec (SPEC §2.5). */
export const S5_USER_MESSAGE_BY_GOAL = 's5-user-message-by-goal';
export const S5_MESSAGE_BY_WORKSPACE_STATUS = 's5-message-by-workspace-status';
export const S5_DECISION_ANSWER_BY_SOURCE = 's5-decision-answer-by-source';
/** Slice 2A L2: messages addressed to the user in one workspace. */
export const S2A_USER_MESSAGES_LOOKUP = 's2a-user-messages';

/**
 * Slice 5 notification origin wire (SPEC §2.5 line 289). The single
 * declaration lives in `persistence/rework-codecs.ts` and the single
 * `decodeNoticeOrigin` export lives in `persistence/decision-record-codecs.ts`
 * (A7); this module re-exports both for its historical importers. These are
 * OPTIONAL top-level wire fields, NOT part of the public `SessionMessage` DTO:
 * the record validator accepts them and `encodeSessionMessageRecord` writes
 * them through its optional `origin` parameter.
 */
export type { NoticeOriginWireV1 } from '../persistence/decision-record-codecs.js';
export { decodeNoticeOrigin } from '../persistence/decision-record-codecs.js';

/**
 * Fixed body contentType for the canonical JSON envelope:
 * `{schemaVersion:1, projectId, workspaceId, messageId, part, sender, text}`.
 * `scope+messageId+part` prevents independent messages from wrongly sharing
 * the first provenance record.
 */
export const SESSION_MESSAGE_CONTENT_TYPE = 'application/vnd.coding-platform.session-message+json';

/** Non-empty UTF-8 text, at most 16 KiB. Over-bound input returns `capacity`. */
export const SESSION_MESSAGE_MAX_TEXT_BYTES = 16 * 1024;

/** One recipient and one recipient+status candidate index (frozen paths). */
export const SESSION_MESSAGE_LOOKUP_INDEXES: readonly RecordLookupIndex[] = [
  { name: SESSION_MESSAGE_BY_SENDER_SESSION_LOOKUP, aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'sender.sessionRef.sessionId'] },
  {
    name: SESSION_MESSAGE_BY_RECIPIENT_LOOKUP,
    aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'recipient.sessionId'],
  },
  {
    name: SESSION_MESSAGE_BY_RECIPIENT_STATUS_LOOKUP,
    aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'recipient.sessionId', 'status'],
  },
  {
    name: SESSION_MESSAGE_BY_SENDER_RUN_LOOKUP,
    aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'sender.runRef.goalId', 'sender.runRef.runId'],
  },
  {
    name: SESSION_REPLY_BY_HANDLER_LOOKUP,
    aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'replyHandler.sessionRef.sessionId'],
  },
];

/**
 * Slice 5 additive indexes (SPEC §2.5 table, lines 280-282), registered on the
 * SAME original SessionMessage aggregate codec — never a second registration.
 * Kept separate from `SESSION_MESSAGE_LOOKUP_INDEXES` so the frozen historical
 * constant (and its exact-shape test) stays byte-compatible.
 */
export const S5_SESSION_MESSAGE_LOOKUP_INDEXES: readonly RecordLookupIndex[] = [
  {
    name: S5_USER_MESSAGE_BY_GOAL,
    aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'recipient.kind', 'goalRef.goalId'],
  },
  {
    name: S5_MESSAGE_BY_WORKSPACE_STATUS,
    aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'status'],
  },
  {
    name: S5_DECISION_ANSWER_BY_SOURCE,
    aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'decision.source.kind', 'decision.source.key'],
  },
];

/**
 * Slice 2A L2 additive index (SPEC §1.1): the messages addressed to a user in a
 * workspace, registered on the SAME SessionMessage aggregate codec.
 */
export const S2A_SESSION_MESSAGE_LOOKUP_INDEXES: readonly RecordLookupIndex[] = [
  {
    name: S2A_USER_MESSAGES_LOOKUP,
    aggregateType: 'SessionMessage',
    paths: ['ref.projectId', 'ref.workspaceId', 'recipient.kind'],
  },
];

// --------------------------------------------------------------------------
// Event bodies (stable replay carriers)
// --------------------------------------------------------------------------
// Declared in `model/communication-contracts.ts` so the model-layer write
// facade can name the union without a `model -> sessions` import; re-exported
// here for every existing importer (slice 5, SPEC §2.8).
export type {
  SessionMessageSentEventV1,
  SessionMessageReadEventV1,
  SessionMessageConsultationDerivedEventV1,
  SessionMessageInputAcceptedEventV1,
  SessionMessageRespondedEventV1,
  SessionMessageDecisionAnsweredEventV1,
  SessionMessageDecisionAppliedEventV1,
  SessionMessageEventV1,
} from '../model/communication-contracts.js';
import type {
  SessionMessageSentEventV1,
  SessionMessageReadEventV1,
  SessionMessageConsultationDerivedEventV1,
  SessionMessageInputAcceptedEventV1,
  SessionMessageRespondedEventV1,
  SessionMessageDecisionAnsweredEventV1,
  SessionMessageDecisionAppliedEventV1,
  SessionMessageEventV1,
} from '../model/communication-contracts.js';

/** Slice 1 (spec §2.9): one wait disposal. The header comes from the lifecycle
 * codec; the changed source Session makes its revision participate in the
 * actual guard. */
export type ArchiveWaitDisposedEventV1 = Slice1EventHeaderV1 & {
  eventType: 'ArchiveWaitDisposed'; message: SessionMessage;
  source: SessionRecord; archiveStep: ArchiveStepRefV1;
};

// --------------------------------------------------------------------------
// Pure shape helpers
// --------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>;
/** `null` = the check passed; a string is the precise rejection reason. */
export type Problem = string | null;

function isObject(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
function hasOnlyKeys(value: UnknownRecord, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function canonicalOf(value: unknown): string | null {
  try {
    return canonicalJson(value as JsonValue);
  } catch {
    return null;
  }
}
function invalid(reason: string): { status: 'invalid'; reason: string } {
  return { status: 'invalid', reason };
}

const SOURCE_KINDS: readonly string[] = ['plan-revision', 'workspace', 'governance', 'artifact', 'memory'];

export function checkSessionMessageRef(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'workspaceId', 'messageId'])) {
    return 'message ref must be a complete SessionMessageRef';
  }
  if (value['aggregateType'] !== 'SessionMessage' || !nonEmpty(value['projectId'])
    || !nonEmpty(value['workspaceId']) || !nonEmpty(value['messageId'])) {
    return 'message ref is not a valid SessionMessageRef';
  }
  return null;
}

export function checkSourceRef(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value, ['kind', 'refId', 'revision', 'digest'])) {
    return 'message source carries unknown fields';
  }
  if (!SOURCE_KINDS.includes(String(value['kind']))) return 'message source kind is not recognized';
  if (!nonEmpty(value['refId']) || !nonEmpty(value['revision'])) return 'message source requires refId and revision';
  if (value['digest'] !== undefined && !nonEmpty(value['digest'])) {
    return 'message source digest must be a non-empty string when present';
  }
  return null;
}

export function checkRoleBindingRef(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value,
    ['schemaVersion', 'bindingId', 'templateId', 'templateRevision', 'bindingVersion', 'policyRevision'])) {
    return 'role binding carries unknown fields';
  }
  if (value['schemaVersion'] !== 1) return 'role binding schemaVersion must be 1';
  if (!nonEmpty(value['bindingId']) || !nonEmpty(value['templateId']) || !nonEmpty(value['templateRevision'])
    || !isPositiveInt(value['bindingVersion']) || !nonEmpty(value['policyRevision'])) {
    return 'role binding is incomplete';
  }
  return null;
}

function checkRunRef(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'goalId', 'runId'])) {
    return 'message sender run ref carries unknown fields';
  }
  if (value['aggregateType'] !== 'Run' || !nonEmpty(value['projectId'])
    || !nonEmpty(value['goalId']) || !nonEmpty(value['runId'])) {
    return 'message sender run ref is not a valid RunRef';
  }
  return null;
}

export function checkMessageSender(value: unknown): Problem {
  if (!isObject(value)) return 'message sender must be an object';
  if (value['kind'] === 'host') {
    if (!hasOnlyKeys(value, ['kind', 'actor'])) return 'host sender carries unknown fields';
    const actor = value['actor'];
    if (!isObject(actor) || !hasOnlyKeys(actor, ['kind', 'id'])) return 'host sender actor carries unknown fields';
    if ((actor['kind'] !== 'human' && actor['kind'] !== 'system') || !nonEmpty(actor['id'])) {
      return 'host sender actor must be a real human/system identity';
    }
    return null;
  }
  if (value['kind'] === 'work_run') {
    if (!hasOnlyKeys(value, ['kind', 'sessionRef', 'runRef', 'roleBinding', 'generation'])) {
      return 'work_run sender carries unknown fields';
    }
    const session = checkPlainSessionRef(value['sessionRef']);
    if (session !== null) return `work_run sender session: ${session}`;
    const run = checkRunRef(value['runRef']);
    if (run !== null) return `work_run sender run: ${run}`;
    const binding = checkRoleBindingRef(value['roleBinding']);
    if (binding !== null) return `work_run sender role: ${binding}`;
    if (!isPositiveInt(value['generation'])) return 'work_run sender generation must be a positive integer';
    return null;
  }
  return 'message sender kind must be host or work_run';
}

function checkQueryRunRef(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value,
    ['aggregateType', 'projectId', 'workspaceId', 'queryJobId', 'runId'])) {
    return 'query_run sender run ref carries unknown fields';
  }
  if (value['aggregateType'] !== 'QueryRun' || !nonEmpty(value['projectId'])
    || !nonEmpty(value['workspaceId']) || !nonEmpty(value['queryJobId']) || !nonEmpty(value['runId'])) {
    return 'query_run sender run ref is not a valid QueryRunRef';
  }
  return null;
}

function checkQueryAnswerRef(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value,
    ['aggregateType', 'projectId', 'workspaceId', 'queryJobId', 'answerId'])) {
    return 'query_run sender answer ref carries unknown fields';
  }
  if (value['aggregateType'] !== 'QueryJobAnswer' || !nonEmpty(value['projectId'])
    || !nonEmpty(value['workspaceId']) || !nonEmpty(value['queryJobId']) || !nonEmpty(value['answerId'])) {
    return 'query_run sender answer ref is not a valid QueryJobAnswerRef';
  }
  return null;
}

/** The derived formal Query Answer sender. It is never a caller-supplied text
 * author: every identity field is a persisted Query fact. */
export function checkQueryAnswerSender(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value,
    ['kind', 'sessionRef', 'queryRunRef', 'answerRef', 'generation'])) {
    return 'query_run sender carries unknown fields';
  }
  if (value['kind'] !== 'query_run') return 'query_run sender kind must be query_run';
  const session = checkPlainSessionRef(value['sessionRef']);
  if (session !== null) return `query_run sender session: ${session}`;
  const run = checkQueryRunRef(value['queryRunRef']);
  if (run !== null) return `query_run sender run: ${run}`;
  const answer = checkQueryAnswerRef(value['answerRef']);
  if (answer !== null) return `query_run sender answer: ${answer}`;
  if (!isPositiveInt(value['generation'])) return 'query_run sender generation must be a positive integer';
  return null;
}

/** A response slot accepts the original work_run reply or the derived
 * query_run Answer reply. The message `sender` itself stays host/work_run. */
export function checkResponseSender(value: unknown): Problem {
  if (!isObject(value)) return 'message response sender must be an object';
  if (value['kind'] === 'query_run') return checkQueryAnswerSender(value);
  const workRun = checkMessageSender(value);
  if (workRun !== null) return workRun;
  if (value['kind'] !== 'work_run') return 'message response sender must be a work_run or query_run sender';
  return null;
}

// --------------------------------------------------------------------------
// Slice 5 additive shapes (SPEC §2.3): user recipient, goalRef, decision
// metadata, application and the widened user response. Pure shape checks only.
// --------------------------------------------------------------------------

function checkGoalRefShape(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'goalId'])) {
    return 'goal ref must be a GoalRef';
  }
  if (value['aggregateType'] !== 'Goal' || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId'])) {
    return 'goal ref is not a valid GoalRef';
  }
  return null;
}

function checkWorkspaceRefShape(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'workspaceId'])) {
    return 'workspace ref must be a WorkspaceRef';
  }
  if (value['aggregateType'] !== 'Workspace' || !nonEmpty(value['projectId']) || !nonEmpty(value['workspaceId'])) {
    return 'workspace ref is not a valid WorkspaceRef';
  }
  return null;
}

function checkPlanRevisionRefShape(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'planId'])) {
    return 'plan revision ref must be a PlanRevisionRef';
  }
  if (value['aggregateType'] !== 'PlanRevision' || !nonEmpty(value['projectId']) || !nonEmpty(value['planId'])) {
    return 'plan revision ref is not a valid PlanRevisionRef';
  }
  return null;
}

function checkVersionPinShape(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value, ['ref', 'revision'])) return 'version pin must carry ref and revision';
  const refProblem = aggregateRefProblem(value['ref']);
  if (refProblem !== null) return refProblem;
  const revision = value['revision'];
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
    return 'version pin revision must be a non-negative integer';
  }
  return null;
}

function checkVersionPinList(value: unknown): Problem {
  if (!Array.isArray(value)) return 'version pins must be an array';
  for (const pin of value) {
    const problem = checkVersionPinShape(pin);
    if (problem !== null) return problem;
  }
  return null;
}

function checkGoalSettingsShape(value: unknown): Problem {
  if (!isObject(value)
    || !hasOnlyKeys(value, ['schemaVersion', 'autonomy', 'order', 'waitForGoalRef', 'parallelRisks'])) {
    return 'goal settings carries unknown fields';
  }
  if (value['schemaVersion'] !== 1) return 'goal settings schemaVersion must be 1';
  if (value['autonomy'] !== 'every_step' && value['autonomy'] !== 'after_plan_confirmation') {
    return 'goal settings autonomy is not recognized';
  }
  const order = value['order'];
  if (typeof order !== 'number' || !Number.isSafeInteger(order) || order < 0) {
    return 'goal settings order must be a non-negative integer';
  }
  if (value['waitForGoalRef'] !== null) {
    const wait = checkGoalRefShape(value['waitForGoalRef']);
    if (wait !== null) return `goal settings waitForGoalRef: ${wait}`;
  }
  const risks = value['parallelRisks'];
  if (!Array.isArray(risks)) return 'goal settings parallelRisks must be an array';
  for (const risk of risks) {
    if (!isObject(risk) || !hasOnlyKeys(risk, ['otherGoalRef', 'selfPlanRef', 'otherPlanRef'])) {
      return 'goal settings parallel risk carries unknown fields';
    }
    const other = checkGoalRefShape(risk['otherGoalRef']);
    if (other !== null) return `goal settings parallel risk otherGoalRef: ${other}`;
    for (const key of ['selfPlanRef', 'otherPlanRef']) {
      if (risk[key] !== null) {
        const plan = checkPlanRevisionRefShape(risk[key]);
        if (plan !== null) return `goal settings parallel risk ${key}: ${plan}`;
      }
    }
  }
  return null;
}

function checkGoalDecisionBasisShape(value: unknown): Problem {
  if (!isObject(value)
    || !hasOnlyKeys(value, ['goalRef', 'workspaceRef', 'objective', 'activePlanRef', 'settings'])) {
    return 'goal decision basis carries unknown fields';
  }
  const goal = checkGoalRefShape(value['goalRef']);
  if (goal !== null) return `goal decision basis goalRef: ${goal}`;
  const workspace = checkWorkspaceRefShape(value['workspaceRef']);
  if (workspace !== null) return `goal decision basis workspaceRef: ${workspace}`;
  if (!nonEmpty(value['objective'])) return 'goal decision basis requires objective';
  if (value['activePlanRef'] !== null) {
    const plan = checkPlanRevisionRefShape(value['activePlanRef']);
    if (plan !== null) return `goal decision basis activePlanRef: ${plan}`;
  }
  const settings = checkGoalSettingsShape(value['settings']);
  if (settings !== null) return `goal decision basis settings: ${settings}`;
  return null;
}

function checkGoalControlRebaseShape(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value, ['captured', 'actualBefore', 'basis'])) {
    return 'goal control rebase carries unknown fields';
  }
  const captured = checkVersionPinShape(value['captured']);
  if (captured !== null) return `goal control rebase captured: ${captured}`;
  const actual = checkVersionPinShape(value['actualBefore']);
  if (actual !== null) return `goal control rebase actualBefore: ${actual}`;
  const basis = checkGoalDecisionBasisShape(value['basis']);
  if (basis !== null) return `goal control rebase basis: ${basis}`;
  return null;
}

function checkDecisionAnnotationShape(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value, ['objectKey', 'text'])) {
    return 'decision annotation carries unknown fields';
  }
  if (!nonEmpty(value['objectKey']) || typeof value['text'] !== 'string') {
    return 'decision annotation requires objectKey and text';
  }
  return null;
}

function checkDecisionObjectShape(value: unknown): Problem {
  if (!isObject(value)) return 'decision object must be an object';
  if (value['kind'] === 'aggregate') {
    if (!hasOnlyKeys(value, ['kind', 'pin', 'label'])) return 'aggregate decision object carries unknown fields';
    const pin = checkVersionPinShape(value['pin']);
    if (pin !== null) return `aggregate decision object pin: ${pin}`;
    if (!nonEmpty(value['label'])) return 'aggregate decision object requires label';
    return null;
  }
  if (value['kind'] === 'file') {
    if (!hasOnlyKeys(value, ['kind', 'workspace', 'path', 'digest', 'label'])) {
      return 'file decision object carries unknown fields';
    }
    const workspace = value['workspace'];
    if (!isObject(workspace) || !hasOnlyKeys(workspace, ['projectId', 'workspaceId'])
      || !nonEmpty(workspace['projectId']) || !nonEmpty(workspace['workspaceId'])) {
      return 'file decision object workspace must be a WorkspaceScope';
    }
    if (!nonEmpty(value['path']) || !nonEmpty(value['label'])) return 'file decision object requires path and label';
    if (value['digest'] !== null && !nonEmpty(value['digest'])) {
      return 'file decision object digest must be null or a non-empty string';
    }
    return null;
  }
  return 'decision object kind is not recognized';
}

function checkDecisionOptionShape(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value, ['id', 'label', 'effect'])) {
    return 'decision option carries unknown fields';
  }
  if (!nonEmpty(value['id']) || !nonEmpty(value['label'])) return 'decision option requires id and label';
  if (value['effect'] !== 'apply' && value['effect'] !== 'reject' && value['effect'] !== 'defer') {
    return 'decision option effect is not recognized';
  }
  return null;
}

const DECISION_SOURCE_KINDS: readonly string[] = [
  'message', 'goal_cause', 'candidate', 'note_review', 'planning_question', 'goal_conflict', 'message_release',
];

function checkDecisionSourceShape(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value, ['kind', 'key', 'goalRef', 'pins', 'goalBases'])) {
    return 'decision source carries unknown fields';
  }
  if (!DECISION_SOURCE_KINDS.includes(String(value['kind']))) return 'decision source kind is not recognized';
  if (!nonEmpty(value['key'])) return 'decision source requires a non-empty key';
  const goal = checkGoalRefShape(value['goalRef']);
  if (goal !== null) return `decision source goalRef: ${goal}`;
  const pins = checkVersionPinList(value['pins']);
  if (pins !== null) return `decision source pins: ${pins}`;
  const bases = value['goalBases'];
  if (bases !== undefined) {
    if (!Array.isArray(bases)) return 'decision source goalBases must be an array';
    for (const basis of bases) {
      const problem = checkGoalDecisionBasisShape(basis);
      if (problem !== null) return `decision source goalBases: ${problem}`;
    }
  }
  return null;
}

function checkDecisionSelectionShape(value: unknown): Problem {
  if (!isObject(value)) return 'decision selection must be an object';
  switch (value['kind']) {
    case 'option':
      if (!hasOnlyKeys(value, ['kind', 'optionId']) || !nonEmpty(value['optionId'])) {
        return 'option decision selection requires optionId';
      }
      return null;
    case 'other':
      return hasOnlyKeys(value, ['kind']) ? null : 'other decision selection carries unknown fields';
    case 'conflict_wait':
    case 'conflict_parallel': {
      if (!hasOnlyKeys(value, ['kind', 'earlier', 'later'])) return 'conflict decision selection carries unknown fields';
      const earlier = checkGoalRefShape(value['earlier']);
      if (earlier !== null) return `conflict decision selection earlier: ${earlier}`;
      const later = checkGoalRefShape(value['later']);
      if (later !== null) return `conflict decision selection later: ${later}`;
      return null;
    }
    case 'conflict_order': {
      if (!hasOnlyKeys(value, ['kind', 'goalOrder'])) return 'conflict order selection carries unknown fields';
      const order = value['goalOrder'];
      if (!Array.isArray(order)) return 'conflict order selection goalOrder must be an array';
      for (const goal of order) {
        const problem = checkGoalRefShape(goal);
        if (problem !== null) return `conflict order selection goalOrder: ${problem}`;
      }
      return null;
    }
    default:
      return 'decision selection kind is not recognized';
  }
}

function checkActorRefShape(value: unknown): Problem {
  if (!isObject(value)) return 'actor must be an object';
  if (value['kind'] === 'human' || value['kind'] === 'system') {
    if (!hasOnlyKeys(value, ['kind', 'id'])) return 'actor carries unknown fields';
    return nonEmpty(value['id']) ? null : 'actor requires a non-empty id';
  }
  if (value['kind'] === 'agent') {
    if (!hasOnlyKeys(value, ['kind', 'id', 'runRef'])) return 'agent actor carries unknown fields';
    if (!nonEmpty(value['id'])) return 'agent actor requires a non-empty id';
    return checkRunRef(value['runRef']);
  }
  return 'actor kind is not recognized';
}

function checkDecisionMessageMetadataShape(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value,
    ['schemaVersion', 'source', 'objects', 'options', 'syntheticAnswer', 'forwardedFrom'])) {
    return 'decision metadata carries unknown fields';
  }
  if (value['schemaVersion'] !== 1) return 'decision metadata schemaVersion must be 1';
  const source = checkDecisionSourceShape(value['source']);
  if (source !== null) return `decision metadata source: ${source}`;
  const objects = value['objects'];
  if (!Array.isArray(objects)) return 'decision metadata objects must be an array';
  for (const object of objects) {
    const problem = checkDecisionObjectShape(object);
    if (problem !== null) return `decision metadata objects: ${problem}`;
  }
  const options = value['options'];
  if (!Array.isArray(options)) return 'decision metadata options must be an array';
  for (const option of options) {
    const problem = checkDecisionOptionShape(option);
    if (problem !== null) return `decision metadata options: ${problem}`;
  }
  if (typeof value['syntheticAnswer'] !== 'boolean') return 'decision metadata syntheticAnswer must be boolean';
  if (value['forwardedFrom'] !== null) {
    const forwarded = checkSessionMessageRef(value['forwardedFrom']);
    if (forwarded !== null) return `decision metadata forwardedFrom: ${forwarded}`;
  }
  return null;
}

function checkDecisionApplicationShape(value: unknown): Problem {
  if (!isObject(value)
    || !hasOnlyKeys(value, ['schemaVersion', 'actor', 'appliedAt', 'receipt', 'changes', 'basisRebases'])) {
    return 'decision application carries unknown fields';
  }
  if (value['schemaVersion'] !== 1) return 'decision application schemaVersion must be 1';
  const actor = checkActorRefShape(value['actor']);
  if (actor !== null) return `decision application actor: ${actor}`;
  if (!nonEmpty(value['appliedAt'])) return 'decision application requires appliedAt';
  const receipt = value['receipt'];
  if (!isObject(receipt) || !hasOnlyKeys(receipt, ['identityKey', 'fingerprint', 'cursor'])
    || !nonEmpty(receipt['identityKey']) || !nonEmpty(receipt['fingerprint']) || !isPlatformCursor(receipt['cursor'])) {
    return 'decision application receipt is incomplete';
  }
  const changes = value['changes'];
  if (!Array.isArray(changes)) return 'decision application changes must be an array';
  for (const change of changes) {
    if (!isObject(change) || !hasOnlyKeys(change, ['before', 'after'])) {
      return 'decision application change carries unknown fields';
    }
    const before = checkVersionPinShape(change['before']);
    if (before !== null) return `decision application change before: ${before}`;
    const after = checkVersionPinShape(change['after']);
    if (after !== null) return `decision application change after: ${after}`;
  }
  const rebases = value['basisRebases'];
  if (rebases !== undefined) {
    if (!Array.isArray(rebases)) return 'decision application basisRebases must be an array';
    for (const rebase of rebases) {
      const problem = checkGoalControlRebaseShape(rebase);
      if (problem !== null) return `decision application basisRebases: ${problem}`;
    }
  }
  return null;
}

/** A user recipient is a workspace address, never a fabricated Session. */
function checkMessageRecipientShape(value: unknown): Problem {
  if (isObject(value) && value['kind'] === 'user') {
    if (!hasOnlyKeys(value, ['kind', 'projectId', 'workspaceId'])) return 'user recipient carries unknown fields';
    if (!nonEmpty(value['projectId']) || !nonEmpty(value['workspaceId'])) {
      return 'user recipient requires projectId and workspaceId';
    }
    return null;
  }
  return checkPlainSessionRef(value);
}

/** The user answer's response slot: trusted Host sender plus the answer decision. */
function checkUserMessageResponse(value: UnknownRecord): Problem {
  if (!hasOnlyKeys(value, ['sender', 'bodyRef', 'sourceRef', 'respondedAt', 'decision'])) {
    return 'user message response carries unknown fields';
  }
  const sender = checkMessageSender(value['sender']);
  if (sender !== null) return `user message response sender: ${sender}`;
  if (!isObject(value['sender']) || value['sender']['kind'] !== 'host') {
    return 'user message response sender must be the trusted Host identity';
  }
  const body = checkArtifactRef(value['bodyRef']);
  if (body !== null) return `user message response body: ${body}`;
  const source = checkSourceRef(value['sourceRef']);
  if (source !== null) return `user message response source: ${source}`;
  if (!nonEmpty(value['respondedAt'])) return 'user message response requires respondedAt';
  const decision = value['decision'];
  if (!isObject(decision)
    || !hasOnlyKeys(decision, ['selection', 'source', 'annotations', 'requiresApplication'])) {
    return 'user message response decision carries unknown fields';
  }
  const selection = checkDecisionSelectionShape(decision['selection']);
  if (selection !== null) return `user message response selection: ${selection}`;
  const decisionSource = checkDecisionSourceShape(decision['source']);
  if (decisionSource !== null) return `user message response decision source: ${decisionSource}`;
  const annotations = decision['annotations'];
  if (!Array.isArray(annotations)) return 'user message response annotations must be an array';
  for (const annotation of annotations) {
    const problem = checkDecisionAnnotationShape(annotation);
    if (problem !== null) return `user message response annotations: ${problem}`;
  }
  if (typeof decision['requiresApplication'] !== 'boolean') {
    return 'user message response requiresApplication must be boolean';
  }
  return null;
}

function checkMessageResponse(value: unknown): Problem {
  // Slice 5: the presence of `decision` selects the widened user-answer variant.
  if (isObject(value) && 'decision' in value) return checkUserMessageResponse(value);
  if (!isObject(value) || !hasOnlyKeys(value, ['sender', 'bodyRef', 'sourceRef', 'respondedAt'])) {
    return 'message response carries unknown fields';
  }
  const sender = checkResponseSender(value['sender']);
  if (sender !== null) return `message response sender: ${sender}`;
  const body = checkArtifactRef(value['bodyRef']);
  if (body !== null) return `message response body: ${body}`;
  const source = checkSourceRef(value['sourceRef']);
  if (source !== null) return `message response source: ${source}`;
  if (!nonEmpty(value['respondedAt'])) return 'message response requires respondedAt';
  return null;
}

const MESSAGE_KEYS: readonly string[] = [
  'ref', 'schemaVersion', 'revision', 'sender', 'recipient', 'bodyRef', 'sourceRef',
  'createdAt', 'status', 'readAt', 'response', 'replyMode',
  'intent', 'needsReply', 'waitAfterSend', 'consultationDerivation', 'acceptedInputs',
  'replyHandler', 'archiveWaitDisposition',
  // Slice 5 additive fields (SPEC §2.3, §2.5).
  'goalRef', 'decision', 'application', 'since', 'noticeAutomationCap',
  // Wiring package 2 (spec §2.3 P02): the first-response commit position.
  'responseSince',
];

/** Slice 1 §2.5: the effective reply handler of a wait; absent reads as null. */
function checkReplyHandler(value: unknown, path: string): Problem {
  if (!isObject(value) || !hasOnlyKeys(value, ['sessionRef', 'archiveSessionRef', 'archiveRequestId', 'changedAt'])) {
    return `${path} carries unknown fields`;
  }
  const session = checkPlainSessionRef(value['sessionRef']);
  if (session !== null) return `${path}.sessionRef: ${session}`;
  const archiveSession = checkPlainSessionRef(value['archiveSessionRef']);
  if (archiveSession !== null) return `${path}.archiveSessionRef: ${archiveSession}`;
  if (!nonEmpty(value['archiveRequestId'])) return `${path}.archiveRequestId is required`;
  if (!nonEmpty(value['changedAt'])) return `${path}.changedAt is required`;
  return null;
}

/** Slice 1 §2.5: the recorded disposal of a wait during an archive; absent reads as null. */
function checkArchiveWaitDisposition(value: unknown, path: string): Problem {
  if (!isObject(value) || !hasOnlyKeys(value, ['kind', 'runRef', 'archiveSessionRef', 'archiveRequestId', 'recordedAt'])) {
    return `${path} carries unknown fields`;
  }
  if (value['kind'] !== 'cancel' && value['kind'] !== 'transfer') return `${path}.kind is not recognized`;
  const run = checkRunRef(value['runRef']);
  if (run !== null) return `${path}.runRef: ${run}`;
  const archiveSession = checkPlainSessionRef(value['archiveSessionRef']);
  if (archiveSession !== null) return `${path}.archiveSessionRef: ${archiveSession}`;
  if (!nonEmpty(value['archiveRequestId'])) return `${path}.archiveRequestId is required`;
  if (!nonEmpty(value['recordedAt'])) return `${path}.recordedAt is required`;
  return null;
}

export function checkSessionMessageBody(body: UnknownRecord, requireBoundResponseSince = false): Problem {
  if (!hasOnlyKeys(body, MESSAGE_KEYS)) return 'SessionMessage record carries unknown fields';
  const ref = checkSessionMessageRef(body['ref']);
  if (ref !== null) return ref;
  if (body['schemaVersion'] !== 1) return 'SessionMessage schemaVersion must be 1';
  if (!isPositiveInt(body['revision'])) return 'SessionMessage revision must be a positive integer';
  const sender = checkMessageSender(body['sender']);
  if (sender !== null) return `SessionMessage sender: ${sender}`;
  const recipient = checkMessageRecipientShape(body['recipient']);
  if (recipient !== null) return `SessionMessage recipient: ${recipient}`;
  const bodyRef = checkArtifactRef(body['bodyRef']);
  if (bodyRef !== null) return `SessionMessage body: ${bodyRef}`;
  const source = checkSourceRef(body['sourceRef']);
  if (source !== null) return `SessionMessage source: ${source}`;
  if (!nonEmpty(body['createdAt'])) return 'SessionMessage requires createdAt';
  const status = body['status'];
  if (status !== 'pending' && status !== 'read' && status !== 'responded') {
    return 'SessionMessage status is not recognized';
  }
  const readAt = body['readAt'];
  if (!(readAt === null || nonEmpty(readAt))) return 'SessionMessage readAt must be null or a non-empty string';
  const replyMode = body['replyMode'];
  if (replyMode !== undefined && replyMode !== 'wait') return 'SessionMessage replyMode must be omitted or wait';
  const intent = body['intent'];
  if (intent !== undefined && intent !== 'notify' && intent !== 'inquiry'
    && intent !== 'action_request' && intent !== 'decision_request') {
    return 'SessionMessage intent is not recognized';
  }
  if (body['needsReply'] !== undefined && typeof body['needsReply'] !== 'boolean') return 'SessionMessage needsReply must be boolean';
  if (body['waitAfterSend'] !== undefined && typeof body['waitAfterSend'] !== 'boolean') return 'SessionMessage waitAfterSend must be boolean';
  if (body['waitAfterSend'] === true && body['needsReply'] === false) {
    return 'SessionMessage waitAfterSend cannot be set while needsReply is false';
  }
  const acceptedInputs = body['acceptedInputs'];
  if (acceptedInputs !== undefined) {
    if (!Array.isArray(acceptedInputs)) return 'SessionMessage acceptedInputs must be an array';
    for (const entry of acceptedInputs) {
      if (!isObject(entry) || !hasOnlyKeys(entry, ['inputId', 'part', 'executionRef', 'kernel', 'acceptedAt'])) {
        return 'SessionMessage acceptedInputs entry carries unknown fields';
      }
      if (!nonEmpty(entry['inputId']) || (entry['part'] !== 'message' && entry['part'] !== 'response')) {
        return 'SessionMessage acceptedInputs entry identity is invalid';
      }
      const executionRef = entry['executionRef'];
      if (!isObject(executionRef) || !['Run', 'QueryRun'].includes(String(executionRef['aggregateType']))) {
        return 'SessionMessage acceptedInputs executionRef must be a RunRef or QueryRunRef';
      }
      const kernel = entry['kernel'];
      if (!isObject(kernel) || !hasOnlyKeys(kernel, ['adapterId', 'kernelSessionId', 'runId', 'turnId', 'position'])
        || !nonEmpty(kernel['adapterId']) || !nonEmpty(kernel['kernelSessionId']) || !nonEmpty(kernel['runId'])
        || !nonEmpty(kernel['turnId']) || !isPositiveInt(kernel['position'])) {
        return 'SessionMessage acceptedInputs kernel identity is incomplete';
      }
      if (!nonEmpty(entry['acceptedAt'])) return 'SessionMessage acceptedInputs acceptedAt is required';
    }
  }
  const derivation = body['consultationDerivation'];
  if (derivation !== undefined) {
    if (!isObject(derivation)
      || !hasOnlyKeys(derivation, ['childSessionRef', 'sourceSessionRef', 'sourceKernel', 'throughPosition'])) {
      return 'SessionMessage consultationDerivation carries unknown fields';
    }
    const child = derivation['childSessionRef'];
    const source = derivation['sourceSessionRef'];
    if (checkPlainSessionRef(child) !== null || checkPlainSessionRef(source) !== null) {
      return 'SessionMessage consultationDerivation Session refs are incomplete';
    }
    const kernel = derivation['sourceKernel'];
    if (!isObject(kernel) || !hasOnlyKeys(kernel, ['adapterId', 'kernelSessionId'])
      || !nonEmpty(kernel['adapterId']) || !nonEmpty(kernel['kernelSessionId'])) {
      return 'SessionMessage consultationDerivation sourceKernel is incomplete';
    }
    const through = derivation['throughPosition'];
    if (!(through === null || (typeof through === 'number' && Number.isSafeInteger(through) && through >= 1))) {
      return 'SessionMessage consultationDerivation throughPosition is invalid';
    }
  }
  const response = body['response'];
  if (response !== null) {
    const responseProblem = checkMessageResponse(response);
    if (responseProblem !== null) return `SessionMessage response: ${responseProblem}`;
  }
  const replyHandler = body['replyHandler'];
  if (replyHandler !== undefined && replyHandler !== null) {
    const problem = checkReplyHandler(replyHandler, 'SessionMessage.replyHandler');
    if (problem !== null) return problem;
    if (isObject(body['ref']) && isObject(replyHandler)
      && (replyHandler['sessionRef'] as Record<string, unknown>)['projectId'] !== body['ref']['projectId']) {
      return 'SessionMessage replyHandler belongs to another project';
    }
  }
  const archiveWaitDisposition = body['archiveWaitDisposition'];
  if (archiveWaitDisposition !== undefined && archiveWaitDisposition !== null) {
    const problem = checkArchiveWaitDisposition(archiveWaitDisposition, 'SessionMessage.archiveWaitDisposition');
    if (problem !== null) return problem;
    if (isObject(body['ref']) && isObject(archiveWaitDisposition)
      && (archiveWaitDisposition['archiveSessionRef'] as Record<string, unknown>)['projectId'] !== body['ref']['projectId']) {
      return 'SessionMessage archiveWaitDisposition belongs to another project';
    }
  }
  // Slice 5 additive fields (SPEC §2.3): optional, and NEVER backfilled here.
  const goalRef = body['goalRef'];
  if (goalRef !== undefined && goalRef !== null) {
    const goalRefProblem = checkGoalRefShape(goalRef);
    if (goalRefProblem !== null) return `SessionMessage goalRef: ${goalRefProblem}`;
  }
  const decision = body['decision'];
  if (decision !== undefined) {
    const decisionProblem = checkDecisionMessageMetadataShape(decision);
    if (decisionProblem !== null) return `SessionMessage decision: ${decisionProblem}`;
  }
  const application = body['application'];
  if (application !== undefined && application !== null) {
    const applicationProblem = checkDecisionApplicationShape(application);
    if (applicationProblem !== null) return `SessionMessage application: ${applicationProblem}`;
  }
  const since = body['since'];
  if (since !== undefined && since !== null && !isPlatformCursor(since)) {
    return 'SessionMessage since must be null or a ledger commit cursor';
  }
  // Wiring package 2 (spec §2.3 P02): a saved reply position is either absent
  // (other senders / legacy) or a real platform cursor; the explicit `null`
  // placeholder is legal only in an EVENT body, bound by the same commit.
  const responseSince = body['responseSince'];
  if (responseSince !== undefined) {
    if (responseSince === null) {
      if (requireBoundResponseSince) return 'SessionMessage responseSince must be bound to a real commit cursor';
    } else if (!isNonZeroPlatformCursor(responseSince)) {
      return 'SessionMessage responseSince must be a nonzero ledger commit cursor';
    }
    const senderValue = body['sender'];
    if (!isObject(senderValue) || senderValue['kind'] !== 'work_run') {
      return 'SessionMessage responseSince requires a work_run sender';
    }
    if (body['response'] === null) return 'SessionMessage responseSince requires a saved response';
  }
  const noticeAutomationCap = body['noticeAutomationCap'];
  if (noticeAutomationCap !== undefined
    && (typeof noticeAutomationCap !== 'number' || !Number.isSafeInteger(noticeAutomationCap)
      || noticeAutomationCap < 0 || noticeAutomationCap > MAX_AUTO_REWORK_LIMIT)) {
    return `SessionMessage noticeAutomationCap must be an integer between 0 and ${MAX_AUTO_REWORK_LIMIT}`;
  }
  // The status/readAt/response triple is monotone and consistent.
  if (status === 'pending' && (readAt !== null || response !== null)) {
    return 'a pending message must be unread and unanswered';
  }
  if (status === 'read' && (readAt === null || response !== null)) {
    return 'a read message must carry readAt and no response';
  }
  if (status === 'responded' && response === null) {
    return 'a responded message must carry a response';
  }
  if (isObject(body['ref']) && isObject(body['recipient'])
    && body['recipient']['projectId'] !== body['ref']['projectId']) {
    return 'SessionMessage recipient belongs to another project';
  }
  return null;
}

const EVENT_KEYS: readonly string[] = [
  'eventId', 'eventType', 'schemaVersion', 'occurredAt', 'projectId', 'workspaceId', 'requestId', 'actor', 'message',
];

function checkEventBody(body: UnknownRecord, eventType: string): Problem {
  if (!hasOnlyKeys(body, EVENT_KEYS)) return `${eventType} carries unknown fields`;
  if (body['eventType'] !== eventType) return `${eventType} eventType disagrees with the envelope`;
  if (body['schemaVersion'] !== SESSION_MESSAGE_EVENT_SCHEMA_VERSION) {
    return `${eventType} schemaVersion must be ${SESSION_MESSAGE_EVENT_SCHEMA_VERSION}`;
  }
  if (!nonEmpty(body['eventId']) || !nonEmpty(body['occurredAt'])) return `${eventType} envelope is incomplete`;
  if (!nonEmpty(body['projectId']) || !nonEmpty(body['workspaceId']) || !nonEmpty(body['requestId'])) {
    return `${eventType} requires projectId, workspaceId and requestId`;
  }
  // [lead S5-T3-D9] a Host actor on SessionMessageResponded is shape-checked as a
  // Host sender here and admitted below only for a user decision card answer.
  const actor = eventType === SESSION_MESSAGE_RESPONDED_EVENT_TYPE
    ? (isObject(body['actor']) && body['actor']['kind'] === 'host'
      ? checkMessageSender(body['actor'])
      : checkResponseSender(body['actor']))
    : eventType === SESSION_MESSAGE_DECISION_APPLIED_EVENT_TYPE
      ? checkActorRefShape(body['actor'])
      : checkMessageSender(body['actor']);
  if (actor !== null) return `${eventType} actor: ${actor}`;
  const message = body['message'];
  if (!isObject(message)) return `${eventType} requires the complete message`;
  const messageProblem = checkSessionMessageBody(message);
  if (messageProblem !== null) return `${eventType} message: ${messageProblem}`;
  if (!isObject(message['ref'])) return `${eventType} message ref is invalid`;
  if (message['ref']['projectId'] !== body['projectId'] || message['ref']['workspaceId'] !== body['workspaceId']) {
    return `${eventType} message scope disagrees with the event scope`;
  }
  if (eventType === SESSION_MESSAGE_SENT_EVENT_TYPE
    && canonicalOf(body['actor']) !== canonicalOf(message['sender'])) {
    return 'SessionMessageSent actor must be the message sender';
  }
  if (eventType === SESSION_MESSAGE_READ_EVENT_TYPE
    && (!isObject(body['actor']) || body['actor']['kind'] !== 'work_run')) {
    return `${eventType} actor must be the formal work_run command identity`;
  }
  if (eventType === SESSION_MESSAGE_DERIVATION_EVENT_TYPE
    && (!isObject(body['actor']) || body['actor']['kind'] !== 'host')) {
    return `${eventType} actor must be the trusted Host identity`;
  }
  if (eventType === SESSION_MESSAGE_INPUT_ACCEPTED_EVENT_TYPE
    && (!isObject(body['actor']) || (body['actor']['kind'] !== 'work_run' && body['actor']['kind'] !== 'host'))) {
    return `${eventType} actor must be the observing Host or executing work_run identity`;
  }
  if (eventType === SESSION_MESSAGE_RESPONDED_EVENT_TYPE) {
    const actorKind = isObject(body['actor']) ? body['actor']['kind'] : undefined;
    // [lead S5-T3-D9, A10 defect 6] Slice 5 §2.3: the configured operator
    // answering a user decision card writes the original single response slot
    // with `SessionMessageResponded`; its actor is the trusted Host. Only a
    // user-recipient message whose response carries the decision metadata
    // admits it; every old Session reply keeps the work_run/query_run rule.
    const userDecisionAnswer = actorKind === 'host'
      && isObject(message['recipient']) && message['recipient']['kind'] === 'user'
      && isObject(message['response']) && isObject(message['response']['decision']);
    if (actorKind !== 'work_run' && actorKind !== 'query_run' && !userDecisionAnswer) {
      return `${eventType} actor must be the formal work_run or query_run command identity, or the trusted Host answering a user decision`;
    }
  }
  if (eventType === SESSION_MESSAGE_DECISION_ANSWERED_EVENT_TYPE
    && (!isObject(body['actor']) || body['actor']['kind'] !== 'host')) {
    return `${eventType} actor must be the trusted Host identity`;
  }
  return null;
}

// --------------------------------------------------------------------------
// Registered validators
// --------------------------------------------------------------------------

const ARCHIVE_WAIT_DISPOSED_EVENT_KEYS: readonly string[] = [
  'eventId', 'eventType', 'schemaVersion', 'occurredAt', 'projectId', 'workspaceId',
  'message', 'source', 'archiveStep',
];
const ARCHIVE_STEP_KINDS: readonly string[] = [
  'stop', 'anchor', 'requeue', 'responsibility', 'reply_handler', 'wait_cancel', 'archive',
];

function checkArchiveStep(value: unknown): Problem {
  if (!isObject(value) || !hasOnlyKeys(value, ['sessionRef', 'archiveRequestId', 'requestReceipt', 'step', 'subjectKey'])) {
    return 'archiveStep carries unknown fields';
  }
  const session = checkPlainSessionRef(value['sessionRef']);
  if (session !== null) return `archiveStep.sessionRef: ${session}`;
  if (!nonEmpty(value['archiveRequestId'])) return 'archiveStep.archiveRequestId is required';
  const receipt = value['requestReceipt'];
  if (!isObject(receipt) || !hasOnlyKeys(receipt, ['identityKey', 'fingerprint'])
    || !nonEmpty(receipt['identityKey']) || !nonEmpty(receipt['fingerprint'])) {
    return 'archiveStep.requestReceipt must be {identityKey,fingerprint}';
  }
  if (!ARCHIVE_STEP_KINDS.includes(String(value['step']))) return 'archiveStep.step is not recognized';
  if (!nonEmpty(value['subjectKey'])) return 'archiveStep.subjectKey is required';
  return null;
}

function checkArchiveWaitDisposedBody(body: UnknownRecord): Problem {
  if (!hasOnlyKeys(body, ARCHIVE_WAIT_DISPOSED_EVENT_KEYS)) return 'ArchiveWaitDisposed carries unknown fields';
  if (!nonEmpty(body['projectId']) || !nonEmpty(body['workspaceId'])) {
    return 'ArchiveWaitDisposed requires projectId and workspaceId';
  }
  const message = body['message'];
  if (!isObject(message)) return 'ArchiveWaitDisposed requires the changed message';
  const messageProblem = checkSessionMessageBody(message);
  if (messageProblem !== null) return `ArchiveWaitDisposed message: ${messageProblem}`;
  if (!isObject(message['ref']) || message['ref']['projectId'] !== body['projectId']
    || message['ref']['workspaceId'] !== body['workspaceId']) {
    return 'ArchiveWaitDisposed message scope disagrees with the event scope';
  }
  const source = body['source'];
  if (!isObject(source)) return 'ArchiveWaitDisposed requires the changed source SessionRecord';
  const sourceProblem = checkSessionBody(source);
  if (sourceProblem !== null) return `ArchiveWaitDisposed source: ${sourceProblem}`;
  if (!isObject(source['ref']) || source['ref']['projectId'] !== body['projectId']
    || source['workspaceId'] !== body['workspaceId']) {
    return 'ArchiveWaitDisposed source disagrees with the event scope';
  }
  const step = checkArchiveStep(body['archiveStep']);
  if (step !== null) return `ArchiveWaitDisposed archiveStep: ${step}`;
  const stepValue = body['archiveStep'] as UnknownRecord;
  const stepSession = stepValue['sessionRef'] as UnknownRecord;
  if (stepSession['sessionId'] !== (source['ref'] as UnknownRecord)['sessionId']) {
    return 'ArchiveWaitDisposed archiveStep does not name the source Session';
  }
  if (stepValue['step'] !== 'reply_handler' && stepValue['step'] !== 'wait_cancel') {
    return 'ArchiveWaitDisposed archiveStep must be reply_handler or wait_cancel';
  }
  if (stepValue['step'] === 'reply_handler') {
    const handler = message['replyHandler'];
    if (!isObject(handler) || handler['archiveRequestId'] !== stepValue['archiveRequestId']
      || (handler['archiveSessionRef'] as Record<string, unknown>)['sessionId'] !== stepSession['sessionId']) {
      return 'ArchiveWaitDisposed transfer must record the transferred reply handler';
    }
  } else {
    const disposition = message['archiveWaitDisposition'];
    if (!isObject(disposition) || disposition['kind'] !== 'cancel'
      || disposition['archiveRequestId'] !== stepValue['archiveRequestId']
      || (disposition['archiveSessionRef'] as Record<string, unknown>)['sessionId'] !== stepSession['sessionId']) {
      return 'ArchiveWaitDisposed cancel must record the cancelled wait disposition';
    }
  }
  return null;
}

function validateArchiveWaitDisposedEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  const decoded = archiveWaitDisposedEventFromEvent(event);
  return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
}

// --------------------------------------------------------------------------
// Registered validators
// --------------------------------------------------------------------------

function validateRecord(record: EncodedRecord): DecodeResult<EncodedRecord> {
  if (record.schemaId !== SESSION_MESSAGE_SCHEMA_ID) {
    return invalid(`expected schemaId ${SESSION_MESSAGE_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const parsed = parseJsonObject(record.json);
  if (parsed.status === 'invalid') return invalid(`SessionMessage record json is not an object: ${parsed.reason}`);
  const body = parsed.value;
  if (!isObject(body['ref']) || !isPositiveInt(body['revision']) || body['revision'] !== record.revision) {
    return invalid('SessionMessage record envelope is invalid');
  }
  const canonical = canonicalOf(body['ref']);
  if (canonical === null || canonical !== record.refKey) {
    return invalid('SessionMessage refKey disagrees with the record body');
  }
  const problem = checkSessionMessageBody(body, true);
  if (problem !== null) return invalid(`SessionMessage record payload is invalid: ${problem}`);
  return { status: 'decoded', value: record };
}

function validateEvent(event: EncodedDomainEvent, eventType: string): DecodeResult<EncodedDomainEvent> {
  if (event.eventType !== eventType) return invalid(`expected eventType ${eventType}, got ${event.eventType}`);
  if (event.schemaVersion !== SESSION_MESSAGE_EVENT_SCHEMA_VERSION) {
    return invalid(`expected schemaVersion ${SESSION_MESSAGE_EVENT_SCHEMA_VERSION}, got ${event.schemaVersion}`);
  }
  if (!nonEmpty(event.eventId) || !nonEmpty(event.occurredAt)) return invalid(`${eventType} envelope is incomplete`);
  const parsed = parseJsonObject(event.json);
  if (parsed.status === 'invalid') return invalid(`${eventType} event json is not an object: ${parsed.reason}`);
  const body = parsed.value;
  if (body['eventId'] !== event.eventId || body['eventType'] !== event.eventType
    || body['schemaVersion'] !== event.schemaVersion || body['occurredAt'] !== event.occurredAt) {
    return invalid(`${eventType} event envelope disagrees with the event json`);
  }
  const problem = checkEventBody(body, eventType);
  if (problem !== null) return invalid(`${eventType} event payload is invalid: ${problem}`);
  return { status: 'decoded', value: event };
}

// --------------------------------------------------------------------------
// The single registration
// --------------------------------------------------------------------------

export const SESSION_MESSAGE_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [
    {
      aggregateType: 'SessionMessage',
      schemaId: SESSION_MESSAGE_SCHEMA_ID,
      // Slice 5: the notification origin `since` is bound from the real commit
      // cursor in the same transaction (SPEC §2.5 line 289). Wiring package 2
      // adds the first-response position (spec §2.3 P02).
      commitCursorFields: ['since', 'responseSince'],
      validate: validateRecord,
    },
  ],
  events: [
    { eventType: SESSION_MESSAGE_SENT_EVENT_TYPE, schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
      validate: (event) => validateEvent(event, SESSION_MESSAGE_SENT_EVENT_TYPE) },
    { eventType: SESSION_MESSAGE_READ_EVENT_TYPE, schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
      validate: (event) => validateEvent(event, SESSION_MESSAGE_READ_EVENT_TYPE) },
    { eventType: SESSION_MESSAGE_RESPONDED_EVENT_TYPE, schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
      validate: (event) => validateEvent(event, SESSION_MESSAGE_RESPONDED_EVENT_TYPE) },
    { eventType: SESSION_MESSAGE_DERIVATION_EVENT_TYPE, schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
      validate: (event) => validateEvent(event, SESSION_MESSAGE_DERIVATION_EVENT_TYPE) },
    { eventType: SESSION_MESSAGE_INPUT_ACCEPTED_EVENT_TYPE, schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
      validate: (event) => validateEvent(event, SESSION_MESSAGE_INPUT_ACCEPTED_EVENT_TYPE) },
    { eventType: ARCHIVE_WAIT_DISPOSED_EVENT_TYPE, schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
      validate: validateArchiveWaitDisposedEvent },
    { eventType: SESSION_MESSAGE_DECISION_ANSWERED_EVENT_TYPE, schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
      validate: (event) => validateEvent(event, SESSION_MESSAGE_DECISION_ANSWERED_EVENT_TYPE) },
    { eventType: SESSION_MESSAGE_DECISION_APPLIED_EVENT_TYPE, schemaVersion: SESSION_MESSAGE_EVENT_SCHEMA_VERSION,
      validate: (event) => validateEvent(event, SESSION_MESSAGE_DECISION_APPLIED_EVENT_TYPE) },
  ],
  lookups: [...SESSION_MESSAGE_LOOKUP_INDEXES, ...S5_SESSION_MESSAGE_LOOKUP_INDEXES, ...S2A_SESSION_MESSAGE_LOOKUP_INDEXES],
};

// --------------------------------------------------------------------------
// Canonical keys and encode helpers
// --------------------------------------------------------------------------

/** Full canonical key of a SessionMessage aggregate (never a bare messageId). */
export function sessionMessageRefKey(ref: SessionMessageRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}

export function encodeSessionMessageRecord(message: SessionMessage, origin?: NoticeOriginWireV1): EncodedRecord {
  // The public DTO is written byte-for-byte; the optional origin wire fields are
  // merged on top only when the caller supplies them (SPEC §2.5 line 291).
  return {
    refKey: sessionMessageRefKey(message.ref),
    schemaId: SESSION_MESSAGE_SCHEMA_ID,
    revision: message.revision,
    json: JSON.stringify(origin === undefined ? message : { ...message, ...origin }),
  };
}

function encodeMessageEvent(event: SessionMessageEventV1): EncodedDomainEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    json: JSON.stringify(event),
  };
}

export function encodeSessionMessageSentEvent(event: SessionMessageSentEventV1): EncodedDomainEvent {
  return encodeMessageEvent(event);
}
export function encodeSessionMessageReadEvent(event: SessionMessageReadEventV1): EncodedDomainEvent {
  return encodeMessageEvent(event);
}
export function encodeSessionMessageRespondedEvent(event: SessionMessageRespondedEventV1): EncodedDomainEvent {
  return encodeMessageEvent(event);
}
export function encodeSessionMessageConsultationDerivedEvent(event: SessionMessageConsultationDerivedEventV1): EncodedDomainEvent {
  return encodeMessageEvent(event);
}
export function encodeSessionMessageInputAcceptedEvent(event: SessionMessageInputAcceptedEventV1): EncodedDomainEvent {
  return encodeMessageEvent(event);
}
export function encodeSessionMessageDecisionAnsweredEvent(event: SessionMessageDecisionAnsweredEventV1): EncodedDomainEvent {
  return encodeMessageEvent(event);
}
export function encodeSessionMessageDecisionAppliedEvent(event: SessionMessageDecisionAppliedEventV1): EncodedDomainEvent {
  return encodeMessageEvent(event);
}

export function encodeArchiveWaitDisposedEvent(event: ArchiveWaitDisposedEventV1): EncodedDomainEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    json: JSON.stringify(event),
  };
}

// --------------------------------------------------------------------------
// Typed decoders (read/replay path)
// --------------------------------------------------------------------------

export function decodeSessionMessageRecord(record: EncodedRecord): DecodeResult<SessionMessage> {
  const checked = validateRecord(record);
  if (checked.status !== 'decoded') return checked;
  const parsed = parseJsonObject(record.json);
  if (parsed.status === 'invalid') return invalid('SessionMessage record json is not an object');
  // R2 exception (reported): the frozen S1 test `S1-codecs-indexes` SV01 asserts
  // an explicit `null` on a decoded old Message, so this codec keeps the §2.9
  // null default for the two optional wait fields.
  // The origin wire (`since`/`noticeAutomationCap`) is NOT part of the old
  // public DTO; `decodeNoticeOrigin` reads it separately (SPEC §2.5 line 291).
  const wire = { ...parsed.value };
  delete wire['since'];
  delete wire['noticeAutomationCap'];
  const message = wire as unknown as SessionMessage;
  return { status: 'decoded', value: { ...message,
    replyHandler: message.replyHandler ?? null, archiveWaitDisposition: message.archiveWaitDisposition ?? null } };
}

// `decodeNoticeOrigin` is re-exported at the top of this module from its single
// declaration in `persistence/decision-record-codecs.ts` (A7).

/**
 * Restores the ORIGINAL message of a recorded send/read/respond event. This is
 * the only source a replay may use; it never re-derives current state.
 */
export function sessionMessageFromEvent(event: EncodedDomainEvent): DecodeResult<SessionMessage> {
  const eventType = event.eventType;
  if (eventType !== SESSION_MESSAGE_SENT_EVENT_TYPE && eventType !== SESSION_MESSAGE_READ_EVENT_TYPE
    && eventType !== SESSION_MESSAGE_RESPONDED_EVENT_TYPE && eventType !== SESSION_MESSAGE_DERIVATION_EVENT_TYPE
    && eventType !== SESSION_MESSAGE_INPUT_ACCEPTED_EVENT_TYPE
    && eventType !== SESSION_MESSAGE_DECISION_ANSWERED_EVENT_TYPE
    && eventType !== SESSION_MESSAGE_DECISION_APPLIED_EVENT_TYPE) {
    return invalid(`eventType ${String(eventType)} is not a SessionMessage event`);
  }
  const checked = validateEvent(event, eventType);
  if (checked.status !== 'decoded') return checked;
  const parsed = parseJsonObject(event.json);
  if (parsed.status === 'invalid') return invalid(`${eventType} event json is not an object`);
  // Rule 1 (lead fix 2026-10-09): a replay returns the ORIGINAL event value, so the
  // event payload keeps exactly the keys it was written with; only the record
  // decoder applies the §2.9 null default (SV01). Readers use `?? null`.
  const message = parsed.value['message'] as SessionMessage;
  return { status: 'decoded', value: message };
}

export function archiveWaitDisposedEventFromEvent(
  event: EncodedDomainEvent,
): DecodeResult<ArchiveWaitDisposedEventV1> {
  if (event.eventType !== ARCHIVE_WAIT_DISPOSED_EVENT_TYPE) {
    return invalid(`expected eventType ArchiveWaitDisposed, got ${event.eventType}`);
  }
  if (event.schemaVersion !== SESSION_MESSAGE_EVENT_SCHEMA_VERSION) {
    return invalid(`expected schemaVersion ${String(SESSION_MESSAGE_EVENT_SCHEMA_VERSION)}, got ${String(event.schemaVersion)}`);
  }
  if (!nonEmpty(event.eventId) || !nonEmpty(event.occurredAt)) return invalid('ArchiveWaitDisposed envelope is incomplete');
  const parsed = parseJsonObject(event.json);
  if (parsed.status === 'invalid') return invalid(`ArchiveWaitDisposed event json is not an object: ${parsed.reason}`);
  const body = parsed.value;
  if (body['eventId'] !== event.eventId || body['eventType'] !== event.eventType
    || body['schemaVersion'] !== event.schemaVersion || body['occurredAt'] !== event.occurredAt) {
    return invalid('ArchiveWaitDisposed event envelope disagrees with the event json');
  }
  const problem = checkArchiveWaitDisposedBody(body);
  if (problem !== null) return invalid(`ArchiveWaitDisposed event payload is invalid: ${problem}`);
  return { status: 'decoded', value: body as unknown as ArchiveWaitDisposedEventV1 };
}

