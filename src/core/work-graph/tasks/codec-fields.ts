/**
 * The generic record, string, ref and array field-check primitives the strict
 * record codecs share. They are pure, allocation-light predicates with no
 * domain knowledge: a codec still owns its own fields, ranges, events and indexes.
 */
export type { UnknownRecord } from '../../../contracts/validation/common.js';
export {
  isRecord as isObject, nonEmpty, isSha256Hex, isInt, isNonNeg, isPos,
  hasOnlyKeys, utf8Bytes, codePoints, inList, parseObject, invalid,
} from '../../../contracts/validation/common.js';
export { canonicalOf } from '../../../contracts/fingerprint.js';
