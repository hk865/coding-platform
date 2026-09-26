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
