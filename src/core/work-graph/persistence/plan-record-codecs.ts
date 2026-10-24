/**
 * Plan/Proposal record codecs: persisted encoding, identity/version checks
 * and the current candidate decode. Domain admission of an initial plan lives
 * in `plan-validation.ts`; this file never judges obligations, DAG or assignment.
 *
 * One registration decodes the current `PlanProposal@2` candidate body under its
 * aggregate identity. The RecordStore selects a codec by aggregateType, so the
 * validator must accept that body and reject anything else.
 *
 * This file performs no I/O: it only checks pure encoding, identity, version and
 * plan structure, and it computes no digest and starts no transaction.
 */
import { architectureCatalogPinShape, type ArchitectureCatalogPinV1 } from '../../../contracts/architecture-catalog.js';
import type { ActorRef, CommitCursor } from '../../../contracts/command-event.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import { defineShape, f } from '../../../contracts/data-format.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { RoleBindingRefV1, RunRef } from '../../../contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import {
  invalid, isNonNeg, isPos, isRecord, isSha256Hex, nonEmpty, parseTaggedObject,
  type UnknownRecord,
} from '../../../contracts/validation/common.js';
import type {
  ArchitectureBaselineRevisionRef,
  CompletionPolicyRevisionRef,
} from '../../../contracts/governance.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import { seqOfCommitCursor } from '../../../contracts/ledger.js';
import type { QueryJobRef } from '../../../contracts/query-job.js';
import type {
  PlanRevisionAcceptedEvent,
  PlanRevisionRef,
  PlanRevisionSnapshot,
} from '../../../contracts/plan.js';
import { isArtifactRef } from '../../record-store/body-codec.js';
import { aggregateRefProblem } from './decision-record-codecs.js';
import { encodeEventEnvelope } from './event-envelope.js';
import {
  noticeOriginFieldsProblem, NOTICE_ORIGIN_COMMIT_CURSOR_FIELDS, type NoticeOriginWireV1,
} from './rework-codecs.js';
import type { RecordLookupIndex } from '../../record-store/lookup-ports.js';
import type {
  DecodeResult,
  EncodedDomainEvent,
  EncodedEventSchema,
  EncodedRecord,
  EncodedRecordSchema,
} from '../../record-store/ports.js';
import type { PlanProposal, PlanProposalRef } from '../model/plan-contracts.js';

// --------------------------------------------------------------------------
// Fixed registration identifiers
// --------------------------------------------------------------------------

export const PLAN_PROPOSAL_SCHEMA_ID = 'PlanProposal@2';
export const PLAN_REVISION_SCHEMA_ID = 'PlanRevisionSnapshot@1';
export const PLAN_PROPOSAL_RECORDED_EVENT = 'PlanProposalRecorded';
export const PLAN_PROPOSAL_RECORDED_SCHEMA_VERSION = 2;
export const PLAN_REVISION_ACCEPTED_EVENT = 'PlanRevisionAccepted';
export const PLAN_REVISION_ACCEPTED_SCHEMA_VERSION = 1;
export const PLAN_PROPOSAL_LOOKUP_INDEX = 'plan-proposal-by-goal';
/** §2.5 request-candidate index: one PlanProposal head per Goal+first QueryJob. */
export const S5_PLAN_PROPOSAL_BY_REQUEST = 's5-plan-proposal-by-goal-request';

/** The event that records one candidate/status transition of a proposal. */
export type PlanProposalRecordedEvent = {
  eventId: string;
  eventType: 'PlanProposalRecorded';
  schemaVersion: 2;
  projectId: string;
  workspaceId: string;
  aggregateType: 'PlanProposal';
  aggregateId: string;
  aggregateRevision: number;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: { proposal: PlanProposal };
};

// --------------------------------------------------------------------------
// Small pure helpers
// --------------------------------------------------------------------------

function isSafeRevision(value: unknown): value is number {
  return isNonNeg(value);
}

function isPositiveRevision(value: unknown): value is number {
  return isPos(value);
}

function copyRecord(record: EncodedRecord): EncodedRecord {
  return { refKey: record.refKey, schemaId: record.schemaId, revision: record.revision, json: record.json };
}

function copyEvent(event: EncodedDomainEvent): EncodedDomainEvent {
  return { eventId: event.eventId, eventType: event.eventType, schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt, json: event.json };
}

export function planProposalRefKey(ref: PlanProposalRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}

export function planRevisionRefKey(ref: PlanRevisionRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}

export type { NoticeOriginWireV1 } from './rework-codecs.js';

/**
 * §2.4 closed-request order. A proposal chain's position is its
 * first candidate's creation commit (`since`); equal positions fall back to the
 * canonical refKey. Both the queue history and the direct read use exactly
 * this comparison; position is never inferred from `notAdopted.at` or refKey
 * order alone.
 */
export function compareProposalChainPositions(
  left: { refKey: string; since: CommitCursor },
  right: { refKey: string; since: CommitCursor },
): number {
  const leftSeq = seqOfCommitCursor(left.since);
  const rightSeq = seqOfCommitCursor(right.since);
  if (leftSeq !== rightSeq) return leftSeq < rightSeq ? -1 : 1;
  return left.refKey < right.refKey ? -1 : left.refKey > right.refKey ? 1 : 0;
}

function planProposalRefFromValue(value: unknown): PlanProposalRef | null {
  if (!isRecord(value)) return null;
  if (value['aggregateType'] !== 'PlanProposal') return null;
  if (!nonEmpty(value['projectId'])) return null;
  if (!nonEmpty(value['workspaceId'])) return null;
  if (!nonEmpty(value['proposalId'])) return null;
  return { aggregateType: 'PlanProposal', projectId: value['projectId'],
    workspaceId: value['workspaceId'], proposalId: value['proposalId'] };
}

function planRevisionRefFromValue(value: unknown, projectId: string): PlanRevisionRef | null {
  if (!isRecord(value)) return null;
  if (value['aggregateType'] !== 'PlanRevision') return null;
  if (!nonEmpty(value['projectId']) || value['projectId'] !== projectId) return null;
  if (!nonEmpty(value['planId'])) return null;
  return { aggregateType: 'PlanRevision', projectId: value['projectId'], planId: value['planId'] };
}

function goalRefFromValue(value: unknown, projectId: string): GoalRef | null {
  if (!isRecord(value)) return null;
  if (value['aggregateType'] !== 'Goal') return null;
  if (!nonEmpty(value['projectId']) || value['projectId'] !== projectId) return null;
  if (!nonEmpty(value['goalId'])) return null;
  return { aggregateType: 'Goal', projectId: value['projectId'], goalId: value['goalId'] };
}

/** `QueryJobRef`: the first user request this candidate belongs to. */
function queryJobRefFromValue(value: unknown, projectId: string, workspaceId: string): QueryJobRef | null {
  if (!isRecord(value)) return null;
  if (value['aggregateType'] !== 'QueryJob') return null;
  if (!nonEmpty(value['projectId']) || value['projectId'] !== projectId) return null;
  if (!nonEmpty(value['workspaceId']) || value['workspaceId'] !== workspaceId) return null;
  if (!nonEmpty(value['queryJobId'])) return null;
  return {
    aggregateType: 'QueryJob',
    projectId: value['projectId'],
    workspaceId: value['workspaceId'],
    queryJobId: value['queryJobId'],
  };
}

function sessionMessageRefFromValue(value: unknown): SessionMessageRef | null {
  if (!isRecord(value)) return null;
  if (value['aggregateType'] !== 'SessionMessage') return null;
  if (!nonEmpty(value['projectId']) || !nonEmpty(value['workspaceId'])
    || !nonEmpty(value['messageId'])) return null;
  return {
    aggregateType: 'SessionMessage',
    projectId: value['projectId'],
    workspaceId: value['workspaceId'],
    messageId: value['messageId'],
  };
}

