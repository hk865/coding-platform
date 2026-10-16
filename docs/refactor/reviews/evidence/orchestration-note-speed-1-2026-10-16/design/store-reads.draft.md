## RecordStore read costs: statement cache, literal LIMIT, parse once (for the 4C-prep construction book)

Basis: HEAD ad2679f3 (the code is the 4B merge 0776b9b6). I only read files, ran nothing and changed nothing. "Profile" means `D:/cc-lead-notes/impl/s4b/prof/summary.md` plus its `raw/sql-micro-*.json`. Every number in section 5 is an estimate unless it is quoted from the profile.

---

### 1. Statements prepared on every call, and a cache design

**Every per-call `db.prepare`.** Line numbers are `src/core/record-store/sqlite-record-store.ts` unless another file is named.

| Site | SQL | How often |
|---|---|---|
| :202-206 `readIdempotency` | SELECT … FROM idempotency WHERE identity_key = ? | each commit and each `lookupCommit` |
| :234 `appendEvents` | INSERT INTO events | once per commit, reused inside the loop |
| :246-248 `upsertSnapshot` | INSERT … ON CONFLICT snapshots | each record written |
| :252-260 `persistIdempotency` | INSERT idempotency | each commit |
| :265-267 `readClaimOwner` | SELECT owner_key | each claim |
| :278 and :281-283 `applyClaim` | DELETE or UPSERT identity_claims | each claim |
| :333 `readThrough` | SELECT MAX(id) FROM events | each `readManyInside`, each `countInside`, and 1-2 times per commit (:457, :475) |
| :347 `currentRevisionOf` | SELECT snapshot_json WHERE ref_key = ? | each guard |
| :387 `readManyInside` | SELECT snapshot_json WHERE ref_key = ? | each key read; 10,052 times in "lookup project" |
| :563 `eventAt` | SELECT event_json WHERE id = ? | each call |
| :596-598 `lookupInside` | dynamic keyset SQL with `LIMIT ?` | each lookup page |
| :696-698 `lookupOrderedInside` | dynamic ordered SQL with `LIMIT ?` | each ordered page |
| :767-769 and :778-780 `countInside` | dynamic COUNT | each count |
| :831 `searchText` recheck | SELECT snapshot_json WHERE ref_key = ? | each FTS candidate examined |
| `sqlite-text-search.ts:257-258` `indexRecord` | DELETE and INSERT on the FTS table | each NoteHead write (2 prepares) |
| `sqlite-text-search.ts:272-274` `advanceThrough` | UPDATE next_fts_meta | each commit |
| `sqlite-text-search.ts:279` and `:171` `isCurrent`, `readMaxEventId` | 2 SELECTs | each `searchText` call |
| `sqlite-text-search.ts:313-320` `candidates` | FTS MATCH join with `LIMIT ?` | each port page |

Prepared only at open, so no change needed: `sqlite-text-search.ts:56, 67, 70, 73, 160, 200-207`, and `migrations.ts:109`. `sqlite-text-search.ts:164-165` (`readMeta`, `writeMeta`) and `sqlite-body-store.ts:28-29` already prepare once; that is the pattern to follow.

Transaction control is `db.exec` text on every call: BEGIN, COMMIT and ROLLBACK at :294, :297, :301, :313, :316, :321. The cost is negligible (`select1` costs 0.4-0.8 µs in `sql-micro-2.json`).

**What it costs today** (profile §2): a fresh `prepare` costs about 155 µs because `snapshots` has 71 indexes for the planner to consider. Fresh prepare plus `all` is 319 µs; a reused statement with `LIMIT ?` is still 153 µs (`raw/sql-micro-2.json`). Native `prepare` alone is 21-31% of self time in every case that is not FTS-heavy.

**Cache design.** One cache per backend, so per connection, kept in the `createSqliteRecordBackend` closure.

