**1. Unclear (question → smallest options)**

- **`parseShellActions` does not give ruling 5's `dirs`.** `state/command-normalization.ts:429` returns only `{words,text}`; `cd` is dropped as irrelevant (`:348-398`), and nested `bash -c`/groups are flattened, so per-action preceding `cd`s are lost. Options: (a) internal detailed parse carrying `dirs`, public function maps to `{words,text}`; (b) add `dirs` to `ShellAction` (breaks B2-10's exact projections). Recommend (a). Also confirm how dirs merge across `bash -c`/groups, and that `$`, backticks or a bare/`-` `cd` make `dirs=null`.
- **CRR contract/state vs ruling 2.** `contracts/command-rerun-request.ts:21-48` has no `usedBy`; the `used` event takes only `usedAt` (`state/command-rerun-request.ts:60`), and `consumeAllowance` takes only `{requestRef}` (`model/command-rerun-request-contracts.ts:63-68`). Ruling 2 requires `{runId,callId}` on the record and the consuming call in the port. Extend contract/state/port (recommended) or put `usedBy` in a side receipt (contradicts “next to `usedAt`”).
- **Where the hook gets its data.** `execution-driver.ts:62-79` has `unknownCallReviews` (`readReview` only) but no CRR read/owner port and no `readWorkspace`; the review service has no Kernel-call reader; the card source has no Kernel reader. Suggested: add `commandRerunRequests`, `Pick<WorkspaceToolsPort,'readWorkspace'>` and one narrow `readKernelCall` seam to the runtime/card/review deps. If a seam is absent for a task with a non-empty binding: fail closed `unavailable` (recommended) or treat as no requests.
- **“The task's records”.** There is no UCR index by task: `UnknownCallReviewReadPort.listReviews` accepts only `{goalRef,status[]}` or `{open}` (`model/unknown-call-review-contracts.ts:27-34`). Options: (a) add `{goalId,taskId}` to `listReviews` and filter over the goal index; (b) add `k3-ucr-by-task` (spec change); (c) read only the afterRun's record (contradicts item 7 for later continuations).
- **Continuation data/placement.** `ContinuationUnknownCallReviewV1` (`contracts/continuation-brief.ts:130-140`) has no blocked-line data, and `assembleContinuationBrief` receives only one review record (`continuation-brief-assembly.ts:79-88`). A required field changes every brief digest (marker line), so “byte-identical” fails. Use optional `blockedCommands?` only when non-empty (recommended), plus a flag for the 62-byte sentence. Also: when the afterRun has no record but an earlier task record has blocked commands, is the section rendered? (only-with-review vs standalone).
- **Omission order.** Today's fallback (`continuation-brief.ts:388-430`) searches (anomaly, review) optional pairs at the shortest cap. “Blocked lines omitted first” needs an outer loop over allowed blocked lines; confirm this happens only in the over-budget fallback (after `RENDER_TEXT_CAPS`) and that the heading disappears with the last line. Does the count line stay at the 16-line cap when a line is budget-dropped, or increment?
- **Smaller questions.** The CRR answer identity's phase label (`rerun_request` vs `answer`); the card's original command needs a Kernel reader (`summary.command` would contradict L19a); `RedriveAnswerV1`/`WorkflowAdvanceInput.answers` are `{reviewRef,…}`-shaped (`startup-reconcile.ts:146`, `workflow/contracts.ts:197`) but CRR answers key by `requestRef`; UR7's failed-card set is `UnknownCallReviewRef[]` (`workflow.ts:2655`) but CRR has no review ref.

**2. Book/spec differs from code**

- `prepared-execution.ts` is `src/contracts/core/prepared-execution.ts`; `continuation-brief.ts` is `src/contracts/continuation-brief.ts` plus `core/agent-runtime/continuation-brief-assembly.ts`; `decision-actions.ts` is `src/business/workflow/decision-actions.ts`; the card/answers are under `core/work-graph/tasks/`.
- Group 1 built only contracts, state and the parser. There is **no CRR codec, owner service, index registration, or composition wiring**; the three index constants exist only as constants/comments.
- The CRR state table otherwise matches CRR-01..07; `openRequestForAlias` exists. `UnknownCallBlockedCommandV1` matches §2.
- The binding exists at `prepared-execution.ts:214`, but `execution-preparation.ts:397-420` (`buildManifest`) never sets it.
- The UCR state already writes `ctx.blockedCommands` on skip/approve (`state/unknown-call-review.ts:518-564`); `applyDisposition` passes `[]` (`unknown-call-review-service.ts:1180`). Item 1 is service/expansion work, not a state-table change.
- K3-16's `blockedCommands: []` appears in **two** tests: `tests/work-graph/K3-16-approval-application.test.ts:358` and `tests/scenarios/K3-16-approval-round.test.ts:179`.
- K3-35 numbers disagree: B2's reply says 16,393 at T=600; its test's mandatory is 16,393 but rendered `overflows` is 16,462 (with the 68-byte note). L20 says 93 over. With B3's sentence the fixture gives 16,456 mandatory at T=600 (72 over), not 93.
- `workflow.ts:2675` hard-filters `unknown_call_review` (comment already says B3 adds the kind); `startup-reconcile.ts:146-149` is UCR-shaped.

