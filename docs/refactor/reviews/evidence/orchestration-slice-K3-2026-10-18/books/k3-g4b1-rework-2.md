# Task: K3 group 4 session B1, rework 2 — five items from the quick check; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions; report anything undetermined under
UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`); no fixed limit on subagents (decision 76), files disjoint, every vitest command
`--maxWorkers=2`. **Do not end your turn while a subagent has not reported back.** **Finish within 90 minutes** (the
run stops at 100).

## 1. What this copy is

Tag `k3-g4b1-r1` (HEAD) = session B1 after rework 1 (book `./.dsh-ref/k3-g4b1-rework-1.md`, your reply
`./.dsh-ref/k3-g4b1-rework1-final.md`). Codex's quick check: `./.dsh-ref/k3g4b1-review2.out.md` (Chinese): items 1, 3,
4, 6, 7, 9, 10 done; the five below must change. Your UNSPECIFIED (b), (d), (e) are accepted; (a) and (c) are not
(items 2 and 3 below).

## 2. Items (binding)

1. **A failing application skips that task, not the whole advance (rework-1 item 2, "waits = like UR6").**
   `workflow.ts` ~2070, ~2390: when ② (or UR7b's ② replay) does not succeed, the ordinary advance records this task as
   waiting with the reason and **continues selecting the other tasks** in the same advance (as UR6 does for an
   unanswered card); it must not select the same card again in that advance. Only when this task is the designated one
   does the advance answer `waiting` with the reason. Test: two tasks of one goal, task 1's answered card whose ② keeps
   failing `unavailable` (a store wrapper), task 2 ready to claim → one advance claims task 2 and reports task 1's
   reason; designating task 1 → `waiting` with the reason.

2. **The goal-content refusal (T02) is told apart from a version race.** `workflow.ts` ~2079 reads every
   `revision_conflict` that does not show a changed record as "目标的内容变了". The Goal guard added in rework 1 also
   fails with `revision_conflict` when the goal is paused concurrently (`K3-17-goal-guard.test.ts` ~110, ~171), and the
   next advance can apply it. Make the owner's T02 refusal recognizable (one exported constant for its reason, or a
   structured marker on the rejection — the smallest that does not change slice 5's contract), and in the Workflow:
   T02 → wait with "目标的内容变了，这个答复不能落实"; any other `revision_conflict` that is not a changed record → wait
   with the real rejection reason (the next advance re-reads: `busy` while paused, applied after resume). Test: the
   goal-guard race shows the race's reason, not the T02 sentence; a real plan adoption after the answer shows the T02
   sentence.

3. **The targets line is always present (lead ruling 5; your UNSPECIFIED (a) is not accepted).**
   `continuation-brief.ts` ~764–768: the required part always has `- 作用对象：<别名，用“、”隔开>。`; with no targets
   (settled by itself, or an empty set) it reads `- 作用对象：无。`. Test the settled-by-itself case literally.

4. **Row end points reach the task's end (rework-1 item 8; your UNSPECIFIED (c) is not accepted).**
   `K3-44-recovery-answers.test.ts` ~325–331 (K3-44 (三)) and `K3-29-disposition-recovery.test.ts` ~258 (L29 row 5)
   accept a task stuck at `verifying`. Fix the check fixture so the formal check runs and passes in the scenario (fault
   injection is fine; no fact injection), drive the flow to `complete_task`, assert the task's terminal state, then the
   quiet restart and `redriveGoals: []`. Do not weaken any other assertion.

5. **The "two answers, ③ fails" UR7b test without fact injection.** `K3-review-workflow-rows.test.ts` ~1002–1009 hand-
   makes records and answers and reuses one answer ref; ② is a stub (~240). Rebuild it with two real answers through
   the public card answer and real ② receipts; make ③ fail for both with a store wrapper (fault injection); assert
   that the advance's `reason` holds the FIRST failure's text. Remove the hand-made path.

## 3. Checks

`--maxWorkers=2`: every `tests/**/K3-*.test.ts`, `tests/**/K-*.test.ts`, `tests/**/S5*.test.ts`, `tests/business/`,
`tests/scenarios/WP1-*`, `tests/scenarios/A8-host-restart*.test.ts`, `tests/state/`, `tests/composition/`,
`tests/architecture/`, `tests/**/*brief*.test.ts`, the changed files; `npm run typecheck`, `npm run check:architecture`,
`npm run build`. Failures listed in `DSH-BASELINE.md` are expected (no bwrap). `A8-3n` passed in the lead's check with
bwrap after rework 1 (239 files / 5,170 tests); a timeout of it in your sandbox is expected, do not investigate it. No real model calls, no git
writes, never ports 3080/3099/44797; probes under `./.dsh-scratch/`, deleted.

## 4. Reply

Under 500 words: files changed (production net; tests), each item RED → GREEN, checks with numbers, UNSPECIFIED.
