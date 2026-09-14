/** Internal directed-request commit construction. Control admission remains in the command handler. */
import type { CancelCommunicationCommand, DeliverySnapshot, DeliveryV1, DirectedRequestCancelCommitV1, DirectedRequestRef, DirectedRequestRespondCommitV1, DirectedRequestSendCommitV1, DirectedRequestSnapshot, DirectedRequestV1, RespondDirectedRequestCommand, SendDirectedRequestCommand } from "../../../../contracts/coordination.js";
import { deliveryRecordedEvent, directedRequestCancelledEvent, directedRequestRespondedEvent, directedRequestSentEvent, directDeliveryIdFor } from "../../../../contracts/coordination-events.js";
import type { CoordinationFoldDeps } from './shared.js';
import { ctxOf } from './shared.js';


// ------------------------------------------------------------------------ //
// DirectedRequest（定向请求）                                                     //
// ------------------------------------------------------------------------ //

export function directedRequestRefForOf(projectId: string, workspaceId: string, requestId: string): DirectedRequestRef {
  return { aggregateType: "DirectedRequest", projectId, workspaceId, requestId };
}


export function deliveryRefForOf(projectId: string, workspaceId: string, deliveryId: string): DeliveryV1 extends never ? never : { aggregateType: "Delivery"; projectId: string; workspaceId: string; deliveryId: string } {
  return { aggregateType: "Delivery", projectId, workspaceId, deliveryId };
}


export function buildDirectedRequestSendCommit(input: {
  command: SendDirectedRequestCommand;
  deps: CoordinationFoldDeps;
  fingerprint: DirectedRequestSendCommitV1["fingerprint"];
  sourceRefs: { kind: string; refId: string; revision: string }[];
}): DirectedRequestSendCommitV1 {
  const { command, deps } = input;
  const workspaceId = deps.workspaceId;
  const now = deps.now();
  const projectId = command.identity.projectId;
  const ref = directedRequestRefForOf(projectId, workspaceId, command.aggregateId);
  const request: DirectedRequestV1 = {
    schemaVersion: 1,
    requestId: command.aggregateId,
    projectId,
    workspaceId,
    fromWorkContextRef: {
      aggregateType: "WorkContextBinding",
      projectId: command.payload.fromParticipationRef.projectId,
      workspaceId: command.payload.fromParticipationRef.workspaceId,
      workId: command.payload.fromParticipationRef.workId,
    },
    fromParticipationRef: command.payload.fromParticipationRef,
    fromRunRef: command.payload.fromRunRef,
    toWorkContextRef: command.payload.toWorkContextRef,
    expectedParticipationRef: command.payload.expectedParticipationRef,
    statement: command.payload.statement,
    statementBodyRef: command.payload.statementBodyRef,
    roleBinding: { ...command.payload.roleBinding },
    status: "routed",
    createdAt: now,
    respondedAt: null,
    response: null,
    cancelledAt: null,
    expiredAt: null,
  };
  const snapshot: DirectedRequestSnapshot = { ref, revision: 1, schemaVersion: 1, request, recordedAt: now };
  const delivery: DeliveryV1 = {
    schemaVersion: 1,
    deliveryId: directDeliveryIdFor(command.aggregateId, command.payload.toWorkContextRef.workId),
    projectId,
    workspaceId,
    origin: { kind: "directed_request", requestRef: ref },
    targetWorkContextRef: command.payload.toWorkContextRef,
    bodyRef: command.payload.statementBodyRef,
    sourceRefs: input.sourceRefs,
    createdAt: now,
  };
  const deliverySnapshot: DeliverySnapshot = {
    ref: deliveryRefForOf(projectId, workspaceId, delivery.deliveryId),
    revision: 1,
    schemaVersion: 1,
    delivery,
    recordedAt: now,
  };
  const ctx = ctxOf(command, now);
  return {
    commitKind: "directed-request-send",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: input.fingerprint,
    expectedVersions: [
      { ref, revision: 0 },
      { ref: deliverySnapshot.ref, revision: 0 },
    ],
    events: [directedRequestSentEvent(ctx, deps.eventId(), request), deliveryRecordedEvent(ctx, deps.eventId(), delivery)],
    snapshots: [snapshot, deliverySnapshot],
    outboxIntents: [],
  };
}


export function buildDirectedRequestRespondCommit(input: {
  command: RespondDirectedRequestCommand;
  deps: CoordinationFoldDeps;
  fingerprint: DirectedRequestRespondCommitV1["fingerprint"];
  prior: DirectedRequestSnapshot;
}): DirectedRequestRespondCommitV1 {
  const { command, deps, prior } = input;
  const now = deps.now();
  const request: DirectedRequestV1 = {
    ...prior.request,
    status: "responded",
    respondedAt: now,
    response: {
      bodyRef: command.payload.response.bodyRef,
      sourceRefs: command.payload.response.sourceRefs.map((s) => ({ ...s })),
      authorRunRef: command.payload.response.authorRunRef,
    },
  };
  const snapshot: DirectedRequestSnapshot = { ...prior, revision: prior.revision + 1, request, recordedAt: now };
  return {
    commitKind: "directed-request-respond",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: input.fingerprint,
    expectedVersions: [{ ref: prior.ref, revision: command.expectedRevision }],
    events: [directedRequestRespondedEvent(ctxOf(command, now), deps.eventId(), request, snapshot.revision)],
    snapshots: [snapshot],
    outboxIntents: [],
  };
}


export function buildDirectedRequestCancelCommit(input: {
  command: CancelCommunicationCommand;
  deps: CoordinationFoldDeps;
  fingerprint: DirectedRequestCancelCommitV1["fingerprint"];
  prior: DirectedRequestSnapshot;
}): DirectedRequestCancelCommitV1 {
  const { command, deps, prior } = input;
  const now = deps.now();
  const request: DirectedRequestV1 = { ...prior.request, status: "cancelled", cancelledAt: now };
  const snapshot: DirectedRequestSnapshot = { ...prior, revision: prior.revision + 1, request, recordedAt: now };
  return {
    commitKind: "directed-request-cancel",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: input.fingerprint,
    expectedVersions: [{ ref: prior.ref, revision: command.expectedRevision }],
    events: [directedRequestCancelledEvent(ctxOf(command, now), deps.eventId(), request, snapshot.revision)],
    snapshots: [snapshot],
    outboxIntents: [],
  };
}
