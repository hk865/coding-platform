# Adversarial review: RecordStore read-cost design (store-reads), HEAD ad2679f3

I only read files: no runs, no edits. Statements about SQLite and Node internals are marked "(from SQLite/Node source knowledge, not verified here)". Node is not installed on this Windows host and `node_modules` is absent, so I could not probe them.

## Problems

**1. The R1 memo at the streaming decode sites holds every streamed head for the whole call. The "no extra memory" claim is wrong.**
- Evidence:
  - `anyTermHeads` decodes every record in a stream (`note-read-model.ts:893-897`) but keeps only in-scope heads (`:902-904`).
  - `allTermHeads` does the same (`:838-845`).
  - In the profile's anchor case that is 19,609 heads decoded and 279 kept (`summary.md:31`, `:55`).
  - The design lists `:839` and `:894` as memo sites. It also says "Memory: the decoded heads a call already holds (up to the 1,000 cap plus anchor sets), no extra."
- Why it matters:
  - A memo keyed by `json` keeps both the JSON string, which today is discarded after decoding, and the decoded object of every streamed match.
  - Even after the anchor-first change, a filtered `'any'` search over a common term still streams all matches. Examples: a `state` or `kind` filter (`headInScope`, `:741-749`).
  - These sites also gain almost nothing from a memo. Each refKey is decoded at most once per stream merge (`seen`, and the `head === null` guard at `:893`).
  - Memory use is unmeasured (`summary.md:78`), and WSL has a 15 GB limit.
- Fix:
  - Memoize only at the head-set and single-head reads: `:127` through a read-model wrapper (see item 2), `:146`, `:520`, `note-views.ts:198`.
  - Never insert from `:839` or `:894`, or put a hard size cap on the memo.
  - Correct the memory sentence in section 6.

**2. R1's placement contradicts itself because `readAllHeads` is shared with the write path.**
- Evidence:
  - The memo site `note-read-model.ts:127` is inside the exported `readAllHeads` (`:121-132`).
  - That function is called by the writer at `note-service.ts:236` and `:248`, and by the scribe scope at `scribe-scope.ts:282`.
  - The design says "Not on the write paths (note-service.ts:167, scribe-scope.ts:314)". Those two lines are the writer's own decoders. They are not the shared function.
- Why it matters: putting the memo into `readAllHeads` gives the write path shared head objects too. That is exactly what the design says it excludes.
- Fix: give `readAllHeads` an optional `memo?` parameter, which the write paths never pass. Or memoize only in the read model's own wrappers: `headsByAnchorKey :187`, `currentHeadsForGoal :201`, `headsOnReviewStatus :534`.

**3. R1 cannot reach across the check port, so "about 2 parses per note per call" is only true per port call. Decision 66's wording needs an explicit ruling.**
- Evidence:
  - The read model calls `deps.check.checkNotes(ctx, { items })` with ids and versions only (`note-read-model.ts:376-377`).
  - The check creates its own per-call caches (`note-views.ts:1003`) and reads every item's head again (`:869` → `:192-201`).
  - The "check's `CheckCaches`" is therefore a second memo, not the same one.
- Why it matters:
  - A checked item is still read and parsed in two places: store plus reader in the read model, then store plus reader in the check. That is at least 4 parses, plus derivation reads.
  - It stays that way until (b)3 is fixed. Fixing (b)3 means passing heads through `NoteCheckPort`, an internal contract change the design does not name.
  - Decision 66 says each note is read once and parsed once within one call (`HANDOFF.md:420`). Under AGENTS rule 3 (`AGENTS.md:32`) product decisions belong to the user, so the R1 reading should be ruled on and recorded, not just "stated plainly".
- Fix: say per port call; list the `NoteCheckPort` change as the (b)3 prerequisite; have the lead record how decision 66 is read.

**4. New tests 1, 2 and 5 tamper with the database through a second connection. Repo rules forbid that.**
- Evidence:
  - AGENTS rule 4 says not to restore defensive checks or tests that can only be triggered by tampering with the database (`AGENTS.md:33`).
  - Rule 3 says not to add non-blocking tests (`:32`).
  - Spec §7 says fixtures build data only through public services, with a closed list of exceptions that does not include tampering (`slice-4-SPEC.md:698`; also `:585`).
  - The existing tamper tests (`lookup.test.ts:174-202`, `R3a-transaction-boundaries.test.ts:76-133`) predate these rules.
- Extra problem with test 1 "searchText → corrupt, reason pinned":
  - Today the recheck parses the current, tampered body (`sqlite-record-store.ts:831-842`).
  - Under route two, matching uses the compact text written at commit time. Whether a tampered head is reached at all then changes.
  - A characterization test would pin behaviour that route two changes.
- Fix:
  - Cover S with test 4: a pure codec equivalence test on fixture JSON strings and mutated strings, with no database.
  - Keep test 3: a synthetic Widget schema, through public `commit` and `readMany`.
  - Keep test 6.
  - Get a lead ruling before keeping any second-connection test. Test 5's re-prepare path is SQLite's own guarantee and is already exercised on the write side by `R3a :76-101`.

