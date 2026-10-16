# Text port, route two (decision 66): current contract, FTS5 inventory, design, tests, open questions

Read-only analysis of HEAD ad2679f3, where the code equals the merged 4B commit 0776b9b6. No files were changed and no tests were run. Measured numbers come from the profiling summary and the grep-compare outputs in `D:/cc-lead-notes/impl/s4b/` (`grep-compare.out.json`, `grep-compare-check-scan.out`); numbers labelled ESTIMATE are not measured.

---

## 1. Current port contract

### 1.1 Types, constants, registration

- **Port type.** `RecordTextSearchPort.searchText(TextSearchRequest) → Promise<StoreResult<TextSearchPage>>` (`lookup-ports.ts:123-125`).
  - Request: `{index, values: string[], terms: string[], limit, after?}` (`:108-114`).
  - Page: `{records: EncodedRecord[], next: string|null, complete: boolean, readThrough: CommitCursor|null}` (`:116-121`).
- **Constants** (`lookup-ports.ts:96-100`): `TEXT_SEARCH_PAGE_MAX=100`, `TEXT_SEARCH_CANDIDATE_MAX=1000`, `MAX_TERMS=8`, `TERM_MIN=2`, `TERM_MAX=64`.
  - The read model keeps its own copies at `note-contracts.ts:42-43`.
- **Registration.**
  - `RecordLookupIndex.text?: {paths}` (`lookup-ports.ts:19`), validated at `lookup-index.ts:106-116`.
  - Production has exactly one text index: `s4-note-text` on `NoteHead`, prefix `['ref.projectId']`, text `['topic','conclusion','body']` (`note-record-codecs.ts:43, 665-667`).
- **Request rule (shared, `decodeTextSearchRequest`, `lookup-index.ts:697-781`).** Each of these is `invalid`:
  - not an object;
  - index not a non-empty string;
  - `values` not an array, wrong count (`index.paths.length`), or not all non-empty strings;
  - `terms` not an array, or not 1..8 terms;
  - a term that is not a string, is not 2..64 code points after `normalizeSearchText`, or contains whitespace;
  - `limit` not an integer 1..100;
  - `after` not a string, not a canonical refKey, or from another aggregateType.
  - An unregistered index or a non-text index is `unsupported` (`:702-705`).
  - The decode also computes `windows` (`windowsForTerms`, `:659-665, 776`); only the FTS path needs them.
- **Comparison text and matching.**
  - `searchTextFrom` (`:649-656`): the text paths joined with `\n`, then `normalizeSearchText` (NFC + ASCII lowercase, `:623-625`).
  - The match is `textSearchMatches` = every term `includes` (`:671-673`).
  - Order is `compareRefKeys` (UTF-8 bytes = SQLite BINARY, `:562-564`).

### 1.2 Results and statuses

| Status | SQLite | Memory |
|---|---|---|
| `unsupported` "SQLite FTS5 is not available" | `sqlite-record-store.ts:803-805`. Checked **before** decode, so an invalid request on an FTS5-less store also gets `unsupported`. | – |
| `unsupported` (unregistered or non-text index) | `:807` | `:591`; the defensive branch `:595` is unreachable |
| `invalid` (decode) | `:808` | `:592` |
| `unavailable` / `index_not_ready` | `:815-817` (`isCurrent` false) | – |
| `corrupt` | Candidate has no snapshot `:834`; not text `:835`; JSON parse `:840`; any `readManyInside` failure (invalid, unsupported, damaged, schema) → corrupt `:846-847`; missing `:848-850` | No snapshot `:607, :620`; `readManyKeys` failure `:627-628`; missing `:629-631` |
| Thrown (not a `StoreResult`) | `assertOpen`; open-transaction guard `:310-312`; any SQL error in `candidates` (not caught, unlike `lookupInside` `:595-601`) | `assertOpen` |
| `ready` | Records in refKey byte order, each schema-validated | same |

**`next` / `complete` today.** The two backends behave identically, and both are based on the window superset.

