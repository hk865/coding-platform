/**
 * R5b.1 pending QueryJob/QueryRun writer and reader.
 *
 * This is the only missing domain producer for a fresh Store: a trusted Host
 * records ONE pending QueryJob + QueryRun pair and reads that pair back. It does
 * NOT select a Session, capture a source, prepare a body, claim a Session slot or
 * start a model; those are later batches.
 *
 * Submission algorithm (skeleton §5):
 *   1. clone/isolate the request and capture the real AbortSignal BEFORE the
 *      first await; check the trusted Host scope and the full structural shape;
 *   2. exact identity/fingerprint `lookupCommit` — a hit restores the ORIGINAL
 *      pair from `receipt.cursor` → `eventAt`; the current Run state is never
 *      used to rebuild a historical receipt;
 *   3. on a miss, exact reads of the real Project/Workspace/Goal and (only when
 *      focus is non-empty) the Goal's current immutable Plan snapshot;
 *   4. compile the pending Job@1 / pending Run@1 record pair, the submitted event
 *      with its writer-generated submission locator, and the LOCAL guards;
 *   5. ONE `records.commit(...)`. A thrown/lost response is recovered only from
 *      the exact identity/fingerprint lookup; an unconfirmable outcome is
 *      honestly `unavailable`.
 *
 * No SQL, no Map, no second repository, no whole-ledger horizon and no write to
 * Goal/Plan/Task/Session.
 */
import { commandIdentityKey } from '../../../contracts/command-event.js';
import type { ActorRef } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef, VersionPin } from '../../../contracts/core/identity.js';
import type { CoreError, CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { consultationQueryRefs, validQueryExecution } from '../../../contracts/query-job.js';
import type {
  QueryJobIntentV1,
  QueryJobRef,
  QueryJobSnapshot,
  QueryJobV1,
  QueryRunRef,
  QueryRunSnapshot,
  QueryRunV1,
} from '../../../contracts/query-job.js';
import type { GoalRef, GoalSnapshot, ProjectRef, ProjectSnapshot, WorkspaceRef, WorkspaceSnapshot } from '../../../contracts/ledger.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type {
  EncodedRecord,
  GoalRecordTransactionPort,
  PreparedCommit,
  RecordGuard,
  StoreCommitReceipt,
} from '../../record-store/ports.js';
import {
  canonicalRefKey,
  cloneActorRef,
  decodeGoalSnapshot,
  decodeProjectSnapshot,
  decodeWorkspaceSnapshot,
} from '../persistence/record-codecs.js';
import { sessionMessageRefKey } from '../communication/message-record-codecs.js';
import { decodePlanRevisionSnapshot, planRevisionRefKey } from '../tasks/plan-record-codecs.js';
import type { QueryJobDependencies, QueryJobPort } from './contracts.js';
import {
  decodeQueryJobSnapshot,
  decodeQueryJobSubmittedEvent,
  decodeQueryRunSnapshotRecord,
  encodeQueryJobSnapshot,
  encodeQueryJobSubmittedEvent,
  encodeQueryRunSnapshotRecord,
  type QueryJobSubmittedEventV1,
} from './query-record-codecs.js';

/** Storage-format prefix that keeps this identity apart from every other operation. */
export const QUERY_JOB_SUBMIT_IDENTITY_PREFIX = 'query-job-submit:';

const MAX_QUESTION_BYTES = 16 * 1024;
const MAX_FOCUS_REFS = 64;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reject(code: CoreError, reason: string, current?: VersionPin[]): CoreRejection {
  return current === undefined || current.length === 0
    ? { status: 'rejected', code, reason }
    : { status: 'rejected', code, reason, current };
}

/** Ownership of a caller-supplied request: one clone before any await. */
type Owned<T> = { status: 'owned'; value: T } | { status: 'invalid'; reason: string };

function ownInput<T>(value: T, what: string): Owned<T> {
  try {
    return { status: 'owned', value: structuredClone(value) };
  } catch (error) {
    return { status: 'invalid', reason: `${what} cannot be isolated from the caller: ${messageOf(error)}` };
  }
}

