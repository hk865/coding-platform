import { constants } from 'node:fs';
import { open, lstat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { sha256Hex } from '../../contracts/fingerprint.js';
import { REVIEWER_MATERIAL_PAGE_MAX_BYTES, REVIEWER_SOURCE_MAX_LINES, ReviewerMaterialError } from '../../contracts/reviewer-context.js';
import type { ReviewerSourceRequest, ReviewerSourcePage } from '../../contracts/reviewer-context.js';
import { candidateWorkspaceIncludesPath } from './candidate-workspace-reader.js';

/** Shared with Runtime source tools: exact Candidate exclusions at every path segment. */
export function reviewerSourcePathAllowed(path: string): boolean {
  return typeof path === 'string' && path.length > 0 && !/[\\:\0]/.test(path) &&
    !path.split('/').some(part => !part || part === '.' || part === '..') && candidateWorkspaceIncludesPath(path);
}
const ensure = (value: unknown, message: string, code: ReviewerMaterialError['code'] = 'invalid_reference'): void => { if (!value) throw new ReviewerMaterialError(code, message); };
/** Bounded source text via directory capabilities; symlinks are identities in the pin, never readable targets. */
export async function readReviewerSource(root: string, request: ReviewerSourceRequest): Promise<ReviewerSourcePage> {
  ensure(reviewerSourcePathAllowed(request.path), 'Reviewer source path is outside the pinned readable scope');
  ensure(Number.isSafeInteger(request.startLine) && Number.isSafeInteger(request.endLine) && request.startLine > 0 && request.endLine >= request.startLine && request.endLine - request.startLine < REVIEWER_SOURCE_MAX_LINES, 'Reviewer source line range exceeds capacity');
  const handles: FileHandle[] = [];
  try {
    let directory = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    handles.push(directory);
    const rootIdentity = await directory.stat();
    const parts = request.path.split('/');
    for (const part of parts.slice(0, -1)) {
      directory = await open('/proc/self/fd/' + directory.fd + '/' + part, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      handles.push(directory);
    }
    const file = await open('/proc/self/fd/' + directory.fd + '/' + parts.at(-1), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    handles.push(file);
    const before = await file.stat();
    ensure(before.isFile() && before.size <= 2 * 1024 * 1024, 'Reviewer source is not a bounded regular file');
    const body = await file.readFile();
    const after = await file.stat(), namedRoot = await lstat(root);
    ensure(before.size === body.length && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && rootIdentity.ino === namedRoot.ino && rootIdentity.dev === namedRoot.dev, 'Reviewer source changed while reading', 'stale');
    ensure(!body.includes(0), 'Reviewer source is binary');
    const content = new TextDecoder('utf-8', { fatal: true }).decode(body), digest = sha256Hex(content);
    ensure(request.digest === undefined || request.digest === digest, 'Reviewer source citation digest is stale', 'stale');
    const lines = content.split('\n');
    ensure(request.endLine <= lines.length, 'Reviewer source line range does not exist');
    const excerpt = lines.slice(request.startLine - 1, request.endLine).join('\n');
    ensure(Buffer.byteLength(excerpt, 'utf8') <= REVIEWER_MATERIAL_PAGE_MAX_BYTES, 'Reviewer source excerpt exceeds capacity');
    return { materialId: 'source:' + request.path, path: request.path, digest, startLine: request.startLine, endLine: request.endLine, content: excerpt };
  } catch (error) {
    if (error instanceof ReviewerMaterialError) throw error;
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    throw new ReviewerMaterialError(['ELOOP', 'ENOTDIR', 'ENOENT'].includes(code) ? 'invalid_reference' : 'unavailable', error instanceof Error ? error.message : 'Reviewer source is unavailable');
  } finally { for (const handle of handles.reverse()) await handle.close(); }
}
