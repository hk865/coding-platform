/** Canonical task facts for R3c graph/ready reads and future R4c claim checks.
 * A missing schema/index/provider is incomplete, never an empty set of facts. */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreError, CoreRejection } from '../../../contracts/core/results.js';
import type {
  RunSnapshot,
  TaskAttemptRef,
  TaskLeaseSnapshot,
  TaskTriple,
} from '../../../contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { completionPolicyContentDigest } from '../../../contracts/governance.js';
import type {
  ArchitectureBaselinePin,
  ArchitectureBaselineRevisionRef,
  CompletionPolicyContentV1,
  CompletionPolicyPin,
  CompletionPolicyRevisionRef,
} from '../../../contracts/governance.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import { seqOfCommitCursor } from '../../../contracts/ledger.js';
import type { Phase, PlanRevisionRef, PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type { TaskReductionSnapshot } from '../../../contracts/reduction.js';
import type { GoalPhaseRef, GoalPhaseSnapshot } from '../../../contracts/goal-phase.js';
import type { TaskPhaseCauseV1 } from '../../../contracts/task-failure.js';
import type { SessionAnomalyAnchorV1 } from '../../../contracts/session-anomaly.js';
import type { QueryJobRef } from '../../../contracts/query-job.js';
import type {
  TaskRequeueRef, TaskRequeueSnapshotV1, TaskReworkRefusalRef, TaskReworkRefusalSnapshotV1,
} from '../../../contracts/task-requeue.js';
import type { RoundSnapshot } from '../../../contracts/verification.js';
import type { RecordLookupPort, RecordLookupRequest } from '../../record-store/lookup-ports.js';
import type {
  DecodeResult,
  EncodedRecord,
  GoalRecordTransactionPort,
  RecordBackendSchemas,
  RecordGuard,
} from '../../record-store/ports.js';
import { decodeGoalSnapshot } from '../persistence/record-codecs.js';
import { taskLeaseSnapshotProblem } from '../persistence/execution-entry-codecs.js';
import {
  derivePlanProposalStatus, derivePlanRevisionStatus, type FutureChangeTaskFactsV1, type TracedTaskFactsV1,
} from '../state/plan-machine.js';
import { projectTaskPhase, type TaskPhaseFacts } from '../state/task-machine.js';
import { countEndedGoalRuns } from '../state/task-failure.js';
import {
  isFinalizedNonPass, roundChainHead, roundTaskSignal, type RoundChainHeadV1, type RoundTaskSignalV1,
} from '../state/verification-machine.js';
import {
  VERIFICATION_ROUND_BY_TASK_LOOKUP, VERIFICATION_ROUND_CHAIN_LOOKUP_LIMIT, VERIFICATION_ROUND_ORIGINAL_LOOKUP,
  decodeVerificationRoundSnapshot,
} from '../persistence/evidence-record-codecs.js';
import type { VerifiedGovernance } from './plan-commit-compiler.js';
import type { PlanProposal, PlanProposalRef } from '../model/plan-contracts.js';
import type { SessionResponsibilityBasisPort } from '../model/session-facts-contracts.js';
import {
  isBasisUnsupported, planTaskFacts, taskOriginVerdict, verifyBasisDelegation,
  type FrozenTaskDefinition, type PlanTaskFacts,
} from './plan-task-basis.js';
import {
  PLAN_PROPOSAL_LOOKUP_INDEX,
  S5_PLAN_PROPOSAL_BY_REQUEST,
  candidateRequestRef,
  compareProposalChainPositions,
  decodePlanProposalOrigin,
  decodePlanProposalRecord,
  decodePlanRevisionSnapshot,
  planProposalRefKey,
  planRevisionRefKey,
  type NoticeOriginWireV1,
} from '../persistence/plan-record-codecs.js';
import { decodeGoalPhaseSnapshot } from './completion-record-codecs.js';
import { decodeControlIntentSnapshot } from '../persistence/control-record-codecs.js';
import type { ControlIntentSnapshotV1 } from '../../../contracts/control-intent.js';
import {
  decodeTaskRequeueSnapshot, decodeTaskReworkRefusalSnapshot, taskRequeueRefKey, taskReworkRefusalRefKey,
} from './claim-record-codecs.js';

/**
 * Slice 5 §2.2/§2.4: the default-applying read of a candidate's request slot
 * (`candidateRequestRef`). It lives with the `PlanProposal` codec; re-exported
 * here so the tasks-side plan readers and services share the one declaration.
 */
export { candidateRequestRef } from '../persistence/plan-record-codecs.js';

const RUN_BY_GOAL_INDEX = 'r3c-run-by-goal';
/** R4c.1 directed candidate index: exactly one Task's Runs, any Plan. */
export const RUN_BY_TASK_INDEX = 'r4c-run-by-task';
/** A.2 step 5.6: the Runs of one workspace in one status (start-up reconcile, §12.1 steps 2 and 5). */
export const RUN_BY_WORKSPACE_STATUS_INDEX = 'a2-run-by-workspace-status';
/** A.2 step 5.6: the Goals of one workspace (start-up reconcile, §12.1 steps 6 and 6b). */
export const GOAL_BY_WORKSPACE_INDEX = 'a2-goal-by-workspace';
/** A.2 step 5.6: the Runs of one workspace by outcome; `outcome_unknown` for §12.1 step 2 (W-15) and step 5 (W-19). */
export const RUN_BY_WORKSPACE_OUTCOME_INDEX = 'a2-run-by-workspace-outcome';
const LOOKUP_PAGE_LIMIT = 200;
/** Bounded retries when the candidate set and the canonical re-read do not
 * share one ledger watermark; never stamp a newer watermark onto an older set. */
const WINDOW_MAX_ATTEMPTS = 4;

export type Rejected = { status: 'rejected'; code: CoreError; reason: string };

function incomplete(reason: string): Rejected {
  return { status: 'rejected', code: 'incomplete', reason };
}
function unavailable(reason: string): Rejected {
  return { status: 'rejected', code: 'unavailable', reason };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function isSafeRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function invalidRecord(reason: string): DecodeResult<EncodedRecord> {
  return { status: 'invalid', reason };
}
function copyRecord(record: EncodedRecord): EncodedRecord {
  return { refKey: record.refKey, schemaId: record.schemaId, revision: record.revision, json: record.json };
}
function parseJsonObject(json: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(json) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------
// Registered schemas owned by this reader
// --------------------------------------------------------------------------

function validateTaskLeaseSnapshot(record: EncodedRecord): DecodeResult<EncodedRecord> {
  if (record.schemaId !== 'TaskLeaseSnapshot@1') return invalidRecord(`expected schemaId TaskLeaseSnapshot@1, got ${record.schemaId}`);
  const parsed = parseJsonObject(record.json);
  if (parsed === null) return invalidRecord('TaskLease snapshot is not a JSON object');
  // The strict shared validator owns the @1 body plus the optional versioned
  // release; this reader adds only the outer ref_key/revision cross-checks.
  const problem = taskLeaseSnapshotProblem(parsed);
  if (problem !== null) return invalidRecord(problem);
  const ref = parsed['ref'];
  if (canonicalJson(ref as JsonValue) !== record.refKey) return invalidRecord('TaskLease ref is not the outer canonical ref_key');
  if (parsed['revision'] !== record.revision) return invalidRecord('TaskLease outer revision disagrees with the JSON revision');
  return { status: 'decoded', value: copyRecord(record) };
}

const REDUCTION_PHASES: readonly string[] = ['verifying', 'blocked', 'failed', 'satisfied'];

/**
 * Validates the OPTIONAL R3e.3 completion audit carried by a new formal
 * reduction. Historical rows omit it and stay readable; a present value must be
 * structurally complete so a corrupt audit is never accepted as satisfied.
 */
function validateTaskCompletionAudit(value: unknown): string | null {
  if (!isRecord(value)) return 'TaskReduction completion audit must be an object';
  if (value['schemaVersion'] !== 1) return 'TaskReduction completion schemaVersion must be 1';
  const roundRef = value['roundRef'];
  if (!isRecord(roundRef) || roundRef['aggregateType'] !== 'VerificationRound' || !nonEmpty(roundRef['projectId'])
    || !nonEmpty(roundRef['workspaceId']) || !nonEmpty(roundRef['goalId']) || !nonEmpty(roundRef['taskId'])
    || !nonEmpty(roundRef['runId']) || !nonEmpty(roundRef['roundId'])) {
    return 'TaskReduction completion roundRef must be a complete VerificationRoundRef';
  }
  if (!isSafeRevision(value['roundRevision']) || value['roundRevision'] < 1) {
    return 'TaskReduction completion roundRevision must be a positive safe integer';
  }
  const basis = value['taskBasisRef'];
  if (!isRecord(basis) || basis['aggregateType'] !== 'PlanRevision' || !nonEmpty(basis['projectId'])
    || !nonEmpty(basis['planId'])) {
    return 'TaskReduction completion taskBasisRef must be a complete PlanRevisionRef';
  }
  const verificationPlanRef = value['verificationPlanRef'];
  if (!isRecord(verificationPlanRef) || !nonEmpty(verificationPlanRef['planId'])
    || !nonEmpty(verificationPlanRef['planDigest'])) {
    return 'TaskReduction completion verificationPlanRef must carry planId and planDigest';
  }
  if (!nonEmpty(value['configurationDigest'])) return 'TaskReduction completion configurationDigest is required';
  const evidenceRefs = value['evidenceRefs'];
  if (!Array.isArray(evidenceRefs)) return 'TaskReduction completion evidenceRefs must be an array';
  for (const ref of evidenceRefs) {
    if (!isRecord(ref) || ref['aggregateType'] !== 'Evidence' || !nonEmpty(ref['projectId'])
      || !nonEmpty(ref['evidenceId'])) {
      return 'TaskReduction completion evidenceRefs must be complete Evidence refs';
    }
  }
  return null;
}

function validateTaskReductionSnapshot(record: EncodedRecord): DecodeResult<EncodedRecord> {
  if (record.schemaId !== 'TaskReductionSnapshot@1') return invalidRecord(`expected schemaId TaskReductionSnapshot@1, got ${record.schemaId}`);
  const parsed = parseJsonObject(record.json);
  if (parsed === null) return invalidRecord('TaskReduction snapshot is not a JSON object');
  const ref = parsed['ref'];
  if (!isRecord(ref) || ref['aggregateType'] !== 'TaskReduction' || !nonEmpty(ref['projectId'])
    || !nonEmpty(ref['goalId']) || !nonEmpty(ref['taskId'])) {
    return invalidRecord('TaskReduction snapshot has no complete TaskReductionRef');
  }
  if (canonicalJson(ref as JsonValue) !== record.refKey) return invalidRecord('TaskReduction ref is not the outer canonical ref_key');
  if (!isSafeRevision(parsed['revision']) || parsed['revision'] !== record.revision) return invalidRecord('TaskReduction outer revision disagrees with the JSON revision');
  if (parsed['schemaVersion'] !== 1) return invalidRecord('TaskReduction schemaVersion must be 1');
  const planRef = parsed['planRef'];
  if (!isRecord(planRef) || planRef['aggregateType'] !== 'PlanRevision' || planRef['projectId'] !== ref['projectId']
    || !nonEmpty(planRef['planId'])) {
    return invalidRecord('TaskReduction planRef must be a PlanRevisionRef in the same project');
  }
  if (typeof parsed['planRevision'] !== 'number' || !Number.isSafeInteger(parsed['planRevision']) || parsed['planRevision'] < 1) {
    return invalidRecord('TaskReduction planRevision must be a positive integer');
  }
  if (parsed['taskKind'] !== 'work' && parsed['taskKind'] !== 'gate') return invalidRecord('TaskReduction taskKind is not legal');
  if (parsed['requirementLevel'] !== 'required' && parsed['requirementLevel'] !== 'optional') return invalidRecord('TaskReduction requirementLevel is not legal');
  if (parsed['disposition'] !== 'active' && parsed['disposition'] !== 'deferred'
    && parsed['disposition'] !== 'cancelled' && parsed['disposition'] !== 'superseded') {
    return invalidRecord('TaskReduction disposition is not legal');
  }
  if (typeof parsed['phase'] !== 'string' || !REDUCTION_PHASES.includes(parsed['phase'])) return invalidRecord('TaskReduction phase is not legal');
  for (const field of ['effectiveEvidenceIds', 'blockingEvidenceIds', 'staleEvidenceIds', 'outOfScopeEvidenceIds', 'satisfiedObligationIds', 'causes']) {
    if (!Array.isArray(parsed[field])) return invalidRecord(`TaskReduction ${field} must be an array`);
  }
  if (!nonEmpty(parsed['reducedAt'])) return invalidRecord('TaskReduction reducedAt must be a non-empty string');
  if (parsed['completion'] !== undefined) {
    const completionProblem = validateTaskCompletionAudit(parsed['completion']);
    if (completionProblem !== null) return invalidRecord(completionProblem);
  }
  return { status: 'decoded', value: copyRecord(record) };
}

function validateCompletionPolicyRevision(record: EncodedRecord): DecodeResult<EncodedRecord> {
  if (record.schemaId !== 'CompletionPolicyRevisionSnapshot@1') return invalidRecord(`expected schemaId CompletionPolicyRevisionSnapshot@1, got ${record.schemaId}`);
  const parsed = parseJsonObject(record.json);
  if (parsed === null) return invalidRecord('CompletionPolicyRevision snapshot is not a JSON object');
  const ref = parsed['ref'];
  if (!isRecord(ref) || ref['aggregateType'] !== 'CompletionPolicyRevision' || !nonEmpty(ref['projectId'])
    || !nonEmpty(ref['policyId']) || typeof ref['revision'] !== 'number' || !Number.isSafeInteger(ref['revision']) || ref['revision'] < 1) {
    return invalidRecord('CompletionPolicyRevision snapshot has no complete ref');
  }
  if (canonicalJson(ref as JsonValue) !== record.refKey) return invalidRecord('CompletionPolicyRevision ref is not the outer canonical ref_key');
  if (!isSafeRevision(parsed['revision']) || parsed['revision'] !== record.revision) return invalidRecord('CompletionPolicyRevision outer revision disagrees with the JSON revision');
  if (parsed['schemaVersion'] !== 1) return invalidRecord('CompletionPolicyRevision schemaVersion must be 1');
  if (parsed['policyId'] !== ref['policyId']) return invalidRecord('CompletionPolicyRevision policyId disagrees with its ref');
  if (typeof parsed['contentRevision'] !== 'number' || !Number.isSafeInteger(parsed['contentRevision']) || parsed['contentRevision'] < 1) {
    return invalidRecord('CompletionPolicyRevision contentRevision must be a positive integer');
  }
  if (typeof parsed['contentDigest'] !== 'string' || !/^[0-9a-f]{64}$/.test(parsed['contentDigest'])) return invalidRecord('CompletionPolicyRevision contentDigest must be a sha256 hex');
  if (!isRecord(parsed['content'])) return invalidRecord('CompletionPolicyRevision content must be an object');
  return { status: 'decoded', value: copyRecord(record) };
}

function validateArchitectureBaselineRevision(record: EncodedRecord): DecodeResult<EncodedRecord> {
  if (record.schemaId !== 'ArchitectureBaselineRevisionSnapshot@1') return invalidRecord(`expected schemaId ArchitectureBaselineRevisionSnapshot@1, got ${record.schemaId}`);
  const parsed = parseJsonObject(record.json);
  if (parsed === null) return invalidRecord('ArchitectureBaselineRevision snapshot is not a JSON object');
  const ref = parsed['ref'];
  if (!isRecord(ref) || ref['aggregateType'] !== 'ArchitectureBaselineRevision' || !nonEmpty(ref['projectId'])
    || !nonEmpty(ref['baselineId']) || typeof ref['revision'] !== 'number' || !Number.isSafeInteger(ref['revision']) || ref['revision'] < 1) {
    return invalidRecord('ArchitectureBaselineRevision snapshot has no complete ref');
  }
  if (canonicalJson(ref as JsonValue) !== record.refKey) return invalidRecord('ArchitectureBaselineRevision ref is not the outer canonical ref_key');
  if (!isSafeRevision(parsed['revision']) || parsed['revision'] !== record.revision) return invalidRecord('ArchitectureBaselineRevision outer revision disagrees with the JSON revision');
  if (parsed['schemaVersion'] !== 1) return invalidRecord('ArchitectureBaselineRevision schemaVersion must be 1');
  if (parsed['baselineId'] !== ref['baselineId']) return invalidRecord('ArchitectureBaselineRevision baselineId disagrees with its ref');
  if (typeof parsed['contentRevision'] !== 'number' || !Number.isSafeInteger(parsed['contentRevision']) || parsed['contentRevision'] < 1) {
    return invalidRecord('ArchitectureBaselineRevision contentRevision must be a positive integer');
  }
  if (typeof parsed['contentDigest'] !== 'string' || !/^[0-9a-f]{64}$/.test(parsed['contentDigest'])) return invalidRecord('ArchitectureBaselineRevision contentDigest must be a sha256 hex');
  if (!isRecord(parsed['content'])) return invalidRecord('ArchitectureBaselineRevision content must be an object');
  return { status: 'decoded', value: copyRecord(record) };
}

function validateCompletionPolicyActive(record: EncodedRecord): DecodeResult<EncodedRecord> {
  return validateActivePointer(record, 'ProjectCompletionPolicyActive', 'policyId', 'CompletionPolicyRevision');
}
function validateArchitectureBaselineActive(record: EncodedRecord): DecodeResult<EncodedRecord> {
  return validateActivePointer(record, 'ProjectArchitectureBaselineActive', 'baselineId', 'ArchitectureBaselineRevision');
}
function validateActivePointer(record: EncodedRecord, aggregateType: string, idField: string, revisionType: string): DecodeResult<EncodedRecord> {
  if (record.schemaId !== `${aggregateType}Snapshot@1`) return invalidRecord(`expected schemaId ${aggregateType}Snapshot@1, got ${record.schemaId}`);
  const parsed = parseJsonObject(record.json);
  if (parsed === null) return invalidRecord(`${aggregateType} snapshot is not a JSON object`);
  const ref = parsed['ref'];
  if (!isRecord(ref) || ref['aggregateType'] !== aggregateType || !nonEmpty(ref['projectId'])) {
    return invalidRecord(`${aggregateType} snapshot has no complete ref`);
  }
  if (canonicalJson(ref as JsonValue) !== record.refKey) return invalidRecord(`${aggregateType} ref is not the outer canonical ref_key`);
  if (parsed['projectId'] !== ref['projectId']) return invalidRecord(`${aggregateType} projectId disagrees with its ref`);
  if (!isSafeRevision(parsed['revision']) || parsed['revision'] !== record.revision) return invalidRecord(`${aggregateType} outer revision disagrees with the JSON revision`);
  const active = parsed['activeRevision'];
  if (!isRecord(active) || active['aggregateType'] !== revisionType || active['projectId'] !== ref['projectId'] || !nonEmpty(active[idField])) {
    return invalidRecord(`${aggregateType} activeRevision must name a ${revisionType} in this project`);
  }
  return { status: 'decoded', value: copyRecord(record) };
}

/** Task-state registration. Run comes from `materialRecordSchemas()`; this adds
 * the exact Lease/Reduction codecs and the Run-by-goal candidate lookup. */
export const PLAN_STATE_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [
    { schemaId: 'TaskLeaseSnapshot@1', aggregateType: 'TaskLease', validate: validateTaskLeaseSnapshot },
    { schemaId: 'TaskReductionSnapshot@1', aggregateType: 'TaskReduction', validate: validateTaskReductionSnapshot },
  ],
  events: [],
  lookups: [
    { name: RUN_BY_GOAL_INDEX, aggregateType: 'Run', paths: ['ref.projectId', 'ref.goalId'] },
    { name: RUN_BY_TASK_INDEX, aggregateType: 'Run', paths: ['ref.projectId', 'ref.goalId', 'task.taskId'] },
    // A.2 step 5.6 (§12.1 steps 2, 5, 6): the start-up reconcile's candidate sets, each bounded by open
    // work, never by history: the Runs in a live status, the unknown ends, the Goals (the queued
    // intents are indexed beside the ControlIntent schema, `control-record-codecs.ts`).
    { name: RUN_BY_WORKSPACE_STATUS_INDEX, aggregateType: 'Run',
      paths: ['ref.projectId', 'workspaceSnapshot.workspaceId', 'status'] },
    { name: RUN_BY_WORKSPACE_OUTCOME_INDEX, aggregateType: 'Run',
      paths: ['ref.projectId', 'workspaceSnapshot.workspaceId', 'outcome'] },
    { name: GOAL_BY_WORKSPACE_INDEX, aggregateType: 'Goal', paths: ['ref.projectId', 'workspaceRef.workspaceId'] },
  ],
};

/** Governance read registration for the production factory. The immutable
 * revision rows and the project active pointers must be registered, not only in
 * a test fixture, or governance resolution is `incomplete`. */
export const PLAN_GOVERNANCE_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [
    { schemaId: 'CompletionPolicyRevisionSnapshot@1', aggregateType: 'CompletionPolicyRevision', validate: validateCompletionPolicyRevision },
    { schemaId: 'ArchitectureBaselineRevisionSnapshot@1', aggregateType: 'ArchitectureBaselineRevision', validate: validateArchitectureBaselineRevision },
    { schemaId: 'ProjectCompletionPolicyActiveSnapshot@1', aggregateType: 'ProjectCompletionPolicyActive', validate: validateCompletionPolicyActive },
    { schemaId: 'ProjectArchitectureBaselineActiveSnapshot@1', aggregateType: 'ProjectArchitectureBaselineActive', validate: validateArchitectureBaselineActive },
  ],
  events: [],
  lookups: [],
};

// --------------------------------------------------------------------------
// Canonical reads
// --------------------------------------------------------------------------

export type ReadBatch = { present: Map<string, EncodedRecord>; missing: Set<string>; readThrough: CommitCursor | null };

export function sameCursor(left: CommitCursor | null, right: CommitCursor | null): boolean {
  if (left === null || right === null) return left === right;
  try {
    return seqOfCommitCursor(left) === seqOfCommitCursor(right);
  } catch {
    return String(left) === String(right);
  }
}

export function laterCursor(left: CommitCursor | null, right: CommitCursor | null): CommitCursor | null {
  if (left === null) return right;
  if (right === null) return left;
  try {
    return seqOfCommitCursor(left) >= seqOfCommitCursor(right) ? left : right;
  } catch {
    return left;
  }
}

export async function readBatch(
  records: GoalRecordTransactionPort,
  refKeys: readonly string[],
): Promise<{ status: 'ready'; batch: ReadBatch } | Rejected> {
  const read = await records.readMany(refKeys);
  if (read.status !== 'ready') {
    if (read.code === 'not_found') return { status: 'rejected', code: 'not_found', reason: read.reason };
    if (read.code === 'invalid') return { status: 'rejected', code: 'invalid', reason: read.reason };
    if (read.code === 'unsupported') return incomplete(read.reason);
    return unavailable(`${read.code}: ${read.reason}`);
  }
  const present = new Map<string, EncodedRecord>();
  for (const record of read.value.records) present.set(record.refKey, record);
  return { status: 'ready', batch: { present, missing: new Set(read.value.missing), readThrough: read.value.readThrough } };
}

export function readRevisionNumber(batch: ReadBatch, key: string): number | null {
  const record = batch.present.get(key);
  if (record === undefined) return null;
  return Number.isSafeInteger(record.revision) ? record.revision : null;
}

export async function readGoal(
  records: GoalRecordTransactionPort,
  goalRef: GoalRef,
): Promise<{ status: 'ready'; goal: GoalSnapshot; readThrough: CommitCursor | null } | Rejected> {
  const key = canonicalJson(goalRef as unknown as JsonValue);
  const read = await readBatch(records, [key]);
  if (read.status !== 'ready') return read;
  const record = read.batch.present.get(key);
  if (record === undefined) return { status: 'rejected', code: 'not_found', reason: `goal ${goalRef.goalId} does not exist` };
  const decoded = decodeGoalSnapshot(record);
  if (decoded.status !== 'decoded') return unavailable(`goal ${goalRef.goalId} is corrupt: ${decoded.reason}`);
  return { status: 'ready', goal: decoded.value, readThrough: read.batch.readThrough };
}

/**
 * Canonical Project/Goal/Workspace scope read for one write. The Goal names its
 * workspace, so the Workspace row is read after the Goal; the returned
 * watermark is the later of the two reads and the caller keeps the EARLIEST
 * watermark across its whole read window as the commit horizon.
 */
export async function readGoalScope(
  records: GoalRecordTransactionPort,
  goalRef: GoalRef,
): Promise<{ status: 'ready'; goal: GoalSnapshot; projectKey: string; workspaceKey: string;
  projectRevision: number; workspaceRevision: number; readThrough: CommitCursor | null } | Rejected> {
  const projectKey = canonicalJson({ aggregateType: 'Project', projectId: goalRef.projectId } as unknown as JsonValue);
  const goalKey = canonicalJson(goalRef as unknown as JsonValue);
  const read = await readBatch(records, [projectKey, goalKey]);
  if (read.status !== 'ready') return read;
  if (read.batch.missing.has(projectKey)) return { status: 'rejected', code: 'not_found', reason: `project ${goalRef.projectId} does not exist` };
  const projectRevision = readRevisionNumber(read.batch, projectKey);
  const goalRecord = read.batch.present.get(goalKey);
  if (goalRecord === undefined) return { status: 'rejected', code: 'not_found', reason: `goal ${goalRef.goalId} does not exist` };
  if (projectRevision === null) return incomplete('the Project revision is not readable');
  const decoded = decodeGoalSnapshot(goalRecord);
  if (decoded.status !== 'decoded') return unavailable(`goal ${goalRef.goalId} is corrupt: ${decoded.reason}`);
  const goal = decoded.value;
  const workspaceKey = canonicalJson(goal.workspaceRef as unknown as JsonValue);
  const workspaceRead = await readBatch(records, [workspaceKey]);
  if (workspaceRead.status !== 'ready') return workspaceRead;
  if (workspaceRead.batch.missing.has(workspaceKey)) {
    return { status: 'rejected', code: 'not_found', reason: `workspace ${goal.workspaceRef.workspaceId} does not exist` };
  }
  const workspaceRevision = readRevisionNumber(workspaceRead.batch, workspaceKey);
  if (workspaceRevision === null) return incomplete('the Workspace revision is not readable');
  // The EARLIEST read of the window is the write horizon: an event added after
  // the Project/Goal read (even before the Workspace read) must conflict.
  return { status: 'ready', goal, projectKey, workspaceKey, projectRevision, workspaceRevision,
    readThrough: read.batch.readThrough };
}

export async function readPlan(
  records: GoalRecordTransactionPort,
  ref: PlanRevisionRef,
): Promise<{ status: 'ready'; plan: PlanRevisionSnapshot; readThrough: CommitCursor | null } | Rejected> {
  const key = planRevisionRefKey(ref);
  const read = await readBatch(records, [key]);
  if (read.status !== 'ready') return read;
  const record = read.batch.present.get(key);
  if (record === undefined) return { status: 'rejected', code: 'not_found', reason: `plan ${ref.planId} does not exist` };
  const decoded = decodePlanRevisionSnapshot(record);
  if (decoded.status !== 'decoded') return unavailable(`plan ${ref.planId} is corrupt: ${decoded.reason}`);
  return { status: 'ready', plan: decoded.value, readThrough: read.batch.readThrough };
}

export async function readProposal(
  records: GoalRecordTransactionPort,
  ref: PlanProposalRef,
): Promise<{ status: 'ready'; proposal: PlanProposal; readThrough: CommitCursor | null } | Rejected> {
  const key = planProposalRefKey(ref);
  const read = await readBatch(records, [key]);
  if (read.status !== 'ready') return read;
  const record = read.batch.present.get(key);
  if (record === undefined) return { status: 'rejected', code: 'not_found', reason: `proposal ${ref.proposalId} does not exist` };
  const decoded = decodePlanProposalRecord(record);
  if (decoded.status !== 'decoded') return unavailable(`proposal ${ref.proposalId} is corrupt: ${decoded.reason}`);
  return { status: 'ready', proposal: decoded.value, readThrough: read.batch.readThrough };
}

/**
 * Slice 5 §2.5/T-R2-2: the wire-only creation origin of one stored proposal,
 * read separately from the public DTO so a replace/accept/abandon rewrites the
 * record with the SAME `since` (never rebinds). A record without `since` keeps
 * the absent origin; a damaged origin is `unavailable`, never silently absent.
 */
export async function readProposalOrigin(
  records: GoalRecordTransactionPort,
  ref: PlanProposalRef,
): Promise<{ status: 'ready'; origin: NoticeOriginWireV1; readThrough: CommitCursor | null } | Rejected> {
  const key = planProposalRefKey(ref);
  const read = await readBatch(records, [key]);
  if (read.status !== 'ready') return read;
  const record = read.batch.present.get(key);
  if (record === undefined) return { status: 'rejected', code: 'not_found', reason: `proposal ${ref.proposalId} does not exist` };
  const decoded = decodePlanProposalOrigin(record);
  if (decoded.status !== 'decoded') {
    return unavailable(`proposal ${ref.proposalId} origin is corrupt: ${decoded.reason}`);
  }
  return { status: 'ready', origin: decoded.value, readThrough: read.batch.readThrough };
}

async function readLookupKeys(
  records: GoalRecordTransactionPort & RecordLookupPort,
  index: string,
  values: readonly (string | number | boolean | null)[],
): Promise<{ status: 'ready'; refKeys: string[]; readThrough: CommitCursor | null; stable: boolean } | Rejected> {
  const refKeys: string[] = [];
  let after: string | undefined;
  let watermark: CommitCursor | null = null;
  let first: CommitCursor | null | undefined;
  let stable = true;
  // 2A L10: the shared key read is paged to the very end; no 25-page /
  // 5,000-key window rejects a caller any more.
  for (;;) {
    const request: RecordLookupRequest = after === undefined
      ? { index, values, limit: LOOKUP_PAGE_LIMIT }
      : { index, values, after, limit: LOOKUP_PAGE_LIMIT };
    const result = await records.lookup(request);
    if (result.status !== 'ready') {
      if (result.code === 'unsupported') return incomplete(`lookup index ${index} is not registered`);
      if (result.code === 'invalid') return incomplete(`lookup index ${index} rejected the request: ${result.reason}`);
      return unavailable(`${result.code}: ${result.reason}`);
    }
    const pageWatermark = result.value.readThrough;
    if (first === undefined) first = pageWatermark;
    else if (!sameCursor(first, pageWatermark)) stable = false;
    watermark = laterCursor(watermark, pageWatermark);
    for (const record of result.value.records) refKeys.push(record.refKey);
    if (result.value.next === null) return { status: 'ready', refKeys, readThrough: watermark, stable };
    after = result.value.next;
  }
}

/** Candidate lookup only: the returned refKeys are re-read as canonical records. */
export async function findPendingProposal(
  records: GoalRecordTransactionPort & RecordLookupPort,
  goalRef: GoalRef,
  expected: { revision: number; activePlanRevision: PlanRevisionRef | null },
): Promise<{ status: 'ready'; goal: GoalSnapshot; proposal: PlanProposal | null;
  readThrough: CommitCursor | null } | Rejected> {
  const goalKey = canonicalJson(goalRef as unknown as JsonValue);
  for (let attempt = 0; attempt < WINDOW_MAX_ATTEMPTS; attempt += 1) {
    const found = await readLookupKeys(records, PLAN_PROPOSAL_LOOKUP_INDEX,
      [goalRef.projectId, goalRef.goalId]);
    if (found.status !== 'ready') return found;
    // One canonical batch both settles the watermark (the Goal key is always
    // present, even with zero candidates) and decodes the Goal the candidates
    // are filtered against. A proposal committed after the lookup is retried.
    const canonical = await readBatch(records, uniqueKeys([...found.refKeys, goalKey]));
    if (canonical.status !== 'ready') return canonical;
    const goalRecord = canonical.batch.present.get(goalKey);
    if (goalRecord === undefined) {
      return { status: 'rejected', code: 'not_found', reason: `goal ${goalRef.goalId} does not exist` };
    }
    const decodedGoal = decodeGoalSnapshot(goalRecord);
    if (decodedGoal.status !== 'decoded') {
      return unavailable(`goal ${goalRef.goalId} is corrupt: ${decodedGoal.reason}`);
    }
    const goal = decodedGoal.value;
    // The Goal must still carry the revision/active pointer the caller read.
    // A fresh Goal is never paired with a candidate selected against the old
    // pointer; the caller gets an explicit read conflict.
    if (goal.revision !== expected.revision
      || !samePlanRevisionPointer(goal.activePlanRevision, expected.activePlanRevision)) {
      return { status: 'rejected', code: 'source_stale',
        reason: 'the Goal changed while the pending plan was being read' };
    }
    if (!found.stable || !sameCursor(found.readThrough, canonical.batch.readThrough)) continue;
    let selected: PlanProposal | null = null;
    for (const key of found.refKeys) {
      const record = canonical.batch.present.get(key);
      if (record === undefined) continue;
      const decoded = decodePlanProposalRecord(record);
      if (decoded.status !== 'decoded') continue;
      const proposal = decoded.value;
      // PLAN-06: a legacy candidate is never pending; a stale one (basedOn ≠ the active plan) is skipped.
      if (proposal.kind !== 'candidate_v2') continue;
      if (proposal.goalRef.projectId !== goal.ref.projectId || proposal.goalRef.goalId !== goal.ref.goalId) continue;
      if (derivePlanProposalStatus(proposal, goal.activePlanRevision) !== 'candidate') continue;
      if (selected === null || key < planProposalRefKey(selected.ref)) selected = proposal;
    }
    return { status: 'ready', goal, proposal: selected, readThrough: canonical.batch.readThrough };
  }
  return { status: 'rejected', code: 'revision_conflict',
    reason: 'the pending-plan window changed while it was being read' };
}

/**
 * Slice 5 §2.4 per-request head read: the current candidate of ONE saved
 * request (`s5-plan-proposal-by-goal-request`). The returned head is a live
 * candidate even when it is derived stale; only `accepted`/`not_adopted`
 * candidates are closed. Part 1 declares the signature; the read lands in
 * part 2 together with the service that compiles the slot commit.
 */
export async function readRequestCandidateHead(
  records: GoalRecordTransactionPort & RecordLookupPort,
  input: { goalRef: GoalRef; requestRef: QueryJobRef },
): Promise<{ status: 'ready'; head: PlanProposal | null; readThrough: CommitCursor | null } | Rejected> {
  const { goalRef, requestRef } = input;
  const values = [goalRef.projectId, requestRef.workspaceId, goalRef.goalId, requestRef.queryJobId];
  for (let attempt = 0; attempt < WINDOW_MAX_ATTEMPTS; attempt += 1) {
    const found = await readLookupKeys(records, S5_PLAN_PROPOSAL_BY_REQUEST, values);
    if (found.status !== 'ready') return found;
    if (found.refKeys.length === 0) {
      return { status: 'ready', head: null, readThrough: found.readThrough };
    }
    const canonical = await readBatch(records, found.refKeys);
    if (canonical.status !== 'ready') return canonical;
    if (!found.stable || !sameCursor(found.readThrough, canonical.batch.readThrough)) continue;
    let head: PlanProposal | null = null;
    for (const key of found.refKeys) {
      const record = canonical.batch.present.get(key);
      if (record === undefined) continue;
      const decoded = decodePlanProposalRecord(record);
      if (decoded.status !== 'decoded') continue;
      const proposal = decoded.value;
      // §4.2 source 3: one live head per request. Only a stored `candidate` is
      // live (it may still be derived stale); accepted/not_adopted are closed.
      if (proposal.kind !== 'candidate_v2' || proposal.status !== 'candidate') continue;
      if (proposal.goalRef.projectId !== goalRef.projectId || proposal.goalRef.goalId !== goalRef.goalId) continue;
      if (candidateRequestRef(proposal) === null
        || candidateRequestRef(proposal)!.queryJobId !== requestRef.queryJobId) continue;
      if (head === null || planProposalRefKey(proposal.ref) < planProposalRefKey(head.ref)) head = proposal;
    }
    return { status: 'ready', head, readThrough: canonical.batch.readThrough };
  }
  return { status: 'rejected', code: 'revision_conflict',
    reason: 'the request-candidate window changed while it was being read' };
}

/**
 * Slice 5 §2.4 all-candidate enumeration: every saved candidate of one Goal
 * (each request's head plus the independent/legacy candidates). The caller
 * must never treat one `findPendingProposal` result as the whole set (spec
 * §8.2 "request head 并发"). Part 1 declares the signature.
 */
export async function enumerateGoalCandidates(
  records: GoalRecordTransactionPort & RecordLookupPort,
  goalRef: GoalRef,
): Promise<{ status: 'ready'; proposals: PlanProposal[]; readThrough: CommitCursor | null } | Rejected> {
  const values = [goalRef.projectId, goalRef.goalId];
  for (let attempt = 0; attempt < WINDOW_MAX_ATTEMPTS; attempt += 1) {
    const found = await readLookupKeys(records, PLAN_PROPOSAL_LOOKUP_INDEX, values);
    if (found.status !== 'ready') return found;
    const canonical = await readBatch(records, uniqueKeys(found.refKeys));
    if (canonical.status !== 'ready') return canonical;
    if (!found.stable || !sameCursor(found.readThrough, canonical.batch.readThrough)) continue;
    const proposals: PlanProposal[] = [];
    for (const key of found.refKeys) {
      const record = canonical.batch.present.get(key);
      if (record === undefined) continue;
      const decoded = decodePlanProposalRecord(record);
      if (decoded.status !== 'decoded') continue;
      const proposal = decoded.value;
      // §4.2 source 3: the live candidates of one Goal (each request's head plus
      // the independent candidates). Terminal (accepted/not_adopted) and legacy
      // rows are history, not candidates.
      if (proposal.kind !== 'candidate_v2' || proposal.status !== 'candidate') continue;
      if (proposal.goalRef.projectId !== goalRef.projectId || proposal.goalRef.goalId !== goalRef.goalId) continue;
      proposals.push(proposal);
    }
    proposals.sort((left, right) => {
      const leftKey = planProposalRefKey(left.ref);
      const rightKey = planProposalRefKey(right.ref);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
    return { status: 'ready', proposals, readThrough: canonical.batch.readThrough };
  }
  return { status: 'rejected', code: 'revision_conflict',
    reason: 'the candidate enumeration window changed while it was being read' };
}

/**
 * Slice 5 §4.2 source 3 CLOSED history: the terminal request candidates of one
 * Goal (`accepted`/`not_adopted` `candidate_v2` proposals), one per request,
 * using the request's LAST head. The live head of a request stays with
 * `enumerateGoalCandidates`; a request is closed history only once no live
 * candidate is left for it. The last head is the proposal no other proposal of
 * the same request replaced (`notAdopted.replacedBy`), so an answered card and
 * its closure keep the SAME per-request identity and merge into one card. Same
 * window/limit/failure rules as the live enumeration: a window that cannot be
 * finished is a failure, never a short page.
 */
export async function enumerateClosedGoalCandidates(
  records: GoalRecordTransactionPort & RecordLookupPort,
  goalRef: GoalRef,
): Promise<{ status: 'ready'; proposals: PlanProposal[]; readThrough: CommitCursor | null } | Rejected> {
  const values = [goalRef.projectId, goalRef.goalId];
  for (let attempt = 0; attempt < WINDOW_MAX_ATTEMPTS; attempt += 1) {
    const found = await readLookupKeys(records, PLAN_PROPOSAL_LOOKUP_INDEX, values);
    if (found.status !== 'ready') return found;
    const canonical = await readBatch(records, uniqueKeys(found.refKeys));
    if (canonical.status !== 'ready') return canonical;
    if (!found.stable || !sameCursor(found.readThrough, canonical.batch.readThrough)) continue;
    // §4.2 source 3: one card per request. Every v2 candidate that names a
    // request is grouped by that request; an independent (null-request)
    // candidate is not per-request history.
    const byRequest = new Map<string, PlanProposal[]>();
    const independent: PlanProposal[] = [];
    // Slice 5 §2.5/T-R2-2: each chain's creation position is its first
    // candidate's wire-only `since`, read beside the public DTO.
    const positions = new Map<string, CommitCursor | null>();
    for (const key of found.refKeys) {
      const record = canonical.batch.present.get(key);
      if (record === undefined) continue;
      const decoded = decodePlanProposalRecord(record);
      // §8.2 data row: a damaged proposal is `unavailable`, never skipped. A
      // dropped terminal head would hide a real closure, and a dropped successor
      // would break the replacement chain of its request.
      if (decoded.status !== 'decoded') {
        return unavailable(`plan proposal ${record.refKey}: ${decoded.reason}`);
      }
      const proposal = decoded.value;
      if (proposal.kind !== 'candidate_v2') continue;
      if (proposal.goalRef.projectId !== goalRef.projectId || proposal.goalRef.goalId !== goalRef.goalId) continue;
      const origin = decodePlanProposalOrigin(record);
      if (origin.status !== 'decoded') {
        return unavailable(`plan proposal ${record.refKey} origin: ${origin.reason}`);
      }
      positions.set(planProposalRefKey(proposal.ref), origin.value.since ?? null);
      const requestRef = candidateRequestRef(proposal);
      if (requestRef === null) {
        // §4.2 source 3 / §3.3 line 629: an independent candidate is keyed by its
        // own proposal; a stored terminal one is its own closed history card.
        if (proposal.status === 'accepted' || proposal.status === 'not_adopted') independent.push(proposal);
        continue;
      }
      const groupKey = canonicalJson(requestRef as unknown as JsonValue);
      const group = byRequest.get(groupKey);
      if (group === undefined) byRequest.set(groupKey, [proposal]);
      else group.push(proposal);
    }
    const proposals: PlanProposal[] = [];
    for (const group of byRequest.values()) {
      // The replacement link is stored on the replaced (old) head: a
      // `not_adopted` head with `replacedBy` is superseded by its successor, so
      // the request's last head is the proposal no other proposal replaced.
      const superseded = new Set<string>();
      for (const proposal of group) {
        if (proposal.kind !== 'candidate_v2' || proposal.status !== 'not_adopted') continue;
        if ((proposal.notAdopted?.replacedBy ?? null) === null) continue;
        superseded.add(planProposalRefKey(proposal.ref));
      }
      const heads = group.filter((proposal) => !superseded.has(planProposalRefKey(proposal.ref)));
      // A still-live head is owned by the live enumeration; do not fabricate a
      // second closed card for the same per-request identity.
      if (heads.some((proposal) => proposal.status === 'candidate')) continue;
      // §2.4/T-R2-2: the request's terminal is the head whose chain was created
      // LAST (its first candidate's creation commit), never the last in refKey
      // order and never "accepted first". `findCandidateProposal` compares the
      // same positions, so both entrances select the same terminal.
      let terminal: PlanProposal | null = null;
      for (const proposal of heads) {
        if (proposal.kind !== 'candidate_v2') continue;
        if (proposal.status !== 'accepted' && proposal.status !== 'not_adopted') continue;
        if (terminal === null) {
          terminal = proposal;
          continue;
        }
        const position = compareProposalChainPositions(
          { refKey: planProposalRefKey(proposal.ref), since: positions.get(planProposalRefKey(proposal.ref)) ?? null },
          { refKey: planProposalRefKey(terminal.ref), since: positions.get(planProposalRefKey(terminal.ref)) ?? null });
        if (position > 0) terminal = proposal;
      }
      if (terminal !== null) proposals.push(terminal);
    }
    // L11: append without an unbounded argument spread.
    for (const proposal of independent) proposals.push(proposal);
    proposals.sort((left, right) => {
      const leftKey = planProposalRefKey(left.ref);
      const rightKey = planProposalRefKey(right.ref);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
    return { status: 'ready', proposals, readThrough: canonical.batch.readThrough };
  }
  return { status: 'rejected', code: 'unavailable',
    reason: 'the closed-candidate enumeration window changed while it was being read' };
}

// --------------------------------------------------------------------------
// Governance resolution (real content digest, record revision guards)
// --------------------------------------------------------------------------

export type GovernanceRead =
  | { status: 'resolved'; governance: VerifiedGovernance; policyContent: CompletionPolicyContentV1;
      readThrough: CommitCursor | null }
  | Rejected;

function policyRefFromBody(value: unknown, projectId: string): CompletionPolicyRevisionRef | null {
  if (!isRecord(value)) return null;
  if (value['aggregateType'] !== 'CompletionPolicyRevision' || value['projectId'] !== projectId || !nonEmpty(value['policyId'])) return null;
  if (typeof value['revision'] !== 'number' || !Number.isSafeInteger(value['revision']) || value['revision'] < 1) return null;
  return { aggregateType: 'CompletionPolicyRevision', projectId, policyId: value['policyId'], revision: value['revision'] };
}
function architectureRefFromBody(value: unknown, projectId: string): ArchitectureBaselineRevisionRef | null {
  if (!isRecord(value)) return null;
  if (value['aggregateType'] !== 'ArchitectureBaselineRevision' || value['projectId'] !== projectId || !nonEmpty(value['baselineId'])) return null;
  if (typeof value['revision'] !== 'number' || !Number.isSafeInteger(value['revision']) || value['revision'] < 1) return null;
  return { aggregateType: 'ArchitectureBaselineRevision', projectId, baselineId: value['baselineId'], revision: value['revision'] };
}
/** Delegates to the ONE policy digest algorithm in the governance contract; the
 * stored-body adapter only owns the non-throwing read path (`null` on non-JSON). */
function completionPolicyDigest(body: Record<string, unknown>): string | null {
  try {
    return completionPolicyContentDigest({
      schemaVersion: body['schemaVersion'] as number,
      policyId: body['policyId'] as string,
      contentRevision: body['contentRevision'] as number,
      content: body['content'] as CompletionPolicyContentV1,
    });
  } catch { return null; }
}
function architectureBaselineDigest(body: Record<string, unknown>): string | null {
  try {
    return sha256Hex(canonicalJson({ schemaVersion: body['schemaVersion'],
      identity: { baselineId: body['baselineId'] }, revision: body['contentRevision'],
      content: body['content'] } as unknown as JsonValue));
  } catch { return null; }
}

export async function resolveGovernance(
  records: GoalRecordTransactionPort,
  projectId: string,
): Promise<GovernanceRead> {
  const policyActiveKey = canonicalJson({ aggregateType: 'ProjectCompletionPolicyActive', projectId } as unknown as JsonValue);
  const architectureActiveKey = canonicalJson({ aggregateType: 'ProjectArchitectureBaselineActive', projectId } as unknown as JsonValue);
  const active = await readBatch(records, [policyActiveKey, architectureActiveKey]);
  if (active.status !== 'ready') return active;
  const policyActive = active.batch.present.get(policyActiveKey);
  const architectureActive = active.batch.present.get(architectureActiveKey);
  const policyActiveRevision = readRevisionNumber(active.batch, policyActiveKey);
  const architectureActiveRevision = readRevisionNumber(active.batch, architectureActiveKey);
  if (policyActive === undefined || architectureActive === undefined
    || policyActiveRevision === null || architectureActiveRevision === null) {
    return incomplete('the project has no effective CompletionPolicy/ArchitectureBaseline activation');
  }
  const policyRef = policyRefFromBody(parseJsonObject(policyActive.json)?.['activeRevision'], projectId);
  const architectureRef = architectureRefFromBody(parseJsonObject(architectureActive.json)?.['activeRevision'], projectId);
  if (policyRef === null || architectureRef === null) return incomplete('an active governance pointer does not name a legal revision ref');
  const policyRecordKey = canonicalJson(policyRef as unknown as JsonValue);
  const architectureRecordKey = canonicalJson(architectureRef as unknown as JsonValue);
  const revisions = await readBatch(records, [policyRecordKey, architectureRecordKey]);
  if (revisions.status !== 'ready') return revisions;
  const policyRecord = revisions.batch.present.get(policyRecordKey);
  const architectureRecord = revisions.batch.present.get(architectureRecordKey);
  const policyRecordRevision = readRevisionNumber(revisions.batch, policyRecordKey);
  const architectureRecordRevision = readRevisionNumber(revisions.batch, architectureRecordKey);
  if (policyRecord === undefined || architectureRecord === undefined
    || policyRecordRevision === null || architectureRecordRevision === null) {
    return incomplete('an activated governance revision is missing from the ledger');
  }
  const policyBody = parseJsonObject(policyRecord.json);
  const architectureBody = parseJsonObject(architectureRecord.json);
  if (policyBody === null || architectureBody === null) return unavailable('a governance revision is not decodable');
  if (policyBody['contentRevision'] !== policyRef.revision || policyBody['policyId'] !== policyRef.policyId
    || architectureBody['contentRevision'] !== architectureRef.revision || architectureBody['baselineId'] !== architectureRef.baselineId) {
    return { status: 'rejected', code: 'source_stale', reason: 'the installed governance content revision disagrees with its active ref' };
  }
  const policyDigest = completionPolicyDigest(policyBody);
  const architectureDigest = architectureBaselineDigest(architectureBody);
  if (policyDigest === null || architectureDigest === null) return incomplete('the effective governance content is not canonical JSON');
  if (policyBody['contentDigest'] !== policyDigest || architectureBody['contentDigest'] !== architectureDigest) {
    return { status: 'rejected', code: 'source_stale', reason: 'the stored governance content digest does not match the recomputed content digest' };
  }
  const content = policyBody['content'];
  if (!isRecord(content) || !Array.isArray(content['requirementKinds'])
    || typeof content['minimumRequiredRequirementsPerObligation'] !== 'number') {
    return incomplete('the effective CompletionPolicy content is malformed');
  }
  const completionPolicy: CompletionPolicyPin = { ref: policyRef, digest: policyDigest };
  const architectureBaseline: ArchitectureBaselinePin = { ref: architectureRef, digest: architectureDigest };
  const governance: VerifiedGovernance = {
    completionPolicy,
    architectureBaseline,
    completionPolicyRecordRevision: policyRecordRevision,
    architectureBaselineRecordRevision: architectureRecordRevision,
    policyActiveRevision,
    architectureActiveRevision,
    guards: [
      { refKey: policyRecordKey, expectedRevision: policyRecordRevision },
      { refKey: architectureRecordKey, expectedRevision: architectureRecordRevision },
      { refKey: policyActiveKey, expectedRevision: policyActiveRevision },
      { refKey: architectureActiveKey, expectedRevision: architectureActiveRevision },
    ],
  };
  return { status: 'resolved', governance, policyContent: content as unknown as CompletionPolicyContentV1,
    readThrough: revisions.batch.readThrough };
}

/** Opportunistic policy read for candidate issues; `null` when unresolved. */
export async function tryPolicyContent(
  records: GoalRecordTransactionPort,
  projectId: string,
): Promise<{ policy: CompletionPolicyContentV1 | null }> {
  const resolution = await resolveGovernance(records, projectId);
  return { policy: resolution.status === 'resolved' ? resolution.policyContent : null };
}

export type PinnedCompletionPolicyRead =
  | { status: 'resolved'; policyContent: CompletionPolicyContentV1; digest: string; guards: readonly RecordGuard[] }
  | Rejected;

/**
 * Narrow SOURCE-PLAN pinned CompletionPolicy reader (W2 §5).
 *
 * Reads ONLY the exact `CompletionPolicyRevision` ref pinned by an accepted
 * source Plan, reuses the existing body parser and `completionPolicyDigest`, and
 * verifies the record's content revision and recomputed digest against that pin.
 * It NEVER consults the Project active pointer, so an unrelated later activation
 * cannot authorize a newly added obligation. Absence or unverifiability is an
 * explicit rejection; it is never a `null` that skips kind/minimum validation.
 * The returned local guard is merged into the caller's existing commit.
 */
export async function readPinnedCompletionPolicy(
  records: GoalRecordTransactionPort,
  pin: CompletionPolicyPin,
): Promise<PinnedCompletionPolicyRead> {
  const key = canonicalJson(pin.ref as unknown as JsonValue);
  const read = await readBatch(records, [key]);
  if (read.status !== 'ready') return read;
  const record = read.batch.present.get(key);
  if (record === undefined) {
    return { status: 'rejected', code: 'not_found',
      reason: `the source-Plan pinned CompletionPolicy ${pin.ref.policyId} is missing` };
  }
  const decoded = validateCompletionPolicyRevision(record);
  if (decoded.status !== 'decoded') {
    return unavailable(`the pinned CompletionPolicy is corrupt: ${decoded.reason}`);
  }
  const body = parseJsonObject(record.json);
  if (body === null) return unavailable('the pinned CompletionPolicy is not a JSON object');
  if (body['policyId'] !== pin.ref.policyId || body['contentRevision'] !== pin.ref.revision) {
    return { status: 'rejected', code: 'source_stale',
      reason: 'the pinned CompletionPolicy content revision disagrees with the source pin' };
  }
  const digest = completionPolicyDigest(body);
  if (digest === null) return incomplete('the pinned CompletionPolicy content is not canonical JSON');
  if (body['contentDigest'] !== digest) {
    return { status: 'rejected', code: 'source_stale',
      reason: 'the stored pinned CompletionPolicy digest does not match the recomputed digest' };
  }
  if (digest !== pin.digest) {
    return { status: 'rejected', code: 'source_stale',
      reason: 'the pinned CompletionPolicy digest disagrees with the source Plan pin' };
  }
  const content = body['content'];
  if (!isRecord(content) || !Array.isArray(content['requirementKinds'])
    || typeof content['minimumRequiredRequirementsPerObligation'] !== 'number') {
    return incomplete('the pinned CompletionPolicy content is malformed');
  }
  const recordRevision = readRevisionNumber(read.batch, key);
  if (recordRevision === null) return incomplete('the pinned CompletionPolicy record revision is not readable');
  return { status: 'resolved', policyContent: content as unknown as CompletionPolicyContentV1,
    digest, guards: [{ refKey: key, expectedRevision: recordRevision }] };
}

// --------------------------------------------------------------------------
// Consistent Goal -> Plan window
// --------------------------------------------------------------------------

export type GoalPlanWindow =
  | { status: 'ready'; goal: GoalSnapshot; plan: PlanRevisionSnapshot | null; readThrough: CommitCursor | null }
  | Rejected;

export async function confirmActivePlan(
  records: GoalRecordTransactionPort,
  goalRef: GoalRef,
  expected: PlanRevisionRef,
): Promise<{ status: 'ready'; goal: GoalSnapshot; readThrough: CommitCursor | null } | Rejected> {
  const goalRead = await readGoal(records, goalRef);
  if (goalRead.status !== 'ready') return goalRead;
  if (derivePlanRevisionStatus(expected, goalRead.goal.activePlanRevision) !== 'adopted') {
    return { status: 'rejected', code: 'revision_conflict', reason: 'the active plan changed while it was being read' };
  }
  return { status: 'ready', goal: goalRead.goal, readThrough: goalRead.readThrough };
}

/** Reads Goal then its active immutable Plan and, when the two reads saw
 * different ledger watermarks, re-reads the Goal pointer before returning. The
 * reported watermark is never newer than the pointer that was verified. */
export async function readGoalPlanWindow(
  records: GoalRecordTransactionPort,
  goalRef: GoalRef,
): Promise<GoalPlanWindow> {
  const goalRead = await readGoal(records, goalRef);
  if (goalRead.status !== 'ready') return goalRead;
  const planRef = goalRead.goal.activePlanRevision;
  if (planRef === null) return { status: 'ready', goal: goalRead.goal, plan: null, readThrough: goalRead.readThrough };
  const planRead = await readPlan(records, planRef);
  if (planRead.status !== 'ready') return planRead;
  if (planRead.plan.goalRef.goalId !== goalRef.goalId) {
    return { status: 'rejected', code: 'not_found', reason: 'the active plan belongs to another goal' };
  }
  if (!sameCursor(goalRead.readThrough, planRead.readThrough)) {
    const confirmed = await confirmActivePlan(records, goalRef, planRead.plan.ref);
    if (confirmed.status !== 'ready') return confirmed;
    return { status: 'ready', goal: confirmed.goal, plan: planRead.plan,
      readThrough: confirmed.readThrough ?? planRead.readThrough };
  }
  return { status: 'ready', goal: goalRead.goal, plan: planRead.plan, readThrough: planRead.readThrough };
}

// --------------------------------------------------------------------------
// Canonical task facts (Run + TaskLease + TaskReduction)
// --------------------------------------------------------------------------

/** One task's effective state from canonical Run, TaskLease and TaskReduction.
 * `null` means absence was confirmed with registered reads at `readThrough`. */
export type CanonicalTaskState = {
  taskId: string;
  effectivePhase: Phase;
  /** The TD-1 reason of `effectivePhase` (`projectTaskPhase`); null where the row has none. */
  phaseCause: TaskPhaseCauseV1 | null;
  /** P4: the TaskRequeue covering the selected Run (D-3, C1); null otherwise. */
  requeueRef: TaskRequeueRef | null;
  currentAttempt: TaskAttemptRef | null;
  execution: RunSnapshot['ref'] | null;
  lease: { status: 'free' } | { status: 'leased'; holderRunId: string };
  reductionRevision: number | null;
};
export type CanonicalTaskFacts = {
  goalRef: GoalRef;
  planRef: PlanRevisionSnapshot['ref'];
  byTaskId: ReadonlyMap<string, CanonicalTaskState>;
  /**
   * R3e.3 completion seam: every actual Run candidate parsed in THIS read,
   * keyed by the selected task. It retains ALL candidates (not only the
   * preferred one) so completion never misses an unreconciled side effect; it
   * is filled from the same records already read, adding no database read and
   * no consumer-visible model input.
   */
  runsByTaskId: ReadonlyMap<string, readonly RunSnapshot[]>;
  /** R3e.3 completion seam: the persisted TaskReduction parsed in THIS read. */
  reductionsByTaskId: ReadonlyMap<string, TaskReductionSnapshot>;
  /** The persisted TaskLease per task (including a released lease), so a
   * continuation claim can guard and update the SAME record revision. */
  leasesByTaskId: ReadonlyMap<string, TaskLeaseSnapshot>;
  /**
   * §4.1 / §9 VD-14: the projection input of each work task whose selected Run
   * ended `completed` (`roundTaskSignal` over that Run's round chain) and of
   * each gate (over the gate's own chain, P20, VD-15), read in THIS window.
   * Absent for every other task (no chain enters its projection).
   */
  roundsByTaskId: ReadonlyMap<string, RoundTaskSignalV1>;
  /** The same chains as `roundsByTaskId`, as their `roundChainHead` (the failure facts read the head). */
  chainsByTaskId: ReadonlyMap<string, RoundChainHeadV1>;
  /**
   * §4.1 / §4.3 (D-3, C1): the TaskRequeue of each ended Run of a selected Task
   * (keyed by its `afterRunId`), read in THIS window, per Task in no order.
   */
  requeuesByTaskId: ReadonlyMap<string, readonly TaskRequeueSnapshotV1[]>;
  /** The latest requeue refusal (TaskReworkRefusal, operation `requeue`) per ended Run id, read in THIS window. */
  requeueRefusalsByRunId: ReadonlyMap<string, TaskReworkRefusalSnapshotV1>;
  /**
   * §4.1 / §9 VR-14 (A.2 step 5.9): the latest reverify refusal (operation
   * `reverify`) per round id, for each chain head of `chainsByTaskId` that is
   * finalized non-PASS, read in THIS window. Not in `reworkGuards`: only the
   * requeue owner guards its head's record at this revision (absent: null),
   * so a concurrent reverify refusal and requeue commit at most once
   * (§13.2 point 5); no claim or completion depends on it.
   */
  reverifyRefusalsByRoundId: ReadonlyMap<string, TaskReworkRefusalSnapshotV1>;
  /**
   * The exact versions of those rework records (TaskRequeue@1, refusal@k) and
   * the absence (`null`) of every key read but missing. Kept apart from
   * `guards`: only the writes that depend on them (claim, completion, requeue)
   * guard them.
   */
  reworkGuards: readonly RecordGuard[];
  /** Undirected read only: `countEndedGoalRuns` over the Goal's raw Run candidates, before any Plan filter (ND-8). */
  goalEndedRuns?: number;
  readThrough: CommitCursor;
  /** Complete exact versions/absences used by adoption or future claim CAS. */
  guards: readonly RecordGuard[];
  /** Directed read only: at least one Run exists for THIS task, even one pinned
   * to an older Plan. A fresh claim must reject rather than read it as pending. */
  taskHasRun?: boolean;
  /**
   * Slice 1 §6 F28 (1/3/5): the archive anomaly anchors of each selected Task's
   * Runs, read in THIS window. Absent means this read did not cover them, so
   * the failure read has no verified archive interruption to use.
   */
  anomalyAnchorsByTaskId?: ReadonlyMap<string, readonly SessionAnomalyAnchorV1[]>;
};
export type CanonicalTaskFactRead =
  | { status: 'ready'; value: CanonicalTaskFacts }
  | Rejected;

function parseRun(json: string): RunSnapshot | null {
  const parsed = parseJsonObject(json);
  if (parsed === null) return null;
  const ref = parsed['ref'];
  const task = parsed['task'];
  const planRef = parsed['planRef'];
  if (!isRecord(ref) || ref['aggregateType'] !== 'Run' || !nonEmpty(ref['projectId']) || !nonEmpty(ref['goalId']) || !nonEmpty(ref['runId'])) return null;
  if (!isRecord(task) || !nonEmpty(task['taskId']) || !nonEmpty(task['projectId']) || !nonEmpty(task['goalId'])) return null;
  if (!isRecord(planRef) || planRef['aggregateType'] !== 'PlanRevision' || !nonEmpty(planRef['planId']) || !nonEmpty(planRef['projectId'])) return null;
  if (parsed['status'] !== 'starting' && parsed['status'] !== 'running' && parsed['status'] !== 'ended') return null;
  if (!nonEmpty(parsed['attemptId'])) return null;
  return parsed as unknown as RunSnapshot;
}
function parseLease(json: string): TaskLeaseSnapshot | null {
  const parsed = parseJsonObject(json);
  if (parsed === null) return null;
  if (parsed['schemaVersion'] !== 1 || !nonEmpty(parsed['holderRunId']) || !nonEmpty(parsed['attemptId'])) return null;
  return parsed as unknown as TaskLeaseSnapshot;
}
function parseReduction(json: string): TaskReductionSnapshot | null {
  const parsed = parseJsonObject(json);
  if (parsed === null) return null;
  if (parsed['schemaVersion'] !== 1 || !nonEmpty(parsed['phase']) || typeof parsed['revision'] !== 'number') return null;
  return parsed as unknown as TaskReductionSnapshot;
}
function runIsActive(run: RunSnapshot): boolean {
  return run.status === 'running' || run.status === 'starting';
}
function preferRun(candidate: RunSnapshot, current: RunSnapshot): boolean {
  if (runIsActive(candidate) !== runIsActive(current)) return runIsActive(candidate);
  // A Task can legitimately have several ended Runs (yielded continuation + the
  // real producing Run). The preferred Run must be the LATEST attempt, not the
  // first record read; the real end/start instant is the honest ordering fact.
  const candidateAt = candidate.endedAt ?? candidate.startedAt ?? '';
  const currentAt = current.endedAt ?? current.startedAt ?? '';
  if (candidateAt !== currentAt) return candidateAt > currentAt;
  return candidate.revision > current.revision;
}
function uniqueKeys(keys: readonly string[]): string[] {
  return [...new Set(keys)];
}
function samePlanRevisionPointer(left: PlanRevisionRef | null, right: PlanRevisionRef | null): boolean {
  if (left === null || right === null) return left === right;
  return planRevisionRefKey(left) === planRevisionRefKey(right);
}
/** The record key of a Task's TaskLease / TaskReduction (also the key of its absence guard). */
export function taskRecordRefKey(aggregateType: 'TaskLease' | 'TaskReduction', goalRef: GoalRef, taskId: string): string {
  return canonicalJson({ aggregateType, projectId: goalRef.projectId, goalId: goalRef.goalId, taskId } as unknown as JsonValue);
}

/**
 * Projects the GLOBAL TaskLease only through a holder Run the selected Plan
 * actually accepts. A holder Run pinned to a later/inapplicable Plan is not
 * this Plan's lease; an unreadable/missing holder Run is conservative
 * occupancy, never `free`.
 */
function projectLease(input: {
  lease: TaskLeaseSnapshot | null;
  taskId: string;
  runById: ReadonlyMap<string, RunSnapshot>;
  index: ReadonlyMap<string, PlanTaskFacts>;
  selected: PlanTaskFacts;
  selectedBasis: PlanRevisionRef;
  selectedDefinition: FrozenTaskDefinition;
  goalRef: GoalRef;
}): { status: 'ok'; value: CanonicalTaskState['lease'] } | { status: 'unavailable'; reason: string } {
  if (input.lease === null) return { status: 'ok', value: { status: 'free' } };
  // A real same-owner terminal release is derived as free. The persistent
  // Lease/Run trace still exists (W1 still treats it as executed), so this is
  // not an ABA back to future.
  if (input.lease.release !== undefined) return { status: 'ok', value: { status: 'free' } };
  const holder = input.runById.get(input.lease.holderRunId);
  if (holder === undefined) {
    return { status: 'ok', value: { status: 'leased', holderRunId: input.lease.holderRunId } };
  }
  if (holder.task.taskId !== input.taskId) {
    return { status: 'unavailable', reason: `TaskLease ${input.taskId} names a holder Run of another task` };
  }
  const entry = input.index.get(planRevisionRefKey(holder.planRef));
  if (entry === undefined) {
    return { status: 'ok', value: { status: 'leased', holderRunId: input.lease.holderRunId } };
  }
  const verdict = taskOriginVerdict({ origin: entry, selected: input.selected, selectedBasis: input.selectedBasis,
    selectedDefinition: input.selectedDefinition, taskId: input.taskId, index: input.index, goalRef: input.goalRef });
  if (verdict.status === 'unavailable') return { status: 'unavailable', reason: verdict.reason };
  if (verdict.status === 'accepted') return { status: 'ok', value: { status: 'leased', holderRunId: input.lease.holderRunId } };
  return { status: 'ok', value: { status: 'free' } };
}

/**
 * The selected Run's work round chain (§4.1 投影输入, §9 VD-14): every round
 * of `VerificationRoundBySubject` for the Run, at most `ROUND_CHAIN_MAX + 1`
 * rows, rechecked against the Run (a candidate index only). A backend without
 * the evidence schemas cannot hold a round (the store refuses an unregistered
 * record), so an unregistered lookup is a confirmed absence with no watermark,
 * as in `readGoalPhase`. A damaged or foreign row, or a chain past the limit,
 * is never guessed into a phase: the whole read refuses.
 */
export async function readRunRoundChain(
  records: RecordLookupPort,
  run: RunSnapshot,
): Promise<{ status: 'ready'; rounds: RoundSnapshot[]; readThrough: CommitCursor | null | undefined } | Rejected> {
  const result = await records.lookup({ index: VERIFICATION_ROUND_ORIGINAL_LOOKUP,
    values: [run.ref.projectId, run.workspaceSnapshot.workspaceId, run.ref.goalId, run.task.taskId, run.ref.runId],
    limit: VERIFICATION_ROUND_CHAIN_LOOKUP_LIMIT });
  if (result.status !== 'ready') {
    if (result.code === 'unsupported') return { status: 'ready', rounds: [], readThrough: undefined };
    return unavailable(`the round chain of Run ${run.ref.runId} is not readable: ${result.code}: ${result.reason}`);
  }
  if (result.value.next !== null) {
    return incomplete(`the round chain of Run ${run.ref.runId} is longer than the chain limit`);
  }
  const runKey = canonicalJson(run.ref as unknown as JsonValue);
  const rounds: RoundSnapshot[] = [];
  for (const record of result.value.records) {
    const decoded = decodeVerificationRoundSnapshot(record);
    if (decoded.status !== 'decoded') return unavailable(`round ${record.refKey} is damaged: ${decoded.reason}`);
    const round = decoded.value;
    if (canonicalJson(round.subjectRunRef as unknown as JsonValue) !== runKey || round.subject.taskId !== run.task.taskId) {
      return unavailable(`round ${round.ref.roundId} does not belong to Run ${run.ref.runId}`);
    }
    rounds.push(round);
  }
  return { status: 'ready', rounds, readThrough: result.value.readThrough };
}

/**
 * A gate's own round chain (§4.1 P20, §9 VD-15): every round of
 * `VerificationRoundByTask` for the gate in the Goal's workspace, at most
 * `ROUND_CHAIN_MAX + 1` rows, rechecked against the gate (a candidate index
 * only; every producer Run, since the chain is anchored on the first one).
 * The same refusals as `readRunRoundChain`: an unregistered lookup is a
 * confirmed absence, a damaged or foreign row or a chain past the limit
 * refuses the whole read.
 */
export async function readGateRoundChain(
  records: RecordLookupPort,
  workspaceId: string,
  gate: TaskTriple,
): Promise<{ status: 'ready'; rounds: RoundSnapshot[]; readThrough: CommitCursor | null | undefined } | Rejected> {
  const result = await records.lookup({ index: VERIFICATION_ROUND_BY_TASK_LOOKUP,
    values: [gate.projectId, workspaceId, gate.goalId, gate.taskId], limit: VERIFICATION_ROUND_CHAIN_LOOKUP_LIMIT });
  if (result.status !== 'ready') {
    if (result.code === 'unsupported') return { status: 'ready', rounds: [], readThrough: undefined };
    return unavailable(`the round chain of gate ${gate.taskId} is not readable: ${result.code}: ${result.reason}`);
  }
  if (result.value.next !== null) {
    return incomplete(`the round chain of gate ${gate.taskId} is longer than the chain limit`);
  }
  const rounds: RoundSnapshot[] = [];
  for (const record of result.value.records) {
    const decoded = decodeVerificationRoundSnapshot(record);
    if (decoded.status !== 'decoded') return unavailable(`round ${record.refKey} is damaged: ${decoded.reason}`);
    const round = decoded.value;
    if (round.subject.projectId !== gate.projectId || round.subject.goalId !== gate.goalId || round.subject.taskId !== gate.taskId
      || round.ref.workspaceId !== workspaceId) {
      return unavailable(`round ${round.ref.roundId} does not belong to gate ${gate.taskId}`);
    }
    rounds.push(round);
  }
  return { status: 'ready', rounds, readThrough: result.value.readThrough };
}

/**
 * ND-7/ND-8 `countEndedGoalRuns` input: every Run candidate of the Goal
 * (`r3c-run-by-goal`), never filtered by Plan or Task and never guarded, so
 * the refusal writer and the read model count the same set. Read before the
 * source capture.
 */
export async function readGoalRunsForCount(
  records: GoalRecordTransactionPort & RecordLookupPort, goalRef: GoalRef,
): Promise<{ status: 'ready'; runs: RunSnapshot[] } | Rejected> {
  const found = await readLookupKeys(records, RUN_BY_GOAL_INDEX, [goalRef.projectId, goalRef.goalId]);
  if (found.status !== 'ready') return found;
  if (found.refKeys.length === 0) return { status: 'ready', runs: [] };
  const read = await records.readMany(uniqueKeys(found.refKeys));
  if (read.status !== 'ready') return unavailable(`the Goal Runs are not readable: ${read.code}: ${read.reason}`);
  const runs: RunSnapshot[] = [];
  for (const record of read.value.records) {
    const run = parseRun(record.json);
    if (run === null) return unavailable(`Run record ${record.refKey} is not decodable`);
    if (run.ref.projectId === goalRef.projectId && run.ref.goalId === goalRef.goalId) runs.push(run);
  }
  return { status: 'ready', runs };
}

/**
 * The pointer ControlIntent of each given Run (§4.1 失败事实读模型: its
 * request fields are immutable, so it is read after the fact window, as the
 * Goal display reads it). A Run without a pointer has none. A backend without
 * the control schemas cannot hold a pointer intent, so `unsupported` reads as
 * none; a missing or damaged intent is never guessed.
 */
export async function readPointerIntents(
  records: GoalRecordTransactionPort, runs: readonly RunSnapshot[],
): Promise<{ status: 'ready'; intents: ReadonlyMap<string, ControlIntentSnapshotV1> } | Rejected> {
  const keyed: { runId: string; key: string }[] = [];
  for (const run of runs) {
    const ref = run.controlState?.intentRef;
    if (ref !== undefined) keyed.push({ runId: run.ref.runId, key: canonicalJson(ref as unknown as JsonValue) });
  }
  const intents = new Map<string, ControlIntentSnapshotV1>();
  if (keyed.length === 0) return { status: 'ready', intents };
  const read = await records.readMany(uniqueKeys(keyed.map((entry) => entry.key)));
  if (read.status !== 'ready') {
    if (read.code === 'unsupported') return { status: 'ready', intents };
    return unavailable(`the pointer intents are not readable: ${read.code}: ${read.reason}`);
  }
  const present = new Map(read.value.records.map((record) => [record.refKey, record]));
  for (const { runId, key } of keyed) {
    const record = present.get(key);
    if (record === undefined) return unavailable(`the pointer intent ${key} of Run ${runId} is missing`);
    const decoded = decodeControlIntentSnapshot(record);
    if (decoded.status !== 'decoded') return unavailable(`the pointer intent ${key} is damaged: ${decoded.reason}`);
    intents.set(runId, decoded.value);
  }
  return { status: 'ready', intents };
}

type ReworkRecordsRead = {
  status: 'ready';
  requeues: TaskRequeueSnapshotV1[];
  refusals: TaskReworkRefusalSnapshotV1[];
  guards: RecordGuard[];
  readThrough: CommitCursor | null | undefined;
};

/**
 * The rework records of the given ended Runs (§4.1 投影输入, §4.3 step 3, §11
 * I-12): per Run its TaskRequeue (`afterRunId` = the Run) and its requeue
 * refusal (`operation:'requeue'`, `subjectId` = the Run), in one `readMany`.
 * Every key read is guarded: a present record at its revision, a missing one
 * at `null`. A backend without the claim schemas cannot hold either record
 * (the store refuses an unregistered record), so `unsupported` is a confirmed
 * absence with no watermark and no guard, as in `readRunRoundChain`. A damaged
 * or foreign record is never guessed: the whole read refuses.
 */
async function readReworkRecords(records: GoalRecordTransactionPort, runs: readonly RunSnapshot[]): Promise<ReworkRecordsRead | Rejected> {
  const none: ReworkRecordsRead = { status: 'ready', requeues: [], refusals: [], guards: [], readThrough: undefined };
  if (runs.length === 0) return none;
  const keyed = runs.map((run) => {
    const requeueRef: TaskRequeueRef = { aggregateType: 'TaskRequeue', projectId: run.ref.projectId, goalId: run.ref.goalId,
      taskId: run.task.taskId, afterRunId: run.ref.runId };
    const refusalRef: TaskReworkRefusalRef = { aggregateType: 'TaskReworkRefusal', projectId: run.ref.projectId,
      goalId: run.ref.goalId, taskId: run.task.taskId, operation: 'requeue', subjectId: run.ref.runId };
    return { run, requeueKey: taskRequeueRefKey(requeueRef), refusalKey: taskReworkRefusalRefKey(refusalRef) };
  });
  const read = await records.readMany(uniqueKeys(keyed.flatMap((entry) => [entry.requeueKey, entry.refusalKey])));
  if (read.status !== 'ready') {
    if (read.code === 'unsupported') return none;
    return unavailable(`the rework records are not readable: ${read.code}: ${read.reason}`);
  }
  const present = new Map(read.value.records.map((record) => [record.refKey, record]));
  const result: ReworkRecordsRead = { ...none, requeues: [], refusals: [], guards: [], readThrough: read.value.readThrough };
  for (const { run, requeueKey, refusalKey } of keyed) {
    const requeueRecord = present.get(requeueKey);
    result.guards.push({ refKey: requeueKey, expectedRevision: requeueRecord === undefined ? null : requeueRecord.revision });
    if (requeueRecord !== undefined) {
      const decoded = decodeTaskRequeueSnapshot(requeueRecord);
      if (decoded.status !== 'decoded') return unavailable(`TaskRequeue ${requeueKey} is damaged: ${decoded.reason}`);
      if (decoded.value.afterRunRef.runId !== run.ref.runId || decoded.value.task.taskId !== run.task.taskId) {
        return unavailable(`TaskRequeue ${requeueKey} does not cover Run ${run.ref.runId}`);
      }
      result.requeues.push(decoded.value);
    }
    const refusalRecord = present.get(refusalKey);
    result.guards.push({ refKey: refusalKey, expectedRevision: refusalRecord === undefined ? null : refusalRecord.revision });
    if (refusalRecord !== undefined) {
      const decoded = decodeTaskReworkRefusalSnapshot(refusalRecord);
      if (decoded.status !== 'decoded') return unavailable(`TaskReworkRefusal ${refusalKey} is damaged: ${decoded.reason}`);
      if (decoded.value.afterRunRef.runId !== run.ref.runId) {
        return unavailable(`TaskReworkRefusal ${refusalKey} does not refuse Run ${run.ref.runId}`);
      }
      result.refusals.push(decoded.value);
    }
  }
  return result;
}

/**
 * The reverify refusal (`TaskReworkRefusal`, operation `reverify`,
 * `subjectId` = the round id) of each given chain head (§4.1 失败事实读模型,
 * §9 VR-14), in one `readMany`, keyed by round id. A backend without the
 * claim schemas cannot hold one, so `unsupported` is a confirmed absence with
 * no watermark. A damaged or foreign record is never guessed.
 */
async function readReverifyRefusals(records: GoalRecordTransactionPort, heads: readonly RoundSnapshot[]): Promise<{
  status: 'ready'; refusals: ReadonlyMap<string, TaskReworkRefusalSnapshotV1>; readThrough: CommitCursor | null | undefined;
} | Rejected> {
  const refusals = new Map<string, TaskReworkRefusalSnapshotV1>();
  if (heads.length === 0) return { status: 'ready', refusals, readThrough: undefined };
  const keyed = heads.map((head) => {
    const ref: TaskReworkRefusalRef = { aggregateType: 'TaskReworkRefusal', projectId: head.subject.projectId,
      goalId: head.subject.goalId, taskId: head.subject.taskId, operation: 'reverify', subjectId: head.ref.roundId };
    return { head, key: taskReworkRefusalRefKey(ref) };
  });
  const read = await records.readMany(uniqueKeys(keyed.map((entry) => entry.key)));
  if (read.status !== 'ready') {
    if (read.code === 'unsupported') return { status: 'ready', refusals, readThrough: undefined };
    return unavailable(`the reverify refusals are not readable: ${read.code}: ${read.reason}`);
  }
  const present = new Map(read.value.records.map((record) => [record.refKey, record]));
  for (const { head, key } of keyed) {
    const record = present.get(key);
    if (record === undefined) continue;
    const decoded = decodeTaskReworkRefusalSnapshot(record);
    if (decoded.status !== 'decoded') return unavailable(`TaskReworkRefusal ${key} is damaged: ${decoded.reason}`);
    if (decoded.value.subjectRoundRef?.roundId !== head.ref.roundId) {
      return unavailable(`TaskReworkRefusal ${key} does not refuse round ${head.ref.roundId}`);
    }
    refusals.set(head.ref.roundId, decoded.value);
  }
  return { status: 'ready', refusals, readThrough: read.value.readThrough };
}

/** Bounded to one Goal's accepted Plan; candidate indexes locate Run records,
 * then this reader rechecks their full refs, Plan pins and latest revisions.
 * The candidate set and the canonical read must share one ledger watermark or
 * the whole window is retried: a Run committed after the last lookup page is
 * never silently missing while the result carries a newer watermark.
 *
 * It batch-reads, deduplicated, BOTH the actual Run/Reduction origin Plans and
 * the selected Plan's declared basis sources. Every declared basis source must
 * be present, same-Goal, no later than its referrer, define the Task, agree on
 * its frozen definition and itself be absolute — even when a Run's origin is
 * the selected Plan or no Run exists at all. A Run/Reduction origin that is
 * genuinely absent stays a conservative trace (never `free`); a missing/corrupt
 * DECLARED basis source is `unavailable`, never a pending/ready default.
 *
 * `taskId` narrows the SAME read+fold to one Task (its own Runs) and adds
 * `taskHasRun`, accumulated BEFORE the basis/plan filter so a Run on an older
 * Plan still blocks a first claim. */
export async function readCanonicalTaskFacts(
  records: GoalRecordTransactionPort & RecordLookupPort,
  goalRef: GoalRef,
  plan: PlanRevisionSnapshot,
  taskId?: string,
): Promise<CanonicalTaskFactRead> {
  if (plan.ref.projectId !== goalRef.projectId || plan.goalRef.goalId !== goalRef.goalId) {
    return { status: 'rejected', code: 'invalid', reason: 'the plan does not belong to the requested goal' };
  }
  const directed = taskId !== undefined;
  const selectedTasks = directed ? plan.tasks.filter((task) => task.taskId === taskId) : plan.tasks;
  const selectedTaskIds = new Set(selectedTasks.map((task) => task.taskId));
  const selectedFacts = planTaskFacts(plan);
  const requiredBasisSources = new Map<string, PlanRevisionRef>();
  for (const task of selectedTasks) {
    const basis = selectedFacts.basis.get(task.taskId);
    if (basis === undefined || isBasisUnsupported(basis)) continue; // reported as unavailable in the task fold
    if (planRevisionRefKey(basis) !== planRevisionRefKey(plan.ref)) {
      requiredBasisSources.set(planRevisionRefKey(basis), basis);
    }
  }
  const leaseKeys = selectedTasks.map((task) => taskRecordRefKey('TaskLease', goalRef, task.taskId));
  const reductionKeys = selectedTasks.map((task) => taskRecordRefKey('TaskReduction', goalRef, task.taskId));
  // P20 (C5): a gate's chain is read by its workspace. A Goal's workspace is
  // fixed at its creation (`GoalSnapshot.workspaceRef`), so it is read once,
  // outside the window, and only when a gate is selected.
  let gateWorkspaceId: string | null = null;
  if (selectedTasks.some((task) => task.taskKind === 'gate')) {
    const goalRead = await readGoal(records, goalRef);
    if (goalRead.status !== 'ready') return goalRead;
    gateWorkspaceId = goalRead.goal.workspaceRef.workspaceId;
  }
  for (let attempt = 0; attempt < WINDOW_MAX_ATTEMPTS; attempt += 1) {
    const found = taskId !== undefined
      ? await readLookupKeys(records, RUN_BY_TASK_INDEX, [goalRef.projectId, goalRef.goalId, taskId])
      : await readLookupKeys(records, RUN_BY_GOAL_INDEX, [goalRef.projectId, goalRef.goalId]);
    if (found.status !== 'ready') return found;
    const keys = uniqueKeys([...found.refKeys, ...leaseKeys, ...reductionKeys]);
    const read = await records.readMany(keys);
    if (read.status !== 'ready') {
      if (read.code === 'unsupported') return incomplete(`task-state record schemas are not registered: ${read.reason}`);
      if (read.code === 'invalid') return incomplete(`the task-state read is invalid: ${read.reason}`);
      return unavailable(`${read.code}: ${read.reason}`);
    }
    if (!found.stable || !sameCursor(found.readThrough, read.value.readThrough)) continue;
    const present = new Map<string, EncodedRecord>();
    for (const record of read.value.records) present.set(record.refKey, record);
    const guards: RecordGuard[] = [];
    const runByTask = new Map<string, RunSnapshot[]>();
    const runById = new Map<string, RunSnapshot>();
    const factOriginRefs = new Map<string, PlanRevisionRef>();
    const goalRuns: RunSnapshot[] = [];
    let taskHasRun = false;
    for (const key of found.refKeys) {
      const record = present.get(key);
      if (record === undefined) return unavailable(`Run candidate ${key} has no canonical record`);
      guards.push({ refKey: key, expectedRevision: record.revision });
      const run = parseRun(record.json);
      if (run === null) return unavailable(`Run record ${key} is not decodable`);
      if (run.ref.projectId !== goalRef.projectId || run.ref.goalId !== goalRef.goalId) continue;
      if (run.task.projectId !== goalRef.projectId || run.task.goalId !== goalRef.goalId) continue;
      goalRuns.push(run);
      if (!selectedTaskIds.has(run.task.taskId)) continue;
      taskHasRun = true;
      runById.set(run.ref.runId, run);
      const list = runByTask.get(run.task.taskId);
      if (list === undefined) runByTask.set(run.task.taskId, [run]);
      else list.push(run);
      factOriginRefs.set(planRevisionRefKey(run.planRef), run.planRef);
    }
    const leaseByTask = new Map<string, TaskLeaseSnapshot>();
    const reductionByTask = new Map<string, TaskReductionSnapshot>();
    for (const task of selectedTasks) {
      const leaseKey = taskRecordRefKey('TaskLease', goalRef, task.taskId);
      const reductionKey = taskRecordRefKey('TaskReduction', goalRef, task.taskId);
      const leaseRecord = present.get(leaseKey);
      const reductionRecord = present.get(reductionKey);
      guards.push({ refKey: leaseKey, expectedRevision: leaseRecord === undefined ? null : leaseRecord.revision });
      guards.push({ refKey: reductionKey, expectedRevision: reductionRecord === undefined ? null : reductionRecord.revision });
      if (leaseRecord !== undefined) {
        const lease = parseLease(leaseRecord.json);
        if (lease === null) return unavailable(`TaskLease ${leaseKey} is not decodable`);
        leaseByTask.set(task.taskId, lease);
      }
      if (reductionRecord !== undefined) {
        const reduction = parseReduction(reductionRecord.json);
        if (reduction === null) return unavailable(`TaskReduction ${reductionKey} is not decodable`);
        reductionByTask.set(task.taskId, reduction);
        factOriginRefs.set(planRevisionRefKey(reduction.planRef), reduction.planRef);
      }
    }
    // One deduplicated batch read for the actual facts' origin Plans AND the
    // selected Plan's declared basis sources. The selected Plan is already held.
    const selectedKey = planRevisionRefKey(plan.ref);
    const combinedRefs = new Map(factOriginRefs);
    for (const [key, ref] of requiredBasisSources) combinedRefs.set(key, ref);
    combinedRefs.delete(selectedKey);
    const index = new Map<string, PlanTaskFacts>([[selectedKey, selectedFacts]]);
    if (combinedRefs.size > 0) {
      const origins = await readOriginPlans(records, [...combinedRefs.values()]);
      if (origins.status !== 'ready') return origins;
      if (!sameCursor(read.value.readThrough, origins.value.readThrough)) continue;
      for (const [key, originPlan] of origins.value.plansByRefKey) index.set(key, planTaskFacts(originPlan));
    }
    // A declared basis source is a hard dependency of the selected definition.
    for (const [key, ref] of requiredBasisSources) {
      if (!index.has(key)) {
        return unavailable(`the basis source plan ${ref.planId} required by the selected plan is missing`);
      }
    }
    // The TaskRequeue and requeue refusal of every ended Run of a selected Task
    // (P4, §4.3 step 3), read in the same window as the Runs.
    const rework = await readReworkRecords(records, [...runByTask.values()].flat().filter((run) => run.status === 'ended'));
    if (rework.status !== 'ready') return rework;
    if (rework.readThrough !== undefined && !sameCursor(read.value.readThrough, rework.readThrough)) continue;
    const requeueByRunId = new Map(rework.requeues.map((requeue) => [requeue.ref.afterRunId, requeue]));
    const requeuesByTaskId = new Map<string, TaskRequeueSnapshotV1[]>();
    for (const requeue of rework.requeues) {
      const list = requeuesByTaskId.get(requeue.task.taskId);
      if (list === undefined) requeuesByTaskId.set(requeue.task.taskId, [requeue]);
      else list.push(requeue);
    }
    const requeueRefusalsByRunId = new Map(rework.refusals.map((refusal) => [refusal.ref.subjectId, refusal]));
    const byTaskId = new Map<string, CanonicalTaskState>();
    const roundsByTaskId = new Map<string, RoundTaskSignalV1>();
    const chainsByTaskId = new Map<string, RoundChainHeadV1>();
    let windowMoved = false;
    for (const task of selectedTasks) {
      const selectedDefinition = selectedFacts.definitions.get(task.taskId);
      if (selectedDefinition === undefined) {
        return unavailable(`the selected plan task ${task.taskId} definition is not readable`);
      }
      const selectedBasis = selectedFacts.basis.get(task.taskId);
      if (selectedBasis === undefined || isBasisUnsupported(selectedBasis)) {
        return unavailable(isBasisUnsupported(selectedBasis) ? selectedBasis.reason
          : `the selected plan has no effective basis for task ${task.taskId}`);
      }
      const selectedChain = verifyBasisDelegation({ referrer: selectedFacts, taskId: task.taskId,
        index, goalRef });
      if (selectedChain.status === 'unavailable') return unavailable(selectedChain.reason);
      let run: RunSnapshot | null = null;
      let unresolvable = false;
      // The TaskLease holder is the LAST claimed Attempt; preferring it keeps the
      // right Run when several ended Runs exist (yield continuations + producer),
      // independent of clock granularity.
      const leaseHolderRunId = leaseByTask.get(task.taskId)?.holderRunId;
      for (const candidate of runByTask.get(task.taskId) ?? []) {
        const entry = index.get(planRevisionRefKey(candidate.planRef));
        if (entry === undefined) { unresolvable = true; continue; }
        const verdict = taskOriginVerdict({ origin: entry, selected: selectedFacts, selectedBasis,
          selectedDefinition, taskId: task.taskId, index, goalRef });
        if (verdict.status === 'unavailable') return unavailable(verdict.reason);
        if (verdict.status === 'excluded') continue;
        // The holder wins whatever order the records are read in; preferRun only orders non-holders.
        const candidateHolds = candidate.ref.runId === leaseHolderRunId;
        const currentHolds = run !== null && run.ref.runId === leaseHolderRunId;
        if (run === null || (candidateHolds && !currentHolds)
          || (candidateHolds === currentHolds && preferRun(candidate, run))) run = candidate;
      }
      const reduction = reductionByTask.get(task.taskId) ?? null;
      let reductionApplicable = false;
      if (reduction !== null) {
        const entry = index.get(planRevisionRefKey(reduction.planRef));
        if (entry === undefined) {
          if (run === null) unresolvable = true;
        } else {
          const verdict = taskOriginVerdict({ origin: entry, selected: selectedFacts, selectedBasis,
            selectedDefinition, taskId: task.taskId, index, goalRef });
          if (verdict.status === 'unavailable') return unavailable(verdict.reason);
          if (verdict.status === 'accepted' && reduction.taskKind === task.taskKind
            && reduction.planRevision === entry.plan.planRevision) {
            reductionApplicable = true;
          }
        }
      }
      const lease = projectLease({ lease: leaseByTask.get(task.taskId) ?? null, taskId: task.taskId,
        runById, index, selected: selectedFacts, selectedBasis, selectedDefinition, goalRef });
      if (lease.status === 'unavailable') return unavailable(lease.reason);
      // A completed selected Run projects from its round chain head (§4.1
      // P7..P13, §9 VD-14), and a gate from its own chain head (P20, VD-15),
      // read in the same window as the Run.
      let round: RoundTaskSignalV1 = { kind: 'none' };
      let chain: Awaited<ReturnType<typeof readRunRoundChain>> | null = null;
      if (task.taskKind === 'gate') {
        if (gateWorkspaceId !== null) {
          chain = await readGateRoundChain(records, gateWorkspaceId,
            { projectId: goalRef.projectId, goalId: goalRef.goalId, taskId: task.taskId });
        }
      } else if (run !== null && run.status === 'ended' && run.outcome === 'completed') {
        chain = await readRunRoundChain(records, run);
      }
      if (chain !== null) {
        if (chain.status !== 'ready') return chain;
        if (chain.readThrough !== undefined && !sameCursor(read.value.readThrough, chain.readThrough)) {
          windowMoved = true;
          break;
        }
        round = roundTaskSignal(chain.rounds);
        roundsByTaskId.set(task.taskId, round);
        chainsByTaskId.set(task.taskId, roundChainHead(chain.rounds));
      }
      // §4.1 projection (D-1, TD-1, §14.1) with the TaskRequeue covering the selected Run (P4).
      const covering = run === null ? null : requeueByRunId.get(run.ref.runId) ?? null;
      const projected = projectTaskPhase({
        taskKind: task.taskKind,
        applicableReduction: reductionApplicable ? reduction : null,
        selectedRun: run,
        originUnresolvable: unresolvable,
        round,
        coveringRequeue: covering === null ? null : covering.ref,
      });
      byTaskId.set(task.taskId, {
        taskId: task.taskId,
        effectivePhase: projected.phase,
        phaseCause: projected.cause,
        requeueRef: covering === null ? null : covering.ref,
        currentAttempt: run === null ? null : { aggregateType: 'TaskAttempt', projectId: goalRef.projectId,
          goalId: goalRef.goalId, taskId: task.taskId, attemptId: run.attemptId },
        execution: run === null ? null : run.ref,
        lease: lease.value,
        reductionRevision: reductionApplicable && reduction !== null ? reduction.revision : null,
      });
    }
    // A round committed after the canonical read moves the watermark: the
    // whole window is read again rather than mixing two ledger positions.
    if (windowMoved) continue;
    // The reverify refusal of every finalized non-PASS chain head, in the same window.
    const reverify = await readReverifyRefusals(records, [...chainsByTaskId.values()].flatMap((chain) =>
      chain.kind === 'head' && isFinalizedNonPass(chain.head) ? [chain.head] : []));
    if (reverify.status !== 'ready') return reverify;
    if (reverify.readThrough !== undefined && !sameCursor(read.value.readThrough, reverify.readThrough)) continue;
    const watermark = read.value.readThrough;
    if (watermark === null) return incomplete('the ledger has no readable watermark for task state');
    const runsByTaskId = new Map<string, readonly RunSnapshot[]>();
    for (const [candidateTaskId, runs] of runByTask) runsByTaskId.set(candidateTaskId, runs);
    return { status: 'ready', value: { goalRef, planRef: plan.ref, byTaskId, runsByTaskId,
      reductionsByTaskId: reductionByTask, leasesByTaskId: leaseByTask, roundsByTaskId, chainsByTaskId,
      requeuesByTaskId, requeueRefusalsByRunId, reverifyRefusalsByRoundId: reverify.refusals,
      reworkGuards: rework.guards, readThrough: watermark, guards,
      ...(directed ? { taskHasRun } : { goalEndedRuns: countEndedGoalRuns(goalRuns) }) } };
  }
  return { status: 'rejected', code: 'revision_conflict',
    reason: 'the canonical task window changed while it was being read' };
}
/**
 * R3e.3 directed GoalPhase read (§9.3). It decodes through the SINGLE
 * `completion-record-codecs.ts` GoalPhase decoder (the one allowed
 * `plan-readers -> completion-record-codecs` runtime edge). Only a registered
 * read that CONFIRMS absence returns `snapshot: null`; a decode failure is
 * `unavailable`, never an inferred completion.
 */
export async function readGoalPhase(
  records: GoalRecordTransactionPort,
  ref: GoalPhaseRef,
): Promise<
  | { status: 'ready'; snapshot: GoalPhaseSnapshot | null; readThrough: CommitCursor | null; guard: RecordGuard }
  | CoreRejection
> {
  if (ref.aggregateType !== 'GoalPhase' || !nonEmpty(ref.projectId) || !nonEmpty(ref.goalId)) {
    return { status: 'rejected', code: 'invalid', reason: 'readGoalPhase requires a complete GoalPhaseRef' };
  }
  const key = canonicalJson(ref as unknown as JsonValue);
  const read = await readBatch(records, [key]);
  if (read.status !== 'ready') {
    // A platform with no registered GoalPhase codec cannot have written a
    // formal GoalPhase: that is a confirmed absence for this lightweight query
    // projection and must never break an ordinary task-graph read. Every other
    // rejection (damage, unavailability) is preserved.
    if (read.code === 'incomplete') {
      return { status: 'ready', snapshot: null, readThrough: null, guard: { refKey: key, expectedRevision: null } };
    }
    return read;
  }
  const record = read.batch.present.get(key);
  if (record === undefined) {
    if (!read.batch.missing.has(key)) {
      return unavailable('the GoalPhase key was neither returned nor reported missing');
    }
    return { status: 'ready', snapshot: null, readThrough: read.batch.readThrough,
      guard: { refKey: key, expectedRevision: null } };
  }
  const decoded = decodeGoalPhaseSnapshot(record);
  if (decoded.status !== 'decoded') return unavailable(`GoalPhase ${ref.goalId} is corrupt: ${decoded.reason}`);
  return { status: 'ready', snapshot: decoded.value, readThrough: read.batch.readThrough,
    guard: { refKey: key, expectedRevision: record.revision } };
}

// --------------------------------------------------------------------------
// W1 future-change and origin-Plan reads
// --------------------------------------------------------------------------

/**
 * Directed facts for the tasks a future-change candidate touches (W16 guard 7):
 * per Task, this Goal's Runs of it, its TaskLease and its TaskReduction, one
 * entry per Task in `taskIds` order. The untraced rule judges them
 * (`futureChangeTraceProblem`, `state/plan-machine.ts`) in this read's order:
 * every Run before any Lease or Reduction, then per Task its Lease before its
 * Reduction. The rule refuses on the first trace, so the read stops there, as
 * it always did: the facts after it are not decoded and read as absent (the
 * adoption is refused, they are never used). It does NOT assemble a full
 * CanonicalTaskState map and never requires whole ledger readThrough equality:
 * the directed RUN_BY_TASK index plus exact Lease/Reduction reads close the
 * race at the LAST commit with the Lease ∅ / Reduction ∅ guards the plan
 * machine names for the adoption.
 */
export type FutureChangeTaskFacts = {
  goalRef: GoalRef;
  tasks: readonly FutureChangeTaskFactsV1[];
};

export async function readFutureChangeTaskFacts(
  records: GoalRecordTransactionPort & RecordLookupPort,
  goalRef: GoalRef,
  plan: PlanRevisionSnapshot,
  taskIds: readonly string[],
): Promise<{ status: 'ready'; value: FutureChangeTaskFacts } | Rejected> {
  if (plan.ref.projectId !== goalRef.projectId || plan.goalRef.goalId !== goalRef.goalId) {
    return { status: 'rejected', code: 'invalid', reason: 'the source plan does not belong to the requested goal' };
  }
  const uniqueTaskIds = [...new Set(taskIds)];
  const facts = new Map(uniqueTaskIds.map((taskId) => [taskId,
    { taskId, runs: [] as RunSnapshot[], lease: null as TaskLeaseSnapshot | null, reduction: null as TaskReductionSnapshot | null }]));
  const ready = (): { status: 'ready'; value: FutureChangeTaskFacts } =>
    ({ status: 'ready', value: { goalRef, tasks: uniqueTaskIds.map((taskId) => facts.get(taskId)!) } });
  let watermark: CommitCursor | null = null;
  const runKeys: string[] = [];
  for (const taskId of uniqueTaskIds) {
    const found = await readLookupKeys(records, RUN_BY_TASK_INDEX, [goalRef.projectId, goalRef.goalId, taskId]);
    if (found.status !== 'ready') return found;
    watermark = laterCursor(watermark, found.readThrough);
    for (const refKey of found.refKeys) runKeys.push(refKey);
  }
  const leaseKeys = uniqueTaskIds.map((taskId) => taskRecordRefKey('TaskLease', goalRef, taskId));
  const reductionKeys = uniqueTaskIds.map((taskId) => taskRecordRefKey('TaskReduction', goalRef, taskId));
  const read = await records.readMany(uniqueKeys([...runKeys, ...leaseKeys, ...reductionKeys]));
  if (read.status !== 'ready') {
    if (read.code === 'unsupported') return incomplete(`task-state record schemas are not registered: ${read.reason}`);
    if (read.code === 'invalid') return incomplete(`the task-state read is invalid: ${read.reason}`);
    return unavailable(`${read.code}: ${read.reason}`);
  }
  watermark = laterCursor(watermark, read.value.readThrough);
  const present = new Map<string, EncodedRecord>();
  for (const record of read.value.records) present.set(record.refKey, record);
  for (const key of uniqueKeys(runKeys)) {
    const record = present.get(key);
    if (record === undefined) return unavailable(`Run candidate ${key} has no canonical record`);
    const run = parseRun(record.json);
    if (run === null) return unavailable(`Run record ${key} is not decodable`);
    if (run.ref.projectId !== goalRef.projectId || run.ref.goalId !== goalRef.goalId) continue;
    const entry = facts.get(run.task.taskId);
    if (entry === undefined) continue;
    // The first trace: the untraced rule refuses on it.
    entry.runs.push(run);
    return ready();
  }
  for (const taskId of uniqueTaskIds) {
    const entry = facts.get(taskId)!;
    const leaseKey = taskRecordRefKey('TaskLease', goalRef, taskId);
    const reductionKey = taskRecordRefKey('TaskReduction', goalRef, taskId);
    const leaseRecord = present.get(leaseKey);
    if (leaseRecord !== undefined) {
      const lease = parseLease(leaseRecord.json);
      if (lease === null) return unavailable(`TaskLease ${leaseKey} is not decodable`);
      entry.lease = lease;
      return ready();
    }
    const reductionRecord = present.get(reductionKey);
    if (reductionRecord !== undefined) {
      const reduction = parseReduction(reductionRecord.json);
      if (reduction === null) return unavailable(`TaskReduction ${reductionKey} is not decodable`);
      entry.reduction = reduction;
      return ready();
    }
  }
  if (watermark === null) return incomplete('the ledger has no readable watermark for future-change facts');
  return ready();
}

/**
 * One Task's facts for a C7 disposition-only change (TASK-19) or a guard 9
 * carrier check (lead decision LA-3), §3.3: the directed `readCanonicalTaskFacts`
 * on the source Plan (the claim's reader) gives every Run of the Task (every
 * Plan), the selected Run, the Lease and the Reduction; `readPointerIntents`
 * the ControlIntent the selected Run's pointer names (null without one).
 * `phase` is the Task's projection input (the Task machine's state for
 * TASK-18/19). `guards` are what the adoption commit pins: every Run@rev, the
 * Lease (@k or ∅), the Reduction (@rev or ∅) and the pointer ControlIntent@rev.
 * TaskRequeues, rounds and slots are not pinned (§3.3 point 2: a requeue or a
 * successor round racing the adoption commits either way).
 */
export type DispositionChangeTaskFacts = {
  facts: TracedTaskFactsV1;
  phase: TaskPhaseFacts;
  guards: readonly RecordGuard[];
};

export async function readDispositionChangeTaskFacts(
  records: GoalRecordTransactionPort & RecordLookupPort,
  goalRef: GoalRef,
  plan: PlanRevisionSnapshot,
  taskIds: readonly string[],
): Promise<{ status: 'ready'; tasks: DispositionChangeTaskFacts[] } | Rejected> {
  const tasks: DispositionChangeTaskFacts[] = [];
  for (const taskId of [...new Set(taskIds)]) {
    const task = plan.tasks.find((candidate) => candidate.taskId === taskId);
    if (task === undefined) return { status: 'rejected', code: 'invalid', reason: `task ${taskId} is not a task of the source plan` };
    const read = await readCanonicalTaskFacts(records, goalRef, plan, taskId);
    if (read.status !== 'ready') return read;
    const facts = read.value;
    const state = facts.byTaskId.get(taskId);
    if (state === undefined) return unavailable(`the directed task state of ${taskId} was not read`);
    const runs = facts.runsByTaskId.get(taskId) ?? [];
    const execution = state.execution;
    const selectedRun = execution === null ? null
      : runs.find((run) => canonicalJson(run.ref as unknown as JsonValue) === canonicalJson(execution as unknown as JsonValue)) ?? null;
    if (execution !== null && selectedRun === null) return unavailable(`the selected Run of task ${taskId} was not read`);
    let pointerIntent: ControlIntentSnapshotV1 | null = null;
    if (selectedRun !== null) {
      const pointers = await readPointerIntents(records, [selectedRun]);
      if (pointers.status !== 'ready') return pointers;
      pointerIntent = pointers.intents.get(selectedRun.ref.runId) ?? null;
    }
    const lease = facts.leasesByTaskId.get(taskId) ?? null;
    const reduction = facts.reductionsByTaskId.get(taskId) ?? null;
    const applicableReduction = state.reductionRevision === null ? null : reduction;
    const guards: RecordGuard[] = [...facts.guards];
    if (pointerIntent !== null) {
      guards.push({ refKey: canonicalJson(pointerIntent.ref as unknown as JsonValue), expectedRevision: pointerIntent.revision });
    }
    tasks.push({
      facts: { taskId, runs, lease, reduction, selectedRun, pointerIntent },
      phase: { taskKind: task.taskKind, applicableReduction, selectedRun,
        originUnresolvable: selectedRun === null && applicableReduction === null && state.effectivePhase === 'blocked',
        round: facts.roundsByTaskId.get(taskId) ?? { kind: 'none' }, coveringRequeue: state.requeueRef },
      guards,
    });
  }
  return { status: 'ready', tasks };
}

/** The origin Plans a basis comparison actually needs. */
export type OriginPlanRead = {
  plansByRefKey: ReadonlyMap<string, PlanRevisionSnapshot>;
  /** Reference keys whose immutable Plan record was genuinely absent. The
   * caller decides whether absence is corruption or an unprovable fact. */
  missing: ReadonlySet<string>;
  readThrough: CommitCursor | null;
};

/**
 * Batch-reads the immutable origin Plans actually referenced by the Run /
 * Reduction facts feeding the selected Plan's tasks, sharing ONE read window
 * and the registered codecs. It is not merely a read of `selected.basis`
 * literal targets, never walks a basis chain, never re-reads the same Plan per
 * Task and never scans Sessions/events.
 */
export async function readOriginPlans(
  records: GoalRecordTransactionPort,
  refs: readonly PlanRevisionRef[],
): Promise<{ status: 'ready'; value: OriginPlanRead } | Rejected> {
  const byKey = new Map<string, PlanRevisionRef>();
  for (const ref of refs) byKey.set(planRevisionRefKey(ref), ref);
  if (byKey.size === 0) {
    return { status: 'ready', value: { plansByRefKey: new Map(), missing: new Set(), readThrough: null } };
  }
  const read = await readBatch(records, [...byKey.keys()]);
  if (read.status !== 'ready') return read;
  const plansByRefKey = new Map<string, PlanRevisionSnapshot>();
  const missing = new Set<string>();
  for (const [key, ref] of byKey) {
    const record = read.batch.present.get(key);
    if (record === undefined) { missing.add(key); continue; }
    const decoded = decodePlanRevisionSnapshot(record);
    if (decoded.status !== 'decoded') {
      return unavailable(`origin plan ${ref.planId} is corrupt: ${decoded.reason}`);
    }
    plansByRefKey.set(key, decoded.value);
  }
  return { status: 'ready', value: { plansByRefKey, missing, readThrough: read.batch.readThrough } };
}

/**
 * Slice 1 §3.3/§3.4: the trusted Session-responsibility basis reader. It builds
 * the canonical Task facts and their `RecordGuard`s in `tasks` and publishes
 * them through the narrow `SessionResponsibilityBasisPort` the composition
 * injects into `sessions` (no `sessions` → `tasks` import).
 *
 * `terminal` is the CURRENT Task projection (`effectivePhase==='satisfied'` or a
 * cancelled/superseded disposition), never a finished Run. `finishedAt` is the
 * terminal closing fact: the formal reduction's `reducedAt` for satisfied, the
 * first terminal disposition Plan's `acceptedAt` otherwise. `writerStopped`
 * means the Task's old writer has no live occupancy. A `work` (or `module`)
 * target cannot be mapped to a Task and stays `incomplete`.
 */
export function createSessionResponsibilityBasisReader(
  records: GoalRecordTransactionPort & RecordLookupPort,
): SessionResponsibilityBasisPort {
  return {
    readResponsibilityBasis: async (ctx, input) => {
      const raw = input as unknown as { sessionRef?: unknown; target?: unknown } | null | undefined;
      if (raw === null || raw === undefined || !isRecord(raw.target) || !nonEmpty(raw.target['kind'])) {
        return { status: 'rejected', code: 'invalid', reason: 'readResponsibilityBasis requires a sessionRef and a work-link target' };
      }
      const sessionRef = raw.sessionRef as { projectId?: unknown; sessionId?: unknown } | undefined;
      if (!isRecord(sessionRef) || !nonEmpty(sessionRef['projectId']) || !nonEmpty(sessionRef['sessionId'])) {
        return { status: 'rejected', code: 'invalid', reason: 'readResponsibilityBasis requires a complete SessionRef' };
      }
      const bound = ctx as unknown as { projectId?: unknown; workspaceId?: unknown };
      if (!nonEmpty(bound.projectId) || !nonEmpty(bound.workspaceId)) {
        return { status: 'rejected', code: 'forbidden', reason: 'readResponsibilityBasis requires a bound project/workspace context' };
      }
      if (sessionRef['projectId'] !== bound.projectId) {
        return { status: 'rejected', code: 'forbidden', reason: 'the Session belongs to another project' };
      }
      const target = raw.target as Record<string, unknown>;
      if (target['kind'] !== 'task') {
        return incomplete('work_responsibility_unresolved: this work link has no Task basis');
      }
      const task = target['ref'];
      if (!isRecord(task) || !nonEmpty(task['projectId']) || !nonEmpty(task['goalId']) || !nonEmpty(task['taskId'])) {
        return { status: 'rejected', code: 'invalid', reason: 'readResponsibilityBasis requires a complete TaskTriple' };
      }
      if (task['projectId'] !== bound.projectId) {
        return { status: 'rejected', code: 'forbidden', reason: 'the Task belongs to another project' };
      }
      const goalRef: GoalRef = { aggregateType: 'Goal', projectId: task['projectId'], goalId: task['goalId'] };
      const goalRead = await readGoal(records, goalRef);
      if (goalRead.status !== 'ready') return goalRead;
      const planRef = goalRead.goal.activePlanRevision;
      if (planRef === null) {
        return { status: 'rejected', code: 'incomplete', reason: 'the Goal has no adopted Plan for the Task basis' };
      }
      const planRead = await readPlan(records, planRef);
      if (planRead.status !== 'ready') return planRead;
      const plan = planRead.plan;
      const definition = plan.tasks.find((candidate) => candidate.taskId === task['taskId']);
      if (definition === undefined) {
        return { status: 'rejected', code: 'not_found', reason: 'the Task is not part of the active Plan' };
      }
      const factsRead = await readCanonicalTaskFacts(records, goalRef, plan, task['taskId']);
      if (factsRead.status !== 'ready') return factsRead;
      const facts = factsRead.value;
      const state = facts.byTaskId.get(task['taskId']);
      if (state === undefined) {
        return { status: 'rejected', code: 'incomplete', reason: 'the directed task state was not read' };
      }
      const satisfied = state.effectivePhase === 'satisfied';
      const dispositionTerminal = definition.disposition === 'cancelled' || definition.disposition === 'superseded';
      const terminalCause: 'satisfied' | 'cancelled' | 'superseded' | null = satisfied
        ? 'satisfied' : definition.disposition === 'cancelled' ? 'cancelled'
          : definition.disposition === 'superseded' ? 'superseded' : null;
      let finishedAt: string | null = null;
      let originPlan: { ref: PlanRevisionRef; revision: number } | null = null;
      if (satisfied) {
        const reduction = facts.reductionsByTaskId.get(task['taskId']);
        finishedAt = reduction === undefined ? null : reduction.reducedAt;
      } else if (dispositionTerminal) {
        // The FIRST terminal disposition Plan's acceptedAt: the active plan may
        // only inherit the change (W16 `dispositionRecord.setIn`).
        finishedAt = plan.acceptedAt;
        const change = plan.schemaVersion === 2
          ? plan.dispositionRecord?.entries.find((entry) => entry.taskId === task['taskId']
            && (entry.to === 'cancelled' || entry.to === 'superseded'))
          : undefined;
        if (change !== undefined && planRevisionRefKey(change.setIn) !== planRevisionRefKey(plan.ref)) {
          const originRead = await readPlan(records, change.setIn);
          // E2: the original terminal Plan carries the real `acceptedAt`; a
          // failed read must be propagated, never replaced by the active Plan's
          // time.
          if (originRead.status !== 'ready') return originRead;
          finishedAt = originRead.plan.acceptedAt;
          originPlan = { ref: originRead.plan.ref, revision: originRead.plan.revision };
        }
      }
      const runs = facts.runsByTaskId.get(task['taskId']) ?? [];
      const selectedRun = state.execution === null ? null
        : runs.find((run) => canonicalJson(run.ref as unknown as JsonValue) === canonicalJson(state.execution as unknown as JsonValue)) ?? null;
      // D7: an `outcome_unknown` Run is NOT a stopped writer; only the existing
      // human attestation resolves it. A held lease also keeps the writer live.
      const selectedRunStopped = selectedRun !== null && selectedRun.status === 'ended'
        && selectedRun.outcome !== 'outcome_unknown';
      const writerStopped = selectedRun === null ? state.lease.status === 'free'
        : selectedRunStopped || state.lease.status === 'free';
      // §3.4 S:614: guard every record the proof used, including the Goal and
      // the active/origin Plan reads, not only the canonical Task window.
      const guards: RecordGuard[] = [
        ...facts.guards,
        { refKey: canonicalJson(goalRef as unknown as JsonValue), expectedRevision: goalRead.goal.revision },
        { refKey: planRevisionRefKey(plan.ref), expectedRevision: plan.revision },
        ...(originPlan === null ? [] : [{
          refKey: planRevisionRefKey(originPlan.ref), expectedRevision: originPlan.revision,
        }]),
      ];
      return { status: 'ready', value: {
        task: { projectId: task['projectId'], goalId: task['goalId'], taskId: task['taskId'] },
        planRef: plan.ref,
        terminal: terminalCause !== null,
        finishedAt,
        terminalCause,
        sourceRun: selectedRun,
        writerStopped,
        guards,
        sourceCursor: facts.readThrough,
      } };
    },
  };
}
