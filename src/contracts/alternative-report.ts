/** CM-M06: deterministic selection of an optional report, never Evidence admission. */
import type { AggregateRef, AggregateSnapshot, PositionedEvent } from './ledger.js';
import type { DeliverySnapshot, DirectedRequestSnapshot, WaitConditionSnapshot } from './coordination.js';
import { deliveryRefFor, directedRequestRefFor } from './coordination.js';
import type { CommitCursor } from './command-event.js';
import { canonicalJson } from './fingerprint.js';
import type { MaterialAccessGrantRef, MaterialAccessGrantSnapshot, MaterialBasisV1 } from './material-access.js';
import { materialAccessGrantIdFor, validMaterialSourcePin } from './material-access.js';
import type { RunSnapshot } from './dispatch.js';

export type AlternativeReportSelection = {
  conditionIndex: number;
  deliveryRef: DeliverySnapshot['ref'];
  /** Ordered DeliveryRecorded position, not wall-clock time or callback order. */
  sourceCursor: CommitCursor;
};
export type AlternativeReportResult =
  | { status: 'selected'; selection: AlternativeReportSelection; candidates: AlternativeReportCandidate[] }
  | { status: 'pending' }
  | { status: 'unavailable'; reason: string };
export const ALTERNATIVE_REPORT_SCAN_LIMIT = 200_000;
export type AlternativeReportCandidate = AlternativeReportSelection & { delivery: DeliverySnapshot; request: DirectedRequestSnapshot };
export type AlternativeReportQualification = {
  basis: MaterialBasisV1;
  observations: { selection: AlternativeReportSelection; grantRef: MaterialAccessGrantRef; grantRevision: number;
    outcome: 'readable' | 'missing_body' | 'refused' | 'invalid_body' | 'stale'; reason: string }[];
};
/** Trusted host observation, never accepted from a model/command payload. */
export interface AlternativeReportObservationPort {
  observe(wait: WaitConditionSnapshot, predecessor: RunSnapshot, candidates: AlternativeReportCandidate[], token?: string):
    Promise<{ status: 'observed'; qualification: AlternativeReportQualification } | { status: 'unavailable'; reason: string }>;
}
/** Ephemeral Host capability; neither the token nor dispose is durable evidence. */
export type AlternativeReportInspection = { token: string; dispose(): void };

/** All inputs come from the ledger; adapters also run this fold inside admission CAS. */
export function selectAlternativeReport(wait: WaitConditionSnapshot, events: readonly PositionedEvent[],
  get: (ref: AggregateRef) => AggregateSnapshot | undefined): AlternativeReportResult {
  if (wait.wait.mode !== 'any') return { status: 'unavailable', reason: 'not an alternative-report wait' };
  if (events.length > ALTERNATIVE_REPORT_SCAN_LIMIT) return { status: 'unavailable', reason: 'report history exceeds the bounded scan' };
  const positions = new Map(events.map(row => [String(row.cursor), row.event]));
  const candidates: AlternativeReportCandidate[] = [];
  for (const row of events) {
    if (row.event.eventType !== 'DeliveryRecorded') continue;
    const eventDelivery = row.event.payload.delivery;
    if (canonicalJson(eventDelivery.targetWorkContextRef) !== canonicalJson(wait.wait.ownerWorkContextRef)) continue;
    const ref = deliveryRefFor(eventDelivery.projectId, eventDelivery.workspaceId, eventDelivery.deliveryId);
    const loaded = get(ref);
    if (loaded?.ref.aggregateType !== 'Delivery') continue;
    const delivery = (loaded as DeliverySnapshot).delivery;
    if (!delivery.bodyRef || delivery.origin.kind !== 'subscription' || delivery.origin.sourceTopic !== 'DirectedRequestResponded') continue;
    const responseEvent = positions.get(String(delivery.origin.sourceCursor));
    if (responseEvent?.eventType !== 'DirectedRequestResponded') continue;
    const response = responseEvent.payload.request;
    const requestRef = directedRequestRefFor(response.projectId, response.workspaceId, response.requestId);
    const request = get(requestRef) as DirectedRequestSnapshot | undefined;
    if (!request?.request.response || canonicalJson(request.request.fromWorkContextRef) !== canonicalJson(wait.wait.ownerWorkContextRef) ||
        canonicalJson(request.request.response.bodyRef) !== canonicalJson(delivery.bodyRef) ||
        canonicalJson(response.response) !== canonicalJson(request.request.response)) continue;
    const index = wait.wait.conditions.findIndex(term => term.kind === 'delivery_present'
      ? canonicalJson(term.deliveryRef) === canonicalJson(ref)
      : term.kind === 'request_responded' && canonicalJson(term.requestRef) === canonicalJson(requestRef));
    if (index >= 0) candidates.push({ conditionIndex: index, deliveryRef: ref, sourceCursor: row.cursor, delivery: loaded as DeliverySnapshot, request });
  }
  const first = candidates[0];
  if (candidates.length > 64) return { status: 'unavailable', reason: 'Optional report candidate count exceeds 64; inspection cannot silently truncate' };
  return first ? { status: 'selected', selection: reportSelectionOf(first), candidates } : { status: 'pending' };
}

