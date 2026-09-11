/** Canonical governance record resolution by exact identity and digest; read-only. */
import type { SnapshotResult, StateLedger } from "../../contracts/ledger.js";
import type { CompletionPolicyRevisionRef, ArchitectureBaselineRevisionRef, CompletionPolicyRevisionSnapshot, ArchitectureBaselineRevisionSnapshot, ProjectCompletionPolicyActiveRef, ProjectArchitectureBaselineActiveRef, ProjectCompletionPolicyActiveSnapshot, ProjectArchitectureBaselineActiveSnapshot, CompletionPolicyResolution, ArchitectureBaselineResolution, ProjectCompletionPolicyActiveResolution, ProjectArchitectureBaselineActiveResolution } from "../../contracts/governance.js";



function isCompletionPolicySnapshot(
  result: SnapshotResult,
): result is { status: "found"; snapshot: CompletionPolicyRevisionSnapshot } {
  return result.status === "found" && result.snapshot.ref.aggregateType === "CompletionPolicyRevision";
}


function isArchitectureBaselineSnapshot(
  result: SnapshotResult,
): result is { status: "found"; snapshot: ArchitectureBaselineRevisionSnapshot } {
  return (
    result.status === "found" && result.snapshot.ref.aggregateType === "ArchitectureBaselineRevision"
  );
}


function isActivePolicySnapshot(
  result: SnapshotResult,
): result is { status: "found"; snapshot: ProjectCompletionPolicyActiveSnapshot } {
  return (
    result.status === "found" && result.snapshot.ref.aggregateType === "ProjectCompletionPolicyActive"
  );
}


function isActiveBaselineSnapshot(
  result: SnapshotResult,
): result is { status: "found"; snapshot: ProjectArchitectureBaselineActiveSnapshot } {
  return (
    result.status === "found" &&
    result.snapshot.ref.aggregateType === "ProjectArchitectureBaselineActive"
  );
}


/**
 * Resolve an installed CompletionPolicy revision by exact triple match
 * (ref identity/revision + digest). The loaded snapshot must carry the same
 * projectId/policyId/revision as the ref AND the same contentDigest.
 */
export async function resolveCompletionPolicyRevision(
  ledger: StateLedger,
  ref: CompletionPolicyRevisionRef,
  digest: string,
): Promise<CompletionPolicyResolution> {
  const result = await ledger.load(ref);
  if (!isCompletionPolicySnapshot(result)) return { status: "not_found" };
  const snapshot = result.snapshot;
  if (
    snapshot.ref.projectId !== ref.projectId ||
    snapshot.policyId !== ref.policyId ||
    snapshot.contentRevision !== ref.revision ||
    snapshot.contentDigest !== digest
  ) {
    return { status: "not_found" };
  }
  return { status: "found", pin: { ref, digest }, snapshot };
}


export async function resolveArchitectureBaselineRevision(
  ledger: StateLedger,
  ref: ArchitectureBaselineRevisionRef,
  digest: string,
): Promise<ArchitectureBaselineResolution> {
  const result = await ledger.load(ref);
  if (!isArchitectureBaselineSnapshot(result)) return { status: "not_found" };
  const snapshot = result.snapshot;
  if (
    snapshot.ref.projectId !== ref.projectId ||
    snapshot.baselineId !== ref.baselineId ||
    snapshot.contentRevision !== ref.revision ||
    snapshot.contentDigest !== digest
  ) {
    return { status: "not_found" };
  }
  return { status: "found", pin: { ref, digest }, snapshot };
}


/** Load the project's active CompletionPolicy ref aggregate (if any). */
export async function loadProjectCompletionPolicyActive(
  ledger: StateLedger,
  projectId: string,
): Promise<ProjectCompletionPolicyActiveResolution> {
  const ref: ProjectCompletionPolicyActiveRef = {
    aggregateType: "ProjectCompletionPolicyActive",
    projectId,
  };
  const result = await ledger.load(ref);
  if (!isActivePolicySnapshot(result)) return { status: "not_found" };
  return { status: "found", snapshot: result.snapshot };
}


export async function loadProjectArchitectureBaselineActive(
  ledger: StateLedger,
  projectId: string,
): Promise<ProjectArchitectureBaselineActiveResolution> {
  const ref: ProjectArchitectureBaselineActiveRef = {
    aggregateType: "ProjectArchitectureBaselineActive",
    projectId,
  };
  const result = await ledger.load(ref);
  if (!isActiveBaselineSnapshot(result)) return { status: "not_found" };
  return { status: "found", snapshot: result.snapshot };
}


/**
 * Resolve an installed CompletionPolicy revision for the effective pin of a
 * project. The ACTIVE aggregate stores only the ref; resolution loads the
 * revision snapshot and verifies the identity triple AND that the snapshot's
 * canonical contentDigest matches the installed digest (the pin). P1-02 has
 * NO default and NO fallback — missing active ref or unresolvable revision is
 * a hard not_found (zero-write).
 */
export async function resolveProjectCompletionPolicy(
  ledger: StateLedger,
  projectId: string,
): Promise<CompletionPolicyResolution> {
  const active = await loadProjectCompletionPolicyActive(ledger, projectId);
  if (active.status === "not_found") return { status: "not_found" };
  const ref = active.snapshot.activeRevision;
  const result = await ledger.load(ref);
  if (!isCompletionPolicySnapshot(result)) return { status: "not_found" };
  const snapshot = result.snapshot;
  if (
    snapshot.ref.projectId !== ref.projectId ||
    snapshot.policyId !== ref.policyId ||
    snapshot.contentRevision !== ref.revision
  ) {
    return { status: "not_found" };
  }
  return { status: "found", pin: { ref, digest: snapshot.contentDigest }, snapshot };
}


/**
 * Effective ArchitectureBaseline for a project (same semantics: currently
 * active revision resolved to its exact pin; no default / no fallback).
 */
export async function resolveProjectArchitectureBaseline(
  ledger: StateLedger,
  projectId: string,
): Promise<ArchitectureBaselineResolution> {
  const active = await loadProjectArchitectureBaselineActive(ledger, projectId);
  if (active.status === "not_found") return { status: "not_found" };
  const ref = active.snapshot.activeRevision;
  const result = await ledger.load(ref);
  if (!isArchitectureBaselineSnapshot(result)) return { status: "not_found" };
  const snapshot = result.snapshot;
  if (
    snapshot.ref.projectId !== ref.projectId ||
    snapshot.baselineId !== ref.baselineId ||
    snapshot.contentRevision !== ref.revision
  ) {
    return { status: "not_found" };
  }
  return { status: "found", pin: { ref, digest: snapshot.contentDigest }, snapshot };
}