/**
 * Role-line contracts (slice 7D1): duties and scopes, the claim key and its conflict detail, the stored role facts
 * and their read-time contact, the allocation/limits DTOs, the trusted maintainer call, and the six R1 formats.
 *
 * Every type, scope check and field table here is frozen in one place so the writers and readers of a role line
 * cannot drift: a claim key is built by `roleScopeClaimKey`, a creator is decided by `roleFactsOf`, and a current
 * contact is derived by `creatorOf`. Nothing in this file reads a store, writes state, or names a runtime.
 */
import type { ActorRef, CommitCursor } from './command-event.js';
import type { CoreCallContext } from './core/call-context.js';
import type { ModuleRef, ProjectScope, SessionRef, SessionWorkLinkRef, WorkLinkTarget } from './core/identity.js';
import type { GoalRef } from './ledger.js';
import type { OperationRef } from './core/operations.js';
import type { CoreRejection, ReadResult } from './core/results.js';
import type { SessionProvenanceV1 } from './core/session.js';
import type { SessionArchiveRequestV1 } from './core/session-archive.js';
import type { SessionMessageRef } from './core/session-message.js';
import {
  defineEvent, defineRecord, defineShape, f, type InferPending, type InferRecord, type InferShape,
} from './data-format.js';
import {
  ActorRefField, id, OperationRefShape, ProjectScopeShape, SessionRefShape,
} from './data-format-refs.js';
import { canonicalJson, canonicalKey } from './fingerprint.js';
import { DecisionSubjectShape } from './goal-decisions.js';
import type { PlatformDutyV1 } from './platform-duty.js';
import { hasOnlyKeys, isRecord, nonEmpty } from './validation/common.js';

// ------------------------------------------------------------------------ //
// Duties and scopes                                                         //
// ------------------------------------------------------------------------ //

export const ROLE_LINE_DUTIES = ['secretary', 'adviser', 'scribe', 'executor'] as const;
export type RoleLineDutyV1 = (typeof ROLE_LINE_DUTIES)[number];
export type RoleScopeV1 = { kind: 'project' } | { kind: 'goal'; goalRef: GoalRef } | { kind: 'region'; moduleRef: ModuleRef };
export function isRoleLineDuty(value: unknown): value is RoleLineDutyV1 {
  return typeof value === 'string' && (ROLE_LINE_DUTIES as readonly string[]).includes(value);
}
export function isRoleScopeV1(value: unknown): value is RoleScopeV1 {
  if (!isRecord(value)) return false;
  if (value['kind'] === 'project') return hasOnlyKeys(value, ['kind']);
  if (value['kind'] === 'goal') {
    const g = value['goalRef'];
    return hasOnlyKeys(value, ['kind', 'goalRef']) && isRecord(g)
      && hasOnlyKeys(g, ['aggregateType', 'projectId', 'goalId']) && g['aggregateType'] === 'Goal'
      && nonEmpty(g['projectId']) && nonEmpty(g['goalId']);
  }
  if (value['kind'] === 'region') {
    const m = value['moduleRef'];
    return hasOnlyKeys(value, ['kind', 'moduleRef']) && isRecord(m)
      && hasOnlyKeys(m, ['projectId', 'moduleId']) && nonEmpty(m['projectId']) && nonEmpty(m['moduleId']);
  }
  return false;
}
/** Five arms, exhaustive: task/work are not role scopes; the compiler names a sixth. */
export function roleScopeOfTarget(target: WorkLinkTarget): RoleScopeV1 | null {
  switch (target.kind) {
    case 'project': return { kind: 'project' };
    case 'goal': return { kind: 'goal', goalRef: target.ref };
    case 'module': return { kind: 'region', moduleRef: target.ref };
    case 'task': case 'work': return null;
  }
}
export const ROLE_SCOPE_CLAIM_PREFIX = 'role-scope:';
export type RoleScopeClaimChangeV1 = {
  duty: RoleLineDutyV1; target: RoleScopeV1; expectedOwner: SessionWorkLinkRef | null;
  nextOwner: SessionWorkLinkRef | null;
};
export type RoleLineBindingIntentV1 = { link: SessionWorkLinkRef; field: 'since' | 'until' };
export function roleScopeClaimKey(input: { projectRef: ProjectScope; duty: RoleLineDutyV1; target: RoleScopeV1 }): string {
  return ROLE_SCOPE_CLAIM_PREFIX + canonicalKey({ projectId: input.projectRef.projectId, duty: input.duty, target: input.target });
}
export const MODULE_MAINTAINER_PREFIX = 'module-maintainer:';
export function moduleMaintainerKey(module: ModuleRef): string {
  return MODULE_MAINTAINER_PREFIX + canonicalJson({ projectId: module.projectId, moduleId: module.moduleId });
}
/** The one narrow mapping of a store `unique_conflict` on the `module-maintainer:` slot; never re-reads a record. */
export function maintainerClaimConflictOf(
  current: readonly { claimKey: string; owner: string | null }[],
): CoreRejection | null {
  for (const slot of current) {
    if (!slot.claimKey.startsWith(MODULE_MAINTAINER_PREFIX)) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(slot.claimKey.slice(MODULE_MAINTAINER_PREFIX.length)); } catch { continue; }
    if (!isRecord(parsed)) continue;
    const projectId = parsed['projectId'], moduleId = parsed['moduleId'];
    if (typeof projectId !== 'string' || projectId === '' || typeof moduleId !== 'string' || moduleId === '') continue;
    const moduleRef: ModuleRef = { projectId, moduleId };
    const target: RoleScopeV1 = { kind: 'region', moduleRef };
    const holder = sessionRefOfClaimOwner(slot.owner);
    return { status: 'rejected', code: 'revision_conflict',
      scopeOwned: { duty: 'executor', target, holder },
      reason: `scope_owned: the executor scope ${canonicalKey(target)} is held by ` +
        `${holder === null ? 'an undecodable owner' : holder.sessionId}` };
  }
  return null;
}

