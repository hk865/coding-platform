/**
 * R4c.2b execution-history locator maintenance.
 *
 * This is the trusted Host/Runtime fact-admission capability that persists the
 * optional `RunSnapshot.executionHistory` locator. It is NOT a second Kernel
 * transcript, graph, log, Manager or Repository: one atomic RecordStore commit
 * writes the locator onto the existing Run, one `ExecutionHistoryRecorded@1`
 * replay event and one existing unique claim slot that permanently ties the
 * Kernel identity `(adapterId, kernelSessionId, runId, turnId)` to this complete
 * `RunRef`.
 *
 * Invariants:
 *  - only a trusted `host` principal with a `human`/`system` actor may call;
 *  - `meta.expected` is exactly one positive-integer revision pin for the target
 *    Run, used verbatim (never replaced by a freshly read revision);
 *  - `lookupCommit` first: a replay restores the ORIGINAL `runRevision`/history
 *    from the recorded event via `eventAt`, even if the ledger watermark grew;
 *    same requestId + different content is `idempotency_conflict`; a new
 *    requestId with the same content is a normal CAS commit, never `replayed`;
 *  - `createRunStateReader.readExecution` verifies the Run/Attempt/outbox/Plan/
 *    Session chain and scope; the SessionRef comes from the claim;
 *  - `startPosition` is fixed, `observedThroughPosition` only grows, and a
 *    non-null `endPosition` is set once and then neither cleared nor changed;
 *  - guards cover the Run/Attempt/outbox/Plan/Session versions actually used,
 *    never the current Lease, never a ledger horizon, and never require the
 *    current Session occupancy to still belong to the old Run;
 *  - a `starting` Run may record real history facts; entered/completed are
 *    never fabricated.
 *
 * The write is decided by the pure Run machine (STATE-MACHINES-SPEC §6,
 * RUN-06 in `state/run-machine.ts`) through `execution-history-binding.ts`.
 * This file keeps the request shape and scope checks before any store access,
 * the receipt lookup first, and the execution read and the Run pin check where
 * they always were (no Run row reads the caller's pin); the locator refusals
 * past them, the next Run and the Kernel slot change come from the machine's
 * decision, record and effect, never from a literal here.
 */
import type { ActorRef } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { VersionPin, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { CoreRejection, WriteResult } from '../../../contracts/core/results.js';
import type { RunRef, RunSnapshot } from '../../../contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { isAutomationActor } from '../../../contracts/task-requeue.js';
import { rejectedWithCurrent as reject } from '../../../contracts/core/rejections.js';
import { isPos as isPositiveRevision, isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type {
  EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordGuard, StoreCommitReceipt,
  StoreFailure,
} from '../../record-store/ports.js';
import {
  encodeExecutionHistoryRecordedEvent,
  executionHistoryRecordedEventFromEvent,
  EXECUTION_HISTORY_RECORDED_EVENT_SCHEMA_VERSION,
  EXECUTION_HISTORY_RECORDED_EVENT_TYPE,
  type ExecutionHistoryRecordedEvent,
} from '../persistence/execution-history-codecs.js';
import { plainSessionRefToAggregate, sessionAggregateRefKey } from '../sessions/session-record-codecs.js';
import { compileExecutionHistoryBinding } from './execution-history-binding.js';
import { dispatchOutboxRefKey, taskAttemptRefKey } from './claim-record-codecs.js';
import type { GraphWrite } from '../model/task-contracts.js';
import type {
  ExecutionHistoryWriteDependencies,
  ExecutionHistoryWritePort,
  RecordExecutionHistoryInput,
  RecordedExecutionHistory,
} from '../model/execution-history-contracts.js';
import { planRevisionRefKey } from '../persistence/plan-record-codecs.js';
import { executionStoreFailureToRejection } from '../persistence/read-result-failures.js';
import { sameCursor } from './plan-readers.js';
import { createRunStateReader } from './run-state-service.js';
import { isolatedWriteOf, trustedContextOf } from './trusted-context.js';

const HISTORY_IDENTITY_PREFIX = 'execution-history:';

// --------------------------------------------------------------------------
// Small pure helpers
// --------------------------------------------------------------------------

function invalid(reason: string): CoreRejection { return reject('invalid', reason); }
function forbidden(reason: string): CoreRejection { return reject('forbidden', reason); }
function unavailable(reason: string): CoreRejection { return reject('unavailable', reason); }
function incomplete(reason: string): CoreRejection { return reject('incomplete', reason); }
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function sameRef(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue);
  } catch {
    return false;
  }
}
function isRunRef(value: unknown): value is RunRef {
  return isRecord(value) && value['aggregateType'] === 'Run'
    && nonEmpty(value['projectId']) && nonEmpty(value['goalId']) && nonEmpty(value['runId']);
}
function mapStoreFailure(failure: StoreFailure): CoreRejection {
  // A Store `unique_conflict` current names claim slots, which this map never reads.
  return executionStoreFailureToRejection(failure.code === 'unique_conflict'
    ? { code: failure.code, reason: failure.reason }
    : failure);
}

