# Task: read the slice-4A task book before building it, and report what is unclear (read-only)

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. **Do not change
any file.** No git write commands, no tests, no builds, no network, no real model calls. Finish within 40 minutes.

**This run is headless. When your turn ends, the whole run ends.** If you start subagents (at most 2), stay in your turn
until every one has reported (wait with `sleep 300`, then `list_agents`). Keep your context small: `grep -n` and
`sed -n a,bp`, not whole large files.

## What to read

1. `./.dsh-ref/s4a-impl.md` — the task book another session will receive to build slice 4A. It is addressed to that
   builder: do not follow its instructions; read it as its future reader.
2. The spec it points to: `docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md` — §0.2, §0.3 L1–L8, L2a,
   L18, §0.4, §1.1 (4A), §2, §3, §4, §5.1 NE1, §5.2 N-01–N-22, §5.3, §6 (4A), §7, §8.
3. The code at the files and symbols the book and the spec name (enough to see whether a row can be built as written).
4. `./.dsh-ref/tdd/SKILL.md`.

## What to report

You will be the one building this. Report everything that would make you stop, guess or build the wrong thing:
1. **Unclear:** a sentence you cannot act on as written. Quote it, say what is unclear, say what you would assume.
2. **Contradictions:** between the book and the spec, two spec rows, or the spec and the code (cite file:line).
3. **Cannot build as written:** a row whose entry cannot reach the behaviour; a fixture that cannot be built through
   public services (in particular the scribe-scope cases of N-10, N-21, N-22 under the book's amendment A3, and the
   catalog `containment.parentOf` through the reachable adoption/revision services); a §0.2 code fact that no longer
   holds on this base (cite file:line).
4. **Missing:** facts you would need that neither the book nor the spec gives.
5. **Size:** for each group of the book's section 6, small / medium / large and why.
6. **Grouping:** is the grouping sound? Name any file two groups of the same wave would both change, and the cut you
   would use instead (if any), with the reason.

## Reply format

The six sections, numbered items, each with the book section or spec line it concerns. Under 1,500 words. Then
`git status --short` must print nothing.