function jsonNormalize(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

// --------------------------------------------------------------------------
// Synchronous admission of the submit request
// --------------------------------------------------------------------------

type FocusTaskRef = { aggregateType: 'Task'; projectId: string; goalId: string; taskId: string };

type CallerPins = { project: number; workspace: number; goal: number };

type ConsultationBinding = { messageRef: SessionMessageRef; recipient: SessionRef; part?: 'response' };

type SubmitDraft = {
  projectId: string;
  workspaceId: string;
  goalId: string;
  queryJobId: string;
  runId: string;
  actor: ActorRef;
  requestId: string;
  intent: QueryJobIntentV1;
  focusRefs: FocusTaskRef[];
  pins: CallerPins;
  consultation: ConsultationBinding | null;
};

type PreparedSubmit = { status: 'ok'; draft: SubmitDraft } | { status: 'rejected'; rejection: CoreRejection };

type ExpectedNormalization = { status: 'ok'; pins: CallerPins } | { status: 'invalid'; reason: string };

/**
 * The caller pins are EXACTLY the Project/Workspace/Goal current revisions plus
 * the target QueryJob@0 and QueryRun@0. A missing, duplicate, extra or
 * other-scope pin is `invalid` before any lookup.
 */
function normalizeExpectedPins(
  raw: unknown,
  scope: { projectId: string; workspaceId: string; goalId: string; queryJobId: string; runId: string },
): ExpectedNormalization {
  if (!Array.isArray(raw)) return { status: 'invalid', reason: 'meta.expected must be an array of version pins' };
  const project: number[] = [];
  const workspace: number[] = [];
  const goal: number[] = [];
  let job = 0;
  let run = 0;
  for (const entry of raw) {
    if (!isRecord(entry)) return { status: 'invalid', reason: 'every version pin must be an object' };
    const revision = entry['revision'];
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
      return { status: 'invalid', reason: 'every version pin revision must be a safe non-negative integer' };
    }
    const ref = entry['ref'];
    if (!isRecord(ref)) return { status: 'invalid', reason: 'every version pin must carry a ref object' };
    switch (ref['aggregateType']) {
      case 'Project':
        if (ref['projectId'] !== scope.projectId) return { status: 'invalid', reason: 'a Project pin belongs to another project' };
        project.push(revision);
        break;
      case 'Workspace':
        if (ref['projectId'] !== scope.projectId || ref['workspaceId'] !== scope.workspaceId) {
          return { status: 'invalid', reason: 'a Workspace pin belongs to another scope' };
        }
        workspace.push(revision);
        break;
      case 'Goal':
        if (ref['projectId'] !== scope.projectId || ref['goalId'] !== scope.goalId) {
          return { status: 'invalid', reason: 'a Goal pin belongs to another scope' };
        }
        goal.push(revision);
        break;
      case 'QueryJob':
        if (ref['projectId'] !== scope.projectId || ref['workspaceId'] !== scope.workspaceId ||
            ref['queryJobId'] !== scope.queryJobId) {
          return { status: 'invalid', reason: 'a QueryJob pin is not the target QueryJob' };
        }
        if (revision !== 0) return { status: 'invalid', reason: 'the target QueryJob pin must be revision 0' };
        job += 1;
        break;
      case 'QueryRun':
        if (ref['projectId'] !== scope.projectId || ref['workspaceId'] !== scope.workspaceId ||
            ref['queryJobId'] !== scope.queryJobId || ref['runId'] !== scope.runId) {
          return { status: 'invalid', reason: 'a QueryRun pin is not the target QueryRun' };
        }
        if (revision !== 0) return { status: 'invalid', reason: 'the target QueryRun pin must be revision 0' };
        run += 1;
        break;
      default:
        return { status: 'invalid', reason: 'meta.expected accepts only the Project/Workspace/Goal/QueryJob/QueryRun pins' };
    }
  }
  if (project.length !== 1 || workspace.length !== 1 || goal.length !== 1 || job !== 1 || run !== 1) {
    return {
      status: 'invalid',
      reason: 'meta.expected must pin exactly the Project, Workspace, Goal, target QueryJob@0 and target QueryRun@0',
    };
  }
  return { status: 'ok', pins: { project: project[0]!, workspace: workspace[0]!, goal: goal[0]! } };
}

