## FILES CHANGED

**Production: 5 files, +91/−58 (net +33), all modifications.** `workspace/capture.ts` +34/−9; `architecture/architecture-service.ts` +37/−42; `architecture/graph-index.ts` +8/−4; `architecture/formal-comparison.ts` +8/−2; `views/graph-context-reader.ts` +4/−1. **Tests: 4 files, +125/−0.** No new files. The main session edited no `src/`/`tests/` files.

## ITEMS (RED → GREEN)

1. **Observation config skip:** wrapped `analyzer.analyze` observation-only; on failure keeps `snapshot.files` (line counts), `relations/sources/diagnostics=[]`, `coverage.complete=false`, `projectConfiguration=null`, `resolvedConfigPath=requested`; strict still rejects. `captureFileGraph` adds a deduped `failed` issue on `entry.requestedConfigPath` when the TS provider fails with an explicit config. `S8A-14` RED (rejected) → GREEN.
2. **Tied skipped files:** `formal-comparison.ts` issue loop consumes `ownershipOf` directly — owner adds that module, tie adds every tied module, `other` stays excluded. `S8A-19` RED (`proven`) → GREEN.
3. **Root path search:** `findGraph` seeds all modules for needle `.` via the existing `modulesMatchingPath`. `S8A-18` RED (only M1, memory+sqlite) → GREEN.
4. **File anchors:** `resolveAnchorNodes` runs `pathOwnershipOf` over **all** mappings, then filters winners by `nodeIds`. `S8A-04b` RED (`[module:A]`) → GREEN.
5. **Grant narrowing:** `loadFileGraph` builds `languages` first and rechecks every issue path; uncovered → `forbidden`. `S8A-20` RED (ready) → GREEN.
6. **One file-page helper:** extracted `readFilePage` (load → old-observation `cursor_mismatch`/`notCapturedPage` → page → attach `languages` → map `FileGraphCursorError`); each entry keeps its argument checks and paging function. Existing tests unchanged and green.

## CHECKS (`--maxWorkers=2`)

`tests/data/` 20 files/152; `tests/architecture/` 4/53; all `S8A-*` 9/64; `S4B-*` 29/259 (4 skip); `S4C-*` 17/149; `SP-*` 4/36 (1 skip); `S3-graph-context` 1/60; `S2C-node-detail-*` 6/50; `R3d-*` 3/35; conflict+catalog 6/47; `platform.test` 1/2; routes 10 files/49 pass, **2 fail**. `npm run typecheck` exit 0, `npm run check:architecture` exit 0, `npm run build` exit 0. The 2 route failures are the pre-existing DSH-baseline ones (`A2-requeue-route` check_failed vs verification_running; `A2-reverify-route` stopped vs waiting); not edited. No integration breaks; no allowlist change.

## UNSPECIFIED

- **Module-layer `projectConfiguration` on analysis failure.** The book fixes the language issue and the empty module layer, not this field. I chose `null` (smallest option): the persisted-body codec (`architecture-record-codecs.ts:415`) requires a non-null config path to be among the frozen files, and the NUL config was skipped; naming it would need a synthetic file, contradicting "keeps the frozen files". Alternative: name the requested config and relax the codec.
- **Item 6 helper callback type.** It returns the page data without `captureRef`/`languages` (the helper attaches them); returning a full `FileGraphPageV1` is the alternative.

## SUBAGENTS

5 total (4 work + close-out); **most at once = 3** (wave 1: item 1 / item 2 / items 3+4; item 1 then corrected under the ruling; wave 2: items 5+6; then close-out). All vitest used `--maxWorkers=2`; no real model calls, no git writes, no ports; probes deleted.