function completionPolicyRefFromValue(value: unknown, projectId: string): CompletionPolicyRevisionRef | null {
  if (!isRecord(value)) return null;
  if (value['aggregateType'] !== 'CompletionPolicyRevision') return null;
  if (!nonEmpty(value['projectId']) || value['projectId'] !== projectId) return null;
  if (!nonEmpty(value['policyId'])) return null;
  if (!isPositiveRevision(value['revision'])) return null;
  return { aggregateType: 'CompletionPolicyRevision', projectId: value['projectId'],
    policyId: value['policyId'], revision: value['revision'] };
}

function architectureRefFromValue(value: unknown, projectId: string): ArchitectureBaselineRevisionRef | null {
  if (!isRecord(value)) return null;
  if (value['aggregateType'] !== 'ArchitectureBaselineRevision') return null;
  if (!nonEmpty(value['projectId']) || value['projectId'] !== projectId) return null;
  if (!nonEmpty(value['baselineId'])) return null;
  if (!isPositiveRevision(value['revision'])) return null;
  return { aggregateType: 'ArchitectureBaselineRevision', projectId: value['projectId'],
    baselineId: value['baselineId'], revision: value['revision'] };
}

function actorFromValue(value: unknown): ActorRef | null {
  if (!isRecord(value)) return null;
  if (!nonEmpty(value['id'])) return null;
  const kind = value['kind'];
  if (kind === 'human' || kind === 'system') return { kind, id: value['id'] };
  if (kind !== 'agent') return null;
  const runRef = value['runRef'];
  if (!isRecord(runRef)) return null;
  if (!nonEmpty(runRef['projectId']) || !nonEmpty(runRef['goalId']) || !nonEmpty(runRef['runId'])) return null;
  return { kind: 'agent', id: value['id'], runRef: { aggregateType: 'Run', projectId: runRef['projectId'],
    goalId: runRef['goalId'], runId: runRef['runId'] } };
}

function runRefFromValue(value: unknown): RunRef | null {
  if (!isRecord(value)) return null;
  if (value['aggregateType'] !== 'Run') return null;
  if (!nonEmpty(value['projectId']) || !nonEmpty(value['goalId']) || !nonEmpty(value['runId'])) return null;
  return { aggregateType: 'Run', projectId: value['projectId'], goalId: value['goalId'], runId: value['runId'] };
}

function sessionRefFromValue(value: unknown): SessionRef | null {
  if (!isRecord(value)) return null;
  if (!nonEmpty(value['projectId']) || !nonEmpty(value['sessionId'])) return null;
  return { projectId: value['projectId'], sessionId: value['sessionId'] };
}

function roleBindingRefFromValue(value: unknown): RoleBindingRefV1 | null {
  if (!isRecord(value)) return null;
  if (value['schemaVersion'] !== 1) return null;
  if (!nonEmpty(value['bindingId']) || !nonEmpty(value['templateId'])
    || !nonEmpty(value['templateRevision']) || !nonEmpty(value['policyRevision'])) return null;
  if (!isSafeRevision(value['bindingVersion'])) return null;
  return { schemaVersion: 1, bindingId: value['bindingId'], templateId: value['templateId'],
    templateRevision: value['templateRevision'], bindingVersion: value['bindingVersion'],
    policyRevision: value['policyRevision'] };
}

/**
 * Strict, versioned Agent submission source (§8.1). A candidate_v2 may omit
 * it for the Host/legacy path; when present every nested ref must be complete
 * and in the candidate project/Goal so an old candidate can never be read as an
 * Agent author. This is a persisted-shape check only; it grants nothing.
 */
function planWriteProvenanceIssues(value: unknown, projectId: string, goalId: string | null): string[] {
  if (!isRecord(value)) return ['candidate_v2.submittedBy must be a PlanWriteProvenanceV1 object'];
  const issues: string[] = [];
  if (value['schemaVersion'] !== 1) issues.push('candidate_v2.submittedBy.schemaVersion must be 1');
  const runRef = runRefFromValue(value['runRef']);
  if (runRef === null || runRef.projectId !== projectId) {
    issues.push('candidate_v2.submittedBy.runRef must be a RunRef in this project');
  } else if (goalId !== null && runRef.goalId !== goalId) {
    issues.push('candidate_v2.submittedBy.runRef is not scoped to the candidate Goal');
  }
  const sessionRef = sessionRefFromValue(value['sessionRef']);
  if (sessionRef === null || sessionRef.projectId !== projectId) {
    issues.push('candidate_v2.submittedBy.sessionRef must be a SessionRef in this project');
  }
  if (roleBindingRefFromValue(value['roleBinding']) === null) {
    issues.push('candidate_v2.submittedBy.roleBinding must be a RoleBindingRefV1');
  }
  if (!isPositiveRevision(value['sessionGeneration'])) {
    issues.push('candidate_v2.submittedBy.sessionGeneration must be a positive integer');
  }
  if (!isPositiveRevision(value['entryGeneration'])) {
    issues.push('candidate_v2.submittedBy.entryGeneration must be a positive integer');
  }
  if (!isPositiveRevision(value['authorizationRevision'])) {
    issues.push('candidate_v2.submittedBy.authorizationRevision must be a positive integer');
  }
  if (!nonEmpty(value['configurationRevision'])) {
    issues.push('candidate_v2.submittedBy.configurationRevision must be a non-empty string');
  }
  return issues;
}

// --------------------------------------------------------------------------
// Structural plan body checks
// --------------------------------------------------------------------------

const REQUIREMENT_LEVELS: readonly string[] = ['required', 'optional'];
const TASK_KINDS: readonly string[] = ['work', 'gate'];
const DISPOSITIONS: readonly string[] = ['active', 'deferred', 'cancelled', 'superseded'];
const PHASES: readonly string[] = ['pending', 'ready', 'running', 'verifying', 'blocked', 'satisfied', 'failed'];
const DEPENDENCY_KINDS: readonly string[] = ['output-contract', 'artifact', 'decision', 'environment-revision', 'gate-result'];
const PLAN_VALIDATION_CODES: ReadonlySet<string> = new Set([
  'missing_required_executable_task', 'missing_active_required_goal_gate', 'missing_required_obligation',
  'task_obligation_mapping', 'obligation_task_mapping', 'empty_verification_requirements',
  'unknown_requirement_kind', 'dangling_task_ref', 'dangling_stage_ref', 'self_dependency',
  'dag_cycle', 'hierarchy_cycle', 'duplicate_requirement_id',
  'obligation_semantics_changed', 'gate_definition_changed', 'role_not_authorized',
  'task_removed', 'duplicate_task_id', 'unsupported_execution_change', 'missing_task_assignment',
]);

function isEnum(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === 'string' && allowed.includes(value);
}

function scopeIssues(value: unknown, path: string): string[] {
  if (!isRecord(value)) return [`${path} must be an object`];
  const kind = value['kind'];
  if (kind === 'goal') return [];
  if (kind === 'stage') {
    return nonEmpty(value['stageId']) ? [] : [`${path}.stageId must be a non-empty string`];
  }
  if (kind === 'module') {
    const issues: string[] = [];
    if (!nonEmpty(value['stageId'])) issues.push(`${path}.stageId must be a non-empty string`);
    if (!nonEmpty(value['moduleRef'])) issues.push(`${path}.moduleRef must be a non-empty string`);
    return issues;
  }
  return [`${path}.kind must be goal|stage|module`];
}

