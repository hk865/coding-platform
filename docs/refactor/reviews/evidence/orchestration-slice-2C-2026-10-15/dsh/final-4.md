All work is complete and the scratch directory is removed. Here is the final report.

## FILES CHANGED
```
src/core/agent-runtime/runtime.ts                       (item 3 step 2: recordUnreadableProbe + the two `unreadable` call sites; kept from the stopped session, reviewed)
src/core/work-graph/state/session-availability.ts       (item 3 step 1: restored to slice-base; net diff none, sha256 = slice-base's faa806f1…)
src/core/work-graph/views/node-detail-reader.ts         (bounded reads: index cursors for participants/executions, cursor_mismatch, one hover archive-state read)
tests/helpers/S2C-D-node-support.ts                     (counting node store + seedRun for the bounded-read tests)
tests/scenarios/S2C-K-unknown-outcome.test.ts           (2C-22 (2) rewritten to the 2026-10-15 ruling; new (4) damaged attestation)
tests/scenarios/S2C-K-retired.test.ts                   (2C-21 (1) Query; (2) missing+damaged; (4) unbuildable comment)
tests/scenarios/S2C-K2-continue.test.ts                 (2C-39 (4))
tests/scenarios/S2C-K-archive-tags-checks.test.ts       (NEW; 2C-05 (1)(3)(3′)(4)(5); not runnable here)
tests/work-graph/S2C-node-detail-bounded.test.ts        (NEW; store-call counts)
tests/work-graph/S2C-node-detail-next-kinds.test.ts     (NEW; 2C-28 five `next` kinds × two backends)
```
`git status --short` = 79 entries, all under `src/` or `tests/`; `git diff --name-status slice-base -- tests` = new S2C files + `M tests/architecture/state-writes.test.ts` only; `.dsh-scratch/` deleted; no commit; frozen hashes unchanged.

## ROWS
```
2C-05 | S2C-K-archive-tags-checks.test.ts (1)(3)(3′)(4)(5) | written, not run here (registered check needs bwrap) | no product change
2C-21 | S2C-K-retired.test.ts (1) | passed first run (KE3 raw host fixture; no query-model hook) | no product change
2C-21 | S2C-K-retired.test.ts (2) missing / damaged | `expected undefined to be defined` (archive), then `expected 'missing'/'damaged' got 'kernel_turn_open'` | blocked, see ITEM 3
2C-22 | S2C-K-unknown-outcome.test.ts (2) missing, (4) damaged | `expected 'missing' got 'kernel_turn_open'` (pass 1) | runtime.ts:recordUnreadableProbe; machine unchanged
2C-28 | S2C-node-detail-next-kinds.test.ts (5 kinds × mem/sqlite) | passed first run | line-status.ts:deriveLineStatus / work-line-reader.ts
2C-28 | S2C-node-detail-bounded.test.ts (hover archive state) | expected 8 calls to equal 1 | node-detail-reader.ts:assembleHover
2C-30 | S2C-node-detail-bounded.test.ts (executions, participants, cursor) | `[3,3,3]` vs `[1,1,1]`; 9 vs 3; reason `the executions cursor is not readable` | node-detail-reader.ts readSection/runRefsByTask
2C-39 | S2C-K2-continue.test.ts (4) | `expected 'retired' to be 'paused'`, then `tasks/requeue expected 400 to be 200` | test fix only
```

## ITEM 3
- **What the probe/record does.** In `runtime.ts:createCloseOpenTurn`, on both `unreadable` outcomes — the step-5 mapped Kernel DB `missing`, and the Kernel closure answering `unreadable` (damaged) — it calls `recordUnreadableProbe`: re-probe via the same `owner.probe` `settleHealth` uses; only for verdict `missing`/`damaged` call `closure.recordSessionHealth` with that verdict; then return `unreadable` as before. Any other verdict, or a refused/failed write, changes nothing. Scope is only `runtime.ts`; the session machine was not touched.
- **Tests.** `2C-22 (2)` (missing) and the new `2C-22 (4)` (damaged) in `S2C-K-unknown-outcome.test.ts`: crash → restart → `outcome_unknown` → attest (RUN-22) → assert `kernel_turn_open` → maintenance pass 1 → assert the pass-1 health → maintenance pass 2 → assert archive. They currently pin the refusal (below).
- **The 9 tests pass unchanged** (run alone, `--maxWorkers=4`): A8-host-restart `W-14 and RUN-22`; A8-host-restart-attestation `RUN-22 (LA-8)` and `QRR-06 (LA-8)`; A8-host-restart-lease `Q-05 and QRR-06`; K-R-attested-facts-source `KA-09` (L9/D2, L9/D12, L9); K-W-maintenance `KA-14` first + second phase. All ✓; the same run's 5 failures (`A8-Q2`, `A8-H4`, `A8-3a`, §12.1 step 6b ×2) are all in `DSH-BASELINE.md` §A.
- **BLOCKED — the health owner refuses/ignores the transition; report as instructed.** `sessions/session-health.ts:89-100` calls `transitionSession(..., {kind:'health_observed', observed:'unavailable'})`; `state/session-availability.ts:856` sees `state.health === observed` (both `unavailable`, conclusion `kernel_turn_open`) and returns `done(state)` with **no effect** (SES-19); `session-health.ts:99-100` then returns `{status:'unchanged', reason:'the Session is already unavailable'}` and writes nothing. So after pass 1 the conclusion stays `kernel_turn_open`; pass 2 hits the `kernel_turn_open` exemption (`session-maintenance.ts:614-616`, `human_attested` is not a platform-clean interruption) and skips the line; it is never archived as retired and `lifecycle` stays `active`. The intended value after pass 1 is `missing`/`damaged`. Per the brief I did **not** change the session machine; the two tests pin the refusal with a `BLOCKED` comment naming the future change.

