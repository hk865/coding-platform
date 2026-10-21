# Task: the structure round before 6A (decision 85-1) — behaviour-identical restructuring (lead, 2026-10-21, v1)

You are working in a copy of the repository (the current directory). This is a NEW session. Read this book first, in
full, and the run sheet `./.dsh-ref/s85-run.md` (which group this run does, its base, its file whitelist, and the
interfaces earlier groups froze). **Do only that group.** Report anything you cannot understand before you start
(decision 56). **This run is headless: when your turn ends, the whole run ends. Do not end your turn while a subagent
has not reported back** (wait with `sleep 300`, then `list_agents`). The time limit is in the run sheet.

Work in coordinator mode (`./.dsh-ref/coordinator-mode.md`): subagents change the code; you split, brief, check the
reports, run the final checks and write the reply. Split by FILE: two running subagents never edit the same file.

## 1. What this is

Before slice 6A, the structure review of 10-19 (HANDOFF decisions 84 and 85) found six places where 6A and later
slices will keep adding code onto a tangled structure. The user approved doing them first, **like C1: behaviour
unchanged, tests unchanged, committed on their own** (decision 84-1). The six items:

| Item | What |
| --- | --- |
| D3 | split the context assembler; build the prompt-pack renderer and platform pack v1, moving today's hard-coded texts into it verbatim |
| D2 | one tool-group assembly module for the Work and Query paths |
| B1 | a bounded codec pilot: three events derive their decode pipeline and registration from one format description |
| C2 | one stable-window executor for the four copies of the activity read loop |
| C1 | break the import cycle between the note read model and the note write service |
| A6 | move the pure activity replacement rule out of the Run-only owner |

Codex's read-only inventories, written on this tree, are the source for §5: `./.dsh-ref/inv-d3.out.md`,
`./.dsh-ref/inv-rest.out.md` (D2, C2, C1, A6) and `./.dsh-ref/inv-b1.out.md` (all Chinese). Where this book and an
inventory differ, **this book binds**. The frozen spec for D3's pack format is
`docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md` (§0.4 first bullet, §1 first bullet,
P1, P10, §2 renderer signature).

## 2. Rules (all groups)

1. **Behaviour is byte-identical.** Same error codes and texts (including prefixes and suffixes), same order of
   checks, same field presence (an omitted field stays omitted, an explicit `undefined` is not introduced), same list
   order, same number of store reads and clock calls per call, same stored bytes (event JSON, manifests), same bytes
   sent to the model (rendered prompt text, tool definitions, tool name lists and their order), same digests.
2. **Tests, assertions and the production-reach allowlist do not change.** Not one line under `tests/`, and not
   `tests/architecture/production-reach-allowlist.json`. When a test fails, sort it: a regression of this run (undo or
   fix your change; never edit the test), or an environment failure (no bubblewrap or systemd here; list it with the
   reason). A new export that no production path reaches fails production-reach: wire it, do not allowlist it.
3. **Exports keep working.** Every existing export keeps its name, signature, return shape and behaviour. A moved
   symbol stays importable from its old module (re-export) whenever a test or another module imports it from there;
   the inventories list those importers. Do not change the composition root unless a section below says so.
4. **No new behaviour, no new error paths, no new validation, no renamed public names, no new store reads.** If a
   step would need one, skip that step and report it.
5. **Do not widen an item.** Each item's "not this round" list binds. In particular: do not route anything through
   `persistence/lookup-all.ts` or the other SC files (§4), do not make C2 a general pager, do not wire A6 into Query,
   do not unify the Work and Query failure checks in D2, do not turn B1 into a general record generator.
6. **Comments** follow decision 35: keep every rule and every "why"; no construction history ("group 2 did …").
7. State transitions only through `src/core/work-graph/state/` (root AGENTS rule 9; `tests/architecture/state-writes.test.ts`
   lists decoders by file and name, so keep each named decoder in its file). Never edit `vendor/coding-agent/dist`,
   `docs/`, the lock files or `package.json` (except S3's one build step, §5.1).
8. **Temporary probes stay out of your working tree.** The byte proofs use scratch copies in the run sheet's
   `$S85_SCRATCH`, outside the repository copy (§5.0); the final diff of your working tree contains only the changes
   this book asks for.

## 3. Checks before you finish

Run these yourself at the end, one at a time (never two `tsc` at once; subagents do not run `tsc` in parallel):
`npm run typecheck`; `npm run check:architecture`; `npm run build`; then `npx vitest run --maxWorkers=2` on the test
files the run sheet names plus `tests/architecture`. Each item in §5 names its byte proof; run it and paste the
result. Count added + deleted lines against the run sheet's base (tracked files by `git diff --numstat`, every new
file against an empty file); report the net separately.

## 4. Overlap with SC

SC (the scale-test split, merged before this round) edited these production files: `persistence/lookup-all.ts`,
`views/decision-read-model.ts`, `tasks/plan-readers.ts`, `tasks/planning-question-reader.ts`,
`tasks/command-rerun-request-service.ts`, `views/automatic-rework-notices.ts`, `views/context-extensions.ts`,
`views/undelivered-reply-notices.ts`, `views/work-line-reader.ts` (all under `src/core/work-graph/`). The base already
contains SC. Two files are edited after SC, on top of its change: `views/context-extensions.ts` (S3 moves its three
reminder texts only; SC's page-width parameters stay as SC left them) and `package.json` (SC added `test:scale`; S3
adds one step before `build`). No run edits the other SC files.

