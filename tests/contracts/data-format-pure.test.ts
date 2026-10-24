/**
 * Pure rows of the field-table formats (A5): the value check of each field kind, the first-problem order, and the
 * description errors thrown when a format is built. Every format here is test-local; every expected text is written
 * by hand from the format rules (`<name>.<path> is missing | is not allowed | is not recognized | is invalid`).
 */
import { describe, expect, it } from 'vitest';
import { defineEvent, defineRecord, defineShape, f, type Field, type FieldPhase, type Fields, type Lookup, type Shape } from '../../src/contracts/data-format.js';
import { GoalRefShape, ProjectRefShape, WorkspaceRefShape } from '../../src/contracts/data-format-refs.js';
import { checkShape } from '../../src/contracts/validation/data-format.js';
import { canonicalRefKey } from '../../src/core/work-graph/persistence/record-codecs.js';
import { createEventCodec, createRecordCodec, formatSchemas } from '../../src/core/work-graph/persistence/field-table-codec.js';

const id = f.string({ min: 1, unit: 'codePoints' });
const WidgetRef = defineShape({ name: 'WidgetRef', fields: { aggregateType: f.literal('Widget'), projectId: id, widgetId: id } });
const PlainRef = defineShape({ name: 'PlainRef', fields: { projectId: id } });
const ref = { aggregateType: 'Widget' as const, projectId: 'p1', widgetId: 'w1' };
/** One field `v` in a shape named `T`, checked as stored. */
const check = (field: Field, value: unknown) => checkShape(defineShape({ name: 'T', fields: { v: field } }), { v: value }, 'stored');
const widgetFormat = (fields: Fields, extra: Partial<Parameters<typeof defineRecord>[0]> = {}) => defineRecord({
  name: 'W', schemaId: 'Widget@1', aggregateType: 'Widget', fields: { ref: f.ref(WidgetRef), revision: f.revision({ min: 1 }), ...fields }, ...extra,
});
/** The message a call throws, or `null` when it returns. */
const outcome = (call: () => unknown) => { try { call(); return null; } catch (error) { return (error as Error).message; } };

