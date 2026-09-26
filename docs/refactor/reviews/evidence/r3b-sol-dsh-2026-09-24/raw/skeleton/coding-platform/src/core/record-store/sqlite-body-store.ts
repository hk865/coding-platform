import type { RawArtifactStorePort } from './body-ports.js';

/** Opens the existing artifacts(key,record) table; implementation must keep the committed winner. */
export type CloseableRawArtifactStore = RawArtifactStorePort & { close(): Promise<void> };
export function createSqliteRawArtifactStore(_path: string): CloseableRawArtifactStore {
  throw new Error('R3b SQLite body store is not implemented');
}
