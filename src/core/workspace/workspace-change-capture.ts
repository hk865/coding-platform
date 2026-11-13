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
 * Git is invoked with optional locks and fsmonitor disabled; every read is
 * read-only and runs no repository filter, hook or external diff. Blob
 * identities are computed by the platform from raw bytes, never by
 * `git hash-object` or `git diff`. The task map's uncommitted read
 * (uncommitted-files.ts) reuses the read-only git helpers below. The one git
 * write is `commitKnowledgeFiles` (the person's commit of `.workbench/`
 * only), which runs the repository's own hooks and filters.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, readlink, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { ARTIFACT_MAX_SIZE_BYTES } from '../../contracts/artifact.js';
import { KNOWLEDGE_DIRECTORY, withinKnowledgeDirectory } from '../../contracts/knowledge.js';
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

/** Every git call's timeout but the knowledge commit's. */
const GIT_TIMEOUT_MS = 15_000;
/** The knowledge commit's two commands: the repository's hooks run inside them, so they wait longer; past it git is
 *  killed and that is a failure. */
const KNOWLEDGE_COMMIT_TIMEOUT_MS = 120_000;

async function git(root: string, args: readonly string[], timeout: number = GIT_TIMEOUT_MS): Promise<string> {
  const result = await execute(
    'git',
    ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-C', root, ...args],
    { timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
  );
  return result.stdout;
}

const COMPLETE_OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

/** The real work-tree top level, and only when the given root IS that level. */
export async function gitTopLevel(root: string): Promise<string | null> {
  try {
    const top = (await git(root, ['rev-parse', '--show-toplevel'])).trim();
    if (top === '') return null;
    return (await realpath(top)) === (await realpath(root)) ? top : null;
  } catch {
    return null;
  }
}

/** The repository's common git directory (shared by all its work trees), absolute and real; null when the root is
 * in no work tree, git is missing or the command fails. Git may answer relative to the root. */
export async function gitCommonDir(root: string): Promise<string | null> {
  try {
    const value = (await git(root, ['rev-parse', '--git-common-dir'])).trim();
    if (value === '') return null;
    const absolute = resolve(root, value);
    return await realpath(absolute).catch(() => absolute);
  } catch {
    return null;
  }
}

/** One checkout's identity (KLS-2): a git work tree, or a folder that is in none. */
export type CheckoutProbe =
  | { kind: 'git'; repoKey: string; folder: string; branch: string; objectFormat: 'sha1' | 'sha256' }
  | { kind: 'not_git'; folder: string };

/** The checked-out branch; a detached HEAD is `HEAD`, and a fresh repository's unborn branch still has its name. */
export async function readCheckoutBranch(root: string): Promise<string> {
  try {
    return (await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
  } catch {
    return 'HEAD';
  }
}

/** `folder` is the real root; `repoKey` the real common git directory. A root that does not exist throws. */
export async function identifyCheckout(root: string): Promise<CheckoutProbe> {
  const folder = await realpath(root);
  const repoKey = await gitCommonDir(folder);
  if (repoKey === null) return { kind: 'not_git', folder };
  let objectFormat: ObjectFormat = 'sha1';
  try {
    if ((await git(folder, ['rev-parse', '--show-object-format'])).trim() === 'sha256') objectFormat = 'sha256';
  } catch { /* a git without the option is sha1 */ }
  return { kind: 'git', repoKey, folder, branch: await readCheckoutBranch(folder), objectFormat };
}

function normalizePrefix(prefix: string): string {
  const trimmed = prefix.replace(/^\.\//, '').replace(/\/+$/, '');
  return trimmed;
}

function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + '/');
}

export function gitBlobId(body: Uint8Array, format: ObjectFormat): string {
  return createHash(format).update(`blob ${body.length}\0`).update(body).digest('hex');
}

export async function readHead(root: string): Promise<string | null> {
  try {
    const head = (await git(root, ['rev-parse', '--verify', 'HEAD'])).trim();
    return COMPLETE_OID.test(head) ? head : null;
  } catch {
    return null;
  }
}

/** KC-2: the committer time (ISO 8601) of the last commit on HEAD that changed `path`. Throws when git fails. */
export async function readLastCommitTime(root: string, path: string): Promise<string> {
  return (await git(root, ['log', '-1', '--format=%cI', 'HEAD', '--', path])).trim();
}

/** Git's view of a checkout's knowledge directory; every path relative to the checkout root. */
export type KnowledgeGitState = {
  /** `git status --porcelain=v1 --untracked-files=all`: changed, staged and untracked paths (a rename's both sides). */
  listed: ReadonlySet<string>;
  /** `git ls-files -s`: the index's stage-0 blobs. */
  staged: ReadonlyMap<string, string>;
  /** `git ls-tree -r HEAD`: HEAD's blobs. */
  head: ReadonlyMap<string, string>;
};

/** One `git status --porcelain=v1 -z` entry of the knowledge directory: its two status letters, its path and, for a
 *  rename or copy, the path it came from (`-z` puts the new path first); paths relative to the root. */
type KnowledgeStatusEntry = { xy: string; path: string; from: string | null };

/** Every changed, staged and untracked file of `.workbench/` (an untracked folder file by file). Status paths are the
 *  repository's, so the root's prefix is taken off. Throws when git fails. */
async function knowledgeStatusEntries(root: string): Promise<KnowledgeStatusEntry[]> {
  const prefix = (await git(root, ['rev-parse', '--show-prefix'])).trim();
  const local = (path: string): string => path.startsWith(prefix) ? path.slice(prefix.length) : path;
  const fields = (await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', KNOWLEDGE_DIRECTORY]))
    .split('\0');
  const entries: KnowledgeStatusEntry[] = [];
  for (let at = 0; at < fields.length; at += 1) {
    const entry = fields[at]!;
    if (entry.length < 4) continue;
    const moved = entry[0] === 'R' || entry[0] === 'C';
    entries.push({ xy: entry.slice(0, 2), path: local(entry.slice(3)), from: moved ? local(fields[(at += 1)] ?? '') : null });
  }
  return entries;
}

/**
 * KLS-2 [2C1-11]: the three narrow reads a knowledge reconciliation needs of `.workbench/`, through the one `git()`.
 * Null when any of them fails (no HEAD yet included): the caller then has nothing committed.
 */
export async function readKnowledgeGitState(root: string): Promise<KnowledgeGitState | null> {
  try {
    const listed = new Set<string>();
    for (const entry of await knowledgeStatusEntries(root)) {
      listed.add(entry.path);
      if (entry.from !== null) listed.add(entry.from);
    }
    const blobs = (output: string, pick: (meta: string[]) => string | null): Map<string, string> => {
      const found = new Map<string, string>();
      for (const entry of output.split('\0')) {
        const tab = entry.indexOf('\t');
        const blob = tab < 0 ? null : pick(entry.slice(0, tab).split(' '));
        if (blob !== null) found.set(entry.slice(tab + 1), blob);
      }
      return found;
    };
    const staged = blobs(await git(root, ['ls-files', '-s', '-z', '--', '.workbench']),
      ([, blob, stage]) => stage === '0' ? blob ?? null : null);
    const head = blobs(await git(root, ['ls-tree', '-r', '-z', 'HEAD', '--', '.workbench']),
      ([, type, blob]) => type === 'blob' ? blob ?? null : null);
    return { listed, staged, head };
  } catch {
    return null;
  }
}

const KNOWLEDGE_LOCAL_PREFIX = `${KNOWLEDGE_DIRECTORY}/local/`;

/**
 * [2C2-06]: the knowledge directory's uncommitted places and paths, `local/` left out. An untracked file is one
 * place; any other entry is one place for each of its index and work-tree sides that changed; a rename counts its new
 * path. Throws when git fails.
 */
export async function readKnowledgeChanges(root: string): Promise<{ dirty: number; files: number }> {
  let dirty = 0;
  const paths = new Set<string>();
  for (const { xy, path } of await knowledgeStatusEntries(root)) {
    if (path.startsWith(KNOWLEDGE_LOCAL_PREFIX)) continue;
    dirty += xy === '??' ? 1 : (xy[0] === ' ' ? 0 : 1) + (xy[1] === ' ' ? 0 : 1);
    paths.add(path);
  }
  return { dirty, files: paths.size };
}

/** The knowledge directory without `local/`, as one pathspec. */
const KNOWLEDGE_PATHSPEC = ['--', `${KNOWLEDGE_DIRECTORY}/`, `:(exclude)${KNOWLEDGE_DIRECTORY}/local`];

/** What a failed git command said: its stderr as it is; git says "nothing to commit" on stdout, so then its last line. */
function gitFailureOf(error: unknown): string {
  const { stderr, stdout } = error as { stderr?: unknown; stdout?: unknown };
  if (typeof stderr === 'string' && stderr.trim() !== '') return stderr.trim();
  const last = typeof stdout === 'string' ? stdout.trim().split('\n').at(-1) ?? '' : '';
  return last === '' ? detailOf(error) : last;
}

/**
 * [2C2-07]: the platform's one git write. `git add`, then `git commit -m <message>`, both limited to
 * `.workbench/` (`local/` left out), so code the person staged is neither committed nor unstaged. The repository's
 * hooks run, inside the 120-second timeout of these two commands; a failure (a hook, no user name, the index lock,
 * nothing to commit, the timeout) comes back in git's own words, with no retry, no configuration change and no
 * `--amend`. `commit` is HEAD's full id afterwards.
 */
export async function commitKnowledgeFiles(root: string, message: string):
  Promise<{ status: 'committed'; commit: string } | { status: 'failed'; reason: string }> {
  try {
    await git(root, ['add', ...KNOWLEDGE_PATHSPEC], KNOWLEDGE_COMMIT_TIMEOUT_MS);
    await git(root, ['commit', '-m', message, ...KNOWLEDGE_PATHSPEC], KNOWLEDGE_COMMIT_TIMEOUT_MS);
  } catch (error) {
    return { status: 'failed', reason: gitFailureOf(error) };
  }
  const commit = await readHead(root);
  return commit === null ? { status: 'failed', reason: 'git commit left no HEAD' } : { status: 'committed', commit };
}

/** The ignored untracked names from the repository's own rules, names only.
 * A failure here is fail-closed: without the name list the traversal could
 * read a git-ignored path, so the whole capture becomes `read_failed`. */
async function readIgnoredNames(root: string): Promise<string[]> {
  const output = await git(root, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z']);
  return output.split('\0').filter(name => name.length > 0);
}

export function pickObjectFormat(commit: string): ObjectFormat {
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
      // KLS-2: the platform's code-knowledge directory is not the workspace's source change (it is written by
      // the platform's knowledge writes and committed on its own), so it is neither captured nor named.
      if (path === KNOWLEDGE_DIRECTORY) continue;
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

/**
 * The committed tree of `commit` as platform-computed blob identities. Without `paths` it is the
 * whole tree, recursive, and any non-blob entry fails it. With `paths` it lists those literal paths
 * in one call without recursing (the single-entry read of git-read.ts), and `-t` keeps a requested
 * directory's own entry even when another requested path lies under it: a directory, submodule or
 * symlink stays one entry with its own mode, so the caller can answer it as a non-regular file and
 * the listing stays bounded by the paths. Entries git lists on the way down are not kept.
 */
export async function readTree(
  root: string, commit: string, format: ObjectFormat, paths?: readonly string[],
): Promise<Map<string, TreeEntry>> {
  const output = await git(root, paths === undefined
    ? ['ls-tree', '-r', '-z', '--full-tree', commit]
    : ['--literal-pathspecs', 'ls-tree', '-t', '-z', '--full-tree', commit, '--', ...paths]);
  const wanted = paths === undefined ? null : new Set(paths);
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
    if (wanted !== null && mode !== undefined && blobId !== undefined) {
      // Any kind of entry, kept with its own mode (040000 tree, 160000 commit, 120000 symlink).
      if (wanted.has(path)) tree.set(path, { mode, blobId });
      continue;
    }
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
    // KLS-2: the traversal skips the knowledge directory, so its HEAD entries are left out here too.
    const visible = (path: string): boolean => !protectedPrefixes.some(prefix => isUnder(path, prefix))
      && !path.split('/').some(part => FIXED_IGNORED.has(part)) && !withinKnowledgeDirectory(path);
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
    // KLS-2: the knowledge directory is not compared on either side (the traversal skips it; HEAD may carry it).
    const gone = (path: string): boolean => protectedPrefixes.some(prefix => isUnder(path, prefix))
      || path.split('/').some(part => FIXED_IGNORED.has(part)) || withinKnowledgeDirectory(path);
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