// --------------------------------------------------------------------------
// Synchronous input isolation and trusted Host scope
// --------------------------------------------------------------------------

type OwnedCtx =
  | { ok: true; ctx: CoreCallContext; scope: WorkspaceScope;
      actor: Extract<ActorRef, { kind: 'human' | 'system' }> }
  | { ok: false; rejection: CoreRejection };

function isSignal(signal: unknown): boolean {
  return isRecord(signal) && typeof signal['aborted'] === 'boolean'
    && typeof signal['addEventListener'] === 'function';
}

/** Bind the trusted Host scope and identity before the first await; the original
 * AbortSignal is kept by reference so cancellation can never be lost. */
function ownCallContext(ctx: CoreCallContext): OwnedCtx {
  const trusted = trustedContextOf(ctx, {
    label: 'recordExecutionHistory',
    reject,
    isSignal,
  });
  if (!trusted.ok) return trusted;
  return { ok: true, ctx: trusted.ctx, scope: trusted.scope, actor: trusted.actor };
}

type OwnedRequest =
  | { ok: true; input: RecordExecutionHistoryInput; requestId: string; expected: readonly VersionPin[] }
  | { ok: false; rejection: CoreRejection };

function ownRequest(request: GraphWrite<RecordExecutionHistoryInput>): OwnedRequest {
  return isolatedWriteOf<RecordExecutionHistoryInput>(request, {
    label: 'recordExecutionHistory',
    reject,
    cannotIsolate: 'the execution-history request cannot be isolated from the caller',
  });
}

// --------------------------------------------------------------------------
// Shape / expected validation
// --------------------------------------------------------------------------

function positionsProblem(start: unknown, observed: unknown, end: unknown): CoreRejection | null {
  if (!isPositiveRevision(start)) return invalid('startPosition must be a positive safe integer');
  if (!isPositiveRevision(observed)) return invalid('observedThroughPosition must be a positive safe integer');
  if (!(end === null || isPositiveRevision(end))) {
    return invalid('endPosition must be null or a positive safe integer');
  }
  if (start > observed) return invalid('startPosition must not exceed observedThroughPosition');
  if (end !== null && (end < start || end > observed)) {
    return invalid('endPosition must lie between startPosition and observedThroughPosition');
  }
  return null;
}

function validateInputShape(input: RecordExecutionHistoryInput, scope: WorkspaceScope): CoreRejection | null {
  if (!isRunRef(input.runRef)) return invalid('recordExecutionHistory requires a complete RunRef');
  if (input.runRef.projectId !== scope.projectId) return forbidden('the Run belongs to another project');
  const kernel = input.kernel;
  if (!isRecord(kernel) || !nonEmpty(kernel['adapterId']) || !nonEmpty(kernel['kernelSessionId'])
    || !nonEmpty(kernel['runId']) || !nonEmpty(kernel['turnId'])) {
    return invalid('recordExecutionHistory requires a complete Kernel identity');
  }
  return positionsProblem(input.startPosition, input.observedThroughPosition, input.endPosition);
}