function runtimeTaskIssues(value: unknown, path: string): string[] {
  if (!isRecord(value)) return [`${path} must be an object`];
  const issues: string[] = [];
  if (!nonEmpty(value['taskId'])) issues.push(`${path}.taskId must be a non-empty string`);
  if (value['stageId'] !== undefined && !nonEmpty(value['stageId'])) issues.push(`${path}.stageId must be a non-empty string when present`);
  if (!nonEmpty(value['title'])) issues.push(`${path}.title must be a non-empty string`);
  if (!isEnum(value['requirementLevel'], REQUIREMENT_LEVELS)) issues.push(`${path}.requirementLevel must be required|optional`);
  if (!isEnum(value['taskKind'], TASK_KINDS)) issues.push(`${path}.taskKind must be work|gate`);
  if (!isEnum(value['disposition'], DISPOSITIONS)) issues.push(`${path}.disposition must be active|deferred|cancelled|superseded`);
  if (!isEnum(value['phase'], PHASES)) issues.push(`${path}.phase must be a legal plan phase`);
  const executionIntent = value['executionIntent'];
  if (executionIntent !== undefined) {
    if (executionIntent !== 'plan_only' && executionIntent !== 'request_execution') {
      issues.push(`${path}.executionIntent must be plan_only|request_execution`);
    }
    if (value['taskKind'] === 'gate') issues.push(`${path}.executionIntent must not appear on a gate task`);
  }
  issues.push(...scopeIssues(value['scope'], `${path}.scope`));
  return issues;
}

function assignmentIssues(value: unknown, path: string): string[] {
  if (!isRecord(value)) return [`${path} must be an object`];
  const issues: string[] = [];
  if (!nonEmpty(value['taskId'])) issues.push(`${path}.taskId must be a non-empty string`);
  if (!nonEmpty(value['role'])) issues.push(`${path}.role must be a non-empty string`);
  if (!nonEmpty(value['instruction'])) issues.push(`${path}.instruction must be a non-empty string`);
  return issues;
}

function obligationIssues(value: unknown, path: string): string[] {
  if (!isRecord(value)) return [`${path} must be an object`];
  const issues: string[] = [];
  if (!nonEmpty(value['obligationId'])) issues.push(`${path}.obligationId must be a non-empty string`);
  if (!nonEmpty(value['title'])) issues.push(`${path}.title must be a non-empty string`);
  if (!isEnum(value['requirementLevel'], REQUIREMENT_LEVELS)) issues.push(`${path}.requirementLevel must be required|optional`);
  if (!Array.isArray(value['taskIds']) || !(value['taskIds'] as unknown[]).every(nonEmpty)) {
    issues.push(`${path}.taskIds must be an array of non-empty strings`);
  }
  const requirements = value['verificationRequirements'];
  if (!Array.isArray(requirements)) issues.push(`${path}.verificationRequirements must be an array`);
  else requirements.forEach((requirement, index) => {
    const rpath = `${path}.verificationRequirements[${index}]`;
    if (!isRecord(requirement)) { issues.push(`${rpath} must be an object`); return; }
    if (!nonEmpty(requirement['requirementId'])) issues.push(`${rpath}.requirementId must be a non-empty string`);
    if (!isEnum(requirement['requirementLevel'], REQUIREMENT_LEVELS)) issues.push(`${rpath}.requirementLevel must be required|optional`);
    if (!nonEmpty(requirement['kind'])) issues.push(`${rpath}.kind must be a non-empty string`);
    if (!nonEmpty(requirement['description'])) issues.push(`${rpath}.description must be a non-empty string`);
  });
  return issues;
}

function planValidationErrorArrayIssues(value: unknown): string[] {
  if (!Array.isArray(value)) return ['plan issues must be an array'];
  const issues: string[] = [];
  value.forEach((entry, index) => {
    const path = `plan issues[${index}]`;
    if (!isRecord(entry)) { issues.push(`${path} must be an object`); return; }
    if (!nonEmpty(entry['path'])) issues.push(`${path}.path must be a non-empty string`);
    if (typeof entry['code'] !== 'string' || !PLAN_VALIDATION_CODES.has(entry['code'])) issues.push(`${path}.code is not a target PlanValidationCode`);
    if (!nonEmpty(entry['message'])) issues.push(`${path}.message must be a non-empty string`);
  });
  return issues;
}

/**
 * Structural checks shared by the candidate draft and the accepted snapshot.
 * `requireGoalId` distinguishes the draft (local goalId) from the snapshot
 * (goalRef). Domain admission rules live in `validatePlanDraft`.
 */
function taskStateBasisIssues(value: unknown, tasks: unknown, ref: unknown): string[] {
  if (!isRecord(value)) return ['plan taskStateBasis must be an object'];
  const issues: string[] = [];
  if (value['schemaVersion'] !== 1) issues.push('plan taskStateBasis.schemaVersion must be 1');
  const entries = value['entries'];
  if (!Array.isArray(entries)) {
    issues.push('plan taskStateBasis.entries must be an array');
    return issues;
  }
  const projectId = isRecord(ref) && nonEmpty(ref['projectId']) ? ref['projectId'] : null;
  const planTaskIds = Array.isArray(tasks)
    ? (tasks as unknown[]).map((task) => isRecord(task) ? task['taskId'] : undefined).filter(nonEmpty)
    : [];
  const planIds = new Set(planTaskIds);
  const seen = new Set<string>();
  let previous: string | null = null;
  entries.forEach((entry, index) => {
    const path = `plan taskStateBasis.entries[${index}]`;
    if (!isRecord(entry)) { issues.push(`${path} must be an object`); return; }
    const taskId = entry['taskId'];
    if (!nonEmpty(taskId)) { issues.push(`${path}.taskId must be a non-empty string`); return; }
    if (seen.has(taskId)) issues.push(`${path}.taskId duplicates ${taskId}`);
    seen.add(taskId);
    if (previous !== null && taskId < previous) issues.push(`${path}.taskId is not in stable ascending order`);
    previous = taskId;
    if (planTaskIds.length > 0 && !planIds.has(taskId)) issues.push(`${path}.taskId is not a task of this plan`);
    if (projectId !== null && planRevisionRefFromValue(entry['planRef'], projectId) === null) {
      issues.push(`${path}.planRef must be a PlanRevisionRef in this project`);
    }
  });
  if (Array.isArray(tasks)) {
    for (const taskId of planTaskIds) {
      if (!seen.has(taskId)) issues.push(`plan taskStateBasis is missing task ${taskId}`);
    }
    if (seen.size !== planIds.size) issues.push('plan taskStateBasis must cover exactly the plan taskIds');
  }
  return issues;
}

/** Upper bound of `PlanChangeReason.affectedTaskIds` (spec §3.1). */
const MAX_AFFECTED_TASK_IDS = 200;

/** `affectedTaskIds`: distinct non-empty task ids, at most 200, each a task of `tasks` when known. */
function affectedTaskIdsIssues(value: unknown, tasks: unknown, path: string): string[] {
  if (!Array.isArray(value)) return [`${path} must be an array when present`];
  const issues: string[] = [];
  if (value.length > MAX_AFFECTED_TASK_IDS) issues.push(`${path} must hold at most ${MAX_AFFECTED_TASK_IDS} task ids`);
  const taskIds = Array.isArray(tasks)
    ? new Set((tasks as unknown[]).map((task) => isRecord(task) ? task['taskId'] : undefined).filter(nonEmpty))
    : null;
  const seen = new Set<string>();
  value.forEach((taskId, index) => {
    if (!nonEmpty(taskId)) { issues.push(`${path}[${index}] must be a non-empty string`); return; }
    if (seen.has(taskId)) issues.push(`${path}[${index}] duplicates ${taskId}`);
    seen.add(taskId);
    if (taskIds !== null && !taskIds.has(taskId)) issues.push(`${path}[${index}] is not a task of the draft`);
  });
  return issues;
}

/**
 * `TaskDispositionRecordV1` on an accepted snapshot: one entry per Task,
 * stable ascending by taskId, each a real disposition change of a task of this
 * plan (or a superseded Task's new replacement, `from === to === 'superseded'`),
 * set in an adopted PlanRevision of this project by a recorded actor.
 */
