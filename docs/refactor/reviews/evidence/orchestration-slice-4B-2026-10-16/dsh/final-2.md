All work is done and verified. Final reply follows.

## FILES CHANGED

**Production (L-scope):**
- `src/core/record-store/sqlite-text-search.ts`, `sqlite-record-store.ts`, `record-codec.ts` — MF8/R8
- `src/core/work-graph/views/note-views.ts` — MF1–MF5, MF13, R1–R5/R13
- `src/core/work-graph/model/note-contracts.ts` — `NoteCheckV1.observedFiles`, `invalid_file_digest`, `NoteMemoryReadResult`/`NoteAnchorNotFoundV1`, `VersionListPageV1.at: string | null`
- `src/core/work-graph/notes/note-read-model.ts` — MF3-read, MF6a/b, MF7a/b, should-fix, MF9–MF12
- `src/core/work-graph/notes/note-service.ts` — R15 only
- `src/core/work-graph/notes/note-version-lists.ts` — MF14
- `src/composition/create-platform.ts` — `checkNotes` on the holder, widened `noteLimits`, `artifacts` injection
- `tests/helpers/S4A-note-fixture.ts` — R16's single additive option-forwarding change

**Tests:** modified `S4B-text-search.test.ts` + 12 work-graph S4B tests; new `tests/helpers/S4B-note-multi-scope-fixture.ts` and 11 new `S4B-*.test.ts` (facts, check-observation, symbol-recheck, anchor-goals, check-isolation, memory-anchor-not-found, memory-history, memory-observation, memory-unsupported, note-basis-path, note-missing-flows).

## PER ITEM (test(s) → impl file:symbol; RED/GREEN one line)

