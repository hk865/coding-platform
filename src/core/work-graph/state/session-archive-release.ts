// pure; sibling of W/state/session-availability.ts
import type { SessionRef, SessionWorkLinkRef } from '../../../contracts/core/identity.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import type { SessionWorkLink } from '../../../contracts/core/session.js';
import type { PlatformDutyV1 } from '../../../contracts/platform-duty.js';
import { roleLineDutyOf, type RoleLineAllocationV1, type RoleLineAllocationPendingV1,
  type RoleLineBindingIntentV1, type RoleScopeClaimChangeV1 } from '../../../contracts/role-lines.js';
import { foldRoleScopeClaimChanges, responsibilityClaimChanges } from './role-scope.js';
import { allocationNext } from './role-line-allocation.js';
export type ArchiveReleaseInputV1 = { session: SessionRef;
  links: readonly SessionWorkLink[];                          // the line's own links, full values
  duty: PlatformDutyV1 | 'unknown'; allocation: RoleLineAllocationV1 | null;
  successor: { session: SessionRef; duty: PlatformDutyV1 | 'unknown' } | null };
export type ArchiveReleasePlanV1 = { allocation: RoleLineAllocationPendingV1 | null;     // null = no record
  claimChanges: readonly RoleScopeClaimChangeV1[]; close: readonly SessionWorkLinkRef[];
  bindings: readonly RoleLineBindingIntentV1[] };
export function openScopeLinkOf(links: readonly Pick<SessionWorkLink, 'ref' | 'until'>[],
  duty: PlatformDutyV1 | 'unknown'): 'goal' | 'project' | 'module' | false {
  for (const link of links) {
    if (link.until !== null || link.ref.relation !== 'responsible') continue;
    const kind = link.ref.target.kind;
    if (kind === 'goal' || kind === 'project') return kind;
    // The executor arm is a scope link too: its archive choice closes or moves it before the plan;
    // `planArchiveRelease`'s automatic-close list stays adviser/scribe only.
    if (kind === 'module' && (duty === 'adviser' || duty === 'scribe'
      || roleLineDutyOf(duty) === 'executor')) return 'module';
  }
  return false;
}
export function planArchiveRelease(input: ArchiveReleaseInputV1):
  { ok: true; plan: ArchiveReleasePlanV1 } | { ok: false; refusals: readonly CoreRejection[] } {
  if (openScopeLinkOf(input.links, input.duty) === false && input.allocation === null)   // task-only, seatless
    return { ok: true, plan: { allocation: null, claimChanges: [], close: [], bindings: [] } };
  if (input.duty === 'unknown')
    return { ok: false, refusals: [{ status: 'rejected', code: 'unavailable', reason: 'the Session duty cannot be read' }] };
  const duty = roleLineDutyOf(input.duty)!;     // reviewer → executor; non-null after the unknown refusal
  const projectRef = { projectId: input.session.projectId };
  const close = input.links.filter((link) => link.until === null && link.ref.relation === 'responsible'
    && (link.ref.target.kind === 'goal' || link.ref.target.kind === 'project' || (link.ref.target.kind === 'module'
      && (input.duty === 'adviser' || input.duty === 'scribe'))));
  const claimChanges = foldRoleScopeClaimChanges(projectRef,
    responsibilityClaimChanges({ projectRef, close: close.map((link) => ({ link: link.ref, duty })), open: [] }));
  const allocation = input.allocation === null ? null : allocationNext({ projectRef, duty, current: input.allocation,
    change: input.successor === null ? { kind: 'release_holder', sessionRef: input.session }
      : { kind: 'move_holder', from: input.session, to: input.successor.session } });
  const bindings: RoleLineBindingIntentV1[] = close.map((link) => ({ link: link.ref, field: 'until' }));
  return { ok: true, plan: { allocation, claimChanges, close: close.map((link) => link.ref),
    bindings } };
}
