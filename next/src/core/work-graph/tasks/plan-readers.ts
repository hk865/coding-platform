/** Canonical task facts for R3c graph/ready reads and future R4c claim checks.
 * A missing schema/index/provider is incomplete, never an empty set of facts. */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreError } from '../../../contracts/core/results.js';
import type {
  RunSnapshot,
  TaskAttemptRef,
  TaskLeaseSnapshot,
  TaskTriple,
} from '../../../contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type {
  ArchitectureBaselinePin,
  ArchitectureBaselineRevisionRef,
  CompletionPolicyContentV1,
  CompletionPolicyPin,
  CompletionPolicyRevisionRef,
} from '../../../contracts/governance.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import { seqOfCommitCursor } from '../../../contracts/ledger.js';
import { revisionAssignments, type Phase, type PlanRevisionRef, type PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type { TaskReductionSnapshot } from '../../../contracts/reduction.js';
import type { RecordLookupPort, RecordLookupRequest } from '../../record-store/lookup-ports.js';
import type {
  DecodeResult,
  EncodedRecord,
  GoalRecordTransactionPort,
  RecordBackendSchemas,
  RecordGuard,
} from '../../record-store/ports.js';
import { decodeGoalSnapshot } from '../persistence/record-codecs.js';
import type { VerifiedGovernance } from './plan-commit-compiler.js';
import type { PlanProposal, PlanProposalRef } from './plan-contracts.js';
import {
  buildEffectiveTaskBasis, buildFrozenTaskDefinitions, frozenTaskDefinitionsAgree, isBasisUnsupported,
  type BasisUnsupported, type FrozenTaskDefinition,
} from './plan-task-basis.js';
import {
  PLAN_PROPOSAL_LOOKUP_INDEX,
  decodePlanProposalRecord,
  decodePlanRevisionSnapshot,
  planProposalRefKey,
  planRevisionRefKey,
} from './plan-record-codecs.js';

const RUN_BY_GOAL_INDEX = 'r3c-run-by-goal';
/** R4c.1 directed candidate index: exactly one Task's Runs, any Plan. */
const RUN_BY_TASK_INDEX = 'r4c-run-by-task';
const LOOKUP_PAGE_LIMIT = 200;
const LOOKUP_MAX_PAGES = 25;
/** Bounded retries when the candidate set and the canonical re-read do not
 * share one ledger watermark; never stamp a newer watermark onto an older set. */
const WINDOW_MAX_ATTEMPTS = 4;

export type Rejected = { status: 'rejected'; code: CoreError; reason: string };
export type Ready<T> = { status: 'ready'; value: T };

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
  const ref = parsed['ref'];
  if (!isRecord(ref) || ref['aggregateType'] !== 'TaskLease' || !nonEmpty(ref['projectId'])
    || !nonEmpty(ref['goalId']) || !nonEmpty(ref['taskId'])) {
    return invalidRecord('TaskLease snapshot has no complete TaskLeaseRef');
  }
  if (canonicalJson(ref as JsonValue) !== record.refKey) return invalidRecord('TaskLease ref is not the outer canonical ref_key');
  if (!isSafeRevision(parsed['revision']) || parsed['revision'] !== record.revision) return invalidRecord('TaskLease outer revision disagrees with the JSON revision');
  if (parsed['schemaVersion'] !== 1) return invalidRecord('TaskLease schemaVersion must be 1');
  if (!nonEmpty(parsed['holderRunId']) || !nonEmpty(parsed['attemptId']) || !nonEmpty(parsed['grantedAt'])) {
    return invalidRecord('TaskLease must carry holderRunId, attemptId and grantedAt');
  }
  if (parsed['expiresAt'] !== null && !nonEmpty(parsed['expiresAt'])) return invalidRecord('TaskLease expiresAt must be null or a string');
  return { status: 'decoded', value: copyRecord(record) };
}