**5. Round two: index naming means partial indexes may never be created on existing databases, and old indexes are never dropped.**
- Evidence:
  - `createLookupIndexes` names an index from a fingerprint of `aggregateType\0paths` (plus orderBy) (`sqlite-record-store.ts:111-114`).
  - It runs `CREATE INDEX IF NOT EXISTS` (`:115`).
  - Nothing drops stale `next_lookup_*` indexes (`migrations.ts:1-155` never drops anything).
- Why it matters:
  - If a `WHERE` is added without changing the fingerprint, an existing database keeps the old full index under the same name.
  - If the name does change, all 71 old full indexes stay. The planner still weighs them (the 155 µs prepare, `summary.md:42`), and they are still 60% of the file (`:81`).
  - The cached-statement argument in section 1 ("open-time DDL runs before caching") silently depends on this being right.
- Fix: put the partial predicate (or a rule version) into the fingerprint. At open, before any statement is cached, drop `next_lookup_%` indexes that are not in the registered set, in one transaction. Check EXPLAIN.

**6. A bound aggregateType must become a literal in every `snapshots` query once any partial index exists, not only so the query's own type can use one. The literal also needs validation.**
- Evidence:
  - Bound `json_extract(ref_key,'$.aggregateType') = ?` appears at `sqlite-record-store.ts:582-583`, `:639-640`, `:735-736`, `sqlite-text-search.ts:301-302`, and once at open at `:205`.
  - SQLite's partial-index check compares that query term against every partial index's WHERE on the table. When the right side is `?`, `exprCompareVariable` sets the variable's expmask, so every bind expires the statement and forces a re-prepare (from SQLite/Node source knowledge, not verified here). This is the same per-bind re-prepare the design blames for `LIMIT ?`.
  - So with any partial index of that form on `snapshots`, `countInside` would go from 3.7 µs (`summary.md:42`) to about 150 µs per execution even though it has no LIMIT.
  - aggregateType is only checked as a non-empty string (`record-codec.ts:159`, `lookup-index.ts:89`).
- Why it matters:
  - The design frames the literal as "for the planner to use a partial index". The bigger effect is a regression on every bound-type query.
  - A raw literal needs `''` escaping. An embedded U+0000 would truncate the SQL text if Node passes the text NUL-terminated, which I believe it does (unverified).
- Fix:
  - One `sqlTextLiteral` helper that rejects NUL and non-`^[A-Za-z][A-Za-z0-9_]*$` values, checked at lookup registration.
  - Apply it to all bound aggregateType sites, including any route-two query on `snapshots`.
  - Rule: no `?` on the right of a term whose left side equals a partial-index WHERE left side.

**7. The acceptance check only measures `lookupInside` shapes.**
- Evidence:
  - All six cases in `sql-micro-4.mjs` use `W(slot)`: anchor lookups, without `after`.
  - `sql-micro-2.mjs` is the same query.
  - None covers `lookupOrderedInside`: bound range terms `:660-686`, the row-value keyset `:689`, DESC, bound `±safeIntegerMax` `:668-684`.
  - None covers `countInside` distinct `:772-780`, the primary-key read `:387`, or `readThrough :333`.
  - Test 8 only says to re-run `sql-micro-4`.
- Why it matters: the savings claimed for `:693` and for the cached primary-key and count statements are unmeasured, and the acceptance check cannot catch a remaining re-prepare in those shapes.
- Fix: extend the micro to every shape, both fresh and reused, and run it before and after round two. The target is about 10 µs or less for a reused empty or small result.

**8. Literal LIMITs combined with a 256-entry LRU can thrash, and then the savings disappear for those callers.**
- Evidence:
  - Computed limits exist at `track-read-model.ts:615`, `:670`, `:835`, `:881`, `:974`, `:1102`; `work-line-reader.ts:2826`, `:2909`, `:2979`; `node-detail-reader.ts:1072`; `session-directory.ts:1641`.
  - The platform registers lookups from about 20 modules (`create-platform.ts:541-550`), multiplied by `after`, the matcher kinds (including the `IS NULL` shape) and the ordered-plan variants.
- Why it matters: each miss is a fresh 155 µs prepare. That is not worse than today, but none of the gain arrives, and a busy Host could push the shape count past 256.
- Fix:
  - Make the power-of-two rounding the default, not an option: literal = smallest 2^k ≥ limit+1. That gives at most 9 variants per base shape.
  - Keep `hasNext` and the slice exactly as they are.
  - Count shapes by instrumenting misses in a full run, then size the cache (for example 1024).
  - Add rounding-boundary rows to test 6: limit, limit+1, 2^k and 2^k+1 matches.

**9. The optional in-memory "keep the JSON text" extra needs rollback support.**
- Evidence: commit rollback restores only the object (`in-memory-record-store.ts:370-373`). The readers re-serialize at `:195` and `:237`.
- Why it matters: if the text sits in a separate map, a failed commit leaves the text and the object out of step, and reads then disagree with SQLite.
- Fix: store `{ body, json }` as one Map value so rollback restores both together.

