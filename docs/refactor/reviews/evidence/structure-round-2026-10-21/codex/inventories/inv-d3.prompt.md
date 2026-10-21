# Inventory for the structure-round task book: D3 (split the context assembler, platform prompt pack v1)

$(COMMON)

## D3's scope, as frozen

D3 is set by decision 85-1 and by the frozen spec `docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md`
(§0.4 first bullet, §1 first bullet, P1 for the pack format and template syntax, P10 for section order, §2 for the
renderer signature, §3.3 first paragraph). In short: split `src/core/agent-runtime/context-assembler.ts` into pure
rendering/templates, history and workspace fact reading, and Work/Query call recipes, leaving a thin orchestration;
build the P1 renderer and **platform pack v1** under `resources/prompts/platform/` (pack.json, templates,
strings.json, tools/<name>.json) and move into it, **verbatim**, every hard-coded text listed in F15 and §0.4
(Work and Query preludes and section labels, role sentences, initial-planning answer format, the continuation brief's
fixed text, K3 review and proposal guidance, consultation guidance, the "用户答复" prefix, the reminder sentences,
the platform tool descriptions: whiteboard, record_note, project_source, exploration tools, read-only command,
mailbox, graph, Session discovery, the two K3 tools). Pack v1's section order is today's. Not moved in D3: the
Kernel base prompt and built-in tool texts, `resources/skills/platform-*`. Acceptance: the same inputs render the
same complete bytes before and after. No user pack, no editing routes, no pack selection, no validation routes (PC).

## Answer

1. **Every text to move.** A table: text (short name), current `file:line` range, the function that emits it, how
   it is joined (separators, trailing newline, interpolations, conditional parts), whether it goes to a template, to
   `strings.json` or to `tools/<name>.json`, and which existing test pins its bytes today (file:line) or "none".
   Include anything F15/§0.4 missed; say what you would not move and why.
2. **Slots.** For each template you propose: template id, the slots (name, required or optional, what fills it),
   and the call recipe that uses it. Check that P1's three-construct syntax (`{{slot}}`, `{{#slot}}…{{/slot}}`,
   `{{#tool:name}}…{{/tool:name}}`, whole-line block markers removed with their newline) can reproduce today's bytes
   exactly, including empty optional parts and the omission markers; name every place it cannot.
3. **The split.** Proposed modules (path, exports with signatures, what each one takes from the current file by
   `file:line`), what stays in `context-assembler.ts`, the call recipes for Work, Query, secretary, copy and review
   calls. Which exports tests import today (file:line) and must stay importable from the old path.
4. **Byte proof.** Which outputs are already pinned byte-for-byte by tests, and for the rest a concrete one-off
   comparison the lead can run (old vs new renderer over which inputs) without changing tests.
5. **Assets.** What `runtime-assets.json`, `scripts/check-boundaries.mjs` and the build/packaging need so the pack
   files ship and are hash-checked like the Skills; where the renderer reads the pack (path resolution, sync vs
   async, caching) without changing preparation order or error behaviour.
6. **Size and grouping.** Estimated added+deleted lines per sub-part; a split into DSH groups of 600-1,200 lines in
   which no two groups edit the same file, with order and the interface each earlier group must freeze for later
   ones. Overlap with SC's files and with the other five items (D2, B1, C2, C1, A6).
7. **Risks.** Anything that cannot be behaviour-identical or would force a test change; recommend skip or narrow.

End with a last line exactly: `文字 N 段，模板 N 个，现有字节测试覆盖 N 段，组 N 个，估计行数 N–N，风险 N`