function prepareSubmit(ctx: CoreCallContext, request: unknown): PreparedSubmit {
  const owned = ownInput(request, 'submitQueryJob request');
  if (owned.status === 'invalid') return { status: 'rejected', rejection: reject('invalid', owned.reason) };
  if (!isRecord(owned.value)) return { status: 'rejected', rejection: reject('invalid', 'submitQueryJob request must be an object') };
  const input = owned.value['input'];
  const meta = owned.value['meta'];
  if (!isRecord(input)) return { status: 'rejected', rejection: reject('invalid', 'submitQueryJob requires an input object') };
  if (!isRecord(meta)) return { status: 'rejected', rejection: reject('invalid', 'submitQueryJob requires a request meta') };
  const queryJobId = input['queryJobId'];
  const runId = input['runId'];
  const intent = input['intent'];
  const requestId = meta['requestId'];
  if (!isNonEmptyString(queryJobId)) return { status: 'rejected', rejection: reject('invalid', 'queryJobId must be a non-empty string') };
  if (!isNonEmptyString(runId)) return { status: 'rejected', rejection: reject('invalid', 'runId must be a non-empty string') };
  if (!isRecord(intent)) return { status: 'rejected', rejection: reject('invalid', 'intent must be an object') };
  if (!isNonEmptyString(requestId)) return { status: 'rejected', rejection: reject('invalid', 'meta.requestId must be a non-empty string') };

  const bound = ctx as unknown as
    | { projectId?: unknown; workspaceId?: unknown; principal?: { kind?: unknown; actor?: unknown } }
    | null
    | undefined;
  if (bound === null || bound === undefined) {
    return { status: 'rejected', rejection: reject('forbidden', 'submitQueryJob requires a bound call context') };
  }
  const principal = bound.principal;
  if (principal === undefined || principal.kind !== 'host') {
    return {
      status: 'rejected',
      rejection: reject('forbidden', 'submitQueryJob requires a trusted Host human/system call context in this batch'),
    };
  }
  const projectId = bound.projectId;
  const workspaceId = bound.workspaceId;
  if (!isNonEmptyString(projectId) || !isNonEmptyString(workspaceId)) {
    return { status: 'rejected', rejection: reject('forbidden', 'submitQueryJob requires a bound project/workspace scope') };
  }
  const actor = principal.actor;
  if (!isRecord(actor) || (actor['kind'] !== 'human' && actor['kind'] !== 'system') || !isNonEmptyString(actor['id'])) {
    return { status: 'rejected', rejection: reject('forbidden', 'the Host actor must be a real human or system actor') };
  }

  if (intent['projectId'] !== projectId || intent['workspaceId'] !== workspaceId) {
    return { status: 'rejected', rejection: reject('forbidden', 'intent project/workspace does not match the Host call context') };
  }
  const goalId = intent['goalId'];
  if (goalId === null) return { status: 'rejected', rejection: reject('unsupported', 'this batch requires a real goalId') };
  if (!isNonEmptyString(goalId)) return { status: 'rejected', rejection: reject('invalid', 'intent.goalId must be a non-empty string') };
  if (intent['schemaVersion'] !== 1) return { status: 'rejected', rejection: reject('invalid', 'intent.schemaVersion must be 1') };
  // The intent id is bound to the ACTUAL job identity, not to meta.requestId.
  if (intent['intentId'] !== queryJobId) {
    return { status: 'rejected', rejection: reject('invalid', 'intent.intentId must equal the actual queryJobId') };
  }
  const question = intent['question'];
  if (typeof question !== 'string' || question.length === 0) {
    return { status: 'rejected', rejection: reject('invalid', 'intent.question must be non-empty') };
  }
  if (Buffer.byteLength(question, 'utf8') > MAX_QUESTION_BYTES) {
    return { status: 'rejected', rejection: reject('invalid', 'intent.question must be at most 16 KiB of UTF-8') };
  }
  if (!isNonEmptyString(intent['correlationId'])) {
    return { status: 'rejected', rejection: reject('invalid', 'intent.correlationId must be a non-empty string') };
  }
  const budget = intent['budget'];
  if (!isRecord(budget)) return { status: 'rejected', rejection: reject('invalid', 'intent.budget must be an object') };
  const maxTokens = budget['maxTokens'];
  // An explicit null budget means no cumulative Query token cap; a real number
  // must still be a positive safe integer (0/negative/non-integer stay invalid).
  if (maxTokens !== null && (typeof maxTokens !== 'number' || !Number.isSafeInteger(maxTokens) || maxTokens <= 0)) {
    return { status: 'rejected', rejection: reject('invalid', 'intent.budget.maxTokens must be null or a positive safe integer') };
  }
  const deadline = budget['deadline'];
  if (deadline !== null &&
      !(typeof deadline === 'string' && deadline.length > 0 && !Number.isNaN(Date.parse(deadline)))) {
    return { status: 'rejected', rejection: reject('invalid', 'intent.budget.deadline must be null or a valid time') };
  }
  const multiTurn = intent['multiTurn'];
  if (!isRecord(multiTurn)) return { status: 'rejected', rejection: reject('invalid', 'intent.multiTurn must be an object') };
  const maxRounds = multiTurn['maxRounds'];
  if (typeof maxRounds !== 'number' || !Number.isSafeInteger(maxRounds) || maxRounds < 1) {
    return { status: 'rejected', rejection: reject('invalid', 'intent.multiTurn.maxRounds must be a positive safe integer') };
  }
  if (maxRounds !== 1) return { status: 'rejected', rejection: reject('unsupported', 'this batch only accepts maxRounds=1') };

  const execution = intent['execution'];
  if (execution !== undefined) {
    if (!isRecord(execution)) return { status: 'rejected', rejection: reject('invalid', 'intent.execution must be an object when present') };
    if (execution['kind'] === 'execution_coordination') {
      return { status: 'rejected', rejection: reject('unsupported', 'execution_coordination is not delivered in this batch') };
    }
    if (execution['implementationAuthorization'] !== undefined) {
      return { status: 'rejected', rejection: reject('unsupported', 'implementationAuthorization is not delivered in this batch') };
    }
    if (!validQueryExecution(execution as unknown as QueryJobIntentV1['execution'])) {
      return { status: 'rejected', rejection: reject('invalid', 'intent.execution is not a valid execution binding shape') };
    }
    if (execution['kind'] !== 'initial_coordination' && execution['kind'] !== 'semantic_query') {
      return { status: 'rejected', rejection: reject('unsupported', 'this execution kind is not delivered in this batch') };
    }
  }
  let consultation: ConsultationBinding | null = null;
  if (execution !== undefined && isRecord(execution) && execution['consultation'] !== undefined) {
    // `validQueryExecution` already proved the exact binding shape; the only
    // remaining facts are the deterministic identity and the bound scope.
    const rawConsultation = execution['consultation'] as unknown as {
      messageRef: SessionMessageRef; recipient: SessionRef; part?: 'response';
    };
    const messageRef = rawConsultation.messageRef;
    if (messageRef.projectId !== projectId || messageRef.workspaceId !== workspaceId) {
      return { status: 'rejected', rejection: reject('forbidden', 'the consultation message is outside the Host call scope') };
    }
    if (rawConsultation.recipient.projectId !== projectId) {
      return { status: 'rejected', rejection: reject('forbidden', 'the consultation recipient is outside the Host call project') };
    }
    const refs = consultationQueryRefs(messageRef, rawConsultation.part);
    if (refs.queryJobRef.queryJobId !== queryJobId || refs.queryRunRef.runId !== runId) {
      return { status: 'rejected', rejection: reject('invalid', 'a consultation submit must use the deterministic identity of its message') };
    }
    const rawDerivation = (rawConsultation as { derivation?: unknown }).derivation;
    if (rawDerivation !== undefined) {
      const derivation = isRecord(rawDerivation) ? rawDerivation : null;
      const child = derivation === null ? null : derivation['childSessionRef'];
      const source = derivation === null ? null : derivation['sourceSessionRef'];
      if (child === null || source === null || !isRecord(child) || !isRecord(source)
        || child['projectId'] !== projectId || source['projectId'] !== projectId) {
        return { status: 'rejected', rejection: reject('forbidden', 'the consultation derivation Sessions are outside the bound project') };
      }
    }
    consultation = {
      messageRef: { ...messageRef },
      ...(rawConsultation.part === undefined ? {} : { part: rawConsultation.part }),
      recipient: { projectId: rawConsultation.recipient.projectId, sessionId: rawConsultation.recipient.sessionId },
    };
  }

  const rawFocus = intent['focusTaskRefs'];
  if (!Array.isArray(rawFocus)) return { status: 'rejected', rejection: reject('invalid', 'intent.focusTaskRefs must be an array') };
  if (rawFocus.length > MAX_FOCUS_REFS) {
    return { status: 'rejected', rejection: reject('invalid', 'intent.focusTaskRefs must contain at most 64 refs') };
  }
  const focusRefs: FocusTaskRef[] = [];
  const seenFocus = new Set<string>();
  for (const entry of rawFocus) {
    if (!isRecord(entry) || entry['aggregateType'] !== 'Task' ||
        !isNonEmptyString(entry['projectId']) || !isNonEmptyString(entry['goalId']) ||
        !isNonEmptyString(entry['taskId'])) {
      return { status: 'rejected', rejection: reject('invalid', 'every focusTaskRef must be a complete Task triple') };
    }
    const ref: FocusTaskRef = {
      aggregateType: 'Task',
      projectId: entry['projectId'],
      goalId: entry['goalId'],
      taskId: entry['taskId'],
    };
    if (ref.projectId !== projectId) return { status: 'rejected', rejection: reject('forbidden', 'a focusTaskRef belongs to another project') };
    if (ref.goalId !== goalId) return { status: 'rejected', rejection: reject('forbidden', 'a focusTaskRef belongs to another Goal') };
    const key = canonicalJson(ref as unknown as JsonValue);
    if (seenFocus.has(key)) return { status: 'rejected', rejection: reject('invalid', 'focusTaskRefs must not repeat a full task ref') };
    seenFocus.add(key);
    focusRefs.push(ref);
  }

  const expected = normalizeExpectedPins(meta['expected'], { projectId, workspaceId, goalId, queryJobId, runId });
  if (expected.status === 'invalid') return { status: 'rejected', rejection: reject('invalid', expected.reason) };

  return {
    status: 'ok',
    draft: {
      projectId,
      workspaceId,
      goalId,
      queryJobId,
      runId,
      actor: cloneActorRef(actor as ActorRef),
      requestId,
      intent: intent as unknown as QueryJobIntentV1,
      focusRefs,
      pins: expected.pins,
      consultation,
    },
  };
}

