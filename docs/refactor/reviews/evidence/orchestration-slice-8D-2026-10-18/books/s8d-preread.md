# Task: read-through before slice 8D (no code changes)

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. **Do not change
any file** (no code, no tests, no docs); no git writes; no tests; no builds; no network; no real model calls.
Throw-away notes go under `./.dsh-scratch/` and are deleted at the end. You may run the two analyzer scripts by hand on
a tiny throw-away workspace under `./.dsh-scratch/` to see whether libclang and the Python analyzers package work in
your environment. Finish within 25 minutes.

**This run is headless. When your turn ends, the whole run ends.** Do not start subagents. Keep your context small:
`grep -n`, `sed -n a,bp`; never print whole files.

## Read

- `./.dsh-ref/s8d-impl.md`: the construction book a new session (coordinator mode) will build from right after this.
- `./.dsh-ref/s8d-facts.md`: code facts Codex checked on this copy (Chinese).
- `./.dsh-ref/s8a-final.md` and the 8A rework replies (skim: what 8A built).
- The spec lines the book names in `docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md` (L12, L13, §2's
  provider interface and `LanguageCoverageV1`, §5.2 A-06, §5.3, §9).
- The code: `src/core/architecture/` (the provider interface, `capture.ts`, `architecture-inspection.ts`, the formal
  comparison), `src/core/workspace/cpp-source-index.ts`, `python-source-index.ts`, `scripts/cpp-source-query.py`,
  `scripts/python-source-query.py`, `runtime-assets.json`, and the tests the book names.

## Report (under 800 words)

1. **Unclear:** every rule, ruling or row you could not implement without guessing; the question and the smallest
   options.
2. **Book, spec or facts file differs from the code:** a name, file, function, field or line that is different.
3. **Environment:** whether libclang (`/usr/lib/llvm-18/lib/libclang.so.1`), `/usr/bin/python3` and the analyzers
   package work in your environment (what you ran, what came back), and what A-06's cases need that you lack.
4. **Tests that will break:** existing tests you expect to fail after this work beyond the ones the book names, with
   file:line and why.
5. **Plan:** your split into subagents (disjoint files) and a time estimate per item; production line estimate.
