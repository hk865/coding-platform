/**
 * ArtifactVault — P1-03 ArtifactPort implementation (first consumer freeze).
 *
 * ENTRY FILE (shared baseline - exported signature FROZEN). Lane C fills the
 * implementation. Frozen semantics:
 *   - content-addressed immutable bodies (digest = SHA-256 of the UTF-8 body);
 *     identical content replays the SAME ref;
 *   - size cap ARTIFACT_MAX_SIZE_BYTES; missing/empty sourceRefs rejected;
 *   - open() authorizes ONLY the recorded owner run (accessScope);
 *   - body-first: the vault keeps the body even if Control registration
 *     afterwards fails (never fakes a cross-storage transaction); the
 *     reference only becomes queryable after the run start commit.
 *
 * P1-03 storage seam is an INTERNAL in-memory map (later tickets swap in a
 * persistent adapter with the same ArtifactPort surface). The vault does NOT
 * depend on ControlEngine and never judges business truth.
 */
import {
  ARTIFACT_MAX_SIZE_BYTES,
  artifactBodyDigest,
  artifactBodySize,
} from "../contracts/artifact.js";
import type {
  ArtifactOpenQuery,
  ArtifactOpenResult,
  ArtifactPort,
  ArtifactPutRecord,
  ArtifactPutResult,
  ArtifactRecord,
  ArtifactRef,
} from "../contracts/artifact.js";
import type { SourceRefV1 } from "../contracts/dispatch.js";

type StoredRecord = {
  ref: ArtifactRef;
  body: string;
  sourceRefs: SourceRefV1[];
  /** The run allowed to open this artifact (null when the owner isn't a RunRef). */
  ownerRunId: string | null;
};

export class ArtifactVault implements ArtifactPort {
  private readonly byKey = new Map<string, StoredRecord>();

  async put(record: ArtifactPutRecord): Promise<ArtifactPutResult> {
    if (record.sourceRefs.length === 0) {
      return { status: "rejected", code: "missing_source", issues: ["sourceRefs must not be empty"] };
    }
    if (record.ownerRef === null || record.ownerRef === undefined) {
      return { status: "rejected", code: "missing_source", issues: ["ownerRef is required"] };
    }
    if (typeof record.contentType !== "string" || record.contentType.length === 0) {
      return { status: "rejected", code: "invalid", issues: ["contentType must be a non-empty string"] };
    }
    if (typeof record.body !== "string") {
      return { status: "rejected", code: "invalid", issues: ["body must be a string"] };
    }

    const sizeBytes = artifactBodySize(record.body);
    if (sizeBytes > ARTIFACT_MAX_SIZE_BYTES) {
      return {
        status: "rejected",
        code: "size_exceeded",
        issues: [`body size ${sizeBytes} exceeds ${ARTIFACT_MAX_SIZE_BYTES}`],
      };
    }

    const digest = artifactBodyDigest(record.body);
    const key = this.keyFor(record.contentType, digest, sizeBytes);
    const existing = this.byKey.get(key);
    if (existing) {
      return { status: "stored", ref: existing.ref, replayed: true };
    }

    const firstSource = record.sourceRefs[0]!;
    const ref: ArtifactRef = {
      kind: "artifact",
      contentType: record.contentType,
      digest,
      sizeBytes,
      source: firstSource,
    };
    const ownerRunId = record.ownerRef.aggregateType === "Run" ? record.ownerRef.runId : null;
    this.byKey.set(key, { ref, body: record.body, sourceRefs: [...record.sourceRefs], ownerRunId });
    return { status: "stored", ref, replayed: false };
  }

  async open(ref: ArtifactRef, query: ArtifactOpenQuery): Promise<ArtifactOpenResult> {
    if (typeof ref !== "object" || ref === null || typeof ref.digest !== "string" || ref.digest.length === 0) {
      return { status: "rejected", code: "invalid", issues: ["ref must be a valid ArtifactRef"] };
    }
    const key = this.keyFor(ref.contentType, ref.digest, ref.sizeBytes);
    const stored = this.byKey.get(key);
    if (!stored) {
      return { status: "unavailable", ref };
    }
    if (stored.ownerRunId !== query.requesterRunRef.runId) {
      return {
        status: "rejected",
        code: "forbidden",
        issues: ["requester is not the recorded owner run"],
      };
    }
    const record: ArtifactRecord = { ref: stored.ref, body: stored.body, sourceRefs: stored.sourceRefs };
    return { status: "ready", record };
  }

  private keyFor(contentType: string, digest: string, sizeBytes: number): string {
    return `${contentType}|${digest}|${sizeBytes}`;
  }
}

export function createArtifactVault(): ArtifactVault {
  return new ArtifactVault();
}
