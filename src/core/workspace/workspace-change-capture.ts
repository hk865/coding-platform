/**
 * K3 L5: the new workspace change capture traversal.
 *
 * This is deliberately NOT `CandidateWorkspaceReader`: it never reads a
 * protected prefix (`deniedPrefixes`), never reads a git-ignored path (the
 * names come from `git ls-files --others --ignored --exclude-standard
 * --directory -z` only), and never opens a special file (FIFO, socket, device)
 * or a submodule. The same traversal produces the run-start baseline
 * (`WorkspaceBaselineV1`) and the settlement capture
 * (`WorkspaceChangeCaptureV1`).
 *
 * Git is invoked read-only with optional locks and fsmonitor disabled; no
 * repository filter, hook or external diff runs. Blob identities are computed
 * by the platform from raw bytes, never by `git hash-object` or `git diff`.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, readlink, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ARTIFACT_MAX_SIZE_BYTES } from '../../contracts/artifact.js';
import type {
  CapturedPathV1, WorkspaceBaselineEntryV1, WorkspaceBaselineV1, WorkspaceChangeCaptureV1,
} from '../../contracts/unknown-call-review.js';

const execute = promisify(execFile);

/** The spec's `changed` cap (L5). */
export const WORKSPACE_CAPTURE_MAX_CHANGES = 2000;
/** The spec's `notVisible` cap (L5). */
export const WORKSPACE_CAPTURE_NOT_VISIBLE_MAX = 32;
/** The fixed, always-invisible directories (same set as `candidate-workspace-reader.ts`). */
export const WORKSPACE_CAPTURE_FIXED_IGNORED: readonly string[] = [
  '.git', '.platform-runtime', 'node_modules', 'dist', 'coverage', 'test-results', '.cache',
];
const FIXED_IGNORED = new Set(WORKSPACE_CAPTURE_FIXED_IGNORED);

const MAX_DETAIL = 500;

export type WorkspaceBaselineUnavailableReason = 'not_git' | 'too_many_changes' | 'read_failed';

export type WorkspaceBaselineReadResult =
  | { status: 'captured'; baseline: WorkspaceBaselineV1 }
  | { status: 'unavailable'; reason: WorkspaceBaselineUnavailableReason; detail: string };

export type WorkspaceChangeUnavailableReason = 'not_git' | 'unstable' | 'too_many_changes' | 'read_failed';

export type WorkspaceChangeCaptureResult =
  | { status: 'captured'; capture: WorkspaceChangeCaptureV1; baselineKnown: boolean; sample: CapturedPathV1[] }
  | { status: 'unavailable'; reason: WorkspaceChangeUnavailableReason; detail: string; baselineKnown: boolean };

export type WorkspaceBaselineReadInput = { root: string; deniedPrefixes?: readonly string[] };
export type WorkspaceChangeCaptureInput = WorkspaceBaselineReadInput & { baseline: WorkspaceBaselineV1 | null };

type TreeEntry = { mode: string; blobId: string };
type ObjectFormat = 'sha1' | 'sha256';
type Traversal = {
  entries: Map<string, TreeEntry>;
  digest: string;
  notVisible: string[];
  notVisibleOmitted: number;
  /** The git-ignored names (directories keep their trailing `/`) in force for this traversal. */
  ignoredNames: string[];
};

/** A capture that must fail rather than silently omit a special file or gitlink. */
class WorkspaceCaptureReadError extends Error {}
/** A traversal byte/serialisation bound was exceeded. */
class WorkspaceCaptureTooManyError extends Error {}

function detailOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > MAX_DETAIL ? message.slice(0, MAX_DETAIL) : message;
}

async function git(root: string, args: readonly string[]): Promise<string> {
  const result = await execute(
    'git',
    ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-C', root, ...args],
    { timeout: 15_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
  );
  return result.stdout;
}

const COMPLETE_OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

/** The real work-tree top level, and only when the given root IS that level. */
async function gitTopLevel(root: string): Promise<string | null> {
  try {
    const top = (await git(root, ['rev-parse', '--show-toplevel'])).trim();
    if (top === '') return null;
    return (await realpath(top)) === (await realpath(root)) ? top : null;
  } catch {
    return null;
  }
}

function normalizePrefix(prefix: string): string {
  const trimmed = prefix.replace(/^\.\//, '').replace(/\/+$/, '');
  return trimmed;
}

function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + '/');
}