## GAPS
- **2C-05 (1)(3)(3′)(4)(5):** written in `tests/scenarios/S2C-K-archive-tags-checks.test.ts` through the real registered check; **not runnable here**. In-sandbox first failure (1): `Task ag2b-work must be satisfied through the real check: expected 'verifying' to be 'satisfied'`; (4)/(5) time out at 240 s. Comment at the top says the lead runs it under bwrap.
- **2C-21 Query variant:** `2C-21 (1) a Query line interrupted mid-Turn leaves kernel_turn_open, reads retired and the start-up maintenance skips it` — built (KE3 raw host fixture), passes.
- **2C-21 missing/damaged variants:** `2C-21 (2) a missing/damaged Kernel … maintenance cannot archive it (the health transition is refused)` — built, passes; pins the same SES-19 refusal.
- **2C-21 `legacyPending` variant:** cannot build in LE4 — today's writers always write provenance and no Host-scenario test has a public/storage-boundary hook to inject a provenance-null Session (only the non-Host `task-claim-fixture` can). Row + reason commented in the file.
- **2C-22 goal-card variant** (`unknown_outcome` reason card, `objects` empty, task pin in `source.pins`) — **not built**: no public service in this sandbox emits that card shape; it is reachable only at LE1 (`cardLineKeys`) with a hand-built fact set, which the row does not name.
- **2C-22 `kernel_turn_open` + unknown variant** — **not built**: at LE4 the only public path to `kernel_turn_open` is RUN-22 attestation, and K SES-10 then decides the Run's outcome (it is no longer `outcome_unknown`); the pair is not reachable through the public services here (the 2C-21 Query `kernel_turn_open` case is a different row/attention).
- **2C-21 (2) sub-details** (waiting-for-reply before retiring; two later undelivered replies; legacy overlay) — not built; they need a missing/damaged conclusion without an in-flight unknown Run, which the public path does not produce.
- **2C-28 five `next` kinds:** `2C-28 the task display … next equals the same-moment tasks/archive-state result` (5 cases × 2 backends). **2C-39 (4):** built with both paused Tasks arriving via responsibility transfer, because the Workflow reuses an idle Session for a new claim **without** writing the responsible link (see UNSPECIFIED); this is a deviation from the row's "one via transfer".

## BOUNDED READS
- Tests: `2C-28 the hover reads archive state only for tasks with an outstanding anchor`; `2C-30 the executions section reads only its own page from the run-by-task index`; `2C-30 the participants section reads only its own page from session-links-by-task`; `2C-30 a malformed cursor or one issued for another section is invalid/cursor_mismatch` (all run memory+sqlite).
- Before → after: hover archive state **8 `readTaskArchiveState` calls → 1** (only Tasks with an outstanding anchor) + 1 shared `listSessionAnomalies` per Goal; executions **`[3,3,3]` records/page → `[1,1,1]`** (one `r4c-run-by-task` page, index `after` encoded in `nextCursor`); participants **9 link records total → 3** (one page of `session-links-by-task` per page); a malformed/foreign cursor now returns `invalid`/`cursor_mismatch` (was `the executions cursor is not readable`). `owners` stays byte-identical to `lines/list`. No `work-line-reader.ts` change.

