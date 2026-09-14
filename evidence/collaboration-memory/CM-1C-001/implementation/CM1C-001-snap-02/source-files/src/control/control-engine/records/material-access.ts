/** Control-owned canonical record construction. */
import type { GrantMaterialAccessCommand, MaterialAccessGrantRef } from "../../../contracts/material-access.js";
import { grantMaterialAccessFingerprint, materialAccessGrantRefFor } from "../../../contracts/material-access.js";
import type { MaterialAccessGrantLedgerCommitV1 } from "../../../contracts/ledger.js";



export function buildMaterialAccessGrantLedgerCommit(
  command: GrantMaterialAccessCommand,
  deps: { eventId: string; occurredAt: string },
): MaterialAccessGrantLedgerCommitV1 {
  const grant = command.payload.grant;
  const ref: MaterialAccessGrantRef = materialAccessGrantRefFor(
    command.identity.projectId,
    grant.scope.workspaceId,
    grant.scope.goalId,
    command.aggregateId,
  );
  return {
    commitKind: "material-access-grant",
    schemaVersion: 1,
    identity: command.identity,
    fingerprint: grantMaterialAccessFingerprint(command),
    expectedVersions: [{ ref, revision: 0 }],
    events: [
      {
        eventId: deps.eventId,
        eventType: "MaterialAccessGranted",
        schemaVersion: 1,
        projectId: command.identity.projectId,
        workspaceId: grant.scope.workspaceId,
        aggregateType: "MaterialAccessGrant",
        aggregateId: command.aggregateId,
        aggregateRevision: 1,
        causationId: command.commandId,
        correlationId: command.correlationId,
        idempotencyKey: command.identity.idempotencyKey,
        actor: { ...command.identity.actor },
        occurredAt: deps.occurredAt,
        payload: { grant, grantedAt: grant.grantedAt },
      },
    ],
    snapshots: [{ ref, revision: 1, schemaVersion: 1, grant }],
    outboxIntents: [],
  };
}