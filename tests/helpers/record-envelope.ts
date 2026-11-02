import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { EncodedRecord } from '../../src/core/record-store/ports.js';

/** The store envelope a record decoder reads: the codec's documented `canonicalJson(ref)` key, schemaId, revision. */
export function encodedRecord(schemaId: string, body: Record<string, unknown>): EncodedRecord {
  return { refKey: canonicalJson(body['ref'] as JsonValue), schemaId,
    revision: body['revision'] as number, json: JSON.stringify(body) };
}
