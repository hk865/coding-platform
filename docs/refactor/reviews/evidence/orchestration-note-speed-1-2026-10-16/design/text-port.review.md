The design holds up on the main points: it stays consistent with the ledger cursor, both backends share one scan, and lazy loading is a sound choice. It still has problems: two make both backends or the anchor route return different results, two lose consistency with the ledger cursor, and it leaves several result changes unlisted. I read the code at HEAD ad2679f3 without changing any file or running tests. I checked a few runtime facts with throwaway `:memory:` probes on Node v24.18.0 / SQLite 3.53.1 in WSL; no files were created.

## Problems

### 1. Must fix: storing the comparison text as SQLite TEXT loses lone surrogates, so the two backends disagree
- **Evidence.**
  - node:sqlite turns a lone surrogate into U+FFFD when it stores TEXT. The probe stored `'a\uD800b'` as hex `61EFBFBD62` and read back `'a\uFFFDb'`.
  - Today SQLite never stores raw text:
    - the snapshot is `JSON.stringify(record.parsed)` (`sqlite-record-store.ts:487`), which escapes lone surrogates;
    - FTS stores only ASCII window tokens (`lookup-index.ts:639`, `sqlite-text-search.ts:226, 253`);
    - the recheck parses `snapshot_json` again (`sqlite-record-store.ts:838-842`).
  - Nothing in `src` rejects malformed strings. The only `surrogate` hit is `continuation-brief.ts:336`.
- **Failure.**
  - A head with topic `x\uD800y` and the term `\uD800y`: today both backends match. With route two, memory matches and SQLite does not.
  - The term `\uFFFDy`: today neither matches. With route two, SQLite matches.
  - `prefix_key` has the same exposure.
- **Fix.**
  - Store `text` and `prefix_key` losslessly. Either a BLOB of `Buffer.from(s,'utf16le')` (probe: round-trips exactly, NUL included) or `JSON.stringify(s)`.
  - Add a backend-differential test row with a lone surrogate.

### 2. Must fix: the anchor/path route skips the port's term check, so `invalid` turns into `ready`
- **Evidence.**
  - The read model rejects whitespace with `/\s/` (`note-read-model.ts:715`). The port uses `\p{White_Space}` (`lookup-index.ts:620, 740`).
  - Probe: for U+0085, `/\s/` gives false and `\p{White_Space}` gives true.
  - Today a find with terms and an anchor always reaches `decodeTextSearchRequest` through `searchPage` (`note-read-model.ts:810-819`). A term like `a\u0085b` is therefore rejected `invalid`. With §3.9 there is no port call, so it is accepted and can even match.
  - A test-injected `textSearchMaxTerms` above 8 (`note-read-model.ts:443`) is accepted the same way.
- **Fix.** Export one term validator from `lookup-index.ts`. Use it in `decodeTextSearchRequest` and in `normalizeTerms`, or run the port decode on the anchor route.

### 3. Must document: the anchor/path route changes `find` results beyond what §3.10 lists
- **What changes.**
  - Today `'all'` with an anchor makes one port call that returns `limit` matches from the whole project, then filters them (`note-read-model.ts:830-847`). Pages are short or empty and carry a cursor.
  - Example: an existing anchor with no matching notes, while the project has more than `limit` matches. Today that returns `items: []`, `complete:false` and a cursor (spec L12 `:183` allows such a page). The route returns `[]`, `complete:true`.
  - Terms with an anchor can no longer return `index_not_ready` or a port `corrupt`.
  - This contradicts the P1 sentence that each `'all'` page makes exactly one port call (spec `:736`). Add it as a fourth delta and amend P1.
- **`RULE_VERSION`.** The design ties a bump to "if page composition changes". It does change, but no bump is needed.
  - Both routes enumerate the same in-scope matches in refKey order and resume from the first refKey after `after`, which also works when `after` is not a record.
  - A bump would change `readBasis.ruleVersion` in every memory read (`basisOf :668-670`, `RULE_VERSION :444`).
- **`'any'` cut order.** `rankMatches` cuts by noteId in UTF-16 order (`:755-757`). The anchor route must cut the first `cap` in refKey byte order before calling it, as P1 requires. This is equal for UUID ids only.
- **Shared constants.** Use one exported text-paths constant for both the registration (`note-record-codecs.ts:666-667`) and the predicate. When both anchor and `pathPrefix` are given, use the anchor set and apply `headInScope`.

