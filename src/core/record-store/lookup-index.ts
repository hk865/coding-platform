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
import { TEXT_SEARCH_MAX_TERMS, TEXT_SEARCH_PAGE_MAX, TEXT_SEARCH_TERM_MAX, TEXT_SEARCH_TERM_MIN, type LookupValue, type OrderedLookupValue, type RecordLookupIndex } from './lookup-ports.js';
import { decodeRefKey, isJsonObject, isNonEmptyString } from './record-codec.js';
import type { RecordSchemaRegistry } from './record-codec.js';

export type RegisteredLookupIndex = {
  readonly name: string;
  readonly aggregateType: string;
  /** Validated dotted JSON key paths, one per requested scalar value. */
  readonly paths: readonly string[];
  /** Validated ordering column; `valueType` is normalized to `'text'`. */
  readonly orderBy?: { readonly path: string; readonly valueType: 'text' | 'integer' };
  /**
   * Slice 4B L10: the validated text paths of a full-text index. Present only
   * when the registration carried `text`.
   */
  readonly text?: { readonly paths: readonly string[] };
};

/** Order value types that a registered `orderBy.valueType` may name (L1, D8). */
export type OrderedValueType = 'text' | 'integer';

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
    const rawOrderBy = entry['orderBy'];
    let orderBy: { path: string; valueType: OrderedValueType } | undefined;
    if (rawOrderBy !== undefined) {
      if (!isJsonObject(rawOrderBy)) registrationError(`lookup index ${name} orderBy must be an object`);
      const orderPath = validatePath(rawOrderBy['path'], name);
      const rawValueType = rawOrderBy['valueType'];
      if (rawValueType !== undefined && rawValueType !== 'text' && rawValueType !== 'integer') {
        registrationError(`lookup index ${name} orderBy valueType must be 'text' or 'integer'`);
      }
      orderBy = Object.freeze({ path: orderPath, valueType: (rawValueType ?? 'text') as OrderedValueType });
    }
    const rawText = entry['text'];
    let text: { paths: readonly string[] } | undefined;
    if (rawText !== undefined) {
      if (!isJsonObject(rawText)) registrationError(`lookup index ${name} text must be an object`);
      const textPaths = rawText['paths'];
      if (!Array.isArray(textPaths) || textPaths.length === 0) {
        registrationError(`lookup index ${name} text.paths must be a non-empty array`);
      }
      const copiedText = (textPaths as readonly unknown[]).map((textPath) => validatePath(textPath, name));
      text = Object.freeze({ paths: Object.freeze(copiedText) });
    }
    const copy: RegisteredLookupIndex = Object.freeze({
      name,
      aggregateType,
      paths: Object.freeze(copied),
      ...(orderBy === undefined ? {} : { orderBy }),
      ...(text === undefined ? {} : { text }),
    });
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
// Ordered request criteria (Slice 2A L1)
// --------------------------------------------------------------------------

export type DecodedOrderedLookupRequest = {
  readonly index: RegisteredLookupIndex;
  readonly values: readonly string[];
  readonly direction: 'asc' | 'desc';
  readonly bound: { readonly value: OrderedLookupValue; readonly inclusive: boolean } | null;
  readonly after: { readonly order: OrderedLookupValue; readonly refKey: string } | null;
  readonly limit: number;
};

export type OrderedLookupRequestDecode =
  | { readonly status: 'decoded'; readonly value: DecodedOrderedLookupRequest }
  | { readonly status: 'unsupported'; readonly reason: string }
  | { readonly status: 'invalid'; readonly reason: string };

function orderedValueProblem(valueType: OrderedValueType, value: unknown, label: string): string | null {
  if (valueType === 'integer') {
    return typeof value === 'number' && Number.isSafeInteger(value)
      ? null
      : `${label} must be a safe integer for an integer index`;
  }
  return typeof value === 'string' && value.length > 0
    ? null
    : `${label} must be a non-empty string for a text index`;
}

