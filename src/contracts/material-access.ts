/**
 * Material access grants — cross-principal read authorization for stored
 * material (ArtifactVault), bound to the source version it was granted against.
 * Grants were deleted (decision 34): what stays is the persisted grant ref and
 * basis, the source pin types and the material identity helpers. The source pin
 * capture pair (provider and applicability) was deleted too (2026-10-08): slice 3
 * of the orchestration design reads upstream material as recorded, not as current.
 */
import type { ArtifactOwnerRunRef, ArtifactRef } from "./artifact.js";
import type { PlanRevisionRef } from "./plan.js";
// ------------------------------------------------------------------------ //
// Basis (source version the grant is bound to)                              //
// ------------------------------------------------------------------------ //
/**
 * The version basis a grant is valid for. `null` means "not bound to that
 * dimension"; an all-null basis is UNCONDITIONAL (valid under any basis).
 * Timestamps are deliberately absent: they cannot express applicability.
 */
export type MaterialBasisV1 = {
    planRef: PlanRevisionRef | null;
    workspaceRevision: number | null;
    /** Source snapshot digest when the material came from an explicit source set. */
    sourceDigest: string | null;
    /** Actual source identity, as recorded; the capability that captured and re-read it
     * was deleted (2026-10-08), so a recorded pin names a version and never proves it current.
     * sourceDigest retains its producer-defined meaning; it is never proof of currentness. */
    sourcePin?: MaterialSourcePinV1;
};
/** Paths name exact files or subtree roots; '.' names the readable workspace.
 * Sorted, unique paths prevent multiple spellings of one source selection. */
export type MaterialSourceSetV1 = {
    kind: 'workspace_paths';
    paths: string[];
} | {
    kind: 'verification_workspace';
    paths: [
        '.'
    ];
};
export type MaterialSourceScope = {
    projectId: string;
    workspaceId: string;
};
export type MaterialSourcePinV1 = MaterialSourceScope & {
    schemaVersion: 1;
    sourceSet: MaterialSourceSetV1;
    identity: {
        workspace: string;
        commit: string | null;
    };
    manifestDigest: string;
};
export function validMaterialSourceSet(value: unknown): value is MaterialSourceSetV1 {
    if (!value || typeof value !== 'object')
        return false;
    const set = value as MaterialSourceSetV1;
    if (set.kind === 'verification_workspace')
        return Array.isArray(set.paths) && set.paths.length === 1 && set.paths[0] === '.';
    if (set.kind !== 'workspace_paths' || !Array.isArray(set.paths) || set.paths.length < 1 || set.paths.length > 64)
        return false;
    if (!set.paths.every(path => typeof path === 'string' && path.length > 0 && path.length <= 1024 &&
        (path === '.' || (!/[\\:\0]/.test(path) && !path.split('/').some(part => !part || part === '.' || part === '..')))))
        return false;
    return set.paths.every((path, index) => index === 0 || set.paths[index - 1]! < path);
}
export function validMaterialSourcePin(value: unknown): value is MaterialSourcePinV1 {
    if (!value || typeof value !== 'object')
        return false;
    const pin = value as MaterialSourcePinV1;
    return pin.schemaVersion === 1 && typeof pin.projectId === 'string' && !!pin.projectId && typeof pin.workspaceId === 'string' && !!pin.workspaceId &&
        validMaterialSourceSet(pin.sourceSet) && !!pin.identity && typeof pin.identity.workspace === 'string' && !!pin.identity.workspace &&
        (pin.identity.commit === null || typeof pin.identity.commit === 'string' && /^[a-f0-9]{40,64}$/.test(pin.identity.commit)) &&
        typeof pin.manifestDigest === 'string' && /^[a-f0-9]{64}$/.test(pin.manifestDigest);
}
// ------------------------------------------------------------------------ //
// Persisted grant ref (no grant is written any more, decision 34)          //
// ------------------------------------------------------------------------ //
export type MaterialAccessGrantRef = {
    aggregateType: "MaterialAccessGrant";
    projectId: string;
    workspaceId: string;
    goalId: string;
    grantId: string;
};
export function sameArtifactRef(a: ArtifactRef, b: ArtifactRef): boolean {
    return a.contentType === b.contentType && a.digest === b.digest && a.sizeBytes === b.sizeBytes;
}
export function sameArtifactOwnerRunRef(a: ArtifactOwnerRunRef | null, b: ArtifactOwnerRunRef | null): boolean {
    if (a === null || b === null)
        return false;
    if (a.aggregateType !== b.aggregateType)
        return false;
    if (a.projectId !== b.projectId)
        return false;
    if (a.aggregateType === "Run" && b.aggregateType === "Run") {
        return a.goalId === b.goalId && a.runId === b.runId;
    }
    if (a.aggregateType === "QueryRun" && b.aggregateType === "QueryRun") {
        return a.workspaceId === b.workspaceId && a.queryJobId === b.queryJobId && a.runId === b.runId;
    }
    return false;
}
