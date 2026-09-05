/**
 * ArtifactVault contracts (interface frozen by P1-03 — first consumer).
 * Authority: modules/data/artifact-vault.md + runtime-collaboration.md.
 * Content-addressed immutable bodies; the vault NEVER judges business truth.
 * P1-03: text bodies only (bounded bundle), size cap, integrity by digest.
 */
import { createHash } from "node:crypto";
import type { RunRef, SourceRefV1, TaskAttemptRef } from "./dispatch.js";

export const ARTIFACT_MAX_SIZE_BYTES = 256 * 1024;

/**
 * FROZEN P1-03 content-addressing semantics (integrator ruling on lane-C gap 3/4):
 *   - FIRST put wins: a re-put of identical body/contentType returns the ORIGINAL
 *     ref (original source + original ownerRunId). Open authorization stays with
 *     the first recorded owner run.
 *   - open authorization: only a recorded OWNER RunRef requester may open
 *     (requesterRunRef.runId === ownerRunId). A TaskAttempt owner records
 *     ownerRunId = null -> deny-by-default (the attempt ref has no runId and is
 *     not an open-authorized principal in P1-03).
 */
export type ArtifactRef = {
  kind: "artifact";
  contentType: string;
  digest: string;
  sizeBytes: number;
  source: SourceRefV1;
};

export type ArtifactPutRecord = {
  contentType: string;
  body: string;
  sourceRefs: SourceRefV1[];
  /** Informational owner — the run/attempt the artifact was assembled for. */
  ownerRef: RunRef | TaskAttemptRef;
  requestedAt: string;
};

export type ArtifactPutResult =
  | { status: "stored"; ref: ArtifactRef; replayed: boolean }
  | { status: "rejected"; code: "invalid" | "size_exceeded" | "missing_source"; issues: string[] };

export type ArtifactOpenQuery = {
  /** P1-03 minimal read authorization: only the recorded owner run may open. */
  requesterRunRef: RunRef;
};

export type ArtifactRecord = {
  ref: ArtifactRef;
  body: string;
  sourceRefs: SourceRefV1[];
};

export type ArtifactOpenResult =
  | { status: "ready"; record: ArtifactRecord }
  | { status: "unavailable"; ref: ArtifactRef }
  | { status: "rejected"; code: "forbidden" | "invalid"; issues: string[] };

export interface ArtifactPort {
  put(record: ArtifactPutRecord): Promise<ArtifactPutResult>;
  open(ref: ArtifactRef, query: ArtifactOpenQuery): Promise<ArtifactOpenResult>;
}

/** Body digest: SHA-256 of the UTF-8 body, lowercase hex (content addressing key). */
export function artifactBodyDigest(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export function artifactBodySize(body: string): number {
  return Buffer.byteLength(body, "utf8");
}
