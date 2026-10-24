/**
 * Ledger cursor shapes. The platform's commit cursor is `c` and ten digits; the field-table check (`data-format.ts`)
 * and the Session codecs share this one copy.
 */
import { nonEmpty } from './common.js';

/** Platform ledger cursor, opaque to the domain except for this shape rule. */
export function isPlatformCursor(value: unknown): value is string {
  return nonEmpty(value) && /^c\d{10}$/.test(value);
}
/** Spec §2.3: a stored notice position must be a NONZERO ledger commit cursor. */
export function isNonZeroPlatformCursor(value: unknown): value is string {
  return isPlatformCursor(value) && value !== 'c0000000000';
}
