/**
 * The secretary-only understanding child of the handoff: one trusted internal append under the fixed system principal.
 * The composite closes a superseded command itself; every other secretary step lives in the advance owner.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { CoreRejection } from '../../contracts/core/results.js';
import type { HandoffSavedInputV1 } from '../../core/work-graph/model/session-handoff-contracts.js';
import { HANDOFF_SYSTEM_PRINCIPAL } from '../../core/work-graph/model/request-contracts.js';
import { handoffContextOf } from '../../core/work-graph/sessions/session-handoff-service.js';
import type { RequestRoundPort } from '../../core/work-graph/tasks/request-service.js';

/**
 * The understanding child: one trusted internal append under the fixed system principal, then the next advance reads
 * its receipt. The composite never rebuilds D's identity.
 */
export async function appendUnderstanding(ctx: CoreCallContext, requests: Pick<RequestRoundPort, 'append'>,
  saved: Extract<HandoffSavedInputV1, { kind: 'understanding' }>): Promise<{ ok: true } | CoreRejection> {
  const appended = await requests.append(handoffContextOf(ctx, HANDOFF_SYSTEM_PRINCIPAL),
    { command: saved.command });
  if (appended.status === 'rejected') return appended;
  return { ok: true };
}
