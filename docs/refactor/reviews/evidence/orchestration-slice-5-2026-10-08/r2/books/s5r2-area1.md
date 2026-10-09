# Task: orchestration slice 5, round 2 — area 1: automation confirmation cards (paused gates, the Workflow source)

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session: you have not
seen this copy before. Everything you need is in this message and in files of this copy. The corrections below are
decided; do not make design decisions. Where the spec, the test table and this message do not determine something,
do not invent behaviour: list it under UNSPECIFIED in your reply.

**This run is headless. When your turn ends, the whole run ends and every subagent that is still running is killed**
(earlier runs lost all their work that way: they started subagents and ended the turn). After starting subagents,
stay in your turn until every one of them has finished and reported: wait with a blocking shell command (for example
`sleep 540`) and check with `list_agents`, again and again; no notification wakes you after your turn ends. End your
turn only after the checks of section 8 and the reply of section 9.

**Work with subagents.** You are the coordinator: keep your own context small. Do not read the spec, the code of the
groups or the test files yourself. Give each group of section 6 to its own subagent with: sections 1–5 of this message
verbatim, its own group block verbatim, and the instruction to read the named spec lines and test rows first, then the
code at the given lines, then fix, then run `npm run typecheck` and its own test files only, and to reply with FILES,
what it changed per item (item id → file:line), the test numbers of its files and UNSPECIFIED items. Groups in one wave
run in parallel and write disjoint files. A subagent never edits a file of another group; if it needs a change there,
it stops and tells you; you decide and tell the owning group.

## 1. What this copy is and what is already done

- Base: commit 74f059b4 of the branch (orchestration slices 0, 1, 3 and the wiring package I-1/I-3 merged; `git log`:
  one commit, tags `slice-setup` and `slice-base`). Uncommitted on top: slice 5 complete (types, owners, readers,
  routes, Workflow, Runtime tools, its 16 frozen test files and support files), the lead's merge of it onto this base,
  and the new frozen tests of this round (section 3).
- The lead measured this state with `/usr/bin/bwrap` present: `npm run typecheck`, `npm run check:architecture`,
  `npm run build` exit 0; the whole suite runs 279 test files / 5,974 tests: 5,954 pass and exactly 20 fail — the RED rows of the round-2 table (R2A01, R2A02, R2A07 on memory and SQLite, R2A09; R2B01, R2B03, R2B04; R2C02, R2C04 on both; R2D01, R2D02, R2D03 on both); every other test passes. In this sandbox `/usr/bin/bwrap` is missing, so the
  tests listed in section 8 as "bwrap" fail here with `waiting` / `ENOENT … /usr/bin/bwrap`; that is expected — never
  instrument a harness to prove it.
