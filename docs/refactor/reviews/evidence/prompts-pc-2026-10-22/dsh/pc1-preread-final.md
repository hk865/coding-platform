# PC-1 read-through: Kernel patch, freezing, records, deletion, thinking

## 1. Reuse map

### (a) Kernel patch (how a managed file is added / `dist` regenerated)

- Add `vendor/coding-agent/patches/core/context/selection_policy/context-selection-policy.ts`; register it in `scripts/build-kernel-patch.mjs:13` (`relativeSources`). The script derives the four artifacts at `:29`, copies `dist` to a temp tree at `:52`, and writes only under `--write` (`:100-102`); `--check` is the CI form (`:32`, `:106`). Never edit `dist`.
- Runner change points: `patches/core/runtime/loop/runtime-runner.ts:99` (`baseSystemPrompt`), `:102` (`skills`), history/current split `:664-687`, `selectContext` call `:686`, builder `:687`, hook re-measure `:714-718`.
- Composition: `app/composition/composition-root.ts:415-432` (skill loader, `onConfiguration` with `systemPromptVersion`/`skills`/`skillResourceRoot`), `:493-495` (fixed base + skills); `app/composition/resume-composition.ts:311-327`, `:406-408`.
- Contracts: `app/composition/composition-contracts.ts:24-36` (`AppRuntimeConfiguration`).
- Public API: `patches/public-api.ts:108-112` (`selectContext`), `:130` (`RuntimeRunner`); dist declaration lines `public-api.d.ts:33`, `:40`.

### (b) Deletion

- Runner knows the boundary: `history` vs `currentTranscript` at `runtime-runner.ts:666-670`; `withPresentations` at `:246-255`. `currentTranscript[0]` is this run’s task input; latest user message is found at `context-selection-policy.js:32`; exchange grouping and unclosed-call guard at `:30-64` (`expected.size === 0`).
- Status facts: `tool-executor-port.d.ts:70` (success), `:97` (error), `:138` (cancelled); assistant-without-calls type `run-state.d.ts:163-172`, validity rule `run-state.js:130-132`.
- Preview attaches to the run’s `ModelBudget`: class `model-budget.ts:39`, ctor `:49`, wrap/measure math `:78-95` (output reserve `:82`, input bytes/count `:86-87`, fits `:95`); created at `execution-driver.ts:842` and `query-execution.ts:363`. The report attaches at the existing `beforeCall` seam `observed-model-run.ts:245-247`; the new `onContextSelected` must be passed on the `runCodingAgent` call at `:288`. Note the order: `beforeCall` runs inside `meter.wrap` (`:253`), after `reservedOutput`/input are known, so `maxOutputTokens` can be read from the meter entry.

### (c) Thinking

- `reasoningContent` is copied into messages at `context-builder.js:74-75`, sent by DeepSeek at `deepseek-model-client.js:28`; OpenAI drops it (`openai-model-client.js:36-45`).
- Drop it on the `ContextBuilderInput.transcript` copy in `runtime-runner.ts:666-686`, before `selectContext`/`build`; Kernel state is untouched. The two outgoing copies (`model-budget.ts:85`, `observed-model-run.ts:257-259`) are too late for history thinking but are where Host additions live.

### (d) Freezing

- Work: config resolved at `execution-preparation.ts:372-377`, assembly at `:482-494`, manifest build `:519-558`, one body put `:561-571`, binding digest `:592-594`. Query: `query-preparation.ts:193-205`, manifest `:255-277`, body put `:278-289`.
- `PromptSetV1` belongs in `PreparedTaskManifestV1` (`prepared-execution.ts:195-242`) and `PreparedQueryManifestV1` (`:262-291`); body storage reuses the same `bodies.put` pattern (`execution-preparation.ts:177-185`).
- Template/slot machinery: `prompt-pack.ts:5-38`, `render-template.ts:186-213`, generated `PLATFORM_PROMPT_PACK_V1` (`platform-pack.generated.ts:4`), built/checked by `scripts/build-platform-prompts.mjs:13`, `:151`.
- Skills: selection at `composition-root.ts:415-422` / `resume:311-317`; platform root constant `runtime-configuration.ts:82`, bundle resolver `:373-381`; loader source/digest `file-skill-loader.js:78-90`.
- Start/resume pass base+skills at `composition-root.ts:493-495` / `resume:406-408`; Kernel call at `observed-model-run.ts:288-305`.
- Mismatch: `execution-driver.ts:572-575` (one path covers start and proof-backed resume); Query `agent-runtime/query-execution.ts:198-201`; pinning `host-settings.ts:230-237`.