// ------------------------------------------------------------------------ //
// The claim's conflict detail                                               //
// ------------------------------------------------------------------------ //

export type ScopeOwnedDetailV1 = { duty: RoleLineDutyV1; target: RoleScopeV1; holder: SessionRef | null };
export function sessionRefOfClaimOwner(ownerKey: string | null): SessionRef | null {
  if (ownerKey === null) return null;
  let value: unknown;
  try { value = JSON.parse(ownerKey); } catch { return null; }
  if (!isRecord(value)) return null;
  const projectId = value['projectId'], sessionId = value['sessionId'];
  if (typeof projectId !== 'string' || projectId === '' || typeof sessionId !== 'string' || sessionId === '') return null;
  return { projectId, sessionId };
}
export function scopeOwnedDetailOfSlot(slot: { claimKey: string; owner: string | null }): ScopeOwnedDetailV1 | null {
  if (!slot.claimKey.startsWith(ROLE_SCOPE_CLAIM_PREFIX)) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(slot.claimKey.slice(ROLE_SCOPE_CLAIM_PREFIX.length)); } catch { return null; }
  if (!isRecord(parsed)) return null;
  const duty = parsed['duty'], target = parsed['target'];
  if (!isRoleLineDuty(duty) || !isRoleScopeV1(target)) return null;
  return { duty, target, holder: sessionRefOfClaimOwner(slot.owner) };
}

// ------------------------------------------------------------------------ //
// Stored role facts and the derived contact                                 //
// ------------------------------------------------------------------------ //

export const CreatorRefField = f.union('kind', {
  session: { kind: f.literal('session'), ref: f.ref(SessionRefShape) },
  human: { kind: f.literal('human'), actor: ActorRefField }, platform: { kind: f.literal('platform') },
});
export type CreatorRefV1 = { kind: 'session'; ref: SessionRef } | { kind: 'human'; actor: ActorRef } | { kind: 'platform' };
export type CreatorContactV1 = { kind: 'session'; session: SessionRef } | { kind: 'human'; actor: ActorRef }
  | { kind: 'platform' } | { kind: 'lapsed' } | { kind: 'unknown' };
export type RoleFactsParentV1 = { kind: 'member_create'; caller: { session: SessionRef } | null }
  | { kind: 'handoff'; source: SessionRef; sourceCreator: CreatorRefV1 } | { kind: 'other' };
export const SESSION_OPENED_BY = ['start_lines', 'human', 'platform_rule', 'agent_proposal', 'secretary_create',
  'member_create', 'handoff', 'cold_start', 'legacy'] as const;
