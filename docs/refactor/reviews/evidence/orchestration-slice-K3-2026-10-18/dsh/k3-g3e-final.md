# K3 group 3, session 5 reply

## FILES CHANGED
Production: **none** — `git status --short -- src vendor` is empty. Tests only (+413/−338):
`tests/work-graph/K3-13-two-items-owner.ts` (189→254), `tests/scenarios/K3-42-unexpanded-r2.ts` (rewrite, 201), `tests/helpers/K3-large-review-input.ts` (+36/−37), `tests/work-graph/K3-35-owner-manifest-trim.ts` (+6), `tests/scenarios/K3-19-missing-read-no-round.ts` (+6/−1).

## ITEMS (RED → GREEN)
1. **K3-13 owner.** Now `reconcileRun` (RUN-20(i)) → `resolveUnknownRun` (two `process` items, real `sha256Hex(canonicalJson(args))`) → public review `claimTask` (asserts `activeRound`) → `enterReviewRound` → `recordConclusion` item 1 → end round → `settleReview`; memory+SQLite. RED (create skipped): `readReview` `expected 'not_found' to be 'ready'`. GREEN 2/2; settlement assertions kept.
2. **K3-42 (二) real chain.** `hostAdopt` (public `plans/propose`/`apply`) sets a 243,916 B instruction; one >4 KiB control-char `shell` is crashed in flight; WORK manifest 250,194 B, REVIEW expanded 280,554 B > 262,144, floor 252,900 → real prepare `unexpanded`. Scripted Runtime writes through `record_unknown_call_review`, real `settle_review`, HTTP `unknown-call-reviews/read`. RED (repeat=10): `expected 'truncated' to be 'unexpanded'`. GREEN 1/1; `undetermined`/`crash_undetermined`, no `crash_possible`, model text kept in `reviewerConclusion`.
3. **K3-35 owner prepare.** Helper claims the round publicly and reads the real Run via `createRunStateReader().readExecution`; prepared Run equals owner `activeRound`. RED: `expected undefined to deeply equal {aggregateType:'Run',…}`. GREEN 3/3.
4. **K3-19 A1.** Locks `status === 'unavailable'` + behavioral no-claim, not the reason wording. No behavioral RED exists (only an over-specified equality weakened); GREEN 1/1.

## CHECKS (`--maxWorkers=2`)
Touched 4: **4 files / 7 passed**. Every `K3-*`: **47 files, 243 passed, 0 failed**. `A8-host-restart*`: **6 files, 20 passed / 21 failed** = baseline 20+1, no new failure. `architecture/`: **3 files, 52 passed**. `npm run typecheck` **exit 0**.

## UNSPECIFIED
`renderUnknownCallReviewZh` emits the full D6 sentence only for `truncated`; for `unexpanded` it emits `- #1 shell：没展开，按判断不了处理。` (`execution-preparation.ts` ~109–117). Spec L13/row 1437 wording places the sentence beside both. Test asserts the real rendered line. No production change made; flagged only.

## SUBAGENTS
3 at once strictly (S1 items 1+4, S2 item 2, S3 item 3), then 1 close-out; **most at once: 3**.