import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpath, stat, type FileHandle } from 'node:fs/promises';
import type { GitFileIdentity, GitWorkspaceChange, GitWorkspaceComparison, GitWorkingTreeChange, GitWorkingTreeComparison, GitWorkingTreePair, WorkspaceCaptureLimits, WorkspaceContentModeIdentity, WorkspaceError, WorkspaceFile, WorkspaceResult } from './ports.js';
import type { WorkspaceGitReadAccess, WorkspaceReadAccess } from './access.js';
import { MAX_COMPARISON_BYTES } from './workspace-read.js';
import { isSafeSourcePath, ProjectSourceFailure } from './project-source-snapshot.js';
import { captureTextSource, type TextSourceSnapshot } from './text-source-snapshot.js';

/**
 * Trusted binding for one already-authorized WorkspaceReadAccess. The root-handle getter is
 * the only path to the workspace, and `allowsRead` is the same intersection of the Host
 * grant and the Kernel sandbox policy used for ordinary reads. Nothing here is model-supplied.
 */
export type WorkspaceGitReadBinding = {
  /** Read-only handle to the exact resolved root; acquired only for a real Git operation. */
  acquireRootHandle(): Promise<FileHandle>;
  /** Intersection of Host `allowsRead` and the Kernel sandbox policy. */
  allowsRead(path: string): boolean;
  /** The request/lifecycle signal this access is bound to. */
  signal: AbortSignal;
  /** Liveness guard; throws after release or cancellation. */
  live(): void;
};

/** 40/64 lowercase full commit OID. Refs, abbreviations and revision expressions are never accepted. */
export const isCompleteCommitOid = (value: unknown): value is string =>
  typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);

/** Fixed bound for one NUL-separated tree listing; a tree never returns more than this. */
export const GIT_TREE_OUTPUT_LIMIT_BYTES = 8 * 1024 * 1024;

/** One Git subprocess may not outlive this; a killed child is awaited before the handle closes. */
const GIT_PROCESS_TIMEOUT_MS = 5_000;
/** stderr is diagnostic only and never parsed, so it is drained under a small bound. */
const GIT_STDERR_LIMIT_BYTES = 64 * 1024;
/** A repository path must stay inside the same normalized-relative representation as model paths. */
const MAX_TREE_PATH_LENGTH = 4096;

/**
 * The approved environment. It is built from a fixed base rather than inherited so a caller's
 * `GIT_DIR`/`GIT_WORK_TREE`/`GIT_OBJECT_DIRECTORY`/`GIT_CONFIG_*` redirection cannot point the
 * reader at another repository. Local repository config still resolves linked worktrees and the
 * object format; system/global config, prompts, pager, optional locks, replace objects and lazy
 * fetch are all disabled.
 */
const GIT_ENVIRONMENT: Readonly<Record<string, string>> = Object.freeze({
  PATH: '/usr/bin:/bin',
  HOME: '/nonexistent',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0',
  GIT_PAGER: 'cat',
  GIT_NO_REPLACE_OBJECTS: '1',
  GIT_NO_LAZY_FETCH: '1',
  LC_ALL: 'C',
  LANG: 'C',
});

/** Global flags only; no path is ever joined into a revision expression. */
const GIT_GLOBAL_ARGS: readonly string[] = Object.freeze([
  '--no-optional-locks',
  '-c', 'core.fsmonitor=false',
  '-c', 'core.untrackedCache=false',
  '-c', 'core.hooksPath=/dev/null',
  '--no-replace-objects',
  '--literal-pathspecs',
]);

const rejected = <T>(code: WorkspaceError, reason: string): WorkspaceResult<T> => ({ status: 'rejected', code, reason });
const unsupported = (reason: string): WorkspaceResult<never> => rejected('unsupported', reason);
const cancelled = (): WorkspaceResult<never> => rejected('cancelled', 'request cancelled');
/** The root handle is released after every child closed; a close failure never rewrites the result. */
const closeHandle = async (handle: FileHandle): Promise<void> => { try { await handle.close(); } catch { /* operation already decided */ } };
/** A directory handle is addressed through the live /proc entry, never a re-resolved root string. */
const handleCwd = (handle: FileHandle): string => `/proc/${String(process.pid)}/fd/${String(handle.fd)}`;

type ProcessResult = {
  code: number | null;
  stdout: Buffer;
  stdoutOverflow: boolean;
  stderrOverflow: boolean;
  timedOut: boolean;
  aborted: boolean;
};

