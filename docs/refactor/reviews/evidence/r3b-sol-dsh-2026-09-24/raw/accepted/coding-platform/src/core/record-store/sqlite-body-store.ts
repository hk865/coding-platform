/**
 * SQLite persistence for raw artifact bodies over the existing
 * `artifacts(key, record)` table.
 *
 * `RawArtifactBodyStore` owns the shared put/read/validation algorithm; this
 * adapter only supplies the atomic row seam:
 *  - `INSERT ... ON CONFLICT(key) DO NOTHING` decides first-writer-wins, then the
 *    row that is actually committed is read back (never a read-then-overwrite and
 *    never an outer transaction);
 *  - open() initializes the existing table and every prepared statement inside
 *    one guarded block: if exec or prepare fails the connection is closed and the
 *    original error is rethrown, leaving the user's database untouched;
 *  - close() is idempotent and reopens the untouched database, so `close` may be
 *    followed by another factory on the same path;
 *  - a closed store or a SQLite failure raises explicitly instead of faking a
 *    successful write or an empty body.
 */
import { DatabaseSync } from 'node:sqlite';
import type { RawArtifactStorePort } from './body-ports.js';
import { RawArtifactBodyStore, type ArtifactBodyRows } from './body-store.js';

/** Opens the existing artifacts(key,record) table; implementation must keep the committed winner. */
export type CloseableRawArtifactStore = RawArtifactStorePort & { close(): Promise<void> };

export function createSqliteRawArtifactStore(path: string): CloseableRawArtifactStore {
  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS artifacts (key TEXT PRIMARY KEY, record TEXT NOT NULL);`);
    const read = db.prepare('SELECT record FROM artifacts WHERE key = ?');
    const insertIfAbsent = db.prepare('INSERT INTO artifacts (key, record) VALUES (?, ?) ON CONFLICT(key) DO NOTHING');
    let closed = false;
    const assertOpen = (): void => {
      if (closed) throw Error('R3b raw artifact store is closed');
    };
    const rows: ArtifactBodyRows = {
      get: key => {
        assertOpen();
        const row = read.get(key);
        return row === undefined ? undefined : row['record'] as string;
      },
      putIfAbsent: (key, json) => {
        assertOpen();
        const result = insertIfAbsent.run(key, json);
        const winner = read.get(key);
        if (winner === undefined) throw Error('R3b raw artifact store: committed winner is unavailable');
        return { json: winner['record'] as string, inserted: Number(result.changes) === 1 };
      },
    };
    const store = new RawArtifactBodyStore(rows);
    return {
      put: input => store.put(input),
      read: ref => store.read(ref),
      async close(): Promise<void> {
        if (closed) return;
        closed = true;
        db.close();
      },
    };
  } catch (error) {
    try {
      db.close();
    } catch {
      // Preserve the initialization error; the connection was never usable.
    }
    throw error;
  }
}