**Import directions** (all allowed today; keep them): `src/contracts/prompts/*` imports nothing from `src/core` or
`src/app`; Runtime modules use `import type` for types from each other where they only need types; the note reader,
writer and scribe scope import the new `note-base-reader.ts` / `note-rendering.ts` and not each other at run time;
`state/activity-replacement.ts` takes its facts type from `src/contracts`.

## 5. Items

### 5.0 How the byte proofs work (all runs)

The tests prove less than this round promises (the inventories list many texts and orders without an exact
assertion). Each item therefore names a byte proof. The rules for all of them:

1. **Scratch place.** The run sheet names a scratch directory **outside the repository copy** (`$S85_SCRATCH`). Put
   there: a copy of the base, a copy of your result, the probes and the reports. Nothing of it enters your working
   tree; the final diff of your working tree contains only the changes this book asks for.
2. **Same probe in both copies.** A probe is a temporary edit made identically in the base copy and in the result
   copy (for example a wrapper that appends one JSON line per call to a log). It may wrap a private function or an
   inline expression **in the copies only**; never add a production export for a probe.
3. **Determinism first.** If a compared value depends on random ids or the wall clock, first make the source
   deterministic in both copies with the same edit (a seeded id generator, the fixture's fixed clock); do not erase
   ids or hashes from the output with patterns. Show that two runs of the base copy compare equal. A path you cannot
   make deterministic is listed as "not byte-proven", with the reason.
4. **How to compare.** Strings: as UTF-8 buffers; on the first difference print the byte offset, both lengths and the
   16 bytes around it. Arrays: element by element, keeping the count and order. Objects: own keys in order, and
   missing vs `undefined` vs `null` kept apart (serialise with a replacer that marks `undefined`); numbers exactly.
   Never sort or canonicalise before comparing.
5. **Match the logs** by test file, test name and call index; report the number of captured calls per probe and fail
   the proof if a probe captured nothing.
6. **Report** a table per probe: what it wraps (symbol, file, base line), how many calls, how many differences. Zero
   differences is the bar. The lead and Codex will re-run the probes, so keep them and their run commands in
   `$S85_SCRATCH/<run>/probes/` and list them in the reply.

### 5.1 D3 — split the context assembler; prompt-pack renderer and platform pack v1

D3 is done in two runs (§6): **D3a (run S3)** builds the pack format, the renderer, the platform pack v1 and moves the
texts of every consumer **outside** the context assembler; **D3b (run S4)** splits `context-assembler.ts` and moves
its own texts. The inventory `inv-d3.out.md` is the source: its table §1 (45 text families, plus row 46 below), §2
(templates, slots, the seven adaptation rules), §3 (modules and recipes), §4 (proof ideas), §5 (assets). This section
binds where it differs. Inventory row 18 names `blockedCommandLinesZh`; the function is the private
`blockedCommandsLinesZh` (`continuation-brief.ts:517`).

**Row 46 (missed by the inventory):** the three reminder texts of `src/core/work-graph/views/context-extensions.ts`
(`待决定：…；source=…` at `:122`, `待决来源尚未接入：…` at `:132`, the anomaly anchor line `中断，待核对：…` with its two
interruption phrases at `:176–177`). They go to `strings.json`, moved in S3.

**Lead's rulings (binding).**
1. **The platform pack v1 is static and built in.** `resources/prompts/platform/` is the source (`pack.json`,
   `strings.json`, `templates/<id>.txt`, `tools/<name>.json`). A script `scripts/build-platform-prompts.mjs` (paths
   resolved from the script's own URL, never the working directory) generates
   `src/contracts/prompts/platform-pack.generated.ts`, which exports `PLATFORM_PROMPT_PACK_V1` as
   `{ … } as const satisfies ResolvedPromptPackV1`, so every string keeps its literal type. The generated file is
   committed and never edited by hand. Nothing reads the pack from disk at run time: no fs I/O, no `await`, no Host
   settings. A run-time loader, user packs, pack selection, validation routes and the `invalid` rejection are PC's.
2. **Checks.** Every pack file gets one raw-byte SHA-256 entry in `runtime-assets.json` (like the Skills); the
   existing asset loop in `inspectSourceTree` (`scripts/check-boundaries.mjs:234–247`) then covers them unchanged.
   Add to `inspectSourceTree` only a closure check that works on the directory it is given: every file `pack.json`
   references is listed in `runtime-assets.json`. The check "the generated module equals what the script generates
   now" is **not** in `inspectSourceTree` (the boundaries test copies resources and scripts but not `src`,
   `tests/architecture/boundaries.test.ts:18–58`, and expects no issues): put it in the script's CLI branch
   (`scripts/check-boundaries.mjs:533`, which runs on the real repository only) and as
   `node scripts/build-platform-prompts.mjs --check` in front of `build` in `package.json`.
3. **Types and renderer** in `src/contracts/prompts/`:

   ```ts
   // prompt-pack.ts
   export type PromptPackManifestV1 = { schemaVersion: 1; packId: string; extends: string | null;
     templates: Record<string, { file: string; version: number; mentionsTools: string[] }>;
     strings: string; tools: Record<string, string> };                 // the frozen spec §2
   export type ToolTextV1 = { description: string; parameters: Readonly<Record<string, string>> };
   export type ResolvedPromptPackV1 = { manifest: PromptPackManifestV1;
     templates: Readonly<Record<string, string>>; strings: Readonly<Record<string, string>>;
     tools: Readonly<Record<string, ToolTextV1>> };
   export type TemplateSlotTableV1 = Readonly<Record<string, { required: boolean }>>;
   // slot-tables.ts: one table per template id, written in code (spec P1)
   export const TEMPLATE_SLOTS: Readonly<Record<string, TemplateSlotTableV1>>;
   // render-template.ts
   export type SlotRangeV1 = { startByte: number; endByte: number };   // UTF-8 offsets in `text`, end exclusive
   export function renderTemplate(resolved: ResolvedPromptPackV1, templateId: string,
     slots: Readonly<Record<string, string | undefined>>, finalToolNames: readonly string[],
   ): { text: string; sectionRanges: Readonly<Record<string, SlotRangeV1>> };
   ```

   Rules: a required slot that is `undefined` or `''` throws a plain `Error`; so do an unknown template id, a slot
   name not in that template's table, and a template that uses one slot twice (all code bugs, unreachable with the
   fixed pack; no rejection result). An optional slot that is `undefined` or `''` renders nothing and its
   `{{#slot}}…{{/slot}}` block is dropped. `sectionRanges` has one entry for each slot that rendered a non-empty
   value and none for the others. The three constructs of spec P1 only; slot values are never parsed. No v1 template
   uses a `{{#tool:…}}` block (it would hide text that is sent today); `finalToolNames` is only read by tool blocks.
