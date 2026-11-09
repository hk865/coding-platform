/**
 * The role-facts contribution of the Session registration commit.
 *
 * The registration commit already read the create operation and built the new Session record; this writer re-reads
 * neither. Its two conditional reads are the named parent operation (a `member_create` caller) and the borrowed
 * seat's source role facts (the stored creator is inherited, never rewritten). The returned record and guard ride
 * beside the registration's effect switch; a `null` value means the pure rule writes no record.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { EncodedRecord, GoalRecordTransactionPort, RecordGuard } from '../../record-store/ports.js';
import type { CreatorRefV1, RoleFactsParentV1, SessionRoleFactsV1 } from '../../../contracts/role-lines.js';
import { roleFactsOf } from '../../../contracts/role-lines.js';
import type { CreateSeatDecisionV1, SessionCreateOperationRecord } from '../model/session-contracts.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import { decodeSessionOperationRecord, operationRefKey } from './session-record-codecs.js';
import { sessionRoleFactsCodec } from './role-line-record-codecs.js';
import { sessionStoreFailureToRejection } from '../persistence/read-result-failures.js';
import { sessionRoleFactsRecord } from '../state/role-facts.js';

/** `null` = write NO record: an `unknown` duty or a `readonly_copy`, as `roleFactsOf` decides. */
export type RoleFactsContributionV1 = { record: EncodedRecord; guard: RecordGuard } | null;
export type RoleFactsWriteInputV1 = {
  session: SessionRecord;
  operation: SessionCreateOperationRecord;
  principal: CoreCallContext['principal'];
};

export async function roleFactsContribution(
  records: Pick<GoalRecordTransactionPort, 'readMany'>, input: RoleFactsWriteInputV1,
): Promise<ReadResult<RoleFactsContributionV1>> {
  const seat = input.operation.action.seatDecision;
  if (seat === null) {
    return rejected('unavailable', 'the admitted creation saved no seat decision');
  }
  const parent = await parentFactsOf(records, input.operation, seat);
  if (parent.status !== 'ready') return parent;
  const decided = roleFactsOf({ principal: input.principal, duty: seat.duty,
    parentOperation: parent.value, provenance: input.session.provenance });
  if (decided === null) return { status: 'ready', value: null };
  const session = input.session.ref;
  // A platform-born line's origin is its parent operation (lead 8); every other line's is its own create.
  const origin = parent.value?.kind === 'start_lines' || parent.value?.kind === 'cold_start'
    || parent.value?.kind === 'workspace_join'
    ? parent.value.operation : input.operation.ref;
  const record: SessionRoleFactsV1 = sessionRoleFactsRecord({ session: input.session, decided,
    originOperation: origin, name: input.operation.action.creation?.name ?? null });
  return { status: 'ready', value: { record: sessionRoleFactsCodec.encode(record),
    guard: { refKey: canonicalJson({ aggregateType: 'SessionRoleFacts', projectId: session.projectId,
      sessionId: session.sessionId } as unknown as JsonValue), expectedRevision: null } } };
}

/** The decoded parent: a `member_create` carries its caller, a handoff the saved borrowed seat or its source. */
async function parentFactsOf(
  records: Pick<GoalRecordTransactionPort, 'readMany'>,
  operation: SessionCreateOperationRecord, seat: CreateSeatDecisionV1,
): Promise<ReadResult<RoleFactsParentV1 | null>> {
  const parentRef = operation.action.parentOperation;
  if (parentRef === null) return { status: 'ready', value: null };
  if (seat.handoff !== null && seat.source !== null) {
    const sourceCreator = await sourceCreatorOf(records, seat.source);
    if (sourceCreator.status !== 'ready') return sourceCreator;
    return { status: 'ready', value: { kind: 'handoff', source: seat.source,
      sourceCreator: sourceCreator.value } };
  }
  const key = operationRefKey(parentRef);
  const read = await records.readMany([key]);
  if (read.status !== 'ready') return unavailableReadOf(read);
  const stored = read.value.records.find((record) => record.refKey === key);
  if (stored === undefined) return rejected('unavailable', 'the parent Session operation does not exist');
  const decoded = decodeSessionOperationRecord(stored);
  if (decoded.status !== 'decoded') {
    return rejected('unavailable', `the parent Session operation is damaged: ${decoded.reason}`);
  }
  const parent = decoded.value;
  if (parent.ref.projectId !== operation.ref.projectId) {
    return rejected('unavailable', 'the parent Session operation belongs to another project');
  }
  if (parent.action.kind === 'handoff') {
    const source = parent.action.input.source;
    const sourceCreator = await sourceCreatorOf(records, source);
    if (sourceCreator.status !== 'ready') return sourceCreator;
    return { status: 'ready', value: { kind: 'handoff', source, sourceCreator: sourceCreator.value } };
  }
  if (parent.action.kind === 'member_create') {
    const caller = parent.action.input.caller;
    if (caller.kind === 'secretary_query') {
      return { status: 'ready', value: { kind: 'secretary_create', caller: { session: caller.session } } };
    }
    return { status: 'ready', value: { kind: 'member_create',
      caller: caller.kind === 'host_pick' ? null : { session: caller.session } } };
  }
  if (parent.action.kind === 'role_line') {
    // A workspace join's region line takes the join as its origin, the same platform-born arm as `start_lines` and
    // `cold_start`; its stored kind is `workspace_join`, not a borrowed `cold_start`.
    if (parent.action.action === 'workspace_join') {
      return { status: 'ready', value: { kind: 'workspace_join', operation: parent.ref } };
    }
    if (parent.action.action === 'start_lines') return { status: 'ready', value: { kind: 'start_lines', operation: parent.ref } };
    if (parent.action.action === 'cold_start') return { status: 'ready', value: { kind: 'cold_start', operation: parent.ref } };
    // A split's saved body names its source line and why it split (b02); the role facts follow the reason.
    const split = parent.action.action === 'role_line_split' ? parent.action.split ?? null : null;
    if (split !== null) {
      return { status: 'ready', value: { kind: 'role_line_split', source: split.source, reason: split.reason } };
    }
    return { status: 'ready', value: { kind: 'other' } };
  }
  return { status: 'ready', value: { kind: 'other' } };
}

/** The borrowed seat's source: its stored creator is inherited, never rewritten. */
async function sourceCreatorOf(
  records: Pick<GoalRecordTransactionPort, 'readMany'>, source: SessionRef,
): Promise<ReadResult<CreatorRefV1>> {
  const key = canonicalJson({ aggregateType: 'SessionRoleFacts', projectId: source.projectId,
    sessionId: source.sessionId } as unknown as JsonValue);
  const read = await records.readMany([key]);
  if (read.status !== 'ready') return unavailableReadOf(read);
  const stored = read.value.records.find((record) => record.refKey === key);
  if (stored === undefined) {
    return rejected('unavailable', "the borrowed seat's source has no role facts");
  }
  const decoded = sessionRoleFactsCodec.decode(stored);
  if (decoded.status !== 'decoded') {
    return rejected('unavailable', `the borrowed seat's source role facts are damaged: ${decoded.reason}`);
  }
  return { status: 'ready', value: decoded.value.creator };
}

/**
 * Every non-ready read at this boundary is `unavailable`; absence is not a value here.
 * The allocation read uses this one copy.
 */
export function unavailableReadOf(read: Parameters<typeof sessionStoreFailureToRejection>[0]): CoreRejection {
  const mapped = sessionStoreFailureToRejection(read);
  return mapped.code === 'unavailable' ? mapped : rejected('unavailable', mapped.reason);
}
