# Task: note-search speed round 1 (decision 66) — redundant work, route two, scoped candidates; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec and the
lead's rulings below are binding; do not make design decisions. Where this book and the rulings do not determine
something, choose nothing: list it under UNSPECIFIED with the smallest options, and go on with the next item.

**This run is headless. When your turn ends, the whole run ends.** You may start subagents (at most 2 at a time). Stay
in your turn until every subagent has reported (wait with `sleep 300`, then `list_agents`), and only then reply. Keep
your own context small: `grep -n`, `sed -n a,bp`, never whole large files. **Finish within 180 minutes** (the run stops
at 190): do the groups in order and finish whole items; an unfinished item is reported, not half-done.

## 1. What this copy is

- `slice-setup` = the lead branch at `ad2679f3`: 2C, the resource-limit slice, 4A and 4B merged, user decisions 66–68
  recorded in `docs/refactor/HANDOFF.md`. `slice-base` adds `DSH-BASELINE.md` (tests that fail in this sandbox only).
- The code you change is 4B's note search: `src/core/record-store/` (the text port on both backends) and
  `src/core/work-graph/notes/note-read-model.ts`, `src/core/work-graph/views/note-views.ts`.
- Measured on 20,000 notes before this round (warm p50): a common term 1.35 s, the same term plus an anchor 15.2 s,
  paging the text port to the end 19 s, `lookup` on a busy anchor 394 ms, `stale` 195–322 ms; an in-process scan of all
  note texts takes 1.2–3.2 ms. Where the time goes: `./.dsh-ref/profiling-summary.md`.

## 2. Inputs (inside this copy)

- **Binding:** this book (section 4 wins over everything else); `docs/refactor/HANDOFF.md` decision 66; the spec
  `docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md` (L9–L12, L22, L23, §2, §10) where section 4 does
  not override it; the earlier 4B books `./.dsh-ref/s4b-impl.md` (§10 P1–P14), `s4b-impl-2.md` (§5 R1–R16),
  `s4b-impl-3.md`.
- **Background (the rulings below were made from these; where they disagree with section 4, section 4 wins):**
  `./.dsh-ref/design/*.draft.md` and `*.review.md` (code-grounded designs and adversarial reviews: text port, read
  model, RecordStore reads, spec sentences), `./.dsh-ref/profiling-summary.md`, `./.dsh-ref/search-research.out.md`.
- The TDD skill: `./.dsh-ref/tdd/`.

## 3. Frozen files and the allowed test changes

- Never change `DSH-BASELINE.md`, `docs/`, lock files, `vendor/`, `src/core/record-store/migrations.ts`.
- Production files you may change: `src/core/record-store/` (`lookup-ports.ts`, `lookup-index.ts`,
  `in-memory-record-store.ts`, `sqlite-record-store.ts`, `sqlite-text-search.ts` — replace or delete it, new
  `text-scan.ts`, `sqlite-text-scan.ts` and `sqlite-sql-literals.ts`), `src/core/work-graph/notes/note-read-model.ts`,
  `src/core/work-graph/views/note-views.ts`, `src/core/work-graph/model/note-contracts.ts`,
  `src/core/work-graph/persistence/note-record-codecs.ts` (only the exported text-paths constant, S2.4),
  `src/composition/create-platform.ts` (only what the removed `fullTextProbe` / port cap and the internal check port
  need). A file outside this list that you believe must change: stop that item and report it.
- **Existing tests stay unchanged, except exactly these (decision 66 removes what they test):**
  - `tests/record-store/S4B-text-search.test.ts`: delete the two FTS5 cases "write made while FTS5 was unavailable is
    rebuilt" (~:489-504) and "unavailable FTS5 probe answers unsupported" (~:538-546), and the small-cap cases that set
    the port's `textSearchCandidateMax` (~:754-800, both backends). Everything else in the file keeps its assertions;
    you may retitle "window candidates" to "substring rule" in test names only.
  - `tests/helpers/S4B-text-search-support.ts`: remove `fullTextProbe` and `textSearchCandidateMax`.
  - `tests/work-graph/S4B-memory-unsupported.test.ts`: delete the file (it needs a store without FTS5).
  - `tests/helpers/S4B-note-check-fixture.ts`: remove `fullTextUnavailable`.
  - Any other existing assertion that fails after a ruling below: do not edit it; report it under UNSPECIFIED (test id,
    assertion, the ruling, a minimal counter-example) and go on.
