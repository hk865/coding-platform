# Speed round 2 (lookup indexes per record type): lead rulings, 2026-10-16 ~15:10

Inputs: `r2-measure/wf-measure.md` (measured on a copy of the 20k ledger), `wf-design.md`, `wf-review.md`.
The book is written after round 1 merges (round 2 changes `sqlite-record-store.ts`, which round 1 also changes).

## What the measurement says

- Lookup indexes 1,076.6 MiB → 38.1 MiB at 20k (vacuumed file 1.72 GB → 0.78 GB); 54/54 query shapes give identical
  results.
- Commits 10–25% cheaper at synchronous FULL (fsync ~14–15 ms dominates); 4.5–15× less database work without fsync.
- Cached reads: no gain (round 1's statement cache already gives it); prepares on a cache miss 2–3× cheaper.
- A bound aggregateType re-prepares on every execution once one partial index exists: 15–20× slower cached reads. This
  is why the literal type moved into round 1 (book S3.3, 10-16).
- Upgrade at open, 20k warm: 7.43 s in one transaction (drop first); the file keeps its size until VACUUM.
- So round 2 pays in size and write cost, not read speed. Possibly the biggest test-suite effect: a fresh SQLite open
  today runs ~70 autocommit CREATE INDEX (~1 s at 14–15 ms per commit, ESTIMATE); one transaction removes most of it.

## Rulings

- **R2-1 drop rule: (C′).** Drop an unregistered `next_lookup_*` index only if its stored SQL has no type predicate of
  the exact form, or this backend registers a lookup of that predicate's type. (A) would drop the NoteHead indexes
  under `raceWindow` (plan.ts:805-807) and 57 indexes under measure-4b-final.mjs:212.
- **R2-2 migration:** new `migrateLookupIndexes` (in `sqlite-lookup-indexes.ts` or the store file, not
  `migrations.ts`); plan outside, `BEGIN IMMEDIATE`, re-plan inside, drop first, create, commit; nothing to do → no
  transaction. No cache pragma, no automatic VACUUM, no manual VACUUM step. Not raising `busy_timeout`.
  - Accepted limit (STATUS): a one-time upgrade holds the ledger lock (readers too, rollback journal) for ~7 s at 20k;
    a second Host or script opened meanwhile fails with SQLITE_BUSY. Real ledgers today are hundreds of rows
    (milliseconds). Also: a ledger opened by round 2 then opened by a pre-round-1 build rebuilds the full indexes.
- **R2-3 name:** FNV-1a of `LOOKUP_INDEX_RULE_VERSION` (= 2), raw registered name, and the DDL body after the name; a
  comment on the builder: any text change here renames every index and migrates every ledger once. No comparison of the
  stored SQL of an index that already has the expected name (AGENTS rule 4).
- **R2-4 layout:** keep the leading type column; `WHERE json_extract(ref_key, '$.aggregateType') = '<Type>'` from round
  1's `aggregateTypeTerm`; no `IS NOT NULL` on paths.
- **R2-5 tests:**
  - T1 (type isolation) and T5 (registration pattern): done in round 1 (S3.3).
  - T2 (upgrade from full indexes): evidence, not a suite test (its raw-DDL setup is outside the closed fixture list of
    slice-4 SPEC :698). Evidence on a copy of the 4B 20k ledger: answers through the public port before and after equal;
    `sqlite_master` listing and dbstat before/after.
  - T3 dropped: 2C-08 (`S2C-count-lookup.test.ts:325-348`) and QA-03 (`S2A-ordered-lookup.test.ts:362-385`) already
    reopen with a changed registration under the same name.
  - T4 kept with the review fix: B registers W with a changed path set (same name), so B drops and creates a W index
    while A holds cached W and V statements; A's pages unchanged, A's new commit visible, reopen same. Characterization
    test (passes today).
- **R2-6 cost rows (decision 69 item 1), measured through the public port on the 20k copy before merge:**
  lookup-index bytes ≤ 45 MiB; 0 re-prepares per execution for every shape (authorizer count), including number and
  boolean matchers, integer-ordered asc with `bound`, integer-ordered count; upgrade at open ≤ 10 s warm; steady-state
  open within noise of today's 3.3 ms; fresh-database open time before/after (report; expect ~1 s less);
  `S2A-notices-overbound` no worse; store reads per call unchanged; EXPLAIN shows each shape on its own type's index.
- **R2-7 line budget and reuse (decision 69 item 5):** production net ≤ +120 lines; reuse round 1's
  `sqlite-sql-literals.ts`, statement cache and the lookup registry; the only new module allowed is
  `sqlite-lookup-indexes.ts`.
- **R2-8 inventory:** the lead redoes the bound-type inventory on round 1's merged code before writing the book; round 1's
  architecture test (`record-store-literal-type.test.ts`) guards the rest.
- **R2-9 not in round 2:**
  - the 5 `s4b-note-by-path-*` indexes the planner never picks (the anchor index serves the path-ordered query; 14.5 MiB,
    5 of 13 index writes per head write): to the note-area audit after 4C, with EXPLAIN evidence;
  - Design S (one parse inside the store, `validateBody`): candidate for the cleanup audit, next to the PE run's
    "schema-driven codecs" question.
- **R2-10 docs (lead):** comments at sqlite-record-store.ts:4-7, :22-23, :90-95 change with the code (DSH); the lead
  updates the R3c/N0 "safe expression indexes" wording, IMPLEMENTED-CAPABILITIES, record-store.md and the decision-66
  evidence.