```ts
const STATEMENT_CACHE_MAX = 256;                 // LRU bound; literal LIMITs add shape variants
const statements = new Map<string, StatementSync>();
const statement = (sql: string): StatementSync => {
  const hit = statements.get(sql);
  if (hit !== undefined) { statements.delete(sql); statements.set(sql, hit); return hit; }
  const prepared = db.prepare(sql);              // a throw caches nothing
  statements.set(sql, prepared);
  if (statements.size > STATEMENT_CACHE_MAX) statements.delete(statements.keys().next().value!);
  return prepared;
};
```

- **Key: the exact SQL text.** It is correct by construction. Every input that changes the SQL already changes its text: the index paths, the matcher kind (null, the boolean literal `= 1`/`= 0`, number, text; :120-140), whether `after` is present, the direction, the ordered value type, and the literal LIMIT from section 2. Fixed SQL should be module constants so the key is the same string every time.
- **Bound on size.** The number of shapes is finite (registry × matcher kinds × `after` × limit 1..200). Some callers pass computed limits (`limit - items.length`, `Math.max(1, …)`), so the LRU cap is needed.
- **Lifetime.** From open until `close()`. `close()` (:878-886) must set `closed`, then `statements.clear()`, then `db.close()`. Node finalizes the statements when the database closes, and `assertOpen()` already runs before every port method, so a finalized statement is never reached.
- **Schema change by another connection.** node:sqlite prepares with prepare_v2 semantics, so SQLite re-prepares a statement automatically on SQLITE_SCHEMA. Existing tests already create and drop a trigger from a second connection while the backend is open (`tests/record-store/R3a-transaction-boundaries.test.ts:76-101`).
- **Schema change at open.** All open-time DDL runs before any statement is cached: lookup indexes (:96-117, :178), the FTS rebuild, and the round-two partial indexes from decision 66. If a re-prepare fails, it throws from `get`/`all`/`run` instead of from `prepare`.
  - In `lookupInside` both calls sit inside the same try (:595-601), so the result is still `corrupt`.
  - In `readManyInside` neither is in a try today, so the error still propagates through `withReadTransaction`'s rollback and rethrow (:318-325).
  - The failure behaviour is therefore unchanged.
- **Transactions.** Node resets a statement at the end of every `get`/`all`/`run`, so no cached statement is still active when the store calls COMMIT or ROLLBACK, inside either `withReadTransaction` or `withWriteTransaction`. A statement that throws (for example on a trigger RAISE) is also reset and can be reused.
  - The rule for the construction book: cached statements are used only through `get`/`all`/`run`. Never `.iterate()` (no current use), and never the per-statement setters (`setReadBigInts`, `setAllowBareNamedParameters`, …), because the statement is shared.
- **Synchronous use.** Every store method uses its statements synchronously between awaits, so two users can never interleave on one statement.
- **Text search.** Pass `statement` into `createSqliteTextSearch`, or into the decision-66 compact-table module that replaces it, instead of `db`.
- **Not relied on.** Newer Node 24.x may have a built-in tag-store or statement cache. Not relied on: `package.json` engines allow `>=24.15.0 <25`, and no new dependency.

---

### 2. Bound LIMIT and OFFSET → validated integer literal

There is no OFFSET anywhere in `src`. The bound LIMITs:

- `sqlite-record-store.ts:593` + :597 (`lookupInside`, value `request.limit + 1`)
- `sqlite-record-store.ts:693` + :697 (`lookupOrderedInside`, value `request.limit + 1`)
- `sqlite-text-search.ts:312` + :318 (FTS `candidates`, value `max(0, textSearchCandidateMax) + 1`). Decision 66 removes this path; the rule applies only if any of it survives.

**Change:**

```ts
function limitLiteral(limit: number, max: number): string {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > max)
    throw new Error(`SqliteRecordStore: page limit ${String(limit)} is not an integer 1..${String(max)}`);
  return String(limit + 1);
}
// … ORDER BY ref_key COLLATE BINARY ASC LIMIT ${limitLiteral(request.limit, 200)}
```

Then drop the `params.push(request.limit + 1)` lines at :593 and :693.

**Why this cannot be used for injection:**

