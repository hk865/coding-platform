/**
 * K3 rework 1 item 12.3 (decision 75): the ONE copy of the generic record,
 * string, ref and array field-check primitives the strict record codecs share.
 *
 * `unknown-call-review-codecs.ts` imports these now; the CRR codecs owner will
 * import the same names instead of maintaining a second copy. They are pure,
 * allocation-light predicates with no domain knowledge: a codec still owns its
 * own fields, ranges, events and indexes.
 */
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';

export type UnknownRecord = Record<string, unknown>;

export function isObject(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
/** `argumentsDigest` and other sha256 fields are lowercase hex. */
export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
export function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}
export function isNonNeg(value: unknown): value is number {
  return isInt(value) && value >= 0;
}
export function isPos(value: unknown): value is number {
  return isInt(value) && value >= 1;
}
export function hasOnlyKeys(value: UnknownRecord, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}
export function codePoints(value: string): number {
  return [...value].length;
}
export function inList<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}
export function parseObject(json: string): UnknownRecord | null {
  try {
    const parsed: unknown = JSON.parse(json);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
export function canonicalOf(value: unknown): string | null {
  try {
    return canonicalJson(value as JsonValue);
  } catch {
    return null;
  }
}
export function invalid(reason: string): { status: 'invalid'; reason: string } {
  return { status: 'invalid', reason };
}
