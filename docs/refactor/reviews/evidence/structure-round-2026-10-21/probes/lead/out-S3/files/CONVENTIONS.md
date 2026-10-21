# S85 S3 (D3a) — shared conventions for subagents

Read this before you start. The task book is `/home/han001/dsh-work/slices/s9s85-S3/.dsh-ref/s85-book.md` §5.1 and
`.dsh-ref/s85-run.md`; the inventory is `.dsh-ref/inv-d3.out.md`. This file only fixes the shared mechanics so the
consumers and the pack owner agree.

## Working copy / scratch

- Repository copy (the only tree you edit): `/home/han001/dsh-work/slices/s9s85-S3`.
- Scratch: `/tmp/s85-scratch/S3` (the run sheet's `/home/han001/dsh-work/s85-scratch/S3` is not writable in this
  session; use this path and say so in your report). Base copy: `/tmp/s85-scratch/S3/base`.
- Resource owner handoff area: `/tmp/s85-scratch/S3/handoff/<task>/`.

## The one owner rule

Only the pack-owner subagent edits `resources/prompts/platform/**`, `src/contracts/prompts/slot-tables.ts`,
`src/contracts/prompts/platform-pack.generated.ts`, `runtime-assets.json`, `scripts/build-platform-prompts.mjs`,
`scripts/check-boundaries.mjs` and `package.json`. Every other subagent writes its texts into its handoff directory
(see below) and never touches those files.

## Generated pack and how consumers read it

`src/contracts/prompts/platform-pack.generated.ts` exports `PLATFORM_PROMPT_PACK_V1` as a deeply literal `as const`
object satisfying `ResolvedPromptPackV1`. Import it with the relative path to
`src/contracts/prompts/platform-pack.generated.js`, e.g. from `src/contracts/continuation-brief.ts`:
`import { PLATFORM_PROMPT_PACK_V1 } from './prompts/platform-pack.generated.js';`
and from `src/core/agent-runtime/x.ts`: `from '../../contracts/prompts/platform-pack.generated.js'`.

- Strings: `PLATFORM_PROMPT_PACK_V1.strings['your.key']` — the literal object type means a known key is a `string`
  (no `undefined`); a missing key is a type error. Use string literals directly, never a computed key.
- Templates: `PLATFORM_PROMPT_PACK_V1.templates['template-id']` is the exact file text. For templates with slots call
  `renderTemplate(PLATFORM_PROMPT_PACK_V1, 'template-id', slots, finalToolNames)` from
  `src/contracts/prompts/render-template.js` and use `.text` / `.sectionRanges`. `finalToolNames` may be `[]` when the
  template has no tool blocks.
- Tools: `PLATFORM_PROMPT_PACK_V1.tools['tool_name']` gives `{ description, parameters }`; `parameters` is keyed by the
  path from the tool's input object (`field`, `targets[].path`, an object's own description at the object path, a
  description written after `.optional()` at the same path). Use literal keys.

Do not add a helper that reads the pack from disk or a new export for tests.

## Handoff format (consumers only)

Write exactly these files under `/tmp/s85-scratch/S3/handoff/<task>/`:

- `strings.json`: one flat JSON object `{ "key": "exact text", ... }` containing every string key your files use.
  Namespaces (do not reuse another task's namespace):
  - `brief-k3`: `brief.*`, `k3.*`
  - `tools-1`: `whiteboard.*`, `toolSchema.whiteboardPin.*`, `noteTool.*`, `projectSource.*`, `exploration.*`,
    `readonlyCommand.*`, `commandRerun.*`
  - `tools-2`: `mailbox.*`, `graphTool.*`, `sessionDiscovery.*`, `unknownCallTool.*`
  - `rest`: `role.*`, `architecture.*`, `note.*`, `contextExtension.*`, `scribe.*`
- `templates/<template-id>.txt`: the exact template file content (UTF-8, no added trailing newline; the file must end
  with exactly the last byte the template renders).
- `tools/<tool-name>.json`: `{ "description": "...", "parameters": { "<path>": "..." } }` with the final expanded text.
- `MANIFEST.json`: `{ "strings": { "<key>": "<base file>:<line>", ... }, "templates": { "<id>": "<base file>:<line>" },
  "tools": { "<name>": "<base file>:<line>" }, "notes": ["..."] }` — the base location of each text.
- `README.md`: under 300 words: what you moved, any key you had to add late, anything UNSPECIFIED.

The owner merges all handoffs. If you need a key the owner must add after your report, say it in the report; the owner
adds names but never changes your exact text.

## Exactness rules

- Text is cut and pasted byte-for-byte from the base: no trim, no newline normalisation, no punctuation change, no
  added or removed trailing LF. `……` vs `…`, `(none)` vs `（无）` vs `(未声明)`, `、` vs `, ` vs `; `, two-space
  continuation indents, full/half-width punctuation all stay.
- Fixed prose goes to templates; short labels/prefixes/suffixes/omission phrases go to `strings.json`; tool
  descriptions/parameter descriptions go to `tools/<name>.json`. Loops, sorting, budgets, clipping, list joins,
  null/undefined/empty distinctions, enum-to-text choice, protocol markers (`[attention s3-v1]`, the continuation
  marker), JSON field names, format versions, tool names and error messages stay in code.
- Slot values are never parsed. Put block markers on their own line only; a whole-line `{{#slot}}`/`{{/slot}}` marker
  removes that marker's line and its newline. Required slot values must be non-empty (a required `undefined`/`''`
  throws). Optional empty slots drop their block. A slot may appear only once per template; every slot must be in the
  template's table in `slot-tables.ts`.
- The ten slot tables are frozen by inventory §2 (S3 writes all ten; the three main input templates are S4's and their
  files/resources do not exist yet).
- Tests, assertions and `tests/architecture/production-reach-allowlist.json` are never edited. Old exports keep their
  names, signatures, return shapes and paths. A moved symbol stays importable from its old module.
- Comments: keep every rule and every "why"; no construction history. No `as any` shortcuts; no new store reads, no
  clock calls, no error paths, no validation, no renamed public names.

## Checks and tests

- Never run `tsc` yourself. The coordinator runs it under a lock.
- Tests only as `npx vitest run --maxWorkers=2 <at most 10 files>`, under `timeout 900`; never `npm test`, never a bare
  `npx vitest run`, never a `*.scale.test.ts`, never more than 2 workers. Two subagents may run tests at once.
- If a test fails: decide regression (fix your change, never the test) vs environment (only `ENOENT … bwrap` / sandbox
  unavailable; list the text).
- Report: files changed with added/deleted line counts, handoff paths and key counts, tests run with pass/fail and
  failing names, anything UNSPECIFIED, questions. Do not start subagents.
