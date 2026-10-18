/**
 * The ONE generic revision-pin guard.
 *
 * `pinRevision` answers a single question: does `meta.expected` carry exactly
 * ONE non-negative safe revision for this exact ref? It returns that revision or
 * null (absent, repeated, malformed). It deliberately owns no rejection message:
 * S5 Goal-setting messages stay with the Goal-setting owner, and the F2 owners
 * bring their own.
 */
import type { VersionPin } from '../../../contracts/core/identity.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { isRecord } from '../../../contracts/validation/common.js';

function refKeyOf(value: unknown): string {
  return canonicalJson(value as JsonValue);
}

/** The caller's pin revision for one exact ref, or null when absent/repeated/malformed. */
export function pinRevision(expected: readonly VersionPin[], ref: unknown): number | null {
  if (!isRecord(ref)) return null;
  const key = refKeyOf(ref);
  const matches = expected.filter((pin) => isRecord(pin) && isRecord(pin.ref) && refKeyOf(pin.ref) === key);
  if (matches.length !== 1) return null;
  const revision = matches[0]!.revision;
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}
