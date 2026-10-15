## FILES CHANGED
```
src/app/core-http-types.ts                              (item 15: re-export of WorkLineConversationPageV1)
src/app/core-routes.ts                                  (item 15: cursor/type wiring)
src/business/workflow/session-archive.ts                (item 4, approved extra)
src/composition/create-platform.ts                      (should-fix 2: registrations, 4 owner groups)
src/composition/work-line-conversation.ts               (item 15 + L12 conversation section)
src/contracts/ledger.ts                                 (lineSettings)
src/contracts/work-line.ts                              (2C DTOs)
src/core/record-store/in-memory-record-store.ts         (RecordCountPort)
src/core/record-store/lookup-index.ts                   (countLookup)
src/core/record-store/lookup-ports.ts                   (RecordCountPort)
src/core/record-store/sqlite-record-store.ts            (countLookup)
src/core/work-graph/configuration/line-settings-service.ts  (pins)
src/core/work-graph/model/work-line-contracts.ts        (ports)
src/core/work-graph/persistence/line-settings-codecs.ts (pin event)
src/core/work-graph/persistence/record-codecs.ts        (lineSettings)
src/core/work-graph/queries/query-record-codecs.ts      (index 7)
src/core/work-graph/sessions/session-record-codecs.ts   (indexes 1–5)
src/core/work-graph/state/line-pin-machine.ts           (pins)
src/core/work-graph/state/line-status.ts                (items 6, 7, 11)
src/core/work-graph/state/session-availability.ts       (item 3, approved extra; scoped in this round)
src/core/work-graph/tasks/claim-record-codecs.ts        (index 6)
src/core/work-graph/tasks/requeue-service.ts            (item 7: export-only; scope deviation, see UNSPECIFIED)
src/core/work-graph/tasks/session-anomaly-codecs.ts     (index 8)
src/core/work-graph/views/node-detail-reader.ts         (item 12, item 2 detail, should-fix 1)
src/core/work-graph/views/work-line-reader.ts           (items 1,2,5,8,9,10,11,15; budget=100)
src/ui/api/routes.ts                                    (seven labels, lines/pin write)
tests/architecture/state-writes.test.ts                 (§5.3 only existing test edited)
tests/helpers/S2C-D-node-support.ts                     (item 14: now public bootstrap services)
tests/helpers/S2C-X-scale-fixture.ts                    (item 14: named exception comment only)
tests/helpers/S2C-K-scenario-support.ts, S2C-K2-scenario-support.ts, S2C-L-*.ts, S2C-P-pins-fixture.ts
tests/record-store/S2C-count-lookup.test.ts
tests/state/S2C-line-status.test.ts
tests/work-graph/S2C-lines-*.test.ts, S2C-node-detail-*.test.ts, S2C-pins.test.ts
tests/scenarios/S2C-K-*.test.ts, S2C-K2-*.test.ts
tests/scenarios/S2C-K2-gate-checks.test.ts              (NEW, 2C-40)
tests/scenarios/S2C-K-legacy-provenance.test.ts         (NEW, 2C-26)
tests/app/S2C-line-routes.test.ts
```
`git diff --name-status slice-base -- tests` = new files + `M tests/architecture/state-writes.test.ts` only. `git status --short` = 76 entries, all L-scope; `.dsh-scratch/` deleted; no commit; frozen hashes unchanged.

