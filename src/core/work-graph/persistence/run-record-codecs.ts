/**
 * The ONE implementation of the `RunSnapshot@1` and `QueryRunSnapshot@1`
 * encoding checks.
 *
 * It lives in `persistence/` because that layer depends only on `model` and
 * `contracts`, and because both checks are pure record-shape validation.
 * `materials/record-readers.ts` keeps the schema registration and delegates
 * here through same-named wrappers; `materials/run-snapshot-decoder.ts` keeps
 * `decodeRun` as a module exit for its existing importers.
 */
import type { DecodeResult, EncodedRecord, EncodedRecordSchema } from '../../record-store/ports.js';
import { isJsonObject, isNonEmptyString, isRevision, parseJsonObject } from '../../record-store/record-codec.js';
import { isRunExecutionHistoryV1 } from './execution-history-codecs.js';
import {
  inputBindingProblem, runExecutionAuthorizationProblem, runReconciliationProblem, terminalPayloadProblem,
} from './execution-entry-codecs.js';
import { taskRequeueRefProblem } from './rework-codecs.js';
import { runControlStateProblem } from './control-record-codecs.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { validateRuntimeBudget } from '../../../contracts/runtime-budget.js';
import { invalid, parseObject } from '../../../contracts/validation/common.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type { RunRef, RunSnapshot } from '../../../contracts/dispatch.js';
import type { QueryJobRef, QueryRunRef } from '../../../contracts/query-job.js';

export const RUN_SNAPSHOT_SCHEMA_ID = 'RunSnapshot@1';
export const QUERY_RUN_SNAPSHOT_SCHEMA_ID = 'QueryRunSnapshot@1';

// --------------------------------------------------------------------------
// Encoding selectors
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// Pure shape helpers (reuse the Store's mechanical checks)
// --------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>;

function isRunRef(value: unknown): value is RunRef {
  if (!isJsonObject(value)) return false;
  return value['aggregateType'] === 'Run' &&
    isNonEmptyString(value['projectId']) &&
    isNonEmptyString(value['goalId']) &&
    isNonEmptyString(value['runId']);
}

function isQueryRunRef(value: unknown): value is QueryRunRef {
  if (!isJsonObject(value)) return false;
  return value['aggregateType'] === 'QueryRun' &&
    isNonEmptyString(value['projectId']) &&
    isNonEmptyString(value['workspaceId']) &&
    isNonEmptyString(value['queryJobId']) &&
    isNonEmptyString(value['runId']);
}

function isQueryJobRef(value: unknown): value is QueryJobRef {
  if (!isJsonObject(value)) return false;
  return value['aggregateType'] === 'QueryJob' &&
    isNonEmptyString(value['projectId']) &&
    isNonEmptyString(value['workspaceId']) &&
    isNonEmptyString(value['queryJobId']);
}

function isPlanRevisionRef(value: unknown): value is PlanRevisionRef {
  if (!isJsonObject(value)) return false;
  return value['aggregateType'] === 'PlanRevision' &&
    isNonEmptyString(value['projectId']) &&
    isNonEmptyString(value['planId']);
}

function isWorkspacePin(value: unknown): boolean {
  if (!isJsonObject(value)) return false;
  return isNonEmptyString(value['workspaceId']) && isRevision(value['revision']);
}

function isRoleBinding(value: unknown): boolean {
  if (!isJsonObject(value)) return false;
  return value['schemaVersion'] === 1 &&
    isNonEmptyString(value['bindingId']) &&
    isNonEmptyString(value['templateId']) &&
    isNonEmptyString(value['templateRevision']) &&
    isRevision(value['bindingVersion']) &&
    isNonEmptyString(value['policyRevision']);
}

function isTaskBudget(value: unknown): boolean {
  if (!isJsonObject(value)) return false;
  return isRevision(value['tokenBudget']) &&
    (value['deadline'] === null || typeof value['deadline'] === 'string');
}

function isRunStatus(value: unknown): boolean {
  return value === 'starting' || value === 'running' || value === 'ended';
}

