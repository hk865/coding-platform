**FILES CHANGED:** (working tree vs `slice-base`; all L-scope)
```
src/business/workflow/contracts.ts
src/business/workflow/session-maintenance.ts
src/business/workflow/workflow.ts
src/composition/create-platform.ts
src/contracts/continuation-brief.ts
src/core/agent-runtime/context-assembler.ts
src/core/agent-runtime/continuation-brief-assembly.ts
src/core/agent-runtime/contracts.ts
src/core/agent-runtime/execution-contracts.ts
src/core/agent-runtime/execution-observation.ts
src/core/agent-runtime/ports.ts
src/core/agent-runtime/query-observation.ts
src/core/agent-runtime/run-reconcile.ts
src/core/agent-runtime/runtime.ts
src/core/agent-runtime/session-operations.ts
vendor/coding-agent/patches/app/composition/composition-contracts.ts
vendor/coding-agent/patches/core/ports/session_store/session-history.ts
vendor/coding-agent/patches/core/runtime/events/agent-events.ts
vendor/coding-agent/patches/core/runtime/reducer/run-state-reducer.ts
vendor/coding-agent/patches/core/runtime/state/run-state.ts
vendor/coding-agent/patches/public-api.ts
vendor/coding-agent/patches/storage/adapters/sqlite/sqlite-stores.ts
vendor/coding-agent/dist/app/composition/composition-contracts.{d.ts,d.ts.map,js,js.map}
vendor/coding-agent/dist/core/ports/session_store/session-history.{d.ts.map,js,js.map}
vendor/coding-agent/dist/core/ports/session_store/session-store-port.{d.ts,d.ts.map}
vendor/coding-agent/dist/core/runtime/events/agent-events.{d.ts,d.ts.map,js,js.map}
vendor/coding-agent/dist/core/runtime/reducer/run-state-reducer.{d.ts.map,js,js.map}
vendor/coding-agent/dist/core/runtime/state/run-state.{d.ts,d.ts.map,js,js.map}
vendor/coding-agent/dist/public-api.{d.ts,d.ts.map,js,js.map}
vendor/coding-agent/dist/storage/adapters/sqlite/sqlite-stores.{d.ts,d.ts.map,js,js.map}
tests/app/K-R-runtime-capabilities.test.ts               (new)
tests/composition/K-R-close-open-turn.test.ts             (new)
tests/composition/K-R-close-open-turn-health.test.ts      (new)
tests/composition/K-R-observers-kernel-closed.test.ts     (new)
tests/helpers/K-boundary-facts-support.ts                 (new)
tests/helpers/K-legacy-reader-support.ts                  (new)
tests/helpers/K-session-support.ts                        (new)
tests/kernel/K-close-open-turn.test.ts                    (new)
tests/kernel/K-interrupted-history.test.ts                (new)
tests/scenarios/K-R-attested-facts-source.test.ts         (new)
tests/scenarios/K-R-interrupted-brief.test.ts             (rewritten)
tests/scenarios/K-W-fallback.test.ts                      (new)
tests/scenarios/K-W-maintenance.test.ts                   (new)
tests/scenarios/K-W-workflow-close.test.ts                (new)
```
(The generated `dist/*` files above are the 28 artifacts the full set rewrites; the abbreviated brace notation lists each of the 28 paths. `tests/composition/K-R-facts-source.test.ts` was created and then deleted this session — it is absent, not changed.)

