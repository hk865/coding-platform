# Task: K3 group 4 session B2, rework 1 — Codex's review (seven items); coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions; report anything undetermined under
UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`); no fixed limit on subagents at once (decision 76), files disjoint, every vitest
command `--maxWorkers=2`. **Do not end your turn while a subagent has not reported back.** **Finish within 160 minutes**
(the run stops at 170). Finish whole items; an unfinished item is reported, not half-done.

## 1. What this copy is

Tag `k3-g4b2` (HEAD) = session B2 (book `./.dsh-ref/k3-g4b2-impl.md` with the lead's 11 answers in its §8; your reply
`./.dsh-ref/k3-g4b2-final.md`). Codex's review: `./.dsh-ref/k3g4b2-review.out.md` (Chinese, items 1–7 with file:line
and the fix approach). `./.dsh-ref/k3-g4b3-impl.md` is the next session's draft book: do not build any of it. The
spec: `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md` (L15, L16, L20, §2 `propose_safer_method`,
§3.2 UCR-06..08c, §5.2 K3-16, K3-35).

## 2. Items (binding; the review's numbering)

1. **The second unfinished proposal round always reaches the person (lead ruling from L15, L16, UCR-08).** When this
   state entry's second round ends unfinished, settle to `needs_decision` with `review_incomplete` in the reasons,
   **even if every `proposalTargets` item already has a proposal** (L15: "哪怕每一条都已经写了结论 … 不能凭两次都没跑完
   的轮次自动放行"; L16: non-empty reasons → `needs_decision`), plus `proposal_missing` only when an item really lacks
   a proposal; the four-option card (three when the round slots are used up). Rows through public entries, memory and
   SQLite: first round writes every proposal then ends unfinished, second round ends unfinished → `needs_decision`,
   reasons exactly `review_incomplete`; a new state entry counts from one again.
2. **The proposal round's command text (lead: answer 3 amended).** The agent proposes a replacement for the real
   command, so the proposal input uses **the same command source and rendering as the review input** (the Kernel's
   full text when readable, else the record's summary; the same budget, trimming and `display`), not the 512-character
   summary only. The one change: an item the trimming made `unexpanded` renders the record's `summary.command` (newline
   rule as `approvedMethodLinesZh`) followed by `（只是摘要：全文太长，没有放进这一轮的说明）`, never `（无）`. The review
   phase's input stays byte-identical. The approval card keeps answer 2 (the summary).
3. **`approvedMethodLinesZh` indents newlines in `cwd` too** (L20: "命令和 cwd 里的 `\r\n`、`\n` 都换成 `\n` 加两个空格"),
   in the same function; a literal-output case with `cwd: "a\nb"` and a budget case at the 5,120-byte boundary that
   counts those bytes.
4. **The tool contract has no explicit null `cwd`** (§2 `cwd?: string`): drop `.nullable()`; explicit `null` →
   `invalid_arguments`; absent → the owner's internal `null` (rendered `.`). Change the test that fixed the old
   behaviour (report before/after).
5. **No fact injection in the B2 tests.** `K3-16-approval-application.test.ts`, `K3-16-proposal-write.test.ts` and the
   proposal half B2 added to `K3-48-2-unknown-call-review-model-text-budget.test.ts` reach their prior state through one
   shared fixture of public steps: the real proposal claim, `propose_safer_method` from a scripted model (or the public
   `recordProposal` owner where the row is owner-level), the Run's end, `settleReview`; memory and SQLite. The mixed
   card is reachable now at owner level (precedent `tests/work-graph/K3-06-mixed-kinds-owner.test.ts`); do it here, not
   in B3. Expected values literal: `K3-16-approval-application.test.ts` ~137 stops calling the production renderer.
   Injection that existed before B2 in those files: report it, do not rewrite it.
6. **K3-35 (二)(三) with consistent facts.** The approved facts come from public owners: one process item whose single
   approved method is a multi-line command whose indentation brings the block to exactly 5,120 bytes, and 31
   undetermined platform items (32 targets), the anchors as L20 with T = 512 and T = 600. Counters that public steps
   cannot reach (the 16-digit omitted count) go into a separate renderer-contract boundary case on the pure renderer
   (a contract test, not state injection). Recompute every expected byte by hand from L20's table and say how.
   Codex's figures for B2 (without B3's 62-byte sentence and its join): required part 15,710 bytes at T = 512, 16,414
   at T = 600 (30 over → `capacity`); the lead's cross-check: adding 62 + 1 gives 15,773 (L20's table total 15,778
   minus the 5 bytes the table notes) and 16,477 (= 16,384 + 93, the spec's figure). If your hand totals differ,
   report both and the reason; do not fit the expectation to the code.
7. **Remove the dead B1 switch** `b1Unavailable` and its branch in `decision-read-model.ts` (~505); the card's
   answerable property is set directly.

## 3. Checks

`--maxWorkers=2`: every `tests/**/K3-*.test.ts`, `tests/**/K-*.test.ts`, `tests/**/S5*.test.ts`,
`tests/**/S4C2-*.test.ts`, `tests/business/`, `tests/scenarios/WP1-*`, `tests/scenarios/A8-host-restart*.test.ts`,
`tests/state/`, `tests/composition/`, `tests/app/S4C*.test.ts`, `tests/architecture/`, `tests/**/*brief*.test.ts`,
`tests/runtime/`, the changed files; `npm run typecheck`, `npm run check:architecture`, `npm run build`. Failures
listed in `DSH-BASELINE.md` are expected (no bwrap). No real model calls, no git writes, never ports 3080/3099/44797;
probes under `./.dsh-scratch/`, deleted.

## 4. Reply

Under 600 words: files changed (production net per item; tests), each item RED → GREEN or how it was checked, the K3-35
hand totals with their derivation, the replaced tests, checks with numbers, UNSPECIFIED.