function isRunOutcome(value: unknown): boolean {
  return value === null || value === 'completed' || value === 'failed' || value === 'cancelled' ||
    value === 'budget_exhausted' || value === 'crashed' || value === 'outcome_unknown' ||
    // The common orchestration mechanism: an explicit yielded terminal is a real
    // RunOutcome, distinct from completed/cancelled and never a Task satisfaction.
    value === 'yielded';
}

function isQueryRunStatus(value: unknown): boolean {
  return value === 'pending' || value === 'running' || value === 'answered' || value === 'closed';
}

function isQueryRunOutcome(value: unknown): boolean {
  return value === null || value === 'answered' || value === 'timeout' || value === 'gap' ||
    value === 'failed' || value === 'cancelled' ||
    // §8 SD-4: settled by reconciliation without the Query ever entering the Kernel.
    value === 'not_entered';
}

/** The ONE QueryRun schema accepts the optional versioned execution state
 * without re-registering QueryRun anywhere else. */
function isQueryExecutionPhase(value: unknown): boolean {
  return value === 'claimed' || value === 'prepared' || value === 'entering' ||
    value === 'entered' || value === 'unknown' || value === 'settled';
}

// --------------------------------------------------------------------------
// Record validators (pure encoding checks only, stored JSON is preserved)
// --------------------------------------------------------------------------

/** Optional yielded continuation shape; absent on every other Run. */
function runContinuationShapeProblem(value: unknown, ref: RunRef, task: unknown): string | null {
  if (value === undefined) return null;
  if (!isJsonObject(value)) return 'the continuation must be an object';
  if (value['schemaVersion'] !== 1 || value['kind'] !== 'wait_reply') return 'the continuation kind is not recognized';
  const boundTask = value['task'];
  if (!isJsonObject(boundTask) || !isJsonObject(task)
    || boundTask['projectId'] !== task['projectId'] || boundTask['goalId'] !== task['goalId']
    || boundTask['taskId'] !== task['taskId']) return 'the continuation Task is not the Run Task';
  const sessionRef = value['sessionRef'];
  if (!isJsonObject(sessionRef) || sessionRef['projectId'] !== ref.projectId
    || !isNonEmptyString(sessionRef['sessionId'])) return 'the continuation Session is not the same project';
  const messageRef = value['messageRef'];
  if (!isJsonObject(messageRef) || messageRef['aggregateType'] !== 'SessionMessage'
    || messageRef['projectId'] !== ref.projectId || !isNonEmptyString(messageRef['workspaceId'])
    || !isNonEmptyString(messageRef['messageId'])) return 'the continuation messageRef is incomplete or outside the project';
  return null;
}

/**
 * Optional `requeueRef` (TASK-03): the TaskRequeue of this Run's own Task that
 * covers an earlier Run. It never coexists with `consumedWait`.
 */
function runRequeueRefProblem(value: unknown, ref: RunRef, task: UnknownRecord, consumedWait: unknown): string | null {
  if (value === undefined) return null;
  const problem = taskRequeueRefProblem(value, 'requeueRef');
  if (problem !== null) return problem;
  const requeueRef = value as UnknownRecord;
  if (requeueRef['projectId'] !== ref.projectId || requeueRef['goalId'] !== ref.goalId
    || requeueRef['taskId'] !== task['taskId']) {
    return 'the requeueRef does not belong to the Run Task';
  }
  if (requeueRef['afterRunId'] === ref.runId) return 'a Run cannot continue its own requeue';
  if (consumedWait !== undefined) return 'a requeued Run cannot also consume a wait';
  return null;
}

