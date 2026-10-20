import * as ts from 'typescript';
import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { SourceAccess } from './source-index.js';
import type { TypeScriptSourceQuery } from './typescript-source-query.js';
import { WORKSPACE_DENIED_PREFIXES } from './denied-prefixes.js';

/**
 * WorkspaceTools — the single live projection of permission-filtered project inputs.
 *
 * This file owns every disk/inventory/identity read used by the TypeScript project
 * service. `typescript-source-query.ts` only ever sees
 * the frozen material published here, so a capture can be analysed repeatedly with
 * no further I/O and an older capture cannot be changed by a newer one.
 */

/** Host surface for one capture; the host (never the model) decides what is readable. */
export type ProjectSourceAccess = SourceAccess & {
  inventory(signal: AbortSignal): Promise<{ paths: string[]; truncated: boolean }>;
  /** Trusted host supplies only HEAD identity, never history or repository code execution. */
  sourceIdentity(): Promise<{ workspace: string; commit: string | null }>;
  /** Host absolute workspace root, when the access has one (trusted, never model text). */
  hostRoot?: string;
  /** §10 item 1, optional: existing hand-built accesses fall back to `inventory()`. */
  listObservationFiles?(signal: AbortSignal): Promise<
    { source: 'git'; paths: string[] } | { source: 'skip_list'; reason: string }>;
  /** §11.4, optional: only a git work tree has a second, ignored-database listing. */
  listIgnoredCompileDatabases?(signal: AbortSignal): Promise<readonly string[]>;
};

/** Public tool query: the original fields plus request-scoped pagination and snapshot pinning. */
export type ProjectSourceQuery = TypeScriptSourceQuery & {
  expectedSnapshot?: string;
  offset?: number;
  limit?: number;
};

/** One frozen project input; `path` is the normalized workspace-relative path. */
export type CapturedProjectFile = Readonly<{ path: string; content: string; digest: string }>;

/** Frozen material for one capture. `files` is keyed by `/workspace/<path>` and is never mutated after publication. */
export type ProjectSourceSnapshot = Readonly<{
  files: ReadonlyMap<string, CapturedProjectFile>;
  identity: Readonly<{ workspace: string; commit: string | null }>;
  snapshot: string;
}>;

/** The one root every projected path is anchored to; shared by capture and analysis. */
export const SOURCE_ROOT = '/workspace/';
/** Engine identity carried in provenance and in the manifest digest. */
export const SOURCE_ENGINE = { name: 'typescript-language-service', version: ts.version } as const;

const FILE_BYTES = 2 * 1024 * 1024;
const CAPTURE_BYTES = 128 * 1024 * 1024;
/** §11.4: a file named `compile_commands.json` is read with this separate per-file limit. */
export const CONFIG_DATABASE_FILE_BYTES = 32 * 1024 * 1024;
/** §10 item 1: the one enumeration-capacity wording (record count is appended by the caller). */
export const OBSERVATION_INVENTORY_CAPACITY = 'project inventory incomplete; choose a narrower workspace';
/** §10 item 1: the one fixed directory skip list; `dist`/`build`/`out`/`target` stay in. */
export const OBSERVATION_SKIP_DIRECTORIES: readonly string[] = Object.freeze([
  '.git', 'node_modules', '.venv', 'venv', '__pycache__', '.mypy_cache', '.pytest_cache', '.tox',
]);
const OBSERVATION_SKIP_DIRECTORY_SET: ReadonlySet<string> = new Set(OBSERVATION_SKIP_DIRECTORIES);
/** §10 item 1: one fixed list shared by the observation read path and the skip-list walk. */
export const isObservationSkippedPath = (path: string): boolean =>
  path.split('/').some(segment => OBSERVATION_SKIP_DIRECTORY_SET.has(segment));

/** Optional caller capacity; defaults keep the original hard limits for existing callers. */
export type ProjectCaptureLimits = { maxFileBytes?: number; maxCaptureBytes?: number };

/** Narrow failure contract shared by capture and analysis; no partial material is published. */
export class ProjectSourceFailure extends Error {
  constructor(readonly status: 'rejected' | 'unsupported' | 'stale' | 'capacity', message: string) { super(message); }
}

/** One tolerated per-file read failure of a tolerant observation pass. */
export type ProjectSourceSkip = Readonly<{ path: string; reason: string }>;

/**
 * One tolerant observation pass: every readable text file plus the skipped paths (binary,
 * over-cap or unreadable). The digest covers the text files and the skip list, so a later
 * change to either side makes a verification `stale`.
 */
