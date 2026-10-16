# Slice 4B — note search and freshness (TDD)

## FILES CHANGED

**Production (L-scope):**
- `src/core/record-store/lookup-ports.ts` — `RecordLookupIndex.text`, `TextSearchRequest/Page`, `RecordTextSearchPort`, record-store bounds (P14).
- `src/core/record-store/lookup-index.ts` — `text` registration; `normalizeSearchText`, `bigramWindows`, `searchTextFrom`, `textSearchMatches`, `decodeTextSearchRequest`.
- `src/core/record-store/in-memory-record-store.ts` — `searchText` (window-superset candidates, refKey order, cap).
- `src/core/record-store/sqlite-record-store.ts` — `fullTextProbe` option, FTS wiring, `searchText`.
- **new** `src/core/record-store/sqlite-text-search.ts` — FTS5 probe, code table `next_fts_meta`, drop+rebuild, transactional `indexRecord`, window-AND candidates. `migrations.ts` untouched (P5).
- `src/core/work-graph/model/note-contracts.ts` — `NoteCheckPort`, memory types (`NoteMemoryReadPort`, six requests/results, `UnderstandingStatusV1` with `updateDue: boolean|null`, `VersionListPageV1`), all 4B constants.
- `src/core/work-graph/notes/note-read-model.ts` — six memory reads, L12 cursors/limits/48 KiB bound, current filter, `'any'` ranking, body paging, coverage; check injection.
- **new** `src/core/work-graph/notes/note-version-lists.ts` — `createVersionLists` (`listPlanVersions`/`listCatalogVersions`).
- **new** `src/core/work-graph/views/note-views.ts` — `createNoteCheck` (L9/L11/L22/L23, hints, symbol recheck, `similarNotes`).
- `src/core/work-graph/persistence/note-record-codecs.ts` — `NoteHead` full-text registration + five ordered `anchorKeyN` indexes (P7).
- `src/core/work-graph/architecture/catalog-record-codecs.ts` — catalog revision sort index.
- `src/composition/create-platform.ts` — injects `createNoteCheck`, exposes the six memory reads + both version lists on the non-enumerable `notes` holder.

**Tests:** 19 new `S4B-*.test.ts` (record-store 1 + work-graph 18) and 3 `tests/helpers/S4B-*.ts`; `tests/architecture/production-reach-allowlist.json` (one 4B `kept-for` entry). No existing test file changed; no `docs/`.

## PER ROW

