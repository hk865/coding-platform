**ITEM 1 — the one Host recognition path (GREEN).** `K3-blocked-command-fixture.ts` (578→561) deleted its own `createSessionHistoryCursorOwner` + `createRunReconcileService` + `reconcileRunAtStartup` + `readReviewDraftAtEntry` + `reconcile.resolveUnknownRun` assembly (zero hits for those names now). It opens ONE `openRealRunHarness(world)` per world and every `seed` recognizes through `harness.createRecord(claim)` (`createTargetPlatform` + `reconcile.reconcileRun` + public `resolveUnknownRun`, real `lookupToolCommit`/`captureWorkspace`). The K3-35 platform is cached per harness/world. 401 world: build **216,132 ms → 204,847 ms** (file 225.9 s → **207.2 s**; B2 group 209.62 s).

**ITEM 2 — K3-48-3 (GREEN).** The 32-item record/RUN-20/22 `paddedOwner` and both constructed drafts left the owner scenario. New pure `K3-48-3-extremes-pure.test.ts` (219, 3 tests) builds the input over the production record codec/state machine: `bytes === 158,720`, round-trip, `bytes(settled) > B`, required writes admitted, all ≤512 KiB; the 513-path refused by the codec and its registered schema. Owner row (112 lines) now: real `createK3PendingReview` → `settleK3Review{review_unavailable}` → real `holdReview` (2,000 chars) → `releaseHold`, every read ≤512 KiB; I restored memory too (`it.each`), 2/2. Changed assertions: the B-boundary arithmetic moved to pure; owner item count 32→1 (reachable).

**ITEM 3 — preconditions through public steps (GREEN).**
- `K3-review-workflow-rows` ~299: real claim + `prepareAndStart` with a `beforeReply` throw → Runtime `crashed` (31).
- `K3-06-mixed-kinds-owner` ~101/166/228: `createK3PendingReview`→`claimK3ReviewRound`→`recordK3Conclusion`→`endK3RunCompleted`→`settleK3Review`; both backends (4). The 3-kind record moved to `K3-06-mixed-kinds-pure`.
- `K3-13-two-items-owner` ~112/177/232: same chain, one real item, no conclusion → `undetermined`; both backends (2). The two-item/one-conclusion combination moved to the same pure file (2).
- `K3-26` ~775: real pending→claim→conclusion→Runtime completed end→settle (37).
- `K3-47-claim-gate` ~69: real records; absent row via Runtime crash; unreadable via delegating wrappers (22, both).
- `K3-47-reader-facts` ~136: real records + `autoSettled`+`holdReview`; absent via crash (14, both).
- `K3-15-review-routes` ~129: real hold/release rows (5, both).
- `K3-15-ur3h` ~156: real claim/hold/cancel (8, both).
- `K3-15-hold-release` ~108: real hold/release (6, both).
- `K3-18-autonomy-facts` ~119: real record (6, both).
- `K3-29-startup-reconcile-2b` ~117: real 513-byte-callId record; pending/held/round via helpers (5).
- `K3-41-release-hold` ~402: real blocked Run+pause+`createRecord`+hold; I restored the two `describe.each` memory rows (7).
- `K3-43-continuation-vs-hold` ~104 and `K3-43-review-claim-vs-hold` ~89: real records/claims, memory+SQLite (4+6).
Unreachable combinations (Kernel serial batch records only the started call) are stated in the pure file.

**ITEM 4 — both backends (GREEN).** The shared Host recognition shares the world's ONE backend: for memory, a test-only `vi.spyOn` wraps `createInMemoryRecordBackend` for the synchronous `createTargetPlatform` call and returns `world.records` (platform close leaves the world open); SQLite shares the directory ledger. No production change. Restored: K3-16 three (approval-application, proposal-write, second-unfinished-proposal; round fixture too), K3-17-goal-guard one, K3-20-paging both; also K3-06/K3-13, K3-43 (2+3), the four C1 files, K3-48-3, K3-41. Remaining single-`'sqlite'` worlds are rows already single-backend at HEAD (e.g. K3-29, K3-35-owner).