type CheckedExpected = { ok: true; pin: VersionPin } | { ok: false; rejection: CoreRejection };

function validateExpected(expected: readonly VersionPin[], runRef: RunRef): CheckedExpected {
  if (expected.length !== 1) {
    return { ok: false, rejection: invalid('meta.expected must contain exactly one Run revision pin') };
  }
  const raw = expected[0] as unknown;
  if (!isRecord(raw) || !isRecord(raw['ref']) || !isPositiveRevision(raw['revision'])) {
    return { ok: false, rejection: invalid('the expected Run pin must carry a ref and a positive safe revision') };
  }
  if (!sameRef(raw['ref'], runRef)) {
    return { ok: false, rejection: invalid('meta.expected must pin exactly the target Run') };
  }
  return { ok: true, pin: { ref: raw['ref'] as VersionPin['ref'], revision: raw['revision'] } };
}

function identityAndFingerprint(
  actor: Extract<ActorRef, { kind: 'human' | 'system' }>,
  scope: WorkspaceScope,
  requestId: string,
  input: RecordExecutionHistoryInput,
  pin: VersionPin,
): { identityKey: string; fingerprint: string } {
  const identityKey = HISTORY_IDENTITY_PREFIX + sha256Hex(canonicalJson({
    actor: { kind: actor.kind, id: actor.id },
    projectId: scope.projectId, workspaceId: scope.workspaceId, requestId,
  } as unknown as JsonValue));
  const fingerprint = sha256Hex(canonicalJson({
    kind: 'execution-history-request',
    actor: { kind: actor.kind, id: actor.id },
    projectId: scope.projectId, workspaceId: scope.workspaceId,
    runRef: input.runRef, kernel: input.kernel,
    startPosition: input.startPosition, observedThroughPosition: input.observedThroughPosition,
    endPosition: input.endPosition,
    expected: [{ ref: pin.ref, revision: pin.revision }],
  } as unknown as JsonValue));
  return { identityKey, fingerprint };
}

// --------------------------------------------------------------------------
// The factory
// --------------------------------------------------------------------------

