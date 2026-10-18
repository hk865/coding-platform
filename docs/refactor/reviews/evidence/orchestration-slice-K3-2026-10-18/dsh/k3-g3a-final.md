All checks are done and the tree is clean. Here is the reply.

# K3 group 3 — session 1 reply

## FILES CHANGED
**Production: 41 src files** (39 modified +2 new) **+2,578/−308**; section-3 rework ≈ **+405/−122**, group 3 ≈ **+2,173/−186** against the ~1,800 soft budget (over; group 2 also ran ~2×). Key: `tasks/unknown-call-review-service.ts` (+558), `agent-runtime/unknown-call-review-tools.ts` (new 214), `readonly-command-tool.ts` (+94), `context-assembler.ts` (~+290), `workflow.ts` (+219), `claim-service.ts` (+178), `execution-preparation.ts` (+93), `runtime.ts`/`execution-driver.ts`/`ports.ts`/`plan-readers.ts`/`plan-contracts.ts`/`contracts.ts`/`create-platform.ts`/`core-routes.ts`, `state/{run-machine,task-failure}.ts`, `model/{tool-commit-arguments,claim-contracts}.ts`, `tasks/unknown-call-review-codecs.ts`. **Tests: 23 files** (11 modified +12 new) **+3,592**; seams: `production-reach-allowlist.json`, `K3-R1-continuation-protection`, `K3-40-ignored-at-capture`, `K3-39-request-id`, `K3-14-*`, `K3-19-review-capability`, `K3-48-2-*`, `UCR-settle-review`, `unknown-call-review-list`, `K3-review-preparation`, `K3-12-review-round-tools`, `K3-review-workflow-rows`.

