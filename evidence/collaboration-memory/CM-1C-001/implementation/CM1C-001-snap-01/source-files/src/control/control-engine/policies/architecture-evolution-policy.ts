/** Control-owned deterministic domain policy. */
import type { StateLedger, SnapshotResult } from "../../../contracts/ledger.js";
import type { ArchitectureEvolutionPolicyRevisionRef, ArchitectureEvolutionPolicyPin, ArchitectureEvolutionPolicyRevisionSnapshot, ProjectArchitectureEvolutionPolicyActiveRef, ProjectArchitectureEvolutionPolicyActiveSnapshot, ArchitectureEvolutionPolicyResolution } from "../../../contracts/architecture-evolution-policy.js";



function isEvolutionPolicySnapshot(result: SnapshotResult): result is { status: "found"; snapshot: ArchitectureEvolutionPolicyRevisionSnapshot } {
  return result.status === "found" && result.snapshot.ref.aggregateType === "ArchitectureEvolutionPolicyRevision";
}


function isActiveEvolutionPolicySnapshot(result: SnapshotResult): result is { status: "found"; snapshot: ProjectArchitectureEvolutionPolicyActiveSnapshot } {
  return result.status === "found" && result.snapshot.ref.aggregateType === "ProjectArchitectureEvolutionPolicyActive";
}


/** Triple-match resolution of an installed ArchitectureEvolutionPolicy revision. */
export async function resolveArchitectureEvolutionPolicyRevision(ledger: StateLedger, ref: ArchitectureEvolutionPolicyRevisionRef, digest: string): Promise<ArchitectureEvolutionPolicyResolution> {
  const result = await ledger.load(ref);
  if (!isEvolutionPolicySnapshot(result)) return { status: "not_found" };
  const snapshot = result.snapshot;
  if (snapshot.ref.projectId !== ref.projectId || snapshot.policyId !== ref.policyId || snapshot.contentRevision !== ref.revision || snapshot.contentDigest !== digest) {
    return { status: "not_found" };
  }
  return { status: "found", pin: { ref, digest }, snapshot };
}


/** Project active-ref resolution — exact triple match, never a fallback. */
export async function resolveProjectArchitectureEvolutionPolicy(ledger: StateLedger, projectId: string): Promise<ArchitectureEvolutionPolicyResolution> {
  const activeRef: ProjectArchitectureEvolutionPolicyActiveRef = { aggregateType: "ProjectArchitectureEvolutionPolicyActive", projectId };
  const activeResult = await ledger.load(activeRef);
  if (!isActiveEvolutionPolicySnapshot(activeResult)) return { status: "not_found" };
  const active = activeResult.snapshot;
  const pin: ArchitectureEvolutionPolicyPin = { ref: active.activeRevision, digest: "" };
  // Load the revision snapshot to obtain the stored digest (triple match).
  const revResult = await ledger.load(active.activeRevision);
  if (!isEvolutionPolicySnapshot(revResult)) return { status: "not_found" };
  const rev = revResult.snapshot;
  if (rev.ref.projectId !== projectId || rev.policyId !== active.activeRevision.policyId || rev.contentRevision !== active.activeRevision.revision) return { status: "not_found" };
  pin.digest = rev.contentDigest;
  return { status: "found", pin, snapshot: rev };
}