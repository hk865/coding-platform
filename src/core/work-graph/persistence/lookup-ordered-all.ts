/**
 * Book §3.2: the ONE complete ordered-fact reader beside `lookup-all.ts`.
 *
 * It pages one registered `lookupOrdered` window to the very end and returns
 * every candidate record plus the last page's `readThrough` watermark. It is
 * deliberately not a bounded traversal (ruling 7.6 keeps those at the caller):
 * a store failure propagates unchanged, so a failed read is never reported as
 * an empty complete set.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type {
  OrderedLookupRequest, RecordOrderedLookupPort,
} from '../../record-store/lookup-ports.js';
import type { EncodedRecord, StoreResult } from '../../record-store/ports.js';
import { REQUEST_PAGE_SIZE } from '../model/request-contracts.js';

export async function readAllOrdered(
  store: RecordOrderedLookupPort,
  request: Omit<OrderedLookupRequest, 'after' | 'limit'>,
): Promise<StoreResult<{ records: EncodedRecord[]; readThrough: CommitCursor | null }>> {
  const records: EncodedRecord[] = [];
  let after: OrderedLookupRequest['after'];
  let readThrough: CommitCursor | null = null;
  for (;;) {
    const page = await store.lookupOrdered({
      ...request,
      ...(after === undefined ? {} : { after }),
      // Ruling 7.8's one ordered page size (200), shared with the queue handlers.
      limit: REQUEST_PAGE_SIZE,
    });
    if (page.status !== 'ready') return page;
    readThrough = page.value.readThrough;
    for (const record of page.value.records) records.push(record);
    const next = page.value.next;
    if (next === null) break;
    after = next;
  }
  return { status: 'ready', value: { records, readThrough } };
}
