// the only builder of claims, guards and encoded records (L-18)
import type { ProjectScope, SessionWorkLinkRef } from '../../../contracts/core/identity.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import type { CommitCursorBinding, EncodedDomainEvent, EncodedRecord, RecordGuard } from '../../record-store/ports.js';
import type { CommitFragment } from '../persistence/command-executor.js';
import type { PendingSessionWorkLink } from '../../../contracts/core/session.js';
import { canonicalKey } from '../../../contracts/fingerprint.js';
import { encodePendingSessionWorkLink, sessionWorkLinkRefKey } from './session-record-codecs.js';
import { roleLineAllocationCodec } from './role-line-record-codecs.js';        // G1-1's one codec
import { mergeGuards } from '../persistence/record-guards.js';
import { moduleMaintainerKey, roleScopeClaimKey, type RoleLineAllocationV1, type RoleLineAllocationPendingV1,
  type RoleLineBindingIntentV1, type RoleScopeClaimChangeV1 } from '../../../contracts/role-lines.js';
export type RoleLineCommitInputV1 = { projectRef: ProjectScope;
  records: readonly EncodedRecord[]; guards: readonly RecordGuard[];
  links: readonly { link: SessionWorkLinkRef; next: PendingSessionWorkLink | null }[];
  claimChanges: readonly RoleScopeClaimChangeV1[]; bindings: readonly RoleLineBindingIntentV1[];
  events: readonly EncodedDomainEvent[]; allocation: RoleLineAllocationPendingV1 | null };
export function roleLineCommitContribution(input: RoleLineCommitInputV1, allocation: RoleLineAllocationV1 | null):
  { ok: true; fragment: CommitFragment } | { ok: false; rejection: CoreRejection } {
  const records = [...input.records, ...input.links.filter((e) => e.next !== null).map((e) => encodePendingSessionWorkLink(e.next!))];
  const allocationKey = input.allocation === null ? null : canonicalKey(input.allocation.ref);
  if (input.allocation !== null) records.push(roleLineAllocationCodec.encode(input.allocation));
  const claims = input.claimChanges.map((change) => ({
    claimKey: change.duty === 'executor' && change.target.kind === 'region'
      ? moduleMaintainerKey(change.target.moduleRef)
      : roleScopeClaimKey({ projectRef: input.projectRef, duty: change.duty, target: change.target }),
    expectedOwner: change.expectedOwner === null ? null : sessionWorkLinkRefKey(change.expectedOwner),
    nextOwner: change.nextOwner === null ? null : sessionWorkLinkRefKey(change.nextOwner) }));
  const bindings: CommitCursorBinding[] = input.bindings.map((b) => ({ refKey: sessionWorkLinkRefKey(b.link), field: b.field }));
  if (allocationKey !== null && input.allocation !== null) {                       // one binding per nested path
    if (input.allocation.holders.some((h) => h.since === null)) bindings.push({ refKey: allocationKey, field: 'holders[].since' });
    if (input.allocation.reservations.some((e) => e.reservedAt === null)) bindings.push({ refKey: allocationKey, field: 'reservations[].reservedAt' });
  }
  const guarded = input.allocation === null ? [...input.guards]
    : [...input.guards, { refKey: allocationKey!, expectedRevision: allocation?.revision ?? null }];
  const merged = mergeGuards(guarded);
  if (!merged.ok) return { ok: false, rejection: merged.rejection };
  return { ok: true, fragment: { guards: merged.guards, records, claims,
    events: input.events, commitCursorBindings: bindings } };
}
