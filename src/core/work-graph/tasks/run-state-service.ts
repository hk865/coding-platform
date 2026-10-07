/**
 * R4c.2a — exact Task execution read.
 *
 * One `readExecution` binds the trusted Host scope synchronously and then makes
 * exactly THREE directed `readMany` windows per round:
 *   1. `[runKey]` — locate the Run named by the requested `RunRef`;
 *   2. `[outboxKey]` — locate the claim-linked dispatch outbox, only to resolve
 *      the Session it names; the Plan/TaskAttempt/Lease are NOT re-read here;
 *   3. one FINAL window re-reading all six records.
 *
 * Only the final window is authoritative: its records and its watermark decide
 * the result. A retry happens ONLY when a reference decoded from the final
 * records no longer addresses the keys actually read (Run-derived Attempt/
 * outbox/Lease/Plan keys, or the Session named by a present outbox); the whole
 * window is retried at most 4 rounds, then `busy`. Unrelated commits never force
 * a retry and never change the read count. `atLeastCursor` is strictly validated
 * with the existing ledger cursor parser before any store read (`invalid`
 * otherwise) and is compared against the FINAL window watermark only.
 *
 * A missing Run is `not_found` (that read's watermark is checked first); a
 * missing claim-linked record is `incomplete`; a damaged, unaccounted (neither
 * returned nor reported missing) or internally inconsistent record is
 * `unavailable`; a self-consistent Host whose workspace is not the claim
 * workspace is `forbidden`. Session and Lease are returned as CURRENT facts
 * (archived/health/occupancy/holder may have moved on). This is a read only: it
 * never authorizes, starts, writes or releases anything.
 */
import type { ActorRef, CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext, MaterialReader } from '../../../contracts/core/call-context.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type {
  RunRef,
  RunSnapshot,
  TaskAttemptSnapshot,
  TaskLeaseSnapshot,
  TaskTriple,
} from '../../../contracts/dispatch.js';
import type { PlanRevisionSnapshot } from '../../../contracts/plan.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { seqOfCommitCursor } from '../../../contracts/ledger.js';
import type { ArtifactRef } from '../../../contracts/artifact.js';
import { CONTINUATION_BRIEF_LIMITS } from '../../../contracts/continuation-brief.js';
import type { ControlIntentRef, ControlIntentSnapshotV1 } from '../../../contracts/control-intent.js';
import type { TaskRequeueSnapshotV1 } from '../../../contracts/task-requeue.js';
import type { RoundSnapshot } from '../../../contracts/verification.js';
import type { LookupValue, RecordLookupPort, RecordLookupRequest } from '../../record-store/lookup-ports.js';
import type { DecodeResult, EncodedRecord } from '../../record-store/ports.js';
import type { RawArtifactRecord } from '../../record-store/body-ports.js';
import type { SessionMessage } from '../communication/contracts.js';
import { decodeStoredMessageBody } from '../communication/message-body-envelope.js';
import { decodeSessionMessageRecord, sessionMessageRefKey } from '../communication/message-record-codecs.js';
import { decodeVerificationRoundSnapshot } from '../evidence/evidence-record-codecs.js';
import { decodeControlIntentSnapshot } from '../persistence/control-record-codecs.js';
import { materialRecordSchemas } from '../materials/record-readers.js';
import {
  decodeSessionRecord,
  plainSessionRefToAggregate,
  sessionAggregateRefKey,
} from '../sessions/session-record-codecs.js';
import {
  decodeDispatchOutboxEntry,
  decodeTaskAttemptSnapshot,
  decodeTaskRequeueSnapshot,
  dispatchOutboxRefKey,
  taskAttemptRefKey,
  taskRequeueRefKey,
} from './claim-record-codecs.js';
import type { TaskClaimOutbox } from './claim-contracts.js';
import { decodePlanRevisionSnapshot, planRevisionRefKey } from './plan-record-codecs.js';
import {
  PLAN_STATE_RECORD_SCHEMAS,
  laterCursor,
  readBatch,
  type ReadBatch,
  type Rejected,
} from './plan-readers.js';
import type {
  ContinuationBasis,
  ExecutionListPageRequest,
  ExecutionReadDependencies,
  ExecutionReadPort,
  TaskExecutionRecord,
  TaskExecutionPage,
} from './execution-read-contracts.js';

const RUN_SNAPSHOT_SCHEMA_ID = 'RunSnapshot@1';
const TASK_LEASE_SCHEMA_ID = 'TaskLeaseSnapshot@1';
/** Bounded final-window retries before a read is reported `busy`. */
const MAX_ROUNDS = 4;

/** Selected ONCE from the modules that already own and register these schemas.
 * The rules are not copied, re-registered or scanned per record. */
const RUN_VALIDATE = materialRecordSchemas().records
  .find(candidate => candidate.schemaId === RUN_SNAPSHOT_SCHEMA_ID)?.validate;
const LEASE_VALIDATE = PLAN_STATE_RECORD_SCHEMAS.records
  .find(candidate => candidate.schemaId === TASK_LEASE_SCHEMA_ID)?.validate;

