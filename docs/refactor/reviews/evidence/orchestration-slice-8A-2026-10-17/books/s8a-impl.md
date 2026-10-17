# Task: slice 8A — file-level observation graph, formal vs observed comparison, root path `.`, language providers (TS/JS first); without L8; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, this
book and the lead's rulings are binding; do not make design decisions. Where they do not determine something, choose
nothing: list it under UNSPECIFIED with the smallest options, and go on.

**This run is headless. When your turn ends, the whole run ends.** **Work in coordinator mode:** read
`./.dsh-ref/coordinator-mode.md` first and follow it, with **at most 3 subagents at once** (files of running subagents
disjoint; every vitest command `--maxWorkers=2`). Subagents write all code and tests; you split, brief, check and
reply. **Finish within 200 minutes** (the run stops at 210, with a handoff if needed). Finish whole items; an unfinished
item is reported, not half-done.

## 1. What this copy is

- `slice-setup` = the lead branch after 4C-1 merged (`36602e53`); `slice-base` adds `DSH-BASELINE.md`.
- Decision 74 (`docs/refactor/HANDOFF.md` item 74): 8A is built now as its own line, **without L8** (the stale reminder
  at preparation and the automatic capture triggers, which wait for 4C-2). 8B, 8C, 8D come later.
- The spec: `docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md`. **Read the post-notes at its top first**
  (4A, 4B, decision 72, decision 74); they override the body.
- Code facts rechecked by Codex on the lead branch before 4C-1 merged: `./.dsh-ref/s8a-facts.md` (where things moved,
  what to reuse, which old tests change). Use them; the line numbers may have shifted after 4C-1.

## 2. Scope (spec §1 "8A", minus L8)

Spec lines to read: L7 (116–123), L12 (148–155), §2 for the 8A types (`ArchitectureCatalogPinV1` and
`ObservedCaptureRef`, `FormalObservedComparisonV1`/`FindingV1`, `FileGraphPageV1`, `LanguageCoverageV1`,
`ArchitectureLanguageProviderV1`, `nonBlankLines`/`language`/`languages`), §5.1 AE1, §5.2 rows **A-01, A-02, A-02b,
A-05** and A-04's manual file-level capture part, §5.3 for the tests below, §6 "8A".

1. **Catalog pin type moves to 8A** (decision 72 post-note): lift the catalog identity to `src/contracts/architecture-catalog.ts`
   as `ArchitectureCatalogPinV1` (one definition; `work-graph/architecture/catalog-contracts.ts:68`'s
   `ArchitectureCatalogRef` re-exports or is replaced — no second copy).
