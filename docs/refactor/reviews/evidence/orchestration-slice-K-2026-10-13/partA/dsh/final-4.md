**FILES CHANGED** (working tree; `git diff --stat slice-base -- tests` is empty = no existing test file touched; the rest are new `K-` files)

This session's edits:
- `src/core/agent-runtime/continuation-brief-assembly.ts` — D11 (in `readPlatformTurnWindow`)
- `src/core/agent-runtime/context-assembler.ts` — D12 (in `assembleBriefForContext`)
- `tests/scenarios/K-R-attested-facts-source.test.ts` — D11 + D12 public tests (D2 setup factored out)
- `tests/composition/K-R-previous-turn-bounds.test.ts` — D13 full rewrite
- `tests/composition/K-R-observers-kernel-closed.test.ts` — D13 full rewrite
- `tests/composition/K-R-close-open-turn-health.test.ts` — D13 full rewrite (all four tests de-fabricated)
- `tests/composition/K-R-close-open-turn.test.ts` — D13 rewrite of the D5/D6 tests (around 221+)
- `tests/helpers/K-t1-support.ts` — NEW helper (`ownedRuntimeRoot`, `buildRun24KernelOpen`, `scenarioFiles`)
- `tests/kernel/K-interrupted-history.test.ts` — D14
- `tests/scenarios/K-W-maintenance.test.ts` — D15 archive case
- `tests/scenarios/K-W-workflow-close.test.ts` — D15 four KA-12 cause archival assertions
- `tests/scenarios/K-R-interrupted-brief.test.ts` — edited then fully reverted by group R; net content unchanged (162 lines)

Carried from the earlier three sessions (unchanged this session): the `src/business/workflow/{contracts,session-maintenance,workflow}.ts`, `src/composition/create-platform.ts`, `src/contracts/continuation-brief.ts`, the remaining `src/core/agent-runtime/*` slice files, the `vendor/coding-agent/patches/**` sources and their generated `vendor/coding-agent/dist/**` outputs, and the new `K-` test/helper files `tests/helpers/K-{session,boundary-facts,legacy-reader}-support.ts`, `tests/kernel/K-{close-open-turn,interrupted-history}.test.ts`, `tests/scenarios/K-{R-interrupted-brief,W-fallback,W-maintenance,W-workflow-close}.test.ts`, `tests/composition/K-R-close-open-turn.test.ts`, `tests/app/K-R-runtime-capabilities.test.ts`.

**ROWS** (rows touched this session in bold; the rest are unchanged and green here)

| Row | Test name(s) | RED first seen | Impl file:symbol |
|---|---|---|---|
| KA-01..KA-04 | `tests/kernel/K-close-open-turn.test.ts` (prior session) | — | Kernel patch (prior) |
| **KA-05** | `K-interrupted-history.test.ts` > `KA-05 keeps the boundaries right …identity overlap with a skipped Turn` (plus its two sibling refusals tightened) | — (assertion tightening, D14) | `vendor/coding-agent/patches/core/ports/session_store/session-history.ts:395` (`历史前缀包含当前 Turn`) |
| KA-06 | `tests/kernel/K-interrupted-history.test.ts` (prior) | — | prior |
| KA-07 | `K-W-workflow-close.test.ts` > `KA-07 (KE3, L4/L7) a person continues a paused-interrupted Run …` | — | prior |
| KA-08 | `K-W-workflow-close.test.ts` > `KA-08 …` | — | prior |
| **KA-09 / D11** | `K-R-attested-facts-source.test.ts` > `KA-09 (KE3, L9/D11) a cross-Session continuation of an interrupted Run reads the recorded platform window, not a Kernel fact appended after it` | `AssertionError: the recorded platform position is the boundary: expected 11 to be 3` | `continuation-brief-assembly.ts:readPlatformTurnWindow` |
| **KA-09 / D12** | `K-R-attested-facts-source.test.ts` > `KA-09 (KE3, L9/D12) a never-entered, requeued Run between the attested Run and the prepared Run leaves the attested Run as the nearest facts source` | `AssertionError: the attested Run 2 is the nearest entered ancestor: expected 'ff5912d8…' to be '559e6b9a…'` | `context-assembler.ts:assembleBriefForContext` |
| **KA-09 / D8** | `K-R-previous-turn-bounds.test.ts` > `KA-09 (Runtime, L9/D8) a live readTurnBounds … never called for a recorded end …` and `… an absent readTurnBounds …` | — (entry rewrite, D13) | `continuation-brief-assembly.ts:readPreviousTurn` |
| **KA-09 / D4** | `K-R-observers-kernel-closed.test.ts` > `D4 (L1) the Work observer …` / `… the Query observer …` | — (entry rewrite, D13) | `execution-observation.ts` / `query-observation.ts` |
| **KA-10** | `K-W-maintenance.test.ts` > `KA-10 (KE3, L7) a RUN-19 line whose operator archive request … archived by the next maintenance, never closed first` (D15); `KA-10 … human-paused RUN-24 line is not closed` / `KA-10 (KE3, L7/KA1) …` (prior) | — (assertion added) | `session-maintenance.ts` |
| KA-11 | `K-W-workflow-close.test.ts` > `KA-11 (a)/(b)/(c)` | — | prior |
| **KA-12** | `K-R-close-open-turn.test.ts` > `KA-12 answers unsupported … readTurnBounds (M2, D5)`, `… closeOpenTurn (M2, D5)`, `KA-12 maps an available Session whose probe reports host_config … transient (L4, D6)`; `K-R-close-open-turn-health.test.ts` all four; `K-W-workflow-close.test.ts` four `KA-12 (KE4, L8)` cause cases (D15) | — (entry rewrite + assertions) | `runtime.ts:createCloseOpenTurn` |
| KA-13 | `K-W-fallback.test.ts` > `KA-13 …` | — | prior |
| KA-14 | `K-W-maintenance.test.ts` > `KA-14 …` | — | prior |
| KA-15 | `K-W-workflow-close.test.ts` > `KA-15 …` | — | prior |
| KA-16 | `K-W-fallback.test.ts` > `KA-16 …` | — | prior |
| KA-17 | `tests/app/K-R-runtime-capabilities.test.ts` > `KA-17 …` | — | prior |

