import type {
  ComparedMaterialV1, DuplicateCandidateV1, DuplicateLimitsV1, DuplicateLocationV1, DuplicateReportV1,
} from './ports.js';
import { readStringLiterals, readTopLevelDeclarations } from './typescript-source-query.js';

/**
 * Duplicate candidates over one comparison's already-produced material.
 *
 * The pool is the after side's TypeScript/JavaScript text only; "new" is judged against the
 * before side by (path, name) for definitions and (path, digest) for literals, never by line.
 * The report never judges whether two pieces are one rule.
 */
export const DUP_MIN_STRING_CHARS = 40;
export const DUP_LIMIT = 50;
export const DUP_LITERAL_PREVIEW_CHARS = 160;
export const DUP_REPORT_MAX_BYTES = 32 * 1024;
export const DUPLICATE_LIMITS: DuplicateLimitsV1 = {
  minStringChars: DUP_MIN_STRING_CHARS, limit: DUP_LIMIT,
  literalPreviewChars: DUP_LITERAL_PREVIEW_CHARS, maxReportBytes: DUP_REPORT_MAX_BYTES };

type Occurrence = DuplicateLocationV1 & { isNew: boolean };
type LiteralOccurrence = Occurrence & { preview: string; length: number; digest: string };

const locationOrder = (left: DuplicateLocationV1, right: DuplicateLocationV1): number =>
  left.path < right.path ? -1 : left.path > right.path ? 1 : left.line - right.line;

const candidateKey = (candidate: DuplicateCandidateV1): string =>
  candidate.kind === 'definition' ? candidate.name : candidate.digest;

/** Rule 5: deterministic order, so the cap and the byte budget always cut the same suffix. */
const candidateOrder = (left: DuplicateCandidateV1, right: DuplicateCandidateV1): number =>
  locationOrder(left.first, right.first)
  || locationOrder(left.second, right.second)
  || (left.kind === right.kind ? 0 : left.kind === 'definition' ? -1 : 1)
  || (candidateKey(left) < candidateKey(right) ? -1 : candidateKey(left) > candidateKey(right) ? 1 : 0);

const firstOther = <T extends DuplicateLocationV1>(occurrences: readonly T[], fresh: DuplicateLocationV1): T | undefined =>
  occurrences.find(item => item.path !== fresh.path || item.line !== fresh.line);

/** One candidate per key: the first new occurrence pairs with the first other location. */
function pairForKey<T extends Occurrence>(occurrences: readonly T[]): [T, T] | null {
  if (occurrences.length < 2) return null;
  const sorted = [...occurrences].sort(locationOrder);
  const fresh = sorted.find(item => item.isNew);
  if (!fresh) return null;
  const other = firstOther(sorted, fresh);
  if (!other) return null;
  return locationOrder(fresh, other) <= 0 ? [fresh, other] : [other, fresh];
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const groupedKey = key(item);
    const bucket = grouped.get(groupedKey);
    if (bucket) bucket.push(item);
    else grouped.set(groupedKey, [item]);
  }
  return grouped;
}

/**
 * Build the report from the one comparison material pair. Both thin reads run on both sides'
 * own text; a non-ready result is an internal error, never a second wire failure arm.
 */
export async function duplicateCandidates(
  material: { before: ComparedMaterialV1; after: ComparedMaterialV1 },
  limits: DuplicateLimitsV1,
): Promise<DuplicateReportV1> {
  const [beforeDeclarations, afterDeclarations, beforeLiterals, afterLiterals] = await Promise.all([
    readTopLevelDeclarations(material.before, {}),
    readTopLevelDeclarations(material.after, {}),
    readStringLiterals(material.before, {}),
    readStringLiterals(material.after, {}),
  ]);
  if (beforeDeclarations.status !== 'ready' || afterDeclarations.status !== 'ready'
    || beforeLiterals.status !== 'ready' || afterLiterals.status !== 'ready')
    throw Error('duplicate candidates: thin source reads must be ready');
  const beforeDefinitions = new Set(beforeDeclarations.value.map(item => item.path + '\0' + item.name));
  const beforeLiteralSites = new Set(beforeLiterals.value.map(item => item.path + '\0' + item.digest));

  const candidates: DuplicateCandidateV1[] = [];

  const definitions = afterDeclarations.value.map(item => ({ path: item.path, line: item.line, name: item.name,
    isNew: !beforeDefinitions.has(item.path + '\0' + item.name) }));
  for (const [name, occurrences] of groupBy(definitions, item => item.name)) {
    const pair = pairForKey(occurrences);
    if (!pair) continue;
    candidates.push({ kind: 'definition', name,
      first: { path: pair[0].path, line: pair[0].line },
      second: { path: pair[1].path, line: pair[1].line } });
  }

  const literals: LiteralOccurrence[] = afterLiterals.value
    .filter(item => item.length >= limits.minStringChars)
    .map(item => ({ path: item.path, line: item.line, preview: item.preview, length: item.length, digest: item.digest,
      isNew: !beforeLiteralSites.has(item.path + '\0' + item.digest) }));
  for (const [digest, occurrences] of groupBy(literals, item => item.digest)) {
    const pair = pairForKey(occurrences);
    if (!pair) continue;
    const literal = pair[0].isNew ? pair[0] : pair[1];
    candidates.push({ kind: 'literal',
      preview: Array.from(literal.preview).slice(0, limits.literalPreviewChars).join(''),
      length: literal.length, digest,
      first: { path: pair[0].path, line: pair[0].line },
      second: { path: pair[1].path, line: pair[1].line } });
  }

  const coverage = {
    scanned: material.after.files.length + material.after.skipped,
    skipped: material.after.skipped,
  };
  const ordered = candidates.sort(candidateOrder);
  const accepted: DuplicateCandidateV1[] = [];
  let truncated = ordered.length > limits.limit;
  for (const candidate of ordered.slice(0, limits.limit)) {
    accepted.push(candidate);
    if (Buffer.byteLength(JSON.stringify({ candidates: accepted, coverage, truncated: ordered.length > accepted.length })) > limits.maxReportBytes) {
      accepted.pop();
      truncated = true;
      break;
    }
  }
  return { candidates: accepted, coverage, truncated };
}