// --------------------------------------------------------------------------
// Fingerprint / identity
// --------------------------------------------------------------------------

function submitFingerprint(draft: SubmitDraft): string {
  return sha256Hex(canonicalJson({
    schemaVersion: 1,
    operation: 'query-job-submit',
    projectId: draft.projectId,
    workspaceId: draft.workspaceId,
    actor: jsonNormalize(draft.actor),
    queryJobId: draft.queryJobId,
    runId: draft.runId,
    intent: jsonNormalize(draft.intent),
    expected: {
      project: draft.pins.project,
      workspace: draft.pins.workspace,
      goal: draft.pins.goal,
      queryJob: 0,
      queryRun: 0,
    },
  }));
}

// --------------------------------------------------------------------------
// Receipt lookup / historical recovery
// --------------------------------------------------------------------------

type CommittedReceipt = Extract<StoreCommitReceipt, { status: 'committed' }>;

type ReceiptLookup =
  | { status: 'found'; receipt: CommittedReceipt }
  | { status: 'missing' }
  | { status: 'conflict'; reason: string }
  | { status: 'invalid'; reason: string }
  | { status: 'unavailable'; reason: string };

async function lookupReceipt(
  deps: QueryJobDependencies,
  identityKey: string,
  fingerprint: string,
): Promise<ReceiptLookup> {
  let found: Awaited<ReturnType<GoalRecordTransactionPort['lookupCommit']>>;
  try {
    found = await deps.records.lookupCommit({ identityKey, fingerprint });
  } catch (error) {
    return { status: 'unavailable', reason: `the idempotency lookup failed: ${messageOf(error)}` };
  }
  if (found.status === 'ready') return { status: 'found', receipt: found.value };
  switch (found.code) {
    case 'not_found':
      return { status: 'missing' };
    case 'idempotency_conflict':
      return { status: 'conflict', reason: found.reason };
    case 'invalid':
      return { status: 'invalid', reason: found.reason };
    default:
      return { status: 'unavailable', reason: `${found.code}: ${found.reason}` };
  }
}

type Recovery = { status: 'recovered'; record: { job: QueryJobSnapshot; run: QueryRunSnapshot } } | { status: 'unavailable'; reason: string };

/**
 * Rebuilds the ORIGINAL receipt pair from the recorded event only. The receipt
 * cursor locates exactly one QueryJobSubmitted event; the pending Run is
 * reconstructed from the fixed pending-submission semantics and the full
 * runRef, never from the current (possibly running/answered) Run.
 */
