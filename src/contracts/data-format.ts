/**
 * Field-table data formats. A record, an event or a nested shape writes its fields once, as a runtime description;
 * its TypeScript type is inferred from that description, and the value check (`validation/data-format.ts`) and the
 * RecordStore adapter (`core/work-graph/persistence/field-table-codec.ts`) read the same description. One field list
 * therefore serves the type, the check, encode, decode and the registration, so they cannot drift apart.
 *
 * The field kinds are a closed set. A rule across several fields stays a named pure function in `rules`; a decision
 * that depends on current facts stays with its owner, and every state change still goes through
 * `core/work-graph/state/`. A description is checked when it is built (at module load): a bad description throws
 * `<what> description is invalid: <detail>` and never reaches a value check.
 */
import type { CommitCursor } from './command-event.js';
import { isInt, nonEmpty } from './validation/common.js';

/** `pending`: a value about to be committed, whose bound cursors may still be `null`; `stored`: a value as stored. */
export type FieldPhase = 'pending' | 'stored';
/** A pure check across fields: the reason, or `null`. It reads no store and changes nothing. */
export type ShapeRule = (value: unknown) => string | null;
/** A candidate index of a record: equality paths, at most one order column and full-text paths. */
export type Lookup = {
  name: string;
  equal: readonly string[];
  orderBy?: { path: string; valueType: 'text' | 'integer' };
  text?: readonly string[];
};

/** The four top-level fields the Store may fill with the commit cursor (the closed `commitCursorFields` set). */
type BoundCursorName = 'since' | 'until' | 'unavailableSince' | 'responseSince';
const BOUND_CURSOR_NAMES: readonly string[] = ['since', 'until', 'unavailableSince', 'responseSince'];
/** The four envelope keys every event carries outside its own fields. */
const ENVELOPE_KEYS: readonly string[] = ['eventId', 'eventType', 'schemaVersion', 'occurredAt'];

/** One field description; the builders in `f` make them. */
export type Field =
  | { readonly kind: 'string'; readonly min?: number; readonly max?: number; readonly unit?: 'utf8Bytes' | 'codePoints' }
  | { readonly kind: 'sha256' }
  | { readonly kind: 'integer'; readonly min: number; readonly max?: number }
  | {
    readonly kind: 'finite'; readonly min?: number; readonly max?: number;
    readonly minExclusive?: boolean; readonly maxExclusive?: boolean;
  }
  | { readonly kind: 'revision'; readonly min: 0 | 1 }
  | { readonly kind: 'literal'; readonly value: string | number | boolean }
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'ref'; readonly shape: Shape<Fields> }
  | { readonly kind: 'cursor'; readonly cursor: 'ledger' | 'ledgerNonZero' | 'kernel' }
  | { readonly kind: 'boundCursor'; readonly field: BoundCursorName }
  | { readonly kind: 'isoTime' }
  | { readonly kind: 'optional'; readonly field: Field }
  | { readonly kind: 'nullable'; readonly field: Field }
  | { readonly kind: 'array'; readonly element: Field; readonly min?: number; readonly max?: number }
  | { readonly kind: 'object'; readonly fields: Fields }
  | { readonly kind: 'union'; readonly tag: string; readonly branches: { readonly [branch: string]: Fields } };
export type Fields = { readonly [key: string]: Field };

/** A nested shape, e.g. a ref: its fields and the rules that run after them. */
export type Shape<F extends Fields> = {
  readonly kind: 'shape'; readonly name: string; readonly fields: F; readonly rules: readonly ShapeRule[];
};
/** A stored record: `fields` declares `ref` (a full tagged ref) and `revision`. */
export type RecordFormat<F extends Fields> = {
  readonly kind: 'record'; readonly name: string; readonly schemaId: string; readonly aggregateType: string;
  readonly fields: F; readonly rules: readonly ShapeRule[]; readonly lookups: readonly Lookup[];
};
export type EventFormat<E extends string, F extends Fields> = {
  name: string;
  eventType: E;
  schemaVersion: 1;
  fields: F; // every top-level field outside the four envelope keys
  rules?: readonly ShapeRule[];
};

