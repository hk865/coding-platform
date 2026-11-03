// pure; the frozen reanchor-plan seam
import type { SessionRecord, SessionWorkLink, PendingSessionWorkLink } from '../../../contracts/core/session.js';
import type { ProjectScope, SessionWorkLinkRef, VersionPin, WorkLinkTarget } from '../../../contracts/core/identity.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type { ActorRef } from '../../../contracts/command-event.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import type { AdoptedArchitecture } from '../../../contracts/architecture-catalog.js';
import { canonicalKey } from '../../../contracts/fingerprint.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { RoleLineBindingIntentV1, RoleLineDutyV1, RoleScopeClaimChangeV1, RoleScopeV1 } from '../../../contracts/role-lines.js';
import { roleScopeClaimKey, roleScopeOfTarget } from '../../../contracts/role-lines.js';
import { foldRoleScopeClaimChanges, responsibilityClaimChanges } from './role-scope.js';
import { destinationEligible, openDestination } from './session-responsibility.js';
export type ReanchorMoveV1 = { duty: RoleLineDutyV1; source: SessionWorkLinkRef;
  destinations: readonly { link: SessionWorkLinkRef; target: WorkLinkTarget }[] };          // [] = close only
export type ReanchorEventMaterialV1 = { closed: SessionWorkLinkRef; opened: SessionWorkLinkRef | null;
  openedBound: 'since' | null };
export type ReanchorPlanV1 = { sessions: readonly SessionRecord[]; links: readonly { link: SessionWorkLinkRef;
  next: PendingSessionWorkLink | null }[]; claimChanges: readonly RoleScopeClaimChangeV1[];  // already folded
  bindings: readonly RoleLineBindingIntentV1[]; events: readonly ReanchorEventMaterialV1[] };
export type ReanchorGoalFactsV1 = { state: 'present'; ref: GoalRef; snapshot: GoalSnapshot; version: VersionPin }
  | { state: 'absent'; ref: GoalRef };
export type ReanchorCatalogFactsV1 = { state: 'present'; revision: number; catalog: AdoptedArchitecture }
  | { state: 'none'; revision: number };
export type ReanchorFactsV1 = { sessions: ReadonlyMap<string, SessionRecord>;            // by sessionId
  links: ReadonlyMap<string, SessionWorkLink>;         // by canonicalKey(link.ref) = sessionWorkLinkRefKey
  goals: ReadonlyMap<string, ReanchorGoalFactsV1>;     // by goalId
  catalog: ReanchorCatalogFactsV1 };
export type ReanchorRefusalV1 = CoreRejection;                                              // the one refusal shape
export type ReanchorReasonV1 = 'human_scope_change' | 'goal_continued' | 'architecture_revision'
  | 'split' | 'reuse' | 'standby' | 'queue_assign' | 'project_scope_moved';
export const REANCHOR_REASONS: readonly ReanchorReasonV1[] = ['human_scope_change', 'goal_continued',
  'architecture_revision', 'split', 'reuse', 'standby', 'queue_assign', 'project_scope_moved'];

/** A project authorization covers this project's Goal and region targets; a foreign target is refused earlier. */
function authorizationCovers(scope: readonly RoleScopeV1[], target: RoleScopeV1, projectRef: ProjectScope): boolean {
  for (const entry of scope) {
    if (canonicalKey(entry) === canonicalKey(target)) return true;
    if (entry.kind === 'project' && (target.kind === 'goal' || target.kind === 'region')) {
      const projectId = target.kind === 'goal' ? target.goalRef.projectId : target.moduleRef.projectId;
      if (projectId === projectRef.projectId) return true;
    }
  }
  return false;
}