- SQLite fetches up to `cap` window candidates after `after`, plus one more to detect `hasMore` (`sqlite-text-search.ts:312-322`).
- It rechecks each candidate until `limit` matches are found (`sqlite-record-store.ts:826-843`).
- `complete = !hasMore && every fetched candidate was examined` (`:844`).
- `next` is the last **examined candidate** (`:845`). When the limit is hit, that is the last match. When the cap is hit, it may be a non-match, and the page may be empty with `complete:false`.
- Memory emulates the same superset (`in-memory-record-store.ts:599-613`), with the cap on examined candidates (`:617`, `:623`, `:626`).

### 1.3 Callers

**Production: only `note-read-model.ts`.**
- `searchPage` (`:810-819`; it maps `unsupported` through unchanged at `:815`, everything else through `asOutcome`/`mapStoreFailure`, which turns `corrupt`/`unavailable` into `unavailable`, `:88-100`).
- `searchPage` is called by:
  - `allTermHeads` (`:830-847`), used for `match:'all'` (`memoryFind :1490-1502`). It makes one port call per find page; `next = page.complete ? null : page.next`.
  - `fillStream` (`:851-861`, limit 100, stops when `complete`, `next===null` or `next===after`), used by `anyTermHeads` (`:869-907`). That runs one stream per term, merges them with `compareText` (UTF-16 order, `:449, :886`) and stops at `cap` in-scope matches (`:903`). It is used for `match:'any'` (`:1505-1516`).
- The deps type is at `:48`. The backend is spread through `commit-observer.ts:90`.
- `create-platform.ts:562-564` passes **neither** `fullTextProbe` nor `textSearchCandidateMax` to the backends. `noteLimits.textSearchCandidateMax` (`:262`) is the read model's `'any'` cap (`note-read-model.ts:442, 756, 903`), not the port's.

**Tests:**
- `tests/record-store/S4B-text-search.test.ts`, through `tests/helpers/S4B-text-search-support.ts`.
- Indirectly, all `memoryFind` tests with `terms`.

`bigramWindows` has a second production user: similar-note Jaccard at `note-views.ts:848`. It must stay.

---

## 2. FTS5-specific behaviour and the tests that assert it

| # | Behaviour | Code | Asserted by |
|---|---|---|---|
| F1 | FTS5 probe; unavailable → `unsupported`; `fullTextProbe` option | `sqlite-text-search.ts:63-86, 138-152`; `sqlite-record-store.ts:51, 156-159, 181, 803-805` | T-06 "unavailable FTS5 probe answers unsupported" `S4B-text-search.test.ts:538-546`; T-06 "write made while FTS5 was unavailable is rebuilt" `:489-504`; MF7b `S4B-memory-unsupported.test.ts:19-36`, via `S4B-note-check-fixture.ts:78, 104-106` |
| F2 | Table code = sha256 of name, aggregateType, prefix paths, text paths, rule version; FNV table name | `:88-100, 46-53, 183` | T-06 "changed text registration rebuilds" `:521-536` |
| F3 | `TEXT_SEARCH_RULE_VERSION = 1` | `:35, :96` | none directly |
| F4 | Rebuild at open when meta is missing, the code differs, the table is missing, or `through ≠ MAX(events.id)`; one `BEGIN IMMEDIATE`; a corrupt head fails the open | `:186-240` (corrupt `:208-225`, `through` read inside the transaction `:230`) | T-06 `:441-453` (reopen), `:455-467` (registered later), `:469-487` (writes while unregistered), `:489-504`, `:521-536`; no test for a corrupt head at rebuild |
| F5 | Meta `through` column added in place for a round-1 store | `:157-163` | none |
| F6 | `through` cursor: advanced in the commit only if it was current at `previousMax` (null-safe); `isCurrent` per read → `index_not_ready` | `:265-284`; `sqlite-record-store.ts:475, 492-495, 815-817` | T-06 "falls behind an open store" `:506-519` |
| F7 | Per write: `DELETE`+`INSERT` of the window row. The DELETE scans the virtual table, because `ref_key` is UNINDEXED (measured p50 19.7 ms per write at 20k, `grep-compare-check-scan.out`) | `:249-263` | T-04 `:269-326` |
| F8 | Window superset (`MATCH` of ANDed windows), then a substring recheck; memory emulates the windows | `lookup-index.ts:632-642, 659-665`; `sqlite-text-search.ts:311-320`; `in-memory-record-store.ts:599-613` | T-01 "window candidates … checked out" (`abXbc`) `:75-87`; T-05 1001-row cap tests `:697-752` |
| F9 | Prefix equality taken from the body (`json_extract` JOIN `snapshots`) | `sqlite-text-search.ts:297-306` | every test (nested `ref.projectId`, `S4B-text-search-support.ts:30-32`) |
| F10 | Port cap on examined candidates (`textSearchCandidateMax`) | `sqlite-record-store.ts:52-53, 160-163, 824`; `in-memory-record-store.ts:42-43, 81-84, 617` | T-05 small-cap tests `:754-800` (3 tests × 2 backends) |

