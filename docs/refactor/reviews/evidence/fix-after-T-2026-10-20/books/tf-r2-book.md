# Task: rework 2 of the fix round after T (lead, 2026-10-21 night)

You are working in the same copy as rework 1 (the current directory), at `8317081` (`TF rework 1`). This is a NEW
session. Read this book first, then `./.dsh-ref/tf-findings.md` §0 and row `TFR-04`, and your rework-1 reply
`./.dsh-ref/out/tf-r1-reply.md` (row TFR-04). The memory rules and "never get green by weakening" of
`./.dsh-ref/tf-book.md` §7 still bind. **Finish within 75 minutes** (the run stops at 90). This run is headless: when
your turn ends, the whole run ends; do not end your turn while a subagent has not reported back. One subagent is
enough; you may do it yourself.

## 1. The lead's rulings on rework 1

- **TFR-08 (B-023):** your finding stands (`executionAuthorization` is optional; RUN-23 reaches the fallback). B-023's
  result becomes `kept`, note "proposal premise false (RUN-23 has no authorization)". Nothing to change.
- **TFR-10 (C2-039):** stays BLOCKED; the four tests that rely on an observer without `controls`
  (`S2B-36-observer-cancel-reread.test.ts:66-93`, `S2B-38-run08-unknown-activity.test.ts:176-205`,
  `B2-runtime-execution.test.ts:383`, `:483`) are recorded as T leftovers (decision 86-3). Nothing to change.
- **TFR-04 (A1-013, A1-016): redo it.** The two tests that blocked it hand-write an `unavailable` Session without a
  conclusion through their own mutate callbacks. As with TFR-02's seed (R-TF-2), the lead allows the least change that
  makes the hand-written record the current shape: add a legal `healthConclusion` to those mutations, nothing else.

## 2. What to do

1. Apply TFR-04 exactly as the table's row says (the codec refuses `health: 'unavailable'` without a recognized
   `healthConclusion`; an `available` Session keeps its `null`; drop the `?? null` fallbacks at `line-status.ts:287`,
   `:351`, the `unrecorded` text at `:601`, the code that produces `retired_unrecorded` at `:817` and
   `work-line-reader.ts:2285`; the contract member `retired_unrecorded` in `src/contracts/work-line.ts:46` stays).
   You did this in rework 1 and undid it; redo the same change.
2. In `tests/work-graph/R4c-task-claim-boundaries.test.ts:96` and in the `unavailable` mutation of
   `tests/work-graph/R4c-task-claim.test.ts` (the `mutations` list used at `:265`), add
   `healthConclusion: 'missing'` (or another member of `SESSION_HEALTH_CONCLUSIONS` if `missing` is not one; say which)
   next to `health: 'unavailable'`. Do not change `tests/helpers/task-claim-fixture.ts`, any assertion, or any other
   test. If another test turns red for the same reason, stop: undo everything, report it BLOCKED with the test and line.
3. Checks: `flock ./.typecheck.lock npm run typecheck`, `npm run check:architecture`, `npm run build` (all 0);
   `--noUnusedLocals` filter empty; the tests of the importers of the changed files (`grep -rln`), batches of at most 10,
   `npx vitest run --maxWorkers=2`, `timeout 900`; environment failures (no bubblewrap) only listed if their file is
   not in `./.dsh-ref/env-failures.txt`. Then
   `python3 -I ./.dsh-ref/d1-ledger.py . 8317081 HEAD > ./.dsh-ref/out/ledger-r2.txt` (every line mapped to TFR-04).
4. **Commit** by path, then `git -c user.name=dsh -c user.email=dsh@localhost commit -qm "TF rework 2"`; then
   `git diff --shortstat 8317081 HEAD`. Never stage `.dsh-ref/`, `.dsh-scratch/` or `.typecheck.lock`.

**Reply** (plain Chinese) in `./.dsh-ref/out/tf-r2-reply.md`: done or BLOCKED; the files and what changed; the
conclusion value used; the checks with counts; the ledger mapping. Before you end, delete `./.dsh-scratch/`.