4. **Slot tables.** S3 writes all ten tables of inventory §2 into `slot-tables.ts`, including the three main input
   templates S4 will create; in S4 only those three tables may change.
5. **Split of the text.** Fixed prose goes to templates; short labels, prefixes, suffixes and the omission phrases go
   to `strings.json`; descriptions of the 31 tools of inventory rows 30–44 go to `tools/<name>.json` as `ToolTextV1`,
   each file holding the final expanded text (for example the six `Session mailbox: <name>` strings written out).
   Code keeps: loops, sorting, budgets, clipping, list joins, `null`/`undefined`/empty-string distinctions,
   enum-to-text choice, protocol markers that are also parsed (`[attention s3-v1]`, the continuation marker), JSON
   field names, format versions, tool names, error messages. The scribe reminder marker goes into `strings.json` and
   the Host's recovery check (`host.ts:1342`) reads the same value.
6. **Parameter descriptions.** Only the string argument of each existing `.describe(…)` changes, to a read from the
   pack; the Zod chains, field order and validation stay code. Keys in `parameters` are paths from the tool's input
   object: field names joined by `.`, an array element as `[]` (for example `targets[].path`), an object's own
   description at the object's path, a description written after `.optional()` at the same path. When one Zod schema
   is shared by several tools (the whiteboard pin schema, `whiteboard-tools.ts:195–243`), its descriptions go to
   `strings.json` under a key named for the schema, not into either tool file. S3's reply has the table
   `tool name | resource key | base .describe location`.
7. **Old constants and arrays.** Old exported constants (`WORK_CONTEXT_PRELUDE`, `QUERY_CONTEXT_PRELUDE`,
   `INITIAL_COORDINATION_RESPONSE_GUIDE`, …) stay at their paths with their literal types, taking their value from
   the generated data. The brief's fixed tail stays the same frozen array with the same shape, built from the pack,
   and keeps taking part in the budget calculation exactly as today; the template and the array share one source,
   never two copies of the text.
8. **Bytes, exactly.** Inventory §2's seven adaptation rules bind: an empty-but-present suffix is passed as a slot
   holding `"\n\n"`; the omission block stays attached to the last required section; loops, sorting and the
   every-prefix budget scan stay in code; slot values are not re-parsed; a whole-line block marker removes only its
   own newline; no tool guard is added; section ranges are counted in UTF-8. No template file ends with a newline it
   does not render. Keep `……` vs `…`, `(none)` vs `（无）` vs `(未声明)`, `、` vs `, ` vs `; `, two-space
   continuation indents, and every sentence including the brief's "文件可能已经变化" line (PC removes it, not D3).