1. **The value is checked before any SQL is built.** It comes only from the store's own request decoders:
   - `decodeLookupRequest` checks `typeof === 'number'`, `Number.isInteger` and 1..200 (`lookup-index.ts:174-177`).
   - `decodeOrderedLookupRequest` does the same (`lookup-index.ts:265-268`).
   - `typeof === 'number'` rejects strings and boxed `Number` objects, so no `toString`/`valueOf` trick gets through.
2. **The value cannot change after it is checked.** The decoded request is frozen (`lookup-index.ts:196`, `:302-311`), the limit is a primitive copy, and there is no await between decode and SQL build: `sqlite-record-store.ts:621-624` and `:721-724` decode and then enter `withReadTransaction` synchronously.
3. **The literal is plain digits.** `String(n)` for a safe integer never produces a sign, a decimal point or an exponent (exponent form starts at 1e21), so the literal matches `/^[0-9]+$/`. `limitLiteral` re-checks this in the builder itself, so a future caller that bypasses the decoder throws instead of reaching SQL.
4. **Nothing else from the request becomes SQL text.**
   - Paths come from the validated registry (`SAFE_SEGMENT` in `lookup-index.ts:53`, `validatePath` in `:55-63`) and are quoted (`sqlite-record-store.ts:86-88`).
   - Values stay bound.
   - Matcher fragments are fixed strings (:120-140).
5. **The FTS bound is checked at the factory.** `textSearchCandidateMax` must be a safe positive integer (`sqlite-record-store.ts:160-163`), so its digits-only argument is the same.

**Why it matters.** Measured on the profile's side connection: bound `LIMIT ?` costs 154.3 µs on an empty result, 165.7 µs with 6 rows and 228.1 µs with 201 rows. The literal `LIMIT 201` costs 3.2, 6.4 and 65.3 µs. `sqlite_stat*` tables are absent (`raw/sql-micro-4.json`), and the plan is the same covering-index SEARCH in both cases (`raw/sql-micro-3.json`).

**Mechanism (inferred, not read in the SQLite source).** The figures fit SQLite marking a parameter whose bound value the planner used ("expmask"). Then every bind, even with the same value, expires the statement and forces a re-prepare. SQLite 3.53.1 evidently does this for LIMIT. Keep `sql-micro-4` as the acceptance check on the final code. Do not run `ANALYZE` or `PRAGMA optimize` without re-measuring: with STAT4 data, bound WHERE parameters on indexed expressions can trigger the same re-prepare.

**Interaction with round two (partial indexes, decision 66).** For the planner to use a partial index `WHERE json_extract(ref_key,'$.aggregateType') = 'NoteHead'`, the query must contain the same term.
- Today aggregateType is bound (`?` at :582-583, :639-640, :735-736). A bound value matched against a partial-index WHERE also falls into the expmask re-prepare (inferred, same caveat as above).
- So round two should make aggregateType a SQL string literal. It is registry data (`record-codec.ts:159`), not request data, and must be quoted with `''` escaping.
- The statement cache makes this free.

**Cardinality.** Literal limits multiply the number of SQL shapes by the number of distinct limits callers use, which is why the LRU cap in section 1 is needed. If that ever matters, an alternative is to round the literal up to a power of two (2..256) and slice in JS. The results are identical because `hasNext = rows.length > limit` and the slice to `limit` are unchanged. The cost is up to 2× extra rows read for small limits.

---

### 3. One snapshot from SQL row to the reader's decoded object

**Path A: `readMany` and `lookup` on SQLite**, for one NoteHead.

