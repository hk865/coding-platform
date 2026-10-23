# PC-2 audit 3: rework 2 (read-only; lead, 2026-10-23 night)

**Read only:** do not modify, create or delete any file; no tests, no builds, no git writes, no network. You may run
commands that only read (search, `diff` of two files, hashing a file). Answer in plain Chinese, with `file:line` for
every fact.

This tree is **PC-2 after rework 2** (HEAD `9e984e1`; `.lead-ref/commits.txt`). You audited rework 1 (audit 2, your
reports in `.lead-ref/audit2/`, with your four fixture patches `audit2/FX.out.md`); the lead froze the findings in
`.lead-ref/books/pc2-r2-findings.md`, applied your four fixture patches as commit `197b4ad` (the lead's check:
`checks/pc2-fx-apply.{sh,log}`, typecheck and the fixtures' existing callers green), and DSH did rework 2 from the
table, by `books/run-pc2-r2.md` and the whitelist `books/pc2-r2-whitelist.txt`. This is **audit 3** (decision 80), the
last audit before the lead decides on merging PC-2; rework 3 is the last rework allowed. Report everything you can
prove, and nothing you cannot.

Inputs in `./.lead-ref/`:

- **The frozen table** `books/pc2-r2-findings.md`: binding (§1 rulings: F1's scope, the approved input-shape change,
  F4, the deferred rows now run). `books/pc2-findings.md` (rework 1's table, F1–F3) and the book `books/pc2-book.md`
  only where a row cites them; audit 1's J report `audit1/J.out.md` for the deferred rows J-04, J-06, J-08, J-09.
- **The change:** `parts/A.diff` (`2dae25f` → `9e984e1`: the fixture commit and rework 2) and `parts/A-files.txt`; the
  `2dae25f` version of each changed file under `base/`. The whole result tree is the current directory.
- **DSH's reply** (claims, not evidence): `replies/pc2-r2-reply.md`; §1 the rows it did not do or did partly, §2 each
  row's production mutation, RED and GREEN.
- **The lead's checks:** `checks/full-pc2-r1.txt` (the full suite on `2dae25f` with bubblewrap: 2 files failed, F4);
  the full suite on `9e984e1` if present (`checks/full-pc2-r2.txt`). DSH has no bubblewrap.

## What to check

1. **Each fix row and §1 ruling**, one by one: done exactly as the row says? Cite the row and the code or test line.
2. **The test bar:** expected values literal or hand-computed; no production function (digest helpers included), the
   generated pack, `preparedTexts()`, a manifest or a captured request used to build an expectation; whole texts
   compared whole; no fact read from the database or a private module. **Check each mutation claim by reading:** is
   the mutation in production code, and would the changed case fail under it? Name a mutation of the same rule it
   would still miss, if any.
3. **The rows DSH did not finish (reply §1):**
   - **J2-03:** DSH says the brief's marker cannot be hand-computed because the fixture's successor `runId` is a random
     UUID and the checkpoint's `sourceDigest` is taken over a live SQLite file. Check both claims. Is there a public,
     deterministic way to get those two values into the expectation (as PC-1b's J2-01 took the digest and round id from
     the public `readContinuationBrief` / `openVerification`)? If yes, give the exact test change; if no, say what the
     row can assert instead without a value from production code.
   - **J-06:** your fixture branch `sourceHistory: 'completed_turn'` fails at the requeue: `the selected Run is
     verifying; finalize its round first` (`K3-35-continuation-fixture.ts` ~717 via `PC-platform-fixture.ts` ~587).
     Confirm from the code, and give the smallest fixture patch (the public `registerCheckConfiguration →
     openVerification → finalizeChecks` steps DSH names, or whatever the code needs) as a unified diff against this
     tree, with every caller checked.
   - **J-08 (partly done):** DSH says `footprint` cannot be non-empty because `optionalRowsFromExtensions` hard-codes
     `[]` (`context-fact-text.ts` ~316), and `inputs` cannot because the fixture Plan has no input requirements and
     the public Plan adoption refuses a Task that already has a Run. Check both. If either section can be reached by
     a public path, give the test steps; if not, say whether the row is satisfied by the two sections that are reached.
   - **J-04's correction:** the reused Query is `takesSessionHistory: true`, no `sessionBasis`, reminder 1, not the
     book's 0. Is DSH right by ruling 14 and F1?
4. **The fixture commit `197b4ad`:** applied exactly as your four patches; no other line changed.
5. **Scope and leftovers:** every hunk asked for by a row; no file outside the whitelist; the frozen fixtures and
   `WP2-platform-support.ts` unchanged since `197b4ad`; no test-only path in production; no construction history in
   production comments; `invariants.test.ts` back to `af84802`'s text (G2-04).
6. **Anything rework 2 broke** that a row did not ask for: **会出错** with the input and both outputs.

## Answer

1. **Findings table:** 编号 (`A3-01` …) | 类别 | 位置 (`file:line`) | 依据 | 问题 | 唯一改法. Classes **会出错**, **违规**,
   **不整洁**, **建议**. If nothing is wrong, say so and leave the table empty.
2. **Per row:** one line each for every row of the table (fix, rejected, same-as) and each §1 ruling: `OK` / finding
   ids / `rejected, untouched`.
3. **The unfinished rows** (item 3): one section each, with the patch or test change where you give one.
4. The findings as JSON in one fenced ` ```json ` block (`[]` if none).
5. **One last line:** `会出错 n，违规 n，不整洁 n，建议 n`.
