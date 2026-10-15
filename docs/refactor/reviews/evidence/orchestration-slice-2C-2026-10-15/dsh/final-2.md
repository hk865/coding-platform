FILES CHANGED:
```
src/app/core-http-types.ts
src/app/core-routes.ts
src/composition/create-platform.ts
src/contracts/ledger.ts
src/core/record-store/in-memory-record-store.ts
src/core/record-store/lookup-index.ts
src/core/record-store/lookup-ports.ts
src/core/record-store/sqlite-record-store.ts
src/core/work-graph/persistence/record-codecs.ts
src/core/work-graph/queries/query-record-codecs.ts
src/core/work-graph/sessions/session-record-codecs.ts
src/core/work-graph/tasks/claim-record-codecs.ts
src/core/work-graph/tasks/session-anomaly-codecs.ts
src/ui/api/routes.ts
tests/architecture/production-reach-allowlist.json
tests/architecture/state-writes.test.ts
src/composition/work-line-conversation.ts
src/contracts/work-line.ts
src/core/work-graph/configuration/line-settings-service.ts
src/core/work-graph/model/work-line-contracts.ts
src/core/work-graph/persistence/line-settings-codecs.ts
src/core/work-graph/state/line-pin-machine.ts
src/core/work-graph/state/line-status.ts
src/core/work-graph/views/node-detail-reader.ts
src/core/work-graph/views/work-line-reader.ts
tests/app/S2C-line-routes.test.ts
tests/helpers/S2C-D-node-support.ts
tests/helpers/S2C-K-scenario-support.ts
tests/helpers/S2C-K2-scenario-support.ts
tests/helpers/S2C-L-check-support.ts
tests/helpers/S2C-L-line-support.ts
tests/helpers/S2C-L-runs-support.ts
tests/helpers/S2C-P-pins-fixture.ts
tests/helpers/S2C-X-scale-fixture.ts
tests/record-store/S2C-count-lookup.test.ts
tests/scenarios/S2C-K-archive-interruption.test.ts
tests/scenarios/S2C-K-archive-tags.test.ts
tests/scenarios/S2C-K-goal-pause.test.ts
tests/scenarios/S2C-K-paused-run24.test.ts
tests/scenarios/S2C-K-retired.test.ts
tests/scenarios/S2C-K-unknown-outcome.test.ts
tests/scenarios/S2C-K2-continue.test.ts
tests/scenarios/S2C-K2-controls.test.ts
tests/scenarios/S2C-K2-conversation.test.ts
tests/scenarios/S2C-K2-paused-archive.test.ts
tests/scenarios/S2C-K2-paused-transfer.test.ts
tests/scenarios/S2C-K2-query-not-entered.test.ts
tests/state/S2C-line-status.test.ts
tests/work-graph/S2C-lines-attention.test.ts
tests/work-graph/S2C-lines-controls.test.ts
tests/work-graph/S2C-lines-conversation.test.ts
tests/work-graph/S2C-lines-copies.test.ts
tests/work-graph/S2C-lines-counts.test.ts
tests/work-graph/S2C-lines-d1.test.ts
tests/work-graph/S2C-lines-done-evidence.test.ts
tests/work-graph/S2C-lines-failure.test.ts
tests/work-graph/S2C-lines-identification.test.ts
tests/work-graph/S2C-lines-latest-generation.test.ts
tests/work-graph/S2C-lines-names.test.ts
tests/work-graph/S2C-lines-page.test.ts
tests/work-graph/S2C-lines-paused-continue.test.ts
tests/work-graph/S2C-lines-read-only.test.ts
tests/work-graph/S2C-lines-scale.test.ts
tests/work-graph/S2C-lines-task-anchors.test.ts
tests/work-graph/S2C-lines-tiers.test.ts
tests/work-graph/S2C-lines-waiting-reply.test.ts
tests/work-graph/S2C-lines-walk.test.ts
tests/work-graph/S2C-node-detail-anomalies.test.ts
tests/work-graph/S2C-node-detail-executions.test.ts
tests/work-graph/S2C-node-detail-hover.test.ts
tests/work-graph/S2C-node-detail-task.test.ts
tests/work-graph/S2C-pins.test.ts
```

