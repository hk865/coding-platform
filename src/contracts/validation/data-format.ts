/**
 * The one value check of a field-table format (`../data-format.ts`). It returns the first problem as text, or `null`.
 *
 * First problem wins, in a fixed order, so a caller always sees the same reason for the same value. For every object:
 * its declared fields in declaration order, depth first (an array checks its length, then its items by index; a union
 * reads its tag, then checks only that branch; a ref checks its own fields under the caller's path); then its unknown
 * keys in the value's own key order; then its rules in declaration order. An event checks its four envelope keys
 * first, in the order the event pipeline uses (`eventType`, `schemaVersion`, `eventId`, `occurredAt`).
 *
 * Texts: `<name>.<path> is missing` (a required key is absent), `is not allowed` (an unknown key), `is not
 * recognized` (a literal, enum value or union tag that is not declared), `is invalid` (type, length, range, format,
 * cursor, time or ref, and a key present with `undefined`); `<name> is invalid` for a root that is not an object. A
 * rule's own reason is returned unchanged.
 */
import type { EventFormat, Field, FieldPhase, Fields, RecordFormat, Shape, ShapeRule } from '../data-format.js';
import { codePoints, isInt, isRecord, isSha256Hex, nonEmpty, utf8Bytes, type UnknownRecord } from './common.js';
import { isNonZeroPlatformCursor, isPlatformCursor } from './cursors.js';
import { isIsoZulu } from './time.js';

/**
 * Checks a value against a format. A record checks its body (`ref`, `revision` and the fields), an event the complete
 * event (the envelope keys and the fields), a shape its fields. `pending` lets a record's bound cursor still be `null`.
 */
export function checkShape(
  format: Shape<Fields> | RecordFormat<Fields> | EventFormat<string, Fields>,
  value: unknown,
  phase: FieldPhase,
): string | null {
  if (!isRecord(value)) return `${format.name} is invalid`;
  if ('kind' in format) return objectProblem(format.name, {}, format.fields, value, phase, format.rules);
  const text: Field = { kind: 'string', min: 1, unit: 'codePoints' };
  const envelope: Fields = {
    eventType: { kind: 'literal', value: format.eventType }, schemaVersion: { kind: 'literal', value: 1 },
    eventId: text, occurredAt: text,
  };
  return objectProblem(format.name, envelope, format.fields, value, phase, format.rules ?? []);
}

/**
 * `lead` (an event's envelope) is checked before `fields` as its own table: merging the two into one object would let
 * an integer-like field name such as `'0'` enumerate before the envelope keys. Unknown keys are those of neither.
 */
function objectProblem(
  path: string, lead: Fields, fields: Fields, value: UnknownRecord, phase: FieldPhase, rules: readonly ShapeRule[],
): string | null {
  for (const [key, field] of [...Object.entries(lead), ...Object.entries(fields)]) {
    if (!Object.hasOwn(value, key)) {
      if (field.kind === 'optional') continue;
      return `${path}.${key} is missing`;
    }
    const problem = fieldProblem(field, value[key], `${path}.${key}`, phase);
    if (problem !== null) return problem;
  }
  const unknown = Object.keys(value).find(key => !Object.hasOwn(lead, key) && !Object.hasOwn(fields, key));
  if (unknown !== undefined) return `${path}.${unknown} is not allowed`;
  for (const rule of rules) {
    const reason = rule(value);
    if (reason !== null) return reason;
  }
  return null;
}

function within(count: number, min: number | undefined, max: number | undefined): boolean {
  return (min === undefined || count >= min) && (max === undefined || count <= max);
}

function fieldProblem(field: Field, value: unknown, path: string, phase: FieldPhase): string | null {
  const invalid = `${path} is invalid`;
  if (value === undefined) return invalid;
  switch (field.kind) {
    case 'string': {
      if (typeof value !== 'string') return invalid;
      if (field.unit === undefined) return null;
      return within(field.unit === 'utf8Bytes' ? utf8Bytes(value) : codePoints(value), field.min, field.max) ? null : invalid;
    }
    case 'sha256': return isSha256Hex(value) ? null : invalid;
    case 'integer': return isInt(value) && within(value, field.min, field.max) ? null : invalid;
    case 'finite': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return invalid;
      const aboveMin = field.min === undefined || (field.minExclusive === true ? value > field.min : value >= field.min);
      const belowMax = field.max === undefined || (field.maxExclusive === true ? value < field.max : value <= field.max);
      return aboveMin && belowMax ? null : invalid;
    }
    case 'revision': return isInt(value) && value >= field.min ? null : invalid;
    case 'literal': return value === field.value ? null : `${path} is not recognized`;
    case 'enum': return typeof value === 'string' && field.values.includes(value) ? null : `${path} is not recognized`;
    case 'boolean': return typeof value === 'boolean' ? null : invalid;
    case 'ref': return isRecord(value) ? objectProblem(path, {}, field.shape.fields, value, 'stored', field.shape.rules) : invalid;
    case 'cursor': {
      const valid = field.cursor === 'ledger' ? isPlatformCursor(value)
        : field.cursor === 'ledgerNonZero' ? isNonZeroPlatformCursor(value) : nonEmpty(value);
      return valid ? null : invalid;
    }
    // Before commit a bound cursor may be the `null` placeholder the Store fills; once stored it is a real cursor.
    case 'boundCursor': return isPlatformCursor(value) || (phase === 'pending' && value === null) ? null : invalid;
    case 'isoTime': return isIsoZulu(value) ? null : invalid;
    case 'optional': return fieldProblem(field.field, value, path, phase);
    case 'nullable': return value === null ? null : fieldProblem(field.field, value, path, phase);
    case 'array': {
      if (!Array.isArray(value) || !within(value.length, field.min, field.max)) return invalid;
      for (let index = 0; index < value.length; index += 1) {
        const problem = fieldProblem(field.element, value[index], `${path}[${index}]`, phase);
        if (problem !== null) return problem;
      }
      return null;
    }
    case 'object': return isRecord(value) ? objectProblem(path, {}, field.fields, value, phase, []) : invalid;
    case 'union': {
      if (!isRecord(value)) return invalid;
      if (!Object.hasOwn(value, field.tag)) return `${path}.${field.tag} is missing`;
      const tag = value[field.tag];
      if (tag === undefined) return `${path}.${field.tag} is invalid`;
      if (typeof tag !== 'string' || !Object.hasOwn(field.branches, tag)) return `${path}.${field.tag} is not recognized`;
      return objectProblem(path, {}, field.branches[tag]!, value, phase, []);
    }
  }
}
