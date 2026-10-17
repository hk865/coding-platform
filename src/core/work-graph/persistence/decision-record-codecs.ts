/**
 * Slice 5 decision write-event codecs (spec §2.2, §2.5, §2.7, §2.8).
 *
 * This is the ONE codec owner of the two NEW decision write events:
 *   - `GoalSettingsChanged@1` (one Goal's settings, or a whole workspace reorder);
 *   - `WorkspaceNoticeSeenChanged@1` (one Workspace notice cursor page).
 *
 * Both follow the `configuration/project-bootstrap-record-codecs.ts:
 * ProjectBootstrapEventBody` style: the event carries the EXACT value written by
 * the same commit plus its actor/request identity and a §2.8 change proof, so a
 * receipt replay restores the original result instead of guessing it from the
 * current record. The pure declarations live in
 * `model/decision-contracts.ts`; this file only encodes/decodes them.
 *
 * It also owns `decodeNoticeOrigin`, the wire-only notice origin reader shared
 * by SessionMessage/TaskRequeue/VerificationRound, and the pure receipt-fact
 * checks. The two event decoders return the exact persisted body unchanged.
 */
import type {
  GoalSettingsChangedEventV1,
  WorkspaceNoticeSeenChangedEventV1,
} from '../model/decision-contracts.js';
import type {
  DecodeResult,
  EncodedDomainEvent,
  EncodedRecord,
  RecordBackendSchemas,
} from '../../record-store/ports.js';
import {
  goalSettingsProblem,
  goalSnapshotValueProblem,
  workspaceSnapshotValueProblem,
} from './record-codecs.js';
import { noticeOriginFieldsProblem, type NoticeOriginWireV1 } from './rework-codecs.js';
export type { NoticeOriginWireV1 } from './rework-codecs.js';

// --------------------------------------------------------------------------
// Fixed registration identifiers
// --------------------------------------------------------------------------

export const GOAL_SETTINGS_CHANGED_EVENT = 'GoalSettingsChanged' as const;
export const WORKSPACE_NOTICE_SEEN_CHANGED_EVENT = 'WorkspaceNoticeSeenChanged' as const;
export const DECISION_EVENT_SCHEMA_VERSION = 1 as const;

/** The encoding selectors (never an aggregate revision). */
export const GOAL_SETTINGS_CHANGED_SCHEMA_ID = 'GoalSettingsChanged@1' as const;
export const WORKSPACE_NOTICE_SEEN_CHANGED_SCHEMA_ID = 'WorkspaceNoticeSeenChanged@1' as const;

// --------------------------------------------------------------------------
// Encoders / decoders
// --------------------------------------------------------------------------

export function encodeGoalSettingsChangedEvent(event: GoalSettingsChangedEventV1): EncodedDomainEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    json: JSON.stringify(event),
  };
}

export function decodeGoalSettingsChangedEvent(
  event: EncodedDomainEvent,
): DecodeResult<GoalSettingsChangedEventV1> {
  const problem = decisionEventEnvelopeProblem(event, GOAL_SETTINGS_CHANGED_EVENT);
  if (problem !== null) return invalid(problem);
  const parsed = parseJsonObject(event.json, 'GoalSettingsChanged event');
  if (typeof parsed === 'string') return invalid(parsed);
  const bindingProblem = decisionEventBodyEnvelopeProblem(parsed, event, GOAL_SETTINGS_CHANGED_EVENT);
  if (bindingProblem !== null) return invalid(bindingProblem);
  const bodyProblem = goalSettingsChangedEventProblem(parsed);
  if (bodyProblem !== null) return invalid(bodyProblem);
  return { status: 'decoded', value: parsed as unknown as GoalSettingsChangedEventV1 };
}

export function encodeWorkspaceNoticeSeenChangedEvent(
  event: WorkspaceNoticeSeenChangedEventV1,
): EncodedDomainEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    json: JSON.stringify(event),
  };
}

