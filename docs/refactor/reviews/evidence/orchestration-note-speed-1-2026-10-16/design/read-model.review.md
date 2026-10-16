**Adversarial review of the read-model change list (HEAD ad2679f3, code = 0776b9b6)**

I only read code. I ran one `node -e` check of normalization and whitespace behaviour in WSL. No files were written and no tests were run. Line numbers below are in `src/core/work-graph/notes/note-read-model.ts` (RM) and `src/core/work-graph/views/note-views.ts` (NV) unless another file is named.

## Problems

**1. Scoped 'any' matches on differently normalized terms than today, so items change.**
- **Evidence:**
  - `normalizeTerms` normalizes each term once (RM:713).
  - The port normalizes the already-normalized term again (`lookup-index.ts:732`) and matches and length-checks the result (`:733-743`).
  - `normalizeSearchText` is NFC first, then ASCII lowercase (`lookup-index.ts:623-625`). That order makes it non-idempotent. Checked in node: `"J\u030C"` becomes `6a,30c`, and normalizing that again gives `1f0` (ǰ). The same happens for Y+U+030A, T+U+0308, H+U+0331 and W+U+030A.
- **Why it matters:**
  - Today 'any' streams match on the doubly-normalized term. The sketch's `scopedAnyMatches(scoped, scopeInput, terms.value)` would match on the singly-normalized term.
  - For anchor + term `"J̌x"`, today returns the notes whose text has "ǰx" or "ǰx", and not the "J̌x" notes (their comparison text is `j\u030Cx`). The scoped path returns the reverse.
  - Lengths differ too. Raw `"J\u030C"` passes the read model (2 code points), but today the port rejects it as `invalid` "a text search term must be 2 to 64 code points" (it is 1 code point after the second pass). A scoped check without the second pass would accept it.
- **Fix:**
  - Export one per-term decode that wraps exactly `lookup-index.ts:731-743` (normalize again, then length, then White_Space). It returns the port term or the port's reason.
  - Apply it in order to each `normalizeTerms` output, and pass the returned port terms to `textSearchMatchesAny`. `rankMatches` keeps the singly-normalized terms, as today.
  - This also covers the U+0085 flag (confirmed: `/\s/` is false, `\p{White_Space}` is true).
  - Add a test N9b on both backends: `"J\u030Cx"` with and without an anchor gives the same items, and `"J\u030C"` gives the same `invalid` reason.
  - Note that spec L10 says the term rule applies "after the same normalization" (同一个规范化后). The double pass is a latent deviation. Keep it for this round, and record it for a later ruling: fixing it changes output on every path.

**2. Leaving 'all' + anchor/pathPrefix project-wide conflicts with decision 66 and keeps the paging problem.**
- **Evidence:**
  - HANDOFF.md:421 makes "带锚点或路径前缀时只在那些注记里找" (with an anchor or path prefix, search only those notes) part of round one. It does not limit this to 'any'.
  - `allTermHeads` makes one port call of `limit` project-wide matches and then filters them by `headInScope` (RM:834-846).
- **Why it matters:** in the measured anchor case (279 in scope out of 19,609 matches), a full 'all' walk takes about 981 calls at limit 20, or about 197 at limit 100. Most pages come back empty with `complete:false`. Route two makes each call cheap but does not reduce the number of calls.
- **Fix:** make the scoped 'all' the default proposal, not the option.
  - Candidates are the scoped heads, filtered by `headInScope` and by all port-normalized terms (problem 1), in `compareRefKeys` order.
  - A page is the first `limit` after the cursor's refKey (`afterOf` at RM:1499-1500 is unchanged).
  - `next` is null when the list is exhausted.
  - Bump `RULE_VERSION` (RM:444) and amend the 'all' sentence of P1 and R7 (spec:736).

**3. Decision 66 requires "one read, one parse per note per call"; the design treats (b)4 and seeding as optional and misses several re-reads.**
- **Evidence:** HANDOFF.md:420 says "一次调用里同一条注记只读一次、只解析一次" (within one call each note is read once and parsed once). Re-reads that remain after (b)1–(b)3:
  - (i) `conflictingOf` reads each `contradicts` target through `readHeadRecord` for every item (RM:261-262). It is outside HeadCache.
  - (ii) 'note' fact reads (NV:717).
  - (iii) neighbors reads the referenced heads (RM:1353), then decodes them again inside the anchor sets (RM:1358).
  - (iv) `bodyPageOf` re-reads the head and version (RM:960, :967) that lookup/history already hold (RM:1210, :1230).
  - (v) Without seeding, the check reloads every anchor set the read model already loaded.
  - (vi) `confirmedByUserOfVersion` reads versions 1..v for every listed version (RM:174-176, called at :1233). That is quadratic: a 20-item page at head version 50 with no user confirmation costs about 760 `readMany`.