## CHECKS
```
npm run typecheck                            exit 0
npm run check:architecture                   exit 0
npm run build                                exit 0
node scripts/build-kernel-patch.mjs --check  exit 0
targeted (--maxWorkers=4, scale excluded)    1 failed file | 50 passed (51); 5 failed | 496 passed (501)
scale alone (--maxWorkers=2)                 1 passed (1); 10 passed (10)
full (--maxWorkers=8)                        49 failed | 309 passed (358); 155 failed | 6477 passed | 29 skipped (6661)
sha256sum DSH-BASELINE.md                    96727ad0ed226ae01355491a61c3fe391cf3f37ede5e1686e09aa539792fe0c2 ✓
sha256sum slice-2C-SPEC.md                   35ac3560009e238893580fe3fbd47194015394266de00955f94572e033b7a674 ✓
git diff --name-status slice-base -- tests   new S2C files + M tests/architecture/state-writes.test.ts only
git status --short                           79 entries, all src/ or tests/; .dsh-scratch/ deleted; no commit
```
- Scale numbers (unchanged from round 3): memory `m=4 r=78 w=73 z=1 sharedCalls=10699 sharedMs=1383`; sqlite `m=4 r=78 w=73 z=1 sharedCalls=10699 sharedMs=4862`; `fullListCalls=10699 budgetedSum=3491 nonBudgeted=7208`; `LINE_HISTORY_READ_BUDGET=100` unchanged.
- Failures **not** in the baseline (all in one file, expected): `tests/scenarios/S2C-K-archive-tags-checks.test.ts` — `2C-05 (1)` first line `Task ag2b-work must be satisfied through the real check: expected 'verifying' to be 'satisfied'`; `2C-05 (3)`, `2C-05 (3′)`, `2C-05 (4)`, `2C-05 (5)` (the last two 240 s timeouts here). These are the "written, not run here" cases; the lead runs the file under bwrap.
- `tests/state/invariants.test.ts [ … ]` (`beforeAll` `requeue 1: … "finalize_first: …"`) is the baseline's "+1 suite" (the baseline records 48 files / 150 tests; 47 named files + this suite). All 150 baseline test entries still fail.

## UNSPECIFIED
- **Item 3 is blocked by the session machine (SES-19)** exactly as described under ITEM 3; no machine or maintenance change was made. `runtime.ts:recordUnreadableProbe` is therefore inert today (the health write always answers `unchanged`), kept per step 2 and forward-compatible if the machine later accepts `unavailable/kernel_turn_open → missing|damaged`.
- **Bounded-reads cursor tradeoff:** the `participants` cursor carries the emitted line keys (`seen`) so cross-source dedup survives paging; it grows with distinct participant lines. The `risks` section is genuinely derived from the shared in-memory task graph, so it keeps an offset cursor (validated `invalid`/`cursor_mismatch`) with the source documented; per-page store reads remain shared/bounded. Hover makes two `listSessionAnomalies` reads per Goal (its own batch plus the line assembly's), by design not shared.
- **Fixture reach:** `tests/helpers/S2C-D-node-support.ts:seedRun` commits a raw `RunSnapshot` + `TrustedScopeSeeded` at the storage boundary (same shape as the existing `task-claim-fixture.ts`), beyond the §7 named exceptions; flagged for the lead.
- **Possible product bug (reported, not fixed):** when the Workflow reuses an idle Session for a new Task claim it does not write the responsible link (`sessions/create` initialLinks / `sessions/transfer-responsibility` are the only writers; `chooseSession`/`chooseExcluded` do not exclude a Session with an open task link). This forced the 2C-39 (4) construction through two transfers and makes a line omit a Task it is running.
- **Spec/port type mismatch:** spec §2 declares `LineTaskArchiveNextV1.rework_blocked.code: string`, but `SessionAnomalyPort.readTaskArchiveState` returns `TaskArchiveNextV1` with `code: TaskReworkRefusalCode`; the new test uses the real type.

## NOTES
- Two subagents, max 2 at once, serialized by `.dsh-scratch/vitest-lock.sh`: A = bounded reads (node-detail-reader + counting tests), B = coverage gaps (2C-05/21/28/39). I did item 3 (2C-22) and integration. No regrouping.
- Item 3 round-3's `session-availability.ts` is restored; the 9 previously-broken tests all pass; the runtime probe was reviewed and type-checks, but the machine's SES-19 makes it a no-op.
- The 2C-05 checks file is intentionally red here; its (4)/(5) cases hit the 240 s test timeout rather than failing fast — worth confirming under bwrap.
- A2 measurement (scale, alone): memory `m=4 r=78 w=73` shared `10699` calls / 1383 ms; sqlite `m=4 r=78 w=73` shared `10699` calls / 4862 ms; `r,w ≤ 100`, budget holds.
- Slowest in-sandbox tests: the two 2C-05 checks cases at 240 s each; the scale file passed alone.
- No commit, no git write, no network, no real model calls; scratch deleted; frozen hashes unchanged.