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
import type { ActorRef, CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef, VersionPin } from '../../../contracts/core/identity.js';
import type { PreparedQueryExecution, PreparedQueryManifestV1 } from '../../../contracts/core/prepared-execution.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import { rejectedWithNonEmptyCurrent } from '../../../contracts/core/rejections.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type { SessionProvenanceV1, SessionRecord } from '../../../contracts/core/session.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { ContextCallKindV1, PlatformDutyV1 } from '../../../contracts/graph-context.js';
import { consultationQueryRefs } from '../../../contracts/query-job.js';
import { isAutomationActor } from '../../../contracts/task-requeue.js';
import type { GoalSnapshot, WorkspaceSnapshot } from '../../../contracts/ledger.js';
import { QUERY_MANIFEST_CONTENT_TYPE } from '../../../contracts/no-progress.js';
import type { PlanRevisionSnapshot } from '../../../contracts/plan.js';
import type { RuntimeBudget } from '../../../contracts/runtime-budget.js';
import type {
  QueryExecutionStateV1, QueryJobAnswerRef, QueryJobAnswerSnapshot, QueryJobRef,
  QueryJobSnapshot, QueryModelRequestV1, QueryModelUsageV1, QueryRunRef, QueryRunSnapshot, QueryRunV1,
} from '../../../contracts/query-job.js';
import type { RawArtifactRecord } from '../../record-store/body-ports.js';
import type {
  EncodedRecord, CommitCursorBinding, GoalRecordTransactionPort, PreparedCommit, RecordGuard, StoreCommitReceipt,
} from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import { canonicalRefKey, decodeGoalSnapshot, decodeWorkspaceSnapshot } from '../persistence/record-codecs.js';
import { decodePlanRevisionSnapshot, planRevisionRefKey } from '../persistence/plan-record-codecs.js';
import {
  decodeSessionRecord, encodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey, SESSION_RECORD_SCHEMA_ID,
} from '../sessions/session-record-codecs.js';
import {
  advanceQueryExecutionRecord, markQueryRunUnknownRecord, queryRecoveryStateOf, settleQueryRunRecord,
  transitionQueryRunRecovery, type QueryRecoveryEffect, type QueryRecoveryEvent, type QueryRecoveryGuardContext,
  type QueryRecoveryPhase,
} from '../state/query-run-recovery.js';
import { contextAssemblyProblem } from '../state/context-input.js';
import {
  bindSessionUnavailableCursor, occupySessionRecord, ownsQuery, releaseSessionRecord, sessionDispatchAdmissionProblem, sessionMachineStateOf,
  transitionSession, type SessionGuardContext, type SessionRelease, type SessionReleaseCause,
} from '../state/session-availability.js';
import {
  decodeQueryExecutionRecordedEvent, decodeQueryJobAnswerSnapshot, decodeQueryJobSnapshot,
  decodeQueryJobSubmittedEvent, decodeQueryRunSnapshotRecord, encodeQueryExecutionRecordedEvent,
  encodeQueryJobAnsweredEvent, encodeQueryJobAnswerSnapshot, encodeQueryJobSnapshot,
  encodeQueryRunSnapshotRecord, type QueryExecutionOperation, type QueryExecutionRecordedEventV1,
} from './query-record-codecs.js';
import type {
  QueryEntryIdentity, QueryEntryTicket, QueryExecutionDependencies, QueryExecutionPort,
  QueryExecutionRecord, QueryHistoryObservation, QueryPreparationFacts, QueryReconcileInput, ResolveUnknownQueryRunInput,
} from './contracts.js';
import type { GraphWrite } from '../model/task-contracts.js';
import type { SessionFactsV1 } from '../model/session-facts-contracts.js';

/** Exact manifest content type (declared once in contracts, ND-9); the writer re-reads the body and requires this. */
export { QUERY_MANIFEST_CONTENT_TYPE };

type HostActor = Extract<ActorRef, { kind: 'human' | 'system' }>;
type Core = { job: QueryJobSnapshot; run: QueryRunSnapshot; session: SessionRecord };
/** One QRR row the reconcile or the Host entry asks (A.2 step 5.6): the event, its guard facts, the SES release cause. */
type RecoveryStep = {
  event: QueryRecoveryEvent;
  guard: Omit<QueryRecoveryGuardContext, 'sessionOwned' | 'sessionGeneration' | 'queryRunRef' | 'entryMatches'>;
  cause: SessionReleaseCause;
  turnSeen: boolean;
};

/** The store refuses duplicate guards; keep the first pin of each record. */
function dedupeGuards(guards: readonly RecordGuard[]): RecordGuard[] {
  const seen = new Map<string, RecordGuard>();
  for (const guard of guards) if (!seen.has(guard.refKey)) seen.set(guard.refKey, guard);
  return [...seen.values()];
}
function sameRef(left: unknown, right: unknown): boolean {
  try { return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue); } catch { return false; }
}
/** §2.4 item 3 / §2.5: the duty a versioned legacy Session role ref fixes, or none. */
function legacyTemplateDutyOf(role: PreparedQueryManifestV1['sessionRole']): PlatformDutyV1 | undefined {
  if (role.kind !== 'legacy_template' || role.templateRevision !== 's3.1') return undefined;
  const duties: readonly PlatformDutyV1[] = ['executor', 'secretary', 'adviser', 'scribe', 'reviewer'];
  return duties.find(duty => role.templateId === `platform-${duty}`);
}
/**
 * §4.3/G-CTX: the duty the Query's resolved Role or its Session's versioned legacy template
 * fixes, or undefined when neither does (then the Host chose it and the manifest's Host
 * configuration revision pins that choice).
 */
function expectedQueryDuty(manifest: PreparedQueryManifestV1): PlatformDutyV1 | undefined {
  const roleDuty = manifest.role.status === 'resolved' ? manifest.role.spec.platformDuty : undefined;
  return roleDuty ?? legacyTemplateDutyOf(manifest.sessionRole);
}
/**
 * §4.3/G-CTX: an initial coordination assembles as `planning` when the graph
 * context port is wired and as `copy` when it is not (context-assembler.ts:
 * `planning = facts !== null && kind === 'initial_coordination'`), so both are
 * legal for that kind; a semantic Query (and every other Query kind) is a
 * `copy` assembly. Every other callKind remains forbidden.
 */
function expectedQueryCallKinds(job: QueryJobSnapshot): readonly ContextCallKindV1[] {
  return job.job.intent.execution?.kind === 'initial_coordination' ? ['planning', 'copy'] : ['copy'];
}
/** QRR-06, like RUN-22: the attestation reason becomes the close message, bounded. */
const MAX_ATTESTATION_REASON_CHARS = 2000;
/**
 * The QueryRun pin of a reconcile or an attestation (A.2 step 5.6): exactly one
 * pin, naming that QueryRun; its revision, or null for anything else.
 */
function queryRunPinOf(expected: readonly { ref: unknown; revision: number }[], queryRunRef: unknown): number | null {
  const [pin] = expected;
  if (expected.length !== 1 || pin === undefined || !isRecord(queryRunRef) || !sameRef(pin.ref, queryRunRef)) return null;
  return Number.isSafeInteger(pin.revision) && pin.revision >= 0 ? pin.revision : null;
}
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function mapRead(result: ReadResult<unknown>): CoreRejection {
  if (result.status === 'ready') return rejectedWithNonEmptyCurrent('unavailable', 'a must-fail read unexpectedly returned a value');
  if (result.status === 'not_found') return rejectedWithNonEmptyCurrent('not_found', 'the required Query fact was not found');
  if (result.status === 'not_ready') return rejectedWithNonEmptyCurrent('incomplete', 'the required Query fact is not readable at the required watermark');
  return { status: 'rejected', code: result.code, reason: result.reason, ...(result.current === undefined ? {} : { current: result.current }) };
}
function toRejection(result: ReadResult<unknown>): CoreRejection {
  if (result.status === 'ready') return rejectedWithNonEmptyCurrent('unavailable', 'a must-fail read unexpectedly returned a value');
  if (result.status === 'not_found') return rejectedWithNonEmptyCurrent('not_found', 'the required Query fact was not found');
  if (result.status === 'not_ready') return rejectedWithNonEmptyCurrent('incomplete', 'the required Query fact is not readable at the required watermark');
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
      return rejectedWithNonEmptyCurrent('revision_conflict', receipt.reason, pinsFromCurrent(receipt.current));
    case 'idempotency_conflict':
      return rejectedWithNonEmptyCurrent('idempotency_conflict', receipt.reason);
    case 'invalid':
      return rejectedWithNonEmptyCurrent('invalid', receipt.reason);
    default:
      return rejectedWithNonEmptyCurrent('unavailable', `${receipt.code}: ${receipt.reason}`);
  }
}

/** Exact operation identity: one per trusted actor/scope/request id. */
function operationIdentity(operation: QueryExecutionOperation, actor: HostActor, queryRunRef: QueryRunRef, requestId: string): string {
  return `r5b-query-execution:${operation}:` + sha256Hex(canonicalJson({
    schemaVersion: 1, operation, projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId,
    actor: { kind: actor.kind, id: actor.id }, requestId,
  } as JsonValue));
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

// --------------------------------------------------------------------------
// S1-DISPATCH-02: the Query-claim exclusion (spec §3.2, §3.3)
// --------------------------------------------------------------------------

/**
 * S1-DISPATCH-02: the Query-claim Session exclusion. `facts` is the trusted
 * Session read injected through `QueryExecutionDependencies.sessionFacts`
 * (composition fills the same `tasks/session-facts.ts` instance; absent, this
 * owner keeps its old behaviour for the narrow doubles). A pending archive
 * request or a Work wait is `busy`; a copy provenance admits only its own pinned
 * consultation Query (`readonlyQueryMatches`), every other query is `forbidden`.
 * The Query's own Job/Run pins are checked before this guard. Returns the owner
 * rejection, or `null` to admit; the machine decision itself is
 * `state/session-availability.ts:sessionDispatchAdmissionProblem`.
 */
export function queryClaimDispatchProblem(
  facts: SessionFactsV1,
  readonlyQueryMatches: boolean,
  legacyProvenance: SessionProvenanceV1 | null = null,
): CoreRejection | null {
  const refusal = sessionDispatchAdmissionProblem(facts.session, {
    purpose: 'query',
    waiting: facts.wait,
    consumedWait: null,
    readonlyQueryMatches,
    legacyProvenance,
  });
  return refusal === null || refusal.ok ? null : rejectedWithNonEmptyCurrent(refusal.code, refusal.detail);
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
    return rejectedWithNonEmptyCurrent('unavailable', `the Query records read failed: ${messageOf(error)}`);
  }
  if (read.status !== 'ready') {
    return read.code === 'not_found' ? { status: 'not_found' } : rejectedWithNonEmptyCurrent('unavailable', `${read.code}: ${read.reason}`);
  }
  const present = new Map<string, EncodedRecord>();
  for (const record of read.value.records) present.set(record.refKey, record);
  const missing = new Set(read.value.missing);
  const job = decodeOne(jobKey, present, missing, decodeQueryJobSnapshot);
  if (job.status === 'missing') return { status: 'not_found' };
  if (job.status === 'unavailable') return rejectedWithNonEmptyCurrent('unavailable', `the QueryJob is not readable: ${job.reason}`);
  const run = decodeOne(runKey, present, missing, decodeQueryRunSnapshotRecord);
  if (run.status === 'missing') return rejectedWithNonEmptyCurrent('incomplete', 'the QueryRun is missing');
  if (run.status === 'unavailable') return rejectedWithNonEmptyCurrent('unavailable', `the QueryRun is not readable: ${run.reason}`);
  if (sessionRef === null) {
    const state = run.value.run.executionState;
    if (state === undefined) return rejectedWithNonEmptyCurrent('incomplete', 'the QueryRun has no persisted Session binding');
    return readCore(deps, queryRunRef, state.sessionRef);
  }
  const session = decodeOne(sessionKeyOf(plainSessionRefToAggregate(sessionRef)), present, missing, decodeSessionRecord);
  if (session.status === 'missing') return { status: 'not_found' };
  if (session.status === 'unavailable') return rejectedWithNonEmptyCurrent('unavailable', `the Session is not readable: ${session.reason}`);
  return { status: 'ready', value: { job: job.value, run: run.value, session: session.value } };
}

