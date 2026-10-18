All work is complete and verified.

# Reply

## FILES CHANGED

**Production (1 file, +28/−11, net +17):** `session-maintenance.ts` — `reviewClaimCanRun` returns `active | inactive | unreadable`; `closableWorkRun` returns `boolean | null`; `tryCloseDanglingTurn` returns `true` (skip, no write) on `null`; ordinary unmet preconditions still fall through.

**Tests (5 files, +373/−182, net +191):** `S1-session-maintenance.test.ts` (+170), `S1-workflow-archive-fixture.ts` (+6, additive `plans`/`turnClosure` overrides), `K3-29-recovery-round.test.ts` (+12 net, reindent), `K3-08-wait-reply.test.ts` (+6), `K3-R1-restart-flows.test.ts` (−3).

## ITEMS — RED → GREEN

1. **Unreadable Goal** — RED both memory and SQLite: pass 1 closed on the failed read (`health available`, `healthConclusion null`, revision 5 vs expected `unavailable`/`kernel_turn_open`/revision 4). GREEN: new IT35 pass 1 zero writes (session/run/review revisions, audit events/totals, `archived: []`); pass 2 active Goal defers (2 Goal reads, still zero writes); pass 3 paused Goal closes via the real Runtime `closeOpenTurn`. S1 file 11/11; `K3-29-maintenance-review-run` 3/3.
2. **Early releases** — moved old lines 287, 312, 375, 648 to final `finally` (K3-27 pattern), original-Session and quiet-restart assertions unchanged. No other early `crashed.release()` found. No deterministic RED (latent: targeted 4 passed before and after); whole file 8/8, continuation+extras 9/9.
3. **Old close assertions** — RED: K3-08 line 166 missing `close_open_turn`; K3-R1 line 177 `closeStep` undefined. GREEN: both files 5/5. Added after start-up maintenance: Session `available`, `lastExecutionRef.runId` = original Run; continuation stays in original Session; removed the `close_open_turn` requirement only.

## CHECKS

- K3/K: **85 files / 476 tests** — 461 pass, 15 fail (all baseline-A `K-readonly-sandbox`).
- business/state/WP1/A8: **62 files / 4066 tests** — 4011 pass, 26 fail, 29 skipped (all baseline; 1 baseline suite).
- composition/architecture/changed: **48 files / 219 tests** — 198 pass, 21 fail (all baseline composition).
- Changed files re-verified: **4 files / 24 tests pass**.
- `typecheck` 0, `check:architecture` 0, `build` 0. No new failures, no fixes needed.

## UNSPECIFIED

1. `deps.plans === undefined` now maps to `unreadable`/skip (previously closed). Options: (a) keep as written; (b) only failed reads are `unreadable`, absent port keeps closure. Recommend (a).
2. Baseline drift noticed, untouched files: `S2B-be1s-shell > 2B-09` now passes (21 vs 22 baseline failures); A8-3n baseline title stale. Options: (a) leave `DSH-BASELINE.md` to the lead; (b) amend. Recommend (a).
3. Item 2 has no reproducible RED: it is a fixture correction; pre-change 4/4 passed.