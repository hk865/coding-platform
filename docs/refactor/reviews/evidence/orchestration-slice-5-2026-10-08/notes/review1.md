# Slice 5, part 1: checks, test review, guided round, freeze (resumed stage, 2026-10-08 evening)

Stage started 20:35 (+08:00) after the WSL restart. Copy `~/dsh-work/slices/s5` (base tag `slice-base`, commit 076eee0 = HB 48c8d473 tree). DSH Session `session-f8ceb6a6-568c-4ff7-ab85-40d9a740468f`.

## 1. Part-1 scripted checks (state at the stop, re-verified)

- Copy unchanged since p1c ended (16:46): no work-tree file newer than that; `git status --short` md5 equal to `lead-p1-status-after.lf`; `part1.patch` (sha256 9a947076…9e45, binary, incl. new files, excl. `.dsh-scratch/`) equals a fresh `git diff --cached --binary slice-base` of the copy.
- Shape: 41 A + 45 M = 86 paths. Out of the 82-file scope: `src/contracts/query-job.ts`, `src/core/work-graph/queries/query-job-service.ts`, `src/ui/api/routes.ts` (lead rule: labels only), `src/ui/views/sessions/render.ts`, `tests/app/orchestration-mechanism.test.ts`, `tests/state/message-machine.test.ts`. In scope but untouched: `state/goal-machine.ts` (deferred to part 2), `production-reach-allowlist.json` (part 2).
- typecheck exit 0; check:architecture exit 0 (43 submodule edges, views present, `pure submodules: WorkGraph/state`).
- New tests: 16 files, 224 runs (153 ids, AP10/11 absent) = §0.6. 214 failed / 10 passed. 205 failures are `not implemented` throws; 9 are AssertionErrors (TU05; RC02/03/04/07 ×2). Passing: PC01, PC05, PC09, RT03, RT05, RT07, RC11 ×2, UM12 ×2.
- Regression (25 files): per file equal to the baseline except `production-reach.test.ts` 3/1 (118 unreached new declarations; allowlist is part 2). `state-writes` 19/19. The 7 baseline scenario failures (bwrap) unchanged.
- Extra (not in the book's regression list): `tests/app/AG2-consultation.test.ts` 4/4 FAIL (HTTP 500) on the s5 copy, 4/4 pass on the s0 copy (`lead-p1-extra-AG2-consultation.txt`, `base-s0copy-AG2-consultation.txt`). Cause: see finding P1.
- No commit in the copy (`p1c.log.txt`: only the baseline commit). scan.json p1 and p1c: errors 0, privateTmpUses 0, canaryHitCount 0; `contamination: attempted-outside` comes only from `dotdot` pattern hits, which are `../../src/...` import strings in written test files (8 + 2), not file access outside the copy.
- Existing-body changes (`part1-body-diff-deep.txt`, 48 deepest changed functions): route/composition wiring (allowed); narrowing guards (allowed shape); but also codec bodies, tool registration/selection, the collaboration pump and `start` implemented early (finding P2, decision A10).

## 2. Test review

Codex (`codex-cli 0.162.0-alpha.2`, effort high, read-only) on `D:/cxt/impl-s5-p1` = HB + `part1.patch`: 20:38–20:52 (14 min). Note: the binary path given in the stage text (`…/bin/ca9abb0b4d8ac692/codex.exe`) no longer exists after the restart; the current one is `…/bin/9691020b546a15b2/codex.exe` (first launch failed with exit 127 at 20:38:51, relaunched). Output `codex.md` (42 findings: 40 must-fix, 2 should-fix), prompt `codex.prompt.txt`.

Lead's own read (before Codex returned): all of `tests/work-graph/S5-goal-settings.test.ts`, `S5-decision-application.test.ts`, `S5-user-messages.test.ts`, `S5-request-candidates.test.ts`, `S5-decision-queue.test.ts`, `S5-notices.test.ts`, `tests/app/S5-decision-routes.test.ts`, `tests/state/S5-goal-settings.test.ts`, PC01/02/03/05/06/07/09/10, TU05, SC02 body, the fixture's seeding lines; scripted id check (`lead-p1-ids.txt` vs `spec-ids.txt`: 153 ids, service ids ×2). That is far more than 15 cases across all files.

Lead verified independently (before or after Codex): P1 consultation stub call (AG2 regression); P2 `await orderAdvanceSelection` between `handles.get` and `handles.set` in `collaboration-driver.ts:847/858` (race; it does not reach the stub because of the `length <= 1` shortcut at :454); SS rows not performing their sequences (SS02, SS06–SS16); UM harness without `operatorActor` and without a duties adapter (UM01 vs UM02–04 identical setups, opposite expectations); UM11 uses another principal (would be `forbidden`); AP receipts are `TrustedScopeSeeded` for all rows (AP03/AP04/AP05/AP09 identical setups, four different expectations); DQ `cardSources: []` and one shared world for contradicting rows (DQ02/03 vs DQ07); NR `displayToken: 'page'`; RT owners from `{} as never` and a test-local always-throwing `resolveDecision`; pin sets vs §3.3 line 625 (Workspace pin added to settings writes, `expected: []` for applications); duplicated literal source key `s5-message-source` for two messages (fixture :535); `proposal_replaced` lacks the new candidate's content (`plan-machine.ts:244`); the second claim fixture's `r4c-claim-*` scope and the predecessor rule at `verification-machine.ts:513`; C1 ack replay exists at `C1-session-mailbox.test.ts:339–346`; WF02 reorders only [B, A] while C exists; the message-machine coverage map maps new events to old fixtures. Codex findings not individually re-run by the lead are passed to DSH as "reread the row" items, not as answers.

Verdict: the tests could not be frozen. State-row files were close; the service, route, tool, workflow and scenario files had systematic defects (rows not performing their operation, contradicting expectations on one shared fixture, missing operator/duties configuration, fake receipts, wrong pins and keys).

## 3. Lead decisions (technical; spec §0 > body > DESIGN > HANDOFF)

- A1 extra files accepted (6, type-forced changes only): `src/contracts/query-job.ts` (InitialPlanAnswerFacts move + re-export: `model → tasks` is a forbidden edge, the spec's placement is impossible), `queries/query-job-service.ts`, `src/ui/views/sessions/render.ts`, `src/ui/api/routes.ts` (labels), `tests/app/orchestration-mechanism.test.ts` (assertion meaning unchanged, Codex agrees), `tests/state/message-machine.test.ts` (only a type-forced change that keeps the old assertion text). Part-2 final shape becomes 82 + 6 = 88 paths (goal-machine and the allowlist join in part 2).
- A2 S5-MSG-05 = `decision_application_recorded` (spec §3.1 paragraph after the first code block says so explicitly).
- A3 keep `proposal_accepted` for old callers (§5.5); `proposal_adopted` carries the existing acceptance inputs + request association; `proposal_replaced`/`proposal_recorded` carry what is needed to build the new candidate and the slot effect.
- A4 `proposal_read` read-only; verdict observable from a pure function.
- A5 `SentEventBase` in model + re-export accepted.
- A6 spec gap (§4.2 signatures without deps): factories `createGoalDecisionCauseReader(deps)`, `createPlanningQuestionReader(deps)` whose method has the spec signature; free dependency-free stubs removed; composition builds one each and the read model gets card sources built on them.
- A7 one `decodeNoticeOrigin`, in `persistence/decision-record-codecs.ts`.
- A8 guard contexts hold only facts named by the guard column; unconditional rules are invariants; read failures returned by the service first (§3.1). Final field set to be frozen after the round.
- A9 scenarios may keep the harness seed scope (harness.ts must not change, §5.4), but Q1/Q2 on one Goal and canonical keys.
- A10 early implementations inside existing codec/tool/pump bodies stay as early part-2 work (reverting costs a round and they are re-reviewed with part 2); only bodies that change an existing path (P1, P2) must be fixed now. Known defects in them go to the part-2 corrections (Codex 6, 7, 8: Host response variant in the `SessionMessageResponded` validator; unvalidated `decisionSettings` in `workspaceSnapshotFromValue`; wire-only `since`/cap leaking through the Round/Requeue decoders and unvalidated persisted `since:null`).

## 4. Guided round (§6.4, the only one for part 1)

Sent `part1-guided.sent.md` (book copy `~/dsh-work/slices/_books/s5-p1g.md`, sha256 53e6ddfa…d58c) at 20:55:48 to the same Session via `run-part-g.sh p1g` (caps 90 min / 60M tokens, as the s1 guided round). Contents: decisions A1–A10, production fixes P1/P2, 17 test items by file:line + spec row + direction, checks incl. AG2-consultation.

## Measurements so far

| part | wall | main Session (run.json) | subagents (dsh-usage.mjs, split by creation time) |
| --- | --- | --- | --- |
| p1 (capped at 60 min) | 3380 s | 22,178,457 tokens, 145 tool calls, 143 steps | 23 subagents, 139,022,297 tokens, 1,562 calls, 1,173 steps |
| p1c (continuation) | 1010 s | 14,443,160 tokens, 53 tool calls, 48 steps | 7 subagents, 35,864,304 tokens, 414 calls, 341 steps |

Snapshot `usage-at-p1g-start.jsonl` (20:56): all Sessions 213,204,830 tokens, 2,178 calls (main Session there already includes the first p1g steps).

Codex test review: 14 min wall (20:38–20:52), effort high.
