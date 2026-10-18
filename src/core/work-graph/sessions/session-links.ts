/**
 * The complete read of one Session's own work links through the registered
 * per-Session index. Reaching the bounded budget is an explicit `capacity`
 * failure; a card is never built from a silently truncated link set. The
 * observer runs after a ready page and before that page's per-record capacity
 * and decode checks, so a caller's read watermark is the page it consumed.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { SessionWorkLink } from '../../../contracts/core/session.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { RecordLookupPort, RecordLookupRequest } from '../../record-store/lookup-ports.js';
import type { StoreFailure } from '../../record-store/ports.js';
import { sessionStoreFailureToRejection } from '../persistence/read-result-failures.js';
import { SESSION_WORK_LINKS_LOOKUP, decodeSessionWorkLink } from './session-record-codecs.js';

const MAX_LINKS_PER_SESSION = 2000;
const LINK_PAGE_LIMIT = 200;

/** The shared map takes a version-pin `current`; a `unique_conflict` carries a claim slot instead. */
function mapStoreFailure(failure: StoreFailure): CoreRejection {
  return sessionStoreFailureToRejection({
    code: failure.code,
    reason: failure.reason,
    ...(failure.code === 'revision_conflict' ? { current: failure.current } : {}),
  });
}

export async function readSessionWorkLinks(
  lookups: RecordLookupPort,
  projectId: string,
  sessionId: string,
  observe?: (readThrough: CommitCursor | null) => void,
): Promise<{ ok: true; links: SessionWorkLink[] } | { ok: false; rejection: CoreRejection }> {
  const links: SessionWorkLink[] = [];
  let after: string | undefined;
  for (;;) {
    const request: RecordLookupRequest = {
      index: SESSION_WORK_LINKS_LOOKUP,
      values: [projectId, sessionId],
      ...(after === undefined ? {} : { after }),
      limit: LINK_PAGE_LIMIT,
    };
    const page = await lookups.lookup(request);
    if (page.status !== 'ready') return { ok: false, rejection: mapStoreFailure(page) };
    observe?.(page.value.readThrough);
    for (const record of page.value.records) {
      if (links.length >= MAX_LINKS_PER_SESSION) {
        return {
          ok: false,
          rejection: rejected('capacity', `Session ${sessionId} exceeds the bounded work-link read budget`),
        };
      }
      const decoded = decodeSessionWorkLink(record);
      if (decoded.status !== 'decoded') {
        return {
          ok: false,
          rejection: rejected('unavailable', `session work link ${record.refKey} is damaged: ${decoded.reason}`),
        };
      }
      links.push(decoded.value);
    }
    if (page.value.next === null) break;
    after = page.value.next;
  }
  return { ok: true, links };
}
