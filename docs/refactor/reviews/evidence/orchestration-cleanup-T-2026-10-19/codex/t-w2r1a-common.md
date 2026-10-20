## What you are auditing

**Read only:** do not modify, create or delete any file; no tests, no builds, no git writes, no network. Answer in
plain Chinese, with `file:line` for every fact.

This tree is T round wave 2 after **rework 1** (HANDOFF decision 79-4; decision 80, 81). This morning you audited the
merged wave 2 (`w2-merged` = `4807e64`) in six parts; the lead checked your findings and the other sources and froze
them into one table, `./.lead-ref/t-w2b-findings.md` (57 rows `W2b-01` … `W2b-57`, rulings R-1 … R-22 in §0, rejected
findings in §5). Then, by the user's decision, Claude subagents applied the table (instead of DSH), one row all or
nothing; the lead reviewed every diff, merged and committed. The tree is tag `w2r1` (`722ddf3`). §6 of the table
holds the lead's result for each row. This is rework 1 of at most 3: your findings become the table for rework 2.
Report everything you can prove, and nothing you cannot.

Inputs in `./.lead-ref/`:

- **The table** `t-w2b-findings.md` (§0 rulings, §1–§4 rows, §5 not adopted, §6 results). R-1 to R-12 are in
  `t-w1-findings.md` §0, `t-w1r1-findings.md` §0, `t-w1r2-findings.md` §0: read only those §0 sections.
- **Your part:** `parts/<P>.diff` (the change `w2-merged` → `w2r1` for your files) and `parts/<P>-files.txt`. `base/`
  holds the `w2-merged` version of every changed or deleted file at the same relative path. The tree before wave 2 is
  not in this copy; where a row says "back to `w2-base`", the base file in `base/` is wave 2's version and the row
  text or the diff says what `w2-base` held.
- **Books:** `books/t-book.md`, `books/t-items-T?.md` (the items behind the rows' 条目 column; read only the items a
  row names: `rg -n -A14 "^### T1-040 " .lead-ref/books/t-items-*.md`), `books/test-rule-sheet-v2.md` (binding) and
  `-v1.md`.
- **The agents' reports** (claims, not evidence): `replies/t-reply-W2R1-agents.md`.
- **The ledger** `checks/ledger-W2R1.txt`: every REMOVED or LOOSENED assertion line and deleted file between
  `w2-merged` and `w2r1`. The lead maps them to rows in §6; check that mapping for your files.
- **Not in this tree:** W2b-20 (open; ruling R-22; done later in a separate change). Do not report it as not done.
- **Tests:** the lead runs the bubblewrap full suite separately; you do not need test results.

## For every row of your part, and every hunk of your diff

1. **The row is done as written** (with §0's rulings), no more, no less. A row §6 calls done that is not done, or done
   another way than the row says, is a finding. Where §6 records a deviation with a reason (R-6 notes, R-20 parts),
   check the reason against the code.
2. **Every hunk belongs to a row.** A hunk no row asks for is a finding, except the allowed forms: an import or a
   removed unused import that a row's change needs; a new optional option or function in a shared helper whose
   default path is unchanged (R-15).
3. **Deletions and replaced assertions** (the ledger lines in your files): the replacement asserts the same behaviour
   at least as strongly, or the row names the deletion. A weaker replacement is 会出错; an unnamed deletion is 违规.
4. **No green by weakening:** no `skip`/`only`/`todo`, no raised timeout except W2b-08's (R-14) and W2b-20's (R-22),
   no loosened matcher (`toMatchObject` where `toEqual` was, `expect.any`, `stringContaining` that replaces an exact
   value) unless the row says so.
5. **Conversions** (rule sheet v2): handwritten state really replaced by public steps; every helper an allowed form;
   no forbidden form (F1–F12); issued values from a public read as returned; expected values literals from the spec
   or a hand calculation with the working in a comment, never the program's output or a production function. Check
   each hand count (revision counts, byte counts, digests) against the code: a wrong working is 会出错.
6. **Shared helpers** changed in your part (R-15): the default path and every id, position and time it issued stay
   the same. Name each importer whose behaviour could change.
7. **R-20 parts** (§6: W2b-09, W2b-17, W2b-53, W2b-54, W2b-55 and others in your files): the part is back in its
   earlier form exactly, the category is true (`file:line`), and no public step reaches the state after all (name it
   if one does).

## Answer

1. **Findings table:** 编号 (`<P>-01` …) | 类别 | 位置 (`file:line`) | 行 (`W2b-xx`) | 问题 | 唯一改法.
   Classes: **会出错** (a behaviour left untested, or a test that passes without exercising its claim; give the
   concrete input and why it would still pass), **违规** (against the table, the book or the rule sheet), **不整洁**
   (stale comment, dead code or import), **建议** (optional).
2. **Per row:** one line per row of your part: `W2b-xx: OK` or `W2b-xx: <P>-nn, <P>-mm`.
3. **R-20 parts:** row | part | category true? (`file:line`) | reachable by a public step? (name it, or "不可达" with the
   reason).
4. **The same findings as JSON**, in one fenced ` ```json ` block:
   `[{"id", "class", "file", "line", "row", "problem", "fix"}]`.
5. **One last line:** `会出错 n，违规 n，不整洁 n，建议 n`.
