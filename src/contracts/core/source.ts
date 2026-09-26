// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
/**
 * Temporary source capture identity (CONTRACTS §5). A `SourceCaptureRef` points at a
 * bounded WorkspaceTools capture object: it carries no ArtifactRef and is invalid after
 * release, expiry or process restart. Persisting bodies is WorkGraph's job and produces
 * a separate `PersistedSourceCaptureRef` there. Persisting does not turn the
 * capture into a live filesystem witness or an accepted architecture baseline.
 */
import type { ArtifactRef } from '../artifact.js';
export type SourceCaptureRef = {
    projectId: string;
    workspaceId: string;
    captureId: string;
    /** Workspace registration revision observed through the trusted Host. */
    workspaceRevision: number;
    /** Frozen manifest digest (R2b capture snapshot). */
    sourceDigest: string;
    /** Digest of the requested/resolved configuration scope. */
    configDigest: string;
    /** Engine identity, e.g. `typescript-language-service@<version>`. */
    indexVersion: string;
};

/** Immutable observation body, admitted by WorkGraph; readable after capture expiry. */
export type PersistedSourceCaptureRef = {
    capture: SourceCaptureRef;
    material: ArtifactRef;
};
