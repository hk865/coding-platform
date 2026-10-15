**FILES CHANGED:**

Production — added
- src/business/workflow/activity-backfill.ts
- src/contracts/run-activity.ts
- src/core/agent-runtime/run-activity-reader.ts
- src/core/agent-runtime/run-activity-tally.ts
- src/core/work-graph/persistence/read-result-failures.ts
- src/core/work-graph/persistence/run-activity-codecs.ts
- src/core/work-graph/tasks/goal-executed-files-reader.ts
- src/core/work-graph/tasks/run-activity-codecs.ts
- src/core/work-graph/tasks/run-activity-service.ts
- src/core/work-graph/views/activity-read-model.ts
- src/core/work-graph/views/task-state-timeline.ts
- src/core/work-graph/views/track-read-model.ts

Production — modified
- src/app/core-http-types.ts, src/app/core-routes.ts, src/app/host.ts
- src/business/workflow/contracts.ts, src/business/workflow/ports.ts, src/business/workflow/workflow.ts
- src/composition/create-platform.ts
- src/contracts/ledger.ts
- src/core/agent-runtime/execution-observation.ts, ports.ts, run-reconcile.ts, runtime.ts
- src/core/work-graph/evidence/evidence-service.ts
- src/core/work-graph/model/execution-entry-contracts.ts
- src/core/work-graph/persistence/control-record-codecs.ts, decision-record-codecs.ts, evidence-record-codecs.ts, execution-entry-codecs.ts, plan-record-codecs.ts, rework-codecs.ts
- src/core/work-graph/queries/query-record-codecs.ts
- src/core/work-graph/tasks/execution-entry-service.ts, plan-readers.ts, run-reconcile-contracts.ts, run-reconcile-service.ts
- src/core/work-graph/views/goal-conflicts.ts
- src/ui/api/routes.ts

Production — deleted
- src/core/work-graph/tasks/executed-files-stub.ts

Tests — added
- tests/app/S2B-35-activity-routes.test.ts, S2B-41-decision54-backfill-bound.test.ts, S2B-backfill-host.test.ts, S2B-backfill-workflow.test.ts, S2B-be2-late-evidence-activity.test.ts, S2B-be2-run09-activity.test.ts, S2B-be2-run18-activity.test.ts, S2B-be2-run23-activity.test.ts, S2B-be2-startup-reconcile-activity.test.ts
- tests/composition/S2B-39-run17-activity.test.ts, S2B-40-run20iii-activity.test.ts, S2B-be1-counting-failure.test.ts, S2B-be1-cross-hour.test.ts, S2B-be1-five-tools.test.ts, S2B-be1-step-boundaries.test.ts, S2B-be1-usage.test.ts, S2B-be1s-shell.test.ts
- tests/helpers/S2B-activity-fixture.ts, S2B-be1-platform-fixture.ts, S2B-be1r-kernel-faults-support.ts, S2B-be1r2-support.ts, S2B-be2-reconcile-support.ts, S2B-counting-off-support.ts, S2B-kernel-records-fixture.ts, S2B-runtime-store-fixture.ts, S2B-runtime-tools-support.ts, S2B-task-timeline-fixture.ts, S2B-track-fixture.ts, executed-files-stub.ts
- tests/runtime/S2B-15-end-retry-activity.test.ts, S2B-36-observer-cancel-reread.test.ts, S2B-37-observer-reread-failure.test.ts, S2B-38-run08-unknown-activity.test.ts, S2B-44-backfill-late-evidence-race.test.ts, S2B-45-inprocess-run21-activity.test.ts, S2B-tally.test.ts
- tests/work-graph/S2B-30-track-bars.test.ts, S2B-31-task-timeline-main.test.ts, S2B-32-task-timeline-fold.test.ts, S2B-33-task-timeline-pagination.test.ts, S2B-34-executed-files.test.ts, S2B-activity-calendar-tasks.test.ts, S2B-activity-calendar.test.ts, S2B-activity-read-faults.test.ts, S2B-run-activity-read.test.ts

Tests — modified (only the §5.3 edits)
- tests/app/S5-decision-routes.test.ts
- tests/architecture/production-reach-allowlist.json
- tests/helpers/S2A-window-fixture.ts, S5-application-support.ts, S5R2-b-support.ts, S5R2-c-support.ts
- tests/scenarios/S5-goal-conflict-rework.test.ts
- tests/work-graph/S5-decision-queue.test.ts, S5-goal-settings.test.ts, S5-notices.test.ts, WP2-context-extensions.test.ts

**ROWS:**