### (e) Records

- Work: `ActualModelRequest` `model-call-contracts.ts:18-28`, permit `:43-57`; authorization projection `model-call-service.ts:144-150`; consumption projection `:250-252`; events `:152-159`, `:253-262`; replay `:280-301`; idempotency fingerprints `:112-113`, `:211-213`; strict keys `model-request-codecs.ts:83-95`, event decode `:145-160`.
- Query: `QueryModelUsageV1`/`QueryModelRequestV1` `query-job.ts:355-368`; admission `query-execution.ts:1388-1395`; usage rewrite `:1302-1313` (currently clones the whole row); codec `query-record-codecs.ts:355`.
- `toolSpecsRef`: capture synchronously in `onConfiguration` (`composition-root.ts:423-431` / `resume:318-326`), store with `bodies.put`, hold the promise, and await it before the first `beforeCall` (`observed-model-run.ts:245`).
- Nearest read method to `readPromptRecord`: `readContinuationBrief` — port `ports.ts:36-75`, implementation `runtime.ts:512-535`, route `core-routes.ts:442`, `:760`, `:1096`, route-name list `core-http-types.ts:166`.

## 2. Unclear (cannot implement without a decision)

1. **Where Host additional instructions join `base`.** Today appended after Kernel selection at `observed-model-run.ts:259`, so a preview cannot count them. Options: (i) merge at prepare into `PromptSetV1.base.text` and delete the append line (recommended; matches §2); (ii) pass as an `additionalInstruction` fragment (but P3 deletes additional instructions at step 3); (iii) keep the append and teach the preview to add it. Decide before PC-1.
2. **What PC-1 freezes as `base` and Skills.** Pack v1 has 10 templates, no `base`, and `PromptPackManifestV1` (`prompt-pack.ts:5-21`) has **no skills field**. Either (i) PC-1 adds `templates/base` = today’s `coding-agent-v5` byte-for-byte and freezes the five `resources/skills/platform-*` bodies via the loader, leaving P9 edits and the skill move to PC-2; or (ii) PC-1 already performs P9’s two base edits and moves skills into a new pack section, which changes emitted bytes and requires a format extension now. I recommend (i), but then `PromptSetV1.skills` has no pack source and P5’s “from the pack” is deferred.
3. **Async counter vs sync `selectContext`.** `ModelInputCounter.count` may return a Promise (`model-budget.ts:6`), and `wrap` already awaits (`:87`), but `selectContext` is synchronous (`context-selection-policy.js:92`). Options: add an async `selectContextWithPreview` used only when a preview is supplied, keeping `selectContext` for PE4; or pre-compute per-step estimates outside the selector. Recommend the former, with bisection over the seven removal steps.
4. **“This run’s task input” boundary across resume.** Start and resume pass `historyTranscript` separately (`composition-root.ts:499`, `resume-composition.ts:412`), and `state.transcript` is the current turn, so the boundary is `history.length` in `runtime-runner.ts:674-679`. Options: add optional `currentTurnStart` to `ContextBuilderInput`, or pass a protected `messageId` set. Runtime messages added by `inputSupply` are later current-turn users, so protect only the first current user message.
5. **Query usage update.** P5 says “usage fields only”. Today `recordQueryUsage` replaces whole rows (`query-execution.ts:1310`). Decide whether prompt facts are written at `admitRequest` (`:1388-1395`) and preserved by a 5-field merge, or carried on the usage entry.
6. **`requestDigest` meaning.** It currently hashes the pre-Host/pre-meter Kernel request (`observed-model-run.ts:246`). P5 adds `systemDigest`/`toolsDigest`; state explicitly whether `requestDigest` stays as-is or becomes the final outgoing digest.
7. **Work `maxOutputTokens` source.** It must be the same value the meter computes (`model-budget.ts:82`); extract that formula into a method so authority, record, and actual request cannot drift.

## 3. Spec differs from the code

