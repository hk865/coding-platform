/**
 * The ONE owner single-record read.
 *
 * `CommandRerunRequest` and `UnknownCallReview` each read exactly one record by
 * refKey: ONE `readMany([refKey])`, the owner read-failure map for a non-ready
 * batch, `{ notFound: true }` when the batch holds no matching record, and
 * `invalid` when the stored record does not decode. Each owner keeps its own
 * complete error texts, so the store-read and decode-failure rejections are
 * parameters, not one shared message. A missing record is not a rejection: the
 * caller decides (`not_found` or a derived read).
 */
import type { CoreRejection } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { DecodeResult, EncodedRecord, GoalRecordTransactionPort } from '../../record-store/ports.js';
import { ownerReadStoreFailureToRejection } from '../persistence/read-result-failures.js';

export type OwnerRecordRead<T> =
  | { ok: true; value: T }
  | { ok: false; rejection: CoreRejection }
  | { ok: false; notFound: true };

export async function readOwnerRecord<T>(input: {
  store: Pick<GoalRecordTransactionPort, 'readMany'>;
  refKey: string;
  decode(record: EncodedRecord): DecodeResult<T>;
  readError(message: string): CoreRejection;
}): Promise<OwnerRecordRead<T>> {
  let batch;
  try {
    batch = await input.store.readMany([input.refKey]);
  } catch (error) {
    return { ok: false, rejection: input.readError(error instanceof Error ? error.message : String(error)) };
  }
  if (batch.status !== 'ready') return { ok: false, rejection: ownerReadStoreFailureToRejection(batch) };
  const encoded = batch.value.records.find(record => record.refKey === input.refKey);
  if (encoded === undefined) return { ok: false, notFound: true };
  // The store already applied the registered schema (the same decoder), so a
  // ready record cannot fail to decode; keep ONE fixed fail-closed rejection.
  const decoded = input.decode(encoded);
  if (decoded.status !== 'decoded') return { ok: false, rejection: rejected('invalid', 'the stored record is not decodable') };
  return { ok: true, value: decoded.value };
}