| Row | Test name(s) → impl `file:symbol` | R/G |
|---|---|---|
| T-01 | `T-01 %s: a two-codepoint Chinese term…/spanning the middle…/at the end…/window candidates whose substring is absent are checked out` → `lookup-index.ts:normalizeSearchText/bigramWindows/searchTextFrom` + both `searchText` | RED (no `searchText`) → GREEN ×8 |
| T-02 | `T-02 %s:` 8 cases (case, camelCase fragments, hyphen, NFC composed/decomposed) → `normalizeSearchText` | RED 8 → GREEN 20 |
| T-03 | `T-03 %s:` 14 cases (1/65 cp, whitespace, 9/empty terms, 2/64 edges, limit, values, after, unknown/non-text index) → `decodeTextSearchRequest` | RED 10 → GREEN 32 |
| T-04 | `T-04 %s: the old term…/the new term…/a withdrawn head…/an updated head…` → `sqlite-text-search.ts:indexRecord` + body recheck | RED 1 duplicate → GREEN 40 |
| T-05 | `T-05 %s:` paging, `T-05 %s: an injected small candidate cap…` (3), `T-05 both: …same records/next/complete`, `…agree page by page` → both backends' `searchText` | RED (cap basis diverged) → GREEN |
| T-06 | `T-06 sqlite: reopening…/without then with it rebuilds…/a changed text registration rebuilds…/an unavailable FTS5 probe answers unsupported` → `sqlite-text-search.ts` + `fullTextProbe` | RED 3 → GREEN 51 |
| T-07 | `T-07 the three notes score 3.9120, 2.3026, 0.6931 and order n1, n2, n3` → `note-read-model.ts:memoryFind/rankMatches` | GREEN (RED pre-impl) |
| T-08 | `T-08 %s: two terms select only the record containing both/several both-term records stay in refKey byte order` → `lookup-index.ts:textSearchMatches` | RED (`.some`→`.every`) → GREEN |
| T-09 | `T-09 a match set over the injected candidate cap returns ranking partial and complete false` → `rankMatches` + `TEXT_SEARCH_CANDIDATE_MAX` | RED (`complete:true`) → GREEN |
| M-01 | `M-01 a changed basis file…` / `a deleted basis file…` / `memoryStale lists a changed note and not the fresh one` → `note-views.ts:createNoteCheck` + `note-read-model.ts:observeNoteFiles` | GREEN |
| M-02 | `M-02 a task definition changed…` / `a module definition changed…` / `an adopted new plan revision…plan_changed` / `a failed plan read…unavailable` → `createNoteCheck:definitionStaleness` + `basisPlanByNumber` | RED (`unchecked`) → GREEN |
| M-03 | `M-03 the item containing the 257th distinct basis file is unchecked` + `…>256 files reports one unchecked item and 256 files read` → `observeNoteFiles`/`newNoteReadBudget`/`coverageOf` | RED → GREEN |
| M-04 | `M-04 a superseded basis-note head makes the note stale for basis_note_retired` → `createNoteCheck` fact `note` | GREEN |
| M-05 | `M-05 an unreadable message fact is sourceUnavailable and the note is still returned` → `createNoteCheck` record branch | GREEN |
| M-06 | `M-06 a staged repair whose own Run task was cancelled is invalid` + `…stays valid when only a different anchored task was cancelled` → `createNoteCheck`/`stagedRepairTask` (`stagedRunKey`) | RED (`busy`) → GREEN |
| M-07 | `M-07 both notes of an accepted contradiction are conflicting` + `memoryConflicts by note/anchor lists both sides` → `createNoteHeadDerivations` + `memoryConflicts` | RED (assumed `pending_review`) → GREEN |
| M-08 | `M-08 lookup keeps the current notes, hides stale and cross-goal accepted-only ones, and orders the tiers` → `memoryLookup`/`checkedPage`/`isCrossGoal` | RED (fixture) → GREEN |
| M-09 | `M-09` 20+5 paging, mid-page write `revision_conflict`, `cursor_mismatch`, 中×1000 body 682+318, empty `complete:false`, prefix-boundary/goal-slot; `L12` 48 KiB, cursor identity, limit default/cap → `sliceByCursor`/`bodyPageOf`/`parseMemoryCursor`/`resolveMemoryLimit`/`fitToByteBound` | GREEN (several RED) |
| M-10 | `M-10 three plan versions…/the plan version list pages…/two catalog versions…/history items carry each version change and since` → `note-version-lists.ts:createVersionLists` + `memoryHistory` | RED (initial reason) → GREEN |
| M-11 | `M-11 a file past the size limit is unchecked with outcome capacity` + `…digest differs is changed, not unresolved` → `observeNoteFiles`/`resolveFact` | GREEN |
| M-12 | **not built** (P3) — see 4C 联动补验 | — |
| M-13 | `M-13 a candidate with a 10/11 window overlap is listed and an unrelated one is not` + `at most three candidates…ties by noteId` → `note-views.ts:similarNotes` (P12) | GREEN |
| M-14 | `M-14` commit→`uncheckedFacts`, 257 facts, `invalid_commit_format`, `version_ahead`, `not_found`, read fault→`unavailable`, `deleted_path_unverified`, `basis_outside_anchor`, `file_module_mismatch` → `createNoteCheck` facts/`classFiveHints` | GREEN (some RED) |
| M-15 | `M-15 an interface removed…/a retired extra anchor…/a task cancelled by an adopted plan…/symbol_missing/hits cap/recheck budget/failed catalog read→unavailable` → `anchorStatusOf`; `M-15 a module removed…` **skipped** | RED (hits cap, budget) → GREEN |
| M-16 | `M-16 a missing module anchor with no head is not_found anchor_not_found` + `an existing anchor with no notes is an empty complete page`; `M-16 a module that is gone but still has heads…` **skipped** → `memoryLookup` candidate selection | GREEN |

