/**
 * Group H (slice 2A) QE4 route support.
 *
 * L-fixtures exception 2: QA-14's storage wrapper. It wraps the real records
 * port the S5 fixture built and replaces every read with the same
 * `unavailable` rejection, so the HTTP route must surface the read failure
 * exactly as the read returned it. No dataset and no expectation lives here.
 */
import type { S5Records } from './S5-decision-fixture.js';

/** The literal reason the route must carry back; a route that invented an empty queue could not. */
export const S2A_ROUTE_READ_FAILURE_REASON = 's2a-route-storage-read-failure';

/** The real records port with `readMany` and `lookup` failing like an unavailable Store. */
export function failingReadRecords(records: S5Records): S5Records {
  const fail = async () => ({ status: 'rejected' as const, code: 'unavailable' as const,
    reason: S2A_ROUTE_READ_FAILURE_REASON });
  return { ...records, readMany: fail, lookup: fail };
}