export function decodeWorkspaceNoticeSeenChangedEvent(
  event: EncodedDomainEvent,
): DecodeResult<WorkspaceNoticeSeenChangedEventV1> {
  const problem = decisionEventEnvelopeProblem(event, WORKSPACE_NOTICE_SEEN_CHANGED_EVENT);
  if (problem !== null) return invalid(problem);
  const parsed = parseJsonObject(event.json, 'WorkspaceNoticeSeenChanged event');
  if (typeof parsed === 'string') return invalid(parsed);
  const bindingProblem = decisionEventBodyEnvelopeProblem(parsed, event, WORKSPACE_NOTICE_SEEN_CHANGED_EVENT);
  if (bindingProblem !== null) return invalid(bindingProblem);
  const bodyProblem = workspaceNoticeSeenChangedEventProblem(parsed);
  if (bodyProblem !== null) return invalid(bodyProblem);
  return { status: 'decoded', value: parsed as unknown as WorkspaceNoticeSeenChangedEventV1 };
}

// --------------------------------------------------------------------------
// Shared pure shape helpers (the events are the only new persisted bodies)
// --------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
function hasOnlyKeys(value: UnknownRecord, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function invalid(reason: string): { status: 'invalid'; reason: string } {
  return { status: 'invalid', reason };
}
function parseJsonObject(json: string, what: string): UnknownRecord | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return `${what} is not valid JSON`;
  }
  return isRecord(parsed) ? parsed : `${what} JSON must be an object`;
}

const DECISION_EVENT_ENVELOPE_KEYS: readonly string[] = ['eventId', 'eventType', 'schemaVersion', 'occurredAt'];

function decisionEventEnvelopeProblem(event: EncodedDomainEvent, eventType: string): string | null {
  if (event.eventType !== eventType) return `expected eventType ${eventType}, got ${event.eventType}`;
  if (event.schemaVersion !== DECISION_EVENT_SCHEMA_VERSION) {
    return `expected schemaVersion ${String(DECISION_EVENT_SCHEMA_VERSION)}, got ${String(event.schemaVersion)}`;
  }
  if (!nonEmpty(event.eventId)) return `${eventType} eventId must be a non-empty string`;
  if (!nonEmpty(event.occurredAt)) return `${eventType} occurredAt must be a non-empty string`;
  return null;
}

/**
 * §2.8/§8.2: the outer `EncodedDomainEvent` envelope and the persisted JSON body
 * must agree on event id/type/version/time; the body alone is never trusted
 * because the decoder returns it as the event value.
 */
function decisionEventBodyEnvelopeProblem(
  body: UnknownRecord, event: EncodedDomainEvent, eventType: string,
): string | null {
  if (body['eventId'] !== event.eventId) return `${eventType} body eventId disagrees with the encoded event`;
  if (body['eventType'] !== event.eventType) return `${eventType} body eventType disagrees with the encoded event`;
  if (body['schemaVersion'] !== event.schemaVersion) {
    return `${eventType} body schemaVersion disagrees with the encoded event`;
  }
  if (body['occurredAt'] !== event.occurredAt) return `${eventType} body occurredAt disagrees with the encoded event`;
  return null;
}

/** Mirrors `contracts/validation/identity.ts::validateActor` at the wire boundary. */
function actorProblem(value: unknown): string | null {
  if (!isRecord(value) || !nonEmpty(value['id'])) return 'the event actor must be an ActorRef';
  if (value['kind'] === 'human' || value['kind'] === 'system') {
    return hasOnlyKeys(value, ['kind', 'id']) ? null : 'the event actor carries unknown fields';
  }
  if (value['kind'] !== 'agent') return 'the event actor kind must be human, system or agent';
  if (!hasOnlyKeys(value, ['kind', 'id', 'runRef'])) return 'the event agent actor carries unknown fields';
  const runRef = value['runRef'];
  if (!isRecord(runRef) || !hasOnlyKeys(runRef, ['aggregateType', 'projectId', 'goalId', 'runId'])
    || runRef['aggregateType'] !== 'Run' || !nonEmpty(runRef['projectId'])
    || !nonEmpty(runRef['goalId']) || !nonEmpty(runRef['runId'])) {
    return 'the event agent actor runRef must be a complete RunRef';
  }
  return null;
}