/**
 * The value type of one field. A bound cursor is `CommitCursor` when stored and may still be `null` while pending;
 * an optional field infers its inner type here because `ShapeOf` makes the key itself optional.
 */
type InferField<T, P extends FieldPhase> =
  T extends { kind: 'string' | 'sha256' | 'isoTime' } ? string
  : T extends { kind: 'integer' | 'finite' | 'revision' } ? number
  : T extends { kind: 'literal'; value: infer V } ? V
  : T extends { kind: 'enum'; values: readonly (infer V)[] } ? V
  : T extends { kind: 'boolean' } ? boolean
  : T extends { kind: 'ref'; shape: { fields: infer F extends Fields } } ? InferShape<F>
  : T extends { kind: 'cursor'; cursor: 'kernel' } ? string
  : T extends { kind: 'cursor' } ? CommitCursor
  : T extends { kind: 'boundCursor' } ? (P extends 'pending' ? CommitCursor | null : CommitCursor)
  : T extends { kind: 'optional'; field: infer I } ? InferField<I, P>
  : T extends { kind: 'nullable'; field: infer I } ? InferField<I, P> | null
  : T extends { kind: 'array'; element: infer E } ? InferField<E, P>[]
  : T extends { kind: 'object'; fields: infer F extends Fields } ? InferShape<F>
  : T extends { kind: 'union'; branches: infer B extends { readonly [branch: string]: Fields } }
    ? { [N in keyof B]: InferShape<B[N]> }[keyof B]
  : never;
/**
 * The object a field table describes: required keys required, `f.optional` keys `?:` (absent, never `undefined`).
 * Both halves keep each key's declaration, so a type derived from a format still names the format's fields;
 * `-readonly` keeps an inferred record as mutable as a hand-written one.
 */
type ShapeOf<F extends Fields, P extends FieldPhase> =
  & { -readonly [K in keyof F as F[K] extends { kind: 'optional' } ? never : K]: InferField<F[K], P> }
  & { -readonly [K in keyof F as F[K] extends { kind: 'optional' } ? K : never]?: InferField<F[K], P> };
export type InferShape<F extends Fields> = ShapeOf<F, 'stored'>;
/** A record as stored: every bound cursor is a real `CommitCursor` (`null` only under `f.nullable`). */
export type InferRecord<F extends Fields> = ShapeOf<F, 'stored'>;
/** A record before commit: a bound cursor may be `null`, for the Store to fill from the commit cursor. */
export type InferPending<F extends Fields> = ShapeOf<F, 'pending'>;
export type InferEvent<E extends string, F extends Fields> = {
  eventId: string;
  eventType: E;
  schemaVersion: 1;
  occurredAt: string;
} & InferShape<F>;

function invalidDescription(what: string, detail: string): never {
  throw new Error(`${what} description is invalid: ${detail}`);
}
/** Length and count bounds are non-negative safe integers, and `min` is not above `max`. */
function checkCountBounds(what: string, min: number | undefined, max: number | undefined): void {
  for (const bound of [min, max]) {
    if (bound !== undefined && (!isInt(bound) || bound < 0)) {
      invalidDescription(what, `bound ${String(bound)} is not a non-negative safe integer`);
    }
  }
  if (min !== undefined && max !== undefined && min > max) invalidDescription(what, `min ${min} is above max ${max}`);
}