export function reportSelectionOf(candidate: AlternativeReportCandidate): AlternativeReportSelection {
  return { conditionIndex: candidate.conditionIndex, deliveryRef: candidate.deliveryRef, sourceCursor: candidate.sourceCursor };
}

/** Independently replayed inside the ledger admission transaction. The body
 * observation is trusted Host evidence, while order, grants and scopes are canonical. */
export function qualifiedAlternativeReport(wait: WaitConditionSnapshot, candidates: AlternativeReportCandidate[], proof: AlternativeReportQualification,
  get: (ref: AggregateRef) => AggregateSnapshot | undefined): AlternativeReportSelection | null {
  if (!proof?.basis || !Array.isArray(proof.observations) || !proof.observations.length || proof.observations.length > candidates.length) return null;
  const predecessor = get(wait.wait.predecessorRunRef) as RunSnapshot | undefined;
  const workspace = get({ aggregateType: 'Workspace', projectId: wait.ref.projectId, workspaceId: wait.ref.workspaceId });
  const goal = get({ aggregateType: 'Goal', projectId: wait.ref.projectId, goalId: wait.wait.predecessorRunRef.goalId }) as import('./ledger.js').GoalSnapshot | undefined;
  if (!predecessor?.envelope || !workspace || !goal || !validMaterialSourcePin(proof.basis.sourcePin) ||
      proof.basis.sourcePin.projectId !== wait.ref.projectId || proof.basis.sourcePin.workspaceId !== wait.ref.workspaceId ||
      proof.basis.sourceDigest !== proof.basis.sourcePin.manifestDigest || workspace.revision !== proof.basis.workspaceRevision ||
      canonicalJson(predecessor.planRef) !== canonicalJson(proof.basis.planRef) ||
      (goal.activePlanRevision !== null && canonicalJson(goal.activePlanRevision) !== canonicalJson(proof.basis.planRef))) return null;
  for (let index = 0; index < proof.observations.length; index++) {
    const observation = proof.observations[index]!, candidate = candidates[index]!;
    if (canonicalJson(observation.selection) !== canonicalJson(reportSelectionOf(candidate))) return null;
    const loaded = get(observation.grantRef);
    if (loaded?.ref.aggregateType !== 'MaterialAccessGrant' || loaded.revision !== observation.grantRevision) return null;
    const grant = loaded as MaterialAccessGrantSnapshot;
    const body = candidate.delivery.delivery.bodyRef!;
    if (canonicalJson(grant.grant.reader) !== canonicalJson(wait.wait.predecessorRunRef) ||
        grant.grant.scope.projectId !== wait.ref.projectId || grant.grant.scope.workspaceId !== wait.ref.workspaceId ||
        grant.grant.scope.goalId !== wait.wait.predecessorRunRef.goalId ||
        canonicalJson(grant.grant.materials) !== canonicalJson([body]) || canonicalJson(grant.grant.basis) !== canonicalJson(proof.basis) ||
        grant.grant.grantId !== materialAccessGrantIdFor(wait.wait.predecessorRunRef, [body], proof.basis)) return null;
    if (!['readable', 'missing_body', 'refused', 'invalid_body', 'stale'].includes(observation.outcome) || !observation.reason) return null;
    if (observation.outcome === 'readable') return !grant.revocation && index === proof.observations.length - 1 ? observation.selection : null;
  }
  return null;
}