ROWS (row | test name(s) | RED first seen | implementation):
```
2C-01 | S2C-line-status.test.ts (4 tests) | n/a (built interrupted session; green on re-run) | state/line-status.ts:deriveLineStatus
2C-02 | S2C-line-status.test.ts | n/a | state/line-status.ts:classifyTaskAttention
2C-03 | S2C-lines-tiers.test.ts | n/a | views/work-line-reader.ts:listWorkLines + state/line-status.ts:lineSortKey
2C-04 | S2C-lines-done-evidence.test.ts | n/a (this session's L fix changed deriveDoneTasks; 28/28 green) | views/work-line-reader.ts:deriveDoneTasks
2C-05 | S2C-K-archive-tags.test.ts | n/a | sessions/session-archive.ts + views/work-line-reader.ts
2C-07 | S2C-pins.test.ts (6) | n/a | configuration/line-settings-service.ts:setLinePins + state/line-pin-machine.ts
2C-08 | S2C-count-lookup.test.ts (13) | n/a | record-store/lookup-index.ts:countLookup + both backends
2C-09 | S2C-lines-identification.test.ts | n/a | views/work-line-reader.ts
2C-10 | S2C-lines-walk.test.ts | n/a | views/work-line-reader.ts:assembleLineBriefs
2C-11 | S2C-lines-waiting-reply.test.ts | n/a | views/work-line-reader.ts
2C-12 | S2C-lines-attention.test.ts | n/a | views/work-line-reader.ts
2C-13 | S2C-K-goal-pause.test.ts | n/a | views/work-line-reader.ts + session-maintenance.ts
2C-14 | S2C-lines-d1.test.ts | n/a (legacyUnchecked changed this session; 10/10 green) | views/work-line-reader.ts:readLegacyUnchecked
2C-15 | S2C-lines-copies.test.ts | n/a | views/work-line-reader.ts
2C-16 | S2C-lines-names.test.ts | n/a | views/work-line-reader.ts
2C-17 | S2C-lines-controls.test.ts | n/a | views/work-line-reader.ts
2C-18 | S2C-lines-conversation.test.ts + S2C-lines-page.test.ts | n/a | views/work-line-reader.ts:readExecutionsSection
2C-19 | S2C-pins.test.ts (7) | n/a | configuration/line-settings-service.ts
2C-20 | S2C-lines-read-only.test.ts | n/a | views/work-line-reader.ts
2C-21 | S2C-K-retired.test.ts | n/a (retired.history changed this session; green) | views/work-line-reader.ts:isHistoryNotReadable
2C-22 | S2C-K-unknown-outcome.test.ts | (1) n/a; (2) "the attested retired line archives: expected undefined to be defined" | scenario + session-maintenance.ts (reported)
2C-23 | S2C-K-paused-run24.test.ts (4) | n/a | scenario + views/work-line-reader.ts
2C-24 | S2C-K-archive-interruption.test.ts | "expected undefined to be 'unknown' // Object.is equality" | test-only stop-point fix; views/work-line-reader.ts
2C-25 | S2C-lines-scale.test.ts (10) | (2) "expected [ …(2750) ] to deeply equal [ …(2750) ]"; (4) "{ status: 'unavailable' } to match { status: 'partial', atLeast: +0 }" | views/work-line-reader.ts:assembleLineRows(order) + isBudgetFailure
2C-26 | (none) | not covered | —
2C-27 | S2C-node-detail-task.test.ts | n/a | views/node-detail-reader.ts (participants/claimed, risks)
2C-28 | S2C-node-detail-anomalies.test.ts | n/a (partial coverage) | views/node-detail-reader.ts
2C-29 | S2C-node-detail-executions.test.ts | n/a | views/node-detail-reader.ts
2C-30 | S2C-node-detail-hover.test.ts | n/a | views/node-detail-reader.ts:readGraphHover
2C-31 | S2C-line-routes.test.ts (a)-(h) | n/a | app/core-routes.ts + composition/work-line-conversation.ts
2C-32 | S2C-K2-paused-archive.test.ts | it.skip, stop-and-report | sessions/session-archive.ts + session-lifecycle.ts (out of scope)
2C-33 | S2C-K2-conversation.test.ts | n/a | composition/work-line-conversation.ts
2C-34 | S2C-K2-controls.test.ts | n/a | scenario routes
2C-35 | S2C-K2-paused-transfer.test.ts | n/a | views/work-line-reader.ts + transfer
2C-36 | S2C-lines-counts.test.ts | n/a | views/work-line-reader.ts:countArchived
2C-37 | S2C-lines-latest-generation.test.ts | n/a | views/work-line-reader.ts
2C-38 | S2C-line-status.test.ts | n/a | state/line-status.ts:cardLineKeys (now called by production)
2C-39 | S2C-K2-continue.test.ts (+ S2C-lines-paused-continue) | n/a | scenario + tasks requeue
2C-40 | S2C-lines-page.test.ts (partial) | n/a | views/node-detail-reader.ts (gate predicate)
2C-41 | S2C-K2-query-not-entered.test.ts | n/a | scenario + query recovery
```