function dispositionRecordIssues(value: unknown, tasks: unknown, ref: unknown): string[] {
  if (!isRecord(value)) return ['plan dispositionRecord must be an object'];
  const issues: string[] = [];
  if (value['schemaVersion'] !== 1) issues.push('plan dispositionRecord.schemaVersion must be 1');
  const entries = value['entries'];
  if (!Array.isArray(entries)) {
    issues.push('plan dispositionRecord.entries must be an array');
    return issues;
  }
  const projectId = isRecord(ref) && nonEmpty(ref['projectId']) ? ref['projectId'] : null;
  const planIds = new Set(Array.isArray(tasks)
    ? (tasks as unknown[]).map((task) => isRecord(task) ? task['taskId'] : undefined).filter(nonEmpty)
    : []);
  const seen = new Set<string>();
  let previous: string | null = null;
  entries.forEach((entry, index) => {
    const path = `plan dispositionRecord.entries[${index}]`;
    if (!isRecord(entry)) { issues.push(`${path} must be an object`); return; }
    const allowed = ['taskId', 'from', 'to', 'replacedByTaskId', 'traced', 'setIn', 'proposalRef', 'reason', 'actor'];
    if (!Object.keys(entry).every((key) => allowed.includes(key))) issues.push(`${path} carries unknown fields`);
    const taskId = entry['taskId'];
    if (!nonEmpty(taskId)) { issues.push(`${path}.taskId must be a non-empty string`); return; }
    if (seen.has(taskId)) issues.push(`${path}.taskId duplicates ${taskId}`);
    seen.add(taskId);
    if (previous !== null && taskId < previous) issues.push(`${path}.taskId is not in stable ascending order`);
    previous = taskId;
    if (planIds.size > 0 && !planIds.has(taskId)) issues.push(`${path}.taskId is not a task of this plan`);
    if (!isEnum(entry['from'], DISPOSITIONS) || !isEnum(entry['to'], DISPOSITIONS)) {
      issues.push(`${path}.from/to must be dispositions`);
    } else if (entry['from'] === entry['to'] && entry['to'] !== 'superseded') {
      // An entry with from === to only re-points a superseded Task's replacement.
      issues.push(`${path} must record a disposition change`);
    }
    if (!(entry['replacedByTaskId'] === null || nonEmpty(entry['replacedByTaskId']))) {
      issues.push(`${path}.replacedByTaskId must be null or a non-empty string`);
    }
    if (typeof entry['traced'] !== 'boolean') issues.push(`${path}.traced must be a boolean`);
    if (projectId !== null && planRevisionRefFromValue(entry['setIn'], projectId) === null) {
      issues.push(`${path}.setIn must be a PlanRevisionRef in this project`);
    }
    const proposalRef = planProposalRefFromValue(entry['proposalRef']);
    if (proposalRef === null || (projectId !== null && proposalRef.projectId !== projectId)) {
      issues.push(`${path}.proposalRef must be a PlanProposal ref in this project`);
    }
    const reason = entry['reason'];
    if (!isRecord(reason) || !Object.keys(reason).every((key) => ['text', 'sources', 'affectedTaskIds'].includes(key))
      || !nonEmpty(reason['text']) || !Array.isArray(reason['sources'])
      || !(reason['sources'] as unknown[]).every(isArtifactRef)) {
      issues.push(`${path}.reason must carry text, ArtifactRef sources and affectedTaskIds`);
    } else {
      issues.push(...affectedTaskIdsIssues(reason['affectedTaskIds'], null, `${path}.reason.affectedTaskIds`));
    }
    if (actorFromValue(entry['actor']) === null) issues.push(`${path}.actor must be an ActorRef`);
  });
  return issues;
}

function structuralPlanIssues(value: unknown, requireGoalId: boolean): string[] {
  if (!isRecord(value)) return ['plan body must be an object'];
  const issues: string[] = [];
  const schemaVersion = value['schemaVersion'];
  if (schemaVersion !== 2) issues.push('plan schemaVersion must be 2');
  if (!nonEmpty(value['planId'])) issues.push('plan planId must be a non-empty string');
  if (!isPositiveRevision(value['planRevision'])) issues.push('plan planRevision must be a positive integer');
  if (requireGoalId && !nonEmpty(value['goalId'])) issues.push('plan goalId must be a non-empty string');
  const review = value['reviewAdmissionProtocol'];
  if (review !== undefined && review !== 'independent-review-v1') issues.push('plan reviewAdmissionProtocol must be independent-review-v1 when present');
  const stages = value['stages'];
  if (!Array.isArray(stages)) issues.push('plan stages must be an array');
  else stages.forEach((stage, index) => {
    const path = `plan stages[${index}]`;
    if (!isRecord(stage)) { issues.push(`${path} must be an object`); return; }
    if (!nonEmpty(stage['stageId'])) issues.push(`${path}.stageId must be a non-empty string`);
    if (!nonEmpty(stage['title'])) issues.push(`${path}.title must be a non-empty string`);
  });
  const tasks = value['tasks'];
  if (!Array.isArray(tasks)) issues.push('plan tasks must be an array');
  else tasks.forEach((task, index) => issues.push(...runtimeTaskIssues(task, `plan tasks[${index}]`)));
  const assignments = value['assignments'];
  if (assignments !== undefined) {
    if (!Array.isArray(assignments)) issues.push('plan assignments must be an array when present');
    else assignments.forEach((assignment, index) => issues.push(...assignmentIssues(assignment, `plan assignments[${index}]`)));
  }
  const obligations = value['obligations'];
  if (!Array.isArray(obligations)) issues.push('plan obligations must be an array');
  else obligations.forEach((obligation, index) => issues.push(...obligationIssues(obligation, `plan obligations[${index}]`)));
  const hierarchy = value['taskHierarchy'];
  if (!isRecord(hierarchy) || !Array.isArray(hierarchy['parentOf'])) issues.push('plan taskHierarchy.parentOf must be an array');
  else (hierarchy['parentOf'] as unknown[]).forEach((edge, index) => {
    const path = `plan taskHierarchy.parentOf[${index}]`;
    if (!isRecord(edge)) { issues.push(`${path} must be an object`); return; }
    if (!nonEmpty(edge['parentTaskId'])) issues.push(`${path}.parentTaskId must be a non-empty string`);
    if (!nonEmpty(edge['childTaskId'])) issues.push(`${path}.childTaskId must be a non-empty string`);
  });
  const dag = value['executionDag'];
  if (!isRecord(dag) || !Array.isArray(dag['dependsOn'])) issues.push('plan executionDag.dependsOn must be an array');
  else (dag['dependsOn'] as unknown[]).forEach((edge, index) => {
    const path = `plan executionDag.dependsOn[${index}]`;
    if (!isRecord(edge)) { issues.push(`${path} must be an object`); return; }
    if (!nonEmpty(edge['taskId'])) issues.push(`${path}.taskId must be a non-empty string`);
    if (!nonEmpty(edge['dependsOnId'])) issues.push(`${path}.dependsOnId must be a non-empty string`);
    const requires = edge['requires'];
    if (!isRecord(requires)) issues.push(`${path}.requires must be an object`);
    else {
      if (!isEnum(requires['kind'], DEPENDENCY_KINDS)) issues.push(`${path}.requires.kind is not a legal dependency kind`);
      if (!nonEmpty(requires['label'])) issues.push(`${path}.requires.label must be a non-empty string`);
    }
  });
  // A single stable store codec (`PlanRevisionSnapshot@1`) carries the current
  // content version 2; its shape is validated here while membership/DAG legality
  // stays in plan-validation. Unknown versions never decode.
  if (schemaVersion === 2) {
    const relations = value['taskRelations'];
    if (relations !== undefined) {
      if (!Array.isArray(relations)) issues.push('plan taskRelations must be an array when present');
      else relations.forEach((relation, index) => {
        const path = `plan taskRelations[${index}]`;
        if (!isRecord(relation)) { issues.push(`${path} must be an object`); return; }
        if (!nonEmpty(relation['fromTaskId'])) issues.push(`${path}.fromTaskId must be a non-empty string`);
        if (!nonEmpty(relation['toTaskId'])) issues.push(`${path}.toTaskId must be a non-empty string`);
        if (relation['kind'] !== 'coordination' && relation['kind'] !== 'expected_dependency') {
          issues.push(`${path}.kind must be coordination|expected_dependency`);
        }
        if (typeof relation['note'] !== 'string') issues.push(`${path}.note must be a string`);
      });
    }
    const inputs = value['inputRequirements'];
    if (inputs !== undefined) {
      if (!Array.isArray(inputs)) issues.push('plan inputRequirements must be an array when present');
      else inputs.forEach((requirement, index) => {
        const path = `plan inputRequirements[${index}]`;
        if (!isRecord(requirement)) { issues.push(`${path} must be an object`); return; }
        if (!nonEmpty(requirement['requirementId'])) issues.push(`${path}.requirementId must be a non-empty string`);
        if (!nonEmpty(requirement['consumerTaskId'])) issues.push(`${path}.consumerTaskId must be a non-empty string`);
        if (requirement['kind'] !== 'artifact') issues.push(`${path}.kind must be artifact`);
        if (!isArtifactRef(requirement['artifactRef'])) issues.push(`${path}.artifactRef must be an ArtifactRef`);
      });
    }
    // Compiler-owned accepted basis. A Draft/Proposal input must never carry
    // it; on an accepted snapshot it must be complete, unique, stable-sorted and
    // in this project, so a caller-authored or damaged basis can never be
    // silently dropped and decoded as a valid older body.
    const taskStateBasis = value['taskStateBasis'];
    if (taskStateBasis !== undefined) {
      if (requireGoalId) {
        issues.push('plan taskStateBasis is compiler-owned and must not appear on a draft/proposal');
      } else {
        issues.push(...taskStateBasisIssues(taskStateBasis, value['tasks'], value['ref']));
      }
    }
    // Compiler-owned disposition record: same rule as `taskStateBasis`.
    const dispositionRecord = value['dispositionRecord'];
    if (dispositionRecord !== undefined) {
      if (requireGoalId) {
        issues.push('plan dispositionRecord is compiler-owned and must not appear on a draft/proposal');
      } else {
        issues.push(...dispositionRecordIssues(dispositionRecord, value['tasks'], value['ref']));
      }
    }
  }
  return issues;
}

