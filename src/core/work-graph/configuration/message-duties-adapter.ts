/**
 * Slice 5 §2.6 transitional duties adapter (F20; README I-2).
 *
 * `MessageDutiesFactsPort` is the narrow seam the message owner reads before it
 * decides whether a Session may send a user message / decision request. Until
 * slice 3 supplies the formal facts, this adapter first resolves the existing
 * `RoleBindingFactsPort.resolveRoleBindingFacts`, then applies the
 * composition-injected exact mapping:
 *   - the exact installed `RoleSpecPinV1`, or
 *   - the legacy `templateId` + `templateRevision` binding,
 * to that Session's duties. It never guesses from a template name, Skill text or
 * model JSON; an unmapped new user send is `unsupported` (the caller maps it),
 * and the old Session→Session behaviour is unchanged. The mapping is a
 * composition input, not a release-default authorization.
 *
 * Part 1 declares the factory, the mapping shape and a stub body only.
 */
import type { PlatformDutyV1 } from '../../../contracts/platform-duty.js';
import { roleSpecContentDigest, type RoleSpecPinV1 } from '../../../contracts/role-spec.js';
import type { RoleBindingFactsPort } from '../model/configuration-contracts.js';
import type { MessageDutiesFactsPort } from '../model/decision-contracts.js';

/** The duties fact one mapping entry supplies, without the read guards. */
export type MessageDutiesFactV1 = {
  duties: PlatformDutyV1[];
  readOnlyCopy: boolean;
  independentReview: boolean;
};

/**
 * The exact, composition-injected mapping of §2.6: an installed RoleSpec pin or
 * a legacy template binding decides the duties. A `null` result means the
 * binding has no mapping; the adapter must not fall back to a guess.
 */
export interface MessageDutiesMappingPort {
  dutiesForRoleSpecPin(pin: RoleSpecPinV1): MessageDutiesFactV1 | null;
  dutiesForLegacyTemplate(input: {
    templateId: string; templateRevision: string;
  }): MessageDutiesFactV1 | null;
}

/** The existing role resolver plus the transitional mapping the composition injects. */
export type MessageDutiesAdapterDependencies = {
  roles: RoleBindingFactsPort;
  mapping: MessageDutiesMappingPort;
};

export function createMessageDutiesFactsAdapter(
  deps: MessageDutiesAdapterDependencies,
): MessageDutiesFactsPort {
  return {
    async readMessageDutiesFacts(ctx, input) {
      let resolved: Awaited<ReturnType<RoleBindingFactsPort['resolveRoleBindingFacts']>>;
      try {
        resolved = await deps.roles.resolveRoleBindingFacts(ctx, {
          roleBinding: input.roleBinding,
          declaredPermissions: { tools: [], writeScope: [] },
        });
      } catch {
        return { status: 'rejected', code: 'unavailable', reason: 'the Role binding facts could not be resolved' };
      }
      const guards = resolved.guards;
      let fact: MessageDutiesFactV1 | null = null;
      const result = resolved.result;
      if (result.status === 'ready' && result.value.status === 'resolved') {
        // The installed/stored digest is roleSpecContentDigest(content, roleId,
        // revision), the SAME value a RoleSpecPinV1 carries (§2.6 line 333).
        const resolvedSpec = result.value;
        const pin: RoleSpecPinV1 = {
          ref: resolvedSpec.revision,
          digest: roleSpecContentDigest(resolvedSpec.spec, resolvedSpec.roleId, resolvedSpec.revision.revision),
        };
        fact = deps.mapping.dutiesForRoleSpecPin(pin);
      }
      if (fact === null) {
        fact = deps.mapping.dutiesForLegacyTemplate({
          templateId: input.roleBinding.templateId,
          templateRevision: input.roleBinding.templateRevision,
        });
      }
      if (fact === null) {
        return { status: 'rejected', code: 'unsupported',
          reason: 'no exact duties mapping exists for this Role binding' };
      }
      return { status: 'ready', value: { ...fact, duties: [...fact.duties], guards } };
    },
  };
}
