# Task: read-through before the 8D rework (no code changes)

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. **Do not change
any file** (no code, no tests, no docs); no git writes; no tests; no builds; no network; no real model calls.
Throw-away notes go under `./.dsh-scratch/` and are deleted at the end. You may run the prototypes in `./.dsh-ref/proto/`
on fixtures you write under `./.dsh-scratch/` (read-only towards the repository). Finish within 30 minutes.

**This run is headless. When your turn ends, the whole run ends.** Do not start subagents. Keep your context small:
`grep -n`, `sed -n a,bp`; never print whole files.

## Read

- `./.dsh-ref/s8d-rework-impl.md`: the construction book a new session (coordinator mode,
  `./.dsh-ref/coordinator-mode.md`) will build from right after this.
- The spec: `docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md`, the post-note "决定 78" and §11
  (the 〔8D 返工〕 bullets; skim 〔§10 段〕 only to know what is out of scope).
- The first build: `./.dsh-ref/s8d-impl.md`, `./.dsh-ref/s8d-final-1.md`, `./.dsh-ref/verify-s8d.out.md`, and the code
  it changed (`git diff slice-setup s8d-1r --stat`).
- The code §11 touches: `scripts/python-source-query.py`, `scripts/cpp-source-query.py`,
  `src/core/workspace/{capture.ts, architecture-language-provider.ts, cpp-source-index.ts, python-source-index.ts,
  workspace-tools.ts}`, `src/core/agent-runtime/exploration-tools.ts`, the coverage contract and its codec,
  `create-platform.ts` (`sourceAnalyzers`), `runtime-assets.json`, the S8A/S8D tests.

## Report (under 900 words)

1. **Unclear:** every rule or row you could not implement without guessing; the question and the smallest options.
   In particular: where the coverage type and its record codec live and how `notes` enters them; how the capture hands
   `skipped` to providers today; how the runner reaches `pythonPath`, `cppLibraryPath` and the two timeouts.
2. **Spec differs from the code:** a name, file, function, field or line that is different from what §11 cites.
3. **Tests that will break:** existing tests you expect to fail beyond §11.6's fate list, with file:line and why.
4. **Prototype check:** copy `./.dsh-ref/proto/cpp/` to `./.dsh-scratch/proto-cpp/` (the runner writes `ws/` and
   `out/` beside itself), run `python3 -I ./.dsh-scratch/proto-cpp/run_fixtures.py` once, and say whether libclang 18
   loads and how many fixtures pass here (the book lists the two cases where the prototype predates the frozen spec).
5. **Plan:** your split into subagents (disjoint files; as many at once as the work allows), a time estimate per item,
   and the production line estimate.