## ROWS
```
2C-01 | S2C-line-status.test.ts 4 tests | n/a | state/line-status.ts:deriveLineStatus
2C-02 | S2C-line-status.test.ts | n/a | state/line-status.ts:classifyTaskAttention
2C-03 | S2C-lines-tiers.test.ts | n/a | views/work-line-reader.ts:listWorkLines + line-status.ts:lineSortKey
2C-04 | S2C-lines-done-evidence.test.ts (7c/7d new) | old 7c partialParts []; old 7d left budget | views/work-line-reader.ts:countingStore/readDoneEvidence
2C-05 | S2C-K-archive-tags.test.ts (partial: (2) only) | n/a | session-archive.ts + work-line-reader.ts
2C-07 | S2C-pins.test.ts | n/a | line-settings-service.ts:setLinePins + line-pin-machine.ts
2C-08 | S2C-count-lookup.test.ts 13 | n/a | lookup-index.ts:countLookup + both backends
2C-09 | S2C-lines-identification.test.ts (branch test new) | readWorkLine not_found | work-line-reader.ts:resolveContinuationLine/readChain
2C-10 | S2C-lines-walk.test.ts | n/a | work-line-reader.ts:assembleLineBriefs
2C-11 | S2C-lines-waiting-reply.test.ts (5 new) | params {} | work-line-reader.ts:readWaitRecipient
2C-12 | S2C-lines-attention.test.ts (10 new) | attentionAll [] | work-line-reader.ts:deriveAttentionAll
2C-13 | S2C-K-goal-pause.test.ts (2),(3) new | n/a | work-line-reader.ts + session-maintenance.ts
2C-14 | S2C-lines-d1.test.ts, S2C-lines-failure.test.ts (RD-8, B4, T5x new) | problem null | work-line-reader.ts:loadGoal/readTaskFacts/assembleOneLine
2C-15 | S2C-lines-copies.test.ts (4 new) | head createdAt | work-line-reader.ts:deriveLastActivity
2C-16 | S2C-lines-names.test.ts (f2 new) | 未定话题 | work-line-reader.ts:needsLatestQuery/deriveName
2C-17 | S2C-lines-controls.test.ts; S2C-line-status.test.ts RD-8 | pause/cancel available | line-status.ts:deriveLineControls + work-line-reader.ts:readContinuationConsumed
2C-18 | S2C-lines-conversation.test.ts / S2C-lines-page.test.ts (head-cursor, T5x, sourceCursor new) | cursor invalid / c0000000000 | work-line-reader.ts:readExecutionsSection, work-line-conversation.ts
2C-19 | S2C-pins.test.ts | n/a | line-settings-service.ts
2C-20 | S2C-lines-read-only.test.ts (observations; tautology removed) | n/a | rule-1 readers
2C-21 | S2C-K-retired.test.ts (3),(3b) | n/a | work-line-reader.ts:isHistoryNotReadable
2C-22 | S2C-K-unknown-outcome.test.ts (1),(2),(3) | "expected undefined to be defined" | session-availability.ts release paths
2C-23 | S2C-K-paused-run24.test.ts; S2C-lines-paused-continue.test.ts | n/a | line-status.ts askControl + reader
2C-24 | S2C-K-archive-interruption.test.ts | n/a | work-line-reader.ts + session-archive.ts
2C-25 | S2C-lines-scale.test.ts 10 | done_evidence partial (fixed) | work-line-reader.ts:readHistoryParts/nextOf
2C-26 | S2C-K-legacy-provenance.test.ts 6 (new) | derivation returned new | storage-boundary fixture + reader
2C-27 | S2C-node-detail-task.test.ts (fileRisks/link-failure new) | riskCount 1 / ready | node-detail-reader.ts:fileRisksView/linkedSessions
2C-28 | S2C-node-detail-anomalies.test.ts (paging/archive-state new) | exact 100 / no problem | node-detail-reader.ts:anomalyCount/displayOf
2C-29 | S2C-node-detail-executions.test.ts | n/a | node-detail-reader.ts
2C-30 | S2C-node-detail-hover.test.ts (5 new) | 0 owners / [] / dutyCalls 9 | node-detail-reader.ts:buildLineIndexes/memoDuty
2C-31 | S2C-line-routes.test.ts | n/a | app/core-routes.ts + work-line-conversation.ts
2C-32 | S2C-K2-paused-archive.test.ts (skip removed) | "expected undefined to be 'unknown'" | session-archive.ts:drive step 5
2C-33 | S2C-K2-conversation.test.ts | n/a | work-line-conversation.ts
2C-34 | S2C-K2-controls.test.ts | n/a | scenario routes
2C-35 | S2C-K2-paused-transfer.test.ts | n/a | work-line-reader.ts + transfer
2C-36 | S2C-lines-counts.test.ts | n/a | work-line-reader.ts:countArchived
2C-37 | S2C-lines-latest-generation.test.ts (title fix) | g37-g2 | work-line-reader.ts
2C-38 | S2C-line-status.test.ts | n/a | line-status.ts:cardLineKeys
2C-39 | S2C-K2-continue.test.ts (2),(3),(1) | n/a | scenario + requeue window
2C-40 | S2C-K2-gate-checks.test.ts (new) | 0 gateChecks | work-line-reader.ts gateChecks
2C-41 | S2C-K2-query-not-entered.test.ts | n/a | scenario + query recovery
```

