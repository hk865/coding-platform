/**
 * The one F1 duty resolver assembly over a real Host directory: adviser/secretary/scribe by the Session's fixed duty,
 * the smallest active `sessionId`, else null. `configuration` supplies the Slice-1 executor fallback (a complete role
 * ref equal to the Host Work binding's `sessionRole`); every other duty comes from the Session's own role facts.
 */
import { createSessionDutyResolver } from '../../src/composition/session-duty.js';
import { createDutyRecipient } from '../../src/core/work-graph/sessions/duty-recipient.js';
import { S6A_SCOPE, S6A_WORK_ROLE, S6A_WORK_ROLE_BINDING, type S6ARequestWorld } from './S6A-request-fixture.js';

const WORKFLOW = {
  consumerId: 'ag2b-consumer',
  bindings: [{ workspace: S6A_SCOPE, sessionRole: S6A_WORK_ROLE, roleBinding: S6A_WORK_ROLE_BINDING,
    budget: { tokenBudget: 1_000_000, deadline: null } }],
};

export function dutyOf(world: S6ARequestWorld) {
  const duties = createSessionDutyResolver({
    readRoleSpec: (...args) => world.platform.roles.readRoleSpec(...args), configuration: WORKFLOW });
  return createDutyRecipient({
    findSessions: (ctx, input) => world.platform.sessions.findSessions(ctx, input),
    dutyOfRole: (ctx, role) => duties(role, ctx),
  });
}