export function planReanchor(input: { projectRef: ProjectScope; duty: RoleLineDutyV1;
  moves: readonly ReanchorMoveV1[]; facts: ReanchorFactsV1;
  authorization: { actor: ActorRef; scope: readonly RoleScopeV1[] };                       // actor: the owner's
  proposed: { goal?: { ref: GoalRef; snapshot: GoalSnapshot; version: VersionPin };
    catalog?: ReanchorCatalogFactsV1 } | null }):                                         // the owner's pins
  { ok: true; plan: ReanchorPlanV1 } | { ok: false; refusals: readonly ReanchorRefusalV1[] } {
  const { projectRef, duty, moves, facts } = input;
  const refusals: ReanchorRefusalV1[] = [];

  // (1) A reanchor never changes the duty.
  for (const move of moves) {
    if (move.duty !== duty) refusals.push(rejected('invalid', 'the reanchor move changes the duty'));
  }

  // (2) Per move source: the link and its Session must be present and open/active.
  for (const move of moves) {
    const link = facts.links.get(canonicalKey(move.source));
    if (link === undefined) refusals.push(rejected('not_found', 'the reanchor source link is missing'));
    else if (link.until !== null) refusals.push(rejected('invalid', 'the reanchor source link is already closed'));
    const session = facts.sessions.get(move.source.sessionId);
    if (session === undefined) refusals.push(rejected('not_found', 'the reanchor source Session is missing'));
    else if (session.lifecycle !== 'active') {
      refusals.push(rejected('invalid', 'the reanchor source Session is not active'));
    }
  }

  // (3) Per destination: its Session, role scope, project, catalog/goal facts and authorization.
  for (const move of moves) {
    const namedLinks = new Set<string>();
    for (const destination of move.destinations) {
      const key = canonicalKey(destination.link);
      if (namedLinks.has(key)) {
        refusals.push(rejected('invalid', 'two destinations name one link'));
      }
      namedLinks.add(key);

      const session = facts.sessions.get(destination.link.sessionId);
      if (session === undefined) refusals.push(rejected('not_found', 'the reanchor destination Session is missing'));
      else if (!destinationEligible(session)) refusals.push(rejected('unavailable', 'the reanchor destination is not eligible'));
      if (session === undefined) continue;

      const targetScope = roleScopeOfTarget(destination.target);
      if (targetScope === null) {
        refusals.push(rejected('invalid', 'the reanchor destination is not a role scope'));
        continue;
      }
      if (destination.target.ref.projectId !== projectRef.projectId) {
        refusals.push(rejected('forbidden', 'the reanchor destination is another project'));
        continue;
      }
      if (destination.target.kind === 'module') {
        const moduleTarget = destination.target;
        const catalogFacts = input.proposed?.catalog ?? facts.catalog;
        if (catalogFacts.state === 'none') {
          refusals.push(rejected('not_found', 'the reanchor module destination has no catalog'));
          continue;
        }
        const present = catalogFacts.catalog.modules.some((module) =>
          module.ref.projectId === moduleTarget.ref.projectId
          && module.ref.moduleId === moduleTarget.ref.moduleId);
        if (!present) {
          refusals.push(rejected('not_found', 'the reanchor module destination is not in the catalog'));
          continue;
        }
      } else if (destination.target.kind === 'goal') {
        const factsGoal = facts.goals.get(destination.target.ref.goalId);
        const proposedGoal = input.proposed?.goal;
        const proposedMatches = proposedGoal !== undefined
          && canonicalKey(proposedGoal.ref) === canonicalKey(destination.target.ref);
        if (!(factsGoal !== undefined && factsGoal.state === 'present') && !proposedMatches) {
          refusals.push(rejected('not_found', 'the reanchor goal destination is not present'));
          continue;
        }
      }
      if (!authorizationCovers(input.authorization.scope, targetScope, projectRef)) {
        refusals.push(rejected('forbidden', 'the reanchor destination is outside the authorized scope'));
      }
    }
  }

  if (refusals.length > 0) return { ok: false, refusals };

  // (4) Fold the per-move close and the per-link destination writes.
  const sessions = new Map<string, SessionRecord>();
  const rememberSession = (session: SessionRecord): void => {
    const key = canonicalKey(session.ref);
    if (!sessions.has(key)) sessions.set(key, { ...session, revision: session.revision + 1 });
  };
  const linkCloses: { link: SessionWorkLinkRef; next: PendingSessionWorkLink | null }[] = [];
  const linkDestinations = new Map<string, { link: SessionWorkLinkRef; next: PendingSessionWorkLink | null }>();
  const closeClaims: { link: SessionWorkLinkRef; duty: RoleLineDutyV1 }[] = [];
  const openClaims: { link: SessionWorkLinkRef; duty: RoleLineDutyV1 }[] = [];
  const untilBindings: RoleLineBindingIntentV1[] = [];
  const sinceBindings: RoleLineBindingIntentV1[] = [];
  const events: ReanchorEventMaterialV1[] = [];

  for (const move of moves) {
    const sourceLink = facts.links.get(canonicalKey(move.source))!;
    rememberSession(facts.sessions.get(move.source.sessionId)!);
    linkCloses.push({ link: move.source,
      next: { ...sourceLink, revision: sourceLink.revision + 1, until: null } });
    untilBindings.push({ link: move.source, field: 'until' });
    closeClaims.push({ link: move.source, duty: move.duty });

    if (move.destinations.length === 0) {
      events.push({ closed: move.source, opened: null, openedBound: null });
      continue;
    }
    for (const destination of move.destinations) {
      const key = canonicalKey(destination.link);
      let folded = linkDestinations.get(key);
      if (folded === undefined) {
        rememberSession(facts.sessions.get(destination.link.sessionId)!);
        const existing = facts.links.get(key) ?? null;
        const { opened, openedBound } = openDestination(
          existing, { projectId: destination.link.projectId, sessionId: destination.link.sessionId }, destination.target);
        const next = openedBound === 'since' ? opened : null;
        folded = { link: destination.link, next };
        linkDestinations.set(key, folded);
        if (next !== null) {
          sinceBindings.push({ link: destination.link, field: 'since' });
          openClaims.push({ link: destination.link, duty: move.duty });
        }
      }
      events.push({ closed: move.source, opened: destination.link, openedBound: folded.next === null ? null : 'since' });
    }
  }

  // (5) One owner per claim slot: two open claims on one key with different owners are a duplicate move.
  const claimOwner = new Map<string, SessionWorkLinkRef>();
  for (const claim of openClaims) {
    const target = roleScopeOfTarget(claim.link.target);
    if (target === null) continue;
    const key = roleScopeClaimKey({ projectRef, duty: claim.duty, target });
    const owner = claimOwner.get(key);
    if (owner !== undefined && canonicalKey(owner) !== canonicalKey(claim.link)) {
      return { ok: false, refusals: [rejected('invalid', 'duplicate_responsibility_move')] };
    }
    claimOwner.set(key, claim.link);
  }

  // (6) One folded claim change per slot; the source closes once even in a split.
  const claimChanges = foldRoleScopeClaimChanges(projectRef,
    responsibilityClaimChanges({ projectRef, close: closeClaims, open: openClaims }));
  return { ok: true, plan: {
    sessions: [...sessions.values()],
    links: [...linkCloses, ...linkDestinations.values()],
    claimChanges,
    bindings: [...untilBindings, ...sinceBindings],
    events,
  } };
}