async function readAnswerByRef(deps: QueryExecutionDependencies, ref: QueryJobAnswerRef): Promise<ReadResult<QueryJobAnswerSnapshot>> {
  const key = queryJobAnswerRefKey(ref);
  let read;
  try {
    read = await deps.records.readMany([key]);
  } catch (error) {
    return rejectedWithNonEmptyCurrent('unavailable', `the Query answer read failed: ${messageOf(error)}`);
  }
  if (read.status !== 'ready') {
    return read.code === 'not_found' ? { status: 'not_found' } : rejectedWithNonEmptyCurrent('unavailable', `${read.code}: ${read.reason}`);
  }
  const record = read.value.records.find((candidate) => candidate.refKey === key);
  if (record === undefined) {
    if (read.value.missing.includes(key)) return { status: 'not_found' };
    return rejectedWithNonEmptyCurrent('unavailable', 'the read batch neither returned nor reported missing the Query answer');
  }
  const decoded = decodeQueryJobAnswerSnapshot(record);
  if (decoded.status !== 'decoded') return rejectedWithNonEmptyCurrent('unavailable', `the Query answer snapshot is not decodable: ${decoded.reason}`);
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
  if (submission === undefined) return rejectedWithNonEmptyCurrent('unsupported', 'the QueryJob has no exact submission locator');
  let found;
  try {
    found = await deps.records.lookupCommit({ identityKey: submission.identityKey, fingerprint: submission.fingerprint });
  } catch (error) {
    return rejectedWithNonEmptyCurrent('unavailable', `the submission idempotency lookup failed: ${messageOf(error)}`);
  }
  if (found.status !== 'ready') {
    return found.code === 'not_found'
      ? rejectedWithNonEmptyCurrent('not_found', 'the original QueryJob submission was not found')
      : rejectedWithNonEmptyCurrent('unavailable', `${found.code}: ${found.reason}`);
  }
  let located;
  try {
    located = await deps.records.eventAt(found.value.cursor);
  } catch (error) {
    return rejectedWithNonEmptyCurrent('unavailable', `the original QueryJobSubmitted event could not be read: ${messageOf(error)}`);
  }
  if (located.status !== 'ready') return rejectedWithNonEmptyCurrent('unavailable', `the original QueryJobSubmitted event is not readable: ${located.code}: ${located.reason}`);
  const decoded = decodeQueryJobSubmittedEvent(located.value.event);
  if (decoded.status !== 'decoded') return rejectedWithNonEmptyCurrent('unavailable', `the original event is not a legal QueryJobSubmitted@1: ${decoded.reason}`);
  const event = decoded.value;
  if (event.identityKey !== submission.identityKey || event.fingerprint !== submission.fingerprint) {
    return rejectedWithNonEmptyCurrent('unavailable', 'the original submission identity disagrees with the Job locator');
  }
  const actor = event.actor;
  if (actor.kind !== 'human' && actor.kind !== 'system') return rejectedWithNonEmptyCurrent('unsupported', 'the original Query initiator kind is unsupported');
  return { status: 'ready', value: { kind: actor.kind, id: actor.id } };
}

async function readPreparationFacts(deps: QueryExecutionDependencies, queryRunRef: QueryRunRef): Promise<ReadResult<QueryPreparationFacts>> {
  const record = await readExecutionRecord(deps, queryRunRef);
  if (record.status !== 'ready') return record;
  const state = record.value.run.run.executionState;
  if (state === undefined) return rejectedWithNonEmptyCurrent('incomplete', 'the QueryRun has no persisted execution state');
  const goalId = record.value.job.job.goalId;
  if (goalId === null) return rejectedWithNonEmptyCurrent('incomplete', 'the QueryJob has no Goal');
  const goalKey = canonicalRefKey({ aggregateType: 'Goal', projectId: queryRunRef.projectId, goalId });
  let read;
  try {
    read = await deps.records.readMany([goalKey]);
  } catch (error) {
    return rejectedWithNonEmptyCurrent('unavailable', `the Query Goal read failed: ${messageOf(error)}`);
  }
  if (read.status !== 'ready') return read.code === 'not_found' ? { status: 'not_found' } : rejectedWithNonEmptyCurrent('unavailable', `${read.code}: ${read.reason}`);
  const goalRecord = read.value.records.find((candidate) => candidate.refKey === goalKey);
  if (goalRecord === undefined) {
    return read.value.missing.includes(goalKey) ? { status: 'not_found' } : rejectedWithNonEmptyCurrent('unavailable', 'the Goal read was not reported');
  }
  const decodedGoal = decodeGoalSnapshot(goalRecord);
  if (decodedGoal.status !== 'decoded') return rejectedWithNonEmptyCurrent('unavailable', `the Goal snapshot is not decodable: ${decodedGoal.reason}`);
  const goal: GoalSnapshot = decodedGoal.value;
  const workspaceKey = canonicalRefKey(goal.workspaceRef);
  let workspaceRead;
  try {
    workspaceRead = await deps.records.readMany([workspaceKey]);
  } catch (error) {
    return rejectedWithNonEmptyCurrent('unavailable', `the Query Workspace read failed: ${messageOf(error)}`);
  }
  if (workspaceRead.status !== 'ready') return workspaceRead.code === 'not_found' ? { status: 'not_found' } : rejectedWithNonEmptyCurrent('unavailable', `${workspaceRead.code}: ${workspaceRead.reason}`);
  const workspaceRecord = workspaceRead.value.records.find((candidate) => candidate.refKey === workspaceKey);
  if (workspaceRecord === undefined) {
    return workspaceRead.value.missing.includes(workspaceKey) ? { status: 'not_found' } : rejectedWithNonEmptyCurrent('unavailable', 'the Workspace read was not reported');
  }
  const decodedWorkspace = decodeWorkspaceSnapshot(workspaceRecord);
  if (decodedWorkspace.status !== 'decoded') return rejectedWithNonEmptyCurrent('unavailable', `the Workspace snapshot is not decodable: ${decodedWorkspace.reason}`);
  const workspace: WorkspaceSnapshot = decodedWorkspace.value;

  let focusPlan: PlanRevisionSnapshot | null = null;
  if (record.value.job.job.intent.focusTaskRefs.length > 0) {
    const activePlan = goal.activePlanRevision;
    if (activePlan === null) return rejectedWithNonEmptyCurrent('invalid', 'the Query focus is not provable without an active Plan');
    const planKey = planRevisionRefKey(activePlan);
    let planRead;
    try {
      planRead = await deps.records.readMany([planKey]);
    } catch (error) {
      return rejectedWithNonEmptyCurrent('unavailable', `the Query focus Plan read failed: ${messageOf(error)}`);
    }
    if (planRead.status !== 'ready') return planRead.code === 'not_found' ? { status: 'not_found' } : rejectedWithNonEmptyCurrent('unavailable', `${planRead.code}: ${planRead.reason}`);
    const planRecord = planRead.value.records.find((candidate) => candidate.refKey === planKey);
    if (planRecord === undefined) return rejectedWithNonEmptyCurrent('unavailable', 'the Query focus Plan was not reported');
    const decodedPlan = decodePlanRevisionSnapshot(planRecord);
    if (decodedPlan.status !== 'decoded') return rejectedWithNonEmptyCurrent('unavailable', `the focus Plan is not decodable: ${decodedPlan.reason}`);
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
      return rejectedWithNonEmptyCurrent('invalid', 'the Prepared Query value is incomplete');
    }
    const bundleRef = prepared.bundleRef;
    if (bundleRef.contentType !== QUERY_MANIFEST_CONTENT_TYPE) {
      return rejectedWithNonEmptyCurrent('invalid', 'the Prepared Query envelope does not reference a bounded Query manifest body');
    }
    let stored;
    try {
      stored = await bodies.read(bundleRef);
    } catch (error) {
      return rejectedWithNonEmptyCurrent('unavailable', `reading the Query manifest failed: ${messageOf(error)}`);
    }
    if (stored.status !== 'ready') return rejectedWithNonEmptyCurrent('invalid', 'the Query manifest body is not readable');
    const record: RawArtifactRecord = stored.value;
    if (record.ref.contentType !== bundleRef.contentType || record.ref.digest !== bundleRef.digest || record.ref.sizeBytes !== bundleRef.sizeBytes) {
      return rejectedWithNonEmptyCurrent('invalid', 'the stored Query manifest reference disagrees with the Prepared envelope');
    }
    if (sha256Hex(record.body) !== bundleRef.digest || Buffer.byteLength(record.body, 'utf8') !== bundleRef.sizeBytes) {
      return rejectedWithNonEmptyCurrent('invalid', 'the stored Query manifest bytes do not match their content digest');
    }
    if (record.origin.kind !== 'run' || !sameRef(record.origin.owner, prepared.queryRunRef)) {
      return rejectedWithNonEmptyCurrent('forbidden', 'the stored Query manifest is not owned by this QueryRun');
    }
    let parsed: unknown;
    try { parsed = JSON.parse(record.body); } catch { return rejectedWithNonEmptyCurrent('invalid', 'the Query manifest is not valid JSON'); }
    if (!isRecord(parsed) || parsed['schemaVersion'] !== 1 || parsed['kind'] !== 'query_execution'
      || !isRecord(parsed['queryRunRef']) || typeof parsed['input'] !== 'string' || !nonEmpty(parsed['inputDigest'])) {
      return rejectedWithNonEmptyCurrent('invalid', 'the Query manifest is not a complete query-execution manifest');
    }
    const manifest = parsed as unknown as PreparedQueryManifestV1;
    if (!sameRef(manifest.queryRunRef, prepared.queryRunRef)) return rejectedWithNonEmptyCurrent('invalid', 'the Query manifest disagrees with the requested QueryRun');
    if (sha256Hex(manifest.input) !== manifest.inputDigest) return rejectedWithNonEmptyCurrent('invalid', 'the Query manifest input digest is not the digest of its input');
    if (manifest.inputDigest !== prepared.inputDigest) return rejectedWithNonEmptyCurrent('invalid', 'the Query manifest digest disagrees with the Prepared value');
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
  operation: QueryExecutionOperation;
  result: QueryEventResult;
  /** The QueryRun this commit writes: the event carries its revision, phase and execution state. */
  run: QueryRunSnapshot;
}): QueryExecutionRecordedEventV1 {
  const executionState = input.run.run.executionState;
  if (executionState === undefined) throw new Error('a Query execution write always carries the execution state');
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
    aggregateRevision: input.run.revision,
    causationId: input.identityKey,
    correlationId: input.correlationId,
    idempotencyKey: input.requestId,
    actor: { ...input.actor },
    occurredAt: input.occurredAt,
    payload: {
      queryRunRef: { ...input.queryRunRef },
      operation: input.operation,
      result: input.result,
      phase: executionState.phase,
      executionState: structuredClone(executionState),
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
  return { status: 'committed', value: bindResultSession(event.payload.result as T, receipt.cursor),
    replayed: true, cursor: receipt.cursor };
}

/**
 * Spec §2.3 P01: a Query recovery commit that wrote a Session with the explicit
 * `unavailableSince: null` entry placeholder binds it to this commit's cursor.
 * `settleRecovery` builds the Session record through the state constructor, so
 * the binding target is read from the encoded record.
 */
function sessionCursorBindings(records: readonly EncodedRecord[]): CommitCursorBinding[] {
  const bindings: CommitCursorBinding[] = [];
  for (const record of records) {
    if (record.schemaId !== SESSION_RECORD_SCHEMA_ID) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(record.json); } catch { continue; }
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      && (parsed as Record<string, unknown>)['unavailableSince'] === null) {
      bindings.push({ refKey: record.refKey, field: 'unavailableSince' });
    }
  }
  return bindings;
}

