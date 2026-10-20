/** WP2 F-D duty helpers: `WP2_DUTIES` (the five platform duties),
 * `wp2LegacyDuty` (the duty whose pinned legacy template matches a role ref
 * exactly) and `wp2RoleContent` (a role spec content, optionally carrying a
 * platform duty).
 */
import type { RoleConfigurationRef } from '../../src/contracts/core/identity.js';
import type { PlatformDutyV1 } from '../../src/contracts/platform-duty.js';
import type { RoleSpecContentV1 } from '../../src/contracts/role-spec.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import { USER_DECISION_TOOL_NAMES } from '../../src/core/agent-runtime/communication-tools.js';

export const WP2_DUTIES: readonly PlatformDutyV1[] = ['secretary', 'adviser', 'scribe', 'executor', 'reviewer'];

/** Exact composition-side legacy template comparison; no prefix inference. */
export function wp2LegacyDuty(role: Extract<RoleConfigurationRef, { kind: 'legacy_template' }>): PlatformDutyV1 | undefined {
  return WP2_DUTIES.find(duty => {
    const template = platformRoleProfile(duty).template;
    return role.templateId === template.templateId && role.templateRevision === template.templateRevision;
  });
}

export function wp2RoleContent(duty?: PlatformDutyV1): RoleSpecContentV1 {
  return {
    schemaVersion: 1, ...(duty === undefined ? {} : { platformDuty: duty }),
    label: 'WP2 member', purpose: 'Read formal duties and send authorized user messages',
    responsibility: ['human_decision_support'],
    requiredMaterials: [{ kind: 'contract', reason: 'Read the accepted Task' }], optionalMaterials: [],
    permissions: { tools: ['read', ...USER_DECISION_TOOL_NAMES], writeScope: 'none' },
    budget: { source: 'task-budget', scope: 'assigned-task' },
    requiredOutputs: [{ kind: 'answer-with-sources', reason: 'Report the actual result' }],
    exit: { success: 'Report the result', stop: 'Stop if unauthorized', handoff: 'Preserve references' },
  };
}
