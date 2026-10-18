# Task: read-through before K3 group 3 (no code changes)

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. **Do not change
any file** (no code, no tests, no docs); no git writes; no tests; no builds; no network; no real model calls.
Throw-away notes go under `./.dsh-scratch/` and are deleted at the end. Finish within 25 minutes.

**This run is headless. When your turn ends, the whole run ends.** Do not start subagents. Keep your context small:
`grep -n`, `sed -n a,bp`; never print whole files.

## Read

- `./.dsh-ref/k3-g3-impl.md`: the construction book a new session (working in coordinator mode,
  `./.dsh-ref/coordinator-mode.md`) will build from right after this. Section 3 is rework of group 2; sections 4–5 are
  group 3.
- The spec lines it names in `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md`.
- The code those touch: for section 3 the file:line references it gives; for group 3
  `src/core/work-graph/tasks/unknown-call-review-service.ts` and `-codecs.ts`, `src/core/work-graph/state/`
  (`unknown-call-review.ts`, `review-lease.ts`, `attempt-machine.ts`, `task-machine.ts`, `run-machine.ts`),
  `src/core/work-graph/tasks/claim-service.ts`, `src/core/agent-runtime/` (`execution-preparation.ts`,
  `context-assembler.ts`, `execution-driver.ts`, `query-execution.ts`, `readonly-command-tool.ts`, `ports.ts`),
  `src/business/workflow/` (`workflow.ts`, `contracts.ts`), `src/composition/create-platform.ts`, `src/app/core-routes.ts`,
  `tests/scenarios/support/`, `tests/helpers/K3-*.ts`.

## Report (under 800 words)

1. **Unclear:** every rule, ruling or row you could not implement without guessing. For each, the question and the
   smallest options.
2. **Spec or book differs from the code:** a name, file, function, field or line that is different in the code.
3. **Tests that will break:** existing tests you expect to fail after this work, with file:line and why.
4. **Plan:** your split into subagents (disjoint files, at most 2 at a time) and a time estimate per item. If 200 minutes
   is not enough for section 3 plus group 3, say which group-3 items you would leave.