function sessionMessageRefProblem(value: unknown): string | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'workspaceId', 'messageId'])) {
    return 'the acknowledgement ref must be a complete SessionMessageRef';
  }
  return value['aggregateType'] === 'SessionMessage' && nonEmpty(value['projectId'])
    && nonEmpty(value['workspaceId']) && nonEmpty(value['messageId'])
    ? null : 'the acknowledgement ref is not a valid SessionMessageRef';
}

/**
 * §3.3 line 625 / §8.2 ("bad field → unavailable"): every aggregate-specific
 * identity field of the `AggregateRef` union, so a pin ref that carries only
 * `aggregateType` (or the wrong fields) is never accepted as a complete ref.
 */
type AggregateRefRule = { strings: readonly string[]; integers?: readonly string[]; objects?: readonly string[] };

const AGGREGATE_REF_RULES: Readonly<Record<string, AggregateRefRule>> = {
  Session: { strings: ['projectId', 'sessionId'] },
  SessionWorkLink: { strings: ['projectId', 'sessionId', 'relation'], objects: ['target'] },
  CoreOperation: { strings: ['projectId', 'operationId'] },
  TaskReviewProtocol: { strings: ['projectId', 'goalId', 'taskId', 'planId'] },
  ReviewWork: { strings: ['projectId', 'workspaceId', 'goalId', 'reviewId'] },
  ReviewResult: { strings: ['projectId', 'workspaceId', 'goalId', 'reviewId'] },
  Project: { strings: ['projectId'] },
  Workspace: { strings: ['projectId', 'workspaceId'] },
  Goal: { strings: ['projectId', 'goalId'] },
  CompletionPolicyRevision: { strings: ['projectId', 'policyId'], integers: ['revision'] },
  ArchitectureBaselineRevision: { strings: ['projectId', 'baselineId'], integers: ['revision'] },
  ProjectCompletionPolicyActive: { strings: ['projectId'] },
  ProjectArchitectureBaselineActive: { strings: ['projectId'] },
  PlanRevision: { strings: ['projectId', 'planId'] },
  TaskLease: { strings: ['projectId', 'goalId', 'taskId'] },
  TaskAttempt: { strings: ['projectId', 'goalId', 'taskId', 'attemptId'] },
  Run: { strings: ['projectId', 'goalId', 'runId'] },
  DispatchOutboxEntry: { strings: ['projectId', 'goalId', 'taskId', 'attemptId'] },
  Evidence: { strings: ['projectId', 'evidenceId'] },
  TaskEvidenceIndex: { strings: ['projectId', 'goalId', 'taskId'] },
  VerificationRound: { strings: ['projectId', 'workspaceId', 'goalId', 'taskId', 'runId', 'roundId'] },
  TaskReduction: { strings: ['projectId', 'goalId', 'taskId'] },
  GoalPhase: { strings: ['projectId', 'goalId'] },
  WorkContextBinding: { strings: ['projectId', 'workspaceId', 'workId'] },
  ControlIntent: { strings: ['projectId', 'workspaceId', 'intentId'] },
  QueryJob: { strings: ['projectId', 'workspaceId', 'queryJobId'] },
  QueryRun: { strings: ['projectId', 'workspaceId', 'queryJobId', 'runId'] },
  QueryJobAnswer: { strings: ['projectId', 'workspaceId', 'queryJobId', 'answerId'] },
  Task: { strings: ['projectId', 'goalId', 'taskId'] },
  PlanProposal: { strings: ['projectId', 'workspaceId', 'proposalId'] },
  UserDecision: { strings: ['projectId', 'workspaceId', 'decisionId'] },
  CoordinationPolicyRevision: { strings: ['projectId', 'policyId'], integers: ['revision'] },
  ProjectCoordinationPolicyActive: { strings: ['projectId'] },
  RoleSpecRevision: { strings: ['projectId', 'roleId'], integers: ['revision'] },
  ProjectRoleSpecActive: { strings: ['projectId', 'roleId'] },
  MaterialAccessGrant: { strings: ['projectId', 'workspaceId', 'goalId', 'grantId'] },
  WorkParticipation: { strings: ['projectId', 'workspaceId', 'workId', 'participationId'] },
  ModelRequestPermit: { strings: ['projectId', 'workspaceId', 'permitId'] },
  SessionMessage: { strings: ['projectId', 'workspaceId', 'messageId'] },
  TaskRequeue: { strings: ['projectId', 'goalId', 'taskId', 'afterRunId'] },
  TaskReworkRefusal: { strings: ['projectId', 'goalId', 'taskId', 'operation', 'subjectId'] },
  // 4C-2 U3: the note-card proof pins name the note aggregates (the card's
  // captured note and each superseded head). Rework item 4: every changed
  // object is the SAME NoteHead aggregate (`@v -> @v+1`), so no NoteVersion
  // ref rule is needed.
  NoteHead: { strings: ['projectId', 'noteId'] },
  CurrentPointer: { strings: ['projectId', 'anchorKey'] },
};

