/**
 * Shared lookup-index registration, candidate-key and request criteria (N0/R3c).
 *
 * Both physical backends import this module, so the trusted schema owner's
 * registration is validated once and the scalar/dotted-path interpretation and
 * request rules exist exactly once. Each backend only owns its candidate store:
 * in-memory value buckets or SQLite expression indexes.
 *
 * This module performs no I/O and opens no database. It imports no WorkGraph
 * module and never exposes SQL, a connection or mutable state.
 */
import type { LookupValue, RecordLookupIndex } from './lookup-ports.js';
import { decodeRefKey, isJsonObject, isNonEmptyString } from './record-codec.js';
import type { RecordSchemaRegistry } from './record-codec.js';

export type RegisteredLookupIndex = {
  readonly name: string;
  readonly aggregateType: string;
  /** Validated dotted JSON key paths, one per requested scalar value. */
  readonly paths: readonly string[];
};

export type RecordLookupRegistry = {
  readonly indexes: readonly RegisteredLookupIndex[];
  byName(name: string): RegisteredLookupIndex | undefined;
};

export class RecordLookupRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordLookupRegistrationError';
  }
}

function registrationError(message: string): never {
  throw new RecordLookupRegistrationError(`RecordStore lookup registration: ${message}`);
}

/** JSON keys that could reach an object prototype; never valid dotted segments. */
const PROTOTYPE_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
/** Conservative safe JSON member name: no quotes, dots, brackets or whitespace. */
const SAFE_SEGMENT = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function validatePath(rawPath: unknown, indexName: string): string {
  if (!isNonEmptyString(rawPath)) registrationError(`lookup ${indexName} path must be a non-empty string`);
  for (const segment of rawPath.split('.')) {
    if (segment.length === 0) registrationError(`lookup ${indexName} path ${rawPath} has an empty segment`);
    if (PROTOTYPE_KEYS.has(segment)) registrationError(`lookup ${indexName} path ${rawPath} uses a prototype key`);
    if (!SAFE_SEGMENT.test(segment)) registrationError(`lookup ${indexName} path ${rawPath} is not a safe dotted JSON key path`);
  }
  return rawPath;
}

/**
 * Validate and defensively copy `schemas.lookups` before any backend exists.
 * Rejects a non-array registration, empty/duplicate names, an aggregateType with
 * no registered record schema, empty path lists, empty segments, prototype keys
 * and every path that is not a safe dotted JSON member path.
 */
export function createRecordLookupRegistry(
  schemas: { readonly lookups?: readonly RecordLookupIndex[] },
  records: Pick<RecordSchemaRegistry, 'recordByAggregateType'>,
): RecordLookupRegistry {
  const raw: unknown = schemas.lookups;
  if (raw === undefined) {
    return Object.freeze({ indexes: Object.freeze([]) as readonly RegisteredLookupIndex[], byName: () => undefined });
  }
  if (!Array.isArray(raw)) registrationError('schemas.lookups must be an array');
  const entries = raw as readonly unknown[];
  const indexes: RegisteredLookupIndex[] = [];
  const byName = new Map<string, RegisteredLookupIndex>();
  for (const entry of entries) {
    if (!isJsonObject(entry)) registrationError('every lookup index must be an object');
    const name = entry['name'];
    const aggregateType = entry['aggregateType'];
    const paths = entry['paths'];
    if (!isNonEmptyString(name)) registrationError('lookup index name must be a non-empty string');
    if (byName.has(name)) registrationError(`duplicate lookup index name ${name}`);
    if (!isNonEmptyString(aggregateType)) registrationError(`lookup index ${name} aggregateType must be a non-empty string`);
    if (records.recordByAggregateType(aggregateType) === undefined) {
      registrationError(`lookup index ${name} aggregateType ${aggregateType} has no registered record schema`);
    }
    if (!Array.isArray(paths) || paths.length === 0) registrationError(`lookup index ${name} paths must be a non-empty array`);
    const copied = (paths as readonly unknown[]).map((path) => validatePath(path, name));
    const copy: RegisteredLookupIndex = Object.freeze({ name, aggregateType, paths: Object.freeze(copied) });
    indexes.push(copy);
    byName.set(name, copy);
  }
  return Object.freeze({ indexes: Object.freeze(indexes), byName: (name: string) => byName.get(name) });
}

// --------------------------------------------------------------------------
// Request criteria
// --------------------------------------------------------------------------

export type DecodedLookupRequest = {
  readonly index: RegisteredLookupIndex;
  readonly values: readonly LookupValue[];
  readonly after: string | null;
  readonly limit: number;
};

export type LookupRequestDecode =
  | { readonly status: 'decoded'; readonly value: DecodedLookupRequest }
  | { readonly status: 'unsupported'; readonly reason: string }
  | { readonly status: 'invalid'; readonly reason: string };

function isLookupValue(value: unknown): value is LookupValue {
  return value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value));
}

/**
 * The one request rule for both backends: a registered index, exactly one
 * scalar value per registered path, an integer limit 1..200 and an optional
 * full canonical refKey from the same aggregateType as an exclusive keyset.
 * No SQL or unbounded request can pass through.
 */
