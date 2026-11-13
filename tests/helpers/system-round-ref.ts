/**
 * A system round's message ref built from its request id: the mailbox's Host-send id formula (`hostMessageId`) on the
 * fixed `host:plan-round` sender, with the sender's workspace as the record's. It is the real ref only when the
 * recipient line lives in the sender's workspace (every single-workspace world); production finds a sent round
 * through the Host's own send receipt (`readHostSendMessageRef`), never through this.
 */
import type { CoreRejection } from '../../src/contracts/core/results.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import { hostMessageId, SYSTEM_ROUND_ACTOR } from '../../src/contracts/plan-round.js';

/** The system round's message ref; the same request id always yields the same ref. */
export function systemRoundMessageRef(
  scope: { projectId: string; workspaceId: string },
  requestId: string,
): { status: 'ready'; value: SessionMessageRef } | CoreRejection {
  const messageId = hostMessageId(scope, SYSTEM_ROUND_ACTOR, requestId);
  if (messageId.status !== 'ready') return messageId;
  return {
    status: 'ready',
    value: {
      aggregateType: 'SessionMessage',
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
      messageId: messageId.value,
    },
  };
}
