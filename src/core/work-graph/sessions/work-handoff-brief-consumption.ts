/**
 * Record 5's one consumption contribution for an entry commit.
 *
 * The caller has already read the frozen manifest brief; this reads the stored record, checks it is still
 * exactly that brief, and answers the consumed record + its CAS guard. Work's normal entered commit, its
 * terminal/reconcile commit and a Query's begin commit all pass the same frozen brief here. It commits
 * nothing and writes no event.
 */
import type { CoreRejection } from '../../../contracts/core/results.js';
import type { ExecutionRef, SessionRef } from '../../../contracts/core/identity.js';
import { rejected } from '../../../contracts/core/rejections.js';
import { messageOf } from '../../../contracts/error-message.js';
import { canonicalJson, canonicalKey } from '../../../contracts/fingerprint.js';
import type { FrozenHandoffBriefV1 } from '../../../contracts/handoff-brief.js';
import type {
  EncodedRecord, GoalRecordTransactionPort, RecordGuard,
} from '../../record-store/ports.js';
import { executionStoreFailureToRejection } from '../persistence/read-result-failures.js';
import { plainSessionRefKey, workHandoffBriefCodec } from './session-record-codecs.js';
import { workHandoffBriefConsumption, type WorkHandoffBriefV1 } from '../state/work-handoff-brief.js';

export type WorkHandoffBriefConsumptionInput = {
  brief: Pick<FrozenHandoffBriefV1, 'binding' | 'material'>;
  successor: SessionRef;
  consumer: ExecutionRef;
  at: string;
};

export type WorkHandoffBriefConsumptionDependencies = {
  records: Pick<GoalRecordTransactionPort, 'readMany'>;
};

/**
 * The stored record must still be exactly the brief the manifest froze: a moved material or binding is
 * refused, never rendered from the other side. `handedScope` rides the material, so this one comparison
 * covers it. A record already consumed by the SAME consumer contributes nothing; one consumed by another
 * execution is `unavailable`.
 */
export async function workHandoffBriefConsumptionForCommit(
  deps: WorkHandoffBriefConsumptionDependencies,
  input: WorkHandoffBriefConsumptionInput,
): Promise<{ ok: true; value: { record: EncodedRecord; guard: RecordGuard } | null } | { ok: false; rejection: CoreRejection }> {
  if (plainSessionRefKey(input.brief.binding.successor) !== plainSessionRefKey(input.successor)) {
    return { ok: false, rejection: rejected('invalid', 'the handoff brief names another successor Session') };
  }
  const ref = {
    aggregateType: 'HandoffBrief' as const,
    projectId: input.brief.binding.operation.projectId,
    sessionId: input.brief.binding.successor.sessionId,
    operationId: input.brief.binding.operation.operationId,
  };
  let read;
  try {
    read = await deps.records.readMany([canonicalKey(ref)]);
  } catch (error) {
    return { ok: false, rejection: rejected('unavailable', `the handoff brief record could not be read: ${messageOf(error)}`) };
  }
  if (read.status !== 'ready') {
    // A read never reports the claim-slot `unique_conflict` twist; pass the code/reason through unchanged.
    return { ok: false, rejection: executionStoreFailureToRejection({ code: read.code, reason: read.reason }) };
  }
  const encoded = read.value.records[0];
  if (encoded === undefined) {
    return { ok: false, rejection: rejected('unavailable', 'the prepared handoff brief record is absent') };
  }
  const decoded = workHandoffBriefCodec.decode(encoded);
  if (decoded.status !== 'decoded') {
    return { ok: false, rejection: rejected('unavailable', `the handoff brief record is damaged: ${decoded.reason}`) };
  }
  const record = decoded.value as unknown as WorkHandoffBriefV1;
  if (canonicalJson(record.binding) !== canonicalJson(input.brief.binding)
    || canonicalJson(record.material) !== canonicalJson(input.brief.material)) {
    return { ok: false, rejection: rejected('invalid', 'the stored handoff brief disagrees with the frozen manifest') };
  }
  if (record.consumedBy !== null) {
    if (canonicalKey(record.consumedBy) === canonicalKey(input.consumer)) return { ok: true, value: null };
    return { ok: false, rejection: rejected('unavailable', 'the handoff brief was consumed by another Run') };
  }
  const consumed = workHandoffBriefConsumption(record, input.consumer, input.at);
  return { ok: true, value: {
    record: workHandoffBriefCodec.encode(consumed.record), guard: consumed.guard,
  } };
}
