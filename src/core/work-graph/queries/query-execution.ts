/**
 * R5b.2 Query execution writer.
 *
 * This is the ONE Query domain writer that owns claim/prepare/entry/model
 * request/usage/terminal/answer facts over the SAME records and Session the
 * Goal/Plan writers use. It is created by the composition root with the exact
 * real dependencies (`records`, `roles`, `bodies`, trusted Host projection,
 * clock/id) and injected into the QueryJob claim/read adapter and the Runtime
 * thin path. It is deliberately NOT published as a platform public terminal
 * interface, so a Host request can never submit terminal JSON.
 *
 * Every write commits one `QueryExecutionRecorded` event that carries the
 * writer-generated `identityKey`/`fingerprint` AND the immutable original
 * `payload.result`. A replayed write is restored from that event via
 * `lookupCommit -> eventAt`; it is never rebuilt from the later current
 * Job/Run/Session snapshot.
 */
import type { ArtifactRef } from '../../../contracts/artifact.js';
import type { ActorRef } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef, VersionPin } from '../../../contracts/core/identity.js';
import type { PreparedQueryExecution, PreparedQueryManifestV1 } from '../../../contracts/core/prepared-execution.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { GoalSnapshot, WorkspaceSnapshot } from '../../../contracts/ledger.js';
import type { PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type { RuntimeBudget } from '../../../contracts/runtime-budget.js';
import type {
  QueryExecutionStateV1, QueryJobAnswerRef, QueryJobAnswerSnapshot, QueryJobRef,
  QueryJobSnapshot, QueryJobV1, QueryModelRequestV1, QueryModelUsageV1, QueryRunRef, QueryRunSnapshot, QueryRunV1,
} from '../../../contracts/query-job.js';
import type { RawArtifactRecord } from '../../record-store/body-ports.js';
import type {
  EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordGuard, StoreCommitReceipt,
} from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import { canonicalRefKey, decodeGoalSnapshot, decodeWorkspaceSnapshot } from '../persistence/record-codecs.js';
import { decodePlanRevisionSnapshot, planRevisionRefKey } from '../tasks/plan-record-codecs.js';
import {
  decodeSessionRecord, encodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey,
} from '../sessions/session-record-codecs.js';
import {
  decodeQueryExecutionRecordedEvent, decodeQueryJobAnswerSnapshot, decodeQueryJobSnapshot,
  decodeQueryJobSubmittedEvent, decodeQueryRunSnapshotRecord, encodeQueryExecutionRecordedEvent,
  encodeQueryJobAnsweredEvent, encodeQueryJobAnswerSnapshot, encodeQueryJobSnapshot,
  encodeQueryRunSnapshotRecord, type QueryExecutionOperation, type QueryExecutionRecordedEventV1,
} from './query-record-codecs.js';
import type {
  QueryEntryIdentity, QueryEntryTicket, QueryExecutionDependencies, QueryExecutionPort,
  QueryExecutionRecord, QueryHistoryObservation, QueryPreparationFacts,
} from './contracts.js';
import type { GraphWrite } from '../tasks/contracts.js';

/** Exact manifest content type; the writer re-reads the body and requires this. */
export const QUERY_MANIFEST_CONTENT_TYPE = 'application/vnd.coding-platform.query-execution-manifest+json;version=1';

type HostActor = Extract<ActorRef, { kind: 'human' | 'system' }>;
type Core = { job: QueryJobSnapshot; run: QueryRunSnapshot; session: SessionRecord };

function rejected(code: CoreRejection['code'], reason: string, current?: VersionPin[]): CoreRejection {
  return current === undefined || current.length === 0
    ? { status: 'rejected', code, reason }
    : { status: 'rejected', code, reason, current };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function sameRef(left: unknown, right: unknown): boolean {
  try { return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue); } catch { return false; }
}
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function mapRead(result: ReadResult<unknown>): CoreRejection {
  if (result.status === 'ready') return rejected('unavailable', 'a must-fail read unexpectedly returned a value');
  if (result.status === 'not_found') return rejected('not_found', 'the required Query fact was not found');
  if (result.status === 'not_ready') return rejected('incomplete', 'the required Query fact is not readable at the required watermark');
  return { status: 'rejected', code: result.code, reason: result.reason, ...(result.current === undefined ? {} : { current: result.current }) };
}
function toRejection(result: ReadResult<unknown>): CoreRejection {
  if (result.status === 'ready') return rejected('unavailable', 'a must-fail read unexpectedly returned a value');
  if (result.status === 'not_found') return rejected('not_found', 'the required Query fact was not found');
  if (result.status === 'not_ready') return rejected('incomplete', 'the required Query fact is not readable at the required watermark');
  return result;
}
function ownContext(ctx: CoreCallContext): CoreCallContext | null {
  try {
    return {
      projectId: ctx.projectId,
      principal: structuredClone(ctx.principal),
      materialReader: structuredClone(ctx.materialReader),
      signal: ctx.signal,
      ...(typeof ctx.workspaceId === 'string' ? { workspaceId: ctx.workspaceId } : {}),
    };
  } catch { return null; }
}
function hostActor(ctx: CoreCallContext): HostActor | null {
  const principal = ctx.principal;
  if (principal.kind !== 'host') return null;
  return principal.actor;
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
function mapCommitFailure(receipt: Extract<StoreCommitReceipt, { status: 'rejected' }>): CoreRejection {
  switch (receipt.code) {
    case 'revision_conflict':
      return rejected('revision_conflict', receipt.reason, pinsFromCurrent(receipt.current));
    case 'idempotency_conflict':
      return rejected('idempotency_conflict', receipt.reason);
    case 'invalid':
      return rejected('invalid', receipt.reason);
    default:
      return rejected('unavailable', `${receipt.code}: ${receipt.reason}`);
  }
}

/** Exact operation identity: one per trusted actor/scope/request id. */
function operationIdentity(operation: QueryExecutionOperation, actor: HostActor, queryRunRef: QueryRunRef, requestId: string): string {
  return `r5b-query-execution:${operation}:` + sha256Hex(canonicalJson({
    schemaVersion: 1, operation, projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId,
    actor: { kind: actor.kind, id: actor.id }, requestId,
  } as JsonValue));
}
function fingerprintOf(operation: QueryExecutionOperation, content: unknown): string {
  return sha256Hex(canonicalJson({ schemaVersion: 1, operation, content } as unknown as JsonValue));
}
function queryJobRefFor(queryRunRef: QueryRunRef): QueryJobRef {
  return { aggregateType: 'QueryJob', projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId, queryJobId: queryRunRef.queryJobId };
}
function queryRunRefKey(ref: QueryRunRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}
function queryJobRefKey(ref: QueryJobRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}
function queryJobAnswerRefKey(ref: QueryJobAnswerRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}
function sessionKeyOf(ref: SessionRecord['ref']): string {
  return sessionAggregateRefKey(ref);
}
function safeRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

// --------------------------------------------------------------------------
// Exact reads
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

async function readCore(
  deps: QueryExecutionDependencies,
  queryRunRef: QueryRunRef,
  sessionRef: SessionRef | null,
): Promise<ReadResult<Core>> {
  const jobKey = queryJobRefKey(queryJobRefFor(queryRunRef));
  const runKey = queryRunRefKey(queryRunRef);
  const keys = sessionRef === null ? [jobKey, runKey] : [jobKey, runKey, sessionKeyOf(plainSessionRefToAggregate(sessionRef))];
  let read;
  try {
    read = await deps.records.readMany(keys);
  } catch (error) {
    return rejected('unavailable', `the Query records read failed: ${messageOf(error)}`);
  }
  if (read.status !== 'ready') {
    return read.code === 'not_found' ? { status: 'not_found' } : rejected('unavailable', `${read.code}: ${read.reason}`);
  }
  const present = new Map<string, EncodedRecord>();
  for (const record of read.value.records) present.set(record.refKey, record);
  const missing = new Set(read.value.missing);
  const job = decodeOne(jobKey, present, missing, decodeQueryJobSnapshot);
  if (job.status === 'missing') return { status: 'not_found' };
  if (job.status === 'unavailable') return rejected('unavailable', `the QueryJob is not readable: ${job.reason}`);
  const run = decodeOne(runKey, present, missing, decodeQueryRunSnapshotRecord);
  if (run.status === 'missing') return rejected('incomplete', 'the QueryRun is missing');
  if (run.status === 'unavailable') return rejected('unavailable', `the QueryRun is not readable: ${run.reason}`);
  if (sessionRef === null) {
    const state = run.value.run.executionState;
    if (state === undefined) return rejected('incomplete', 'the QueryRun has no persisted Session binding');
    return readCore(deps, queryRunRef, state.sessionRef);
  }
  const session = decodeOne(sessionKeyOf(plainSessionRefToAggregate(sessionRef)), present, missing, decodeSessionRecord);
  if (session.status === 'missing') return { status: 'not_found' };
  if (session.status === 'unavailable') return rejected('unavailable', `the Session is not readable: ${session.reason}`);
  return { status: 'ready', value: { job: job.value, run: run.value, session: session.value } };
}

async function readAnswerByRef(deps: QueryExecutionDependencies, ref: QueryJobAnswerRef): Promise<ReadResult<QueryJobAnswerSnapshot>> {
  const key = queryJobAnswerRefKey(ref);
  let read;
  try {
    read = await deps.records.readMany([key]);
  } catch (error) {
    return rejected('unavailable', `the Query answer read failed: ${messageOf(error)}`);
  }
  if (read.status !== 'ready') {
    return read.code === 'not_found' ? { status: 'not_found' } : rejected('unavailable', `${read.code}: ${read.reason}`);
  }
  const record = read.value.records.find((candidate) => candidate.refKey === key);
  if (record === undefined) {
    if (read.value.missing.includes(key)) return { status: 'not_found' };
    return rejected('unavailable', 'the read batch neither returned nor reported missing the Query answer');
  }
  const decoded = decodeQueryJobAnswerSnapshot(record);
  if (decoded.status !== 'decoded') return rejected('unavailable', `the Query answer snapshot is not decodable: ${decoded.reason}`);
  return { status: 'ready', value: decoded.value };
}

async function readExecutionRecord(deps: QueryExecutionDependencies, queryRunRef: QueryRunRef): Promise<ReadResult<QueryExecutionRecord>> {
  const core = await readCore(deps, queryRunRef, null);
  if (core.status !== 'ready') return core;
  const answerRef = core.value.job.job.answerRefs.at(-1);
  let answer: QueryJobAnswerSnapshot | null = null;
  if (answerRef !== undefined) {
    const read = await readAnswerByRef(deps, answerRef);
    if (read.status !== 'ready') return toRejection(read);
    answer = read.value;
  }
  return { status: 'ready', value: { job: core.value.job, run: core.value.run, session: core.value.session, answer } };
}

/** The exact original initiator: read from the Job's own locator, never a scan
 * and never a fixed system actor. */
async function readInitiator(deps: QueryExecutionDependencies, job: QueryJobSnapshot): Promise<ReadResult<HostActor>> {
  const submission = job.submission;
  if (submission === undefined) return rejected('unsupported', 'the QueryJob has no exact submission locator');
  let found;
  try {
    found = await deps.records.lookupCommit({ identityKey: submission.identityKey, fingerprint: submission.fingerprint });
  } catch (error) {
    return rejected('unavailable', `the submission idempotency lookup failed: ${messageOf(error)}`);
  }
  if (found.status !== 'ready') {
    return found.code === 'not_found'
      ? rejected('not_found', 'the original QueryJob submission was not found')
      : rejected('unavailable', `${found.code}: ${found.reason}`);
  }
  let located;
  try {
    located = await deps.records.eventAt(found.value.cursor);
  } catch (error) {
    return rejected('unavailable', `the original QueryJobSubmitted event could not be read: ${messageOf(error)}`);
  }
  if (located.status !== 'ready') return rejected('unavailable', `the original QueryJobSubmitted event is not readable: ${located.code}: ${located.reason}`);
  const decoded = decodeQueryJobSubmittedEvent(located.value.event);
  if (decoded.status !== 'decoded') return rejected('unavailable', `the original event is not a legal QueryJobSubmitted@1: ${decoded.reason}`);
  const event = decoded.value;
  if (event.identityKey !== submission.identityKey || event.fingerprint !== submission.fingerprint) {
    return rejected('unavailable', 'the original submission identity disagrees with the Job locator');
  }
  const actor = event.actor;
  if (actor.kind !== 'human' && actor.kind !== 'system') return rejected('unsupported', 'the original Query initiator kind is unsupported');
  return { status: 'ready', value: { kind: actor.kind, id: actor.id } };
}

async function readPreparationFacts(deps: QueryExecutionDependencies, queryRunRef: QueryRunRef): Promise<ReadResult<QueryPreparationFacts>> {
  const record = await readExecutionRecord(deps, queryRunRef);
  if (record.status !== 'ready') return record;
  const state = record.value.run.run.executionState;
  if (state === undefined) return rejected('incomplete', 'the QueryRun has no persisted execution state');
  const goalId = record.value.job.job.goalId;
  if (goalId === null) return rejected('incomplete', 'the QueryJob has no Goal');
  const goalKey = canonicalRefKey({ aggregateType: 'Goal', projectId: queryRunRef.projectId, goalId });
  let read;
  try {
    read = await deps.records.readMany([goalKey]);
  } catch (error) {
    return rejected('unavailable', `the Query Goal read failed: ${messageOf(error)}`);
  }
  if (read.status !== 'ready') return read.code === 'not_found' ? { status: 'not_found' } : rejected('unavailable', `${read.code}: ${read.reason}`);
  const goalRecord = read.value.records.find((candidate) => candidate.refKey === goalKey);
  if (goalRecord === undefined) {
    return read.value.missing.includes(goalKey) ? { status: 'not_found' } : rejected('unavailable', 'the Goal read was not reported');
  }
  const decodedGoal = decodeGoalSnapshot(goalRecord);
  if (decodedGoal.status !== 'decoded') return rejected('unavailable', `the Goal snapshot is not decodable: ${decodedGoal.reason}`);
  const goal: GoalSnapshot = decodedGoal.value;
  const workspaceKey = canonicalRefKey(goal.workspaceRef);
  let workspaceRead;
  try {
    workspaceRead = await deps.records.readMany([workspaceKey]);
  } catch (error) {
    return rejected('unavailable', `the Query Workspace read failed: ${messageOf(error)}`);
  }
  if (workspaceRead.status !== 'ready') return workspaceRead.code === 'not_found' ? { status: 'not_found' } : rejected('unavailable', `${workspaceRead.code}: ${workspaceRead.reason}`);
  const workspaceRecord = workspaceRead.value.records.find((candidate) => candidate.refKey === workspaceKey);
  if (workspaceRecord === undefined) {
    return workspaceRead.value.missing.includes(workspaceKey) ? { status: 'not_found' } : rejected('unavailable', 'the Workspace read was not reported');
  }
  const decodedWorkspace = decodeWorkspaceSnapshot(workspaceRecord);
  if (decodedWorkspace.status !== 'decoded') return rejected('unavailable', `the Workspace snapshot is not decodable: ${decodedWorkspace.reason}`);
  const workspace: WorkspaceSnapshot = decodedWorkspace.value;

  let focusPlan: PlanRevisionSnapshot | null = null;
  if (record.value.job.job.intent.focusTaskRefs.length > 0) {
    const activePlan = goal.activePlanRevision;
    if (activePlan === null) return rejected('invalid', 'the Query focus is not provable without an active Plan');
    const planKey = planRevisionRefKey(activePlan);
    let planRead;
    try {
      planRead = await deps.records.readMany([planKey]);
    } catch (error) {
      return rejected('unavailable', `the Query focus Plan read failed: ${messageOf(error)}`);
    }
    if (planRead.status !== 'ready') return planRead.code === 'not_found' ? { status: 'not_found' } : rejected('unavailable', `${planRead.code}: ${planRead.reason}`);
    const planRecord = planRead.value.records.find((candidate) => candidate.refKey === planKey);
    if (planRecord === undefined) return rejected('unavailable', 'the Query focus Plan was not reported');
    const decodedPlan = decodePlanRevisionSnapshot(planRecord);
    if (decodedPlan.status !== 'decoded') return rejected('unavailable', `the focus Plan is not decodable: ${decodedPlan.reason}`);
    focusPlan = decodedPlan.value;
  }
  const initiator = await readInitiator(deps, record.value.job);
  if (initiator.status !== 'ready') return initiator;
  return { status: 'ready', value: { record: record.value, goal, workspace, focusPlan, initiator: initiator.value } };
}

// --------------------------------------------------------------------------
// Manifest re-read
// --------------------------------------------------------------------------

function loadQueryManifest(
  bodies: QueryExecutionDependencies['bodies'],
  prepared: PreparedQueryExecution,
): Promise<ReadResult<{ manifest: PreparedQueryManifestV1; bundleRef: ArtifactRef }>> {
  return (async () => {
    if (!isRecord(prepared) || !isRecord(prepared.bundleRef) || !nonEmpty(prepared.bundleRef.digest)
      || !Number.isSafeInteger(prepared.bundleRef.sizeBytes) || !nonEmpty(prepared.bundleRef.contentType)) {
      return rejected('invalid', 'the Prepared Query value is incomplete');
    }
    const bundleRef = prepared.bundleRef;
    if (bundleRef.contentType !== QUERY_MANIFEST_CONTENT_TYPE) {
      return rejected('invalid', 'the Prepared Query envelope does not reference a bounded Query manifest body');
    }
    let stored;
    try {
      stored = await bodies.read(bundleRef);
    } catch (error) {
      return rejected('unavailable', `reading the Query manifest failed: ${messageOf(error)}`);
    }
    if (stored.status !== 'ready') return rejected('invalid', 'the Query manifest body is not readable');
    const record: RawArtifactRecord = stored.value;
    if (record.ref.contentType !== bundleRef.contentType || record.ref.digest !== bundleRef.digest || record.ref.sizeBytes !== bundleRef.sizeBytes) {
      return rejected('invalid', 'the stored Query manifest reference disagrees with the Prepared envelope');
    }
    if (sha256Hex(record.body) !== bundleRef.digest || Buffer.byteLength(record.body, 'utf8') !== bundleRef.sizeBytes) {
      return rejected('invalid', 'the stored Query manifest bytes do not match their content digest');
    }
    if (record.origin.kind !== 'run' || !sameRef(record.origin.owner, prepared.queryRunRef)) {
      return rejected('forbidden', 'the stored Query manifest is not owned by this QueryRun');
    }
    let parsed: unknown;
    try { parsed = JSON.parse(record.body); } catch { return rejected('invalid', 'the Query manifest is not valid JSON'); }
    if (!isRecord(parsed) || parsed['schemaVersion'] !== 1 || parsed['kind'] !== 'query_execution'
      || !isRecord(parsed['queryRunRef']) || typeof parsed['input'] !== 'string' || !nonEmpty(parsed['inputDigest'])) {
      return rejected('invalid', 'the Query manifest is not a complete query-execution manifest');
    }
    const manifest = parsed as unknown as PreparedQueryManifestV1;
    if (!sameRef(manifest.queryRunRef, prepared.queryRunRef)) return rejected('invalid', 'the Query manifest disagrees with the requested QueryRun');
    if (sha256Hex(manifest.input) !== manifest.inputDigest) return rejected('invalid', 'the Query manifest input digest is not the digest of its input');
    if (manifest.inputDigest !== prepared.inputDigest) return rejected('invalid', 'the Query manifest digest disagrees with the Prepared value');
    return { status: 'ready', value: { manifest, bundleRef } };
  })();
}

// --------------------------------------------------------------------------
// Commit / replay
// --------------------------------------------------------------------------

type QueryEventResult = QueryExecutionRecord | QueryEntryTicket | QueryRunSnapshot;

function buildRecordedEvent(input: {
  eventId: string;
  identityKey: string;
  fingerprint: string;
  actor: HostActor;
  occurredAt: string;
  queryRunRef: QueryRunRef;
  requestId: string;
  correlationId: string;
  aggregateRevision: number;
  operation: QueryExecutionOperation;
  result: QueryEventResult;
  phase: QueryExecutionStateV1['phase'];
  executionState: QueryExecutionStateV1 | null;
}): QueryExecutionRecordedEventV1 {
  return {
    eventId: input.eventId,
    eventType: 'QueryExecutionRecorded',
    schemaVersion: 1,
    identityKey: input.identityKey,
    fingerprint: input.fingerprint,
    projectId: input.queryRunRef.projectId,
    workspaceId: input.queryRunRef.workspaceId,
    aggregateType: 'QueryRun',
    aggregateId: input.queryRunRef.runId,
    aggregateRevision: input.aggregateRevision,
    causationId: input.identityKey,
    correlationId: input.correlationId,
    idempotencyKey: input.requestId,
    actor: { ...input.actor },
    occurredAt: input.occurredAt,
    payload: {
      queryRunRef: { ...input.queryRunRef },
      operation: input.operation,
      result: input.result,
      phase: input.phase,
      executionState: input.executionState === null ? null : structuredClone(input.executionState),
    },
  };
}

async function loadRecordedResult<T extends QueryEventResult>(
  deps: QueryExecutionDependencies,
  receipt: Extract<StoreCommitReceipt, { status: 'committed' }>,
  identityKey: string,
  fingerprint: string,
  operation: QueryExecutionOperation,
): Promise<WriteResult<T> | null> {
  let located;
  try {
    located = await deps.records.eventAt(receipt.cursor);
  } catch {
    return null;
  }
  if (located.status !== 'ready') return null;
  if (String(located.value.cursor) !== String(receipt.cursor)) return null;
  const decoded = decodeQueryExecutionRecordedEvent(located.value.event);
  if (decoded.status !== 'decoded') return null;
  const event = decoded.value;
  if (event.identityKey !== identityKey || event.fingerprint !== fingerprint) return null;
  if (event.eventId !== receipt.eventIds[0]) return null;
  if (event.payload.operation !== operation) return null;
  return { status: 'committed', value: event.payload.result as T, replayed: true, cursor: receipt.cursor };
}

async function commitOperation<T extends QueryEventResult>(input: {
  deps: QueryExecutionDependencies;
  identityKey: string;
  fingerprint: string;
  guards: readonly RecordGuard[];
  records: readonly EncodedRecord[];
  events: readonly import('../../record-store/ports.js').EncodedDomainEvent[];
  value: T;
  operation: QueryExecutionOperation;
}): Promise<WriteResult<T>> {
  const prepared: PreparedCommit = {
    identityKey: input.identityKey,
    fingerprint: input.fingerprint,
    guards: input.guards,
    records: input.records,
    claims: [],
    indexGuards: [],
    indexChanges: [],
    events: input.events,
  };
  let receipt: StoreCommitReceipt;
  try {
    receipt = await input.deps.records.commit(prepared);
  } catch (error) {
    const recovered = await input.deps.records.lookupCommit({ identityKey: input.identityKey, fingerprint: input.fingerprint });
    if (recovered.status === 'ready') {
      const replayed = await loadRecordedResult<T>(input.deps, recovered.value, input.identityKey, input.fingerprint, input.operation);
      if (replayed !== null) return replayed;
    }
    return rejected('unavailable', `the Query ${input.operation} commit failed and its receipt could not be confirmed: ${messageOf(error)}`);
  }
  if (receipt.status !== 'committed') return mapCommitFailure(receipt);
  if (receipt.replayed) {
    const replayed = await loadRecordedResult<T>(input.deps, receipt, input.identityKey, input.fingerprint, input.operation);
    if (replayed === null) return rejected('unavailable', `the replayed Query ${input.operation} receipt is not readable`);
    return replayed;
  }
  return { status: 'committed', value: input.value, replayed: false, cursor: receipt.cursor };
}

function mergeGuards(guards: readonly RecordGuard[]): RecordGuard[] {
  const map = new Map<string, number | null>();
  for (const guard of guards) {
    const existing = map.get(guard.refKey);
    if (existing === undefined || (existing === null && guard.expectedRevision !== null)) map.set(guard.refKey, guard.expectedRevision);
  }
  return [...map].map(([refKey, expectedRevision]) => ({ refKey, expectedRevision }));
}

// --------------------------------------------------------------------------
// Original-request expected pins, identity/fingerprint and replay
// --------------------------------------------------------------------------

type ExpectedPins = { job: number | null; run: number | null; session: number | null };

type ExpectedRefs = { projectId: string; workspaceId: string; queryJobId: string; runId: string };

/**
 * The caller's `meta.expected` is the EXACT set of record versions this
 * operation consumes. A missing, repeated, extra or other-scope pin is invalid
 * before any lookup. The returned pins are part of the operation fingerprint and
 * become the fresh transaction's CAS guards.
 */
function validateExpected(
  raw: unknown,
  refs: ExpectedRefs,
  required: { job: boolean; run: boolean; session: boolean },
): { status: 'ok'; job: number | null; run: number | null; session: number | null; sessionId: string | null } | { status: 'invalid'; reason: string } {
  if (!Array.isArray(raw)) return { status: 'invalid', reason: 'meta.expected must be an array of version pins' };
  let job: number | null = null;
  let run: number | null = null;
  let session: number | null = null;
  let sessionId: string | null = null;
  for (const entry of raw) {
    if (!isRecord(entry)) return { status: 'invalid', reason: 'every version pin must be an object' };
    const revision = entry['revision'];
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
      return { status: 'invalid', reason: 'every version pin revision must be a safe non-negative integer' };
    }
    const ref = entry['ref'];
    if (!isRecord(ref)) return { status: 'invalid', reason: 'every version pin must carry a ref object' };
    if (ref['aggregateType'] === 'QueryJob') {
      if (ref['projectId'] !== refs.projectId || ref['workspaceId'] !== refs.workspaceId || ref['queryJobId'] !== refs.queryJobId) {
        return { status: 'invalid', reason: 'a QueryJob pin belongs to another scope' };
      }
      if (job !== null) return { status: 'invalid', reason: 'meta.expected repeats the QueryJob pin' };
      job = revision;
    } else if (ref['aggregateType'] === 'QueryRun') {
      if (ref['projectId'] !== refs.projectId || ref['workspaceId'] !== refs.workspaceId
        || ref['queryJobId'] !== refs.queryJobId || ref['runId'] !== refs.runId) {
        return { status: 'invalid', reason: 'a QueryRun pin belongs to another scope' };
      }
      if (run !== null) return { status: 'invalid', reason: 'meta.expected repeats the QueryRun pin' };
      run = revision;
    } else if (ref['aggregateType'] === 'Session') {
      if (ref['projectId'] !== refs.projectId || !nonEmpty(ref['sessionId'])) {
        return { status: 'invalid', reason: 'a Session pin is not a complete Session ref' };
      }
      if (session !== null) return { status: 'invalid', reason: 'meta.expected repeats the Session pin' };
      session = revision;
      sessionId = ref['sessionId'];
    } else {
      return { status: 'invalid', reason: 'meta.expected accepts only the QueryJob/QueryRun/Session pins' };
    }
  }
  if (required.job !== (job !== null) || required.run !== (run !== null) || required.session !== (session !== null)) {
    return { status: 'invalid', reason: 'meta.expected must pin exactly the records this operation consumes' };
  }
  return { status: 'ok', job, run, session, sessionId };
}

/** Deterministic fingerprint over the FULL original request, including the
 * normalized expected pins. A replayed command therefore produces the same key
 * even when a later current revision has moved on. */
function requestFingerprint(
  operation: QueryExecutionOperation,
  requestId: string,
  expected: { job: number | null; run: number | null; session: number | null },
  input: unknown,
): string | null {
  try {
    return sha256Hex(canonicalJson({
      schemaVersion: 1,
      operation,
      requestId,
      expected: { job: expected.job, run: expected.run, session: expected.session },
      input,
    } as unknown as JsonValue));
  } catch {
    return null;
  }
}

function revisionConflict(reads: readonly { refKey: string; revision: number }[]): CoreRejection {
  return rejected('revision_conflict', 'the supplied version pins do not match the versions read in this call', pinsFromCurrent(reads));
}

/** Restore the ORIGINAL receipt before any fresh check. `null` means there is no
 * committed original and the caller may proceed to a fresh admission. */
async function replayOriginal<T extends QueryEventResult>(
  deps: QueryExecutionDependencies,
  identityKey: string,
  fingerprint: string,
  operation: QueryExecutionOperation,
): Promise<WriteResult<T> | null> {
  let found;
  try {
    found = await deps.records.lookupCommit({ identityKey, fingerprint });
  } catch (error) {
    return rejected('unavailable', `the Query ${operation} idempotency lookup failed: ${messageOf(error)}`);
  }
  if (found.status === 'ready') return loadRecordedResult<T>(deps, found.value, identityKey, fingerprint, operation);
  if (found.code === 'not_found') return null;
  if (found.code === 'idempotency_conflict') return rejected('idempotency_conflict', found.reason);
  if (found.code === 'invalid') return rejected('invalid', found.reason);
  return rejected('unavailable', `${found.code}: ${found.reason}`);
}

// --------------------------------------------------------------------------
// The writer
// --------------------------------------------------------------------------

export function createQueryExecution(deps: QueryExecutionDependencies): QueryExecutionPort {
  async function authorizeCurrent(ctx: CoreCallContext, core: Core): Promise<ReadResult<{
    configurationRevision: string;
    permissions: { tools: string[]; writeScope: [] };
    hostTemplate: PreparedQueryManifestV1['hostTemplate'];
    budget: RuntimeBudget;
  }>> {
    const state = core.run.run.executionState;
    if (state === undefined) return rejected('incomplete', 'the QueryRun has no persisted execution state to authorize');
    try {
      return await deps.authorizeConfiguration(ctx, {
        job: core.job, run: core.run, sessionRole: state.role, roleResolution: state.roleResolution,
      });
    } catch (error) {
      return rejected('unavailable', `the trusted Query Host projection failed: ${messageOf(error)}`);
    }
  }

  async function claim(
    ctx: CoreCallContext,
    request: GraphWrite<{ queryRunRef: QueryRunRef; sessionRef: SessionRef }>,
  ): Promise<WriteResult<QueryExecutionRecord>> {
    const owned = ownContext(ctx);
    if (owned === null) return rejected('invalid', 'the call context cannot be isolated from the caller');
    const actor = hostActor(owned);
    if (actor === null) return rejected('forbidden', 'claimQuery requires a trusted Host call context');
    const signal = owned.signal;
    if (signal.aborted) return rejected('cancelled', 'the Query claim was cancelled before the records read');
    let ownedRequest: GraphWrite<{ queryRunRef: QueryRunRef; sessionRef: SessionRef }>;
    try { ownedRequest = structuredClone(request); } catch { return rejected('invalid', 'the claim request cannot be isolated from the caller'); }
    const input = ownedRequest?.input;
    const meta = ownedRequest?.meta;
    if (!isRecord(input) || !isRecord(input.queryRunRef) || !isRecord(input.sessionRef) || !isRecord(meta) || !nonEmpty(meta.requestId)) {
      return rejected('invalid', 'claimQuery requires a complete QueryRunRef, SessionRef and requestId');
    }
    const rawRun = input.queryRunRef;
    const rawSession = input.sessionRef;
    if (rawRun['aggregateType'] !== 'QueryRun' || !nonEmpty(rawRun['projectId']) || !nonEmpty(rawRun['workspaceId'])
      || !nonEmpty(rawRun['queryJobId']) || !nonEmpty(rawRun['runId'])
      || !nonEmpty(rawSession['projectId']) || !nonEmpty(rawSession['sessionId'])) {
      return rejected('invalid', 'claimQuery requires a complete QueryRunRef and SessionRef');
    }
    let queryRunRef: QueryRunRef;
    let sessionRef: SessionRef;
    let requestId: string;
    try {
      queryRunRef = structuredClone(rawRun) as QueryRunRef;
      // Preserve the caller's exact Session reference shape (a trusted caller may
      // pass the full SessionAggregateRef); the fixed state keeps that identity.
      sessionRef = structuredClone(rawSession) as unknown as SessionRef;
      requestId = meta.requestId;
    } catch { return rejected('invalid', 'the claim request cannot be isolated from the caller'); }
    if (queryRunRef.projectId !== owned.projectId || queryRunRef.workspaceId !== owned.workspaceId) {
      return rejected('forbidden', 'the QueryRun is outside the Host call scope');
    }
    const queryJobRef = queryJobRefFor(queryRunRef);
    const expected = validateExpected(meta.expected,
      { projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId, queryJobId: queryRunRef.queryJobId, runId: queryRunRef.runId },
      { job: true, run: true, session: true });
    if (expected.status === 'invalid') return rejected('invalid', expected.reason);
    if (expected.sessionId !== sessionRef.sessionId) return rejected('invalid', 'the Session pin does not name the requested Session');
    const identityKey = operationIdentity('claimed', actor, queryRunRef, requestId);
    const fingerprint = requestFingerprint('claimed', requestId, expected, input);
    if (fingerprint === null) return rejected('invalid', 'the claim request is not serializable');
    const replay = await replayOriginal<QueryExecutionRecord>(deps, identityKey, fingerprint, 'claimed');
    if (replay !== null) return replay;

    const read = await readCore(deps, queryRunRef, sessionRef);
    if (read.status !== 'ready') return toRejection(read);
    const { job, run, session } = read.value;
    if (expected.job !== job.revision || expected.run !== run.revision || expected.session !== session.revision
      || expected.sessionId !== session.ref.sessionId) {
      return revisionConflict([
        { refKey: queryJobRefKey(queryJobRef), revision: job.revision },
        { refKey: queryRunRefKey(queryRunRef), revision: run.revision },
        { refKey: sessionKeyOf(session.ref), revision: session.revision },
      ]);
    }
    if (job.job.status !== 'pending' || run.run.status !== 'pending') {
      return rejected('busy', 'the QueryRun is not awaiting a first claim');
    }
    if (job.job.runRef === null || !sameRef(job.job.runRef, queryRunRef)) return rejected('invalid', 'the QueryJob is not bound to this QueryRun');
    if (session.ref.projectId !== queryRunRef.projectId || session.workspaceId !== queryRunRef.workspaceId) {
      return rejected('forbidden', 'the target Session belongs to another scope');
    }
    if (session.lifecycle !== 'active') return rejected('busy', 'the target Session is archived');
    if (session.health !== 'available') return rejected('busy', `the target Session health is ${session.health}`);
    if (session.occupancy !== null) return rejected('busy', 'the target Session is already occupied');
    if (!safeRevision(session.revision)) return rejected('unavailable', 'the target Session revision is not readable');
    const generation = session.revision + 1;
    if (!Number.isSafeInteger(generation)) return rejected('invalid', 'the Session generation would not be a safe integer');
    const execution = job.job.intent.execution;
    if (execution === undefined) return rejected('unsupported', 'claimQuery requires an explicit read-only execution binding');
    if (signal.aborted) return rejected('cancelled', 'the Query claim was cancelled before Role resolution');

    let roleFacts;
    try {
      roleFacts = await deps.roles.resolveRoleBindingFacts(owned, {
        roleBinding: execution.roleBinding, declaredPermissions: { tools: [], writeScope: [] },
      });
    } catch (error) {
      return rejected('unavailable', `Role resolution failed: ${messageOf(error)}`);
    }
    if (roleFacts.result.status !== 'ready') return mapRead(roleFacts.result);
    const roleResolution = roleFacts.result.value;
    if (roleResolution.status === 'inadmissible') return rejected('forbidden', 'the Role binding is inadmissible');
    if (roleResolution.status === 'resolved') {
      if (session.role.kind !== 'role_spec'
        || session.role.pin.ref.projectId !== roleResolution.revision.projectId
        || session.role.pin.ref.roleId !== roleResolution.revision.roleId
        || session.role.pin.ref.revision !== roleResolution.revision.revision) {
        return rejected('forbidden', 'the resolved Role does not match the Session Role pin');
      }
    } else {
      // First selection, not a runtime Role hot-swap: the Job's legacy binding
      // template must exactly name the Session's legacy template.
      if (session.role.kind !== 'legacy_template'
        || session.role.templateId !== execution.roleBinding.templateId
        || session.role.templateRevision !== execution.roleBinding.templateRevision) {
        return rejected('forbidden', 'the legacy Session role does not match the Job execution role binding');
      }
    }
    if (signal.aborted) return rejected('cancelled', 'the Query claim was cancelled before commit');

    const occurredAt = deps.now();
    const eventId = deps.eventId();
    if (!nonEmpty(occurredAt) || !nonEmpty(eventId)) return rejected('unsupported', 'the injected clock/id source produced an empty value');
    const executionState: QueryExecutionStateV1 = {
      schemaVersion: 1,
      phase: 'claimed',
      sessionRef,
      sessionGeneration: generation,
      role: structuredClone(session.role),
      roleBinding: structuredClone(execution.roleBinding),
      roleResolution: structuredClone(roleResolution),
      priorHistoryCursor: session.historyCursor,
      prepared: null,
      entry: null,
      history: null,
      requests: [],
    };
    const nextRun: QueryRunSnapshot = {
      ...run,
      revision: run.revision + 1,
      run: { ...run.run, executionState: structuredClone(executionState) },
    };
    const nextSession: SessionRecord = {
      ...session,
      revision: generation,
      lastExecutionRef: queryRunRef,
      occupancy: { kind: 'execution', executionRef: queryRunRef, generation },
    };
    const nextRecord: QueryExecutionRecord = { job, run: nextRun, session: nextSession, answer: null };
    const event = buildRecordedEvent({
      eventId, identityKey, fingerprint, actor, occurredAt, queryRunRef, requestId,
      correlationId: job.job.intent.correlationId, aggregateRevision: nextRun.revision,
      operation: 'claimed', result: nextRecord, phase: 'claimed', executionState,
    });
    const guards: RecordGuard[] = [
      { refKey: queryJobRefKey(queryJobRef), expectedRevision: expected.job! },
      { refKey: queryRunRefKey(queryRunRef), expectedRevision: expected.run! },
      { refKey: sessionKeyOf(session.ref), expectedRevision: expected.session! },
      ...roleFacts.guards,
    ];
    return commitOperation({
      deps, identityKey, fingerprint, guards,
      records: [encodeQueryRunSnapshotRecord(nextRun), encodeSessionRecord(nextSession)],
      events: [encodeQueryExecutionRecordedEvent(event)],
      value: nextRecord, operation: 'claimed',
    });
  }

  async function bindPrepared(
    ctx: CoreCallContext,
    request: GraphWrite<{ prepared: PreparedQueryExecution }>,
  ): Promise<WriteResult<QueryExecutionRecord>> {
    const owned = ownContext(ctx);
    if (owned === null) return rejected('invalid', 'the call context cannot be isolated from the caller');
    const actor = hostActor(owned);
    if (actor === null) return rejected('forbidden', 'bindPreparedQuery requires a trusted Host call context');
    const signal = owned.signal;
    if (signal.aborted) return rejected('cancelled', 'the Query bind was cancelled before the records read');
    let ownedRequest: GraphWrite<{ prepared: PreparedQueryExecution }>;
    try { ownedRequest = structuredClone(request); } catch { return rejected('invalid', 'the bind request cannot be isolated from the caller'); }
    const input = ownedRequest?.input;
    const meta = ownedRequest?.meta;
    const prepared = input?.prepared;
    if (!isRecord(prepared) || !isRecord(prepared.queryRunRef) || !isRecord(meta) || !nonEmpty(meta.requestId)) {
      return rejected('invalid', 'bindPreparedQuery requires a complete PreparedQueryExecution and requestId');
    }
    let queryRunRef: QueryRunRef;
    let requestId: string;
    try {
      queryRunRef = structuredClone(prepared.queryRunRef) as QueryRunRef;
      requestId = meta.requestId;
    } catch { return rejected('invalid', 'the bind request cannot be isolated from the caller'); }
    if (queryRunRef.projectId !== owned.projectId || queryRunRef.workspaceId !== owned.workspaceId) {
      return rejected('forbidden', 'the QueryRun is outside the Host call scope');
    }
    const expected = validateExpected(meta.expected,
      { projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId, queryJobId: queryRunRef.queryJobId, runId: queryRunRef.runId },
      { job: false, run: true, session: true });
    if (expected.status === 'invalid') return rejected('invalid', expected.reason);
    const identityKey = operationIdentity('prepared', actor, queryRunRef, requestId);
    const fingerprint = requestFingerprint('prepared', requestId, expected, input);
    if (fingerprint === null) return rejected('invalid', 'the bind request is not serializable');
    const replay = await replayOriginal<QueryExecutionRecord>(deps, identityKey, fingerprint, 'prepared');
    if (replay !== null) return replay;

    const read = await readCore(deps, queryRunRef, null);
    if (read.status !== 'ready') return toRejection(read);
    const { job, run, session } = read.value;
    const state = run.run.executionState;
    if (state === undefined) return rejected('incomplete', 'the QueryRun has no persisted execution state');
    if (expected.run !== run.revision || expected.session !== session.revision || expected.sessionId !== session.ref.sessionId) {
      return revisionConflict([
        { refKey: queryRunRefKey(queryRunRef), revision: run.revision },
        { refKey: sessionKeyOf(session.ref), revision: session.revision },
      ]);
    }
    if (!sessionOwnedByQuery(state, session, queryRunRef)) {
      return rejected('busy', 'the target Session is no longer occupied by this QueryRun generation');
    }
    if (state.phase !== 'claimed' && state.phase !== 'prepared') return rejected('busy', `the QueryRun is not awaiting preparation (phase ${state.phase})`);
    const loaded = await loadQueryManifest(deps.bodies, prepared as unknown as PreparedQueryExecution);
    if (loaded.status !== 'ready') return toRejection(loaded);
    const manifest = loaded.value.manifest;
    if (!sameRef(manifest.queryRunRef, queryRunRef) || !sameRef(manifest.sessionRef, state.sessionRef)) {
      return rejected('invalid', 'the Query manifest does not name this QueryRun/Session');
    }
    if (manifest.sessionGeneration !== state.sessionGeneration) return rejected('invalid', 'the Query manifest Session generation disagrees');
    if (!sameRef(manifest.roleBinding, state.roleBinding) || !sameRef(manifest.sessionRole, state.role)) {
      return rejected('forbidden', 'the Query manifest Role disagrees with the claimed Role');
    }
    if (state.phase === 'prepared') {
      if (state.prepared === null || !sameRef(state.prepared.bundleRef, loaded.value.bundleRef)) {
        return rejected('idempotency_conflict', 'the QueryRun is already bound to another manifest request');
      }
      return rejected('busy', 'the QueryRun is already prepared');
    }
    const facts = await readPreparationFacts(deps, queryRunRef);
    if (facts.status !== 'ready') return toRejection(facts);
    if (manifest.goal.revision !== facts.value.goal.revision
      || !sameRef(manifest.goal.ref, facts.value.goal.ref)
      || manifest.workspace.revision !== facts.value.workspace.revision
      || !sameRef(manifest.workspace.ref, facts.value.workspace.ref)) {
      return rejected('source_stale', 'the Goal/Workspace moved since the Query manifest was prepared');
    }
    const authorized = await authorizeCurrent(owned, { job, run, session });
    if (authorized.status !== 'ready') return toRejection(authorized);
    if (authorized.value.configurationRevision !== manifest.hostConfigurationRevision
      || !manifest.permissions.tools.every(tool => authorized.value.permissions.tools.includes(tool))
      || authorized.value.permissions.writeScope.length !== 0
      || !sameRef({ template: authorized.value.hostTemplate }, { template: manifest.hostTemplate })
      || !sameRef(authorized.value.budget, manifest.runtimeBudget)) {
      return rejected('forbidden', 'the accepted Query permissions no longer fit the current Host and Role ceilings');
    }
    if (signal.aborted) return rejected('cancelled', 'the Query bind was cancelled before commit');
    const occurredAt = deps.now();
    const eventId = deps.eventId();
    if (!nonEmpty(occurredAt) || !nonEmpty(eventId)) return rejected('unsupported', 'the injected clock/id source produced an empty value');
    const executionState: QueryExecutionStateV1 = {
      ...structuredClone(state),
      phase: 'prepared',
      prepared: { bundleRef: structuredClone(loaded.value.bundleRef), inputDigest: (prepared as unknown as PreparedQueryExecution).inputDigest },
    };
    const nextRun: QueryRunSnapshot = { ...run, revision: run.revision + 1, run: { ...run.run, executionState } };
    const nextRecord: QueryExecutionRecord = { job, run: nextRun, session, answer: null };
    const event = buildRecordedEvent({
      eventId, identityKey, fingerprint, actor, occurredAt, queryRunRef, requestId,
      correlationId: job.job.intent.correlationId, aggregateRevision: nextRun.revision,
      operation: 'prepared', result: nextRecord, phase: 'prepared', executionState,
    });
    return commitOperation({
      deps, identityKey, fingerprint,
      guards: [
        { refKey: queryRunRefKey(queryRunRef), expectedRevision: expected.run! },
        { refKey: sessionKeyOf(session.ref), expectedRevision: expected.session! },
      ],
      records: [encodeQueryRunSnapshotRecord(nextRun)],
      events: [encodeQueryExecutionRecordedEvent(event)],
      value: nextRecord, operation: 'prepared',
    });
  }

  /** The fresh action is only entitled while the same QueryRun still owns the
   * Session occupancy generation that claim fixed. */
  function sessionOwnedByQuery(state: QueryExecutionStateV1, session: SessionRecord, queryRunRef: QueryRunRef): boolean {
    return session.occupancy !== null && session.occupancy.kind === 'execution'
      && sameRef(session.occupancy.executionRef, queryRunRef) && session.occupancy.generation === state.sessionGeneration;
  }

  async function beginEntry(
    ctx: CoreCallContext,
    request: GraphWrite<{ prepared: PreparedQueryExecution; consumerId: string; kernel: QueryEntryIdentity['kernel'] }>,
  ): Promise<WriteResult<QueryEntryTicket>> {
    const owned = ownContext(ctx);
    if (owned === null) return rejected('invalid', 'the call context cannot be isolated from the caller');
    const actor = hostActor(owned);
    if (actor === null) return rejected('forbidden', 'beginQueryEntry requires a trusted Host call context');
    const signal = owned.signal;
    if (signal.aborted) return rejected('cancelled', 'the Query entry was cancelled before the records read');
    let ownedRequest: GraphWrite<{ prepared: PreparedQueryExecution; consumerId: string; kernel: QueryEntryIdentity['kernel'] }>;
    try { ownedRequest = structuredClone(request); } catch { return rejected('invalid', 'the begin request cannot be isolated from the caller'); }
    const input = ownedRequest?.input;
    const meta = ownedRequest?.meta;
    if (!isRecord(meta) || !nonEmpty(meta.requestId)) return rejected('invalid', 'beginQueryEntry requires a requestId');
    const prepared = input?.prepared;
    const consumerId = input?.consumerId;
    const kernel = input?.kernel;
    if (!isRecord(prepared) || !isRecord(prepared.queryRunRef) || !nonEmpty(consumerId)
      || !isRecord(kernel) || !nonEmpty(kernel['adapterId']) || !nonEmpty(kernel['kernelSessionId'])
      || !nonEmpty(kernel['runId']) || !nonEmpty(kernel['turnId'])) {
      return rejected('invalid', 'beginQueryEntry requires a complete prepared value, consumerId and kernel');
    }
    let queryRunRef: QueryRunRef;
    let requestId: string;
    let kernelBinding: QueryEntryIdentity['kernel'];
    try {
      queryRunRef = structuredClone(prepared.queryRunRef) as QueryRunRef;
      requestId = meta.requestId;
      kernelBinding = {
        adapterId: String(kernel['adapterId']), kernelSessionId: String(kernel['kernelSessionId']),
        runId: String(kernel['runId']), turnId: String(kernel['turnId']),
      };
    } catch { return rejected('invalid', 'the begin request cannot be isolated from the caller'); }
    if (queryRunRef.projectId !== owned.projectId || queryRunRef.workspaceId !== owned.workspaceId) {
      return rejected('forbidden', 'the QueryRun is outside the Host call scope');
    }
    const expected = validateExpected(meta.expected,
      { projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId, queryJobId: queryRunRef.queryJobId, runId: queryRunRef.runId },
      { job: true, run: true, session: true });
    if (expected.status === 'invalid') return rejected('invalid', expected.reason);
    const identityKey = operationIdentity('entering', actor, queryRunRef, requestId);
    const fingerprint = requestFingerprint('entering', requestId, expected, input);
    if (fingerprint === null) return rejected('invalid', 'the begin request is not serializable');
    const replay = await replayOriginal<QueryEntryTicket>(deps, identityKey, fingerprint, 'entering');
    if (replay !== null) return replay;

    const read = await readCore(deps, queryRunRef, null);
    if (read.status !== 'ready') return toRejection(read);
    const { job, run, session } = read.value;
    const state = run.run.executionState;
    if (state === undefined) return rejected('incomplete', 'the QueryRun has no persisted execution state');
    if (expected.job !== job.revision || expected.run !== run.revision || expected.session !== session.revision
      || expected.sessionId !== state.sessionRef.sessionId) {
      return revisionConflict([
        { refKey: queryJobRefKey(queryJobRefFor(queryRunRef)), revision: job.revision },
        { refKey: queryRunRefKey(queryRunRef), revision: run.revision },
        { refKey: sessionKeyOf(session.ref), revision: session.revision },
      ]);
    }
    if (state.phase !== 'prepared') {
      if (state.entry !== null && state.entry.consumerId !== consumerId) {
        return rejected('busy', 'another consumer already entered this QueryRun');
      }
      return rejected('busy', `the QueryRun is not awaiting a fresh entry (phase ${state.phase})`);
    }
    if (state.prepared === null || !sameRef(state.prepared.bundleRef, prepared.bundleRef)) {
      return rejected('invalid', 'the begin request disagrees with the persisted prepared manifest');
    }
    if (state.prepared.inputDigest !== prepared.inputDigest) return rejected('invalid', 'the begin input digest disagrees with the persisted preparation');
    if (!sessionOwnedByQuery(state, session, queryRunRef)) {
      return rejected('busy', 'the target Session is no longer occupied by this QueryRun generation');
    }
    if (job.job.status !== 'pending' && job.job.status !== 'running') return rejected('busy', 'the QueryJob is not awaiting a fresh entry');
    const execution = job.job.intent.execution;
    if (execution === undefined) return rejected('unsupported', 'beginQueryEntry requires an explicit read-only execution binding');
    const loaded = await loadQueryManifest(deps.bodies, prepared as unknown as PreparedQueryExecution);
    if (loaded.status !== 'ready') return toRejection(loaded);
    const manifest = loaded.value.manifest;
    const authorized = await authorizeCurrent(owned, { job, run, session });
    if (authorized.status !== 'ready') return toRejection(authorized);
    if (authorized.value.configurationRevision !== manifest.hostConfigurationRevision
      || !manifest.permissions.tools.every(tool => authorized.value.permissions.tools.includes(tool))
      || authorized.value.permissions.writeScope.length !== 0
      || !sameRef({ template: authorized.value.hostTemplate }, { template: manifest.hostTemplate })
      || !sameRef(authorized.value.budget, manifest.runtimeBudget)) {
      return rejected('forbidden', 'the prepared Query permissions no longer fit the current Host and Role ceilings');
    }
    if (kernelBinding.adapterId !== session.kernel.adapterId || kernelBinding.kernelSessionId !== session.kernel.kernelSessionId) {
      return rejected('unavailable', 'the fixed Kernel identity disagrees with the Session mapping');
    }
    if (signal.aborted) return rejected('cancelled', 'the Query entry was cancelled before commit');
    const occurredAt = deps.now();
    const eventId = deps.eventId();
    if (!nonEmpty(occurredAt) || !nonEmpty(eventId)) return rejected('unsupported', 'the injected clock/id source produced an empty value');
    const executionState: QueryExecutionStateV1 = {
      ...structuredClone(state),
      phase: 'entering',
      entry: {
        generation: 1,
        consumerId,
        hostConfigurationRevision: manifest.hostConfigurationRevision,
        permissions: structuredClone(manifest.permissions),
        budget: structuredClone(manifest.runtimeBudget),
        kernel: { ...kernelBinding },
      },
    };
    const executionRequest = {
      runRef: { ...queryRunRef },
      bundleRef: structuredClone(loaded.value.bundleRef),
      question: job.job.intent.question,
      budget: { maxTokens: job.job.intent.budget.maxTokens },
    };
    const nextRun: QueryRunSnapshot = {
      ...run,
      revision: run.revision + 1,
      run: {
        ...run.run,
        status: 'running',
        startedAt: run.run.startedAt ?? occurredAt,
        execution: { schemaVersion: 1, roundIndex: 0, request: executionRequest, selectedSources: [] },
        executionState,
      },
    };
    const nextJob: QueryJobSnapshot = { ...job, revision: job.revision + 1, job: { ...job.job, status: 'running', updatedAt: occurredAt } };
    const ticket: QueryEntryTicket = {
      queryRunRef,
      sessionRef: state.sessionRef,
      sessionGeneration: state.sessionGeneration,
      entryGeneration: 1,
      consumerId,
      kernel: { ...kernelBinding },
      bundleRef: structuredClone(loaded.value.bundleRef),
      inputDigest: (prepared as unknown as PreparedQueryExecution).inputDigest,
    };
    const event = buildRecordedEvent({
      eventId, identityKey, fingerprint, actor, occurredAt, queryRunRef, requestId,
      correlationId: job.job.intent.correlationId, aggregateRevision: nextRun.revision,
      operation: 'entering', result: ticket, phase: 'entering', executionState,
    });
    return commitOperation({
      deps, identityKey, fingerprint,
      guards: [
        { refKey: queryJobRefKey(queryJobRefFor(queryRunRef)), expectedRevision: expected.job! },
        { refKey: queryRunRefKey(queryRunRef), expectedRevision: expected.run! },
        { refKey: sessionKeyOf(session.ref), expectedRevision: expected.session! },
      ],
      records: [encodeQueryRunSnapshotRecord(nextRun), encodeQueryJobSnapshot(nextJob)],
      events: [encodeQueryExecutionRecordedEvent(event)],
      value: ticket, operation: 'entering',
    });
  }

  function entryIdentity(state: QueryExecutionStateV1, queryRunRef: QueryRunRef): QueryEntryIdentity | null {
    if (state.entry === null) return null;
    return {
      queryRunRef,
      sessionRef: state.sessionRef,
      sessionGeneration: state.sessionGeneration,
      entryGeneration: state.entry.generation,
      consumerId: state.entry.consumerId,
      kernel: { ...state.entry.kernel },
    };
  }

  async function recordUsage(
    ctx: CoreCallContext,
    request: GraphWrite<{ entry: QueryEntryIdentity; entries: QueryModelUsageV1[] }>,
  ): Promise<WriteResult<QueryRunSnapshot>> {
    const owned = ownContext(ctx);
    if (owned === null) return rejected('invalid', 'the call context cannot be isolated from the caller');
    const actor = hostActor(owned);
    if (actor === null) return rejected('forbidden', 'recordQueryUsage requires a trusted Host call context');
    let ownedRequest: GraphWrite<{ entry: QueryEntryIdentity; entries: QueryModelUsageV1[] }>;
    try { ownedRequest = structuredClone(request); } catch { return rejected('invalid', 'the usage request cannot be isolated from the caller'); }
    const input = ownedRequest?.input;
    const meta = ownedRequest?.meta;
    if (!isRecord(input) || !isRecord(input.entry) || !isRecord(input.entry.queryRunRef) || !Array.isArray(input.entries)
      || !isRecord(meta) || !nonEmpty(meta.requestId)) {
      return rejected('invalid', 'recordQueryUsage requires a complete entry, usage entries and requestId');
    }
    const entry = input.entry as unknown as QueryEntryIdentity;
    let queryRunRef: QueryRunRef;
    let requestId: string;
    try {
      queryRunRef = structuredClone(input.entry.queryRunRef) as QueryRunRef;
      requestId = meta.requestId;
    } catch { return rejected('invalid', 'the usage request cannot be isolated from the caller'); }
    if (queryRunRef.projectId !== owned.projectId || queryRunRef.workspaceId !== owned.workspaceId) {
      return rejected('forbidden', 'the QueryRun is outside the Host call scope');
    }
    const expected = validateExpected(meta.expected,
      { projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId, queryJobId: queryRunRef.queryJobId, runId: queryRunRef.runId },
      { job: false, run: true, session: false });
    if (expected.status === 'invalid') return rejected('invalid', expected.reason);
    const identityKey = operationIdentity('usage', actor, queryRunRef, requestId);
    const fingerprint = requestFingerprint('usage', requestId, expected, input);
    if (fingerprint === null) return rejected('invalid', 'the usage request is not serializable');
    const replay = await replayOriginal<QueryRunSnapshot>(deps, identityKey, fingerprint, 'usage');
    if (replay !== null) return replay;

    const read = await readCore(deps, queryRunRef, null);
    if (read.status !== 'ready') return toRejection(read);
    const { job, run, session } = read.value;
    const state = run.run.executionState;
    if (state === undefined) return rejected('incomplete', 'the QueryRun has no persisted execution state');
    if (expected.run !== run.revision) {
      return revisionConflict([{ refKey: queryRunRefKey(queryRunRef), revision: run.revision }]);
    }
    if (state.phase === 'settled') return rejected('busy', 'the QueryRun is already settled');
    if (!sameRef(entryIdentity(state, queryRunRef), entry)) return rejected('forbidden', 'the usage entry disagrees with the fixed Query entry');
    const byId = new Map<string, QueryModelRequestV1>();
    for (const existing of state.requests) byId.set(existing.requestId, existing);
    for (const incoming of input.entries) {
      if (!isRecord(incoming) || !nonEmpty(incoming['requestId']) || !nonEmpty(incoming['requestDigest'])
        || !['reserved', 'reported', 'unknown'].includes(incoming['usageStatus'] as string)) {
        return rejected('invalid', 'a usage entry is not a complete reserved/reported/unknown record');
      }
      const existing = byId.get(incoming['requestId'] as string);
      byId.set(incoming['requestId'] as string, { ...structuredClone(incoming as unknown as QueryModelUsageV1), admitted: existing?.admitted ?? false });
    }
    const requests = [...byId.values()];
    const executionState: QueryExecutionStateV1 = { ...structuredClone(state), requests };
    const nextRun: QueryRunSnapshot = { ...run, revision: run.revision + 1, run: { ...run.run, executionState } };
    const event = buildRecordedEvent({
      eventId: deps.eventId(), identityKey, fingerprint, actor, occurredAt: deps.now(), queryRunRef,
      requestId, correlationId: job.job.intent.correlationId,
      aggregateRevision: nextRun.revision, operation: 'usage', result: nextRun, phase: state.phase, executionState,
    });
    return commitOperation({
      deps, identityKey, fingerprint,
      guards: [{ refKey: queryRunRefKey(queryRunRef), expectedRevision: expected.run! }],
      records: [encodeQueryRunSnapshotRecord(nextRun)],
      events: [encodeQueryExecutionRecordedEvent(event)],
      value: nextRun, operation: 'usage',
    });
  }

  async function admitRequest(
    ctx: CoreCallContext,
    request: GraphWrite<{ entry: QueryEntryIdentity; requestId: string; requestDigest: string; contextInputDigest: string; manifestDigest: string }>,
  ): Promise<WriteResult<QueryRunSnapshot>> {
    const owned = ownContext(ctx);
    if (owned === null) return rejected('invalid', 'the call context cannot be isolated from the caller');
    const actor = hostActor(owned);
    if (actor === null) return rejected('forbidden', 'admitQueryModelRequest requires a trusted Host call context');
    let ownedRequest: GraphWrite<{ entry: QueryEntryIdentity; requestId: string; requestDigest: string; contextInputDigest: string; manifestDigest: string }>;
    try { ownedRequest = structuredClone(request); } catch { return rejected('invalid', 'the admit request cannot be isolated from the caller'); }
    const input = ownedRequest?.input;
    const meta = ownedRequest?.meta;
    if (!isRecord(input) || !isRecord(input.entry) || !isRecord(input.entry.queryRunRef) || !nonEmpty(input.requestId)
      || !nonEmpty(input.requestDigest) || !nonEmpty(input.contextInputDigest) || !nonEmpty(input.manifestDigest)
      || !isRecord(meta) || !nonEmpty(meta.requestId)) {
      return rejected('invalid', 'admitQueryModelRequest requires a complete entry and request identity');
    }
    const entry = input.entry as unknown as QueryEntryIdentity;
    const modelRequestId = input.requestId;
    let queryRunRef: QueryRunRef;
    let requestId: string;
    try {
      queryRunRef = structuredClone(input.entry.queryRunRef) as QueryRunRef;
      requestId = meta.requestId;
    } catch { return rejected('invalid', 'the admit request cannot be isolated from the caller'); }
    if (queryRunRef.projectId !== owned.projectId || queryRunRef.workspaceId !== owned.workspaceId) {
      return rejected('forbidden', 'the QueryRun is outside the Host call scope');
    }
    const expected = validateExpected(meta.expected,
      { projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId, queryJobId: queryRunRef.queryJobId, runId: queryRunRef.runId },
      { job: false, run: true, session: false });
    if (expected.status === 'invalid') return rejected('invalid', expected.reason);
    const identityKey = operationIdentity('admitted', actor, queryRunRef, requestId);
    const fingerprint = requestFingerprint('admitted', requestId, expected, input);
    if (fingerprint === null) return rejected('invalid', 'the admit request is not serializable');
    const replay = await replayOriginal<QueryRunSnapshot>(deps, identityKey, fingerprint, 'admitted');
    if (replay !== null) return replay;

    const read = await readCore(deps, queryRunRef, null);
    if (read.status !== 'ready') return toRejection(read);
    const { job, run, session } = read.value;
    const state = run.run.executionState;
    if (state === undefined) return rejected('incomplete', 'the QueryRun has no persisted execution state');
    if (expected.run !== run.revision) {
      return revisionConflict([{ refKey: queryRunRefKey(queryRunRef), revision: run.revision }]);
    }
    if (state.phase !== 'entering' && state.phase !== 'entered' && state.phase !== 'unknown') {
      return rejected('busy', `the QueryRun cannot admit a model request in phase ${state.phase}`);
    }
    if (!sessionOwnedByQuery(state, session, queryRunRef)) {
      return rejected('busy', 'the target Session is no longer occupied by this QueryRun generation');
    }
    if (!sameRef(entryIdentity(state, queryRunRef), entry)) return rejected('forbidden', 'the admit entry disagrees with the fixed Query entry');
    const reserved = state.requests.find(candidate => candidate.requestId === modelRequestId);
    if (reserved === undefined) return rejected('incomplete', 'the model request was not reserved before admission');
    if (reserved.requestDigest !== input.requestDigest) return rejected('invalid', 'the model request digest disagrees with the reservation');
    if (state.prepared === null || input.manifestDigest !== state.prepared.bundleRef.digest
      || input.contextInputDigest !== state.prepared.inputDigest) {
      return rejected('invalid', 'the model request binding disagrees with the persisted preparation');
    }
    const authorized = await authorizeCurrent(owned, { job, run, session });
    if (authorized.status !== 'ready') return toRejection(authorized);
    if (!state.entry!.permissions.tools.every(tool => authorized.value.permissions.tools.includes(tool))) {
      return rejected('forbidden', 'the model request no longer fits the current Host and Role ceilings');
    }
    const requests = state.requests.map(candidate => candidate.requestId === modelRequestId ? { ...candidate, admitted: true } : candidate);
    const executionState: QueryExecutionStateV1 = { ...structuredClone(state), requests };
    const nextRun: QueryRunSnapshot = { ...run, revision: run.revision + 1, run: { ...run.run, executionState } };
    const event = buildRecordedEvent({
      eventId: deps.eventId(), identityKey, fingerprint, actor, occurredAt: deps.now(), queryRunRef,
      requestId, correlationId: job.job.intent.correlationId,
      aggregateRevision: nextRun.revision, operation: 'admitted', result: nextRun, phase: state.phase, executionState,
    });
    return commitOperation({
      deps, identityKey, fingerprint,
      guards: [{ refKey: queryRunRefKey(queryRunRef), expectedRevision: expected.run! }],
      records: [encodeQueryRunSnapshotRecord(nextRun)],
      events: [encodeQueryExecutionRecordedEvent(event)],
      value: nextRun, operation: 'admitted',
    });
  }

  async function recordObservation(
    ctx: CoreCallContext,
    request: GraphWrite<QueryHistoryObservation>,
  ): Promise<WriteResult<QueryExecutionRecord>> {
    const owned = ownContext(ctx);
    if (owned === null) return rejected('invalid', 'the call context cannot be isolated from the caller');
    const actor = hostActor(owned);
    if (actor === null) return rejected('forbidden', 'recordQueryObservation requires a trusted Host call context');
    let ownedRequest: GraphWrite<QueryHistoryObservation>;
    try { ownedRequest = structuredClone(request); } catch { return rejected('invalid', 'the observation request cannot be isolated from the caller'); }
    const observation = ownedRequest?.input;
    const meta = ownedRequest?.meta;
    if (!isRecord(observation) || !isRecord(observation.entry) || !isRecord(observation.entry.queryRunRef)
      || !isRecord(observation.history) || !isRecord(observation.source) || !isRecord(observation.observation)
      || !isRecord(meta) || !nonEmpty(meta.requestId)) {
      return rejected('invalid', 'recordQueryObservation requires a complete history observation and requestId');
    }
    let queryRunRef: QueryRunRef;
    let requestId: string;
    try {
      queryRunRef = structuredClone(observation.entry.queryRunRef) as QueryRunRef;
      requestId = meta.requestId;
    } catch { return rejected('invalid', 'the observation request cannot be isolated from the caller'); }
    if (queryRunRef.projectId !== owned.projectId || queryRunRef.workspaceId !== owned.workspaceId) {
      return rejected('forbidden', 'the QueryRun is outside the Host call scope');
    }
    const expected = validateExpected(meta.expected,
      { projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId, queryJobId: queryRunRef.queryJobId, runId: queryRunRef.runId },
      { job: false, run: true, session: false });
    if (expected.status === 'invalid') return rejected('invalid', expected.reason);
    const kind = observation.observation.kind;
    const operation: QueryExecutionOperation = kind === 'entered' ? 'entered' : 'observed';
    const identityKey = kind === 'entered'
      ? `r5b-query-execution:entered:${queryRunRef.runId}:${String(observation.source.position)}`
      : kind === 'unknown'
        ? `r5b-query-execution:observed:${queryRunRef.runId}:unknown:${String(observation.source.position)}`
        : `r5b-query-execution:observed:${queryRunRef.runId}:${String(observation.source.position)}`;
    const fingerprint = requestFingerprint(operation, requestId, expected, observation);
    if (fingerprint === null) return rejected('invalid', 'the observation request is not serializable');
    const replay = await replayOriginal<QueryExecutionRecord>(deps, identityKey, fingerprint, operation);
    if (replay !== null) return replay;

    const read = await readCore(deps, queryRunRef, null);
    if (read.status !== 'ready') return toRejection(read);
    const { job, run, session } = read.value;
    const state = run.run.executionState;
    if (state === undefined) return rejected('incomplete', 'the QueryRun has no persisted execution state');
    if (expected.run !== run.revision) {
      return revisionConflict([{ refKey: queryRunRefKey(queryRunRef), revision: run.revision }]);
    }
    if (!sameRef(entryIdentity(state, queryRunRef), observation.entry)) {
      return rejected('forbidden', 'the observation entry disagrees with the fixed Query entry');
    }
    const guards: RecordGuard[] = [{ refKey: queryRunRefKey(queryRunRef), expectedRevision: expected.run! }];
    if (kind === 'progress') return rejected('unsupported', 'progress observations are not persisted in this batch');
    if (kind === 'entered') {
      if (state.phase === 'settled' || state.phase === 'unknown') {
        return rejected('busy', `the QueryRun cannot record entered in phase ${state.phase}`);
      }
      if (state.phase !== 'entering') {
        return rejected('busy', `the QueryRun cannot record entered in phase ${state.phase}`);
      }
      if (observation.history.endPosition !== null) return rejected('invalid', 'an entered observation must not claim a terminal boundary');
      if (observation.history.startPosition > observation.source.position) return rejected('invalid', 'the entered observation source precedes its start');
      const occurredAt = deps.now();
      const executionState: QueryExecutionStateV1 = { ...structuredClone(state), phase: 'entered', history: structuredClone(observation.history) };
      const nextRun: QueryRunSnapshot = { ...run, revision: run.revision + 1, run: { ...run.run, executionState } };
      const nextRecord: QueryExecutionRecord = { job, run: nextRun, session, answer: null };
      const event = buildRecordedEvent({
        eventId: deps.eventId(), identityKey, fingerprint, actor, occurredAt, queryRunRef, requestId,
        correlationId: job.job.intent.correlationId, aggregateRevision: nextRun.revision,
        operation: 'entered', result: nextRecord, phase: 'entered', executionState,
      });
      return commitOperation({
        deps, identityKey, fingerprint, guards,
        records: [encodeQueryRunSnapshotRecord(nextRun)],
        events: [encodeQueryExecutionRecordedEvent(event)],
        value: nextRecord, operation: 'entered',
      });
    }
    if (kind === 'unknown') {
      if (state.phase === 'settled') return rejected('busy', 'the QueryRun is already settled');
      if (!nonEmpty(observation.observation.reason)) return rejected('invalid', 'an unknown observation requires a reason');
      const executionState: QueryExecutionStateV1 = { ...structuredClone(state), phase: 'unknown', history: structuredClone(observation.history) };
      const nextRun: QueryRunSnapshot = { ...run, revision: run.revision + 1, run: { ...run.run, executionState } };
      const nextRecord: QueryExecutionRecord = { job, run: nextRun, session, answer: null };
      const event = buildRecordedEvent({
        eventId: deps.eventId(), identityKey, fingerprint, actor, occurredAt: deps.now(), queryRunRef,
        requestId: requestId, correlationId: job.job.intent.correlationId,
        aggregateRevision: nextRun.revision, operation: 'observed', result: nextRecord, phase: 'unknown', executionState,
      });
      return commitOperation({
        deps, identityKey, fingerprint, guards,
        records: [encodeQueryRunSnapshotRecord(nextRun)],
        events: [encodeQueryExecutionRecordedEvent(event)],
        value: nextRecord, operation: 'observed',
      });
    }
    // terminal
    if (state.phase === 'settled') return rejected('busy', 'the QueryRun is already settled');
    const terminal = observation.observation;
    if (terminal.kind !== 'terminal') return rejected('invalid', 'the observation is not a terminal fact');
    if (terminal.answer !== null) {
      if (terminal.outcome !== 'answered') return rejected('invalid', 'only an answered terminal may carry an answer');
      if (!sameRef(terminal.answer.queryJobRef, queryJobRefFor(queryRunRef)) || !sameRef(terminal.answer.runRef, queryRunRef)) {
        return rejected('invalid', 'the terminal answer does not belong to this QueryRun');
      }
    } else if (terminal.outcome === 'answered') {
      return rejected('invalid', 'an answered terminal requires an answer');
    }
    if (observation.history.endPosition === null || observation.history.endPosition !== observation.source.position) {
      return rejected('invalid', 'the terminal observation has no complete end boundary');
    }
    const occurredAt = deps.now();
    const answerSnapshot: QueryJobAnswerSnapshot | null = terminal.answer === null
      ? null
      : { ref: { aggregateType: 'QueryJobAnswer', projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId, queryJobId: queryRunRef.queryJobId, answerId: terminal.answer.answerId }, revision: 1, schemaVersion: 1, answer: structuredClone(terminal.answer) };
    const closeCode: QueryJobV1['closeReason'] = terminal.outcome === 'answered' ? null : {
      code: terminal.outcome,
      message: terminal.reason ?? terminal.outcome,
    };
    const nextJob: QueryJobSnapshot = {
      ...job,
      revision: job.revision + 1,
      job: {
        ...job.job,
        status: terminal.outcome === 'answered' ? 'answered' : 'closed',
        answerRefs: answerSnapshot === null ? [...job.job.answerRefs] : [...job.job.answerRefs, answerSnapshot.ref],
        closeReason: closeCode,
        updatedAt: occurredAt,
      },
    };
    const executionState: QueryExecutionStateV1 = {
      ...structuredClone(state),
      phase: 'settled',
      history: structuredClone(observation.history),
    };
    const nextRun: QueryRunSnapshot = {
      ...run,
      revision: run.revision + 1,
      run: {
        ...run.run,
        status: terminal.outcome === 'answered' ? 'answered' : 'closed',
        outcome: terminal.outcome,
        endedAt: occurredAt,
        executionState,
      },
    };
    const ownsSession = sessionOwnedByQuery(state, session, queryRunRef);
    const nextSession: SessionRecord = ownsSession
      ? { ...session, revision: session.revision + 1, occupancy: null, lastExecutionRef: queryRunRef, historyCursor: observation.source.cursor }
      : session;
    const nextRecord: QueryExecutionRecord = { job: nextJob, run: nextRun, session: nextSession, answer: answerSnapshot };
    const event = buildRecordedEvent({
      eventId: deps.eventId(), identityKey, fingerprint, actor, occurredAt, queryRunRef, requestId,
      correlationId: job.job.intent.correlationId, aggregateRevision: nextRun.revision,
      operation: 'observed', result: nextRecord, phase: 'settled', executionState,
    });
    const records: EncodedRecord[] = [encodeQueryRunSnapshotRecord(nextRun), encodeQueryJobSnapshot(nextJob)];
    if (answerSnapshot !== null) records.push(encodeQueryJobAnswerSnapshot(answerSnapshot));
    if (ownsSession) records.push(encodeSessionRecord(nextSession));
    const events = [encodeQueryExecutionRecordedEvent(event)];
    if (answerSnapshot !== null) {
      events.push(encodeQueryJobAnsweredEvent({
        eventId: deps.eventId(), eventType: 'QueryJobAnswered', schemaVersion: 1,
        projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId,
        aggregateType: 'QueryJobAnswer', aggregateId: answerSnapshot.ref.answerId, aggregateRevision: 1,
        causationId: identityKey, correlationId: job.job.intent.correlationId, idempotencyKey: requestId,
        actor: { ...actor }, occurredAt, payload: { answer: structuredClone(answerSnapshot) },
      }));
    }
    const terminalGuards: RecordGuard[] = [
      ...guards,
      { refKey: queryJobRefKey(queryJobRefFor(queryRunRef)), expectedRevision: job.revision },
      { refKey: sessionKeyOf(session.ref), expectedRevision: session.revision },
    ];
    if (answerSnapshot !== null) terminalGuards.push({ refKey: queryJobAnswerRefKey(answerSnapshot.ref), expectedRevision: null });
    return commitOperation({
      deps, identityKey, fingerprint, guards: terminalGuards, records, events, value: nextRecord, operation: 'observed',
    });
  }

  return {
    async readQueryExecution(ctx, ref) {
      const owned = ownContext(ctx);
      if (owned === null) return rejected('invalid', 'the call context cannot be isolated from the caller');
      if (hostActor(owned) === null) return rejected('forbidden', 'readQueryExecution requires a trusted Host call context');
      if (!isRecord(ref) || ref.aggregateType !== 'QueryRun' || !nonEmpty(ref.projectId)
        || !nonEmpty(ref.workspaceId) || !nonEmpty(ref.queryJobId) || !nonEmpty(ref.runId)) {
        return rejected('invalid', 'readQueryExecution requires a complete QueryRunRef');
      }
      let queryRunRef: QueryRunRef;
      try { queryRunRef = structuredClone(ref) as QueryRunRef; } catch { return rejected('invalid', 'the read request cannot be isolated from the caller'); }
      if (queryRunRef.projectId !== owned.projectId || queryRunRef.workspaceId !== owned.workspaceId) {
        return rejected('forbidden', 'the QueryRun is outside the Host call scope');
      }
      return readExecutionRecord(deps, queryRunRef);
    },
    async readPreparationFacts(ctx, ref) {
      const owned = ownContext(ctx);
      if (owned === null) return rejected('invalid', 'the call context cannot be isolated from the caller');
      if (hostActor(owned) === null) return rejected('forbidden', 'readPreparationFacts requires a trusted Host call context');
      if (!isRecord(ref) || ref.aggregateType !== 'QueryRun' || !nonEmpty(ref.projectId)
        || !nonEmpty(ref.workspaceId) || !nonEmpty(ref.queryJobId) || !nonEmpty(ref.runId)) {
        return rejected('invalid', 'readPreparationFacts requires a complete QueryRunRef');
      }
      let queryRunRef: QueryRunRef;
      try { queryRunRef = structuredClone(ref) as QueryRunRef; } catch { return rejected('invalid', 'the read request cannot be isolated from the caller'); }
      if (queryRunRef.projectId !== owned.projectId || queryRunRef.workspaceId !== owned.workspaceId) {
        return rejected('forbidden', 'the QueryRun is outside the Host call scope');
      }
      return readPreparationFacts(deps, queryRunRef);
    },
    async claimQuery(ctx, request) { return claim(ctx, request); },
    async bindPreparedQuery(ctx, request) { return bindPrepared(ctx, request); },
    async beginQueryEntry(ctx, request) { return beginEntry(ctx, request); },
    async recordQueryUsage(ctx, request) { return recordUsage(ctx, request); },
    async admitQueryModelRequest(ctx, request) { return admitRequest(ctx, request); },
    async recordQueryObservation(ctx, request) { return recordObservation(ctx, request); },
    async readQueryAnswer(ctx, ref) {
      const owned = ownContext(ctx);
      if (owned === null) return rejected('invalid', 'the call context cannot be isolated from the caller');
      if (hostActor(owned) === null) return rejected('forbidden', 'readQueryAnswer requires a trusted Host call context');
      if (!isRecord(ref) || ref.aggregateType !== 'QueryJobAnswer' || !nonEmpty(ref.projectId)
        || !nonEmpty(ref.workspaceId) || !nonEmpty(ref.queryJobId) || !nonEmpty(ref.answerId)) {
        return rejected('invalid', 'readQueryAnswer requires a complete QueryJobAnswerRef');
      }
      if (ref.projectId !== owned.projectId || ref.workspaceId !== owned.workspaceId) {
        return rejected('forbidden', 'the Query answer ref is outside the Host call scope');
      }
      return readAnswerByRef(deps, ref);
    },
  };
}
