# Verification of Codex's 8A review (items 1–10)

Read-only check of `D:/cxt/s8a-review` against slice-8 SPEC (post-notes, L7, L12, §2, §5.1 AE1, rows A-01/A-02/A-02b/A-05) and the binding book `.lead-ref/s8a-impl.md` (§7 answers). Paths: `W`=`src/core/workspace`, `A`=`src/core/work-graph/architecture`, `V`=`src/core/work-graph/views`.

## Item 1: per-file skip blocked by the strict capture. CONFIRMED, and wider than Codex says

Path: `A/architecture-service.ts:673` → `W/capture.ts:527` `captureProjectSource` (TS/JS/JSON only, `project-source-snapshot.ts:70`). A read failure (`binary_file`, `too_large`, `invalid_encoding`) throws at `:77-78`. NUL content throws at `:82`. Counter-example: `good.ts` plus `bad.ts` with a NUL byte. The capture is rejected and no observation is written. A more common trigger is any committed TS/JS/JSON file over 2 MiB (`maxFileBytes` = 2 MiB, `workspace-tools.ts:7`), for example a `dist/bundle.js`. The whole observation then fails. It also fails with the wrong code: the message "exceeds file capacity" matches `/capacity/` in `captureFailure` (`capture.ts:655`), so the user sees `capacity`. Skips work only for files the strict pass never reads (for example `logo.png`), which is the only case S8A-01 tests (`tests/data/S8A-file-graph.test.ts:109`). This breaks L12 and book §7.6. Use: yes. Scope: 8A.

**Smallest design for items 1 and 2.** Read all observation material once, in the capture, and keep `captureProjectSource` strict for its other callers:
1. `W/project-source-snapshot.ts`: add `captureObservationSource(access, signal, limits)`. It makes one tolerant pass over safe, non-ignored, allowed paths (all languages) with the 2 MiB cap. Each read error, over-cap file or NUL file becomes `skipped {path, reason}`. It returns `{files (all text), skipped, identity, snapshot}`, where the digest covers `[path,digest]` of every text file plus the skip list. Also add pure `projectSnapshotOf(material)`, the TS/JSON subset with the same digest formula as `captureProjectSource`. Leave `captureProjectSource` unchanged.
2. `W/capture.ts`:
   - `CaptureMaterial` (typescript variant) gains `observed?`.
   - `captureOp` takes a mode. Observation mode calls the tolerant reader once, gives `projectSnapshotOf(observed)` to the existing analyzer code, sets `sourceDigest = observed.snapshot`, and its final verification recomputes the same digest.
   - New registry method `captureObservation`. `capture()` stays strict.
   - `verify()` re-checks with the tolerant digest when `observed` is present.
   - `captureFileGraph` builds nodes and issues from `entry.material.observed`, without `access.listFiles`/`read` (`:257`, `:275`). It returns `unsupported` if the entry is not an observation capture.
   - `logicalBytes` counts the observed text.
3. `W/architecture-language-provider.ts`: `createTypeScriptLanguageProvider({ configPath })` passes `configPath` to `analyze` (`:101`). `captureFileGraph` creates the provider per call with `entry.requestedConfigPath`. `parsed` should count only TS-language indexed sources; today JSON modules are counted (`:122`), so `parsed > files` is possible.
4. `W/ports.ts` and `workspace-tools.ts`: add `captureObservation`, with the same request and summary types.
5. `A/architecture-service.ts:673`: call `workspace.captureObservation`. Everything after it stays the same, and the existing recheck at `:735` now covers every file.

Codex's approach matches.

## Item 2: file graph not bound to the frozen material; configPath lost. CONFIRMED

`captureFileGraph` re-reads the worktree (`capture.ts:257,275`), while `verify` covers only TS/JSON (`:218`). A `.py` edit before the recheck (`architecture-service.ts:735`) is published under a `sourceDigest` that does not cover it, and two calls on one ref can differ. The analyzer defaults to `tsconfig.json`/`jsconfig.json` (`typescript-source-query.ts:238`). With `configPath: 'tsconfig.app.json'`, aliases resolve in the module layer but are `unresolved` in the file layer, and compare-formal then says `unknown`. Use: yes (and it decides correctness once 8D arrives). Fix: the item-1 design.

