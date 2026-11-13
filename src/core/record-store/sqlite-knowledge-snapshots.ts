/**
 * The one implementation of the knowledge snapshots (`knowledge-snapshots.sqlite`, the three tables of kls-design
 * §2.2.11 with the recovery item's `write_id` and `expected_blob`). A memory store opens the same code on
 * `:memory:`. Content is kept once per sha256; a key keeps its 20 newest copies, and a copy a recovery item points at
 * is never dropped. This file imports no WorkGraph module.
 */
import { createHash } from 'node:crypto';
import type { KnowledgeProblemV1 } from '../../contracts/knowledge.js';
import type { KnowledgeRecoveryRow, KnowledgeSnapshots } from './knowledge-snapshot-ports.js';
import { inImmediateTransaction, openSqliteWithSchema } from './sqlite-body-store.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS snapshot_blob(blob_sha TEXT PRIMARY KEY, content BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS snapshot_ref(line_ref TEXT, path TEXT, taken_at TEXT, blob_sha TEXT,
  PRIMARY KEY(line_ref, path, taken_at));
CREATE TABLE IF NOT EXISTS knowledge_recovery(notice_id TEXT, item_no INTEGER, kind TEXT, write_id TEXT, line_ref TEXT,
  path TEXT, taken_at TEXT, expected_blob TEXT, PRIMARY KEY(notice_id, item_no));