export type ObservedProjectSource = Readonly<{
  files: ReadonlyMap<string, CapturedProjectFile>;
  skipped: readonly ProjectSourceSkip[];
  /** §10 item 1: which enumeration supplied the paths, and why it was not Git. */
  inventory: Readonly<{ source: 'git' | 'skip_list'; reason: string | null }>;
  /** §11.4 ignored compile databases, frozen only as configuration (never file-graph nodes). */
  configOnly: ReadonlyMap<string, { content: string; digest: string }>;
  configSkipped: readonly { path: string; reason: string }[];
  identity: Readonly<{ workspace: string; commit: string | null }>;
  snapshot: string;
}>;

export const sha256Text = (text: string) => createHash('sha256').update(text).digest('hex');
export const isSourcePath = (path: string) => /\.(?:[cm]?[jt]sx?)$/.test(path);
export const isIgnoredSourcePath = (path: string) => path.split('/').some(segment =>
  ['.git', '.platform-runtime', '.evaluator', '.oracle', 'hidden-tests', '.pnpm', '.cache', '__pycache__'].includes(segment));
export const isSafeSourcePath = (path: string) => !!path && !/[\\:\0]/.test(path) &&
  !path.split('/').some(segment => !segment || segment === '.' || segment === '..');
export const isProjectInputPath = (path: string) => isSourcePath(path) || path.endsWith('.json');

/**
 * Capture the full readable project input range exactly once. Each call owns independent
 * records; cancellation before publication rejects instead of returning a partial capture.
 */
export async function captureProjectSource(access: ProjectSourceAccess, signal: AbortSignal, limits: ProjectCaptureLimits = {}): Promise<ProjectSourceSnapshot> {
  const fileBytes = limits.maxFileBytes ?? FILE_BYTES, captureBytes = limits.maxCaptureBytes ?? CAPTURE_BYTES;
  signal.throwIfAborted();
  const source = await access.sourceIdentity();
  signal.throwIfAborted();
  // Own the scalars now: a host that reuses or mutates its identity record must not rewrite a frozen capture.
  const identity: Readonly<{ workspace: string; commit: string | null }> = Object.freeze({ workspace: source.workspace, commit: source.commit });
  const inventory = await access.inventory(signal);
  signal.throwIfAborted();
  if (inventory.truncated) throw new ProjectSourceFailure('rejected', 'project inventory incomplete; choose a narrower workspace');
  const paths = [...new Set(inventory.paths)]
    .filter(path => isSafeSourcePath(path) && !isIgnoredSourcePath(path) && access.allowed(path) && isProjectInputPath(path))
    .sort();
  const files = new Map<string, CapturedProjectFile>();
  let bytes = 0;
  for (const path of paths) {
    signal.throwIfAborted();
    let content: string;
    try { content = (await access.read(path, fileBytes)).content; }
    catch { throw new ProjectSourceFailure('rejected', 'source unavailable, denied or exceeds file capacity: ' + path); }
    signal.throwIfAborted();
    bytes += Buffer.byteLength(content);
    if (bytes > captureBytes) throw new ProjectSourceFailure('rejected', 'project snapshot exceeds capacity; narrow workspace scope');
    if (content.includes('\0')) throw new ProjectSourceFailure('rejected', 'binary source: ' + path);
    files.set(SOURCE_ROOT + path, { path, content, digest: sha256Text(content) });
  }
  signal.throwIfAborted();
  // Manifest identity covers engine, HEAD/workspace identity and the sorted path+content digests.
  const snapshot = sha256Text(JSON.stringify({ engine: ts.version, identity, sources: [...files.values()].map(file => [file.path, file.digest]) }));
  return { files, identity, snapshot };
}

const kernelCode = (error: unknown): string | null =>
  error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : null;

/** One skip reason shared by the tolerant reader and the file graph; never a whole-capture failure. */
export function observationSkipReason(error: unknown): string {
  const code = kernelCode(error);
  if (code === 'too_large') return 'source exceeds file capacity';
  if (code === 'binary_file' || code === 'invalid_encoding' || code === 'not_file') return 'binary source';
  return 'source unavailable, denied or exceeds file capacity';
}

/** Access control is the Host's, not the observation's: check the denied prefixes explicitly too. */
const isDeniedObservationPath = (path: string): boolean =>
  WORKSPACE_DENIED_PREFIXES.some(prefix => path === prefix || path.startsWith(prefix + '/'));

const keepObservationPath = (access: ProjectSourceAccess, path: string): boolean =>
  isSafeSourcePath(path) && !isObservationSkippedPath(path) && !isDeniedObservationPath(path) && access.allowed(path);

