All checks are green. Here is the final report.

## FILES CHANGED

**Production — 1 new file, 22 lines; 8 modified files, +359/−46 → ≈381 new production lines this session** (`tool-commit-lookup.ts` 22; `run-reconcile-service.ts` 225; `create-platform.ts` 96; `runtime.ts` 37; `startup-reconcile.ts` 19; `run-reconcile.ts` 15; `ports.ts` 9; `task-failure.ts` 3; `host.ts` 1). Group 2 so far ≈ **2,820** production lines.

**Tests:** `A2-reconcile-runtime.test.ts` +382 (11 new K3-21/22 cases + `assertK3_23Quiet`; I added 3 `stop_pending` cases + a real RUN-25 happy case); new `K3-24-unknown-outcome-stability.test.ts` 348; new `K3-48-…-creation-budget.test.ts` ~90; `harness.ts` +126 and new `K3-store-wrapper-seam.test.ts` 51 (subagent); `S2B-be2-reconcile-support.ts` +6. **Seams:** store wrapper done; stand-in `shell`, git-workspace and person-stopped Run not built (not this session).

## FINDINGS
1. **Streak (Q4)** — done: `readStreakFacts` walks `previousChainRefOf`/`chainRunIds`-style, reads each chain Run and its record by key, calls `streakOf`; every read is a commit guard (absent record = absent guard); failure → `unavailable`. Wired for RUN-25 and RUN-22.
2. **G7 (Q5)** — done: `readSessionClosable` uses `createSessionFactsService(...).readSessionFacts`; active + no archive + empty `continuations` + `legacyPending === false` + occupancy this Run + `latestWork` this Run same generation; failure → `unavailable`.
3. **`UnknownCallReviewChanged@1`** — done: written in both commits (`created`, whole record, identity/fingerprint/actor/requestId). The reconcile event is last so `eventAt(receipt.cursor)` replay still restores the Run; removed the allowlist entry.
4. **Real Host** — done: `StartupReconcileDependencies.takeover` → `reconcileRunAtStartup`; `ReconcileLine.autoCleanup` copied; `create-platform.ts` wires `turnClosureSupport` (new `RuntimeExecutionPort` read-only K L4 item 5 check), `captureWorkspace` (manifest `workspaceBaseline`, root+`WORKSPACE_DENIED_PREFIXES`, traversal, capture Artifact) and `lookupToolCommit` (owner dispatch). Also fixed the report: RUN-25 is `W-26`/`takeover_unresolved`; blocked cases read the committed observation's `autoCleanupBlockedBy` (was wrongly `applied:true`).
5. **One draft builder** — already single: kept `readUnknownCallReviewDraft`; `readReviewDraftAtEntry` only reads Kernel facts then delegates; `readAttestationFacts` remains for the Query path.
6. **Allowlist** — fixed `listReviews`/`listUnappliedAnswers` to group 3; removed 8 now-reached entries.

## ITEMS
1. **K3-21** — classifier cases (`inputs_unconfirmed`, `workspace_unstable`, `workspace_too_many_changes`, 33-call and 513-byte-callId `inventory_incomplete`, several-guards, plus the pre-existing five) and `stop_pending` queued pause/cancel: done, green. **Not done:** `session_not_closable`, `second_auto_cleanup`, applied pause. `review_round` skipped (no public review-purpose Run) → group 3. Queued steer skipped (spec conflict, below).
2. **K3-22/K3-23** — done (probe missing→RUN-20(ii), host_config→left, terminal+unresolved→RUN-20(i), closeOpenTurn→`kernel_closed_without_platform_end`; `assertK3_23Quiet` applied to all 10 cases). **K3-24** — done (一)(二) green; (三) limited to the reachable pre-K3 shape.
3. **K3-48(一)** — done at the creation owner: 32 over-budget items → kept in Kernel order, `incomplete`/`too_large`/`needs_decision` + `inventory_incomplete`, dropped callIds absent. R3 "G11 did not block" half not asserted.
4. **Store wrapper seam** — done: `HostScenarioOptions.failNextLookupCommitOnce` + `HostScenario.failNextLookupCommitOnce()`, 3 self-tests green.

## CHECKS
Final batch `--maxWorkers=3`: **4,376 total, 4,323 passed, 22 failed, 31 skipped**; all 22 are baseline (21 A8 + 1 `invariants-fuzz` coverage) — I confirmed by stashing `src` (baseline A8 = same 21). `npm run typecheck` clean; `npm run check:architecture` OK; `npm run build` OK. Targeted: A2 30 (29 pass/2 skip), K3-24 3/3, K3-48 2/2, seam 3/3.

## UNSPECIFIED
1. **G4 vs K3-30 conflict.** K3-21 lists a queued steer under `stop_pending`, but a steer never moves `run.controlState` (it appends to `controlInputs`), and L25's RUN-25 "what it writes" reconciles queued steers (CTL-08(b)/(c)); accepted K3-30 asserts RUN-25 for `ctxAuto({queuedSteers:[steer]})`. I kept the spec/group-1 behavior and left the case `it.skip`. Options: amend the K3-21 row, or change `pointerAfterSubmit` for steers (large behavioral change).
2. `session_not_closable` and `second_auto_cleanup` not written; both need a public Session-archive writer / a chain-building requeue that R3 does not expose.
3. `captureWorkspace` uses `WORKSPACE_DENIED_PREFIXES` as the Host's denied prefixes (no per-Host option exists); capture content type named locally.

**Surprise:** part 1's reply counted "11 A8 sandbox" failures but this environment shows 21 at baseline — same set with and without my changes. And group 1's `sessionClosableFor` plus a missing `W-26` path meant `autoCleanup.applied` was reported true even when the WorkGraph had blocked RUN-25.