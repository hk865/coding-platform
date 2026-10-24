/**
 * Time shapes. The field-table check (`data-format.ts`) and the Run activity codecs share this one copy.
 */
import { nonEmpty } from './common.js';

/** An ISO UTC time: it ends in `Z` and `Date.parse` reads it. */
export function isIsoZulu(value: unknown): value is string {
  return nonEmpty(value) && value.endsWith('Z') && Number.isFinite(Date.parse(value));
}
