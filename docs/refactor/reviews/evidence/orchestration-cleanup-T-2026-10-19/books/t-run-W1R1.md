# T run: wave 1, rework 1 (lead, 2026-10-19)

This copy holds T round wave 1 (groups TP and TQ, merged by the lead). Codex audited it in full. The lead froze the
findings, with a ruling for each, in `./.dsh-ref/t-w1-findings.md`. Your job is to apply that table. This is rework 1
of at most 3 (decision 81).

## Read first

- `./.dsh-ref/t-w1-findings.md`, the whole of it. §0 (rulings R-1 to R-6) applies to every row.
- `./.dsh-ref/t-book.md` §1 and §2. Its rules bind you, with the changes listed under "Rules" below.
- `./.dsh-ref/test-rule-sheet-v2.md`, the rule sheet for this rework. v1 is
  `./.dsh-ref/test-rule-sheet-v1.md`; v2 lists only what changed.
- `./.dsh-ref/t-v2-list.out.md` is Codex's list of current instances under v2.
- **Evidence when you need it:**
  - the Codex audit answers `./.dsh-ref/t-aud-G1.out.md` to `G7.out.md`; each row of the table names its Codex ids;
  - the items `./.dsh-ref/t-items-TP.md` and `t-items-TQ.md` (large: `rg -n "TP-165"`, never read them whole);
  - the wave-1 replies `./.dsh-ref/t-reply-TP.md` and `t-reply-TQ.md`.
- Report anything you cannot understand before you change anything (decision 56).

## Base

- Tag `w1-merged` (= HEAD when you start, `5daea2e`) is this rework's base. Tag `t-base` is the T round's base.
- `git show t-base:<path>` gives a file as it was before T.

## Rules (book §2, changed for this rework)

1. **Scope.** Do only the rows of the table. Edit only:
   - the files a row names;
   - a shared helper that a row's fix needs.

   List every other file you change in the reply, with the reason. Do not edit `docs/`, `vendor/coding-agent/dist`,
   `package.json` or the lock files.
2. **Deletions** only where a row or ruling says so (R-3, R-4, W1-14, W1-23 …). Every deletion names its reason or
   cover in the reply. Never delete or relax any other assertion.
3. **Conversions** follow rule sheet v2. Expected values come from the spec or a hand calculation, never from a source
   constant or the program's output. Where a conversion cannot reach the state, apply R-5.
4. **Production** (W1-01, W1-02): behaviour on current-format data does not change. Error codes, texts and check order
   for current inputs stay. Remove the production-reach allowlist entry of every declaration you delete; never add
   one.
5. **Never get green by weakening:** no `skip`, `todo` or `only`, and no raised timeouts.
6. **Memory (binding).**
   - Run the typecheck only as `flock ./.typecheck.lock npm run typecheck`, by you, never while a subagent runs
     tests.
   - Subagents run only their own test files, with `npx vitest run --maxWorkers=2 <files>`.
   - At most three subagents at once, on files that do not overlap.
   - **Do not end your turn before every subagent has reported back.**
7. Tests that fail only on `ENOENT /usr/bin/bwrap` are environment failures. List them; do not chase them. The lead
   runs the full suite with bwrap.

## Order

1. Write `./.dsh-ref/t-plan-W1R1.md`: the rows grouped by the files they touch, in the order below, and which groups
   can go to subagents in parallel.
2. **Production first:** W1-01, W1-02, W1-03, W1-04. Then typecheck, `npm run check:architecture`, and the tests of
   the changed sources and their importers.
3. `S3-prepared-context-admission` and `task-claim-fixture`: W1-43 first (all 12 of its tests fail now), then W1-09,
   W1-19, W1-25, W1-26, W1-41.
4. The fixtures:
   - S1 archive service: W1-44 (`S1-requeue` fails now);
   - WP1: W1-10;
   - C1: W1-13, with its part of W1-35;
   - S2B track: W1-15, with its part of W1-36;
   - S5: W1-17, W1-18, and the rest of W1-36 and W1-37;
   - S1: W1-14.
5. Runtime and R4c: W1-20, B-03, B-04, B-08, B-09.
6. Graph-session and context inputs: B-10, B-11, B-12, B-13, then B-02.
7. Everything else: W1-05 to W1-08, W1-11, W1-12, W1-16, W1-21 to W1-24, W1-27 to W1-34, W1-38 to W1-40, W1-42.

After each step: the typecheck, then the tests of the files that step changed and of their importers.

## Checks before you finish

1. `flock ./.typecheck.lock npm run typecheck` and `npm run check:architecture`, both green.
2. `npx vitest run --maxWorkers=2 <files>`, for:
   - every test file you changed that still exists;
   - every test file that imports a source or helper you changed (`rg`).
3. Commit without `.dsh-ref/`:
   `git add -A -- src tests scripts resources runtime-assets.json && git -c user.name=dsh -c user.email=dsh@localhost commit -qm "T W1 rework 1"`.
4. Ledgers:
   - `python3 -I ./.dsh-ref/d1-ledger.py . w1-merged HEAD > ./.dsh-ref/ledger-W1R1.txt`. Map every REMOVED or
     LOOSENED line, and every deleted file, to one row id (`W1-xx` or `B-xx`). A line you cannot map is an unplanned
     deletion: undo it, re-run that file's tests, commit again (`T W1 rework 1 fix`), and run the ledger again.
   - `python3 -I ./.dsh-ref/d1-ledger.py . t-base HEAD > ./.dsh-ref/ledger-W1-total.txt` (no mapping needed).
5. `git diff --shortstat w1-merged HEAD` and `git diff --shortstat t-base HEAD`.

## Reply (plain Chinese): `./.dsh-ref/t-reply-W1R1.md`

1. **Per row:** 编号 | 结果 (`done` / `BLOCKED` / `未施工（R-6 事实不符）`) | 改了哪些文件 | 备注.
2. **BLOCKED rows:** the evidence for each (`path:line`, error text, what you tried).
3. **R-6:** each row whose facts you found wrong, with `file:line`.
4. **Deleted rows** (R-3, R-4 and the other deletions): file, test name, the ruling, the reason or cover
   (`file:line`).
5. **`FORMAT` seeds** (R-2): file:line and the fields you added.
6. **Files outside the rows**, and why.
7. **Checks:** commands and pass/fail counts; the ledger mapping, as a table (文件 | REMOVED/LOOSENED 行 | 编号); the
   two shortstats.
8. **Suspected errors** in the table or this file.
