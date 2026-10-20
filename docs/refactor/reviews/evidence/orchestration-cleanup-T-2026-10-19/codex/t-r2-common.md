## What you are auditing

**Read only:** do not modify, create or delete any file; no tests, no builds, no git writes, no network. Answer in
plain Chinese, with `file:line` for every fact.

This copy is T round wave 1 after **DSH rework 2** (HANDOFF decision 79-4, decisions 80 and 81). You audited rework 1
and the parts still BLOCKED (your answers: `./.lead-ref/audit/t-r1-R1.out.md`, `t-r1-R2.out.md`, `t-r1-B14.out.md`).
The lead froze them into a new table, and DSH reworked from it in one commit `T W1 rework 2`. You now audit only that
rework: the change from tag `w1r1` (`ed26c44`) to this HEAD (`1c31c27`). It changed tests only. One DSH rework is
left after this one; after that, fixes come from your read-only patches. So report everything you can prove, and
nothing you cannot.

Inputs in `./.lead-ref/`:

- **Your group:** `groups/<G>.diff` and `groups/<G>-files.txt`. `base/` holds the `w1r1` version of every changed
  file, at the same relative path.
- **What binds the rework:** `t-w1r1-findings.md` (§0 rulings R-1 to R-9; rows W2-01 to W2-25; §5 stays BLOCKED).
  R-1 to R-6 and the original W1/B rows are in `t-w1-findings.md` (`rg -n "^\| W1-25 "`). Rule sheets
  `books/test-rule-sheet-v2.md` and `books/test-rule-sheet-v1.md`. The run file `books/t-run-W1R2.md` (scope; the
  shared-helper rule 4; no weakening). Items `books/t-items-TP.md`, `books/t-items-TQ.md` where a row cites them.
- **DSH's reply** (claims, not evidence): `replies/t-reply-W1R2.md`. The ledger `replies/ledger-W1R2.txt` lists every
  REMOVED or LOOSENED assertion and every removed test; reply §7 maps each to a row.
- **Tests:** the lead runs the bubblewrap full suite separately; the suite on `w1r1` was all green.

## Check every hunk in your diff

1. **It belongs to a row** and does what that row's 改法 says (with §0): no more, no less. A hunk no row asks for is a
   finding, unless the reply lists it (§6) and it is only what the row needs.
2. **Rows claimed done:** the fix is complete. A row called done whose fix is missing, partial or different is a
   finding (类别 by its effect).
3. **Deletions:** every ledger line in your files maps to a row that authorizes it. Check each R-3 or R-4 claim
   (`file:line` of the refusing check, or why no public step makes the state). A deletion no row names, or whose
   cover is gone, is 会出错. In group Q2, say whether the reply's claim that the LOOSENED line at
   `tests/runtime/R4c-graph-history.test.ts:917` is a ledger mis-pairing is true.
4. **Kept assertions** stay exactly as they were, except what a row spells out. A weakened, loosened or re-pointed
   assertion is 违规. A test that now passes without reaching the state it names is 会出错.
5. **Conversions** (rule sheet v2, R-7, R-8):
   - the handwritten state is really gone and the named public steps make it;
   - every helper is an allowed form (A1 to A7; A7 has only the three helpers v2 names);
   - **A2 uses:** each injected failure is a dependency failing at a named point, fails only where the row says, and
     writes or changes no fact (for example the Kernel store wrappers for W2-10 and W2-20);
   - no forbidden form remains (F1 to F12), including platform-issued values (Kernel identity, positions, cursors,
     message, Session and round ids) that the test chose, rebuilt or copied from program output (R-8, v2 A1);
   - **hand-derived literals** (the Session ids for W2-24, the message id for W2-18, the revisions for W2-19 and
     W2-21, `COUNTED_RUNS`): recompute them from the algorithm in `src/` and say whether each is right and whether
     its working is written down.
6. **Shared helpers** (`tests/helpers/S2B-runtime-steps-fixture.ts`, `S5-decision-fixture.ts`,
   `S2B-activity-fixture.ts`): each new option is optional, and the default path is unchanged for every other
   importer. For `S5-decision-fixture.ts`, check that the public seed chain gives the same revisions as before for
   every importer that asserts one, and that its separate id counter (`publicSeedSeq`) is not a way around a check.
7. **BLOCKED and partial parts** (reply §2, and table §5):
   - left in its `w1r1` form, with no workaround;
   - DSH's reason true or not (`file:line`);
   - reachable by a public step after all (name it, with `file:line`, including an A2 failure at a named point), or
     really unreachable today.

## Answer

1. **Findings table:** 编号 (`<G>-01` …) | 类别 | 位置 (`file:line`) | 行 (W2-xx) | 问题 | 唯一改法.
   - **会出错:** a behaviour is left untested, or a test passes without exercising its claim. Give the concrete input
     and the old and new result.
   - **违规:** against the finding tables, the run file or the rule sheet.
   - **不整洁:** works, but leaves something stale (a comment, a dead import or helper).
   - **建议:** optional.
2. **Per row:** one line per row that touches your files: `W2-07: OK` or `W2-07: <G>-nn`.
3. **BLOCKED and partial parts:** row | part | DSH's reason true? (`file:line`) | reachable by a public step? (name
   it, or "不可达" with the reason).
4. **The same findings as JSON**, in one fenced ` ```json ` block:
   `[{"id", "class", "file", "line", "row", "problem", "fix"}]`.
5. **One last line:** `会出错 n，违规 n，不整洁 n，建议 n`.
