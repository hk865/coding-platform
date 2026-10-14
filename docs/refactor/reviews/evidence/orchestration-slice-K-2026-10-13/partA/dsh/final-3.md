All checks are complete and the workspace is clean. Here is the report.

**FILES CHANGED:**
- src/core/agent-runtime/continuation-brief-assembly.ts (modified — D7 retry outcome; D8 `hasRecordedEnd` gate)
- src/core/agent-runtime/session-operations.ts (modified — D9 null-location reason split)
- tests/composition/K-R-previous-turn-bounds.test.ts (new — D8 test-first, 2 tests)
- tests/scenarios/K-R-interrupted-brief.test.ts (modified — D10 `stopBefore: open_checks` + stopped-where-intended assertions)
- tests/scenarios/K-R-attested-facts-source.test.ts (modified — stopped-where-intended assertions)
- tests/scenarios/K-W-fallback.test.ts (modified — stopped-where-intended assertions)
- tests/scenarios/K-W-maintenance.test.ts (modified — stopped/settled assertions)
- tests/scenarios/K-W-workflow-close.test.ts (modified — stopped/settled assertions)

(The other 57 paths in `git status` are the inherited round-one/two L-scope changes; I edited none of the frozen files.)

**ROWS:**
- KA-09 | D8 test-first: `KA-09 (Runtime, L9/D8): an absent readTurnBounds is never needed for a recorded completed end, and the continuation brief is still built`; `KA-09 (Runtime, L9/D8): a live readTurnBounds that must not be consulted is never called for a recorded completed end` | RED `AssertionError: an absent identity seam does not refuse a normally completed Turn: expected 'retry' to be 'read'` | src/core/agent-runtime/continuation-brief-assembly.ts:`readPreviousTurn` (`hasRecordedEnd`)
- KA-09 | D7: code defect fixed; no new test (lead verifies the two C3-R2 tests with bubblewrap) | (degraded-brief branch removed) | src/core/agent-runtime/continuation-brief-assembly.ts :302–311 `return { kernel:'retry', code:'unavailable', … }`
- KA-09 | D10: `KA-09 (KE3, L9/M5)…` | test-defect fix, no RED | tests/scenarios/K-R-interrupted-brief.test.ts:110
- KA-12 | D9: reason only; no new test | (status unchanged) | src/core/agent-runtime/session-operations.ts :1023–1029 `readTurnBounds`
- KA-07/KA-08/KA-10/D2 | stopBefore audit additions (all pass) | no RED | K-W-workflow-close/K-W-fallback/K-W-maintenance/K-R-attested-facts-source

**CHECKS:**
1. `npm run typecheck` — exit 0.
2. `npm run check:architecture` — exit 0 (`next source boundaries: OK`).
3. `npm run build` — exit 0.
4. `node scripts/build-kernel-patch.mjs --check` — exit 0 (every artifact `matches: true`).
5. `npx vitest run tests/kernel` — exit 0; `Test Files 6 passed (6)`; `Tests 51 passed (51)`.
6. combined 14 frozen + `tests/{kernel,scenarios,composition,app}/K-` — exit 1; `Test Files 10 failed | 16 passed (26)`; `Tests 47 failed | 121 passed (168)`. All 47 are baseline — section B 35 + section D 12; every section-C flip passes; no K file fails. Failing files (all baseline): `A4-duplicate-receipts` (4, B), `A7-control-goal29` (2, D), `A7-control` (14, B/D), `A8-host-restart-entry` (7, B), `A8-host-restart-lease` (2, B), `A8-host-restart-paused` (7, D/B), `A8-host-restart` (3, B/D), `C3-paused-continue-brief` (1, B), `WP1-wiring` (3, D/B), `harness` (4, B). Their first lines are the known sandbox-kind ones (`expected 'waiting' to be 'completed'/'stopped'`, the re-drive trace mismatches, `ENOENT … '/usr/bin/bwrap'`, timed-out re-drive).
7. `npx vitest run` — exit 1; `Test Files 47 failed | 244 passed (291)`; `Tests 135 failed | 5871 passed | 29 skipped (6035)`; plus the baseline failed suite `tests/state/invariants.test.ts` (`Error: requeue 1: {"status":"rejected","code":"busy","reason":"finalize_first: round … is open"}`). An automated match of all 135 failures against `DSH-BASELINE.md` gives `baselineEntries=135, fails=135, matched=135, NEW=0`; the per-file counts are byte-for-byte the baseline (A 88 = the listed app/business/composition/scenario/work-graph/state files; B 35 and D 12 exactly as in command 6). All failures are marked **baseline**; **NEW = 0**. No K test appears.
8. `sha256sum DSH-BASELINE.md <spec> <14 tests>` — exit 0; all 16 values exact (`DSH-BASELINE.md 94a495a7…`, spec `b030a7f8…`, the 14 as in section 3).
9. `git diff --stat slice-base -- tests` — exit 0; empty.
10. `git status --short` — exit 0; 50 tracked L-scope paths (15 src, 7 patch sources, 28 generated dist) + 15 untracked new K test/helper files; HEAD still `97a0c00`; no staged files; no commit.

