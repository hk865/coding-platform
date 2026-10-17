// Slice 4C RW-13 (decision 72 / spec item 13) + slice 8A (task book item 6): the
// ONE pure path-ownership decision shared by the scribe-scope, related-scope,
// graph-context and workspace file-to-module readers. Directory boundary is `/`;
// one trailing `/` is stripped from each candidate path; the longest matched
// prefix wins; a tie at the longest length is REPORTED with ALL tied candidate
// values (`tie`) and each caller decides whether a tie owns anything (the
// graph-context reader returns every tied module; the other callers treat any
// non-`owner` result as no owner). Slice 8A adds the root path `.`: it matches
// EVERY non-empty relative path with match length 0, so a concrete prefix always
// beats it and several `.` candidates tie. Empty candidate paths never match and
// an empty `path` is owned by nobody. No backslash handling.
//
// It lives in the shared Contracts layer because both `WorkspaceTools` and
// `WorkGraph` call it and neither may import the other
// (`docs/refactor/module-target.json`). `contracts/architecture-source.ts` and
// `core/work-graph/notes/note-path-ownership.ts` re-export this exact function;
// there is no second implementation.

export type PathOwnershipV1<T> =
  | { status: 'owner'; owner: T; prefix: string }
  | { status: 'none' }
  | { status: 'tie'; owners: T[]; prefix: string };

/**
 * Find the candidate whose paths own `path`. A candidate path owns `path` iff
 * the path (after at most one trailing `/` is stripped) equals it or `path`
 * starts with it followed by `/`. A stripped path of `.` owns every non-empty
 * `path` with match length 0 (the lowest possible priority). Empty paths never
 * match and an empty `path` is owned by nobody. Duplicate paths within one
 * candidate are not a tie; two different candidates sharing the longest matched
 * length are, and both values are returned.
 *
 * The `owner`/`tie` result also carries the winning stripped prefix (`.` for the
 * root), so callers that need it never re-match the paths themselves.
 */
export function pathOwnershipOf<T>(path: string,
  candidates: readonly { value: T; paths: readonly string[] }[]): PathOwnershipV1<T> {
  let best = -1;
  let bestPrefix = '';
  let owners: T[] = [];
  for (const candidate of candidates) {
    let matched = -1;
    let matchedPrefix = '';
    for (const raw of candidate.paths) {
      const stripped = raw.endsWith('/') ? raw.slice(0, -1) : raw;
      if (stripped.length === 0) continue;
      let length: number;
      if (stripped === '.') {
        if (path.length === 0) continue;
        length = 0;
      } else if (path === stripped || path.startsWith(`${stripped}/`)) {
        length = stripped.length;
      } else continue;
      if (length > matched) { matched = length; matchedPrefix = stripped; }
    }
    if (matched < 0) continue;
    if (matched > best) { best = matched; bestPrefix = matchedPrefix; owners = [candidate.value]; }
    else if (matched === best) owners.push(candidate.value);
  }
  if (best < 0) return { status: 'none' };
  if (owners.length > 1) return { status: 'tie', owners, prefix: bestPrefix };
  return { status: 'owner', owner: owners[0]!, prefix: bestPrefix };
}