/**
 * The complete-aggregate-ref shape check shared by the decision pin validators
 * in this file and `sessions/message-record-codecs.ts` (spec §3.3 line 625,
 * §8.2 data row). It grants nothing and performs no I/O.
 */
export function aggregateRefProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'an aggregate ref must be an object';
  const aggregateType = value['aggregateType'];
  if (!nonEmpty(aggregateType)) return 'an aggregate ref must carry a non-empty aggregateType';
  const rule = AGGREGATE_REF_RULES[aggregateType];
  if (rule === undefined) return `the aggregate ref type ${aggregateType} is not a known aggregate`;
  for (const field of rule.strings) {
    if (!nonEmpty(value[field])) return `an aggregate ref ${aggregateType} requires a non-empty ${field}`;
  }
  for (const field of rule.integers ?? []) {
    const revision = value[field];
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) {
      return `an aggregate ref ${aggregateType} requires a positive integer ${field}`;
    }
  }
  for (const field of rule.objects ?? []) {
    if (!isRecord(value[field])) return `an aggregate ref ${aggregateType} requires an object ${field}`;
  }
  return aggregateType === 'SessionWorkLink' ? sessionWorkLinkPinProblem(value) : null;
}

/** #22 (lead): the closed `WorkLinkTarget` ref fields per kind (`contracts/core/identity.ts`). */
const WORK_LINK_TARGET_REF_FIELDS: Readonly<Record<string, readonly string[]>> = {
  task: ['projectId', 'goalId', 'taskId'],
  module: ['projectId', 'moduleId'],
  work: ['aggregateType', 'projectId', 'workspaceId', 'workId'],
};

/** #22 (lead): a SessionWorkLink pin names a real relation and a well-formed target in its own project. */
function sessionWorkLinkPinProblem(value: UnknownRecord): string | null {
  const relation = value['relation'];
  if (relation !== 'responsible' && relation !== 'participates' && relation !== 'investigated') {
    return 'an aggregate ref SessionWorkLink requires a known relation';
  }
  const target = value['target'] as UnknownRecord;
  const kind = target['kind'];
  const fields = typeof kind === 'string' ? WORK_LINK_TARGET_REF_FIELDS[kind] : undefined;
  const ref = target['ref'];
  if (fields === undefined || !hasOnlyKeys(target, ['kind', 'ref']) || !isRecord(ref) || !hasOnlyKeys(ref, fields)
    || fields.some((field) => !nonEmpty(ref[field]))
    || (kind === 'work' && ref['aggregateType'] !== 'WorkContextBinding')) {
    return 'an aggregate ref SessionWorkLink requires a task, work or module target';
  }
  if (ref['projectId'] !== value['projectId']) return 'an aggregate ref SessionWorkLink target belongs to another project';
  return null;
}

