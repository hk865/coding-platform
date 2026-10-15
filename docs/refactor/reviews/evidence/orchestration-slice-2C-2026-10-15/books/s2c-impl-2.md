# Task: slice 2C — continue the interrupted build and finish it

You are working in the slice-2C copy (the current directory). The first build session (`./.dsh-ref/s2c-impl.md` is its
book; read sections 1–8, they all still apply) was **interrupted at about 03:27 by a machine failure** (the Linux VM ran
out of memory and stopped). Its work is **uncommitted in the working tree — keep all of it**. This is a NEW session. No
git write commands, no network, no real model calls. Throw-away files under `./.dsh-scratch/` (delete at the end); never
`/tmp`. Finish within 120 minutes.

**This run is headless. When your turn ends, the whole run ends, and every subagent still running is killed.** After
starting subagents, stay in your turn until every one has reported (wait with `sleep 540`, then `list_agents`; repeat).

## 1. Memory limits (binding — the last session died of memory exhaustion)

- At most **2 subagents running at once**.
- Every vitest command adds `--maxWorkers=4` (the full suite in section 4: `--maxWorkers=8`). One vitest command at a time
  across all subagents (keep using the `./.dsh-scratch/vitest.lock` convention if it exists).
- The 5,000-Session scale test (2C-25) runs alone, with `--maxWorkers=2`.

## 2. Where the last session stopped (from its event log)

Finished: groups M, C, L (all its continuations: core rows, D1 rows, attention and queue, controls and executor walk,
detail paging conversation, pausedTasks), P, D, W, K1, K2. Still running when it died:
- **Group X** (2C-25, the scale set and amendment A2's budget printout);
- **Group L "pausedTasks and leftovers"** (it had fixed `pausedTasks` and task anomalies);
- the coordinator's last notes: "Two K tests remain red: K1's 2C-24 (test scenario over-advances, contradicting §3.12)
  and K2's 2C-32 (out-of-scope production). W confirmed 2C-22(2) is out-of-scope (spec vs pre-existing K/A assertions) —
  that row will be reported, not forced."

## 3. What to do

1. First, find out the true state: `git status --short`, `npm run typecheck`, and run the new `S2C-` test files one
   directory at a time (with the limits above). List which rows pass and which fail.
2. Finish what was open: group X (2C-25 and its printout: m, r, w, the shared-cost reads and times, per backend); K1's
   2C-24 (fix the test scenario so it does not over-advance — §3.12 is binding); K2's 2C-32 and 2C-22(2): do not force
   them; report each with the spec line, the conflicting existing code or test, and a minimal counter-example.
3. The self-check of the book's section 7, but with **two** read-only reviewers in total (one for C, M, L, P, D; one for
   W, K1, K2, X), one after the other.
4. Fix what they find (the owning files), then section 4.

## 4. Checks

The book's section 8, with `--maxWorkers=4` on the targeted run and `--maxWorkers=8` on the full suite.

## 5. Reply

The book's section 9 format (FILES CHANGED, ROWS, CHECKS, UNSPECIFIED, NOTES), with NOTES also saying what this session
did beyond the interrupted one, and amendment A2's numbers.