- **Fix:**
  - Make seeding and a per-call note registry (refKey → decoded head/version) mandatory, consulted by `readHeadRecord`, `readAllHeads`, `readVersionRecord`, the check's `readHead`/`readVersion` and the fact reads.
  - For history, compute the first confirming version u* once, lazily at the first non-head item, scanning 1..max(v) in order. Then confirmed(v) = (v == head version ? head value : u* ≤ v). Reads happen in the same order, so failures are identical.
  - The lead must define "read once" for index lookups: `lookup` returns full records (RM:112), so a truly single read needs refKey-only lookups.

**4. (b)11 option (B) changes more than coverage, and R3's "filtered candidates count" clause has no test.**
- **Evidence:**
  - Budgets are spent in page order (NV:231-243, :916-918, :526-527). An earlier dropped item can push a later listed item to `unchecked`.
  - Under (B), listed items can change `freshness`, `observedFiles`, `uncheckedFacts` and `currentEligible`. Their byte sizes change, so `fitToByteBound` (RM:646-664) can change `next` and `complete` too.
  - `S4B-memory-observation.test.ts:49` is named for the rule, but both notes there are listed (host principal, `toHaveLength(2)`), so it filters nothing. No test pins the "含被筛掉的" (including filtered-out candidates) part of R3 (spec:741).
- **Fix:** rule (B) as "items' derived fields may change". Add a test with a dropped cross-goal item before a listed one under `readFilesMax:1` that asserts today's coverage, before any change.

**5. (b)3 contradicts L22's wording; the design needs a structural guarantee.**
- **Evidence:** spec:252 says "六种读都走同一个函数" (all six reads go through the same function), and `note-contracts.ts:99-101` says the reads and the write-after check "call this same function". `checkHeads` would become the reads' entry point.
- **Fix:**
  - Implement `checkNotes` as: validate (NV:1007-1009), then read the head and version with today's mapping (NV:192-213, :869-880), then a shared `checkItems`. `checkHeads` calls `checkItems` directly.
  - Amend L22 and the contract comment.
  - Specify that a supplied `snapshot` is ignored when `version === head.version`, so `bodyOfHead` stays (NV:873-875).

**6. Seeding must use the raw `headsByAnchorKey` result; the design only cites line numbers.**
- **Evidence:** memoryStale's `candidates` are filtered by goal and state (RM:1403-1404, :1414-1415). Seeding them would undercount `overQuotaOf` (RM:300-302) and miss conflicts (RM:279-284).
- **Fix:** state it in the construction book: seed with `heads.value` exactly as `headsByAnchorKey` returned it, keyed `${ctx.projectId}\0${anchorKey}` (RM:226), where `anchorKey` is the key that was passed in.

**7. G2 does not cover the fact-read caches in (b)10.**
- **Evidence:** failed 'note', record and kernel_history fact reads become `unresolved: 'unavailable'` and the call continues (NV:718-721, :744, :779).
- **Why it matters:** caching a failure changes output under a transient failure, because today a later item can resolve the same pointer.
- **Fix:** cache only successful fact reads, or get a lead ruling that extends R3's read-once rule (NV:231-243) to facts.

**8. (b)3 changes which §7 `readMany` fault doubles take effect.**
- **Evidence:** the double fails any `readMany` whose keys contain the needle (`tests/helpers/S4B-note-check-fixture.ts:92-96`). Today every checked item does a `readMany` of its NoteHead (NV:194). In find, lookup, stale, conflicts and neighbors the heads come from lookups, so a noteId needle gives `unavailable` today and `ready` after (b)3.
- **Fix:** list this under failure-case changes. Current uses (`S4B-note-budget-check.test.ts:152`, `S4B-note-hints.test.ts:161`, `S4B-note-read-failures.test.ts:47`) arm Goal/Run needles and are unaffected.

**9. Scoped path for pathPrefix + terms: the opposite failure direction is not flagged.**
- **Evidence:**
  - `headsOnPathPrefix` decodes every head under the prefix plus the first out-of-range record per index (RM:519-523). A damaged head there that matches no term would newly give `unavailable`.
  - `lookupOrdered` failures newly surface (RM:517).
  - The sketch validates all terms before any read. Today, stream 1's store failure surfaces before term 2's port error (RM:877-882).
