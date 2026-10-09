# Slice 5 — rebase onto the branch, lead fixes, area briefs (stage S5-Rebase, track A, slot s5)

2026-10-09 12:08 onward, lead (Claude). Branch feat/reliability-and-structure at 216e0e2b (slices 0, 1, 3 merged;
only docs after e48218a5); real worktree untouched (no commit in this stage); the product model was not called;
DSH and Codex not used in this stage. `S` = `scratchpad/impl/s5`, `R` = `S/rebase`, `A` = `S/areas`.

## 1. New copy s5m

- `mk-slice-copy.sh s5m 216e0e2b` → `~/dsh-work/slices/s5m` (`R/mk-copy.txt`): tree c5f77bd7… = source tree; one
  commit a664f1b5 "baseline 216e0e2b… (s5m copy)", tags `slice-setup` and `slice-base` on it (slice-base = the
  HEAD tree, no DSH-BASELINE.md commit; the merged slice-5 work stays uncommitted on top, so a patch from this copy
  is relative to the branch HEAD). The runner pattern `s<digit>…` accepts `s5m` (no runner change needed).
- Export of s5 (temp index, `R/export.sh`): `git diff --cached --binary --full-index slice-base` incl. untracked →
  `R/s5-full.patch` sha256 6391f963…ac44d03 = `S/p2/p2g-full.patch` (the copy had not changed since the guided
  round); 93 paths. The s5 copy itself is untouched (still 93 status paths).

## 2. Three-way apply and the merge decisions

`git fetch ../s5 slice-base` (temporary ref `refs/s5import/base`, deleted after) for the 48c8d473 blobs, then
`git apply -3 --binary R/s5-full.patch` (`R/apply.sh`, logs `R/apply-check.txt`, `R/apply-3way.txt`): 74 files
clean, `src/contracts/platform-duty.ts` identical on both sides (merged to the base bytes, so it drops out of the
diff), **18 files with 54 conflict hunks** (`R/conflicts.txt`; diff3 copies of the conflicted files in
`~/dsh-work/s5m-merge-orig/`; every hunk printed in `R/all-hunks.txt`). Resolved by `R/merge-resolve.py` +
`R/merge-spec.py` (each hunk an explicit rule; asserted counts). Both sides kept everywhere:

| file | hunks | merge |
| --- | --- | --- |
| `src/app/core-http-types.ts` | 1 | CoreRouteSuffix: 11 slice-1 + 2 slice-3 + 12 slice-5 suffixes; only the last carries `;` |
| `src/app/core-routes.ts` | 4 | binding types, route table, bindings, dispatch arms: slice 1/3 then slice 5 |
| `src/business/workflow/contracts.ts` | 1 | `maintenanceFailures?` (s1) and `decisionCause?` (s5) both on `WorkflowAdvanceResult.value` |
| `src/business/workflow/ports.ts` | 3 | imports united; `WorkflowCloseEventReader` + `ResolveDecision*`; archive/maintenance and `resolveDecision`/`orderGoalAdvances` members |
| `src/business/workflow/workflow.ts` | 2 | imports; the returned port has both slices' members |
| `src/composition/create-platform.ts` | 7 | imports; options `sessionArchivePolicy`/`sessionDutyResolver` and `operatorActor`/`messageDutiesMapping`; record/event/lookup schema lists carry SESSION_ANOMALY and DECISION schemas; tracked wrappers for archive/maintenance and resolveDecision/orderGoalAdvances; platform keys `graphContext, taskInputs` and the five slice-5 ports |
| `src/core/agent-runtime/execution-driver.ts` | 4 | owners `graphHistory/graphContext/taskInputs` + `decisionMessages`; tool names; the "no tool" guard and the name list include both `decisionNames` and `graphNames` |
| `WG/communication/mailbox-service.ts` | 6 | see below |
| `WG/model/communication-contracts.ts` | 1 | imports united |
| `WG/queries/query-record-codecs.ts` | 1 | QueryRun lookups: slice-1 `QUERY_RUN_BY_SESSION_LOOKUP` and slice-5 `QUERY_JOB_BY_WORKSPACE_GOAL_LOOKUP` |
| `WG/sessions/message-record-codecs.ts` | 5 | imports (`checkSessionBody`, `isPlatformCursor`); allowed keys `replyHandler, archiveWaitDisposition` + `goalRef, decision, application, since, noticeAutomationCap`; both field checks; event registry `ArchiveWaitDisposed` + the two decision events; decode = slice-5 strip of the wire origin THEN slice-1 null defaults (`replyHandler`/`archiveWaitDisposition`, slice-1 §2.9 default table, frozen SV01/SV58) |
| `WG/state/message-machine.ts` | 8 | imports; event union, guard facts, event types, the transition functions, dispatch arms, record changes and `nextSessionMessageRecord` cases of both slices |
| `WG/tasks/claim-record-codecs.ts` | 4 | requeue keys `archiveOrigin` + `since, noticeAutomationCap`; both origin checks (slice-1 local renamed `archiveOriginProblem` to avoid shadowing); decoders strip the notice origin (s5) and keep the slice-1 comment that absent `archiveOrigin` stays absent |
| `WG/tasks/claim-service.ts`, `WG/tasks/plan-readers.ts` | 1 + 1 | imports united |
| `WG/tasks/requeue-service.ts` | 2 | imports united (check order: textually merged without conflict; both slices' requeue tests pass, §4) |
| `src/ui/api/routes.ts` | 1 | ROUTE_LABELS of both |
| `tests/architecture/state-writes.test.ts` | 1 | MESSAGE_FIELDS = both slices' protected fields + slice-5 `WORKSPACE_USE` |

mailbox-service details: (1) imports united (`decodeGoalSnapshot`, decision/material ports, `CommitCursorBinding`,
`UniqueClaimChange` + slice-1 lifecycle/lookups/`encodeSessionRecord`). (2) slice 5 deleted the file-local
`encodeMessageEvent` (every message event now goes through the one writer's `encodePersistEvent`), slice 1 had
extended it for `ArchiveWaitDisposed`: replaced by `encodeArchiveWaitDisposalEvent` (only that event; the disposal
commit also writes the source Session, so it stays outside the one writer), call site in `writeArchiveWaitDisposal`
adjusted. (3) `EVENT_ID_SUFFIX`: both. (4) `replayMessage`: slice-5 delegation to the shared
`replaySessionMessageReceipt`, and slice 1's `ArchiveWaitDisposed` decoding ported INTO that shared function (so the
facade's receipt re-check replays a disposal too). (5) `canReadMessage`: slice-5 user-recipient guard + slice-1
reply-handler read. (6) the big tail: slice-1 `disposeArchiveWait`/`readUndeliveredReplies`/`readRoutedReplies`
then slice-5 `sendUserMessage` and the write-owner facade; the returned mailbox object has both slices' methods.

## 3. Merge and regression fixes (lead; exact replacements, `R/fixes.py`, `R/fixes2.py`, `R/fixes3.py`, `R/fixes4.py`)

Type fixes after the merge (typecheck had 4 errors, then 0):
- **M1** `business/workflow/ports.ts`: `GraphWrite` imported twice (slice 1 from session-contracts, slice 5 from
  task-contracts; same structural type) → one import.
- **M2** `communication/decision-service.ts` (slice-5 new file): its `EVENT_ID_SUFFIX` table is total over
  `SessionMessageEventType`, which slice 1 widened → `ArchiveWaitDisposed: 'archive-wait-disposed'` (same suffix
  as the mailbox).
- **M3** `tests/helpers/S1-session-facts-fixture.ts` (slice-1 committed helper): slice 5 widened
  `SessionMessage.recipient` to `MessageRecipient` (user | Session); the fixture builds a Session consultation from
  a Session message → `message.recipient as SessionRef` (type only). New sha256 b68edde8…f04cc.

Found by the named runs and the whole suite:
- **M4** `composition/create-platform.ts`: slice 5's five platform ports (`goalSettings`, `workspaceDecisionSettings`,
  `decisionMessages`, `decisions`, `requestCandidates`) were enumerable public keys → the existing frozen
  `tests/composition/platform.test.ts` (exact public key list) failed ×2. This is a slice-5 regression (fails on the
  s5 copy alone too; slice 5's regression set did not contain the test). Same rule as slice 1 R4 and the slice-3
  integration fix e48218a5: internal owners, non-enumerable, same instances.
- **M5** `app/core-routes.ts`: the slice-5 frozen RT06 builds bindings from `{ ...composed, … }`; a spread drops the
  non-enumerable owners of slices 1/3/5, so the eager `.bind` of `platform.sessionFacts…` threw. The 20 bindings of
  internal owners now read `platform.X === undefined ? unsupported(…) : platform.X.m.bind(platform.X)` (first try
  with a by-name helper broke `production-reach` — 158 declarations no longer statically reached — so the static
  `.bind` form was kept).
- **M6** slice-1 decode defaults × slice-5 frozen equality assertions: a decoded Message carries `replyHandler: null`
  and `archiveWaitDisposition: null` when absent (slice-1 SPEC §2.9 default table line 450; frozen SV01/SV58); the
  slice-5 tests (written on the old base) compared decoded/read Messages with objects lacking those keys
  (S5-message-decision 11, S5-goal-settings 16, S5-decision-application 12, S5-user-messages 2,
  S5-user-message-tools 1 failures). Decision (lead): the merged contract is slice 1's (spec + frozen SV01, already
  on the branch); slice 5's rule "never backfill" is about its own fields and still holds (`expectNoNewFields`
  unchanged). The expected side of those assertions gets the two read defaults (`R/fixes2.py` M6, `R/fixes3.py`
  M6b for the UM12 ack DTO: the ack writes the decoded Message, so its result, stored JSON and event carry the two
  nulls). 7 assertion sites in 5 frozen slice-5 test files; no production change.