/**
 * A `VersionPin` check. A stored record revision starts at 1 (§2.1); the only
 * pin allowed to be 0 is a change proof's `changes[].before`, the named absence
 * pin the Store translates to `expectedRevision: null` (`allowAbsence`).
 */
function versionPinProblem(value: unknown, allowAbsence = false): string | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['ref', 'revision'])) return 'a version pin must carry ref and revision';
  const refProblem = aggregateRefProblem(value['ref']);
  if (refProblem !== null) return refProblem;
  const revision = value['revision'];
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision)
    || (allowAbsence ? revision < 0 : revision < 1)) {
    return `a version pin revision must be ${allowAbsence ? 'a non-negative' : 'a positive'} safe integer`;
  }
  return null;
}

function goalRefProblem(value: unknown): string | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'goalId'])) {
    return 'a decision basis goalRef must be a GoalRef';
  }
  return value['aggregateType'] === 'Goal' && nonEmpty(value['projectId']) && nonEmpty(value['goalId'])
    ? null : 'a decision basis goalRef is not a valid GoalRef';
}

function workspaceRefProblem(value: unknown): string | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'workspaceId'])) {
    return 'a decision basis workspaceRef must be a WorkspaceRef';
  }
  return value['aggregateType'] === 'Workspace' && nonEmpty(value['projectId']) && nonEmpty(value['workspaceId'])
    ? null : 'a decision basis workspaceRef is not a valid WorkspaceRef';
}

function planRevisionRefProblem(value: unknown): string | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'planId'])) {
    return 'a decision basis activePlanRef must be a PlanRevisionRef';
  }
  return value['aggregateType'] === 'PlanRevision' && nonEmpty(value['projectId']) && nonEmpty(value['planId'])
    ? null : 'a decision basis activePlanRef is not a valid PlanRevisionRef';
}

function goalDecisionBasisProblem(value: unknown): string | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['goalRef', 'workspaceRef', 'objective', 'activePlanRef', 'settings'])) {
    return 'a GoalDecisionBasisV1 must carry exactly goalRef, workspaceRef, objective, activePlanRef and settings';
  }
  const goal = goalRefProblem(value['goalRef']);
  if (goal !== null) return goal;
  const workspace = workspaceRefProblem(value['workspaceRef']);
  if (workspace !== null) return workspace;
  if (typeof value['objective'] !== 'string') return 'a GoalDecisionBasisV1 objective must be a string';
  if (value['activePlanRef'] !== null) {
    const plan = planRevisionRefProblem(value['activePlanRef']);
    if (plan !== null) return plan;
  }
  const settings = goalSettingsProblem(value['settings'], (value['goalRef'] as UnknownRecord)['projectId'] as string);
  return settings === null ? null : `a GoalDecisionBasisV1 settings: ${settings}`;
}

function goalControlRebaseProblem(value: unknown): string | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['captured', 'actualBefore', 'basis'])) {
    return 'a GoalControlRebaseV1 must carry exactly captured, actualBefore and basis';
  }
  const captured = versionPinProblem(value['captured']);
  if (captured !== null) return captured;
  const actual = versionPinProblem(value['actualBefore']);
  if (actual !== null) return actual;
  return goalDecisionBasisProblem(value['basis']);
}

/**
 * The §2.8 `DecisionChangeProofV1` shape check: the acknowledgement ref, the
 * captured pins, the exact before/after change set and the Goal control rebases.
 * It is a pure persisted-shape check and grants nothing.
 */