export type SessionOpenedByV1 = (typeof SESSION_OPENED_BY)[number];
export const SessionRoleFactsRefShape = defineShape({ name: 'SessionRoleFactsRef', fields: {
  aggregateType: f.literal('SessionRoleFacts'), projectId: id, sessionId: id } });
export const SessionRoleFactsFormat = defineRecord({ name: 'SessionRoleFacts', schemaId: 'SessionRoleFacts@1',
  aggregateType: 'SessionRoleFacts', fields: {
    ref: f.ref(SessionRoleFactsRefShape), revision: f.revision({ min: 1 }), sessionRef: f.ref(SessionRefShape),
    name: f.nullable(f.string({ min: 1, max: 512, unit: 'utf8Bytes' })), creator: CreatorRefField,
    openedBy: f.enumOf(SESSION_OPENED_BY), originOperation: f.nullable(f.ref(OperationRefShape)) },
  });     // no lookup (落-03)
export type SessionRoleFactsV1 = InferRecord<(typeof SessionRoleFactsFormat)['fields']>;
export function roleFactsOf(input: { principal: CoreCallContext['principal']; duty: RoleLineDutyV1 | 'unknown';
  parentOperation: RoleFactsParentV1 | null; provenance: SessionProvenanceV1 }):
  { creator: CreatorRefV1; openedBy: SessionOpenedByV1 } | null {
  const { principal, duty, parentOperation, provenance } = input;
  if (duty === 'unknown' || provenance.kind === 'readonly_copy') return null;
  if (parentOperation?.kind === 'handoff') return { creator: parentOperation.sourceCreator, openedBy: 'handoff' };
  const hostHuman = principal.kind === 'host' && principal.actor.kind === 'human';
  const fallback: CreatorRefV1 = hostHuman ? { kind: 'human', actor: principal.actor } : { kind: 'platform' };
  if (parentOperation?.kind === 'member_create') {
    return { creator: parentOperation.caller === null
      ? fallback : { kind: 'session', ref: parentOperation.caller.session }, openedBy: 'member_create' };
  }
  return { creator: fallback, openedBy: hostHuman ? 'human' : 'platform_rule' };
}
export type RoleLineLifecycleFactsV1 = { session: SessionRef; lifecycle: 'active' | 'archived';
  archivedAt: string | null; archiveRequest: SessionArchiveRequestV1 | null };
export function creatorOf(facts: Pick<SessionRoleFactsV1, 'creator'>, line: RoleLineLifecycleFactsV1,
  contact: RoleLineLifecycleFactsV1 | null,
  completedHandoff: ReadonlyMap<string, { successor: RoleLineLifecycleFactsV1; borrowed: boolean }>): CreatorContactV1 {
  const { creator } = facts;
  if (creator.kind === 'human') return { kind: 'human', actor: creator.actor };
  if (creator.kind === 'platform') return { kind: 'platform' };
  let session = creator.ref;
  let lifecycle = session.projectId === line.session.projectId && session.sessionId === line.session.sessionId
    ? line : contact;
  while (lifecycle !== null) {
    if (lifecycle.archivedAt === null) return { kind: 'session', session };
    const hop = completedHandoff.get(canonicalKey({
      aggregateType: 'Session', projectId: session.projectId, sessionId: session.sessionId }));
    if (hop === undefined) {
      return session.projectId === line.session.projectId && session.sessionId === line.session.sessionId
        ? { kind: 'session', session } : { kind: 'lapsed' };
    }
    session = hop.successor.session;
    lifecycle = hop.successor;
  }
  return { kind: 'unknown' };
}
export type ReservedDutyV1 = { kind: 'pool'; duty: RoleLineDutyV1 } | { kind: 'borrowed'; source: SessionRef }
  | { kind: 'none'; reason: 'unknown_duty' | 'readonly_copy' };