- Throw-away probes go under `./.dsh-scratch/` and are deleted at the end; never `/tmp`.

## 4. Lead rulings for this round (binding)

### S1. Text port, route two (both backends, one scan)

1. **Modules.**
   - A new pure module `src/core/record-store/text-scan.ts` holds the shared parts:
     - the row derivation `{ prefixKey, text }` from a record body: the prefix key with the lookup buckets' rule
       (`lookupIndexKeyOf`); the text with `searchTextFrom` over the registered paths;
     - the in-memory index;
     - the scan.
   - Both backends use it.
   - SQLite's table, meta, rebuild, legacy drop and catch-up go into a new `sqlite-text-scan.ts`; `sqlite-text-search.ts`
     is deleted. Remove `windows` from the decoded request and `windowsForTerms`. Keep `bigramWindows`: the
     similar-note Jaccard uses it (`note-views.ts`).
2. **The compact table (SQLite).**
   - One table per registered text index, named `next_text_<sanitized name>_<fnv suffix>`. Reuse today's
     sanitizing and hashing, but not the `next_fts_` prefix: an inert legacy FTS table may survive (S1.5) and must not
     block the new table.
     `(ref_key TEXT PRIMARY KEY, prefix_key TEXT, text TEXT NOT NULL, seq INTEGER NOT NULL)` with an index on `seq` and
     one on `(prefix_key, ref_key)`. `WITHOUT ROWID` is your choice.
   - Meta table `next_text_meta(name TEXT PRIMARY KEY, code TEXT NOT NULL, through INTEGER, generation TEXT NOT NULL)`.
   - **Store text losslessly.** `text` and `prefix_key` hold `JSON.stringify(value)`; read them back with `JSON.parse`.
     node:sqlite turns a lone surrogate into U+FFFD in plain TEXT, and that would break parity with the memory backend.
3. **Code.** The code is sha256 of: index name, aggregateType, prefix paths, text paths, `TEXT_SCAN_RULE_VERSION = 2`,
   `process.versions.unicode`, `process.versions.icu`.
4. **Write.**
   - Inside the existing write transaction, replace `indexRecord` with one primary-key upsert of
     `(ref_key, prefix_key, text, seq)`, where `seq` is the last event id of this commit.
   - Then advance `through` with `UPDATE … SET through = ? WHERE name = ? AND through IS ? AND code = ?`, using this
     process's own code.
   - When the stored code is not this process's code, skip the row upsert and do not advance `through`. That store then
     reads `index_not_ready` until a reopen rebuilds.
   - The in-memory cache is **not** touched at commit; it catches up at read time (S1.6).
5. **Open.**
   - **Rebuild.** For each registered text index: when the meta row is missing, the code differs, the table is missing,
     or `through` ≠ `MAX(events.id)` (null-safe), rebuild in one `BEGIN IMMEDIATE`:
     - drop and create the table;
     - derive the rows from every snapshot of that aggregateType, with `seq = R`, where `R = MAX(id)` is read inside the
       transaction;
     - upsert meta with a new random `generation`.
     - A non-object or non-text head still fails the open, as today.
   - **Legacy drop.** First read `sqlite_master`. Only if `next_fts_%` virtual tables or `next_fts_meta` exist, open one
     write transaction and drop them, each `DROP` in a try/catch: a missing fts5 module leaves inert tables, which is
     not an error.
   - No `VACUUM`.
   - Remove the FTS5 probe and the `fullTextProbe` option.
   - **Precondition** (state it in a code comment): no 4B-era process has the file open during this upgrade.
6. **Read-time consistency (SQLite), at the start of every `searchText`, inside its read transaction.**
   - Read `meta` and `MAX(events.id)`.
   - Meta missing, or its code ≠ own code → `unavailable` / `index_not_ready`.
   - `through` ≠ max → `unavailable` / `index_not_ready`.
   - Else, if the cache's generation ≠ meta's, or the cache is ahead (null-safe comparisons) → full reload into a
     **fresh** structure, swapped in only on success.
   - Else, if the cache's `through` is `null` (it was loaded from an empty ledger) → treat it as a full reload.
   - Else, if the cache is behind → read **all** changed rows `WHERE seq > cache.through`, whatever their prefix. For
     each one:
     - remove its refKey from the bucket it was cached in (keep `refKey → prefixKey` for this);
     - add it to its new prefix bucket if that bucket is loaded (a bucket that is not loaded yet reads the row when it
       loads);
     - set `cache.through` last.
     A note whose prefix changes must not stay findable under its old prefix. The memory backend does the same move in
     its commit.