/**
 * Spec §2.3 P01/L11-1: a `QueryExecutionRecord` result carries the Session
 * snapshot. The commit binds the record's explicit `null` entry placeholder to
 * the commit cursor, so the first result and every replay must return the same
 * bound Session instead of the pre-binding placeholder.
 */
function bindResultSession<T extends QueryEventResult>(value: T, cursor: CommitCursor): T {
  const session = (value as { session?: SessionRecord }).session;
  if (session === undefined) return value;
  return { ...(value as object), session: bindSessionUnavailableCursor(session, cursor) } as T;
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
  const bindings = sessionCursorBindings(input.records);
  const prepared: PreparedCommit = {
    identityKey: input.identityKey,
    fingerprint: input.fingerprint,
    guards: input.guards,
    records: input.records,
    claims: [],
    indexGuards: [],
    indexChanges: [],
    events: input.events,
    ...(bindings.length === 0 ? {} : { commitCursorBindings: bindings }),
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
    return rejectedWithNonEmptyCurrent('unavailable', `the Query ${input.operation} commit failed and its receipt could not be confirmed: ${messageOf(error)}`);
  }
  if (receipt.status !== 'committed') return mapCommitFailure(receipt);
  if (receipt.replayed) {
    const replayed = await loadRecordedResult<T>(input.deps, receipt, input.identityKey, input.fingerprint, input.operation);
    if (replayed === null) return rejectedWithNonEmptyCurrent('unavailable', `the replayed Query ${input.operation} receipt is not readable`);
    return replayed;
  }
  return { status: 'committed', value: bindResultSession(input.value, receipt.cursor), replayed: false, cursor: receipt.cursor };
}

// --------------------------------------------------------------------------
// State machines (§1.1): Session occupancy and the QueryRun settle
// --------------------------------------------------------------------------

/**
 * SES-03 (`occupancy_acquired`) and SES-08 (QRR-03's `release_session` from the
 * settling phase): the Session machine's decision and the one record it writes,
 * through `occupySessionRecord` / `releaseSessionRecord`. The claim compares its
 * three pins before it calls SES-03 (a stale pin stays `revision_conflict` before
 * `busy`), so the machine gets no pin. The release holder is this QueryRun at its
 * claim generation with the complete Turn boundary of its Kernel terminal; the
 * Runtime confirms the accepted inputs before it books a terminal
 * (`agent-runtime/query-observation.ts:388-393`).
 */
function sessionStep(
  session: SessionRecord,
  step: { kind: 'occupy'; holder: QueryRunRef } | { kind: 'release'; release: SessionRelease; before: QueryRecoveryPhase },
): SessionRecord | CoreRejection {
  const state = sessionMachineStateOf(session);
  const ctx: SessionGuardContext = { caller: 'service', hostLease: null, pin: null, holder: null, probe: null, kernelHeader: null,
    openResponsibleLink: null, creation: null, link: null };
  const result = step.kind === 'occupy'
    ? transitionSession(state, { kind: 'occupancy_acquired', holder: step.holder }, ctx)
    : transitionSession(state, { kind: 'occupancy_released', cause: 'query_terminal_observed' }, { ...ctx, holder: {
      ref: step.release.holder, claimGeneration: step.release.generation, before: `query_${step.before}`, after: 'query_settled',
      kernelTurnSeen: true, inputsConfirmed: true, kernelTurnOpen: step.release.kernelTurnOpen,
      historyBoundaryCursor: step.release.historyCursor.kind === 'advance' ? step.release.historyCursor.cursor : null,
    } });
  if (!result.ok) return rejectedWithNonEmptyCurrent(result.code, result.detail);
  const [effect] = result.effects;
  if (effect?.kind === 'occupy_session') return occupySessionRecord(session, effect);
  if (effect?.kind === 'release_session') return releaseSessionRecord(session, effect);
  throw new Error(`the admitted Session ${step.kind} writes no Session record`);
}

type SettledRecords = { job: QueryJobSnapshot; run: QueryRunSnapshot; answer: QueryJobAnswerSnapshot | null; session: SessionRecord | null };

/**
 * QRR-03's effects as the records of its one commit: `settle_query` through
 * `settleQueryRunRecord`, `record_answer` as Answer@1, and `release_session`
 * through SES-08 (emitted only while this claim generation still holds the Session).
 */
function settledRecords(core: Core, before: QueryRecoveryPhase, effects: readonly QueryRecoveryEffect[], occurredAt: string): SettledRecords | CoreRejection {
  let settled: Pick<SettledRecords, 'job' | 'run'> | null = null;
  let answer: QueryJobAnswerSnapshot | null = null;
  let session: SessionRecord | null = null;
  for (const effect of effects) {
    switch (effect.kind) {
      case 'settle_query':
        settled = settleQueryRunRecord(core, { settlement: effect.settlement, history: effect.history, occurredAt });
        break;
      case 'record_answer':
        answer = { ref: effect.ref, revision: 1, schemaVersion: 1, answer: structuredClone(effect.answer) };
        break;
      case 'release_session': {
        const released = sessionStep(core.session, { kind: 'release', release: effect, before });
        if ('status' in released) return released;
        session = released;
        break;
      }
      default:
        throw new Error(`a Query terminal has no ${effect.kind} effect`);
    }
  }
  if (settled === null) throw new Error('a Query terminal always settles the QueryRun');
  return { ...settled, answer, session };
}

// --------------------------------------------------------------------------
// Original-request expected pins, identity/fingerprint and replay
// --------------------------------------------------------------------------

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

/**
 * QRR-06's request content: what the caller sent (the QueryRun, the reason;
 * the pin is in the fingerprint's `expected`). The Kernel facts the Host entry
 * reads are not part of it, so a retry under the same identity replays the
 * original receipt even when the Kernel now reads differently (§12.10 step 4).
 */
function attestationContent(input: Pick<ResolveUnknownQueryRunInput, 'queryRunRef' | 'reason'>): unknown {
  return { queryRunRef: input.queryRunRef, reason: input.reason };
}

