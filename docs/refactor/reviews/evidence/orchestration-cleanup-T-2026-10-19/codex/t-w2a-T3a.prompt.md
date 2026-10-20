# T wave 2 audit, part T3a

Your part is `T3a`: `./.lead-ref/parts/T3a.diff` and `./.lead-ref/parts/T3a-files.txt`.

## What you are auditing

**Read only:** do not modify, create or delete any file; no tests, no builds, no git writes, no network. Answer in
plain Chinese, with `file:line` for every fact.

This copy is the merged result of T round **wave 2** (HANDOFF decision 79-4): groups T1, T2 and T3, built by DSH in
three parallel copies from the books you refreshed this morning, then merged by the lead (one conflict, a re-export
line in `tests/helpers/K3-35-continuation-fixture.ts`, resolved to the T1+T2 side). It is a full audit under decision
80-2. Your findings become the frozen finding table, and DSH reworks from it at most three times (decision 81). So
report everything you can prove, and nothing you cannot.

The tree is the merged HEAD. Inputs in `./.lead-ref/`:

- **Your part:** `parts/<P>.diff` (the change against `w2-base` = `d4c4cea` for your files) and `parts/<P>-files.txt`.
  `base/` holds the `w2-base` version of every changed or deleted file, at the same relative path. Each part is half
  of one group's change (`T1a`, `T1b` are group T1, and so on).
- **The books:** `books/t-book.md` (the wave-2 rules: precedence 刷新 > 书面核对改正 > 动作; v2 summary; BLOCKED
  categories; shared real Runtime exception), `books/t-run-T?.md`, `books/t-items-T?.md` (items keep their original id
  even when moved to another group: T3-0xx may be in group T2), `books/t-files-T?.txt` (whitelists),
  `books/test-rule-sheet-v2.md` (binding) and `-v1.md`, your book checks `books/t-bk-T?.out.md`.
  `t-w2-dropped.md` lists the eight items your refresh found done or gone.
- **DSH's replies** (claims, not evidence): `replies/t-reply-T?.md`; the ledgers `replies/ledger-T?.txt` (every
  REMOVED or LOOSENED assertion and deleted test, mapped to items in each reply's §4).
- **Tests:** the lead runs the bubblewrap full suite separately. Tests that failed in DSH's sandbox only for lack of
  bwrap are listed in the replies (§4). Group T2 ran no test matrix before its first segment ended.

To find the items behind a file, search the items files and ledgers for its path (`rg -n "<path>"`).

## Check every hunk in your diff

1. **It belongs to an item** and does what the item says, with the later correction line winning: no more, no less.
   A hunk no item asks for is a finding. The import exception (book rule 1) and additions to
   `tests/helpers/S2B-runtime-steps-fixture.ts` (new optional options or functions, default path unchanged) are
   allowed when the reply lists them.
2. **Deletions.** The item's cover still exists in the merged tree and asserts the same behaviour with the same
   strength. A deletion whose cover is gone or weaker is 会出错. A deletion no item names is 违规.
3. **Kept assertions** stay exactly as they were, except the exact changes an item spells out. A weakened, loosened or
   re-pointed assertion, a raised timeout, or an expected value changed without an item is 违规. A test that now
   passes without exercising its claim (its setup no longer reaches the state it names, or an earlier refusal hides
   the one it names) is 会出错.
4. **Conversions** (book rule 4, rule sheet v2). The handwritten state is really replaced by public steps; every
   helper is an allowed form (A7 has three named helpers with bounds); no forbidden form remains (F1–F12);
   platform-issued values come from a public read as returned; expected values are literals from the spec or a hand
   calculation with the working in a comment, never the program's own output or a production function.
5. **Partial and BLOCKED parts** touching your files. The part must be left as it was, with no workaround. For each,
   say whether DSH's stated reason and category are true (`file:line`), and whether a public step reaches the state
   after all (name it). The lead uses this to rule; it is not a finding unless DSH worked around the block or the
   reason is false.
6. **Items called done that are not done** against the item and its correction lines.

## Answer

1. **Findings table:** 编号 (`<P>-01` …) | 类别 | 位置 (`file:line`) | 条目 | 问题 | 唯一改法.
   Classes: **会出错** (a behaviour left untested, or a test that passes without exercising its claim; give the
   concrete input and why it would still pass), **违规** (against the book or the rule sheet), **不整洁** (stale
   comment, dead code or import), **建议** (optional).
2. **Per item:** one line per item touching your files: `T1-xxx: OK` or `T1-xxx: <P>-nn, <P>-mm`.
3. **Partial and BLOCKED parts:** item | part | DSH's reason true? (`file:line`) | reachable by a public step? (name
   it, or "不可达" with the reason).
4. **The same findings as JSON**, in one fenced ` ```json ` block:
   `[{"id", "class", "file", "line", "item", "problem", "fix"}]`.
5. **One last line:** `会出错 n，违规 n，不整洁 n，建议 n`.
