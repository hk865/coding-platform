# FILES CHANGED (this round; 23 source files)

```
src/app/startup-reconcile.ts
src/business/workflow/contracts.ts
src/business/workflow/ports.ts
src/business/workflow/session-archive.ts
src/business/workflow/session-maintenance.ts
src/business/workflow/workflow.ts
src/composition/create-platform.ts
src/contracts/continuation-brief.ts
src/core/agent-runtime/execution-preparation.ts
src/core/work-graph/model/claim-contracts.ts
src/core/work-graph/queries/contracts.ts
src/core/work-graph/queries/query-execution.ts
src/core/work-graph/sessions/message-record-codecs.ts
src/core/work-graph/sessions/session-directory.ts
src/core/work-graph/sessions/session-lifecycle.ts
src/core/work-graph/sessions/session-record-codecs.ts
src/core/work-graph/sessions/session-responsibility-service.ts
src/core/work-graph/tasks/claim-record-codecs.ts
src/core/work-graph/tasks/plan-readers.ts
src/core/work-graph/tasks/requeue-service.ts
src/core/work-graph/tasks/session-anomaly-service.ts
src/core/work-graph/tasks/session-facts.ts
src/core/work-graph/tasks/session-provenance-facts.ts
```
(`src/app/collaboration-driver.ts` was modified by G-W3 but is net-zero vs HEAD — E17 removed the only part-1 addition.) No test/helper/config/docs/vendor file was touched. `.dsh-scratch/` was deleted.

# CHECKS

- `npm run typecheck` — exit 0.
- `npm run check:architecture` — exit 0 (`next source boundaries: OK`; `pure submodules: WorkGraph/state`).
- `npm run build` — exit 0.
- S1 23-file command — `Test Files 1 failed | 22 passed (23)` / `Tests 1 failed | 211 passed (212)`. Failing: `IT19` `tests/scenarios/S1-archive-restart.test.ts:194` `AssertionError: expected 'waiting' to be 'completed'`; the underlying step is `ENOENT: no such file or directory, access '/usr/bin/bwrap'` (environmental, as expected).
- 22-file regression command — `Test Files 5 failed | 17 passed (22)` / `Tests 13 failed | 528 passed (541)` (matches the expected 528/13). Failing files: `C3-brief-idempotency` 0/4, `C8-human-stop-respected` 5/2, `A8-host-restart-paused` 1/5; first error lines name `/usr/bin/bwrap` (e.g. `settled: ENOENT: ... '/usr/bin/bwrap'`). Per-file matches the reference baseline.
- 21-file command (section 6) — `Test Files 19 failed | 2 passed (21)` / `Tests 71 failed | 167 passed | 29 skipped (267)`. Per file: R6-host 1, R5b-initial-planning-workflow 1, C1-M1-platform 1, R5c-workflow-platform 3, A11-no-progress 7, A4-duplicate-receipts 6, A7-control-goal29 1, A7-control 14, A8-host-restart-entry 7, A8-host-restart-lease 2, A8-host-restart-paused 5, A8-host-restart-rework 2, A8-host-restart 3, C3-reply-other-session 3, C6-unrelated-adoption 5, harness 4, invariants (suite, 29 skipped) 1, A2-step1-codecs 1, C1-session-mailbox 5. **The only failures not explained by the missing check sandbox (7):** `A2-step1-codecs` `AssertionError: expected { status:'decoded', value:{…(14)} } to deeply equal { status:'decoded', value:{…(12)} }`; `C1-session-mailbox` 5× `AssertionError: expected { status:'committed', …(3) } to deeply equal { status:'committed', …(3) }` (diff `+ replyHandler: null` / `+ archiveWaitDisposition: null`) at `:348/:440/:485`; `C1-M1-platform` `AssertionError: expected { status:'committed', …(3) } to deeply equal { status:'committed', …(3) }` at `:64`. All 64 remaining failures run through `run_check`; where the output surfaces it, it is `ENOENT: … access '/usr/bin/bwrap'` and the first error is a downstream state assertion (`expected 'waiting' to be 'completed'`, `effectivePhase:'verifying'`, `expected [] to deeply equal ['FAIL',…]`, `the continuation r2 must be claimed`, etc.). I verified the bwrap text in the A7-control and A8-host-restart-paused traces; the 22-file baseline is unchanged.
- `git grep -n "not implemented: " -- src` — no output (exit 1).
- `git status --short` — **94 paths (61 src + 33 frozen)**, not 95; `src/app/collaboration-driver.ts` is net-zero (see UNSPECIFIED).
- `sha256sum -c` of all 33 section-1 files — all `OK`; `sha256sum src/contracts/platform-duty.ts` = `6adfb57e8bcb7ec387257e19c3811abb61a5fd21d37a8889566bf34cc32a9e39`. `./.dsh-scratch/` deleted.

# UNSPECIFIED

