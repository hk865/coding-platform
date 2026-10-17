# Task: read-through before the §10 segment of slice 8 (no code changes)

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. **Do not change
any file** (no code, no tests, no docs); no git writes; no tests; no builds; no network; no real model calls.
Throw-away notes go under `./.dsh-scratch/`; delete it (the directory itself too) at the end. Finish within 35 minutes.

**This run is headless. When your turn ends, the whole run ends.** Do not start subagents. Keep your context small:
`grep -n`, `sed -n a,bp`; never print whole files.

## Read

- `./.dsh-ref/s8a-scale-impl.md`: the construction book a new session (coordinator mode,
  `./.dsh-ref/coordinator-mode.md`, including its new section on hand-written facts) will build from right after this.
- The spec: `docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md`: the post-notes on decisions 77 and
  78, §10 whole, §11 (the 〔§10 段〕 parts; skim 〔8D 返工〕 only to know what is built), L12 and §9.
- What the 8D rework built: `./.dsh-ref/s8d-rework-impl.md` and the replies `./.dsh-ref/s8d-rework1-final.md`,
  `s8d-rework2-final.md`, `s8d-rework3-final.md`; `git diff slice-base s8d-rw3 --stat`.
- The code §10 touches: `src/core/workspace/{access.ts, capture.ts, architecture-language-provider.ts,
  workspace-tools.ts, git-read.ts}`, `src/core/workspace/typescript-source-query.ts` (`configure`),
  `src/core/work-graph/architecture/{architecture-service.ts, architecture-record-codecs.ts, architecture-source.ts,
  file-graph-index.ts, graph-index.ts, formal-comparison.ts}`, `src/contracts/architecture-source.ts`,
  `src/contracts/architecture-inspection.ts`, `create-platform.ts`, the S8A/S8D/R3d tests and their fixtures.

## Report (under 1,000 words)

1. **Unclear:** every rule or row you could not implement without guessing; the question and the smallest options.
   In particular: where the observation's material is enumerated today and how the git process layer can be reused
   without its root check; where the module body, the compact snapshot and the file-layer chunks are encoded and
   decoded today (v1), and what a v2 next to v1 needs; how the capture hands the TS analysis to both layers today and
   where the file layer builds its second provider; how the fault hook reaches the capture (precedent `fileGraph`).
2. **Book or spec differs from the code:** a name, file, function, field or line that is different from what §10 or
   §11 cites (the spec's line numbers were taken on the 8A tree; the 8D rework moved some).
3. **The A-16 / "旧记录" fixture:** can the old code at `slice-setup` be run from `./.dsh-scratch/old/` (from
   `git archive slice-setup`) with this copy's `node_modules`, through which public entry, and what goes into
   `tests/fixtures/s8-observation-v1/`? Say what blocks it if anything does.
4. **Tests that will break:** existing tests you expect to fail beyond §10 item 8's list, with file:line and why.
5. **Plan:** your split into subagents (disjoint files; as many at once as the work allows), a time estimate per item,
   and the production line estimate.
