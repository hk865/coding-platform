// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
/** Content-addressed immutable bodies. WorkGraph material access checks integrity and exact
 * read authorization; storing or reading a body never establishes business truth. */
import { createHash } from "node:crypto";
import type { RunRef, SourceRefV1 } from "./dispatch.js";
import type { QueryRunRef } from "./query-job.js";
export const ARTIFACT_MAX_SIZE_BYTES = 256 * 1024;
/** Identical body/contentType retains the first recorded reference and owner.
 * Reads require matching owner identity or an applicable exact material grant;
 * TaskAttempt ownership alone grants no Run principal access. */
export type ArtifactRef = {
    kind: "artifact";
    contentType: string;
    digest: string;
    sizeBytes: number;
    source: SourceRefV1;
};
/** query additive read principal: query runs retain their own full identity. */
export type ArtifactOwnerRunRef = RunRef | QueryRunRef;
export type ArtifactRecord = {
    ref: ArtifactRef;
    body: string;
    sourceRefs: SourceRefV1[];
    ownerRunRef?: ArtifactOwnerRunRef | null;
    /** History is always marked. Other legacy reads make no currentness assertion. */
    applicability?: 'current' | 'historical_explanation';
};
/** Body digest: SHA-256 of the UTF-8 body, lowercase hex (content addressing key). */
export function artifactBodyDigest(body: string): string {
    return createHash("sha256").update(body, "utf8").digest("hex");
}
export function artifactBodySize(body: string): number {
    return Buffer.byteLength(body, "utf8");
}