9. **Not moved:** the Kernel base prompt and built-in tool texts, `resources/skills/platform-*`,
   `LOCAL_WORKBENCH_GUIDANCE`, the stored note body format of `renderUnderstandingBody` (C1's), RoleSpec content,
   user text, note text, commands, evidence. No secretary recipe, no new callKind, no prepared-manifest field, no
   change of section order (pack v1's order is today's).
10. **Old exports stay** at their old paths (inventory §3's two export tables, including
    `INITIAL_COORDINATION_RESPONSE_GUIDE` from `query-preparation.ts`, `renderContinuationBriefZh`,
    `approvedMethodLinesZh`, `renderUnknownCallReviewZh`). The public `ContextAssembler.assembleTask` keeps its shape
    (no `taskReviews`).
11. **One pack owner per run.** In S3 and in S4 one subagent alone edits `resources/prompts/platform/**`,
    `slot-tables.ts`, `runtime-assets.json` and the generated module. It first publishes the complete key table
    (template ids, slot tables, string keys, tool files); the consumer subagents code against those keys and hand the
    owner their texts (key, exact text, base location); the owner writes the resources, then generates the module
    once all texts are in.

**S3 = D3a (first night, in parallel with S1 and S2).**
- **Files:** new `src/contracts/prompts/prompt-pack.ts`, `slot-tables.ts`, `render-template.ts`,
  `platform-pack.generated.ts`; new `resources/prompts/platform/**`; new `scripts/build-platform-prompts.mjs`;
  `runtime-assets.json`, `scripts/check-boundaries.mjs`, `package.json`; the text consumers of inventory rows 9–23,
  27, 29–45 and row 46: `src/contracts/continuation-brief.ts`, `src/contracts/core/prepared-execution.ts`,
  `src/contracts/note.ts`, `src/core/agent-runtime/role-profiles.ts`, `query-preparation.ts` (the guide only),
  `execution-inputs.ts`, `architecture-reminders.ts`, `whiteboard-tools.ts`, `note-tool.ts`,
  `project-source-tool.ts`, `exploration-tools.ts`, `readonly-command-tool.ts`, `communication-tools.ts`,
  `graph-tools.ts`, `session-discovery-tools.ts`, `unknown-call-review-tools.ts`, `command-rerun-tools.ts`,
  `src/core/work-graph/views/context-extensions.ts` (the three texts only), `src/business/workflow/consultation.ts`,
  `src/app/host.ts` (the scribe reminder only).
- **Templates:** `initial-planning-answer`, `continuation-brief`, `unknown-call-review`, `unknown-call-proposal`,
  `consultation-received-input`, `user-decision-response`, `scribe-reminder` (inventory §2's slot tables).
- **Not in S3:** `context-assembler.ts` and its texts (rows 1–4, 6–8, 24–26), `note-read-model.ts` (row 28; S2 edits
  it the same night), any file of S1 or S2.
- **Order inside the run:** (1) the pack owner: types, renderer, slot tables, build script, checks and the key
  table, frozen in an interface table; (2) at the same time, the probes of the byte proof on the base copy; (3) the
  consumers, split by file among subagents; (4) the owner writes the resources and generates; (5) the proofs.

**S4 = D3b (second night, on the lead's merge of S1–S3).**
- **Files:** `src/core/agent-runtime/context-assembler.ts`; the new modules of inventory §3 (`context-types.ts`,
  `context-support.ts`, `context-rendering.ts`, `context-fact-text.ts`, `context-review-input.ts`,
  `context-workspace-facts.ts`, `context-history-facts.ts`, `context-review-recipe.ts`,
  `context-continuation-recipe.ts`, `context-work-recipe.ts`, `context-query-recipe.ts`);
  `src/core/work-graph/notes/note-read-model.ts` (row 28 only); the pack owner's files again
  (`resources/prompts/platform/**`, adding `work-input`, `query-planning-input`, `query-copy-input` and the
  assembler's strings; `slot-tables.ts`, the three main input tables only; `runtime-assets.json`; the regenerated
  module).
- **What:** inventory §3. Afterwards `context-assembler.ts` holds only the re-exports, `createContextAssembler`, the
  one place that takes the clock, and `readAttentionGraph`'s capability check and delegation.
- **Recipes (inventory §3's table binds):** Work keeps its read order (duty → graph facts → reminders → upstream
  input facts → input text → continuation/review → render and binding), nothing concurrent, nothing prefetched; Query
  is planning only when graph facts are non-null **and** the execution kind is `initial_coordination`, otherwise
  copy; K3 review/proposal stay Work purposes with their tails; keep `readContinuationBasis.call(deps.executions, …)`,
  the immediate return for `reviews: []`, and every clock call's timing.
- **How to split the work without two subagents in one file:** subagents that create a new module copy its code from
  the base text of `context-assembler.ts` without editing that file; after they report, one subagent owns
  `context-assembler.ts`, deletes the moved code and wires the modules.

**Byte proof, S3** (rules of §5.0). Every text S3 moves is proven in S3 against the base; nothing is left to S4.
1. **Renderers, record and replay.** Probes on the base copy record the arguments of every call made while the test
   files that reach them run; replay each recorded call through the base copy and the result copy and compare the
   outputs (strings as buffers, arrays and objects per §5.0 rule 4). Wrap: `renderContinuationBriefZh`,
   `approvedMethodLinesZh` (returns an array), the private `blockedCommandsLinesZh`, `renderUnknownCallReviewZh`,
   `platformRoleProfile` (returns an object), `formatDecisionResponseInput`, `architectureReminderRowEntries`
   (returns rows), `renderNoteHeader`, the consultation guidance expression (`consultation.ts:447`) and the scribe
   reminder expression (`host.ts:1434–1435`) wrapped as functions in the copies only, and the three row texts of
   `context-extensions.ts`. Add the edge inputs of inventory §4 item 2 for these renderers by hand.
2. **The guide.** Compare `INITIAL_COORDINATION_RESPONSE_GUIDE` of the base and the result as buffers, and capture the
   final Query input after the guide is appended (`query-preparation.ts:309–311`) in the initial-planning tests
   (`tests/work-graph/R5b-initial-plan.test.ts` and the others that reach it).
3. **Tools, at two points.** (a) Before Kernel: the definitions in registration order (name, description, and the
   input schema's `toJSONSchema()` output), captured where the existing callbacks return them, never by an extra
   call. (b) At the model client: the tool specs Kernel sends (Kernel converts the schemas and sorts them by name,
   `vendor/coding-agent/dist/tools/registry/tool-registry.js:71–99`), captured at the scripted provider's input. All
   31 tools must appear in (a); compare each point with its own base, unsorted.

**Byte proof, S4** (rules of §5.0).
1. **Renderers, record and replay:** `renderContext` (returns an object with ranges and counts),
   `renderAttentionChanges`, every fact formatter of `context-fact-text.ts` (wrap, in the base copy, the base
   functions they came from), and `generalWarningLabel`, with the edge inputs of inventory §4 item 2.
2. **The whole assembler result.** In both copies wrap the methods `createContextAssembler` returns and record each
   complete result (the full return union with every field; missing vs `undefined` vs `null` kept apart), per test
   and call index, for every test file that calls `assembleTask` or `assembleQuery` (find them by grep; at least
   `tests/runtime/S3-context-assembler.test.ts`, `tests/scenarios/S3-context-and-inputs.test.ts`,
   `tests/runtime/K3-review-preparation.test.ts`,
   `tests/runtime/S4C2-assembly.test.ts`, `tests/work-graph/R5b-initial-plan.test.ts`).
   `tests/runtime/K3-unknown-call-review-section.test.ts` builds layouts by hand and calls the state check directly;
   it is a regression check, not a capture source.
3. **What is stored.** Wrap `bodies.put` and record the raw manifest string and the digests the preparation computes
   (`execution-preparation.ts:517–561`, `query-preparation.ts:360`); compare per test and call index.
4. **Reads, clock and failures.** In both copies wrap the `deps` object given to `createContextAssembler` (and its
   clock) in a recording proxy: one line per call with the method name, the arguments and the order. The logs must be
   identical, including the calls before a failure or a cancellation in the existing failure tests. For each read
   point no test reaches, list it with its base line and a side-by-side reading of old and new code; this list is
   separate evidence and is not replaced by "zero differences".

**Size:** S3 about 2,150–2,950 added + deleted lines (pack and renderer 800–1,100, brief and K3 650–850, other
consumers and 31 tool files 700–1,000); S4 about 3,750–4,550, mostly moved code. Both are above the 1,200-line target
on purpose: one owner per file matters more here (decision 46 sizes by context; most of S4 is cut-and-paste). The
probes add time; the run sheets set the limits accordingly.

### 5.2 D2 — one tool-group assembly module

**Files:** `src/core/agent-runtime/execution-driver.ts`, `src/core/agent-runtime/query-execution.ts` (the Runtime one,
not the WorkGraph `queries/query-execution.ts`), `src/core/agent-runtime/observed-model-run.ts`; new
`src/core/agent-runtime/tool-group-assembly.ts`. The tool implementation files (`communication-tools.ts`,
`whiteboard-tools.ts`, `graph-tools.ts`, `note-tool.ts`, …) are imported, not edited.

**What moves** (inventory D2 table, current lines): the platform/exploration/builtin/reserved name sets and
`CoordinationTools` (`execution-driver.ts:98–130`); `createGraphHistoryProxy` (`:132–196`); `selectCoordinationTools`
(`:198–340`); the review/proposal factory and single-tool adapter (`:729–743`); the rerun factory and adapter
(`:760–773`); the Query graph factory and filter (`query-execution.ts:239–255`); in `observed-model-run.ts`, turning the
three special tool slots into names and the final enabled/authorized lists (`:288–303`, `:316–337`) and the
exploration name choice (`:176–179`, `:280–285`). The read-only command tool is already shared
(`readonly-command-tool.ts:409–438`); leave it.

**Target:** the shapes in the inventory (`ToolGroup = { names; create(workspace) }`, `ToolGroupResult`,
`createGraphHistoryProxy`, `selectWorkToolGroup`, `createQueryGraphToolGroup`, `createReviewToolGroup`,
`createRerunToolGroup`, `assembleObservedExtensions`, `kernelEnabledToolNames`). The Work input is the current
parameter set, field for field, not a new "big deps" object. `runObservedModel` and `ObservedModelRunOptions` keep
every option and its optional-ness; the adapters are called where the lists are computed today. Opening resources,
registering exploration handles, closing and error priority stay in the model loop (`observed-model-run.ts:279`,
`:319–330`, `:377–397`); do not move resource opening into the driver.

**Old exports stay:** `BUILTIN_TOOL_NAMES`, `RESERVED_TOOL_NAMES` (the same `Set<string>` objects, re-exported from
`execution-driver.ts`), `createGraphHistoryProxy` (re-exported from `execution-driver.ts`; Query imports it there),
`EXPLORATION_TOOL_NAMES` (the same literal tuple, re-exported from `observed-model-run.ts`).

**Must stay as it is** (inventory D2 list 1–8, binding):
1. Work and Query keep separate failure checks. Work throws `the coordination tool factory did not produce exactly
   the selected definitions`; Query only filters. Do not give Query the Work check.
2. The two "no graph read dependency" texts stay separate (`the Run selects …` / `the Query grant selects …`), each
   at its current place.
3. Work's check order: unknown names → no coordination tools returns null → mailbox → decisionMessages → graph → note
   write/check → build factories → duplicate names → reserved clash → product check at instantiation. Keep the second
   note dependency check.
4. Work group order: mailbox, user decision, whiteboard, session discovery, graph, note; each group in its own
   constant order. Never sort.
5. Kernel enabled list: builtin / fixed-source read prefix → exploration → coordination → read-only command → review
   → rerun; authorized list only the last four. Definitions: exploration → material → coordination → read-only →
   review → rerun.
6. A review/rerun factory without a name: the name stays out of the lists and the factory is still called; a name
   without a factory is not registered. No new pairing check.
7. `names` are copied at assembly; coordination `create` is read from options when Kernel calls back. Keep both
   timings. Optional fields are spread under their current conditions.
8. No new store reads. Query reads preparation facts only when its graph names are non-empty; the history proxy reads
   the Run card first and the history only after every check, keeping its texts and the ` (Run …)` suffix.

Also stays where it is: Work's unknown-name and missing-dependency checks before the Role/Host checks
(`execution-driver.ts:687–774` before `:802–849`); Query's graph-name filter and dependency check and its identity
construction (`query-execution.ts:213–238`); the review/proposal eligibility and the rerun eligibility
(`purpose === undefined && blockedBinding.length > 0`) in the driver; Query's preparation-time permission projection
(`query-preparation.ts`); the two review allowlists in `src/contracts/review-admission.ts`.

**Byte proof:** the tests pin the lists only after sorting (`C2-runtime-platform-tools.test.ts:201–202`,
`K3-34-tool-name-constants.test.ts:45–68`), and Kernel sorts the specs it sends by name
(`vendor/coding-agent/dist/tools/registry/tool-registry.js:92–99`), so an order regression could slip through. Rules
of §5.0. In both copies, capture per model run, matched by test file, test name and run index: the enabled list and
the authorized list where `runObservedModel` computes them, and the definitions (names in order) **where the existing
`additionalTools` callback returns them** — wrap the callback so it records its own return value; never call a
factory an extra time (that would change factory calls and resource lifetimes, `observed-model-run.ts:317–333`).
Report a run whose callback never ran as such, not as "equal". Cover these eight cases and name the test (file and
name) that reaches each; where no test reaches one, add a probe-only driver in `$S85_SCRATCH` that calls the existing
public entry with a scripted model: a Work Run with every coordination group (mailbox, user decision, whiteboard,
session discovery, graph, note); a Work Run with none; a review Run; a proposal Run; a Run with blocked commands
(rerun tool); a Query with graph tools; a Query without; a fixed-source Run (`read_source`/`read_material`). Start
from `tests/runtime/C2-runtime-platform-tools.test.ts`, `tests/runtime/S3-graph-tools.test.ts`,
`tests/runtime/K-readonly-command.test.ts`, `tests/runtime/K3-14-record-unknown-call-review-tool.test.ts`,
`tests/runtime/K3-16-proposal-tool.test.ts`, `tests/runtime/B1-kernel-assembly.test.ts` and
`tests/runtime/source-tool-lifecycle.test.ts`. Also capture, at the scripted provider's input, the complete `tools` the model client receives (Kernel's converted and name-sorted specs, with descriptions and schemas) and compare them unsorted with the base.

**Size:** about 800 added + deleted lines (700–900).

### 5.3 C2 — one stable-window executor for the activity reads

**Files:** `src/core/work-graph/views/activity-read-model.ts`, `views/track-read-model.ts`,
`views/task-state-timeline.ts`; new `views/activity-stable-window.ts`. Do not edit `views/activity-read-helpers.ts`.

**What:** the four loops — calendar `activity-read-model.ts:768–786`, Run activity list `:793–811`, track
`track-read-model.ts:1169–1188`, task timeline `task-state-timeline.ts:543–561` — call one
`readStableActivityWindow<T>({ records, cap, read, mapError, exhausted })` with
`ACTIVITY_WINDOW_MAX_ATTEMPTS = 4`. `read` is a deferred callback: the calendar passes
`budget => readCalendarWindow(deps, ctx, input, now(), budget)`, so `now()` is still evaluated after each successful
"before" watermark. Input validation, the window string, the capacity and exhausted rejections, and the
`ForbiddenError` branch stay in the callers. The three factories and all types keep their exports.

**Must stay as it is:** a new Budget per attempt (never hoisted out of the loop); before → window → after; retry only
when both watermarks and the window are ready and the watermarks differ; any non-ready result or exception stops at
once; the fourth unstable attempt returns unavailable and there is no fifth read; exactly two `readMany([])` per full
attempt (one if "before" fails; none after a non-ready window); the window result is returned as is (no re-wrapping,
no added fields, no sorting). The four texts keep their own subjects (`the activity read for window ${window}`,
`the Run activity read`, `the track read for window ${window}`, `the task timeline read for ${window}`) with the
shared suffixes. Only the track catches `ForbiddenError` (`track-read-model.ts:1180–1185`); the executor does not
know about it.

**Byte proof:** only the track and timeline loops have exact watermark-count tests
(`S2B-r2-27-moving-window.test.ts:90`, `:109`); the calendar test checks results only
(`S2B-activity-read-faults.test.ts:95–121`) and no test counts the Run activity list's attempts. So, rules of §5.0:
in both copies wrap the record port each loop receives and log every `readMany`/lookup call in order, plus the
calendar's `now()` calls, while these test files run: `S2B-activity-read-faults.test.ts`,
`S2B-r2-27-moving-window.test.ts`, `S2B-r2-keyed-cap.test.ts`, `S2B-r2-r7-keyed-read-cap.test.ts`,
`S2B-33-task-timeline-pagination.test.ts`, `S2B-r2-r4-bound-workspace.test.ts`, `tests/app/S2B-35-activity-routes.test.ts`.
The logs and the results must be identical. In the reply add a table with one row per loop and the columns: new
Budget per attempt, before / window / after, exception mapping, exhausted result, `now()` timing — each cell citing
the old line and the new line.

**Size:** about 190 lines.

### 5.4 C1 — break the note read/write import cycle

**Files:** `src/core/work-graph/notes/note-read-model.ts`, `notes/note-service.ts`, `notes/scribe-scope.ts`,
`notes/note-decision-source.ts`, `notes/note-scribe-todos.ts`; new `notes/note-base-reader.ts` and
`notes/note-rendering.ts`. Not `notes/store-failures.ts` (already separate), not the composition root.

**What:** move `ReadFailureCode`, `ReadOutcome<T>` (`note-read-model.ts:98–101`), `readAllRecords` (`:122–138`) and
`readAllHeads` (`:140–152`) to `note-base-reader.ts`; move `renderUnderstandingBody` (`note-service.ts:351–354`) to
`note-rendering.ts`. Reader, writer, scribe scope, decision source and scribe todos import from the new modules; the
writer and scribe take the error mapping from `store-failures.ts` directly. `note-read-model.ts` re-exports
`readAllRecords`, `readAllHeads`, `ReadFailureCode` and keeps its `mapStoreFailure` / `MappedStoreFailure`
re-exports; `note-service.ts` re-exports `renderUnderstandingBody`. Afterwards no runtime import cycle remains between
reader, writer and scribe scope (check with the architecture check and by reading the imports).

**Must stay as it is:** first page without `after`, `limit: 200`, stop only on `next === null`; one lookup per page,
no keyed read, no dedupe, no sort; **read every page before decoding** (a bad head on page 1 plus a read failure on a
later page must still report the read failure); no partial result; the first bad head returns
`{ ok: false, code: 'unavailable', reason: 'damaged note head' }`; the two success shapes stay different
(`{ ok: true, value }` and `{ ok: true, heads }`); the five-section body is byte-for-byte
`现状\n${status}\n\n已定\n${decided}\n\n未决\n${open}\n\n下一步\n${next}\n\n风险\n${risks}` (no trailing newline, no
trim), and the reader's `sections === undefined ? head.body : renderUnderstandingBody(...)` branch stays.

**Not this round:** the note warning label text (`generalWarningLabel`) moves to the pack in S4 (D3b), the next night; C1 moves no text.

**Byte proof:** move the function bodies by cut and paste, and show in the reply that each moved body is textually
identical to the old one (a `diff` of the old and new function text), plus a table of what each moved body binds to
(every identifier it uses and the module it now comes from), so a same-named import from a different module is
visible.

**Size:** about 160 lines.

### 5.5 A6 — the activity replacement rule into `state/`

**Files:** `src/core/work-graph/tasks/run-activity-service.ts`; new `src/core/work-graph/state/activity-replacement.ts`.

**What:** move the rule comment and the decision (`run-activity-service.ts:138–167`) into
`decideActivityOutcome(existing: RunActivityFactsV1 | null, incoming: RunActivityFactsV1, endCommit: boolean):
ActivityWriteOutcome` (`'created' | 'replaced' | 'unchanged'`). `run-activity-service.ts` keeps
`RunActivityWriteOutcome = ActivityWriteOutcome` and `decideRunActivityOutcome(existing: RunActivitySnapshot | null,
…)` as a wrapper that passes `existing === null ? null : existing.facts` (not `existing?.facts ?? null`), still called
by `planRunActivity`. Do not wire Query (no Query caller exists yet).

**Must stay as it is:** the six-step order (no old → created; old ruleVersion lower → replaced; old counted and not
(endCommit and incoming counted) → unchanged; terminal incoming with strictly greater `throughPosition` and the old
window not terminal or with unresolved calls → replaced; old unknown and incoming counted → replaced; both unknown:
compare `reason` only). No new checks, no detail or totals comparison. The pure function reads nothing, calls no
clock, writes nothing. `planRunActivity`, the end-commit helper and the backfill path keep their reads, clock calls,
receipts and event JSON exactly.

**Byte proof:** two parts, shown separately in the reply: (1) the decision expression is textually identical to the
old one, apart from reading the facts from the parameter instead of `existing.facts` (show the diff); (2) the
wrapper's adaptation `existing === null ? null : existing.facts` is the only new logic.

**Size:** about 85 lines.

### 5.6 B1 — the bounded codec pilot (the lead chose the inventory's design 2)

**Files:** new `src/core/work-graph/persistence/event-codec-factory.ts`; `persistence/decision-record-codecs.ts`;
`persistence/line-settings-codecs.ts`. Not `event-validation.ts`, `event-envelope.ts`, `record-codecs.ts`,
`src/contracts/validation/common.ts`, `model/decision-contracts.ts`, the composition root.

**The three events:** `GoalSettingsChanged@1`, `WorkspaceNoticeSeenChanged@1`, `WorkspaceLinePinsChanged@1`.

**What:** an `EventFormat` description (`eventType`, `schemaVersion`, `jsonLabel`, `bodyProblem`) and
`createEventCodec(format)` returning `{ encode, decodeBody, registration }`. The factory runs exactly today's four
stages in today's order: `eventEnvelopeProblem` → `parseTaggedObject` → `eventBodyEnvelopeProblem` → `bodyProblem`,
first failure returned as `{ status: 'invalid', reason }` with the same text. `encode` only forwards to
`encodeEventEnvelope(event)` (no rebuilding, sorting, defaults or validation). `registration.validate` returns the
original outer `event` object on success, not a copy. The existing body checkers (`goalSettingsChangedEventProblem`,
`workspaceNoticeSeenChangedEventProblem`, `workspaceLinePinsChangedEventProblem`) stay where they are and are
passed in as hooks; their direct-call behaviour (including `the event body must be an object`) is unchanged.

**Factory types (binding):**

```ts
export type EventFormat = { eventType: string; schemaVersion: 1; jsonLabel: string;
  bodyProblem: (value: unknown) => string | null };   // the existing checkers take (value: unknown)
export function createEventCodec<T extends { eventId: string; eventType: string; schemaVersion: number; occurredAt: string }>(
  format: EventFormat): {   // the same constraint as encodeEventEnvelope (event-envelope.ts:4–5)
  encode(event: T): EncodedDomainEvent;                                  // forwards to encodeEventEnvelope(event)
  decodeBody(event: EncodedDomainEvent): DecodeResult<UnknownRecord>;    // the named decoders assert the type
  registration: EncodedEventSchema;                                      // the existing registration type
};
```

Use the existing types named here (`UnknownRecord`, `EncodedDomainEvent`, `DecodeResult`, `EncodedEventSchema`) from
where they are declared today; if a checker's real signature differs, keep the real one. The generic only constrains
the envelope; it never narrows a public type.

**Old exports stay, as named functions in their files:** `encode…`/`decode…` for the three events with their exact
signatures and return types (the named decoders keep the type assertion; `state-writes.test.ts:177` lists them by
file and name); `DECISION_RECORD_SCHEMAS` and `LINE_SETTINGS_RECORD_SCHEMAS` with the same entries in the same order;
the notice event's public proof type stays `DecisionChangeProofV1 | null`. `decodeNoticeOrigin` and every other
non-pilot export in these files is untouched.

**Not this round:** a field-table interpreter (design 1), any other event or record (RunActivity parses before it
checks the envelope, so it does not fit), narrower public types, a common catch.

**Byte proof:** no test pins these decoders' texts, so prove it statically: in the reply, for each of the three
events, put the old decode function and the new factory path side by side and show the same four calls in the same
order with the same arguments, the four early returns, the three JSON labels, and that encode and validate return
what they returned before (validate: the same outer `event` object).

**Size:** about 260–380 lines.

**Why only this much:** decision 70 item 3 asks for a bounded pilot to decide whether to extend it. The lead's note
for that decision: the pilot proves the shared pipeline and registration; later slices add new record kinds that
have no old error texts to preserve, so a field-level description could be tried there without this round's risk.

## 6. Runs and order

Four DSH runs, each a new session with its own run sheet (`./.dsh-ref/s85-run.md`: base, whitelist, time limit,
`$S85_SCRATCH`, interfaces frozen by earlier runs):

| Run | Items | Night | Base | Size (added + deleted) | Time limit |
| --- | --- | --- | --- | --- | --- |
| S1 | D2 (§5.2) | first | the lead branch after SC merged | about 800 | 180 min |
| S2 | C2, C1, A6, B1 (§5.3–5.6) | first | same | about 700–820 | 180 min |
| S3 | D3a (§5.1) | first | same | about 2,150–2,950 | 300 min |
| S4 | D3b (§5.1) | second | the lead's merge of S1–S3 | about 3,750–4,550 | 300 min |

The whole round is about 7,300–9,200 lines, more than decision 85-1's 4,400–5,600: the frozen prompts spec put the
whole platform pack v1 (45 text families and 31 tool files) into D3, which the 10-19 estimate did not count.

S1, S2 and S3 edit disjoint files and run in parallel. After the first night the lead merges them, runs the daily
suite and has Codex audit the three diffs; S4 starts from that merge on the second night. After S4: Codex audit,
the full suite and the scale batch (`npm run test:scale`), then the lead commits. Each run is its own commit
(decision 84-1). The production-reach check must pass at the end of every run: a run wires every new module it
creates.

## 7. Reply

A summary under 300 words, then (not counted in the limit): a per-step table (done / partly / skipped, why), the
interface table for every new module (path, export, signature, where it came from, who uses it), the byte proofs of
§5, the test files run with results, and the changed lines (added + deleted against the base, net).