---

## 3. Route-two design

### 3.1 Modules

- **New `src/core/record-store/text-scan.ts`** (pure, no I/O, shared by both backends):
  - `TEXT_SCAN_RULE_VERSION = 2`;
  - `textRowOf(def, body) → {prefixKey: lookupIndexKeyOf(def, body) (null when composite), text: searchTextFrom(body, def.text.paths)}`, so there is one derivation for write, rebuild and memory;
  - `createTextScanIndex()` with `set/get/loadSorted/scan`.
- **New `sqlite-text-scan.ts`** replaces `sqlite-text-search.ts`: the table, meta, rebuild, legacy drop and the per-read currency and catch-up.
- **`lookup-index.ts`:** drop `windows` from `DecodedTextSearchRequest` and drop `windowsForTerms`. Keep `bigramWindows` (used by `note-views`). Optionally decode `match` (§3.9).
- **`migrations.ts`** stays untouched, as with P5.

### 3.2 Compact table: write, rebuild, legacy drop

```sql
CREATE TABLE IF NOT EXISTS next_text_meta(name TEXT PRIMARY KEY, code TEXT NOT NULL,
  through INTEGER, generation INTEGER NOT NULL);
-- per registered text index (name sanitized + FNV suffix, as today :183)
CREATE TABLE "next_text_<idx>_<fnv>"(ref_key TEXT PRIMARY KEY, prefix_key TEXT,
  text TEXT NOT NULL, seq INTEGER NOT NULL);
CREATE INDEX "next_text_<idx>_<fnv>_seq" ON "next_text_<idx>_<fnv>"(seq);
```

**Column choices.**
- `code` = sha256 of {name, aggregateType, prefixPaths, textPaths, `TEXT_SCAN_RULE_VERSION`}. Optionally add `process.versions.unicode`, so that a Node upgrade with a new Unicode version rebuilds (NFC of unassigned code points can change).
- `prefix_key` stores the memory backend's bucket key, so both backends group by one rule. For a string request this is equivalent to today's `json_extract = ?` (`sqlite-text-search.ts:301-306`).
- `seq` is the last event id of the commit that wrote the row.

**Write.** Inside the existing `BEGIN IMMEDIATE`, in `commitInsideTransaction`:
- replace `indexRecord` at `sqlite-record-store.ts:488` with a cached prepared `INSERT … ON CONFLICT(ref_key) DO UPDATE SET prefix_key, text, seq`;
- use `seq = seqOfCommitCursor(written.commitCursor)`, which is available from `:476`;
- keep `advanceThrough` (`:492-495`) unchanged, on `next_text_meta`.

This is one primary-key upsert instead of today's virtual-table scan plus about 1k window tokens. The process cache is **not** touched at commit time (see §3.4).

