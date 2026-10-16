# Read model and check: redundancy removal, scoped find and the single 'any' stream (input for the 4B speed round)

Repo: `D:/1.project/Software/agent-next-main/.claude/worktrees/claude-code-task-execution-f3cca6` (HEAD ad2679f3, code equal to 0776b9b6). I only read code; nothing was changed or run. All file:line references point to this tree.

## 0. Facts every proposal depends on

**G1. One read is not one transaction.**
- Every RecordStore call opens its own read transaction (profiling Q1: sqlite-record-store.ts:309-326, :375-411, :580-617, :801-856).
- The six reads take the ledger cursor once, at the start: note-read-model.ts:1134, :1205, :1278, :1329, :1391, :1459. They compare it only with the cursor carried in from the previous page, and never re-check it at the end.
- So one call today already mixes moments: the candidates, the read model's derivation (:330-333) and each item's check, which re-reads the head (note-views.ts:869), all run at different awaits. The check's file reads are real async I/O, so a commit from another request can land mid-call.
- In this report, "identical" means identical whenever no commit lands during the call. That is the only state the cursor protocol describes. Under a concurrent commit, today's output is already an unspecified mix, and the shared caches give a different mix.
- No test and no spec sentence pins intra-call mixing; spec :183 only says file observation is per page and not atomic.

**G2. The first failure ends the call.** `checkNotes` returns at the first failing item (note-views.ts:1010-1011), and the read model does the same (note-read-model.ts:598). So caching a failed outcome for the rest of a call never changes output.

**G3. The comparison text: there should be one function.**
- The index compares `searchTextFrom(body, paths)` (lookup-index.ts:649-656), with paths `['topic','conclusion','body']` (note-record-codecs.ts:666-667).
- The in-memory port uses it at in-memory-record-store.ts:608 and :621. SQLite uses it at sqlite-text-search.ts:226 and :253, and in the recheck (sqlite-record-store.ts:838).
- `decodeNoteHeadSnapshot` returns the parsed record body object itself (note-record-codecs.ts:453, :460). So `searchTextFrom(head, paths)` on a decoded head gives exactly the text the index compares.
- The substring rule is `textSearchMatches` (lookup-index.ts:671-673).
- The read model has a second copy, `segmentsOf(...).all` (note-read-model.ts:689-696). It gives the same value, because U+000A composes with nothing, so NFC cannot cross it, and lowercasing is per code unit. It is still a second function.
- **Proposal:**
  - Export `NOTE_TEXT_PATHS` from note-record-codecs.ts and use it in the registration at :667.
  - Add `noteComparisonText(head) = searchTextFrom(head as unknown as Record<string, unknown>, NOTE_TEXT_PATHS)`.
  - Add `textSearchMatchesAny(text, terms) = terms.some(t => text.includes(t))` beside `textSearchMatches`.
  - Route two's compact table, `segmentsOf.all` and the scoped path in section 2 all call these.

