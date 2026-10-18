**P1 — done (RED → GREEN).** Moved the ready-capture abort check inside the `try` that owns the capture, so a ready capture cancelled at that boundary returns `cancelled` and reaches the `finally` release; a non-ready capture keeps cancellation-first precedence. RED: P1 failed `expected +0 to be 1` (release count 0). GREEN: 2 backends pass, release exactly 1, public `current` remains `null`.

**P2 — done (RED → GREEN).** Added an inner `catch` that decides `cancelled` vs the throw when caught, before cleanup; the outer catch no longer re-decides an already-decided post-capture throw. `releaseCaptureQuietly` keeps its fresh signal; `hasCommittedReceipt` and late-restore results are untouched. RED: P2 resolved `{code:'cancelled'}` instead of rejecting. GREEN: both backends reject with `injected verify failure`, release count 1.

**P3 — done (RED → GREEN).** `readArchiveChangedFiles` now checks the archive call’s own signal after the execution read (`:182`), in its catch first (`:177`), after `kernelFacts` (`:186`), after `briefWorkspaceFacts` (`:144`), before both worktree ready exits (`:150`, `:160`) and before the fallback (`:203`); `:123` retry unchanged. RED: old `ready`/`not_entered` and old `unavailable`. GREEN: new public-`archiveLine` row observes `rejected`/`cancelled` in both the return and throw rows; `S1-archive-files-brief` still 6/6.

**D — done.** Deleted the 15 cases at `416,437,458,482,514,533,561,584,615,636,662,686,708,738,772` in both backends, the `captureBody`/`requestBody`/`failureBody` helpers (`:391–404` incl. `failureBody`’s `:404` brace), and the `:409–413` comment. Kept `readAutoCapture` and `observationState` rows. Deleted assertion texts (36 lines): `pending` cancelled ×8; `first` committed non-replayed ×4; `state.status` ready ×3; `request` committed ×3; `current` non-null ×2; `after` ready/null ×2; `after` revision/requested ×2; `state.current:null` ×1; `result` committed ×1; `reads === 1` ×1; committed seq1 requested ×1; autoCapture seq1 requested pending ×1; committed replayed seq1 ×1; rejected unavailable ×1; restore throw ×2 (multiline); `before.status` ready ×1; committed revision+1 failed ×2. All row D.

**R — done.** After the replayed reply, a public read asserts `autoCapture { requestSeq: 1, pending: false }`; the request-2 adoption check remains the completion boundary. Host file 11/11.

**Production lines:** +29/−4 — `session-anomaly-facts.ts` +13/−0, `architecture-service.ts` +16/−4. No new helper, no allowlist change.

**D1 (s8l8-r3..WORKTREE):** 51 lines, all row D = 36 assertions above + 15 removed tests (`416…772`; 30 backend-expanded cases). `MOVED: 1`. Cumulative `slice-base..WORKTREE`: 15 lines, all pre-existing at r3 (`S8D`/`S8E`; not touched this round; the base detector does not count removals in files created after the base). **D3: 0 hits both runs.**

**Checks:** `S8A-L8-auto-capture-gate` 11/11; `S8A-L8-capture-start` 22/22; `S8A-L8-auto-capture-host` 11/11; `S1-archive-cancelled-reader` 2/2; regression `S1-archive-files-brief` 6/6 — all `--maxWorkers=2`, one at a time, 52 tests. `typecheck` both tsconfigs clean; `check:architecture` OK; `build` OK.

**FOUND:** none.

**UNSPECIFIED:** P3 runs SQLite only because `tests/helpers/S1-runtime-scenario-fixture.ts:159` hardcodes `createTaskClaimFixture('sqlite', …)`. Smallest options: parameterize that fixture’s backend in T, or accept SQLite-only for this reader row.