async function recoverOriginalRecord(
  deps: QueryJobDependencies,
  receipt: CommittedReceipt,
  identityKey: string,
  fingerprint: string,
  queryJobRef: QueryJobRef,
  queryRunRef: QueryRunRef,
): Promise<Recovery> {
  if (receipt.eventIds.length !== 1) {
    return { status: 'unavailable', reason: 'the original receipt does not reference exactly one event' };
  }
  let located: Awaited<ReturnType<GoalRecordTransactionPort['eventAt']>>;
  try {
    located = await deps.records.eventAt(receipt.cursor);
  } catch (error) {
    return { status: 'unavailable', reason: `the original event could not be read: ${messageOf(error)}` };
  }
  if (located.status !== 'ready') {
    return { status: 'unavailable', reason: `the original QueryJobSubmitted event is not readable: ${located.code}: ${located.reason}` };
  }
  if (String(located.value.cursor) !== String(receipt.cursor)) {
    return { status: 'unavailable', reason: 'eventAt returned a different cursor for the receipt' };
  }
  const decoded = decodeQueryJobSubmittedEvent(located.value.event);
  if (decoded.status !== 'decoded') {
    return { status: 'unavailable', reason: `the original event is not a legal QueryJobSubmitted@1: ${decoded.reason}` };
  }
  const event = decoded.value;
  if (event.eventId !== receipt.eventIds[0]) {
    return { status: 'unavailable', reason: 'the receipt points at another event' };
  }
  if (event.identityKey !== identityKey || event.fingerprint !== fingerprint) {
    return { status: 'unavailable', reason: 'the original event carries another submission identity' };
  }
  const job = event.payload.job;
  if (job.queryJobId !== queryJobRef.queryJobId || job.projectId !== queryJobRef.projectId ||
      job.workspaceId !== queryJobRef.workspaceId) {
    return { status: 'unavailable', reason: 'the original event belongs to another QueryJob scope' };
  }
  if (job.status !== 'pending' || job.answerRefs.length !== 0 || job.closeReason !== null) {
    return { status: 'unavailable', reason: 'the original event is not a pending submission' };
  }
  const runRef = job.runRef;
  if (runRef === null || runRef.projectId !== queryRunRef.projectId || runRef.workspaceId !== queryRunRef.workspaceId ||
      runRef.queryJobId !== queryRunRef.queryJobId || runRef.runId !== queryRunRef.runId) {
    return { status: 'unavailable', reason: 'the original event is not bound to this QueryRun' };
  }
  const run: QueryRunV1 = {
    schemaVersion: 1,
    queryJobRef: { ...queryJobRef },
    runId: queryRunRef.runId,
    status: 'pending',
    startedAt: null,
    endedAt: null,
    outcome: null,
  };
  const jobSnapshot: QueryJobSnapshot = {
    ref: { ...queryJobRef },
    revision: 1,
    schemaVersion: 1,
    job,
    submission: { schemaVersion: 1, identityKey: event.identityKey, fingerprint: event.fingerprint, eventId: event.eventId },
  };
  return {
    status: 'recovered',
    record: {
      job: jobSnapshot,
      run: { ref: { ...queryRunRef }, revision: 1, schemaVersion: 1, run },
    },
  };
}

async function committedFromReceipt(
  deps: QueryJobDependencies,
  receipt: CommittedReceipt,
  identityKey: string,
  fingerprint: string,
  queryJobRef: QueryJobRef,
  queryRunRef: QueryRunRef,
  replayed: boolean,
): Promise<WriteResult<{ job: QueryJobSnapshot; run: QueryRunSnapshot }>> {
  const recovered = await recoverOriginalRecord(deps, receipt, identityKey, fingerprint, queryJobRef, queryRunRef);
  if (recovered.status !== 'recovered') return reject('unavailable', recovered.reason);
  return { status: 'committed', value: recovered.record, replayed, cursor: receipt.cursor };
}

// --------------------------------------------------------------------------
// Exact scope/facts reads
// --------------------------------------------------------------------------

type DecodeOne<T> = { status: 'found'; value: T } | { status: 'missing' } | { status: 'unavailable'; reason: string };

function decodeOne<T>(
  key: string,
  present: ReadonlyMap<string, EncodedRecord>,
  missing: ReadonlySet<string>,
  decode: (record: EncodedRecord) => { status: 'decoded'; value: T } | { status: 'invalid'; reason: string },
): DecodeOne<T> {
  const record = present.get(key);
  if (record !== undefined) {
    const decoded = decode(record);
    if (decoded.status !== 'decoded') return { status: 'unavailable', reason: decoded.reason };
    return { status: 'found', value: decoded.value };
  }
  if (missing.has(key)) return { status: 'missing' };
  return { status: 'unavailable', reason: `the read batch neither returned nor reported missing ${key}` };
}

type ScopeFacts = { project: ProjectSnapshot; workspace: WorkspaceSnapshot; goal: GoalSnapshot };

type ScopeRead = { status: 'ready'; facts: ScopeFacts } | { status: 'rejected'; rejection: CoreRejection };

async function readScopeFacts(
  deps: QueryJobDependencies,
  projectKey: string,
  workspaceKey: string,
  goalKey: string,
): Promise<ScopeRead> {
  const read = await deps.records.readMany([projectKey, workspaceKey, goalKey]);
  if (read.status !== 'ready') {
    if (read.code === 'not_found') return { status: 'rejected', rejection: reject('not_found', read.reason) };
    return { status: 'rejected', rejection: reject('unavailable', `${read.code}: ${read.reason}`) };
  }
  const present = new Map<string, EncodedRecord>();
  for (const record of read.value.records) present.set(record.refKey, record);
  const missing = new Set(read.value.missing);

  const project = decodeOne(projectKey, present, missing, decodeProjectSnapshot);
  if (project.status === 'missing') return { status: 'rejected', rejection: reject('not_found', 'the Project does not exist') };
  if (project.status === 'unavailable') return { status: 'rejected', rejection: reject('unavailable', `the Project is not readable: ${project.reason}`) };
  const workspace = decodeOne(workspaceKey, present, missing, decodeWorkspaceSnapshot);
  if (workspace.status === 'missing') return { status: 'rejected', rejection: reject('not_found', 'the Workspace does not exist') };
  if (workspace.status === 'unavailable') return { status: 'rejected', rejection: reject('unavailable', `the Workspace is not readable: ${workspace.reason}`) };
  const goal = decodeOne(goalKey, present, missing, decodeGoalSnapshot);
  if (goal.status === 'missing') return { status: 'rejected', rejection: reject('not_found', 'the Goal does not exist') };
  if (goal.status === 'unavailable') return { status: 'rejected', rejection: reject('unavailable', `the Goal is not readable: ${goal.reason}`) };
  return { status: 'ready', facts: { project: project.value, workspace: workspace.value, goal: goal.value } };
}

