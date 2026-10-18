# Task: read-through before K3 group 4 session A (no code changes)

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. **Do not change
any file** (no code, no tests, no docs); no git writes; no tests; no builds; no network; no real model calls.
Throw-away notes go under `./.dsh-scratch/` and are deleted at the end. Finish within 25 minutes.

**This run is headless. When your turn ends, the whole run ends.** Do not start subagents. Keep your context small:
`grep -n`, `sed -n a,bp`; never print whole files.

## Read

- `./.dsh-ref/k3-g4a-impl.md`: the construction book a new session (coordinator mode, `./.dsh-ref/coordinator-mode.md`,
  at most 3 subagents at once) will build from right after this.
- `./.dsh-ref/k3g4-facts.md`: code facts Codex checked on this copy (Chinese).
- `./.dsh-ref/k3-g3a-final.md` … `k3-g3f-final.md` (what group 3 built and left; skim).
- The spec lines the book names in `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md` (L11, L12, L21,
  L22, L28, L29; §3.3–§3.5; the §5.2 rows in book section 3).
- The code those touch: `src/business/workflow/workflow.ts` (`selectNext`, the task gate, `gatePerform`),
  `src/core/work-graph/tasks/claim-service.ts`, `requeue-service.ts`, `unknown-call-review-service.ts`,
  `plan-readers.ts`, `plan-service.ts`, `task-failure.ts`, `src/core/work-graph/state/unknown-call-review.ts`,
  `run-machine.ts`, `execution-entry-service.ts`, `goal-decision-reader.ts`, `decision-policy.ts`, the start-up
  reconcile (`startup-reconcile.ts`), `src/app/core-routes.ts`, `src/composition/create-platform.ts`,
  `unknown-call-kinds.ts`, `tool-commit-lookup.ts`, and the tests book section 4 names.

## Report (under 900 words)

1. **Unclear:** every rule, ruling or row you could not implement without guessing; the question and the smallest
   options.
2. **Book, spec or facts file differs from the code:** a name, file, function, field or line that is different.
3. **Tests that will break:** existing tests you expect to fail after this work beyond the ones the book names, with
   file:line and why.
4. **A/B split:** any row assertion in book section 3 you think cannot be tested without a card, an answer or a proof
   event (then it is session B's), and any session-B piece you think session A cannot avoid.
5. **Plan:** your split into subagents (disjoint files, at most 3 at a time) and a time estimate per item. If 200
   minutes is not enough, say which items you would leave.