**G4. Sort order.**
- P1 (spec :736) defines the 'any' partial set as the first `cap` matches in refKey order.
- The code merges the per-term streams with `compareText` (UTF-16) on refKeys (note-read-model.ts:886). Each stream itself is in `compareRefKeys` order, i.e. UTF-8 bytes (lookup-index.ts:562-564; in-memory :612).
- A NoteHead refKey is `canonicalJson({aggregateType, noteId, projectId})`, with keys sorted (note-record-codecs.ts:326-328). Within one project, refKey order is the order of the JSON-escaped noteId followed by `"`.
- That equals noteId order, and both comparators agree, when noteIds contain no character ≤ U+0022, no `\`, and no surrogate against U+E000–FFFF. NoteIds come from `randomUUID` (create-platform.ts:1297), in tests as well, because the fixtures go through createPlatform.
- `rankMatches` sorts by noteId (:755), but its slice (:757) never removes anything, because `anyTermHeads` never returns more than `cap` (:903-904).
- **Rule for new code:** to reproduce "refKey order", sort by `compareRefKeys(noteHeadRefKey(head.ref), …)`, not by noteId.

## 1. The redundancy items

### (b)1 A new HeadCache for every item in the check

**Current code**
- `checkOne` creates `const cache = newHeadCache();` (note-views.ts:882) and uses it for `conflictingOf`/`overQuotaOf` (:883-886).
- These go to `cachedHeadsByAnchorKey`/`cachedCurrentHeadsForGoal` (note-read-model.ts:224-242), then to `headsByAnchorKey` (5 index reads, each to the end, :187-199) and `currentHeadsForGoal` (4 state reads, :201-210).

**Change**
- Add `heads: HeadCache` to `CheckCaches` (note-views.ts:140-143). Create it once per `checkNotes` call (:1003) and use `caches.heads` at :882. The key `${projectId}\0${anchorKey}` (:226) uses ctx.projectId, which is fixed for the call.
- Optional seeding, together with (b)3: the read model hands over the anchor sets it has already read, and the check pre-fills `heads.anchors` with `{ok:true, value}`. Sources: memoryLookup :1140, memoryFind :1478 (the unfiltered `heads.value`), memoryStale :1401/:1411, memoryConflicts :1290/:1296, memoryNeighbors :1358, listByAnchor :1087.
- Do not seed the goal map from memoryStale's `headsOnReviewStatus` (:1406): it reads 2 states, while `currentHeadsForGoal` reads 4.

**Why the output stays identical**
- The cached value is the output of the same function on the same ledger state (G1).
- `conflictingOf` only asks whether one matching head exists (:274-286), and `overQuotaOf` counts (:300-301, :310). Neither depends on set order.
- There is precedent: the read model already shares one cache across a page (:594; 4A "item 4 fix 2", :212-216). R2's rule, "one cache set per call; nothing survives the call" (note-views.ts:136-139, :1002), still holds.
- A cached failure ends the call anyway (G2).
- `similarNotes` must not use this cache: it reads one bounded page per index (:833-834), which is a different set.

**Effect (profiling estimate):** lookup on the project anchor goes from 22 set loads to 2 (1 with seeding), about 394 → ~45 ms.

### (b)2 conflicting and overQuota are computed twice

**Current code**
- `itemOfHead` computes both (note-read-model.ts:330-333), and `withCheck` overwrites both (:393-394) whenever there are items (:375).
- Every `itemOfHead` call is followed by `withCheck`: readNote :1063→:1065, listByAnchor :1111→:1115, checkedPage :597→:601.
- `deps.check` is always set (create-platform.ts:1303-1308). Only create-platform.ts imports `createNoteReadModel`, so no test builds the read model without the check.

**Change**
- When `deps.check !== undefined`, `itemOfHead` uses placeholders (false/false) and skips the derivation and the per-page `newHeadCache()` (:594, :1063, :1109).
- Keep today's computation only for `deps.check === undefined`.

**Why the output stays identical**
- On success, both fields are always replaced.
- On failure, the check runs the same derivation (note-views.ts:186-187) on the same reads, so the same mapped code comes back (asOutcome → mapStoreFailure :1011 → withCheck :380-381).
- Only one thing differs: which of two independent faults surfaces first. Today all derivations of a page run before the first check; afterwards, one item's catalog read could fail before the next item's derivation. The code is `unavailable` either way; the reason text differs only if two fault doubles are armed in one call. No test does that.

### (b)3 The check re-reads heads the read model already has

**Current code**
- `checkOne` reads the head again (note-views.ts:869, decode :198).
- The read model already holds them: checkedPage (:592-600), readNote :1060 and :1049, listByAnchor :1107, memoryHistory head :1210, plus every version it read at :1230, which the check reads again at :876.

**Change (the public port stays as it is)**
- Add an internal interface in model/note-contracts.ts next to `NoteCheckPort` (:103-106):
  ```ts
  export interface NoteHeadCheckPort extends NoteCheckPort {
    checkHeads(ctx: CoreCallContext, input: {
      items: { head: NoteHeadSnapshot; version: number; snapshot?: NoteVersionSnapshot }[];
      anchorSets?: ReadonlyMap<string, readonly NoteHeadSnapshot[]> }): Promise<ReadResult<NoteCheckV1[]>>;
  }
  ```
- `createNoteCheck` returns it, and `deps.check` in the read model takes that type. Composition already passes `noteCheck` (create-platform.ts:1307) and exposes only `checkNotes` on `platform.notes` (:1327-1331).
- Supplied heads are trusted, so they must never go through the public `checkNotes` (R16: 4C binds it to the write envelope and to routes).
- `readNote(version)` with `headRead.value === null` falls back to `checkNotes`; today the check answers `not_found` there (:872).

**Why the output stays identical**
- Everything the check takes from the head comes from the same snapshot (G1): the body when the version is the head version (:873), `stagedRunKey` (:874), `isHeadVersion` (:969), `goalId`/`confirmedByUser` (:973-974), and the head given to the derivations (:883, :885).
- Notes are never deleted, so the `not_found` branch at :872 cannot be reached for a head the read model holds.

### (b)4 Repeated parsing (the part in these two files)

- Decodes happen at note-read-model.ts:127, :839 and :894, note-views.ts:198, and similarNotes :837.
- After (b)1–(b)3, each record is decoded once per set load, and set loads drop to one per distinct set.
- Optional per-call memo keyed by `${record.refKey}\0${record.revision}`. It is exact: a head's envelope revision equals its version (note-record-codecs.ts:444-447, :457), and every head change writes a new version (CHANGE_KINDS :94-95).
- The double fetch (recheck SELECT, then readManyInside) is in sqlite-record-store.ts and goes away with route two.

### (b)5 The text query re-runs for every page of 100

The read-model side is `fillStream` (note-read-model.ts:851-861, limit 100 at :854). Nothing needs to change here if route two's port resumes from `after` as a bookmark: the loop then makes one pass per stream in total, and only one stream with section 3.

### (b)6 is handled in section 2. (b)7 (prepared statements, LIMIT re-planning) lives only in sqlite-record-store.ts.

### (b)8 The basis catalog revision is read for every item

**Current code:** each module- or interface-anchored item calls `deps.architecture.readArchitectureRevision({selection:{kind:'revision', …}})` (note-views.ts:580-582). Only the current catalog is cached (:366-380).

**Change**
- Add `caches.architecture.revisions: Map<number, Outcome<ArchitectureRevision>>`, keyed by `body.basis.catalogRevision`.
- The baseline ref comes from the cached current catalog (:368), so it is fixed for the call. If the lead prefers not to rely on that, key by `${canonicalJson(baseline.ref)}\0${rev}`.
- Cache rejects too (G2).

**Why identical:** it is the same request within the same call, and a past revision is stored and does not change.

### (b)9 The Run's task scope is read for every item

**Current code:** `agentRunTaskScope` (note-views.ts:611-631) reads the Run (readMany :613-619) and its bound PlanRevision (:621-627). It is called for every agent-written file-anchored note (:686).

**Change:** `caches.runScopes: Map<string, Outcome<{moduleRef}>>`, keyed by `canonicalJson(runRef)` (:613; the key includes project and goal).

**Why identical:** the result depends only on two records read in the same call.

### (b)10 A goal's plan revisions are read for every stage-anchored item

**Current code:** `planRevisionsOfGoal` (:412-427) is called for each stage anchor (:484). The same pattern exists in `basisPlanByNumber` (:392-406, called at :563).

**Change**
- `caches.planRevisions`, keyed `${projectId}\0${goalId}`.
- A separate `caches.basisPlans`, keyed `${projectId}\0${goalId}\0${n}`.
- Do not merge the two. `basisPlanByNumber` returns at the first match without reading later pages (:401); `planRevisionsOfGoal` reads to the end and the last one wins (:422). Deriving the first from a full list could read a page that fails today's code never reads, and the two pick differently if a number repeats.
- The same caching can apply to `stagedRepairTask` (:802-817) and to the 'note' fact head reads (:717).

### (b)11 lookup checks heads, then drops them: not output-neutral

**Current code:** memoryLookup slices 20 of all anchor heads (:1153), checks all of them (:1155), then drops some by stored state and cross-goal visibility (:1160-1166). `coverage` is computed over the whole checked page (:1184).

**Why it cannot be removed without changing output.** The dropped items:
1. count in `coverage`: R3 (spec :741) says it covers all examined candidates, including the filtered ones, and test S4B-memory-observation.test.ts:49 is named for that rule. Their freshness is only known from the check.
2. spend the per-call file, fact and symbol budgets in page order (note-views.ts:125-131, :147-151). A later listed item can be `unchecked` today only because an earlier dropped item used up the budget.
3. fail the whole lookup if their check fails.

**Options for a lead ruling**
- **(A)** Filter in the candidate set, as stale does (:1414-1415). This changes paging and cursors, and breaks S4B-memory-paging.test.ts:108 (M-09, "all filtered out → empty, complete:false"; spec :183, :643).
- **(B)** Slice as today, skip the check for items that will be dropped, and amend R3 so coverage counts checked items only. Items, next and complete stay the same; coverage and budget order change.

Decision 67's default states for find in 4C need the same rule, so it can be ruled once. After (b)1, most of lookup's cost is already gone, so (b)11 can wait for 4C.

## 2. (a) find with terms and an anchor or pathPrefix

**Today**
- The anchor heads are loaded (:1476-1480) but used only for the existence answer and the no-terms branch (:1517-1518).
- For 'any', every project match of every term is streamed (:869-907), decoded before scoping (:894), then filtered by `headInScope` (:902).
- The cap counts only in-scope matches (:903). So a narrow anchor with a common term reads every match: 197 port pages, 19,609 heads, 15.2 s.

**Change ('any' only)**
```ts
// memoryFind 'any' branch (:1505-1516), after normalizeTerms (:1506) and the port term rule below
const scoped = anchorOnAnchor ?? (pathPrefix !== null ? await headsOnPathPrefix(ctx.projectId, pathPrefix) : null);
// a failed headsOnPathPrefix read → rejected(code, reason), as at :1520-1521
const heads = scoped !== null ? scopedAnyMatches(scoped, scopeInput, terms.value)
  : await anyTermHeads(ctx, scopeInput, terms.value);