- Slice 5 still has open production defects. An independent review found them, and the lead wrote new tests for them
  (Codex wrote them from the lead's table, the lead checked and froze them). The rows marked RED fail today exactly at
  the defect; your area must make its RED rows pass. Other areas are fixed in other copies at the same time; their
  files are outside your write scope. **All tests that pass today must still pass afterwards.**

## 2. Where the rules are (all inside this copy)

- The round-2 test table: `docs/refactor/design/orchestration-2026-10/slices/slice-5-round2-TESTS.md` (Chinese prose,
  English identifiers): §0 common rules, §1 lead choices T-R2-1..3 (binding), §2 the rows with the spec rule and the
  code location of each.
- The frozen spec: `docs/refactor/design/orchestration-2026-10/slices/slice-5-SPEC.md`. §0 (lines 5–63) overrides the
  rest. By line: §2.2 Goal/Workspace settings 117, §2.3 message extension 160, §2.4 request candidates/unique slot 247,
  §2.5 indexes/notice origin/cursor 276, §2.8 helper types, pause basis, event proof 345; §3.1 state rows 487–517; §3.2
  autonomy/duties/operator 522–557; §3.3 owner check order 611–619, proof 621–623, **pin sets 625**, **source keys
  629**; §4.1 read types and limits 690–775 (limits line 772); §4.2 seven sources 776–822; §4.3 conflicts 823; §4.5
  routes and `resolveDecision` 844–892 (settings command pins line 884, `orderGoalAdvances` 890); §4.6 user tools
  894–919; §8.2 error-prone rules 1350–1370.
- `slice-5-book-part1.md` "Rules" 1–16 and `slice-5-book-part2.md` rules 17–20 still hold.

## 3. Frozen test files (never change them, not even temporarily)

Do not edit any file under `tests/` (also not `tests/scenarios/harness.ts`, not
`tests/architecture/production-reach-allowlist.json`) — not even to debug and revert. To probe something, write a
throw-away script or test under `./.dsh-scratch/` and delete it at the end. Never use `/tmp`. At the end
`sha256sum <file>` must print exactly (the 25 slice-5 test and support files, then the 9 new files of this round):

```
50a7d9771d036114231c2dfbeded9f2e23f40d40c5acc3f3183e7bc5a3eebc7f  tests/app/S5-decision-routes.test.ts
2f1b2a42357c5ae511cd02a21a984463dbb9d7176def8cf62cade3237bc5b395  tests/app/orchestration-mechanism.test.ts
d0e742048f28e5b15763e62803c57a77154d11909bfb86579d05a18eb886624a  tests/architecture/state-writes.test.ts
52466fedd9ee781b679f92fcbe42dcf3b9aa047779a8ee50479e91b0c83ff685  tests/business/S5-decision-workflow.test.ts
72189afd038a69727d0a72899f7960887db54b0126dce1a4a4994d0c70ce00b8  tests/helpers/S5-application-support.ts
46f16a5647bfa31fb8168aed7e1d122c0e0450a515e6fdfbd5965f05298be317  tests/helpers/S5-decision-fixture.ts
d031e187aaff209482b47a9563dc499ea3ff4f18cf6fdf506f5b89de725de47e  tests/helpers/S5-goal-settings-support.ts
a993335d1a259f6449493b44ddf0214714bfe06b799dfc2b3ff220052578cc25  tests/helpers/S5-queue-support.ts
a02181dc16b0ed05faae5bb68c0404608a5cab08d650ae38ede260ec73b603fb  tests/helpers/S5-user-message-support.ts
f88c8c15ade52761fb8891dfd5d7bbfdfb8fc24b8f599e1e2668f2d9989e41e0  tests/runtime/S5-user-message-tools.test.ts
d45a1f1c57db719bb49c101aca8d7548ae35ab1b715712b7b5c833ab262b8316  tests/scenarios/S5-goal-conflict-rework.test.ts
fc04d8051652df802335e947bf9fd452f694d553433dc3b30db9cbff6171e012  tests/scenarios/S5-two-request-decisions.test.ts
e4a8b44af8713fd4531bff2fd88950335997303fd1efd763a486ba89e29525c1  tests/scenarios/support/S5-decisions.ts
55c96955ab7bb0b4df1158ea32c1a6db95098172574bfae048126eb89e36c787  tests/state/S5-decision-policy.test.ts
b00d90eaa9966a75fcd5b1b97163a5c484a2d3b3c432ff9069c439082c6771f2  tests/state/S5-goal-settings.test.ts
9cc0e4c04534db6cf5ce7e8908da334ea93a5ef39de37fc67d3dd9e88f254e84  tests/state/S5-message-decision.test.ts
a188f229e6ab9946f23e0c12b2a116538d174f223a0441d636feb1e33c07a949  tests/state/S5-notice-settings.test.ts
107252e843869a95d329d518b9557f9a3c820c6a4524fe5cf50da4e101cf8d29  tests/state/S5-request-candidate.test.ts
b9ff065bf4201582425b15fd072bcfeafc449490c5250fb612b6625e4aa6673d  tests/state/message-machine.test.ts
3540f6e0a3e38a9b53926bdd0836fedece02b0e8f7b40827dcfa922956190845  tests/work-graph/S5-decision-application.test.ts
16c22b81819c501c049915b35aa9f8845afebc947316931d46c091b064fd8f89  tests/work-graph/S5-decision-queue.test.ts
455cac59cea61d5a0a4fc32b6a09355d9fdeb363cfbf99000f959679616635b2  tests/work-graph/S5-goal-settings.test.ts
ac177ad2698b0ad7eacf9ac65bb5b6cae9286de9f569e17fcb17ab5a40c17fa2  tests/work-graph/S5-notices.test.ts
360e3e27bfa7969db5782fca73ff6c9d32b4afe3f05287c5d424148305726dfd  tests/work-graph/S5-request-candidates.test.ts
61c3c0169532b5b1d92ea931b699d3bfe0630b991751976917d081c998613516  tests/work-graph/S5-user-messages.test.ts
103ce3f05b5fe7f1d0ecb5a9857740d070646480dccfeb8a09b7aaf001b00411  tests/app/S5R2-driver-safe-point.test.ts
57cf67ccd2920cb7aed485a9d0ae2309c029de5c58539c2907b112926cc286b7  tests/business/S5R2-automation-cards.test.ts
e3df10143cb364afc8571f0912ae6b3f9a4b0591e3ea395dd356607456850d94  tests/business/S5R2-settings-replay.test.ts
9bf67ee89d97165b48db604f6fcfe629489d2f82b15fb194727bfdb6a6230bb8  tests/runtime/S5R2-agent-application.test.ts
de0558ecbb77adf0ed082e7872ef60281f39f5763c1ea63a696a5d4063094e3c  tests/work-graph/S5R2-queue-history.test.ts
6446ecf1e470eadfd7b0771506b3e8b886b311a1638a86c3df501b2fce58cc7e  tests/helpers/S5R2-a-support.ts
0c7eaab3b98186af28753be555e1a26615915ecd1535ddab5bae88c4bd08dd18  tests/helpers/S5R2-b-support.ts
a34d4fc0a3a035c326503715a8ac18d577def1554d4fcdabdfd4c865f169ac14  tests/helpers/S5R2-c-support.ts
69e2c47f4f00fae69cd85eec61a1501c138e1c27b35715b69c78fd900fd596a3  tests/helpers/S5R2-d-support.ts
```

If a correction below seems to contradict a frozen test, keep the test passing and report the test id, the assertion,
the spec line and a minimal counter-example under UNSPECIFIED (rule 17).

## 4. Lead decisions for this round (binding)

- **L-scope.** You may change only the files named in your area's write scope (section 6). No new files unless the area
  says so. No change under `tests/`. `git status --short` at the end: exactly today's paths (103; the same
  list) plus the new files your area names, if any.