### 4. Should fix: a writer with a different registration code still advances `through`, so the read-side code check is not enough
- **Evidence.**
  - `advanceThrough` only checks `through IS previousMax` (`sqlite-text-search.ts:265-275`), and the design keeps it unchanged (§3.2).
  - Scenario:
    1. Process A (code C1) is open.
    2. Process B (code C2) opens and rebuilds.
    3. A keeps upserting rows built with C1 and keeps advancing `through`.
    4. B sees its own code and `through === max`, so it serves C1 rows.
  - The new read-side check only protects A.
- **Fix.**
  - Gate each index: `UPDATE … SET through=? WHERE name=? AND through IS ? AND code=?`, with this process's own code.
  - Skip the row upsert when the stored code is not this process's code.
  - B then sees `index_not_ready` and rebuilds on reopen.

### 5. Should fix: make the Unicode version part of the code (the design calls it optional)
- Today matching always re-derives the text from the snapshot with the running Node (`sqlite-record-store.ts:842`). The read model also normalizes at read time (`note-read-model.ts:689-696, 795`).
- Route two trusts the stored derivation, but the code (`sqlite-text-search.ts:88-100`) has no Unicode or ICU version.
- After a Node upgrade, the port and `rankAll` can disagree: an `'all'` match whose `matchedTerms` misses a term. The "deterministic in (code, through)" argument also depends on this.
- **Fix.** Add `process.versions.unicode` and `process.versions.icu` to the code (today 17.0 and 78.3).

### 6. Should fix: the proposed surrogate-boundary `has` is not today's rule
- Today a match needs `includes` and the term's windows to be a subset of the text's windows.
- Counterexample: text `'\uDE00a \uD83D\uDE00ab'`, term `'\uDE00ab'`.
  - The term's windows {DE00·a, a·b} are all in the text, so today it matches.
  - The only `includes` hit is at index 4 (probe), inside a surrogate pair, so the boundary check rejects it.
- For well-formed terms, plain `includes` equals today's rule; I confirmed this.
- **Fix.** Either compute windows only for malformed terms (exact), or make malformed terms `invalid` in the shared validator from item 2. Whichever rule is chosen, the anchor route must call the same predicate.

### 7. Should fix (speed): keeping the order costs O(n) allocating comparisons on the first search after any new note
- `compareRefKeys` allocates two Buffers per call (`lookup-index.ts:562-564`).
- Probe at 20k keys: 8.7 ms per pass of comparisons and 46 ms per sort. Linearly that is roughly 90 ms and 0.6 s at 200k.
- `mergePending` runs O(n) comparisons after every insert. The memory backend's first scan after a bulk load sorts everything.
- **Fix.**
  - Binary-insert when few entries are pending.
  - Use an allocation-free code-point comparator, which equals UTF-8 byte order for well-formed strings, and fall back to Buffer comparison when `!isWellFormed()`.

### 8. Should fix: the legacy FTS drop takes a write lock on every open, and breaks a 4B process that is still running
- **Unconditional write lock.**
  - Open goes through `busy_timeout = 5000` (`sqlite-record-store.ts:176`). An unconditional `BEGIN IMMEDIATE` makes every open wait on any writer and fail after 5 s.
  - That includes another process's rebuild, which the design estimates at 5–10 s for 200k notes.
  - **Fix:** read `sqlite_master` first and start the write transaction only if legacy objects exist.
- **Concurrent 4B process.**
  - After the drop, a still-open 4B process's `indexRecord` DELETE (`sqlite-text-search.ts:257`) fails with "no such table". Its commits then throw instead of returning a result (`:290-307`).
  - **Fix:** state as a precondition that no 4B process may be open during the upgrade.

### 9. Speed risk: candidates from `pathPrefix`
- Today a search with terms and a `pathPrefix` never reads `headsOnPathPrefix` (only the no-terms branch does, `:1519-1522`).
- The route would page and decode every head under the prefix: 5 ordered indexes, 200 per page (`:509-532`). A broad prefix such as `src` can cost more than the 2–5 ms text scan plus reading the matches.
- Anchor heads, by contrast, are already loaded (`:1478`), so the anchor route costs nothing extra.
- `'any'` combined with `kind`/`state`/`topic` still streams every match (`:903`). The anchor route does not fix that.
- **Fix.** Measure broad prefixes on the 20k-note dataset before fixing the route.

### 10. Nice to have: table layout
- Make the table `WITHOUT ROWID` with `PRIMARY KEY(ref_key)`. The full load `ORDER BY ref_key` then reads in key order, and each write is a single PK upsert, with no lookup through the auto-index into the rowid table.
- Optional: an index on `(prefix_key, ref_key)` to load only the project being searched. Today's full load reads every project in the ledger.