describe('field kinds', () => {
  const invalid = 'T.v is invalid';
  const unrecognized = 'T.v is not recognized';
  it.each<[string, Field, unknown, string | null]>([
    ['string: no bound accepts the empty string', f.string(), '', null],
    ['string: not a string', f.string(), 1, invalid],
    ['string: 中 is 3 UTF-8 bytes', f.string({ max: 3, unit: 'utf8Bytes' }), '中', null],
    ['string: 中a is 4 UTF-8 bytes', f.string({ max: 3, unit: 'utf8Bytes' }), '中a', invalid],
    ['string: 😀 is 4 UTF-8 bytes', f.string({ max: 3, unit: 'utf8Bytes' }), '😀', invalid],
    ['string: 😀 is 1 code point', f.string({ max: 1, unit: 'codePoints' }), '😀', null],
    ['string: ab is 2 code points', f.string({ max: 1, unit: 'codePoints' }), 'ab', invalid],
    ['string: below min', f.string({ min: 1, unit: 'codePoints' }), '', invalid],
    ['sha256: 64 lowercase hex', f.sha256(), 'a'.repeat(64), null],
    ['sha256: uppercase', f.sha256(), 'A'.repeat(64), invalid],
    ['sha256: 63 digits', f.sha256(), 'a'.repeat(63), invalid],
    ['integer: min and max are inclusive', f.integer({ min: 1, max: 3 }), 3, null],
    ['integer: below min', f.integer({ min: 1, max: 3 }), 0, invalid],
    ['integer: above max', f.integer({ min: 1, max: 3 }), 4, invalid],
    ['integer: a fraction', f.integer({ min: 0 }), 1.5, invalid],
    ['integer: not a safe integer', f.integer({ min: 0 }), 2 ** 53, invalid],
    ['finite: exclusive min refuses the bound', f.finite({ min: 0, minExclusive: true }), 0, invalid],
    ['finite: exclusive min accepts above it', f.finite({ min: 0, minExclusive: true }), 0.5, null],
    ['finite: inclusive max accepts the bound', f.finite({ max: 1 }), 1, null],
    ['finite: exclusive max refuses the bound', f.finite({ max: 1, maxExclusive: true }), 1, invalid],
    ['finite: not limited to safe integers', f.finite(), 2 ** 60, null],
    ['finite: NaN', f.finite(), Number.NaN, invalid],
    ['finite: Infinity', f.finite(), Number.POSITIVE_INFINITY, invalid],
    ['revision: from 1', f.revision({ min: 1 }), 0, invalid],
    ['revision: from 0', f.revision({ min: 0 }), 0, null],
    ['revision: a fraction', f.revision({ min: 0 }), 1.5, invalid],
    ['literal: the declared value', f.literal('a'), 'a', null],
    ['literal: another value', f.literal('a'), 'b', unrecognized],
    ['literal: 1 is not "1"', f.literal(1), '1', unrecognized],
    ['enum: a declared value', f.enumOf(['a', 'b']), 'b', null],
    ['enum: an undeclared value', f.enumOf(['a', 'b']), 'c', unrecognized],
    ['boolean: true', f.boolean(), true, null],
    ['boolean: the string true', f.boolean(), 'true', invalid],
    ['ref: complete', f.ref(WidgetRef), ref, null],
    ['ref: a missing id continues the path', f.ref(WidgetRef), { aggregateType: 'Widget', projectId: 'p1' }, 'T.v.widgetId is missing'],
    ['ref: another tag', f.ref(WidgetRef), { ...ref, aggregateType: 'Gadget' }, 'T.v.aggregateType is not recognized'],
    ['ref: an extra key', f.ref(WidgetRef), { ...ref, extra: 1 }, 'T.v.extra is not allowed'],
    ['ref: a plain ref has no tag', f.ref(PlainRef), { aggregateType: 'Widget', projectId: 'p1' }, 'T.v.aggregateType is not allowed'],
    ['ref: not an object', f.ref(WidgetRef), 'p1/w1', invalid],
    ['ref: inside an array of objects', f.array(f.object({ ref: f.ref(WidgetRef) })), [{ ref }, { ref: { aggregateType: 'Widget', widgetId: 'w' } }], 'T.v[1].ref.projectId is missing'],
    ['cursor: a ledger cursor', f.cursor('ledger'), 'c0000000000', null],
    ['cursor: not c and ten digits', f.cursor('ledger'), 'c123', invalid],
    ['cursor: a nonzero ledger cursor refuses c0000000000', f.cursor('ledgerNonZero'), 'c0000000000', invalid],
    ['cursor: a nonzero ledger cursor', f.cursor('ledgerNonZero'), 'c0000000001', null],
    ['cursor: a Kernel cursor may look like a ledger cursor', f.cursor('kernel'), 'c0000000001', null],
    ['cursor: an empty Kernel cursor', f.cursor('kernel'), '', invalid],
    ['isoTime: UTC with Z', f.isoTime(), '2026-10-24T00:00:00.000Z', null],
    ['isoTime: an offset instead of Z', f.isoTime(), '2026-10-24T08:00:00+08:00', invalid],
    ['isoTime: ends in Z but is no time', f.isoTime(), 'notZ', invalid],
    ['nullable: null', f.nullable(f.string()), null, null],
    ['nullable: the inner kind still applies', f.nullable(f.string()), 1, invalid],
    ['array: below the count bound', f.array(id, { min: 1, max: 2 }), [], invalid],
    ['array: above the count bound', f.array(id, { min: 1, max: 2 }), ['a', 'b', 'c'], invalid],
    ['array: the count before the items', f.array(id, { max: 1 }), ['', 'a'], invalid],
    ['array: an item path', f.array(id, { min: 1, max: 2 }), ['a', ''], 'T.v[1] is invalid'],
    ['array: not an array', f.array(id), 'a', invalid],
    ['object: exact', f.object({ x: f.string() }), { x: 'a', y: 1 }, 'T.v.y is not allowed'],
    ['object: a required key', f.object({ x: f.string() }), {}, 'T.v.x is missing'],
  ])('%s', (_label, field, value, expected) => {
    expect(check(field, value)).toBe(expected);
  });

  const Widget = widgetFormat({ since: f.boundCursor('since'), until: f.nullable(f.boundCursor('until')) });
  it.each<[string, FieldPhase, unknown, unknown, string | null]>([
    ['pending accepts the null placeholder', 'pending', null, null, null],
    ['stored refuses null', 'stored', null, null, 'W.since is invalid'],
    ['stored accepts a cursor, and null under f.nullable', 'stored', 'c0000000002', null, null],
    ['pending still checks a given cursor', 'pending', 'x', null, 'W.since is invalid'],
  ])('bound cursor: %s', (_label, phase, since, until, expected) => {
    expect(checkShape(Widget, { ref, revision: 1, since, until }, phase)).toBe(expected);
  });

  // Enum values, so a present `undefined` is told apart from a value that is not declared.
  const OptionalNullable = defineShape({ name: 'T', fields: { a: f.optional(f.enumOf(['x', 'y'])), b: f.nullable(f.enumOf(['x', 'y'])) } });
  it.each<[string, Record<string, unknown>, string | null]>([
    ['an optional key may be absent', { b: null }, null],
    ['an optional key may be present', { a: 'x', b: 'y' }, null],
    ['an optional key present with undefined', { a: undefined, b: null }, 'T.a is invalid'],
    ['an optional key is not nullable', { a: null, b: null }, 'T.a is not recognized'],
    ['a nullable key is required', { a: 'x' }, 'T.b is missing'],
    ['a required key present with undefined', { b: undefined }, 'T.b is invalid'],
  ])('optional and nullable: %s', (_label, value, expected) => {
    expect(checkShape(OptionalNullable, value, 'stored')).toBe(expected);
  });

  const Union = f.union('kind', { text: { kind: f.literal('text'), text: f.string() }, count: { kind: f.literal('count'), count: f.integer({ min: 0 }) } });
  it.each<[string, unknown, string | null]>([
    ['the text branch', { kind: 'text', text: 'a' }, null],
    ['the count branch', { kind: 'count', count: 1 }, null],
    ['no tag', { text: 'a' }, 'T.v.kind is missing'],
    ['a tag present with undefined', { kind: undefined }, 'T.v.kind is invalid'],
    ['an undeclared tag', { kind: 'other', text: 'a' }, 'T.v.kind is not recognized'],
    ['only the chosen branch is checked', { kind: 'text', count: 1 }, 'T.v.text is missing'],
    ['a branch is exact', { kind: 'text', text: 'a', count: 1 }, 'T.v.count is not allowed'],
  ])('union: %s', (_label, value, expected) => {
    expect(check(Union, value)).toBe(expected);
  });
});

