# T run: wave 1, rework 2 (lead, 2026-10-20)

This copy holds T wave 1 after rework 1 (`ed26c44`, tag `w1r1`). Codex audited rework 1. The lead froze the result,
with a ruling for each row, in `./.dsh-ref/t-w1r1-findings.md`. Your job is to apply that table. This is rework 2 of
at most 3 (decision 81). Start a new Session; nothing from rework 1's Sessions carries over.

## Read first, and only this

- `./.dsh-ref/t-w1r1-findings.md`, the whole of it (it is short). §0 (R-1 to R-9) applies to every row.
- R-1 to R-6 are in `./.dsh-ref/t-w1-findings.md` §0. From that file read **only** §0 and the rows a W2 row names
  (`rg -n "^\| W1-25 " ./.dsh-ref/t-w1-findings.md`). Never read the whole file.
- `./.dsh-ref/test-rule-sheet-v2.md`, and `test-rule-sheet-v1.md` only where a row needs it.
- **Do not read** the audit answers (`t-aud-*.out.md`), `t-r1-B14.out.md` or the items files whole. Use `rg` for the
  lines you need: `t-r1-B14.out.md` holds the evidence for the §3 rows, one section per item.
- Report anything you cannot understand before you change anything (decision 56).

**Why:** rework 1's first segment filled 360K of context in 17 minutes by reading large files. You coordinate;
subagents read the files and do the work.

## Base

- Tag `w1r1` (= HEAD when you start, `ed26c44`) is this rework's base. `w1-merged` is rework 1's base; `t-base` is
  the T round's.
- `git show w1r1:<path>` gives a file as it was before this rework.

## Rules

1. **Scope.** Do only the rows of the table. Edit only the files a row names, and a shared helper a row's fix needs.
   List every other file you change in the reply, with the reason. Do not edit `src/`, `docs/`,
   `vendor/coding-agent/dist`, `package.json` or the lock files: this rework changes tests only.
2. **Deletions** only where a row or ruling says so. Every deletion names its reason or cover in the reply. Never
   delete or relax any other assertion.
3. **Conversions** follow rule sheet v2 and R-7, R-8. Expected values come from the spec or a hand calculation, never
   from a source constant or the program's output. Where a conversion cannot reach the state, apply R-5 with R-7's
   standard of evidence (the refusing check or the missing entry point, as `file:line`).
4. **The shared real-Runtime helper** `tests/helpers/S2B-runtime-steps-fixture.ts` has other importers (C1, the task
   timeline, the S2B track).
   - Subagents use it but do not edit it. A subagent that needs a new option reports the exact addition. You add it,
     as a new optional option whose default path stays as it is, and run its importers' tests.
   - The same holds for `tests/helpers/S1-archive-service-fixture.ts` and `tests/helpers/task-claim-fixture.ts`.
5. **Never get green by weakening:** no `skip`, `todo` or `only`, and no raised timeouts.
6. **Memory (binding).**
   - Run the typecheck only as `flock ./.typecheck.lock npm run typecheck`, by you, never while a subagent runs
     tests.
   - Subagents run only their own test files, with **`npx vitest run --maxWorkers=2 <files>`, never more workers.**
     Rework 1 had one subagent use 6. Put this line in every subagent's prompt.
   - At most three subagents at once, on files that do not overlap.
   - **Do not end your turn before every subagent has reported back.**
7. Tests that fail only on `ENOENT /usr/bin/bwrap` are environment failures. List them; the lead runs the full suite
   with bwrap.

## Subagents

A split with no overlapping files:

- (a) `tests/work-graph/S3-prepared-context-admission.test.ts`: W2-09, W2-10, W2-15.
- (b) `tests/runtime/source-binding-migration.test.ts` and `tests/runtime/R4c-graph-history.test.ts`: W2-01, W2-06,
  W2-17, W2-25.
- (c) `tests/work-graph/R4c-execution-history-index.test.ts` and `tests/work-graph/R4c-execution-read.test.ts`:
  W2-07, W2-08.
- (d) `tests/work-graph/S3-context-inputs.test.ts`: W2-18, W2-19.
- (e) The small rows: W2-02, W2-03, W2-04, W2-11, W2-12, W2-13, W2-16.
- (f) `tests/app/S2B-r2-backfill-done-cursor.test.ts` and `tests/helpers/S2B-activity-fixture.ts`: W2-20.
- (g) `tests/helpers/S5-decision-fixture.ts` and `tests/app/S5-decision-routes.test.ts`: W2-21, W2-05. This fixture
  has 107 importers; its default world must give every importer the same revisions as before.
- (h) `tests/work-graph/B2-execution-entry.test.ts`: W2-23.
- (i) `tests/work-graph/S3-graph-context.test.ts`: W2-24.

Start (a), (b) and (c); start the others as slots free. W2-22 needs no change. Give each subagent:

- its rows' text from the table, R-1 to R-9, and the rule-sheet lines it needs;
- rule 4 above and the `--maxWorkers=2` line.

Each reports in at most 40 lines:

- each row's result (`done`, `partial` or `BLOCKED`);
- the files it changed;
- test pass/fail counts, and the failing test names (no logs);
- BLOCKED evidence as `file:line` plus one sentence;
- any addition it needs in a shared helper (rule 4).

## Checks before you finish

1. `flock ./.typecheck.lock npm run typecheck` and `npm run check:architecture`, both green.
2. `npx vitest run --maxWorkers=2 <files>`, for every test file you changed that still exists, and every test file
   that imports a helper you changed (`rg`). Run them in batches of at most 10 files, each batch under
   `timeout 900`, so one hung file cannot stall the rest.
3. Commit without `.dsh-ref/`:
   `git add -A -- tests && git -c user.name=dsh -c user.email=dsh@localhost commit -qm "T W1 rework 2"`.
4. Ledger: `python3 -I ./.dsh-ref/d1-ledger.py . w1r1 HEAD > ./.dsh-ref/ledger-W1R2.txt`. Map every REMOVED or
   LOOSENED line, and every deleted file, to one row id (`W2-xx`). A line you cannot map is an unplanned deletion:
   undo it, re-run that file's tests, commit again (`T W1 rework 2 fix`), and run the ledger again.
5. `git diff --shortstat w1r1 HEAD`.

## Reply (plain Chinese): `./.dsh-ref/t-reply-W1R2.md`

1. **Per row:** 编号 | 结果 (`done` / `partial` / `BLOCKED` / `未施工（R-6 事实不符）`) | 改了哪些文件 | 备注.
2. **BLOCKED and partial parts:** the evidence for each (`file:line`, error text, what you tried).
3. **R-6:** each row whose facts you found wrong, with `file:line`.
4. **Deleted rows:** file, test name, the ruling, the reason or cover (`file:line`).
5. **`FORMAT` seeds** (R-2): file:line and the fields you added.
6. **Files outside the rows**, and why; every shared-helper addition (rule 4).
7. **Checks:** commands and pass/fail counts; the ledger mapping as a table (文件 | REMOVED/LOOSENED 行 | 编号); the
   shortstat.
8. **Suspected errors** in the table or this file.
9. **HANDOFF**, only if you stop before the end: done rows, half-done files (in the tree, not verified), rows not
   started, and the shortest path to finish.
