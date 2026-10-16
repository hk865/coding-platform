# Task: read-through before slice 4C-1 (no code changes)

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. **Do not change
any file** (no code, no tests, no docs); no git writes; no tests; no builds; no network; no real model calls.
Throw-away notes go under `./.dsh-scratch/` and are deleted at the end. Finish within 25 minutes.

**This run is headless. When your turn ends, the whole run ends.** Do not start subagents. Keep your context small:
`grep -n`, `sed -n a,bp`.

## Read

- `./.dsh-ref/s4c1-impl.md`: the construction book you (a new session) will build from right after this.
- The parts of `docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md` it names: **§11 first** (it
  overrides earlier sections), then L13–L15, L19, L21, §2 (tool and route shapes), §5.2 rows G-01–G-05, R-01–R-03, and
  the §11.8 rows the book assigns to 4C-1.
- The lead's fact reports `./.dsh-ref/facts-*.md`. They were written before speed round 1 changed
  `note-read-model.ts`, so their line numbers may be off.
- The code those touch: `src/core/work-graph/notes/`, `src/core/work-graph/state/note-machine.ts`,
  `src/core/work-graph/views/` (note-views, node-detail-reader), `src/core/agent-runtime/` (graph-tools,
  execution-driver, query-execution), `src/composition/create-platform.ts`, `src/app/core-routes.ts`,
  `src/app/core-http-types.ts`, `src/ui/api/routes.ts`, the tests the book allows to change (section 3), and
  `tests/helpers/S4*` fixtures.

## Report (under 700 words)

1. **Unclear:** every ruling or row of 4C-1 you could not implement without guessing. For each, the question and the
   smallest options.
2. **Spec or facts differ from the code:** a name, file, function, field or line that the spec, the book or a fact
   report cites and that is different in the code.
3. **Tests that will break:** existing tests you expect to fail after 4C-1 that the book's section 3 does not list,
   with file:line and why.
4. **Plan:** your order, what you would give a subagent, and your time estimate per group. If 170 minutes is not
   enough, say which items you would leave.