## Item 3: false findings in compare-formal. CONFIRMED (both rules)

`A/formal-comparison.ts`:
- **(a) Same-module edge.** One module `A` with `src/a/one.ts → src/a/two.ts`: the pair A→A is never declared (`:166`), so `import_undeclared` is reported (`:175`). Every internal import in a real project is reported. The module layer already skips this (`W/architecture-source.ts:66`). Rule: when `fromOwner == toOwner`, skip the edge.
- **(b) `dependency_missing` reported as `proven` when the module "touched" something unknown.** The certainty loop looks only at A's own *nodes* (`:203-207`), and edges with an unowned end are dropped (`:171`). Counter-examples, all with A→B declared and no A→B edge, all reported `proven` today:
  - A file in A imports ungrouped `src/loose.ts`. Rule: an X-owned file has an edge to an unowned file → `unknown`.
  - A file in A imports `src/dup/one.ts`, which ties between B and P. Rule: an X-owned file has an edge to a tied file → `unknown`.
  - A's only file `src/a/big.ts` is skipped (after the item-1 fix). It is not a node, so the loop never sees it. Rule: a `skipped`/`failed` issue path owned by X → `unknown`. If any language's `issueCount > issues.length` (issues were truncated), treat every missing dependency as `unknown`.
- The existing rules stay: a tie on one of X's own files, X's unresolved imports, and a language that is not supported or not fully parsed.
- Use outgoing edges only. An edge from loose code *into* X cannot create X→Y.
- File cycles stay separate. A-02, A-02b and A-05 keep their exact arrays under these rules (checked by hand).
- Lead question, not a must-fix: an `other` file (`.md`, `.json`, `.css`) has coverage `unsupported`, so `languageProven` (`:187-195`) makes any module that contains one `unknown`. Under the root `.`, that means every module. Should non-source files count as "unsupported files involved in a dependency"?

## Item 4: catalog pin not checked. CONFIRMED, plus a cross-project read

