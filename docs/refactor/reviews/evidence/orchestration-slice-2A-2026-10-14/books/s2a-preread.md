# Task: read the slice-2A task book before building it, and report what is unclear (read-only)

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. **Do not change
any file.** No git write commands, no tests, no builds, no network, no real model calls. Finish within 40 minutes.

**This run is headless. When your turn ends, the whole run ends.** If you start subagents, stay in your turn until
every one has reported (wait with `sleep 300`, then `list_agents`).

## What to read

1. `./.dsh-ref/s2a-impl.md` — the task book another session will receive to build slice 2A. It is addressed to that
   builder, not to you: do not follow its instructions; read it as its future reader.
2. The spec it points to: `docs/refactor/design/orchestration-2026-10/slices/slice-2A-SPEC.md` (§0.3, §0.4, §1, §2, §4,
   §5, §6, §7, §8).
3. The code at the files and symbols the book and the spec name (enough to see whether a row can be built as written).
4. `./.dsh-ref/tdd/SKILL.md`.

## What to report

You will be the one building this. Report everything that would make you stop, guess or build the wrong thing:
1. **Unclear:** a sentence in the book or the spec you cannot act on as written. Quote it, say what is unclear, and say
   what you would assume.
2. **Contradictions:** between the book and the spec, between two spec rows, or between the spec and the code (cite
   file:line).
3. **Cannot build as written:** a row whose entry cannot reach the behaviour, a fixture that cannot be built through
   public services, a bound in §0.4 that is not where the book says.
4. **Missing:** facts you would need that neither the book nor the spec gives (for example an exported helper you would
   have to create, or a test timeout).
5. **Size:** for each group of the book's section 6, your estimate of the work (small / medium / large) and why.

## Reply format

Reply with these five sections, numbered items, each with the book section or spec line it concerns. Keep it under
1,200 words. Then `git status --short` must print nothing.
