/**
 * The code-knowledge files under `<workspace root>/.workbench/`: the shapes that
 * cross the WorkGraph, the composition root and the pages.
 */

/** The knowledge directory, relative to a workspace root. */
export const KNOWLEDGE_DIRECTORY = '.workbench';

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
