# PC-1b audit 3: rework 2 (read-only; lead, 2026-10-22 night)

**Read only:** do not modify, create or delete any file; no tests, no builds, no git writes, no network. You may run
commands that only read (search, `diff` of two files, hashing a file). Answer in plain Chinese, with `file:line` for
every fact.

This tree is **PC-1b after rework 2** (HEAD `68dfb10`; `.lead-ref/commits.txt`). You audited rework 1 (audit 2, your
reports in `.lead-ref/audit2/`: P, S, R, J and the S-01 question X); the lead froze the findings in
`.lead-ref/books/pc1b-r2-findings.md` and DSH did rework 2 from it, by `books/run-pc1b-r2.md` and the whitelist
`books/pc1b-r2-whitelist.txt`. This is **audit 3** (decision 80). It is the last audit before the lead merges PC-1;
rework 3 is the last rework allowed. Report everything you can prove, and nothing you cannot.

Inputs in `./.lead-ref/`:

- **The frozen table** `books/pc1b-r2-findings.md`: binding, including rule T, "Scope added" and "Book corrections".
  Rows **rejected** or **accepted as built** stay as they were. `books/pc1b-findings.md` (rework 1's table) and the
  book `books/pc1-book.md` only where a row cites them.
- **Rework 2's change:** `parts/A.diff` (`1b5183a` → `68dfb10`) and `parts/A-files.txt`; the `1b5183a` version of each
  changed file under `base/`. The whole result tree is the current directory.
- **DSH's reply** (claims, not evidence): `replies/pc1b-r2-reply.md`; §2 each row's mutation, RED and GREEN; §3 rule T;
  §8 implementation notes (S2-06's seam, S2-05's literals).
- **The lead's checks:** `checks/pc1b-r1-x-probe.{sh,log}` (X-01's patch applied by the lead to `1b5183a`: 56 files that
  reach the two roots, 192 tests, all pass with bubblewrap); the lead's full suite on `68dfb10` if present
  (`checks/full-pc1b-r2.txt`). DSH has no bubblewrap; its 18 red X tests are environment failures (reply §6).

## What to check

1. **Each fix row and rule T**, one by one: done exactly as the row says? Cite the row and the code or test line. X-01
   against the lead's probe edits (`checks/pc1b-r1-x-probe.sh`): same three helpers, same identity input, the option's
   comment says why.
2. **The test bar:** expected values literal or hand-computed (the two public identifiers of J2-01 excepted); no
   `preparedTexts()`, manifest or captured request as an expectation; no fact read from the database or a private
   module. **Check each mutation claim by reading:** would the changed case fail under the named mutation? Name a
   mutation of the same rule it would still miss, if any.
3. **S2-06's seam** (reply §8): the test swaps `resolveQueryConfiguration` on the pinned binding through the fixture's
   `createHostRuntimeResolverRegistry`. Is that the original binding the Query execution would re-read, so the test
   really shows "after entry only observes"? Is any private module touched?
4. **J2-01:** the digest and round id taken from the public `readContinuationBrief` and `openVerification`; everything
   else in `EXPECTED_INPUT_2` hand-written; compared whole.
5. **Rule T:** in `tests/runtime/PC-*`, `tests/work-graph/PC-*`, `tests/contracts/PC-*` no explicit per-test limit other
   than `60_000`, and the four cases of T(1) have none; no other test's limit changed (search the diff).
6. **Scope and leftovers:** every hunk asked for by a row; no file outside the whitelist; the frozen fixtures unchanged;
   production changes only J2-04's deletions and R2-02's comment; no test-only path in production; no construction
   history in production comments.
7. **Anything rework 2 broke** that a row did not ask for: **会出错** with the input and both outputs.

## Answer

1. **Findings table:** 编号 (`A3-01` …) | 类别 | 位置 (`file:line`) | 依据 | 问题 | 唯一改法. Classes **会出错**, **违规**,
   **不整洁**, **建议**. If nothing is wrong, say so and leave the table empty.
2. **Per row:** one line each for every row of the table (fix, rejected, accepted) and rule T: `OK` / finding ids /
   `rejected, untouched`.
3. **DSH's §8 notes:** one line each, `成立` / `不成立` and why.
4. The findings as JSON in one fenced ` ```json ` block (`[]` if none).
5. **One last line:** `会出错 n，违规 n，不整洁 n，建议 n`.