/** The field builders. Each checks its own options when it is called. */
export const f = {
  /** A string; a length bound needs its unit (UTF-8 bytes or code points), because the two counts differ. */
  string<const O extends { min?: number; max?: number; unit?: 'utf8Bytes' | 'codePoints' }>(o?: O) {
    const options = o ?? ({} as O);
    if ((options.min !== undefined || options.max !== undefined) && options.unit === undefined) {
      invalidDescription('string field', 'a length bound needs a unit');
    }
    checkCountBounds('string field', options.min, options.max);
    return { ...options, kind: 'string' as const };
  },
  /** 64 lowercase hex digits. */
  sha256: () => ({ kind: 'sha256' as const }),
  /** A safe integer within inclusive bounds. */
  integer(o: { min: number; max?: number }) {
    if (!isInt(o.min) || (o.max !== undefined && !isInt(o.max))) invalidDescription('integer field', 'a bound is not a safe integer');
    if (o.max !== undefined && o.min > o.max) invalidDescription('integer field', `min ${o.min} is above max ${o.max}`);
    return { ...o, kind: 'integer' as const };
  },
  /**
   * A finite number (never `NaN` or `±Infinity`), not limited to safe integers. Bounds are inclusive unless their
   * exclusive flag is set; a flag without its bound would silently do nothing, so it is refused.
   */
  finite(o?: { min?: number; max?: number; minExclusive?: boolean; maxExclusive?: boolean }) {
    const options = o ?? {};
    for (const bound of [options.min, options.max]) {
      if (bound !== undefined && !Number.isFinite(bound)) invalidDescription('finite field', `bound ${String(bound)} is not finite`);
    }
    if (options.min !== undefined && options.max !== undefined && options.min > options.max) {
      invalidDescription('finite field', `min ${options.min} is above max ${options.max}`);
    }
    if (options.minExclusive !== undefined && options.min === undefined) invalidDescription('finite field', 'minExclusive has no min');
    if (options.maxExclusive !== undefined && options.max === undefined) invalidDescription('finite field', 'maxExclusive has no max');
    return { ...options, kind: 'finite' as const };
  },
  /** A record's revision: a safe integer from `min` (0 or 1). An immutable `@1` record uses `f.literal(1)` instead. */
  revision: (o: { min: 0 | 1 }) => ({ kind: 'revision' as const, min: o.min }),
  /**
   * A fixed string, safe integer or boolean, compared with `===`. An object literal is not supported: its comparison
   * and its JSON round trip are not settled.
   */
  literal<const V extends string | number | boolean>(value: V) {
    if (typeof value === 'number' && !isInt(value)) invalidDescription('literal field', `${value} is not a safe integer`);
    return { kind: 'literal' as const, value };
  },
  enumOf<const V extends readonly string[]>(values: V) {
    if (values.length === 0) invalidDescription('enum field', 'the value list is empty');
    const duplicate = values.find((value, index) => values.indexOf(value) !== index);
    if (duplicate !== undefined) invalidDescription('enum field', `${duplicate} is listed twice`);
    return { kind: 'enum' as const, values };
  },
  boolean: () => ({ kind: 'boolean' as const }),
  /** A ref described by its own `defineShape`: tagged aggregate refs and plain refs are each their own shape. */
  ref: <F extends Fields>(shape: Shape<F>) => ({ kind: 'ref' as const, shape }),
  /** A ledger cursor (`c` and ten digits), one that is not `c0000000000`, or an opaque non-empty Kernel cursor. */
  cursor: <K extends 'ledger' | 'ledgerNonZero' | 'kernel'>(cursor: K) => ({ kind: 'cursor' as const, cursor }),
  /** A top-level cursor the Store fills from the commit cursor; it sits under its own name. */
  boundCursor: <N extends BoundCursorName>(field: N) => ({ kind: 'boundCursor' as const, field }),
  /** A UTC time ending in `Z` that `Date.parse` reads. */
  isoTime: () => ({ kind: 'isoTime' as const }),
  /** The key may be absent; a key present with `undefined` is refused. */
  optional: <F extends Field>(field: F) => ({ kind: 'optional' as const, field }),
  nullable: <F extends Field>(field: F) => ({ kind: 'nullable' as const, field }),
  /** Element check and count bounds; uniqueness and order are named rules. */
  array<F extends Field>(element: F, o?: { min?: number; max?: number }) {
    checkCountBounds('array field', o?.min, o?.max);
    return { ...o, kind: 'array' as const, element };
  },
  /** An exact object: every required key present, optional keys may be absent, any other key refused. */
  object: <F extends Fields>(fields: F) => ({ kind: 'object' as const, fields }),
  /**
   * A discriminated union: the tag is read first and only that branch is checked. Each branch declares the tag as
   * the literal of its own key, so the inferred branches stay discriminated.
   */
  union<T extends string, B extends { readonly [branch: string]: Fields }>(tag: T, branches: B) {
    for (const [key, branch] of Object.entries(branches)) {
      const tagField = branch[tag];
      if (tagField?.kind !== 'literal') invalidDescription('union field', `branch ${key} has no literal ${tag}`);
      if (tagField.value !== key) invalidDescription('union field', `branch ${key} has the tag literal ${String(tagField.value)}`);
    }
    return { kind: 'union' as const, tag, branches };
  },
};

