/**
 * Speed-round 1 (S1.5) storage-migration fixture: build the legacy full-text
 * artifacts a 4B-era SQLite file carries (`next_fts_meta` plus a `next_fts_%`
 * table).
 *
 * This is SETUP only — the book allows a raw `next_fts_meta` plus a virtual
 * table to simulate a 4B-era file. Nothing here ever answers an assertion: the
 * upgrade tests observe the result only through the public RecordStore port.
 */
import { DatabaseSync } from 'node:sqlite';

const FTS5_DDL = (name: string): string =>
  `CREATE VIRTUAL TABLE ${name} USING fts5(ref_key UNINDEXED, windows, tokenize='unicode61')`;

export function addLegacyFtsArtifacts(path: string, names: readonly string[]): void {
  const database = new DatabaseSync(path);
  try {
    database.exec('CREATE TABLE IF NOT EXISTS next_fts_meta(name TEXT PRIMARY KEY, code TEXT NOT NULL, through INTEGER)');
    for (const name of names) {
      try {
        database.exec(FTS5_DDL(name));
      } catch {
        // F7: without the fts5 module the legacy virtual table cannot be
        // created; skip it rather than fake a plain table (the legacy drop
        // still runs, and the upgrade test compares only public results).
      }
    }
  } finally {
    database.close();
  }
}
