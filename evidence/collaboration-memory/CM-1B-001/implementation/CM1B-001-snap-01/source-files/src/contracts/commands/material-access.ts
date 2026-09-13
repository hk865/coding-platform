/** Formal command/value construction. Identity, authority, scope and time are caller inputs. */
import type { GrantMaterialAccessCommand, MaterialAccessGrantV1, MaterialBasisV1, MaterialGrantIssuer, MaterialAccessScopeV1 } from "../material-access.js";
import type { ArtifactOwnerRunRef, ArtifactRef } from "../artifact.js";

export function buildMaterialAccessGrantV1(opts: {
  grantId: string;
  scope: MaterialAccessScopeV1;
  materials: ArtifactRef[];
  reader: ArtifactOwnerRunRef;
  issuedBy: MaterialGrantIssuer;
  purpose: string;
  basis: MaterialBasisV1;
  grantedAt: string;
}): MaterialAccessGrantV1 {
  return {
    schemaVersion: 1,
    grantId: opts.grantId,
    scope: { ...opts.scope },
    materials: opts.materials.map((m) => ({ ...m })),
    reader: { ...opts.reader },
    issuedBy: { ...opts.issuedBy },
    purpose: opts.purpose,
    basis: { ...opts.basis },
    grantedAt: opts.grantedAt,
  };
}

export function buildGrantMaterialAccessCommand(
  grant: MaterialAccessGrantV1,
  deps: { commandId: string; projectId: string; actorKind: "human" | "system"; actorId: string; idempotencyKey: string; correlationId: string; submittedAt: string },
): GrantMaterialAccessCommand {
  return {
    commandId: deps.commandId,
    commandType: "GrantMaterialAccess",
    schemaVersion: 1,
    identity: { projectId: deps.projectId, actor: { kind: deps.actorKind, id: deps.actorId }, idempotencyKey: deps.idempotencyKey },
    aggregateId: grant.grantId,
    expectedRevision: 0,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: { grant },
  };
}
