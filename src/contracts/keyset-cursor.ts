import { isRecord } from './validation/common.js';

/**
 * An ordered lookup's page cursor, bound to one Goal (`null`: the workspace page). `after` is the page's `next`
 * (`src/core/record-store/lookup-ports.ts:64`) as it came. Its `order` is the store's `OrderedLookupValue` (`:45`)
 * written out, because `src/contracts/` imports no `src/core` file (`src/contracts/README.md:6`).
 */
export type KeysetCursorV1 = { v: 1; goalId: string | null; after: { order: string | number; refKey: string } };

/** base64url of the cursor's JSON. */
export function encodeKeysetCursor(goalId: string | null, after: KeysetCursorV1['after']): string {
  const cursor: KeysetCursorV1 = { v: 1, goalId, after };
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** `after` as written, or `null` when `raw` is not base64url JSON, its `v` is not 1, or its `goalId` is not
 *  `goalId`. */
export function decodeKeysetCursor(raw: string, goalId: string | null): KeysetCursorV1['after'] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed['v'] !== 1 || parsed['goalId'] !== goalId) return null;
  return parsed['after'] as KeysetCursorV1['after'];
}
