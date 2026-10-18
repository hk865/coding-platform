/**
 * Wiring package 2, I-2 (spec §2.1, §4.1, L1–L3): the formal message-duties
 * facts adapter. It keeps the original `RoleBindingFactsPort` resolution and its
 * guards, reads the Session's own fixed role (a `role_spec` pin or one of the
 * five exact legacy platform templates) and derives the single effective duty
 * with the pure `effectivePlatformDuty` rule. A read failure is never turned
 * into a default duty; only a genuinely absent duty pair falls back to
 * `executor`.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { RoleConfigurationRef } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import { canonicalJson } from '../../../contracts/fingerprint.js';
import type { PlatformDutyV1 } from '../../../contracts/platform-duty.js';
import { roleSpecContentDigest, roleSpecRevisionFromBinding,
  type RoleSpecRevisionSnapshot } from '../../../contracts/role-spec.js';
import type { RecordGuard } from '../../record-store/ports.js';
import type { RoleBindingFactsPort, RoleConfigurationPort } from '../model/configuration-contracts.js';
import type { MessageDutiesFactsPort } from '../model/decision-contracts.js';
import type { SessionCard, SessionDirectoryPort } from '../model/session-contracts.js';
import { effectivePlatformDuty } from '../state/context-input.js';

/** §2.1: the fixed read-only facts plus the composition-injected legacy matcher. */
export type MessageDutiesAdapterDependencies = {
  roles: RoleBindingFactsPort & Pick<RoleConfigurationPort, 'readRoleSpec'>;
  sessions: Pick<SessionDirectoryPort, 'readSession'>;
  legacyDuty: (role: Extract<RoleConfigurationRef, { kind: 'legacy_template' }>)
    => PlatformDutyV1 | undefined;
};

/** Same rule as the owner-side `mergeGuards`: one entry per refKey, conflicts rejected. */
function mergeDutyGuards(guards: readonly RecordGuard[]):
  { ok: true; guards: RecordGuard[] } | { ok: false; rejection: CoreRejection } {
  const byKey = new Map<string, number | null>();
  for (const guard of guards) {
    if (guard.refKey === '') return { ok: false, rejection: rejected('invalid', 'a record guard has an empty refKey') };
    const existing = byKey.get(guard.refKey);
    if (existing === undefined) { byKey.set(guard.refKey, guard.expectedRevision); continue; }
    if (existing !== guard.expectedRevision) {
      return { ok: false, rejection: rejected('revision_conflict', `conflicting guards for ${guard.refKey}`) };
    }
  }
  return { ok: true, guards: [...byKey].map(([refKey, expectedRevision]) => ({ refKey, expectedRevision })) };
}

