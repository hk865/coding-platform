import type { ArtifactRef } from '../../contracts/artifact.js';
import type { RawArtifactPut, RawArtifactRecord, RawArtifactStorePort } from './body-ports.js';
import type { StoreResult } from './ports.js';

/** The Map seam is replaceable by SQLite's atomic put-if-absent storage. */
export interface ArtifactBodyRows {
  get(key: string): string | undefined;
  putIfAbsent(key: string, json: string): { json: string; inserted: boolean };
}
export class RawArtifactBodyStore implements RawArtifactStorePort {
  constructor(_rows: ArtifactBodyRows = new MapBodyRows()) {}
  async put(_input: RawArtifactPut): Promise<StoreResult<{ ref: ArtifactRef; replayed: boolean }>> {
    throw new Error('R3b raw body put is not implemented');
  }
  async read(_ref: ArtifactRef): Promise<StoreResult<RawArtifactRecord>> {
    throw new Error('R3b raw body read is not implemented');
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