| # | Step | file:line | Full JSON.parse | Small parse | canonicalJson | Shape check |
|---|---|---|---|---|---|---|
| 1 | `decodeRefKey(refKey)` | sqlite-record-store.ts:379 → record-codec.ts:237-250 (parse :238, canonical :244) | – | 1 (refKey) | 1 | aggregateType |
| 2 | PK SELECT, fresh prepare | :387 | – | – | – | – |
| 3 | `decodeRecordBody` | :397 → record-codec.ts:269-308 (parse :276, canonical(ref) :294) | 1 | – | 1 | revision and ref only |
| 4 | `applyRecordSchema` → `validate` → `decodeNoteHeadSnapshot` | :404 → record-codec.ts:369-397 (frozen shallow copy :379) → note-record-codecs.ts:673-675 → :451-461 (parse :453/:118, canonical :455, `noteHeadBodyProblem` :336-381 + `bodyProblem` :280-313) | 1 | – | 1 | full |
| 5 | Validator throws its decoded body away (returns `record`, :675); 4-field compare | record-codec.ts:390-395 | – | – | – | – |
| 6 | `readThrough`, fresh prepare | :410 → :333 | – | – | – | – |
| 7 | Reader decode | note-read-model.ts:127 (also :146, :520, :839, :894; note-views.ts:198, :837) → note-record-codecs.ts:451-461 | 1 | – | 1 | full |

One store read plus one reader decode therefore costs 3 full parses, 1 small parse, 4 canonical encodes, 2 full shape checks and 2 prepares, plus the keyset prepare and re-plan once per page. A lookup page with `after` decodes the refKey once more (`lookup-index.ts:180-185`).

**Path B: `searchText` on SQLite.** Before step 1, each candidate gets another PK SELECT with a fresh prepare (:831), another full parse (:838), and `searchTextFrom` normalization (NFC and lowercase over topic, conclusion and body) (:842). Matches then go through `readManyInside` again (:846), which reads the same row a second time. Each matched head costs 4 full parses and 2 PK prepares. Route two (decision 66) removes the recheck SELECT and parse.

