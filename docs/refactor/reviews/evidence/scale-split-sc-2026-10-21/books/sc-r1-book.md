# Task: rework 1 of the scale-test split SC (lead, 2026-10-21 evening)

You are working in the same copy as SC (the current directory), at `efa2303` (`SC2 scale tests split`), tagged
`sc-r1-base`, on top of `sc-base`. This is a NEW session. Read this book first, in full, then
`./.dsh-ref/sc-findings.md` (the frozen finding table, with the lead's rulings in §0) and the SC book
`./.dsh-ref/sc-book.md` §3 and §4 (they still bind, with the rules "never get green by weakening" and the test rule
sheet `./.dsh-ref/test-rule-sheet-v2.md`). Report anything you cannot understand before you start (decision 56).
**Finish within 150 minutes** (the run stops at 180). **This run is headless: when your turn ends, the whole run
ends. Do not end your turn while a subagent has not reported back** (wait with `sleep 300`, then `list_agents`).

Work in coordinator mode (`./.dsh-ref/coordinator-mode.md`): subagents change the code; you split, brief, check the
reports, run the final checks and write the reply.

## 1. What to do

Apply `sc-findings.md` §1, every row (`P1-01` … `P5-05`, `L-01`, `L-02`), **one row all or nothing**, as written
and under the rulings of §0, nothing else. The Codex answers the rows came from are in `./.dsh-ref/audit/P1.out.md`
… `P5.out.md` (for detail: the hand calculations behind each row; the table decides).

Split by the table's §2 groups A–E, one subagent each, disjoint files. At most three run tests at the same time;
start A, C and D first (the largest), then B and E. A file a row forces you to touch outside its group's list (an
import, a fixture option the row names) is allowed only as far as the row needs, and is listed in the reply. When two
subagents need the same file, you serialize. Give each subagent its rows' text, §0, the book's §4 item 2 and the
memory lines of §2.

**For every small case a subagent changes,** it writes in the reply each layer's records in order, the page split and
where the decisive item is, computed by hand from the fixture and the sizes (R-SC-1), and it checks the claim the row
makes: if the row says "the case would still pass if a read stopped after its first page", make that read stop
after its first page in a scratch copy and show that the changed case now fails there. The scratch copy is outside
this repository copy, a new one per check, so no edit ever reaches the working tree other subagents test:

```
M=/home/han001/dsh-work/sc-r1-mut/<group>-<n>; mkdir -p $M
git ls-files -z | tar --null -T - -c | tar -x -C $M        # the working files as they are now
cp -al node_modules $M/node_modules; cp -al vendor/coding-agent/node_modules $M/vendor/coding-agent/node_modules
```

Then edit the production read in `$M` only and run the case there (same `--maxWorkers=2` rule). Report each such check (which read, which edit,
which assertion failed, the `$M` path).

**The scale files do not change** (R-SC-3); do not run them (they take up to 25 minutes each; the lead runs the scale
batch with bubblewrap).

**This environment.** No `rg` (use `grep -rn`); `python3 -I` for scripts. There is no bubblewrap in your sandbox: a
test failing only with `ENOENT … bwrap` or "sandbox unavailable" is an environment failure; list it, the lead runs it.

## 2. Memory (binding)

The typecheck only as `flock ./.typecheck.lock npm run typecheck`, only by you, never while a subagent runs tests.
Subagents run only their own test files: **`npx vitest run --maxWorkers=2 <files>`, never more workers**, batches of
at most 10 files, each under `timeout 900`. Put this line in every subagent's brief. At most three subagents run tests
at once. Never run `npm test`, `npm run test:scale` or a bare `npx vitest run`.

## 3. Close-out (one subagent, nobody else running tests)

1. `flock ./.typecheck.lock npm run typecheck`, `npm run check:architecture`, `npm run build`: all 0;
   `npx tsc --noEmit -p tsconfig.json --noUnusedLocals 2>&1 | grep "TS6133\|TS6196\|TS6192\|TS6198"`: no line in a
   file this rework or SC changed.
2. The twelve daily files, `tests/architecture`, and the tests of every importer of a changed helper or production
   file (`grep -rln`), in batches; each daily file's duration from the vitest summary.
3. `node ./.dsh-ref/scale-move-check.mjs sc-base HEAD > ./.dsh-ref/out/move-check-r1.txt`: exit 0, last line ending
   `OK`; `git diff --stat sc-r1-base HEAD -- 'tests/**/*.scale.test.ts'`: empty.
4. `npx vitest list --config vitest.scale.config.ts | wc -l`: still 38.

**Commit** in this copy, one commit: stage only the files you changed, by path (`git add -A -- <files>`), check
`git diff --cached --stat`, then `git -c user.name=dsh -c user.email=dsh@localhost commit -qm "SC rework 1"`. Never
amend; never stage `.dsh-ref/`, `.dsh-scratch/` or `.typecheck.lock`. Then `git diff --shortstat sc-r1-base HEAD`.

**Reply** (plain Chinese) in `./.dsh-ref/out/sc-r1-reply.md`:
1. per row: done / BLOCKED (with the file, the line and why), the files, what changed in one or two lines;
2. per changed small case: each layer's order, page split and the decisive item's page (hand calculation), and the
   first-page check of §1 with its result;
3. the files touched outside the groups' lists, each with why;
4. checks: commands and pass/fail counts; environment failures; the move check's last line; the scale-file diff;
5. suspected errors in the table; HANDOFF if you stop early (done, half done, not started).

Before you end, delete `./.dsh-scratch/` (the directory too).
