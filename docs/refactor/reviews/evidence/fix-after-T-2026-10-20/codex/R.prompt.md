# Fix round after T: audit of reworks 1 and 2

**Read only:** do not modify, create or delete any file; no tests, no builds, no git writes, no network. Answer in
plain Chinese, with `file:line` for every fact.

This tree is the fix round after T (HANDOFF decision 86) after its two reworks. You audited the five groups
(`tf-base..d4140be`) an hour ago in eight parts; your answers are in `./.lead-ref/audit/P1.out.md` … `P8.out.md`. The
lead checked them and froze `./.lead-ref/tf-findings.md`: rulings R-TF-1 … R-TF-5 in §0, rows `TFR-01` … `TFR-12` in
§1, the findings not adopted in §3. DSH applied the rows in rework 1 (`8317081`); three came back BLOCKED. The lead
ruled on them in `./.lead-ref/books/tf-r2-book.md` §1 (TFR-08 and TFR-10 stay as they are; TFR-04 redone with a
legal `healthConclusion` added to two test mutations), and DSH did that in rework 2 (HEAD). This is the last audit
before the merge: report everything you can prove, and nothing you cannot.

Inputs in `./.lead-ref/`:

- `tf-findings.md` (the table; binding), `books/tf-book.md` (the round's book; §3 and §7 bind),
  `books/tf-r1-book.md`, `books/tf-r2-book.md`, `books/test-rule-sheet-v2.md` (binding for tests).
- `parts/R.diff` and `parts/R-files.txt`: the change `d4140be` → HEAD (both reworks). The `d4140be` version of every
  changed file is under `base/` at the same path.
- DSH's replies (claims, not evidence): `replies/tf-r1-reply.md`, `replies/tf-r2-reply.md`; the ledgers
  `replies/ledger-r1.txt`, `replies/ledger-r2.txt` (every REMOVED or LOOSENED test line).
- The lead ran the bubblewrap full suite on `d4140be` (755/755 files) and runs it again on HEAD; you do not need
  test results.

## For every row and every hunk

1. **Each row done as written**, no more, no less: `TFR-01`, `-02`, `-03`, `-04` (as redone in rework 2), `-05`,
   `-06`, `-07`, `-09`, `-11`, `-12`. A row done another way than written is 违规; a behaviour a public flow can reach
   that now changes is 会出错 (name the flow and the input).
2. **The BLOCKED rows:** TFR-08 and TFR-10 must have no code left in HEAD (TFR-10's two K3 helpers back to tf-base,
   `git`-equal to `base/` where the table says so). Check DSH's evidence for both against the code.
3. **Every hunk belongs to a row.**
4. **TFR-05's converted test** (`tests/work-graph/A2-step1-codecs.test.ts`): only rule sheet v2 forms; the public
   steps really produce the root round, the interrupted check (with its cause) and the successor; the replaced
   assertions (ledger) are at least as strong; the new refusal cases are right against the codec.
5. **TFR-04 as redone:** the codec refuses `unavailable` without a recognized conclusion and keeps `available` with
   `null`; no current writer of an `unavailable` Session omits the conclusion (list them); the two test mutations got
   only a legal conclusion; the contract member `retired_unrecorded` stays.
6. **TFR-11** (`scripts/verify-isolated.mjs`): the smoke still checks the three things, uses the real placeholder,
   removes its temporary directory on every path, and the page path the Host serves matches `publicDir`.
7. **No green by weakening**; comments the changes left untrue are 不整洁.

## Answer

1. **Findings table:** 编号 (`R-01` …) | 类别 | 位置 (`file:line`) | 行 (`TFR-nn`) | 问题 | 唯一改法. Classes:
   **会出错**, **违规**, **不整洁**, **建议** (as before).
2. **Per row:** one line per row: `TFR-nn: OK` or `TFR-nn: R-nn, …` (TFR-08 and TFR-10: whether the BLOCKED evidence
   holds).
3. **The same findings as JSON**, in one fenced ` ```json ` block: `[{"id", "class", "file", "line", "row",
   "problem", "fix"}]`.
4. **One last line:** `会出错 n，违规 n，不整洁 n，建议 n`.