// --------------------------------------------------------------------------
// Record validators / decoders
// --------------------------------------------------------------------------

const NOT_ADOPTION_REASONS: readonly string[] = ['replaced', 'not_selected', 'abandoned'];

/**
 * §2.4 `notAdopted`: the exact, saved non-adoption fact. Its shape is
 * pure data; whether the proposal may be abandoned is a service rule.
 */
function notAdoptedIssues(value: unknown, projectId: string, workspaceId: string): string[] {
  if (!isRecord(value)) return ['candidate_v2.notAdopted must be an object'];
  const issues: string[] = [];
  if (!NOT_ADOPTION_REASONS.includes(value['reason'] as string)) {
    issues.push('candidate_v2.notAdopted.reason must be replaced|not_selected|abandoned');
  }
  if (actorFromValue(value['requestedBy']) === null) {
    issues.push('candidate_v2.notAdopted.requestedBy must be an ActorRef');
  }
  if (!nonEmpty(value['at'])) issues.push('candidate_v2.notAdopted.at must be a non-empty string');
  const replacedBy = value['replacedBy'];
  if (replacedBy !== null) {
    const ref = planProposalRefFromValue(replacedBy);
    if (ref === null || ref.projectId !== projectId || ref.workspaceId !== workspaceId) {
      issues.push('candidate_v2.notAdopted.replacedBy must be null or a PlanProposal ref in this project/workspace');
    }
  }
  return issues;
}

/**
 * Pure `VersionPin` shape check (a complete aggregate-specific ref plus a
 * positive revision). `allowAbsence` relaxes the revision to the §2.1 pin-0
 * form, which the Store translates to `expectedRevision: null` (a confirmed
 * absence); it is used only for a change proof's `changes[].before`. The
 * complete-ref check is the shared `aggregateRefProblem`.
 */
function versionPinIssues(value: unknown, label: string, allowAbsence = false): string[] {
  if (!isRecord(value)) return [`${label} must be a VersionPin`];
  const refProblem = aggregateRefProblem(value['ref']);
  if (refProblem !== null) return [`${label}.ref: ${refProblem}`];
  if (allowAbsence ? !isSafeRevision(value['revision']) : !isPositiveRevision(value['revision'])) {
    return [`${label}.revision must be ${allowAbsence ? 'a non-negative' : 'a positive'} integer`];
  }
  return [];
}

function versionPinArrayIssues(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) return [`${label} must be an array`];
  const issues: string[] = [];
  (value as unknown[]).forEach((pin, index) => issues.push(...versionPinIssues(pin, `${label}[${index}]`)));
  return issues;
}

function goalControlRebaseIssues(value: unknown, label: string): string[] {
  if (!isRecord(value) || !['captured', 'actualBefore', 'basis'].every((key) => key in value)) {
    return [`${label} must be a GoalControlRebaseV1`];
  }
  const issues: string[] = [];
  issues.push(...versionPinIssues(value['captured'], `${label}.captured`));
  issues.push(...versionPinIssues(value['actualBefore'], `${label}.actualBefore`));
  if (!isRecord(value['basis'])) issues.push(`${label}.basis must be a GoalDecisionBasisV1`);
  return issues;
}

/**
 * §2.8 `DecisionChangeProofV1` shape check. `PlanRevisionAccepted` may
 * carry it as `payload.decisionApplication`; the old event without the field
 * stays readable, so this is only invoked for a present value.
 */
function decisionChangeProofIssues(value: unknown, label: string): string[] {
  if (!isRecord(value)) return [`${label} must be a DecisionChangeProofV1`];
  const issues: string[] = [];
  if (sessionMessageRefFromValue(value['acknowledgementRef']) === null) {
    issues.push(`${label}.acknowledgementRef must be a complete SessionMessageRef`);
  }
  issues.push(...versionPinArrayIssues(value['capturedPins'], `${label}.capturedPins`));
  const changes = value['changes'];
  if (!Array.isArray(changes)) {
    issues.push(`${label}.changes must be an array`);
  } else {
    changes.forEach((change, index) => {
      if (!isRecord(change)) {
        issues.push(`${label}.changes[${index}] must be an object`);
        return;
      }
      // §2.1: a `before` of revision 0 is the named absence pin (∅); the `after`
      // side and every other proof pin still require a positive revision.
      issues.push(...versionPinIssues(change['before'], `${label}.changes[${index}].before`, true));
      issues.push(...versionPinIssues(change['after'], `${label}.changes[${index}].after`));
    });
  }
  const rebases = value['basisRebases'];
  if (!Array.isArray(rebases)) issues.push(`${label}.basisRebases must be an array`);
  else rebases.forEach((rebase, index) => issues.push(...goalControlRebaseIssues(rebase, `${label}.basisRebases[${index}]`)));
  return issues;
}

/**
 * The default-applying read of the request slot (spec §2.2/§2.4): a missing
 * `requestRef` reads as the explicit null "independent candidate". Behaviour is
 * owned by the tasks-side proposePlan service.
 */
export function candidateRequestRef(proposal: PlanProposal): QueryJobRef | null {
  return proposal.requestRef ?? null;
}

/** L10: the candidate's catalog pin as an R1 fragment of this hand-written codec: exact keys, `null` allowed, absent
 * refused (a present key holding `undefined` is invalid). */
