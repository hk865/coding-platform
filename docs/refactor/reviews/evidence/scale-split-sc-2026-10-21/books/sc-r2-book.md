# Task: rework 2 of the scale-test split SC — one row (lead, 2026-10-21 evening)

You are working in a copy of SC after rework 1 (the current directory), at `db76a84` (`SC lead fixes …`), tagged
`sc-r2-base`. This is a NEW session. Read this book first, in full, then row R2-01 of the rework audit
(`./.dsh-ref/audit2/R2.out.md`, the row and its JSON) and the frozen table `./.dsh-ref/sc-findings.md` §0 and row
P5-02. The test rule sheet `./.dsh-ref/test-rule-sheet-v2.md` binds (and rule A3 of v1, which it keeps: a test may
wrap a port to count calls or wait, forwarding every request and result unchanged). Report anything you cannot
understand before you start (decision 56). **Finish within 50 minutes** (the run stops at 60). **This run is
headless: when your turn ends, the whole run ends. Do not end your turn while a subagent has not reported back.**
This is a small task: do it yourself or with one subagent.

## 1. What to do (row R2-01, the lead adopts Codex's fix)

In `tests/work-graph/S2C-lines-scale.test.ts`, 2C-25 case (3) (the daily small version, default budget): keep every
existing assertion. Through the fixture's existing `readerWith` (`tests/helpers/S2C-X-scale-fixture.ts`, near
`:536`), put in a counting wrapper on the record port that forwards every request and every result unchanged and
records, for this case's one `listWorkLines` call, each Run-by-task lookup request (the read loop at
`src/core/work-graph/views/work-line-reader.ts:2003`, `:2038`, width `listPageLimit: 1`). Then assert as literals,
with the hand calculation in a comment: the four anchored tasks are read in **2, 2, 2 and 1 pages**, and each of the
first three tasks issues its continuation page request (the request with `after`). Do not change a request, a
result, a size or any other case. If the wrapper needs a fixture option, add it to `S2C-X-scale-fixture.ts` as an
optional parameter whose default path is unchanged (R-SC-3); nothing else in the fixture changes.

**Prove it:** in a throw-away copy (`M=.dsh-scratch/r2-1; mkdir -p $M; git ls-files -z | tar --null -T - -c | tar -x
-C $M; cp -al node_modules $M/node_modules; cp -al vendor/coding-agent/node_modules
$M/vendor/coding-agent/node_modules`), make `readEnteredAnchors`' loop stop after its first page and show that case
(3) now fails on the new assertion. Delete `.dsh-scratch/` before you end.

## 2. Checks and commit

`flock ./.typecheck.lock npm run typecheck`; `npm run check:architecture`; `npx vitest run --maxWorkers=2
tests/work-graph/S2C-lines-scale.test.ts` and, if you changed the fixture, every daily file that imports it
(`grep -rln S2C-X-scale-fixture tests | grep -v '\.scale\.test\.ts'`); never run the `.scale.test.ts` files;
`node ./.dsh-ref/scale-move-check.mjs sc-base HEAD > ./.dsh-ref/out/move-check-r2.txt` (exit 0, `OK`);
`git diff --stat sc-r2-base HEAD -- 'tests/**/*.scale.test.ts'` empty. Commit by path:
`git -c user.name=dsh -c user.email=dsh@localhost commit -qm "SC rework 2"`. No `.dsh-ref/`, `.dsh-scratch/`.

## 3. Reply (plain Chinese) in `./.dsh-ref/out/sc-r2-reply.md`

The change (file:line), the hand calculation of the four tasks' pages, the throw-away check (which edit, which
assertion failed), the checks with counts, the commit and `git diff --shortstat sc-r2-base HEAD`.