/**
 * The one ordered-request rule for both backends (Slice 2A L1). Everything the
 * request itself can reveal is `invalid`; an unregistered index is
 * `unsupported`; an index with no ordering column has no ordered read.
 */
export function decodeOrderedLookupRequest(
  registry: RecordLookupRegistry,
  request: unknown,
): OrderedLookupRequestDecode {
  if (!isJsonObject(request)) return { status: 'invalid', reason: 'ordered lookup request must be an object' };
  const indexName = request['index'];
  if (!isNonEmptyString(indexName)) return { status: 'invalid', reason: 'ordered lookup index must be a non-empty string' };
  const index = registry.byName(indexName);
  if (index === undefined) return { status: 'unsupported', reason: `no lookup index registered as ${indexName}` };
  const orderBy = index.orderBy;
  if (orderBy === undefined) {
    return { status: 'invalid', reason: `lookup index ${index.name} is not registered with an orderBy column` };
  }
  const rawValues = request['values'];
  if (!Array.isArray(rawValues)) return { status: 'invalid', reason: 'ordered lookup values must be an array' };
  const values = rawValues as readonly unknown[];
  if (values.length !== index.paths.length) {
    return {
      status: 'invalid',
      reason: `ordered lookup index ${index.name} requires exactly ${String(index.paths.length)} values`,
    };
  }
  for (const value of values) {
    if (!isNonEmptyString(value)) {
      return { status: 'invalid', reason: 'ordered lookup values must all be non-empty strings' };
    }
  }
  const rawDirection = request['direction'];
  if (rawDirection !== 'asc' && rawDirection !== 'desc') {
    return { status: 'invalid', reason: "ordered lookup direction must be 'asc' or 'desc'" };
  }
  const limit = request['limit'];
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 200) {
    return { status: 'invalid', reason: 'ordered lookup limit must be an integer between 1 and 200' };
  }
  const rawBound = request['bound'];
  let bound: { value: OrderedLookupValue; inclusive: boolean } | null = null;
  if (rawBound !== undefined) {
    if (!isJsonObject(rawBound)) return { status: 'invalid', reason: 'ordered lookup bound must be an object' };
    if (typeof rawBound['inclusive'] !== 'boolean') {
      return { status: 'invalid', reason: 'ordered lookup bound.inclusive must be a boolean' };
    }
    const problem = orderedValueProblem(orderBy.valueType, rawBound['value'], 'ordered lookup bound.value');
    if (problem !== null) return { status: 'invalid', reason: problem };
    bound = Object.freeze({ value: rawBound['value'] as OrderedLookupValue, inclusive: rawBound['inclusive'] as boolean });
  }
  const rawAfter = request['after'];
  let after: { order: OrderedLookupValue; refKey: string } | null = null;
  if (rawAfter !== undefined) {
    if (!isJsonObject(rawAfter)) return { status: 'invalid', reason: 'ordered lookup after must be an object' };
    const orderProblem = orderedValueProblem(orderBy.valueType, rawAfter['order'], 'ordered lookup after.order');
    if (orderProblem !== null) return { status: 'invalid', reason: orderProblem };
    const refKey = rawAfter['refKey'];
    if (typeof refKey !== 'string') {
      return { status: 'invalid', reason: 'ordered lookup after.refKey must be a full canonical refKey' };
    }
    const decodedKey = decodeRefKey(refKey);
    if (decodedKey.status === 'invalid') {
      return { status: 'invalid', reason: `ordered lookup after.refKey is not a canonical refKey: ${decodedKey.reason}` };
    }
    if (decodedKey.value.aggregateType !== index.aggregateType) {
      return {
        status: 'invalid',
        reason: `ordered lookup after.refKey aggregateType ${decodedKey.value.aggregateType} does not match ${index.aggregateType}`,
      };
    }
    after = Object.freeze({ order: rawAfter['order'] as OrderedLookupValue, refKey });
  }
  return {
    status: 'decoded',
    value: Object.freeze({
      index,
      values: Object.freeze([...values]) as readonly string[],
      direction: rawDirection,
      bound,
      after,
      limit,
    }),
  };
}