const planProposalCatalogPinShape = defineShape({ name: 'PlanProposalCatalogPinV1',
  fields: { catalogPin: f.nullable(f.ref(architectureCatalogPinShape)) } });

function proposalValueIssues(value: unknown, expectedRef: PlanProposalRef | null): string[] {
  if (!isRecord(value)) return ['PlanProposal must be an object'];
  const ref = planProposalRefFromValue(value['ref']);
  if (ref === null) return ['PlanProposal.ref must be a full PlanProposal ref'];
  const issues: string[] = [];
  if (expectedRef !== null && (ref.projectId !== expectedRef.projectId
    || ref.workspaceId !== expectedRef.workspaceId || ref.proposalId !== expectedRef.proposalId)) {
    issues.push('PlanProposal.ref disagrees with its record identity');
  }
  if (!isPositiveRevision(value['revision'])) issues.push('PlanProposal.revision must be a positive integer');
  if (value['kind'] === 'candidate_v2') {
    if (value['schemaVersion'] !== 2) issues.push('candidate_v2 schemaVersion must be 2');
    if (goalRefFromValue(value['goalRef'], ref.projectId) === null) issues.push('candidate_v2.goalRef must be a GoalRef in this project');
    if (value['submittedBy'] !== undefined) {
      const candidateGoal = goalRefFromValue(value['goalRef'], ref.projectId);
      issues.push(...planWriteProvenanceIssues(value['submittedBy'], ref.projectId,
        candidateGoal === null ? null : candidateGoal.goalId));
    }
    const basedOn = value['basedOn'];
    if (basedOn !== null && planRevisionRefFromValue(basedOn, ref.projectId) === null) {
      issues.push('candidate_v2.basedOn must be null or a PlanRevisionRef in this project');
    }
    // §2.4 request-candidate extension. Absent means an independent
    // candidate (never a Null candidate grouped into a request); present must be
    // a complete QueryJobRef of this project/workspace.
    const requestRef = value['requestRef'];
    if (requestRef !== undefined && requestRef !== null
      && queryJobRefFromValue(requestRef, ref.projectId, ref.workspaceId) === null) {
      issues.push('candidate_v2.requestRef must be null or a QueryJobRef in this project/workspace');
    }
    if (value['notAdopted'] !== undefined) {
      issues.push(...notAdoptedIssues(value['notAdopted'], ref.projectId, ref.workspaceId));
    }
    issues.push(...structuralPlanIssues(value['draft'], true));
    const reason = value['reason'];
    if (!isRecord(reason) || !nonEmpty(reason['text']) || !Array.isArray(reason['sources'])) {
      issues.push('candidate_v2.reason must carry text and sources');
    } else {
      (reason['sources'] as unknown[]).forEach((source, index) => {
        const path = `candidate_v2.reason.sources[${index}]`;
        if (!isRecord(source) || source['kind'] !== 'artifact' || !nonEmpty(source['contentType'])
          || !nonEmpty(source['digest']) || typeof source['sizeBytes'] !== 'number'
          || !Number.isSafeInteger(source['sizeBytes']) || source['sizeBytes'] < 0 || !isRecord(source['source'])) {
          issues.push(`${path} must be an ArtifactRef`);
        }
      });
      // Optional; absent on every candidate recorded before it existed.
      if (reason['affectedTaskIds'] !== undefined) {
        const draft = value['draft'];
        issues.push(...affectedTaskIdsIssues(reason['affectedTaskIds'], isRecord(draft) ? draft['tasks'] : null,
          'candidate_v2.reason.affectedTaskIds'));
      }
    }
    const status = value['status'];
    if (status !== 'candidate' && status !== 'accepted' && status !== 'rejected' && status !== 'not_adopted') {
      issues.push('candidate_v2.status must be candidate|accepted|rejected|not_adopted');
    }
    issues.push(...planValidationErrorArrayIssues(value['issues']));
    const catalogPin = value['catalogPin'];
    const pinProblem = checkShape(planProposalCatalogPinShape, { catalogPin }, 'stored');
    if (pinProblem !== null) issues.push(pinProblem);
    else if (catalogPin !== null && (catalogPin as ArchitectureCatalogPinV1).catalogRef.projectId !== ref.projectId) {
      issues.push('candidate_v2.catalogPin must name a catalog of this project');
    }
    return issues;
  }
  issues.push('PlanProposal.kind must be candidate_v2');
  return issues;
}

