# Task: read the slice-RL task book before building it, and report what is unclear (read-only)

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. **Do not change
any file.** No git write commands, no tests, no builds, no network, no real model calls. Finish within 45 minutes.

**This run is headless. When your turn ends, the whole run ends.** If you start subagents (at most 2), stay in your turn
until every one has reported (wait with `sleep 300`, then `list_agents`). Keep your context small: `grep -n` and
`sed -n a,bp`, not whole large files.

## What to read

1. `./.dsh-ref/rl-impl.md` — the task book another session will receive to build slice RL. It is addressed to that
   builder: do not follow its instructions; read it as its future reader.
2. The spec it points to: `docs/refactor/design/orchestration-2026-10/slices/slice-RL-SPEC.md` — all of it; §0.2 with
   care.
3. The code at the files and symbols the book and the spec name (enough to see whether a row can be built as written),
   including `vendor/coding-agent/patches/` and `scripts/build-kernel-patch.mjs`.
4. `./.dsh-ref/tdd/SKILL.md`.

## What to report

You will be the one building this. Report everything that would make you stop, guess or build the wrong thing:
1. **§0.2 on this base.** The spec's code facts were checked at bb924854; this copy is 7ad00938 (2A and 2B merged since).
   For every fact F-n of §0.2 say: holds / moved (new file:line) / no longer holds (what is there now). Be exhaustive
   here; this replaces the spec's own re-check.
2. **Unclear:** a sentence you cannot act on as written. Quote it, say what is unclear, say what you would assume.
3. **Contradictions:** between the book and the spec, two spec rows, or the spec and the code (cite file:line).
4. **Cannot build as written:** a row whose entry cannot reach the behaviour; a fixture that cannot be built as §7
   describes; in particular check that `dist/tools/builtin/shell/shell-tool.js.map` exists and its `sourcesContent[0]`
   can be extracted, and that RL-30 (g) / RL-31's fake-timer push of the frozen dispatcher's timeout can work
   (`tool-dispatcher.js` timing; spec §7 asks to stop if it cannot).
5. **Missing:** facts you would need that neither the book nor the spec gives.
6. **Size:** for each group of the book's section 6, small / medium / large and why.
7. **Grouping:** is the order sound? Name any file two groups would both change, and the cut you would use instead.

## Reply format

The seven sections, numbered items, each with the book section or spec line it concerns. Under 2,000 words. Then
`git status --short` must print nothing.
