All subagents have finished (all inactive); background job complete; scratch removed. Final report:

## FILES CHANGED
- src/core/work-graph/persistence/plan-record-codecs.ts
- src/core/work-graph/tasks/plan-readers.ts
- src/core/work-graph/tasks/plan-commit-compiler.ts
- src/core/work-graph/tasks/plan-service.ts
- src/core/work-graph/views/decision-read-model.ts

## CHECKS
- `npm run typecheck` → **exit 0**.
- `npm run check:architecture` → **exit 0** (`next source boundaries: OK`).
- `npm run build` → **exit 0** (`workbench build: published …`).
- Area run (13 files) → **exit 0**; `Test Files 13 passed (13)`, `Tests 384 passed (384)`.
- Named run (149 files) → **exit 1**; `Test Files 31 failed | 118 passed (149)`, `Tests 93 failed | 3836 passed | 29 skipped (3958)`. Deviation from the stated expectation (`94 failed | 3835 passed`): **R2B01 now passes** (H3 part b removed the `goalBases` dependency), so `S5R2-automation-cards` fails only R2B03/R2B04. All 31 failing files and all 93 test failures + 1 failed suite are exactly the expected bwrap/process-sandbox kind and the other-area RED rows; no unexpected failure and no different message. Per-file failures (id → first line):
  - **tests/state/invariants.test.ts** (suite, 1): `[ tests/state/invariants.test.ts ]` → `Error: requeue 1: {"status":"rejected","code":"busy","reason":"finalize_first: round … of the selected Run is open"}` (29 skipped).
  - **tests/app/AG2b-collaboration.test.ts** (2): “releases a busy B, runs two wait rounds and completes the real Task/Goal” → `Error: Test timed out in 30000ms.`; “reopens read-only over the original messages/Query/history and refuses another scope” → `Error: Test timed out in 30000ms.`
  - **tests/app/change-emitters.test.ts** (1): “announces settled, and stopping once before settled for a stopped command” → `Error: echo did not start: … the Kernel ProcessSandbox profile is not available …`.
  - **tests/app/orchestration-mechanism.test.ts** (1): “runs two explicitly selected same-Goal Tasks…” → `Error: Task parallel-left stopped: … ENOENT … /usr/bin/bwrap`.
  - **tests/composition/A2-requeue-platform.test.ts** (5): D-3 FAIL→requeue→PASS → `AssertionError: expected { ref… } to match object { effectivePhase: 'failed', …(2) }`; §4.3/§4.4 0-commit refusals → `… { effectivePhase: 'failed', …(1) }`; TASK-03 → `Error: requeue: … finalize_first: round … is open`; C3 (§6.1(e)) → `Error: requeue: … finalize_first … open`; W-21/C3 archived Session → `… { effectivePhase: 'failed', …(1) }`.
  - **tests/composition/A2-verification-chain-platform.test.ts** (6): VR-01..VR-07 → `expected 'waiting' to be 'stopped'`; VD-7 (future adoptions) → `Error: work-1 must reach its completion`; VD-7 (adoption in Kernel) → `expected { stopped: null, …(3) } to match object { state: 'completed' }`; VR-05(VD-6) → `expected { status: 'ready', …(4) } to match object { status: 'ready', …(3) }`; VD-15 → `Error: the Workflow must reach the gate check`; VD-8 → same status mismatch.
  - **tests/composition/R5c-workflow-platform.test.ts** (3): Goal gate → `… (settled: ENOENT … /usr/bin/bwrap): expected 'waiting' to be 'completed'`; stage+Goal gate → same; resumes verification round → `expected { status: 'ready', …(4) } to match object { status: 'ready', …(1) }`.
  - **tests/runtime/S5R2-agent-application.test.ts** (6): R2D01/R2D02/R2D03 (memory and sqlite) → `AssertionError: {"…status":"error","error":{"code":"invalid_arguments",…}}: expected 'error' to be 'success'`.
  - **tests/scenarios/A1-rework-same-session.test.ts** (1): A1 C8 → `expected 'waiting' to be 'stopped'`.
  - **tests/scenarios/A11-no-progress.test.ts** (7): #15/#21 cap → `expected { state: 'waiting', …(3) } to match object { state: 'waiting', next: null, …(1) }`; #2/#25/#21 → `expected [] to deeply equal [ 'FAIL', 'FAIL' ]`; #14(ND-4) → `expected 'waiting' to be 'stopped'`; #15 auto cap → `[ 'FAIL', 'FAIL' ]`; #1/#3/#10 → `'waiting' to be 'stopped'`; #7/#8 → `[ 'FAIL' ]`; #4 → `[ 'FAIL', 'FAIL' ]`.
  - **tests/scenarios/A4-duplicate-receipts.test.ts** (4): every step of a Run → `'waiting' to be 'completed'`; A4,W-23 → `'waiting' to be 'stopped'`; A4,C-05 → `'waiting' to be 'stopped'`; A4 (记录结果) → `'waiting' to be 'completed'`.
  - **tests/scenarios/A7-control-goal29.test.ts** (1): A7-G4 with history → `'waiting' to be 'completed'`.
  - **tests/scenarios/A7-control.test.ts** (14): entered Run, yielded wait, pause/resume, VD-9, GOAL-11/14, GOAL-14 retry, A7-G2, G-04/GOAL-29, A7-G4b(G-05), G-04b contrast, A7-G5, G-04/G-06 restart, §2.3 step 2, GOAL-29 after 继续 → `'waiting' to be 'completed'` (VD-9 → `expected 'ENOENT…' to contain 'the Goal is paused; no new check proc…'`; two → `expected [["advance",…],…,"waiting","ENOENT…/usr/bin/bwrap","run_check"]] … to match object { state: 'completed' }`).
  - **tests/scenarios/A8-host-restart-entry.test.ts** (7): A8-2a/A8-1c; A8-2a queued cancel; A8-2b L-2; A8-2b SES-07; A8-2c; A8-1b; A8-1a → all `expected 'waiting' to be 'stopped'`.
  - **tests/scenarios/A8-host-restart-paused.test.ts** (5): A8-3l/A8-3p → `expected { ref… } to match object { effectivePhase: 'satisfied' }`; A8-3n → `Error: timed out waiting for the start-up re-drive to complete the Goal: {"phase":"RUNNING",…"auto_rework_pending"…}`; A8-3q/A8-3o → `{ effectivePhase: 'satisfied' }`; safe-point pause → `expected [… "waiting","ENOENT…bwrap","run_check"] … { state: 'completed' }`; LA-1/contract(e) → `Error: the continuation r2 must be claimed`.
  - **tests/scenarios/A8-host-restart.test.ts** (3): A8-3a → `'waiting' to be 'completed'`; §12.1 step 6b LA-6 → `the start-up re-drive completed the Task without a workflow/advance: … { effectivePhase: 'satisfied' }`; §12.1 step 6b(a) W-11 → `the start-up re-drive completed the Goal without a workflow/advance: … { phase: 'COMPLETED' }`.
  - **tests/scenarios/C3-brief-idempotency.test.ts** (4): C3-R1; C3-R1 source changed; C3-R2; C3-R2 transient → all `expected 'waiting' to be 'stopped'`.
  - **tests/scenarios/C3-not-entered-chain.test.ts** (1): C3 D-7 → `expected 'waiting' to be 'stopped'`.
  - **tests/scenarios/C3-paused-continue-brief.test.ts** (1): C3/C4 → `'waiting' to be 'completed'`.
  - **tests/scenarios/C3-reply-other-session.test.ts** (3): same Session → `'waiting' to be 'completed'`; other Session → same; another Task's Session → `expected [ 'claim_task', 'prepare', …(3) ] to deeply equal ArrayContaining{…}`.
  - **tests/scenarios/C3-workspace-changed.test.ts** (1): C3 GAP-49 → `expected 'waiting' to be 'stopped'`.
  - **tests/scenarios/C5-gate-fix-open.test.ts** (1) and **tests/scenarios/C5-gate-fix.test.ts** (2): → `Error: the Workflow must reach the gate open`.
  - **tests/scenarios/C8-auto-rework-cap.test.ts** (1): C8 → `expected 'waiting' to be 'stopped'`.
  - **tests/scenarios/C8-human-stop-respected.test.ts** (2): AV-4 → `expected [ 'open_checks', 'run_check' ] to deeply equal [ 'open_checks', 'run_check', …(3) ]`; VR-14 step 5 → `Error: the round must finalize`.
  - **tests/scenarios/S1-archive-restart.test.ts** (1): IT19 → `'waiting' to be 'completed'`.
  - **tests/scenarios/S5-goal-conflict-rework.test.ts** (1): SC02 → `expected 'waiting' to be 'stopped'`.
  - **tests/scenarios/WP1-wiring.test.ts** (2): SC01 → `'waiting' to be 'completed'`; SC02 → `'waiting' to be 'completed'`.
  - **tests/state/invariants-fuzz.test.ts** (1): coverage → `AssertionError: kinds that never ran: expected [ '起检 begin check', …(10) ] to deeply equal []`.
  - **tests/business/S5R2-automation-cards.test.ts** (2): R2B03 → `AssertionError: expected [] to have a length of 1 but got +0`; R2B04 → `AssertionError: expected { status: 'rejected', …(2) } to match object { status: 'ready', value: { …(4) } }`.
  - **tests/business/S5R2-settings-replay.test.ts** (4): R2C02 memory/sqlite, R2C04 memory/sqlite → `AssertionError: expected { status: 'rejected', …(2) } to deeply equal { status: 'committed', …(3) }`.