const REDUCTION_PHASES: readonly string[] = ['verifying', 'blocked', 'failed', 'satisfied'];

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
  for (let page = 0; page < LOOKUP_MAX_PAGES; page += 1) {
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
  return incomplete(`lookup index ${index} did not terminate within ${String(LOOKUP_MAX_PAGES)} pages`);
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
      if (proposal.kind !== 'candidate_v2') continue;
      if (proposal.status !== 'candidate') continue;
      if (proposal.goalRef.projectId !== goal.ref.projectId || proposal.goalRef.goalId !== goal.ref.goalId) continue;
      const activeKey = goal.activePlanRevision === null ? null : planRevisionRefKey(goal.activePlanRevision);
      const basedOnKey = proposal.basedOn === null ? null : planRevisionRefKey(proposal.basedOn);
      if (activeKey !== basedOnKey) continue;
      if (selected === null || key < planProposalRefKey(selected.ref)) selected = proposal;
    }
    return { status: 'ready', goal, proposal: selected, readThrough: canonical.batch.readThrough };
  }
  return { status: 'rejected', code: 'revision_conflict',
    reason: 'the pending-plan window changed while it was being read' };
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
function completionPolicyDigest(body: Record<string, unknown>): string | null {
  try {
    return sha256Hex(canonicalJson({ schemaVersion: body['schemaVersion'],
      identity: { policyId: body['policyId'] }, revision: body['contentRevision'],
      content: body['content'] } as unknown as JsonValue));
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
  const active = goalRead.goal.activePlanRevision;
  if (active === null || planRevisionRefKey(active) !== planRevisionRefKey(expected)) {
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
  currentAttempt: TaskAttemptRef | null;
  execution: RunSnapshot['ref'] | null;
  lease: { status: 'free' } | { status: 'leased'; holderRunId: string };
  reductionRevision: number | null;
};
export type CanonicalTaskFacts = {
  goalRef: GoalRef;
  planRef: PlanRevisionSnapshot['ref'];
  byTaskId: ReadonlyMap<string, CanonicalTaskState>;
  readThrough: CommitCursor;
  /** Complete exact versions/absences used by adoption or future claim CAS. */
  guards: readonly RecordGuard[];
  /** Directed read only: at least one Run exists for THIS task, even one pinned
   * to an older Plan. A fresh claim must reject rather than read it as pending. */
  taskHasRun?: boolean;
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
  return candidate.revision > current.revision;
}
function uniqueKeys(keys: readonly string[]): string[] {
  return [...new Set(keys)];
}
function samePlanRevisionPointer(left: PlanRevisionRef | null, right: PlanRevisionRef | null): boolean {
  if (left === null || right === null) return left === right;
  return planRevisionRefKey(left) === planRevisionRefKey(right);
}
function taskKey(aggregateType: 'TaskLease' | 'TaskReduction', goalRef: GoalRef, taskId: string): string {
  return canonicalJson({ aggregateType, projectId: goalRef.projectId, goalId: goalRef.goalId, taskId } as unknown as JsonValue);
}

/** The per-Plan frozen definition index plus the per-Plan effective-basis
 * index. The reader builds each ONCE and reuses it, never re-scanning a Plan per
 * Task or per Run. */
type PlanFactsEntry = {
  plan: PlanRevisionSnapshot;
  definitions: ReadonlyMap<string, FrozenTaskDefinition>;
  basis: ReadonlyMap<string, PlanRevisionRef | BasisUnsupported>;
};

function planFactsEntry(plan: PlanRevisionSnapshot): PlanFactsEntry {
  return {
    plan,
    definitions: buildFrozenTaskDefinitions({
      tasks: plan.tasks,
      assignments: revisionAssignments(plan),
      inputRequirements: plan.schemaVersion === 2 ? plan.inputRequirements ?? [] : [],
      obligations: plan.obligations,
    }),
    basis: buildEffectiveTaskBasis(plan),
  };
}

type OriginVerdict =
  | { status: 'accepted' }
  | { status: 'excluded' }
  | { status: 'unavailable'; reason: string };

type BasisVerdict = { status: 'ok' } | { status: 'unavailable'; reason: string };

/**
 * Verifies ONE Plan's declared basis for one Task. The basis is either the Plan
 * itself (an absolute source) or a same-Goal Plan, no later than the referrer,
 * present, defining the Task, agreeing on its frozen definition, and itself an
 * absolute source. It never walks a second hop, so a chained/degenerate basis is
 * an explicit `unavailable`, not a silent success.
 */
function verifyBasisDelegation(input: {
  referrer: PlanFactsEntry;
  taskId: string;
  index: ReadonlyMap<string, PlanFactsEntry>;
  goalRef: GoalRef;
}): BasisVerdict {
  const { referrer, taskId } = input;
  const basis = referrer.basis.get(taskId);
  if (basis === undefined) {
    return { status: 'unavailable', reason: `plan ${referrer.plan.planId} has no task ${taskId}` };
  }
  if (isBasisUnsupported(basis)) return { status: 'unavailable', reason: basis.reason };
  if (planRevisionRefKey(basis) === planRevisionRefKey(referrer.plan.ref)) return { status: 'ok' };
  const source = input.index.get(planRevisionRefKey(basis));
  if (source === undefined) {
    return { status: 'unavailable', reason: `basis source ${basis.planId} for task ${taskId} is missing` };
  }
  if (source.plan.ref.projectId !== input.goalRef.projectId
    || source.plan.goalRef.goalId !== input.goalRef.goalId) {
    return { status: 'unavailable', reason: `basis source ${basis.planId} for task ${taskId} belongs to another goal` };
  }
  if (source.plan.planRevision > referrer.plan.planRevision) {
    return { status: 'unavailable', reason: `basis source ${basis.planId} for task ${taskId} is later than its referrer` };
  }
  const sourceDefinition = source.definitions.get(taskId);
  const referrerDefinition = referrer.definitions.get(taskId);
  if (sourceDefinition === undefined || referrerDefinition === undefined) {
    return { status: 'unavailable', reason: `basis source ${basis.planId} does not define task ${taskId}` };
  }
  const agree = frozenTaskDefinitionsAgree({ left: sourceDefinition, right: referrerDefinition });
  if (isBasisUnsupported(agree)) return { status: 'unavailable', reason: agree.reason };
  if (!agree) {
    return { status: 'unavailable',
      reason: `basis source ${basis.planId} and referrer ${referrer.plan.planId} disagree on task ${taskId}` };
  }
  const sourceBasis = source.basis.get(taskId);
  if (sourceBasis === undefined || isBasisUnsupported(sourceBasis)) {
    return { status: 'unavailable', reason: `basis source ${basis.planId} has no effective basis for task ${taskId}` };
  }
  if (planRevisionRefKey(sourceBasis) !== planRevisionRefKey(source.plan.ref)) {
    return { status: 'unavailable', reason: `basis source ${basis.planId} is not an absolute source for task ${taskId}` };
  }
  return { status: 'ok' };
}

/**
 * Whether one Run/Reduction fact pinned to `origin` may describe `taskId` of
 * the selected Plan. Accepted only when the origin is the same Goal, the Task's
 * EFFECTIVE basis is identical, both the origin's and the selected Plan's
 * declared basis sources verify, the frozen execution definition agrees with
 * the selected Plan, and the origin is not a later revision. A basis match with
 * a differing definition is corruption and must be `unavailable`, never absent.
 */
function originVerdict(input: {
  origin: PlanFactsEntry;
  selected: PlanFactsEntry;
  selectedBasis: PlanRevisionRef;
  selectedDefinition: FrozenTaskDefinition;
  taskId: string;
  index: ReadonlyMap<string, PlanFactsEntry>;
  goalRef: GoalRef;
}): OriginVerdict {
  const { origin } = input;
  if (origin.plan.ref.projectId !== input.goalRef.projectId || origin.plan.goalRef.projectId !== input.goalRef.projectId) {
    return { status: 'unavailable', reason: `origin plan ${origin.plan.planId} is outside the requested project` };
  }
  if (origin.plan.goalRef.goalId !== input.goalRef.goalId
    || origin.plan.goalRef.goalId !== input.selected.plan.goalRef.goalId) {
    return { status: 'unavailable', reason: `origin plan ${origin.plan.planId} belongs to another goal` };
  }
  const originBasis = origin.basis.get(input.taskId);
  if (originBasis === undefined) {
    return { status: 'unavailable', reason: `origin plan ${origin.plan.planId} has no task ${input.taskId}` };
  }
  if (isBasisUnsupported(originBasis)) return { status: 'unavailable', reason: originBasis.reason };
  if (planRevisionRefKey(originBasis) !== planRevisionRefKey(input.selectedBasis)) return { status: 'excluded' };
  const originChain = verifyBasisDelegation({ referrer: origin, taskId: input.taskId,
    index: input.index, goalRef: input.goalRef });
  if (originChain.status === 'unavailable') return originChain;
  const originDefinition = origin.definitions.get(input.taskId);
  if (originDefinition === undefined) {
    return { status: 'unavailable', reason: `origin plan ${origin.plan.planId} does not define task ${input.taskId}` };
  }
  const agree = frozenTaskDefinitionsAgree({ left: originDefinition, right: input.selectedDefinition });
  if (isBasisUnsupported(agree)) return { status: 'unavailable', reason: agree.reason };
  if (!agree) {
    return { status: 'unavailable',
      reason: `origin plan ${origin.plan.planId} shares the basis for task ${input.taskId} but its frozen definition differs` };
  }
  if (origin.plan.planRevision > input.selected.plan.planRevision) return { status: 'excluded' };
  return { status: 'accepted' };
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
  index: ReadonlyMap<string, PlanFactsEntry>;
  selected: PlanFactsEntry;
  selectedBasis: PlanRevisionRef;
  selectedDefinition: FrozenTaskDefinition;
  goalRef: GoalRef;
}): { status: 'ok'; value: CanonicalTaskState['lease'] } | { status: 'unavailable'; reason: string } {
  if (input.lease === null) return { status: 'ok', value: { status: 'free' } };
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
  const verdict = originVerdict({ origin: entry, selected: input.selected, selectedBasis: input.selectedBasis,
    selectedDefinition: input.selectedDefinition, taskId: input.taskId, index: input.index, goalRef: input.goalRef });
  if (verdict.status === 'unavailable') return { status: 'unavailable', reason: verdict.reason };
  if (verdict.status === 'accepted') return { status: 'ok', value: { status: 'leased', holderRunId: input.lease.holderRunId } };
  return { status: 'ok', value: { status: 'free' } };
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
  const selectedFacts = planFactsEntry(plan);
  const requiredBasisSources = new Map<string, PlanRevisionRef>();
  for (const task of selectedTasks) {
    const basis = selectedFacts.basis.get(task.taskId);
    if (basis === undefined || isBasisUnsupported(basis)) continue; // reported as unavailable in the task fold
    if (planRevisionRefKey(basis) !== planRevisionRefKey(plan.ref)) {
      requiredBasisSources.set(planRevisionRefKey(basis), basis);
    }
  }
  const leaseKeys = selectedTasks.map((task) => taskKey('TaskLease', goalRef, task.taskId));
  const reductionKeys = selectedTasks.map((task) => taskKey('TaskReduction', goalRef, task.taskId));
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
    let taskHasRun = false;
    for (const key of found.refKeys) {
      const record = present.get(key);
      if (record === undefined) return unavailable(`Run candidate ${key} has no canonical record`);
      guards.push({ refKey: key, expectedRevision: record.revision });
      const run = parseRun(record.json);
      if (run === null) return unavailable(`Run record ${key} is not decodable`);
      if (run.ref.projectId !== goalRef.projectId || run.ref.goalId !== goalRef.goalId) continue;
      if (run.task.projectId !== goalRef.projectId || run.task.goalId !== goalRef.goalId) continue;
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
      const leaseKey = taskKey('TaskLease', goalRef, task.taskId);
      const reductionKey = taskKey('TaskReduction', goalRef, task.taskId);
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
    const index = new Map<string, PlanFactsEntry>([[selectedKey, selectedFacts]]);
    if (combinedRefs.size > 0) {
      const origins = await readOriginPlans(records, [...combinedRefs.values()]);
      if (origins.status !== 'ready') return origins;
      if (!sameCursor(read.value.readThrough, origins.value.readThrough)) continue;
      for (const [key, originPlan] of origins.value.plansByRefKey) index.set(key, planFactsEntry(originPlan));
    }
    // A declared basis source is a hard dependency of the selected definition.
    for (const [key, ref] of requiredBasisSources) {
      if (!index.has(key)) {
        return unavailable(`the basis source plan ${ref.planId} required by the selected plan is missing`);
      }
    }
    const byTaskId = new Map<string, CanonicalTaskState>();
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
      for (const candidate of runByTask.get(task.taskId) ?? []) {
        const entry = index.get(planRevisionRefKey(candidate.planRef));
        if (entry === undefined) { unresolvable = true; continue; }
        const verdict = originVerdict({ origin: entry, selected: selectedFacts, selectedBasis,
          selectedDefinition, taskId: task.taskId, index, goalRef });
        if (verdict.status === 'unavailable') return unavailable(verdict.reason);
        if (verdict.status === 'excluded') continue;
        if (run === null || preferRun(candidate, run)) run = candidate;
      }
      const reduction = reductionByTask.get(task.taskId) ?? null;
      let reductionApplicable = false;
      if (reduction !== null) {
        const entry = index.get(planRevisionRefKey(reduction.planRef));
        if (entry === undefined) {
          if (run === null) unresolvable = true;
        } else {
          const verdict = originVerdict({ origin: entry, selected: selectedFacts, selectedBasis,
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
      // Active accepted Run => running. An ENDED accepted Run with no matching
      // formal reduction is conservatively blocked. A Run that cannot be
      // resolved to an origin Plan is never silently `pending`/free.
      const effectivePhase: Phase = reductionApplicable ? reduction!.phase
        : run !== null && runIsActive(run) ? 'running'
        : run !== null ? 'blocked'
        : unresolvable ? 'blocked' : 'pending';
      byTaskId.set(task.taskId, {
        taskId: task.taskId,
        effectivePhase,
        currentAttempt: run === null ? null : { aggregateType: 'TaskAttempt', projectId: goalRef.projectId,
          goalId: goalRef.goalId, taskId: task.taskId, attemptId: run.attemptId },
        execution: run === null ? null : run.ref,
        lease: lease.value,
        reductionRevision: reductionApplicable && reduction !== null ? reduction.revision : null,
      });
    }
    const watermark = read.value.readThrough;
    if (watermark === null) return incomplete('the ledger has no readable watermark for task state');
    return { status: 'ready', value: { goalRef, planRef: plan.ref, byTaskId, readThrough: watermark, guards,
      ...(directed ? { taskHasRun } : {}) } };
  }
  return { status: 'rejected', code: 'revision_conflict',
    reason: 'the canonical task window changed while it was being read' };
}
// --------------------------------------------------------------------------
// W1 future-change and origin-Plan reads
// --------------------------------------------------------------------------

/**
 * Directed result for the tasks a future-change candidate touches. The future
 * check only needs EXACT ABSENCE guards plus the read watermark used to prove
 * it; it does NOT assemble a full CanonicalTaskState map. Any existing Run /
 * Lease / Reduction trace is a specific rejection. It never requires whole
 * ledger readThrough equality: the directed RUN_BY_TASK index plus exact
 * Lease/Reduction reads close the race at the LAST commit with their guards.
 */
export type FutureChangeTaskFacts = {
  goalRef: GoalRef;
  taskIds: readonly string[];
  guards: readonly RecordGuard[];
  readThrough: CommitCursor;
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
  const guards: RecordGuard[] = [];
  let watermark: CommitCursor | null = null;
  const runKeys: string[] = [];
  for (const taskId of uniqueTaskIds) {
    const found = await readLookupKeys(records, RUN_BY_TASK_INDEX, [goalRef.projectId, goalRef.goalId, taskId]);
    if (found.status !== 'ready') return found;
    watermark = laterCursor(watermark, found.readThrough);
    runKeys.push(...found.refKeys);
  }
  const leaseKeys = uniqueTaskIds.map((taskId) => taskKey('TaskLease', goalRef, taskId));
  const reductionKeys = uniqueTaskIds.map((taskId) => taskKey('TaskReduction', goalRef, taskId));
  const read = await records.readMany(uniqueKeys([...runKeys, ...leaseKeys, ...reductionKeys]));
  if (read.status !== 'ready') {
    if (read.code === 'unsupported') return incomplete(`task-state record schemas are not registered: ${read.reason}`);
    if (read.code === 'invalid') return incomplete(`the task-state read is invalid: ${read.reason}`);
    return unavailable(`${read.code}: ${read.reason}`);
  }
  watermark = laterCursor(watermark, read.value.readThrough);
  const present = new Map<string, EncodedRecord>();
  for (const record of read.value.records) present.set(record.refKey, record);
  const taskIdSet = new Set(uniqueTaskIds);
  for (const key of uniqueKeys(runKeys)) {
    const record = present.get(key);
    if (record === undefined) return unavailable(`Run candidate ${key} has no canonical record`);
    const run = parseRun(record.json);
    if (run === null) return unavailable(`Run record ${key} is not decodable`);
    if (run.ref.projectId !== goalRef.projectId || run.ref.goalId !== goalRef.goalId) continue;
    if (!taskIdSet.has(run.task.taskId)) continue;
    return { status: 'rejected', code: 'revision_conflict',
      reason: `task ${run.task.taskId} already has a Run and is no longer a future task` };
  }
  for (const taskId of uniqueTaskIds) {
    const leaseKey = taskKey('TaskLease', goalRef, taskId);
    const reductionKey = taskKey('TaskReduction', goalRef, taskId);
    const leaseRecord = present.get(leaseKey);
    if (leaseRecord !== undefined) {
      const lease = parseLease(leaseRecord.json);
      if (lease === null) return unavailable(`TaskLease ${leaseKey} is not decodable`);
      return { status: 'rejected', code: 'revision_conflict',
        reason: `task ${taskId} already holds a TaskLease and is no longer a future task` };
    }
    guards.push({ refKey: leaseKey, expectedRevision: null });
    const reductionRecord = present.get(reductionKey);
    if (reductionRecord !== undefined) {
      const reduction = parseReduction(reductionRecord.json);
      if (reduction === null) return unavailable(`TaskReduction ${reductionKey} is not decodable`);
      return { status: 'rejected', code: 'revision_conflict',
        reason: `task ${taskId} already has a formal reduction and is no longer a future task` };
    }
    guards.push({ refKey: reductionKey, expectedRevision: null });
  }
  if (watermark === null) return incomplete('the ledger has no readable watermark for future-change facts');
  return { status: 'ready', value: { goalRef, taskIds: uniqueTaskIds, guards, readThrough: watermark } };
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
