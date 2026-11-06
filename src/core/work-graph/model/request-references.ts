/**
 * The one rule of a submit's structured `references` (UI1 request-refs,
 * ruling 21): the shape, the lexical path rule, the line-number combination
 * and the three bounds. The request command's pure check, the command
 * fingerprint and the stored-record codec all read this file, so the entry
 * and the replay never disagree. Pure: no store, no clock, no file read.
 *
 * Ruling 24: an out-of-workspace path is the same refusal and the same wording
 * as `files/read` (`invalid`), not `forbidden`; the one lexical rule is
 * `isSafeSourceRelativePath`.
 */
import { isRecord, utf8Bytes } from '../../../contracts/validation/common.js';
import type { RequestReferenceInputV1, RequestReferenceV1 } from '../../../contracts/query-job.js';
import { isSafeSourceRelativePath } from '../../workspace/path-validation.js';

/** A submit names at most this many references. */
export const MAX_REQUEST_REFERENCES = 8;
/** One snapshot is at most 4 KiB of UTF-8. */
export const MAX_REQUEST_REFERENCE_SNAPSHOT_BYTES = 4 * 1024;
/** One submit's snapshots are at most 16 KiB of UTF-8 together. */
export const MAX_REQUEST_REFERENCES_SNAPSHOT_BYTES = 16 * 1024;

const REFERENCE_KEYS = new Set(['path', 'startLine', 'endLine', 'snapshot']);

/**
 * The reference problems of a submit input, in the book's order; `null` when
 * the value keeps the rule. Missing and `null` are the empty list.
 */
export function requestReferencesProblem(refs: unknown): string | null {
  if (refs === undefined || refs === null) return null;
  if (!Array.isArray(refs)) return 'references must be an array';
  if (refs.length > MAX_REQUEST_REFERENCES) {
    return `references must name at most ${String(MAX_REQUEST_REFERENCES)} references`;
  }
  let snapshotBytes = 0;
  for (const [index, entry] of refs.entries()) {
    if (!isRecord(entry)) return `references[${String(index)}] must be an object`;
    if (Object.keys(entry).some((key) => !REFERENCE_KEYS.has(key))) {
      return `references[${String(index)}] has an unknown key`;
    }
    const path = entry['path'];
    if (!isSafeSourceRelativePath(path)) {
      return `references[${String(index)}].path must be a normalized workspace-relative path`;
    }
    const startLine = entry['startLine'] ?? null;
    const endLine = entry['endLine'] ?? null;
    const snapshot = entry['snapshot'] ?? null;
    if (startLine !== null && (!Number.isSafeInteger(startLine) || (startLine as number) < 1)) {
      return `references[${String(index)}].startLine must be a positive safe integer`;
    }
    if (endLine !== null && (!Number.isSafeInteger(endLine) || (endLine as number) < 1)) {
      return `references[${String(index)}].endLine must be a positive safe integer`;
    }
    if (startLine === null && endLine !== null) {
      return `references[${String(index)}].endLine requires startLine`;
    }
    if (startLine !== null && endLine !== null && (endLine as number) < (startLine as number)) {
      return `references[${String(index)}].endLine must not be before startLine`;
    }
    if (snapshot !== null && typeof snapshot !== 'string') {
      return `references[${String(index)}].snapshot must be a string`;
    }
    if (typeof snapshot === 'string') {
      const bytes = utf8Bytes(snapshot);
      if (bytes > MAX_REQUEST_REFERENCE_SNAPSHOT_BYTES) {
        return `references[${String(index)}].snapshot must be at most ${String(MAX_REQUEST_REFERENCE_SNAPSHOT_BYTES / 1024)} KiB of UTF-8`;
      }
      snapshotBytes += bytes;
    }
  }
  if (snapshotBytes > MAX_REQUEST_REFERENCES_SNAPSHOT_BYTES) {
    return `references must carry at most ${String(MAX_REQUEST_REFERENCES_SNAPSHOT_BYTES / 1024)} KiB of snapshots`;
  }
  return null;
}

/**
 * The stored/read shape: every key present, omitted optional values written
 * `null`, and `endLine` defaults to `startLine` for a single-line selection.
 */
export function normalizeRequestReferences(
  refs: RequestReferenceInputV1[] | undefined,
): RequestReferenceV1[] {
  return (refs ?? []).map((reference) => ({
    path: reference.path,
    startLine: reference.startLine ?? null,
    endLine: reference.endLine ?? reference.startLine ?? null,
    snapshot: reference.snapshot ?? null,
  }));
}
