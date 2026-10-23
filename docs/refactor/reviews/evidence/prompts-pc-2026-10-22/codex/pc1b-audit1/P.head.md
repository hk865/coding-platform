# PC-1b audit, part P: freezing at preparation and the entry re-render (rulings 14, 15, 17, 18, 19)

Your part is `P`: `./.lead-ref/parts/P.diff` and `P-files.txt`: `src/contracts/prompts/{prompt-set,render-template}.ts`,
`src/contracts/continuation-brief.ts`, `src/contracts/core/prepared-execution.ts`, `src/core/agent-runtime/context-*.ts`,
`execution-preparation.ts`, `query-preparation.ts`, `role-profiles.ts`, the new `prompt-set-texts.ts`,
`src/core/work-graph/tasks/execution-entry-service.ts`, and P's tests (new `tests/contracts/PC-prompt-*`,
`tests/runtime/PC-prepare-*`, `tests/work-graph/PC-entry-frozen-*`; old `W2-role-skills`, `AG6-agent-assembly`,
`C2-runtime-platform-tools`, `WP1-units-fixture`, `K3-35-manifest-trim-pure`, `S3-prepared-context-admission`; the frozen
fixture `tests/helpers/PC-platform-fixture.ts`). The book §3.3, §4 (P's row and the seams block), §5.3 (P's lines).

**Look hardest at:**

- **Ruling 14, the order.** The selection, `provider` and `model` are taken before the first await after the
  configuration read, in Work and in Query; Work's snapshot copies `selection`. The pack is resolved once; a rejection
  is the preparation's `invalid` naming the pack and the reason, never a fallback to `platform`. DSH installs the
  platform source inside preparation when `deps.promptPacks` is absent (reply §4 item 4), where the book puts that
  default in `runtime.ts` (ruling 30): does a named, rejected pack still give `invalid`, and can the preparation-level
  default hide a missing wiring in production?
- **Ruling 14, every read through the resolved pack.** Inside preparation's call tree no read of the generated pack
  is left (the reply §8 lists the remaining importers: check that each is outside preparation, or a no-argument
  default of a pure renderer that preparation never takes). Each production call site passes the pack.
- **Byte equality with the platform pack.** `continuation-brief.ts` (+682 / then 417 lines more in `fa7c469`),
  `prepared-execution.ts`, `context-fact-text.ts`, `context-rendering.ts`: the old default texts became string-table
  reads with a strict `packString`. With the platform pack, is every rendered text byte-equal to the base version?
  Compare against `base/` for each string the code used to inline. What does `packString` do on a missing key, and
  can that happen with the platform pack or a pack that passed C's decoder?
- **Steps 4–7.** The merged base and its separator; the stored texts (each used template tracked through the
  resolved pack, the merged string table, the merged base, each Skill content; same content once; a failed put is
  `unavailable`); `PromptSetV1` in the manifest, inside its digest; the manifest-size measure includes `promptSet`
  and the shrink's algorithm and order are unchanged; the K3-35 boundary re-computed by hand (reply §7) — redo the
  arithmetic. `storePromptTexts`'s `sourceRefs` (reply §4 item 5): is the governance ref sound?
- **Ruling 15.** The platform root by `path.resolve` against `PLATFORM_SKILL_RESOURCE_ROOT`; ids through
  `PLATFORM_SKILLS`; content from the resolved pack; the `SkillContext` form and `source` string exactly as the
  loader writes it; unknown id `invalid`; another root through the public `FileSkillLoader` at preparation; no
  selection → `coding-safety` from `vendor/coding-agent/resources/skills`; an explicit empty list stays empty.
- **Ruling 17.** The entry reads the frozen template and string table back through `deps.bodies`, `decodePromptSetV1`
  and `checkPromptBody`; it never reads the current pack; an unreadable text is the entry's `unavailable`; the
  comparison itself unchanged. WorkGraph imports no Runtime module.
- **Ruling 18** `sectionOrder`, and **ruling 19** (authorize the manifest read first; child bodies by ref, verified,
  origin not required).
- **Reply §4 item 8:** `texts?` on the assembler and recipe inputs, and the call-kind table copied from
  `state/context-input.ts` into preparation. Is a second copy of that table needed, and can the two drift?
- **The fixture change** (reply §4 item 9) is type-only.
- **The tests:** PC-06's preparation half, the W2/AG6/C2 rewrites (explicit subset, empty selection, custom directory
  still covered; no copy of the old directory kept), the hand-written manifests (only `promptSet` added). Name a
  mutation each new test would miss.