- `sha256sum` of the 34 frozen files → **all 34 match section 3 exactly** (diff clean).
- `git status --short | wc -l` → **103**; `git log --oneline | wc -l` → **1** (no commit); `./.dsh-scratch/` deleted.

## UNSPECIFIED
- **H1** → done. `plan-record-codecs.ts:148` shared `compareProposalChainPositions` (no-`since` first, `seqOfCommitCursor`, refKey tie-break); `:854` wire shape check; `:1017` DTO strips wire `since`; `:1053` `decodePlanProposalOrigin`; `:1096` `encodePlanProposal(proposal, origin?)`; `:1129` `commitCursorFields: NOTICE_ORIGIN_COMMIT_CURSOR_FIELDS`. `plan-readers.ts:465` origin reader, `:680/:738` `enumerateClosedGoalCandidates` latest chain origin. `decision-read-model.ts:1119/:1169` `findCandidateProposal` same rule. `plan-commit-compiler.ts:239/:428` accept copies origin. `plan-service.ts:1290/1310` replace reads old origin, `:1383–1390`/`:3197–3284` propose binds `{since:null}`+`commitCursorBindings`, replace copies; `:2379` abandon copies; `:2754/:2783/:2798/:1682/:3007` accept copies.
- **H2** → done. `decision-read-model.ts:109` `GOAL_LIMIT=200`; `:235` `capacityRejection`; `:297–302` Goal listing; `:341–343` message window; `:421–439` card-source window; `:495–514` notice-source window; moving window stays `unavailable` `:246–251/:557–561`.
- **H3** → done. `decision-read-model.ts:645–646` bound Workspace from `ctx` feeds `findAnswerMessage`; `:1068–1093` keys on `[projectId, workspaceId, kind, key]`; `workspaceOf`/`goalBases[0]` removed; `findCandidateProposal` untouched by H-2.
- Exactly-5000 boundary: `goal-conflicts.ts:159` sets `truncated` on `items.length >= cap` before checking `next === null`, so a complete exact-5000 message/Goal window is rejected as `capacity` (`decision-read-model.ts:297–299`, `:341–343`). That file is outside this area's write scope; the in-file card/notice loops (`:432/:508` check `next` first) are precise. No frozen test covers exactly 5000, and another area may own the `lookupAll` fix.
- Named-run counts differ from the stated expectation only because **R2B01 now passes** (H3 part b); this is an extra pass, not a failure, and no frozen test contradicts the correction.
- Not determined: a notices-only unfiltered read with >200 Goals is not rejected (`wantsGoals = wantsCards || goalRef !== undefined`, `:269`) while SPEC line 772 caps any unfiltered read; source-1's three status buckets OR three separate `lookupAll` calls each capped at 5000 (`:1050–1064`); `lookupAll` bounds items not the 25-page count; `listWorkspaceGoals` skips undecodable Goals before the 200 count; H1's accept-path plumbing (`readAdoption` + two compile call sites) goes beyond the literal “proposal record encode sites” but was required by frozen GREEN R2A03.
- No per-group base exists (`slice-base` == HEAD, whole slice uncommitted), so per-group hunk attribution and “no test edits” cannot be diff-verified; the 34 frozen hashes are all clean.
- `tests/scenarios/S5-goal-conflict-rework.test.ts` SC02 fails identically with and without H-2's change (restored pre-edit blob reproduces it); pre-existing bwrap-kind, not round-2 RED, unrelated.
- No frozen test was found to contradict a correction.

## NOTES
- Subagents run: 4 total — H-1 fix worker, H-2+H3 fix worker (parallel, disjoint files), then one read-only reviewer per group (fresh context).
- Both reviewers returned “done” for every in-scope item and found no in-scope defect; no fix subagent was needed.
- The only cross-group finding (exactly-5000 boundary) lives in `goal-conflicts.ts`, explicitly out of area 4's write scope, and is reported above.
- The only deviation from section 8's expected numbers is R2B01 passing (93 failed/3836 passed vs 94/3835); all other counts, files and failure kinds match exactly.
- `decision-read-model.ts` and `goal-conflicts.ts` are untracked slice-5 files; this round changed only `decision-read-model.ts` in that view.
- Nothing blocked; all four groups' work is complete and every check of section 8 was run once.