type ProcessRequest = {
  cwd: string;
  args: readonly string[];
  /** Exactly one validated OID plus newline for `cat-file --batch-check`; otherwise absent. */
  stdin?: Buffer;
  maxStdout: number;
  signal: AbortSignal;
};

/**
 * Run one fixed `git` subprocess. stdout is bounded while it streams; abort, timeout or an
 * output bound kills the real child and still waits for its `close`, so the caller can release
 * the root handle only after the process actually exited. No shell, argv is never model text
 * and the classification never guesses from exit code 128 or stderr text.
 */
function runGitProcess(request: ProcessRequest): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    if (request.signal.aborted) {
      resolve({ code: null, stdout: Buffer.alloc(0), stdoutOverflow: false, stderrOverflow: false, timedOut: false, aborted: true });
      return;
    }
    let child: ChildProcess;
    try {
      child = spawn('git', [...GIT_GLOBAL_ARGS, ...request.args], {
        cwd: request.cwd, shell: false, env: GIT_ENVIRONMENT, windowsHide: true,
        stdio: [request.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      });
    } catch (error) { reject(error); return; }
    const stdout: Buffer[] = [];
    let stdoutBytes = 0, stderrBytes = 0;
    let stdoutOverflow = false, stderrOverflow = false, timedOut = false, settled = false;
    const kill = () => { try { child.kill('SIGKILL'); } catch { /* the child already exited */ } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, GIT_PROCESS_TIMEOUT_MS);
    timer.unref?.();
    const onAbort = () => kill();
    request.signal.addEventListener('abort', onAbort, { once: true });
    if (request.signal.aborted) kill();
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.signal.removeEventListener('abort', onAbort);
      complete();
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > request.maxStdout) { stdoutOverflow = true; kill(); return; }
      stdout.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > GIT_STDERR_LIMIT_BYTES) { stderrOverflow = true; kill(); }
    });
    child.once('error', error => finish(() => reject(error)));
    child.once('close', code => finish(() => resolve({
      code, stdout: Buffer.concat(stdout), stdoutOverflow, stderrOverflow, timedOut, aborted: request.signal.aborted,
    })));
    if (request.stdin) {
      const stdin = child.stdin;
      if (stdin) {
        // A SIGKILL during the write can surface EPIPE; the close/timeout path owns the result.
        stdin.on('error', () => {});
        try { stdin.write(request.stdin); stdin.end(); } catch { /* classified from close/abort state */ }
      }
    }
  });
}

type RepositoryContext = { cwd: string; objectFormat: 'sha1' | 'sha256' };

/**
 * The reported top-level must have the same device/inode as the open authorized root;
 * a parent-repository root is rejected, while an alias resolving to that same directory
 * is accepted.
 */
async function openRepository(handle: FileHandle, signal: AbortSignal): Promise<WorkspaceResult<RepositoryContext>> {
  const cwd = handleCwd(handle);
  const top = await runGitProcess({ cwd, args: ['rev-parse', '--show-toplevel'], maxStdout: 8192, signal });
  if (top.aborted) return cancelled();
  if (top.timedOut || top.stdoutOverflow || top.stderrOverflow || top.code !== 0)
    return unsupported('the authorized workspace root is not a Git work tree');
  const toplevel = top.stdout.toString('utf8').trim();
  if (!toplevel) return unsupported('Git did not report a work-tree top-level');
  try {
    const [rootStat, topStat] = await Promise.all([handle.stat(), stat(await realpath(toplevel))]);
    if (rootStat.dev !== topStat.dev || rootStat.ino !== topStat.ino)
      return unsupported('the Git work tree top-level is not the authorized workspace root');
  } catch { return rejected('unavailable', 'the workspace root identity could not be verified'); }
  const format = await runGitProcess({ cwd, args: ['rev-parse', '--show-object-format'], maxStdout: 8192, signal });
  if (format.aborted) return cancelled();
  if (format.timedOut || format.stdoutOverflow || format.stderrOverflow || format.code !== 0)
    return rejected('unavailable', 'the repository object format could not be read');
  const objectFormat = format.stdout.toString('utf8').trim();
  if (objectFormat !== 'sha1' && objectFormat !== 'sha256') return unsupported('the repository object format is not supported');
  return { status: 'ready', value: { cwd, objectFormat } };
}

