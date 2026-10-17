All items and checks are in. Final reply:

## FILES CHANGED

**Production (24 files, ~1,501 added lines):** modified: `contracts/architecture-catalog.ts` (+17), `contracts/architecture-inspection.ts` (+63), `contracts/architecture-source.ts` (+12/−5), `core/work-graph/notes/note-path-ownership.ts` (now a re-export), `notes/note-version-lists.ts` (+23/−9), `architecture/contracts.ts` (+33), `architecture/architecture-service.ts` (+311/−14), `architecture/architecture-record-codecs.ts` (+146/−4), `architecture/catalog-contracts.ts` (+14/−6), `architecture/catalog-record-codecs.ts` (+38/−6), `architecture/catalog-service.ts` (+7/−3), `architecture/graph-index.ts` (+13/−7), `workspace/capture.ts` (+126/−2), `workspace/architecture-source.ts` (+77/−50), `workspace/workspace-tools.ts` (+4/−1), `workspace/ports.ts` (+4), `composition/create-platform.ts` (+4), `app/core-routes.ts` (+13), `app/core-http-types.ts` (+3), `ui/api/routes.ts` (+4). New: `contracts/path-ownership.ts` (58), `architecture/file-graph-index.ts` (153), `architecture/formal-comparison.ts` (234), `workspace/architecture-language-provider.ts` (133).

**Tests (19 files):** modified `workspace-capture-architecture.test.ts`, `R3d-observed-architecture.test.ts`, `S4C-note-path-ownership.test.ts`, `S4B-memory-version-lists.test.ts` (flip), `S4B-note-hints.test.ts` (flip), runtime/app stubs + `since` fixtures, `production-reach-allowlist.json` (+144/−72). New: 9 `S8A-*` test files (1,660 lines) incl. `tests/composition/S8A-AE1-*.test.ts`.

## Items and rows

1. **Catalog pin** — done. RED `invalid mappings` → GREEN; `check:architecture` no duplicate type.
2. **File graph** — done. RED 9 failed in `S8A-file-layer.test.ts` → GREEN 9; 205 nodes/2 edges, 200+5 paging, binary/PARSE-failure skips, 256 KiB×64 chunks in the record, caps 20,000/100,000 → `capacity`, old records `not_captured`.
3. **Providers** — done. TS/JS provider wraps `TypeScriptSourceAnalyzer`; `languages` coverage `supported`/`unsupported`; RED 6 failed in `S8A-file-graph.test.ts` → GREEN 6; pure non-TS capture succeeds.
4. **Reads** — done (`neighbors`/`impact`/`listFiles`); cursor bound to captureRef+query → `invalid`/`cursor_mismatch`.
5. **Formal vs observed** — done. `S8A-formal-comparison.test.ts` RED (0 collected, stub 4/4 fail) → GREEN 4; A-02/A-02b arrays exact.
6. **Root path `.`** — done. `S8A-root-path.test.ts` RED 6/6 → GREEN 6; one `pathOwnershipOf` in `contracts/path-ownership.ts`, both other modules re-export (`toBe` identity test).
7. **Routes** — done. RED 404 unpublished → GREEN 2; three plain routes reach their real owners.
8. **Manual capture without catalog** — done (`S8A-06`: file layer + empty module layer). Automatic triggers/retries were L8, correctly dropped.
9. **Catalog version list** — done. RED `expected undefined to be null` → GREEN 2 (memory+sqlite); real `at`/`reason`, legacy rows still null.
10. **Old tests** — done: `S4B-note-hints:69/76` and `S4B-memory-version-lists:120/121` flipped; module-node assertions in `workspace-capture-architecture:111` and `R3d-observed-architecture:33` extended, not replaced; low-level unsupported assertions untouched. No other assertion failed.

**AE1:** A-01 done (205 nodes, exact lines/language, page1 200+2 edges, page2 5, `neighbors` both edges, `impact`, `cursor_mismatch`); A-02 done (exact 5 findings); A-02b done (exact 2); A-05 done (root `.` loses to `src/a`, `src/loose.ts` ungrouped-free). AE1 capacity-2 has no platform injection seam (see UNSPECIFIED).

## CHECKS (`--maxWorkers=2`)
`tests/data` 146 pass · named S8A work-graph 23 pass (my own spot-check of file-layer/formal/AE1: 17 pass) · 8A-affected work-graph 622 pass/4 skip · app route 2 pass · composition platform+AE1 6 pass · `tests/architecture` 40 pass/13 fail (all pre-existing `runtime asset hash differs` in `boundaries.test.ts`; reproduced at clean HEAD `d4e9e3a`; not 8A) · production-reach NEW 8A break fixed via allowlist. `npm run typecheck` exit 0 (my rerun) · `check:architecture` exit 1, exactly 21 runtime-asset-hash lines, **no new forbidden edge** · `build` exit 0.

## UNSPECIFIED
- Provider interface lives in `core/workspace/architecture-language-provider.ts` (contracts must not import core). Alt: lift `ProjectSourceAccess` to contracts.
- `not_captured` = ready empty page `{notCaptured:true}`; `compare-formal` on it → `unsupported`. Alt: `rejected('not_captured')`.
- `neighbors` = one-edge reachable nodes, seed excluded; `impact` = reverse importers, seed excluded, `depth>3` → `invalid`; `limit` clamped 200; `listFiles` fixed 200.
- Record manifest carries `unresolved` beyond "chunk list" (the comparison needs it).
- No public file-cap injection seam; capacity-2 only asserted at the workspace port. Alt: add `fileGraph` caps to platform options.
- `architectureSource.configPath` typed `string` but the service accepts `null`; AE1 used `null as unknown as string`. Recommend widening to `string | null`.
- Route labels: `比较观察结构` / `对比正式与观察结构` / `查看结构影响`.
- Low-level `captureProjectSource` keeps rejecting binary; the skip rule is implemented in `captureFileGraph` (facts §4 permits if the TS-specific entry is retained).
- `since` required on `ArchitectureCatalogRecord`; absent decodes to null.

## Subagents (10 total; max 3 at once)
Wave 1: contracts+`.` (1, ~20 min). Wave 2: workspace graph, root-path callers, catalog version (3, ~35 min). Wave 3: storage/reads, pure comparison, dedupe/fixtures (3, ~25 min). Wave 4: routes, AE1 rows (2, ~15 min). Close-out (1, ~20 min). All wrote code/tests; I edited nothing.

## Surprising
- Pure non-TS capture already succeeded in this copy, so `project-source-snapshot.ts` needed no change (contrary to the facts file's expectation).
- `tests/architecture/production-reach.test.ts` was genuinely broken by 8A (24 new declarations); fixed by allowlisting with reason.
- `check:architecture`'s only red is the sandbox's runtime-asset hashes, verified pre-existing.