- **MF1 / R1** — `MF1 %s: a record pointer above the current revision is version_ahead / …at the current revision resolves untouched / …a stored artifact resolves and an absent one is not_found / …a kernel-history locator resolves positions within the observed range / …a file fact needs a 64-hex digest and an in-workspace path` → `note-views.ts:resolveFact` + `NoteCheckDependencies.artifacts`, `note-contracts.ts` reason union, `create-platform.ts` (artifacts). RED 8F/2P → GREEN 10/10.
- **MF2 / R2** — `MF2 %s: overlapping catalog reads keep each project's own anchor status / …overlapping plan reads keep each project's own task state` → `note-views.ts:CheckCaches/newCheckCaches/currentPlan/currentArchitecture`. RED 4F → GREEN 4/4.
- **MF3 check half / R3** — `MF3 %s: observedFiles carries the basis observation / …one per-call budget makes the later basis file unchecked / …a file fact past the budget is unchecked and item-ineligible` → `note-contracts.ts:NoteCheckV1.observedFiles`, `note-views.ts:newCheckBudget/readPathOnce/observationFor/checkOne`. RED 6F → GREEN 6/6.
- **MF4 / R4** — `MF4 %s: a line inserted above the symbol keeps it live / …a capped symbol scan is unchecked, not symbol_missing / …two same-name hits use the hit at the stored range / …a renamed symbol is still symbol_missing` → `note-views.ts:recheckSymbol`. RED 4F/4P → GREEN 8/8.
- **MF5 / R5** — `MF5 %s: another goal's live task is not reported retired / …cancelled task is reported retired / …a stage removed in an intermediate revision stays retired after reuse / …a stage kept in every revision stays live` → `note-views.ts:planRevisionsOfGoal/anchorStatusOf` + `S4B-note-multi-scope-fixture.ts`. RED 8F → GREEN 8/8.
- **MF13 / R13** — 7 `MF13 %s:` rows + 1 skip → `note-views.ts:CheckBody.source/agentRunTaskScope/hasDeletionProof/classFiveHints`. RED 12F/4P → GREEN 16/16+1 skip.
- **MF6a / R6** — `MF6a %s: memoryFind by prefix src/a keeps a nested file though siblings sort before it` → `note-read-model.ts:headsOnPathPrefix`. RED (sibling truncated the scan) → GREEN both backends.
- **MF6b / R6** — `MF6b %s: memoryFind ANDs a supplied anchor and pathPrefix / …memoryStale ANDs a supplied goal and anchor / …a trailing slash on pathPrefix is stripped / …an empty pathPrefix is invalid path_prefix_empty` → `headInScope`, `memoryFind`, `memoryStale`. RED on both fixes → GREEN.
- **MF7a / R7** — `MF7a %s: all matching notes come back in byte order with the full ln-2 score / …limit 1 pages the three all-matches / …an all-match page trimmed by the byte bound resumes from the port refKey / …a filtered record inside a port page does not drop later matches` → `allTermHeads/rankAll/searchPage/memoryFind`. RED both backend fixes → GREEN.
- **MF7b / R7** — `MF7b a term search is unsupported and a no-terms find is still ready` → `searchPage` passes `unsupported` through; `S4B-note-check-fixture.ts:fullTextUnavailable` (existing store input). RED (`unavailable`) → GREEN.
- **should-fix / R7** — `T-09 %s: a match set over the injected candidate cap returns the first two sorted ids as partial / …limit 1 paging keeps the partial ranking` → `anyTermHeads/fillStream/rankMatches`. RED → GREEN.
- **MF8 / R8** — `T-06 sqlite: a write made while the index was unregistered is rebuilt from the heads / …a write made while FTS5 was unavailable is rebuilt when it returns / …an index that falls behind an open store answers unavailable index_not_ready` → `sqlite-text-search.ts:createSqliteTextSearch/advanceThrough/isCurrent`, `sqlite-record-store.ts:commitInsideTransaction/searchText`. RED 2F/1F → GREEN 83/83.
- **MF9 / R9** — `M-08 lookup lists the stale note too…`, `MF9 %s: lookup of a deleted file anchor lists the retired head / …missing module anchor carries the module candidates / …missing file anchor carries the path candidates / …conflicts and find check the anchor independently` → `note-contracts.ts:NoteMemoryReadResult/NoteAnchorNotFoundV1`, `note-read-model.ts:anchorNotFound/anchorExistsNow/memoryLookup/memoryConflicts/memoryFind`. RED (pre-existing M-08 3-vs-4) → GREEN 11/11.
- **MF10 / R10** — `MF10 %s: an unpinned body cursor after a review is a revision_conflict / …a body cursor from another caller is cursor_mismatch / …a history body cursor cannot be replayed on lookup` → `principalProjection/callerIdentityOf`, `encode/parseMemoryCursor`, `isUtf8Boundary`, `bodyPageOf`. GREEN both backends.
- **MF11 / R11** — `MF11 %s: a historical accepted version is not current… / …body attaches only to the item whose noteId and version match / …a body target not on the page warns / …neighbors of a missing version is not_found / …history checks only the page` → `withCheck` head map, `memoryHistory`, `memoryNeighbors`, `readNote`. GREEN.
- **MF12 / R12** — `MF12 %s: each page keeps one item and its own four observed files, under the bound / …a single item over the bound comes back alone with result_over_byte_bound` → `fitToByteBound` (recompute basis+coverage per trim). RED → GREEN.
- **MF14 / R14** — `M-10 three plan versions list newest first with each recorded reason / …two catalog versions list newest first with the 8A reason label` (+ a recorded `it.skip` for the non-constructible no-reason half) → `note-version-lists.ts:planReasons/listPlanVersions/listCatalogVersions`, `note-contracts.ts:at`. RED (catalog `at` was refKey, initial reason null) → GREEN.
- **MF15 / R16** — `M-07 %s: two interleaved same-topic writes are both conflicting`, `M-11 write: missing / .env / workspace-unavailable`, `M-11 %s: an unavailable workspace marks the item unchecked`, `M-14 %s: a denied file fact is unresolved forbidden`, `M-15 a task satisfied through the real completion path is live` → real `platform.notes` holder; `note-views.ts:resolveFact/anchorStatusOf`; interleave fixture unchanged. GREEN (the write gates already correct); M-15 first attempt RED on missing bwrap → hand-built S2C-L observation GREEN.
- **MF3 read half** — `MF3 %s: the later item of a page is unchecked when the check budget covers only the first item / …lookup coverage counts the examined candidates before the read filter` → `note-read-model.ts:withCheck/checkedPage/coverageOf/filesReadOf`; removed `observeNoteFiles`/`newNoteReadBudget`. Part of G3's coherent pass.
- **R15** — `R15 %s: a ../ basis path is invalid/basis_file_forbidden` → `note-service.ts` `isSafeRelativePath` guard. RED both backends → GREEN.

## NOT BUILT / SKIPPED (sanctioned)
- R13's `counted` RunActivity deletion-proof case: `it.skip` — no public seam builds a `counted` RunActivity without a real kernel run end (R13 allows).
- Module-removal M-15 / M-16 cases stay skipped; catalog guard not weakened.
- R14's M-10 "old version without a recorded reason" half: not constructible through public services → `it.skip` recording it.
- `symbol_signature_changed` remains unreachable (name-span digest); `kernel_history` `kind_mismatch` implemented, no public seam to cover.

