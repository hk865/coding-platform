/**
 * KLS-2b: the knowledge index of one project (`index.sqlite`, kls-design
 * §2.2.9). It is a cache over the knowledge files: (line, path) → blob, the
 * blob's parsed JSON, and for every note its anchor keys, its normalized text
 * and its link/flow edges, plus this project's "needs verification" marks.
 * A file whose parse failed has no current mapping. Types only; the
 * implementation is `sqlite-knowledge-index.ts`.
 */
export type KnowledgeFileKind = 'architecture' | 'module' | 'note';
export type KnowledgeFileRow = { lineRef: string; path: string; blobSha: string; kind: KnowledgeFileKind };
/** A link's `link_from` (to its from end) and a flow's `flow_step` (to each step's link); no other kind: nothing reads one (ruling 8 F-10). */
export type KnowledgeEdgeKind = 'link_from' | 'flow_step';
/** One note's derived rows; every edge goes from this note's id. */
export type KnowledgeDerivedRows = {
  /** Project-view anchor keys, the primary anchor first. */
  anchorKeys: readonly string[];
  /** normalizeSearchText(topic + '\n' + conclusion + '\n' + body). */
  text: string;
  edges: readonly { toRef: string; kind: KnowledgeEdgeKind }[];
};
export type KnowledgeNoteState = {
  verifyState: 'needs_verification';
  verifyReason: 'external_edit' | 'merged' | 'joined_existing_checkout';
};
export type KnowledgeTextPage = {
  /** Ascending by noteId. */
  hits: readonly { lineRef: string; noteId: string }[];
  /** The next page's `after` (a noteId). */
  next: string | null;
  complete: boolean;
};
export interface KnowledgeIndexTx {
  /** Upserts a file's current mapping; a blob row is written once per blob. `parsedJson` is the file-frame parse. */
  setFile(row: KnowledgeFileRow, parsedJson: string): void;
  /** Drops a file's current mapping, and its blob when no other file row uses it. */
  deleteFile(lineRef: string, path: string): void;
  /** Replaces a note's anchor, text and edge rows as one group. */
  replaceNoteRows(lineRef: string, noteId: string, rows: KnowledgeDerivedRows): void;
  clearNoteRows(lineRef: string, noteId: string): void;
  /** null deletes the row (no row is current). */
  setNoteState(lineRef: string, blobSha: string, state: KnowledgeNoteState | null): void;
  writeMeta(lineRef: string, lastReconciledAt: string): void;
}
export interface KnowledgeIndex {
  readonly projectId: string;
  /** A synchronous transaction; a throw in `body` rolls all of it back. */
  transaction<T>(body: (tx: KnowledgeIndexTx) => T): T;
  listFiles(lineRef: string): readonly KnowledgeFileRow[];
  readFile(lineRef: string, path: string): KnowledgeFileRow | null;
  readBlob(blobSha: string): { kind: KnowledgeFileKind; parsedJson: string } | null;
  /** One line's; a caller that finds notes by anchor scans every line of the project. Ascending noteIds. */
  noteIdsByAnchor(lineRef: string, anchorKey: string): readonly string[];
  /** The range read on the primary key's leftmost prefix. Ascending noteIds. */
  noteIdsByAnchorPrefix(lineRef: string, prefix: string): readonly string[];
  /** The same range read, each anchor row with its key (a caller that judges each key, such as a file's owner). */
  noteAnchorsByPrefix(lineRef: string, prefix: string): readonly { anchorKey: string; noteId: string }[];
  searchText(input: { lineRefs: readonly string[]; terms: readonly string[]; match: 'all' | 'any';
    after: string | null; limit: number }): KnowledgeTextPage;
  /** The notes (`from_ref`) with an edge of `kind` on this line, to one of `toRefs` (`null`: to anything). Ascending. */
  noteIdsByEdge(lineRef: string, kind: KnowledgeEdgeKind, toRefs: readonly string[] | null): readonly string[];
  readNoteState(lineRef: string, blobSha: string): KnowledgeNoteState | null;
  readMeta(lineRef: string): string | null;
  close(): void;
}