CHECKS:
```
npm run typecheck                              exit 0
npm run check:architecture                     exit 0
npm run build                                  exit 0
node scripts/build-kernel-patch.mjs --check    exit 0
targeted (section-8 list + S5/S1/A1/MVP/platform, --maxWorkers=4,
  --exclude '**/S2C-lines-scale.test.ts' because the binding memory rule
  requires 2C-25 to run alone at --maxWorkers=2):
  Test Files  1 failed | 44 passed | 1 skipped (46)
  Tests       1 failed | 394 passed | 1 skipped (396)
  NEW: tests/scenarios/S2C-K-unknown-outcome.test.ts > "2C-22 (2) after the person attests a missing-Kernel unknown Run…"
       first line: AssertionError: the attested retired line archives: expected undefined to be defined
  (2C-32 stays it.skip; reported, not forced)
scale alone: npx vitest run tests/work-graph/S2C-lines-scale.test.ts --maxWorkers=2
  Test Files  1 passed (1); Tests 10 passed (10); Duration 256.31s
npx vitest run --maxWorkers=8 (full suite; scale excluded per the memory rule, run green above)
  Test Files  49 failed | 302 passed | 1 skipped (352)
  Tests       151 failed | 6365 passed | 30 skipped (6546)
  All failures are DSH-BASELINE.md §A (150 tests) + the invariants.test.ts suite crash
  (the baseline's "+1 suite", 48th file) + the 1 NEW reported 2C-22(2); no other NEW failure.
  S2C files failing in the full run: only S2C-K-unknown-outcome.test.ts (2C-22(2), NEW/reported).
sha256sum DSH-BASELINE.md <spec>  -> 96727ad0…fe0c2 and 35ac3560…3b7a674 (both match §3)
git diff --stat slice-base -- tests -> only:
  tests/architecture/production-reach-allowlist.json | 6 ++++++ (NotYetV1)
  tests/architecture/state-writes.test.ts            | 6 ++++-- (§5.3 two tables)
git status --short -> 72 entries, all L-scope; ./.dsh-scratch/ deleted; no commit.
```

UNSPECIFIED:
- L-rules: L1a/§3.2 done in `views/work-line-reader.ts:deriveDoneTasks` (this session: exact now needs K=0 unknown; added `atMost`); L1b done (counting wrapper `views/work-line-reader.ts:countingStore`; budget exhaustion now always `partial`, incl. the prefixed `unavailable: history_budget` from `tasks/plan-readers.ts`); L5 done (`listArchivedLines` keeps archive-time-desc order; `countArchived`/`countWithoutArchivedAt`); L6 done (`legacyUnchecked` now counts active+archived once per list); L8/L9 done (`configuration/line-settings-service.ts`, `state/line-pin-machine.ts`); L10/L11/L12/L13/L14/L15/L18/L19/L21/L24 done per group; L16 (`tasks/requeue`) done in scenarios; L17/L20/L22/L23 not separately touched (their functions were owned by other rows).
- §5.3 rows: `state-writes.test.ts` both tables applied (WorkspaceSnapshot gains `lineSettings`; WORKSPACE_USE gains `buildWorkspaceLineSettingsRecord`; ALLOWED_DECODERS gains `line-settings-codecs.ts`) — targeted architecture run green. `production-reach-allowlist.json`: the 5 `kept-for` entries (`cardLineKeys`, `deriveTaskDisplayFacts`, `LineCardInputV1`, `LineOwnerIndexV1`, `refKey`) and the unused `WORKSPACE_VALUE_KEYS` entry were removed after production actually called them; production-reach green. Only `NotYetV1` remains allowlisted (wire-format), but it is referenced by nothing and its note is false — REPORT.
- Reported spec contradictions (do not force):
  - 2C-32 (`tests/scenarios/S2C-K2-paused-archive.test.ts`, `it.skip`): spec §5.2:1329 / §3.7 E9 require the person's `sessions/archive-line` on a retired RUN-24 line to write the anomaly anchor. Conflict: `src/business/workflow/session-archive.ts:453-472` writes it only for `R.execution.kind==='work'` or `R.mode==='retired'`, and `src/core/work-graph/sessions/session-lifecycle.ts` gives `execution:{kind:'none'}` with no occupancy / `mode='operator'`. Minimal counter-example: a RUN-24 line after restart has `occupancy:null`, so archive-line (drop) leaves `anchorRunRef` null → `lines/archived` reads `attention:null` (`graph/hover` `display.anomaly:null`), not `anomaly_pending`. Both files are outside 2C §6.
  - 2C-22(2) (`tests/scenarios/S2C-K-unknown-outcome.test.ts`): spec §5.2:1319 / §3.6 A1 say a `missing`/`damaged` attested Run is archived retired. Conflict: `src/core/work-graph/tasks/run-reconcile-service.ts:536-575` + `src/core/work-graph/state/run-machine.ts:2297-2345` set `healthConclusion='kernel_turn_open'` on attestation (existing `tests/scenarios/A8-host-restart.test.ts` "W-14 and RUN-22 …" asserts it), and `src/business/workflow/session-maintenance.ts:414-426,604-616` closes/skips it instead of archiving. Minimal counter-example: after `executions/resolve-unknown`, `sessions/read` shows unavailable/kernel_turn_open, KA1 runs, `lines/archived` has no row.