## REVIEWERS' FINDINGS
- **G0/G1:** clean (no BLOCKER/should-fix).
- **G2:** BLOCKER — `basis_outside_anchor` ignored file anchors' attributed modules → fixed (`classFiveHints`) with both-backends rows; should-fix — `recheckSymbol` `hitsMax<=0` could report `symbol_missing` → guarded to `unchecked`; tightened the root-`.` attribution test.
- **G3:** BLOCKER — `'all'` byte-trim cursor lost the port refKey → fixed via branch-specific `afterOf`; should-fix — R6 `pathPrefix` normalization (strip one trailing `/`, empty → `invalid`/`path_prefix_empty`) missing → added; T-07 now both backends.
- **G4:** clean (4 notes; fixed the stale header and recorded the R14 non-constructible half; left the literal `at` comparison and memory-only write gates, reported below).
- **Final whole-slice:** BLOCKER — untrimmed `match:'all'` stopped mid-port-page returned `page.next`, dropping matches → fixed with `lastExamined` + a filtered both-backends test; stale comment fixed; M-11 write coverage left memory-only (write gates are backend-independent) — noted.

## CHECKS
- `npm run typecheck` → exit 0.
- `npm run check:architecture` → `next source boundaries: OK`.
- `npm run build` → exit 0 (workbench published).
- `node scripts/build-kernel-patch.mjs --check` → exit 0.
- S4B + all `tests/work-graph/S4A-*.test.ts` + `tests/composition/platform.test.ts` → **38 files, 474 passed, 4 skipped**; production-reach 4/4.
- Full suite once (`--maxWorkers=4`) → **55 files failed / 414 passed; 195 failed / 7375 passed / 33 skipped**. vs `DSH-BASELINE.md` §A (154) + §B (6 files): **no new failures**. The 3 apparent extras are the known §A stale name `A8-3n … K L8` (source is `K L7`) and two §A names containing inner backticks (`A8-H4`, `GOAL-29`) mis-parsed; 4 §A entries passed (2B-09 and those three variants). Fail counts equal round 1's (55 files / 195 tests); +131 new passing tests are this slice's.
- `git status --short --untracked-files=all` → 35 files, all in the L-scope (9 production + R16's S4A helper + S4B helpers/tests); `./.dsh-scratch/` deleted.

## UNSPECIFIED
1. R7 "`'all'` carries no `ranking` field" vs MF7a literal `ranking:'full'`: kept `'full'` (matches the item and `complete` formula).
2. R3 vs R12 coverage: pre-trim counts filter-dropped examined candidates; after the 48 KiB trim it recomputes over returned items only (R12 literal).
3. `filesRead` counts `forbidden`/`capacity`/`unavailable` attempts as consumed (R3 says "paths read").
4. R7 "port per-call candidate cap": the port exposes no count; a short non-complete port page is treated as the cap signal.
5. R11 `body_target_not_on_page` is implemented for lookup and history; tested for history.
6. `terms: []` is treated as no-terms, though P1 rejects an empty `terms` at the port.
7. MF15 M-10 old-version-without-reason is not constructible (R14); the `it.skip` records it.
8. M-11 write gates and MF7b/R15-adjacent rows are memory-only where the gate is backend-independent.
9. Spec §2's frozen reason/type lists would need the lead's amendments for `invalid_file_digest`, `NoteCheckV1.observedFiles`, `NoteMemoryReadResult`, `at: string | null` (no `docs/` touched).

## NOTES
- **Regrouping:** R16's NE3 fixtures were rebuilt on the real `platform.notes` holder (no read-model spy); `checkNotes` is on the holder and production-reached; `noteLimits` widened for the check/read limits; fault doubles now cover both backends. Per-item both-backend conversion was done by the group that rewrote each test (not all 18 round-1 files converted).
- **Sizes:** G1 = 1 file (+3 tests, 83); G2 = 3 production + 6 test files; G3 = 3 production + 10 test files; G4 = 2 production + 2 test files. Total this round: 9 production files, 12 modified + 11 new S4B tests, 3 helpers; S4B suite now 30 files / 272 passed / 4 skipped.
- Briefs were staged as `./.dsh-scratch/*brief.md` (git-excluded, deleted at the end) to keep the orchestration budget small.