export function createExecutionHistoryService(
  deps: ExecutionHistoryWriteDependencies,
): ExecutionHistoryWritePort {
  const records: GoalRecordTransactionPort = deps.records;

  /** Restore the ORIGINAL recorded result from the real Store event. */
  async function readReplay(
    receipt: Extract<StoreCommitReceipt, { status: 'committed' }>,
    actor: Extract<ActorRef, { kind: 'human' | 'system' }>,
    scope: WorkspaceScope,
    runRef: RunRef,
    input: RecordExecutionHistoryInput,
    expectedPin: VersionPin,
    identityKey: string,
    fingerprint: string,
  ): Promise<WriteResult<RecordedExecutionHistory>> {
    if (receipt.eventIds.length !== 1 || !nonEmpty(receipt.eventIds[0])) {
      return unavailable('the execution-history receipt does not name exactly one event');
    }
    // The idempotency receipt must pin exactly this Run at the request's own
    // expected revision + 1. The current Run is deliberately never read here so
    // later watermark growth cannot break the original replay.
    const expectedRunRevision = expectedPin.revision + 1;
    if (!Number.isSafeInteger(expectedRunRevision) || receipt.versions.length !== 1) {
      return unavailable('the execution-history receipt does not name exactly one Run version');
    }
    const committedVersion = receipt.versions[0]!;
    if (committedVersion.refKey !== canonicalJson(runRef as unknown as JsonValue)
      || committedVersion.revision !== expectedRunRevision) {
      return unavailable('the execution-history receipt does not pin this Run at the expected revision');
    }
    const at = await records.eventAt(receipt.cursor);
    if (at.status !== 'ready') return mapStoreFailure(at);
    if (!sameCursor(at.value.cursor, receipt.cursor)) {
      return unavailable('the returned event cursor disagrees with the execution-history receipt');
    }
    const decoded = executionHistoryRecordedEventFromEvent(at.value.event);
    if (decoded.status !== 'decoded') {
      return unavailable(`the recorded execution-history event is not decodable: ${decoded.reason}`);
    }
    const event = decoded.value;
    if (event.eventId !== receipt.eventIds[0]) return unavailable('the recorded event id disagrees with the execution-history receipt');
    if (event.identityKey !== identityKey || event.fingerprint !== fingerprint) {
      return unavailable('the recorded identity/fingerprint disagrees with the idempotency receipt');
    }
    if (event.actor.kind !== actor.kind || event.actor.id !== actor.id) {
      return unavailable('the recorded execution-history event belongs to another actor');
    }
    if (event.recorded.history.sessionRef.projectId !== scope.projectId
      || !sameRef(event.recorded.runRef, runRef)) {
      return unavailable('the recorded execution-history result disagrees with the request identity');
    }
    if (event.recorded.runRevision !== committedVersion.revision) {
      return unavailable('the recorded execution-history Run revision disagrees with the committed receipt');
    }
    if (event.recorded.history.kernel.adapterId !== input.kernel.adapterId
      || event.recorded.history.kernel.kernelSessionId !== input.kernel.kernelSessionId
      || event.recorded.history.kernel.runId !== input.kernel.runId
      || event.recorded.history.kernel.turnId !== input.kernel.turnId
      || event.recorded.history.startPosition !== input.startPosition
      || event.recorded.history.observedThroughPosition !== input.observedThroughPosition
      || event.recorded.history.endPosition !== input.endPosition) {
      return unavailable('the recorded execution-history result disagrees with the recorded input content');
    }
    return { status: 'committed', value: event.recorded, replayed: true, cursor: receipt.cursor };
  }

  return {
    async recordExecutionHistory(
      ctx: CoreCallContext,
      request: GraphWrite<RecordExecutionHistoryInput>,
    ): Promise<WriteResult<RecordedExecutionHistory>> {
      // 1. Isolate ctx/request synchronously (before the first await).
      const ownedCtx = ownCallContext(ctx);
      if (!ownedCtx.ok) return ownedCtx.rejection;
      const { ctx: scopeCtx, scope, actor } = ownedCtx;
      const ownedRequest = ownRequest(request);
      if (!ownedRequest.ok) return ownedRequest.rejection;
      const { input, requestId, expected } = ownedRequest;

      // 2. Shape/scope/expected before any store access.
      const shape = validateInputShape(input, scope);
      if (shape !== null) return shape;
      const runRef: RunRef = { aggregateType: 'Run', projectId: input.runRef.projectId,
        goalId: input.runRef.goalId, runId: input.runRef.runId };
      const checkedExpected = validateExpected(expected, runRef);
      if (!checkedExpected.ok) return checkedExpected.rejection;
      const expectedPin = checkedExpected.pin;
      if (scopeCtx.signal.aborted) return reject('cancelled', 'the execution-history write was cancelled before lookup');

      let identityKey: string;
      let fingerprint: string;
      try {
        ({ identityKey, fingerprint } = identityAndFingerprint(actor, scope, requestId, input, expectedPin));
      } catch {
        return invalid('the execution-history request is not canonicalizable JSON');
      }

      try {
        // 3. Original receipt first: a replay must not consult the current world.
        const lookup = await records.lookupCommit({ identityKey, fingerprint });
        if (lookup.status === 'ready') {
          if (scopeCtx.signal.aborted) return reject('cancelled', 'the execution-history write was cancelled during lookup');
          return await readReplay(lookup.value, actor, scope, runRef, input, expectedPin, identityKey, fingerprint);
        }
        if (lookup.code !== 'not_found') return mapStoreFailure(lookup);
        if (scopeCtx.signal.aborted) return reject('cancelled', 'the execution-history write was cancelled during lookup');

        // 4. Verify the Run/Attempt/outbox/Plan/Session chain and scope.
        const read = await createRunStateReader({ records }).readExecution(scopeCtx, runRef);
        if (read.status === 'not_found') return reject('not_found', 'the target Run does not exist');
        if (read.status === 'not_ready') return incomplete('the target Run is not readable at the required watermark');
        if (read.status !== 'ready') return reject(read.code, read.reason, read.current);
        if (scopeCtx.signal.aborted) return reject('cancelled', 'the execution-history write was cancelled during the execution read');
        const { run, attempt, outbox, plan, session } = read.value;
        if (run.revision !== expectedPin.revision) {
          return reject('revision_conflict', 'the Run changed since the caller read it');
        }

        const sessionRef = outbox.claim.sessionRef;

        // 5-6. Pure compile through RUN-06, which reads the request's Kernel
        //      identity and positions as the observed history: fixed
        //      identity/start, monotone watermark, write-once end and the ONE
        //      Kernel-slot change (owner -> owner when this Run's fresh begin
        //      already holds the slot even though the locator is still absent).
        //      The writer adds the remaining guards for the records it read in
        //      this window; the Attempt and the outbox are guarded only
        //      (ATT-03/ATT-25 write nothing).
        const compiled = compileExecutionHistoryBinding({
          run, session, sessionRef, history: input, actor: isAutomationActor(actor) ? 'system' : 'human',
        });
        if (compiled.status !== 'compiled') return compiled;
        const { history, nextRun, runRecord, guards: runGuards, claim } = compiled.value;

        const nowIso = deps.now();
        if (!nonEmpty(nowIso) || !Number.isFinite(Date.parse(nowIso))) {
          return invalid('the injected clock is not a legal instant');
        }
        const eventId = deps.eventId();
        if (!nonEmpty(eventId)) return reject('unsupported', 'the injected id source produced an empty event id');

        const recorded: RecordedExecutionHistory = { runRef, runRevision: nextRun.revision, history };
        const event: ExecutionHistoryRecordedEvent = {
          eventId, eventType: EXECUTION_HISTORY_RECORDED_EVENT_TYPE,
          schemaVersion: EXECUTION_HISTORY_RECORDED_EVENT_SCHEMA_VERSION,
          occurredAt: nowIso, identityKey, actor, fingerprint, recorded,
        };

        const guards: RecordGuard[] = [
          ...runGuards,
          { refKey: taskAttemptRefKey(attempt.ref), expectedRevision: attempt.revision },
          { refKey: dispatchOutboxRefKey(outbox.ref), expectedRevision: outbox.revision },
          { refKey: planRevisionRefKey(plan.ref), expectedRevision: plan.revision },
          { refKey: sessionAggregateRefKey(plainSessionRefToAggregate(sessionRef)), expectedRevision: session.revision },
        ];
        const prepared: PreparedCommit = {
          identityKey, fingerprint, guards, records: [runRecord],
          claims: [claim],
          indexGuards: [], indexChanges: [], events: [encodeExecutionHistoryRecordedEvent(event)],
        };

        if (scopeCtx.signal.aborted) return reject('cancelled', 'the execution-history write was cancelled before commit');
        const receipt = await records.commit(prepared);
        if (receipt.status !== 'committed') return mapStoreFailure(receipt);
        if (receipt.replayed) {
          return await readReplay(receipt, actor, scope, runRef, input, expectedPin, identityKey, fingerprint);
        }
        return { status: 'committed', value: recorded, replayed: false, cursor: receipt.cursor };
      } catch (error) {
        // A stop/error must never leave partial state; the Store already rolled
        // back, and the failure is reported as unavailable.
        return unavailable(`the execution-history write failed: ${messageOf(error)}`);
      }
    },
  };
}
