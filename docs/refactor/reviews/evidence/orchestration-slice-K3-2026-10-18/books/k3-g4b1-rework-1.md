# Task: K3 group 4 session B1, rework 1 — the review's nine items and the lead's rulings; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions; report anything undetermined under
UNSPECIFIED with the smallest options, and go on.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`); no fixed limit on subagents (decision 76), files of running subagents disjoint,
every vitest command `--maxWorkers=2`. **Do not end your turn while a subagent has not reported back.** **Finish within
150 minutes** (the run stops at 160). Finish whole items; an unfinished item is reported, not half-done.

## 1. What this copy is

- Tag `k3-g4b1` (HEAD) = session B1 as built (book `./.dsh-ref/k3-g4b1-impl.md` with the lead's 12 answers in its
  section 8; your reply `./.dsh-ref/k3-g4b1-final.md`). With bwrap the lead's check passed: 239 files / 5,156 tests.
- Codex's review: `./.dsh-ref/k3g4b1-review.out.md` (Chinese, 8 must + 1 suggestion). Claude verifiers checked every
  item against the code and the spec: `./.dsh-ref/k3g4b1-verify.md` (Chinese; per item: evidence with file:line, a
  counter-example, the fix assessment and the test that proves it). All nine hold (item 4 partly). **Where this book
  says "as verified", build the fix and the test the verify file describes for that item.**
- The spec: `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md` (frozen; L18 ~424, L19 ~440, L20
  ~547, L29 ~740, §3.2 ~1248, §3.4 ~1305, §5.2 ~1402). Slice 5: `slice-5-SPEC.md` (T02 line 23, §2.8 ~408, line 1329).

## 2. Items (binding)

1. **② guards the Goal it read (review item 1, as verified).** `unknown-call-review-service.ts` ~1010: the commit's
   guards are the record revision AND the Goal revision read in this call (`refKeyOf(goalRef)`, `goal.revision`); the
   content-basis comparison (~961) stays. Do not compare with the captured Goal pin (that would break "answer while
   paused, apply after resume"). Test (K3-17 family, owner level, the §5.1 "two orders" wrapper inserting a real
   `setGoalControl` pause before the `disposition_applied` commit; memory, and SQLite if cheap): today `applied`, after
   the fix `application_not_recorded` with ② `revision_conflict`; again → `awaiting_resume` (`busy`); resume → `applied`.

2. **The Workflow judges ② by its result, not by the state string (item 2, as verified).** Only `workflow.ts`; do not
   change slice 5's `application_not_recorded` mapping in `decision-actions.ts` (answer 9: `goal_conflict` and
   `note_review` unchanged).
   - ② committed (new or replayed) → back to selection; a failed ③ does not hold it up (L29 row 5b) but is reported.
   - ② `revision_conflict` because the record really changed (the rejection's `current` names the record with a
     revision other than the answered card's) → back to selection.
   - Everything else waits with the reason (the existing `dispositionFailure`): `unavailable`, `invalid`,
     `unsupported`, `not_found`, `forbidden`, **the T02 `revision_conflict` (the goal's content changed)**, no action.
     "Waits" = like UR6: the task is skipped; when that task was designated, `waiting` with the reason.
   - **Lead reading for T02 (slice 5 line 1329):** when the goal's content changed after the answer, the answer stays
     answered-pending-application and is never applied silently; the Workflow waits with the reason "目标的内容变了，
     这个答复不能落实"; the person's ways out are today's: the direct "我来处理" (UCR-15) or cancelling the goal. No new
     state, no re-answer.
   - UR7b: ② committed + ③ failed → advance as today but keep the FIRST failure (do not overwrite it with later
     receipts) and put its text in the advance result's `reason`; ② replay failed → the existing `waiting` branch.
   - Fix the comments that say otherwise (~2038–2042, ~2356–2358).
   - Tests: ② keeps failing `unavailable` (a store wrapper) → one advance waits, no second `apply_review_disposition`
     in the same advance; T02 → waits with the reason; UR7b with two answers whose ③ fail → the first failure's text
     is in `reason`.

3. **UR7's ③ is booked under the Host operator (item 3, as verified).** `decision-actions.ts`: the application step
   takes a separate ③ context (`applicationCtx`, default = the ② context): `applicationReceipt` and
   `recordDecisionApplication` use it, `adapter.apply` keeps the execution context; `resolveDecision` passes the same
   ctx twice (no behaviour change); `advanceReviewDisposition` takes `{ applicationCtx?: CoreCallContext }`; UR7
   (`workflow.ts` ~2353) passes `automationContext(owned)` for ② and `owned.ctx` for ③. Do not loosen slice 5's
   guard. Test: K3-17's reverse order (the person applies ② first and ③ fails, then the Workflow's UR7) → ③ booked once,
   card to history.

4. **The note text and the annotations reach the continuation (item 4; lead ruling — L18 "都带进后面的说明或方案").**
   - The disposition stores the answer's annotations: `UnknownCallDispositionV1` (and its codec) gains
     `annotations: { path: string | null; text: string }[]` (`path: null` = the record object, else the file object's
     path), taken in ② from the captured answer (already read ~903), in the answer's order. Slice 5's limits on
     annotations at ① still apply; nothing new is clipped in the record.
   - The continuation brief's review section (`ContinuationUnknownCallReviewV1.disposition`, the exact-keys check
     ~1434) gains the same `annotations`. Render each as one **non-required** line after the per-item conclusion lines:
     `- 批注（<path，或“这份核对记录”>）：<文字>`; it shrinks and is omitted like the other non-required lines (it is
     not part of L20's required budget).
   - `readAnswerText`'s optional default (~966) silently drops the text: make its absence `rejected('unavailable',
     …)` like `taskProjection` (~633); keep it an owner seam (not a required constructor argument).
   - B2 note: the proposal round will also show the text and annotations (L18 "或方案"); not now.

5. **The review section's required lines follow L20's wording (lead ruling: L20's "必需部分的写法" is the exact format;
   L19 says what they mean).** `continuation-brief.ts` ~655–760:
   - `- 处置：<选项的话>（<来源>）[；附言：<附言，缩到 60 个 UTF-16 单位>]。` — one line, the 附言 clipped with `clip` to
     60 units (not by `RENDER_TEXT_CAPS`). Option words: `rerun_as_is` "照原样重跑"; `skip_as_done` "跳过，当作已做：不要
     重跑这些命令"; released `handle_myself` "由人处理：操作者自己处理过这几条，先看当前状态"; **no disposition (the
     review settled by itself) "核对自动定下，不用决定"** (the line is present then too). Sources: "卡上选的", "直接点的",
     "自动". (`safer_method` approved is B2.)
   - `- 作用对象：<dispositionTargets 的别名，用“、”隔开>。` and, when there are unsettled platform targets,
     `- 平台条目 <别名，用“、”隔开>：结果查不清，重做前先核实。`; then `- 不在变动清单里，不证明没做。`. Order as L20
     (the approved-methods block, B2, goes between the targets line and the platform line; the blocked-commands
     sentence, B3, after the fixed sentence).
   - These lines are required (never omitted); the existing `ContinuationBriefCapacityError` path covers them.
   - Tests assert the literal lines for the four cases (card rerun, card skip, released handle_myself, settled by
     itself) and the 60-unit clip (a 61-unit 附言).

6. **The card's file objects (item 5; lead ruling — L18 literally).**
   - Paths: from the record's items of kind `file_edit` (their `summary.paths`), deduplicated in item order; not from
     the workspace sample. With the record object, at most 32 objects (slice 5): the first 31 paths in item order. Fix
     `K3-18-review-card-queue.test.ts` ~268–271 (your own new test) accordingly.
   - Digest: the current digest of each path, read from the working tree; anything not readable → `null` (the
     note views' precedent, `note-views.ts` ~271–284). One helper next to the projection in `tasks/`
     (`Pick<WorkspaceToolsPort,'readWorkspace'>`), called by both the card source (`decision-read-model.ts`
     ~383–458, cached per attempt by path) and `decision-source-facts.ts` ~745; the projection stays pure (it takes
     the digests as input). The composition passes `workspace.tools.readWorkspace` to both.
   - Consequence (accepted, slice 5's object rule): when a file changes between reading the card and answering, an
     annotation on that file is `invalid`; reading the card again gives the new digest. Test it once.

7. **No fact injection in the proof tests (item 6, as verified).** Delete `tests/work-graph/S4C2-U3-ucr.test.ts`
   (K3-41's real hold receipt and the shared decoder test cover it). In `K3-41-disposition-proof.test.ts` ~96–118
   replace the rewritten event with a real cross pair: answer A's real ② receipt submitted through the public
   `recordDecisionApplication` for a second real answer B → the decoder's mismatch result; remove the unused imports.

8. **Row end points (item 7, as verified, with one ruling).**
   - K3-17: continue the paused case: annotations + 附言 'while paused', resume, advance → UR7's receipt, the
     disposition, `application` set, card in history, exactly one TaskRequeue, the brief's literal 附言 part and the
     annotation line (items 4, 5).
   - K3-20: `pageLimit: 2` where it is missing (~155); the mid-read commit creates the FIFTH record (start with four),
     not a hold; assert the five keys, `counts.waitingAnswer` and `countsComplete: true` after the retry.
   - L29 rows 5, 5b and K3-44 (一)(三): end every case with the quiet restart (`expectQuietHarnessRestart`) after the
     flow has settled, and assert that restart's `redriveGoals` is literally `[]`.
   - **Ruling: the restart rows (K3-29, K3-44, L29) run on the Host with SQLite only** — their rows do not name both
     backends and a memory store does not survive a restart. Do not add memory groups for them. K3-20 stays memory and
     SQLite.

9. **The two start-up 6b variants, for real (item 8, as verified).** Rewrite `K3-29-startup-variants.test.ts` on the
   Host (SQLite) with real review rounds and public answers through the card: (a) a record that had a round, card
   answered `handle_myself`, ③ booked; (b) the same with ③ failing (`failCommitOf`); (c) `safer_method` → restart
   with redrive off, stop at the `awaiting_proposal` state entry. Read the restart report's `reviews` and
   `redriveGoals`; (a)(b) end with the quiet restart. **Reading of the handed-over variant:** "a record that had a
   round and whose card was answered held" (an answered card cannot coexist with a running round, UCR-03/UCR-11; the
   held-with-a-running-round case is A's K3-44 (二)). Move `crashOneCommand`, `needsDecisionCard`, `answerCard` from
   `K3-15-card-hold.test.ts` ~93–162 into `tests/scenarios/support/` and reuse them (no third copy).
   `K3-29-startup-answers.test.ts` ~62, ~93: use real Goal reads (the card fixture's `plans.queryGoal`) instead of
   hand-made Goals.

10. **One paging algorithm (suggestion 9, as verified).** Move `lookupAll` and `LookupBatch` from `goal-conflicts.ts`
    ~78, ~116–154 to `src/core/work-graph/persistence/lookup-all.ts` (port type `Pick<RecordLookupPort,'lookup'>`,
    result `{ items, watermark, truncated: false }` unchanged); `goal-conflicts.ts` re-exports it;
    `decision-answer-lookup.ts` ~25–52 and `unknown-call-review-answers.ts` ~31–32, ~99–123 import it. Do not fold in
    `plan-readers.ts`'s `readLookupKeys` (a different contract).

## 3. Rules

TDD per item: a failing test first (for the right reason), then the smallest change. Tests through public owners and
routes; literal expectations; fault injection yes, fact injection no (AGENTS rule 4). State transitions only through
`src/core/work-graph/state/`. Do not edit other existing assertions; if one fails, report it (test, assertion, rule,
counter-example). No real model calls, no git writes, never ports 3080/3099/44797; probes under `./.dsh-scratch/`,
deleted at the end. Production line budget for this rework: about 450 net (soft); report the count.

## 4. Checks (close-out subagent)

`--maxWorkers=2`: every `tests/**/K3-*.test.ts`, `tests/**/K-*.test.ts`, `tests/**/S5*.test.ts`,
`tests/**/S4C2-*.test.ts`, `tests/business/`, `tests/scenarios/WP1-*`, `tests/scenarios/A8-host-restart*.test.ts`,
`tests/state/`, `tests/composition/`, `tests/app/S4C*.test.ts`, `tests/architecture/`, the changed files; then
`npm run typecheck`, `npm run check:architecture`, `npm run build`. Failures listed in `DSH-BASELINE.md` are expected
(no bwrap). Do not run the full suite.

## 5. Reply

Under 600 words: files changed (production net; tests), each item RED → GREEN, checks with numbers, UNSPECIFIED (short,
with options), subagents (task, time, most at once).