describe('first problem', () => {
  const Order = defineShape({ name: 'T', fields: { a: f.string(), b: f.object({ c: f.string(), d: f.string() }), e: f.string() },
    rules: [value => ((value as { a: string }).a === 'x' ? 'first rule' : null), () => 'second rule'] });
  it.each<[string, unknown, string]>([
    ['fields in declaration order, before unknown keys', { z: 1, e: 1, b: { c: 1, d: 1 }, a: 1 }, 'T.a is invalid'],
    ['depth first: a nested field before the next field', { a: 'x', b: { c: 'x', d: 1 }, e: 1 }, 'T.b.d is invalid'],
    ['a nested unknown key before the next field', { a: 'x', b: { c: 'x', d: 'x', q: 1 }, e: 1 }, 'T.b.q is not allowed'],
    ['unknown keys after every field, in the value key order', { z: 1, a: 'x', b: { c: 'x', d: 'x' }, e: 'x', y: 2 }, 'T.z is not allowed'],
    ['rules after the fields and unknown keys', { a: 'x', b: { c: 'x', d: 'x' }, e: 'x' }, 'first rule'],
    ['a later rule runs after an earlier rule passed', { a: 'y', b: { c: 'x', d: 'x' }, e: 'x' }, 'second rule'],
    ['a root that is not an object', ['a'], 'T is invalid'],
  ])('%s', (_label, value, expected) => {
    expect(checkShape(Order, value, 'stored')).toBe(expected);
  });

  // The field `'0'` is named like an array index, so a plain object lists it before every other key.
  const Changed = defineEvent({ name: 'WidgetChanged', eventType: 'WidgetChanged', schemaVersion: 1, fields: { note: f.string(), '0': f.string() } });
  const event = { eventType: 'WidgetChanged', schemaVersion: 1, eventId: 'e1', occurredAt: '2026-10-24T00:00:00.000Z', note: 'n', 0: 'z' };
  it.each<[string, unknown, string | null]>([
    ['a complete event', event, null],
    ['the envelope before a field named like an array index', {}, 'WidgetChanged.eventType is missing'],
    ['eventType first', { note: 1, occurredAt: '', eventId: '', schemaVersion: 2 }, 'WidgetChanged.eventType is missing'],
    ['another eventType', { ...event, eventType: 'Other', schemaVersion: 2 }, 'WidgetChanged.eventType is not recognized'],
    ['then schemaVersion', { ...event, schemaVersion: 2, eventId: '' }, 'WidgetChanged.schemaVersion is not recognized'],
    ['then eventId', { ...event, eventId: '', occurredAt: '' }, 'WidgetChanged.eventId is invalid'],
    ['then occurredAt', { ...event, occurredAt: '', note: 1 }, 'WidgetChanged.occurredAt is invalid'],
    ['then the fields', { ...event, note: 1 }, 'WidgetChanged.note is invalid'],
    ['then unknown keys', { ...event, extra: 1 }, 'WidgetChanged.extra is not allowed'],
  ])('event: %s', (_label, value, expected) => {
    expect(checkShape(Changed, value, 'stored')).toBe(expected);
  });
});

