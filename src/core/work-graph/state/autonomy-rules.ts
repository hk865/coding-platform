/**
 * L37 autonomy rules, the pure half: the one validation of a rule, the one match of an action against the project's
 * rules, and the next rule-set revision. The records, their codecs and the closed `RuleActionV1` set are the
 * contracts' (`contracts/role-lines.ts`, `contracts/goal-decisions.ts`); the three person-only commands are
 * `tasks/autonomy-rule-service.ts`. Nothing here reads a clock, a store or an id.
 */
import { canonicalKey } from '../../../contracts/fingerprint.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import type { AdoptedArchitecture } from '../../../contracts/architecture-catalog.js';
import type { DecisionActionV1, RuleActionV1 } from '../../../contracts/goal-decisions.js';
import { RULE_ACTIONS } from '../../../contracts/goal-decisions.js';
import type { RoleLineDutyV1, RoleLimitsNumbersV1, RoleScopeV1 } from '../../../contracts/role-lines.js';
import type { AutonomyRuleSetV1, AutonomyRuleV1 } from '../../../contracts/role-lines.js';
import { isRecord } from '../../../contracts/validation/common.js';
import { regionContains } from './role-scope.js';

export type AutonomyRuleLimitsV1 = { open: Partial<RoleLimitsNumbersV1> };

/**
 * Non-empty actions, all `RuleActionV1`; non-empty scope; per-duty limit at most the project's open cap; `expiresAt`
 * an ISO time or null. A route can send any JSON here, so the list and object shapes are checked before they are read.
 */
export function validateAutonomyRule(input: {
  actions: readonly DecisionActionV1[]; scope: readonly RoleScopeV1[];
  limits: AutonomyRuleLimitsV1; expiresAt: string | null; projectOpen: RoleLimitsNumbersV1;
}): CoreRejection | null {
  if (!Array.isArray(input.actions) || input.actions.length === 0
    || input.actions.some((action) => !RULE_ACTIONS.includes(action as RuleActionV1))) {
    return rejected('invalid', 'rule_action_fixed: actions must be a non-empty list of RuleActionV1');
  }
  if (!Array.isArray(input.scope) || input.scope.length === 0) {
    return rejected('invalid', 'a rule scope must be non-empty');
  }
  if (!isRecord(input.limits) || !isRecord(input.limits.open)) {
    return rejected('invalid', 'rule limits must be an object with an open object');
  }
  for (const [duty, limit] of Object.entries(input.limits.open) as [RoleLineDutyV1, number][]) {
    if (limit > input.projectOpen[duty]) {
      return rejected('invalid',
        `rule_limit_over_cap: ${duty} ${limit} exceeds the project open cap ${input.projectOpen[duty]}`);
    }
  }
  if (input.expiresAt !== null && Number.isNaN(Date.parse(input.expiresAt))) {
    return rejected('invalid', 'expiresAt must be an ISO time or null');
  }
  return null;
}

/** The one scope containment for a **responsibility** object; project covers all, goal is equality, region is
 *  the effective region's `regionContains`. Never called with `delegation.writeScope` (that is a path list). */
function scopeCovers(scopes: readonly RoleScopeV1[], object: RoleScopeV1,
  catalog: AdoptedArchitecture | null): boolean {
  return scopes.some((scope) => {
    if (scope.kind === 'project') return true;
    if (object.kind === 'project') return false;
    if (scope.kind === 'goal' && object.kind === 'goal') {
      return canonicalKey(scope.goalRef) === canonicalKey(object.goalRef);
    }
    if (scope.kind === 'region' && object.kind === 'region') {
      return scope.moduleRef.projectId === object.moduleRef.projectId
        && regionContains(catalog, scope.moduleRef.moduleId, object.moduleRef.moduleId);
    }
    return false;
  });
}

/** Active, unexpired, action in `actions`, every responsibility object in the rule's scope and inside the caller's
 *  responsibility ceiling, the tool, the create-member authorization, and the after-action quota. The delegation
 *  keeps its real shape (`TaskEnvelopeV1.permissions` / `MemberDelegationCeilingV1`: `writeScope` is a path list,
 *  `policyRevision` a string); it is not a `RoleScope` list and is never fed to `scopeCovers`. `newReservations` is 0
 *  when a line already holds its seat. */
export function matchAutonomyRule(input: {
  action: DecisionActionV1; tool: string | null; objects: readonly RoleScopeV1[];
  rules: readonly AutonomyRuleV1[]; now: string; catalog: AdoptedArchitecture | null;
  /** `ceiling` is the trusted Work caller's responsibility scope, or null when the source has none (secretary Query). */
  delegation: { revision: number; tools: readonly string[]; writeScope: readonly string[];
    policyRevision: string } | null;
  roleCeiling: readonly RoleScopeV1[] | null;
  /** `true` only from the trusted source: a Work caller's `permissions.createMember`, or the secretary Query's
   *  call-kind registration (`R/query-preparation.ts` secretary block). A Query's empty `writeScope` never grants it. */
  createMemberAuthorized: boolean;
  duty: RoleLineDutyV1; counts: { holders: number; reservations: number; open: number };
  newReservations: number;
}): AutonomyRuleV1 | null {
  for (const rule of input.rules) {
    if (rule.state !== 'active') continue;
    if (rule.expiresAt !== null && !(Date.parse(input.now) < Date.parse(rule.expiresAt))) continue;
    if (!rule.actions.includes(input.action as RuleActionV1)) continue;
    if (!input.objects.every((object) => scopeCovers(rule.scope, object, input.catalog))) continue;
    if (input.roleCeiling !== null
      && !input.objects.every((object) => scopeCovers(input.roleCeiling!, object, input.catalog))) continue;
    if (input.delegation !== null && input.tool !== null
      && !input.delegation.tools.includes(input.tool)) continue;
    if (input.action === 'create_member' && !input.createMemberAuthorized) continue;
    const limit = rule.limits?.open?.[input.duty];
    const after = input.counts.holders + input.counts.reservations + input.newReservations;
    if (limit !== undefined && after > limit) continue;
    return rule;
  }
  return null;
}

export function nextAutonomyRuleSetRevision(current: AutonomyRuleSetV1 | null): number {
  return current === null ? 1 : current.revision + 1;
}