## PER REVIEW ITEM 1–15 (test → file:symbol)
1. `2C-09 reading a branched predecessor names both heads explicitly instead of not_found (N3)` → `work-line-reader.ts:resolveContinuationLine`/`readChain`/`cycleRepresentatives`, consumed by `node-detail-reader.ts:headsOf`; archived-cycle representative + `readWorkLine` representative row added.
2. list `2C-14 a failed task-graph read marks the line B4…`, `…responsible Task absent from the task graph`, `…undecodable open responsible link` (S2C-lines-failure.test.ts) → `work-line-reader.ts:loadGoal/readTaskFacts/readOpenResponsibleLinks`; detail `2C-30/27/28 a failed … read is propagated` → `node-detail-reader.ts:readRunsByTask/linkedSessions/displayOf`.
3. `2C-22 (1)/(2)` (S2C-K-unknown-outcome.test.ts) → `session-availability.ts:releaseSessionRecord`/`releasedWithoutBoundary` + new `SessionRelease.preserveUnreadableHealth`.
4. enabled `2C-32` (S2C-K2-paused-archive.test.ts) → `session-archive.ts:drive` step-5 guarded anchor selection.
5. `2C-04 (7c)`, `2C-04 (7d) oversized batch latches`, `2C-03` read-incomplete tier → `work-line-reader.ts:countingStore/assembleOneLine/readDoneEvidence`; `LINE_HISTORY_READ_BUDGET = 100`.
6. `A2 an archived head never accepts DE1 inherited from an active predecessor`; `2C-04 (8)/(8b)` → `line-status.ts:evaluateDoneEvidence`.
7. `2C-14/RD-8 a lease held by another Run…`, `2C-17/RD-8 a consumed continuation…`, `2C-23 …ask as available`, 2C-39 → `work-line-reader.ts:readContinuationConsumed/readPausedTaskFacts`, `line-status.ts:askControl`, `requeue-service.ts:readRequeueWindow`.
8. `2C-14/L11 an ended-but-occupied Run rereads once…`, `2C-18 a head created mid-page…` → `work-line-reader.ts:assembleOneLine` (T5x), `readLineChainSessions`, `readExecutionsSection`, `listWorkLines` readWindow.
9. `L5 a malformed archived cursor is invalid…`, `L5 one bounded candidate page…` → `work-line-reader.ts:readArchivedPage`.
10. `2C-15 (4) an answering copy Query start counts…`, `2C-16 (f2)…Goal title`, `2C-37 (2)` → `work-line-reader.ts:readCopies/needsLatestQuery/deriveName/deriveLastActivity`.
11. `2C-11 (5) recipient`, `2C-12 (10) attentionAll`, `2C-09/E1 chain responsibleOpen + sourceCursor`, written-anchor `next`, `L22 handed_to`, `2C-18 single-Session conversation sourceCursor` → `work-line-reader.ts:readWaitRecipient/deriveAttentionAll/resolveLine/readWrittenAnchors`, `line-status.ts` anchor reason.
12. `2C-30 changedByLines maps claiming Sessions`, `…goal owners are secretary lines`, `…participants populated`, `2C-28 …anomaly count pages`, `2C-27 fileRisks excludes direct dependency` → `node-detail-reader.ts:claimingSessions/buildLineIndexes/moduleHover/anomalyCount/secretaryCandidates/participantsSection/fileRisksView`.
13. NEW `S2C-K-legacy-provenance.test.ts` (2C-26, 6 tests), NEW `S2C-K2-gate-checks.test.ts` (2C-40), `2C-20 (observations)` (read-only), 2C-13/21/22/24/39 additions.
14. `S2C-D-node-support.ts` now `createProjectBootstrapServices` (createProject → registerWorkspace → completionPolicies); `S2C-X-scale-fixture.ts` comment names the 2026-10-15 ruling + 2A exceptions 3–4 for the picker/Z Runs only.
15. `2C-18 the executions/conversation cursor binds the resolved head`; `production-reach` allowlist entry gone → `core-http-types.ts` re-export, `work-line-conversation.ts` cursor, `work-line-reader.ts:readExecutionsSection`.
Should-fix 1: `2C-30 duty resolution and the shared line assembly happen once per read` → `node-detail-reader.ts:memoDuty` + one `assembleLineBriefs`.
Should-fix 2: one `goalExecutedFiles` instance shared (`create-platform.ts`), 2C owner groups in the non-enumerable table; only `state-writes.test.ts` edited.