describe('description errors', () => {
  it.each<[string, () => unknown, string]>([
    ['a shape without a name', () => defineShape({ name: '', fields: {} }), 'shape description is invalid: name is missing'],
    ['a record without a name', () => widgetFormat({}, { name: '' }), 'record description is invalid: name is missing'],
    ['a record without a schemaId', () => widgetFormat({}, { schemaId: '' }), 'W description is invalid: schemaId is missing'],
    ['a record without an aggregateType', () => widgetFormat({}, { aggregateType: '' }), 'W description is invalid: aggregateType is missing'],
    ['an event without a name', () => defineEvent({ name: '', eventType: 'E', schemaVersion: 1, fields: {} }), 'event description is invalid: name is missing'],
    ['an event without an eventType', () => defineEvent({ name: 'E', eventType: '', schemaVersion: 1, fields: {} }), 'E description is invalid: eventType is missing'],
    ['a string bound without a unit', () => f.string({ max: 3 }), 'string field description is invalid: a length bound needs a unit'],
    ['a negative length bound', () => f.string({ min: -1, unit: 'codePoints' }), 'string field description is invalid: bound -1 is not a non-negative safe integer'],
    ['a fractional length bound', () => f.string({ max: 1.5, unit: 'utf8Bytes' }), 'string field description is invalid: bound 1.5 is not a non-negative safe integer'],
    ['a string min above max', () => f.string({ min: 3, max: 2, unit: 'codePoints' }), 'string field description is invalid: min 3 is above max 2'],
    ['an integer min that is not a safe integer', () => f.integer({ min: 0.5 }), 'integer field description is invalid: a bound is not a safe integer'],
    ['an integer max that is not a safe integer', () => f.integer({ min: 0, max: 0.5 }), 'integer field description is invalid: a bound is not a safe integer'],
    ['an integer min above max', () => f.integer({ min: 2, max: 1 }), 'integer field description is invalid: min 2 is above max 1'],
    ['a finite bound that is not finite', () => f.finite({ max: Number.NaN }), 'finite field description is invalid: bound NaN is not finite'],
    ['a finite min above max', () => f.finite({ min: 2, max: 1 }), 'finite field description is invalid: min 2 is above max 1'],
    ['minExclusive without min', () => f.finite({ minExclusive: true }), 'finite field description is invalid: minExclusive has no min'],
    ['maxExclusive without max', () => f.finite({ maxExclusive: true }), 'finite field description is invalid: maxExclusive has no max'],
    ['a literal number that is not a safe integer', () => f.literal(1.5), 'literal field description is invalid: 1.5 is not a safe integer'],
    ['an empty enum', () => f.enumOf([]), 'enum field description is invalid: the value list is empty'],
    ['a duplicate enum value', () => f.enumOf(['a', 'b', 'a']), 'enum field description is invalid: a is listed twice'],
    ['an array count min above max', () => f.array(id, { min: 2, max: 1 }), 'array field description is invalid: min 2 is above max 1'],
    ['a union branch with another tag literal', () => f.union('kind', { a: { kind: f.literal('b') } }), 'union field description is invalid: branch a has the tag literal b'],
    ['a union tag that is not a literal', () => f.union('kind', { a: { kind: f.string() } }), 'union field description is invalid: branch a has no literal kind'],
    ['a bound cursor in a shape', () => defineShape({ name: 'S', fields: { since: f.boundCursor('since') } }), "S description is invalid: bound cursor since is not at a record's top level"],
    ['a bound cursor below the top level', () => widgetFormat({ at: f.object({ since: f.boundCursor('since') }) }), "W description is invalid: bound cursor at is not at a record's top level"],
    ['a bound cursor under another key', () => widgetFormat({ start: f.boundCursor('since') }), 'W description is invalid: bound cursor since is under the key start'],
    ['an optional bound cursor', () => widgetFormat({ since: f.optional(f.boundCursor('since')) }), 'W description is invalid: bound cursor since is optional'],
    ['a bound cursor in an event', () => defineEvent({ name: 'E', eventType: 'E', schemaVersion: 1, fields: { since: f.boundCursor('since') } }),
      "E description is invalid: bound cursor since is not at a record's top level"],
    ['a record without ref', () => defineRecord({ name: 'W', schemaId: 'W@1', aggregateType: 'Widget', fields: { revision: f.revision({ min: 1 }) } }),
      'W description is invalid: ref is missing'],
    ['a record without revision', () => defineRecord({ name: 'W', schemaId: 'W@1', aggregateType: 'Widget', fields: { ref: f.ref(WidgetRef) } }),
      'W description is invalid: revision is missing'],
    ['a plain ref as the address', () => widgetFormat({ ref: f.ref(PlainRef) }), 'W description is invalid: ref is not a tagged ref'],
    ['a ref of another aggregate type', () => widgetFormat({}, { aggregateType: 'Gadget' }), 'W description is invalid: ref.aggregateType Widget is not Gadget'],
    ['a revision that is an integer field', () => widgetFormat({ revision: f.integer({ min: 1 }) }), 'W description is invalid: revision is neither f.revision nor f.literal(1)'],
    ['a revision literal other than 1', () => widgetFormat({ revision: f.literal(2) }), 'W description is invalid: revision is neither f.revision nor f.literal(1)'],
    ['an event field with an envelope name', () => defineEvent({ name: 'E', eventType: 'E', schemaVersion: 1, fields: { occurredAt: f.isoTime() } }),
      'E description is invalid: occurredAt is an envelope key'],
  ])('%s', (_label, build, expected) => {
    expect(build).toThrow(new Error(expected));
  });

  const fields = { title: f.string(), rank: f.integer({ min: 0 }), note: f.optional(f.string()), tags: f.array(f.string()), one: f.literal(1), tag: f.literal('t'),
    body: f.union('kind', { a: { kind: f.literal('a'), sort: f.string() } }) };
  it.each<[string, Lookup, string | null]>([
    ['a missing path', { name: 'l', equal: ['nope'] }, 'W description is invalid: lookup path nope is missing'],
    ['a path below a scalar', { name: 'l', equal: ['title.x'] }, 'W description is invalid: lookup path title.x is missing'],
    ['an array path', { name: 'l', equal: ['tags'] }, 'W description is invalid: lookup path tags is an array path'],
    ['a path through a union', { name: 'l', equal: ['body.sort'] }, 'W description is invalid: lookup path body.sort crosses a union'],
    ['an equal path that is not a scalar', { name: 'l', equal: ['ref'] }, 'W description is invalid: lookup path ref is not a scalar'],
    // An array that also carries a valid path and valueType still fits the type of `orderBy`.
    ['more than one order column', { name: 'l', equal: [], orderBy: Object.assign([{ path: 'rank', valueType: 'integer' as const }, { path: 'title', valueType: 'text' as const }],
      { path: 'rank', valueType: 'integer' as const }) }, 'W description is invalid: lookup l has more than one order column'],
    ['an optional order path', { name: 'l', equal: [], orderBy: { path: 'note', valueType: 'text' } }, 'W description is invalid: order path note is optional or nullable'],
    ['a text order path that is an integer', { name: 'l', equal: [], orderBy: { path: 'rank', valueType: 'text' } }, 'W description is invalid: order path rank is not text'],
    ['an integer order path that is text', { name: 'l', equal: [], orderBy: { path: 'title', valueType: 'integer' } }, 'W description is invalid: order path title is not integer'],
    ['an integer order path that is a string literal', { name: 'l', equal: [], orderBy: { path: 'tag', valueType: 'integer' } }, 'W description is invalid: order path tag is not integer'],
    ['an optional text path', { name: 'l', equal: [], text: ['note'] }, 'W description is invalid: text path note is optional or nullable'],
    ['a text path that is not text', { name: 'l', equal: [], text: ['rank'] }, 'W description is invalid: text path rank is not text'],
    ['a text path that is an integer literal', { name: 'l', equal: [], text: ['one'] }, 'W description is invalid: text path one is not text'],
    ['accepted: through a ref, with an integer order column and a text path', { name: 'l', equal: ['ref.projectId'], orderBy: { path: 'rank', valueType: 'integer' }, text: ['title'] }, null],
    ['accepted: an integer literal as the integer order column', { name: 'l', equal: [], orderBy: { path: 'one', valueType: 'integer' } }, null],
    ['accepted: a string literal as the text order column', { name: 'l', equal: [], orderBy: { path: 'tag', valueType: 'text' } }, null],
    ['accepted: a string literal as a text path', { name: 'l', equal: [], text: ['tag'] }, null],
  ])('lookup: %s', (_label, lookup, expected) => {
    expect(outcome(() => widgetFormat(fields, { lookups: [lookup] }))).toBe(expected);
  });
});