```
row | test name(s) | first RED | impl file:symbol
2B-01 | S2B-tally "2B-01 row 1 … row 10", not-started, non-edit tools, unresolvedCalls/turnTerminal (13) | Cannot find module '../../src/core/agent-runtime/run-activity-tally.js' | run-activity-tally.ts:tallyTurnActivity
2B-02 | "2B-02 a call starting 10:59:50…", "…10:44 and 10:46…", "…1,001 quarters…", "…span times…" | expected [] to equal [ { at:'2026-10-14T10:45:00.000Z', steps:1 } ] | run-activity-tally.ts:quarterStart/omittedOverflow
2B-03 | "2B-03 changed files…", "…caps 501…", "…usage four requests…" | length 500 but got 501; usage expected [] to equal […] | run-activity-tally.ts:tallyTurnActivity (changedFiles/usage)
2B-04 | S2B-be1-five-tools "2B-04 counts five real tool calls …" | startRun rejected forbidden (fixture hostTemplate) | execution-observation.ts:submissionActivity + run-activity-service.ts; createActivityReadModel
2B-05 | S2B-be1-cross-hour "2B-05 buckets four cross-hour tool calls…" | no RED (passed first run) | same
2B-06 | S2B-be1-step-boundaries 5 tests | unresolvedCalls 0 got 1; possiblyIncomplete false got true (over-specified) | run-activity-tally.ts + observation
2B-07 | S2B-be1-usage "2B-07 sums the reported usage…" | transient duplicate export in goal-conflicts.ts | run-activity-tally.ts usage
2B-08 | S2B-be1-counting-failure "2B-08 a failed counting re-read…" | fault after===0 hit the observer header read → startRun rejected unavailable | execution-observation.ts:submissionActivity (L6 step 3)
2B-09 | S2B-be1s-shell 4 tests | every real shell result tool.failed {code:'sandbox_unavailable'} | frozen Kernel process sandbox (reported sandbox)
2B-10 | S2B-be2-run18-activity "2B-10 (RUN-18)…" | no RED (production pre-existing) | execution-observation/run-reconcile booking
2B-11 | S2B-be2-startup-reconcile-activity 4 tests | unregistered schemaId ControlIntentSnapshot@1; no lookup index s2b-round-by-goal | run-reconcile.ts:activityFor
2B-12 | S2B-be2-run23-activity 2 tests | no RED | run-reconcile.ts:stopPausedRunInProcess
2B-13 | S2B-be2-run09-activity 2 tests | RUN-09(R) calendar runsNotEntered 0 (clock outside window) | L7/L10 classification
2B-14 | S2B-be2-late-evidence-activity 3 tests | attestation rejected "Turn input acceptance is not confirmed yet" | run-reconcile.ts:bookLateEvidence + execution-entry-service L4 row 3
2B-15 | S2B-15-end-retry-activity "…lost end-commit receipt…" | record {…RunActivity…} has no matching guard | execution-observation.ts:submissionActivity + execution-entry-service.ts:recordRunResult
2B-16 | S2B-backfill-workflow + host | expected [r13,r2] received [r2,r13]; host timed out waiting for backfill | activity-backfill.ts:runBatch + create-platform wrapper
2B-17 | S2B-backfill-workflow "…batches with a cursor…" | expected {"order":…} to be null | activity-backfill.ts:runBatch exhaustion probe
2B-18 | "2B-18 backfill writes unknown…" | expected {reason:'not_backfilled'} to match {reason:'no_history_locator'} | activity-backfill.ts + run-activity-service candidate
2B-19 | "2B-19 …no tally is an error…" | expected 0 to be greater than or equal to 3 (fixture) | read model contract + host auto
2B-20 | "2B-20 only a human Host actor…" + host no-lease | expected {status:'ready'} to match {status:'rejected',code:'forbidden'} | activity-backfill.ts:isHumanHost + host.ts leaseGated
2B-21 | S2B-activity-calendar "2B-21 Asia/Shanghai…" | startAt 2026-10-14T02:00Z vs 2026-10-13T16:00Z | activity-read-model.ts:readActivityCalendar
2B-22 | "2B-22 half-hour and DST…" | busy "task phase is not dispatchable" (fixture) | same
2B-23 | "2B-23 a counted empty Run…" | busy claim / plan obligation mapping (fixture) | same
2B-24 | "2B-24 attributes begun checks…" | {checks:3,tasks:[work-1]} vs {checks:0,tasks:[]} | evidence-service.ts:commitRoundWrite + activity-read-model.ts
2B-25 | "2B-25 rejects every malformed…" + S2B-30 quarter check | no clean RED (pre-existing) | activity-read-model.ts validation
2B-26 | S2B-activity-calendar-tasks 4 tests + "2B-26 sessionRefs skips a foreign-line…" | zero-owner gate added checks to filtered cell (expected 2 to be 0) | activity-read-model.ts:onChecks + step-2 session resolution
2B-27 | S2B-activity-read-faults 3 cases (index/record/eventAt) + retry/capacity | eventAt sub-case returned ready (no round) | activity-read-model.ts read-failure propagation
2B-28 | "2B-28 keeps the activity of an archived line…" | no RED | activity-read-model.ts
2B-29 | S2B-run-activity-read "2B-29 reports each Run status…" (+not_entered, +201) | no clean RED | activity-read-model.ts:readRunActivities
2B-30 | S2B-30-track-bars 10 cases + 6 new tests | Cannot find module '…/goal-executed-files-reader.js' | track-read-model.ts:createTrackReadModel
2B-31 | S2B-31-task-timeline-main "…main example…" | Cannot find module '…/task-state-timeline.js' | task-state-timeline.ts:createTaskStateTimeline
2B-32 | S2B-32-task-timeline-fold 11 tests (+budget_exhausted) | fold(a)/fold(b) fail without entry-interval/anomalyOpen rules | same
2B-33 | S2B-33-task-timeline-pagination 6 tests (+keyed-miss cap) | disabling limit/source_stale guards makes named tests fail | same
2B-34 | S2B-34-executed-files 14 + 2 new tests | module-absent RED | goal-executed-files-reader.ts:createGoalExecutedFilesReader
2B-35 | S2B-35-activity-routes 4 tests | routes not_found/mismatch; not_found instead of busy | core-routes.ts:CORE_ROUTE_SPECS/bindings + create-platform activity/timeline
2B-36 | S2B-36-observer-cancel-reread | fixture abort resume 0 vs startPosition 2 | execution-observation.ts:submissionActivity/PendingTerminal
2B-37 | S2B-37-observer-reread-failure | first run GREEN | execution-observation.ts:submissionActivity
2B-38 | S2B-38-run08-unknown-activity (a)(b)(c) | (b)(c) asserted observe's stale return; StoreError code | execution-observation.ts RUN-08 prepareUnknownEnd
2B-39 | S2B-39-run17-activity | first run GREEN | run-reconcile.ts:classifyRun RUN-17 (activityFor('end_position'))
2B-40 | S2B-40-run20iii-activity | record {…RunActivity…} has no matching guard | run-reconcile.ts:classifyRun/activityFor + run-reconcile-service.ts:commitDecided
2B-41 | S2B-41-decision54-backfill-bound | fixture unregistered ControlIntentSnapshot@1; product RED via temporary kernel_tail → capacity | runtime.ts:countRunActivity (readTurnBounds) + activity-backfill.ts
2B-42 | S2B-backfill-workflow "…old Run with no locator…" | port excluded the Run (startedAt===null && auth===undefined) | run-activity-service.ts:isBackfillCandidate + runtime.ts
2B-43 | "2B-43 adjacent quarter windows…" | no clean RED | activity-read-model.ts
2B-44 | S2B-44-backfill-late-evidence-race | backfill forbidden "material reader is not the same trusted Host scope" (fixture) | run-activity-service.ts guarded commit + activity-backfill.ts skipped/record_changed
2B-45 | S2B-45-inprocess-run21-activity | recordedAt unchanged (fixed fixture clock) | run-reconcile.ts:bookLateEvidenceInProcess + execution-entry-service L4 row 3
```

