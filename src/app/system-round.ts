/**
 * The Host send wrapper of a system round (PL §5.2.5): build the one mailbox
 * request, read its own committed receipt by identity, then send. The receipt
 * lookup is a saving only — `undetermined` is never a refusal, and a committed
 * receipt answers `skipped` without inventing a `SendMessageResultV1`.
 */
import { systemRoundSendInput } from '../business/workflow/plan-round.js';
import type { CoreCallContext } from '../contracts/core/call-context.js';
import type { SessionRef } from '../contracts/core/identity.js';
import type { CoreRejection } from '../contracts/core/results.js';
import type { SessionMessageRef } from '../contracts/core/session-message.js';
import type { TaskTriple } from '../contracts/dispatch.js';
import type { SystemRoundV1 } from '../contracts/plan-round.js';
import type {
  SendMessageResultV1, SessionMessageCommandPort,
} from '../core/work-graph/model/communication-contracts.js';

export async function sendSystemRound(
  ctx: CoreCallContext,
  deps: { messages: Pick<SessionMessageCommandPort, 'sendMessage' | 'lookupHostSendCommit'> },
  input: {
    round: SystemRoundV1;
    recipient: SessionRef;
    text: string;
    taskRef?: TaskTriple;
    followupOf?: SessionMessageRef;
  },
): Promise<SendMessageResultV1 | { status: 'skipped'; reason: 'already_committed' } | CoreRejection> {
  const request = systemRoundSendInput(input);
  if (request.status !== 'ready') return request;
  const lookup = deps.messages.lookupHostSendCommit;
  if (lookup !== undefined) {
    const commit = await lookup(ctx, {
      requestId: request.value.meta.requestId,
      scope: { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '' },
      toolName: 'send_session_message',
      arguments: request.value.input,
    });
    if (commit.status === 'committed') return { status: 'skipped', reason: 'already_committed' };
  }
  return deps.messages.sendMessage(ctx, request.value);
}