// --------------------------------------------------------------------------
// Count request criteria (Slice 2C L3)
// --------------------------------------------------------------------------

export type DecodedCountRequest = {
  readonly index: RegisteredLookupIndex;
  /** Equality values; with `distinctPath` set these are only the prefixes. */
  readonly values: readonly LookupValue[];
  /** Last registered path to count distinct values of, or null for a row count. */
  readonly distinctPath: string | null;
};

export type CountRequestDecode =
  | { readonly status: 'decoded'; readonly value: DecodedCountRequest }
  | { readonly status: 'unsupported'; readonly reason: string }
  | { readonly status: 'invalid'; readonly reason: string };

/**
 * The one count-request rule for both backends (Slice 2C L3). Without
 * `distinctPath`, validation is exactly `decodeLookupRequest` without
 * limit/after. With `distinctPath`, it must be the index's LAST path, `values`
 * names only the preceding paths, and an ordered index is rejected.
 */
export function decodeCountRequest(registry: RecordLookupRegistry, request: unknown): CountRequestDecode {
  if (!isJsonObject(request)) return { status: 'invalid', reason: 'count request must be an object' };
  const indexName = request['index'];
  if (!isNonEmptyString(indexName)) return { status: 'invalid', reason: 'count index must be a non-empty string' };
  const index = registry.byName(indexName);
  if (index === undefined) return { status: 'unsupported', reason: `no lookup index registered as ${indexName}` };
  const rawValues = request['values'];
  if (!Array.isArray(rawValues)) return { status: 'invalid', reason: 'count values must be an array' };
  const values = rawValues as readonly unknown[];
  const rawDistinctPath = request['distinctPath'];
  if (rawDistinctPath !== undefined) {
    if (!isNonEmptyString(rawDistinctPath)) {
      return { status: 'invalid', reason: 'count distinctPath must be a non-empty string' };
    }
    if (index.orderBy !== undefined) {
      return {
        status: 'invalid',
        reason: `lookup index ${index.name} is ordered and does not support distinctPath`,
      };
    }
    if (index.paths[index.paths.length - 1] !== rawDistinctPath) {
      return { status: 'invalid', reason: `count distinctPath must be the last path of lookup index ${index.name}` };
    }
    const expected = index.paths.length - 1;
    if (values.length !== expected) {
      return {
        status: 'invalid',
        reason: `lookup index ${index.name} requires exactly ${String(expected)} values before distinctPath`,
      };
    }
    for (const value of values) {
      if (!isLookupValue(value)) {
        return { status: 'invalid', reason: 'count values must be a string, finite number, boolean or null' };
      }
    }
    return {
      status: 'decoded',
      value: Object.freeze({
        index,
        values: Object.freeze([...values]) as readonly LookupValue[],
        distinctPath: rawDistinctPath,
      }),
    };
  }
  if (values.length !== index.paths.length) {
    return {
      status: 'invalid',
      reason: `lookup index ${index.name} requires exactly ${String(index.paths.length)} values`,
    };
  }
  if (index.orderBy !== undefined) {
    for (const value of values) {
      if (!isNonEmptyString(value)) {
        return { status: 'invalid', reason: 'count values for an ordered index must all be non-empty strings' };
      }
    }
  } else {
    for (const value of values) {
      if (!isLookupValue(value)) {
        return { status: 'invalid', reason: 'count values must be a string, finite number, boolean or null' };
      }
    }
  }
  return {
    status: 'decoded',
    value: Object.freeze({
      index,
      values: Object.freeze([...values]) as readonly LookupValue[],
      distinctPath: null,
    }),
  };
}