**CHECKS:**

- `npm run typecheck` — exit 0.
- `npm run check:architecture` — exit 0; `next source boundaries: OK`, 49 submodule edges.
- `npm run build` — exit 0 (workbench published).
- `node scripts/build-kernel-patch.mjs --check` — exit 0.
- `npx vitest run tests/runtime/S2B- tests/work-graph/S2B- tests/composition/S2B- tests/scenarios/S2B- tests/app/S2B- tests/scenarios/S5-goal-conflict-rework.test.ts tests/architecture/` — exit 1; `Test Files 2 failed | 35 passed (37)`, `Tests 4 failed | 239 passed (243)`. Failures:
  - `tests/composition/S2B-be1s-shell.test.ts > 2B-09 real shell changed-file cases: touch, git branch, ls, failing write; and a cancelled write` — first line `AssertionError: expected { role: 'tool', …(2) } to match object { result: { status: 'success', …(1) } }` — **sandbox (2B-09)**.
  - `… > 2B-09 a cancelled command that changed nothing is tool.cancelled with zero edits` — `AssertionError: expected { role: 'tool', …(2) } to match object { result: { status: 'cancelled' } }` — **sandbox (2B-09)**.
  - `… > 2B-09 a timed-out command that changed nothing is tool.failed timeout with zero edits` — `AssertionError: expected { role: 'tool', …(2) } to match object { result: { status: 'error', …(1) } }` — **sandbox (2B-09)**.
  - `tests/scenarios/S5-goal-conflict-rework.test.ts > SC02 two Goals conflicting on module M: …` — `AssertionError: expected 'waiting' to be 'stopped' // Object.is equality` (first failure line 108) — **baseline** (`DSH-BASELINE.md:142`); the §5.3 lines 52–54 assertions pass; root cause is the missing `/usr/bin/bwrap` (the registered `check:'fail'` never launches), reproduced with a scratch mirror; not a 2B regression.
