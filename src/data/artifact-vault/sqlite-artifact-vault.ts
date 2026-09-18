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
    const insertIfAbsent = db.prepare('INSERT INTO artifacts (key, record) VALUES (?, ?) ON CONFLICT(key) DO NOTHING');
    super({
      get: key => {
        const row = read.get(key);
        return row ? JSON.parse(row['record'] as string) as StoredRecord : undefined;
      },
      set: (key, record) => insertIfAbsent.run(key, JSON.stringify(record)),
      putIfAbsent: (key, record) => {
        const result = insertIfAbsent.run(key, JSON.stringify(record));
        const winner = read.get(key);
        if (!winner) throw Error('Committed artifact is unavailable');
        return { record: JSON.parse(winner['record'] as string) as StoredRecord, inserted: result.changes === 1 };
      },
    }, options);
    this.db = db;
  }

  async close(): Promise<void> {
    if (!this.closed) { this.db.close(); this.closed = true; }
  }
}
