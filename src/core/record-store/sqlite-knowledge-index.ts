/**
 * KLS-2b: the one implementation of the knowledge index (`index.sqlite`, the
 * seven tables of kls-design §2.2.9 exactly, plus two plain indexes on the edge
 * table). A memory store opens the same code on `:memory:`. Text is stored as
 * `JSON.stringify(text)` (the text-scan table's way) and scanned in process by
 * the shared `scanEntries`, ascending by noteId; there is no FTS5. This file
 * imports no WorkGraph module.
 */
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type {
  KnowledgeDerivedRows, KnowledgeEdgeKind, KnowledgeFileKind, KnowledgeFileRow, KnowledgeIndex, KnowledgeIndexTx,
  KnowledgeNoteState,
} from './knowledge-index-ports.js';
import { messageOf } from '../../contracts/error-message.js';
import { openSqliteFile } from './sqlite-body-store.js';
import { compareRefKeysFast, scanEntries } from './text-scan.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS knowledge_file(project_id TEXT, line_ref TEXT, path TEXT, blob_sha TEXT,
  PRIMARY KEY(project_id, line_ref, path));
CREATE TABLE IF NOT EXISTS knowledge_blob(blob_sha TEXT PRIMARY KEY, kind TEXT, parsed_json TEXT);
CREATE TABLE IF NOT EXISTS knowledge_anchor(project_id TEXT, line_ref TEXT, anchor_key TEXT, note_id TEXT,
  PRIMARY KEY(project_id, line_ref, anchor_key, note_id));
CREATE TABLE IF NOT EXISTS knowledge_text(project_id TEXT, line_ref TEXT, ref_key TEXT, prefix_key TEXT, text TEXT, seq INTEGER,
  PRIMARY KEY(project_id, line_ref, ref_key));
CREATE TABLE IF NOT EXISTS knowledge_edge(project_id TEXT, line_ref TEXT, from_ref TEXT, to_ref TEXT, kind TEXT);
CREATE INDEX IF NOT EXISTS knowledge_edge_from ON knowledge_edge(project_id, line_ref, from_ref);
CREATE INDEX IF NOT EXISTS knowledge_edge_to ON knowledge_edge(project_id, line_ref, to_ref);
CREATE TABLE IF NOT EXISTS knowledge_note_state(project_id TEXT, line_ref TEXT, blob_sha TEXT, verify_state TEXT, verify_reason TEXT,
  PRIMARY KEY(project_id, line_ref, blob_sha));
