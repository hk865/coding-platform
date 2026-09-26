/**
 * R3c Plan/Proposal record codecs: persisted encoding, identity/version checks
 * and the v1/v2 discriminated decode. Domain admission of an initial plan lives
 * in `plan-validation.ts`; this file never judges obligations, DAG or assignment.
 *
 * One registration decodes legacy `PlanProposal@1` and candidate `PlanProposal@2`
 * under the SAME aggregate identity (the v1 body has no `goalRef`, so the decode
 * keeps it as the discriminated `legacy_v1` view with `draft: null`; a new draft
 * is never fabricated). The RecordStore selects a codec by aggregateType, so the
 * validator must accept both stored bodies and reject anything else.
 *
 * This file performs no I/O: it only checks pure encoding, identity, version and
 * plan structure, and it computes no digest and starts no transaction.
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { RoleBindingRefV1, RunRef } from '../../../contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { PlanProposalSnapshot } from '../../../contracts/goal-change.js';
import type {
  ArchitectureBaselineRevisionRef,
  CompletionPolicyRevisionRef,
} from '../../../contracts/governance.js';
import type { GoalRef, ProjectRef, WorkspaceRef } from '../../../contracts/ledger.js';
import type {
  PlanRevisionAcceptedEvent,
  PlanRevisionRef,
  PlanRevisionSnapshot,
} from '../../../contracts/plan.js';
import { isArtifactRef } from '../../record-store/body-codec.js';
import type { RecordLookupIndex } from '../../record-store/lookup-ports.js';
import type {
  DecodeResult,
  EncodedDomainEvent,
  EncodedEventSchema,
  EncodedRecord,
  EncodedRecordSchema,
} from '../../record-store/ports.js';
import type { PlanChangeReason, PlanProposal, PlanProposalRef } from './plan-contracts.js';

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

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isSafeRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
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
  if (!isRecord(parsed)) return `${what} JSON must be an object`;
  return parsed;
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

function planProposalRefFromValue(value: unknown): PlanProposalRef | null {
  if (!isRecord(value)) return null;
  if (value['aggregateType'] !== 'PlanProposal') return null;
  if (!isNonEmptyString(value['projectId'])) return null;
  if (!isNonEmptyString(value['workspaceId'])) return null;
  if (!isNonEmptyString(value['proposalId'])) return null;
  return { aggregateType: 'PlanProposal', projectId: value['projectId'],
    workspaceId: value['workspaceId'], proposalId: value['proposalId'] };
}

function planRevisionRefFromValue(value: unknown, projectId: string): PlanRevisionRef | null {
  if (!isRecord(value)) return null;
  if (value['aggregateType'] !== 'PlanRevision') return null;
  if (!isNonEmptyString(value['projectId']) || value['projectId'] !== projectId) return null;
  if (!isNonEmptyString(value['planId'])) return null;
  return { aggregateType: 'PlanRevision', projectId: value['projectId'], planId: value['planId'] };
}

function goalRefFromValue(value: unknown, projectId: string): GoalRef | null {
  if (!isRecord(value)) return null;
  if (value['aggregateType'] !== 'Goal') return null;
  if (!isNonEmptyString(value['projectId']) || value['projectId'] !== projectId) return null;
  if (!isNonEmptyString(value['goalId'])) return null;
  return { aggregateType: 'Goal', projectId: value['projectId'], goalId: value['goalId'] };
}

function workspaceRefFromValue(value: unknown, projectId: string): WorkspaceRef | null {
  if (!isRecord(value)) return null;
  if (value['aggregateType'] !== 'Workspace') return null;
  if (!isNonEmptyString(value['projectId']) || value['projectId'] !== projectId) return null;
  if (!isNonEmptyString(value['workspaceId'])) return null;
  return { aggregateType: 'Workspace', projectId: value['projectId'], workspaceId: value['workspaceId'] };
}

function completionPolicyRefFromValue(value: unknown, projectId: string): CompletionPolicyRevisionRef | null {
  if (!isRecord(value)) return null;
  if (value['aggregateType'] !== 'CompletionPolicyRevision') return null;
  if (!isNonEmptyString(value['projectId']) || value['projectId'] !== projectId) return null;
  if (!isNonEmptyString(value['policyId'])) return null;
  if (!isPositiveRevision(value['revision'])) return null;
  return { aggregateType: 'CompletionPolicyRevision', projectId: value['projectId'],
    policyId: value['policyId'], revision: value['revision'] };
}

function architectureRefFromValue(value: unknown, projectId: string): ArchitectureBaselineRevisionRef | null {
  if (!isRecord(value)) return null;
  if (value['aggregateType'] !== 'ArchitectureBaselineRevision') return null;
  if (!isNonEmptyString(value['projectId']) || value['projectId'] !== projectId) return null;
  if (!isNonEmptyString(value['baselineId'])) return null;
  if (!isPositiveRevision(value['revision'])) return null;
  return { aggregateType: 'ArchitectureBaselineRevision', projectId: value['projectId'],
    baselineId: value['baselineId'], revision: value['revision'] };
}

function actorFromValue(value: unknown): ActorRef | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value['id'])) return null;
  const kind = value['kind'];
  if (kind === 'human' || kind === 'system') return { kind, id: value['id'] };
  if (kind !== 'agent') return null;
  const runRef = value['runRef'];
  if (!isRecord(runRef)) return null;
  if (!isNonEmptyString(runRef['projectId']) || !isNonEmptyString(runRef['goalId']) || !isNonEmptyString(runRef['runId'])) return null;
  return { kind: 'agent', id: value['id'], runRef: { aggregateType: 'Run', projectId: runRef['projectId'],
    goalId: runRef['goalId'], runId: runRef['runId'] } };
}

function runRefFromValue(value: unknown): RunRef | null {
  if (!isRecord(value)) return null;
  if (value['aggregateType'] !== 'Run') return null;
  if (!isNonEmptyString(value['projectId']) || !isNonEmptyString(value['goalId']) || !isNonEmptyString(value['runId'])) return null;
  return { aggregateType: 'Run', projectId: value['projectId'], goalId: value['goalId'], runId: value['runId'] };
}

function sessionRefFromValue(value: unknown): SessionRef | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value['projectId']) || !isNonEmptyString(value['sessionId'])) return null;
  return { projectId: value['projectId'], sessionId: value['sessionId'] };
}

function roleBindingRefFromValue(value: unknown): RoleBindingRefV1 | null {
  if (!isRecord(value)) return null;
  if (value['schemaVersion'] !== 1) return null;
  if (!isNonEmptyString(value['bindingId']) || !isNonEmptyString(value['templateId'])
    || !isNonEmptyString(value['templateRevision']) || !isNonEmptyString(value['policyRevision'])) return null;
  if (!isSafeRevision(value['bindingVersion'])) return null;
  return { schemaVersion: 1, bindingId: value['bindingId'], templateId: value['templateId'],
    templateRevision: value['templateRevision'], bindingVersion: value['bindingVersion'],
    policyRevision: value['policyRevision'] };
}

/**
 * Strict, versioned Agent submission source (W2 §8.1). A candidate_v2 may omit
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
  if (!isNonEmptyString(value['configurationRevision'])) {
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
    return isNonEmptyString(value['stageId']) ? [] : [`${path}.stageId must be a non-empty string`];
  }
  if (kind === 'module') {
    const issues: string[] = [];
    if (!isNonEmptyString(value['stageId'])) issues.push(`${path}.stageId must be a non-empty string`);
    if (!isNonEmptyString(value['moduleRef'])) issues.push(`${path}.moduleRef must be a non-empty string`);
    return issues;
  }
  return [`${path}.kind must be goal|stage|module`];
}

function runtimeTaskIssues(value: unknown, path: string): string[] {
  if (!isRecord(value)) return [`${path} must be an object`];
  const issues: string[] = [];
  if (!isNonEmptyString(value['taskId'])) issues.push(`${path}.taskId must be a non-empty string`);
  if (value['stageId'] !== undefined && !isNonEmptyString(value['stageId'])) issues.push(`${path}.stageId must be a non-empty string when present`);
  if (!isNonEmptyString(value['title'])) issues.push(`${path}.title must be a non-empty string`);
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
  if (!isNonEmptyString(value['taskId'])) issues.push(`${path}.taskId must be a non-empty string`);
  if (!isNonEmptyString(value['role'])) issues.push(`${path}.role must be a non-empty string`);
  if (!isNonEmptyString(value['instruction'])) issues.push(`${path}.instruction must be a non-empty string`);
  return issues;
}

function obligationIssues(value: unknown, path: string): string[] {
  if (!isRecord(value)) return [`${path} must be an object`];
  const issues: string[] = [];
  if (!isNonEmptyString(value['obligationId'])) issues.push(`${path}.obligationId must be a non-empty string`);
  if (!isNonEmptyString(value['title'])) issues.push(`${path}.title must be a non-empty string`);
  if (!isEnum(value['requirementLevel'], REQUIREMENT_LEVELS)) issues.push(`${path}.requirementLevel must be required|optional`);
  if (!Array.isArray(value['taskIds']) || !(value['taskIds'] as unknown[]).every(isNonEmptyString)) {
    issues.push(`${path}.taskIds must be an array of non-empty strings`);
  }
  const requirements = value['verificationRequirements'];
  if (!Array.isArray(requirements)) issues.push(`${path}.verificationRequirements must be an array`);
  else requirements.forEach((requirement, index) => {
    const rpath = `${path}.verificationRequirements[${index}]`;
    if (!isRecord(requirement)) { issues.push(`${rpath} must be an object`); return; }
    if (!isNonEmptyString(requirement['requirementId'])) issues.push(`${rpath}.requirementId must be a non-empty string`);
    if (!isEnum(requirement['requirementLevel'], REQUIREMENT_LEVELS)) issues.push(`${rpath}.requirementLevel must be required|optional`);
    if (!isNonEmptyString(requirement['kind'])) issues.push(`${rpath}.kind must be a non-empty string`);
    if (!isNonEmptyString(requirement['description'])) issues.push(`${rpath}.description must be a non-empty string`);
  });
  return issues;
}

function planValidationErrorArrayIssues(value: unknown): string[] {
  if (!Array.isArray(value)) return ['plan issues must be an array'];
  const issues: string[] = [];
  value.forEach((entry, index) => {
    const path = `plan issues[${index}]`;
    if (!isRecord(entry)) { issues.push(`${path} must be an object`); return; }
    if (!isNonEmptyString(entry['path'])) issues.push(`${path}.path must be a non-empty string`);
    if (typeof entry['code'] !== 'string' || !PLAN_VALIDATION_CODES.has(entry['code'])) issues.push(`${path}.code is not a target PlanValidationCode`);
    if (!isNonEmptyString(entry['message'])) issues.push(`${path}.message must be a non-empty string`);
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
  const projectId = isRecord(ref) && isNonEmptyString(ref['projectId']) ? ref['projectId'] : null;
  const planTaskIds = Array.isArray(tasks)
    ? (tasks as unknown[]).map((task) => isRecord(task) ? task['taskId'] : undefined).filter(isNonEmptyString)
    : [];
  const planIds = new Set(planTaskIds);
  const seen = new Set<string>();
  let previous: string | null = null;
  entries.forEach((entry, index) => {
    const path = `plan taskStateBasis.entries[${index}]`;
    if (!isRecord(entry)) { issues.push(`${path} must be an object`); return; }
    const taskId = entry['taskId'];
    if (!isNonEmptyString(taskId)) { issues.push(`${path}.taskId must be a non-empty string`); return; }
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

function structuralPlanIssues(value: unknown, requireGoalId: boolean): string[] {
  if (!isRecord(value)) return ['plan body must be an object'];
  const issues: string[] = [];
  const schemaVersion = value['schemaVersion'];
  if (schemaVersion !== 1 && schemaVersion !== 2) issues.push('plan schemaVersion must be 1 or 2');
  if (!isNonEmptyString(value['planId'])) issues.push('plan planId must be a non-empty string');
  if (!isPositiveRevision(value['planRevision'])) issues.push('plan planRevision must be a positive integer');
  if (requireGoalId && !isNonEmptyString(value['goalId'])) issues.push('plan goalId must be a non-empty string');
  const review = value['reviewAdmissionProtocol'];
  if (review !== undefined && review !== 'independent-review-v1') issues.push('plan reviewAdmissionProtocol must be independent-review-v1 when present');
  const stages = value['stages'];
  if (!Array.isArray(stages)) issues.push('plan stages must be an array');
  else stages.forEach((stage, index) => {
    const path = `plan stages[${index}]`;
    if (!isRecord(stage)) { issues.push(`${path} must be an object`); return; }
    if (!isNonEmptyString(stage['stageId'])) issues.push(`${path}.stageId must be a non-empty string`);
    if (!isNonEmptyString(stage['title'])) issues.push(`${path}.title must be a non-empty string`);
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
    if (!isNonEmptyString(edge['parentTaskId'])) issues.push(`${path}.parentTaskId must be a non-empty string`);
    if (!isNonEmptyString(edge['childTaskId'])) issues.push(`${path}.childTaskId must be a non-empty string`);
  });
  const dag = value['executionDag'];
  if (!isRecord(dag) || !Array.isArray(dag['dependsOn'])) issues.push('plan executionDag.dependsOn must be an array');
  else (dag['dependsOn'] as unknown[]).forEach((edge, index) => {
    const path = `plan executionDag.dependsOn[${index}]`;
    if (!isRecord(edge)) { issues.push(`${path} must be an object`); return; }
    if (!isNonEmptyString(edge['taskId'])) issues.push(`${path}.taskId must be a non-empty string`);
    if (!isNonEmptyString(edge['dependsOnId'])) issues.push(`${path}.dependsOnId must be a non-empty string`);
    const requires = edge['requires'];
    if (!isRecord(requires)) issues.push(`${path}.requires must be an object`);
    else {
      if (!isEnum(requires['kind'], DEPENDENCY_KINDS)) issues.push(`${path}.requires.kind is not a legal dependency kind`);
      if (!isNonEmptyString(requires['label'])) issues.push(`${path}.requires.label must be a non-empty string`);
    }
  });
  // A single stable store codec (`PlanRevisionSnapshot@1`) carries explicit
  // content versions 1|2. v1 is byte-compatible and must not smuggle v2-only
  // fields; v2 shape is validated here while membership/DAG legality stays in
  // plan-validation. Unknown versions never decode.
  if (schemaVersion === 1) {
    if (value['taskRelations'] !== undefined) issues.push('plan schemaVersion 1 must not carry taskRelations');
    if (value['inputRequirements'] !== undefined) issues.push('plan schemaVersion 1 must not carry inputRequirements');
    if (value['taskStateBasis'] !== undefined) issues.push('plan schemaVersion 1 must not carry taskStateBasis');
    // `executionIntent` is a v2-only capability. The parent version branch owns
    // the ban (not only the enum check) so a v1 body can never smuggle it.
    if (Array.isArray(tasks) && tasks.some((task) => isRecord(task) && task['executionIntent'] !== undefined)) {
      issues.push('plan schemaVersion 1 must not carry task executionIntent');
    }
  } else if (schemaVersion === 2) {
    const relations = value['taskRelations'];
    if (relations !== undefined) {
      if (!Array.isArray(relations)) issues.push('plan taskRelations must be an array when present');
      else relations.forEach((relation, index) => {
        const path = `plan taskRelations[${index}]`;
        if (!isRecord(relation)) { issues.push(`${path} must be an object`); return; }
        if (!isNonEmptyString(relation['fromTaskId'])) issues.push(`${path}.fromTaskId must be a non-empty string`);
        if (!isNonEmptyString(relation['toTaskId'])) issues.push(`${path}.toTaskId must be a non-empty string`);
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
        if (!isNonEmptyString(requirement['requirementId'])) issues.push(`${path}.requirementId must be a non-empty string`);
        if (!isNonEmptyString(requirement['consumerTaskId'])) issues.push(`${path}.consumerTaskId must be a non-empty string`);
        if (requirement['kind'] !== 'artifact') issues.push(`${path}.kind must be artifact`);
        if (!isArtifactRef(requirement['artifactRef'])) issues.push(`${path}.artifactRef must be an ArtifactRef`);
      });
    }
    // W1 compiler-owned accepted basis. A Draft/Proposal input must never carry
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
  }
  return issues;
}

// --------------------------------------------------------------------------
// Record validators / decoders
// --------------------------------------------------------------------------

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
    issues.push(...structuralPlanIssues(value['draft'], true));
    const reason = value['reason'];
    if (!isRecord(reason) || !isNonEmptyString(reason['text']) || !Array.isArray(reason['sources'])) {
      issues.push('candidate_v2.reason must carry text and sources');
    } else {
      (reason['sources'] as unknown[]).forEach((source, index) => {
        const path = `candidate_v2.reason.sources[${index}]`;
        if (!isRecord(source) || source['kind'] !== 'artifact' || !isNonEmptyString(source['contentType'])
          || !isNonEmptyString(source['digest']) || typeof source['sizeBytes'] !== 'number'
          || !Number.isSafeInteger(source['sizeBytes']) || source['sizeBytes'] < 0 || !isRecord(source['source'])) {
          issues.push(`${path} must be an ArtifactRef`);
        }
      });
    }
    const status = value['status'];
    if (status !== 'candidate' && status !== 'accepted' && status !== 'rejected') {
      issues.push('candidate_v2.status must be candidate|accepted|rejected');
    }
    issues.push(...planValidationErrorArrayIssues(value['issues']));
    return issues;
  }
  // Legacy PlanProposalSnapshot@1: no complete draft exists; keep the original body.
  if (value['schemaVersion'] !== 1) issues.push('legacy PlanProposal schemaVersion must be 1');
  if (value['revision'] !== 1) issues.push('legacy PlanProposal revision must be 1');
  const proposal = value['proposal'];
  if (!isRecord(proposal)) issues.push('legacy PlanProposal must carry a proposal object');
  else {
    if (goalRefFromValue(proposal['sourceGoalRef'], ref.projectId) === null) {
      issues.push('legacy PlanProposal sourceGoalRef must be a GoalRef in this project');
    }
    if (planRevisionRefFromValue(proposal['sourcePlanRef'], ref.projectId) === null) {
      issues.push('legacy PlanProposal sourcePlanRef must be a PlanRevisionRef in this project');
    }
  }
  if (!isNonEmptyString(value['recordedAt'])) issues.push('legacy PlanProposal recordedAt must be a non-empty string');
  return issues;
}

function validatePlanProposalRecord(record: EncodedRecord): DecodeResult<EncodedRecord> {
  if (record.schemaId !== PLAN_PROPOSAL_SCHEMA_ID) {
    return invalid(`expected schemaId ${PLAN_PROPOSAL_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const parsed = parseJsonObject(record.json, 'PlanProposal');
  if (typeof parsed === 'string') return invalid(parsed);
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
    || !isNonEmptyString(ref['projectId']) || !isNonEmptyString(ref['planId'])) {
    issues.push('PlanRevisionSnapshot.ref must be a full PlanRevision ref');
  } else {
    projectId = ref['projectId'];
    if (!isNonEmptyString(value['planId']) || value['planId'] !== ref['planId']) {
      issues.push('PlanRevisionSnapshot.planId must agree with its ref');
    }
  }
  if (value['revision'] !== 1) issues.push('PlanRevisionSnapshot.revision must be 1');
  if (goalRefFromValue(value['goalRef'], projectId) === null) {
    issues.push('PlanRevisionSnapshot.goalRef must be a GoalRef in this project');
  }
  if (!isNonEmptyString(value['acceptedAt'])) issues.push('PlanRevisionSnapshot.acceptedAt must be a non-empty string');
  issues.push(...pinIssues(value['effectiveCompletionPolicy'], projectId, 'policy'));
  issues.push(...pinIssues(value['effectiveArchitectureBaseline'], projectId, 'architecture'));
  issues.push(...structuralPlanIssues(value, false));
  return issues;
}

function validatePlanRevisionRecord(record: EncodedRecord): DecodeResult<EncodedRecord> {
  if (record.schemaId !== PLAN_REVISION_SCHEMA_ID) {
    return invalid(`expected schemaId ${PLAN_REVISION_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const parsed = parseJsonObject(record.json, 'PlanRevisionSnapshot');
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
  if (!isNonEmptyString(event.eventId)) issues.push('eventId must be a non-empty string');
  if (!isNonEmptyString(event.occurredAt)) issues.push('occurredAt must be a non-empty string');
  if (parsed['eventId'] !== event.eventId) issues.push('outer eventId disagrees with the event JSON');
  if (parsed['eventType'] !== event.eventType) issues.push('outer eventType disagrees with the event JSON');
  if (parsed['schemaVersion'] !== event.schemaVersion) issues.push('outer schemaVersion disagrees with the event JSON');
  if (parsed['occurredAt'] !== event.occurredAt) issues.push('outer occurredAt disagrees with the event JSON');
  return issues;
}

function validatePlanProposalRecordedEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  const parsed = parseJsonObject(event.json, 'PlanProposalRecorded event');
  if (typeof parsed === 'string') return invalid(parsed);
  const issues = eventEnvelopeIssues(event, PLAN_PROPOSAL_RECORDED_EVENT, PLAN_PROPOSAL_RECORDED_SCHEMA_VERSION, parsed);
  if (!isNonEmptyString(parsed['projectId'])) issues.push('PlanProposalRecorded projectId must be a non-empty string');
  if (!isNonEmptyString(parsed['workspaceId'])) issues.push('PlanProposalRecorded workspaceId must be a non-empty string');
  if (parsed['aggregateType'] !== 'PlanProposal') issues.push('PlanProposalRecorded aggregateType must be "PlanProposal"');
  if (!isNonEmptyString(parsed['aggregateId'])) issues.push('PlanProposalRecorded aggregateId must be a non-empty string');
  if (!isPositiveRevision(parsed['aggregateRevision'])) issues.push('PlanProposalRecorded aggregateRevision must be a positive integer');
  if (!isNonEmptyString(parsed['causationId'])) issues.push('PlanProposalRecorded causationId must be a non-empty string');
  if (!isNonEmptyString(parsed['correlationId'])) issues.push('PlanProposalRecorded correlationId must be a non-empty string');
  if (!isNonEmptyString(parsed['idempotencyKey'])) issues.push('PlanProposalRecorded idempotencyKey must be a non-empty string');
  if (actorFromValue(parsed['actor']) === null) issues.push('PlanProposalRecorded actor is not a valid ActorRef');
  const payload = parsed['payload'];
  if (!isRecord(payload)) issues.push('PlanProposalRecorded payload must be an object');
  else {
    const expectedRef: PlanProposalRef | null = isNonEmptyString(parsed['projectId']) && isNonEmptyString(parsed['workspaceId'])
      && isNonEmptyString(parsed['aggregateId'])
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
  const parsed = parseJsonObject(event.json, 'PlanRevisionAccepted event');
  if (typeof parsed === 'string') return invalid(parsed);
  const issues = eventEnvelopeIssues(event, PLAN_REVISION_ACCEPTED_EVENT, PLAN_REVISION_ACCEPTED_SCHEMA_VERSION, parsed);
  if (!isNonEmptyString(parsed['projectId'])) issues.push('PlanRevisionAccepted projectId must be a non-empty string');
  if (!isNonEmptyString(parsed['workspaceId'])) issues.push('PlanRevisionAccepted workspaceId must be a non-empty string');
  if (parsed['aggregateType'] !== 'PlanRevision') issues.push('PlanRevisionAccepted aggregateType must be "PlanRevision"');
  if (!isNonEmptyString(parsed['aggregateId'])) issues.push('PlanRevisionAccepted aggregateId must be a non-empty string');
  if (parsed['aggregateRevision'] !== 1) issues.push('PlanRevisionAccepted aggregateRevision must be 1');
  if (!isNonEmptyString(parsed['causationId'])) issues.push('PlanRevisionAccepted causationId must be a non-empty string');
  if (!isNonEmptyString(parsed['correlationId'])) issues.push('PlanRevisionAccepted correlationId must be a non-empty string');
  if (!isNonEmptyString(parsed['idempotencyKey'])) issues.push('PlanRevisionAccepted idempotencyKey must be a non-empty string');
  if (actorFromValue(parsed['actor']) === null) issues.push('PlanRevisionAccepted actor is not a valid ActorRef');
  const payload = parsed['payload'];
  if (!isRecord(payload)) issues.push('PlanRevisionAccepted payload must be an object');
  else {
    if (!isNonEmptyString(payload['goalId'])) issues.push('PlanRevisionAccepted payload.goalId must be a non-empty string');
    if (!isPositiveRevision(payload['goalAggregateRevision'])) issues.push('PlanRevisionAccepted payload.goalAggregateRevision must be a positive integer');
    const snapshot = payload['planRevision'];
    if (isRecord(snapshot) && isNonEmptyString(parsed['aggregateId'])) {
      const ref = snapshot['ref'];
      if (!isRecord(ref) || ref['planId'] !== parsed['aggregateId'] || ref['projectId'] !== parsed['projectId']) {
        issues.push('PlanRevisionAccepted snapshot ref disagrees with the event aggregate');
      }
    }
    issues.push(...planRevisionSnapshotIssues(snapshot));
  }
  if (issues.length > 0) return invalid(`PlanRevisionAccepted is invalid: ${issues.join('; ')}`);
  return { status: 'decoded', value: copyEvent(event) };
}

/** Decodes a stored PlanProposal record into the v1/v2 discriminated view. */
export function decodePlanProposalRecord(record: EncodedRecord): DecodeResult<PlanProposal> {
  const checked = validatePlanProposalRecord(record);
  if (checked.status !== 'decoded') return checked;
  const parsed = JSON.parse(record.json) as UnknownRecord;
  if (parsed['kind'] === 'candidate_v2') {
    return { status: 'decoded', value: parsed as unknown as PlanProposal };
  }
  const legacy = parsed as unknown as PlanProposalSnapshot;
  return {
    status: 'decoded',
    value: {
      kind: 'legacy_v1',
      ref: legacy.ref,
      revision: 1,
      schemaVersion: 1,
      goalRef: legacy.proposal.sourceGoalRef,
      basedOn: legacy.proposal.sourcePlanRef,
      draft: null,
      legacy,
      status: 'candidate',
      issues: [],
    },
  };
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

export function encodePlanProposal(proposal: PlanProposal): EncodedRecord {
  return { refKey: planProposalRefKey(proposal.ref), schemaId: PLAN_PROPOSAL_SCHEMA_ID,
    revision: proposal.revision, json: JSON.stringify(proposal) };
}

export function encodePlanRevisionSnapshot(snapshot: PlanRevisionSnapshot): EncodedRecord {
  return { refKey: planRevisionRefKey(snapshot.ref), schemaId: PLAN_REVISION_SCHEMA_ID,
    revision: 1, json: JSON.stringify(snapshot) };
}

export function encodePlanProposalRecordedEvent(event: PlanProposalRecordedEvent): EncodedDomainEvent {
  return { eventId: event.eventId, eventType: event.eventType, schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt, json: JSON.stringify(event) };
}

export function encodePlanRevisionAcceptedEvent(event: PlanRevisionAcceptedEvent): EncodedDomainEvent {
  return { eventId: event.eventId, eventType: event.eventType, schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt, json: JSON.stringify(event) };
}

// --------------------------------------------------------------------------
// The one registration
// --------------------------------------------------------------------------

const PLAN_PROPOSAL_RECORD_SCHEMA: EncodedRecordSchema = {
  schemaId: PLAN_PROPOSAL_SCHEMA_ID,
  aggregateType: 'PlanProposal',
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
  lookups: [PLAN_PROPOSAL_GOAL_LOOKUP],
};
