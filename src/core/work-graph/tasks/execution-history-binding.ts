/**
 * B2 WG12 internal compile seam (implementation).
 *
 * Pure helper extracted from `execution-history-service.ts`: it validates the
 * formal Run / claimed SessionRef / Kernel session mapping / this observation
 * against the fixed identity, monotone watermark and write-once terminal end,
 * and produces the next Run record plus the ONE Kernel identity unique-slot
 * change. It owns no Store handle and performs no I/O.
 *
 * `beginOwnerRefKey` is the canonical Run key that a B2 fresh `begin` already
 * bound into the shared Kernel unique slot. When present, the slot change is an
 * owner -> owner CAS; the same Run may continue holding it. Because
 * `executionHistory` may still be absent at that point, "no locator" must never
 * be mistaken for "no owner".
 */
import type { RunExecutionHistoryV1 } from '../../../contracts/core/execution-history.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { CoreError, CoreRejection } from '../../../contracts/core/results.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { RunSnapshot } from '../../../contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { EncodedRecord, RecordGuard, UniqueClaimChange } from '../../record-store/ports.js';
import { isRunExecutionHistoryV1 } from '../persistence/execution-history-codecs.js';
import type { KernelExecutionBinding } from './execution-entry-contracts.js';

const RUN_SNAPSHOT_SCHEMA_ID = 'RunSnapshot@1';
const KERNEL_SLOT_PREFIX = 'execution-history-kernel:';

export type ExecutionHistoryBindingRequest = {
  run: RunSnapshot;
  /** Formal mapped Session, used to validate the claimed Kernel binding. */
  session: SessionRecord;
  sessionRef: SessionRef;
  kernel: KernelExecutionBinding;
  startPosition: number;
  observedThroughPosition: number;
  endPosition: number | null;
  /**
   * The Kernel unique-slot owner already bound by this Run's begin, if any.
   * The helper must distinguish "no owner" from "owned by this same Run" so a
   * begin that claimed the slot first is not re-submitted with expectedOwner:null.
   */
  beginOwnerRefKey: string | null;
};

export type ExecutionHistoryBinding = {
  history: RunExecutionHistoryV1;
  nextRun: RunSnapshot;
  runRecord: EncodedRecord;
  guards: readonly RecordGuard[];
  claim: UniqueClaimChange;
};

export type ExecutionHistoryBindingResult =
  | { status: 'compiled'; value: ExecutionHistoryBinding }
  | CoreRejection;

function reject(code: CoreError, reason: string): CoreRejection {
  return { status: 'rejected', code, reason };
}
function forbidden(reason: string): CoreRejection { return reject('forbidden', reason); }
function unavailable(reason: string): CoreRejection { return reject('unavailable', reason); }
function invalid(reason: string): CoreRejection { return reject('invalid', reason); }

function sameRef(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue);
  } catch {
    return false;
  }
}
function sameKernel(left: KernelExecutionBinding, right: KernelExecutionBinding): boolean {
  return left.adapterId === right.adapterId && left.kernelSessionId === right.kernelSessionId
    && left.runId === right.runId && left.turnId === right.turnId;
}

/**
 * Compile one locator update. It never writes: a caller merges `guards` with the
 * other records it read and commits once.
 */
export function compileExecutionHistoryBinding(
  request: ExecutionHistoryBindingRequest,
): ExecutionHistoryBindingResult {
  const { run, session, sessionRef } = request;
  // A Kernel observation source may carry a local `position`; the locator keeps
  // only the shared four-field Kernel identity and never the position.
  const kernel = {
    adapterId: request.kernel.adapterId,
    kernelSessionId: request.kernel.kernelSessionId,
    runId: request.kernel.runId,
    turnId: request.kernel.turnId,
  };
  if (!isRunExecutionHistoryV1({
    schemaVersion: 1,
    sessionRef: { projectId: sessionRef.projectId, sessionId: sessionRef.sessionId },
    kernel,
    startPosition: request.startPosition,
    observedThroughPosition: request.observedThroughPosition,
    endPosition: request.endPosition,
  })) {
    return invalid('the requested execution-history locator is not a complete RunExecutionHistoryV1');
  }
  // The Kernel Session binding is owned by the claim Session mapping.
  if (kernel.adapterId !== session.kernel.adapterId || kernel.kernelSessionId !== session.kernel.kernelSessionId) {
    return forbidden('the Kernel session identity disagrees with the claim Session mapping');
  }

  const runRecordRefKey = canonicalJson(run.ref as unknown as JsonValue);
  if (request.beginOwnerRefKey !== null && request.beginOwnerRefKey !== runRecordRefKey) {
    return invalid('the begin Kernel-slot owner does not name this Run');
  }

  const existing = run.executionHistory;
  if (existing !== undefined) {
    if (!isRunExecutionHistoryV1(existing)) return unavailable('the stored executionHistory is malformed');
    if (!sameRef(existing.sessionRef, sessionRef)
      || existing.kernel.adapterId !== kernel.adapterId
      || existing.kernel.kernelSessionId !== kernel.kernelSessionId
      || existing.kernel.runId !== kernel.runId
      || existing.kernel.turnId !== kernel.turnId
      || existing.startPosition !== request.startPosition) {
      return reject('revision_conflict', 'the execution-history identity/start is already fixed');
    }
    if (request.observedThroughPosition < existing.observedThroughPosition) {
      return reject('revision_conflict', 'observedThroughPosition cannot move backwards');
    }
    if (existing.endPosition !== null && request.endPosition !== existing.endPosition) {
      return reject('revision_conflict', 'endPosition is already fixed and cannot be cleared or changed');
    }
  }

  const history: RunExecutionHistoryV1 = {
    schemaVersion: 1,
    sessionRef: { projectId: sessionRef.projectId, sessionId: sessionRef.sessionId },
    kernel: { adapterId: kernel.adapterId, kernelSessionId: kernel.kernelSessionId,
      runId: kernel.runId, turnId: kernel.turnId },
    startPosition: request.startPosition,
    observedThroughPosition: request.observedThroughPosition,
    endPosition: request.endPosition,
  };
  if (!isRunExecutionHistoryV1(history)) {
    return invalid('the execution-history locator is not a complete RunExecutionHistoryV1');
  }
  const nextRevision = run.revision + 1;
  if (!Number.isSafeInteger(nextRevision)) return invalid('the Run revision would not be a safe integer');
  const nextRun: RunSnapshot = { ...run, revision: nextRevision, executionHistory: history };
  const runRecord: EncodedRecord = { refKey: runRecordRefKey, schemaId: RUN_SNAPSHOT_SCHEMA_ID,
    revision: nextRevision, json: JSON.stringify(nextRun) };

  // A begin-held slot is an owner -> owner CAS even though the locator is still
  // absent; otherwise the original WG12 rule applies.
  const expectedOwner = request.beginOwnerRefKey !== null
    ? request.beginOwnerRefKey
    : existing === undefined ? null : runRecordRefKey;
  const claim: UniqueClaimChange = {
    claimKey: KERNEL_SLOT_PREFIX + canonicalJson({
      adapterId: kernel.adapterId, kernelSessionId: kernel.kernelSessionId,
      runId: kernel.runId, turnId: kernel.turnId,
    } as unknown as JsonValue),
    expectedOwner,
    nextOwner: runRecordRefKey,
  };
  return {
    status: 'compiled',
    value: {
      history, nextRun, runRecord,
      guards: [{ refKey: runRecordRefKey, expectedRevision: run.revision }],
      claim,
    },
  };
}