type ObjectProbe = { kind: 'missing' } | { kind: 'object'; objectType: string; size: number };

/** One machine response for exactly one OID; missing is only the literal `<oid> missing` line. */
async function probeObject(cwd: string, objectId: string, signal: AbortSignal): Promise<WorkspaceResult<ObjectProbe>> {
  const result = await runGitProcess({ cwd, args: ['cat-file', '--batch-check'],
    stdin: Buffer.from(objectId + '\n', 'ascii'), maxStdout: 8192, signal });
  if (result.aborted) return cancelled();
  if (result.timedOut || result.stdoutOverflow || result.stderrOverflow || result.code !== 0)
    return rejected('unavailable', 'Git object query failed');
  const lines = result.stdout.toString('utf8').split('\n').filter(line => line.length > 0);
  if (lines.length !== 1) return rejected('unavailable', 'Git returned an unexpected object response');
  const line = lines[0]!;
  if (line === objectId + ' missing') return { status: 'ready', value: { kind: 'missing' } };
  const match = /^([0-9a-f]{40,64}) (commit|tree|blob|tag) ([0-9]{1,20})$/.exec(line);
  const size = match ? Number(match[3]) : Number.NaN;
  if (!match || match[1] !== objectId || !Number.isSafeInteger(size))
    return rejected('unavailable', 'Git returned an unexpected object response');
  return { status: 'ready', value: { kind: 'object', objectType: match[2]!, size } };
}

/** The commit must exist, match the repository object format and be a commit — never peeled. */
async function checkCommit(cwd: string, commit: string, objectFormat: 'sha1' | 'sha256', signal: AbortSignal): Promise<WorkspaceResult<null>> {
  if (commit.length !== (objectFormat === 'sha256' ? 64 : 40))
    return rejected('invalid', 'the commit id does not match the repository object format');
  const probe = await probeObject(cwd, commit, signal);
  if (probe.status !== 'ready') return probe;
  if (probe.value.kind === 'missing') return rejected('not_found', 'the requested commit is not present in this repository');
  if (probe.value.objectType !== 'commit') return rejected('invalid', 'the requested object is not a commit');
  return { status: 'ready', value: null };
}

type TreeEntry = { mode: string; objectType: string; objectId: string; path: string };

/** Parse NUL-separated `ls-tree` records; a path that is not UTF-8 cannot be represented safely. */
function parseTreeEntries(buffer: Buffer): WorkspaceResult<TreeEntry[]> {
  const entries: TreeEntry[] = [];
  let start = 0;
  for (let index = 0; index <= buffer.length; index += 1) {
    if (index < buffer.length && buffer[index] !== 0) continue;
    if (index === start) { start = index + 1; continue; }
    const record = buffer.subarray(start, index);
    start = index + 1;
    const tab = record.indexOf(9);
    if (tab < 0) return rejected('unavailable', 'Git returned a malformed tree entry');
    const header = record.subarray(0, tab).toString('ascii');
    const match = /^([0-9]{6}) (blob|tree|commit) ([0-9a-f]{40,64})$/.exec(header);
    if (!match) return rejected('unavailable', 'Git returned a malformed tree entry');
    let path: string;
    // A leading U+FEFF is part of the file-name identity and must survive the tree decoder;
    // only the blob body below keeps the existing BOM-as-display convention.
    try { path = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(record.subarray(tab + 1)); }
    catch { return unsupported('the repository tree contains a path that is not valid UTF-8'); }
    entries.push({ mode: match[1]!, objectType: match[2]!, objectId: match[3]!, path });
  }
  return { status: 'ready', value: entries };
}

/** Exact single-file lookup. A directory, symlink or gitlink is unsupported, never followed. */
async function findRegularTreeEntry(cwd: string, commit: string, path: string, signal: AbortSignal): Promise<WorkspaceResult<GitFileIdentity>> {
  const result = await runGitProcess({ cwd, args: ['ls-tree', '-z', commit, '--', path], maxStdout: 64 * 1024, signal });
  if (result.aborted) return cancelled();
  if (result.timedOut || result.stdoutOverflow || result.stderrOverflow || result.code !== 0)
    return rejected('unavailable', 'Git tree lookup failed');
  const parsed = parseTreeEntries(result.stdout);
  if (parsed.status !== 'ready') return parsed;
  const matches = parsed.value.filter(entry => entry.path === path);
  if (matches.length === 0) return rejected('not_found', 'this commit has no such path: ' + path);
  if (matches.length > 1) return rejected('unavailable', 'Git returned an ambiguous tree entry');
  const entry = matches[0]!;
  if (entry.objectType !== 'blob' || (entry.mode !== '100644' && entry.mode !== '100755'))
    return unsupported('only a regular file can be read from a Git commit');
  return { status: 'ready', value: { objectId: entry.objectId, mode: entry.mode } };
}