/** Does the field hold a bound cursor anywhere below it? (A ref's shape was checked when it was defined.) */
function holdsBoundCursor(field: Field): boolean {
  switch (field.kind) {
    case 'boundCursor': return true;
    case 'optional': case 'nullable': return holdsBoundCursor(field.field);
    case 'array': return holdsBoundCursor(field.element);
    case 'object': return Object.values(field.fields).some(holdsBoundCursor);
    case 'union': return Object.values(field.branches).some(branch => Object.values(branch).some(holdsBoundCursor));
    default: return false;
  }
}
/**
 * The Store fills a bound cursor only on a record's top-level field of the same name (`commitCursorFields`), so it
 * may sit only there, directly or under `f.nullable` (the only way to store `null` there), never under `f.optional`.
 */
function checkBoundCursors(what: string, fields: Fields, recordTop: boolean): void {
  for (const [key, field] of Object.entries(fields)) {
    const direct = field.kind === 'nullable' ? field.field : field;
    if (recordTop && direct.kind === 'boundCursor') {
      if (!BOUND_CURSOR_NAMES.includes(direct.field)) invalidDescription(what, `${String(direct.field)} is not a bound cursor field`);
      if (direct.field !== key) invalidDescription(what, `bound cursor ${direct.field} is under the key ${key}`);
    } else if (recordTop && field.kind === 'optional' && holdsBoundCursor(field)) {
      invalidDescription(what, `bound cursor ${key} is optional`);
    } else if (holdsBoundCursor(field)) {
      invalidDescription(what, `bound cursor ${key} is not at a record's top level`);
    }
  }
}
function checkName(what: string, key: string, value: unknown): void {
  if (!nonEmpty(value)) invalidDescription(what, `${key} is missing`);
}

export function defineShape<const F extends Fields>(format: { name: string; fields: F; rules?: readonly ShapeRule[] }): Shape<F> {
  checkName('shape', 'name', format.name);
  checkBoundCursors(format.name, format.fields, false);
  return { kind: 'shape', name: format.name, fields: format.fields, rules: format.rules ?? [] };
}

const TEXT_KINDS: readonly string[] = ['string', 'sha256', 'enum', 'isoTime', 'cursor', 'boundCursor'];
const SCALAR_KINDS: readonly string[] = [...TEXT_KINDS, 'integer', 'finite', 'revision', 'literal', 'boolean'];
/**
 * The field a dotted lookup path names, and whether an optional or nullable wrapper lies on the way. A path goes
 * through objects and refs only: an array has no single value to index, and a path into a union is refused because
 * its branches would each need their own reading of optional and nullable.
 */
function lookupPathField(what: string, fields: Fields, path: string): { field: Field; wrapped: boolean } {
  let current: Fields | null = fields;
  let found: Field | null = null;
  let wrapped = false;
  for (const segment of path.split('.')) {
    if (found?.kind === 'union') invalidDescription(what, `lookup path ${path} crosses a union`);
    found = current !== null && Object.hasOwn(current, segment) ? current[segment]! : null;
    if (found === null) invalidDescription(what, `lookup path ${path} is missing`);
    while (found.kind === 'optional' || found.kind === 'nullable') {
      wrapped = true;
      found = found.field;
    }
    if (found.kind === 'array') invalidDescription(what, `lookup path ${path} is an array path`);
    current = found.kind === 'object' ? found.fields : found.kind === 'ref' ? found.shape.fields : null;
  }
  return { field: found!, wrapped };
}
/**
 * Is the field a scalar of an order or text column's kind? A literal counts when its value is of that kind, so
 * `f.literal(1)` may fill an integer column and a string literal a text column or a text path.
 */
