# Inventory for the PC-2 task book: pack editing, pack selection, section order, stale-files reminder, tool declarations

## Answer

1. **User packs on disk (P1).** The Host data directory and settings location (`main.ts`, `host-settings*.ts`), how
   workspace roots are configured, restored and opened (`host.ts`, the open-workspace path), and exactly where the
   two realpath checks of P1 go (start-up error; `invalid` when a new workspace root covers the prompts directory).
   Existing realpath or containment helpers to reuse.
2. **Resolution, inheritance and validation.** D3's loader on this tree: the platform pack is a generated static
   module. How a user pack read from disk at preparation time joins it (per-template most specific pack, `extends`,
   merged `strings.json`, tool files), sync vs async reads in the preparation path, caching, and what "pack broken
   → `invalid` naming pack, template, reason" needs. Which validation D3 already has (slot tables, required slots,
   stray `{{`, tool blocks; `render-template.ts`, `slot-tables.ts`, the generator's checks) and what P1/P10 add.
3. **Editing routes (P1).** The settings routes on this tree (where they are registered, how "only a person" is
   enforced, request/response types, error codes): the nearest existing route to copy for list, create, read and
   save; `expectedVersion` → `revision_conflict`; `forbidden` on the platform pack; atomic file writes and version
   bump; where route tests live.
4. **Pack selection (P2).** The settings model item (`host-settings-types.ts` and its parser and defaults), the Host
   configuration's direct model bindings (`runtime-configuration.ts`), the binding pinning (`host-settings.ts`), and
   how the chosen `promptPack` and `reasoningReplay` reach preparation. Which part of this PC-1 needs first (PC-1
   freezes `packId` and `reasoningReplay`).
5. **Section order (P10).** The templates `work-input`, `query-planning-input`, `query-copy-input` and their slot
   tables (D3); how the rendering derives section ranges and keeps the budget order (`context-rendering.ts`); the
   state guard (`src/core/work-graph/state/context-input.ts`: the fixed order, allowed sections per call kind, the
   "brief/review last, ends at the end" checks), the entry's brief re-render (`execution-entry-service.ts`), the
   binding type and where `sectionOrder` goes, and the review shrink in `execution-preparation.ts` that cuts a
   prefix (re-locate the spec's `:519–557`). For each, the current `file:line` and the change P10 asks.
6. **Stale-files reminder (P8).** Where each run decides it actually took Session history (Work LA-1 seed, K3 seed,
   plain reuse of the same Session; Query `session_history`), where the role section's end is rendered, and where the
   continuation brief's sentence lives now (pack string or template) so PC-2 removes it once.
7. **Tool declarations (P9).** `mentionsTools` in `pack.json` and the generator; the final tool list per run from
   `tool-group-assembly.ts`; where preparation can check a template's declared tools against that list; the four
   tool-list cases of the `base` template; the platform-pack scan test (known tool names outside blocks).
8. **Tests and fixtures.** For PE1, PE2, PE8, PE9 and the PC-2 rows of §3.2 (PC-01…PC-05, PC-18…PC-23): the existing
   harness to use (`file:line`), what fixture is missing for each row (a fake data directory, Host route harness,
   hand-written small packs), how each expected value is hand-computed. Re-check §3.3's list for the PC-2 rows on
   this tree (section order, review shrink, brief sentence; lines moved, files gone, anything missing by the spec's
   grep commands).
9. **Size and grouping.** Added+deleted lines per sub-part; groups of 600–1,200 lines in which no two groups edit
   the same file, their order and frozen interfaces; files PC-1 also touches, and which of PC-1's outputs PC-2 needs.

End with a list of every point where the spec does not match this tree or leaves a choice open (with your
proposal), and one last line: `PC-2 估计：加 n、删 n`.
