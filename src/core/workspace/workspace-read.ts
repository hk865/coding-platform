import { canonicalJson } from '../../contracts/fingerprint.js';
import { isProjectInputPath } from './project-source-snapshot.js';
import { textSourceKey } from './text-source-snapshot.js';
import type { CaptureEntry, CaptureMaterial } from './capture.js';
import type { WorkspaceReadAccess } from './access.js';
import type { CapturedWorkspaceComparison, CaptureContentScope, ReadWorkspaceRequest, WorkspaceChange, WorkspaceFile, WorkspaceResult } from './ports.js';

/**
 * Precise current/frozen file reads and same-scope content comparison. This module owns no
 * registry, cache or provider: it maps one already-authorized access or one frozen capture.
 */

/** Upper bound for one comparison response; it is never returned partially. */
export const MAX_COMPARISON_BYTES = 8 * 1024 * 1024;

type ContentFile = { path: string; digest: string };
export type ContentManifest = ReadonlyMap<string, ContentFile>;

const rejected = <T>(code: 'invalid' | 'forbidden' | 'not_found' | 'source_stale' | 'capacity' | 'unsupported' | 'unavailable' | 'cancelled', reason: string): WorkspaceResult<T> =>
  ({ status: 'rejected', code, reason });

const safeRelative = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096 &&
  !/[\\:\0]/.test(value) && value.split('/').every(segment => !!segment && segment !== '.' && segment !== '..');
const kernelCode = (error: unknown): string | null =>
  error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : null;
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

/** The declared scope decides whether a missing file is "absent here" or "outside this capture". */
export const scopeContains = (scope: CaptureContentScope, path: string): boolean =>
  scope.kind === 'text_files' ? scope.prefix === null || path === scope.prefix || path.startsWith(scope.prefix + '/') : isProjectInputPath(path);

export const manifestOf = (entry: { material: CaptureMaterial }): ContentManifest =>
  entry.material.provider === 'text' ? entry.material.text : entry.material.snapshot.files;

function capturedFile(entry: CaptureEntry, path: string): { path: string; content: string; digest: string; byteLength: number } | undefined {
  const key = textSourceKey(path);
  if (entry.material.provider === 'text') {
    const file = entry.material.text.get(key);
    return file ? { path: file.path, content: file.content, digest: file.digest, byteLength: file.byteLength } : undefined;
  }
  const file = entry.material.snapshot.files.get(key);
  return file ? { path: file.path, content: file.content, digest: file.digest, byteLength: Buffer.byteLength(file.content) } : undefined;
}

/** Kernel typed failures keep their code and message; no reason-string guessing. */
export function readFailure(error: unknown): WorkspaceResult<never> {
  const reason = messageOf(error), code = kernelCode(error);
  if (code === 'not_found' || code === 'parent_missing') return rejected('not_found', reason);
  if (code === 'invalid_path') return rejected('invalid', reason);
  if (code === 'permission_denied') return rejected('forbidden', reason);
  if (code === 'too_large') return rejected('capacity', reason);
  if (code === 'binary_file' || code === 'invalid_encoding' || code === 'not_file') return rejected('unsupported', reason);
  if (code === 'file_changed') return rejected('source_stale', reason);
  return rejected('unavailable', reason);
}

/** One authorized raw-byte read of the current working tree; no inventory, HEAD or AST. */
export async function readWorkingTreeFile(access: WorkspaceReadAccess, input: Pick<ReadWorkspaceRequest, 'path' | 'maxBytes'>,
  signal: AbortSignal, now: () => string, maxFileBytes: number): Promise<WorkspaceResult<WorkspaceFile>> {
  if (!safeRelative(input.path)) return rejected('invalid', 'path must be a normalized workspace-relative path');
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1) return rejected('invalid', 'maxBytes must be a positive safe integer');
  if (input.maxBytes > maxFileBytes) return rejected('invalid', 'maxBytes exceeds the configured per-file limit');
  signal.throwIfAborted();
  if (!access.authorization.allowsRead(input.path)) return rejected('forbidden', 'path is outside the current read scope');
  let file: { content: string; revision: string; byteLength: number };
  try { file = await access.read(input.path, input.maxBytes); }
  catch (error) {
    if (signal.aborted) return rejected('cancelled', 'request cancelled');
    return readFailure(error);
  }
  signal.throwIfAborted();
  return { status: 'ready', value: { path: input.path, content: file.content, digest: file.revision, sizeBytes: file.byteLength,
    digestBasis: 'raw_bytes', version: { kind: 'working_tree' }, readAt: now() } };
}

/** Frozen read from one capture's stored Map; no disk, inventory, identity or analyzer call. */
export function readCapturedFile(entry: CaptureEntry, input: Pick<ReadWorkspaceRequest, 'path' | 'maxBytes'>, now: () => string): WorkspaceResult<WorkspaceFile> {
  if (!safeRelative(input.path)) return rejected('invalid', 'path must be a normalized workspace-relative path');
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1) return rejected('invalid', 'maxBytes must be a positive safe integer');
  if (!scopeContains(entry.scope, input.path)) return rejected('unsupported', 'path is outside the declared capture scope');
  const file = capturedFile(entry, input.path);
  if (!file) return rejected('not_found', 'this capture has no such file: ' + input.path);
  if (file.byteLength > input.maxBytes) return rejected('capacity', 'captured file exceeds maxBytes; retry with a larger trusted limit');
  return { status: 'ready', value: { path: file.path, content: file.content, digest: file.digest, sizeBytes: file.byteLength,
    digestBasis: entry.scope.digestBasis, version: { kind: 'capture', capture: entry.ref }, readAt: now() } };
}

