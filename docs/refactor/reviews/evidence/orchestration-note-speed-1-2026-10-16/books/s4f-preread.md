# Task: read-through before the note-search speed round (no code changes)

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. **Do not change
any file** (no code, no tests, no docs); no git writes; no tests; no builds; no network; no real model calls.
Throw-away notes go under `./.dsh-scratch/` and are deleted at the end. Finish within 25 minutes.

**This run is headless. When your turn ends, the whole run ends.** Do not start subagents. Keep your context small:
`grep -n`, `sed -n a,bp`.

## Read

- `./.dsh-ref/s4f-impl.md`: the construction book you (a new session) will build from right after this. Sections 3–6
  are binding.
- The code it names: `src/core/record-store/` (`lookup-ports.ts`, `lookup-index.ts`, `in-memory-record-store.ts`,
  `sqlite-record-store.ts`, `sqlite-text-search.ts`), `src/core/work-graph/notes/note-read-model.ts`,
  `src/core/work-graph/views/note-views.ts`, `src/core/work-graph/model/note-contracts.ts`,
  `src/composition/create-platform.ts` (the note and RecordStore wiring only), and the tests the book names in sections
  3 and 5.

## Report (under 700 words)

1. **Unclear:** every ruling (S1.1 … S3.3) you could not implement without guessing. For each, the question and the
   smallest options.
2. **Code differs from the book:** a name, file, option, test or line the book cites that is different in the code.
3. **Tests that will break:** existing tests outside section 3's allowed list that you expect to fail after the rulings,
   with file:line and why.
4. **Plan:** your cut into G1, G2 and G3, what you would give a subagent, and your time estimate per group. If 150
   minutes is not enough, say which items you would leave for a second round.
