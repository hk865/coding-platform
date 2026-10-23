# Task: read-through before PC-2 (pack editing and selection, section order, stale-files reminder, tool declarations; no code changes)

You are working in a copy of a TypeScript repository (the current directory): the lead branch at `dc462a95` (the
structure round before 6A merged; tag `pc-base`). This is a NEW session. **Do not change any file** (no code, no
tests, no docs); no git writes; no tests; no builds; no network; no real model calls. Throw-away notes go under
`./.dsh-scratch/`; delete it (the directory itself too) at the end. Finish within 45 minutes.

**This run is headless. When your turn ends, the whole run ends.** Do not start subagents. Keep your context small:
`grep -n`, `sed -n a,bp`; never print whole files.

A construction book will be written from your report, and it must name, for every item, the existing code to reuse
(file:line). Your main job is to find that code and say where the spec and the code do not meet.

## Read

- The spec `docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md`: the post-notes at the top;
  §0.2 (facts F1–F22, checked on an older tree: re-locate them); §0.3 **P1**, **P2**, P5's freezing of the pack and
  the entry re-render, **P8**, **P9**, **P10**; §1; §2; §3.1 PE1, PE2, PE8, PE9; §3.2 **PC-01…PC-05, PC-18…PC-23**;
  §3.3 (the brief-sentence, section-order and review-shrink bullets); §4; §5; §6. PC-2 is §5's second part: pack
  editing, pack selection, section order, the stale-files reminder, tool declarations. PC-1 (Kernel patch, freezing,
  records, deletion, thinking) is another run.
- The structure round's evidence `docs/refactor/reviews/evidence/structure-round-2026-10-21/README.md` (what D3 and D2
  built: `src/contracts/prompts/`, `resources/prompts/platform/`, `scripts/build-platform-prompts.mjs`,
  `src/core/agent-runtime/context-*`, `tool-group-assembly.ts`). Decision 79 (`docs/refactor/HANDOFF.md`, top).
- The test rule `./.dsh-ref/coordinator-mode.md` ("How tests reach their state: no hand-written facts", with "A name
  does not change what it is").
- Code: `src/contracts/prompts/`, `resources/prompts/platform/`, `scripts/build-platform-prompts.mjs`,
  `scripts/check-boundaries.mjs`, `runtime-assets.json`; `src/core/agent-runtime/context-*` and
  `execution-preparation.ts`, `query-preparation.ts`, `tool-group-assembly.ts`; `src/core/work-graph/state/context-input.ts`;
  `src/core/work-graph/tasks/execution-entry-service.ts`; `src/contracts/continuation-brief.ts`; `src/app/` (`main.ts`,
  `host.ts`, `host-settings*.ts`, `core-routes.ts` and the settings routes, `runtime-configuration.ts`); the context,
  state-guard, entry and Host settings tests with their fixtures.

## Report (under 1,500 words; file:line for every code fact)

1. **Reuse map.** For each part of PC-2 the existing code to build on, with file:line:
   (a) the user pack directory under the Host data directory, and the two realpath checks (start-up; opening a
   workspace);
   (b) resolving a user pack from disk with `extends` over the generated platform pack, validation (what D3 already
   checks), and where preparation reads it;
   (c) the editing routes (the nearest settings route to copy, person-only access, `revision_conflict`, `forbidden`,
   file writes);
   (d) the settings model item's two new fields and how they reach preparation;
   (e) section order: the templates and slot tables, the rendering's ranges and budget order, the state guard's fixed
   order and "last section" checks, the entry's brief re-render, the binding type, the review shrink in preparation;
   (f) the stale-files reminder: where each run knows it took Session history, where the role section ends, where the
   brief's sentence is now;
   (g) tool declarations: `mentionsTools`, the final tool list per run, where preparation checks it.
2. **Unclear:** every rule or row you could not implement without guessing; the question and the smallest options.
   In particular: whether user packs are read synchronously during preparation and cached; how PC-2 depends on what
   PC-1 freezes (`packId`, `sectionOrder`, the `base` template); what the `base` template's four tool-list cases render.
3. **Spec differs from the code:** a name, file, function, field or line that is different from what the spec cites.
4. **Tests that will break:** existing tests you expect to fail (beyond §3.3's list), with file:line and why.
5. **Plan:** a split into subagents with disjoint files, a time estimate per part, and the production line estimate.