## NOT BUILT / DEFERRED

- **4C 联动补验:** **M-12** (`UnderstandingStatusV1.updateDue`) — P3 defines the triggers and `latestTriggerCursor` in the 4C book; 4B returns `updateDue: null` / `latestTriggerCursor: null` everywhere (L9, §2).
- **Blocked by current code (not deferred):** M-15 `module_removed` and M-16's "module gone but heads retired" are `it.skip`: `reviseArchitectureCatalog` rejects any module ref absent from the revised catalog (`catalog-service.ts:671-673`) and `adoptInitialArchitecture` refuses a project with an active baseline. M-02's "module removed" sub-case has the same blocker (the "definition changed" sub-case passes).
- **Fixture-scope gap:** M-07's same-topic-race half (N-14) is not tested on the read path — the interleaved-commit double lives in `tests/helpers/S4A-note-fixture.ts`, outside the 4B L-scope; `memoryLookup`/`memoryConflicts` already report both sides `conflicting` when two current same-topic notes exist.
- **Untested but implemented:** M-11 read-side `forbidden`/`unavailable` and write-side `basis_file_missing`/workspace-unavailable (4A covers the write shape; the needed doubles are spec-§7-limited), M-14 `kind_mismatch` (no public construction) and `forbidden`, M-15 "satisfied task stays live", G3 fixes (d) bounded `similarNotes` page, (f) damaged-record `unavailable`, (h) `topicKey` weight (not observable for whitespace-free terms).

## REVIEWERS' FINDINGS

- **G1:** BLOCKER — the two backends' 1000-candidate budget used different candidate sets (memory prefix bucket vs SQLite FTS windows), violating §4 r6; fixed to the same window-superset basis + a >1000 cross-backend test. Also: open-rebuild `continue` on a bad snapshot (now throws), injectable candidate cap, NFC and invalid-input tests, temp-dir leak.
- **G2:** BLOCKER — failed plan/catalog reads collapsed to `null` → `fresh`/`currentEligible:true`; now the whole check/read returns `unavailable`. Also: all three class-5 hints, `NOTE_SYMBOL_HITS_MAX` vs recheck budget, symbol rechecks charged to `NOTE_READ_FILES_MAX`, M-06 now keyed on the staged Run's task. Follow-up closed the skipped M-02/M-06/M-15 rows via real v2 plan adoption.
- **G3:** 48 KiB bound, cursor identity binding, default/cap `limit`, bounded `similarNotes`, per-revision catalog `at`, undecodable Goal/proposal → `unavailable`, own-goal `currentEligible`, `weightOf` uses stored `topicKey`; extra M-09 boundary/goal-slot tests.
- **Final pass:** PASS, no BLOCKER; removed the unused `NOTE_BODY_PAGE_MAX_BYTES` import and sharpened the one allowlist note.

## CHECKS

- `npm run typecheck` → exit 0 (both tsconfigs).
- `npm run check:architecture` → `next source boundaries: OK`.
- `npm run build` → success (workbench published).
- `node scripts/build-kernel-patch.mjs --check` → exit 0, all hashes match.
- 4B tests `npx vitest run tests/record-store/S4B-text-search.test.ts tests/work-graph/S4B-*.test.ts --maxWorkers=4` → **19 files, 141 passed, 2 skipped**.
- `tests/work-graph/S4A-*.test.ts` + `tests/composition/platform.test.ts` → **204 passed**.
- `tests/architecture/production-reach.test.ts` → **4 passed**; allowlist holds exactly one 4B `kept-for` entry (`NOTE_BODY_PAGE_MAX_BYTES`, note names its 4C reader).
- Full suite once (`npx vitest run --maxWorkers=4`) → **55 files failed / 403 passed (458); 195 failed / 7244 passed / 31 skipped (7470)**. Vs `DSH-BASELINE.md` §A (154): 42 extras are exactly the §B bwrap/systemd files; the 1 remaining non-§B extra is `A8-3n (closing unsupported; … K L7 …)`, which fails on `ENOENT … /usr/bin/bwrap` and whose §A entry carries a stale name (`K L8` — the source test is `K L7`, `A8-host-restart-paused.test.ts:396`). Two §A entries passed this run (`2B-09 a cancelled command that changed nothing`; the stale `K L8` name). **No new failures outside §A/§B.** All `S4B`/`S4A` files passed in the full suite (0 failures).
- `git status --short --untracked-files=all` → exactly the L-scope files above; `.dsh-scratch/` deleted.

