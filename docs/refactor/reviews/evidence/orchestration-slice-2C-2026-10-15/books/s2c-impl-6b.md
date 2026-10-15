# Task: slice 2C, round 6 (continued) — finish the last items, verify all eleven, report

You are working in the slice-2C copy (the current directory). All earlier work, including the round you continue, is
**uncommitted in the working tree — keep it**. This is a NEW session: the previous one ran out of context before it
wrote its report. No git write commands, no network, no real model calls. Throw-away files under `./.dsh-scratch/`
(delete at the end). Finish within 100 minutes. **Headless: when your turn ends the run ends.** At most 2 subagents at
once; stay in your turn until every subagent has reported (wait with `sleep 300`, then check; repeat). Memory: every
vitest command `--maxWorkers=4`, one at a time per agent; the full suite once at the end, `--maxWorkers=8`.

**Keep your own context small** (the last session hit the 360K limit): do not read whole large files
(`work-line-reader.ts`, `node-detail-reader.ts` are thousands of lines); use `grep -n` and `sed -n a,bp`. Give each
subagent one item and ask it for a short report (files, lines, test names, results).

Read first: the book of the round you continue, `./.dsh-ref/s2c-impl-6.md` (items 1–11 and the lead rulings), and the
review it answers, `./.dsh-ref/s2c-quick.md`. Do not read the old session's event log.

## State the lead found (from the old session's own notes and `diff` against round 5)

- Done according to the old session: items 1, 2, 3, 4, 5, 7(b), 8, 9, 10 (the claim commit of a reused Session opens the
  `responsible` link: `session-availability.ts` `occupancy_acquired.openWorkLink`, `claim-service.ts`,
  `claim-contracts.ts`, `workflow.ts`), 11 (the checks file reaches its check step).
- Not done: **6(a)** (2C-26 through LE4's HostScenario route path), **6(b)** (2C-28's archive states through real
  services; the `next: null` case was added), **6(c)** — the model-call half (`lines/*` and `graph/*` reads start no
  model call; the history-read half is done), **7(a)** (`tests/helpers/S2C-D-node-support.ts`: create the current Run
  snapshots through public services). Subagents for 6(a)/6(b)/7(a) may have been cut off mid-edit: check those files.
- Files changed in round 6 so far: `src/business/workflow/workflow.ts`, `src/contracts/work-line.ts`,
  `src/core/work-graph/model/claim-contracts.ts`, `src/core/work-graph/state/session-availability.ts`,
  `src/core/work-graph/tasks/claim-service.ts`, `src/core/work-graph/views/node-detail-reader.ts`,
  `src/core/work-graph/views/work-line-reader.ts`, and tests `S2C-D-node-support.ts`, `S2C-L-line-support.ts`,
  `S2C-K-archive-tags-checks.test.ts`, `S2C-K-archive-tags.test.ts`, `S2C-lines-conversation.test.ts`,
  `S2C-lines-copies.test.ts`, `S2C-lines-latest-generation.test.ts`, `S2C-lines-page.test.ts`,
  `S2C-lines-paused-continue.test.ts`, `S2C-lines-read-only.test.ts`, `S2C-node-detail-bounded.test.ts`,
  `S2C-node-detail-next-kinds.test.ts`. Typecheck passes.

## What to do

1. Finish 6(a), 6(b), 6(c) model-call half, 7(a) as the round-6 book says. If one truly cannot be built through public
   services, stop on that one and say exactly why (allowed); do not fake it.
2. Verify items 1–11 are really in place: for each, find the code and the test, run the test, and record file:line.
   Item 1 has no test (spec L2); give the line of the cross-page walk.
3. Item 10: list every existing test whose assertions changed because of it (file, test, before → after).

## Checks and reply

`npm run typecheck`, `npm run check:architecture`, `npm run build`, `node scripts/build-kernel-patch.mjs --check`;
targeted vitest; the full suite (`--maxWorkers=8`) compared with `DSH-BASELINE.md` §A (list every failure outside it;
`tests/scenarios/S2C-K-archive-tags-checks.test.ts` only at its check step). Reply: FILES CHANGED (round 6 as a whole);
per item 1–11 what changed (file:line) and the tests (names, result); CHECKS; UNSPECIFIED; NOTES.
