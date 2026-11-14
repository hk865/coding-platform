/**
 * The knowledge snapshots of one project store (`knowledge-snapshots.sqlite`): short-lived copies of the uncommitted
 * knowledge files, kept to undo a person's revert, and the recovery items a reconciliation notice points at. Only a
 * recovery reads a snapshot; no read path does, and dropping the knowledge index does not drop them.
 */
import type { KnowledgeProblemV1 } from '../../contracts/knowledge.js';

/** One recovery item of a notice: what the person's "恢复" undoes and what the file was when the notice went out. */
export type KnowledgeRecoveryRow = {
  noticeId: string;
  /** 1.. within the notice, by path. */
  itemNo: number;
  kind: 'write_unconfirmed' | 'reverted' | 'unreadable';
  /** The write log a `write_unconfirmed` item recovers; only that kind has one. */
  writeId: string | null;
  lineRef: string;
  /** The branch checked out when the notice went out; a recovery on another branch is refused. */
  branch: string;
  path: string;
  /** The snapshot a `reverted` item writes back, and the one an `unreadable` item whose source is a snapshot writes back;
   *  null for the others. */
  takenAt: string | null;
  /** The file's git blob id when the notice went out; null when the file was missing. */
  expectedBlob: string | null;
};

export interface KnowledgeSnapshots {
  /**
   * Keeps one copy of a file's bytes under (line, path, takenAt), skipped when the key's newest copy has the same
   * content; a `takenAt` not after the newest copy's becomes 1 ms after it (the newest copy stays). Afterwards the
   * key keeps its 20 newest copies plus any copy a recovery item points at; content no copy uses any more is dropped.
   */
  put(lineRef: string, path: string, takenAt: string, content: Uint8Array): void;
  /** The key's copies, oldest first, with their content. */
  listRefs(lineRef: string, path: string): readonly { takenAt: string; content: Uint8Array }[];
  /** The file was committed: the key's copies are dropped, except those a recovery item points at. */
  deletePath(lineRef: string, path: string): void;
  /** Inserts by (noticeId, itemNo); a row already there is kept as it is (the same notice is never written twice). */
  recordRecovery(rows: readonly KnowledgeRecoveryRow[]): void;
  /** One notice's items, by itemNo. */
  readRecovery(noticeId: string): readonly KnowledgeRecoveryRow[];
  /** KC-1 G3: a knowledge_conflict notice's places by itemNo; a notice id already there is kept as it is. */
  recordProblems(noticeId: string, lineRef: string, rows: readonly KnowledgeProblemV1[]): void;
  /** KC-1 G3: one notice's places, by itemNo. */
  readProblems(noticeId: string): readonly KnowledgeProblemV1[];
  hasRecoveryForWrite(writeId: string): boolean;
  /** A recovered item is removed (the notice itself is history and stays). */
  deleteRecovery(noticeId: string, itemNo: number): void;
  close(): void;
}