const representableTreePath = (path: string): boolean => path.length > 0 && path.length <= MAX_TREE_PATH_LENGTH && isSafeSourcePath(path);

const identityOf = (entry: GitFileIdentity): GitFileIdentity => ({ objectId: entry.objectId, mode: entry.mode });

/**
 * The real root-bound Git capability. Every call acquires one fresh root handle, runs only the
 * fixed read-only commands, waits for the real child processes to close and then releases the
 * handle on success, rejection, cancellation and timeout alike. Ordinary reads never probe Git.
 */
export function createWorkspaceGitReadAccess(binding: WorkspaceGitReadBinding): WorkspaceGitReadAccess {
  return {
    async readFile(input) {
      binding.live();
      // Defensive re-checks: the registry validates first, but this capability never trusts a caller.
      if (!isCompleteCommitOid(input.commit)) return rejected('invalid', 'commit must be a full lowercase commit id');
      if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1) return rejected('invalid', 'maxBytes must be a positive safe integer');
      if (!binding.allowsRead(input.path)) return rejected('forbidden', 'path is outside the current read scope');
      const handle = await binding.acquireRootHandle();
      try {
        // A cancellation that arrived while the handle was pending must not start a child;
        // the real handle is still released by the finally below.
        if (binding.signal.aborted) return cancelled();
        const repository = await openRepository(handle, binding.signal);
        if (repository.status !== 'ready') return repository;
        const verified = await checkCommit(repository.value.cwd, input.commit, repository.value.objectFormat, binding.signal);
        if (verified.status !== 'ready') return verified;
        const entry = await findRegularTreeEntry(repository.value.cwd, input.commit, input.path, binding.signal);
        if (entry.status !== 'ready') return entry;
        const probe = await probeObject(repository.value.cwd, entry.value.objectId, binding.signal);
        if (probe.status !== 'ready') return probe;
        if (probe.value.kind === 'missing') return rejected('not_found', 'the referenced blob is missing from this repository');
        if (probe.value.objectType !== 'blob') return unsupported('the tree entry is not a regular blob');
        if (probe.value.size > input.maxBytes)
          return rejected('capacity', 'the historical blob exceeds maxBytes; retry with a larger trusted limit');
        const blob = await runGitProcess({ cwd: repository.value.cwd, args: ['cat-file', 'blob', entry.value.objectId], maxStdout: input.maxBytes, signal: binding.signal });
        if (blob.aborted) return cancelled();
        if (blob.timedOut || blob.stderrOverflow) return rejected('unavailable', 'the historical blob could not be read');
        // A bound that actually triggered the kill keeps its observed capacity cause; a non-zero
        // exit without an observed bound is an unknown machine failure, never a not_found guess.
        if (blob.stdoutOverflow || blob.stdout.byteLength > input.maxBytes)
          return rejected('capacity', 'the historical blob exceeds maxBytes; retry with a larger trusted limit');
        if (blob.code !== 0) return rejected('unavailable', 'the historical blob could not be read');
        return { status: 'ready', value: { commit: input.commit, bytes: blob.stdout } };
      } finally { await closeHandle(handle); }
    },
    async readTree(input) {
      binding.live();
      if (!isCompleteCommitOid(input.commit)) return rejected('invalid', 'commit must be a full lowercase commit id');
      if (input.prefix !== null && !representableTreePath(input.prefix)) return rejected('invalid', 'prefix must be a normalized workspace-relative path');
      const prefix = input.prefix;
      const handle = await binding.acquireRootHandle();
      try {
        // A cancellation that arrived while the handle was pending must not start a child;
        // the real handle is still released by the finally below.
        if (binding.signal.aborted) return cancelled();
        const repository = await openRepository(handle, binding.signal);
        if (repository.status !== 'ready') return repository;
        const verified = await checkCommit(repository.value.cwd, input.commit, repository.value.objectFormat, binding.signal);
        if (verified.status !== 'ready') return verified;
        // The prefix is a literal pathspec (no glob): narrowing it bounds the listing the same way
        // the caller bounds the returned change set, so a huge unrelated tree never has to be read.
        const listing = await runGitProcess({ cwd: repository.value.cwd,
          args: ['ls-tree', '-r', '-z', '--full-tree', input.commit, ...(prefix === null ? [] : ['--', prefix])],
          maxStdout: input.maxBytes, signal: binding.signal });
        if (listing.aborted) return cancelled();
        if (listing.timedOut || listing.stderrOverflow) return rejected('unavailable', 'the Git tree listing failed');
        if (listing.stdoutOverflow) return rejected('capacity', 'the Git tree listing exceeds the bounded size; choose a narrower prefix');
        if (listing.code !== 0) return rejected('unavailable', 'the Git tree listing failed');
        const parsed = parseTreeEntries(listing.stdout);
        if (parsed.status !== 'ready') return parsed;
        if (parsed.value.length > input.maxEntries)
          return rejected('capacity', 'the Git tree listing exceeds the configured inventory capacity; choose a narrower prefix');
        const files: ({ path: string } & GitFileIdentity)[] = [];
        for (const entry of parsed.value) {
          if (prefix !== null && entry.path !== prefix && !entry.path.startsWith(prefix + '/')) continue;
          if (!representableTreePath(entry.path))
            return unsupported('the tree contains a path that cannot be represented as a normalized workspace path');
          if (!binding.allowsRead(entry.path)) continue;
          // The domain is the authorized regular-file set: any non-regular entry inside it makes
          // the whole comparison unsupported instead of being silently skipped.
          if (entry.objectType !== 'blob' || (entry.mode !== '100644' && entry.mode !== '100755'))
            return unsupported('the compared scope contains a non-regular file');
          files.push({ path: entry.path, objectId: entry.objectId, mode: entry.mode });
        }
        return { status: 'ready', value: { commit: input.commit, files } };
      } finally { await closeHandle(handle); }
    },
  };
}

