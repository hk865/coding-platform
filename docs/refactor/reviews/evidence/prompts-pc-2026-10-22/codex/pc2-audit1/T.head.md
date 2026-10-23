# PC-2 audit, part T: platform pack v2, rendering, the render material and the reminder (rulings 9–11, 13–15, 17, 18, 21's pack half)

Your part is `T`: `./.lead-ref/parts/T.diff` and `T-files.txt`: `resources/prompts/platform/**`, the generated
`src/contracts/prompts/platform-pack.generated.ts`, `runtime-assets.json`, `scripts/build-platform-prompts.mjs`,
`src/core/agent-runtime/context-rendering.ts`, `context-types.ts`, `context-{work,query,review}-recipe.ts`,
`src/contracts/core/prepared-execution.ts`, `src/contracts/continuation-brief.ts`, T's tests (`PC2-T-render`,
`PC2-platform-scan`) and the old tests T owns (book §4 and §5.3: `PC-platform-pack-v2`, `PC-prompt-section-order`,
`A2-rework-contract-helpers`, `K3-15-blocked-sentence-pure`, `K3-35-renderer-boundary-pure`, `S3-context-assembler`,
`S4C2-assembly`, `C3-*`, `A1-rework-same-session`, `S3-role-profiles`). The book §2 rule 1, rulings 9, 10, 11, 13, 14
(T's types), 15, 17, 18, 21 (the whiteboard parameters' move), §5.2 PC-18 (rendering), PC-19 (scan), PC-20, PC-21.

**Look hardest at:**

- **§2 rule 1, byte for byte.** With every tool present, `base` v2 renders exactly the old `base` minus the `check`
  line; each Skill v2 renders byte-equal to its v1 text; the continuation brief differs only by the deleted
  stale-files sentence; the whiteboard pin descriptions move from `strings` to the two tools' `parameters` with the
  sent bytes unchanged; the review and proposal texts unchanged. Diff `base/resources/prompts/platform/**` against the
  tree and check each changed line against ruling 17's text. Every template whose text changed has its version up by
  one, and only those (ruling 9: the three input templates? — check which versions moved and whether each move is
  asked for).
- **Ruling 9's v2 order** for `work-input` (role, goal, task, footprint, notes, inputs, continuation,
  unknown_call_review, reminders); the two Query templates keep their order. **Reply §8.2:** `CONTEXT_SECTION_ORDER`
  became the v2 nine names, and `PC-prompt-section-order` changed though §5.3 does not list it — is that change forced
  by the ruling (then a book omission) or avoidable? `queryPreparedSectionOrder` records a call kind only for templates
  present — correct per ruling 11 (the binding's order equals the frozen set's order for that call kind)?
- **Ruling 10.** Display follows the frozen order; the budget order stays footprint, notes, reminders, inputs with
  the longest-prefix choice; `sections` in frozen order with wholly omitted sections (null ranges); `residentBytes` is
  the billed bytes; omission notes stay in their own sections; one frozen tool list renders `base`, Skills, brief,
  review/proposal, shrink and entry re-renders; the two renderers' optional `pack` and `toolNames` with the stated
  defaults, and every production call site passes both (ruling 10 lists them). Redo PC-21's budget example by hand
  against the code.
- **Ruling 13's material** (`ContextRenderMaterialV1`, `rerenderContextV1`): replaces only the review slot, renders
  the frozen slots and pack once, recomputes every range and `totalBytes`, copies `residentBytes` and the omission
  metadata, never re-runs the budget. **Reply §8.2:** `renderMaterial.pack` is converted from `PromptTextsV1` where the
  book types it `ResolvedPromptPackV1` — does the conversion lose anything a re-render needs (tool texts, origins)?
  "The review recipe does not fill material" — `AssembledContextV1.renderMaterial` is required; what does the review
  recipe return, and can the shrink ever see a review-recipe result?
- **Ruling 15, the reminder.** Appended once at the end of the role section, inside the role range, only when
  `takesSessionHistory`; present also in the all-omitted fallback; the brief sentence deleted and its version up.
- **Ruling 18's scan test** (`PC2-platform-scan`): parse-tree walk, text outside every tool block, whole names,
  case-sensitive; the match set every builtin, reserved (`check` included) and extension name — taken from where? If
  the test reads the names from production code, is that allowed (it is the input set, not the expected value)? The
  exemption list minimal, one reason per line, exactly the book's.
- **Reply §1.1, the book omissions:** ruling 15's 57 bytes break `K3-15-blocked-omission` (4), `K3-35-T-by-hand` (4),
  `K3-35-approved-methods-brief` (2); `AG6-agent-assembly` and `C2-runtime-platform-tools`' "three deployed skills"
  expect the v2 Skill template source (with `{{#tool:}}`) where ruling 18 renders Skills with the final list. For each
  file: confirm it fails for exactly that reason (read the assertion), say which ruling forces the change, the owner
  group, and the exact change (a literal, hand-computed).
- **Tests:** PC-20's four lists as literals (read; read_source only; no read; read with edit and shell), a Skill and
  the brief with the same list; PC-18's rendering half; the old tests changed only as §5.3 says. Name a mutation each
  would miss.
