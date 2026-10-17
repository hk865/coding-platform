## FILES CHANGED

Production net **+11**: `workspace/capture.ts` +17/−6 (records the first failed import analysis on the frozen material; `captureFileGraph` reuses it instead of re-analysing TS); `architecture/architecture-service.ts` +2/−2 (one generic forbidden reason). Tests: `tests/work-graph/S8A-file-layer.test.ts` +45/−8. Three files, no new files; the main session edited no `src/`/`tests/` files.

## ITEMS (RED → GREEN)

1. **One analysis outcome:** added `analysisFailure` to `CaptureMaterial`; `captureOp` stores the failure message; `captureFileGraph` skips the TS provider and emits `parsed=0`, `edges='failed'`, the stored reason; the module layer then takes the existing empty-snapshot path. `S8A-21` RED (`captured` rejected `invalid`: `expected 'rejected' to be 'committed'`) → GREEN. `S8A-14` unchanged and green.
2. **Refusal hides the path:** both the node and issue grant checks return the book's one generic reason. `S8A-20` RED (`JSON.stringify(listFiles)` contained `private/bad.ts`) → GREEN.

## CHECKS (`--maxWorkers=2`)

`tests/data` + `tests/architecture` 24 files/205; all `S8A-*` 9/65; `platform.test` 1/2; S4B/S4C/SP/S3/S2C/R3d 60 files/589 (5 skip); conflict+catalog 6/47; routes 10 files/49 pass, 2 fail — the same pre-existing baseline pair (`A2-requeue-route`, `A2-reverify-route`), no new failures. `npm run typecheck` 0, `npm run check:architecture` 0, `npm run build` 0. No real model calls, no git writes, no ports 3080/3099/44797; `.dsh-scratch/` removed.

## UNSPECIFIED

None.