export function roleLineDutyOf(duty: PlatformDutyV1 | 'unknown'): RoleLineDutyV1 | null {
  return duty === 'unknown' ? null : duty === 'reviewer' ? 'executor' : duty;
}
export function reservedDutyOf(input: { duty: PlatformDutyV1 | 'unknown'; provenance: SessionProvenanceV1;
  borrowedFrom: SessionRef | null }): ReservedDutyV1 {
  if (input.provenance.kind === 'readonly_copy') return { kind: 'none', reason: 'readonly_copy' };
  const duty = roleLineDutyOf(input.duty);
  if (duty === null) return { kind: 'none', reason: 'unknown_duty' };
  return input.borrowedFrom === null ? { kind: 'pool', duty } : { kind: 'borrowed', source: input.borrowedFrom };
}

// ------------------------------------------------------------------------ //
// Allocation and limits                                                     //
// ------------------------------------------------------------------------ //

export const RoleLineAllocationRefShape = defineShape({ name: 'RoleLineAllocationRef', fields: {
  aggregateType: f.literal('RoleLineAllocation'), projectId: id, duty: f.enumOf(ROLE_LINE_DUTIES) } });
export type RoleLineAllocationRef = InferShape<(typeof RoleLineAllocationRefShape)['fields']>;
export const RoleLineAllocationFormat = defineRecord({ name: 'RoleLineAllocation', schemaId: 'RoleLineAllocation@1',
  aggregateType: 'RoleLineAllocation', fields: {
    ref: f.ref(RoleLineAllocationRefShape), revision: f.revision({ min: 1 }), projectRef: f.ref(ProjectScopeShape),
    duty: f.enumOf(ROLE_LINE_DUTIES),
    holders: f.array(f.object({ sessionRef: f.ref(SessionRefShape), since: f.boundCursor('holders[].since') })),
    reservations: f.array(f.object({ operationRef: f.ref(OperationRefShape), reservedAt: f.boundCursor('reservations[].reservedAt') })) },
  });
export type RoleLineAllocationV1 = InferRecord<(typeof RoleLineAllocationFormat)['fields']>;
export type RoleLineAllocationPendingV1 = InferPending<(typeof RoleLineAllocationFormat)['fields']>;   // book's Omit, one list
export const ROLE_LINE_DEFAULT_LIMITS = { open: { secretary: 8, adviser: 8, scribe: 4, executor: 16 },
  running: { secretary: 4, adviser: 4, scribe: 2, executor: 8 } };
export type RoleLimitsNumbersV1 = Record<RoleLineDutyV1, number>;
export type RoleLimitsViewV1 = { projectRef: ProjectScope; revision: number;   // 0 = defaults
  running: RoleLimitsNumbersV1; open: RoleLimitsNumbersV1 };
export type RoleLimitsSetRequestV1 = { commandId: string; expectedRevision: number;  // 0 = absent
  running?: Partial<RoleLimitsNumbersV1>; open?: Partial<RoleLimitsNumbersV1> };
export type RoleLineAllocationDutyViewV1 = { duty: RoleLineDutyV1; limit: number; revision: number | null;
  holders: { session: SessionRef; name: string | null; creator: CreatorContactV1; since: CommitCursor }[];
  reservations: { operationRef: OperationRef; reservedAt: CommitCursor }[] };
export type RoleLineAllocationReportV1 = { projectRef: ProjectScope; duties: Record<RoleLineDutyV1, RoleLineAllocationDutyViewV1> };
export const roleLimitFields = { secretary: f.integer({ min: 1 }), adviser: f.integer({ min: 1 }),
  scribe: f.integer({ min: 1 }), executor: f.integer({ min: 1 }) } as const;
export const ProjectRoleLimitsRefShape = defineShape({ name: 'ProjectRoleLimitsRef', fields: {
  aggregateType: f.literal('ProjectRoleLimits'), projectId: id } });
export const ProjectRoleLimitsFormat = defineRecord({ name: 'ProjectRoleLimits', schemaId: 'ProjectRoleLimits@1',
  aggregateType: 'ProjectRoleLimits', fields: { ref: f.ref(ProjectRoleLimitsRefShape), revision: f.revision({ min: 1 }),
    projectRef: f.ref(ProjectScopeShape), running: f.object(roleLimitFields), open: f.object(roleLimitFields) } });
export type ProjectRoleLimitsV1 = InferRecord<(typeof ProjectRoleLimitsFormat)['fields']>;

// ------------------------------------------------------------------------ //
// The trusted maintainer call                                               //
// ------------------------------------------------------------------------ //

