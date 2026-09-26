/** Mechanical final-guard decode. Call only inside the backend's atomic write
 * segment; both backends must pass the exact stored body for the guarded key.
 * The caller maps invalid to corrupt, never to a revision conflict. */
import type { DecodeResult } from './ports.js';
import { applyRecordSchema, decodeRecordBody, decodeRefKey, type RecordSchemaRegistry } from './record-codec.js';

export function decodeGuardedRevision(
  registry: RecordSchemaRegistry,
  refKey: string,
  storedJson: string | null,
): DecodeResult<number | null> {
  const key = decodeRefKey(refKey);
  if (key.status === 'invalid') return key;
  const schema = registry.recordByAggregateType(key.value.aggregateType);
  if (schema === undefined) {
    return { status: 'invalid', reason: `no guard record schema registered for ${key.value.aggregateType}` };
  }
  if (storedJson === null) return { status: 'decoded', value: null };
  const decoded = decodeRecordBody({ refKey, schemaId: schema.schemaId, revision: null, json: storedJson });
  if (decoded.status === 'invalid') return decoded;
  const applied = applyRecordSchema(decoded.value, schema);
  if (applied.status === 'invalid') return applied;
  return { status: 'decoded', value: applied.value.record.revision };
}