### 11. Robustness of `generation`, nulls and the swap
- `generation+1` from a missing meta row restarts at 1 and can collide with a value another live process has cached.
- If that happens with no new events, the catch-up `seq > through` returns nothing and stale content is served.
- **Fix.**
  - Use a random generation.
  - Handle nulls carefully: an empty ledger gives null (`sqlite-text-search.ts:170-176`), and `5 > null` is true in JS.
  - Build each full load into a fresh structure and swap it in only on success.

### 12. Closing does not release the caches
- `close()` only sets a flag (`sqlite-record-store.ts:878-886`, `in-memory-record-store.ts:657-660`).
- A backend that is closed but still referenced, for example through the wrapper at `commit-observer.ts:90`, keeps up to 150–250 MB at 200k.
- **Fix.** Clear the caches in `close()`.

### 13. Test gaps
- New test 6 (rejected commit) exercises nothing new. A guard conflict returns before any write (`sqlite-record-store.ts:434-440`, `in-memory-record-store.ts:276-280`). No public input throws after the text row is written (`:477-480`, `:318-326`). Do not count it as rollback coverage.
- Add these tests:
  - A search loads the cache, then a writer without the registration writes, then the search must return `index_not_ready`. T-06 `:506-519` never searches before that write.
  - The lone-surrogate row from item 1.
  - Another process rebuilds while A's cache is loaded, and A must return the rebuilt content.

### 14. The benchmark script will break
- `measure-4b-final.mjs:166, 187` read `next_fts_meta`. The first route-two open drops that table, so re-running it as the design proposes fails.

### 15. Qualify "results identical" for the port `'any'` mode
- The current merge uses UTF-16 order (`note-read-model.ts:449, 886`) over streams that are in byte order.
- Probe: `'n\uFF5E'` and `'n\u{1F600}'` sort differently in the two orders. With 2 or more terms, the first-`cap` set can differ when ranking is partial.
- Route two follows P1. Production note ids are `randomUUID` (`create-platform.ts:644`), so nothing changes in production.

### 16. Decision 67 conflicts with the one-port-call rule
- Skipping notes already returned in the first segment, inside WorkGraph, makes second-segment pages short or empty, unless the read model may call the port more than once per memory page.
- R7/P1 currently forbids that (spec `:736`, `note-read-model.ts:821-829`). Flag it for the 4C spec.

### 17. More documentation lines to update
- In slice-4-SPEC:
  - L10's memory-backend and same-transaction lines, including "内存后端不用另存" (`:165-166`);
  - §4 rule 11 (`:566`);
  - the §2 comment (`:413-414`);
  - NE2 (`:592`);
  - §10 P5 and the test exceptions (`:737`, `:752`).
- In MEMORY-LOOKUP: the sentence about not falling back to a full scan (`:187`), now overridden by decision 66.

## Confirmed correct

- **Cursor consistency.** Checking `meta.through === MAX(events.id)` and catching up by `seq` inside one read transaction is exact.
  - Writers are serialized and ids are `AUTOINCREMENT` (`migrations.ts:18`).
  - SQLite only ever upserts snapshots; there is no `DELETE FROM snapshots` in `src`.
  - Not touching the cache at commit makes rollback and crashes safe.
- **Paging.** "next = last returned match" equals today's `next` when the limit is hit (`:845`).
  - T-05 pages and `complete` flags `[false,false,true]` come out the same.
  - Searching from a bookmark that is not a record behaves like SQL `ref_key > ?` (`sqlite-text-search.ts:307-309`).
- **Prefix grouping.** Grouping on `lookupIndexKeyOf` equals the memory buckets (`in-memory-record-store.ts:341, 596`) for every NoteHead. It also closes a gap where SQLite `json_extract` matched composite values.
- **Dropping the windows.** For well-formed terms, today's result is plain `includes`. Terms contain no whitespace (`:740`) and the windows skip whitespace (`:638`). The only changes are deltas 1 and 2.
- **Removing the backend cap and probe.** Production passes neither (`create-platform.ts:562-564`). The T-05 1001-row tests still hold, and the small-cap tests hold under `min(limit, cap)`.
- **Tests that stay unchanged.** MF7a, R7, T-07 and T-09 use only the read model's cap. The T-06 expectations hold under the rebuild triggers.
- **Port `'any'` mode** is needed for "each note read once".
- **FTS5 handling.** FTS5 is compiled in (`ENABLE_FTS5=1`), and the "no such module" handling is safe.
- **Lazy loading** is the right choice.
- **Errors.** Catching SQL errors as `corrupt` is consistent with "read failures are always `unavailable`".