- `npx vitest run` — exit 1; `Test Files 49 failed | 298 passed (347)`, `Tests 153 failed | 6265 passed | 29 skipped (6447)`. Exact-set diff against `DSH-BASELINE.md` §A: the 153 failed tests = the 150 baseline tests (two long names differ only by vitest console truncation) + the 3 `S2B-be1s-shell` sandbox tests; the `tests/state/invariants.test.ts` suite-level FAIL is the baseline "+1 suite". No other file fails; no S2B failure besides 2B-09. All 49 failing files are the baseline set + `S2B-be1s-shell.test.ts`.
- `sha256sum DSH-BASELINE.md docs/refactor/design/orchestration-2026-10/slices/slice-2B-SPEC.md` — `198e832f…3dc0d` and `8e7e159a…bc2c`, exactly §3.
- `git diff --stat slice-base -- tests` — only new files and the §5.3 files: `S5-decision-routes`, `S2A-window-fixture`, `S5-application-support`, `S5R2-b-support`, `S5R2-c-support`, `S5-goal-conflict-rework`, `S5-decision-queue`, `S5-goal-settings`, `S5-notices`, `WP2-context-extensions`, `production-reach-allowlist.json` (11 files, +74/−13).
- `git status --short` — only L-scope paths (the §6 production/tests files listed above); no `dist/`, no lock files, no `docs/`, no commit; `git log -1` is still `5eca147 lead: 2B slice-base`.
- `./.dsh-scratch/` deleted; no `/tmp` probes remain.

**UNSPECIFIED:**