export type ContentDiff = {
  added: { path: string; digest: string }[];
  deleted: { path: string; digest: string }[];
  modified: { path: string; beforeDigest: string; afterDigest: string }[];
  renamed: { beforePath: string; afterPath: string; digest: string }[];
};

/**
 * The one content-diff algorithm shared by capture `changes` summaries and pair comparisons.
 * `added`/`deleted` keep every path delta (a rename is still an add plus a delete there); a
 * rename pair is only evidence when the same digest occurs exactly once in each COMPLETE
 * manifest, so duplicated content is never guessed into history.
 */
export function diffContent(before: ContentManifest, after: ContentManifest): ContentDiff {
  const added: ContentDiff['added'] = [], deleted: ContentDiff['deleted'] = [], modified: ContentDiff['modified'] = [], renamed: ContentDiff['renamed'] = [];
  for (const [key, file] of after) {
    const prior = before.get(key);
    if (!prior) added.push({ path: file.path, digest: file.digest });
    else if (prior.digest !== file.digest) modified.push({ path: file.path, beforeDigest: prior.digest, afterDigest: file.digest });
  }
  for (const [key, file] of before) if (!after.has(key)) deleted.push({ path: file.path, digest: file.digest });
  const beforeCount = new Map<string, number>(), afterCount = new Map<string, number>();
  const beforePath = new Map<string, string>(), afterPath = new Map<string, string>();
  for (const file of before.values()) { beforeCount.set(file.digest, (beforeCount.get(file.digest) ?? 0) + 1); beforePath.set(file.digest, file.path); }
  for (const file of after.values()) { afterCount.set(file.digest, (afterCount.get(file.digest) ?? 0) + 1); afterPath.set(file.digest, file.path); }
  // Only a genuine delete+add pair can be rename evidence: a path that still exists on both
  // sides (e.g. two files swapping content) is two modified entries, never a rename guess.
  const deletedPaths = new Set(deleted.map(item => item.path));
  const addedPaths = new Set(added.map(item => item.path));
  for (const [digest, count] of beforeCount) {
    if (count !== 1 || afterCount.get(digest) !== 1) continue;
    const from = beforePath.get(digest)!, to = afterPath.get(digest)!;
    if (from !== to && deletedPaths.has(from) && addedPaths.has(to)) renamed.push({ beforePath: from, afterPath: to, digest });
  }
  return { added, deleted, modified, renamed };
}

/** Capture summary keeps the original path-list shape (rename = add + delete). */
export const summaryChanges = (diff: ContentDiff): { added: string[]; modified: string[]; deleted: string[] } =>
  ({ added: diff.added.map(item => item.path), modified: diff.modified.map(item => item.path), deleted: diff.deleted.map(item => item.path) });

const primaryPath = (change: WorkspaceChange) => change.kind === 'renamed' ? change.beforePath : change.path;

export function comparisonChanges(diff: ContentDiff): WorkspaceChange[] {
  const renamedFrom = new Set(diff.renamed.map(item => item.beforePath));
  const renamedTo = new Set(diff.renamed.map(item => item.afterPath));
  const changes: WorkspaceChange[] = [];
  for (const item of diff.modified) changes.push({ kind: 'modified', path: item.path, beforeDigest: item.beforeDigest, afterDigest: item.afterDigest });
  for (const item of diff.added) if (!renamedTo.has(item.path)) changes.push({ kind: 'added', path: item.path, digest: item.digest });
  for (const item of diff.deleted) if (!renamedFrom.has(item.path)) changes.push({ kind: 'deleted', path: item.path, digest: item.digest });
  for (const item of diff.renamed) changes.push({ kind: 'renamed', beforePath: item.beforePath, afterPath: item.afterPath, digest: item.digest, evidence: 'identical_content' });
  return changes.sort((a, b) => primaryPath(a).localeCompare(primaryPath(b)));
}

/** Pure comparison of two frozen captures; this never reads the disk. */
export function compareCapturedFiles(before: CaptureEntry, after: CaptureEntry, limits: { maxQueryResults: number }): WorkspaceResult<CapturedWorkspaceComparison> {
  if (before.material.provider !== after.material.provider) return rejected('unsupported', 'captures use different providers');
  if (before.ref.indexVersion !== after.ref.indexVersion) return rejected('unsupported', 'captures use different index versions');
  if (canonicalJson(before.scope) !== canonicalJson(after.scope)) return rejected('unsupported', 'captures declare different content scopes');
  const beforeManifest = manifestOf(before), afterManifest = manifestOf(after);
  // A pure cardinality gap is a provable lower bound on the change count even before rename
  // evidence: a rename consumes one delete and one add and can only shrink the total, never the
  // gap between the two complete manifests. Reject from the sizes alone, without allocating the
  // full diff; otherwise the existing complete scan still proves digest uniqueness for renames.
  if (Math.abs(beforeManifest.size - afterManifest.size) > limits.maxQueryResults)
    return rejected('capacity', 'comparison exceeds the configured change capacity');
  const changes = comparisonChanges(diffContent(beforeManifest, afterManifest));
  if (changes.length > limits.maxQueryResults) return rejected('capacity', 'comparison exceeds the configured change capacity');
  let bytes = 0;
  for (const change of changes) {
    bytes += Buffer.byteLength(JSON.stringify(change));
    if (bytes > MAX_COMPARISON_BYTES) return rejected('capacity', 'comparison exceeds the bounded serialized size');
  }
  return { status: 'ready', value: { before: before.ref, after: after.ref, scope: before.scope,
    comparison: 'captured_content_only', complete: true, changes } };
}
