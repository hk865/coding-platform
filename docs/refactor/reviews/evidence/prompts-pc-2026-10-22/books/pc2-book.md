# Task: PC-2 — prompt packs on disk, editing, selection, section order, the stale-files reminder and tool declarations (decision 83-4; lead, 2026-10-22, v4, frozen)

This book is v4, **frozen** on 2026-10-22 after two full reviews by Codex and one quick check; v4 applies the quick
check's two findings and the lead's two items on v3. Its line numbers are against
`dc462a95` plus W's commit `87f16ba` (the ten tool factories take `texts?`). It builds on PC-1's frozen interfaces
(book `pc1-book.md` §3.2) and PC-1a's interface table (`pc1a-am-reply.md` §4). Two as-built notes bind:
`promptSelectionOf` takes a structural parameter that every `BoundModel` satisfies; the Kernel inputs' `skills` is
`readonly SkillContext[]`. The user answered Q-1 on 10-22 with option (b): a person's pack may change the platform
tools' texts (decision 83-5, the spec's post-note; §3.6).

The prompts spec (`docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md`, frozen 10-21) is
built in two pieces. **PC-1** did the Kernel patch, freezing, the request records and their read. **PC-2** (this book)
is the spec's §5 second part:
- the person's packs on disk, their resolution, validation and editing routes (P1);
- `promptPack` and `reasoningReplay` in the settings model (P2);
- section order (P10);
- the stale-files reminder (P8);
- the `base` template's tool blocks and the `mentionsTools` checks (P9);
- the platform tools' texts from a person's pack, frozen and handed to the tools (decision 83-5).

**PC-2 is one run.** Groups A, H, T, G, Q and the W rework for check rulings 8 and 16 run together, then the joint
rows. The tree is green at the end of the run, not between groups, so the new required fields and all their producers
land in the same run. The groups keep disjoint files. A freezes its resolver interface first; T freezes the rendering
material and the role-reminder slot before G and Q code against them. W's ten factories already take `texts?`; W
returns as a small rework group for the per-tool fallback and the whiteboard parameters.

In this book, `ruling N` means the book's own ruling in §3. A reference to Codex's 17 check rulings says
`check ruling N`.

## 1. What to read

- The spec: the post-note; §0.1 items 3–4; §0.2 F5–F7, F13, F14, F18, F20 (re-located in §3 below); §0.3 **P1**,
  **P2**, P5's freezing of the pack and the entry re-render, **P8**, **P9**, **P10**; §2; §3.1 PE1, PE2, PE8, PE9;
  §3.2 **PC-01…PC-05, PC-18…PC-23**, and the PC-2 variants of PC-06 and PC-08; §3.3 (the brief-sentence, section-order
  and review-shrink bullets); §6.
- PC-1's book §3.2 (the contracts PC-2 builds on), PC-1a's interface table (`pc1a-am-reply.md` §4), and PC-1's
  evidence README.
- Decision 79: old records are not read; `sectionOrder` is required in every binding.
- The inventory `./.dsh-ref/inv-pc2.out.md` (Codex, Chinese) and Codex's check `./.dsh-ref/pc2chk1.out.md`; the
  rulings below answer both.
- `./.dsh-ref/coordinator-mode.md` (the test rules bind every brief); TDD as `./.dsh-ref/tdd/` says.

## 2. Rules (all groups)

1. **What changes in what the model receives.** Only these, all from the spec:
   - **`base` v2:** the `check` line is gone, and the tool sentences render by the final tool list (ruling 16).
   - **New platform section order** (ruling 9). The reminders section moves last.
   - **The stale-files reminder** at the end of the role section, when the run takes Session history (ruling 14).
   - **The continuation brief** loses its stale-files sentence.
   - **A person's pack**, once one is selected.
   - **The one frozen tool list** renders every used template: `base`, the Skills, the continuation brief, the review
     and proposal texts, the K3 shrink re-render and the entry re-render (check ruling 4). The Skills render like `base`,
     through the renderer with the final list and no slots (check ruling 5a).
   Everything else stays byte-identical.
2. Tests through public steps, hand-computed literals, no database reads, no hand-written facts (coordinator-mode).
   The scenario harness's automatic invariants and its SQL helpers (`tests/scenarios/harness.ts` ~626–667,
   `support/brief.ts`) are not acceptance for new rows; pass `invariants: false` where a new row uses the harness.
3. Old tests: only §3.3's PC-2 bullets and §5.3 below, only for the reason named; anything else that fails is
   reported, never loosened. Each old test file has exactly one owner group (§4). `tests/architecture/production-reach-allowlist.json`
   is Q's: Q edits it once in the joint step. Every other group reports the entries it adds, removes or keeps. An
   entry may remain only when the reply names the consumer that a later slice adds; otherwise Q removes it.
4. State transitions only through `src/core/work-graph/state/`; the guard changes stay in `state/context-input.ts`.
5. Fixtures in `tests/helpers/PC2-*.ts` are frozen (Codex, lead); report a row they cannot carry.
6. Comments follow decision 35.

## 3. Lead rulings

### 3.1 Packs on disk (groups A and H)

1. **Where.** A person's pack is `<settings directory>/prompts/<packId>/`, the settings directory being the one the
   Host already resolves (`main.ts` ~154–163; default `<storage>/host-settings`, `host.ts` ~325–330). A Host without
   a settings directory has the platform pack only, and the editing routes do not exist there, as the settings routes
   do not. Pack ids match `^[a-z0-9][a-z0-9-]{0,63}$`; `platform` is reserved.
   Each pack's real directory, and each parent pack's real directory, lies inside the real `prompts/` directory. So do
   the real parent directories of `pack.json` and of every save target (check ruling 7).
2. **The two directory checks** (spec P1). Compare real paths by path segments (`path.relative` neither starts with
   `..` nor is absolute), never by string prefix. Do not use `canonicalExisting` (`host.ts` ~633–635): it falls back to
   the given path when `realpath` fails.
   - **At start** (`host.ts` ~331, next to `validateWorkspaces` ~219–244): create `prompts/` and take its real path.
     Each configured workspace root, and after the settings file is parsed each restored root (`host-settings.ts`
     ~461, before the restore loop ~569), is compared with it. If the prompts directory equals a root or lies under
     it, the Host fails to start with a configuration error naming both.
   - **On opening a workspace** (`openWorkspaceImpl`, `host.ts` ~869): after its `realpath` and directory check
     (~871–878), before the existing-root shortcut (~889–893) and any registration. A new root that equals the prompts
     directory or contains it is `invalid`, with a reason saying it would cover the prompt directory.
   - **Each pack and parent.** A pack's real directory and every parent's real directory lie inside the real
     `prompts/` directory. A linked `prompts/mine` that points at a workspace is rejected here even when the two
     checks above pass.
3. **Reading** (group H, new `src/app/prompt-packs.ts`):
   - Read the pack asynchronously at every preparation through PC-1's `PromptPackSourcePort`: `pack.json`,
     `strings.json`, the template files and the tool files, then its `extends` chain. `platform` comes from the
     generated module.
   - No cache across preparations.
   - Every file named in a manifest is a relative path inside the pack directory: no `..` **segment**, not absolute,
     and its real path is inside the pack's real path. Reject a `..` segment, never `..` inside a name (`..name` is
     legal). The real parent directory of `pack.json` and of every save target is inside the real `prompts/` tree.
   - The Host's port wiring replaces PC-1's platform-only source (`src/composition/create-platform.ts`, H).