function revisionConflict(reads: readonly { refKey: string; revision: number }[]): CoreRejection {
  return rejectedWithNonEmptyCurrent('revision_conflict', 'the supplied version pins do not match the versions read in this call', pinsFromCurrent(reads));
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
    return rejectedWithNonEmptyCurrent('unavailable', `the Query ${operation} idempotency lookup failed: ${messageOf(error)}`);
  }
  if (found.status === 'ready') return loadRecordedResult<T>(deps, found.value, identityKey, fingerprint, operation);
  if (found.code === 'not_found') return null;
  if (found.code === 'idempotency_conflict') return rejectedWithNonEmptyCurrent('idempotency_conflict', found.reason);
  if (found.code === 'invalid') return rejectedWithNonEmptyCurrent('invalid', found.reason);
  return rejectedWithNonEmptyCurrent('unavailable', `${found.code}: ${found.reason}`);
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
    if (state === undefined) return rejectedWithNonEmptyCurrent('incomplete', 'the QueryRun has no persisted execution state to authorize');
    try {
      return await deps.authorizeConfiguration(ctx, {
        job: core.job, run: core.run, sessionRole: state.role, roleResolution: state.roleResolution,
      });
    } catch (error) {
      return rejectedWithNonEmptyCurrent('unavailable', `the trusted Query Host projection failed: ${messageOf(error)}`);
    }
  }

  async function claim(
    ctx: CoreCallContext,
    request: GraphWrite<{ queryRunRef: QueryRunRef; sessionRef: SessionRef }>,
  ): Promise<WriteResult<QueryExecutionRecord>> {
    const owned = ownContext(ctx);
    if (owned === null) return rejectedWithNonEmptyCurrent('invalid', 'the call context cannot be isolated from the caller');
    const actor = hostActor(owned);
    if (actor === null) return rejectedWithNonEmptyCurrent('forbidden', 'claimQuery requires a trusted Host call context');
    const signal = owned.signal;
    if (signal.aborted) return rejectedWithNonEmptyCurrent('cancelled', 'the Query claim was cancelled before the records read');
    let ownedRequest: GraphWrite<{ queryRunRef: QueryRunRef; sessionRef: SessionRef }>;
    try { ownedRequest = structuredClone(request); } catch { return rejectedWithNonEmptyCurrent('invalid', 'the claim request cannot be isolated from the caller'); }
    const input = ownedRequest?.input;
    const meta = ownedRequest?.meta;
    if (!isRecord(input) || !isRecord(input.queryRunRef) || !isRecord(input.sessionRef) || !isRecord(meta) || !nonEmpty(meta.requestId)) {
      return rejectedWithNonEmptyCurrent('invalid', 'claimQuery requires a complete QueryRunRef, SessionRef and requestId');
    }
    const rawRun = input.queryRunRef;
    const rawSession = input.sessionRef;
    if (rawRun['aggregateType'] !== 'QueryRun' || !nonEmpty(rawRun['projectId']) || !nonEmpty(rawRun['workspaceId'])
      || !nonEmpty(rawRun['queryJobId']) || !nonEmpty(rawRun['runId'])
      || !nonEmpty(rawSession['projectId']) || !nonEmpty(rawSession['sessionId'])) {
      return rejectedWithNonEmptyCurrent('invalid', 'claimQuery requires a complete QueryRunRef and SessionRef');
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
    } catch { return rejectedWithNonEmptyCurrent('invalid', 'the claim request cannot be isolated from the caller'); }
    if (queryRunRef.projectId !== owned.projectId || queryRunRef.workspaceId !== owned.workspaceId) {
      return rejectedWithNonEmptyCurrent('forbidden', 'the QueryRun is outside the Host call scope');
    }
    const queryJobRef = queryJobRefFor(queryRunRef);
    const expected = validateExpected(meta.expected,
      { projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId, queryJobId: queryRunRef.queryJobId, runId: queryRunRef.runId },
      { job: true, run: true, session: true });
    if (expected.status === 'invalid') return rejectedWithNonEmptyCurrent('invalid', expected.reason);
    if (expected.sessionId !== sessionRef.sessionId) return rejectedWithNonEmptyCurrent('invalid', 'the Session pin does not name the requested Session');
    const identityKey = operationIdentity('claimed', actor, queryRunRef, requestId);
    const fingerprint = requestFingerprint('claimed', requestId, expected, input);
    if (fingerprint === null) return rejectedWithNonEmptyCurrent('invalid', 'the claim request is not serializable');
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
      return rejectedWithNonEmptyCurrent('busy', 'the QueryRun is not awaiting a first claim');
    }
    if (job.job.runRef === null || !sameRef(job.job.runRef, queryRunRef)) return rejectedWithNonEmptyCurrent('invalid', 'the QueryJob is not bound to this QueryRun');
    if (session.ref.projectId !== queryRunRef.projectId || session.workspaceId !== queryRunRef.workspaceId) {
      return rejectedWithNonEmptyCurrent('forbidden', 'the target Session belongs to another scope');
    }
    // SES-03: lifecycle, health, occupancy and the generation `revision + 1`, which the occupied record carries as its revision.
    const nextSession = sessionStep(session, { kind: 'occupy', holder: queryRunRef });
    if ('status' in nextSession) return nextSession;
    const execution = job.job.intent.execution;
    if (execution === undefined) return rejectedWithNonEmptyCurrent('unsupported', 'claimQuery requires an explicit read-only execution binding');
    if (execution.consultation !== undefined) {
      // The FIRST occupancy point re-checks the bound recipient against the
      // ACTUAL claimed Session and the deterministic message identity. The
      // submit already did this, but a claim is the authoritative claim.
      // The claimed Session is the ORIGINAL recipient for a legacy Query, or the
      // formal derived child A′ for a derived one. The source is never replaced.
      const claimSession = execution.consultation.derivation === undefined
        ? execution.consultation.recipient
        : execution.consultation.derivation.childSessionRef;
      if (claimSession.projectId !== session.ref.projectId
        || claimSession.sessionId !== session.ref.sessionId) {
        return rejectedWithNonEmptyCurrent('forbidden', 'the consultation binding recipient is not the claimed Session');
      }
      const refs = consultationQueryRefs(execution.consultation.messageRef, execution.consultation.part);
      if (refs.queryJobRef.queryJobId !== queryRunRef.queryJobId || refs.queryRunRef.runId !== queryRunRef.runId) {
        return rejectedWithNonEmptyCurrent('invalid', 'the consultation Query is not the deterministic identity of its message');
      }
    }
    // S1-DISPATCH-02: when the trusted Session-facts reader is injected, a
    // pending archive request or a Work wait is `busy`; a copy provenance admits
    // only its own pinned consultation Query and refuses every other Query.
    let derivedDispatchGuards: readonly RecordGuard[] = [];
    if (deps.sessionFacts !== undefined) {
      const factsRead = await deps.sessionFacts.readSessionFacts(owned, sessionRef);
      if (factsRead.status === 'not_found') return rejectedWithNonEmptyCurrent('not_found', 'the target Session does not exist');
      if (factsRead.status === 'not_ready') return rejectedWithNonEmptyCurrent('incomplete', 'the Session facts are not readable at the required watermark');
      if (factsRead.status !== 'ready') return factsRead;
      const facts = factsRead.value;
      const recorded = facts.session.provenance ?? null;
      // N3 (§3.4 S:630): a legacy Session has no recorded provenance. Obtain the
      // trusted derivation and its guards through the injected model-level port;
      // without that port the L1 `incomplete` refusal stands.
      let legacyProvenance: SessionProvenanceV1 | null = null;
      if (recorded === null && deps.legacyProvenance !== undefined) {
        const derived = await deps.legacyProvenance.deriveLegacySessionProvenance(owned, sessionRef);
        if (derived.status === 'not_found') return rejectedWithNonEmptyCurrent('not_found', 'the target Session does not exist');
        if (derived.status === 'not_ready') return rejectedWithNonEmptyCurrent('incomplete', 'the legacy provenance is not readable at the required watermark');
        if (derived.status !== 'ready') return derived;
        legacyProvenance = derived.value.provenance;
        derivedDispatchGuards = derived.value.guards;
      }
      const effectiveProvenance = recorded ?? legacyProvenance;
      const readonlyQueryMatches = effectiveProvenance !== null && effectiveProvenance.kind === 'readonly_copy'
        && execution.consultation !== undefined
        && sameRef(execution.consultation.messageRef, effectiveProvenance.messageRef);
      const problem = queryClaimDispatchProblem(facts, readonlyQueryMatches, legacyProvenance);
      if (problem !== null) return problem;
    }
    if (signal.aborted) return rejectedWithNonEmptyCurrent('cancelled', 'the Query claim was cancelled before Role resolution');

    let roleFacts;
    try {
      roleFacts = await deps.roles.resolveRoleBindingFacts(owned, {
        roleBinding: execution.roleBinding, declaredPermissions: { tools: [], writeScope: [] },
      });
    } catch (error) {
      return rejectedWithNonEmptyCurrent('unavailable', `Role resolution failed: ${messageOf(error)}`);
    }
    if (roleFacts.result.status !== 'ready') return mapRead(roleFacts.result);
    const roleResolution = roleFacts.result.value;
    if (roleResolution.status === 'inadmissible') return rejectedWithNonEmptyCurrent('forbidden', 'the Role binding is inadmissible');
    if (roleResolution.status === 'resolved') {
      if (session.role.kind !== 'role_spec'
        || session.role.pin.ref.projectId !== roleResolution.revision.projectId
        || session.role.pin.ref.roleId !== roleResolution.revision.roleId
        || session.role.pin.ref.revision !== roleResolution.revision.revision) {
        return rejectedWithNonEmptyCurrent('forbidden', 'the resolved Role does not match the Session Role pin');
      }
    } else {
      // First selection, not a runtime Role hot-swap: the Job's legacy binding
      // template must exactly name the Session's legacy template.
      if (session.role.kind !== 'legacy_template'
        || session.role.templateId !== execution.roleBinding.templateId
        || session.role.templateRevision !== execution.roleBinding.templateRevision) {
        return rejectedWithNonEmptyCurrent('forbidden', 'the legacy Session role does not match the Job execution role binding');
      }
    }
    if (signal.aborted) return rejectedWithNonEmptyCurrent('cancelled', 'the Query claim was cancelled before commit');

    const occurredAt = deps.now();
    const eventId = deps.eventId();
    if (!nonEmpty(occurredAt) || !nonEmpty(eventId)) return rejectedWithNonEmptyCurrent('unsupported', 'the injected clock/id source produced an empty value');
    const nextRun = advanceQueryExecutionRecord({ job, run }, { phase: 'claimed', claim: {
      sessionRef, sessionGeneration: nextSession.revision, role: session.role, roleBinding: execution.roleBinding, roleResolution,
      priorHistoryCursor: session.historyCursor,
    } }).run;
    const nextRecord: QueryExecutionRecord = { job, run: nextRun, session: nextSession, answer: null };
    const event = buildRecordedEvent({
      eventId, identityKey, fingerprint, actor, occurredAt, queryRunRef, requestId,
      correlationId: job.job.intent.correlationId, operation: 'claimed', result: nextRecord, run: nextRun,
    });
    const guards: RecordGuard[] = dedupeGuards([
      { refKey: queryJobRefKey(queryJobRef), expectedRevision: expected.job! },
      { refKey: queryRunRefKey(queryRunRef), expectedRevision: expected.run! },
      { refKey: sessionKeyOf(session.ref), expectedRevision: expected.session! },
      ...roleFacts.guards,
      ...derivedDispatchGuards,
    ]);
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
    if (owned === null) return rejectedWithNonEmptyCurrent('invalid', 'the call context cannot be isolated from the caller');
    const actor = hostActor(owned);
    if (actor === null) return rejectedWithNonEmptyCurrent('forbidden', 'bindPreparedQuery requires a trusted Host call context');
    const signal = owned.signal;
    if (signal.aborted) return rejectedWithNonEmptyCurrent('cancelled', 'the Query bind was cancelled before the records read');
    let ownedRequest: GraphWrite<{ prepared: PreparedQueryExecution }>;
    try { ownedRequest = structuredClone(request); } catch { return rejectedWithNonEmptyCurrent('invalid', 'the bind request cannot be isolated from the caller'); }
    const input = ownedRequest?.input;
    const meta = ownedRequest?.meta;
    const prepared = input?.prepared;
    if (!isRecord(prepared) || !isRecord(prepared.queryRunRef) || !isRecord(meta) || !nonEmpty(meta.requestId)) {
      return rejectedWithNonEmptyCurrent('invalid', 'bindPreparedQuery requires a complete PreparedQueryExecution and requestId');
    }
    let queryRunRef: QueryRunRef;
    let requestId: string;
    try {
      queryRunRef = structuredClone(prepared.queryRunRef) as QueryRunRef;
      requestId = meta.requestId;
    } catch { return rejectedWithNonEmptyCurrent('invalid', 'the bind request cannot be isolated from the caller'); }
    if (queryRunRef.projectId !== owned.projectId || queryRunRef.workspaceId !== owned.workspaceId) {
      return rejectedWithNonEmptyCurrent('forbidden', 'the QueryRun is outside the Host call scope');
    }
    const expected = validateExpected(meta.expected,
      { projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId, queryJobId: queryRunRef.queryJobId, runId: queryRunRef.runId },
      { job: false, run: true, session: true });
    if (expected.status === 'invalid') return rejectedWithNonEmptyCurrent('invalid', expected.reason);
    const identityKey = operationIdentity('prepared', actor, queryRunRef, requestId);
    const fingerprint = requestFingerprint('prepared', requestId, expected, input);
    if (fingerprint === null) return rejectedWithNonEmptyCurrent('invalid', 'the bind request is not serializable');
    const replay = await replayOriginal<QueryExecutionRecord>(deps, identityKey, fingerprint, 'prepared');
    if (replay !== null) return replay;

    const read = await readCore(deps, queryRunRef, null);
    if (read.status !== 'ready') return toRejection(read);
    const { job, run, session } = read.value;
    const state = run.run.executionState;
    if (state === undefined) return rejectedWithNonEmptyCurrent('incomplete', 'the QueryRun has no persisted execution state');
    if (expected.run !== run.revision || expected.session !== session.revision || expected.sessionId !== session.ref.sessionId) {
      return revisionConflict([
        { refKey: queryRunRefKey(queryRunRef), revision: run.revision },
        { refKey: sessionKeyOf(session.ref), revision: session.revision },
      ]);
    }
    if (!ownsQuery(session, queryRunRef, state)) {
      return rejectedWithNonEmptyCurrent('busy', 'the target Session is no longer occupied by this QueryRun generation');
    }
    if (state.phase !== 'claimed' && state.phase !== 'prepared') return rejectedWithNonEmptyCurrent('busy', `the QueryRun is not awaiting preparation (phase ${state.phase})`);
    const loaded = await loadQueryManifest(deps.bodies, prepared as unknown as PreparedQueryExecution);
    if (loaded.status !== 'ready') return toRejection(loaded);
    const manifest = loaded.value.manifest;
    if (!sameRef(manifest.queryRunRef, queryRunRef) || !sameRef(manifest.sessionRef, state.sessionRef)) {
      return rejectedWithNonEmptyCurrent('invalid', 'the Query manifest does not name this QueryRun/Session');
    }
    if (manifest.sessionGeneration !== state.sessionGeneration) return rejectedWithNonEmptyCurrent('invalid', 'the Query manifest Session generation disagrees');
    if (!sameRef(manifest.roleBinding, state.roleBinding) || !sameRef(manifest.sessionRole, state.role)) {
      return rejectedWithNonEmptyCurrent('forbidden', 'the Query manifest Role disagrees with the claimed Role');
    }
    // CTX-03 G-CTX: a saved Query context binding must be a legal s3-context-v1
    // value. A Query manifest carries no legacy `selectedTaskInputs`, so its
    // Artifact selections project to the empty array.
    const assemblyProblem = contextAssemblyProblem({
      binding: manifest.contextAssembly,
      text: manifest.input,
      selectedTaskInputs: [],
      continuationSuffix: null,
    });
    if (assemblyProblem !== null) return assemblyProblem;
    if (manifest.contextAssembly !== undefined) {
      // §3.2 G-CTX: the saved call scope and duty must match the canonical Query
      // facts (the intent's execution kind and the Query's resolved Role). An
      // initial coordination accepts `planning` or `copy` (see
      // `expectedQueryCallKinds`); every other Query kind requires `copy`.
      const fixedDuty = expectedQueryDuty(manifest);
      if (fixedDuty !== undefined && manifest.contextAssembly.duty !== fixedDuty) {
        return rejectedWithNonEmptyCurrent('forbidden', 'the assembled Query context duty disagrees with the resolved Role');
      }
      if (!expectedQueryCallKinds(job).includes(manifest.contextAssembly.callKind)) {
        return rejectedWithNonEmptyCurrent('forbidden', 'the assembled Query context callKind disagrees with the Query execution kind');
      }
    }
    if (state.phase === 'prepared') {
      if (state.prepared === null || !sameRef(state.prepared.bundleRef, loaded.value.bundleRef)) {
        return rejectedWithNonEmptyCurrent('idempotency_conflict', 'the QueryRun is already bound to another manifest request');
      }
      return rejectedWithNonEmptyCurrent('busy', 'the QueryRun is already prepared');
    }
    const facts = await readPreparationFacts(deps, queryRunRef);
    if (facts.status !== 'ready') return toRejection(facts);
    if (manifest.goal.revision !== facts.value.goal.revision
      || !sameRef(manifest.goal.ref, facts.value.goal.ref)
      || manifest.workspace.revision !== facts.value.workspace.revision
      || !sameRef(manifest.workspace.ref, facts.value.workspace.ref)) {
      return rejectedWithNonEmptyCurrent('source_stale', 'the Goal/Workspace moved since the Query manifest was prepared');
    }
    const authorized = await authorizeCurrent(owned, { job, run, session });
    if (authorized.status !== 'ready') return toRejection(authorized);
    if (authorized.value.configurationRevision !== manifest.hostConfigurationRevision
      || !manifest.permissions.tools.every(tool => authorized.value.permissions.tools.includes(tool))
      || authorized.value.permissions.writeScope.length !== 0
      || !sameRef({ template: authorized.value.hostTemplate }, { template: manifest.hostTemplate })
      || !sameRef(authorized.value.budget, manifest.runtimeBudget)) {
      return rejectedWithNonEmptyCurrent('forbidden', 'the accepted Query permissions no longer fit the current Host and Role ceilings');
    }
    if (signal.aborted) return rejectedWithNonEmptyCurrent('cancelled', 'the Query bind was cancelled before commit');
    const occurredAt = deps.now();
    const eventId = deps.eventId();
    if (!nonEmpty(occurredAt) || !nonEmpty(eventId)) return rejectedWithNonEmptyCurrent('unsupported', 'the injected clock/id source produced an empty value');
    const nextRun = advanceQueryExecutionRecord({ job, run }, { phase: 'prepared',
      prepared: { bundleRef: loaded.value.bundleRef, inputDigest: (prepared as unknown as PreparedQueryExecution).inputDigest } }).run;
    const nextRecord: QueryExecutionRecord = { job, run: nextRun, session, answer: null };
    const event = buildRecordedEvent({
      eventId, identityKey, fingerprint, actor, occurredAt, queryRunRef, requestId,
      correlationId: job.job.intent.correlationId, operation: 'prepared', result: nextRecord, run: nextRun,
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

  async function beginEntry(
    ctx: CoreCallContext,
    request: GraphWrite<{ prepared: PreparedQueryExecution; consumerId: string; kernel: QueryEntryIdentity['kernel'] }>,
  ): Promise<WriteResult<QueryEntryTicket>> {
    const owned = ownContext(ctx);
    if (owned === null) return rejectedWithNonEmptyCurrent('invalid', 'the call context cannot be isolated from the caller');
    const actor = hostActor(owned);
    if (actor === null) return rejectedWithNonEmptyCurrent('forbidden', 'beginQueryEntry requires a trusted Host call context');
    const signal = owned.signal;
    if (signal.aborted) return rejectedWithNonEmptyCurrent('cancelled', 'the Query entry was cancelled before the records read');
    let ownedRequest: GraphWrite<{ prepared: PreparedQueryExecution; consumerId: string; kernel: QueryEntryIdentity['kernel'] }>;
    try { ownedRequest = structuredClone(request); } catch { return rejectedWithNonEmptyCurrent('invalid', 'the begin request cannot be isolated from the caller'); }
    const input = ownedRequest?.input;
    const meta = ownedRequest?.meta;
    if (!isRecord(meta) || !nonEmpty(meta.requestId)) return rejectedWithNonEmptyCurrent('invalid', 'beginQueryEntry requires a requestId');
    const prepared = input?.prepared;
    const consumerId = input?.consumerId;
    const kernel = input?.kernel;
    if (!isRecord(prepared) || !isRecord(prepared.queryRunRef) || !nonEmpty(consumerId)
      || !isRecord(kernel) || !nonEmpty(kernel['adapterId']) || !nonEmpty(kernel['kernelSessionId'])
      || !nonEmpty(kernel['runId']) || !nonEmpty(kernel['turnId'])) {
      return rejectedWithNonEmptyCurrent('invalid', 'beginQueryEntry requires a complete prepared value, consumerId and kernel');
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
    } catch { return rejectedWithNonEmptyCurrent('invalid', 'the begin request cannot be isolated from the caller'); }
    if (queryRunRef.projectId !== owned.projectId || queryRunRef.workspaceId !== owned.workspaceId) {
      return rejectedWithNonEmptyCurrent('forbidden', 'the QueryRun is outside the Host call scope');
    }
    const expected = validateExpected(meta.expected,
      { projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId, queryJobId: queryRunRef.queryJobId, runId: queryRunRef.runId },
      { job: true, run: true, session: true });
    if (expected.status === 'invalid') return rejectedWithNonEmptyCurrent('invalid', expected.reason);
    const identityKey = operationIdentity('entering', actor, queryRunRef, requestId);
    const fingerprint = requestFingerprint('entering', requestId, expected, input);
    if (fingerprint === null) return rejectedWithNonEmptyCurrent('invalid', 'the begin request is not serializable');
    const replay = await replayOriginal<QueryEntryTicket>(deps, identityKey, fingerprint, 'entering');
    if (replay !== null) return replay;

    const read = await readCore(deps, queryRunRef, null);
    if (read.status !== 'ready') return toRejection(read);
    const { job, run, session } = read.value;
    const state = run.run.executionState;
    if (state === undefined) return rejectedWithNonEmptyCurrent('incomplete', 'the QueryRun has no persisted execution state');
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
        return rejectedWithNonEmptyCurrent('busy', 'another consumer already entered this QueryRun');
      }
      return rejectedWithNonEmptyCurrent('busy', `the QueryRun is not awaiting a fresh entry (phase ${state.phase})`);
    }
    if (state.prepared === null || !sameRef(state.prepared.bundleRef, prepared.bundleRef)) {
      return rejectedWithNonEmptyCurrent('invalid', 'the begin request disagrees with the persisted prepared manifest');
    }
    if (state.prepared.inputDigest !== prepared.inputDigest) return rejectedWithNonEmptyCurrent('invalid', 'the begin input digest disagrees with the persisted preparation');
    if (!ownsQuery(session, queryRunRef, state)) {
      return rejectedWithNonEmptyCurrent('busy', 'the target Session is no longer occupied by this QueryRun generation');
    }
    if (job.job.status !== 'pending' && job.job.status !== 'running') return rejectedWithNonEmptyCurrent('busy', 'the QueryJob is not awaiting a fresh entry');
    const execution = job.job.intent.execution;
    if (execution === undefined) return rejectedWithNonEmptyCurrent('unsupported', 'beginQueryEntry requires an explicit read-only execution binding');
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
      return rejectedWithNonEmptyCurrent('forbidden', 'the prepared Query permissions no longer fit the current Host and Role ceilings');
    }
    if (kernelBinding.adapterId !== session.kernel.adapterId || kernelBinding.kernelSessionId !== session.kernel.kernelSessionId) {
      return rejectedWithNonEmptyCurrent('unavailable', 'the fixed Kernel identity disagrees with the Session mapping');
    }
    if (signal.aborted) return rejectedWithNonEmptyCurrent('cancelled', 'the Query entry was cancelled before commit');
    const occurredAt = deps.now();
    const eventId = deps.eventId();
    if (!nonEmpty(occurredAt) || !nonEmpty(eventId)) return rejectedWithNonEmptyCurrent('unsupported', 'the injected clock/id source produced an empty value');
    // QueryRun and QueryJob become running with the fixed entry and the round-0 execution binding.
    const { job: nextJob, run: nextRun } = advanceQueryExecutionRecord({ job, run }, {
      phase: 'entering', occurredAt,
      entry: { generation: 1, consumerId, hostConfigurationRevision: manifest.hostConfigurationRevision,
        permissions: manifest.permissions, budget: manifest.runtimeBudget, kernel: { ...kernelBinding } },
      request: { runRef: { ...queryRunRef }, bundleRef: loaded.value.bundleRef, question: job.job.intent.question,
        budget: { maxTokens: job.job.intent.budget.maxTokens } },
    });
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
      correlationId: job.job.intent.correlationId, operation: 'entering', result: ticket, run: nextRun,
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
    if (owned === null) return rejectedWithNonEmptyCurrent('invalid', 'the call context cannot be isolated from the caller');
    const actor = hostActor(owned);
    if (actor === null) return rejectedWithNonEmptyCurrent('forbidden', 'recordQueryUsage requires a trusted Host call context');
    let ownedRequest: GraphWrite<{ entry: QueryEntryIdentity; entries: QueryModelUsageV1[] }>;
    try { ownedRequest = structuredClone(request); } catch { return rejectedWithNonEmptyCurrent('invalid', 'the usage request cannot be isolated from the caller'); }
    const input = ownedRequest?.input;
    const meta = ownedRequest?.meta;
    if (!isRecord(input) || !isRecord(input.entry) || !isRecord(input.entry.queryRunRef) || !Array.isArray(input.entries)
      || !isRecord(meta) || !nonEmpty(meta.requestId)) {
      return rejectedWithNonEmptyCurrent('invalid', 'recordQueryUsage requires a complete entry, usage entries and requestId');
    }
    const entry = input.entry as unknown as QueryEntryIdentity;
    let queryRunRef: QueryRunRef;
    let requestId: string;
    try {
      queryRunRef = structuredClone(input.entry.queryRunRef) as QueryRunRef;
      requestId = meta.requestId;
    } catch { return rejectedWithNonEmptyCurrent('invalid', 'the usage request cannot be isolated from the caller'); }
    if (queryRunRef.projectId !== owned.projectId || queryRunRef.workspaceId !== owned.workspaceId) {
      return rejectedWithNonEmptyCurrent('forbidden', 'the QueryRun is outside the Host call scope');
    }
    const expected = validateExpected(meta.expected,
      { projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId, queryJobId: queryRunRef.queryJobId, runId: queryRunRef.runId },
      { job: false, run: true, session: false });
    if (expected.status === 'invalid') return rejectedWithNonEmptyCurrent('invalid', expected.reason);
    const identityKey = operationIdentity('usage', actor, queryRunRef, requestId);
    const fingerprint = requestFingerprint('usage', requestId, expected, input);
    if (fingerprint === null) return rejectedWithNonEmptyCurrent('invalid', 'the usage request is not serializable');
    const replay = await replayOriginal<QueryRunSnapshot>(deps, identityKey, fingerprint, 'usage');
    if (replay !== null) return replay;

    const read = await readCore(deps, queryRunRef, null);
    if (read.status !== 'ready') return toRejection(read);
    const { job, run, session } = read.value;
    const state = run.run.executionState;
    if (state === undefined) return rejectedWithNonEmptyCurrent('incomplete', 'the QueryRun has no persisted execution state');
    if (expected.run !== run.revision) {
      return revisionConflict([{ refKey: queryRunRefKey(queryRunRef), revision: run.revision }]);
    }
    if (state.phase === 'settled') return rejectedWithNonEmptyCurrent('busy', 'the QueryRun is already settled');
    if (!sameRef(entryIdentity(state, queryRunRef), entry)) return rejectedWithNonEmptyCurrent('forbidden', 'the usage entry disagrees with the fixed Query entry');
    const byId = new Map<string, QueryModelRequestV1>();
    for (const existing of state.requests) byId.set(existing.requestId, existing);
    for (const incoming of input.entries) {
      if (!isRecord(incoming) || !nonEmpty(incoming['requestId']) || !nonEmpty(incoming['requestDigest'])
        || !['reserved', 'reported', 'unknown'].includes(incoming['usageStatus'] as string)) {
        return rejectedWithNonEmptyCurrent('invalid', 'a usage entry is not a complete reserved/reported/unknown record');
      }
      const existing = byId.get(incoming['requestId'] as string);
      byId.set(incoming['requestId'] as string, { ...structuredClone(incoming as unknown as QueryModelUsageV1), admitted: existing?.admitted ?? false });
    }
    const requests = [...byId.values()];
    const executionState: QueryExecutionStateV1 = { ...structuredClone(state), requests };
    const nextRun: QueryRunSnapshot = { ...run, revision: run.revision + 1, run: { ...run.run, executionState } };
    const event = buildRecordedEvent({
      eventId: deps.eventId(), identityKey, fingerprint, actor, occurredAt: deps.now(), queryRunRef,
      requestId, correlationId: job.job.intent.correlationId, operation: 'usage', result: nextRun, run: nextRun,
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
    if (owned === null) return rejectedWithNonEmptyCurrent('invalid', 'the call context cannot be isolated from the caller');
    const actor = hostActor(owned);
    if (actor === null) return rejectedWithNonEmptyCurrent('forbidden', 'admitQueryModelRequest requires a trusted Host call context');
    let ownedRequest: GraphWrite<{ entry: QueryEntryIdentity; requestId: string; requestDigest: string; contextInputDigest: string; manifestDigest: string }>;
    try { ownedRequest = structuredClone(request); } catch { return rejectedWithNonEmptyCurrent('invalid', 'the admit request cannot be isolated from the caller'); }
    const input = ownedRequest?.input;
    const meta = ownedRequest?.meta;
    if (!isRecord(input) || !isRecord(input.entry) || !isRecord(input.entry.queryRunRef) || !nonEmpty(input.requestId)
      || !nonEmpty(input.requestDigest) || !nonEmpty(input.contextInputDigest) || !nonEmpty(input.manifestDigest)
      || !isRecord(meta) || !nonEmpty(meta.requestId)) {
      return rejectedWithNonEmptyCurrent('invalid', 'admitQueryModelRequest requires a complete entry and request identity');
    }
    const entry = input.entry as unknown as QueryEntryIdentity;
    const modelRequestId = input.requestId;
    let queryRunRef: QueryRunRef;
    let requestId: string;
    try {
      queryRunRef = structuredClone(input.entry.queryRunRef) as QueryRunRef;
      requestId = meta.requestId;
    } catch { return rejectedWithNonEmptyCurrent('invalid', 'the admit request cannot be isolated from the caller'); }
    if (queryRunRef.projectId !== owned.projectId || queryRunRef.workspaceId !== owned.workspaceId) {
      return rejectedWithNonEmptyCurrent('forbidden', 'the QueryRun is outside the Host call scope');
    }
    const expected = validateExpected(meta.expected,
      { projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId, queryJobId: queryRunRef.queryJobId, runId: queryRunRef.runId },
      { job: false, run: true, session: false });
    if (expected.status === 'invalid') return rejectedWithNonEmptyCurrent('invalid', expected.reason);
    const identityKey = operationIdentity('admitted', actor, queryRunRef, requestId);
    const fingerprint = requestFingerprint('admitted', requestId, expected, input);
    if (fingerprint === null) return rejectedWithNonEmptyCurrent('invalid', 'the admit request is not serializable');
    const replay = await replayOriginal<QueryRunSnapshot>(deps, identityKey, fingerprint, 'admitted');
    if (replay !== null) return replay;

    const read = await readCore(deps, queryRunRef, null);
    if (read.status !== 'ready') return toRejection(read);
    const { job, run, session } = read.value;
    const state = run.run.executionState;
    if (state === undefined) return rejectedWithNonEmptyCurrent('incomplete', 'the QueryRun has no persisted execution state');
    if (expected.run !== run.revision) {
      return revisionConflict([{ refKey: queryRunRefKey(queryRunRef), revision: run.revision }]);
    }
    if (state.phase !== 'entering' && state.phase !== 'entered' && state.phase !== 'unknown') {
      return rejectedWithNonEmptyCurrent('busy', `the QueryRun cannot admit a model request in phase ${state.phase}`);
    }
    if (!ownsQuery(session, queryRunRef, state)) {
      return rejectedWithNonEmptyCurrent('busy', 'the target Session is no longer occupied by this QueryRun generation');
    }
    if (!sameRef(entryIdentity(state, queryRunRef), entry)) return rejectedWithNonEmptyCurrent('forbidden', 'the admit entry disagrees with the fixed Query entry');
    const reserved = state.requests.find(candidate => candidate.requestId === modelRequestId);
    if (reserved === undefined) return rejectedWithNonEmptyCurrent('incomplete', 'the model request was not reserved before admission');
    if (reserved.requestDigest !== input.requestDigest) return rejectedWithNonEmptyCurrent('invalid', 'the model request digest disagrees with the reservation');
    if (state.prepared === null || input.manifestDigest !== state.prepared.bundleRef.digest
      || input.contextInputDigest !== state.prepared.inputDigest) {
      return rejectedWithNonEmptyCurrent('invalid', 'the model request binding disagrees with the persisted preparation');
    }
    const authorized = await authorizeCurrent(owned, { job, run, session });
    if (authorized.status !== 'ready') return toRejection(authorized);
    if (!state.entry!.permissions.tools.every(tool => authorized.value.permissions.tools.includes(tool))) {
      return rejectedWithNonEmptyCurrent('forbidden', 'the model request no longer fits the current Host and Role ceilings');
    }
    const requests = state.requests.map(candidate => candidate.requestId === modelRequestId ? { ...candidate, admitted: true } : candidate);
    const executionState: QueryExecutionStateV1 = { ...structuredClone(state), requests };
    const nextRun: QueryRunSnapshot = { ...run, revision: run.revision + 1, run: { ...run.run, executionState } };
    const event = buildRecordedEvent({
      eventId: deps.eventId(), identityKey, fingerprint, actor, occurredAt: deps.now(), queryRunRef,
      requestId, correlationId: job.job.intent.correlationId, operation: 'admitted', result: nextRun, run: nextRun,
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
    if (owned === null) return rejectedWithNonEmptyCurrent('invalid', 'the call context cannot be isolated from the caller');
    const actor = hostActor(owned);
    if (actor === null) return rejectedWithNonEmptyCurrent('forbidden', 'recordQueryObservation requires a trusted Host call context');
    let ownedRequest: GraphWrite<QueryHistoryObservation>;
    try { ownedRequest = structuredClone(request); } catch { return rejectedWithNonEmptyCurrent('invalid', 'the observation request cannot be isolated from the caller'); }
    const observation = ownedRequest?.input;
    const meta = ownedRequest?.meta;
    if (!isRecord(observation) || !isRecord(observation.entry) || !isRecord(observation.entry.queryRunRef)
      || !isRecord(observation.history) || !isRecord(observation.source) || !isRecord(observation.observation)
      || !isRecord(meta) || !nonEmpty(meta.requestId)) {
      return rejectedWithNonEmptyCurrent('invalid', 'recordQueryObservation requires a complete history observation and requestId');
    }
    let queryRunRef: QueryRunRef;
    let requestId: string;
    try {
      queryRunRef = structuredClone(observation.entry.queryRunRef) as QueryRunRef;
      requestId = meta.requestId;
    } catch { return rejectedWithNonEmptyCurrent('invalid', 'the observation request cannot be isolated from the caller'); }
    if (queryRunRef.projectId !== owned.projectId || queryRunRef.workspaceId !== owned.workspaceId) {
      return rejectedWithNonEmptyCurrent('forbidden', 'the QueryRun is outside the Host call scope');
    }
    const expected = validateExpected(meta.expected,
      { projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId, queryJobId: queryRunRef.queryJobId, runId: queryRunRef.runId },
      { job: false, run: true, session: false });
    if (expected.status === 'invalid') return rejectedWithNonEmptyCurrent('invalid', expected.reason);
    const kind = observation.observation.kind;
    const operation: QueryExecutionOperation = kind === 'entered' ? 'entered' : 'observed';
    const identityKey = kind === 'entered'
      ? `r5b-query-execution:entered:${queryRunRef.runId}:${String(observation.source.position)}`
      : kind === 'unknown'
        ? `r5b-query-execution:observed:${queryRunRef.runId}:unknown:${String(observation.source.position)}`
        : `r5b-query-execution:observed:${queryRunRef.runId}:${String(observation.source.position)}`;
    const fingerprint = requestFingerprint(operation, requestId, expected, observation);
    if (fingerprint === null) return rejectedWithNonEmptyCurrent('invalid', 'the observation request is not serializable');
    const replay = await replayOriginal<QueryExecutionRecord>(deps, identityKey, fingerprint, operation);
    if (replay !== null) return replay;

    const read = await readCore(deps, queryRunRef, null);
    if (read.status !== 'ready') return toRejection(read);
    const { job, run, session } = read.value;
    const state = run.run.executionState;
    if (state === undefined) return rejectedWithNonEmptyCurrent('incomplete', 'the QueryRun has no persisted execution state');
    if (expected.run !== run.revision) {
      return revisionConflict([{ refKey: queryRunRefKey(queryRunRef), revision: run.revision }]);
    }
    // Every kind checks the fixed entry first; the terminal machine (QRR-03) gets it as already matched.
    if (!sameRef(entryIdentity(state, queryRunRef), observation.entry)) {
      return rejectedWithNonEmptyCurrent('forbidden', 'the observation entry disagrees with the fixed Query entry');
    }
    const guards: RecordGuard[] = [{ refKey: queryRunRefKey(queryRunRef), expectedRevision: expected.run! }];
    if (kind === 'progress') return rejectedWithNonEmptyCurrent('unsupported', 'progress observations are not persisted in this batch');
    if (kind === 'entered') {
      if (state.phase !== 'entering') return rejectedWithNonEmptyCurrent('busy', `the QueryRun cannot record entered in phase ${state.phase}`);
      if (observation.history.endPosition !== null) return rejectedWithNonEmptyCurrent('invalid', 'an entered observation must not claim a terminal boundary');
      if (observation.history.startPosition > observation.source.position) return rejectedWithNonEmptyCurrent('invalid', 'the entered observation source precedes its start');
      const occurredAt = deps.now();
      const nextRun = advanceQueryExecutionRecord({ job, run }, { phase: 'entered', history: observation.history }).run;
      const nextRecord: QueryExecutionRecord = { job, run: nextRun, session, answer: null };
      const event = buildRecordedEvent({
        eventId: deps.eventId(), identityKey, fingerprint, actor, occurredAt, queryRunRef, requestId,
        correlationId: job.job.intent.correlationId, operation: 'entered', result: nextRecord, run: nextRun,
      });
      return commitOperation({
        deps, identityKey, fingerprint, guards,
        records: [encodeQueryRunSnapshotRecord(nextRun)],
        events: [encodeQueryExecutionRecordedEvent(event)],
        value: nextRecord, operation: 'entered',
      });
    }
    const fact = observation.observation;
    if (fact.kind !== 'terminal') {
      // The owner `unknown` branch has no QRR row; it and a malformed kind meet the settled refusal first, as before.
      if (state.phase === 'settled') return rejectedWithNonEmptyCurrent('busy', 'the QueryRun is already settled');
      if (fact.kind !== 'unknown') return rejectedWithNonEmptyCurrent('invalid', 'the observation is not a terminal fact');
      if (!nonEmpty(fact.reason)) return rejectedWithNonEmptyCurrent('invalid', 'an unknown observation requires a reason');
      const nextRun = markQueryRunUnknownRecord(run, { history: { kind: 'set', history: observation.history } });
      const nextRecord: QueryExecutionRecord = { job, run: nextRun, session, answer: null };
      const event = buildRecordedEvent({
        eventId: deps.eventId(), identityKey, fingerprint, actor, occurredAt: deps.now(), queryRunRef,
        requestId: requestId, correlationId: job.job.intent.correlationId, operation: 'observed', result: nextRecord, run: nextRun,
      });
      return commitOperation({
        deps, identityKey, fingerprint, guards,
        records: [encodeQueryRunSnapshotRecord(nextRun)],
        events: [encodeQueryExecutionRecordedEvent(event)],
        value: nextRecord, operation: 'observed',
      });
    }
    // QRR-03 (K source): the settled, Answer and end-boundary refusals; SES-08 releases the Session only
    // while this claim generation still holds it. The Runtime confirms the accepted inputs before it books a terminal.
    const settled = transitionQueryRunRecovery(queryRecoveryStateOf(job.job, run.run)!, {
      kind: 'query_terminal_observed',
      terminal: { outcome: fact.outcome, answer: fact.answer, reason: fact.reason, history: observation.history, source: observation.source },
    }, {
      caller: 'service', hostLease: null, probe: null, kernel: null, inputsConfirmed: true, actor: actor.kind, reason: null,
      sessionOwned: ownsQuery(session, queryRunRef, state), sessionGeneration: state.sessionGeneration, queryRunRef, entryMatches: true,
    });
    if (!settled.ok) return rejectedWithNonEmptyCurrent(settled.code, settled.detail);
    const occurredAt = deps.now();
    const next = settledRecords({ job, run, session }, state.phase, settled.effects, occurredAt);
    if ('status' in next) return next;
    const nextRecord: QueryExecutionRecord = { job: next.job, run: next.run, session: next.session ?? session, answer: next.answer };
    const event = buildRecordedEvent({
      eventId: deps.eventId(), identityKey, fingerprint, actor, occurredAt, queryRunRef, requestId,
      correlationId: job.job.intent.correlationId, operation: 'observed', result: nextRecord, run: next.run,
    });
    const records: EncodedRecord[] = [encodeQueryRunSnapshotRecord(next.run), encodeQueryJobSnapshot(next.job)];
    if (next.answer !== null) records.push(encodeQueryJobAnswerSnapshot(next.answer));
    if (next.session !== null) records.push(encodeSessionRecord(next.session));
    const events = [encodeQueryExecutionRecordedEvent(event)];
    if (next.answer !== null) {
      events.push(encodeQueryJobAnsweredEvent({
        eventId: deps.eventId(), eventType: 'QueryJobAnswered', schemaVersion: 1,
        projectId: queryRunRef.projectId, workspaceId: queryRunRef.workspaceId,
        aggregateType: 'QueryJobAnswer', aggregateId: next.answer.ref.answerId, aggregateRevision: 1,
        causationId: identityKey, correlationId: job.job.intent.correlationId, idempotencyKey: requestId,
        actor: { ...actor }, occurredAt, payload: { answer: structuredClone(next.answer) },
      }));
    }
    const terminalGuards: RecordGuard[] = [
      ...guards,
      { refKey: queryJobRefKey(queryJobRefFor(queryRunRef)), expectedRevision: job.revision },
      { refKey: sessionKeyOf(session.ref), expectedRevision: session.revision },
    ];
    if (next.answer !== null) terminalGuards.push({ refKey: queryJobAnswerRefKey(next.answer.ref), expectedRevision: null });
    return commitOperation({
      deps, identityKey, fingerprint, guards: terminalGuards, records, events, value: nextRecord, operation: 'observed',
    });
  }

  /** The trusted Host actor and the request identity of one recovery write (`content` is what the fingerprint covers). */
  function recoveryIdentity(
    ctx: CoreCallContext, queryRunRef: QueryRunRef, requestId: string, expectedRun: number, content: unknown,
  ): { ok: true; actor: HostActor; identityKey: string; fingerprint: string } | { ok: false; rejection: CoreRejection } {
    const owned = ownContext(ctx);
    if (owned === null) return { ok: false, rejection: rejectedWithNonEmptyCurrent('invalid', 'the call context cannot be isolated from the caller') };
    const actor = hostActor(owned);
    if (actor === null) {
      return { ok: false, rejection: rejectedWithNonEmptyCurrent('forbidden', 'a QueryRun reconcile requires a trusted Host call context') };
    }
    if (queryRunRef.projectId !== owned.projectId || queryRunRef.workspaceId !== owned.workspaceId) {
      return { ok: false, rejection: rejectedWithNonEmptyCurrent('forbidden', 'the QueryRun is outside the Host call scope') };
    }
    const identityKey = `a2-query-recovery:${queryRunRef.runId}:${sha256Hex(canonicalJson({ actor, requestId } as unknown as JsonValue))}`;
    const fingerprint = requestFingerprint('observed', requestId, { job: null, run: expectedRun, session: null }, content);
    if (fingerprint === null) return { ok: false, rejection: rejectedWithNonEmptyCurrent('invalid', 'the reconcile request is not serializable') };
    return { ok: true, actor, identityKey, fingerprint };
  }

  /**
   * QRR-01/02/04/05 (R) and QRR-06 (U): one stranded QueryRun settled or marked
   * unknown in one commit with its QueryJob and the Session release (SES-09,
   * SES-10: the cursor is kept; a Turn left open makes the Session
   * `kernel_turn_open`). The identity is the QueryRun and this Host instance, so
   * a repeated reconcile replays its receipt.
   */
  async function settleRecovery(
    ctx: CoreCallContext, queryRunRef: QueryRunRef, requestId: string, expectedRun: number, content: unknown,
    eventOf: (state: QueryExecutionStateV1) => RecoveryStep,
  ): Promise<WriteResult<QueryExecutionRecord>> {
    const identity = recoveryIdentity(ctx, queryRunRef, requestId, expectedRun, content);
    if (!identity.ok) return identity.rejection;
    const { actor, identityKey, fingerprint } = identity;
    const replay = await replayOriginal<QueryExecutionRecord>(deps, identityKey, fingerprint, 'observed');
    if (replay !== null) return replay;
    const read = await readCore(deps, queryRunRef, null);
    if (read.status !== 'ready') return toRejection(read);
    const { job, run, session } = read.value;
    const state = run.run.executionState;
    const recovery = queryRecoveryStateOf(job.job, run.run);
    if (state === undefined || recovery === null) return rejectedWithNonEmptyCurrent('incomplete', 'the QueryRun has no persisted execution state');
    if (expectedRun !== run.revision) return revisionConflict([{ refKey: queryRunRefKey(queryRunRef), revision: run.revision }]);
    const { event, guard, cause, turnSeen } = eventOf(state);
    const decided = transitionQueryRunRecovery(recovery, event, { ...guard, sessionOwned: ownsQuery(session, queryRunRef, state),
      sessionGeneration: state.sessionGeneration, queryRunRef, entryMatches: entryIdentity(state, queryRunRef) !== null });
    if (!decided.ok) return rejectedWithNonEmptyCurrent(decided.code, decided.detail);
    const occurredAt = deps.now();
    let nextRun: QueryRunSnapshot = run;
    let nextJob: QueryJobSnapshot = job;
    let nextSession: SessionRecord | null = null;
    for (const effect of decided.effects) {
      switch (effect.kind) {
        case 'settle_query': {
          const settled = settleQueryRunRecord({ job, run }, { settlement: effect.settlement, history: effect.history, occurredAt });
          nextRun = settled.run;
          nextJob = settled.job;
          break;
        }
        case 'mark_query_unknown':
          nextRun = markQueryRunUnknownRecord(run, { history: effect.history, cause: effect.cause });
          break;
        case 'release_session': {
          const released = transitionSession(sessionMachineStateOf(session), { kind: 'occupancy_released', cause }, {
            caller: guard.caller === 'reconcile' ? 'reconcile' : 'service', hostLease: guard.hostLease, pin: null,
            holder: { ref: effect.holder, claimGeneration: effect.generation, before: `query_${state.phase}`, after: 'query_settled',
              kernelTurnSeen: turnSeen, inputsConfirmed: guard.inputsConfirmed, historyBoundaryCursor: null,
              kernelTurnOpen: effect.kernelTurnOpen },
            probe: guard.probe === null ? null : guard.probe, kernelHeader: null, openResponsibleLink: null, creation: null, link: null,
          });
          if (!released.ok) return rejectedWithNonEmptyCurrent(released.code, released.detail);
          for (const sessionEffect of released.effects) {
            if (sessionEffect.kind === 'release_session') nextSession = releaseSessionRecord(session, sessionEffect);
          }
          break;
        }
        case 'record_answer':
          throw new Error('a reconcile close records no Answer');
        default: throw new Error('an unknown Query recovery effect');
      }
    }
    const nextRecord: QueryExecutionRecord = { job: nextJob, run: nextRun, session: nextSession ?? session, answer: null };
    const recorded = buildRecordedEvent({ eventId: deps.eventId(), identityKey, fingerprint, actor, occurredAt, queryRunRef, requestId,
      correlationId: job.job.intent.correlationId, operation: 'observed', result: nextRecord, run: nextRun });
    const records: EncodedRecord[] = [encodeQueryRunSnapshotRecord(nextRun)];
    if (nextJob !== job) records.push(encodeQueryJobSnapshot(nextJob));
    if (nextSession !== null) records.push(encodeSessionRecord(nextSession));
    return commitOperation({ deps, identityKey, fingerprint, guards: [
      { refKey: queryRunRefKey(queryRunRef), expectedRevision: run.revision },
      { refKey: queryJobRefKey(queryJobRefFor(queryRunRef)), expectedRevision: job.revision },
      { refKey: sessionKeyOf(session.ref), expectedRevision: session.revision },
    ], records, events: [encodeQueryExecutionRecordedEvent(recorded)], value: nextRecord, operation: 'observed' });
  }

  async function reconcileQuery(ctx: CoreCallContext, request: GraphWrite<QueryReconcileInput>): Promise<WriteResult<QueryExecutionRecord>> {
    let input: QueryReconcileInput;
    let requestId: string;
    let expectedRun: number;
    try {
      input = structuredClone(request.input);
      requestId = request.meta.requestId;
      const pin = queryRunPinOf(request.meta.expected, (input as { queryRunRef?: unknown } | null)?.queryRunRef);
      if (pin === null) return rejectedWithNonEmptyCurrent('invalid', 'meta.expected must be exactly the QueryRun pin');
      expectedRun = pin;
    } catch { return rejectedWithNonEmptyCurrent('invalid', 'the reconcile request cannot be isolated from the caller'); }
    if (!isRecord(input) || !isRecord(input.queryRunRef) || !nonEmpty(input.hostInstanceId) || !isRecord(input.result) || !nonEmpty(requestId)) {
      return rejectedWithNonEmptyCurrent('invalid', 'reconcileQueryRun requires the QueryRun, the Host instance and the classification');
    }
    const host = deps.hostInstance;
    const hostLease: 'owned' | 'held_by_other' | null = host === undefined ? null
      : host.lease === 'owned' && host.hostInstanceId === input.hostInstanceId ? 'owned' : 'held_by_other';
    const result = input.result;
    return settleRecovery(ctx, input.queryRunRef, requestId, expectedRun, input, (state): RecoveryStep => {
      const base = { caller: 'reconcile' as const, hostLease, probe: input.probe, inputsConfirmed: input.inputsConfirmed,
        actor: 'system' as const, reason: null };
      switch (result.kind) {
        case 'not_entered':
          // Q-01 needs no probe (begin commits `entering` before the Kernel starts); Q-02 needs a readable Kernel.
          return { event: { kind: 'query_reconcile_not_entered', hostInstanceId: input.hostInstanceId },
            guard: { ...base, probe: state.phase === 'entering' ? input.probe : null, kernel: state.phase === 'entering' && input.probe === 'ready'
              ? { turn: 'absent', mappedOutcome: null, boundaryComplete: false, unresolvedToolCallIds: [] } : null },
            cause: 'query_reconcile_not_entered', turnSeen: false };
        case 'interrupted_clean':
          return { event: { kind: 'query_reconcile_interrupted_clean', hostInstanceId: input.hostInstanceId,
            kernelStatus: result.kernelStatus, history: result.history },
          guard: { ...base, kernel: { turn: 'present', mappedOutcome: null, boundaryComplete: false, unresolvedToolCallIds: [] },
            kernelTurnOpen: result.kernelStatus !== 'yielded' },
          cause: 'query_reconcile_interrupted_clean', turnSeen: true };
        case 'unknown': {
          const verdict = input.probe;
          return { event: { kind: 'query_reconcile_unknown', hostInstanceId: input.hostInstanceId,
            cause: verdict === 'missing' || verdict === 'damaged' ? { kind: 'kernel_unreadable', verdict }
              : { kind: 'unresolved_tools', toolCallIds: result.unresolvedToolCallIds }, history: result.history },
          guard: { ...base, kernel: null }, cause: 'query_reconcile_not_entered', turnSeen: true };
        }
        default: throw new Error('an unknown Query reconcile result');
      }
    });
  }

  async function resolveUnknownQuery(
    ctx: CoreCallContext, request: GraphWrite<ResolveUnknownQueryRunInput>,
  ): Promise<WriteResult<QueryExecutionRecord>> {
    let input: ResolveUnknownQueryRunInput;
    let requestId: string;
    let expectedRun: number;
    try {
      input = structuredClone(request.input);
      requestId = request.meta.requestId;
      const pin = queryRunPinOf(request.meta.expected, (input as { queryRunRef?: unknown } | null)?.queryRunRef);
      if (pin === null) return rejectedWithNonEmptyCurrent('invalid', 'meta.expected must be exactly the QueryRun pin');
      expectedRun = pin;
    } catch { return rejectedWithNonEmptyCurrent('invalid', 'the attestation request cannot be isolated from the caller'); }
    if (!isRecord(input) || !isRecord(input.queryRunRef) || typeof input.reason !== 'string' || typeof input.kernelTurnOpen !== 'boolean'
      || !nonEmpty(requestId)) {
      return rejectedWithNonEmptyCurrent('invalid', 'resolveUnknownQueryRun requires the QueryRun, a reason and the Kernel facts');
    }
    if (input.reason.length > MAX_ATTESTATION_REASON_CHARS) {
      return rejectedWithNonEmptyCurrent('invalid', `the attestation reason must be at most ${String(MAX_ATTESTATION_REASON_CHARS)} characters`);
    }
    const actor = hostActor(ctx);
    const host = deps.hostInstance;
    return settleRecovery(ctx, input.queryRunRef, requestId, expectedRun, attestationContent(input), (): RecoveryStep => ({
      event: { kind: 'query_unknown_attested' },
      guard: { caller: 'host_entry', hostLease: host === undefined ? null : host.lease, probe: null, kernel: null,
        inputsConfirmed: input.inputsConfirmed === null ? 'kernel_unreadable' : input.inputsConfirmed,
        actor: actor === null || isAutomationActor(actor) ? 'system' : 'human', reason: input.reason, kernelTurnOpen: input.kernelTurnOpen },
      cause: 'query_unknown_attested', turnSeen: true,
    }));
  }

  /**
   * QRR-06 同请求身份重放 (§12.10 step 4): the original receipt of an
   * attestation committed under this request identity, or `null` when none
   * was. The Host entry asks before it compares the pin and the QueryRun's
   * phase, both of which the attestation itself changed. The same identity
   * with other content is `idempotency_conflict` (§1.2), and a failed lookup
   * is reported, so neither falls through to the phase comparison.
   */
  async function replayResolveUnknownQuery(
    ctx: CoreCallContext, request: GraphWrite<Pick<ResolveUnknownQueryRunInput, 'queryRunRef' | 'reason'>>,
  ): Promise<WriteResult<QueryExecutionRecord> | null> {
    let input: Pick<ResolveUnknownQueryRunInput, 'queryRunRef' | 'reason'>;
    let requestId: string;
    let expectedRun: number | null;
    try {
      input = structuredClone(request.input);
      requestId = request.meta.requestId;
      expectedRun = queryRunPinOf(request.meta.expected, (input as { queryRunRef?: unknown } | null)?.queryRunRef);
    } catch { return null; }
    if (expectedRun === null || !isRecord(input) || !isRecord(input.queryRunRef) || typeof input.reason !== 'string'
      || !nonEmpty(requestId)) {
      return null;
    }
    const identity = recoveryIdentity(ctx, input.queryRunRef, requestId, expectedRun, attestationContent(input));
    if (!identity.ok) return null;
    return replayOriginal<QueryExecutionRecord>(deps, identity.identityKey, identity.fingerprint, 'observed');
  }

  return {
    async reconcileQueryRun(ctx, request) { return reconcileQuery(ctx, request); },
    async resolveUnknownQueryRun(ctx, request) { return resolveUnknownQuery(ctx, request); },
    async replayResolveUnknownQueryRun(ctx, request) { return replayResolveUnknownQuery(ctx, request); },
    async readQueryExecution(ctx, ref) {
      const owned = ownContext(ctx);
      if (owned === null) return rejectedWithNonEmptyCurrent('invalid', 'the call context cannot be isolated from the caller');
      if (hostActor(owned) === null) return rejectedWithNonEmptyCurrent('forbidden', 'readQueryExecution requires a trusted Host call context');
      if (!isRecord(ref) || ref.aggregateType !== 'QueryRun' || !nonEmpty(ref.projectId)
        || !nonEmpty(ref.workspaceId) || !nonEmpty(ref.queryJobId) || !nonEmpty(ref.runId)) {
        return rejectedWithNonEmptyCurrent('invalid', 'readQueryExecution requires a complete QueryRunRef');
      }
      let queryRunRef: QueryRunRef;
      try { queryRunRef = structuredClone(ref) as QueryRunRef; } catch { return rejectedWithNonEmptyCurrent('invalid', 'the read request cannot be isolated from the caller'); }
      if (queryRunRef.projectId !== owned.projectId || queryRunRef.workspaceId !== owned.workspaceId) {
        return rejectedWithNonEmptyCurrent('forbidden', 'the QueryRun is outside the Host call scope');
      }
      return readExecutionRecord(deps, queryRunRef);
    },
    async readPreparationFacts(ctx, ref) {
      const owned = ownContext(ctx);
      if (owned === null) return rejectedWithNonEmptyCurrent('invalid', 'the call context cannot be isolated from the caller');
      if (hostActor(owned) === null) return rejectedWithNonEmptyCurrent('forbidden', 'readPreparationFacts requires a trusted Host call context');
      if (!isRecord(ref) || ref.aggregateType !== 'QueryRun' || !nonEmpty(ref.projectId)
        || !nonEmpty(ref.workspaceId) || !nonEmpty(ref.queryJobId) || !nonEmpty(ref.runId)) {
        return rejectedWithNonEmptyCurrent('invalid', 'readPreparationFacts requires a complete QueryRunRef');
      }
      let queryRunRef: QueryRunRef;
      try { queryRunRef = structuredClone(ref) as QueryRunRef; } catch { return rejectedWithNonEmptyCurrent('invalid', 'the read request cannot be isolated from the caller'); }
      if (queryRunRef.projectId !== owned.projectId || queryRunRef.workspaceId !== owned.workspaceId) {
        return rejectedWithNonEmptyCurrent('forbidden', 'the QueryRun is outside the Host call scope');
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
      if (owned === null) return rejectedWithNonEmptyCurrent('invalid', 'the call context cannot be isolated from the caller');
      if (hostActor(owned) === null) return rejectedWithNonEmptyCurrent('forbidden', 'readQueryAnswer requires a trusted Host call context');
      if (!isRecord(ref) || ref.aggregateType !== 'QueryJobAnswer' || !nonEmpty(ref.projectId)
        || !nonEmpty(ref.workspaceId) || !nonEmpty(ref.queryJobId) || !nonEmpty(ref.answerId)) {
        return rejectedWithNonEmptyCurrent('invalid', 'readQueryAnswer requires a complete QueryJobAnswerRef');
      }
      if (ref.projectId !== owned.projectId || ref.workspaceId !== owned.workspaceId) {
        return rejectedWithNonEmptyCurrent('forbidden', 'the Query answer ref is outside the Host call scope');
      }
      return readAnswerByRef(deps, ref);
    },
  };
}
