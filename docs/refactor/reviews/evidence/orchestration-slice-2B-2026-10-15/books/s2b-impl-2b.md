# Task: slice 2B, round 2 — continue the interrupted round and finish it

You are working in the slice-2B copy (the current directory). Round 2's first session (book `./.dsh-ref/s2b-impl-2.md`;
read it, it all still applies) was **interrupted at about 03:29 by a machine failure** (the Linux VM ran out of memory
and stopped). Round 1's and the interrupted round 2's work are **uncommitted in the working tree — keep all of it**. This
is a NEW session. No git write commands, no network, no real model calls. Throw-away files under `./.dsh-scratch/`
(delete at the end); never `/tmp`. Finish within 120 minutes.

**This run is headless. When your turn ends, the whole run ends, and every subagent still running is killed.** After
starting subagents, stay in your turn until every one has reported (wait with `sleep 540`, then `list_agents`; repeat).

## 1. Memory limits (binding — the last session died of memory exhaustion)

- At most **2 subagents running at once**.
- Every vitest command adds `--maxWorkers=4` (the full suite in section 3: `--maxWorkers=8`). One vitest command at a time
  across all subagents.

## 2. Where the interrupted session stopped (from its event log)

Wave 1 finished: A (backfill fixes: R1, R6, R9, R13), B (observer and writers: R2, R10 — the coordinator was about to fix
a tautological R10 test), C1 (activity read fixes). C2 (track/timeline fixes: R3 and the timeline parts) was still
running. The coordinator had said "All four wave-1 groups are done … launch wave 2" and had started wave 2 (group D: the
real-flow tests of R11 and R12) and read-only reviewers for wave 1 when the machine stopped.

## 3. What to do

1. First, find out the true state: `git status --short`, `npm run typecheck`, and the `S2B-` test files one directory at a
   time (with the limits). For each ruling R1–R13 of the book, decide from the code and tests: done, partly done, or not
   done.
2. Finish everything not done, test-first, in the book's groups (at most 2 at once): C2's remainder (R3 pagination with the
   segment-plus-index cursor, bounded reading; R7 for track), the R10 test fix, group D (R11 real flows for S, V and B;
   R12 rows 2B-24, 2B-34, 2B-27).
3. Two read-only reviewers in total (one for A and B, one for C and D), one after the other; fix what they find.
4. The book's section 3 checks, with `--maxWorkers=4` on the targeted run and `--maxWorkers=8` on the full suite.

## 4. Reply

The book's section 4 format, saying for each of R1–R13 which session did it.
