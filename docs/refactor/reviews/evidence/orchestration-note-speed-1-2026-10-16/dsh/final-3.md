All three items are fixed and verified.

**What changed**

1. `tests/work-graph/SP-note-reuse.test.ts` — `ids[1]` now `contradicts` `ids[0]` on the project anchor, and a scribe `reviewNote` gives `ids[0]` version 2. Calls now: `neighbors` on `ids[1]`, `readNote(ids[0], version:1)`. Added literal item asserts: conflicts `[[ids[0],2],[ids[1],1]]`, neighbors `[[ids[0],2]]`, history `[[ids[0],2],[ids[0],1]]`, readNote `[ids[0],1]`. The wrapper now refuses a `readMany` key on its **third** read instead of the second: the read model legitimately reads a non-head version twice (confirmation scan + page build); the check's extra read is the third.
2. `tests/record-store/SP-literal-type.test.ts` — added V row `v3 {status:'open', n:3}`, sharing `open` with W's `w1`. Plain counts `w-plain`/`v-plain` `['shared','open']` are now `1` (were `2` without the type term). Asc bounds moved to `2` (drop first row) and desc bounds to `2` (drop last): `wAsc=[w2,w3]`, `wDescBound=[w2,w1]`, `vAsc=[v2,v3]`, `vDescBound=[v2,v1]`; updated `after`, distinct and ordered counts. Keys stay literal.
3. `src/core/record-store/sqlite-text-scan.ts` — `ADVANCE_META_SQL` is now a module constant, prepared via `prepare(ADVANCE_META_SQL)`.

**RED → GREEN**

1. Reverted `anchorSets.set(...)` in `memoryNeighbors` → `neighbors should be ready: expected 'rejected'` (both backends). Also reverted the `readNote` `versionSnapshots` arg → `readNote should be ready: expected 'rejected'`. Restored → 2/2 pass.
2. Dropped `aggregateTypeTerm` in `countInside` → `w-plain` count `1`→`2`. Dropped it in `lookupOrderedInside` → V refKeys leaked into `wAsc`. Restored → 6/6 pass.

**Checks**

- `tests/record-store/` `--maxWorkers=2`: 12 files, 182 passed.
- `tests/work-graph/SP-*.test.ts` `--maxWorkers=2`: 4 files, 36 passed, 1 skipped.
- `npm run typecheck`: exit 0.