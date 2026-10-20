# T run: wave 1, rework 3 (lead, 2026-10-20)

This copy holds T wave 1 after rework 2 (`1c31c27`, tag `w1r2`). Codex audited rework 2. The lead froze the result,
with a ruling for each row, in `./.dsh-ref/t-w1r2-findings.md`. Your job is to apply that table. This is rework 3 of
at most 3 (decision 81), **the last DSH rework**. Start a new Session; nothing from earlier Sessions carries over.

## Read first, and only this

- `./.dsh-ref/t-w1r2-findings.md`, the whole of it (twelve rows). §0 (R-10 to R-12, and R-1 to R-9 by reference)
  applies to every row.
- R-1 to R-6 are in `./.dsh-ref/t-w1-findings.md` §0, R-7 to R-9 in `./.dsh-ref/t-w1r1-findings.md` §0. From those
  files read **only** §0 and the rows a W3 row names (`grep -n "^| W2-18 " ./.dsh-ref/t-w1r1-findings.md`).
- `./.dsh-ref/test-rule-sheet-v2.md`, and `test-rule-sheet-v1.md` only where a row needs it.
- **Do not read** audit answers or items files whole; `grep -n` the lines you need. This environment has no `rg`.
- Report anything you cannot understand before you change anything (decision 56).

## Base

- Tag `w1r2` (= HEAD when you start, `1c31c27`) is this rework's base. `git show w1r2:<path>` gives a file as it was
  before this rework.

## Rules

1. **Scope.** Do only the rows of the table. Edit only the files a row names, and a shared helper a row's fix needs.
   List every other file you change in the reply, with the reason. Do not edit `src/`, `docs/`,
   `vendor/coding-agent/dist`, `package.json` or the lock files: this rework changes tests only.
2. **Deletions** only where a row or ruling says so. Every deletion names its reason or cover in the reply. Never
   delete or relax any other assertion.
3. **Conversions** follow rule sheet v2 and R-7, R-8, R-11. Expected values come from the spec or a hand calculation
   written in a comment, never from a production function, a source constant or the program's output.
4. **Shared helpers** (`tests/helpers/S2B-runtime-steps-fixture.ts`, `S1-archive-service-fixture.ts`,
   `task-claim-fixture.ts`, `S5-decision-fixture.ts`): subagents use them but do not edit them. A subagent that needs
   a new option reports the exact addition. You add it, as a new optional option whose default path stays as it is,
   and run its importers' tests.
5. **Never get green by weakening:** no `skip`, `todo` or `only`, and no raised timeouts.
6. **Memory (binding).**
   - Run the typecheck only as `flock ./.typecheck.lock npm run typecheck`, by you, never while a subagent runs
     tests.
   - Subagents run only their own test files, with **`npx vitest run --maxWorkers=2 <files>`, never more workers.**
     Put this line in every subagent's prompt.
   - At most three subagents at once, on files that do not overlap.
   - **Do not end your turn before every subagent has reported back.**
7. Tests that need the process sandbox: R-10. Tests that fail only on `ENOENT /usr/bin/bwrap` are environment
   failures; list them.

## Subagents

A split with no overlapping files:

- (a) `tests/work-graph/S3-context-inputs.test.ts`: W3-01 to W3-06. The largest; give it its own subagent and start
  it first.
- (b) `tests/work-graph/S3-prepared-context-admission.test.ts`: W3-09, W3-11. Then
  `tests/work-graph/S3-graph-context.test.ts`: W3-07.
- (c) `tests/work-graph/R4c-execution-read.test.ts`: W3-08. Then `tests/scenarios/S2C-K-legacy-provenance.test.ts`:
  W3-10.
- W3-12 is a reply line only.

Give each subagent its rows' text from the table, the rulings it needs, rule 4 and the `--maxWorkers=2` line. Each
reports in at most 40 lines:

- each row's result (`done`, `partial` or `BLOCKED`);
- the files it changed;
- test pass/fail counts, and the failing test names (no logs);
- BLOCKED evidence as `file:line` plus one sentence;
- any addition it needs in a shared helper (rule 4).

## Checks before you finish

1. `flock ./.typecheck.lock npm run typecheck` and `npm run check:architecture`, both green.
2. `npx vitest run --maxWorkers=2 <files>`, for every test file you changed, and every test file that imports a
   helper you changed (`grep -rln`). Batches of at most 10 files, each under `timeout 900`.
3. Commit without `.dsh-ref/`:
   `git add -A -- tests && git -c user.name=dsh -c user.email=dsh@localhost commit -qm "T W1 rework 3"`.
4. Ledger: `python3 -I ./.dsh-ref/d1-ledger.py . w1r2 HEAD > ./.dsh-ref/ledger-W1R3.txt`. Map every REMOVED or
   LOOSENED line, and every deleted file, to one row id (`W3-xx`). A line you cannot map is an unplanned deletion:
   undo it, re-run that file's tests, commit again (`T W1 rework 3 fix`), and run the ledger again. Check the file
   path of every line you map.
5. `git diff --shortstat w1r2 HEAD`.

## Reply (plain Chinese): `./.dsh-ref/t-reply-W1R3.md`

1. **Per row:** 编号 | 结果 (`done` / `partial` / `BLOCKED` / `未施工（R-6 事实不符）`) | 改了哪些文件 | 备注.
2. **BLOCKED and partial parts:** the evidence for each (`file:line`, error text, what you tried).
3. **R-6:** each row whose facts you found wrong, with `file:line`.
4. **Deleted rows:** file, test name, the ruling, the reason or cover (`file:line`).
5. **Files outside the rows**, and why; every shared-helper addition (rule 4).
6. **Checks:** commands and pass/fail counts, including the R-10 sandbox runs; the ledger mapping as a table (文件 |
   REMOVED/LOOSENED 行 | 编号); the shortstat; the W3-12 correction.
7. **Suspected errors** in the table or this file.
8. **HANDOFF**, only if you stop before the end: done rows, half-done files, rows not started, and the shortest path
   to finish.
