/**
 * The admission's one read of the two role-line records, and the one copy of
 * the open-cap rule.
 *
 * One `readMany` reads both the allocation and the limits record. A missing key
 * is a `null` value with a guard whose `expectedRevision` is `null` — absence is
 * a value, not a failure. A damaged or undecodable record, a failed read or a
 * non-ready answer is `unavailable` with its reason preserved. The read is not
 * in `state/`: that layer has no dependencies and may not read a store.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ProjectScope } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { messageOf } from '../../../contracts/error-message.js';
import {
  ROLE_LINE_DEFAULT_LIMITS, type ProjectRoleLimitsV1, type RoleLineAllocationV1, type RoleLineDutyV1,
} from '../../../contracts/role-lines.js';
import type {
  DecodeResult, EncodedRecord, GoalRecordTransactionPort, RecordGuard,
} from '../../record-store/ports.js';
import { sessionStoreFailureToRejection } from '../persistence/read-result-failures.js';
import { projectRoleLimitsCodec, roleLineAllocationCodec } from './role-line-record-codecs.js';

/** The admission's one read, the provider's envelope, and the one copy of the cap rule. */
export type AllocationForCommitV1 = { allocation: RoleLineAllocationV1 | null;
  allocationGuard: RecordGuard; limits: ProjectRoleLimitsV1 | null; limitsGuard: RecordGuard };

export function openLimitOf(limits: ProjectRoleLimitsV1 | null, duty: RoleLineDutyV1): number {
  return limits === null ? ROLE_LINE_DEFAULT_LIMITS.open[duty] : limits.open[duty];
}

/** holders + reservations < open; the refusal names all four facts as text (no DTO). */
export function seatAtCap(input: { duty: RoleLineDutyV1; open: number; holders: number; reservations: number }):
  CoreRejection | null {
  return input.holders + input.reservations < input.open ? null
    : rejected('capacity', `at_cap: ${input.duty} has ${input.holders} holder(s) and `
      + `${input.reservations} reservation(s) against open limit ${input.open}`);
}

/** The admission's read: a `W/sessions` read cannot reach a store, so the factory binds one. */
export function createAllocationRead(deps: { records: Pick<GoalRecordTransactionPort, 'readMany'> }) {
  return {
    async readAllocationForCommit(ctx: CoreCallContext,
      input: { projectRef: ProjectScope; duty: RoleLineDutyV1 }): Promise<ReadResult<AllocationForCommitV1>> {
      if (input.projectRef.projectId !== ctx.projectId) {
        return rejected('forbidden', 'the allocation read is bound to another project');
      }
      const allocationKey = canonicalJson({ aggregateType: 'RoleLineAllocation',
        projectId: input.projectRef.projectId, duty: input.duty } as unknown as JsonValue);
      const limitsKey = canonicalJson({ aggregateType: 'ProjectRoleLimits',
        projectId: input.projectRef.projectId } as unknown as JsonValue);
      let read: Awaited<ReturnType<Pick<GoalRecordTransactionPort, 'readMany'>['readMany']>>;
      try {
        read = await deps.records.readMany([allocationKey, limitsKey]);
      } catch (error) {
        return rejected('unavailable', `the role-line allocation read failed: ${messageOf(error)}`);
      }
      if (read.status !== 'ready') {
        const mapped = sessionStoreFailureToRejection(read);
        // Every non-ready answer is `unavailable` here; absence is a value, not a failure.
        return mapped.code === 'unavailable' ? mapped
          : rejected('unavailable', `the role-line allocation read did not answer: ${mapped.reason}`);
      }
      const byKey = new Map(read.value.records.map((record) => [record.refKey, record]));
      const one = <T>(key: string, codec: { decode(record: EncodedRecord): DecodeResult<T> }, what: string):
        { ok: true; value: T | null } | { ok: false; rejection: CoreRejection } => {
        const found = byKey.get(key);
        if (found === undefined) return { ok: true, value: null };
        const decoded = codec.decode(found);
        return decoded.status === 'decoded' ? { ok: true, value: decoded.value }
          : { ok: false, rejection: rejected('unavailable', `${what} is damaged: ${decoded.reason}`) };
      };
      const allocation = one(allocationKey, roleLineAllocationCodec, 'the role-line allocation');
      if (!allocation.ok) return allocation.rejection;
      const limits = one(limitsKey, projectRoleLimitsCodec, 'the project role limits');
      if (!limits.ok) return limits.rejection;
      return { status: 'ready', value: {
        allocation: allocation.value, allocationGuard: { refKey: allocationKey,
          expectedRevision: allocation.value?.revision ?? null },
        limits: limits.value, limitsGuard: { refKey: limitsKey, expectedRevision: limits.value?.revision ?? null } } };
    },
  };
}
