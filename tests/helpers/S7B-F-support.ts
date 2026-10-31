/**
 * The S7B F rows' shared reads and owner: `ownerFor` builds the real forwarding owner on the world's captured records
 * backend and the real Role/duty reads, `inboxOf` reads a recipient's inbox and `readWait` one wait, all through the
 * public routes. Both F test files use these; `factsOf` stays with the forward file.
 */
import type { SessionRef } from '../../src/contracts/core/identity.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createMessageDutiesFactsAdapter } from '../../src/core/work-graph/configuration/message-duties-adapter.js';
import { createMessageForwardingOwner } from '../../src/core/work-graph/communication/message-forwarding.js';
import type { MessageForwardingPort, SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { SessionWaitV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import { plain } from './AG2b-collaboration-fixture.js';
import type { S6AHostWorld } from './S6A-host-fixture.js';
import { S6A_SCOPE } from './S6A-request-fixture.js';
import { s6b2Backend, type S6B2Captured } from './S6B2-handoff-scene.js';
import { ready } from './S7A-fixture.js';
import { wp2LegacyDuty } from './WP2-duties-fixture.js';

let roleEvent = 0;

/** F's owner on the world's one real records backend and the real Role/duty reads. */
export function ownerFor(world: S6AHostWorld, captured: S6B2Captured): MessageForwardingPort {
  const records = s6b2Backend(captured).records;
  const sessions = world.platform.sessions;
  const roles = createRoleConfigurationService({ records, now: world.clock.now,
    eventId: () => `s7bf-role-${++roleEvent}` });
  return createMessageForwardingOwner({ records, sessions,
    duties: createMessageDutiesFactsAdapter({ roles, sessions, legacyDuty: wp2LegacyDuty }), now: world.clock.now });
}

export async function inboxOf(world: S6AHostWorld, recipient: SessionRef): Promise<SessionMessage[]> {
  return ready<{ items: SessionMessage[] }>(await world.post('messages/inbox',
    plain(S6A_SCOPE, { recipient, page: { limit: 50 } })), `the inbox of ${recipient.sessionId}`).items;
}

export async function readWait(world: S6AHostWorld, messageRef: SessionMessage['ref']): Promise<SessionWaitV1> {
  return ready<SessionWaitV1>(await world.platform.sessionFacts.readWait(world.humanContext(), { messageRef }),
    `the wait of ${messageRef.messageId}`);
}