function ofColumnKind(field: Field, valueType: 'text' | 'integer'): boolean {
  if (field.kind === 'literal') return valueType === 'integer' ? isInt(field.value) : typeof field.value === 'string';
  return valueType === 'integer' ? field.kind === 'integer' || field.kind === 'revision' : TEXT_KINDS.includes(field.kind);
}
/** Each lookup path names one scalar the Store can index; a derived lookup value stays hand-written. */
function checkLookup(what: string, fields: Fields, lookup: Lookup): void {
  if (Array.isArray(lookup.orderBy)) invalidDescription(what, `lookup ${lookup.name} has more than one order column`);
  for (const path of lookup.equal) {
    if (!SCALAR_KINDS.includes(lookupPathField(what, fields, path).field.kind)) {
      invalidDescription(what, `lookup path ${path} is not a scalar`);
    }
  }
  if (lookup.orderBy !== undefined) {
    const { field, wrapped } = lookupPathField(what, fields, lookup.orderBy.path);
    if (wrapped) invalidDescription(what, `order path ${lookup.orderBy.path} is optional or nullable`);
    if (!ofColumnKind(field, lookup.orderBy.valueType)) {
      invalidDescription(what, `order path ${lookup.orderBy.path} is not ${lookup.orderBy.valueType}`);
    }
  }
  for (const path of lookup.text ?? []) {
    const { field, wrapped } = lookupPathField(what, fields, path);
    if (wrapped) invalidDescription(what, `text path ${path} is optional or nullable`);
    if (!ofColumnKind(field, 'text')) invalidDescription(what, `text path ${path} is not text`);
  }
}

/**
 * A stored record. `fields.ref` is a full tagged ref of this `aggregateType` (the record's address in the Store) and
 * `fields.revision` is `f.revision` or, for an immutable `@1` record, `f.literal(1)`.
 */
export function defineRecord<const F extends Fields>(format: {
  name: string;
  schemaId: string;
  aggregateType: string;
  fields: F; // declares ref and revision
  rules?: readonly ShapeRule[];
  lookups?: readonly Lookup[];
}): RecordFormat<F> {
  checkName('record', 'name', format.name);
  checkName(format.name, 'schemaId', format.schemaId);
  checkName(format.name, 'aggregateType', format.aggregateType);
  const ref: Field | undefined = format.fields['ref'];
  const revision: Field | undefined = format.fields['revision'];
  if (ref === undefined) invalidDescription(format.name, 'ref is missing');
  if (revision === undefined) invalidDescription(format.name, 'revision is missing');
  const tag = ref.kind === 'ref' ? ref.shape.fields['aggregateType'] : undefined;
  if (tag?.kind !== 'literal') invalidDescription(format.name, 'ref is not a tagged ref');
  if (tag.value !== format.aggregateType) {
    invalidDescription(format.name, `ref.aggregateType ${String(tag.value)} is not ${format.aggregateType}`);
  }
  if (revision.kind !== 'revision' && !(revision.kind === 'literal' && revision.value === 1)) {
    invalidDescription(format.name, 'revision is neither f.revision nor f.literal(1)');
  }
  checkBoundCursors(format.name, format.fields, true);
  for (const lookup of format.lookups ?? []) checkLookup(format.name, format.fields, lookup);
  return {
    kind: 'record', name: format.name, schemaId: format.schemaId, aggregateType: format.aggregateType,
    fields: format.fields, rules: format.rules ?? [], lookups: format.lookups ?? [],
  };
}

/** An event: `fields` holds every top-level field except the four envelope keys, which every event carries. */
export function defineEvent<const E extends string, const F extends Fields>(format: {
  name: string;
  eventType: E;
  schemaVersion: 1;
  fields: F; // every top-level field outside the four envelope keys
  rules?: readonly ShapeRule[];
}): EventFormat<E, F> {
  checkName('event', 'name', format.name);
  checkName(format.name, 'eventType', format.eventType);
  const envelope = Object.keys(format.fields).find(key => ENVELOPE_KEYS.includes(key));
  if (envelope !== undefined) invalidDescription(format.name, `${envelope} is an envelope key`);
  checkBoundCursors(format.name, format.fields, false);
  return { ...format };
}
