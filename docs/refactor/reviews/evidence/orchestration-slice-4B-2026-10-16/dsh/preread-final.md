Read complete. I did not modify any file. Findings below.

# 1. Unclear

1. **Book §6 G1 vs SPEC §2 lines 484–487.** G1 says the port carries “`'all'` and `'any'` with the ranking and the partial ranking (T-07–T-09)”, but `TextSearchRequest` has no `match` and `TextSearchPage` has no `score`, `matchedTerms` or `ranking`. I would assume the port only returns candidate records (ordered by refKey) and that ranking/`matchedTerms`/`ranking:'partial'` belong to `memoryFind` (`MemoryResultV1` line 442, `NoteItemV1` line 463) — i.e. T-07–T-09 are NE3 rows, not NE2.
2. **SPEC L10 line 161–162.** “`match`：默认 `'any'`… 分（在代码里算…两个后端排序一致）” is not expressible through the declared `TextSearchRequest`/`TextSearchPage`. Unclear whether `terms` is an AND-candidate filter and the caller does `'any'`.
3. **SPEC L19 line 235 / SPEC L22.** “原因取目录修订事件” but there is no event-read path: `ports.ts:188-198` exposes only `readMany`/`lookupCommit`/`commit`/`eventAt`, and `ArchitectureBaselineRevisionSnapshot` (`catalog-contracts.ts:52-60`) carries no `reason`; only `ArchitectureCatalogRevisedEventV1.reason` (`catalog-record-codecs.ts:67`). I would assume the catalog reason cannot be delivered in 4B without a new event-scan port.
4. **Book §6 “Last” / SPEC §9 line 714.** “narrow 4A’s per-scope count to `currentEligible`”: `countCurrentNotes` lives in `notes/scribe-scope.ts`, which is **not** in the book §4 L-scope, and `currentEligible` needs the check port. I would assume `scribe-scope.ts` + a new injected `NoteCheckPort`, both outside the declared scope.
5. **SPEC T-06 (line 629) / book §6 G1.** How to make “FTS table missing or its version wrong” without touching internal tables, and where the “版本代号” lives, is undefined. I would assume a version-marker table read at open plus a helper that pre-creates it wrong (which is touching internals).
6. **SPEC L22 line 251 / M-14 (line 646).** A `commit` fact goes to `uncheckedFacts` yet M-14 says the item “仍可当现行结论”. I would assume commit-only `uncheckedFacts` does **not** change `freshness`/`currentEligible`; only budget-exhausted facts do.
7. **SPEC L10 line 162 / §2 line 484.** `find` with no `terms` (or `stale` by goal) needs project-wide head enumeration, but the only project-prefixed registration named is the full-text index; `NOTE_LOOKUP_INDEXES` (`note-record-codecs.ts:646-654`) has no all-heads-by-project index. I would assume `searchText` with empty terms, or looping the five anchor/status indexes — unspecified.

# 2. Contradictions

1. **Book §4 L-scope vs SPEC §2 lines 358, 415–465 and 495–518.** The L-scope file list omits `src/core/work-graph/model/note-contracts.ts`, yet `NoteMemoryReadPort`, `NoteCheckPort`, `Memory*Request/Result`, `UnderstandingStatusV1`, `NoteHistoryItemV1` and ~14 constants must be declared there. All are absent today (grep across `src/`+`tests/` finds only the comment at `note-contracts.ts:2-4`).
2. **SPEC §5.2 T-07/T-09 vs §2 line 484–487** (same mismatch as 1.1/1.2): T-07 asserts per-item `matchedTerms`/`score`, T-09 asserts `ranking:'partial'`; neither exists on the port page type.
3. **Book §4 L-reach vs L-scope.** It instructs editing `tests/architecture/production-reach-allowlist.json` (a `kept-for` group), but L-scope allows only new `S4B-*` tests; SPEC §5.3 line 670 lists that file only for 4C route types.
4. **Book §1/§5.7 vs this build.** “if the build or the platform lacks it… `unsupported`; never fake it”: I verified Node v24.18.0 / SQLite 3.53.1 **has FTS5** (`CREATE VIRTUAL TABLE … USING fts5` + `MATCH` succeed). `createSqliteRecordBackend` options are `{path, schemas, beforeWrite?}` (`sqlite-record-store.ts:40-44`) with `new DatabaseSync(path)` at `:155` — no seam to make FTS5 unavailable, and §9 line 727’s allowed doubles do not include an FTS5 double (SPEC §7 line 696 does name one).
5. **`migrations.ts:1-13` vs SPEC L10 line 165 / book §6 G1.** The module’s contract says it “never drops, rebuilds or rewrites anything, and never touches any other table”, yet 4B must rebuild the FTS table there; rebuilding note FTS also needs note-schema knowledge the generic module does not have.
6. **SPEC §0.2 F16 (line 60) vs code.** It cites `architecture-catalog.ts:18`, which does not exist on this base; the modules are `catalog-contracts.ts` / `catalog-record-codecs.ts`. (`:509` `ARCHITECTURE_CATALOG_SCHEMAS` and `:57` revised-event do match.)
7. **SPEC §0.2 F1 (line 45) vs code.** “生产组合登记的记录里没有记忆” is false: `NOTE_RECORD_SCHEMAS` is imported and registered together (`create-platform.ts:65`, `:1299`).
8. **SPEC L19 / §2 line 529–530 vs book §4.** The route owners `notes.listPlanVersions`/`listCatalogVersions` and `NoteIndexRowV1` are labelled 4C, but L19/the version lists are 4B; no 4B file, return type, or holder member is named (`create-platform.ts:1299-1301` has only four write/read ops + count).