const sha256Bytes = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/**
 * Registry-facing single-file read. It applies the same trusted allowed predicate as an
 * ordinary read and then maps the verified raw bytes: digest/sizeBytes are always the original
 * bytes (BOM included), while the displayed content keeps the existing strict UTF-8/no-NUL and
 * BOM-stripping convention. readAt uses the registry clock handed in by the caller.
 */
export async function readGitWorkspaceFile(
  access: WorkspaceReadAccess,
  input: { commit: string; path: string; maxBytes: number },
  now: () => string,
): Promise<WorkspaceResult<WorkspaceFile>> {
  const git = access.git;
  if (!git) return unsupported('git versions are not available for this workspace access');
  if (!access.authorization.allowsRead(input.path)) return { status: 'rejected', code: 'forbidden', reason: 'path is outside the current read scope' };
  const result = await git.readFile(input);
  if (result.status !== 'ready') return result;
  if (result.value.commit !== input.commit) return rejected('unavailable', 'Git returned a different commit than requested');
  let content: string;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(result.value.bytes); }
  catch { return unsupported('the historical blob is not valid UTF-8 text'); }
  if (content.includes('\0')) return unsupported('the historical blob contains NUL and is not text');
  return { status: 'ready', value: {
    path: input.path, content, digest: sha256Bytes(result.value.bytes), sizeBytes: result.value.bytes.byteLength,
    digestBasis: 'raw_bytes', version: { kind: 'git', commit: input.commit }, readAt: now(),
  } };
}

/**
 * Registry-facing Git tree comparison. Both trees are read through the SAME bound capability,
 * so the pair shares one fresh access, subject and root. The diff is a short-lived path →
 * blob OID/mode set: a mode-only delta is modified, identical content under a different path is
 * a plain add/delete and the Git OID is never presented as a capture content digest.
 */