// --------------------------------------------------------------------------
// Small pure helpers
// --------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function sameHostActor(left: unknown, right: unknown): boolean {
  return isRecord(left) && isRecord(right) && left['kind'] === right['kind'] && left['id'] === right['id'];
}
function reject(code: CoreRejection['code'], reason: string): CoreRejection {
  return { status: 'rejected', code, reason };
}
function forbidden(reason: string): CoreRejection { return reject('forbidden', reason); }
function invalid(reason: string): CoreRejection { return reject('invalid', reason); }
function incomplete(reason: string): CoreRejection { return reject('incomplete', reason); }
function unavailable(reason: string): CoreRejection { return reject('unavailable', reason); }
function mapRejected(rejection: Rejected): CoreRejection {
  return reject(rejection.code, rejection.reason);
}
function refKeyOf(value: object): string | null {
  try { return canonicalJson(value as unknown as JsonValue); } catch { return null; }
}
function parseBody(json: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(json) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function unique(keys: readonly string[]): string[] {
  return [...new Set(keys)];
}

type Presence = 'present' | 'missing' | 'unaccounted';
function presenceOf(batch: ReadBatch, refKey: string): Presence {
  if (batch.present.has(refKey)) return 'present';
  if (batch.missing.has(refKey)) return 'missing';
  return 'unaccounted';
}

/** Shared with the C1 mailbox historical-identity reader; this is the ONE Run
 * schema-checked decoder, not a new lenient parser. */
export type Decoded<T> = { ok: true; value: T } | { ok: false; reason: string };

export function decodeRun(record: EncodedRecord): Decoded<RunSnapshot> {
  if (RUN_VALIDATE === undefined) return { ok: false, reason: 'the RunSnapshot schema is not registered' };
  const checked = RUN_VALIDATE(record);
  if (checked.status !== 'decoded') return { ok: false, reason: checked.reason };
  const body = parseBody(record.json);
  if (body === null) return { ok: false, reason: 'the Run snapshot is not a JSON object' };
  return { ok: true, value: body as unknown as RunSnapshot };
}
function decodeLease(record: EncodedRecord): Decoded<TaskLeaseSnapshot> {
  if (LEASE_VALIDATE === undefined) return { ok: false, reason: 'the TaskLeaseSnapshot schema is not registered' };
  const checked = LEASE_VALIDATE(record);
  if (checked.status !== 'decoded') return { ok: false, reason: checked.reason };
  const body = parseBody(record.json);
  if (body === null) return { ok: false, reason: 'the TaskLease snapshot is not a JSON object' };
  return { ok: true, value: body as unknown as TaskLeaseSnapshot };
}

function attemptKeyOf(task: TaskTriple, attemptId: string): string {
  return taskAttemptRefKey({ aggregateType: 'TaskAttempt', projectId: task.projectId,
    goalId: task.goalId, taskId: task.taskId, attemptId });
}
function outboxKeyOf(task: TaskTriple, attemptId: string): string {
  return dispatchOutboxRefKey({ aggregateType: 'DispatchOutboxEntry', projectId: task.projectId,
    goalId: task.goalId, taskId: task.taskId, attemptId });
}
function leaseKeyOf(task: TaskTriple): string {
  return canonicalJson({ aggregateType: 'TaskLease', projectId: task.projectId,
    goalId: task.goalId, taskId: task.taskId } as unknown as JsonValue);
}
function sessionKeyOf(ref: { projectId: string; sessionId: string }): string {
  return sessionAggregateRefKey(plainSessionRefToAggregate(ref));
}
function isRunRef(value: unknown): value is RunRef {
  return isRecord(value) && value['aggregateType'] === 'Run'
    && nonEmpty(value['projectId']) && nonEmpty(value['goalId']) && nonEmpty(value['runId']);
}
/** Strict ledger-cursor sequence; an unparseable value is never accepted.
 * `seqOfCommitCursor` stringifies its input, so the string boundary is checked
 * here first; otherwise a one-element array would stringify into a valid cursor. */
function cursorSequence(cursor: CommitCursor): number | null {
  if (typeof cursor !== 'string') return null;
  try { return seqOfCommitCursor(cursor); } catch { return null; }
}
function watermarkSatisfied(readThrough: CommitCursor | null, atLeastSeq: number | undefined): boolean {
  if (atLeastSeq === undefined) return true;
  if (readThrough === null) return false;
  const observedSeq = cursorSequence(readThrough);
  return observedSeq !== null && observedSeq >= atLeastSeq;
}
function notReadyResult(observed: CommitCursor | null, required: CommitCursor): ReadResult<TaskExecutionRecord> {
  return { status: 'not_ready',
    observed: observed === null ? null : { kind: 'platform', cursor: observed },
    required: { kind: 'platform', cursor: required } };
}

// --------------------------------------------------------------------------
// Synchronous input isolation and Host scope
// --------------------------------------------------------------------------

type OwnedCtx =
  | { ok: true; ctx: CoreCallContext; actor: Extract<ActorRef, { kind: 'human' | 'system' }> }
  | { ok: false; rejection: CoreRejection };

/** Bind the trusted Host scope and identity before the first await; the original
 * AbortSignal is kept by reference so cancellation can never be lost. */
function ownCallContext(ctx: CoreCallContext): OwnedCtx {
  const raw = ctx as unknown as {
    projectId?: unknown; workspaceId?: unknown; principal?: unknown; materialReader?: unknown; signal?: unknown;
  } | null | undefined;
  if (raw === null || raw === undefined) {
    return { ok: false, rejection: invalid('readExecution requires a bound call context') };
  }
  const projectId = raw.projectId;
  const workspaceId = raw.workspaceId;
  if (!nonEmpty(projectId) || !nonEmpty(workspaceId)) {
    return { ok: false, rejection: forbidden('readExecution requires a bound project/workspace context') };
  }
  const signal = raw.signal;
  if (!isRecord(signal) || typeof signal['aborted'] !== 'boolean'
    || typeof signal['addEventListener'] !== 'function') {
    return { ok: false, rejection: forbidden('readExecution requires the bound AbortSignal') };
  }
  let principal: unknown;
  let materialReader: unknown;
  try {
    principal = structuredClone(raw.principal);
    materialReader = structuredClone(raw.materialReader);
  } catch {
    return { ok: false, rejection: invalid('the call context identity cannot be isolated from the caller') };
  }
  if (!isRecord(principal) || principal['kind'] !== 'host') {
    return { ok: false, rejection: forbidden('readExecution requires a trusted Host principal') };
  }
  const actor = principal['actor'];
  if (!isRecord(actor) || (actor['kind'] !== 'human' && actor['kind'] !== 'system') || !nonEmpty(actor['id'])) {
    return { ok: false, rejection: forbidden('readExecution requires a trusted Host actor') };
  }
  if (!isRecord(materialReader) || materialReader['kind'] !== 'host'
    || materialReader['projectId'] !== projectId
    || (materialReader['workspaceId'] !== undefined && materialReader['workspaceId'] !== workspaceId)
    || !sameHostActor(materialReader['actor'], actor)) {
    return { ok: false, rejection: forbidden('the material reader is not the same trusted Host scope') };
  }
  return {
    ok: true,
    ctx: {
      projectId, workspaceId,
      principal: principal as CoreCallContext['principal'],
      materialReader: materialReader as MaterialReader,
      signal: signal as unknown as AbortSignal,
    },
    actor: { kind: actor['kind'], id: actor['id'] },
  };
}

// --------------------------------------------------------------------------
// Final-window cross references
// --------------------------------------------------------------------------

type RequestedKeys = {
  runKey: string;
  attemptKey: string;
  outboxKey: string;
  leaseKey: string;
  planKey: string;
  sessionKey: string | undefined;
  projectId: string;
};

/** Every final-window reference must agree; a disagreement is a broken link
 * (`unavailable`), never silently accepted as a different historical truth. */
function verifyChain(
  run: RunSnapshot,
  attempt: TaskAttemptSnapshot,
  outbox: TaskClaimOutbox,
  plan: PlanRevisionSnapshot,
  session: SessionRecord | undefined,
  lease: TaskLeaseSnapshot | null,
  requested: RequestedKeys,
): CoreRejection | null {
  if (refKeyOf(run.ref) !== requested.runKey) return unavailable('the Run ref is not the requested key');
  if (run.task.projectId !== requested.projectId) return unavailable('the Run task belongs to another project');
  if (run.ref.goalId !== run.task.goalId) return unavailable('the Run ref goal disagrees with its task');
  if (run.workspaceSnapshot.workspaceId !== outbox.claim.workspaceId) {
    return unavailable('the Run workspace disagrees with the claim workspace');
  }
  if (refKeyOf(attempt.ref) !== requested.attemptKey) return unavailable('the TaskAttempt ref is not the claimed key');
  if (attempt.runId !== run.ref.runId) return unavailable('the TaskAttempt names another Run');
  if (attempt.ref.taskId !== run.task.taskId) return unavailable('the TaskAttempt names another Task');
  if (planRevisionRefKey(attempt.planRef) !== requested.planKey) return unavailable('the TaskAttempt names another Plan');

  if (refKeyOf(outbox.ref) !== requested.outboxKey) return unavailable('the dispatch outbox ref is not the claimed key');
  if (refKeyOf(outbox.claim.runRef) !== requested.runKey) return unavailable('the claim names another Run');
  if (refKeyOf(outbox.claim.attemptRef) !== requested.attemptKey) return unavailable('the claim names another Attempt');
  if (refKeyOf(outbox.claim.outboxRef) !== requested.outboxKey) return unavailable('the claim names another outbox');
  if (planRevisionRefKey(outbox.claim.planRef) !== requested.planKey) return unavailable('the claim names another Plan');
  if (outbox.claim.task.projectId !== run.task.projectId
    || outbox.claim.task.goalId !== run.task.goalId
    || outbox.claim.task.taskId !== run.task.taskId) {
    return unavailable('the claim task disagrees with the Run task');
  }

  if (refKeyOf(plan.ref) !== requested.planKey) return unavailable('the Plan ref is not the claimed key');
  if (plan.goalRef.projectId !== requested.projectId || plan.goalRef.goalId !== run.ref.goalId) {
    return unavailable('the Plan belongs to another goal');
  }
  if (!plan.tasks.some(task => task.taskId === run.task.taskId)) {
    return unavailable('the Plan does not contain the claimed Task');
  }

  if (requested.sessionKey !== undefined) {
    if (session === undefined) return unavailable('the claim Session record is unavailable');
    if (refKeyOf(session.ref) !== requested.sessionKey) return unavailable('the Session ref is not the claimed key');
    if (session.ref.projectId !== requested.projectId) return unavailable('the Session belongs to another project');
    if (session.workspaceId !== outbox.claim.workspaceId) return unavailable('the Session workspace disagrees with the claim');
  }
  if (lease !== null && refKeyOf(lease.ref) !== requested.leaseKey) return unavailable('the Lease ref is not the claimed key');
  return null;
}

// --------------------------------------------------------------------------
// Bounded execution list (MVP UI connection)
// --------------------------------------------------------------------------

/** The exact candidate indexes registered by `PLAN_STATE_RECORD_SCHEMAS`; this
 * reader only consumes them and never registers a second index or schema. */
const RUN_BY_GOAL_INDEX = 'r3c-run-by-goal';
const RUN_BY_TASK_INDEX = 'r4c-run-by-task';
/** One page is 1-100; the candidate lookup gathers at most one extra Run. */
const LIST_PAGE_LIMIT_MAX = 100;

/** Opaque list cursor: bound to the exact scope/Goal/Task query and the
 * exclusive canonical key of the last Run returned by the previous page. */
type ExecutionListCursor = {
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  goalId: string;
  taskId: string | null;
  after: string;
};

function encodeExecutionListCursor(cursor: ExecutionListCursor): string {
  return canonicalJson(cursor as unknown as JsonValue);
}

function decodeExecutionListCursor(raw: string): ExecutionListCursor | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!isRecord(parsed) || parsed['schemaVersion'] !== 1) return null;
  const projectId = parsed['projectId'];
  const workspaceId = parsed['workspaceId'];
  const goalId = parsed['goalId'];
  const after = parsed['after'];
  const taskId = parsed['taskId'];
  if (!nonEmpty(projectId) || !nonEmpty(workspaceId) || !nonEmpty(goalId) || !nonEmpty(after)) return null;
  if (taskId !== null && !nonEmpty(taskId)) return null;
  return { schemaVersion: 1, projectId, workspaceId, goalId, taskId: taskId === null ? null : taskId, after };
}