- **Fix:** add these to flag list 2.

**10. Missed: memoryConflicts has the same check-then-drop shape as (b)11.**
- **Evidence:** it runs the full check on every page candidate (RM:1311), keeps only `conflicting` (:1313), and computes coverage over all (:1317). `conflicting` comes from the head derivation alone (RM:260-288).
- **Fix:** rule it together with (b)11.

**11. Missed: history (and duplicate `checkNotes` items) recompute an identical derivation for every item.**
- **Evidence:** `conflictingOf`/`overQuotaOf` take `head`, not `body` (NV:883-886; R11, spec:745). Even with (b)1, the `contradicts` reads repeat for each item (RM:261-262).
- **Fix:** memoize the two results per `noteId@head.version` within a call.

**12. (b)3 adds a precondition on route two.**
- **Evidence:** today the check re-reads the current head (NV:869), which masks a text port that returns lagging records (the R8 guard is at `sqlite-record-store.ts:811-817`).
- **Fix:** route two's port must return records read from `snapshots` in the same read transaction, as `readManyInside` does today (`sqlite-record-store.ts:846`). Otherwise heads from the text port must not be handed to `checkHeads`.

**13. Test-plan corrections.**
- N1's "one call equals separate calls" holds only within the per-call budgets (NV:147-151). Use notes with no files or facts.
- N10's first bullet, MF7b (`S4B-memory-unsupported.test.ts:19-36`) and the T-06 probe and `index_not_ready` rows (`tests/record-store/S4B-text-search.test.ts:489-514`) exist only while FTS5 does. Route two must replace them; "MF7b still passes" is true only before route two.

**14. Minor issues.**
- The sketch's comparator runs `canonicalJson` plus `Buffer.from` on every comparison. Precompute the keys.
- G3 cites `sqlite-record-store.ts:838` as the recheck. That line is `JSON.parse`; `searchTextFrom` is at :842.

## Confirmed correct

- **G1:**
  - The ledger cursor is read once per read (RM:1134, :1205, :1278, :1329, :1391, :1459) and never re-checked at the end.
  - Within one call, the read model and the check read at different moments; the check's file reads are the async points.
- **G2:** it holds for all fatal paths (NV:1010-1011, RM:598), including (b)8's revision read (NV:582) and (b)9's Run and plan reads (NV:615-627).
- **G3:**
  - The decoded head is the parsed body object (`note-record-codecs.ts:453`, :460).
  - `segmentsOf().all` equals `searchTextFrom` because U+000A is a non-composing starter.
- **G4:**
  - UUID noteIds (`create-platform.ts:1297`) make `compareText` and `compareRefKeys` agree.
  - `rankMatches`' slice (RM:757) is a no-op.
- **(b)1:**
  - The key and ctx.projectId are fixed for the call.
  - The derivations do not depend on set order.
  - `similarNotes` must stay out of the shared cache (NV:833-834).
  - The goal map must not be seeded from 2-state reads.
- **(b)2:** both fields are always replaced (RM:393-394). On failure the same derivation runs, and `mapStoreFailure` is idempotent on these codes (RM:88-95, NV:1011, RM:380), so code and reason match. The `deps.check === undefined` branch is dead in production (only `create-platform.ts:1306` builds the read model).
- **(b)3:** every head field the check uses comes from the one snapshot. `not_found` at NV:872 cannot be reached for a held head.
- **(b)8–(b)10:** the keys are right. Keeping `basisPlanByNumber` (first match, early return, NV:401) separate from `planRevisionsOfGoal` (last wins, NV:422) is right.
- **(a), success case:** the candidate set equals today's for kinds, states, topic, cross-goal (not filtered in find), retired, extra and deleted-file anchors (`anchorKeyOf` ignores `deleted`, `note-anchors.ts:387`) and trailing slashes (RM:1449, one predicate in both paths).
  - Today's streams never stop early: `next` is non-null whenever `complete:false` (`sqlite-record-store.ts:844-845` with `sqlite-text-search.ts:321-322`; in-memory `:623-626`), so the `next === null` stop at RM:857 never truncates.
  - The existence check runs before term validation (MF9, `S4B-memory-anchor-not-found.test.ts:96-100`).
- **(a), 'all':** a scoped 'all' cannot reproduce today's page boundaries.
- **(b)11 option (A):** it breaks M-09 (`S4B-memory-paging.test.ts:108`).
- **Section 3:** a single 'any' call returning the union in refKey order equals today's merge and dedupe (RM:876-905). The bound of 8 terms on the port is correctly flagged.