**UNSPECIFIED:**
- L9 (D7) done: an `unsupported`/`unreadable` `readTurnBounds` now returns `{ kernel:'retry', code:'unavailable' }`, so prepare rejects and pins no degraded brief (`continuation-brief-assembly.ts:309-311`). The full suite shows the C3-R2 `host_config` and `transient Kernel read` tests still fail only with `expected 'waiting' to be 'stopped'` (the sandbox kind); the lead verifies them with bubblewrap.
- L9 (D8) done: `readTurnBounds` is consulted only when the previous Run has no recorded `endPosition` (`continuation-brief-assembly.ts:305-321`); a Run with a non-null `endPosition` keeps `readPositionWindow`.
- L9/D2 reason (D9) done: the null-location case keeps `unsupported` but its reason is now `the Session Kernel store is not registered by this Host`; the legacy locator keeps `the Session Kernel store is legacy or another adapter` (`session-operations.ts:1024-1029`). No status changed.
- Spec does not describe: the C3-R2 retry now applies to an *other-session* fallback continuation too (an unreadable predecessor identity read makes the fallback successor's prepare wait); the K test `KA-12 … mapped Kernel adapter is no longer registered …` was asserting the retired `start` perform silently and now asserts the settle. The lead's recorded qualification (wait; operator archives/attests) covers it.
- No existing or frozen test was found to contradict the spec; none was edited.

**NOTES:**
- Worked alone (no subagents); one vitest command at a time. No git writes, no network, no real model, no edits to frozen files.
- D8 was done strictly test-first: new test RED (`expected 'retry' to be 'read'`), then the gate, then GREEN.
- stopBefore audit (D10 second clause): every `stopBefore` in the new K files was checked. One more never-occurring step was found (`K-W-maintenance.ts` KA-10 RUN-24 `requeue_task`) and one flow that now settles instead of reaching `start` (`K-W-workflow-close.ts` KA-12 absent-adapter); both were changed to assert `state: 'waiting', next: null`. `K-W-workflow-close.ts` KA-11(a)/(b)/KA-15 already asserted their `waiting` settle. All other uses now assert `next.operation.kind` equals the named step.
- `./.dsh-scratch/` was used for the two check logs and the baseline-match script, then deleted; `git status` shows no scratch.

**REVIEW:**
- **D7 — done.** `src/core/agent-runtime/continuation-brief-assembly.ts:309-311` (`readPreviousTurn`: `return { kernel: 'retry', code: 'unavailable', reason: bounds.reason }`). No K test depended on the degrade path; the two C3-R2 tests still fail here only with the sandbox kind (`tests/scenarios/C3-brief-idempotency.test.ts` C3-R2 (W-25) / (W-25) transient read).
- **D8 — done.** Test-first: `tests/composition/K-R-previous-turn-bounds.test.ts` (2 tests, RED confirmed) then the gate at `src/core/agent-runtime/continuation-brief-assembly.ts:305-321` (`hasRecordedEnd`; `readTurnBounds` only when no `endPosition`). Both tests pass; the interrupted KA-09 cases (`endPosition: null`) keep the identity seam and still pass.
- **D9 — done.** `src/core/agent-runtime/session-operations.ts:1024-1029`: null location → `unsupported`, `the Session Kernel store is not registered by this Host`; legacy → `unsupported`, `the Session Kernel store is legacy or another adapter`. Statuses unchanged.
- **D10 — done.** `tests/scenarios/K-R-interrupted-brief.test.ts:107-112`: drive now `stopBefore: 'open_checks'` and asserts `driven.next.operation.kind === 'open_checks'`; comment updated. Same kind of assertion added across the new K files where the stop step can occur, and settle assertions where it cannot (see NOTEs).