/** Locate one RunRef from a candidate index refKey. The canonical
 * `readExecution` still re-reads and validates the Run; this is a locator only. */
function runRefFromCandidateKey(refKey: string): RunRef | null {
  let parsed: unknown;
  try { parsed = JSON.parse(refKey); } catch { return null; }
  return isRunRef(parsed) ? parsed : null;
}

/**
 * Candidate lookup over the EXISTING Run-by-Goal / Run-by-Task index. It
 * gathers at most `desired` keys, using the index's own exclusive
 * `after` cursor in one bounded lookup; a missing/unregistered index is
 * `incomplete`, never an empty page.
 */
/** The candidate-index capability of the SAME records backend. The dependency
 * type declares the optional capability explicitly, so no cast or `any` is
 * needed; a records port without it yields `null` and the list read is
 * `incomplete`, never an empty page. */
function lookupPortOf(records: ExecutionReadDependencies['records']): RecordLookupPort | null {
  const lookup = records.lookup;
  return lookup === undefined ? null : { lookup: lookup.bind(records) };
}

async function collectRunCandidateKeys(
  lookups: RecordLookupPort,
  index: string,
  values: readonly LookupValue[],
  afterKey: string | undefined,
  desired: number,
): Promise<{ status: 'ready'; refKeys: string[] } | CoreRejection> {
  const lookupRequest: RecordLookupRequest = {
    index, values, limit: desired,
    ...(afterKey === undefined ? {} : { after: afterKey }),
  };
  const result = await lookups.lookup(lookupRequest);
  if (result.status !== 'ready') {
    if (result.code === 'unsupported') return incomplete(`lookup index ${index} is not registered`);
    if (result.code === 'invalid') return incomplete(`lookup index ${index} rejected the request: ${result.reason}`);
    return unavailable(`${result.code}: ${result.reason}`);
  }
  return { status: 'ready', refKeys: result.value.records.map(record => record.refKey) };
}