CREATE TABLE IF NOT EXISTS knowledge_problem(notice_id TEXT, item_no INTEGER, line_ref TEXT, body TEXT NOT NULL,
  PRIMARY KEY(notice_id, item_no));`;

/** Copies kept per (line, path), besides those a recovery item points at. */
const KEPT_PER_KEY = 20;
/** A copy a recovery item points at: only an item that points at a snapshot has a `taken_at` (a `reverted` item, or an
 *  `unreadable` one whose source is a snapshot). */
const REFERENCED = `EXISTS (SELECT 1 FROM knowledge_recovery r WHERE r.line_ref = snapshot_ref.line_ref
  AND r.path = snapshot_ref.path AND r.taken_at = snapshot_ref.taken_at)`;

type Row = Record<string, unknown>;

/** `takenAt` when it is later than `newest`, else 1 ms after `newest` (both ISO instants). */
function keyAfter(takenAt: string, newest: string): string {
  const after = Date.parse(newest) + 1;
  return Date.parse(takenAt) >= after ? takenAt : new Date(after).toISOString();
}

/** `path` null opens `:memory:`. A file that cannot be opened throws with its path. */
export function openKnowledgeSnapshots(path: string | null): KnowledgeSnapshots {
  const open = openSqliteWithSchema('the knowledge snapshots', path, SCHEMA);
  const transaction = (body: () => void): void => inImmediateTransaction(open, body);
  /** Drops the key's copies the condition picks (never one a recovery item points at) and the content left unused. */
  function dropRefs(lineRef: string, path: string, rows: readonly Row[]): void {
    for (const row of rows) {
      open.prepare('DELETE FROM snapshot_ref WHERE line_ref = ? AND path = ? AND taken_at = ?').run(lineRef, path, row['taken_at'] as string);
      open.prepare(`DELETE FROM snapshot_blob WHERE blob_sha = ? AND NOT EXISTS (SELECT 1 FROM snapshot_ref WHERE blob_sha = ?)`)
        .run(row['blob_sha'] as string, row['blob_sha'] as string);
    }
  }
  const recoveryOf = (row: Row): KnowledgeRecoveryRow => ({
    noticeId: row['notice_id'] as string, itemNo: Number(row['item_no']),
    kind: row['kind'] as KnowledgeRecoveryRow['kind'], writeId: row['write_id'] as string | null,
    lineRef: row['line_ref'] as string, path: row['path'] as string, takenAt: row['taken_at'] as string | null,
    expectedBlob: row['expected_blob'] as string | null,
  });

  return {
    put(lineRef, path, takenAt, content) {
      const blobSha = createHash('sha256').update(content).digest('hex');
      transaction(() => {
        const newest = open.prepare('SELECT taken_at, blob_sha FROM snapshot_ref WHERE line_ref = ? AND path = ? ORDER BY taken_at DESC LIMIT 1')
          .get(lineRef, path) as Row | undefined;
        if (newest !== undefined && newest['blob_sha'] === blobSha) return;
        // A different content is kept besides the newest copy: an injected clock may stand still between two rounds,
        // so its key is 1 ms after the newest copy's when the clock has not passed it (the copy taken first stays).
        const key = newest === undefined ? takenAt : keyAfter(takenAt, newest['taken_at'] as string);
        const taken = open.prepare(`INSERT INTO snapshot_ref(line_ref, path, taken_at, blob_sha) VALUES (?, ?, ?, ?)
          ON CONFLICT(line_ref, path, taken_at) DO NOTHING`).run(lineRef, path, key, blobSha);
        if (Number(taken.changes) === 0) return;
        open.prepare('INSERT INTO snapshot_blob(blob_sha, content) VALUES (?, ?) ON CONFLICT(blob_sha) DO NOTHING').run(blobSha, content);
        dropRefs(lineRef, path, open.prepare(`SELECT taken_at, blob_sha FROM snapshot_ref WHERE line_ref = ? AND path = ? AND NOT ${REFERENCED}
          AND taken_at < (SELECT MIN(taken_at) FROM (SELECT taken_at FROM snapshot_ref WHERE line_ref = ? AND path = ?
          ORDER BY taken_at DESC LIMIT ${KEPT_PER_KEY}))`).all(lineRef, path, lineRef, path) as Row[]);
      });
    },
    listRefs(lineRef, path) {
      return (open.prepare(`SELECT r.taken_at, b.content FROM snapshot_ref r JOIN snapshot_blob b ON b.blob_sha = r.blob_sha
        WHERE r.line_ref = ? AND r.path = ? ORDER BY r.taken_at`).all(lineRef, path) as Row[])
        .map(row => ({ takenAt: row['taken_at'] as string, content: new Uint8Array(row['content'] as Uint8Array) }));
    },
    deletePath(lineRef, path) {
      transaction(() => dropRefs(lineRef, path, open.prepare(`SELECT taken_at, blob_sha FROM snapshot_ref
        WHERE line_ref = ? AND path = ? AND NOT ${REFERENCED}`).all(lineRef, path) as Row[]));
    },
    recordRecovery(rows) {
      transaction(() => {
        for (const row of rows) {
          open.prepare(`INSERT INTO knowledge_recovery(notice_id, item_no, kind, write_id, line_ref, path, taken_at, expected_blob)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(notice_id, item_no) DO NOTHING`).run(row.noticeId, row.itemNo, row.kind,
            row.writeId, row.lineRef, row.path, row.takenAt, row.expectedBlob);
        }
      });
    },
    readRecovery(noticeId) {
      return (open.prepare('SELECT * FROM knowledge_recovery WHERE notice_id = ? ORDER BY item_no').all(noticeId) as Row[]).map(recoveryOf);
    },
    recordProblems(noticeId, lineRef, rows) {
      transaction(() => {
        for (const row of rows) {
          open.prepare(`INSERT INTO knowledge_problem(notice_id, item_no, line_ref, body) VALUES (?, ?, ?, ?)
            ON CONFLICT(notice_id, item_no) DO NOTHING`).run(noticeId, row.itemNo, lineRef, JSON.stringify(row));
        }
      });
    },
    readProblems(noticeId) {
      return (open.prepare('SELECT body FROM knowledge_problem WHERE notice_id = ? ORDER BY item_no').all(noticeId) as Row[])
        .map(row => JSON.parse(row['body'] as string) as KnowledgeProblemV1);
    },
    hasRecoveryForWrite(writeId) {
      return open.prepare('SELECT 1 AS found FROM knowledge_recovery WHERE write_id = ? LIMIT 1').get(writeId) !== undefined;
    },
    deleteRecovery(noticeId, itemNo) {
      open.prepare('DELETE FROM knowledge_recovery WHERE notice_id = ? AND item_no = ?').run(noticeId, itemNo);
    },
    close() {
      open.close();
    },
  };
}
