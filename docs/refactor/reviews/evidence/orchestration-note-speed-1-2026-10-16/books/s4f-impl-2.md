# Task: note-search speed round 1, rework (round 2 of the round) — fix the review findings; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The rulings below
are binding; do not make design decisions. Where they do not determine something, choose nothing: list it under
UNSPECIFIED with the smallest options, and go on with the next item.

**This run is headless. When your turn ends, the whole run ends.** You may start one subagent. Stay in your turn until
it has reported (wait with `sleep 300`, then `list_agents`). Keep your own context small: `grep -n`, `sed -n a,bp`.
**Finish within 90 minutes** (the run stops at 100).

## 1. What this copy is

- `slice-setup` = the lead branch `6f900eaa` with speed round 1 applied (the first session's work, unchanged; LF line
  endings). `slice-base` adds `DSH-BASELINE.md`.
- The first round's book `./.dsh-ref/s4f-impl.md` (sections 4 and 9) stays binding. A Codex review and the lead's
  verification found the items below. Fix exactly these; change nothing else.

## 2. Fixes (binding)

**F1 — composite prefix, backend parity (review item 1).** In `sqlite-text-scan.ts` `indexRecord`, when the row's prefix
becomes composite (`lookupIndexKeyOf` gives `null`), do not delete the row: `UPDATE <table> SET prefix_key = NULL, seq
= <this commit's event id> WHERE ref_key = ?`. In `searchText`'s catch-up loop, a caught-up row with `prefix_key IS
NULL` removes that refKey from the cache (`removeTextScanRow`) instead of moving it. Bucket loads never match NULL; the
rebuild still writes no row for a composite prefix. Tests (both backends, through the RecordStore port, in
`tests/record-store/SP-text-scan.test.ts` next to SP-08): **SP-08c** a search that loaded prefix A, then the record's
prefix becomes `{}`, then the same search returns `[]`; **SP-08d** (SQLite) the same with the change committed by a
second connection on the same file.

**F2 — ranking terms (review item 2).** In `note-read-model.ts` `normalizeTerms`: per term, in order: today's checks
(type, well-formed), `decodeTextTerms([raw])` (first pass), then `decodeTextTerms(first)` (second pass); the first
error in term order is the result. Return `{ rank: first-pass terms, match: second-pass terms }`. Matching
(`scopedMatches`, `allTermHeads`, `anyTermHeads`) uses `match`; ranking (`rankAll`, `rankMatches`) and `matchedTerms`
use `rank`, so scores and `matchedTerms` are as in 4B. Fix the comment above it. Tests: tighten **SP-10/SP-11** to
literal expected items (noteId, `matchedTerms`, `score`) hand-computed with 4B's ranking, with and without an anchor,
`'all'` and `'any'`; add one case where term 1 has a length error after its second pass and term 2 has a whitespace
error: the reason is term 1's.

**F3 — scoped `after` validation (review item 3).** Export `decodeTextSearchAfter(rawAfter, aggregateType)` from
`lookup-index.ts` by moving the body of the existing check in `decodeTextSearchRequest` (string, `decodeRefKey`,
aggregateType; same reason texts) into it; `decodeTextSearchRequest` calls it. In `memoryFind`'s scoped `'all'` branch,
when `after !== null`, call it with `'NoteHead'` after term validation and before reading the prefix heads; failure →
`invalid` with that reason. A canonical NoteHead key that does not exist stays a valid position. Test (both backends):
take a valid scoped cursor and replace its `after` with `'}'`, `'{"aggregateType":"Widget","id":"x"}'` and
`'not-a-ref'` → `invalid` each.

**F4 — reuse wiring (review item 4; rulings S2.3 and S2.5).** In `note-read-model.ts`:
- seed the check's anchor sets (the `Map` keyed `${projectId}\0${anchorKey}`, raw `headsByAnchorKey` results) in
  `memoryLookup`, `memoryConflicts` (every per-key read), `memoryNeighbors` (each anchor read) and `memoryStale`'s anchor
  routes (never its goal route, never from a narrower status read);
- pass the heads you already have (and the version snapshots for non-head versions) to `checkHeads` in `readNote` (head
  and version paths; keep the `checkNotes` fallback only when the head is missing), `listByAnchor` (and seed its anchor
  set) and `memoryHistory` (the head and every version it read).
- Test (both backends): a records wrapper in the style of `tests/helpers/S4B-note-check-fixture.ts:87-99` that answers
  `unavailable` when the same `s4-note-by-anchor-*` lookup (same index, values, after) is asked a second time since the
  counter was reset; reset before each platform call; then `lookup`, `conflicts`, `neighbors`, `stale` by anchor,
  `history`, `readNote` and `listByAnchor` on an anchor with 3 notes all succeed (they fail today). The wrapper counts and
  refuses calls only; it never reads contents.

**F5 — undo of a prefix move (review item 12a).** In `text-scan.ts` `restoreTextScanRow`: if the row's current prefix
differs from the one being restored, remove the row from its current bucket first. Unit test on the exported functions
of `text-scan.ts` (put in A, capture, move to B, restore, merge pending of B → B has no entry for it).

**F6 — test gaps (review item 8).** `tests/record-store/SP-literal-type.test.ts`: make the two types' values distinct
(e.g. W gets a third row with status `held`, V's row has status `closed`) so that dropping the type filter changes the
distinct count; add V's ordered asc/desc with `bound` and `after`, V's ordered count and plain count, and W's desc with
`bound` and with `after`; write expected refKeys as literal strings (or `JSON.stringify` of literal objects), not with
the product's `canonicalJson`. `tests/record-store/SP-record-store-limits.test.ts`: append limits `1` after the
`1,2,3,4,200` sequence on the same open backend.

**F7 — small cleanups (review items 5, 6, 12b, 12c; 9 naming).**
- `sqlite-text-scan.ts`: correct the reload comment (the reload drops the stale-generation structure; buckets load
  lazily, so a failed bucket read leaves no half-loaded bucket).
- Legacy drop: select only `next_fts_meta` and the virtual tables (`name LIKE 'next\_fts\_%' ESCAPE '\' AND sql LIKE
  'CREATE VIRTUAL TABLE%'`); shadow tables go with their virtual table. In `tests/helpers/SP-storage-migration-fixture.ts`
  drop the plain-table fallback for a missing fts5 (or skip the case) and fix its comment.
- Fixed SQL in `sqlite-record-store.ts` and `sqlite-text-scan.ts` becomes module-level constants, still prepared through
  the statement cache; `readMeta` no longer holds a statement outside the cache.
- Move `TEXT_SCAN_RULE_VERSION` to `sqlite-text-scan.ts`.
- Rename SP-12's title to say it is an upgrade-compatibility check (results through the ports).

**Not in this rework (reported as known costs; no change):** S2.7's decode memo; the per-removal `splice` in the memory
index; scoped find re-reading and sorting the in-scope heads on every page; engine errors on the hit read (refuted: the
same as every other read port).

## 3. Rules

- TDD for F1–F6 (a test that fails for the right reason, then the fix). Through public interfaces only, except F5's
  unit test on the pure module. No database reads to verify. Expected values literal and hand-computed.
- Production files: only `src/core/record-store/{text-scan,sqlite-text-scan,sqlite-record-store,lookup-index}.ts`,
  `src/core/work-graph/notes/note-read-model.ts`. Tests: the files named above plus new `SP-` files.
- No real model calls, no git writes, never ports 3080/3099/44797; probes under `./.dsh-scratch/`, deleted at the end.

## 4. Checks

- While working: the files you touch, `--maxWorkers=2`.
- At the end, once: `tests/record-store/`, `tests/work-graph/S4B-*.test.ts`, `tests/work-graph/S4A-*.test.ts`,
  `tests/work-graph/SP-*.test.ts`, `tests/composition/platform.test.ts`, `tests/architecture/`, `--maxWorkers=3`; then
  `npm run typecheck`, `npm run check:architecture`, `npm run build`. **Do not run the full suite.**

## 5. Reply

Under 600 words: FILES CHANGED; per fix F1–F7 done or not, with test ids RED → GREEN; CHECKS with numbers;
UNSPECIFIED.