## SECTION 3 (all done, each RED→GREEN)
1 dispatch by tool name (K3-39). 2 one request-id + `agentActorOf` + decision payload (K3-39, S5R2 hand-rolled). 3 L8 draft checks (K3-26 六×3). 4 `streakOf` reset point (K3-32 #1b). 5 L6 symlink/normalised-protection (`lstat`, realpath) (`K3-R1-continuation-protection`). 6a `'unknown'`/`不知道` from the full capture; 6b `baseline_dirty`. 7 ignored-at-capture only in `notVisible`. 8 G11 short-circuit (A2 33-call: capture 0, lookups 0). 9a K3-39 via `createToolCommitLookup`, per-name cases, frozen literal `c2-tool:7c4852…c5f0`; 9b via public `materials/open` (see UNSPECIFIED); 9b′ close target/receipt; 9c real `replace`/`create`, two-entry renamed. 10 one `readWorkspaceBaselineFromBundle`.

## SCOPE
- **Item 1 done:** `recordConclusion` (UCR-04 replay/idempotency/overwrite/guards/M3), `settleReview` (UCR-06/06b/07/08b/08c, D6 re-judge via the manifest), `listReviews` + route. K3-14 11/11 (memory+sqlite).
- **Item 2 done:** TASK-03r/RUN-01r/ATT-16r, RUN-02 review line, `leaseReleasedForContinuation` in claim/requeue; **K3-47 (三)(四)** green after a follow-up threading `requeue.leaseRelease` into the claim basis and a review-purpose skip in `plan-readers.ts`.
- **Item 3 partial:** purpose `review`, L13 preparation + trimming, context section, `record_unknown_call_review`, control-only input channel, no recursive review — built and unit-green; **the round cannot `start`**: `context-assembler.ts:1385/1422` marks the review instruction `callKind:'continuation'` while `continuationBrief` is null, and `context-input.ts:262-280` rejects it. Fix needs the context-kind contract + `execution-entry-service` suffix path (session 2). **K3-05 thus blocked, reported, not half-done** (the half-written test was deleted).
- **Item 4 done (U4):** one `TaskGate`; UR0/1/2/3/3a/4/5/9 before `automaticRequeue`; `performStep` start/observe → `settle_review{round_ended}`, never `open_checks`/`afterNotNormalEnd`; `create_session{review}`, `close_open_turn afterRunRef=lastHolderOf`, `WorkflowCalls.settle_review`; `automationConfirmation` early return untouched. `tests/business/K3-review-workflow-rows.test.ts` 11/11.
- **Item 6 done:** A2 `review_round` unskipped and green via a real review claim (captures 0, lookups 0). **U5 done:** shared `registerReadonlyCommandTool`/`readonlyCommandSandboxOptions`; `reviewCapability` probes with the real options.
- **Rows:** K3-10 24/24 (12 literal cells ×2 backends), K3-12 2/2, K3-14, K3-47(三)(四), K3-48(二) `record_unknown_call_review` half. Two real bugs found and fixed: the codec rejected every `partial` conclusion (K3-10); the driver's unknown-name check used `RESERVED` so `edit` was wrongly recognized (KB-09 regression — my coordinator fix: recognize `EXPLORATION_TOOL_NAMES`, not all reserved; 52/52 runtime tests green).
- **Left for group 4:** K3-48(二) `propose_safer_method` capacity; K3-10's card/queue entry (record asserted instead). **Session 2:** K3-05 (blocked), K3-06/11/13/19(一)/35(一)/37/42/45(一).

## CHECKS
Close-out (`--maxWorkers=3`): state 36/2 files (baseline `invariants`, `invariants-fuzz`), runtime 53/1 (KB-09), A8 1/5 (all baseline), all K3 25/1, WP1 17/17, S1 7/7, K3-workflow 11/11, platform 2/2, WP2 36/36, architecture 52/52, new files 79/79; typecheck/check:architecture/build exit 0. It named **two group-3 regressions**: KB-09 (fixed above) and `K3-R1-second-cleanup` (B). After the fix, K3 family 69 files/543 tests: only `K3-R1-second-cleanup` fails; architecture 52/52; typecheck/build 0.
- **B is not a code bug:** L11's claim guard returns `unknown_call_review_pending` because A's RUN-25 record is `pending_review`, so B's ordinary continuation never starts; the test needs a review settlement before B. Per §5.3 I did not edit it — lead post-note needed (test id: `K3-R1-second-cleanup`, assertion at `:156`; rule L11; CE: A shell → RUN-25 → pending_review → B continuation blocked).

## UNSPECIFIED
- 9(b): `executions/brief` cannot open the pre-`begin` note (`runtime.ts:467`, binding written at `run-machine.ts:838`); used `materials/open`. Options: read after begin / accept.
- Item 3 blocker: no `callKind`/section name for the review instruction; options: add `review` section + validator branch, or carry the rendered suffix on the binding.
- `RuntimeInputBindingV1` has no review digest; RUN-02 compares `manifest.unknownCallReview` instead.
- App Host `RuntimeHostBindings.readonlyCommandAccess` is unset in `createWorkbenchRuntimeHostBindings` (`src/app/runtime-configuration.ts`), so production `reviewCapability` answers `unavailable`; the method takes no Role, so which binding's sandbox options to use is undefined. Options: workspace-unique binding / add a Role / leave to the app slice.
- `recordConclusion` identity uses `(round Run, alias, requestId)` (replay precedes alias→callId); `ClaimTaskInput.review`/`plan-contracts` were needed though off-list; `settleReview` display via a narrow port.

## SUBAGENTS
8 tasks: rework A (items 1–4,8,9a), rework B (5–7,10,9b–c), owner writes (1/K3-14/K3-48二), claim (2/K3-47), U5+tool, preparation+context, workflow+U4+wiring, rows K3-10/12, item6+K3-05, close-out. Per-agent context/time is not exposed to me; wall-clock ≈20–50 min each.

## SURPRISES
Four real integration bugs surfaced only through the public seams: the request-id mismatch, the codec's `partial` rejection, the `RESERVED`-vs-exploration tool-name check, and the review instruction failing continuation-section validation (which blocks every real review round `start`).