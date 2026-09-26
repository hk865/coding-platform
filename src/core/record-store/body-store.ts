/**
 * In-memory raw artifact body store over a replaceable `ArtifactBodyRows` seam.
 *
 * This class owns the ONE shared put/read algorithm: content addressing,
 * first-writer-wins, integrity checks and result isolation. `MapBodyRows` below
 * is the default volatile persistence; SQLite supplies the same seam with an
 * atomic INSERT ON CONFLICT DO NOTHING so the two stores differ only in how a
 * row survives. The row codec is `body-codec.ts`; this file adds no second copy
 * of the body rules.
 */
import type { ArtifactRef } from "../../contracts/artifact.js";
import { sameArtifactRef } from "../../contracts/material-access.js";
import type { RawArtifactPut, RawArtifactRecord, RawArtifactStorePort } from "./body-ports.js";
import type { StoreResult } from "./ports.js";
import { ArtifactBodyCodecError, artifactBodyKey, decodeArtifactBodyRow, encodeArtifactBodyRow, isArtifactRef, readEncodedArtifactRef } from "./body-codec.js";
import { corruptFailure, invalidFailure, notFoundFailure } from "./record-codec.js";

/** The Map seam is replaceable by SQLite's atomic put-if-absent storage. */
export interface ArtifactBodyRows {
  get(key: string): string | undefined;
  putIfAbsent(key: string, json: string): { json: string; inserted: boolean };
}

export class RawArtifactBodyStore implements RawArtifactStorePort {
  constructor(private readonly rows: ArtifactBodyRows = new MapBodyRows()) {}

  async put(input: RawArtifactPut): Promise<StoreResult<{ ref: ArtifactRef; replayed: boolean }>> {
    let encoded: string;
    try {
      encoded = encodeArtifactBodyRow(input);
    } catch (error) {
      if (error instanceof ArtifactBodyCodecError) return invalidFailure(error.message);
      throw error;
    }
    // The fresh row is trusted: read back the ref this encode just produced
    // instead of hashing the body a second time. A pre-existing winner is
    // persisted data and is verified once below.
    const candidateRef = readEncodedArtifactRef(encoded);
    const winner = this.rows.putIfAbsent(artifactBodyKey(candidateRef), encoded);
    if (winner.inserted) return { status: "ready", value: { ref: candidateRef, replayed: false } };
    const stored = this.decodeStoredRow(winner.json);
    if (stored.status !== "ready") return stored;
    if (!sameArtifactRef(stored.value.ref, candidateRef)) {
      return corruptFailure("stored artifact row does not match the requested content key");
    }
    return { status: "ready", value: { ref: stored.value.ref, replayed: true } };
  }

  async read(ref: ArtifactRef): Promise<StoreResult<RawArtifactRecord>> {
    if (!isArtifactRef(ref)) return invalidFailure("read requires a complete ArtifactRef");
    const json = this.rows.get(artifactBodyKey(ref));
    if (json === undefined) return notFoundFailure("no raw artifact body is stored for this ref");
    const stored = this.decodeStoredRow(json);
    if (stored.status !== "ready") return stored;
    if (!sameArtifactRef(stored.value.ref, ref)) {
      return corruptFailure("stored artifact row does not match the requested content key");
    }
    return stored;
  }

  private decodeStoredRow(json: string): StoreResult<RawArtifactRecord> {
    try {
      return { status: "ready", value: decodeArtifactBodyRow(json) };
    } catch (error) {
      if (error instanceof ArtifactBodyCodecError) return corruptFailure(error.message);
      throw error;
    }
  }
}

class MapBodyRows implements ArtifactBodyRows {
  private readonly rows = new Map<string, string>();
  get(key: string): string | undefined { return this.rows.get(key); }
  putIfAbsent(key: string, json: string): { json: string; inserted: boolean } {
    const prior = this.rows.get(key);
    if (prior !== undefined) return { json: prior, inserted: false };
    this.rows.set(key, json);
    return { json, inserted: true };
  }
}
