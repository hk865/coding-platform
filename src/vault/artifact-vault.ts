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
 */
import type { ArtifactOpenQuery, ArtifactOpenResult, ArtifactPort, ArtifactPutRecord, ArtifactPutResult } from "../contracts/artifact.js";
import type { ArtifactRef } from "../contracts/artifact.js";

export class ArtifactVault implements ArtifactPort {
  put(record: ArtifactPutRecord): Promise<ArtifactPutResult> {
    void record;
    return Promise.reject(new Error("P1-03: ArtifactVault.put not implemented yet"));
  }

  open(ref: ArtifactRef, query: ArtifactOpenQuery): Promise<ArtifactOpenResult> {
    void ref;
    void query;
    return Promise.reject(new Error("P1-03: ArtifactVault.open not implemented yet"));
  }
}

export function createArtifactVault(): ArtifactVault {
  return new ArtifactVault();
}
