import { rejected } from '../../contracts/core/rejections.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import { canonicalJson, type JsonValue } from '../../contracts/fingerprint.js';
import type { ContextExtensionsV1, ContextIndexRowV1, ContextSourceV1 } from '../../contracts/graph-context.js';

export function byKey(left: { key: string }, right: { key: string }): number {
  return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
}
/** Propagate a must-fail read with its own code; never turn it into a ready default. */
export function mapRead(result: ReadResult<unknown>): CoreRejection {
  if (result.status === 'ready') return rejected('unavailable', 'a must-fail read unexpectedly returned a value');
  if (result.status === 'not_found') return rejected('not_found', 'the required fact was not found');
  if (result.status === 'not_ready') return rejected('incomplete', 'the required fact is not readable at the required watermark');
  return { status: 'rejected', code: result.code, reason: result.reason, ...(result.current === undefined ? {} : { current: result.current }) };
}
export function requirementIdOf(declarationId: string): string {
  return declarationId.startsWith('legacy:') ? declarationId.slice('legacy:'.length) : declarationId;
}
export function emptyNotes(): ContextExtensionsV1['notes'] {
  return {
    availability: 'not_implemented',
    understanding: { rows: [], norms: [], normsOmitted: 0 },
    general: [],
  };
}
export function indexRowText(row: ContextIndexRowV1): string {
  return canonicalJson({ key: row.key, node: row.node, text: row.text, sources: row.sources } as unknown as JsonValue);
}
export function canonical(value: unknown, fallback: string): string {
  try { return canonicalJson(value as JsonValue); } catch { return fallback; }
}
export function sortedSources(sources: readonly ContextSourceV1[]): ContextSourceV1[] {
  const byCanonical = new Map<string, ContextSourceV1>();
  for (const source of sources) {
    const key = canonical(source, '');
    if (key !== '') byCanonical.set(key, source);
  }
  return [...byCanonical.entries()]
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
    .map((entry) => entry[1]);
}
