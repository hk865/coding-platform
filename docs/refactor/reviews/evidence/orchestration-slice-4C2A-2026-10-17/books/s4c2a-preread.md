# Task: read-through before slice 4C-2 session A (no code changes)

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. **Do not change
any file** (no code, no tests, no docs); no git writes; no tests; no builds; no network; no real model calls.
Throw-away notes go under `./.dsh-scratch/` and are deleted at the end. Finish within 25 minutes.

**This run is headless. When your turn ends, the whole run ends.** Do not start subagents. Keep your context small:
`grep -n`, `sed -n a,bp`; never print whole files.

## Read

- `./.dsh-ref/s4c2a-impl.md`: the construction book a new session (coordinator mode, `./.dsh-ref/coordinator-mode.md`,
  at most 3 subagents at once) will build from right after this.
- `./.dsh-ref/s4c2-facts.md`: code facts Codex rechecked on this branch (Chinese); `./.dsh-ref/reuse-rulings.md`
  (U8, U10).
- The spec lines the book names in `docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md` (§11 and §12
  first).
- The code those touch: `src/core/agent-runtime/context-assembler.ts`, `src/core/work-graph/views/context-extensions.ts`,
  `src/contracts/graph-context.ts`, `src/core/work-graph/state/context-input.ts`, `src/core/work-graph/views/note-views.ts`,
  `src/core/work-graph/notes/note-read-model.ts`, `src/core/work-graph/tasks/plan-readers.ts`,
  `src/core/work-graph/state/note-machine.ts`, `src/core/work-graph/model/note-contracts.ts`, `src/app/host.ts`,
  `src/composition/create-platform.ts`, and the tests section 3 of the book names.

## Report (under 800 words)

1. **Unclear:** every rule, ruling or row you could not implement without guessing; the question and the smallest
   options.
2. **Spec, book or facts file differs from the code:** a name, file, function, field or line that is different.
3. **Tests that will break:** existing tests you expect to fail after this work beyond the ones the book names, with
   file:line and why.
4. **Plan:** your split into subagents (disjoint files, at most 3 at a time) and a time estimate per item. If 200
   minutes is not enough, say which items you would leave.