**CHECKS** (all on the final tree)

```
npm run typecheck                              exit 0
npm run check:architecture                     exit 0
npm run build                                  exit 0
node scripts/build-kernel-patch.mjs --check    exit 0
npx vitest run tests/kernel                    exit 0  Test Files 6 passed (6) | Tests 51 passed (51)
npx vitest run tests/app/A2-runtime-capabilities.test.ts ... tests/app/K-   exit 1
                                               Test Files 10 failed | 16 passed (26) | Tests 47 failed | 123 passed (170)
npx vitest run tests/kernel/K- tests/scenarios/K- tests/composition/K- tests/app/K-
                                               exit 0  Test Files 12 passed (12) | Tests 59 passed (59)
npx vitest run                                 exit 1  Test Files 47 failed | 244 passed (291)
                                               Tests 135 failed | 5,873 passed | 29 skipped (6,037)
sha256sum <16 frozen files>                    all 16 MATCH
git diff --stat slice-base -- tests            (empty; only new untracked files)
git status --short                             only L-scope src/, vendor/, new tests/
```

Targeted run: every failure is in the 10 frozen scenario files, each `baseline` (sections B/D of `DSH-BASELINE.md`); **NEW = 0**; all 10 section-C flips pass; no K test fails. Per-file failing-test counts and first line (all `baseline`, sandbox kind — a registered check cannot run / Workflow waiting on it):
- `A7-control.test.ts` 14: `AssertionError: expected 'waiting' to be 'completed'` / `…{ state:'waiting' } to match { state:'completed' }` / `AssertionError: expected 'ENOENT…' to contain …check process…`; `G-04 and GOAL-29` and `G-04 and G-06` show `["waiting","ENOENT: …/bwrap","run_check"]`.
- `A8-host-restart-paused.test.ts` 7: `expected 'waiting' to be 'completed'` / `… to match { effectivePhase:'satisfied' }` / `Error: timed out waiting for the start-up re-drive…auto_rework_pending` / `Error: the continuation r2 must be claimed`.
- `A8-host-restart-entry.test.ts` 7: `expected 'waiting' to be 'stopped'`.
- `harness.test.ts` 4: `expected [ … ] to deeply equal ArrayContaining{…}` / `expected [] to deeply equal [ 'PASS' ]` / `expected 'waiting' to be 'stopped'`.
- `A4-duplicate-receipts.test.ts` 4: `expected 'waiting' to be 'completed'/'stopped'`.
- `WP1-wiring.test.ts` 3: `SC01` ×2 `expected 'waiting' to be 'completed'`; `SC02` `expected 'waiting' to be 'completed'`.
- `A8-host-restart.test.ts` 3: `A8-3a` waiting/completed; the two `§12.1 step 6b` `start-up re-drive completed … without a workflow/advance`.
- `A8-host-restart-lease.test.ts` 2: `A8-Q2` `… match { effectivePhase:'satisfied' }`; `A8-H4` waiting/completed.
- `A7-control-goal29.test.ts` 2: `expected 'waiting' to be 'completed'`.
- `C3-paused-continue-brief.test.ts` 1: `expected 'waiting' to be 'completed'`.

Full suite: 135 failed = exactly baseline A(88)+B(35)+D(12); the name-set diff against the baseline lists shows the **only** extra marker is the baseline failed suite `tests/state/invariants.test.ts` (DSH-BASELINE line 5, sandbox kind); no baseline test newly failed; **NEW = 0**.