/**
 * Slice 2A L1 continuation range term. SQLite can seek only the first range
 * term on the ordered expression, so `lookupOrdered` may write exactly one
 * range term on the order column (a lower one for `asc`, an upper one for
 * `desc`); every other order-column condition stays a residual filter. This
 * computes that one term from `bound` and `after`, comparing them with the
 * order the index uses, and says whether the `(order, ref_key)` row-value filter
 * is still needed for the ties.
 */
export type OrderedRangePlan = {
  /** `null` only when the request gives neither a bound nor an after. */
  readonly term: { readonly value: OrderedLookupValue; readonly inclusive: boolean } | null;
  /** Whether the `(order, ref_key)` row-value filter still excludes ties. */
  readonly keyset: boolean;
};

export function orderedRangePlanOf(request: DecodedOrderedLookupRequest): OrderedRangePlan {
  const valueType = request.index.orderBy?.valueType ?? 'text';
  const bound = request.bound;
  const after = request.after;
  if (after === null) {
    return bound === null
      ? { term: null, keyset: false }
      : { term: { value: bound.value, inclusive: bound.inclusive }, keyset: false };
  }
  if (bound === null) {
    return { term: { value: after.order, inclusive: true }, keyset: true };
  }
  const compared = compareOrderedValues(valueType, after.order, bound.value);
  // "after comes later in the index order": ascending is the natural order,
  // descending its mirror.
  const afterIsLater = request.direction === 'asc' ? compared > 0 : compared < 0;
  if (afterIsLater) {
    return { term: { value: after.order, inclusive: true }, keyset: true };
  }
  if (compared !== 0) {
    // after is at or before the bound, so the bound alone already excludes it.
    return { term: { value: bound.value, inclusive: bound.inclusive }, keyset: false };
  }
  // Equal order values: the bound's inclusivity decides whether ties remain.
  return bound.inclusive
    ? { term: { value: bound.value, inclusive: true }, keyset: true }
    : { term: { value: bound.value, inclusive: false }, keyset: false };
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

/**
 * Slice 2C L3 distinct key for one scalar path value: the same four type
 * classes (text / number / true / false) with numbers normalized exactly like
 * equality encoding. `null` when the value is null, missing or composite, so
 * those rows are never a distinct value.
 */
export function distinctLookupValueKeyOf(body: Record<string, unknown>, path: string): string | null {
  const resolved = resolvePath(body, path);
  if (resolved.kind !== 'value' || resolved.value === null) return null;
  return encodeLookupValues([resolved.value]);
}

/**
 * Slice 2A L1 candidate rule for an ordered index: `text` sorts on non-empty
 * text only; `integer` sorts on a safe JSON integer only. Missing, null,
 * composite, boolean, non-integer number, or numeric-looking text are all
 * non-candidates (and are read through the plain equality path instead).
 */
export function orderedLookupCandidateOf(
  index: RegisteredLookupIndex,
  body: Record<string, unknown>,
): { readonly present: true; readonly value: OrderedLookupValue } | { readonly present: false } {
  const orderBy = index.orderBy;
  if (orderBy === undefined) return { present: false };
  const resolved = resolvePath(body, orderBy.path);
  if (resolved.kind !== 'value' || resolved.value === null) return { present: false };
  if (orderBy.valueType === 'integer') {
    return typeof resolved.value === 'number' && Number.isSafeInteger(resolved.value)
      ? { present: true, value: resolved.value }
      : { present: false };
  }
  return typeof resolved.value === 'string' && resolved.value.length > 0
    ? { present: true, value: resolved.value }
    : { present: false };
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

/**
 * Slice 2A L1 order-value comparison shared by both backends: text by UTF-8
 * byte order (SQLite BINARY), integer numerically.
 */
export function compareOrderedValues(
  valueType: OrderedValueType,
  left: OrderedLookupValue,
  right: OrderedLookupValue,
): number {
  if (valueType === 'integer') {
    const leftNumber = left as number;
    const rightNumber = right as number;
    if (leftNumber < rightNumber) return -1;
    if (leftNumber > rightNumber) return 1;
    return 0;
  }
  return compareRefKeys(left as string, right as string);
}

/**
 * Whether one candidate satisfies BOTH the optional `bound` and the optional
 * `after` keyset of a decoded ordered request (their intersection, L1).
 */
export function matchesOrderedRequest(
  request: DecodedOrderedLookupRequest,
  order: OrderedLookupValue,
  refKey: string,
): boolean {
  const valueType = request.index.orderBy?.valueType ?? 'text';
  if (request.bound !== null) {
    const compared = compareOrderedValues(valueType, order, request.bound.value);
    if (request.direction === 'asc') {
      if (request.bound.inclusive ? compared < 0 : compared <= 0) return false;
    } else if (request.bound.inclusive ? compared > 0 : compared >= 0) {
      return false;
    }
  }
  if (request.after !== null) {
    const compared = compareOrderedValues(valueType, order, request.after.order);
    if (request.direction === 'asc') {
      if (compared < 0) return false;
      if (compared === 0 && compareRefKeys(refKey, request.after.refKey) <= 0) return false;
    } else {
      if (compared > 0) return false;
      if (compared === 0 && compareRefKeys(refKey, request.after.refKey) >= 0) return false;
    }
  }
  return true;
}

// --------------------------------------------------------------------------
// Full-text comparison text and term windows (Slice 4B L10)
// --------------------------------------------------------------------------

const WHITE_SPACE = /\p{White_Space}/u;

/** L10: NFC, then ASCII letters lowercased, iterated by code point. */
export function normalizeSearchText(text: string): string {
  return text.normalize('NFC').replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/**
 * L10: every overlapping two-code-point window of `text` that contains no
 * whitespace, encoded as one ASCII token `b<hex1>_<hex2>` (lowercase code
 * point hex). Duplicates are removed so the result is the window set.
 */
export function bigramWindows(text: string): readonly string[] {
  const points = [...text];
  const windows = new Set<string>();
  for (let position = 0; position + 1 < points.length; position += 1) {
    const left = points[position]!;
    const right = points[position + 1]!;
    if (WHITE_SPACE.test(left) || WHITE_SPACE.test(right)) continue;
    windows.add(`b${left.codePointAt(0)!.toString(16)}_${right.codePointAt(0)!.toString(16)}`);
  }
  return Object.freeze([...windows]);
}

/**
 * L10 comparison text: the registered text paths joined with `"\n"` and then
 * normalized once. A missing, null, composite or non-text value contributes the
 * empty string (the schemas store these fields as text).
 */
export function searchTextFrom(body: Record<string, unknown>, paths: readonly string[]): string {
  const parts: string[] = [];
  for (const path of paths) {
    const resolved = resolvePath(body, path);
    parts.push(resolved.kind === 'value' && typeof resolved.value === 'string' ? resolved.value : '');
  }
  return normalizeSearchText(parts.join('\n'));
}

/** The union of every term's window set, used as the SQLite candidate query. */
function windowsForTerms(terms: readonly string[]): readonly string[] {
  const windows = new Set<string>();
  for (const term of terms) {
    for (const window of bigramWindows(term)) windows.add(window);
  }
  return Object.freeze([...windows]);
}

/**
 * L10 substring rule for one candidate's comparison text: every term must be a
 * substring (the `'all'` rule). This is the one place the backends call it.
 */
export function textSearchMatches(comparisonText: string, terms: readonly string[]): boolean {
  return terms.every((term) => comparisonText.includes(term));
}

// --------------------------------------------------------------------------
// Full-text request criteria (Slice 4B L10)
// --------------------------------------------------------------------------

export type DecodedTextSearchRequest = {
  readonly index: RegisteredLookupIndex;
  readonly values: readonly string[];
  readonly terms: readonly string[];
  readonly windows: readonly string[];
  readonly after: string | null;
  readonly limit: number;
};

export type TextSearchRequestDecode =
  | { readonly status: 'decoded'; readonly value: DecodedTextSearchRequest }
  | { readonly status: 'unsupported'; readonly reason: string }
  | { readonly status: 'invalid'; readonly reason: string };

/**
 * The one full-text request rule for both backends. Shape and bound checks live
 * here so the two backends cannot disagree.
 */
export function decodeTextSearchRequest(registry: RecordLookupRegistry, request: unknown): TextSearchRequestDecode {
  if (!isJsonObject(request)) return { status: 'invalid', reason: 'text search request must be an object' };
  const indexName = request['index'];
  if (!isNonEmptyString(indexName)) return { status: 'invalid', reason: 'text search index must be a non-empty string' };
  const index = registry.byName(indexName);
  if (index === undefined) return { status: 'unsupported', reason: `no lookup index registered as ${indexName}` };
  if (index.text === undefined) {
    return { status: 'unsupported', reason: `lookup index ${index.name} is not registered as a full-text index` };
  }
  const rawValues = request['values'];
  if (!Array.isArray(rawValues)) return { status: 'invalid', reason: 'text search values must be an array' };
  const values = rawValues as readonly unknown[];
  if (values.length !== index.paths.length) {
    return {
      status: 'invalid',
      reason: `text search index ${index.name} requires exactly ${String(index.paths.length)} values`,
    };
  }
  for (const value of values) {
    if (!isNonEmptyString(value)) {
      return { status: 'invalid', reason: 'text search values must all be non-empty strings' };
    }
  }
  const rawTerms = request['terms'];
  if (!Array.isArray(rawTerms)) return { status: 'invalid', reason: 'text search terms must be an array' };
  const rawTermList = rawTerms as readonly unknown[];
  if (rawTermList.length < 1 || rawTermList.length > TEXT_SEARCH_MAX_TERMS) {
    return {
      status: 'invalid',
      reason: `text search requires 1 to ${String(TEXT_SEARCH_MAX_TERMS)} terms`,
    };
  }
  const terms: string[] = [];
  for (const rawTerm of rawTermList) {
    if (typeof rawTerm !== 'string') return { status: 'invalid', reason: 'text search terms must be strings' };
    const term = normalizeSearchText(rawTerm);
    const length = [...term].length;
    if (length < TEXT_SEARCH_TERM_MIN || length > TEXT_SEARCH_TERM_MAX) {
      return {
        status: 'invalid',
        reason: `a text search term must be ${String(TEXT_SEARCH_TERM_MIN)} to ${String(TEXT_SEARCH_TERM_MAX)} code points`,
      };
    }
    if (WHITE_SPACE.test(term)) {
      return { status: 'invalid', reason: 'a text search term must not contain whitespace' };
    }
    terms.push(term);
  }
  const limit = request['limit'];
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > TEXT_SEARCH_PAGE_MAX) {
    return {
      status: 'invalid',
      reason: `text search limit must be an integer between 1 and ${String(TEXT_SEARCH_PAGE_MAX)}`,
    };
  }
  const rawAfter = request['after'];
  let after: string | null = null;
  if (rawAfter !== undefined) {
    if (typeof rawAfter !== 'string') {
      return { status: 'invalid', reason: 'text search after must be a full canonical refKey' };
    }
    const decodedKey = decodeRefKey(rawAfter);
    if (decodedKey.status === 'invalid') {
      return { status: 'invalid', reason: `text search after is not a canonical refKey: ${decodedKey.reason}` };
    }
    if (decodedKey.value.aggregateType !== index.aggregateType) {
      return {
        status: 'invalid',
        reason: `text search after aggregateType ${decodedKey.value.aggregateType} does not match ${index.aggregateType}`,
      };
    }
    after = rawAfter;
  }
  return {
    status: 'decoded',
    value: Object.freeze({
      index,
      values: Object.freeze([...values]) as readonly string[],
      terms: Object.freeze(terms),
      windows: windowsForTerms(terms),
      after,
      limit,
    }),
  };
}