function gitBlobId(body: Buffer, format: ObjectFormat): string {
  return createHash(format).update(`blob ${body.length}\0`).update(body).digest('hex');
}

async function readHead(root: string): Promise<string | null> {
  try {
    const head = (await git(root, ['rev-parse', '--verify', 'HEAD'])).trim();
    return COMPLETE_OID.test(head) ? head : null;
  } catch {
    return null;
  }
}

/** The ignored untracked names from the repository's own rules, names only.
 * A failure here is fail-closed: without the name list the traversal could
 * read a git-ignored path, so the whole capture becomes `read_failed`. */
async function readIgnoredNames(root: string): Promise<string[]> {
  const output = await git(root, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z']);
  return output.split('\0').filter(name => name.length > 0);
}

function pickObjectFormat(commit: string): ObjectFormat {
  return commit.length === 64 ? 'sha256' : 'sha1';
}

/**
 * Traverse the real work tree once. Protected prefixes are never descended and
 * never named; git-ignored paths are skipped by name; fixed-ignored directories
 * are skipped; a special file or submodule makes the whole capture unreadable.
 */
async function traverse(
  root: string, deniedPrefixes: readonly string[], format: ObjectFormat,
): Promise<Traversal> {
  const protectedPrefixes = deniedPrefixes.map(normalizePrefix).filter(prefix => prefix.length > 0);
  const ignoredNames = await readIgnoredNames(root);
  const ignored = new Set(ignoredNames);
  const ignoredDirectoryPrefixes = ignoredNames.filter(name => name.endsWith('/'));
  const isGitIgnored = (path: string): boolean =>
    ignored.has(path) || ignoredDirectoryPrefixes.some(prefix => path.startsWith(prefix));
  const isProtected = (path: string): boolean => protectedPrefixes.some(prefix => isUnder(path, prefix));

  const entries = new Map<string, TreeEntry>();
  const hash = createHash('sha256');
  const notVisible: string[] = [];
  const seenNotVisible = new Set<string>();
  let notVisibleOmitted = 0;
  const addNotVisible = (name: string): void => {
    if (seenNotVisible.has(name)) return;
    seenNotVisible.add(name);
    if (notVisible.length < WORKSPACE_CAPTURE_NOT_VISIBLE_MAX) notVisible.push(name);
    else notVisibleOmitted += 1;
  };
  for (const prefix of protectedPrefixes) addNotVisible(prefix);

  async function walk(dir: string, prefix: string): Promise<void> {
    for (const name of (await readdir(dir)).sort()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (isProtected(path)) continue;
      if (name === '.git' || FIXED_IGNORED.has(name)) { addNotVisible(path); continue; }
      if (isGitIgnored(path + '/')) { addNotVisible(path + '/'); continue; }
      if (isGitIgnored(path)) { addNotVisible(path); continue; }
      const absolute = join(dir, name);
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) {
        const target = await readlink(absolute);
        const blobId = gitBlobId(Buffer.from(target), format);
        entries.set(path, { mode: '120000', blobId });
        hash.update(path).update('\0').update('120000').update('\0').update(blobId).update('\0');
      } else if (stat.isDirectory()) {
        // A submodule appears as a directory that carries its own `.git`.
        try {
          await lstat(join(absolute, '.git'));
          throw new WorkspaceCaptureReadError(`the workspace contains a submodule at ${path}`);
        } catch (error) {
          if (error instanceof WorkspaceCaptureReadError) throw error;
        }
        await walk(absolute, path);
      } else if (stat.isFile()) {
        const body = await readFile(absolute);
        const mode = (stat.mode & 0o100) !== 0 ? '100755' : '100644';
        const blobId = gitBlobId(body, format);
        entries.set(path, { mode, blobId });
        hash.update(path).update('\0').update(mode).update('\0').update(blobId).update('\0');
      } else {
        throw new WorkspaceCaptureReadError(`the workspace contains a special file at ${path}`);
      }
    }
  }

  await walk(root, '');
  return { entries, digest: hash.digest('hex'), notVisible, notVisibleOmitted, ignoredNames };
}

