/**
 * §4.1 line 772: the ONE stable-window index pager.
 *
 * It lives in `persistence` because that is the lowest layer both `views/` and
 * `tasks/` may import (the `tasks -> views` edge is forbidden;
 * `read-result-failures.ts` is the precedent). One registered index's complete
 * candidate set is paged by `after` to the very end (the shared reads
 * have no whole-window cap). §4.1 line 772: a page that observed a later commit
 * than the window's first page makes the window inconsistent; the whole read is
 * retried (<=4) and a persistently changing index is reported `unavailable`,
 * never stamped with a mixed watermark. `truncated` stays in the type and
 * is always `false`: the read reaches the end, so a complete count is always
 * safe to report.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { EncodedRecord } from '../../record-store/ports.js';

export type LookupBatch<T> = { items: T[]; watermark: CommitCursor | null; truncated: boolean };

/** §4.1 line 772: a source lookup window that keeps changing is retried at most 4 times. */
const WINDOW_MAX_ATTEMPTS = 4;

/** §4.1 line 772: one §4.1 lookup page is at most 200 records. */
const LOOKUP_PAGE_LIMIT = 200;

/**
 * One registered index's complete candidate set, paged by `after` to the very
 * end. A read failure is thrown as the store's rejection; a persistently moving
 * window is thrown as `unavailable`.
 */
export async function lookupAll<T = EncodedRecord>(
  records: Pick<RecordLookupPort, 'lookup'>,
  index: string,
  values: readonly (string | number | boolean | null)[],
): Promise<LookupBatch<T>> {
  for (let attempt = 0; attempt < WINDOW_MAX_ATTEMPTS; attempt += 1) {
    const items: T[] = [];
    let first: CommitCursor | null | undefined;
    let stable = true;
    let after: string | undefined;
    for (;;) {
      const page = await records.lookup({ index, values, limit: LOOKUP_PAGE_LIMIT,
        ...(after === undefined ? {} : { after }) });
      if (page.status !== 'ready') throw page;
      const pageWatermark = page.value.readThrough;
      if (first === undefined) first = pageWatermark;
      else if (first !== pageWatermark) stable = false;
      for (const record of page.value.records) items.push(record as unknown as T);
      const next = page.value.next;
      if (next === null || next === undefined) break;
      after = next;
    }
    if (stable) return { items, watermark: first ?? null, truncated: false };
  }
  throw { status: 'rejected', code: 'unavailable',
    reason: `lookup index ${index} did not yield one stable read window within ${String(WINDOW_MAX_ATTEMPTS)} attempts` };
}
