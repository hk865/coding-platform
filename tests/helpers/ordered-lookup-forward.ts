/**
 * The Query execution owner reads a request round's facts by ordered lookup
 * (`readRequestRounds`), so its `records` dependency carries `lookupOrdered`.
 * A fixture whose records port is typed without it, or is a spy wrapper that
 * predates the ordered port, passes this view instead: every member forwards
 * to the given port at call time (a later spy or patch on it still applies),
 * and `lookupOrdered` forwards to the real backend the port stands for, as
 * `S2A-notices-support.ts` does for the notice source.
 */
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';

export function withBackendOrderedLookup(port: GoalRecordTransactionPort & RecordLookupPort, backend: object):
GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort {
  const ordered = (backend as Partial<RecordOrderedLookupPort>).lookupOrdered;
  if (typeof ordered !== 'function') throw new Error('the real backend has no ordered lookup to forward');
  return {
    readMany: refKeys => port.readMany(refKeys),
    lookupCommit: input => port.lookupCommit(input),
    commit: input => port.commit(input),
    eventAt: cursor => port.eventAt(cursor),
    lookup: request => port.lookup(request),
    lookupOrdered: request => ordered.call(backend, request),
  };
}
