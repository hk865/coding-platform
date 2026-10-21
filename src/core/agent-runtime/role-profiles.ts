/**
 * Slice 3 platform duty profiles (§2.5). A pure configuration table; the real
 * assembler and Host configuration validation consume it. It installs nothing,
 * creates no Session and starts no member.
 */
import type { RoleConfigurationRef } from '../../contracts/core/identity.js';
import type { PlatformDutyV1 } from '../../contracts/graph-context.js';
import type { RoleResponsibilityV1 } from '../../contracts/role-spec.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../contracts/prompts/platform-pack.generated.js';

export type PlatformRoleProfileV1 = {
  duty: PlatformDutyV1;
  label: string;
  purpose: string;
  responsibility: RoleResponsibilityV1[];
  behaviorSkillId: string;
  template: Extract<RoleConfigurationRef, { kind: 'legacy_template' }>;
};

const PLATFORM_ROLE_PROFILES: Readonly<Record<PlatformDutyV1, PlatformRoleProfileV1>> = {
  executor: {
    duty: 'executor',
    label: PLATFORM_PROMPT_PACK_V1.strings['role.executor.label'],
    purpose: PLATFORM_PROMPT_PACK_V1.strings['role.executor.purpose'],
    responsibility: ['execution'],
    behaviorSkillId: 'platform-work',
    template: { kind: 'legacy_template', templateId: 'platform-executor', templateRevision: 's3.1' },
  },
  secretary: {
    duty: 'secretary',
    label: PLATFORM_PROMPT_PACK_V1.strings['role.secretary.label'],
    purpose: PLATFORM_PROMPT_PACK_V1.strings['role.secretary.purpose'],
    responsibility: ['human_decision_support', 'planning'],
    behaviorSkillId: 'platform-secretary',
    template: { kind: 'legacy_template', templateId: 'platform-secretary', templateRevision: 's3.1' },
  },
  adviser: {
    duty: 'adviser',
    label: PLATFORM_PROMPT_PACK_V1.strings['role.adviser.label'],
    purpose: PLATFORM_PROMPT_PACK_V1.strings['role.adviser.purpose'],
    responsibility: ['investigation', 'integration'],
    behaviorSkillId: 'platform-adviser',
    template: { kind: 'legacy_template', templateId: 'platform-adviser', templateRevision: 's3.1' },
  },
  scribe: {
    duty: 'scribe',
    label: PLATFORM_PROMPT_PACK_V1.strings['role.scribe.label'],
    purpose: PLATFORM_PROMPT_PACK_V1.strings['role.scribe.purpose'],
    responsibility: ['fact_consolidation'],
    behaviorSkillId: 'platform-scribe',
    template: { kind: 'legacy_template', templateId: 'platform-scribe', templateRevision: 's3.1' },
  },
  reviewer: {
    duty: 'reviewer',
    label: PLATFORM_PROMPT_PACK_V1.strings['role.reviewer.label'],
    purpose: PLATFORM_PROMPT_PACK_V1.strings['role.reviewer.purpose'],
    responsibility: ['verification'],
    behaviorSkillId: 'platform-reviewer',
    template: { kind: 'legacy_template', templateId: 'platform-reviewer', templateRevision: 's3.1' },
  },
};

/** Returns a fresh clone so no caller can mutate the shared table. */
export function platformRoleProfile(duty: PlatformDutyV1): PlatformRoleProfileV1 {
  const profile = PLATFORM_ROLE_PROFILES[duty];
  return {
    duty: profile.duty,
    label: profile.label,
    purpose: profile.purpose,
    responsibility: [...profile.responsibility],
    behaviorSkillId: profile.behaviorSkillId,
    template: { ...profile.template },
  };
}
