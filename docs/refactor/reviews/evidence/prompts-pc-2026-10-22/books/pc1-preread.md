# Task: read-through before PC-1 (Kernel patch, freezing, request records, deletion, thinking; no code changes)

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
  §0.2 (facts F1–F22, checked on an older tree: re-locate them); §0.3 **P2** (only what is frozen at preparation and
  checked at start), **P3**, **P4**, **P5**, P9's first two bullets; §1; §2; §3.1 PE3–PE7; §3.2 **PC-06…PC-17**; §3.3
  (the request-record and platform-Skill bullets); §4; §5; §6. PC-1 is §5's first part: Kernel patch, freezing,
  records, deletion, thinking. PC-2 (pack editing, selection, section order, the stale-files reminder, tool
  declarations) is another run.
- The structure round's evidence `docs/refactor/reviews/evidence/structure-round-2026-10-21/README.md` (what D3 and D2
  built: `src/contracts/prompts/`, `resources/prompts/platform/`, `src/core/agent-runtime/context-*`,
  `tool-group-assembly.ts`). Decision 79 (`docs/refactor/HANDOFF.md`, top): no reading of old data formats.
- The test rule `./.dsh-ref/coordinator-mode.md` ("How tests reach their state: no hand-written facts", with "A name
  does not change what it is"): the construction tests reach every state through public steps.
- Code: `vendor/coding-agent/patches/` (the managed sources) and `scripts/build-kernel-patch.mjs`; in
  `vendor/coding-agent/dist`, the selection policy, the context builder, the runtime runner, the two provider
  adapters, the system prompt and the Skill loader (read only; never edit `dist`); `src/core/agent-runtime/`
  (`observed-model-run.ts`, `model-budget.ts`, `model-call-access.ts`, `execution-preparation.ts`,
  `query-preparation.ts`, `execution-driver.ts`, `query-execution.ts`); `src/core/work-graph/tasks/`
  (`model-call-service.ts`, `model-request-codecs.ts`, `execution-entry-service.ts`);
  `src/core/work-graph/queries/query-execution.ts`; `src/contracts/query-job.ts`; `src/app/runtime-configuration.ts`,
  `src/app/host-settings*.ts`; the Kernel tests and the Work/Query execution tests with their fixtures.

## Report (under 1,500 words; file:line for every code fact)

1. **Reuse map.** For each part of PC-1 the existing code to build on, with file:line:
   (a) the Kernel patch: how a managed file is added and `dist` regenerated; the lines of the runner, composition
   root, resume composition, contracts and public API that change;
   (b) deletion: what the runner knows to mark this run's first user message, the latest user message, unclosed calls,
   tool results by status, assistant messages without tool calls; where the preview (the run's `ModelBudget`) and the
   report (`onContextSelected`) attach;
   (c) thinking: where the outgoing copy is built;
   (d) freezing: where `PromptSetV1` enters the Work and Query manifests and what is stored before; Skill selection
   and how "platform root" is recognised; how start and resume pass the base prompt and Skills; the configuration
   mismatch checks;
   (e) records: the Work permit's two projections, events, replay and idempotency fingerprints; the Query request
   record and its usage update; where `toolSpecsRef` is stored and awaited; the nearest read method for
   `readPromptRecord`.
2. **Unclear:** every rule or row you could not implement without guessing; the question and the smallest options.
   In particular: where Host additional instructions join the base prompt so the preview counts them; what PC-1
   freezes as `base` and Skills before PC-2 changes the pack (today's `coding-agent-v5` text and
   `resources/skills/platform-*` moved byte-for-byte, or something else); how an async counter fits the runner; how
   the "this run's task input" boundary survives resume.
3. **Spec differs from the code:** a name, file, function, field or line that is different from what the spec cites.
4. **Tests that will break:** existing tests you expect to fail (beyond §3.3's list), with file:line and why.
5. **Plan:** a split into subagents with disjoint files, a time estimate per part, and the production line estimate.