**10. Small accounting gaps and a missing call site.**
- `readThrough` runs once per `readManyInside` call (`sqlite-record-store.ts:410`), not once per record. "2 prepares per store read" only holds for single-key reads.
- R1's site list leaves out the NoteVersion and CurrentPointer decodes (`note-read-model.ts:157`, `:411`; `note-views.ts:210`).
- History has redundancy the profile did not measure (`summary.md:78`). `confirmedByUserOfVersion` (`note-read-model.ts:171-185`) is called for each version on a page (`:1233`). Each call re-reads versions 1..v until it finds a user confirmation, so a page costs O(page × v) version reads.
- Decision 66's goal of removing redundant work within a call should cover this: one ascending pass, or a per-call version memo.

**11. R3's cost is overstated.**
- Evidence:
  - Each returned `EncodedRecord` is a fresh object for every store read (sqlite `:408`, memory `:247`).
  - No code in `src` assigns to `.json`, `.revision`, `.refKey` or `.schemaId` of a record (grep found none).
- Why it matters: a body stored in a WeakMap is reachable only through its own fresh record object, the same exclusivity as today's fresh parse. No deep freeze is needed, so results do not gain frozen objects. What remains is a shallow freeze of the returned records and the coupling to object identity; a wrapper that copies records just misses and falls back to parsing, which is still correct.
- Fix: correct the R1-vs-R3 comparison before the lead chooses between them.

**12. S changes the registration contract.**
- Evidence: `validateBody` changes `EncodedRecordSchema` (`ports.ts:154-160`). It must also be added to the explicit frozen copy (`record-codec.ts:164-169`), or it is silently dropped.
- Why it matters: it is additive, but it is a `ports.ts` contract change. The design says "no change to the port's shape" and flags only R4.
- Fix: name it as a contract change. Document that `validateBody` is called only after `decodeRecordBody`, so `refKey === canonical(body.ref)` and `revision === body.revision` already hold.

## Confirmed correct

**Statement cache**
- Using the exact SQL text as the cache key is sound. Every input that changes the SQL is already in the text: matcher literals `:120-140`, the ordered plan `:658-692`, the count shape `:737-782`, `after`, the direction. All values stay bound. Two indexes with the same paths produce the same SQL, so sharing a statement between them is correct.
- Every store method uses its statements synchronously after `assertOpen`. There is no await inside, and `src` has no `.iterate(` or per-statement setter calls.
- The `close()` order (set closed, clear the map, then `db.close()`) plus `assertOpen` prevents use after finalization.
- Failures surface in the same places: the try in `lookupInside` (`:595-601`) and `countInside` (`:765-785`). `readManyInside`, `currentRevisionOf` and the search recheck have no try and still rethrow through rollback (`:299-306`, `:318-325`).
- Re-preparing after a schema change from another connection works on the write path, and `R3a :76-101` exercises it. `readMeta`/`writeMeta` (`sqlite-text-search.ts:164-165`) already reuse statements across the open-time DDL.
- The per-call prepare inventory in section 1 is complete against `sqlite-record-store.ts` and `sqlite-text-search.ts`.

**Literal LIMIT**
- It cannot be used for injection. The decoders check the limit (`lookup-index.ts:174-177`, `:265-268`), the decoded request is frozen (`:196`, `:302-311`), and decode and SQL build run with no await between them (`:621-624`, `:721-724`). `String()` of a safe integer is digits only.
- There is no OFFSET anywhere in `src`.
- Results cannot change with the plan, because `ref_key` is the primary key (`migrations.ts:19`) and both ORDER BYs are total.
- The quoted measurements match the raw files (`raw/sql-micro-2.json`, `raw/sql-micro-4.json`, `statTables: []`).

**Design S**
- `parseObject` (`note-record-codecs.ts:116-123`) rejects exactly what `decodeRecordBody` already rejects first (`record-codec.ts:218-228`, `:276-277`), so the validator never sees those inputs, before or after the change.
- `canonical(ref)` is already proven at `:294-297`, so the codec can skip its own check.
- Failure reasons stay the same: `corrupt` with "snapshot X is damaged: …", mapped to `unavailable` by `note-read-model.ts:88-100`.
- Keeping the write path on `validate` is required, because the parsed body is what gets written (`:487`, memory `:337`).

**Design R1**
- A memo keyed by `json` returns exactly what a fresh decode would, including when a write interleaves.
- Nothing in `notes/*.ts` or `note-views.ts` mutates decoded heads. The sorts run on copies. `note-service.ts:530-533` mutates its own aggregation object, not a head. The identity checks at `note-views.ts:514` and `:531` compare objects within one body, which a memo does not change.
- Not deep-freezing is correct, because results hold head sub-objects by reference (`note-read-model.ts:334-344`, `:350-362`).

**Round two**
- Making aggregateType a literal is necessary for the partial indexes. Item 6 is about the scope being wider than the design says, not about the direction.