- **L-tests.** No test edits and no new tests. Each group's self-check is a review subagent (section 7) plus the checks
  of section 8.
- **L-reach.** `tests/architecture/production-reach.test.ts` must still pass: a new exported declaration must be reached
  from production code; the allowlist cannot be edited.
- **L-interfaces.** Exported signatures used by another area stay as they are (other areas are being fixed in parallel
  against today's signatures). You may add new exports inside your own files.
- **T-R2-1..3** of the test table §1 are binding where your area touches them.

## 5. Rules for every group

Rules 1–20 of the two books hold. In particular: state transitions and protected fields only through
`src/core/work-graph/state/` constructors; replay of an original receipt comes before any new business read (§8.2 line
1366); `forbidden` for another Workspace is decided before reading foreign objects, same-Workspace missing objects are
`not_found`; read failures are returned (`unavailable`/`incomplete`), never turned into empty or `not_found` results;
module edges only as `docs/refactor/module-target.json` (`tasks/`/`evidence/` never import `communication/`/`views/`;
`configuration/` never imports `views/` or a source owner; `state/` imports only `src/contracts/` and itself). Keep
every existing (pre-slice) path's behaviour and public shapes unchanged.

## 6. Area 1 — automation confirmation cards: paused gates and the Workflow's own source

Write scope (`WG/` = `src/core/work-graph/`; line numbers are today's): `WG/state/decision-policy.ts`,
`WG/state/task-failure.ts` (only ADD/export a pure helper; existing exports keep their behaviour),
`WG/tasks/goal-decision-reader.ts`, `src/business/workflow/workflow.ts` (only `automationConfirmation`, ~1123–1215),
`WG/tasks/plan-service.ts` (only the gate fact region: `gateFailureInput` ~868–898 and `gateCoverage` ~2414–2427).
Nothing else. Other areas edit other regions of `plan-service.ts` at the same time; do not touch anything outside the
two named regions.

Interfaces you must not change: the `createGoalDecisionCauseReader` output type, `TaskFailureFactsV1` and
`GateFailureInputV1` existing fields (you may add an optional field only if every existing test still passes),
`WorkflowAdvanceResult`, `DecisionSourceV1`.

Groups (disjoint files): **E-1** = item E1 (`state/decision-policy.ts`, `state/task-failure.ts`,
`tasks/goal-decision-reader.ts`, the two `plan-service.ts` regions); **E-2** = item E2 (`workflow.ts` region). They run in
parallel.

### E1 — a paused Goal's gate automation card disappears (blocker 1)
Rows R2B03, R2B04 (`tests/business/S5R2-automation-cards.test.ts`; table §2.2). Today a gate Task of an `every_step`
Goal gets the Workflow's `automation_confirmation_required` card (action `auto_reverify`); after the operator pauses the
Goal the card is gone from the queue (R2B03 fails at test line 145) and answering it is `not_found` (R2B04 fails at test
line 78). Cause: while the Goal is paused the GV table short-circuits at GV-0 (`state/task-failure.ts:859`), and the
paused re-derivation `pausedAutomationAction` returns `null` for every gate (`state/decision-policy.ts:195–196`) because
GV-5 `fixInProgress` is not part of the Task row's saved failure facts; `tasks/goal-decision-reader.ts:357–361` then
drops the card, and `communication/decision-source-facts.ts:301–318` (`verifyRealCause`, which uses the reader) refuses
the answer. GV-5 is computed in `tasks/plan-service.ts:868–898` from the gate coverage rule (`:2414–2427`: work Tasks in
the gate's goal/stage/module scope) and the covered Tasks' requirement level, disposition and effective phase.
Rules: §8.2 line 1357 ("暂停可答，不能因暂停卡消失"), §2.8 last paragraph (the automation card is derived from the saved
facts; source identity = action + affected refs and versions), §4.5 line 888, §3.3 line 629.
Direction: re-derive, for a paused (not cancelled) Goal, the action the GV table WOULD name for the gate from the same
formal facts (GV-1 … GV-10 without GV-0), including GV-5 from ONE pure shared helper (gate coverage + covered Tasks'
requirement/disposition/effective phase) used by both the plan-service fact builder and the reader, so they cannot
diverge. The paused card must have exactly the `source.key` the Workflow emitted before the pause (same action, same
affected Task/Run pins, same count rule as `automationConfirmation`). Every stop the facts prove (cap, chain limit, fresh
refusal, human stop, covering action) still returns no card, exactly as for a work Task.

### E2 — the Workflow's emitted card source has no `goalBases` (new defect N-R2-1, part a)
Row R2B01 (fails at test line 104: `readDecisionCard` with the Workflow's `decisionCause.source` still reads
`waiting_answer` after the answer). Cause (a): the source built in `workflow.ts` ~1200–1212 has no `goalBases`, against
§2.8 ("每个用于答复的新source包含canonical goalBases；它由owner从正式Goal生成"); the read model finds the answer through the
Workspace taken from `goalBases[0]`. (Part b, the read model, is another area's.) Direction: the emitted source carries
`goalBases: [<the canonical basis of the formal Goal this step read>]`, built exactly like the source-2 reader builds it
(`tasks/goal-decision-reader.ts:102–110` `basisOf`: goalRef, workspaceRef, objective, activePlanRef, settings normalized
with `DEFAULT_GOAL_SETTINGS_V1`); key and pins unchanged.

Tests of this area: `tests/business/S5R2-automation-cards.test.ts tests/business/S5-decision-workflow.test.ts
tests/state/S5-decision-policy.test.ts tests/state/task-failure.test.ts tests/work-graph/S5-decision-queue.test.ts
tests/business/A2-workflow-auto-rework.test.ts tests/business/R5c-workflow.test.ts tests/scenarios/C5-gate-fix.test.ts
tests/scenarios/C5-gate-fix-open.test.ts tests/scenarios/C8-auto-rework-cap.test.ts tests/scenarios/A11-no-progress.test.ts
tests/scenarios/S5-goal-conflict-rework.test.ts`.

## 7. Self-check

When every group has reported and `npm run typecheck` passes: start one read-only review subagent per group with fresh
context. It reads its group's items of section 6, the table rows they name, the named spec lines and the final diff of
the group's files (`git diff slice-base -- <files>`), and answers per item: done / not done / done differently, with
file:line, plus any new defect it sees in those lines (a read failure turned into absence, a pin taken from current
state where a captured one is required, a business read before the replay lookup, a write outside `state/`
constructors, a changed public shape). The owning group (a new subagent if needed) fixes what is not done. Then run
section 8 once.

## 8. Checks (run exactly these)

```
npm run typecheck
npm run check:architecture
npm run build
npx vitest run tests/business/S5R2-automation-cards.test.ts tests/business/S5-decision-workflow.test.ts tests/state/S5-decision-policy.test.ts tests/state/task-failure.test.ts tests/work-graph/S5-decision-queue.test.ts tests/business/A2-workflow-auto-rework.test.ts tests/business/R5c-workflow.test.ts tests/scenarios/C5-gate-fix.test.ts tests/scenarios/C5-gate-fix-open.test.ts tests/scenarios/C8-auto-rework-cap.test.ts tests/scenarios/A11-no-progress.test.ts tests/scenarios/S5-goal-conflict-rework.test.ts
npx vitest run tests/app/A2-continuation-projection.test.ts tests/app/AG2-consultation.test.ts tests/app/AG2b-collaboration.test.ts tests/app/AG6-agent-assembly.test.ts tests/app/S0-attention-edge-label.test.ts tests/app/S1-session-routes.test.ts tests/app/S3-attention-context.test.ts tests/app/S3-graph-routes.test.ts tests/app/S5-decision-routes.test.ts tests/app/S5R2-driver-safe-point.test.ts tests/app/change-emitters.test.ts tests/app/orchestration-mechanism.test.ts tests/architecture/boundaries.test.ts tests/architecture/production-reach.test.ts tests/architecture/state-writes.test.ts tests/business/A2-workflow-auto-rework.test.ts tests/business/A2-workflow-disposition.test.ts tests/business/A2-workflow-result-mapping.test.ts tests/business/R5c-workflow.test.ts tests/business/S1-archive-flow.test.ts tests/business/S1-session-maintenance.test.ts tests/business/S1-task-order.test.ts tests/business/S5-decision-workflow.test.ts tests/business/S5R2-automation-cards.test.ts tests/business/S5R2-settings-replay.test.ts tests/business/WP1-continuation-handover.test.ts tests/business/WP1-start-refusal.test.ts tests/composition/A2-requeue-platform.test.ts tests/composition/A2-verification-chain-platform.test.ts tests/composition/AG1-session-discovery.test.ts tests/composition/R4-control-runtime-platform.test.ts tests/composition/R5c-workflow-platform.test.ts tests/composition/W1-future-plan-platform.test.ts tests/composition/W2-future-intent-platform.test.ts tests/composition/WP1-session-duty.test.ts tests/composition/platform.test.ts tests/contracts/A2-rework-contract-helpers.test.ts tests/kernel/R4a-frozen-public.test.ts tests/record-store/lookup.test.ts tests/record-store/transaction-extensions.test.ts tests/runtime/B1-kernel-assembly.test.ts tests/runtime/B2-runtime-execution.test.ts tests/runtime/C2-runtime-platform-tools.test.ts tests/runtime/C3-brief-timeline.test.ts tests/runtime/R2e-git-source-loop.test.ts tests/runtime/R4-control-runtime.test.ts tests/runtime/R4c-execution-history.test.ts tests/runtime/R4c-graph-history.test.ts tests/runtime/R4c-session-continuity.test.ts tests/runtime/R5b-query-session-loop.test.ts tests/runtime/S1-archive-files-brief.test.ts tests/runtime/S1-routed-replies.test.ts tests/runtime/S3-context-assembler.test.ts tests/runtime/S3-graph-tools.test.ts tests/runtime/S5-user-message-tools.test.ts tests/runtime/S5R2-agent-application.test.ts tests/runtime/W2-role-skills.test.ts tests/runtime/W2-whiteboard-tools.test.ts tests/runtime/WP1-context-assembly.test.ts tests/runtime/orchestration-boundaries.test.ts tests/runtime/source-text-loop-migration.test.ts tests/runtime/source-tool-lifecycle.test.ts tests/scenarios/A1-rework-same-session.test.ts tests/scenarios/A11-no-progress.test.ts tests/scenarios/A4-duplicate-receipts.test.ts tests/scenarios/A7-control-goal29.test.ts tests/scenarios/A7-control.test.ts tests/scenarios/A8-host-restart-entry.test.ts tests/scenarios/A8-host-restart-paused.test.ts tests/scenarios/A8-host-restart.test.ts tests/scenarios/C3-brief-idempotency.test.ts tests/scenarios/C3-not-entered-chain.test.ts tests/scenarios/C3-paused-continue-brief.test.ts tests/scenarios/C3-reply-other-session.test.ts tests/scenarios/C3-workspace-changed.test.ts tests/scenarios/C5-gate-fix-open.test.ts tests/scenarios/C5-gate-fix.test.ts tests/scenarios/C8-auto-rework-cap.test.ts tests/scenarios/C8-human-stop-respected.test.ts tests/scenarios/S1-archive-restart.test.ts tests/scenarios/S1-wait-copy-retirement.test.ts tests/scenarios/S3-context-and-inputs.test.ts tests/scenarios/S3-query-graph.test.ts tests/scenarios/S5-goal-conflict-rework.test.ts tests/scenarios/S5-two-request-decisions.test.ts tests/scenarios/WP1-wiring.test.ts tests/state/S1-anomaly.test.ts tests/state/S1-archive-rework.test.ts tests/state/S1-dispatch.test.ts tests/state/S1-message-routing.test.ts tests/state/S1-responsibility.test.ts tests/state/S1-session-archive.test.ts tests/state/S5-decision-policy.test.ts tests/state/S5-goal-settings.test.ts tests/state/S5-message-decision.test.ts tests/state/S5-notice-settings.test.ts tests/state/S5-request-candidate.test.ts tests/state/WP1-goal-content.test.ts tests/state/context-input.test.ts tests/state/invariants-fuzz.test.ts tests/state/invariants.test.ts tests/state/message-machine.test.ts tests/state/no-progress.test.ts tests/state/plan-machine.test.ts tests/state/query-run-recovery.test.ts tests/state/run-machine.test.ts tests/state/session-availability.test.ts tests/state/task-failure.test.ts tests/state/task-machine.test.ts tests/state/verification-machine.test.ts tests/work-graph/A1-session-lifecycle.test.ts tests/work-graph/A2-goal-control.test.ts tests/work-graph/A2-requeue-service.test.ts tests/work-graph/B2-execution-entry.test.ts tests/work-graph/C1-session-mailbox.test.ts tests/work-graph/C2-mailbox-admission.test.ts tests/work-graph/R3a-goal-replay-boundaries.test.ts tests/work-graph/R3c-canonical-task-state.test.ts tests/work-graph/R3c-plan-adoption.test.ts tests/work-graph/R3e-reverify.test.ts tests/work-graph/R3g-role-spec.test.ts tests/work-graph/R4b-session-directory.test.ts tests/work-graph/R5b-initial-plan.test.ts tests/work-graph/R5b-query-execution.test.ts tests/work-graph/R5b-query-job.test.ts tests/work-graph/S1-anomaly-owner.test.ts tests/work-graph/S1-archive-owner.test.ts tests/work-graph/S1-codecs-indexes.test.ts tests/work-graph/S1-dispatch-guards.test.ts tests/work-graph/S1-provenance.test.ts tests/work-graph/S1-requeue.test.ts tests/work-graph/S1-responsibility.test.ts tests/work-graph/S1-session-facts.test.ts tests/work-graph/S1-wait-disposal.test.ts tests/work-graph/S3-context-inputs.test.ts tests/work-graph/S3-graph-context.test.ts tests/work-graph/S3-prepared-context-admission.test.ts tests/work-graph/S3-role-profiles.test.ts tests/work-graph/S5-decision-application.test.ts tests/work-graph/S5-decision-queue.test.ts tests/work-graph/S5-goal-settings.test.ts tests/work-graph/S5-notices.test.ts tests/work-graph/S5-request-candidates.test.ts tests/work-graph/S5-user-messages.test.ts tests/work-graph/S5R2-queue-history.test.ts tests/work-graph/W1-future-plan.test.ts tests/work-graph/W2-agent-whiteboard.test.ts tests/work-graph/WP1-context-anomalies.test.ts tests/work-graph/WP1-goal-content-entry.test.ts
sha256sum tests/app/S5-decision-routes.test.ts tests/app/orchestration-mechanism.test.ts tests/architecture/state-writes.test.ts tests/business/S5-decision-workflow.test.ts tests/helpers/S5-application-support.ts tests/helpers/S5-decision-fixture.ts tests/helpers/S5-goal-settings-support.ts tests/helpers/S5-queue-support.ts tests/helpers/S5-user-message-support.ts tests/runtime/S5-user-message-tools.test.ts tests/scenarios/S5-goal-conflict-rework.test.ts tests/scenarios/S5-two-request-decisions.test.ts tests/scenarios/support/S5-decisions.ts tests/state/S5-decision-policy.test.ts tests/state/S5-goal-settings.test.ts tests/state/S5-message-decision.test.ts tests/state/S5-notice-settings.test.ts tests/state/S5-request-candidate.test.ts tests/state/message-machine.test.ts tests/work-graph/S5-decision-application.test.ts tests/work-graph/S5-decision-queue.test.ts tests/work-graph/S5-goal-settings.test.ts tests/work-graph/S5-notices.test.ts tests/work-graph/S5-request-candidates.test.ts tests/work-graph/S5-user-messages.test.ts tests/app/S5R2-driver-safe-point.test.ts tests/business/S5R2-automation-cards.test.ts tests/business/S5R2-settings-replay.test.ts tests/runtime/S5R2-agent-application.test.ts tests/work-graph/S5R2-queue-history.test.ts tests/helpers/S5R2-a-support.ts tests/helpers/S5R2-b-support.ts tests/helpers/S5R2-c-support.ts tests/helpers/S5R2-d-support.ts
git status --short | wc -l
```

Expected at the end (this sandbox, without `/usr/bin/bwrap`):
- typecheck, check:architecture, build exit 0.
- The area run: `Test Files 5 failed | 7 passed (12)`, `Tests 12 failed | 218 passed (230)`: only tests/scenarios/C5-gate-fix.test.ts (2), tests/scenarios/C5-gate-fix-open.test.ts (1), tests/scenarios/C8-auto-rework-cap.test.ts (1), tests/scenarios/A11-no-progress.test.ts (7), tests/scenarios/S5-goal-conflict-rework.test.ts (1), bwrap kind (`waiting` instead of `stopped`/`completed`, `ENOENT … /usr/bin/bwrap`, "the Workflow must reach the gate open"). Every other file passes all its tests.
- The named run: `Test Files 31 failed | 118 passed (149)`, `Tests 98 failed | 3831 passed | 29 skipped (3958)`. Two kinds of failures, nothing else: (1) the bwrap/process-sandbox kind, in exactly these files: tests/app/AG2b-collaboration.test.ts (2), tests/app/change-emitters.test.ts (1), tests/app/orchestration-mechanism.test.ts (1), tests/composition/A2-requeue-platform.test.ts (5), tests/composition/A2-verification-chain-platform.test.ts (6), tests/composition/R5c-workflow-platform.test.ts (3), tests/scenarios/A1-rework-same-session.test.ts (1), tests/scenarios/A11-no-progress.test.ts (7), tests/scenarios/A4-duplicate-receipts.test.ts (4), tests/scenarios/A7-control-goal29.test.ts (1), tests/scenarios/A7-control.test.ts (14), tests/scenarios/A8-host-restart-entry.test.ts (7), tests/scenarios/A8-host-restart-paused.test.ts (5), tests/scenarios/A8-host-restart.test.ts (3), tests/scenarios/C3-brief-idempotency.test.ts (4), tests/scenarios/C3-not-entered-chain.test.ts (1), tests/scenarios/C3-paused-continue-brief.test.ts (1), tests/scenarios/C3-reply-other-session.test.ts (3), tests/scenarios/C3-workspace-changed.test.ts (1), tests/scenarios/C5-gate-fix-open.test.ts (1), tests/scenarios/C5-gate-fix.test.ts (2), tests/scenarios/C8-auto-rework-cap.test.ts (1), tests/scenarios/C8-human-stop-respected.test.ts (2), tests/scenarios/S1-archive-restart.test.ts (1), tests/scenarios/S5-goal-conflict-rework.test.ts (1), tests/scenarios/WP1-wiring.test.ts (2), tests/state/invariants-fuzz.test.ts (1), and `tests/state/invariants.test.ts` (collection error `finalize_first … round … is open`, its 29 tests skipped); their messages: `waiting` instead of `stopped`/`completed`, `ENOENT … /usr/bin/bwrap`, `STACK_TRACE_ERROR` (AG2b), `the Kernel ProcessSandbox profile is not available`, `finalize_first: round … is open`, "the Workflow must reach the gate open", "the round must finalize", a timeout waiting for a check; (2) the round-2 RED rows of OTHER areas, which this copy does not fix: tests/business/S5R2-settings-replay.test.ts: R2C02 (memory), R2C04 (memory), R2C02 (sqlite), R2C04 (sqlite); tests/runtime/S5R2-agent-application.test.ts: R2D01 (memory), R2D02 (memory), R2D03 (memory), R2D01 (sqlite), R2D02 (sqlite), R2D03 (sqlite); tests/work-graph/S5R2-queue-history.test.ts: R2A01 (memory), R2A02 (memory), R2A07 (memory), R2A01 (sqlite), R2A02 (sqlite), R2A07 (sqlite), R2A09 (memory). Every row of YOUR area passes. A failure in any other file, another row, or a different message, is yours.
- Every sha256 as in section 3; `git status --short` = 103 paths (the same list as today);
  `./.dsh-scratch/` deleted; no commit (`git log` still shows one commit).

## 9. Reply format

Reply with these four sections and nothing else:
- FILES CHANGED: each file changed in this round, one per line.
- CHECKS: each command and its result (exit code; for vitest the `Test Files` and `Tests` lines and every file with a
  failure: its numbers, each failing test id and the first line of its failure).
- UNSPECIFIED: per item of section 6: `done` with file:line, or what was not done and why; each case the spec, the table
  and this message do not describe; each frozen test you believe contradicts a correction.
- NOTES: at most ten lines: the subagents you ran (group, count); anything that blocked you or is undone.
