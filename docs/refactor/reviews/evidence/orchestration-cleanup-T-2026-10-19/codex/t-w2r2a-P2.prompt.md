# T wave 2 rework 2 audit, part P2 (W2b-20)

Your part is `P2`: `./.lead-ref/parts/P2.diff` and `./.lead-ref/parts/P2-files.txt` (3 files, the change
`w2r1` → `w2r1b`): row **W2b-20** of `t-w2b-findings.md` (§2, with ruling R-22 in §0 and its §6 result), done after
your rework-1 audit, so you have not seen it. Base `./.lead-ref/base-P2/`; the test file before wave 2 is
`./.lead-ref/base-P2/w2-base-unknown-call-review-list.test.ts`. `tests/work-graph/unknown-call-review-list.test.ts`
changed again in rework 2 (W2c-14, part P1): judge P2 on `P2.diff`; the tree holds both changes.

The Claude audit of this change is in `./.lead-ref/checks/w2r1-claude-audit.md` (its first two blocks: three 建议,
one refuted). Do not repeat them; report what they missed.

**Look hardest at:**

- (a) the second Goal's records: really through the public chain (S5 adopt, claim with `goalRef`, real Session), and
  the Goal filter and cross-Goal assertions of `w2-base` back, on both backends;
- (b) the boundary cursor taken from a real wider page and passed on as returned;
- (c) the store-page test: R-22's timeout and measured times; the assertions kept;
- the shared helpers `tests/helpers/K3-35-runtime.ts` and `tests/helpers/B2-crr-world.ts` (R-15): default paths
  unchanged; name every importer whose behaviour could change;
- the hand ordering argument in the comments (refKey key order, byte order, runId order) against the code.

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
