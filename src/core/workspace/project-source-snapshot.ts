import * as ts from 'typescript';
import { createHash } from 'node:crypto';
import type { SourceAccess } from './source-index.js';

/**
 * WorkspaceTools — the single live projection of permission-filtered project inputs.
 *
 * This file owns every disk/inventory/identity read used by the TypeScript project
 * service. `typescript-source-query.ts` and `project-source-index.ts` only ever see
 * the frozen material published here, so a capture can be analysed repeatedly with
 * no further I/O and an older capture cannot be changed by a newer one.
 */

/** Host surface for one capture; the host (never the model) decides what is readable. */
export type ProjectSourceAccess = SourceAccess & {
  inventory(signal: AbortSignal): Promise<{ paths: string[]; truncated: boolean }>;
  /** Trusted host supplies only HEAD identity, never history or repository code execution. */
  sourceIdentity(): Promise<{ workspace: string; commit: string | null }>;
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
  const inventory = await access.inventory(signal);
  signal.throwIfAborted();
  if (inventory.truncated) throw new ProjectSourceFailure('rejected', 'project inventory incomplete; choose a narrower workspace');
  const paths = [...new Set(inventory.paths)]
    .filter(path => isSafeSourcePath(path) && !isIgnoredSourcePath(path) && access.allowed(path))
    .sort();
  const files = new Map<string, CapturedProjectFile>();
  const skipped: ProjectSourceSkip[] = [];
  let bytes = 0;
  for (const path of paths) {
    signal.throwIfAborted();
    let content: string;
    try { content = (await access.read(path, fileBytes)).content; }
    catch (error) { skipped.push({ path, reason: observationSkipReason(error) }); continue; }
    signal.throwIfAborted();
    if (content.includes('\0')) { skipped.push({ path, reason: 'binary source' }); continue; }
    if (Buffer.byteLength(content) > fileBytes) { skipped.push({ path, reason: 'source exceeds file capacity' }); continue; }
    bytes += Buffer.byteLength(content);
    if (bytes > captureBytes) throw new ProjectSourceFailure('rejected', 'project observation exceeds capacity; narrow workspace scope');
    files.set(SOURCE_ROOT + path, { path, content, digest: sha256Text(content) });
  }
  // Manifest identity covers engine, HEAD/workspace identity, the text digests and the skip list.
  const snapshot = sha256Text(JSON.stringify({ engine: ts.version, identity,
    sources: [...files.values()].map(file => [file.path, file.digest]),
    skipped: skipped.map(skip => [skip.path, skip.reason]) }));
  return { files, skipped, identity, snapshot };
}

/** The TS/JSON subset of one observation pass, with the strict `captureProjectSource` digest formula. */
export function projectSnapshotOf(observed: ObservedProjectSource): ProjectSourceSnapshot {
  const files = new Map<string, CapturedProjectFile>();
  for (const [key, file] of observed.files) if (isProjectInputPath(file.path)) files.set(key, file);
  const snapshot = sha256Text(JSON.stringify({ engine: ts.version, identity: observed.identity,
    sources: [...files.values()].map(file => [file.path, file.digest]) }));
  return { files, identity: observed.identity, snapshot };
}
