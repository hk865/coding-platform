import { ProjectSourceFailure, SOURCE_ROOT, isSafeSourcePath, sha256Text } from './project-source-snapshot.js';
import type { CaptureContentScope } from './ports.js';
import type { WorkspaceReadAccess } from './access.js';

/**
 * Strict text capture: the same trusted access/inventory surface as the TS provider, but with
 * no analyzer and no query cache. Every selected file must be readable regular UTF-8 without
 * NUL — one binary, badly encoded, missing or oversized selection rejects the whole capture
 * instead of silently publishing an incomplete "complete" scope.
 */

export type TextSourceFile = Readonly<{ path: string; content: string; digest: string; byteLength: number }>;
export type TextSourceScope = Extract<CaptureContentScope, { kind: 'text_files' }>;
export type TextSourceSnapshot = Readonly<{
  files: ReadonlyMap<string, TextSourceFile>;
  identity: Readonly<{ workspace: string; commit: string | null }>;
  snapshot: string;
  scope: TextSourceScope;
}>;

export const TEXT_ENGINE = { name: 'workspace-text', version: '1', indexVersion: 'workspace-text@1' } as const;
/** Single path→frozen-key helper shared by every text consumer (no entry guesses a prefix). */
export const textSourceKey = (path: string) => SOURCE_ROOT + path;

const kernelCode = (error: unknown): string | null =>
  error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : null;

/** Capture the full readable inventory of the declared prefix; two observations are the caller's job. */
export async function captureTextSource(
  access: WorkspaceReadAccess,
  input: { prefix: string | null },
  signal: AbortSignal,
  limits: { maxFileBytes: number; maxCaptureBytes: number; maxInventoryFiles: number },
): Promise<TextSourceSnapshot> {
  signal.throwIfAborted();
  const identity: Readonly<{ workspace: string; commit: string | null }> = Object.freeze({ ...(await access.sourceIdentity()) });
  signal.throwIfAborted();
  const inventory = await access.listFiles(limits.maxInventoryFiles);
  signal.throwIfAborted();
  if (inventory.truncated) throw new ProjectSourceFailure('capacity', 'text inventory incomplete; choose a narrower prefix or raise the inventory limit');
  const prefix = input.prefix;
  const paths = [...new Set(inventory.paths)]
    .filter(path => isSafeSourcePath(path) && access.authorization.allowsRead(path))
    .filter(path => prefix === null || path === prefix || path.startsWith(prefix + '/'))
    .sort();
  const files = new Map<string, TextSourceFile>();
  let bytes = 0;
  for (const path of paths) {
    signal.throwIfAborted();
    let read: { content: string; revision: string; byteLength: number };
    try { read = await access.read(path, limits.maxFileBytes); }
    catch (error) {
      const code = kernelCode(error);
      if (code === 'too_large') throw new ProjectSourceFailure('capacity', 'text file exceeds the per-file capacity: ' + path);
      if (code === 'binary_file' || code === 'invalid_encoding' || code === 'not_file') throw new ProjectSourceFailure('unsupported', 'selected path is not readable UTF-8 text: ' + path);
      if (code === 'not_found' || code === 'parent_missing' || code === 'file_changed') throw new ProjectSourceFailure('stale', 'text source changed while being captured: ' + path);
      if (code === 'invalid_path') throw new ProjectSourceFailure('rejected', 'invalid path inside the declared text scope: ' + path);
      if (code === 'permission_denied') throw new ProjectSourceFailure('rejected', 'text source is no longer readable: ' + path);
      throw new ProjectSourceFailure('rejected', 'text source unavailable: ' + path);
    }
    signal.throwIfAborted();
    bytes += read.byteLength;
    if (bytes > limits.maxCaptureBytes) throw new ProjectSourceFailure('capacity', 'text capture exceeds the configured content capacity; choose a narrower prefix');
    if (read.content.includes('\0')) throw new ProjectSourceFailure('unsupported', 'selected path contains NUL and is not text: ' + path);
    // digest/revision is the Kernel's sha256 over the raw file bytes; content is decoded display text.
    files.set(textSourceKey(path), { path, content: read.content, digest: read.revision, byteLength: read.byteLength });
  }
  signal.throwIfAborted();
  const scope: TextSourceScope = { kind: 'text_files', selectionVersion: 'readable-regular-utf8-no-nul-v1', prefix, digestBasis: 'raw_bytes' };
  const snapshot = sha256Text(JSON.stringify({ engine: TEXT_ENGINE.indexVersion, scope, identity,
    sources: [...files.values()].map(file => [file.path, file.digest, file.byteLength]) }));
  return { files, identity, snapshot, scope };
}