**3. K3-35 by hand**

Base (B2 fixture, 512-byte task ids): mandatory **15,689** (75 entries + 74 joins; `K3-35-approved-methods-brief.test.ts:107`). Add the 62-byte sentence as a new entry: **15,752** (76 entries, 75 joins).

Blocked section, 32 approved targets with no requests (16-line cap):
- heading `### 被拦的命令` = **19**
- lines 1–9: `- #1@12345678：被拦` = **22** each → **198**
- lines 10–16: two-digit alias = **23** each → **161**
- count line `- 另有 16 条被拦的命令；跑之前先用 request_command_rerun 请求。` = **80**
- joins: heading + 16 lines + count = **18**
- section = 19+198+161+80+18 = **476**

Mandatory = 15,752+476 = **16,228**. Add the existing body-omission note (68+1) = **16,297 ≤ 16,384** (87 bytes spare). All 16 blocked lines fit; **16 are omitted by the 16-line cap** (aliases 17–32), count line says 16; no budget omission. (Assumes no blank line before the heading.)

(三) T=600: +8×88 = +704 → mandatory **16,456**, after dropping all optional blocked lines; **72 bytes over 16,384** → `capacity`. Counting the body note gives 16,525 (141 over). L20's **93** comes from the table's upper bound (16,477), not the fixture.

**4. Tests that will break**

- `tests/work-graph/K3-16-approval-application.test.ts:358` and `tests/scenarios/K3-16-approval-round.test.ts:179` — `blockedCommands: []` must become the real list (the known flip, two files).
- `tests/architecture/production-reach.test.ts:93` (assertion `:105`) — after wiring, every group-1 CRR/parser allowlist entry is “reached now or gone”; remove them or this fails.
- `tests/runtime/K3-35-approved-methods-brief.test.ts:107-110` — exact 15,689/15,758 and `toBe(expected.join)` change when `worstCaseReview()` is given blocked commands for the B3 extension (by design).
- `tests/composition/platform.test.ts:56` — only if a `commandRerunRequests` key is published; avoid by private wiring or update the key list.
- `tests/work-graph/K3-15-disposition-effects.test.ts:299` and `tests/business/K3-review-workflow-rows.test.ts:604-643` are at risk: skip_as_done now renders the 62-byte sentence, and the `answers` hand-over type may grow; their `toContain` assertions should survive, but fixtures/type expectations may not.
- `tests/contracts/A2-rework-contract-helpers.test.ts:401` — ensure the blocked field is absent/optional for briefs without blocked commands, or the round-trip bytes change.

**5. Plan**

| Subagent | Files (disjoint) | Time | Lines |
|---|---|---|---|
| A foundation | `contracts/command-rerun-request.ts`, `state/command-rerun-request.ts`, new `tasks/command-rerun-request-codecs.ts` + owner service, `model/command-rerun-request-contracts.ts`, `create-platform.ts` | 70m | 350–450 |
| B ② + expansion | `state/command-normalization.ts`, `unknown-call-review-service.ts`, `execution-preparation.ts`, `prepared-execution.ts` | 70m | 300–400 |
| C hook | `execution-driver.ts`, `execution-contracts.ts`, wiring note | 55m | 150–200 |
| D request tool | new `agent-runtime/command-rerun-tools.ts`, registration | 55m | 200–250 |
| E card/application/UR7/start-up | `decision-read-model.ts`, `decision-source-facts.ts`, `decision-actions.ts`, `workflow.ts`, `startup-reconcile.ts`, `decision-service.ts` | 80m | 300–400 |
| F continuation | `contracts/continuation-brief.ts`, `continuation-brief-assembly.ts`, `context-assembler.ts` | 65m | 150–200 |
| G close-out | checks + allowlist | 25m | — |

Start A and B together (composition edits owned by A; C/D/E hand wiring notes). Then run C, D, E, F together (4 at once); G last. Total **~1,400 production lines** (soft), ~5h wall, ~4h with the parallel split.