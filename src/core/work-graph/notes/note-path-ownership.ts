// Slice 4C RW-13 (decision 72 / spec item 13): the ONE pure path-ownership
// decision shared by the scribe-scope, related-scope and graph-context readers.
// Directory boundary is `/`; one trailing `/` is stripped from each candidate
// path; the longest matched prefix wins; a tie at the longest length is REPORTED
// with ALL tied candidate values (`tie`) and each caller decides whether a tie
// owns anything (the graph-context reader returns every tied module; the other
// callers treat any non-`owner` result as no owner). No `.` semantics (8A adds
// it) and no backslash handling.

export type PathOwnershipV1<T> =
  | { status: 'owner'; owner: T }
  | { status: 'none' }
  | { status: 'tie'; owners: T[] };

/**
 * Find the candidate whose paths own `path`. A candidate path owns `path` iff
 * the path (after at most one trailing `/` is stripped) equals it or `path`
 * starts with it followed by `/`. Empty and `.` paths never match. Duplicate
 * paths within one candidate are not a tie; two different candidates sharing
 * the longest matched length are, and both values are returned.
 */
export function pathOwnershipOf<T>(path: string,
  candidates: readonly { value: T; paths: readonly string[] }[]): PathOwnershipV1<T> {
  let best = -1;
  let owners: T[] = [];
  for (const candidate of candidates) {
    let matched = -1;
    for (const raw of candidate.paths) {
      const stripped = raw.endsWith('/') ? raw.slice(0, -1) : raw;
      if (stripped.length === 0 || stripped === '.') continue;
      if (path === stripped || path.startsWith(`${stripped}/`)) {
        if (stripped.length > matched) matched = stripped.length;
      }
    }
    if (matched < 0) continue;
    if (matched > best) { best = matched; owners = [candidate.value]; }
    else if (matched === best) owners.push(candidate.value);
  }
  if (best < 0) return { status: 'none' };
  if (owners.length > 1) return { status: 'tie', owners };
  return { status: 'owner', owner: owners[0]! };
}
