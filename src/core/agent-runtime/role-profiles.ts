/**
 * Slice 3 platform duty profiles (§2.5). A pure configuration table; the real
 * assembler and Host configuration validation consume it. It installs nothing,
 * creates no Session and starts no member.
 */
import type { RoleConfigurationRef } from '../../contracts/core/identity.js';
import type { PlatformDutyV1 } from '../../contracts/graph-context.js';
import type { RoleResponsibilityV1 } from '../../contracts/role-spec.js';

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
    label: 'Executor',
    purpose: 'Execute the assigned task.',
    responsibility: ['execution'],
    behaviorSkillId: 'platform-work',
    template: { kind: 'legacy_template', templateId: 'platform-executor', templateRevision: 's3.1' },
  },
  secretary: {
    duty: 'secretary',
    label: 'Secretary',
    purpose: "Handle the user's bounded request.",
    responsibility: ['human_decision_support', 'planning'],
    behaviorSkillId: 'platform-secretary',
    template: { kind: 'legacy_template', templateId: 'platform-secretary', templateRevision: 's3.1' },
  },
  adviser: {
    duty: 'adviser',
    label: 'Adviser',
    purpose: 'Investigate technical choices and coordinate work.',
    responsibility: ['investigation', 'integration'],
    behaviorSkillId: 'platform-adviser',
    template: { kind: 'legacy_template', templateId: 'platform-adviser', templateRevision: 's3.1' },
  },
  scribe: {
    duty: 'scribe',
    label: 'Scribe',
    purpose: 'Check and consolidate project facts.',
    responsibility: ['fact_consolidation'],
    behaviorSkillId: 'platform-scribe',
    template: { kind: 'legacy_template', templateId: 'platform-scribe', templateRevision: 's3.1' },
  },
  reviewer: {
    duty: 'reviewer',
    label: 'Reviewer',
    purpose: 'Review the assigned work independently.',
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