export function decisionChangeProofProblem(value: unknown): string | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['acknowledgementRef', 'capturedPins', 'changes', 'basisRebases'])) {
    return 'a DecisionChangeProofV1 must carry exactly acknowledgementRef, capturedPins, changes and basisRebases';
  }
  const acknowledgement = sessionMessageRefProblem(value['acknowledgementRef']);
  if (acknowledgement !== null) return acknowledgement;
  const capturedPins = value['capturedPins'];
  if (!Array.isArray(capturedPins)) return 'a DecisionChangeProofV1 capturedPins must be an array';
  for (const pin of capturedPins) {
    const problem = versionPinProblem(pin);
    if (problem !== null) return problem;
  }
  const changes = value['changes'];
  if (!Array.isArray(changes)) return 'a DecisionChangeProofV1 changes must be an array';
  for (const change of changes) {
    if (!isRecord(change) || !hasOnlyKeys(change, ['before', 'after'])) {
      return 'a DecisionChangeProofV1 change must carry exactly before and after';
    }
    // §2.1: only a `before` may be the revision-0 absence pin; `after` and every
    // other proof pin require a real positive revision.
    const before = versionPinProblem(change['before'], true);
    if (before !== null) return before;
    const after = versionPinProblem(change['after']);
    if (after !== null) return after;
  }
  const rebases = value['basisRebases'];
  if (!Array.isArray(rebases)) return 'a DecisionChangeProofV1 basisRebases must be an array';
  for (const rebase of rebases) {
    const problem = goalControlRebaseProblem(rebase);
    if (problem !== null) return problem;
  }
  return null;
}

const DECISION_EVENT_BODY_KEYS: readonly string[] = [
  'identityKey', 'fingerprint', 'projectId', 'workspaceId', 'actor', 'requestId', 'payload',
];

function decisionEventBodyProblem(value: unknown): UnknownRecord | string {
  if (!isRecord(value)) return 'the event body must be an object';
  if (!hasOnlyKeys(value, [...DECISION_EVENT_ENVELOPE_KEYS, ...DECISION_EVENT_BODY_KEYS])) {
    return 'the event body carries unknown fields';
  }
  if (!nonEmpty(value['identityKey'])) return 'the event identityKey must be a non-empty string';
  if (!isSha256Hex(value['fingerprint'])) return 'the event fingerprint must be a lowercase sha256 hex';
  if (!nonEmpty(value['projectId'])) return 'the event projectId must be a non-empty string';
  if (!nonEmpty(value['workspaceId'])) return 'the event workspaceId must be a non-empty string';
  if (!nonEmpty(value['requestId'])) return 'the event requestId must be a non-empty string';
  const actor = actorProblem(value['actor']);
  if (actor !== null) return actor;
  const payload = value['payload'];
  if (!isRecord(payload) || !hasOnlyKeys(payload, ['value', 'proof'])) {
    return 'the event payload must carry exactly value and proof';
  }
  return value;
}

function goalSettingsChangedValueProblem(value: unknown): string | null {
  // A reorder writes the whole `{goals: GoalSnapshot[]}` result; a single
  // settings write writes one exact Goal snapshot. Anything else is invalid.
  if (isRecord(value) && hasOnlyKeys(value, ['goals'])) {
    const goals = value['goals'];
    if (!Array.isArray(goals) || goals.length === 0) return 'a GoalSettingsChanged goals value must be a non-empty array';
    for (const goal of goals) {
      const problem = goalSnapshotValueProblem(goal);
      if (problem !== null) return problem;
    }
    return null;
  }
  return goalSnapshotValueProblem(value);
}

function proofProblem(value: unknown): string | null {
  if (value === null) return null;
  return decisionChangeProofProblem(value);
}