- F2 cites `observed-model-run.ts:261-263`; actual `:257-259`.
- F3 cites `composition-root.ts:330, 415, 423`; actual `416, 419, 423` (and `resume:311, 318, 406`).
- F5/F6/F14 cite `context-assembler.ts:79`, `:93`, `:266-312`, `:1447`; that file is now 39 lines (`context-assembler.ts:27-39`). The code is in `context-work-recipe.ts:84-88`, `context-rendering.ts:94-167`/`:237-255`, `context-fact-text.ts:53-91`; LA-1 is `execution-driver.ts:679-689`.
- F9’s `:92` and `:154` are right, but `:30-66` is only the exchange-group function; the seven-step order is `:92-150`.
- F16’s Query line `:1400` is actually admission; the usage rewrite is `:1302-1313`.
- F19 cites `execution-driver.ts:631, :824`; actual `572-575` (one check for start and resume).
- F21 cites `runtime-configuration.ts:58`; that is the type, the constant is `:82`, the resolver `:373`.
- P5 says “about forty fixtures point at the platform root”; only 17 test files use repo `resources/skills` (40 including `vendor/coding-agent/resources/skills`).
- `main.ts:154-163` is `src/app/main.ts:154-163`.
- §4 omits that the pack format (`prompt-pack.ts`) has no place for `base` or Skills, though P5 requires both to be pack-resolved.

## 4. Tests that will break (beyond §3.3)

- `tests/kernel/B2-history-public-export.test.ts:247-256` rejects **any** new runtime export; a new exported `selectContextWithPreview` fails it. Keep new helpers unexported or update the whitelist.
- `tests/app/host-settings.test.ts:453`, `:706` use `resources/skills` with `platform-work`; deleting `resources/skills/platform-work` may break Host start/resolution. Not in §3.3.
- `tests/runtime/S4C2-assembly.test.ts:107`, `tests/runtime/K-readonly-command.test.ts:151`, `tests/helpers/C2-runtime-platform-fixture.ts:35`, `RL-query-fixture.ts:36`, `S2B-be1-platform-fixture.ts:62` still construct `FileSkillLoader` at `resources/skills`; they survive if only `platform-*` subdirectories move, fail if the root is removed.
- `tests/runtime/B2-runtime-execution.test.ts:85` expects `systemInstruction` inside `systemPrompt`; passes with the merge, fails if it becomes a removable additional instruction.
- `tests/kernel/R4a-frozen-public.test.ts:702` expects `[skill_instruction id="coding-safety"`; P3 keeps instruction Skills, so only a base-prompt move would break it.

## 5. Plan

- **S0 shared contracts (1 day):** `src/contracts/prompts/prompt-pack.ts` (base/skill form), `src/contracts/core/prepared-execution.ts` (`PromptSetV1`, `promptSet`), `src/contracts/graph-context.ts` (`sectionOrder`), `src/contracts/query-job.ts` (request facts). Blocks everything.
- **S1 Kernel (1.5 days):** patches `context-selection-policy.ts`, `runtime-runner.ts`, `composition-root.ts`, `resume-composition.ts`, `composition-contracts.ts`, `public-api.ts`, build script; tests PE4–PE7.
- **S2 Freeze/prepare (1.5 days):** `execution-preparation.ts`, `query-preparation.ts`, `context-rendering.ts`/`context-work-recipe.ts`, pack `base` + `scripts/build-platform-prompts.mjs`; tests PE3/PE8/PE9.
- **S3 Records (1 day):** `model-call-service.ts`, `model-request-codecs.ts`, `model-call-contracts.ts`, `queries/query-execution.ts`, `agent-runtime/query-execution.ts`, `observed-model-run.ts`, `model-budget.ts`, `ports.ts`, `runtime.ts`, `core-routes.ts`; PC-09/PC-10.
- **S4 close-out tests (1 day):** PE3–PE7 and PE9 through the real fixtures (`tests/helpers/B2-runtime-fixture.ts:171`, `WP2-platform-support.ts`, `RL-query-fixture.ts:66`).

Production ≈ 1,800–2,200 lines (Kernel 500–650, prepare/freeze 500–650, records 550–700, routes/types 200–300); tests ≈ 800–1,200. Serial 5 days, or 3 days with S1–S3 parallel after S0. Total PC-1 inside the spec’s 3,000–4,000-line PC estimate.