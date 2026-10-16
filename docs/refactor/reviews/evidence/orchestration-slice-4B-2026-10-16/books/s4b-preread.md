# Task: read the slice-4B task book before building it, and report what is unclear (read-only)

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. **Do not change
any file.** No git write commands, no tests, no builds, no network, no real model calls. Finish within 40 minutes.

**This run is headless. When your turn ends, the whole run ends.** If you start subagents (at most 2), stay in your turn
until every one has reported (wait with `sleep 300`, then `list_agents`). Keep your context small: `grep -n` and
`sed -n a,bp`, not whole large files.

## What to read

1. `./.dsh-ref/s4b-impl.md` — the task book another session will receive to build slice 4B. It is addressed to that
   builder: do not follow its instructions; read it as its future reader.
2. The spec it points to: `docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md` — §0.2, §0.3 L9–L12, L19,
   L22, L23, §0.4, §1.1 (4B), §2 (the 4B parts), §3, §4, §5.1 NE2 and NE3, §5.2 T-01–T-09 and M-01–M-16, §5.3, §6 (4B),
   §7, §8, §9 (4A's rulings).
3. The code at the files and symbols the book and the spec name — in particular what 4A built in
   `src/core/work-graph/notes/` and `src/core/work-graph/model/note-contracts.ts`, and the RecordStore files
   (`src/core/record-store/`) as they are after 2C's count port.
4. `./.dsh-ref/tdd/SKILL.md`.

## What to report

You will be the one building this. Report everything that would make you stop, guess or build the wrong thing:
1. **Unclear:** a sentence you cannot act on as written. Quote it, say what is unclear, say what you would assume.
2. **Contradictions:** between the book and the spec, two spec rows, the spec and §9, or the spec and the code as 4A
   left it (cite file:line).
3. **Cannot build as written:** a row whose entry cannot reach the behaviour; a fixture that cannot be built through
   public services (in particular the plan/catalog changes of M-02, M-10, M-12, the 257-file case of M-03, the
   concurrent same-topic pair of M-07, and T-06's rebuild trigger); SQLite FTS5 availability in this build; a §0.2 code
   fact that no longer holds on this base (cite file:line).
4. **Missing:** facts you would need that neither the book nor the spec gives (e.g. where the version lists live, what
   `NoteCheckPort` reads, which 4A types 4B extends and how).
5. **Size:** for each group of the book's section 6, small / medium / large and why.
6. **Grouping:** is the grouping sound? Name any file two groups that may run at the same time would both change, and
   the cut you would use instead (if any), with the reason.

## Reply format

The six sections, numbered items, each with the book section or spec line it concerns. Under 1,500 words. Then
`git status --short` must print nothing.