7. **The in-memory index.**
   - Per text index, per prefix key, loaded lazily on the first search of that prefix:
     `SELECT ref_key, text FROM t WHERE prefix_key = ? ORDER BY ref_key`. BINARY order equals `compareRefKeys`.
   - Entries are kept in refKey byte order. New refKeys go to a pending list that is merged (sorted) before the next
     scan; replacing the text of an existing refKey keeps its place.
   - For ordering, use an allocation-free comparator that compares by code point. For well-formed strings this equals
     UTF-8 byte order; refKeys are canonical JSON and therefore well-formed. Fall back to Buffer comparison when
     `!isWellFormed()`.
   - `close()` clears the caches.
   - The memory backend maintains the same structure in its commit, next to its lookup buckets, with undo on a failed
     commit, so it never rebuilds windows per query.
8. **Scan.**
   - From the first entry with refKey > `after` (binary search; `after` need not exist), test each entry in order:
     - `'all'`: every term is a substring of the text;
     - `'any'`: at least one term is.
   - Collect up to `limit`, with one look-ahead hit.
   - Result: `next` = the last returned refKey when a look-ahead hit exists, otherwise `null` with `complete: true`.
   - Then read the matched records **once**: SQLite with `readManyInside` in the same read transaction, memory with
     `readManyKeys`. A missing or damaged match is `corrupt`, as today.
   - Catch SQL errors in the text path and return `corrupt`, as `lookupInside` does.
9. **Port changes.**
   - `TextSearchRequest` gains `match?: 'all' | 'any'`; absent means `'all'`. This amends P1's "不加字段": one scan per
     query (decision 66).
   - The port's per-call candidate cap goes: remove the backend option `textSearchCandidateMax` and the "examined
     candidates" rule. A scan's work per call is bounded by the project's heads.
   - Remove `TEXT_SEARCH_CANDIDATE_MAX` from `lookup-ports.ts` if nothing reaches it any more. The read model keeps its
     own `'any'` cap in `note-contracts.ts`.
   - `unsupported` stays only for an unregistered or non-text index. There is no "FTS5 unavailable" any more.
10. **One term rule for every path.**
    - Export from `lookup-index.ts` one per-term decode that is exactly today's port rule: normalize again, check 2–64
      code points, reject `\p{White_Space}`. Add one new rule: a term that is not well-formed UTF-16 is `invalid`.
    - It returns the port term or the port's reason.
    - `decodeTextSearchRequest` and the read model's scoped paths (S2.1) both use it, in term order.
    - Keep today's double normalization (the read model normalizes, then the port normalizes again). A later ruling may
      change it; do not "fix" it now.
11. **Observable changes this round accepts (decision 66).** Write each one into the code comment where it happens:
    - the last non-empty page of a text scan says `complete: true`; FTS window false positives used to cause one extra
      empty page;
    - "FTS5 unavailable → `unsupported`" no longer exists;
    - malformed-UTF-16 terms are `invalid`.

### S2. Read model and checks (`note-read-model.ts`, `note-views.ts`)

1. **Scoped candidates (decision 66: "带锚点或路径前缀时只在那些注记里找").**
   - When `find` has terms and an anchor or a `pathPrefix`, the candidates are the heads on that anchor, or under that
     prefix; there is no port call.
     - The anchor heads are those already loaded for the existence check: `heads.value` exactly as `headsByAnchorKey`
       returned it, filtered by the anchor key as today.
     - The prefix heads come from `headsOnPathPrefix`.
     - With both an anchor and a prefix, use the anchor set; `headInScope` applies the prefix.
   - Keep the in-scope heads that pass `headInScope` and match the terms on the head's comparison text:
     - `'all'`: every port term (S1.10) is a substring;
     - `'any'`: at least one is.
     - The comparison text is one shared function, `searchTextFrom(head, NOTE_TEXT_PATHS)`; export `NOTE_TEXT_PATHS`
       from `note-record-codecs.ts` and use it in the registration too.
   - Order them by refKey byte order, with the NoteHead refKey precomputed once per head.
   - **`'any'`:** take the first `cap` (cap+1 → `partial`) and rank exactly as today.
   - **`'all'`:** a page is the first `limit` after the cursor's refKey (`afterOf` unchanged); `next` is `null` when
     the list is exhausted.
     - This amends P1/R7's "one port call per `'all'` page" for the scoped case. The union over pages and its order are
       the same as 4B; page boundaries change.
     - **Do not bump `RULE_VERSION`:** an old cursor's refKey still resumes correctly.
   - **Order of checks:** keep today's order, `revision_conflict` from the cursor and ledger, then the anchor's
     existence (`anchor_not_found` with candidates). After that, validate all terms once with the shared per-term rule
     (S1.10), then read the text candidates or the prefix heads.
   - Accepted changes: on the scoped path, `index_not_ready` and text-port store failures can no longer surface. A
     damaged head under the prefix, or a failing `lookupOrdered`, now gives `unavailable`.