# 3. Cannot build as written

1. **M-10 catalog half (SPEC line 642).** Reasons are only on `ArchitectureCatalogRevisedEventV1` and there is no event page; `reviseArchitectureCatalog` stores no reason on `ArchitectureBaselineRevision`. Unreachable through public reads.
2. **T-06 rebuild + `unsupported` (line 629).** FTS5 is present, no injection seam, and forcing “table missing” requires internal tables. Either a new production seam or a fabricated port is needed.
3. **T-07–T-09 at NE2.** As above: the declared port type cannot express match/score/partial ranking.
4. **M-12 (line 644).** No source is defined for `latestTriggerCursor`/trigger events (task end, rework, plan adoption, Session archive/regroup). `archiveSession` exists (`lifecycle-contracts.ts:64`), but nothing maps those commits to a goal/stage trigger cursor.
5. **M-02** is buildable: 4A’s `S4A-note-fixture.ts` already builds a real plan/catalog/run through `proposePlan`/`applyPlanChange`/`adoptInitialArchitecture`, and `reviseArchitectureCatalog`/`applyPlanChange` can change definitions.
6. **M-03 (257 files)** is buildable: `NOTE_BASIS_FILES_MAX=32` means ≥9 notes, under `NOTE_READ_FILES_MAX=256`; the workspace-unavailable case is an allowed double (SPEC §7 line 696).
7. **M-07 concurrent same-topic pair** is buildable: `S4A-note-interleave-fixture.ts` is the allowed N-14 storage-commit-gate double (SPEC §7 line 696; §9 line 727).
8. **M-10 plan half** is buildable (`PlanProposal` reason text, `S2B_PLAN_REVISION_BY_GOAL_LOOKUP` ordered by `acceptedAt`).

# 4. Missing

1. Where the 4B port types/request types/constants go (see 2.1) and that this file is outside L-scope.
2. What `NoteCheckPort` reads. SPEC L22 says views needs messages and “检查记录”, but no dependency list or check-record aggregate is named (no `CheckRecord` aggregate found; the closest is `VerificationRound` in `track-read-model.ts:784`). Messages would be `SessionMailboxPort.readMessage` (`communication-contracts.ts:268`).
3. Which 4A types 4B extends and how: `createNoteReadModel` returns only `NoteReadPort` (`note-read-model.ts:213`); how the injected `NoteCheckPort` reaches it and `scribe-scope.ts` is unspecified.
4. The version-list file, port, and return shape (`listPlanVersions`/`listCatalogVersions` are named only as route bindings).
5. The `updateDue` trigger source and cursor semantics (R48/L16 referenced, never defined).
6. FTS version-marker storage/name and who rebuilds from which records.
7. Port request semantics: candidate-vs-page `limit`, empty `terms`, and who normalizes terms.
8. `similar` normalization: whether to reuse `normalizeSearchText` (defined for `topic\nconclusion\nbody`) for the two-field Jaccard.
9. `views/note-views.ts` factory name/injection and the exact production-reach allowlist entries.

# 5. Size

- **G1 — large.** New port/registry member, two pure functions, in-memory index, FTS DDL + migrations + open-time availability/rebuild, ranking and partial ranking across two backends, 9 TDD rows.
- **G2 — large.** 11 rows; new `note-views.ts` implementing freshness, `sourceUnavailable`, `invali