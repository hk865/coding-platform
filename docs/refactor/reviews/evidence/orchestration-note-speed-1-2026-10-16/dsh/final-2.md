All fixes are implemented, verified RED→GREEN, and the full scoped suite plus typecheck/architecture/build pass. Scratch probes removed.

## FILES CHANGED

**Production (all in the allowed set):** `src/core/record-store/text-scan.ts`, `sqlite-text-scan.ts`, `sqlite-record-store.ts`, `lookup-index.ts`, `src/core/work-graph/notes/note-read-model.ts`.

**Tests:** `tests/record-store/SP-text-scan.test.ts`, `SP-text-scan-undo.test.ts` (new), `SP-literal-type.test.ts`, `SP-record-store-limits.test.ts`, `tests/work-graph/SP-memory-scoped-find.test.ts`, `SP-note-reuse.test.ts` (new), `tests/helpers/SP-storage-migration-fixture.ts`.

## F1–F7

- **F1 done.** `indexRecord` now writes `prefix_key = NULL, seq = ?`; catch-up removes NULL rows. **SP-08c** sqlite RED→GREEN, memory green (already removed); **SP-08d** sqlite RED→GREEN.
- **F2 done.** `normalizeTerms` returns `{rank, match}` per-term; matching uses `match`, ranking/`matchedTerms` use `rank`. **SP-10** "first error in term order" RED→GREEN both backends; **SP-11** literal `{noteId, matchedTerms:['j\u030Cx'], score≈3·ln2}` RED→GREEN both backends, with/without anchor, `all`/`any` (verified by temporarily restoring the old two-pass body).
- **F3 done.** `decodeTextSearchAfter` exported and used by the request decode and scoped `'all'`. **SP-13** RED→GREEN both backends (tampered `}`/Widget/`not-a-ref` → `invalid`; canonical missing NoteHead key stays valid).
- **F4 done.** Anchor sets seeded in `memoryLookup`/`memoryConflicts`/`memoryNeighbors`/`memoryStale` anchor routes (not the goal route); heads + version snapshots passed to `checkHeads` in `readNote` (head/version; `checkNotes` fallback only when head missing), `listByAnchor` (with anchor set) and `memoryHistory`. **SP-19** RED→GREEN both backends (verified RED by reverting the readNote-head and memoryLookup wires).
- **F5 done.** `restoreTextScanRow` drops the current bucket first. **SP-08e** RED→GREEN.
- **F6 done.** `SP-33` now has distinct values (W open/held/missing, V closed/missing), V asc/desc with `bound`/`after`, V ordered+plain counts, W desc bound/after, W distinct 2 / V distinct 1, literal `JSON.stringify` refKeys; `SP-15` matrix appended limit 1 after the 200 sequence on the same backend. GREEN (characterization).
- **F7 done.** Reload comment corrected; legacy drop selects only `next_fts_meta` + `CREATE VIRTUAL TABLE%`; fixture plain-table fallback removed; fixed SQL is module constants prepared through the cache (`readMeta` no longer held outside it); `TEXT_SCAN_RULE_VERSION` moved to `sqlite-text-scan.ts`; SP-12 retitled as an upgrade-compatibility check.

## CHECKS

Final suite (`tests/record-store/`, `tests/work-graph/S4B-*`, `S4A-*`, `SP-*`, `tests/composition/platform.test.ts`, `tests/architecture/`, `--maxWorkers=3`): **57 files, 734 passed | 5 skipped**. `npm run typecheck` ✅, `npm run check:architecture` ✅, `npm run build` ✅. Post-restore re-run of `tests/work-graph/SP-*` + `tests/record-store/`: 16 files, 218 passed | 1 skipped.

## UNSPECIFIED

- **F4 wrapper scope:** to make `readNote`/`history` fail today the wrapper also refuses a repeated NoteHead/NoteVersion `readMany`, not only the `s4-note-by-anchor-*` lookup. Options: (a) as done (one wrapper); (b) a second note-read wrapper.
- **F7 "fixed SQL":** only table-independent SQL became constants; per-index text-table SQL remains a template over the sanitized table name.
- **F2 term surface:** `matchedTerms` now reports the first-pass normalized term (e.g. `j\u030Cx`), per "scores and `matchedTerms` as in 4B".
- **Test ids:** the new scoped-cursor case is `SP-13` (an SP-13 also exists in `SP-text-scan.test.ts`, different file).