const byPath = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

/**
 * §10 item 1 Git inventory: drop what the Git list contains but the observation read path
 * cannot keep. `hostRoot` is Host-supplied and trusted; a test double without it keeps the
 * path and lets the read classify it.
 */
async function gitInventoryPaths(access: ProjectSourceAccess, listed: readonly string[], signal: AbortSignal): Promise<string[]> {
  const paths = new Set<string>();
  for (const path of listed) {
    signal.throwIfAborted();
    if (!isSafeSourcePath(path) || isDeniedObservationPath(path) || !access.allowed(path)) continue;
    if (access.hostRoot !== undefined) {
      let metadata;
      try { metadata = await lstat(join(access.hostRoot, path)); }
      catch { continue; }
      // Missing (tracked-deleted), directories (submodule gitlink) and every symlink are skipped.
      if (!metadata.isFile()) continue;
    }
    paths.add(path);
  }
  return [...paths].sort(byPath);
}

/** The test-double fallback: `inventory()` is already the Host's bounded view, apply one filter. */
async function inventoryPaths(access: ProjectSourceAccess, signal: AbortSignal): Promise<string[]> {
  const inventory = await access.inventory(signal);
  signal.throwIfAborted();
  if (inventory.truncated)
    throw new ProjectSourceFailure('capacity', OBSERVATION_INVENTORY_CAPACITY + ' (reached 60000)');
  return [...new Set(inventory.paths)].filter(path => keepObservationPath(access, path)).sort(byPath);
}

/**
 * §10 item 1 skip-list walk: pruned while recursing, never after a full scan. Symlinks are
 * skipped, a skipped directory is never opened, and `dist`/`build`/`out`/`target` are kept.
 */
async function walkObservationPaths(access: ProjectSourceAccess, signal: AbortSignal): Promise<string[]> {
  const root = access.hostRoot;
  if (root === undefined) return inventoryPaths(access, signal);
  const paths: string[] = [];
  const visit = async (directory: string, relative: string): Promise<void> => {
    signal.throwIfAborted();
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => byPath(left.name, right.name));
    for (const entry of entries) {
      signal.throwIfAborted();
      const path = relative === '' ? entry.name : relative + '/' + entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (OBSERVATION_SKIP_DIRECTORY_SET.has(entry.name) || isDeniedObservationPath(path)) continue;
        await visit(join(directory, entry.name), path);
        continue;
      }
      if (!entry.isFile() || !keepObservationPath(access, path)) continue;
      paths.push(path);
      // The cap counts kept paths, exactly like the Git record cap; keep the same wording.
      if (paths.length > 60000)
        throw new ProjectSourceFailure('capacity', OBSERVATION_INVENTORY_CAPACITY + ' (reached ' + String(paths.length) + ')');
    }
  };
  await visit(root, '');
  return paths.sort(byPath);
}

/** §11.4: ignored databases under a skip-list directory do not count. */
const observationConfigPaths = (listed: readonly string[], signal: AbortSignal): string[] => {
  signal.throwIfAborted();
  return [...new Set(listed)]
    .filter(path => path.split('/').pop() === 'compile_commands.json' &&
      isSafeSourcePath(path) && !isObservationSkippedPath(path) && !isDeniedObservationPath(path))
    .sort(byPath);
};

const isCompileDatabasePath = (path: string): boolean => path.split('/').pop() === 'compile_commands.json';

/**
 * Capture every readable input exactly once, tolerating per-file failures. Unlike the strict
 * `captureProjectSource`, a binary/over-cap/unreadable file becomes a `skipped` entry instead of
 * rejecting the whole observation; `projectSnapshotOf` then narrows the text to the TS/JSON subset.
 */