**Open.** For each registered text index:
- rebuild when the meta row is missing, the code differs, the table is missing, or `through ≠ MAX(events.id)` (null-safe);
- the rebuild is one `BEGIN IMMEDIATE`: `DROP` and `CREATE` the table and its index; `SELECT ref_key, snapshot_json FROM snapshots WHERE json_extract(ref_key,'$.aggregateType')=?` (today's query, `:203-207`); parse; insert `textRowOf` rows with `seq = R` (where `R = MAX(id)` read inside the transaction); upsert meta `(code, R, generation+1)`; `COMMIT`;
- keep today's rule that a non-text, unparsable or non-object head throws, rolls back and fails the open (`:208-225`);
- tables of indexes that this process has not registered are left alone, as today.

**Legacy drop.** At open, in one write transaction:
- for each `sqlite_master` entry named `next\_fts\_%` (ESCAPE `\`) whose SQL is `CREATE VIRTUAL TABLE`, run `DROP TABLE IF EXISTS` in a try/catch. If the fts5 module is missing, the DROP fails with "no such module"; leave those tables (they are inert) and do not fail the open;
- then `DROP TABLE IF EXISTS next_fts_meta`, which removes the round-1 `through` migration (F5);
- this frees about 100 MB of pages on the 20k dataset (FTS content 68 MB + data 32 MB, lead's dbstat). The file does **not** shrink without `VACUUM`; do not vacuum automatically;
- remove `fts5Probe` (F1). This saves a temp-table probe at every open.

### 3.3 In-memory structure (one per registered text index)

- `byRef: Map<refKey, {prefixKey, entry}>`.
- `groups: Map<prefixKey, {entries: {refKey, text}[] sorted by compareRefKeys, pending: entry[], removed: Set}>`.
- Updating an existing refKey with the same prefix replaces `text` in place, so the order is unchanged.
- A new refKey goes into `pending`. A prefix change removes the entry from the old group (rare).
- Before a scan, a dirty group sorts `pending` with `compareRefKeys` and merges, costing O(n + k log k). This avoids an O(n) splice per insert; repeated splices would be O(n²) on bulk loads such as `seedBatch` or a 200k catch-up.
- A SQLite full load reads `… ORDER BY ref_key`. BINARY collation is memcmp on UTF-8, which equals `compareRefKeys`, so no JS sort is needed.

### 3.4 Staying exactly consistent with the ledger cursor (SQLite)

At the start of every `searchText`, inside `withReadTransaction` (`:309-326`):

```
meta = get(name); max = MAX(events.id)
if !meta || meta.code !== code        -> unavailable/index_not_ready   (new: another registration rebuilt it)
if meta.through !== max (null-safe)   -> unavailable/index_not_ready   (today's R8 rule)
if cache===null || cache.gen!==meta.generation || cache.through>meta.through -> full load
else if cache.through < meta.through  -> catch-up: SELECT ref_key,prefix_key,text FROM t WHERE seq > ?  (seq index), idempotent upserts
cache.through = meta.through
```

Why this is exact:
- Writes are serialized by `BEGIN IMMEDIATE`, and `events.id` is `AUTOINCREMENT` (`migrations.ts:18`), so commit seqs increase.
- `meta.through === max` proves that every commit up to `max` maintained the table.
- Rows changed after the cache was built are exactly those with `seq > cache.through`.

How each case is handled:

| Case | Behaviour |
|---|---|
| Write in this process | Committed rows appear via catch-up on the next read. |
| Write by another connection or process with the registration | Same catch-up. |
| Write by a writer without the registration | `through` falls behind → `index_not_ready` until a reopen rebuilds, exactly as T-06 `:506-519` expects. |
| Rollback | Rolled-back rows are never visible. |
| Crash between commit and cache update | No such window: the cache is derived at read time from committed state. |
| Read transaction throws after a catch-up | The cache is still valid, because upserts are idempotent and `through` is set last. |
| Two backends on one file in one process | Each has its own cache; both are correct. |

`generation` is cheap insurance. Because rebuilt rows are deterministic in (code, through), equality of (code, through) already implies equal content.

### 3.5 Memory backend

- Maintain the same index in `commitPrepared` next to the lookup buckets (`in-memory-record-store.ts:338-342`).
- Record previous entries for undo (`:380-383` pattern).
- There is no `index_not_ready`.
- This removes today's per-query `searchTextFrom` + `bigramWindows` over every prefix record (`:603-611`), which allocates a window set for every record on every query.

### 3.6 Load policy and cost

Measured: 20,034 heads, 15.56 MB UTF-8, 9.17 M code points, mean 777 B and max 1,110 B per head (`grep-compare.out.json`). A JS `includes` AND scan over all heads takes p50 1.5–4.3 ms (`grep-compare-check-scan.out`).

**Recommendation: lazy per index, on the first `searchText`.** Many processes and tests never search, and eager loading would add the load to every open. The memory backend is always current because it is maintained at commit.

| Item | 20k | 200k |
|---|---|---|
| Heap (ESTIMATE): texts are two-byte strings when they contain CJK, ≈ 9–19 MB; plus refKeys ≈ 2 MB and entries/maps ≈ 2–3 MB | ≈ 15–25 MB | ≈ 150–250 MB |
| Lazy load (ESTIMATE) | 30–80 ms | 0.3–0.8 s, blocks the event loop once |
| Scan per query, `'all'` (20k measured, 200k linear ESTIMATE) | 1.5–4.3 ms | 15–45 ms |
| Scan per query, worst case 8-term `'any'` with no hits (ESTIMATE) | — | ~0.1–0.35 s |
| Rebuild (ESTIMATE; today's FTS rebuild is 3.3 s at 20k) | 0.5–1.0 s | 5–10 s |

A rebuild happens only after an upgrade, a code change, or a writer without the registration.

### 3.7 Scan (shared by both backends)

```
group = groups.get(encodeLookupValues(values)); if none -> {[], next:null, complete:true}
mergePending(group)
i = after===null ? 0 : upperBound(group.entries, after)    // first refKey > after, O(log n); after need not exist
hits = []
for (; i < n; i++) {
  e = entries[i]
  if (mode==='all' ? terms.every(t => has(e.text,t)) : terms.some(t => has(e.text,t))) {
    if (hits.length === limit) return {refKeys: hits, next: hits[limit-1], complete: false}  // limit+1 lookahead
    hits.push(e.refKey)
  }
}
return {refKeys: hits, next: null, complete: true}
```

**`has(text, term)`.** For a well-formed term, `has` is `includes`, which is exactly a code-point substring match. A term containing a lone surrogate needs a code-point-boundary check: retry `indexOf` when a hit splits a surrogate pair. Otherwise route two would return matches that today's windows exclude, for example `'\uDE00a'` against `'😀a'`. The alternative is to make non-well-formed terms `invalid`, which is a small contract change.

**`next`.** `next` = the last returned match, the same as today in the limit case. The gap up to the lookahead hit is rescanned on the next page, which is at most N per full paging. The alternative is `next` = the predecessor of the lookahead hit, which means zero rescanning but may be a non-match, as today's cap case can be. The lead picks; I recommend "last returned".

### 3.8 What the port returns, and which statuses become unreachable

**Returns.** `readManyInside(hits)` (SQLite, in the same read transaction) or `readManyKeys` (memory) is the **only** snapshot read: each match is read once, and non-matches are never read. Today every candidate is read and parsed for the recheck and each match is read again (`:831-838` + `:846`). A missing or damaged match is `corrupt` with today's messages (`:848-850`). `readThrough` is unchanged.

**Becomes unreachable:**
- `unsupported` "FTS5 not available", and therefore the `unsupported` passthrough in `memoryFind` (`note-read-model.ts:815`) in production;
- the recheck-only `corrupt` paths (`:834, :835, :840`);
- the memory branch at `:595`.

**Stays reachable:**
- `invalid` (decode now runs first on every backend);
- `unsupported` for an unregistered or non-text index;
- `index_not_ready` (writer without the registration; plus the new code-mismatch case);
- `corrupt` for matches.

I also recommend catching SQL errors in the text path and returning `corrupt` (like `lookupInside :595-601`), so `memoryFind` answers `unavailable` instead of throwing.

### 3.9 Optional port `match:'any'` (contract change to P1)

- Add `TextSearchRequest.match?: 'all'|'any'` (default `'all'`).
- `anyTermHeads` then becomes **one** stream:
  - no N-way merge;
  - no UTF-16 `compareText` merge against byte order (`:886`);
  - a note matching k terms is read once instead of k times.
- Without this change, decision 66's "one scan, read once per call" is not met for multi-term `'any'`.
- Results are identical: the union in refKey order, deduplicated, which is exactly what the merge yields today.

**Decision 66 anchor/path candidates.** For terms plus an anchor or `pathPrefix`, the port is not needed at all. Filter `anchorOnAnchor` (`:1480`) or `headsOnPathPrefix` with the **same** exported predicate from `lookup-index.ts` (`note-read-model.ts:22` already imports from there), and sort by `compareRefKeys` to keep the `'all'` order. Decision 67's "skip what was already returned" is a WorkGraph filter; no port field is needed.

### 3.10 Observable deltas (all caused by decision 66)

1. **Window false positives after the last match.** Today the port says `complete:false` and the next call returns an extra empty page. Route two says `complete:true` on the last non-empty page. Example: `n1 'abc'`, `n2 'abXbc'`, limit 1, term `abc`. This also reaches `find 'all'` page boundaries.
2. **Port cap.** "At most 1,000 checked candidates" has no meaning without a superset, and counting scanned entries would turn rare terms into strings of empty `complete:false` pages, and would break T-05 `:703-752`. Options: remove the backend `textSearchCandidateMax` (recommended; it is test-only, `create-platform.ts:563-564`), or redefine it as `min(limit, cap)`. Spec L10's last bullet needs a rewrite.
3. **FTS5 unavailability no longer exists:** spec L10 "启动" bullet, §2 comment line 414, §10 P5/R8 bullet and test exceptions, NE2/T-06 wording, MEMORY-LOOKUP `:183-189`.

---

## 4. Tests

### `tests/record-store/S4B-text-search.test.ts`

- **Stay unchanged:**
  - T-01 `:33-87` (rename "window candidates" to "substring rule" optionally);
  - T-02 `:94-176, 552-578`;
  - T-03 `:183-262, 585-690`;
  - T-04 `:269-326`;
  - T-05 paging and "both agree" `:333-393`;
  - T-08 `:400-434`;
  - T-06 reopen `:441-453`, registered-later `:455-467`, writes-while-unregistered `:469-487`, `index_not_ready` `:506-519`, changed-registration `:521-536`;
  - T-05 1001-row tests `:697-752` (assertions hold; retitle).
- **Delete** (FTS5 removed by decision 66): T-06 "FTS5 was unavailable … rebuilt" `:489-504` (the unregistered-writer test covers the rebuild path) and T-06 "unavailable FTS5 probe answers unsupported" `:538-546`.
- **Small-cap tests `:754-800`:** delete if the backend cap is removed; unchanged under `min(limit, cap)`.

### Helpers and other files

- **`tests/helpers/S4B-text-search-support.ts`:** remove `fullTextProbe` (`:124, :148`), otherwise TypeScript reports excess properties. Keep or remove `textSearchCandidateMax` (`:125, :136-138, :149-151`) following the cap ruling.
- **`tests/work-graph/S4B-memory-unsupported.test.ts`:** delete. Its case needs an FTS5-less store; the "no-terms find works" half is covered by MF9 and other find tests.
- **`tests/helpers/S4B-note-check-fixture.ts`:** remove `fullTextUnavailable` (`:78, :104-106`).
- **`S4B-memory-ranking.test.ts`** (T-07, MF7a `:66-183`, R7 `:186-203`, T-09 `:207-256`) and **`S4B-memory-anchor-not-found.test.ts`** (`:96-100, :119-124`): stay. All their limits go to the read model, and all results are unchanged.

### New tests (NE2, both backends unless noted)

1. **Byte order with supplementary-plane keys** (hand-computed): ids `a~`, `a\uFFFD`, `a\u{1F600}` → order `[~, FFFD, 1F600]`, also with limit-1 paging. This guards the sort and binary-search rule.
2. **Resume from a bookmark that is not a record:** `after = keyOf('p1','n2a')` → n3…; `after` beyond the last key → `[]`, `complete:true`, `next:null`.
3. **Cross-backend differential:** a seeded dataset (CJK, ASCII, combining marks, non-ASCII ids, two projects) with random limits; the two backends must agree page by page. Add `'any'` if the mode is adopted.
4. **Search, write, search on one open store:** the cache is already loaded, then a body change and a new head are written. This is the in-process catch-up; T-04 only seeds before searching.
5. **Consistency after another writer (SQLite):** A searches; B (same registration, same file) adds n2 `'alpha'` and changes n1 to `'beta'`; A sees both. A second variant: B writes before A's first, lazy search.
6. **Rejected commit leaves results unchanged:** a guard conflict.
7. **Rebuild after a code change by another process while A is open → `index_not_ready`.** Only if the code check is adopted.
8. **Last-page completion without the superset** (delta 1). Only if the lead accepts the delta.
9. **Upgrade from a 4B store** (allowed migration fixture: raw `next_fts_meta` plus a virtual table) → opens, results correct. Inspecting the schema has precedent at `lookup.test.ts:187-192`.

**Memory backend "no per-query rebuild" and "resume without rescanning"** are performance properties. Verify them in evidence by re-running `measure-4b-final` on the 20k dataset: memory-backend p50, flat per-page cost, lazy-load time, RSS, rebuild and upgrade time, DB size. Not with unit tests.

---

## 5. Risks and open questions for the lead

1. **Port cap:** remove it, or redefine as `min(limit, cap)` (delta 2). If removed, also delete `TEXT_SEARCH_CANDIDATE_MAX` from `lookup-ports.ts`, otherwise the production-reach test fails on an unreached constant (`tests/architecture/production-reach.test.ts`, top-level variables count).
2. **Port `'any'` mode** (§3.9): it changes P1's "TextSearchRequest 不加字段", but is needed for read-once.
3. **Accept delta 1** and rewrite NE2's "窗口候选是全部匹配的超集".
4. **Lone-surrogate terms:** use the boundary check, which is exact, or `invalid`.
5. **Lazy vs eager**, and whether the first-search load counts as "建索引" under the cold-start target (MEMORY-LOOKUP `:39`). At 200k it is about 0.3–0.8 s and 150–250 MB per process that has searched; there is no eviction.
6. **New code-mismatch `index_not_ready` at read time:** today another registration's table is read silently.
7. **One-time upgrade:** a rebuild plus the FTS drop on the first open. The file does not shrink without `VACUUM`. With fts5 missing, the drop is skipped.
8. **"Parsed once" is only partly a port matter.** The remaining parses happen in `readManyInside` schema validation and in WorkGraph decoders (profiling (b)4), not in the port.
9. **Round 2 (lookup indexes limited to their own records)** may stop the rebuild query using an expression index, giving a full `snapshots` scan of about 87k rows at rebuild time. That is acceptable but should be noted.
10. **`advanceThrough`** stays an UPDATE on every platform commit (as today; small cost).
11. **The text index's generic expression index** is still created (`createLookupIndexes`, `sqlite-record-store.ts:96-117`), because `lookup` on that name must keep working. Dropping it is a round-2 option.
12. **`RULE_VERSION`:** bump `note-read-model.ts:444` only if the anchor-candidate change alters `'all'` page composition. Old cursors would then get `cursor_mismatch`.