// --------------------------------------------------------------------------
// The factory
// --------------------------------------------------------------------------

export function createRunStateReader(deps: ExecutionReadDependencies): ExecutionReadPort {
  const records = deps.records;
  const readExecution = async (ctx: CoreCallContext, ref: RunRef,
    options?: { atLeastCursor?: CommitCursor }): Promise<ReadResult<TaskExecutionRecord>> => {
      const owned = ownCallContext(ctx);
      if (!owned.ok) return owned.rejection;
      const scope = owned.ctx;
      const atLeast = options?.atLeastCursor;
      // Reuse the ledger cursor parser for strict validation BEFORE any store read.
      let atLeastSeq: number | undefined;
      if (atLeast !== undefined) {
        const parsed = cursorSequence(atLeast);
        if (parsed === null) return invalid('atLeastCursor is not a ledger commit cursor');
        atLeastSeq = parsed;
      }

      let ownedRef: RunRef;
      try {
        ownedRef = structuredClone(ref);
      } catch {
        return invalid('the Run ref cannot be isolated from the caller');
      }
      if (!isRunRef(ownedRef)) return invalid('readExecution requires a complete RunRef');
      if (ownedRef.projectId !== scope.projectId) return forbidden('the Run belongs to another project');
      if (scope.signal.aborted) return reject('cancelled', 'the execution read was cancelled before the first read');
      const runKey = refKeyOf(ownedRef);
      if (runKey === null) return invalid('the Run ref is not canonicalizable JSON');

      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        // ---- window 1: locate the Run ------------------------------------
        const runRead = await readBatch(records, [runKey]);
        if (runRead.status !== 'ready') return mapRejected(runRead);
        if (scope.signal.aborted) return reject('cancelled', 'the execution read was cancelled during the Run read');
        const runPresence = presenceOf(runRead.batch, runKey);
        if (runPresence === 'unaccounted') {
          return unavailable('the Run key was neither returned nor reported missing');
        }
        if (runPresence === 'missing') {
          if (!watermarkSatisfied(runRead.batch.readThrough, atLeastSeq)) {
            return notReadyResult(runRead.batch.readThrough, atLeast as CommitCursor);
          }
          return { status: 'not_found' };
        }
        const runDecoded = decodeRun(runRead.batch.present.get(runKey) as EncodedRecord);
        if (!runDecoded.ok) return unavailable(`the Run is damaged: ${runDecoded.reason}`);
        const discovered = runDecoded.value;
        const task = discovered.task;
        const attemptKey = attemptKeyOf(task, discovered.attemptId);
        const outboxKey = outboxKeyOf(task, discovered.attemptId);
        const leaseKey = leaseKeyOf(task);
        const planKey = planRevisionRefKey(discovered.planRef);

        // ---- window 2: locate the outbox only, to resolve the Session -----
        const outboxRead = await readBatch(records, [outboxKey]);
        if (outboxRead.status !== 'ready') return mapRejected(outboxRead);
        if (scope.signal.aborted) return reject('cancelled', 'the execution read was cancelled during the outbox read');
        const outboxPresence = presenceOf(outboxRead.batch, outboxKey);
        if (outboxPresence === 'unaccounted') {
          return unavailable('the dispatch outbox key was neither returned nor reported missing');
        }
        let sessionKey: string | undefined;
        if (outboxPresence === 'present') {
          const linked = decodeDispatchOutboxEntry(outboxRead.batch.present.get(outboxKey) as EncodedRecord);
          if (linked.status !== 'decoded') return unavailable(`the dispatch outbox is damaged: ${linked.reason}`);
          sessionKey = sessionKeyOf(linked.value.claim.sessionRef);
        }

        // ---- window 3: the single authoritative re-read ------------------
        const finalKeys = unique([runKey, attemptKey, outboxKey, planKey, leaseKey,
          ...(sessionKey === undefined ? [] : [sessionKey])]);
        const finalRead = await readBatch(records, finalKeys);
        if (finalRead.status !== 'ready') return mapRejected(finalRead);
        if (scope.signal.aborted) return reject('cancelled', 'the execution read was cancelled during the final read');
        const batch = finalRead.batch;

        // The watermark and every fact come from THIS window only.
        if (!watermarkSatisfied(batch.readThrough, atLeastSeq)) {
          return notReadyResult(batch.readThrough, atLeast as CommitCursor);
        }
        for (const candidate of finalKeys) {
          if (presenceOf(batch, candidate) === 'unaccounted') {
            return unavailable('a requested key was neither returned nor reported missing');
          }
        }
        if (presenceOf(batch, runKey) === 'missing') {
          return { status: 'not_found' };
        }
        const finalRunDecoded = decodeRun(batch.present.get(runKey) as EncodedRecord);
        if (!finalRunDecoded.ok) return unavailable(`the Run is damaged: ${finalRunDecoded.reason}`);
        const finalRun = finalRunDecoded.value;

        // Only a real reference change seen in the FINAL window forces a retry.
        // The Run-derived references are provable without the outbox.
        const runRefsChanged = attemptKeyOf(finalRun.task, finalRun.attemptId) !== attemptKey
          || outboxKeyOf(finalRun.task, finalRun.attemptId) !== outboxKey
          || leaseKeyOf(finalRun.task) !== leaseKey
          || planRevisionRefKey(finalRun.planRef) !== planKey;
        if (runRefsChanged) continue;

        let finalOutbox: TaskClaimOutbox | undefined;
        if (presenceOf(batch, outboxKey) === 'present') {
          const decoded = decodeDispatchOutboxEntry(batch.present.get(outboxKey) as EncodedRecord);
          if (decoded.status !== 'decoded') return unavailable(`the dispatch outbox is damaged: ${decoded.reason}`);
          finalOutbox = decoded.value;
        }
        // A required outbox that is explicitly missing is incomplete, not a
        // reference change; an outbox that newly appears or names another
        // Session IS a reference change and is retried.
        if (finalOutbox === undefined) return incomplete('the claim-linked dispatch outbox is missing');
        const finalSessionKey = sessionKeyOf(finalOutbox.claim.sessionRef);
        if (sessionKey === undefined || finalSessionKey !== sessionKey) continue;

        // A self-consistent Host outside the claim workspace is out of scope.
        if (finalOutbox.claim.workspaceId !== scope.workspaceId) {
          return forbidden('the claim belongs to another workspace');
        }
        // Missing claim-linked records are incomplete, never fabricated absence.
        if (presenceOf(batch, attemptKey) === 'missing') return incomplete('the claim-linked TaskAttempt is missing');
        if (presenceOf(batch, planKey) === 'missing') return incomplete('the claim-linked Plan is missing');
        if (sessionKey !== undefined && presenceOf(batch, sessionKey) === 'missing') {
          return incomplete('the claim-linked Session is missing');
        }

        const attemptRecord = batch.present.get(attemptKey) as EncodedRecord;
        const attempt = decodeTaskAttemptSnapshot(attemptRecord);
        if (attempt.status !== 'decoded') return unavailable(`the TaskAttempt is damaged: ${attempt.reason}`);
        const planRecord = batch.present.get(planKey) as EncodedRecord;
        const plan = decodePlanRevisionSnapshot(planRecord);
        if (plan.status !== 'decoded') return unavailable(`the Plan is damaged: ${plan.reason}`);
        let session: SessionRecord | undefined;
        if (sessionKey !== undefined) {
          const sessionRecord = batch.present.get(sessionKey) as EncodedRecord;
          const decoded = decodeSessionRecord(sessionRecord);
          if (decoded.status !== 'decoded') return unavailable(`the Session is damaged: ${decoded.reason}`);
          session = decoded.value;
        }
        let lease: TaskLeaseSnapshot | null = null;
        if (presenceOf(batch, leaseKey) === 'present') {
          const decodedLease = decodeLease(batch.present.get(leaseKey) as EncodedRecord);
          if (!decodedLease.ok) return unavailable(`the Lease is damaged: ${decodedLease.reason}`);
          lease = decodedLease.value;
        }

        const broken = verifyChain(finalRun, attempt.value, finalOutbox, plan.value, session, lease, {
          runKey, attemptKey, outboxKey, leaseKey, planKey, sessionKey, projectId: scope.projectId,
        });
        if (broken !== null) return broken;
        if (session === undefined) return unavailable('the claim-linked Session is unavailable');
        return {
          status: 'ready',
          value: { run: finalRun, attempt: attempt.value, outbox: finalOutbox,
            plan: plan.value, session, lease, readThrough: batch.readThrough },
        };
      }
      return reject('busy', 'the execution references changed in every final read window');
  };
  /**
   * MVP UI connection: a bounded page over the EXISTING Run-by-Goal /
   * Run-by-Task candidate index and the canonical `readExecution`. The opaque
   * cursor is bound to the exact project/workspace/Goal/Task query and to the
   * exclusive canonical key of the last returned Run, so a cursor from another
   * query is rejected instead of leaking other Runs. Every item keeps its own
   * `readThrough`; the page is a bounded set of independent reads, never an
   * atomic snapshot and never a fallback to an empty list.
   */
  const listExecutions = async (
    ctx: CoreCallContext,
    request: ExecutionListPageRequest,
  ): Promise<ReadResult<TaskExecutionPage>> => {
    const owned = ownCallContext(ctx);
    if (!owned.ok) return owned.rejection;
    const workspaceId = owned.ctx.workspaceId;
    if (workspaceId === undefined || workspaceId.length === 0) {
      return forbidden('listExecutions requires a bound project/workspace context');
    }
    const raw = request as unknown as { goalRef?: unknown; taskId?: unknown; page?: unknown } | null | undefined;
    if (!isRecord(raw) || !isRecord(raw.goalRef)
      || raw.goalRef['aggregateType'] !== 'Goal'
      || !nonEmpty(raw.goalRef['projectId']) || !nonEmpty(raw.goalRef['goalId'])) {
      return invalid('listExecutions requires a complete GoalRef');
    }
    const projectId = raw.goalRef['projectId'];
    const goalId = raw.goalRef['goalId'];
    if (projectId !== owned.ctx.projectId) return forbidden('the Goal belongs to another project');
    const rawTaskId = raw.taskId;
    if (rawTaskId !== undefined && !nonEmpty(rawTaskId)) {
      return invalid('taskId must be a non-empty string when present');
    }
    const taskId: string | null = rawTaskId === undefined ? null : rawTaskId;
    if (!isRecord(raw.page)) return invalid('listExecutions requires a page with afterCursor and limit');
    const afterCursor = raw.page['afterCursor'];
    if (afterCursor !== null && typeof afterCursor !== 'string') return invalid('page.afterCursor must be a string or null');
    const limit = raw.page['limit'];
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > LIST_PAGE_LIMIT_MAX) {
      return invalid('page.limit must be an integer between 1 and 100');
    }
    let afterKey: string | undefined;
    if (afterCursor !== null) {
      const cursor = decodeExecutionListCursor(afterCursor);
      if (cursor === null) return invalid('page.afterCursor is not a valid execution-list cursor');
      if (cursor.projectId !== projectId || cursor.workspaceId !== workspaceId
        || cursor.goalId !== goalId || cursor.taskId !== taskId) {
        return invalid('page.afterCursor does not belong to this workspace/Goal/Task query');
      }
      afterKey = cursor.after;
    }
    const index = taskId === null ? RUN_BY_GOAL_INDEX : RUN_BY_TASK_INDEX;
    const values: LookupValue[] = taskId === null ? [projectId, goalId] : [projectId, goalId, taskId];
    const lookups = lookupPortOf(records);
    if (lookups === null) return incomplete('the Run candidate index port is not configured');
    const candidates = await collectRunCandidateKeys(lookups, index, values, afterKey, limit + 1);
    if (candidates.status !== 'ready') return candidates;
    const located: { key: string; runRef: RunRef }[] = [];
    const seen = new Set<string>();
    for (const key of candidates.refKeys) {
      if (located.length >= limit) break;
      if (seen.has(key)) continue;
      const runRef = runRefFromCandidateKey(key);
      if (runRef === null) return unavailable('a Run candidate is not a canonical RunRef');
      if (runRef.projectId !== projectId || runRef.goalId !== goalId) {
        return unavailable('a Run candidate belongs to another Goal');
      }
      seen.add(key);
      located.push({ key, runRef });
    }
    const items: TaskExecutionRecord[] = [];
    for (const { runRef } of located) {
      const read = await readExecution(owned.ctx, runRef);
      if (read.status === 'ready') { items.push(read.value); continue; }
      if (read.status === 'not_found') return unavailable('a located Run has no canonical record');
      return read;
    }
    const last = located[located.length - 1];
    const nextCursor = candidates.refKeys.length > limit && last !== undefined
      ? encodeExecutionListCursor({ schemaVersion: 1, projectId, workspaceId, goalId, taskId, after: last.key })
      : null;
    return { status: 'ready', value: {
      items,
      nextCursor,
      readThrough: items.length === 0 ? null : items[items.length - 1]!.readThrough,
    } };
  };
  /** One record by key, decoded; `null` when it is reported missing. */
  async function readOne<T>(key: string, decode: (record: EncodedRecord) => DecodeResult<T>, what: string,
  ): Promise<{ ok: true; value: T | null; readThrough: CommitCursor | null } | { ok: false; rejection: CoreRejection }> {
    const read = await readBatch(records, [key]);
    if (read.status !== 'ready') return { ok: false, rejection: mapRejected(read) };
    const presence = presenceOf(read.batch, key);
    if (presence === 'unaccounted') return { ok: false, rejection: unavailable(`the ${what} key was neither returned nor reported missing`) };
    if (presence === 'missing') return { ok: true, value: null, readThrough: read.batch.readThrough };
    const decoded = decode(read.batch.present.get(key) as EncodedRecord);
    if (decoded.status !== 'decoded') return { ok: false, rejection: unavailable(`the ${what} is damaged: ${decoded.reason}`) };
    return { ok: true, value: decoded.value, readThrough: read.batch.readThrough };
  }

  /**
   * A bounded body of the raw store; null with the reason when it cannot be read. `text` picks the text out of the
   * stored body (a reason when it cannot). A body over `textChars` is cut and says so (`truncated`, contract (e)
   * "超限按字段截断并记 truncated"), so the brief never presents a cut text as complete.
   */
  async function boundedBody(
    ref: ArtifactRef, text: (stored: RawArtifactRecord) => { text: string } | { reason: string } = stored => ({ text: stored.body }),
  ): Promise<{ body: string | null; truncated: boolean; reason: string | null }> {
    const unreadable = (reason: string) => ({ body: null, truncated: false, reason });
    if (deps.bodies === undefined) return unreadable('the body store is not readable by this reader');
    try {
      const read = await deps.bodies.read(ref);
      if (read.status !== 'ready') return unreadable(`the body is not readable: ${read.reason}`);
      const picked = text(read.value);
      if ('reason' in picked) return unreadable(picked.reason);
      const cap = CONTINUATION_BRIEF_LIMITS.textChars;
      return picked.text.length > cap ? { body: picked.text.slice(0, cap), truncated: true, reason: null }
        : { body: picked.text, truncated: false, reason: null };
    } catch (error) {
      return unreadable(`the body read failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * C3 (spec §6.1 contract (e)): the durable facts AgentRuntime assembles a
   * continuation brief from. The requeue Run and its TaskRequeue, every
   * TaskRequeue of the Task (by each ended Run's `afterRunId`), the afterRun
   * record with its pointer and steer intents, its wait message, the chain
   * head the requeue covered, the bounded bodies of the requeue's own new
   * inputs (a reply only when it goes back to a Session other than the new
   * claim Session, i.e. the message's sender is not that Session) and,
   * for an afterRun that never entered the Kernel, the nearest entered
   * ancestor along the requeue chain (at most `factsFromHops`). Each read is
   * exact; `readThrough` is the latest watermark read. `not_found` for a Run
   * without `requeueRef`.
   */
  const readContinuationBasis = async (ctx: CoreCallContext, request: { runRef: RunRef }): Promise<ReadResult<ContinuationBasis>> => {
    const owned = ownCallContext(ctx);
    if (!owned.ok) return owned.rejection;
    const runRef = isRecord(request) ? request.runRef : undefined;
    if (!isRunRef(runRef)) return invalid('readContinuationBasis requires a complete RunRef');
    const current = await readExecution(owned.ctx, runRef);
    if (current.status !== 'ready') return current;
    const run = current.value.run;
    const requeueRef = run.requeueRef;
    if (requeueRef === undefined) return { status: 'not_found' };
    let readThrough: CommitCursor | null = current.value.readThrough;
    const later = (cursor: CommitCursor | null): void => { readThrough = laterCursor(readThrough, cursor); };
    const requeueRead = await readOne(taskRequeueRefKey(requeueRef), decodeTaskRequeueSnapshot, 'TaskRequeue');
    if (!requeueRead.ok) return requeueRead.rejection;
    const requeue = requeueRead.value;
    if (requeue === null) return incomplete('the TaskRequeue the Run names is missing');
    later(requeueRead.readThrough);
    if (requeue.task.taskId !== run.task.taskId || requeue.task.goalId !== run.task.goalId) {
      return unavailable('the TaskRequeue the Run names belongs to another Task');
    }
    const previous = await readExecution(owned.ctx, requeue.afterRunRef);
    if (previous.status !== 'ready') return previous.status === 'not_found' ? incomplete('the requeue afterRun is missing') : previous;
    later(previous.value.readThrough);

    // Every TaskRequeue of the Task, keyed by each ended Run of it.
    const lookups = lookupPortOf(records);
    if (lookups === null) return incomplete('the Run candidate index port is not configured');
    const candidates = await collectRunCandidateKeys(lookups, RUN_BY_TASK_INDEX,
      [run.task.projectId, run.task.goalId, run.task.taskId], undefined, 200);
    if (candidates.status !== 'ready') return candidates;
    const runRead = await readBatch(records, unique(candidates.refKeys));
    if (runRead.status !== 'ready') return mapRejected(runRead);
    later(runRead.batch.readThrough);
    const requeueKeys: string[] = [];
    const runsById = new Map<string, RunSnapshot>([[run.ref.runId, run]]);
    for (const record of runRead.batch.present.values()) {
      const decoded = decodeRun(record);
      if (!decoded.ok) return unavailable(`a Run of the Task is damaged: ${decoded.reason}`);
      const candidate = decoded.value;
      if (candidate.task.taskId !== run.task.taskId) continue;
      if (!runsById.has(candidate.ref.runId)) runsById.set(candidate.ref.runId, candidate);
      if (candidate.status !== 'ended') continue;
      requeueKeys.push(taskRequeueRefKey({ aggregateType: 'TaskRequeue', projectId: candidate.ref.projectId,
        goalId: candidate.ref.goalId, taskId: candidate.task.taskId, afterRunId: candidate.ref.runId }));
    }
    const allRequeues: TaskRequeueSnapshotV1[] = [];
    if (requeueKeys.length > 0) {
      const all = await readBatch(records, unique(requeueKeys));
      if (all.status !== 'ready') return mapRejected(all);
      later(all.batch.readThrough);
      for (const record of all.batch.present.values()) {
        const decoded = decodeTaskRequeueSnapshot(record);
        if (decoded.status !== 'decoded') return unavailable(`a TaskRequeue of the Task is damaged: ${decoded.reason}`);
        allRequeues.push(decoded.value);
      }
    }
    // Run-chain order (oldest first), as `TaskRow.rework.entries`: the chain ending at this Run is
    // linked by `requeueRef.afterRunId` and `consumedWait.runRef`; a requeue off the chain follows.
    const chain: string[] = [];
    for (let current: RunSnapshot | undefined = run; current !== undefined && !chain.includes(current.ref.runId);) {
      chain.push(current.ref.runId);
      const previousId: string | undefined = current.requeueRef?.afterRunId ?? current.consumedWait?.runRef.runId;
      current = previousId === undefined ? undefined : runsById.get(previousId);
    }
    const chainIndex = new Map(chain.reverse().map((runId, index) => [runId, index]));
    allRequeues.sort((left, right) => {
      const byChain = (chainIndex.get(left.ref.afterRunId) ?? Number.MAX_SAFE_INTEGER)
        - (chainIndex.get(right.ref.afterRunId) ?? Number.MAX_SAFE_INTEGER);
      if (byChain !== 0) return byChain;
      if (left.requestedAt !== right.requestedAt) return left.requestedAt < right.requestedAt ? -1 : 1;
      return left.ref.afterRunId < right.ref.afterRunId ? -1 : left.ref.afterRunId > right.ref.afterRunId ? 1 : 0;
    });

    // The afterRun's pointer and steer intents, and its wait message.
    const intentOf = async (ref: ControlIntentRef): Promise<ControlIntentSnapshotV1 | CoreRejection> => {
      const read = await readOne(refKeyOf(ref) as string, decodeControlIntentSnapshot, 'control intent');
      if (!read.ok) return read.rejection;
      if (read.value === null) return incomplete('a control intent the afterRun names is missing');
      later(read.readThrough);
      return read.value;
    };
    const previousRun = previous.value.run;
    let pointer: ControlIntentSnapshotV1 | null = null;
    if (previousRun.controlState !== undefined) {
      const read = await intentOf(previousRun.controlState.intentRef);
      if ('status' in read && read.status === 'rejected') return read;
      pointer = read as ControlIntentSnapshotV1;
    }
    const steers: ControlIntentSnapshotV1[] = [];
    for (const ref of previousRun.controlInputs ?? []) {
      const read = await intentOf(ref);
      if ('status' in read && read.status === 'rejected') return read;
      steers.push(read as ControlIntentSnapshotV1);
    }
    let previousWait: SessionMessage | null = null;
    if (previousRun.outcome === 'yielded' && previousRun.continuation !== undefined) {
      const read = await readOne(sessionMessageRefKey(previousRun.continuation.messageRef), decodeSessionMessageRecord, 'wait message');
      if (!read.ok) return read.rejection;
      later(read.readThrough);
      previousWait = read.value;
    }

    // The chain head the requeue covered.
    let round: RoundSnapshot | null = null;
    if (requeue.afterRoundRef !== null) {
      const read = await readOne(refKeyOf(requeue.afterRoundRef) as string, decodeVerificationRoundSnapshot, 'round');
      if (!read.ok) return read.rejection;
      if (read.value === null) return incomplete('the round the requeue covered is missing');
      later(read.readThrough);
      round = read.value;
    }

    // The bounded bodies of the requeue's own new inputs.
    const newInputBodies: ContinuationBasis['newInputBodies'] = [];
    const replyBodies: ContinuationBasis['replyBodies'] = [];
    for (const input of requeue.newInputRefs) {
      if (input.kind === 'artifact') {
        newInputBodies.push({ ref: input.ref, ...await boundedBody(input.ref) });
        continue;
      }
      // ND-9: a message outside the Run's project and workspace is never read into its brief.
      if (input.ref.projectId !== run.ref.projectId || input.ref.workspaceId !== current.value.session.workspaceId) {
        replyBodies.push({ messageRef: input.ref, body: null, truncated: false,
          reason: 'the message belongs to another project or workspace' });
        continue;
      }
      const read = await readOne(sessionMessageRefKey(input.ref), decodeSessionMessageRecord, 'session message');
      if (!read.ok) return read.rejection;
      later(read.readThrough);
      const message = read.value;
      if (message === null || message.response === null) {
        replyBodies.push({ messageRef: input.ref, body: null, truncated: false, reason: 'the message has no saved reply' });
        continue;
      }
      // The reply is already in the history when it was answered back to the new claim Session: a reply goes to the
      // message's sender, whose Session's input channel supplies it (`run.input_accepted`), so it is not inlined again.
      const claimSessionId = current.value.outbox.claim.sessionRef.sessionId;
      if (message.sender.kind === 'work_run' && message.sender.sessionRef.sessionId === claimSessionId) continue;
      // Contract (e) `replyBody` (§15.2 C3-reply-other-session "内联有界的回复正文"): the text of the stored reply
      // envelope, decoded as the mailbox decodes it.
      replyBodies.push({ messageRef: input.ref,
        ...await boundedBody(message.response.bodyRef, stored => decodeStoredMessageBody(message, 'response', stored)) });
    }

    // An afterRun that never entered: the nearest entered ancestor along the requeue chain.
    const factsChain: ContinuationBasis['factsChain'] = [];
    let cursor: TaskExecutionRecord = previous.value;
    let cursorRequeue: TaskRequeueSnapshotV1 | undefined = requeue;
    while (cursor.run.executionHistory === undefined && factsChain.length < CONTINUATION_BRIEF_LIMITS.factsFromHops) {
      const ancestorRef = cursor.run.requeueRef;
      if (ancestorRef === undefined) break;
      cursorRequeue = allRequeues.find(candidate => refKeyOf(candidate.ref) === refKeyOf(ancestorRef));
      if (cursorRequeue === undefined) return incomplete('a TaskRequeue of the requeue chain is missing');
      const ancestor = await readExecution(owned.ctx, cursorRequeue.afterRunRef);
      if (ancestor.status !== 'ready') return ancestor.status === 'not_found' ? incomplete('a requeue chain Run is missing') : ancestor;
      later(ancestor.value.readThrough);
      let ancestorRound: RoundSnapshot | null = null;
      if (cursorRequeue.afterRoundRef !== null) {
        const read = await readOne(refKeyOf(cursorRequeue.afterRoundRef) as string, decodeVerificationRoundSnapshot, 'round');
        if (!read.ok) return read.rejection;
        later(read.readThrough);
        ancestorRound = read.value;
      }
      factsChain.push({ requeue: cursorRequeue, run: ancestor.value, round: ancestorRound });
      cursor = ancestor.value;
    }
    return { status: 'ready', value: { run, requeue, allRequeues, previous: previous.value,
      previousIntents: { pointer, steers }, previousWait, round, newInputBodies, replyBodies, factsChain, readThrough } };
  };
  return { readExecution, listExecutions, readContinuationBasis };
}
