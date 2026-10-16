# Pre-read report: s4f note-search round 1

No files changed; `git status` clean.

## 1. Unclear (could not implement without guessing)

- **S1.2/S1.4 — null prefix key.** `lookupIndexKeyOf` returns `null` for a composite prefix. The compact table's `prefix_key` stores `JSON.stringify(value)`. Options: (a) still upsert a row whose `prefix_key` is the string `"null"` (unreachable, since reads bind the encoded key); (b) skip the row. `NoteHead`'s only prefix path is `ref.projectId`, always a string, so either is invisible today.
- **S1.3 — code encoding.** "sha256 of …" gives no serialization. Options: (a) keep today's `JSON.stringify({name, aggregateType, prefixPaths, textPaths, ruleVersion:2, unicode, icu})`; (b) NUL-joined fields. Both are opaque; only (a) is a smaller diff.
- **S1.4 — meta row missing at write time.** The ruling only defines "stored code ≠ own code". Options: (a) missing also counts as not-own-code → skip upsert, don't advance; (b) upsert anyway. I would take (a).
- **S1.6 — "cache is ahead".** Options: (a) reload iff `cache.through === null || cache.through > max || cache.generation !== meta.generation`; (b) also treat `through < max` with an unloaded new bucket as ahead. (a) is what the text says.
- **S2.3 — which reads seed the goal map.** "Never seed from a 2-state read" is undefined, and S2.4 removes the read model's own `currentHeadsForGoal` call, so in production no goal set is read. Options: (a) seed goals only from `currentHeadsForGoal` (4 states) → effectively never; (b) also seed `headsOnReviewStatus` when `states` has all four.
- **S2.5 — `anchorSets` shape.** Options: (a) `Map<string, NoteHeadSnapshot[]>` keyed `` `${projectId}\0${anchorKey}` ``; (b) `{ anchorKey, heads }[]`. (a) matches S2.3's seed key.
- **S2.8 — the ascending-scan bound for u\*.** At the first item you don't know the largest version in the page. Options: (a) bound by the page/list maximum (preserves today's read set exactly, so failures are unchanged); (b) scan to `head.version` (reads more; a damaged version above the page could turn a today-`false` into `unavailable`). (a) matches "reads happen in the same order".
- **S3.1 — DDL vs the statement cache.** Options: (a) clear the cache after open/rebuild DDL; (b) rely on SQLite re-prepare. (a) is safe.
- **S3.2 — the LIMIT helper's "range".** Options: (a) accept any safe integer ≥1 and only require the literal stays valid; (b) bound by the shape's page max (200/100). (a).

Minor: S1.10's exported per-term decode name/signature and whether S2.1 reuses the port reason text verbatim (the new test "same invalid reason with and without an anchor" implies verbatim); S2.7's memo relies on five decoded paths, and `readAllHeads` is module-level, so the memo must be threaded through `headsByAnchorKey`/`currentHeadsForGoal`/`headsOnReviewStatus`.

## 2. Code differs from the book

- §3 assigns `note-record-codecs.ts` to "S2.4", but the `NOTE_TEXT_PATHS` export it needs is required by **S2.1**. No such constant exists: the registration is inline at `note-record-codecs.ts:666-667`.
- §3 allows `create-platform.ts` changes for "the removed `fullTextProbe` / port cap". Production never passes either to a backend (`create-platform.ts:563-564`); only `noteLimits.textSearchCandidateMax` exists (line 262, read model/check). The real change is the `NoteHeadCheckPort` annotation at line 1303.
- §3 cites `lookup.test.ts:137-151` as the "one per open" pattern; those lines are the invalid-registration loop. The `open` helper is `lookup.test.ts:43-53`.
- S2.7 names `anyTermHeads` as a streaming decode site, but S2.2 deletes that function.
- `TEXT_SEARCH_RULE_VERSION` is exported from `sqlite-text-search.ts:35` and no test imports it, so deletion is safe; the new constant belongs in `sqlite-text-scan.ts`.

## 3. Tests that will break

Outside §3's allowed list I expect **none**, but these should stay green and are the ones I would watch:

- `tests/work-graph/S4B-memory-ranking.test.ts:185-203` — asserts a fully-filtered `match:'all'` page is `complete:false` with a cursor. Only the **scoped** `'all'` path changes (S2.1), so it must keep the one-port-call rule; applying scoped paging here would fail it.
- `tests/record-store/S4B-text-search.test.ts:703-752` — >1000 rows, `complete:true` on a one-match page; safe because all rows are window-false-positives too, but only if `next`/`complete` keep the look-ahead meaning.
- `tests/work-graph/S4B-memory-anchor-not-found.test.ts:96-100` — anchor+terms must still return `anchor_not_found`, i.e. keep term validation *after* the existence check (S2.1).
- `tests/architecture/production-reach.test.ts` — if the new scan stops using `textSearchMatches` (or any removed export keeps a straggler), an unreached node fails it.

## 4. Plan (150 min)

- **G1, S1 + S3.1/S3.2 — ~80 min.** Subagent A owns new `sqlite-text-scan.ts` (table/meta/rebuild/legacy drop/catch-up) against a frozen port interface + SQLite NE2 tests; I do `text-scan.ts` (row derivation, memory index, scan), both backend rewrites, `match`, cap removal, term decode, then the allowed test removals. Then S3.1/S3.2 in `sqlite-record-store.ts`.
- **G2, S2.1–S2.5 — ~55 min**, after G1 tests pass. No subagent (it builds on G1's port).
- **G3, S3.3 + cleanup — ~25 min** (`sqlite-sql-literals.ts`, registry pattern, literals, architecture test, stragglers).
- Then §7 checks ~15 min. **Total ≈175 min: 150 is not enough.** I would finish S1 + S3.1/S3.2 + S2.1–S2.5, and leave **S3.3, S2.6, S2.7, S2.8** for round 2 (S3.3 is safe to defer because round 2's per-type index is what makes it urgent).