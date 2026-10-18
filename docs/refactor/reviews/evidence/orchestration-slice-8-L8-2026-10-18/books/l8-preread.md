# Task: read-through before slice 8's L8 (automatic capture, failure record, retry, the stale-architecture reminder; no code changes)

You are working in a copy of a TypeScript repository (the current directory): the lead branch with 8A, 4C-2, 8D and
the §10 segment merged. This is a NEW session. **Do not change any file** (no code, no tests, no docs); no git writes;
no tests; no builds; no network; no real model calls. Throw-away notes go under `./.dsh-scratch/`; delete it (the
directory itself too) at the end. Finish within 40 minutes.

**This run is headless. When your turn ends, the whole run ends.** Do not start subagents. Keep your context small:
`grep -n`, `sed -n a,bp`; never print whole files.

A construction book will be written from your report, and it must name, for every item, the existing code to reuse
(file:line). Your main job is to find that code and say where the spec and the code do not meet.

## Read

- The spec `docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md`: the header post-notes; §0.1 告知 5;
  §1 L7, **L8**, L12; §5.2 AE1 (the automatic-capture part), **AE2**, **A-03**, **A-04**; §9 (8A readings), §10, §11.5,
  §12 (8D and §10 readings, binding over earlier sections). Decision 79 (`docs/refactor/HANDOFF.md`, top): no reading
  of old data formats.
- The test rule `./.dsh-ref/coordinator-mode.md` ("How tests reach their state: no hand-written facts", with "A name
  does not change what it is"): the construction tests reach every state through public steps.
- Code: `src/core/work-graph/architecture/` (`architecture-service.ts`, `formal-comparison.ts`,
  `architecture-record-codecs.ts`, `file-graph-index.ts`, `graph-index.ts`), `src/core/workspace/capture.ts`,
  `src/contracts/architecture-inspection.ts`, `src/contracts/architecture-source.ts`, the execution preparation and its
  assembler (find `createExecutionPreparation`, the reminder section), Host start-up (`src/app/`,
  `src/composition/create-platform.ts`), the project/workspace registration entry, `architecture/adopt-initial`,
  `architecture/revise`, the formal check's PASS finalize writer, the settings page's manual capture route, and the
  S8A/S8D tests with their fixtures.

## Report (under 1,200 words; file:line for every code fact)

1. **Reuse map.** For each part of L8 the existing code to build on, with file:line:
   (a) the three triggers (workspace registered; formal adoption, initial and each revision; formal check PASS
   finalized): where each commit happens and where a capture could start after it without changing that writer's result
   or holding its transaction; any precedent for work started after a commit;
   (b) the failure record and the retry on the next Host start or the next trigger: where a failed capture is visible
   today, any record kind or start-up scan that is a precedent (for example the start-up scan of PASS-finalized rounds);
   (c) "no catalog yet → file layer only, module layer empty": what the capture does today without an adopted catalog;
   (d) the latest successful observation and the one before it by observation time: how observations are listed and
   ordered after §10, and whether each file carries a digest that "可能移动" can compare;
   (e) the four reminder kinds: what `formal-comparison.ts` (L7) already computes and what is missing (the task's
   module, "共享最长目录前缀");
   (f) the assembler's reminder section: where it is built, its line cap and ellipsis precedent, and any precedent for a
   relative time like "3 小时前的观测";
   (g) the manual capture button and its route.
2. **Unclear:** every rule or row you could not implement without guessing; the question and the smallest options. In
   particular: is a capture started by a trigger awaited by anyone or detached, and what does the caller of the trigger
   see; what the "failure record" is (a stored record, a field, a Host-local note) and who reads it; what happens when a
   trigger fires while a capture of the same workspace is running; how a large workspace's capture time (about 27 s on
   this repository after §10) fits the triggers; what "次" means for A-04's "各触发一次".
3. **Spec differs from the code:** a name, file, function, field or line that is different from what L8, AE2, A-03 or
   A-04 cites (the spec was written on the 8A tree; §10 and 8D moved things).
4. **Tests that will break:** existing tests you expect to fail when the triggers start capturing (for example tests
   that count captures, observations or Kernel/model calls after registration, adoption or a PASS), with file:line and
   why.
5. **Plan:** a split into subagents with disjoint files, a time estimate per part, and the production line estimate.
