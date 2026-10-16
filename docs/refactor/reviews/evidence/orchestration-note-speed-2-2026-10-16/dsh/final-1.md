## FILES CHANGED

- `src/core/record-store/sqlite-lookup-indexes.ts` — **new, 141 lines**
- `src/core/record-store/sqlite-record-store.ts` — **+13 / −50** (net −37)
- `tests/record-store/SP-lookup-index-migration.test.ts` — new (4 tests; not production)
- **Production net: +104 lines** (≤ +120). `sqlite-sql-literals.ts` unchanged (reused `aggregateTypeTerm`).

## RULINGS 1–6

1. **DDL — done.** Columns unchanged; `WHERE <aggregateTypeTerm(type)>` from the same helper the queries use; no `IS NOT NULL` on paths.
2. **Name — done.** FNV-1a over `LOOKUP_INDEX_RULE_VERSION(2)\0rawName\0body`; builder comment records that any text change renames every index and migrates every ledger; an expected name is never SQL-compared (skipped before reading `sql`).
3. **Migration — done.** `migrateLookupIndexes(db, lookups)` replaces `createLookupIndexes`, called after `initRecordStoreSchema` and before the text module. Plan outside via `sqlite_master`; empty plan → no transaction; else `BEGIN IMMEDIATE`, re-plan inside, drop stale first, create missing, `COMMIT`; throw → `ROLLBACK` + rethrow. No cache pragma, no VACUUM.
4. **Drop rule (C′) — done.** Exact end-anchored regex; drops an unregistered index iff its SQL has no such predicate, or its predicate type is in this backend's registered types.
5. **Cache clear after DDL — done.** Migration uses raw `db.exec`/`db.prepare`; the existing `statements.clear()` after the text module covers its DDL (no cached statement is used before it).
6. **Comments — done.** Header and `lookup`-keyset comments now say per-type partial indexes/migration; the old "every index / pre-2A fingerprint" block is removed.

## TESTS

**Characterization (green before and after), no RED possible:** results do not depend on whether an index exists, exactly as R2-5 frames T4. SP-40 = T4 (A registers W+V; B reopens registering W with a changed path set; A's W/V pages `toEqual` before/after, A's new V commit visible, reopen same). SP-41/SP-42 = drop rule in both orders through public `lookup` only. SP-43 = fresh full-platform open + lookup. No DB reads.

## CHECKS

- Final combined `tests/record-store/ tests/architecture/ tests/work-graph/S4B-*.test.ts tests/work-graph/SP-*.test.ts --maxWorkers=3`: **50 files, 534 passed, 5 skipped, 0 failed**.
- `tests/record-store/` alone: **186 passed** (incl. lookup, S2A, S2C, SP-*).
- `npm run typecheck` OK; `npm run check:architecture` OK (RecordStore 17 source files); `npm run build` OK.
- Full suite not run.

## UNSPECIFIED

- SP-43's "full platform registration" is assembled from `platformRecordSchemas()` plus the NOTE/DECISION/LINE_SETTINGS bundles, matching `create-platform.ts:525-550`, because no exported full-set builder exists (smallest concrete option).
- The actual drop-of-legacy-full-indexes and create-of-partials are not observable through public ports and are not asserted; they remain the lead's copy measurement (R2-5/R2-6).
- TDD's red-first step is intentionally absent for all three behaviors (characterization per the ruling).
- No existing assertions failed; no frozen file touched.