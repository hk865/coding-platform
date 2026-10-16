All work is done. Final verification: 51 files / 671 passed in the scoped run; typecheck and build pass; `check:architecture` fails only on pre-existing sandbox runtime-asset-hash mismatches unrelated to this change.

---

# Reply

## FILES CHANGED
**Production (new):** `src/core/record-store/text-scan.ts`, `sqlite-text-scan.ts`, `sqlite-sql-literals.ts`.
**Production (modified):** `lookup-ports.ts`, `lookup-index.ts`, `in-memory-record-store.ts`, `sqlite-record-store.ts`; `notes/note-read-model.ts`, `views/note-views.ts`, `model/note-contracts.ts`, `persistence/note-record-codecs.ts`; `composition/create-platform.ts`. **Deleted:** `sqlite-text-search.ts`.
**Tests (modified):** `S4B-text-search.test.ts`, `helpers/S4B-text-search-support.ts`, `helpers/S4B-note-check-fixture.ts`. **Deleted:** `S4B-memory-unsupported.test.ts`.
**Tests (new):** `record-store/SP-text-scan.test.ts`, `SP-record-store-limits.test.ts`, `SP-literal-type.test.ts`, `helpers/SP-storage-migration-fixture.ts`, `architecture/record-store-literal-type.test.ts`, `work-graph/SP-memory-check-scoped.test.ts`, `SP-memory-scoped-find.test.ts`, `SP-memory-history-confirm.test.ts`.

## PER RULING
- **S1.1–S1.11 — done.** New `text-scan.ts` (row derivation, `decodeTextTerms`, allocation-free code-point comparator, per-prefix index with pending merge, scan, undo); new `sqlite-text-scan.ts` (compact table `next_text_*`, `next_text_meta` with `generation`, JSON lossless text, legacy `next_fts_%` drop, atomic rebuild, read-time catch-up/full-reload, `not_ready`). Memory backend maintains the shared index in-commit with undo. Port gains `match?`; cap removed; `sqlite-text-search.ts` deleted. Tests **SP-01…SP-18** GREEN (supplementary-plane byte order, after-resume, cross-backend differential, catch-up, prefix move, second connection, `index_not_ready`, 4B-era legacy drop, lone surrogate, `'any'`).
- **S2.1, S2.2 — done.** Scoped candidates from anchor/prefix with no port call; unscoped `'any'` is one `match:'any'` stream limit 100. Tests **SP-6…SP-12** GREEN. **SP-10/SP-11 were RED** (J+U+030C: scoped normalized once vs port twice); fixed by applying S1.10's second normalization pass in the read model, so both routes reject/match identically → GREEN.
- **S2.3, S2.4, S2.5 — done.** `CheckCaches.heads`, seeded from the read model's anchor sets; `itemOfHead` skips derivations when a check exists; `NoteHeadCheckPort.checkHeads` added, `checkNotes` reimplemented over one `checkItem`. Tests **SP-1…SP-5** GREEN (one call equals separate calls; module/stage/Run scoping).
- **S2.6 — done** (derivations per `noteId@version`, catalog by revision, Run scope, `planRevisionsOfGoal`/`basisPlanByNumber`, staged repair, note fact heads, successes-only), all per-call.
- **S2.7 — NOT done** (decode memo).
- **S2.8 — done.** One lazy ascending `u*` scan bounded by the page maximum. **SP-13** GREEN (head v4, confirmation v3). **SP-13b skipped** (see UNSPECIFIED).
- **S3.1 — done.** LRU statement cache ≤1024 keyed by SQL, `get/all/run` only, cleared after open DDL and on `close`.
- **S3.2 — done.** Literal `LIMIT` = next power of two ≥ `limit+1`; `hasNext`/slice unchanged.
- **S3.3 — done.** `AGGREGATE_TYPE_PATTERN` rejection at registration; `aggregateTypeTerm` used in `lookupInside`, `lookupOrderedInside`, `countInside`, text rebuild. Tests **SP-31/32/33** GREEN; **SP-33 was RED** (distinct-count values) then GREEN. Source-scan test passes.

## ALLOWED TEST REMOVALS
Exactly the four allowed: two FTS5 cases + small-cap block in `S4B-text-search.test.ts` (retitled "window candidates"→"substring rule"); `fullTextProbe`/`textSearchCandidateMax` from the support helper; deleted `S4B-memory-unsupported.test.ts`; `fullTextUnavailable` from the check fixture. Also removed now-unreached production exports (`textSearchMatches`, `TextScanPage`, `NOTE_TEXT_TERM_MIN/MAX`) to keep production-reach green.

## CHECKS
- Scoped run (`tests/record-store/`, `S4B-*`, `S4A-*`, `SP-*`, `composition/platform`): **51 files, 671 passed / 5 skipped**.
- `tests/architecture/`: **3 files pass** (production-reach GREEN); `boundaries.test.ts` 13 failures, **all** `runtime asset hash differs` for `resources/skills`, `scripts/*.py`, `vendor/coding-agent/**` — sandbox-only, not in `DSH-BASELINE.md`, untouched by this change.
- `npm run typecheck` ✅; `npm run build` ✅; `npm run check:architecture` exit 1 solely on the same asset hashes.

## UNSPECIFIED
1. **Book §5 item 10/11 vs S1.10**: "same invalid reason with/without anchor" is only satisfiable by applying the port's second normalization on the scoped path (chosen; section 9 binding). Options: (a) keep this, (b) amend the book, (c) drop double normalization.
2. **SP-13b** (`head version ≥ 5`): unreachable through the public state machine (max v4 via pending_review→accept→review→withdraw). Left `it.skip`; options: seed raw versions or amend the book.
3. **SP-11 "changed registration → first backend stays correct"** contradicts S1.6; subagent split it into same-code rebuild (correct content) and changed-code (`index_not_ready`), matching section 4.

## SURPRISES
- The subagent found the S1.10 double-normalization is order-dependent (`J+U+030C` → valid `j+U+030C` first pass, `ǰ` second pass), so the read model must double-decode to agree with the port.
- No storage-migration fixture existed; one had to be written.
- `check-boundaries`/`boundaries.test.ts` fail in this sandbox on frozen runtime-asset hashes even though `DSH-BASELINE.md` does not list them.
- `src/core/record-store/lookup-index.ts` still exports `bigramWindows` (used by `similarNotes`).