**UNSPECIFIED**
- D11's "fact appended later" is a genuine `assistant.message_completed` + `tool.started` (`injectRunningToolCall`), not `run.input_accepted`: a locator-bearing Run is past its drained `before_model` boundary, where the Kernel refuses `run.input_accepted`; a locator-less Run never reaches the D11 platform-window path. The test asserts a genuine post-window Kernel fact is absent and the boundary is the recorded one.
- D12's intervening never-entered Run 3 is public: drive to `stopBefore:'start'` (claimed), person `controls/submit cancel` (RUN-09, no `executionHistory`), then `tasks/requeue`; no fabrication.
- D8's literal "normally completed" Run is only requeueable after a registered check (needs bubblewrap), so the rewrite uses a person's cancel — a real Kernel terminal that records `endPosition`, exercising the same `hasRecordedEnd` gate (`continuation-brief-assembly.ts:305`). The literal `completed` outcome needs a bwrap run.
- D8/D4 rewritten tests read through the public `executions/brief`, `platform.runtime.observeRun`, and the Host `queries/observe` route (the harness has no query-hold hook for `platform.runtime.observeQuery`).
- D13 was scoped by the lead to `K-R-close-open-turn.test.ts` "around 221 onward"; the earlier KA-12 cause tests (lines ~135–220) still use trusted test doubles (`run19()`/`sessionRecord()`), but they already enter through the real Runtime `closeOpenTurn` port. The four rewritten `K-R-*` files contain no private assembly helper and no fabricated Session/Run/requeue record.
- Health tests 2–3 use a `turnClosure.recordSessionHealth` placeholder in the runtime bundle around the owned root; it is never invoked (the read faults abort before the health step) and nothing asserts on it.
- Provenance-null exclusion: not reachable through today's creation (`session-directory.ts:789` normalizes and rejects explicit null); no test — recorded as the lead's spec qualification (D15).
- No existing or frozen test contradicts the spec.

**REVIEW: problems 1–5**
- **1 — fixed.** D11: the ordinary `readPlatformTurnWindow` now reads only through `endPosition ?? observedThroughPosition`; only the `locator === undefined` identity-derived same-Session path reads to the tail (`src/core/agent-runtime/continuation-brief-assembly.ts:244-251`). Test: `KA-09 (KE3, L9/D11) a cross-Session continuation of an interrupted Run reads the recorded platform window, not a Kernel fact appended after it` (`tests/scenarios/K-R-attested-facts-source.test.ts`).
- **2 — fixed.** D12: `assembleBriefForContext` walks `[previous, ...factsChain]` nearest-first and selects the first `runEnteredKernel` candidate whose read is not `not_entered`; `factsHops` = its index; `sameSession` is computed against the selected candidate; `retry` is returned; the no-entered fallback is unchanged (`src/core/agent-runtime/context-assembler.ts:743-770`). Test: `KA-09 (KE3, L9/D12) a never-entered, requeued Run between the attested Run and the prepared Run leaves the attested Run as the nearest facts source`.
- **3 — fixed.** D13: `K-R-previous-turn-bounds.test.ts` now drives the real Host/Workflow and reads the public `executions/brief`; `K-R-observers-kernel-closed.test.ts` builds real live Work/Query state, closes the real live Turn through the public Kernel `closeOpenTurn`, and observes through the real Runtime; the `K-R-close-open-turn.test.ts` D5/D6 tests and all four `K-R-close-open-turn-health.test.ts` tests now run over real owned-lease composition roots with the D5 capability toggled on the injected Kernel dependency. No private assembly helper and no fabricated Session/Run/requeue record remain in those four files.
- **4 — fixed.** D14: the third KA-05 refusal now asserts `/历史前缀包含当前 Turn/` (`tests/kernel/K-interrupted-history.test.ts:429`), matching `session-history.ts:395`; the other two refusals in that test are tightened to their source-confirmed messages (`/outcome_unknown/`, `/不是已完成轮次的稳定边界/`).
- **5 — fixed.** D15: the archive-request case (`tests/scenarios/K-W-maintenance.test.ts`) now proves no closure happened before the archive via public `executions/read` (`endPosition` null), public `sessions/read` (`lifecycle: archived`), and a `closeOpenTurn` counter that stays 0; each of the four KA-12 cause cases (`tests/scenarios/K-W-workflow-close.test.ts`) asserts the predecessor's archival through public `sessions/read`. The provenance-null exclusion is not tested (unreachable; recorded qualification).

**NOTES**
- Subagents: group R (D11/D12 production + public tests, test-first with RED captured), group T2 (D14/D15 assertions), group T1 (D13 rewrites, then a follow-up to de-fabricate the health file). All reported; none still running.
- Group R briefly saw a typecheck error while T1 was mid-edit; resolved after T1 finished.
- Full suite was re-run after the final health rewrite; numbers unchanged and baseline-clean.
- No git write commands, no model calls, no network, no ports touched; no probes left (`.dsh-scratch` absent).