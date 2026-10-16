# Task: note-search speed round 2 (decision 66) — each lookup index covers only its own record type; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The rulings below
are binding; do not make design decisions. Where they do not determine something, choose nothing: list it under
UNSPECIFIED with the smallest options, and go on with the next item.

**This run is headless. When your turn ends, the whole run ends.** Do not start subagents. Keep your own context small:
`grep -n`, `sed -n a,bp`, never whole large files. **Finish within 80 minutes** (the run stops at 90).

## 1. What this copy is

- `slice-setup` = the lead branch with speed round 1 merged (`269a9748`): the text port is the in-memory scan
  (`text-scan.ts`, `sqlite-text-scan.ts`), the statement cache, literal LIMIT and literal aggregateType
  (`sqlite-sql-literals.ts`, `aggregateTypeTerm`, `AGGREGATE_TYPE_PATTERN`, the source-scanning test
  `tests/architecture/record-store-literal-type.test.ts`). `slice-base` adds `DSH-BASELINE.md`.
- Today every `next_lookup_*` index on `snapshots` holds every row of every record type: 70 indexes × 86,950 rows on the
  20,000-note dataset = 1,077 MiB of index. Measured on a copy (`./.dsh-ref/wf-measure.md`): indexes limited to their
  own type are 38 MiB, all 54 query shapes give identical results, commits get 10–25% cheaper; one upgrade at open takes
  about 7.4 s on that dataset.

## 2. Inputs (inside this copy)

- **Binding:** this book; the lead's rulings `./.dsh-ref/r2-lead-decisions.md` (R2-1 … R2-10); decision 66 in
  `docs/refactor/HANDOFF.md`.
- Background (section 4 and the rulings win): `./.dsh-ref/wf-design.md`, `./.dsh-ref/wf-review.md`,
  `./.dsh-ref/wf-measure.md`.
- The TDD skill: `./.dsh-ref/tdd/`.

## 3. Frozen files

- Never change `DSH-BASELINE.md`, `docs/`, lock files, `vendor/`, `src/core/record-store/migrations.ts`.
- Production files you may change: `src/core/record-store/sqlite-record-store.ts`, new
  `src/core/record-store/sqlite-lookup-indexes.ts`, `src/core/record-store/sqlite-sql-literals.ts`. Nothing else.
- Existing tests stay unchanged. Any existing assertion that fails: do not edit it; report it under UNSPECIFIED and go on.

## 4. Rulings (from `r2-lead-decisions.md`, binding)

1. **DDL (R2-4):** every lookup index keeps today's columns and gains `WHERE <aggregateTypeTerm(type)>`, built by the
   same helper the queries use; no `IS NOT NULL` on paths.
2. **Name (R2-3):** the suffix is FNV-1a of `LOOKUP_INDEX_RULE_VERSION` (= 2), `\0`, the raw registered name, `\0`, and
   the exact DDL body after the name. Put a comment on the builder: any text change here renames every index and
   migrates every ledger once. Never compare the stored SQL of an index that already has the expected name.
3. **Migration at open (R2-2):** `migrateLookupIndexes(db, lookups)` in `sqlite-lookup-indexes.ts`, replacing
   `createLookupIndexes`, run before the text module and before the statement cache is used; plan outside a
   transaction (list `next_lookup_*` indexes on `snapshots` from `sqlite_master`); nothing to do → no transaction;
   otherwise `BEGIN IMMEDIATE`, re-plan inside, drop the stale ones first, create the missing ones, `COMMIT`; on a throw
   `ROLLBACK` and rethrow (the factory closes and rethrows as today). No cache pragma, no VACUUM. On a fresh database
   all creates run in this one transaction.
4. **Drop rule (R2-1, (C′)):** drop an index that is not in this backend's expected set only if its stored SQL has no
   type predicate of the exact form (end-anchored `/ WHERE json_extract\(ref_key, '\$\.aggregateType'\) = '([A-Za-z][A-Za-z0-9_]*)'$/`),
   or this backend registers at least one lookup of that predicate's type.
5. **Clear the statement cache after the migration's DDL** (the round-1 rule for DDL the backend runs itself).
6. **Comments** at `sqlite-record-store.ts` that describe "every index holds every row" or the old suffix change with the
   code (R2-10).

## 5. Tests (through public interfaces; no database reads to verify; hand-computed expectations)

- **T4 (R2-5):** SQLite, two backends on one file. A registers lookups on schemas W and V and looks up both (its
  statements are cached). B opens the same file registering W with a changed path set under the same name (so B drops
  and creates a W index). Then: A's W and V pages are unchanged; a commit A makes to V is visible to A; reopening gives
  the same answers. This is a characterization test (it may pass before the change); write it first and keep it green.
- **Drop rule:** a backend opened with only some of the registrations on a file that another registration set created
  keeps answering correctly for the types it registers, and a later open with the full set answers correctly for all
  (both orders).
- **Fresh open:** opening a fresh SQLite backend with the full platform registration succeeds and answers lookups
  (characterization).
- The existing regression nets (`tests/record-store/lookup.test.ts`, `S2A-ordered-lookup.test.ts`,
  `S2C-count-lookup.test.ts`, round 1's `SP-*`) must stay green on both backends.
- The upgrade from today's full indexes, index sizes, re-prepare counts and timings are measured by the lead on a copy of
  the 20,000-note ledger (R2-5, R2-6), not in the suite.

## 6. Checks

- While working: the files you touch, `--maxWorkers=2`.
- At the end, once: `tests/record-store/`, `tests/work-graph/S4B-*.test.ts`, `tests/work-graph/SP-*.test.ts`,
  `tests/architecture/`, `--maxWorkers=3`; then `npm run typecheck`, `npm run check:architecture`, `npm run build`.
- **Do not run the full suite.**
- **Line budget (R2-7):** production net at most about +120 lines; report the count.

## 7. Reply

Under 500 words: FILES CHANGED with the production line count; per ruling 1–6 done or not; the tests RED → GREEN or
characterization; CHECKS with numbers; UNSPECIFIED.
