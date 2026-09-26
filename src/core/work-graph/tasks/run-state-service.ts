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
import type { EncodedRecord } from '../../record-store/ports.js';
import { materialRecordSchemas } from '../materials/record-readers.js';
import {
  decodeSessionRecord,
  plainSessionRefToAggregate,
  sessionAggregateRefKey,
} from '../sessions/session-record-codecs.js';
import {
  decodeDispatchOutboxEntry,
  decodeTaskAttemptSnapshot,
  dispatchOutboxRefKey,
  taskAttemptRefKey,
} from './claim-record-codecs.js';
import type { TaskClaimOutbox } from './claim-contracts.js';
import { decodePlanRevisionSnapshot, planRevisionRefKey } from './plan-record-codecs.js';
import {
  PLAN_STATE_RECORD_SCHEMAS,
  readBatch,
  type ReadBatch,
  type Rejected,
} from './plan-readers.js';
import type {
  ExecutionReadDependencies,
  ExecutionReadPort,
  TaskExecutionRecord,
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
// The factory
// --------------------------------------------------------------------------

export function createRunStateReader(deps: ExecutionReadDependencies): ExecutionReadPort {
  const records = deps.records;
  return {
    async readExecution(ctx: CoreCallContext, ref: RunRef,
      options?: { atLeastCursor?: CommitCursor }): Promise<ReadResult<TaskExecutionRecord>> {
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
    },
  };
}
