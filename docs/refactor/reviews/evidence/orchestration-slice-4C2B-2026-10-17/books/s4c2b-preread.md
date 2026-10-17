# Task: read-through before slice 4C-2 session B (no code changes)

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. **Do not change
any file** (no code, no tests, no docs); no git writes; no tests; no builds; no network; no real model calls.
Throw-away notes go under `./.dsh-scratch/` and are deleted at the end. Finish within 25 minutes.

**This run is headless. When your turn ends, the whole run ends.** Do not start subagents. Keep your context small:
`grep -n`, `sed -n a,bp`; never print whole files.

## Read

- `./.dsh-ref/s4c2b-impl.md`: the construction book a new session (coordinator mode, `./.dsh-ref/coordinator-mode.md`,
  at most 3 subagents at once) will build from right after this.
- `./.dsh-ref/s4c2-facts.md`: code facts Codex rechecked on this branch (Chinese); `./.dsh-ref/reuse-rulings.md`
  (U3, U6, U7, U9).
- The spec lines the book names in `docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md` (§11 and §12
  first).
- This copy already has session A's code (the assembly, "update due", the scribe reminders; the agent's reply is
  `./.dsh-ref/s4c2a-final.md`). Session A is still under review; names may move a little before the build.
- The code those touch: `src/core/work-graph/communication/decision-application.ts`,
  `src/core/work-graph/communication/decision-source-facts.ts`, `src/business/workflow/decision-actions.ts`,
  `src/core/work-graph/views/decision-read-model.ts`, `src/core/work-graph/model/decision-contracts.ts`,
  `src/contracts/goal-decisions.ts`, `src/contracts/note.ts`, `src/core/work-graph/notes/note-service.ts`,
  `src/core/work-graph/state/note-machine.ts`, `src/core/work-graph/persistence/note-record-codecs.ts`,
  `src/core/work-graph/views/automatic-rework-notices.ts` (the ordered-lookup notice pattern),
  `src/core/work-graph/tasks/planning-question-reader.ts` (the assemble-once pattern),
  `src/core/work-graph/configuration/decision-settings-service.ts`, `src/composition/create-platform.ts`, and the tests
  section 3 of the book names.

## Report (under 800 words)

1. **Unclear:** every rule, ruling or row you could not implement without guessing; the question and the smallest
   options.
2. **Spec, book or facts file differs from the code:** a name, file, function, field or line that is different.
3. **Tests that will break:** existing tests you expect to fail after this work beyond the ones the book names, with
   file:line and why.
4. **Plan:** your split into subagents (disjoint files, at most 3 at a time) and a time estimate per item. If 200
   minutes is not enough, say which items you would leave.
