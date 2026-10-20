## What you are auditing

**Read only:** do not modify, create or delete any file; no tests, no builds, no git writes, no network. Answer in
plain Chinese, with `file:line` for every fact.

This copy is the merged result of T round wave 1 (HANDOFF decision 79-4): groups TP (173 items) and TQ (115 items),
built by DSH from books you checked earlier. It is a full audit under decision 80-2. Your findings become the frozen
finding table, and DSH reworks from it at most three times (decision 81). So report everything you can prove, and
nothing you cannot.

The tree is the merged copy's HEAD. Inputs in `./.lead-ref/`:

- **Your group:** `groups/<G>.diff` (the change against `t-base` for your files) and `groups/<G>-files.txt`.
  `base/` holds the `t-base` version of every changed or deleted file, at the same relative path.
- **The books:** `books/t-book.md` (the rules), `books/t-run-TP.md`, `books/t-run-TQ.md`, `books/t-run-TQ2.md`,
  `books/t-items-TP.md`, `books/t-items-TQ.md` (each item's 动作, 覆盖/依据 and 书面核对改正 lines),
  `books/t-files-*.txt` (the whitelists), `books/test-rule-sheet-v1.md`, and your own book checks
  (`books/t-bk-*.out.md`, `books/t-bk2-W1.out.md`).
- **DSH's replies** (claims, not evidence): `replies/t-reply-TP.md`, `replies/t-reply-TQ.md`, `replies/t-plan-TP.md`,
  `replies/t-reply-TP-ctx.md`. The ledgers `replies/ledger-TP.txt` and `replies/ledger-TQ.txt` list every REMOVED or
  LOOSENED assertion and every deleted test; DSH mapped each to an item.
- **The lead's merge:** `t-audit-merge-notes.md`, `lead-fix-r4b.diff`.
- **Tests:** the lead runs the bubblewrap full suite separately. Tests that failed in DSH's sandbox are listed in the
  replies (§4); most failed only because the sandbox has no bwrap.

To find the items behind a file, search the items files and ledgers for its path (`rg -n "<path>"`).

## Check every hunk in your diff

1. **It belongs to an item.** It does what that item's 动作 says, with the 书面核对改正 line winning where they differ:
   no more, no less. A hunk no item asks for is a finding. Book rule 1's one exception (removing a deleted symbol's
   import, only as far as compiling needs) is allowed when the reply lists the file.
2. **Deletions** (tests, cases, assertions, helpers, fixtures). Check the item's 覆盖 claim against the merged tree:
   - the named covering test still exists;
   - it still asserts that behaviour.

   A deletion whose cover is gone or does not assert the behaviour is 会出错 (a behaviour is left untested). A
   deletion of a current behaviour the item did not name is 违规.
3. **Kept assertions** (book rule 2). They stay exactly as they were, except:
   - the index moves of TP-063 and TP-166;
   - the exact changes an item spells out.

   A weakened, loosened or re-pointed assertion is 违规. A test that now passes without exercising its claim (for
   example, its setup no longer reaches the state it names) is 会出错.
4. **Conversions** (book rule 4, `test-rule-sheet-v1.md`). Check:
   - the handwritten state is really replaced by the public step the item names;
   - every helper used is an allowed form (A1–A7; A7 is empty in this round);
   - no forbidden form remains (F1–F12);
   - expected values come from the spec or a hand calculation, not from a source constant or the program's own
     output.
5. **Production** (book rule 5). Behaviour on current-format data does not change: the same error codes, texts, check
   order, field presence and stored bytes. Only old-format tolerance, legacy branches and unused declarations go.
   - Where a decoder or reader now **requires** a field or row that it used to tolerate missing, find every current
     writer of that record (`rg`). Show that each one always writes it, in the same commit where that matters.
   - A current writer that can omit it is 会出错: current data would now be rejected or read as `unavailable`. Give
     the writer's `file:line` and the input.
   - A deleted declaration must have no production caller left.
6. **Allowlist** (book rule 6). An entry goes only with its declaration. A reason or note changes only where an item
   says so. Nothing is added.
7. **BLOCKED and partial items** touching your files.
   - The part the book or DSH marked BLOCKED must be left as it was, with no workaround.
   - For each such part, also say:
     - whether DSH's stated reason is true (`file:line`);
     - whether a public step reaches the state after all (name it), or the state is really unreachable today.

     The lead uses this to rule on them; it is not a finding unless DSH worked around the block.

## Answer

1. **Findings table:** 编号 (`<G>-01` …) | 类别 | 位置 (`file:line`) | 条目 | 问题 | 唯一改法.
   The classes:
   - **会出错:** behaviour on current data changes, a behaviour is left untested, or a test passes without exercising
     its claim. Give the concrete input and the old and new result.
   - **违规:** against the book or the rule sheet.
   - **不整洁:** works, but leaves something stale, for example a comment or allowlist note naming a deleted symbol,
     or a dead import.
   - **建议:** optional.
2. **Per item:** one line per item that touches your files: `TP-xxx: OK` or `TP-xxx: <G>-nn, <G>-mm`.
3. **BLOCKED and partial parts:** item | part | DSH's reason true? (`file:line`) | reachable by a public step? (name it,
   or "不可达" with the reason).
4. **The same findings as JSON**, in one fenced ` ```json ` block:
   `[{"id", "class", "file", "line", "item", "problem", "fix"}]`.
5. **One last line:** `会出错 n，违规 n，不整洁 n，建议 n`.