**ROWS:** (this session's fixes; RED messages are the first failure seen. `no RED` = review-mandated coverage/quality correction where the production behaviour already existed.)

- D3 | `K-close-open-turn.test.ts` "D3 reconciles a same-closure append collision … already_closed … never unreadable"; "D3 returns a retryable conflict … did not close this Turn" | `AssertionError: expected { status: 'unreadable', … } to deeply equal { status: 'already_closed', … }` (`idempotency_conflict`) | `vendor/.../sqlite-stores.ts:closeOpenTurn` + `reconcileClosureCollision`
- KA-02 | `K-close-open-turn.test.ts` "KA-02 returns the table's row 1-4 and 6 results …"; "KA-02 cuts a non-last Turn's bounds at the next turn.started …" | no RED (expectations replaced by hand-counted 3/4/4, 2/4, 2/6) | none (Kernel already correct)
- KA-05 | `K-interrupted-history.test.ts` "KA-05 keeps the boundaries right … and still refuses … an identity overlap with a skipped Turn" | no RED (public route already rejects; third refusal added) | `vendor/.../session-history.ts:restoreSessionHistory` (existing overlap guard)
- KA-06 | `K-interrupted-history.test.ts` "KA-06 replays an interrupted identity straight to its terminal with no model call, no tool execution and no store write …" | no RED (removed `readAllRecords`/`listCheckpoints`; real `before_tool` pause + `SqliteStores.prototype.append` instrumentation) | `vendor/.../resume-composition.ts:resumeCodingAgentInternal` (existing)
- D1 | `K-R-interrupted-brief.test.ts` "KA-09 (KE3, L9/M5)…"; `K-R-attested-facts-source.test.ts` "KA-09 (KE3, L9): a platform position record that lags the Kernel …" | `AssertionError: RED probe: the platform window alone reports running: expected 'running' to be 'interrupted'` | `continuation-brief-assembly.ts:readPreviousTurn/readInterruptedTurnWindow`; owner `session-operations.ts:readTurnBounds`
- D2 | `K-R-attested-facts-source.test.ts` "KA-09 (KE3, L9/D2): an entered, locator-less, attested requeue continuation is its own facts source …" | `AssertionError: the attested Run proves entry through its Kernel Turn: expected '<run1-id>' to be '<run2-id>'` | `context-assembler.ts:assembleBriefForContext/runEnteredKernel`
- D4 | `K-R-observers-kernel-closed.test.ts` ×2 | `AssertionError: expected { status: 'ready', … } to match object { status: 'rejected', … }` | `execution-observation.ts` (after reduction, before `confirmMailboxInputs`); `query-observation.ts` (after `collectTurn`)
- D5 | `K-R-close-open-turn.test.ts` "…does not publish `readTurnBounds` (M2, D5)"; "…does not publish `closeOpenTurn` (M2, D5)" | `AssertionError: expected { status: 'closed', … } to match object { status: 'unsupported' }` | `runtime.ts:createCloseOpenTurn`
- D6 | `K-R-close-open-turn.test.ts` "KA-12 maps an available Session whose probe reports host_config to the retryable transient, never unsupported (L4, D6)" | `AssertionError: expected { status: 'unsupported', … } to match object { status: 'transient' }` | `runtime.ts:createCloseOpenTurn`
- KA-09 | `K-R-interrupted-brief.test.ts` base + Host-restart; `K-R-attested-facts-source.test.ts` lag + locator-less variants | (first RED was a harness ordering error; the public brief behaviour itself landed in session 1) | `continuation-brief-assembly.ts`; `contracts/continuation-brief.ts` (M5)
- KA-10 | `K-W-maintenance.test.ts` "…operator archive request is archived, never closed first"; `K-W-fallback.test.ts` "…the successor exclusion holds with closure enabled…" | no RED | `session-maintenance.ts:maintainSessions/tryCloseDanglingTurn`; `workflow.ts:claimRequeued/hasContinuationForTask`
- KA-11 | `K-W-workflow-close.test.ts` "KA-11 (a) … exactly the next Kernel store read fails once"; "(b) … then a Host restart" | no RED | `runtime.ts:settleHealth` + `workflow.ts:performStep`
- KA-12 | `K-W-workflow-close.test.ts` four KE4 causes: unsupported / unreadable / mismatch / legacy-only reader + "the mapped Kernel adapter is no longer registered by this Host" | first RED `…expected { status: 'rejected', … } to match object { status: 'rejected', … }` (`not_found` vs `unavailable`); absent-adapter RED `…expected { status: 'ready', … } to match object { status: 'rejected', … }` | `workflow.ts:fallbackAfterClose`; `runtime.ts:createCloseOpenTurn`
- KA-13 | `K-W-fallback.test.ts` "KA-13 … with closure now AVAILABLE the next start still replays it …" | no RED | `workflow.ts:claimRequeued/hasContinuationForTask`
- KA-14 | `K-W-maintenance.test.ts` "KA-14 … second phase … its brief lists the interrupted steps" | no RED | `continuation-brief-assembly.ts:toolFactsOf` + `session-maintenance.ts:tryCloseDanglingTurn`
- KA-15 | `K-W-workflow-close.test.ts` "KA-15 … a real concurrent append at the Kernel store boundary moves the revision …" | no RED (D3 production was landed under D3) | `sqlite-stores.ts:closeOpenTurn/reconcileClosureCollision`; `workflow.ts:performStep`
- KA-01, KA-03, KA-04, KA-07, KA-08, KA-16, KA-17: covered in session 1; still pass, unchanged.

**CHECKS:**
1. `npm run typecheck` — exit 0.
2. `npm run check:architecture` — exit 0.
3. `npm run build` — exit 0.
4. `node scripts/build-kernel-patch.mjs --check` — exit 0.
5. `npx vitest run tests/kernel` — exit 0; `Test Files 6 passed (6)`; `Tests 51 passed (51)`.
6. `npx vitest run <14 frozen + tests/{kernel,scenarios,composition,app}/K->` — exit 1 (expected); `Test Files 10 failed | 15 passed (25)`; `Tests 47 failed | 119 passed (166)`. All 47 = `DSH-BASELINE.md` §B (35) + §D (12), NEW = 0; the 10 §C flips pass; all 55 new `K-` tests pass; no K test needs a registered check/sandbox, so none to name. Failures [baseline]:
   - `A4-duplicate-receipts` ×4 [§B]: `expected 'waiting' to be 'completed'` / `'stopped'` / `'stopped'` / `'completed'`.
   - `A7-control` ×14 [§B 13, §D 1]: `expected 'waiting' to be 'completed'` (12×), VD-9 `expected ENOENT '/usr/bin/bwrap' to contain 'the Goal is paused…'`, D-trace ends `close_open_turn` → `waiting ENOENT /usr/bin/bwrap run_check`.
   - `A7-control-goal29` ×2 [§D]: `expected 'waiting' to be 'completed'`.
   - `A8-host-restart-entry` ×7 [§B]: `expected 'waiting' to be 'stopped'`.
   - `A8-host-restart-lease` ×2 [§B]: `expected {ref…} to match {effectivePhase:'satisfied'}`; `expected 'waiting' to be 'completed'`.
   - `A8-host-restart-paused` ×7 [§B 1, §D 6]: `effectivePhase 'verifying'` vs `'satisfied'` (2), `timed out … auto_rework_pending` (2), bwrap trace (1), `the continuation r2 must be claimed` (2).
   - `A8-host-restart` ×3 [§B 2, §D 1]: `waiting`/`completed` (2), `completed the Goal without a workflow/advance` (1).
   - `C3-paused-continue-brief` ×1 [§B]: `expected 'waiting' to be 'completed'`.
   - `WP1-wiring` ×3 [§B 1, §D 2]: `expected 'waiting' to be 'completed'`.
   - `harness` ×4 [§B]: two `ArrayContaining` mismatches, `expected [] to deeply equal ['PASS']`, `expected 'waiting' to be 'stopped'`.
7. `npx vitest run` — exit 1; `Test Files 47 failed | 243 passed (290)`; `Tests 135 failed | 5869 passed | 29 skipped (6033)`. §A 88 + §B 35 + §D 12 = 135; NEW = 0; per-file counts match the baseline exactly; plus the known `tests/state/invariants.test.ts` sandbox suite. (290 = 287 baseline + 3 new K files; 6033 = 6020 + 13 new K tests.)
8. `sha256sum <16 files>` — exit 0; 16/16 exact (`DSH-BASELINE.md 94a495a7…`, spec `b030a7f8…`, all 14 tests).
9. `git diff --stat slice-base -- tests` — exit 0; empty (no tracked/existing test changed).
10. `git status --short` — exit 0; 64 entries, all L-scope (15 `src`, 7 patch sources, 28 generated `dist`, 14 new `K-` test/helper files); no path outside L-scope.
- `./.dsh-scratch/` deleted; `git rev-list --count slice-base..HEAD` = 0; HEAD `97a0c00`; no commit.

**UNSPECIFIED:**
- L1 done (`events/agent-events.ts`, `run-state.ts`, `run-state-reducer.ts`; tests D4 observer tests, KA-03). L2 done rows 1–7 including the D3 collision reconciliation; row 5 remains defensive per spec (test-exempt). L3 done (`session-history.ts:TERMINAL_EVENT_TYPES`/skip-interrupted content; KA-04/KA-05). L4 done; the reviewer's L4 step-4 deviation is now fixed (available + active Kernel head → `refused('health')`, `runtime.ts:createCloseOpenTurn`, `K-R-close-open-turn-health.test.ts`). L5 done. L6/L7 done (receipt table, single maintenance insertion; KA-11/KA-15). L8 done; retryable platform reads (`unavailable`/`cancelled`/`busy`) now map to `transient`, not `unreadable` (`runtime.ts:platformReadFailure`, test in `K-R-close-open-turn-health.test.ts`). L9 done with the D1/D2 fixes; L10 done; L11/M4/M5/M6 done in session 1 and still pass.
- Accepted qualifications: a missing Session makes `readTurnBounds` return `unreadable`; an unusable successor enumeration maps to `transient`; an interrupted Turn's brief keeps `stoppedAt.lastToolGroup`/`toolCalls` and drops `lastAssistant`.
- D2 disposition kept (reported, not changed): `runEnteredKernel` over-approximates "any `human_attested` Run entered"; when `readTurnBounds` is unsupported/unreadable the brief degrades to the prior facts with `kernel:'unavailable'`. The stored platform facts cannot separate entered-locator-lost from never-entered-attested, and L9 line 193 requires the incomplete read to be `unavailable` (never "not entered"); the identity read is the discriminator when the store is readable. Spec L9 lines 188–195/193.
- KA-10 provenance exclusion (`facts.legacyPending || provenance === null`): not reachable through the public Host (creation normalizes provenance); left uncovered, spec line 430/543.
- KA-12 unreadable history: the public route answers an honest refusal without a fixed code; the K test asserts `rejected` and leaves the code loose, the frozen A8 expectation (`code:'unavailable'`) arises from a different `missing` health path — no contradiction.
- KA-12 "another adapter" and the legacy reader share one `unsupported` reason string; the tests distinguish them by fixture plus the history verdict (`ready` for a legacy reader, `rejected` for an absent adapter).
- KA-06: the checkpoint itself cannot be asserted through a public interface (M7); the "no write" proof uses `SqliteStores.prototype.append` boundary instrumentation on a replay fixture with real (paused) tool work that must not execute.
- No existing or frozen test was found to contradict the spec.

**NOTES:**
- 14 subagents, serialized waves (one vitest at a time): K implementer → R implementer → W implementer → K/R/W read-only reviewers → R fixer (D2/KA-09 + reviewer defects 4/5) → W fixer (KA-12 legacy reader) → R/W re-reviewers → R cleanup (retired `K-R-facts-source.test.ts`) → W second fixer (KA-12 absent adapter) → final section-5 checker + W confirmation reviewer. All reported; none left running.
- D3 was the only new production RED in group K; KA-02/05/06 were test-quality corrections. R's D1/D2/D4/D5/D6 and W's rows were production-complete and corrected by public-entry tests; the reviewer found and this session fixed two extra R defects (L4 step 4, retryable-read classification) and two missing KA-12 causes.
- The codex review's five must-fix production defects and one should-fix are all fixed with tests at the required entries; every "Must fix"/"Should fix" row now has its required public case.
- No bubblewrap here; sandbox-kind baseline failures untouched, never faked. No real model calls, no network, no ports 3080/3099/44797, no git write commands, no commit.
- Blockers: none.

**REVIEW:**
- **Finding 1 (Must fix) — FIXED.** The brief locates the Turn by exact Kernel identity via injected `readTurnBounds` read at call time and derives state + accepted messages from `[startPosition,endPosition]`; over-limit/unreadable → `unavailable`/incomplete, never `not_entered`/`running`/`paused` fallback, never `lastAssistant`. Tests: `tests/scenarios/K-R-interrupted-brief.test.ts` (base + restart), `tests/scenarios/K-R-attested-facts-source.test.ts` (lagging platform position). Impl: `continuation-brief-assembly.ts:readPreviousTurn/readInterruptedTurnWindow`; `session-operations.ts:readTurnBounds`; `runtime.ts:createCloseOpenTurn` (call-time seam).
- **Finding 2 (Must fix) — FIXED.** Entered-but-locator-less Runs are distinguished using the stored entry facts; the public KE3 case now exists: `tests/scenarios/K-R-attested-facts-source.test.ts` "an entered, locator-less, attested requeue continuation is its own facts source…" asserts `factsFrom`/`previous` = the attested Run (would be the older ancestor with the bug). Impl: `context-assembler.ts:assembleBriefForContext/runEnteredKernel`.
- **Finding 3 (Must fix) — FIXED.** Append collisions now reconcile against refreshed bounds+header: same closure → `already_closed` at the closure position with a revision read after the bounds; otherwise retryable `conflict`; never `unreadable`. Tests: `tests/kernel/K-close-open-turn.test.ts` real two-connection append race ×2; `tests/scenarios/K-W-workflow-close.test.ts` KA-15 store-boundary append. Impl: `vendor/coding-agent/patches/storage/adapters/sqlite/sqlite-stores.ts:closeOpenTurn/reconcileClosureCollision`.
- **Finding 4 (Must fix) — FIXED.** Work and Query observers guard immediately after reduction, before `confirmMailboxInputs`/locator advance/`outcome_unknown`, write nothing, and report `kernel_closed_without_platform_end`. Test: `tests/composition/K-R-observers-kernel-closed.test.ts` (public `closeOpenTurn` on a live Run; zero commits, report, no confirmation). Impl: `execution-observation.ts`, `query-observation.ts`.
- **Finding 5 (Must fix) — FIXED.** Runtime resolves `closeOpenTurn` **and** `readTurnBounds` from the injected kernel dependency on every call; either absent → `unsupported`, no write; each absence tested independently, plus a call-time toggle. Tests: `tests/composition/K-R-close-open-turn.test.ts`, `tests/composition/K-R-close-open-turn-health.test.ts` (M2). Impl: `runtime.ts:createCloseOpenTurn`.
- **Finding 6 (Should fix) — FIXED.** An available Session whose probe reports `host_config` maps to retryable `transient`. Test: `tests/composition/K-R-close-open-turn.test.ts` (host_config). Impl: `runtime.ts:createCloseOpenTurn`.
- **KA-02 (Should fix) — FIXED.** Expected bounds/positions are now hand-counted from the fixture (3/4/4, 2/4, 2/6), not stored output. `tests/kernel/K-close-open-turn.test.ts`.
- **KA-05 (Must fix) — FIXED.** Third refusal added exactly as the review routes it (close B, fresh run id, B's turn id, cursor at B's closure). `tests/kernel/K-interrupted-history.test.ts` ("…identity overlap with a skipped Turn"). Caveat noted: the `.rejects.toThrow()` is generic, so a duplicate-record rejection could also satisfy it; the overlap guard itself is unchanged (`session-history.ts:restoreSessionHistory`).
- **KA-06 (Must fix) — FIXED.** No checkpoint/store readback; assertions are run result, model-request count, probe-handler counter and `SqliteStores.prototype.append` instrumentation; the fixture pauses on real tool work that would execute on a bad replay. `tests/kernel/K-interrupted-history.test.ts`.
- **KA-09 (Must fix) — FIXED.** Base + restart + lagging-position + locator-less-attested variants all go through KE3 `executions/brief` with known message/steer/tool ids; the private-helper/fabricated-record file was retired. `tests/scenarios/K-R-interrupted-brief.test.ts`, `tests/scenarios/K-R-attested-facts-source.test.ts`, helper `tests/helpers/K-boundary-facts-support.ts`.
- **KA-10 (Must fix, partial) — FIXED for the public causes.** Successor and archive-request exclusions with closure enabled (`tests/scenarios/K-W-fallback.test.ts`, `K-W-maintenance.test.ts`); the provenance-null exclusion is not publicly reachable and is reported under UNSPECIFIED (spec line 430/543).
- **KA-11 (Must fix) — FIXED.** One-shot failure on exactly the next Kernel store read (no test-side DB repair) and explicit `waiting`; plus the restart/startup-recovery variant. `tests/scenarios/K-W-workflow-close.test.ts`.
- **KA-12 (Must fix) — FIXED.** All four L8 causes through real KE4 workflows: unreadable store, head mismatch, legacy-only reader (new helper `tests/helpers/K-legacy-reader-support.ts`), and missing/another adapter; plus the M2 disabled-closure case. `tests/scenarios/K-W-workflow-close.test.ts`; defensive row 5 still exempt.
- **KA-13 (Should fix) — FIXED.** Closure re-enabled before rebuilding the Host; the recorded successor still protects the predecessor (no second `create_session`, no `close_open_turn`). `tests/scenarios/K-W-fallback.test.ts`.
- **KA-14 (Must fix, partial) — FIXED.** Unknown-outcome call ids/statuses reach the public continuation brief through KE3 (`executions/brief` lists the injected started-but-unfinished call as `outcome_unknown`). `tests/scenarios/K-W-maintenance.test.ts`.
- **KA-15 (Must fix) — FIXED.** A real concurrent `store.append` at the Kernel store boundary moves the revision; the receipt is retryable `conflict` (not `unreadable`), the drive is `waiting` with no fallback/archive, and a later drive closes and continues in the same Session. `tests/scenarios/K-W-workflow-close.test.ts` (covers D3).