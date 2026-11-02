/**
 * The one constructor of a Session's stored role facts. The creator and the opened-by value are decided by
 * `roleFactsOf` in `contracts/role-lines.ts`; this file only turns that decision into the record, so no writer
 * outside `state/` assigns a protected field of `SessionRoleFactsV1`.
 */
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { CreatorRefV1, SessionOpenedByV1, SessionRoleFactsV1 } from '../../../contracts/role-lines.js';

export function sessionRoleFactsRecord(input: {
  session: SessionRecord;
  decided: { creator: CreatorRefV1; openedBy: SessionOpenedByV1 };
  originOperation: OperationRef;
}): SessionRoleFactsV1 {
  const session = input.session.ref;
  return {
    ref: { aggregateType: 'SessionRoleFacts', projectId: session.projectId, sessionId: session.sessionId },
    revision: 1,
    sessionRef: { projectId: session.projectId, sessionId: session.sessionId },
    name: null,
    creator: input.decided.creator,
    openedBy: input.decided.openedBy,
    originOperation: input.originOperation,
  };
}