export function validateRunSnapshot(record: EncodedRecord): DecodeResult<EncodedRecord> {
  if (record.schemaId !== RUN_SNAPSHOT_SCHEMA_ID) {
    return invalid(`expected schemaId ${RUN_SNAPSHOT_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const parsed = parseJsonObject(record.json);
  if (parsed.status === 'invalid') return invalid(parsed.reason);
  const body = parsed.value;
  const ref = body['ref'];
  if (!isRunRef(ref)) return invalid('Run snapshot has no complete RunRef');
  if (canonicalJson(ref as unknown as JsonValue) !== record.refKey) {
    return invalid('Run snapshot ref is not the outer canonical ref_key');
  }
  if (!isRevision(body['revision']) || body['revision'] !== record.revision) {
    return invalid('Run snapshot revision disagrees with the encoded record');
  }
  if (body['schemaVersion'] !== 1) return invalid('Run snapshot schemaVersion must be 1');
  if (body['executionHistory'] !== undefined &&
      (!isRunExecutionHistoryV1(body['executionHistory']) || body['executionHistory'].sessionRef.projectId !== ref.projectId)) {
    return invalid('Run executionHistory is malformed or outside the project');
  }
  // The Run's exact authorization and input binding are validated by their
  // single owning helpers. An absent binding stays a historical Run; a present
  // V2/input binding with a bad or inconsistent shape is damaged, not readable.
  const authorizationProblem = runExecutionAuthorizationProblem(body['executionAuthorization']);
  if (authorizationProblem !== null) {
    return invalid(`Run executionAuthorization is malformed: ${authorizationProblem}`);
  }
  if (body['inputBinding'] !== undefined) {
    const bindingProblem = inputBindingProblem(body['inputBinding']);
    if (bindingProblem !== null) return invalid(`Run inputBinding is malformed: ${bindingProblem}`);
  }
  const task = body['task'];
  if (!isJsonObject(task) || !isNonEmptyString(task['projectId']) ||
    !isNonEmptyString(task['goalId']) || !isNonEmptyString(task['taskId'])) {
    return invalid('Run snapshot task must be a complete TaskTriple');
  }
  if (task['projectId'] !== ref.projectId || task['goalId'] !== ref.goalId) {
    return invalid('Run snapshot task does not belong to the Run ref');
  }
  if (!isNonEmptyString(body['attemptId'])) return invalid('Run snapshot attemptId must be a non-empty string');
  const planRef = body['planRef'];
  if (!isPlanRevisionRef(planRef) || planRef.projectId !== ref.projectId) {
    return invalid('Run snapshot planRef must be a PlanRevisionRef of the same project');
  }
  if (!isRoleBinding(body['roleBinding'])) return invalid('Run snapshot roleBinding is not a RoleBindingRefV1');
  if (!isTaskBudget(body['budget'])) return invalid('Run snapshot budget is not a TaskBudgetV1');
  if (!isWorkspacePin(body['workspaceSnapshot'])) {
    return invalid('Run snapshot workspaceSnapshot is not a complete workspace pin');
  }
  // The optional Run controlState is validated by its one pure helper.
  // A historical Run with no field stays readable; a present field must be a
  // complete, scope-aligned control pointer. This is a shape check only: it does
  // not admit or fence execution.
  const controlStateProblem = runControlStateProblem(body['controlState'],
    ref.projectId, (body['workspaceSnapshot'] as { workspaceId: string }).workspaceId);
  if (controlStateProblem !== null) {
    return invalid(`Run controlState is malformed: ${controlStateProblem}`);
  }
  // The optional yielded continuation is a binding, not a permission: when
  // present it must name this Run's exact Task/Session and a complete message.
  const continuationProblem = runContinuationShapeProblem(body['continuation'], ref, body['task']);
  if (continuationProblem !== null) return invalid(`Run continuation is malformed: ${continuationProblem}`);
  if (!isRunStatus(body['status'])) return invalid('Run snapshot status is not a RunStatus');
  if (!isRunOutcome(body['outcome'])) return invalid('Run snapshot outcome is not a RunOutcome or null');
  // A.2 optional facts (spec §4.1, §6.1 (a)/(f)). Absent on every historical
  // Run; a present value is checked by its one owning helper.
  const requeueProblem = runRequeueRefProblem(body['requeueRef'], ref, task, body['consumedWait']);
  if (requeueProblem !== null) return invalid(`Run requeueRef is malformed: ${requeueProblem}`);
  const terminalProblem = terminalPayloadProblem(body['terminalPayload'], body['status'], body['outcome']);
  if (terminalProblem !== null) return invalid(`Run terminalPayload is malformed: ${terminalProblem}`);
  const reconciliationProblem = runReconciliationProblem(body['reconciliation'], ref as unknown as UnknownRecord);
  if (reconciliationProblem !== null) return invalid(`Run reconciliation is malformed: ${reconciliationProblem}`);
  if (!(body['exitCode'] === null || typeof body['exitCode'] === 'number')) {
    return invalid('Run snapshot exitCode must be a number or null');
  }
  if (!isRevision(body['lastEventSeq'])) {
    return invalid('Run snapshot lastEventSeq must be a safe non-negative integer');
  }
  if (typeof body['lastRuntimeEventId'] !== 'string' || typeof body['lastFactEventId'] !== 'string') {
    return invalid('Run snapshot last event ids must be strings');
  }
  if (!(body['envelope'] === null || isJsonObject(body['envelope']))) {
    return invalid('Run snapshot envelope must be an object or null');
  }
  if (!(body['startedAt'] === null || typeof body['startedAt'] === 'string')) {
    return invalid('Run snapshot startedAt must be a string or null');
  }
  if (!(body['endedAt'] === null || typeof body['endedAt'] === 'string')) {
    return invalid('Run snapshot endedAt must be a string or null');
  }
  return { status: 'decoded', value: record };
}

/**
 * The required execution-state `requestProfile`: null for a plain Query, a
 * complete profile for a request round. A missing field is a problem, never a
 * default; the claim is the only writer that may set a non-null value.
 */
export function executionRequestProfileProblem(value: unknown): string | null {
  if (value === null) return null;
  if (!isJsonObject(value)) return 'requestProfile must be null or an object';
  if (!isNonEmptyString(value['profileId'])) return 'requestProfile.profileId must be a non-empty string';
  if (!isNonEmptyString(value['consumerId'])) return 'requestProfile.consumerId must be a non-empty string';
  try {
    if (canonicalJson(validateRuntimeBudget(value['runtimeBudget'])) !== canonicalJson(value['runtimeBudget'] as JsonValue)) {
      return 'requestProfile.runtimeBudget is not a complete RuntimeBudget';
    }
  } catch {
    return 'requestProfile.runtimeBudget is not a complete RuntimeBudget';
  }
  const budget = value['budget'];
  if (!isJsonObject(budget)) return 'requestProfile.budget must be an object';
  if (!(budget['maxTokens'] === null
    || (Number.isSafeInteger(budget['maxTokens']) && (budget['maxTokens'] as number) > 0))) {
    return 'requestProfile.budget.maxTokens must be null or a positive integer';
  }
  if (!(budget['deadline'] === null || typeof budget['deadline'] === 'string')) {
    return 'requestProfile.budget.deadline must be null or a string';
  }
  return null;
}

/**
 * The execution-state `prepared`: null before the bind, else the bound
 * manifest whose `requestEffectiveGoalId` is required — the request round's
 * frozen goal, null for a no-goal round and every plain Query — and never
 * defaulted. Like the other partial execution-state checks here, an absent
 * `prepared` key is not judged; a present one is.
 */
export function executionPreparedProblem(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (!isJsonObject(value)) return 'prepared must be null or an object';
  const goalId = value['requestEffectiveGoalId'];
  if (!(goalId === null || isNonEmptyString(goalId))) {
    return 'prepared.requestEffectiveGoalId must be null or a non-empty string';
  }
  return null;
}

/** Narrow export: the ONE QueryRunSnapshot@1 validator; query codecs reuse it. */
export function validateQueryRunSnapshot(record: EncodedRecord): DecodeResult<EncodedRecord> {
  if (record.schemaId !== QUERY_RUN_SNAPSHOT_SCHEMA_ID) {
    return invalid(`expected schemaId ${QUERY_RUN_SNAPSHOT_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const parsed = parseJsonObject(record.json);
  if (parsed.status === 'invalid') return invalid(parsed.reason);
  const body = parsed.value;
  const ref = body['ref'];
  if (!isQueryRunRef(ref)) return invalid('QueryRun snapshot has no complete QueryRunRef');
  if (canonicalJson(ref as unknown as JsonValue) !== record.refKey) {
    return invalid('QueryRun snapshot ref is not the outer canonical ref_key');
  }
  if (!isRevision(body['revision']) || body['revision'] !== record.revision) {
    return invalid('QueryRun snapshot revision disagrees with the encoded record');
  }
  if (body['schemaVersion'] !== 1) return invalid('QueryRun snapshot schemaVersion must be 1');
  const run = body['run'];
  if (!isJsonObject(run)) return invalid('QueryRun snapshot run must be an object');
  if (run['schemaVersion'] !== 1) return invalid('QueryRun run schemaVersion must be 1');
  const queryJobRef = run['queryJobRef'];
  if (!isQueryJobRef(queryJobRef) ||
    queryJobRef.projectId !== ref.projectId ||
    queryJobRef.workspaceId !== ref.workspaceId ||
    queryJobRef.queryJobId !== ref.queryJobId) {
    return invalid('QueryRun run.queryJobRef does not match the QueryRun ref');
  }
  if (run['runId'] !== ref.runId) return invalid('QueryRun run.runId does not match the QueryRun ref runId');
  if (!isQueryRunStatus(run['status'])) return invalid('QueryRun run status is not a QueryRunStatus');
  if (!(run['startedAt'] === null || typeof run['startedAt'] === 'string')) {
    return invalid('QueryRun run startedAt must be a string or null');
  }
  if (!(run['endedAt'] === null || typeof run['endedAt'] === 'string')) {
    return invalid('QueryRun run endedAt must be a string or null');
  }
  if (!isQueryRunOutcome(run['outcome'])) return invalid('QueryRun run outcome is not a QueryRunOutcome or null');
  if (run['execution'] !== undefined && !isJsonObject(run['execution'])) {
    return invalid('QueryRun execution binding must be an object when present');
  }
  const executionState = run['executionState'];
  if (executionState !== undefined) {
    if (!isJsonObject(executionState)) {
      return invalid('QueryRun executionState must be an object when present');
    }
    if (executionState['schemaVersion'] !== 1) {
      return invalid('QueryRun executionState.schemaVersion must be 1');
    }
    if (!isQueryExecutionPhase(executionState['phase'])) {
      return invalid('QueryRun executionState.phase is not a legal execution phase');
    }
    if (!isJsonObject(executionState['sessionRef'])) {
      return invalid('QueryRun executionState.sessionRef must be an object');
    }
    const requestProfileProblem = executionRequestProfileProblem(executionState['requestProfile']);
    if (requestProfileProblem !== null) {
      return invalid(`QueryRun executionState.${requestProfileProblem}`);
    }
    const preparedProblem = executionPreparedProblem(executionState['prepared']);
    if (preparedProblem !== null) return invalid(`QueryRun executionState.${preparedProblem}`);
  }
  return { status: 'decoded', value: record };
}

/** Bound ONCE to the one RunSnapshot@1 validator (was: selected from the materials registration). */
const RUN_VALIDATE: EncodedRecordSchema['validate'] | undefined = validateRunSnapshot;

/** The ONE Run schema-checked decoder, not a new lenient parser. */
export type Decoded<T> = { ok: true; value: T } | { ok: false; reason: string };

export function decodeRun(record: EncodedRecord): Decoded<RunSnapshot> {
  if (RUN_VALIDATE === undefined) return { ok: false, reason: 'the RunSnapshot schema is not registered' };
  const checked = RUN_VALIDATE(record);
  if (checked.status !== 'decoded') return { ok: false, reason: checked.reason };
  const body = parseObject(record.json);
  if (body === null) return { ok: false, reason: 'the Run snapshot is not a JSON object' };
  return { ok: true, value: body as unknown as RunSnapshot };
}