2. **Unscoped `'any'`.** One port stream with `match: 'any'`, limit 100, looping on `next` until it has cap+1 in-scope
   matches or the scan completes; keep the `next === after` guard. This removes the per-term streams and their merge.
   - Accepted change: the candidate set before ranking is the first `cap` in refKey **byte** order, as P1 states.
     Today's multi-stream merge compares in UTF-16 order, so for note ids that are not UUIDs (for example `a～`
     and `a\u{1F600}`) a partial set can differ. Production ids are UUIDs, so production results do not change.
   - Write this in the code comment.
3. **One head cache per call (b1).**
   - Add the head cache to the check's per-call caches (`CheckCaches`), created once per `checkNotes` call. `checkOne`
     uses it instead of `newHeadCache()`.
   - Seed it from the read model: every anchor set the read model has already read, **exactly as `headsByAnchorKey`
     returned it**, keyed `${ctx.projectId}\0${anchorKey}`. Never seed from a filtered set, and never seed the goal map
     from a 2-state read.
   - `similarNotes` does not use this cache.
4. **No double derivation (b2).** When the read model has a check (always, in production), `itemOfHead` does not compute
   `conflicting`/`overQuota`; the check's values are used. Keep today's computation only for the no-check
   construction.
5. **Heads go into the check; the check does not re-read them (b3).**
   - Add an internal `NoteHeadCheckPort extends NoteCheckPort` in `note-contracts.ts`, with
     `checkHeads(ctx, { items: { head; version; snapshot? }[]; anchorSets? })`. `createNoteCheck` returns it, and the
     read model's `deps.check` takes it.
   - The public `checkNotes` is unchanged. Implement it as: validate → read head and version with today's mapping → a
     shared `checkItems`. `checkHeads` calls `checkItems` directly. The six reads and the write-after check still go
     through one function (L22).
   - A supplied `snapshot` is ignored when `version === head.version` (`bodyOfHead` as today).
   - `platform.notes` exposes only `checkNotes`; supplied heads never come from outside.
   - The heads handed over must come from records read in the current call (the port reads matches with
     `readManyInside` in its read transaction, S1.8).
6. **Memoize per call.**
   - `conflictingOf` / `overQuotaOf` per `noteId@head.version`.
   - The basis catalog revision per catalog revision number (b8).
   - The Run task scope per Run ref (b9).
   - `planRevisionsOfGoal` per goal, and `basisPlanByNumber` per `(goal, n)`, kept as two separate caches (b10).
   - `stagedRepairTask` and `note` fact head reads per ref.
   - Fact-read caches keep successes only; a failed fact read is not cached.
   - Everything lives in the one per-call context; nothing survives the call (R2 unchanged).
7. **Decode once per call.**
   - A per-call memo `refKey → { schemaId, revision, json, decoded }`. A hit needs all four equal (string equality);
     failures are never stored.
   - Use it for single-head and single-version reads, the anchor-set loads, goal-set loads and review-status loads.
   - **Not** at the streaming decode sites (`allTermHeads`, `anyTermHeads`); they decode each record once anyway.
   - **Not** on write paths: give `readAllHeads` an optional `memo` parameter that `note-service.ts` and `scribe-scope.ts`
     never pass.
   - Do not freeze decoded objects.
