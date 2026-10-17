# Task: slice 4C-2 session A rework 4 — two test findings; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The books and the
lead's rulings are binding; do not make design decisions; report anything undetermined under UNSPECIFIED.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`), at most 3 subagents at once, every vitest command `--maxWorkers=2`. **Finish within
70 minutes** (the run stops at 80).

## 1. What this copy is

Tag `s4c2-a4` (HEAD) = session A after rework 3 (book `./.dsh-ref/s4c2a-rework-3.md`, your reply
`./.dsh-ref/s4c2a-rework3-final.md`). Codex's quick check (`./.dsh-ref/s4c2a-review4.out.md`, Chinese): items 1–4 done,
no new production defect; two test must-fix below. Your UNSPECIFIED (a)–(c) are accepted.

## 2. Items (binding; tests only — if a test shows a production defect, stop and report it)

1. **M-12h through a store fault, and no tamper-only tests** (AGENTS rule 4: no tests for states only tampering can
   make). Delete the damaged-pointer test (`S4C2-update-due.test.ts` ~258–262) and the hand-made damaged `TaskReduction`
   (`S4C2-goal-triggers.test.ts` ~199–201). Replace M-12h (spec §11.5 ~856, §11.8 ~926: "`unsupported` 的读是
   `unavailable`") with: a goal and its understanding built through the public fixture; a store wrapper makes exactly one
   Run-index read return `unsupported` (fault injection); the public note read (`memoryLookup` on the goal anchor) is
   `unavailable` for that call. It must fail if the reader treats `unsupported` as an empty set. Keep any
   `fakeRecords` unit test in `S4C2-goal-triggers.test.ts` only if a public test does not already cover the same case
   (say which you kept and why).
2. **"Claimed → no immediate send" on real records** (spec D-03 "被认领后不发"): archive through `workflow.archiveLine`
   (as the positive case does), read the real `requeueRef` from the public task graph, create a work line and claim the
   task with that `requeueRef` through `claims.claimTask` (the usage in `tests/composition/A2-requeue-platform.test.ts`
   ~234, ~304, ~470; extend `tests/helpers/S4A-note-fixture.ts` ~250 so its claim can pass a `requeueRef`), confirm
   through a public read that the new Run carries it. With no understanding written after the archive and counts below
   the thresholds: the archive trigger is still there, the to-do's `immediate` is false, the real Host sends nothing and
   the inbox is empty. It must fail if the claim filter (`note-scribe-todos.ts` ~230) is removed.

## 3. Checks

`tests/work-graph/S4C2-*.test.ts`, `tests/app/S4C2-*.test.ts`, `tests/composition/A2-requeue-platform.test.ts`,
`tests/work-graph/S4A-*.test.ts` (the fixture changed), `tests/architecture/`, with `--maxWorkers=2`; `npm run typecheck`.
No real model calls, no git writes, never ports 3080/3099/44797; probes under `./.dsh-scratch/`, deleted.

## 4. Reply

Under 300 words: files changed (tests), each item RED → GREEN (how you made each fail first), checks with numbers.