export type TrustedMaintainerCallV1 = { kind: 'maintainer_assignment'; cardKey: string; answerMessageRef: SessionMessageRef;
  operation: OperationRef; moduleRef: ModuleRef; line: SessionRef; approvedBy: ActorRef; revision: number };
export type MaintainerCallBranchV1 = { branch: 'approved_answer'; proof: TrustedMaintainerCallV1 }
  | { branch: 'current_authorization'; authorization: { kind: 'maintainer_assignment'; projectRef: ProjectScope;
    operation: OperationRef; moduleRef: ModuleRef; line: SessionRef; since: string } };
export type MaintainerCallBindingV1 = { operation: OperationRef; moduleRef: ModuleRef; line: SessionRef };
export function maintainerCallBindingOf(
  branch: MaintainerCallBranchV1, binding: MaintainerCallBindingV1,
): ReadResult<MaintainerCallBindingV1> {
  const call = branch.branch === 'approved_answer' ? branch.proof : branch.authorization;
  const differing =
    canonicalJson(call.operation) !== canonicalJson(binding.operation) ? 'operation'
    : canonicalJson(call.moduleRef) !== canonicalJson(binding.moduleRef) ? 'moduleRef'
    : canonicalJson(call.line) !== canonicalJson(binding.line) ? 'line'
    : null;
  return differing === null ? { status: 'ready', value: binding }
    : { status: 'rejected', code: 'forbidden',
        reason: `maintainer_call_mismatch: the maintainer call names a different ${differing}` };
}

// ------------------------------------------------------------------------ //
// R1 envelopes: limits change and project notice                            //
// ------------------------------------------------------------------------ //

export const ProjectRoleLimitsChangedFormat = defineEvent({ name: 'ProjectRoleLimitsChanged', eventType: 'ProjectRoleLimitsChanged',
  schemaVersion: 1, fields: { projectId: id, workspaceId: id,
    from: f.object({ running: f.object(roleLimitFields), open: f.object(roleLimitFields) }),
    to: f.object({ running: f.object(roleLimitFields), open: f.object(roleLimitFields) }),
    actor: ActorRefField, revision: f.integer({ min: 1 }) } });
export const PROJECT_NOTICE_KINDS = ['module_maintainer_assigned'] as const;   // 7D2 appends
export type ProjectNoticeKindV1 = (typeof PROJECT_NOTICE_KINDS)[number];
export type NotifyProjectInputV1 = { projectRef: ProjectScope; kind: ProjectNoticeKindV1; summary: string; operation: OperationRef };
export const PROJECT_NOTICES_BY_PROJECT_LOOKUP = 'project-notices-by-project';
export const ProjectNoticeRefShape = defineShape({ name: 'ProjectNoticeRef', fields: {
  aggregateType: f.literal('ProjectNotice'), projectId: id, noticeId: f.sha256() } });
export const ProjectNoticeFormat = defineRecord({ name: 'ProjectNotice', schemaId: 'ProjectNotice@1', aggregateType: 'ProjectNotice',
  fields: { ref: f.ref(ProjectNoticeRefShape), subject: DecisionSubjectShape.fields['subject']!, kind: f.enumOf(PROJECT_NOTICE_KINDS),
    summary: f.string({ min: 1, max: 512, unit: 'utf8Bytes' }), operation: f.ref(OperationRefShape),
    since: f.boundCursor('since'), revision: f.literal(1) }, lookups: [{ name: PROJECT_NOTICES_BY_PROJECT_LOOKUP, equal: ['ref.projectId'],
    orderBy: { path: 'since', valueType: 'text' } }] });
export type ProjectNoticeV1 = InferRecord<(typeof ProjectNoticeFormat)['fields']>;
export const ProjectNoticeCreatedFormat = defineEvent({ name: 'ProjectNoticeCreated', eventType: 'ProjectNoticeCreated',
  schemaVersion: 1, fields: { projectId: id, workspaceId: f.nullable(id), notice: f.object({ ref: f.ref(ProjectNoticeRefShape),
    subject: DecisionSubjectShape.fields['subject']!, kind: f.enumOf(PROJECT_NOTICE_KINDS),
    summary: f.string({ min: 1, max: 512, unit: 'utf8Bytes' }), operation: f.ref(OperationRefShape) }) } });
