# T wave 2 rework 2 audit, part P1

Your part is `P1`: `./.lead-ref/parts/P1.diff` and `./.lead-ref/parts/P1-files.txt` (41 files, the change
`w2r1b` → `w2r2`); base `./.lead-ref/base/`. Your rows: all of `t-w2r2-findings.md` §1 (W2c-01 to W2c-14).

**Look hardest at:**

- W2c-01 (`tests/work-graph/S4C2-goal-triggers.test.ts`): is the graph read the agent uses really taken after the
  archive requeue, so the `rework.entries` item is the archive's own record, and does a wrong archive `at` now fail?
  Were only the deleted case's own imports removed?
- W2c-03 (`tests/runtime/R4c-execution-history.test.ts`): the new `noLowerRequest` option of the refusal frame: does
  it observe every lower call of the refused read (and nothing from the setup), and does each of the four rows now
  fail without the reader's own check (`src/core/agent-runtime/observation-recovery.ts:260`, `:269`)?
- W2c-04: the canonical text and the 183 bytes in the comment against `catalog-record-codecs.ts:193-202` and the
  key order of `canonicalJson` (`src/contracts/fingerprint.ts`).
- W2c-05: the two public reads before the reopened platform closes: do they assert the same facts the removed
  database reads did?
- W2c-14: with `later` now `pending_review`, does the wider page still return `pending` and `decided` and a cursor after
  `decided`, so the bounded query shows the cursor is a keyset bound?
- W2c-07: 53 removals in 27 scenario files; anything else changed there?

## What you are auditing

**Read only:** do not modify, create or delete any file; no tests, no builds, no git writes, no network. Answer in
plain Chinese, with `file:line` for every fact.

This tree is T round wave 2 after **rework 2** (HANDOFF decision 79-4; decisions 80, 81). You audited rework 1
(`w2r1` = `722ddf3`) this afternoon in three parts (your answers: `./.lead-ref/checks/t-w2r1a-P1..P3.out.md`); a
Claude audit with adversarial verifiers covered the same tree plus W2b-20 (`./.lead-ref/checks/w2r1-claude-audit.md`).
The lead checked both and froze them into the rework-2 table `./.lead-ref/t-w2r2-findings.md`: 14 rows `W2c-01` …
`W2c-14`, rulings R-23, R-24 and the A7 note in §0 (R-1 … R-22 still apply), lead text fixes in §2, findings not
adopted in §3, the result in §4. By the user's decision, four Claude subagents applied the table, one row all or
nothing, each in its own clone; the lead reviewed every diff, merged and committed. The tree is tag `w2r2`
(`c05c7d7`). This is rework 2 of at most 3: your findings become the table for rework 3, the last one. Report
everything you can prove, and nothing you cannot.

Inputs in `./.lead-ref/`:

- **The tables.** `t-w2r2-findings.md` (this rework). `t-w2b-findings.md` (rework 1: §0 rulings R-13 … R-22, its rows
  `W2b-xx` that the `W2c` rows refer to, §6 its results with the lead's rework-2 corrections). R-1 to R-12 are in
  `t-w1-findings.md` §0, `t-w1r1-findings.md` §0, `t-w1r2-findings.md` §0: read only those §0 sections.
- **Your part:** `parts/<P>.diff` and `parts/<P>-files.txt`. P1's base is `base/` (tag `w2r1b` = `03b9cfd`); P2's base
  is `base-P2/` (tag `w2r1` = `722ddf3`). Each holds the earlier version of every changed file at the same relative
  path.
- **Books:** `books/t-book.md`, `books/t-items-T?.md` (the items behind the rows' 条目 column; read only the items a
  row names: `rg -n -A14 "^### T1-070 " .lead-ref/books/t-items-*.md`), `books/test-rule-sheet-v2.md` (binding) and
  `-v1.md`.
- **The agents' reports** (claims, not evidence): `replies/t-reply-W2R2-agents.md` (rework 2 only).
- **The ledger** `checks/ledger-W2R2.txt`: every REMOVED or LOOSENED assertion line between `w2r1b` and `w2r2`; the
  lead maps them to rows in §4 of `t-w2r2-findings.md`.
- **Tests:** the lead runs the bubblewrap full suite separately; you do not need test results.

## For every row of your part, and every hunk of your diff

1. **The row is done as written** (with the rulings), no more, no less. A row the result section calls done that is not
   done, or done another way than the row says, is a finding. Where the result records a deviation with a reason,
   check the reason against the code.
2. **Every hunk belongs to a row.** A hunk no row asks for is a finding, except the allowed forms: an import or a
   removed unused import that a row's change needs; a new optional option or function in a shared helper whose
   default path is unchanged (R-15).
3. **Deletions and replaced assertions** (the ledger lines in your files): the replacement asserts the same behaviour
   at least as strongly, or the row names the deletion. A weaker replacement is 会出错; an unnamed deletion is 违规.
4. **No green by weakening:** no `skip`/`only`/`todo`, no raised timeout except W2b-08's (R-14) and W2b-20's
   store-page test (R-22, at most `600_000` with the measured times), no loosened matcher (`toMatchObject` where
   `toEqual` was, `expect.any`, `stringContaining` that replaces an exact value) unless the row says so.
5. **Conversions** (rule sheet v2): handwritten state really replaced by public steps; every helper an allowed form;
   no forbidden form (F1–F12); issued values from a public read as returned; expected values literals from the spec
   or a hand calculation with the working in a comment, never the program's output or a production function (R-23
   for digests). Check each hand count (byte counts, digests, orderings) against the code: a wrong working is 会出错.
6. **Shared helpers** changed in your part (R-15): the default path and every id, position and time it issued stay
   the same. Name each importer whose behaviour could change.
7. **R-20 parts that remain** (W2b-17, W2b-53, W2b-54, and W2b-55's pointer revision and `readThrough`): only check the
   ones your diff touches: the category is true (`file:line`) and no public step reaches the state after all.
8. **Do not re-raise** a finding the tables already decided (rework 1 §5, rework 2 §3) unless the code now shows it
   was decided on a false fact; then say which fact.

## Answer

1. **Findings table:** 编号 (`<P>-01` …) | 类别 | 位置 (`file:line`) | 行 (`W2c-xx` or `W2b-20`) | 问题 | 唯一改法.
   Classes: **会出错** (a behaviour left untested, or a test that passes without exercising its claim; give the
   concrete input and why it would still pass), **违规** (against the table, the book or the rule sheet), **不整洁**
   (stale comment, dead code or import), **建议** (optional).
2. **Per row:** one line per row of your part: `W2c-xx: OK` or `W2c-xx: <P>-nn, <P>-mm`.
3. **The same findings as JSON**, in one fenced ` ```json ` block:
   `[{"id", "class", "file", "line", "row", "problem", "fix"}]`.
4. **One last line:** `会出错 n，违规 n，不整洁 n，建议 n`.
