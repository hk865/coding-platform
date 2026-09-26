/**
 * B2 model-request service.
 *
 * A permit is issued at most once per stable `(runRef, requestId)` identity and
 * consumed at most once: the store CAS moves `ModelRequestPermitSnapshot@1`
 * from revision 1 to revision 2. Both issuance and consumption re-use the SAME
 * trusted admission helper as the execution-entry lane (`admitEnteredRun`), so
 * the current Host/Role/Session/Lease/material/deadline facts are re-checked by
 * one authorization algorithm, never a second copy.
 *
 * A replay restores the original receipt/evidence from the recorded event. It
 * grants no provider call: this lane has no provider, no ack and no meter; the
 * Runtime consumer separately proves the real external call.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ModelRequestPermitRef } from '../../../contracts/dispatch.js';
import type { CoreRejection, WriteResult } from '../../../contracts/core/results.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { EncodedRecord, PreparedCommit, RecordGuard } from '../../record-store/ports.js';
import { plainSessionRefToAggregate, sessionAggregateRefKey } from '../sessions/session-record-codecs.js';
import { dispatchOutboxRefKey, taskAttemptRefKey } from './claim-record-codecs.js';
import { planRevisionRefKey } from './plan-record-codecs.js';
import type { GraphWrite } from './contracts.js';
import {
  admitEnteredRun, bindTrustedContext, checkRunAndPermitPins, checkRunPin, isRecord, isSha256Hex,
  isolateWrite, loadReplayEvent, mapStoreFailure, mergeGuards, nonEmpty, sameRef, taskEntryPermitProblem,
} from './execution-entry-service.js';
import type { EnteredAdmission } from './execution-entry-service.js';
import type {
  ActualModelRequest, IssuedModelRequest, ModelCallServiceDependencies, ModelRequestPort,
} from './model-call-contracts.js';
import { modelRequestPermitIdFor } from './model-call-contracts.js';
import type { ModelRequestPermitSnapshot, ModelRequestPermitV1 } from './model-call-contracts.js';
import {
  MODEL_REQUEST_AUTHORIZED_EVENT_TYPE, MODEL_REQUEST_EVENT_SCHEMA_VERSION, MODEL_REQUEST_EVIDENCE_EVENT_TYPE,
  decodeModelRequestPermitSnapshot, encodeModelRequestPermitSnapshot, encodeModelRequestRecordedEvent,
  modelRequestRecordedEventFromEvent, type ModelRequestRecordedEvent,
} from '../persistence/model-request-codecs.js';

const MODEL_AUTHORIZE_PREFIX = 'b2-model-authorize:';
const MODEL_CONSUME_PREFIX = 'b2-model-consume:';

type HostActor = { kind: 'human' | 'system'; id: string };

function identityKey(prefix: string, actor: HostActor, projectId: string, workspaceId: string, requestId: string): string {
  return prefix + sha256Hex(canonicalJson({
    actor: { kind: actor.kind, id: actor.id }, projectId, workspaceId, requestId,
  } as unknown as JsonValue));
}
function fingerprintOf(value: unknown): string {
  return sha256Hex(canonicalJson(value as JsonValue));
}
function permitKeyOf(ref: ModelRequestPermitRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}
function permitRefFor(actual: ActualModelRequest): ModelRequestPermitRef {
  return { aggregateType: 'ModelRequestPermit', projectId: actual.permit.claim.runRef.projectId,
    workspaceId: actual.permit.claim.workspaceId,
    permitId: modelRequestPermitIdFor(actual.permit.claim.runRef, actual.requestId) };
}
function actualModelRequestProblem(value: unknown): CoreRejection | null {
  if (!isRecord(value)) return { status: 'rejected', code: 'invalid', reason: 'the actual model request must be an object' };
  const permitProblem = taskEntryPermitProblem(value['permit']);
  if (permitProblem !== null) return { status: 'rejected', code: 'invalid', reason: permitProblem };
  if (!nonEmpty(value['requestId'])) return { status: 'rejected', code: 'invalid', reason: 'the actual model request requires a requestId' };
  if (!isSha256Hex(value['requestDigest'])) return { status: 'rejected', code: 'invalid', reason: 'the actual model request requestDigest must be a sha256 hex' };
  if (!isSha256Hex(value['contextInputDigest'])) return { status: 'rejected', code: 'invalid', reason: 'the actual model request contextInputDigest must be a sha256 hex' };
  if (!isSha256Hex(value['manifestDigest'])) return { status: 'rejected', code: 'invalid', reason: 'the actual model request manifestDigest must be a sha256 hex' };
  return null;
}
function claimChainGuards(admission: EnteredAdmission, runPinRevision: number): RecordGuard[] {
  const { run, attempt, outbox, plan, session, lease } = admission.facts;
  return [
    { refKey: canonicalJson(run.ref as unknown as JsonValue), expectedRevision: runPinRevision },
    { refKey: taskAttemptRefKey(attempt.ref), expectedRevision: attempt.revision },
    { refKey: dispatchOutboxRefKey(outbox.ref), expectedRevision: outbox.revision },
    { refKey: planRevisionRefKey(plan.ref), expectedRevision: plan.revision },
    { refKey: sessionAggregateRefKey(plainSessionRefToAggregate(outbox.claim.sessionRef)), expectedRevision: session.revision },
    ...(lease === null ? [] : [{ refKey: canonicalJson(lease.ref as unknown as JsonValue), expectedRevision: lease.revision }]),
    ...admission.roleFacts.guards,
    ...admission.materialGuards,
  ];
}

export function createModelCallService(deps: ModelCallServiceDependencies): ModelRequestPort {
  const records = deps.records;

  async function authorizeModelRequest(
    ctx: CoreCallContext,
    request: GraphWrite<ActualModelRequest>,
  ): Promise<WriteResult<IssuedModelRequest>> {
    const ownedCtx = bindTrustedContext(ctx);
    if (!ownedCtx.ok) return ownedCtx.rejection;
    const { ctx: scopeCtx, scope, actor, signal } = ownedCtx;
    const owned = isolateWrite(request);
    if (!owned.ok) return owned.rejection;
    const actual = owned.input;
    const shape = actualModelRequestProblem(actual);
    if (shape !== null) return shape;
    const claim = actual.permit.claim;
    if (claim.task.projectId !== scope.projectId || claim.workspaceId !== scope.workspaceId) {
      return { status: 'rejected', code: 'forbidden', reason: 'the permit claim is outside the trusted Host scope' };
    }
    const checkedRun = checkRunPin(owned.expected, claim.runRef);
    if (!checkedRun.ok) return checkedRun.rejection;
    const runPin = checkedRun.pin;
    if (signal.aborted) return { status: 'rejected', code: 'cancelled', reason: 'the model authorization was cancelled before lookup' };

    let identity: string;
    let fingerprint: string;
    try {
      identity = identityKey(MODEL_AUTHORIZE_PREFIX, actor, scope.projectId, scope.workspaceId, owned.requestId);
      fingerprint = fingerprintOf({ kind: 'b2-model-authorize', actor: { kind: actor.kind, id: actor.id },
        actual, expected: [{ ref: runPin.ref, revision: runPin.revision }] });
    } catch { return { status: 'rejected', code: 'invalid', reason: 'the model authorization request is not canonicalizable JSON' }; }

    try {
      const lookup = await records.lookupCommit({ identityKey: identity, fingerprint });
      if (lookup.status === 'ready') return await replayModel(records, lookup.value, identity, fingerprint, actor, permitRefFor(actual));
      if (lookup.code !== 'not_found') return mapStoreFailure(lookup);
      if (signal.aborted) return { status: 'rejected', code: 'cancelled', reason: 'the model authorization was cancelled during lookup' };

      const admitted = await admitEnteredRun(deps, scopeCtx, actual.permit, runPin);
      if (!admitted.ok) return admitted.rejection;
      const { facts, manifest, inputBinding } = admitted.value;
      if (actual.contextInputDigest !== inputBinding.inputDigest) {
        return { status: 'rejected', code: 'forbidden', reason: 'the actual request context digest is not the entered input binding' };
      }
      if (actual.manifestDigest !== inputBinding.manifestDigest) {
        return { status: 'rejected', code: 'forbidden', reason: 'the actual request manifest digest is not the entered input binding' };
      }
      const permitRef = permitRefFor(actual);
      const permitKey = permitKeyOf(permitRef);

      const existing = await records.readMany([permitKey]);
      if (existing.status !== 'ready') return mapStoreFailure(existing);
      if (existing.value.records.length > 0) {
        return { status: 'rejected', code: 'revision_conflict', reason: 'a model request permit already exists for this request' };
      }
      const nowIso = deps.now();
      const eventId = deps.eventId();
      if (!nonEmpty(nowIso) || !nonEmpty(eventId)) {
        return { status: 'rejected', code: 'unsupported', reason: 'the injected id/clock source produced an empty value' };
      }
      const permit: ModelRequestPermitV1 = {
        schemaVersion: 1, permitId: permitRef.permitId, runRef: claim.runRef,
        requestId: actual.requestId, requestDigest: actual.requestDigest,
        contextInputDigest: actual.contextInputDigest, manifestDigest: actual.manifestDigest,
        deliveryRefs: inputBinding.deliveryRefs, permissions: manifest.permissions,
        consumedByAttemptId: null, issuedAt: nowIso, consumedAt: null,
      };
      const snapshot: ModelRequestPermitSnapshot = { ref: permitRef, revision: 1, schemaVersion: 1, permit, recordedAt: nowIso };
      const record = encodeModelRequestPermitSnapshot(snapshot);
      const event: ModelRequestRecordedEvent = {
        eventId, eventType: MODEL_REQUEST_AUTHORIZED_EVENT_TYPE,
        schemaVersion: MODEL_REQUEST_EVENT_SCHEMA_VERSION, occurredAt: nowIso,
        identityKey: identity, actor, fingerprint, permitRef, permit, runRevision: facts.run.revision,
      };
      const merged = mergeGuards([
        ...claimChainGuards(admitted.value, runPin.revision),
        { refKey: permitKey, expectedRevision: null },
      ]);
      if (!merged.ok) return merged.rejection;
      const prepared: PreparedCommit = { identityKey: identity, fingerprint, guards: merged.guards, records: [record],
        claims: [], indexGuards: [], indexChanges: [], events: [encodeModelRequestRecordedEvent(event)] };
      if (signal.aborted) return { status: 'rejected', code: 'cancelled', reason: 'the model authorization was cancelled before commit' };
      const receipt = await records.commit(prepared);
      if (receipt.status !== 'committed') return mapStoreFailure(receipt);
      if (receipt.replayed) return await replayModel(records, receipt, identity, fingerprint, actor, permitRef);
      return { status: 'committed', value: { permitRef, permit, runRevision: facts.run.revision }, replayed: false, cursor: receipt.cursor };
    } catch (error) {
      return { status: 'rejected', code: 'unavailable', reason: `the model authorization write failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  async function recordModelRequestAttempt(
    ctx: CoreCallContext,
    request: GraphWrite<{
      request: ActualModelRequest; permitRef: ModelRequestPermitRef; attemptId: string; observedAt: string;
    }>,
  ): Promise<WriteResult<IssuedModelRequest>> {
    const ownedCtx = bindTrustedContext(ctx);
    if (!ownedCtx.ok) return ownedCtx.rejection;
    const { ctx: scopeCtx, scope, actor, signal } = ownedCtx;
    const owned = isolateWrite(request);
    if (!owned.ok) return owned.rejection;
    const { request: actual, permitRef, attemptId, observedAt } = owned.input;
    const shape = actualModelRequestProblem(actual);
    if (shape !== null) return shape;
    if (!isRecord(permitRef) || permitRef.aggregateType !== 'ModelRequestPermit'
      || !nonEmpty(permitRef.projectId) || !nonEmpty(permitRef.workspaceId) || !nonEmpty(permitRef.permitId)) {
      return { status: 'rejected', code: 'invalid', reason: 'the model consumption requires a complete permit ref' };
    }
    if (!nonEmpty(attemptId)) return { status: 'rejected', code: 'invalid', reason: 'the model consumption requires an attemptId' };
    if (!nonEmpty(observedAt) || !Number.isFinite(Date.parse(observedAt))) {
      return { status: 'rejected', code: 'invalid', reason: 'the model consumption requires a legal observedAt instant' };
    }
    const claim = actual.permit.claim;
    const permitIdentity = permitRefFor(actual);
    if (!sameRef(permitIdentity, permitRef)) {
      return { status: 'rejected', code: 'invalid', reason: 'the permit ref does not match the derived request identity' };
    }
    const checked = checkRunAndPermitPins(owned.expected, claim.runRef, permitRef);
    if (!checked.ok) return checked.rejection;
    const runPin = checked.runPin;
    if (signal.aborted) return { status: 'rejected', code: 'cancelled', reason: 'the model consumption was cancelled before lookup' };

    let identity: string;
    let fingerprint: string;
    try {
      identity = identityKey(MODEL_CONSUME_PREFIX, actor, scope.projectId, scope.workspaceId, owned.requestId);
      fingerprint = fingerprintOf({ kind: 'b2-model-consume', actor: { kind: actor.kind, id: actor.id },
        actual, permitRef, attemptId, observedAt,
        expected: [{ ref: runPin.ref, revision: runPin.revision }, { ref: permitRef, revision: 1 }] });
    } catch { return { status: 'rejected', code: 'invalid', reason: 'the model consumption request is not canonicalizable JSON' }; }

    try {
      const lookup = await records.lookupCommit({ identityKey: identity, fingerprint });
      if (lookup.status === 'ready') return await replayModel(records, lookup.value, identity, fingerprint, actor, permitRef);
      if (lookup.code !== 'not_found') return mapStoreFailure(lookup);
      if (signal.aborted) return { status: 'rejected', code: 'cancelled', reason: 'the model consumption was cancelled during lookup' };

      const admitted = await admitEnteredRun(deps, scopeCtx, actual.permit, runPin);
      if (!admitted.ok) return admitted.rejection;
      const { facts, manifest, inputBinding } = admitted.value;
      if (actual.contextInputDigest !== inputBinding.inputDigest || actual.manifestDigest !== inputBinding.manifestDigest) {
        return { status: 'rejected', code: 'forbidden', reason: 'the actual request digests are not the entered input binding' };
      }
      const permitKey = permitKeyOf(permitRef);
      const read = await records.readMany([permitKey]);
      if (read.status !== 'ready') return mapStoreFailure(read);
      const record = read.value.records.find(candidate => candidate.refKey === permitKey);
      if (record === undefined) {
        return read.value.missing.includes(permitKey)
          ? { status: 'rejected', code: 'not_found', reason: 'the model request permit does not exist' }
          : mapStoreFailure({ status: 'rejected', code: 'corrupt', reason: 'the permit key was neither returned nor missing' });
      }
      const decoded = decodeModelRequestPermitSnapshot(record);
      if (decoded.status !== 'decoded') {
        return { status: 'rejected', code: 'unavailable', reason: `the model request permit is damaged: ${decoded.reason}` };
      }
      const stored = decoded.value;
      if (stored.revision !== 1 || stored.permit.consumedByAttemptId !== null) {
        return { status: 'rejected', code: 'revision_conflict', reason: 'the model request permit is already consumed' };
      }
      if (!sameRef(stored.permit.runRef, claim.runRef) || stored.permit.permitId !== permitRef.permitId
        || stored.permit.requestId !== actual.requestId || stored.permit.requestDigest !== actual.requestDigest
        || stored.permit.contextInputDigest !== actual.contextInputDigest
        || stored.permit.manifestDigest !== actual.manifestDigest) {
        return { status: 'rejected', code: 'forbidden', reason: 'the stored permit does not match the actual request' };
      }
      const consumed: ModelRequestPermitV1 = { ...stored.permit, consumedByAttemptId: attemptId, consumedAt: observedAt };
      const nextSnapshot: ModelRequestPermitSnapshot = { ...stored, revision: 2, permit: consumed };
      const nextRecord = encodeModelRequestPermitSnapshot(nextSnapshot);
      const event: ModelRequestRecordedEvent = {
        eventId: deps.eventId(), eventType: MODEL_REQUEST_EVIDENCE_EVENT_TYPE,
        schemaVersion: MODEL_REQUEST_EVENT_SCHEMA_VERSION, occurredAt: observedAt,
        identityKey: identity, actor, fingerprint, permitRef, permit: consumed, runRevision: facts.run.revision,
      };
      if (!nonEmpty(event.eventId)) return { status: 'rejected', code: 'unsupported', reason: 'the injected id source produced an empty event id' };
      const merged = mergeGuards([
        ...claimChainGuards(admitted.value, runPin.revision),
        { refKey: permitKey, expectedRevision: 1 },
      ]);
      if (!merged.ok) return merged.rejection;
      const prepared: PreparedCommit = { identityKey: identity, fingerprint, guards: merged.guards, records: [nextRecord],
        claims: [], indexGuards: [], indexChanges: [], events: [encodeModelRequestRecordedEvent(event)] };
      if (signal.aborted) return { status: 'rejected', code: 'cancelled', reason: 'the model consumption was cancelled before commit' };
      const receipt = await records.commit(prepared);
      if (receipt.status !== 'committed') return mapStoreFailure(receipt);
      if (receipt.replayed) return await replayModel(records, receipt, identity, fingerprint, actor, permitRef);
      return { status: 'committed', value: { permitRef, permit: consumed, runRevision: facts.run.revision }, replayed: false, cursor: receipt.cursor };
    } catch (error) {
      return { status: 'rejected', code: 'unavailable', reason: `the model consumption write failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  return { authorizeModelRequest, recordModelRequestAttempt };
}

async function replayModel(
  records: ModelCallServiceDependencies['records'],
  receipt: Extract<Awaited<ReturnType<ModelCallServiceDependencies['records']['commit']>>, { status: 'committed' }>,
  identity: string, fingerprint: string, actor: HostActor, permitRef: ModelRequestPermitRef,
): Promise<WriteResult<IssuedModelRequest>> {
  const loaded = await loadReplayEvent(records, receipt);
  if (!loaded.ok) return loaded.rejection;
  const decoded = modelRequestRecordedEventFromEvent(loaded.event);
  if (decoded.status !== 'decoded') {
    return { status: 'rejected', code: 'unavailable', reason: `the recorded model-request event is not decodable: ${decoded.reason}` };
  }
  const event = decoded.value;
  if (event.identityKey !== identity || event.fingerprint !== fingerprint) {
    return { status: 'rejected', code: 'unavailable', reason: 'the recorded model-request fact disagrees with the request identity' };
  }
  if (event.actor.kind !== actor.kind || event.actor.id !== actor.id) {
    return { status: 'rejected', code: 'unavailable', reason: 'the recorded model-request fact belongs to another actor' };
  }
  if (!sameRef(event.permitRef, permitRef)) {
    return { status: 'rejected', code: 'unavailable', reason: 'the recorded model-request fact disagrees with the permit ref' };
  }
  return { status: 'committed', value: { permitRef: event.permitRef, permit: event.permit, runRevision: event.runRevision }, replayed: true, cursor: receipt.cursor };
}