function pinsFromCurrent(current: readonly { refKey: string; revision: number | null }[]): VersionPin[] {
  const pins: VersionPin[] = [];
  for (const entry of current) {
    if (entry.revision === null) continue;
    try {
      pins.push({ ref: JSON.parse(entry.refKey) as VersionPin['ref'], revision: entry.revision });
    } catch {
      // A non-JSON refKey cannot become a typed pin; the code/reason is still preserved.
    }
  }
  return pins;
}

// --------------------------------------------------------------------------
// Submit
// --------------------------------------------------------------------------

async function submit(
  deps: QueryJobDependencies,
  ctx: CoreCallContext,
  request: unknown,
): Promise<WriteResult<{ job: QueryJobSnapshot; run: QueryRunSnapshot }>> {
  const signal = (ctx as unknown as { signal?: AbortSignal } | null | undefined)?.signal;
  if (signal?.aborted) return reject('cancelled', 'submitQueryJob was cancelled before admission');

  const prepared = prepareSubmit(ctx, request);
  if (prepared.status === 'rejected') return prepared.rejection;
  const draft = prepared.draft;

  const queryJobRef: QueryJobRef = {
    aggregateType: 'QueryJob',
    projectId: draft.projectId,
    workspaceId: draft.workspaceId,
    queryJobId: draft.queryJobId,
  };
  const queryRunRef: QueryRunRef = {
    aggregateType: 'QueryRun',
    projectId: draft.projectId,
    workspaceId: draft.workspaceId,
    queryJobId: draft.queryJobId,
    runId: draft.runId,
  };
  const identity = { projectId: draft.projectId, actor: draft.actor, idempotencyKey: draft.requestId };
  const identityKey = `${QUERY_JOB_SUBMIT_IDENTITY_PREFIX}${commandIdentityKey(identity)}`;
  const fingerprint = submitFingerprint(draft);

  // (2) exact receipt lookup BEFORE any current-version read.
  const early = await lookupReceipt(deps, identityKey, fingerprint);
  if (early.status === 'found') {
    return committedFromReceipt(deps, early.receipt, identityKey, fingerprint, queryJobRef, queryRunRef, true);
  }
  if (early.status === 'conflict') return reject('idempotency_conflict', early.reason);
  if (early.status === 'invalid') return reject('invalid', early.reason);
  if (early.status === 'unavailable') return reject('unavailable', early.reason);
  if (signal?.aborted) return reject('cancelled', 'submitQueryJob was cancelled before reading the Goal');

  // (3) exact real facts.
  const projectKey = canonicalRefKey({ aggregateType: 'Project', projectId: draft.projectId } satisfies ProjectRef);
  const workspaceKey = canonicalRefKey({
    aggregateType: 'Workspace',
    projectId: draft.projectId,
    workspaceId: draft.workspaceId,
  } satisfies WorkspaceRef);
  const goalKey = canonicalRefKey({ aggregateType: 'Goal', projectId: draft.projectId, goalId: draft.goalId } satisfies GoalRef);

  const scope = await readScopeFacts(deps, projectKey, workspaceKey, goalKey);
  if (scope.status === 'rejected') return scope.rejection;
  const facts = scope.facts;
  if (facts.project.revision !== draft.pins.project || facts.workspace.revision !== draft.pins.workspace ||
      facts.goal.revision !== draft.pins.goal) {
    return reject('revision_conflict', 'the supplied version pins do not match the versions read in this call', [
      { ref: { aggregateType: 'Project', projectId: draft.projectId }, revision: facts.project.revision },
      { ref: { aggregateType: 'Workspace', projectId: draft.projectId, workspaceId: draft.workspaceId }, revision: facts.workspace.revision },
      { ref: { aggregateType: 'Goal', projectId: draft.projectId, goalId: draft.goalId }, revision: facts.goal.revision },
    ]);
  }
  if (facts.goal.workspaceRef.projectId !== draft.projectId || facts.goal.workspaceRef.workspaceId !== draft.workspaceId) {
    return reject('invalid', 'the Goal belongs to another workspace');
  }

  // (3a) an explicit consultation submit is admitted only through the injected
  // read-only mailbox seam: the original message, its actual body text and its
  // recipient are the real facts, never caller JSON. The exact message revision
  // the admission read is also carried into the ONE commit as a local guard, so
  // a concurrent reply/ack that landed after the read makes the submit lose the
  // CAS instead of creating a redundant Query/model run.
  let consultationMessageGuard: RecordGuard | null = null;
  if (draft.consultation !== null) {
    if (deps.consultations === undefined) {
      return reject('unsupported', 'a consultation submit requires the read-only mailbox dependency');
    }
    if (signal?.aborted) return reject('cancelled', 'submitQueryJob was cancelled before reading the consultation message');
    const messageRead = await deps.consultations.readMessage(ctx, draft.consultation.messageRef);
    if (messageRead.status === 'not_found') return reject('not_found', 'the consultation message does not exist');
    if (messageRead.status === 'not_ready') return reject('incomplete', 'the consultation message is not readable at the required watermark');
    if (messageRead.status !== 'ready') return messageRead;
    const message = messageRead.value;
    const target = draft.consultation.part === 'response'
      ? (message.sender.kind === 'work_run' ? message.sender.sessionRef : null) : message.recipient;
    if (target === null || target.projectId !== draft.consultation.recipient.projectId
      || target.sessionId !== draft.consultation.recipient.sessionId) {
      return reject('forbidden', 'the consultation recipient is not the original message recipient');
    }
    if (draft.consultation.part === 'response' ? message.response === null : message.status === 'responded') {
      return reject('invalid', 'the original consultation message already has a response');
    }
    const bodyRead = await deps.consultations.readMessageBody(ctx,
      { messageRef: draft.consultation.messageRef, part: draft.consultation.part ?? 'message' });
    if (bodyRead.status === 'not_found') return reject('not_found', 'the consultation message body does not exist');
    if (bodyRead.status === 'not_ready') return reject('incomplete', 'the consultation message body is not readable at the required watermark');
    if (bodyRead.status !== 'ready') return bodyRead;
    const originalInquiry = message.intent === 'inquiry' || (message.intent === undefined && message.replyMode === 'wait');
    if ((originalInquiry || draft.consultation.part === 'response') && bodyRead.value.text !== draft.intent.question) {
      return reject('invalid', 'the consultation question must be the original message body text');
    }
    consultationMessageGuard = { refKey: sessionMessageRefKey(message.ref), expectedRevision: message.revision };
  }

  const execution = draft.intent.execution;
  if (execution !== undefined && execution.kind === 'initial_coordination' && facts.goal.activePlanRevision !== null) {
    return reject('invalid', 'initial_coordination requires a Goal without an active Plan');
  }

  // (4a) non-empty focus proves exact membership in the Goal's CURRENT Plan.
  let planGuard: { refKey: string; revision: number } | null = null;
  if (draft.focusRefs.length > 0) {
    const activePlan: PlanRevisionRef | null = facts.goal.activePlanRevision;
    if (activePlan === null) {
      return reject('invalid', 'focusTaskRefs cannot be proven members of the Goal without an active Plan');
    }
    const planKey = planRevisionRefKey(activePlan);
    const planRead = await deps.records.readMany([planKey]);
    if (planRead.status !== 'ready') {
      return reject('unavailable', `the Goal active Plan is not readable: ${planRead.code}: ${planRead.reason}`);
    }
    const planRecord = planRead.value.records.find((record) => record.refKey === planKey);
    if (planRecord === undefined) {
      if (planRead.value.missing.includes(planKey)) return reject('invalid', 'the Goal active Plan is missing');
      return reject('unavailable', 'the read batch neither returned nor reported missing the Goal active Plan');
    }
    const decodedPlan = decodePlanRevisionSnapshot(planRecord);
    if (decodedPlan.status !== 'decoded') {
      return reject('unavailable', `the Goal active Plan is not decodable: ${decodedPlan.reason}`);
    }
    const memberIds = new Set(decodedPlan.value.tasks.map((task) => task.taskId));
    for (const ref of draft.focusRefs) {
      if (!memberIds.has(ref.taskId)) {
        return reject('invalid', `focusTaskRefs task ${ref.taskId} is not a member of the Goal active Plan`);
      }
    }
    planGuard = { refKey: planKey, revision: planRecord.revision };
  }

  if (signal?.aborted) return reject('cancelled', 'submitQueryJob was cancelled before commit');

  // (4b) compile the ONE pending pair + submitted event.
  const occurredAt = deps.now();
  const eventId = deps.eventId();
  const job: QueryJobV1 = {
    schemaVersion: 1,
    queryJobId: draft.queryJobId,
    projectId: draft.projectId,
    workspaceId: draft.workspaceId,
    goalId: draft.goalId,
    intent: draft.intent,
    status: 'pending',
    runRef: { ...queryRunRef },
    answerRefs: [],
    closeReason: null,
    submittedAt: occurredAt,
    updatedAt: occurredAt,
  };
  const jobSnapshot: QueryJobSnapshot = {
    ref: { ...queryJobRef },
    revision: 1,
    schemaVersion: 1,
    job,
    submission: { schemaVersion: 1, identityKey, fingerprint, eventId },
  };
  const run: QueryRunV1 = {
    schemaVersion: 1,
    queryJobRef: { ...queryJobRef },
    runId: draft.runId,
    status: 'pending',
    startedAt: null,
    endedAt: null,
    outcome: null,
  };
  const runSnapshot: QueryRunSnapshot = { ref: { ...queryRunRef }, revision: 1, schemaVersion: 1, run };
  const event: QueryJobSubmittedEventV1 = {
    eventId,
    eventType: 'QueryJobSubmitted',
    schemaVersion: 1,
    projectId: draft.projectId,
    workspaceId: draft.workspaceId,
    aggregateType: 'QueryJob',
    aggregateId: draft.queryJobId,
    aggregateRevision: 1,
    causationId: identityKey,
    correlationId: draft.intent.correlationId,
    idempotencyKey: draft.requestId,
    actor: cloneActorRef(draft.actor),
    occurredAt,
    identityKey,
    fingerprint,
    payload: { job },
  };

  const jobKey = canonicalJson(queryJobRef as unknown as JsonValue);
  const runKey = canonicalJson(queryRunRef as unknown as JsonValue);
  const guards: RecordGuard[] = [
    { refKey: projectKey, expectedRevision: facts.project.revision },
    { refKey: workspaceKey, expectedRevision: facts.workspace.revision },
    { refKey: goalKey, expectedRevision: facts.goal.revision },
    { refKey: jobKey, expectedRevision: null },
    { refKey: runKey, expectedRevision: null },
  ];
  if (planGuard !== null) guards.push({ refKey: planGuard.refKey, expectedRevision: planGuard.revision });
  if (consultationMessageGuard !== null) guards.push(consultationMessageGuard);

  const preparedCommit: PreparedCommit = {
    identityKey,
    fingerprint,
    guards,
    records: [encodeQueryJobSnapshot(jobSnapshot), encodeQueryRunSnapshotRecord(runSnapshot)],
    claims: [],
    indexGuards: [],
    indexChanges: [],
    events: [encodeQueryJobSubmittedEvent(event)],
  };

  // (5) the store re-looks-up, CASes, writes and commits. A successful commit is
  // never flipped to cancelled by an end-of-call signal.
  let committed: StoreCommitReceipt;
  try {
    committed = await deps.records.commit(preparedCommit);
  } catch (error) {
    // The commit may have succeeded and then lost its response: recover only
    // from the exact identity/fingerprint lookup, never by resubmitting.
    const recovered = await lookupReceipt(deps, identityKey, fingerprint);
    if (recovered.status === 'found') {
      return committedFromReceipt(deps, recovered.receipt, identityKey, fingerprint, queryJobRef, queryRunRef, true);
    }
    return reject('unavailable', `submitQueryJob commit failed and its receipt could not be confirmed: ${messageOf(error)}`);
  }
  if (committed.status === 'committed') {
    return committedFromReceipt(deps, committed, identityKey, fingerprint, queryJobRef, queryRunRef, committed.replayed);
  }
  switch (committed.code) {
    case 'revision_conflict':
      return reject('revision_conflict', committed.reason, pinsFromCurrent(committed.current));
    case 'idempotency_conflict':
      return reject('idempotency_conflict', committed.reason);
    case 'invalid':
      return reject('invalid', committed.reason);
    default:
      return reject('unavailable', `${committed.code}: ${committed.reason}`);
  }
}