**ITEM 5 — K3-18's decision row (GREEN).** With the edit stand-in holding a real `edit` call, `createRecord(claim,{probe:{verdict:'damaged',…}})` makes RUN-20 book `kernel_unreadable`; the public RUN-22 re-reads the now-readable Kernel: observed `inventory:'incomplete'`, `inventoryProblem:'kernel_unreadable_at_stop'`, one `kind:'file_edit'` item, `status:'needs_decision'`, `decisionReasons:['inventory_incomplete']`. K3-18 (8/8) restored the old file annotation → `invalid` “an annotation names an object outside the card”, re-read shows the new digest. K3-15-disposition-effects (11/11) restored the real file-object annotation (`- 批注（src/x.ts）…`) through the real disposition write.

**ITEM 6 — B2-02 (GREEN).** Exported the existing per-world `runIdGeneratorOf` (`B2-crr-world.ts`) and passed `newId` to `openLaterHookRun`'s `openRealRunHarness`; B2-02 now does the real `requeue` → real `claimRun` of the later Run and asserts the later Run's identity (1/1; RED was “requeueRef cannot cover its own Run”). 11 B2 consumers pass.

**ITEM 7 — manifest measure (GREEN).** The pure test now builds the complete legal 25-field `PreparedTaskManifestV1` (real contextAssembly/continuationBrief/sessionBasis/workspaceBaseline/blockedCommands, nonempty base input) and measures `JSON.stringify(manifest)` exactly as `execution-preparation.ts:555`. Fitted **241,190 B ≤ 262,144**; previous step **268,682 B > 262,144**; instruction 41,732/46,039 ≤65,536.

**ITEM 8 — hook timeouts (GREEN).** Setup measured 1,377/976/1,255 ms alone; 1,572/1,109/1,515 ms with the other K3-35 files. Each `beforeAll` now ends `60_000`; each `afterAll` starts `if (facts === undefined) return;`. 7/7 across the three files.

**CHECKS (one command at a time, `--maxWorkers=2`).** K3 109 files/571 tests 116.30 s exit 0 (K3-48-3 and K3-41 then re-ran 2/2 and 7/7 after restoring their memory rows → 573); B2 34/193 209.62 s exit 0; K-* 7/61 18.63 s exit 0; broad set + changed files 256 files/5,459 tests 437.25 s — 5,377 passed, 53 failed, 29 skipped, all 53 in `DSH-BASELINE.md` (composition A2/R3e/R5c/S2B, A8-host-restart, C3 briefs, S5-goal-conflict, WP1, R5b, state fuzz), no new failure. `npm run typecheck` 0, `check:architecture` 0, `build` 0 (both re-run after my last edits; typecheck 0). No src changes. `.dsh-scratch/` deleted.

**Helper lines:** 5,193 → **5,209** (+16 net; +106/−90: K3-35 +24, blocked −17, B2-blocked +3, B2-crr +6).

**Ledger** (`.dsh-ref/k3-g4b3-closeout-grep.txt`, 165 files, 192 lines): 145 hits — **(a) 57, (b) 19, (c) 39, (d) 30; defects 0**; each hit has file:line, pattern, category, reason.

**UNSPECIFIED.** (1) The memory recognition seam is test-only (`vi.spyOn` on the module export around `createTargetPlatform`'s synchronous backend creation); smallest alternative: an optional `storage.backend` production seam. (2) 29 pre-existing `openK3ReviewCardWorld('sqlite')` sites that were not memory rows before rework 5 remain single-backend; the spec's “service-layer both” is met for every row rework 5 dropped and every item-3 owner row. (3) K3-06's wrong-kind row intentionally keeps a built draft as the *input under test* (category a); the multi-item combinations are pure by necessity.