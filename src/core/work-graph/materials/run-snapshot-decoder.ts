/**
 * The ONE schema-checked RunSnapshot decoder (decision 40).
 *
 * `decodeRun` is a thin wrapper around the `RunSnapshot@1` validator that
 * `record-readers.ts` owns and registers, so it lives here beside that
 * validator: the Session directory, the mailbox and the Task readers decode a
 * Run without importing `tasks/run-state-service.ts`.
 */
import type { RunSnapshot } from '../../../contracts/dispatch.js';
import type { EncodedRecord } from '../../record-store/ports.js';
import { parseObject } from '../../../contracts/validation/common.js';
import { materialRecordSchemas } from './record-readers.js';

const RUN_SNAPSHOT_SCHEMA_ID = 'RunSnapshot@1';

/** Selected ONCE from the module that already owns and registers this schema.
 * The rules are not copied, re-registered or scanned per record. */
const RUN_VALIDATE = materialRecordSchemas().records
  .find(candidate => candidate.schemaId === RUN_SNAPSHOT_SCHEMA_ID)?.validate;

/** The ONE Run schema-checked decoder, not a new lenient parser. */
export type Decoded<T> = { ok: true; value: T } | { ok: false; reason: string };

export function decodeRun(record: EncodedRecord): Decoded<RunSnapshot> {
  if (RUN_VALIDATE === undefined) return { ok: false, reason: 'the RunSnapshot schema is not registered' };
  const checked = RUN_VALIDATE(record);
  if (checked.status !== 'decoded') return { ok: false, reason: checked.reason };
  const body = parseObject(record.json);
  if (body === null) return { ok: false, reason: 'the Run snapshot is not a JSON object' };
  return { ok: true, value: body as unknown as RunSnapshot };
}