## UNSPECIFIED

1. _M-16 / L12:_ `not_found` should carry `anchorCandidates`, but `ReadResult`/`CoreRejection` (`src/contracts/core/results.ts:18`) has no field and `src/contracts/` is out of L-scope → returns code/reason only.
2. _M-10 / L19 / §2 `VersionListPageV1` / P2:_ no per-revision catalog time and no record links a revision to its event, so `at` is the revision's stable `refKey`, not a time.
3. _M-10 / L19:_ the accepted `PlanRevisionSnapshot` has no reason; reasons are matched by `draft.planId` over accepted proposals, and the initial adoption (`basedOn:null`) is `没有记下原因`.
4. _L9/L11:_ mixed `unchecked` + `stale` priority not ordered → chose `unchecked > stale`.
5. _L9:_ `unresolvedFacts` implies `freshness:'unchecked'` and `currentEligible:false`; L9's `currentEligible` list does not mention it.
6. _§2 line 360 / L11:_ file `staleReasons` codes `file_changed`/`file_deleted` are not in the spec's reason list.
7. _P9 / L22 (§9 stop condition):_ `views` has no existing reader for `artifact`/`kernel_history` fact kinds → they are recorded in `uncheckedFacts`; no new index or store port added.
8. _P5 / L10:_ `index_not_ready` is unobservable — the rebuild is synchronous at open ("before the store answers").
9. _L23:_ `symbol_signature_changed` is effectively unreachable through public files — the stored digest hashes the source-query name span, so declaration edits cannot change it.
10. _P8:_ `listPlanVersions`/`listCatalogVersions` reject `limit > 50` as `invalid` ("at most 50 per page" does not say reject vs cap); memory reads cap at 100.
11. _L9/L22:_ `currentEligible` for a historical version is derived from the head's goal/confirmation; the spec does not say whether a versioned read should use the version's own state.
12. _L9:_ `crossGoal` is computed from the caller's `work_run` goal; a project-level note (`goalId:null`) read from a goal is `crossGoal` by the literal rule.

## NOTES

- **Regrouping (as announced in the block):** G2's M-16 and M-03's `coverage` half moved to G3 because they need `memoryLookup`/`memoryStale`; G2 kept M-03's `unchecked` half and M-07's per-item `conflicting` half. G1∥G2 ran concurrently on disjoint files; G3 after both. T-07/T-09 are NE3 as P13 says.
- **Sizes:** G1 = 7 rows / 80 tests (one file); G2 = 10 rows / 16 files, 32 tests; G3 = 9 rows / 12 files, ~110 tests. Total 4B: 19 test files, 143 tests (2 skipped).
- **Construction notes:** FTS code stored in the new `next_fts_meta` table (P5 choice); the read-model's own `TEXT_SEARCH_*`/`NOTE_TEXT_TERM_*` constants live in `model/note-contracts.ts` while the port's own bounds live in `lookup-ports.ts` (P14). `createNoteCheck` is the one L22 implementation, injected from the composition root; `renderNoteHeader` became production-reached via `views/note-views.ts`, so its old allowlist entry was removed.
- The MEMORY-LOOKUP §1 scale measurement (20,000 notes / 100,000 versions) is the lead's acceptance task (spec §7), not done here.