export function createMessageDutiesFactsAdapter(
  deps: MessageDutiesAdapterDependencies,
): MessageDutiesFactsPort {
  return {
    async readMessageDutiesFacts(ctx: CoreCallContext, input): Promise<ReadResult<{
      duties: PlatformDutyV1[]; readOnlyCopy: boolean; independentReview: boolean;
      guards: readonly RecordGuard[];
    }>> {
      // §4.1 step 1: fixed copies, scope/signal checked before any dependency call.
      const sessionRef = structuredClone(input.sessionRef);
      const roleBinding = structuredClone(input.roleBinding);
      if (ctx.signal.aborted) return rejected('cancelled', 'the message duties read was cancelled');
      if (ctx.projectId !== sessionRef.projectId) {
        return rejected('forbidden', 'the requested Session belongs to another project');
      }
      if (ctx.workspaceId === undefined) {
        return rejected('forbidden', 'a message duties read requires a bound workspace scope');
      }
      if (ctx.principal.kind !== 'host') {
        return rejected('forbidden', 'message duties are only read on the trusted Host boundary');
      }

      // §4.1 step 2 + L2: the original resolver is the only role-fact source.
      let resolver: Awaited<ReturnType<RoleBindingFactsPort['resolveRoleBindingFacts']>>;
      try {
        resolver = await deps.roles.resolveRoleBindingFacts(ctx, {
          roleBinding, declaredPermissions: { tools: [], writeScope: [] },
        });
      } catch {
        return rejected('unavailable', 'the Role binding facts could not be resolved');
      }
      const resolution = resolver.result;
      if (resolution.status === 'rejected') return resolution;
      if (resolution.status === 'not_found') return resolution;
      if (resolution.status === 'not_ready') return resolution;
      if (resolution.value.status === 'inadmissible') {
        return rejected('forbidden', 'the Role binding is inadmissible for message duties');
      }
      const resolved = resolution.value.status === 'resolved' ? resolution.value : null;

      // §4.1 step 3: the Session's own fixed role is the identity source.
      let read: ReadResult<SessionCard>;
      try {
        read = await deps.sessions.readSession(ctx, sessionRef);
      } catch {
        return rejected('unavailable', 'the Session could not be read for message duties');
      }
      if (read.status === 'rejected') return read;
      if (read.status === 'not_found') return read;
      if (read.status === 'not_ready') return read;
      const record = read.value.record;
      if (record.ref.projectId !== sessionRef.projectId || record.ref.sessionId !== sessionRef.sessionId) {
        return rejected('forbidden', 'the stored Session identity does not match the requested Session');
      }
      if (record.workspaceId !== ctx.workspaceId) {
        return rejected('forbidden', 'the Session belongs to another workspace');
      }

      const sessionRole = record.role;
      let roleDuty: PlatformDutyV1 | undefined;
      let templateDuty: PlatformDutyV1 | undefined;
      if (sessionRole.kind === 'role_spec') {
        const pin = sessionRole.pin;
        if (roleBinding.templateId !== pin.ref.roleId
          || roleSpecRevisionFromBinding(roleBinding.templateRevision) !== pin.ref.revision) {
          return rejected('forbidden', 'the Role binding does not name the Session fixed role specification');
        }
        let specRead: ReadResult<RoleSpecRevisionSnapshot>;
        try {
          specRead = await deps.roles.readRoleSpec(ctx, { pin });
        } catch {
          return rejected('unavailable', 'the Session fixed role specification could not be read');
        }
        if (specRead.status === 'rejected') return specRead;
        if (specRead.status === 'not_found') return specRead;
        if (specRead.status === 'not_ready') return specRead;
        roleDuty = specRead.value.content.platformDuty;
        if (resolved !== null) {
          const ref = pin.ref;
          const digest = roleSpecContentDigest(resolved.spec, resolved.roleId, resolved.revision.revision);
          if (resolved.roleId !== ref.roleId || resolved.revision.roleId !== ref.roleId || digest !== pin.digest
            || resolved.revision.aggregateType !== ref.aggregateType
            || resolved.revision.projectId !== ref.projectId || resolved.revision.revision !== ref.revision) {
            return rejected('forbidden', 'the resolved Role facts disagree with the Session fixed pin');
          }
        }
      } else {
        if (roleBinding.templateId !== sessionRole.templateId
          || roleBinding.templateRevision !== sessionRole.templateRevision) {
          return rejected('forbidden', 'the Role binding does not name the Session fixed legacy template');
        }
        templateDuty = deps.legacyDuty(sessionRole);
        if (resolved !== null) roleDuty = resolved.spec.platformDuty;
      }

      const effective = effectivePlatformDuty({ roleDuty, hostDuty: templateDuty });
      if (effective.status === 'rejected') return effective;
      if (effective.status === 'not_found') return effective;
      if (effective.status === 'not_ready') return effective;

      const merged = mergeDutyGuards([
        ...resolver.guards,
        { refKey: canonicalJson(record.ref), expectedRevision: record.revision },
      ]);
      if (!merged.ok) return merged.rejection;

      return { status: 'ready', value: {
        duties: [effective.value],
        readOnlyCopy: record.provenance?.kind === 'readonly_copy',
        independentReview: false,
        guards: merged.guards,
      } };
    },
  };
}