- Other reviewer findings reported, not fixed (time/scope): 2C-26 has no test; 2C-40 only partly exercised in `S2C-lines-page.test.ts`; 2C-13 and 2C-39 cover only some cases; `NotYetV1` allowlist entry; `views/node-detail-reader.ts:displayOf` still maps a failed `readTaskArchiveState` to `anomaly:null`; `WorkLineConversationPageV1` is defined in `composition/work-line-conversation.ts` though the spec puts it in `core-http-types.ts`; its cursor binds `input.key` not the line head; `readArchivedPage` fills to `limit` though L5 says a page may be shorter; 2C-24's Task display/`waitingForStop` not asserted; 2C-28's five `next` kinds and `tasks/archive-state` equality not asserted; 2C-20 does not assert 0 model calls / 0 Runtime history reads; `S2C-D-node-support.ts` seeds scope via raw `records.commit`; `S2C-X-scale-fixture.ts` uses `commitRaw` for the picker/Z Runs (2A QA-17 coordinator exception).

NOTES:
- Two subagents per wave, max two at once, one vitest at a time via `.dsh-scratch/vitest-lock.sh`. Wave A (this session): 2C-25 scale fixer + K1 2C-24 fixer. Wave B: D reader fixer + L reader fixer. Then reviewer 1 (C/M/L/P/D), reviewer 2 (W/K1/K2/X), sequentially.
- Beyond the interrupted session: 2C-25 fixed production-only — `listArchivedLines` now passes `order:'given'` to `assembleLineRows` (archive-time-desc, L5), and `isBudgetFailure` accepts the prefixed `unavailable: history_budget` so a budget-exhausted part reads `partial`, never `unavailable`/0 (10/10 green). K1's 2C-24 now stops the drive at `stopBefore: performs('start')` instead of `maxSteps:8`, so the anchor stays unclaimed (§3.3 M2/§3.4 AT4); test-only, no production change. Reviewer 1's 11 in-scope defects were fixed in `views/node-detail-reader.ts` (claimed participants, participatedLines, parent, planRef, real display facts, failure surfacing, paging, `cardLineKeys`/`deriveTaskDisplayFacts` reached) and `views/work-line-reader.ts` (`retired.history`, done-evidence omitted formula, `legacyUnchecked`, message-section failure, cardLineKeys dedup); reviewer 2's `WORKSPACE_VALUE_KEYS` entry removed.
- Amendment A2 (printout, not asserted; `sharedCalls`/`sharedMs` after the L fixes): memory `m=4 r=78 w=63 z=1 sharedCalls=10689 sharedMs=1479 rows=1100`; sqlite `m=4 r=78 w=63 z=1 sharedCalls=10689 sharedMs=4081 rows=1100`; `budgetedSum=3481`, non-budgeted (incl. open work) `7208`.
- Slowest test: the 2C-25 scale file, 256.31s (memory+sqlite).
- Regrouping: none; group ownership from the book was kept. `LINE_HISTORY_READ_BUDGET` stays 2_000 (injectable), per A2; the lead sets the number.
- No commit, no git write, no network, no real model calls; scratch deleted; frozen hashes unchanged.