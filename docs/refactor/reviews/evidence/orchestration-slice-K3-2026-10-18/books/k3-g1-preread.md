# Task: read-through before K3 group 1 (no code changes)

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. **Do not change
any file** (no code, no tests, no docs); no git writes; no tests; no builds; no network; no real model calls.
Throw-away notes go under `./.dsh-scratch/` and are deleted at the end. Finish within 25 minutes.

**This run is headless. When your turn ends, the whole run ends.** Do not start subagents. Keep your context small:
`grep -n`, `sed -n a,bp`.

## Read

- `./.dsh-ref/k3-g1-impl.md`: the construction book you (a new session) will build from right after this.
- The parts of `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md` it names (§2 types, §3 rows, the
  §5.2 rows K3-30 … K3-38 and B2-10, §6, §7 group 1, and the §1 rules those rows cite).
- The code those touch: `src/contracts/` (dispatch, prepared-execution, goal-decisions, task-failure),
  `src/core/work-graph/state/` (run-machine, task-machine, attempt-machine, goal-machine, session-availability,
  decision-policy, review-lease if present), and `tests/state/`.

## Report (under 700 words)

1. **Unclear:** every rule or row of group 1 you could not implement without guessing. For each, the question and the
   smallest options.
2. **Spec differs from the code:** a name, file, function, field or line the spec cites that is different in the code.
3. **Tests that will break:** existing tests you expect to fail after group 1, with file:line and why.
4. **Plan:** your order, what you would give a subagent, and your time estimate per item. If 170 minutes is not enough,
   say which items you would leave.