**Path C: in-memory backend.**
- `readManyKeys` (in-memory-record-store.ts:220-254) runs `JSON.stringify(snapshot)` (:237), then `decodeRecordBody` (:241, parse #1), then `applyRecordSchema` (:243, the validator's parse #2), then the reader's decode (#3).
- `searchText` (:588-636) builds `searchTextFrom` plus `bigramWindows` plus a new `Set` for every bucket member after `after`, on every call (:608). It then runs `searchTextFrom` again for each candidate examined (:621).
- The guard path does the same double parse: `decodeGuardedRevision` (guarded-revision.ts:19-22), called from both `currentRevisionOf` (sqlite :346-359, memory :190-206).

The multiplier across one call is the profile's 6.7× (分支) to 66× (lookup project) parses per distinct snapshot. Most of it comes from repeated loads, which is redundancy item (b)1. This section removes the per-read part.

**Design S: one parse inside the store (both backends, one helper, no change to the port's shape).**

- `EncodedRecordSchema` (ports.ts:154-160) gets an optional `validateBody?(record: EncodedRecord, body: Readonly<Record<string, unknown>>): DecodeResult<EncodedRecord>`.
  - The registry checks that it is a function when present and copies it into the frozen schema (record-codec.ts:155-169).
- Add `decodeStoredRecord(schema, refKey, json)` to record-codec.ts:
  - it runs `decodeRecordBody` (the only full parse);
  - then the `applyRecordSchema` logic with the identical wrapper reasons ("record schema X rejected the record: …", "attempted to change …"), calling `validateBody(frozenRecord, decoded.parsed)` when registered and `validate(frozenRecord)` otherwise.
- It is used by `readManyInside` (sqlite :397-407), `readManyKeys` (memory :241-247) and `decodeGuardedRevision` (guarded-revision.ts:19-22).
- Do not use it in `planPreparedCommit` or `bindPreparedRecords` (record-codec.ts:560-641, :730-739).
  - On the write path the parsed body is what gets written (`JSON.stringify(record.parsed)` at sqlite :487 and memory :337) and what the indexes are built from (memory :341, FTS :488).
  - Handing it to a callback there would break the isolation guarantee at record-codec.ts:365-367.
  - On the read paths the store discards the body after validation and returns only the string-JSON `EncodedRecord`, so a callback cannot affect what a reader gets.
- Note codecs: split `decodeNoteHeadSnapshot`, `decodeNoteVersionSnapshot` and `decodeCurrentPointerSnapshot` (note-record-codecs.ts:451-507) into `parseObject` plus `decodeXBody(record, body)`, and register `validateBody = decodeXBody` (:670-687).
  - `decodeXBody` can skip the canonical(ref) check (:455-456, :478-479, :501-502), because `decodeRecordBody` has already proved it (record-codec.ts:294-297).
  - Other schemas can opt in later; nothing else changes for them.

**Failures stay the same, including the reason text.**
- Inputs that `parseObject` rejects (note-record-codecs.ts:116-123: not parseable, or not an object) are exactly the inputs `decodeRecordBody` already rejects first (record-codec.ts:218-228, :276-277). Today the validator never sees them, and after the change it still never does.
- For every other input, the validator sees the result of `JSON.parse` on the same string, so it runs the same checks in the same order and returns the same reason.
- The store still returns `corrupt` with `snapshot X is damaged: …` (sqlite :403, :406; memory :242, :245).
- Note reads still map that to `unavailable` with the reason passed through (`mapStoreFailure` at note-read-model.ts:87-94, `asOutcome` at :97-100).

**Design R1 (recommended): a per-call decode memo in the reader, with no store or port change.**

- `Map<refKey, { schemaId, revision, json, head }>`. A record hits only when all four of `refKey`, `schemaId`, `revision` and `json` are identical (string equality), and the hit returns the earlier decode's object.
  - The decode is a pure function of those four fields, so a hit returns exactly what a fresh decode would compute.
  - A write that interleaves between two store reads of the same call yields different JSON, so it misses. Behaviour under interleaving is therefore unchanged.
  - Failures are never stored, so a damaged head still gives `unavailable` / 'damaged note head' as today.
- Put it in the same per-call context object that the (b)1 fix introduces (the shared HeadCache, note-read-model.ts:217-243, plus the check's `CheckCaches`, note-views.ts:140-145, created at :1003).
- Use it at note-read-model.ts:127, :146, :520, :839, :894 and note-views.ts:198, :837. Not on the write paths (note-service.ts:167, scribe-scope.ts:314).
- Lifetime: one public call. It is never put on the `platform.notes` holder and never outlives the call. Cursors, `recordCursor` and `revision_conflict` are untouched, because every call still reads the store.

**Mutation.** Nothing decoded is shared across calls:
- the SQLite store returns fresh string-JSON records;
- the in-memory store re-serializes its stored objects (memory :237) and never hands them out.

Within a call, R1 shares head objects exactly as HeadCache already does. I found no in-place writes to head fields in `notes/*.ts` or `views/note-views.ts`. The only sorts are on spread or filtered copies: note-read-model.ts:755, :1019, :1092, :1149, :1308, :1367, :1417, :1536 and note-service.ts:540.

I do not recommend deep-freezing the memo values: `itemOfHead` and `itemOfVersion` put `anchor`, `extraAnchors`, `source` and `sections` into results by reference (note-read-model.ts:327-366), so returned results would contain frozen objects, which is a behaviour change.

**The result, and the "parsed once" wording in decision 66.** S plus R1 plus (b)1 gives one parse per store read and one per distinct record in the reader: about 2 full parses per note per call. To get exactly 1, the parsed body has to reach the reader. That needs one of:
- **R3:** have the store pass `validateBody` the same frozen object it returns, and have the note codec keep a WeakMap from that object to the deep-frozen body. This makes every returned `EncodedRecord` frozen, couples the codec to the store's object identity, and puts frozen objects into results.
- **R4:** an additive port field carrying the parsed bodies. This is a contract change that I am flagging.

My estimate is that the difference after (b)1 is about 1-3 ms per call (section 5). I recommend R1 and stating plainly that "parsed once" means once in the store and once in the reader.

**Optional extras (small gains).**
- Remember the valid results of `decodeRefKey` (refKey → aggregateType) per backend in a bounded map. It is a pure function of the string, so exact across calls. About 1-2 µs per read.
- In-memory: keep the JSON text next to the stored object at write time, which avoids `JSON.stringify` on every read (memory :237).
- `lookupInside` could select `snapshot_json` in the keyset query itself and drop the per-row PK SELECT. The results are the same, but the plan stops being index-only (EXPLAIN must be checked), and "lookup candidate has no snapshot" (:607) becomes unreachable. About 3 µs per row.

---

### 4. Tests

**What exists:**
- `tests/record-store/lookup.test.ts`: both backends, limit validation for 0 and 201 (:158-161), a damaged Widget row → `corrupt` after reopen (:174-202).
- `S2A-ordered-lookup.test.ts`: limit-1 paging in both directions (:207-212), invalid limits 0, 201 and 1.5 (:301-303), reopen (QA-03 :362).
- `S2C-count-lookup.test.ts`.
- `S4B-text-search.test.ts`: T-05 backend agreement and cap 1000 (:380, :703-750), T-06 rebuild and unsupported (:441-551).
- `R3a-transaction-boundaries.test.ts`: a second connection runs CREATE/DROP TRIGGER while the backend is open (:76-101), which covers cached write statements re-preparing after a schema change; a second connection tampers a guarded Workspace row → `unavailable` (:103-133), which covers the `decodeGuardedRevision` chain.
- `transaction-extensions.test.ts`, `WP2-notice-cursors.test.ts`.
- Note level: `tests/work-graph/S4B-memory-*.test.ts`, `S4B-note-read-failures.test.ts`, and `S4A-note-failures.test.ts:108-120`. The failure tests inject at the port through `tests/helpers/S4A-note-fault-fixture.ts`, which bypasses the codec chain.

**Gap:** no test damages a NoteHead, NoteVersion or CurrentPointer row with real bytes. That is exactly the chain S changes.

**New tests.** Characterization tests come first and must pass on today's code. Setup may tamper through a second connection, as lookup.test.ts:194-198 does; verification goes only through public interfaces.

1. **Damaged NoteHead row, record-store level (SQLite).**
   - Make the stored body parseable but shape-invalid (bad `state`, an extra key, `revision` ≠ `version`).
   - Check `readMany`, `lookup` (anchor index), `lookupOrdered` (path index) and `searchText` → `corrupt` with the exact reason pinned.
   - Not-parseable bodies are only possible with `lookups: []`: an UPDATE writing malformed JSON fails while any `json_extract` expression index exists, and today all 71 indexes cover all rows.
2. **The same damage through the note reads:** `notes.lookup`, `find` (all and any), `stale`, `history`, `readNote` → `unavailable`, reason pinned.
3. **`validateBody` registration (new code, written test-first).**
   - A non-function → `RecordSchemaRegistrationError`.
   - A rejecting `validateBody` → `readMany` returns `corrupt` with the wrapper reason.
   - Commit still uses `validate`: a schema whose `validate` rejects and whose `validateBody` accepts → commit returns `invalid`.
4. **Codec equivalence.** For the S4A/S4B note fixtures and their invalid variants, `decodeXBody(record, JSON.parse(record.json))` and `decodeXSnapshot(record)` agree on status and reason.
5. **Read-path statement re-prepare (SQLite).** Look up once (the statement is cached), then from a second connection DROP that lookup's expression index or CREATE an unrelated index or trigger, then look up again → the identical page. After `close()`, every port method throws "backend is closed".
6. **Shape and limit alternation (both backends).** On one open backend, run `lookup` and `lookupOrdered` with limits 1, 2, 200, 1, with and without `after`, and with exactly `limit` and `limit + 1` matching rows. The pages and `next` must equal the in-memory backend's. This catches a cache key coarser than the SQL text.
7. **A write between two store reads of one memory read** (`tests/helpers/S4A-note-interleave-fixture.ts`). The result must equal today's (characterize first). This guards R1's JSON-keyed memo.
8. **Performance (outside the suite).** Re-run `sql-micro-4` and the prof matrix on the final code. Target: an empty or small anchor lookup ≤ ~10 µs per execution, and EXPLAIN QUERY PLAN still the covering-index SEARCH for each shape.

---

### 5. Expected savings (ESTIMATES)

Inputs:
- About 0.29-0.36 ms per index lookup today, falling to 3-65 µs with the cache and the literal (sql-micro-2 and -4).
- One full parse ≈ 3.2 µs (24.7% of 394 ms ÷ 30,156 parses).
- One canonical encode ≈ 0.7 µs (7% of 394 ms ÷ about 40k encodes).
- Shape check ≈ 1-2 µs (assumed).

| Case (warm p50 today) | Statement cache + literal LIMIT, today's call pattern | S + R1, today's pattern | After (b)1–(b)11 + route two (marginal) |
|---|---|---|---|
| lookup project (394 ms) | 154 lookups × 0.29 ≈ 45 ms, plus `readManyInside` prepares ≈ 54 ms (13.8%) → about −100 ms | S: 10,052 × 3.9 µs ≈ 39 ms; R1: 9,596 duplicate decodes × 5.5 µs ≈ 53 ms → about −90 ms | about 45 → 35 ms (≈ 10 lookups, 476 reads) |
| stale goal (195 ms) | 264 × 0.33 ≈ 87 ms; profile: prepare + all = 48.9% of self time → about −85 ms | a few ms | about −15 to −20 ms of what remains |
| 分支 any (148 ms) | 167 × 0.29 ≈ −48 ms | S: 1,680 × 3.9 µs ≈ 6.6 ms; R1: (1,341 − 639) × 5.5 µs ≈ 3.9 ms → about −10 ms | about −5 to −8 ms |
| 边界 any (1,350 ms) | 232 × 0.29 ≈ −67 ms (the FTS SQL, 1,106 ms, is route two's job) | small | small |
| 边界 + anchor (15.2 s) | route two plus anchor-first candidates dominate | 97,880 parses ≈ 313 ms, mostly gone with route two | – |

The columns are not additive: most of today's absolute saving overlaps with (b)1, which removes the repeated loads. After (b)1 and route two, these RecordStore items are worth roughly a further 10-25% of the remaining per-call time. The profile's own Q4 figure is ~0.3 → ~0.01 ms per lookup.

---

### 6. Risks

- **Statement cache.**
  - `.iterate()` or a per-statement setter on a shared statement would leak state. Expose only `get`/`all`/`run` through the helper.
  - Literal limits grow the cache without the LRU cap.
  - Use after close is prevented by `assertOpen` plus clearing the map.
  - Re-prepare after a schema change is transparent, and its failure surfaces in the same try/throw place (shown in section 1).
- **Literal LIMIT.**
  - The re-plan mechanism is inferred, so `sql-micro-4` on the final code is the proof.
  - A known LIMIT could let SQLite pick another plan. Rows and order cannot change (`ORDER BY ref_key` is total because ref_key is the primary key), only speed; check EXPLAIN.
  - ANALYZE or STAT4 could bring back re-prepares on bound WHERE parameters.
  - Round two must use a literal aggregateType (section 2).
- **S.**
  - A `validateBody` that is not equivalent to `validate` would make reads and writes disagree. New test 4 guards this.
  - Keep the write path on `validate` to preserve the isolation guarantee.
- **R1.**
  - Within-call sharing of heads is the same exposure as HeadCache today.
  - The memo must never become a cross-call cache unless it is keyed by the ledger cursor (that is (c), outside this scope).
  - Memory: the decoded heads a call already holds (up to the 1,000 cap plus anchor sets), no extra.
- **R3 and R4 (if chosen).** Frozen records and results; codec-to-store identity coupling; or an additive port contract change.
- **Not measured.**
  - The in-memory `lookupOrdered` scans and sorts the whole project bucket on every page (memory :505-520). For a path-prefix read over 20k heads that is 5 indexes × 20k candidates per page; it is in no profile.
  - In-memory `searchText` rebuilds the bigram set for every candidate on every call (:608); route two replaces it.
  - Write cost after these changes: the cache also removes per-commit prepares (:246, :252, :333, `sqlite-text-search.ts:257-258`, :272), so writes should get cheaper, not slower; re-measure `S2A-notices-overbound` to confirm.