- **R1** `business/workflow/workflow.ts` `automationConfirmation`: the existing A11 #15 scenario (cap lowered after the
  request was built) expects the requeue owner to commit `auto_rework_cap_reached` (ND-7) and the Goal to show
  GOAL-30; slice 5's perform gate turned "countedNext > cap" into its own `automation_confirmation_required` wait
  first, so no refusal was committed. Slice-5 regression (fails on s5 alone too). Fix: past the cap the gate
  returns null and the existing fence decides (spec §3.2 "countedNext>cap … the existing fences stay"); the gate
  only adds the autonomy rule.
- **R2** same file, `gatePerform`: the existing `A2-workflow-auto-rework` test performs a malformed requeue request
  (`input: {}`) and expects `unsupported` (the owner publishes no requeueTask); the slice-5 gate dereferenced
  `request.input.taskRef.taskId` first and threw. Fix: a malformed request returns null (the existing step judges it).
  Found only by the whole suite (run 1).

The five small review items (decision 47):
- **N1** `views/decision-read-model.ts` `nextQueueCursor`: the notice continuation starts from the previous cursor's
  per-category positions; only displayed categories advance (interleaved categories no longer repeat).
- **N4** `tasks/plan-service.ts` `proposePlanAsAgent`: the scoped proposal check (scope, schema 2, `basedOn` not null,
  shape) runs for a replacement too, before `readPlan(input.basedOn!)` (a replacement with `basedOn: null` is now
  refused `forbidden` like a first record, no crash).
- **#12** `tasks/goal-settings-service.ts` pair conflict application: a paused EARLIER Goal also answers `busy`, a
  cancelled one `invalid` (as the `conflict_order` path already did; S5-GS-06/02).
- **#21** `tasks/plan-service.ts` `planAcceptanceProof`: without a `decisionSource` the proof still lists every change
  (proposal, Goal, created PlanRevision) with `capturedPins: []`, `basisRebases: []` (D8).
- **#22** `persistence/decision-record-codecs.ts` `aggregateRefProblem`: a `SessionWorkLink` pin needs a known relation
  and a closed `WorkLinkTarget` (task/module/work ref fields, `WorkContextBinding` for work) in its own project
  (persistence cannot import `sessions/`, so the check is local, 25 lines).

## 4. Checks