export async function compareGitWorkspaceTrees(
  access: WorkspaceReadAccess,
  beforeCommit: string,
  afterCommit: string,
  prefix: string | null,
  limits: { maxInventoryFiles: number; maxQueryResults: number },
): Promise<WorkspaceResult<GitWorkspaceComparison>> {
  const git = access.git;
  if (!git) return unsupported('git comparisons are not available for this workspace access');
  const treeInput = { prefix, maxEntries: limits.maxInventoryFiles, maxBytes: GIT_TREE_OUTPUT_LIMIT_BYTES };
  const before = await git.readTree({ commit: beforeCommit, ...treeInput });
  if (before.status !== 'ready') return before;
  const after = await git.readTree({ commit: afterCommit, ...treeInput });
  if (after.status !== 'ready') return after;
  const beforeFiles = new Map(before.value.files.map(file => [file.path, file]));
  const afterFiles = new Map(after.value.files.map(file => [file.path, file]));
  const changes: GitWorkspaceChange[] = [];
  for (const [path, file] of afterFiles) {
    const prior = beforeFiles.get(path);
    if (!prior) changes.push({ kind: 'added', path, after: identityOf(file) });
    else if (prior.objectId !== file.objectId || prior.mode !== file.mode)
      changes.push({ kind: 'modified', path, before: identityOf(prior), after: identityOf(file) });
  }
  for (const [path, file] of beforeFiles) if (!afterFiles.has(path)) changes.push({ kind: 'deleted', path, before: identityOf(file) });
  changes.sort((left, right) => left.path.localeCompare(right.path));
  if (changes.length > limits.maxQueryResults) return rejected('capacity', 'the Git comparison exceeds the configured change capacity; choose a narrower prefix');
  let bytes = 0;
  for (const change of changes) {
    bytes += Buffer.byteLength(JSON.stringify(change));
    if (bytes > MAX_COMPARISON_BYTES) return rejected('capacity', 'the Git comparison exceeds the bounded serialized size; choose a narrower prefix');
  }
  return { status: 'ready', value: {
    before: { kind: 'git', commit: beforeCommit }, after: { kind: 'git', commit: afterCommit },
    scope: { kind: 'git_regular_files', selectionVersion: 'authorized-regular-blob-v1', prefix },
    comparison: 'git_tree_content_and_mode', complete: true, changes,
  } };
}

/**
 * Mixed fixed-Git/current-working-tree text comparison. This is one read-only observation over
 * the one fresh access the CaptureRegistry already opened: the historical side reuses the real
 * `readTree`/`readGitWorkspaceFile` (full OID, Git tree mode, original blob bytes), the current
 * side calls `captureTextSource` exactly once and recovers the mode from that same Kernel read,
 * and the path-union diff keeps the caller's before/after direction. `complete` only means the
 * selected authorized inventory and every file read succeeded; it is not an atomic whole-tree
 * snapshot, is not retained, and is never a future guarantee (`currentness: 'not_rechecked'`).
 */