function scopedAnyMatches(scoped: readonly NoteHeadSnapshot[], input: MemoryFindRequest, terms: readonly string[]) {
  const matched = scoped.filter(h => headInScope(h, input) && textSearchMatchesAny(noteComparisonText(h), terms))
    .sort((l, r) => compareRefKeys(noteHeadRefKey(l.ref), noteHeadRefKey(r.ref)));
  const partial = matched.length > textSearchCandidateMax;
  return { ok: true, value: { items: partial ? matched.slice(0, textSearchCandidateMax) : matched, partial } };
}
```
- `rankMatches`, the warning, `ranking`, the slice and the cursor stay as they are (:1510-1516, :1539-1543).
- When both anchor and pathPrefix are given, use the anchor set; `headInScope` then applies the prefix (:744-747), as the no-terms branch already does (:1517).

**Why the items are identical (success case).** Let P be the project's current NoteHeads.
- Today's merged stream is {h ∈ P : some term is a substring of cmp(h)}, in refKey order:
  - Each stream returns exactly the substring matches: window candidates are a superset and the recheck is the substring rule (spec :164, rule 11 :566).
  - The port's per-call candidate cap only splits a stream into several calls; `fillStream` loops until the stream is complete (:857).
  - The merge removes duplicates (:900-901).
- The anchor set A = `headsByAnchorKey` = {h ∈ P : the key is in one of h's anchor slots} (:187-199). Its indexes are keyed on `ref.projectId` (note-record-codecs.ts:653-655), the same project bucket as the text index (:666).
- `headInScope` requires the key to be in a slot (:743). So {h ∈ P : headInScope} = {h ∈ A : headInScope}.
- For pathPrefix: `headsOnPathPrefix` returns exactly the heads that have a slot on the directory boundary (:509-532; covered by the MF6a/MF6b tests), which is the same predicate `headInScope` applies.
- cmp is the same function on the same object (G3), and the order is the same (G4).
- So the sequence of in-scope matches, its first `cap` entries and `partial` are identical. U (spec :162: notes left after all non-text filters, matching at least one term), df, scores, order, page, noteId cursor, `ranking`, `warnings`, `complete` (:1557) and the 48 KiB trim all follow.
- The existence check still runs before term validation, so MF9 (S4B-memory-anchor-not-found.test.ts:96-100) still answers `anchor_not_found`.

**The port's term rule must be copied, or output changes.**
- `normalizeTerms` rejects `/\s/` (:715). The port rejects `\p{White_Space}` (lookup-index.ts:620, :740-742).
- U+0085 (NEL) is White_Space but not `\s`. Today an 'any' term containing it passes the read model, and the port answers `invalid` "a text search term must not contain whitespace" (through searchPage → asOutcome, :814-816).
- Fix: factor the per-term checks of `decodeTextSearchRequest` (:729-744) into an exported `textSearchTermProblem(term)`, and call it for each term, in order, on the scoped path.
- The length bounds are equal on both sides (note-contracts.ts:44-45; lookup-ports.ts:99-100). For 'any', the port never checks the term count, because each call carries one term.

**Flag: failure cases change.** The scoped path never touches the text index. For anchor or pathPrefix plus terms, these no longer surface:
- `unsupported` (no FTS5). The only test, S4B-memory-unsupported.test.ts:19-36, has no anchor, so it still passes.
- `index_not_ready` (spec :737, :167).
- Store failures inside `searchText`.
- `unavailable` "damaged note head" for a damaged matching head outside the scope (today it is decoded before scoping, :894-895).

Success results are identical. The lead either accepts this (my recommendation: the answer comes from the heads themselves) or asks for a readiness probe.

**Cost**
- Anchor: no new reads, since the set is already loaded for the existence check. About 279 comparison texts and includes, under 1 ms. Estimate: 15.2 s → ~0.1 s plus the checked page.
- pathPrefix: one new read (5 ordered range scans plus decoding every head under the prefix). For a very broad prefix with a rare term, the plain scan would be cheaper. Results are the same either way, so this is purely a cost choice; decision 66 says to use the path heads.

**'all' with an anchor or pathPrefix cannot be made identical.**
- Under R7/P1 (spec :736; :821-847, :1490-1502), each 'all' page is one port call of `limit` project-wide matches, filtered to the in-scope ones. Page boundaries and `next` are defined by project-wide matches, so reproducing them needs the project-wide scan.
- A scoped 'all' (the scoped heads ∩ all terms, in refKey order, `limit` per page, cursor = last NoteHead refKey, so the afterOf at :1499-1500 still works) returns the same items in the same order over the whole paging sequence. Page boundaries, `next` values and the number of pages change.
- That is a contract change to the 'all' sentence of P1/R7. If made, bump RULE_VERSION (:444) so old cursors give `cursor_mismatch`. Otherwise leave 'all' as it is; route two makes each page cheap.

## 3. (b) 'any' as one port call with match: 'any'

**Same items.** With route two, the port scans in refKey order. An 'any' scan returns the union of the per-term streams, in refKey order, each head once. That is exactly what today's merge and dedupe produce (:876-905), given that the two comparators agree (G4).

**Read model after the change**
- It keeps `headInScope`, the cap+1 → partial rule and `rankMatches`.
- It loops `searchPage(…, match: 'any', limit 100, after = page.next)` until it has cap+1 in-scope matches or the scan completes, keeping the `next === after` guard (:857).
- This removes TermStream, fillStream and the merge (:849-907), and the repeated fetch of heads that match several terms (分支 case: 604 refKeys fetched for 301 matches).

**Spec changes**
- §2 `TextSearchRequest` (spec :486-487; lookup-ports.ts:108) gains `match?: 'all' | 'any'`, defaulting to 'all' so existing callers keep their meaning.
- §10 P1 (:736): rewrite "全文端口只做'与'", "TextSearchRequest/TextSearchPage 照 §2 不加字段" and "每个词各查一次端口再合并".
- T-07 and T-09 stay NE3 rows; NE2 (:592) gains 'any' port rows.
- Update the R7/should-fix comment at :863-868.
- Do this together with route two (one scan implementation), not on FTS5.

**Flag:** the port's term-count bound (lookup-index.ts:723-727, 8 terms) now also applies to 'any'. The read model's injectable `textSearchMaxTerms` (:443) could be set above it. Both default to 8, and no test injects it (only plumbing at tests/helpers/S4B-note-check-fixture.ts:140 and S4A-note-fixture.ts:50). Clamp it to the port's bound or document the limit.

## 4. (c) Tests

### Existing coverage

| Change | Tests that cover it | Gap |
|---|---|---|
| (b)1, (b)2 | S4B-note-conflicts.test.ts:18; S4B-memory-conflicts-read.test.ts:17, :33; S4A-note-caps.test.ts:50 (N-07); the 4A N-06 tests | All use one or two items per call; none would catch a wrong cache key or a leak between items |
| (b)3 | S4B-note-check-head-version.test.ts:18 (public `checkNotes`); S4B-memory-history.test.ts:24, :89; S4B-memory-current-filter.test.ts:31; S4B-memory-l12-bounds.test.ts:173, :189; S4B-note-invalid.test.ts:62, :76 | — |
| (b)8–(b)10 | S4B-note-definitions.test.ts:96; S4B-note-hints.test.ts:80, :95, :110; S4B-note-anchor-goals.test.ts:52, :77; S4B-note-check-isolation.test.ts | All single-item per call |
| (b)11 | S4B-memory-paging.test.ts:108; S4B-memory-observation.test.ts:49; S4B-memory-current-filter.test.ts:31 | — |
| (a) | S4B-memory-anchor-not-found.test.ts:81, :104; S4B-memory-find-stale.test.ts:40, :54, :100, :126, :159 (no terms); S4B-memory-ranking.test.ts:26, :207, :231 (no anchor) | No test combines terms with an anchor or prefix, except the empty case at :104 |
| (b) | T-07 (S4B-memory-ranking.test.ts:26: overlapping terms test the dedupe); T-09 (:207, :231); the NE2 port tests | — |

### New tests

All run on both backends, through the public ports, with expected values from the spec or hand-computed.

- **N1 — (b)1–(b)3.** One anchor with about 8 notes, `anchorQuota` injected as 2:
  - a same-topic pair with no relation (both `conflicting`);
  - a contradicts pair;
  - a superseded note (not conflicting);
  - every current general note `overQuota`.

  Assert per item through `memoryLookup` (limit 20) and through one `checkNotes` call with all items. Also assert that the one-call result equals separate per-item calls; this passes before and after the change.
- **N2 — (b)1, goal sets.** `stale` by goal with a small injected `goalQuota` and several items on one page; check each item's `overQuota`.
- **N3 — (b)8.** On one page, two module-anchored notes written at different catalog revisions, with the module definition changed in between: only the older one is `module_definition_changed`.
- **N4 — (b)9.** Two agent notes from two Runs with different task module scopes: only one gets `file_module_mismatch`.
- **N5 — (b)10.** Stage-anchored notes on two goals (`createS4BExtraGoal`), with the stage removed in one goal: only that note is `stage_not_in_current_plan`.
- **N6 — (a), ranking.** T-07 on an anchor, plus off-anchor notes that contain the same terms: the scores are still 3.9120 / 2.3026 / 0.6931, order n1, n2, n3.
- **N7 — (a), cap.** Anchor + common term with `textSearchCandidateMax: 2`, three matches on the anchor and three elsewhere: the first two of the anchor's ids in sorted order, `partial`, the warning, `complete:false`; then limit-1 paging as in T-09 (:231).
- **N8 — (a), prefix.** pathPrefix + term, matching main and extra slots, with the src/a-b and src/ab siblings excluded. Also anchor + prefix + term combined with AND, giving an empty, complete result.
- **N9 — (a), whitespace rule.** A term containing U+0085 in an anchor find returns `invalid` with the same reason as the same term without an anchor.
- **N10 — (a), "reads only the anchor's notes".** This cannot be seen through the public port on success.
  - While FTS5 exists: the SQLite `fullTextUnavailable` fixture (tests/helpers/S4B-note-check-fixture.ts:104-106), where anchor + terms → ready. This pins the flagged failure-case change, so it needs the lead's ruling first.
  - After route two: a fault double that fails `searchText`. That is a new §7 test exception for the lead to approve.
  - Plus the 15 s case in the speed-round evidence, as a measurement rather than a test.
- **N11 — (b).** NE2 rows for 'any': union of terms, byte order, a record matching two terms appears once, resume from `after`, the per-call cap → `complete:false` with `next`.
- **N12 — only if (b)11 is ruled.** Under option (B): coverage counts only checked items, and a dropped head before a listed one no longer spends a `readFilesMax: 1` budget.
- **N13 — only if scoped 'all' is ruled.** Pages are full, the last page is complete, the union over pages equals the in-scope matches in refKey order, and an old cursor gives `cursor_mismatch` after the RULE_VERSION bump.

## 5. Observable changes

1. **(b)11:** coverage, budget order and failure propagation change; under option (A), paging changes too and M-09 (:108) breaks.
2. **(a):** anchor or prefix plus terms no longer return `unsupported`, `index_not_ready`, text-port store failures, or a damaged out-of-scope head as `unavailable`.
3. **(a):** U+0085 terms change, unless `textSearchTermProblem` is applied.
4. **Scoped 'all':** page boundaries and `next` change.
5. **(b):** the port contract changes, and an injected `textSearchMaxTerms` above 8 would newly be rejected.
6. **Concurrent commits only:** (b)1, (b)3 and seeding give a different mix than today (G1).
7. **(b)2:** the reason text can differ when two independent faults are armed in one call.
8. **(b)10:** output changes only if the two plan caches are merged; keep them separate.

Everything else is identical on both backends: items, order, cursors and their binding to caller, request, rule version and record cursor, `revision_conflict` on a write between pages, `complete`/`partial`/`ranking`, warnings, the 48 KiB behaviour, and `unavailable` for read failures. This covers (b)1–(b)4, (b)8–(b)10, (a) for 'any', and (b), apart from flags 3, 5, 6 and 7.