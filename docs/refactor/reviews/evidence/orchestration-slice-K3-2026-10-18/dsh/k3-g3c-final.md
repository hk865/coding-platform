All work is complete and the close-out is green. Final reply:

# K3 group 3, session 3 reply

## FILES CHANGED
**Production: 5 files, +80/−27** (net +53): `contracts/review-admission.ts` (A1, B1), `app/runtime-configuration.ts` (A1), `composition/create-platform.ts` (A2), `core/agent-runtime/unknown-call-review-tools.ts` (B3), `business/workflow/workflow.ts` (B2). No new production files.
**Tests: 7 modified (+205/−20), 9 new test files + 1 helper (~2,630 lines incl. helper).** New: K3-06, K3-11 (owner + R2), K3-13, K3-19(一), K3-35(一), K3-37, K3-42, K3-45(一), helper `K3-mixed-seams.ts`. Modified: K3-19 capability-host, K3-review-workflow-rows, review-admission, K3-10, K3-12-14, K3-R1-workspace-capture, K3-48-2.

## ITEMS A/B (all done)
- **A1** RED: `['shell','run_readonly_command']` + full access → capability `available`. GREEN: one exported `reviewHostLayerOneAccess` predicate used by both admission and `readonlyCommandAccess` → `unavailable`; real Host case. 64 passed.
- **A2** RED: store-fail branch reported `runBaselineKnown:true`. GREEN: both branches pass `captured.baselineKnown` → `false` (vi.mock body-store seam + attestation entry). 7 passed.
- **A3** both capacity tests now assert the spec literal `158_720`, not the production constant.
- **B1** RED: proposal-phase returned `null` (review set) / `role_invalid` (ordinary tools). GREEN: `proposal_phase_unsupported`, fail-closed before any other check; L13 set still `phase==='review'` only.
- **B2** RED: no binding → `pass` and a prepare on the unadmitted origin Run. GREEN: binding looked up once, passed to `planReviewRound`; missing → `skip('review_binding_missing')` → named task `waiting`; record stays `pending_review`. 15 passed.
- **B3** RED: short receipt `undefined` — whole-record result exceeded the 64 KiB output limit, round ended `outcome_unknown`. GREEN: bounded `{status,item,revision,receipt,replayed}`; round `completed`; settlement asserted. 16 + 6 passed.

## ITEMS C (all 8 done, real chain)
- **K3-06** 1 passed: one record, items `platform`/`file_edit`/`process`, one review round, one continuation. (RED test-side: wrong alias.)
- **K3-11** 12 passed: each L17 reason alone + three-at-once in fixed order (`review_incomplete,partial,confirm_each_step`); one real R2 case. RED = inverted order/empty streak.
- **K3-13** 2 passed: second item settles `undetermined`/`settlement` with `核对轮没有给出结论`. RED: item 2 still pending.
- **K3-19(一)** 2 passed: no round, 0 model calls, settle `review_unavailable`, item `只读命令用不了`. RED: record not settled.
- **K3-35(一)** 2 passed: 32 items/512-byte callIds/>4 KiB control-char commands/200×512 paths; manifest 235,085 B ≤ 256 KiB; trim order and omit counts; no callId; alias+tool floor. RED: untrimmed sample / callId present.
- **K3-37 (一)(二)(三)** + **K3-45(一)** 5 passed: cancel/pause-crash → `review_stopped`, no second round; goal-pause restart → `unfinished` then round 2; two unfinished rounds → `needs_decision` with `review_incomplete` though every item concluded. (Production already complete; one test-side RED.)
- **K3-42** 3 passed: `truncated`/`unexpanded` re-judged to `undetermined` + `crash_undetermined`, no `crash_possible`, model text kept in `reviewerConclusion`. RED: pre-D6 assertion. 

## LEFT FOR GROUP 4
Cards/decision queue + dispositions for K3-11/13/19/37/42/45 (records only asserted). K3-48(二)'s `propose_safer_method` half. Proposal phase (L20), UR6/7/7b/8, and the continuation-note per-kind text / `TaskRow.unknownCallReview` display for K3-06.

## CHECKS (`--maxWorkers=2`)
`tests/state/`: 38 files, 3,829 passed, 1 failed (baseline `invariants`), 29 skipped. `tests/runtime/`: 57 files, 450 passed. `A8-*`: 6 files, 20 passed / 21 failed (all baseline, no bwrap; verified against stashed `src`). Every `K3-*`: 41 files, **227 passed, 0 failed**. `WP1-continuation-handover` + `S1-archive-flow`: 24 passed. `composition/platform` + `WP2-wiring`: 38 passed. `tests/architecture/`: 52 passed. `typecheck` 0, `check:architecture` 0, `build` 0. One non-baseline integration break fixed by close-out: `K3-12-14` read the old full WriteResult; now reads the bounded receipt's top-level `revision`, assertions unchanged.

## UNSPECIFIED
1. B1's proposal refusal is unit-level (`reviewRoundAdmissionProblem`); option: add a proposal case in `tests/runtime/K3-19-review-admission.test.ts`.
2. K3-35(一): the Kernel serializes `process` calls, so a real 32-in-flight RUN-25 cannot exist; size/trim run through the real prepare service with a review-record double, plus a smaller (>4 KiB) real R2. Option: use K3-06's read_only+independent stand-in trick for a 32-call R2.
3. B3 field named `receipt` (not `receiptRef`); `status` reuses `written.status`.
4. K3-06's seams keep real tool names but set read_only+independentReadOnly to parallelize (trades effectClass for reachability); platform verdict `not_done` isn't pinned by the row.
5. K3-37(三) drives round 2 on the review root (Host resume fan-out not asserted); K3-42(二) reads the `unexpanded` record via the owner port, not HTTP.

## SUBAGENTS
11 tasks, ~10–50 min each; **most at once: 3, strictly** (T3 finished before T4 started; never a fourth). T1 A1+B1, T2 A2, T3 A3+B3, T4 B2, T5 K3-35(一), T6 K3-06, T7 K3-13+K3-19(一), T8 K3-11, T9 K3-42, T10 K3-37+K3-45(一), T11 close-out.

## SURPRISING
- Production already implemented every C row; the subagents found no production gap there.
- **Real L11 gap (flagged, not fixed, out of this session's items):** with a `needs_decision` record a later advance still performed an ordinary `requeue_task`+`claim_task` — `workflow.ts:1239` returns `pass` for `needs_decision`, and `run-machine.ts:631`'s `reviewPending` fact has no producer (`unknown_call_review_pending`). K3-43/L11 territory.
- Kernel `RegistryToolBatchPolicy` serializes `process` calls, forcing multi-call batch tests to use read_only+independent stand-ins.
- The K3-48(二) near-threshold record's 155 KB `cwd` is D6-`truncated`, so settlement correctly re-judges it `undetermined`/`crash_undetermined`, not `resolved`.