export async function compareGitWorkingTree(
  access: WorkspaceReadAccess,
  input: GitWorkingTreePair & { prefix: string | null },
  signal: AbortSignal,
  limits: Pick<WorkspaceCaptureLimits, 'maxFileBytes' | 'maxCaptureBytes' | 'maxInventoryFiles' | 'maxQueryResults'>,
  now: () => string,
): Promise<WorkspaceResult<GitWorkingTreeComparison>> {
  const git = access.git;
  if (!git) return unsupported('a fixed Git version is not available for this workspace access');
  const prefix = input.prefix;
  // Defensive re-checks: the registry validates the pair, but this capability never trusts a caller.
  const beforeIsGit = input.before.kind === 'git';
  const gitVersion = beforeIsGit ? input.before : input.after;
  if (gitVersion.kind !== 'git') return rejected('invalid', 'exactly one side of a mixed comparison must be a fixed Git version');
  const commit = gitVersion.commit;
  const pair: GitWorkingTreePair = beforeIsGit
    ? { before: gitVersion, after: { kind: 'working_tree' } }
    : { before: { kind: 'working_tree' }, after: gitVersion };

  // Historical side: one bounded tree listing, then the existing strict single-file reader for
  // the original bytes. The real Git tree mode is carried straight through; digest/sizeBytes are
  // the raw blob bytes, never the Git object id and never a re-encoding of the decoded body.
  const tree = await git.readTree({ commit, prefix, maxEntries: limits.maxInventoryFiles, maxBytes: GIT_TREE_OUTPUT_LIMIT_BYTES });
  if (tree.status !== 'ready') return tree;
  const gitFiles = new Map<string, WorkspaceContentModeIdentity>();
  let gitBytes = 0;
  for (const entry of tree.value.files) {
    const file = await readGitWorkspaceFile(access, { commit, path: entry.path, maxBytes: limits.maxFileBytes }, now);
    if (file.status !== 'ready') return file;
    gitBytes += file.value.sizeBytes;
    if (gitBytes > limits.maxCaptureBytes)
      return rejected('capacity', 'the historical side exceeds the configured content capacity; choose a narrower prefix');
    gitFiles.set(entry.path, { digest: file.value.digest, digestBasis: 'raw_bytes', sizeBytes: file.value.sizeBytes, mode: entry.mode });
  }

  // Current side: exactly one bounded text observation through the same trusted access. The local
  // forwarder records the mode the Kernel returned for that very read; authorization, inventory,
  // signal, root and every other method still belong to the one access, so no second owner is
  // created and the digest is never recomputed from the decoded content.
  const modes = new Map<string, number | undefined>();
  const observingAccess: WorkspaceReadAccess = {
    ...access,
    read: async (path, maxBytes) => {
      const file = await access.read(path, maxBytes);
      modes.set(path, file.mode);
      return file;
    },
  };
  let observed: TextSourceSnapshot;
  try {
    observed = await captureTextSource(observingAccess, { prefix }, signal,
      { maxFileBytes: limits.maxFileBytes, maxCaptureBytes: limits.maxCaptureBytes, maxInventoryFiles: limits.maxInventoryFiles });
  } catch (error) {
    return mapMixedTextFailure(error);
  }
  const workFiles = new Map<string, WorkspaceContentModeIdentity>();
  for (const file of observed.files.values()) {
    const mode = modes.get(file.path);
    // A missing mode cannot be defaulted to ordinary text/100644: the whole comparison is unsupported.
    if (mode === undefined) return unsupported('a current file did not report a mode; the mixed comparison cannot classify it');
    workFiles.set(file.path, { digest: file.digest, digestBasis: 'raw_bytes', sizeBytes: file.byteLength,
      mode: (mode & 0o100) !== 0 ? '100755' : '100644' });
  }

  // Path-union add/delete/modified with the caller's direction preserved. Unlike the frozen
  // capture/capture diff this never guesses a rename and never invents a captureRef/objectId.
  const beforeFiles = beforeIsGit ? gitFiles : workFiles;
  const afterFiles = beforeIsGit ? workFiles : gitFiles;
  const changes: GitWorkingTreeChange[] = [];
  for (const [path, after] of afterFiles) {
    const before = beforeFiles.get(path);
    if (!before) changes.push({ kind: 'added', path, after });
    else if (before.digest !== after.digest || before.mode !== after.mode)
      changes.push({ kind: 'modified', path, before, after });
  }
  for (const [path, before] of beforeFiles) if (!afterFiles.has(path)) changes.push({ kind: 'deleted', path, before });
  changes.sort((left, right) => left.path.localeCompare(right.path));
  if (changes.length > limits.maxQueryResults)
    return rejected('capacity', 'the mixed comparison exceeds the configured change capacity; choose a narrower prefix');
  let bytes = 0;
  for (const change of changes) {
    bytes += Buffer.byteLength(JSON.stringify(change));
    if (bytes > MAX_COMPARISON_BYTES) return rejected('capacity', 'the mixed comparison exceeds the bounded serialized size; choose a narrower prefix');
  }

  return { status: 'ready', value: {
    ...pair,
    scope: { kind: 'text_files', selectionVersion: 'readable-regular-utf8-no-nul-v1', prefix, digestBasis: 'raw_bytes' },
    comparison: 'git_worktree_raw_content_and_mode', complete: true, observedAt: now(), currentness: 'not_rechecked',
    changes,
  } };
}

/**
 * The text observation has its own failure contract. Map it to the existing typed WorkspaceResult
 * codes exactly as the capture registry does; a non-text failure is a real access failure and is
 * re-thrown so the registry's own unavailable/cancelled mapping still owns it.
 */
function mapMixedTextFailure(error: unknown): WorkspaceResult<never> {
  if (!(error instanceof ProjectSourceFailure)) throw error;
  if (error.status === 'unsupported') return unsupported(error.message);
  if (error.status === 'stale') return rejected('source_stale', error.message);
  if (error.status === 'capacity') return rejected('capacity', error.message);
  if (/inventory incomplete|capacity/.test(error.message)) return rejected('capacity', error.message);
  if (/outside readable scope/.test(error.message)) return rejected('forbidden', error.message);
  return rejected('invalid', error.message);
}