## CHECKS
```
npm run typecheck                            exit 0
npm run check:architecture                   exit 0
npm run build                                exit 0
node scripts/build-kernel-patch.mjs --check  exit 0
targeted (--maxWorkers=4, scale excluded)    48 files passed, 473 tests passed
scale alone (--maxWorkers=2)                 1 file passed, 10 tests passed
full (--maxWorkers=8, scale excluded)        51 files failed | 303 passed (354)
                                             159 failed | 6435 passed | 29 skipped (6623)
   failures = DSH-BASELINE §A (150 tests) + 9 item-3-caused; 0 S2C failures.
sha256sum                                    96727ad0…fe0c2 / 35ac3560…3b7a674 (both match)
git diff --stat slice-base -- tests          48 files: new S2C files + M state-writes.test.ts
git status --short                           76 entries, all L-scope; ./.dsh-scratch/ deleted; no commit
```
Existing tests failing because of **item 3** (item 4 caused none); none was edited:
1. `A8-host-restart.test.ts > W-14 and RUN-22…` — `:663` expected `healthConclusion:'kernel_turn_open'`, got `'missing'`.
2. `A8-host-restart-attestation.test.ts > RUN-22 (LA-8)…` — `:85` expected `kernel_turn_open`, got `'missing'`.
3. `A8-host-restart-attestation.test.ts > QRR-06 (LA-8)…` — `:146` expected `kernel_turn_open`, got `'missing'`.
4. `A8-host-restart-lease.test.ts > Q-05 and QRR-06…` — `:506` expected `kernel_turn_open`, got `'missing'`.
5. `K-R-attested-facts-source.test.ts > KA-09 (KE3, L9/D2)…` — `:147` expected `kernel_turn_open`, got `'missing'`.
6. `K-R-attested-facts-source.test.ts > KA-09 (KE3, L9/D12)…` — `:147` expected `kernel_turn_open`, got `'missing'`.
7. `K-R-attested-facts-source.test.ts > KA-09 (KE3, L9)…` — `:362` "the drive stops after the continuation Run: expected null to be 'open_checks'".
8. `K-W-maintenance.test.ts > KA-14 …` — `:250` expected `kernel_turn_open`, got `'missing'`.
9. `K-W-maintenance.test.ts > KA-14 … second phase` — `:311` expected null to be `'open_checks'`.
The previously reported NEW `2C-22(2)` failure is now green.

## UNSPECIFIED
- **Item 3 scope.** The health preservation is now set only by the attestation causes (`unknown_attested`/`query_unknown_attested`) through an optional `SessionRelease.preserveUnreadableHealth`; the shared `reconcile_interrupted_clean`/`stop_paused`/SES-09 paths still write `kernel_turn_open`, so KA1 is unchanged for a readable open Turn. The 9 tests above still pin the old `missing → kernel_turn_open` attestation behaviour; per the brief they are reported, not edited.
- **L-scope deviation:** `src/core/work-graph/tasks/requeue-service.ts` gained `export` on the existing `readRequeueWindow`/`RequeueWindow` (no logic change) so views share the canonical window (item 7, spec L16).
- **Item 15 placement:** `WorkLineConversationPageV1` is defined in `composition/work-line-conversation.ts` and re-exported by `app/core-http-types.ts`; `check-boundaries` forbids composition→Host, so it cannot be *defined* in `core-http-types.ts`. All consumers import it from `core-http-types.ts`.
- **Budget:** `LINE_HISTORY_READ_BUDGET = 100` per the lead's binding ruling (overrides frozen §2's `2_000`); §0.2/docs not edited (lead's).
- **Item 13 gaps:** 2C-05 (1)(3)(3′)(4)(5) blocked — the registered check process cannot run in this sandbox (`C5-gate-fix-open` fails identically); 2C-21 Query/missing-damaged/legacyPending variants, 2C-22 T2/goal-card/kernel_turn_open variants, 2C-39(4), 2C-28 five `next` kinds remain. 2C-26's `executions` after maintenance lists two indexed Work items, not the literal one (reliable-continuation hook absent).
- **Item 14 residual:** `tests/helpers/task-claim-fixture.ts` still raw-seeds scope/governance (shared by other slices, outside ownership).
- **2C-20:** at LE3 the readers carry no model/Runtime-history port, so zero model calls / zero Runtime reads are structural; the test now observes zero commits + equal storage calls and documents the LE4/LE7 seam instead of a literal-vs-literal assertion.
- **Residual (reviewer):** node-detail participants/risks/executions page by offset cursor, not the underlying index cursor; `hover` still calls `readTaskArchiveState` per task.

## NOTES
- Subagents, max 2 at once, one vitest at a time via a lock: Wave 1 R (items 1,2 list,5,6,9,15) + B (items 3,4); Wave 2 A2 (items 2 detail,12,should-fix 1) + C (items 13,14 + budget measure); Wave 3 R2 (items 7,8,10,11) + F (2C-20/part of 13, D-fixture); then two read-only reviewers, whose findings drove a Wave 4 (reader scale/cycle/silent-drop/cursors; D-fixture/2C-26). I narrowed item 3 myself after the reviewer's scope finding.
- **New measurement (A2, this build):** memory `m=4 r=78 w=73 z=1 sharedCalls=10699 sharedMs=1433 rows=1100`; sqlite `m=4 r=78 w=73 z=1 sharedCalls=10699 sharedMs=4662 rows=1100`. `r,w ≤ 100`, so the budget holds; prior run was r=78, w=63 (the extra w is the shared `readTaskArchiveState` now excluded from the per-line budget, spec L1b shared cost).
- Slowest test: the 2C-25 scale file, 296 s (memory+sqlite), run alone at `--maxWorkers=2`.
- Item 4 caused 0 existing-test failures; `S2C-K2-paused-archive` and all S2C files pass in the full run.
- No commit, no git write, no network, no real model calls; scratch deleted; frozen hashes unchanged.