// --------------------------------------------------------------------------
// Read
// --------------------------------------------------------------------------

function storeReadFailure(code: string, reason: string): CoreRejection {
  return reject('unavailable', `${code}: ${reason}`);
}

async function read(
  deps: QueryJobDependencies,
  ctx: CoreCallContext,
  ref: QueryJobRef,
): Promise<ReadResult<{ job: QueryJobSnapshot; run: QueryRunSnapshot }>> {
  const bound = ctx as unknown as
    | { projectId?: unknown; workspaceId?: unknown; principal?: { kind?: unknown } }
    | null
    | undefined;
  if (bound === null || bound === undefined) return reject('forbidden', 'readQueryJob requires a bound call context');
  if (bound.principal === undefined || bound.principal.kind !== 'host') {
    return reject('forbidden', 'readQueryJob is a Host-scope exact read in this batch');
  }
  if (ref === null || ref === undefined || ref.aggregateType !== 'QueryJob' ||
      !isNonEmptyString(ref.projectId) || !isNonEmptyString(ref.workspaceId) || !isNonEmptyString(ref.queryJobId)) {
    return reject('invalid', 'readQueryJob requires a complete QueryJobRef');
  }
  if (bound.projectId !== ref.projectId || bound.workspaceId !== ref.workspaceId) {
    return reject('forbidden', 'the QueryJob ref is outside the Host call scope');
  }

  const jobKey = canonicalJson(ref as unknown as JsonValue);
  const jobRead = await deps.records.readMany([jobKey]);
  if (jobRead.status !== 'ready') {
    if (jobRead.code === 'not_found') return { status: 'not_found' };
    return storeReadFailure(jobRead.code, jobRead.reason);
  }
  const jobRecord = jobRead.value.records.find((record) => record.refKey === jobKey);
  if (jobRecord === undefined) {
    if (jobRead.value.missing.includes(jobKey)) return { status: 'not_found' };
    return reject('unavailable', 'the read batch neither returned nor reported missing the QueryJob');
  }
  const decodedJob = decodeQueryJobSnapshot(jobRecord);
  if (decodedJob.status !== 'decoded') {
    return reject('unavailable', `the QueryJob snapshot is not decodable: ${decodedJob.reason}`);
  }
  const jobSnapshot = decodedJob.value;
  const runRef = jobSnapshot.job.runRef;
  if (runRef === null) return reject('incomplete', 'the QueryJob has no run ref');

  const runKey = canonicalJson(runRef as unknown as JsonValue);
  const runRead = await deps.records.readMany([runKey]);
  if (runRead.status !== 'ready') {
    if (runRead.code === 'not_found') return reject('incomplete', 'the QueryJob run is missing');
    return storeReadFailure(runRead.code, runRead.reason);
  }
  const runRecord = runRead.value.records.find((record) => record.refKey === runKey);
  if (runRecord === undefined) {
    if (runRead.value.missing.includes(runKey)) return reject('incomplete', 'the QueryJob run is missing');
    return reject('unavailable', 'the read batch neither returned nor reported missing the QueryRun');
  }
  const decodedRun = decodeQueryRunSnapshotRecord(runRecord);
  if (decodedRun.status !== 'decoded') {
    return reject('unavailable', `the QueryRun snapshot is not decodable: ${decodedRun.reason}`);
  }
  return { status: 'ready', value: { job: jobSnapshot, run: decodedRun.value } };
}

// --------------------------------------------------------------------------
// The port
// --------------------------------------------------------------------------

/**
 * Stage-one Query execution seam: without the injected internal writer only the
 * NEW Query methods are unsupported; pending submit/read keep their behavior.
 */
function queryExecutionAbsent(operation: string): CoreRejection {
  return {
    status: 'rejected',
    code: 'unsupported',
    reason: `${operation} requires the trusted QueryExecutionPort (stage-one skeleton)`,
  };
}

export function createQueryJobService(deps: QueryJobDependencies): QueryJobPort {
  return {
    submitQueryJob: (ctx, request) => submit(deps, ctx, request),
    readQueryJob: (ctx, ref) => read(deps, ctx, ref),
    async claimQuery(ctx, request) {
      if (deps.execution === undefined) return queryExecutionAbsent('claimQuery');
      return deps.execution.claimQuery(ctx, request);
    },
    async readQueryAnswer(ctx, ref) {
      if (deps.execution === undefined) return queryExecutionAbsent('readQueryAnswer');
      return deps.execution.readQueryAnswer(ctx, ref);
    },
  };
}
