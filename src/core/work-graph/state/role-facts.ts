/**
 * The one constructor of a Session's stored role facts. The creator and the opened-by value are decided by
 * `roleFactsOf` in `contracts/role-lines.ts`; this file only turns that decision into the record, so no writer
 * outside `state/` assigns a protected field of `SessionRoleFactsV1`.
 */
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { CreatorRefV1, SessionOpenedByV1, SessionRoleFactsV1 } from '../../../contracts/role-lines.js';

export function sessionRoleFactsRecord(input: {
  session: SessionRecord;
  decided: { creator: CreatorRefV1; openedBy: SessionOpenedByV1 };
  originOperation: OperationRef;
  /** L27: the stored name (the create operation's `creation.name`); `null` writes none. */
  name: string | null;
}): SessionRoleFactsV1 {
  const session = input.session.ref;
  return {
    ref: sessionRoleFactsRef(session),
    revision: 1,
    sessionRef: { projectId: session.projectId, sessionId: session.sessionId },
    name: input.name,
    creator: input.decided.creator,
    openedBy: input.decided.openedBy,
    originOperation: input.originOperation,
  };
}

/** The one ref of a Session's stored role facts: the record's key is this ref's canonical JSON. */
export function sessionRoleFactsRef(session: SessionRef): SessionRoleFactsV1['ref'] {
  return { aggregateType: 'SessionRoleFacts', projectId: session.projectId, sessionId: session.sessionId };
}
