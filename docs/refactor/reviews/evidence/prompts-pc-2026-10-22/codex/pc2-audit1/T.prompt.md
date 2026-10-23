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
## What you are auditing

**Read only:** do not modify, create or delete any file; no tests, no builds, no git writes, no network. You may run
commands that only read (search, `diff` of two files, hashing a file). Answer in plain Chinese, with `file:line` for
every fact.

This tree is run **PC-2** of the prompts-and-context construction (decision 83-4, 83-5): groups **A** (pack, pure),
**W** (tool texts as input), **H** (Host), **T** (texts and rendering), **G** (guard and entry), **Q** (preparation to
request) and the **joint step** of the frozen book `./.lead-ref/books/pc2-book.md` (v4). DSH built it in one run on
base `pc2-base` = PC-1 as accepted (`pc1-final`, `68dfb10`) plus W's earlier commit `99e15bc` (the ten tool
factories take `texts?`) plus one commit with the two frozen fixtures `tests/helpers/PC2-pack-fixture.ts` and
`PC2-host-fixture.ts`. Commits are in `.lead-ref/commits.txt`. This is the **first audit** (decision 80): your
findings become the frozen table for rework 1 (at most three reworks). Report everything you can prove, and nothing
you cannot. Slice 6A builds on this tree; a wrong or missing interface is a finding.

Inputs in `./.lead-ref/`:

- **The book** `books/pc2-book.md` (v4, binding): §1, §2 (rules for all groups), §3 (rulings 1–21), §4 (groups,
  owners, order), §5 (fixtures, rows PC-01…PC-05, PC-18…PC-26, old tests §5.3), §6. The run sheet `books/run-pc2.md`
  and the whitelist `books/pc2-whitelist.txt` (regular expressions on paths). The lead's rulings on Codex's book
  checks: `books/pc2-chk1-rulings.md`, `books/pc2-chk2-rulings.md` ("check ruling N" in the book).
- **The frozen spec** in the tree: `docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md`
  (the post-note, P1, P2, P5, P8, P9, P10, §2, §3).
- **PC-1 as built:** `books/pc1-book.md` §3.2, `replies/pc1a-interfaces.md` §4, and the "Book corrections" sections
  of `books/pc1b-findings.md` and `books/pc1b-r2-findings.md`.
- **Codex's inventory and book checks** (Chinese): `books/inv-pc2.out.md`, `books/pc2chk1.out.md`, `pc2chk2.out.md`,
  `pc2chk3.out.md`.
- **Your part:** `parts/<P>.diff` (against `pc1-final`) and `parts/<P>-files.txt`. The `pc1-final` version of every
  changed file is at the same relative path under `base/`; a new file has no base. The whole result tree is the
  current directory.
- **DSH's reply** (claims, not evidence): `replies/pc2-reply.md`. Its §1 (questions and what it says the book
  missed), §3 (each row's test and the mutation it claims), §5, §7 and §8 (seams coded differently, UNSPECIFIED) are
  DSH's own account; check each item that touches your part against the book and the code, and say whether DSH's
  way holds. W's earlier reply `replies/pc2w-reply.md` for W's first commit.
- **Tests:** the lead runs them separately (the full suite with bubblewrap); you do not need results.

## What to check (every part)

1. **The rulings of your part**, one by one: built exactly as the book says? Cite the book line and the code line.
   Where the book leaves a choice (`[DSH choice: …]`), is the choice reasonable and stated in the reply?
2. **Behaviour where the book promises none changes** (§2 rule 1): with the platform pack and no new input, the
   prompts, manifests, requests and records are as before, byte for byte, apart from the changes §2 rule 1 lists. A
   difference for some input is **会出错**: give the input, the old output and the new output. A behaviour change
   outside prompts (a Run that used to start and now does not, or the reverse) is **会出错** unless a ruling asks for
   it; then name the ruling and the old tests it breaks.
3. **Tests (decision 80 bar):** every row of your part is tested through the public step the book names; expected
   values are literals or hand-computed, never taken from production code, the generated pack, `preparedTexts()`, a
   manifest or a captured request; no test reads the database or a private module to check a fact; a whole text is
   compared whole, not by a prefix or a regular expression; a test would fail if the rule it guards were broken
   (name a simple mutation it would miss). Old tests: only those §5.3 (and §3.3's PC-2 bullets) name may change, only
   for the reason given, and their other assertions stay. Per-test limits: none unless needed, never above `60_000`,
   no old limit raised.
4. **Scope:** every hunk is asked for by the book for your group, or is an import or type the change needs;
   otherwise **违规**. No file outside the whitelist; no group edited a file another group owns (book §4) except as
   the reply admits; the four frozen fixtures (`tests/helpers/PC-platform-fixture.ts`, `PC-kernel-fixture.ts`,
   `PC2-pack-fixture.ts`, `PC2-host-fixture.ts`) unchanged.
5. **No test-only paths in production:** a branch, option or export that exists only so a test passes is **违规**.
   An unreachable branch (dead code) is **不整洁**, with the reason it cannot be reached.
6. **Comments:** rules and "why" kept with the code; no construction history ("PC-2 did …", "moved from …", group
   or row ids) in production code; in tests a row id in a test name or comment is fine.
7. **Fixture defects:** where DSH says a frozen fixture cannot carry a row, check it. If the fixture is at fault,
   say so and give the smallest fixture patch (Codex writes fixtures; the lead freezes them). If the row can be
   carried another way within the rules, say how.

## Answer

1. **Findings table:** 编号 (`<P>-01` …) | 类别 | 位置 (`file:line`) | 依据 (book ruling or row, spec item) | 问题 |
   唯一改法. Classes: **会出错** (a behaviour differs from the book or the spec for some input, or an interface 6A
   relies on is wrong: give the input and both outputs), **违规** (against the book, the run sheet or the spec,
   including a test below the bar), **不整洁** (stale comment, dead code or import), **建议** (optional). One fix per
   finding: if the right fix needs a lead ruling (e.g. a change outside the whitelist, or a book correction), say so
   and give the fix you would rule.
2. **Per ruling and row:** one line each: `<ruling or row>: OK` or `<…>: <P>-nn, …`.
3. **DSH's own items** that touch your part (reply §1, §8, and any UNSPECIFIED): one line each, `成立` / `不成立`
   and why.
4. **The same findings as JSON**, in one fenced ` ```json ` block: `[{"id", "class", "file", "line", "basis",
   "problem", "fix"}]`.
5. **One last line:** `会出错 n，违规 n，不整洁 n，建议 n`.
