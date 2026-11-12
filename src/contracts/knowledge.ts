/**
 * The code-knowledge files under `<workspace root>/.workbench/`: the shapes that
 * cross the WorkGraph, the composition root and the pages.
 */

/** The knowledge directory, relative to a workspace root. */
export const KNOWLEDGE_DIRECTORY = '.workbench';
/** A line's architecture index file, relative to its folder. */
export const ARCHITECTURE_FILE_PATH = `${KNOWLEDGE_DIRECTORY}/architecture.json`;

/** A root-relative path that is the knowledge directory or inside it. */
export function withinKnowledgeDirectory(path: string): boolean {
  return path === KNOWLEDGE_DIRECTORY || path.startsWith(`${KNOWLEDGE_DIRECTORY}/`);
}

/**
 * A semantic conflict among one workspace's (one line's) module files. The
 * read-back gate and the reconcile notice use the same verdict. Only a
 * duplicate id and a dangling reference make a catalog unreadable; a path
 * claimed by two modules is reported but reads and writes go on.
 */
export type KnowledgeConflictV1 = {
  kind: 'duplicate_module_id' | 'path_claimed_by_two_modules' | 'dangling_reference';
  /** Project view; for `dangling_reference` the missing target id. */
  moduleId: string;
  /** The knowledge files involved, relative to the line's folder, sorted. */
  paths: readonly string[];
};

/** What started one reconciliation of a line's knowledge files with the index. */
export type ReconcileTrigger = 'run_end' | 'before_adopt' | 'idle' | 'startup' | 'after_commit' | 'recovery' | 'joined';
/** A knowledge file that could not be read as one (R8): its path and why. */
export type KnowledgeIssueV1 = { path: string; reason: string };
/** One reconciliation of one line. */
export type ReconcileResult = {
  lineRef: string;
  trigger: ReconcileTrigger;
  /** The knowledge files this round found new, changed or deleted against the index. */
  changed: number;
  issues: readonly KnowledgeIssueV1[];
  conflicts: readonly KnowledgeConflictV1[];
  /** The recovery items of unconfirmed platform writes this round added. */
  unconfirmed: number;
  /** The recovery items of reverted files this round added. */
  reverted: number;
};
/** One recovery item of a knowledge notice as the page reads it: never the file's content. */
export type KnowledgeRecoveryItemV1 = { itemNo: number; kind: 'write_unconfirmed' | 'reverted'; path: string };
/** What a recovery wrote: the file and its blob now; `blobSha` is null when the recovery deleted the file. */
export type KnowledgeRecoverResult = { path: string; blobSha: string | null };
