
## What you are auditing

**Read only:** do not modify, create or delete any file; no tests, no builds, no git writes, no network. Answer in
plain Chinese, with `file:line` for every fact.

This tree is the scale-test split SC after rework 1 (decision 80). Your first audit (five parts, answers in
`./.lead-ref/audit1/P1.out.md` … `P5.out.md`) was frozen by the lead into `./.lead-ref/books/sc-findings.md`
(rulings R-SC-1 … R-SC-5 in §0; rows P1-01 … P5-05 and the lead's L-01, L-02 in §1). DSH applied it in one commit,
`9a504c0 SC rework 1`, on `sc-r1-base` (`efa2303`); the lead then removed two unused import names from two scale
files, `db76a84` (the verbatim `beforeAll` worlds stay, so `failingBindings` in
`tests/app/S2A-decision-routes.scale.test.ts` is still written and never read: the lead accepts that). HEAD is
`db76a84`. This is the rework audit: at most three reworks in all, so report only what you can prove.

Inputs in `./.lead-ref/`: the table `books/sc-findings.md` (binding), the rework book `books/sc-r1-book.md`, the SC
book `books/sc-book.md` (§3, §4 bind), `books/test-rule-sheet-v2.md`; your part `parts/<R>.diff` and
`parts/<R>-files.txt`, with each changed file's `sc-r1-base` version under `base/`; DSH's rework reply
`replies/sc-r1-reply.md` (claims, not evidence: its §2 gives, per changed small case, each layer's order, page split,
the decisive item's page, and a "first-page" check DSH ran in throw-away copies) and the move check
`replies/move-check-r1.txt`. The lead runs the bubblewrap full suite and the scale batch separately.

## What to check

1. **Each row of your part is done as the table says** (its fix, under §0), all of it and nothing more. A row only
   partly done, or done in a way that breaks a ruling, is 违规; a fix that leaves the row's defect in place is 会出错.
2. **Each changed small case meets R-SC-1:** recompute every layer's order (the store sorts by the UTF-8 bytes of the
   index key) and page split from the fixture and the sizes, and check DSH's §2 and the comment against it. A layer
   that does not cross two pages, a decisive item not on its layer's last page (where the rule applies), or a wrong
   hand calculation in a comment is 会出错.
3. **R-SC-2, R-SC-3, R-SC-4:** no helper or caller fills in a default width; the `.scale.test.ts` files are unchanged
   apart from the lead's two import lines; every fixture's default path does what it did at `sc-base` (compare with
   `base/` and, for helpers SC1 changed, with the SC1 audit P1); expected values are literals.
4. **New defects:** anything this rework introduced (a weakened or dropped assertion, a changed fixture default, a new
   production behaviour, a stale comment).
5. **DSH's §5 points** that concern your part: is DSH right (then say what the table should have said), or is there a
   way within the row that DSH missed?

## Answer

1. **Findings table:** 编号 (`<R>-01` …) | 类别 | 位置 (`file:line`) | 行 (the table's row id, or `新`) | 问题 | 唯一改法.
   Classes: **会出错**, **违规**, **不整洁**, **建议** (optional).
2. **Per row:** one line per row of your part: `<row>: OK` or `<row>: <R>-nn, …`.
3. **The same findings as JSON**, in one fenced ` ```json ` block: `[{"id", "class", "file", "line", "row", "problem",
   "fix"}]`.
4. **One last line:** `会出错 n，违规 n，不整洁 n，建议 n`.