- **L1–L17:** L1 done (`run-activity-tally.ts:tallyTurnActivity`); L2/L3 done (quarters/overflow, changed files/usage); L4 done (`run-activity-service.ts`, codecs, L4 replace table); L5 done (end-commit activity in the same commit, RUN-21 replace; `execution-entry-service.ts`, `run-reconcile-service.ts`); L6 done (`run-activity-reader.ts`, `execution-observation.ts` ordering/pending items, `runtime.ts:countRunActivity` via `readTurnBounds`); L7 done (`activity-read-model.ts` classification, `run-activity-service.ts` candidate/`ActivityRecording`); L8 done (`activity-backfill.ts`, `host.ts`); L9 done after review fixes; L10 done; L11 done; L12 done (query/check/run bars); L13 done (`goal-executed-files-reader.ts`, stub moved); L14 done (ten indexes + `finalizedAt`); L15 done (`core-routes.ts`, human-only backfill); L16 respected; L17 done after review fixes (stable window, cap reporting, keyed-miss counts 1).
- **Files outside spec §6 changed (required by `npm run check:architecture`):** new `src/core/work-graph/persistence/run-activity-codecs.ts` (canonical codec moved there so `persistence` need not import `tasks`; `tasks/run-activity-codecs.ts` is an `export *` shim preserving the §6 path), new `src/core/work-graph/persistence/read-result-failures.ts` and the `views/goal-conflicts.ts` re-export (so `tasks/goal-executed-files-reader.ts` need not import `views`); `src/core/work-graph/tasks/executed-files-stub.ts` deleted as L13 requires. Also `tests/architecture/production-reach-allowlist.json` gained exactly ten `wire-format` entries (P9).
- **§5.3 rows:** SC02 lines 52–54 + line-7 comment changed exactly; later line 108 is the documented sandbox baseline, not flipped. Stub importers changed only the import path in 9 files (the 7 listed + `WP2-context-extensions` + `S2A-window-fixture`, P8); all pass. Allowlist changed (ten entries); `production-reach` passes. `platform.test.ts:56` not flipped (passes). Direct `recordRunResult`/`reconcileRun` callers not flipped (pass). Observer incremental/retry tests not flipped (pass). Control/unknown (R4/A2) not flipped. `state-writes` unchanged and passing. Codec/VR-07 tests not flipped (only the 8 `A2-verification-chain` baseline sandbox entries fail). Ledger-event scenarios not flipped (baseline sandbox failures only). Fixed-registration fixtures unchanged; the new group is folded once into `EXECUTION_ENTRY_RECORD_SCHEMAS`.
- **Spec-silent / undetermined cases:** a `failed` Run outcome is not producible through any public flow (`RuntimeEventType` has no `run_failed`; `RunTerminalFact` excludes `failed`), so 2B-32 asserts `budget_exhausted → run_failed` but not `failed`; a null-outcome ended Run has no defined displayed state and is unreachable today (2B-32 reports, no `run_end` emitted); 2B-24's "same-task re-check" is realized on a second task because the round chain is per (task, subjectRun) and the task phase refuses a second claim (`busy`); 2B-30's query-bar fixture uses a synthetic `provenance.messageRef` (the reader derives `askedSessionRef` from provenance only); 2B-34's literal "B plans module M → `filePaths` has F" and "A `possiblyIncomplete:false`" are not producible by the frozen algorithm (no catalog producer; `filePaths` is the executed-file intersection), so it asserts through `readGoalFootprint`/`goalConflictFacts` with both goals executing the file; `goal-executed-files-reader.ts`/`activity-read-model.ts` `provenNotEntered` accepts V1 auth phases and omits L7's explicit "no position record" conjunction (consistent across 2B, low risk); `ACTIVITY_BACKFILL_BATCH_RUNS = 5` is provisional (lead measures at acceptance, §10).
- **Fixture deviations that remain:** Group S still commits a `yielded` Run + its successor, one pre-entry pause/resume observation, and the §7 legacy round shapes directly at the storage boundary (real encoders + schema validation; all other records now via real services, both backends). Group V's BE4 fixtures build `RunActivity` facts through the public write port and real services rather than a real Runtime/Kernel + scripted model (spec §7 expects BE1–BE3 flows). Group R-be2's reused P7 host hardcodes `timeoutMs: 30000` (no `Date` replacement); its assertions use the mutable platform clock only.
- **Existing tests that seem to contradict the spec:** none confirmed. `tests/state/invariants.test.ts` (suite `beforeAll`) and `tests/state/invariants-fuzz.test.ts` fail only from the missing bwrap (the invariants runner opens a check window); both are in `DSH-BASELINE.md` §A (the "+1 suite" and line 150).
- **Self-check fixes applied after the reviews:** activity calendar step-4 early stop (no whole-index read/false `capacity`); step-2 `sessionRefs` filtering + `runsSessionUnknown`; `run-activity-service.ts:sessionRefOf` read-failure returned instead of `null`; `commandRan` only for shells that reached execution; 2B-14(a) non-vacuous; 2B-39 window pinned to real positions; tautologies removed; 2B-16 Run/Task-unchanged + 0-model-call assertions; missing 2B-27 eventAt, 2B-29 `not_entered`, 2B-30 query/hostRestarts/requeue/gate/two-owner cases, 2B-34 read-count + two-goal cases; Group S both backends + keyed-read cap; stale stub comment fixed.

**NOTES:**

- Subagents by wave: W1 `F`, `T`; W2 `R`, `V-model`; W3 `B`, `V-cont`, `V2`, `S`, helper `runtime-tools/store`, `R-be1r`; W3b `R-be1`, `R-be2`, `R-be1r-2`, `W`; then `SC02-investigator`, `read-model-fixer`, seven read-only reviewers (`T/F/R/B/V/S/W`), and five review-fixers. About 25 subagents, all collected before their turns ended.
- Regrouping (as permitted): moved `views/activity-read-model.ts` + rows 2B-21…29,43 out of Group V into a wave-2 `V-model` agent (R's BE1/BE2/BE1r rows assert through those reads; cycle-free sequencing), leaving `V2` = track bars + conflict reader; split R into R/R-be1r/R-be1/R-be2/R-be1r-2; reviewed F separately from R (F is static foundation) rather than routing F's diff to R's reviewer.
- Blockers: this sandbox has no bubblewrap, so 2B-09 (real `shell`) and the SC02 registered check cannot pass here; the lead must run those outside. No git write commands were used and no commit was made.
- Slowest slice test: the 2B-02 1,001-quarter case ≈ 24 s (explicit 300 s timeout); the full-suite run took 618 s, whose slowest tests are the pre-existing scale tests (QA-05 91 s, QA-04 30 s).