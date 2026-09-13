import type { RevokeMaterialAccessCommand, RevokeMaterialAccessReceipt, MaterialAccessGrantSnapshot } from "../../contracts/material-access.js";
import { revokeMaterialAccessFingerprint } from "../../contracts/material-access.js";
import { validateRevokeMaterialAccessCommand } from '../../contracts/validation/material-access.js';
import type { ControlEngineDeps } from "./control-engine.js";

export async function revokeMaterialAccess(deps: ControlEngineDeps, command: RevokeMaterialAccessCommand): Promise<RevokeMaterialAccessReceipt> {
  if (validateRevokeMaterialAccessCommand(command).length) return { status: "rejected", commandId: command.commandId, code: "invalid" };
  const ref = command.payload.grantRef;
  if (ref.projectId !== command.identity.projectId) return { status: "rejected", commandId: command.commandId, code: "scope_mismatch" };
  const loaded = await deps.ledger.load(ref);
  if (loaded.status !== "found") return { status: "rejected", commandId: command.commandId, code: "not_found" };
  const grant = (loaded.snapshot as MaterialAccessGrantSnapshot).grant;
  const revocation = { reason: command.payload.reason, actor: command.identity.actor, commandId: command.commandId, revokedAt: deps.now() };
  // Always pass the same logical command to ledger idempotency, including after
  // restart when the snapshot is already revoked. A fresh command cannot CAS@1.
  const receipt = await deps.ledger.commit({
    commitKind: "material-access-revoke", schemaVersion: 1, identity: command.identity,
    fingerprint: revokeMaterialAccessFingerprint(command), expectedVersions: [{ ref, revision: 1 }],
    snapshots: [{ ref, revision: 2, schemaVersion: 1, grant, revocation }], outboxIntents: [],
    events: [{ eventId: deps.eventId(), eventType: "MaterialAccessRevoked", schemaVersion: 1,
      projectId: ref.projectId, workspaceId: ref.workspaceId, aggregateType: "MaterialAccessGrant",
      aggregateId: ref.grantId, aggregateRevision: 2, causationId: command.commandId,
      correlationId: command.correlationId, idempotencyKey: command.identity.idempotencyKey,
      actor: command.identity.actor, occurredAt: revocation.revokedAt, payload: { grant, revocation } }],
  });
  if (receipt.status === "committed") return { ...receipt, commandId: command.commandId, grantRef: ref };
  return { status: "rejected", commandId: command.commandId,
    code: receipt.code === "invalid_commit" || receipt.code === "not_empty" ? "invalid" : receipt.code };
}