CREATE TABLE IF NOT EXISTS knowledge_meta(project_id TEXT, line_ref TEXT, last_reconciled_at TEXT,
  PRIMARY KEY(project_id, line_ref));`;

type Row = Record<string, unknown>;

/**
 * `path` null opens `:memory:` (a memory store): the same DDL and code. A file that cannot be opened throws with its
 * path (ruling 8 F-02/03: the composition root does not keep a failed open, and a read answers `unavailable` with it).
 */
export function createKnowledgeIndex(projectId: string, path: string | null): KnowledgeIndex {
  const file = path ?? ':memory:';
  let db: DatabaseSync | undefined;
  try {
    db = openSqliteFile(file);
    db.exec(SCHEMA);
  } catch (error) {
    try { db?.close(); } catch { /* preserve the initialization error */ }
    throw new Error(`the knowledge index ${file} cannot be opened: ${messageOf(error)}`);
  }
  const statements = new Map<string, StatementSync>();
  const sql = (text: string): StatementSync => {
    let statement = statements.get(text);
    if (statement === undefined) {
      statement = db.prepare(text);
      statements.set(text, statement);
    }
    return statement;
  };
  const prefixKey = JSON.stringify(projectId);

  function dropBlobIfUnused(blobSha: string): void {
    const used = sql('SELECT 1 AS used FROM knowledge_file WHERE blob_sha = ? LIMIT 1').get(blobSha);
    if (used === undefined) sql('DELETE FROM knowledge_blob WHERE blob_sha = ?').run(blobSha);
  }
  function fileBlob(lineRef: string, path: string): string | null {
    const row = sql('SELECT blob_sha FROM knowledge_file WHERE project_id = ? AND line_ref = ? AND path = ?')
      .get(projectId, lineRef, path) as Row | undefined;
    return row === undefined ? null : row['blob_sha'] as string;
  }
  function clearNoteRows(lineRef: string, noteId: string): void {
    sql('DELETE FROM knowledge_anchor WHERE project_id = ? AND line_ref = ? AND note_id = ?').run(projectId, lineRef, noteId);
    sql('DELETE FROM knowledge_text WHERE project_id = ? AND line_ref = ? AND ref_key = ?').run(projectId, lineRef, noteId);
    sql('DELETE FROM knowledge_edge WHERE project_id = ? AND line_ref = ? AND from_ref = ?').run(projectId, lineRef, noteId);
  }

  const tx: KnowledgeIndexTx = {
    setFile(row: KnowledgeFileRow, parsedJson: string): void {
      const previous = fileBlob(row.lineRef, row.path);
      sql(`INSERT INTO knowledge_blob(blob_sha, kind, parsed_json) VALUES (?, ?, ?) ON CONFLICT(blob_sha) DO NOTHING`)
        .run(row.blobSha, row.kind, parsedJson);
      sql(`INSERT INTO knowledge_file(project_id, line_ref, path, blob_sha) VALUES (?, ?, ?, ?)
        ON CONFLICT(project_id, line_ref, path) DO UPDATE SET blob_sha = excluded.blob_sha`)
        .run(projectId, row.lineRef, row.path, row.blobSha);
      if (previous !== null && previous !== row.blobSha) dropBlobIfUnused(previous);
    },
    deleteFile(lineRef: string, path: string): void {
      const previous = fileBlob(lineRef, path);
      if (previous === null) return;
      sql('DELETE FROM knowledge_file WHERE project_id = ? AND line_ref = ? AND path = ?').run(projectId, lineRef, path);
      dropBlobIfUnused(previous);
    },
    replaceNoteRows(lineRef: string, noteId: string, rows: KnowledgeDerivedRows): void {
      clearNoteRows(lineRef, noteId);
      for (const anchorKey of new Set(rows.anchorKeys)) {
        sql('INSERT INTO knowledge_anchor(project_id, line_ref, anchor_key, note_id) VALUES (?, ?, ?, ?)')
          .run(projectId, lineRef, anchorKey, noteId);
      }
      const seq = Number((sql('SELECT COALESCE(MAX(seq), 0) AS seq FROM knowledge_text').get() as Row)['seq']) + 1;
      sql('INSERT INTO knowledge_text(project_id, line_ref, ref_key, prefix_key, text, seq) VALUES (?, ?, ?, ?, ?, ?)')
        .run(projectId, lineRef, noteId, prefixKey, JSON.stringify(rows.text), seq);
      for (const edge of rows.edges) {
        sql('INSERT INTO knowledge_edge(project_id, line_ref, from_ref, to_ref, kind) VALUES (?, ?, ?, ?, ?)')
          .run(projectId, lineRef, noteId, edge.toRef, edge.kind);
      }
    },
    clearNoteRows,
    setNoteState(lineRef: string, blobSha: string, state: KnowledgeNoteState | null): void {
      if (state === null) {
        sql('DELETE FROM knowledge_note_state WHERE project_id = ? AND line_ref = ? AND blob_sha = ?')
          .run(projectId, lineRef, blobSha);
        return;
      }
      sql(`INSERT INTO knowledge_note_state(project_id, line_ref, blob_sha, verify_state, verify_reason) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(project_id, line_ref, blob_sha) DO UPDATE SET verify_state = excluded.verify_state,
        verify_reason = excluded.verify_reason`).run(projectId, lineRef, blobSha, state.verifyState, state.verifyReason);
    },
    writeMeta(lineRef: string, lastReconciledAt: string): void {
      sql(`INSERT INTO knowledge_meta(project_id, line_ref, last_reconciled_at) VALUES (?, ?, ?)
        ON CONFLICT(project_id, line_ref) DO UPDATE SET last_reconciled_at = excluded.last_reconciled_at`)
        .run(projectId, lineRef, lastReconciledAt);
    },
  };

  const fileRowOf = (row: Row): KnowledgeFileRow => ({ lineRef: row['line_ref'] as string, path: row['path'] as string,
    blobSha: row['blob_sha'] as string, kind: row['kind'] as KnowledgeFileKind });
  const FILE_ROWS = `SELECT f.line_ref, f.path, f.blob_sha, b.kind FROM knowledge_file f
    JOIN knowledge_blob b ON b.blob_sha = f.blob_sha WHERE f.project_id = ? AND f.line_ref = ?`;
  const placeholders = (count: number): string => Array.from({ length: count }, () => '?').join(', ');
  const anchorsUnder = (lineRef: string, prefix: string): { anchorKey: string; noteId: string }[] => {
    const found: { anchorKey: string; noteId: string }[] = [];
    const rows = sql(`SELECT anchor_key, note_id FROM knowledge_anchor
      WHERE project_id = ? AND line_ref = ? AND anchor_key >= ? ORDER BY anchor_key`).iterate(projectId, lineRef, prefix);
    for (const row of rows as Iterable<Row>) {
      if (!(row['anchor_key'] as string).startsWith(prefix)) break;
      found.push({ anchorKey: row['anchor_key'] as string, noteId: row['note_id'] as string });
    }
    return found;
  };

  return {
    projectId,
    transaction<T>(body: (tx: KnowledgeIndexTx) => T): T {
      db.exec('BEGIN IMMEDIATE');
      try {
        const value = body(tx);
        db.exec('COMMIT');
        return value;
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch { /* no live transaction left to roll back */ }
        throw error;
      }
    },
    listFiles: lineRef => (sql(`${FILE_ROWS} ORDER BY f.path`).all(projectId, lineRef) as Row[]).map(fileRowOf),
    readFile(lineRef, path) {
      const row = sql(`${FILE_ROWS} AND f.path = ?`).get(projectId, lineRef, path) as Row | undefined;
      return row === undefined ? null : fileRowOf(row);
    },
    readBlob(blobSha) {
      const row = sql('SELECT kind, parsed_json FROM knowledge_blob WHERE blob_sha = ?').get(blobSha) as Row | undefined;
      return row === undefined ? null : { kind: row['kind'] as KnowledgeFileKind, parsedJson: row['parsed_json'] as string };
    },
    noteIdsByAnchor: (lineRef, anchorKey) => (sql(`SELECT note_id FROM knowledge_anchor
      WHERE project_id = ? AND line_ref = ? AND anchor_key = ? ORDER BY note_id`).all(projectId, lineRef, anchorKey) as Row[])
      .map(row => row['note_id'] as string),
    noteIdsByAnchorPrefix: (lineRef, prefix) =>
      [...new Set(anchorsUnder(lineRef, prefix).map(row => row.noteId))].sort(compareRefKeysFast),
    noteAnchorsByPrefix: anchorsUnder,
    searchText(input) {
      if (input.lineRefs.length === 0) return { hits: [], next: null, complete: true };
      const rows = sql(`SELECT line_ref, ref_key, text FROM knowledge_text WHERE project_id = ? AND prefix_key = ?
        AND line_ref IN (${placeholders(input.lineRefs.length)})`).all(projectId, prefixKey, ...input.lineRefs) as Row[];
      const lineOf = new Map(rows.map(row => [row['ref_key'] as string, row['line_ref'] as string]));
      const entries = rows.map(row => ({ refKey: row['ref_key'] as string, text: JSON.parse(row['text'] as string) as string }))
        .sort((left, right) => compareRefKeysFast(left.refKey, right.refKey));
      const page = scanEntries(entries, input.terms, input.match, input.after, input.limit);
      return { hits: page.refKeys.map(noteId => ({ lineRef: lineOf.get(noteId)!, noteId })), next: page.next,
        complete: page.complete };
    },
    noteIdsByEdge(lineRef, kind, toRefs) {
      if (toRefs !== null && toRefs.length === 0) return [];
      const to = toRefs === null ? '' : ` AND to_ref IN (${placeholders(toRefs.length)})`;
      return (sql(`SELECT DISTINCT from_ref FROM knowledge_edge WHERE project_id = ? AND line_ref = ? AND kind = ?${to}`)
        .all(projectId, lineRef, kind, ...(toRefs ?? [])) as Row[]).map(row => row['from_ref'] as string).sort(compareRefKeysFast);
    },
    readNoteState(lineRef, blobSha) {
      const row = sql(`SELECT verify_state, verify_reason FROM knowledge_note_state
        WHERE project_id = ? AND line_ref = ? AND blob_sha = ?`).get(projectId, lineRef, blobSha) as Row | undefined;
      return row === undefined ? null : { verifyState: row['verify_state'] as KnowledgeNoteState['verifyState'],
        verifyReason: row['verify_reason'] as KnowledgeNoteState['verifyReason'] };
    },
    readMeta(lineRef) {
      const row = sql('SELECT last_reconciled_at FROM knowledge_meta WHERE project_id = ? AND line_ref = ?')
        .get(projectId, lineRef) as Row | undefined;
      return row === undefined ? null : row['last_reconciled_at'] as string;
    },
    close(): void {
      statements.clear();
      if (db.isOpen) db.close();
    },
  };
}
