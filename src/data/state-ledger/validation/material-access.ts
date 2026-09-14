/** Internal StateLedger material-access rules. Both adapters invoke these inside their commit protocol. */
import { canonicalJson } from "../../../contracts/fingerprint.js";
import { isKnownEventType } from "../../../contracts/events.js";
import { MATERIAL_ACCESS_MAX_MATERIALS, validMaterialSourcePin } from "../../../contracts/material-access.js";
import { identityMatchesActor } from './batch-identity.js';


// ------------------------------------------------------------------------ //
// material-access-grant (material access)                                             //
// ------------------------------------------------------------------------ //

/**
 * One immutable grant @0. The validator is pure: it checks the event/snapshot
 * alignment and the grant's internal consistency (scope match, bounded material
 * set, reader/issuer shape, basis shape). It does NOT check whether the
 * materials are actually stored — that is the ArtifactVault's read-time job —
 * and it never judges the grant's business value.
 */
export function validateMaterialAccessGrantCommit(batch: import("../../../contracts/ledger.js").MaterialAccessGrantLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1 || batch.snapshots.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "MaterialAccessGranted") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "MaterialAccessGrant") return false;
  if (event.aggregateRevision !== 1) return false;
  const snapshot = batch.snapshots[0]!;
  if (snapshot.ref.aggregateType !== "MaterialAccessGrant") return false;
  if (snapshot.revision !== 1 || snapshot.schemaVersion !== 1) return false;
  if (snapshot.revocation !== undefined) return false;
  const grant = snapshot.grant;
  if (grant.grantId !== event.aggregateId) return false;
  if (canonicalJson(grant) !== canonicalJson(event.payload.grant)) return false;
  if (grant.grantedAt !== event.payload.grantedAt) return false;
  if (grant.scope.projectId !== event.projectId) return false;
  if (grant.scope.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.projectId !== event.projectId) return false;
  if (snapshot.ref.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.goalId !== grant.scope.goalId) return false;
  if (snapshot.ref.grantId !== grant.grantId) return false;
  if (!Array.isArray(grant.materials) || grant.materials.length === 0) return false;
  if (grant.materials.length > MATERIAL_ACCESS_MAX_MATERIALS) return false;
  if (grant.purpose.length === 0) return false;
  if (grant.basis.planRef !== null && grant.basis.planRef.projectId !== event.projectId) return false;
  const sourcePin = grant.basis.sourcePin;
  if (sourcePin !== undefined && (!validMaterialSourcePin(sourcePin) || sourcePin.projectId !== grant.scope.projectId || sourcePin.workspaceId !== grant.scope.workspaceId)) return false;
  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== 0) return false;
  if (canonicalJson(expected.ref) !== canonicalJson(snapshot.ref)) return false;
  const crossWorkspace = grant.history?.crossWorkspace;
  if (crossWorkspace && (grant.history?.usage !== 'historical_explanation' || grant.issuedBy.aggregateType !== 'Control' ||
      grant.history.owner.projectId !== grant.scope.projectId || typeof crossWorkspace.sourceWorkspaceId !== 'string' || !crossWorkspace.sourceWorkspaceId ||
      crossWorkspace.sourceWorkspaceId === grant.scope.workspaceId || crossWorkspace.authorizedBy?.kind !== 'human' || !crossWorkspace.authorizedBy.id ||
      event.actor.kind !== 'human' || event.actor.id !== crossWorkspace.authorizedBy.id)) return false;
  if (!identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity)) return false;
  return true;
}


export function validateMaterialAccessRevokeCommit(batch: import("../../../contracts/ledger.js").MaterialAccessRevokeLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 1 || batch.outboxIntents.length !== 0 || batch.expectedVersions.length !== 1) return false;
  const event = batch.events[0], snapshot = batch.snapshots[0], expected = batch.expectedVersions[0]!;
  const ref = snapshot.ref, grant = snapshot.grant, revoked = snapshot.revocation;
  if (snapshot.schemaVersion !== 1 || snapshot.revision !== 2 || !revoked || !revoked.reason || Buffer.byteLength(revoked.reason, "utf8") > 1024) return false;
  if (event.eventType !== "MaterialAccessRevoked" || event.schemaVersion !== 1 || event.aggregateRevision !== 2 || event.aggregateType !== "MaterialAccessGrant" || ref.aggregateType !== "MaterialAccessGrant") return false;
  if (event.projectId !== ref.projectId || event.workspaceId !== ref.workspaceId || event.aggregateId !== ref.grantId || grant.grantId !== ref.grantId || grant.scope.goalId !== ref.goalId || grant.scope.projectId !== ref.projectId || grant.scope.workspaceId !== ref.workspaceId) return false;
  if (expected.revision !== 1 || canonicalJson(expected.ref) !== canonicalJson(ref)) return false;
  if (canonicalJson(event.payload) !== canonicalJson({ grant, revocation: revoked })) return false;
  if (revoked.commandId !== event.causationId || revoked.revokedAt !== event.occurredAt || canonicalJson(revoked.actor) !== canonicalJson(event.actor)) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}
