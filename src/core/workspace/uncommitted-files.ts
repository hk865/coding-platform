/**
 * E3-7: a Task's files against the workspace's current HEAD, now: what `git diff HEAD` would
 * count, file by file, without rename detection. Read only; nothing is stored. The K3 rules hold
 * (workspace-change-capture.ts): git runs read-only with optional locks and fsmonitor off, no
 * repository filter, hook or external diff runs, and blob identities and line counts are the
 * platform's own. A root that is not the git work-tree top level, or a repository without a HEAD
 * commit, is `not_git`.
 */
import { messageOf } from '../../contracts/error-message.js';
import { gitLines, lineEditCounts } from '../../contracts/line-delta.js';
import { readContinuationBaselineBlob, readContinuationCurrentFile } from './continuation-diff-reads.js';
import { isSafeSourceRelativePath } from './path-validation.js';
import type { UncommittedFileV1, UncommittedFilesV1, WorkspaceResult } from './ports.js';
import { gitBlobId, gitTopLevel, pickObjectFormat, readHead, readTree } from './workspace-change-capture.js';

/** Past this many line edits the Myers search stops and the file gets no count. */
const UNCOMMITTED_MAX_DISTANCE = 1000;

/** Lines compared as bytes: latin1 maps each byte to one character, so no encoding is assumed. */
function linesOf(bytes: Uint8Array): string[] {
  return gitLines(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1'));
}

/** A NUL on either side is binary (the continuation diff's rule), and a count past the bound is not given. */
function countsOf(before: Uint8Array | null, after: Uint8Array | null): { added: number; deleted: number } | null {
  if (before?.includes(0) === true || after?.includes(0) === true) return null;
  return lineEditCounts(before === null ? [] : linesOf(before), after === null ? [] : linesOf(after), UNCOMMITTED_MAX_DISTANCE);
}

/**
 * Every path in input order; an unsafe or unreadable path is `unknown` and is never opened. The
 * signal is checked after every read (the shared byte reads check it themselves), before each file
 * and before the answer, so a cancelled request or a closing WorkspaceTools throws here and the
 * registry's `track` answers `cancelled` instead of finishing the reads and answering ready.
 */
export async function uncommittedFilesOf(input: {
  root: string; paths: readonly string[]; allowsRead(path: string): boolean; deniedPrefixes: readonly string[];
  signal: AbortSignal;
}): Promise<WorkspaceResult<UncommittedFilesV1>> {
  const signal = input.signal;
  const top = await gitTopLevel(input.root);
  signal.throwIfAborted();
  if (top === null) return { status: 'ready', value: { repository: 'not_git' } };
  const head = await readHead(input.root);
  signal.throwIfAborted();
  if (head === null) return { status: 'ready', value: { repository: 'not_git' } };
  const format = pickObjectFormat(head);
  const readable = new Set(input.paths.filter((path) => isSafeSourceRelativePath(path) && input.allowsRead(path)));
  let tree: Awaited<ReturnType<typeof readTree>>;
  try {
    // One non-recursive listing for every readable path; `-t` keeps a requested directory's own entry
    // even when a requested file lies under it, so a directory now replaced by a file stays non-regular.
    tree = readable.size === 0 ? new Map() : await readTree(input.root, head, format, [...readable]);
  } catch (error) {
    signal.throwIfAborted();
    return { status: 'rejected', code: 'unavailable', reason: `the HEAD tree could not be read: ${messageOf(error)}` };
  }
  signal.throwIfAborted();
  const files: UncommittedFileV1[] = [];
  for (const path of input.paths) {
    signal.throwIfAborted();
    files.push(readable.has(path) ? await fileOf(input.root, path, tree.get(path), format, input.deniedPrefixes, input.allowsRead, signal)
      : { path, state: 'unknown' });
  }
  signal.throwIfAborted();
  return { status: 'ready', value: { repository: 'git', files } };
}

async function fileOf(
  root: string, path: string, entry: { mode: string; blobId: string } | undefined,
  format: ReturnType<typeof pickObjectFormat>, deniedPrefixes: readonly string[],
  allowsRead: (path: string) => boolean, signal: AbortSignal,
): Promise<UncommittedFileV1> {
  // A directory (040000), submodule (160000), symlink (120000) or any other non-regular HEAD entry has no
  // line count to give; readTree keeps a requested directory's entry even beside a requested file under it.
  if (entry !== undefined && entry.mode !== '100644' && entry.mode !== '100755') return { path, state: 'unknown' };
  // The real path behind the given one is checked against the same read scope before its bytes are read.
  const current = await readContinuationCurrentFile(root, path, deniedPrefixes, { allowsRead, signal });
  if (current.status === 'ready') {
    if (entry === undefined) return { path, state: 'uncommitted', lines: countsOf(null, current.bytes) };
    // Same content as HEAD (an executable-bit change alone counts as clean).
    if (gitBlobId(current.bytes, format) === entry.blobId) return { path, state: 'clean' };
    const old = await readContinuationBaselineBlob(root, entry.blobId, signal);
    return { path, state: 'uncommitted', lines: old.status === 'ready' ? countsOf(old.bytes, current.bytes) : null };
  }
  if (current.reason === 'missing') {
    if (entry === undefined) return { path, state: 'clean' };
    const old = await readContinuationBaselineBlob(root, entry.blobId, signal);
    return { path, state: 'uncommitted', lines: old.status === 'ready' ? countsOf(old.bytes, null) : null };
  }
  // Over 1 MiB now: a path HEAD does not have is uncommitted for sure; one it has cannot be compared unread.
  if (current.reason === 'too_large' && entry === undefined) return { path, state: 'uncommitted', lines: null };
  return { path, state: 'unknown' };
}
