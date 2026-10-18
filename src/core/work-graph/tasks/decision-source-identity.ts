/**
 * The ONE parse of a decision source's `source.key` into `{ kind, body }`.
 *
 * The CRR card source and the CRR codecs both carry the same envelope
 * (`{"kind":"command_rerun_request", ...}`). The parse is deliberately generic:
 * a caller still validates its own nested payload (a ref, a revision, ...).
 */
import { parseObject } from '../../../contracts/validation/common.js';

export type ParsedDecisionSourceKey = { kind: string; body: Record<string, unknown> };

/** Parse `source.key`; null when it is not a JSON object with a non-empty string `kind`. */
export function parseDecisionSourceKey(source: { key?: unknown } | null | undefined): ParsedDecisionSourceKey | null {
  if (typeof source !== 'object' || source === null) return null;
  const key = (source as { key?: unknown }).key;
  if (typeof key !== 'string') return null;
  const body = parseObject(key);
  if (body === null) return null;
  const kind = body['kind'];
  if (typeof kind !== 'string' || kind.length === 0) return null;
  return { kind, body };
}

/** A nested object field of a parsed source body, or null when absent/not an object. */
export function nestedSourceObject(body: Record<string, unknown>, field: string): Record<string, unknown> | null {
  const value = body[field];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
