// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
/**
 * Material access grants — cross-principal read authorization for stored
 * material (ArtifactVault), bound to the source version it was granted against.
 *
 * Authority:
 *   - dev_docs/interfaces/runtime-collaboration.md ("共享引用与角色绑定":
 *     every request carries caller identity, scope, correlation and version;
 *     a source reference carries kind/object/revision/digest — a timestamp is
 *     never a version) and the ArtifactVault row ("put(record) -> immutableRef;
 *     open(ref, accessScope) -> record / unavailable / rejected").
 *   - dev_docs/interfaces/context-lifecycle.md ("后续相关新任务": load current
 *     code/spec plus applicable history, mark the inheritance source; old
 *     authorization and old completion are NOT inherited; a changed
 *     goal/plan/spec invalidates affected material).
 *   - dev_docs/modules/data/artifact-vault.md (owner-only read authorization;
 *     the vault never judges business truth).
 *
 * WHY THIS EXISTS (the gap it closes):
 *   dispatch froze open() as OWNER-ONLY (the recorded owner RunRef, or a query
 *   QueryRunRef). That is deny-by-default and stays the default. But every
 *   later product loop needs a run to read material ANOTHER run produced:
 *   a reviewer reading the executed run's bundle, a successor reading a
 *   predecessor report, a continuation reading the previous run's note bodies,
 *   a query reading a report it did not author. Without an explicit,
 *   version-bound grant those reads are impossible, so the material had to be
 *   copied ("laundered") into a new artifact owned by the consumer, which loses
 *   the original provenance and the original authorization history.
 *
 * VERSIONED SEMANTICS (v1):
 *   - A grant is immutable (created exactly once per grantId) and is registered
 *     through ControlEngine.grantMaterialAccess. The vault reads grants through
 *     an injected resolver; the vault never depends on ControlEngine.
 *   - A grant authorizes ONE reader principal (Run or QueryRun) to open a
 *     BOUNDED set of exact content-addressed materials (1..64).
 *   - A grant carries the basis it was granted against (plan revision,
 *     workspace revision, source digest). Material read under a DIFFERENT
 *     current basis is NOT silently reused: the vault refuses with
 *     rejected/stale, so an inherited material can never advance a new version.
 *   - Only the material's recorded owner or a Control principal may issue a
 *     grant for it. A grant from an unrelated run is ignored (fail-closed).
 *   - A grant never changes task/goal phase, never satisfies evidence and never
 *     proves the material's business truth.
 */
import type { ActorRef } from "./command-event.js";
import { canonicalJson } from "./fingerprint.js";
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
    /** Actual source identity, captured and re-read by an explicit host capability.
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
export type MaterialSourceCaptureResult = {
    status: 'sourced';
    pin: MaterialSourcePinV1;
} | {
    status: 'unavailable' | 'rejected' | 'stale';
    issues: string[];
};
/** Capability bound by the host to real, permission-checked workspace access.
 * No current digest is accepted from the caller of ArtifactVault.open. */
export interface SourceApplicabilityPort {
    capture(query: MaterialSourceScope & {
        sourceSet: MaterialSourceSetV1;
    }, signal?: AbortSignal): Promise<MaterialSourceCaptureResult>;
}
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
export function materialBasisIsUnconditional(basis: MaterialBasisV1): boolean {
    return basis.planRef === null && basis.workspaceRevision === null && basis.sourceDigest === null && basis.sourcePin === undefined;
}
export function materialBasisEquals(a: MaterialBasisV1, b: MaterialBasisV1): boolean {
    return canonicalJson(a as never) === canonicalJson(b as never);
}
// ------------------------------------------------------------------------ //
// Grant record                                                              //
// ------------------------------------------------------------------------ //
/** Who may issue a grant for material: the recorded owner run, or Control. */
export type MaterialGrantIssuer = ArtifactOwnerRunRef | {
    aggregateType: "Control";
    projectId: string;
    goalId: string;
};
export type MaterialAccessScopeV1 = {
    projectId: string;
    workspaceId: string;
    goalId: string;
};
export type MaterialAccessGrantV1 = {
    schemaVersion: 1;
    grantId: string;
    scope: MaterialAccessScopeV1;
    /** Exact content-addressed materials authorized by this grant (1..64). */
    materials: ArtifactRef[];
    /** The ONE principal allowed to open the materials. */
    reader: ArtifactOwnerRunRef;
    /** The principal that issued the grant (owner run, or Control). */
    issuedBy: MaterialGrantIssuer;
    /** Audit note: why the material is shared. Never a permission source. */
    purpose: string;
    basis: MaterialBasisV1;
    grantedAt: string;
    /** Historical read preserves its owner. Old records remain same-workspace only. */
    history?: {
        owner: ArtifactOwnerRunRef;
        usage: 'historical_explanation';
        /** Human-selected source and exact reader/materials in this immutable grant. */
        crossWorkspace?: {
            sourceWorkspaceId: string;
            authorizedBy: ActorRef & {
                kind: 'human';
            };
        };
    };
};
export type MaterialAccessGrantRef = {
    aggregateType: "MaterialAccessGrant";
    projectId: string;
    workspaceId: string;
    goalId: string;
    grantId: string;
};
export type MaterialAccessGrantSnapshot = {
    ref: MaterialAccessGrantRef;
    revision: 1 | 2;
    schemaVersion: 1;
    grant: MaterialAccessGrantV1;
    /** Absent on legacy active records. Revocation never alters the original grant. */
    revocation?: MaterialAccessRevocationV1;
};
type MaterialAccessRevocationV1 = {
    reason: string;
    revokedAt: string;
    actor: ActorRef;
    commandId: string;
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
// ------------------------------------------------------------------------ //
// Vault read seam                                                           //
// ------------------------------------------------------------------------ //
/**
 * Resolver injected into the ArtifactVault by the host. It returns the grants
 * RECORDED for this reader that include the requested material. The vault then
 * applies its own rules (reader match, basis match, issuer authority) — a
 * resolver result is a candidate, never a decision.
 */
export interface MaterialAccessResolver {
    grantsFor(ref: ArtifactRef, reader: ArtifactOwnerRunRef): Promise<readonly MaterialAccessGrantV1[]>;
    /** Host checks ledger-owned plan/workspace versions; declarations are not authority. */
    currentBasisValid?(grant: MaterialAccessGrantV1): Promise<boolean>;
}
/** v1 has no authority to transfer material across projects or goal/workspace scopes. */
export function materialPrincipalInScope(principal: ArtifactOwnerRunRef, scope: MaterialAccessScopeV1): boolean {
    return principal.projectId === scope.projectId && (principal.aggregateType === "Run"
        ? principal.goalId === scope.goalId : principal.workspaceId === scope.workspaceId);
}
