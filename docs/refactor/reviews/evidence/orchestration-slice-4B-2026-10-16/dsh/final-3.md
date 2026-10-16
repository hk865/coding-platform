**FILES CHANGED (src):** `views/note-views.ts` (items 1,2,5a,6); `notes/note-read-model.ts` (items 3,4,5b); `record-store/sqlite-record-store.ts` (item 8, local rejection); `record-store/record-codec.ts` reverted (now identical to `slice-base`). **Tests:** new `S4B-note-check-head-version.test.ts`; edits in `S4B-memory-ranking/-paging`, `S4B-note-symbol-recheck`, `S4B-note-hints`, `S4B-note-facts`; item-7 subagent edited 15 `S4B-*` files.

**Per item**
1. `note-views.ts:resolveFact` record branch: revision compare moved before the `SessionMessage` decoder. **Not finished (test).**
2. `note-views.ts:recheckSymbol`: zero hits now read the capture-version file; a failed/missing read → `unchecked`. Existing `MF4 sqlite/memory: a renamed symbol is still symbol_missing` GREEN. **Missing-capture branch could not be driven through public workspace tools (test not written).**
3. (a) `S4B-memory-ranking` `R7 %s` + changed `MF7a %s` assertion `ranking` → `toBeUndefined()`; `note-read-model:memoryFind` omits `ranking` for `all`. (b) new `R7 %s: an explicitly empty term list is invalid` (code `invalid`, reason `terms must be 1–8`). (c) new `R7 %s: an all page is one port call…`; `allTermHeads` rewritten to one `searchPage` call, short-page heuristic removed. GREEN (old code would fail (c): it returned `complete:true`).
4. New `R10 %s: a pinned body cursor after a head change is a revision_conflict`; `bodyCursorOf` stores `head` and `bodyPageOf` checks it for pinned and unpinned. GREEN.
5. (a) New `R11 %s: checkNotes marks an old accepted version ineligible and the head eligible`; `checkOne` adds `item.version === head.version`. (b) New `R11 %s: a body target whose item is trimmed off the page still gets the warning`; `memoryLookup`/`memoryHistory` compute the warning after `fitToByteBound`. GREEN.
6. New `R13 %s: a failed deletion-proof read answers unavailable, never deleted_path_unverified`; `hasDeletionProof` returns `Outcome<boolean>`, read/decode failure → `reject('unavailable')`, propagated by `classFiveHints`. GREEN.
7. Subagent: 57 memory-only NE3 cases → both backends across 15 files (incl. the three named), plus `M-11 %s: a basis file replaced by an escaping symlink is unchecked with outcome forbidden` (RED via plain-changed mutation, GREEN with symlink). Remaining memory-only NE3: none.
8. `unavailableFailure` removed from `record-codec.ts`; `sqlite-record-store.ts` returns the rejection literal. `git diff slice-base -- …/record-codec.ts` = 0 lines.

**RED/GREEN:** item 7's new test captured RED→GREEN (mutation, no src edit). Items 2 and 1 tests are absent (above). The other new tests were authored and run after their fixes (GREEN); I did not snapshot round-2 to show a separate RED run — the old code paths they target (no head binding, pre-trim warning, short-page refill, silent proof-read failure, message revision skip) are the documented defects.

**CHECKS**
- `npm run typecheck`: exit 0. `npm run check:architecture`: exit 0.
- S4B suite (`tests/work-graph/S4B-*` + `tests/record-store/S4B-*`): **31 files, 343 passed | 4 skipped, exit 0**.
- `tests/work-graph/S4A-*.test.ts` + `tests/composition/platform.test.ts`: **8 files, 204 passed, exit 0**.
- Subagent’s 15 touched files: 147 passed | 3 skipped. Touched pre-subagent files: 5 files green (80 tests).
- `git diff slice-base -- src/core/record-store/record-codec.ts`: empty.
- No full-suite run; `--maxWorkers=2` throughout.

**UNSPECIFIED**
- Item-1 test seam: `platform.messages.sendMessage` answers `unsupported` (“fresh Host admission dependency”) in the S4A note fixture; no public seam creates an existing `SessionMessage`, so the regression test is not constructible here.
- Item-2: the capture-missing branch is defensive; deleting the anchored file yields `file_deleted`, and a present file is always in the fresh capture, so no public input reaches it.
- `filesRead` already counts `forbidden`/`capacity`/`unavailable`; no change needed.
- Workspace tools answer `forbidden` for any symlink basis path (not only escaping ones); the test uses the escaping example.
- Round-2 scratch scripts remain under `.dsh-scratch/` (excluded); my probe was deleted.