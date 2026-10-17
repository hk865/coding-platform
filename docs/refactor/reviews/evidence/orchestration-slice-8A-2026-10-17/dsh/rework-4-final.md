Done.

**Files changed**
- `src/core/work-graph/architecture/catalog-service.ts`: fresh revise now returns `catalog.since = committed.cursor` (spread of the pre-bind record); `restoreRevised` binds `since = receipt.cursor` so replays also match.
- `tests/work-graph/S8A-catalog-version-time.test.ts`: added the required test (write-result `since` equals current-read `since`, non-null, memory + SQLite).

**RED → GREEN**
- RED: A1 ~289 (`since: null` vs `"c0000000004"`); new test failed both stores.
- GREEN: A1 2/2; all 9 `S8A-*` files 67/67; catalog + architecture + A1 batch 13 files 137/137; `npm run typecheck` clean. All `--maxWorkers=2`; no model calls, no git writes, no forbidden ports.

UNSPECIFIED: none.