function validatePlanProposalRecord(record: EncodedRecord): DecodeResult<EncodedRecord> {
  if (record.schemaId !== PLAN_PROPOSAL_SCHEMA_ID) {
    return invalid(`expected schemaId ${PLAN_PROPOSAL_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const parsed = parseTaggedObject(record.json, 'PlanProposal');
  if (typeof parsed === 'string') return invalid(parsed);
  // §2.5: the wire-only creation origin lives beside the body;
  // the placeholder `null` is bound by the Store before this validator runs on
  // a bound record (see the record schema's `commitCursorFields`).
  const originProblem = noticeOriginFieldsProblem(parsed, 'PlanProposal');
  if (originProblem !== null) return invalid(`PlanProposal origin is invalid: ${originProblem}`);
  const ref = planProposalRefFromValue(parsed['ref']);
  if (ref === null) return invalid('PlanProposal has no valid full ref');
  if (canonicalJson(parsed['ref'] as JsonValue) !== record.refKey) {
    return invalid('PlanProposal ref is not the outer canonical ref_key');
  }
  if (!isSafeRevision(parsed['revision']) || parsed['revision'] !== record.revision) {
    return invalid('PlanProposal outer revision disagrees with the JSON revision');
  }
  const issues = proposalValueIssues(parsed, ref);
  if (issues.length > 0) return invalid(`PlanProposal is invalid: ${issues.join('; ')}`);
  return { status: 'decoded', value: copyRecord(record) };
}

function pinIssues(value: unknown, projectId: string, kind: 'policy' | 'architecture'): string[] {
  if (!isRecord(value)) return [`${kind} pin must be an object`];
  const issues: string[] = [];
  const ref = value['ref'];
  if (kind === 'policy') {
    if (completionPolicyRefFromValue(ref, projectId) === null) {
      issues.push('effectiveCompletionPolicy.ref must be a CompletionPolicyRevisionRef in this project');
    }
  } else if (architectureRefFromValue(ref, projectId) === null) {
    issues.push('effectiveArchitectureBaseline.ref must be an ArchitectureBaselineRevisionRef in this project');
  }
  if (!isSha256Hex(value['digest'])) issues.push(`${kind} pin digest must be a lowercase sha256 hex`);
  return issues;
}

function planRevisionSnapshotIssues(value: unknown): string[] {
  if (!isRecord(value)) return ['PlanRevisionSnapshot must be an object'];
  const issues: string[] = [];
  const ref = value['ref'];
  let projectId = '';
  if (!isRecord(ref) || ref['aggregateType'] !== 'PlanRevision'
    || !nonEmpty(ref['projectId']) || !nonEmpty(ref['planId'])) {
    issues.push('PlanRevisionSnapshot.ref must be a full PlanRevision ref');
  } else {
    projectId = ref['projectId'];
    if (!nonEmpty(value['planId']) || value['planId'] !== ref['planId']) {
      issues.push('PlanRevisionSnapshot.planId must agree with its ref');
    }
  }
  if (value['revision'] !== 1) issues.push('PlanRevisionSnapshot.revision must be 1');
  if (goalRefFromValue(value['goalRef'], projectId) === null) {
    issues.push('PlanRevisionSnapshot.goalRef must be a GoalRef in this project');
  }
  if (!nonEmpty(value['acceptedAt'])) issues.push('PlanRevisionSnapshot.acceptedAt must be a non-empty string');
  issues.push(...pinIssues(value['effectiveCompletionPolicy'], projectId, 'policy'));
  issues.push(...pinIssues(value['effectiveArchitectureBaseline'], projectId, 'architecture'));
  issues.push(...structuralPlanIssues(value, false));
  return issues;
}

function validatePlanRevisionRecord(record: EncodedRecord): DecodeResult<EncodedRecord> {
  if (record.schemaId !== PLAN_REVISION_SCHEMA_ID) {
    return invalid(`expected schemaId ${PLAN_REVISION_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const parsed = parseTaggedObject(record.json, 'PlanRevisionSnapshot');
  if (typeof parsed === 'string') return invalid(parsed);
  const ref = parsed['ref'];
  if (!isRecord(ref) || canonicalJson(ref as JsonValue) !== record.refKey) {
    return invalid('PlanRevisionSnapshot ref is not the outer canonical ref_key');
  }
  if (parsed['revision'] !== record.revision) {
    return invalid('PlanRevisionSnapshot outer revision disagrees with the JSON revision');
  }
  const issues = planRevisionSnapshotIssues(parsed);
  if (issues.length > 0) return invalid(`PlanRevisionSnapshot is invalid: ${issues.join('; ')}`);
  return { status: 'decoded', value: copyRecord(record) };
}

// --------------------------------------------------------------------------
// Event validators / decoders
// --------------------------------------------------------------------------

function eventEnvelopeIssues(event: EncodedDomainEvent, eventType: string, schemaVersion: number, parsed: UnknownRecord): string[] {
  const issues: string[] = [];
  if (event.eventType !== eventType) issues.push(`eventType must be ${eventType}`);
  if (event.schemaVersion !== schemaVersion) issues.push(`schemaVersion must be ${schemaVersion}`);
  if (!nonEmpty(event.eventId)) issues.push('eventId must be a non-empty string');
  if (!nonEmpty(event.occurredAt)) issues.push('occurredAt must be a non-empty string');
  if (parsed['eventId'] !== event.eventId) issues.push('outer eventId disagrees with the event JSON');
  if (parsed['eventType'] !== event.eventType) issues.push('outer eventType disagrees with the event JSON');
  if (parsed['schemaVersion'] !== event.schemaVersion) issues.push('outer schemaVersion disagrees with the event JSON');
  if (parsed['occurredAt'] !== event.occurredAt) issues.push('outer occurredAt disagrees with the event JSON');
  return issues;
}

function validatePlanProposalRecordedEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  const parsed = parseTaggedObject(event.json, 'PlanProposalRecorded event');
  if (typeof parsed === 'string') return invalid(parsed);
  const issues = eventEnvelopeIssues(event, PLAN_PROPOSAL_RECORDED_EVENT, PLAN_PROPOSAL_RECORDED_SCHEMA_VERSION, parsed);
  if (!nonEmpty(parsed['projectId'])) issues.push('PlanProposalRecorded projectId must be a non-empty string');
  if (!nonEmpty(parsed['workspaceId'])) issues.push('PlanProposalRecorded workspaceId must be a non-empty string');
  if (parsed['aggregateType'] !== 'PlanProposal') issues.push('PlanProposalRecorded aggregateType must be "PlanProposal"');
  if (!nonEmpty(parsed['aggregateId'])) issues.push('PlanProposalRecorded aggregateId must be a non-empty string');
  if (!isPositiveRevision(parsed['aggregateRevision'])) issues.push('PlanProposalRecorded aggregateRevision must be a positive integer');
  if (!nonEmpty(parsed['causationId'])) issues.push('PlanProposalRecorded causationId must be a non-empty string');
  if (!nonEmpty(parsed['correlationId'])) issues.push('PlanProposalRecorded correlationId must be a non-empty string');
  if (!nonEmpty(parsed['idempotencyKey'])) issues.push('PlanProposalRecorded idempotencyKey must be a non-empty string');
  if (actorFromValue(parsed['actor']) === null) issues.push('PlanProposalRecorded actor is not a valid ActorRef');
  const payload = parsed['payload'];
  if (!isRecord(payload)) issues.push('PlanProposalRecorded payload must be an object');
  else {
    const expectedRef: PlanProposalRef | null = nonEmpty(parsed['projectId']) && nonEmpty(parsed['workspaceId'])
      && nonEmpty(parsed['aggregateId'])
      ? { aggregateType: 'PlanProposal', projectId: parsed['projectId'], workspaceId: parsed['workspaceId'], proposalId: parsed['aggregateId'] }
      : null;
    const proposalIssues = proposalValueIssues(payload['proposal'], expectedRef);
    issues.push(...proposalIssues);
    const proposal = payload['proposal'];
    if (isRecord(proposal) && isPositiveRevision(parsed['aggregateRevision']) && proposal['revision'] !== parsed['aggregateRevision']) {
      issues.push('PlanProposalRecorded aggregateRevision disagrees with the proposal revision');
    }
  }
  if (issues.length > 0) return invalid(`PlanProposalRecorded is invalid: ${issues.join('; ')}`);
  return { status: 'decoded', value: copyEvent(event) };
}

function validatePlanRevisionAcceptedEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  const parsed = parseTaggedObject(event.json, 'PlanRevisionAccepted event');
  if (typeof parsed === 'string') return invalid(parsed);
  const issues = eventEnvelopeIssues(event, PLAN_REVISION_ACCEPTED_EVENT, PLAN_REVISION_ACCEPTED_SCHEMA_VERSION, parsed);
  if (!nonEmpty(parsed['projectId'])) issues.push('PlanRevisionAccepted projectId must be a non-empty string');
  if (!nonEmpty(parsed['workspaceId'])) issues.push('PlanRevisionAccepted workspaceId must be a non-empty string');
  if (parsed['aggregateType'] !== 'PlanRevision') issues.push('PlanRevisionAccepted aggregateType must be "PlanRevision"');
  if (!nonEmpty(parsed['aggregateId'])) issues.push('PlanRevisionAccepted aggregateId must be a non-empty string');
  if (parsed['aggregateRevision'] !== 1) issues.push('PlanRevisionAccepted aggregateRevision must be 1');
  if (!nonEmpty(parsed['causationId'])) issues.push('PlanRevisionAccepted causationId must be a non-empty string');
  if (!nonEmpty(parsed['correlationId'])) issues.push('PlanRevisionAccepted correlationId must be a non-empty string');
  if (!nonEmpty(parsed['idempotencyKey'])) issues.push('PlanRevisionAccepted idempotencyKey must be a non-empty string');
  if (actorFromValue(parsed['actor']) === null) issues.push('PlanRevisionAccepted actor is not a valid ActorRef');
  const payload = parsed['payload'];
  if (!isRecord(payload)) issues.push('PlanRevisionAccepted payload must be an object');
  else {
    if (!nonEmpty(payload['goalId'])) issues.push('PlanRevisionAccepted payload.goalId must be a non-empty string');
    if (!isPositiveRevision(payload['goalAggregateRevision'])) issues.push('PlanRevisionAccepted payload.goalAggregateRevision must be a positive integer');
    const snapshot = payload['planRevision'];
    if (isRecord(snapshot) && nonEmpty(parsed['aggregateId'])) {
      const ref = snapshot['ref'];
      if (!isRecord(ref) || ref['planId'] !== parsed['aggregateId'] || ref['projectId'] !== parsed['projectId']) {
        issues.push('PlanRevisionAccepted snapshot ref disagrees with the event aggregate');
      }
    }
    issues.push(...planRevisionSnapshotIssues(snapshot));
    // §2.8: the optional acknowledgement and the exact change proof a
    // recorded decision application carries. Absent on every old event.
    if (payload['acknowledgementRef'] !== undefined) {
      if (sessionMessageRefFromValue(payload['acknowledgementRef']) === null) {
        issues.push('PlanRevisionAccepted payload.acknowledgementRef must be a complete SessionMessageRef');
      }
    }
    if (payload['decisionApplication'] !== undefined) {
      issues.push(...decisionChangeProofIssues(payload['decisionApplication'], 'PlanRevisionAccepted payload.decisionApplication'));
    }
  }
  if (issues.length > 0) return invalid(`PlanRevisionAccepted is invalid: ${issues.join('; ')}`);
  return { status: 'decoded', value: copyEvent(event) };
}

/** Decodes a stored PlanProposal record into the current candidate view. */
export function decodePlanProposalRecord(record: EncodedRecord): DecodeResult<PlanProposal> {
  const checked = validatePlanProposalRecord(record);
  if (checked.status !== 'decoded') return checked;
  const parsed = JSON.parse(record.json) as UnknownRecord;
  // §2.5: the wire-only creation origin (`since`) is NOT part of the
  // public DTO; `decodePlanProposalOrigin` reads it separately.
  const wire = { ...parsed };
  delete wire['since'];
  delete wire['noticeAutomationCap'];
  return { status: 'decoded', value: wire as unknown as PlanProposal };
}

/**
 * §2.5: the wire-only creation origin of a stored PlanProposal,
 * read beside `decodePlanProposalRecord` and never merged into its public DTO.
 * Every current candidate carries `since` because the creating commit binds it;
 * a record without `since`, or with a persisted `null` (the PreparedCommit
 * placeholder), is invalid, never a legacy position.
 */
export function decodePlanProposalOrigin(
  record: EncodedRecord,
): DecodeResult<NoticeOriginWireV1 & { since: CommitCursor }> {
  const parsed = parseTaggedObject(record.json, 'PlanProposal origin');
  if (typeof parsed === 'string') return invalid(parsed);
  const problem = noticeOriginFieldsProblem(parsed, 'PlanProposal origin');
  if (problem !== null) return invalid(problem);
  if (parsed['since'] === null) {
    return invalid('a persisted PlanProposal origin since must be a commit cursor');
  }
  if (typeof parsed['since'] !== 'string') {
    return invalid('a PlanProposal origin must carry a commit cursor since');
  }
  return { status: 'decoded', value: { since: parsed['since'] as CommitCursor } };
}

export function decodePlanRevisionSnapshot(record: EncodedRecord): DecodeResult<PlanRevisionSnapshot> {
  const checked = validatePlanRevisionRecord(record);
  if (checked.status !== 'decoded') return checked;
  return { status: 'decoded', value: JSON.parse(record.json) as PlanRevisionSnapshot };
}

export function decodePlanProposalRecordedEvent(event: EncodedDomainEvent): DecodeResult<PlanProposalRecordedEvent> {
  const checked = validatePlanProposalRecordedEvent(event);
  if (checked.status !== 'decoded') return checked;
  return { status: 'decoded', value: JSON.parse(event.json) as PlanProposalRecordedEvent };
}

export function decodePlanRevisionAcceptedEvent(event: EncodedDomainEvent): DecodeResult<PlanRevisionAcceptedEvent> {
  const checked = validatePlanRevisionAcceptedEvent(event);
  if (checked.status !== 'decoded') return checked;
  return { status: 'decoded', value: JSON.parse(event.json) as PlanRevisionAcceptedEvent };
}

// --------------------------------------------------------------------------
// Encoders
// --------------------------------------------------------------------------

/**
 * Encodes one `PlanProposal`. An optional `origin` writes the wire-only notice
 * origin beside the public DTO (SPEC §2.5): the creating commit passes
 * `{ since: null }` for the Store cursor binding, and every later update passes
 * the preserved origin; the public DTO itself is never extended.
 */
export function encodePlanProposal(proposal: PlanProposal, origin?: NoticeOriginWireV1): EncodedRecord {
  const record: EncodedRecord = { refKey: planProposalRefKey(proposal.ref), schemaId: PLAN_PROPOSAL_SCHEMA_ID,
    revision: proposal.revision, json: JSON.stringify(proposal) };
  if (origin === undefined || origin.since === undefined) return record;
  const wire = JSON.parse(record.json) as UnknownRecord;
  wire['since'] = origin.since;
  return { ...record, json: JSON.stringify(wire) };
}

export function encodePlanRevisionSnapshot(snapshot: PlanRevisionSnapshot): EncodedRecord {
  return { refKey: planRevisionRefKey(snapshot.ref), schemaId: PLAN_REVISION_SCHEMA_ID,
    revision: 1, json: JSON.stringify(snapshot) };
}

export function encodePlanProposalRecordedEvent(event: PlanProposalRecordedEvent): EncodedDomainEvent {
  return encodeEventEnvelope(event);
}

export function encodePlanRevisionAcceptedEvent(event: PlanRevisionAcceptedEvent): EncodedDomainEvent {
  return encodeEventEnvelope(event);
}

// --------------------------------------------------------------------------
// The one registration
// --------------------------------------------------------------------------

const PLAN_PROPOSAL_RECORD_SCHEMA: EncodedRecordSchema = {
  schemaId: PLAN_PROPOSAL_SCHEMA_ID,
  aggregateType: 'PlanProposal',
  // §2.5: a new candidate binds its creation commit cursor to
  // the wire-only `since`; later updates copy it and never rebind.
  commitCursorFields: NOTICE_ORIGIN_COMMIT_CURSOR_FIELDS,
  validate: validatePlanProposalRecord,
};

const PLAN_REVISION_RECORD_SCHEMA: EncodedRecordSchema = {
  schemaId: PLAN_REVISION_SCHEMA_ID,
  aggregateType: 'PlanRevision',
  validate: validatePlanRevisionRecord,
};

/** Candidate lookup only: WorkGraph re-reads the canonical record and rechecks
 * scope plus status; this is not a synchronous ready index. */
const PLAN_PROPOSAL_GOAL_LOOKUP: RecordLookupIndex = {
  name: PLAN_PROPOSAL_LOOKUP_INDEX,
  aggregateType: 'PlanProposal',
  paths: ['goalRef.projectId', 'goalRef.goalId'],
};

/** §2.5 request-head lookup; a missing `requestRef` is stored as null. */
const PLAN_PROPOSAL_REQUEST_LOOKUP: RecordLookupIndex = {
  name: S5_PLAN_PROPOSAL_BY_REQUEST,
  aggregateType: 'PlanProposal',
  paths: ['ref.projectId', 'ref.workspaceId', 'goalRef.goalId', 'requestRef.queryJobId'],
};

/** One Goal's PlanRevisions, ordered by `acceptedAt` (task timeline). */
export const S2B_PLAN_REVISION_BY_GOAL_LOOKUP = 's2b-plan-revision-by-goal';
const PLAN_REVISION_BY_GOAL_LOOKUP: RecordLookupIndex = {
  name: S2B_PLAN_REVISION_BY_GOAL_LOOKUP,
  aggregateType: 'PlanRevision',
  paths: ['goalRef.projectId', 'goalRef.goalId'],
  orderBy: { path: 'acceptedAt' },
};

export const PLAN_RECORD_SCHEMAS: {
  records: readonly EncodedRecordSchema[];
  events: readonly EncodedEventSchema[];
  lookups: readonly RecordLookupIndex[];
} = {
  records: [PLAN_PROPOSAL_RECORD_SCHEMA, PLAN_REVISION_RECORD_SCHEMA],
  events: [
    { eventType: PLAN_PROPOSAL_RECORDED_EVENT, schemaVersion: PLAN_PROPOSAL_RECORDED_SCHEMA_VERSION,
      validate: validatePlanProposalRecordedEvent },
    { eventType: PLAN_REVISION_ACCEPTED_EVENT, schemaVersion: PLAN_REVISION_ACCEPTED_SCHEMA_VERSION,
      validate: validatePlanRevisionAcceptedEvent },
  ],
  lookups: [PLAN_PROPOSAL_GOAL_LOOKUP, PLAN_PROPOSAL_REQUEST_LOOKUP, PLAN_REVISION_BY_GOAL_LOOKUP],
};
