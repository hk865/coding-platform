/** Internal StateLedger batch-identity rules. Both adapters invoke these inside their commit protocol. */
import { canonicalJson } from "../../../contracts/fingerprint.js";
import { commandIdentityKey } from "../../../contracts/command-event.js";
import { bootstrapIdentityKey } from "../../../contracts/bootstrap.js";


export function identityMatchesActor(
  projectId: string,
  idempotencyKey: string,
  actorKind: string,
  actorId: string,
  batchIdentity: { projectId: string; idempotencyKey: string; actor: { kind: string; id: string } },
): boolean {
  return (
    projectId === batchIdentity.projectId &&
    idempotencyKey === batchIdentity.idempotencyKey &&
    actorKind === batchIdentity.actor.kind &&
    actorId === batchIdentity.actor.id
  );
}


// ------------------------------------------------------------------------ //
// workspace concurrency pure commit validators (shared by both ledger adapters)             //
// ------------------------------------------------------------------------ //

export function expectedVersionOf(batch: { expectedVersions: { ref: { aggregateType: string }; revision: number }[] }, ref: { aggregateType: string }): number | null {
  const hit = batch.expectedVersions.find((v) => canonicalJson(v.ref) === canonicalJson(ref));
  return hit === undefined ? null : hit.revision;
}


export function ledgerIdentityKeyFor(batch: import("../../../contracts/ledger.js").LedgerCommit): string {
  if (batch.commitKind === "bootstrap") {
    return "bootstrap:" + bootstrapIdentityKey(batch.identity);
  }
  // goal-create / governance-install / governance-activate / plan-revision and
  // the remaining kinds all carry a project-scoped CommandIdentity.
  return batch.commitKind + ":" + commandIdentityKey(batch.identity);
}