- **R2 frozen-test contradiction (7 residual non-bwrap failures).** `tests/work-graph/S1-codecs-indexes.test.ts` SV01 `:279-280,:295-296` and `tests/work-graph/S1-dispatch-guards.test.ts` SV58 `:164` require the Session/Message decoders to emit explicit `null` for old records, matching spec §2.9 (lines 447-449). `tests/work-graph/A2-step1-codecs.test.ts:684`, `tests/work-graph/C1-session-mailbox.test.ts:348/440/485` and `tests/composition/C1-M1-platform.test.ts:64` require the absent key. Per L-f I kept `null` in `sessions/session-record-codecs.ts:1030-1031,1077-1078` and `sessions/message-record-codecs.ts:730,752` and left those 7 failing. Flipping to absent-stays-absent would satisfy them but break SV01 (2 assertions) and SV58; the lead's decision L-f chose the other side.
- **E15 closed only in half (lead-approved).** `workflow.ts:718-736` writes `continuation` provenance and keeps archive-origin pickup `new`; I added the pending-`archiveRequest` → `new` guard at `:724-726`. Missing: (a) the `transfer_responsibility`/`archive_predecessor` WorkflowOperation kinds + owner calls, (b) a predecessor field on the `create_session` continuation step, (c) sequencing `create_session → transfer → archive_predecessor → claim_task`, (d) the decision-42 paused-continuation seed. `transferSessionResponsibility` is never called from `workflow.ts`; the predecessor's responsible link is left open, so it cannot finalize-archive.
- **E8 admission differs for the no-instance case.** `create-platform.ts:984-988` allows `hostInstance === undefined`, while `resolveUnknownRun` (`:1090`) rejects it. A literal "same admission" breaks frozen in-process scenario compositions that pass no `hostInstance`; the held-lease case still returns `busy`.
- **R4 mechanism.** Implemented with non-enumerable properties (`create-platform.ts:1150,1218-1220`): `Object.keys` hides them, the route bindings still read them (`core-routes.ts:563-569`). The spec does not fix the mechanism; removing them entirely would break `tests/app/S1-session-routes.test.ts`.
- **A1 refusal shape.** `session-directory.ts:746-756` refuses an unresolved 64-hop chain with `incomplete` and prefix `session_provenance_cycle:` (guided A1); §3.2 maps that prefix to `cycle`. No frozen test pins the 64-hop case.
- **Rule 9 edge.** `session-archive.ts:327-328` returns a raw rejection when `readFacts` fails after the durable request committed, instead of `ready/partial` with R. No test covers it.
- **Old `sessions/archive` wait guard.** `session-lifecycle.ts:710-719` never passes `ctx.archive`, so the old route cannot refuse a normal wait; spec §4.4 S:863 says it must still refuse open responsibility/occupancy/普通等待 (the A8 Q-01 "no unfinished choice, no occupancy → 200" case passes).
- **A9 scope.** `runDisposeAttempt` (`session-responsibility-service.ts`) still reads the Task basis before destination eligibility; A9 named transfer only.
- **N6 scope.** `executionPins` enforces complete refs/canonical order/no duplicates/≤2/`[]`, but does not reject an extra unrelated pin when the required execution pin is present.
- **N7 wording.** §2.7 fixes neither the omission wording nor granularity; I drop whole per-anchor path lines and add one global count (`continuation-brief.ts:274-328`), with `capacity` mapped at `execution-preparation.ts:453-457`.
- **Path-count deviation.** Final `git status` is 94, not the stated 95: `src/app/collaboration-driver.ts` is net-zero because E17 required removing its only part-1 addition (`readRoutedReplies?`, unused there; the live seam is consumed at `execution-inputs.ts:148-152`).
- **New optional result field.** E17 added `WorkflowAdvanceResult.value.maintenanceFailures?` (`contracts.ts`); spec §4.2 S:823 defines no such field, only that failures stay visible.
- **E5 read scope.** `readTaskRequeue` is Host-only (`requeue-service.ts:1050-1052`); the spec does not name the new read, so Agent readability is undetermined.
- **invariants.test.ts.** Its suite setup fails in this environment at `:297` (`busy finalize_first: round … is open`, check sandbox), so its 29 tests are skipped rather than exercised.

# NOTES

- Closed: step 0 (`ports.ts` `now`/`responsibilityBasis`/`legacyProvenance`, `claim-contracts.ts`+`requeue-service.ts` E5 read, `create-platform.ts` injection); G-S R2(session/message)/A1/A4/A9/N5/N6; G-T R2(requeue)/B2/B3/B6/B8/C1/N3/N4/E5-owner/E2-owner; G-C N7 (+ capacity wiring in `execution-preparation.ts`); G-W1 R3(L-e)/E3/E5/E12/N1; G-W2 R1/E2/E13/E14/N2 + `kernel_turn_open` skip; G-W3 R4/E8/E15(provenance half)/E16/E17/N3-wiring/E5-K6.
- Main-session fixes after the waves: filtered the §0.1-U1 `busy/archive_unknown_confirmation_required:` skip out of reconcile `problems` (A8 W-14/W-07), narrowed the retired-`kernel_turn_open` auto-archive to a platform `interrupted_clean` interruption (`session-maintenance.ts:379-389,513-515`), added the pending-`archiveRequest` → `new` guard (`workflow.ts:724-726`), corrected the `records` comment in `ports.ts`.
- Subagents: 8 — Wave-1 G-S/G-T/G-C, Wave-2 G-W1/G-W2/G-W3, and 2 read-only self-check agents; all inactive before this reply.
- Not closed: R2 (7 expected failures), E15 second half, A9 `runDisposeAttempt`, N6 extra-pin, old-route wait guard, rule-9 `readFacts` edge, and the 94-vs-95 path arithmetic.
- Environmental: 64 of the 71 failures in the 21-file command are the missing `/usr/bin/bwrap` check sandbox; the lead should re-run in the bwrap environment.