/** Pure `GoalSettingsChanged@1` body check, excluding the normal event envelope. */
export function goalSettingsChangedEventProblem(value: unknown): string | null {
  const body = decisionEventBodyProblem(value);
  if (typeof body === 'string') return body;
  const valueProblem = goalSettingsChangedValueProblem((body['payload'] as UnknownRecord)['value']);
  if (valueProblem !== null) return valueProblem;
  return proofProblem((body['payload'] as UnknownRecord)['proof']);
}

/** Pure `WorkspaceNoticeSeenChanged@1` body check, excluding the normal event envelope. */
export function workspaceNoticeSeenChangedEventProblem(value: unknown): string | null {
  const body = decisionEventBodyProblem(value);
  if (typeof body === 'string') return body;
  const payload = body['payload'] as UnknownRecord;
  if (payload['proof'] !== null) return 'a WorkspaceNoticeSeenChanged proof must be null';
  return workspaceSnapshotValueProblem(payload['value']);
}

// --------------------------------------------------------------------------
// Notice origin read (wire-only; never the public DTO)
// --------------------------------------------------------------------------

/**
 * Reads the wire origin (`since`/`noticeAutomationCap`) of a SessionMessage,
 * TaskRequeue or VerificationRound record. It never changes that record's public
 * DTO: the old decoder still returns the old value, and an old record without a
 * `since` reads as the legacy `(occurredAt, itemKey)` position in the reader.
 */
export function decodeNoticeOrigin(record: EncodedRecord): DecodeResult<NoticeOriginWireV1> {
  const parsed = parseJsonObject(record.json, 'notice origin record');
  if (typeof parsed === 'string') return invalid(parsed);
  // Slice 2B L14 end: `finalizedAt` is a round-only top-level field, so the
  // shared reader accepts it exactly when the record is a VerificationRound.
  const ref = parsed['ref'];
  const isRound = typeof ref === 'object' && ref !== null && !Array.isArray(ref)
    && (ref as Record<string, unknown>)['aggregateType'] === 'VerificationRound';
  const problem = noticeOriginFieldsProblem(parsed, 'notice origin', { allowFinalizedAt: isRound });
  if (problem !== null) return invalid(problem);
  // A persisted `null` is never a real creation position: `null` is the
  // PreparedCommit placeholder the Store fills with the commit cursor. A
  // record that still carries it reads as unavailable, never as legacy.
  if (parsed['since'] === null) return invalid('a persisted notice origin since must be a commit cursor');
  const origin: NoticeOriginWireV1 = {};
  if (parsed['since'] !== undefined) origin.since = parsed['since'] as NonNullable<NoticeOriginWireV1['since']>;
  if (parsed['noticeAutomationCap'] !== undefined) {
    origin.noticeAutomationCap = parsed['noticeAutomationCap'] as number;
  }
  if (parsed['finalizedAt'] !== undefined) origin.finalizedAt = parsed['finalizedAt'] as string;
  return { status: 'decoded', value: origin };
}

// --------------------------------------------------------------------------
// The one registration
// --------------------------------------------------------------------------

function validateGoalSettingsChangedEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  const decoded = decodeGoalSettingsChangedEvent(event);
  return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
}

function validateWorkspaceNoticeSeenChangedEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  const decoded = decodeWorkspaceNoticeSeenChangedEvent(event);
  return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
}

/**
 * The decision write-event registration. It declares no record schema and no
 * lookup: both new events are new EVENT types on existing aggregates, and the
 * §2.5 lookup indexes live with the aggregate codec that already owns them.
 */
export const DECISION_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [],
  events: [
    {
      eventType: GOAL_SETTINGS_CHANGED_EVENT,
      schemaVersion: DECISION_EVENT_SCHEMA_VERSION,
      validate: validateGoalSettingsChangedEvent,
    },
    {
      eventType: WORKSPACE_NOTICE_SEEN_CHANGED_EVENT,
      schemaVersion: DECISION_EVENT_SCHEMA_VERSION,
      validate: validateWorkspaceNoticeSeenChangedEvent,
    },
  ],
  lookups: [],
};
