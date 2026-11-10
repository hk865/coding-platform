/**
 * Working-tree file reads (the single declaration): one path's state against
 * HEAD and the page of paths the changes panel reads. WorkspaceTools'
 * `ports.ts` re-exports them; the UI reads them here.
 */

/**
 * One path now against HEAD, what `git diff HEAD` would say of it: `clean` (no difference, or
 * absent on both sides), `uncommitted` with the added/deleted line counts (`null` when they
 * cannot be given: binary, over a byte bound or past the line-diff bound), or `unknown` (not
 * readable here, not a regular file, or too large to compare).
 */
export type UncommittedFileV1 =
  | { path: string; state: 'clean' }
  | { path: string; state: 'uncommitted'; lines: { added: number; deleted: number } | null }
  | { path: string; state: 'unknown' };

/** `not_git`: the root is not a git work-tree top level, or the repository has no HEAD commit. */
export type UncommittedFilesV1 =
  | { repository: 'git'; files: UncommittedFileV1[] }
  | { repository: 'not_git' };
