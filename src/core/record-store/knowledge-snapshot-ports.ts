/**
 * The knowledge snapshots of one project store (`knowledge-snapshots.sqlite`): short-lived copies of the uncommitted
 * knowledge files, kept to undo a person's revert, and the recovery items a reconciliation notice points at. Only a
 * recovery reads a snapshot; no read path does, and dropping the knowledge index does not drop them.
 */

/** One recovery item of a notice: what the person's "恢复" undoes and what the file was when the notice went out. */
export type KnowledgeRecoveryRow = {
  noticeId: string;
  /** 1.. within the notice, by path. */
  itemNo: number;
  kind: 'write_unconfirmed' | 'reverted';
  /** The write log a `write_unconfirmed` item recovers; null for `reverted`. */
  writeId: string | null;
  lineRef: string;
  path: string;
  /** The snapshot a `reverted` item writes back; null for `write_unconfirmed`. */
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
  hasRecoveryForWrite(writeId: string): boolean;
  /** A recovered item is removed (the notice itself is history and stays). */
  deleteRecovery(noticeId: string, itemNo: number): void;
  close(): void;
}
