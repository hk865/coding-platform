/**
 * SqliteArtifactVault — the persistent host binding for the legacy ArtifactPort.
 *
 * It owns no DatabaseSync, no schema, no digest and no permission rule. The
 * physical body semantics live in RecordStore (`createSqliteRawArtifactStore`)
 * and the material rules live in WorkGraph; this class only opens that raw
 * store, hands it to the shared `ArtifactVault` assembly and delegates close.
 * The body database and the ledger are separate durable objects; body-first
 * writes make no cross-database atomicity claim.
 */
import { ArtifactVault, type ArtifactVaultOptions, type StoredRecord } from './artifact-vault.js';
import { createSqliteRawArtifactStore, type CloseableRawArtifactStore } from '../../core/record-store/sqlite-body-store.js';

export class SqliteArtifactVault extends ArtifactVault {
  private readonly raw: CloseableRawArtifactStore;

  constructor(path: string, options: ArtifactVaultOptions = {}) {
    const raw = createSqliteRawArtifactStore(path);
    super(new Map<string, StoredRecord>(), options, raw);
    this.raw = raw;
  }

  /** The raw store owns the connection and its own idempotent close state. */
  async close(): Promise<void> {
    await this.raw.close();
  }
}