export async function captureObservationSource(access: ProjectSourceAccess, signal: AbortSignal, limits: ProjectCaptureLimits = {}): Promise<ObservedProjectSource> {
  const fileBytes = limits.maxFileBytes ?? FILE_BYTES, captureBytes = limits.maxCaptureBytes ?? CAPTURE_BYTES;
  signal.throwIfAborted();
  const source = await access.sourceIdentity();
  signal.throwIfAborted();
  const identity: Readonly<{ workspace: string; commit: string | null }> = Object.freeze({ workspace: source.workspace, commit: source.commit });

  // §10 item 1: one enumeration choice, decided before any material is frozen. Missing
  // `listObservationFiles` is the internal test-double fallback, never a production path.
  const listing = access.listObservationFiles === undefined ? null : await access.listObservationFiles(signal);
  signal.throwIfAborted();
  let paths: string[];
  let inventory: Readonly<{ source: 'git' | 'skip_list'; reason: string | null }>;
  if (listing === null) {
    inventory = Object.freeze({ source: 'skip_list' as const, reason: '不是 git 仓库' });
    paths = await inventoryPaths(access, signal);
  } else if (listing.source === 'git') {
    inventory = Object.freeze({ source: 'git' as const, reason: null });
    paths = await gitInventoryPaths(access, listing.paths, signal);
  } else {
    inventory = Object.freeze({ source: 'skip_list' as const, reason: listing.reason });
    paths = await walkObservationPaths(access, signal);
  }
  signal.throwIfAborted();

  const files = new Map<string, CapturedProjectFile>();
  const skipped: ProjectSourceSkip[] = [];
  let bytes = 0;
  const countBytes = (content: string): void => {
    bytes += Buffer.byteLength(content);
    if (bytes > captureBytes) throw new ProjectSourceFailure('rejected', 'project observation exceeds capacity; narrow workspace scope');
  };
  for (const path of paths) {
    signal.throwIfAborted();
    // §11.4: every file named compile_commands.json gets 32 MiB, ignored or not.
    const limit = isCompileDatabasePath(path) ? CONFIG_DATABASE_FILE_BYTES : fileBytes;
    let content: string;
    try { content = (await access.read(path, limit)).content; }
    catch (error) { skipped.push({ path, reason: observationSkipReason(error) }); continue; }
    signal.throwIfAborted();
    if (content.includes('\0')) { skipped.push({ path, reason: 'binary source' }); continue; }
    if (Buffer.byteLength(content) > limit) { skipped.push({ path, reason: 'source exceeds file capacity' }); continue; }
    countBytes(content);
    files.set(SOURCE_ROOT + path, { path, content, digest: sha256Text(content) });
  }

  // §11.4: ignored compile databases are config-only material. They are never a `files` entry,
  // never a `skipped` entry and never a language issue; the Host authorization is checked
  // BEFORE each read, and every byte still counts against the one capture total.
  const configOnly = new Map<string, { content: string; digest: string }>();
  const configSkipped: { path: string; reason: string }[] = [];
  if (inventory.source === 'git' && access.listIgnoredCompileDatabases !== undefined) {
    const ignored = await access.listIgnoredCompileDatabases(signal);
    for (const path of observationConfigPaths(ignored, signal)) {
      signal.throwIfAborted();
      if (!access.allowed(path)) {
        configSkipped.push({ path, reason: 'source unavailable, denied or exceeds file capacity' });
        continue;
      }
      let content: string;
      try { content = (await access.read(path, CONFIG_DATABASE_FILE_BYTES)).content; }
      catch (error) { configSkipped.push({ path, reason: observationSkipReason(error) }); continue; }
      signal.throwIfAborted();
      countBytes(content);
      if (content.includes('\0')) { configSkipped.push({ path, reason: 'binary source' }); continue; }
      configOnly.set(path, { content, digest: sha256Text(content) });
    }
  }

  // Manifest identity covers engine, HEAD/workspace identity, the text digests and the skip
  // list. The config array is appended only when at least one ignored database exists, so an
  // observation without one keeps today's byte-identical digest.
  const config: [string, 'config' | 'config-skipped', string][] = [
    ...[...configOnly].map(([path, file]): [string, 'config', string] => [path, 'config', file.digest]),
    ...configSkipped.map((skip): [string, 'config-skipped', string] => [skip.path, 'config-skipped', skip.reason]),
  ].sort((left, right) => byPath(left[0], right[0]));
  const snapshot = sha256Text(JSON.stringify({ engine: ts.version, identity,
    sources: [...files.values()].map(file => [file.path, file.digest]),
    skipped: skipped.map(skip => [skip.path, skip.reason]),
    ...(config.length === 0 ? {} : { config }) }));
  return { files, skipped, inventory, configOnly, configSkipped, identity, snapshot };
}

/** The TS/JSON subset of one observation pass, with the strict `captureProjectSource` digest formula. */
export function projectSnapshotOf(observed: ObservedProjectSource): ProjectSourceSnapshot {
  const files = new Map<string, CapturedProjectFile>();
  for (const [key, file] of observed.files) if (isProjectInputPath(file.path)) files.set(key, file);
  const snapshot = sha256Text(JSON.stringify({ engine: ts.version, identity: observed.identity,
    sources: [...files.values()].map(file => [file.path, file.digest]) }));
  return { files, identity: observed.identity, snapshot };
}
