/**
 * A Session's activity record (`contracts/session-activity.ts`): the codec and
 * schema registration, the ref/key and guard helpers, the pure advance planner
 * and the read port.
 *
 * The record is a companion fragment of the fact that caused it, so the
 * planner builds the next value from the Session's stored creation time and
 * the current record without writing anything. The caller merges the returned
 * guard into its own commit and encodes exactly one record.
 *
 * The reader returns the real absent state as revision 0 at the Session's
 * creation time; only a missing/damaged Session or a damaged activity record
 * is an error. Both paths read the Session and the activity in one batch.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { VersionedRef } from '../../../contracts/ledger.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type {
  SessionActivityKindV1, SessionActivityRef, SessionActivitySourceV1, SessionActivityV1,
} from '../../../contracts/session-activity.js';
import { SessionActivityFormat } from '../../../contracts/session-activity.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { messageOf } from '../../../contracts/error-message.js';
import { nonEmpty } from '../../../contracts/validation/common.js';
import type {
  EncodedRecord, GoalRecordTransactionPort, RecordGuard,
} from '../../record-store/ports.js';
import type { SessionActivityReadPort, SessionActivityStateV1 } from '../model/session-activity-contracts.js';
import { createRecordCodec, formatSchemas } from '../persistence/field-table-codec.js';
import { sessionStoreFailureToRejection } from '../persistence/read-result-failures.js';
import { nextSessionActivity } from '../state/session-activity.js';
import {
  decodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey,
} from './session-record-codecs.js';

export const sessionActivityCodec = createRecordCodec(SessionActivityFormat);
export const SESSION_ACTIVITY_SCHEMAS = formatSchemas([sessionActivityCodec]);

/** The record's key is the canonical JSON of its full tagged ref. */
export function sessionActivityRefOf(session: SessionRef): SessionActivityRef {
  return { aggregateType: 'SessionActivity', projectId: session.projectId, sessionId: session.sessionId };
}

/**
 * The activity record a committing fact writes, and the guard that keeps the
 * write on the revision the planner read. One batch reads the Session (its
 * creation time) and the current activity record (absent means revision 0).
 */
export async function planSessionActivityAdvance(
  records: Pick<GoalRecordTransactionPort, 'readMany'>,
  input: { sessionRef: SessionRef; at: string; kind: SessionActivityKindV1; source: SessionActivitySourceV1 },
): Promise<{ ok: true; record: EncodedRecord; guard: VersionedRef } | { ok: false; rejection: CoreRejection }> {
  const ref = sessionActivityRefOf(input.sessionRef);
  const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(input.sessionRef));
  const activityKey = canonicalJson(ref as unknown as JsonValue);
  let read;
  try {
    read = await records.readMany([sessionKey, activityKey]);
  } catch (error) {
    return { ok: false, rejection: rejected('unavailable', `the Session activity read failed: ${messageOf(error)}`) };
  }
  if (read.status !== 'ready') return { ok: false, rejection: sessionStoreFailureToRejection(read) };
  const byKey = new Map(read.value.records.map((entry) => [entry.refKey, entry]));
  const sessionRecord = byKey.get(sessionKey);
  if (sessionRecord === undefined) {
    return { ok: false, rejection: rejected('not_found', 'the Session activity advance names a missing Session') };
  }
  const session = decodeSessionRecord(sessionRecord);
  if (session.status !== 'decoded') {
    return { ok: false, rejection: rejected('unavailable', `the Session is damaged: ${session.reason}`) };
  }
  let current: SessionActivityV1 | null = null;
  const activityRecord = byKey.get(activityKey);
  if (activityRecord !== undefined) {
    const decoded = sessionActivityCodec.decode(activityRecord);
    if (decoded.status !== 'decoded') {
      return { ok: false, rejection: rejected('unavailable', `the Session activity is damaged: ${decoded.reason}`) };
    }
    current = decoded.value;
  }
  const next = nextSessionActivity({
    current, ref, session: input.sessionRef, sessionCreatedAt: session.value.createdAt,
    at: input.at, kind: input.kind, source: input.source,
  });
  return {
    ok: true,
    record: sessionActivityCodec.encode(next),
    guard: { ref, revision: current?.revision ?? 0 },
  };
}

/**
 * The store's compare-and-swap spelling of the planner's guard. Revision 0 is
 * the absent default, which the store requires with `null`; a caller merges
 * this object with its other guards.
 */
export function activityGuardOf(guard: VersionedRef): RecordGuard {
  return {
    refKey: canonicalJson(guard.ref as unknown as JsonValue),
    expectedRevision: guard.revision === 0 ? null : guard.revision,
  };
}

/**
 * The read side of the activity record. A caller of any principal reads only a
 * Session of its bound project (checked before the read) and of its bound
 * workspace (checked on the decoded Session), as the planning-question reader
 * does (`tasks/planning-question-reader.ts`); either mismatch is `forbidden`.
 */
export function createSessionActivityReader(deps: { records: GoalRecordTransactionPort }): SessionActivityReadPort {
  return {
    async readSessionActivity(ctx: CoreCallContext, input: { session: SessionRef }): Promise<ReadResult<SessionActivityStateV1>> {
      const raw = input.session as unknown;
      if (typeof raw !== 'object' || raw === null) {
        return rejected('invalid', 'readSessionActivity requires a SessionRef with a projectId and a sessionId');
      }
      const fields = raw as Record<string, unknown>;
      if (!nonEmpty(fields['projectId']) || !nonEmpty(fields['sessionId'])) {
        return rejected('invalid', 'readSessionActivity requires a SessionRef with a projectId and a sessionId');
      }
      const sessionRef: SessionRef = { projectId: fields['projectId'], sessionId: fields['sessionId'] };
      if (sessionRef.projectId !== ctx.projectId) return rejected('forbidden', 'the Session belongs to another project');
      const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(sessionRef));
      const activityKey = canonicalJson(sessionActivityRefOf(sessionRef) as unknown as JsonValue);
      let read;
      try {
        read = await deps.records.readMany([sessionKey, activityKey]);
      } catch (error) {
        return rejected('unavailable', `the Session activity read failed: ${messageOf(error)}`);
      }
      if (read.status !== 'ready') return sessionStoreFailureToRejection(read);
      const byKey = new Map(read.value.records.map((entry) => [entry.refKey, entry]));
      const sessionRecord = byKey.get(sessionKey);
      if (sessionRecord === undefined) return { status: 'not_found' };
      const session = decodeSessionRecord(sessionRecord);
      if (session.status !== 'decoded') return rejected('unavailable', `the Session is damaged: ${session.reason}`);
      if (session.value.workspaceId !== ctx.workspaceId) {
        return rejected('forbidden', 'the Session belongs to another workspace');
      }
      const activityRecord = byKey.get(activityKey);
      if (activityRecord === undefined) {
        return {
          status: 'ready',
          value: {
            session: sessionRef, revision: 0, lastActivityAt: session.value.createdAt, record: null,
          },
        };
      }
      const activity = sessionActivityCodec.decode(activityRecord);
      if (activity.status !== 'decoded') return rejected('unavailable', `the Session activity is damaged: ${activity.reason}`);
      return {
        status: 'ready',
        value: {
          session: sessionRef,
          revision: activity.value.revision,
          lastActivityAt: activity.value.lastActivityAt,
          record: activity.value,
        },
      };
    },
  };
}
