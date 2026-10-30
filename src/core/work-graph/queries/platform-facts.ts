/**
 * 7B-3 platform facts (SR7 §7.2.2). The ports commit lands only the one read of a create operation's frozen
 * consultation payload, which Q's preparation calls; CS adds the collector and the history types in its wave.
 */
import type { ConsultationCreateReadPort, SessionDirectoryPort } from '../model/session-contracts.js';

/** The ONE read of a create operation's frozen consultation payload; no collection, no re-read of the source. */
export function readConsultationCreate(
  directory: Pick<SessionDirectoryPort, 'getSessionOperation'>,
): ConsultationCreateReadPort {
  return {
    async readConsultationCreate(ctx, input) {
      const read = await directory.getSessionOperation(ctx, input.operationRef);
      if (read.status !== 'ready') return read;
      const action = read.value.action;
      // Never a stand-in payload: a non-consultation create is not this read's target.
      if (action.kind !== 'create' || action.consultation === null) return { status: 'not_found' };
      return { status: 'ready', value: structuredClone(action.consultation) };
    },
  };
}