/** The committed tree of `commit` as platform-computed blob identities. */
async function readTree(root: string, commit: string, format: ObjectFormat): Promise<Map<string, TreeEntry>> {
  const output = await git(root, ['ls-tree', '-r', '-z', '--full-tree', commit]);
  const tree = new Map<string, TreeEntry>();
  for (const raw of output.split('\0')) {
    if (raw.length === 0) continue;
    const tab = raw.indexOf('\t');
    if (tab < 0) throw new WorkspaceCaptureReadError('the git tree listing is malformed');
    const meta = raw.slice(0, tab);
    const path = raw.slice(tab + 1);
    const match = /^([0-9]{6}) ([a-z]+) ([a-f0-9]{40,64})$/.exec(meta);
    // A gitlink (`160000 commit`) is not a file comparison base.
    const mode = match?.[1];
    const kind = match?.[2];
    const blobId = match?.[3];
    if (mode === undefined || kind !== 'blob' || blobId === undefined || mode === '160000') {
      throw new WorkspaceCaptureReadError('the git tree has no complete file comparison');
    }
    tree.set(path, { mode, blobId });
  }
  void format;
  return tree;
}

/**
 * Record the run-start baseline (L5). Returns `unavailable` for a non-git root,
 * a workspace that differs from HEAD in more than the cap, or a read failure;
 * it never throws.
 */
export async function readWorkspaceBaseline(input: WorkspaceBaselineReadInput): Promise<WorkspaceBaselineReadResult> {
  const deniedPrefixes = input.deniedPrefixes ?? [];
  if (await gitTopLevel(input.root) === null) {
    return { status: 'unavailable', reason: 'not_git', detail: 'the workspace root is not the git work-tree top level' };
  }
  const head = await readHead(input.root);
  if (head === null) {
    return { status: 'unavailable', reason: 'not_git', detail: 'the git work tree has no HEAD commit' };
  }
  try {
    const format = pickObjectFormat(head);
    const current = await traverse(input.root, deniedPrefixes, format);
    const tree = await readTree(input.root, head, format);
    const protectedPrefixes = deniedPrefixes.map(normalizePrefix).filter(prefix => prefix.length > 0);
    const visible = (path: string): boolean => !protectedPrefixes.some(prefix => isUnder(path, prefix))
      && !path.split('/').some(part => FIXED_IGNORED.has(part));
    const dirty: WorkspaceBaselineEntryV1[] = [];
    const paths = [...new Set([...tree.keys(), ...current.entries.keys()])].sort();
    for (const path of paths) {
      if (!visible(path)) continue;
      const previous = tree.get(path);
      const actual = current.entries.get(path);
      if (previous !== undefined && actual === undefined) dirty.push({ path, state: 'deleted' });
      else if (previous === undefined && actual !== undefined) dirty.push({ path, state: 'present', mode: actual.mode, blobId: actual.blobId });
      else if (previous !== undefined && actual !== undefined
        && (previous.mode !== actual.mode || previous.blobId !== actual.blobId)) {
        dirty.push({ path, state: 'present', mode: actual.mode, blobId: actual.blobId });
      }
    }
    const baseline: WorkspaceBaselineV1 = { schemaVersion: 1, headCommit: head, dirty, digest: current.digest };
    if (dirty.length > WORKSPACE_CAPTURE_MAX_CHANGES
      || Buffer.byteLength(JSON.stringify(baseline), 'utf8') > ARTIFACT_MAX_SIZE_BYTES) {
      return { status: 'unavailable', reason: 'too_many_changes', detail: `the workspace has more than ${String(WORKSPACE_CAPTURE_MAX_CHANGES)} paths differing from HEAD` };
    }
    return { status: 'captured', baseline };
  } catch (error) {
    return { status: 'unavailable', reason: 'read_failed', detail: detailOf(error) };
  }
}

/**
 * Compare the current work tree with the run-start state: the baseline HEAD
 * tree overlaid by the baseline entries (`present` replaces or adds,
 * `deleted` removes), or the current HEAD when no baseline was recorded.
 * `unstable` when the traversal digest or HEAD changed mid-capture.
 */
