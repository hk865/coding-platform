# Task: read-through before slice 8A (no code changes)

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. **Do not change
any file** (no code, no tests, no docs); no git writes; no tests; no builds; no network; no real model calls.
Throw-away notes go under `./.dsh-scratch/` and are deleted at the end. Finish within 25 minutes.

**This run is headless. When your turn ends, the whole run ends.** Do not start subagents. Keep your context small:
`grep -n`, `sed -n a,bp`; never print whole files.

## Read

- `./.dsh-ref/s8a-impl.md`: the construction book a new session (coordinator mode, `./.dsh-ref/coordinator-mode.md`,
  at most 3 subagents at once) will build from right after this.
- `./.dsh-ref/s8a-facts.md`: code facts Codex rechecked before 4C-1 merged (line numbers may have moved).
- The spec lines the book names in `docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md`, **post-notes at
  its top first**.
- The code those touch: `src/core/workspace/` (capture, `project-source-snapshot.ts`, `TypeScriptSourceAnalyzer`),
  `src/core/work-graph/architecture/` (all), `src/contracts/architecture-source.ts`,
  `src/core/work-graph/notes/note-path-ownership.ts` and its callers, `src/core/work-graph/views/graph-index.ts`,
  `src/core/work-graph/notes/note-version-lists.ts`, `src/app/core-routes.ts`, `src/app/core-http-types.ts`,
  `src/ui/api/routes.ts`, and the tests the book's item 10 names.

## Report (under 800 words)

1. **Unclear:** every rule, ruling or row you could not implement without guessing; the question and the smallest
   options.
2. **Spec, book or facts file differs from the code:** a name, file, function, field or line that is different now
   (4C-1 merged after the facts were taken).
3. **Tests that will break:** existing tests you expect to fail after this work beyond the ones item 10 names, with
   file:line and why.
4. **Plan:** your split into subagents (disjoint files, at most 3 at a time) and a time estimate per item. If 200
   minutes is not enough, say which items you would leave.
