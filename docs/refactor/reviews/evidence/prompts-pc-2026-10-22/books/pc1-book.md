# Task: PC-1 — Kernel patch, freezing, request records, deletion and thinking (decision 83-4; lead, 2026-10-22, v3, frozen)

The prompts spec (`docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md`, frozen 10-21) is
built in two pieces:
- **PC-1** (this book) is the spec's §5 first part: the Kernel patch (P3 deletion, P4 thinking, P5's Kernel inputs),
  freezing (P5's `PromptSetV1`), the request records (P5) and their read.
- **PC-2** (another book) is pack editing and selection, section order, the stale-files reminder and tool
  declarations.

PC-1 is two nights:

| Run | Groups (§4) | Size (added + deleted, tests included) |
| --- | --- | --- |
| **PC-1a** | K (Kernel) ∥ C (contracts and pack pieces) | about 1,100 + 800 |
| **PC-1b** | P (preparation and entry) ∥ S (the send path) ∥ R (records and the read), then the joint rows | about 3,500 |

Each run has its own run sheet: time, base, scope, checks. This book binds both. The spec, this book and the lead's
rulings in §3 are binding. Do not make design decisions: report anything undetermined under UNSPECIFIED with the
smallest options.

## 1. What to read

- **The spec:**
  - the post-note at the top;
  - §0.2 F2–F4, F8–F12, F16–F19, F21, F22 (checked on an older tree; §3 below gives today's places);
  - §0.3 **P2** (only freezing and the start check), **P3**, **P4**, **P5**, and the first two bullets of P9;
  - §2; §3.1 PE3–PE7; §3.2 **PC-06…PC-17**;
  - §3.3: the platform-Skill and request-record bullets, and "查过、没有要改的";
  - §6.
- **Decision 79** (`docs/refactor/HANDOFF.md`, top): only the current record format is read. A changed record shape
  needs no migration; old databases are rebuilt.
- **The read-throughs and inventories** in `./.dsh-ref/`: `pc1-preread-final.md` (DSH), `inv-pc1.out.md` (Codex,
  Chinese), and Codex's three checks of this book `pc1-chk1.out.md`, `pc1-chk2.out.md` and `pc1-chk3.out.md` (Chinese). The rulings below answer all of them. Where
  their line numbers differ, the later Codex one is right.
- **`./.dsh-ref/coordinator-mode.md`**, especially "How tests reach their state: no hand-written facts" (with "A name
  does not change what it is") and "Before you build: what the reworks were about". They bind every brief.
- **TDD** as `./.dsh-ref/tdd/` says: one failing test, then just enough code, per row.

## 2. Rules (all groups)

1. **What the model receives.** It changes only in these ways, all from the spec:
   - **P3:** when over budget, the new deletion order applies (seven steps, five protected items, the placeholder),
     and the budget is measured on the final request.
   - **P4:** thinking from earlier runs (`current_run`), or all thinking (`none`), is left out of the outgoing copy.
   - **P5:** the Host's additional instruction (`systemInstruction`) moves from the end of the system prompt into the
     base prompt, right after the base text (ruling 14). The base text and every platform Skill section stay
     byte-identical (ruling 11).
   - **P5's extra manifest bytes:** the required `promptSet` makes the prepared manifest bigger. A review instruction
     already near the manifest limit may be shortened a little more, or rejected for capacity, where today it just
     fitted (ruling 14).

   Everything else the model receives stays byte-identical: input text, tool specs, tool names and their order.
2. **Tests reach every state through public steps.** Expectations are hand-computed literals. No database reads, no
   hand-written facts (coordinator-mode). The old Kernel helper `readRecords` (`tests/kernel/R4a-frozen-public.test.ts`
   ~609) opens SQLite directly: do not copy it into new tests.
3. **Old tests.** An expectation changes only where §3.3's platform-Skill or request-record bullets, or §5.3 below,
   name it, and only for the reason given there. Any other old test that fails: report it with the failure. Never
   loosen, skip or re-time a test.
4. **`vendor/coding-agent/dist`.** It is produced only by `node scripts/build-kernel-patch.mjs --write` and checked
   with `--check`. Never edit `dist` by hand; never add a Kernel file the script does not manage. The same goes for
   `src/contracts/prompts/platform-pack.generated.ts` and `scripts/build-platform-prompts.mjs`.
5. **State transitions only through `src/core/work-graph/state/`** (root AGENTS rule 9). New record fields go through
   the existing services and their codecs. Register any new decoder where `tests/architecture/state-writes.test.ts`
   asks.
6. **Fixtures are frozen.** The PC fixtures in `tests/helpers/` (§5.1) are written by Codex, checked and frozen by the
   lead, and present in the base copy before a run starts. Use them; do not edit them. If a row cannot be written
   with them, report it.
7. **Comments** follow decision 35: rules and reasons, no construction history.
8. **Not in PC-1.** PC-2 does these; do not start them:
   - packs on disk and the editing routes;
   - `promptPack` and `reasoningReplay` in the settings model;
   - section order: `sectionOrder` in the binding, the guard, the review shrink;
   - the stale-files reminder;
   - the `base` template's tool blocks and the `check` line, and `mentionsTools` checks;
   - tool texts from a person's pack.

## 3. Lead rulings

### 3.1 The Kernel patch (group K, PC-1a)

1. **Managed files.**
   - Restore `core/context/selection_policy/context-selection-policy.ts` into `vendor/coding-agent/patches/` from the
     frozen source map: `dist/core/context/selection_policy/context-selection-policy.js.map`, `sourcesContent[0]`.
     Codex checked it: 225 lines, sha256 `291c3188…c527d`, and the `.d.ts.map` holds the same text.
   - Add it to `relativeSources` in `scripts/build-kernel-patch.mjs` ~13. Prove `--check` passes with the restored
     text unchanged, and commit that alone.
   - Then change the managed sources: `runtime-runner.ts`, `composition-root.ts`, `resume-composition.ts`,
     `composition-contracts.ts`, `public-api.ts` and the selection policy. Only `selectContext` and the runner change
     behaviour; `selectContext`'s dist callers are the runner and `public-api` only.
2. **The new inputs are optional in the Kernel.**
   - `runCodingAgent`, the composition root's same-identity resume branch (~322, forwarded ~334) and
     `resume-composition` (~60) accept, all optional:
     - `baseSystemPrompt: { templateId; version; text }`;
     - `skills: SkillContext[]`;
     - `reasoningReplay: 'current_run' | 'none'`;
     - `previewRequest`;
     - `onContextSelected`.
   - **With `baseSystemPrompt` and `skills` given:**
     - no Skill file is read (composition root ~415, resume ~311);
     - the fixed `coding-agent-v5` text is not used (~493–495, resume ~406–408);
     - `onConfiguration` (~423, resume ~318) reports `systemPromptVersion: "<templateId>@<version>"`, `skills` as
       passed, and `skillResourceRoot: "provided-by-host"`.
   - **What absence keeps** (the only compatibility promised):
     - without `baseSystemPrompt` and `skills`, the old sources (the fixed base, Skill files);
     - without `reasoningReplay`, no thinking is filtered;
     - without `previewRequest`, the runner's configured estimator measures the built request (ruling 7).
     P3's new order and protections apply in every case, so an over-budget standalone run may select differently from
     today. The standalone Kernel tests (`tests/kernel/R4a-frozen-public.test.ts`) keep passing; report any that
     does not.
   - **Exports.** The new inputs and the report have public **types** exported from `public-api.ts`; `selectContext`
     keeps its name. There is no new runtime export, so `tests/kernel/B2-history-public-export.test.ts` ~247–256
     stays as it is. The platform always passes all five inputs (group S).
3. **The selection call and the frozen names.** The shapes below are exported as types from `public-api.ts`. The
   fixture `tests/helpers/PC-kernel-fixture.ts` reaches them through `RunAppInput`, `RuntimeRunner['run']` and
   `typeof selectContext`, so the field names must be exactly these:
   ```ts
   type ReasoningReplay = 'current_run' | 'none';
   type BaseSystemPromptInput = { templateId: string; version: number; text: string };
   type ContextPreviewResult = { outgoing: ModelRequest; inputTokens: number; outputReserve: number; fits: boolean };
   type ContextPreview = (request: ModelRequest) => Promise<ContextPreviewResult>;
   type ContextSelectionRemoved = { memory: number; skillReference: number; additionalInstruction: number;
     toolResultBody: number; historyExchange: number; historyConclusion: number; currentExchange: number };
   type ContextSelectionReport = { requestId: string; inputTokens: number; budget: number; removed: ContextSelectionRemoved };
   type ContextSelectionOptions = {
     historyEntryCount: number;          // the first n entries of input.transcript are history, counted on the input
     taskInputMessageId: string | null;  // ruling 4
     build: (input: ContextBuilderInput) => ModelRequest;   // the runner's ContextBuilderPort.build
     previewRequest: ContextPreview;     // the runner passes the default of ruling 7 when the caller gave none
     reasoningReplay?: ReasoningReplay;  // absent: no thinking filter (ruling 10)
   };
   function selectContext(input: Readonly<ContextBuilderInput>, options: ContextSelectionOptions):
     Promise<{ selected: ContextBuilderInput; request: ModelRequest /* the chosen preview's outgoing */; report: ContextSelectionReport }>;
   ```
   - **`RunAppInput`** (`runCodingAgent`), **the same-identity resume input** and **`resume-composition`'s input**
     gain these optional fields:
     - `baseSystemPrompt?: BaseSystemPromptInput`;
     - `skills?: SkillContext[]`;
     - `reasoningReplay?`;
     - `previewRequest?: ContextPreview`;
     - `onContextSelected?: (report: ContextSelectionReport) => void`.
   - **The runner's `run` input** (`RunnerContextInput`) gains the optional `previewRequest`, `onContextSelected` and
     `reasoningReplay`. Its `baseSystemPrompt` stays a string: the composition passes the text.
   - **`ContextBuilderInput`** is an unmanaged type and does not change. The thinking filter (ruling 10) runs inside
     `selectContext`, so PE4 tests reach it too.
4. **The task input.** "This run's task input" is `state.turn.userMessage.messageId` (`run-state.ts` ~119, ~307,
   ~348). It is the first user entry of the current transcript, also after resume: the resumed state carries it.
   Later inputs (`input-${inputId}`, runner ~823, ~856) are ordinary current user messages. The latest user message
   is found on the full candidate list (selection ~32), before anything is removed.
5. **History vs current.** The runner keeps today's split: `historyTranscript` against `withPresentations(state)`
   (~665–666). It passes `historyEntryCount = history.length` for the concatenated input. The selection marks each
   input entry as history or current once, before the thinking filter or any removal, and never recounts positions
   afterwards.
6. **The candidate sequence.** Build one fixed list of removal units in this order; a prefix of length k removes the
   first k units.
   1. Memories, in today's order (selection ~86, ~121).
   2. Reference Skills, in today's order (~126).
   3. Additional instructions, in today's order (~131).
   4. History tool results with `status: 'success'`, oldest first, one unit per result.
      - Removing one replaces its `output` with
        `[{ kind: "text", text: "内容因长度省略（工具 <name>，调用 <callId>），需要时重新读" }]`. The tool name comes
        from the paired call. Every other field stays.
      - A result is a unit only if
        `Buffer.byteLength(JSON.stringify(newOutput)) < Buffer.byteLength(JSON.stringify(oldOutput))`.
      - Never units: `error` and `cancelled` results, and every result of a partly closed group.
   5. History units, oldest first by position: each complete tool exchange (an assistant with calls plus all its
      results) and each user message. A protected message is never a unit; an unclosed group is never a unit.
   6. History assistant messages without tool calls, oldest first.
   7. Current complete tool exchanges, oldest first. Current user messages and current assistant messages without
      calls are **not** units: nothing in the spec allows removing them. Unclosed groups are never units.

   Never units, as the spec's five protected items: instruction Skills, the base prompt (with the Host instruction),
   the task input, the latest user message, and unclosed calls. Remove today's branch that drops instruction Skills
   (~136).
7. **Finding the prefix.**
   - Call the preview with k = 0 first. If it fits, use it; the usual case is one preview call.
   - Otherwise try k = N, all units. If that does not fit either, the result is today's
     `required_content_over_budget`.
   - Otherwise binary-search the smallest k in (0, N] whose preview fits. Only a k whose own preview said `fits` is
     ever used. At most `2 + ⌈log₂ N⌉` calls.
   - With the byte counter the fit is monotone, so this finds the least k; PC-11 checks it against step-by-step
     removal. With a model counter it may remove a little more than the least, which the spec accepts.
   - **The default preview** is used when `previewRequest` is absent. It measures the built request with the
     estimator the runner is configured with (default `CharacterTokenEstimator`) against the window, with `outgoing`
     the request unchanged and `outputReserve` 0.
8. **The report.** `removed` counts the units of each step inside the chosen prefix: `memory, skillReference,
   additionalInstruction, toolResultBody, historyExchange, historyConclusion, currentExchange`.
   - `historyExchange` counts step-5 units: exchanges and user messages.
   - A result whose body was replaced in step 4, and whose exchange is then removed in step 5, counts in both.
   - `inputTokens` is the preview's count for the request that is sent.
   - `budget` is the window minus that preview's `outputReserve`: the input allowance.

   `onContextSelected({ requestId, inputTokens, budget, removed })` is called once per model request, after ruling
   9's hook check and before the provider is called, also on resume.
9. **The hook re-check.** When the runner's request hook returns a changed request (~711–718), call the preview again
   on it; this replaces the old `estimateTokens` and window comparison (~714–715). If it does not fit, the outcome is
   today's outcome at that point. The report carries the re-checked counts.
10. **Thinking (P4).** Before the candidate list is built, map the history and current lists into an outgoing copy:
    - with `current_run`, history assistant entries lose `reasoningContent`;
    - with `none`, all assistant entries lose it.

    An assistant entry is dropped from the copy only when, after this step, its `content`, its `reasoningContent`
    and its `toolCalls` are all empty. So under `current_run` a current thinking-only message stays. (A real run
    never sends one, because a reply without calls ends the run; PC-17 reaches this case through `selectContext`.)

    How to change entries:
    - `withPresentations` shares objects (~246): copy each entry and message you change, and never `delete` on them.
    - The run state, the stored events and the history read stay unchanged.
    - The adapters do not change.
    - The filter runs before the preview, so the preview measures what is sent.

### 3.2 Contracts and pack pieces (group C, PC-1a; frozen for PC-1b and PC-2)

11. **`base` and the platform Skills enter the platform pack byte-for-byte.**
    - **`base`.** New template `base`: file `templates/base.txt`, version 1, `mentionsTools: []`. Its text is exactly
      `CODING_AGENT_SYSTEM_PROMPT` (`dist/app/prompts/coding-agent-system-prompt.js` ~3–33), 3,812 bytes, sha256
      `860d951d7f60787371922438b5935842c76ea90aa8a75fdf75d55297727f7cc2`. No trailing newline is added.
    - **The five Skill templates.** Each is the exact bytes of the committed `resources/skills/platform-<role>/content.md`,
      final newline kept. Each has version 1 and `mentionsTools: []`, and its file is
      `templates/skill-platform-<role>.txt`. The sha256 values are of the committed LF bytes; a Windows checkout's
      CRLF copy differs.

      | Template | sha256 |
      | --- | --- |
      | `skill-platform-work` | `5e1feacc1aed9901b3a5c0fb5870ccb8642b6cb43e3b1ac28f9cb02f2ed4f95f` |
      | `skill-platform-secretary` | `a8644c9adebb22df4e920fc823ede079fc7caee44d959f84394546b63dffc8ee` |
      | `skill-platform-adviser` | `3e9bf8beaed4064e7c992fefba9729d57a5317a01227976926029915dad3dc85` |
      | `skill-platform-scribe` | `e2384821311341bfd440a50cd4b68bc818126d3b8d0792f23e9357c619bae043` |
      | `skill-platform-reviewer` | `a7e4ab9987ab8703399f3f9c7815e85b1b4bb7ced24ad9437d196c169ee63d6f` |
    - **Slot tables.** The six templates get empty slot tables (`slot-tables.ts`); `{{` stays forbidden in them.
    - **The pack's identity.** `packId` stays `"platform"` and `schemaVersion` stays 1: "第 2 版" is content, not
      format.
    - **The generator** (`scripts/build-platform-prompts.mjs`, owned by C) also emits each template's origin, for
      ruling 13's `origins` (it returns and writes only manifest, templates, strings and tools today: ~76, ~127).
      Regenerate the module with it.
    - **`runtime-assets.json`** gets the six new files and the changed `pack.json` digest. `check-boundaries.mjs`
      ~232, ~582 already checks the asset closure and the generated module; keep it green without loosening it.
    - **The permanent test** pins the six digests above as literals. It does not read the old `content.md`, which
      PC-1b deletes. C's reply also states that the files were compared byte for byte when copied.
    - **The old directory stays for now.** C does not delete `resources/skills/platform-*`; S deletes it in PC-1b
      (ruling 23), together with its ten `runtime-assets.json` entries, once nothing reads it.
12. **Skill metadata stays in code.** New `src/contracts/prompts/platform-skills.ts`:
    `PLATFORM_SKILLS: readonly { id; title; kind: 'instruction'; priority; templateId }[]`, with today's values from
    each `skill.json`:

    | Skill | Title | Priority |
    | --- | --- | ---: |
    | `platform-work` | "Platform work" | 90 |
    | `platform-secretary` | "Platform secretary" | 70 |
    | `platform-adviser` | "Platform adviser" | 60 |
    | `platform-scribe` | "Platform scribe" | 50 |
    | `platform-reviewer` | "Platform reviewer" | 40 |

    A pack changes only text.
13. **New platform contracts.** One new module `src/contracts/prompts/prompt-set.ts`, plus the fields below, in the
    spec's §2 shapes with these precisions:
    - **`PromptSetV1`** exactly as spec §2. Its `skills[]` entries carry `schemaVersion: 1`, as `SkillContext` does
      (`context-types.js` ~50). PC-1 fills `sectionOrder` with today's order (ruling 18). Also a pure
      `decodePromptSetV1(value: unknown): PromptSetV1 | null`, which every manifest loader uses.
    - **`ModelRequestPromptFactsV1`** exactly as spec §2. `QueryRequestPromptFactsV1 =
      Omit<ModelRequestPromptFactsV1, 'maxOutputTokens'>`.
    - **`PromptRecordRequestV1`** and the `readPromptRecord` result as spec §2. `texts` is keyed by each text's sha256
      hex: the same `digest` the set and the records carry.
    - **Digests.** `sha256Hex(utf8(text))`, lowercase hex. `systemDigest` covers `request.systemPrompt`; `toolsDigest`
      covers `JSON.stringify(request.tools)` of the request handed to the provider.
    - **Content types.**
      - `PROMPT_TEXT_CONTENT_TYPE = 'application/vnd.coding-platform.prompt-text;version=1'`, for templates, the merged
        string table (`JSON.stringify` of the table), the merged base, and Skill contents.
      - `PROMPT_TOOL_SPECS_CONTENT_TYPE = 'application/vnd.coding-platform.prompt-tool-specs+json;version=1'`.
    - **The pack source port:**
      ```ts
      type ResolvedPromptPackV1 = { manifest; templates; strings; tools;
        origins: Readonly<Record<string /* templateId */, { packId: string; version: number }>> };
      interface PromptPackSourcePort {
        resolve(packId: string, signal: AbortSignal): Promise<
          { status: 'ready'; value: ResolvedPromptPackV1 } | { status: 'rejected'; code: 'invalid' | 'unavailable'; reason: string }>;
      }
      ```
      - `origins` is new on `ResolvedPromptPackV1` (`prompt-pack.ts` ~22), filled by the generator (ruling 11).
      - The default source, `createPlatformPromptPackSource()`, resolves `"platform"` to the generated pack and
        anything else to `invalid` ("prompt pack <id> is not available").
      - PC-2 replaces the Host's source with the disk-backed one; Runtime code only sees the port.
    - **The model's prompt selection.**
      - The trusted `WorkbenchModelConfiguration` (`runtime-configuration.ts` ~46–56) gains optional `modelId`,
        `promptPack` and `reasoningReplay`.
      - `BoundModel` (`source-tool-ports.ts` ~18–23) gains an optional
        `selection: { modelId: string; promptPack: string; reasoningReplay: 'current_run' | 'none' }`. Its
        `configuration` does not change, so the about fifty test files that build a `BoundModel` directly need
        nothing.
      - The Host's resolve (`runtime-configuration.ts` ~417–420) always fills `selection`. The defaults `"platform"`
        and `"current_run"` are applied there, not in stored data.
      - A settings model's `modelId` is the settings item `id`, set by `settingsModelBinding` (`host.ts` ~667–683).
      - A model given directly in the Host configuration: `modelId` is the same `runtime-<sha16>` id the settings
        catalog projection computes (`host.ts` ~793–806). Move that computation into one function both use.
      - The direct configuration may carry `promptPack` and `reasoningReplay`. When present, they join that identity,
        and the startup catalog's private map (`host.ts` ~393, ~811) keeps them beside `provider` and `options`, so
        `settingsModelBinding` restores them when a settings selection rebuilds the binding (~694). When absent, the
        identity and the id stay what they are today.
      - Never parse an id out of `revision`.
      - One helper, `promptSelectionOf(model: BoundModel)`, is the only reader of `selection`; preparation and the
        start check both use it. A `BoundModel` without `selection` reaches only tests that build one directly; the
        helper reads it as `{ modelId: configuration.revision, promptPack: "platform", reasoningReplay:
        "current_run" }`.
      - C's tests go through a full Host start: the direct configuration with both fields, a settings selection that
        rebuilds the binding, and the resolved `selection` read back through the Host's runtime configuration.
    - **The platform Skill root.** Move `PLATFORM_SKILL_RESOURCE_ROOT` (`runtime-configuration.ts` ~82) into a
      Runtime-owned module, `src/core/agent-runtime/platform-skill-root.ts`, because core may not import `src/app`
      (`check-boundaries.mjs` ~498). Its value stays exactly the same path. Keep the old export as a re-export.
    - **What C wires.** C writes these types, the decoder, the default source and the selection helper with their
      pure tests, and wires only the Host configuration part. The manifests' `promptSet` field and every other
      consumer belong to PC-1b.
    - **Unwired declarations.** Every declaration PC-1a adds that has no production consumer yet gets an entry in
      `tests/architecture/production-reach-allowlist.json`, with a `kept-for` note in the form the check accepts
      (`production-reach.test.ts` ~40, ~83): `PC-1b, slice 6 of the orchestration design: <the consumer that will
      use it>`. That file is C's in PC-1a.
    - **Removing the entries in PC-1b.** The check also requires removing an entry once its declaration is wired
      (~103–105). In PC-1b, P, S and R only report which entries their work wires. The joint step removes them all,
      and that file is the joint step's alone.

### 3.3 Freezing (group P, PC-1b)

14. **What is frozen, in which order** (Work `execution-preparation.ts` ~369–594; Query `query-preparation.ts`
    ~193–305):
    1. **The selection, taken before any await.** Take `promptSelectionOf(model)` and `provider`, `model` before the
       first await that follows the configuration read.
       - Work's snapshot function (~607) rebuilds the model field by field today, which would drop `selection`; it
         now copies `selection` too.
       - Query has no snapshot (`configured.value`, ~202, ~238); take the values at once.
    2. **Resolve the pack once** through `PromptPackSourcePort`. A rejection becomes the preparation's `invalid`,
       naming the pack and the reason. Never fall back to `platform`.
    3. **Render every prompt text of this preparation from that resolved pack.** The context recipes and renderers
       take the resolved pack as an explicit argument (`context-rendering.ts` ~13, ~207; `context-work-recipe.ts`
       ~16, ~265; `context-query-recipe.ts` ~4, ~86; `continuation-brief.ts` ~35, ~360, ~407;
       `prepared-execution.ts` ~38, ~161, ~188). That covers:
       - the task input;
       - the continuation brief;
       - the review instruction or proposal (`unknown-call-review` or `unknown-call-proposal`, by phase,
         `prepared-execution.ts` ~133, ~161);
       - the initial-planning guidance (`initial-planning-answer`, now appended as a constant,
         `query-preparation.ts` ~51, ~227);
       - the role label and purpose (`platformRoleProfile`, `role-profiles.ts` ~23, used at `context-fact-text.ts`
         ~82), from the resolved strings. The duty's code metadata stays as it is.

       **Rule:** every read of the generated pack inside preparation's call tree goes through the resolved pack.
       Reads outside preparation keep the generated pack in PC-1: the tool factories at start, and the business-layer
       texts. List those that remain (`grep -rn platform-pack.generated src`) in the reply.

       The pure renderers keep a compatible call without the pack argument, defaulting to the generated pack. That
       keeps their direct tests unchanged (e.g. `A2-rework-contract-helpers` ~389, `C3-brief-timeline` ~121,
       `K3-16-proposal-input` ~152). Preparation and the entry always pass the pack: the reply lists each production
       call site and the argument it passes.
    4. **Render `base`** (no slots), then merge the Host instruction:
       `merged = base + (systemInstruction ? '\n\n' + systemInstruction : '')`. The separator is today's
       (`observed-model-run.ts` ~259).
    5. **Select Skills** (ruling 15).
    6. **Store every text** with `bodies.put`, through the new `src/core/agent-runtime/prompt-set-texts.ts` (P):
       - what: each used template, the merged string table, the merged base, and each Skill content;
       - the origin: this run (Work) or this query run (Query);
       - the same content is stored once (F17).

       "Used templates" are all those step 3 read, tracked through the resolved pack and not by a list in code, plus
       `base` and the platform Skill templates taken. A failed store is the preparation's `unavailable`, like a
       failed manifest store.
    7. **Build `PromptSetV1`** from the refs and digests and put it in the manifest as the required field
       `promptSet`, inside the manifest digest.
       - The manifest-size measure that drives the review shrink (~514, ~549) includes `promptSet`, with the shrink's
         algorithm and order unchanged (PC-2 changes them).
       - Then store the manifest as today.

    `prepared-execution.ts` ~195–242 and ~262–291 get the field.
15. **Skill selection at preparation.** Use today's selection (`runtime-configuration.ts` ~373–381). An explicit
    empty list stays empty and never becomes a default. For each selection:
    - **The platform root.** Its `resourceRoot`, resolved to an absolute path with `path.resolve`, equals
      `PLATFORM_SKILL_RESOURCE_ROOT`. Use no `realpath`: the directory is gone after ruling 23.
      - Each enabled id is looked up in `PLATFORM_SKILLS`, and its content comes from the resolved pack's template.
      - The `SkillContext` is `{ schemaVersion: 1, id, title, kind, priority, content, source:
        "skill:<id>@sha256:<sha256 of content>" }`, exactly the loader's form (`file-skill-loader.js` ~74–90).
      - An unknown id is `invalid`.
    - **Any other root.** Load it with the Kernel's public `FileSkillLoader` at preparation time, as the Kernel does
      today.
    - **No Skill selection.** Take today's default, `vendor/coding-agent/resources/skills` with `['coding-safety']`
      (`observed-model-run.ts` ~297), as an ordinary directory.
16. **The start and resume check** (spec P2, F19).
    - **Work.** The configuration check at start, and at resume with a same-process proof (`execution-driver.ts`
      ~572–575), also compares `promptSelectionOf(model)`'s three fields plus `provider` and `model` with
      `promptSet`. A difference is `forbidden`. A resume without a live handle still answers `busy` first (~384–393);
      keep the order.
    - **Query.** The pre-entry comparison (`query-execution.ts` ~198–202) gets the same fields; after entry it only
      observes (~176).
    - The Host's binding pinning (`host-settings.ts` ~226–255) stays as it is.
17. **The entry re-render.** The continuation-brief check (`execution-entry-service.ts` ~973, ~1201) and the
    review-or-proposal check (~1044–1053, by phase) read the frozen template text and the frozen string table back.
    - WorkGraph may not import the Runtime (`module-target.json` ~19, `check-boundaries.mjs` ~513). So the entry reads
      the bodies through its own `deps.bodies`, and uses the pure helpers in `src/contracts/prompts/prompt-set.ts`
      (P's in PC-1b): `decodePromptSetV1`, and `checkPromptBody(ref, record, PROMPT_TEXT_CONTENT_TYPE)` for the
      digest, size and content type (the §4 signature; the record it takes is structural).
    - Then it renders with the pure renderer and compares as today.
    - They never read the current pack. A text that cannot be read is the entry's `unavailable`.
    - The comparison itself (a suffix) stays as it is; PC-2 changes it.
18. **`sectionOrder` in PC-1.** Record, per call kind this preparation can produce, today's fixed order
    (`context-rendering.ts` ~36–38) projected onto the sections the template and the call kind allow (the call-kind
    table, `state/context-input.ts` ~65–73). Nothing reads it in PC-1.
19. **Reading frozen bodies.** Bodies are content-addressed and deduplicated, so a body's origin may be an earlier run
    (`body-codec.ts` ~125, `body-store.ts` ~39).
    - Authorize the read of this run's manifest first.
    - Then read the child bodies by the refs it holds and verify each against its ref.
    - Do not require a child body's origin to be this run.

### 3.4 The send path (group S, PC-1b)

20. **One outgoing transform before the preview.** Move `responseFormat` into one function, "make the final request"
    (`observed-model-run.ts` ~257–259), which the preview uses. The client wrapper no longer adds `systemInstruction`
    (it is in the base, ruling 14) or `responseFormat`; it sends what the Kernel hands it.
21. **The preview is a method of the run's existing `ModelBudget`** (`model-budget.ts` ~39; Work's is created at
    `execution-driver.ts` ~842, Query's at `query-execution.ts` ~363).
    - Take the measuring out of `wrap` (~78–95) into one side-effect-free async function, used by both the preview
      and `wrap`. It computes:
      - the output cap (~82);
      - the final request's bytes, or the counter's count, with async counters awaited (~85–87);
      - `fits` (~95).
    - The preview pushes no entry, persists nothing and reserves nothing. The real reservation stays in `wrap`
      (~96–97).
    - The next preview reads the same account's `totals()` (~52), so the reserve follows the cumulative output
      (PC-15).
    - A meter is still created per driver entry, as today; PC-1 does not change its lifetime across pause and resume.
22. **`runObservedModel` takes the frozen prompt inputs.**
    - A required option `prompt: { base: { templateId; version; text }; skills: SkillContext[]; reasoningReplay }`
      replaces the old `skills` and `systemInstruction` options (`observed-model-run.ts` ~288–305; Work
      `execution-driver.ts` ~982–983, Query `query-execution.ts` ~525–526).
    - The drivers fill it from `promptSet`, read back through `prompt-set-texts.ts`.
    - `runObservedModel` passes to the Kernel: `baseSystemPrompt`, `skills`, `reasoningReplay`, `previewRequest`
      (ruling 21 plus ruling 20's transform), and `onContextSelected`.
23. **Delete `resources/skills/platform-*`** (both files of each) and their ten `runtime-assets.json` entries.
    `PLATFORM_SKILL_RESOURCE_ROOT` keeps its value (ruling 13); nothing reads that directory any more.
24. **Facts per request, joined by `requestId`.**
    - `onContextSelected` reports land in a map keyed by `requestId`, owned by this run's wrapper. Never use "the last
      report".
    - Before the meter reserves, the shared wrapper computes `ModelRequestPromptFactsV1` from the request it was
      handed: `systemDigest`, `toolsDigest`, `toolSpecsRef` (ruling 25), `selection` (the report for this
      `requestId`), and `maxOutputTokens` (the cap the meter applies, ruling 21's function). The cap is computed for
      both kinds of run.
    - The shared `beforeCall` carries the whole facts, `maxOutputTokens` included, for Work and Query alike.
      - Work stores them in its permit.
      - Query's own projections (reservation, admission, usage; Runtime `query-execution.ts` ~119, ~363, ~385–394)
        drop `maxOutputTokens` and store `QueryRequestPromptFactsV1`. Query's cap is the row's `reservedOutput`.
    - `requestDigest` keeps its meaning: the request inside the meter, as today.
25. **`toolSpecsRef`.**
    - In `onConfiguration`, which is synchronous: copy the reported specs and sort them as `buildModelRequest` does
      (name, `localeCompare(…, "en")`; `context-builder.js` ~112). Serialize with `JSON.stringify`, start the
      `bodies.put`, keep the promise, and attach a rejection handler at once.
    - Before the first request reaches the meter, the wrapper awaits that promise. On each request it checks
      `sha256Hex(JSON.stringify(request.tools))` against the stored body's digest.
    - **When the store fails or the digests differ:** no reservation, no `beforeCall`, no provider call, and the run
      fails `unavailable`.
      - The Kernel turns a thrown stream error into a failed run (`runtime-runner.ts` ~784, ~801).
      - The driver keeps a code only for a `RuntimeModelCallRejected` it catches (`execution-driver.ts` ~1003,
        `query-execution.ts` ~534).
      - So the wrapper records the rejection, and `runObservedModel` raises
        `RuntimeModelCallRejected('unavailable', …)` after the Kernel returns (~349).
    - Later requests of the same run reuse the ref, on start and on resume.
    - If the specs the Kernel reports and `request.tools` are not byte-equal after the sort, stop and report it. Do
      not adjust either side.

### 3.5 Records and the read (group R, PC-1b)

26. **Work.**
    - **Shape.** `ActualModelRequest` (`work-graph/tasks/model-call-contracts.ts` ~18–28) and `ModelRequestPermitV1`
      (~43–57) gain `prompt: ModelRequestPromptFactsV1 & { maxOutputTokens: number }`.
    - **The permit's `sequence: number`.** It is 1 + the number of this run's permits already authorized, read with
      ruling 28's lookup inside the authorization.
      - The run's revision guard does not protect it: the authorization does not write the run (`model-call-service.ts`
        ~151–158).
      - So the authorization commit also claims the unique slot `model-request-sequence:<run refKey>:<sequence>` with
        a `UniqueClaimChange` (`record-store/ports.ts` ~84; `expectedOwner: null`, `nextOwner` the permit id).
      - A lost claim: the authorization does not commit and is not retried. The store answers `unique_conflict`, which
        is not a `CoreError` (`contracts/core/results.ts` ~16). The authorization service maps it to `busy` itself,
        with the reason "the model request sequence slot is already taken". Do not pass the store's error through, and
        do not use the shared mapping's Kernel identity-slot text (`read-result-failures.ts` ~98).
      - A run never authorizes two requests at once, so the claim only guards against a broken caller.
    - **The flow.** Both projections in `model-call-access.ts` (~76 authorize, ~87 consume) pass the facts. The
      service validates them (`model-call-service.ts` ~61, ~144) and stores them in the permit and in the
      authorization event (~153). At consumption it compares every new fact with the permit (~245), like the digests
      today; a difference is today's consumption-mismatch outcome.
    - **Codecs.** The strict codecs (`model-request-codecs.ts` ~81–95, snapshot ~147, events ~174) accept exactly the
      new fields and reject unknown ones.
    - **Fingerprints.** The idempotency fingerprints (~112, ~210) include the facts through the input projection.
    - **The conflict path.** `beforeCall` derives the command id from the model request id
      (`b2-model-authorize:${requestId}`, `model-call-access.ts` ~78). A replay of the same model request with other
      facts is therefore the same command with another fingerprint, and the store answers `idempotency_conflict`
      (`in-memory-record-store.ts` ~440, `sqlite-record-store.ts` ~526). That is the spec's conflict; no new compare
      path is added.
27. **Query** (the reservation is the first write).
    - `QueryModelUsageV1` (`contracts/query-job.ts` ~356) gains `prompt: QueryRequestPromptFactsV1`. Every write
      carries it: reservation, admission and usage.
    - `admitQueryModelRequest`'s input (`queries/contracts.ts` ~158–164) gains `prompt: QueryRequestPromptFactsV1`
      beside its four digests.
    - **The order:**
      1. S computes the facts.
      2. The reservation, `recordQueryUsage` (`queries/query-execution.ts` ~1302) through the meter's persist
         (Runtime `query-execution.ts` ~119, ~363), writes the whole row with `admitted: false`.
      3. The admission (~1381–1395, Runtime ~387–394) compares the facts with the row and sets `admitted: true`.
      4. Every later usage write changes only `inputTokens`, `outputTokens`, `cachedInputTokens` and `usageStatus`.
    - **What never changes after the first write:** `requestDigest`, `reservedInput`, `reservedOutput` and the
      prompt facts. Only the admission may turn `admitted` from false to true.
    - A write that carries other immutable facts for the same `requestId` is `idempotency_conflict`.
    - The Query event codec checks every element of the request list strictly (`query-record-codecs.ts` ~343–355).
28. **A read of a Work run's requests.** A separate read port. `ModelRequestPort` stays write-only, so the two-method
    wrapper in `tests/runtime/B2-runtime-execution.test.ts` ~314 keeps working.
    ```ts
    // work-graph/tasks/model-call-contracts.ts
    export interface ModelRequestReadPort {
      listRunModelRequests(ctx: CoreCallContext, runRef: RunRef): Promise<ReadResult<ModelRequestPermitV1[]>>; // by `sequence`
    }
    ```
    - Back it with a lookup on the permit records (`model-request-codecs.ts` ~222), declared the way other WorkGraph
      lookups are (`RecordLookupPort`, `model/execution-entry-contracts.ts` ~153).
    - It does not scan the record store and does not read Kernel history.
    - The Runtime gets it as the dependency `modelRequestReads` (ruling 30).
29. **`readPromptRecord?(ctx, ref: RunRef | QueryRunRef)`** is an **optional** member of the Runtime's
    `RuntimeExecutionPort` (`ports.ts` ~36–79), like `readContinuationBrief?` (~73).
    - It is optional only so that the existing port literals in tests stay type-compatible
      (`tests/business/R5c-workflow.test.ts` ~50 and others). `createAgentRuntime` always publishes it.
    - It is implemented in `runtime.ts` next to `readContinuationBrief` (~512–535) and reads the same way: validate
      the ref, authorize the read, read the prepared manifest.

    It returns:
    - `set`: the manifest's `promptSet`;
    - `requests`: the Work permits (ruling 28) or the Query request rows (`readQueryExecution`,
      `queries/contracts.ts` ~140), each as `PromptRecordRequestV1` with its `kind`;
    - `texts`: every body the set and the requests refer to, keyed by digest and each verified against its ref
      (ruling 19).
    There is no HTTP route; E3 adds it.
30. **Runtime dependencies and the composition root.** `execution-contracts.ts` ~207 is R's.
    - It gains `promptPacks?: PromptPackSourcePort` and `modelRequestReads?: ModelRequestReadPort`.
    - `runtime.ts` (R) installs the default `createPlatformPromptPackSource()` when no source is given.
    - Without `modelRequestReads`, `readPromptRecord` on a Work ref returns `unavailable` ("model request reads are not
      wired"), never an empty list.
    - The real composition root, `src/composition/create-platform.ts` ~1179–1183 (R's in PC-1b), passes the platform
      pack source and the WorkGraph's real permit read. PC-2 swaps the source for the disk one.

## 4. Groups, files and order

In one run, each file has one owner group; a later run may edit what an earlier run edited.

| Group | Run | Owns (production) | Owns (tests) | Rows |
| --- | --- | --- | --- | --- |
| **K** Kernel | a | the six managed Kernel files and the new one (ruling 1), `scripts/build-kernel-patch.mjs`, the regenerated `dist` artifacts | new `tests/kernel/PC-*.test.ts` | PC-11, PC-12 (Kernel and adapters), PC-13, PC-14, PC-16, PC-17, and PC-15's async-preview case in `runCodingAgent` |
| **C** contracts and pack | a | `src/contracts/prompts/**` (new `prompt-set.ts`, `platform-skills.ts`), `scripts/build-platform-prompts.mjs`, the generated module, `resources/prompts/platform/**`, `runtime-assets.json`, `src/core/agent-runtime/source-tool-ports.ts`, new `src/core/agent-runtime/platform-skill-root.ts`, `src/app/runtime-configuration.ts`, `src/app/host.ts`, `tests/architecture/production-reach-allowlist.json` | new `tests/contracts/PC-*.test.ts`, `tests/app/PC-*.test.ts` | ruling 11's digests; ruling 13's selection through a full Host start |
| **P** preparation and entry | b | `execution-preparation.ts`, `query-preparation.ts`, `context-*.ts`, `role-profiles.ts`, new `prompt-set-texts.ts`, `src/contracts/prompts/prompt-set.ts`, `src/contracts/prompts/render-template.ts`, `src/contracts/continuation-brief.ts`, `src/contracts/core/prepared-execution.ts`, `execution-entry-service.ts` | W2, AG6, C2 (§5.3); the hand-written manifests (§5.3); the K3-35 tests named in §5.3 | the preparation halves of PC-06 |
| **S** send path | b | `model-budget.ts`, `observed-model-run.ts`, `execution-driver.ts`, the Runtime `query-execution.ts`, the deletion of `resources/skills/platform-*` and its asset entries | the direct `runObservedModel` tests (§5.3), new `tests/runtime/PC-*.test.ts` (send) | PC-10, PC-15 (platform), the start and resume halves of PC-06 and PC-07, PC-08's start check |
| **R** records and read | b | `work-graph/tasks/model-call-*.ts`, `model-request-codecs.ts`, `work-graph/queries/**`, `contracts/query-job.ts`, `contracts/dispatch.ts`, `model-call-access.ts`, `execution-contracts.ts`, `runtime.ts`, `ports.ts`, `src/composition/create-platform.ts` | `A2-step1-codecs`, `B2-model-request`, the request fixture of §5.3, new record tests | PC-09 |
| **J** joint step | b, last | `tests/architecture/production-reach-allowlist.json` (removes the wired entries the groups report) | new `tests/runtime/PC-joint-*.test.ts` | the joint rows below |

**PC-1a.** K and C run side by side from the start. K first commits the restored selection policy alone (ruling 1).

**PC-1b** starts from the merged PC-1a. These seams are frozen here. Each group codes against them, and the
typecheck must be green only at the end:

```ts
// P, src/contracts/prompts/prompt-set.ts (pure; WorkGraph and Runtime both import it)
export type PromptTextsV1 = { templates: Readonly<Record<string, string>>; strings: Readonly<Record<string, string>> };
//   every renderer that takes a pack takes this narrow type; a ResolvedPromptPackV1 satisfies it
export function decodePromptSetV1(value: unknown): PromptSetV1 | null;              // C wrote it in PC-1a
export function checkPromptBody(ref: ArtifactRef, record: { ref: ArtifactRef; body: string }, contentType: string):
  string | null;
//   the body's text when its digest, size and content type match the ref; null otherwise. Structural, because
//   contracts may not import record-store: a RawArtifactRecord and the contracts' ArtifactRecord both satisfy it.
// P, src/core/agent-runtime/prompt-set-texts.ts (Runtime only)
export function storePromptTexts(bodies: Pick<RawArtifactStorePort, 'put'>, origin: MaterialOrigin,
  parts: PromptPartsV1, requestedAt: string): Promise<{ status: 'ready'; value: PromptSetV1 } | CoreRejection>;
//   the bodies first, then the set (ruling 14)
export function readPromptTexts(bodies: Pick<RawArtifactStorePort, 'read'>, set: PromptSetV1):
  Promise<{ status: 'ready'; value: PromptTextsV1 & { base: BaseSystemPromptInput; skills: SkillContext[] } } | CoreRejection>;
// every manifest loader calls decodePromptSetV1 on `promptSet`:
//   P: execution-preparation.ts ~643, execution-entry-service.ts ~309
//   S: the Runtime query-execution.ts ~93
//   R: work-graph/queries/query-execution.ts ~427
// R, contracts/dispatch.ts ~347: ModelCallAccess.beforeCall input gains
//   prompt: ModelRequestPromptFactsV1 & { maxOutputTokens: number }      (Work and Query alike, ruling 24)
// R, contracts/query-job.ts ~356: QueryModelUsageV1 gains prompt: QueryRequestPromptFactsV1 (ruling 27)
// R, work-graph/queries/contracts.ts ~158: admitQueryModelRequest input gains prompt: QueryRequestPromptFactsV1
// R: ModelRequestReadPort (ruling 28); RuntimeDeps.promptPacks, RuntimeDeps.modelRequestReads (ruling 30);
//   RuntimeExecutionPort.readPromptRecord? (ruling 29)
// K (merged): the Kernel inputs of ruling 3, from public-api.ts
```

- `RawArtifactStorePort`, `RawArtifactRecord` and `MaterialOrigin` are `src/core/record-store/body-ports.ts` ~7–26;
  `ArtifactRef` is `src/contracts/artifact.ts` ~11.
- **As built in PC-1a** (audit 1): `promptSelectionOf` takes a structural parameter that every `BoundModel` satisfies,
  because contracts may not import core; the Kernel inputs' `skills` is `readonly SkillContext[]` (A2-01).
- `PromptPartsV1` is P's input type: the selection, the resolved pack, the used template ids, the merged base, and
  the Skills.

The joint rows run last, by one subagent, after P, S and R have all reported: PC-06, PC-07, PC-08, PC-09, PC-10 and
PC-15's platform cases.

## 5. Tests

### 5.1 Fixtures (Codex writes, the lead checks and freezes; in the base copy before the run)

- **`tests/helpers/PC-kernel-fixture.ts`** (PC-1a):
  - a scripted provider: text, tool calls, `reasoningContent` (thinking-only replies too), usage;
  - `runCodingAgent` with the new inputs: repeated runs on one Session, an input injected mid-run, and the public
    history read;
  - byte and fixed-count previews, sync and async;
  - a `RuntimeRunner` harness with a cap-changing hook;
  - adapter transport capture;
  - `selectContext` input builders.
- **`tests/helpers/PC-platform-fixture.ts`** (PC-1b):
  - **Work** prepare, start, pause and resume through the formal control steps (pause and resume are Work's only).
  - **Query** prepare and start.
  - **A continuation and a K3 review or proposal**, both reached through public steps.
  - **A scripted model** that records every request and can return `reasoningContent` and usage.
  - **An injectable `PromptPackSourcePort`** whose pack the test can change between steps.
  - **A custom Skill directory** the test can rewrite.
  - **An async counter.**
  - **A body store wrapper** that fails puts of one content type.
  - **The real Host registry**, installing a new binding and showing the pin. Also a Host that returns a different
    binding on its second resolution.
  - **Capture and replay** of the Work authorization command and of the Query reservation and admission commands,
    as written.
  - **`readPromptRecord` access.**
  - **`frozenPromptInputs(...)`** for direct `runObservedModel` callers. It builds the `prompt` option with the
    production functions of rulings 14–15; it is argument plumbing only.

### 5.2 Rows (spec §3.2; each RED then GREEN)

Every expected value is a literal or hand-computed: byte counts as `Buffer.byteLength` of hand-written JSON, digests
as `sha256` of a literal string. Never derive an expectation from production code.

- **PC-11 (K)** One input with all seven kinds:
  - two memories, a reference Skill and an additional instruction;
  - in history: a long and a short success result, an error result, an exchange, an old user message and a no-call
    assistant;
  - in the current run: two complete exchanges, a later input and an unclosed call.

  The test lists by hand each prefix's request and its byte count (UTF-8 bytes + 4,096, plus the output reserve). It
  sets budgets between neighbouring values, then checks the counts per kind and which message ids remain. Step 6
  comes after step 5. Binary search gives the same k as removing one unit at a time; the step-by-step reference lives
  in the test.
- **PC-12 (K)**
  - A long history success result gets the placeholder `output`; every other field is deep-equal.
  - An empty-`output` result, and one shorter than the placeholder, stay.
  - `error` and `cancelled` results stay through step 4.
  - Both adapters' captured bodies keep every call id matched by one result id.
- **PC-13 (K)** Protected content plus the instruction Skill cost one more than the budget: the result is
  `required_content_over_budget`, and the instruction Skill is in no removal step.
- **PC-14 (K)** A history turn; then, in the current run, a task input and an injected input. The budget fits only
  those two plus the base. The earlier run's content is removed, and both current user messages remain (checked by
  message id and text).
- **PC-15**
  - **K:** an async fixed-count preview (awaited) drives selection in `runCodingAgent`.
  - **S, the reserve follows the output:** an injected counter returns 700. The window is 1,000, the per-response cap
    256, the cumulative output cap 400. The first reply is a tool call with output usage 200. The two requests cost
    700 + 256 = 956 and 700 + 200 = 900.
  - **S, the platform case:** a long Host instruction, a `responseFormat`, a tight window, and removable history.
    Give the budget so that the request fits only after removing that history. The new code removes it and the meter
    accepts the request. On the base tree the same setup is rejected by the meter; record that in the reply.
- **PC-16 (K)** The fixture's fixed-count preview, count 700, window 900.
  - The hook raises the cap from 100 to 250. The re-check gives 950, which does not fit, so the provider is called
    zero times. Before the hook, 800 fitted.
  - The clamp case: a Host cap of 150 clamps the hook's 250. The re-check gives 850 and the provider receives 150.
- **PC-17 (K)** Two parts. A reply without tool calls ends the run (`run-state.js` ~407, runner ~643), so a current
  thinking-only message never reaches a later request of the same run; the second part reaches it through the public
  `selectContext` input instead. No production change may make a run continue after such a reply.
  - **Real runs (`runCodingAgent`, at least three on one Session):** run 1 ends with a thinking-only reply, run 2
    with a text-plus-thinking reply, run 3 first gets a calls-plus-thinking reply and then a second request in the
    same run.
    - `current_run`: run 3's second request carries run 3's thinking only; run 1's thinking-only message is absent;
      run 2's text stays without its thinking.
    - `none`: no thinking at all in that request; run 3's calls-plus-thinking message stays with its calls.
    - The public history read afterwards still shows every original thinking.
  - **`selectContext` small input (PE4) and adapter capture (PE7):** the current part holds a thinking-only message.
    - `current_run`: it stays in the selected copy, and the DeepSeek body carries it. The OpenAI body has no item for
      it: that adapter sends text and calls only and never thinking (`openai-model-client.js` ~27; spec ~156).
    - `none`: the selector drops it.
  - Both adapters' bodies match hand-written protocol shapes of today's adapters. The adapters do not change.
  - The real runs use the fixture's `run`, called once per run; `twoRuns` is only a shorthand.
- **PC-06 (P, S, joint)**
  - After preparation, change the injected pack (the `base` text and a string label) and the custom Skill file.
  - The model still receives the prepared system and input, for Work and for Query.
  - The entry's brief and review checks still pass.
  - The set's digests equal `sha256` of the literal texts.
  - PC-2 adds the person's-pack and settings variants later.
- **PC-07 (S, joint, Work)** Pause through the formal control step, change the injected pack and the Skill file, and
  resume. The system received is byte-equal to the first.
- **PC-08 (S, joint)**
  - A Host returns a binding with another `promptPack` on the second resolution: Work start is `forbidden`, and the
    model is called zero times.
  - Through the real Host registry: a new binding installed after preparation leaves this execution on the old one.
  - PC-2 adds the settings route variant.
- **PC-09 (R, joint)** A Work and a Query execution, each with a tool call then a final answer. After the second
  request ends, read `readPromptRecord` afresh:
  - two requests, in `sequence` order, each with both digests, the removal counts and the cap (`maxOutputTokens` or
    `reservedOutput`). The fixture's clock gives both Work permits the same `issuedAt`.
  - the same `toolSpecsRef` twice;
  - `sha256` of each returned text equals its digest;
  - the system rebuilt by hand from the returned base and Skill texts has the recorded `systemDigest`. The test
    writes the sections literally, as `context-builder.js` ~20 writes them.
  - Replaying the captured Work authorization command with one changed fact gives `idempotency_conflict`; so does
    replaying the Query reservation with one changed fact.
- **PC-10 (S, joint)** The body store fails only `PROMPT_TOOL_SPECS_CONTENT_TYPE`. Work and Query fail `unavailable`,
  and the model is called zero times. Preparation had succeeded.

### 5.3 Old tests to change (only these, only for this reason)

- **Platform Skills (P):** `tests/runtime/W2-role-skills.test.ts` ~33, `tests/app/AG6-agent-assembly.test.ts` ~52
  and ~178, and `tests/runtime/C2-runtime-platform-tools.test.ts` ~63.
  - They now check the content from the pack and from the frozen set.
  - The explicit subset, the empty selection and the custom directory stay covered.
  - Do not keep a copy of the old directory to make an old assertion pass.
- **Direct `runObservedModel` callers (S).** Ruling 22's required `prompt` option means these callers get
  `frozenPromptInputs(...)` instead of `skills`/`systemInstruction`:
  - `tests/runtime/B1-kernel-assembly.test.ts` ~89;
  - `tests/data/cpp-source-index.test.ts` ~148;
  - `tests/runtime/R4c-execution-history.test.ts` ~54, `R4c-graph-history.test.ts` ~234,
    `R4c-session-continuity.test.ts` ~66;
  - `tests/runtime/source-text-loop-migration.test.ts` ~186, `source-tool-lifecycle.test.ts` ~125.

  Their arguments change and their assertions do not. One exception: `B1-kernel-assembly` ~189–200 tests the old
  `skills` option (a custom Skill reaches the system, an explicit empty list selects nothing, a mutation after the
  call is ignored). Those three cases move to preparation (public prepare and start) with the same three
  expectations; the third becomes "a change after preparation is ignored".
- **Hand-written manifests get `promptSet` (P).** Only the places that write a manifest, not those that write a
  binding alone; `sectionOrder` in bindings is PC-2's. The candidates:
  - `tests/helpers/WP1-units-fixture.ts`;
  - `tests/runtime/K3-35-manifest-trim-pure.test.ts`, `tests/runtime/K3-unknown-call-review-section.test.ts`;
  - `tests/scenarios/S3-context-and-inputs.test.ts`;
  - `tests/state/context-input.test.ts`, `tests/state/WP1-goal-content.test.ts`;
  - `tests/work-graph/S3-prepared-context-admission.test.ts`.
- **Manifest size (P).** The K3-35 shrink tests (`K3-35-manifest-trim-pure`, `tests/work-graph/K3-35-owner-manifest-trim`):
  - where a boundary moves only because `promptSet` adds bytes (rule 1), re-compute the expected values by hand and
    say so;
  - nothing else changes in them.
- **Request facts (R):**
  - `tests/work-graph/A2-step1-codecs.test.ts`: add accept and reject cases for the new fields;
  - `tests/helpers/B2-execution-fixture.ts` ~316 and `tests/work-graph/B2-model-request.test.ts`: add the facts where
    a model request is written.
- **Checked; no change needed:**
  - the other §3.3 grep hits (`S2C-X-scale-fixture`, `k3-run-reconcile`, `run-machine`, `C2-mailbox-admission`):
    input bindings, not model requests;
  - the fixtures that only pass a platform-root Skill selection: `S4C2-assembly` ~107, `K-readonly-command` ~151 and
    ~273, `C2-runtime-platform-fixture` ~143, `RL-query-fixture` ~83, `S2B-be1-platform-fixture` ~255, and
    `host-settings.test` ~453 and ~706. Ruling 15 recognises the root by path;
  - `tests/kernel/B2-history-public-export.test.ts`: no new runtime export;
  - `tests/kernel/R4a-frozen-public.test.ts`: the optional inputs; report any failure;
  - `tests/runtime/B2-runtime-execution.test.ts`: the Host instruction is still inside `systemPrompt` (~85), and the
    read is a separate port (~314);
  - the pure renderer tests: the compatible call (ruling 14).

## 6. Size, checks, reply

| Group | Lines (Codex's estimate, tests included) |
| --- | ---: |
| K | about 1,100 |
| C | about 800 |
| P | about 1,200 |
| S | about 1,100 |
| R | about 1,200 |

Generated `dist` and the generated pack module are not counted. Report the real numbers per group, and why when one
is over by more than a third.

**Checks.**
- **PC-1a:**
  - `node scripts/build-kernel-patch.mjs --check`;
  - `node scripts/build-platform-prompts.mjs --check`;
  - typecheck, `check:architecture`, build;
  - the new and changed test files, plus `tests/kernel`, `tests/architecture` and `tests/app`.
- **PC-1b:** the same, plus the test files that import a changed file, as the run sheet lists them.
- One vitest command at a time per subagent, `--maxWorkers=2`. No real model calls, no network, no git pushes, never
  ports 3080, 3099 or 44797.

**Reply** (under 1,200 words):
- per ruling and per row, RED → GREEN;
- the files with lines added and removed, per group;
- each old test changed, and why;
- what PC-15's platform case did on the base tree;
- the remaining generated-pack importers (ruling 14);
- the allowlist entries added or removed;
- the checks, with numbers;
- UNSPECIFIED.
