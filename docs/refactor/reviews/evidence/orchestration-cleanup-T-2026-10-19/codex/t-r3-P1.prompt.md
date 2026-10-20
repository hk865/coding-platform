# T wave 1 rework 3 audit, with patches (decisions 80 and 81)

**Read only:** do not modify, create or delete any file; no tests, no builds, no git writes, no network. Answer in
plain Chinese, with `file:line` for every fact.

This copy is T round wave 1 after **DSH rework 3**, the last DSH rework (decision 81). You audited rework 2 (your
answers: `./.lead-ref/audit/t-r2-Q1.out.md`, `t-r2-Q2.out.md`); the lead froze them into `./.lead-ref/t-w1r2-findings.md`
(rows W3-01 to W3-12, rulings R-10 to R-12; R-1 to R-9 by reference in `t-w1-findings.md` and `t-w1r1-findings.md`).
DSH applied it in one commit `T W1 rework 3`. You audit that change: tag `w1r2` (`1c31c27`) to this HEAD (`254617d`),
5 test files.

**From now on there is no DSH rework.** For every finding, you also write the fix as a patch, and the lead applies it
in WSL and runs the checks. So each patch must be complete and correct on its own.

Inputs in `./.lead-ref/`:

- `groups/P1.diff`, `groups/P1-files.txt`; `base/` holds the `w1r2` version of each changed file.
- The tables above; the run file `books/t-run-W1R3.md`; rule sheets `books/test-rule-sheet-v2.md`, `-v1.md`; items
  `books/t-items-TQ.md`.
- DSH's reply `replies/t-reply-W1R3.md` (claims, not evidence) and ledger `replies/ledger-W1R3.txt`.
- **A failing test:** `checks/r3-in05.txt`. With bubblewrap, `tests/work-graph/S3-context-inputs.test.ts` IN05 fails
  on both backends: `real Task preparation failed ... lookup index session-anomaly-by-task is not registered`. DSH's
  environment has no bwrap and never ran IN05 or IN11. IN11 passes.

## Check

1. Every hunk does what its W3 row says, no more, no less; every ledger line maps to a row that authorizes it.
2. Kept assertions unchanged except where a row spells it out; nothing weakened.
3. Conversions: rule sheet v2 and R-7, R-8, R-11. No handwritten state, no Host or owner judgement made by the test,
   no platform-issued value rebuilt or chosen by the test, no expected value computed by a production function at run
   time. Recompute every new literal (W3-04, W3-06, W3-07) from `src/`.
4. A2 uses (W3-08's moved Kernel database; W3-09's failure injection): a dependency failing at a named point, put
   back afterwards, writing no fact.
5. **IN05:** find the cause (`file:line`). Is it the test fixture's backend missing a lookup-index registration that
   the real path needs after a requeue (as other fixtures register it), or a production gap? Give the fix.
6. Rows called done that are not.

## Answer

1. **Findings table:** 编号 (`P1-01` …) | 类别 (会出错 / 违规 / 不整洁 / 建议) | 位置 (`file:line`) | 行 (W3-xx) | 问题 |
   改法. Count the IN05 failure as 会出错.
2. **Per row:** `W3-01: OK` or `W3-01: P1-nn`.
3. **Patches:** one fenced ` ```diff ` block per finding, a unified diff against this tree (`a/` and `b/` paths from
   the repository root, enough context for `git apply`). Tests only: no change under `src/`, `vendor/`, `docs/` or to
   `package.json`. If a finding needs a production change, say so instead of patching, and why.
   - Say which test files the lead must run after applying each patch, and whether they need bubblewrap.
4. **The findings as JSON** in one fenced ` ```json ` block: `[{"id", "class", "file", "line", "row", "problem", "fix"}]`.
5. **One last line:** `会出错 n，违规 n，不整洁 n，建议 n`.