`compareFormalObserved` reads the record by `catalogRef` only (`A/architecture-service.ts:963-969`). It never checks `catalogRef.projectId` against `ctx`, `catalogRef` against `baseline.ref`, or the pin digest; only the capture is scope-checked (`:525`). So p1's ctx can read p2's catalog (p2's module ids appear in the findings), and a wrong digest returns `ready` and is echoed as the result's identity. S8A-07 relies on this: it pins a fabricated `hex('d')` with no baseline record (`S8A-file-layer.test.ts:369`). Fix:
1. `ctx.projectId !== catalogRef.projectId` → `forbidden`.
2. `catalogRef` ids differ from `baseline.ref` ids → `invalid`.
3. Export `readRevisionByRef` (`A/catalog-service.ts:430`; it already checks that the catalog names its baseline) and call it with `baseline.ref`. Missing baseline, or a null catalog → `not_found`.
4. `revision.baseline.contentDigest !== pin.baseline.digest` → `invalid`.

S8A-07 must then seed a real baseline record.

## Item 5: root path leftovers. CONFIRMED (plus one more)

`V/graph-context-reader.ts:231` filters out `.`, and `owningPath` (`:214-219`) cannot match `.`. With R = `.` only, searching `src/loose.ts` gives `none`, and R is not returned (`pathMatches` `:250`). With two `.` modules, neither is returned. L7 says "根路径规则覆盖全链"; book item 6 says every module-prefix matcher uses the shared function. So this is a violation. **Correct answer:** for a root-only catalog, any non-empty path search returns R. Two root modules (a tie) return both. A needle of `.` should return every module, consistent with `modulesMatchingPath` (`:1432`).

**Fix:** add `prefix: string` (the stripped winning path, `.` for root) to the `owner` and `tie` results of `pathOwnershipOf` (`src/contracts/path-ownership.ts`). Tied winners always share one prefix string. Then delete `owningPath` and `formal-comparison.ts:33 longestMatchedPrefix`, and drop the `.` filter. Other callers ignore the new field. The cost is updating the exact-equality tests (`S4C-note-path-ownership` lines 14–57 and `S8A-path-ownership-dedupe`).

**Missed by Codex:** `notes/note-related-scope.ts:335` skips `.` in `collectModuleFileKeys`, so a root module's related-first find returns no file notes. Fix: for `.`, scan the whole `file:` range and let the existing `moduleOfAnchor` filter decide. The lead should rule on the cost of that full scan.

## Item 6: decoder rejects old observations. CONFIRMED, broader than stated

The old writer and decoder put a file in *every* mapping whose path is a prefix of it (diff of `W/architecture-source.ts`). The new decoder recomputes members by longest prefix (`A/architecture-record-codecs.ts:374-393`). Minimal old observation: mappings A=`src`, B=`src/b`, files `src/a.ts` and `src/b/x.ts`. The old A digest covers both files; the new rule gives A only `src/a.ts`, so the "contentDigest disagrees" check (`:391`) fails. Codex's example (A has no files of its own) is just the empty-member variant (`:390`). Nested module paths are allowed and are exactly the containment case.

Effect:
- `loadObservation` returns `unavailable` (`:489`) for query, compare and impact.
- A new capture with `previous` set to such an observation fails (`:662`). The settings page always sends the last observation as `previous` (`src/ui/views/setup/requests.ts:207`), so after upgrade the capture button breaks for these projects.

**Smallest compatible rule:** the record says which rule wrote the body. New records always carry `fileGraph` (`:741`); old ones never do. Add a parameter to `decodeObservedArchitectureBody(json, ownership: 'longest' | 'legacy_any_prefix')`. `loadObservation` passes `legacy` when `decodedRecord.value.fileGraph` is absent. The write-time self-check (`:708`) passes `longest`. No schema bump and no body change. Test: one old-style body with nested mappings is decoded and queryable, and works as `previous`.

## Item 7: coverage not public; old observation skips the cursor check. CONFIRMED / PARTLY

`languages` is stored (`:741`) and loaded (`:572`), but nothing public returns it:
- The capture returns only `PersistedSourceCaptureRef` (`:772`).
- `FileGraphPageV1` has no `languages` field.
- The module query does not return it.

A pure-Python capture therefore shows empty edges with no "引用关系未支持" (breaks L12 "公开读出" and book §7.2). **Fix:** add `languages` to the three file-graph pages (`[]` on `notCaptured`); `loaded.value.languages` is already loaded. Putting it on the capture result too (book wording) changes the write type and needs a record read on replay (`restoreObservedCapture` returns only the ref); the lead should confirm or narrow that wording.

The cursor part is cosmetic: a cursor sent to an old observation gets the `notCaptured` page (`:886,914,943`) instead of `cursor_mismatch`. Since such an observation never issues cursors, `cursor !== null` → `invalid('cursor_mismatch')` is a one-line guard.

## Item 8: no-catalog capture. PARTLY; the gap is elsewhere

The service has no catalog concept: the module layer comes from the caller's explicit `mappings`. "No catalog, non-empty mappings" is the caller asking for a module layer, not a defect. The real gap is that `readMappings` rejects `[]` (`A/architecture-service.ts:141`). With no catalog the UI builds `[]` and gives up (`requests.ts:203-204`), so a TS project **cannot** be captured without a catalog. S8A-06 sends six mappings on a Python-only project, so it never tests the no-catalog case.

**Fix, smaller than Codex's catalog read and needed by L8 anyway:** accept `mappings: []`. When mappings are empty, use the existing `emptyArchitectureSnapshot` branch (`:689-692`) instead of `captureArchitectureSource`. That branch also avoids `unresolved > 2048` failures on large unmapped projects. Test: a TS project with `mappings: []` → file nodes and edges present, module layer `[]`.

## Item 9: acceptance weaker than the rows. PARTLY

Real gaps:
- **A-01 at AE1.** The public test lacks cap 2 → `capacity` and old observation → `not_captured`; both are covered only at service level with real workspace tools (`S8A-file-layer.test.ts:294,304`). A-01a checks `languages` and chunks by reading the record and artifacts (`:161-185`), which AGENTS rule 5 forbids. After item 7, assert `languages` through `listFiles`.
- **Chunking (missed by both).** 205 nodes is about 15 KB, so only one chunk is ever written; the split and the 64-chunk cap (`architecture-service.ts:251-273,721`) are untested. `buildFileGraphChunks` also re-serializes the growing array per element (O(n²)), which is slow near the caps.
- **SQLite.** Book §3 requires both backends; AE1 runs on memory only, and S8A-05's SQLite run never reads the file layer. Fix: run the AE1 fixture under `describe.each` with `{ kind: 'sqlite', directory }`.
- **Route.** A-02/A-02b say "走 `architecture/compare-formal`", but the route test only sends `{}`. One successful A-02b request through the route closes it.

Codex demands that go beyond the spec:
- **Fixed clock and literal time in the catalog-version test.** The catalog writer uses `new Date()` (`A/catalog-service.ts:712`), so this would need a production clock change outside 8A. The reason is already asserted as a literal. If the lead wants the spied database read removed, assert `t0 ≤ at ≤ t1` around the revise call.
- **`not_captured` at the platform entry.** It needs seeding a legacy record into the platform store. The service-level test is enough.
- **Capacity at the platform.** It needs a production option (`fileGraph` limits on `createTargetPlatform`). It is literally what the row says, but whether to add it is the lead's call.

## Item 10: duplicated cycle code. CONFIRMED; more than a suggestion

`formal-comparison.ts:58-113` is a line-for-line copy of `architecture-delta.ts:17-71`. Book §3 says "Reuse … `architecture-delta.ts` (diff, cycles)". **Fix:** export `stronglyConnectedCycles(nodeIds: string[], edges: {from,to}[]): string[][]` from `architecture-delta.ts`. `deterministicCycles` maps `fromNode`/`toNode` onto it, and the comparison calls it with file paths. About 55 lines go away.

## Other note (pre-existing)

The module body (≤ 256 KiB) lists each TS/JSON file three times (`files`, `changes.added`, `indexedSources`). I estimate the observation hits `capacity` near 900 short-path files, far below L12's 20,000. "模块级的不变" keeps this out of 8A.

## Summary

**Rework:**
1. Tolerant one-pass observation capture in the registry; strict `captureProjectSource` kept (design under item 1).
2. Same change: the file graph consumes the entry material; per-capture TS provider with `requestedConfigPath`; `parsed` counts TS only.
3. Skip same-module edges; `unknown` when X's files reach unowned or tied files, or own skipped/failed issues; all `unknown` when issues are truncated.
4. Scope, pin-linkage and digest checks through an exported `readRevisionByRef`; fix S8A-07.
5. `prefix` on the `pathOwnershipOf` result; delete both private matchers; drop the `.` filter; fix `note-related-scope.ts:335`.
6. Choose legacy or longest membership by whether the record has `fileGraph`.
7. `languages` on the file-graph pages; one-line `cursor_mismatch` guard.
8. Accept `mappings: []` → empty module layer; test with a TS project.
9. Public `languages` assertion, SQLite run of AE1, one route success, a multi-chunk test.
10. Shared `stronglyConnectedCycles`.

**Do not rework:**
- Catalog-time fixed clock (needs a production clock change outside 8A).
- `not_captured` and capacity at the platform entry (the service level with real tools is enough unless the lead wants a platform option).
- Codex's catalog-aware item-8 fix (replaced by the `[]` fix).

**Lead decisions:**
- Whether `other` files make a module's missing dependencies `unknown` (item 3).
- Whether `languages` must also be on the capture result (item 7).