4. **Resolution and validation** (group A, pure, new `src/contracts/prompts/resolve-pack.ts`). The input is the read
   files of a chain. The output is the full validation result, not a throw:

   [DSH choice: the chain-entry file-text shape and the problem fields; the merge and validation rules are the rulings']

   ```ts
   // src/contracts/prompts/prompt-pack.ts:3-27, extended by A for PC-2
   export type PromptPackProblemV1 = {
     packId: string;
     templateId: string | null;   // null for a pack-level problem
     toolName?: string;
     reason: string;
   };

   export type PromptPackChainEntryV1 = {
     packId: string;
     manifest: { file: string; text: string };
     strings: { file: string; text: string };
     templates: Readonly<Record<string, { file: string; text: string }>>;
     tools: Readonly<Record<string, { file: string; text: string }>>;
   };

   export type ResolvedPromptPackV1 = {
     manifest: PromptPackManifestV1;
     templates: Readonly<Record<string, string>>;
     strings: Readonly<Record<string, string>>;
     tools: Readonly<Record<string, ToolTextV1>>;
     origins: Readonly<Record<string, { packId: string; version: number; mentionsTools: readonly string[] }>>; // PC-1, extended
     toolOrigins: Readonly<Record<string, string>>;                          // PC-2
   };

   export type PromptPackValidationV1 =
     | { status: 'ready'; value: ResolvedPromptPackV1 }
     | { status: 'rejected'; problems: PromptPackProblemV1[] };

   export function resolvePromptPackV1(chain: readonly PromptPackChainEntryV1[]): PromptPackValidationV1;
   ```

   - **Identity.** `schemaVersion` is 1. `packId` equals the chain entry's id. `extends` is `null` for `platform`,
     else one parent id; the chain has each id once, ends at `platform` and has no cycle. Effective `manifest` is the
     requested pack's own; the three maps are merged.
   - **Strings.** An object whose values are strings. An unknown key is a problem. The fixed keys of ruling 5 are
     problems. Merged by key, child over parent.
   - **Templates.** File, positive integer version, and `mentionsTools` string array. By id from the nearest pack.
     `origins[templateId] = { packId: supplier, version: supplier's manifest version, mentionsTools: supplier's
     manifest entry's mentionsTools }`: all three come from the supplying pack's manifest entry
     (`PromptPackManifestV1.templates`, `prompt-pack.ts:11`). `prompts/templates/read`
     returns those values, and the declaration check (ruling 18) reads `mentionsTools` there, not from the effective
     manifest, so a child that overrides only `base` still sees the platform's declarations. This extends PC-1's
     `origins` (`{ packId, version }`), recorded at merge; T generates the platform values.
   - **Tools** (decision 83-5), by whole entry from the nearest pack. The output gains
     `toolOrigins: Readonly<Record<string /* tool name */, string /* packId */>>`. `parameters` is an object whose
     values are strings. Problems:
     - a tool the platform pack has no text for (this covers the Kernel's own tools, such as read and shell): "tool
       <name> has no platform text";
     - an empty `description`, or a `parameters` value that is not a string;
     - a `parameters` key set different from the platform entry's (text only, like slots): "tool <name> parameters
       differ".
   - **Rejected:** a missing parent; a cycle; an unknown template id (the code's slot tables define the ids); a
     non-positive or non-integer version; an unknown string key; a broken file or bad JSON.
   - **Template checks**, reusing the D3 parser (`render-template.ts` ~86–139; it already allows nesting):
     - an unknown slot;
     - a slot used twice;
     - a required slot missing from the template text;
     - a stray `{{`;
     - in an input template, a section slot that is not at top level (inside a block), is missing, or is extra. An
       input template holds every section slot its call kind has (P10, no more, no fewer);
     - an illegal section order (ruling 9).
     An optional slot may be left out of the template; a required slot appears exactly once.
   - **Validation runs** on load, on save and at preparation. It collects every problem in one result and never
     throws.
   - **A pack problem at preparation is `invalid`**, naming pack, template and reason. Today a renderer error becomes
     `unavailable` (`execution-preparation.ts` ~487, `query-preparation.ts` ~242). Pack and template problems and an
     empty required slot at render time use one distinguishable error class mapped to `invalid`; other failures keep
     their codes. Never fall back to `platform`.

   [DSH choice: the error class name and its code set]

   ```ts
   // A's new class; the current empty required-slot check is render-template.ts:207
   export class PromptRenderError extends Error {
     readonly code: 'template_invalid' | 'required_slot_empty' | 'illegal_section_order';
     readonly templateId: string;
     readonly slot: string | null;
   }
   ```

   PE8 has a row for an empty required slot value injected through preparation (check ruling 11).
5. **Fixed strings.** The omission markers the state guard checks (`context.omissions.heading`, `.prefix`,
   `.suffix`, `.nameSeparator`; guard `state/context-input.ts` ~60–62) are structure, not prose. A person's pack may
   not override them (a problem "string <key> is fixed"). The guard keeps its literals.
6. **The editing routes** (group H). They sit in the settings branch: prefix `host-settings-types.ts` ~8, route
   table ~96, suffix table `host-settings.ts` ~55–63, dispatch ~883. Access is the settings routes' own gate (token
   and same origin, `server.ts` ~329–365); "只认人" means this class, and no new principal mechanism is added.
   `SettingsResponse` (`host-settings-types.ts` ~107) gains `revision_conflict` and an optional `problems` list.
   HTTP 409 is already mapped (`server.ts` ~155).

   [DSH choice: the route DTO field names; `save` returns the same description as `read`]

   ```ts
   // src/app/host-settings-types.ts:96-111, extended by H for PC-2
   export type PromptPackListV1 = {
     packs: {
       packId: string;
       extends: string | null;
       problems: readonly PromptPackProblemV1[];
       templates: readonly {
         templateId: string; version: number; fromPack: string; problems: readonly PromptPackProblemV1[];
       }[];
     }[];
   };

   export type PromptPackCreateV1 = {
     packId: string;
     extends: 'platform';
     templates: readonly [];
     strings: Readonly<Record<string, never>>;   // the new strings.json, `{}`
     tools: Readonly<Record<string, never>>;     // `{}`
   };

   export type PromptTemplateReadV1 = {
     templateId: string;
     version: number;            // origins[templateId].version
     fromPack: string;           // origins[templateId].packId
     text: string;
     slots: TemplateSlotTableV1;
     mentionsTools: readonly string[];   // origins[templateId].mentionsTools
   };

   export type PromptTemplateSaveV1 = PromptTemplateReadV1;   // the new version's description
   export type PromptToolReadV1 = {
     toolName: string;
     fromPack: string;
     entry: ToolTextV1;
     digest: string;             // sha256 of ruling 19's canonical body
   };
   export type PromptToolSaveV1 = PromptToolReadV1;

   export type SettingsRoutes = {
     // ... the existing routes ...
     'prompts/packs/list': { input: Record<string, never>; value: PromptPackListV1 };
     'prompts/packs/create': { input: { packId: string }; value: PromptPackCreateV1 };
     'prompts/templates/read': { input: { packId: string; templateId: string }; value: PromptTemplateReadV1 };
     'prompts/templates/save': {
       input: { packId: string; templateId: string; expectedVersion: number; text: string; mentionsTools: string[] };
       value: PromptTemplateSaveV1;
     };
     'prompts/tools/read': { input: { packId: string; toolName: string }; value: PromptToolReadV1 };
     'prompts/tools/save': {
       input: { packId: string; toolName: string; expectedDigest: string; entry: ToolTextV1 };
       value: PromptToolSaveV1;
     };
   };

   export type SettingsResponse<T> = { status: 'ready'; value: T }
     | { status: 'rejected';
         code: 'invalid' | 'forbidden' | 'not_found' | 'revision_conflict' | 'unavailable' | 'unsupported';
         reason: string; problems?: readonly PromptPackProblemV1[] };
   ```

   - **Unknown pack, template or tool** is `not_found` (`SettingsResponse` already has it).
   - **A broken body, bad JSON or a bad entry** is `invalid` with `problems`.
   - **`list`** is ready even when a pack is broken. That pack keeps its `problems`; an unreadable manifest gives
     `templates: []`. Packs are listed `platform` first, then by id.
   - **`packs/create`** with `platform` is `forbidden`; an existing id is `invalid`.
   - **`platform` save** is `forbidden`; a version or digest mismatch is `revision_conflict`.
   - **No settings port** keeps today's `unsupported` (`server.ts` ~343).

   **Save, in order:**
   1. `platform` is `forbidden`, before anything else.
   2. `expectedVersion` must equal the effective version (for a template the pack inherits, the parent's), else
      `revision_conflict`.
   3. Validate the whole pack as it would be after the save. A failure is `invalid` with the problems, and no file
      changes.
   4. Write the new text to a new file `templates/<templateId>@<newVersion>.txt`, with `newVersion` = effective
      version + 1.
   5. Replace `pack.json` atomically (temp file and rename, as `host-settings.ts` ~505–518), pointing the template at
      that file with its version and `mentionsTools`. A failure before the rename leaves the visible version as it
      was. Old version files stay.
   Saves are serialized like settings saves (~901).

   **Saving a tool text** follows the same steps, with two differences:
   - Step 2 compares `expectedDigest` with the digest of the effective entry (for an entry the pack inherits, the
     parent's): `sha256` of ruling 19's canonical body. A difference is `revision_conflict`.
   - Step 4 writes the canonical body to a new file `tools/<toolName>@<first 16 hex of its digest>.json`, and step 5
     points `tools[toolName]` at it.

### 3.2 Selection (group H)

7. **The settings model** gets optional `promptPack` and `reasoningReplay`:
   - in the public type and the save DTO (`host-settings-types.ts` ~10–18, ~69–89);
   - in the stored model, parse, initial and save (`host-settings.ts` ~100–122, ~375–390, ~424, ~609–668).
   Save checks the syntax only: a pack id, or `current_run` / `none`. A missing pack is found at preparation
   (`invalid`). The read projection shows a field only when it is set (~528–540); defaults apply at resolve (PC-1
   ruling 13).
   - **Saving a model without `promptPack` or `reasoningReplay` clears that field** in the stored model. It resolves
     to `platform` or `current_run` at resolve; the read projection shows no field.
   - The startup catalog only initializes its private options map. It never restores a pack or a reasoning policy over
     a later settings save. After a restart the later save is still in force.
8. **`settingsModelBinding`** (`host.ts` ~667–683) passes `promptPack` and `reasoningReplay` into the trusted model
   configuration. PC-1 already gave that configuration `modelId` and the fields, and pins and compares them.

### 3.3 Section order (groups T, G, Q)

9. **Order lives in the input templates.**
   - `work-input`, `query-planning-input` and `query-copy-input` keep one top-level section slot per section they
     carry (`slot-tables.ts` ~16–41). An input template holds every section slot its call kind has (P10, no more, no
     fewer). An optional section slot may be absent from a non-input template; a required slot appears exactly once.
   - A call kind's order is the template's slot order projected onto that call kind's legal sections
     (`state/context-input.ts` ~65–73; this table does not change). `work-input` carries both `continuation` and
     `unknown_call_review`; each call kind keeps only its legal ones.
   - Legal: `role` first; each section at most once; nothing outside the call kind's set.
   - The platform pack v2 `work-input` order: role, goal, task, footprint, notes, inputs, continuation,
     unknown_call_review, reminders. The two Query templates keep their order.
   - Template versions go up by one. The five Skill templates also go to version 2 for the tool blocks (check ruling 5b).
10. **Rendering** (`context-rendering.ts`).
    - Display follows the frozen order.
    - The budget order stays footprint, notes, reminders, inputs, with the longest-prefix choice (~94–125); a
      template cannot change it.
    - Section ranges come from the actual rendering. The `sections` array follows the frozen order and includes
      wholly omitted sections (null ranges).
    - `residentBytes` is the bytes the budget choice billed, not the difference between the last optional and last
      required section ends (~218).
    - Omission notes stay in their own sections.
    - **One frozen tool list renders every used template:** `base`, the Skills (no slots), the continuation brief,
      the review and proposal texts, the K3 shrink re-render and the entry re-render. `renderTemplate`'s
      `finalToolNames` argument (`render-template.ts` ~186–191) is the frozen `PromptSetV1.toolNames`, never `[]`
      and never recomputed from the pack. T owns the Skill render and these two renderers:

      ```ts
      // src/contracts/continuation-brief.ts:434 (T); PC-1's form plus the tool list
      export function renderContinuationBriefZh(
        brief: ContinuationBriefV1,
        digest: string,
        pack?: PromptTextsV1,                // PC-1: absent means the generated pack
        toolNames?: readonly string[],       // absent means every tool present
      ): string;

      // src/contracts/core/prepared-execution.ts:102 (T); the proposal phase is the same function
      export function renderUnknownCallReviewZh(
        input: UnknownCallReviewInputV1,
        pack?: PromptTextsV1,
        toolNames?: readonly string[],
      ): string;
      ```

      Absent `pack` and `toolNames`, each renderer uses the generated pack and renders every tool block (every
      tool present), so the old direct tests (`C3-brief-timeline` ~121, `K3-16-proposal-input` ~152,
      `A2-rework-contract-helpers` ~389) need no new argument. Production always passes both:

      - Work preparation: `context-work-recipe.ts:244` (brief) and `context-review-recipe.ts:117` (review) pass the
        resolved pack and the frozen tool list.
      - The review shrink: `execution-preparation.ts:551` passes the resolved pack and the frozen tool list.
      - The entry: `execution-entry-service.ts:975`, `:1201` (brief) and `:1053` (review) pass the frozen texts read
        back and `promptSet.toolNames`.

      T adds one pure Skill render helper in `context-rendering.ts`. Q calls it when it builds each `SkillContext`
      from the resolved pack, so no group edits another's file.
11. **The binding** (`graph-context.ts` ~104) gets the required `sectionOrder`, written by the recipes
    (`context-work-recipe.ts` ~300, `context-query-recipe.ts` ~80). `PromptSetV1.sectionOrder` now comes from the
    templates; PC-1 filled it with today's fixed order. The binding's order equals the frozen set's order for that
    call kind, element for element.
12. **The guard and the entry.**
    - The guard (`state/context-input.ts`) drops `SECTION_ORDER` (~44–49).
      - It checks the binding's `sectionOrder` itself: `role` first, each once, inside the call kind's set, `goal`
        and `task` present where required today (~280).
      - Then it checks that the sections appear in that order.
      - It accepts the re-rendered text and checks two things on it: the binding's byte range equals that text
        (`utf8Slice`) and the text occurs exactly once in the input. The range check is not only an equality of the
        range's ends.
      - The brief and the review instruction are no longer required to be last or to end at the end (~173–208,
        ~294–313).
    - The entry (`execution-entry-service.ts` ~973, ~1053, ~1201) reads the frozen template text and string table
      back, re-renders the brief and the review with the frozen tool list, and calls the guard's range-and-unique
      check. It never reads the current pack.
      The rejection code for a changed character stays `invalid` (`run-machine.ts` ~1549, ~1563).
    - Invariant I-19 (`tests/state/invariants.ts` ~1862–1866) checks by the binding's range in the same way and does
      not assume the marker sits on a fixed line.
    - PE9 has separate rows for a wrong range, a duplicated text and a non-tail success.
13. **The review shrink** (`execution-preparation.ts` ~519–557, the cut at ~542–561):
    - Each candidate re-renders the whole input from the frozen pack with the same slots, the review slot replaced.
    - It recomputes every range and the digest, then measures the manifest.
    - The assembler hands back this material, not `reviewSectionStart` (`context-types.ts` ~51):

      [DSH choice: the names `ContextRenderMaterialV1` / `ContextSectionPlanV1` / `rerenderContextV1` and the shape; the fields are what today's assembler discards]

      ```ts
      // src/core/agent-runtime/context-types.ts (T)
      export type ContextTemplateId = 'work-input' | 'query-planning-input' | 'query-copy-input';

      export type ContextSectionPlanV1 = {
        name: ContextAssemblyBindingV1['sections'][number]['name'];
        omitted: number;          // omitted rows; the whole section when wholeOmitted
        wholeOmitted: boolean;    // rendered with a null range
      };

      export type ContextRenderMaterialV1 = {
        pack: ResolvedPromptPackV1;
        templateId: ContextTemplateId;
        slots: Readonly<Record<string, string | undefined>>; // every slot except unknown_call_review
        toolNames: readonly string[];                        // PromptSetV1.toolNames
        residentBudgetBytes: number;                         // the budget choice
        residentBytes: number;                               // the bytes actually billed
        sections: readonly ContextSectionPlanV1[];           // frozen display order and omission state
      };

      export type ContextRerenderV1 = {
        input: string;
        sections: ContextAssemblyBindingV1['sections'];
        residentBytes: number;
        totalBytes: number;
      };

      // src/core/agent-runtime/context-rendering.ts (T)
      export function rerenderContextV1(
        material: ContextRenderMaterialV1,
        review: string,
      ): ContextRerenderV1;
      ```

      `context-types.ts` exports `ContextTemplateId`; `context-rendering.ts` imports it. `rerenderContextV1` lives in
      `context-rendering.ts`. It replaces only `unknown_call_review`, renders the frozen slots and pack once,
      recomputes every range and `totalBytes`, and copies `residentBytes` and the omission metadata unchanged; it
      does not run the budget choice again. `AssembledContextV1` replaces `reviewSectionStart` with the required
      `renderMaterial` (L4); the work and query recipes fill it after their one render. The shrink calls
      `rerenderContextV1` for each candidate and replaces the input, sections, digest and manifest measure from its
      result. No prefix cut remains.

### 3.4 The stale-files reminder (groups T, Q)

14. **Decided at preparation, honoured at start.** One pure function is the one rule both call:

    [DSH choice: the names `sessionHistoryDecision` / `SessionHistoryDecisionInputV1` / `CompletedHistoryBoundaryV1` and the `HistoryDecisionV1` shape; the modes are today's start rules]

    ```ts
    // src/core/agent-runtime/context-types.ts (T); context-history-facts.ts imports it (Q)
    export type HistoryDecisionV1 =
      | { mode: 'current_turn'; takesSessionHistory: false }
      | { mode: 'session_history'; takesSessionHistory: true;
          throughPosition: number; sourceSessionId: string | null };

    export type CompletedHistoryBoundaryV1 = { cursor: string | null; position: number };

    export type SessionHistoryDecisionInputV1 = {
      callKind: 'work' | 'query';
      sessionBasis: { sourceKernelSessionId: string; throughPosition: number | null } | undefined;
      completedBoundary?: CompletedHistoryBoundaryV1;   // C7: absent only for a Query with sessionBasis
    };

    // src/core/agent-runtime/context-history-facts.ts (Q)
    export function sessionHistoryDecision(input: SessionHistoryDecisionInputV1): HistoryDecisionV1;
    ```

    - **Work:** `sessionBasis` with a non-null `throughPosition` and no cursor gives that basis's boundary and
      source; else a cursor gives its position and no source; else `current_turn`. (`execution-driver.ts` ~681–689.)
    - **Query:** `sessionBasis` ? `throughPosition !== null` gives that basis, else `current_turn`; without
      `sessionBasis`, a cursor gives its position and no source, else `current_turn`. (`query-execution.ts` ~473–501.)
    - `takesSessionHistory` is `mode === 'session_history'`.
    - **Who reads the boundary.** Q reads it once, in preparation, and passes it in. Work and a Query without
      `sessionBasis` pass the real completed boundary; a Query with `sessionBasis` passes none. The recipe never
      reads a boundary, and the Query-with-basis branch never invents a zero one (C7).
    - **Who calls the rule.** The recipe calls `sessionHistoryDecision` exactly once: Work after its seed is fixed
      (`context-work-recipe.ts` ~235–255); Query with the basis Q passed in. `AssembledContextV1.historyDecision`
      returns the decision it used. Q freezes `takesSessionHistory` from it unchanged and never recomputes the rule.
      Query's `sessionBasis` is computed before the input is assembled (`query-preparation.ts` ~235–254).
    - The value goes into the prepared manifest as `takesSessionHistory: boolean`, inside the digest. The field type
      is T's (`src/contracts/core/prepared-execution.ts` ~229, ~286, and the two Query manifest readers).
    - At start the rule runs again. If it would take history but the frozen value is `false`, the start uses
      `current_turn`, so a run never gets history its input did not announce. A frozen `true` cannot turn false,
      because a cursor never disappears.

    **The assembler seam (C6).** T owns these input and output additions in `context-types.ts`; Q makes the calls:

    [DSH choice: the names `ContextWorkHistoryInputV1` / `ContextQueryHistoryInputV1` / `SessionBasisV1`; the ruling freezes what crosses the seam, not the names]

    The resolved pack reaches the assembler as PC-1 passes it (PC-1 ruling 13 step 3): its name and place in the
    input are PC-1's, as built. PC-2 does not move it. PC-2 adds only `toolNames` and `history` beside it.

    ```ts
    // src/core/agent-runtime/context-types.ts (T)
    export type SessionBasisV1 = { sourceKernelSessionId: string; throughPosition: number | null };

    export type ContextWorkHistoryInputV1 = {
      callKind: 'work';
      completedBoundary: CompletedHistoryBoundaryV1;
    };

    export type ContextQueryHistoryInputV1 =
      | { callKind: 'query'; sessionBasis: SessionBasisV1 }
      | { callKind: 'query'; sessionBasis?: undefined; completedBoundary: CompletedHistoryBoundaryV1 };
    ```

    `assembleTask` and `assembleQuery` each gain `toolNames` and `history`; `AssembledContextV1` gains the two
    required fields. T freezes these before G and Q code; Q calls them:

    ```ts
    // src/core/agent-runtime/context-types.ts (T), the assembler additions
    export type AssembledContextV1 = {
      // ... PC-1's fields ...
      historyDecision: HistoryDecisionV1;       // C6
      renderMaterial: ContextRenderMaterialV1;  // ruling 13, L4
    };

    export interface ContextAssembler {
      assembleTask(ctx: CoreCallContext, input: {
        // ... today's fields, and PC-1's pack argument as built ...
        toolNames: readonly string[];          // the frozen PromptSetV1.toolNames
        history: ContextWorkHistoryInputV1;
      }): Promise<ReadResult<AssembledContextV1>>;
      assembleQuery(ctx: CoreCallContext, input: {
        // ... today's fields, and PC-1's pack argument as built ...
        toolNames: readonly string[];
        history: ContextQueryHistoryInputV1;
      }): Promise<ReadResult<AssembledContextV1>>;
      // readAttentionGraph stays as it is.
    }
    ```
15. **Where it goes.**
    - When `takesSessionHistory` is true, the `stale-files-reminder` template (new, no slots) is appended once at the
      end of the role section, inside the role range (`context-work-recipe.ts` ~84, `context-query-recipe.ts` ~41,
      the role slot `context-rendering.ts` ~124–141).
    - It is there also when all four budget sections are omitted (the fallback ~159).
    - The brief's sentence (`templates/continuation-brief.txt` ~5) is deleted; that template's version goes up by one.

### 3.5 Tools (groups T, Q)

16. **The final tool list is computed once, at preparation.** Freeze the function before construction:

    [DSH choice: the names `finalToolNamesOf` and `FinalToolListInputV1`; every field is a fact the current call site has]

    ```ts
    // src/core/agent-runtime/tool-group-assembly.ts:40 (the result shape), :428-445 (today's output order)
    export type FinalToolListInputV1 = {
      callKind: 'work' | 'query';
      selected: readonly string[];                 // manifest.permissions.tools (execution-driver.ts:448)
      readOnly: boolean;                            // execution-driver.ts:722; Query always true
      reviewPhase: 'review' | 'proposal' | null;   // record.run.purpose?.phase (execution-driver.ts:482)
      hasBlockedCommands: boolean;                 // (manifest.blockedCommands ?? []).length > 0 (prepared-execution.ts:243, execution-driver.ts:505)
      reviewSource: boolean;                       // sourceTools.includeReadSource (observed-model-run.ts:266)
      frozenSource: boolean;                       // projectSource.mode === 'frozen' (observed-model-run.ts:200)
      materialTools: boolean;                      // materialTools is bound (observed-model-run.ts:282)
      owners: {
        mailbox: boolean; decisionMessages: boolean; applicationReceipt: boolean;
        sessions: boolean; plans: boolean; graph: boolean; notes: boolean;
        unknownCallReviews: boolean; commandRerunRequests: boolean;
      };
      readonlyCommand: {
        requested: boolean;                        // readOnly && selected has run_readonly_command (execution-driver.ts:869)
        access: 'all_except_denied' | undefined;   // hostConfig.readonlyCommandAccess
        allowsReadWholeWorkspace: boolean;         // authorization.allowsRead('.') (readonly-command-tool.ts:416)
      };
    };

    export function finalToolNamesOf(input: FinalToolListInputV1): ToolGroupResult<string[]>;
    ```

    - **Two separate source facts.** `reviewSource` is `sourceTools.includeReadSource` (`observed-model-run.ts:266`);
      `frozenSource` is the frozen project source (`:200`). They are independent: replacing `read` and supplying a
      frozen source are different conditions (C3). `hasBlockedCommands` says only whether the manifest's blocked
      bindings are non-empty (`prepared-execution.ts:243`, `execution-driver.ts:505`); the list needs nothing else.
    - **Rejections first, then the array.** An unknown selected name, or a selected coordination family whose
      required owner is missing, is today's `unsupported` (`tool-group-assembly.ts:196–201`, `:211–224`). The
      function returns `{ ok: false, rejection }`; it never silently drops a tool.
    - **Coordination.** The names are `selected ∩ family` (`tool-group-assembly.ts:203–209`). Communication needs
      `mailbox` (`:211–213`); user decisions need `mailbox && decisionMessages` (`:213`, `:216`); `graph` means both `graphContext`
      and `taskInputs` are bound (`:219–221`, wired at `execution-driver.ts` ~464–474); `notes` means both
      `notes.write` and `notes.check` are bound (`:222–224`). `applicationReceipt` is an optional enhancement
      (`:236–244`), never a registration gate.
    - **Review and rerun tools** follow the Run, not `selected`. A Work Run with `reviewPhase !== null` requires the
      `unknownCallReviews` owner: without it the function returns `unsupported` first (`execution-driver.ts:485`);
      with it the review/proposal tool is added and its name follows the phase (`:482`, `:485–487`). The
      rerun tool is registered on a Work Run with `hasBlockedCommands` and no review purpose
      (`execution-driver.ts:505–508`), and needs the `commandRerunRequests` and `unknownCallReviews` owners
      (`:509–514`). Review/proposal rounds never get it.
    - **Read-only command** stays as today, from `readonlyCommand` (`execution-driver.ts:869`,
      `readonly-command-tool.ts:413`).
    - **Output order** is today's `kernelEnabledToolNames`: when `hasRead && reviewSource`, `read_source`, then
      `read_material` only with material tools, then the exploration names in `EXPLORATION_TOOL_NAMES` order
      (`tool-group-assembly.ts:47–50`), then the extensions. Otherwise the mapped builtin allowlist
      (`kernelToolNameOf`, `write` → `edit`), then exploration, then extensions. Extensions keep the
      coordination, read-only command, review, rerun order (`assembleObservedExtensions`, ~390–418). Never sort.
    - **Preparation** computes the list after the permissions, frozen-source and material facts are fixed and
      freezes it as `PromptSetV1.toolNames` (an addition to spec §2, recorded at merge).
    - **Start** computes it again with the same function and compares only a ready result with the frozen array,
      exactly and in order:

      ```ts
      const frozen = promptSet.toolNames;
      const current = finalToolNamesOf(input);
      if (!current.ok) return current.rejection;
      const same = frozen.length === current.value.length
        && frozen.every((name, i) => name === current.value[i]);
      if (!same) return rejected('forbidden', 'the prepared tool list no longer fits this Run');
      ```

      A difference is `forbidden`, the same path as PC-1 ruling 16.
    - **`PromptSetV1.toolNames` (L2).** Required `string[]`, in the order above, never sorted. `decodePromptSetV1`
      checks it strictly: an array of distinct non-empty strings. It sits inside the manifest digest and PC-1's
      manifest-size measure (PC-1 ruling 14). `PromptPartsV1` carries `toolNames` together with ruling 19's `tools`;
      `storePromptTexts` writes both. This is an addition to PC-1's frozen `PromptSetV1`, recorded at merge; ruling
      19 shows the field beside `tools`.
17. **`base` v2** (`templates/base.txt`, version 2). Each sentence that names a tool sits in blocks for every tool it
    names (blocks nest). Lines holding only a block marker vanish with their newline. With read, edit and shell all
    present it renders exactly `coding-agent-v5` minus the `check` line. The changed lines, in place:

    ```
    {{#tool:read}}
    - Use read for files and directories. Paths for read{{#tool:edit}}/edit{{/tool:edit}} are workspace-relative, such as README.md or src/app.ts; never pass host paths or /workspace paths to read{{#tool:edit}}/edit{{/tool:edit}}.
    {{/tool:read}}
    {{#tool:shell}}
    {{#tool:read}}
    {{#tool:edit}}
    - Use shell only for commands, search, builds, and tests that read/edit cannot perform. Shell runs with the workspace mounted at /workspace, without network. Prefer one coherent command over many tiny shell calls.
    {{/tool:edit}}
    {{/tool:read}}
    {{/tool:shell}}
    - {{#tool:read}}Batch independent read calls in one model response when useful. {{/tool:read}}After every tool result, incorporate the result before deciding the next action. Do not silently repeat a failed call.
    ```
    ```
    {{#tool:edit}}
    - Read before editing. Use the edit tool for controlled file changes{{#tool:shell}}; do not use shell as a substitute for edit{{/tool:shell}}.
    {{/tool:edit}}
    ```
    ```
    - Reads may be allowed automatically. {{#tool:edit}}{{#tool:shell}}Edits and shell commands can require explicit user approval. {{/tool:shell}}{{/tool:edit}}Respect denial and explain a safe alternative.
    ```
    The `check` line (old line 14) is deleted. Every other line stays. `mentionsTools: []`.
18. **Declarations.**
    - At preparation, for each template this preparation uses: every name in `origins[templateId].mentionsTools`
      must be in the frozen tool list, else `invalid` naming the template and the tool. The declaration is the
      supplying manifest entry's (ruling 4), so a child that overrides only `base` still sees the platform's
      declarations. Only used templates are checked; e.g. the platform `unknown-call-proposal` declares
      `propose_safer_method` (`pack.json` ~36).
    - **The platform-pack scan test** walks each template's parse tree. It takes the literal text outside every tool
      block and matches whole tool names, case-sensitive (`read_source` is not `read`). The set to match is every
      builtin, reserved (`check` included, `tool-group-assembly.ts` ~76) and extension tool name. The result must
      equal each template's `mentionsTools`.
    - **The frozen exemption list** is part of the test: `(templateId, word, line, reason)` for each hit that is not
      a tool reference. Keep it minimal; one reason per line. It holds:
      - the receipt field `check`;
      - the op names `write`, `withdraw` and `review`;
      - the planning answer's `checks` field and its plain "check".
    - **Skills are rendered like `base`:** through the renderer with the final tool list, no slots (ruling 10). In
      platform pack v2 each Skill sentence that names a real tool sits in that tool's block (`look_graph`,
      `find_graph`, `record_note`, …); every Skill's `mentionsTools` stays `[]`; each Skill's version becomes 2. With
      every named tool present, each Skill renders byte-equal to its v1 text (a test).
    - PC-1's pinned-digest test (`tests/contracts/PC-platform-pack-v2.test.ts`) is an old test PC-2 may change: the
      `base` and Skill literals become the v2 digests, hand-computed (check ruling 5e).

### 3.6 Tool texts in a person's pack (decision 83-5; groups A, W, Q)

The user chose option (b) of Q-1 on 10-22. The platform tools' texts (`resources/prompts/platform/tools/`, 31 today)
may be changed in a person's pack; the Kernel's own tools (such as read and shell) may not (decision 83-5), and PC-1's `toolSpecsRef`
still records what every request sent.

19. **The frozen form** (A owns the types; Q freezes).
    - `PromptSetV1` gains the required fields below. `tools` is sorted by name (`localeCompare(…, "en")`);
      `toolNames` is ruling 16's order and is never sorted. `decodePromptSetV1` checks both strictly. Both sit
      inside the manifest digest. `PromptPartsV1` carries the tool list and the **raw** tool entries, as PC-1's parts
      carry raw texts; `storePromptTexts` builds each canonical body, stores it, and writes
      `{ name, packId, digest, ref }` into the set.

      ```ts
      // src/contracts/prompts/prompt-set.ts (PC-1), A's additions for PC-2
      export type PromptSetV1 = {
        // ... PC-1's fields ...
        toolNames: string[];                                                        // ruling 16
        tools: { name: string; packId: string; digest: string; ref: ArtifactRef }[]; // ruling 19
      };

      // src/core/agent-runtime/prompt-set-texts.ts (PC-1), Q's additions for PC-2
      export type PromptPartsV1 = {
        // ... PC-1's fields ...
        toolNames: string[];
        tools: readonly { name: string; packId: string; entry: ToolTextV1 }[];   // raw; stored by storePromptTexts
      };
      ```

    - **The canonical body** of one entry: `JSON.stringify({ description, parameters })`, with `parameters`' keys
      sorted the same way. Content type `application/vnd.coding-platform.prompt-tool-text+json;version=1`
      (`PROMPT_TOOL_TEXT_CONTENT_TYPE`, A). The digest is `sha256` of that body. The routes (ruling 6) use the same
      digest.
    - **At preparation** (Q), for each name in the frozen `toolNames` (ruling 16) that has an entry in the resolved
      pack: store the canonical body with PC-1's `storePromptTexts` path, and record `{ name, packId: toolOrigins[name],
      digest, ref }`. A failed store is the preparation's `unavailable`, like the other bodies. The manifest-size
      measure includes the field (PC-1 ruling 14).
20. **At start and resume** (Q). The chain from the frozen bodies to each factory is:

    [DSH choice: the extended `readPromptTexts` return shape; its arguments and status union stay PC-1's]

    ```ts
    // src/core/agent-runtime/prompt-set-texts.ts, PC-1 signature extended by Q
    export function readPromptTexts(
      bodies: Pick<RawArtifactStorePort, 'read'>,
      set: PromptSetV1,
    ): Promise<{ status: 'ready'; value: PromptTextsV1 & {
      base: BaseSystemPromptInput;
      skills: readonly SkillContext[];
      tools: Readonly<Record<string, ToolTextV1>>;   // PC-2: the tool-text bodies
    } } | CoreRejection>;
    ```

    1. `readPromptTexts` reads the entries by their refs and verifies digest, size and content type. An unreadable
       entry is `unavailable`.
    2. The Work driver and the Query execution call `readPromptTexts` once, before building any tool. They pass the
       reader's `tools` to `runObservedModel` as its `texts` option. `readPromptRecord` (`src/core/agent-runtime/runtime.ts`,
       Q) also reads the frozen `PROMPT_TOOL_TEXT_CONTENT_TYPE` bodies, so the tool texts are in the record's `texts`.
    3. `observed-model-run.ts` ~305 passes `texts` into `createExplorationTools` (`{ ...o.sourceTools, texts }`); the
       exploration factory hands it to `createProjectSourceTool` (`exploration-tools.ts` ~169) and to its own tools.
    4. The Work driver passes `texts` to `selectWorkToolGroup`, `createReviewToolGroup`, `createRerunToolGroup` and
       `registerReadonlyCommandTool` (`execution-driver.ts` ~447, ~489, ~517, ~898). The Query execution does the
       same for its graph group and read-only command (`query-execution.ts` ~239, ~352).
    5. `assembleObservedExtensions` (~390–418) only gathers already-created closures. It cannot inject text, so every
       caller passes `texts` before the closure is built.
    6. `registerReadonlyCommandTool`'s input gains `texts?` and passes it to `createReadonlyCommandTool`
       (`readonly-command-tool.ts` ~392–443).
    - **The fallback is per tool**, not a whole-object default. The frozen set holds only enabled tools, and a factory
      may build disabled siblings:

      ```ts
      const text = texts?.[name] ?? PLATFORM_PROMPT_PACK_V1.tools[name]!;
      ```

      With no frozen entry a name keeps the generated pack's text. The current pack is never read at start.
21. **The factories take the texts** (W rework).
    - Each factory input has `texts?: Readonly<Record<string, ToolTextV1>>` (`ToolTextV1`, `prompt-pack.ts` ~19).
      W's ten files are `command-rerun-tools.ts`, `communication-tools.ts`, `exploration-tools.ts`, `graph-tools.ts`,
      `note-tool.ts`, `project-source-tool.ts`, `readonly-command-tool.ts`, `session-discovery-tools.ts`,
      `unknown-call-review-tools.ts` and `whiteboard-tools.ts`.
    - **Rework:** each file currently applies a whole-object default (`config.texts ?? PLATFORM_PROMPT_PACK_V1.tools`;
      ~10 call sites). Change each to the per-tool fallback of ruling 20. `exploration-tools.ts` and
      `readonly-command-tool.ts` pass `texts` through to the project-source sub-factory and the registration wrapper.
      The tests extend the ten `PC2-W-*` files accordingly.
    - Today several parameter descriptions are module-level schema constants built at import. Build those schemas
      inside the factory from the given texts. Nothing else changes: with the default texts every tool's
      specification is byte-equal to today's.
    - A factory never reads a pack or the disk.
    - **Whiteboard parameters (T, W).** The two `toolSchema.whiteboardPin.*` strings are parameter descriptions.
      Platform pack v2 moves them into the whiteboard tools' `parameters`, and the string keys are removed. The bytes
      sent stay the same. W's factory reads each tool's own `parameters['expected[].ref']` /
      `['expected[].revision']` from that tool's text entry, not from `PLATFORM_PROMPT_PACK_V1.strings`
      (`whiteboard-tools.ts` ~199–204). D8: `propose_future_plan` and `apply_future_plan` each read their own
      `expected[].ref` / `expected[].revision`; the two tools' texts may differ.

      ```ts
      // platform v2: each tool that carries `expected: versionPin[]` has its own entry
      // propose_future_plan.json and apply_future_plan.json, under "parameters":
      "expected[].ref":      "One of the five W1 caller-visible refs: Project | Workspace | Goal | PlanRevision | PlanProposal.",
      "expected[].revision": "The exact version the caller saw for `ref`; the plan service rejects a mismatch with the current record."
      ```

      [DSH choice: put each description on the tool that carries the nested pin, under `expected[].ref` /
      `expected[].revision`] Reason: `parameters` is keyed by the path from the tool's input object
      (`prompt-pack.ts` ~16); the description belongs to the nested pin, and both tools carry `versionPinSchema`, so
      both entries are needed. Each tool reads its own entry, so their texts may differ. This keeps the sent bytes
      equal to v1 without inventing a whiteboard tool.

## 4. Groups, files and order

One run. Each production file has one owner; a later group may not edit a file an earlier group owns.

| Group | Owns (production) | Rows |
| --- | --- | --- |
| **A** pack, pure | `src/contracts/prompts/**` except the generated module and the platform resources; `src/contracts/graph-context.ts` (the `sectionOrder` type only) | PC-01, PC-02, PC-03 (resolution part), PC-22 (load), PC-25 (resolution) |
| **H** Host | `src/app/host-settings*.ts`, `src/app/server.ts`, `src/app/host.ts`, `src/app/runtime-configuration.ts`, new `src/app/prompt-packs.ts`, `src/composition/create-platform.ts` (the disk pack source) | PC-04 (routes), PC-05 (settings), PC-06/PC-08 (settings half), PC-22 (save), PC-23, PC-25 (routes) |
| **W** tool texts as input | the ten tool files of ruling 21 | PC-24 (factories), the W rework of check rulings 8 and 16 |
| **T** texts and rendering | `resources/prompts/platform/**`, the generated module, `runtime-assets.json`, `scripts/build-platform-prompts.mjs`, `context-rendering.ts`, `context-types.ts`, `context-*-recipe.ts`, `context-fact-text.ts`, `src/contracts/core/prepared-execution.ts` (the `takesSessionHistory` field type and the renderers' signatures), `src/contracts/continuation-brief.ts` (the same) | PC-18 (rendering), PC-19 (platform scan), PC-20, the §3.3 brief-sentence and S3 assembler tests |
| **G** guard and entry | `state/context-input.ts`, `execution-entry-service.ts`, `tests/state/invariants.ts`, `src/core/work-graph/queries/query-execution.ts` (the Query manifest check of the new fields) | PE9 rows, I-19, hand-written bindings |
| **Q** preparation to request | `execution-preparation.ts`, `query-preparation.ts`, `execution-driver.ts`, the Runtime `query-execution.ts`, `observed-model-run.ts`, `tool-group-assembly.ts`, `prompt-set-texts.ts`, `context-history-facts.ts`, `runtime.ts` (`readPromptRecord`), `tests/architecture/production-reach-allowlist.json` (joint step, once) | PC-18, PC-19, PC-21 (shrink), PC-26, PE8 rows, the K3 shrink tests, PC-06/PC-08 (freeze and start half) |

Q edits `tests/architecture/production-reach-allowlist.json` once in the joint step (C8); every other group reports
the entries it adds, removes or keeps.

**Old tests of §5.3, one owner group each:**

- **T:** `tests/contracts/A2-rework-contract-helpers.test.ts`; `tests/runtime/K3-15-blocked-sentence-pure.test.ts`;
  `tests/runtime/K3-35-renderer-boundary-pure.test.ts`; `tests/runtime/S3-context-assembler.test.ts`;
  `tests/runtime/S4C2-assembly.test.ts`; `tests/scenarios/C3-brief-idempotency.test.ts`;
  `tests/scenarios/C3-workspace-changed.test.ts`; `tests/scenarios/C3-not-entered-chain.test.ts`;
  `tests/scenarios/A1-rework-same-session.test.ts`; `tests/contracts/PC-platform-pack-v2.test.ts` (the v2 digests).
- **G:** `tests/state/invariants.ts`; `tests/state/invariants.test.ts`; `tests/state/context-input.test.ts` (ST08 and
  the hand-written binding); `tests/state/WP1-goal-content.test.ts`;
  `tests/work-graph/S3-prepared-context-admission.test.ts`; `tests/work-graph/K3-35-owner-manifest-trim.test.ts`;
  `tests/runtime/K3-unknown-call-review-section.test.ts`; `tests/scenarios/S3-context-and-inputs.test.ts`;
  `tests/helpers/WP1-units-fixture.ts`.
- **Q:** `tests/runtime/K3-35-manifest-trim-pure.test.ts`; `tests/runtime/K3-review-preparation.test.ts`;
  `tests/runtime/K3-review-input-pure.test.ts`; `tests/scenarios/K3-42-unexpanded-r2.test.ts`;
  `tests/scenarios/K3-12-14-review-round.test.ts`.
- **H:** `tests/app/S2B-backfill-host.test.ts` (~78, ~118, ~142); `tests/app/S2B-35-activity-routes.test.ts` (~202);
  `tests/helpers/S2B-r2-backfill-kernel-support.ts` (~136; only separate the settings directory from the
  workspace).

Every other file the hand-written-binding grep finds gets exactly one group: the one that owns its subject. The reply
names it. A file that fits no owner is reported, never edited.

**Order inside the run.** A freezes its resolver interface first (H's source calls it). T then freezes platform pack
v2, the `ContextTemplateId` export, the rendering material (`ContextRenderMaterialV1` / `rerenderContextV1`), the
assembler's input additions (`toolNames`, `ContextWorkHistoryInputV1` / `ContextQueryHistoryInputV1`)
and `AssembledContextV1`'s required `historyDecision` / `renderMaterial`, and the role-reminder slot. H and W code in
parallel; W needs nothing from A or H because `ToolTextV1` exists. G and Q code after T. The joint rows run last:
PC-03, PC-04 (prepared vs new), PC-05, PC-06 and PC-08 (PC-2 variants), PC-18, PC-20, PC-21, PC-26. The tree is green
at the end of the run, not between groups.

## 5. Tests

### 5.1 Fixtures (frozen; Codex, lead)

- `tests/helpers/PC2-pack-fixture.ts`: hand-written small packs (parent and child; one broken in each way of PC-02 and
  PC-22; a legal different order), as plain objects for A's pure tests and as directories for H's. It also carries:
  - **byte snapshots** of every pack file before and after a save;
  - **a real K3 shrink** reached through public steps, with a reminder after the review;
  - **a Query history derivation** for the reminder rule;
  - **a PE8 empty-value injection** for a required slot at render time;
  - **PE9 public-entry negative inputs**: a wrong range, a duplicated text and a non-tail success.
- `tests/helpers/PC2-host-fixture.ts`: a Host on a temporary data directory with settings enabled; token and
  same-origin requests; preset or broken packs; captured HTTP status and body. It builds both relations: a settings
  or `prompts/` directory **inside a workspace root**, configured or restored; an equal path; a symlink. It also builds
  a pack whose real directory leaves `prompts/` through a link.
- PC-1's `PC-platform-fixture.ts`, extended only by Codex if PC-2's rows need it: switching the Host's pack source to
  the disk one, LA-1 and same-Session reuse setups, and the tool lists a public path reaches: read; read with edit
  and shell; no read tool. It adds no fixture injection point and no product permission for `read_source` (C9).

### 5.2 Rows

The expectations are hand-computed literals. Codex's byte-range example (inventory §8) is the model; the budget
example is the one below and replaces the old one.

- **PC-01 (A)** As spec. Both tool sets for one `{{#tool:edit}}`; whole-line markers removed.
- **PC-02 (A)** One broken pack per reason; each yields one result with every problem carrying pack, template and
  reason. It covers the identity, strings, template, tool and section-order checks of ruling 4.
- **PC-03 (A, joint)** A child overrides only `base`. Every other template is the platform's, and the frozen set
  names each template's source pack and version.
- **PC-04 (H, joint)** As spec, versions e.g. 7 → 8. After an `invalid` save, the files are byte-equal to before. The
  prepared-vs-new case goes through the route, then real preparations and starts. Unknown pack, template and tool are
  `not_found`; a broken body is `invalid` with problems; a stale version or digest is `revision_conflict`; `list`
  keeps a broken pack's problems.
- **PC-05 (H, joint)** Two settings models, each with its own pack; each execution uses its pack (literal markers A
  and B). Without the fields: `platform` and `current_run`, and the settings read shows no field. A restart after a
  save that omits `promptPack`/`reasoningReplay` still resolves the defaults; the startup catalog does not restore the
  old values.
- **PC-06, PC-08 (joint, PC-2 variants)**
  - Change the person's pack, including a label in `strings.json`, after preparation: the prepared run is unchanged.
  - Change a model's pack in the settings after preparation: this execution keeps the old pack, a new one uses the
    new pack.
- **PC-18 (Q, joint)**
  - Reminder count: new Session 0, LA-1 seed 1, same-Session reuse 1.
  - Where it sits: at the role section's end, also with all four budget sections omitted.
  - The brief no longer has the sentence.
  - The decision is made once inside assembly: `AssembledContextV1.historyDecision`; Q freezes `takesSessionHistory`
    from it unchanged.
  - A K3 seed and a Query `session_history` follow the same rule, through the one `sessionHistoryDecision`. A Query
    with `sessionBasis` passes no boundary and reads none; Work and a Query without basis pass the real one.
- **PC-19 (Q, T)** A pack whose `base` names `check` outside blocks with `mentionsTools: ["check"]`: `invalid`, with
  `base` and `check`. The platform scan test passes with the frozen exemption list of ruling 18.
- **PC-20 (T, joint)** Four tool lists as renderer-literal tests through the pure render functions (`renderTemplate`
  and T's Skill render helper): read; read_source only; no read tool; read with edit and shell. Each `base` rendering
  is written in the test as a literal. One non-`base` used template with a tool block (a Skill and the continuation
  brief) renders with the same frozen list. The prepare-to-request part uses only lists a public path reaches — read;
  read with edit and shell; no read tool — through the platform fixture's permission `tools`. `read_source` is
  renderer-only: no production path sets `includeReadSource` today (`execution-driver.ts` ~882,
  `query-execution.ts` ~319), so the test adds no fixture injection point and no product permission for it. The list
  input is ruling 16's: `reviewSource` is independent of `frozenSource`, and `hasBlockedCommands` drives the rerun
  tool.
- **PC-21 (T, G, Q, joint)** As spec, with the K3 shrink: the material carries the frozen section plan and the actual
  billed `residentBytes`; `rerenderContextV1` replaces only the review slot, recomputes the ranges and `totalBytes`,
  and keeps the budget choice and the omission metadata unchanged. The reminder survives byte for byte, the
  recomputed ranges are hand-computed, and the guard and the entry pass. The changed-character case is `invalid`. A
  person's pack with another legal order is followed. The budget example keeps reminders over inputs while displaying
  them last:

  ```
  Optional sections in budget order: F footprint, N notes, M reminders, I inputs.
  Headers are F/N/M/I (1 byte); rows are f, n, m and 40 × I.
  Billing has "\n\n" before the first section and between sections: 8 bytes.

  All kept:        F 1+1+1=3   N 3   M 3   I 1+1+40=42   +8 = 59
  Three kept:      F 3         N 3   M 3   I 1+1+30=32   +8 = 49
                   omission line "另有 1 条，用‘看’读" = 7 + 1 + 22 = 30 bytes
  Budget 49:       k=4 is 59 > 49; k=3 is 49 <= 49, so k=3.
  Result:          keep F, N, M; omit I (one omission line). residentBytes = 49.
  ```

  The display order is F, N, I, M. The omission marker sits before M, while the budget keeps M and drops I. The test
  writes these literals; it does not call the production budget function for its expected values.
- **PC-22 (A, H)** Role not first, an illegal section, a section twice: rejected on save and at preparation.
- **PC-23 (H)** A settings or `prompts/` directory **inside** a configured root or inside a restored root: the Host
  fails to start. An equal path fails the same way. A symlink that places the pack outside `prompts/` is rejected.
  Opening an ancestor of the prompts directory: `invalid`. An unrelated directory opens.

Rows PC-24…PC-26 are decision 83-5's; the spec's table has none for it.

- **PC-24 (W)** For each of the ten files: given texts with one literal changed description and, only where the
  platform `parameters` table is not empty, one literal changed parameter description, the tool's specification
  carries the literals. This covers all 31 tool descriptions and one parameter of each of the eight non-empty tables
  (`apply_future_plan`, `list_files`, `propose_future_plan`, `propose_safer_method`, `record_unknown_call_review`,
  `request_command_rerun`, `run_readonly_command`, `search`). Without texts, and with
  `PLATFORM_PROMPT_PACK_V1.tools` passed explicitly, the specifications are deep-equal.
- **PC-25 (A, H)** Tool texts in a person's pack:
  - resolution: a child overriding `record_note` only; every other tool is the platform's, and `toolOrigins` names
    the child for `record_note` alone;
  - one problem each for an entry for `shell`, an empty description, and a missing and an extra parameter key; the
    missing and extra cases use `list_files.prefix`;
  - the routes: read gives the effective entry and its digest (hand-computed from the literal canonical body); save
    with that digest writes `tools/record_note@<16 hex>.json` and the next read returns the new entry; a stale digest
    is `revision_conflict`; the platform pack is `forbidden`; an invalid save leaves the files byte-equal; unknown
    pack and tool are `not_found`.
- **PC-26 (Q, joint)** A Work run and a Query run both use `list_files`, and Work also uses `record_note`:
  - the person's pack changes `record_note`'s description (Work) and `list_files.prefix`'s description (both Work
    and Query); no new Query permission is added;
  - the model's request carries the changed texts, and the frozen `PromptSetV1.tools` entry has the hand-computed
    digest;
  - change the pack again after preparation: the start, and a Work resume after pause, still send the prepared texts;
  - `readPromptRecord`'s `toolSpecsRef` body holds the changed texts;
  - the body store fails only `PROMPT_TOOL_TEXT_CONTENT_TYPE`: the preparation is `unavailable`.

### 5.3 Old tests to change (only these, only for this reason)

- **The brief sentence:**
  - `tests/contracts/A2-rework-contract-helpers.test.ts` ~398 now asserts the sentence is absent;
  - `tests/runtime/K3-15-blocked-sentence-pure.test.ts` ~52 and `K3-35-renderer-boundary-pure.test.ts` ~39 drop the
    line.
- **Section order:**
  - `tests/runtime/S3-context-assembler.test.ts` CA01 (~600–611) and CA12 (~813–834), and the boundary helpers at
    ~482–487 and `tests/runtime/S4C2-assembly.test.ts` ~213–218;
  - I-19 and `tests/state/invariants.test.ts` ~1372, ~1380;
  - `tests/state/context-input.test.ts` ST08 ~162: replace the old "reject text after the brief" assertion with the
    new range equality plus one occurrence (ruling 10);
  - the hand-written bindings and manifests found by
    `grep -rln "s3-context-v1\|CONTEXT_FORMAT_VERSION\|kind: 'task_execution'" tests` get `sectionOrder`, and the
    new required manifest fields (`takesSessionHistory`; the Query manifest's new fields) are added mechanically
    where §5.3 already lists a hand-written manifest.
- **Direct assembler calls** (ruling 14's new required inputs): add the frozen tool list and the matching history
  input mechanically, keep every assertion. `tests/work-graph/S3-role-profiles.test.ts` ~197 (T);
  `tests/runtime/S3-context-assembler.test.ts` ~840 (T); `tests/runtime/S4C2-assembly.test.ts` ~383 (T);
  `tests/helpers/WP1-units-fixture.ts` ~468 (G). Never make the production inputs optional to avoid this.
- **Brief or review assumed last** (added to the spec's list by the lead, Codex and DSH found them; change only that
  assumption):
  - `tests/scenarios/C3-brief-idempotency.test.ts` ~80, ~196–198; `C3-workspace-changed.test.ts` ~81–84;
    `C3-not-entered-chain.test.ts` ~101;
  - `tests/scenarios/A1-rework-same-session.test.ts` ~191;
  - `tests/work-graph/K3-35-owner-manifest-trim.test.ts` ~100.
- **The review shrink:** `tests/runtime/K3-35-manifest-trim-pure.test.ts`, `K3-review-preparation.test.ts`,
  `K3-review-input-pure.test.ts`, `tests/scenarios/K3-42-unexpanded-r2.test.ts` and
  `tests/scenarios/K3-12-14-review-round.test.ts`. Change only the assertions that assume the review is last or the
  prefix cut. `K3-review-input-pure` ~190, `K3-42-unexpanded-r2` ~199 and `K3-12-14-review-round` ~161, ~222 may
  need none (Codex). `tests/runtime/K3-unknown-call-review-section.test.ts` belongs to G; change only its tail
  assumption.
- **Directory checks (check ruling 7):** `tests/app/S2B-backfill-host.test.ts` ~78, ~118, ~142;
  `tests/app/S2B-35-activity-routes.test.ts` ~202; `tests/helpers/S2B-r2-backfill-kernel-support.ts` ~136 (only
  separate the settings directory from the workspace, never loosen the backfill assertions).
- **The pinned digests:** `tests/contracts/PC-platform-pack-v2.test.ts`; the `base` and Skill literals become the v2
  digests, hand-computed (check ruling 5e).
- K3 tests without the old assumption stay unchanged.

## 6. Size, checks, reply

The budget is the code inventory plus decision 83-5, with W's measured size in place of its estimate.

| Group | Budget (added + deleted) |
| --- | ---: |
| A | 1,150 |
| H | 2,190 |
| W | 519 (+413 / −106, measured) |
| T | 1,190 |
| G | 930 |
| Q | 1,160 |
| **Total** | **7,139** |

The sums:
- Codex's inventory: +5,090 / −1,030 = **6,120**.
- Decision 83-5 (A 100 + H 250 + W 500 + Q 150, added + deleted) = **1,000**, so 6,120 + 1,000 = **7,120**.
- W's estimate 500 is replaced by the measured 519: 7,120 + 19 = **7,139**.
- Per group: A 1,050 + 100 = 1,150; H 1,040 + 900 + 250 = 2,190; T 1,190; G 930; Q 1,010 + 150 = 1,160; W 519.
  1,150 + 2,190 + 519 + 1,190 + 930 + 1,160 = **7,139**.

The reply reports added, deleted and total for every group. Fixtures and old-test changes count in their group.

Checks, once, at the end of the run:
- typecheck, `check:architecture`, build, `node scripts/build-platform-prompts.mjs --check`;
- the new and changed tests, `tests/app`, `tests/architecture`, and the importers of the changed files as the run
  sheet lists them.

One vitest command at a time per subagent, `--maxWorkers=2`. No real model calls, no network, never ports 3080, 3099,
44797.

Reply under 1,200 words:
- per ruling and row, RED → GREEN;
- the files with lines added, lines removed and total per group;
- the old tests changed and why;
- the inputs of ruling 16's tool-list function;
- the checks with numbers;
- any allowlist entry left, with the later consumer that will remove it;
- UNSPECIFIED.
