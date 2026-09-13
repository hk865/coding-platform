import { DatabaseSync } from 'node:sqlite';
import { ArtifactVault, type ArtifactVaultOptions, type StoredRecord } from './artifact-vault.js';

/** Body and provenance commit together, before a separate Control registration. */
export class SqliteArtifactVault extends ArtifactVault {
  private readonly db: DatabaseSync;
  private closed = false;

  constructor(path: string, options: ArtifactVaultOptions = {}) {
    const db = new DatabaseSync(path);
    db.exec(`PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS artifacts (key TEXT PRIMARY KEY, record TEXT NOT NULL);`);
    const read = db.prepare('SELECT record FROM artifacts WHERE key = ?');
    const insert = db.prepare('INSERT INTO artifacts (key, record) VALUES (?, ?)');
    super({
      get: key => {
        const row = read.get(key);
        return row ? JSON.parse(row['record'] as string) as StoredRecord : undefined;
      },
      set: (key, record) => insert.run(key, JSON.stringify(record)),
    }, options);
    this.db = db;
  }

  async close(): Promise<void> {
    if (!this.closed) { this.db.close(); this.closed = true; }
  }
}