All in the copy, real bwrap via `~/cc-work/env.sh` (`CODING_AGENT_BWRAP_PATH`) + `with-usr-bin-node.sh`, under the
test lock. (First named run `named1` forgot `~/cc-work/env.sh`: every check-sandbox test failed on
`/usr/bin/bwrap`; not counted.)
- typecheck / check:architecture: 0 after M1–M3 (and after every later fix).
- Named sets (`R/named-files2.txt`, 129 files = slice-5 new 16 + slice-5 regression 25 + AG2/orchestration-mechanism
  + the slice-1/3 integration list 98 + platform/R4-control-runtime-platform):
  `named2` (before M4–M6/R1) 7 failed files / 44 tests (M5 RT06, M6 ×42, A11 #15); `named3` (after) 2 files / 3
  tests (UM12 ack DTO, production-reach of the first M5) → fixed (M5b, M6b): the 4 affected files 40/40.
- Whole suite run 1 (`R/full1*`, `npm test` = `vitest run --maxWorkers=1`, 12:33–12:59): **266 files / 5,850 tests,
  1 failed** (A2-workflow-auto-rework, R2); typecheck 0, architecture 0, build 0. After R2: that file + S5-decision-
  workflow + A11 + C8-auto-rework-cap + S5-goal-conflict-rework 32/32.
- Whole suite run 2 (`R/full2*`): 13:01–13:28, after R2: typecheck 0, check:architecture 0, build 0; **266 files / 5,850 tests, all passed** (1,669 s). This is the accepted baseline of the s5m state.
- Counts vs the branch (250 files / 5,626): +16 slice-5 files (224 tests) = 266 / 5,850 exactly; the slice-5 edits of
  existing tests add no test (message-machine, state-writes, orchestration-mechanism); no file missing.
- DSH sandbox (no `/usr/bin/bwrap`), the 129 named files (`R/sbx1*`): `Test Files 23 failed | 106 passed (129)`, `Tests 68 failed | 3697 passed | 29 skipped (3794)`; every failure is of the bwrap kind (`waiting` vs `stopped`/`completed`, `ENOENT … /usr/bin/bwrap`, `finalize_first … round open`, check timeouts; invariants.test.ts fails at collection, 29 skipped) in 23 files that all pass with bwrap (full2). Plus `A2-workflow-auto-rework` 18/18 and `change-emitters` 6/7 (1 = no ProcessSandbox) run separately. Per-area and whole-list expectations derived from this are written into the briefs (`A/values.json`, `A/area-numbers.py`).
- Frozen slice-5 tests: new sha list `R/frozen-tests-v3.sha256` (8 of 25 changed: state-writes and message-machine
  by the merge with slice 1's edits; S5-message-decision, work-graph/S5-goal-settings, S5-decision-application,
  S5-user-messages, S5-user-message-tools by M6). Slice-1 helper `S1-session-facts-fixture.ts` changed by M3.
- State of the copy: `R/s5m-merged.patch` (vs slice-base = 216e0e2b, binary, incl. untracked) sha256 9d655f8d1fba4df472399069663e7fe87de115c5c6e78df0381813a356603150 (reproducibility checked: a fresh `git archive 216e0e2b` + `git apply --binary` gives the same 93 paths, byte-identical); 93 paths
  (`R/s5m-merged.name-status.txt`: s5's 93 − `platform-duty.ts` + `S1-session-facts-fixture.ts`); `git status` 49 M +
  44 ??; no commit in the copy (log = baseline + tags).

## 5. The remaining large items: four area briefs (decision 46/47)

Briefs `A/A-brief.md` (25.5 KB, sha256 3ca1cf1f…), `A/B-brief.md` (28.6 KB, c78e13ed…), `A/C-brief.md` (23.8 KB, d03da5a2…), `A/D-brief.md` (24.9 KB, 18f57b31…), each ≈ 7–8K tokens (assembled by `A/assemble.py` from `_common-head.md`, `<k>-body.md`,
`_common-tail.md`, `values.json`). Each: what the copy is, spec line map, frozen sha list (v3), binding lead decisions,
rules, the area's items with file:line + spec rule + direction, groups with boundaries and interfaces, the
headless "stay in the turn" paragraph (from `s3/p2g.sent.md` §4 / `p2/p2g.sent.md`), self-check by fresh review
subagents, checks with expected sandbox numbers, reply format FILES CHANGED / CHECKS / UNSPECIFIED / NOTES.

| area | items (review ids) | write scope | groups |
| --- | --- | --- | --- |
| A queue history and read model | N2 (+ `candidateCard` refuses accepted), #4 read-model part, #17, #20 | `views/decision-read-model.ts`, `views/goal-conflicts.ts`, `tasks/plan-readers.ts` (add only) | A-1 history, A-2 scope/failures/window |
| B decision sources, saved answers, application recording | N3, #16, N6, agent-modifier recording (+ runtime pre-read), #1 remainder, #6 remainder, #26 | `communication/decision-source-facts.ts`, `decision-service.ts`, `mailbox-service.ts`, `tasks/goal-decision-reader.ts`, `state/decision-policy.ts` (add only), `agent-runtime/communication-tools.ts` (record case), `business/workflow/workflow.ts` (`automationConfirmation` only) | B-1 causes, B-2 answers/application, B-3 mailbox |
| C ordering safe point | N5, #15 | `app/collaboration-driver.ts` | C-1 |
| D settings replay and proofs | #10/G-E1 + the reported conflict_wait/conflict_order tension, owner rebase for modified Goals, third-Goal proof | `business/workflow/decision-actions.ts`, `tasks/goal-settings-service.ts` | D-1 replay, D-2 owner |

Independence: the four write scopes are disjoint, and every brief freezes the exported interfaces the others use
(L-interfaces), so the four can run in parallel in four copies of the s5m state (decision 36: 2–3 DSH at once; tests
one at a time). Suggested order if not all at once: B and D first (the user-visible defects: unanswerable
automation card, lost answers, impossible application recording, retries ending in `idempotency_conflict`), C next,
A last. Each run: NEW Session, `--max-context 360000 --max-minutes 120`, then a Codex re-review per area, the
lead merges the four disjoint patches onto s5m and runs the whole suite with real bwrap before integration.

Lead decisions written into the briefs (recorded here):
- B5 note: `createDecisionSourceFacts({ records })` without `plans` (only frozen tests build it so) keeps the
  named-code check; production injects `plans` (`create-platform.ts:644`). Codex #1's second half is not a
  production defect.
- D: a cancelled Goal in a pure `reorderGoals` list keeps its old `order` and is not written (#24 should-fix not
  taken: a cancelled Goal never competes); the wait cycle stays `invalid` (frozen GS09; spec "invalid/cycle" read as
  `invalid`).
- All: no test edits / new tests in the round; production-reach must pass without allowlist edits.

## 6. Open items

- Making an area copy (next stage): `mk-slice-copy.sh <name> 216e0e2b` (e.g. s5a, s5b, s5c, s5d), then
  `git apply --binary R/s5m-merged.patch` (sha 9d655f8d…) inside it; check 93 status paths, `frozen-tests-v3.sha256`
  (`R/`), platform-duty sha; books under `~/dsh-work/slices/_books/`. The briefs need no placeholder filled.

- Track W (wiring I-1/I-3, the goal-content check, E15) changes the branch in parallel; if W merges first, the
  s5m state (base 216e0e2b) and the area patches need one more three-way rebase (likely crossings:
  execution-entry-service / context-assembler / create-platform / core-routes / session owners).
- The large items have no tests (the frozen tests do not catch them, which is why the review found them). Decision
  46 suggests Codex-written fixtures first; this stage did not write any. The lead or the user may want fixtures for
  N3, N6, D1 (retry replay) and C1 (no stall) before or with the DSH runs.
- The review's should-fix #26 is in area B as the last item (allowed to stay undone if C1/C2 would change).

## 7. Measurements (decisions 43, 46)

| who | wall | notes |
| --- | --- | --- |
| lead, this stage | 12:08 → 13:35 ≈ 87 min | ≈ 140 tool calls (bash/read/write/edit) |
| waiting (listed separately) | ≈ 62 min | named runs 3 × ≈ 2.5 min (named1 12:16–12:19, named2 12:23–12:26, named3 12:29–12:31); small reruns ≈ 4 min; whole suite run 1 26 min (12:33–12:59), run 2 27 min (13:01–13:28); sandbox named run 1.5 min (13:27–13:29) + 2 small sandbox runs ≈ 1 min. Run 1 overlapped with drafting the briefs (≈ 15 min), run 2 with notes/briefs (≈ 20 min). |
| working | ≈ 45–50 min | export/copy/3-way apply, 54 hunks resolved by rule, 12 fixes (M1–M6, R1, R2, N1, N4, #12, #21, #22), failure classification, four briefs |
| DSH / Codex | 0 | not used in this stage (the briefs are for the next stage) |

Addendum 13:36: the branch moved to 67dfee7a during this stage (track W: `docs/…/slices/wiring-1-SPEC.md` only, a new
doc file); the s5m base 216e0e2b is still the branch's code tree, so the merged patch applies to HEAD unchanged.
The real worktree was not modified by this stage (status clean).
