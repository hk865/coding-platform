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
 * (uncommitted-files.ts) reuses the read-only git helpers below. The two git
 * writes are the person's: `commitKnowledgeFiles` (`.workbench/` only) and
 * `commitNodePaths` (one reviewed node's own paths, decision 121-45); both run
 * the repository's own hooks and filters, and so does the node commit's own
 * "would it record anything" judgement (`git diff`), which must see what the
 * commit will store.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, readdir, readFile, readlink, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { ARTIFACT_MAX_SIZE_BYTES } from '../../contracts/artifact.js';
import { KNOWLEDGE_DIRECTORY, withinKnowledgeDirectory } from '../../contracts/knowledge.js';
import type { CheckoutIdentity, LineRef } from '../../contracts/line.js';
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

/** Every git call's timeout but the two commits'. */
const GIT_TIMEOUT_MS = 15_000;
/** A commit's `add` and `commit` (knowledge and node): the repository's hooks run inside them, so they wait longer;
 *  past it git is killed and that is a failure. */
const COMMIT_TIMEOUT_MS = 120_000;

/**
 * `stdin`, when given, is written to git's standard input and closed (a commit message of any length, `-F -`). git
 * can exit before reading it all (a failing pre-commit hook runs first): the write then fails with EPIPE, and git's
 * own exit status is the result.
 */
async function git(root: string, args: readonly string[], timeout: number = GIT_TIMEOUT_MS, stdin?: string): Promise<string> {
  const running = execute(
    'git',
    ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-C', root, ...args],
    { timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true,
      // English messages: `failedReadAnswer` reads git's "not a git repository" text (lead 11-14).
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C.UTF-8' } },
  );
  if (stdin !== undefined) running.child.stdin?.on('error', () => undefined).end(stdin);
  return (await running).stdout;
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
  const common = await readCommonDir(root);
  return common.status === 'dir' ? common.path : null;
}

/** `gitCommonDir` with why there is none: `absent` (no repository) or `unreadable` (`failedReadAnswer`). */
async function readCommonDir(root: string):
  Promise<{ status: 'dir'; path: string } | { status: 'absent' } | { status: 'unreadable' }> {
  try {
    const value = (await git(root, ['rev-parse', '--git-common-dir'])).trim();
    if (value === '') return { status: 'unreadable' };
    const absolute = resolve(root, value);
    return { status: 'dir', path: await realpath(absolute).catch(() => absolute) };
  } catch (error) {
    return { status: failedReadAnswer(error) };
  }
}

/**
 * One checkout's identity (KLS-2, KLS-3a): a git work tree with its history's roots (`rev-list --max-parents=0 HEAD`,
 * none before the first commit) and whether it is shallow, or a folder that is in none.
 */
export type CheckoutProbe =
  | ({ kind: 'git'; objectFormat: 'sha1' | 'sha256'; shallow: boolean; roots: string[] } & LineRef)
  | { kind: 'not_git'; folder: string; answer: 'absent' | 'unreadable' };

/**
 * The line of a probed checkout; a folder in no git work tree is its own repository, with no branch and no commit.
 * The root commit names the repository across clones (121-64) only in a full history with one root (lead ruling
 * KLS-3b §9 甲): a shallow clone takes its boundary for a root and several roots differ between branches, so such a
 * checkout has no first commit and is one repository with another only through the same common git directory.
 */
export function checkoutIdentityOf(probe: CheckoutProbe): CheckoutIdentity {
  return probe.kind === 'git'
    ? { repoKey: probe.repoKey, folder: probe.folder, branch: probe.branch,
      firstCommit: !probe.shallow && probe.roots.length === 1 ? probe.roots[0]! : null }
    : { repoKey: probe.folder, folder: probe.folder, branch: '', firstCommit: null };
}

/** The checked-out branch; a detached HEAD is `HEAD`, and a fresh repository's unborn branch still has its name. */
export async function readCheckoutBranch(root: string): Promise<string> {
  try {
    return (await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
  } catch {
    return 'HEAD';
  }
}

/**
 * `folder` is the real root; `repoKey` the real common git directory. A root that does not exist throws. `not_git`
 * says whether git said so (`absent`) or could not read the folder (`unreadable`, KLS-3b: a recorded line keeps its
 * identity on it).
 */
export async function identifyCheckout(root: string): Promise<CheckoutProbe> {
  const folder = await realpath(root);
  const common = await readCommonDir(folder);
  if (common.status !== 'dir') return { kind: 'not_git', folder, answer: common.status };
  const repoKey = common.path;
  let roots: string[] = [];
  try {
    roots = (await git(folder, ['rev-list', '--max-parents=0', 'HEAD'])).split('\n').filter(root => root !== '');
  } catch { /* an unborn HEAD: a repository with no commit yet */ }
  // A history git cannot call complete is taken as shallow: when unsure, two checkouts are not one repository (121-111).
  const shallow = await git(folder, ['rev-parse', '--is-shallow-repository'])
    .then(answer => answer.trim() !== 'false', () => true);
  return { kind: 'git', repoKey, folder, branch: await readCheckoutBranch(folder), objectFormat: await objectFormatOf(folder),
    shallow, roots };
}

/** The repository's object format, read without a HEAD commit. */
async function objectFormatOf(root: string): Promise<ObjectFormat> {
  try {
    if ((await git(root, ['rev-parse', '--show-object-format'])).trim() === 'sha256') return 'sha256';
  } catch { /* a git without the option is sha1 */ }
  return 'sha1';
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

/**
 * `rev-parse --verify -q <ref>`: the commit a ref names; `absent` when git says it does not resolve (exit 1: an unborn
 * or deleted branch) or there is no repository; `unreadable` when git could not tell (`failedReadAnswer`). KLS-3b
 * (Astra 2): only `absent` may end a line.
 */
export async function readRef(root: string, ref: string):
  Promise<{ status: 'commit'; oid: string } | { status: 'absent' } | { status: 'unreadable' }> {
  try {
    const value = (await git(root, ['rev-parse', '--verify', '-q', ref])).trim();
    return COMPLETE_OID.test(value) ? { status: 'commit', oid: value } : { status: 'unreadable' };
  } catch (error) {
    return { status: failedReadAnswer(error) };
  }
}

/**
 * KLS-3b (Astra 2, lead 11-14): the one reading of a failed git read. `absent` only when git said no for sure: exit 1
 * (a `--verify -q` that resolves nothing) or its search found no repository at all (exit 128, "not a git repository
 * (or any …"). Exit 128 alone is also a folder git cannot enter, and a linked checkout whose main repository is away
 * for a while says "not a git repository: <its git dir>". Anything else is `unreadable` and changes no line.
 */
function failedReadAnswer(error: unknown): 'absent' | 'unreadable' {
  const { code, stderr } = error as { code?: unknown; stderr?: unknown };
  return code === 1 || (code === 128 && /not a git repository \(or any/i.test(String(stderr))) ? 'absent' : 'unreadable';
}

/** HEAD's commit, or null when there is none or git cannot read it. */
export async function readHead(root: string): Promise<string | null> {
  const head = await readRef(root, 'HEAD');
  return head.status === 'commit' ? head.oid : null;
}

/**
 * KLS-3b (kls-design §2.3.2): `merge-base --is-ancestor`. Exit 1 is the ordinary "not an ancestor" (`false`); any
 * other failure (a timeout, no repository, an unknown commit) is `null`, so the caller judges nothing.
 */
export async function isAncestor(root: string, ancestor: string, descendant: string): Promise<boolean | null> {
  try {
    await git(root, ['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch (error) {
    return (error as { code?: unknown }).code === 1 ? false : null;
  }
}

/**
 * KLS-3b (lead 11-14 Q4): the checkouts the repository at `root` still records (`git worktree list --porcelain -z`, a
 * missing but unpruned one included; NUL-separated, so a path may hold a newline), each by its real path when it is
 * there; null when git cannot answer.
 */
export async function listWorktrees(root: string): Promise<string[] | null> {
  let listed: string;
  try {
    listed = await git(root, ['worktree', 'list', '--porcelain', '-z']);
  } catch {
    return null;
  }
  const paths = listed.split('\0').filter(entry => entry.startsWith('worktree ')).map(entry => entry.slice('worktree '.length));
  return Promise.all(paths.map(path => realpath(path).catch(() => path)));
}

/** KLS-3b: no changed, staged or untracked file in the whole work tree, code and knowledge alike; null when git fails. */
export async function isWorktreeClean(root: string): Promise<boolean | null> {
  try {
    return (await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).length === 0;
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
    await git(root, ['add', ...KNOWLEDGE_PATHSPEC], COMMIT_TIMEOUT_MS);
    await git(root, ['commit', '-m', message, ...KNOWLEDGE_PATHSPEC], COMMIT_TIMEOUT_MS);
  } catch (error) {
    return { status: 'failed', reason: gitFailureOf(error) };
  }
  const commit = await readHead(root);
  return commit === null ? { status: 'failed', reason: 'git commit left no HEAD' } : { status: 'committed', commit };
}

/**
 * NR-09 (decision 121-45): the work-tree blob of each given path, in order, computed from its bytes like the
 * traversal's (a symlink's blob is its target); null when the path is absent. Throws when the root is not the git
 * work-tree top level (the paths are relative to it) or a path is a directory or another non-file.
 */
export async function readPathBlobs(root: string, paths: readonly string[]): Promise<{ path: string; blob: string | null }[]> {
  if (await gitTopLevel(root) === null) throw new WorkspaceCaptureReadError('the workspace root is not the git work-tree top level');
  const format = await objectFormatOf(root);
  const blobs: { path: string; blob: string | null }[] = [];
  for (const path of paths) {
    const absolute = join(root, path);
    const stat: Stats | false = await lstat(absolute).catch(absentOrThrow);
    if (stat === false) { blobs.push({ path, blob: null }); continue; }
    const entry = await fileEntryOf(absolute, stat, format);
    if (entry === null) throw new WorkspaceCaptureReadError(`the node path ${path} is not a file`);
    blobs.push({ path, blob: entry.blobId });
  }
  return blobs;
}

/**
 * The given paths whose commit would record something (erratum 7): what `git add -A` and `git commit` of exactly these
 * paths would store, judged by git itself, so the repository's eol conversion and clean filters apply and the mode
 * counts as `core.fileMode` sees it. A path HEAD has records something when `git diff HEAD` (HEAD against the work
 * tree, not the index) lists it: content, mode, type or a deletion; a path HEAD lacks, when it is in the work tree.
 * A file staged and then restored to HEAD's content records nothing, whatever `git status` says. Without a HEAD
 * commit every present path records something. The node review's raw-content guard (`readPathBlobs`) is separate.
 */
async function changedNodePaths(root: string, paths: readonly string[]): Promise<string[]> {
  if (await gitTopLevel(root) === null) throw new WorkspaceCaptureReadError('the workspace root is not the git work-tree top level');
  const head = await readHead(root);
  const tree = head === null ? new Map<string, TreeEntry>() : await readTree(root, head, pickObjectFormat(head), paths);
  const tracked = paths.filter(path => tree.has(path));
  const differing = new Set(head === null || tracked.length === 0 ? []
    : (await git(root, ['--literal-pathspecs', 'diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', head, '--',
      ...tracked])).split('\0'));
  const changed: string[] = [];
  for (const path of paths) {
    if (tree.has(path) ? differing.has(path) : await lstat(join(root, path)).then(() => true, absentOrThrow)) {
      changed.push(path);
    }
  }
  return changed;
}

/** A missing path (or one under a missing directory) is absent; any other stat failure is the read's failure. */
function absentOrThrow(error: unknown): false {
  const code = (error as { code?: unknown }).code;
  if (code === 'ENOENT' || code === 'ENOTDIR') return false;
  throw error;
}

export async function hasNodePathChanges(root: string, paths: readonly string[]): Promise<boolean> {
  return (await changedNodePaths(root, paths)).length > 0;
}

/** The three trailers of a node commit (NR-14), the message's last three lines in this order. */
const NODE_RECORD_TRAILER = 'Node-Record: ';
const NODE_COMMIT_TRAILER = 'Node-Commit: ';
const NODE_REVIEW_TRAILER = 'Node-Review: ';

/**
 * NR-11: the node commit. `git add -A` and `git commit`, both with literal pathspecs and limited to the node's paths
 * whose commit records something (`changedNodePaths`), so code the person staged elsewhere is neither committed nor
 * unstaged and a path like `a[1].ts` names only itself; an empty pathspec would take the whole tree, so none left is a
 * failure. The message is the person's, then the record snapshot, the identity and the fingerprint as trailers, which
 * `findNodeCommit` reads back after a crash; it goes through standard input (`-F -`), since the snapshot of a large
 * node would not fit in one argument. A failure comes back in git's own words, with no retry, no configuration change,
 * no `--amend` and no push.
 */
export async function commitNodePaths(root: string, paths: readonly string[], message: string,
  trailer: { record: string; identity: string; fingerprint: string }):
  Promise<{ status: 'committed'; commit: string } | { status: 'failed'; reason: string }> {
  const changed = await changedNodePaths(root, paths);
  if (changed.length === 0) return { status: 'failed', reason: 'the node paths no longer differ from HEAD' };
  const full = `${message}\n\n${NODE_RECORD_TRAILER}${trailer.record}\n${NODE_COMMIT_TRAILER}${trailer.identity}\n`
    + `${NODE_REVIEW_TRAILER}${trailer.fingerprint}`;
  try {
    await git(root, ['--literal-pathspecs', 'add', '-A', '--', ...changed], COMMIT_TIMEOUT_MS);
    await git(root, ['--literal-pathspecs', 'commit', '-F', '-', '--', ...changed], COMMIT_TIMEOUT_MS, full);
  } catch (error) {
    return { status: 'failed', reason: gitFailureOf(error) };
  }
  const commit = await readHead(root);
  return commit === null ? { status: 'failed', reason: 'git commit left no HEAD' } : { status: 'committed', commit };
}

/**
 * NR-14: the node commit of this identity in HEAD's reachable history, not only HEAD (a knowledge commit may have
 * moved it since). Its last two lines must be exactly the identity and this fingerprint; the same identity with
 * another fingerprint is a conflict. Throws when git fails.
 */
export async function findNodeCommit(root: string, identity: string, fingerprint: string):
  Promise<{ sha: string; record: string } | { conflict: true } | null> {
  if (await readHead(root) === null) return null;
  const output = await git(root, ['log', '-F', `--grep=${NODE_COMMIT_TRAILER}${identity}`, '--format=%H%x00%B%x00', 'HEAD']);
  const fields = output.split('\0');
  let conflict = false;
  for (let at = 0; at + 1 < fields.length; at += 2) {
    const lines = fields[at + 1]!.trimEnd().split('\n');
    if (lines.at(-2) !== `${NODE_COMMIT_TRAILER}${identity}`) continue;
    const record = lines.at(-3);
    if (lines.at(-1) === `${NODE_REVIEW_TRAILER}${fingerprint}` && record?.startsWith(NODE_RECORD_TRAILER) === true) {
      return { sha: fields[at]!.trim(), record: record.slice(NODE_RECORD_TRAILER.length) };
    }
    conflict = true;
  }
  return conflict ? { conflict: true } : null;
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

/** A regular file's or a symlink's entry from its bytes (a symlink's blob is its target); null for anything else. */
async function fileEntryOf(absolute: string, stat: Stats, format: ObjectFormat): Promise<TreeEntry | null> {
  if (stat.isSymbolicLink()) return { mode: '120000', blobId: gitBlobId(Buffer.from(await readlink(absolute)), format) };
  if (stat.isFile()) {
    return { mode: (stat.mode & 0o100) !== 0 ? '100755' : '100644', blobId: gitBlobId(await readFile(absolute), format) };
  }
  return null;
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
      if (stat.isDirectory()) {
        // A submodule appears as a directory that carries its own `.git`.
        try {
          await lstat(join(absolute, '.git'));
          throw new WorkspaceCaptureReadError(`the workspace contains a submodule at ${path}`);
        } catch (error) {
          if (error instanceof WorkspaceCaptureReadError) throw error;
        }
        await walk(absolute, path);
        continue;
      }
      const entry = await fileEntryOf(absolute, stat, format);
      if (entry === null) throw new WorkspaceCaptureReadError(`the workspace contains a special file at ${path}`);
      entries.set(path, entry);
      hash.update(path).update('\0').update(entry.mode).update('\0').update(entry.blobId).update('\0');
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