describe('record and event codecs', () => {
  const key = '{"aggregateType":"Widget","projectId":"p1","widgetId":"w1"}';
  const codec = createRecordCodec(defineRecord({ name: 'W', schemaId: 'Widget@1', aggregateType: 'Widget',
    fields: { ref: f.ref(WidgetRef), revision: f.revision({ min: 1 }), since: f.boundCursor('since'), title: f.string({ max: 4, unit: 'codePoints' }), note: f.optional(f.string()) },
    lookups: [{ name: 'by-title', equal: ['ref.projectId'], orderBy: { path: 'title', valueType: 'text' } }] }));
  const stored = { refKey: key, schemaId: 'Widget@1', revision: 2, json: `{"ref":${key},"revision":2,"since":"c0000000003","title":"t"}` };
  const events = createEventCodec(defineEvent({ name: 'WidgetChanged', eventType: 'WidgetChanged', schemaVersion: 1, fields: { note: f.string() } }));
  const event = { note: '中😀', occurredAt: '2026-10-24T00:00:00.000Z', eventType: 'WidgetChanged' as const, schemaVersion: 1 as const, eventId: 'e1' };
  const encodedEvent = () => events.encode(event);
  it('encode keeps the caller key order and non-ASCII text, adds nothing, and keys the record by its canonical full ref', () => {
    expect(codec.encode({ title: '中文😀', since: null, revision: 1, ref: { widgetId: 'w1', projectId: 'p1', aggregateType: 'Widget' } })).toEqual({ refKey: key,
      schemaId: 'Widget@1', revision: 1, json: '{"title":"中文😀","since":null,"revision":1,"ref":{"widgetId":"w1","projectId":"p1","aggregateType":"Widget"}}' });
    expect(encodedEvent().json).toBe('{"note":"中😀","occurredAt":"2026-10-24T00:00:00.000Z","eventType":"WidgetChanged","schemaVersion":1,"eventId":"e1"}');
    expect([outcome(() => codec.encode({ ref, revision: 1, since: null, title: 'abcde' })), outcome(() => events.encode({ ...event, occurredAt: '' }))])
      .toEqual(['W.title is invalid', 'WidgetChanged.occurredAt is invalid']);
  });
  it('decode returns the stored value with no default; the registration keeps the same encoded record', () => {
    expect([codec.decode(stored), events.decode(encodedEvent())]).toStrictEqual([
      { status: 'decoded', value: { ref, revision: 2, since: 'c0000000003', title: 't' } }, { status: 'decoded', value: event }]);
    expect((codec.registration.validate(stored) as { value: unknown }).value).toBe(stored);
  });
  it.each<[string, () => unknown, string]>([
    ['another schema id', () => codec.decode({ ...stored, schemaId: 'Other@1' }), 'expected schemaId Widget@1, got Other@1'],
    ['another schema id, at registration', () => codec.registration.validate({ ...stored, schemaId: 'Other@1' }), 'expected schemaId Widget@1, got Other@1'],
    ['a key that is not canonical', () => codec.decode({ ...stored, refKey: '{"projectId":"p1","aggregateType":"Widget","widgetId":"w1"}' }), 'ref_key is not the canonical key of its full ref'],
    ['an outer revision that differs', () => codec.decode({ ...stored, revision: 3 }), 'snapshot body revision 2 does not match the encoded record revision 3'],
    ['a body that is not an object', () => codec.decode({ ...stored, json: '[]' }), 'snapshot body: json body is not a JSON object'],
    ['a stored null bound cursor', () => codec.decode({ ...stored, json: `{"ref":${key},"revision":2,"since":null,"title":"t"}` }), 'W.since is invalid'],
    ['another outer eventType', () => events.decode({ ...encodedEvent(), eventType: 'Other' }), 'expected eventType WidgetChanged, got Other'],
    ['a body eventId that disagrees', () => events.decode({ ...encodedEvent(), json: encodedEvent().json.replace('"e1"', '"e2"') }), 'WidgetChanged body eventId disagrees with the encoded event'],
    ['an event field that fails its check', () => events.decode({ ...encodedEvent(), json: encodedEvent().json.replace('"中😀"', '1') }), 'WidgetChanged.note is invalid'],
  ])('decode refuses %s', (_label, decode, reason) => {
    expect(decode()).toEqual({ status: 'invalid', reason });
  });
  const recordOf = <F extends Fields>(aggregateType: string, shape: Shape<F>, schemaId = `${aggregateType}@1`) =>
    createRecordCodec(defineRecord({ name: aggregateType, schemaId, aggregateType, fields: { ref: f.ref(shape), revision: f.literal(1) } }));
  const [project, workspace, goal] = [recordOf('Project', ProjectRefShape), recordOf('Workspace', WorkspaceRefShape), recordOf('Goal', GoalRefShape)];
  // The decoded ref reaches canonicalRefKey as it is: its inferred type is the hand-written ref type.
  const keys = <E extends { refKey: string }>(encoded: E, decode: (record: E) => { status: 'decoded'; value: { ref: Parameters<typeof canonicalRefKey>[0] } } | { status: 'invalid' }) =>
    [encoded.refKey, ((decoded = decode(encoded)) => decoded.status === 'decoded' && canonicalRefKey(decoded.value.ref))()];
  it.each([
    ['{"aggregateType":"Project","projectId":"p1"}', () => keys(project.encode({ ref: { aggregateType: 'Project', projectId: 'p1' }, revision: 1 }), project.decode)],
    ['{"aggregateType":"Workspace","projectId":"p1","workspaceId":"w1"}', () => keys(workspace.encode({ ref: { aggregateType: 'Workspace', projectId: 'p1', workspaceId: 'w1' }, revision: 1 }), workspace.decode)],
    ['{"aggregateType":"Goal","goalId":"g1","projectId":"p1"}', () => keys(goal.encode({ ref: { aggregateType: 'Goal', projectId: 'p1', goalId: 'g1' }, revision: 1 }), goal.decode)],
  ])('the record key %s is canonicalRefKey of the decoded ref', (key, pair) => expect(pair()).toEqual([key, key]));
  it('formatSchemas registers each record with its bound cursors and lookups; it takes whole codecs only', () => {
    expect(formatSchemas([codec, events])).toMatchObject({ records: [{ schemaId: 'Widget@1', aggregateType: 'Widget', commitCursorFields: ['since'] }],
      events: [{ eventType: 'WidgetChanged', schemaVersion: 1 }], lookups: [{ name: 'by-title', aggregateType: 'Widget', paths: ['ref.projectId'], orderBy: { path: 'title', valueType: 'text' } }] });
    // @ts-expect-error a registration and its lookups without check, encode and decode are not a codec
    void (() => formatSchemas([{ registration: codec.registration, lookups: codec.lookups }]));
  });
  it.each<[string, Parameters<typeof formatSchemas>[0]]>([
    ['record schemaId Widget@1', [codec, recordOf('Gadget', defineShape({ name: 'GadgetRef', fields: { aggregateType: f.literal('Gadget'), id } }), 'Widget@1')]],
    ['record aggregateType Widget', [codec, recordOf('Widget', WidgetRef, 'Widget@2')]],
    ['event WidgetChanged@1', [events, events]],
  ])('formatSchemas refuses a second %s', (what, codecs) => {
    expect(() => formatSchemas(codecs)).toThrow(new Error(`format schemas description is invalid: ${what} is registered twice`));
  });
});