export async function captureWorkspaceChange(input: WorkspaceChangeCaptureInput): Promise<WorkspaceChangeCaptureResult> {
  const baseline = input.baseline;
  const baselineKnown = baseline !== null;
  const deniedPrefixes = input.deniedPrefixes ?? [];
  if (await gitTopLevel(input.root) === null) {
    return { status: 'unavailable', reason: 'not_git', detail: 'the workspace root is not the git work-tree top level', baselineKnown };
  }
  const headBefore = await readHead(input.root);
  if (headBefore === null) {
    return { status: 'unavailable', reason: 'not_git', detail: 'the git work tree has no HEAD commit', baselineKnown };
  }
  try {
    const format = pickObjectFormat(baseline?.headCommit ?? headBefore);
    const before = await traverse(input.root, deniedPrefixes, format);
    const baseCommit = baseline?.headCommit ?? headBefore;
    const protectedPrefixes = deniedPrefixes.map(normalizePrefix).filter(prefix => prefix.length > 0);
    const gone = (path: string): boolean => protectedPrefixes.some(prefix => isUnder(path, prefix))
      || path.split('/').some(part => FIXED_IGNORED.has(part));
    const start = await readTree(input.root, baseCommit, format);
    if (baseline !== null) {
      for (const entry of baseline.dirty) {
        if (entry.state === 'present') start.set(entry.path, { mode: entry.mode, blobId: entry.blobId });
        else start.delete(entry.path);
      }
    }
    const current = before.entries;
    // L5 (line 201): git-ignored paths are not compared on either side. The
    // rules in force are the capture's own; a rule file that changed shows up
    // as its own `modified` path. The ignored names already appear in
    // `notVisible` only.
    const ignoredAtCapture = new Set(before.ignoredNames);
    const ignoredDirPrefixes = before.ignoredNames.filter(name => name.endsWith('/'));
    const isIgnoredAtCapture = (path: string): boolean =>
      ignoredAtCapture.has(path) || ignoredDirPrefixes.some(prefix => path.startsWith(prefix));
    const changed: CapturedPathV1[] = [];
    const paths = [...new Set([...start.keys(), ...current.keys()])].sort();
    for (const path of paths) {
      if (gone(path) || isIgnoredAtCapture(path)) continue;
      const previous = start.get(path);
      const actual = current.get(path);
      if (previous === undefined && actual !== undefined) changed.push({ path, change: 'added' });
      else if (previous !== undefined && actual === undefined) changed.push({ path, change: 'deleted' });
      else if (previous !== undefined && actual !== undefined && previous.mode !== actual.mode) changed.push({ path, change: 'mode_changed' });
      else if (previous !== undefined && actual !== undefined && previous.blobId !== actual.blobId) changed.push({ path, change: 'modified' });
    }
    const after = await traverse(input.root, deniedPrefixes, format);
    const headAfter = await readHead(input.root);
    if (before.digest !== after.digest || headAfter !== headBefore) {
      return { status: 'unavailable', reason: 'unstable', detail: 'the workspace changed while it was captured', baselineKnown };
    }
    const capture: WorkspaceChangeCaptureV1 = {
      schemaVersion: 1, baseCommit, headNow: headAfter ?? headBefore, runBaselineKnown: baselineKnown,
      changed, notVisible: before.notVisible, notVisibleOmitted: before.notVisibleOmitted,
      digestBefore: before.digest, digestAfter: after.digest,
    };
    if (changed.length > WORKSPACE_CAPTURE_MAX_CHANGES
      || Buffer.byteLength(JSON.stringify(capture), 'utf8') > ARTIFACT_MAX_SIZE_BYTES) {
      throw new WorkspaceCaptureTooManyError(`the workspace has more than ${String(WORKSPACE_CAPTURE_MAX_CHANGES)} changes`);
    }
    return { status: 'captured', capture, baselineKnown, sample: changed.slice(0, 50) };
  } catch (error) {
    if (error instanceof WorkspaceCaptureTooManyError) {
      return { status: 'unavailable', reason: 'too_many_changes', detail: detailOf(error), baselineKnown };
    }
    return { status: 'unavailable', reason: 'read_failed', detail: detailOf(error), baselineKnown };
  }
}
