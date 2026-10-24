/**
 * K3 L6: the read-only byte reads behind the continuation note's file diffs.
 *
 * The old side is the Run-start baseline blob (`git cat-file blob`, no filters,
 * hooks or external diff); the new side is the current workspace file. Both are
 * bounded to 1 MiB and never throw: every failure is a typed `unavailable` the
 * assembly degrades to "no diff" on. Deliberately not `CandidateWorkspaceReader`
 * (L5): this helper reads only the exact paths the stored review names and runs
 * no repository filter.
 */
import { execFile } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, normalize, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { messageOf } from '../../contracts/error-message.js';
import { WORKSPACE_DENIED_PREFIXES } from './denied-prefixes.js';

const execute = promisify(execFile);

/**
 * K3 L6: a read-only byte read of one side of a file diff. Owned by
 * WorkspaceTools (the value producer); AgentRuntime re-exports it through
 * `execution-contracts.ts` so the module edge stays AgentRuntime -> WorkspaceTools.
 */
export type ContinuationWorkspaceBytes =
  | { status: 'ready'; bytes: Uint8Array }
  | { status: 'unavailable'; reason: string };

/** L6: either side over this size gets no diff. */
export const CONTINUATION_DIFF_MAX_BYTES = 1024 * 1024;

function gitArgs(root: string, args: readonly string[]): string[] {
  return ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-C', root, ...args];
}
// The continuation-diff rule: normalise first, then require the normalised path to stay inside the root.
/** A workspace-relative path only: an absolute path or one that escapes the root is refused. */
export function isSafeWorkspaceRelativePath(path: string): boolean {
  if (path.length === 0 || isAbsolute(path)) return false;
  const normalized = normalize(path);
  return normalized !== '..' && !normalized.startsWith('..') && !isAbsolute(normalized);
}

/**
 * L6: canonicalise a workspace-relative path before any policy or filesystem
 * decision, or null when it is empty, absolute or escapes the root. `./.env`
 * normalises to `.env`, so the protected-prefix check cannot be evaded.
 */
export function normalizeWorkspaceRelativePath(path: string): string | null {
  return isSafeWorkspaceRelativePath(path) ? normalize(path) : null;
}

/**
 * L6 (spec 203/220): a path under a Host-denied prefix is never opened or even
 * `lstat`ed. The check runs on the NORMALISED workspace-relative path.
 */
export function isProtectedWorkspacePath(
  path: string, deniedPrefixes: readonly string[] = WORKSPACE_DENIED_PREFIXES,
): boolean {
  const normalized = normalizeWorkspaceRelativePath(path);
  if (normalized === null) return false;
  return deniedPrefixes.some((prefix) => {
    const candidate = prefix.replace(/^\.\//, '').replace(/\/+$/, '');
    return candidate.length > 0 && (normalized === candidate || normalized.startsWith(`${candidate}/`));
  });
}

/**
 * L6: the old side is addressed either by a baseline blob id (a dirty path) or
 * by a start-HEAD tree ref `<headCommit>:<path>` (a path clean at Run start).
 * The commit must be a full object id and the path workspace-relative; git then
 * resolves the tree path itself.
 */
function isReadableBaselineObjectRef(objectRef: string): boolean {
  if (/^[a-f0-9]{40,64}$/.test(objectRef)) return true;
  const separator = objectRef.indexOf(':');
  if (separator <= 0) return false;
  return /^[a-f0-9]{40,64}$/.test(objectRef.slice(0, separator))
    && isSafeWorkspaceRelativePath(objectRef.slice(separator + 1));
}

/**
 * The raw bytes of one old side of a file diff, or a typed reason.
 *
 * `objectRef` is either a Run-start baseline blob id or a `<headCommit>:<path>`
 * tree ref (L6 line 215); both are read with `git cat-file blob` (no filters).
 */
export async function readContinuationBaselineBlob(root: string, objectRef: string): Promise<ContinuationWorkspaceBytes> {
  if (!isReadableBaselineObjectRef(objectRef)) return { status: 'unavailable', reason: 'the baseline object reference is not a git object id' };
  try {
    const size = await execute('git', gitArgs(root, ['cat-file', '-s', objectRef]), {
      timeout: 15_000, maxBuffer: 4 * 1024, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });
    const parsed = Number.parseInt(size.stdout.trim(), 10);
    if (!Number.isSafeInteger(parsed) || parsed < 0) return { status: 'unavailable', reason: 'the baseline blob size could not be read' };
    if (parsed > CONTINUATION_DIFF_MAX_BYTES) return { status: 'unavailable', reason: 'too_large' };
    const result = await execute('git', gitArgs(root, ['cat-file', 'blob', objectRef]), {
      timeout: 15_000, maxBuffer: CONTINUATION_DIFF_MAX_BYTES + 1, windowsHide: true, encoding: 'buffer',
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });
    const bytes = result.stdout as unknown as Uint8Array;
    if (bytes.byteLength > CONTINUATION_DIFF_MAX_BYTES) return { status: 'unavailable', reason: 'too_large' };
    return { status: 'ready', bytes };
  } catch (error) {
    return { status: 'unavailable', reason: messageOf(error) };
  }
}

/**
 * The raw bytes of the current workspace file, or a typed reason.
 *
 * L6 precedence: the protected check runs first on the normalised
 * workspace-relative path (a protected path is never opened or `lstat`ed);
 * then a symlink final component is status only (`not_text`); then the real
 * path must stay inside the real workspace root; and a real path that resolves
 * into a protected prefix through a directory symlink is `protected` too.
 */
export async function readContinuationCurrentFile(
  root: string, path: string, deniedPrefixes: readonly string[] = WORKSPACE_DENIED_PREFIXES,
): Promise<ContinuationWorkspaceBytes> {
  const normalized = normalizeWorkspaceRelativePath(path);
  if (normalized === null) return { status: 'unavailable', reason: 'the workspace path is not representable' };
  if (isProtectedWorkspacePath(normalized, deniedPrefixes)) return { status: 'unavailable', reason: 'protected' };
  try {
    const absolute = join(root, normalized);
    const meta = await lstat(absolute);
    if (meta.isSymbolicLink()) return { status: 'unavailable', reason: 'not_text' };
    if (!meta.isFile()) return { status: 'unavailable', reason: 'the path is not a regular file' };
    const realAbsolute = await realpath(absolute);
    const realRoot = await realpath(root);
    if (realAbsolute !== realRoot && !realAbsolute.startsWith(realRoot + sep)) {
      return { status: 'unavailable', reason: 'the path is outside the workspace root' };
    }
    // Codex 9(a): a directory symlink inside the root can point at a protected
    // directory, so the protection rule runs again on the real workspace-relative path.
    const realRelative = relative(realRoot, realAbsolute).split(sep).join('/');
    if (isProtectedWorkspacePath(realRelative, deniedPrefixes)) {
      return { status: 'unavailable', reason: 'protected' };
    }
    if (meta.size > CONTINUATION_DIFF_MAX_BYTES) return { status: 'unavailable', reason: 'too_large' };
    const bytes = await readFile(realAbsolute);
    if (bytes.byteLength > CONTINUATION_DIFF_MAX_BYTES) return { status: 'unavailable', reason: 'too_large' };
    return { status: 'ready', bytes };
  } catch (error) {
    return { status: 'unavailable', reason: messageOf(error) };
  }
}