8. **History: no quadratic confirmation reads.** `confirmedByUserOfVersion` must not re-read versions 1..v for every
   listed version.
   - Compute the first confirming version u\* once, lazily, at the first item that needs it, scanning versions in
     ascending order; then confirmed(v) = (v is the head version ? the head's value : u\* ≤ v).
   - Reads happen in the same order, so failures are unchanged.
9. **Not this round: lookup's and conflicts' check-then-drop (b11).** Leave them. They change `coverage` and the budget
   order; 4C rules them together with the default states of decision 67.

### S3. RecordStore read costs (`sqlite-record-store.ts`)

1. **Statement cache.**
   - One per backend, keyed by the exact SQL text, LRU with at most 1,024 entries.
   - Used only through `get` / `all` / `run`: never `.iterate()`, never per-statement setters.
   - `close()` sets `closed`, clears the map, then closes the db.
   - Fixed SQL becomes module constants.
   - Every per-call `db.prepare` in the store and in the new `sqlite-text-scan.ts` goes through it.
2. **Literal LIMIT.**
   - Replace every bound `LIMIT ?` (`lookupInside`, `lookupOrderedInside`, any surviving text SQL) by a validated digits
     literal, rounded up to the next power of two ≥ `limit + 1` (at most 9 variants per shape).
   - `hasNext` and the slice to `limit` stay exactly as today.
   - The helper re-checks a safe integer in range and throws otherwise.
   - Values in `WHERE` stay bound, except the aggregateType (S3.3).
3. **Literal aggregateType** (moved here from round 2 on 10-16).
   - Why: round 2 gives every lookup index a per-type `WHERE`. Once one such index exists, a query whose type is bound
     (`… aggregateType') = ?`) is re-planned on every execution; measured 15–20× slower on cached reads. On today's
     indexes a literal type is measured as fast as a bound one, so doing it now is free and makes any build after this
     round safe on a round-2 file.
   - `lookup-index.ts` `createRecordLookupRegistry`: next to the non-empty check, reject a lookup whose `aggregateType`
     does not match the exported `AGGREGATE_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/`. The message shows the value with
     `JSON.stringify`. Both backends share the registry, so both reject the same registrations. Do not add the check to
     `record-codec.ts`.
   - A new `src/core/record-store/sqlite-sql-literals.ts` holds `aggregateTypeTerm(type)`, which returns
     `json_extract(ref_key, '$.aggregateType') = '<type>'`, re-checks the pattern and throws otherwise. No escaping: the
     pattern allows no quote, NUL or non-ASCII character. S3.2's LIMIT helper goes in the same file.
   - Every query on `snapshots` that filters by type uses it: `lookupInside`, `lookupOrderedInside`, `countInside`
     (both forms) and the text-table rebuild in `sqlite-text-scan.ts`. Remove the matching bound parameter. Never put
     `?` on the right of `json_extract(<any alias>ref_key, '$.aggregateType') =`. Do not run `ANALYZE`.
   - Tests (`SP-`):
     - registration, both backends: register record schemas of the types `Wid'get`, `Wid\u0000get`, `1Widget`,
       `Wid-get`, `Wid get`, `Ẃidget` and `Widget_2`, then open a backend with a lookup of each type (one per open, as
       in `lookup.test.ts:137-151`). The first six reject, and the error message contains `JSON.stringify` of the type;
       `Widget_2` opens, and a commit plus a lookup work.
     - type isolation, both backends: schemas W and V with the same path names and values, plus one row in each that
       lacks a path. `lookup` (including a `null` value), `lookupOrdered` (asc and desc, with `bound` and `after`) and
       `countLookup` (plain, ordered, distinct) on W's lookups return only W's rows, and the reverse. This is a
       characterization test: it passes before the change; write it first and keep it green.
     - a new source-scanning test `tests/architecture/record-store-literal-type.test.ts`, in the style of
       `tests/architecture/state-writes.test.ts`: it fails if any `.ts` file under `src/core/record-store/` matches
       `/aggregateType'\s*\)\s*=\s*\?/`.
4. **Not this round:** one-parse-in-the-store (`validateBody`) and partial indexes. Do not change `record-codec.ts` or
   `ports.ts`.

## 5. Rules for every group

- **TDD:** one test first (it must fail for the right reason), then the smallest change, then the next. Follow
  `./.dsh-ref/tdd/`.
- **Through public interfaces only:**
  - NE2: the RecordStore `searchText`, `readMany`, `lookup`, `lookupOrdered` on **both** backends;
  - NE3: `platform.notes` reads on both backends, with the real workspace tools and files in a temporary workspace.
- **No reading the database or the record store to verify** (the user's standing rule). Setup may use the allowed
  storage-migration fixture to make a 4B-era file (FTS tables and `next_fts_meta`) for the upgrade case.
- Expected values are literal and hand-computed, never computed with the product's own functions. Each test name
  starts with its id (`SP-xx …`).
- No real model calls, no git writes, never ports 3080/3099/44797.
- **Tests to add** (ids are yours, prefix `SP-`; both backends unless noted):
  - **Text port:**
    - refKey byte order with supplementary-plane ids (`a~`, `a�`, `a\u{1F600}` → that order), also with limit-1
      paging;
    - resume from an `after` that is not a record; `after` past the end → `[]`, `complete: true`;
    - a cross-backend differential over a seeded set (CJK, ASCII, combining marks, non-ASCII ids, two projects), page by
      page, `'all'` and `'any'`;
    - search, write, search on one open store (in-process catch-up);
    - an empty store: search, then write a note, then search finds it;
    - a note whose prefix value changes from a loaded prefix A to prefix B: it is no longer found under A, and is
      found under B (both backends);
    - SQLite only: another connection with the same registration writes, and the first sees it;
    - SQLite only: a search loads the cache, a writer without the registration writes, then the search gives
      `index_not_ready`;
    - SQLite only: another connection rebuilds (changed registration) while the first has its cache loaded;
    - SQLite only: a 4B-era file (made with the storage-migration fixture) opens, the FTS tables are gone (observed
      through a public behaviour: results correct), and results are the same;
    - a lone-surrogate note text: both backends agree; a lone-surrogate term is `invalid`;
    - `'any'` port: union, byte order, a record matching two terms appears once, resume from `after`.
  - **Read model:**
    - one anchor with ~8 notes and an injected `anchorQuota` of 2 (same-topic pair, a contradicts pair, a superseded
      note, over-quota notes): per-item `conflicting` / `overQuota` through `lookup` and through one `checkNotes` call;
      the one-call result equals separate per-item calls (notes without files or facts);
    - `stale` by goal with a small `goalQuota`;
    - two module notes at different catalog revisions with the definition changed between: only the older one is
      `module_definition_changed`;
    - two agent notes from two Runs with different module scopes: only one `file_module_mismatch`;
    - stage notes on two goals, the stage removed in one: only that one is `stage_not_in_current_plan`;
    - T-07 on an anchor with off-anchor notes holding the same terms: the same scores and order;
    - anchor + common term with `textSearchCandidateMax: 2` (read-model cap): the first two of the anchor's ids,
      `partial`, the warning, then limit-1 paging;
    - `pathPrefix` + term over main and extra slots (siblings `src/a-b`, `src/ab` excluded);
    - anchor + prefix + term with an empty, complete result;
    - a U+0085 term and `"J̌"` give the same `invalid` reason with and without an anchor;
    - `"J̌x"` gives the same items with and without an anchor;
    - scoped `'all'`: full pages, the last page complete, the union over pages equals the in-scope matches in refKey
      order;
    - history at head version ≥ 5 with a confirmation at version 3: each listed version's `confirmedByUser` is correct.
  - **RecordStore:** on one open backend, `lookup` and `lookupOrdered` with limits 1, 2, 3, 4, 200, 1, with and without
    `after`, and with exactly `limit`, `limit + 1`, `2^k` and `2^k + 1` matching rows; the pages and `next` equal the
    in-memory backend's.
- **Production reach:** `tests/architecture/production-reach.test.ts` must pass. Removed exports leave no stragglers;
  `checkHeads` is reached from production through the read model.

## 6. Groups (order)

- **G1 RecordStore** (S1, S3): `text-scan.ts`, `sqlite-text-scan.ts`, the memory backend's index, the port's `match`,
  cap removal, term decode, legacy drop, statement cache, literal LIMIT, literal type; the NE2 tests and the allowed
  test removals.
- **G2 Read model** (S2): scoped candidates, `'any'` via the port, b1–b4 / b8–b10, the internal check port, the per-call
  memo, history; the NE3 tests.
- **G3 Clean-up:** stragglers (`grep -rn "fts\|FTS5\|fullTextProbe\|windowsForTerms\|textSearchCandidateMax" src tests`),
  comments for S1.11 and S2.1's accepted changes, and the checks in section 7.

A subagent may take G1's SQLite table and catch-up while you do the memory backend and the scan, if their files do not
overlap; G2 starts after G1's tests pass.

**Priority when time runs short** (finish whole items; what is left goes to the next round and is reported, not
half-done):
1. Must: S1 complete with its tests; S2.1, S2.2, S2.3, S2.4, S2.5; S3.1, S3.2.
2. Then: S3.3, S2.6.
3. Last: S2.7 (the decode memo) and S2.8 (history).

## 7. Checks (the machine is shared with another DSH run: keep it light)

- Run only the files you touch while working, with `--maxWorkers=2`.
- At the end, once: `tests/record-store/`, `tests/work-graph/S4B-*.test.ts`, `tests/work-graph/S4A-*.test.ts`,
  `tests/composition/platform.test.ts`, `tests/architecture/`, with `--maxWorkers=3`.
- Then `npm run typecheck`, `npm run check:architecture`, `npm run build`.
- **Do not run the full suite.** The lead runs it with bubblewrap.

## 8. Reply

Under 800 words:
- FILES CHANGED (production / tests);
- per ruling (S1.1 … S3.3), done or not, with the test ids, RED → GREEN;
- the allowed test removals you made;
- CHECKS with numbers;
- UNSPECIFIED (short, with options);
- anything that surprised you.

## 9. Answers to the read-through (lead, 2026-10-16 18:10; binding like section 4)

**Unclear items**
- **S1.2/S1.4 composite prefix:** (b) skip the row when `lookupIndexKeyOf` gives `null`, in both backends (the lookup
  buckets do the same; composite values are never candidates).
- **S1.3 code encoding:** (a) sha256 hex of `JSON.stringify({ name, aggregateType, prefixPaths, textPaths, ruleVersion: 2,
  unicode, icu })`, keys in exactly this order.
- **S1.4 meta row missing at write time:** (a) counts as not this backend's code: skip the upsert, do not advance
  `through`.
- **S1.6 cache ahead:** (a) reload iff `cache.through === null || cache.through > max || cache.generation !==
  meta.generation`; `through < max` is the normal catch-up.
- **S2.3 goal map seeding:** (a) seed a goal's set only from a read that returns that goal's heads in all four current
  states (`currentHeadsForGoal`); otherwise the goal map fills lazily through its own read. Never seed from a narrower
  status read.
- **S2.5 `anchorSets`:** (a) `Map<string, NoteHeadSnapshot[]>` keyed `${projectId}\0${anchorKey}` (the S2.3 key).
- **S2.8 u\* bound:** (a) bound the ascending scan by the largest version listed on the page (the list maximum), so the
  read set and failures stay as today.
- **S3.1 DDL and the cache:** (a) clear the backend's statement cache after any DDL it runs itself (open-time rebuild,
  legacy drop). DDL by other connections: SQLite re-prepares on its own.
- **S3.2 LIMIT helper:** (a) any safe integer >= 1; the literal is the next power of two >= `limit + 1`; throw otherwise.
- **S1.10 term decode:** export `decodeTextTerms(terms: readonly unknown[])` from `text-scan.ts`, returning
  `{ ok: true; terms: string[] } | { ok: false; reason: string }` with today's port reason text verbatim; S2.1 uses the same
  function, so the reason is the same with and without an anchor.
- **S2.7 memo:** thread the optional memo through `headsByAnchorKey`, `currentHeadsForGoal` and `headsOnReviewStatus`
  down to `readAllHeads`.

**Code differs from the book (your reading is right)**
- Add the exported `NOTE_TEXT_PATHS` constant in `note-record-codecs.ts` from the inline registration at `:666-667` and
  use it in the registration and in S2.1 (the section 3 label S2.4 is a slip).
- `create-platform.ts`: the change is the internal `NoteHeadCheckPort` wiring (`:1303`); keep `noteLimits.textSearchCandidateMax`
  (the read model's own cap, P14).
- The one-per-open pattern is the `open` helper at `lookup.test.ts:43-53` used once per registration.
- S2.7: `anyTermHeads` goes away with S2.2; ignore that site.
- `TEXT_SEARCH_RULE_VERSION` goes; the new `TEXT_SCAN_RULE_VERSION = 2` lives in `sqlite-text-scan.ts`.

**Tests to watch:** your four are right. In particular the unscoped `'all'` path keeps its one-port-call paging
(`S4B-memory-ranking.test.ts:185-203`), and term validation stays after the anchor existence check.

**Plan and time:** your cut is accepted. The limit is raised to 180 minutes (stop at 190). Priority stays as section 6
(S3.3 and S2.6 next after the must items; S2.7, S2.8 last). Whatever is left is reported and goes to the next round.

