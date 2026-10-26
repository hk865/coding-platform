/**
 * The entered confirmation's brief consumer: it reads the operation naming the brief, checks that it still holds a
 * ready, unconsumed brief, and asks the state constructor for the consumption transition. It encodes the record and
 * returns it with the guard D merges into the same commit; it writes no event and no record, so a failed entry or a
 * retry leaves the brief for the next attempt.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import { messageOf } from '../../../contracts/error-message.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { HandoffBriefPort } from '../model/session-handoff-contracts.js';
import type { SessionDirectoryPort, SessionOperationRecordOf } from '../model/session-contracts.js';
import type { HandoffActionV1 } from '../model/session-operation-arms.js';
import { encodeSessionOperationRecord } from './session-record-codecs.js';
import { consumeHandoffBrief } from '../state/session-handoff.js';

export type HandoffBriefDependencies = {
  /** The operation's trusted read; the planner never rebuilds the record from the caller's facts. */
  operations: Pick<SessionDirectoryPort, 'getSessionOperation'>;
};

/** D's `HandoffBriefPort`: the record and guard to merge, or a rejection; never an empty brief. */
export function createHandoffBriefPort(deps: HandoffBriefDependencies): HandoffBriefPort {
  return {
    async consume(ctx: CoreCallContext, input) {
      let read;
      try {
        read = await deps.operations.getSessionOperation(ctx, input.operation);
      } catch (error) {
        return rejected('unavailable', `the brief operation could not be read: ${messageOf(error)}`);
      }
      if (read.status === 'not_found') {
        return rejected('invalid', 'the brief operation is not in this workspace');
      }
      if (read.status !== 'ready') {
        return read.status === 'rejected' ? read : rejected('unavailable', 'the brief operation read is not ready');
      }
      const operation = read.value;
      if (operation.action.kind !== 'handoff') {
        return rejected('invalid', 'the brief reference does not name a handoff operation');
      }
      try {
        const next = consumeHandoffBrief(operation as SessionOperationRecordOf<HandoffActionV1>, input.queryRun, input.at);
        return { status: 'ready', value: { record: encodeSessionOperationRecord(next.record), guard: next.guard } };
      } catch (error) {
        return rejected('invalid', messageOf(error));
      }
    },
  };
}
