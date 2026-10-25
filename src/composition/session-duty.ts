/**
 * Wiring package 1, I-1 (spec §2.4, §4.1, L5/L6): the trusted Session duty
 * resolution seam. It reads only the Session's own fixed role facts - a
 * `role_spec` Session reads its pinned RoleSpec content's `platformDuty`, a
 * `legacy_template` Session is recognized by its exact platform template - and
 * derives the effective duty with the Slice-3 `effectivePlatformDuty` rule.
 * Either side alone may decide; both absent never defaults to `executor` but
 * needs the role to equal a Host Work binding's `sessionRole` (the Slice-1
 * rule). Any read failure, missing `ctx` or throw resolves to `'unknown'`; the
 * seam never rejects and never writes.
 */
import type { RoleConfigurationRef } from '../contracts/core/identity.js';
import { PLATFORM_DUTIES, type PlatformDutyV1 } from '../contracts/platform-duty.js';
import type { ReadResult } from '../contracts/core/results.js';
import { canonicalJson, type JsonValue } from '../contracts/fingerprint.js';
import type { RoleConfigurationPort } from '../core/work-graph/model/configuration-contracts.js';
import { effectivePlatformDuty } from '../core/work-graph/state/context-input.js';
import { platformRoleProfile } from '../core/agent-runtime/role-profiles.js';
import type { SessionDutyResolver, WorkflowHostConfiguration } from '../business/workflow/ports.js';

export type SessionDutyResolverDependencies = {
  readRoleSpec: RoleConfigurationPort['readRoleSpec'];
  configuration: WorkflowHostConfiguration | undefined;
};

function known(value: PlatformDutyV1 | 'unknown'): ReadResult<PlatformDutyV1 | 'unknown'> {
  return { status: 'ready', value };
}

/**
 * The duty a legacy template fixes when the ref names one of the five exact
 * `platformRoleProfile` templates (both `templateId` and `templateRevision`);
 * otherwise none. A legacy ref is never read through `readRoleSpec`.
 */
function legacyTemplateDutyOf(role: Extract<RoleConfigurationRef, { kind: 'legacy_template' }>): PlatformDutyV1 | undefined {
  // The five versioned platform profile templates `platform-<duty>@s3.1`.
  return PLATFORM_DUTIES.find((duty) => {
    const template = platformRoleProfile(duty).template;
    return template.templateId === role.templateId && template.templateRevision === role.templateRevision;
  });
}

/** Whether the role's COMPLETE canonical ref equals a Host Work binding's `sessionRole`. */
function namesAnExecutorRole(configuration: WorkflowHostConfiguration | undefined, role: RoleConfigurationRef): boolean {
  let key: string;
  try { key = canonicalJson(role as unknown as JsonValue); } catch { return false; }
  for (const binding of configuration?.bindings ?? []) {
    try {
      if (canonicalJson(binding.sessionRole as unknown as JsonValue) === key) return true;
    } catch { /* an unencodable binding role contributes no executor mapping */ }
  }
  return false;
}

export function createSessionDutyResolver(deps: SessionDutyResolverDependencies): SessionDutyResolver {
  return async (role, ctx) => {
    try {
      // §4.1 step 1: the pinned RoleSpec body's own duty. A missing ctx or any
      // failed/thrown read is `unknown`; it is never inferred from the binding.
      let roleDuty: PlatformDutyV1 | undefined;
      if (role.kind === 'role_spec') {
        if (ctx === undefined) return known('unknown');
        let read: Awaited<ReturnType<RoleConfigurationPort['readRoleSpec']>>;
        try {
          read = await deps.readRoleSpec(ctx, { pin: role.pin });
        } catch {
          return known('unknown');
        }
        if (read.status !== 'ready') return known('unknown');
        roleDuty = read.value.content.platformDuty;
      }

      // §4.1 step 2: a legacy ref fixes a duty only through one of the five
      // exact platform templates.
      const templateDuty = role.kind === 'legacy_template' ? legacyTemplateDutyOf(role) : undefined;

      // §4.1 step 3: both sides absent means no evidence of a platform duty, so
      // fall back to the Slice-1 rule (a complete ref equal to a Host Work
      // binding's `sessionRole`) and NEVER to `effectivePlatformDuty`'s default
      // `executor`.
      if (roleDuty === undefined && templateDuty === undefined) {
        return known(namesAnExecutorRole(deps.configuration, role) ? 'executor' : 'unknown');
      }

      // §4.1 step 4: one side may decide; a conflicting pair is `unknown`.
      const effective = effectivePlatformDuty({ roleDuty, hostDuty: templateDuty });
      return effective.status === 'ready' ? known(effective.value) : known('unknown');
    } catch {
      return known('unknown');
    }
  };
}
