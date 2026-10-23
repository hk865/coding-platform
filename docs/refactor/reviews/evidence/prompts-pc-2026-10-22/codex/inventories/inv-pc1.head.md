# Inventory for the PC-1 task book: Kernel patch, freezing, records, deletion, thinking

## Answer

1. **The Kernel patch mechanism.** How `scripts/build-kernel-patch.mjs` works today: the list of managed files, how
   a managed source is restored from the frozen source map, how `dist` is regenerated and checked, what the build
   and `check:architecture` verify, and what earlier patches did (the K slice's evidence). Exactly what adding
   `core/context/selection_policy/context-selection-policy.ts` to the list takes, and whether its source map restores
   cleanly. For each file in spec §4's "Kernel 补丁" list: the current lines that P3, P4 and P5 change (the selection
   call, history/current split F8, the hook re-check F10, base prompt and Skill loading at start and at resume F3,
   `onConfiguration` F4, the public exports F22), and the Kernel's own tests or types that pin them.
2. **Deletion (P3), step by step.** For each of the seven steps and the five protected items: the data the runner
   has at that point to tell them apart (how "this run's task input" = this run's first user message is found from
   F8's split; tool results and their status; assistant messages without tool calls; unclosed calls), and the
   current selection-policy code that does the nearest thing (`file:line` in the restored source or `dist`). The
   preview hook: where the run's `ModelBudget` is (`model-budget.ts`), how the request is turned into the final one
   today (`responseFormat`, output cap, Host `systemInstruction` in `observed-model-run.ts`), what has to move so the
   preview sees exactly the request that will be sent, and how an async counter fits the runner's loop. The
   `onContextSelected` report: where the platform receives it and joins it to the request record by `requestId`.
3. **Thinking (P4).** Where in the runner the outgoing copy is built, the message shapes (thinking, text, tool calls),
   and how both adapters serialise them (F11), so stripping touches only the outgoing copy.
4. **Freezing (P5).** The Work and Query preparation flows on this tree (`execution-preparation.ts`,
   `query-preparation.ts`): where the manifest is built, digested and stored (`bodies.put`), where a `PromptSetV1`
   goes and what must be stored before the manifest; the Skill selection code (`runtime-configuration.ts`,
   `PLATFORM_SKILL_RESOURCE_ROOT`, the file loader) and how "platform root" is recognised; how start and resume pass
   things to the Kernel today (`execution-driver.ts`, `query-execution.ts`, `observed-model-run.ts`) and where
   `baseSystemPrompt`, `skills` and `reasoningReplay` would enter; the configuration-mismatch checks (F19) and the
   settings pinning (`host-settings.ts`); the continuation-brief re-render at entry (`execution-entry-service.ts`)
   and what it reads today.
5. **Request records (P5).** Work (`model-call-access.ts`, `model-call-service.ts`, `model-request-codecs.ts`, the
   permit's two projections, events, replay and idempotency fingerprints) and Query (`queries/query-execution.ts`,
   `contracts/query-job.ts`, the usage update that rewrites the record): where each new field goes, what makes a
   field "immutable" in each, and the existing idempotency-conflict path. `toolSpecsRef`: where the Kernel reports
   its configuration and tool specs, the shared request wrapper where "wait for the store before the first
   `beforeCall`" fits, and where `unavailable` failures are raised today. `readPromptRecord`: which Runtime owner
   should hold it and the nearest existing read method to copy.
6. **Pack pieces PC-1 needs.** Whether PC-1 can freeze and pass a `base` template and the platform Skills before
   PC-2 changes them: today's `coding-agent-v5` text (F1) and `resources/skills/platform-*` (F21), how they would
   enter the pack (pack v2 entries, `runtime-assets.json`, the generator), and whether moving them byte-for-byte
   first (sent bytes unchanged) is possible. Propose the boundary with PC-2 (who adds `base`, who removes the
   `check` line and adds tool blocks, who owns `PromptSetV1.sectionOrder` and `packId` before pack selection exists).
7. **Tests and fixtures.** For PE3–PE7 and the PC-1 rows of §3.2 (PC-06…PC-17): the existing harness to use
   (`file:line`: Work and Query execution fixtures with a scripted fake model, the Kernel's `runCodingAgent` with a
   scripted provider, `RuntimeRunner`, each adapter's existing tests), what fixture is missing for each row, and how
   each expected value can be hand-computed. Re-check §3.3's list for the PC-1 rows on this tree (lines moved?
   files gone? anything missing, by the spec's grep commands).
8. **Size and grouping.** Added+deleted lines per sub-part (Kernel patch, freezing, records, deletion, thinking,
   tests); groups of 600–1,200 lines in which no two groups edit the same file, their order and the interface each
   earlier group must freeze for later ones; files PC-2 also touches.

End with a list of every point where the spec does not match this tree or leaves a choice open (with your
proposal), and one last line: `PC-1 估计：加 n、删 n`.
