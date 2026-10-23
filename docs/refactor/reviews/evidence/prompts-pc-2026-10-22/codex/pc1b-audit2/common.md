## What you are auditing

**Read only:** do not modify, create or delete any file; no tests, no builds, no git writes, no network. You may run
commands that only read (search, `diff` of two files, hashing a file). Answer in plain Chinese, with `file:line` for
every fact.

This tree is **PC-1b after rework 1** (HEAD `1b5183a`; commits in `.lead-ref/commits.txt`). You audited PC-1b at
`c1c7af4` (audit 1, your reports in `.lead-ref/audit1/`); the lead froze the findings in
`.lead-ref/books/pc1b-findings.md` and DSH did rework 1 from it, by the run sheet `books/run-pc1b-r1.md` and the
whitelist `books/pc1b-r1-whitelist.txt` (regular expressions on paths). This is **audit 2** (decision 80): your findings
become the frozen table for rework 2; at most three reworks. Report everything you can prove, and nothing you cannot.

Inputs in `./.lead-ref/`:

- **The frozen findings table** `books/pc1b-findings.md`: binding. Each row's last column is what rework 1 had to do.
  Rows **rejected** stay as they were; **same as** rows are done under the row they name. Its "PC-15", "Scope added"
  and "Book corrections" sections are binding too.
- **The book** `books/pc1-book.md` (v3) for the rulings the rows cite; the frozen spec in the tree
  `docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md`.
- **Your audit-1 reports** `audit1/<P>.out.md` (each row's evidence and the mutation you named) and `audit1/pc15.out.md`.
- **Your part:** `parts/<P>.diff` (rework 1's change: `c1c7af4` → `1b5183a`) and `parts/<P>-files.txt`. The `c1c7af4`
  version of every changed file is at the same relative path under `base/`; a new file has no base. The whole result
  tree is the current directory.
- **DSH's rework reply** (claims, not evidence): `replies/pc1b-r1-reply.md`. §2 has each row's test, mutation, RED and
  GREEN; §3 PC-15; §7 the rows DSH says did not fit and its open points. Its PC-1b reply `replies/pc1b-reply.md` only to
  look up what PC-1b built.
- **The lead's checks** `checks/`: the full suite on a clean clone of `1b5183a` with bubblewrap
  (`full-pc1b-r1.txt`, the log `full-pc1b-r1-vitest.txt` with each file's duration); 16 files fail, all from S-01
  (part X traces them; the lead's probe `pc1b-r1-s01-probe.{sh,log}` puts back the two early returns and all 16 pass).
  The A1 failure DSH reports (§7.2) passes with bubblewrap. Do not re-trace the 16 files unless your part is X.

## What to check (every part)

1. **Each fix row of your part, one by one:** done exactly as its last column says? Cite the row and the code or test
   line. A row done differently, partly, or not at all is a finding unless the table allowed the choice.
2. **The test bar (decision 80):** each test row goes through the public step the row names; expected values are
   literals or hand-computed, never from production code, the generated pack, `preparedTexts()` or a captured request;
   no database or private-module read to check a fact (the rows that say otherwise excepted). **Check DSH's mutation
   claim by reading:** would the test as written fail under the mutation the row names? If a test passes under it, or
   under an equally simple mutation of the same rule, name that mutation.
3. **Nothing new broken:** a production hunk that changes behaviour beyond what its row asks is **会出错** (give the
   input, the old and the new output). The 16 S-01 files are already known; other regressions are findings.
4. **Scope:** every hunk is asked for by a row of your part, or is an import or type the change needs; otherwise
   **违规**. No file outside the whitelist; the frozen fixtures `tests/helpers/PC-platform-fixture.ts` and
   `PC-kernel-fixture.ts` unchanged; old tests changed only where a row says so, and only as it says; no timeout raised
   on an old test.
5. **No test-only paths in production:** a branch, option or export that exists only so a test passes is **违规**.
6. **Comments:** rules and "why" kept with the code; no construction history ("R1 did …", "L-04:", "moved from …") in
   production code; in tests a row id in a test name or comment is fine.
7. **Per-test limits of new tests:** from the log, the file's duration; a limit far above what the test needs (say,
   more than three times its measured duration and above 60 s) is **不整洁** with the measured number.

## Answer

1. **Findings table:** 编号 (`<P>2-01` …) | 类别 | 位置 (`file:line`) | 依据 (row of the frozen table, ruling, spec item) |
   问题 | 唯一改法. Classes: **会出错**, **违规** (against the table, the run sheet, the book or the spec, including a test
   below the bar), **不整洁**, **建议**. One fix per finding: if the right fix needs a lead ruling (e.g. a change outside
   the whitelist), say so and give the fix you would rule.
2. **Per row:** one line each, every row of your part including rejected and same-as rows:
   `<row>: OK` / `<row>: <P>2-nn, …` / `<row>: rejected, untouched` (or `touched: …`).
3. **DSH's own items** that touch your part (reply §7 and any "UNSPECIFIED"): one line each, `成立` / `不成立` and why.
4. **The same findings as JSON**, in one fenced ` ```json ` block: `[{"id", "class", "file", "line", "basis",
   "problem", "fix"}]`.
5. **One last line:** `会出错 n，违规 n，不整洁 n，建议 n`.