export function decodeLookupRequest(registry: RecordLookupRegistry, request: unknown): LookupRequestDecode {
  if (!isJsonObject(request)) return { status: 'invalid', reason: 'lookup request must be an object' };
  const indexName = request['index'];
  if (!isNonEmptyString(indexName)) return { status: 'invalid', reason: 'lookup index must be a non-empty string' };
  const index = registry.byName(indexName);
  if (index === undefined) return { status: 'unsupported', reason: `no lookup index registered as ${indexName}` };
  const rawValues = request['values'];
  if (!Array.isArray(rawValues)) return { status: 'invalid', reason: 'lookup values must be an array' };
  const values = rawValues as readonly unknown[];
  if (values.length !== index.paths.length) {
    return { status: 'invalid', reason: `lookup index ${index.name} requires exactly ${index.paths.length} values` };
  }
  for (const value of values) {
    if (!isLookupValue(value)) {
      return { status: 'invalid', reason: 'lookup values must be a string, finite number, boolean or null' };
    }
  }
  const limit = request['limit'];
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 200) {
    return { status: 'invalid', reason: 'lookup limit must be an integer between 1 and 200' };
  }
  const rawAfter = request['after'];
  let after: string | null = null;
  if (rawAfter !== undefined) {
    if (typeof rawAfter !== 'string') return { status: 'invalid', reason: 'lookup after must be a full canonical refKey' };
    const decodedKey = decodeRefKey(rawAfter);
    if (decodedKey.status === 'invalid') {
      return { status: 'invalid', reason: `lookup after is not a canonical refKey: ${decodedKey.reason}` };
    }
    if (decodedKey.value.aggregateType !== index.aggregateType) {
      return {
        status: 'invalid',
        reason: `lookup after aggregateType ${decodedKey.value.aggregateType} does not match ${index.aggregateType}`,
      };
    }
    after = rawAfter;
  }
  return {
    status: 'decoded',
    value: Object.freeze({ index, values: Object.freeze([...values]) as readonly LookupValue[], after, limit }),
  };
}

// --------------------------------------------------------------------------
// Dotted-path scalar extraction + candidate keys (in-memory candidate store)
// --------------------------------------------------------------------------

type ResolvedPath =
  | { readonly kind: 'value'; readonly value: LookupValue }
  | { readonly kind: 'missing' }
  | { readonly kind: 'composite' };

function resolvePath(body: Record<string, unknown>, path: string): ResolvedPath {
  let current: unknown = body;
  for (const segment of path.split('.')) {
    if (!isJsonObject(current)) return { kind: 'missing' };
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return { kind: 'missing' };
    current = current[segment];
  }
  if (current === undefined || current === null) return { kind: 'value', value: null };
  if (typeof current === 'string' || typeof current === 'boolean') return { kind: 'value', value: current };
  if (typeof current === 'number' && Number.isFinite(current)) return { kind: 'value', value: current };
  return { kind: 'composite' };
}

/** Stable, collision-free encoding of one scalar tuple (types are preserved). */
export function encodeLookupValues(values: readonly LookupValue[]): string {
  const parts: string[] = [];
  for (const value of values) {
    if (value === null) parts.push('0');
    else if (typeof value === 'boolean') parts.push(value ? 'b1' : 'b0');
    else if (typeof value === 'number') parts.push(`d${String(value)}`);
    else parts.push(`s${value.length}:${value}`);
  }
  return parts.map((part) => `${part.length}:${part}`).join('');
}

/**
 * Candidate key for one registered index from a parsed record body. Missing
 * fields are null. A composite at any registered scalar path is not a scalar:
 * `null` is returned so the row is simply not a candidate (it must never be
 * coerced into a scalar).
 */
export function lookupIndexKeyOf(index: RegisteredLookupIndex, body: Record<string, unknown>): string | null {
  const values: LookupValue[] = [];
  for (const path of index.paths) {
    const resolved = resolvePath(body, path);
    if (resolved.kind === 'composite') return null;
    values.push(resolved.kind === 'missing' ? null : resolved.value);
  }
  return encodeLookupValues(values);
}

/** Backend-agnostic classification of a request scalar (booleans stay booleans). */
export type LookupValueMatcher =
  | { readonly kind: 'null' }
  | { readonly kind: 'boolean'; readonly value: boolean; readonly jsonType: 'true' | 'false' }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'string'; readonly value: string };

export function lookupMatcherOf(value: LookupValue): LookupValueMatcher {
  if (value === null) return { kind: 'null' };
  if (typeof value === 'boolean') return { kind: 'boolean', value, jsonType: value ? 'true' : 'false' };
  if (typeof value === 'number') return { kind: 'number', value };
  return { kind: 'string', value };
}

/**
 * Stable ascending full-refKey order shared by both backends: UTF-8 byte order
 * on the canonical key, which is exactly SQLite's BINARY collation. Comparing
 * JS UTF-16 code units instead would sort supplementary-plane characters before
 * BMP ones, so it cannot be used here.
 */
export function compareRefKeys(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
