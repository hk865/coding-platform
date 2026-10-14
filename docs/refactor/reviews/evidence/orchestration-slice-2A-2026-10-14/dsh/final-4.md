**Helper.** `orderedRangePlanOf` / `OrderedRangePlan`, `src/core/record-store/lookup-index.ts:304–340`, beside `decodeOrderedLookupRequest`. It compares `after.order` vs `bound.value` with `compareOrderedValues` (direction-aware) and returns the single range term plus whether the `(order, ref_key)` keyset filter is still implied.

**SQL.** `src/core/record-store/sqlite-record-store.ts:620–658` (import at :36). The order column now gets at most one lower and one upper range term: the computed term replaces the integer safe-range side (`-MAX` asc / `+MAX` desc), the other safe side stays; the row-value filter is emitted only when `plan.keyset`. Equality prefix, `json_type`, `<> ''`, `ORDER BY`, `LIMIT` unchanged; in-memory backend untouched. Scratch `EXPLAIN QUERY PLAN` (deleted) shows the index with a single range term and no temp B-tree.

**New tests** (`tests/record-store/S2A-ordered-lookup.test.ts`): two `it.each` blocks — text and integer, memory+sqlite. Entirely new: `after.order` equal to an exclusive bound; equal to an inclusive bound with ties decided by `refKey`; explicit after-only/no-bound and the desc mirror. Normal continuation and asc after-before-bound already existed. File 19 → 23 tests.

**Counts.** Required run: 22 files, 153 tests passed. `typecheck`, `check:architecture` pass.

**sha256 (unchanged).**
- DSH-BASELINE.md `4133c9ee218aaac96ce5e2eb5a0dc0c00272fa2e62328a7cef59b1501e0844bd`
- S5R2-queue-history `0f3b59a9315fb0efaf7422802789a503149a80fa5bd4247b932528ecafe6339f`
- WP2-context-extensions `348fe88921267be4db0b604339bb616f9f27ef9141572bb00ff466cf82e3c8cb`
- WP2-undelivered-notices `ff6cf385f3c94857eb088b262c283ba6276d723178713a7fa026840a51226e10`

**`git status --short`**
```
 M src/core/record-store/lookup-index.ts
 M src/core/record-store/sqlite-record-store.ts
 M tests/record-store/S2A-ordered-lookup.test.ts
```