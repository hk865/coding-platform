/**
 * Reads the Goal understanding pointer and its ledger watermark for dispatch-basis consistency checks.
 *
 * `views` may read `notes` while `tasks` may not, so the dispatch basis takes this port and never the notes
 * module. One `readMany` of the goal's `CurrentPointer` record supplies both the revision pair and the watermark
 * the basis compares with the plan window and the counter; a missing pointer is `'none'` with an
 * expectedRevision of null, and a read failure or a damaged/mismatched record is the failure - never "no
 * pointer".
 */
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import { messageOf } from '../../../contracts/error-message.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { GoalRecordTransactionPort, RecordBatchRead, StoreResult } from '../../record-store/ports.js';
import type {
  GoalUnderstandingPointerFactsV1, GoalUnderstandingPointerPort,
} from '../model/dispatch-basis-contracts.js';
import { anchorKeyOf } from '../notes/note-anchors.js';
import { currentPointerRefKey, decodeCurrentPointerSnapshot } from '../persistence/note-record-codecs.js';
import { ownerReadStoreFailureToRejection } from '../persistence/read-result-failures.js';

export function createGoalPointerFacts(deps: {
  records: Pick<GoalRecordTransactionPort, 'readMany'>;
}): GoalUnderstandingPointerPort {
  return {
    async readGoalUnderstandingPointer(_ctx: CoreCallContext, input: { goalRef: GoalRef }):
    Promise<ReadResult<GoalUnderstandingPointerFactsV1>> {
      // The caller's ref is copied before the await so the one read cannot observe a later caller mutation.
      const goalRef: GoalRef = { ...input.goalRef };
      const anchorKey = anchorKeyOf({ kind: 'goal', goalId: goalRef.goalId });
      const refKey = currentPointerRefKey({ aggregateType: 'CurrentPointer', projectId: goalRef.projectId, anchorKey });
      let read: StoreResult<RecordBatchRead>;
      try {
        read = await deps.records.readMany([refKey]);
      } catch (error) {
        return rejected('unavailable', `the goal understanding pointer cannot be read: ${messageOf(error)}`);
      }
      if (read.status !== 'ready') return ownerReadStoreFailureToRejection(read);
      const readCursor = read.value.readThrough;
      // The basis resolves every value at this watermark; a missing one is a failure, never an invented cursor.
      if (readCursor === null) {
        return rejected('unavailable', 'the goal understanding pointer read has no read-through cursor');
      }
      const record = read.value.records.find(candidate => candidate.refKey === refKey) ?? null;
      if (record === null) {
        return { status: 'ready', value: {
          anchorKey, refKey, revision: 'none', expectedRevision: null, readCursor } };
      }
      const decoded = decodeCurrentPointerSnapshot(record);
      if (decoded.status !== 'decoded') {
        return rejected('unavailable', `the goal understanding pointer is damaged: ${decoded.reason}`);
      }
      const snapshot = decoded.value;
      if (snapshot.ref.anchorKey !== anchorKey || snapshot.ref.projectId !== goalRef.projectId
        || record.refKey !== refKey) {
        return rejected('unavailable', 'the goal understanding pointer record is not the requested one');
      }
      return { status: 'ready', value: {
        anchorKey, refKey, revision: snapshot.revision, expectedRevision: snapshot.revision, readCursor } };
    },
  };
}