2. **File-level observation graph (L12):** frozen capture materials owned by the capture (`ProjectSourceAccess` frozen
   adapter); file nodes with `nonBlankLines` (every text source file; binary = contains NUL; read cap 2 MiB per file;
   skipped files go into their language's `issues` with a reason; parser failure never erases `nonBlankLines`) and
   `language` (the extension table in L12); file-to-file import edges from providers; chunked artifacts (≤ 256 KiB per
   chunk, ≤ 64 chunks, chunk list in the observation record; the module-level graph unchanged); caps 20,000 files /
   100,000 edges → `capacity` with the counts, never truncated as complete; old observations read `not_captured`.
3. **Language providers (decision 63):** `ArchitectureLanguageProviderV1`; the TS/JS provider wraps today's
   `TypeScriptSourceAnalyzer` (`capture.ts`); `languages: LanguageCoverageV1[]` per language with unsupported / stale /
   cancelled / failed / capacity mapped to coverage states; a project without TS files must not fail as a whole
   (`capture.ts:207`, `project-source-snapshot.ts:48/70` per the facts file). C/C++ and Python providers are 8D — leave
   the interface ready, do not build them.
4. **Public reads:** `neighbors(file)`, `impact(file, depth ≤ 3)`, `listFiles(page)`; pages of 200 as
   `FileGraphPageV1` (nodes sorted by path, only edges between this page's nodes, cursor bound to the same `captureRef`
   and query, else `invalid`/`cursor_mismatch`).
5. **Formal vs observed comparison (L7):** `compareFormalObserved({ catalog: ArchitectureCatalogPinV1, captureRef })`;
   file ownership by the shared ownership function (item 6); ties → `ambiguous`; declared vs observed dependencies per
   module; anything touched by unmapped files, unresolved imports, or unsupported/failed/unconfigured/partially parsed
   files is `unknown`, never `dependency_missing`; observed cycles reported as they are; read-only, `noVerdict: true`,
   coverage notes; identity `(catalog pin, captureRef)`.
6. **Root path `.` through the whole chain (L7 last bullets):** the shared file-to-module ownership function that the
   4C-1 rework created (`pathOwnershipOf` in `src/core/work-graph/notes/note-path-ownership.ts`; its `tie` result carries `owners`, which item 5's `ambiguous` can use) gains `.` = length 0, lowest priority. Every module-prefix matcher
   uses it (the facts file lists them: contracts `architecture-source.ts:34/47`, `architecture-service.ts:98/135`,
   `workspace/architecture-source.ts:27/38`, `graph-index.ts:91/96`, `architecture-record-codecs.ts:265`, and any copy
   4C-1 left). Only module prefixes and mapping nodes accept `.`; file and configuration path checks stay strict
   (`architecture-record-codecs.ts:272`, `note-read-model.ts`'s path filter and `note-anchors.ts`'s neighbour lookup are
   not module ownership — leave them). The 4A post-note's scribe case: a scribe responsible for root R manages
   `src/loose.ts`.
7. **Routes:** `architecture/compare` (observed vs observed, today's service method), `architecture/compare-formal`
   (new), `architecture/impact` (F4's impact), in `core-routes.ts`, `core-http-types.ts` and the UI route label table
   (`src/ui/api/routes.ts`).
8. **Manual file-level capture without a catalog** (A-04's L12 part): a capture with no adopted catalog produces the
   file layer with an empty module layer. The automatic triggers, failure records and start-up retry are L8 — not now.
9. **Catalog version list (4B post-note ①):** bind each catalog revision's commit to its `ArchitectureCatalogRevised`
   event (the record-store cursor binding, `record-store/ports.ts:91`, as `note-service.ts` does), so
   `notes.listCatalogVersions` shows the real reason and time. ② (deleting modules, M-15/M-16/M-02) is 8C.
10. **§5.3 old tests:** flip exactly `tests/work-graph/S4B-note-hints.test.ts:69,76` (`.` owns files; no
    `basis_outside_anchor`) and `tests/work-graph/S4B-memory-version-lists.test.ts:120,121` (real reason and time).
    Extend, do not replace, the module-node assertions in `tests/data/workspace-capture-architecture.test.ts:111` and
    `tests/work-graph/R3d-observed-architecture.test.ts:33`. Keep the low-level unsupported assertions
    (`workspace-text-operations.test.ts:239`, `project-source-index.test.ts:64`, `cpp-source-index.test.ts:91,93`). Any
    other assertion that fails: do not edit it; report it (test id, assertion, rule, minimal counter-example).
11. **Not in 8A now:** L8 (AE2 rows, A-03, A-04's automatic triggers and retries); 8B (maintainers, containment, task
    module checks); 8C (revision, module deletion, repairs, proposals); 8D (C/C++, Python); any UI.

## 3. Rules

- **TDD:** one test first (it must fail for the right reason), then the smallest change. Test names start with the row
  id (A-01 …) or `S8A-<n>`. Expected values literal and hand-computed (A-01's 205-file workspace and A-02's catalog are
  written in the rows). Memory and SQLite backends each once for service-level rows.
- **AE1 entry:** the public `platform.architecture` capture, query, `compare-formal` and impact on real TS files in a
  temporary workspace. No database reads to verify.
- Reuse, do not rebuild (facts file §5): `architecture-delta.ts` (diff, cycles), `graph-index.ts` traversal (but bound
  the neighbourhood to the page and the impact depth to 3), `typescript-source-query.ts`, catalog reads
  (`catalog-service.ts:757/792`), `note-version-lists.ts`.
- State transitions only through `src/core/work-graph/state/` (AGENTS rule 9). Production-reach allowlist: remove the
  entries your wiring reaches; add new ones only with the reason "8A wires it".
- No real model calls, no git writes in the repository, never ports 3080/3099/44797; probes under `./.dsh-scratch/`,
  deleted at the end.
- **Line budget (decision 69):** about 1,600 new production lines (soft). Report the count.

## 4. Order (suggested; you decide the briefs, files disjoint, at most 3 at once)

1. Shared first, one subagent: the contracts (item 1's pin type, §2's 8A types) and item 6's change to the shared
   ownership function with its unit test.
2. Then in parallel: (A) workspace side — frozen materials, providers, `nonBlankLines`/`language`, TS provider, no-TS
   projects, caps (items 2–3; `src/core/workspace/`); (B) WorkGraph side — chunked storage, reads and pages, the formal
   comparison, root-path callers (items 2's storage, 4, 5, 6's callers; `work-graph/architecture/`, `graph-index.ts`);
   (C) item 9 (catalog revision commit binding, `catalog-service.ts`, version lists) and item 10's old tests.
3. Then routes (item 7) and item 8; then the AE1 rows A-01, A-02, A-02b, A-05 end to end; then close-out.

## 5. Checks (close-out subagent)

- `--maxWorkers=2`: `tests/data/`, `tests/work-graph/` architecture, catalog, S4B and S4C note tests, the conflict and
  node-detail tests, `tests/app/` route tests you touched, `tests/composition/platform.test.ts`, `tests/architecture/`,
  the new test files.
- Then `npm run typecheck`, `npm run check:architecture`, `npm run build`.
- Failures listed in `DSH-BASELINE.md` are expected in your sandbox. Name any other failure. **Do not run the full suite.**

## 6. Reply

Under 900 words: FILES CHANGED (production / tests, production line count); each item and row: done or not,
RED → GREEN; CHECKS with numbers; UNSPECIFIED (short, with options); subagents (task, time, most at once); anything
surprising.

## 7. Answers to the read-through (lead, 2026-10-17 03:05; binding like the sections above)

1. **Where the file graph is stored:** in the existing raw artifact store (`bodies: RawArtifactStorePort`), the same way
   the module-level body is stored today (`architecture-service.ts` ~538, cap `ARTIFACT_MAX_SIZE_BYTES`). Each chunk is
   one artifact (≤ that cap; ≤ 64 chunks); the observation **record** gains an optional list of the chunk refs. The
   module-level body does not change (spec L12 "模块级的不变"), so `R3d-record-integrity.test.ts` should stay green; if
   it does not, report it. A record without the chunk list reads `not_captured`.
2. **`languages`:** stored on the observation record (spec §2: issues ≤ `COVERAGE_ISSUES_MAX` = 100, `issueCount` is the
   full count), and returned wherever the observation is returned (capture result and reads).
3. **`.` and `''`:** only `.` means the root (match length 0, lowest priority; two modules both `.` are a tie). `''`
   stays non-matching and invalid. Only module prefixes and mapping nodes accept `.`; configuration and node/file path
   checks stay strict in `src/contracts/architecture-source.ts` — split the one `path` closure if needed, and add one test
   each: a mapping `.` is accepted, a `configPath` `.` is rejected.
4. **Routes:** `architecture/compare`, `architecture/compare-formal`, `architecture/impact` are plain read routes, like
   `architecture/query`.
5. **Item 9 (catalog version time and reason):** do it as the 4B post-note says, with the schema changes it needs: the
   catalog record gains the commit cursor (`commitCursorFields` in `ARCHITECTURE_CATALOG_RECORD_SCHEMA`,
   `since` on the record, the `exactKeys` check accepts it); old records without it read `at: null, reason: null` as
   today. The time and reason come from the bound `ArchitectureCatalogRevised` event; one event read per listed version
   is acceptable (the page is bounded). `catalog-contracts.ts` and `catalog-record-codecs.ts` are in scope for this.
6. **No-TS projects:** use the real sites (`capture.ts` ~210 and `project-source-snapshot.ts` ~66/68 in this copy). The
   rule: a project without TS files does not fail as a whole; a binary (contains NUL) or over-2-MiB or unreadable file
   is not a node and goes into its language's `issues` (`kind: 'skipped'`, reason). `tests/data/project-source-snapshot.test.ts:79`
   (rejects binary/read failure) may change to assert that rule; report the before/after.
7. **Item 8 is only the manual capture without a catalog** (file layer, empty module layer). The automatic triggers,
   failure records and retry are L8, not in this run — drop them from your plan; 200 minutes should then be enough.
   If time runs short anyway, the order of priority is items 1, 6, 2, 3, 4, 5, 9, 10, 7, 8, then the AE1 rows; the
   runner hands over at 360k context.
8. `graph-index.ts` is `src/core/work-graph/architecture/graph-index.ts`. `pathOwnershipOf` has four callers
   (`scribe-scope`, `goal-conflicts`, `node-detail-reader`, `graph-context-reader`); after `.`, run their tests
   (`S4C-*`, `S3-graph-context`, the conflict and node-detail tests) and report any change.
